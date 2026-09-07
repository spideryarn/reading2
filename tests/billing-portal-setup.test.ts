/**
 * The Customer Portal configuration: what we create, and what we do about one
 * that already exists.
 *
 * Two properties are pinned here, and they failed on the live account in
 * opposite ways.
 *
 * **It has to end up as the account default.** `portalUrl`
 * ([`src/billing/checkout.ts`](../src/billing/checkout.ts)) opens a Portal
 * session without naming a configuration, so Stripe gives it whatever the
 * account default is. A configuration that is not the default is dead weight no
 * reader ever sees. That branch cannot be rehearsed —
 * `ensurePortalConfiguration` only creates when the mode has no default at all,
 * which is true of live mode exactly once, on the day we start charging real
 * money. GPT Sol read Stripe's documentation as saying an API-created
 * configuration is *never* the default (2026-09-03); the one on this account
 * carries our own `managed_by` metadata **and** `is_default: true`, so that
 * reading is not right here. Neither reading is worth betting live day on, which
 * is why the script asserts and this pins the assertion.
 *
 * **And an existing one has to be reconciled.** The version before this one
 * returned early the moment a default existed, so editing the `features` block
 * changed what a *fresh* account would get and left the live account untouched —
 * which is how `subscription_update: { enabled: false }` survived on the account
 * taking real money, with no route from Reader to Researcher. The obvious fix
 * (edit the block) looks like it worked, so most of what follows is about the
 * half that has no visible symptom.
 */
import { describe, expect, it } from "vitest";

import {
  FEATURE_DRIFT,
  unfinishedSubscriptions,
  ensurePortalConfiguration,
  ensureTier,
  portalDrift,
  portalFeatures,
  portalProducts,
  portalUpdateFeatures,
  subscribersOn,
} from "../scripts/stripe-setup.js";
import type { StripePortalSetup } from "../scripts/stripe-setup.js";
import type { TierRow } from "../src/billing/tiers.js";

type Config = { id: string; is_default?: boolean };

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

/** Which product each test price belongs to. Two products, as we really sell. */
const PRODUCT_OF: Record<string, string> = {
  price_reader: "prod_reader",
  price_researcher: "prod_researcher",
};

/**
 * The `products` list those tiers should produce, for reuse in expectations.
 *
 * `adjustable_quantity` is sent explicitly off because Stripe defaults it *on*,
 * and quantity multiplies the money while entitlement reads only the price.
 */
const BOTH_PRODUCTS = [
  { product: "prod_reader", prices: ["price_reader"], adjustable_quantity: { enabled: false } },
  { product: "prod_researcher", prices: ["price_researcher"], adjustable_quantity: { enabled: false } },
];

/**
 * The desired state for a **complete** tier set.
 *
 * `unpriced` is part of it, not a diagnostic beside it: an active tier with no
 * Stripe price means the destination list is incomplete, and switching must stay
 * off rather than offer a menu with a plan missing from it.
 */
const want = (products: typeof BOTH_PRODUCTS) => ({ products, unpriced: [] as string[] });

/**
 * A configuration as Stripe returns one, correct unless a test breaks a field.
 *
 * Built from `portalFeatures` rather than typed out, so a field added to what we
 * send is a field this baseline already has — a hand-written "good" fixture is
 * how a drift check quietly stops covering the newest thing it should.
 */
function liveConfig(over: Record<string, unknown> = {}) {
  const f = portalFeatures(want(BOTH_PRODUCTS)) as Record<string, Record<string, unknown>>;
  return {
    id: "bpc_live",
    is_default: true,
    active: true,
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["email", "address"] },
      subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
      subscription_pause: { enabled: false },
      subscription_update: {
        /* Stripe returns `schedule_at_period_end` on every read; we never send it
           on create, so it is spliced in here rather than coming from `f`. */
        ...f.subscription_update,
        schedule_at_period_end: { conditions: [] },
        ...(over.subscription_update as object | undefined),
      },
    },
    /* Only the configuration-level fields a test may override; `subscription_update`
       above belongs to `features` and must not leak out here. */
    ...(over.active === undefined ? {} : { active: over.active }),
  } as never;
}

/**
 * A Stripe stand-in that answers, and records what it was asked.
 *
 * Deliberately not the SDK: what matters is what the script *sends* and how it
 * reads the reply. The real client is checked against `StripePortalSetup` at the
 * call site in the script, so a moved SDK signature is a compile error there
 * rather than a surprise here.
 *
 * `updated` returns the configuration it was *sent*, which is what makes the
 * read-back assertion below meaningful: a fake that always answers "correct"
 * could not tell a landed field from an ignored one.
 */
function fakeStripe(
  existing: Config[],
  created: Config = { id: "bpc_new", is_default: true },
  updateReturns?: unknown,
  /* Whoever is already subscribed. Empty by default, because most of these tests
     are about the configuration rather than about who it would leave out. */
  subscriptions: unknown[] = [],
) {
  const calls = { created: [] as unknown[], updated: [] as unknown[], retrieved: [] as string[] };
  const stripe = {
    billingPortal: {
      configurations: {
        list: async () => ({ data: existing }),
        create: async (params: unknown) => {
          calls.created.push(params);
          return created;
        },
        update: async (id: string, params: { features?: unknown; active?: boolean }) => {
          calls.updated.push({ id, params });
          /* Echoes what it was sent, including `active`, so the read-back is a
             real comparison. `schedule_at_period_end: { conditions: "" }` comes
             straight back as the empty string, which is what Stripe does too —
             and what `portalDrift` must read as "no conditions". */
          return updateReturns ?? { id, is_default: true, active: params.active, features: params.features };
        },
      },
    },
    prices: {
      retrieve: async (id: string) => {
        calls.retrieved.push(id);
        return { id, product: PRODUCT_OF[id] ?? "prod_unknown" };
      },
    },
    subscriptions: { list: async () => ({ data: subscriptions, has_more: false }) },
  } as unknown as StripePortalSetup;
  return { stripe, calls };
}

