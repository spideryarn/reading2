/**
 * **New-session admission reads a health level; it does not collect one.**
 *
 * `routes-new.ts` used to answer "is the box on fire?" by running
 * `collectHealth()` inside the request: six synchronous commands on the
 * dashboard's only thread, each with a timeout that signals and then waits
 * (`docs/postmortems/260910a-a-timeout-that-signals-and-then-waits-is-not-a-bound.md`).
 * It now reads the level `server.ts` supplies from its own per-minute report.
 *
 * In its own file because it mocks `health.js`, and the big route suite next
 * door should keep driving the real one.
 */
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

const collectHealth = vi.hoisted(() => vi.fn(() => ({ verdict: { level: "ok", reasons: [] } })));
vi.mock("../tools/fleet/health.js", async (original) => ({
  ...(await original<typeof import("../tools/fleet/health.js")>()),
  collectHealth,
}));

import { computeVerdict, type HealthReport } from "../tools/fleet/health.js";
import { createNewSessionRoutes, newSessionHealthLevel, realIo } from "../tools/fleet/routes-new.js";

const NOW = Date.parse("2026-10-04T12:00:00.000Z");
const MAX_AGE_MS = 180_000;

function report(over: Partial<Omit<HealthReport, "verdict">> = {}, ageMs = 30_000): HealthReport {
  const readings = {
    load: { kind: "value", load1: 2, load5: 2, load15: 2, cores: 16, ratio1: 0.125 },
    memory: { kind: "value", totalBytes: 32e9, availableBytes: 16e9, availableFraction: 0.5 },
    swap: { kind: "value", totalBytes: 8e9, usedBytes: 1e9, usedFraction: 0.125, areas: 1 },
    disk: { kind: "value", totalKiB: 100, usedKiB: 10, availableKiB: 90, usePercent: 10 },
    swapActivity: { kind: "value", siKBs: 0, soKBs: 0, waPercent: 0, activelySwapping: false },
    ...over,
  } satisfies Partial<HealthReport>;
  return {
    ...readings,
    attribution: { kind: "unknown", why: "not part of this test" },
    verdict: computeVerdict(readings),
    collectedAt: new Date(NOW - ageMs).toISOString(),
    tookMs: 40,
  };
}

describe("the level new-session admission reads from the server's last health report", () => {
  it("is ok for a fresh ok report", () => {
    expect(newSessionHealthLevel(report(), NOW, MAX_AGE_MS)).toBe("ok");
  });

  it("is critical for a fresh critical report", () => {
    const starved = report({
      memory: { kind: "value", totalBytes: 32e9, availableBytes: 32e7, availableFraction: 0.01 },
    });
    expect(starved.verdict.level).toBe("critical");
    expect(newSessionHealthLevel(starved, NOW, MAX_AGE_MS)).toBe("critical");
  });

  it("is unknown for a report older than the allowed age, however healthy it was", () => {
    expect(newSessionHealthLevel(report({}, MAX_AGE_MS + 1), NOW, MAX_AGE_MS)).toBe("unknown");
    // PAIRED: the boundary itself is still a reading.
    expect(newSessionHealthLevel(report({}, MAX_AGE_MS), NOW, MAX_AGE_MS)).toBe("ok");
  });

  it("is unknown when there is no report, or one whose clock cannot be read", () => {
    expect(newSessionHealthLevel(null, NOW, MAX_AGE_MS)).toBe("unknown");
    expect(newSessionHealthLevel({ ...report(), collectedAt: "not a date" }, NOW, MAX_AGE_MS)).toBe("unknown");
  });

  it("leaves the vmstat swap-activity sample out, as the gate always has", () => {
    /* The old gate collected with `includeSwapActivity: false`: "the question
       is answered by load, memory and swap fullness". The server's report DOES
       carry the sample, so the report's own verdict is not the gate's. */
    const thrashing = report({
      swapActivity: { kind: "value", siKBs: 900, soKBs: 900, waPercent: 90, activelySwapping: true },
    });
    expect(thrashing.verdict.level).toBe("critical");
    expect(newSessionHealthLevel(thrashing, NOW, MAX_AGE_MS)).toBe("ok");
  });
});

describe("the default, unconfigured health read", () => {
  it("answers unknown without collecting anything", () => {
    expect(realIo().healthLevel()).toBe("unknown");
    expect(collectHealth).not.toHaveBeenCalled();
  });

  it("is refused by the route, with a sentence that covers a missing reading", async () => {
    const io = realIo();
    const runs: unknown[] = [];
    const routes = createNewSessionRoutes({
      io: {
        ...io,
        run: async (req) => {
          runs.push(req);
          return { code: 0, stdout: "", stderr: "", timedOut: false, spawnError: null };
        },
        dirExists: () => true,
        log: () => {},
      },
      root: "/home/greg/code/spideryarn2",
      defaultDir: "/home/greg/code/spideryarn2",
      roots: ["/home/greg"],
    });

    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ prompt: "p" }))]), {
      method: "POST",
      url: "/api/sessions/new",
      headers: {
        host: "127.0.0.1:8787",
        origin: "http://127.0.0.1:8787",
        "content-type": "application/json",
      },
    });
    let status = 0;
    let body = "";
    const res = {
      writeHead(code: number) {
        status = code;
      },
      end(text?: string) {
        body = text ?? "";
      },
    };
    await routes.handle(req as never, res as never);

    expect(status).toBe(503);
    expect(JSON.parse(body).error).toMatch(/no current health reading/i);
    expect(runs).toHaveLength(0);
    expect(collectHealth).not.toHaveBeenCalled();
  });
});
