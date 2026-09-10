/**
 * **A session job's history, read out of the launch journal** — plan 260910f
 * (scheduled dispatch) § D2, and the review dispositions F1–F4.
 *
 * A live session job writes nothing to `events.jsonl`: the launch protocol's
 * journal is its one ledger, and two ledgers for one launch is the thing that
 * stage removed. So the planner's clocks need that journal in their own
 * vocabulary, and this file is the translation — pure, and the ONLY place a
 * `LaunchRecord` becomes a scheduler `Occurrence`.
 *
 *  - `launchOccurrencesOf` turns every schedule-origin record into the
 *    `launch` arm, in fold order, and every carried entry too (F2);
 *  - `launchHistoryOf` is the journal's standing as a history the planner can
 *    hold session jobs on, separately from the rules' ledger (F2);
 *  - `scheduleIndexOf` merges the two, once per pass. **The tick and the preview
 *    both call it**, so the preview cannot read a different history from the
 *    one the tick acts on.
 *
 * It reads no exit record: what a launch's result was is
 * `occurrence-result.ts`'s question, asked of evidence, and the planner only
 * needs to know whether the launch is open, settled, replaced or waiting.
 */
import {
  occurrenceId,
  type BehaviourHash,
  type LaunchOccurrence,
  type LaunchStanding,
  type OccurrenceHistory,
  type OccurrenceId,
  type OccurrenceIndex,
  type OccurrenceKey,
  type ScheduledOccurrence,
  type ScheduleIndex,
} from "./jobs.js";
import type { CarriedOccurrence, JournalStatus, LaunchFold, LaunchOrigin, LaunchRecord } from "./launch-protocol.js";
import type { PlanHistory } from "./schedule-plan.js";

/** A schedule origin as the scheduler's key, which is what it was made from (`scheduleOrigin`). */
function keyOf(origin: Extract<LaunchOrigin, { kind: "schedule" }>): OccurrenceKey {
  return { jobId: origin.jobId, scheduledAt: origin.scheduledAt, behaviourHash: origin.behaviourHash as BehaviourHash };
}

/** An instant for an unattributable entry whose reset line somehow carried none. It sorts first, and it holds regardless. */
const BEFORE_EVERYTHING = new Date(0).toISOString();

/**
 * Every schedule-origin launch as the planner's `launch` arm, in fold order.
 *
 * **Carried entries go in too (F2)**, first, because the history reset that
 * carried them is the journal's first line:
 *
 *  - an **attributable** one (its reset could read its origin) is held under
 *    its own job until Greg disposes of it;
 *  - an **unattributable** one (origin null) could have been any session job's,
 *    so it holds **every** session job in `sessionJobIds` — one occurrence per
 *    job, each keyed by the carried id so two of them cannot collide — and it is
 *    never dropped. Only Greg's `dispose` moves it.
 *
 * A recovery-origin record or carried entry is not a scheduled job's and is left out.
 */
export function launchOccurrencesOf(fold: LaunchFold, sessionJobIds: ReadonlySet<string>): ReadonlyMap<OccurrenceId, LaunchOccurrence> {
  const found = new Map<OccurrenceId, LaunchOccurrence>();
  const resetAt = fold.reset?.at ?? BEFORE_EVERYTHING;
  for (const carried of fold.carried.values()) {
    for (const one of carriedOccurrences(carried, resetAt, sessionJobIds)) found.set(one.id, one);
  }
  for (const record of fold.occurrences.values()) {
    if (record.origin.kind !== "schedule") continue;
    const key = keyOf(record.origin);
    const id = occurrenceId(key);
    found.set(id, { kind: "launch", id, key, reservedAt: record.plannedAt, launchId: record.id, standing: standingOfRecord(record) });
  }
  return found;
}

