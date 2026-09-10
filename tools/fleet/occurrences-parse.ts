/**
 * **THE ONE PARSER OF `occurrences.json`** — plan
 * 260910f-scheduled-dispatch § D7.
 *
 * The daemon writes `~/.overseer/occurrences.json` beside `schedule.json` at
 * every checkpoint (`tools/overseer/occurrences-projection.ts`): per session
 * job, its run spec, its next occurrence and its newest occurrences with the
 * result each one came to. The daemon, the fleet route and the browser read it
 * through this, so what one surface refuses every surface refuses.
 *
 * **A LEAF WITH NO NODE IMPORTS**, for the reason `schedule-parse.ts` gives: the
 * browser bundle imports it. Its imports are type-only ones from `wire.ts`,
 * and `schedule-parse.ts`'s reader of `next`, itself such a leaf — the `next`
 * here is the preview's own answer, copied, and must be read exactly as the
 * preview's parser reads it.
 *
 * ## It never throws, and what it does not know is stated per row
 *
 * There are two levels of row, because there are two kinds of thing a newer
 * daemon can add:
 *
 * - **An occurrence** in a state, with a result kind, an access or an answer
 *   kind this build does not know is that OCCURRENCE's own `unreadable` row.
 *   So is a known state paired with a result the classifier never gives it
 *   (`tools/overseer/occurrence-result.ts`): `succeeded` on a launch that is
 *   still running is the lie plan D6 exists to stop, and a reader must not draw
 *   it because a file said so.
 * - **A job** whose `next`, run spec or dispatch this build does not know is
 *   that JOB's `unreadable` row, naming the job.
 *
 * Neither is ever the whole file, and neither is ever mapped to a different
 * kind. **A top-level field it cannot read** makes the file `unreadable`, and
 * **a schema it does not read** is `unsupported-schema`, its own answer.
 *
 * Instants are range-checked the way `schedule-parse.ts` checks them, for the
 * reason its header gives.
 */
import { readSchedulePreviewNext } from "./schedule-parse.js";
import type {
  ScheduledAnswer,
  ScheduledJournalStanding,
  ScheduledLaunchState,
  ScheduledOccurrence,
  ScheduledOccurrencesFile,
  ScheduledOccurrencesJob,
  ScheduledResult,
  ScheduledJobRunSpec,
  ScheduledResultKind,
  ScheduledRunSpec,
} from "./wire.js";

/** The schema this build writes and reads. */
export const OCCURRENCES_SCHEMA = 1;

/** The file's name under the Overseer store root. */
export const OCCURRENCES_FILE = "occurrences.json";

/** How many occurrences per job the file carries, newest first. */
export const OCCURRENCES_PER_JOB = 10;

/**
 * The launch protocol's occurrence id: `lo-` and twenty lower-case hex. The
 * answer route builds a path from it, so it is checked here as well as there:
 * an occurrence whose id is not this shape is unreadable and carries no id a
 * page could link.
 */
export const LAUNCH_OCCURRENCE_ID = /^lo-[0-9a-f]{20}$/;

/** One occurrence, or why this build could not read it — with its id only when the id was the protocol's shape. */
export type OccurrenceRow = { kind: "occurrence"; occurrence: ScheduledOccurrence } | { kind: "unreadable"; launchOccurrenceId: string | null; why: string };

export type ParsedOccurrencesJob = Omit<ScheduledOccurrencesJob, "occurrences"> & { occurrences: OccurrenceRow[] };

/** One job, or why this build could not read it — with its id when it had a readable one. */
export type OccurrencesJobRow = { kind: "job"; job: ParsedOccurrencesJob } | { kind: "unreadable"; jobId: string | null; why: string };

/** The file, with each job and each of its occurrences as a row. */
export type ParsedOccurrencesFile = Omit<ScheduledOccurrencesFile, "jobs"> & { jobs: OccurrencesJobRow[] };

export type OccurrencesParse =
  | { kind: "parsed"; file: ParsedOccurrencesFile }
  | { kind: "unreadable"; why: string }
  | { kind: "unsupported-schema"; saw: number; known: typeof OCCURRENCES_SCHEMA; why: string };

