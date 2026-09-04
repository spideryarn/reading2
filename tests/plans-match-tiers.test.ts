/**
 * The price table on the website says what the database charges.
 *
 * `src/web/PlanCards.tsx` is rendered on `/`, `/features` and `/pricing`, and
 * its numbers are **copy rather than configuration** — a deliberate trade so a
 * signed-out page needs no fetch, made when the plans were written and explained
 * in that file's header. (It was `src/web/Plans.tsx` until 2026-09-04, when the
 * table grew a button and moved.) The cost of the trade is a second copy of every number,
 * and `docs/project/billing.md` advertises raising a quota as *one `UPDATE`*,
 * which touches the database and not the table.
 *
 * So this is the thing that notices. Greg asked on 2026-09-03 for a pricing page
 * that "would keep up to date automatically, but failing that we can just
 * document to update it". Documenting it is what the header already did; this is
 * the half that cannot be forgotten, because a quota changed in the database and
 * not here now goes red and names the file.
 *
 * ## It compares whole rows, keyed by tier id — and that is new
 *
 * It read the *source text* of that file until 2026-09-04 and asked whether each
 * name, id, allowance and price appeared somewhere in it. Four independent
 * substring searches over one file, never bound into a row: GPT Sol swapped only
 * the `reader` and `researcher` ids, leaving
 * `{ id: "researcher", name: "Reader", allowance: "20 a month" }` on the page,
 * and **every check still passed**
 * (docs/plans/260904b-stage1-code-review-sol.md, finding 3).
 *
 * That is not a style complaint. The id is the only thing a checkout POST
 * carries (useBilling.ts), and since 2026-09-04 the website's rows carry the
 * buttons — so the mutation is a reader pressing *Get Reader* and being sold
 * Researcher at five times the price. `useBuyIntent` would not catch it either:
 * it checks that the id is *on sale*, not that it is the one under the label the
 * reader read.
 *
 * So the guard imports the records rather than reading them, and asks of each
 * tier on sale: **is there a row with this id, and does every field on it belong
 * to this tier?** A swap now fails on the field that moved. Importing is not
 * rendering — no jsdom and no React tree, just the constant the pages draw —
 * which keeps the old header's point that a renderer would put a large
 * dependency between the fact and the assertion.
 *
 * The free allowance is checked too, from `FREE_LIFETIME_INGESTS` rather than
 * the tiers table, because free is the absence of a subscription and has no row.
 */
import { describe, expect, it } from "vitest";

import { FREE_LIFETIME_INGESTS, offerableTiers } from "../src/billing/tiers.js";
import { loadEnvLocal } from "../src/env.js";
import { readTiers } from "../src/store/pg-tiers.js";
import { WEBSITE_PLANS } from "../src/web/PlanCards.js";
import type { PlanCard } from "../src/web/PlanCards.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/**
 * The website's rows, keyed by the tier id a checkout POST would carry.
 *
 * **The keying is the whole fix.** A `Map` from id to row is what turns "these
 * four strings all appear in the file" into "this row *is* this tier", and it is
 * what a swapped pair of ids cannot survive.
 */
const BY_TIER_ID = new Map<string, PlanCard>();
for (const plan of WEBSITE_PLANS) {
  if (plan.id === null) continue;
  /* Two rows claiming one tier would make the checks below depend on order.
     Nothing can produce it today; it costs one line to make impossible. */
  if (BY_TIER_ID.has(plan.id)) throw new Error(`two website rows carry the id "${plan.id}"`);
  BY_TIER_ID.set(plan.id, plan);
}

/** The tier row's name as the site writes it: `Reader`, not `Spideryarn Reader`. */
const asShown = (productName: string): string => productName.replace(/^Spideryarn /, "");

/** The symbol Stripe's own `Intl` formatting uses, for the currencies we sell. */
const SYMBOL: Record<string, string> = { usd: "$", gbp: "£", eur: "€" };