/** A subscription in the shape the strand check reads. */
const onPrice = (id: string, price: string, status = "active") => ({
  id,
  status,
  items: { data: [{ price: { id: price } }] },
});

const detailOf = (steps: { detail: string }[]) => steps.map((s) => s.detail).join(" | ");

describe("the portal configuration the script creates", () => {
  it("says so when the one it created is the account default", async () => {
    const { stripe, calls } = fakeStripe([], { id: "bpc_new", is_default: true });
    const steps = await ensurePortalConfiguration(TIERS, true, stripe);
    expect(calls.created).toHaveLength(1);
    expect(detailOf(steps)).toMatch(/created bpc_new/);
    expect(detailOf(steps)).toMatch(/is the account default/);
  });

  /**
   * **And it has to be a failure, not just a sentence.** Asserting the prose is
   * what this test used to do, and prose does not set an exit code: `main`
   * printed the warning, then the success footer, and exited 0 over a
   * configuration no reader can reach. GPT Sol, 2026-09-03 — the same class as
   * the refusal, and the test caught nothing because saying the words is not the
   * same as failing.
   */
  it("says loudly when it is NOT the default, because readers would never see it", async () => {
    const { stripe } = fakeStripe([], { id: "bpc_orphan", is_default: false });
    const steps = await ensurePortalConfiguration(TIERS, true, stripe);
    expect(detailOf(steps)).toMatch(/NOT the account default/);
    expect(detailOf(steps)).toMatch(/before selling anything/);
    expect(steps.filter((s) => s.failed)).toHaveLength(1);
  });

  it("does not fail the run when the configuration IS the default", async () => {
    const { stripe } = fakeStripe([], { id: "bpc_new", is_default: true });
    const steps = await ensurePortalConfiguration(TIERS, true, stripe);
    expect(steps.filter((s) => s.failed)).toEqual([]);
  });

  it("cancels at period end, so nobody loses access they have paid for", async () => {
    const { stripe, calls } = fakeStripe([]);
    await ensurePortalConfiguration(TIERS, true, stripe);
    expect(calls.created[0]).toMatchObject({
      features: { subscription_cancel: { enabled: true, mode: "at_period_end" } },
    });
  });

  /**
   * The fields that decide what a plan change costs, asserted together because
   * three of them right and one wrong is still a broken upgrade.
   *
   * The **values** are pinned here deliberately, as the decision of record — a
   * test that only asserted "we sent whatever the constant says" would pass on
   * any value, including one nobody chose. Each is one line to change when the
   * decision changes, which `billing_cycle_anchor` did on 2026-09-03.
   */
  it("sends the plan-change contract as the decision of record", async () => {
    const { stripe, calls } = fakeStripe([]);
    await ensurePortalConfiguration(TIERS, true, stripe);
    expect(calls.created[0]).toMatchObject({
      features: {
        subscription_update: {
          enabled: true,
          default_allowed_updates: ["price"],
          /* The window must NOT move on a switch. "now" restarts it, and
             restarting it is unlimited free quota: Stripe credits unused time,
             so cycling up and down mints a fresh allowance for the credit the
             last switch just returned. */
          billing_cycle_anchor: "unchanged",
          proration_behavior: "always_invoice",
          trial_update_behavior: "end_trial",
          products: BOTH_PRODUCTS,
        },
      },
    });
  });

  it("sends no schedule_at_period_end on create, so neither direction waits for the period end", async () => {
    const { stripe, calls } = fakeStripe([]);
    await ensurePortalConfiguration(TIERS, true, stripe);
    const sent = calls.created[0] as { features: { subscription_update: object } };
    expect(sent.features.subscription_update).not.toHaveProperty("schedule_at_period_end");
  });

  it("expands each price to its product, because the row stores only the price", async () => {
    const { stripe, calls } = fakeStripe([]);
    const { products, unpriced } = await portalProducts(stripe, TIERS);
    expect(calls.retrieved).toEqual(["price_reader", "price_researcher"]);
    expect(products).toEqual(BOTH_PRODUCTS);
    expect(unpriced).toEqual([]);
  });

  it("groups two tiers that share a product into one entry, as Stripe's field is keyed", async () => {
    const { stripe } = fakeStripe([]);
    const shared = [tier({ id: "a", stripePriceId: "price_a" }), tier({ id: "b", stripePriceId: "price_b" })];
    const { products } = await portalProducts(stripe, shared);
    expect(products).toEqual([
      { product: "prod_unknown", prices: ["price_a", "price_b"], adjustable_quantity: { enabled: false } },
    ]);
  });

  /* Stripe turns this on by itself: an apply that never mentioned the field read
     back `{ enabled: true, minimum: 1 }` on every product (sandbox, 2026-09-03). */
  it("turns adjustable_quantity off, because quantity is money entitlement never reads", () => {
    const onByDefault = liveConfig({
      subscription_update: {
        products: [{ ...BOTH_PRODUCTS[0], adjustable_quantity: { enabled: true, minimum: 1, maximum: null } }],
      },
    });
    expect(portalDrift(onByDefault, want([BOTH_PRODUCTS[0]!]))).toEqual([
      "adjustable_quantity is on for prod_reader",
    ]);
  });

  it("names a tier with no Stripe price rather than dropping it silently", async () => {
    const { stripe } = fakeStripe([]);
    const steps = await ensurePortalConfiguration(
      [tier(), tier({ id: "researcher", stripePriceId: null })],
      true,
      stripe,
    );
    expect(detailOf(steps)).toMatch(/tier researcher has no Stripe price yet/);
  });

  it("says what it would do without doing it, on a dry run", async () => {
    const { stripe, calls } = fakeStripe([]);
    const steps = await ensurePortalConfiguration(TIERS, false, stripe);
    expect(calls.created).toEqual([]);
    expect(detailOf(steps)).toMatch(/would create/);
  });
});

