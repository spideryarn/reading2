/**
 * Turning a day of samples into something drawable —
 * tools/fleet/web/src/history-series.ts.
 *
 * **ALMOST EVERY TEST HERE IS ABOUT A KIND OF NOTHING.** Reading four numbers
 * out of a sample is six lines and needs one test; keeping the four kinds of
 * absence apart is the feature, and a chart that merges any two of them answers
 * *was there a problem while I was not looking* with a confident, wrong "no".
 *
 * The assertion that matters most is **segment topology**: how many separate
 * runs the line is broken into, and where they stop. A test that only checked
 * "an unknown reading and a zero produce different markup" would pass on a
 * chart that filtered out the unknown and drew one calm line straight across
 * the crisis — GPT Sol's finding 2, 2026-09-08.
 */
import { describe, expect, it } from "vitest";

import type { HealthSampleView, HistoryView } from "../tools/fleet/web/src/health-history-client";
import {
  GAP_SLACK,
  SERIES,
  collapseVerdict,
  describeDuration,
  describeGaps,
  gapAfterMs,
  plotHistory,
} from "../tools/fleet/web/src/history-series";

const CADENCE = 73_000;
const T0 = Date.parse("2026-09-08T00:00:00.000Z");

type Shape = {
  load?: number;
  memory?: number;
  swap?: number | "none";
  wa?: number | "skipped";
  swapping?: boolean;
  level?: string;
  blindLoad?: string;
};

function reading(atMs: number, shape: Shape = {}, nextDueMs = CADENCE): HealthSampleView {
  return {
    kind: "reading",
    atMs,
    nextDueMs,
    report: {
      load:
        shape.blindLoad === undefined
          ? { kind: "value", load1: (shape.load ?? 1) * 16, cores: 16, ratio1: shape.load ?? 1 }
          : { kind: "unknown", why: shape.blindLoad },
      memory: { kind: "value", availableFraction: shape.memory ?? 0.4 },
      swap: shape.swap === "none" ? { kind: "none" } : { kind: "value", usedFraction: shape.swap ?? 0.4 },
      swapActivity:
        shape.wa === "skipped"
          ? { kind: "skipped" }
          : { kind: "value", waPercent: shape.wa ?? 1, activelySwapping: shape.swapping ?? false },
      verdict: { level: shape.level ?? "ok", reasons: [] },
    },
  };
}

function failed(atMs: number, why = "collectHealth threw: out of memory", nextDueMs = CADENCE): HealthSampleView {
  return { kind: "collector-failed", atMs, nextDueMs, why };
}

/**
 * A payload whose window ENDS just after the last sample.
 *
 * The first draft ended every window 24h after `T0` regardless, so every
 * fixture also had a many-hour break running to the right-hand edge — which is
 * correct behaviour and made half of these tests assert on the wrong gap. A
 * test that wants that break asks for it by passing `toMs`.
 */
function view(samples: HealthSampleView[], over: Partial<Extract<HistoryView, { kind: "history" }>> = {}) {
  const last = samples[samples.length - 1];
  const base: Extract<HistoryView, { kind: "history" }> = {
    kind: "history",
    windowHours: 24,
    fromMs: T0,
    toMs: (last?.atMs ?? T0) + CADENCE,
    samples,
    predecessor: null,
    holes: [],
    earliestAtMs: samples[0]?.atMs ?? null,
    rotated: false,
    retention: null,
    unreadableLines: 0,
    refreshMs: 60_000,
    unreadableSamples: 0,
  };
  return { ...base, ...over };
}

function seriesOf(plot: ReturnType<typeof plotHistory>, key: string) {
  const found = plot.series.find((s) => s.spec.key === key);
  if (found === undefined) throw new Error(`no ${key} series`);
  return found;
}

/* ================================================================== *
 * The line must break. This is the whole feature.
 * ================================================================== */

