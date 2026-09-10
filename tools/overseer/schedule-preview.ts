/**
 * **The schedule preview: what the scheduler would run next, when, under which
 * pin, and why not — computed by the daemon, written to `schedule.json`, and
 * printed by `overseer status`.** Plan 260910e § D1, D6, D7.
 *
 * ## Nothing about the gates is decided here
 *
 * `schedulePreview` runs the SAME planner the tick runs (`schedule-plan.ts`
 * § `planJobs`) and turns each verdict into a row. A preview with its own copy
 * of the gate order would be a second copy of the one thing a preview must not
 * get wrong (§ D2). Where a row needed a fact the verdict did not carry — the
 * newest occurrence whole, the fingerprint an unauthorised job has now — the
 * fact was added to the planner's output rather than re-read here.
 *
 * The one thing the planner cannot know is whether a launch succeeds, so the
 * preview's `launch` answers `true` for every live session job — **even on a
 * daemon holding no dispatcher**, because the preview forecasts what arming
 * would do, spacing included — and the file says, on every row it affects and
 * once at the top, that **rows after a proposed launch assume it succeeded**.
 * A row on a daemon that cannot launch says so in its own sentence.
 *
 * ## Why the daemon writes it rather than a reader computing it
 *
 * Sol's P1-4: a reader holds its own loaded prompts, pins and schedule
 * constants, not the daemon's, and the checkpoint's copy of the ledger lags the
 * scheduler timer. So the daemon computes this from what IT holds, on every
 * checkpoint tick, and a reader compares its own checkout's `listRevision`
 * against the daemon's to say whether a restart would change anything.
 *
 * ## What it is not
 *
 * Not a dispatcher: nothing here can start anything, and `schedulerWiring`'s
 * `preview` option carries no spawner and no rule runner. Not a second store:
 * the file is overwritten whole every tick and nothing reads it back into the
 * daemon. Not a checkpoint field: a separate file keeps `store.ts`'s schema
 * untouched, and the checkpoint's scheduler line stays the headline.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseSchedulePreview, SCHEDULE_PREVIEW_FILE, SCHEDULE_PREVIEW_SCHEMA } from "../fleet/schedule-parse.js";
import type {
  ParsedSchedulePreview,
  SchedulePreview,
  SchedulePreviewAttempt,
  SchedulePreviewDocument,
  SchedulePreviewJob,
  SchedulePreviewNext,
  SchedulePreviewParse,
  SchedulePreviewRow,
  SchedulePreviewRun,
  SchedulePreviewVerdict,
  SchedulePreviewVerdictKind,
} from "../fleet/wire.js";
import { londonFirstLine } from "../fleet/zones.js";
import { describeAge } from "./format-age.js";
import type { Arming, AuthorisedJob, JobWork, LaunchOccurrence, OccurrenceHistory, OccurrenceIndex } from "./jobs.js";
import { NO_LAUNCH_JOURNAL_WHY, scheduleIndexOf, type LaunchJournalReading } from "./launch-occurrences.js";
import { authorisationUnder, documentEvidenceFor, planJobs, type AccountChoice, type DocumentEvidence, type JobPlan } from "./schedule-plan.js";
import type { HeldCapabilities } from "./scheduler.js";
import type { StoredScheduler } from "./store.js";

/**
 * The file, inside the store directory. **Defined in the browser-safe leaf
 * `tools/fleet/schedule-parse.ts`** and re-exported here for this module's
 * callers — the dashboard's route needs the name, and importing it from this
 * module pulled the whole planner into the dashboard's reach.
 */
export { SCHEDULE_PREVIEW_FILE };

/**
 * **THE MISSED-RUN POLICY, NAMED** — plan 260910e § D1.
 *
 * It describes `jobs.ts` § `due` rather than configuring it: `due` asks how long
 * since the last outcome, not which boundaries were crossed, so a job that
 * missed twenty-four intervals while the box was down is simply due, once. It
 * is a constant so the preview can state it and a test can hold it against the
 * planner (`tests/overseer-schedule-preview.test.ts` § the missed-run policy) —
 * a policy that exists only as a sentence is one nothing notices changing.
 */
export const MISSED_RUN_POLICY = "one-run";

export const MISSED_RUN_SENTENCE =
  "a job due while the daemon was down, however many intervals it missed, runs once, on the first tick that finds it due, " +
  "and its next run is measured from that run; missed intervals are never replayed";

/** The limits of the file, stated in it. One copy, because the CLI prints it and the browser will. */
export const SCHEDULE_PREVIEW_CAVEAT =
  "As of the instant it was written, which is at most one checkpoint tick old while the daemon runs. " +
  "Rows are in the order the scheduler walks them, and a row after a proposed session launch assumes that launch succeeded.";

/** Twelve hex characters, the same length as a behaviour hash — enough to tell two lists apart, short enough to read aloud. */
const LIST_REVISION_LENGTH = 12;

/** A few KB is normal. A file past this is not one the daemon wrote, and a reader should not load it. */
const MAX_FILE_BYTES = 1_048_576;

