/**
 * The Overseer's own condition: a second append-only log, beside the fleet's.
 *
 * `events.jsonl` is the history of the FLEET — every arm of `OverseerEvent` is
 * about one session, keyed by one session, and folded into a register of
 * sessions. This file is the history of the OVERSEER: the stream dropped, the
 * poll failed, no fresh collection arrived for six minutes, the generation went
 * unreadable so the baseline is held.
 *
 * ## Why a second file rather than a sixth event arm
 *
 * Three reasons, and the first two are decisions somebody else already made.
 *
 *  - **`diff.ts` refused the arm, on purpose.** Its `DiffOutcome` carries
 *    `held` rather than emitting a degradation event, because *"every arm of
 *    `OverseerEvent` is about one session and this is about the Overseer's own
 *    condition — an arm with no session in it would be the first thing to make
 *    that union incoherent"*. That reasoning does not stop at `held`; it
 *    applies to every fact on this page.
 *  - **`store.ts` would call such a record a rotted line.** `parseEventLog`
 *    keeps only the kinds in its `EVENT_KINDS` map and counts everything else
 *    as `unreadableLines` — a signal that exists to say the log is decaying.
 *    Writing a foreign shape into that file would set off the alarm that means
 *    something else entirely.
 *  - **`foldEvents` is total over `OverseerEvent`** and folds every arm into
 *    the session register. A daemon-level arm would fold into nothing, which is
 *    a `default:` case in a function whose exhaustiveness is the thing keeping
 *    the register honest.
 *
 * So: two files, two subjects, and neither can corrupt the other's integrity
 * checks. The cost is that a reader wanting one timeline has to merge them by
 * timestamp, which `scripts/overseer.ts` does.
 *
 * ## Edges, not levels
 *
 * A condition is written down when it STARTS and when it ENDS, and never in
 * between. The alternative — a line per tick while degraded — is the failure
 * GPT Astra's A17 names: an alarm that is usually shouting is one Greg learns
 * to scroll past, and a log where nothing stands out is the same picture as a
 * log where nothing is wrong. `conditionTracker` is the whole of that rule and
 * it is why `degrade()` returns null the second time.
 *
 * Nothing here talks to the network and nothing at module scope does anything.
 */
import { closeSync, existsSync, fstatSync, ftruncateSync, openSync, readFileSync, readSync, writeSync } from "node:fs";
import { join } from "node:path";

/** Beside `events.jsonl` and `current.json`, in the same store root. */
export const NOTES_FILE = "daemon.jsonl";

/**
 * The ways the Overseer can stop knowing what the fleet is doing.
 *
 * **SIX NAMES, NOT ONE FLAG**, and that is the point of the type. They have
 * one symptom — no new history — and six different causes, and a single
 * `degraded: boolean` would let the second one overwrite the first, so that
 * curing the stream would report the box healthy while the baseline was still
 * held. Every one of them is independently open and independently closed.
 *
 *  - `sse-stream` — the preferred transport is down. Not on its own a loss of
 *    knowledge: the poll below is what covers it, and both being open at once
 *    is the case that is.
 *  - `poll` — the fallback failed while it was the only transport left.
 *  - `snapshots` — payloads are arriving and none is admissible: the
 *    dashboard's own collection is failing, or its clock went backwards, or the
 *    body did not parse.
 *  - `freshness` — the transport is fine, payloads arrive, and none of them is
 *    a NEW collection. The collector wedged rather than the pipe breaking, and
 *    this is the only condition that can see it.
 *  - `baseline` — `diff()` held: a snapshot with sessions in it and no readable
 *    tmux generation cannot be placed in a world, so the baseline stays where
 *    it was and the history waits.
 *  - `collector` — the dashboard is answering and has not STARTED a collection
 *    inside the deadline. Not a sixth name for `freshness`: attempts advancing
 *    while collections do not is a source that is failing and will say why,
 *    where both frozen is a collector that has stopped and will not. Measured
 *    on 2026-09-08 — a `collectedAt` thirty minutes stale with `error: null` —
 *    and invisible until the producer added `attemptedAt` for it.
 */
export type OverseerCondition = "sse-stream" | "poll" | "snapshots" | "freshness" | "baseline" | "collector";

const CONDITIONS: Record<OverseerCondition, true> = {
  "sse-stream": true,
  poll: true,
  snapshots: true,
  freshness: true,
  baseline: true,
  collector: true,
};

/**
 * One line of the daemon's own history.
 *
 * `instanceId` is on every arm because this log spans restarts and the
 * checkpoint's does not: a condition opened by a process that was killed must
 * not be read as a condition of the one running now — see `openConditions`.
 */
