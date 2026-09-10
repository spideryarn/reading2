/**
 * The Overseer's decision record: the permission to decide without stopping.
 *
 * The dangerous success here is a calm-looking unreviewed count over a record
 * that nobody actually reviewed. These tests therefore assert both halves of
 * every refusal: a problem is named AND the record is left unchanged. Disk
 * tests use a fresh temporary root; nothing can reach the live ~/.overseer/.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  DECISIONS_FILE,
  DECISIONS_INIT_FILE,
  DECISIONS_LOCK_FILE,
  DECISIONS_SCHEMA,
  ID_RULE,
  VERSION_ZERO,
  appendEvents,
  decisionsRoot,
  foldDecisions,
  mintId,
  parseEvent,
  parseVersion,
  readDecisions,
  sameVersion,
  spellVersion,
  viewOf,
  type DecidedV2Event,
  type DecisionEvent,
  type DecisionRecord,
  type DecisionView,
} from "../tools/overseer/decisions.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-decisions-test-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const A = "dec-aaaaaaaa";
const B = "dec-bbbbbbbb";
let eventNumber = 0;

function eventEnvelope(by: "greg" | "overseer" = "overseer", at?: string, commandId: string | null = null) {
  eventNumber += 1;
  return {
    schema: DECISIONS_SCHEMA,
    eventId: `00000000-0000-4000-8000-${String(eventNumber).padStart(12, "0")}`,
    commandId,
    at: at ?? new Date(Date.UTC(2026, 8, 9, 10, 0, eventNumber)).toISOString(),
    by,
  } as const;
}

/* Schema 2 since plan 260910e: every new line carries who decided and the
   triage fields. Schema 1's own behaviour is pinned in
   `tests/overseer-decisions-schema2.test.ts`. */
function decided(id: string = A, over: Partial<DecidedV2Event> = {}): DecidedV2Event {
  return {
    ...eventEnvelope("overseer"),
    kind: "decided",
    id,
    decidedAt: "2026-09-09T09:59:00.000Z",
    class: "decision",
    question: "Which implementation should we use?",
    options: [
      { name: "Simple", tradeoffs: "Less flexible, but cheap to understand." },
      { name: "General", tradeoffs: "More flexible, but adds machinery." },
    ],
    chose: { option: "Simple", note: "Use the simple implementation." },
    why: "No current use needs the machinery.",
    advisers: ["nobody"],
    bearsOn: { sessions: [], plan: null },
    supersedes: null,
    author: { kind: "overseer" },
    consequence: "low",
    reversibility: "easy",
    domain: "technical",
    recommendation: null,
    evidence: [],
    gregAsked: "no",
    confidence: null,
    ...over,
  };
}

function only(view: DecisionView, id: string = A): DecisionRecord {
  const record = view.records.find((candidate) => candidate.id === id);
  if (record === undefined) throw new Error(`no decision ${id}`);
  return record;
}

function asLine(event: DecisionEvent): string {
  return JSON.stringify(event);
}

describe("the on-disk contract and ids", () => {
  test("pins the schema, file names, root and readable id alphabet", () => {
    expect(DECISIONS_SCHEMA).toBe(2);
    expect(DECISIONS_FILE).toBe("decisions.jsonl");
    expect(DECISIONS_LOCK_FILE).toBe("decisions.lock");
    expect(DECISIONS_INIT_FILE).toBe("decisions.created");
    expect(decisionsRoot({ OVERSEER_DECISIONS_DIR: "/somewhere/else" })).toBe("/somewhere/else");
    expect(decisionsRoot({}).endsWith("/.overseer")).toBe(true);
    expect(mintId(() => 0)).toBe("dec-22222222");
    expect(ID_RULE.test("dec-a3k9mq2p")).toBe(true);
    expect(ID_RULE.test("dec-aaaaaaaaa")).toBe(false);
    expect(ID_RULE.test("qi-a3k9mq2p")).toBe(false);
  });

  test("versions distinguish different tails of the same length", () => {
    const one = { events: 2, lastEventId: "event-a" };
    const another = { events: 2, lastEventId: "event-b" };
    expect(sameVersion(one, another)).toBe(false);
    expect(parseVersion(spellVersion(one))).toEqual(one);
    expect(parseVersion("0")).toEqual(VERSION_ZERO);
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("2")).toBeNull();
    expect(parseVersion("-1.event-a")).toBeNull();
  });
});

