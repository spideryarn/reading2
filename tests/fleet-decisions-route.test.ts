/**
 * `GET /api/decisions` — the whole production composition, without a socket.
 *
 * `makeDecisionsRoute` is the function `server.ts` calls. These tests inject
 * readers into that same composition rather than rebuilding the projection and
 * route as two test-only pieces, so a missing production edge has somewhere to
 * go red. The final source guard covers the one line importing `server.ts`
 * cannot reach because that module binds the dashboard port.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DECISIONS_PATH,
  MAX_DECISIONS_RESPONSE_BYTES,
  REVIEWED_HISTORY_LIMIT,
  makeDecisionsRoute,
  type DecisionsRouteReaders,
} from "../tools/fleet/routes-decisions.js";
import {
  DECISIONS_SCHEMA,
  type DecisionProblem,
  type DecisionRead,
  type DecisionRecord,
} from "../tools/overseer/decisions.js";
import type { DecisionsFeed } from "../tools/fleet/wire.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = new Date("2026-09-09T12:00:00.000Z");

function record(id: string, index: number, over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    id,
    recordedBy: "overseer",
    class: "decision",
    question: `Question ${index}?`,
    options: [
      { name: "Stop", tradeoffs: "Leaves the work for later." },
      { name: "Continue", tradeoffs: "Uses capacity now." },
    ],
    chose: { option: "Continue", note: null },
    why: "The work is already specified.",
    advisers: ["nobody"],
    bearsOn: { sessions: [], plan: null },
    decidedAt: new Date(NOW.getTime() - index * 60_000).toISOString(),
    supersedes: null,
    supersededBy: null,
    reviewed: false,
    reviewedAt: null,
    reviewNote: null,
    reversed: false,
    reversedAt: null,
    reversedWhy: null,
    touches: [],
    ...over,
  };
}

function decisionRead(
  records: readonly DecisionRecord[],
  problems: readonly DecisionProblem[] = [],
): DecisionRead {
  return {
    kind: "decisions",
    path: "/tmp/fake/decisions.jsonl",
    view: {
      schema: DECISIONS_SCHEMA,
      records,
      problems,
      version: { events: records.length, lastEventId: records.length === 0 ? null : "event-tail" },
    },
  };
}

function readers(read: DecisionRead): DecisionsRouteReaders {
  return {
    readDecisions: () => read,
    loadCheckpoint: () => ({ kind: "absent" }),
    now: () => NOW,
  };
}

function call(read: DecisionRead, url = DECISIONS_PATH, method = "GET") {
  let status = 0;
  let headers: Record<string, string> = {};
  let raw = "";
  const res = {
    writeHead(code: number, next?: Record<string, string>) {
      status = code;
      headers = next ?? {};
      return res;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) raw += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      return res;
    },
  };
  const route = makeDecisionsRoute(readers(read));
  const handled = route.handle(
    { method, url, headers: {} } as IncomingMessage,
    res as unknown as ServerResponse,
  );
  return {
    handled,
    status,
    headers,
    raw,
    body: raw === "" ? null : (JSON.parse(raw) as DecisionsFeed),
  };
}

describe("the four read arms", () => {
  it("keeps never-written distinct from an empty record", () => {
    const never = call({ kind: "never-written", path: "/tmp/fake/decisions.jsonl" }).body;
    const empty = call(decisionRead([])).body;

    expect(never?.kind).toBe("never-written");
    expect(empty?.kind).toBe("decisions");
    if (empty?.kind !== "decisions") throw new Error("unreachable");
    expect(empty.rows).toEqual([]);
  });

  it("carries unreadable as the reader's own refusal, never a healthy empty record", () => {
    const feed = call({
      kind: "unreadable",
      why: "line 4 is not an event",
      path: "/tmp/fake/decisions.jsonl",
    }).body;

    expect(feed).toEqual({ schema: 1, kind: "unreadable", why: "line 4 is not an event" });
    expect(feed === null || "rows" in feed).toBe(false);
  });

  it("names oversized unreviewed input rather than truncating the unseen row", () => {
    const huge = record("dec-unseen22", 0, { why: "x".repeat(MAX_DECISIONS_RESPONSE_BYTES + 1) });
    const answer = call(decisionRead([huge]));

    expect(answer.body?.kind).toBe("oversized-unreviewed");
    if (answer.body?.kind !== "oversized-unreviewed") throw new Error("unreachable");
    expect(answer.body.unreviewedCount).toBe(1);
    expect(answer.body.limitBytes).toBe(MAX_DECISIONS_RESPONSE_BYTES);
    expect(answer.raw).not.toContain(huge.why);
    expect(Buffer.byteLength(answer.raw, "utf8")).toBeLessThanOrEqual(MAX_DECISIONS_RESPONSE_BYTES);
  });
});

describe("the maximum", () => {
  it("keeps every unreviewed row, caps reviewed history, and reports the exact withheld count", () => {
    const reviewed = Array.from({ length: REVIEWED_HISTORY_LIMIT + 7 }, (_, index) =>
      record(`dec-reviewed-${index}`, index + 10, {
        reviewed: true,
        reviewedAt: new Date(NOW.getTime() - index * 30_000).toISOString(),
      }),
    );
    const unseen = Array.from({ length: 4 }, (_, index) => record(`dec-unseen-${index}`, index));
    expect(new Set([...reviewed, ...unseen].map((item) => item.id)).size).toBe(reviewed.length + unseen.length);

    const feed = call(decisionRead([...reviewed, ...unseen])).body;
    expect(feed?.kind).toBe("decisions");
    if (feed?.kind !== "decisions") throw new Error("unreachable");
    expect(feed.rows.filter((row) => row.pendingReview).map((row) => row.record.id)).toEqual(
      unseen.map((item) => item.id),
    );
    expect(feed.rows.filter((row) => !row.pendingReview)).toHaveLength(REVIEWED_HISTORY_LIMIT);
    expect(feed.reviewedWithheld).toBe(7);
  });

  it("uses the byte ceiling to withhold reviewed rows too, while keeping the count exact", () => {
    const reviewed = Array.from({ length: 12 }, (_, index) =>
      record(`dec-wide-${index}`, index + 10, {
        reviewed: true,
        reviewedAt: NOW.toISOString(),
        /* UTF-8 bytes, not JavaScript string length: all twelve fit under 2 MiB
           in UTF-16 code units and exceed it on the actual wire. */
        why: `${index}:${"🕸️".repeat(50_000)}`,
      }),
    );
    const answer = call(decisionRead(reviewed));

    expect(answer.body?.kind).toBe("decisions");
    if (answer.body?.kind !== "decisions") throw new Error("unreachable");
    const includedReviewed = answer.body.rows.filter((row) => !row.pendingReview).length;
    expect(answer.body.reviewedWithheld).toBe(reviewed.length - includedReviewed);
    expect(answer.body.reviewedWithheld).toBeGreaterThan(0);
    expect(Buffer.byteLength(answer.raw, "utf8")).toBeLessThanOrEqual(MAX_DECISIONS_RESPONSE_BYTES);
  });

  it("does not call oversized context with zero unseen rows an oversized-unreviewed set", () => {
    const problems: DecisionProblem[] = Array.from({ length: 30_000 }, (_, index) => ({
      kind: "unreadable-line",
      why: `line ${index} could not be parsed: ${"broken".repeat(20)}`,
      eventId: null,
    }));
    const answer = call(decisionRead([], problems));

    expect(answer.body?.kind).toBe("unreadable");
    expect(answer.body?.kind).not.toBe("oversized-unreviewed");
    expect(answer.raw).toContain("required context exceeds");
    expect(Buffer.byteLength(answer.raw, "utf8")).toBeLessThanOrEqual(MAX_DECISIONS_RESPONSE_BYTES);
  });
});

