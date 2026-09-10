/**
 * A daemon over a dashboard that dies and comes back — the "deaf, not dead"
 * control. Plan 260910f § Stage 4.
 *
 * Every other daemon test drives a scripted source. This one wires the REAL
 * `runOverseer` to the REAL `fleetSource` over a stand-in dashboard on a real
 * socket, then closes the stand-in completely and brings one back on the same
 * port. What it asserts is the thing a reader of the checkpoint relies on to
 * tell a deaf Overseer from a dead one: while the dashboard is gone the
 * heartbeat keeps moving and `lastGoodSnapshotAt` does not — and the outage is
 * written down as a `condition-degraded`, closed by a `condition-restored`.
 *
 * The roadmap's acceptance: "a green test suite without an observed
 * stopped-clock/failed-source control is insufficient evidence". So the
 * stopped-clock half is asserted here as a positive observation (it stood
 * still across many ticks), after first proving it moves when the source is up.
 *
 * Scratch everything: a mkdtemp store, a stand-in on `listen(0, 127.0.0.1)`,
 * an injected clock, no process-table probe, no real transcript directory.
 */
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { runOverseer } from "../tools/overseer/daemon.js";
import { readNotes, type DaemonNote } from "../tools/overseer/notes.js";
import { LOCK_FILE, readCheckpoint } from "../tools/overseer/store.js";
import { editableFixture } from "./overseer-fixtures.js";

const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-outage-test-"));
  roots.push(root);
  return root;
}

/**
 * The daemon's clock: real elapsed time, from an instant of our choosing.
 *
 * Real elapsed rather than frozen, because the heartbeat moving is one of the
 * two things under test and a frozen clock would stamp every tick with the same
 * `lastTickAt`. Injected rather than `Date`, so the collections this file mints
 * are on the same clock the freshness watchdog measures them against.
 */
function elapsedClock(startIso: string): () => Date {
  const base = Date.parse(startIso);
  const t0 = Date.now();
  return () => new Date(base + (Date.now() - t0));
}

/** A real capture with a fresh producer clock, so each one is a NEW collection to the gate. */
function collection(collectedAt: string): string {
  return JSON.stringify({ ...editableFixture("session-new-before"), collectedAt });
}

/**
 * A stand-in for `tools/fleet/server.ts`: the two routes the Overseer reads.
 * Copied down from `tests/overseer-source.test.ts`'s `fakeFleet` to what this
 * test needs, plus a fixed port so a second one can come back where the first was.
 */
type StandIn = { port: number; publish(): void; close(): Promise<void> };

function standIn(port: number, body: () => string): Promise<StandIn> {
  const subscribers = new Set<ServerResponse>();
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/api/live")) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      res.flushHeaders();
      // The current snapshot on subscribe, as the real stream does.
      res.write(`event: snapshot\ndata: ${body()}\n\n`);
      subscribers.add(res);
      req.on("close", () => subscribers.delete(res));
      return;
    }
    if (url.startsWith("/api/state")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body());
      return;
    }
    res.writeHead(404).end();
  });
  let closed = false;
  const close = (): Promise<void> => {
    if (closed) return Promise.resolve();
    closed = true;
    return new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  };
  cleanups.push(close);
  return new Promise((resolve, reject) => {
    // A bind failure rejects rather than hanging — including the one real risk
    // of reusing a port: somebody else took it while the stand-in was down.
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port");
      resolve({
        port: address.port,
        publish() {
          for (const res of subscribers) res.write(`event: snapshot\ndata: ${body()}\n\n`);
        },
        close,
      });
    });
  });
}

function notesIn(root: string): DaemonNote[] {
  const read = readNotes(root);
  if (read.kind === "unreadable") throw new Error(read.cause);
  return read.notes;
}

type Heartbeat = { lastGoodSnapshotAt: string | null; lastTickAt: string | null; ticks: number };

function heartbeatOf(root: string): Heartbeat | null {
  const read = readCheckpoint(root);
  if (read.kind !== "checkpoint") return null;
  return {
    lastGoodSnapshotAt: read.checkpoint.lastGoodSnapshotAt,
    lastTickAt: read.checkpoint.heartbeat.lastTickAt,
    ticks: read.checkpoint.heartbeat.ticks,
  };
}