/**
 * **WHICH JOB LIST THIS IS** — a short hash over each job's id, pin, schedule
 * and dispatch mode, in definition order. Plan 260910e § D1's *versioned* row.
 *
 * What moves it is exactly what a restart would change about what the daemon
 * dispatches: a job added, removed or reordered, a re-pin, a schedule edit, a
 * dispatch mode flipped. **A document edit does not move it**, deliberately:
 * the daemon re-reads documents every tick (§ D3), so an edited document is
 * already refused by the running daemon without a restart, and a revision that
 * moved with it would tell a reader to restart for nothing.
 *
 * The encoding is length-prefixed where a field is free text, for the reason
 * `jobs.ts` § `behaviourHash` gives.
 */
export function listRevision(definitions: readonly AuthorisedJob[]): string {
  const lines = [`jobs:${definitions.length}`];
  for (const job of definitions) {
    const { id, dispatch } = job.definition.behaviour;
    const schedule = job.definition.schedule;
    lines.push(
      [
        `id:${id.length}:${id}`,
        `pin:${job.authorisedHash}`,
        `every:${schedule.everyMs}`,
        `lease:${schedule.leaseMs}`,
        `first:${schedule.initialDelayMs}`,
        `dispatch:${dispatch.kind}`,
      ].join(" "),
    );
  }
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex").slice(0, LIST_REVISION_LENGTH);
}

/**
 * Everything the preview is made of, as values. **Pure given these**: no clock,
 * no disk, no store — the daemon reads the documents (`resolveEvidence`) and
 * hands in its in-memory ledger.
 *
 * `list` is a union because a daemon handed no job list at all is its own
 * fact, and the file says so rather than being absent (absent means a daemon
 * that predates this build).
 */
export type SchedulePreviewInput = {
  readonly instanceId: string;
  readonly now: Date;
  readonly list:
    | { readonly kind: "given"; readonly definitions: readonly AuthorisedJob[]; readonly listRevision: string; readonly evidence: DocumentEvidence }
    | { readonly kind: "not-given"; readonly why: string };
  /** The rules' ledger (`events.jsonl`), and whether it is whole. */
  readonly occurrences: OccurrenceIndex;
  readonly history: OccurrenceHistory;
  /**
   * **THE LAUNCH JOURNAL, read through the same merge the tick uses**
   * (`launch-occurrences.ts` § `scheduleIndexOf`) — every session job's history.
   * Undefined when this process holds none, which holds every session job's row
   * exactly as it holds the tick: an unread history is not an empty one.
   */
  readonly journal: LaunchJournalReading | undefined;
  /** The same account choice the tick is handed, so the preview's `usage-held` rows are the tick's. */
  readonly accounts: AccountChoice;
  readonly arming: Arming;
  readonly launchSeparationMs: number;
  /** What the daemon holds — not what it would hold armed. A disarmed daemon holds neither. */
  readonly capabilities: HeldCapabilities;
  /** The headline the same checkpoint wrote, so the file and `current.json` cannot disagree about it. */
  readonly headline: StoredScheduler;
};

export function schedulePreview(input: SchedulePreviewInput): SchedulePreview {
  const arming: SchedulePreview["arming"] = input.arming.kind === "armed" ? { kind: "armed", at: input.arming.at } : { kind: "none", why: input.arming.why };
  // THE SAME MERGE THE TICK MAKES, with the same function (F2, P3), so the
  // preview cannot read a different history from the one the tick acts on.
  const sessionJobIds = new Set(
    input.list.kind === "given" ? input.list.definitions.filter((job) => job.definition.behaviour.work.kind === "session").map((job) => job.definition.behaviour.id) : [],
  );
  const merged = scheduleIndexOf({ ledger: input.occurrences, ledgerHistory: input.history, journal: input.journal, sessionJobIds });
  const historyOf = (history: OccurrenceHistory): SchedulePreview["history"] => (history.kind === "intact" ? { kind: "intact" } : { kind: "lost", why: history.why });
  const common: Omit<SchedulePreview, "list" | "jobs"> = {
    schema: SCHEDULE_PREVIEW_SCHEMA,
    writtenAt: input.now.toISOString(),
    instanceId: input.instanceId,
    capabilities: { session: input.capabilities.session, rules: input.capabilities.rules },
    arming,
    history: historyOf(merged.history.rules),
    sessionHistory: input.journal === undefined ? { kind: "unavailable", why: NO_LAUNCH_JOURNAL_WHY } : historyOf(merged.history.sessions),
    headline: { kind: input.headline.kind, why: input.headline.why, at: input.headline.at },
    missedRunPolicy: { kind: MISSED_RUN_POLICY, sentence: MISSED_RUN_SENTENCE },
    caveat: SCHEDULE_PREVIEW_CAVEAT,
  };
  if (input.list.kind === "not-given") return { ...common, list: { kind: "not-given", why: input.list.why }, jobs: [] };

  const { definitions, evidence } = input.list;
  const plans = planJobs(
    {
      definitions,
      occurrences: merged.occurrences,
      history: merged.history,
      arming: input.arming,
      launchSeparationMs: input.launchSeparationMs,
      nowMs: input.now.getTime(),
      evidence,
      accounts: input.accounts,
    },
    {
      // THE PREVIEW'S LAUNCH: a live session job's launch or resume counts
      // WHETHER OR NOT this daemon holds a launch protocol, because the preview
      // is the forecast of what arming would do — and the spacing arming would
      // apply is exactly what a person deciding to arm needs to see. A disarmed
      // preview that showed two sessions due at once would be hiding it (the
      // read-only check of b0b8ee80, finding 1, reversing a salvaged edit). The
      // row itself says this daemon cannot launch it now (`dispatchSentence`). A
      // rule starts no session; the planner never hands a dry-run job to
      // `launch`.
      launch: (_job, how) => how.kind !== "rule",
      // THE PREVIEW'S SUPERSEDE forecasts the abandonment the tick would make.
      // Nothing is written: the waiting occurrence is still in the journal, and
      // its row's last attempt says so; the replacement is due now.
      supersede: () => ({ kind: "replaced", at: input.now.toISOString() }),
    },
  );
  const jobs = definitions.map((job, index) => {
    const plan = plans[index];
    // One verdict per definition, in order, is `planJobs`'s contract; a
    // mismatch is a bug in it, and a row built from somebody else's verdict
    // would be worse than no file. The daemon catches this and says so.
    if (plan === undefined || plan.jobId !== job.definition.behaviour.id) throw new Error(`the planner returned no verdict for definition ${index} (${job.definition.behaviour.id})`);
    return rowOf(job, plan, input, evidence);
  });
  return { ...common, list: { kind: "given", listRevision: input.list.listRevision }, jobs };
}

