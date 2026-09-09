/**
 * DECISIONS MADE — the append-only record that makes delegated judgement reviewable.
 *
 * Greg, 2026-09-09: *"For low-stakes decisions, I'm probably fine with you
 * making the decision on my behalf ... That way you're not blocked, the fleet
 * is empowered, and I still have visibility."*
 *
 * **The record is the other half of that permission.** It is not incidental
 * telemetry. A decision with no alternatives or no reason cannot be reviewed,
 * and a decision made to look reviewed by anybody but Greg defeats the bargain
 * while leaving a reassuring page behind. The plan is
 * [260909e](../../docs/plans/260909e-decisions-made-the-overseer-decision-record-its-cli-and-its-dashboard-mode.md).
 *
 * ## Why events rather than mutable rows
 *
 * Rewriting a JSON array would be shorter, but it would turn "reviewed" into a
 * boolean with no author and let two writers erase one another. These are
 * append-only events, folded into records, for the same reason the sibling
 * [`idea-queue.ts`](./idea-queue.ts) is: the provenance and serial history are
 * the feature. The costs of that choice are paid here rather than hand-waved —
 * a strict envelope, a per-event parser, transition validation, an idempotency
 * key that is consumed, and an opaque version checked under a lock.
 *
 * [`jsonl.ts`](./jsonl.ts) owns how bytes are repaired and appended;
 * [`lock.ts`](./lock.ts) owns exclusion. This module reuses both rather than
 * writing the tempting, smaller versions of either rule for a third time.
 *
 * ## Nothing but Greg makes a decision look reviewed
 *
 * The check lives in `foldDecisions`, not in the CLI. There are three entrances
 * to this file — the CLI, the later route, and a hand edit — and a writer-side
 * check guards only one of them. A `reviewed` or `reversed` event recorded by
 * the Overseer is therefore a problem and leaves the row unchanged. Reversal
 * also implies review: Greg cannot reverse a decision without having seen it.
 *
 * **This is governance, not an operating-system boundary.** The envelope's
 * `by` is a self-declaration. Anything running as this Unix user can append a
 * line that says `by: "greg"`, just as it could alter the Markdown record this
 * replaces. Claiming stronger identity here would be worse than naming the
 * limit; a device-scoped write boundary is a separate, still-open decision.
 *
 * Every `decided` row in V1 is Overseer-originated. That is a schema invariant,
 * not a per-row `decidedBy` field: an `assumption` unblocks work under Greg's
 * standing decision, so saying the Overseer decided it would be false. The
 * envelope's `by` says only who wrote the line.
 *
 * A verified session reference is the register's last verified run for that
 * name as of the checkpoint. `verifiedExecution` is sticky through observations
 * that cannot verify a run, which is why its `since` travels with the token. An
 * absent, unreadable, or stale checkpoint and an ambiguous name are
 * `unavailable`, never `not-found`. The token makes later event-log measurement
 * joinable off the request path, not correct: that can yield observed
 * run-lifetime, still not work attributable to this decision.
 *
 * ## A corrupt record must not read as an empty one
 *
 * This file is original human input, not disposable cache. The initialisation
 * marker distinguishes never used from lost or truncated, parse failures are
 * collected as visible problems, and `readDecisions` keeps `never-written`,
 * `decisions`, and `unreadable` as three different arms. A plausible short list
 * over a line this build skipped is exactly the silent success this record must
 * refuse to manufacture.
 */
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { QueueActor } from "../fleet/wire.js";
import { truncateToLastLine, writeAll, type JsonlRepair } from "./jsonl.js";
import { describeLockRefusal, releaseLock, stillOurs, takeLock, type HeldLock } from "./lock.js";

/** Bumped only when an earlier reader could not safely ignore the change. */
export const DECISIONS_SCHEMA = 1;
export const DECISIONS_FILE = "decisions.jsonl";
export const DECISIONS_LOCK_FILE = "decisions.lock";

/**
 * Proof outside the replaceable log that a decision record has existed.
 *
 * Once this marker exists, an absent or empty log is lost input, not a fresh
 * start. Its contents are explanatory only; existence is the signal.
 */
export const DECISIONS_INIT_FILE = "decisions.created";

