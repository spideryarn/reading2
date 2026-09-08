/**
 * `GET /api/health/history` — tools/fleet/routes-health-history.ts.
 *
 * The join between this route and the loop that fills the store is tested in
 * tests/fleet-refresh.test.ts, deliberately: that is where the missing line
 * would live. What is here is the route's own decisions — the clamp, the
 * compression, and the two arms it must never merge.
 */
import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import type { HealthHistory, HealthSample, HistoryRead, RetentionStatus } from "../tools/fleet/health-history.js";
import {
  DEFAULT_WINDOW_HOURS,
  MAX_WINDOW_HOURS,
  healthHistoryRoute,
  historyPayload,
  windowHoursFrom,
} from "../tools/fleet/routes-health-history.js";

const NOW = Date.parse("2026-09-08T12:00:00.000Z");

function sample(at: string): HealthSample {
  return { schema: 1, at, nextDueMs: 73_000, kind: "collector-failed", why: "fixture" };
}

const HEALTHY_RETENTION: RetentionStatus = {
  lastAttemptAt: "2026-09-08T11:59:00.000Z",
  lastSuccessAt: "2026-09-08T11:59:00.000Z",
  failure: null,
  poisoned: false,
  lockedOutBy: null,
};

function storeReturning(read: HistoryRead, status: RetentionStatus = HEALTHY_RETENTION): HealthHistory {
  return { dir: "/tmp/fixture", append: () => {}, read: () => read, status: () => status, close: () => {} };
}

function ok(samples: HealthSample[], over: Partial<Extract<HistoryRead, { kind: "read" }>> = {}): HealthHistory {
  return storeReturning({
    kind: "read",
    samples,
    predecessor: null,
    holes: [],
    earliestAt: samples[0]?.at ?? null,
    rotated: false,
    unreadableLines: 0,
    files: 1,
    ...over,
  });
}

describe("windowHoursFrom", () => {
  it("defaults when there is no hours parameter", () => {
    expect(windowHoursFrom("/api/health/history")).toBe(DEFAULT_WINDOW_HOURS);
  });

  it("defaults rather than erroring on nonsense, because this is a chart", () => {
    expect(windowHoursFrom("/api/health/history?hours=banana")).toBe(DEFAULT_WINDOW_HOURS);
    expect(windowHoursFrom("/api/health/history?hours=-4")).toBe(DEFAULT_WINDOW_HOURS);
    expect(windowHoursFrom("/api/health/history?hours=0")).toBe(DEFAULT_WINDOW_HOURS);
  });

  it("clamps a very large window rather than serialising the whole store", () => {
    expect(windowHoursFrom("/api/health/history?hours=100000")).toBe(MAX_WINDOW_HOURS);
  });

  it("takes a smaller window as asked", () => {
    expect(windowHoursFrom("/api/health/history?hours=6")).toBe(6);
  });
});

describe("historyPayload", () => {
  it("carries the store's own unreadable reason rather than an empty history", () => {
    /* THE ARM THIS ROUTE EXISTS TO PRESERVE. An empty `samples` says "we looked
       and the box was quiet"; this says "we could not look". Merged, they
       become one confident claim that the box was down all day. */
    const payload = historyPayload(
      { store: storeReturning({ kind: "unreadable", why: "could not read /x: EIO" }), refreshMs: 60_000, nowMs: () => NOW },
      24,
    );
    expect(payload.kind).toBe("unreadable");
    if (payload.kind !== "unreadable") return;
    expect(payload.why).toContain("EIO");
  });

  it("says so when no store was opened at all, in words a reader can act on", () => {
    const payload = historyPayload({ store: null, refreshMs: 60_000, nowMs: () => NOW }, 24);
    expect(payload.kind).toBe("unreadable");
    if (payload.kind !== "unreadable") return;
    expect(payload.why).toMatch(/not retaining/i);
    /* And it says the thing a blank chart would otherwise imply. */
    expect(payload.why).toMatch(/not the same as the box having been quiet/i);
  });

  it("an empty window is a history, not a failure", () => {
    const payload = historyPayload({ store: ok([]), refreshMs: 60_000, nowMs: () => NOW }, 24);
    expect(payload.kind).toBe("history");
  });

  it("passes the earliest sample through even when it is outside the window", () => {
    /* Without it the page cannot tell "we had not started looking yet" from
       "the box was down", which are the two silences it must keep apart. */
    const payload = historyPayload(
      { store: ok([], { earliestAt: "2026-09-08T11:50:00.000Z" }), refreshMs: 60_000, nowMs: () => NOW },
      24,
    );
    if (payload.kind !== "history") throw new Error("expected a history");
    expect(payload.earliestAt).toBe("2026-09-08T11:50:00.000Z");
  });

  it("stamps the window from the SERVER's clock", () => {
    /* A browser computing "24h ago" from its own clock would draw a phone in
       the wrong timezone as a chart missing its most recent hours — absence
       caused by arithmetic, which looks exactly like absence caused by an
       outage. */
    const payload = historyPayload({ store: ok([]), refreshMs: 60_000, nowMs: () => NOW }, 6);
    if (payload.kind !== "history") throw new Error("expected a history");
    expect(payload.toMs).toBe(NOW);
    expect(payload.fromMs).toBe(NOW - 6 * 60 * 60 * 1000);
    expect(payload.windowHours).toBe(6);
  });

  it("tells the page the collection cadence, so it can judge the right-hand edge", () => {
    const payload = historyPayload({ store: ok([]), refreshMs: 60_000, nowMs: () => NOW }, 24);
    if (payload.kind !== "history") throw new Error("expected a history");
    expect(payload.refreshMs).toBe(60_000);
  });

  it("reports unreadable lines rather than swallowing them", () => {
    const payload = historyPayload(
      { store: ok([sample("2026-09-08T11:59:00.000Z")], { unreadableLines: 3 }), refreshMs: 60_000, nowMs: () => NOW },
      24,
    );
    if (payload.kind !== "history") throw new Error("expected a history");
    expect(payload.unreadableLines).toBe(3);
  });
});

