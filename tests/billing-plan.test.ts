/**
 * **What `/profile` says about a plan**, and the one sentence it must never say.
 *
 * The free allowance is lifetime and includes paid months (Greg, 2026-09-03), so
 * a reader who took forty articles on Reader and cancelled is permanently past
 * the free three. That is the policy. Rendered as *"40 of 3 used"* it reads as
 * arithmetic going wrong, and the plan doc says so in as many words:
 *
 * > `/profile` and the refusal must say *"your plan has ended — resubscribe to
 * > add more"* and must **not** render "40 of 3 used", which reads as a bug
 * > rather than a policy.
 *
 * The type already makes it unbuildable — the `lapsed` arm of `ReaderPlan` has
 * no `used` field — so what is tested here is the second half: that the words
 * chosen for it do not reconstruct the shape from the numbers that *are* there,
 * and that they say what the API's own `pay-lapsed` refusal says.
 *
 * No database and no DOM: everything under test is pure
 * (src/billing-plan.ts, src/messages.ts). It runs everywhere, every time, so a
 * skip cannot hide it.
 */
import { describe, expect, it } from "vitest";

import {
  describeAmounts,
  describePlan,
  formatAmount,
  isPurchase,
  planEndsAt,
  readableDate,
  switchingPlan,
} from "../src/billing-plan.js";
import type { ReaderPlan } from "../src/billing-plan.js";
import { QUOTA_CODES, codeOfMessage, ingestQuotaReached, isQuotaRefusal } from "../src/messages.js";
import { BILLING_NOT_AVAILABLE, BILLING_UNREACHABLE, NOTHING_TO_MANAGE } from "../src/messages.js";

/** Everything one plan puts on screen, as one string to make claims about. */
function rendered(plan: ReaderPlan): string {
  const copy = describePlan(plan);
  return `${copy.headline} ${copy.detail ?? ""}`;
}

describe("the lapsed plan, which is the one that must not read as a bug", () => {
  /* The real shape of it: forty articles taken on a paid plan, then cancelled,
     against a free allowance of three. */
  const SPENT: ReaderPlan = { kind: "lapsed", limit: 3, remaining: 0 };

  it("never prints a used-of-limit ratio", () => {
    const words = rendered(SPENT);
    /* Not just the literal "40 of 3" — any ratio at all. The failure this
       guards is somebody adding `used` back to the arm and writing the obvious
       sentence, and "37 of 3" would be exactly as wrong. */
    expect(words).not.toMatch(/\d+\s+of\s+\d+/);
    expect(words).not.toContain("40");
  });

  it("says the plan has ended, that reading is unaffected, and how to add more", () => {
    const words = rendered(SPENT);
    expect(words).toContain("plan has ended");
    /* The two promises the `pay-lapsed` refusal makes, which this page has to
       make as well or the reader gets two accounts of one rule. */
    expect(words).toMatch(/still here/i);
    expect(words).toMatch(/reading is unaffected/i);
    expect(words).toMatch(/resubscrib/i);
  });

  it("agrees with the refusal the API sends for the same account", () => {
    /* Not the same *words* — one is a read-out and the other is a refusal — but
       the same three claims. If either drifts, a reader who is refused an
       article and then opens /profile is told two different stories about one
       rule. */
    const refusal = ingestQuotaReached({ limit: 3, lapsed: true }).message;
    expect(codeOfMessage(refusal)).toBe("pay-lapsed");
    for (const both of [refusal, rendered(SPENT)]) {
      expect(both).toMatch(/resubscrib/i);
      expect(both).not.toMatch(/\d+\s+of\s+\d+/);
    }
  });

  it("shows what is left when the free allowance is not yet spent", () => {
    /* A lapsed account can still have room — somebody who subscribed, added one
       article and cancelled. `remaining` can never exceed `limit`, so the ratio
       here is bounded and true, which is why this case is allowed to have one. */
    const words = rendered({ kind: "lapsed", limit: 3, remaining: 2 });
    expect(words).toContain("plan has ended");
    expect(words).toContain("2 of 3");
  });
});