describe("reconciling a configuration that already exists", () => {
  it("leaves a matching one alone, and changes nothing", async () => {
    const { stripe, calls } = fakeStripe([liveConfig()]);
    const steps = await ensurePortalConfiguration(TIERS, true, stripe);
    expect(calls.updated).toEqual([]);
    expect(calls.created).toEqual([]);
    expect(detailOf(steps)).toMatch(/bpc_live already matches/);
  });

  /* The exact live fault: the feature off, and the list empty behind it. */
  it("reports the live account's drift without making it, on a dry run", async () => {
    const shut = liveConfig({
      subscription_update: {
        enabled: false,
        default_allowed_updates: [],
        /* The value the live account carried, and the one we now want. It is
           deliberately NOT drift here, so this test proves the other five lines
           are found on their own rather than riding on a sixth. */
        billing_cycle_anchor: "unchanged",
        proration_behavior: "none",
        trial_update_behavior: "continue_trial",
        products: [],
      },
    });
    const { stripe, calls } = fakeStripe([shut]);
    const steps = await ensurePortalConfiguration(TIERS, false, stripe);
    expect(calls.updated).toEqual([]);
    const said = detailOf(steps);
    expect(said).toMatch(/DRIFT — subscription_update.enabled is false/);
    expect(said).toMatch(/DRIFT — default_allowed_updates is \[empty\]/);
    expect(said).toMatch(/DRIFT — proration_behavior is none/);
    expect(said).toMatch(/DRIFT — trial_update_behavior is continue_trial/);
    expect(said).toMatch(/DRIFT — products are empty/);
    expect(said).not.toMatch(/billing_cycle_anchor/);
    expect(said).toMatch(/would update bpc_live\. Nothing has changed yet\./);
  });

  it("fixes it on --apply, sending the whole features block", async () => {
    const shut = liveConfig({ subscription_update: { enabled: false, default_allowed_updates: [] } });
    const { stripe, calls } = fakeStripe([shut]);
    const steps = await ensurePortalConfiguration(TIERS, true, stripe);
    expect(calls.updated).toHaveLength(1);
    expect(calls.updated[0]).toMatchObject({
      id: "bpc_live",
      params: {
        features: {
          subscription_update: {
            enabled: true,
            default_allowed_updates: ["price"],
            billing_cycle_anchor: "unchanged",
            proration_behavior: "always_invoice",
            trial_update_behavior: "end_trial",
            products: BOTH_PRODUCTS,
          },
          subscription_cancel: { enabled: true, mode: "at_period_end" },
        },
      },
    });
    expect(detailOf(steps)).toMatch(/updated bpc_live, and it now reads back correct/);
  });

  /**
   * The one that matters most, and the one a mock normally cannot catch: Stripe
   * answers 200 and the field is not what we sent. A successful-looking apply is
   * not evidence — docs/reusable/silent-success.md.
   */
  it("says so when the update returns 200 and the field did NOT land", async () => {
    const shut = liveConfig({ subscription_update: { enabled: false } });
    const ignored = liveConfig({ subscription_update: { enabled: false } });
    const { stripe } = fakeStripe([shut], undefined, ignored);
    const steps = await ensurePortalConfiguration(TIERS, true, stripe);
    expect(detailOf(steps)).toMatch(/STILL reads back wrong/);
    expect(detailOf(steps)).toMatch(/subscription_update.enabled is false/);
  });

  it("reconciles the features it never used to, not just the plan switch", async () => {
    const handEdited = liveConfig() as unknown as { features: Record<string, unknown> };
    handEdited.features.subscription_cancel = { enabled: true, mode: "immediately" };
    handEdited.features.invoice_history = { enabled: false };
    const drift = portalDrift(handEdited as never, want(BOTH_PRODUCTS));
    expect(drift).toContain("subscription_cancel.mode is immediately, not at_period_end");
    expect(drift).toContain("invoice_history.enabled is false");
  });

  it("reports a hand-set schedule_at_period_end as ordinary, fixable drift", () => {
    const scheduled = liveConfig({
      subscription_update: { schedule_at_period_end: { conditions: [{ type: "decreasing_item_amount" }] } },
    });
    const drift = portalDrift(scheduled, want(BOTH_PRODUCTS));
    expect(drift).toEqual(["schedule_at_period_end has conditions [decreasing_item_amount] and should have none"]);
  });

  /**
   * **The empty string, not an empty array.** `conditions: []` is dropped on the
   * way into the form body, so Stripe answers 200 and the condition survives —
   * measured in the sandbox. `Emptyable<Array<Condition>>` on the *update* params
   * type is what makes `""` sayable; the *create* params type declares the same
   * field as a plain array, which is the read that produced a wrong "this is
   * impossible" finding.
   */
  it("clears schedule_at_period_end on the update path, with the empty string", () => {
    const update = portalUpdateFeatures(want(BOTH_PRODUCTS));
    expect(update.subscription_update?.schedule_at_period_end).toEqual({ conditions: "" });
    /* And not on create, where there is nothing to clear and the field is typed
       without an empty-string member. */
    expect(portalFeatures(want(BOTH_PRODUCTS)).subscription_update).not.toHaveProperty(
      "schedule_at_period_end",
    );
  });

  it("actually sends the clearing form when it reconciles", async () => {
    const scheduled = liveConfig({
      subscription_update: { schedule_at_period_end: { conditions: [{ type: "shortening_interval" }] } },
    });
    const { stripe, calls } = fakeStripe([scheduled]);
    await ensurePortalConfiguration(TIERS, true, stripe);
    expect(calls.updated[0]).toMatchObject({
      params: { features: { subscription_update: { schedule_at_period_end: { conditions: "" } } } },
    });
  });

  /**
   * `trialing` is an entitled status, so `continue_trial` would let a trialling
   * reader switch up to the larger allowance and stay unpaid. Stripe returns the
   * field, and leaving it out of the contract meant a hand-set value survived
   * `--apply` while the run reported success.
   */
  it("pins trial_update_behavior, because a trial that survives a switch is unpaid entitlement", async () => {
    const trialing = liveConfig({ subscription_update: { trial_update_behavior: "continue_trial" } });
    expect(portalDrift(trialing, want(BOTH_PRODUCTS)).join(" ")).toMatch(
      /trial_update_behavior is continue_trial, not end_trial — a trialling reader could switch up and stay unpaid/,
    );
    const { stripe, calls } = fakeStripe([]);
    await ensurePortalConfiguration(TIERS, true, stripe);
    expect(calls.created[0]).toMatchObject({
      features: { subscription_update: { trial_update_behavior: "end_trial" } },
    });
  });

  /** An inactive configuration serves no session, however right its features are. */
  it("catches an inactive configuration, and reactivates it", async () => {
    const dormant = liveConfig({ active: false });
    expect(portalDrift(dormant, want(BOTH_PRODUCTS))).toEqual([
      "the configuration is inactive — it can serve no Portal sessions",
    ]);
    const { stripe, calls } = fakeStripe([dormant]);
    await ensurePortalConfiguration(TIERS, true, stripe);
    expect(calls.updated[0]).toMatchObject({ params: { active: true } });
  });

  /**
   * No priced tier means Stripe will not let the feature be on at all — it
   * answers 400 `parameter_missing` on `products`. So "enabled is false" is the
   * only sendable state when *creating*, and calling it drift would be a
   * complaint every `--apply` repeats and none can act on.
   */
  it("creates a first configuration with the switch off when nothing has a price", async () => {
    const off = liveConfig({ subscription_update: { enabled: false, products: [] } });
    expect(portalDrift(off, want([]))).toEqual([]);
    const { stripe, calls } = fakeStripe([]);
    await ensurePortalConfiguration([tier({ stripePriceId: null })], true, stripe);
    expect(calls.created[0]).toMatchObject({ features: { subscription_update: { enabled: false } } });
  });

  it("catches a products list that reaches only one of the two tiers", () => {
    const half = liveConfig({ subscription_update: { products: [BOTH_PRODUCTS[0]] } });
    const drift = portalDrift(half, want(BOTH_PRODUCTS));
    expect(drift.join(" ")).toMatch(/products are prod_reader\[price_reader\], want /);
  });

  /* Order and grouping are ours to choose and Stripe's to return; only the
     content is the assertion. Otherwise a correct configuration reads as drift
     for ever and `--apply` rewrites it on every run. */
  it("does not call a reordered products list drift", () => {
    const reordered = liveConfig({ subscription_update: { products: [...BOTH_PRODUCTS].reverse() } });
    expect(portalDrift(reordered, want(BOTH_PRODUCTS))).toEqual([]);
  });

  /* Exact equality, not "contains". An extra allowed update is a Portal control
     nobody costed, and `includes("price")` would wave it through. */
  it("refuses a default_allowed_updates list with extras in it", () => {
    const extra = liveConfig({ subscription_update: { default_allowed_updates: ["price", "promotion_code"] } });
    expect(portalDrift(extra, want(BOTH_PRODUCTS)).join(" ")).toMatch(
      /default_allowed_updates is \[price,promotion_code\], not \[price\]/,
    );
  });

  it("refuses a products list carrying a price nobody costed", () => {
    const smuggled = liveConfig({
      subscription_update: {
        products: [{ ...BOTH_PRODUCTS[0], prices: ["price_reader", "price_secret"] }, BOTH_PRODUCTS[1]],
      },
    });
    expect(portalDrift(smuggled, want(BOTH_PRODUCTS)).join(" ")).toMatch(/products are /);
  });
});

