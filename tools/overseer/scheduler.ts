/**
 * The scheduler: the one place a job goes from "due" to "running", and the
 * ordering that makes a crash in between visible instead of silent.
 *
 * `jobs.ts` is the arithmetic and `store.ts` is the durability; this file is the
 * three-step dance between them, and it is short on purpose because every line
 * of it is ordering.
 *
 *     append `reserved` and fsync it   ──▶  spawn  ──▶  append `started`
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
  authorisationOf,
  behaviourHash,
  due,
  lastRunOf,
  lastSessionLaunchOf,
  leaseExpired,
  occurrenceId,
  standingOf,
  type Arming,
  type AuthorisedJob,
  type JobDefinition,
  type JobSpawn,
  type Occurrence,
  type OccurrenceHistory,
  type OccurrenceId,
  type OccurrenceIndex,
  type OccurrenceKey,
  type SpawnJob,
} from "./jobs.js";
import { record, startRule, type ActingRuleWork, type ProposingRuleWork } from "./rule-protocol.js";
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
  | { readonly kind: "dispatched"; readonly jobId: string; readonly occurrenceId: OccurrenceId; readonly pid: number }
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
   * **OPTIONAL, AND THAT IS THE DETERMINISTIC-ONLY ARMING PATH.**
   *
   * GPT Sol's SP-4: there was one global switch, arming it supplied both
   * standing jobs, and both were immediately due — so there was no way to watch
   * a deterministic rule fire without starting paid model sessions under a gate
   * 4 that is admittedly unbuilt.
   *
   * The fix is a **capability, not a filter**. A daemon armed for rules only is
   * given no spawner at all, so no code in that process can create a session
   * however due a job is or however it got into the list. A job whose work is a
   * session meets a `refused` — a fact, loud in the log — rather than a
   * dispatch. `scripts/overseer.ts`'s `schedulerWiring` is the only place that
   * decides which it is.
   *
   * `| undefined` as well as optional, unlike the rest of this codebase's
   * absent-versus-undefined discipline, and deliberately: here the two mean the
   * same thing — **this process holds no such capability** — so making a caller
   * spread conditionally would buy a distinction that does not exist.
   */
  readonly spawn?: SpawnJob | undefined;
  /** LOOKING, for a rule that may only propose. Absent means such a job is refused for the same reason and in the same way as a session job with no spawner. */
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
  | { readonly kind: "ineligible"; readonly jobId: string; readonly why: string };

/** The capabilities a process holds — the same two `TickInput` carries, as booleans, because this asks a yes/no question of them. */
export type HeldCapabilities = { readonly session: boolean; readonly rules: boolean };