function rowOf(job: AuthorisedJob, plan: JobPlan, input: SchedulePreviewInput, evidence: DocumentEvidence): SchedulePreviewJob {
  const behaviour = job.definition.behaviour;
  const schedule = job.definition.schedule;
  // THE GATE'S OWN FUNCTION, asked for what it found — not a second copy of it.
  // The verdict above came from the same call inside `planJobs`, with the same
  // evidence, so the hash printed and the verdict cannot disagree.
  const authorisation = authorisationUnder(job, evidence);
  return {
    jobId: behaviour.id,
    resourceClass: resourceClassOf(behaviour.work),
    dispatch: behaviour.dispatch.kind === "live" ? { kind: "live" } : { kind: "dry-run", why: behaviour.dispatch.why },
    verdict: verdictOf(plan, job, input),
    lastAttempt: attemptOf(plan, behaviour.work),
    schedule: { everyMs: schedule.everyMs, launcherLeaseMs: schedule.leaseMs, initialDelayMs: schedule.initialDelayMs },
    sessionTimeout: runOf(behaviour.work),
    sessionNoOverlap: "enforced",
    prompt: behaviour.what,
    behaviourHash:
      authorisation.kind === "authorised"
        ? { kind: "computed", hash: authorisation.hash }
        : authorisation.found.kind === "hash"
          ? { kind: "computed", hash: authorisation.found.hash }
          : { kind: "not-computed", why: authorisation.found.why },
    authorisedHash: job.authorisedHash,
    documents: documentsOf(job, evidence),
  };
}

function resourceClassOf(work: JobWork): SchedulePreviewJob["resourceClass"] {
  switch (work.kind) {
    case "session":
      return "claude-session";
    case "rule":
      return "in-process-rule";
    default: {
      const never: never = work;
      throw new Error(`no resource class for job work ${JSON.stringify(never)}`);
    }
  }
}

/** A session job's authorised run spec for the row; a rule has none. */
function runOf(work: JobWork): SchedulePreviewRun {
  switch (work.kind) {
    case "session":
      return { kind: "run-spec", timeoutMinutes: work.run.timeoutMinutes, access: work.run.access };
    case "rule":
      return { kind: "not-a-session" };
    default: {
      const never: never = work;
      throw new Error(`no run spec for job work ${JSON.stringify(never)}`);
    }
  }
}

const none = (why: string): SchedulePreviewNext => ({ kind: "none", why });

/** One verdict as a row's verdict: the planner's sentence, and when the job could next run. Exhaustive, so a new `JobPlan` kind is a compile error here. */
function verdictOf(plan: JobPlan, job: AuthorisedJob, input: SchedulePreviewInput): SchedulePreviewVerdict {
  switch (plan.kind) {
    case "history-lost":
      if (job.definition.behaviour.work.kind === "session" && input.journal === undefined) {
        return {
          kind: "held",
          sentence: `held — ${NO_LAUNCH_JOURNAL_WHY}`,
          next: none("nothing runs until this daemon is started with a launch protocol"),
        };
      }
      return job.definition.behaviour.work.kind === "session"
        ? {
            kind: plan.kind,
            sentence: `held — the launch journal is not whole, so nothing is dispatched: ${plan.why}`,
            next: none("nothing runs until the launch journal history is resolved and the daemon restarted"),
          }
        : {
            kind: plan.kind,
            sentence: `held — the rules' occurrence ledger is not whole, so nothing is dispatched: ${plan.why}`,
            next: none("nothing runs until the rules' ledger is reconciled (overseer reconcile-jobs) and the daemon restarted"),
          };
    case "duplicate-id":
      return { kind: plan.kind, sentence: plan.why, next: none("not while two definitions share its id") };
    case "unauthorised":
      return { kind: plan.kind, sentence: plan.why, drift: [...plan.drift], next: none("not until somebody reads what changed and re-pins it") };
    case "held":
      return { kind: plan.kind, sentence: plan.why, next: heldNext(plan, job, input) };
    case "waiting":
      return { kind: plan.kind, sentence: `not due for another ${describeAge(plan.remainingMs)}`, next: { kind: "next-due", at: plan.nextDueAt } };
    case "not-yet-eligible":
      return {
        kind: plan.kind,
        sentence: `never run, and not eligible for another ${describeAge(plan.remainingMs)} — its own first-run delay after the scheduler was armed`,
        next: { kind: "first-eligible", at: plan.firstEligibleAt },
      };
    case "dry-run":
      return { kind: plan.kind, sentence: plan.why, next: { kind: "due-now" } };
    case "spacing-held":
      return { kind: plan.kind, sentence: plan.why, next: { kind: "next-due", at: plan.nextDueAt } };
    case "usage-held":
      return { kind: plan.kind, sentence: plan.why, next: plan.until === null ? none("when a pool account may start a session again, which nothing here can date") : { kind: "next-due", at: plan.until } };
    case "resume":
      return { kind: plan.kind, sentence: resumeSentence(plan.occurrence, input.capabilities), next: { kind: "due-now" } };
    case "dispatch":
      return { kind: plan.kind, sentence: dispatchSentence(plan, input.capabilities), next: { kind: "due-now" } };
    default: {
      const never: never = plan;
      throw new Error(`no preview verdict for ${JSON.stringify(never)}`);
    }
  }
}

