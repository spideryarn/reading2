/**
 * The scheduler: the one place a job goes from "due" to "running", and the
 * ordering that makes a crash in between visible instead of silent.
 *
 * `jobs.ts` is the arithmetic and `store.ts` is the durability; this file is the
 * three-step dance between them, and it is short on purpose because every line
 * of it is ordering.
 *
 *     append `reserved` and fsync it   ──▶  start the rule  ──▶  append `started`
 *
 * ## A session job does not dance here any more
 *
 * Since plan 260910f (scheduled dispatch), a session job starts through the
 * launch protocol and nothing else. The tick calls the capability it is handed
 * (`TickInput.launch`), the protocol's `plan()` is the first durable write, and
 * **a session job writes nothing to `events.jsonl`**: its history is the launch
 * journal, projected into the planner by `launch-occurrences.ts`. So the
 * reserve → start → started dance, the lease and the sweep below are a rule's
 * now, and the spawn window this file cannot close is a rule's window only.
 * The session window is the protocol's to close, and it does: an occurrence
 * that may have launched is open, and holds its job, until evidence or Greg
 * says otherwise.
 *
 * ## And the same ordering one layer in, for a rule
 *
 * A deterministic rule runs IN this process rather than as a child, and the
 * decision it takes is the thing gate 1 wants written down. So it gets the same
 * dance again inside the occurrence:
 *
 *     detect  ──▶  append `rule-intended` and fsync it  ──▶  act  ──▶  append `rule-settled`
 *
 * **That sequence is NOT in this file — it is `rule-protocol.ts`**, which every
 * rule job pins by digest, and this file calls into it. `SpawnJob` could not
 * carry it (GPT Sol's SP-2): it is handed no store and its `JobOutcome` has
 * nowhere for a finding to go. What a caller supplies is a **capability** —
 * looking (`ProposingRuleWork`), or looking and acting (`ActingRuleWork`) — and
 * nothing else.
 *
 * **THIS FILE IS DELIBERATELY NOT PINNED, AND THAT IS A FIX RATHER THAN AN
 * OVERSIGHT.** Stage 3a put the whole of it in `RULE_SOURCES`, because it was
 * then the code interpreting the hashed `disposition` (SC-2). Right in
 * principle and far too broad in practice: it also carries session dispatch,
 * the sweep and `describeReport`'s wording, so every rule's authorisation was
 * hostage to a file that changes for reasons having nothing to do with rules —
 * it re-pinned twice in one session. 3b moved the protocol out instead. Same
 * guarantee, far fewer false trips; `rule-protocol.ts`'s header has the
 * argument and `tests/overseer-rules.test.ts` asserts both directions.
 *
 * ## Four gates, and only two of them are about the clock
 *
 * A tick asks, in this order:
 *
 *  1. **Is the occurrence ledger whole?** A store that opened cold has an empty
 *     one, which reads as *nothing has ever run* — a licence to run everything
 *     again. So a lost history holds every job (`history-lost`). GPT Sol's C3:
 *     *a cold start is not permission*.
 *  2. **Is this job's BEHAVIOUR the one that was authorised?** The pin lives
 *     beside the definition and is compared before anything else about the job
 *     is asked (`unauthorised`). It used to be that an edited definition merely
 *     lost its history — and `due()` reads no history as *due now*, so an edit
 *     dispatched the edited version immediately, which is the opposite of what
 *     the runbook says. GPT Sol's C2. The pin says nothing about the SCHEDULE,
 *     which is S8-1: a cadence edit is not a re-authorisation and must not need
 *     one.
 *  3. **Has enough time passed?** Only now, and only for a job that got past
 *     the first two. A job that has never run is measured from the durable
 *     `armedAt` rather than being due at once (S8-6).
 *  4. **Was another Claude session launched too recently?** A durable minimum
 *     separation between session launches, checked against the ledger so it
 *     survives downtime and restarts — GPT Sol's S8-5, which is what a per-job
 *     phase offset could not do. The job that loses is `spacing-held`, a state
 *     a reader can see, never a silent skip.
 *
 * **THE ORDER IS NO LONGER WRITTEN OUT IN THIS FILE.** Since 2026-09-10 it is
 * `schedule-plan.ts`'s `planJobs`, which the preview calls too — plan 260910e
 * § D2: a preview with its own copy of the gates would be a second copy of the
 * one thing it must not get wrong. It also gained two steps the list above
 * does not show: a **duplicate-id preflight** over the whole list between 1 and
 * 2, and **dry-run** between 3 and 4. What stays here is the sweep before it,
 * the document reading it is handed, and the side effects after it.
 *
 * ## Fail closed, and what that actually means here
 *
 * **If the reservation does not land on the disk, nothing is spawned.** Not
 * "spawn and try again later", not "log a warning and carry on": a store that
 * cannot record what we are about to do is a store that cannot tell anybody it
 * happened, and an unrecorded run is the one failure the whole design is arranged
 * against. `record()` — imported from `rule-protocol.ts`, where it is pinned,
 * because fail-closed is the whole of the append-before-act guarantee — turns
 * every way an append can fail into one closed door, and
 * `tests/overseer-jobs.test.ts` makes the append fail and asserts nothing was
 * spawned.
 *
 * ## The window this CANNOT close, said out loud
 *
 * Between `spawn()` returning and `started` landing there is a gap, and a crash
 * in it leaves a `reserved` with nothing after it. That is byte-for-byte the same
 * as a crash BEFORE the spawn, so no restart can tell "never ran" from "ran and
 * we never said so" — Sol's crash-window table, and the reason the honest state
 * is `unknown` rather than a retry. Ordering makes the pre-spawn record durable;
 * it does not make the spawn window rarer, and claiming otherwise was the error
 * in the plan this stage came from.
 *
 * ## The lease, which is the overlap guard
 *
 * The daemon's `attentionRunning` idiom — an in-memory promise, non-null while a
 * pass is in flight — is correct for a pass that always settles and is a trap for
 * one that might not: a hung child leaves it non-null for ever, every later tick
 * declines to overlap, the heartbeat stays green and the job silently never runs
 * again. So the guard here is a **durable lease with a deadline**. An occurrence
 * still unsettled past its `leaseUntil` is `stuck`, and `sweep()` — which runs
 * BEFORE the dispatch pass, so one tick both reports and recovers — writes it down
 * as `unknown` and reports it. The job is then free to have its NEXT occurrence.
 * That is not a retry: it is a different key, at a different instant, and the run
 * nobody could account for stays in the log saying so.
 *
 * **Those attention and usage guards are deliberately untouched.** They belong to
 * another stage's work, and only the scheduled-job path uses leases.
 *
 * ## Every append is answered for, not only the first
 *
 * The reservation fails closed. The four appends after it — the throw-to-unknown,
 * the refusal, and the two completions — used to have their results dropped, so
 * the durable history could say `started` for ever while the report said the run
 * had ended (GPT Sol's C5). They still must not throw, because the alternative
 * to a lost record is a lost record AND a lost outcome; instead the synchronous
 * ones become an `unrecorded` report and the completion, which lands after the
 * tick has returned, goes to `onLostRecord`.
 */