/** More rows than any job list this box will carry, and few enough that a damaged file cannot make a reader build a huge table. */
const MAX_JOBS = 500;
/** Per job. The writer carries `OCCURRENCES_PER_JOB`; this only bounds a damaged file, so a newer writer with a larger window still reads. */
const MAX_OCCURRENCES = 500;
const MAX_TEXT = 20_000;
/** The protocol's attempt directories run `a1`..`a999`. */
const MAX_ATTEMPTS = 999;
/** A week. A run spec's timeout is minutes to hours; this only refuses nonsense. */
const MAX_TIMEOUT_MINUTES = 7 * 24 * 60;
const INSTANT_RANGE_MS = 8.64e15;
const HEX = /^[0-9a-f]{8,64}$/;
/** A whole sha256, as `digest("hex")` writes it. */
const SHA256 = /^[0-9a-f]{64}$/;

/** Every result kind this build knows, with the compiler counting. */
const RESULT_KINDS: { readonly [K in ScheduledResultKind]: true } = {
  pending: true,
  "admission-waiting": true,
  running: true,
  unknown: true,
  superseded: true,
  "launch-failed": true,
  "timed-out": true,
  "quota-refused": true,
  interrupted: true,
  "permission-denied": true,
  "missing-answer": true,
  failed: true,
  succeeded: true,
};

const ENDINGS: readonly ScheduledResultKind[] = [
  "launch-failed",
  "timed-out",
  "quota-refused",
  "interrupted",
  "permission-denied",
  "missing-answer",
  "failed",
  "succeeded",
];

/** The only classifier results whose `at` is null. `unknown` is open but dated by when uncertainty was recorded. */
const RESULTS_WITHOUT_ENDING: ReadonlySet<ScheduledResultKind> = new Set(["pending", "admission-waiting", "running"]);

/**
 * The results the classifier can give each state
 * (`tools/overseer/occurrence-result.ts` § the ladder). Keyed by the state, so
 * a ninth state is a compile error here until somebody says what it may read
 * as.
 *
 * **`interrupted` on every state nobody has ended**: the protocol's `disposed`
 * event does not change a record's state, and a disposition outranks the four
 * rows that are not endings (occurrence-result.ts § A disposition outranks…).
 * `succeeded` comes only from `completed`. **`superseded` comes only from
 * `failed-before-launch`** (its `superseded` proof), and is an ending, so it
 * carries an instant like the others outside `RESULTS_WITHOUT_ENDING`.
 */
const RESULTS_OF_STATE: { readonly [S in ScheduledLaunchState]: ReadonlySet<ScheduledResultKind> } = {
  planned: new Set<ScheduledResultKind>(["pending", "interrupted"]),
  reserved: new Set<ScheduledResultKind>(["pending", "interrupted"]),
  "waiting-admission": new Set<ScheduledResultKind>(["admission-waiting", "interrupted"]),
  launching: new Set<ScheduledResultKind>(["running", "interrupted"]),
  "observed-running": new Set<ScheduledResultKind>(["running", "interrupted"]),
  "outcome-unknown": new Set<ScheduledResultKind>(["unknown", "interrupted"]),
  "failed-before-launch": new Set<ScheduledResultKind>(["launch-failed", "superseded"]),
  completed: new Set<ScheduledResultKind>(ENDINGS),
};

const ACCESS: { readonly [K in ScheduledRunSpec["access"]]: true } = { "read-only": true, review: true, write: true };

/**
 * A Claude pool account handle, restated from `launch-protocol.ts`'s
 * `ACCOUNT_HANDLE` (and `accounts.ts`'s `ACCOUNT_NAME`), because this leaf
 * imports nothing that reaches node. The page prints it, so it is checked.
 */
const ACCOUNT_HANDLE = /^[a-z0-9][a-z0-9-]{0,40}$/;

/**
 * Parse whatever `JSON.parse` gave back. Never throws.
 */
