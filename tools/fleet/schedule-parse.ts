/**
 * **THE ONE PARSER OF `schedule.json`** — plan 260910e § D7.
 *
 * The daemon writes `~/.overseer/schedule.json` on every checkpoint tick
 * (`tools/overseer/schedule-preview.ts`), and three things read it: `overseer
 * status`, the fleet route, and the browser. They read it through this, so what
 * one surface refuses every surface refuses, and a field one of them trusts
 * cannot be a field another drops.
 *
 * **A LEAF WITH NO NODE IMPORTS**, for the reason `zones.ts` gives: the browser
 * bundle may import a leaf under `tools/fleet/`, and nothing reachable from here
 * may pull `node:` anything into it. The only import is type-only, from
 * `wire.ts`, which is itself import-free.
 *
 * ## It never throws, and what it does not know is stated per row
 *
 * - **A verdict, next-run or attempt kind this build does not know** makes that
 *   ROW its own `unreadable` arm, carrying the kind it met. Never the whole file
 *   — a newer daemon adding one verdict must not make an older reader drop every
 *   job — and never a different kind, which would draw a state as one it is not.
 * - **A top-level field it cannot read** makes the file `unreadable`: the
 *   headline, the arming or the list are what every row is read against, and a
 *   row without them would say more than anybody knows.
 * - **A schema it does not read** is `unsupported-schema`, its own answer,
 *   because "the daemon is a different build" and "the file is damaged" lead to
 *   different actions.
 *
 * ## Instants are range-checked, not just finiteness-checked
 *
 * docs/project/fleet-dashboard-modes.md § Absence is stated: `1e300` is finite,
 * and `new Date(1e300).toISOString()` throws `RangeError` — thrown during render
 * it blanks a whole panel. So an instant here must be the string
 * `toISOString()` produces, and its milliseconds must sit inside ±8.64e15; a
 * duration must be a safe, non-negative integer under a decade.
 */
import type {
  ParsedSchedulePreview,
  SchedulePreviewAttempt,
  SchedulePreviewDocument,
  SchedulePreviewJob,
  SchedulePreviewNext,
  SchedulePreviewParse,
  SchedulePreviewRow,
  SchedulePreviewVerdict,
  SchedulePreviewVerdictKind,
} from "./wire.js";

/** The schema this build writes and reads. The writer stamps it; a file with any other number is `unsupported-schema`. */
export const SCHEDULE_PREVIEW_SCHEMA = 1;

/** More rows than any job list this box will carry, and few enough that a damaged file cannot make a reader build a huge table. */
const MAX_JOBS = 500;
/** A sentence, a prompt or a path. Long enough for every one the daemon writes; short enough to bound a hostile or damaged file. */
const MAX_TEXT = 20_000;
/** A decade. The schedules' own ceilings are days (`schedules.ts`); this only refuses nonsense. */
const MAX_DURATION_MS = 3_650 * 86_400_000;
/** `Date`'s own range, in milliseconds either side of the epoch. */
const INSTANT_RANGE_MS = 8.64e15;
/** Behaviour hashes, list revisions and document digests: lower-case hex, 8 to 64 characters. */
const HEX = /^[0-9a-f]{8,64}$/;

/**
 * Every verdict kind this build knows, with the compiler counting: a kind added
 * to `SchedulePreviewVerdictKind` is a compile error here until somebody says
 * this parser reads it.
 */
const VERDICT_KINDS: { readonly [K in SchedulePreviewVerdictKind]: true } = {
  "history-lost": true,
  "duplicate-id": true,
  unauthorised: true,
  held: true,
  waiting: true,
  "not-yet-eligible": true,
  "dry-run": true,
  "spacing-held": true,
  dispatch: true,
};

