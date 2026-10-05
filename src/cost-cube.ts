/**
 * **The cost cube, as the browser and the analysis script both read it** — the
 * wire shape of `GET /api/admin/costs` and the pure functions that filter,
 * group and pivot it.
 * docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md.
 *
 * One query groups the ledger (`spendCube` in src/store/ai-calls-spend-pg.ts);
 * everything the page or a report shows is a view of those rows through the
 * functions here, so a figure in one cannot come from a second definition.
 *
 * **Imported by the browser**, so it imports `step-order.js` and nothing else
 * (tests/client-imports.test.ts). That is why `category` is a string the server
 * fills in: src/cost-categories.ts reaches the pipeline.
 *
 * ## What the rows do not claim — GPT Sol, plan review
 *
 * - No token or duration figure: the wires do not mean the same thing by
 *   "input tokens", and summed duration is not elapsed time.
 * - A row with an `articleId` is that article. A row without one carries only a
 *   recorded name, which a deleted article's successor can reuse, so it is
 *   never claimed to be one article (`articleKeyOf`).
 * - No other owner's slug: `articleSlug` is the administrator's own only.
 */

import { currentStepName } from "./step-order.js";

/* ------------------------------------------------------------ the shapes -- */

/** The three money pockets, never pre-added — src/store/ai-calls.ts § `totalRows`. */
export interface MoneyPockets {
  /** What OpenRouter deducted. */
  creditsNanos: number;
  /** Billed to somebody else's key. */
  byokNanos: number;
  /** Our own arithmetic over a price table. */
  computedNanos: number;
}

/** One group of the ledger, as `spendCube` returns it. */
export interface CostCubeGroup extends MoneyPockets {
  /** `YYYY-MM-DD`, the UTC day of `started_at`. */
  day: string;
  ownerId: string;
  /** Opaque. Null once the article is deleted, or when it never resolved. */
  articleId: string | null;
  /** **The administrator's own articles only**; null on anybody else's row. */
  articleSlug: string | null;
  /**
   * For another owner's row with a recorded slug and no id: a short hash that
   * keeps two recorded slugs apart without saying what either is.
   */
  recordedSlugHash: string | null;
  scopeKind: string;
  /** `ai_calls.purpose`. */
  job: string;
  stepName: string | null;
  wire: string;
  requestedModel: string;
  /** Not always the one asked for. */
  answeredModel: string | null;
  upstream: string | null;
  providerAccount: string;
  costSource: string;
  isByok: boolean | null;
  /** `ok`, `error` or `aborted`. */
  outcome: string;
  calls: number;
  /** Not disjoint from `settledCalls` — see `SpendGroup.unpricedCalls`. */
  unpricedCalls: number;
  computedCalls: number;
  settledCalls: number;
}

export interface CostCubeRow extends CostCubeGroup {
  /** src/cost-categories.ts § `costCategoryOf`, computed on the server. */
  category: string;
}

/** `GET /api/admin/costs`. */
export interface AdminCosts {
  /** ISO, inclusive; null for no lower bound. */
  since: string | null;
  /** ISO, exclusive; null for no upper bound. */
  until: string | null;
  /** The window in words, so no figure is shown without its period. */
  label: string;
  rows: CostCubeRow[];
  /** Every owner in `rows`. `email: null` when the Auth service has no such account. */
  owners: { id: string; email: string | null }[];
}

/* ------------------------------------------------------------- the money -- */

/**
 * **Recorded ledger amount**: the three pockets added. A floor wherever there
 * are unpriced calls.
 */
export function recordedNanos(t: MoneyPockets): number {
  return t.creditsNanos + t.byokNanos + t.computedNanos;
}

