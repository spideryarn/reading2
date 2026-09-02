/**
 * What each tier allows, and the decisions that must fail towards free.
 *
 * The asymmetry is the point: everything unknown here — an unrecognised price,
 * a status Stripe invented after this was written, a subscription whose period
 * could not be read — resolves to the *free* tier. Failing the other way hands
 * out a paid allowance for something nobody costed, and does it silently.
 *
 * See src/billing/tiers.ts, and docs/project/billing.md § Adding a tier or a
 * currency for what a new entry has to satisfy.
 */
import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  ENTITLED_STATUSES,
  FREE,
  FREE_LIFETIME_INGESTS,
  PAID_TIERS,
  entitlementFor,
  isEntitledStatus,
  priceTierMap,
  tierForPrice,
  tierSpec,
} from "../src/billing/tiers.js";
import type { PaidTier } from "../src/billing/tiers.js";

const PERIOD = { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") };
const PRICES = new Map<string, PaidTier>([
  ["price_reader", "reader"],
  ["price_researcher", "researcher"],
]);

describe("the table of what we sell", () => {
  it("has an entry for every tier the type allows, and no more", () => {
    expect(PAID_TIERS.map((t) => t.id).sort()).toEqual(["reader", "researcher"]);
  });

  /**
   * **A price in every currency, or a customer somewhere sees somebody else's.**
   * A missing `currency_options` entry does not fail — Checkout quietly falls
   * back to the base currency — so the only thing that catches it is this.
   */
  it("prices every tier in every currency we offer", () => {
    for (const spec of PAID_TIERS) {
      for (const currency of CURRENCIES) {
        expect(spec.amounts[currency], `${spec.id} in ${currency}`).toBeGreaterThan(0);
        /* Whole units. A price ending in 37 pence is a converted number that
           escaped, not a chosen one. */
        expect(spec.amounts[currency] % 50, `${spec.id} in ${currency} is a round number`).toBe(0);
      }
    }
  });

  it("gives every tier its own lookup key and its own environment variable", () => {
    const keys = PAID_TIERS.map((t) => t.lookupKey);
    const vars = PAID_TIERS.map((t) => t.envVar);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(vars).size).toBe(vars.length);
    for (const v of vars) expect(v).toMatch(/^STRIPE_PRICE_[A-Z_]+$/);
  });

  /* The quotas are a ladder, and a more expensive tier that allowed fewer
     ingests would be a pricing page nobody could read. */
  it("charges more for more", () => {
    const sorted = [...PAID_TIERS].sort((a, b) => a.amounts.usd - b.amounts.usd);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.ingestsPerPeriod).toBeGreaterThan(sorted[i - 1]!.ingestsPerPeriod);
    }
  });

  it("is 3 lifetime free, 20 for Reader and 150 for Researcher", () => {
    expect(FREE_LIFETIME_INGESTS).toBe(3);
    expect(tierSpec("reader").ingestsPerPeriod).toBe(20);
    expect(tierSpec("researcher").ingestsPerPeriod).toBe(150);
  });

  /* The free tier has no period, and that absence is load-bearing: a caller
     that read it as "count nothing" would give every free account unlimited
     ingests. `Entitlement` is a discriminated union rather than a bag of
     optionals, so "a period start with no end" is a state the compiler
     refuses — which is what the comment on the type used to claim before it
     was true. */
  it("gives the free tier no period at all, rather than an empty one", () => {
    expect(FREE).toEqual({ tier: "free", limit: FREE_LIFETIME_INGESTS });
    expect(Object.keys(FREE)).not.toContain("periodStart");
  });
});

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
    expect(isEntitledStatus("paused")).toBe(false);
  });

  /* The one that matters when Stripe ships something new: an allowlist over raw
     text, so an unheard-of status is free rather than a crash or a grant. */
  it("treats a status it has never heard of as not entitled", () => {
    expect(isEntitledStatus("some_status_stripe_adds_in_2027")).toBe(false);
    expect(isEntitledStatus(null)).toBe(false);
    expect(isEntitledStatus(undefined)).toBe(false);
    expect(isEntitledStatus("")).toBe(false);
  });
});

describe("which price sells which tier", () => {
  it("recognises each configured price", () => {
    expect(tierForPrice("price_reader", PRICES)).toBe("reader");
    expect(tierForPrice("price_researcher", PRICES)).toBe("researcher");
  });

  /* An old price on a grandfathered subscription, or one made by hand in the
     dashboard. `null` is a situation, not an error — the caller logs it and
     falls to free rather than handing out quota for a price nobody costed. */
  it("returns null for a price it does not recognise, rather than guessing", () => {
    expect(tierForPrice("price_somethingelse", PRICES)).toBeNull();
    expect(tierForPrice(null, PRICES)).toBeNull();
    expect(tierForPrice(undefined, PRICES)).toBeNull();
    expect(tierForPrice("", PRICES)).toBeNull();
  });

  it("builds the map from the environment, and leaves out what is unset", () => {
    expect(priceTierMap({ STRIPE_PRICE_READER: "price_a" } as NodeJS.ProcessEnv)).toEqual(
      new Map([["price_a", "reader"]]),
    );
    expect(
      priceTierMap({ STRIPE_PRICE_READER: "  price_a  ", STRIPE_PRICE_RESEARCHER: "price_b" } as NodeJS.ProcessEnv),
    ).toEqual(
      new Map([
        ["price_a", "reader"],
        ["price_b", "researcher"],
      ]),
    );
  });

  /* A deployment with no Stripe configured has an empty map, and everybody is
     on the free tier. That is correct, and it must not throw. */
  it("is empty rather than broken when nothing is configured", () => {
    expect(priceTierMap({} as NodeJS.ProcessEnv).size).toBe(0);
    expect(priceTierMap({ STRIPE_PRICE_READER: "   " } as NodeJS.ProcessEnv).size).toBe(0);
  });
});

describe("entitlementFor", () => {
  it("gives each paid tier its own allowance and the period, half-open", () => {
    expect(entitlementFor("reader", PERIOD)).toEqual({
      tier: "reader",
      limit: 20,
      periodStart: PERIOD.start,
      periodEnd: PERIOD.end,
    });
    expect(entitlementFor("researcher", PERIOD)).toMatchObject({ tier: "researcher", limit: 150 });
  });

  /**
   * **A paid tier with no readable period falls to free, and does not become
   * unlimited.** The bug this forecloses is the appealing one: "we know they
   * pay, so let them through" turns an unreadable period into an uncapped
   * month. The caller resyncs from Stripe before it ever gets here.
   */
  it("refuses to meter a paid subscription whose period is unknown", () => {
    expect(entitlementFor("reader")).toEqual(FREE);
    expect(entitlementFor("researcher")).toEqual(FREE);
  });

  it("ignores a period offered to the free tier", () => {
    expect(entitlementFor("free", PERIOD)).toEqual(FREE);
  });
});
