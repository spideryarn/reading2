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
  GAP_SLACK_CAP_MS,
  coverageMs,
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

  it("A SCHEDULE IS NOT AN OBSERVATION: a fleet backoff is drawn as a break", () => {
    /* THIS TEST HAS BEEN INVERTED, and the inversion is the finding. It used to
       assert that a 313s backoff produced NO break — the loop really was
       waiting, so drawing one felt like an alarm that is usually wrong. But
       `nextDueMs` is what the writer INTENDED, and after a fleet-collection
       failure it is five times the cadence even though the health reading
       succeeded. Treating the whole of it as coverage meant that if the
       dashboard vanished for six minutes inside that window and came back, the
       line joined up and the page said there were no breaks.

       Nobody was watching for those five minutes. That is a break, and it is
       true. The error now runs in the safe direction. GPT Sol, second round. */
    const backedOff = reading(T0, {}, 313_000);
    const plot = plotHistory(view([backedOff, reading(T0 + 320_000)]), T0 + 400_000);
    expect(plot.gaps).toHaveLength(1);
    /* And the break begins where the coverage ends, not at the sample. */
    expect(plot.gaps[0]?.fromMs).toBe(T0 + coverageMs(backedOff, 60_000));
  });

  it("caps what a sample may claim, whatever it intended to wait", () => {
    const short = reading(T0, {}, 73_000);
    const backedOff = reading(T0, {}, 313_000);
    /* A normal turn claims its own interval plus slack… */
    expect(coverageMs(short, 60_000)).toBe(73_000 + 109_500);
    /* …and a backed-off one claims no more than twice the nominal cadence,
       rather than five times it. */
    expect(coverageMs(backedOff, 60_000)).toBeLessThan(313_000);
    expect(coverageMs(backedOff, 60_000)).toBe(120_000 + 120_000);
    /* `gapAfterMs` still describes the writer's own expectation, which is what
       a sample SAYS; coverage is what a chart may CLAIM from it. */
    expect(gapAfterMs(backedOff) - 313_000).toBe(GAP_SLACK_CAP_MS);
    expect(gapAfterMs(backedOff)).toBeLessThan(313_000 * GAP_SLACK);
  });

  it("marks a break that is still going at the right-hand edge", () => {
    /* The one no sample can record, because it is the sample that has not
       arrived. Without it the line stops partway and looks merely finished.
       The window's edge comes from the SERVER now, so the test states it —
       a browser clock is no longer allowed to decide what is missing. */
    const plot = plotHistory(view([reading(T0)], { toMs: T0 + 3 * 3_600_000 }), T0 + 3 * 3_600_000);
    expect(plot.gaps).toHaveLength(1);
    expect(plot.gaps[0]?.ongoing).toBe(true);
  });

  it("does NOT let a fast phone clock manufacture a break", () => {
    /* The route stamps the window with the server's clock deliberately; this
       used to throw that away with `Math.max(view.toMs, nowMs)`, so a phone an
       hour fast turned a current sample into a one-hour outage. GPT Sol's
       second-round finding 7. */
    const plot = plotHistory(view([reading(T0)]), T0 + 3_600_000);
    expect(plot.gaps).toHaveLength(0);
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
    /* The first break ends where the sample begins, and the second begins where
       that sample's COVERAGE ends — not at the sample itself. That difference is
       the overlap GPT Sol found twice: a break must not start inside the stretch
       a reading speaks for. */
    expect(plot.gaps[0]?.toMs).toBe(only.atMs);
    expect(plot.gaps[1]?.fromMs).toBe(only.atMs + coverageMs(only, 60_000));
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
    /* 2.9 h rather than 3.0: the first sample speaks for three minutes after
       itself, and the silence starts where that stops. Overstating a break by
       the coverage of the reading before it was the overlap bug. */
    expect(sentence).toMatch(/2\.9 h/);
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

  it("plots memory as USED, so the fixture's least available minute is its peak", () => {
    /* The series was "Memory available" until 2026-09-09 and ran the other way
       from the other three; Greg asked for one direction, and it is used. The
       reading behind it is still `availableFraction` — this pins the complement
       being taken, and taken once. */
    const samples = [reading(T0, { memory: 0.4 }), reading(T0 + CADENCE, { memory: 0.03 })];
    const plot = plotHistory(view(samples), T0 + 2 * CADENCE);
    const memory = seriesOf(plot, "memory");
    expect(memory.worst?.value).toBeCloseTo(97, 5);
    /* The cutoffs are the collector's, said the other way round — not new
       numbers. `availableFraction < 0.15` is `used > 85`. */
    expect(memory.spec.bands.strained).toBe(85);
    expect(memory.spec.bands.critical).toBe(95);
  });

  it("never takes the complement of a reading that was never taken", () => {
    /* `100 - unknown` is not 100. A memory series that flipped direction by
       subtracting from a missing number would draw a full bar over a failed
       reading — the confident zero, upside down. */
    const base = reading(T0, {});
    if (base.kind !== "reading") throw new Error("the fixture is a reading");
    const samples = [{ ...base, report: { ...base.report, memory: { kind: "unknown", why: "free failed" } } }];
    const plot = plotHistory(view(samples), T0 + 2 * CADENCE);
    const memory = seriesOf(plot, "memory");
    expect(memory.segments).toEqual([]);
    expect(memory.unknowns).toHaveLength(1);
  });
});

