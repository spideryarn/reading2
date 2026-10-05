/**
 * The pure half of `/admin/costs` that is about *showing* the cube: the
 * periods, the product-scope switch, the money formatter, the "Other" fold and
 * the per-day series. No React, no nuqs, no browser — the analysis script
 * (plan 261005a stage 3) imports this beside [cost-charts.tsx](cost-charts.tsx).
 *
 * The arithmetic itself is [src/cost-cube.ts](../cost-cube.ts); nothing here
 * re-derives a figure that module already defines.
 */
import { formatSpendNanos } from "../admin.js";
import {
  type CostCubeRow,
  type CubeGroup,
  type Dimension,
  type OwnerEmails,
  dimensionValue,
  groupRows,
  pivotRows,
} from "../cost-cube.js";

/* ------------------------------------------------------- the dimensions -- */

/** The dimensions the page offers, in the order the selects list them. */
export const PAGE_DIMENSIONS = [
  "user",
  "article",
  "task",
  "category",
  "model",
  "upstream",
  "scope",
  "outcome",
  "day",
] as const satisfies readonly Dimension[];

export type PageDimension = (typeof PAGE_DIMENSIONS)[number];

export function isPageDimension(value: string): value is PageDimension {
  return (PAGE_DIMENSIONS as readonly string[]).includes(value);
}

export const DIMENSION_LABEL: Record<PageDimension, string> = {
  user: "User",
  article: "Article",
  task: "Mode or task",
  category: "Category",
  model: "Model",
  upstream: "Upstream",
  scope: "Scope",
  outcome: "Outcome",
  day: "Day",
};

/** What the per-day chart stacks by when "then by" is none. */
export const DEFAULT_STACK: PageDimension = "category";

/**
 * Where a click on a row moves "group by": user → article → mode or task →
 * model. From anywhere else the grouping stays and only the filter is added.
 */
export function nextDrillDimension(dim: PageDimension): PageDimension {
  switch (dim) {
    case "user":
      return "article";
    case "article":
      return "task";
    case "task":
      return "model";
    default:
      return dim;
  }
}

/* ------------------------------------------------------------ the scope -- */

/** Product spend. Evals and the dev CLI are the other two scopes. */
export const PRODUCT_SCOPES: readonly string[] = ["request", "job_step"];

export function scopedRows(rows: readonly CostCubeRow[], includeEvalsAndCli: boolean): CostCubeRow[] {
  return includeEvalsAndCli ? [...rows] : rows.filter((r) => PRODUCT_SCOPES.includes(r.scopeKind));
}

/* ----------------------------------------------------------- the period -- */

export const PERIODS = ["this-month", "last-month", "7d", "30d", "all"] as const;
export type Period = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: Period = "this-month";

export const PERIOD_LABEL: Record<Period, string> = {
  "this-month": "This month",
  "last-month": "Last month",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All",
};

const DAY_MS = 86_400_000;

function utcDayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/**
 * `[since, until)` for a period, as the UTC instants `parseCostWindow` accepts.
 * "Last 7 days" is today and the six UTC days before it.
 */
