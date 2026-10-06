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
   * For any row with a recorded slug and no id: a keyed hash that keeps two
   * recorded slugs apart without putting a title-derived slug in filter state.
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
  /**
   * `before_answer` or `mid_answer` on a failed row; null on an `ok` row, a
   * stopped one, and every row from before the column. The three failure
   * columns are src/call-failure.ts's.
   */
  failurePhase: string | null;
  /** A label from a closed list; never text from an error. */
  failureClass: string | null;
  /** The HTTP status, when a response arrived. */
  failureStatus: number | null;
  /** **Rows, and a row is one attempt**: a call retried once is two. */
  calls: number;
  /** Not disjoint from `settledCalls` — see `SpendGroup.unpricedCalls`. */
  unpricedCalls: number;
  computedCalls: number;
  settledCalls: number;
  /**
   * Attempts a retry loop of ours numbered (`attempt is not null`). The rest
   * can say nothing about retries: older rows, realtime, and the PDF reader's
   * and the embeddings' own loops.
   */
  counted: number;
  /** `attempt > 1`: a go that started because the one before it failed. */
  retries: number;
  /** The last go allowed, and it failed before its answer began. */
  gaveUp: number;
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
  /**
   * False when the account listing failed: every `email` is then null because
   * it could not be read, not because the account is gone.
   */
  emailsAvailable: boolean;
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
  /** `id` is an opaque keyed hash; the recorded slug is display text, never identity. */
  | { kind: "recorded"; ownerId: string; id: string }
  | { kind: "none" };

export function articleKeyOf(
  row: Pick<CostCubeGroup, "ownerId" | "articleId" | "articleSlug" | "recordedSlugHash">,
): ArticleKey {
  if (row.articleId !== null) return { kind: "article", id: row.articleId };
  if (row.recordedSlugHash !== null) {
    return { kind: "recorded", ownerId: row.ownerId, id: row.recordedSlugHash };
  }
  return { kind: "none" };
}

/** A stable string for an `ArticleKey`; the kind is in it, so kinds never collide. */
export function articleKeyString(key: ArticleKey): string {
  switch (key.kind) {
    case "article":
      return `article:${key.id}`;
    case "recorded":
      return `recorded:${key.ownerId}:${key.id}`;
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
  "failurePhase",
  "failureClass",
  "failureStatus",
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
      return row.articleSlug ?? `recorded article ${shortId(key.id)}`;
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

/** Null and the literal display text are different keys. */
function optional(value: string | null): { key: string; label: string } {
  return value === null
    ? { key: "missing", label: NOT_RECORDED }
    : { key: `value:${value}`, label: value };
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
      return optional(row.upstream);
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
    case "failurePhase": {
      const value = optional(row.failurePhase);
      return { key: value.key, label: FAILURE_PHASE_LABEL[value.label] ?? value.label };
    }
    case "failureClass":
      return optional(row.failureClass);
    case "failureStatus":
      return optional(row.failureStatus === null ? null : String(row.failureStatus));
    default:
      return unreachable(dim);
  }
}

/** The two phases in words. A value the list does not know is shown as stored. */
const FAILURE_PHASE_LABEL: Readonly<Record<string, string>> = {
  before_answer: "before the answer began",
  mid_answer: "part-way through the answer",
};

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

/* --------------------------------------------------- failures and retries -- */

/**
 * **Counts, never rates** — GPT Sol's F5 on plan 261006b. A ledger row is an
 * attempt, not a call, and only some attempts were numbered, so there is no
 * honest denominator for a percentage. `counted` is shown beside the counts as
 * context.
 *
 * **Null is "not measured", which is not zero.** With no counted attempt
 * nothing could have recorded a retry, so a zero there would claim a quiet day
 * that nobody watched.
 */
export interface FailureCounts {
  /** Every ledger row. */
  attempts: number;
  /** Of those, the ones a retry loop of ours numbered. */
  counted: number;
  /** Goes after the first. Null when nothing was counted. */
  retries: number | null;
  /** Calls whose last allowed go failed before its answer began. Null when nothing was counted. */
  gaveUp: number | null;
  /**
   * Failed after the answer began, which is never retried. A row can record
   * this without being counted, so it is null only when nothing was counted
   * *and* none was recorded.
   */
  diedPartWay: number | null;
}

export function failureCountsOf(rows: readonly CostCubeGroup[]): FailureCounts {
  let attempts = 0;
  let counted = 0;
  let retries = 0;
  let gaveUp = 0;
  let diedPartWay = 0;
  for (const row of rows) {
    attempts += row.calls;
    counted += row.counted;
    retries += row.retries;
    gaveUp += row.gaveUp;
    if (row.outcome === "error" && row.failurePhase === "mid_answer") diedPartWay += row.calls;
  }
  const measured = counted > 0;
  return {
    attempts,
    counted,
    retries: measured ? retries : null,
    gaveUp: measured ? gaveUp : null,
    diedPartWay: measured || diedPartWay > 0 ? diedPartWay : null,
  };
}

export interface FailureGroup extends FailureCounts {
  key: string;
  label: string;
}

const trouble = (c: FailureCounts): number => (c.retries ?? 0) + (c.gaveUp ?? 0) + (c.diedPartWay ?? 0);
const byKey = (a: { key: string }, b: { key: string }): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * `FailureCounts` per value of one dimension: the most retries, give-ups and
 * part-way deaths first, then the most counted attempts.
 */
export function failureCountsBy(
  rows: readonly CostCubeRow[],
  dim: Dimension,
  owners?: OwnerEmails,
): FailureGroup[] {
  const groups = new Map<string, { label: string; rows: CostCubeRow[] }>();
  for (const row of rows) {
    const { key, label } = dimensionValue(row, dim, owners);
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { label, rows: [row] });
  }
  return [...groups]
    .map(([key, group]) => ({ key, label: group.label, ...failureCountsOf(group.rows) }))
    .sort((a, b) => trouble(b) - trouble(a) || b.counted - a.counted || byKey(a, b));
}

