/**
 * **The arithmetic behind the pricing report** — folds, spreads and the cash
 * uplift, with no I/O and no printing, so every number on the page can be
 * checked without a database or a terminal.
 *
 * `scripts/ai-cost.ts` reads the ledger and draws the tables; this decides what
 * the tables say. The split is the same one `src/store/pg-admin.ts` makes and
 * for the same reason: the two bugs this report has already had were both in
 * *what a number includes*, and neither showed up in a type.
 *
 * ## Why a spread and not an average
 *
 * Greg is setting a subscription price. An average over readers is the one
 * statistic that cannot inform that decision, because the readers who lose money
 * are in the tail: a median tells you what the typical account costs, a p95 tells
 * you what you are underwriting, and a max tells you what a single account has
 * already managed. GPT Sol cut p90 as surplus at alpha scale, and that cut
 * stands.
 */

import type { SpendGroup } from "./store/ai-calls-spend-pg.js";
import {
  type CostCategory,
  assertCategoriesCoverRows,
  costCategoryOf,
  describeFacts,
} from "./cost-categories.js";

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
 */
export const OPENROUTER_CREDIT_FEE = 0.055;

/** Credits plus the fee it took to buy them, with the other pockets untouched. */
export function cashNanos(totals: {
  creditsNanos: number;
  byokNanos: number;
  computedNanos: number;
}): number {
  return Math.round(totals.creditsNanos * (1 + OPENROUTER_CREDIT_FEE)) + totals.byokNanos + totals.computedNanos;
}

/** One category's money and its honesty markers. */
export interface CategoryTotals {
  calls: number;
  creditsNanos: number;
  byokNanos: number;
  computedNanos: number;
  settledCalls: number;
  computedCalls: number;
  unpricedCalls: number;
}

/** Everything the report draws, folded once from the grouped SQL result. */
export interface SpendFold {
  /** Every category, in `COST_CATEGORIES` order, present even when empty. */
  byCategory: Map<CostCategory, CategoryTotals>;
  /** Owner → category → totals. Only owners the ledger has rows for. */
  byOwner: Map<string, Map<CostCategory, CategoryTotals>>;
  /**
   * The distinct `scope / job / step` triples that reached `unknown`, so the
   * report can name them rather than printing a mystery subtotal. Sorted by
   * money, because the expensive unknown is the one worth classifying.
   */
  unknownFacts: { facts: string; calls: number; nanos: number }[];
  totalCalls: number;
}

function empty(): CategoryTotals {
  return {
    calls: 0,
    creditsNanos: 0,
    byokNanos: 0,
    computedNanos: 0,
    settledCalls: 0,
    computedCalls: 0,
    unpricedCalls: 0,
  };
}

function add(into: CategoryTotals, from: SpendGroup): void {
  into.calls += from.calls;
  into.creditsNanos += from.creditsNanos;
  into.byokNanos += from.byokNanos;
  into.computedNanos += from.computedNanos;
  into.settledCalls += from.settledCalls;
  into.computedCalls += from.computedCalls;
  into.unpricedCalls += from.unpricedCalls;
}

/** The three pockets as one figure. Callers add them deliberately, and say so. */
export function totalNanos(t: {
  creditsNanos: number;
  byokNanos: number;
  computedNanos: number;
}): number {
  return t.creditsNanos + t.byokNanos + t.computedNanos;
}

/**
 * Turn the grouped SQL result into everything the report prints — **and check
 * that nothing fell out on the way.**
 *
 * The `assertCategoriesCoverRows` call at the end is the point of the function
 * as much as the fold is. A fold that drops a bucket produces a report that is
 * quietly *smaller* than the truth and looks entirely reasonable, which for a
 * pricing decision is worse than no report. See
 * [cost-categories.ts](cost-categories.ts) for why that check is "the counts add
 * up" rather than "unknown is empty".
 */
export function foldSpend(groups: readonly SpendGroup[]): SpendFold {
  const byCategory = new Map<CostCategory, CategoryTotals>();
  const byOwner = new Map<string, Map<CostCategory, CategoryTotals>>();
  const unknown = new Map<string, { calls: number; nanos: number }>();
  let totalCalls = 0;

  for (const group of groups) {
    const category = costCategoryOf(group);
    totalCalls += group.calls;

    const overall = byCategory.get(category) ?? empty();
    add(overall, group);
    byCategory.set(category, overall);

    const mine = byOwner.get(group.ownerId) ?? new Map<CostCategory, CategoryTotals>();
    const ours = mine.get(category) ?? empty();
    add(ours, group);
    mine.set(category, ours);
    byOwner.set(group.ownerId, mine);

    if (category === "unknown") {
      const key = describeFacts(group);
      const seen = unknown.get(key) ?? { calls: 0, nanos: 0 };
      seen.calls += group.calls;
      seen.nanos += totalNanos(group);
      unknown.set(key, seen);
    }
  }

  const counts = new Map<CostCategory, number>();
  for (const [category, totals] of byCategory) counts.set(category, totals.calls);
  assertCategoriesCoverRows(counts, totalCalls);

  return {
    byCategory,
    byOwner,
    unknownFacts: [...unknown.entries()]
      .map(([facts, seen]) => ({ facts, ...seen }))
      .sort((a, b) => b.nanos - a.nanos),
    totalCalls,
  };
}

