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
 *  1. **History lost → the job held — per ledger** (F2 on plan 260910f,
 *     scheduled dispatch). A cold start is not permission (C3), and since a
 *     session job's history is the launch journal, a lost `events.jsonl` holds
 *     the rules only and a lost launch journal the session jobs only.
 *  2. **Duplicate ids → every definition sharing an id refused, over the whole
 *     list, before anything is planned.** The old loop refused an id only on
 *     meeting it the second time, so the first definition had already been
 *     reserved and spawned while the report said *neither can be addressed*
 *     (Sol's P1-5). A per-job check cannot own a list-wide fact.
 *  3. Per job, in order:
 *     - **authorisation** — a session job against the documents as they are
 *       NOW, a rule job against its load-time digests (§ D3, and below);
 *     - **a launch waiting to be resumed** — decided BEFORE the clock (Fable's
 *       P2): the same revision on a usable account is resumed; a moved
 *       revision, or a pinned account that is gone, is superseded first and
 *       the replacement is due at once;
 *     - **`due()`** — the clock, only for a job that got past the pin (C2);
 *     - **dry-run** — due, and deliberately not started (§ D5);
 *     - **the spacing gate** — sessions only (S8-5);
 *     - **the account gate** — live sessions only: a new plan needs a chosen
 *       pool account, and a resume needs its own pinned one clear (M5, and
 *       the account choice that replaced the bare launch gate);
 *     - **dispatch** — `launch`, or a resume.
 */
import {
  authorisationOf,
  behaviourHash,
  documentDrift,
  due,
  lastRunOf,
  lastSessionLaunchOf,
  newestOccurrenceOf,
  type Arming,
  type AuthorisedJob,
  type BehaviourHash,
  type JobDocument,
  type LastRun,
  type LaunchOccurrence,
  type OccurrenceHistory,
  type ScheduledOccurrence,
  type ScheduleIndex,
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
 * One document's BYTES, read once, with the digest of exactly those bytes — or
 * why it could not be read. What a session's pinned material is built from
 * (plan 260910f scheduled dispatch, § D3). `standing-jobs.ts` §
 * `readJobDocumentBytes` is the real one, and it digests with the same function
 * `readJobDocument` does.
 */
export type DocumentBytes =
  | { readonly kind: "read"; readonly path: string; readonly sha256: string; readonly bytes: Buffer }
  | { readonly kind: "unreadable"; readonly path: string; readonly why: string };

export type ReadDocumentBytes = (path: string) => DocumentBytes;

/**
 * **WHETHER ONE POOL ACCOUNT MAY START A SESSION NOW** — `gone` is an account
 * that is not a registered Claude pool account, or whose credential is
 * permanently unusable. The daemon decides which (Stage C); the planner only
 * branches on the value.
 */
export type AccountStanding =
  | { readonly kind: "clear" }
  | { readonly kind: "held"; readonly why: string; readonly until: string | null }
  | { readonly kind: "gone"; readonly why: string };

/**
 * **WHICH POOL ACCOUNT A NEW SESSION RUNS ON — and each account's standing.**
 * Computed by the daemon once per tick from the account registry and the
 * shared health and quota gates (`launch-gate.ts`), and handed in as a value,
 * so the planner stays pure.
 *
 * `chosen` is for a NEW plan: an account, or why none may start a session now.
 * `standing` is for a RESUME, which never re-chooses: its account was pinned
 * when it was planned (2b), and the same key on a different account would be a
 * conflict at the protocol.
 */
export type AccountChoice = {
  readonly chosen:
    | { readonly kind: "chosen"; readonly account: string; readonly notes: readonly string[] }
    | { readonly kind: "held"; readonly why: string; readonly until: string | null };
  readonly standing: (handle: string) => AccountStanding;
};

/**
 * **THE HISTORY EACH KIND OF JOB IS PLANNED ON** (F2): the rules' ledger is
 * `events.jsonl`, and a session job's is the launch journal. A hole in one
 * holds only its own kind.
 */
export type PlanHistory = { readonly rules: OccurrenceHistory; readonly sessions: OccurrenceHistory };

/**
 * **THE DOCUMENTS EACH SESSION JOB WOULD FOLLOW, AS THEY ARE NOW**, by loaded definition.
 *
 * Session jobs only. A rule job's "documents" are the source of code already
 * loaded into this process, so re-reading them would refuse a rule whose running
 * code has not moved; its load-time digests are the right evidence and it never
 * appears here.
 */
export type DocumentEvidence = ReadonlyMap<string, readonly DocumentReading[]>;

/**
 * A definition-specific key, with the plain id retained as an explicit-call
 * override. Duplicate ids are refused before authorisation, but their preview
 * rows still have to show the documents of the definition each row describes.
 */
function evidenceKey(job: AuthorisedJob): string {
  return `${job.definition.behaviour.id}\0${behaviourHash(job.definition.behaviour)}`;
}

export function documentEvidenceFor(evidence: DocumentEvidence, job: AuthorisedJob): readonly DocumentReading[] | undefined {
  return evidence.get(job.definition.behaviour.id) ?? evidence.get(evidenceKey(job));
}

/**
 * Read every session job's documents, once, for one tick or one checkpoint.
 *
 * **The impure half, kept out of `planJobs` on purpose.** Both the tick and the
 * daemon's headline call this with the same `readDocument`, so the verdict that
 * refuses a job and the headline that describes it are made of the same reading.
 *
 * Definitions with a duplicate id but different behaviour are read separately:
 * the planner refuses both before authorisation, but the preview still shows
 * the documents belonging to each definition rather than borrowing the first's.
 */
export function resolveEvidence(definitions: readonly AuthorisedJob[], readDocument: ReadDocument): DocumentEvidence {
  const evidence = new Map<string, readonly DocumentReading[]>();
  const duplicateIds = duplicateJobIds(definitions);
  for (const job of definitions) {
    const behaviour = job.definition.behaviour;
    const key = duplicateIds.has(behaviour.id) ? evidenceKey(job) : behaviour.id;
    if (behaviour.work.kind !== "session" || evidence.has(key)) continue;
    evidence.set(
      key,
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
  /** `found` is what the job fingerprints as now — the string re-pinning copies — or why no fingerprint could be taken. */
  | { readonly kind: "unauthorised"; readonly why: string; readonly drift: readonly string[]; readonly found: FoundFingerprint };

/**
 * **WHAT AN UNAUTHORISED JOB FINGERPRINTS AS NOW**, carried for the schedule
 * preview (plan 260910e § D6: *the behaviour hash against its pin*).
 *
 * The gate already computes it — `authorisationOf` needs it to refuse — so it
 * is handed on rather than recomputed by the preview, which would be a second
 * copy of how a session job's behaviour is rebuilt from fresh readings. A union,
 * because a document that could not be read leaves nothing to fingerprint, and
 * that must not print as a hash.
 */
export type FoundFingerprint = { readonly kind: "hash"; readonly hash: BehaviourHash } | { readonly kind: "not-computed"; readonly why: string };

export function authorisationUnder(job: AuthorisedJob, evidence: DocumentEvidence): EvidencedAuthorisation {
  const behaviour = job.definition.behaviour;
  switch (behaviour.work.kind) {
    case "rule": {
      // LOAD-TIME DIGESTS, deliberately — see `DocumentEvidence`.
      const authorisation = authorisationOf(job);
      if (authorisation.kind === "authorised") return { kind: "authorised", hash: authorisation.hash, job };
      return {
        kind: "unauthorised",
        why: authorisation.why,
        drift: documentDrift(job.authorisedDocuments, behaviour.documents),
        found: { kind: "hash", hash: authorisation.found },
      };
    }
    case "session": {
      const readings = documentEvidenceFor(evidence, job);
      if (readings === undefined) {
        // FAIL CLOSED. A caller that forgot to read is not evidence that
        // nothing moved.
        const why = "no reading of this job's documents was taken this tick, so what it would follow cannot be compared with its pin; it will not be dispatched";
        return { kind: "unauthorised", why, drift: [], found: { kind: "not-computed", why } };
      }
      const documents: JobDocument[] = [];
      for (const reading of readings) {
        if (reading.kind === "unreadable") {
          const why = `${reading.path} could not be read this tick (${reading.why}), so what this job would follow cannot be compared with its pin; it will not be dispatched`;
          return { kind: "unauthorised", why, drift: [], found: { kind: "not-computed", why } };
        }
        documents.push({ path: reading.path, sha256: reading.sha256 });
      }
      const fresh: AuthorisedJob = { ...job, definition: { ...job.definition, behaviour: { ...behaviour, documents } } };
      const authorisation = authorisationOf(fresh);
      if (authorisation.kind === "authorised") return { kind: "authorised", hash: authorisation.hash, job: fresh };
      return {
        kind: "unauthorised",
        why: authorisation.why,
        drift: documentDrift(job.authorisedDocuments, documents),
        found: { kind: "hash", hash: authorisation.found },
      };
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
 * run as `due()` read it. Where a next run has an instant, it is an
 * **absolute** one (`nextDueAt`, `firstEligibleAt`) — a backward clock jump
 * must not move it.
 *
 * **And every arm but `history-lost` carries `attempt`**, the newest occurrence
 * itself — its state, its instants, its outcome — because *last attempt and
 * result* is a column the preview needs and `last` has already folded the
 * state away. Carried here rather than read by the preview, so there is one
 * reading of the ledger per pass, not two (plan 260910e, Stage 2). A lost
 * history carries none: its index is not the whole of it, and "never" read off
 * a partial ledger is C3 again.
 */
export type JobPlan =
  | { readonly kind: "history-lost"; readonly jobId: string; readonly why: string }
  | { readonly kind: "duplicate-id"; readonly jobId: string; readonly why: string; readonly attempt: PlannedAttempt }
  /** `drift` names each document that moved, when that is why — empty when the reason is something else. */
  | { readonly kind: "unauthorised"; readonly jobId: string; readonly why: string; readonly drift: readonly string[]; readonly attempt: PlannedAttempt }
  /**
   * In flight inside its lease (`last.kind === "in-flight"`: next due after it
   * settles), a launch that holds its job (`launch-open`, no lease), never run
   * with no arming to date it from, or a waiting launch that had to be
   * superseded and could not be (a refused abandon plans nothing).
   */
  | { readonly kind: "held"; readonly jobId: string; readonly why: string; readonly last: LastRun; readonly attempt: PlannedAttempt }
  | { readonly kind: "waiting"; readonly jobId: string; readonly remainingMs: number; readonly nextDueAt: string; readonly last: LastRun; readonly attempt: PlannedAttempt }
  | {
      readonly kind: "not-yet-eligible";
      readonly jobId: string;
      readonly firstEligibleAt: string;
      readonly remainingMs: number;
      readonly last: LastRun;
      readonly attempt: PlannedAttempt;
    }
  /** Due now, and deliberately left alone: nothing reserved, nothing launched, nothing written. */
  | { readonly kind: "dry-run"; readonly jobId: string; readonly why: string; readonly last: LastRun; readonly attempt: PlannedAttempt }
  | {
      readonly kind: "spacing-held";
      readonly jobId: string;
      readonly remainingMs: number;
      readonly nextDueAt: string;
      readonly why: string;
      readonly last: LastRun;
      readonly attempt: PlannedAttempt;
    }
  /**
   * **DUE, SPACED, AND NO POOL ACCOUNT MAY START IT.** A live session job only,
   * after spacing: a new plan whose account choice is held, or a resume whose
   * own pinned account is held. `account` names the pinned one, and is null
   * for a new plan. `until` is when the hold is expected to lift, if anybody
   * knows.
   */
  | {
      readonly kind: "usage-held";
      readonly jobId: string;
      readonly why: string;
      readonly until: string | null;
      readonly account: string | null;
      readonly last: LastRun;
      readonly attempt: PlannedAttempt;
    }
  /**
   * **A LAUNCH WAITING TO BE RESUMED, AND RESUMED** (F1): its revision is the
   * authorised one and its account is usable, so it is driven on from the
   * stored, pinned record — never re-planned. `launched` is what `launch`
   * answered.
   */
  | {
      readonly kind: "resume";
      readonly jobId: string;
      readonly job: AuthorisedJob;
      readonly occurrence: LaunchOccurrence;
      readonly launched: boolean;
      readonly last: LastRun;
      readonly attempt: PlannedAttempt;
    }
  /**
   * Handed to `launch`. `job` is the job as launched (see `EvidencedAuthorisation`),
   * `how` is a rule run or a new session plan — its nominal due instant and
   * its chosen account — and `launched` is what `launch` answered.
   */
  | {
      readonly kind: "dispatch";
      readonly jobId: string;
      readonly job: AuthorisedJob;
      readonly how: Exclude<LaunchHow, { readonly kind: "resume" }>;
      readonly launched: boolean;
      readonly last: LastRun;
      readonly attempt: PlannedAttempt;
    };

/**
 * The newest occurrence the ledger holds for one job, or that it holds none.
 *
 * A union rather than `Occurrence | null` for the house reason, and because the
 * preview turns each arm into a different sentence.
 */
export type PlannedAttempt = { readonly kind: "never" } | { readonly kind: "occurred"; readonly occurrence: ScheduledOccurrence };

/**
 * **THE SAME OCCURRENCE `lastRunOf` READS**, by the same comparator —
 * `jobs.ts` § `newestOccurrenceOf` (Fable's P3) — handed on whole rather than
 * folded into a `LastRun`, for the preview's *last attempt* column.
 */
export function newestAttemptOf(index: ScheduleIndex, jobId: string): PlannedAttempt {
  const newest = newestOccurrenceOf(index, jobId);
  return newest === null ? { kind: "never" } : { kind: "occurred", occurrence: newest };
}

export type PlanInput = {
  readonly definitions: readonly AuthorisedJob[];
  /** The rules' ledger and the launch journal's projection, merged — `launch-occurrences.ts` § `scheduleIndexOf`. */
  readonly occurrences: ScheduleIndex;
  readonly history: PlanHistory;
  readonly arming: Arming;
  /** `schedules.ts` § `LAUNCH_SEPARATION_MS`. Zero disables the gate. */
  readonly launchSeparationMs: number;
  readonly nowMs: number;
  /** Session jobs' documents as they are now — `resolveEvidence`. A session job missing from it is refused, not waved through. */
  readonly evidence: DocumentEvidence;
  /** Which pool account a new session would run on, and each account's standing. Computed once per tick by the daemon. */
  readonly accounts: AccountChoice;
};

/**
 * What `launch` is asked to do. A rule runs in process; a new session plans a
 * fresh occurrence at its nominal due instant on the chosen account; a resume
 * drives a waiting occurrence on from its stored record.
 */
export type LaunchHow =
  | { readonly kind: "rule" }
  | { readonly kind: "new-session"; readonly dueAt: string; readonly account: string }
  | { readonly kind: "resume"; readonly occurrence: LaunchOccurrence };

/** Start this job — or, for a preview, say whether it would count as a launch. `true` means a session did or may have started. */
export type Launch = (job: AuthorisedJob, how: LaunchHow) => boolean;

/** What superseding a waiting occurrence came to: replaced at the abandonment's instant, or refused with the reason. */
export type Superseded = { readonly kind: "replaced"; readonly at: string } | { readonly kind: "refused"; readonly why: string };

/**
 * **ABANDON A WAITING OCCURRENCE THAT IS NO LONGER THE ONE TO RUN** — its
 * revision moved, or its pinned account is gone. The tick's answers from the
 * protocol's `abandon` and the record's `endedAt`; a preview's forecasts it.
 */
export type Supersede = (job: AuthorisedJob, occurrence: LaunchOccurrence, why: string) => Superseded;

/** The planner's two side-effecting questions, both injected so it stays pure. */
export type PlanPorts = { readonly launch: Launch; readonly supersede: Supersede };

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
 * Plan every job, in definition order, calling `ports.launch` for each that
 * reaches dispatch or a resume, and `ports.supersede` for a waiting launch
 * that is no longer the one to run. Returns one verdict per definition, in the
 * same order.
 */
export function planJobs(input: PlanInput, ports: PlanPorts): readonly JobPlan[] {
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

    // (1) THE LEDGER THIS JOB'S HISTORY LIVES IN IS WHOLE, OR IT IS HELD —
    // duplicates included, because this gate is about the history. PER LEDGER
    // (F2): a session job's history is the launch journal, a rule's is
    // `events.jsonl`, and a hole in one says nothing about the other.
    const history = behaviour.work.kind === "session" ? input.history.sessions : input.history.rules;
    if (history.kind === "lost") {
      plans.push({ kind: "history-lost", jobId, why: history.why });
      continue;
    }

    // THE NEWEST OCCURRENCE, WHOLE — for the preview's *last attempt* column.
    // Read here, once, beside the clock's own reading of the same index.
    const attempt = newestAttemptOf(input.occurrences, jobId);
    if (duplicateIds.has(jobId)) {
      plans.push({ kind: "duplicate-id", jobId, why: DUPLICATE_WHY, attempt });
      continue;
    }

    // (3a) THE AUTHORISATION GATE, BEFORE `due`. An edited behaviour must never
    // reach the arithmetic (C2) — and "edited" now includes a document edited
    // since the daemon loaded the definition (plan 260910e, defect 1).
    const authorisation = authorisationUnder(job, input.evidence);
    if (authorisation.kind === "unauthorised") {
      plans.push({ kind: "unauthorised", jobId, why: authorisation.why, drift: authorisation.drift, attempt });
      continue;
    }

    let last = lastRunOf(input.occurrences, jobId, input.nowMs);

    // (3b) A LAUNCH WAITING TO BE RESUMED, DECIDED BEFORE THE CLOCK (Fable's
    // P2). Its due instant was fixed when it was planned, and asking `due()`
    // again would read an older sibling and delay it. Only a session job can
    // have one: the launch journal holds nothing else.
    if (last.kind === "launch-resumable") {
      const waiting = last.occurrence;
      const decision = resumeDecision(waiting, authorisation.hash, input.accounts);
      if (decision.kind === "resume") {
        plans.push(afterTheClock({ job: authorisation.job, jobId, last, attempt, how: { kind: "resume", occurrence: waiting } }));
        continue;
      }
      // NOT THE ONE TO RUN ANY MORE: abandoned first — so every older sibling is
      // terminal in the journal, not merely ignored here — and the replacement
      // is due at once, keyed at the abandonment's own instant, so it gets a new
      // id and no interval is lost. A refused abandon plans nothing.
      const superseded = ports.supersede(authorisation.job, waiting, decision.why);
      if (superseded.kind === "refused") {
        plans.push({
          kind: "held",
          jobId,
          why: `its waiting occurrence ${waiting.launchId} is ${decision.why}, and it could not be abandoned (${superseded.why}), so nothing new is planned`,
          last,
          attempt,
        });
        continue;
      }
      last = { kind: "replaced", at: superseded.at };
    }

    // (3c) THE CLOCK.
    const verdict = due(job.definition.schedule, last, input.nowMs, input.arming);
    switch (verdict.kind) {
      case "held":
        plans.push({ kind: "held", jobId, why: verdict.why, last, attempt });
        continue;
      case "not-due":
        plans.push({
          kind: "waiting",
          jobId,
          remainingMs: verdict.remainingMs,
          nextDueAt: new Date(input.nowMs + verdict.remainingMs).toISOString(),
          last,
          attempt,
        });
        continue;
      case "not-yet-eligible":
        plans.push({ kind: "not-yet-eligible", jobId, firstEligibleAt: verdict.firstEligibleAt, remainingMs: verdict.remainingMs, last, attempt });
        continue;
      case "due":
        plans.push(
          afterTheClock({
            job: authorisation.job,
            jobId,
            last,
            attempt,
            how: behaviour.work.kind === "session" ? { kind: "new-session", dueAt: verdict.dueAt } : { kind: "rule" },
          }),
        );
        continue;
      default: {
        const never: never = verdict;
        throw new Error(`no plan for ${JSON.stringify(never)}`);
      }
    }
  }
  return plans;

  /**
   * THE GATES AFTER THE CLOCK — the same ones, in the same order, for a new
   * plan and a resume (P2: only the clock is skipped for a resume). Written once,
   * so the two cannot drift into different orders.
   */
  function afterTheClock(step: {
    readonly job: AuthorisedJob;
    readonly jobId: string;
    readonly last: LastRun;
    readonly attempt: PlannedAttempt;
    readonly how: { readonly kind: "rule" } | { readonly kind: "new-session"; readonly dueAt: string } | { readonly kind: "resume"; readonly occurrence: LaunchOccurrence };
  }): JobPlan {
    const { job, jobId, last, attempt, how } = step;
    const behaviour = job.definition.behaviour;

    // DRY-RUN, AFTER `due` AND BEFORE SPACING. After, so a dry-run job that is
    // not due reads as not due; before, so it never waits on the spacing gate
    // for a launch it will not make — and never moves that gate either.
    const dispatchMode = behaviour.dispatch;
    if (dispatchMode.kind === "dry-run") {
      return { kind: "dry-run", jobId, why: `due now; dry-run, so nothing is reserved or launched — ${dispatchMode.why}`, last, attempt };
    }

    // THE LAUNCH-SPACING GATE. After `due`, so a job that is not due is
    // reported as not due rather than as spaced — only one of those is
    // temporary. Sessions only: a rule runs in this process, spends nothing, and
    // rationing it would be rationing the wrong thing.
    if (how.kind !== "rule" && input.launchSeparationMs > 0) {
      const sinceMs = input.nowMs - lastLaunchMs;
      if (sinceMs < input.launchSeparationMs) {
        const remainingMs = input.launchSeparationMs - sinceMs;
        return {
          kind: "spacing-held",
          jobId,
          remainingMs,
          nextDueAt: new Date(input.nowMs + remainingMs).toISOString(),
          why:
            `it is due, and a Claude session was launched ${Math.round(sinceMs / 1000)}s ago — ` +
            `this box starts at most one every ${Math.round(input.launchSeparationMs / 1000)}s, so this one waits ${Math.round(remainingMs / 1000)}s`,
          last,
          attempt,
        };
      }
    }

    // THE ACCOUNT GATE, AFTER SPACING, FOR LIVE SESSIONS ONLY — and ONLY A
    // LAUNCH MOVES THE SPACING GATE: a refusal, a wait, or a rule started no
    // session, and counting one would ration the next job against an event
    // that did not happen.
    switch (how.kind) {
      case "rule": {
        const launched = ports.launch(job, how);
        return { kind: "dispatch", jobId, job, how, launched, last, attempt };
      }
      case "new-session": {
        const chosen = input.accounts.chosen;
        if (chosen.kind === "held") {
          return { kind: "usage-held", jobId, why: `due, and no pool account may start a session now: ${chosen.why}`, until: chosen.until, account: null, last, attempt };
        }
        const planned = { kind: "new-session" as const, dueAt: how.dueAt, account: chosen.account };
        const launched = ports.launch(job, planned);
        if (launched) lastLaunchMs = input.nowMs;
        return { kind: "dispatch", jobId, job, how: planned, launched, last, attempt };
      }
      case "resume": {
        const held = resumeHold(how.occurrence, input.accounts);
        if (held !== null) return { kind: "usage-held", jobId, why: held.why, until: held.until, account: held.account, last, attempt };
        const launched = ports.launch(job, how);
        if (launched) lastLaunchMs = input.nowMs;
        return { kind: "resume", jobId, job, occurrence: how.occurrence, launched, last, attempt };
      }
      default: {
        const never: never = how;
        throw new Error(`no launch for ${JSON.stringify(never)}`);
      }
    }
  }
}

/** The pool account a waiting launch was planned on, or null for a record that pins no run spec (a `tmux` launch — `launch-occurrences.ts` § `accountOf`). */
function pinnedAccountOf(occurrence: LaunchOccurrence): string | null {
  return occurrence.standing.kind === "resumable" ? occurrence.standing.account : null;
}

/**
 * **WHETHER A WAITING LAUNCH IS STILL THE ONE TO RUN.** It is resumed only if
 * its revision is the job's current authorised one (F1, step 2) and its pinned
 * account is not gone. Otherwise it is superseded, with the sentence that
 * becomes the abandonment's reason.
 */
function resumeDecision(occurrence: LaunchOccurrence, authorisedHash: BehaviourHash, accounts: AccountChoice): { readonly kind: "resume" } | { readonly kind: "supersede"; readonly why: string } {
  if (occurrence.key.behaviourHash !== authorisedHash) return { kind: "supersede", why: `superseded by ${authorisedHash}` };
  const account = pinnedAccountOf(occurrence);
  if (account !== null) {
    const standing = accounts.standing(account);
    if (standing.kind === "gone") return { kind: "supersede", why: `pinned account ${account} is no longer usable: ${standing.why}` };
  }
  return { kind: "resume" };
}

/**
 * Why a resume must wait, or null when it may go.
 *
 * **A RESUME NEVER RE-CHOOSES ITS ACCOUNT.** It relaunches the stored request,
 * so it runs on the account it was planned with; if that account is held, the
 * resume waits for it. It is not abandoned and no sibling is planned: the same
 * key on a different run spec would be a conflict at the protocol (F5), and a
 * held account is a reason to wait, not a reason to replace. (A `gone` account
 * never reaches here — `resumeDecision` supersedes it.) A record that names no
 * account — a `tmux` launch, which pins no run spec (`launch-occurrences.ts` §
 * `accountOf`) — waits on the account choice a new plan would.
 */
function resumeHold(occurrence: LaunchOccurrence, accounts: AccountChoice): { readonly why: string; readonly until: string | null; readonly account: string | null } | null {
  const account = pinnedAccountOf(occurrence);
  if (account === null) {
    const chosen = accounts.chosen;
    return chosen.kind === "held" ? { why: `its waiting occurrence is resumable, and no pool account may start a session now: ${chosen.why}`, until: chosen.until, account: null } : null;
  }
  const standing = accounts.standing(account);
  switch (standing.kind) {
    case "clear":
      return null;
    case "held":
      return {
        why: `its waiting occurrence is pinned to pool account ${account}, which is held: ${standing.why}. A resume never re-chooses its account, so it waits for this one`,
        until: standing.until,
        account,
      };
    case "gone":
      return { why: `its pinned pool account ${account} is gone: ${standing.why}`, until: null, account };
    default: {
      const never: never = standing;
      throw new Error(`no hold for ${JSON.stringify(never)}`);
    }
  }
}