describe("the other plan states", () => {
  it("counts a free account against its lifetime allowance, and says lifetime", () => {
    const words = rendered({ kind: "free", limit: 3, used: 1, sharedHalfPrice: 0, atLimit: false });
    expect(words).toContain("1 of 3");
    /* The word that stops a reader waiting for the 1st of the month. */
    expect(words).toMatch(/lifetime/i);
    expect(words).not.toMatch(/this month/i);
  });

  /**
   * **A ratio is only true while one ingest costs one article's worth.** Once a
   * public article counts half, eight articles can sit inside an allowance of
   * three — and *"8 of 3 used"* reads as arithmetic going wrong, which is the
   * exact rendering this file's header exists to forbid on the lapsed arm.
   *
   * There is no rounding that fixes it: `ceil(5/2)` says three of three while
   * the wall still admits one, and `floor` says two of three while two and a
   * half are gone. So the second form states the count and the allowance as two
   * facts rather than as a fraction, and nothing on either path divides.
   */
  it("stops printing a ratio once some of the articles are public", () => {
    const words = rendered({
      kind: "free",
      limit: 3,
      used: 6,
      sharedHalfPrice: 6,
      atLimit: true,
    });
    expect(words).not.toContain("6 of 3");
    expect(words).toContain("6 articles added");
    expect(words).toContain("allowance of 3");
    expect(words).toContain("6 of them are public");
    /* **No fraction is ever printed** — Greg's rule, and the reason the whole
       thing is counted in half-units. The words "half an article" are the
       explanation and are not a fraction; `2.5` and `½` are. */
    expect(words).not.toMatch(/½|\d+\.5|\d+\s*\/\s*2/);
    /* And with everything already shared, it must not offer sharing as the way
       out — the false offer, one surface along from `ingestQuotaReached`. */
    expect(words).not.toContain("Sharing more");
  });

  it("offers sharing to somebody at the wall who still has private articles", () => {
    const words = rendered({
      kind: "free",
      limit: 3,
      used: 4,
      sharedHalfPrice: 2,
      atLimit: true,
      /* **The server's answer, not this file's.** Whether sharing would make
         room cannot be worked out from `used` and `sharedHalfPrice` — a charged
         row that predates `ingest_events.article_id` cannot be cheapened at
         all — so the page is told rather than guessing. */
      sharingMakesRoom: true,
    });
    expect(words).toContain("Sharing more");
  });

  /**
   * **The offer is silent without it**, which is the half that matters: the page
   * said *"Sharing more … makes room"* whenever any private article existed, so
   * every reader whose charged rows predate the discount — which is every row
   * charged before 2026-09-05 — was told a way out that does not exist. GPT Sol,
   * 2026-09-05.
   */
  it("says nothing about sharing when the server did not say it would help", () => {
    for (const plan of [
      { used: 4, sharedHalfPrice: 2 },
      { used: 3, sharedHalfPrice: 0 },
    ] as const) {
      const words = rendered({ kind: "free", limit: 3, atLimit: true, ...plan });
      expect(words).not.toContain("Sharing more");
      expect(words).toContain("A subscription is what adds more");
    }
  });

  /**
   * **The ratio comes back the moment everything is unshared, and it must not.**
   *
   * Add six articles, sharing each to reach the permitted six-of-six, then make
   * them all private again: `used` is 6, `sharedHalfPrice` is 0, and the old
   * condition — *nothing shared* — printed *"6 of 3 articles used"*, the exact
   * rendering this file's header forbids. GPT Sol, 2026-09-05.
   */
  it("stops printing a ratio when the count is larger than the allowance", () => {
    const words = rendered({ kind: "free", limit: 3, used: 6, sharedHalfPrice: 0, atLimit: true });
    expect(words).not.toContain("6 of 3");
    expect(words).toContain("6 articles added");
    expect(words).toContain("allowance of 3");
    /* And it explains the count rather than leaving it looking like a fault. */
    expect(words).toContain("None of them is public now");
    expect(words).not.toMatch(/½|\d+\.5|\d+\s*\/\s*2/);
  });

  /**
   * **And it must not say they "fit" when they do not.** Five articles with one
   * still public is nine half-units against a budget of six: over the wall, not
   * inside it.
   */
  it("does not claim a count fits an allowance it is over", () => {
    const words = rendered({ kind: "free", limit: 3, used: 5, sharedHalfPrice: 1, atLimit: true });
    expect(words).not.toContain("fit an allowance");
    expect(words).toContain("One of them is public");
    /* And the case that does fit still says so. */
    expect(rendered({ kind: "free", limit: 3, used: 4, sharedHalfPrice: 2, atLimit: true })).toContain(
      "that is how 4 fit an allowance of 3",
    );
  });

  it("keeps the plain ratio while nothing is shared", () => {
    const words = rendered({ kind: "free", limit: 3, used: 3, sharedHalfPrice: 0, atLimit: true });
    expect(words).toContain("3 of 3");
    /* And says nothing about sharing: a discount nobody has taken is not news. */
    expect(words).not.toMatch(/public/i);
  });

  it("names the tier, the month's count and the renewal date for a paid one", () => {
    const words = rendered({
      kind: "paid",
      tierId: "reader",
      tierName: "Spideryarn Reader",
      limit: 20,
      used: 3,
      sharedHalfPrice: 0,
      atLimit: false,
      periodEnd: "2026-10-03T11:22:33.000Z",
      endsAt: null,
    });
    expect(words).toContain("Spideryarn Reader");
    expect(words).toContain("3 of 20");
    expect(words).toContain("3 October 2026");
    expect(words).toMatch(/starts again/i);
  });

  /** The same fault on the paid arm: forty private articles against Reader's twenty. */
  it("stops printing a ratio on a paid plan whose count is over the allowance", () => {
    const words = rendered({
      kind: "paid",
      tierId: "reader",
      tierName: "Spideryarn Reader",
      limit: 20,
      used: 40,
      sharedHalfPrice: 0,
      atLimit: true,
      periodEnd: "2026-10-03T11:22:33.000Z",
      endsAt: null,
    });
    expect(words).not.toContain("40 of 20");
    expect(words).toContain("40 articles this month, on an allowance of 20");
    expect(words).toContain("None of them is public now");
  });

  it("does not say a cancelled subscription renews — it names the day it ends", () => {
    /* The claim that would be false, and the one the reader was never told:
       until 2026-09-03 the only input was `cancel_at_period_end`, which a
       cancellation through the hosted Portal leaves `false`. See `planEndsAt`
       and docs/project/billing.md § *The first live sale*. */
    const words = rendered({
      kind: "paid",
      tierId: "reader",
      tierName: "Spideryarn Reader",
      limit: 20,
      used: 3,
      sharedHalfPrice: 0,
      atLimit: false,
      periodEnd: "2026-10-03T11:22:33.000Z",
      endsAt: "2026-10-03T11:22:33.000Z",
    });
    expect(words).not.toMatch(/starts again/i);
    expect(words).toMatch(/ends on 3 October 2026/);
    /* **And it does not leave them thinking they lose their library.** The
       product's promise is that reading what you have already added is never
       gated, and a cancellation notice is precisely where somebody fears
       otherwise. */
    expect(words).toMatch(/everything you have added stays/i);
    expect(words).toMatch(/reading is never limited/i);
  });

  /**
   * **An ending that is not the period end.** Stripe permits `cancel_at` at any
   * future moment, so the two dates can differ — and only one of them is true.
   * A version that reached for `periodEnd` whenever it saw a cancellation would
   * pass every other case in this file and name the wrong day here.
   */
  it("names the ending's own date rather than the renewal date", () => {
    const words = rendered({
      kind: "paid",
      tierId: "reader",
      tierName: "Spideryarn Reader",
      limit: 20,
      used: 3,
      sharedHalfPrice: 0,
      atLimit: false,
      periodEnd: "2026-10-03T11:22:33.000Z",
      endsAt: "2026-11-17T09:00:00.000Z",
    });
    expect(words).toContain("17 November 2026");
    expect(words).not.toContain("3 October 2026");
  });

  it("says an administrator has no limit rather than showing them a count", () => {
    const words = rendered({ kind: "exempt" });
    expect(words).not.toMatch(/\d+\s+of\s+\d+/);
    expect(words).toMatch(/no limit/i);
  });

  it("admits it does not know rather than guessing, when the period is stale", () => {
    const words = rendered({ kind: "unknown" });
    expect(words).not.toMatch(/\d+\s+of\s+\d+/);
    expect(words).toMatch(/could not confirm/i);
    /* Because that is the thing somebody reading this line is worried about. */
    expect(words).toMatch(/reading is unaffected/i);
  });

  it("says nothing is metered when the deployment has no Postgres", () => {
    const words = rendered({ kind: "off" });
    expect(words).toMatch(/nothing is metered/i);
  });
});

