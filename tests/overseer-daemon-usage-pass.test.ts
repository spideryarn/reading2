/**
 * **`onPass`: does the daemon actually tell anyone when a usage pass happens?**
 *
 * This is the join test. The usage history store (`tools/fleet/usage-history.ts`)
 * and its record are covered elsewhere and can both be perfectly green while
 * nothing ever calls them — which is the class this repo has a postmortem about,
 * and the reason `health-wiring.ts` exists at all.
 *
 * Three things are load-bearing here and none of them is obvious:
 *
 *  1. **It fires once per PASS, never per tick.** `checkpointUpdate()` re-spreads
 *     the same `usage` object every `TICK_MS` (30 s), while a pass runs every
 *     `USAGE_INTERVAL_MS` (300 s). A hook on the checkpoint write — the obvious
 *     place — would fire ~2,880 times a day for ~288 readings, and would blur
 *     exactly the collector failures the history exists to show.
 *  2. **`keep-stored` still carries the fresh report.** `chooseUsage` declining
 *     to publish says nothing about that pass's *cache* reading, which is
 *     independent of the transcript scan. The discarded report is the only place
 *     that observation exists, and only the daemon has it.
 *  3. **A throwing callback must not become a false collector failure.** The hook
 *     is called inside the collector's promise chain; an unguarded throw there is
 *     caught by the chain's own `.catch()`, which would rewrite the live
 *     checkpoint to `{kind:"none"}` though collection succeeded — and then throw
 *     again on the retry, ending as an unhandled rejection that terminates the
 *     daemon. GPT Sol's G5.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { ScanCoverage, StoredAccountUsage, UsageAccount, UsageReport } from "../tools/fleet/wire.js";
import { runOverseer, type UsagePassOutcome } from "../tools/overseer/daemon.js";
import { readCheckpoint } from "../tools/overseer/store.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-usage-onpass-"));
  roots.push(root);
  return root;
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

function report(over: Partial<UsageReport> = {}): UsageReport {
  return {
    account: ACCOUNT,
    cache: { kind: "unknown", why: "no cache reading in this fixture" },
    rateLimits: { kind: "none", coverage: coverage() },
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

type Run = {
  root: string;
  outcomes: UsagePassOutcome[];
  passes: number;
};

async function runWithHook(options: {
  run: () => Promise<UsageReport>;
  onPass?: (outcome: UsagePassOutcome) => void;
  /** Long enough for several TICKS but only a few passes, or the reverse. */
  forMs?: number;
  usageIntervalMs?: number;
  tickMs?: number;
}): Promise<Run> {
  const root = tempRoot();
  const controller = abortAfter(options.forMs ?? 400);
  const outcomes: UsagePassOutcome[] = [];
  let passes = 0;

  await runOverseer({
    root,
    baseUrl: "http://127.0.0.1:1",
    signal: controller.signal,
    tickMs: options.tickMs ?? 40,
    log: () => {},
    source: async function* () {
      await heldOpen(controller.signal);
    },
    usage: {
      intervalMs: options.usageIntervalMs ?? 120,
      run: async () => {
        passes += 1;
        return await options.run();
      },
      onPass: (outcome) => {
        outcomes.push(outcome);
        options.onPass?.(outcome);
      },
    },
  });

  return { root, outcomes, passes };
}

