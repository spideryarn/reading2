/** The decisions client: strict wire parsing through an injected request seam. */
import { describe, expect, it, vi } from "vitest";

import {
  DECISIONS_FETCH_TIMEOUT_MS,
  decisionMatchesSearch,
  makeDecisionsApi,
  parseDecisionsFeed,
  type DecisionsRequest,
} from "../tools/fleet/web/src/decisions-client";
import { decisionMatchesSearch as cliDecisionMatchesSearch } from "../tools/fleet/decisions-view.js";
import type { DecisionRow, DecisionWireRecord, DecisionsFeed } from "../tools/fleet/wire";

const EMPTY: DecisionsFeed = {
  schema: 2,
  kind: "decisions",
  version: "0",
  path: "/tmp/fake/decisions.jsonl",
  composedAt: "2026-09-09T12:00:00.000Z",
  checkpoint: { kind: "unavailable", why: "the Overseer checkpoint is absent" },
  aggregates: {
    kind: "counts",
    notYetReviewed: 0,
    trailingSevenDays: { decisions: 0, reviews: 0, reversals: 0 },
  },
  rows: [],
  historyWithheld: 0,
  problems: [],
};

const ROW: DecisionRow = {
  record: {
    id: "dec-aaaaaaa2",
    recordedBy: "overseer",
    class: "decision",
    question: "Should the bounded route ship all unseen decisions?",
    options: [
      { name: "Cap everything", tradeoffs: "Could hide an unseen decision." },
      { name: "Protect unseen", tradeoffs: "Must fail loudly if they do not fit." },
    ],
    chose: { option: "Protect unseen", note: null },
    why: "The record is the other half of delegated authority.",
    advisers: ["sol"],
    bearsOn: {
      sessions: [
        {
          name: "decisions-mode",
          execution: { kind: "verified", token: "boot-a:42001:711", since: "2026-09-09T10:00:00.000Z" },
        },
      ],
      plan: "docs/plans/260909e-decisions-made-the-overseer-decision-record-its-cli-and-its-dashboard-mode.md",
    },
    decidedAt: "2026-09-09T11:00:00.000Z",
    supersedes: null,
    supersededBy: null,
    reviewed: false,
    reviewedAt: null,
    reviewNote: null,
    reversed: false,
    reversedAt: null,
    reversedWhy: null,
    touches: [{ kind: "decided", at: "2026-09-09T11:00:00.000Z", by: "overseer", what: "decision decided" }],
    author: { kind: "overseer" },
    consequence: "high",
    reversibility: "costly",
    domain: "technical",
    recommendation: { kind: "recorded", value: "Keep protecting unseen rows." },
    evidence: { kind: "recorded", value: [{ ref: { kind: "commit", sha: "f9970832" }, check: { state: "on-dev" } }] },
    gregAsked: "no",
    confidence: null,
  },
  ageMs: 3_600_000,
  pendingReview: true,
  sessions: [
    {
      name: "decisions-mode",
      state: { kind: "same-run-as-last-verified", since: "2026-09-09T10:00:00.000Z" },
    },
  ],
};

