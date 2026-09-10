/**
 * **The planner: one list-wide pass that says, for every job, what the
 * scheduler would do with it now — and the gate order, in one place.**
 *
 * Plan 260910e § D2. Before this file the gate order lived inside
 * `schedulerTick`, interleaved with the reservation and the spawn, so the only
 * way to ask *what would run next* was to run it. A preview that answers that
 * question with a second copy of the gates would be a second copy of the one
 * thing a preview must not get wrong, so both the tick and the preview call
 * this.
 *
 * ## Pure given its inputs
 *
 * No I/O, no clock, no store. What it needs from the world arrives as values:
 * the definitions, the occurrence index and whether it is whole, the arming,
 * the launch separation, `nowMs`, and **the document evidence, read by the
 * caller** (`resolveEvidence` below is the helper the callers use; it is not
 * called from `planJobs`). Sol's P2-6: a planner that called `readDocument`
 * itself would not be pure, and would read documents on the preview's schedule
 * rather than the tick's.
 *
 * The one thing it cannot know is whether a launch succeeds, so that is
 * injected: `launch(job) → boolean` — *did a session start, or possibly start?*
 * The tick's launch reserves, spawns and records, and answers truthfully; a
 * preview's answers `true` for a live session job and says in words that rows
 * after a proposed launch assume it succeeded. The in-loop spacing clock moves
 * only on `true`, exactly as it did inside the tick.
 *
 * ## The order, and why each step is where it is
 *
 *  1. **History lost → every job held.** A cold start is not permission (C3).
 *  2. **Duplicate ids → every definition sharing an id refused, over the whole
 *     list, before anything is planned.** The old loop refused an id only on
 *     meeting it the second time, so the first definition had already been
 *     reserved and spawned while the report said *neither can be addressed*
 *     (Sol's P1-5). A per-job check cannot own a list-wide fact.
 *  3. Per job, in order:
 *     - **authorisation** — a session job against the documents as they are
 *       NOW, a rule job against its load-time digests (§ D3, and below);
 *     - **`due()`** — the clock, only for a job that got past the pin (C2);
 *     - **dry-run** — due, and deliberately not started (§ D5);
 *     - **the spacing gate** — sessions only (S8-5);
 *     - **dispatch** — `launch`.
 */
import {
  authorisationOf,
  documentDrift,
  due,
  lastRunOf,
  lastSessionLaunchOf,
  type Arming,
  type AuthorisedJob,
  type BehaviourHash,
  type JobDocument,
  type LastRun,
  type OccurrenceHistory,
  type OccurrenceIndex,
} from "./jobs.js";

/**
 * One document, read now — or the reason it could not be.
 *
 * A union rather than a `sha256: string | null`, for the reason every union in
 * this area is one: "we read it and here is its digest" and "we could not read
 * it" are two facts, and the second must carry a sentence.
 */
export type DocumentReading =
  | { readonly kind: "read"; readonly path: string; readonly sha256: string }
  | { readonly kind: "unreadable"; readonly path: string; readonly why: string };

/** How a caller reads one document. `standing-jobs.ts` § `readJobDocument` is the real one. */
export type ReadDocument = (path: string) => DocumentReading;

/**
 * **THE DOCUMENTS EACH SESSION JOB WOULD FOLLOW, AS THEY ARE NOW**, by job id.
 *
 * Session jobs only. A rule job's "documents" are the source of code already
 * loaded into this process, so re-reading them would refuse a rule whose running
 * code has not moved; its load-time digests are the right evidence and it never
 * appears here.
 */
export type DocumentEvidence = ReadonlyMap<string, readonly DocumentReading[]>;

/**
 * Read every session job's documents, once, for one tick or one checkpoint.
 *
 * **The impure half, kept out of `planJobs` on purpose.** Both the tick and the
 * daemon's headline call this with the same `readDocument`, so the verdict that
 * refuses a job and the headline that describes it are made of the same reading.
 *
 * A duplicate id is read once; the planner refuses both definitions before it
 * would look.
 */
