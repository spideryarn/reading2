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
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseStartRevision } from "../fleet/revision.js";
import type { StartRevision } from "../fleet/wire.js";
import { splitJsonl, truncateToLastLine, writeAll, type JsonlRepair } from "./jsonl.js";

/** Beside `events.jsonl` and `current.json`, in the same store root. */
export const NOTES_FILE = "daemon.jsonl";

/**
 * The ways the Overseer can stop knowing what the fleet is doing.
 *
 * **SEVEN NAMES, NOT ONE FLAG**, and that is the point of the type. Six have
 * one symptom — no new history — and six different causes; the seventh,
 * `ordering`, is a history that is still arriving and is ordered by less than
 * it could be. A single
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
 *  - `ordering` — the dashboard's producer stamp (which run composed a payload,
 *    which collection its rows came from) is present and cannot be believed,
 *    so payloads are being ordered by their clock alone. Not a loss of
 *    knowledge today, and that is why it is its own name rather than a cause
 *    of `snapshots`: nothing is refused because of it, and what is lost is the
 *    ordering that survives a clock step or a restart. A producer that sends
 *    NO stamp does not raise it — an old dashboard is ordered exactly as well
 *    as it was before stamps existed, and an alarm about that would mean
 *    nothing. docs/plans/260910d § The daemon.
 */
export type OverseerCondition = "sse-stream" | "poll" | "snapshots" | "freshness" | "baseline" | "collector" | "ordering" | "reports";

/*
 * `reports` — **the work-report drain threw**, so submissions are waiting in the
 * inbox and nothing is recording them. A condition rather than a new note kind:
 * it opens on a throw and closes on the next pass that completes, which is the
 * shape of a condition, and a refused or pending ITEM is not one — those are in
 * the drain's own outcome and in `report-refused/`. docs/plans/260910e.
 */
const CONDITIONS: Record<OverseerCondition, true> = {
  "sse-stream": true,
  poll: true,
  snapshots: true,
  freshness: true,
  baseline: true,
  collector: true,
  ordering: true,
  reports: true,
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
      /**
       * The git revision this instance's checkout was at when it started, read
       * once (`tools/fleet/revision.ts`). ABSENT on a note written before
       * revision stamps existed (docs/plans/260910f D2) — which reads as "not
       * stamped", never as "same as HEAD".
       *
       * No schema bump, by this file's own rule: a reader that ignores the
       * field draws no wrong conclusion from the rest of the note, it just
       * does not learn the revision. And the reader here is tolerant: a
       * present but malformed field becomes `unknown` (see `withReadableRevision`)
       * rather than costing the start note, which is what clears a dead
       * instance's open conditions.
       */
      revision?: StartRevision;
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
    }
  /**
   * A SCHEDULED RUN NOBODY CAN ACCOUNT FOR — the note that exists because its
   * absence was the bug.
   *
   * Not a condition, so not `condition-degraded`: a condition is a state that
   * opens and closes, and this is a thing that happened once to one run. It is
   * written here rather than only logged because the failure it reports is
   * silence — a job whose lease ran out went on looking healthy from every other
   * surface, which is GPT Sol's S6, and a line on a console nobody kept is not a
   * report.
   *
   * `reason` separates the two ways it arises, because they want different
   * things done about them: `lease-expired` means work that started and never
   * came back (look at the pid), `reservation-abandoned` means a daemon died in
   * the spawn window (nothing to look at, and nothing to retry).
   */
  | {
      kind: "job-unaccounted";
      at: string;
      instanceId: string;
      jobId: string;
      occurrenceId: string;
      reason: "lease-expired" | "reservation-abandoned";
      why: string;
    }
  /**
   * A FACT ABOUT A RUN THAT THE STORE WOULD NOT TAKE.
   *
   * The scheduler's reservation is fail-closed — nothing is spawned until it is
   * on the disk — and every append AFTER it used to have its result thrown away
   * (GPT Sol's C5). So a failed `finished` left the ledger saying `started` for
   * ever while the console said the run had ended, and the two disagreed with
   * nobody in a position to notice.
   *
   * It is deliberately not a condition: like `job-unaccounted` it happened once,
   * to one run, and there is nothing for a later note to restore. `fact` says
   * WHICH half of the history is missing, because the repair differs — a lost
   * `finished` leaves an occurrence that will be swept as unaccounted when its
   * lease runs out, and a lost `refused` leaves one that never started at all.
   */
  | {
      kind: "job-record-lost";
      at: string;
      instanceId: string;
      jobId: string;
      occurrenceId: string;
      fact: "started" | "finished" | "refused" | "unknown";
      why: string;
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
      // NOT A CONDITION, so it opens and closes nothing. An unaccounted run is
      // a thing that happened to one run, and there is nothing for a later note
      // to "restore" — the record of it is the log line, which is permanent.
      // Named rather than defaulted, so a future arm has to be decided about.
      case "job-unaccounted":
      case "job-record-lost":
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
      return `started (pid ${note.pid}, instance ${note.instanceId}) watching ${note.source} — ${note.opening} Baseline: ${note.baseline}${revisionPhrase(note.revision)}`;
    case "daemon-stopped":
      return `stopped (instance ${note.instanceId}): ${note.why}`;
    case "condition-degraded":
      return `DEGRADED ${note.condition}: ${note.why}`;
    case "condition-restored":
      return `restored ${note.condition} after ${Math.round(note.forMs / 1000)}s: ${note.why}`;
    case "job-unaccounted":
      return `UNACCOUNTED job ${note.jobId} (${note.reason}): ${note.occurrenceId} — ${note.why}`;
    case "job-record-lost":
      return `NOT RECORDED job ${note.jobId} (${note.fact}): ${note.occurrenceId} — ${note.why}`;
    default: {
      const never: never = note;
      throw new Error(String(never));
    }
  }
}