/* ------------------------------------------------------------------ *
 * The HTTP half.
 * ------------------------------------------------------------------ */

type Answer = { status: number; headers: Record<string, string>; raw: Buffer<ArrayBufferLike> };

function get(store: HealthHistory | null, url: string, headers: Record<string, string> = {}): Answer {
  const route = healthHistoryRoute({ store, refreshMs: 60_000, nowMs: () => NOW });
  let status = 0;
  let sent: Record<string, string> = {};
  let raw: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  const res = {
    writeHead(code: number, h?: Record<string, string>) {
      status = code;
      sent = h ?? {};
      return res;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) raw = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
      return res;
    },
  };
  const req = { method: "GET", url, headers } as unknown as import("node:http").IncomingMessage;
  const handled = route.handle(req, res as unknown as import("node:http").ServerResponse);
  expect(handled).toBe(true);
  return { status, headers: sent, raw };
}

describe("the route", () => {
  it("does not claim a request that is not its own", () => {
    const route = healthHistoryRoute({ store: ok([]), refreshMs: 60_000, nowMs: () => NOW });
    const req = { method: "GET", url: "/api/state", headers: {} } as unknown as import("node:http").IncomingMessage;
    expect(route.handle(req, {} as unknown as import("node:http").ServerResponse)).toBe(false);
  });

  it("404s a path that merely starts with its own, so the prefix cannot widen", () => {
    expect(get(ok([]), "/api/health/history/../../etc").status).toBe(404);
  });

  it("answers uncompressed when the body is small", () => {
    const answer = get(ok([]), "/api/health/history");
    expect(answer.status).toBe(200);
    expect(answer.headers["content-encoding"]).toBeUndefined();
    expect(JSON.parse(answer.raw.toString("utf8"))).toMatchObject({ kind: "history" });
  });

  it("gzips a large body when the browser says it can take it, losing nothing", () => {
    /* The alternative to compression is averaging into buckets, which is the
       one transformation that structurally hides the five-minute spike this
       chart exists to show. So the size problem is solved where nothing is
       lost. */
    const many = Array.from({ length: 2_000 }, (_, i) => sample(new Date(NOW - i * 60_000).toISOString()));
    const answer = get(ok(many), "/api/health/history", { "accept-encoding": "gzip, deflate, br" });
    expect(answer.status).toBe(200);
    expect(answer.headers["content-encoding"]).toBe("gzip");
    expect(answer.headers["vary"]).toBe("accept-encoding");

    const body = JSON.parse(gunzipSync(answer.raw).toString("utf8")) as { samples: unknown[] };
    expect(body.samples).toHaveLength(2_000);
    /* Worth having: a chart's worth of repetitive JSON compresses hard. */
    expect(answer.raw.length).toBeLessThan(JSON.stringify(body).length / 4);
  });

  it("does not gzip when the browser did not offer to accept it", () => {
    const many = Array.from({ length: 2_000 }, (_, i) => sample(new Date(NOW - i * 60_000).toISOString()));
    const answer = get(ok(many), "/api/health/history");
    expect(answer.headers["content-encoding"]).toBeUndefined();
    expect(JSON.parse(answer.raw.toString("utf8"))).toMatchObject({ kind: "history" });
  });

  it("answers 200 with the unreadable arm rather than a status nobody parses", () => {
    /* Same rule messages-client.ts states: the BODY decides, and a second copy
       of the decision in the status code is one more thing to keep in step. */
    const answer = get(null, "/api/health/history");
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.raw.toString("utf8"))).toMatchObject({ kind: "unreadable" });
  });
});