import type { OverseerEvent } from "./diff.js";
import {
  behaviourHash,
  leaseExpired,
  occurrenceId,
  standingOf,
  type Arming,
  type AuthorisedJob,
  type JobDefinition,
  type JobSpawn,
  type LaunchOccurrence,
  type Occurrence,
  type OccurrenceHistory,
  type OccurrenceId,
  type OccurrenceIndex,
  type OccurrenceKey,
} from "./jobs.js";
import { NO_LAUNCH_JOURNAL_WHY, scheduleIndexOf, type LaunchJournalReading } from "./launch-occurrences.js";
import {
  occurrenceIdOf,
  scheduleOrigin,
  type AbandonResult,
  type LaunchJournal,
  type LaunchOccurrenceId,
  type LaunchOutcome,
  type LaunchProtocol,
  type LaunchRecord,
  type RunSpec,
  type SlotAnswer,
} from "./launch-protocol.js";
import { record, startRule, type ActingRuleWork, type ProposingRuleWork } from "./rule-protocol.js";
import {
  authorisationUnder,
  DUPLICATE_WHY,
  duplicateJobIds,
  evidenceAsBuilt,
  planJobs,
  resolveEvidence,
  type AccountChoice,
  type DocumentEvidence,
  type JobPlan,
  type LaunchHow,
  type ReadDocument,
  type ReadDocumentBytes,
  type Superseded,
} from "./schedule-plan.js";
import type { AppendResult, StoredScheduler } from "./store.js";

/**
 * What the scheduler needs from the store, and no more.
 *
 * A structural subset of `OverseerStore`, so the real store satisfies it without
 * an adapter and a test can hand in one whose `append` fails. Narrow on purpose:
 * a scheduler that could `checkpoint()` would be a second writer of the
 * heartbeat.
 */
export type OccurrenceLog = {
  readonly instanceId: string;
  readonly occurrences: OccurrenceIndex;
  /** Whether that index is the whole history, or whether opening the store lost some of it. See `OccurrenceHistory`. */
  readonly occurrenceHistory: OccurrenceHistory;
  append(events: readonly OverseerEvent[]): AppendResult;
};

/**
 * A fact about a run that could not be written down, AFTER the reservation was.
 *
 * The pre-spawn append is fail-closed — nothing is started until it lands — but
 * every later append used to have its result thrown away, so a failed `started`
 * or `finished` left the durable history saying something the report did not
 * (GPT Sol's C5). These do not throw, deliberately: a completion append that
 * fails must not also destroy the child's outcome. It is reported instead, and
 * the daemon writes it into `daemon.jsonl`.
 */
export type LostRecord = {
  readonly jobId: string;
  readonly occurrenceId: OccurrenceId;
  /** Which fact was lost. `finished` is the one that arrives after the tick has returned. */
  readonly fact: "started" | "finished" | "refused" | "unknown";
  readonly why: string;
};

/**
 * What one tick did, per job — everything, including the nothings.
 *
 * A tick that decided not to run a job says which of the four reasons it was.
 * "It did not run" and "it did not run because a previous run has not come back"
 * are the difference between a quiet fleet and a wedged one, and a scheduler
 * that returned only its dispatches could not tell them apart.
 */
export type SchedulerReport =
  /** A RULE, reserved and started in process. A session job never produces this arm: its launch is the `launch` arm below. */
  | { readonly kind: "dispatched"; readonly jobId: string; readonly occurrenceId: OccurrenceId; readonly pid: number }
  /**
   * **WHAT THE LAUNCH PROTOCOL ANSWERED, whole** — every `LaunchOutcome` arm is
   * a report, and `invoked` is only ever "the launcher was called": never a
   * result. What the run came to is the journal's and its `exit.json`'s to
   * say (`occurrence-result.ts`). `via` says whether this tick planned the
   * occurrence or resumed a waiting one; `account` is the pool account it was
   * planned or pinned on, null when the record does not say (before 2b).
   */
  | {
      readonly kind: "launch";
      readonly jobId: string;
      readonly via: "new" | "resume";
      readonly account: string | null;
      readonly outcome: LaunchOutcome;
    }
  /** D3: a document's bytes, read for the material, were not the ones the pin gate accepted this tick. A report, not an occurrence: nothing was planned. */
  | { readonly kind: "material-moved"; readonly jobId: string; readonly why: string }
  /** A waiting occurrence abandoned before it ever launched — a later revision, or a pool account that is gone. `reservation` is the owner's actual answer. */
  | { readonly kind: "superseded"; readonly jobId: string; readonly launchId: LaunchOccurrenceId; readonly why: string; readonly reservation: SlotAnswer }
  /** Due and spaced, and no pool account may start it now — or its pinned one is held. Nothing was planned or asked. */
  | { readonly kind: "usage-held"; readonly jobId: string; readonly why: string; readonly until: string | null }
  | { readonly kind: "refused"; readonly jobId: string; readonly occurrenceId: OccurrenceId; readonly why: string }
  /** FAIL CLOSED: the reservation, or the acknowledgement, did not become durable. Nothing was started, or nothing can be said about what was. */
  | { readonly kind: "not-dispatched"; readonly jobId: string; readonly why: string }
  /** A run is genuinely in flight and inside its lease. The ordinary overlap case. */
  | { readonly kind: "held"; readonly jobId: string; readonly why: string }
  | { readonly kind: "waiting"; readonly jobId: string; readonly remainingMs: number }
  /**
   * **NEVER RUN, AND NOT YET ELIGIBLE.** Its own arm rather than a `waiting`,
   * because the sentence a reader needs is different — *never run; first
   * eligible at …* — and because it is the state both standing jobs are in for
   * the first half-hour after arming, which is the moment somebody is watching.
   */
  | { readonly kind: "not-yet-eligible"; readonly jobId: string; readonly firstEligibleAt: string; readonly remainingMs: number }
  /**
   * **DUE, AND DELIBERATELY LEFT WAITING SO TWO SESSIONS DO NOT START AT ONCE.**
   *
   * GPT Sol's S8-5: when two jobs come due in the same tick — which downtime,
   * a restart or a stuck occurrence all produce — one is dispatched and the
   * other gets this. **Visible rather than silent** is the whole point of it
   * being a report arm: a skip nobody can see is how a scheduler stops running a
   * job without anybody noticing.
   */
  | { readonly kind: "spacing-held"; readonly jobId: string; readonly remainingMs: number; readonly why: string }
  /**
   * **DUE, AND DRY-RUN, SO NOTHING WAS RESERVED OR LAUNCHED.** Plan 260910e
   * § D5. Nothing is written to the ledger either, so a job in this state
   * reports it every tick while it is due — the same volume `waiting` has.
   */
  | { readonly kind: "dry-run"; readonly jobId: string; readonly why: string }
  /**
   * **TWO OR MORE DEFINITIONS SHARE THIS ID, AND EVERY ONE OF THEM IS REFUSED.**
   * Its own arm rather than a `not-dispatched`, because that one means a write
   * failed and this one means the job list is wrong — and because the old
   * `not-dispatched` for this case was written while the FIRST duplicate had
   * already been dispatched (Sol's P1-5 on plan 260910e).
   */
  | { readonly kind: "duplicate-id"; readonly jobId: string; readonly why: string }
  /** THE GATE. The definition in front of us is not the one that was authorised, so no key is minted and nothing is spawned. */
  | { readonly kind: "unauthorised"; readonly jobId: string; readonly why: string }
  /** Opening the store could not reconstruct the occurrence ledger, so every job is held: a cold start is not permission. */
  | { readonly kind: "history-lost"; readonly jobId: string; readonly why: string }
  /** Something HAPPENED and could not be written down. The child is unaffected; the durable history now disagrees with this report. */
  | {
      readonly kind: "unrecorded";
      readonly jobId: string;
      readonly occurrenceId: OccurrenceId;
      readonly fact: LostRecord["fact"];
      readonly why: string;
    }
  /** THE ALARM. A lease ran out with nothing to say how the run ended. */
  | { readonly kind: "stuck"; readonly jobId: string; readonly occurrenceId: OccurrenceId; readonly overdueMs: number; readonly why: string }
  /** A reservation left behind by an instance that is gone — noticed, written down, and never retried. */
  | { readonly kind: "unaccounted"; readonly jobId: string; readonly occurrenceId: OccurrenceId; readonly why: string };

