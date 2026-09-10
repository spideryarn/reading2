/**
 * **WORK REPORTS — what an agent CLAIMED, recorded by the daemon and nobody
 * else.** Plan [260910e](../../docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md),
 * Stage 1.
 *
 * Greg wants to see what an agent said — progress, blocked, a decision,
 * completed — with links to the real artefacts, without a model reading every
 * transcript and without a report ever granting anything. **Every report is a
 * claim, and nothing here turns one into a state**: no READY/LANDED machine, no
 * permission, no queue transition. A `completed` report's revision lists are
 * what the agent said, and an empty one is "not stated", never "not reviewed".
 *
 * ## Clients submit; the daemon writes
 *
 * `report-inbox/<eventId>.json` is a file drop, written temp-then-rename by
 * `submitReport`. `drainReports` — called only by a daemon holding
 * `overseer.lock` — is the one writer of `reports.jsonl`. That is what lets it
 * stamp `receivedAt` and compare the submitter's execution token with the
 * register it holds. **There is no `reports.lock`**: a second daemon never gets
 * past the store's own lock, and the drain is synchronous, so two passes cannot
 * overlap and a shutdown cannot interrupt one mid-step.
 *
 * ## The four steps, and why the first one is frozen
 *
 *     [1] prepare once: parse, check artefacts, compare the token, stamp
 *         receivedAt  ⇒  report-processing/<id>.json, written atomically
 *     [2] (stage 3) a session's decision into decisions.jsonl
 *     [3] append the prepared line to reports.jsonl, fsync
 *     [4] unlink the processing file, then the inbox file
 *
 * A processing file found at the start of a pass is replayed from [2] with its
 * frozen bytes; nothing is re-derived. Re-deriving on retry would turn a crash
 * between two appends into a command-id conflict, because the register, the
 * clock and the checkout all move in between — GPT Sol's WR-P3.
 *
 * ## Refused and pending are different words
 *
 * Invalid input — a shape, an unknown kind, oversize, a name that is not its
 * event id, a conflicting duplicate — is REFUSED: one `report-refused/<id>.json`
 * holding the reason and the original, and the inbox file is removed. A failure
 * that says nothing about the input — a checker that threw, a filesystem error —
 * leaves the item PENDING for the next pass. A checker that could not run is not
 * a failure at all: that artefact is recorded `unchecked`, with why.
 *
 * ## The limit, stated
 *
 * Nothing on this filesystem defends against a hostile process running as the
 * same Unix user; it could write `reports.jsonl` directly. `actor` is a
 * self-declaration, as `by` is in the decision record. What the drain does
 * defend is the daemon: an inbox entry is never followed through a symlink,
 * never read past 16 KiB, and never opened if it is not a regular file.
 */
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";

import {
  MAX_ARTEFACTS,
  QUEUE_ID_RULE,
  DECISION_ID_RULE,
  parseArtefactRef,
  parseCheckedArtefacts,
  pathProblem,
  untrustedTextProblem,
  type ArtefactCheck,
  type ArtefactRef,
  type CheckedArtefact,
} from "../fleet/artefact-ref.js";
import { isExecutionTokenText } from "../fleet/execution-token.js";
import { splitJsonl, truncateToLastLine, writeAll, writeAtomically } from "./jsonl.js";
import type { SessionRegister } from "./store.js";

export const REPORTS_SCHEMA = 1;
export const REPORTS_FILE = "reports.jsonl";
/**
 * Proof outside the replaceable log that reports have been recorded. Once it
 * exists, an absent or empty `reports.jsonl` is LOST, not new — the same rule as
 * `decisions.created`, for the same reason: this is original input an agent
 * cannot re-send, not a disposable derivation like `events.jsonl`.
 */
export const REPORTS_INIT_FILE = "reports.created";
/* Three sibling directories rather than three under one, because the inbox is
   the only one a client writes and the drain skips-and-counts anything in it
   that is not `<uuid>.json` — a subdirectory there would be counted every pass. */
export const INBOX_DIR = "report-inbox";
export const PROCESSING_DIR = "report-processing";
export const REFUSED_DIR = "report-refused";

export const MAX_SUBMISSION_BYTES = 16 * 1024;
export const MAX_SUMMARY_CHARS = 1000;
export const MAX_NEEDS_CHARS = 500;
export const MAX_REVISIONS = 20;
export const MAX_WHY_CHARS = 300;
export const REFUSED_KEPT = 200;
/** A `.tmp-*` older than this was left by a submitter that died between open and rename. */
export const TMP_DEBRIS_AGE_MS = 60 * 60 * 1000;
export const DECISION_NOT_WIRED = "decision reports are wired in stage 3";

/** Lower-case only: one spelling per id, because ids are compared as strings. */
const UUID_RULE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INBOX_NAME_RULE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;
const SESSION_NAME_RULE = /^[A-Za-z0-9._-]{1,64}$/;
const JOB_ID_RULE = /^[a-z0-9-]{1,41}$/;
const SHA_RULE = /^[0-9a-f]{7,40}$/;

export type ReportKind = "progress" | "blocked" | "decision" | "completed";
export const REPORT_KINDS: readonly ReportKind[] = ["progress", "blocked", "decision", "completed"];

/** A self-declaration, as the decision record's `by` is. The token comparison is the evidence. */
export type ReportActor =
  | { readonly kind: "session"; readonly name: string }
  | { readonly kind: "overseer" }
  | { readonly kind: "greg" };

export type BlockedOn = "greg" | "peer" | "review" | "environment" | "other";
export const BLOCKED_ON: readonly BlockedOn[] = ["greg", "peer", "review", "environment", "other"];
export type CompletedEnding = "finished" | "done-enough" | "important-work-left";
export const COMPLETED_ENDINGS: readonly CompletedEnding[] = ["finished", "done-enough", "important-work-left"];

export type Revisions = {
  readonly reviewed: readonly string[];
  readonly tested: readonly string[];
  readonly merged: readonly string[];
};

