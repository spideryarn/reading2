/** The reports client: strict wire parsing through an injected request seam. Plan 260910e, Stage 3a. */
import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  REPORTS_FETCH_TIMEOUT_MS,
  claimMatchesSearch,
  makeReportsApi,
  parseReportsFeed,
  type ReportsRequest,
} from "../tools/fleet/web/src/reports-client";
import type { ReportsFeed, ReportWireClaim } from "../tools/fleet/wire";

const ID_A = randomUUID();
const ID_B = randomUUID();

const CLAIM: ReportWireClaim = {
  eventId: ID_A,
  claimedBy: { kind: "session", name: "work-reports" },
  submittedAt: "2026-09-10T11:59:00.000Z",
  receivedAt: "2026-09-10T12:00:00.000Z",
  execution: "same-verified-run",
  job: { plan: "docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md", queueItem: null, occurrence: null },
  summary: "stage 3a tests written, red as expected",
  artefacts: [{ ref: { kind: "commit", sha: "f9970832" }, check: { state: "on-dev" } }],
  corrects: null,
  correctedBy: null,
  laterClaim: null,
  kind: "progress",
};

const BLOCKED: ReportWireClaim = {
  ...CLAIM,
  eventId: ID_B,
  claimedBy: { kind: "overseer" },
  execution: null,
  summary: "waiting on a product call",
  kind: "blocked",
  on: "greg",
  needs: "Which ZEBRA crossing do we keep?",
};

