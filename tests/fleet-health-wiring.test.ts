/**
 * The join: a real turn, the REAL composition, and the answer a browser gets.
 *
 * **THIS IS THE TEST THE FOUR DEAD FEATURES NEEDED, AND ITS FIRST VERSION WAS
 * NOT IT.** That one built its own store, handed it to its own route, and
 * asserted the sample came back — which stays green if `server.ts` mounts the
 * route against a *different* store. GPT Sol's finding 5, and the same shape as
 * the bug the whole module was rearranged around: every part tested, the line
 * joining them missing.
 *
 * So this drives `makeHealthRetention`, the function `server.ts` itself calls,
 * and reads the answer back through the route that function built. There is no
 * second store to get wrong because there is no second construction.
 *
 * The one line it still cannot reach is `retention.route.handle(req, res)` in
 * `server.ts`'s request path, because importing that file binds port 8787. The
 * source check at the bottom is the cheap guard for it — the same kind
 * tests/fleet-web.test.tsx already uses — and looking at the real page in a
 * browser is the expensive one.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { HealthTurn } from "../tools/fleet/health-history.js";
import { makeHealthRetention, type HealthRetention } from "../tools/fleet/health-wiring.js";
import { refreshOnce, type RefreshDeps } from "../tools/fleet/refresh.js";
import type { FleetSnapshot } from "../tools/fleet/collect.js";
import type { HealthReport } from "../tools/fleet/health.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const dirs: string[] = [];
const built: HealthRetention[] = [];

afterEach(() => {
  for (const retention of built.splice(0)) retention.store?.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function retention(over: { refreshMs?: number; nowMs?: () => number } = {}): HealthRetention {
  const dir = mkdtempSync(join(tmpdir(), "fleet-health-wiring-"));
  dirs.push(dir);
  const made = makeHealthRetention({ dir, refreshMs: over.refreshMs ?? 60_000, nowMs: over.nowMs });
  built.push(made);
  return made;
}

function report(): HealthReport {
  return {
    load: { kind: "value", load1: 20.5, load5: 18, load15: 15, cores: 16, ratio1: 20.5 / 16 },
    memory: { kind: "value", totalBytes: 32_000_000_000, availableBytes: 8_000_000_000, availableFraction: 0.25 },
    swap: { kind: "unknown", why: "swapon failed: spawn swapon ENOENT" },
    disk: { kind: "value", totalKiB: 100, usedKiB: 50, availableKiB: 50, usePercent: 50 },
    swapActivity: { kind: "skipped" },
    attribution: { kind: "unknown", why: "not measured in this test" },
    verdict: { level: "strained", reasons: ["load average 20.5 is over 2x the 16 cores"] },
    collectedAt: "2026-09-08T12:00:00.000Z",
    tookMs: 158,
  };
}

function snap(): FleetSnapshot {
  return { rows: [], tmuxServerPid: 1, collectedAt: "2026-09-08T12:00:00.000Z", tookMs: 12_000 };
}

function deps(made: HealthRetention, over: Partial<RefreshDeps> = {}): RefreshDeps {
  return {
    collect: () => Promise.resolve(snap()),
    keep: () => {},
    refreshHealth: (): HealthTurn => ({ kind: "reading", report: report() }),
    retainHealth: made.retainHealth,
    refreshMs: 60_000,
    now: () => new Date("2026-09-08T12:00:30.000Z"),
    publish: () => {},
    drain: () => ({ rows: 0, considered: 0, generation: 1, invalidated: 0, outcomes: [] }),
    log: () => {},
    logError: () => {},
    subscribers: () => 0,
    ...over,
  };
}

/** One GET against the composed route, with a response that records rather than writes. */
function get(made: HealthRetention, url: string): { status: number; body: Record<string, unknown> } {
  let status = 0;
  let raw = "";
  const res = {
    writeHead(code: number) {
      status = code;
      return res;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) raw = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      return res;
    },
  };
  const req = { method: "GET", url, headers: {} } as unknown as import("node:http").IncomingMessage;
  expect(made.route.handle(req, res as unknown as import("node:http").ServerResponse)).toBe(true);
  return { status, body: JSON.parse(raw) as Record<string, unknown> };
}

