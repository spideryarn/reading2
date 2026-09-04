/**
 * **What entitlement means, given tiers that live in the database.**
 *
 * Pure: no database, no network, no environment. The rows come from
 * `src/store/pg-tiers.ts`; everything here is a decision about what they mean,
 * so it can be tested without either.
 *
 * ## The tiers used to be constants here, and are now rows
 *
 * Greg's call, 2026-09-02 — see `billing_tiers` in src/db/schema.ts for the
 * request and the trade. What that removed from this file is the compile-time
 * union of tier names and the constants for their quotas and prices. What it
 * left is the part that was never configuration: **what an entitlement is, and
 * which subscription statuses carry one.**
 *
 * ## The one thing the compiler still guarantees
 *
 * `Entitlement` stays a discriminated union, and the discriminant is
 * free-versus-paid rather than the tier's name. That is deliberate: the
 * property worth keeping was never "the tier is called reader", it was **a paid
 * entitlement has a period and a free one does not**. A caller must treat the
 * free tier as "count everything ever" rather than "count nothing", and it
 * still cannot get there by reading an absent field.
 *
 * The tier's *identity* is now a plain string, because the database says what
 * tiers exist. Everything that consumes one must therefore cope with a name it
 * has never seen — which is the same discipline already applied to Stripe's
 * subscription statuses, and for the same reason.
 */

/* The wire's own union, over the database's row type. One set of arms, written
   where the browser can read it — see `Purchase` for why it is a parameter. */
import type { Purchase } from "../billing-plan.js";
import type { QuotaRules } from "./quota-adjustment.js";
import type { ChoiceRules } from "./subscription.js";

/** A tier's id, as typed by whoever wrote the row. `free` is not one of these. */
export type TierId = string;

/** Three, lifetime — enough to play with, and no period logic for people who never pay. */
export const FREE_LIFETIME_INGESTS = 3;

/**
 * One row of `billing_tiers`, with its prices attached.
 *
 * The shape `src/store/pg-tiers.ts` returns and everything else consumes.
 */
export interface TierRow {
  readonly id: TierId;
  readonly productName: string;
  readonly description: string;
  readonly ingestsPerPeriod: number;
  readonly lookupKey: string;
  /** Null until `scripts/stripe-setup.ts` has created the Stripe price. */
  readonly stripePriceId: string | null;
  readonly livemode: boolean | null;
  readonly active: boolean;
  readonly sortOrder: number;
  /** Currency code → amount in the smallest unit. At least one entry. */
  readonly amounts: Readonly<Record<string, number>>;
}

/**
 * What an owner may do right now.
 *
 * **A discriminated union, not a bag of optionals.** The period is a
 * **half-open** interval `[start, end)`; the free tier has no period, because
 * its allowance is lifetime. Written as two optional fields, "a paid
 * entitlement with a start and no end" was a state the compiler allowed and no
 * code handled.
 */