function carriedOccurrences(carried: CarriedOccurrence, resetAt: string, sessionJobIds: ReadonlySet<string>): LaunchOccurrence[] {
  const disposed = carried.disposition;
  if (carried.origin === null) {
    const why =
      `unattributable: ${carried.occurrenceId} was carried over the launch journal's history reset of ${resetAt} with no origin, ` +
      "so it may have been any session job's, and it holds every one until Greg disposes of it";
    return [...sessionJobIds].map((jobId) => {
      // THE CARRIED ID STANDS WHERE A HASH WOULD. It is for audit only, like
      // every key's hash, and it keeps two unattributable entries apart.
      const key: OccurrenceKey = { jobId, scheduledAt: resetAt, behaviourHash: `carried:${carried.occurrenceId}` as BehaviourHash };
      return { kind: "launch", id: occurrenceId(key), key, reservedAt: resetAt, launchId: carried.occurrenceId, standing: carriedStanding(disposed, why) };
    });
  }
  if (carried.origin.kind !== "schedule") return [];
  const key = keyOf(carried.origin);
  const why =
    `carried over the launch journal's history reset of ${resetAt} (last seen ${carried.lastSeen ?? "only by the owner or its artefacts"}), ` +
    "so it may already have launched and only Greg's disposition moves it";
  return [{ kind: "launch", id: occurrenceId(key), key, reservedAt: carried.plannedAt ?? resetAt, launchId: carried.occurrenceId, standing: carriedStanding(disposed, why) }];
}

function carriedStanding(disposition: CarriedOccurrence["disposition"], why: string): LaunchStanding {
  if (disposition !== null) {
    return { kind: "settled", state: "disposed", endedAt: disposition.at, launchedAt: null, why: `disposed by ${disposition.actor} (${disposition.decision}): ${disposition.why}` };
  }
  return { kind: "open", state: "carried", launchedAt: null, why };
}

/**
 * The pool account a record was planned on: its pinned run spec's `account`,
 * read directly, because the protocol requires one on every wrapper launch.
 *
 * **Null only for a record that pins no run spec: a `tmux` launch.** That kind
 * is interactive, and the scheduler never plans one (it plans `tmux-headless`
 * only, `scheduler.ts` § `planSession`), so a schedule-origin record of that
 * kind was written by something other than this scheduler. What the code does
 * with one:
 *  - it is still projected, never dropped, because its job's clock must see it;
 *  - it is superseded before launch, because a newly chosen account cannot be
 *    applied to the stored request and M11 permits no scheduled session without
 *    a pinned pool account;
 *  - its replacement is a normal `tmux-headless` request with the chosen
 *    account, authorised timeout and access.
 */
export function accountOf(record: LaunchRecord): string | null {
  return record.run === null ? null : record.run.account;
}

/**
 * One record's standing for its job's clock. Exhaustive over the protocol's
 * states, so a ninth state is a compile error here rather than a record the
 * planner reads as something it is not.
 */
export function standingOfRecord(record: LaunchRecord): LaunchStanding {
  const launchedAt = record.attempts[0]?.launchingAt ?? null;
  // A DISPOSITION OUTRANKS THE OPEN STATES (F5): Greg has said what happened,
  // so the job is free, from the instant he said it.
  if (record.disposition !== null) {
    const { actor, decision, why, at } = record.disposition;
    return { kind: "settled", state: "disposed", endedAt: at, launchedAt, why: `disposed by ${actor} (${decision}): ${why}` };
  }
  switch (record.state) {
    case "planned":
      return { kind: "resumable", state: record.state, account: accountOf(record), why: "planned, and not yet asked for admission" };
    case "waiting-admission":
      return { kind: "resumable", state: record.state, account: accountOf(record), why: `waiting for admission: ${record.why}` };
    case "reserved":
      return { kind: "open", state: record.state, launchedAt, why: "reserved: a slot is held and the launcher has not been reached; reconciliation settles it" };
    case "launching":
      return { kind: "open", state: record.state, launchedAt, why: `launching attempt ${record.current.attempt} (${record.current.correlationId}), with nothing yet to say it is running` };
    case "observed-running":
      return { kind: "open", state: record.state, launchedAt, why: `observed-running as attempt ${record.current.attempt} (${record.current.correlationId})` };
    case "outcome-unknown":
      return { kind: "open", state: record.state, launchedAt, why: `outcome-unknown (${record.why}) — held until evidence or Greg's disposition` };
    case "completed":
      return { kind: "settled", state: record.state, endedAt: record.endedAt, launchedAt, why: `completed attempt ${record.current.attempt}` };
    case "failed-before-launch":
      // SUPERSEDED IS NOT A SETTLED RUN: it releases its due instant, so the
      // replacement is keyed at this `endedAt` and gets a new id.
      if (record.proof === "superseded") return { kind: "replaced", endedAt: record.endedAt, why: record.why };
      return { kind: "settled", state: record.state, endedAt: record.endedAt, launchedAt, why: `failed before launch (${record.proof}): ${record.why}` };
    default: {
      const never: never = record;
      throw new Error(`no standing for launch record ${JSON.stringify(never)}`);
    }
  }
}

