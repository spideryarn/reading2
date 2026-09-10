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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { STALL_AFTER_MS, daemonStanding, describeEvent, readEventTail, statusLines } from "../tools/overseer/status-cli.js";
import type { SessionEvent } from "../tools/overseer/diff.js";
import {
  CHECKPOINT_FILE,
  EVENTS_FILE,
  STORE_SCHEMA,
  attentionNotYetRun,
  schedulerNotYetSaid,
  usageNotYetRun,
  workNotYetRun,
  type Checkpoint,
  type CheckpointRead,
  type RegisterEntry,
  type StatusSince,
} from "../tools/overseer/store.js";
import type { DaemonNote } from "../tools/overseer/notes.js";
import { NOTES_FILE } from "../tools/overseer/notes.js";
import { runParsed } from "../scripts/overseer.js";

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
    work: workNotYetRun(new Date(NOW - agoMs).toISOString()),
    // Same reasoning one field down: a daemon with no usage pass wired in
    // publishes "nothing has looked", never a report saying no limits were found.
    usage: usageNotYetRun(new Date(NOW - agoMs).toISOString()),
    scheduler: schedulerNotYetSaid(new Date(NOW - agoMs).toISOString()),
    snapshotStaleAfterMs: null,
    occurrenceHistory: null,
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
    // Never verified: this entry was built by hand, and null is what the
    // register holds for a session whose run nothing has confirmed.
    verifiedExecution: null,
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
    const standing = daemonStanding({ read: { kind: "absent" }, notes: [], nowMs: NOW, alive: () => true });
    expect(standing.state).toBe("never-run");
  });

  test("a fresh checkpoint from a live pid, with no stopping note, is running", () => {
    const standing = daemonStanding({ read: reads(checkpointAt(20_000)), notes: [startedNote], nowMs: NOW, alive: () => true });
    expect(standing.state).toBe("running");
  });

  test("a live pid that has stopped writing is stalled, not running", () => {
    // THE FAILURE THIS WHOLE TOOL IS ABOUT. The process is there, the register
    // renders perfectly, and nothing has been written for a quarter of an hour.
    // AN ABSOLUTE AGE, not `STALL_AFTER_MS + 1`. The self-referential form is
    // green for any value of the constant, which is how a threshold raised to
    // thirty hours survived the first mutation sweep of this file.
    expect(STALL_AFTER_MS).toBeLessThanOrEqual(120_000);
    const standing = daemonStanding({ read: reads(checkpointAt(15 * 60_000)), notes: [startedNote], nowMs: NOW, alive: () => true });
    expect(standing.state).toBe("stalled");
    expect(standing.detail).toContain("has not written");
    expect(daemonStanding({ read: reads(checkpointAt(STALL_AFTER_MS + 1_000)), notes: [startedNote], nowMs: NOW, alive: () => true }).state).toBe("stalled");
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
      notes: [startedNote],
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
    const standing = daemonStanding({ read: reads(checkpointAt(20_000)), notes: [stoppedNote], nowMs: NOW, alive: () => true });
    expect(standing.state).toBe("stopped");
  });

  test("no stopping note and a pid that is gone is a kill, and says so", () => {
    const standing = daemonStanding({ read: reads(checkpointAt(20_000)), notes: [startedNote], nowMs: NOW, alive: () => false });
    expect(standing.state).toBe("killed");
    expect(standing.detail).toContain("4242");
  });
});