/**
 * The read-only look at the launch journal the scheduler may take: its status,
 * its fold, and where an attempt's artefacts live — over the same open store
 * the protocol writes.
 *
 * COLLAPSE when launch-protocol ships view(): this becomes the protocol's own
 * `LaunchJournalView` (`Pick<LaunchJournal, "status" | "fold" | "attemptDir">`,
 * the same `Pick`), and `SchedulerLaunch` a plain `Pick` of `LaunchProtocol`.
 */
export type LaunchJournalView = Pick<LaunchJournal, "status" | "fold" | "attemptDir">;

/**
 * **THE WHOLE CAPABILITY THE SCHEDULER HOLDS** (plan 260910f scheduled
 * dispatch, § D2 and F1): plan-and-drive a new occurrence, resume a waiting
 * one, abandon a superseded one, and look. Never a launcher, a journal or an
 * owner — the protocol's F9.
 */
export type SchedulerLaunch = Pick<LaunchProtocol, "launchOccurrence" | "resumeOccurrence" | "abandon"> & { readonly view: () => LaunchJournalView };

/**
 * A job's run spec with the pool account the scheduler chose for it — carried
 * as far as the launch call until the protocol's 2b puts `account` in
 * `RunSpec` itself. See `planSession`.
 */
export type ScheduledLaunchRun = RunSpec & { readonly account: string };

/** No account choice was handed over, so no pool account may start a session: held, never a guess. What an absent `TickInput.accounts` means. */
export const NO_ACCOUNT_CHOICE: AccountChoice = {
  chosen: { kind: "held", why: "no pool account choice was handed to this tick", until: null },
  standing: () => ({ kind: "held", why: "no pool account choice was handed to this tick", until: null }),
};

export type TickInput = {
  /** Each with the fingerprint it was authorised under — see `AuthorisedJob`, and C2 for what a bare definition let through. */
  readonly definitions: readonly AuthorisedJob[];
  readonly store: OccurrenceLog;
  /**
   * **WHEN THIS SCHEDULER WAS ARMED**, which is what a never-run job's first
   * eligibility is measured from. `unknown` holds every never-run job, loudly.
   *
   * Required rather than optional: a default would be a guess about the one
   * question this field exists to stop anybody guessing about, and every caller
   * already has the answer (`arming.ts`'s `reconcileArming`).
   */
  readonly arming: Arming;
  /**
   * **THE MINIMUM GAP BETWEEN TWO SESSION LAUNCHES.** `schedules.ts`
   * § `LAUNCH_SEPARATION_MS`, and GPT Sol's S8-5 for why a phase offset is not
   * this. Zero disables it, which is what a test that is not about spacing
   * passes.
   */
  readonly launchSeparationMs: number;
  /**
   * **HOW A SESSION JOB'S DOCUMENTS ARE READ, EVERY TICK.** Plan 260910e § D3.
   *
   * The definitions are built once, when the daemon starts, and a session they
   * launch is told to follow the document **on disk** in the primary checkout,
   * where every push to `dev` lands. So a digest taken at start and reused for
   * days authorised whatever the document said by the time it was followed —
   * unattended authority growing between a doc edit and the next restart, with
   * the pin still green. Reading every tick closes that; the window left is a
   * document edited between this read and the session's, which pinning the
   * material handed to the child closes and which is the Scheduled-dispatch
   * stage's first bullet.
   *
   * **Required**, because the alternative to a reading is the stale digest, and
   * a default would reintroduce the defect for any caller that forgot. Session
   * jobs only: a rule's documents are code already loaded into this process,
   * and its load-time digests are the right evidence (`schedule-plan.ts`).
   */
  readonly readDocument: ReadDocument;
  /**
   * **THE LAUNCH CAPABILITY, AND ITS ABSENCE IS THE DETERMINISTIC-ONLY ARMING
   * PATH.** Plan 260910f (scheduled dispatch): a live session job starts
   * through `launchOccurrence` and nothing else, and its history is read
   * through `view()`.
   *
   * GPT Sol's SP-4 still holds, in the new shape: the fix is a **capability,
   * not a filter**. A daemon armed for rules only is given no launch protocol
   * at all, so no code in that process can start a session however due a job
   * is. It cannot read the launch journal either, so a session job there is
   * held — an unread history is not an empty one (C3) — rather than planned
   * against a journal nobody looked at.
   *
   * `| undefined` as well as optional, and deliberately: here the two mean the
   * same thing — **this process holds no such capability**.
   */
  readonly launch?: SchedulerLaunch | undefined;
  /**
   * **WHICH POOL ACCOUNT A NEW SESSION RUNS ON, AND EACH ACCOUNT'S STANDING** —
   * one value per tick, computed by the daemon (Stage C) from the account
   * registry and the shared health and quota gates. Absent is
   * `NO_ACCOUNT_CHOICE`: every live session is `usage-held`, never started on
   * a guess.
   */
  readonly accounts?: AccountChoice | undefined;
  /**
   * **HOW A SESSION'S MATERIAL IS READ** — each document's bytes, once, with
   * their digest (`standing-jobs.ts` § `readJobDocumentBytes`, the same root,
   * paths and digest as `readDocument`). Absent refuses any session whose job
   * leans on a document: material that cannot be read is not material.
   */
  readonly readDocumentBytes?: ReadDocumentBytes | undefined;
  /** LOOKING, for a rule that may only propose. Absent means such a job is refused for the same reason and in the same way as a session job with no launch protocol. */
  readonly rules?: ProposingRuleWork | undefined;
  /**
   * **THE ACTOR, AND IT IS A SEPARATE CAPABILITY FROM `rules` ON PURPOSE.**
   *
   * A daemon that may only propose is handed `rules` and not this, so a spec
   * carrying `disposition: "act"` meets a refusal naming the missing actor —
   * the same shape as a session job in a process with no `spawn`. GPT Sol's
   * SC-2: the separation has to be *what this process holds*, not a `switch`
   * inside a runner that holds both.
   *
   * Nothing outside the tests supplies it. `daemon.ts` has no option for it,
   * which is 3d's job along with the durable rule-run index that acting needs.
   */
  readonly acting?: ActingRuleWork | undefined;
  /** Injected, always. Nothing in this area reads the wall clock for itself. */
  readonly now: () => Date;
  /**
   * Where a fact that could not be written down goes when the tick has already
   * returned — which is only ever the completion append, because the work
   * settles later. Everything synchronous reaches the report instead.
   */
  readonly onLostRecord?: (lost: LostRecord) => void;
  /**
   * **Where an IN-PROCESS rule run is handed over, so a shutdown can wait for
   * it.** Called only for rule work, and only once its whole chain — settlement
   * and completion append — is in one promise.
   *
   * A session job is deliberately not reported here: it is a separate process
   * with a durable reservation behind it, and waiting for one at shutdown would
   * hold the daemon open for an afternoon's Claude session. See `dispatch`.
   */
  readonly onRuleRun?: (run: RuleRun) => void;
};

/**
 * A rule run this process is in the middle of.
 *
 * `settled` resolves when the rule has settled AND its completion has been
 * appended (or reported lost). It does not reject: every failure inside it is
 * already a record or an `onLostRecord`.
 */
export type RuleRun = {
  readonly jobId: string;
  readonly occurrenceId: OccurrenceId;
  readonly settled: Promise<void>;
};

/**
 * **WHETHER A LOADED JOB COULD ACTUALLY RUN — the fact the `ARMED` headline is
 * now made of.**
 *
 * GPT Sol's S8-7: `overseer status` derived that word from an environment
 * variable alone, so systemd could be active, the daemon healthy and the
 * headline green while both standing jobs were unauthorised or had failed to
 * build. The one line a person trusts was saying the opposite of the truth.
 *
 * Two questions, and a job has to pass both. **Is its behaviour still the one
 * that was pinned**, which is the gate `schedulerTick` applies every tick; and
 * **does this process hold the capability its work needs**, which is what makes
 * a rules-only daemon honest about its session jobs rather than merely quiet
 * about them.
 *
 * It says nothing about the clock. A job that is eligible but not due is
 * eligible; whether it is due changes every second and is not what a headline
 * is claiming.
 */