/** One cause: where the attempt failed, why, and on what. Every field but `attempts` is a label. */
export interface FailureCause {
  key: string;
  phase: string;
  failureClass: string;
  /** The HTTP status; `(not recorded)` when no response arrived. */
  status: string;
  upstream: string;
  model: string;
  /** Mode or task: `taskOf`. */
  task: string;
  attempts: number;
}

const CAUSE_DIMENSIONS = [
  "failurePhase",
  "failureClass",
  "failureStatus",
  "upstream",
  "model",
  "task",
] as const satisfies readonly Dimension[];

/**
 * Why attempts failed: every row that recorded a phase, grouped by phase,
 * class, status, upstream, model and task, the commonest first. A stopped row
 * and a row from before the columns record no phase and are not here.
 */
export function failureCauses(rows: readonly CostCubeRow[]): FailureCause[] {
  const causes = new Map<string, FailureCause>();
  for (const row of rows) {
    if (row.failurePhase === null) continue;
    const [phase, failureClass, status, upstream, model, task] = CAUSE_DIMENSIONS.map((dim) =>
      dimensionValue(row, dim),
    ) as [DimValue, DimValue, DimValue, DimValue, DimValue, DimValue];
    const key = JSON.stringify([phase.key, failureClass.key, status.key, upstream.key, model.key, task.key]);
    const cause = causes.get(key);
    if (cause) {
      cause.attempts += row.calls;
    } else {
      causes.set(key, {
        key,
        phase: phase.label,
        failureClass: failureClass.label,
        status: status.label,
        upstream: upstream.label,
        model: model.label,
        task: task.label,
        attempts: row.calls,
      });
    }
  }
  return [...causes.values()].sort((a, b) => b.attempts - a.attempts || byKey(a, b));
}

type DimValue = { key: string; label: string };

/**
 * What the section says about itself, on the page and in the report: the
 * limits of the counts, in plain words. docs/project/admin-costs.md § Failures
 * and retries.
 */
export const FAILURE_NOTES: readonly string[] = [
  "These are counts, not rates. Each row of the ledger is one attempt, not one call: a call that was retried once is two rows.",
  "Only attempts numbered by our retry loop are counted. Where none was, the figure is shown as not measured, which is not zero: that covers every call made before this was recorded.",
  "Stalls are not measured. When our own clock stops a provider that has gone silent, the row is recorded as stopped, the same as a reader pressing Stop.",
  "The PDF reader and the embeddings retry in loops of their own, and those retries are not counted here.",
];

/** The three counts, defined once for both readers. */
export const FAILURE_DEFINITIONS =
  "A retry is a go after the first, started because the one before failed before its answer began. " +
  "A call gave up when its last go failed that way too. " +
  "An attempt died part-way when it failed after its answer had begun, which is never asked again.";

/** What a null `FailureCounts` figure is drawn as. */
export const NOT_MEASURED = "not measured";

const things = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The totals as a sentence or two. Counts beside the counted attempts; never a share. */
export function failureSummary(total: FailureCounts): string {
  const died =
    total.diedPartWay === null ? "" : ` ${things(total.diedPartWay, "attempt")} died part-way.`;
  if (total.retries === null || total.gaveUp === null) {
    const none = `one of the ${things(total.attempts, "attempt")} was numbered by our retry loop`;
    return total.diedPartWay === null
      ? `Not measured: n${none}.`
      : `N${none}, so retries and give-ups are not measured.${died}`;
  }
  return (
    `Of ${things(total.attempts, "attempt")}, ${total.counted.toLocaleString("en-US")} ${total.counted === 1 ? "was" : "were"} numbered by our retry loop: ` +
    `${things(total.retries, "retry", "retries")} and ${things(total.gaveUp, "call")} that gave up after the last go.${died}`
  );
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
