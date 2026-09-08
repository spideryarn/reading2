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
import type { SessionEvent } from "../tools/overseer/diff.js";
import {
  CHECKPOINT_FILE,
  EVENTS_FILE,
  STORE_SCHEMA,
  attentionNotYetRun,
  usageNotYetRun,
  type Checkpoint,
  type CheckpointRead,
  type RegisterEntry,
  type StatusSince,
} from "../tools/overseer/store.js";
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
    schema: STORE_SCHEMA,
    writtenAt: new Date(NOW - agoMs).toISOString(),
    lastGoodSnapshotAt: new Date(NOW - agoMs).toISOString(),
    cursor: { events: 12, bytes: 900 },
    heartbeat: { pid, instanceId: "i1", startedAt: "2026-09-08T07:00:00.000Z", lastTickAt: new Date(NOW - agoMs).toISOString(), ticks: 100 },
    register: [],
    // A checkpoint from a daemon with no attention pass wired in. `unknown` is
    // what the store publishes then, and it is not the same as an empty list:
    // *nothing has looked* rather than *nothing needs you*.
    attention: attentionNotYetRun(new Date(NOW - agoMs).toISOString()),
    // Same reasoning one field down: a daemon with no usage pass wired in
    // publishes "nothing has looked", never a report saying no limits were found.
    usage: usageNotYetRun(new Date(NOW - agoMs).toISOString()),
    jobs: { occurrences: [] },
  };
}

/**
 * One waiting session, as the register holds it — built by hand rather than by
 * folding events, because what is under test here is the RENDERER and a fold
 * would only be able to produce the arms the fold already believes in.
 */
function waitingEntry(tmuxId: string, name: string, statusSince: StatusSince): RegisterEntry {
  return {
    key: `${tmuxId} none` as RegisterEntry["key"],
    tmuxId,
    claimedConversationId: null,
    name,
    meta: { version: "legacy" },
    repo: "spideryarn/reading2",
    worktree: name,
    startedAt: "2026-09-08T05:00:00.000Z",
    paneId: "%1",
    panePid: 4242,
    tmuxServerPid: 132280,
    lastSeenAlive: "2026-09-08T07:59:00.000Z",
    lastStatusKey: "waiting" as RegisterEntry["lastStatusKey"],
    statusSince,
  };
}

/** The reader's outcome for a checkpoint it could read. */
function reads(checkpoint: Checkpoint): CheckpointRead {
  return { kind: "checkpoint", checkpoint };
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
    const standing = daemonStanding({ read: { kind: "absent" }, lastNote: null, nowMs: NOW, alive: () => true });
    expect(standing.state).toBe("never-run");
  });

  test("a fresh checkpoint from a live pid, with no stopping note, is running", () => {
    const standing = daemonStanding({ read: reads(checkpointAt(20_000)), lastNote: startedNote, nowMs: NOW, alive: () => true });
    expect(standing.state).toBe("running");
  });

  test("a live pid that has stopped writing is stalled, not running", () => {
    // THE FAILURE THIS WHOLE TOOL IS ABOUT. The process is there, the register
    // renders perfectly, and nothing has been written for a quarter of an hour.
    // AN ABSOLUTE AGE, not `STALL_AFTER_MS + 1`. The self-referential form is
    // green for any value of the constant, which is how a threshold raised to
    // thirty hours survived the first mutation sweep of this file.
    expect(STALL_AFTER_MS).toBeLessThanOrEqual(120_000);
    const standing = daemonStanding({ read: reads(checkpointAt(15 * 60_000)), lastNote: startedNote, nowMs: NOW, alive: () => true });
    expect(standing.state).toBe("stalled");
    expect(standing.detail).toContain("has not written");
    expect(daemonStanding({ read: reads(checkpointAt(STALL_AFTER_MS + 1_000)), lastNote: startedNote, nowMs: NOW, alive: () => true }).state).toBe("stalled");
  });

  test("a checkpoint this build cannot read is CANNOT TELL, never NEVER RUN", () => {
    // THE DEFECT THIS STAGE IS ABOUT, POINTED AT THE STAGE ITSELF. `statusSince`
    // grew two arms so that a floor could not be rendered as a measurement — and
    // one screen away, this renderer was taking *I cannot parse the checkpoint*
    // and printing *the Overseer has never run*. It was seen live: the daemon
    // had been up for eighty minutes and had written `current.json` thirty
    // seconds earlier, in schema 1, which this build correctly refuses.
    //
    // The direction matters. overseer-direction.md names the failure this
    // whole project is designed against — the Overseer silently dead while the
    // page says nothing needs you. This is that inverted, and no better: a
    // person who reads NEVER RUN goes and starts a second daemon.
    const standing = daemonStanding({
      read: { kind: "unusable", why: "checkpoint-malformed", detail: "schema 1 is not 2" },
      lastNote: startedNote,
      nowMs: NOW,
      alive: () => true,
    });

    expect(standing.state).toBe("cannot-tell");
    expect(standing.detail).toContain("schema 1 is not 2");
    // It says what this build reads, because the person is deciding whether the
    // fix is to restart the daemon or to update the reader.
    expect(standing.detail).toContain(String(STORE_SCHEMA));
    // AND IT DOES NOT GUESS, in either direction.
    expect(standing.detail).not.toMatch(/never/i);
    expect(standing.detail).toMatch(/may (well )?be running/i);
  });

  test("a stopping note means it went on purpose, whatever the pid says", () => {
    // A pid is reusable, so "the pid is alive" is weak evidence on its own; the
    // daemon's own last word is not.
    const standing = daemonStanding({ read: reads(checkpointAt(20_000)), lastNote: stoppedNote, nowMs: NOW, alive: () => true });
    expect(standing.state).toBe("stopped");
  });

  test("no stopping note and a pid that is gone is a kill, and says so", () => {
    const standing = daemonStanding({ read: reads(checkpointAt(20_000)), lastNote: startedNote, nowMs: NOW, alive: () => false });
    expect(standing.state).toBe("killed");
    expect(standing.detail).toContain("4242");
  });
});