describe("a stop closes only its own start: standing by instance, not by the last note", () => {
  // GPT Sol's F3 on plan 260910f. The checkpoint names ONE instance; the notes
  // log spans restarts. Reading the log's last line as if it described the
  // checkpoint pairs one process's clean stop with another's checkpoint.
  // Through the real readers, from files, with a pid above Linux's pid_max so
  // "gone" does not depend on what happens to be running on the box.
  const DEAD_PID = 2 ** 30;
  const startOf = (instanceId: string, at: string, pid = DEAD_PID): DaemonNote => ({ ...startedNote, instanceId, at, pid });
  const stopOf = (instanceId: string, at: string): DaemonNote => ({ kind: "daemon-stopped", at, instanceId, why: "SIGTERM" });

  function storeWith(notes: DaemonNote[]): string {
    const root = tempRoot();
    writeFileSync(join(root, CHECKPOINT_FILE), JSON.stringify(checkpointAt(20 * 60_000, DEAD_PID)));
    writeFileSync(join(root, NOTES_FILE), notes.map((note) => `${JSON.stringify(note)}\n`).join(""));
    return root;
  }
  const daemonLine = (root: string): string => statusLines(root, NOW).find((line) => line.startsWith("daemon")) ?? "";

  test("A checkpointed and was killed; B started and stopped before its first checkpoint", () => {
    const line = daemonLine(
      storeWith([startOf("i1", "2026-09-08T07:00:00.000Z"), startOf("i2", "2026-09-08T07:50:00.000Z"), stopOf("i2", "2026-09-08T07:51:00.000Z")]),
    );
    // B's clean stop is B's; it says nothing about the checkpoint, which is A's.
    expect(line).not.toMatch(/stopped on purpose at [^;]*; the last checkpoint/);
    expect(line).toContain("instance i2 started at 2026-09-08T07:50:00.000Z");
    expect(line).toContain("without writing a checkpoint");
    expect(line).toContain("the checkpoint on disk is instance i1's");
    // And A is not dressed up as having stopped cleanly.
    expect(line).toMatch(/i1 wrote no stopping note/);
  });

  test("B started and was killed before its first checkpoint, after A stopped cleanly", () => {
    const line = daemonLine(
      storeWith([startOf("i1", "2026-09-08T07:00:00.000Z"), stopOf("i1", "2026-09-08T07:40:00.000Z"), startOf("i2", "2026-09-08T07:50:00.000Z")]),
    );
    expect(line).toMatch(/^daemon\s+KILLED/);
    expect(line).toContain("instance i2");
    expect(line).toContain("without writing a checkpoint");
    expect(line).toContain("i1 stopped on purpose");
  });

  test("A killed with no later instance still reads killed", () => {
    expect(daemonLine(storeWith([startOf("i1", "2026-09-08T07:00:00.000Z")]))).toMatch(/^daemon\s+KILLED — pid \d+ is gone/);
  });

  test("A stopped cleanly reads stopped", () => {
    expect(daemonLine(storeWith([startOf("i1", "2026-09-08T07:00:00.000Z"), stopOf("i1", "2026-09-08T07:59:00.000Z")]))).toMatch(
      /^daemon\s+STOPPED — stopped on purpose at 2026-09-08T07:59:00.000Z/,
    );
  });

  test("an OLDER instance's stop does not make the checkpoint's own instance stopped", () => {
    // i0 stopped, then i1 started, checkpointed and was killed: the last stop in
    // the log is i0's, and it closes only i0's start.
    const line = daemonLine(
      storeWith([startOf("i0", "2026-09-08T06:00:00.000Z"), stopOf("i0", "2026-09-08T06:30:00.000Z"), startOf("i1", "2026-09-08T07:00:00.000Z")]),
    );
    expect(line).toMatch(/^daemon\s+KILLED/);
  });
});

