/**
 * `stripe:check`'s Portal half — the check that has to fail when the money is
 * wrong.
 *
 * **It is here because the untested version passed cleanly on the day billing
 * went live, with the upgrade path shut.** It verified cancellation, invoices
 * and card updates — the features somebody thought to list — and never asked
 * whether a reader could change plan at all. A check that has never been seen
 * failing is [not evidence](../docs/reusable/silent-success.md), and until this
 * file existed there was nothing that could see it fail on demand.
 *
 * The first fix for that gave the check its **own** idea of what correct means,
 * beside the one `scripts/stripe-setup.ts` enforces — and the two disagreed. Most
 * of what follows is therefore about the *agreement*: every case here is a
 * configuration `stripe:setup --apply` would rewrite, and the assertion is that
 * the check refuses to exit zero on it.
 */
import { describe, expect, it } from "vitest";

import { checkPortal, checkTier, tiersToCheck } from "../scripts/stripe-check.js";
import type { StripePortalCheck, StripeTierCheck } from "../scripts/stripe-check.js";
import { portalFeatures } from "../scripts/stripe-setup.js";
import type { TierRow } from "../src/billing/tiers.js";

const tier = (over: Partial<TierRow> = {}): TierRow => ({
  id: "reader",
  productName: "Spideryarn Reader",
  description: "30 articles a month",
  ingestsPerPeriod: 30,
  lookupKey: "reader",
  stripePriceId: "price_reader",
  livemode: false,
  active: true,
  sortOrder: 1,
  amounts: { usd: 1000 },
  ...over,
});

const TIERS: TierRow[] = [
  tier(),
  tier({ id: "researcher", lookupKey: "researcher", stripePriceId: "price_researcher", sortOrder: 2 }),
];

const PRODUCT_OF: Record<string, string> = {
  price_reader: "prod_reader",
  price_researcher: "prod_researcher",
};

const BOTH_PRODUCTS = [
  { product: "prod_reader", prices: ["price_reader"], adjustable_quantity: { enabled: false } },
  { product: "prod_researcher", prices: ["price_researcher"], adjustable_quantity: { enabled: false } },
];

/** The desired state for a complete tier set — see the setup test for why `unpriced` is in it. */
const want = (products: typeof BOTH_PRODUCTS) => ({ products, unpriced: [] as string[] });

/** A correct configuration, built from what the setup script actually sends. */
function liveConfig(over: Record<string, unknown> = {}) {
  const f = portalFeatures(want(BOTH_PRODUCTS)) as Record<string, Record<string, unknown>>;
  return {
    id: "bpc_live",
    is_default: true,
    active: over.active ?? true,
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["email", "address"] },
      subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
      subscription_update: {
        ...f.subscription_update,
        schedule_at_period_end: { conditions: [] },
        ...(over.subscription_update as object | undefined),
      },
    },
  } as never;
}

/**
 * One current subscription on `price`, in the shape `checkNobodyIsStranded`
 * reads it. `status` defaults to an entitled one, because a canceled
 * subscription is not somebody who can be stranded.
 */
const sub = (id: string, price: string, status = "active") => ({
  id,
  status,
  items: { data: [{ price: { id: price } }] },
});

/**
 * Serves subscriptions one page at a time, so a test can prove the check reads
 * past the first — `currentSubscriptions` paginates, and a fake that answers
 * everything in one page could not tell whether it does.
 */
function fakeStripe(configurations: unknown[], pages: unknown[][] = [[]]) {
  let n = 0;
  return {
    billingPortal: { configurations: { list: async () => ({ data: configurations }) } },
    prices: { retrieve: async (id: string) => ({ id, product: PRODUCT_OF[id] ?? "prod_unknown" }) },
    subscriptions: {
      list: async () => {
        const data = pages[n] ?? [];
        n += 1;
        return { data, has_more: n < pages.length };
      },
    },
  } as unknown as StripePortalCheck;
}

/** What decides the exit code: any `✗` at all. */
const blocking = (checks: { mark: string; detail: string }[]) =>
  checks.filter((c) => c.mark === "✗").map((c) => c.detail);