export type JobEligibility =
  | { readonly kind: "eligible"; readonly jobId: string }
  | { readonly kind: "ineligible"; readonly jobId: string; readonly why: string }
  /**
   * **AUTHORISED, RUNNABLE, AND DELIBERATELY NOT LIVE.** Not eligible — it
   * cannot earn `ARMED`, because it will never start anything — and not a
   * fault either, which is why it is its own arm rather than an `ineligible`.
   * Folding the two would make the activation preflight, which stops on any
   * `ineligible`, refuse to arm a box because its harmless fixture job is doing
   * exactly what it was pinned to do. Plan 260910e § D5.
   */
  | { readonly kind: "dry-run"; readonly jobId: string; readonly why: string };

/** The capabilities a process holds — `TickInput.launch` and `TickInput.rules`, as booleans, because this asks a yes/no question of them. `session` is a launch protocol. */
export type HeldCapabilities = { readonly session: boolean; readonly rules: boolean };

/**
 * `evidence` is the session jobs' documents as they are now. **Absent means the
 * definitions were built from the checkout a moment ago**, so their own
 * digests are the fresh reading — `schedulerWiring` and the activation
 * preflight. A long-running holder of definitions (the daemon) must pass it,
 * and does: see `schedulerStandingOf`.
 */
export function eligibilityOf(jobs: readonly AuthorisedJob[], held: HeldCapabilities, evidence?: DocumentEvidence): readonly JobEligibility[] {
  const reading = evidence ?? evidenceAsBuilt(jobs);
  const duplicateIds = duplicateJobIds(jobs);
  return jobs.map((job) => {
    const jobId = job.definition.behaviour.id;
    // THE PLANNER REFUSES EVERY DEFINITION SHARING AN ID. A headline that
    // counted those same definitions as runnable could say ARMED while a tick
    // correctly launched none of them.
    if (duplicateIds.has(jobId)) return { kind: "ineligible", jobId, why: DUPLICATE_WHY };
    // THE SAME GATE THE TICK APPLIES, over the same kind of evidence — so the
    // headline and the refusal cannot disagree about a document.
    const authorisation = authorisationUnder(job, reading);
    if (authorisation.kind === "unauthorised") return { kind: "ineligible", jobId, why: authorisation.why };
    const dispatch = job.definition.behaviour.dispatch;
    // A DRY-RUN NEEDS NO LAUNCH CAPABILITY: it is authorised precisely to stop
    // before reservation. Checking for a spawner or rule runner first made an
    // inert fixture an activation blocker in a process that could not launch it
    // anyway, contrary to this arm's contract.
    if (dispatch.kind === "dry-run") return { kind: "dry-run", jobId, why: `pinned as dry-run, so it will never start anything: ${dispatch.why}` };
    const work = job.definition.behaviour.work;
    if (work.kind === "session" && !held.session) {
      return { kind: "ineligible", jobId, why: "this daemon holds no launch protocol, so it cannot start a Claude session for this job" };
    }
    if (work.kind === "rule" && !held.rules) {
      return { kind: "ineligible", jobId, why: "this daemon holds no rule capability, so it cannot run this rule" };
    }
    return { kind: "eligible", jobId };
  });
}

/**
 * **THE WORD THE STATUS PAGE PRINTS, derived from the definitions and not from
 * a switch.**
 *
 * A function rather than four lines inside `runOverseer` for the reason
 * `schedulerWiring` is a function: GPT Sol's S8-7 was a decision taken inline
 * inside something that starts a daemon, and a decision taken there is one no
 * test can ask about. This one can be, and `tests/overseer-schedules.test.ts`
 * asks it.
 *
 * `off` is the absence of jobs — nobody switched it on. `blocked` is the switch
 * on and not one loaded job able to run, which used to print as `ARMED`.
 */
export function schedulerStandingOf(input: {
  readonly jobs:
    | {
        readonly definitions: readonly AuthorisedJob[];
        readonly held: HeldCapabilities;
        /**
         * The session jobs' documents AS THEY ARE NOW — `eligibilityOf` says what
         * absent means. The daemon passes a fresh reading on every checkpoint
         * (Sol's P1-1 on plan 260910e), so `ARMED` cannot outlive the job that
         * earned it.
         */
        readonly evidence?: DocumentEvidence;
      }
    | undefined;
  readonly detail: string | undefined;
  readonly at: string;
}): StoredScheduler {
  if (input.jobs === undefined) {
    return { kind: "off", why: input.detail ?? "this daemon was started with no scheduled jobs at all, so nothing will be dispatched", at: input.at };
  }
  const eligibility = eligibilityOf(input.jobs.definitions, input.jobs.held, input.jobs.evidence);
  const eligible = eligibility.filter((one) => one.kind === "eligible");
  const detail = input.detail ?? `${input.jobs.definitions.length} scheduled job(s)`;
  if (eligible.length > 0) return { kind: "armed", why: `${eligible.length} of ${eligibility.length} job(s) can run: ${detail}`, at: input.at };
  return {
    kind: "blocked",
    why:
      "the scheduler is switched on and NOT ONE loaded job can run, so nothing will be dispatched however due it is: " +
      (eligibility.length === 0
        ? "no job definitions were built at all"
        : eligibility.map((one) => (one.kind === "eligible" ? one.jobId : `${one.jobId} — ${one.why}`)).join("; ")) +
      `. ${detail}`,
    at: input.at,
  };
}

/**
 * One pass of the scheduler: sweep what nobody can account for, read the
 * documents the session jobs lean on, let the planner decide, and do what it
 * decided.
 *
 * **What is left here is the order of the side effects**, not the gates: the
 * sweep first (so one tick both reports a stuck run and lets its job move on),
 * the reading second (so the planner is handed a value), and the reservation →
 * spawn → record dance inside `launch`, which answers the planner truthfully —
 * a failed reservation or a refusal moves no spacing clock.
 */
export function schedulerTick(input: TickInput): readonly SchedulerReport[] {
  const at = input.now();
  const nowMs = at.getTime();
  const atIso = at.toISOString();
  // `sweep` runs whatever the ledger's state: what it can see is still worth
  // writing down, and it starts nothing.
  const reports: SchedulerReport[] = [...sweep(input, atIso, nowMs)];
  // WHAT EACH JOB'S SIDE EFFECTS SAID — a supersession, then the launch or the
  // resume — kept so they come out in the job's place in the list, not in the
  // order the ports happened to be called. By id: only a job past the
  // duplicate gate reaches a port, so an id there names one definition.
  const said = new Map<string, SchedulerReport[]>();
  const say = (jobId: string, more: readonly SchedulerReport[]): void => {
    said.set(jobId, [...(said.get(jobId) ?? []), ...more]);
  };
  // ONE MERGE OF THE TWO LEDGERS, the same function the preview uses (F2, P3).
  const sessionJobIds = new Set(input.definitions.filter((job) => job.definition.behaviour.work.kind === "session").map((job) => job.definition.behaviour.id));
  const merged = scheduleIndexOf({
    ledger: input.store.occurrences,
    ledgerHistory: input.store.occurrenceHistory,
    journal: journalOf(input.launch),
    sessionJobIds,
  });
  const plans = planJobs(
    {
      definitions: input.definitions,
      occurrences: merged.occurrences,
      history: merged.history,
      arming: input.arming,
      launchSeparationMs: input.launchSeparationMs,
      nowMs,
      // READ NOW, EVERY TICK, AND ONLY FOR SESSION JOBS — `TickInput.readDocument`.
      evidence: resolveEvidence(input.definitions, input.readDocument),
      accounts: input.accounts ?? NO_ACCOUNT_CHOICE,
    },
    {
      launch: (job, how) => {
        const outcome = launchJob(input, job, how, atIso, nowMs);
        say(job.definition.behaviour.id, outcome.reports);
        return outcome.launched;
      },
      supersede: (job, occurrence, why) => {
        const outcome = supersedeWaiting(input.launch, job.definition.behaviour.id, occurrence, why);
        say(job.definition.behaviour.id, outcome.reports);
        return outcome.superseded;
      },
    },
  );
  for (const plan of plans) {
    const own = said.get(plan.jobId) ?? [];
    reports.push(...own, ...reportsOf(plan, own));
  }
  return reports;
}