export function eligibilityOf(jobs: readonly AuthorisedJob[], held: HeldCapabilities): readonly JobEligibility[] {
  return jobs.map((job) => {
    const jobId = job.definition.behaviour.id;
    const authorisation = authorisationOf(job);
    if (authorisation.kind === "unauthorised") return { kind: "ineligible", jobId, why: authorisation.why };
    const work = job.definition.behaviour.work;
    if (work.kind === "session" && !held.session) {
      return { kind: "ineligible", jobId, why: "this daemon holds no session dispatcher, so it cannot start a Claude session for this job" };
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
  readonly jobs: { readonly definitions: readonly AuthorisedJob[]; readonly held: HeldCapabilities } | undefined;
  readonly detail: string | undefined;
  readonly at: string;
}): StoredScheduler {
  if (input.jobs === undefined) {
    return { kind: "off", why: input.detail ?? "this daemon was started with no scheduled jobs at all, so nothing will be dispatched", at: input.at };
  }
  const eligibility = eligibilityOf(input.jobs.definitions, input.jobs.held);
  const eligible = eligibility.filter((one) => one.kind === "eligible");
  const detail = input.detail ?? `${input.jobs.definitions.length} scheduled job(s)`;
  if (eligible.length > 0) return { kind: "armed", why: `${eligible.length} of ${eligibility.length} job(s) can run: ${detail}`, at: input.at };
  return {
    kind: "blocked",
    why:
      "the scheduler is switched on and NOT ONE loaded job can run, so nothing will be dispatched however due it is: " +
      (eligibility.length === 0
        ? "no job definitions were built at all"
        : eligibility.map((one) => (one.kind === "ineligible" ? `${one.jobId} — ${one.why}` : one.jobId)).join("; ")) +
      `. ${detail}`,
    at: input.at,
  };
}

/** One pass of the scheduler: sweep what nobody can account for, then dispatch what is due. */
export function schedulerTick(input: TickInput): readonly SchedulerReport[] {
  const at = input.now();
  const nowMs = at.getTime();
  const reports: SchedulerReport[] = [...sweep(input, at.toISOString(), nowMs)];
  // EVERY JOB IS HELD WHEN THE LEDGER IS INCOMPLETE, and it is checked here
  // rather than inside `dispatch` so that it cannot be reached round the side by
  // a later arm. `sweep` above still runs: what it can see is still worth
  // writing down, and it starts nothing.
  const history = input.store.occurrenceHistory;
  if (history.kind === "lost") {
    for (const job of input.definitions) {
      reports.push({ kind: "history-lost", jobId: job.definition.behaviour.id, why: history.why });
    }
    return reports;
  }
  const seen = new Set<string>();
  // THE SPACING GATE'S STATE, SEEDED FROM THE DISK AND UPDATED WITHIN THE TICK.
  //
  // Seeded from the ledger so it survives a restart and a day's downtime — the
  // half of S8-5 an in-memory counter would get wrong. Updated in the loop
  // because a reservation appended two lines above must count against the next
  // job in the same pass, and reading the store's index back for that would make
  // this depend on when the index is refreshed.
  const sessionJobIds = new Set(input.definitions.filter((job) => job.definition.behaviour.work.kind === "session").map((job) => job.definition.behaviour.id));
  const lastLaunch = lastSessionLaunchOf(input.store.occurrences, sessionJobIds);
  let lastLaunchMs = lastLaunch.kind === "at" ? Date.parse(lastLaunch.at) : Number.NEGATIVE_INFINITY;
  for (const job of input.definitions) {
    const definition = job.definition;
    // TWO DEFINITIONS WITH ONE ID IS A CONFIGURATION MISTAKE THAT WOULD BE
    // SILENT. Identical ones mint the same key at the same instant, so the
    // second dispatch spawns a second process and then overwrites the first's
    // acknowledgement — one occurrence in the log, two children on the box.
    // Refusing the duplicate is a line in the log; permitting it is the class of
    // failure this whole module is arranged against.
    const jobId = definition.behaviour.id;
    if (seen.has(jobId)) {
      reports.push({ kind: "not-dispatched", jobId, why: "two definitions share this id, so neither can be addressed unambiguously" });
      continue;
    }
    seen.add(jobId);
    // THE AUTHORISATION GATE, AND IT COMES BEFORE `due`. An edited definition
    // has no history, `due` reads no history as "run it now", and that pair is
    // what turned an edit into an immediate unauthorised dispatch (C2). Asking
    // here means the edited job never reaches the arithmetic at all.
    const authorisation = authorisationOf(job);
    if (authorisation.kind === "unauthorised") {
      reports.push({ kind: "unauthorised", jobId, why: authorisation.why });
      continue;
    }
    const outcome = dispatch(input, definition, at.toISOString(), nowMs, lastLaunchMs);
    // ONLY A LAUNCH MOVES THE GATE. A held, waiting or refused job started
    // nothing, so counting it would ration the next job against an event that
    // did not happen.
    if (outcome.launched) lastLaunchMs = nowMs;
    reports.push(...outcome.reports);
  }
  return reports;
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
 * One job, one decision.
 *
 * Returns the reports for it — one in every case but the dispatch that fails to
 * acknowledge — **and whether a session was launched**, which is what the
 * spacing gate in `schedulerTick` counts. The flag rather than an inspection of
 * the reports: "did this start a process" is a fact this function knows and a
 * caller matching on report kinds would be re-deriving.
 */
function dispatch(
  input: TickInput,
  definition: JobDefinition,
  at: string,
  nowMs: number,
  lastLaunchMs: number,
): { readonly launched: boolean; readonly reports: readonly SchedulerReport[] } {
  const jobId = definition.behaviour.id;
  const held = (reports: readonly SchedulerReport[]): { launched: boolean; reports: readonly SchedulerReport[] } => ({ launched: false, reports });
  const verdict = due(definition.schedule, lastRunOf(input.store.occurrences, jobId, nowMs), nowMs, input.arming);
  switch (verdict.kind) {
    case "held":
      return held([{ kind: "held", jobId, why: verdict.why }]);
    case "not-due":
      return held([{ kind: "waiting", jobId, remainingMs: verdict.remainingMs }]);
    case "not-yet-eligible":
      return held([{ kind: "not-yet-eligible", jobId, firstEligibleAt: verdict.firstEligibleAt, remainingMs: verdict.remainingMs }]);
    case "due":
      break;
    default: {
      const never: never = verdict;
      throw new Error(`no dispatch for ${JSON.stringify(never)}`);
    }
  }

  // THE LAUNCH-SPACING GATE, AFTER `due` AND BEFORE THE RESERVATION.
  //
  // After `due`, so a job that is not due is reported as not due rather than as
  // spaced — the two are different facts and only one of them is temporary.
  // Before the reservation, because a reservation is the launch as far as the
  // ledger is concerned, and one written here would ration the NEXT job against
  // a session that never started.
  //
  // Sessions only. A rule runs in this process, spends nothing and finishes in
  // milliseconds; rationing it would be rationing the wrong thing.
  if (definition.behaviour.work.kind === "session" && input.launchSeparationMs > 0) {
    const sinceMs = nowMs - lastLaunchMs;
    if (sinceMs < input.launchSeparationMs) {
      const remainingMs = input.launchSeparationMs - sinceMs;
      return held([
        {
          kind: "spacing-held",
          jobId,
          remainingMs,
          why:
            `it is due, and a Claude session was launched ${Math.round(sinceMs / 1000)}s ago — ` +
            `this box starts at most one every ${Math.round(input.launchSeparationMs / 1000)}s, so this one waits ${Math.round(remainingMs / 1000)}s`,
        },
      ]);
    }
  }

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
    outcome = start(input, definition, key, id);
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
    // THE RESERVATION LANDED AND WE CANNOT SAY WHETHER A PROCESS EXISTS, so it
    // counts against the spacing gate: an uncertain launch rations, for the same
    // reason `lastSessionLaunchOf` counts an `unknown` occurrence.
    return {
      launched: definition.behaviour.work.kind === "session",
      reports: [{ kind: "unaccounted", jobId, occurrenceId: id, why }, ...lostReports(wrote, jobId, id, "unknown")],
    };
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
  if (definition.behaviour.work.kind === "rule") input.onRuleRun?.({ jobId, occurrenceId: id, settled });
  else void settled;
  return { launched: definition.behaviour.work.kind === "session", reports };
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
 * **A missing capability is a REFUSAL, and refusals are facts.** A daemon armed
 * for deterministic rules only holds no spawner, so a session job meets a
 * sentence in the log rather than a dispatch — and there is no code in that
 * process that could have started it. See `TickInput.spawn`.
 */
function start(input: TickInput, definition: JobDefinition, key: OccurrenceKey, id: OccurrenceId): JobSpawn {
  const work = definition.behaviour.work;
  switch (work.kind) {
    case "session": {
      const spawn = input.spawn;
      if (spawn === undefined) {
        return {
          kind: "refused",
          why:
            "this daemon was started with no session dispatcher, so it cannot start a Claude session for any job — " +
            "it is armed for deterministic rules only",
        };
      }
      return spawn(definition, key);
    }
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
    default: {
      const never: never = report;
      throw new Error(String(never));
    }
  }
}
