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
 * ## Who decided is not who recorded — schema 2
 *
 * `by` says only who wrote the line. Schema 2 (plan 260910e, GPT Sol's WR-P1)
 * adds `author`, who DECIDED, and `by` gains `daemon`: the report drain copying
 * a session's decision into this file, which the reasoning Overseer did not
 * write. So `daemon` is valid only on a schema-2 `decided` whose author is a
 * session, and never on a review.
 *
 * **Schema-1 lines are never migrated.** They fold with the author
 * `legacy-unrecorded` — not `overseer`, because V1's assumptions were made
 * under Greg's standing decision, and saying the Overseer decided them would be
 * false — and every schema-2 field `not-recorded`: a literal, never undefined,
 * and never guessed. That is also why V1's refusal of a `decidedBy` key stays.
 *
 * Every schema-2 field is the AUTHOR'S say-so. `gregAsked: "asked-answered"`
 * is a claim about Greg, not Greg; it changes nothing in the fold, and the page
 * renders it as the author's claim. Every schema-2 text field is bounded and
 * refused if it carries a control or bidi-override character; schema-1 lines
 * keep the looser rules they were written under.
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

import {
  MAX_PATH_CHARS,
  parseCheckedArtefacts,
  untrustedTextProblem,
  type CheckedArtefact,
} from "../fleet/artefact-ref.js";
import { isExecutionTokenText } from "../fleet/execution-token.js";
import type { QueueActor } from "../fleet/wire.js";
import { truncateToLastLine, writeAll, type JsonlRepair } from "./jsonl.js";
import { describeLockRefusal, releaseLock, stillOurs, takeLock, type HeldLock } from "./lock.js";

/** What every new line is written at. Bumped only when an earlier reader could not safely ignore the change. */
export const DECISIONS_SCHEMA = 2;
/** The schema V1 wrote, still read exactly as it was. */
export const LEGACY_DECISIONS_SCHEMA = 1;
export type DecisionSchema = typeof LEGACY_DECISIONS_SCHEMA | typeof DECISIONS_SCHEMA;

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

/** The two recorders the queue admits, and the only two that may record a review. */
export type DecisionActor = QueueActor;
export const DECISION_ACTORS: readonly DecisionActor[] = ["greg", "overseer"];

/**
 * Who recorded a line. `daemon` is the report drain copying a session's
 * decision, and is valid on nothing else — see `parseEventDetailed`.
 */
export type DecisionRecorder = DecisionActor | "daemon";
export const DECISION_RECORDERS: readonly DecisionRecorder[] = ["greg", "overseer", "daemon"];

/* ---- Schema 2's fields. Each is the author's say-so; none of them reviews. ---- */

export type Consequence = "high" | "medium" | "low";
export const CONSEQUENCES: readonly Consequence[] = ["high", "medium", "low"];
export type Reversibility = "easy" | "costly" | "one-way";
export const REVERSIBILITIES: readonly Reversibility[] = ["easy", "costly", "one-way"];
export type DecisionDomain = "product" | "technical";
export const DECISION_DOMAINS: readonly DecisionDomain[] = ["product", "technical"];
/** The author's claim about whether Greg was asked — rendered as a claim, never as review. */
export type GregAsked = "no" | "asked-answered" | "asked-awaiting";
export const GREG_ASKED: readonly GregAsked[] = ["no", "asked-answered", "asked-awaiting"];
/** An annotation only: it never sorts and never gates. */
export type Confidence = "high" | "medium" | "low";
export const CONFIDENCES: readonly Confidence[] = ["high", "medium", "low"];

/** What a schema-1 row carries for a schema-2 field. A literal, so it is never confused with absent. */
export type NotRecorded = "not-recorded";
export const NOT_RECORDED: NotRecorded = "not-recorded";

/**
 * A schema-2 value whose own range includes text or a list, so a bare
 * `"not-recorded"` could collide with it: a recommendation may say anything,
 * and an empty evidence list is a recorded fact, not an unrecorded one.
 */
export type Recorded<T> = { readonly kind: "not-recorded" } | { readonly kind: "recorded"; readonly value: T };

/** A session name as an author: the same shape a report actor uses. */
export const SESSION_NAME_RULE = /^[A-Za-z0-9._-]{1,64}$/;

/** Who DECIDED, on a schema-2 line. */
export type DecisionAuthor =
  | { readonly kind: "overseer" }
  | { readonly kind: "greg" }
  | { readonly kind: "session"; readonly name: string; readonly execution: ExecutionRef };

/** Who decided, as a folded record knows it. */
export type RecordAuthor = DecisionAuthor | { readonly kind: "legacy-unrecorded" };

/** Everything a schema-2 `decided` line carries beyond V1's fields. */
export type DecisionAssessment = {
  readonly author: DecisionAuthor;
  readonly consequence: Consequence;
  readonly reversibility: Reversibility;
  readonly domain: DecisionDomain;
  /** What the author recommends if Greg looks again, or null. */
  readonly recommendation: string | null;
  readonly evidence: readonly CheckedArtefact[];
  readonly gregAsked: GregAsked;
  readonly confidence: Confidence | null;
};

/** Required on every schema-2 `decided` line, in the order a refusal names them. */
export const ASSESSMENT_FIELDS = [
  "author",
  "consequence",
  "reversibility",
  "domain",
  "recommendation",
  "evidence",
  "gregAsked",
  "confidence",
] as const satisfies readonly (keyof DecisionAssessment)[];

/**
 * Bounds on a schema-2 line's text. Generous for prose; the point is that a
 * line has a size and a character set at all, not that decisions are short.
 */
export const DECISION_TEXT_LIMITS = {
  question: 1000,
  why: 4000,
  optionName: 200,
  tradeoffs: 1000,
  note: 1000,
  recommendation: 2000,
  plan: MAX_PATH_CHARS,
  sessionName: 200,
  commandId: 200,
  isoInstant: 64,
  executionToken: 200,
  executionWhy: 500,
  reviewText: 2000,
  options: 20,
  sessions: 20,
} as const;

type EnvelopeOf<S extends DecisionSchema, B extends DecisionRecorder> = {
  readonly schema: S;
  readonly eventId: string;
  readonly commandId: string | null;
  readonly at: string;
  /** Who recorded this line — never who decided; that is `author`, from schema 2. */
  readonly by: B;
};

export type Envelope = EnvelopeOf<DecisionSchema, DecisionRecorder>;

type DecidedFields = {
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
};

/** A V1 line: no author, no assessment, and never recorded by the daemon. */
export type DecidedV1Event = EnvelopeOf<typeof LEGACY_DECISIONS_SCHEMA, DecisionActor> & DecidedFields;
export type DecidedV2Event = EnvelopeOf<typeof DECISIONS_SCHEMA, DecisionRecorder> & DecidedFields & DecisionAssessment;
export type DecidedEvent = DecidedV1Event | DecidedV2Event;

/** Reviews and reversals: the same shape at either schema, and only Greg's count. */
export type ReviewEvent = EnvelopeOf<DecisionSchema, DecisionActor> &
  (
    | { readonly kind: "reviewed"; readonly id: string; readonly note: string | null }
    | { readonly kind: "reversed"; readonly id: string; readonly why: string | null }
  );

export type DecisionEvent = DecidedEvent | ReviewEvent;

export type DecisionEventKind = DecisionEvent["kind"];

/** One accepted event in a record's own, oldest-first history. */
export type DecisionTouch = {
  readonly kind: DecisionEventKind;
  readonly at: string;
  readonly by: DecisionRecorder;
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

/** A decision as replay leaves it; the source fields are never amended. */
export type DecisionRecord = {
  readonly id: string;
  /** Who wrote the `decided` line — not who decided it; that is `author`. */
  readonly recordedBy: DecisionRecorder;
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
  /** Schema 1 is `legacy-unrecorded`, and every field below it `not-recorded`. */
  readonly author: RecordAuthor;
  readonly consequence: Consequence | NotRecorded;
  readonly reversibility: Reversibility | NotRecorded;
  readonly domain: DecisionDomain | NotRecorded;
  readonly recommendation: Recorded<string | null>;
  readonly evidence: Recorded<readonly CheckedArtefact[]>;
  readonly gregAsked: GregAsked | NotRecorded;
  readonly confidence: Confidence | null | NotRecorded;
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

type Assessed = Pick<
  DecisionRecord,
  "author" | "consequence" | "reversibility" | "domain" | "recommendation" | "evidence" | "gregAsked" | "confidence"
>;

type MutableDecision = Assessed & {
  id: string;
  recordedBy: DecisionRecorder;
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

function copyAuthor(author: DecisionAuthor): DecisionAuthor {
  return author.kind === "session"
    ? { kind: "session", name: author.name, execution: { ...author.execution } }
    : { kind: author.kind };
}

/** A schema-1 line never had these, so it says so — it does not guess. */
function assessedOf(event: DecidedEvent): Assessed {
  if (event.schema === LEGACY_DECISIONS_SCHEMA) {
    return {
      author: { kind: "legacy-unrecorded" },
      consequence: NOT_RECORDED,
      reversibility: NOT_RECORDED,
      domain: NOT_RECORDED,
      recommendation: { kind: "not-recorded" },
      evidence: { kind: "not-recorded" },
      gregAsked: NOT_RECORDED,
      confidence: NOT_RECORDED,
    };
  }
  return {
    author: copyAuthor(event.author),
    consequence: event.consequence,
    reversibility: event.reversibility,
    domain: event.domain,
    recommendation: { kind: "recorded", value: event.recommendation },
    evidence: {
      kind: "recorded",
      value: event.evidence.map((item) => ({ ref: { ...item.ref }, check: { ...item.check } })),
    },
    gregAsked: event.gregAsked,
    confidence: event.confidence,
  };
}

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
        // Schema 2's fields are part of the intent: a changed consequence under
        // one command id is a different command, not a retry.
        ...(event.schema === DECISIONS_SCHEMA
          ? {
              author: event.author,
              consequence: event.consequence,
              reversibility: event.reversibility,
              domain: event.domain,
              recommendation: event.recommendation,
              evidence: event.evidence,
              gregAsked: event.gregAsked,
              confidence: event.confidence,
            }
          : {}),
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
        ...assessedOf(event),
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
      // this. All entrances meet here, including a hand-edited line — and
      // whoever the decision's author is, including Greg himself.
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
    author: record.author,
    consequence: record.consequence,
    reversibility: record.reversibility,
    domain: record.domain,
    recommendation: record.recommendation,
    evidence: record.evidence,
    gregAsked: record.gregAsked,
    confidence: record.confidence,
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

type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: string };

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function no<T>(why: string): Result<T> {
  return { ok: false, why };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function asRecorder(value: unknown): DecisionRecorder | null {
  return value === "greg" || value === "overseer" || value === "daemon" ? value : null;
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

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
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

function executionTextProblem(name: string, execution: ExecutionRef): string | null {
  if (execution.kind === "not-found") return null;
  if (execution.kind === "unavailable") {
    const why = untrustedTextProblem(execution.why, DECISION_TEXT_LIMITS.executionWhy);
    return why === null ? null : `${name}.why ${why}`;
  }
  const token = untrustedTextProblem(execution.token, DECISION_TEXT_LIMITS.executionToken);
  if (token !== null) return `${name}.token ${token}`;
  if (!isExecutionTokenText(execution.token)) return `${name}.token is not a canonical execution token`;
  const since = untrustedTextProblem(execution.since, DECISION_TEXT_LIMITS.isoInstant);
  return since === null ? null : `${name}.since ${since}`;
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

/** Why a schema-2 line's inherited V1 text may not be stored, or null. Never applied to schema 1. */
function v1FieldTextProblem(fields: DecidedFields): string | null {
  const limits = DECISION_TEXT_LIMITS;
  const checks: Array<[string, string | null, number]> = [
    ["question", fields.question, limits.question],
    ["why", fields.why, limits.why],
    ["decidedAt", fields.decidedAt, limits.isoInstant],
    ["chose.option", fields.chose.option, limits.optionName],
    ["chose.note", fields.chose.note, limits.note],
    ["bearsOn.plan", fields.bearsOn.plan, limits.plan],
    ...fields.options.flatMap((option, index): Array<[string, string, number]> => [
      [`options[${index}].name`, option.name, limits.optionName],
      [`options[${index}].tradeoffs`, option.tradeoffs, limits.tradeoffs],
    ]),
    ...fields.bearsOn.sessions.map((session, index): [string, string, number] => [
      `bearsOn.sessions[${index}].name`,
      session.name,
      limits.sessionName,
    ]),
  ];
  if (fields.options.length > limits.options) return `options has more than ${limits.options} entries`;
  if (fields.bearsOn.sessions.length > limits.sessions) return `bearsOn.sessions has more than ${limits.sessions} entries`;
  for (const [name, text, max] of checks) {
    if (text === null) continue;
    const why = untrustedTextProblem(text, max);
    if (why !== null) return `${name} ${why}`;
  }
  for (const [index, session] of fields.bearsOn.sessions.entries()) {
    const why = executionTextProblem(`bearsOn.sessions[${index}].execution`, session.execution);
    if (why !== null) return why;
  }
  return null;
}

function asAuthor(value: unknown): Result<DecisionAuthor> {
  const shape = 'author must be {"kind":"overseer"}, {"kind":"greg"} or {"kind":"session","name":…,"execution":…}';
  if (!isRecord(value)) return no(shape);
  switch (value["kind"]) {
    case "overseer":
      return ok({ kind: "overseer" });
    case "greg":
      return ok({ kind: "greg" });
    case "session": {
      const name = value["name"];
      if (typeof name !== "string" || !SESSION_NAME_RULE.test(name)) {
        return no("author.name must be a session name: 1 to 64 letters, digits, '.', '_' or '-'");
      }
      const execution = asExecution(value["execution"]);
      if (execution === null) return no("author.execution must be a verified, not-found or unavailable execution reference");
      const why = executionTextProblem("author.execution", execution);
      if (why !== null) return no(why);
      return ok({ kind: "session", name, execution });
    }
    default:
      return no(shape);
  }
}

/** The schema-2 fields, each with its own reason for refusal. */
function asAssessment(json: Record<string, unknown>): Result<DecisionAssessment> {
  const missing = ASSESSMENT_FIELDS.filter((field) => !(field in json));
  if (missing.length > 0) return no(`a schema-2 decision needs ${missing.join(", ")}`);

  const author = asAuthor(json["author"]);
  if (!author.ok) return author;
  const consequence = oneOf(json["consequence"], CONSEQUENCES);
  if (consequence === null) return no("consequence must be high, medium or low");
  const reversibility = oneOf(json["reversibility"], REVERSIBILITIES);
  if (reversibility === null) return no("reversibility must be easy, costly or one-way");
  const domain = oneOf(json["domain"], DECISION_DOMAINS);
  if (domain === null) return no("domain must be product or technical");

  const recommendation = json["recommendation"];
  if (recommendation !== null) {
    if (!isNonBlank(recommendation)) return no("recommendation must be null or non-blank text");
    const why = untrustedTextProblem(recommendation, DECISION_TEXT_LIMITS.recommendation);
    if (why !== null) return no(`recommendation ${why}`);
  }

  const evidence = parseCheckedArtefacts(json["evidence"]);
  if (evidence === null) {
    return no("evidence must be a list of at most 20 well-formed artefact references, each with a check that fits its kind");
  }
  const gregAsked = oneOf(json["gregAsked"], GREG_ASKED);
  if (gregAsked === null) return no("gregAsked must be no, asked-answered or asked-awaiting");
  const confidence = json["confidence"] === null ? null : oneOf(json["confidence"], CONFIDENCES);
  if (confidence === null && json["confidence"] !== null) return no("confidence must be high, medium, low or null");

  return ok({
    author: author.value,
    consequence,
    reversibility,
    domain,
    recommendation,
    evidence,
    gregAsked,
    confidence,
  });
}

function parseDecidedFields(json: Record<string, unknown>, id: string): Result<DecidedFields> {
  const decidedAt = asIso(json["decidedAt"]);
  if (decidedAt === null) return no("decidedAt must be an ISO instant");
  const decisionClass = asClass(json["class"]);
  if (decisionClass === null) return no("class must be assumption, decision or decline");
  if (!isNonBlank(json["question"])) return no("question must be non-blank text");
  if (!isNonBlank(json["why"])) return no("why must be non-blank text");
  const options = asOptions(json["options"]);
  if (options === null) return no("options must be at least two, each with a distinct non-blank name and non-blank trade-offs");
  const chose = asChoice(json["chose"], options);
  if (chose === null) return no("chose must name one of the options, with a note that is text or null");
  const advisers = asAdvisers(json["advisers"]);
  if (advisers === null) return no("advisers must be one or more of sol and fable, or just nobody");
  const bearsOn = asBearsOn(json["bearsOn"]);
  if (bearsOn === null) return no("bearsOn must hold distinct named sessions with execution references, and a plan that is text or null");
  if (!("supersedes" in json)) return no("supersedes must be present, as a decision id or null");
  const supersedes = asNullableString(json["supersedes"]);
  if (supersedes === undefined || (supersedes !== null && !ID_RULE.test(supersedes))) {
    return no("supersedes must be a decision id or null");
  }
  return ok({
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
  });
}

export type EventParse = { readonly ok: true; readonly event: DecisionEvent } | { readonly ok: false; readonly why: string };

/**
 * One JSONL line to a fully validated event, or the reason it is not one.
 * Nothing is defaulted. `parseEvent` is the same verdict without the reason.
 */
export function parseEventDetailed(line: string): EventParse {
  const refuse = (why: string): EventParse => ({ ok: false, why });
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return refuse("the line is not JSON");
  }
  if (!isRecord(json)) return refuse("the line is not a JSON object");
  const rawSchema = json["schema"];
  if (rawSchema !== LEGACY_DECISIONS_SCHEMA && rawSchema !== DECISIONS_SCHEMA) {
    return refuse(`schema ${JSON.stringify(rawSchema)} is not one this build reads (1 or 2)`);
  }
  const schema: DecisionSchema = rawSchema === LEGACY_DECISIONS_SCHEMA ? LEGACY_DECISIONS_SCHEMA : DECISIONS_SCHEMA;
  if ("decidedBy" in json) return refuse("decidedBy is not a field of this record: `by` says who recorded the line");
  const eventId = json["eventId"];
  if (typeof eventId !== "string" || !UUID_RULE.test(eventId)) return refuse("eventId must be a UUID");
  const commandId = asNullableString(json["commandId"]);
  if (!("commandId" in json) || commandId === undefined) return refuse("commandId must be present, as text or null");
  const at = asIso(json["at"]);
  if (at === null) return refuse("at must be an ISO instant");
  if (schema === DECISIONS_SCHEMA) {
    if (commandId !== null) {
      const why = untrustedTextProblem(commandId, DECISION_TEXT_LIMITS.commandId);
      if (why !== null) return refuse(`commandId ${why}`);
    }
    const why = untrustedTextProblem(at, DECISION_TEXT_LIMITS.isoInstant);
    if (why !== null) return refuse(`at ${why}`);
  }
  const by = asRecorder(json["by"]);
  if (by === null) return refuse("by must be greg, overseer or daemon");
  const id = json["id"];
  if (typeof id !== "string" || !ID_RULE.test(id)) return refuse("id must be a decision id such as dec-a3k9mq2p");

  switch (json["kind"]) {
    case "decided": {
      const fields = parseDecidedFields(json, id);
      if (!fields.ok) return refuse(fields.why);
      if (schema === LEGACY_DECISIONS_SCHEMA) {
        if (by === "daemon") return refuse("daemon records only a session's schema-2 decision, never a schema-1 line");
        return { ok: true, event: { schema, eventId, commandId, at, by, ...fields.value } };
      }
      const text = v1FieldTextProblem(fields.value);
      if (text !== null) return refuse(text);
      const assessment = asAssessment(json);
      if (!assessment.ok) return refuse(assessment.why);
      const expectedAuthor = by === "daemon" ? "session" : by;
      if (assessment.value.author.kind !== expectedAuthor) {
        return refuse(
          `${by} may record only a ${expectedAuthor} decision; this line names ${assessment.value.author.kind} as its author`,
        );
      }
      return { ok: true, event: { schema, eventId, commandId, at, by, ...fields.value, ...assessment.value } };
    }
    case "reviewed":
    case "reversed": {
      if (by === "daemon") return refuse(`daemon never records a ${json["kind"]}: only Greg's count, and the drain copies decisions`);
      const field = json["kind"] === "reviewed" ? "note" : "why";
      if (!(field in json)) return refuse(`${json["kind"]} needs ${field}, as text or null`);
      const text = asNullableString(json[field]);
      if (text === undefined) return refuse(`${field} must be text or null`);
      if (schema === DECISIONS_SCHEMA && text !== null) {
        const why = untrustedTextProblem(text, DECISION_TEXT_LIMITS.reviewText);
        if (why !== null) return refuse(`${field} ${why}`);
      }
      const base = { schema, eventId, commandId, at, by, id };
      return {
        ok: true,
        event: json["kind"] === "reviewed" ? { ...base, kind: "reviewed", note: text } : { ...base, kind: "reversed", why: text },
      };
    }
    default:
      return refuse(`kind ${JSON.stringify(json["kind"])} is not decided, reviewed or reversed`);
  }
}

/** One JSONL line to a fully validated event, or null. Nothing is defaulted. */
export function parseEvent(line: string): DecisionEvent | null {
  const parsed = parseEventDetailed(line);
  return parsed.ok ? parsed.event : null;
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
  /* **NOTHING GOES IN THAT THIS FILE'S OWN READER WOULD REFUSE.** The types
     cannot carry every bound — a recommendation's length, a note's control
     character — and the fold never parses, so without this a writer could
     append a line that every later read reports as unreadable. Two writers use
     this function (the CLI and the report drain); the check belongs to both. */
  for (const event of events) {
    const reread = parseEventDetailed(JSON.stringify(event));
    if (!reread.ok) {
      return {
        ok: false,
        code: "refused",
        why: `refusing to write ${event.kind} ${event.id}: this record's own reader would not accept it — ${reread.why}`,
      };
    }
  }
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
    /* A prepared report event is replayed as the exact same event after a
       crash. The fold deliberately treats a duplicate event id as a problem,
       so recognise an already-persisted, command-keyed event at this write
       boundary before asking the fold about genuinely new input. A matching
       command with a fresh event id remains the older CLI retry case below;
       the same event id with any changed field still reaches the fold and is
       refused as a duplicate. */
    const pending = events.filter(
      (event) =>
        event.commandId === null ||
        !prefix.some(
          (written) =>
            written.commandId === event.commandId &&
            written.eventId === event.eventId &&
            written.at === event.at &&
            sameCommandPayload(written, event),
        ),
    );
    if (pending.length === 0) return { ok: true, view: current, path: file, repaired };
    const baseline = foldDecisions(prefix, []);
    const candidate = foldDecisions([...prefix, ...pending], []);
    if (candidate.problems.length > baseline.problems.length) {
      const added = candidate.problems.slice(baseline.problems.length);
      return {
        ok: false,
        code: added.some((problem) => problem.kind === "command-conflict") ? "command-conflict" : "would-break",
        why:
          `refusing to write: these ${pending.length} event(s) would put ${added.length} new problem(s) into the ` +
          "decision record, and an append-only log has no way to take them back — " +
          added.map((problem) => `${problem.kind}: ${problem.why}`).join("; "),
      };
    }

    /* The CLI retries one intent with a fresh event id and clock. Filter that
       form only after the fold has checked duplicate event ids and command
       conflicts, so command idempotency cannot mute either problem. */
    const commands = new Map<string, DecisionEvent>();
    for (const event of prefix) {
      if (event.commandId !== null && !commands.has(event.commandId)) commands.set(event.commandId, event);
    }
    const toAppend: DecisionEvent[] = [];
    for (const event of pending) {
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

/** A new line's envelope: always the current schema, and `by` exactly as given. */
export function envelope<B extends DecisionRecorder>(
  by: B,
  options: { at?: string; commandId?: string | null } = {},
): EnvelopeOf<typeof DECISIONS_SCHEMA, B> {
  return {
    schema: DECISIONS_SCHEMA,
    eventId: mintEventId(),
    commandId: options.commandId ?? null,
    at: options.at ?? new Date().toISOString(),
    by,
  };
}
