/**
 * What entitlement means, and what the seeded tiers have to satisfy.
 *
 * **Two halves, and the split is the point.** The first half tests pure
 * functions over fixture rows: no database, and every branch that decides
 * whether somebody gets a paid allowance. The second half opens the real
 * `billing_tiers` and asserts the invariants that used to be checked over
 * TypeScript constants and now have nowhere else to live — because the tiers
 * became rows on 2026-09-02 (src/db/schema.ts § billing).
 *
 * Most of those invariants moved into the schema as CHECKs, which is better
 * than a test because they hold for every writer. The ones here are the two a
 * CHECK cannot express: a statement about *pairs* of rows, and a statement
 * about the seed being sane.
 *
 * The asymmetry everywhere: everything unknown resolves to the **free** tier.
 * An unrecognised price, a status Stripe invented after this was written, a
 * period that could not be read. Failing the other way hands out a paid
 * allowance for something nobody costed, and does it silently.
 */
import { describe, expect, it } from "vitest";

import {
  ENTITLED_STATUSES,
  FREE,
  FREE_LIFETIME_INGESTS,
  currenciesOffered,
  entitlementForTier,
  isEntitledStatus,
  offerableTiers,
  tierForPrice,
} from "../src/billing/tiers.js";
import type { TierRow } from "../src/billing/tiers.js";
import { loadEnvLocal } from "../src/env.js";
import { readTiers } from "../src/store/pg-tiers.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const PERIOD = { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") };

function tier(over: Partial<TierRow> = {}): TierRow {
  return {
    id: "reader",
    productName: "Spideryarn Reader",
    description: "20 articles a month.",
    ingestsPerPeriod: 20,
    lookupKey: "spideryarn_reader_monthly",
    stripePriceId: "price_reader",
    livemode: false,
    active: true,
    sortOrder: 10,
    amounts: { usd: 1000, gbp: 800, eur: 900 },
    ...over,
  };
}

describe("which subscriptions are entitled", () => {
  it("keeps a customer whose card failed once, because Stripe is still dunning them", () => {
    expect(isEntitledStatus("past_due")).toBe(true);
    expect(ENTITLED_STATUSES).toContain("active");
    expect(ENTITLED_STATUSES).toContain("trialing");
  });

  it("does not entitle a subscription that never took a first payment", () => {
    expect(isEntitledStatus("incomplete")).toBe(false);
    expect(isEntitledStatus("incomplete_expired")).toBe(false);
  });

  it("does not entitle a subscription dunning gave up on", () => {
    expect(isEntitledStatus("canceled")).toBe(false);
    expect(isEntitledStatus("unpaid")).toBe(false);
  });

  /* The one that matters when Stripe ships something new: an allowlist over raw
     text, so an unheard-of status is free rather than a crash or a grant. */
  it("treats a status it has never heard of as not entitled", () => {
    expect(isEntitledStatus("some_status_stripe_adds_in_2027")).toBe(false);
    expect(isEntitledStatus(null)).toBe(false);
    expect(isEntitledStatus(undefined)).toBe(false);
  });
});

describe("which price sells which tier", () => {
  const tiers = [tier(), tier({ id: "researcher", stripePriceId: "price_researcher" })];

  it("finds the tier whose price this is", () => {
    expect(tierForPrice("price_researcher", tiers)?.id).toBe("researcher");
  });

  /* An old price on a grandfathered subscription, or one made by hand in the
     dashboard, or a tier somebody deleted the row for. `null` is a situation,
     not an error — the caller logs it and falls to free. */
  it("returns null for a price no tier sells, rather than guessing", () => {
    expect(tierForPrice("price_somethingelse", tiers)).toBeNull();
    expect(tierForPrice(null, tiers)).toBeNull();
    expect(tierForPrice("", tiers)).toBeNull();
    expect(tierForPrice("price_reader", [])).toBeNull();
  });

  /**
   * **`active` decides what is offered, not what is honoured.** Retiring a tier
   * must not cancel the people already on it — which is the entire reason it is
   * a flag rather than a delete.
   */
  it("still honours a retired tier for somebody already subscribed to it", () => {
    const retired = [tier({ active: false })];
    expect(tierForPrice("price_reader", retired)?.id).toBe("reader");
    expect(offerableTiers(retired)).toEqual([]);
  });

  /* A tier whose Stripe price has not been created cannot be sold, and must not
     appear on a pricing page as something buyable. */
  it("does not offer a tier with no Stripe price yet", () => {
    expect(offerableTiers([tier({ stripePriceId: null })])).toEqual([]);
  });

  it("offers what is sellable, cheapest first", () => {
    const offered = offerableTiers([
      tier({ id: "researcher", stripePriceId: "price_r", sortOrder: 20 }),
      tier({ sortOrder: 10 }),
    ]);
    expect(offered.map((t) => t.id)).toEqual(["reader", "researcher"]);
  });
});