export type DecisionClass = "assumption" | "decision" | "decline";
export type Adviser = "sol" | "fable" | "nobody";
export type DecisionOption = { readonly name: string; readonly tradeoffs: string };
export type DecisionChoice = { readonly option: string; readonly note: string | null };
export type ExecutionRef =
  | { readonly kind: "verified"; readonly token: string; readonly since: string }
  | { readonly kind: "not-found" }
  | { readonly kind: "unavailable"; readonly why: string };
export type SessionRef = { readonly name: string; readonly execution: ExecutionRef };
export type BearsOn = { readonly sessions: readonly SessionRef[]; readonly plan: string | null };

/** The same two recorders the queue admits; this is who recorded, not who decided. */
export type DecisionActor = QueueActor;
export const DECISION_ACTORS: readonly DecisionActor[] = ["greg", "overseer"];

export type Envelope = {
  readonly schema: typeof DECISIONS_SCHEMA;
  readonly eventId: string;
  readonly commandId: string | null;
  readonly at: string;
  /** Who recorded this line; every decision's Overseer origin is invariant. */
  readonly by: DecisionActor;
};

export type DecisionEvent = Envelope &
  (
    | {
        readonly kind: "decided";
        readonly id: string;
        readonly decidedAt: string;
        readonly class: DecisionClass;
        readonly question: string;
        readonly options: readonly DecisionOption[];
        readonly chose: DecisionChoice;
        readonly why: string;
        readonly advisers: readonly Adviser[];
        readonly bearsOn: BearsOn;
        readonly supersedes: string | null;
      }
    | { readonly kind: "reviewed"; readonly id: string; readonly note: string | null }
    | { readonly kind: "reversed"; readonly id: string; readonly why: string | null }
  );

export type DecisionEventKind = DecisionEvent["kind"];

/** One accepted event in a record's own, oldest-first history. */
export type DecisionTouch = {
  readonly kind: DecisionEventKind;
  readonly at: string;
  readonly by: DecisionActor;
  readonly what: string;
};

export type DecisionProblemKind =
  | "unreadable-line"
  | "unauthorized-review"
  | "duplicate-decision"
  | "unknown-decision"
  | "duplicate-event"
  | "command-conflict"
  | "invalid-supersession"
  | "illegal-transition";

/** Collected rather than thrown: one bad line must not take down the whole reader. */
export type DecisionProblem = {
  readonly kind: DecisionProblemKind;
  readonly why: string;
  readonly eventId: string | null;
};

/** A decision as replay leaves it; the source fields are never amended in V1. */
export type DecisionRecord = {
  readonly id: string;
  /** Who wrote the `decided` line. V1's Overseer origin is invariant. */
  readonly recordedBy: DecisionActor;
  readonly class: DecisionClass;
  readonly question: string;
  readonly options: readonly DecisionOption[];
  readonly chose: DecisionChoice;
  readonly why: string;
  readonly advisers: readonly Adviser[];
  readonly bearsOn: BearsOn;
  readonly decidedAt: string;
  readonly supersedes: string | null;
  readonly supersededBy: string | null;
  readonly reviewed: boolean;
  readonly reviewedAt: string | null;
  readonly reviewNote: string | null;
  readonly reversed: boolean;
  readonly reversedAt: string | null;
  readonly reversedWhy: string | null;
  readonly touches: readonly DecisionTouch[];
};

/** An opaque token naming the parseable history a client saw. */
export type DecisionVersion = { readonly events: number; readonly lastEventId: string | null };
export const VERSION_ZERO: DecisionVersion = { events: 0, lastEventId: null };

export function sameVersion(a: DecisionVersion, b: DecisionVersion): boolean {
  return a.events === b.events && a.lastEventId === b.lastEventId;
}

export function spellVersion(version: DecisionVersion): string {
  return version.lastEventId === null ? `${version.events}` : `${version.events}.${version.lastEventId}`;
}

export function parseVersion(text: string): DecisionVersion | null {
  // Number("") is zero. An omitted version must not masquerade as a client
  // that looked and saw the empty record.
  if (text.trim() === "") return null;
  const dot = text.indexOf(".");
  const count = Number(dot === -1 ? text : text.slice(0, dot));
  if (!Number.isInteger(count) || count < 0) return null;
  if (dot === -1) return count === 0 ? VERSION_ZERO : null;
  const lastEventId = text.slice(dot + 1);
  return lastEventId === "" ? null : { events: count, lastEventId };
}