describe("segment topology", () => {
  it("draws one unbroken line when every sample is a value", () => {
    const samples = [0, 1, 2, 3].map((i) => reading(T0 + i * CADENCE));
    const plot = plotHistory(view(samples), T0 + 4 * CADENCE);
    expect(seriesOf(plot, "load").segments).toHaveLength(1);
    expect(seriesOf(plot, "load").segments[0]).toHaveLength(4);
  });

  it("BREAKS THE LINE at a reading that could not be taken, rather than filtering it out", () => {
    /* THE FINDING THIS FILE EXISTS FOR. Memory 20%, then `free` fails during
       the crisis, then memory 25%: a chart that merely skipped the middle
       sample would draw a calm line straight across the unreadable one, and the
       violet mark beside it would not make that line honest. */
    const samples = [
      reading(T0, { load: 1.2 }),
      reading(T0 + CADENCE, {}, CADENCE),
      reading(T0 + 2 * CADENCE, { load: 1.5 }),
    ];
    samples[1] = reading(T0 + CADENCE, { blindLoad: "free failed: Command failed" });

    const plot = plotHistory(view(samples), T0 + 3 * CADENCE);
    const load = seriesOf(plot, "load");
    expect(load.segments).toHaveLength(2);
    expect(load.segments[0]).toHaveLength(1);
    expect(load.segments[1]).toHaveLength(1);
    expect(load.unknowns).toHaveLength(1);
    expect(load.unknowns[0]?.why).toBe("free failed: Command failed");
  });

  it("breaks EVERY series when the collector itself threw", () => {
    const samples = [reading(T0), failed(T0 + CADENCE), reading(T0 + 2 * CADENCE)];
    const plot = plotHistory(view(samples), T0 + 3 * CADENCE);
    for (const spec of SERIES) {
      const series = seriesOf(plot, spec.key);
      expect(series.segments.length).toBeGreaterThanOrEqual(2);
      expect(series.unknowns[0]?.why).toContain("out of memory");
    }
  });

  it("breaks the line at a gap, so nothing is drawn across an outage", () => {
    const samples = [reading(T0), reading(T0 + 4 * 3_600_000), reading(T0 + 4 * 3_600_000 + CADENCE)];
    /* `now` is right after the last sample: an hour later would legitimately add
       a SECOND break running to the right-hand edge, which is a different test. */
    const plot = plotHistory(view(samples), T0 + 4 * 3_600_000 + 2 * CADENCE);
    expect(plot.gaps).toHaveLength(1);
    expect(seriesOf(plot, "load").segments).toHaveLength(2);
  });

  it("breaks the line where the store found a corrupt record", () => {
    /* A count in a footnote is not enough: the renderer would join across the
       place the record is broken, which is the same reconnection a gap must
       never get. */
    const samples = [reading(T0), reading(T0 + CADENCE)];
    const plot = plotHistory(
      view(samples, { holes: [{ afterAtMs: T0, beforeAtMs: T0 + CADENCE }] }),
      T0 + 2 * CADENCE,
    );
    expect(seriesOf(plot, "load").segments).toHaveLength(2);
    expect(plot.gaps).toHaveLength(1);
  });

  it("never puts an unreadable reading at zero", () => {
    /* The specific collapse health.ts exists to prevent, arriving through the
       chart instead of through the collector. */
    const plot = plotHistory(view([reading(T0, { blindLoad: "nproc failed" })]), T0 + CADENCE);
    const load = seriesOf(plot, "load");
    expect(load.segments.flat()).toHaveLength(0);
    expect(load.peak).toBeNull();
    expect(load.worst).toBeNull();
  });

  it("tells an absent reading from an unreadable one", () => {
    /* "No swap is configured on this box" is not a fault, and "swapon failed"
       is. Both are "no point on the line", and they must not be one arm. */
    const plot = plotHistory(view([reading(T0, { swap: "none", wa: "skipped" })]), T0 + CADENCE);
    expect(seriesOf(plot, "swap").absences).toHaveLength(1);
    expect(seriesOf(plot, "swap").unknowns).toHaveLength(0);
    expect(seriesOf(plot, "io").absences[0]?.why).toMatch(/not sampled/);
  });

  it("calls an arm it has never heard of unknown, naming it, rather than rounding it", () => {
    const strange: HealthSampleView = {
      kind: "reading",
      atMs: T0,
      nextDueMs: CADENCE,
      report: { load: { kind: "somebody-added-an-arm" } },
    };
    const plot = plotHistory(view([strange]), T0 + CADENCE);
    expect(seriesOf(plot, "load").unknowns[0]?.why).toContain("somebody-added-an-arm");
  });
});

/* ================================================================== *
 * Which spacings are breaks.
 * ================================================================== */