/** The next-run arm each planner verdict can actually produce. A known word in an impossible pairing is still an unknown row. */
const VERDICT_NEXT_KINDS: Readonly<Record<SchedulePreviewVerdictKind, ReadonlySet<SchedulePreviewNext["kind"]>>> = {
  "history-lost": new Set(["none"]),
  "duplicate-id": new Set(["none"]),
  unauthorised: new Set(["none"]),
  held: new Set(["after-in-flight-settles", "after-arming", "none"]),
  waiting: new Set(["next-due"]),
  "not-yet-eligible": new Set(["first-eligible"]),
  "dry-run": new Set(["due-now"]),
  "spacing-held": new Set(["next-due"]),
  dispatch: new Set(["due-now"]),
};

/**
 * Parse whatever `JSON.parse` gave back. Never throws.
 *
 * `json` is `unknown` on purpose: the caller has read bytes off a disk or a
 * wire, and this is the one place they become a type.
 */
export function parseSchedulePreview(json: unknown): SchedulePreviewParse {
  try {
    const top = object(json, "the schedule preview");
    const schema = top["schema"];
    if (typeof schema !== "number" || !Number.isSafeInteger(schema)) return { kind: "unreadable", why: "the schedule preview carries no schema number" };
    if (schema !== SCHEDULE_PREVIEW_SCHEMA) return { kind: "unsupported-schema", schema };
    const rows = array(top, "jobs", "the schedule preview");
    if (rows.length > MAX_JOBS) fail(`the schedule preview lists ${rows.length} jobs, more than the ${MAX_JOBS} this build will read`);
    const preview: ParsedSchedulePreview = {
      schema: SCHEDULE_PREVIEW_SCHEMA,
      writtenAt: instant(top, "writtenAt", "the schedule preview"),
      instanceId: nonBlank(top, "instanceId", "the schedule preview"),
      list: parseList(object(top["list"], "list")),
      capabilities: parseCapabilities(object(top["capabilities"], "capabilities")),
      arming: parseArming(object(top["arming"], "arming")),
      history: parseHistory(object(top["history"], "history")),
      headline: parseHeadline(object(top["headline"], "headline")),
      missedRunPolicy: parseMissedRunPolicy(object(top["missedRunPolicy"], "missedRunPolicy")),
      caveat: text(top, "caveat", "the schedule preview"),
      jobs: rows.map(parseRow),
    };
    return { kind: "preview", preview };
  } catch (cause) {
    return { kind: "unreadable", why: reason(cause) };
  }
}

/** One row: the job, or that row's own `unreadable` — with its id when it had a readable one, so a reader can say WHICH job it could not read. */
function parseRow(value: unknown): SchedulePreviewRow {
  try {
    return { kind: "job", job: parseJob(value) };
  } catch (cause) {
    const id = value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)["jobId"] : undefined;
    return { kind: "unreadable", jobId: typeof id === "string" && id.trim() !== "" && id.length <= MAX_TEXT ? id : null, why: reason(cause) };
  }
}

function parseJob(value: unknown): SchedulePreviewJob {
  const job = object(value, "a job row");
  const jobId = nonBlank(job, "jobId", "a job row");
  const where = `job ${jobId}`;
  const resourceClass = text(job, "resourceClass", where);
  if (resourceClass !== "claude-session" && resourceClass !== "in-process-rule") fail(`${where} has a resource class this build does not know (${resourceClass})`);
  const schedule = object(job["schedule"], `${where}'s schedule`);
  const sessionTimeout = job["sessionTimeout"];
  const sessionNoOverlap = job["sessionNoOverlap"];
  if (sessionTimeout !== "not built") fail(`${where} says its session timeout is ${JSON.stringify(sessionTimeout)}, which this build does not know how to show`);
  if (sessionNoOverlap !== "not enforced") fail(`${where} says its session no-overlap is ${JSON.stringify(sessionNoOverlap)}, which this build does not know how to show`);
  return {
    jobId,
    resourceClass,
    dispatch: parseDispatch(object(job["dispatch"], `${where}'s dispatch`), where),
    verdict: parseVerdict(object(job["verdict"], `${where}'s verdict`), where),
    lastAttempt: parseAttempt(object(job["lastAttempt"], `${where}'s last attempt`), where),
    schedule: {
      everyMs: duration(schedule, "everyMs", where),
      launcherLeaseMs: duration(schedule, "launcherLeaseMs", where),
      initialDelayMs: duration(schedule, "initialDelayMs", where),
    },
    sessionTimeout,
    sessionNoOverlap,
    prompt: text(job, "prompt", where),
    behaviourHash: parseHash(object(job["behaviourHash"], `${where}'s behaviour hash`), where),
    authorisedHash: hex(job, "authorisedHash", where),
    documents: array(job, "documents", where).map((document) => parseDocument(object(document, `a document of ${where}`), where)),
  };
}