/** Poll a condition on real time; fail with the sentence rather than hang. */
async function waitFor(what: string, predicate: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const hasNote = (root: string, kind: DaemonNote["kind"], condition: string): boolean =>
  notesIn(root).some((note) => note.kind === kind && "condition" in note && note.condition === condition);

describe("a daemon over a dashboard that dies and comes back", () => {
  test("the outage is degraded then restored, and while it lasts the heartbeat moves and lastGoodSnapshotAt does not", async () => {
    const root = tempRoot();
    const now = elapsedClock("2026-09-10T09:00:00.000Z");
    let current = collection(now().toISOString());
    const body = (): string => current;
    const first = await standIn(0, body);
    const port = first.port;

    const controller = new AbortController();
    cleanups.push(async () => controller.abort());
    const running = runOverseer({
      root,
      baseUrl: `http://127.0.0.1:${port}`,
      signal: controller.signal,
      now,
      log: () => undefined,
      tickMs: 20,
      // The source's two injectable timings, short: a poll every 25ms while the
      // stream is down, and the stream retried after 150ms on the fallback.
      // Its other two (poll timeout 20s, stream silence 90s) are not reachable
      // through DaemonOptions, and are not needed: a closed port refuses at once.
      pollIntervalMs: 25,
      streamRetryAfterMs: 150,
      // Nothing from the real box: no process table, no boot id, no transcripts.
      probe: () => ({ read: false, why: "not read in a test" }),
      bootId: () => null,
      recovery: { projectsDir: join(root, "no-transcripts-here") },
    });

    // ── UP. Non-vacuous first: lastGoodSnapshotAt MOVES while the source works,
    // so its standing still below is a fact about the outage, not about the field.
    const collectedA = JSON.parse(current).collectedAt as string;
    await waitFor("collection A accepted", () => heartbeatOf(root)?.lastGoodSnapshotAt === collectedA);
    const collectedB = new Date(now().getTime() + 1).toISOString();
    current = collection(collectedB);
    first.publish();
    await waitFor("collection B accepted", () => heartbeatOf(root)?.lastGoodSnapshotAt === collectedB);
    expect(hasNote(root, "condition-degraded", "sse-stream")).toBe(false);
    expect(hasNote(root, "condition-degraded", "poll")).toBe(false);

    // ── DOWN. Closed completely: every connection dropped and the port released.
    await first.close();
    await waitFor(
      "the outage written down (sse-stream and poll degraded)",
      () => hasNote(root, "condition-degraded", "sse-stream") && hasNote(root, "condition-degraded", "poll"),
    );
    const atOutage = heartbeatOf(root);
    if (atOutage === null) throw new Error("no checkpoint at the outage");
    // DEAF, NOT DEAD: many ticks later the heartbeat has moved on and the last
    // good collection is exactly where the outage left it.
    await waitFor("the heartbeat to keep ticking while the source is gone", () => {
      const beat = heartbeatOf(root);
      return beat !== null && beat.ticks >= atOutage.ticks + 5;
    });
    const deaf = heartbeatOf(root);
    if (deaf === null || atOutage.lastTickAt === null || deaf.lastTickAt === null) throw new Error("no heartbeat");
    expect(Date.parse(deaf.lastTickAt)).toBeGreaterThan(Date.parse(atOutage.lastTickAt));
    expect(deaf.lastGoodSnapshotAt).toBe(collectedB);
    expect(atOutage.lastGoodSnapshotAt).toBe(collectedB);
    expect(hasNote(root, "condition-restored", "poll")).toBe(false);

    // ── BACK, on the same port, with a newer collection.
    const collectedC = new Date(now().getTime() + 1).toISOString();
    current = collection(collectedC);
    await standIn(port, body);
    await waitFor(
      "the outage closed (poll and sse-stream restored) and collection C accepted",
      () =>
        hasNote(root, "condition-restored", "poll") &&
        hasNote(root, "condition-restored", "sse-stream") &&
        heartbeatOf(root)?.lastGoodSnapshotAt === collectedC,
    );

    // The restorations close THIS outage: after the degradations, same instance.
    const notes = notesIn(root);
    const started = notes.find((note) => note.kind === "daemon-started");
    if (started?.kind !== "daemon-started") throw new Error("no start note");
    for (const condition of ["poll", "sse-stream"]) {
      const degradedAt = notes.findIndex((n) => n.kind === "condition-degraded" && n.condition === condition);
      const restoredAt = notes.findIndex((n) => n.kind === "condition-restored" && n.condition === condition);
      expect(restoredAt).toBeGreaterThan(degradedAt);
      const restored = notes[restoredAt];
      if (restored?.kind !== "condition-restored") throw new Error("expected a restoration");
      expect(restored.instanceId).toBe(started.instanceId);
      expect(restored.forMs).toBeGreaterThan(0);
    }
    // The watchdog's own condition never opened: the outage was far shorter
    // than its five-minute deadline, and an alarm there would be A17's false one.
    expect(hasNote(root, "condition-degraded", "freshness")).toBe(false);

    // ── STOP, by the signal, and the lock is let go.
    controller.abort();
    const outcome = await running;
    expect(outcome.kind).toBe("stopped");
    expect(notesIn(root).at(-1)?.kind).toBe("daemon-stopped");
    expect(existsSync(join(root, LOCK_FILE))).toBe(false);
  }, 30_000);
});