describe("strict event parsing", () => {
  test("accepts each complete event and preserves rather than coerces it", () => {
    const first = decided();
    const review: DecisionEvent = { ...eventEnvelope("greg"), kind: "reviewed", id: A, note: null };
    const reverse: DecisionEvent = { ...eventEnvelope("greg"), kind: "reversed", id: A, why: "New evidence" };
    expect(parseEvent(asLine(first))).toEqual(first);
    expect(parseEvent(asLine(review))).toEqual(review);
    expect(parseEvent(asLine(reverse))).toEqual(reverse);
  });

  test.each([
    ["schema", { schema: 3 }],
    ["kind", { kind: "invented" }],
    ["eventId", { eventId: "not-a-uuid" }],
    ["at", { at: "Tuesday lunchtime" }],
    ["by", { by: "daemon" }],
    ["id", { id: "dec-with-i" }],
    ["class", { class: "guess" }],
    ["question", { question: "  " }],
    ["decidedAt", { decidedAt: "Tuesday lunchtime" }],
    ["why", { why: "\n" }],
  ] as const)("rejects an unknown, missing, or invalid %s", (_field, patch) => {
    expect(parseEvent(JSON.stringify({ ...decided(), ...patch }))).toBeNull();
  });

  test("rejects a stale decidedBy key even when its old value is overseer", () => {
    expect(parseEvent(JSON.stringify({ ...decided(), decidedBy: "overseer" }))).toBeNull();
    expect(
      parseEvent(JSON.stringify({ ...eventEnvelope("greg"), kind: "reviewed", id: A, note: null, decidedBy: "overseer" })),
    ).toBeNull();
  });

  test("requires a choice naming a listed option, compared after trimming", () => {
    const withoutChoice = { ...decided() } as Record<string, unknown>;
    delete withoutChoice["chose"];
    expect(parseEvent(JSON.stringify(withoutChoice))).toBeNull();
    expect(parseEvent(JSON.stringify({ ...decided(), chose: { option: "Unlisted", note: null } }))).toBeNull();
    const spaced = decided(A, {
      options: [
        { name: "  Simple  ", tradeoffs: "Less flexible, but cheap to understand." },
        { name: "General", tradeoffs: "More flexible, but adds machinery." },
      ],
      chose: { option: " Simple ", note: null },
    });
    expect(parseEvent(asLine(spaced))).toEqual(spaced);
  });

  test("requires a nullable supersedes field containing a decision id", () => {
    const missing = { ...decided() } as Record<string, unknown>;
    delete missing["supersedes"];
    expect(parseEvent(JSON.stringify(missing))).toBeNull();
    expect(parseEvent(JSON.stringify({ ...decided(), supersedes: "not-an-id" }))).toBeNull();
  });

  test.each(["schema", "kind", "eventId", "commandId", "at", "by", "id"])("rejects a missing envelope field: %s", (field) => {
    const raw: Record<string, unknown> = { ...decided() };
    delete raw[field];
    expect(parseEvent(JSON.stringify(raw))).toBeNull();
  });

  test("rejects fewer than two options", () => {
    const base = decided();
    expect(parseEvent(JSON.stringify({ ...base, options: base.options.slice(0, 1) }))).toBeNull();
  });

  test("rejects duplicate option names after trimming", () => {
    const base = decided();
    expect(
      parseEvent(
        JSON.stringify({
          ...base,
          options: [base.options[0], { name: ` ${base.options[0]?.name ?? ""} `, tradeoffs: "Same choice" }],
        }),
      ),
    ).toBeNull();
  });

  test("rejects blank option fields", () => {
    const base = decided();
    expect(parseEvent(JSON.stringify({ ...base, options: [{ name: " ", tradeoffs: "cost" }, base.options[1]] }))).toBeNull();
    expect(parseEvent(JSON.stringify({ ...base, options: [{ name: "Other", tradeoffs: " " }, base.options[1]] }))).toBeNull();
  });

  test("rejects empty advisers", () => {
    expect(parseEvent(JSON.stringify({ ...decided(), advisers: [] }))).toBeNull();
  });

  test("rejects duplicate and unknown advisers", () => {
    const base = decided();
    for (const advisers of [["sol", "sol"], ["someone"]]) {
      expect(parseEvent(JSON.stringify({ ...base, advisers }))).toBeNull();
    }
  });

  test("rejects nobody alongside another adviser", () => {
    expect(parseEvent(JSON.stringify({ ...decided(), advisers: ["nobody", "sol"] }))).toBeNull();
  });

  test("each execution-reference arm round-trips", () => {
    const base = decided();
    const event = {
      ...base,
      bearsOn: {
        sessions: [
          { name: "verified", execution: { kind: "verified", token: "boot:42:7", since: "2026-09-09T09:00:00.000Z" } },
          { name: "missing", execution: { kind: "not-found" } },
          { name: "unknown", execution: { kind: "unavailable", why: "checkpoint unreadable" } },
        ],
        plan: null,
      },
    };
    expect(parseEvent(JSON.stringify(event))).toEqual(event);
  });

  test("rejects a malformed execution reference", () => {
    const base = decided();
    for (const execution of [
      { kind: "verified", token: "boot:42:7", since: "yesterday" },
      { kind: "verified", token: "", since: "2026-09-09T09:00:00.000Z" },
      { kind: "unavailable", why: " " },
      { kind: "invented" },
    ]) {
      expect(
        parseEvent(JSON.stringify({ ...base, bearsOn: { sessions: [{ name: "worker", execution }], plan: null } })),
      ).toBeNull();
    }
  });

  test("rejects duplicate session names", () => {
    const base = decided();
    expect(
      parseEvent(
        JSON.stringify({
          ...base,
          bearsOn: {
            sessions: [
              { name: "worker", execution: { kind: "not-found" } },
              { name: "worker", execution: { kind: "unavailable", why: "could not look" } },
            ],
            plan: null,
          },
        }),
      ),
    ).toBeNull();
  });

  test("rejects blank session names and malformed nested fields", () => {
    const base = decided();
    expect(
      parseEvent(JSON.stringify({ ...base, bearsOn: { sessions: [{ name: "  ", execution: { kind: "not-found" } }], plan: null } })),
    ).toBeNull();
    expect(
      parseEvent(JSON.stringify({ ...base, bearsOn: { sessions: [{ name: "worker", execution: null }], plan: null } })),
    ).toBeNull();
    expect(parseEvent(JSON.stringify({ ...base, bearsOn: { sessions: [], plan: 42 } }))).toBeNull();
  });

  test("reviewed and reversed require their nullable text fields without coercion", () => {
    const review = { ...eventEnvelope("greg"), kind: "reviewed", id: A };
    const reverse = { ...eventEnvelope("greg"), kind: "reversed", id: A };
    expect(parseEvent(JSON.stringify(review))).toBeNull();
    expect(parseEvent(JSON.stringify({ ...review, note: 42 }))).toBeNull();
    expect(parseEvent(JSON.stringify(reverse))).toBeNull();
    expect(parseEvent(JSON.stringify({ ...reverse, why: false }))).toBeNull();
  });
});