describe("reading the event log without disturbing the daemon", () => {
  test("the tail is the last N events, and unreadable lines are counted", () => {
    const root = tempRoot();
    const events: SessionEvent[] = [1, 2, 3].map((n) => ({
      kind: "tmux-session-gone",
      at: `2026-09-08T07:0${n}:00.000Z`,
      tmuxServerPid: 132280,
      key: `$${n} none` as SessionEvent["key"],
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
    const gone: SessionEvent = {
      kind: "tmux-session-gone",
      at: "2026-09-08T07:01:00.000Z",
      tmuxServerPid: 132280,
      key: "$1 none" as SessionEvent["key"],
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
    const changed: SessionEvent = {
      kind: "session-row-changed",
      at: "2026-09-08T07:01:00.000Z",
      tmuxServerPid: 132280,
      key: "$1 none" as SessionEvent["key"],
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
    const pane: SessionEvent = {
      kind: "session-pane-replaced",
      at: "2026-09-08T07:01:00.000Z",
      tmuxServerPid: 132280,
      key: "$1 none" as SessionEvent["key"],
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

  test("a floor and a measurement are not printed as the same number", () => {
    // THE BUG THAT STARTED S7-04, in the surface it was seen on: four rows of
    // `13m` against sessions that had been working for hours, because the
    // daemon had been up for thirteen minutes. A renderer cannot tell the two
    // apart from a bare timestamp, so it showed the floor as a fact.
    //
    // AN ABSOLUTE COMPARISON, not one computed from the entries: the point is
    // that the same elapsed time renders differently depending on the arm, and
    // an expectation derived from the arm would hold whatever the renderer did.
    const root = tempRoot();
    const checkpoint: Checkpoint = {
      ...checkpointAt(20_000),
      register: [
        waitingEntry("$1", "already-blocked-when-we-looked", {
          kind: "lower-bound",
          at: new Date(NOW - 13 * 60_000).toISOString(),
        }),
        waitingEntry("$2", "we-watched-it-block", {
          kind: "observed",
          at: new Date(NOW - 40 * 60_000).toISOString(),
        }),
      ],
    };
    writeFileSync(join(root, CHECKPOINT_FILE), JSON.stringify(checkpoint));

    const lines = statusLines(root, NOW).join("\n");

    // THE ORDER, not just the presence: the 40m entry is written second in the
    // register on purpose, so a renderer with no comparator — or a reversed one —
    // leaves them the other way round and this fails. Attention triage IS the
    // ordering; a list with the right rows in the wrong order is the feature not
    // working.
    expect(lines.indexOf("we-watched-it-block")).toBeLessThan(lines.indexOf("already-blocked-when-we-looked"));
    expect(lines).toContain("we-watched-it-block");
    expect(lines).toContain("already-blocked-when-we-looked");
    expect(lines).toMatch(/≥13m\s+already-blocked-when-we-looked/);
    expect(lines).toMatch(/[^≥]40m\s+we-watched-it-block/);
    // And a reader who has never heard of any of this is told what the mark means.
    expect(lines).toContain("floor");
  });

  test("a real schema-1 checkpoint renders as unreadable, not as a fleet that never ran", () => {
    // End to end, through the real reader, with the file that actually exists on
    // the box: every `current.json` written before 2026-09-08 is schema 1.
    const root = tempRoot();
    writeFileSync(join(root, CHECKPOINT_FILE), JSON.stringify({ ...checkpointAt(20_000), schema: 1 }));

    const lines = statusLines(root, NOW).join("\n");

    expect(lines).toContain("CANNOT TELL");
    expect(lines).not.toContain("NEVER RUN");
    // The two other lines that were false for the same reason: nothing had been
    // collected, and no register was mentioned at all.
    expect(lines).not.toContain("nothing has been collected yet");
    expect(lines).toMatch(/sessions\s+unknown/);
  });

  test("a relative store directory is refused rather than resolved", () => {
    // Two starts from two working directories would take two different locks
    // and write two plausible histories — Sol's S3-07.
    expect(() => statusLines("relative/path", NOW)).toThrow(/absolute/);
  });
});
