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

/** The two tiers. A second paid tier is a row here, a price in Stripe, and nothing else. */
export type Tier = "free" | "reader";

/** Three, lifetime — enough to play with, and no period logic for people who never pay. */
export const FREE_LIFETIME_INGESTS = 3;

/** One hundred per billing period, at $10/month. */
export const READER_PERIOD_INGESTS = 100;

/**
 * What an owner may do right now.
 *
 * `periodStart`/`periodEnd` are a **half-open** interval `[start, end)` and are
 * absent for the free tier, whose period is all of time — so a caller must
 * treat "no period" as "count everything ever" rather than as "count nothing",
 * and the types say which by making them optional together.
 */
export interface Entitlement {
  readonly tier: Tier;
  /** How many new ingests the period allows. */
  readonly limit: number;
  readonly periodStart?: Date;
  readonly periodEnd?: Date;
}

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

/** What that tier allows over the period Stripe says the subscription is in. */
export function entitlementFor(tier: Tier, period?: { start: Date; end: Date }): Entitlement {
  if (tier === "free") return FREE;
  return period
    ? { tier: "reader", limit: READER_PERIOD_INGESTS, periodStart: period.start, periodEnd: period.end }
    : /* A Reader subscription whose period we could not read is not a Reader
         subscription we can meter. The caller resyncs once and then fails
         closed rather than choosing between an unlimited window and a false
         block on somebody who has paid — see the plan's period arithmetic. */
      FREE;
}