describe("stripe:check on the Portal configuration", () => {
  it("passes a configuration that matches what setup enforces", async () => {
    const checks = await checkPortal(fakeStripe([liveConfig()]), TIERS);
    expect(blocking(checks)).toEqual([]);
    expect(checks.map((c) => c.detail).join(" ")).toMatch(/every money-sensitive field matches/);
  });

  it("refuses an account with no default configuration at all", async () => {
    const checks = await checkPortal(fakeStripe([]), TIERS);
    expect(blocking(checks)).toEqual([
      "no default configuration — readers have nowhere to cancel or fix a card",
    ]);
  });

  /* The live fault, and the one this whole stage exists for. */
  it("refuses the configuration the live account actually had", async () => {
    const shut = liveConfig({ subscription_update: { enabled: false, default_allowed_updates: [] } });
    const checks = await checkPortal(fakeStripe([shut]), TIERS);
    expect(blocking(checks).join(" ")).toMatch(/subscription_update.enabled is false/);
  });

  /**
   * The three that a "contains" test waves through. Each of these is a
   * configuration `--apply` would rewrite, so exiting zero on it would mean the
   * check and the reconcile disagree about what correct is — which is how the
   * original fault survived.
   */
  it("refuses default_allowed_updates with an extra it was never given", async () => {
    const extra = liveConfig({
      subscription_update: { default_allowed_updates: ["price", "promotion_code"] },
    });
    expect(blocking(await checkPortal(fakeStripe([extra]), TIERS)).join(" ")).toMatch(
      /default_allowed_updates is \[price,promotion_code\]/,
    );
  });

  it("refuses a products list carrying a price nobody costed", async () => {
    const smuggled = liveConfig({
      subscription_update: {
        products: [{ ...BOTH_PRODUCTS[0], prices: ["price_reader", "price_smuggled"] }, BOTH_PRODUCTS[1]],
      },
    });
    expect(blocking(await checkPortal(fakeStripe([smuggled]), TIERS)).join(" ")).toMatch(/products are /);
  });

  it("refuses adjustable quantity, rather than merely mentioning it", async () => {
    const adjustable = liveConfig({
      subscription_update: {
        products: [{ ...BOTH_PRODUCTS[0], adjustable_quantity: { enabled: true } }, BOTH_PRODUCTS[1]],
      },
    });
    expect(blocking(await checkPortal(fakeStripe([adjustable]), TIERS)).join(" ")).toMatch(
      /adjustable_quantity is on for prod_reader/,
    );
  });

  it("refuses a billing_cycle_anchor that would move the quota window", async () => {
    const moving = liveConfig({ subscription_update: { billing_cycle_anchor: "now" } });
    expect(blocking(await checkPortal(fakeStripe([moving]), TIERS)).join(" ")).toMatch(
      /billing_cycle_anchor is now.*the quota window must not move/s,
    );
  });

  it("refuses a trial that would survive a switch, which is unpaid entitlement", async () => {
    const trialing = liveConfig({ subscription_update: { trial_update_behavior: "continue_trial" } });
    expect(blocking(await checkPortal(fakeStripe([trialing]), TIERS)).join(" ")).toMatch(
      /trial_update_behavior is continue_trial/,
    );
  });

  it("refuses an inactive configuration, however right its features are", async () => {
    const dormant = liveConfig({ active: false });
    expect(blocking(await checkPortal(fakeStripe([dormant]), TIERS)).join(" ")).toMatch(
      /the configuration is inactive/,
    );
  });

  it("refuses a tier whose row carries no Stripe price", async () => {
    const half = [tier(), tier({ id: "researcher", stripePriceId: null, sortOrder: 2 })];
    const checks = await checkPortal(fakeStripe([liveConfig()]), half);
    expect(blocking(checks).join(" ")).toMatch(/no Stripe price on the row/);
  });
});

/**
 * **Two false-greens the check shared with the setup script.**
 *
 * Both are the same shape as the Portal divergence already closed here: the
 * setup script would rewrite the object and the check said it was fine. A check
 * that disagrees with the writer about what "correct" means passes things
 * `--apply` is about to change.
 *
 * These drive the real `checkTier`, not a restatement of its rule — a test that
 * reimplements the comparison it is checking is a third definition of correct.
 */
describe("what the tier check used to wave through", () => {
  const stripeWith = (price: object) =>
    ({ prices: { list: async () => ({ data: [price] }) } }) as unknown as StripeTierCheck;

  /** A price that matches the default `tier()` row in every way the check reads. */
  const goodPrice = (over: object = {}) => ({
    id: "price_reader",
    active: true,
    livemode: false,
    currency: "usd",
    unit_amount: 1000,
    recurring: { interval: "month", interval_count: 1 },
    tax_behavior: "inclusive",
    currency_options: {},
    product: { id: "prod_reader", tax_code: "txcd_10103000", name: "Spideryarn Reader" },
    ...over,
  });

  it("passes a price that matches the row", async () => {
    expect(blocking(await checkTier(stripeWith(goodPrice()), tier()))).toEqual([]);
  });

  /* The per-currency loop iterates the *row's* currencies, so a currency present
     only on Stripe is a price a reader could be charged at that nothing here
     costed or displays. */
  it("refuses a currency Stripe offers that the database does not", async () => {
    const price = goodPrice({ currency_options: { chf: { unit_amount: 999, tax_behavior: "inclusive" } } });
    expect(blocking(await checkTier(stripeWith(price), tier())).join(" ")).toMatch(
      /Stripe also sells this in CHF, which the row does not offer/,
    );
  });

  /* Any non-empty tax code used to pass, while setup requires this exact one —
     so a hand-set code read as fine here and would be rewritten by `--apply`. */
  it("refuses a tax code that is not the one setup writes", async () => {
    const price = goodPrice({
      product: { id: "prod_reader", tax_code: "txcd_10105001", name: "Spideryarn Reader" },
    });
    expect(blocking(await checkTier(stripeWith(price), tier())).join(" ")).toMatch(
      /has tax code txcd_10105001, not txcd_10103000/,
    );
  });

  it("still says why a missing tax code matters, since that one stops the sale", async () => {
    const price = goodPrice({ product: { id: "prod_reader", name: "Spideryarn Reader" } });
    expect(blocking(await checkTier(stripeWith(price), tier())).join(" ")).toMatch(
      /has tax code none, not txcd_10103000 — Managed Payments refuses to sell it/,
    );
  });
});