/** A spread over a population, with the population size beside it. */
export interface Spread {
  /** How many accounts the spread is over — **including the zero-spend ones**. */
  n: number;
  /** How many of those actually spent anything in this category. */
  spending: number;
  median: number;
  p95: number;
  max: number;
  /** The sum, which is the only figure here that is not per-account. */
  total: number;
}

/**
 * **Nearest-rank percentiles**, over a population that must already include its
 * zeroes.
 *
 * Nearest-rank rather than an interpolating estimator because at this sample
 * size interpolation invents a value nobody was charged. With four accounts a
 * "p95" is the most expensive account, and the report is expected to say so
 * beside the number rather than let it read as a stable statistic.
 *
 * **The caller supplies the population, and that is the load-bearing part.**
 * A spread over the owners a `GROUP BY` returned is a spread over *spending*
 * owners, which biases every figure upward — GPT Sol's second structural finding
 * on this stage. `spendPerAccount` below is what makes the zeroes real.
 */
export function spread(values: readonly number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { n: 0, spending: 0, median: 0, p95: 0, max: 0, total: 0 };
  const at = (fraction: number): number => {
    /* Nearest-rank: the smallest value at or above the fraction of the way
       through. `Math.max(1, …)` because `ceil(0)` is 0 and there is no zeroth
       element. */
    const rank = Math.max(1, Math.ceil(fraction * n));
    return sorted[rank - 1] as number;
  };
  return {
    n,
    spending: sorted.filter((v) => v > 0).length,
    median: at(0.5),
    p95: at(0.95),
    max: sorted[n - 1] as number,
    total: sorted.reduce((a, b) => a + b, 0),
  };
}

/**
 * One number per account for one category — **zeroes included**.
 *
 * `accounts` is the denominator and comes from outside the ledger, because the
 * ledger cannot produce it: a `GROUP BY ai_calls.owner_id` has nothing to group
 * for somebody who made no calls, so every average over its result is an average
 * over people who spent money. Until Stripe's subscriber set exists, the
 * denominator is every account the Auth service knows about, and the report
 * labels it as that rather than as "subscribers".
 */
export function spendPerAccount(
  fold: SpendFold,
  accounts: readonly string[],
  categories: readonly CostCategory[],
  money: (t: CategoryTotals) => number,
): number[] {
  return accounts.map((id) => {
    const mine = fold.byOwner.get(id);
    if (!mine) return 0;
    let sum = 0;
    for (const category of categories) {
      const totals = mine.get(category);
      if (totals) sum += money(totals);
    }
    return sum;
  });
}

/**
 * **Whose money a row is** — the split the ordinary report leads with, and the
 * one Greg sets a price against.
 *
 * ## Why this is a function rather than a `filter`
 *
 * It was a `filter`, and there were two of them that disagreed.
 * `scripts/ai-cost.ts` defined product as `scopeKind !== "eval"` — everything
 * that is not a bake-off — while [cost-categories.ts](cost-categories.ts),
 * which the `--owners` pricing report groups by, has always put `cli` in
 * `non-product`. So the same rows were a product's cost in one report and ours
 * in the other, and the ordinary report's headline **Product spend** silently
 * carried our own CLI runs: **$2.85 across 349 CLI calls** on 2026-09-07, found
 * by GPT Sol. (Product read $21.19 over 837 calls before the fix and $18.51 over
 * 489 after; the two runs are minutes apart and one further row arrived between
 * them, so the call counts are two snapshots rather than one.)
 *
 * The `filter` sat three lines under a comment arguing the exact principle it
 * broke — *"a bake-off over forty PDF pages landing in the figure he prices
 * against is how a price gets set wrong."* It excluded `eval` and forgot `cli`,
 * which is what a negative predicate does the moment a third case appears: it
 * keeps being *written* correctly and stops being *true*. Hence a positive
 * enumeration, in one place, with tests.
 *
 * ## Four buckets, because losing a row is worse than either mistake
 *
 * `other` exists for a scope name this build does not know. The ledger is
 * append-only and holds historical strings, so that is a real possibility rather
 * than a defensive nicety, and both alternatives are silent: folding it into
 * `product` overstates the basis a price is set from, and dropping it
 * understates every total. It gets a bucket and the report prints it — the same
 * argument `unknown` makes in [cost-categories.ts](cost-categories.ts).
 */
export interface ScopePartition<T> {
  /** A reader's work: an HTTP request, or a pipeline step run for their article. */
  product: T[];
  /** Ours — a developer at a terminal. Real money on the bill, not a reader's. */
  devCli: T[];
  /** Ours — a bake-off. Real money, and the reason `eval` scope exists at all. */
  evals: T[];
  /** A scope name this build does not recognise. Printed, never folded. */
  other: T[];
}

export function partitionByScope<T extends { scopeKind: string }>(
  rows: readonly T[],
): ScopePartition<T> {
  const split: ScopePartition<T> = { product: [], devCli: [], evals: [], other: [] };
  for (const row of rows) {
    if (row.scopeKind === "request" || row.scopeKind === "job_step") split.product.push(row);
    else if (row.scopeKind === "cli") split.devCli.push(row);
    else if (row.scopeKind === "eval") split.evals.push(row);
    else split.other.push(row);
  }
  return split;
}