function parseDispatch(value: Obj, where: string): SchedulePreviewJob["dispatch"] {
  const kind = text(value, "kind", where);
  if (kind === "live") return { kind };
  if (kind === "dry-run") return { kind, why: text(value, "why", where) };
  return fail(`${where} has a dispatch mode this build does not know (${kind})`);
}

function parseVerdict(value: Obj, where: string): SchedulePreviewVerdict {
  const kind = text(value, "kind", where);
  if (!Object.hasOwn(VERDICT_KINDS, kind)) fail(`${where} has a verdict this build does not know (${kind})`);
  const known = kind as SchedulePreviewVerdictKind;
  const sentence = text(value, "sentence", where);
  const next = parseNext(object(value["next"], `${where}'s next run`), where);
  if (!VERDICT_NEXT_KINDS[known].has(next.kind)) fail(`${where} has verdict ${known} with next run ${next.kind}, a combination this build does not know`);
  if (known === "unauthorised") {
    const drift = array(value, "drift", where).map((line) => {
      if (typeof line !== "string" || line.length > MAX_TEXT) fail(`${where} has a drift entry that is not a sentence`);
      return line;
    });
    return { kind: known, sentence, drift, next };
  }
  return { kind: known, sentence, next };
}

function parseNext(value: Obj, where: string): SchedulePreviewNext {
  const kind = text(value, "kind", where);
  switch (kind) {
    case "due-now":
      return { kind };
    case "next-due":
    case "first-eligible":
      return { kind, at: instant(value, "at", where) };
    case "after-in-flight-settles":
      return { kind, leaseUntil: instant(value, "leaseUntil", where) };
    case "after-arming":
      return { kind, initialDelayMs: duration(value, "initialDelayMs", where) };
    case "none":
      return { kind, why: text(value, "why", where) };
    default:
      return fail(`${where} has a next-run kind this build does not know (${kind})`);
  }
}

/** The states an occurrence arm can carry. Checked BEFORE the fields they share, so an unknown state is named as one rather than as a missing `reservedAt`. */
const OCCURRENCE_STATES: ReadonlySet<string> = new Set(["reserved", "started", "finished", "refused", "unknown"]);

function parseAttempt(value: Obj, where: string): SchedulePreviewAttempt {
  const kind = text(value, "kind", where);
  if (kind === "never") return { kind };
  if (kind === "not-known") return { kind, why: text(value, "why", where) };
  if (!OCCURRENCE_STATES.has(kind)) fail(`${where} has a last-attempt state this build does not know (${kind})`);
  const occurrenceId = nonBlank(value, "occurrenceId", where);
  const reservedAt = instant(value, "reservedAt", where);
  switch (kind) {
    case "reserved":
      return { kind, occurrenceId, reservedAt, leaseUntil: instant(value, "leaseUntil", where), meaning: text(value, "meaning", where) };
    case "started":
      return {
        kind,
        occurrenceId,
        reservedAt,
        startedAt: instant(value, "startedAt", where),
        leaseUntil: instant(value, "leaseUntil", where),
        pid: integer(value, "pid", where),
        meaning: text(value, "meaning", where),
      };
    case "finished":
      return {
        kind,
        occurrenceId,
        reservedAt,
        finishedAt: instant(value, "finishedAt", where),
        outcome: parseOutcome(object(value["outcome"], `${where}'s outcome`), where),
        meaning: text(value, "meaning", where),
      };
    case "refused":
      return { kind, occurrenceId, reservedAt, refusedAt: instant(value, "refusedAt", where), why: text(value, "why", where), meaning: text(value, "meaning", where) };
    case "unknown":
      return {
        kind,
        occurrenceId,
        reservedAt,
        why: text(value, "why", where),
        noticed: parseNoticed(object(value["noticed"], `${where}'s unknown occurrence`), where),
        meaning: text(value, "meaning", where),
      };
    default:
      return fail(`${where} has a last-attempt state this build does not know (${kind})`);
  }
}