describe("onPass fires once per pass, with the right arm", () => {
  test("a fresh complete report is `take-fresh`, and carries the report", async () => {
    const produced = report();
    const { outcomes, passes } = await runWithHook({ run: async () => produced });

    expect(passes).toBeGreaterThan(0);
    expect(outcomes.length).toBe(passes);
    const first = outcomes[0];
    expect(first?.kind).toBe("take-fresh");
    if (first?.kind !== "take-fresh") return;
    expect(first.report).toEqual(produced);
    expect(first.why.length).toBeGreaterThan(0);
    expect(Number.isFinite(Date.parse(first.at))).toBe(true);
  });

  test("`keep-stored` still carries the DISCARDED fresh report", async () => {
    /* The point of the whole design. `chooseUsage` keeps a complete earlier
       report over an incomplete fresh one — but the fresh pass still READ THE
       CACHE, and that observation is independent of the transcript scan. It
       exists nowhere but here: the checkpoint carries the held report, and the
       dashboard never sees the discarded one. */
    const complete = report({ collectedAt: "2026-09-08T11:00:00.000Z" });
    const incomplete = report({
      collectedAt: "2026-09-08T11:05:00.000Z",
      rateLimits: {
        kind: "none",
        coverage: coverage({ transcriptsOpened: 1, transcriptsUnreadable: 3, unreadableWhy: ["EACCES"] }),
      },
    });

    let call = 0;
    const { outcomes } = await runWithHook({
      forMs: 700,
      run: async () => {
        call += 1;
        return call === 1 ? complete : incomplete;
      },
    });

    const kept = outcomes.find((o) => o.kind === "keep-stored");
    expect(kept, `no keep-stored outcome in ${outcomes.map((o) => o.kind).join(", ")}`).toBeDefined();
    if (kept?.kind !== "keep-stored") return;
    expect(kept.report).toEqual(incomplete);
    expect(kept.why.length).toBeGreaterThan(0);
  });

  test("a thrown pass is `collector-failed`, with the reason", async () => {
    const { outcomes } = await runWithHook({
      run: async () => {
        throw new Error("ENOENT reading ~/.claude.json");
      },
    });
    const failed = outcomes[0];
    expect(failed?.kind).toBe("collector-failed");
    if (failed?.kind !== "collector-failed") return;
    expect(failed.why).toMatch(/ENOENT/);
  });

  test("it does NOT fire on a tick — the trap this hook exists to avoid", async () => {
    /* `checkpointUpdate()` re-spreads the same `usage` object every tick. A hook
       on the checkpoint write would fire ~2,880 times a day for ~288 readings,
       and an unchanged reading would drown the collector failures the series is
       for. So: a fast tick, a usage interval longer than the whole run, and the
       assertion is that NOTHING fires. */
    const { outcomes, passes } = await runWithHook({
      run: async () => report(),
      tickMs: 20,
      usageIntervalMs: 100_000,
      forMs: 400,
    });
    expect(passes).toBe(0);
    expect(outcomes).toEqual([]);
  });
});

describe("a throwing callback cannot damage the daemon", () => {
  /* GPT Sol's G5. Without containment, a throw inside the `.then()` is caught by
     the collector's own `.catch()`, which rewrites the live checkpoint to
     `{kind:"none"}` though the collection SUCCEEDED — and can then throw again
     handling that, ending as an unhandled rejection that terminates the daemon. */

  test("a throw on take-fresh does not become a collector failure on disk", async () => {
    const produced = report();
    const { root, outcomes } = await runWithHook({
      run: async () => produced,
      onPass: () => {
        throw new Error("the history store is on fire");
      },
    });

    expect(outcomes.length).toBeGreaterThan(0);
    const read = readCheckpoint(root);
    expect(read.kind).toBe("checkpoint");
    if (read.kind !== "checkpoint") return;
    /* THE ASSERTION. The collection worked, so the checkpoint must say so — a
       retention failure is not a usage failure, and reporting one as the other
       would have Greg investigating his account instead of his disk. */
    expect(read.checkpoint.usage).toEqual({ kind: "report", report: produced });
  });

  test("a throw does not stop later passes", async () => {
    let thrown = 0;
    const { passes, outcomes } = await runWithHook({
      forMs: 700,
      run: async () => report(),
      onPass: () => {
        thrown += 1;
        throw new Error("still on fire");
      },
    });
    expect(passes).toBeGreaterThan(1);
    expect(thrown).toBe(outcomes.length);
    expect(outcomes.length).toBeGreaterThan(1);
  });

  test("a throw on the collector-failed arm is contained too", async () => {
    /* The arm most likely to be missed: the hook is called from inside a
       `.catch()`, where an unguarded throw has nowhere left to go. */
    const { root, outcomes } = await runWithHook({
      run: async () => {
        throw new Error("scan exploded");
      },
      onPass: () => {
        throw new Error("and so did the history");
      },
    });
    expect(outcomes[0]?.kind).toBe("collector-failed");
    const read = readCheckpoint(root);
    expect(read.kind).toBe("checkpoint");
    if (read.kind !== "checkpoint") return;
    expect(read.checkpoint.usage?.kind).toBe("none");
  });
});

