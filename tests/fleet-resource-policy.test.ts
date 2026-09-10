/**
 * **DO THE COLLECTOR AND THE PAGE AGREE ABOUT WHERE AMBER STARTS?**
 *
 * `tools/fleet/resource-policy.ts` exists because they did not have to. Until
 * 2026-09-10 `computeVerdict` compared against literals in its own `if`
 * statements and `web/src/health-view.ts` declared the same numbers again, and
 * the note that said a test would catch a divergence was wrong:
 * `tests/fleet-web.test.tsx` pins the *tile* at the literal `0.15` and never
 * calls `computeVerdict`. Moving health.ts's literal left the whole suite green
 * with the badge saying `ok` over a tile drawn amber.
 *
 * So every boundary here is **computed from the policy constant**, never
 * written as a number. Change a constant and these tests follow it; change one
 * of `computeVerdict`'s comparisons without changing the constant and they go
 * red. That is the only shape that relates two consumers rather than describing
 * each of them separately —
 * docs/reusable/silent-success.md, and the mutation argument in
 * tools/fleet/health-history.ts's lock header.
 */
import { describe, expect, it } from "vitest";

import {
  computeVerdict,
  type DiskReading,
  type LoadReading,
  type MemoryReading,
  type SwapActivityReading,
  type SwapReading,
} from "../tools/fleet/health.js";
import {
  LOAD_BAR_CEILING,
  LONG_RUN_MS,
  MEMORY_USED_PERCENT,
  RESOURCE_POLICY,
} from "../tools/fleet/resource-policy.js";
import { MEMORY_USED_PERCENT as VIEW_MEMORY_USED_PERCENT, THRESHOLDS } from "../tools/fleet/web/src/health-view.js";

/* One healthy reading of each kind, so a test can move ONE of them and know
   that whatever the verdict says is about the one it moved. */
const CORES = 16;

function load(ratio1: number): LoadReading {
  return { kind: "value", load1: ratio1 * CORES, load5: ratio1 * CORES, load15: ratio1 * CORES, cores: CORES, ratio1 };
}

function memory(availableFraction: number): MemoryReading {
  const totalBytes = 32 * 1024 ** 3;
  return { kind: "value", totalBytes, availableBytes: Math.round(totalBytes * availableFraction), availableFraction };
}

function swap(usedFraction: number): SwapReading {
  const totalBytes = 8 * 1024 ** 3;
  return { kind: "value", totalBytes, usedBytes: Math.round(totalBytes * usedFraction), usedFraction, areas: 1 };
}

function disk(usePercent: number): DiskReading {
  return { kind: "value", totalKiB: 1_000_000, usedKiB: usePercent * 10_000, availableKiB: 1, usePercent };
}

function swapActivity(waPercent: number, activelySwapping: boolean): SwapActivityReading {
  return { kind: "value", siKBs: activelySwapping ? 128 : 0, soKBs: activelySwapping ? 128 : 0, waPercent, activelySwapping };
}

const CALM = {
  load: load(0.5),
  memory: memory(0.6),
  swap: swap(0),
  disk: disk(10),
  swapActivity: swapActivity(0, false),
};

function levelOf(over: Partial<typeof CALM>): string {
  return computeVerdict({ ...CALM, ...over }).level;
}

/**
 * The smallest step that a double can take at these magnitudes.
 *
 * Written as a nudge of the value itself rather than as a fixed epsilon,
 * because the cutoffs span four orders of magnitude — `0.05` and `97` cannot
 * share a constant, and a hand-picked `0.001` would silently stop testing the
 * boundary the day a cutoff moved to a tighter number.
 */
function justAbove(n: number): number {
  return n + Math.max(Math.abs(n) * 1e-9, Number.EPSILON);
}
function justBelow(n: number): number {
  return n - Math.max(Math.abs(n) * 1e-9, Number.EPSILON);
}