describe("the fold protects the review state", () => {
  test("a review recorded by the Overseer is a problem and changes nothing", () => {
    const view = foldDecisions([
      decided(),
      { ...eventEnvelope("overseer"), kind: "reviewed", id: A, note: "looks fine" },
    ]);
    expect(view.problems.map((problem) => problem.kind)).toEqual(["unauthorized-review"]);
    expect(only(view).reviewed).toBe(false);
    expect(only(view).touches.map((touch) => touch.kind)).toEqual(["decided"]);
  });

  test("a reversal recorded by the Overseer is likewise a problem and changes nothing", () => {
    const view = foldDecisions([
      decided(),
      { ...eventEnvelope("overseer"), kind: "reversed", id: A, why: "changed my mind" },
    ]);
    expect(view.problems.map((problem) => problem.kind)).toEqual(["unauthorized-review"]);
    expect(only(view)).toMatchObject({ reviewed: false, reversed: false });
    expect(only(view).touches).toHaveLength(1);
  });

  test("an event for an unknown id is a problem and never creates a row", () => {
    const view = foldDecisions([{ ...eventEnvelope("greg"), kind: "reviewed", id: A, note: null }]);
    expect(view.problems.map((problem) => problem.kind)).toEqual(["unknown-decision"]);
    expect(view.records).toEqual([]);
  });

  test("a second decided event is a problem and cannot replace the first", () => {
    const first = decided();
    const view = foldDecisions([first, decided(A, { chose: { option: "General", note: "Replace the decision" } })]);
    expect(view.problems.map((problem) => problem.kind)).toEqual(["duplicate-decision"]);
    expect(only(view).chose).toEqual(first.chose);
    expect(only(view).touches).toHaveLength(1);
  });

  test("an identical command retry is a no-op, while a differing payload is a conflict", () => {
    const first = decided(A, { ...eventEnvelope("overseer", undefined, "add-a") });
    const retry = { ...first, eventId: eventEnvelope().eventId };
    const conflict = { ...retry, eventId: eventEnvelope().eventId, why: "different bytes" };
    const view = foldDecisions([first, retry, conflict]);
    expect(view.problems.map((problem) => problem.kind)).toEqual(["command-conflict"]);
    expect(only(view).touches).toHaveLength(1);
    expect(view.version).toEqual({ events: 3, lastEventId: conflict.eventId });
  });

  test("a duplicate eventId is caught even when its commandId is also duplicated", () => {
    const first = decided(A, { ...eventEnvelope("overseer", undefined, "add-a") });
    const collision = { ...first };
    const view = foldDecisions([first, collision]);
    expect(view.problems.map((problem) => problem.kind)).toEqual(["duplicate-event"]);
    expect(only(view).reviewed).toBe(false);
  });

  test("an exact retry's event id is consumed for later duplicate detection", () => {
    const first = decided(A, { ...eventEnvelope("overseer", undefined, "add-a") });
    const retry = { ...first, eventId: eventEnvelope().eventId };
    const reused: DecisionEvent = {
      ...eventEnvelope("greg", undefined, "review-a"),
      eventId: retry.eventId,
      kind: "reviewed",
      id: A,
      note: null,
    };
    const view = foldDecisions([first, retry, reused]);
    expect(view.problems.map((problem) => problem.kind)).toEqual(["duplicate-event"]);
    expect(only(view).reviewed).toBe(false);
  });

  test("a decision dated after its envelope is a problem", () => {
    const view = foldDecisions([
      decided(A, { at: "2026-09-09T10:00:00.000Z", decidedAt: "2026-09-09T10:00:00.001Z" }),
    ]);
    expect(view.problems.map((problem) => problem.kind)).toEqual(["illegal-transition"]);
    expect(view.records).toEqual([]);
  });

  test("a review dated before the decision is a problem and leaves it unreviewed", () => {
    const view = foldDecisions([
      decided(A, { at: "2026-09-09T12:00:00.000Z", decidedAt: "2026-09-09T11:00:00.000Z" }),
      { ...eventEnvelope("greg", "2026-09-09T10:59:59.000Z"), kind: "reviewed", id: A, note: null },
    ]);
    expect(view.problems.map((problem) => problem.kind)).toEqual(["illegal-transition"]);
    expect(only(view).reviewed).toBe(false);

    const writtenLater = foldDecisions([
      decided(A, { at: "2026-09-09T12:00:00.000Z", decidedAt: "2026-09-09T11:00:00.000Z" }),
      { ...eventEnvelope("greg", "2026-09-09T11:30:00.000Z"), kind: "reviewed", id: A, note: null },
    ]);
    expect(writtenLater.problems).toEqual([]);
    expect(only(writtenLater).reviewed).toBe(true);
  });

  test("superseding requires an existing, earlier target and rejects self-reference", () => {
    const missing = foldDecisions([decided(B, { supersedes: A })]);
    expect(missing.problems.map((problem) => problem.kind)).toEqual(["invalid-supersession"]);
    expect(missing.records).toEqual([]);

    const self = foldDecisions([decided(A), decided(A, { supersedes: A, decidedAt: "2026-09-09T09:59:30.000Z" })]);
    expect(self.problems.map((problem) => problem.kind)).toEqual(["invalid-supersession"]);
    expect(self.problems[0]?.why).toContain("cannot supersede itself");

    const laterTarget = decided(A, { decidedAt: "2026-09-09T09:59:30.000Z" });
    const earlierSuccessor = decided(B, { decidedAt: "2026-09-09T09:59:00.000Z", supersedes: A });
    const later = foldDecisions([laterTarget, earlierSuccessor]);
    expect(later.problems.map((problem) => problem.kind)).toEqual(["invalid-supersession"]);
    expect(later.records).toHaveLength(1);
  });

  test("one record can be superseded only once", () => {
    const C = "dec-cccccccc";
    const view = foldDecisions([
      decided(A, { decidedAt: "2026-09-09T09:57:00.000Z" }),
      decided(B, { decidedAt: "2026-09-09T09:58:00.000Z", supersedes: A }),
      decided(C, { decidedAt: "2026-09-09T09:59:00.000Z", supersedes: A }),
    ]);
    expect(view.problems.map((problem) => problem.kind)).toEqual(["invalid-supersession"]);
    expect(only(view, A).supersededBy).toBe(B);
    expect(view.records.map((record) => record.id)).toEqual([A, B]);
  });

  test("a supersession chain cannot cycle", () => {
    const view = foldDecisions([
      decided(A, { decidedAt: "2026-09-09T09:57:00.000Z" }),
      decided(B, { decidedAt: "2026-09-09T09:58:00.000Z", supersedes: A }),
      decided(A, { decidedAt: "2026-09-09T09:59:00.000Z", supersedes: B }),
    ]);
    expect(view.problems.map((problem) => problem.kind)).toEqual(["invalid-supersession"]);
    expect(only(view, A).supersedes).toBeNull();
    expect(only(view, B).supersedes).toBe(A);
  });

  test("supersession replaces an unreviewed row and adds a pending row after review", () => {
    const unreviewed = foldDecisions([
      decided(A, { decidedAt: "2026-09-09T09:57:00.000Z" }),
      decided(B, { decidedAt: "2026-09-09T09:58:00.000Z", supersedes: A }),
    ]);
    expect(unreviewed.records.filter((record) => !record.reviewed && record.supersededBy === null)).toHaveLength(1);

    const reviewedBefore = foldDecisions([
      decided(A, { decidedAt: "2026-09-09T09:57:00.000Z" }),
      { ...eventEnvelope("greg", "2026-09-09T09:58:00.000Z"), kind: "reviewed", id: A, note: null },
    ]);
    const reviewed = foldDecisions([
      decided(A, { decidedAt: "2026-09-09T09:57:00.000Z" }),
      { ...eventEnvelope("greg", "2026-09-09T09:58:00.000Z"), kind: "reviewed", id: A, note: null },
      decided(B, { decidedAt: "2026-09-09T09:59:00.000Z", supersedes: A }),
    ]);
    const pendingBefore = reviewedBefore.records.filter((record) => !record.reviewed && record.supersededBy === null).length;
    const pendingAfter = reviewed.records.filter((record) => !record.reviewed && record.supersededBy === null).length;
    expect(pendingAfter).toBe(pendingBefore + 1);
    expect(only(reviewed, A)).toMatchObject({ reviewed: true, supersededBy: B });
    expect(only(reviewed, B)).toMatchObject({ reviewed: false, supersedes: A, supersededBy: null });
  });

  test("Greg reversing implies review, records the touch, and is terminal", () => {
    const first = decided();
    const reversal: DecisionEvent = { ...eventEnvelope("greg"), kind: "reversed", id: A, why: "A better option appeared" };
    const after: DecisionEvent = { ...eventEnvelope("greg"), kind: "reviewed", id: A, note: "again" };
    const repeated: DecisionEvent = { ...eventEnvelope("greg"), kind: "reversed", id: A, why: null };
    const view = foldDecisions([first, reversal, after, repeated]);
    expect(only(view)).toMatchObject({ reviewed: true, reversed: true, reversedWhy: "A better option appeared" });
    expect(only(view).touches.map((touch) => touch.kind)).toEqual(["decided", "reversed"]);
    expect(view.problems.map((problem) => problem.kind)).toEqual(["illegal-transition", "illegal-transition"]);
  });

  test("a second review is a problem, not a second touch — it would inflate the seven-day count", () => {
    const first = decided();
    const one: DecisionEvent = { ...eventEnvelope("greg", "2026-09-09T10:00:00.000Z"), kind: "reviewed", id: A, note: "read it" };
    const two: DecisionEvent = { ...eventEnvelope("greg", "2026-09-09T11:00:00.000Z"), kind: "reviewed", id: A, note: "again" };
    const view = foldDecisions([first, one, two]);
    /* The first review stands: its note and its instant are what happened, and a
       later duplicate must not move either. `trailingSevenDays.reviews` counts
       reviewed TOUCHES, so a second touch here is a review that never occurred. */
    expect(only(view)).toMatchObject({ reviewed: true, reviewNote: "read it", reviewedAt: "2026-09-09T10:00:00.000Z" });
    expect(only(view).touches.map((touch) => touch.kind)).toEqual(["decided", "reviewed"]);
    expect(view.problems.map((problem) => problem.kind)).toEqual(["illegal-transition"]);
  });

  test("a command retry is the SAME intent written later, so the envelope clock is not part of it", () => {
    /* Without this the retry arm is unreachable: every retry is written at a
       different instant, so including `at` makes each one a conflict and the
       idempotency key buys nothing it was added for. `decidedAt` IS part of the
       intent and stays in — see the conflict test below. */
    const one = decided(A, { commandId: "cmd-1", at: "2026-09-09T10:00:00.000Z", eventId: "c4a91f30-2d67-4b58-8e01-3f9a6c72d514" });
    const two = decided(A, { commandId: "cmd-1", at: "2026-09-09T10:00:05.000Z", eventId: "c4a91f30-2d67-4b58-8e01-3f9a6c72d515" });
    const view = foldDecisions([one, two]);
    expect(view.records).toHaveLength(1);
    expect(view.problems).toEqual([]);
  });

  test("seed problems are retained without making the fold throw", () => {
    const seed = [{ kind: "unreadable-line", why: "line 1 is bad", eventId: null }] as const;
    expect(foldDecisions([decided()], seed).problems).toEqual(seed);
  });
});

