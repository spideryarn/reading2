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
 * ## Fail closed, and what that actually means here
 *
 * **If the reservation does not land on the disk, nothing is spawned.** Not
 * "spawn and try again later", not "log a warning and carry on": a store that
 * cannot record what we are about to do is a store that cannot tell anybody it
 * happened, and an unrecorded run is the one failure the whole design is arranged
 * against. `record()` below turns every way an append can fail — a refusal, a
 * throw from the filesystem — into one closed door, and `tests/overseer-jobs.test.ts`
 * makes the append fail and asserts nothing was spawned.
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
 */
import type { JobEvent, OverseerEvent } from "./diff.js";
import {
  definitionHash,
  due,
  lastRunOf,
  leaseExpired,
  occurrenceId,
  standingOf,
  type JobDefinition,
  type JobOutcome,
  type Occurrence,
  type OccurrenceId,
  type OccurrenceIndex,
  type OccurrenceKey,
} from "./jobs.js";
import type { AppendResult } from "./store.js";

/**
 * What the runner says when it is asked to start a job.
 *
 * **It returns a result and does not throw**, and the two arms are different
 * facts: `refused` means *this did not start and I know it* (a precondition
 * failed, the binary is missing), which is a settled outcome. A throw is not in
 * the contract, and when one happens anyway the scheduler records `unknown`
 * rather than `refused` — because a function that broke its own contract is not
 * evidence about whether a process exists.
 *
 * `done` settles when the work does. A promise that never settles is not an
 * error here; it is the case the lease exists for.
 */
export type JobSpawn =
  | { readonly kind: "spawned"; readonly pid: number; readonly done: Promise<JobOutcome> }
  | { readonly kind: "refused"; readonly why: string };

export type SpawnJob = (definition: JobDefinition, key: OccurrenceKey) => JobSpawn;

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
  append(events: readonly OverseerEvent[]): AppendResult;
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
  /** THE ALARM. A lease ran out with nothing to say how the run ended. */
  | { readonly kind: "stuck"; readonly jobId: string; readonly occurrenceId: OccurrenceId; readonly overdueMs: number; readonly why: string }
  /** A reservation left behind by an instance that is gone — noticed, written down, and never retried. */
  | { readonly kind: "unaccounted"; readonly jobId: string; readonly occurrenceId: OccurrenceId; readonly why: string };

export type TickInput = {
  readonly definitions: readonly JobDefinition[];
  readonly store: OccurrenceLog;
  readonly spawn: SpawnJob;
  /** Injected, always. Nothing in this area reads the wall clock for itself. */
  readonly now: () => Date;
};

