/**
 * Schema 2 of the decision record: who DECIDED, separate from who RECORDED,
 * and the fields that let Greg triage what he has not seen.
 *
 * Plan 260910e § "Decisions: extend the one record". The claims pinned here:
 * schema-1 lines are never migrated and never mislabelled; every new field is
 * required on a new line; `daemon` can only have copied a session's decision;
 * nothing an author says makes a decision look reviewed; and both OLD readers
 * — the event parser and the browser's payload parser, frozen copies of each —
 * refuse the new shapes rather than misreading them. Every event id here is
 * minted at run time, so no uuid literal is shared with another test file.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  DECISIONS_FILE,
  DECISIONS_SCHEMA,
  appendEvents,
  envelope,
  foldDecisions,
  parseEvent,
  parseEventDetailed,
  readDecisions,
  type DecidedV2Event,
  type DecisionEvent,
  type DecisionRecord,
  type DecisionView,
} from "../tools/overseer/decisions.js";
import { isPendingReview } from "../tools/fleet/decisions-view.js";
import { decisionsPayload } from "../tools/fleet/routes-decisions.js";
import { frozenV1ParseEvent } from "./fixtures/decisions-v1-frozen/event-parser.js";
import { frozenV1ParseDecisionsFeed } from "./fixtures/decisions-v1-frozen/client-parser.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-decisions-schema2-test-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const S = "dec-s2s2s2s2";
/* Both ids must be VALID ids: an earlier draft used `dec-o2o2o2o2`, and `o` is
   not in the id alphabet, so the frozen old parser refused it for the id — the
   schema test went green before schema 2 existed. */
const O = "dec-x2x2x2x2";
const SESSION_TOKEN = "boot-s2:42421:7771";

/** A schema-1 line exactly as V1 wrote them: the fields `tests/overseer-decisions.test.ts` uses. */
function legacyDecidedLine(id: string, at: string): string {
  return JSON.stringify({
    schema: 1,
    eventId: randomUUID(),
    commandId: null,
    at,
    by: "overseer",
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
  });
}

function legacyReviewLine(id: string, at: string): string {
  return JSON.stringify({ schema: 1, eventId: randomUUID(), commandId: null, at, by: "greg", kind: "reviewed", id, note: "fine" });
}

function sessionDecided(over: Partial<DecidedV2Event> = {}): DecidedV2Event {
  return {
    ...envelope("daemon", { at: "2026-09-10T10:00:00.000Z" }),
    kind: "decided",
    id: S,
    decidedAt: "2026-09-10T09:59:00.000Z",
    class: "decision",
    question: "Should the drain refuse a report whose artefact is missing?",
    options: [
      { name: "Refuse", tradeoffs: "Loses the claim, which is the thing worth seeing." },
      { name: "Keep it not-found", tradeoffs: "Shows a discrepancy Greg should see." },
    ],
    chose: { option: "Keep it not-found", note: null },
    why: "A missing artefact is itself a discrepancy.",
    advisers: ["sol"],
    bearsOn: { sessions: [], plan: "docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md" },
    supersedes: null,
    author: {
      kind: "session",
      name: "work-reports",
      execution: { kind: "verified", token: SESSION_TOKEN, since: "2026-09-10T08:00:00.000Z" },
    },
    consequence: "medium",
    reversibility: "costly",
    domain: "technical",
    recommendation: "Keep it; revisit if the not-found rows get noisy.",
    evidence: [
      { ref: { kind: "commit", sha: "f9970832" }, check: { state: "on-dev" } },
      { ref: { kind: "path", path: "tools/fleet/artefact-ref.ts" }, check: { state: "found-locally" } },
    ],
    gregAsked: "no",
    confidence: "medium",
    ...over,
  };
}

function overseerDecided(over: Partial<DecidedV2Event> = {}): DecidedV2Event {
  return sessionDecided({
    ...envelope("overseer", { at: "2026-09-10T10:00:00.000Z" }),
    id: O,
    author: { kind: "overseer" },
    ...over,
  });
}

function only(view: DecisionView, id: string): DecisionRecord {
  const record = view.records.find((candidate) => candidate.id === id);
  if (record === undefined) throw new Error(`no decision ${id}`);
  return record;
}

function readView(root: string): DecisionView {
  const read = readDecisions(root);
  if (read.kind !== "decisions") throw new Error(`expected decisions, got ${read.kind}`);
  return read.view;
}