export function parseOccurrencesFile(json: unknown): OccurrencesParse {
  try {
    const top = object(json, "the occurrences file");
    const schema = top["schema"];
    if (typeof schema !== "number" || !Number.isSafeInteger(schema)) return { kind: "unreadable", why: "the occurrences file carries no schema number" };
    if (schema !== OCCURRENCES_SCHEMA) {
      return {
        kind: "unsupported-schema",
        saw: schema,
        known: OCCURRENCES_SCHEMA,
        why: `the occurrences file is schema ${schema}, and this build reads schema ${OCCURRENCES_SCHEMA}`,
      };
    }
    const rows = array(top, "jobs", "the occurrences file");
    if (rows.length > MAX_JOBS) fail(`the occurrences file lists ${rows.length} jobs, more than the ${MAX_JOBS} this build will read`);
    return {
      kind: "parsed",
      file: {
        schema: OCCURRENCES_SCHEMA,
        writtenAt: instant(top, "writtenAt", "the occurrences file"),
        instanceId: nonBlank(top, "instanceId", "the occurrences file"),
        journal: parseJournal(object(top["journal"], "the journal standing")),
        jobs: rows.map(parseJobRow),
      },
    };
  } catch (cause) {
    return { kind: "unreadable", why: reason(cause) };
  }
}

function parseJobRow(value: unknown): OccurrencesJobRow {
  try {
    return { kind: "job", job: parseJob(value) };
  } catch (cause) {
    const id = isObject(value) ? value["jobId"] : undefined;
    return { kind: "unreadable", jobId: typeof id === "string" && id.trim() !== "" && id.length <= MAX_TEXT ? id : null, why: reason(cause) };
  }
}

function parseJob(value: unknown): ParsedOccurrencesJob {
  const job = object(value, "a job row");
  const jobId = nonBlank(job, "jobId", "a job row");
  const where = `job ${jobId}`;
  const next = readSchedulePreviewNext(job["next"], where);
  if (next.kind === "unreadable") fail(next.why);
  const occurrences = array(job, "occurrences", where);
  if (occurrences.length > MAX_OCCURRENCES) fail(`${where} lists ${occurrences.length} occurrences, more than the ${MAX_OCCURRENCES} this build will read`);
  return {
    jobId,
    dispatch: parseDispatch(object(job["dispatch"], `${where}'s dispatch`), where),
    run: parseJobRun(object(job["run"], `${where}'s run spec`), where),
    next: next.next,
    occurrences: occurrences.map(parseOccurrenceRow),
    omitted: count(job, "omitted", where, Number.MAX_SAFE_INTEGER),
  };
}

function parseOccurrenceRow(value: unknown): OccurrenceRow {
  try {
    return { kind: "occurrence", occurrence: parseOccurrence(value) };
  } catch (cause) {
    const id = isObject(value) ? value["launchOccurrenceId"] : undefined;
    return { kind: "unreadable", launchOccurrenceId: typeof id === "string" && LAUNCH_OCCURRENCE_ID.test(id) ? id : null, why: reason(cause) };
  }
}