export type ReportJob = {
  readonly plan: string | null;
  readonly queueItem: string | null;
  readonly occurrence: { readonly jobId: string; readonly scheduledAt: string } | null;
};

/**
 * The schema-2 decision fields, minus author — **opaque in this stage**. Stage 2
 * defines them and Stage 3 validates them here; until then a decision
 * submission is parsed only far enough to be refused with `DECISION_NOT_WIRED`.
 */
export type DecisionDraft = { readonly [field: string]: unknown };

type ReportCommon = {
  readonly schema: typeof REPORTS_SCHEMA;
  readonly eventId: string;
  readonly submittedAt: string;
  readonly actor: ReportActor;
  /** The token the submitter read for its own Claude process, or null when it could not. */
  readonly observedExecution: string | null;
  readonly job: ReportJob;
  readonly summary: string;
  readonly corrects: string | null;
};

/** The three kinds whose body is the same in a submission and in a recorded event. */
export type ReportClaim =
  | { readonly kind: "progress" }
  | { readonly kind: "blocked"; readonly on: BlockedOn; readonly needs: string }
  | { readonly kind: "completed"; readonly ending: CompletedEnding; readonly revisions: Revisions };

/** What a client may say. Nothing here is what the daemon stamps. */
export type ReportSubmission = ReportCommon & { readonly artefacts: readonly ArtefactRef[] } & (
    | ReportClaim
    | { readonly kind: "decision"; readonly draft: DecisionDraft }
  );

/**
 * How the submitter's token compared with the register's verified run for the
 * named session — **null unless the actor is a session**. Absence of a token is
 * never "current"; it is `unverifiable` with the reason. GPT Sol's WR-P4.
 */
export type ExecutionComparison = "same-verified-run" | "different-verified-run" | { readonly unverifiable: string } | null;

/** What the daemon recorded: the submission, plus what it stamped once in step [1]. */
export type ReportEvent = ReportCommon & {
  readonly receivedAt: string;
  readonly execution: ExecutionComparison;
  readonly artefacts: readonly CheckedArtefact[];
} & (ReportClaim | { readonly kind: "decision"; readonly decisionId: string });

/* ------------------------------------------------------------------ *
 * Parsing. One parser for the CLI and the drain; nothing is defaulted, and an
 * unknown field is refused rather than ignored, because this is untrusted input.
 * ------------------------------------------------------------------ */

export type ParsedSubmission = { ok: true; submission: ReportSubmission } | { ok: false; why: string };
export type ParsedEvent = { ok: true; event: ReportEvent } | { ok: false; why: string };

/** Thrown inside the parsers only, and always caught at their edge: it is how a deep field names itself. */
class Refusal extends Error {}