/**
 * **The one place two Stripe facts become one answer**, and the arithmetic the
 * live bug of 2026-09-03 got wrong by never doing it.
 *
 * Cancelling through the hosted Customer Portal sets `cancel_at` and leaves
 * `cancel_at_period_end` at `false`; cancelling through the API does the
 * reverse. Everything downstream reads only what comes out of here, so these
 * four rows are the whole contract.
 */
describe("when a plan ends", () => {
  const PERIOD_END = new Date("2026-10-03T11:37:09.000Z");
  const CANCEL_AT = new Date("2026-11-17T09:00:00.000Z");

  it("takes the timestamp when the Portal left the boolean false", () => {
    /* The live payload's shape exactly, and the case that was silently missed. */
    expect(
      planEndsAt({ cancelAt: PERIOD_END, cancelAtPeriodEnd: false, currentPeriodEnd: PERIOD_END }),
    ).toEqual(PERIOD_END);
  });

  it("falls back to the period end when only the old boolean says so", () => {
    /* An API cancellation, which is the shape every fixture used to have. */
    expect(
      planEndsAt({ cancelAt: null, cancelAtPeriodEnd: true, currentPeriodEnd: PERIOD_END }),
    ).toEqual(PERIOD_END);
  });

  it("prefers the timestamp over the period end when both say something", () => {
    /* Because a date is an answer and a boolean is only a claim about one —
       and Stripe permits an ending that is not the period end. */
    expect(
      planEndsAt({ cancelAt: CANCEL_AT, cancelAtPeriodEnd: true, currentPeriodEnd: PERIOD_END }),
    ).toEqual(CANCEL_AT);
  });

  it("is null when nothing is scheduled to end, even with a period end sitting there", () => {
    /* The direction that costs money the other way: a renewing subscriber told
       their plan is ending is a cancellation we talked them into. */
    expect(
      planEndsAt({ cancelAt: null, cancelAtPeriodEnd: false, currentPeriodEnd: PERIOD_END }),
    ).toBeNull();
  });

  it("says null rather than inventing a date when the boolean has no period to point at", () => {
    expect(
      planEndsAt({ cancelAt: null, cancelAtPeriodEnd: true, currentPeriodEnd: null }),
    ).toBeNull();
  });
});