describe("a turn reaches the browser through the composition the server uses", () => {
  it("writes a reading and serves it back, arms intact", () => {
    const made = retention({ nowMs: () => Date.parse("2026-09-08T12:00:31.000Z") });
    return refreshOnce(deps(made)).then(() => {
      const { status, body } = get(made, "/api/health/history?hours=24");
      expect(status).toBe(200);
      expect(body["kind"]).toBe("history");

      const samples = body["samples"] as { at: string; kind: string; report: Record<string, unknown> }[];
      expect(samples).toHaveLength(1);
      expect(samples[0]?.at).toBe("2026-09-08T12:00:30.000Z");
      /* THE ARM SURVIVED THE WHOLE PATH — collector, loop, disk, route, JSON.
         A store that flattened this to null or 0 would pass every shape check
         and lose the difference between "nothing was swapping" and "swapon is
         not installed". */
      expect(samples[0]?.report["swap"]).toEqual({ kind: "unknown", why: "swapon failed: spawn swapon ENOENT" });
      expect(samples[0]?.report["swapActivity"]).toEqual({ kind: "skipped" });
    });
  });

  it("carries the writer's own condition on the same answer", () => {
    /* Because a writer that has quietly stopped grows a break at the chart's
       right-hand edge that reads as the box going down. */
    const made = retention({ nowMs: () => Date.parse("2026-09-08T12:00:31.000Z") });
    return refreshOnce(deps(made)).then(() => {
      const { body } = get(made, "/api/health/history?hours=24");
      const status = body["retention"] as Record<string, unknown>;
      expect(status["failure"]).toBeNull();
      expect(status["poisoned"]).toBe(false);
      expect(status["lastSuccessAt"]).toBe("2026-09-08T12:00:30.000Z");
    });
  });

  it("writes a collector failure as its own arm, all the way to the browser", () => {
    const made = retention({ nowMs: () => Date.parse("2026-09-08T12:00:31.000Z") });
    const failing = deps(made, {
      refreshHealth: (): HealthTurn => ({ kind: "collector-failed", why: "collectHealth threw: out of memory" }),
    });
    return refreshOnce(failing).then(() => {
      const { body } = get(made, "/api/health/history?hours=24");
      const samples = body["samples"] as { kind: string; why: string }[];
      expect(samples[0]?.kind).toBe("collector-failed");
      expect(samples[0]?.why).toBe("collectHealth threw: out of memory");
      /* And NOT an all-unknown report: those are different facts, and only one
         of them has reasons somebody actually produced. */
      expect(samples[0]).not.toHaveProperty("report");
    });
  });

  it("says nothing is being retained rather than serving an empty day, when the store will not open", () => {
    const made = makeHealthRetention({ dir: "./relative-and-therefore-refused", refreshMs: 60_000 });
    expect(made.store).toBeNull();
    expect(made.lines.error.join(" ")).toMatch(/disabled/);
    const { body } = get(made, "/api/health/history?hours=24");
    expect(body["kind"]).toBe("unreadable");
    /* And the loop still runs: a store that would not open must not stop the
       dashboard. */
    expect(() => made.retainHealth({ kind: "collector-failed", why: "x" }, { at: "now", nextDueMs: 1 })).not.toThrow();
  });
});

/**
 * The one line no import can reach.
 *
 * `server.ts` binds port 8787 at import time, so nothing can drive its request
 * path. Reading it is the cheap guard that the route is actually mounted — the
 * same kind of source check tests/fleet-web.test.tsx uses for React's raw-markup
 * prop. It cannot prove the mount WORKS; a browser did that. It can prove
 * somebody deleted it.
 */
describe("server.ts", () => {
  const source = readFileSync(join(REPO, "tools", "fleet", "server.ts"), "utf8");

  it("mounts the history route in its request path", () => {
    expect(source).toContain("retention.route.handle(req, res)");
  });

  it("passes the composition's retain hook to the loop, not one of its own", () => {
    expect(source).toContain("retainHealth: retention.retainHealth");
  });

  it("builds the composition exactly once", () => {
    expect(source.match(/makeHealthRetention\(/g) ?? []).toHaveLength(1);
  });
});
