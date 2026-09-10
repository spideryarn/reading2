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
 * preview's `launch` answers `true` for a live session job when this daemon
 * holds a session dispatcher, and `false` otherwise — and the file says, on
 * every row it affects and once at the top, that **rows after a proposed launch
 * assume it succeeded**.
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

import { parseSchedulePreview, SCHEDULE_PREVIEW_SCHEMA } from "../fleet/schedule-parse.js";
import type {
  ParsedSchedulePreview,
  SchedulePreview,
  SchedulePreviewAttempt,
  SchedulePreviewDocument,
  SchedulePreviewJob,
  SchedulePreviewNext,
  SchedulePreviewParse,
  SchedulePreviewRow,
  SchedulePreviewVerdict,
  SchedulePreviewVerdictKind,
} from "../fleet/wire.js";
import { zonedReadings, type Zones } from "../fleet/zones.js";
import { describeAge } from "./format-age.js";
import type { Arming, AuthorisedJob, JobWork, OccurrenceHistory, OccurrenceIndex } from "./jobs.js";
import { authorisationUnder, planJobs, type DocumentEvidence, type JobPlan } from "./schedule-plan.js";
import type { HeldCapabilities } from "./scheduler.js";
import type { StoredScheduler } from "./store.js";

/** The file, inside the store directory — beside `armed.json`, for the reason `arming.ts` gives: it is a fact about one store's scheduler. */
export const SCHEDULE_PREVIEW_FILE = "schedule.json";

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
  readonly occurrences: OccurrenceIndex;
  readonly history: OccurrenceHistory;
  readonly arming: Arming;
  readonly launchSeparationMs: number;
  /** What the daemon holds — not what it would hold armed. A disarmed daemon holds neither. */
  readonly capabilities: HeldCapabilities;
  /** The headline the same checkpoint wrote, so the file and `current.json` cannot disagree about it. */
  readonly headline: StoredScheduler;
};

