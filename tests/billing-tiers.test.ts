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
import { afterAll, describe, expect, it } from "vitest";

import {
  ENTITLED_STATUSES,
  FREE,
  FREE_LIFETIME_INGESTS,
  choiceRules,
  currenciesOffered,
  entitlementForTier,
  isEntitledStatus,
  offerableTiers,
  quotaRules,
  subscriptionState,
  tierForPrice,
  tiersToOffer,
} from "../src/billing/tiers.js";
import type { Standing, SubscriptionColumns, TierRow } from "../src/billing/tiers.js";
import { standingFor } from "../src/billing/summary.js";
import type { OwnerId } from "../src/owner.js";
import { entitlementFromRow } from "../src/store/pg-billing.js";
import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { readTiers } from "../src/store/pg-tiers.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/**
 * `readTiers` opens the app's pool, so this file closes it —
 * docs/project/testing.md § *The last file's pool is not pollution*.
 */
afterAll(async () => {
  await closeDb();
});

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

/**
 * **What may be sold to whom** — the gate that used to be a boolean.
 *
 * `canCheckout` meant *has no open subscription*, so a paying Reader was drawn
 * no button on either page while Stripe's Portal would have taken the switch
 * (docs/project/billing.md § *Reader → Researcher*). These are the cases that
 * make it tier-aware, and every one of them is over fixture rows: no database,
 * because the decision is arithmetic on the catalogue and nothing else.
 */
/**
 * **May another subscription be sold beside this row?** — the one question that
 * spends money, and the one that used to be asked in two places in two ways.
 *
 * The summary and `startCheckout` each wrote out *a subscription id with a
 * non-terminal status*, while `entitlementFromRow` asks something else entirely
 * and **never reads the id at all**. A row where the two disagreed was
 * schema-valid until 2026-09-05, and it offered a paying Reader the Reader plan
 * through a Checkout Session — GPT Sol, 2026-09-04. These are over fixture rows:
 * the decision is a function of five columns and nothing else.
 */
