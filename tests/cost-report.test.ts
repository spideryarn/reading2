/**
 * The pricing report's arithmetic — [src/cost-report.ts](../src/cost-report.ts).
 *
 * Everything here is a number Greg will set a subscription price against, so the
 * tests are shaped around the three ways such a number goes quietly wrong: a
 * fold that drops rows, a spread taken over the wrong population, and a cash
 * figure that applies a fee to money that never paid one.
 */

import { describe, expect, it } from "vitest";

import {
  OPENROUTER_CREDIT_FEE,
  cashNanos,
  foldSpend,
  spendPerAccount,
  spread,
  totalNanos,
} from "../src/cost-report.js";
import type { SpendGroup } from "../src/store/ai-calls-spend-pg.js";

const ALICE = "cf000000-0000-4000-8000-000000000001";
const BOB = "cf000000-0000-4000-8000-000000000002";
/** Signed up, never spent a penny. The account a `GROUP BY` cannot see. */
const CARA = "cf000000-0000-4000-8000-000000000003";

function group(over: Partial<SpendGroup> = {}): SpendGroup {
  return {
    ownerId: ALICE,
    scopeKind: "job_step",
    job: "hierarchy",
    stepName: "hierarchy",
    calls: 1,
    creditsNanos: 1_000_000_000,
    byokNanos: 0,
    computedNanos: 0,
    settledCalls: 1,
    computedCalls: 0,
    unpricedCalls: 0,
    ...over,
  };
}

describe("folding the grouped query into a report", () => {
  it("adds a category's rows across owners and keeps each owner's apart", () => {
    const fold = foldSpend([
      group({ ownerId: ALICE, creditsNanos: 300 }),
      group({ ownerId: BOB, creditsNanos: 700 }),
      group({ ownerId: BOB, job: "chat", scopeKind: "request", stepName: null, creditsNanos: 50 }),
    ]);
    expect(totalNanos(fold.byCategory.get("default-step work")!)).toBe(1000);
    expect(totalNanos(fold.byOwner.get(ALICE)!.get("default-step work")!)).toBe(300);
    expect(totalNanos(fold.byOwner.get(BOB)!.get("default-step work")!)).toBe(700);
    expect(totalNanos(fold.byOwner.get(BOB)!.get("interactive request work")!)).toBe(50);
    /* Nobody gets anybody else's money, which for a merge keyed by owner id is
       the one property worth stating rather than assuming. */
    expect(fold.byOwner.get(ALICE)!.has("interactive request work")).toBe(false);
  });

  it("names the unclassified rows rather than printing a mystery subtotal", () => {
    /* A subtotal under "unknown" with nothing beside it is unactionable — the
       reader cannot tell a retired name from a new feature nobody has
       classified. The triples make it a two-minute job instead. */
    const fold = foldSpend([
      group({ job: "summarise", stepName: "summary", creditsNanos: 20, calls: 3 }),
      group({ scopeKind: "request", job: "brand-new-mode", stepName: null, creditsNanos: 500 }),
    ]);
    expect(fold.byCategory.get("unknown")?.calls).toBe(4);
    /* Sorted by money, because the expensive unknown is the one worth
       classifying first. */
    expect(fold.unknownFacts.map((u) => u.facts)).toEqual([
      "request / brand-new-mode / —",
      "job_step / summarise / summary",
    ]);
  });

  it("counts every row it was given, so nothing can go missing between fold and page", () => {
    const fold = foldSpend([group({ calls: 4 }), group({ ownerId: BOB, calls: 6 })]);
    expect(fold.totalCalls).toBe(10);
  });

  it("keeps the three pockets apart all the way through", () => {
    /* A BYOK call was billed to somebody else's key and a computed call never
       reached OpenRouter; a fold that added them into one field would lose the
       one distinction that decides which of them the cash uplift applies to. */
    const fold = foldSpend([
      group({ creditsNanos: 10, byokNanos: 20, computedNanos: 30, calls: 1 }),
    ]);
    const totals = fold.byCategory.get("default-step work")!;
    expect(totals).toMatchObject({ creditsNanos: 10, byokNanos: 20, computedNanos: 30 });
  });
});

