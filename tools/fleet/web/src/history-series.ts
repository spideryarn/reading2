/**
 * Turning a day of health samples into something drawable, without lying about
 * the parts where there is nothing to draw.
 *
 * **THIS FILE IS ALMOST ENTIRELY ABOUT ABSENCE.** Reading four numbers out of a
 * sample is six lines; the rest is the machinery that keeps four different
 * kinds of nothing apart, because a chart that merges any two of them answers
 * *was there a problem while I was not looking* with a confident, wrong "no".
 *
 *  - **A gap** — no sample was recorded. The line BREAKS. It is never
 *    interpolated across, and the plan doc calls an interpolated line through an
 *    outage the single most expensive thing this feature could do.
 *
 *    **IT DOES NOT MEAN "NOTHING WAS RUNNING", AND MUST NEVER SAY SO.** That
 *    was the plan's wording and it claimed more than the evidence supports: a
 *    gap is also a collection that hung (the exact fault `attemptedAt` in
 *    state.ts was added to catch), a drain that blocked the loop, event-loop
 *    starvation, a failed append, or a dashboard restart — which happens
 *    several times an hour on this box while the wave is building. The record
 *    is silent; **why** it is silent is not in it. GPT Sol's finding 1.
 *  - **An unknown reading** — the collector ran and that one command failed,
 *    carrying its own `why`. Violet, and **never a zero**: `health.ts` exists
 *    to stop a failed reading rendering as a calm number, and a chart that put
 *    it at y=0 would undo the module it draws.
 *  - **An absent reading** — legitimately no number: no swap is configured,
 *    or swap activity was not sampled. Grey. Not a failure, and not a zero
 *    either.
 *  - **Before the history begins** — nothing was recorded, because we had not
 *    started (or, after a rotation, because it is no longer kept). Its own
 *    region, labelled, so a twenty-minute-old process does not present twenty
 *    minutes of line under an axis that says twenty-four hours.
 *
 * Pure — no React, no fetch, no `Date.now()` — so tests/fleet-web.test.tsx can
 * pin every one of those distinctions without a browser.
 */
import type { HealthSampleView, HistoryView } from "./health-history-client";
import { THRESHOLDS } from "./health-view";
import type { Tone } from "./view";

/* ------------------------------------------------------------------ *
 * When a spacing becomes a gap.
 * ------------------------------------------------------------------ */

/**
 * How far past the expected interval a sample may be before the space is a gap.
 *
 * **The expectation comes from the sample, not from a constant here** — each one
 * records `nextDueMs`, the wait the writer was about to take, which is `refreshMs`
 * after a good collection and five times that after a failed one. Comparing
 * against one assumed cadence would draw every legitimate backoff as an outage.
 *
 * The slack on top is because a missed collection is ORDINARY: measured on this
 * box over six consecutive collections on 2026-09-08, **one interval in six was
 * double the others** — no error, no gap in the data, just a turn that took
 * longer. An alarm that is usually wrong is worse than no alarm, because it is
 * the same picture as a quiet page over a dead box.
 */
export const GAP_SLACK = 2.5;

/** …and never less than a minute of slack, so a fast `refreshMs` does not make every turn a gap. */
export const GAP_FLOOR_MS = 60_000;

export function gapAfterMs(sample: HealthSampleView): number {
  return Math.max(sample.nextDueMs * GAP_SLACK, sample.nextDueMs + GAP_FLOOR_MS);
}

/* ------------------------------------------------------------------ *
 * One reading, three ways.
 * ------------------------------------------------------------------ */

/**
 * What one series can say about one sample.
 *
 * `unknown` and `absent` are both "no point on the line" and are deliberately
 * NOT one arm: *the command failed* and *there is no swap configured on this
 * box* are different facts, and the second one is not a fault.
 */
export type Reading =
  | { kind: "value"; value: number }
  | { kind: "unknown"; why: string }
  | { kind: "absent"; why: string };