describe("prices, which come off a row and are never converted here", () => {
  it("writes whole amounts without decimals, in each currency's own symbol", () => {
    expect(formatAmount("usd", 1000)).toBe("$10");
    expect(formatAmount("gbp", 800)).toBe("£8");
    expect(formatAmount("eur", 900)).toBe("€9");
  });

  it("keeps the decimals when there are any", () => {
    expect(formatAmount("usd", 999)).toBe("$9.99");
  });

  it("asks Intl how many minor units a major one is, rather than dividing by 100", () => {
    /* Stripe stores JPY in whole yen. A hardcoded ÷100 would price a ¥1500 tier
       at ¥15, and nobody would notice until somebody added the row. */
    expect(formatAmount("jpy", 1500)).toBe("¥1,500");
  });

  it("falls back to the code rather than throwing on a currency Intl refuses", () => {
    expect(formatAmount("zzzz", 1234)).toBe("ZZZZ 12.34");
  });

  it("shows every currency a tier is priced in, in a stable order", () => {
    /* All of them rather than one guessed from the locale: hosted Checkout picks
       by the customer's location, so a single number here would be a price we
       then might not charge. */
    expect(describeAmounts({ usd: 1000, gbp: 800, eur: 900 })).toBe("€9 · £8 · $10");
    expect(describeAmounts({ eur: 900, usd: 1000, gbp: 800 })).toBe("€9 · £8 · $10");
  });

  it("reads a date in UTC, so the sentence does not move with the server", () => {
    expect(readableDate("2026-10-03T23:30:00.000Z")).toBe("3 October 2026");
    expect(readableDate("not a date")).toBeNull();
  });
});

describe("which failures get an upgrade link beside them", () => {
  it("recognises all three quota refusals", () => {
    /* Built through `ingestQuotaReached` rather than from literal strings, so
       the day somebody reworks the copy this still asks about the real
       messages. */
    const free = ingestQuotaReached({ limit: 3 }).message;
    const monthly = ingestQuotaReached({ limit: 20, resetAt: new Date("2026-10-03") }).message;
    const lapsed = ingestQuotaReached({ limit: 3, lapsed: true }).message;
    for (const message of [free, monthly, lapsed]) expect(isQuotaRefusal(message)).toBe(true);
    /* And the codes those three carry are exactly the list — so a fourth
       refusal added to `ingestQuotaReached` without being added to `QUOTA_CODES`
       fails here rather than silently losing its link. */
    expect([free, monthly, lapsed].map(codeOfMessage).sort()).toEqual([...QUOTA_CODES].sort());
  });

  it("does not offer an upgrade for the billing failures a subscription cannot fix", () => {
    /* All three are `pay-` codes, which is why this is a list and not a prefix
       test. Nobody buys their way out of a Stripe outage. */
    for (const message of [
      BILLING_NOT_AVAILABLE.message,
      BILLING_UNREACHABLE.message,
      NOTHING_TO_MANAGE.message,
    ]) {
      expect(codeOfMessage(message)?.startsWith("pay-")).toBe(true);
      expect(isQuotaRefusal(message)).toBe(false);
    }
  });

  it("says no to an ordinary failure, and to nothing at all", () => {
    expect(isQuotaRefusal("The fetch timed out. [net-slow]")).toBe(false);
    expect(isQuotaRefusal("Something went wrong")).toBe(false);
    expect(isQuotaRefusal(null)).toBe(false);
    expect(isQuotaRefusal("")).toBe(false);
  });
});