const WITH_ROW: DecisionsFeed = {
  ...EMPTY,
  aggregates: {
    kind: "counts",
    notYetReviewed: 1,
    trailingSevenDays: { decisions: 1, reviews: 0, reversals: 0 },
  },
  rows: [ROW],
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("the injectable seam", () => {
  it("drives the real HTTP client through an injected request, without stubbing global fetch", async () => {
    const calls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
    const request: DecisionsRequest = async (input, init) => {
      calls.push({ input, init });
      return response(EMPTY);
    };

    const view = await makeDecisionsApi(request).fetch();

    expect(view).toEqual(EMPTY);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("api/decisions");
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("strict parsing", () => {
  it("accepts a complete nested row as the parser's positive control", () => {
    expect(parseDecisionsFeed(WITH_ROW)).toEqual(WITH_ROW);
  });

  it("accepts each server arm without changing whose voice its reason is in", () => {
    expect(
      parseDecisionsFeed({
        schema: 2,
        kind: "never-written",
        composedAt: "2026-09-09T12:00:00.000Z",
        why: "nobody has written it",
      }),
    ).toEqual({
      schema: 2,
      kind: "never-written",
      composedAt: "2026-09-09T12:00:00.000Z",
      why: "nobody has written it",
    });
    expect(
      parseDecisionsFeed({
        schema: 2,
        kind: "unreadable",
        composedAt: "2026-09-09T12:00:00.000Z",
        why: "line 4 is broken",
      }),
    ).toEqual({
      schema: 2,
      kind: "unreadable",
      composedAt: "2026-09-09T12:00:00.000Z",
      why: "line 4 is broken",
    });
    expect(
      parseDecisionsFeed({
        schema: 2,
        kind: "oversized-unreviewed",
        composedAt: "2026-09-09T12:00:00.000Z",
        why: "the unseen rows do not fit",
        unreviewedCount: 2,
        limitBytes: 2 * 1024 * 1024,
      }),
    ).toEqual({
      schema: 2,
      kind: "oversized-unreviewed",
      composedAt: "2026-09-09T12:00:00.000Z",
      why: "the unseen rows do not fit",
      unreviewedCount: 2,
      limitBytes: 2 * 1024 * 1024,
    });
    expect(
      parseDecisionsFeed({
        schema: 2,
        kind: "oversized-file",
        composedAt: "2026-09-09T12:00:00.000Z",
        why: "the input exceeds the synchronous-read bound",
        sizeBytes: 4_000_001,
        limitBytes: 4_000_000,
      }),
    ).toEqual({
      schema: 2,
      kind: "oversized-file",
      composedAt: "2026-09-09T12:00:00.000Z",
      why: "the input exceeds the synchronous-read bound",
      sizeBytes: 4_000_001,
      limitBytes: 4_000_000,
    });
  });

  it.each([
    ["wrong schema", { ...EMPTY, schema: 3 }],
    ["the previous schema", { ...EMPTY, schema: 1 }],
    ["missing aggregate", { ...EMPTY, aggregates: undefined }],
    ["coerced count", { ...EMPTY, historyWithheld: "0" }],
    ["malformed nested count", { ...EMPTY, aggregates: { kind: "counts", notYetReviewed: "0" } }],
    ["malformed row", { ...EMPTY, rows: [{ pendingReview: false }] }],
    [
      "malformed nested option",
      {
        ...WITH_ROW,
        rows: [{ ...ROW, record: { ...ROW.record, options: [{ name: "Only", tradeoffs: 7 }] } }],
      },
    ],
    [
      "malformed nested timestamp",
      { ...WITH_ROW, rows: [{ ...ROW, record: { ...ROW.record, reviewedAt: "not a date" } }] },
    ],
    [
      "permissive JavaScript date rather than an instant",
      { ...WITH_ROW, composedAt: "0" },
    ],
    [
      "duplicate options",
      {
        ...WITH_ROW,
        rows: [
          {
            ...ROW,
            record: {
              ...ROW.record,
              options: [
                { name: "Same", tradeoffs: "One." },
                { name: " Same ", tradeoffs: "Still one." },
              ],
            },
          },
        ],
      },
    ],
    [
      "a choice outside the options",
      { ...WITH_ROW, rows: [{ ...ROW, record: { ...ROW.record, chose: { option: "Third way", note: null } } }] },
    ],
    [
      "contradictory advisers",
      { ...WITH_ROW, rows: [{ ...ROW, record: { ...ROW.record, advisers: ["nobody", "sol"] } }] },
    ],
    [
      "duplicate session names",
      {
        ...WITH_ROW,
        rows: [
          {
            ...ROW,
            record: {
              ...ROW.record,
              bearsOn: {
                ...ROW.record.bearsOn,
                sessions: [
                  ...ROW.record.bearsOn.sessions,
                  ...ROW.record.bearsOn.sessions,
                ],
              },
            },
          },
        ],
      },
    ],
    [
      "same-run state without the last verified instant",
      {
        ...WITH_ROW,
        rows: [
          {
            ...ROW,
            sessions: [{ name: "decisions-mode", state: { kind: "same-run-as-last-verified" } }],
          },
        ],
      },
    ],
    [
      "a headline count that hides a pending row",
      { ...WITH_ROW, rows: [] },
    ],
    [
      "a reviewed record labelled pending",
      {
        ...WITH_ROW,
        rows: [
          {
            ...ROW,
            record: { ...ROW.record, reviewed: true, reviewedAt: "2026-09-09T11:30:00.000Z" },
          },
        ],
      },
    ],
    [
      "a superseded predecessor labelled pending",
      {
        ...WITH_ROW,
        rows: [{ ...ROW, record: { ...ROW.record, supersededBy: "dec-bbbbbbb2" } }],
      },
    ],
    [
      "counts despite a record problem",
      {
        ...EMPTY,
        problems: [{ kind: "unreadable-line", why: "line 4 is broken", eventId: null }],
      },
    ],
    ["bad date", { ...EMPTY, composedAt: "not a date" }],
    [
      "a silence without a composition time",
      { schema: 2, kind: "never-written", why: "nobody has written it" },
    ],
  ])("rejects %s instead of coercing it", (_name, malformed) => {
    expect(parseDecisionsFeed(malformed).kind).toBe("no-answer");
  });

  it.each([
    [
      "reviewed without a reviewed timestamp",
      {
        ...ROW.record,
        reviewed: true,
        touches: [
          ...ROW.record.touches,
          { kind: "reviewed", at: "2026-09-09T11:30:00.000Z", by: "greg", what: "reviewed" },
        ],
      },
    ],
    [
      "reviewed without a Greg-authored review touch",
      { ...ROW.record, reviewed: true, reviewedAt: "2026-09-09T11:30:00.000Z" },
    ],
    [
      "reversed without being reviewed",
      {
        ...ROW.record,
        reversed: true,
        reversedAt: "2026-09-09T11:30:00.000Z",
        reversedWhy: "the premise changed",
        touches: [
          ...ROW.record.touches,
          { kind: "reversed", at: "2026-09-09T11:30:00.000Z", by: "greg", what: "reversed" },
        ],
      },
    ],
    [
      "reversed without a Greg-authored reversal touch",
      {
        ...ROW.record,
        reviewed: true,
        reviewedAt: "2026-09-09T11:30:00.000Z",
        reversed: true,
        reversedAt: "2026-09-09T11:30:00.000Z",
        reversedWhy: "the premise changed",
        touches: [
          ...ROW.record.touches,
          { kind: "reviewed", at: "2026-09-09T11:30:00.000Z", by: "greg", what: "reviewed" },
        ],
      },
    ],
  ])("rejects a record that is %s", (_name, impossibleRecord) => {
    const pendingReview = !impossibleRecord.reviewed && impossibleRecord.supersededBy === null;
    const malformed = {
      ...WITH_ROW,
      aggregates: {
        kind: "counts" as const,
        notYetReviewed: pendingReview ? 1 : 0,
        trailingSevenDays: { decisions: 1, reviews: 0, reversals: 0 },
      },
      rows: [{ ...ROW, pendingReview, record: impossibleRecord }],
    };
    expect(parseDecisionsFeed(malformed).kind).toBe("no-answer");
  });
});

function withRecord(record: DecisionWireRecord): DecisionsFeed {
  if (WITH_ROW.kind !== "decisions") throw new Error("unreachable");
  return { ...WITH_ROW, rows: [{ ...ROW, record }] };
}

const SESSION_RECORD: DecisionWireRecord = {
  ...ROW.record,
  recordedBy: "daemon",
  author: {
    kind: "session",
    name: "work-reports",
    execution: { kind: "verified", token: "boot-a:42001:711", since: "2026-09-09T10:00:00.000Z" },
  },
  touches: [{ kind: "decided", at: "2026-09-09T11:00:00.000Z", by: "daemon", what: "decision decided" }],
  gregAsked: "asked-answered",
  confidence: "low",
  evidence: {
    kind: "recorded",
    value: [
      { ref: { kind: "commit", sha: "f9970832" }, check: { state: "found-locally" } },
      { ref: { kind: "path", path: "tools/fleet/artefact-ref.ts" }, check: { state: "on-dev" } },
      { ref: { kind: "decision", id: "dec-a3k9mq2p" }, check: { state: "found" } },
      { ref: { kind: "queue-item", id: "qi-evwdxpkf" }, check: { state: "unchecked", why: "the queue was locked" } },
    ],
  },
};

const LEGACY_RECORD: DecisionWireRecord = {
  ...ROW.record,
  author: { kind: "legacy-unrecorded" },
  consequence: "not-recorded",
  reversibility: "not-recorded",
  domain: "not-recorded",
  recommendation: { kind: "not-recorded" },
  evidence: { kind: "not-recorded" },
  gregAsked: "not-recorded",
  confidence: "not-recorded",
};

describe("schema 2 of the payload", () => {
  it("accepts a session's decision recorded by the drain, and a V1 row with nothing recorded", () => {
    expect(parseDecisionsFeed(withRecord(SESSION_RECORD))).toEqual(withRecord(SESSION_RECORD));
    expect(parseDecisionsFeed(withRecord(LEGACY_RECORD))).toEqual(withRecord(LEGACY_RECORD));
  });

  it("refuses version 1 with a sentence, rather than drawing it without its authors", () => {
    const view = parseDecisionsFeed({ ...EMPTY, schema: 1 });
    expect(view).toEqual({
      kind: "no-answer",
      why: "this browser can read version 2 of the decisions API; the server sent 1",
    });
  });

  it.each(["author", "consequence", "reversibility", "domain", "recommendation", "evidence", "gregAsked", "confidence"])(
    "refuses a record missing %s",
    (field) => {
      const record: Record<string, unknown> = { ...ROW.record };
      delete record[field];
      expect(parseDecisionsFeed({ ...WITH_ROW, rows: [{ ...ROW, record }] }).kind).toBe("no-answer");
    },
  );

  it.each([
    ["daemon recording an Overseer-authored decision", { ...ROW.record, recordedBy: "daemon" }],
    [
      "a review touch by the daemon",
      {
        ...SESSION_RECORD,
        touches: [...SESSION_RECORD.touches, { kind: "reviewed", at: "2026-09-09T11:30:00.000Z", by: "daemon", what: "reviewed" }],
      },
    ],
    ["a session name outside its rule", { ...SESSION_RECORD, author: { kind: "session", name: "has space", execution: { kind: "not-found" } } }],
    ["a consequence outside its values", { ...ROW.record, consequence: "critical" }],
    ["a bare null recommendation", { ...ROW.record, recommendation: null }],
    [
      "evidence whose path climbs out of the repository",
      { ...ROW.record, evidence: { kind: "recorded", value: [{ ref: { kind: "path", path: "../x" }, check: { state: "on-dev" } }] } },
    ],
    [
      "evidence whose check does not fit its kind",
      { ...ROW.record, evidence: { kind: "recorded", value: [{ ref: { kind: "commit", sha: "f9970832" }, check: { state: "found" } }] } },
    ],
  ])("refuses %s", (_name, record) => {
    expect(parseDecisionsFeed({ ...WITH_ROW, rows: [{ ...ROW, record }] }).kind).toBe("no-answer");
  });
});

describe("search", () => {
  it("matches case-insensitively over the fields the CLI searches, and the two agree field by field", () => {
    const record: DecisionWireRecord = {
      ...SESSION_RECORD,
      question: "Question about ALPHA?",
      options: [
        { name: "Bravo option", tradeoffs: "Costs charlie." },
        { name: "Other", tradeoffs: "Nothing much." },
      ],
      chose: { option: "Bravo option", note: "Delta note." },
      why: "Because of echo.",
      recommendation: { kind: "recorded", value: "Foxtrot again." },
      bearsOn: {
        sessions: [{ name: "golf-session", execution: { kind: "not-found" } }],
        plan: "docs/plans/hotel.md",
      },
    };
    for (const query of ["alpha", "BRAVO", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "work-reports", ""]) {
      expect(decisionMatchesSearch(record, query)).toBe(true);
      expect(cliDecisionMatchesSearch(record, query)).toBe(true);
    }
    for (const query of ["india", "f9970832", "asked-answered"]) {
      expect(decisionMatchesSearch(record, query)).toBe(false);
      expect(cliDecisionMatchesSearch(record, query)).toBe(false);
    }
  });
});

describe("this browser never got an answer", () => {
  it("times out a request that never answers, in this browser's voice", async () => {
    expect(DECISIONS_FETCH_TIMEOUT_MS).toBe(10_000);
    vi.useFakeTimers();
    try {
      const request: DecisionsRequest = (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")));
        });
      const pending = makeDecisionsApi(request).fetch();

      await vi.advanceTimersByTimeAsync(9_999);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await vi.runAllTicks();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      const view = await pending;

      expect(view.kind).toBe("no-answer");
      if (view.kind !== "no-answer") throw new Error("unreachable");
      expect(view.why).toContain("this browser got no answer");
      expect(view.why).toContain("10s");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports caller cancellation as cancellation, not as a ten-second wait", async () => {
    const request: DecisionsRequest = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")));
      });
    const controller = new AbortController();
    const pending = makeDecisionsApi(request).fetch(controller.signal);

    controller.abort();
    const view = await pending;

    expect(view.kind).toBe("no-answer");
    if (view.kind !== "no-answer") throw new Error("unreachable");
    expect(view.why).toContain("cancelled");
    expect(view.why).not.toContain("within 10s");
  });

  it("keeps a network failure distinct from both server-side silences", async () => {
    const api = makeDecisionsApi(async () => {
      throw new TypeError("network is unreachable");
    });

    const view = await api.fetch();

    expect(view.kind).toBe("no-answer");
    if (view.kind !== "no-answer") throw new Error("unreachable");
    expect(view.why).toContain("this browser");
    expect(view.why).toContain("network is unreachable");
    expect(view.kind).not.toBe("never-written");
    expect(view.kind).not.toBe("unreadable");
  });

  it("uses this browser's voice for malformed JSON from an answering server", async () => {
    const api = makeDecisionsApi(async () => new Response("not json", { status: 200 }));
    const view = await api.fetch();

    expect(view.kind).toBe("no-answer");
    if (view.kind !== "no-answer") throw new Error("unreachable");
    expect(view.why).toContain("this browser");
    expect(view.why).toContain("not JSON");
  });
});