export type DaemonNote =
  | {
      kind: "daemon-started";
      at: string;
      instanceId: string;
      pid: number;
      /** The dashboard this instance was pointed at. A daemon watching the wrong port is a daemon that sees nothing. */
      source: string;
      /** `describeOpening()` from the store: cold, rebuilt or resumed, in words. */
      opening: string;
      /** What happened to the diff baseline: restored from a stored snapshot, or not, and why. */
      baseline: string;
    }
  | { kind: "daemon-stopped"; at: string; instanceId: string; why: string }
  | { kind: "condition-degraded"; at: string; instanceId: string; condition: OverseerCondition; why: string }
  | {
      kind: "condition-restored";
      at: string;
      instanceId: string;
      condition: OverseerCondition;
      why: string;
      degradedAt: string;
      /** How long it was open. The number Greg actually wants: "deaf for four minutes" beats two timestamps. */
      forMs: number;
    };

export type OpenCondition = { condition: OverseerCondition; since: string; why: string };

/**
 * Holds which conditions are open, and answers with the note to write — or
 * null, which means "nothing has changed and nothing should be said".
 *
 * A tracker rather than a set of booleans in the daemon, so that the
 * write-once rule cannot be re-implemented slightly differently at each call
 * site.
 */
export type ConditionTracker = {
  open(): readonly OpenCondition[];
  isOpen(condition: OverseerCondition): boolean;
  degrade(condition: OverseerCondition, at: string, why: string): DaemonNote | null;
  restore(condition: OverseerCondition, at: string, why: string): DaemonNote | null;
};

export function conditionTracker(instanceId: string): ConditionTracker {
  const open = new Map<OverseerCondition, OpenCondition>();
  return {
    open: () => [...open.values()],
    isOpen: (condition) => open.has(condition),
    degrade(condition, at, why) {
      if (open.has(condition)) return null;
      open.set(condition, { condition, since: at, why });
      return { kind: "condition-degraded", at, instanceId, condition, why };
    },
    restore(condition, at, why) {
      const was = open.get(condition);
      if (was === undefined) return null;
      open.delete(condition);
      return {
        kind: "condition-restored",
        at,
        instanceId,
        condition,
        why,
        degradedAt: was.since,
        // Both are ISO strings from the same clock, so this is a subtraction
        // rather than a measurement. A negative one would mean the daemon's own
        // clock moved, which is worth seeing rather than clamping away.
        forMs: Date.parse(at) - Date.parse(was.since),
      };
    },
  };
}

/**
 * Which conditions the CURRENT instance has open, replayed from the log.
 *
 * **A `daemon-started` clears everything.** A `kill -9` while the poll was
 * failing leaves a degradation with no restoration after it, for ever, and a
 * reader that carried it forward would show Greg a fault belonging to a process
 * that no longer exists — the same shape as a stale reading rendering as a
 * current one. The new instance has not looked yet; it says nothing until it
 * has.
 */
export function openConditions(notes: readonly DaemonNote[]): readonly OpenCondition[] {
  const open = new Map<OverseerCondition, OpenCondition>();
  for (const note of notes) {
    switch (note.kind) {
      case "daemon-started":
        open.clear();
        break;
      case "daemon-stopped":
        // A CLEAN STOP IS NOT A CURE, so it clears nothing. "The daemon stopped
        // while the stream was down" is worth being able to read, and the
        // reader is told separately — by the checkpoint's heartbeat — that
        // nothing is running now. Only a NEW instance clears these, because
        // only a new instance genuinely does not know yet.
        break;
      case "condition-degraded":
        open.set(note.condition, { condition: note.condition, since: note.at, why: note.why });
        break;
      case "condition-restored":
        open.delete(note.condition);
        break;
      default: {
        const never: never = note;
        throw new Error(`no rule for note ${JSON.stringify(never)}`);
      }
    }
  }
  return [...open.values()];
}

export function describeNote(note: DaemonNote): string {
  switch (note.kind) {
    case "daemon-started":
      return `started (pid ${note.pid}, instance ${note.instanceId}) watching ${note.source} — ${note.opening} Baseline: ${note.baseline}`;
    case "daemon-stopped":
      return `stopped (instance ${note.instanceId}): ${note.why}`;
    case "condition-degraded":
      return `DEGRADED ${note.condition}: ${note.why}`;
    case "condition-restored":
      return `restored ${note.condition} after ${Math.round(note.forMs / 1000)}s: ${note.why}`;
    default: {
      const never: never = note;
      throw new Error(String(never));
    }
  }
}

export type NoteRepair = { torn: false } | { torn: true; droppedBytes: number };

export type NoteLog = {
  readonly path: string;
  readonly repair: NoteRepair;
  append(note: DaemonNote): void;
  close(): void;
};

