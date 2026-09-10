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
import type { StoredWorkGroup, StoredWorkTurn } from "./wire.js";

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

/**
 * A work reading for one turn — **every state the new section has to draw**,
 * for the same reason the health shapes above exist: so a person can look at it.
 *
 * The cadence is the real one, so most turns are `not-due` and the section's
 * marks are five minutes apart rather than seventy-three seconds apart, which
 * is the spacing a reader will actually meet.
 *
 * Four deliberate stretches, and the third is the one worth seeding:
 *
 *  - **the spike at 16h** carries the work it is meant to be explained by —
 *    three concurrent test suites and a review, which is what that shape on this
 *    box has always turned out to be;
 *  - **around 12h** the probe fails, so the section shows the daemon's own
 *    reason rather than an absence;
 *  - **around 6h the SAME `scannedAt` repeats for half an hour** — a daemon
 *    that has stopped producing fresh scans. Drawn naively this is thirty
 *    minutes of activity; drawn correctly it is one observation, said once. It
 *    is the one state no test can show you the look of;
 *  - **around 3h** a group's jobs have unknown starts, so the `partial` and
 *    `unknown` timing arms are on screen rather than only in a type.
 */
function workTurn(at: number, hoursAgo: number): StoredWorkTurn {
  /* Five minutes, not the collection cadence. `at` rather than a counter, so a
     skipped sample does not shift the phase of everything after it. */
  if (Math.floor(at / 300_000) === Math.floor((at - CADENCE_MS) / 300_000)) return { kind: "not-due" };

  const scan = (scannedAt: string, groups: StoredWorkGroup[], panes: { work: number; none: number; cannotTell: number }): StoredWorkTurn => ({
    kind: "due",
    result: { kind: "scan", scannedAt, groups, groupsDropped: 0, panes },
  });
  /* The seeded key is shaped like a real one (`$id none`) and the name is the
     readable half, so the demo exercises the same key/name split the live
     checkpoint does rather than quietly passing a name off as a key. */
  const known = (session: string, recogniser: string, jobs: number, startedMs: number): StoredWorkGroup => ({
    session: `$9${session.length}00 none`,
    sessionName: session,
    recogniser,
    jobs,
    timing: { kind: "known", oldestStartedAt: new Date(startedMs).toISOString(), longestRanForMs: at - startedMs },
  });

  /* 7.4–8.0, NOT the 11.6–12.4 the first draft used: that window falls inside
     the four-hour gap above, where no sample is written at all, so the arm
     seeded nothing and the section drew as though the probe had never failed.
     Found by counting the arms in the seeded file rather than by reading this. */
  if (hoursAgo < 8.0 && hoursAgo > 7.4) {
    return {
      kind: "due",
      result: {
        kind: "probe-failed",
        attemptedAt: new Date(at).toISOString(),
        sourceCollectedAt: new Date(at - 4_000).toISOString(),
        why: "ps -eo pid=,ppid=,etimes=,args= failed: Command failed: spawn EAGAIN",
      },
    };
  }

  if (hoursAgo < 6.5 && hoursAgo > 6) {
    /* ONE reading, carried by every sample in this stretch. The scan clock is
       frozen; only the carriers move. */
    return scan(new Date(now - 6.5 * 3_600_000).toISOString(), [known("overnight-eval", "codex-exec", 1, now - 7 * 3_600_000)], { work: 1, none: 14, cannotTell: 0 });
  }

  if (hoursAgo < 16.5 && hoursAgo > 15.5) {
    return scan(new Date(at).toISOString(), [
      known("worktree-extraction", "vitest", 3, at - 18 * 60_000),
      known("worktree-hierarchy", "vitest", 2, at - 11 * 60_000),
      known("roadmap-usage", "codex-exec", 1, at - 34 * 60_000),
      known("dashboard-ideas", "claude-headless", 1, at - 4 * 60_000),
    ], { work: 4, none: 9, cannotTell: 2 });
  }

  if (hoursAgo < 3.4 && hoursAgo > 2.6) {
    return scan(new Date(at).toISOString(), [
      { session: "$9210 none", sessionName: "admission-visibility", recogniser: "codex-exec", jobs: 3, timing: { kind: "partial", knownJobs: 1, oldestStartedAt: new Date(at - 21 * 60_000).toISOString(), longestRanForMs: 21 * 60_000 } },
      /* The one seeded row with no name, so the fallback to the raw key is on
         screen rather than only in a comment. */
      { session: "$9211 claims:5f2c1f0e-2b7a-4a6d-9c31-8d0f4b6ea7c2", sessionName: null, recogniser: "vitest", jobs: 1, timing: { kind: "unknown" } },
    ], { work: 2, none: 12, cannotTell: 1 });
  }

  const quiet = Math.sin(at / 7_000_000) > 0.3;
  return quiet
    ? scan(new Date(at).toISOString(), [known("resource-history", "codex-exec", 1, at - 26 * 60_000)], { work: 1, none: 15, cannotTell: 0 })
    : scan(new Date(at).toISOString(), [], { work: 0, none: 16, cannotTell: 0 });
}

const now = Date.now();
/* Twenty hours, not twenty-four, so the left of the window is genuinely
   "before the history began" and that region can be seen. */
const start = now - 20 * 3_600_000;
let written = 0;
let skipped = 0;

for (let at = start; at <= now; at += CADENCE_MS) {
  const hoursAgo = (now - at) / 3_600_000;

  /* A four-hour gap: no sample is written at all. The record cannot say whether
     the box was down, collection was down, or work was running. */
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

  opened.store.append(turn, { at: date.toISOString(), nextDueMs: CADENCE_MS }, workTurn(at, hoursAgo));
  written += 1;
}

console.log(`seeded ${written} samples into ${opened.dir} (${skipped} deliberately missing, for the outage)`);