function refuse(field: string, why: string): never {
  throw new Refusal(`${field}: ${why}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A value named in a refusal, without echoing anything a terminal would act on.
 * The refusal text is itself printed by `overseer reports`.
 */
function describeValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length <= 40 && untrustedTextProblem(value, 40) === null ? JSON.stringify(value) : "a string";
  }
  return value === null ? "null" : Array.isArray(value) ? "a list" : typeof value;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) refuse(`${where}${key}`, "is missing — nothing in a report is defaulted");
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) refuse(`${where}${describeValue(key)}`, "is not a field a report has");
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) refuse(field, `is ${describeValue(value)}, not an object`);
  return value;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") refuse(field, `is ${describeValue(value)}, not text`);
  if (value.trim() === "") refuse(field, "is blank");
  const problem = untrustedTextProblem(value, max);
  if (problem !== null) refuse(field, problem);
  return value;
}

/** An instant as `Date.toISOString()` writes it, checked by round trip — the only spelling this log holds. */
function instant(value: unknown, field: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    refuse(field, "is not an ISO instant as toISOString() writes it");
  }
  return value;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_RULE.test(value)) refuse(field, "is not a lower-case uuid");
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    refuse(field, `is ${describeValue(value)}, not one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function parseActor(value: unknown): ReportActor {
  const actor = record(value, "actor");
  switch (actor["kind"]) {
    case "session": {
      exactKeys(actor, ["kind", "name"], "actor.");
      const name = actor["name"];
      if (typeof name !== "string" || !SESSION_NAME_RULE.test(name)) {
        refuse("actor.name", "is not a session name: 1 to 64 letters, digits and . _ -");
      }
      return { kind: "session", name };
    }
    case "overseer":
    case "greg":
      exactKeys(actor, ["kind"], "actor.");
      return { kind: actor["kind"] };
    default:
      return refuse("actor.kind", `is ${describeValue(actor["kind"])}, not session, overseer or greg`);
  }
}

function parseJob(value: unknown): ReportJob {
  const job = record(value, "job");
  exactKeys(job, ["plan", "queueItem", "occurrence"], "job.");
  const plan = job["plan"];
  if (plan !== null) {
    if (typeof plan !== "string") refuse("job.plan", `is ${describeValue(plan)}, not a path or null`);
    const problem = pathProblem(plan);
    if (problem !== null) refuse("job.plan", problem);
  }
  const queueItem = job["queueItem"];
  if (queueItem !== null && (typeof queueItem !== "string" || !QUEUE_ID_RULE.test(queueItem))) {
    refuse("job.queueItem", "is not a queue item id like qi-a3k9mq2p, or null");
  }
  const rawOccurrence = job["occurrence"];
  let occurrence: ReportJob["occurrence"] = null;
  if (rawOccurrence !== null) {
    const o = record(rawOccurrence, "job.occurrence");
    exactKeys(o, ["jobId", "scheduledAt"], "job.occurrence.");
    const jobId = o["jobId"];
    if (typeof jobId !== "string" || !JOB_ID_RULE.test(jobId)) refuse("job.occurrence.jobId", "is not a job id");
    occurrence = { jobId, scheduledAt: instant(o["scheduledAt"], "job.occurrence.scheduledAt") };
  }
  return { plan: plan as string | null, queueItem: queueItem as string | null, occurrence };
}

function parseRevisions(value: unknown): Revisions {
  const revisions = record(value, "revisions");
  exactKeys(revisions, ["reviewed", "tested", "merged"], "revisions.");
  const list = (key: "reviewed" | "tested" | "merged"): string[] => {
    const raw = revisions[key];
    if (!Array.isArray(raw)) refuse(`revisions.${key}`, "is not a list");
    if (raw.length > MAX_REVISIONS) refuse(`revisions.${key}`, `has more than ${MAX_REVISIONS} entries`);
    return raw.map((entry, index) => {
      const field = `revisions.${key}[${index}]`;
      if (typeof entry !== "string") refuse(field, `is ${describeValue(entry)}, not a sha`);
      // The text check first, so a control character is named as one rather than as "not hex".
      const problem = untrustedTextProblem(entry, 40);
      if (problem !== null) refuse(field, problem);
      if (!SHA_RULE.test(entry)) refuse(field, "is not a 7 to 40 character lower-case hex sha");
      return entry;
    });
  };
  return { reviewed: list("reviewed"), tested: list("tested"), merged: list("merged") };
}

function parseSubmittedRefs(value: unknown): ArtefactRef[] {
  if (!Array.isArray(value)) refuse("artefacts", "is not a list");
  if (value.length > MAX_ARTEFACTS) refuse("artefacts", `has more than ${MAX_ARTEFACTS} entries`);
  return value.map((candidate, index) => {
    const ref = parseArtefactRef(candidate);
    if (ref !== null) return ref;
    // Say WHY for a path, which is the one whose rule a person can get wrong.
    if (isRecord(candidate) && candidate["kind"] === "path" && typeof candidate["path"] === "string") {
      refuse(`artefacts[${index}]`, pathProblem(candidate["path"]) ?? "is not a path reference");
    }
    return refuse(`artefacts[${index}]`, "is not a commit, path, decision or queue-item reference");
  });
}

function parseExecutionComparison(value: unknown, actor: ReportActor): ExecutionComparison {
  if (actor.kind !== "session") {
    if (value !== null) refuse("execution", "must be null unless the actor is a session");
    return null;
  }
  if (value === "same-verified-run" || value === "different-verified-run") return value;
  const unverifiable = record(value, "execution");
  exactKeys(unverifiable, ["unverifiable"], "execution.");
  return { unverifiable: text(unverifiable["unverifiable"], "execution.unverifiable", MAX_WHY_CHARS) };
}

const COMMON_KEYS = ["schema", "eventId", "submittedAt", "kind", "actor", "observedExecution", "job", "summary", "artefacts", "corrects"];
const BODY_KEYS: Record<ReportKind, readonly string[]> = {
  progress: [],
  blocked: ["on", "needs"],
  completed: ["ending", "revisions"],
  decision: [],
};

function parseJsonObject(line: string): Record<string, unknown> {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return refuse("report", "is not JSON");
  }
  return record(json, "report");
}

function parseCommon(json: Record<string, unknown>, extraKeys: readonly string[]): ReportCommon & { kind: ReportKind } {
  if (json["schema"] !== REPORTS_SCHEMA) refuse("schema", `is ${describeValue(json["schema"])}, not ${REPORTS_SCHEMA}`);
  // The kind before the keys, so `ready` is refused as a kind rather than as a missing `on`.
  const kind = oneOf(json["kind"], REPORT_KINDS, "kind");
  exactKeys(json, [...COMMON_KEYS, ...BODY_KEYS[kind], ...extraKeys], "");
  const eventId = uuid(json["eventId"], "eventId");
  const submittedAt = instant(json["submittedAt"], "submittedAt");
  const actor = parseActor(json["actor"]);
  const observed = json["observedExecution"];
  if (observed !== null && !isExecutionTokenText(observed)) {
    refuse("observedExecution", "is not an execution token (boot:pid:startTicks), or null");
  }
  const job = parseJob(json["job"]);
  const summary = text(json["summary"], "summary", MAX_SUMMARY_CHARS);
  const corrects = json["corrects"] === null ? null : uuid(json["corrects"], "corrects");
  if (corrects === eventId) refuse("corrects", "names this report itself; a correction must name an earlier one");
  return { schema: REPORTS_SCHEMA, eventId, submittedAt, kind, actor, observedExecution: observed as string | null, job, summary, corrects };
}

function parseClaim(json: Record<string, unknown>, kind: Exclude<ReportKind, "decision">): ReportClaim {
  switch (kind) {
    case "progress":
      return { kind };
    case "blocked":
      return { kind, on: oneOf(json["on"], BLOCKED_ON, "on"), needs: text(json["needs"], "needs", MAX_NEEDS_CHARS) };
    case "completed":
      return { kind, ending: oneOf(json["ending"], COMPLETED_ENDINGS, "ending"), revisions: parseRevisions(json["revisions"]) };
  }
}

/**
 * A submission, strictly — the ONE parser, used by the CLI before it writes and
 * by the drain before it records. Every text field is bounded and clean.
 *
 * The returned object is built in a fixed key order, so `JSON.stringify` of it is
 * canonical: two submissions are the same claim exactly when those strings match.
 */
export function parseSubmission(line: string): ParsedSubmission {
  try {
    const json = parseJsonObject(line);
    const common = parseCommon(json, json["kind"] === "decision" ? ["draft"] : []);
    const { kind: _kind, ...rest } = common;
    const head = { ...rest, artefacts: parseSubmittedRefs(json["artefacts"]) };
    if (common.kind === "decision") {
      // Opaque until Stage 3 — see `DecisionDraft`. Bounded by the file size.
      return { ok: true, submission: { ...head, kind: "decision", draft: record(json["draft"], "draft") } };
    }
    return { ok: true, submission: { ...head, ...parseClaim(json, common.kind) } };
  } catch (cause) {
    if (cause instanceof Refusal) return { ok: false, why: cause.message };
    throw cause;
  }
}

/** One recorded line, strictly. Our own bytes, but the log is read by people and by the page. */
export function parseReportEvent(line: string): ParsedEvent {
  try {
    const json = parseJsonObject(line);
    const common = parseCommon(json, json["kind"] === "decision" ? ["receivedAt", "execution", "decisionId"] : ["receivedAt", "execution"]);
    const { kind: _kind, ...rest } = common;
    const artefacts = parseCheckedArtefacts(json["artefacts"]);
    if (artefacts === null) refuse("artefacts", "is not a list of checked references");
    const head = {
      ...rest,
      receivedAt: instant(json["receivedAt"], "receivedAt"),
      execution: parseExecutionComparison(json["execution"], common.actor),
      artefacts,
    };
    if (common.kind === "decision") {
      const decisionId = json["decisionId"];
      if (typeof decisionId !== "string" || !DECISION_ID_RULE.test(decisionId)) refuse("decisionId", "is not a decision id");
      return { ok: true, event: { ...head, kind: "decision", decisionId } };
    }
    return { ok: true, event: { ...head, ...parseClaim(json, common.kind) } };
  } catch (cause) {
    if (cause instanceof Refusal) return { ok: false, why: cause.message };
    throw cause;
  }
}

/** The canonical text of a submission. Throws on an invalid one: callers validate first. */
export function serializeSubmission(submission: ReportSubmission): string {
  const parsed = parseSubmission(JSON.stringify(submission));
  if (!parsed.ok) throw new Error(`not a valid report submission: ${parsed.why}`);
  return JSON.stringify(parsed.submission);
}

/**
 * The submission a recorded event was made from, as canonical text — or null for
 * a decision, whose draft the event does not carry. Used to tell a re-dropped
 * submission (the same claim, one row) from a different claim under a reused id.
 */
function submissionTextOf(event: ReportEvent): string | null {
  if (event.kind === "decision") return null;
  const { receivedAt: _r, execution: _e, artefacts, ...rest } = event;
  return serializeSubmission({ ...rest, artefacts: artefacts.map((item) => item.ref) } as ReportSubmission);
}

/**
 * Text safe to print: a control or bidi character becomes `?`.
 *
 * For anything a reader of `overseer reports` sees that did not come through
 * `parseSubmission` — a refusal's reason quoting a hand-dropped file, say.
 */
export function printable(value: string): string {
  return [...value].map((char) => (untrustedTextProblem(char, 1) === null ? char : "?")).join("");
}

/* ------------------------------------------------------------------ *
 * Submitting.
 * ------------------------------------------------------------------ */

function fsyncDirectory(directory: string): void {
  try {
    const fd = openSync(directory, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    /* Not every platform lets you fsync a directory; the rename still happened. */
  }
}

/**
 * Drop one submission into the inbox: `.tmp-<id>` opened `wx`, written, fsynced,
 * renamed to `<id>.json`, and the directory fsynced. Returns the final path.
 *
 * The rename is what the drain sees, so it sees a whole file or nothing. A
 * submitter killed before the rename leaves `.tmp-<id>`, which the drain removes
 * once it is an hour old.
 */
export function submitReport(root: string, submission: ReportSubmission): string {
  if (!path.isAbsolute(root)) throw new Error(`the store directory must be absolute, not '${root}'`);
  const body = `${serializeSubmission(submission)}\n`;
  if (Buffer.byteLength(body, "utf8") > MAX_SUBMISSION_BYTES) {
    throw new Error(`this report is ${Buffer.byteLength(body, "utf8")} bytes, over the ${MAX_SUBMISSION_BYTES}-byte limit`);
  }
  const inbox = path.join(root, INBOX_DIR);
  mkdirSync(inbox, { recursive: true });
  const temp = path.join(inbox, `.tmp-${submission.eventId}`);
  const final = path.join(inbox, `${submission.eventId}.json`);
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeAll(fd, body);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, final);
  fsyncDirectory(inbox);
  return final;
}

/* ------------------------------------------------------------------ *
 * Reading an inbox entry without trusting it.
 * ------------------------------------------------------------------ */

type BoundedRead =
  | { kind: "text"; text: string; bytes: number }
  | { kind: "oversize"; size: number; head: string; bytes: number }
  | { kind: "not-regular"; why: string }
  | { kind: "gone" };

/**
 * Open with `O_NOFOLLOW` (a symlink is refused by the kernel, not by a check that
 * can be raced) and `O_NONBLOCK` (a FIFO swapped in after the `lstat` must not
 * hang the daemon), then `fstat` the descriptor we actually hold.
 */
function readBounded(file: string, limit: number = MAX_SUBMISSION_BYTES): BoundedRead {
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { kind: "gone" };
    if (code === "ELOOP") return { kind: "not-regular", why: "is a symbolic link" };
    throw cause;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { kind: "not-regular", why: "is not a regular file" };
    const buffer = Buffer.alloc(Math.min(stat.size, limit) + 1);
    let read = 0;
    while (read < buffer.length) {
      const count = readSync(fd, buffer, read, buffer.length - read, read);
      if (count <= 0) break;
      read += count;
    }
    if (read > limit || stat.size > limit) {
      return { kind: "oversize", size: Math.max(stat.size, read), head: buffer.subarray(0, Math.min(read, limit)).toString("utf8"), bytes: Math.min(read, limit) };
    }
    return { kind: "text", text: buffer.subarray(0, read).toString("utf8"), bytes: read };
  } finally {
    closeSync(fd);
  }
}