function parseOccurrence(value: unknown): ScheduledOccurrence {
  const occurrence = object(value, "an occurrence");
  const launchOccurrenceId = text(occurrence, "launchOccurrenceId", "an occurrence");
  if (!LAUNCH_OCCURRENCE_ID.test(launchOccurrenceId)) fail("an occurrence's launch id is not the protocol's lo- and twenty hex");
  const where = `occurrence ${launchOccurrenceId}`;
  /* THE STATE AND THE RESULT BEFORE THE FIELDS THEY SHARE, so an unknown one is
     named as one rather than as some missing field further down. */
  const stateWord = text(occurrence, "state", where);
  if (!Object.hasOwn(RESULTS_OF_STATE, stateWord)) fail(`${where} is in a state this build does not know (${stateWord})`);
  const state = stateWord as ScheduledLaunchState;
  const result = parseResult(object(occurrence["result"], `${where}'s result`), where);
  if (!RESULTS_OF_STATE[state].has(result.kind)) fail(`${where} is ${state} with result ${result.kind}, a combination the classifier never gives`);
  const attempts = count(occurrence, "attempts", where, MAX_ATTEMPTS);
  const answer = parseAnswer(object(occurrence["answer"], `${where}'s answer`), where);
  if (answer.kind === "present" && answer.attempt > attempts) fail(`${where}'s answer is from attempt ${answer.attempt}, but the occurrence records only ${attempts} attempts`);
  if (answer.kind === "present" && answer.usable && answer.bytes === 0) fail(`${where}'s zero-byte answer cannot be usable`);
  if (result.kind === "succeeded" && (answer.kind !== "present" || !answer.usable || answer.bytes === 0)) {
    fail(`${where} succeeded without the present, usable, non-empty answer the classifier requires`);
  }
  return {
    launchOccurrenceId,
    schedulerOccurrenceId: nonBlank(occurrence, "schedulerOccurrenceId", where),
    scheduledAt: instant(occurrence, "scheduledAt", where),
    behaviourHash: hex(occurrence, "behaviourHash", where),
    plannedAt: instant(occurrence, "plannedAt", where),
    updatedAt: instant(occurrence, "updatedAt", where),
    attempts,
    state,
    run: parseRun(object(occurrence["run"], `${where}'s run spec`), where),
    result,
    answer,
    transcriptPath: nullableText(occurrence, "transcriptPath", where),
    tmuxSession: nullableText(occurrence, "tmuxSession", where),
    commands: parseCommands(object(occurrence["commands"], `${where}'s commands`), where),
  };
}

function parseResult(value: Obj, where: string): ScheduledResult {
  const kind = text(value, "kind", where);
  if (!Object.hasOwn(RESULT_KINDS, kind)) fail(`${where} has a result this build does not know (${kind})`);
  const resultKind = kind as ScheduledResultKind;
  const at = value["at"];
  const withoutEnding = RESULTS_WITHOUT_ENDING.has(resultKind);
  if (withoutEnding && at !== null) fail(`${where}'s ${resultKind} result has an ending instant, but the classifier gives it none`);
  if (!withoutEnding && at === null) fail(`${where}'s ${resultKind} result has no instant for when its evidence was recorded`);
  return { kind: resultKind, why: text(value, "why", where), at: at === null ? null : instant(value, "at", `${where}'s result`) };
}

function parseAnswer(value: Obj, where: string): ScheduledAnswer {
  const kind = text(value, "kind", where);
  if (kind === "absent") return { kind };
  if (kind !== "present") fail(`${where} has an answer of a kind this build does not know (${kind})`);
  const attempt = count(value, "attempt", `${where}'s answer`, MAX_ATTEMPTS);
  if (attempt < 1) fail(`${where}'s answer names attempt 0, and attempts start at 1`);
  const usable = value["usable"];
  if (typeof usable !== "boolean") fail(`${where}'s answer does not say whether it is usable`);
  /* THE ANSWER ROUTE SERVES ONLY THESE BYTES, so an answer without them cannot be linked. */
  const sha256 = value["sha256"];
  if (typeof sha256 !== "string" || !SHA256.test(sha256)) fail(`${where}'s answer has no sha256 of the bytes it was judged on (64 lower-case hex)`);
  return { kind, attempt, bytes: count(value, "bytes", `${where}'s answer`, Number.MAX_SAFE_INTEGER), sha256, usable };
}

/** A job's run spec: its timeout and access, and no account — the job's authority names none. */
function parseJobRun(value: Obj, where: string): ScheduledJobRunSpec {
  const timeoutMinutes = count(value, "timeoutMinutes", `${where}'s run spec`, MAX_TIMEOUT_MINUTES);
  if (timeoutMinutes < 1) fail(`${where}'s run spec has no timeout`);
  const access = text(value, "access", where);
  if (!Object.hasOwn(ACCESS, access)) fail(`${where}'s run spec has an access this build does not know (${access})`);
  return { timeoutMinutes, access: access as ScheduledRunSpec["access"] };
}

