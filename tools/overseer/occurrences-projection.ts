/**
 * **WHAT THE SCHEDULER HAS LAUNCHED, AS ONE BOUNDED FILE** — plan
 * 260910f-scheduled-dispatch § D7. The builder is pure; the writer is the one
 * line of I/O, and the daemon's checkpoint is its only caller.
 *
 * ## Why so few imports
 *
 * This module may import the classifier, the atomic writer, the wire types and
 * the parser's constants — and nothing else. No store, no scheduler, no daemon:
 * a projection that could reach the thing it projects could be tempted to read
 * it a second way, and then the file and the journal could disagree about the
 * same launch. The daemon hands in `ObservedLaunch` rows; this turns them into
 * the file.
 *
 * ## Bounded, newest first
 *
 * `OCCURRENCES_PER_JOB` per job, newest first by `scheduledAt` — the nominal
 * due instant, which is the occurrence's identity. Revision siblings share
 * that instant, so ties use `plannedAt` newest first, then the fold's insertion
 * order newest first. Two writes of the same journal therefore give the same
 * file. What is left out is COUNTED (`omitted`), because a list that stopped at
 * ten without saying so reads as "only ten ever ran".
 *
 * ## A command is printed only where it applies, and only if it is safe to paste
 *
 * `cancel` exists while the result is `running`; `dispose` exists while it is
 * `unknown`. Both follow the RESULT rather than the bare state, so a disposed
 * occurrence — whose state the protocol leaves at `observed-running` or
 * `outcome-unknown` for ever (`occurrence-result.ts` § a disposition) — shows
 * neither: the protocol refuses a second disposition, and a person who has just
 * said a session ended should not be handed a line to kill it.
 *
 * Each value spliced into a command is checked against the exact shape it must
 * have. **One that does not match gets no command at all, never a quoted
 * guess**: quoting is a promise about every byte of a string this module did
 * not write, and a command a person pastes into a shell is the wrong place to
 * find out it was broken.
 */
import { join } from "node:path";

import { OCCURRENCES_FILE, OCCURRENCES_PER_JOB, OCCURRENCES_SCHEMA } from "../fleet/occurrences-parse.js";
import type {
  ScheduledJournalStanding,
  ScheduledOccurrence,
  ScheduledOccurrencesFile,
  ScheduledOccurrencesJob,
  ScheduledResult,
  ScheduledRunSpec,
  SchedulePreviewNext,
} from "../fleet/wire.js";
import { writeAtomically } from "./jsonl.js";
import { classifyOccurrence, type ObservedLaunch } from "./occurrence-result.js";

/** A tmux session name this module will put inside single quotes. */
const TMUX_SESSION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** The launch protocol's occurrence id (`launch-protocol.ts` § `OCCURRENCE_ID_PATTERN`), restated because that module is not on this branch. */
const LAUNCH_OCCURRENCE_ID_PATTERN = /^lo-[0-9a-f]{20}$/;

export type OccurrencesProjectionJob = {
  readonly jobId: string;
  readonly dispatch: ScheduledOccurrencesJob["dispatch"];
  readonly run: ScheduledRunSpec;
  /** The preview's own answer from the same planner pass, copied — `schedule.json` is its home. */
  readonly next: SchedulePreviewNext;
  /** Every schedule-origin launch of this job, in the launch fold's insertion order. */
  readonly observed: readonly ObservedLaunch[];
};

export type OccurrencesProjectionInput = {
  readonly writtenAt: string;
  readonly instanceId: string;
  readonly journal: ScheduledJournalStanding;
  /** Session jobs, in definition order. */
  readonly jobs: readonly OccurrencesProjectionJob[];
};

export function occurrencesProjection(input: OccurrencesProjectionInput): ScheduledOccurrencesFile {
  return {
    schema: OCCURRENCES_SCHEMA,
    writtenAt: input.writtenAt,
    instanceId: input.instanceId,
    journal: input.journal,
    jobs: input.jobs.map(jobOf),
  };
}

