/**
 * The Overseer's own condition, as a second log beside the fleet's history.
 *
 * **Every test here is about the difference between two silences.** A daemon
 * that has stopped hearing from the dashboard and a daemon watching a quiet box
 * write the same thing into `events.jsonl`: nothing. So the facts about the
 * Overseer itself have to be written down somewhere, once per edge — and the
 * edges are what these tests are about, because a condition that re-announces
 * itself every tick is one nobody reads, and a condition that never announces
 * its end is one that stays on the screen after the trouble is over.
 *
 * The torn-write sequence is repeated from tests/overseer-store.test.ts on
 * purpose: this is a SECOND append-only log, it gets torn by the same OOM kill,
 * and a test that only proves "a torn line is skipped" passes against the
 * design that concatenates the next event onto the corrupt bytes.
 */
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  NOTES_FILE,
  conditionTracker,
  describeNote,
  openConditions,
  openNoteLog,
  readNotes,
  type DaemonNote,
} from "../tools/overseer/notes.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-notes-test-"));
  roots.push(root);
  return root;
}

function started(at: string): DaemonNote {
  return {
    kind: "daemon-started",
    at,
    instanceId: "i1",
    pid: 4242,
    source: "http://127.0.0.1:8787",
    opening: "Started COLD (no-checkpoint)",
    baseline: "none",
  };
}