export function resolveEvidence(definitions: readonly AuthorisedJob[], readDocument: ReadDocument): DocumentEvidence {
  const evidence = new Map<string, readonly DocumentReading[]>();
  for (const job of definitions) {
    const behaviour = job.definition.behaviour;
    if (behaviour.work.kind !== "session" || evidence.has(behaviour.id)) continue;
    evidence.set(
      behaviour.id,
      behaviour.documents.map((document) => readDocument(document.path)),
    );
  }
  return evidence;
}

/**
 * **The evidence a set of definitions carries on its own** — their load-time
 * digests, dressed as readings.
 *
 * For a caller that built the definitions from the checkout a moment ago, so
 * their digests ARE the fresh reading: `schedulerWiring` and the activation
 * preflight. The daemon, which holds its definitions for days, never uses this.
 */
export function evidenceAsBuilt(definitions: readonly AuthorisedJob[]): DocumentEvidence {
  return resolveEvidence(definitions, (path) => {
    for (const job of definitions) {
      const found = job.definition.behaviour.documents.find((document) => document.path === path);
      if (found !== undefined) return { kind: "read", path, sha256: found.sha256 };
    }
    return { kind: "unreadable", path, why: `${path} is not among the documents these definitions were built with` };
  });
}

/**
 * Whether a job is the one that was authorised, asked against the evidence.
 *
 * `authorised` carries the job **as it will be launched**: for a session job,
 * its behaviour rebuilt from the fresh digests — which hash to the pin, or this
 * would not be the `authorised` arm — so the occurrence key and the spawner see
 * what was actually checked, not what the daemon loaded days ago.
 */
export type EvidencedAuthorisation =
  | { readonly kind: "authorised"; readonly hash: BehaviourHash; readonly job: AuthorisedJob }
  | { readonly kind: "unauthorised"; readonly why: string; readonly drift: readonly string[] };

export function authorisationUnder(job: AuthorisedJob, evidence: DocumentEvidence): EvidencedAuthorisation {
  const behaviour = job.definition.behaviour;
  switch (behaviour.work.kind) {
    case "rule": {
      // LOAD-TIME DIGESTS, deliberately — see `DocumentEvidence`.
      const authorisation = authorisationOf(job);
      if (authorisation.kind === "authorised") return { kind: "authorised", hash: authorisation.hash, job };
      return { kind: "unauthorised", why: authorisation.why, drift: documentDrift(job.authorisedDocuments, behaviour.documents) };
    }
    case "session": {
      const readings = evidence.get(behaviour.id);
      if (readings === undefined) {
        // FAIL CLOSED. A caller that forgot to read is not evidence that
        // nothing moved.
        return {
          kind: "unauthorised",
          why: "no reading of this job's documents was taken this tick, so what it would follow cannot be compared with its pin; it will not be dispatched",
          drift: [],
        };
      }
      const documents: JobDocument[] = [];
      for (const reading of readings) {
        if (reading.kind === "unreadable") {
          return {
            kind: "unauthorised",
            why: `${reading.path} could not be read this tick (${reading.why}), so what this job would follow cannot be compared with its pin; it will not be dispatched`,
            drift: [],
          };
        }
        documents.push({ path: reading.path, sha256: reading.sha256 });
      }
      const fresh: AuthorisedJob = { ...job, definition: { ...job.definition, behaviour: { ...behaviour, documents } } };
      const authorisation = authorisationOf(fresh);
      if (authorisation.kind === "authorised") return { kind: "authorised", hash: authorisation.hash, job: fresh };
      return { kind: "unauthorised", why: authorisation.why, drift: documentDrift(job.authorisedDocuments, documents) };
    }
    default: {
      const never: never = behaviour.work;
      throw new Error(`no authorisation for job work ${JSON.stringify(never)}`);
    }
  }
}

/**
 * **WHAT THE SCHEDULER WOULD DO WITH ONE JOB, NOW** — the per-job verdict the
 * tick turns into reports and the preview turns into a row.
 *
 * Every arm past the authorisation gate carries `last`, the job's most recent
 * run as `due()` read it, because *last attempt and result* is a column the
 * preview needs and re-deriving it there would be a second reading of the
 * ledger. Where a next run has an instant, it is an **absolute** one
 * (`nextDueAt`, `firstEligibleAt`) — a backward clock jump must not move it.
 */