/**
 * **Incomplete tier data must not shrink a working configuration.**
 *
 * An active tier with no `stripe_price_id` — a half-finished insert, a run
 * against the wrong database, a price deleted in the dashboard — makes the
 * desired `products` list *smaller* than what the account actually sells.
 * Reconciling against it removes a destination readers can currently switch to,
 * or with none left disables switching altogether: the same fault this stage
 * exists to fix, arrived at from the other side. GPT Sol, 2026-09-03.
 */
describe("when the tier rows are incomplete", () => {
  const HALF = [tier(), tier({ id: "researcher", lookupKey: "researcher", stripePriceId: null, sortOrder: 2 })];

  it("refuses to touch an existing configuration, and changes nothing", async () => {
    const { stripe, calls } = fakeStripe([liveConfig()]);
    const steps = await ensurePortalConfiguration(HALF, true, stripe);
    expect(calls.updated).toEqual([]);
    expect(calls.created).toEqual([]);
    const said = detailOf(steps);
    expect(said).toMatch(/REFUSING to touch bpc_live/);
    expect(said).toMatch(/1 active tier\(s\) have no Stripe price/);
    /* The outcome, not only the words — see the account-default test above. */
    expect(steps.filter((s) => s.failed)).toHaveLength(1);
  });

  it("refuses just as hard when no tier has a price at all", async () => {
    const { stripe, calls } = fakeStripe([liveConfig()]);
    const steps = await ensurePortalConfiguration([tier({ stripePriceId: null })], true, stripe);
    expect(calls.updated).toEqual([]);
    expect(detailOf(steps)).toMatch(/REFUSING to touch bpc_live — no active tier has a Stripe price/);
  });

  /**
   * The refusal protects something that already exists; creating a first
   * configuration is a different situation and still happens. But the switch has
   * to be **off**, and this test did not check that — it asserted only that a
   * configuration was created and no refusal was printed, under a name that says
   * "with the switch off". The code meanwhile enabled switching on the partial
   * list, so the Portal would have offered a menu with Researcher missing. GPT
   * Sol, 2026-09-03: a test whose name describes something it does not check is
   * worse than a missing test, because it reads as covered.
   */
  it("still creates a first configuration, with the switch off", async () => {
    const { stripe, calls } = fakeStripe([]);
    const steps = await ensurePortalConfiguration(HALF, true, stripe);
    expect(calls.created).toHaveLength(1);
    expect(detailOf(steps)).not.toMatch(/REFUSING/);
    /* The assertion the name was always promising. */
    expect(calls.created[0]).toMatchObject({
      features: { subscription_update: { enabled: false } },
    });
    const sent = calls.created[0] as { features: { subscription_update: object } };
    expect(sent.features.subscription_update).not.toHaveProperty("products");
  });

  /**
   * **The write asks who the new menu would leave out, not just the check.**
   *
   * Retiring a tier drops its price from `products` without anybody naming a
   * subscriber, and enabling the feature for the first time has the same shape —
   * which is the live account's state. So the refusal lives here as well as in
   * `stripe:check`: a preflight validates the state you are leaving.
   */
  it("refuses to write a plan menu that would leave a subscriber out", async () => {
    const { stripe, calls } = fakeStripe(
      [liveConfig()],
      undefined,
      undefined,
      [onPrice("sub_retired", "price_retired_tier")],
    );
    const steps = await ensurePortalConfiguration(TIERS, true, stripe);
    expect(calls.updated).toEqual([]);
    expect(calls.created).toEqual([]);
    const said = detailOf(steps);
    expect(said).toMatch(/REFUSING to write the plan menu — 1 unfinished subscription\(s\)/);
    expect(said).toMatch(/sub_retired/);
    expect(steps.filter((s) => s.failed)).toHaveLength(1);
  });

  it("writes it when everybody is on a price the menu will list", async () => {
    const { stripe, calls } = fakeStripe(
      [liveConfig({ subscription_update: { enabled: false } })],
      undefined,
      undefined,
      [onPrice("sub_ok", "price_reader"), onPrice("sub_two", "price_researcher")],
    );
    const steps = await ensurePortalConfiguration(TIERS, true, stripe);
    expect(calls.updated).toHaveLength(1);
    expect(detailOf(steps)).not.toMatch(/REFUSING/);
  });

  /**
   * **The create path, not only the reconcile path.**
   *
   * GPT Sol, 2026-09-04: moving this guard inside `if (found)` would leave every
   * other test green, because nothing exercised a first-time creation against an
   * existing subscriber. An account with no default configuration is exactly the
   * unrehearsed case — it happens once per mode, on the day selling starts.
   */
  it("refuses on a FIRST configuration too, not only when reconciling one", async () => {
    const { stripe, calls } = fakeStripe([], undefined, undefined, [
      onPrice("sub_retired", "price_retired_tier"),
    ]);
    const steps = await ensurePortalConfiguration(TIERS, true, stripe);
    expect(calls.created).toEqual([]);
    expect(detailOf(steps)).toMatch(/REFUSING to write the plan menu/);
    expect(steps.filter((s) => s.failed)).toHaveLength(1);
  });

  /* A cancelled subscriber is not somebody the new menu can fail. */
  it("ignores a finished subscription when deciding whether to write", async () => {
    const { stripe, calls } = fakeStripe(
      [liveConfig({ subscription_update: { enabled: false } })],
      undefined,
      undefined,
      [onPrice("sub_gone", "price_ancient", "canceled")],
    );
    await ensurePortalConfiguration(TIERS, true, stripe);
    expect(calls.updated).toHaveLength(1);
  });

  it("names the unpriced tier so somebody can fix the row", async () => {
    const { stripe } = fakeStripe([]);
    const steps = await ensurePortalConfiguration(HALF, true, stripe);
    expect(detailOf(steps)).toMatch(/tier researcher has no Stripe price yet/);
  });

  /* An enabled configuration sitting on a half-priced tier set is drift, and the
     message says which plan is missing rather than "products differ". */
  it("calls an enabled switch on a half-priced tier set drift", () => {
    expect(portalDrift(liveConfig(), { products: [BOTH_PRODUCTS[0]!], unpriced: ["researcher"] })).toEqual([
      "subscription_update is on while researcher have no Stripe price, so the menu is missing a plan",
    ]);
  });
});