/* ================================================================== *
 * What the code review of the BUILT code found, 2026-09-08. Every one of
 * these produced a confident, plausible, wrong picture.
 * ================================================================== */

describe("how far one sample speaks for", () => {
  it("does not paint a break violet because the sample before it was unreadable", () => {
    /* THE WORST RENDERING BUG IN THE FILE. Spans ran to the NEXT sample, so an
       unknown or collector-failed reading followed by four hours of silence
       coloured those four hours violet — over the hatch — and gave the silence a
       cause the record cannot support. GPT Sol's finding 3. */
    const samples = [failed(T0), reading(T0 + 4 * 3_600_000)];
    const plot = plotHistory(view(samples), T0 + 4 * 3_600_000 + CADENCE);
    const load = seriesOf(plot, "load");
    expect(load.unknowns).toHaveLength(1);
    /* It covers what it said to expect, and not one minute more. */
    expect(load.unknowns[0]?.toMs).toBe(T0 + gapAfterMs(failed(T0)));
    expect(plot.gaps).toHaveLength(1);
  });

  it("does not stretch a critical verdict across the silence after it", () => {
    const samples = [reading(T0, { level: "critical" }), reading(T0 + 4 * 3_600_000)];
    const plot = plotHistory(view(samples), T0 + 4 * 3_600_000 + CADENCE);
    const critical = plot.verdict.find((band) => band.level === "critical");
    expect(critical?.toMs).toBe(T0 + coverageMs(reading(T0), 60_000));
  });

  it("counts verdict time only while the normalized coverage says the box was observed", () => {
    /* A fleet backoff may schedule the next sample much later than the health
       cadence. The canonical timeline caps how long that schedule counts as an
       observation; verdict totals must not count the hatched remainder. */
    const backedOff = { ...reading(T0, { level: "strained" }), nextDueMs: 313_000 };
    const plot = plotHistory(
      view([backedOff], { earliestAtMs: T0, refreshMs: 60_000, toMs: T0 + 10 * 60_000 }),
      T0 + 10 * 60_000,
    );
    expect(plot.verdict).toEqual([
      { fromMs: T0, toMs: T0 + coverageMs(backedOff, 60_000), level: "strained", tone: "needs" },
    ]);
    expect(plot.gaps[0]?.fromMs).toBe(T0 + coverageMs(backedOff, 60_000));
  });

  it("includes predecessor coverage at the left edge and removes corrupt holes", () => {
    const predecessor = reading(T0 - 60_000, { level: "critical" });
    const next = reading(T0 + CADENCE, { level: "ok" });
    const plot = plotHistory(
      view([next], {
        predecessor,
        earliestAtMs: predecessor.atMs,
        holes: [{ afterAtMs: T0 + 10_000, beforeAtMs: T0 + 20_000 }],
      }),
      T0 + 2 * CADENCE,
    );
    expect(plot.verdict).toContainEqual({
      fromMs: T0,
      toMs: T0 + 10_000,
      level: "critical",
      tone: "alarm",
    });
    expect(plot.verdict).toContainEqual({
      fromMs: T0 + 20_000,
      toMs: next.atMs,
      level: "critical",
      tone: "alarm",
    });
    for (const band of plot.verdict) {
      expect(band.fromMs).toBeGreaterThanOrEqual(T0);
      expect(band.toMs).toBeLessThanOrEqual(T0 + 2 * CADENCE);
      expect(band.toMs <= T0 + 10_000 || band.fromMs >= T0 + 20_000).toBe(true);
    }
  });

  it("says `now` only when the newest value actually reaches the right-hand edge", () => {
    /* `latest` is the newest VALUE anywhere; if the readings after it were
       unknown, or the writer is overdue, it can be hours old, and a sentence
       calling it "now" is a live number that is not live. */
    const current = plotHistory(view([reading(T0, { load: 1.2 })]), T0 + CADENCE);
    expect(seriesOf(current, "load").latestIsCurrent).toBe(true);

    const stale = plotHistory(
      view([reading(T0, { load: 1.2 }), reading(T0 + CADENCE, { blindLoad: "nproc failed" })]),
      T0 + 2 * CADENCE,
    );
    expect(seriesOf(stale, "load").latest?.value).toBe(1.2);
    expect(seriesOf(stale, "load").latestIsCurrent).toBe(false);

    const overdue = plotHistory(view([reading(T0, { load: 1.2 })], { toMs: T0 + 3 * 3_600_000 }), T0 + 3 * 3_600_000);
    expect(seriesOf(overdue, "load").latestIsCurrent).toBe(false);
  });
});

