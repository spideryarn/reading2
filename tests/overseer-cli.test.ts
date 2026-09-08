/**
 * The read CLI: what is the Overseer doing, and what has it seen.
 *
 * **The command exists because otherwise every stage passes and Greg's NOW goal
 * fails.** A daemon recording events with no way to look at them is *"staying
 * up-to-date on progress automatically"* not happening, while every test is
 * green — so this is part of S4 rather than a nicety on top of it.
 *
 * The tests that matter are the ones about telling a dead daemon from a quiet
 * one. Those are the same picture on a page that only renders the register, and
 * the whole of docs/reusable/silent-success.md is about that picture.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { STALL_AFTER_MS, daemonStanding, describeEvent, readEventTail, statusLines } from "../scripts/overseer.js";
import type { OverseerEvent } from "../tools/overseer/diff.js";
import { EVENTS_FILE, type Checkpoint } from "../tools/overseer/store.js";
import type { DaemonNote } from "../tools/overseer/notes.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-cli-test-"));
  roots.push(root);
  return root;
}

const NOW = Date.parse("2026-09-08T08:00:00.000Z");

function checkpointAt(agoMs: number, pid = 4242): Checkpoint {
  return {
    schema: 1,
    writtenAt: new Date(NOW - agoMs).toISOString(),
    lastGoodSnapshotAt: new Date(NOW - agoMs).toISOString(),
    cursor: { events: 12, bytes: 900 },
    heartbeat: { pid, instanceId: "i1", startedAt: "2026-09-08T07:00:00.000Z", lastTickAt: new Date(NOW - agoMs).toISOString(), ticks: 100 },
    register: [],
  };
}

const stoppedNote: DaemonNote = { kind: "daemon-stopped", at: "2026-09-08T07:59:00.000Z", instanceId: "i1", why: "SIGTERM" };
const startedNote: DaemonNote = {
  kind: "daemon-started",
  at: "2026-09-08T07:00:00.000Z",
  instanceId: "i1",
  pid: 4242,
  source: "http://127.0.0.1:8787",
  opening: "Resumed",
  baseline: "restored",
};

describe("telling a dead daemon from a quiet one", () => {
  test("nothing at all is never-run, not healthy", () => {
    const standing = daemonStanding({ checkpoint: null, lastNote: null, nowMs: NOW, alive: () => true });
    expect(standing.state).toBe("never-run");
  });

  test("a fresh checkpoint from a live pid, with no stopping note, is running", () => {
    const standing = daemonStanding({ checkpoint: checkpointAt(20_000), lastNote: startedNote, nowMs: NOW, alive: () => true });
    expect(standing.state).toBe("running");
  });

  test("a live pid that has stopped writing is stalled, not running", () => {
    // THE FAILURE THIS WHOLE TOOL IS ABOUT. The process is there, the register
    // renders perfectly, and nothing has been written for a quarter of an hour.
    // AN ABSOLUTE AGE, not `STALL_AFTER_MS + 1`. The self-referential form is
    // green for any value of the constant, which is how a threshold raised to
    // thirty hours survived the first mutation sweep of this file.
    expect(STALL_AFTER_MS).toBeLessThanOrEqual(120_000);
    const standing = daemonStanding({ checkpoint: checkpointAt(15 * 60_000), lastNote: startedNote, nowMs: NOW, alive: () => true });
    expect(standing.state).toBe("stalled");
    expect(standing.detail).toContain("has not written");
    expect(daemonStanding({ checkpoint: checkpointAt(STALL_AFTER_MS + 1_000), lastNote: startedNote, nowMs: NOW, alive: () => true }).state).toBe("stalled");
  });

  test("a stopping note means it went on purpose, whatever the pid says", () => {
    // A pid is reusable, so "the pid is alive" is weak evidence on its own; the
    // daemon's own last word is not.
    const standing = daemonStanding({ checkpoint: checkpointAt(20_000), lastNote: stoppedNote, nowMs: NOW, alive: () => true });
    expect(standing.state).toBe("stopped");
  });

  test("no stopping note and a pid that is gone is a kill, and says so", () => {
    const standing = daemonStanding({ checkpoint: checkpointAt(20_000), lastNote: startedNote, nowMs: NOW, alive: () => false });
    expect(standing.state).toBe("killed");
    expect(standing.detail).toContain("4242");
  });
});

describe("reading the event log without disturbing the daemon", () => {
  test("the tail is the last N events, and unreadable lines are counted", () => {
    const root = tempRoot();
    const events: OverseerEvent[] = [1, 2, 3].map((n) => ({
      kind: "tmux-session-gone",
      at: `2026-09-08T07:0${n}:00.000Z`,
      tmuxServerPid: 132280,
      key: `$${n} none` as OverseerEvent["key"],
      identity: { tmuxId: `$${n}`, claimedConversationId: null },
      name: `session-${n}`,
      why: "absent-from-snapshot",
    }));
    writeFileSync(
      join(root, EVENTS_FILE),
      `${events.map((e) => JSON.stringify(e)).join("\n")}\n{"kind":"nonsense"}\nnot json at all\n`,
    );
    const read = readEventTail(root, 2);
    expect(read.total).toBe(3);
    expect(read.events.map((e) => (e.kind === "tmux-session-gone" ? e.name : ""))).toEqual(["session-2", "session-3"]);
    expect(read.unreadable).toBe(2);
  });

  test("no log at all reads as empty rather than throwing", () => {
    expect(readEventTail(tempRoot(), 10)).toEqual({ events: [], unreadable: 0, total: 0 });
  });

  test("every event kind renders as a sentence naming the session", () => {
    const gone: OverseerEvent = {
      kind: "tmux-session-gone",
      at: "2026-09-08T07:01:00.000Z",
      tmuxServerPid: 132280,
      key: "$1 none" as OverseerEvent["key"],
      identity: { tmuxId: "$1", claimedConversationId: null },
      name: "overseer-o1-store",
      why: "tmux-server-changed",
    };
    const line = describeEvent(gone);
    expect(line).toContain("overseer-o1-store");
    expect(line).not.toContain("[object Object]");
  });

  test("a row change says WHICH fields moved, not just that something did", () => {
    // "changed" on its own is unreadable: a rename and a move to another
    // worktree are the same event kind, and the field list is the only thing in
    // the line that tells a person which one happened.
    const changed: OverseerEvent = {
      kind: "session-row-changed",
      at: "2026-09-08T07:01:00.000Z",
      tmuxServerPid: 132280,
      key: "$1 none" as OverseerEvent["key"],
      identity: { tmuxId: "$1", claimedConversationId: null },
      fields: ["name", "worktree"],
      row: {
        id: "$1",
        name: "renamed-by-a-person",
        title: null,
        repo: "spideryarn/reading2",
        worktree: "somewhere-else",
        meta: { version: "legacy" },
        startedAt: "2026-09-08T07:00:00.000Z",
        paneId: "%1",
        panePid: 4242,
        claimedConversationId: null,
        question: null,
        status: { kind: "idle" },
      },
    };
    const line = describeEvent(changed);
    expect(line).toContain("renamed-by-a-person");
    expect(line).toContain("name, worktree");
    expect(line).not.toContain("[object Object]");
  });

  test("a pane replacement names both pids, because that is the whole fact", () => {
    const pane: OverseerEvent = {
      kind: "session-pane-replaced",
      at: "2026-09-08T07:01:00.000Z",
      tmuxServerPid: 132280,
      key: "$1 none" as OverseerEvent["key"],
      identity: { tmuxId: "$1", claimedConversationId: null },
      previousPaneId: "%1",
      previousPanePid: 4242,
      paneId: "%2",
      panePid: 5353,
    };
    const line = describeEvent(pane);
    expect(line).toContain("4242");
    expect(line).toContain("5353");
    expect(line).not.toContain("[object Object]");
  });
});

describe("the status page a person actually reads", () => {
  test("an empty store says so in words rather than rendering an empty fleet", () => {
    const lines = statusLines(tempRoot(), NOW).join("\n");
    // AN EMPTY REGISTER AND A DEAD DAEMON MUST NOT LOOK ALIKE. "0 sessions" over
    // a store nothing has ever written is the reading least likely to make
    // anyone look.
    expect(lines).toContain("never run");
    expect(lines).not.toMatch(/^sessions\s+0 /m);
  });

  test("a relative store directory is refused rather than resolved", () => {
    // Two starts from two working directories would take two different locks
    // and write two plausible histories — Sol's S3-07.
    expect(() => statusLines("relative/path", NOW)).toThrow(/absolute/);
  });
});