export type Entitlement =
  | { readonly tier: "free"; readonly limit: number }
  | {
      readonly tier: "paid";
      readonly tierId: TierId;
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
 * tier — the direction that costs a customer an email rather than costing us an
 * unbounded bill.
 */
export const ENTITLED_STATUSES: readonly string[] = ["active", "trialing", "past_due"];

/** Does this raw Stripe subscription status carry entitlement? */
export function isEntitledStatus(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && ENTITLED_STATUSES.includes(status);
}

/**
 * The statuses that mean a subscription is **over**, so another may be sold.
 *
 * A different question from entitlement and a much shorter list. `unpaid` and
 * `past_due` are absent on purpose: both are subscriptions Stripe still holds and
 * may still collect on, so selling a second one beside them charges the reader
 * twice. `incomplete` is absent for the same reason — the first payment may still
 * land — and `incomplete_expired` is here because it never can.
 *
 * Read as an allowlist over raw text, like `ENTITLED_STATUSES`, and a status this
 * file has never heard of counts as **not** terminal: the cost of being wrong
 * that way is a reader sent to the Portal to look at what they have, and the
 * other way is a second subscription nobody asked for.
 */
export const TERMINAL_STATUSES: readonly string[] = ["canceled", "incomplete_expired"];

/**
 * Is this subscription finished, so checkout may sell another?
 *
 * **A null status is not terminal.** That is a row nothing has synced, and the
 * safe reading of "I do not know what this subscription is doing" is to send the
 * reader to the Portal rather than to sell them a second one.
 */
export function isTerminalStatus(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && TERMINAL_STATUSES.includes(status);
}

/**
 * Which tier a Stripe price sells, or `null` for a price we do not recognise.
 *
 * `null` rather than a throw or a default: an unrecognised price is a real
 * situation — an old price still on a grandfathered subscription, a price
 * created by hand in the dashboard, a tier whose row somebody deleted — and the
 * caller's job is to log it and fall to free, never to hand out quota for a
 * price nobody costed.
 *
 * **An inactive tier still matches.** `active` decides what is *offered*, not
 * what is honoured: somebody already subscribed to a retired tier keeps their
 * allowance until they cancel, which is the whole reason retiring is a flag
 * rather than a delete.
 */
export function tierForPrice(
  priceId: string | null | undefined,
  tiers: readonly TierRow[],
): TierRow | null {
  if (!priceId) return null;
  return tiers.find((t) => t.stripePriceId === priceId) ?? null;
}

/**
 * The answers `chooseSubscription` (./subscription.ts) needs about the tiers.
 *
 * **The bridge lives on the side that knows the data.** `subscription.ts` is
 * deliberately free of the tier table, so it asks its questions through
 * callbacks; this is where those callbacks are filled in, once, rather than at
 * each call site — and it is the piece that decides that the ranking key is the
 * **allowance** rather than, say, `sortOrder`, which is a display column that
 * nothing constrains to ascend with what a tier actually sells. The reasoning
 * for that choice is in the header of ./subscription.ts.
 *
 * `now` is a parameter because the caller is what knows when it is asking.
 */
export function choiceRules(tiers: readonly TierRow[], now: Date): ChoiceRules {
  return {
    entitled: isEntitledStatus,
    terminal: isTerminalStatus,
    allowanceFor: allowanceForPrice(tiers),
    now,
  };
}

/**
 * **How many ingests a period this price sells** — the one wiring of a price to
 * an allowance, shared by the two rules objects below and above it.
 *
 * One function because both of them ask the same question and a second spelling
 * would be a second answer: `chooseSubscription` ranks two subscriptions by it,
 * and `nextQuotaAdjustment` measures a plan change by it, and those two must agree
 * about what a price is worth or an upgrade could change which subscription
 * wins *and* how much it is worth by different amounts.
 *
 * `tierForPrice` matches retired tiers too, which is the whole point of retiring
 * being a flag rather than a delete.
 */
function allowanceForPrice(tiers: readonly TierRow[]): (priceId: string | null) => number | null {
  return (priceId) => tierForPrice(priceId, tiers)?.ingestsPerPeriod ?? null;
}

/**
 * The answers `nextQuotaAdjustment` (./quota-adjustment.ts) needs about the tiers.
 *
 * The same bridge as `choiceRules`, for the same reason: the arithmetic that
 * prorates an allowance across a mid-period plan change is a decision about
 * money and should be testable without a database, so the tier table reaches it
 * as two callbacks rather than as rows.
 *
 * **The ceiling is the largest allowance any tier can actually be on**, which is
 * the priced ones. Retired tiers count — `tierForPrice` still matches them, so
 * somebody can still hold one — and a tier with no `stripe_price_id` does not,
 * because no subscription can name a price that does not exist. Deriving it
 * rather than naming a tier is what keeps it true the day somebody adds a third.
 *
 * **The filter is the whole point of the clamp.** Without it a draft row typed
 * into `billing_tiers` — a tier somebody is costing out, with a big allowance
 * and no Stripe price yet — silently raises the ceiling on everybody, and the
 * defensive clamp stops matching the sentence that describes it. GPT Sol,
 * 2026-09-03.
 */
export function quotaRules(tiers: readonly TierRow[]): QuotaRules {
  return {
    allowanceFor: allowanceForPrice(tiers),
    maxAllowance: tiers.reduce(
      (most, tier) => (tier.stripePriceId === null ? most : Math.max(most, tier.ingestsPerPeriod)),
      0,
    ),
  };
}

/** What that tier allows over the period Stripe says the subscription is in. */
export function entitlementForTier(tier: TierRow, period: { start: Date; end: Date }): Entitlement {
  return {
    tier: "paid",
    tierId: tier.id,
    limit: tier.ingestsPerPeriod,
    periodStart: period.start,
    periodEnd: period.end,
  };
}

/** The tiers a pricing page should offer, cheapest first. */
export function offerableTiers(tiers: readonly TierRow[]): readonly TierRow[] {
  return tiers
    .filter((t) => t.active && t.stripePriceId !== null)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Where this reader stands, as far as *selling* is concerned.
 *
 * Three states rather than a row and two booleans, because the middle one is the
 * only one that carries a number and the other two would have to leave it
 * optional. Built in src/billing/summary.ts from the `billing_accounts` row and
 * the entitlement, which is the only place that knows both.
 */
export type Standing =
  /**
   * No subscription, or one that is **over** (`isTerminalStatus`), so a Checkout
   * Session may be sold.
   */
  | { readonly kind: "unsubscribed" }
  /**
   * An open, entitled subscription, **on this row**.
   *
   * The row rather than a number, and that is a guard rather than a
   * convenience: `Entitlement.limit` is not the tier's allowance. A plan change
   * mid-period leaves a **prorated** override on `billing_accounts`
   * (`quotaLimitDelta`, ./quota-adjustment.ts), so a reader who moved to
   * Researcher a fortnight in is entitled to something like 33 this month
   * against a tier that sells 150 — and ranking *that* number against the
   * catalogue would offer them a switch to the tier they are already on. There
   * is no way to hand the wrong number to a parameter that takes a row.
   */
  | { readonly kind: "subscribed"; readonly on: TierRow }
  /**
   * An open subscription that entitles nothing — `unpaid`, `incomplete`, a
   * status Stripe invented since — or one whose stored period has run out, or
   * one on a price no tier sells, so the tier behind it cannot be trusted.
   *
   * Nothing is sold into this state. It is not a judgement about deserving: a
   * second subscription beside one Stripe may still collect on charges the
   * reader twice, and there is nothing to compute *higher* against.
   */
  | { readonly kind: "unresolved" };

/**
 * **What may be sold to a reader in that standing, and through which door.**
 *
 * The gate used to be a boolean meaning *has no open subscription*, which drew
 * a paying Reader no button anywhere while Stripe's Portal would have taken the
 * switch (docs/project/billing.md § *Reader → Researcher*). This is the
 * tier-aware version: **a reader may not buy the tier they are on, and may buy a
 * larger one.**
 *
 * ## Larger is decided by the allowance, and the precedent is already here
 *
 * `ingests_per_period`, not `sort_order` and not price:
 *
 * - **`sort_order` is a display column** and nothing constrains it to ascend
 *   with what a tier actually *sells* — `choiceRules` above says so in as many
 *   words, and it is why the ranking there is the allowance too. It decides the
 *   order these are drawn in and nothing else.
 * - **There is no price to compare.** A tier carries an amount per currency, and
 *   nothing makes them agree about which of two tiers is dearer; picking one
 *   currency to rank by would be picking a country.
 * - **The allowance is what the reader is buying**, it is what
 *   `nextQuotaAdjustment` measures a plan change by, and
 *   `tests/billing-tiers.test.ts` already pins that a dearer tier allows more —
 *   so ranking by it cannot disagree with ranking by price while that holds.
 *
 * **A tie is not higher.** Two tiers allowing 20 a month are two ways to pay for
 * the same thing, and an equal allowance is offered to nobody who already has
 * one — the button would take money and change nothing. The failure direction is
 * a switch we decline to offer rather than one that buys nothing, and the reader
 * still has the Portal. Their own tier is excluded **by name as well**, which is
 * redundant against a strict `>` and is the cheap half of the guard: it holds
 * even if somebody later ranks by something that can tie with itself.
 *
 * ## The order survives the filter
 *
 * `offerableTiers` sorts by `sort_order` and this only ever **filters** that
 * list, so what comes out is still ascending. That matters downstream:
 * `PlanCards` promotes nothing and draws plans in the order it is handed them
 * (`e8d75ac6` — a raised card that jumped the queue read as *$10 / No charge /
 * $50* on a phone), so nothing below here would put a jumbled list right.
 *
 * `top` means *nothing on sale is larger than what you have* — which on an empty
 * catalogue is also true, and is the reading the copy above it should take.
 */
export function tiersToOffer(
  tiers: readonly TierRow[],
  standing: Standing,
): Purchase<TierRow> {
  if (standing.kind === "unresolved") return { kind: "none" };
  const sold = offerableTiers(tiers);
  const list =
    standing.kind === "subscribed"
      ? sold.filter(
          (tier) =>
            tier.id !== standing.on.id && tier.ingestsPerPeriod > standing.on.ingestsPerPeriod,
        )
      : sold;
  /* Destructured rather than indexed, because the non-empty tuple is the whole
     guarantee: this is the one place it is established. */
  const [first, ...rest] = list;
  if (!first) return standing.kind === "subscribed" ? { kind: "top" } : { kind: "none" };
  return {
    kind: standing.kind === "subscribed" ? "switch" : "checkout",
    tiers: [first, ...rest],
  };
}

/**
 * Every currency this deployment can charge in — the union across all tiers.
 *
 * Derived rather than declared, because the currencies *are* the rows now. A
 * currency offered by one tier and not another is a real (if odd) state, and
 * `scripts/stripe-setup.ts` reports it rather than guessing.
 */
export function currenciesOffered(tiers: readonly TierRow[]): readonly string[] {
  const seen = new Set<string>();
  for (const tier of tiers) for (const c of Object.keys(tier.amounts)) seen.add(c);
  return [...seen].sort();
}