/**
 * **The steps that mean the run did not do its job.**
 *
 * `main` exits non-zero on any step carrying `failed`, so whether a state sets
 * that flag *is* whether a bad run gets noticed. These were narration once, and a
 * refusal printed under a success footer with exit 0 is worse than no refusal.
 *
 * The `SKIPPED` case is here because I reported it as covered when it was not:
 * the sandbox measurement was real, the unit test did not exist. Measured is not
 * tested.
 */
describe("a tier row that sells at no price", () => {
  const priceless = (over: Partial<TierRow> = {}) => tier({ amounts: {}, ...over });

  it("fails the run when the tier is active, because an active row must sell something", async () => {
    const steps = await ensureTier(priceless(), true);
    expect(steps).toEqual([
      {
        what: "reader",
        failed: true,
        detail: "SKIPPED — active but has no rows in billing_tier_prices, so it sells nothing",
      },
    ]);
  });

  /* A retired tier with its prices removed is a normal end state. Failing on it
     would make every later run red for a row nobody sells. */
  it("does NOT fail the run when the tier is retired", async () => {
    const steps = await ensureTier(priceless({ active: false }), true);
    expect(steps.some((s) => s.failed)).toBe(false);
    expect(steps[0]?.detail).toMatch(/retired, so nothing to do/);
  });

  it("says the same thing on a dry run, since the row is wrong either way", async () => {
    const steps = await ensureTier(priceless(), false);
    expect(steps.filter((s) => s.failed)).toHaveLength(1);
  });
});

/**
 * **Nobody is stranded to change a number.**
 *
 * Replacing a price leaves existing subscribers on the old one — deliberate —
 * but the Portal's `products` list only carries each tier's current price. So
 * the replacement manufactures the stranded subscriber `stripe:check` looks for:
 * still paying, no upgrade path, and unrecognised by `tierForPrice`, so they
 * fall to the free allowance.
 */