function parseOutcome(value: Obj, where: string): { kind: "exited"; code: number } | { kind: "failed"; why: string } {
  const kind = text(value, "kind", where);
  if (kind === "exited") return { kind, code: integer(value, "code", where) };
  if (kind === "failed") return { kind, why: text(value, "why", where) };
  return fail(`${where} has an outcome this build does not know (${kind})`);
}

function parseNoticed(value: Obj, where: string): { kind: "derived" } | { kind: "recorded"; at: string } {
  const kind = text(value, "kind", where);
  if (kind === "derived") return { kind };
  if (kind === "recorded") return { kind, at: instant(value, "at", where) };
  return fail(`${where} says its unknown occurrence was noticed in a way this build does not know (${kind})`);
}

function parseHash(value: Obj, where: string): SchedulePreviewJob["behaviourHash"] {
  const kind = text(value, "kind", where);
  if (kind === "computed") return { kind, hash: hex(value, "hash", where) };
  if (kind === "not-computed") return { kind, why: text(value, "why", where) };
  return fail(`${where} has a behaviour hash of a kind this build does not know (${kind})`);
}

function parseDocument(value: Obj, where: string): SchedulePreviewDocument {
  const path = nonBlank(value, "path", where);
  const pinned = object(value["pinned"], `${where}'s pin for ${path}`);
  const current = object(value["current"], `${where}'s reading of ${path}`);
  const changed = value["changed"];
  if (changed !== "yes" && changed !== "no" && changed !== "cannot-tell") fail(`${where} says ${path} changed ${JSON.stringify(changed)}, which this build does not know`);
  const pinnedKind = text(pinned, "kind", where);
  const currentKind = text(current, "kind", where);
  const parsedPinned: SchedulePreviewDocument["pinned"] =
    pinnedKind === "pinned"
      ? { kind: pinnedKind, sha256: hex(pinned, "sha256", where) }
      : pinnedKind === "not-pinned"
        ? { kind: pinnedKind }
        : fail(`${where} has a pin of a kind this build does not know (${pinnedKind})`);
  const parsedCurrent: SchedulePreviewDocument["current"] =
    currentKind === "read"
      ? { kind: currentKind, sha256: hex(current, "sha256", where), when: readingWhen(current, where) }
      : currentKind === "unreadable"
        ? { kind: currentKind, why: text(current, "why", where) }
        : currentKind === "absent"
          ? { kind: currentKind }
          : fail(`${where} has a document reading of a kind this build does not know (${currentKind})`);
  if (parsedPinned.kind === "not-pinned" && parsedCurrent.kind === "absent") {
    fail(`${where} says ${path} is neither pinned nor current, a document row this build does not know`);
  }
  const expectedChanged: SchedulePreviewDocument["changed"] =
    parsedCurrent.kind === "unreadable"
      ? "cannot-tell"
      : parsedCurrent.kind === "absent" || parsedPinned.kind === "not-pinned" || parsedPinned.sha256 !== parsedCurrent.sha256
        ? "yes"
        : "no";
  if (changed !== expectedChanged) fail(`${where} says ${path} changed ${changed}, but its pin and current reading say ${expectedChanged}`);
  return { path, pinned: parsedPinned, current: parsedCurrent, changed };
}

function readingWhen(value: Obj, where: string): "this-checkpoint" | "when-loaded" {
  const when = value["when"];
  if (when === "this-checkpoint" || when === "when-loaded") return when;
  return fail(`${where} says a document was read at ${JSON.stringify(when)}, which this build does not know`);
}