describe("entitlementForTier", () => {
  it("gives a paid tier its own allowance and the period, half-open", () => {
    expect(entitlementForTier(tier({ ingestsPerPeriod: 150 }), PERIOD)).toEqual({
      tier: "paid",
      tierId: "reader",
      limit: 150,
      periodStart: PERIOD.start,
      periodEnd: PERIOD.end,
    });
  });

  /* The free tier has no period, and that absence is load-bearing: a caller
     that read it as "count nothing" would give every free account unlimited
     ingests. The union makes "a period start with no end" unrepresentable. */
  it("gives the free tier no period at all, rather than an empty one", () => {
    expect(FREE).toEqual({ tier: "free", limit: FREE_LIFETIME_INGESTS });
    expect(Object.keys(FREE)).not.toContain("periodStart");
  });
});

describe("currenciesOffered", () => {
  it("is the union across tiers, sorted, so a gap is visible", () => {
    expect(
      currenciesOffered([tier(), tier({ id: "b", amounts: { usd: 1, jpy: 2 } })]),
    ).toEqual(["eur", "gbp", "jpy", "usd"]);
  });
});

/* -------------------------------------------------------------------------- */

const { reachable } = await pgReady({
  suite: "tests/billing-tiers.test.ts",
  tables: ["spideryarn.billing_tiers", "spideryarn.billing_tier_prices"],
});
const dbIt = reachable ? it : it.skip;

/**
 * **The invariants that used to be compile-time, against the real rows.**
 *
 * Everything expressible as a CHECK is a CHECK — positive quotas, positive
 * amounts, the id and currency formats, unique lookup keys and price ids. Those
 * hold for every writer including a hand-typed UPDATE, which a test cannot
 * claim. What is left here is what a CHECK cannot say.
 */
describe("the seeded tiers", () => {
  dbIt("has tiers at all, and each is priced in at least one currency", async () => {
    const tiers = await readTiers();
    expect(tiers.length).toBeGreaterThan(0);
    for (const t of tiers) {
      expect(Object.keys(t.amounts).length, `${t.id} has no prices`).toBeGreaterThan(0);
    }
  });

  /**
   * **A statement about pairs of rows, which is why it is here and not a
   * CHECK.** A dearer tier that allowed fewer ingests would be a pricing page
   * nobody could read, and it is exactly the mistake an editable table invites.
   */
  dbIt("charges more for more", async () => {
    const tiers = (await readTiers()).filter((t) => t.active && t.amounts.usd !== undefined);
    const byPrice = [...tiers].sort((a, b) => (a.amounts.usd ?? 0) - (b.amounts.usd ?? 0));
    for (let i = 1; i < byPrice.length; i++) {
      const cheaper = byPrice[i - 1] as TierRow;
      const dearer = byPrice[i] as TierRow;
      expect(dearer.ingestsPerPeriod, `${dearer.id} costs more than ${cheaper.id}`).toBeGreaterThan(
        cheaper.ingestsPerPeriod,
      );
    }
  });

  /**
   * **Every active tier priced in every currency any tier offers.** A missing
   * `currency_options` entry does not fail loudly — Checkout quietly falls back
   * to the base currency — so a customer somewhere would be shown somebody
   * else's price, and nothing but this would say so.
   */
  dbIt("prices every active tier in every currency we offer", async () => {
    const tiers = (await readTiers()).filter((t) => t.active);
    const currencies = currenciesOffered(tiers);
    for (const t of tiers) {
      for (const currency of currencies) {
        expect(t.amounts[currency], `${t.id} has no ${currency} price`).toBeGreaterThan(0);
      }
    }
  });

  /* Whole units. A price ending in 37 pence is a converted number that escaped
     rather than a chosen one — see billing.md on why amounts are chosen. */
  dbIt("prices in round numbers", async () => {
    for (const t of await readTiers()) {
      for (const [currency, amount] of Object.entries(t.amounts)) {
        expect(amount % 50, `${t.id} in ${currency} is ${amount}`).toBe(0);
      }
    }
  });
});