describe("cash beside credits", () => {
  it("adds OpenRouter's fee to credits and to nothing else", () => {
    /* Their cut is charged on *buying credits*, not per token. A BYOK row's
       inference was billed to another account and a computed row went straight
       to Anthropic or OpenAI, so neither ever bought a credit. Applying the
       uplift to those would charge ourselves a fee twice for money that never
       paid one — a report that overstates cost sets the price too high. */
    expect(cashNanos({ creditsNanos: 1_000_000_000, byokNanos: 0, computedNanos: 0 })).toBe(
      1_055_000_000,
    );
    expect(cashNanos({ creditsNanos: 0, byokNanos: 1_000_000_000, computedNanos: 0 })).toBe(
      1_000_000_000,
    );
    expect(cashNanos({ creditsNanos: 0, byokNanos: 0, computedNanos: 1_000_000_000 })).toBe(
      1_000_000_000,
    );
  });

  it("is the documented 5.5%, not a number somebody nudged", () => {
    expect(OPENROUTER_CREDIT_FEE).toBe(0.055);
  });
});

describe("the spread across accounts", () => {
  it("includes the accounts that spent nothing", () => {
    /* **GPT Sol's second structural finding on this stage.** A `GROUP BY
       ai_calls.owner_id` returns nothing for an account with no calls, so a
       spread over its result is a spread over *spending* accounts and biases
       every figure upward — which for a subscription price is the direction
       that loses money quietly. The zeroes have to be real. */
    const fold = foldSpend([
      group({ ownerId: ALICE, creditsNanos: 100 }),
      group({ ownerId: BOB, creditsNanos: 300 }),
    ]);
    const overSpenders = spread(spendPerAccount(fold, [ALICE, BOB], ["default-step work"], totalNanos));
    const overEverybody = spread(
      spendPerAccount(fold, [ALICE, BOB, CARA], ["default-step work"], totalNanos),
    );
    expect(overSpenders.median).toBe(100);
    /* Cara drags the median down to where it belongs. Same money, same rows,
       and the number a price would be argued from is different. */
    expect(overEverybody.median).toBe(100);
    expect(overEverybody.n).toBe(3);
    expect(overEverybody.spending).toBe(2);
    expect(overEverybody.total).toBe(400);
  });

  it("gives an account with no rows at all a zero rather than dropping it", () => {
    const fold = foldSpend([group({ ownerId: ALICE, creditsNanos: 100 })]);
    expect(spendPerAccount(fold, [CARA], ["default-step work"], totalNanos)).toEqual([0]);
  });

  it("sums the categories it was asked for and no others", () => {
    /* This is what keeps non-product spend out of the per-account distribution:
       the caller passes the product categories and eval/CLI money is simply not
       in the list. */
    const fold = foldSpend([
      group({ ownerId: ALICE, creditsNanos: 100 }),
      group({ ownerId: ALICE, scopeKind: "eval", job: "eval", stepName: null, creditsNanos: 9_000 }),
    ]);
    expect(spendPerAccount(fold, [ALICE], ["default-step work"], totalNanos)).toEqual([100]);
    expect(spendPerAccount(fold, [ALICE], ["non-product"], totalNanos)).toEqual([9_000]);
  });

  it("takes nearest-rank percentiles, so every figure is a real account's bill", () => {
    /* Interpolating at this sample size invents a number nobody was charged.
       With ten accounts the p95 is the tenth — which is also the max, and the
       report says so beside it rather than letting it read as a stable
       statistic. */
    const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 100];
    const s = spread(values);
    expect(s.median).toBe(4);
    expect(s.p95).toBe(100);
    expect(s.max).toBe(100);
    expect(s.n).toBe(10);
    expect(s.spending).toBe(9);
  });

  it("does not divide by zero on an empty population", () => {
    expect(spread([])).toMatchObject({ n: 0, median: 0, p95: 0, max: 0, total: 0 });
  });
});