/** Nothing for an unstamped note: absence is said by whoever compares revisions, not guessed at here. */
function revisionPhrase(revision: StartRevision | undefined): string {
  if (revision === undefined) return "";
  if (revision.kind === "unknown") return ` — revision unknown: ${revision.why}`;
  return ` — revision ${revision.sha.slice(0, 8)}${revision.dirty ? "+dirty" : ""}`;
}

export type NoteLog = {
  readonly path: string;
  readonly repair: JsonlRepair;
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
 * one sits beside — and now literally the same code: `jsonl.ts`, which is where
 * the reasoning lives and where the three ways these two copies had already
 * drifted apart are written down.
 *
 * No lock. The daemon holds the store's lock for its whole life and is the only
 * writer of this file; a second daemon never gets far enough to open it.
 */
export function openNoteLog(root: string): NoteLog {
  const path = join(root, NOTES_FILE);
  const repair = truncateToLastLine(path);
  const fd = openSync(path, "a");
  let closed = false;
  return {
    path,
    repair,
    append(note) {
      if (closed) throw new Error("this note log is closed");
      // ONE WRITE, on an O_APPEND fd, so a note lands whole at the end whatever
      // else is happening. `writeAll` rather than a bare loop: this used to be a
      // hand-rolled copy that never checked the count was positive, which is an
      // infinite loop inside the daemon on the rare case the loop exists for.
      writeAll(fd, `${JSON.stringify(note)}\n`);
    },
    close() {
      if (closed) return;
      closed = true;
      closeSync(fd);
    },
  };
}

/**
 * Every complete note in the log, corrupt complete lines, and any unfinished
 * suffix observed while the writer was appending. A failure to read the file
 * is its own result rather than an empty history.
 *
 * Lock-free by construction, like `readCheckpoint`: `scripts/overseer.ts` reads
 * this while the daemon is writing it, and must not be able to disturb it.
 * `unreadable` is returned rather than swallowed for the store's own reason —
 * a silent skip is how a log rots without anybody finding out.
 */
export type ReadNotes =
  | { kind: "read"; notes: DaemonNote[]; unreadable: number; tornTail: string | null }
  | { kind: "unreadable"; cause: string };

export function readNotes(root: string, limit?: number): ReadNotes {
  const path = join(root, NOTES_FILE);
  if (!existsSync(path)) return { kind: "read", notes: [], unreadable: 0, tornTail: null };
  let raw: Buffer;
  try {
    raw = readFileSync(path);
  } catch (cause) {
    return { kind: "unreadable", cause: `could not read ${path}: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  const split = splitJsonl(raw);
  const notes: DaemonNote[] = [];
  let unreadable = 0;
  for (const line of split.completeLines) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      unreadable += 1;
      continue;
    }
    if (isNote(parsed)) notes.push(withReadableRevision(parsed));
    else unreadable += 1;
  }
  return {
    kind: "read",
    notes: limit === undefined ? notes : notes.slice(-limit),
    unreadable,
    tornTail: split.tornTail,
  };
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
    case "job-unaccounted":
      return (
        typeof record["jobId"] === "string" &&
        typeof record["occurrenceId"] === "string" &&
        typeof record["why"] === "string" &&
        (record["reason"] === "lease-expired" || record["reason"] === "reservation-abandoned")
      );
    case "job-record-lost":
      return (
        typeof record["jobId"] === "string" &&
        typeof record["occurrenceId"] === "string" &&
        typeof record["why"] === "string" &&
        (record["fact"] === "started" || record["fact"] === "finished" || record["fact"] === "refused" || record["fact"] === "unknown")
      );
    default:
      return false;
  }
}

/**
 * A start note's `revision`, made trustworthy. `isNote` does not look at the
 * field, so that a damaged one cannot cost the note; here a present field that
 * is not a `StartRevision` is replaced by an `unknown` one saying so, dated to
 * the note. An absent field stays absent: "not stamped" and "stamp unreadable"
 * are different facts.
 */
function withReadableRevision(note: DaemonNote): DaemonNote {
  if (note.kind !== "daemon-started" || !Object.hasOwn(note, "revision")) return note;
  const revision = parseStartRevision(note.revision);
  return {
    ...note,
    revision: revision ?? { kind: "unknown", why: "the note's revision field could not be read", readAt: note.at },
  };
}

function isCondition(u: unknown): u is OverseerCondition {
  return typeof u === "string" && Object.hasOwn(CONDITIONS, u);
}