describe("what counts as a break", () => {
  it("does not call one missed collection a break", () => {
    /* Measured on this box: one interval in six was double the others, with no
       error and no gap in the data. An alarm that is usually wrong is the same
       picture as a quiet page over a dead box. */
    const samples = [reading(T0), reading(T0 + 2 * CADENCE)];
    const plot = plotHistory(view(samples), T0 + 3 * CADENCE);
    expect(plot.gaps).toHaveLength(0);
  });

  it("takes the expectation from the SAMPLE, so a legitimate backoff is not a break", () => {
    /* The loop waits 5x after a failed collection. Comparing against one
       assumed cadence would draw every backed-off turn as a five-minute
       outage. */
    const backedOff = reading(T0, {}, 313_000);
    const samples = [backedOff, reading(T0 + 320_000)];
    const plot = plotHistory(view(samples), T0 + 400_000);
    expect(plot.gaps).toHaveLength(0);
    expect(gapAfterMs(backedOff)).toBeGreaterThan(313_000 * (GAP_SLACK - 0.01));
  });

  it("marks a break that is still going at the right-hand edge", () => {
    /* The one no sample can record, because it is the sample that has not
       arrived. Without it the line stops partway and looks merely finished. */
    const plot = plotHistory(view([reading(T0)]), T0 + 3 * 3_600_000);
    expect(plot.gaps).toHaveLength(1);
    expect(plot.gaps[0]?.ongoing).toBe(true);
  });

  it("does not count one silence twice when a corrupt line sits inside a real break", () => {
    /* TWO MECHANISMS CAN DESCRIBE THE SAME SILENCE. A four-hour spacing between
       two samples is a break; a corrupt line between those same two samples is
       also a break, bracketed by the same pair. Pushed separately they are two
       entries over one stretch of time, and the sentence then reports "2 breaks
       totalling 8.0 h" about four hours — a number Greg would act on, arrived at
       by adding a thing to itself. */
    const samples = [reading(T0), reading(T0 + 4 * 3_600_000)];
    const plot = plotHistory(
      view(samples, { holes: [{ afterAtMs: T0, beforeAtMs: T0 + 4 * 3_600_000 }] }),
      T0 + 4 * 3_600_000 + CADENCE,
    );
    expect(plot.gaps).toHaveLength(1);
    expect(describeGaps(plot, () => "04:00")).toMatch(/1 break totalling 4\.0 h/);
  });

  it("does not count the break at the right-hand edge twice when a corrupt line trails it", () => {
    const samples = [reading(T0), reading(T0 + CADENCE)];
    const plot = plotHistory(
      view(samples, { holes: [{ afterAtMs: T0 + CADENCE, beforeAtMs: null }] }),
      T0 + 3 * 3_600_000,
    );
    expect(plot.gaps).toHaveLength(1);
    expect(plot.gaps[0]?.ongoing).toBe(true);
  });

  it("keeps two breaks apart when a single sample sits between them", () => {
    /* They share an endpoint and must not merge: a reading arrived at that
       instant and the record says so. One long silence over a moment the box
       was heard from is the same lie as an interpolated line, in the sentence
       instead of the picture. */
    const only = reading(T0 + 4 * 3_600_000);
    const plot = plotHistory(
      view([only], { predecessor: reading(T0 - 3_600_000), earliestAtMs: T0 - 3_600_000, toMs: T0 + 8 * 3_600_000 }),
      T0 + 8 * 3_600_000,
    );
    expect(plot.gaps).toHaveLength(2);
    expect(plot.gaps[0]?.toMs).toBe(only.atMs);
    expect(plot.gaps[1]?.fromMs).toBe(only.atMs);
    expect(plot.gaps[1]?.ongoing).toBe(true);
  });

  it("keeps two genuinely separate breaks separate", () => {
    const samples = [
      reading(T0),
      reading(T0 + 3 * 3_600_000),
      reading(T0 + 3 * 3_600_000 + CADENCE),
      reading(T0 + 8 * 3_600_000),
    ];
    const plot = plotHistory(view(samples), T0 + 8 * 3_600_000 + CADENCE);
    expect(plot.gaps).toHaveLength(2);
  });

  it("uses the sample BEFORE the window to classify the left edge", () => {
    /* Without the predecessor there is nothing to compare the first in-window
       sample against, and four hours of silence at the left looks like where
       the record begins. */
    const first = reading(T0 + 4 * 3_600_000);
    const plot = plotHistory(
      view([first], { predecessor: reading(T0 - 3_600_000), earliestAtMs: T0 - 3_600_000 }),
      T0 + 5 * 3_600_000,
    );
    expect(plot.gaps.some((gap) => gap.fromMs <= T0 && gap.toMs === first.atMs)).toBe(true);
    /* And it is a BREAK, not "nothing was recorded before this": the store had
       samples older than the window. */
    expect(plot.beforeHistory).toBeNull();
  });
});