describe("schema 1 is never migrated and never mislabelled", () => {
  test("a V1 log folds unchanged, with the author legacy-unrecorded and every new field not-recorded", () => {
    const root = tempRoot();
    const decidedLine = legacyDecidedLine(S, "2026-09-09T10:00:00.000Z");
    writeFileSync(join(root, DECISIONS_FILE), `${decidedLine}\n${legacyReviewLine(S, "2026-09-09T11:00:00.000Z")}\n`);

    const view = readView(root);

    expect(view.problems).toEqual([]);
    /* Not `overseer`: V1's own header says its assumptions were made under
       Greg's standing decision, so naming the Overseer as author would be false. */
    expect(only(view, S)).toMatchObject({
      recordedBy: "overseer",
      author: { kind: "legacy-unrecorded" },
      consequence: "not-recorded",
      reversibility: "not-recorded",
      domain: "not-recorded",
      recommendation: { kind: "not-recorded" },
      evidence: { kind: "not-recorded" },
      gregAsked: "not-recorded",
      confidence: "not-recorded",
      reviewed: true,
      reviewNote: "fine",
      question: "Which implementation should we use?",
    });
    expect(parseEvent(decidedLine)).toMatchObject({ schema: 1, kind: "decided", id: S });
  });

  test("text a V1 line was allowed to hold is still allowed — schema-2 bounds are not retroactive", () => {
    const withTab = JSON.parse(legacyDecidedLine(S, "2026-09-09T10:00:00.000Z")) as Record<string, unknown>;
    withTab["why"] = "first line\nsecond line";
    expect(parseEvent(JSON.stringify(withTab))).not.toBeNull();
  });
});

describe("schema 2 round-trips", () => {
  test("a session's decision, recorded by the drain, survives appendEvents and readDecisions exactly", () => {
    const root = tempRoot();
    const event = sessionDecided();

    const result = appendEvents([event], { root });

    expect(result.ok).toBe(true);
    const line = readFileSync(join(root, DECISIONS_FILE), "utf8").trimEnd();
    expect(JSON.parse(line)).toMatchObject({ schema: 2, by: "daemon" });
    expect(parseEvent(line)).toEqual(event);
    const record = only(readView(root), S);
    expect(record).toMatchObject({
      recordedBy: "daemon",
      author: event.author,
      consequence: "medium",
      reversibility: "costly",
      domain: "technical",
      recommendation: { kind: "recorded", value: event.recommendation },
      evidence: { kind: "recorded", value: event.evidence },
      gregAsked: "no",
      confidence: "medium",
      reviewed: false,
    });
    expect(record.touches).toEqual([expect.objectContaining({ kind: "decided", by: "daemon" })]);
  });

  test("new events are written at schema 2, and a null recommendation and confidence are recorded, not missing", () => {
    expect(DECISIONS_SCHEMA).toBe(2);
    expect(envelope("overseer").schema).toBe(2);
    const event = overseerDecided({ recommendation: null, confidence: null, evidence: [] });
    const record = only(foldDecisions([event]), O);
    expect(record).toMatchObject({
      author: { kind: "overseer" },
      recommendation: { kind: "recorded", value: null },
      confidence: null,
      evidence: { kind: "recorded", value: [] },
    });
  });

  test("a changed schema-2 field under one command id is a conflict, not a retry", () => {
    const first = overseerDecided({ commandId: "same-intent" });
    const retry = { ...first, eventId: randomUUID(), at: "2026-09-10T10:00:05.000Z" };
    const changed = { ...first, eventId: randomUUID(), consequence: "high" as const };
    expect(foldDecisions([first, retry]).problems).toEqual([]);
    expect(foldDecisions([first, changed]).problems.map((problem) => problem.kind)).toEqual(["command-conflict"]);
  });
});

describe("every new field is required on a schema-2 decided line", () => {
  test.each(["author", "consequence", "reversibility", "domain", "recommendation", "evidence", "gregAsked", "confidence"])(
    "refuses one missing %s, and says which",
    (field) => {
      const raw: Record<string, unknown> = { ...sessionDecided() };
      delete raw[field];
      expect(parseEvent(JSON.stringify(raw))).toBeNull();
      const detailed = parseEventDetailed(JSON.stringify(raw));
      expect(detailed.ok).toBe(false);
      if (!detailed.ok) expect(detailed.why).toContain(field);
    },
  );

  test.each([
    ["consequence", { consequence: "critical" }],
    ["reversibility", { reversibility: "maybe" }],
    ["domain", { domain: "politics" }],
    ["gregAsked", { gregAsked: "yes" }],
    ["confidence", { confidence: "certain" }],
    ["recommendation", { recommendation: 42 }],
    ["evidence", { evidence: [{ ref: { kind: "path", path: "../etc/passwd" }, check: { state: "on-dev" } }] }],
    ["evidence check", { evidence: [{ ref: { kind: "commit", sha: "f9970832" }, check: { state: "found" } }] }],
    ["author kind", { author: { kind: "robot" } }],
    ["session name", { author: { kind: "session", name: "has space", execution: { kind: "not-found" } } }],
    ["session execution", { author: { kind: "session", name: "work-reports", execution: null } }],
  ])("refuses an invalid %s", (_field, patch) => {
    expect(parseEvent(JSON.stringify({ ...sessionDecided(), ...patch }))).toBeNull();
  });

  test("refuses a control character in the recommendation, and a bidi override in schema-2 prose", () => {
    const bell = String.fromCharCode(7);
    const rlo = String.fromCharCode(0x202e);
    expect(parseEvent(JSON.stringify(sessionDecided({ recommendation: `ring${bell}` })))).toBeNull();
    expect(parseEvent(JSON.stringify(sessionDecided({ question: `abc${rlo}fed?` })))).toBeNull();
    expect(parseEvent(JSON.stringify(sessionDecided({ recommendation: "x".repeat(2001) })))).toBeNull();
  });

  test("appendEvents refuses an event its own reader would refuse, and writes nothing", () => {
    const root = tempRoot();
    const result = appendEvents([sessionDecided({ recommendation: `line one\nline two` })], { root });
    expect(result).toMatchObject({ ok: false, code: "refused" });
    expect(result.ok ? "" : result.why).toContain("recommendation");
    expect(readDecisions(root).kind).toBe("never-written");
  });

  test("schema 3 is an unreadable line, never a row", () => {
    const root = tempRoot();
    writeFileSync(join(root, DECISIONS_FILE), `${JSON.stringify({ ...sessionDecided(), schema: 3 })}\n`);
    const view = readView(root);
    expect(view.records).toEqual([]);
    expect(view.problems.map((problem) => problem.kind)).toEqual(["unreadable-line"]);
  });
});