describe("the layers are mutually exclusive", () => {
  /* **THE INVARIANT, ASSERTED DIRECTLY.** Both earlier attempts at this passed
     tests that checked a clamp and a gap count, and both still overlapped: a
     gap `[t0, t0+4h]` sat under an unknown span `[t0, t0+182.5s]`, so the hatch
     hid a known collector failure and the prose overstated the silence. A count
     cannot see an overlap; only the overlap can. */
  const overlaps = (a: { fromMs: number; toMs: number }, b: { fromMs: number; toMs: number }): boolean =>
    a.fromMs < b.toMs && b.fromMs < a.toMs;

  it("no gap overlaps any reading's span, in the four-hour failure case", () => {
    const plot = plotHistory(
      view([failed(T0), reading(T0 + 4 * 3_600_000)]),
      T0 + 4 * 3_600_000 + CADENCE,
    );
    expect(plot.gaps.length).toBeGreaterThan(0);
    for (const series of plot.series) {
      for (const span of [...series.unknowns, ...series.absences, ...series.marks, ...series.overCeiling]) {
        for (const gap of plot.gaps) {
          expect(overlaps(gap, span)).toBe(false);
        }
      }
    }
  });

  it("no gap overlaps a verdict band, or the before-the-record region", () => {
    const plot = plotHistory(
      view([reading(T0, { level: "critical" }), reading(T0 + 4 * 3_600_000)], { earliestAtMs: T0 }),
      T0 + 4 * 3_600_000 + CADENCE,
    );
    for (const gap of plot.gaps) {
      for (const band of plot.verdict) expect(overlaps(gap, band)).toBe(false);
      if (plot.beforeHistory !== null) expect(overlaps(gap, plot.beforeHistory)).toBe(false);
    }
  });

  it("no two gaps overlap each other", () => {
    const plot = plotHistory(
      view([reading(T0), reading(T0 + 4 * 3_600_000)], {
        holes: [{ afterAtMs: T0, beforeAtMs: T0 + 4 * 3_600_000 }],
        toMs: T0 + 9 * 3_600_000,
      }),
      T0 + 9 * 3_600_000,
    );
    for (let i = 0; i < plot.gaps.length; i++) {
      for (let j = i + 1; j < plot.gaps.length; j++) {
        const a = plot.gaps[i];
        const b = plot.gaps[j];
        if (a !== undefined && b !== undefined) expect(overlaps(a, b)).toBe(false);
      }
    }
  });

  it("does not say `now` when a rejected sample trails the newest value", () => {
    /* A value at t0 followed by a sample this page could not read left the card
       saying "now 1.0x cores" on a page that was simultaneously admitting the
       record after it was unreadable. Currentness has to come from the same
       spans as everything else. GPT Sol's second-round finding 2. */
    const plot = plotHistory(
      view([reading(T0, { load: 1.2 })], {
        holes: [{ afterAtMs: T0, beforeAtMs: null }],
        toMs: T0 + 60_000,
      }),
      T0 + 60_000,
    );
    expect(seriesOf(plot, "load").latest?.value).toBe(1.2);
    expect(seriesOf(plot, "load").latestIsCurrent).toBe(false);
  });
});