/**
 * Open the note log for appending, having first cut off a torn final line.
 *
 * **THE TRUNCATION IS THE WHOLE SAFETY PROPERTY, and skipping a bad line on
 * read is not a substitute.** A process killed mid-write leaves
 * `{"kind":"condition-deg` with no newline; the next append lands immediately
 * after those bytes, so a valid note is now welded onto a corrupt one and, one
 * append later, the malformed record is no longer the final line — a reader
 * that only forgives the LAST line then loses a good note too. Same reasoning,
 * same fix, and the same test as `store.ts`'s event log, which is the file this
 * one sits beside. (It is also the same twenty lines: `store.ts` keeps its
 * `repairEventLog` private, so this is a duplicate of a subtle rule rather than
 * a reuse of one. Reported as a finding rather than fixed here, since that file
 * is landed and under review.)
 *
 * No lock. The daemon holds the store's lock for its whole life and is the only
 * writer of this file; a second daemon never gets far enough to open it.
 */
export function openNoteLog(root: string): NoteLog {
  const path = join(root, NOTES_FILE);
  const repair = truncateToLastNewline(path);
  const fd = openSync(path, "a");
  let closed = false;
  return {
    path,
    repair,
    append(note) {
      if (closed) throw new Error("this note log is closed");
      // ONE WRITE, on an O_APPEND fd, so a note lands whole at the end whatever
      // else is happening — the same discipline as `store.ts`'s `writeAll`.
      const text = `${JSON.stringify(note)}\n`;
      const buffer = Buffer.from(text, "utf8");
      let written = 0;
      while (written < buffer.length) written += writeSync(fd, buffer, written, buffer.length - written);
    },
    close() {
      if (closed) return;
      closed = true;
      closeSync(fd);
    },
  };
}

/**
 * Cut the file back to its last complete line, on disk.
 *
 * Scans backwards in chunks: this runs at every start and the file only grows.
 * A file with no newline at all truncates to empty, because a single torn line
 * has nothing in it to keep.
 */
function truncateToLastNewline(path: string): NoteRepair {
  if (!existsSync(path)) return { torn: false };
  const fd = openSync(path, "r+");
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return { torn: false };
    const buffer = Buffer.alloc(1);
    readSync(fd, buffer, 0, 1, size - 1);
    if (buffer[0] === 0x0a) return { torn: false };

    const CHUNK = 64 * 1024;
    let end = size;
    let keep = 0;
    while (end > 0) {
      const start = Math.max(0, end - CHUNK);
      const chunk = Buffer.alloc(end - start);
      readSync(fd, chunk, 0, chunk.length, start);
      const at = chunk.lastIndexOf(0x0a);
      if (at !== -1) {
        keep = start + at + 1;
        break;
      }
      end = start;
    }
    ftruncateSync(fd, keep);
    return { torn: true, droppedBytes: size - keep };
  } finally {
    closeSync(fd);
  }
}

/**
 * Every note in the log, plus a count of the lines that were not notes.
 *
 * Lock-free by construction, like `readCheckpoint`: `scripts/overseer.ts` reads
 * this while the daemon is writing it, and must not be able to disturb it.
 * `unreadable` is returned rather than swallowed for the store's own reason —
 * a silent skip is how a log rots without anybody finding out.
 */
export function readNotes(root: string, limit?: number): { notes: DaemonNote[]; unreadable: number } {
  const path = join(root, NOTES_FILE);
  if (!existsSync(path)) return { notes: [], unreadable: 0 };
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { notes: [], unreadable: 0 };
  }
  const notes: DaemonNote[] = [];
  let unreadable = 0;
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      unreadable += 1;
      continue;
    }
    if (isNote(parsed)) notes.push(parsed);
    else unreadable += 1;
  }
  return { notes: limit === undefined ? notes : notes.slice(-limit), unreadable };
}

function isNote(u: unknown): u is DaemonNote {
  if (typeof u !== "object" || u === null || Array.isArray(u)) return false;
  const record = u as Record<string, unknown>;
  if (typeof record["at"] !== "string" || typeof record["instanceId"] !== "string") return false;
  switch (record["kind"]) {
    case "daemon-started":
      return typeof record["pid"] === "number" && typeof record["source"] === "string";
    case "daemon-stopped":
      return typeof record["why"] === "string";
    case "condition-degraded":
      return isCondition(record["condition"]) && typeof record["why"] === "string";
    case "condition-restored":
      return isCondition(record["condition"]) && typeof record["why"] === "string" && typeof record["degradedAt"] === "string";
    default:
      return false;
  }
}

function isCondition(u: unknown): u is OverseerCondition {
  return typeof u === "string" && Object.hasOwn(CONDITIONS, u);
}