/** The journal to read this tick, or none. A `view()` that throws is a journal that could not be read — which holds session jobs, rather than throwing out of the daemon's timer. */
function journalOf(launch: SchedulerLaunch | undefined): LaunchJournalReading | undefined {
  if (launch === undefined) return undefined;
  try {
    return launch.view();
  } catch (cause) {
    const why = `the launch journal's view could not be opened (${cause instanceof Error ? cause.message : String(cause)})`;
    return {
      status: () => {
        throw new Error(why);
      },
      fold: () => {
        throw new Error(why);
      },
    };
  }
}

/**
 * One verdict as the reports the log has always carried. `dispatch` and
 * `resume` are the arms whose reports were made elsewhere — by the ports — and
 * `own` holds them.
 */
function reportsOf(plan: JobPlan, own: readonly SchedulerReport[]): readonly SchedulerReport[] {
  switch (plan.kind) {
    case "history-lost":
      return [{ kind: "history-lost", jobId: plan.jobId, why: plan.why }];
    case "duplicate-id":
      return [{ kind: "duplicate-id", jobId: plan.jobId, why: plan.why }];
    case "unauthorised":
      return [{ kind: "unauthorised", jobId: plan.jobId, why: plan.why }];
    case "held":
      return [{ kind: "held", jobId: plan.jobId, why: plan.why }];
    case "waiting":
      return [{ kind: "waiting", jobId: plan.jobId, remainingMs: plan.remainingMs }];
    case "not-yet-eligible":
      return [{ kind: "not-yet-eligible", jobId: plan.jobId, firstEligibleAt: plan.firstEligibleAt, remainingMs: plan.remainingMs }];
    case "dry-run":
      return [{ kind: "dry-run", jobId: plan.jobId, why: plan.why }];
    case "spacing-held":
      return [{ kind: "spacing-held", jobId: plan.jobId, remainingMs: plan.remainingMs, why: plan.why }];
    case "usage-held":
      return [{ kind: "usage-held", jobId: plan.jobId, why: plan.why, until: plan.until }];
    case "dispatch":
    case "resume":
      // A PLANNED LAUNCH WITH NO RECORD OF IT is a bug in this file, not a
      // state of the world — but the daemon's timer must not throw over it, so
      // it is said out loud instead of swallowed.
      return own.some((report) => report.kind !== "superseded")
        ? []
        : [{ kind: "not-dispatched", jobId: plan.jobId, why: "the planner reported a launch that this tick has no record of making" }];
    default: {
      const never: never = plan;
      throw new Error(`no report for plan ${JSON.stringify(never)}`);
    }
  }
}

/**
 * Write down every run nobody can account for, BEFORE deciding what is due.
 *
 * Before, and not after, so a single tick both reports the stuck run and lets the
 * job move on — the alternative costs a whole interval of silence after every
 * crash, and silence is the thing this module is arranged against.
 *
 * Each occurrence is written down **once**: appending `job-occurrence-unknown`
 * turns a `derived` unknown into a `recorded` one and takes a lease-expired
 * occurrence out of `leaseExpired`, so the next tick has nothing to say. Without
 * that, a single crash would put a line in the log every thirty seconds for ever.
 */
function sweep(input: TickInput, at: string, nowMs: number): readonly SchedulerReport[] {
  const reports: SchedulerReport[] = [];
  for (const occurrence of input.store.occurrences.values()) {
    const overdue = leaseExpired(occurrence, nowMs);
    const abandoned = occurrence.kind === "unknown" && occurrence.source.kind === "derived";
    if (!overdue && !abandoned) continue;
    const why = overdue ? leaseWhy(occurrence, nowMs) : occurrence.kind === "unknown" ? occurrence.why : "";
    const written = record(input.store, [{ kind: "job-occurrence-unknown", at, occurrenceId: occurrence.id, why }]);
    if (!written.ok) {
      // The store is refusing writes, which the daemon's own guard will stop it
      // for. Say so per job rather than swallowing it: this is the one path where
      // failing to write means the alarm itself was lost.
      reports.push({ kind: "not-dispatched", jobId: occurrence.key.jobId, why: `could not record an unaccounted run: ${written.why}` });
      continue;
    }
    reports.push(
      overdue
        ? {
            kind: "stuck",
            jobId: occurrence.key.jobId,
            occurrenceId: occurrence.id,
            overdueMs: overdueMsOf(occurrence, nowMs),
            why,
          }
        : { kind: "unaccounted", jobId: occurrence.key.jobId, occurrenceId: occurrence.id, why },
    );
  }
  return reports;
}

function overdueMsOf(occurrence: Occurrence, nowMs: number): number {
  const standing = standingOf(occurrence, nowMs);
  return standing.kind === "stuck" ? standing.overdueMs : 0;
}

function leaseWhy(occurrence: Occurrence, nowMs: number): string {
  const overdueMs = overdueMsOf(occurrence, nowMs);
  const started = occurrence.kind === "started" ? `pid ${occurrence.pid} ` : "";
  return (
    `${started}held a lease that ran out ${Math.round(overdueMs / 1000)}s ago and nothing said how the run ended, ` +
    "so the guard is released and this run is recorded as unaccounted for rather than retried"
  );
}

/**
 * What a launch produced: its reports, **and whether a session was launched or
 * may have been**, which is what the planner's spacing clock counts. The flag
 * rather than an inspection of the reports: "did this start a process" is a
 * fact the launching function knows and a caller matching on report kinds would
 * be re-deriving.
 */
type Launched = { readonly launched: boolean; readonly reports: readonly SchedulerReport[] };

/**
 * One job the planner decided to start, the way its `how` says. Every gate is
 * behind it — the history, the id, the pin, the clock, dry-run, spacing and the
 * account are `planJobs`'s — so what is left here is the side effect.
 */
function launchJob(input: TickInput, job: AuthorisedJob, how: LaunchHow, at: string, nowMs: number): Launched {
  switch (how.kind) {
    case "rule":
      return runRule(input, job.definition, at, nowMs);
    case "new-session":
      return planSession(input, job, how);
    case "resume":
      return resumeSession(input, job.definition.behaviour.id, how.occurrence.launchId, how.occurrence.standing.kind === "resumable" ? how.occurrence.standing.account : null);
    default: {
      const never: never = how;
      throw new Error(`no launch for ${JSON.stringify(never)}`);
    }
  }
}

/**
 * A RULE the planner decided to run: reserve, start, record.
 *
 * This is only the ordering that makes a crash visible. `definition` is the job
 * AS AUTHORISED. A rule starts no session, so it never moves the spacing gate:
 * `launched` is false on every path.
 */