function jobOf(job: OccurrencesProjectionJob): ScheduledOccurrencesJob {
  // A launch filed under the wrong job is a bug in the caller's grouping, and a
  // row built from it would show one job's run as another's. The daemon catches
  // the throw and says so, as it does for `schedulePreview`'s.
  const stray = job.observed.find((o) => o.jobId !== job.jobId);
  if (stray !== undefined) throw new Error(`occurrence ${stray.launchOccurrenceId} belongs to job ${stray.jobId}, not ${job.jobId}`);
  const newestFirst = job.observed
    .map((occurrence, foldIndex) => ({ occurrence, foldIndex }))
    .sort((a, b) => newestFirstOrder(a.occurrence, b.occurrence) || b.foldIndex - a.foldIndex)
    .map(({ occurrence }) => occurrence);
  return {
    jobId: job.jobId,
    dispatch: job.dispatch,
    run: job.run,
    next: job.next,
    occurrences: newestFirst.slice(0, OCCURRENCES_PER_JOB).map(occurrenceOf),
    omitted: Math.max(0, newestFirst.length - OCCURRENCES_PER_JOB),
  };
}

/**
 * Newest `scheduledAt` first, by instant rather than by string, so two
 * spellings of one instant sort together; an instant that does not parse sorts
 * after every one that does, rather than wherever NaN lands. Revision siblings
 * tie on `scheduledAt`, so their `plannedAt` decides next. The caller decorates
 * final ties with reverse fold insertion order, the protocol's last word on
 * which one is newest.
 */
function newestFirstOrder(a: ObservedLaunch, b: ObservedLaunch): number {
  const scheduled = instantNewestFirst(a.scheduledAt, b.scheduledAt);
  if (scheduled !== 0) return scheduled;
  return instantNewestFirst(a.plannedAt, b.plannedAt);
}

/** One instant newest first; unreadable instants sort after readable ones, then deterministically by text. */
function instantNewestFirst(a: string, b: string): number {
  const at = Date.parse(a);
  const bt = Date.parse(b);
  if (Number.isNaN(at) !== Number.isNaN(bt)) return Number.isNaN(at) ? 1 : -1;
  if (!Number.isNaN(at) && at !== bt) return bt - at;
  return a === b ? 0 : a < b ? 1 : -1;
}

function occurrenceOf(o: ObservedLaunch): ScheduledOccurrence {
  const result = classifyOccurrence(o);
  return {
    launchOccurrenceId: o.launchOccurrenceId,
    schedulerOccurrenceId: o.schedulerOccurrenceId,
    scheduledAt: o.scheduledAt,
    behaviourHash: o.behaviourHash,
    plannedAt: o.plannedAt,
    updatedAt: o.updatedAt,
    attempts: o.attempts,
    state: o.state.kind,
    run: o.run,
    result,
    answer: o.answer,
    transcriptPath: o.transcriptPath,
    tmuxSession: o.tmuxSession,
    commands: commandsOf(o, result),
  };
}

function commandsOf(o: ObservedLaunch, result: ScheduledResult): ScheduledOccurrence["commands"] {
  const cancel =
    result.kind === "running" && o.tmuxSession !== null && TMUX_SESSION_PATTERN.test(o.tmuxSession) ? `tmux kill-session -t '=${o.tmuxSession}'` : null;
  const dispose =
    result.kind === "unknown" && LAUNCH_OCCURRENCE_ID_PATTERN.test(o.launchOccurrenceId)
      ? `npx tsx scripts/overseer-launches.ts dispose ${o.launchOccurrenceId} --as not-running --why "<reason>"`
      : null;
  return { cancel, dispose };
}

/**
 * Write the file atomically — `jsonl.ts` § `writeAtomically`: a sibling temp
 * file, flushed, renamed over the old one, so a reader sees the previous
 * checkpoint's file or this one, never half of either.
 *
 * Returns a result rather than throwing, as `writeSchedulePreview` does: the
 * daemon calls this every checkpoint and a failure here must never stop it.
 */
export function writeOccurrencesFile(storeDir: string, file: ScheduledOccurrencesFile): { ok: true } | { ok: false; why: string } {
  try {
    writeAtomically(join(storeDir, OCCURRENCES_FILE), storeDir, `${JSON.stringify(file, null, 2)}\n`);
    return { ok: true };
  } catch (cause) {
    return { ok: false, why: `${OCCURRENCES_FILE} could not be written (${cause instanceof Error ? cause.message : String(cause)})` };
  }
}