describe("whether a row already holds a subscription", () => {
  const EMPTY: SubscriptionColumns = {
    stripeSubscriptionId: null,
    status: null,
    priceId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
  };
  const PERIOD_NOW = { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") };

  it("sells to a reader with no row at all, and to one with an empty row", () => {
    expect(subscriptionState(undefined).kind).toBe("sellable");
    expect(subscriptionState(EMPTY).kind).toBe("sellable");
  });

  it("sells again once a subscription is over", () => {
    expect(
      subscriptionState({ ...EMPTY, stripeSubscriptionId: "sub_1", status: "canceled" }).kind,
    ).toBe("sellable");
  });

  it("refuses to sell beside a subscription Stripe may still collect on", () => {
    for (const status of ["active", "past_due", "unpaid", "incomplete", "trialing", null]) {
      expect(
        subscriptionState({ ...EMPTY, stripeSubscriptionId: "sub_1", status }).kind,
        `status ${status}`,
      ).toBe("open");
    }
  });

  /**
   * **The row that would have charged somebody twice.** Every one of the four
   * subscription-derived columns on its own, because the defect needed only
   * `status` and a check that named fewer than all four would leave the next one
   * open.
   */
  it("refuses to decide anything from a row with no subscription behind its facts", () => {
    const facts: Partial<SubscriptionColumns>[] = [
      { status: "active" },
      { priceId: "price_reader" },
      { currentPeriodStart: PERIOD_NOW.start },
      { currentPeriodEnd: PERIOD_NOW.end },
    ];
    for (const fact of facts) {
      const state = subscriptionState({ ...EMPTY, ...fact });
      expect(state.kind, JSON.stringify(fact)).toBe("contradictory");
      /* And it says which column, because the log line is what somebody reads
         when this turns up in production. */
      if (state.kind === "contradictory") {
        expect(state.why).toContain(Object.keys(fact)[0] as string);
      }
    }
  });
});

/**
 * **The wiring**: the same row, through the function `/api/billing/usage`
 * actually calls, and out the other side as a `Purchase`.
 *
 * `standingFor` is the seam the two questions meet at, so this is where a
 * disagreement between them would show up. The database refuses the
 * contradictory row now (tests/billing-usage-route.test.ts), which is why the
 * end-to-end version of this case asserts the refusal rather than the answer —
 * and why the fail-closed behaviour is pinned here, over a fixture, where the
 * state is still reachable.
 */
describe("what a billing row is offered, end to end through the decision", () => {
  /* Its own id, not a memorable one. `…beef` was already claimed by
     tests/public-dispatch.test.ts, and tests/fixture-ids.test.ts refuses a
     uuid two files both spell out — the collision is invisible until two
     suites touch the same row and one of them starts failing for the other
     one's reasons. Nothing here depends on the value. */
  const OWNER = "b1111111-0000-4000-8000-000000000001" as OwnerId;
  const READER = tier({ sortOrder: 10, stripePriceId: "price_reader" });
  const RESEARCHER = tier({
    id: "researcher",
    productName: "Spideryarn Researcher",
    ingestsPerPeriod: 150,
    lookupKey: "spideryarn_researcher_monthly",
    stripePriceId: "price_researcher",
    sortOrder: 20,
  });
  const CATALOGUE = [READER, RESEARCHER];
  const NOW = new Date("2026-09-15T00:00:00Z");

  /** A `billing_accounts` row, with the columns entitlement and selling read. */
  function row(over: Record<string, unknown> = {}) {
    return {
      status: "active",
      priceId: "price_reader",
      currentPeriodStart: new Date("2026-09-01T00:00:00Z"),
      currentPeriodEnd: new Date("2026-10-01T00:00:00Z"),
      stripeSubscriptionId: "sub_1",
      stripeCustomerId: "cus_1",
      quotaLimitDelta: null,
      quotaPeriodStart: null,
      ...over,
    };
  }

  const offerFor = (over: Record<string, unknown> = {}) => {
    const account = row(over);
    return tiersToOffer(CATALOGUE, standingFor(account, CATALOGUE, entitlementFromRow(account, CATALOGUE, NOW), OWNER));
  };

  it("offers a paying Reader the tier above, out of a paid month", () => {
    expect(offerFor()).toMatchObject({ kind: "switch", from: "paid" });
  });

  it("says a trialling Reader's switch is out of a trial", () => {
    /* Which is what makes the sentence beside the button a different sentence —
       `switchingPlan`, src/billing-plan.ts. */
    expect(offerFor({ status: "trialing" })).toMatchObject({ kind: "switch", from: "trial" });
  });

  /**
   * **Nothing at all for the row the database now refuses.** Not `checkout`, and
   * certainly not a list with Reader in it: entitlement reads this row as a
   * paying Reader, so offering them Reader again is a second subscription for a
   * plan they already have. Watched failing through the route on 2026-09-05,
   * which answered `checkout` over `["reader", "researcher"]`.
   */
  it("offers nothing at all when the row claims a plan with no subscription behind it", () => {
    expect(offerFor({ stripeSubscriptionId: null })).toEqual({ kind: "none" });
  });
});

describe("what may be sold to a reader in a given standing", () => {
  const READER = tier({ sortOrder: 10 });
  const RESEARCHER = tier({
    id: "researcher",
    productName: "Spideryarn Researcher",
    ingestsPerPeriod: 150,
    lookupKey: "spideryarn_researcher_monthly",
    stripePriceId: "price_researcher",
    sortOrder: 20,
  });
  const CATALOGUE = [READER, RESEARCHER];
  const idsOf = (purchase: ReturnType<typeof tiersToOffer>): string[] =>
    purchase.kind === "checkout" || purchase.kind === "switch"
      ? purchase.tiers.map((t) => t.id)
      : [];

  it("sells everything on the shelf to somebody with no subscription", () => {
    const purchase = tiersToOffer(CATALOGUE, { kind: "unsubscribed" });
    expect(purchase.kind).toBe("checkout");
    expect(idsOf(purchase)).toEqual(["reader", "researcher"]);
  });

  /* The case the whole change is for. */
  it("offers a Reader the tier above and not the one they are on", () => {
    const purchase = tiersToOffer(CATALOGUE, { kind: "subscribed", on: READER, from: "paid" });
    expect(purchase.kind).toBe("switch");
    expect(idsOf(purchase)).toEqual(["researcher"]);
  });

  it("offers the largest tier nothing, and says so as its own answer", () => {
    expect(tiersToOffer(CATALOGUE, { kind: "subscribed", on: RESEARCHER, from: "paid" })).toEqual({
      kind: "top",
    });
  });

  /**
   * **A tie is not higher.** Two tiers allowing the same number are two ways to
   * pay for the same thing, and a button that takes money and changes nothing is
   * worse than no button.
   */
  it("does not offer a sideways move to a tier that allows the same", () => {
    const twin = tier({ id: "twin", stripePriceId: "price_twin", sortOrder: 15 });
    expect(
      tiersToOffer([READER, twin], { kind: "subscribed", on: READER, from: "paid" }).kind,
    ).toBe("top");
  });

  /**
   * **The trap the row parameter exists for, held by the compiler.**
   *
   * `Entitlement.limit` carries the prorated override a mid-period plan change
   * leaves behind — a Researcher who switched up on day 27 is entitled to 33
   * this month against a tier that sells 150 — and ranking *that* number against
   * the catalogue would offer them the plan they are already on. Taking a row
   * makes the wrong number unpassable, and this is where that stays true: widen
   * the parameter to `number | TierRow` and the `@ts-expect-error` below has
   * nothing to suppress, so `npm run typecheck` goes red (it covers `tests/`,
   * where `vitest` never type-checks anything).
   */
  it("refuses an allowance where it wants the tier, so a prorated number cannot rank", () => {
    // @ts-expect-error — an allowance is not a tier, and that is the point
    const wrong: Standing = { kind: "subscribed", on: 150 };
    expect(wrong.kind).toBe("subscribed");
  });

  /**
   * Nothing is sold beside a subscription that entitles nothing — `unpaid`,
   * `incomplete`, or one whose period we cannot read. That is exactly what the
   * old boolean did for those accounts, kept.
   */
  it("sells nothing beside a subscription it cannot resolve", () => {
    expect(tiersToOffer(CATALOGUE, { kind: "unresolved" })).toEqual({ kind: "none" });
  });

  /* `none`, not `checkout` with an empty list: the emptiness is in the type. */
  it("answers none rather than an empty offer when nothing is on sale", () => {
    expect(tiersToOffer([tier({ stripePriceId: null })], { kind: "unsubscribed" })).toEqual({
      kind: "none",
    });
  });

  /**
   * **Ascending, because nothing downstream will put it right.** `PlanCards`
   * draws plans in the order it is handed them and promotes nothing, so a
   * filter that reordered would read as unrelated offers rather than a ladder.
   */
  it("leaves the order alone, so what survives is still cheapest first", () => {
    const jumbled = [RESEARCHER, READER];
    expect(idsOf(tiersToOffer(jumbled, { kind: "unsubscribed" }))).toEqual([
      "reader",
      "researcher",
    ]);
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

/**
 * **The value that crosses the seam.** `chooseSubscription` ranks on whatever
 * number `allowanceFor` hands it, and it cannot tell which column that came
 * from: wired to `sortOrder` it would still rank, still be deterministic, and
 * still pass every test in tests/billing-subscription.test.ts — while metering a
 * double-subscribed reader on a display-ordering number. The fixture's tier has
 * `ingestsPerPeriod: 20` and `sortOrder: 10` precisely so the two can be told
 * apart here.
 */
describe("what the tier table answers when a subscription is chosen", () => {
  const NOW = new Date("2026-09-15T00:00:00Z");
  const TIERS = [
    tier(),
    tier({
      id: "researcher",
      stripePriceId: "price_researcher",
      ingestsPerPeriod: 150,
      sortOrder: 20,
    }),
  ];

  it("ranks on the allowance the reader bought, not on the display order", () => {
    const rules = choiceRules(TIERS, NOW);
    expect(rules.allowanceFor("price_reader")).toBe(20);
    expect(rules.allowanceFor("price_researcher")).toBe(150);
  });

  it("says null for a price no tier sells, which is what makes it a recognition test too", () => {
    expect(choiceRules(TIERS, NOW).allowanceFor("price_handmade")).toBeNull();
  });

  /* Both allowlists come from this file, so the choice and the checkout gate
     cannot drift apart about what "still collectable" means. */
  it("hands over this file's own status allowlists, and the instant it was given", () => {
    const rules = choiceRules(TIERS, NOW);
    expect([rules.entitled("past_due"), rules.entitled("unpaid")]).toEqual([true, false]);
    expect([rules.terminal("canceled"), rules.terminal("unpaid")]).toEqual([true, false]);
    expect(rules.now).toBe(NOW);
  });

  /**
   * **The same seam, for the same reason, on the other rules object.**
   * `nextQuotaAdjustment` (src/billing/quota-adjustment.ts) measures a mid-period
   * plan change in whatever numbers `allowanceFor` hands it. Wired to
   * `sortOrder` the arithmetic would still run, still telescope and still clamp
   * — and would move a reader's allowance by the difference between two display
   * positions. `20` and `150` against `10` and `20` are what tell them apart.
   */
  it("prorates on the allowance the reader bought, not on the display order", () => {
    const rules = quotaRules(TIERS);
    expect(rules.allowanceFor("price_reader")).toBe(20);
    expect(rules.allowanceFor("price_researcher")).toBe(150);
    expect(rules.allowanceFor("price_handmade")).toBeNull();
  });

  /**
   * The ceiling nothing may exceed, derived from the rows rather than named —
   * so it stays true the day somebody adds a third tier, and so it is not the
   * display order either.
   */
  it("takes its ceiling from the largest allowance any tier sells", () => {
    expect(quotaRules(TIERS).maxAllowance).toBe(150);
    expect(
      quotaRules([
        ...TIERS,
        tier({ id: "archive", stripePriceId: "price_archive", ingestsPerPeriod: 400 }),
      ]).maxAllowance,
    ).toBe(400);
  });

  /**
   * **A tier with no Stripe price cannot be the ceiling**, because no
   * subscription can name a price that does not exist — so a draft row somebody
   * is costing out in `billing_tiers` must not quietly raise the clamp on
   * everybody. A retired *priced* tier still counts: `tierForPrice` matches one,
   * so somebody can still be holding it. GPT Sol, 2026-09-03.
   */
  it("does not let an unpriced draft tier raise the ceiling", () => {
    const withDraft = [...TIERS, tier({ id: "draft", stripePriceId: null, ingestsPerPeriod: 9000 })];
    expect(quotaRules(withDraft).maxAllowance).toBe(150);

    const retired = [...TIERS, tier({ id: "old", stripePriceId: "price_old", ingestsPerPeriod: 200, active: false })];
    expect(quotaRules(retired).maxAllowance).toBe(200);
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

await pgReady({
  suite: "tests/billing-tiers.test.ts",
  tables: ["spideryarn.billing_tiers", "spideryarn.billing_tier_prices"],
});
/**
 * **The invariants that used to be compile-time, against the real rows.**
 *
 * Everything expressible as a CHECK is a CHECK — positive quotas, positive
 * amounts, the id and currency formats, unique lookup keys and price ids. Those
 * hold for every writer including a hand-typed UPDATE, which a test cannot
 * claim. What is left here is what a CHECK cannot say.
 */
describe("the seeded tiers", () => {
  it("has tiers at all, and each is priced in at least one currency", async () => {
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
  it("charges more for more", async () => {
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
  it("prices every active tier in every currency we offer", async () => {
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
  it("prices in round numbers", async () => {
    for (const t of await readTiers()) {
      for (const [currency, amount] of Object.entries(t.amounts)) {
        expect(amount % 50, `${t.id} in ${currency} is ${amount}`).toBe(0);
      }
    }
  });
});