/**
 * **Nobody is left on a price the Portal cannot switch them from.**
 *
 * `stripe:setup` leaves existing subscribers on the price they bought when an
 * amount changes, so a grandfathered subscriber is doubly stuck: no recognised
 * tier, and now no upgrade path either. We detect rather than keeping price
 * history — see `checkNobodyIsStranded`.
 */
describe("subscribers stranded on a replaced price", () => {
  it("passes when everyone bills on a price the Portal lists", async () => {
    const stripe = fakeStripe([liveConfig()], [[sub("sub_ok", "price_reader")]]);
    const checks = await checkPortal(stripe, TIERS);
    expect(blocking(checks)).toEqual([]);
    expect(checks.map((c) => c.detail).join(" ")).toMatch(
      /all 1 unfinished subscription\(s\) bill on a price the Portal will list/,
    );
  });

  /**
   * **And says only that.** Billing on a listed price is necessary for a Portal
   * switch and not sufficient: Stripe also blocks the update flow for scheduled,
   * multi-product, usage-based and send-invoice subscriptions, none of which this
   * examines. Claiming "they can switch" was an overclaim GPT Sol caught, and a
   * check that promises more than it looked at is how the next gap gets missed.
   */
  it("does not claim the subscription can actually be switched", async () => {
    const stripe = fakeStripe([liveConfig()], [[sub("sub_ok", "price_reader")]]);
    const said = (await checkPortal(stripe, TIERS)).map((c) => c.detail).join(" ");
    expect(said).toMatch(/necessary for a switch, not sufficient/);
    expect(said).toMatch(/scheduled, multi-product, usage-based and send-invoice/);
  });

  it("refuses when somebody is grandfathered on a replaced price", async () => {
    const stripe = fakeStripe([liveConfig()], [[sub("sub_old", "price_reader_v1")]]);
    expect(blocking(await checkPortal(stripe, TIERS)).join(" ")).toMatch(
      /1 of 1 unfinished subscription\(s\) bill on a price the Portal does not list \(sub_old\)/,
    );
  });

  /* A cancelled subscriber cannot be stranded — nothing to upgrade. The status
     rule is `isEntitledStatus`, the same one admission uses, rather than a
     second list that could drift from it. */
  it("ignores a subscription that no longer carries entitlement", async () => {
    const stripe = fakeStripe([liveConfig()], [[sub("sub_gone", "price_reader_v1", "canceled")]]);
    expect(blocking(await checkPortal(stripe, TIERS))).toEqual([]);
  });

  it("still counts a past_due subscriber, who is entitled on purpose", async () => {
    const stripe = fakeStripe([liveConfig()], [[sub("sub_late", "price_reader_v1", "past_due")]]);
    expect(blocking(await checkPortal(stripe, TIERS)).join(" ")).toMatch(/sub_late/);
  });

  /**
   * **Subscriber 101 counts.** The first version read one page and reported
   * `has_more` as a `⚠`, which `main` does not fail on — so somebody past the
   * first hundred could be stranded while the check exited 0. A guard built
   * against a bounded read, then made unable to fail. It paginates now, and this
   * is the test that would have caught the warning-shaped version: the stranded
   * subscriber is on the *second* page.
   */
  it("reads past the first page, so subscriber 101 cannot hide", async () => {
    const stripe = fakeStripe([liveConfig()], [[sub("sub_ok", "price_reader")], [sub("sub_101", "price_reader_v1")]]);
    const checks = await checkPortal(stripe, TIERS);
    expect(blocking(checks).join(" ")).toMatch(/sub_101/);
    expect(checks.map((c) => c.detail).join(" ")).not.toMatch(/first page/);
  });

  /**
   * **The finding that would have bitten the live apply.**
   *
   * This used to return early when `subscription_update` was disabled — which is
   * exactly the live account's state today, the whole reason this job exists. So
   * the preflight skipped silently, and `--apply` would then have switched plan
   * changes on with only the current tiers' prices listed, having checked
   * nobody. The check now compares against the catalog `stripe:setup` is about to
   * write, not the one that is there, and runs whether or not switching is on.
   */
  it("still checks when the plan switch is currently OFF, which is the live state", async () => {
    const shut = liveConfig({ subscription_update: { enabled: false } });
    const stripe = fakeStripe([shut], [[sub("sub_old", "price_reader_v1")]]);
    expect(blocking(await checkPortal(stripe, TIERS)).join(" ")).toMatch(
      /1 of 1 unfinished subscription\(s\) bill on a price the Portal does not list \(sub_old\)/,
    );
  });

  /* And the same configuration passes when everyone is on a price the desired
     catalog lists — so the line above is about the subscriber, not about the
     feature being off. */
  it("passes a currently-off configuration when nobody would be left out", async () => {
    const shut = liveConfig({ subscription_update: { enabled: false } });
    const stripe = fakeStripe([shut], [[sub("sub_ok", "price_reader")]]);
    const said = blocking(await checkPortal(stripe, TIERS)).join(" ");
    expect(said).toMatch(/subscription_update.enabled is false/);
    expect(said).not.toMatch(/bill on a price the Portal does not list/);
  });

  /**
   * Retiring a tier is the same fault from the other end: it drops that tier's
   * price out of the desired list, so its subscribers have nowhere to go. Here
   * `researcher` is gone from the tier rows while somebody is still on it.
   */
  it("catches a retired tier whose subscribers would be left with nowhere to go", async () => {
    const stripe = fakeStripe([liveConfig()], [[sub("sub_researcher", "price_researcher")]]);
    expect(blocking(await checkPortal(stripe, [tier()])).join(" ")).toMatch(/sub_researcher/);
  });
});

