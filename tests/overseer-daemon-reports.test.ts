/**
 * **The daemon's `reports` option: called on its own interval, with the store's
 * register, and a throw is a note rather than a dead daemon.**
 *
 * The drain itself is `tests/overseer-reports.test.ts`. This is the join: a drain
 * that is green on its own and never called by the daemon is the class
 * `tests/overseer-daemon-usage-pass.test.ts` exists for.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

import { runOverseer } from "../tools/overseer/daemon.js";
import { readNotes } from "../tools/overseer/notes.js";
import type { SourceMessage } from "../tools/overseer/source.js";
import type { ReportDrainOutcome } from "../tools/overseer/reports.js";
import { LOCK_FILE, type SessionRegister } from "../tools/overseer/store.js";
import { heldOpen, ticks, until } from "./helpers/overseer-until.js";
import { rawFixture } from "./overseer-fixtures.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-daemon-reports-"));
  roots.push(root);
  return root;
}

const QUIET: ReportDrainOutcome = {
  recorded: 0,
  duplicates: 0,
  refused: 0,
  pending: 0,
  deferred: 0,
  skippedEntries: 0,
  quarantined: 0,
  scanned: 0,
  scanCapped: false,
  replayed: 0,
  debrisRemoved: 0,
  probes: 0,
  bytesRead: 0,
  stoppedBy: null,
  notes: [],
};

/** Runs the daemon until `done` holds — never for a fixed time; tests/helpers/overseer-until.ts says why. */
async function runWithDrain(
  drain: (register: SessionRegister) => Promise<ReportDrainOutcome>,
  what: string,
  done: () => boolean,
): Promise<string> {
  const root = tempRoot();
  const controller = new AbortController();
  const running = runOverseer({
    root,
    baseUrl: "http://127.0.0.1:1",
    signal: controller.signal,
    // Standing just after the fixture's capture, so its snapshot is fresh.
    now: () => new Date("2026-09-08T02:48:40.000Z"),
    tickMs: 20,
    log: () => {},
    source: async function* (): AsyncGenerator<SourceMessage> {
      yield { kind: "payload", via: "sse", atMs: 0, json: rawFixture("session-new-before") };
      await heldOpen(controller.signal);
    },
    reports: { intervalMs: 25, drain },
  });
  await until(what, done);
  controller.abort();
  expect((await running).kind).toBe("stopped");
  return root;
}

test("the drain is called on its interval with the store's live register", async () => {
  const seen: SessionRegister[] = [];
  await runWithDrain(
    async (register) => {
      seen.push(register);
      return QUIET;
    },
    // Both halves, because both are asserted below: the drain's timer starts
    // before the source's first payload is applied, so three drains can all
    // land on a register that is still empty (measured 2026-10-04: filled at
    // the fourth). Stopping on the count alone was a race the daemon lost.
    "three drains, the last on a register holding the fixture's sessions",
    () => seen.length > 2 && (seen.at(-1)?.size ?? 0) > 0,
  );
  expect(seen.length).toBeGreaterThan(2);
  // One live map, the store's own — not a copy per call.
  expect(new Set(seen).size).toBe(1);
  // It holds the fixture's sessions, which only the store's register would.
  expect(seen.at(-1)?.size).toBeGreaterThan(0);
});

test("a throwing drain becomes a note and the daemon keeps running", async () => {
  let calls = 0;
  const root = await runWithDrain(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("the inbox is on fire");
      return QUIET;
    },
    "a drain after the one that threw",
    () => calls > 1,
  );
  expect(calls).toBeGreaterThan(1);
  const read = readNotes(root);
  if (read.kind === "unreadable") throw new Error(read.cause);
  const degraded = read.notes.find((note) => note.kind === "condition-degraded" && note.condition === "reports");
  expect(degraded?.kind === "condition-degraded" ? degraded.why : "").toMatch(/on fire/);
  expect(read.notes.some((note) => note.kind === "condition-restored" && note.condition === "reports")).toBe(true);
});

/* ------------------------------------------------------------------ *
 * A drain that is SUSPENDED — awaiting git — when something else happens.
 * Plan 261004g. The drain writes files under the daemon's lock, so the daemon
 * may not release that lock, nor start a second drain, while one is out.
 * ------------------------------------------------------------------ */

