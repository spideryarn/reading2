/** The decisions client: strict wire parsing through an injected request seam. */
import { describe, expect, it, vi } from "vitest";

import {
  DECISIONS_FETCH_TIMEOUT_MS,
  makeDecisionsApi,
  parseDecisionsFeed,
  type DecisionsRequest,
} from "../tools/fleet/web/src/decisions-client";
import type { DecisionRow, DecisionsFeed } from "../tools/fleet/wire";

const EMPTY: DecisionsFeed = {
  schema: 1,
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
  reviewedWithheld: 0,
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
  },
  ageMs: 3_600_000,
  pendingReview: true,
  sessions: [{ name: "decisions-mode", state: { kind: "live" } }],
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
    expect(parseDecisionsFeed({ schema: 1, kind: "never-written", why: "nobody has written it" })).toEqual({
      schema: 1,
      kind: "never-written",
      why: "nobody has written it",
    });
    expect(parseDecisionsFeed({ schema: 1, kind: "unreadable", why: "line 4 is broken" })).toEqual({
      schema: 1,
      kind: "unreadable",
      why: "line 4 is broken",
    });
    expect(
      parseDecisionsFeed({
        schema: 1,
        kind: "oversized-unreviewed",
        why: "the unseen rows do not fit",
        unreviewedCount: 2,
        limitBytes: 2 * 1024 * 1024,
      }),
    ).toEqual({
      schema: 1,
      kind: "oversized-unreviewed",
      why: "the unseen rows do not fit",
      unreviewedCount: 2,
      limitBytes: 2 * 1024 * 1024,
    });
  });

  it.each([
    ["wrong schema", { ...EMPTY, schema: 2 }],
    ["missing aggregate", { ...EMPTY, aggregates: undefined }],
    ["coerced count", { ...EMPTY, reviewedWithheld: "0" }],
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
  ])("rejects %s instead of coercing it", (_name, malformed) => {
    expect(parseDecisionsFeed(malformed).kind).toBe("no-answer");
  });
});

describe("this browser never got an answer", () => {
  it("times out a request that never answers, in this browser's voice", async () => {
    vi.useFakeTimers();
    try {
      const request: DecisionsRequest = (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")));
        });
      const pending = makeDecisionsApi(request).fetch();

      await vi.advanceTimersByTimeAsync(DECISIONS_FETCH_TIMEOUT_MS);
      const view = await pending;

      expect(view.kind).toBe("no-answer");
      if (view.kind !== "no-answer") throw new Error("unreachable");
      expect(view.why).toContain("this browser got no answer");
      expect(view.why).toContain(`${DECISIONS_FETCH_TIMEOUT_MS / 1000}s`);
    } finally {
      vi.useRealTimers();
    }
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