function uuidJsonNames(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => INBOX_NAME_RULE.test(name));
}

function unlinkQuietly(file: string): void {
  try {
    unlinkSync(file);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
}

/* ------------------------------------------------------------------ *
 * The drain.
 * ------------------------------------------------------------------ */

export type ArtefactChecker = (ref: ArtefactRef) => ArtefactCheck;

/**
 * What step [2] will say, once Stage 3 fills it. In the signature now so that
 * stage only has to supply it; this stage never calls it, because every decision
 * submission is refused before step [1] finishes.
 */
export type DecisionAppendOutcome =
  | { readonly kind: "appended" }
  | { readonly kind: "pending"; readonly why: string }
  | { readonly kind: "refused"; readonly why: string };
export type DecisionAppender = (prepared: PreparedReport) => DecisionAppendOutcome;

/** The frozen result of step [1]. Stage 3 adds the prepared decision line beside `reportLine`. */
export type PreparedReport = { readonly schema: typeof REPORTS_SCHEMA; readonly eventId: string; readonly reportLine: string };

export type DrainLimits = { files: number; bytes: number; probes: number; wallMs: number };
/** Per pass; the rest waits. Sol's WR-P5: the file count alone bounded nothing else. */
export const DEFAULT_DRAIN_LIMITS: DrainLimits = { files: 50, bytes: 1024 * 1024, probes: 200, wallMs: 5_000 };

/** The step boundaries a test can crash at. Nothing in production passes `crashAt`. */
export type DrainBoundary = "processing-written" | "reports-appended" | "processing-unlinked";
export class SimulatedCrash extends Error {}

export type DrainOptions = {
  root: string;
  /** The daemon's live register, for the execution comparison. */
  register: SessionRegister;
  /** Stamps `receivedAt` and dates refusals. The wall-clock bound uses the real clock. */
  now: () => Date;
  checkArtefact: ArtefactChecker;
  appendDecision: DecisionAppender;
  limits?: Partial<DrainLimits>;
  /** A TEST SEAM: throw `SimulatedCrash` at this boundary, as a `kill -9` there would stop the pass. */
  crashAt?: DrainBoundary;
};

export type ReportDrainOutcome = {
  recorded: number;
  /** A submission re-dropped after it was recorded: the same claim, still one row. */
  duplicates: number;
  refused: number;
  /** Left for the next pass by a transient failure. */
  pending: number;
  /** Not reached this pass because a bound was hit. */
  deferred: number;
  /** Inbox entries that are not `<uuid>.json` regular files: counted, never read, never deleted. */
  skippedEntries: number;
  replayed: number;
  debrisRemoved: number;
  probes: number;
  bytesRead: number;
  stoppedBy: "files" | "bytes" | "probes" | "time" | null;
  /** One sentence per refused, pending or skipped item. */
  notes: string[];
};

function emptyOutcome(): ReportDrainOutcome {
  return {
    recorded: 0,
    duplicates: 0,
    refused: 0,
    pending: 0,
    deferred: 0,
    skippedEntries: 0,
    replayed: 0,
    debrisRemoved: 0,
    probes: 0,
    bytesRead: 0,
    stoppedBy: null,
    notes: [],
  };
}

/** The register's run for a session name, compared with the token the submitter observed. */
export function compareExecution(actor: ReportActor, observed: string | null, register: SessionRegister): ExecutionComparison {
  if (actor.kind !== "session") return null;
  const entries = [...register.values()].filter((entry) => entry.name === actor.name);
  if (entries.length === 0) {
    return { unverifiable: `the register holds no session named ${actor.name}, so there is no verified run to compare with` };
  }
  if (entries.length > 1) {
    return { unverifiable: `the register holds ${entries.length} sessions named ${actor.name}, so which run this is cannot be told` };
  }
  const verified = entries[0]?.verifiedExecution ?? null;
  if (verified === null) return { unverifiable: `the register has never verified a run for ${actor.name}` };
  if (observed === null) {
    return { unverifiable: "the submitter could not observe its own execution, so there is nothing to compare with the register's verified run" };
  }
  return observed === verified.token ? "same-verified-run" : "different-verified-run";
}

/** The event's fields; `parseReportEvent` then gives it the one key order every recorded line uses. */
function buildEvent(
  submission: ReportSubmission & ReportClaim,
  receivedAt: string,
  execution: ExecutionComparison,
  artefacts: readonly CheckedArtefact[],
): Record<string, unknown> {
  const head = {
    schema: submission.schema,
    eventId: submission.eventId,
    submittedAt: submission.submittedAt,
    receivedAt,
    kind: submission.kind,
    actor: submission.actor,
    observedExecution: submission.observedExecution,
    execution,
    job: submission.job,
    summary: submission.summary,
    artefacts,
    corrects: submission.corrects,
  };
  switch (submission.kind) {
    case "progress":
      return head;
    case "blocked":
      return { ...head, on: submission.on, needs: submission.needs };
    case "completed":
      return { ...head, ending: submission.ending, revisions: submission.revisions };
  }
}

function writeInitMarker(root: string): void {
  const marker = path.join(root, REPORTS_INIT_FILE);
  if (existsSync(marker)) return;
  writeAtomically(
    marker,
    root,
    `reports were first recorded here at ${new Date().toISOString()}\n` +
      `With this marker present and ${REPORTS_FILE} absent or empty, the record has been LOST.\n` +
      "Delete both files to reset deliberately.\n",
  );
}

type LogState = { kind: "ok"; recorded: Map<string, string> } | { kind: "lost"; why: string };

/**
 * The log, repaired and indexed once per pass. A LOST log is not recreated: the
 * drain would then append to a fresh file and the loss would read as a short
 * history. Everything waits until somebody has looked.
 */
function openLog(root: string): LogState {
  const file = path.join(root, REPORTS_FILE);
  const initialised = existsSync(path.join(root, REPORTS_INIT_FILE));
  if (initialised && (!existsSync(file) || readFileSync(file).byteLength === 0)) {
    return {
      kind: "lost",
      why: `${REPORTS_INIT_FILE} says reports were recorded here and ${REPORTS_FILE} is gone or empty — nothing is recorded until somebody has looked`,
    };
  }
  // Repaired under the daemon's own lock, before anything appends — jsonl.ts rule 1.
  truncateToLastLine(file);
  const recorded = new Map<string, string>();
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      const parsed = parseReportEvent(line);
      if (parsed.ok && !recorded.has(parsed.event.eventId)) recorded.set(parsed.event.eventId, line);
    }
  }
  return { kind: "ok", recorded };
}