function runRule(input: TickInput, definition: JobDefinition, at: string, nowMs: number): Launched {
  const jobId = definition.behaviour.id;
  const held = (reports: readonly SchedulerReport[]): Launched => ({ launched: false, reports });

  // A RESERVATION IS THE LAUNCH as far as the ledger is concerned, which is
  // why the spacing gate sits before this function rather than inside it: one
  // written here would ration the NEXT job against a session that never started.
  const key: OccurrenceKey = { jobId, scheduledAt: at, behaviourHash: behaviourHash(definition.behaviour) };
  const id = occurrenceId(key);
  const leaseUntil = new Date(nowMs + definition.schedule.leaseMs).toISOString();

  // (1) THE RESERVATION, AND NOTHING HAPPENS UNTIL IT IS ON THE DISK.
  // `store.append` fsyncs before it returns, so a `true` here means the bytes
  // survive a power cut; anything else means we must not start.
  const reserved = record(input.store, [
    {
      kind: "job-occurrence-reserved",
      at,
      jobId: key.jobId,
      scheduledAt: key.scheduledAt,
      behaviourHash: key.behaviourHash,
      occurrenceId: id,
      instanceId: input.store.instanceId,
      leaseUntil,
      what: definition.behaviour.what,
    },
  ]);
  if (!reserved.ok) {
    return held([{ kind: "not-dispatched", jobId, why: `the reservation could not be recorded, so nothing was started: ${reserved.why}` }]);
  }

  // (2) THE SPAWN — or, for a rule, the two-phase protocol below.
  let outcome: JobSpawn;
  try {
    outcome = start(input, definition, id);
  } catch (cause) {
    // A THROW IS NOT A REFUSAL, and this is the distinction the whole file is
    // about. `refused` claims the job did not start; a runner that broke its
    // contract has told us nothing about whether a process exists, so the only
    // honest record is `unknown` — and an unknown is never retried.
    const why = `the runner threw instead of answering: ${cause instanceof Error ? cause.message : String(cause)}`;
    const wrote = record(input.store, [{ kind: "job-occurrence-unknown", at, occurrenceId: id, why }]);
    // AND IF THAT APPEND FAILED, SAY SO. It used to be dropped, which left the
    // occurrence durably `reserved` while this report claimed it was accounted
    // for — a report disagreeing with the history is the shape of C5.
    return held([{ kind: "unaccounted", jobId, occurrenceId: id, why }, ...lostReports(wrote, jobId, id, "unknown")]);
  }
  if (outcome.kind === "refused") {
    const wrote = record(input.store, [{ kind: "job-occurrence-refused", at, occurrenceId: id, why: outcome.why }]);
    // THE REFUSAL IS STILL REPORTED — the runner told us the job did not start,
    // and that is true whether or not we managed to write it down. What changes
    // is that the failure to write it down is no longer silent: the occurrence
    // stays `reserved` on disk and a later instance will read it as `unknown`.
    return held([{ kind: "refused", jobId, occurrenceId: id, why: outcome.why }, ...lostReports(wrote, jobId, id, "refused")]);
  }

  // (3) THE ACKNOWLEDGEMENT. If this does not land, the occurrence stays
  // `reserved` — and a later instance reads that as `unknown`, which is exactly
  // right: a process was started and nothing durable says so.
  const started = record(input.store, [
    { kind: "job-occurrence-started", at: input.now().toISOString(), occurrenceId: id, pid: outcome.pid, leaseUntil },
  ]);
  const reports: SchedulerReport[] = [{ kind: "dispatched", jobId, occurrenceId: id, pid: outcome.pid }];
  if (!started.ok) {
    reports.push({
      kind: "not-dispatched",
      jobId,
      why: `pid ${outcome.pid} was started and the acknowledgement could not be recorded (${started.why}), so this run is unaccountable`,
    });
  }

  // The completion, whenever it comes. A promise that never settles appends
  // nothing, which is what the lease is for.
  //
  // THIS IS THE ONE PATH THAT CANNOT REACH THE REPORT, because the tick returned
  // long ago — so a failed completion append goes to `onLostRecord`, and a
  // daemon that supplies none is choosing to lose it. It must not throw: the
  // alternative to a note here is a rejected promise nobody awaits, which is an
  // unhandled rejection and the child's outcome gone as well.
  const lost = (fact: LostRecord["fact"], why: string): void => {
    input.onLostRecord?.({ jobId, occurrenceId: id, fact, why });
  };
  const settled = outcome.done.then(
    (result) => {
      const wrote = record(input.store, [{ kind: "job-occurrence-finished", at: input.now().toISOString(), occurrenceId: id, outcome: result }]);
      if (!wrote.ok) {
        lost(
          "finished",
          `the run ended (${result.kind === "exited" ? `exit ${result.code}` : `failed: ${result.why}`}) and the completion could not be recorded: ${wrote.why}`,
        );
      }
    },
    (cause: unknown) => {
      // A REJECTED PROMISE IS A FINISH, not an unknown: the runner watched the
      // work and is telling us it broke. `failed` carries the sentence; an
      // exit code would have to be invented.
      const why = cause instanceof Error ? cause.message : String(cause);
      const wrote = record(input.store, [
        {
          kind: "job-occurrence-finished",
          at: input.now().toISOString(),
          occurrenceId: id,
          outcome: { kind: "failed", why },
        },
      ]);
      if (!wrote.ok) lost("finished", `the run broke (${why}) and that could not be recorded either: ${wrote.why}`);
    },
  );
  // A RULE RUNS IN THIS PROCESS, AND THAT IS THE WHOLE DIFFERENCE. A session is
  // a child with a durable reservation behind it, so a shutdown mid-run leaves a
  // record; a rule's `observe` is in flight inside the daemon, so a shutdown
  // mid-run closes the store underneath its own settlement and loses BOTH
  // endings — leaving a `started` occurrence that the next boot reads as
  // unaccountable. GPT Sol's SC-1, the half that bites today.
  //
  // So the promise is handed out rather than dropped. The scheduler cannot wait
  // for it — `schedulerTick` is synchronous, and it must stay so, because the
  // lease rather than a held promise is what guards overlap — so waiting is the
  // daemon's, at the one moment it matters.
  input.onRuleRun?.({ jobId, occurrenceId: id, settled });
  return { launched: false, reports };
}

/**
 * What actually starts, once the reservation is on the disk.
 *
 * **A switch on the definition's own hashed `work`**, never on its id. Choosing
 * executable code by `definition.id` is exactly what GPT Sol's SP-1 blocked: the
 * id is in the fingerprint, but so is nothing about what the id then selected,
 * so a rule's threshold or its action could move while the pin stayed valid.
 * Here the arm and its whole configuration are the thing that was authorised.
 *
 * **A missing capability is a REFUSAL, and refusals are facts.** A rule job in a
 * process holding no rule runner meets a sentence in the log rather than a
 * dispatch. A session job never reaches here at all: it starts through the
 * launch protocol (`TickInput.launch`), and this path refuses one outright.
 */
function start(input: TickInput, definition: JobDefinition, id: OccurrenceId): JobSpawn {
  const work = definition.behaviour.work;
  switch (work.kind) {
    case "session":
      return { kind: "refused", why: "a session job starts only through the launch protocol, never through the rule path" };
    case "rule":
      // HANDED STRAIGHT OVER TO THE PINNED PROTOCOL, which is what reads the
      // hashed `disposition` and chooses a runner and a capability. Nothing
      // about WHAT a rule may do is decided here.
      //
      // **That is narrower than "no edit to this file can change how a rule
      // behaves", which is what this comment used to claim and is false** (GPT
      // Sol's finding 3 on 3b). This file still owns the authorisation gate,
      // the lease, `sweep`'s release of an expired one, and the reservation —
      // so an edit here can change WHETHER a rule runs and HOW OFTEN, including
      // letting two runs overlap, without moving any rule's fingerprint. What
      // the pin covers is the rule's own policy and the append-before-act
      // protocol; the scheduler and the store are a reviewed execution base
      // outside it. `rule-jobs.ts` § What the fingerprint does NOT cover.
      return startRule({ store: input.store, now: input.now }, work.rule, id, { rules: input.rules, acting: input.acting });
    default: {
      const never: never = work;
      throw new Error(`no way to start job work ${JSON.stringify(never)}`);
    }
  }
}