export type DecisionView = {
  readonly schema: typeof DECISIONS_SCHEMA;
  /** In the order their accepted `decided` events appeared in the log. */
  readonly records: readonly DecisionRecord[];
  readonly problems: readonly DecisionProblem[];
  readonly version: DecisionVersion;
};

export const EMPTY_VIEW: DecisionView = {
  schema: DECISIONS_SCHEMA,
  records: [],
  problems: [],
  version: VERSION_ZERO,
};

type MutableDecision = {
  id: string;
  recordedBy: DecisionActor;
  class: DecisionClass;
  question: string;
  options: DecisionOption[];
  chose: DecisionChoice;
  why: string;
  advisers: Adviser[];
  bearsOn: { sessions: SessionRef[]; plan: string | null };
  decidedAt: string;
  supersedes: string | null;
  supersededBy: string | null;
  reviewed: boolean;
  reviewedAt: string | null;
  reviewNote: string | null;
  reversed: boolean;
  reversedAt: string | null;
  reversedWhy: string | null;
  touches: DecisionTouch[];
};

function describeTouch(event: DecisionEvent): string {
  switch (event.kind) {
    case "decided":
      return `${event.class} decided`;
    case "reviewed":
      return event.note === null ? "reviewed" : `reviewed: ${event.note}`;
    case "reversed":
      return event.why === null ? "reversed" : `reversed: ${event.why}`;
  }
}

/** Stable schema order makes "same bytes apart from eventId" independent of object insertion order. */
function commandPayload(event: DecisionEvent): string {
  /* **`at` IS DELIBERATELY ABSENT.** A retry is the same intent written LATER, so
     folding the envelope clock into this comparison makes every retry a conflict
     and leaves the retry arm unreachable — the idempotency key would then buy
     nothing it was added for. What the decision was ABOUT is `decidedAt`, which
     is in the per-kind fields below and does separate two different intents. */
  const common = {
    schema: event.schema,
    commandId: event.commandId,
    by: event.by,
    kind: event.kind,
    id: event.id,
  };
  switch (event.kind) {
    case "decided":
      return JSON.stringify({
        ...common,
        decidedAt: event.decidedAt,
        class: event.class,
        question: event.question,
        options: event.options,
        chose: event.chose,
        why: event.why,
        advisers: event.advisers,
        bearsOn: event.bearsOn,
        supersedes: event.supersedes,
      });
    case "reviewed":
      return JSON.stringify({ ...common, note: event.note });
    case "reversed":
      return JSON.stringify({ ...common, why: event.why });
  }
}

function sameCommandPayload(a: DecisionEvent, b: DecisionEvent): boolean {
  return commandPayload(a) === commandPayload(b);
}

/**
 * Replay events into records without throwing.
 *
 * A rejected transition never partially edits a row. In particular, the
 * authorization check precedes every review mutation, and an unknown id never
 * gets a placeholder row: a side-effect-created row would turn corrupt history
 * into a decision that looks sparse but real.
 */