/**
 * One pass. **Synchronous, and only ever called by a daemon holding
 * `overseer.lock`** — that lock is the exclusion; there is no `reports.lock`.
 */
export function drainReports(options: DrainOptions): ReportDrainOutcome {
  const { root, now } = options;
  if (!path.isAbsolute(root)) throw new Error(`the store directory must be absolute, not '${root}'`);
  const limits: DrainLimits = { ...DEFAULT_DRAIN_LIMITS, ...options.limits };
  const startedMs = Date.now();
  const outcome = emptyOutcome();
  const inboxDir = path.join(root, INBOX_DIR);
  const processingDir = path.join(root, PROCESSING_DIR);
  const refusedDir = path.join(root, REFUSED_DIR);
  for (const dir of [inboxDir, processingDir, refusedDir]) mkdirSync(dir, { recursive: true });

  const crash = (at: DrainBoundary): void => {
    if (options.crashAt === at) throw new SimulatedCrash(`simulated crash after ${at}`);
  };

  const log = openLog(root);
  if (log.kind === "lost") {
    outcome.pending = uuidJsonNames(processingDir).length + uuidJsonNames(inboxDir).length;
    outcome.notes.push(log.why);
    return outcome;
  }
  const recorded = log.recorded;
  const logFile = path.join(root, REPORTS_FILE);

  /** One refusal record, atomically, then the inputs go. Newest 200 kept. */
  const refuseItem = (eventId: string, why: string, original: string, inputs: readonly string[]): void => {
    const body = { eventId, refusedAt: now().toISOString(), why, original: original.slice(0, MAX_SUBMISSION_BYTES) };
    writeAtomically(path.join(refusedDir, `${eventId}.json`), refusedDir, `${JSON.stringify(body)}\n`);
    for (const input of inputs) unlinkQuietly(input);
    outcome.refused += 1;
    outcome.notes.push(`refused ${eventId}: ${why}`);
    const kept = uuidJsonNames(refusedDir);
    if (kept.length > REFUSED_KEPT) {
      const byAge = kept
        .map((name) => ({ name, mtimeMs: lstatSync(path.join(refusedDir, name)).mtimeMs }))
        .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
      for (const old of byAge.slice(0, kept.length - REFUSED_KEPT)) unlinkQuietly(path.join(refusedDir, old.name));
    }
  };

  /** Steps [3] and [4] for one prepared report — the same code for a first attempt and a replay. */
  const commit = (prepared: PreparedReport, inboxFile: string, original: string): "recorded" | "refused" => {
    const processingFile = path.join(processingDir, `${prepared.eventId}.json`);
    const existing = recorded.get(prepared.eventId);
    if (existing === undefined) {
      writeInitMarker(root);
      const fd = openSync(logFile, "a");
      try {
        writeAll(fd, `${prepared.reportLine}\n`);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      recorded.set(prepared.eventId, prepared.reportLine);
    } else if (existing !== prepared.reportLine) {
      refuseItem(prepared.eventId, `event id ${prepared.eventId} is already recorded with different content`, original, [processingFile, inboxFile]);
      return "refused";
    }
    crash("reports-appended");
    unlinkQuietly(processingFile);
    crash("processing-unlinked");
    unlinkQuietly(inboxFile);
    return "recorded";
  };

  /* ---- Start of pass: replay every prepared report with its frozen bytes. ---- */
  const inFlight = new Set<string>();
  for (const name of uuidJsonNames(processingDir)) {
    const eventId = name.slice(0, -".json".length);
    const inboxFile = path.join(inboxDir, name);
    try {
      const prepared = JSON.parse(readFileSync(path.join(processingDir, name), "utf8")) as PreparedReport;
      const reparsed = parseReportEvent(prepared.reportLine);
      if (prepared.eventId !== eventId || !reparsed.ok || reparsed.event.eventId !== eventId) {
        throw new Error(`the prepared report ${name} does not hold a report for ${eventId}`);
      }
      const result = commit(prepared, inboxFile, prepared.reportLine);
      if (result === "recorded") outcome.replayed += 1;
    } catch (cause) {
      if (cause instanceof SimulatedCrash) throw cause;
      inFlight.add(eventId);
      outcome.pending += 1;
      outcome.notes.push(`pending ${eventId}: its prepared report could not be replayed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  /* ---- The inbox, oldest first. ---- */
  const nowMs = now().getTime();
  const candidates: { name: string; eventId: string; mtimeMs: number }[] = [];
  for (const name of readdirSync(inboxDir)) {
    const file = path.join(inboxDir, name);
    if (name.startsWith(".tmp-")) {
      // A submitter's temp file. Young ones are mid-write and are left for their
      // writer; one an hour old was abandoned, and removing it is the only
      // deletion in this directory of something that was never a submission.
      try {
        const stat = lstatSync(file);
        if (stat.isFile() && nowMs - stat.mtimeMs > TMP_DEBRIS_AGE_MS) {
          unlinkQuietly(file);
          outcome.debrisRemoved += 1;
        }
      } catch {
        /* Renamed or removed under us: its writer finished. */
      }
      continue;
    }
    const match = INBOX_NAME_RULE.exec(name);
    let stat: ReturnType<typeof lstatSync> | undefined;
    try {
      stat = lstatSync(file);
    } catch {
      continue;
    }
    if (match === null || !stat.isFile()) {
      outcome.skippedEntries += 1;
      outcome.notes.push(`skipped ${printable(name)}: ${match === null ? "not named <uuid>.json" : "not a regular file"}; left where it is`);
      continue;
    }
    candidates.push({ name, eventId: match[1] ?? "", mtimeMs: stat.mtimeMs });
    inFlight.add(match[1] ?? "");
  }
  candidates.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));

  let files = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate === undefined) continue;
    const { eventId } = candidate;
    const inboxFile = path.join(inboxDir, candidate.name);
    if (!recorded.has(eventId) && existsSync(path.join(processingDir, candidate.name))) {
      // Its replay is pending above; the inbox copy is the same item mid-flight.
      continue;
    }
    const stopAt = (why: ReportDrainOutcome["stoppedBy"]): void => {
      outcome.stoppedBy = why;
      outcome.deferred = candidates.length - index;
    };
    if (files >= limits.files) {
      stopAt("files");
      break;
    }
    if (files > 0 && Date.now() - startedMs >= limits.wallMs) {
      stopAt("time");
      break;
    }

    try {
      let read: BoundedRead;
      try {
        read = readBounded(inboxFile);
      } catch (cause) {
        throw new Error(`could not open ${candidate.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      if (read.kind === "gone") continue;
      if (read.kind === "not-regular") {
        outcome.skippedEntries += 1;
        outcome.notes.push(`skipped ${candidate.name}: ${read.why}; left where it is`);
        continue;
      }
      if (files > 0 && outcome.bytesRead + read.bytes > limits.bytes) {
        stopAt("bytes");
        break;
      }
      files += 1;
      outcome.bytesRead += read.bytes;
      if (read.kind === "oversize") {
        refuseItem(
          eventId,
          `the file is ${read.size} bytes, over the ${MAX_SUBMISSION_BYTES}-byte limit; the original kept here is its first ${MAX_SUBMISSION_BYTES} bytes`,
          read.head,
          [inboxFile],
        );
        continue;
      }

      /* ---- [1] Prepare, once. ---- */
      const parsed = parseSubmission(read.text);
      if (!parsed.ok) {
        refuseItem(eventId, parsed.why, read.text, [inboxFile]);
        continue;
      }
      const submission = parsed.submission;
      if (submission.eventId !== eventId) {
        refuseItem(eventId, `the file is named ${eventId}.json but its eventId is ${submission.eventId}`, read.text, [inboxFile]);
        continue;
      }
      if (submission.kind === "decision") {
        refuseItem(eventId, DECISION_NOT_WIRED, read.text, [inboxFile]);
        continue;
      }
      const existing = recorded.get(eventId);
      if (existing !== undefined) {
        const earlier = parseReportEvent(existing);
        if (earlier.ok && submissionTextOf(earlier.event) === JSON.stringify(submission)) {
          unlinkQuietly(inboxFile);
          outcome.duplicates += 1;
          continue;
        }
        refuseItem(eventId, `event id ${eventId} is already recorded with different content`, read.text, [inboxFile]);
        continue;
      }
      if (submission.corrects !== null && !recorded.has(submission.corrects)) {
        if (inFlight.has(submission.corrects)) {
          outcome.pending += 1;
          outcome.notes.push(`pending ${eventId}: it corrects ${submission.corrects}, which is not recorded yet`);
          continue;
        }
        refuseItem(eventId, `corrects ${submission.corrects}, which is not a recorded report`, read.text, [inboxFile]);
        continue;
      }
      if (outcome.probes > 0 && outcome.probes + submission.artefacts.length > limits.probes) {
        stopAt("probes");
        break;
      }

      const artefacts: CheckedArtefact[] = [];
      for (const ref of submission.artefacts) {
        outcome.probes += 1;
        artefacts.push({ ref, check: options.checkArtefact(ref) });
      }
      const built = buildEvent(submission, now().toISOString(), compareExecution(submission.actor, submission.observedExecution, options.register), artefacts);
      const check = parseReportEvent(JSON.stringify(built));
      if (!check.ok) {
        // Our bytes, so this is a checker or builder bug — not the submitter's fault, not a refusal.
        throw new Error(`the prepared report does not read back: ${check.why}`);
      }
      // THE PARSER'S OUTPUT IS THE CANONICAL FORM, so these are the bytes every retry and every reader agrees on.
      const line = JSON.stringify(check.event);
      const prepared: PreparedReport = { schema: REPORTS_SCHEMA, eventId, reportLine: line };
      writeAtomically(path.join(processingDir, `${eventId}.json`), processingDir, `${JSON.stringify(prepared)}\n`);
      crash("processing-written");

      /* ---- [2] is Stage 3's; [3] and [4]. ---- */
      if (commit(prepared, inboxFile, read.text) === "recorded") outcome.recorded += 1;
    } catch (cause) {
      if (cause instanceof SimulatedCrash) throw cause;
      outcome.pending += 1;
      outcome.notes.push(`pending ${eventId}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  return outcome;
}

/* ------------------------------------------------------------------ *
 * Reading. Lock-free, like every other Overseer reader.
 * ------------------------------------------------------------------ */

export type ReportCorrection = { readonly eventId: string; readonly actor: ReportActor; readonly at: string };
export type ReportRow = { readonly event: ReportEvent; readonly correctedBy: ReportCorrection | null };
export type ReportProblemKind = "unreadable-line" | "duplicate-event" | "invalid-correction";
export type ReportProblem = { readonly kind: ReportProblemKind; readonly why: string; readonly eventId: string | null };
export type ReportsView = { readonly rows: readonly ReportRow[]; readonly problems: readonly ReportProblem[] };

/**
 * Rows oldest first, and the problems — collected, never thrown.
 *
 * **A correction is only ever explicit** (GPT Sol's WR-P9). The earlier row is
 * never edited; it is marked `correctedBy`. Without `corrects`, a later claim is
 * just a later claim: a `progress` after a `completed` may be work resumed, and
 * inferring disagreement from kinds would be an unearned claim of our own.
 */
export function foldReports(events: readonly ReportEvent[], seedProblems: readonly ReportProblem[] = []): ReportsView {
  const problems: ReportProblem[] = [...seedProblems];
  const position = new Map<string, number>();
  events.forEach((event, index) => {
    if (!position.has(event.eventId)) position.set(event.eventId, index);
  });
  const rows: { event: ReportEvent; correctedBy: ReportCorrection | null }[] = [];
  const byId = new Map<string, (typeof rows)[number]>();
  const bytes = new Map<string, string>();

  for (const event of events) {
    const text = JSON.stringify(event);
    const first = bytes.get(event.eventId);
    if (first !== undefined) {
      // Identical bytes are one report written twice by hand; different bytes are two claims under one id.
      if (first !== text) {
        problems.push({ kind: "duplicate-event", why: `event id ${event.eventId} appears again with different content; the later line was ignored`, eventId: event.eventId });
      }
      continue;
    }
    bytes.set(event.eventId, text);
    const row = { event, correctedBy: null };
    rows.push(row);
    byId.set(event.eventId, row);

    if (event.corrects === null) continue;
    const invalid = (why: string): void => {
      problems.push({ kind: "invalid-correction", why, eventId: event.eventId });
    };
    if (event.corrects === event.eventId) {
      invalid(`${event.eventId} corrects itself`);
      continue;
    }
    const target = byId.get(event.corrects);
    if (target === undefined) {
      invalid(
        position.has(event.corrects)
          ? `${event.eventId} corrects ${event.corrects}, which was recorded after it`
          : `${event.eventId} corrects ${event.corrects}, which is not in this record`,
      );
      continue;
    }
    if (target.correctedBy !== null) {
      invalid(`${event.corrects} was already corrected by ${target.correctedBy.eventId}; a further correction should name that one`);
      continue;
    }
    target.correctedBy = { eventId: event.eventId, actor: event.actor, at: event.receivedAt };
  }
  return { rows, problems };
}

export type ReportsRead =
  | { kind: "never-written"; path: string }
  | { kind: "reports"; view: ReportsView; path: string }
  | { kind: "unreadable"; why: string; path: string };

export function readReports(root: string): ReportsRead {
  const file = path.join(root, REPORTS_FILE);
  if (!path.isAbsolute(root)) {
    return { kind: "unreadable", why: `the store directory must be an absolute path, not '${root}'`, path: file };
  }
  const initialised = existsSync(path.join(root, REPORTS_INIT_FILE));
  if (!existsSync(file)) {
    return initialised
      ? { kind: "unreadable", why: `${file} is gone, but ${REPORTS_INIT_FILE} says reports were recorded — this is a LOST record, not a new one`, path: file }
      : { kind: "never-written", path: file };
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (cause) {
    return { kind: "unreadable", why: `could not read ${file}: ${String(cause)}`, path: file };
  }
  if (bytes.byteLength === 0 && initialised) {
    return { kind: "unreadable", why: `${file} is empty, but ${REPORTS_INIT_FILE} says reports were recorded — it was truncated, not emptied`, path: file };
  }
  // A torn tail is an append in progress seen without the lock, not corruption.
  const { completeLines } = splitJsonl(bytes);
  const events: ReportEvent[] = [];
  const problems: ReportProblem[] = [];
  completeLines.forEach((line, index) => {
    if (line.trim() === "") return;
    const parsed = parseReportEvent(line);
    if (parsed.ok) events.push(parsed.event);
    else problems.push({ kind: "unreadable-line", why: `line ${index + 1} is not a report this build understands: ${parsed.why}`, eventId: null });
  });
  return { kind: "reports", view: foldReports(events, problems), path: file };
}

export type InboxItem = { readonly eventId: string; readonly submission: ReportSubmission | null; readonly why: string | null };
export type ProcessingItem = { readonly eventId: string; readonly event: ReportEvent | null; readonly why: string | null };
export type RefusedItem = { readonly eventId: string; readonly refusedAt: string; readonly why: string };
export type InboxListing = {
  readonly inFlight: readonly InboxItem[];
  readonly processing: readonly ProcessingItem[];
  /** Newest first. */
  readonly refused: readonly RefusedItem[];
  /** Entries in the inbox that are not submissions at all. */
  readonly skippedEntries: number;
};

/** What has not been recorded: submitted, mid-flight, or refused and why. Read-only. */
export function readInbox(root: string): InboxListing {
  const inboxDir = path.join(root, INBOX_DIR);
  const inFlight: InboxItem[] = [];
  let skippedEntries = 0;
  if (existsSync(inboxDir)) {
    for (const name of readdirSync(inboxDir).sort()) {
      if (name.startsWith(".tmp-")) continue;
      const match = INBOX_NAME_RULE.exec(name);
      if (match === null) {
        skippedEntries += 1;
        continue;
      }
      const eventId = match[1] ?? "";
      const read = readBounded(path.join(inboxDir, name));
      if (read.kind === "gone") continue;
      if (read.kind === "not-regular") {
        skippedEntries += 1;
        continue;
      }
      if (read.kind === "oversize") {
        inFlight.push({ eventId, submission: null, why: `over the ${MAX_SUBMISSION_BYTES}-byte limit; the daemon will refuse it` });
        continue;
      }
      const parsed = parseSubmission(read.text);
      inFlight.push(parsed.ok ? { eventId, submission: parsed.submission, why: null } : { eventId, submission: null, why: `unreadable, the daemon will refuse it: ${parsed.why}` });
    }
  }
  const processing = uuidJsonNames(path.join(root, PROCESSING_DIR)).map((name): ProcessingItem => {
    const eventId = name.slice(0, -".json".length);
    try {
      const prepared = JSON.parse(readFileSync(path.join(root, PROCESSING_DIR, name), "utf8")) as { reportLine?: unknown };
      const parsed = typeof prepared.reportLine === "string" ? parseReportEvent(prepared.reportLine) : null;
      return parsed?.ok === true ? { eventId, event: parsed.event, why: null } : { eventId, event: null, why: "its prepared report does not read" };
    } catch (cause) {
      return { eventId, event: null, why: `could not read its prepared report: ${String(cause)}` };
    }
  });
  const refused: RefusedItem[] = [];
  for (const name of uuidJsonNames(path.join(root, REFUSED_DIR))) {
    try {
      const body = JSON.parse(readFileSync(path.join(root, REFUSED_DIR, name), "utf8")) as Record<string, unknown>;
      refused.push({
        eventId: name.slice(0, -".json".length),
        refusedAt: typeof body["refusedAt"] === "string" ? body["refusedAt"] : "an unrecorded time",
        why: typeof body["why"] === "string" ? printable(body["why"]) : "no reason was recorded",
      });
    } catch {
      refused.push({ eventId: name.slice(0, -".json".length), refusedAt: "an unrecorded time", why: "the refusal record could not be read" });
    }
  }
  refused.sort((a, b) => b.refusedAt.localeCompare(a.refusedAt));
  return { inFlight, processing, refused, skippedEntries };
}
