/**
 * The daemon's start stamp: which revision the Overseer daemon was started
 * from, written once into its `daemon-started` note (docs/plans/260910f D2).
 *
 * Its own file rather than more of `overseer-daemon.test.ts`, which is about
 * the watchdog. The harness is the same shape — a temp store root, a clock the
 * test moves, a scripted source — copied rather than imported, because a test
 * file importing another test file couples two suites nobody will think to run
 * together. Every store root is a temp directory: `~/.overseer` is never
 * touched.
 *
 * The reading side matters as much as the writing side. The live daemon's log
 * is full of start notes written before this field existed, and a malformed
 * field must never cost the start note itself — that note is what clears a dead
 * instance's open conditions (`openConditions`).
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { StartRevision } from "../tools/fleet/wire.js";
import { runOverseer, type DaemonOptions } from "../tools/overseer/daemon.js";
import { describeNote, NOTES_FILE, readNotes, type DaemonNote } from "../tools/overseer/notes.js";
import type { SourceMessage } from "../tools/overseer/source.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-daemon-revision-test-"));
  roots.push(root);
  return root;
}

function fakeClock(startIso: string): { now: () => Date } {
  const ms = Date.parse(startIso);
  return { now: () => new Date(ms) };
}

/** One daemon over a source that ends at once, so the run stops by itself. */
async function run(root: string, revision?: DaemonOptions["revision"]): Promise<DaemonNote[]> {
  const controller = new AbortController();
  // A source with nothing to say: it ends at once, and the daemon stops.
  async function* silent(): AsyncGenerator<SourceMessage> {}
  const outcome = await runOverseer({
    root,
    baseUrl: "http://127.0.0.1:0",
    signal: controller.signal,
    now: fakeClock("2026-09-10T12:00:00.000Z").now,
    tickMs: 5,
    log: () => undefined,
    source: () => silent(),
    ...(revision === undefined ? {} : { revision }),
  });
  expect(outcome.kind).toBe("stopped");
  const read = readNotes(root);
  if (read.kind === "unreadable") throw new Error(read.cause);
  return read.notes;
}

function startNote(notes: readonly DaemonNote[]): Extract<DaemonNote, { kind: "daemon-started" }> {
  const note = notes.find((n) => n.kind === "daemon-started");
  if (note?.kind !== "daemon-started") throw new Error("expected a start note");
  return note;
}

const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

describe("the daemon stamps its start note", () => {
  test("with the revision it was given", async () => {
    const revision: StartRevision = { kind: "known", sha: SHA, dirty: true, readAt: "2026-09-10T11:59:59.000Z" };
    const note = startNote(await run(tempRoot(), revision));
    expect(note.revision).toEqual(revision);
    expect(describeNote(note)).toContain("revision a1b2c3d4+dirty");
  });

  test("and an unknown revision is written as unknown, with its reason", async () => {
    const revision: StartRevision = { kind: "unknown", why: "git rev-parse HEAD exited 128", readAt: "2026-09-10T11:59:59.000Z" };
    const note = startNote(await run(tempRoot(), revision));
    expect(note.revision).toEqual(revision);
    expect(describeNote(note)).toContain("revision unknown: git rev-parse HEAD exited 128");
  });

  test("and, given none, reads one itself rather than writing none", async () => {
    // The default is the real read of the checkout this module sits in. Which
    // arm it lands in depends on where the suite runs; that there IS one does not.
    const note = startNote(await run(tempRoot()));
    expect(note.revision).toBeDefined();
    expect(["known", "unknown"]).toContain(note.revision?.kind);
  });
});

describe("reading start notes, old and damaged", () => {
  function writeNotes(root: string, notes: readonly Record<string, unknown>[]): void {
    writeFileSync(join(root, NOTES_FILE), notes.map((n) => `${JSON.stringify(n)}\n`).join(""));
  }

  const oldShape = (): Record<string, unknown> => ({
    kind: "daemon-started",
    at: "2026-09-09T08:00:00.000Z",
    instanceId: randomUUID(),
    pid: 4242,
    source: "http://127.0.0.1:8787",
    opening: "cold start.",
    baseline: "no stored snapshot",
  });

  test("a note written before stamps existed is still a start note, with no revision", () => {
    const root = tempRoot();
    writeNotes(root, [oldShape()]);
    const read = readNotes(root);
    if (read.kind !== "read") throw new Error("expected a read");
    expect(read.unreadable).toBe(0);
    const note = startNote(read.notes);
    expect(note.revision).toBeUndefined();
    expect(describeNote(note)).not.toContain("revision");
  });

  test("a malformed revision costs the revision, never the start note", () => {
    const root = tempRoot();
    const at = "2026-09-09T09:00:00.000Z";
    writeNotes(root, [
      { ...oldShape(), at, revision: { kind: "known", sha: 5 } },
      { ...oldShape(), at, revision: "a1b2c3d4" },
      { ...oldShape(), at, revision: { kind: "known", sha: SHA, dirty: "yes", readAt: at } },
      { ...oldShape(), at, revision: { kind: "unknown", readAt: at } },
    ]);
    const read = readNotes(root);
    if (read.kind !== "read") throw new Error("expected a read");
    expect(read.unreadable).toBe(0);
    expect(read.notes).toHaveLength(4);
    for (const note of read.notes) {
      if (note.kind !== "daemon-started") throw new Error("expected start notes");
      expect(note.revision).toEqual({ kind: "unknown", why: "the note's revision field could not be read", readAt: at });
    }
  });

  test("a well-formed revision reads back as written", () => {
    const root = tempRoot();
    const revision: StartRevision = { kind: "known", sha: SHA, dirty: false, readAt: "2026-09-09T07:59:59.000Z" };
    writeNotes(root, [{ ...oldShape(), revision }]);
    const read = readNotes(root);
    if (read.kind !== "read") throw new Error("expected a read");
    const note = startNote(read.notes);
    expect(note.revision).toEqual(revision);
    expect(describeNote(note)).toContain("revision a1b2c3d4");
    expect(describeNote(note)).not.toContain("+dirty");
  });
});