/**
 * A failed append, as a report — or nothing at all when it landed.
 *
 * A helper rather than four `if`s, so that adding a fifth append cannot quietly
 * be the one nobody wired up: the call site returns `...lostReports(...)` beside
 * the fact it was trying to record, and an ignored result is visible as an
 * ignored result.
 */
function lostReports(
  wrote: { ok: true } | { ok: false; why: string },
  jobId: string,
  id: OccurrenceId,
  fact: LostRecord["fact"],
): readonly SchedulerReport[] {
  if (wrote.ok) return [];
  return [{ kind: "unrecorded", jobId, occurrenceId: id, fact, why: wrote.why }];
}

/* ------------------------------------------------------------------ *
 * A session job, through the launch protocol (plan 260910f scheduled
 * dispatch, § D2–D4 and F1).
 * ------------------------------------------------------------------ */

/** A launch-protocol call that must not throw out of the daemon's timer. A throw may have reached the launcher, so it counts against spacing. */
function called(jobId: string, via: "new" | "resume", account: string | null, call: () => LaunchOutcome): Launched {
  try {
    const outcome = call();
    return { launched: outcome.kind === "invoked", reports: [{ kind: "launch", jobId, via, account, outcome }] };
  } catch (cause) {
    return {
      launched: true,
      reports: [
        {
          kind: "not-dispatched",
          jobId,
          why:
            `the launch protocol threw (${cause instanceof Error ? cause.message : String(cause)}); whether its launcher was reached is for its ` +
            "reconciliation to find out, so this counts as a launch for spacing",
        },
      ],
    };
  }
}

/** What the journal already holds under an id, asked before a plan so the scheduler never plans an id twice. */
type InJournal =
  | { readonly kind: "absent" }
  | { readonly kind: "resumable" }
  | { readonly kind: "present"; readonly state: LaunchRecord["state"] }
  | { readonly kind: "carried" }
  | { readonly kind: "unreadable"; readonly why: string };

