/**
 * What each tier allows, and the two decisions that must fail towards free.
 *
 * The asymmetry is the point: everything unknown here — an unrecognised price,
 * a status Stripe invented after this was written, a subscription whose period
 * could not be read — resolves to the *free* tier. Failing the other way hands
 * out a hundred paid ingests a month for something nobody costed, and does it
 * silently. See src/billing/tiers.ts.
 */
import { describe, expect, it } from "vitest";
import {
  ENTITLED_STATUSES,
  FREE,
  FREE_LIFETIME_INGESTS,
  READER_PERIOD_INGESTS,
  entitlementFor,
  isEntitledStatus,
  tierForPrice,
} from "../src/billing/tiers.js";

const READER_PRICE = "price_reader";
const PERIOD = { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") };

describe("the numbers", () => {
  it("is 3 lifetime free and 100 a period paid", () => {
    expect(FREE_LIFETIME_INGESTS).toBe(3);
    expect(READER_PERIOD_INGESTS).toBe(100);
  });

  /* The free tier has no period, and that absence is load-bearing: a caller
     that read it as "count nothing" would give every free account unlimited
     ingests. Both fields are optional together so the two states are
     distinguishable. */
  it("gives the free tier no period at all, rather than an empty one", () => {
    expect(FREE.periodStart).toBeUndefined();
    expect(FREE.periodEnd).toBeUndefined();
    expect(FREE.limit).toBe(FREE_LIFETIME_INGESTS);
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
  it("recognises the configured price", () => {
    expect(tierForPrice(READER_PRICE, READER_PRICE)).toBe("reader");
  });

  /* An old price on a grandfathered subscription, or one made by hand in the
     dashboard. `null` is a situation, not an error — the caller logs it and
     falls to free rather than handing out quota for a price nobody costed. */
  it("returns null for a price it does not recognise, rather than guessing", () => {
    expect(tierForPrice("price_somethingelse", READER_PRICE)).toBeNull();
    expect(tierForPrice(null, READER_PRICE)).toBeNull();
    expect(tierForPrice(undefined, READER_PRICE)).toBeNull();
    expect(tierForPrice("", READER_PRICE)).toBeNull();
  });
});

describe("entitlementFor", () => {
  it("gives a Reader subscription its period, half-open", () => {
    const e = entitlementFor("reader", PERIOD);
    expect(e).toEqual({
      tier: "reader",
      limit: READER_PERIOD_INGESTS,
      periodStart: PERIOD.start,
      periodEnd: PERIOD.end,
    });
  });

  /**
   * **A Reader tier with no period falls to free, and does not become
   * unlimited.** The bug this forecloses is the appealing one: "we know they
   * pay, so let them through" turns an unreadable period into an uncapped
   * month. The caller resyncs from Stripe once before it ever gets here.
   */
  it("refuses to meter a Reader subscription whose period is unknown", () => {
    expect(entitlementFor("reader")).toEqual(FREE);
  });

  it("ignores a period offered to the free tier", () => {
    expect(entitlementFor("free", PERIOD)).toEqual(FREE);
  });
});