type Suspended = {
  /** How many drains were started. */
  started: number;
  /** What the daemon's `stillOwner` said when the suspended drain came back. */
  ownerOnResume: boolean | null;
  /** True once the drain has returned to the daemon. */
  settled: boolean;
  release: () => void;
  drain: (register: SessionRegister, stillOwner: () => boolean) => Promise<ReportDrainOutcome>;
};

/** A drain whose first pass waits, as one does on git, until the test releases it. */
function suspendedDrain(): Suspended {
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const state: Suspended = {
    started: 0,
    ownerOnResume: null,
    settled: false,
    release: () => open(),
    drain: async (_register, stillOwner) => {
      state.started += 1;
      await gate;
      state.ownerOnResume ??= stillOwner();
      state.settled = true;
      // As the real drain answers: a pass told it no longer owns the store stops there.
      return state.ownerOnResume ? QUIET : { ...QUIET, stoppedBy: "abandoned" };
    },
  };
  return state;
}

function daemonWith(
  root: string,
  controller: AbortController,
  suspended: Suspended,
  source: () => AsyncGenerator<SourceMessage>,
): ReturnType<typeof runOverseer> {
  return runOverseer({
    root,
    baseUrl: "http://127.0.0.1:1",
    signal: controller.signal,
    now: () => new Date("2026-09-08T02:48:40.000Z"),
    tickMs: 5,
    log: () => {},
    source,
    reports: { intervalMs: 5, drain: suspended.drain },
  });
}

/** Says `"still running"` if the daemon has not returned after a real pause. */
async function stillRunningAfter<T>(running: Promise<T>, ms: number): Promise<"returned" | "still running"> {
  // A REAL WAIT, kept: "the daemon has NOT returned" has no event to wait for.
  // Too short can only make a broken shutdown look right, so it is generous.
  return Promise.race([
    running.then(() => "returned" as const),
    new Promise<"still running">((resolve) => setTimeout(() => resolve("still running"), ms)),
  ]);
}

test("a drain that outlasts its interval is started once, not once per tick", async () => {
  const root = tempRoot();
  const controller = new AbortController();
  const suspended = suspendedDrain();
  const running = daemonWith(root, controller, suspended, async function* () {
    yield* [];
    await heldOpen(controller.signal);
  });
  await until("the drain to start", () => suspended.started > 0);
  // Ten heartbeat ticks, at the same 5 ms the drain's own timer has.
  const before = ticks(root);
  await until("ten more ticks", () => ticks(root) >= before + 10);
  expect(suspended.started).toBe(1);
  suspended.release();
  controller.abort();
  await running;
});

test("stopping waits for a suspended drain, which is told it no longer owns the store", async () => {
  const root = tempRoot();
  const controller = new AbortController();
  const suspended = suspendedDrain();
  const running = daemonWith(root, controller, suspended, async function* () {
    yield* [];
    await heldOpen(controller.signal);
  });
  await until("the drain to start", () => suspended.started > 0);
  controller.abort();
  // The lock is released by the return. Returning now would hand the store to
  // the next daemon with this one's drain still about to write under it.
  expect(await stillRunningAfter(running, 150)).toBe("still running");
  suspended.release();
  expect((await running).kind).toBe("stopped");
  expect(suspended.settled).toBe(true);
  expect(suspended.ownerOnResume).toBe(false);
});