function inJournal(capability: SchedulerLaunch, id: LaunchOccurrenceId): InJournal {
  try {
    const fold = capability.view().fold();
    if (fold.carried.has(id)) return { kind: "carried" };
    const found = fold.occurrences.get(id);
    if (found === undefined) return { kind: "absent" };
    if (found.state === "planned" || found.state === "waiting-admission") return { kind: "resumable" };
    return { kind: "present", state: found.state };
  } catch (cause) {
    return { kind: "unreadable", why: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * **A NEW OCCURRENCE OF A SESSION JOB**: keyed at its nominal due instant, its
 * material pinned, planned and driven by `launchOccurrence` on the
 * `tmux-headless` launcher in the `claude-session` class.
 *
 * The order is the point. (1) An id already in the journal is resumed if it can
 * be and otherwise left alone — **the scheduler never calls `launchOccurrence`
 * for an id already in the fold** (F1's narrow check). (2) The material is
 * built before anything is written, so a moved document costs nothing. (3)
 * Only then is the protocol asked.
 */
function planSession(input: TickInput, job: AuthorisedJob, how: Extract<LaunchHow, { readonly kind: "new-session" }>): Launched {
  const behaviour = job.definition.behaviour;
  const jobId = behaviour.id;
  const refuse = (why: string): Launched => ({ launched: false, reports: [{ kind: "not-dispatched", jobId, why }] });
  const work = behaviour.work;
  if (work.kind !== "session") return refuse("a rule was handed to the session path, which is a bug in the planner");
  const capability = input.launch;
  if (capability === undefined) return refuse(NO_LAUNCH_JOURNAL_WHY);

  // THE KEY, AND FROM IT THE ID — recomputed, never stored (D1). The due
  // instant rather than the tick's clock, so the same waiting occurrence is
  // found again on the next tick and after a restart (D5).
  const key: OccurrenceKey = { jobId, scheduledAt: how.dueAt, behaviourHash: behaviourHash(behaviour) };
  const origin = scheduleOrigin(key);
  const launchId = occurrenceIdOf(origin);

  // (1) NEVER PLAN AN ID TWICE.
  const existing = inJournal(capability, launchId);
  switch (existing.kind) {
    case "absent":
      break;
    case "resumable":
      return resumeSession(input, jobId, launchId, null);
    case "present":
      return {
        launched: false,
        reports: [
          {
            kind: "launch",
            jobId,
            via: "new",
            account: how.account,
            outcome: { kind: "not-launchable", occurrenceId: launchId, state: existing.state, why: `${launchId} is already in the launch journal as ${existing.state}; the scheduler never plans an occurrence twice` },
          },
        ],
      };
    case "carried":
      return {
        launched: false,
        reports: [{ kind: "launch", jobId, via: "new", account: how.account, outcome: { kind: "refused", why: `${launchId} was carried over a launch-journal history reset; only Greg's disposition moves it` } }],
      };
    case "unreadable":
      return refuse(`the launch journal could not be asked whether ${launchId} exists (${existing.why}), so nothing was planned`);
    default: {
      const never: never = existing;
      throw new Error(`no step for ${JSON.stringify(never)}`);
    }
  }

  // (2) THE MATERIAL, from the bytes the gate accepted this tick (D3).
  const material = materialOf(job, input.readDocumentBytes);
  if (!material.ok) return { launched: false, reports: [{ kind: "material-moved", jobId, why: material.why }] };

  // (3) THE RUN, ON THE CHOSEN ACCOUNT. 2b: RunSpec.account — the protocol's
  // run-spec parser refuses a field it does not know, so until 2b the request
  // carries the timeout and access only and the account stops here, in the
  // report. When 2b lands this becomes `run: scheduled`.
  const scheduled: ScheduledLaunchRun = { ...work.run, account: how.account };
  const run: RunSpec = { timeoutMinutes: scheduled.timeoutMinutes, access: scheduled.access };
  return called(jobId, "new", scheduled.account, () =>
    capability.launchOccurrence({ origin, material: material.text, admissionClass: "claude-session", launcherKind: "tmux-headless", run }),
  );
}

/**
 * **A WAITING OCCURRENCE, DRIVEN ON FROM ITS STORED RECORD** (F1): no re-plan,
 * no rebuilt request — the material, launcher, class, run spec and (from 2b)
 * account are the ones `planned` pinned, so a mechanical change to the
 * material's framing can never turn a resume into a conflict.
 */
function resumeSession(input: TickInput, jobId: string, launchId: LaunchOccurrenceId, account: string | null): Launched {
  const capability = input.launch;
  if (capability === undefined) return { launched: false, reports: [{ kind: "not-dispatched", jobId, why: NO_LAUNCH_JOURNAL_WHY }] };
  return called(jobId, "resume", account, () => capability.resumeOccurrence(launchId));
}

/**
 * Abandon a waiting occurrence that is no longer the one to run, and say when
 * it ended — the instant its replacement is keyed at. A refused abandon, or one
 * the journal does not show, plans nothing this tick.
 */
function supersedeWaiting(
  capability: SchedulerLaunch | undefined,
  jobId: string,
  occurrence: LaunchOccurrence,
  why: string,
): { readonly superseded: Superseded; readonly reports: readonly SchedulerReport[] } {
  if (capability === undefined) return { superseded: { kind: "refused", why: NO_LAUNCH_JOURNAL_WHY }, reports: [] };
  let answer: AbandonResult;
  try {
    answer = capability.abandon(occurrence.launchId, why);
  } catch (cause) {
    return { superseded: { kind: "refused", why: `the launch protocol threw (${cause instanceof Error ? cause.message : String(cause)})` }, reports: [] };
  }
  if (answer.kind === "refused") return { superseded: { kind: "refused", why: answer.why }, reports: [] };
  const reports: SchedulerReport[] = [{ kind: "superseded", jobId, launchId: occurrence.launchId, why, reservation: answer.reservation }];
  let endedAt: string | null = null;
  try {
    const found = capability.view().fold().occurrences.get(occurrence.launchId);
    endedAt = found?.state === "failed-before-launch" ? found.endedAt : null;
  } catch {
    endedAt = null;
  }
  if (endedAt === null) {
    return { superseded: { kind: "refused", why: `${occurrence.launchId} was abandoned and the launch journal does not say when, so its replacement waits for the next tick` }, reports };
  }
  return { superseded: { kind: "replaced", at: endedAt }, reports };
}

/** The sentence the material ends with. The framing is this file's, not pinned — the same boundary `rule-jobs.ts` states for the scheduler — and what is pinned is the `what` and each document's digest. */
export const MATERIAL_CLOSING = "The documents above are the authorised text; follow them, not the copies on disk.";

export type Material = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly why: string };

/**
 * **THE MATERIAL HANDED TO THE CHILD, PINNED** — plan 260910f (scheduled
 * dispatch) § D3.
 *
 * A session used to be told "follow `docs/…/x.md`" and read the file minutes
 * later, which left a window where an edited document ran under an old pin.
 * So each authorised document's bytes are read ONCE, their digest compared with
 * the one the pin gate accepted this tick (the job handed here carries it), and
 * the text handed over verbatim: the job's `what`, then each document under a
 * header naming its path and sha256, then one sentence saying these are the
 * authorised text. The protocol then pins `material.txt`, re-hashes it before
 * launch, and hands the child exactly those bytes (its F5).
 *
 * **A mismatch refuses this tick** (`material-moved`), which is a report and
 * not an occurrence. So does a document that is not UTF-8 text: the material is
 * a string, and bytes that do not survive the round trip are not verbatim.
 */
export function materialOf(job: AuthorisedJob, read: ReadDocumentBytes | undefined): Material {
  const behaviour = job.definition.behaviour;
  if (behaviour.documents.length === 0) return { ok: true, text: `${behaviour.what}\n` };
  if (read === undefined) {
    return { ok: false, why: "this process holds no reader for a document's bytes, so the material cannot be built from the text that was authorised" };
  }
  const sections: string[] = [];
  for (const document of behaviour.documents) {
    const got = read(document.path);
    if (got.kind === "unreadable") return { ok: false, why: `${document.path} could not be read for the material (${got.why}), so nothing was planned` };
    if (got.sha256 !== document.sha256) {
      return {
        ok: false,
        why:
          `${document.path} reads as ${got.sha256.slice(0, 12)} for the material and was authorised as ${document.sha256.slice(0, 12)} this tick: ` +
          "it moved between the gate's reading and the material's, so nothing was planned",
      };
    }
    const text = got.bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(got.bytes)) return { ok: false, why: `${document.path} is not UTF-8 text, so it cannot be handed over verbatim` };
    const fence = fenceFor(text);
    sections.push(`${document.path} (sha256 ${document.sha256})\n${fence}\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}`);
  }
  return { ok: true, text: [behaviour.what, "", "The documents this job follows, as they were authorised:", "", sections.join("\n\n"), "", MATERIAL_CLOSING, ""].join("\n") };
}

/** A backtick fence longer than any run of backticks in the text, so a document's own code blocks cannot close it. */
function fenceFor(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return "`".repeat(Math.max(3, longest + 1));
}

function describeLaunch(report: Extract<SchedulerReport, { readonly kind: "launch" }>): string {
  const { jobId, outcome } = report;
  const on = report.account === null ? "" : ` on pool account ${report.account}`;
  const how = report.via === "resume" ? "resumed" : "planned";
  switch (outcome.kind) {
    case "invoked":
      return (
        `job ${jobId}: LAUNCHER INVOKED for ${outcome.occurrenceId} (${outcome.correlationId}, ${how}${on}) — ` +
        (outcome.launcher === "started" ? `the launcher answered: ${outcome.detail}` : `the launcher threw (${outcome.detail}), so it may or may not have had its effect`) +
        ". That is not a result: the launch journal and the run's exit.json say how it ends"
      );
    case "waiting":
      return `job ${jobId}: WAITING FOR ADMISSION — ${outcome.occurrenceId} (${how}${on}): ${outcome.why}; it is asked again on the next tick`;
    case "refused":
      return `job ${jobId}: LAUNCH REFUSED — ${outcome.why}`;
    case "conflict":
      return `job ${jobId}: LAUNCH CONFLICT — ${outcome.occurrenceId}: ${outcome.why}`;
    case "not-launchable":
      return `job ${jobId}: NOT LAUNCHED — ${outcome.occurrenceId} is ${outcome.state}: ${outcome.why}`;
    case "failed-before-launch":
      return (
        `job ${jobId}: FAILED BEFORE LAUNCH — ${outcome.occurrenceId} (${outcome.proof}): ${outcome.why}; ` +
        (outcome.reservation.kind === "released" ? "it holds no slot" : `its slot is still held (${outcome.reservation.why})`)
      );
    case "not-launched":
      return `job ${jobId}: NOT LAUNCHED — ${outcome.occurrenceId}: ${outcome.why}`;
    default: {
      const never: never = outcome;
      throw new Error(String(never));
    }
  }
}

/** One report as a line for the daemon's log. The stuck ones are shouted, because they are the ones that used to be silent. */
export function describeReport(report: SchedulerReport): string {
  switch (report.kind) {
    case "dispatched":
      return `job ${report.jobId}: dispatched ${report.occurrenceId} as pid ${report.pid}`;
    case "refused":
      return `job ${report.jobId}: the runner refused ${report.occurrenceId} — ${report.why}`;
    case "not-dispatched":
      return `job ${report.jobId}: NOT DISPATCHED — ${report.why}`;
    case "held":
      return `job ${report.jobId}: held — ${report.why}`;
    case "waiting":
      return `job ${report.jobId}: not due for another ${Math.round(report.remainingMs / 1000)}s`;
    case "not-yet-eligible":
      return `job ${report.jobId}: never run; first eligible at ${report.firstEligibleAt} (${Math.round(report.remainingMs / 1000)}s away)`;
    case "spacing-held":
      return `job ${report.jobId}: WAITING FOR SPACING — ${report.why}`;
    case "dry-run":
      return `job ${report.jobId}: DRY RUN — ${report.why}`;
    case "duplicate-id":
      return `job ${report.jobId}: DUPLICATE ID — ${report.why}`;
    case "unauthorised":
      return `job ${report.jobId}: NOT AUTHORISED — ${report.why}`;
    case "history-lost":
      return `job ${report.jobId}: HELD — ${report.why}`;
    case "unrecorded":
      return `job ${report.jobId}: NOT RECORDED — ${report.occurrenceId} ${report.fact} could not be written down: ${report.why}`;
    case "stuck":
      return `job ${report.jobId}: STUCK — ${report.occurrenceId} ${report.why}`;
    case "unaccounted":
      return `job ${report.jobId}: UNACCOUNTED — ${report.occurrenceId} ${report.why}`;
    case "launch":
      return describeLaunch(report);
    case "material-moved":
      return `job ${report.jobId}: MATERIAL MOVED — ${report.why}`;
    case "superseded":
      return (
        `job ${report.jobId}: SUPERSEDED ${report.launchId} — ${report.why}; it never launched, and ` +
        (report.reservation.kind === "released" ? "it holds no slot" : `its slot is still held (${report.reservation.why})`)
      );
    case "usage-held":
      return `job ${report.jobId}: HELD FOR A POOL ACCOUNT — ${report.why}${report.until === null ? "" : ` (expected to lift at ${report.until})`}`;
    default: {
      const never: never = report;
      throw new Error(String(never));
    }
  }
}