describe("finding who is still on a price", () => {
  const aSub = (id: string, status: string, ...prices: string[]) =>
    ({ id, status, items: { data: prices.map((p) => ({ price: { id: p } })) } }) as never;

  const lister = (pages: { data: unknown[]; has_more: boolean }[]) => {
    const asked: unknown[] = [];
    let n = 0;
    return {
      asked,
      stripe: {
        subscriptions: {
          list: async (params: unknown) => {
            asked.push(params);
            return pages[n++] ?? { data: [], has_more: false };
          },
        },
      } as never,
    };
  };

  /**
   * **In live mode the replacement is refused without scanning at all.**
   *
   * The scan cannot prove what it would need to: cursor pagination reads a
   * moving list, so a Checkout completing *ahead of the cursor* is never seen —
   * and that window is exactly when a price change makes somebody likely to be
   * buying. Greg's call via the team lead, 2026-09-04: no need to reprice on
   * live, so an honest refusal beats a reassuring scan. It refuses the harmless
   * zero-subscriber case too, which is the accepted price of not having to be
   * right about the race.
   *
   * Driven through `ensureTier` rather than asserted on a helper, because the
   * property is that the refusal happens *before* any subscription is listed.
   */
  it("refuses a live-mode price replacement outright, without listing anybody", async () => {
    const before = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production";
    try {
      let listed = false;
      const row = tier();
      const stripe = {
        prices: {
          list: async () => ({
            data: [
              {
                id: "price_old",
                active: true,
                currency: "usd",
                /* Wrong amount, so `differences` is non-empty and the run reaches
                   the replace decision — which is the branch under test. */
                unit_amount: 1,
                recurring: { interval: "month", interval_count: 1 },
                tax_behavior: "inclusive",
                product: "prod_x",
              },
            ],
          }),
        },
        products: {
          /* Matches the row, so the product-words sync is a no-op and the only
             thing this test can trip over is the refusal. */
          retrieve: async () => ({
            id: "prod_x",
            name: row.productName,
            description: row.description,
            tax_code: "txcd_10103000",
          }),
        },
        subscriptions: {
          list: async () => {
            listed = true;
            return { data: [], has_more: false };
          },
        },
      } as never;
      const steps = await ensureTier(row, false, stripe);
      expect(detailOf(steps)).toMatch(/REFUSING to move reader from price_reader .* this is LIVE/);
      expect(steps.filter((s) => s.failed)).toHaveLength(1);
      /* The point: it did not scan, because a clean scan would not have meant
         anything. */
      expect(listed).toBe(false);
    } finally {
      if (before === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = before;
    }
  });

  it("names every subscription billing on the price", () => {
    const subs = [aSub("sub_a", "active", "price_old"), aSub("sub_b", "active", "price_new")];
    expect(subscribersOn(subs, "price_old")).toEqual(["sub_a"]);
  });

  it("counts a subscription whose second item is on the price", () => {
    expect(subscribersOn([aSub("sub_multi", "active", "price_new", "price_old")], "price_old")).toEqual([
      "sub_multi",
    ]);
  });

  /**
   * **Not-terminal, not entitled**, and the three in the middle are the point.
   *
   * Entitlement answers "may this reader ingest right now"; this answers "could
   * this subscription still bill on this price". `incomplete` becomes active the
   * moment a first payment lands, `paused` resumes, `unpaid` can be reactivated —
   * none entitled today, all still attached to the price about to be replaced.
   * Filtering on entitlement made every one of them invisible to the guard.
   */
  it("keeps every subscription that is not over, not only the entitled ones", async () => {
    const { stripe } = lister([
      {
        data: [
          aSub("sub_active", "active", "p"),
          aSub("sub_late", "past_due", "p"),
          aSub("sub_trial", "trialing", "p"),
          aSub("sub_incomplete", "incomplete", "p"),
          aSub("sub_paused", "paused", "p"),
          aSub("sub_unpaid", "unpaid", "p"),
          aSub("sub_gone", "canceled", "p"),
          aSub("sub_dead", "incomplete_expired", "p"),
        ],
        has_more: false,
      },
    ]);
    expect((await unfinishedSubscriptions(stripe)).map((s) => s.id)).toEqual([
      "sub_active",
      "sub_late",
      "sub_trial",
      "sub_incomplete",
      "sub_paused",
      "sub_unpaid",
    ]);
  });

  /* A status nothing here has heard of counts as not-over, which costs a warning
     rather than a stranded customer. `isTerminalStatus` fails closed. */
  it("keeps a status it has never heard of", async () => {
    const { stripe } = lister([{ data: [aSub("sub_novel", "some_future_status", "p")], has_more: false }]);
    expect((await unfinishedSubscriptions(stripe)).map((s) => s.id)).toEqual(["sub_novel"]);
  });

  /**
   * **Paginates rather than reporting that it did not.** The first version read
   * one page and emitted a `⚠` for `has_more` — non-blocking, so subscriber 101
   * could be stranded while the check exited 0. A guard built against a bounded
   * read, then made unable to fail.
   */
  it("follows every page, and asks for the next one from the last id", async () => {
    const { stripe, asked } = lister([
      { data: [aSub("sub_1", "active", "p"), aSub("sub_2", "active", "p")], has_more: true },
      { data: [aSub("sub_3", "active", "p")], has_more: false },
    ]);
    expect((await unfinishedSubscriptions(stripe)).map((s) => s.id)).toEqual(["sub_1", "sub_2", "sub_3"]);
    expect(asked).toHaveLength(2);
    expect(asked[0]).not.toHaveProperty("starting_after");
    expect(asked[1]).toMatchObject({ starting_after: "sub_2" });
  });

  /* A truncated list from a function whose whole promise is exhaustiveness would
     put the blind spot back one level deeper, so it throws instead. */
  it("throws rather than returning a truncated list when the pages never end", async () => {
    const endless = {
      subscriptions: { list: async () => ({ data: [aSub("sub_x", "active", "p")], has_more: true }) },
    } as never;
    await expect(unfinishedSubscriptions(endless)).rejects.toThrow(/cannot see them all/);
  });

  /**
   * `has_more: true` with an **empty** page: there is no id to continue from, so
   * the loop had nothing to page with and returned what it had. Silent
   * truncation — indistinguishable to the caller from an exhaustive read, which
   * is the whole failure mode this function was written against.
   */
  it("throws when Stripe says there is more but returns an empty page", async () => {
    const { stripe } = lister([
      { data: [aSub("sub_1", "active", "p")], has_more: true },
      { data: [], has_more: true },
    ]);
    await expect(unfinishedSubscriptions(stripe)).rejects.toThrow(/empty page, so this scan is incomplete/);
  });
});

/**
 * **The row moving is the mutation that strands people, and it happens on three
 * paths.** Only one of them was guarded.
 *
 * `billing_tiers.stripe_price_id` is what `tierForPrice` matches against and
 * what the Portal's menu carries, so whoever is left on the old price both loses
 * their upgrade route and stops being recognised as paying at all. The two
 * covered here moved the row with no check whatsoever, and the later Portal
 * guard cannot undo a database write. GPT Sol, 2026-09-04.
 */
describe("moving a tier row onto a different price", () => {
  /**
   * **`apply` is `false` in here on purpose, and it is not cosmetic.**
   *
   * `ensureTier` writes through `recordTierPrice`, which is imported directly
   * rather than injected — so a unit test that passes `apply: true` and gets
   * *past* the guard mutates the real shared local database. That is not
   * hypothetical: mutating the orphan guard away while one of these ran with
   * `apply: true` wrote a fake `price_made` onto the live `reader` row and broke
   * the sandbox scripts until it was put back.
   *
   * The refusals are decided before the `apply` branch, so a dry run exercises
   * every one of them and cannot write anything. If you need `apply: true` here,
   * inject the store first.
   */
  const withSubscribers = (price: object, subs: unknown[], products?: object) =>
    ({
      prices: { list: async () => ({ data: [price] }), create: async () => ({ id: "price_made", livemode: false }) },
      products: {
        retrieve: async () => products ?? { id: "prod_x", name: "Spideryarn Reader", description: "30 articles a month", tax_code: "txcd_10103000" },
        search: async () => ({ data: [{ id: "prod_x" }] }),
        create: async () => ({ id: "prod_x" }),
        update: async () => ({ id: "prod_x" }),
      },
      subscriptions: { list: async () => ({ data: subs, has_more: false }) },
    }) as never;

  /** A price whose numbers already match the row, so nothing is "replaced". */
  const matching = (id: string) => ({
    id,
    active: true,
    livemode: false,
    currency: "usd",
    unit_amount: 1000,
    recurring: { interval: "month", interval_count: 1 },
    tax_behavior: "inclusive",
    currency_options: {},
    product: "prod_x",
  });

  /**
   * **The quiet path.** The lookup key resolves to a price that matches the
   * row's numbers exactly, so `differences()` is empty and no replacement
   * happens — but the row is still moved onto a different id, and whoever is on
   * the old one is stranded by that alone.
   */
  it("refuses when a matching price would move the row out from under a subscriber", async () => {
    const stripe = withSubscribers(matching("price_new"), [onPrice("sub_old", "price_reader")]);
    const steps = await ensureTier(tier(), false, stripe);
    const said = detailOf(steps);
    expect(said).toMatch(/REFUSING to move reader from price_reader to price_new/);
    expect(said).toMatch(/the lookup key resolves here now/);
    expect(said).toMatch(/sub_old/);
    expect(steps.filter((s) => s.failed)).toHaveLength(1);
  });

  it("allows that move when nobody is left on the old price", async () => {
    const stripe = withSubscribers(matching("price_new"), [onPrice("sub_ok", "price_new")]);
    const steps = await ensureTier(tier(), false, stripe);
    expect(detailOf(steps)).not.toMatch(/REFUSING/);
  });

  /* And a cancelled subscriber is not somebody the move can strand. */
  it("ignores a finished subscription on the old price", async () => {
    const stripe = withSubscribers(matching("price_new"), [onPrice("sub_gone", "price_reader", "canceled")]);
    expect(detailOf(await ensureTier(tier(), false, stripe))).not.toMatch(/REFUSING/);
  });

  /**
   * **The creation path.** No price carries the lookup key any more — archived,
   * deleted, or moved by hand — so a fresh one is minted and recorded, moving
   * the row off whatever it named just as surely as a replacement would.
   */
  it("refuses to mint a replacement price when the lookup key has been orphaned", async () => {
    const stripe = {
      prices: { list: async () => ({ data: [] }), create: async () => ({ id: "price_made", livemode: false }) },
      products: { search: async () => ({ data: [] }), create: async () => ({ id: "prod_x" }) },
      subscriptions: { list: async () => ({ data: [onPrice("sub_old", "price_reader")], has_more: false }) },
    } as never;
    const steps = await ensureTier(tier(), false, stripe);
    const said = detailOf(steps);
    expect(said).toMatch(/REFUSING to move reader from price_reader to a new price/);
    expect(said).toMatch(/no price carries lookup key reader any more/);
    expect(steps.filter((s) => s.failed)).toHaveLength(1);
  });

  /* A first-ever setup names no price, so there is nobody to strand and the
     creation path must still work. */
  it("still creates the first price for a row that names none", async () => {
    const stripe = {
      prices: { list: async () => ({ data: [] }), create: async () => ({ id: "price_made", livemode: false }) },
      products: { search: async () => ({ data: [{ id: "prod_x" }] }), create: async () => ({ id: "prod_x" }) },
      subscriptions: { list: async () => ({ data: [], has_more: false }) },
    } as never;
    const steps = await ensureTier(tier({ stripePriceId: null }), false, stripe);
    expect(detailOf(steps)).toMatch(/would create "Spideryarn Reader"/);
    expect(steps.filter((s) => s.failed)).toEqual([]);
  });
});

/**
 * **A sixth Portal feature cannot go unnoticed.**
 *
 * `portalDrift` compared five features with hand-written `if`s. Today's SDK
 * (`stripe@22.6.1`,
 * `node_modules/stripe/esm/resources/BillingPortal/Configurations.d.ts:88`)
 * declares **exactly those five**, so the comparison was complete — by
 * coincidence of nobody having upgraded, which is not a property anything was
 * holding.
 *
 * A sixth feature going unnoticed is precisely how `subscription_update` was
 * missed, at the cost of a paying customer unable to upgrade for a month:
 * docs/postmortems/260904a-four-billing-faults-and-the-witnesses-that-agreed-with-the-code.md.
 * It is the one item in docs/plans/260905b-improve-the-codebase-third-sweep.md
 * § T2.1 with a known customer-facing cost, and it was re-verified as unbuilt
 * by the fourth sweep a day later (260906h § T2.2).
 *
 * The fix is `FEATURE_DRIFT`, a `Record` over
 * `keyof Stripe.BillingPortal.Configuration.Features`: **a sixth feature cannot
 * compile without somebody deciding what to do about it.** That half is a type,
 * so its failure is a `tsc` error rather than anything this file can watch —
 * recorded in
 * docs/plans/260907b-five-class-killers-from-the-postmortems-become-checks.md.
 *
 * What this file adds is the half a type cannot reach: **that each entry in the
 * map actually compares something.** Without it the map is decoration, and the
 * next author, forced to add a key to make the build pass, could satisfy the
 * compiler with a function that returns `[]` — a list that says "compared" over
 * a comparison nobody wrote, which is the shape of every entry in
 * docs/reusable/silent-success.md.
 */
describe("every Portal feature the SDK declares is compared", () => {
  it("has one entry per feature and no more", () => {
    /* The names, spelled out. Deriving them from the same `keyof` the map is
       typed by would make this assertion true of any map at all. */
    expect(Object.keys(FEATURE_DRIFT).sort()).toEqual([
      "customer_update",
      "invoice_history",
      "payment_method_update",
      "subscription_cancel",
      "subscription_update",
    ]);
  });

  /**
   * **Each entry, driven to produce drift**, against a live configuration that
   * is correct except for the one field under test. A key added to satisfy the
   * compiler and left returning `[]` fails here.
   */
  /**
   * **Derived from `FEATURE_DRIFT` itself, not written out again.** GPT Sol
   * found the first version listing the five names here as well as in the
   * census above — two hand-copied lists, so a sixth feature could be added to
   * the map, added to the census, and left out of *this* list, and the entry
   * that compares nothing would pass both. That is the exact silent-success
   * class the map exists to close, reintroduced in its own test.
   */
  it.each(Object.keys(FEATURE_DRIFT).map((name) => [name as keyof typeof FEATURE_DRIFT]))(
    "reports drift when %s is wrong",
    (name) => {
    const live = liveConfig() as unknown as { features: Record<string, Record<string, unknown>> };
    /* `enabled: false` **merged into** the feature rather than replacing it —
       every one of the five carries it, and a replacement would delete the
       neighbouring fields the checks read, so the entry would throw rather than
       report. That is a different red, and it passed for the wrong reason. */
    const features = {
      ...live.features,
      [name]: { ...live.features[name], enabled: false },
    };
    const found = FEATURE_DRIFT[name](features as never, want(BOTH_PRODUCTS));
    expect(found.join(" "), `${name} compared nothing`).toMatch(new RegExp(name));

    /* And the same feature, correct, says nothing — otherwise an entry that
       always reports drift would pass the line above while making
       `stripe:check` permanently and unfixably red. */
      expect(FEATURE_DRIFT[name](live.features as never, want(BOTH_PRODUCTS))).toEqual([]);
    },
  );
});


/**
 * **The other route a sixth feature arrives by**, and the one no type can
 * reach: Stripe's API returning a key the installed SDK does not declare.
 *
 * The fixture above has carried `subscription_pause: { enabled: false }` since
 * it was written, and the SDK's `Features` does not declare it — so this
 * repository already had a live-shaped example of the case, sitting in the test
 * data, uncompared. That is why the rule is *switched on*, not *unrecognised*:
 * an inert legacy key would otherwise make `stripe:check` permanently red under
 * advice (`run stripe:setup --apply`) that cannot remove it.
 */
describe("a Portal feature nothing compares", () => {
  it("says nothing about an unrecognised feature that is off", () => {
    /* The fixture's own `subscription_pause: { enabled: false }`, unchanged. */
    expect(portalDrift(liveConfig(), want(BOTH_PRODUCTS))).toEqual([]);
  });

  it("reports one that is on, because it is a control nobody costed", () => {
    const live = liveConfig() as unknown as { features: Record<string, unknown> };
    const withPause = {
      ...(liveConfig() as unknown as object),
      features: { ...live.features, subscription_pause: { enabled: true } },
    };
    expect(portalDrift(withPause as never, want(BOTH_PRODUCTS))).toEqual([
      "the Portal has subscription_pause switched on and nothing here compares it",
    ]);
  });

  /**
   * **The five it does compare are never reported as uncompared** - otherwise
   * the guard above would fire on every correct configuration, which is the
   * failure mode it was designed around rather than an incidental one.
   */
  it("never reports a feature FEATURE_DRIFT already covers", () => {
    const live = liveConfig() as unknown as { features: Record<string, unknown> };
    for (const name of Object.keys(FEATURE_DRIFT)) {
      const broken = {
        ...(liveConfig() as unknown as object),
        features: { ...live.features, [name]: { ...(live.features[name] as object), enabled: true } },
      };
      expect(portalDrift(broken as never, want(BOTH_PRODUCTS)).join(" ")).not.toContain(
        "nothing here compares it",
      );
    }
  });
});