export function periodWindow(
  period: Period,
  nowMs: number,
): { since: string | null; until: string | null } {
  const now = new Date(nowMs);
  const month = (offset: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString();
  const tomorrow = utcDayStart(nowMs) + DAY_MS;
  switch (period) {
    case "this-month":
      return { since: month(0), until: month(1) };
    case "last-month":
      return { since: month(-1), until: month(0) };
    case "7d":
      return { since: new Date(tomorrow - 7 * DAY_MS).toISOString(), until: new Date(tomorrow).toISOString() };
    case "30d":
      return { since: new Date(tomorrow - 30 * DAY_MS).toISOString(), until: new Date(tomorrow).toISOString() };
    case "all":
      return { since: null, until: null };
    default:
      return unreachable(period);
  }
}

function unreachable(value: never): never {
  throw new Error(`unhandled case: ${JSON.stringify(value)}`);
}

/**
 * Every UTC day the chart draws, `YYYY-MM-DD`, oldest first: the window, cut at
 * today (no call can have happened later), and widened to any day the rows
 * carry so none is dropped. An open end takes the first or last day with data.
 */
export function daysInWindow(
  since: string | null,
  until: string | null,
  rows: readonly Pick<CostCubeRow, "day">[],
  nowMs: number,
): string[] {
  const dataDays = rows.map((r) => Date.parse(`${r.day}T00:00:00.000Z`)).filter(Number.isFinite);
  const firstData = dataDays.length ? Math.min(...dataDays) : null;
  const lastData = dataDays.length ? Math.max(...dataDays) : null;
  const today = utcDayStart(nowMs);

  let start = since === null ? firstData : utcDayStart(Date.parse(since));
  /* `until` is exclusive, so its last day is the one before it. */
  let end = until === null ? lastData : Math.min(utcDayStart(Date.parse(until) - 1), today);
  if (start !== null && firstData !== null) start = Math.min(start, firstData);
  if (end !== null && lastData !== null) end = Math.max(end, lastData);
  if (start === null || end === null || end < start) return [];

  const days: string[] = [];
  for (let at = start; at <= end; at += DAY_MS) days.push(new Date(at).toISOString().slice(0, 10));
  return days;
}

/* ------------------------------------------------------------ the money -- */

/** One ten-thousandth of a dollar: the smallest figure drawn as itself. */
const SMALLEST_DRAWN_NANOS = 100_000;

/**
 * **The page's one money formatter**: two decimals from a dollar up, up to
 * four below, and `<$0.0001` for a real cost smaller than that — never a
 * free-looking zero.
 *
 * Built on `formatSpendNanos` rather than writing a currency sign of its own:
 * src/admin.ts is the one module tests/no-ai-cost-for-readers.test.ts allows
 * to. The honest home for this function is beside it.
 */
export function formatCostNanos(nanos: number): string {
  if (nanos > 0 && nanos < SMALLEST_DRAWN_NANOS) return `<${formatSpendNanos(SMALLEST_DRAWN_NANOS)}`;
  /* 0.99995 and up would print as 1.0000 at four decimals. */
  if (nanos === 0 || nanos >= 999_950_000) {
    const cents = Math.round(nanos / 1e7);
    return formatSpendNanos(cents * 1e7).slice(0, -2);
  }
  /* Four decimals, less any trailing zeros past the cents. */
  return formatSpendNanos(nanos).replace(/(\.\d{2}\d*?)0+$/, (_all, kept: string) => kept);
}

/** A group's recorded amount, or an em dash when no call in it was priced. */
export function amountText(totals: { recordedNanos: number; pricedCalls: number }): string {
  return totals.pricedCalls > 0 ? formatCostNanos(totals.recordedNanos) : "—";
}

/** A recorded amount, marked as a floor when the same aggregate contains an unpriced call. */
export function amountWithFloor(totals: {
  recordedNanos: number;
  calls: number;
  pricedCalls: number;
}): string {
  const marker = totals.calls > totals.pricedCalls && totals.pricedCalls > 0 ? "+" : "";
  return `${amountText(totals)}${marker}`;
}

/** A share of a total as a whole percentage; a real share under one is `<1%`. */
export function formatShare(part: number, total: number): string {
  if (total <= 0) return "—";
  const percent = (part / total) * 100;
  if (part > 0 && percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

const SHADE_STEPS = 9;
const SHADE_MIN = 0.08;
const SHADE_MAX = 0.45;

/**
 * How strongly a pivot cell is shaded: an alpha in nine steps from 0.08 (the
 * smallest real amount) to 0.45 (the largest in the table), or null for a cell
 * with nothing in it. One hue, with the amount in the alpha, because a
 * multi-hue ramp at low alpha reads as categories rather than as more.
 */
export function shadeAlpha(nanos: number, largest: number): number | null {
  if (nanos <= 0 || largest <= 0) return null;
  const step = Math.round(Math.min(1, nanos / largest) * (SHADE_STEPS - 1));
  const alpha = SHADE_MIN + (step / (SHADE_STEPS - 1)) * (SHADE_MAX - SHADE_MIN);
  return Math.round(alpha * 1000) / 1000;
}

/* ------------------------------------------------------- the Other fold -- */

/** The folded column's preferred key; `foldedPivot` suffixes it if a real value collides. */
export const OTHER_KEY = "__other__";
export const OTHER_LABEL = "Other";

/** What a pivot cell, a row total or a column total shows. */
export interface FoldedCell {
  recordedNanos: number;
  calls: number;
  pricedCalls: number;
}

export interface FoldedColumn extends FoldedCell {
  key: string;
  label: string;
}

export interface FoldedPivot {
  rows: CubeGroup[];
  /** Largest first, then "Other" last when anything was folded. */
  columns: FoldedColumn[];
  /** Row key → column key → cell. A pair with no ledger rows has no cell. */
  cells: Map<string, Map<string, FoldedCell>>;
  total: FoldedCell;
  /** The synthetic folded column, disjoint from every real dimension key. */
  otherKey: string | null;
}

function plus(into: FoldedCell, from: FoldedCell): void {
  into.recordedNanos += from.recordedNanos;
  into.calls += from.calls;
  into.pricedCalls += from.pricedCalls;
}

/**
 * Two dimensions against each other, keeping the `keep` largest columns and
 * **adding the rest into "Other"** — folded, never dropped, so every row still
 * sums to its total and the columns to the grand total.
 */
export function foldedPivot(
  rows: readonly CostCubeRow[],
  rowDim: Dimension,
  colDim: Dimension,
  keep: number,
  owners?: OwnerEmails,
): FoldedPivot {
  const pivot = pivotRows(rows, rowDim, colDim, owners);
  const kept = pivot.columns.slice(0, keep);
  const folded = pivot.columns.slice(keep);
  const keptKeys = new Set(kept.map((c) => c.key));
  const allKeys = new Set(pivot.columns.map((c) => c.key));
  let otherKey: string | null = null;
  if (folded.length > 0) {
    otherKey = OTHER_KEY;
    for (let suffix = 1; allKeys.has(otherKey); suffix++) otherKey = `${OTHER_KEY}:${suffix}`;
  }

  const columns: FoldedColumn[] = kept.map((c) => ({
    key: c.key,
    label: c.label,
    recordedNanos: c.recordedNanos,
    calls: c.calls,
    pricedCalls: c.pricedCalls,
  }));
  if (otherKey !== null) {
    const other: FoldedColumn = { key: otherKey, label: OTHER_LABEL, recordedNanos: 0, calls: 0, pricedCalls: 0 };
    for (const c of folded) plus(other, c);
    columns.push(other);
  }

  const cells = new Map<string, Map<string, FoldedCell>>();
  for (const [rowKey, across] of pivot.cells) {
    const out = new Map<string, FoldedCell>();
    for (const [colKey, cell] of across) {
      const key = keptKeys.has(colKey) ? colKey : otherKey;
      if (key === null) throw new Error("a folded pivot has no Other key");
      let into = out.get(key);
      if (!into) {
        into = { recordedNanos: 0, calls: 0, pricedCalls: 0 };
        out.set(key, into);
      }
      plus(into, cell);
    }
    cells.set(rowKey, out);
  }

  return {
    rows: pivot.rows,
    columns,
    cells,
    total: {
      recordedNanos: pivot.total.recordedNanos,
      calls: pivot.total.calls,
      pricedCalls: pivot.total.pricedCalls,
    },
    otherKey,
  };
}

/* ------------------------------------------------------- the day series -- */

/** The most series the per-day chart draws, "Other" included. */
export const MAX_CHART_SERIES = 8;

export interface DaySeries {
  /** Every day on the x axis, oldest first, empty ones included. */
  days: string[];
  /** Largest first, "Other" last. */
  series: { key: string; label: string; isOther?: boolean }[];
  /** Day → series key → recorded nano-dollars. */
  values: Map<string, Map<string, number>>;
}

/**
 * `rows` by UTC day against `stackDim`, folded to what the chart can colour:
 * more than eight series puts the smallest into "Other", which is itself one.
 * The chart and the table under it both read this, so they cannot disagree.
 */
export function dayPivot(
  rows: readonly CostCubeRow[],
  stackDim: Dimension,
  owners?: OwnerEmails,
): FoldedPivot {
  const distinct = groupRows(rows, stackDim, owners).length;
  const keep = distinct > MAX_CHART_SERIES ? MAX_CHART_SERIES - 1 : MAX_CHART_SERIES;
  const pivot = foldedPivot(rows, "day", stackDim, keep, owners);
  /* A calendar reads oldest first, not largest first. */
  return {
    ...pivot,
    rows: [...pivot.rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  };
}

/** The per-day chart's data, from `dayPivot` and the days to draw. */
export function daySeries(pivot: FoldedPivot, days: readonly string[]): DaySeries {
  const values = new Map<string, Map<string, number>>();
  for (const [day, across] of pivot.cells) {
    values.set(day, new Map([...across].map(([key, cell]) => [key, cell.recordedNanos])));
  }
  return {
    days: [...days],
    series: pivot.columns.map((c) => ({ key: c.key, label: c.label, isOther: c.key === pivot.otherKey })),
    values,
  };
}

/**
 * Every key a dimension takes across `rows`, alphabetically — **the order
 * colours are handed out in**. Taken from the whole cube rather than the rows
 * on screen, so a filter never repaints the series that survive it.
 */
export function colourOrder(rows: readonly CostCubeRow[], dim: Dimension): string[] {
  return [...new Set(rows.map((r) => dimensionValue(r, dim).key))].sort();
}

/* ----------------------------------------------------------- the labels -- */

/** What a filter's key is called on its chip, from the cube; the key itself if no row has it. */
export function labelForKey(
  rows: readonly CostCubeRow[],
  dim: Dimension,
  key: string,
  owners?: OwnerEmails,
): string {
  for (const row of rows) {
    const value = dimensionValue(row, dim, owners);
    if (value.key === key) return value.label;
  }
  return key;
}

/** Article key → the owner it belongs to, so an opaque article can be told apart. */
export function articleOwners(rows: readonly CostCubeRow[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const row of rows) {
    /* "No article" is every owner's, so it has no one owner to name. */
    if (row.articleId === null && row.articleSlug === null && row.recordedSlugHash === null) continue;
    owners.set(dimensionValue(row, "article").key, row.ownerId);
  }
  return owners;
}