const FEED: ReportsFeed = {
  schema: 1,
  kind: "reports",
  path: "/tmp/fake/reports.jsonl",
  composedAt: "2026-09-10T12:05:00.000Z",
  sessions: {
    kind: "joined-with-register",
    rows: [
      { name: "work-reports", register: "in-register", latest: { kind: "claimed", claims: 1, latest: CLAIM } },
      { name: "quiet-one", register: "in-register", latest: { kind: "unreported" } },
    ],
  },
  recent: [BLOCKED, CLAIM],
  recentWithheld: 0,
  inFlight: 2,
  refused: 1,
  problems: [],
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("strict parsing", () => {
  it("accepts a complete payload as the parser's positive control", () => {
    expect(parseReportsFeed(clone(FEED))).toEqual(FEED);
  });

  it("accepts the register-unavailable shape, and each silence arm in the server's voice", () => {
    const unavailable: ReportsFeed = {
      ...FEED,
      sessions: {
        kind: "register-unavailable",
        why: "the Overseer checkpoint is absent",
        reported: [{ name: "work-reports", latest: { kind: "claimed", claims: 1, latest: CLAIM } }],
      },
    };
    expect(parseReportsFeed(clone(unavailable))).toEqual(unavailable);
    const arms: ReportsFeed[] = [
      { schema: 1, kind: "never-written", composedAt: FEED.composedAt, why: "no report yet", inFlight: 3, refused: 0 },
      { schema: 1, kind: "unreadable", composedAt: FEED.composedAt, why: "reports.jsonl is gone" },
      { schema: 1, kind: "oversized-file", composedAt: FEED.composedAt, why: "too big", sizeBytes: 9, limitBytes: 8 },
    ];
    for (const arm of arms) expect(parseReportsFeed(clone(arm))).toEqual(arm);
  });

  it("refuses schema 2 with a sentence, rather than drawing a shape it does not know", () => {
    const answer = parseReportsFeed({ ...clone(FEED), schema: 2 });
    expect(answer.kind).toBe("no-answer");
    if (answer.kind !== "no-answer") throw new Error("unreachable");
    expect(answer.why).toContain("version 1 of the reports API");
    expect(answer.why).toContain("2");
  });

  const malformed: [string, (feed: Record<string, unknown>) => void][] = [
    ["a claim without a summary", (feed) => delete (feed["recent"] as Record<string, unknown>[])[0]?.["summary"]],
    ["a reporter that is not a session, the Overseer or Greg", (feed) => {
      ((feed["recent"] as Record<string, unknown>[])[1] as Record<string, unknown>)["claimedBy"] = { kind: "bot" };
    }],
    ["a kind that reads like a state", (feed) => {
      ((feed["recent"] as Record<string, unknown>[])[1] as Record<string, unknown>)["kind"] = "ready";
    }],
    ["an artefact that is not a valid reference", (feed) => {
      ((feed["recent"] as Record<string, unknown>[])[1] as Record<string, unknown>)["artefacts"] = [
        { ref: { kind: "commit", sha: "javascript:alert(1)" }, check: { state: "on-dev" } },
      ];
    }],
    ["an execution comparison for a reporter that is not a session", (feed) => {
      ((feed["recent"] as Record<string, unknown>[])[0] as Record<string, unknown>)["execution"] = "same-verified-run";
    }],
    ["a session's latest claim made by somebody else", (feed) => {
      const rows = (feed["sessions"] as Record<string, unknown>)["rows"] as Record<string, unknown>[];
      (rows[0] as Record<string, unknown>)["name"] = "somebody-else";
    }],
    ["an unreported row outside the register", (feed) => {
      const rows = (feed["sessions"] as Record<string, unknown>)["rows"] as Record<string, unknown>[];
      (rows[1] as Record<string, unknown>)["register"] = "not-in-register";
    }],
    ["a withheld count that is not a whole number", (feed) => {
      feed["recentWithheld"] = -1;
    }],
    ["an event id that is not a uuid", (feed) => {
      ((feed["recent"] as Record<string, unknown>[])[1] as Record<string, unknown>)["eventId"] = "not-a-uuid";
    }],
  ];
  it.each(malformed)("refuses %s", (_what, mutate) => {
    const feed = clone(FEED) as unknown as Record<string, unknown>;
    mutate(feed);
    expect(parseReportsFeed(feed).kind).toBe("no-answer");
  });
});

describe("search", () => {
  it("matches case-insensitively over the summary, what a block needs, and who claimed it", () => {
    expect(claimMatchesSearch(BLOCKED, "zebra")).toBe(true);
    expect(claimMatchesSearch(CLAIM, "RED AS")).toBe(true);
    expect(claimMatchesSearch(CLAIM, "work-rep")).toBe(true);
    expect(claimMatchesSearch(CLAIM, "zebra")).toBe(false);
    expect(claimMatchesSearch(CLAIM, "   ")).toBe(true);
  });
});

function response(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

describe("the injectable seam", () => {
  it("drives the real client through an injected request, without stubbing global fetch", async () => {
    const seen: string[] = [];
    const request: ReportsRequest = async (input) => {
      seen.push(String(input));
      return response(JSON.stringify(FEED));
    };
    expect(await makeReportsApi(request).fetch()).toEqual(FEED);
    expect(seen).toEqual(["api/reports"]);
  });

  it("keeps malformed JSON, a refused payload and a network failure in this browser's voice", async () => {
    const notJson = await makeReportsApi(async () => response("<html>")).fetch();
    expect(notJson).toMatchObject({ kind: "no-answer" });
    if (notJson.kind === "no-answer") expect(notJson.why).toContain("not JSON");

    const wrong = await makeReportsApi(async () => response(JSON.stringify({ ...FEED, schema: 2 }))).fetch();
    expect(wrong.kind).toBe("no-answer");

    const down = await makeReportsApi(async () => {
      throw new TypeError("fetch failed");
    }).fetch();
    expect(down).toMatchObject({ kind: "no-answer" });
    if (down.kind === "no-answer") expect(down.why).toContain("could not reach the dashboard");
  });

  it("times out a request that never answers", async () => {
    vi.useFakeTimers();
    try {
      const request: ReportsRequest = (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      const pending = makeReportsApi(request).fetch();
      await vi.advanceTimersByTimeAsync(REPORTS_FETCH_TIMEOUT_MS);
      const answer = await pending;
      expect(answer).toMatchObject({ kind: "no-answer" });
      if (answer.kind === "no-answer") expect(answer.why).toContain(`${REPORTS_FETCH_TIMEOUT_MS / 1000}s`);
    } finally {
      vi.useRealTimers();
    }
  });
});