describe("reading and appending", () => {
  test("never-written, an intentionally empty record, and unreadable are distinct arms", () => {
    const never = tempRoot();
    expect(readDecisions(never).kind).toBe("never-written");

    const empty = tempRoot();
    writeFileSync(join(empty, DECISIONS_FILE), "");
    const emptyRead = readDecisions(empty);
    expect(emptyRead.kind).toBe("decisions");
    if (emptyRead.kind === "decisions") expect(emptyRead.view.records).toEqual([]);

    const lost = tempRoot();
    writeFileSync(join(lost, DECISIONS_INIT_FILE), "proof\n");
    expect(readDecisions(lost).kind).toBe("unreadable");

    const truncated = tempRoot();
    writeFileSync(join(truncated, DECISIONS_INIT_FILE), "proof\n");
    writeFileSync(join(truncated, DECISIONS_FILE), "");
    expect(readDecisions(truncated).kind).toBe("unreadable");
  });

  test("an unreadable line is retained as a problem beside parseable records", () => {
    const root = tempRoot();
    writeFileSync(join(root, DECISIONS_FILE), `${asLine(decided())}\nnot json\n`);
    const read = readDecisions(root);
    expect(read.kind).toBe("decisions");
    if (read.kind !== "decisions") throw new Error("expected decisions");
    expect(read.view.records).toHaveLength(1);
    expect(read.view.problems.map((problem) => problem.kind)).toEqual(["unreadable-line"]);
  });

  test("a successful append creates the marker, writes one JSONL event, and reports a new version", () => {
    const root = tempRoot();
    const event = decided();
    const result = appendEvents([event], { root });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.why);
    expect(existsSync(join(root, DECISIONS_INIT_FILE))).toBe(true);
    expect(readFileSync(join(root, DECISIONS_FILE), "utf8")).toBe(`${asLine(event)}\n`);
    expect(result.view.version).toEqual({ events: 1, lastEventId: event.eventId });
  });

  test("an identical command retry returns the original result without appending", () => {
    const root = tempRoot();
    const firstEvent = decided(A, { ...eventEnvelope("overseer", undefined, "command-a") });
    const first = appendEvents([firstEvent], { root });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.why);
    const before = readFileSync(join(root, DECISIONS_FILE), "utf8");
    const retry = { ...firstEvent, eventId: eventEnvelope().eventId };

    const result = appendEvents([retry], { root });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.why);
    expect(result.view).toEqual(first.view);
    expect(readFileSync(join(root, DECISIONS_FILE), "utf8")).toBe(before);
  });

  test("a reused command id with a different payload is refused as a command conflict", () => {
    const root = tempRoot();
    const firstEvent = decided(A, { ...eventEnvelope("overseer", undefined, "command-a") });
    expect(appendEvents([firstEvent], { root }).ok).toBe(true);
    const before = readFileSync(join(root, DECISIONS_FILE), "utf8");
    const conflict = { ...firstEvent, eventId: eventEnvelope().eventId, why: "different bytes" };

    const result = appendEvents([conflict], { root });

    expect(result).toMatchObject({ ok: false, code: "command-conflict" });
    expect(readFileSync(join(root, DECISIONS_FILE), "utf8")).toBe(before);
  });

  test("append reports duplicate-event even when the command id is duplicated too", () => {
    const root = tempRoot();
    const firstEvent = decided(A, { ...eventEnvelope("overseer", undefined, "command-a") });
    expect(appendEvents([firstEvent], { root }).ok).toBe(true);
    const before = readFileSync(join(root, DECISIONS_FILE), "utf8");

    const result = appendEvents([{ ...firstEvent }], { root });

    expect(result).toMatchObject({ ok: false, code: "would-break" });
    expect(result.ok ? "unexpected success" : result.why).toContain("duplicate-event");
    expect(readFileSync(join(root, DECISIONS_FILE), "utf8")).toBe(before);
  });

  test("stale versions and a held lock refuse without changing the file", () => {
    const root = tempRoot();
    const first = appendEvents([decided()], { root });
    expect(first.ok).toBe(true);
    const before = readFileSync(join(root, DECISIONS_FILE), "utf8");
    const stale = appendEvents([decided(B)], { root, expect: VERSION_ZERO });
    expect(stale).toMatchObject({ ok: false, code: "stale-version" });
    expect(readFileSync(join(root, DECISIONS_FILE), "utf8")).toBe(before);

    writeFileSync(
      join(root, DECISIONS_LOCK_FILE),
      `${JSON.stringify({ pid: process.pid, instanceId: "somebody-else", hostname: "box", startedAt: new Date().toISOString() })}\n`,
    );
    const locked = appendEvents([decided(B)], { root });
    expect(locked).toMatchObject({ ok: false, code: "locked" });
    expect(readFileSync(join(root, DECISIONS_FILE), "utf8")).toBe(before);
  });

  test("THE CLEAN-PREFIX PREFLIGHT refuses one illegal event despite one existing unreadable line", () => {
    const root = tempRoot();
    const first = decided();
    writeFileSync(join(root, DECISIONS_INIT_FILE), "proof\n");
    writeFileSync(join(root, DECISIONS_FILE), `${asLine(first)}\nnot an event\n`);
    const before = readFileSync(join(root, DECISIONS_FILE), "utf8");
    const illegal: DecisionEvent = {
      ...eventEnvelope("overseer"),
      kind: "reviewed",
      id: A,
      note: "the Overseer may not review itself",
    };

    const result = appendEvents([illegal], { root });

    expect(result).toMatchObject({ ok: false, code: "would-break" });
    expect(result.ok ? "unexpected success" : result.why).toContain("unauthorized-review");
    expect(readFileSync(join(root, DECISIONS_FILE), "utf8")).toBe(before);
    /* Mutation control: if appendEvents compares candidate.problems (1) with
       readDecisions(root).view.problems (also 1), as idea-queue.ts does, this
       exact assertion goes GREEN on the append and RED here because `result`
       becomes ok:true. The unrelated parse error must not pay for this event. */
  });

  test("a corrupt non-final line does not freeze legitimate future appends", () => {
    const root = tempRoot();
    const first = decided();
    writeFileSync(join(root, DECISIONS_INIT_FILE), "proof\n");
    writeFileSync(join(root, DECISIONS_FILE), `${asLine(first)}\nnot an event\n`);
    const review: DecisionEvent = { ...eventEnvelope("greg"), kind: "reviewed", id: A, note: null };
    const result = appendEvents([review], { root });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.why);
    expect(only(result.view).reviewed).toBe(true);
    expect(result.view.problems.map((problem) => problem.kind)).toEqual(["unreadable-line"]);
  });

  test("refuses empty batches and relative roots", () => {
    expect(appendEvents([], { root: tempRoot() })).toMatchObject({ ok: false, code: "refused" });
    expect(appendEvents([decided()], { root: "relative/decisions" })).toMatchObject({ ok: false, code: "refused" });
    expect(readDecisions("relative/decisions").kind).toBe("unreadable");
  });

  test("repairs a torn final line before appending", () => {
    const root = tempRoot();
    const first = decided();
    writeFileSync(join(root, DECISIONS_INIT_FILE), "proof\n");
    writeFileSync(join(root, DECISIONS_FILE), `${asLine(first)}\n{"kind":"review`);
    const review: DecisionEvent = { ...eventEnvelope("greg"), kind: "reviewed", id: A, note: null };
    const result = appendEvents([review], { root });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.why);
    expect(result.repaired.torn).toBe(true);
    expect(readFileSync(join(root, DECISIONS_FILE), "utf8").split("\n").filter(Boolean)).toHaveLength(2);
  });

  test("viewOf preserves unreadable instead of flattening it", () => {
    const root = tempRoot();
    writeFileSync(join(root, DECISIONS_INIT_FILE), "proof\n");
    expect(viewOf(readDecisions(root))).toBeNull();
    expect(viewOf(readDecisions(tempRoot()))).toEqual(expect.objectContaining({ records: [] }));
  });
});