/* ================================================================== *
 * The two silences that must not be one.
 * ================================================================== */

describe("before the record begins", () => {
  it("is its own region, not a gap", () => {
    const plot = plotHistory(
      view([reading(T0 + 20 * 3_600_000)], { earliestAtMs: T0 + 20 * 3_600_000 }),
      T0 + 24 * 3_600_000,
    );
    expect(plot.beforeHistory).not.toBeNull();
    expect(plot.beforeHistory?.fromMs).toBe(T0);
    /* Twenty hours of nothing at the left, and NOT one of `gaps`: nothing was
       lost there, there was never anything to lose. */
    expect(plot.gaps.some((gap) => gap.fromMs === T0)).toBe(false);
  });

  it("is null when the store reaches back past the window", () => {
    const plot = plotHistory(view([reading(T0 + 60_000)], { earliestAtMs: T0 - 3_600_000 }), T0 + 120_000);
    expect(plot.beforeHistory).toBeNull();
  });

  it("carries whether a rotation means the oldest sample is not the first ever", () => {
    const plot = plotHistory(view([reading(T0 + 3_600_000)], { rotated: true }), T0 + 2 * 3_600_000);
    expect(plot.retainedOnly).toBe(true);
  });
});

/* ================================================================== *
 * Many samples, few pixels.
 * ================================================================== */

describe("collapsing to pixels", () => {
  it("takes the WORST level in a shared column, never the commonest", () => {
    /* A 24h window holds ~1,200 samples and a phone gives the strip ~360
       columns. The one-minute `critical` at 4am is what the page was opened to
       find, and every averaging rule ever written erases it. */
    const bands = [
      { fromMs: T0, toMs: T0 + 1000, level: "ok", tone: "work" as const },
      { fromMs: T0 + 1000, toMs: T0 + 2000, level: "critical", tone: "alarm" as const },
      { fromMs: T0 + 2000, toMs: T0 + 3000, level: "ok", tone: "work" as const },
    ];
    const collapsed = collapseVerdict(bands, T0, T0 + 3000, 1);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.level).toBe("critical");
  });

  it("ranks unknown above ok, so a could-not-tell is not hidden by a calm neighbour", () => {
    const bands = [
      { fromMs: T0, toMs: T0 + 1000, level: "ok", tone: "work" as const },
      { fromMs: T0 + 1000, toMs: T0 + 2000, level: "unknown", tone: "unknown" as const },
    ];
    expect(collapseVerdict(bands, T0, T0 + 2000, 1)[0]?.level).toBe("unknown");
  });

  it("merges neighbouring columns that agree, so the DOM stays small", () => {
    const bands = Array.from({ length: 100 }, (_, i) => ({
      fromMs: T0 + i * 1000,
      toMs: T0 + (i + 1) * 1000,
      level: "ok",
      tone: "work" as const,
    }));
    expect(collapseVerdict(bands, T0, T0 + 100_000, 360)).toHaveLength(1);
  });
});

/* ================================================================== *
 * The sentence, which is what actually answers the question.
 * ================================================================== */

describe("describeGaps", () => {
  it("says there were none, without claiming anything about the box", () => {
    const plot = plotHistory(view([reading(T0), reading(T0 + CADENCE)]), T0 + 2 * CADENCE);
    expect(describeGaps(plot, () => "04:12")).toMatch(/no breaks/i);
  });

  it("counts them, totals them, and names the longest", () => {
    const samples = [reading(T0), reading(T0 + 3 * 3_600_000), reading(T0 + 3 * 3_600_000 + CADENCE)];
    const plot = plotHistory(view(samples), T0 + 3 * 3_600_000 + 2 * CADENCE);
    const sentence = describeGaps(plot, () => "03:00");
    expect(sentence).toMatch(/1 break/);
    expect(sentence).toMatch(/3\.0 h/);
    expect(sentence).toMatch(/03:00/);
  });

  it("NEVER SAYS NOTHING WAS RUNNING, because the record does not say why it is silent", () => {
    /* A break is the box down, the dashboard down, a collection that hung, a
       failed append, or — most often on this box — somebody restarting the
       server. Naming a cause we cannot see would invert the whole point of the
       feature. GPT Sol's finding 1. */
    const plot = plotHistory(view([reading(T0), reading(T0 + 3 * 3_600_000)]), T0 + 4 * 3_600_000);
    const sentence = describeGaps(plot, () => "03:00");
    expect(sentence).not.toMatch(/nothing was running/i);
    expect(sentence).not.toMatch(/the box was down/i);
    expect(sentence).toMatch(/no sample was written/i);
  });

  it("says an empty window is empty rather than calling it a quiet box", () => {
    const plot = plotHistory(view([]), T0 + 3_600_000);
    expect(describeGaps(plot, () => "")).toMatch(/nothing has been recorded/i);
  });
});