describe("reading the event log without disturbing the daemon", () => {
  test("an event log that cannot be read is reported by the reader, command and status", async () => {
    const root = tempRoot();
    const path = join(root, EVENTS_FILE);
    mkdirSync(path);

    expect(readEventTail(root, 40)).toMatchObject({ cause: expect.stringMatching(/EISDIR|directory/i) });
    expect(statusLines(root, NOW).join("\n")).toMatch(/events\s+UNREADABLE/);

    const saved = process.env.OVERSEER_STORE_DIR;
    process.env.OVERSEER_STORE_DIR = root;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const code = await runParsed({ command: "events", limit: 40 });
      expect(code).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringMatching(/events\.jsonl.*EISDIR|events\.jsonl.*directory/i));
    } finally {
      error.mockRestore();
      if (saved === undefined) delete process.env.OVERSEER_STORE_DIR;
      else process.env.OVERSEER_STORE_DIR = saved;
    }
  });

  test("the events command fails visibly when every complete line is malformed", async () => {
    const root = tempRoot();
    writeFileSync(join(root, EVENTS_FILE), "{not an event}\n");
    const saved = process.env.OVERSEER_STORE_DIR;
    process.env.OVERSEER_STORE_DIR = root;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = await runParsed({ command: "events", limit: 40 });
      expect(code).toBe(1);
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/1 unreadable line/));
      expect(log).not.toHaveBeenCalledWith(expect.stringMatching(/^no events/));
    } finally {
      log.mockRestore();
      if (saved === undefined) delete process.env.OVERSEER_STORE_DIR;
      else process.env.OVERSEER_STORE_DIR = saved;
    }
  });

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
      `${JSON.stringify(events[0])}\n{"kind":"nonsense"}\n${JSON.stringify(events[1])}\nnot json at all\n${JSON.stringify(events[2])}\n`,
    );
    const read = readEventTail(root, 2);
    expect(read.total).toBe(3);
    expect(read.events.map((e) => (e.kind === "tmux-session-gone" ? e.name : ""))).toEqual(["session-2", "session-3"]);
    expect(read.unreadable).toBe(2);
    expect(read.tornTail).toBeNull();
  });

  test("a malformed event of a known kind is refused before the renderer can dereference it", () => {
    const root = tempRoot();
    writeFileSync(
      join(root, EVENTS_FILE),
      `${JSON.stringify({
        kind: "session-seen",
        at: "2026-09-08T07:01:00.000Z",
        tmuxServerPid: 132280,
        key: "$1 none",
        identity: { tmuxId: "$1", claimedConversationId: null },
      })}\n`,
    );

    const read = readEventTail(root, 10);

    expect(read.events).toEqual([]);
    expect(read.unreadable).toBe(1);
    expect(() => read.events.map(describeEvent)).not.toThrow();
  });

  test("an unterminated final event is reported separately from corrupt complete lines", () => {
    const root = tempRoot();
    const complete = JSON.stringify({
      kind: "tmux-session-gone",
      at: "2026-09-08T07:01:00.000Z",
      tmuxServerPid: 132280,
      key: "$1 none",
      identity: { tmuxId: "$1", claimedConversationId: null },
      name: "overseer-o1-store",
      why: "absent-from-snapshot",
    });
    const torn = '{"kind":"tmux-session-gone","at":"2026-09-08T07:02';
    writeFileSync(join(root, EVENTS_FILE), `${complete}\n${torn}`);

    const read = readEventTail(root, 10);

    expect(read.total).toBe(1);
    expect(read.unreadable).toBe(0);
    expect(read.tornTail).toBe(torn);
  });

  test("no log at all reads as empty rather than throwing", () => {
    expect(readEventTail(tempRoot(), 10)).toEqual({ events: [], unreadable: 0, tornTail: null, total: 0, cause: null });
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
        execution: { kind: "unknown", cause: "not-reported", why: "the fixture carried no execution reading" },
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
  test("corrupt complete notes make standing and conditions unknown, and the notes command fails", async () => {
    const root = tempRoot();
    writeFileSync(join(root, NOTES_FILE), "{not a note}\n");

    const lines = statusLines(root, NOW).join("\n");
    expect(lines).toContain("CANNOT TELL");
    expect(lines).toMatch(/notes\s+UNREADABLE/);
    expect(lines).not.toContain("no checkpoint and no notes");
    expect(lines).not.toContain("conditions  all clear");

    const saved = process.env.OVERSEER_STORE_DIR;
    process.env.OVERSEER_STORE_DIR = root;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = await runParsed({ command: "notes", limit: 40 });
      expect(code).toBe(1);
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/1 unreadable line/));
      expect(log).not.toHaveBeenCalledWith("the Overseer has written nothing about itself yet");
    } finally {
      log.mockRestore();
      if (saved === undefined) delete process.env.OVERSEER_STORE_DIR;
      else process.env.OVERSEER_STORE_DIR = saved;
    }
  });

  test("unreadable daemon notes make standing unknown instead of looking like no notes", () => {
    const root = tempRoot();
    mkdirSync(join(root, NOTES_FILE));

    const lines = statusLines(root, NOW).join("\n");

    expect(lines).toContain("CANNOT TELL");
    expect(lines).toMatch(/notes\s+UNREADABLE/);
    expect(lines).not.toContain("no checkpoint and no notes");
    expect(lines).not.toContain("conditions  all clear");
  });

  test("the notes command prints a read failure and returns non-zero", async () => {
    const root = tempRoot();
    mkdirSync(join(root, NOTES_FILE));
    const saved = process.env["OVERSEER_STORE_DIR"];
    process.env["OVERSEER_STORE_DIR"] = root;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const code = await runParsed({ command: "notes", limit: 40 });
      expect(code).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringMatching(/daemon\.jsonl.*EISDIR|daemon\.jsonl.*directory/i));
    } finally {
      error.mockRestore();
      if (saved === undefined) delete process.env["OVERSEER_STORE_DIR"];
      else process.env["OVERSEER_STORE_DIR"] = saved;
    }
  });

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

  test("the scheduler gets a line of its own, and OFF is not the same sentence as ARMED", () => {
    // GPT Sol's C1, in the surface a person actually reads. Both states produce
    // an empty occurrence list and a green heartbeat, so if the page cannot say
    // which it is, nobody can — and "the scheduler is off" then looks exactly
    // like "the scheduler has nothing to do".
    const root = tempRoot();
    const at = new Date(NOW - 20_000).toISOString();
    writeFileSync(
      join(root, CHECKPOINT_FILE),
      JSON.stringify({ ...checkpointAt(20_000), scheduler: { kind: "off", why: "OVERSEER_JOBS_ENABLED is not \"1\"", at } }),
    );
    const off = statusLines(root, NOW).join("\n");
    expect(off).toMatch(/scheduler\s+OFF/);
    expect(off).toContain("OVERSEER_JOBS_ENABLED");

    writeFileSync(
      join(root, CHECKPOINT_FILE),
      JSON.stringify({ ...checkpointAt(20_000), scheduler: { kind: "armed", why: "get-ready-to-deploy, feedback-sweep", at } }),
    );
    const armed = statusLines(root, NOW).join("\n");
    expect(armed).toMatch(/scheduler\s+ARMED/);
    expect(armed).toContain("get-ready-to-deploy");
    expect(off).not.toBe(armed);
  });

  test("an armed scheduler that is HOLDING everything does not read as a quiet one", () => {
    // The two look identical from every other field: armed, ticking, no
    // occurrences. A held ledger means nothing has been dispatched and nothing
    // will be, so it gets its own line and the sentence that clears it.
    const root = tempRoot();
    const at = new Date(NOW - 20_000).toISOString();
    writeFileSync(
      join(root, CHECKPOINT_FILE),
      JSON.stringify({
        ...checkpointAt(20_000),
        scheduler: { kind: "armed", why: "get-ready-to-deploy, feedback-sweep", at },
        occurrenceHistory: { kind: "lost", why: "the event log could not be replayed (log-has-holes)" },
      }),
    );
    const lines = statusLines(root, NOW).join("\n");
    expect(lines).toContain("HOLDING EVERY JOB");
    expect(lines).toContain("log-has-holes");
    expect(lines).toContain("reconcile-jobs");
  });

  test("a checkpoint written before the scheduler existed says UNKNOWN, never OFF", () => {
    // Inventing "off" for an old checkpoint would be a claim about a daemon
    // nobody asked — the same mistake as reading an empty attention list as
    // "nothing needs you".
    const root = tempRoot();
    const { scheduler: _dropped, ...withoutScheduler } = checkpointAt(20_000);
    writeFileSync(join(root, CHECKPOINT_FILE), JSON.stringify(withoutScheduler));
    const lines = statusLines(root, NOW).join("\n");
    expect(lines).toMatch(/scheduler\s+UNKNOWN/);
  });

  test("an empty store says the scheduler is unknown rather than leaving the line out", () => {
    // A MISSING LINE READS AS FINE. Every other block on this page prints
    // something in every case for that reason.
    expect(statusLines(tempRoot(), NOW).join("\n")).toMatch(/scheduler\s+unknown/i);
  });

  test("a relative store directory is refused rather than resolved", () => {
    // Two starts from two working directories would take two different locks
    // and write two plausible histories — Sol's S3-07.
    expect(() => statusLines("relative/path", NOW)).toThrow(/absolute/);
  });
});