export function foldDecisions(
  events: readonly DecisionEvent[],
  seedProblems: readonly DecisionProblem[] = [],
): DecisionView {
  const records = new Map<string, MutableDecision>();
  const order: string[] = [];
  const problems: DecisionProblem[] = [...seedProblems];
  const eventIds = new Set<string>();
  const commands = new Map<string, DecisionEvent>();
  let lastEventId: string | null = null;

  const problem = (kind: DecisionProblemKind, why: string, eventId: string | null): void => {
    problems.push({ kind, why, eventId });
  };

  for (const event of events) {
    lastEventId = event.eventId;

    /* Event identity comes first: a repeated command must never mask two lines
       claiming the same event id. Only then can identical payload be a retry. */
    if (eventIds.has(event.eventId)) {
      problem("duplicate-event", `event id ${event.eventId} appears more than once; the later event was ignored`, event.eventId);
      continue;
    }
    eventIds.add(event.eventId);
    if (event.commandId !== null) {
      const original = commands.get(event.commandId);
      if (original !== undefined) {
        if (sameCommandPayload(original, event)) continue;
        problem(
          "command-conflict",
          `command id ${event.commandId} was reused with a different payload; the later event was ignored`,
          event.eventId,
        );
        continue;
      }
      commands.set(event.commandId, event);
    }

    if (event.kind === "decided") {
      if (Date.parse(event.decidedAt) > Date.parse(event.at)) {
        problem(
          "illegal-transition",
          `${event.id} was decided at ${event.decidedAt}, after its line was written at ${event.at}`,
          event.eventId,
        );
        continue;
      }
      let superseded: MutableDecision | undefined;
      if (event.supersedes !== null) {
        if (event.supersedes === event.id) {
          problem("invalid-supersession", `${event.id} cannot supersede itself`, event.eventId);
          continue;
        }
        superseded = records.get(event.supersedes);
        if (superseded === undefined) {
          problem(
            "invalid-supersession",
            `${event.id} supersedes ${event.supersedes}, which is not an existing decision`,
            event.eventId,
          );
          continue;
        }
        if (Date.parse(superseded.decidedAt) >= Date.parse(event.decidedAt)) {
          problem(
            "invalid-supersession",
            `${event.id} cannot supersede ${event.supersedes}, which was not decided earlier`,
            event.eventId,
          );
          continue;
        }
        if (superseded.supersededBy !== null) {
          problem(
            "invalid-supersession",
            `${event.supersedes} was already superseded by ${superseded.supersededBy}`,
            event.eventId,
          );
          continue;
        }
        let ancestor: MutableDecision | undefined = superseded;
        while (ancestor !== undefined && ancestor.id !== event.id) {
          ancestor = ancestor.supersedes === null ? undefined : records.get(ancestor.supersedes);
        }
        if (ancestor !== undefined) {
          problem("invalid-supersession", `superseding ${event.supersedes} with ${event.id} would make a cycle`, event.eventId);
          continue;
        }
      }
      if (records.has(event.id)) {
        // Never last-one-wins: that would replace the question and rationale
        // while retaining whatever review state the first record acquired.
        problem("duplicate-decision", `${event.id} was decided twice; the second event was ignored`, event.eventId);
        continue;
      }
      records.set(event.id, {
        id: event.id,
        recordedBy: event.by,
        class: event.class,
        question: event.question,
        options: event.options.map((option) => ({ ...option })),
        chose: { ...event.chose },
        why: event.why,
        advisers: [...event.advisers],
        bearsOn: {
          sessions: event.bearsOn.sessions.map((session) => ({ name: session.name, execution: { ...session.execution } })),
          plan: event.bearsOn.plan,
        },
        decidedAt: event.decidedAt,
        supersedes: event.supersedes,
        supersededBy: null,
        reviewed: false,
        reviewedAt: null,
        reviewNote: null,
        reversed: false,
        reversedAt: null,
        reversedWhy: null,
        touches: [{ kind: "decided", at: event.at, by: event.by, what: describeTouch(event) }],
      });
      if (superseded !== undefined) superseded.supersededBy = event.id;
      order.push(event.id);
      continue;
    }

    const record = records.get(event.id);
    if (record === undefined) {
      problem("unknown-decision", `${event.kind} names ${event.id}, which was never decided`, event.eventId);
      continue;
    }
    if (event.by !== "greg") {
      // Gate 1's centre: neither the CLI nor the later route gets to decide
      // this. All entrances meet here, including a hand-edited line.
      problem(
        "unauthorized-review",
        `${event.by} tried to record ${event.kind} for ${event.id}; only Greg may make a decision look reviewed`,
        event.eventId,
      );
      continue;
    }
    if (Date.parse(event.at) < Date.parse(record.decidedAt)) {
      problem(
        "illegal-transition",
        `${event.kind} for ${event.id} is dated ${event.at}, before it was decided at ${record.decidedAt}`,
        event.eventId,
      );
      continue;
    }
    if (record.reversed) {
      problem(
        "illegal-transition",
        `${event.kind} for ${event.id} came after its reversal; reversed is terminal`,
        event.eventId,
      );
      continue;
    }

    if (event.kind === "reviewed") {
      /* **A SECOND REVIEW IS A PROBLEM, NOT AN UPDATE.** Overwriting would move
         the review's instant and note onto a later duplicate, and — because
         `trailingSevenDays.reviews` counts reviewed TOUCHES — would report a
         review that never happened. The first one is what Greg actually did. */
      if (record.reviewed) {
        problem(
          "illegal-transition",
          `${event.id} was already reviewed at ${record.reviewedAt ?? "an unrecorded time"}; the later review was ignored`,
          event.eventId,
        );
        continue;
      }
      record.reviewed = true;
      record.reviewedAt = event.at;
      record.reviewNote = event.note;
      record.touches.push({ kind: event.kind, at: event.at, by: event.by, what: describeTouch(event) });
      continue;
    }

    record.reviewed = true;
    // Reversal is proof Greg saw it. Keep one timestamp for the explicit review
    // state and the reversal timestamp for what actually happened.
    record.reviewedAt = event.at;
    record.reversed = true;
    record.reversedAt = event.at;
    record.reversedWhy = event.why;
    record.touches.push({ kind: event.kind, at: event.at, by: event.by, what: describeTouch(event) });
  }

  const freeze = (record: MutableDecision): DecisionRecord => ({
    id: record.id,
    recordedBy: record.recordedBy,
    class: record.class,
    question: record.question,
    options: record.options,
    chose: record.chose,
    why: record.why,
    advisers: record.advisers,
    bearsOn: record.bearsOn,
    decidedAt: record.decidedAt,
    supersedes: record.supersedes,
    supersededBy: record.supersededBy,
    reviewed: record.reviewed,
    reviewedAt: record.reviewedAt,
    reviewNote: record.reviewNote,
    reversed: record.reversed,
    reversedAt: record.reversedAt,
    reversedWhy: record.reversedWhy,
    touches: record.touches,
  });

  return {
    schema: DECISIONS_SCHEMA,
    records: order.flatMap((id) => {
      const record = records.get(id);
      return record === undefined ? [] : [freeze(record)];
    }),
    problems,
    version: { events: events.length, lastEventId },
  };
}