describe("a window with no samples in it", () => {
  it("is an ONGOING break when the record predates the window", () => {
    /* The worst state the record can hold — a dashboard silent for over a day —
       used to produce zero gaps, which the panel then printed as "empty after a
       restart": the most reassuring sentence on the page. GPT Sol's finding 4. */
    const plot = plotHistory(
      view([], { predecessor: reading(T0 - 3_600_000), earliestAtMs: T0 - 3_600_000, toMs: T0 + 6 * 3_600_000 }),
      T0 + 6 * 3_600_000,
    );
    expect(plot.gaps).toHaveLength(1);
    expect(plot.gaps[0]?.ongoing).toBe(true);
    expect(describeGaps(plot, () => "")).toMatch(/still going/);
  });

  it("is genuinely empty when there is no predecessor either", () => {
    const plot = plotHistory(view([]), T0 + 3_600_000);
    expect(plot.gaps).toHaveLength(0);
    expect(plot.sampleCount).toBe(0);
  });
});

describe("collapseVerdict interval arithmetic", () => {
  const band = (fromMs: number, toMs: number, level = "critical") =>
    ({ fromMs, toMs, level, tone: "alarm" }) as const;

  it("ignores a band that ends exactly at the window start", () => {
    /* It used to paint column 0 — flooring both ends and including both. */
    expect(collapseVerdict([band(T0 - 1000, T0)], T0, T0 + 3600_000, 360)).toEqual([]);
  });

  it("ignores a zero-width band rather than giving it a whole column", () => {
    expect(collapseVerdict([band(T0 + 1000, T0 + 1000)], T0, T0 + 3600_000, 360)).toEqual([]);
  });

  it("does not let a band ending on a column boundary contaminate the next column", () => {
    /* One column of a 360-column 24h strip is four minutes, so this was four
       minutes of severity in the wrong place. */
    const span = 3_600_000;
    const oneColumn = span / 360;
    const out = collapseVerdict([band(T0, T0 + oneColumn)], T0, T0 + span, 360);
    expect(out).toHaveLength(1);
    expect(out[0]?.toMs).toBeLessThanOrEqual(T0 + oneColumn + 1);
  });

  it("clips a band that starts before the window", () => {
    const out = collapseVerdict([band(T0 - 3_600_000, T0 + 60_000)], T0, T0 + 3_600_000, 360);
    expect(out[0]?.fromMs).toBeGreaterThanOrEqual(T0);
  });
});

describe("fields that crossed the wire and were read by nothing", () => {
  /* Found by running 260908b's own Class B check over this feature before
     pushing it: for each field the route puts on the wire,
     `grep -rn '\\bfield\\b' tools/fleet/web/src/`. Two came back with one hit —
     the parse site — and a field parsed and never rendered is the producer
     saying the careful thing and the consumer dropping it. */
  it("carries the SERVER's window through to the plot, not this page's constant", () => {
    /* The route clamps, so asking for 10,000 hours returns 168 — and an axis
       still labelled "24 hours" would describe something not on screen. */
    const plot = plotHistory(view([reading(T0)], { windowHours: 168 }), T0 + CADENCE);
    expect(plot.windowHours).toBe(168);
  });
});

describe("IO wait has no red of its own", () => {
  it("stops at amber, because critical needs a second fact a band cannot express", () => {
    /* Both cutoffs were 50, so 50%+ IO painted the chart red while the collector
       calls high IO WITHOUT active swapping merely strained — a red chart under
       an amber badge, on a page whose argument is that the two agree. GPT Sol's
       finding 9. */
    const io = SERIES.find((spec) => spec.key === "io");
    expect(io?.bands.strained).toBe(50);
    expect(io?.bands.critical).toBe(Number.POSITIVE_INFINITY);
  });
});