export function schedulePreview(input: SchedulePreviewInput): SchedulePreview {
  const arming: SchedulePreview["arming"] = input.arming.kind === "armed" ? { kind: "armed", at: input.arming.at } : { kind: "none", why: input.arming.why };
  const history: SchedulePreview["history"] = input.history.kind === "intact" ? { kind: "intact" } : { kind: "lost", why: input.history.why };
  const common: Omit<SchedulePreview, "list" | "jobs"> = {
    schema: SCHEDULE_PREVIEW_SCHEMA,
    writtenAt: input.now.toISOString(),
    instanceId: input.instanceId,
    capabilities: { session: input.capabilities.session, rules: input.capabilities.rules },
    arming,
    history,
    headline: { kind: input.headline.kind, why: input.headline.why, at: input.headline.at },
    missedRunPolicy: { kind: MISSED_RUN_POLICY, sentence: MISSED_RUN_SENTENCE },
    caveat: SCHEDULE_PREVIEW_CAVEAT,
  };
  if (input.list.kind === "not-given") return { ...common, list: { kind: "not-given", why: input.list.why }, jobs: [] };

  const { definitions, evidence } = input.list;
  const plans = planJobs(
    {
      definitions,
      occurrences: input.occurrences,
      history: input.history,
      arming: input.arming,
      launchSeparationMs: input.launchSeparationMs,
      nowMs: input.now.getTime(),
      evidence,
    },
    // THE PREVIEW'S LAUNCH: a live session job counts as a launch only when this
    // process has a dispatcher, so the rows after it are spaced exactly as the
    // tick's would be if the proposed launch succeeded. A refusal for a missing
    // capability and a rule start no session. (The planner never hands a dry-run
    // job to `launch`; the check is here so this line says the whole rule.)
    (job) => input.capabilities.session && job.definition.behaviour.work.kind === "session" && job.definition.behaviour.dispatch.kind === "live",
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
    sessionTimeout: "not built",
    sessionNoOverlap: "not enforced",
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

const none = (why: string): SchedulePreviewNext => ({ kind: "none", why });

/** One verdict as a row's verdict: the planner's sentence, and when the job could next run. Exhaustive, so a new `JobPlan` kind is a compile error here. */
function verdictOf(plan: JobPlan, job: AuthorisedJob, input: SchedulePreviewInput): SchedulePreviewVerdict {
  switch (plan.kind) {
    case "history-lost":
      return {
        kind: plan.kind,
        sentence: `held — the occurrence ledger is not whole, so nothing is dispatched: ${plan.why}`,
        next: none("nothing runs until the ledger is reconciled (overseer reconcile-jobs) and the daemon restarted"),
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
    case "dispatch":
      return { kind: plan.kind, sentence: dispatchSentence(job, input.capabilities), next: { kind: "due-now" } };
    default: {
      const never: never = plan;
      throw new Error(`no preview verdict for ${JSON.stringify(never)}`);
    }
  }
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
function dispatchSentence(job: AuthorisedJob, capabilities: HeldCapabilities): string {
  const work = job.definition.behaviour.work;
  switch (work.kind) {
    case "session":
      return capabilities.session
        ? "due now: the scheduler reserves and launches it on its next tick. The rows after this one assume that launch succeeded"
        : "due now, and an armed scheduler would launch it — but this daemon holds no session dispatcher, so nothing will start it. " +
            "The rows after this one assume the launch, as an armed scheduler's would";
    case "rule":
      return capabilities.rules
        ? "due now: the rule runs inside the daemon on its next tick"
        : "due now, and an armed scheduler would run it — but this daemon holds no rule capability, so nothing will";
    default: {
      const never: never = work;
      throw new Error(`no dispatch sentence for job work ${JSON.stringify(never)}`);
    }
  }
}

/**
 * **WHAT `finished` MEANS**, said on every occurrence row, because the word
 * over-promises for a session job: the ledger follows the short-lived launcher
 * (`dispatch.ts` § the launcher), and the session it starts is invisible to it.
 */
const ATTEMPT_MEANING: Readonly<Record<JobWork["kind"], string>> = {
  session:
    "for a session job the ledger follows the gjd-remote launcher, not the session: `finished` is the launcher exiting, " +
    "and the Claude session it started runs on, detached, without the ledger seeing it end",
  rule: "a rule runs inside the daemon, so its occurrence settles when the rule itself has settled",
};

function attemptOf(plan: JobPlan, work: JobWork): SchedulePreviewAttempt {
  if (plan.kind === "history-lost") {
    // NOT `never`. A partial ledger read as "never run" is C3 arriving through
    // the preview instead of the tick.
    return { kind: "not-known", why: `the occurrence ledger is not whole (${plan.why}), so what ran last cannot be read from it` };
  }
  if (plan.attempt.kind === "never") return { kind: "never" };
  const occurrence = plan.attempt.occurrence;
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
      const readings = evidence.get(behaviour.id);
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
 * **LONDON FIRST**, as plan 260910e § D1 asks — built on `zones.ts`'s
 * readings rather than on `zonedLine`, and the reason is a misreading rather
 * than taste. `zonedLine` prints the FIRST zone's date and marks every zone's
 * day against UTC's, which is right when UTC is first. With London first, an
 * instant at 23:30 UTC would print `2026-09-11 00:30 London (+1d)` — London's
 * own date, and then a `+1d` that reads as the day after it. So the marks here
 * are taken against the first zone, which is the date actually printed.
 */
const LONDON_FIRST: Zones = [
  { zone: "Europe/London", label: "London" },
  { zone: "UTC", label: "UTC" },
  { zone: "Europe/Athens", label: "Athens" },
];

export function londonFirst(iso: string): string {
  const readings = zonedReadings(iso, LONDON_FIRST);
  const first = readings?.[0];
  if (readings === null || first === undefined) return `${iso} (a time this build cannot read)`;
  return readings
    .map((reading, index) => {
      const days = reading.dayOffset - first.dayOffset;
      const mark = days === 0 ? "" : days > 0 ? ` (+${days}d)` : ` (−${Math.abs(days)}d)`;
      return `${index === 0 ? `${reading.date} ` : ""}${reading.time} ${reading.label}${mark}`;
    })
    .join(" · ");
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
  checkout: { readonly listRevision: string; readonly runningInstanceId?: string | null },
  nowMs: number,
): string[] {
  const builds = `${INDENT}this checkout builds list ${checkout.listRevision}`;
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

function previewLines(preview: ParsedSchedulePreview, checkout: { readonly listRevision: string; readonly runningInstanceId?: string | null }, nowMs: number): string[] {
  const lines = [
    `${label("schedule")}${preview.headline.kind.toUpperCase()} — preview as of ${londonFirst(preview.writtenAt)} ` +
      `(${describeAge(nowMs - Date.parse(preview.writtenAt))} old), written by instance ${preview.instanceId}`,
    `${INDENT}${listLine(preview.list, checkout, preview.instanceId)}`,
    `${INDENT}arming: ${preview.arming.kind === "armed" ? `armed at ${londonFirst(preview.arming.at)}` : `none — ${preview.arming.why}`}`,
    `${INDENT}history: ${preview.history.kind === "intact" ? "the occurrence ledger is whole" : `LOST, so every job is held — ${preview.history.why}`}`,
    `${INDENT}this daemon holds: session dispatcher ${preview.capabilities.session ? "yes" : "no"}, rule runner ${preview.capabilities.rules ? "yes" : "no"}`,
    `${INDENT}missed runs: ${preview.missedRunPolicy.kind} — ${preview.missedRunPolicy.sentence}`,
    `${INDENT}${preview.caveat}`,
  ];
  if (preview.list.kind === "given" && preview.jobs.length === 0) lines.push(`${INDENT}the list holds no jobs`);
  for (const row of preview.jobs) lines.push("", ...rowLines(row, nowMs));
  return lines;
}

function listLine(
  list: ParsedSchedulePreview["list"],
  checkout: { readonly listRevision: string; readonly runningInstanceId?: string | null },
  previewInstanceId: string,
): string {
  if (checkout.runningInstanceId !== undefined && checkout.runningInstanceId !== previewInstanceId) {
    return checkout.runningInstanceId === null
      ? `this preview was written by daemon instance ${previewInstanceId}, and there is no readable current checkpoint, so it does not say which list the current daemon holds; ` +
          `this checkout builds list ${checkout.listRevision}`
      : `this preview was written by daemon instance ${previewInstanceId}, while the current checkpoint belongs to ${checkout.runningInstanceId}, so it does not say which list the current daemon holds; ` +
          `this checkout builds list ${checkout.listRevision}`;
  }
  if (list.kind === "not-given") {
    return `the running daemon was given no job list (${list.why}), so it previews nothing; this checkout builds list ${checkout.listRevision}`;
  }
  if (list.listRevision === checkout.listRevision) return `the running daemon holds list ${list.listRevision}, the same list this checkout builds`;
  return `the running daemon holds list ${list.listRevision}; this checkout builds ${checkout.listRevision} — a restart loads it`;
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
  dispatch: "WOULD DISPATCH",
};

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
      `first run ${describeAge(job.schedule.initialDelayMs)} after arming; session timeout ${job.sessionTimeout}; session no-overlap ${job.sessionNoOverlap}`,
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