describe("the recorder is not the author, and neither is a reviewer", () => {
  test("daemon may only have recorded a session's schema-2 decision", () => {
    expect(parseEvent(JSON.stringify(sessionDecided()))).not.toBeNull();
    for (const author of [{ kind: "overseer" }, { kind: "greg" }]) {
      expect(parseEvent(JSON.stringify({ ...sessionDecided(), author }))).toBeNull();
    }
    const legacyByDaemon = { ...JSON.parse(legacyDecidedLine(S, "2026-09-09T10:00:00.000Z")), by: "daemon" };
    expect(parseEvent(JSON.stringify(legacyByDaemon))).toBeNull();
    const reviewByDaemon = { ...envelope("greg"), by: "daemon", kind: "reviewed", id: S, note: null };
    expect(parseEvent(JSON.stringify(reviewByDaemon))).toBeNull();
  });

  test.each(["daemon", "overseer"] as const)("a review recorded by %s does not review, whoever the author is", (by) => {
    for (const decision of [sessionDecided(), overseerDecided({ id: S, author: { kind: "greg" } })]) {
      const review = { ...envelope("greg", { at: "2026-09-10T11:00:00.000Z" }), by, kind: "reviewed", id: S, note: "ok" };
      const view = foldDecisions([decision, review as unknown as DecisionEvent]);
      expect(view.problems.map((problem) => problem.kind)).toEqual(["unauthorized-review"]);
      expect(only(view, S).reviewed).toBe(false);
      expect(isPendingReview(only(view, S))).toBe(true);
    }
  });

  test("a session-authored decision is pending review, and gregAsked cannot change that", () => {
    const view = foldDecisions([sessionDecided({ gregAsked: "asked-answered" })]);
    expect(only(view, S)).toMatchObject({ reviewed: false, gregAsked: "asked-answered" });
    expect(isPendingReview(only(view, S))).toBe(true);
  });
});

describe("the frozen old readers refuse the new shapes", () => {
  test("the V1 event parser reads a V1 line and returns null for the line this build now writes", () => {
    expect(frozenV1ParseEvent(legacyDecidedLine(S, "2026-09-09T10:00:00.000Z"))).not.toBeNull();
    /* The positive control above is what makes this null mean something. The
       line is built through `envelope`, the same path every writer uses, so a
       build that still stamped schema 1 would make the old parser accept it. */
    const current = { ...overseerDecided(), ...envelope("overseer", { at: "2026-09-10T10:00:00.000Z" }) };
    expect(frozenV1ParseEvent(JSON.stringify(current))).toBeNull();
  });

  test("the V1 browser refuses the payload the route now sends, in a sentence naming its version", () => {
    const root = tempRoot();
    expect(appendEvents([sessionDecided()], { root }).ok).toBe(true);
    const payload = decisionsPayload({
      decisionFileSize: () => null,
      readDecisions: () => readDecisions(root),
      loadCheckpoint: () => ({ kind: "absent" }),
      now: () => new Date("2026-09-10T12:00:00.000Z"),
    });
    expect(payload.kind).toBe("decisions");

    const verdict = frozenV1ParseDecisionsFeed(JSON.parse(JSON.stringify(payload)));

    expect(verdict.kind).toBe("no-answer");
    expect(verdict.why).toContain("this browser can read version 1");
    // Positive control: the same frozen parser accepts a payload at the old number.
    expect(
      frozenV1ParseDecisionsFeed({
        ...payload,
        schema: 1,
        rows: [],
        aggregates: { kind: "counts", notYetReviewed: 0, trailingSevenDays: { decisions: 0, reviews: 0, reversals: 0 } },
      }).kind,
    ).toBe("decisions");
  });
});