describe("the note log survives being cut off mid-line", () => {
  test("a torn final line is truncated on open, so the next note is not appended onto it", () => {
    const root = tempRoot();
    const path = join(root, NOTES_FILE);

    const first = openNoteLog(root);
    first.append(started("2026-09-08T07:00:00.000Z"));
    first.append({ kind: "condition-degraded", at: "2026-09-08T07:01:00.000Z", instanceId: "i1", condition: "poll", why: "connection refused" });
    first.close();

    // The OOM kill: the last line loses its tail and its newline.
    const whole = readFileSync(path, "utf8");
    truncateSync(path, whole.length - 20);
    expect(readFileSync(path, "utf8").endsWith("\n")).toBe(false);

    const second = openNoteLog(root);
    expect(second.repair.torn).toBe(true);
    second.append({ kind: "condition-restored", at: "2026-09-08T07:02:00.000Z", instanceId: "i1", condition: "poll", why: "a poll succeeded", degradedAt: "2026-09-08T07:01:00.000Z", forMs: 60_000 });
    second.append({ kind: "daemon-stopped", at: "2026-09-08T07:03:00.000Z", instanceId: "i1", why: "SIGTERM" });
    second.close();

    // THE WHOLE SEQUENCE, not just the read after the tear: a design that skips
    // the torn suffix on read but appends after it passes the first half of
    // this test and fails here.
    const read = readNotes(root);
    expect(read.kind).toBe("read");
    if (read.kind !== "read") throw new Error("expected readable notes");
    expect(read.unreadable).toBe(0);
    expect(read.tornTail).toBeNull();
    expect(read.notes.map((n) => n.kind)).toEqual(["daemon-started", "condition-restored", "daemon-stopped"]);
    for (const line of readFileSync(path, "utf8").split("\n").filter((l) => l !== "")) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  test("a line that is not a note is counted rather than swallowed", () => {
    const root = tempRoot();
    writeFileSync(join(root, NOTES_FILE), `${JSON.stringify(started("2026-09-08T07:00:00.000Z"))}\n`);
    appendFileSync(join(root, NOTES_FILE), `{"kind":"who-knows","at":"2026-09-08T07:00:01.000Z"}\n`);
    appendFileSync(
      join(root, NOTES_FILE),
      `${JSON.stringify({ kind: "daemon-stopped", at: "2026-09-08T07:00:02.000Z", instanceId: "i1", why: "done" })}\n`,
    );
    const read = readNotes(root);
    expect(read.kind).toBe("read");
    if (read.kind !== "read") throw new Error("expected readable notes");
    expect(read.notes.map((n) => n.kind)).toEqual(["daemon-started", "daemon-stopped"]);
    expect(read.unreadable).toBe(1);
    expect(read.tornTail).toBeNull();
  });

  test("an unterminated final note is reported separately from corrupt complete lines", () => {
    const root = tempRoot();
    const complete = `${JSON.stringify(started("2026-09-08T07:00:00.000Z"))}\n`;
    const torn = '{"kind":"condition-degraded","at":"2026-09-08T07:01';
    writeFileSync(join(root, NOTES_FILE), complete + torn);

    const read = readNotes(root);

    expect(read.kind).toBe("read");
    if (read.kind !== "read") throw new Error("expected readable notes");
    expect(read.notes.map((note) => note.kind)).toEqual(["daemon-started"]);
    expect(read.unreadable).toBe(0);
    expect(read.tornTail).toBe(torn);
  });

  test("a note log that cannot be read is not mistaken for an empty log", () => {
    const root = tempRoot();
    mkdirSync(join(root, NOTES_FILE));

    const read = readNotes(root);

    expect(read.kind).toBe("unreadable");
    if (read.kind !== "unreadable") throw new Error("expected an unreadable result");
    expect(read.cause).toMatch(/EISDIR|directory/i);
  });

  test("no note log at all reads as empty rather than throwing", () => {
    const read = readNotes(tempRoot());
    expect(read.kind).toBe("read");
    if (read.kind !== "read") throw new Error("expected readable notes");
    expect(read.notes).toEqual([]);
    expect(read.unreadable).toBe(0);
    expect(read.tornTail).toBeNull();
  });
});

describe("a condition is announced on its edges and nowhere else", () => {
  test("degrading twice writes one note, and restoring writes one that says how long it lasted", () => {
    const tracker = conditionTracker("i1");
    const first = tracker.degrade("sse-stream", "2026-09-08T07:00:00.000Z", "the stream ended");
    expect(first?.kind).toBe("condition-degraded");
    // The second collection, and the third, and the four hundredth.
    expect(tracker.degrade("sse-stream", "2026-09-08T07:01:00.000Z", "the stream ended")).toBeNull();
    expect(tracker.degrade("sse-stream", "2026-09-08T07:02:00.000Z", "the stream ended")).toBeNull();

    const back = tracker.restore("sse-stream", "2026-09-08T07:05:00.000Z", "the stream reconnected");
    expect(back).not.toBeNull();
    if (back?.kind !== "condition-restored") throw new Error("expected a restoration");
    expect(back.degradedAt).toBe("2026-09-08T07:00:00.000Z");
    expect(back.forMs).toBe(300_000);
    // And restoring something that was never degraded says nothing at all,
    // which is what every healthy tick does.
    expect(tracker.restore("sse-stream", "2026-09-08T07:06:00.000Z", "still fine")).toBeNull();
  });

  test("two causes with the same symptom do not collapse into one", () => {
    const tracker = conditionTracker("i1");
    tracker.degrade("sse-stream", "2026-09-08T07:00:00.000Z", "the stream ended");
    tracker.degrade("baseline", "2026-09-08T07:00:30.000Z", "the generation could not be read");
    expect(tracker.open().map((c) => c.condition).sort()).toEqual(["baseline", "sse-stream"]);

    // The stream comes back and the baseline is still held. A single degraded
    // flag would call this healthy.
    tracker.restore("sse-stream", "2026-09-08T07:01:00.000Z", "reconnected");
    expect(tracker.open().map((c) => c.condition)).toEqual(["baseline"]);
    expect(tracker.open()[0]?.since).toBe("2026-09-08T07:00:30.000Z");
  });
});

describe("what a reader makes of the log afterwards", () => {
  test("the conditions still open are the ones this instance degraded and did not restore", () => {
    const notes: DaemonNote[] = [
      started("2026-09-08T07:00:00.000Z"),
      { kind: "condition-degraded", at: "2026-09-08T07:01:00.000Z", instanceId: "i1", condition: "poll", why: "refused" },
      { kind: "condition-degraded", at: "2026-09-08T07:01:30.000Z", instanceId: "i1", condition: "freshness", why: "no collection for 6 minutes" },
      { kind: "condition-restored", at: "2026-09-08T07:02:00.000Z", instanceId: "i1", condition: "poll", why: "a poll succeeded", degradedAt: "2026-09-08T07:01:00.000Z", forMs: 60_000 },
    ];
    expect(openConditions(notes).map((c) => c.condition)).toEqual(["freshness"]);
  });

  test("a restart clears the conditions the previous instance left open", () => {
    const notes: DaemonNote[] = [
      started("2026-09-08T07:00:00.000Z"),
      { kind: "condition-degraded", at: "2026-09-08T07:01:00.000Z", instanceId: "i1", condition: "poll", why: "refused" },
      // kill -9: no restoration is ever written for that one.
      { ...started("2026-09-08T07:10:00.000Z"), instanceId: "i2" },
    ];
    // A NEW INSTANCE KNOWS NOTHING YET, and carrying the dead one's conditions
    // forward would show Greg a fault that belongs to a process that is gone.
    expect(openConditions(notes)).toEqual([]);
  });

  test("the ordering condition is a condition a reader recognises, not a rotted line", () => {
    // `readNotes` refuses a condition name it does not know and counts the line
    // as unreadable, which is the alarm that means the log is decaying. So a
    // new condition the daemon writes and the reader rejects would look like
    // corruption rather than like an alarm.
    const root = tempRoot();
    const log = openNoteLog(root);
    log.append(started("2026-09-08T07:00:00.000Z"));
    log.append({ kind: "condition-degraded", at: "2026-09-08T07:01:00.000Z", instanceId: "i1", condition: "ordering", why: "the stamp cannot be believed" });
    log.close();
    const read = readNotes(root);
    if (read.kind !== "read") throw new Error("expected readable notes");
    expect(read.unreadable).toBe(0);
    expect(openConditions(read.notes).map((c) => c.condition)).toEqual(["ordering"]);
  });

  test("every note renders as a sentence, so the CLI never prints a bare object", () => {
    const notes: DaemonNote[] = [
      started("2026-09-08T07:00:00.000Z"),
      { kind: "condition-degraded", at: "2026-09-08T07:01:00.000Z", instanceId: "i1", condition: "snapshots", why: "the dashboard's last collection failed" },
      { kind: "condition-restored", at: "2026-09-08T07:02:00.000Z", instanceId: "i1", condition: "snapshots", why: "a collection was accepted", degradedAt: "2026-09-08T07:01:00.000Z", forMs: 60_000 },
      { kind: "daemon-stopped", at: "2026-09-08T07:03:00.000Z", instanceId: "i1", why: "SIGTERM" },
    ];
    for (const note of notes) {
      const line = describeNote(note);
      expect(line).not.toContain("[object Object]");
      expect(line.length).toBeGreaterThan(10);
    }
  });
});