test("a source that throws waits for a suspended drain too", async () => {
  const root = tempRoot();
  const controller = new AbortController();
  const suspended = suspendedDrain();
  const running = daemonWith(root, controller, suspended, async function* () {
    yield* [];
    await until("the drain to start", () => suspended.started > 0);
    throw new Error("the source fell over");
  });
  const outcome = running.then(
    () => "returned without throwing",
    (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  );
  await until("the drain to start", () => suspended.started > 0);
  expect(await stillRunningAfter(outcome, 150)).toBe("still running");
  suspended.release();
  expect(await outcome).toBe("the source fell over");
  expect(suspended.settled).toBe(true);
  // Nobody aborted anything: the daemon is leaving by itself, and has to say so.
  expect(suspended.ownerOnResume).toBe(false);
});

test("a source that simply ends waits for a suspended drain, and tells it to stop", async () => {
  const root = tempRoot();
  const controller = new AbortController();
  const suspended = suspendedDrain();
  const running = daemonWith(root, controller, suspended, async function* () {
    yield* [];
    await until("the drain to start", () => suspended.started > 0);
  });
  await until("the drain to start", () => suspended.started > 0);
  expect(await stillRunningAfter(running, 150)).toBe("still running");
  suspended.release();
  expect((await running).kind).toBe("stopped");
  expect(suspended.ownerOnResume).toBe(false);
});

test("a pass abandoned on the way out does not restore a degraded reports condition", async () => {
  const root = tempRoot();
  const controller = new AbortController();
  const suspended = suspendedDrain();
  let calls = 0;
  const running = runOverseer({
    root,
    baseUrl: "http://127.0.0.1:1",
    signal: controller.signal,
    now: () => new Date("2026-09-08T02:48:40.000Z"),
    tickMs: 5,
    log: () => {},
    source: async function* (): AsyncGenerator<SourceMessage> {
      yield* [];
      await heldOpen(controller.signal);
    },
    reports: {
      intervalMs: 5,
      drain: async (register, stillOwner) => {
        calls += 1;
        if (calls === 1) throw new Error("the inbox is on fire");
        return suspended.drain(register, stillOwner);
      },
    },
  });
  await until("the second drain to start", () => suspended.started > 0);
  controller.abort();
  suspended.release();
  await running;
  expect(suspended.ownerOnResume).toBe(false);
  const read = readNotes(root);
  if (read.kind === "unreadable") throw new Error(read.cause);
  expect(read.notes.some((note) => note.kind === "condition-degraded" && note.condition === "reports")).toBe(true);
  // "A report drain pass completed" would be false: this one was cut short.
  expect(read.notes.some((note) => note.kind === "condition-restored" && note.condition === "reports")).toBe(false);
});

test("a log that cannot be written does not stop a lost lock halting the daemon", async () => {
  const root = tempRoot();
  const controller = new AbortController();
  const suspended = suspendedDrain();
  const running = runOverseer({
    root,
    baseUrl: "http://127.0.0.1:1",
    signal: controller.signal,
    now: () => new Date("2026-09-08T02:48:40.000Z"),
    tickMs: 60_000,
    // Saying it is the least important part of noticing it.
    log: (line) => {
      if (line.includes("the lock is gone")) throw new Error("EPIPE");
    },
    source: async function* ({ signal }): AsyncGenerator<SourceMessage> {
      yield* [];
      await heldOpen(signal);
    },
    reports: { intervalMs: 5, drain: suspended.drain },
  });
  await until("the drain to start", () => suspended.started > 0);
  writeFileSync(
    join(root, LOCK_FILE),
    `${JSON.stringify({ pid: process.pid, instanceId: "somebody-else", hostname: "box", startedAt: "2026-09-08T02:00:00.000Z" })}\n`,
  );
  suspended.release();
  expect((await running).kind).toBe("lock-lost");
  expect(suspended.ownerOnResume).toBe(false);
});

test("a drain that comes back to a stolen lock is told so, halts the daemon, and leaves no reports note", async () => {
  const root = tempRoot();
  const controller = new AbortController();
  const suspended = suspendedDrain();
  const lines: string[] = [];
  const running = runOverseer({
    root,
    baseUrl: "http://127.0.0.1:1",
    signal: controller.signal,
    now: () => new Date("2026-09-08T02:48:40.000Z"),
    // A heartbeat that will not tick during the test: the DRAIN has to be what
    // notices, after its own wait, rather than the next write of somebody else's.
    tickMs: 60_000,
    log: (line) => void lines.push(line),
    // A SOURCE WITH NOTHING MORE TO SAY, as the real one is between payloads:
    // it ends only when the signal the daemon gave it is aborted. So the daemon
    // itself has to wake it on finding the lock gone, or it never returns.
    source: async function* ({ signal }): AsyncGenerator<SourceMessage> {
      yield* [];
      await heldOpen(signal);
    },
    reports: { intervalMs: 5, drain: suspended.drain },
  });
  await until("the drain to start", () => suspended.started > 0);
  writeFileSync(
    join(root, LOCK_FILE),
    `${JSON.stringify({ pid: process.pid, instanceId: "somebody-else", hostname: "box", startedAt: "2026-09-08T02:00:00.000Z" })}\n`,
  );
  suspended.release();
  expect((await running).kind).toBe("lock-lost");
  expect(suspended.ownerOnResume).toBe(false);
  const read = readNotes(root);
  if (read.kind === "unreadable") throw new Error(read.cause);
  // Nothing about `reports` after the lock went: the note log is the new holder's.
  expect(
    read.notes.filter((note) => (note.kind === "condition-restored" || note.kind === "condition-degraded") && note.condition === "reports"),
  ).toEqual([]);
});