describe("the projection survives the route", () => {
  it("suppresses every aggregate when the fold has a problem", () => {
    const problem: DecisionProblem = {
      kind: "unreadable-line",
      why: "line 7 is not JSON",
      eventId: null,
    };
    const feed = call(decisionRead([record("dec-problem2", 0)], [problem])).body;

    expect(feed?.kind).toBe("decisions");
    if (feed?.kind !== "decisions") throw new Error("unreachable");
    expect(feed.aggregates).toEqual({
      kind: "unavailable",
      why: expect.stringContaining("decision record has 1 problem"),
    });
    expect(JSON.stringify(feed.aggregates)).not.toMatch(/notYetReviewed|decisions|reviews|reversals/);
    expect(feed.problems).toEqual([problem]);
  });
});

describe("the mount", () => {
  it("answers only its exact path", () => {
    expect(call(decisionRead([]), DECISIONS_PATH).handled).toBe(true);
    expect(call(decisionRead([]), `${DECISIONS_PATH}?x=1`).handled).toBe(true);
    expect(call(decisionRead([]), `${DECISIONS_PATH}/../secrets`).status).toBe(404);
    expect(call(decisionRead([]), "/api/state").handled).toBe(false);
  });

  it("is deliberately read-only because this server has no identity", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const answer = call(decisionRead([]), DECISIONS_PATH, method);
      expect(answer.status).toBe(405);
      expect(answer.headers["allow"]).toBe("GET, HEAD");
      expect(answer.raw).toContain("read-only on purpose");
      expect(answer.raw).toContain("scripts/overseer-decisions.ts");
    }
  });

  it("sends no body for HEAD", () => {
    const answer = call(decisionRead([]), DECISIONS_PATH, "HEAD");
    expect(answer.status).toBe(200);
    expect(answer.raw).toBe("");
  });
});

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("server.ts wiring", () => {
  const source = stripComments(readFileSync(join(REPO, "tools", "fleet", "server.ts"), "utf8"));

  it("constructs the production composition exactly once", () => {
    expect(source.match(/makeDecisionsRoute\(\)/g) ?? []).toHaveLength(1);
  });

  it("mounts the decisions route in its request path, outside comments", () => {
    expect(source).toContain("decisionsApiRoute.handle(req, res)");
  });
});