/** The launch journal's standing, as a history the planner can hold session jobs on (F2). Not the rules': their ledger is `events.jsonl`. */
export function launchHistoryOf(status: JournalStatus): OccurrenceHistory {
  switch (status.kind) {
    case "whole":
      return { kind: "intact" };
    case "history-lost":
      return {
        kind: "lost",
        why:
          `the launch journal lost its history at line ${status.atLine} (${status.why}), so no session job is started until Greg resolves it; ` +
          "the rules' ledger is separate and not affected",
      };
    default: {
      const never: never = status;
      throw new Error(`no history for journal status ${JSON.stringify(never)}`);
    }
  }
}

/** The sentence for a process that holds no launch journal at all. Session jobs are held: an unread history is not an empty one (C3). */
export const NO_LAUNCH_JOURNAL_WHY =
  "this process holds no launch protocol, so the launch journal — every session job's history — cannot be read, and nothing can start a session";

/** What the merge needs of the journal: its status and its fold, read now. The protocol's `LaunchJournalView` is one. */
export type LaunchJournalReading = { status(): JournalStatus; fold(): LaunchFold };

/**
 * **THE ONE MERGE**, for the tick and the preview alike: the rules' ledger
 * first, then the launch journal's projection, each in its own order (Fable's
 * P3), and a history per ledger (F2).
 *
 * A journal that is not whole projects nothing: its session jobs are held on
 * `history.sessions`, and a partial fold read as "never run" would be C3
 * arriving through a different door. A journal that throws is the same.
 */
export function scheduleIndexOf(input: {
  readonly ledger: OccurrenceIndex;
  readonly ledgerHistory: OccurrenceHistory;
  readonly journal: LaunchJournalReading | undefined;
  readonly sessionJobIds: ReadonlySet<string>;
}): { readonly occurrences: ScheduleIndex; readonly history: PlanHistory } {
  let sessions: OccurrenceHistory;
  let launches: ReadonlyMap<OccurrenceId, LaunchOccurrence> = new Map();
  if (input.journal === undefined) {
    sessions = { kind: "lost", why: NO_LAUNCH_JOURNAL_WHY };
  } else {
    try {
      sessions = launchHistoryOf(input.journal.status());
      if (sessions.kind === "intact") launches = launchOccurrencesOf(input.journal.fold(), input.sessionJobIds);
    } catch (cause) {
      sessions = { kind: "lost", why: `the launch journal could not be read (${cause instanceof Error ? cause.message : String(cause)}), so no session job is started` };
      launches = new Map();
    }
  }
  const occurrences = new Map<OccurrenceId, ScheduledOccurrence>(input.ledger);
  for (const [id, occurrence] of launches) occurrences.set(id, occurrence);
  return { occurrences, history: { rules: input.ledgerHistory, sessions } };
}