/* ------------------------------------------------------------------ *
 * Parsing. A field with the wrong type is never the same as an absent one.
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function asActor(value: unknown): DecisionActor | null {
  return value === "greg" || value === "overseer" ? value : null;
}

function asClass(value: unknown): DecisionClass | null {
  return value === "assumption" || value === "decision" || value === "decline" ? value : null;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function asIso(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

const UUID_RULE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function asOptions(value: unknown): readonly DecisionOption[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const options: DecisionOption[] = [];
  const names = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate) || !isNonBlank(candidate["name"]) || !isNonBlank(candidate["tradeoffs"])) return null;
    const comparable = candidate["name"].trim();
    if (names.has(comparable)) return null;
    names.add(comparable);
    options.push({ name: candidate["name"], tradeoffs: candidate["tradeoffs"] });
  }
  return options;
}

function asChoice(value: unknown, options: readonly DecisionOption[]): DecisionChoice | null {
  if (!isRecord(value) || !isNonBlank(value["option"]) || !("note" in value)) return null;
  const note = asNullableString(value["note"]);
  if (note === undefined) return null;
  const comparable = value["option"].trim();
  if (!options.some((option) => option.name.trim() === comparable)) return null;
  return { option: value["option"], note };
}

function asAdvisers(value: unknown): readonly Adviser[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const advisers: Adviser[] = [];
  const seen = new Set<Adviser>();
  for (const candidate of value) {
    if (candidate !== "sol" && candidate !== "fable" && candidate !== "nobody") return null;
    if (seen.has(candidate)) return null;
    seen.add(candidate);
    advisers.push(candidate);
  }
  if (seen.has("nobody") && seen.size !== 1) return null;
  return advisers;
}

function asExecution(value: unknown): ExecutionRef | null {
  if (!isRecord(value)) return null;
  switch (value["kind"]) {
    case "verified": {
      const since = asIso(value["since"]);
      return isNonBlank(value["token"]) && since !== null
        ? { kind: "verified", token: value["token"], since }
        : null;
    }
    case "not-found":
      return { kind: "not-found" };
    case "unavailable":
      return isNonBlank(value["why"]) ? { kind: "unavailable", why: value["why"] } : null;
    default:
      return null;
  }
}

function asBearsOn(value: unknown): BearsOn | null {
  if (!isRecord(value) || !Array.isArray(value["sessions"]) || !("plan" in value)) return null;
  const plan = asNullableString(value["plan"]);
  if (plan === undefined) return null;
  const sessions: SessionRef[] = [];
  const names = new Set<string>();
  for (const candidate of value["sessions"]) {
    if (!isRecord(candidate) || !isNonBlank(candidate["name"]) || !("execution" in candidate)) return null;
    const execution = asExecution(candidate["execution"]);
    if (execution === null) return null;
    if (names.has(candidate["name"])) return null;
    names.add(candidate["name"]);
    sessions.push({ name: candidate["name"], execution });
  }
  return { sessions, plan };
}

function parseDecided(json: Record<string, unknown>, envelope: Envelope, id: string): DecisionEvent | null {
  const decidedAt = asIso(json["decidedAt"]);
  const decisionClass = asClass(json["class"]);
  if (decidedAt === null || decisionClass === null) return null;
  if (!isNonBlank(json["question"]) || !isNonBlank(json["why"])) return null;
  const options = asOptions(json["options"]);
  if (options === null) return null;
  const chose = asChoice(json["chose"], options);
  const advisers = asAdvisers(json["advisers"]);
  const bearsOn = asBearsOn(json["bearsOn"]);
  if (!("supersedes" in json)) return null;
  const supersedes = asNullableString(json["supersedes"]);
  if (chose === null || advisers === null || bearsOn === null || supersedes === undefined) return null;
  if (supersedes !== null && !ID_RULE.test(supersedes)) return null;
  return {
    ...envelope,
    kind: "decided",
    id,
    decidedAt,
    class: decisionClass,
    question: json["question"],
    options,
    chose,
    why: json["why"],
    advisers,
    bearsOn,
    supersedes,
  };
}

/** One JSONL line to a fully validated event, or null. Nothing is defaulted. */
export function parseEvent(line: string): DecisionEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(json) || json["schema"] !== DECISIONS_SCHEMA || "decidedBy" in json) return null;
  const eventId = json["eventId"];
  const commandId = asNullableString(json["commandId"]);
  const at = asIso(json["at"]);
  const by = asActor(json["by"]);
  const id = json["id"];
  if (typeof eventId !== "string" || !UUID_RULE.test(eventId)) return null;
  if (!("commandId" in json) || commandId === undefined || at === null || by === null) return null;
  if (typeof id !== "string" || !ID_RULE.test(id)) return null;
  const envelope: Envelope = { schema: DECISIONS_SCHEMA, eventId, commandId, at, by };

  switch (json["kind"]) {
    case "decided":
      return parseDecided(json, envelope, id);
    case "reviewed": {
      if (!("note" in json)) return null;
      const note = asNullableString(json["note"]);
      return note === undefined ? null : { ...envelope, kind: "reviewed", id, note };
    }
    case "reversed": {
      if (!("why" in json)) return null;
      const why = asNullableString(json["why"]);
      return why === undefined ? null : { ...envelope, kind: "reversed", id, why };
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * The file. Three read arms remain three arms all the way out.
 * ------------------------------------------------------------------ */

/** `~/.overseer/`, with a separate override so tests and operators can isolate it. */
export function decisionsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env["OVERSEER_DECISIONS_DIR"];
  if (override !== undefined && override !== "") return override;
  return path.join(homedir(), ".overseer");
}

export type DecisionRead =
  | { kind: "never-written"; path: string }
  | { kind: "decisions"; view: DecisionView; path: string }
  | { kind: "unreadable"; why: string; path: string };

/** Parseable lines only, for the append preflight's like-for-like folds. */
function readEvents(root: string): DecisionEvent[] {
  const file = path.join(root, DECISIONS_FILE);
  if (!existsSync(file)) return [];
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const events: DecisionEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const event = parseEvent(line);
    if (event !== null) events.push(event);
  }
  return events;
}