export type SeriesKey = "load" | "memory" | "swap" | "io";

export type SeriesSpec = {
  key: SeriesKey;
  label: string;
  /** What the number means, under the label. */
  unit: string;
  /**
   * Top of the y axis. **Fixed, never fitted to the data**, and this was a
   * finding from looking at the real page rather than at a test.
   *
   * The first version scaled load to the window's peak. On a day containing the
   * 2026-09-08 spike — load 391 on 16 cores — that put the ceiling at 430 and
   * every ordinary hour of the day at 4% of the height: a flat line along the
   * floor, with the amber band (2×) and the red band (4×) compressed into
   * sub-pixel slivers, so the *entire chart* was painted red and the day looked
   * uniformly catastrophic. A fitted axis lets one outlier decide what every
   * other hour looks like.
   *
   * So the axis is fixed, values above it are CLIPPED, and the clipping is
   * drawn as its own mark and stated in words — see `overCeiling`. The peak is
   * never lost; it just stops deciding the scale.
   */
  max: number;
  /** Where amber and red sit, and which side of them is bad. */
  bands: { strained: number; critical: number; worseIs: "higher" | "lower" };
  read(sample: HealthSampleView): Reading;
};

function record(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(source: Record<string, unknown>, key: string): number | null {
  const v = source[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Pull one reading out of a sample.
 *
 * **The `collector-failed` arm short-circuits every series**, because on that
 * turn no command ran at all — there is one `why` and it belongs to all of
 * them.
 *
 * A reading whose union arm this build has never heard of becomes `unknown`
 * naming the arm, rather than being rounded to a value or dropped. Same rule
 * `parseStatus` follows in types.ts: a client that silently rounded a new arm
 * to a familiar one would be the lie the collector exists to prevent.
 */
function readingFrom(
  sample: HealthSampleView,
  field: string,
  fromValue: (value: Record<string, unknown>) => Reading,
  absentArms: Record<string, string> = {},
): Reading {
  if (sample.kind === "collector-failed") return { kind: "unknown", why: sample.why };
  const reading = record(sample.report[field]);
  if (reading === null) {
    return { kind: "unknown", why: `the sample had no ${field} reading in it` };
  }
  const kind = reading["kind"];
  if (kind === "value") return fromValue(reading);
  if (typeof kind === "string" && kind in absentArms) {
    return { kind: "absent", why: absentArms[kind] ?? kind };
  }
  if (kind === "unknown") {
    const why = reading["why"];
    return { kind: "unknown", why: typeof why === "string" ? why : "the collector gave no reason" };
  }
  return { kind: "unknown", why: `this page does not know what a ${field} of "${String(kind)}" means` };
}

function fraction(reading: Record<string, unknown>, key: string): Reading {
  const value = num(reading, key);
  return value === null
    ? { kind: "unknown", why: `the reading had no numeric ${key}` }
    : { kind: "value", value: value * 100 };
}

/**
 * The four series, in the order they are worth reading on a phone.
 *
 * **Every threshold is imported from `health-view.ts`, never restated.** Those
 * are `computeVerdict`'s own cutoffs, and a chart that went amber on a
 * different number from the tile above it would contradict the page in a way
 * nobody could see. Ten of the sixteen defects in the 2026-09-08 postmortem are
 * a consumer keeping its own copy of what a producer already said carefully.
 */
export const SERIES: SeriesSpec[] = [
  {
    key: "load",
    label: "Load",
    unit: "× cores",
    /* Twice the critical threshold, so the amber band is a quarter of the
       height and the red band the top half. See `max` on SeriesSpec for what a
       fitted axis did to this chart on a day containing load 391. */
    max: THRESHOLDS.loadRatio.critical * 2,
    bands: { ...THRESHOLDS.loadRatio, worseIs: "higher" },
    read: (sample) =>
      readingFrom(sample, "load", (reading) => {
        const ratio = num(reading, "ratio1");
        return ratio === null ? { kind: "unknown", why: "the reading had no numeric ratio1" } : { kind: "value", value: ratio };
      }),
  },
  {
    key: "memory",
    label: "Memory available",
    unit: "%",
    max: 100,
    bands: {
      strained: THRESHOLDS.memoryAvailable.strained * 100,
      critical: THRESHOLDS.memoryAvailable.critical * 100,
      /* LESS IS WORSE HERE, and it is the one series that runs the other way.
         Stated rather than inferred, exactly as health-view.ts does for the
         same reading — an inversion is the kind of thing a shared helper
         hides. */
      worseIs: "lower",
    },
    read: (sample) => readingFrom(sample, "memory", (reading) => fraction(reading, "availableFraction")),
  },
  {
    key: "swap",
    label: "Swap used",
    unit: "%",
    max: 100,
    bands: {
      strained: THRESHOLDS.swapUsed.strained * 100,
      critical: THRESHOLDS.swapUsed.critical * 100,
      worseIs: "higher",
    },
    read: (sample) =>
      readingFrom(sample, "swap", (reading) => fraction(reading, "usedFraction"), {
        /* An empty `swapon` is a real answer, and it is not a fault. */
        none: "no swap configured",
      }),
  },
  {
    key: "io",
    label: "IO wait",
    unit: "%",
    max: 100,
    bands: { strained: THRESHOLDS.ioWait.thrashing, critical: THRESHOLDS.ioWait.thrashing, worseIs: "higher" },
    read: (sample) =>
      readingFrom(sample, "swapActivity", (reading) => {
        const wa = num(reading, "waPercent");
        return wa === null ? { kind: "unknown", why: "the reading had no numeric waPercent" } : { kind: "value", value: wa };
      }, { skipped: "not sampled on this turn" }),
  },
];

/* ------------------------------------------------------------------ *
 * Segments, gaps, and the two edges.
 * ------------------------------------------------------------------ */

export type Point = { atMs: number; value: number };

/** A stretch of time with a name for what is in it. */
export type Span = { fromMs: number; toMs: number };

export type Gap = Span & {
  /** True for the last one when it runs to the right-hand edge: it is happening NOW. */
  ongoing: boolean;
};

export type SeriesPlot = {
  spec: SeriesSpec;
  /** Runs of consecutive points. **Never joined across a gap or an unknown.** */
  segments: Point[][];
  /** Where the collector ran and this reading could not be taken. */
  unknowns: (Span & { why: string })[];
  /** Where there is legitimately no number — no swap configured, not sampled. */
  absences: (Span & { why: string })[];
  /**
   * The worst point in the window, **by this series' own direction** — the
   * highest load, and the LOWEST memory. Null when there were no values.
   *
   * This is what the sentence under each chart says, and it is the single most
   * useful fact on the panel: a 73-second spike at 04:00 is a third of a pixel
   * wide and is invisible as a shape, but "peaked at 24.9× at 04:12" is an
   * answer.
   */
  worst: Point | null;
  /** The most recent value, for the "now" half of that sentence. */
  latest: Point | null;
  /** The largest value present. Null when there are none. */
  peak: number | null;
  /**
   * Where the line ran off the top of the fixed axis.
   *
   * **Clipping is drawn, not hidden.** The axis is fixed so one outlier cannot
   * flatten the day (see `SeriesSpec.max`), which means a genuine excursion has
   * to say so somewhere — as a mark along the top edge here, and as the real
   * number in the sentence beside the label. What must never happen is a line
   * pressed against the ceiling that reads as a plateau.
   */
  overCeiling: Span[];
};

export type VerdictBand = Span & { tone: Tone; level: string };

/** Everything a renderer needs, and nothing it has to work out for itself. */
export type HistoryPlot = {
  fromMs: number;
  toMs: number;
  series: SeriesPlot[];
  verdict: VerdictBand[];
  gaps: Gap[];
  /**
   * The stretch at the left with nothing recorded in it, or null when the
   * window is covered. **Not a gap** — nothing was lost, there was never
   * anything there.
   */
  beforeHistory: Span | null;
  /** True when a rotation means the oldest retained sample is not the first ever taken. */
  retainedOnly: boolean;
  sampleCount: number;
};

const LEVEL_TONE: Record<string, Tone> = {
  ok: "work",
  strained: "needs",
  critical: "alarm",
  unknown: "unknown",
};

/** How bad, for picking a winner when several samples share one pixel. */
const LEVEL_RANK: Record<string, number> = { ok: 0, unknown: 1, strained: 2, critical: 3 };

function levelOf(sample: HealthSampleView): string {
  if (sample.kind === "collector-failed") return "unknown";
  const verdict = record(sample.report["verdict"]);
  const level = verdict?.["level"];
  return typeof level === "string" ? level : "unknown";
}

/**
 * Build everything drawable from a window of samples.
 *
 * Samples are assumed oldest-first, which is what the store and the route both
 * promise; nothing here re-sorts them, because a re-sort would quietly repair a
 * producer that had started emitting them out of order and the chart would be
 * the last place anybody found out.
 */
export function plotHistory(view: Extract<HistoryView, { kind: "history" }>, nowMs: number): HistoryPlot {
  const { samples, fromMs } = view;
  /* The axis runs to NOW rather than to the payload's `toMs`, so that time
     passing since the fetch shows as the right-hand edge moving rather than as
     the chart quietly ending early. Never earlier than `toMs`, so a browser
     clock behind the server's cannot crop the newest samples off. */
  const toMs = Math.max(view.toMs, nowMs);

  const gaps: Gap[] = [];

  /* THE LEFT EDGE, which no pair of in-window samples can classify. A window
     that opens in the middle of a four-hour break has its first sample hours
     from `fromMs`, and without the sample BEFORE the window there is no way to
     tell that emptiness from where the record begins. `predecessorAtMs` is that
     sample. GPT Sol's finding 1. */
  const first = samples[0];
  if (view.predecessor !== null && first !== undefined) {
    if (first.atMs - view.predecessor.atMs > gapAfterMs(view.predecessor)) {
      gaps.push({ fromMs: Math.max(view.predecessor.atMs, fromMs), toMs: first.atMs, ongoing: false });
    }
  }

  for (let i = 0; i + 1 < samples.length; i++) {
    const here = samples[i];
    const next = samples[i + 1];
    if (here === undefined || next === undefined) continue;
    if (next.atMs - here.atMs > gapAfterMs(here)) {
      gaps.push({ fromMs: here.atMs, toMs: next.atMs, ongoing: false });
    }
  }

  /* A CORRUPT LINE IS A POSITIONAL BARRIER, not a number in a footnote.
     Dropping it and reporting a count lets the line reconnect straight across
     the place the record is broken, which is the same reconnection a gap must
     never get. GPT Sol's finding 6. */
  for (const hole of view.holes) {
    const from = hole.afterAtMs ?? fromMs;
    const to = hole.beforeAtMs ?? toMs;
    if (to > from) gaps.push({ fromMs: Math.max(from, fromMs), toMs: to, ongoing: false });
  }
  /* THE GAP THAT IS HAPPENING NOW, which no sample can record because it is the
     one that has not arrived. Without this the chart draws a line that stops
     partway across and looks merely finished. */
  const last = samples[samples.length - 1];
  if (last !== undefined && toMs - last.atMs > gapAfterMs(last)) {
    gaps.push({ fromMs: last.atMs, toMs, ongoing: true });
  }

  const merged = mergeGaps(gaps);

  /* Which samples a segment must be cut AFTER: the one before each gap, and the
     one before each corrupt run. Built from the UNMERGED list, because merging
     is about how the silence is counted and drawn, not about where the line has
     to stop — a cut point swallowed by a wider gap is still a cut point. */
  const isGapStart = new Set(gaps.filter((g) => !g.ongoing).map((g) => g.fromMs));
  for (const hole of view.holes) {
    if (hole.afterAtMs !== null) isGapStart.add(hole.afterAtMs);
  }

  const series: SeriesPlot[] = SERIES.map((spec) => plotSeries(spec, samples, isGapStart, toMs));

  const verdict: VerdictBand[] = samples.map((sample, i) => {
    const level = levelOf(sample);
    return {
      fromMs: sample.atMs,
      toMs: samples[i + 1]?.atMs ?? Math.min(sample.atMs + sample.nextDueMs, toMs),
      level,
      tone: LEVEL_TONE[level] ?? "unknown",
    };
  });

  /* "Nothing was recorded before this" — its own region, never a gap.
     `earliestAtMs` is the oldest sample the STORE holds, window or not, so a
     store older than the window covers it and this is null. */
  const earliest = view.earliestAtMs;
  const beforeHistory =
    earliest === null
      ? { fromMs, toMs }
      : earliest > fromMs
        ? { fromMs, toMs: Math.min(earliest, first?.atMs ?? earliest) }
        : null;

  return {
    fromMs,
    toMs,
    series,
    verdict,
    gaps: merged,
    beforeHistory,
    /* **`rotated` decides the WORDS**, and it is the difference between a claim
       we can make and one we cannot. Without a rotation, the oldest sample is
       when collecting started. After one, older samples existed and were
       discarded, so "collecting since 09:14" would be false — it becomes
       "retained data begins". GPT Sol's finding 7. */
    retainedOnly: view.rotated,
    sampleCount: samples.length,
  };
}

/**
 * Overlapping breaks into one, sorted.
 *
 * **THREE MECHANISMS CAN DESCRIBE THE SAME SILENCE**, and until this existed
 * they each pushed their own entry: a wide spacing between two samples, a
 * corrupt line bracketed by those same two samples, and the run to the
 * right-hand edge. A stretch with a torn record inside a four-hour outage was
 * pushed twice, and the sentence under the chart then read **"2 breaks totalling
 * 8.0 h"** about four hours — a number Greg would act on, arrived at by adding a
 * thing to itself.
 *
 * `ongoing` survives a merge, because "and it is still going" is the half of
 * that sentence that changes what you do next.
 *
 * Found by walking my own gap arithmetic while a reviewer was looking at it, and
 * caught by a test that went red first.
 */
export function mergeGaps(gaps: Gap[]): Gap[] {
  const sorted = [...gaps].sort((a, b) => a.fromMs - b.fromMs || a.toMs - b.toMs);
  const out: Gap[] = [];
  for (const gap of sorted) {
    const tail = out[out.length - 1];
    /* **STRICTLY OVERLAPPING, NOT MERELY TOUCHING.** Two breaks that share an
       endpoint are separated by a sample AT that instant — a reading arrived,
       and the record says so. Merging them would erase it and report one long
       silence over a moment the box was heard from. `<=` here cost a test and
       is the more tempting spelling. */
    if (tail !== undefined && gap.fromMs < tail.toMs) {
      tail.toMs = Math.max(tail.toMs, gap.toMs);
      tail.ongoing = tail.ongoing || gap.ongoing;
    } else {
      out.push({ ...gap });
    }
  }
  return out;
}

/**
 * Extend the last span when it touches this one and agrees with it, else start a
 * new one.
 *
 * **One rule, three lists** — the unknown runs, the absent runs, and the
 * over-ceiling marks all merge, and they were three copies of the same four
 * lines. What differs between them is only what "agrees" means, so that is the
 * parameter. Without any of them, a four-hour collector failure is ~200
 * consecutive samples and ~200 sub-pixel `<rect>`s in a phone's DOM, which is
 * what a browser pass measured before this existed.
 */
function joinSpan<T extends Span>(into: T[], span: T, agrees: (a: T, b: T) => boolean): void {
  const tail = into[into.length - 1];
  if (tail !== undefined && tail.toMs >= span.fromMs && agrees(tail, span)) tail.toMs = span.toMs;
  else into.push(span);
}

/**
 * One series' worth of a window: where the line runs, and where it stops.
 *
 * Extracted from `plotHistory` because it was the larger half of a function
 * biome measured at 39 cognitive complexity, and because the accumulators here
 * (`current`, `overCeiling`, the two span lists) are exactly where an off-by-one
 * in the gap arithmetic would hide. Named and alone, its whole contract fits on
 * a screen.
 *
 * **The rule it exists to enforce, in one line: any reading that is not a value
 * ENDS the current segment.** Never filtered out, never bridged.
 */
function plotSeries(
  spec: SeriesSpec,
  samples: HealthSampleView[],
  /** Sample timestamps after which the line must be cut — a gap, or a corrupt record. */
  isGapStart: ReadonlySet<number>,
  toMs: number,
): SeriesPlot {
  const segments: Point[][] = [];
  const unknowns: (Span & { why: string })[] = [];
  const absences: (Span & { why: string })[] = [];
  const overCeiling: Span[] = [];
  let current: Point[] = [];
  let peak: number | null = null;
  let worst: Point | null = null;
  let latest: Point | null = null;

  const isWorse = (a: number, b: number): boolean => (spec.bands.worseIs === "lower" ? a < b : a > b);
  const flush = (): void => {
    if (current.length > 0) segments.push(current);
    current = [];
  };
  /* One merge rule for all three span lists, rather than the same four lines
     written three times — see `joinSpan`. */
  const extend = (into: (Span & { why: string })[], span: Span & { why: string }): void => {
    joinSpan(into, span, (a, b) => a.why === b.why);
  };

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (sample === undefined) continue;
    const reading = spec.read(sample);
    /* A span wide enough to see: from this sample to the next, or one nominal
       interval when it is the last. */
    const until = samples[i + 1]?.atMs ?? Math.min(sample.atMs + sample.nextDueMs, toMs);

    if (reading.kind === "value") {
      const point = { atMs: sample.atMs, value: reading.value };
      current.push(point);
      peak = peak === null ? reading.value : Math.max(peak, reading.value);
      if (worst === null || isWorse(point.value, worst.value)) worst = point;
      latest = point;
      /* WHERE THE LINE RAN OFF A FIXED AXIS. Clipped on the chart, marked on the
         top edge, and stated in full in the sentence beside the label — see
         `SeriesSpec.max` for what a fitted axis did instead. */
      if (reading.value > spec.max) {
        joinSpan(overCeiling, { fromMs: sample.atMs, toMs: until }, () => true);
      }
    } else {
      /* THE LINE STOPS. A value on either side of an unreadable turn must not be
         joined, or the picture claims a measurement that was not taken. */
      flush();
      /* MERGED WITH THE ONE BEFORE IT when they touch and say the same thing. A
         four-hour collector failure is ~200 consecutive samples, and one `<rect>`
         each is two hundred sub-pixel rectangles in the DOM on a phone — measured
         at 1px apiece in a real browser pass. Same reasoning as
         `collapseVerdict`'s merge. */
      extend(reading.kind === "unknown" ? unknowns : absences, {
        fromMs: sample.atMs,
        toMs: until,
        why: reading.why,
      });
    }
    if (isGapStart.has(sample.atMs)) flush();
  }
  flush();
  return { spec, segments, unknowns, absences, peak, worst, latest, overCeiling };
}

/* ------------------------------------------------------------------ *
 * Collapsing many samples into few pixels, WITHOUT losing the bad one.
 * ------------------------------------------------------------------ */

/**
 * The verdict strip, one band per pixel column, **worst wins**.
 *
 * A 24h window holds ~1,200 samples and a phone gives the strip ~360 pixels, so
 * three samples share a column and something has to decide. **It must be the
 * worst, never the commonest and never a mean**: the whole point of the strip
 * is that a single 73-second `critical` sample at 04:00 is visible at 09:00,
 * and every averaging rule ever written would erase exactly that.
 */
export function collapseVerdict(bands: VerdictBand[], fromMs: number, toMs: number, columns: number): VerdictBand[] {
  if (columns <= 0 || toMs <= fromMs || bands.length === 0) return [];
  const span = toMs - fromMs;
  const worst: (VerdictBand | null)[] = Array.from({ length: columns }, () => null);

  for (const band of bands) {
    const startColumn = Math.max(0, Math.floor(((band.fromMs - fromMs) / span) * columns));
    const endColumn = Math.min(columns - 1, Math.floor(((band.toMs - fromMs) / span) * columns));
    for (let c = startColumn; c <= endColumn; c++) {
      const held = worst[c];
      if (held === null || held === undefined || (LEVEL_RANK[band.level] ?? 1) > (LEVEL_RANK[held.level] ?? 1)) {
        worst[c] = band;
      }
    }
  }

  /* Merge neighbours that agree, so the DOM holds a handful of rects rather
     than three hundred and sixty. */
  const out: VerdictBand[] = [];
  for (let c = 0; c < columns; c++) {
    const band = worst[c];
    if (band === undefined || band === null) continue;
    const fromColumnMs = fromMs + (c / columns) * span;
    const toColumnMs = fromMs + ((c + 1) / columns) * span;
    const tail = out[out.length - 1];
    if (tail !== undefined && tail.level === band.level && tail.toMs >= fromColumnMs - 1) {
      tail.toMs = toColumnMs;
    } else {
      out.push({ fromMs: fromColumnMs, toMs: toColumnMs, level: band.level, tone: band.tone });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Saying it in words, which is what actually answers the question.
 * ------------------------------------------------------------------ */

export function describeDuration(ms: number): string {
  /* Tested against the boundary rather than the rounding: 30 seconds rounds to
     "1 min", which is a claim about a minute that did not pass. */
  if (ms < 60_000) return "under a minute";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `${minutes} min`;
  const hours = ms / 3_600_000;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
}

/**
 * The sentence under the chart.
 *
 * **A shape on a 390px screen is not an answer; this is.** Greg's question is
 * "were there problems or disruptions", and three minutes of missing samples at
 * 04:00 is about a third of a pixel wide — legible only as a sentence.
 */
export function describeGaps(plot: HistoryPlot, formatTime: (ms: number) => string): string {
  if (plot.sampleCount === 0) return "Nothing has been recorded in this window.";
  if (plot.gaps.length === 0) return "No breaks — a sample was recorded throughout.";

  const total = plot.gaps.reduce((sum, gap) => sum + (gap.toMs - gap.fromMs), 0);
  const longest = plot.gaps.reduce((worst, gap) => (gap.toMs - gap.fromMs > worst.toMs - worst.fromMs ? gap : worst));
  const count = plot.gaps.length === 1 ? "1 break" : `${plot.gaps.length} breaks`;
  const longestText = longest.ongoing
    ? `the current one has lasted ${describeDuration(longest.toMs - longest.fromMs)} and is still going`
    : `the longest was ${describeDuration(longest.toMs - longest.fromMs)}, ending ${formatTime(longest.toMs)}`;
  /* **"NOTHING WAS RECORDED", NOT "NOTHING WAS RUNNING."** The record is silent
     and does not say why: a break is the box down, the dashboard down, a
     collection that hung, or — most often on this box — somebody restarting the
     server. Naming a cause we cannot see would be the whole point of the
     feature, inverted. GPT Sol's finding 1. */
  return `${count} totalling ${describeDuration(total)} with nothing recorded — ${longestText}. A break means no sample was written, which can be the box, the dashboard, or a restart.`;
}
