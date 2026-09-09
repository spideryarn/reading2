/**
 * The last twenty-four hours of the box, on a phone.
 *
 * > Box Health: graphs of recentish history (last 24h) so he can see whether
 * > there were problems/disruptions, plus amount/proportion of swap used
 * >
 * > — Greg, 2026-09-08
 *
 * ## What is drawn, and in what order of importance
 *
 * **A sentence about the record first** — how much of the day was actually
 * observed — because every shape below it is worth only what that sentence
 * says. Then four lines on one x scale: load, memory used, swap used, IO wait.
 * Then **the verdict strip**, one band per pixel column over the whole window
 * in the colour of the collector's own verdict, worst wins in a shared column,
 * so a single 73-second `critical` at 04:00 is still on screen at 09:00. It
 * carries the time axis for all five plots.
 *
 * **The strip was at the top until 2026-09-09**, at full saturation, and Greg
 * asked for it moved down and toned down: it was the loudest thing on a card
 * whose subject is the four lines, and a box that is routinely *strained* drew
 * a day-long orange bar over four calm graphs. It is a summary of them, so it
 * now reads after them, and `stripAppearance` saturates by severity rather than
 * uniformly.
 *
 * ## The four kinds of nothing, drawn four ways
 *
 * All of the reasoning is in history-series.ts; what this file must not do is
 * flatten any of it:
 *
 *  - a **gap** is hatched, and the line BREAKS across it;
 *  - an **unknown** reading is violet, and is **never plotted at zero**;
 *  - an **absent** reading (no swap configured, not sampled) is grey;
 *  - **before the history begins** is its own region with its own label, so a
 *    twenty-minute-old process does not show twenty minutes of line under an
 *    axis that says a day.
 *
 * ## Why the SVG is stretched and the words are not
 *
 * `viewBox` in fixed units with `preserveAspectRatio="none"` and the element at
 * `width: 100%` — so the plot fills whatever width the phone has without this
 * component measuring anything. Stretching would distort strokes and text, so
 * every stroke carries `vector-effect="non-scaling-stroke"` and **there is no
 * text inside the SVG at all**: labels are HTML beside it, which also means
 * they are selectable, translatable and read out properly.
 *
 * **Colour is never the only carrier.** Every band and every series states its
 * number in text underneath.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Explain, type Tip } from "./Tooltip";
import { type HistoryApi, type HistoryView, type RetentionView } from "./health-history-client";
import {
  collapseVerdict,
  describeDuration,
  describeGaps,
  plotHistory,
  type HistoryPlot,
  type SeriesPlot,
  type VerdictBand,
} from "./history-series";
import { shiftMsToBrowserClock, type ClockSkew } from "./types";
import { Card, SectionHeading, cx, toneClasses } from "./ui";
import type { Tone } from "./view";

/** The window Greg asked for. A selector is a query parameter away when it is wanted. */
export const WINDOW_HOURS = 24;

/**
 * How often to re-ask.
 *
 * A new sample only exists every ~73 seconds, so asking faster would be a
 * megabyte of JSON for an answer that has not changed. The state poll runs at
 * five seconds and this deliberately does not follow it.
 */
export const HISTORY_POLL_MS = 60_000;

/** The plot's own coordinate space. Stretched to the card's width by the viewBox. */
const PLOT_W = 1000;
const STRIP_H = 22;
const SERIES_H = 64;

/**
 * How this panel prints a moment. **A function threaded as a prop, not a skew.**
 *
 * Every clock time on the chart — the axis, each series' worst point, when a
 * break ended, when the last write worked — is a WALL-CLOCK reading, compared
 * against the watch in the reader's hand, and the masthead above says the times
 * on this page are corrected for their device. So the labels are corrected too:
 * GPT Sol's K3, 2026-09-08, and it is the half of types.ts §
 * `shiftToBrowserClock`'s rule that permits a shift at all.
 *
 * **THE GEOMETRY IS NOT TOUCHED, AND THAT IS THE POINT OF PASSING A
 * FORMATTER.** Every x coordinate, every gap, every duration on this panel is
 * one server instant minus another — arithmetic within one clock, correct as it
 * stands, and shifting both ends would move a fault relative to its own window
 * for no gain. Handing the components a `TimeLabel` rather than a `ClockSkew`
 * means none of them is holding a number it could accidentally do that with.
 */
export type TimeLabel = (ms: number) => string;

