/**
 * **The join test, end to end: does a usage pass become a line on disk?**
 *
 * The daemon hook, the mapping and the store are each covered by their own
 * suite, and all three can be green while nothing connects them. That is not a
 * hypothetical here — it is the failure `health-wiring.ts` exists to close,
 * after four features shipped built, tested, routed and dead.
 *
 * So this runs the **real daemon** against a scratch store with an injected
 * collector, and reads the bytes back off the disk with the real reader.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { parse as babelParse } from "@babel/parser";
import type { Node } from "@babel/types";

import { usageHistoryDaemonOptions } from "../scripts/overseer.js";
import { openUsageHistoryForRead } from "../tools/fleet/usage-history.js";
import { makeUsageRetention } from "../tools/fleet/usage-history-wiring.js";
import type { CodexUsageReading, ScanCoverage, UsageAccount, UsageReport } from "../tools/fleet/wire.js";
import { runOverseer } from "../tools/overseer/daemon.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "usage-history-wiring-"));
  roots.push(root);
  return root;
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function containsNamedCall(node: Node, name: string): boolean {
  if (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === name
  ) {
    return true;
  }
  return Object.values(node).some((value) =>
    Array.isArray(value)
      ? value.some((child) => isNode(child) && containsNamedCall(child, name))
      : isNode(value) && containsNamedCall(value, name),
  );
}

function hasUsageHistoryComposition(sourceText: string): boolean {
  const source = babelParse(sourceText, { sourceType: "module", plugins: ["typescript"] });
  let wired = false;

  const visit = (node: Node): void => {
    if (
      node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      node.callee.name === "runOverseer" &&
      node.arguments.some((argument) => isNode(argument) && containsNamedCall(argument, "usageHistoryDaemonOptions"))
    ) {
      wired = true;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child);
      } else if (isNode(value)) {
        visit(value);
      }
    }
  };

  visit(source);
  return wired;
}

function coverage(over: Partial<ScanCoverage> = {}): ScanCoverage {
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

const CODEX: CodexUsageReading = {
  kind: "value",
  accountId: "redacted-codex-account",
  readAt: "2026-09-09T00:50:36.000Z",
  buckets: [
    {
      limitId: "codex",
      limitName: null,
      windows: [
        {
          kind: "value",
          slot: "primary",
          windowMinutes: 10_080,
          usedPercent: 24,
          resetsAt: "2026-09-15T01:23:19.000Z",
          resetsAtMs: 1789435399000,
        },
      ],
      planType: "pro",
      credits: { hasCredits: false, unlimited: false, balance: "0" },
      individualLimit: null,
      spendControlReached: false,
      rateLimitReachedType: null,
    },
  ],
  resetCredits: 2,
};

function report(over: Partial<UsageReport> = {}): UsageReport {
  return {
    account: ACCOUNT,
    cache: {
      kind: "value",
      accountUuid: "acct-A",
      fetchedAtMs: Date.parse("2026-09-09T00:50:35.885Z"),
      ageMs: 1000,
      windows: [
        {
          kind: "value",
          window: "five_hour",
          utilizationPercent: 40,
          resetsAt: "2026-09-09T02:49:59.754Z",
          resetsAtMs: 1788922199754,
          msUntilReset: 10_000,
        },
      ],
    },
    rateLimits: { kind: "none", coverage: coverage() },
    verdict: { level: "ok", reasons: ["no limit hit"], activeLimit: null },
    collectedAt: "2026-09-09T00:50:35.000Z",
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWith(
  run: () => Promise<UsageReport>,
  forMs = 400,
  collectCodex: () => Promise<CodexUsageReading> = async () => CODEX,
): Promise<string> {
  const root = tempRoot();
  const controller = abortAfter(forMs);
  const retention = makeUsageRetention(root, { nextDueMs: 300_000, log: () => {} });

  await runOverseer({
    root,
    baseUrl: "http://127.0.0.1:1",
    signal: controller.signal,
    tickMs: 40,
    log: () => {},
    source: async function* () {
      yield* [];
      await heldOpen(controller.signal);
    },
    usage: { ...usageHistoryDaemonOptions(retention, { claude: run, codex: collectCodex }), intervalMs: 120 },
  });
  retention.close();
  return root;
}

describe("a usage pass becomes a line on disk", () => {
  test("THE JOIN. The daemon runs, and the history file has the reading in it", async () => {
    const root = await runWith(async () => report());

    const read = openUsageHistoryForRead(root).read({ sinceMs: 0 });
    expect(read.kind).toBe("read");
    if (read.kind !== "read") return;
    expect(read.samples.length).toBeGreaterThan(0);

    const first = read.samples[0];
    if (first?.kind !== "sample" || first.line.pass.kind !== "pass") throw new Error("shape");
    /* The observation's OWN instant, not the daemon's — three clocks kept
       apart, all the way from the collector to the bytes. */
    expect(first.line.pass.collectedAt).toBe("2026-09-09T00:50:35.000Z");
    expect(first.line.nextDueMs).toBe(300_000);
    expect(first.line.pass.cache.kind).toBe("attributed");
    expect(first.line.pass.publication.decision).toBe("take-fresh");
    expect(first.line.codex).toEqual(CODEX);
  });

  test("a collector that throws still leaves a record, with the reason", async () => {
    /* Silence and failure must not look the same on a chart. A pass that blew
       up is a fact worth a line. */
    const root = await runWith(async () => {
      throw new Error("ENOENT reading the cache");
    });

    const read = openUsageHistoryForRead(root).read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error("unreadable");
    const first = read.samples[0];
    if (first?.kind !== "sample" || first.line.pass.kind !== "collector-failed") throw new Error("shape");
    expect(first.line.pass.why).toMatch(/ENOENT/);
    expect(first.line.codex).toEqual(CODEX);
  });

  test("the composition root keeps Codex inside the single-flight pass and shutdown wait", async () => {
    /* This uses the helper called by scripts/overseer.ts, the real daemon, the
       real retention hook and real bytes. If Codex collection moves into an
       async onPass, shutdown returns at the assertion below and closes the
       writer while that collection is still unresolved. */
    const compositionRoot = readFileSync(fileURLToPath(new URL("../scripts/overseer.ts", import.meta.url)), "utf8");
    expect(hasUsageHistoryComposition(compositionRoot)).toBe(true);

    const root = tempRoot();
    const controller = new AbortController();
    const retention = makeUsageRetention(root, { nextDueMs: 300_000, log: () => {} });
    const codex = deferred<CodexUsageReading>();
    let claudeCalls = 0;
    let codexCalls = 0;
    const firstCodexCall = deferred<void>();

    const running = runOverseer({
      root,
      baseUrl: "http://127.0.0.1:1",
      signal: controller.signal,
      tickMs: 10,
      log: () => {},
      source: async function* () {
        yield* [];
        await heldOpen(controller.signal);
      },
      usage: {
        ...usageHistoryDaemonOptions(retention, {
          claude: async () => {
            claudeCalls += 1;
            return report();
          },
          codex: () => {
            codexCalls += 1;
            firstCodexCall.resolve();
            return codex.promise;
          },
        }),
        intervalMs: 20,
      },
    });

    await firstCodexCall.promise;
    await pause(70);
    expect(claudeCalls).toBe(1);
    expect(codexCalls).toBe(1);

    let stopped = false;
    void running.then(() => {
      stopped = true;
    });
    controller.abort();
    await pause(20);
    expect(stopped, "shutdown returned while Codex collection was still in flight").toBe(false);

    codex.resolve(CODEX);
    await running;
    retention.close();

    const read = openUsageHistoryForRead(root).read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error("unreadable");
    expect(read.samples).toHaveLength(1);
    const first = read.samples[0];
    if (first?.kind !== "sample" || first.line.pass.kind !== "pass") throw new Error("shape");
    expect(first.line.pass.collectedAt).toBe(report().collectedAt);
    expect(first.line.codex).toEqual(CODEX);
  });

  test("a rejected Codex collection does not turn a good Claude pass into collector-failed", async () => {
    const root = await runWith(async () => report(), 400, async () => {
      throw new Error("temporary Codex failure");
    });

    const read = openUsageHistoryForRead(root).read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error("unreadable");
    const first = read.samples[0];
    if (first?.kind !== "sample") throw new Error("shape");
    expect(first.line.pass.kind).toBe("pass");
    expect(first.line.codex).toMatchObject({ kind: "unknown", retryable: true });
  });

  test("a synchronous Codex throw still awaits the Claude collector", async () => {
    const root = tempRoot();
    const retention = makeUsageRetention(root, { nextDueMs: 300_000, log: () => {} });
    const claude = deferred<UsageReport>();
    let claudeStarted = false;

    const running = usageHistoryDaemonOptions(retention, {
      claude: () => {
        claudeStarted = true;
        return claude.promise;
      },
      codex: () => {
        throw new Error("synchronous failure");
      },
    }).run();
    const observed = running.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );
    let settled = false;
    void observed.then(() => {
      settled = true;
    });

    await pause(0);
    expect(claudeStarted).toBe(true);
    expect(settled, "the combined pass abandoned Claude after Codex threw synchronously").toBe(false);

    claude.resolve(report());
    await expect(observed).resolves.toMatchObject({ status: "fulfilled", value: report() });
    retention.close();
  });

  test("an incomplete scan still records its CACHE reading", async () => {
    /* The whole reason the record has three independent facts. `chooseUsage`
       will decline to publish this report, but the cache reading came from a
       different source and is perfectly good — dropping it would take a real,
       attributed utilisation point off the chart because one transcript could
       not be opened. */
    let call = 0;
    const root = await runWith(async () => {
      call += 1;
      return call === 1
        ? report()
        : report({
            collectedAt: "2026-09-09T00:55:35.000Z",
            rateLimits: {
              kind: "none",
              coverage: coverage({ transcriptsOpened: 1, transcriptsUnreadable: 3, unreadableWhy: ["EACCES"] }),
            },
          });
    }, 700);

    const read = openUsageHistoryForRead(root).read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error("unreadable");
    const kept = read.samples.find(
      (s) => s.kind === "sample" && s.line.pass.kind === "pass" && s.line.pass.publication.decision === "keep-stored",
    );
    expect(kept, "no keep-stored line was written").toBeDefined();
    if (kept?.kind !== "sample" || kept.line.pass.kind !== "pass") return;
    expect(kept.line.pass.cache.kind).toBe("attributed");
    expect(kept.line.pass.scan.conclusive).toBe(false);
    expect(kept.line.pass.scan.why).toBeTruthy();
  });

  test("opens the store ONCE, however many passes run — an fd leak the daemon would feel", async () => {
    /* Found by mutation: reopening on every pass passed every other test in this
       file, because the bytes come out identical. It is still a bug — a pass
       every five minutes is 288 descriptors a day on a process that is meant to
       run for weeks, and it ends at `EMFILE` in the one component whose job is
       to still be working when everything else is broken.

       Counted from /proc rather than by injecting an opener, so this measures
       the actual resource rather than mirroring the implementation. Linux-only,
       which is what this daemon runs on. */
    const before = readdirSync("/proc/self/fd").length;
    const root = await runWith(async () => report(), 700);
    const after = readdirSync("/proc/self/fd").length;

    const read = openUsageHistoryForRead(root).read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error("unreadable");
    /* Several passes really did run, so the count means something. */
    expect(read.samples.length).toBeGreaterThan(1);
    /* A couple of descriptors of slack for the store and the temp dir; a leak
       would be one per pass. */
    expect(after - before).toBeLessThanOrEqual(2);
  });

  test("nothing is written when no pass ever runs", async () => {
    /* The store must not be created by merely starting a daemon: an empty file
       and an absent one are different answers to "has anything been recorded",
       and the route says different things about them. */
    const root = tempRoot();
    const controller = abortAfter(300);
    const retention = makeUsageRetention(root, { nextDueMs: 300_000, log: () => {} });
    await runOverseer({
      root,
      baseUrl: "http://127.0.0.1:1",
      signal: controller.signal,
      tickMs: 40,
      log: () => {},
      source: async function* () {
        yield* [];
        await heldOpen(controller.signal);
      },
      usage: {
        ...usageHistoryDaemonOptions(retention, { claude: async () => report(), codex: async () => CODEX }),
        intervalMs: 100_000,
      },
    });
    retention.close();

    expect(retention.path()).toBeNull();
    const read = openUsageHistoryForRead(root).read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error("unreadable");
    expect(read.samples).toEqual([]);
    expect(read.earliestAt).toBeNull();
  });
});