export type JobPlan =
  | { readonly kind: "history-lost"; readonly jobId: string; readonly why: string }
  | { readonly kind: "duplicate-id"; readonly jobId: string; readonly why: string }
  /** `drift` names each document that moved, when that is why — empty when the reason is something else. */
  | { readonly kind: "unauthorised"; readonly jobId: string; readonly why: string; readonly drift: readonly string[] }
  /** In flight inside its lease (`last.kind === "in-flight"`: next due after it settles), or never run with no arming to date it from. */
  | { readonly kind: "held"; readonly jobId: string; readonly why: string; readonly last: LastRun }
  | { readonly kind: "waiting"; readonly jobId: string; readonly remainingMs: number; readonly nextDueAt: string; readonly last: LastRun }
  | { readonly kind: "not-yet-eligible"; readonly jobId: string; readonly firstEligibleAt: string; readonly remainingMs: number; readonly last: LastRun }
  /** Due now, and deliberately left alone: nothing reserved, nothing launched, nothing written. */
  | { readonly kind: "dry-run"; readonly jobId: string; readonly why: string; readonly last: LastRun }
  | { readonly kind: "spacing-held"; readonly jobId: string; readonly remainingMs: number; readonly nextDueAt: string; readonly why: string; readonly last: LastRun }
  /**
   * Handed to `launch`. `job` is the job as launched (see `EvidencedAuthorisation`),
   * and `launched` is what `launch` answered.
   */
  | { readonly kind: "dispatch"; readonly jobId: string; readonly job: AuthorisedJob; readonly launched: boolean; readonly last: LastRun };

export type PlanInput = {
  readonly definitions: readonly AuthorisedJob[];
  readonly occurrences: OccurrenceIndex;
  readonly history: OccurrenceHistory;
  readonly arming: Arming;
  /** `schedules.ts` § `LAUNCH_SEPARATION_MS`. Zero disables the gate. */
  readonly launchSeparationMs: number;
  readonly nowMs: number;
  /** Session jobs' documents as they are now — `resolveEvidence`. A session job missing from it is refused, not waved through. */
  readonly evidence: DocumentEvidence;
};

/** Start this job — or, for a preview, say whether it would count as a launch. `true` means a session did or may have started. */
export type Launch = (job: AuthorisedJob) => boolean;

/** The sentence every duplicate gets. One copy, because the tick, preview and eligibility headline print it. */
export const DUPLICATE_WHY =
  "two or more definitions share this id, so none of them can be addressed unambiguously and none is dispatched — " +
  "they would mint the same occurrence key, and one occurrence in the log could stand for two children on the box";

/**
 * Every id that occurs more than once in a definition list.
 *
 * The planner owns the duplicate gate, but the scheduler headline must answer
 * the same list-wide fact: otherwise it can say `ARMED` about jobs the planner
 * will refuse before launch. Keeping the count here gives both callers the one
 * preflight rather than two similar loops.
 */
export function duplicateJobIds(definitions: readonly AuthorisedJob[]): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const job of definitions) {
    const id = job.definition.behaviour.id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
}

/**
 * Plan every job, in definition order, calling `launch` for each that reaches
 * dispatch. Returns one verdict per definition, in the same order.
 */
