/**
 * The dashboard's own reader of the daemon's start stamp (plan 260910f, Sol's
 * F2): the LAST `daemon-started` note in `daemon.jsonl` whose `instanceId` is
 * the one the checkpoint's heartbeat names. Fleet-owned, because
 * `tools/fleet/` may not import the Overseer's `notes.ts`; tolerant, because a
 * malformed line must not cost the page; bounded, because it runs per request.
 *
 * The controls are the ones a careless reader would get wrong: another
 * instance's later start standing in for the running one, a torn final line
 * read as a whole note, a malformed revision read as "not stamped", and an
 * old note outside the window reported as missing rather than as unknown.
 * Scratch directories only.
 */
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { DAEMON_START_TAIL_BYTES, checkpointInstance, readDaemonStart } from "../tools/fleet/daemon-start.js";
import type { OverseerStatusFeed } from "../tools/fleet/wire.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "fleet-daemon-start-test-"));
  roots.push(root);
  return root;
}

const RUNNING = "ov-running-4f2a";
const OTHER = "ov-other-9c1d";
const SHA = "3c9e1f0b7a2d4e6f8091a2b3c4d5e6f708192a3b";
const OLD_SHA = "9a8b7c6d5e4f30211f0e1d2c3b4a59687766554f";

function started(instanceId: string, at: string, revision?: unknown): string {
  return JSON.stringify({
    kind: "daemon-started",
    at,
    instanceId,
    pid: 4242,
    source: "http://127.0.0.1:8787",
    opening: "cold",
    baseline: "none",
    ...(revision === undefined ? {} : { revision }),
  });
}

const stopped = (instanceId: string, at: string): string => JSON.stringify({ kind: "daemon-stopped", at, instanceId, why: "signal" });

function notes(root: string, lines: string[], trailing = "\n"): void {
  writeFileSync(join(root, "daemon.jsonl"), lines.join("\n") + trailing);
}

const named = { kind: "named", instanceId: RUNNING } as const;