/** What a resume verdict means on THIS daemon. It never re-plans: the stored record is driven on. */
function resumeSentence(occurrence: LaunchOccurrence, capabilities: HeldCapabilities): string {
  const waiting = occurrence.standing.kind === "resumable" ? occurrence.standing.why : "waiting";
  const pinned = occurrence.standing.kind === "resumable" && occurrence.standing.account !== null ? ` on pool account ${occurrence.standing.account}` : "";
  return capabilities.session
    ? `its occurrence planned at ${occurrence.reservedAt}${pinned} is ${waiting}: the scheduler resumes it on its next tick — never re-plans it`
    : `its occurrence planned at ${occurrence.reservedAt}${pinned} is ${waiting}, and an armed scheduler would resume it — but this daemon holds no launch protocol, so nothing will`;
}

/**
 * When a held job could next run. `held` is two different situations in
 * `due()`, and they have different answers.
 *
 * **`after-arming` is inferred from the capabilities**, and that is a rendering
 * choice, not a gate: a never-run job on a daemon holding neither capability is
 * on a daemon that is not armed, so its first run is its own delay after
 * somebody arms it (§ D7's *"2 h after it is armed"*). The same `unknown`
 * arming on a daemon that IS armed is `armed.json` failing, and there the
 * honest answer is none.
 */
function heldNext(plan: Extract<JobPlan, { kind: "held" }>, job: AuthorisedJob, input: SchedulePreviewInput): SchedulePreviewNext {
  if (plan.last.kind === "in-flight") return { kind: "after-in-flight-settles", leaseUntil: plan.last.leaseUntil };
  const disarmed = input.arming.kind === "unknown" && !input.capabilities.session && !input.capabilities.rules;
  if (plan.last.kind === "never" && disarmed) return { kind: "after-arming", initialDelayMs: job.definition.schedule.initialDelayMs };
  return none(plan.why);
}

/** What a dispatch verdict means on THIS daemon — which may hold no way to start the job at all. */
function dispatchSentence(plan: Extract<JobPlan, { kind: "dispatch" }>, capabilities: HeldCapabilities): string {
  const how = plan.how;
  switch (how.kind) {
    case "new-session":
      return capabilities.session
        ? `due now: the scheduler plans it on pool account ${how.account} and launches it on its next tick. The rows after this one assume that launch succeeded`
        : `due now, and an armed scheduler would plan it on pool account ${how.account} — but this daemon holds no launch protocol, so nothing will start it. ` +
            "The rows after this one assume the launch, as an armed scheduler's would";
    case "rule":
      return capabilities.rules
        ? "due now: the rule runs inside the daemon on its next tick"
        : "due now, and an armed scheduler would run it — but this daemon holds no rule capability, so nothing will";
    default: {
      const never: never = how;
      throw new Error(`no dispatch sentence for ${JSON.stringify(never)}`);
    }
  }
}

/**
 * **WHAT A STATE WORD MEANS**, said on every occurrence row, because a word can
 * over-promise. A session job's occurrence in the rules' ledger is from before
 * the launch protocol, when the ledger followed the short-lived launcher.
 */
const ATTEMPT_MEANING: Readonly<Record<JobWork["kind"], string>> = {
  session:
    "an occurrence from before the launch protocol, when the ledger followed the gjd-remote launcher, not the session: `finished` is the launcher exiting, " +
    "and the Claude session it started ran on, detached, without the ledger seeing it end",
  rule: "a rule runs inside the daemon, so its occurrence settles when the rule itself has settled",
};

/** A launch occurrence's meaning: the journal's own record of the launch, and not its result. */
const LAUNCH_MEANING =
  "the launch journal's own record of this occurrence: the state is the protocol's, and what the run came to — the wrapper's exit, its answer — " +
  "is the occurrences section's to say, never read off this state";

function launchAttemptOf(occurrence: LaunchOccurrence): SchedulePreviewAttempt {
  const standing = occurrence.standing;
  const common = { kind: "launch" as const, occurrenceId: occurrence.id, launchId: occurrence.launchId, plannedAt: occurrence.reservedAt, why: standing.why, meaning: LAUNCH_MEANING };
  switch (standing.kind) {
    case "resumable":
      return { ...common, state: standing.state, standing: "resumable", endedAt: null };
    case "open":
      return { ...common, state: standing.state, standing: "open", endedAt: null };
    case "settled":
      return { ...common, state: standing.state, standing: "settled", endedAt: standing.endedAt };
    case "replaced":
      return { ...common, state: "superseded", standing: "replaced", endedAt: standing.endedAt };
    default: {
      const never: never = standing;
      throw new Error(`no preview for launch ${JSON.stringify(never)}`);
    }
  }
}

