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
 *     [2] a session's decision: the prepared `decided` event into
 *         decisions.jsonl, under its own lock, command id report:<eventId>
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
 * never read past 16 KiB, and never opened if it is not a regular file. And a
 * pass never lists the whole inbox: it reads at most `scanEntries` directory
 * entries, and moves anything that can never become a report into
 * `report-quarantine/`, so a flood of junk is cleared a bounded slice at a time
 * instead of stalling the daemon's loop — heartbeat included — or starving the
 * submissions behind it. The daemon only ever renames into `report-quarantine/`:
 * it never lists it and never deletes from it, because one quarantined
 * directory can hold a tree of any size (GPT Sol's WR-S3-4). Emptying it is a
 * person's act; `readInbox` says how big it has grown, so growth shows.
 * `report-refused/` is kept the same way — never pruned, only counted — and the
 * start-of-pass replay reads `report-processing/` under the same cap as the
 * inbox scan.
 *
 * The reader keeps the same rule. `readInbox` — called on every
 * `GET /api/reports` — reads each directory lazily under a cap, and every count
 * it returns says `exact` or `atLeast` (WR-S3-5). **Nothing on a request path or
 * in the daemon's loop does work proportional to what an untrusted writer put in
 * the store.**
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  opendirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  unlinkSync,
  type Dir,
  type Stats,
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
import {
  ASSESSMENT_FIELDS,
  DECISIONS_SCHEMA,
  NOT_RECORDED,
  appendEvents,
  envelope,
  mintId,
  parseEventDetailed,
  readDecisions,
  type DecidedV2Event,
  type DecisionAuthor,
  type DecisionEvent,
  type DecisionRecord,
  type ExecutionRef,
  type SessionRef,
} from "./decisions.js";
import { splitJsonl, truncateToLastLine, writeAll, writeAtomically } from "./jsonl.js";
/**
 * **The two fields of the daemon's register this module reads**, as a structural type rather than
 * `store.ts`'s `SessionRegister`. `tools/fleet/` imports this module (the Claims view and its route),
 * and even a type-only import of `store.ts` would put the whole store's closure on the dashboard's side
 * of the seam that `tests/fleet-attention.test.ts` guards. The daemon's live register satisfies this as
 * it stands.
 */
export type ReportRegister = {
  values(): Iterable<{
    readonly name: string;
    readonly verifiedExecution: { readonly token: string; readonly since: string } | null;
  }>;
};

export const REPORTS_SCHEMA = 1;
export const REPORTS_FILE = "reports.jsonl";
/**
 * Proof outside the replaceable log that reports have been recorded. Once it
 * exists, an absent or empty `reports.jsonl` is LOST, not new — the same rule as
 * `decisions.created`, for the same reason: this is original input an agent
 * cannot re-send, not a disposable derivation like `events.jsonl`.
 */
export const REPORTS_INIT_FILE = "reports.created";
/* Sibling directories rather than subdirectories of the inbox, because the
   inbox is the only one a client writes and the drain moves anything in it that
   is not a submission out of the way — a subdirectory there would be moved. */
export const INBOX_DIR = "report-inbox";
export const PROCESSING_DIR = "report-processing";
/**
 * One record per refused submission, written in place of the inbox file it came
 * from, so it grows only as fast as submitters write. **The daemon never prunes
 * it**: a prune lists, stats and sorts the directory inside the loop, which is
 * work proportional to what a writer put here. `readInbox` counts it, capped;
 * emptying it is a person's act.
 */
export const REFUSED_DIR = "report-refused";
/**
 * Where an inbox entry goes when it can never become a report: a name that is
 * not `<uuid>.json` or `.tmp-<uuid>`, a directory, a symlink, a file with more
 * than one hard link. Moved by `rename`, which moves a symlink itself and never
 * its target; never read, never listed by the drain, and **never emptied
 * automatically**. A move costs no new disk — the writer already put it there —
 * so there is nothing for the daemon to reclaim, and deleting someone else's
 * files is not its job: look at it, then delete it. `readInbox` reports its size
 * and the age of its oldest entry, read from the names.
 */
export const QUARANTINE_DIR = "report-quarantine";

export const MAX_SUBMISSION_BYTES = 16 * 1024;
/**
 * A prepared record adds daemon checks to a bounded submission, and for a
 * decision holds two JSON lines as strings, whose quotes are escaped again — so
 * well above twice the submission limit. Checked before it is written, because
 * a record its own replay would refuse to read would be pending for ever.
 */
export const MAX_PREPARED_BYTES = 256 * 1024;
/** Includes a JSON-escaped copy of at most 16 KiB of rejected input. */
export const MAX_REFUSAL_BYTES = 128 * 1024;
export const MAX_SUMMARY_CHARS = 1000;
export const MAX_NEEDS_CHARS = 500;
export const MAX_REVISIONS = 20;
export const MAX_WHY_CHARS = 300;
/** A `.tmp-*` older than this was left by a submitter that died between open and rename. */
export const TMP_DEBRIS_AGE_MS = 60 * 60 * 1000;

/** Lower-case only: one spelling per id, because ids are compared as strings. */
const UUID_RULE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INBOX_NAME_RULE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;
/** The first refusal keeps the old `<eventId>.json` name; another attempt under that id gets a unique suffix so neither record is destroyed. */
const REFUSED_NAME_RULE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\.json$/;
/** The only other name `submitReport` ever puts in the inbox. */
const TMP_NAME_RULE = /^\.tmp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A quarantined entry keeps its old name after a sortable prefix, when that name is plain enough to put in a path. */
const PLAIN_NAME_RULE = /^[A-Za-z0-9._-]{1,100}$/;
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
 * A session's decision as it submits it: the schema-2 decision's content and
 * assessment, **minus `author`**, which the daemon stamps from the reporting
 * session and the register at receipt, **and minus `evidence`**: the report's own
 * `artefacts` ARE the evidence — one list, probed once, so a decision and the
 * report that points at it can never disagree about a reference. The CLI moves
 * a template's `evidence` list into `artefacts`. `bearsOn.sessions` are names,
 * as in `overseer-decisions template`; the daemon resolves each at receipt.
 */
export type DecisionDraft = Pick<
  DecidedV2Event,
  | "class"
  | "question"
  | "options"
  | "chose"
  | "why"
  | "advisers"
  | "supersedes"
  | "consequence"
  | "reversibility"
  | "domain"
  | "recommendation"
  | "gregAsked"
  | "confidence"
> & { readonly bearsOn: { readonly sessions: readonly string[]; readonly plan: string | null } };

/** A draft's keys: V1's content, then schema 2's assessment without author and evidence. */
const DRAFT_FIELDS: readonly string[] = [
  "class",
  "question",
  "options",
  "chose",
  "why",
  "advisers",
  "bearsOn",
  "supersedes",
  ...ASSESSMENT_FIELDS.filter((field) => field !== "author" && field !== "evidence"),
];

/** The command id that joins a session's decision to its report, and makes step [2] replay-safe. */
export function reportCommandId(eventId: string): string {
  return `report:${eventId}`;
}

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
 * The `decided` event the daemon writes for a session's decision — and, with
 * stand-ins for what only the daemon knows, the one a draft is checked as.
 * One builder for both, so the check and the write cannot drift apart.
 */
function decidedEventFields(parts: {
  eventId: string;
  at: string;
  decisionId: string;
  content: { readonly [field: string]: unknown };
  plan: unknown;
  sessions: readonly SessionRef[];
  author: DecisionAuthor;
  evidence: readonly CheckedArtefact[];
}): Record<string, unknown> {
  const { content } = parts;
  return {
    ...envelope("daemon", { at: parts.at, commandId: reportCommandId(parts.eventId) }),
    kind: "decided",
    id: parts.decisionId,
    decidedAt: parts.at,
    class: content["class"],
    question: content["question"],
    options: content["options"],
    chose: content["chose"],
    why: content["why"],
    advisers: content["advisers"],
    bearsOn: { sessions: parts.sessions, plan: parts.plan },
    supersedes: content["supersedes"],
    author: parts.author,
    consequence: content["consequence"],
    reversibility: content["reversibility"],
    domain: content["domain"],
    recommendation: content["recommendation"],
    evidence: parts.evidence,
    gregAsked: content["gregAsked"],
    confidence: content["confidence"],
  };
}

/** A decision id that only ever appears in a draft's check, never in a record. */
const PROVISIONAL_DECISION_ID = "dec-22222222";

/**
 * A decision draft, strictly: formed into the real `decided` event — `by:
 * daemon`, the session as author, `report:<eventId>` as command id — and passed
 * through the decision record's own parser, so a refusal names the field and
 * nothing is accepted here that step [2]'s `appendEvents` would refuse for its
 * shape. Only a session's decision comes through a report (WR-P1): the parser's
 * matrix admits `daemon` only with a session author (WR-S2-1).
 */
function parseDraft(value: unknown, actor: ReportActor, eventId: string, submittedAt: string, artefacts: readonly ArtefactRef[]): DecisionDraft {
  if (actor.kind !== "session") {
    refuse(
      "actor",
      `is ${actor.kind === "overseer" ? "the Overseer" : "Greg"}, and only a session's decision comes through a report — ` +
        "the Overseer and Greg record decisions with `overseer-decisions add`",
    );
  }
  const draft = record(value, "draft");
  if (Object.hasOwn(draft, "author")) refuse("draft.author", "is stamped by the daemon from the reporting session and the register; leave it out");
  if (Object.hasOwn(draft, "evidence")) {
    refuse("draft.evidence", "is the report's own artefacts; name each with --artefact (the CLI moves a template's evidence list there)");
  }
  exactKeys(draft, DRAFT_FIELDS, "draft.");
  const bearsOn = record(draft["bearsOn"], "draft.bearsOn");
  exactKeys(bearsOn, ["sessions", "plan"], "draft.bearsOn.");
  const names: unknown = bearsOn["sessions"];
  if (!Array.isArray(names)) refuse("draft.bearsOn.sessions", "is not a list of session names");
  const sessions = names.map((name: unknown, index): string => {
    if (typeof name !== "string" || !SESSION_NAME_RULE.test(name)) {
      refuse(`draft.bearsOn.sessions[${index}]`, "is not a session name: 1 to 64 letters, digits and . _ -");
    }
    return name;
  });
  const atReceipt: ExecutionRef = { kind: "unavailable", why: "resolved by the daemon at receipt" };
  const checked = parseEventDetailed(
    JSON.stringify(
      decidedEventFields({
        eventId,
        at: submittedAt,
        decisionId: PROVISIONAL_DECISION_ID,
        content: draft,
        plan: bearsOn["plan"],
        sessions: sessions.map((name) => ({ name, execution: atReceipt })),
        author: { kind: "session", name: actor.name, execution: atReceipt },
        evidence: artefacts.map((ref) => ({ ref, check: { state: "unchecked", why: "checked by the daemon at receipt" } })),
      }),
    ),
  );
  if (!checked.ok) refuse("draft", checked.why);
  const event = checked.event;
  if (event.kind !== "decided" || event.schema !== DECISIONS_SCHEMA) refuse("draft", "did not form a schema-2 decision");
  return {
    class: event.class,
    question: event.question,
    options: event.options,
    chose: event.chose,
    why: event.why,
    advisers: event.advisers,
    bearsOn: { sessions, plan: event.bearsOn.plan },
    supersedes: event.supersedes,
    consequence: event.consequence,
    reversibility: event.reversibility,
    domain: event.domain,
    recommendation: event.recommendation,
    gregAsked: event.gregAsked,
    confidence: event.confidence,
  };
}

/**
 * The draft a recorded decision was made from, rebuilt from the record — or
 * null when the record cannot say (a schema-1 line, which no report wrote).
 * How a re-dropped decision submission is told from a different claim.
 */
function draftOf(decision: DecisionRecord): DecisionDraft | null {
  const { consequence, reversibility, domain, recommendation, gregAsked, confidence } = decision;
  if (
    consequence === NOT_RECORDED ||
    reversibility === NOT_RECORDED ||
    domain === NOT_RECORDED ||
    recommendation.kind !== "recorded" ||
    gregAsked === NOT_RECORDED ||
    confidence === NOT_RECORDED
  ) {
    return null;
  }
  return {
    class: decision.class,
    question: decision.question,
    options: decision.options,
    chose: decision.chose,
    why: decision.why,
    advisers: decision.advisers,
    bearsOn: { sessions: decision.bearsOn.sessions.map((session) => session.name), plan: decision.bearsOn.plan },
    supersedes: decision.supersedes,
    consequence,
    reversibility,
    domain,
    recommendation: recommendation.value,
    gregAsked,
    confidence,
  };
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
      const draft = parseDraft(json["draft"], common.actor, common.eventId, common.submittedAt, head.artefacts);
      return { ok: true, submission: { ...head, kind: "decision", draft } };
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
      if (common.actor.kind !== "session") refuse("actor", "is not a session, and only a session's decision is recorded through reports");
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
 * The submission a recorded event was made from, as canonical text. Used to tell
 * a re-dropped submission (the same claim, one row) from a different claim under
 * a reused id. A decision report does not carry its draft, so the draft is
 * rebuilt from the decision it names — and null when that cannot be read.
 */
function submissionTextOf(event: ReportEvent, decisionsDir: string): string | null {
  const { receivedAt: _r, execution: _e, artefacts, ...rest } = event;
  const refs = artefacts.map((item) => item.ref);
  if (rest.kind !== "decision") return serializeSubmission({ ...rest, artefacts: refs } as ReportSubmission);
  const { decisionId, ...common } = rest;
  const read = readDecisions(decisionsDir);
  const decision = read.kind === "decisions" ? read.view.records.find((one) => one.id === decisionId) : undefined;
  const draft = decision === undefined ? null : draftOf(decision);
  if (draft === null) return null;
  try {
    return serializeSubmission({ ...common, artefacts: refs, draft } as ReportSubmission);
  } catch {
    return null;
  }
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
    if (stat.nlink !== 1) return { kind: "not-regular", why: `has ${stat.nlink} hard links rather than being a private submission file` };
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

/** A Buffer path too: the inbox scan names entries by their bytes. */
function unlinkQuietly(file: string | Buffer): void {
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
 * The frozen result of step [1]. For a decision, `decisionLine` is the whole
 * prepared `decided` event — its decision id, `decidedAt` (the report's
 * `receivedAt`), the session author with the execution the register gave at
 * receipt, the evidence checks, `by: daemon`, command id `report:<eventId>` —
 * as the exact bytes step [2] appends. A replay after a crash appends the same
 * line, which `appendEvents` recognises as already written (GPT Sol's WR-S2-2)
 * rather than calling it a conflict.
 */
export type PreparedReport = {
  readonly schema: typeof REPORTS_SCHEMA;
  readonly eventId: string;
  readonly reportLine: string;
  readonly decisionLine?: string;
};

/**
 * A prepared record, checked the same way on its first use and on a replay:
 * the report reads, it is this event's, and a decision report carries the
 * daemon's copy of exactly its own decision. Throws, which leaves it pending.
 */
function readPrepared(text: string, eventId: string): { prepared: PreparedReport; decision: DecisionEvent | null } {
  const prepared = JSON.parse(text) as PreparedReport;
  const reparsed = typeof prepared.reportLine === "string" ? parseReportEvent(prepared.reportLine) : null;
  if (prepared.eventId !== eventId || reparsed === null || !reparsed.ok || reparsed.event.eventId !== eventId) {
    throw new Error(`the prepared report ${eventId}.json does not hold a report for ${eventId}`);
  }
  const report = reparsed.event;
  if (report.kind !== "decision") {
    if (prepared.decisionLine !== undefined) throw new Error(`the prepared report ${eventId}.json holds a decision for a report that is not one`);
    return { prepared, decision: null };
  }
  if (typeof prepared.decisionLine !== "string") throw new Error(`the prepared decision report ${eventId}.json holds no decision`);
  const decision = parseEventDetailed(prepared.decisionLine);
  if (!decision.ok) throw new Error(`the prepared decision for ${eventId} does not read: ${decision.why}`);
  const event = decision.event;
  if (event.kind !== "decided" || event.by !== "daemon" || event.commandId !== reportCommandId(eventId) || event.id !== report.decisionId) {
    throw new Error(`the prepared decision for ${eventId} is not the daemon's copy of this report's decision`);
  }
  return { prepared, decision: event };
}

/**
 * Per pass; the rest waits. Sol's WR-P5: the file count alone bounded nothing
 * else. `scanEntries` bounds the directory listing itself — Sol's Stage 1
 * second review: a `readdirSync` of the whole inbox, a `stat` per entry and a
 * sort, all synchronous inside the daemon, is unbounded work however few files
 * are then read, and slicing the array afterwards bounds none of it. The same
 * cap bounds the start-of-pass look at `report-processing/` and the lost-log
 * count of both directories.
 */
export type DrainLimits = { files: number; bytes: number; probes: number; wallMs: number; scanEntries: number };
export const DEFAULT_DRAIN_LIMITS: DrainLimits = { files: 50, bytes: 1024 * 1024, probes: 200, wallMs: 5_000, scanEntries: 1_000 };

/** The step boundaries a test can crash at. Nothing in production passes `crashAt`. */
export type DrainBoundary = "processing-written" | "decision-appended" | "reports-appended" | "processing-unlinked";
export class SimulatedCrash extends Error {}

/** Only this failure requires the pass to stop so its next open can repair a torn tail. */
class AppendMayHaveTornTail extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "AppendMayHaveTornTail";
  }
}

export type DrainOptions = {
  root: string;
  /** The daemon's live register, for the execution comparison. */
  register: ReportRegister;
  /** Stamps `receivedAt` and dates refusals. The wall-clock bound uses the real clock. */
  now: () => Date;
  checkArtefact: ArtefactChecker;
  /**
   * Where step [2] appends a session's decision — `decisionsRoot(env)`, so
   * `OVERSEER_DECISIONS_DIR` is honoured. Required rather than defaulted: the
   * default would be the real record, and a test that forgot it would write there.
   */
  decisionsRoot: string;
  /** TEST SEAM for a torn/failed append. Production omits it and gets append + fsync. */
  appendReportLine?: (file: string, line: string) => void;
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
  /**
   * Entries left where they are: one that could not be moved to quarantine, or
   * one swapped for a non-regular file between the scan and the open. Never read.
   */
  skippedEntries: number;
  /** Inbox entries that can never become a report, moved to `report-quarantine/` this pass. */
  quarantined: number;
  /** Directory entries this pass read from the inbox — never more than `scanEntries`. */
  scanned: number;
  /** The scan stopped at `scanEntries`, so "oldest first" held only among the entries it read. */
  scanCapped: boolean;
  replayed: number;
  debrisRemoved: number;
  probes: number;
  bytesRead: number;
  stoppedBy: "files" | "bytes" | "probes" | "time" | null;
  /** One sentence per refused, pending or skipped item; one for all the quarantined. */
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
    quarantined: 0,
    scanned: 0,
    scanCapped: false,
    replayed: 0,
    debrisRemoved: 0,
    probes: 0,
    bytesRead: 0,
    stoppedBy: null,
    notes: [],
  };
}

type InboxCandidate = { readonly name: string; readonly eventId: string; readonly mtimeMs: number };

/** How many quarantined names a pass's note quotes; the count covers the rest. */
const QUARANTINE_EXAMPLES = 5;
/**
 * A quarantined name's prefix: when it was moved there, as 13 zero-padded epoch
 * milliseconds from the drain's clock. It is the entry's age, and `readInbox`
 * reads it back from the name, so nothing in the quarantine is ever `stat`-ed.
 * The sequence and random parts after it make each name unique. WR-S3-3's
 * process-monotonic stamp is gone: it kept name order equal to arrival order for
 * pruning, and nothing prunes, or reads that order, any more.
 */
function quarantineStamp(ms: number): string {
  return String(Math.min(9_999_999_999_999, Math.max(0, Math.trunc(ms)))).padStart(13, "0");
}
const QUARANTINE_STAMP_RULE = /^(\d{13})-/;

/**
 * **ONE BOUNDED LOOK AT THE INBOX.** Lazily, through `opendirSync`, stopping
 * after `cap` directory entries and closing the handle whatever happens. Among
 * what it read it returns the submissions to try; it removes abandoned temp
 * files, and it MOVES everything that can never become a report into
 * `report-quarantine/` — which is what stops a hostile or runaway prefix of junk
 * from filling every pass's window for ever: each pass clears the slice it read.
 *
 * Names are read as bytes: a name that is not UTF-8 decodes to a string that
 * names no file, and an entry no path can reach is one no pass could ever move.
 */
function scanInbox(inboxDir: string, quarantineDir: string, cap: number, nowMs: number, outcome: ReportDrainOutcome): InboxCandidate[] {
  const candidates: InboxCandidate[] = [];
  const examples: string[] = [];
  const prefix = Buffer.from(`${inboxDir}${path.sep}`);
  const stamp = quarantineStamp(nowMs);
  let moved = 0;
  // The types only admit string encodings; Node honours "buffer" and hands back Buffer names.
  const dir = opendirSync(inboxDir, { encoding: "buffer" as BufferEncoding });
  try {
    while (outcome.scanned < cap) {
      const entry = dir.readSync();
      if (entry === null) break;
      outcome.scanned += 1;
      const raw = entry.name as unknown as Buffer;
      const name = raw.toString("utf8");
      const full = Buffer.concat([prefix, raw]);
      let stat: Stats;
      try {
        stat = lstatSync(full);
      } catch {
        continue; // Renamed or removed under us.
      }
      const utf8 = Buffer.from(name, "utf8").equals(raw);
      const submissionName = utf8 ? INBOX_NAME_RULE.exec(name) : null;
      const tempName = utf8 && TMP_NAME_RULE.test(name);
      const why = !utf8
        ? "its name is not UTF-8"
        : submissionName === null && !tempName
          ? "not named <uuid>.json"
          : stat.isSymbolicLink()
            ? "a symbolic link"
            : stat.isDirectory()
              ? "a directory"
              : !stat.isFile()
                ? "not a regular file"
                : stat.nlink !== 1
                  ? `a file with ${stat.nlink} hard links`
                  : null;
      if (why !== null) {
        const label = PLAIN_NAME_RULE.test(name) ? `-${name}` : "";
        const target = path.join(quarantineDir, `${stamp}-${String(moved).padStart(7, "0")}-${randomUUID().slice(0, 8)}${label}`);
        try {
          renameSync(full, target);
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code === "ENOENT") continue;
          outcome.skippedEntries += 1;
          outcome.notes.push(`skipped ${printable(name).slice(0, 80)}: ${why}, and it could not be moved to ${QUARANTINE_DIR}/: ${String(cause)}`);
          continue;
        }
        moved += 1;
        outcome.quarantined += 1;
        if (examples.length < QUARANTINE_EXAMPLES) examples.push(`${printable(name).slice(0, 80)} (${why})`);
        continue;
      }
      if (tempName) {
        // A submitter's temp file. Young ones are mid-write and are left for their
        // writer; one an hour old was abandoned, and removing it is the only
        // deletion in the inbox of something that was never a submission.
        if (nowMs - stat.mtimeMs > TMP_DEBRIS_AGE_MS) {
          unlinkQuietly(full);
          outcome.debrisRemoved += 1;
        }
        continue;
      }
      candidates.push({ name, eventId: submissionName?.[1] ?? "", mtimeMs: stat.mtimeMs });
    }
    outcome.scanCapped = outcome.scanned >= cap;
  } finally {
    dir.closeSync();
  }
  if (moved > 0) {
    outcome.notes.push(
      `moved ${moved} inbox ${moved === 1 ? "entry" : "entries"} that can never become a report into ${QUARANTINE_DIR}/: ` +
        `${examples.join("; ")}${moved > examples.length ? "; …" : ""}`,
    );
  }
  if (outcome.scanCapped) {
    outcome.notes.push(`the inbox scan stopped at its cap of ${cap} entries; order is approximate beyond the first ${cap} entries`);
  }
  return candidates;
}

/** `<uuid>.json` names among a directory's first `cap` entries — for the lost-log answer, which must not list a flood either. */
function countUuidJson(directory: string, cap: number): { count: number; capped: boolean } {
  let count = 0;
  const { complete } = scanDirectory(directory, cap, (name) => {
    if (INBOX_NAME_RULE.test(name)) count += 1;
  });
  return { count, capped: !complete };
}

/** The register's run for a session name, compared with the token the submitter observed. */
export function compareExecution(actor: ReportActor, observed: string | null, register: ReportRegister): ExecutionComparison {
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

/**
 * The register's run for a session name, as the decision record stores it —
 * the same four answers `executionRefFor` gives the dashboard, from the
 * daemon's live register rather than a checkpoint.
 */
function executionRefIn(register: ReportRegister, name: string): ExecutionRef {
  const entries = [...register.values()].filter((entry) => entry.name === name);
  if (entries.length === 0) return { kind: "not-found" };
  if (entries.length > 1) return { kind: "unavailable", why: `session ${name} is ambiguous in the register (${entries.length} entries)` };
  const verified = entries[0]?.verifiedExecution ?? null;
  if (verified === null) return { kind: "unavailable", why: `the register has no verified execution for session ${name}` };
  return { kind: "verified", token: verified.token, since: verified.since };
}

/** The event's fields; `parseReportEvent` then gives it the one key order every recorded line uses. */
function buildEvent(
  submission: ReportSubmission,
  receivedAt: string,
  execution: ExecutionComparison,
  artefacts: readonly CheckedArtefact[],
  decisionId: string | null,
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
    case "decision":
      // The id only: the content is the decision record's, and one place holds it.
      return { ...head, decisionId };
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
  const quarantineDir = path.join(root, QUARANTINE_DIR);
  for (const dir of [inboxDir, processingDir, refusedDir, quarantineDir]) mkdirSync(dir, { recursive: true });

  const crash = (at: DrainBoundary): void => {
    if (options.crashAt === at) throw new SimulatedCrash(`simulated crash after ${at}`);
  };

  const log = openLog(root);
  if (log.kind === "lost") {
    const preparing = countUuidJson(processingDir, limits.scanEntries);
    const waiting = countUuidJson(inboxDir, limits.scanEntries);
    outcome.pending = preparing.count + waiting.count;
    outcome.notes.push(
      preparing.capped || waiting.capped
        ? `${log.why} (at least ${outcome.pending} waiting; ${PROCESSING_DIR}/ and the inbox were each counted only to ${limits.scanEntries} entries)`
        : log.why,
    );
    return outcome;
  }
  const recorded = log.recorded;
  const logFile = path.join(root, REPORTS_FILE);
  const appendReportLine =
    options.appendReportLine ??
    ((file: string, line: string): void => {
      const fd = openSync(file, "a");
      try {
        writeAll(fd, `${line}\n`);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    });

  /**
   * One refusal record, atomically, then the inputs go. Nothing is pruned: the
   * record replaces the inbox file it came from, and listing the directory to
   * prune it was the unbounded step (see `REFUSED_DIR`).
   */
  const refuseItem = (eventId: string, why: string, original: string, inputs: readonly string[]): void => {
    const body = { eventId, refusedAt: now().toISOString(), why, original: original.slice(0, MAX_SUBMISSION_BYTES) };
    const first = path.join(refusedDir, `${eventId}.json`);
    // A re-used event id is another refused attempt, not permission to destroy
    // the earlier diagnostic. The UUID suffix keeps both without listing the
    // directory; collisions are negligible under the documented same-user
    // (rather than hostile-OS-process) boundary.
    const refusalFile = existsSync(first) ? path.join(refusedDir, `${eventId}-${randomUUID()}.json`) : first;
    writeAtomically(refusalFile, refusedDir, `${JSON.stringify(body)}\n`);
    for (const input of inputs) unlinkQuietly(input);
    outcome.refused += 1;
    outcome.notes.push(`refused ${eventId}: ${why}`);
  };

  /** Steps [2], [3] and [4] for one prepared report — the same code for a first attempt and a replay. */
  const commit = (prepared: PreparedReport, decision: DecisionEvent | null, inboxFile: string, original: string): "recorded" | "refused" => {
    const processingFile = path.join(processingDir, `${prepared.eventId}.json`);
    const existing = recorded.get(prepared.eventId);
    if (existing === undefined) {
      if (decision !== null) {
        /* ---- [2] The frozen decided event into decisions.jsonl, under its own lock. ---- */
        const appended = appendEvents([decision], { root: options.decisionsRoot });
        if (!appended.ok) {
          // A held lock says nothing about the input: it waits. Every other
          // answer is the decision record refusing THIS decision, and says why.
          if (appended.code === "locked") throw new Error(`the decision record is busy, so this waits for the next pass: ${appended.why}`);
          refuseItem(prepared.eventId, `the decision record refused it (${appended.code}): ${appended.why}`, original, [processingFile, inboxFile]);
          return "refused";
        }
        crash("decision-appended");
      }
      writeInitMarker(root);
      try {
        appendReportLine(logFile, prepared.reportLine);
      } catch (cause) {
        throw new AppendMayHaveTornTail(cause);
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

  /* ---- Start of pass: replay prepared reports with their frozen bytes — at most
     `scanEntries` of them, read lazily. These files are the daemon's own, so
     there is no quarantine step, only the bound; the rest wait for later passes,
     and the inbox loop below leaves any inbox copy of theirs alone. ---- */
  const toReplay: string[] = [];
  const replayScan = scanDirectory(processingDir, limits.scanEntries, (name) => {
    if (INBOX_NAME_RULE.test(name)) toReplay.push(name);
  });
  if (!replayScan.complete) {
    outcome.notes.push(`the replay of ${PROCESSING_DIR}/ stopped at its cap of ${limits.scanEntries} entries; the rest are replayed on later passes`);
  }
  const inFlight = new Set<string>();
  for (const name of toReplay) {
    const eventId = name.slice(0, -".json".length);
    const inboxFile = path.join(inboxDir, name);
    try {
      const processingFile = path.join(processingDir, name);
      const read = readBounded(processingFile, MAX_PREPARED_BYTES);
      if (read.kind === "gone") continue;
      if (read.kind === "not-regular") throw new Error(read.why);
      if (read.kind === "oversize") throw new Error(`is ${read.size} bytes, over the ${MAX_PREPARED_BYTES}-byte prepared-report limit`);
      const { prepared, decision } = readPrepared(read.text, eventId);
      const result = commit(prepared, decision, inboxFile, prepared.reportLine);
      if (result === "recorded") outcome.replayed += 1;
    } catch (cause) {
      if (cause instanceof SimulatedCrash) throw cause;
      inFlight.add(eventId);
      outcome.pending += 1;
      outcome.notes.push(`pending ${eventId}: its prepared report could not be replayed: ${cause instanceof Error ? cause.message : String(cause)}`);
      if (cause instanceof AppendMayHaveTornTail) {
        // Only a failed append may have left a torn tail. The next pass repairs
        // it before another append; every other stuck item must not starve later work.
        return outcome;
      }
    }
  }

  /* ---- The inbox: a bounded slice of it, oldest first among what was read. ---- */
  const candidates = scanInbox(inboxDir, quarantineDir, limits.scanEntries, now().getTime(), outcome);
  for (const candidate of candidates) inFlight.add(candidate.eventId);
  candidates.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
  /** Still waiting to be recorded — asked of the file, because the scan saw only part of the inbox. */
  const waiting = (eventId: string): boolean =>
    inFlight.has(eventId) || existsSync(path.join(inboxDir, `${eventId}.json`)) || existsSync(path.join(processingDir, `${eventId}.json`));

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
    // Always admit one bounded file: otherwise time spent opening the log or
    // listing the inbox can defer the oldest legal submission on every pass.
    // Its artefact loop below starts no probes once the deadline has elapsed.
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
      if (outcome.bytesRead + read.bytes > limits.bytes) {
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
      const existing = recorded.get(eventId);
      if (existing !== undefined) {
        const earlier = parseReportEvent(existing);
        const earlierText = earlier.ok ? submissionTextOf(earlier.event, options.decisionsRoot) : null;
        if (earlierText === JSON.stringify(submission)) {
          unlinkQuietly(inboxFile);
          outcome.duplicates += 1;
          continue;
        }
        refuseItem(
          eventId,
          earlierText === null
            ? `event id ${eventId} is already recorded, and what it recorded could not be read back to compare with this`
            : `event id ${eventId} is already recorded with different content`,
          read.text,
          [inboxFile],
        );
        continue;
      }
      if (submission.corrects !== null && !recorded.has(submission.corrects)) {
        if (waiting(submission.corrects)) {
          outcome.pending += 1;
          outcome.notes.push(`pending ${eventId}: it corrects ${submission.corrects}, which is not recorded yet`);
          continue;
        }
        refuseItem(eventId, `corrects ${submission.corrects}, which is not a recorded report`, read.text, [inboxFile]);
        continue;
      }
      if (outcome.probes + submission.artefacts.length > limits.probes) {
        stopAt("probes");
        break;
      }

      const artefacts: CheckedArtefact[] = [];
      let wallLimitReached = false;
      for (let artefactIndex = 0; artefactIndex < submission.artefacts.length; artefactIndex += 1) {
        const ref = submission.artefacts[artefactIndex];
        if (ref === undefined) continue;
        if (Date.now() - startedMs >= limits.wallMs) {
          wallLimitReached = true;
          const why = "the report drain reached its wall-clock limit before this reference could be checked";
          for (const unchecked of submission.artefacts.slice(artefactIndex)) {
            artefacts.push({ ref: unchecked, check: { state: "unchecked", why } });
          }
          break;
        }
        outcome.probes += 1;
        artefacts.push({ ref, check: options.checkArtefact(ref) });
      }
      const receivedAt = now().toISOString();
      const decisionId = submission.kind === "decision" ? mintId() : null;
      const execution = compareExecution(submission.actor, submission.observedExecution, options.register);
      const built = buildEvent(submission, receivedAt, execution, artefacts, decisionId);
      const check = parseReportEvent(JSON.stringify(built));
      if (!check.ok) {
        // Our bytes, so this is a checker or builder bug — not the submitter's fault, not a refusal.
        throw new Error(`the prepared report does not read back: ${check.why}`);
      }
      // THE PARSER'S OUTPUT IS THE CANONICAL FORM, so these are the bytes every retry and every reader agrees on.
      const line = JSON.stringify(check.event);
      let prepared: PreparedReport = { schema: REPORTS_SCHEMA, eventId, reportLine: line };
      if (submission.kind === "decision" && decisionId !== null) {
        const { actor, draft } = submission;
        if (actor.kind !== "session") throw new Error("a decision report whose actor is not a session passed the parser");
        // Frozen here, once: the author's and each session's execution as the
        // register gives them NOW, and the evidence checks this pass just made.
        const decided = parseEventDetailed(
          JSON.stringify(
            decidedEventFields({
              eventId,
              at: receivedAt,
              decisionId,
              content: draft,
              plan: draft.bearsOn.plan,
              sessions: draft.bearsOn.sessions.map((name) => ({ name, execution: executionRefIn(options.register, name) })),
              author: { kind: "session", name: actor.name, execution: executionRefIn(options.register, actor.name) },
              evidence: artefacts,
            }),
          ),
        );
        if (!decided.ok) throw new Error(`the prepared decision does not read back: ${decided.why}`);
        prepared = { ...prepared, decisionLine: JSON.stringify(decided.event) };
      }
      const preparedText = `${JSON.stringify(prepared)}\n`;
      if (Buffer.byteLength(preparedText, "utf8") > MAX_PREPARED_BYTES) {
        refuseItem(eventId, `its prepared record would be over the ${MAX_PREPARED_BYTES}-byte limit a replay reads`, read.text, [inboxFile]);
        continue;
      }
      writeAtomically(path.join(processingDir, `${eventId}.json`), processingDir, preparedText);
      crash("processing-written");

      /* ---- [2], [3] and [4], through the same checks a replay makes. ---- */
      const frozen = readPrepared(preparedText, eventId);
      if (commit(frozen.prepared, frozen.decision, inboxFile, read.text) === "recorded") outcome.recorded += 1;
      if (wallLimitReached) {
        outcome.stoppedBy = "time";
        outcome.deferred = candidates.length - index - 1;
        break;
      }
    } catch (cause) {
      if (cause instanceof SimulatedCrash) throw cause;
      outcome.pending += 1;
      outcome.notes.push(`pending ${eventId}: ${cause instanceof Error ? cause.message : String(cause)}`);
      if (cause instanceof AppendMayHaveTornTail) {
        // The next pass's opening repair must run before another append.
        return outcome;
      }
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

/**
 * A count, and whether it is all of them: `exact` when the reader reached the
 * end of the directory, `atLeast` when it stopped at its cap. **Never a bare
 * number**, which anyone reading it would take for the whole count when it was a
 * part.
 */
export type BoundedCount = { readonly exact: number } | { readonly atLeast: number };

export function countValue(count: BoundedCount): number {
  return "exact" in count ? count.exact : count.atLeast;
}

/** Exact only when both are. */
export function addCounts(a: BoundedCount, b: BoundedCount): BoundedCount {
  const total = countValue(a) + countValue(b);
  return "exact" in a && "exact" in b ? { exact: total } : { atLeast: total };
}

/** One directory's matching entries: how many there are, and those read — at most `parseFiles`, so the list is not the count. */
export type Listed<T> = { readonly items: readonly T[]; readonly count: BoundedCount };

/**
 * How big `report-quarantine/` has grown; it grows until a person empties it.
 * `oldestMovedAt` is read from the names, never from the entries. With an
 * `atLeast` count it is the oldest SEEN. Null when no entry seen carries a stamp.
 */
export type QuarantineSummary = { readonly path: string; readonly count: BoundedCount; readonly oldestMovedAt: string | null };

export type InboxListing = {
  /** Submissions waiting in the inbox. */
  readonly inFlight: Listed<InboxItem>;
  readonly processing: Listed<ProcessingItem>;
  /** Newest first, among those read. */
  readonly refused: Listed<RefusedItem>;
  /** Entries in the inbox that are not submissions at all; the next pass quarantines them. */
  readonly skippedEntries: BoundedCount;
  readonly quarantine: QuarantineSummary;
};

/** Per directory, per call: the drain's own scan window, and a cap on the files opened. */
export type InboxReadLimits = { scanEntries: number; parseFiles: number };
export const DEFAULT_INBOX_READ_LIMITS: InboxReadLimits = { scanEntries: DEFAULT_DRAIN_LIMITS.scanEntries, parseFiles: 200 };

function counted(n: number, complete: boolean): BoundedCount {
  return complete ? { exact: n } : { atLeast: n };
}

/**
 * **One bounded look at a directory**: lazily, at most `cap` entries, then one
 * read more to learn whether that was all of them — so a directory of exactly
 * `cap` entries is still exact. Hands each name to `visit` and opens nothing. An
 * absent directory is an empty one.
 */
function scanDirectory(directory: string, cap: number, visit: (name: string) => void): { complete: boolean } {
  let dir: Dir;
  try {
    dir = opendirSync(directory);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { complete: true };
    throw cause;
  }
  try {
    for (let seen = 0; seen < cap; seen += 1) {
      const entry = dir.readSync();
      if (entry === null) return { complete: true };
      visit(entry.name);
    }
    return { complete: dir.readSync() === null };
  } finally {
    dir.closeSync();
  }
}

/**
 * What has not been recorded — submitted, mid-flight, refused and why — and how
 * big the quarantine is. Read-only, and **bounded** (GPT Sol's WR-S3-5): the
 * dashboard calls this on every `GET /api/reports`, so each directory is read
 * lazily to at most `scanEntries` entries, at most `parseFiles` files are opened
 * in each, and every count says whether it was capped. `report-quarantine/` is
 * listed, never opened.
 */
export function readInbox(root: string, limits: Partial<InboxReadLimits> = {}): InboxListing {
  const { scanEntries, parseFiles } = { ...DEFAULT_INBOX_READ_LIMITS, ...limits };

  const inboxDir = path.join(root, INBOX_DIR);
  const submitted: string[] = [];
  let notSubmissions = 0;
  const inboxScan = scanDirectory(inboxDir, scanEntries, (name) => {
    if (INBOX_NAME_RULE.test(name)) submitted.push(name);
    else if (!TMP_NAME_RULE.test(name)) notSubmissions += 1;
  });
  const inFlight: InboxItem[] = [];
  /** Named like a submission, and found not to be one — recorded since the scan, or not a regular file. */
  let notWaiting = 0;
  for (const name of submitted.sort().slice(0, parseFiles)) {
    const eventId = name.slice(0, -".json".length);
    const read = readBounded(path.join(inboxDir, name));
    if (read.kind === "gone") {
      notWaiting += 1;
      continue;
    }
    if (read.kind === "not-regular") {
      notWaiting += 1;
      notSubmissions += 1;
      continue;
    }
    if (read.kind === "oversize") {
      inFlight.push({ eventId, submission: null, why: `over the ${MAX_SUBMISSION_BYTES}-byte limit; the daemon will refuse it` });
      continue;
    }
    const parsed = parseSubmission(read.text);
    inFlight.push(parsed.ok ? { eventId, submission: parsed.submission, why: null } : { eventId, submission: null, why: `unreadable, the daemon will refuse it: ${parsed.why}` });
  }

  const preparing: string[] = [];
  const processingScan = scanDirectory(path.join(root, PROCESSING_DIR), scanEntries, (name) => {
    if (INBOX_NAME_RULE.test(name)) preparing.push(name);
  });
  const processing = preparing.sort().slice(0, parseFiles).map((name): ProcessingItem => {
    const eventId = name.slice(0, -".json".length);
    try {
      const read = readBounded(path.join(root, PROCESSING_DIR, name), MAX_PREPARED_BYTES);
      if (read.kind === "gone") return { eventId, event: null, why: "its prepared report disappeared while it was listed" };
      if (read.kind === "not-regular") return { eventId, event: null, why: read.why };
      if (read.kind === "oversize") return { eventId, event: null, why: `over the ${MAX_PREPARED_BYTES}-byte prepared-report limit` };
      const prepared = JSON.parse(read.text) as { reportLine?: unknown };
      const parsed = typeof prepared.reportLine === "string" ? parseReportEvent(prepared.reportLine) : null;
      return parsed?.ok === true ? { eventId, event: parsed.event, why: null } : { eventId, event: null, why: "its prepared report does not read" };
    } catch (cause) {
      return { eventId, event: null, why: `could not read its prepared report: ${String(cause)}` };
    }
  });
  const refusals: { readonly name: string; readonly eventId: string }[] = [];
  const refusedScan = scanDirectory(path.join(root, REFUSED_DIR), scanEntries, (name) => {
    const match = REFUSED_NAME_RULE.exec(name);
    if (match !== null) refusals.push({ name, eventId: match[1] ?? "" });
  });
  const refused: RefusedItem[] = [];
  let refusalsGone = 0;
  for (const { name, eventId } of refusals.sort((a, b) => a.name.localeCompare(b.name)).slice(0, parseFiles)) {
    try {
      const read = readBounded(path.join(root, REFUSED_DIR, name), MAX_REFUSAL_BYTES);
      if (read.kind === "gone") {
        refusalsGone += 1;
        continue;
      }
      if (read.kind !== "text") {
        refused.push({ eventId, refusedAt: "an unrecorded time", why: "the refusal record could not be read safely" });
        continue;
      }
      const body = JSON.parse(read.text) as Record<string, unknown>;
      const rawAt = body["refusedAt"];
      const refusedAt =
        typeof rawAt === "string" && !Number.isNaN(Date.parse(rawAt)) && new Date(rawAt).toISOString() === rawAt
          ? rawAt
          : "an unrecorded time";
      refused.push({
        eventId,
        refusedAt,
        why: typeof body["why"] === "string" ? printable(body["why"]) : "no reason was recorded",
      });
    } catch {
      refused.push({ eventId, refusedAt: "an unrecorded time", why: "the refusal record could not be read" });
    }
  }
  refused.sort((a, b) => b.refusedAt.localeCompare(a.refusedAt));

  const quarantineDir = path.join(root, QUARANTINE_DIR);
  let quarantined = 0;
  let oldestMs = Number.POSITIVE_INFINITY;
  const quarantineScan = scanDirectory(quarantineDir, scanEntries, (name) => {
    quarantined += 1;
    const stamp = QUARANTINE_STAMP_RULE.exec(name)?.[1];
    if (stamp !== undefined) oldestMs = Math.min(oldestMs, Number(stamp));
  });

  return {
    inFlight: { items: inFlight, count: counted(submitted.length - notWaiting, inboxScan.complete) },
    processing: { items: processing, count: counted(preparing.length, processingScan.complete) },
    refused: { items: refused, count: counted(refusals.length - refusalsGone, refusedScan.complete) },
    skippedEntries: counted(notSubmissions, inboxScan.complete),
    quarantine: {
      path: quarantineDir,
      count: counted(quarantined, quarantineScan.complete),
      // Thirteen digits is at most the year 2286, inside the range a Date can hold.
      oldestMovedAt: Number.isFinite(oldestMs) ? new Date(oldestMs).toISOString() : null,
    },
  };
}