function timeLabel(skew: ClockSkew): TimeLabel {
  return (ms) =>
    new Date(shiftMsToBrowserClock(ms, skew)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ------------------------------------------------------------------ *
 * The panel.
 * ------------------------------------------------------------------ */

export function HealthHistory({
  api,
  nowMs,
  skew,
}: {
  api: HistoryApi;
  /** Passed in rather than read here, so a test can place the right-hand edge. */
  nowMs: number;
  /**
   * What this device's clock is out by, for the LABELS only — see `timeLabel`.
   * `nowMs` and every instant in the samples stay on the server's clock, which
   * is what keeps the shapes on this chart true.
   */
  skew: ClockSkew;
}): ReactNode {
  /* Built once here rather than in each component: one formatter means the axis
     and the sentences under it cannot end up on two different clocks. */
  const at = timeLabel(skew);
  const [view, setView] = useState<HistoryView | null>(null);

  /**
   * **A GENERATION TOKEN, BECAUSE AN OLDER ANSWER MUST NOT REPLACE A NEWER
   * PICTURE.**
   *
   * `setInterval` fires whether or not the last request has come back, and on a
   * loaded box a history request is a megabyte of JSON — so two can overlap and
   * resolve out of order. The visible consequence is specific and bad: a newly
   * arrived retention warning erased by a response that predates it, and not
   * shown again for another minute. GPT Sol's finding 10.
   *
   * A counter rather than `AbortController`: the request is harmless and cheap
   * to let finish, and what actually needs preventing is the *write*.
   */
  const generation = useRef(0);
  const latest = useRef(0);

  const load = useCallback(() => {
    const mine = ++generation.current;
    void api.window(WINDOW_HOURS).then((next) => {
      /* Strictly newer, so a straggler is dropped rather than reinstated. */
      if (mine > latest.current) {
        latest.current = mine;
        setView(next);
      }
    });
  }, [api]);

  useEffect(() => {
    load();
    const timer = setInterval(load, HISTORY_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="tw:mt-4">
      <SectionHeading>The last 24 hours</SectionHeading>
      <Card className="tw:p-3">
        <HistoryBody view={view} nowMs={nowMs} at={at} />
      </Card>
    </div>
  );
}

/**
 * The four answers, kept apart.
 *
 * `null` is *we have not asked yet*, which is not a claim about anything and
 * must not look like one — so it says so rather than drawing an empty day.
 */
function HistoryBody({ view, nowMs, at }: { view: HistoryView | null; nowMs: number; at: TimeLabel }): ReactNode {
  if (view === null) {
    return <p className="tw:text-[13px] tw:text-ink-faint">Reading the last 24 hours…</p>;
  }
  if (view.kind === "unreadable") {
    return (
      <Note tone="unknown" head="No history to draw.">
        {view.why}
      </Note>
    );
  }
  if (view.kind === "no-answer") {
    return (
      <Note tone="unknown" head="This page could not fetch the history.">
        {view.why} The box itself may be perfectly well — this is about the request, not the reading.
      </Note>
    );
  }

  const plot = plotHistory(view, nowMs);

  /**
   * **THE EMPTY-STORE SENTENCE IS ONLY HONEST WHEN THE STORE REALLY IS EMPTY.**
   *
   * Three things can make `samples` empty and only one of them is "we have not
   * started": a record that predates the window and has had nothing added since
   * (a dashboard silent for over a day), a window whose every sample this page
   * rejected (corruption), and a genuinely fresh store. The first two are the
   * two most alarming states here, and taking this branch on them printed the
   * most reassuring sentence on the page. GPT Sol's finding 4.
   */
  const reallyEmpty =
    plot.sampleCount === 0 && plot.gaps.length === 0 && view.unreadableSamples === 0 && view.unreadableLines === 0;

  if (reallyEmpty) {
    return (
      <div>
        <Note tone="idle" head="Nothing recorded in the last 24 hours.">
          The dashboard writes one sample per collection, so this fills in as it runs. It is empty after a
          restart, and that is not a claim about how the box has been.
        </Note>
        <Retention retention={view.retention} at={at} />
      </div>
    );
  }

  return (
    <div>
      {/* **THE SENTENCES ABOUT THE RECORD COME FIRST, AND THEY STAYED PUT WHEN
          THE STRIP MOVED DOWN.** They are about whether there was anything to
          see, not about what was seen, and reading a break as a fault is the
          failure this card was built to prevent. */}
      <p className="tw:text-[13px] tw:text-ink-soft">{describeGaps(plot, at)}</p>
      {/* **BEFORE THE CHART'S OWN SENTENCES**, because if the writer has
          stopped, every break below it is about the writer rather than about
          the box, and reading them the other way round is the whole failure. */}
      <Retention retention={view.retention} at={at} />
      {plot.beforeHistory === null ? null : (
        <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
          {/* NOT a gap, and said in different words on purpose: nothing was
              lost here, there was never anything to lose.

              "Retained data begins" after a rotation, because older samples DID
              exist and were discarded — "collecting since" would be a claim
              about when we started looking, and it would be false. */}
          {plot.retainedOnly ? "Retained data begins" : "Collecting since"}{" "}
          {at(plot.beforeHistory.toMs)} — the{" "}
          {describeDuration(plot.beforeHistory.toMs - plot.beforeHistory.fromMs)} before that is not
          recorded here, which is not the same as the box having been quiet.
        </p>
      )}

      {plot.series.map((series) => (
        <SeriesChart key={series.spec.key} series={series} plot={plot} at={at} />
      ))}

      {/* **UNDER THE LINES SINCE 2026-09-09, NOT OVER THEM.**
          > probably move down the bar showing the orange/green Swap and/or make
          > it less lurid, because it seems to be dominating the graphs — is it
          > the most important?
          >
          > — Greg, 2026-09-09
          It is a summary of the four plots above, so it reads better after
          them; and the time axis it carries now sits under all five rather than
          labelling the first one only. */}
      <VerdictStrip plot={plot} at={at} />

      <Legend />

      {view.unreadableLines > 0 || view.unreadableSamples > 0 ? (
        <p className="tw:mt-2 tw:text-[12px] tw:text-unknown-ink">
          {view.unreadableLines > 0
            ? `${view.unreadableLines} line${view.unreadableLines === 1 ? "" : "s"} in the store could not be read`
            : null}
          {view.unreadableLines > 0 && view.unreadableSamples > 0 ? "; " : null}
          {view.unreadableSamples > 0
            ? `${view.unreadableSamples} sample${view.unreadableSamples === 1 ? "" : "s"} arrived in a shape this page does not understand`
            : null}
          . Those moments are missing from the chart rather than wrong on it.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The strip.
 * ------------------------------------------------------------------ */

const STRIP_TIP: Tip = {
  head: "The 24-hour strip",
  what: "One band per moment, in the colour of the collector's own verdict at the time — a green tint for ok, amber for strained, full red for critical, violet for could-not-tell.",
  how: "The colours are graded by severity rather than drawn at equal strength, so a day of ordinary strain does not read as a day of emergency. Where several readings share one pixel the WORST one wins, never an average: a one-minute spike at 4am is the thing you opened this to find. Hatched means nothing was recorded at all, and the totals beside the label are counted off the record rather than off the picture.",
};

/** "24 hours", "6 hours", "7 days" — whatever the server actually gave us. */
function describeWindow(hours: number): string {
  if (hours >= 48) return `${Math.round(hours / 24)} days`;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`;
}

/**
 * How long the day spent at each level, worst first.
 *
 * **Read off the UNCOLLAPSED bands**, not off what is drawn: the strip is 360
 * columns wide and worst-wins inside each, so totting up the picture would
 * round a 73-second `critical` up to four minutes and a green minute away
 * entirely. `plotHistory` has already clipped these bands to the requested
 * window, added predecessor coverage at the left edge, and subtracted holes;
 * this helper deliberately sums that canonical coverage instead of trying to
 * infer coverage again. The numbers and the shape answer to the same record
 * and not to each other.
 */
export function verdictTotals(bands: VerdictBand[]): { level: string; tone: Tone; ms: number }[] {
  const byLevel = new Map<string, { level: string; tone: Tone; ms: number }>();
  for (const band of bands) {
    const seen = byLevel.get(band.level);
    if (seen === undefined) byLevel.set(band.level, { level: band.level, tone: band.tone, ms: band.toMs - band.fromMs });
    else seen.ms += band.toMs - band.fromMs;
  }
  /* Worst first, so the thing worth knowing is the thing read first — and
     `ORDER` rather than the tone's name so a level this build has never heard
     of sorts last instead of throwing. */
  const ORDER = ["critical", "strained", "unknown", "ok"];
  const rank = (level: string): number => {
    const at = ORDER.indexOf(level);
    return at === -1 ? ORDER.length : at;
  };
  return [...byLevel.values()].sort((a, b) => rank(a.level) - rank(b.level));
}

function VerdictStrip({ plot, at }: { plot: HistoryPlot; at: TimeLabel }): ReactNode {
  /* One band per plot unit is far more than any phone has pixels, so the
     collapse happens here at a resolution the SVG can actually show. */
  const bands = collapseVerdict(plot.verdict, plot.fromMs, plot.toMs, 360);
  const x = scaler(plot);
  const totals = verdictTotals(plot.verdict);
  return (
    <div className="tw:mt-3">
      {/* **A LABEL ROW LIKE EVERY OTHER PLOT HAS.** This strip had none, which
          is most of why it read as one more reading rather than as the summary
          of them — and the totals beside it are the only place the day's damage
          is a number rather than a colour, which is what makes it legible to a
          screen reader and to anyone who reads a page by its words. */}
      <div className="tw:flex tw:items-baseline tw:justify-between tw:gap-2">
        <span className="tw:text-[11px] tw:font-semibold tw:tracking-wide tw:text-ink-faint tw:uppercase">
          Verdict
        </span>
        <span className="tw:flex tw:flex-wrap tw:justify-end tw:gap-x-2 tw:text-[12px] tw:text-ink-soft">
          {totals.length === 0
            ? "no verdicts recorded"
            : totals.map((total) => (
                <span key={total.level} className={cx(total.tone === "work" ? undefined : toneClasses(total.tone).ink)}>
                  {total.level} {describeDuration(total.ms)}
                </span>
              ))}
        </span>
      </div>
      <Explain tip={STRIP_TIP} placement="bottom" className="tw:block tw:w-full">
        <svg
          viewBox={`0 0 ${PLOT_W} ${STRIP_H}`}
          preserveAspectRatio="none"
          className="tw:mt-1 tw:block tw:h-[22px] tw:w-full tw:rounded-sm"
          role="img"
          /* **NO LONGER REPEATS `describeGaps`.** That sentence is visible text
             at the top of this card, and once the strip moved to the bottom the
             two copies were far enough apart to be heard as two separate
             claims about two different things. GPT Sol, on the plan. The
             totals stay, because they are this element's own content. */
          aria-label={`The box's verdict over the last 24 hours: ${
            totals.length === 0
              ? "none recorded"
              : totals.map((total) => `${total.level} ${describeDuration(total.ms)}`).join(", ")
          }.`}
        >
          <Hatch />
          <rect x={0} y={0} width={PLOT_W} height={STRIP_H} fill="var(--quiet-wash)" />
          {bands.map((band) => (
            <rect
              key={band.fromMs}
              x={x(band.fromMs)}
              y={0}
              width={Math.max(x(band.toMs) - x(band.fromMs), 1)}
              height={STRIP_H}
              {...stripAppearance(band.tone)}
            />
          ))}
          <Absences plot={plot} height={STRIP_H} />
        </svg>
      </Explain>
      <div className="tw:mt-1 tw:flex tw:justify-between tw:text-[11px] tw:text-ink-faint">
        <span>{at(plot.fromMs)}</span>
        {/* **THE SERVER'S NUMBER, NOT THIS PAGE'S CONSTANT.** The route clamps
            the window, so a request for more than a week comes back narrower —
            and an axis that went on saying "24 hours" over a different span is
            a label describing something that is not on screen. Found by running
            260908b's own Class B check over my wire fields before pushing:
            `windowHours` was parsed and read by nothing. */}
        <span>{describeWindow(plot.windowHours)}</span>
        <span>now</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One series.
 * ------------------------------------------------------------------ */

function SeriesChart({ series, plot, at }: { series: SeriesPlot; plot: HistoryPlot; at: TimeLabel }): ReactNode {
  const { spec } = series;
  /**
   * **A FIXED AXIS, and this is the one thing on the panel that was found by
   * looking at it rather than by a test.**
   *
   * The axis used to be fitted to the window's peak. On a day containing the
   * 2026-09-08 spike — load 391 on 16 cores — that put the ceiling at 430, every
   * ordinary hour at 4% of the height, and the amber and red bands into
   * sub-pixel slivers, so the *whole chart* was painted red and a normal day
   * looked catastrophic. One outlier decided what every other hour looked like.
   * Every test was green.
   */
  const ceiling = spec.max;
  const x = scaler(plot);
  const y = (value: number): number => SERIES_H - (Math.min(value, ceiling) / ceiling) * SERIES_H;

  const band = (from: number, to: number): { y: number; height: number } => {
    const top = y(Math.max(from, to));
    const bottom = y(Math.min(from, to));
    return { y: top, height: Math.max(bottom - top, 0) };
  };
  /* A series may have no red of its own — IO wait's critical rule needs a second
     fact (active swapping) that a band on one axis cannot express, so it stops
     at amber and the combination stays in the verdict strip. An infinite cutoff
     clamps to the ceiling, giving amber all the way up and a zero-height red. */
  const criticalAt = Math.min(spec.bands.critical, ceiling);
  const strained = band(spec.bands.strained, criticalAt);
  const critical = band(criticalAt, ceiling);

  /* The two per-series marks are explained HERE rather than in the shared
     legend below, because they belong to one chart each and a legend with seven
     entries on a 390px screen is one nobody reads. Neither relies on colour
     alone: the real peak and the swapping total are both in the sentence beside
     the label. */
  const extra = [
    series.overCeiling.length > 0
      ? `The red bar along the top is where the line ran off this axis — the axis is fixed so one spike cannot flatten the rest of the day, and the real peak is in the line above.`
      : "",
    spec.mark === undefined
      ? ""
      : `The orange bar along the bottom is where pages were actually moving to or from swap. Swap is a cliff, not a slope: 100% full and quiet is a different fact from 60% and thrashing, so the event is drawn separately from the number.`,
  ]
    .filter((line) => line !== "")
    .join(" ");

  const tip: Tip = {
    head: spec.label,
    what: `${spec.label} over the last 24 hours, in ${spec.unit}.`,
    /* **A SERIES WITH NO RED NEEDS ITS OWN SENTENCE**, and the generic one
       formatted `Number.POSITIVE_INFINITY` literally: "red past Infinity",
       beside a claim that the tiles use the same cutoff, which for IO wait they
       do not. GPT Sol's second round. The band being invisible was correct and
       the prose describing it was not. */
    how: `${
      Number.isFinite(spec.bands.critical)
        ? `Amber past ${format(spec.bands.strained)} and red past ${format(spec.bands.critical)} — the same cutoffs the tiles above use, imported from one place so they cannot drift apart.`
        : `Amber past ${format(spec.bands.strained)}. There is no red band here: the collector calls this critical only in combination with pages actually moving to or from swap, and a band on one axis cannot say that — so the combined judgement stays in the verdict strip below, which is the collector's own.`
    } A break in the line means nothing was recorded; violet means the reading could not be taken, which is never drawn as zero.${extra === "" ? "" : ` ${extra}`}`,
  };

  return (
    <div className="tw:mt-3">
      <div className="tw:flex tw:items-baseline tw:justify-between tw:gap-2">
        <span className="tw:text-[11px] tw:font-semibold tw:tracking-wide tw:text-ink-faint tw:uppercase">
          {spec.label}
        </span>
        <span className="tw:text-[12px] tw:text-ink-soft">{summarise(series, at)}</span>
      </div>
      <Explain tip={tip} placement="bottom" className="tw:block tw:w-full">
        <svg
          viewBox={`0 0 ${PLOT_W} ${SERIES_H}`}
          preserveAspectRatio="none"
          className="tw:mt-1 tw:block tw:h-16 tw:w-full tw:rounded-sm tw:bg-panel-raised"
          role="img"
          aria-label={`${spec.label} over the last 24 hours. ${summarise(series, at)}`}
        >
          <Hatch />
          {/* The thresholds, behind everything, so a shape is read against them. */}
          <rect x={0} y={strained.y} width={PLOT_W} height={strained.height} fill="var(--needs-wash)" />
          <rect x={0} y={critical.y} width={PLOT_W} height={critical.height} fill="var(--alarm-wash)" />

          {series.absences.map((span) => (
            <rect
              key={`absent-${span.fromMs}`}
              x={x(span.fromMs)}
              y={0}
              width={Math.max(x(span.toMs) - x(span.fromMs), 1)}
              height={SERIES_H}
              fill="var(--quiet-wash)"
            />
          ))}
          {/* VIOLET, FULL HEIGHT, NEVER A POINT AT ZERO. A reading that could
              not be taken is not a low reading. */}
          {series.unknowns.map((span) => (
            <rect
              key={`unknown-${span.fromMs}`}
              x={x(span.fromMs)}
              y={0}
              width={Math.max(x(span.toMs) - x(span.fromMs), 1)}
              height={SERIES_H}
              fill="var(--unknown-wash)"
            />
          ))}

          {/* **THE ABSENCE LAYER GOES ON TOP OF THE READING LAYER, NOT UNDER
              IT.** It used to be drawn first, so a violet "could not tell" band
              painted over the hatch and gave a stretch of silence a cause — four
              hours of nothing, coloured by the one reading before it. The record
              is silent about a break; nothing may be drawn over it that claims
              otherwise. GPT Sol's finding 3. */}
          <Absences plot={plot} height={SERIES_H} />

          {/* WHERE THE LINE RAN OFF THE TOP. A fixed axis means a real
              excursion has to be marked, or a line pressed against the ceiling
              reads as a plateau. The real number is in the sentence above. */}
          {series.overCeiling.map((span) => (
            <rect
              key={`over-${span.fromMs}`}
              x={x(span.fromMs)}
              y={0}
              width={Math.max(x(span.toMs) - x(span.fromMs), 1.5)}
              height={4}
              fill="var(--alarm)"
            />
          ))}

          {/* **SWAP IS A CLIFF, NOT A SLOPE**, so the event gets its own bar
              rather than being folded into the line. `activelySwapping` is
              pages moving right now, which is a different fact from any
              percentage — health.ts is emphatic that 100% full and quiet is not
              the same as 60% and thrashing, and a chart with the number and not
              the event would have lost exactly that. */}
          {series.marks.map((span) => (
            <rect
              key={`mark-${span.fromMs}`}
              x={x(span.fromMs)}
              y={SERIES_H - 4}
              width={Math.max(x(span.toMs) - x(span.fromMs), 1.5)}
              height={4}
              fill="var(--needs)"
            />
          ))}

          {series.segments.map((segment, index) => (
            <polyline
              key={`seg-${index}-${segment[0]?.atMs ?? index}`}
              points={segment.map((point) => `${x(point.atMs)},${y(point.value)}`).join(" ")}
              fill="none"
              stroke="var(--ink-soft)"
              strokeWidth={1.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </Explain>
    </div>
  );
}

/**
 * The sentence beside each chart's label.
 *
 * **The worst point, with its time.** A spike narrower than a pixel is invisible
 * as a shape and obvious as a sentence, and this panel exists to answer a
 * question rather than to be looked at.
 */
function summarise(series: SeriesPlot, at: TimeLabel): string {
  /* The boolean fact gets its own clause, always — including when there were no
     readings, because "we could not measure IO wait" and "and it was swapping
     for three hours" are both true and neither replaces the other. */
  const marked =
    series.spec.mark === undefined || series.markedMs === 0
      ? ""
      : ` · ${series.spec.mark.label} ${describeDuration(series.markedMs)}`;
  if (series.worst === null) {
    return `no readings in this window${marked}`;
  }
  /* **"NOW" ONLY WHEN THE RIGHT-HAND EDGE IS ACTUALLY COVERED BY IT.** `latest`
     is the newest VALUE anywhere in the window, which is a different thing: if
     the last few readings were unknown, or the writer is overdue, the newest
     value can be hours old and labelling it "now" is a live number that is not
     live. GPT Sol's finding 3. `latest` is dropped rather than relabelled with
     its time, because the sentence already carries a timestamped extreme and two
     of them would read as a range. */
  const now = series.latestIsCurrent && series.latest !== null ? `now ${format(series.latest.value)}${series.spec.unit} · ` : "";
  return `${now}peak ${format(series.worst.value)}${series.spec.unit} at ${at(series.worst.atMs)}${marked}`;
}

function format(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
}

/* ------------------------------------------------------------------ *
 * Shared bits.
 * ------------------------------------------------------------------ */

function scaler(plot: HistoryPlot): (ms: number) => number {
  const span = Math.max(plot.toMs - plot.fromMs, 1);
  return (ms) => ((ms - plot.fromMs) / span) * PLOT_W;
}

/**
 * The strip's fills: **saturated by severity, not uniformly.**
 *
 * > probably move down the bar showing the orange/green Swap and/or make it
 * > less lurid, because it seems to be dominating the graphs
 * >
 * > — Greg, 2026-09-09
 *
 * Every band used to be drawn at full strength, so a box that had been
 * *strained* for six ordinary hours — which this one often has been — looked
 * like a six-hour emergency, in the loudest element on a card whose subject is
 * the four lines above it. Turning the whole strip down would have flattened
 * the step that matters most, so instead the scale is drawn as a scale: `ok`
 * recedes to a tint, `strained` is halfway, `critical` keeps every bit of its
 * red. **The gap between amber and red is bigger than it was, not smaller.**
 *
 * Direct colour plus SVG opacity, rather than `color-mix()`, is deliberate:
 * older iOS Safari treats an unsupported SVG fill value as invalid, which can
 * turn every quiet band black. Opacity produces the same calmer scale while
 * leaving a valid colour in every browser that understands CSS variables.
 *
 * `unknown` sits just below critical rather than beside `ok`: a reading nobody
 * could take is closer to trouble than to health, which is `health.ts`'s whole
 * argument for the fourth level.
 */
function stripAppearance(tone: string): { fill: string; fillOpacity: number } {
  switch (tone) {
    /* **NOT `--work-wash`, WHICH IS WHERE THE FIRST ATTEMPT LANDED.** A 9% tint
       is so close to the strip's own grey ground that `ok` and *no reading to
       take* — two entries in the legend below, two different meanings — came
       out the same colour, which is the collapse this panel exists to refuse.
       Found in the browser, invisible to every test. It has to be quiet AND
       unmistakably green. */
    case "work":
      return { fill: "var(--work)", fillOpacity: 0.22 };
    case "needs":
      return { fill: "var(--needs)", fillOpacity: 0.5 };
    case "unknown":
      return { fill: "var(--unknown)", fillOpacity: 0.55 };
    default:
      return { fill: toneVar(tone), fillOpacity: 1 };
  }
}

function toneVar(tone: string): string {
  switch (tone) {
    case "work":
      return "var(--work)";
    case "needs":
      return "var(--needs)";
    case "alarm":
      return "var(--alarm)";
    default:
      return "var(--unknown)";
  }
}

/**
 * The hatch a gap wears.
 *
 * A pattern rather than a flat colour, because **absence has to look different
 * in kind from every reading**, not merely different in hue — a flat grey band
 * reads as one more state of the box, and this is the state of the *record*.
 * Defined per SVG (ids are document-global, so the id is shared and defining it
 * twice is harmless — the second definition is identical).
 */
function Hatch(): ReactNode {
  return (
    <defs>
      <pattern id="fleet-gap-hatch" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={6} height={6} fill="var(--page)" />
        <line x1={0} y1={0} x2={0} y2={6} stroke="var(--rule-strong)" strokeWidth={2} />
      </pattern>
    </defs>
  );
}

/** Gaps and the before-history region, drawn identically wherever they appear. */
function Absences({ plot, height }: { plot: HistoryPlot; height: number }): ReactNode {
  const x = scaler(plot);
  return (
    <>
      {plot.beforeHistory === null ? null : (
        <>
          <rect
            x={x(plot.beforeHistory.fromMs)}
            y={0}
            width={Math.max(x(plot.beforeHistory.toMs) - x(plot.beforeHistory.fromMs), 0)}
            height={height}
            fill="var(--quiet-wash)"
          />
          {/* **THE BOUNDARY, DRAWN.** Without it this grey is the same grey as
              "no reading to take", and two different meanings sharing one fill
              is the collapse this panel is built to refuse. The rule says where
              the record starts; the sentence under the strip says what that
              means. A browser pass is what found them wearing the same colour. */}
          <rect
            x={Math.max(x(plot.beforeHistory.toMs) - 1, 0)}
            y={0}
            width={2}
            height={height}
            fill="var(--rule-strong)"
          />
        </>
      )}
      {plot.gaps.map((gap) => (
        <rect
          key={`gap-${gap.fromMs}`}
          x={x(gap.fromMs)}
          y={0}
          width={Math.max(x(gap.toMs) - x(gap.fromMs), 1)}
          height={height}
          fill="url(#fleet-gap-hatch)"
        />
      ))}
    </>
  );
}

/** Says what each fill means, because a hatch is not self-explanatory. */
function Legend(): ReactNode {
  return (
    <div className="tw:mt-3 tw:flex tw:flex-wrap tw:gap-x-3 tw:gap-y-1 tw:text-[11px] tw:text-ink-faint">
      {/* Four kinds of nothing, four fills, four names. If two of these ever
          share an entry, one of them has stopped being drawn. */}
      <Swatch fill="url(#fleet-gap-hatch)" hatched>
        nothing recorded
      </Swatch>
      <Swatch fill="var(--unknown-wash)">could not tell</Swatch>
      <Swatch fill="var(--quiet-wash)">no reading to take</Swatch>
      <Swatch fill="var(--quiet-wash)" edge>
        before the record starts
      </Swatch>
      <span className={cx("tw:font-medium", toneClasses("alarm").ink)}>critical</span>
      <span className={cx("tw:font-medium", toneClasses("needs").ink)}>strained</span>
      <span className={cx("tw:font-medium", toneClasses("work").ink)}>ok</span>
    </div>
  );
}

function Swatch({
  fill,
  hatched,
  edge,
  children,
}: {
  fill: string;
  hatched?: boolean;
  /** Draws the boundary rule, so this swatch matches the region it names. */
  edge?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <span className="tw:inline-flex tw:items-center tw:gap-1">
      <svg width={14} height={10} className="tw:shrink-0 tw:rounded-[2px]" aria-hidden="true">
        {hatched === true ? <Hatch /> : null}
        <rect width={14} height={10} fill={fill} stroke="var(--rule)" />
        {edge === true ? <rect x={12} width={2} height={10} fill="var(--rule-strong)" /> : null}
      </svg>
      {children}
    </span>
  );
}

/**
 * **When the WRITER has stopped, say so — never let it show up as a break.**
 *
 * If appends start failing (a full disk, a lock held by another process, a
 * partial write that poisoned the file) the live page carries on and the old
 * samples stay readable, so the chart simply grows a hole at its right-hand
 * edge. That hole is indistinguishable from the box having gone down — an
 * outage manufactured by the monitoring rather than observed by it, and the
 * worst thing in this feature's blast radius. GPT Sol's finding 3.
 *
 * Silent when everything is fine: a line saying "retention is working" on every
 * healthy load is a line nobody reads, and one nobody reads is one nobody
 * notices changing.
 */
/**
 * Is the writer still being ASKED, or has the loop that asks it stopped?
 *
 * `lastAttemptAt` moves every turn whatever the outcome; `lastSuccessAt` only
 * on a write that worked. Apart, they separate two faults that look identical
 * from the outside — the same distinction `state.ts` draws between `attemptedAt`
 * and `collectedAt`, and it catches the same thing: a loop that has quietly
 * stopped, wearing the last good timestamp.
 *
 * Absent (a server that does not report it) reads as "still trying", because
 * that is the weaker claim: it adds no alarm the payload did not support.
 */
function stillTrying(retention: RetentionView): boolean {
  if (retention.lastAttemptAt === null) return true;
  if (retention.lastSuccessAt === null) return true;
  return Date.parse(retention.lastAttemptAt) > Date.parse(retention.lastSuccessAt);
}

function Retention({ retention, at }: { retention: RetentionView | null; at: TimeLabel }): ReactNode {
  /* Null is "this server did not say", not "fine". No claim either way, and
     nothing to draw — the alternative is a reassurance nothing produced. */
  if (retention === null) return null;
  /* `lockedOutBy` counts IMMEDIATELY, rather than waiting for the first append
     to copy it into `failure`. A dashboard that has never been able to write is
     in trouble from the moment it starts, and the minute before its first turn
     is exactly when somebody might look. GPT Sol's finding 6. */
  const trouble =
    retention.failure ??
    retention.lockedOutBy ??
    (retention.poisoned ? "an earlier write may have left a partial record" : null);
  if (trouble === null) return null;
  return (
    <div className="tw:mt-2 tw:border-l-4 tw:border-l-alarm tw:bg-alarm-wash tw:py-1 tw:pl-3">
      <p className="tw:text-[13px] tw:font-medium tw:text-alarm-ink">Nothing is being written to the history.</p>
      <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">
        {trouble}
        {retention.lastSuccessAt === null
          ? " — no sample has been written since this dashboard started."
          : ` — the last one that worked was ${at(Date.parse(retention.lastSuccessAt))}.`}{" "}
        {/* **THE PAIR IS THE DIAGNOSIS**, which is the argument `state.ts` makes
            for `attemptedAt`: a writer still trying and failing is a different
            fault from one that has stopped being asked, and the two are
            indistinguishable from `lastSuccessAt` alone. This field crossed the
            wire and was read by nothing until 260908b's Class B check went
            looking. */}
        {stillTrying(retention)
          ? "It is still trying every turn. "
          : "Nothing has attempted a write since then either, so the loop itself may have stopped. "}
        {/* **NOT "any break after that is this, not the box".** That was the
            wording here, and it is unknowable: if writing failed and the box
            then crashed, both happened — and the sentence would have talked a
            reader out of the second one. That the record is unavailable is the
            whole of what can be claimed. GPT Sol's finding 6, which is finding 1
            made again by me after I had fixed it everywhere else. */}
        <strong>There is no record after that time, so nothing here can tell you how the box has been since.</strong>
        {retention.poisoned ? " Restarting the dashboard repairs the file and resumes." : null}
      </p>
    </div>
  );
}

function Note({ tone, head, children }: { tone: "unknown" | "idle"; head: string; children: ReactNode }): ReactNode {
  return (
    <div className={cx("tw:border-l-4 tw:pl-3", toneClasses(tone).edge)}>
      <h3 className="tw:text-[13px] tw:font-medium">{head}</h3>
      <p className="tw:mt-1 tw:text-[13px] tw:text-ink-soft">{children}</p>
    </div>
  );
}