describe("describeDuration", () => {
  it("reads as a person would say it", () => {
    expect(describeDuration(30_000)).toBe("under a minute");
    expect(describeDuration(22 * 60_000)).toBe("22 min");
    expect(describeDuration(4 * 3_600_000)).toBe("4.0 h");
  });
});

/* ================================================================== *
 * The boolean fact beside the number.
 * ================================================================== */

describe("actively swapping", () => {
  it("is drawn as its own thing, not folded into IO wait", () => {
    /* "Swap is a cliff, not a slope" — health.ts. Pages moving right now is a
       different fact from any percentage, and 100% full and quiet is not the
       same as 60% and thrashing. A chart with the number and not the event
       would have lost exactly that. */
    const swapping: HealthSampleView = {
      kind: "reading",
      atMs: T0,
      nextDueMs: CADENCE,
      report: {
        swapActivity: { kind: "value", waPercent: 0, activelySwapping: true },
      },
    };
    const quiet = reading(T0 + CADENCE, { wa: 0 });
    const plot = plotHistory(view([swapping, quiet]), T0 + 2 * CADENCE);
    const io = seriesOf(plot, "io");
    expect(io.marks).toHaveLength(1);
    expect(io.markedMs).toBe(CADENCE);
    /* And the IO wait line is still 0% at that moment — the mark did not become
       the number, which is the tile bug the live panel already had to fix. */
    expect(io.segments.flat()[0]?.value).toBe(0);
  });

  it("does not claim swapping when the reading could not be taken", () => {
    /* Absent, unknown, a collector failure, a renamed field: all mean "we do not
       know that it was swapping", which is not the same as knowing it was not,
       and is the only thing safe to draw. */
    const plot = plotHistory(
      view([failed(T0), reading(T0 + CADENCE, { wa: "skipped" })]),
      T0 + 2 * CADENCE,
    );
    expect(seriesOf(plot, "io").marks).toHaveLength(0);
    expect(seriesOf(plot, "io").markedMs).toBe(0);
  });

  it("merges a run of swapping samples into one bar", () => {
    const samples = [0, 1, 2, 3].map((i) => reading(T0 + i * CADENCE, { wa: 40, swapping: true }));
    const plot = plotHistory(view(samples), T0 + 4 * CADENCE);
    expect(seriesOf(plot, "io").marks).toHaveLength(1);
  });

  it("no other series carries a mark", () => {
    const plot = plotHistory(view([reading(T0, { wa: 40, swapping: true })]), T0 + CADENCE);
    for (const key of ["load", "memory", "swap"]) {
      expect(seriesOf(plot, key).marks).toEqual([]);
      expect(seriesOf(plot, key).markedMs).toBe(0);
    }
  });
});

/* ================================================================== *
 * The axis.
 * ================================================================== */

describe("the fixed axis", () => {
  it("marks where the line ran off the top rather than pressing it flat", () => {
    /* One outlier used to decide the scale: on a day containing load 391 on 16
       cores the ceiling went to 430, every ordinary hour sat at 4% of the
       height, and the red band covered the whole chart. Found by looking at the
       real page; every test was green. */
    const samples = [reading(T0, { load: 1.2 }), reading(T0 + CADENCE, { load: 24 })];
    const plot = plotHistory(view(samples), T0 + 2 * CADENCE);
    const load = seriesOf(plot, "load");
    expect(load.spec.max).toBe(8);
    expect(load.overCeiling).toHaveLength(1);
    /* The real number is not lost — it is the sentence beside the chart. */
    expect(load.worst?.value).toBe(24);
  });

  it("reports the LOWEST memory as the worst, because that series runs the other way", () => {
    const samples = [reading(T0, { memory: 0.4 }), reading(T0 + CADENCE, { memory: 0.03 })];
    const plot = plotHistory(view(samples), T0 + 2 * CADENCE);
    expect(seriesOf(plot, "memory").worst?.value).toBeCloseTo(3, 5);
  });
});
