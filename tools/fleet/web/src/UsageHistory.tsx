/**
 * The last 24 hours of usage limits, under the current reading.
 *
 * Hand-rolled inline `<svg>` with labels in HTML beside it, the way
 * `HealthHistory.tsx` draws load — no charting library, because this page is the
 * thing you reach for when everything else is broken and a dependency for one
 * chart is a poor trade.
 *
 * **Everything it may claim is decided in `usage-history-series.ts`**, which is
 * pure and tested. This file's job is only to draw the plot and to say, in
 * words, what the plot is refusing to assert:
 *
 *  - a broken line is a break, drawn as a break, never interpolated and never
 *    dropped to zero;
 *  - an incident is drawn once, spanning the instants it actually happened at,
 *    on a shared strip with **no account** against it;
 *  - a window nobody could read is a named row, not a missing one.
 *
 * The times are the reader's own wall clock, corrected for the box's skew, the
 * same as every other timestamp on this page.
 */
import { useEffect, useState, type ReactNode } from "react";

import { shiftMsToBrowserClock, type ClockSkew } from "./types";
import type { UsageHistoryApi, UsageHistoryView } from "./usage-history-client";
import { plotUsageHistory, type UsagePlot } from "./usage-history-series";

const PLOT_W = 1000;
const SERIES_H = 64;
const STRIP_H = 20;
export const WINDOW_HOURS = 24;

/**
 * One owner for the history route and therefore for the newest Codex attempt.
 * Both account-card mounts consume this same view; neither performs its own
 * newest-value selection or fetch. It polls at the server-declared cadence so
 * a tab left open does not freeze, and `refreshNonce` makes the dock's Refresh
 * button restart the read without a callback registry.
 */
