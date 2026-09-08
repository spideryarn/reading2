/**
 * Does a usage report actually reach `current.json`?
 *
 * The pieces below it are tested elsewhere — the collector in
 * `overseer-usage.test.ts`, the supersede rule in `overseer-usage-carry.test.ts`,
 * the store field in `overseer-store.test.ts`. **Every one of them can be green
 * while the wiring between the daemon and the file is not**, which is the class
 * this repo has a postmortem about: four features built, tested, routed and dead,
 * with every part covered and none of the joins.
 *
 * So this runs the real daemon against a scratch store with an injected source
 * and an injected runner, and reads the bytes back off disk.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { ScanCoverage, UsageAccount, UsageReport } from "../tools/fleet/wire.js";
import { runOverseer } from "../tools/overseer/daemon.js";
import { readCheckpoint } from "../tools/overseer/store.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-usage-wiring-"));
  roots.push(root);
  return root;
}

function completeCoverage(over: Partial<ScanCoverage> = {}): ScanCoverage {
  return {
    transcriptsFound: 4,
    transcriptsSelected: 4,
    transcriptsOpened: 4,
    transcriptsUnreadable: 0,
    unreadableWhy: [],
    linesScanned: 900,
    candidateLines: 0,
    linesParsed: 0,
    malformedCandidates: 0,
    quotaLimitsWithoutErrorSignal: 0,
    truncatedByLimit: false,
    sinceMs: null,
    tookMs: 40,
    ...over,
  };
}

const ACCOUNT: UsageAccount = {
  kind: "value",
  email: "greg@rehearsable.ai",
  orgId: null,
  orgName: null,
  subscriptionType: "max",
  accountUuid: "acct-A",
  rateLimitTier: null,
};

function report(over: Partial<UsageReport> = {}): UsageReport {
  return {
    account: ACCOUNT,
    cache: { kind: "unknown", why: "no cache reading in this fixture" },
    rateLimits: { kind: "none", coverage: completeCoverage() },
    verdict: { level: "ok", reasons: ["no limit hit"], activeLimit: null },
    collectedAt: "2026-09-08T11:59:00.000Z",
    tookMs: 40,
    ...over,
  };
}

function abortAfter(ms: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref?.();
  return controller;
}

async function heldOpen(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve());
  });
}

describe("the whole path: does a usage report reach current.json", () => {
  test("a report produced by the pass is on disk when the daemon stops", async () => {
    const root = tempRoot();
    const controller = abortAfter(700);
    let passes = 0;
    const produced = report();

    await runOverseer({
      root,
      baseUrl: "http://127.0.0.1:1",
      signal: controller.signal,
      tickMs: 100,
      log: () => {},
      source: async function* () {
        await heldOpen(controller.signal);
      },
      usage: {
        intervalMs: 60,
        run: async () => {
          passes += 1;
          return produced;
        },
      },
    });

    expect(passes).toBeGreaterThan(0);
    const read = readCheckpoint(root);
    expect(read.kind).toBe("checkpoint");
    if (read.kind !== "checkpoint") return;
    expect(read.checkpoint.usage).toEqual({ kind: "report", report: produced });
  });

  test("a daemon given no runner publishes `none`, not a report saying nothing is wrong", async () => {
    // The state on a box where somebody passed `--no-usage`. What the page draws
    // is *nothing has looked* — which is not *this account has plenty of room*.
    const root = tempRoot();
    const controller = abortAfter(400);

    await runOverseer({
      root,
      baseUrl: "http://127.0.0.1:1",
      signal: controller.signal,
      tickMs: 100,
      log: () => {},
      source: async function* () {
        await heldOpen(controller.signal);
      },
    });

    const read = readCheckpoint(root);
    expect(read.kind).toBe("checkpoint");
    if (read.kind !== "checkpoint") return;
    expect(read.checkpoint.usage.kind).toBe("none");
    if (read.checkpoint.usage.kind !== "none") return;
    expect(read.checkpoint.usage.why).toMatch(/no usage pass has run/);
  });

  test("a thrown pass publishes `none` with the reason, not the last good report", async () => {
    // Going on publishing a reading taken before the thing broke is exactly the
    // failure this stage exists to refuse — a plausible number with nothing in it
    // announcing that it is void.
    const root = tempRoot();
    const controller = abortAfter(700);

    await runOverseer({
      root,
      baseUrl: "http://127.0.0.1:1",
      signal: controller.signal,
      tickMs: 100,
      log: () => {},
      source: async function* () {
        await heldOpen(controller.signal);
      },
      usage: {
        intervalMs: 60,
        run: async () => {
          throw new Error("~/.claude.json went away");
        },
      },
    });

    const read = readCheckpoint(root);
    expect(read.kind).toBe("checkpoint");
    if (read.kind !== "checkpoint") return;
    expect(read.checkpoint.usage.kind).toBe("none");
    if (read.checkpoint.usage.kind !== "none") return;
    expect(read.checkpoint.usage.why).toContain("~/.claude.json went away");
  });

  test("an incomplete scan does NOT displace the report already on the checkpoint", async () => {
    // THE POINT OF THE CARRY RULE, asserted through the daemon rather than
    // against `chooseUsage` directly: a scan that could not finish must not turn
    // a known reading into a worse one.
    const root = tempRoot();
    const good = report({ collectedAt: "2026-09-08T11:59:00.000Z" });
    const partial = report({
      collectedAt: "2026-09-08T12:30:00.000Z",
      rateLimits: { kind: "none", coverage: completeCoverage({ transcriptsOpened: 0 }) },
    });

    // First run: one complete scan, which lands.
    const first = abortAfter(500);
    await runOverseer({
      root,
      baseUrl: "http://127.0.0.1:1",
      signal: first.signal,
      tickMs: 100,
      log: () => {},
      source: async function* () {
        await heldOpen(first.signal);
      },
      usage: { intervalMs: 60, run: async () => good },
    });

    // Second run: the store restores the report, and every scan is incomplete.
    const second = abortAfter(500);
    await runOverseer({
      root,
      baseUrl: "http://127.0.0.1:1",
      signal: second.signal,
      tickMs: 100,
      log: () => {},
      source: async function* () {
        await heldOpen(second.signal);
      },
      usage: { intervalMs: 60, run: async () => partial },
    });

    const read = readCheckpoint(root);
    expect(read.kind).toBe("checkpoint");
    if (read.kind !== "checkpoint") return;
    // The GOOD one, restored across the restart and defended against the partial.
    expect(read.checkpoint.usage).toEqual({ kind: "report", report: good });
  });
});