/** `1000` minor units of USD as the table writes it: `$10`. Whole units only. */
function asWritten(currency: string, minorUnits: number): string {
  const symbol = SYMBOL[currency];
  if (!symbol) throw new Error(`no symbol known for ${currency} — add one, or stop selling in it`);
  /* `billing_tiers.test.ts` already pins that every amount is a whole unit, so a
     fraction here means that invariant broke rather than that this needs to
     handle pence. Say so rather than quietly formatting it. */
  if (minorUnits % 100 !== 0) {
    throw new Error(`${currency} ${minorUnits} is not a whole unit — tests/billing-tiers.test.ts`);
  }
  return `${symbol}${minorUnits / 100}`;
}

/**
 * Does this row's price string quote that amount — and not a longer number that
 * merely starts with it?
 *
 * `"$50 · £40 · €45 a month".includes("$5")` is true, and `$5` is not a price we
 * charge. The prices are one string per row (three currencies, a separator and
 * the word *month*), so this asks for the amount with no digit after it rather
 * than pinning the whole sentence — reordering the currencies or changing the
 * separator is a copy decision and not a drift.
 */
function quotes(price: string, written: string): boolean {
  const escaped = written.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}(?!\\d)`).test(price);
}

describe("the website's price table", () => {
  it("states the free allowance the code enforces", () => {
    const free = WEBSITE_PLANS.find((plan) => plan.id === null);
    expect(free, "no row for the free tier, which is the one every reader starts on").toBeTruthy();
    expect(free?.name).toBe("Free");
    expect(free?.allowance).toBe(`${FREE_LIFETIME_INGESTS}, for life`);
  });
});

/* -------------------------------------------------------------------------- */

const { reachable } = await pgReady({
  suite: "tests/plans-match-tiers.test.ts",
  tables: ["spideryarn.billing_tiers", "spideryarn.billing_tier_prices"],
});
const dbIt = reachable ? it : it.skip;

describe("the website's price table, against the real rows", () => {
  /**
   * **One assertion per tier, over the whole row.**
   *
   * The id is looked up first and everything else is asserted *of the row that
   * id found*, so a field that has moved to another tier's row fails here rather
   * than being found somewhere else in the file and passing. That is the
   * swapped-id mutation, and the two swaps next to it — an allowance or a price
   * moved between rows — which the old text search could not see either.
   */
  dbIt("gives every tier on sale a row whose every field is that tier's", async () => {
    for (const tier of offerableTiers(await readTiers())) {
      const row = BY_TIER_ID.get(tier.id);
      expect(
        row,
        `nothing in src/web/PlanCards.tsx can buy the "${tier.id}" tier — a plan whose id is not ` +
          "an id on sale is drawn with no button at all, which is the failure nobody reports",
      ).toBeTruthy();
      if (!row) continue;

      expect(row.name, `the "${tier.id}" row is labelled "${row.name}"`).toBe(
        asShown(tier.productName),
      );
      expect(
        row.allowance,
        `"${tier.id}" allows ${tier.ingestsPerPeriod} a month and its row says "${row.allowance}"`,
      ).toBe(`${tier.ingestsPerPeriod} a month`);

      for (const [currency, minorUnits] of Object.entries(tier.amounts)) {
        const written = asWritten(currency, minorUnits);
        expect(
          quotes(row.price, written),
          `"${tier.id}" costs ${written} and its row says "${row.price}" — raising a price is ` +
            "one UPDATE and one edit to src/web/PlanCards.tsx",
        ).toBe(true);
      }
    }
  });

  dbIt("advertises no plan that no active tier sells", async () => {
    /* The other direction: a tier deleted or deactivated leaves a row on the
       website advertising something nobody can buy, which the check above cannot
       see because it only walks what is on sale. */
    const sold = new Set(offerableTiers(await readTiers()).map((tier) => tier.id));
    for (const [id, row] of BY_TIER_ID) {
      expect(sold.has(id), `the table advertises "${row.name}" and no active tier sells it`).toBe(
        true,
      );
    }
  });
});