export function readDecisions(root: string = decisionsRoot()): DecisionRead {
  const file = path.join(root, DECISIONS_FILE);
  if (!path.isAbsolute(root)) {
    return {
      kind: "unreadable",
      why: `the decisions directory must be an absolute path, not '${root}' — a relative one follows the caller's cwd`,
      path: file,
    };
  }
  const initialised = existsSync(path.join(root, DECISIONS_INIT_FILE));
  if (!existsSync(file)) {
    if (initialised) {
      return {
        kind: "unreadable",
        why:
          `${file} is gone, but ${DECISIONS_INIT_FILE} says this record was initialised — this is a LOST ` +
          "decision record, not a new one.",
        path: file,
      };
    }
    return { kind: "never-written", path: file };
  }

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (cause) {
    return { kind: "unreadable", why: `could not read ${file}: ${String(cause)}`, path: file };
  }
  if (text.trim() === "" && initialised) {
    return {
      kind: "unreadable",
      why:
        `${file} is empty, but ${DECISIONS_INIT_FILE} says this record was initialised — it was truncated, ` +
        "not safely emptied.",
      path: file,
    };
  }

  const events: DecisionEvent[] = [];
  const problems: DecisionProblem[] = [];
  let lineNumber = 0;
  for (const line of text.split("\n")) {
    lineNumber += 1;
    if (line.trim() === "") continue;
    const event = parseEvent(line);
    if (event === null) {
      problems.push({
        kind: "unreadable-line",
        why: `line ${lineNumber} is not a decision event this build understands`,
        eventId: null,
      });
    } else {
      events.push(event);
    }
  }
  return { kind: "decisions", view: foldDecisions(events, problems), path: file };
}