describe("readDaemonStart", () => {
  test("the last start note OF THE RUNNING INSTANCE, never a later one from another", () => {
    const root = tempRoot();
    notes(root, [
      started(RUNNING, "2026-09-10T10:00:00.000Z", { kind: "known", sha: OLD_SHA, dirty: false, readAt: "2026-09-10T10:00:00.000Z" }),
      started(RUNNING, "2026-09-10T11:00:00.000Z", { kind: "known", sha: SHA, dirty: true, readAt: "2026-09-10T11:00:00.000Z" }),
      started(OTHER, "2026-09-10T12:00:00.000Z", { kind: "known", sha: OLD_SHA, dirty: false, readAt: "2026-09-10T12:00:00.000Z" }),
      stopped(OTHER, "2026-09-10T12:01:00.000Z"),
    ]);
    expect(readDaemonStart(root, named)).toEqual({
      kind: "stamped",
      instanceId: RUNNING,
      at: "2026-09-10T11:00:00.000Z",
      revision: { kind: "known", sha: SHA, dirty: true, readAt: "2026-09-10T11:00:00.000Z" },
    });
  });

  test("a note with no revision field is not stamped — not unknown, and not a match", () => {
    const root = tempRoot();
    notes(root, [started(RUNNING, "2026-09-10T11:00:00.000Z")]);
    expect(readDaemonStart(root, named)).toEqual({ kind: "not-stamped", instanceId: RUNNING, at: "2026-09-10T11:00:00.000Z" });
  });

  test("a revision field that is there and malformed is an UNKNOWN revision, not 'not stamped'", () => {
    const root = tempRoot();
    notes(root, [started(RUNNING, "2026-09-10T11:00:00.000Z", { kind: "known", sha: "short", dirty: false, readAt: "x" })]);
    const read = readDaemonStart(root, named);
    expect(read).toMatchObject({ kind: "stamped", instanceId: RUNNING, revision: { kind: "unknown" } });
  });

  test("a torn final line is not read as a note, even when it names the running instance", () => {
    const root = tempRoot();
    const torn = started(RUNNING, "2026-09-10T12:00:00.000Z", { kind: "known", sha: SHA, dirty: false, readAt: "2026-09-10T12:00:00.000Z" });
    writeFileSync(join(root, "daemon.jsonl"), `${started(RUNNING, "2026-09-10T11:00:00.000Z")}\n${torn.slice(0, torn.length - 5)}`);
    expect(readDaemonStart(root, named)).toMatchObject({ kind: "not-stamped", at: "2026-09-10T11:00:00.000Z" });
  });

  test("malformed complete lines are skipped rather than costing the answer", () => {
    const root = tempRoot();
    notes(root, [started(RUNNING, "2026-09-10T11:00:00.000Z"), "{ not json", JSON.stringify({ kind: "daemon-started" }), "[1,2]"]);
    expect(readDaemonStart(root, named)).toMatchObject({ kind: "not-stamped", instanceId: RUNNING });
  });

  test("no start note for the running instance is unknown, and names the instance", () => {
    const root = tempRoot();
    notes(root, [started(OTHER, "2026-09-10T11:00:00.000Z")]);
    const read = readDaemonStart(root, named);
    expect(read.kind).toBe("unknown");
    if (read.kind === "unknown") expect(read.why).toContain(RUNNING);
  });

  test("a start note older than the bounded window is unknown and says it looked only at the tail", () => {
    const root = tempRoot();
    const filler: string[] = [];
    let size = 0;
    while (size < DAEMON_START_TAIL_BYTES * 2) {
      const line = JSON.stringify({ kind: "condition-degraded", at: "2026-09-10T11:30:00.000Z", instanceId: RUNNING, condition: "source", why: "x".repeat(300) });
      filler.push(line);
      size += line.length + 1;
    }
    notes(root, [started(RUNNING, "2026-09-10T11:00:00.000Z"), ...filler]);
    const read = readDaemonStart(root, named);
    expect(read.kind).toBe("unknown");
    if (read.kind === "unknown") expect(read.why).toMatch(/last \d+ KB/);
  });

  test("an absent notes file, a symlinked one, and an unknown instance are each unknown with their own reason", () => {
    const absentRoot = tempRoot();
    const absent = readDaemonStart(absentRoot, named);
    expect(absent.kind).toBe("unknown");

    const linkRoot = tempRoot();
    const elsewhere = tempRoot();
    writeFileSync(join(elsewhere, "real.jsonl"), `${started(RUNNING, "2026-09-10T11:00:00.000Z")}\n`);
    symlinkSync(join(elsewhere, "real.jsonl"), join(linkRoot, "daemon.jsonl"));
    const linked = readDaemonStart(linkRoot, named);
    expect(linked.kind).toBe("unknown");
    if (linked.kind === "unknown") expect(linked.why).toContain("symbolic link");

    const noInstance = readDaemonStart(absentRoot, { kind: "unknown", why: "there is no checkpoint" });
    expect(noInstance).toEqual({ kind: "unknown", why: "there is no checkpoint" });

    if (absent.kind === "unknown") expect(absent.why).not.toEqual(linked.kind === "unknown" ? linked.why : "");
  });
});

describe("checkpointInstance", () => {
  test("names the heartbeat's instance, and gives a reason for every way it cannot", () => {
    const heartbeat = { kind: "reading", pid: 1, instanceId: RUNNING, startedAt: "2026-09-10T11:00:00.000Z", lastTickAt: null, ticks: 0 } as const;
    const published = { kind: "published", status: { heartbeat } } as unknown as OverseerStatusFeed;
    expect(checkpointInstance(published)).toEqual({ kind: "named", instanceId: RUNNING });

    const cases: OverseerStatusFeed[] = [
      { kind: "checkpoint-absent" },
      { kind: "checkpoint-unreadable", why: "EACCES" },
      { kind: "unsupported-schema", saw: "9", known: 2 },
      { kind: "not-asked" },
      { kind: "published", status: { heartbeat: { kind: "unreadable", why: "no pid" } } } as unknown as OverseerStatusFeed,
    ];
    const whys = cases.map((feed) => {
      const read = checkpointInstance(feed);
      expect(read.kind).toBe("unknown");
      return read.kind === "unknown" ? read.why : "";
    });
    expect(new Set(whys).size).toBe(cases.length);
  });
});
