/**
 * `GET /api/decisions` — the whole production composition, without a socket.
 *
 * `makeDecisionsRoute` is the function `server.ts` calls. These tests inject
 * readers into that same composition rather than rebuilding the projection and
 * route as two test-only pieces, so a missing production edge has somewhere to
 * go red. The final test imports `server.ts` with only its listener and
 * background collection replaced, captures its actual handler, and drives the
 * real mount without binding a port or touching the live box.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  DECISIONS_PATH,
  MAX_DECISIONS_INPUT_BYTES,
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
    author: { kind: "legacy-unrecorded" },
    consequence: "not-recorded",
    reversibility: "not-recorded",
    domain: "not-recorded",
    recommendation: { kind: "not-recorded" },
    evidence: { kind: "not-recorded" },
    gregAsked: "not-recorded",
    confidence: "not-recorded",
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
    decisionFileSize: () => ({ path: "/tmp/fake/decisions.jsonl", sizeBytes: 0 }),
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

describe("the five read arms", () => {
  it("keeps never-written distinct from an empty record", () => {
    const never = call({ kind: "never-written", path: "/tmp/fake/decisions.jsonl" }).body;
    const empty = call(decisionRead([])).body;

    expect(never?.kind).toBe("never-written");
    expect(never?.composedAt).toBe(NOW.toISOString());
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

    expect(feed).toEqual({
      schema: 2,
      kind: "unreadable",
      composedAt: NOW.toISOString(),
      why: "line 4 is not an event",
    });
    expect(feed === null || "rows" in feed).toBe(false);
  });

  it("names oversized unreviewed input rather than truncating the unseen row", () => {
    const huge = record("dec-unseen22", 0, { why: "x".repeat(2_097_153) });
    const answer = call(decisionRead([huge]));

    expect(answer.body?.kind).toBe("oversized-unreviewed");
    if (answer.body?.kind !== "oversized-unreviewed") throw new Error("unreachable");
    expect(answer.body.unreviewedCount).toBe(1);
    expect(answer.body.limitBytes).toBe(2_097_152);
    expect(answer.body.composedAt).toBe(NOW.toISOString());
    expect(answer.raw).not.toContain(huge.why);
    expect(Buffer.byteLength(answer.raw, "utf8")).toBeLessThanOrEqual(2_097_152);
  });

  it("refuses an oversized input before reading or folding it", () => {
    const readDecisions = vi.fn<() => DecisionRead>(() => decisionRead([]));
    const feed = makeDecisionsRoute({
      decisionFileSize: () => ({ path: "/tmp/fake/decisions.jsonl", sizeBytes: 8_388_609 }),
      readDecisions,
      loadCheckpoint: () => ({ kind: "absent" }),
      now: () => NOW,
    });
    const answer = (() => {
      let raw = "";
      const res = {
        writeHead() { return res; },
        end(chunk?: string) { if (chunk !== undefined) raw += chunk; return res; },
      };
      feed.handle(
        // A Host, because handler() refuses a request that names none (260910f).
        { method: "GET", url: DECISIONS_PATH, headers: { host: "127.0.0.1:8787" } } as IncomingMessage,
        res as unknown as ServerResponse,
      );
      return JSON.parse(raw) as DecisionsFeed;
    })();

    expect(MAX_DECISIONS_INPUT_BYTES).toBe(8_388_608);
    expect(answer).toMatchObject({
      kind: "oversized-file",
      composedAt: NOW.toISOString(),
      sizeBytes: 8_388_609,
      limitBytes: 8_388_608,
    });
    expect(readDecisions).not.toHaveBeenCalled();
  });
});

describe("the maximum", () => {
  it("keeps every unreviewed row, caps reviewed history, and reports the exact withheld count", () => {
    expect(REVIEWED_HISTORY_LIMIT).toBe(100);
    const reviewed = Array.from({ length: 107 }, (_, index) =>
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
    expect(feed.rows.filter((row) => !row.pendingReview)).toHaveLength(100);
    expect(feed.historyWithheld).toBe(7);
  });

  it("keeps every ancestor of a pending supersession chain outside the 100-row history cap", () => {
    const oldest = record("dec-original", 1_000, {
      supersededBy: "dec-correction-1",
    });
    const correction = record("dec-correction-1", 999, {
      supersedes: oldest.id,
      supersededBy: "dec-correction-2",
    });
    const pending = record("dec-correction-2", 0, { supersedes: correction.id });
    const newerHistory = Array.from({ length: 107 }, (_, index) =>
      record(`dec-reviewed-${index}`, index + 1, {
        reviewed: true,
        reviewedAt: NOW.toISOString(),
      }),
    );

    const feed = call(decisionRead([oldest, correction, ...newerHistory, pending])).body;
    expect(feed?.kind).toBe("decisions");
    if (feed?.kind !== "decisions") throw new Error("unreachable");
    expect(feed.rows.map((row) => row.record.id)).toEqual(
      expect.arrayContaining([oldest.id, correction.id, pending.id]),
    );
    expect(feed.rows.filter((row) => row.record.id.startsWith("dec-reviewed-"))).toHaveLength(100);
    expect(feed.historyWithheld).toBe(7);
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
    expect(MAX_DECISIONS_RESPONSE_BYTES).toBe(2_097_152);
    expect(answer.body.historyWithheld).toBe(reviewed.length - includedReviewed);
    expect(answer.body.historyWithheld).toBeGreaterThan(0);
    expect(Buffer.byteLength(answer.raw, "utf8")).toBeLessThanOrEqual(2_097_152);
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
    expect(Buffer.byteLength(answer.raw, "utf8")).toBeLessThanOrEqual(2_097_152);
  });
});

describe("schema 2 crosses the route", () => {
  it("every arm says schema 2, including the refusals the route writes inline", () => {
    expect(call({ kind: "never-written", path: "/tmp/fake/decisions.jsonl" }).body?.schema).toBe(2);
    expect(call(decisionRead([])).body?.schema).toBe(2);
    expect(JSON.parse(call(decisionRead([]), DECISIONS_PATH, "POST").raw)).toMatchObject({ schema: 2 });
    expect(JSON.parse(call(decisionRead([]), `${DECISIONS_PATH}/x`).raw)).toMatchObject({ schema: 2 });
  });

  it("a session's decision keeps its author, recorder and every new field on the wire", () => {
    const session = record("dec-session2", 0, {
      recordedBy: "daemon",
      author: { kind: "session", name: "work-reports", execution: { kind: "not-found" } },
      consequence: "high",
      reversibility: "one-way",
      domain: "product",
      recommendation: { kind: "recorded", value: null },
      evidence: { kind: "recorded", value: [{ ref: { kind: "decision", id: "dec-a3k9mq2p" }, check: { state: "found" } }] },
      gregAsked: "asked-awaiting",
      confidence: "low",
      touches: [{ kind: "decided", at: NOW.toISOString(), by: "daemon", what: "decision decided" }],
    });
    const legacy = record("dec-legacy22", 1);
    const feed = call(decisionRead([session, legacy])).body;
    if (feed?.kind !== "decisions") throw new Error("unreachable");
    expect(feed.rows.map((row) => row.record)).toEqual([session, legacy]);
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

  it("answers a real request through the server.ts request composition", async () => {
    const storeRoot = mkdtempSync(join(tmpdir(), "spideryarn-decisions-server-"));
    const previous = {
      FLEET_BIND: process.env.FLEET_BIND,
      FLEET_HEALTH_DIR: process.env.FLEET_HEALTH_DIR,
      FLEET_HOLDS_DIR: process.env.FLEET_HOLDS_DIR,
      FLEET_READINESS_DIR: process.env.FLEET_READINESS_DIR,
      OVERSEER_DECISIONS_DIR: process.env.OVERSEER_DECISIONS_DIR,
      OVERSEER_STORE_DIR: process.env.OVERSEER_STORE_DIR,
    };
    process.env.FLEET_BIND = "127.0.0.1";
    process.env.FLEET_HEALTH_DIR = join(storeRoot, "health");
    process.env.FLEET_HOLDS_DIR = join(storeRoot, "holds");
    process.env.FLEET_READINESS_DIR = join(storeRoot, "readiness");
    process.env.OVERSEER_DECISIONS_DIR = join(storeRoot, "decisions");
    process.env.OVERSEER_STORE_DIR = join(storeRoot, "overseer");

    let handler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;
    vi.doMock("node:http", async () => {
      const actual = await vi.importActual<typeof import("node:http")>("node:http");
      return {
        ...actual,
        createServer: (next: (req: IncomingMessage, res: ServerResponse) => void) => {
          handler = next;
          const fake = {
            on: () => fake,
            listen: (_port: number, _bind: string, ready: () => void) => {
              ready();
              return fake;
            },
          };
          return fake;
        },
      };
    });
    /* Importing `server.ts` normally starts its permanent collection loop.
       Keep that startup promise pending: this test owns request composition,
       not collection, and must neither inspect the live box nor leave timers. */
    vi.doMock("../tools/fleet/refresh.js", async () => {
      const actual = await vi.importActual<typeof import("../tools/fleet/refresh.js")>(
        "../tools/fleet/refresh.js",
      );
      return {
        ...actual,
        refreshOnce: () => new Promise<never>(() => {}),
      };
    });

    try {
      await import("../tools/fleet/server.js");
      expect(handler).not.toBeNull();
      let status = 0;
      let raw = "";
      const response = {
        setHeader() {},
        writeHead(code: number) { status = code; return response; },
        end(chunk?: string | Buffer) {
          if (chunk !== undefined) raw += typeof chunk === "string" ? chunk : chunk.toString("utf8");
          return response;
        },
      };
      const mountedHandler = handler as unknown as (req: IncomingMessage, res: ServerResponse) => void;
      mountedHandler(
        // A Host, because handler() refuses a request that names none (260910f).
        { method: "GET", url: DECISIONS_PATH, headers: { host: "127.0.0.1:8787" } } as IncomingMessage,
        response as unknown as ServerResponse,
      );

      expect(status).toBe(200);
      const feed = JSON.parse(raw) as DecisionsFeed;
      expect(feed.kind).toBe("never-written");
      expect(feed.composedAt).toEqual(expect.any(String));
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      vi.doUnmock("node:http");
      vi.doUnmock("../tools/fleet/refresh.js");
      rmSync(storeRoot, { recursive: true, force: true });
    }
  });
});
