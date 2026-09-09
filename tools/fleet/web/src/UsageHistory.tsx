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
function WindowLine({ plot, series, tone }: { plot: UsagePlot; series: UsagePlot["accounts"][number]["windows"][number]; tone: string }): ReactNode {
  const x = xOf(plot);
  const y = (pct: number): number => SERIES_H - (Math.max(0, Math.min(100, pct)) / 100) * SERIES_H;
  const cuts = series.breaks.map((b) => b.fromMs).sort((a, b) => a - b);
  const runs: { atMs: number; value: number }[][] = [[]];
  for (const point of series.points) {
    const broken = cuts.some((c) => c >= (runs.at(-1)?.at(-1)?.atMs ?? -Infinity) && c < point.atMs);
    if (broken && (runs.at(-1)?.length ?? 0) > 0) runs.push([]);
    runs.at(-1)?.push(point);
  }
  return (
    <>
      {runs
        .filter((run) => run.length > 0)
        .map((run, i) => (
          <polyline
            // biome-ignore lint/suspicious/noArrayIndexKey: runs have no identity beyond their order
            key={i}
            fill="none"
            stroke={tone}
            strokeWidth={1.5}
            points={run.map((p) => `${x(p.atMs)},${y(p.value)}`).join(" ")}
          />
        ))}
      {/* A single reading is a point rather than a line, and must still be visible. */}
      {runs
        .filter((run) => run.length === 1)
        .map((run) => (
          <circle key={run[0]?.atMs} cx={x(run[0]?.atMs ?? 0)} cy={y(run[0]?.value ?? 0)} r={2} fill={tone} />
        ))}
    </>
  );
}

export function UsageHistory({
  api,
  skew,
  refreshNonce,
}: {
  api: UsageHistoryApi;
  /** The box's clock against this browser's. Labels are the reader's own time. */
  skew: ClockSkew;
  refreshNonce: number;
}): ReactNode {
  const [view, setView] = useState<UsageHistoryView | null>(null);

  useEffect(() => {
    let live = true;
    void api.window(WINDOW_HOURS).then((next) => {
      if (live) setView(next);
    });
    return () => {
      live = false;
    };
  }, [api, refreshNonce]);

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

  return (
    <section className="tw:mt-6">
      <h3 className="tw:text-sm tw:font-medium">The last {WINDOW_HOURS} hours</h3>

      {/* THE EMPTY STATE CLAIMS NO "SINCE" IT CANNOT KNOW. An empty file has no
          first line; process start moves the claim on every restart; the
          checkpoint's own instant may predate the recorder by days. */}
      {!hasPoints ? (
        <p className="tw:text-sm tw:opacity-80">
          Nothing recorded in the last {WINDOW_HOURS} hours; this fills in as the recorder runs.
          {plot.unreadableLines > 0 ? ` ${plot.unreadableLines} line(s) could not be read.` : ""}
        </p>
      ) : null}

      {hasPoints ? (
        <>
          <svg
            viewBox={`0 0 ${PLOT_W} ${SERIES_H}`}
            preserveAspectRatio="none"
            className="tw:mt-2 tw:h-24 tw:w-full"
            role="img"
            aria-label={`Utilisation over the last ${WINDOW_HOURS} hours`}
          >
            <rect x={0} y={0} width={PLOT_W} height={SERIES_H} fill="var(--quiet-wash)" />
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

          <div className="tw:flex tw:flex-wrap tw:gap-x-4 tw:gap-y-1 tw:text-xs tw:opacity-80">
            {plot.accounts.flatMap((account) =>
              account.windows.map((series, i) => (
                <span key={`${account.accountUuid}-${series.window}`}>
                  <span style={{ color: WINDOW_TONES[i % WINDOW_TONES.length] }}>—</span> {series.window}
                  {plot.accounts.length > 1 ? ` · ${account.accountUuid.slice(0, 8)}` : ""}
                </span>
              )),
            )}
            <span>
              {clockLabel(plot.fromMs, skew)} – {clockLabel(plot.toMs, skew)}, as observed
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
              .filter((i) => !i.unplaced && i.fromMs !== null)
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