/**
 * **What OpenRouter's cut adds on top of the credits figure** — the difference
 * between the ledger and a bank statement.
 *
 * Their fee is charged on *buying credits*, not per token: about 5.5% on a card
 * purchase, with a minimum, and different again for crypto. So a row's settled
 * `usage.cost` is a credits figure, and the cash it took to put those credits
 * there is roughly 5.5% more.
 *
 * **This is allocated in the report and never written to a row.** Multiplying
 * each stored cost by 1.055 would put an estimate in a column built to hold
 * settled figures — the exact thing drizzle/0023's cost-provenance design
 * exists to prevent — and would invent a precision that can never match a
 * statement, because the fee has a floor and does not divide evenly over calls.
 * Greg asked to see both figures (2026-09-02); this is the "both".
 *
 * It applies to **credits only**. A BYOK row was billed to somebody else's key
 * and never touched our credit balance, and a `computed` row went straight to
 * Anthropic or OpenAI without passing OpenRouter at all. Applying the uplift to
 * those would be charging ourselves a fee twice for money that never bought a
 * credit.
 *
 * Here rather than in src/cost-report.ts, which re-exports it, because the
 * browser needs it and that module reaches the spend collector.
 */
export const OPENROUTER_CREDIT_FEE = 0.055;

/** Credits plus the fee it took to buy them, with the other pockets untouched. */
export function estimatedCashNanos(t: MoneyPockets): number {
  return Math.round(t.creditsNanos * (1 + OPENROUTER_CREDIT_FEE)) + t.byokNanos + t.computedNanos;
}

/* ------------------------------------------------------------ the naming -- */

/**
 * **Mode or task**: the pipeline step for step work, the job otherwise, read
 * through the rename table. Not "mode" alone — `chat` and `dig-deeper-search`
 * are jobs, not modes.
 */
export function taskOf(row: { job: string; stepName: string | null }): string {
  return currentStepName(row.stepName ?? row.job);
}

/** The model that answered, else the one asked for. */
export function modelOf(row: { requestedModel: string; answeredModel: string | null }): string {
  return row.answeredModel ?? row.requestedModel;
}

/** Which article a row is, or only what it was recorded as. */
export type ArticleKey =
  | { kind: "article"; id: string }
  /** `label` is the administrator's own slug, or another owner's hash. */
  | { kind: "recorded"; ownerId: string; label: string }
  | { kind: "none" };

export function articleKeyOf(
  row: Pick<CostCubeGroup, "ownerId" | "articleId" | "articleSlug" | "recordedSlugHash">,
): ArticleKey {
  if (row.articleId !== null) return { kind: "article", id: row.articleId };
  const label = row.articleSlug ?? row.recordedSlugHash;
  if (label !== null) return { kind: "recorded", ownerId: row.ownerId, label };
  return { kind: "none" };
}

/** A stable string for an `ArticleKey`; the kind is in it, so kinds never collide. */
export function articleKeyString(key: ArticleKey): string {
  switch (key.kind) {
    case "article":
      return `article:${key.id}`;
    case "recorded":
      return `recorded:${key.ownerId}:${key.label}`;
    case "none":
      return "none";
    default:
      return unreachable(key);
  }
}

function unreachable(value: never): never {
  throw new Error(`unhandled case: ${JSON.stringify(value)}`);
}

/* -------------------------------------------------------- the dimensions -- */

