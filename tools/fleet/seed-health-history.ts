/**
 * Fill a health-history store with a day that contains every state the chart
 * has to draw, so a person can LOOK AT IT rather than trust a test.
 *
 *   npx tsx tools/fleet/seed-health-history.ts /tmp/some-dir
 *
 * **WHY THIS IS A SCRIPT AND NOT A FIXTURE IN A TEST.** Four features in this
 * tool were built, tested, routed, shipped and dead — every part had tests and
 * none of the joins did. A green suite says the code agrees with itself; it
 * does not say a person can see a gap on a 390px screen. Waiting a day for a
 * real outage is the alternative, and it is not one.
 *
 * NOTHING HERE RUNS AGAINST THE REAL STORE unless you name it: the directory is
 * a required argument, so a mistyped command writes nowhere rather than
 * inventing a day of history the dashboard would then serve as real.
 */
import { openHealthHistory, type HealthTurn } from "./health-history.js";
import type { HealthReport } from "./health.js";

const CADENCE_MS = 73_000;
const CORES = 16;

function report(at: Date, shape: { load: number; memFree: number; swap: number; wa: number; blindSwap?: boolean }): HealthReport {
  const level =
    shape.load / CORES > 4 || shape.memFree < 0.05 || shape.swap >= 0.98
      ? "critical"
      : shape.load / CORES > 2 || shape.memFree < 0.15 || shape.swap >= 0.9 || shape.wa >= 50
        ? "strained"
        : "ok";
  return {
    load: { kind: "value", load1: shape.load, load5: shape.load, load15: shape.load, cores: CORES, ratio1: shape.load / CORES },
    memory: {
      kind: "value",
      totalBytes: 32_859_295_744,
      availableBytes: Math.round(32_859_295_744 * shape.memFree),
      availableFraction: shape.memFree,
    },
    swap:
      shape.blindSwap === true
        ? { kind: "unknown", why: "swapon failed: Command failed: swapon --show --bytes" }
        : {
            kind: "value",
            totalBytes: 34_359_730_176,
            usedBytes: Math.round(34_359_730_176 * shape.swap),
            usedFraction: shape.swap,
            areas: 2,
          },
    disk: { kind: "value", totalKiB: 314_660_132, usedKiB: 150_167_904, availableKiB: 151_675_572, usePercent: 50 },
    swapActivity: { kind: "value", siKBs: shape.wa > 20 ? 1148 : 0, soKBs: 0, waPercent: shape.wa, activelySwapping: shape.wa > 20 },
    attribution: { kind: "value", groups: [{ kind: "vitest", procs: 24, rssKiB: 8_518_356 }] },
    verdict: { level, reasons: [`seeded: load ${shape.load}, memory ${(shape.memFree * 100).toFixed(0)}%`] },
    collectedAt: at.toISOString(),
    tookMs: 158,
  };
}

const dir = process.argv[2];
if (dir === undefined) {
  console.error("usage: npx tsx tools/fleet/seed-health-history.ts <absolute-dir>");
  process.exit(2);
}
const opened = openHealthHistory(dir);
if (opened.kind !== "open") {
  console.error(`✗ ${opened.why}`);
  process.exit(2);
}

const now = Date.now();
/* Twenty hours, not twenty-four, so the left of the window is genuinely
   "before the history began" and that region can be seen. */
const start = now - 20 * 3_600_000;
let written = 0;
let skipped = 0;

for (let at = start; at <= now; at += CADENCE_MS) {
  const hoursAgo = (now - at) / 3_600_000;

  /* A four-hour outage: nothing was running. No sample is written at all —
     this is the state that cannot be recorded, only inferred. */
  if (hoursAgo < 13 && hoursAgo > 9) {
    skipped += 1;
    continue;
  }

  const date = new Date(at);
  let turn: HealthTurn;

  if (hoursAgo < 8.6 && hoursAgo > 8.2) {
    /* The collector itself throwing — the box was UP and health collection was
       broken, which must not look like the outage above. */
    turn = { kind: "collector-failed", why: "collectHealth threw: EAGAIN: resource temporarily unavailable, spawn" };
  } else if (hoursAgo < 5.5 && hoursAgo > 5.1) {
    /* One command failing while the rest read fine: swap goes violet, the
       others carry on. */
    turn = { kind: "reading", report: report(date, { load: 9, memFree: 0.4, swap: 0.4, wa: 2, blindSwap: true }) };
  } else if (hoursAgo < 16.5 && hoursAgo > 15.5) {
    /* The thing this whole tool exists for: the box falling over. */
    const t = (16.5 - hoursAgo) / 1;
    turn = {
      kind: "reading",
      report: report(date, { load: 20 + t * 340, memFree: Math.max(0.02, 0.35 - t * 0.34), swap: Math.min(0.99, 0.4 + t * 0.6), wa: 20 + t * 60 }),
    };
  } else if (hoursAgo < 2 && hoursAgo > 1.8) {
    /* A short spike, one or two samples wide — the thing an averaged chart
       would erase and the reason `collapseVerdict` takes the worst. */
    turn = { kind: "reading", report: report(date, { load: 96, memFree: 0.08, swap: 0.93, wa: 12 }) };
  } else {
    const wobble = Math.sin(at / 4_000_000) * 6;
    turn = {
      kind: "reading",
      report: report(date, { load: 18 + wobble, memFree: 0.42 + Math.sin(at / 9_000_000) * 0.08, swap: 0.42, wa: 1 }),
    };
  }

  opened.store.append(turn, { at: date.toISOString(), nextDueMs: CADENCE_MS });
  written += 1;
}

console.log(`seeded ${written} samples into ${opened.dir} (${skipped} deliberately missing, for the outage)`);
