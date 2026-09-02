/**
 * What each tier is allowed to do, and how a Stripe subscription becomes one.
 *
 * Pure: no database, no network, no environment beyond the configured price id.
 * Everything here is a decision, so it is all in one small file that can be read
 * in a minute — docs/plans/260902i-stripe-payments-and-subscription-tiers.md.
 *
 * ## The quota is an abuse boundary, not an invoice
 *
 * A subscription is a fixed monthly charge; the ingest count exists to stop one
 * account spending unbounded model money, not to price anything. So it is
 * deliberately generous, and the numbers being finger-in-the-air is fine. Greg,
 * 2026-09-02: *"I'm assuming that most people won't max it out."*
 *
 * **Reading is never limited by any of this.** An account at its ceiling can
 * still read everything it has and everything public; what it cannot do is add
 * something new, which is the only action that spends.
 */

/**
 * The two tiers.
 *
 * A second paid tier is a member of this union, a quota constant, a case in
 * `tierForPrice`, a case in `entitlementFor`, and a price in Stripe. An earlier
 * version of this comment called it "a row here", which made it sound like
 * config; there is no table, and saying so was the sort of comment that costs
 * somebody an afternoon before they find out.
 */
export type Tier = "free" | "reader";

/** Three, lifetime — enough to play with, and no period logic for people who never pay. */
export const FREE_LIFETIME_INGESTS = 3;

/** One hundred per billing period, at $10/month. */
export const READER_PERIOD_INGESTS = 100;

/**
 * What an owner may do right now.
 *
 * **A discriminated union, not a bag of optionals**, and the difference is the
 * whole point. The period is a **half-open** interval `[start, end)`; the free
 * tier has no period, because its allowance is lifetime. Written as two
 * optional fields, "a Reader entitlement with a start and no end" was a state
 * the compiler allowed and no code handled — and an earlier version of this
 * comment claimed the types made them optional *together*, which they did not.
 * GPT Sol caught the claim; this is the fix that makes it true rather than a
 * reword.
 *
 * A caller must treat the free tier as "count everything ever" rather than
 * "count nothing", and now it cannot get there by reading an absent field.
 */
export type Entitlement =
  | { readonly tier: "free"; readonly limit: number }
  | {
      readonly tier: "reader";
      readonly limit: number;
      readonly periodStart: Date;
      readonly periodEnd: Date;
    };

/** Nobody has paid, or nobody could be identified. Never an error — it is a tier. */
export const FREE: Entitlement = { tier: "free", limit: FREE_LIFETIME_INGESTS };

/**
 * The Stripe subscription statuses that carry entitlement.
 *
 * `past_due` is in the list on purpose: a card that failed once is a customer
 * Stripe is still dunning, and cutting them off on the first retry is a worse
 * experience than the few pounds it saves. Dunning is configured so that
 * `past_due` eventually becomes `canceled` or `unpaid`, which are not here.
 *
 * `incomplete` and `incomplete_expired` are absent: those are subscriptions
 * whose *first* payment never succeeded, so nobody has ever paid anything.
 *
 * **Read as an allowlist over raw text**, not as a database enum. Stripe may
 * add a status, and a status this file has never heard of falls to the free
 * tier — which is the direction that costs a customer an email rather than
 * costing us an unbounded bill.
 */
export const ENTITLED_STATUSES: readonly string[] = ["active", "trialing", "past_due"];

/** Does this raw Stripe subscription status carry entitlement? */
export function isEntitledStatus(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && ENTITLED_STATUSES.includes(status);
}

/**
 * Which tier a Stripe price sells, or `null` for a price we do not recognise.
 *
 * Keyed by price id and given the configured id explicitly rather than reading
 * the environment, so this stays pure and a test does not have to stub
 * anything. `null` rather than a throw or a default: an unrecognised price is a
 * real situation — an old price still on a grandfathered subscription, a price
 * created by hand in the dashboard — and the caller's job is to log it and fall
 * to free, never to hand out Reader quota for a price nobody costed.
 */
export function tierForPrice(priceId: string | null | undefined, readerPriceId: string): Tier | null {
  if (!priceId) return null;
  return priceId === readerPriceId ? "reader" : null;
}

/**
 * What that tier allows over the period Stripe says the subscription is in.
 *
 * **A Reader subscription with no readable period comes back as `FREE`**, and
 * that is a deliberate floor rather than the whole answer. It forecloses the
 * appealing bug — "we know they pay, so let them through" — which turns an
 * unreadable period into an uncapped month. What it is *not* is a good outcome
 * for the customer, who has paid and is being metered at three.
 *
 * The caller is what makes that rare: it resyncs from Stripe before asking, and
 * a paid account still without a period after a resync is a fault to surface,
 * not a tier to serve. An earlier version of this comment said the caller
 * "fails closed", which described a caller that did not exist and still does
 * not — the admission wiring is unbuilt. Written this way round so the sentence
 * stays true until it does. GPT Sol, 2026-09-02.
 */
export function entitlementFor(tier: Tier, period?: { start: Date; end: Date }): Entitlement {
  if (tier === "free" || !period) return FREE;
  return {
    tier: "reader",
    limit: READER_PERIOD_INGESTS,
    periodStart: period.start,
    periodEnd: period.end,
  };
}