function parseList(value: Obj): ParsedSchedulePreview["list"] {
  const kind = text(value, "kind", "list");
  if (kind === "given") return { kind, listRevision: hex(value, "listRevision", "list") };
  if (kind === "not-given") return { kind, why: text(value, "why", "list") };
  return fail(`the list is of a kind this build does not know (${kind})`);
}

function parseCapabilities(value: Obj): ParsedSchedulePreview["capabilities"] {
  const session = value["session"];
  const rules = value["rules"];
  if (typeof session !== "boolean" || typeof rules !== "boolean") fail("the capabilities are not two yes/no answers");
  return { session, rules };
}

function parseArming(value: Obj): ParsedSchedulePreview["arming"] {
  const kind = text(value, "kind", "arming");
  if (kind === "armed") return { kind, at: instant(value, "at", "arming") };
  if (kind === "none") return { kind, why: text(value, "why", "arming") };
  return fail(`the arming is of a kind this build does not know (${kind})`);
}

function parseHistory(value: Obj): ParsedSchedulePreview["history"] {
  const kind = text(value, "kind", "history");
  if (kind === "intact") return { kind };
  if (kind === "lost") return { kind, why: text(value, "why", "history") };
  return fail(`the ledger's history is of a kind this build does not know (${kind})`);
}

function parseHeadline(value: Obj): ParsedSchedulePreview["headline"] {
  const kind = text(value, "kind", "headline");
  if (kind !== "armed" && kind !== "blocked" && kind !== "off" && kind !== "unknown") fail(`the scheduler headline is of a kind this build does not know (${kind})`);
  return { kind, why: text(value, "why", "headline"), at: instant(value, "at", "headline") };
}

function parseMissedRunPolicy(value: Obj): ParsedSchedulePreview["missedRunPolicy"] {
  const kind = text(value, "kind", "missedRunPolicy");
  if (kind !== "one-run") fail(`the missed-run policy is one this build does not know (${kind})`);
  return { kind, sentence: text(value, "sentence", "missedRunPolicy") };
}

/* ------------------------------------------------------------------ *
 * The field readers. Each one either returns the value or throws
 * `Unreadable` with a sentence; `parseRow` and `parseSchedulePreview`
 * are the two places that catch, so nothing escapes this file.
 * ------------------------------------------------------------------ */

type Obj = Readonly<Record<string, unknown>>;

/** The one exception this file throws, and only to itself. */
class Unreadable extends Error {}

function fail(why: string): never {
  throw new Unreadable(why);
}

/** The sentence for whatever was caught — ours, or anything else, which is still a reason rather than a crash. */
function reason(cause: unknown): string {
  if (cause instanceof Unreadable) return cause.message;
  return `the schedule preview could not be read (${cause instanceof Error ? cause.message : String(cause)})`;
}

function object(value: unknown, where: string): Obj {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${where} is not an object`);
  return value as Obj;
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

/** An instant as `toISOString()` writes it, and inside `Date`'s range — see the header for why both. */
function instant(value: Obj, key: string, where: string): string {
  const found = value[key];
  if (typeof found !== "string") fail(`${where}'s ${key} is not an ISO instant`);
  const ms = Date.parse(found);
  if (!Number.isFinite(ms) || Math.abs(ms) > INSTANT_RANGE_MS) fail(`${where}'s ${key} (${found}) is not an instant this build can show`);
  if (new Date(ms).toISOString() !== found) fail(`${where}'s ${key} is not the canonical ISO instant this build writes`);
  return found;
}

function duration(value: Obj, key: string, where: string): number {
  const found = value[key];
  if (typeof found !== "number" || !Number.isSafeInteger(found) || found < 0 || found > MAX_DURATION_MS) {
    fail(`${where}'s ${key} is not a number of milliseconds this build will show`);
  }
  return found;
}

function integer(value: Obj, key: string, where: string): number {
  const found = value[key];
  if (typeof found !== "number" || !Number.isSafeInteger(found)) fail(`${where}'s ${key} is not a whole number`);
  return found;
}