/** One pass of the scheduler: sweep what nobody can account for, then dispatch what is due. */
export function schedulerTick(input: TickInput): readonly SchedulerReport[] {
  const at = input.now();
  const nowMs = at.getTime();
  const reports: SchedulerReport[] = [...sweep(input, at.toISOString(), nowMs)];
  const seen = new Set<string>();
  for (const definition of input.definitions) {
    // TWO DEFINITIONS WITH ONE ID IS A CONFIGURATION MISTAKE THAT WOULD BE
    // SILENT. Identical ones mint the same key at the same instant, so the
    // second dispatch spawns a second process and then overwrites the first's
    // acknowledgement — one occurrence in the log, two children on the box.
    // Refusing the duplicate is a line in the log; permitting it is the class of
    // failure this whole module is arranged against.
    if (seen.has(definition.id)) {
      reports.push({ kind: "not-dispatched", jobId: definition.id, why: "two definitions share this id, so neither can be addressed unambiguously" });
      continue;
    }
    seen.add(definition.id);
    reports.push(...dispatch(input, definition, at.toISOString(), nowMs));
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

/** One job, one decision. Returns the reports for it, which is one in every case but the dispatch that fails to acknowledge. */
function dispatch(input: TickInput, definition: JobDefinition, at: string, nowMs: number): readonly SchedulerReport[] {
  const verdict = due(definition, lastRunOf(input.store.occurrences, definition, nowMs), nowMs);
  switch (verdict.kind) {
    case "held":
      return [{ kind: "held", jobId: definition.id, why: verdict.why }];
    case "not-due":
      return [{ kind: "waiting", jobId: definition.id, remainingMs: verdict.remainingMs }];
    case "due":
      break;
    default: {
      const never: never = verdict;
      throw new Error(`no dispatch for ${JSON.stringify(never)}`);
    }
  }

  const key: OccurrenceKey = { jobId: definition.id, scheduledAt: at, definitionHash: definitionHash(definition) };
  const id = occurrenceId(key);
  const leaseUntil = new Date(nowMs + definition.leaseMs).toISOString();

  // (1) THE RESERVATION, AND NOTHING HAPPENS UNTIL IT IS ON THE DISK.
  // `store.append` fsyncs before it returns, so a `true` here means the bytes
  // survive a power cut; anything else means we must not start.
  const reserved = record(input.store, [
    {
      kind: "job-occurrence-reserved",
      at,
      jobId: key.jobId,
      scheduledAt: key.scheduledAt,
      definitionHash: key.definitionHash,
      occurrenceId: id,
      instanceId: input.store.instanceId,
      leaseUntil,
      what: definition.what,
    },
  ]);
  if (!reserved.ok) {
    return [{ kind: "not-dispatched", jobId: definition.id, why: `the reservation could not be recorded, so nothing was started: ${reserved.why}` }];
  }

  // (2) THE SPAWN.
  let outcome: JobSpawn;
  try {
    outcome = input.spawn(definition, key);
  } catch (cause) {
    // A THROW IS NOT A REFUSAL, and this is the distinction the whole file is
    // about. `refused` claims the job did not start; a runner that broke its
    // contract has told us nothing about whether a process exists, so the only
    // honest record is `unknown` — and an unknown is never retried.
    const why = `the runner threw instead of answering: ${cause instanceof Error ? cause.message : String(cause)}`;
    record(input.store, [{ kind: "job-occurrence-unknown", at, occurrenceId: id, why }]);
    return [{ kind: "unaccounted", jobId: definition.id, occurrenceId: id, why }];
  }
  if (outcome.kind === "refused") {
    record(input.store, [{ kind: "job-occurrence-refused", at, occurrenceId: id, why: outcome.why }]);
    return [{ kind: "refused", jobId: definition.id, occurrenceId: id, why: outcome.why }];
  }

  // (3) THE ACKNOWLEDGEMENT. If this does not land, the occurrence stays
  // `reserved` — and a later instance reads that as `unknown`, which is exactly
  // right: a process was started and nothing durable says so.
  const started = record(input.store, [
    { kind: "job-occurrence-started", at: input.now().toISOString(), occurrenceId: id, pid: outcome.pid, leaseUntil },
  ]);
  const reports: SchedulerReport[] = [{ kind: "dispatched", jobId: definition.id, occurrenceId: id, pid: outcome.pid }];
  if (!started.ok) {
    reports.push({
      kind: "not-dispatched",
      jobId: definition.id,
      why: `pid ${outcome.pid} was started and the acknowledgement could not be recorded (${started.why}), so this run is unaccountable`,
    });
  }

  // The completion, whenever it comes. A promise that never settles appends
  // nothing, which is what the lease is for.
  void outcome.done.then(
    (result) => {
      record(input.store, [{ kind: "job-occurrence-finished", at: input.now().toISOString(), occurrenceId: id, outcome: result }]);
    },
    (cause: unknown) => {
      // A REJECTED PROMISE IS A FINISH, not an unknown: the runner watched the
      // work and is telling us it broke. `failed` carries the sentence; an
      // exit code would have to be invented.
      record(input.store, [
        {
          kind: "job-occurrence-finished",
          at: input.now().toISOString(),
          occurrenceId: id,
          outcome: { kind: "failed", why: cause instanceof Error ? cause.message : String(cause) },
        },
      ]);
    },
  );
  return reports;
}

/** Every way an append can fail, as one closed door. A refusal and a thrown filesystem error mean the same thing to a caller that must not proceed. */
function record(store: OccurrenceLog, events: readonly JobEvent[]): { ok: true } | { ok: false; why: string } {
  try {
    const result = store.append(events);
    if (result.ok) return { ok: true };
    return { ok: false, why: `the store refused the append (${result.reason})` };
  } catch (cause) {
    return { ok: false, why: `the append threw: ${cause instanceof Error ? cause.message : String(cause)}` };
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