describe("the collector's verdict turns at the policy's numbers", () => {
  it("load is STRICTLY greater than, so exactly the cutoff is not yet strained", () => {
    expect(levelOf({ load: load(RESOURCE_POLICY.loadRatio.strained) })).toBe("ok");
    expect(levelOf({ load: load(justAbove(RESOURCE_POLICY.loadRatio.strained)) })).toBe("strained");
    expect(levelOf({ load: load(RESOURCE_POLICY.loadRatio.critical) })).toBe("strained");
    expect(levelOf({ load: load(justAbove(RESOURCE_POLICY.loadRatio.critical)) })).toBe("critical");
  });

  it("memory runs the other way: LESS available is worse, and exactly the cutoff is still fine", () => {
    expect(levelOf({ memory: memory(RESOURCE_POLICY.memoryAvailable.strained) })).toBe("ok");
    expect(levelOf({ memory: memory(justBelow(RESOURCE_POLICY.memoryAvailable.strained)) })).toBe("strained");
    expect(levelOf({ memory: memory(RESOURCE_POLICY.memoryAvailable.critical) })).toBe("strained");
    expect(levelOf({ memory: memory(justBelow(RESOURCE_POLICY.memoryAvailable.critical)) })).toBe("critical");
  });

  it("swap is a step function AT the cutoff, not above it", () => {
    expect(levelOf({ swap: swap(justBelow(RESOURCE_POLICY.swapUsed.strained)) })).toBe("ok");
    expect(levelOf({ swap: swap(RESOURCE_POLICY.swapUsed.strained) })).toBe("strained");
    expect(levelOf({ swap: swap(RESOURCE_POLICY.swapUsed.critical) })).toBe("critical");
  });

  it("disk turns at its cutoff, and a full disk is critical even when nothing else is wrong", () => {
    expect(levelOf({ disk: disk(RESOURCE_POLICY.diskUsed.strained - 1) })).toBe("ok");
    expect(levelOf({ disk: disk(RESOURCE_POLICY.diskUsed.strained) })).toBe("strained");
    expect(levelOf({ disk: disk(RESOURCE_POLICY.diskUsed.critical) })).toBe("critical");
  });

  it("IO wait is one cutoff and two meanings: disk-bound is strained, thrashing is critical", () => {
    const wa = RESOURCE_POLICY.ioWait.thrashing;
    expect(levelOf({ swapActivity: swapActivity(wa - 1, false) })).toBe("ok");
    expect(levelOf({ swapActivity: swapActivity(wa, false) })).toBe("strained");
    expect(levelOf({ swapActivity: swapActivity(wa, true) })).toBe("critical");
    /* Movement alone, with a quiet disk, is strained — fullness and movement
       are different facts and neither implies the other. */
    expect(levelOf({ swapActivity: swapActivity(0, true) })).toBe("strained");
  });
});

describe("the page reads the same numbers, not a copy of them", () => {
  it("health-view's THRESHOLDS IS the policy, so a copy cannot drift from it", () => {
    /* Identity, not deep equality: a `toEqual` would pass against a second
       object holding the same numbers, which is precisely the state this file
       exists to make impossible. */
    expect(THRESHOLDS).toBe(RESOURCE_POLICY);
    expect(VIEW_MEMORY_USED_PERCENT).toBe(MEMORY_USED_PERCENT);
  });

  it("the percentages the page prints are derived from the fractions the collector compares", () => {
    expect(MEMORY_USED_PERCENT.strained).toBe(Math.round((1 - RESOURCE_POLICY.memoryAvailable.strained) * 100));
    expect(MEMORY_USED_PERCENT.critical).toBe(Math.round((1 - RESOURCE_POLICY.memoryAvailable.critical) * 100));
    expect(LOAD_BAR_CEILING).toBe(RESOURCE_POLICY.loadRatio.critical * 2);
  });

  it("the long-run mark is a duration, and a plausible one", () => {
    /* Not a pin on fifteen minutes — that number is a judgement and may move.
       What must stay true is that it is a real duration between a minute and an
       hour, because it is compared against a frozen `ranForMs` in milliseconds
       and a units slip there is invisible on the page. */
    expect(LONG_RUN_MS).toBeGreaterThan(60_000);
    expect(LONG_RUN_MS).toBeLessThan(60 * 60_000);
  });
});