export const DIMENSIONS = [
  "user",
  "article",
  "task",
  "category",
  "model",
  "requestedModel",
  "upstream",
  "scope",
  "outcome",
  "wire",
  "account",
  "day",
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

/** Owner id → email, from `AdminCosts.owners`. */
export type OwnerEmails = ReadonlyMap<string, string | null>;

/** The key of a value the ledger did not record. */
const NOT_RECORDED = "(not recorded)";

function shortId(id: string): string {
  return id.slice(0, 8);
}

function articleLabel(row: CostCubeRow, key: ArticleKey): string {
  switch (key.kind) {
    case "article":
      return row.articleSlug ?? `article ${shortId(key.id)}`;
    case "recorded":
      return `recorded as ${key.label}`;
    case "none":
      return "no article";
    default:
      return unreachable(key);
  }
}

function same(value: string | null): { key: string; label: string } {
  const key = value ?? NOT_RECORDED;
  return { key, label: key };
}

/**
 * A row's value on one dimension: `key` to group and filter by (ids, never an
 * email), `label` to show.
 */
export function dimensionValue(
  row: CostCubeRow,
  dim: Dimension,
  owners?: OwnerEmails,
): { key: string; label: string } {
  switch (dim) {
    case "user":
      return { key: row.ownerId, label: owners?.get(row.ownerId) ?? shortId(row.ownerId) };
    case "article": {
      const key = articleKeyOf(row);
      return { key: articleKeyString(key), label: articleLabel(row, key) };
    }
    case "task":
      return same(taskOf(row));
    case "category":
      return same(row.category);
    case "model":
      return same(modelOf(row));
    case "requestedModel":
      return same(row.requestedModel);
    case "upstream":
      return same(row.upstream);
    case "scope":
      return same(row.scopeKind);
    case "outcome":
      return same(row.outcome);
    case "wire":
      return same(row.wire);
    case "account":
      return same(row.providerAccount);
    case "day":
      return same(row.day);
    default:
      return unreachable(dim);
  }
}

/* ------------------------------------------------- filter, group, pivot -- */

/** For each named dimension, the keys a row may have. An empty list matches nothing. */
export type CubeFilters = Partial<Record<Dimension, readonly string[]>>;

export function filterRows(rows: readonly CostCubeRow[], filters: CubeFilters): CostCubeRow[] {
  const active = DIMENSIONS.flatMap((dim) => {
    const keys = filters[dim];
    return keys ? [{ dim, keys: new Set(keys) }] : [];
  });
  return rows.filter((row) => active.every(({ dim, keys }) => keys.has(dimensionValue(row, dim).key)));
}

/** What a set of rows adds up to. */
export interface CubeTotals extends MoneyPockets {
  calls: number;
  /** The three pockets added. */
  recordedNanos: number;
  unpricedCalls: number;
  /** `calls − unpricedCalls` — the only honest denominator for an amount per call. */
  pricedCalls: number;
  /** `outcome <> 'ok'`. Their money is in every figure above as well. */
  failedCalls: number;
  failedRecordedNanos: number;
  computedCalls: number;
  settledCalls: number;
}

function noTotals(): CubeTotals {
  return {
    calls: 0,
    creditsNanos: 0,
    byokNanos: 0,
    computedNanos: 0,
    recordedNanos: 0,
    unpricedCalls: 0,
    pricedCalls: 0,
    failedCalls: 0,
    failedRecordedNanos: 0,
    computedCalls: 0,
    settledCalls: 0,
  };
}

function add(into: CubeTotals, row: CostCubeGroup): void {
  const recorded = recordedNanos(row);
  into.calls += row.calls;
  into.creditsNanos += row.creditsNanos;
  into.byokNanos += row.byokNanos;
  into.computedNanos += row.computedNanos;
  into.recordedNanos += recorded;
  into.unpricedCalls += row.unpricedCalls;
  into.pricedCalls += row.calls - row.unpricedCalls;
  into.computedCalls += row.computedCalls;
  into.settledCalls += row.settledCalls;
  if (row.outcome !== "ok") {
    into.failedCalls += row.calls;
    into.failedRecordedNanos += recorded;
  }
}

export function totalsOf(rows: readonly CostCubeGroup[]): CubeTotals {
  const totals = noTotals();
  for (const row of rows) add(totals, row);
  return totals;
}

/**
 * Recorded amount per **priced** call, or null when none was priced. Dividing
 * by all calls would let unpriced ones make the rest look cheap.
 */
export function amountPerPricedCall(
  totals: Pick<CubeTotals, "recordedNanos" | "pricedCalls">,
): number | null {
  return totals.pricedCalls > 0 ? totals.recordedNanos / totals.pricedCalls : null;
}

export interface CubeGroup extends CubeTotals {
  key: string;
  label: string;
}

/** Largest recorded amount first; the key breaks a tie so the order is stable. */
function byAmount(a: CubeGroup, b: CubeGroup): number {
  return b.recordedNanos - a.recordedNanos || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/** Totals per value of one dimension, largest recorded amount first. */
export function groupRows(
  rows: readonly CostCubeRow[],
  dim: Dimension,
  owners?: OwnerEmails,
): CubeGroup[] {
  const groups = new Map<string, CubeGroup>();
  for (const row of rows) {
    const { key, label } = dimensionValue(row, dim, owners);
    let group = groups.get(key);
    if (!group) {
      group = { key, label, ...noTotals() };
      groups.set(key, group);
    }
    add(group, row);
  }
  return [...groups.values()].sort(byAmount);
}

export interface CubePivot {
  rows: CubeGroup[];
  columns: CubeGroup[];
  /** Row key → column key → totals. A pair with no ledger rows has no cell. */
  cells: Map<string, Map<string, CubeTotals>>;
  total: CubeTotals;
}

/** Two dimensions against each other, with both sets of totals and the grand total. */
export function pivotRows(
  rows: readonly CostCubeRow[],
  rowDim: Dimension,
  colDim: Dimension,
  owners?: OwnerEmails,
): CubePivot {
  const cells = new Map<string, Map<string, CubeTotals>>();
  for (const row of rows) {
    const rowKey = dimensionValue(row, rowDim, owners).key;
    const colKey = dimensionValue(row, colDim, owners).key;
    let across = cells.get(rowKey);
    if (!across) {
      across = new Map();
      cells.set(rowKey, across);
    }
    let cell = across.get(colKey);
    if (!cell) {
      cell = noTotals();
      across.set(colKey, cell);
    }
    add(cell, row);
  }
  return {
    rows: groupRows(rows, rowDim, owners),
    columns: groupRows(rows, colDim, owners),
    cells,
    total: totalsOf(rows),
  };
}

/* ------------------------------------------------------------ the window -- */

export type CostWindow =
  | { ok: true; since: string | null; until: string | null }
  | { ok: false; message: string };

const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/** A UTC instant as `toISOString` writes it, or null. Refuses a date that rolls over. */
function utcInstant(text: string): string | null {
  if (!UTC_INSTANT.test(text)) return null;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  const iso = new Date(ms).toISOString();
  return iso === (text.includes(".") ? text : text.replace("Z", ".000Z")) ? iso : null;
}

/**
 * `?since=&until=` of `GET /api/admin/costs`: `[since, until)`, each a UTC
 * instant or absent. Strict, because a bound read loosely is a total over a
 * period nobody asked for.
 */
export function parseCostWindow(since: string | null, until: string | null): CostWindow {
  const bounds: { since: string | null; until: string | null } = { since: null, until: null };
  for (const [name, text] of [
    ["since", since],
    ["until", until],
  ] as const) {
    if (text === null) continue;
    const iso = utcInstant(text);
    if (iso === null) {
      return {
        ok: false,
        message: `${name} must be a UTC instant such as 2026-10-01T00:00:00.000Z, or left out.`,
      };
    }
    bounds[name] = iso;
  }
  if (bounds.since !== null && bounds.until !== null && bounds.since >= bounds.until) {
    return { ok: false, message: "since must be earlier than until." };
  }
  return { ok: true, ...bounds };
}

/** The window in words. UTC, and the end is not included. */
export function costWindowLabel(since: string | null, until: string | null): string {
  if (since === null && until === null) return "all recorded calls";
  if (until === null) return `from ${since} (UTC)`;
  if (since === null) return `before ${until} (UTC)`;
  return `from ${since} to before ${until} (UTC)`;
}