/**
 * **The composition, which is where the bug actually was.**
 *
 * The check above existed and could never fire, because `main` handed
 * `checkPortal` the output of `offerableTiers` — which drops unpriced tiers
 * before it ever gets there. Testing `checkPortal` with a hand-made list reaches
 * past the filter that caused the fault, so it proved nothing about the script.
 * GPT Sol, 2026-09-03.
 *
 * `tiersToCheck` is that decision, named so a test can hold it.
 */
describe("which tiers each half of the script gets", () => {
  const half = [tier(), tier({ id: "researcher", stripePriceId: null, sortOrder: 2 })];

  it("keeps an unpriced active tier for the Portal, and drops it for the pricing checks", () => {
    const { sellable, portal } = tiersToCheck(half);
    expect(sellable.map((t) => t.id)).toEqual(["reader"]);
    expect(portal.map((t) => t.id)).toEqual(["reader", "researcher"]);
  });

  it("drops an inactive tier from both", () => {
    const retired = [tier(), tier({ id: "old", active: false, sortOrder: 3 })];
    const { sellable, portal } = tiersToCheck(retired);
    expect(sellable.map((t) => t.id)).toEqual(["reader"]);
    expect(portal.map((t) => t.id)).toEqual(["reader"]);
  });

  /* End to end through the composition: the list `main` would build, fed to the
     function `main` feeds it to, must produce the blocking line. */
  it("makes a partly-priced tier set blocking, by the route the script takes", async () => {
    const checks = await checkPortal(fakeStripe([liveConfig()]), tiersToCheck(half).portal);
    /* The tier id is the `what` column, so assert the whole row — matching only
       `detail` would pass without ever naming which tier is unconfigured. */
    expect(checks).toContainEqual({
      mark: "✗",
      what: "researcher",
      detail: "no Stripe price on the row, so the Portal cannot offer a switch to it",
    });
  });

  /**
   * **`products` is absent from Stripe's reply unless expanded** — not empty,
   * missing. So the check must ask for it, or a correct configuration reads as
   * one with nowhere to switch to.
   */
  it("asks Stripe to expand products, because an unexpanded read looks empty", async () => {
    const asked: unknown[] = [];
    const stripe = {
      billingPortal: {
        configurations: {
          list: async (params: unknown) => {
            asked.push(params);
            return { data: [liveConfig()] };
          },
        },
      },
      prices: { retrieve: async (id: string) => ({ id, product: PRODUCT_OF[id] ?? "prod_unknown" }) },
      subscriptions: { list: async () => ({ data: [], has_more: false }) },
    } as unknown as StripePortalCheck;
    await checkPortal(stripe, TIERS);
    expect(asked[0]).toMatchObject({ expand: ["data.features.subscription_update.products"] });
  });
});