function attemptOf(plan: JobPlan, work: JobWork): SchedulePreviewAttempt {
  if (plan.kind === "history-lost") {
    // NOT `never`. A partial ledger read as "never run" is C3 arriving through
    // the preview instead of the tick.
    return { kind: "not-known", why: `the occurrence ledger is not whole (${plan.why}), so what ran last cannot be read from it` };
  }
  if (plan.attempt.kind === "never") return { kind: "never" };
  const occurrence = plan.attempt.occurrence;
  if (occurrence.kind === "launch") return launchAttemptOf(occurrence);
  const meaning = ATTEMPT_MEANING[work.kind];
  const common = { occurrenceId: occurrence.id, reservedAt: occurrence.reservedAt, meaning };
  switch (occurrence.kind) {
    case "reserved":
      return { kind: occurrence.kind, ...common, leaseUntil: occurrence.leaseUntil };
    case "started":
      return { kind: occurrence.kind, ...common, startedAt: occurrence.startedAt, leaseUntil: occurrence.leaseUntil, pid: occurrence.pid };
    case "finished":
      return {
        kind: occurrence.kind,
        ...common,
        finishedAt: occurrence.finishedAt,
        outcome: occurrence.outcome.kind === "exited" ? { kind: "exited", code: occurrence.outcome.code } : { kind: "failed", why: occurrence.outcome.why },
      };
    case "refused":
      return { kind: occurrence.kind, ...common, refusedAt: occurrence.refusedAt, why: occurrence.why };
    case "unknown":
      return {
        kind: occurrence.kind,
        ...common,
        why: occurrence.why,
        noticed: occurrence.source.kind === "derived" ? { kind: "derived" } : { kind: "recorded", at: occurrence.source.noticedAt },
      };
    default: {
      const never: never = occurrence;
      throw new Error(`no preview for occurrence ${JSON.stringify(never)}`);
    }
  }
}

/**
 * Each document's pin beside its reading now — the pinned list first, then any
 * the job leans on that were never pinned.
 *
 * A session job's reading is this checkpoint's evidence; a rule's is the digest
 * of the code the daemon loaded, which is the evidence the gate uses for it
 * (`schedule-plan.ts` § `DocumentEvidence`), and the row says which it is.
 */
function documentsOf(job: AuthorisedJob, evidence: DocumentEvidence): SchedulePreviewDocument[] {
  const behaviour = job.definition.behaviour;
  const current = new Map<string, SchedulePreviewDocument["current"]>();
  switch (behaviour.work.kind) {
    case "session": {
      const readings = documentEvidenceFor(evidence, job);
      if (readings === undefined) {
        for (const document of [...job.authorisedDocuments, ...behaviour.documents]) {
          current.set(document.path, { kind: "unreadable", why: "no reading of this job's documents was taken this checkpoint" });
        }
      } else {
        for (const reading of readings) {
          current.set(reading.path, reading.kind === "read" ? { kind: "read", sha256: reading.sha256, when: "this-checkpoint" } : { kind: "unreadable", why: reading.why });
        }
      }
      break;
    }
    case "rule":
      for (const document of behaviour.documents) current.set(document.path, { kind: "read", sha256: document.sha256, when: "when-loaded" });
      break;
    default: {
      const never: never = behaviour.work;
      throw new Error(`no documents for job work ${JSON.stringify(never)}`);
    }
  }
  const pinned = new Map(job.authorisedDocuments.map((document) => [document.path, document.sha256]));
  const paths = [...new Set([...pinned.keys(), ...current.keys()])];
  return paths.map((path) => {
    const pin = pinned.get(path);
    const now = current.get(path) ?? { kind: "absent" as const };
    const changed: SchedulePreviewDocument["changed"] =
      now.kind === "unreadable" ? "cannot-tell" : now.kind === "absent" || pin === undefined || pin !== now.sha256 ? "yes" : "no";
    return { path, pinned: pin === undefined ? { kind: "not-pinned" } : { kind: "pinned", sha256: pin }, current: now, changed };
  });
}

/**
 * Write the file, atomically: the whole preview to a temp file, then a rename
 * over the old one — `arming.ts`'s write, for the same reason. A reader sees the
 * previous tick's file or this one, never half of either.
 *
 * Returns a result rather than throwing: the daemon calls this every 30 seconds
 * and a failure here must never stop it.
 */
export function writeSchedulePreview(storeDir: string, preview: SchedulePreview): { ok: true } | { ok: false; why: string } {
  const path = join(storeDir, SCHEDULE_PREVIEW_FILE);
  const temporary = `${path}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(preview, null, 2)}\n`, "utf8");
    renameSync(temporary, path);
    return { ok: true };
  } catch (cause) {
    return { ok: false, why: `${SCHEDULE_PREVIEW_FILE} could not be written (${cause instanceof Error ? cause.message : String(cause)})` };
  }
}

/**
 * What a reader finds. `absent` is its own arm — a daemon that predates this
 * build writes nothing, and that is not the same as a file it could not read.
 */
export type SchedulePreviewRead = { readonly kind: "absent" } | SchedulePreviewParse;

