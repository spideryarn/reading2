/**
 * The charts of `/admin/costs`: a stacked bar per UTC day, its legend, and the
 * inline bar of a ranking row. Hand-written, no chart library — plan 261005a
 * § Charts and tables.
 *
 * **Pure, and styled without a stylesheet.** The analysis report renders these
 * same components with `renderToStaticMarkup` into a standalone file that has
 * no Tailwind, so everything here is an SVG/HTML attribute or an inline `style`
 * reading a CSS custom property — no `tw:` class, no hook, no hex. `CHART_TOKENS`
 * is every property read, so the report can define exactly those; a test holds
 * the list to the markup (tests/cost-charts.test.tsx).
 */
import type { CSSProperties } from "react";

import { type DaySeries, OTHER_KEY, formatCostNanos } from "./admin-costs-view.js";

/** How many categorical hues are handed out before they repeat — colour-scales.md. */
const HUES = 8;

/** Every CSS custom property this file reads. */
export const CHART_TOKENS: readonly string[] = [
  "--background",
  "--border",
  "--muted",
  "--muted-foreground",
  ...Array.from({ length: HUES }, (_, i) => `--cat-${i}`),
];

const TEXT = "var(--muted-foreground)";
const HAIRLINE = "var(--border)";
const SURFACE = "var(--background)";

/**
 * A series' colour: its place among `colourKeys` (already in a fixed order —
 * `colourOrder` sorts them), so the same entity keeps its hue whatever else is
 * on screen. "Other" is neutral. Past eight entities the hues repeat.
 */
export function seriesColour(key: string, colourKeys: readonly string[]): string {
  if (key === OTHER_KEY) return TEXT;
  const at = colourKeys.indexOf(key);
  return `var(--cat-${(at === -1 ? 0 : at) % HUES})`;
}

/* ---------------------------------------------------------------- legend -- */

const LEGEND: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "4px 14px",
  margin: "8px 0 0",
  padding: 0,
  listStyle: "none",
  fontSize: "12px",
  color: TEXT,
};

export function ChartLegend({
  series,
  colourKeys,
}: {
  series: readonly { key: string; label: string }[];
  colourKeys: readonly string[];
}) {
  return (
    <ul data-chart-legend="" style={LEGEND}>
      {series.map((s) => (
        <li key={s.key} data-series={s.key} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <span
            aria-hidden="true"
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "2px",
              flex: "none",
              background: seriesColour(s.key, colourKeys),
            }}
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------- rank bar -- */

/** A ranking row's bar: `share` of the largest row, 0 to 1. */
export function RankBar({ share }: { share: number }) {
  const percent = Math.max(0, Math.min(1, share)) * 100;
  return (
    <div
      data-rank-bar=""
      aria-hidden="true"
      style={{ height: "6px", borderRadius: "3px", background: "var(--muted)", overflow: "hidden" }}
    >
      <div style={{ width: `${percent}%`, height: "100%", borderRadius: "3px", background: "var(--cat-0)" }} />
    </div>
  );
}

/* ----------------------------------------------------------- stacked bars -- */

export const MAX_BAR_WIDTH = 24;
const WIDTH = 640;
const HEIGHT = 240;
const LEFT = 56;
const RIGHT = 8;
const TOP = 12;
const BOTTOM = 26;
const GAP = 2;
const RADIUS = 4;

/** A step of 1, 2, 2.5 or 5 times a power of ten, at least `raw`. */
function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/** A bar segment with only its top corners rounded. */
function roundedTop(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Recorded amount per UTC day, stacked by series. One y axis; every day in
 * `data.days` gets its place, with or without spend.
 */
export function StackedDayChart({
  data,
  colourKeys,
  label,
}: {
  data: DaySeries;
  /** The fixed order colours are assigned in — `colourOrder`. */
  colourKeys: readonly string[];
  /** The chart's accessible name. */
  label: string;
}) {
  const { days, series, values } = data;
  const dayTotal = (day: string) =>
    series.reduce((n, s) => n + (values.get(day)?.get(s.key) ?? 0), 0);
  const max = Math.max(1, ...days.map(dayTotal));
  const step = niceStep(max / 3);
  const tickCount = Math.ceil(max / step);
  const top = tickCount * step;

  const plotW = WIDTH - LEFT - RIGHT;
  const plotH = HEIGHT - TOP - BOTTOM;
  const band = plotW / Math.max(1, days.length);
  const barW = Math.min(MAX_BAR_WIDTH, band * 0.72);
  const baseline = TOP + plotH;
  const yOf = (nanos: number) => baseline - (nanos / top) * plotH;
  /* About ten day labels at most, however long the window. */
  const labelEvery = Math.max(1, Math.ceil(days.length / 10));

  return (
    <div data-cost-chart="">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        style={{ display: "block", height: "auto", maxWidth: "100%" }}
      >
        {Array.from({ length: tickCount + 1 }, (_, i) => i * step).map((tick) => (
          <g key={tick} data-y-tick="">
            <line
              x1={LEFT}
              x2={WIDTH - RIGHT}
              y1={yOf(tick)}
              y2={yOf(tick)}
              stroke={HAIRLINE}
              strokeWidth={1}
              strokeOpacity={tick === 0 ? 1 : 0.5}
            />
            <text x={LEFT - 6} y={yOf(tick)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={TEXT}>
              {formatCostNanos(tick)}
            </text>
          </g>
        ))}

        {days.map((day, i) => {
          const x = LEFT + i * band + (band - barW) / 2;
          const parts = series
            .map((s) => ({ ...s, nanos: values.get(day)?.get(s.key) ?? 0 }))
            .filter((s) => s.nanos > 0);
          let below = 0;
          return (
            <g key={day} data-day={day}>
              {parts.map((part, at) => {
                const h = (part.nanos / top) * plotH;
                const y = yOf(below + part.nanos);
                below += part.nanos;
                const shared = {
                  "data-series": part.key,
                  "data-height": h,
                  fill: seriesColour(part.key, colourKeys),
                };
                const hover = `${part.label} · ${day} · ${formatCostNanos(part.nanos)}`;
                return at === parts.length - 1 ? (
                  <path key={part.key} {...shared} d={roundedTop(x, y, barW, h)}>
                    <title>{hover}</title>
                  </path>
                ) : (
                  <rect key={part.key} {...shared} x={x} y={y} width={barW} height={h}>
                    <title>{hover}</title>
                  </rect>
                );
              })}
              {/* The gap between stacked segments, in the surface's own colour. */}
              {parts.slice(0, -1).map((part, at) => {
                const upTo = parts.slice(0, at + 1).reduce((n, p) => n + p.nanos, 0);
                return <rect key={part.key} x={x} y={yOf(upTo) - GAP / 2} width={barW} height={GAP} fill={SURFACE} />;
              })}
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={baseline + 15} textAnchor="middle" fontSize={11} fill={TEXT}>
                  {day.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {series.length >= 2 && <ChartLegend series={series} colourKeys={colourKeys} />}
    </div>
  );
}