/** An occurrence's run spec: the job's two fields, and the pool account it ran on — a handle, or null for a record that pinned no run spec. Required, never defaulted. */
function parseRun(value: Obj, where: string): ScheduledRunSpec {
  const job = parseJobRun(value, where);
  if (!Object.hasOwn(value, "account")) fail(`${where}'s run spec does not say which pool account it ran on`);
  const account = value["account"];
  if (account !== null && (typeof account !== "string" || !ACCOUNT_HANDLE.test(account))) {
    fail(`${where}'s run spec names an account that is not a pool account handle (lower-case letters, digits and dashes)`);
  }
  return { ...job, account };
}

function parseCommands(value: Obj, where: string): ScheduledOccurrence["commands"] {
  return { cancel: nullableText(value, "cancel", `${where}'s commands`), dispose: nullableText(value, "dispose", `${where}'s commands`) };
}

function parseDispatch(value: Obj, where: string): ScheduledOccurrencesJob["dispatch"] {
  const kind = text(value, "kind", where);
  if (kind === "live") return { kind };
  if (kind === "dry-run") return { kind, why: text(value, "why", where) };
  return fail(`${where} has a dispatch mode this build does not know (${kind})`);
}

function parseJournal(value: Obj): ScheduledJournalStanding {
  const kind = text(value, "kind", "the journal standing");
  if (kind === "whole") return { kind };
  if (kind === "history-lost" || kind === "not-open") return { kind, why: text(value, "why", "the journal standing") };
  return fail(`the launch journal's standing is of a kind this build does not know (${kind})`);
}

/* ------------------------------------------------------------------ *
 * The field readers — schedule-parse.ts's, restated, because they are
 * that file's own and throw that file's own exception.
 * ------------------------------------------------------------------ */

type Obj = Readonly<Record<string, unknown>>;

class Unreadable extends Error {}

function fail(why: string): never {
  throw new Unreadable(why);
}

function reason(cause: unknown): string {
  if (cause instanceof Unreadable) return cause.message;
  if (cause instanceof Error) return cause.message;
  return `the occurrences file could not be read (${String(cause)})`;
}

function isObject(value: unknown): value is Obj {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown, where: string): Obj {
  if (!isObject(value)) fail(`${where} is not an object`);
  return value;
}

function array(value: Obj, key: string, where: string): readonly unknown[] {
  const found = value[key];
  if (!Array.isArray(found)) fail(`${where} has no ${key} list`);
  return found;
}

function text(value: Obj, key: string, where: string): string {
  const found = value[key];
  if (typeof found !== "string") fail(`${where} has no ${key}`);
  if (found.length > MAX_TEXT) fail(`${where}'s ${key} is longer than this build will read`);
  return found;
}

function nullableText(value: Obj, key: string, where: string): string | null {
  return value[key] === null ? null : text(value, key, where);
}

function nonBlank(value: Obj, key: string, where: string): string {
  const found = text(value, key, where);
  if (found.trim() === "") fail(`${where}'s ${key} is blank`);
  return found;
}

function hex(value: Obj, key: string, where: string): string {
  const found = text(value, key, where);
  if (!HEX.test(found)) fail(`${where}'s ${key} is not a hex digest`);
  return found;
}

/** An instant as `toISOString()` writes it, and inside `Date`'s range. */
function instant(value: Obj, key: string, where: string): string {
  const found = value[key];
  if (typeof found !== "string") fail(`${where}'s ${key} is not an ISO instant`);
  const ms = Date.parse(found);
  if (!Number.isFinite(ms) || Math.abs(ms) > INSTANT_RANGE_MS) fail(`${where}'s ${key} (${found}) is not an instant this build can show`);
  if (new Date(ms).toISOString() !== found) fail(`${where}'s ${key} is not the canonical ISO instant this build writes`);
  return found;
}

/** A whole number from zero to `max`. */
function count(value: Obj, key: string, where: string, max: number): number {
  const found = value[key];
  if (typeof found !== "number" || !Number.isSafeInteger(found) || found < 0 || found > max) fail(`${where}'s ${key} is not a count this build will show`);
  return found;
}