export function useUsageHistoryView({
  api,
  refreshNonce,
  active,
}: {
  api: UsageHistoryApi;
  refreshNonce: number;
  active: boolean;
}): UsageHistoryView | null {
  const [view, setView] = useState<UsageHistoryView | null>(null);
  const [refreshMs, setRefreshMs] = useState(60_000);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshNonce is the refresh signal — re-running when it changes is the point.
  useEffect(() => {
    if (!active) return;
    let live = true;
    let newestRequest = 0;
    const load = (): void => {
      const request = ++newestRequest;
      void api.window(WINDOW_HOURS).then((next) => {
        if (!live || request !== newestRequest) return;
        setView(next);
        if (next.kind === "history" && next.refreshMs > 0) setRefreshMs(next.refreshMs);
      });
    };
    load();
    const timer = setInterval(load, refreshMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [active, api, refreshNonce, refreshMs]);

  return view;
}

/** Distinct enough at a glance; the label beside the line is what actually names it. */
const WINDOW_TONES = ["var(--work)", "var(--needs)", "var(--alarm)"];

function xOf(plot: UsagePlot): (ms: number) => number {
  const span = Math.max(1, plot.toMs - plot.fromMs);
  return (ms) => ((ms - plot.fromMs) / span) * PLOT_W;
}

/**
 * A moment on the READER's wall clock, corrected for the box's skew.
 *
 * `shiftMsToBrowserClock` rather than subtracting a number, because the skew has
 * an `unknown` arm — the payload carried no `servedAt` — and that must shift by
 * nothing rather than by an invented zero that reads as measured.
 */
function clockLabel(ms: number, skew: ClockSkew): string {
  return new Date(shiftMsToBrowserClock(ms, skew)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * One window's line, cut wherever the series says it must be.
 *
 * Points are drawn as separate polylines between breaks rather than one
 * polyline with holes: an SVG polyline cannot express "no data here", and the
 * version that tried it joined straight across every gap.
 */
function WindowLine({
  plot,
  series,
  tone,
}: {
  plot: UsagePlot;
  series: UsagePlot["accounts"][number]["windows"][number];
  tone: string;
}): ReactNode {
  const x = xOf(plot);
  const y = (pct: number): number => SERIES_H - (Math.max(0, Math.min(100, pct)) / 100) * SERIES_H;
  /* THE RUNS ARE THE SERIES LAYER'S, not re-derived here. This used to compare
     timestamps to decide whether a break fell between two points, which is
     wrong the moment the clock goes backwards: for file-order points 10:05 then
     10:00 the predicate asked `10:05 < 10:00`, got false, and drew one line
     straight across the regression the chart had just shaded in alarm colours.
     GPT Sol H7. */
  const runs = series.runs.filter((run) => run.length > 0);
  return (
    <>
      {runs.map((run) => (
        <polyline
          key={`${run[0]?.atMs}-${run.length}`}
          fill="none"
          stroke={tone}
          strokeWidth={1.5}
          points={run.map((p) => `${x(p.atMs)},${y(p.value)}`).join(" ")}
        />
      ))}
      {/* A single reading is a point rather than a line, and must still show. */}
      {runs
        .filter((run) => run.length === 1)
        .map((run) => (
          <circle key={run[0]?.atMs} cx={x(run[0]?.atMs ?? 0)} cy={y(run[0]?.value ?? 0)} r={2} fill={tone} />
        ))}
    </>
  );
}

export function UsageHistory({
  view,
  skew,
}: {
  view: UsageHistoryView | null;
  /** The box's clock against this browser's. Labels are the reader's own time. */
  skew: ClockSkew;
}): ReactNode {
  if (view === null) return <p className="tw:text-sm tw:opacity-70">Loading the last {WINDOW_HOURS} hours…</p>;
  if (view.kind === "unreadable") {
    return (
      <section className="tw:mt-6">
        <h3 className="tw:text-sm tw:font-medium">The last {WINDOW_HOURS} hours</h3>
        <p className="tw:text-sm tw:opacity-80">{view.why}</p>
      </section>
    );
  }

  const plot = plotUsageHistory(view);
  const x = xOf(plot);
  const hasPoints = plot.accounts.some((a) => a.windows.some((w) => w.points.length > 0));
  const nothingRecorded = view.samples.length === 0 && view.predecessor === null;

  return (
    <section className="tw:mt-6">
      <h3 className="tw:text-sm tw:font-medium">The last {WINDOW_HOURS} hours</h3>

      {/* **THE CHART IS NOT THE SECTIONS ABOVE IT, AND SAYS SO.**
          Added 2026-09-10 with the per-account sections (plan 260910c). Each
          persisted record carries the ONE account the daemon's usage pass
          observed, so this chart is a history of the ambient login and not of
          the registered accounts drawn above.

          **It deliberately names no email.** The first draft of this line said
          "this chart is greg@rehearsable.ai only", and GPT Sol showed that is
          false: a `/login` swap inside the window produces several account uuids
          across the range, and the legend above already distinguishes them by
          uuid fragment when it happens. Naming one would be a claim about every
          plotted series that nothing here has checked. */}
      <p className="tw:mt-1 tw:text-xs tw:opacity-70">
        History samples only the account the daemon itself observed on each pass, identified by uuid. It does not
        yet record the per-account sections above.
      </p>

      {/* **"NOTHING RECORDED" MEANS NO RECORDS, NOT NO LINE TO DRAW.** This was
          keyed off `hasPoints`, so a window full of collector failures, an
          unattributed cache, or nothing but named unknown windows and rejections
          printed "nothing recorded in the last 24 hours" directly above a list
          of things recorded in the last 24 hours. GPT Sol H10.

          And it claims no "since" it cannot know: an empty file has no first
          line, process start moves the claim on every restart, and the
          checkpoint's own instant may predate the recorder by days. */}
      {nothingRecorded ? (
        <p className="tw:text-sm tw:opacity-80">
          Nothing recorded in the last {WINDOW_HOURS} hours; this fills in as the recorder runs.
          {plot.unreadableLines > 0 ? ` ${plot.unreadableLines} line(s) could not be read.` : ""}
        </p>
      ) : null}
      {!nothingRecorded && !hasPoints ? (
        <p className="tw:text-sm tw:opacity-80">
          Records were kept over this period, but none of them carried a utilisation reading to plot.
          What they did carry is below.
        </p>
      ) : null}
      {plot.unsupportedLines > 0 ? (
        <p className="tw:mt-1 tw:text-xs tw:opacity-70">
          {plot.unsupportedLines} record(s) were written by a newer build and cannot be read here — the series is
          broken across them rather than drawn through them.
        </p>
      ) : null}

      {hasPoints ? (
        <>
          <div className="tw:relative">
          <div
            className="tw:pointer-events-none tw:absolute tw:inset-y-0 tw:left-0 tw:flex tw:flex-col tw:justify-between tw:text-[10px] tw:opacity-60"
            aria-hidden
          >
            <span>100%</span>
            <span>50%</span>
            <span>0%</span>
          </div>
          <svg
            viewBox={`0 0 ${PLOT_W} ${SERIES_H}`}
            preserveAspectRatio="none"
            className="tw:mt-2 tw:h-24 tw:w-full"
            role="img"
            aria-label={`Utilisation over the last ${WINDOW_HOURS} hours`}
          >
            <rect x={0} y={0} width={PLOT_W} height={SERIES_H} fill="var(--quiet-wash)" />
            {/* Gridlines at 0/50/100%. Without them the height of a line means
                nothing — a browser check read the chart and could not say what
                any point was worth. The numbers are in HTML beside the svg,
                because `preserveAspectRatio="none"` stretches the viewBox and
                would stretch text with it. */}
            {[0, 50, 100].map((pct) => (
              <line
                key={pct}
                x1={0}
                x2={PLOT_W}
                y1={SERIES_H - (pct / 100) * SERIES_H}
                y2={SERIES_H - (pct / 100) * SERIES_H}
                stroke="var(--rule)"
                strokeWidth={0.5}
              />
            ))}
            {/* Where nothing was recorded. Shaded rather than joined, because the
                alternative is a straight line across an unobserved period. */}
            {plot.recorderGaps.map((gap) => (
              <rect
                key={`${gap.fromMs}-${gap.toMs}`}
                x={x(gap.fromMs)}
                y={0}
                width={Math.max(1, x(gap.toMs) - x(gap.fromMs))}
                height={SERIES_H}
                fill="var(--unknown-wash)"
              />
            ))}
            {plot.clockRegressions.map((span) => (
              <rect
                key={`${span.fromMs}-${span.toMs}`}
                x={x(span.fromMs)}
                y={0}
                width={Math.max(1, x(span.toMs) - x(span.fromMs))}
                height={SERIES_H}
                fill="var(--alarm-wash)"
              />
            ))}
            {plot.beforeHistory !== null ? (
              <rect
                x={x(plot.beforeHistory.fromMs)}
                y={0}
                width={Math.max(1, x(plot.beforeHistory.toMs) - x(plot.beforeHistory.fromMs))}
                height={SERIES_H}
                fill="var(--rule)"
                opacity={0.25}
              />
            ) : null}
            {plot.accounts.flatMap((account) =>
              account.windows.map((series, i) => (
                <WindowLine
                  key={`${account.accountUuid}-${series.window}`}
                  plot={plot}
                  series={series}
                  tone={WINDOW_TONES[i % WINDOW_TONES.length] ?? "var(--work)"}
                />
              )),
            )}
          </svg>
          </div>

          <div className="tw:flex tw:flex-wrap tw:gap-x-4 tw:gap-y-1 tw:text-xs tw:opacity-80">
            {plot.accounts.flatMap((account) =>
              account.windows.map((series, i) => (
                <span key={`${account.accountUuid}-${series.window}`}>
                  <span style={{ color: WINDOW_TONES[i % WINDOW_TONES.length] }}>—</span> {series.window}
                  {plot.accounts.length > 1 ? ` · ${account.accountUuid.slice(0, 8)}` : ""}
                </span>
              )),
            )}
            {/* **NOT "05:28 – 05:28".** A 24-hour window ends at the same wall
                time it began, so a bare start-and-end reads as a zero-width
                range — which is exactly how it looked in the browser. Say the
                span and anchor it to the end instead. */}
            <span>
              the {WINDOW_HOURS} hours to {clockLabel(plot.toMs, skew)}, as observed
            </span>
          </div>
        </>
      ) : null}

      {/* THE REJECTIONS, ON THEIR OWN STRIP AND WITH NO ACCOUNT AGAINST THEM.
          A transcript 429 carries no account id, and the scan looks back eight
          days that may span a /login swap — so these are observed window
          clusters, and saying whose they are would be an invention. */}
      {plot.incidents.length > 0 ? (
        <div className="tw:mt-3">
          <h4 className="tw:text-xs tw:font-medium tw:opacity-80">
            Rejections seen — window clusters, not tied to an account
          </h4>
          <svg
            viewBox={`0 0 ${PLOT_W} ${STRIP_H}`}
            preserveAspectRatio="none"
            className="tw:mt-1 tw:h-5 tw:w-full"
            role="img"
            aria-label="Rate-limit rejections over the same period"
          >
            <rect x={0} y={0} width={PLOT_W} height={STRIP_H} fill="var(--quiet-wash)" />
            {plot.incidents
              .filter((i) => !i.unplaced && !i.unreadable && i.fromMs !== null)
              .map((incident) => (
                <rect
                  key={incident.id}
                  x={Math.max(0, x(incident.fromMs ?? 0))}
                  y={2}
                  width={Math.max(2, x(incident.toMs ?? incident.fromMs ?? 0) - x(incident.fromMs ?? 0))}
                  height={STRIP_H - 4}
                  fill="var(--alarm)"
                  opacity={0.8}
                />
              ))}
          </svg>
          <ul className="tw:mt-1 tw:text-xs tw:opacity-80">
            {plot.incidents.map((incident) => (
              <li key={incident.id}>
                {incident.window} · {incident.rejections} rejection(s) across {incident.conversations} conversation(s)
                {incident.fromConclusiveScan ? "" : " (most seen in a scan that did not finish)"}
                {incident.beganBeforeWindow ? " · began before this window" : ""}
                {incident.unplaced ? " · no timestamp, so not placed on the axis" : ""}
                {incident.unreadable ? ` · records disagree about this one, so it is not drawn: ${incident.why ?? ""}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Windows the producer could not read. NAMED, never dropped, and never
          drawn from the unvalidated 0 they carry. */}
      {plot.unknownWindows.length > 0 ? (
        <ul className="tw:mt-3 tw:text-xs tw:opacity-70">
          {plot.unknownWindows.map((w) => (
            <li key={w.window}>
              <span className="tw:font-medium">{w.window}</span> — {w.why}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Is anything still being recorded? Derived from the records, because the
          writer is the Overseer daemon and this page is the dashboard — two
          processes, and a status read here would report on the wrong one. */}
      {view.recorder.overdueByMs !== null ? (
        <p className="tw:mt-2 tw:text-xs" style={{ color: "var(--needs)" }}>
          Nothing has been recorded for {Math.round(view.recorder.overdueByMs / 60_000)} minute(s) longer than expected.
          The chart stops where the records do; it does not say the limits stopped changing.
        </p>
      ) : null}
      {plot.clockRegressions.length > 0 ? (
        <p className="tw:mt-2 tw:text-xs" style={{ color: "var(--alarm)" }}>
          The box's clock went backwards during this period, so the series is broken there rather than reordered.
        </p>
      ) : null}
    </section>
  );
}