/**
 * **THE PER-ACCOUNT PASS — DOES THE DAEMON ACTUALLY CALL IT?** Plan 260910c.
 *
 * The same join question as `onPass` above, and the same answer if nobody asks
 * it: `collectAccountUsage` and its projection can both be perfectly green while
 * nothing on the box ever calls the collector, and the page then draws no
 * sections — which looks exactly like a box with one subscription.
 *
 * Two properties are load-bearing and neither is obvious:
 *
 *  1. **It runs even when the transcript scan THREW.** These are cheap provider
 *     calls with nothing to do with that 2.9 GB walk; letting the walk take them
 *     down is the *a publication decision is not an observation* mistake one
 *     level up from where it was made before.
 *  2. **A daemon with no collector publishes `none` with a reason**, never an
 *     empty list and never silence. That is what makes the absence of this
 *     wiring visible rather than indistinguishable from a quiet box.
 */
describe("the per-account pass is wired, and is independent of the scan", () => {
  const reading = (collectedAt: string): StoredAccountUsage => ({
    kind: "reading",
    collectedAt,
    problems: [],
    accounts: [
      {
        name: "mindstone",
        family: "claude",
        role: "pool",
        origin: "registered",
        displayEmail: "greg@mindstone.com",
        providerAccountId: "provider-mindstone",
        takenAt: collectedAt,
        reading: { kind: "windows", windows: [] },
      },
    ],
  });

  async function runWithAccounts(options: {
    run: () => Promise<UsageReport>;
    accounts?: () => Promise<StoredAccountUsage>;
  }): Promise<{ root: string; calls: number }> {
    const root = tempRoot();
    const controller = abortAfter(400);
    let calls = 0;
    const collect = options.accounts;
    await runOverseer({
      root,
      baseUrl: "http://127.0.0.1:1",
      signal: controller.signal,
      tickMs: 40,
      log: () => {},
      source: async function* () {
        await heldOpen(controller.signal);
      },
      usage: {
        intervalMs: 120,
        run: options.run,
        ...(collect === undefined
          ? {}
          : {
              accounts: async () => {
                calls += 1;
                return await collect();
              },
            }),
      },
    });
    return { root, calls };
  }

  test("publishes every account the collector returned", async () => {
    const { root, calls } = await runWithAccounts({
      run: async () => report(),
      accounts: async () => reading("2026-09-10T06:00:00.000Z"),
    });
    expect(calls).toBeGreaterThan(0);
    const read = readCheckpoint(root);
    expect(read.kind).toBe("checkpoint");
    if (read.kind !== "checkpoint") return;
    expect(read.checkpoint.accountUsage.kind).toBe("reading");
    if (read.checkpoint.accountUsage.kind !== "reading") return;
    expect(read.checkpoint.accountUsage.accounts.map((account) => account.name)).toEqual(["mindstone"]);
  });

  test("runs the account pass even when the transcript scan threw", async () => {
    const { root, calls } = await runWithAccounts({
      run: async () => {
        throw new Error("the scan fell over");
      },
      accounts: async () => reading("2026-09-10T06:00:00.000Z"),
    });
    expect(calls).toBeGreaterThan(0);
    const read = readCheckpoint(root);
    if (read.kind !== "checkpoint") throw new Error("no checkpoint");
    /* The two readings disagree about the world, which is the point: the scan
       failed and the accounts were read anyway. */
    expect(read.checkpoint.usage.kind).toBe("none");
    expect(read.checkpoint.accountUsage.kind).toBe("reading");
  });

  test("a rejecting account pass becomes `none` with a reason, never a held reading", async () => {
    const { root } = await runWithAccounts({
      run: async () => report(),
      accounts: async () => {
        throw new Error("every account 401'd");
      },
    });
    const read = readCheckpoint(root);
    if (read.kind !== "checkpoint") throw new Error("no checkpoint");
    expect(read.checkpoint.accountUsage.kind).toBe("none");
    if (read.checkpoint.accountUsage.kind !== "none") return;
    expect(read.checkpoint.accountUsage.why).toContain("every account 401'd");
  });

  /**
   * **THE MUTATION CHECK.** Removing the collector from the composition root is
   * exactly the regression a suite of unit tests with injected fakes cannot see.
   * The checkpoint must then say *no pass has run* in words — not carry an empty
   * list, and not carry nothing at all.
   */
  test("a daemon with no account collector says so, rather than saying nothing", async () => {
    const { root, calls } = await runWithAccounts({ run: async () => report() });
    expect(calls).toBe(0);
    const read = readCheckpoint(root);
    if (read.kind !== "checkpoint") throw new Error("no checkpoint");
    expect(read.checkpoint.accountUsage.kind).toBe("none");
    if (read.checkpoint.accountUsage.kind !== "none") return;
    expect(read.checkpoint.accountUsage.why).toContain("no per-account usage pass has run");
  });
});