export function planJobs(input: PlanInput, launch: Launch): readonly JobPlan[] {
  // (1) THE LEDGER IS WHOLE, OR NOTHING IS PLANNED. Duplicates included: this
  // gate is about the history, and it holds whatever the list looks like.
  if (input.history.kind === "lost") {
    const why = input.history.why;
    return input.definitions.map((job) => ({ kind: "history-lost", jobId: job.definition.behaviour.id, why }));
  }

  // (2) THE DUPLICATE PREFLIGHT, OVER THE WHOLE LIST, BEFORE ANY JOB IS
  // PLANNED. Counting first is the whole fix: a check made while walking the
  // list can only refuse the SECOND definition, by which time the first has
  // been launched.
  const duplicateIds = duplicateJobIds(input.definitions);

  // THE SPACING GATE'S STATE, SEEDED FROM THE DISK AND MOVED WITHIN THE PASS.
  // Seeded from the ledger so it survives a restart and a day's downtime (S8-5);
  // moved in the loop because a launch two jobs ago must count against this one,
  // and reading the store's index back for that would make the answer depend on
  // when the index is refreshed.
  const sessionJobIds = new Set(input.definitions.filter((job) => job.definition.behaviour.work.kind === "session").map((job) => job.definition.behaviour.id));
  const lastLaunch = lastSessionLaunchOf(input.occurrences, sessionJobIds);
  let lastLaunchMs = lastLaunch.kind === "at" ? Date.parse(lastLaunch.at) : Number.NEGATIVE_INFINITY;

  const plans: JobPlan[] = [];
  for (const job of input.definitions) {
    const behaviour = job.definition.behaviour;
    const jobId = behaviour.id;
    if (duplicateIds.has(jobId)) {
      plans.push({ kind: "duplicate-id", jobId, why: DUPLICATE_WHY });
      continue;
    }

    // (3a) THE AUTHORISATION GATE, BEFORE `due`. An edited behaviour must never
    // reach the arithmetic (C2) — and "edited" now includes a document edited
    // since the daemon loaded the definition (plan 260910e, defect 1).
    const authorisation = authorisationUnder(job, input.evidence);
    if (authorisation.kind === "unauthorised") {
      plans.push({ kind: "unauthorised", jobId, why: authorisation.why, drift: authorisation.drift });
      continue;
    }

    // (3b) THE CLOCK.
    const last = lastRunOf(input.occurrences, jobId, input.nowMs);
    const verdict = due(job.definition.schedule, last, input.nowMs, input.arming);
    switch (verdict.kind) {
      case "held":
        plans.push({ kind: "held", jobId, why: verdict.why, last });
        continue;
      case "not-due":
        plans.push({ kind: "waiting", jobId, remainingMs: verdict.remainingMs, nextDueAt: new Date(input.nowMs + verdict.remainingMs).toISOString(), last });
        continue;
      case "not-yet-eligible":
        plans.push({ kind: "not-yet-eligible", jobId, firstEligibleAt: verdict.firstEligibleAt, remainingMs: verdict.remainingMs, last });
        continue;
      case "due":
        break;
      default: {
        const never: never = verdict;
        throw new Error(`no plan for ${JSON.stringify(never)}`);
      }
    }

    // (3c) DRY-RUN, AFTER `due` AND BEFORE SPACING. After, so a dry-run job that
    // is not due reads as not due; before, so it never waits on the spacing
    // gate for a launch it will not make — and never moves that gate either.
    const dispatchMode = behaviour.dispatch;
    if (dispatchMode.kind === "dry-run") {
      plans.push({ kind: "dry-run", jobId, why: `due now; dry-run, so nothing is reserved or launched — ${dispatchMode.why}`, last });
      continue;
    }

    // (3d) THE LAUNCH-SPACING GATE. After `due`, so a job that is not due is
    // reported as not due rather than as spaced — only one of those is
    // temporary. Sessions only: a rule runs in this process, spends nothing, and
    // rationing it would be rationing the wrong thing.
    if (behaviour.work.kind === "session" && input.launchSeparationMs > 0) {
      const sinceMs = input.nowMs - lastLaunchMs;
      if (sinceMs < input.launchSeparationMs) {
        const remainingMs = input.launchSeparationMs - sinceMs;
        plans.push({
          kind: "spacing-held",
          jobId,
          remainingMs,
          nextDueAt: new Date(input.nowMs + remainingMs).toISOString(),
          why:
            `it is due, and a Claude session was launched ${Math.round(sinceMs / 1000)}s ago — ` +
            `this box starts at most one every ${Math.round(input.launchSeparationMs / 1000)}s, so this one waits ${Math.round(remainingMs / 1000)}s`,
          last,
        });
        continue;
      }
    }

    // (3e) DISPATCH. ONLY A LAUNCH MOVES THE GATE: a refusal, a failed
    // reservation, or a rule started no session, and counting one would ration
    // the next job against an event that did not happen.
    const launched = launch(authorisation.job);
    if (launched) lastLaunchMs = input.nowMs;
    plans.push({ kind: "dispatch", jobId, job: authorisation.job, launched, last });
  }
  return plans;
}