/**
 * **The sentence beside a *Switch plan* button, which is two sentences.**
 *
 * All three claims the paid one makes are false out of a free trial: the Portal
 * is configured `trial_update_behavior: "end_trial"`, so there is no difference
 * to invoice, the current period does not stay where it was, and — because the
 * period start moves — `nextQuotaAdjustment` writes no prorated delta and the
 * reader gets the whole new allowance. GPT Sol, 2026-09-04, finding 2. The quota
 * half is pinned in tests/billing-quota-adjustment.test.ts, where the arithmetic
 * lives; these are the words.
 */
describe("what a switch says it will do", () => {
  it("keeps the paid claims for a paid month", () => {
    const paid = switchingPlan("paid");
    expect(paid).toContain("invoices the difference");
    expect(paid).toContain("your renewal date does not move");
    expect(paid).toContain("part of the month that is left");
  });

  it("makes none of those three claims to somebody on a trial", () => {
    const trial = switchingPlan("trial");
    expect(trial).toContain("ends your free trial");
    expect(trial).not.toContain("invoices the difference");
    expect(trial).not.toContain("your renewal date does not move");
    expect(trial).not.toContain("part of the month that is left");
  });

  it("still says where the press lands, in both", () => {
    /* The one clause that is true of every switch, and the reason the sentence
       exists: the press opens somebody else's page, where the plan has to be
       chosen again. */
    for (const from of ["paid", "trial"] as const) {
      expect(switchingPlan(from)).toContain("Stripe's own billing page");
    }
  });
});

/**
 * **The non-empty tuple, checked at the one place it is not a compile-time
 * claim.**
 *
 * `readJson<BillingSummary>` is `JSON.parse(text) as T` (src/web/lib/api.ts), so
 * during a deploy a browser can receive a body the type says is impossible. A
 * reply carrying the `canCheckout`/`offers` pair `purchase` replaced has no
 * `purchase` at all, and `summary.purchase.kind` on `undefined` throws inside a
 * render. GPT Sol, 2026-09-04, finding 5.
 */
describe("whether a wire body really is a Purchase", () => {
  it("accepts the four shapes the server sends", () => {
    const tier = { id: "reader", name: "Reader", description: "", ingestsPerPeriod: 20, amounts: { usd: 1000 } };
    expect(isPurchase({ kind: "none" })).toBe(true);
    expect(isPurchase({ kind: "top" })).toBe(true);
    expect(isPurchase({ kind: "checkout", tiers: [tier] })).toBe(true);
    expect(isPurchase({ kind: "switch", tiers: [tier], from: "paid" })).toBe(true);
  });

  it("refuses the shape a server from before 2026-09-04 sends", () => {
    /* The real regression: `canCheckout` and `offers`, and no `purchase` — so
       the field this is asked about is `undefined`. */
    expect(isPurchase(undefined)).toBe(false);
    expect(isPurchase(null)).toBe(false);
  });

  it("refuses an offer of nothing dressed as an offer of something", () => {
    /* The tuple's whole point: *there is something to buy, and here are none of
       them* is the state a filtered list beside a boolean could always reach. */
    expect(isPurchase({ kind: "checkout", tiers: [] })).toBe(false);
    expect(isPurchase({ kind: "switch", tiers: [], from: "paid" })).toBe(false);
  });

  it("refuses a switch that does not say which kind of switch it is", () => {
    /* Defaulting it would be the bug: a `switch` from a server that predates
       `from` would be shown the paid sentence, which is the false-copy defect
       found in the same review. */
    const tier = { id: "reader", name: "Reader", description: "", ingestsPerPeriod: 20, amounts: { usd: 1000 } };
    expect(isPurchase({ kind: "switch", tiers: [tier] })).toBe(false);
    expect(isPurchase({ kind: "switch", tiers: [tier], from: "sideways" })).toBe(false);
  });

  it("refuses a door nobody has built", () => {
    expect(isPurchase({ kind: "upgrade" })).toBe(false);
    expect(isPurchase({})).toBe(false);
  });
});