export function readSchedulePreviewFile(storeDir: string): SchedulePreviewRead {
  const path = join(storeDir, SCHEDULE_PREVIEW_FILE);
  if (!existsSync(path)) return { kind: "absent" };
  try {
    const size = statSync(path).size;
    if (size > MAX_FILE_BYTES) return { kind: "unreadable", why: `${SCHEDULE_PREVIEW_FILE} is ${size} bytes, more than the daemon writes, so it was not read` };
    return parseSchedulePreview(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch (cause) {
    return { kind: "unreadable", why: `${SCHEDULE_PREVIEW_FILE} could not be read (${cause instanceof Error ? cause.message : String(cause)})` };
  }
}

/* ------------------------------------------------------------------ *
 * The CLI block `overseer status` prints after its own lines.
 * ------------------------------------------------------------------ */

/** The label column `status-cli.ts` uses, so this block lines up under the rest of the page. */
const LABEL = 12;
const INDENT = " ".repeat(LABEL);
const SUB = " ".repeat(LABEL + 2);
const label = (text: string): string => text.padEnd(LABEL);
const subLabel = (text: string): string => `${SUB}${text.padEnd(10)}`;

/**
 * **LONDON FIRST**, as plan 260910e § D1 asks, with each day marked against
 * London rather than UTC — `zones.ts` § `zonedLineAgainstFirst` says why. The
 * formatting lives there, a browser-safe leaf, so the Overseer tab prints these
 * instants exactly as this block does; what is left here is the CLI's words for
 * an instant it cannot read.
 */
export function londonFirst(iso: string): string {
  return londonFirstLine(iso) ?? `${iso} (a time this build cannot read)`;
}

/** An instant against the reader's clock, in the direction it lies. */
function relative(iso: string, nowMs: number): string {
  const ms = Date.parse(iso) - nowMs;
  return ms >= 0 ? `in ${describeAge(ms)}` : `${describeAge(-ms)} ago`;
}

/**
 * The `schedule` block: one headline line, the list comparison, then per job
 * its verdict, next run, last attempt, dispatch mode and prompt revision.
 *
 * `checkout` is the list THIS checkout builds (`standingJobs` + `ruleJobs`),
 * so the block can say whether the running daemon holds it — the one question a
 * reader cannot answer from the file alone.
 */
export function schedulePreviewLines(
  read: SchedulePreviewRead,
  checkout: { readonly built: BuiltList; readonly runningInstanceId?: string | null },
  nowMs: number,
): string[] {
  const builds = `${INDENT}${builtListText(checkout.built)}`;
  switch (read.kind) {
    case "absent":
      return [
        checkout.runningInstanceId === undefined
          ? `${label("schedule")}NO PREVIEW — there is no ${SCHEDULE_PREVIEW_FILE} in this store: the running daemon predates this build and writes no preview ` +
            "(a daemon of this build writes one on every checkpoint tick)"
          : checkout.runningInstanceId === null
            ? `${label("schedule")}NO PREVIEW — there is no ${SCHEDULE_PREVIEW_FILE} and no readable current checkpoint; ` +
              "the daemon may predate this build or may not have completed a successful preview write"
            : `${label("schedule")}NO PREVIEW — current checkpoint instance ${checkout.runningInstanceId} has not completed a successful preview write: ` +
              `there is no ${SCHEDULE_PREVIEW_FILE} (it may predate this build, still be inside its first checkpoint interval, or be failing to write the file)`,
        builds,
      ];
    case "unsupported-schema":
      return [
        `${label("schedule")}UNREADABLE BY THIS BUILD — ${SCHEDULE_PREVIEW_FILE} is schema ${read.schema} and this build reads schema ${SCHEDULE_PREVIEW_SCHEMA}, ` +
          "so the daemon that wrote it is a different build from this checkout",
        builds,
      ];
    case "unreadable":
      return [`${label("schedule")}UNREADABLE — ${read.why}`, builds];
    case "preview":
      return previewLines(read.preview, checkout, nowMs);
    default: {
      const never: never = read;
      throw new Error(`no schedule block for ${JSON.stringify(never)}`);
    }
  }
}

function previewLines(preview: ParsedSchedulePreview, checkout: { readonly built: BuiltList; readonly runningInstanceId?: string | null }, nowMs: number): string[] {
  const fromAnotherInstance =
    checkout.runningInstanceId !== undefined && checkout.runningInstanceId !== null && checkout.runningInstanceId !== preview.instanceId;
  const lines = [
    // A PREVIEW FROM ANOTHER DAEMON INSTANCE SAYS SO ON ITS FIRST LINE, not only
    // its second: the first line is the one a person reads, and its headline
    // (ARMED, say) is that other daemon's word, not the current one's.
    `${label("schedule")}${fromAnotherInstance ? "FROM ANOTHER DAEMON INSTANCE, " : ""}` +
      `${preview.headline.kind.toUpperCase()} — preview as of ${londonFirst(preview.writtenAt)} ` +
      `(${describeAge(nowMs - Date.parse(preview.writtenAt))} old), written by instance ${preview.instanceId}`,
    `${INDENT}${listLine(preview.list, checkout, preview.instanceId)}`,
    `${INDENT}arming: ${preview.arming.kind === "armed" ? `armed at ${londonFirst(preview.arming.at)}` : `none — ${preview.arming.why}`}`,
    `${INDENT}history: ${preview.history.kind === "intact" ? "the rules' ledger is whole" : `the rules' ledger is LOST, so every rule is held — ${preview.history.why}`}`,
    `${INDENT}sessions: ${sessionHistoryLine(preview.sessionHistory)}`,
    `${INDENT}this daemon holds: launch protocol ${preview.capabilities.session ? "yes" : "no"}, rule runner ${preview.capabilities.rules ? "yes" : "no"}`,
    `${INDENT}missed runs: ${preview.missedRunPolicy.kind} — ${preview.missedRunPolicy.sentence}`,
    `${INDENT}${preview.caveat}`,
  ];
  if (preview.list.kind === "given" && preview.jobs.length === 0) lines.push(`${INDENT}the list holds no jobs`);
  for (const row of preview.jobs) lines.push("", ...rowLines(row, nowMs));
  return lines;
}

function sessionHistoryLine(history: ParsedSchedulePreview["sessionHistory"]): string {
  switch (history.kind) {
    case "intact":
      return "the launch journal is whole";
    case "lost":
      return `the launch journal is LOST, so every session job is held — ${history.why}`;
    case "unavailable":
      return `this daemon cannot read a launch journal, so every session job is held — ${history.why}`;
    default: {
      const never: never = history;
      throw new Error(`no session-history line for ${JSON.stringify(never)}`);
    }
  }
}

function listLine(
  list: ParsedSchedulePreview["list"],
  checkout: { readonly built: BuiltList; readonly runningInstanceId?: string | null },
  previewInstanceId: string,
): string {
  const builds = builtListText(checkout.built);
  if (checkout.runningInstanceId !== undefined && checkout.runningInstanceId !== previewInstanceId) {
    return checkout.runningInstanceId === null
      ? `this preview was written by daemon instance ${previewInstanceId}, and there is no readable current checkpoint, so it does not say which list the current daemon holds; ${builds}`
      : `this preview was written by daemon instance ${previewInstanceId}, while the current checkpoint belongs to ${checkout.runningInstanceId}, so it does not say which list the current daemon holds; ${builds}`;
  }
  if (list.kind === "not-given") {
    return `the running daemon was given no job list (${list.why}), so it previews nothing; ${builds}`;
  }
  // AN UNBUILT LIST IS NEVER COMPARED: the empty list a failed read leaves has a hash too (Sol's F40).
  if (checkout.built.kind === "unbuildable") return `the running daemon holds list ${list.listRevision}; ${builds}, so the two are not compared`;
  if (list.listRevision === checkout.built.listRevision) return `the running daemon holds list ${list.listRevision}, the same list this checkout builds`;
  return `the running daemon holds list ${list.listRevision}; this checkout builds ${checkout.built.listRevision} — a restart loads it`;
}

/**
 * The job list a checkout builds, or why it could not build it. When either
 * builder reports a problem there is no revision at all — not the hash of
 * whatever part was built — so nothing can compare against it and call the two
 * "the same list" (Sol's F40 on plan 260910f stage 2).
 */
export type BuiltList = { kind: "built"; listRevision: string } | { kind: "unbuildable"; problems: readonly string[] };

const SHOWN_PROBLEMS = 3;
const PROBLEM_CHARS = 240;

/** `this checkout builds list …`, or why it builds none, bounded to a few problems of a line each. */
export function builtListText(built: BuiltList): string {
  if (built.kind === "built") return `this checkout builds list ${built.listRevision}`;
  const shown = built.problems.slice(0, SHOWN_PROBLEMS).map((problem) => (problem.length > PROBLEM_CHARS ? `${problem.slice(0, PROBLEM_CHARS - 1)}…` : problem));
  const more = built.problems.length > SHOWN_PROBLEMS ? `; and ${built.problems.length - SHOWN_PROBLEMS} more` : "";
  return `this checkout's job list could not be built: ${shown.length === 0 ? "(no reason given)" : shown.join("; ")}${more}`;
}

/** The word each verdict gets on the page. The compiler counts them. */
const VERDICT_LABEL: Readonly<Record<SchedulePreviewVerdictKind, string>> = {
  "history-lost": "HELD, LEDGER NOT WHOLE",
  "duplicate-id": "DUPLICATE ID",
  unauthorised: "NOT AUTHORISED",
  held: "HELD",
  waiting: "WAITING",
  "not-yet-eligible": "NOT YET ELIGIBLE",
  "dry-run": "DRY RUN",
  "spacing-held": "WAITING FOR SPACING",
  "usage-held": "HELD FOR A POOL ACCOUNT",
  resume: "WOULD RESUME",
  dispatch: "WOULD DISPATCH",
};

/** A run spec as the page says it. */
export function runLine(run: SchedulePreviewRun): string {
  return run.kind === "run-spec" ? `${run.timeoutMinutes} min, ${run.access} access` : "not a session";
}

function rowLines(row: SchedulePreviewRow, nowMs: number): string[] {
  if (row.kind === "unreadable") return [`${INDENT}${row.jobId ?? "(a row with no readable id)"}  UNREADABLE — ${row.why}`];
  const job = row.job;
  const mode = job.dispatch.kind === "live" ? "live" : `DRY-RUN — ${job.dispatch.why}`;
  const lines = [
    `${INDENT}${job.jobId} — ${job.resourceClass}, ${mode}`,
    `${subLabel("verdict")}${VERDICT_LABEL[job.verdict.kind]} — ${job.verdict.sentence}`,
    `${subLabel("next")}${nextLine(job.verdict.next, nowMs)}`,
    ...attemptLines(job.lastAttempt, nowMs),
    `${subLabel("what")}${JSON.stringify(job.prompt.length > 200 ? `${job.prompt.slice(0, 200)}…` : job.prompt)}`,
    `${subLabel("prompt")}${hashLine(job)}`,
    ...documentLines(job),
    `${subLabel("clock")}every ${describeAge(job.schedule.everyMs)}, launcher lease ${describeAge(job.schedule.launcherLeaseMs)}, ` +
      `first run ${describeAge(job.schedule.initialDelayMs)} after arming; session timeout ${runLine(job.sessionTimeout)}; session no-overlap ${job.sessionNoOverlap}`,
  ];
  return lines;
}

function nextLine(next: SchedulePreviewNext, nowMs: number): string {
  switch (next.kind) {
    case "due-now":
      return "due now";
    case "next-due":
      return `${londonFirst(next.at)} (${relative(next.at, nowMs)})`;
    case "first-eligible":
      return `first eligible ${londonFirst(next.at)} (${relative(next.at, nowMs)})`;
    case "after-in-flight-settles":
      return `after the run in flight settles — its launcher lease runs to ${londonFirst(next.leaseUntil)}`;
    case "after-arming":
      return `${describeAge(next.initialDelayMs)} after the scheduler is armed`;
    case "none":
      return `none — ${next.why}`;
    default: {
      const never: never = next;
      throw new Error(`no next-run line for ${JSON.stringify(never)}`);
    }
  }
}

function attemptLines(attempt: SchedulePreviewAttempt, nowMs: number): string[] {
  const last = subLabel("last");
  const at = (iso: string): string => `${londonFirst(iso)} (${relative(iso, nowMs)})`;
  switch (attempt.kind) {
    case "never":
      return [`${last}never run`];
    case "not-known":
      return [`${last}NOT KNOWN — ${attempt.why}`];
    case "launch":
      return [
        `${last}${attempt.state.toUpperCase()} — planned ${at(attempt.plannedAt)}${attempt.endedAt === null ? "" : `, ended ${at(attempt.endedAt)}`}: ${attempt.why}`,
        `${SUB}${" ".repeat(10)}${attempt.launchId}; ${attempt.meaning}`,
      ];
    case "reserved":
      return [`${last}reserved ${at(attempt.reservedAt)}, no start recorded yet; lease until ${londonFirst(attempt.leaseUntil)}`, `${SUB}${" ".repeat(10)}${attempt.meaning}`];
    case "started":
      return [`${last}started ${at(attempt.startedAt)} as pid ${attempt.pid}; lease until ${londonFirst(attempt.leaseUntil)}`, `${SUB}${" ".repeat(10)}${attempt.meaning}`];
    case "finished":
      return [
        `${last}finished ${at(attempt.finishedAt)}: ${attempt.outcome.kind === "exited" ? `exit ${attempt.outcome.code}` : `failed — ${attempt.outcome.why}`}`,
        `${SUB}${" ".repeat(10)}${attempt.meaning}`,
      ];
    case "refused":
      return [`${last}refused ${at(attempt.refusedAt)}: ${attempt.why}`];
    case "unknown":
      return [
        `${last}UNKNOWN — reserved ${at(attempt.reservedAt)} and nothing can say what happened: ${attempt.why}` +
          (attempt.noticed.kind === "recorded" ? ` (written down ${londonFirst(attempt.noticed.at)})` : ""),
      ];
    default: {
      const never: never = attempt;
      throw new Error(`no last-attempt line for ${JSON.stringify(never)}`);
    }
  }
}

function hashLine(job: SchedulePreviewJob): string {
  if (job.behaviourHash.kind === "not-computed") return `NO FINGERPRINT — ${job.behaviourHash.why}; pinned ${job.authorisedHash}`;
  if (job.behaviourHash.hash === job.authorisedHash) return `fingerprint ${job.behaviourHash.hash}, matching its pin`;
  return `fingerprints as ${job.behaviourHash.hash}, pinned ${job.authorisedHash} — NOT the job that was authorised`;
}

/**
 * A line per document that moved or could not be read, WITH BOTH FULL DIGESTS —
 * `sha256sum` prints the full one, so that is what a reader compares — and one
 * line for all the documents that are exactly as pinned.
 */
function documentLines(job: SchedulePreviewJob): string[] {
  const lines: string[] = [];
  let unchanged = 0;
  for (const document of job.documents) {
    const pinned = document.pinned.kind === "pinned" ? `pinned ${document.pinned.sha256}` : "never pinned";
    switch (document.current.kind) {
      case "unreadable":
        lines.push(`${subLabel("document")}${document.path}: ${pinned}; COULD NOT BE READ — ${document.current.why}`);
        break;
      case "absent":
        lines.push(`${subLabel("document")}${document.path}: ${pinned}; no longer among the documents it leans on — CHANGED`);
        break;
      case "read":
        if (document.changed === "no") unchanged += 1;
        else lines.push(`${subLabel("document")}${document.path}: ${pinned}, now ${document.current.sha256} — CHANGED since it was authorised`);
        break;
      default: {
        const never: never = document.current;
        throw new Error(`no document line for ${JSON.stringify(never)}`);
      }
    }
  }
  if (unchanged > 0) lines.push(`${subLabel("documents")}${unchanged} exactly as pinned`);
  return lines;
}
