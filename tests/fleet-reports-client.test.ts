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
  schema: 2,
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
  inFlight: { exact: 2 },
  refused: { exact: 1 },
  quarantine: { count: { exact: 12 }, oldestMovedAt: "2026-09-07T12:05:00.000Z" },
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
      {
        schema: 2,
        kind: "never-written",
        composedAt: FEED.composedAt,
        why: "no report yet",
        inFlight: { exact: 3 },
        refused: { exact: 0 },
        quarantine: { count: { exact: 0 }, oldestMovedAt: null },
      },
      { schema: 2, kind: "unreadable", composedAt: FEED.composedAt, why: "reports.jsonl is gone" },
      { schema: 2, kind: "oversized-file", composedAt: FEED.composedAt, why: "too big", sizeBytes: 9, limitBytes: 8 },
    ];
    for (const arm of arms) expect(parseReportsFeed(clone(arm))).toEqual(arm);
  });

  it("accepts a capped count — at least — on every count, in both arms that carry counts", () => {
    const capped: ReportsFeed = {
      ...FEED,
      inFlight: { atLeast: 1000 },
      refused: { atLeast: 1000 },
      quarantine: { count: { atLeast: 1000 }, oldestMovedAt: "2026-09-01T00:00:00.000Z" },
    };
    expect(parseReportsFeed(clone(capped))).toEqual(capped);
    const never: ReportsFeed = {
      schema: 2,
      kind: "never-written",
      composedAt: FEED.composedAt,
      why: "no report yet",
      inFlight: { atLeast: 1000 },
      refused: { exact: 0 },
      quarantine: { count: { atLeast: 1000 }, oldestMovedAt: null },
    };
    expect(parseReportsFeed(clone(never))).toEqual(never);
  });

  it("refuses schema 1 — the shape with bare counts — with a sentence, rather than drawing it", () => {
    const answer = parseReportsFeed({ ...clone(FEED), schema: 1, inFlight: 2, refused: 1 });
    expect(answer.kind).toBe("no-answer");
    if (answer.kind !== "no-answer") throw new Error("unreachable");
    expect(answer.why).toContain("version 2 of the reports API");
    expect(answer.why).toContain("1");
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
    ["a bare in-flight number, which cannot say whether it was capped", (feed) => {
      feed["inFlight"] = 2;
    }],
    ["a bare refused number", (feed) => {
      feed["refused"] = 1;
    }],
    ["a count that claims both arms", (feed) => {
      feed["inFlight"] = { exact: 2, atLeast: 2 };
    }],
    ["a count with an unknown arm", (feed) => {
      feed["inFlight"] = { about: 2 };
    }],
    ["a missing quarantine", (feed) => {
      delete feed["quarantine"];
    }],
    ["a bare quarantine number", (feed) => {
      feed["quarantine"] = { count: 12, oldestMovedAt: null };
    }],
    ["a quarantine age that is not an instant", (feed) => {
      feed["quarantine"] = { count: { exact: 12 }, oldestMovedAt: "three days ago" };
    }],
    ["an oldest entry in an empty quarantine", (feed) => {
      feed["quarantine"] = { count: { exact: 0 }, oldestMovedAt: "2026-09-07T12:05:00.000Z" };
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

    const wrong = await makeReportsApi(async () => response(JSON.stringify({ ...FEED, schema: 3 }))).fetch();
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