/** Never-written is legitimately empty; unreadable deliberately has no view. */
export function viewOf(read: DecisionRead): DecisionView | null {
  if (read.kind === "decisions") return read.view;
  if (read.kind === "never-written") return EMPTY_VIEW;
  return null;
}

function writeInitMarker(root: string): void {
  const marker = path.join(root, DECISIONS_INIT_FILE);
  if (existsSync(marker)) return;
  let fd: number;
  try {
    fd = openSync(marker, "wx");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") return;
    throw cause;
  }
  try {
    writeAll(
      fd,
      `this decision record was initialised at ${new Date().toISOString()}\n` +
        `With this marker present and ${DECISIONS_FILE} absent or empty, the record has been LOST.\n` +
        "Delete both files to reset deliberately.\n",
    );
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export type AppendResult =
  | { ok: true; view: DecisionView; path: string; repaired: JsonlRepair }
  | {
      ok: false;
      code: "stale-version" | "locked" | "unreadable" | "refused" | "would-break" | "command-conflict";
      why: string;
    };

/**
 * Append under the decisions lock; repair, version check, preflight and fsync
 * all happen before that lock is released.
 */
export function appendEvents(
  events: readonly DecisionEvent[],
  options: { root?: string; expect?: DecisionVersion; now?: () => Date } = {},
): AppendResult {
  const root = options.root ?? decisionsRoot();
  if (!path.isAbsolute(root)) {
    return { ok: false, code: "refused", why: `the decisions directory must be an absolute path, not '${root}'` };
  }
  if (events.length === 0) return { ok: false, code: "refused", why: "nothing to append" };
  try {
    mkdirSync(root, { recursive: true });
  } catch (cause) {
    return { ok: false, code: "refused", why: `could not make ${root}: ${String(cause)}` };
  }

  const lockPath = path.join(root, DECISIONS_LOCK_FILE);
  const taken = takeLock(lockPath, options.now ?? (() => new Date()));
  if (!taken.ok) return { ok: false, code: "locked", why: describeLockRefusal(taken.refusal, lockPath) };
  const lock: HeldLock = taken.lock;

  try {
    const file = path.join(root, DECISIONS_FILE);
    let repaired: JsonlRepair;
    try {
      repaired = truncateToLastLine(file);
    } catch (cause) {
      return { ok: false, code: "refused", why: `could not repair ${file}: ${String(cause)}` };
    }
    if (!stillOurs(lock, lockPath)) {
      return { ok: false, code: "locked", why: "lost the decisions lock while repairing the file; nothing was written" };
    }

    const before = readDecisions(root);
    if (before.kind === "unreadable") return { ok: false, code: "unreadable", why: before.why };
    const current = viewOf(before) ?? EMPTY_VIEW;
    if (options.expect !== undefined && !sameVersion(options.expect, current.version)) {
      return {
        ok: false,
        code: "stale-version",
        why:
          `the decision record has moved on: you sent version ${spellVersion(options.expect)} and it is now ` +
          `${spellVersion(current.version)}. Nothing was written — look again before writing.`,
      };
    }

    /* THE DELIBERATE DEPARTURE FROM idea-queue.ts. The queue compares a
       candidate folded from parseable lines with `readQueue`'s problem count,
       which also includes unreadable lines. One old parse error can therefore
       pay for one newly illegal event: 1 is not greater than 1. Here BOTH sides
       fold the SAME parseable prefix. The delta now means only "did this batch
       make the record worse?" A corrupt line still does not freeze every
       future legitimate append, which is important for a human-owned record. */
    const prefix = readEvents(root);
    const baseline = foldDecisions(prefix, []);
    const candidate = foldDecisions([...prefix, ...events], []);
    if (candidate.problems.length > baseline.problems.length) {
      const added = candidate.problems.slice(baseline.problems.length);
      return {
        ok: false,
        code: added.some((problem) => problem.kind === "command-conflict") ? "command-conflict" : "would-break",
        why:
          `refusing to write: these ${events.length} event(s) would put ${added.length} new problem(s) into the ` +
          "decision record, and an append-only log has no way to take them back — " +
          added.map((problem) => `${problem.kind}: ${problem.why}`).join("; "),
      };
    }

    /* Exact retries are evidence that the original write succeeded, not new
       history. Filter them only after the fold has checked duplicate event ids
       and command conflicts, so idempotency cannot mute either problem. */
    const commands = new Map<string, DecisionEvent>();
    for (const event of prefix) {
      if (event.commandId !== null && !commands.has(event.commandId)) commands.set(event.commandId, event);
    }
    const toAppend: DecisionEvent[] = [];
    for (const event of events) {
      if (event.commandId !== null) {
        const original = commands.get(event.commandId);
        if (original !== undefined && sameCommandPayload(original, event)) continue;
        commands.set(event.commandId, event);
      }
      toAppend.push(event);
    }
    if (toAppend.length === 0) return { ok: true, view: current, path: file, repaired };

    // The marker is before the first record but after preflight: a refused
    // first command must not leave proof of a record that never got one line.
    try {
      writeInitMarker(root);
    } catch (cause) {
      return { ok: false, code: "refused", why: `could not initialise the decision record: ${String(cause)}` };
    }

    const body = toAppend.map((event) => `${JSON.stringify(event)}\n`).join("");
    let fd: number;
    try {
      fd = openSync(file, "a");
    } catch (cause) {
      return { ok: false, code: "refused", why: `could not open ${file}: ${String(cause)}` };
    }
    try {
      writeAll(fd, body);
      // Before releasing the lock: a returned review that is only in page cache
      // is one a power cut can erase while the caller believes it durable.
      fsyncSync(fd);
    } catch (cause) {
      return { ok: false, code: "refused", why: `could not append ${file}: ${String(cause)}` };
    } finally {
      closeSync(fd);
    }

    const after = readDecisions(root);
    if (after.kind === "unreadable") return { ok: false, code: "unreadable", why: after.why };
    return { ok: true, view: viewOf(after) ?? EMPTY_VIEW, path: file, repaired };
  } finally {
    releaseLock(lock, lockPath);
  }
}

/* ------------------------------------------------------------------ *
 * Minting. Human-facing ids are short; event ids are UUIDs nobody types.
 * ------------------------------------------------------------------ */

const ID_ALPHABET = "23456789abcdefghjkmnpqrstvwxyz";

export function mintId(random: () => number = Math.random): string {
  let suffix = "";
  for (let index = 0; index < 8; index += 1) {
    suffix += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)] ?? "2";
  }
  return `dec-${suffix}`;
}

export const ID_RULE = new RegExp(`^dec-[${ID_ALPHABET}]{8}$`);

export function mintEventId(): string {
  return randomUUID();
}

export function envelope(
  by: DecisionActor,
  options: { at?: string; commandId?: string | null } = {},
): Envelope {
  return {
    schema: DECISIONS_SCHEMA,
    eventId: mintEventId(),
    commandId: options.commandId ?? null,
    at: options.at ?? new Date().toISOString(),
    by,
  };
}
