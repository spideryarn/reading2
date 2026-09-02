/**
 * Reading a Stripe subscription into the handful of fields entitlement needs.
 *
 * **Pure**: no network, no database, no environment. Given a Stripe object it
 * returns either a state we understand or a reason we do not, and the caller
 * (src/billing/sync.ts) is what talks to anything. That split is deliberate —
 * every rule below is a decision about money, and decisions about money should
 * be testable without a Stripe account.
 *
 * ## The billing period is on the *item*, not the subscription
 *
 * Stripe's Basil release (2025-03-31) removed `current_period_start` and
 * `current_period_end` from the Subscription object and moved them onto each
 * subscription item. Code written against the old shape does not fail — it
 * reads `undefined`, and then either stores nothing or stores `NaN`, and the
 * quota window silently becomes wrong. The installed SDK's types agree: the
 * fields are declared on `SubscriptionItems`, and on `Subscriptions` only as a
 * *list filter*. `STRIPE_API_VERSION` in ./stripe.ts is what keeps that true,
 * and `tests/billing-stripe.test.ts` fails if the pin and the SDK drift apart.
 *
 * ## Everything unrecognised falls to free
 *
 * A subscription with two items, a quantity above one, a one-off price, a
 * yearly interval, a period that does not parse — none of these is something
 * this app knows how to meter, and all of them are things a person can create
 * by hand in the Stripe dashboard in about four clicks. So each returns a
 * refusal with a reason, the caller logs it, and the owner keeps the free tier
 * until somebody looks. The other direction — assume Reader and hand out a
 * hundred ingests a month for a price nobody costed — is silent, and it is
 * silent in the direction that costs money.
 */

import type Stripe from "stripe";

/** What a subscription we understand tells us. */
export interface SubscriptionState {
  readonly subscriptionId: string;
  readonly priceId: string;
  /** Raw Stripe status. An allowlist in ./tiers.ts decides what it means. */
  readonly status: string;
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
  readonly cancelAtPeriodEnd: boolean;
  readonly livemode: boolean;
}

/**
 * A subscription read, or the reason it could not be.
 *
 * A discriminated union rather than `SubscriptionState | null`, because "why
 * not" is the whole value of the failure case: it is what gets logged, and what
 * somebody reads three weeks later wondering why a customer who is plainly
 * paying is on the free tier.
 */
export type Reading =
  | { readonly kind: "understood"; readonly state: SubscriptionState }
  | { readonly kind: "unsupported"; readonly why: string };

/** Stripe sends unix seconds; a Date needs milliseconds. */
function at(seconds: number | null | undefined): Date | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Read one subscription.
 *
 * @param subscription as Stripe returned it — never a payload from a webhook
 * event, which describes a moment that may already be over.
 */
export function readSubscription(subscription: Stripe.Subscription): Reading {
  const no = (why: string): Reading => ({ kind: "unsupported", why });

  const items = subscription.items?.data ?? [];
  if (items.length !== 1) {
    /* One item is what we sell. Two is either a plan we did not design or
       somebody adding a line in the dashboard, and either way the period and
       the price become ambiguous rather than merely unknown. */
    return no(`expected exactly one subscription item, found ${items.length}`);
  }

  const item = items[0];
  if (!item) return no("the subscription item was missing");

  /* `quantity` is optional in the API and means one when absent. Anything above
     one is a bulk arrangement nobody has priced. */
  const quantity = item.quantity ?? 1;
  if (quantity !== 1) return no(`expected a quantity of 1, found ${quantity}`);

  const price = item.price;
  if (!price?.id) return no("the subscription item carried no price");
  if (price.type !== "recurring" || !price.recurring) {
    return no(`price ${price.id} is not a recurring price`);
  }
  if (price.recurring.interval !== "month" || (price.recurring.interval_count ?? 1) !== 1) {
    /* Monthly is the only shape the quota's period arithmetic is written for.
       An annual plan is a product decision, not something to infer from a
       price that turned up. */
    return no(
      `price ${price.id} renews every ${price.recurring.interval_count ?? 1} ${price.recurring.interval}(s), not monthly`,
    );
  }

  /* THE ONE THAT MOVED. Read from the item; see the header. */
  const start = at(item.current_period_start);
  const end = at(item.current_period_end);
  if (!start || !end) {
    return no(
      "the subscription item carried no billing period — check STRIPE_API_VERSION against the " +
        "Stripe changelog, because these fields have moved once already",
    );
  }
  if (start >= end) return no("the billing period ends before it starts");

  return {
    kind: "understood",
    state: {
      subscriptionId: subscription.id,
      priceId: price.id,
      status: subscription.status,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
      livemode: subscription.livemode === true,
    },
  };
}

/** Which of a customer's subscriptions is *the* one, and whether that is odd. */
export interface Chosen {
  /** The subscription to store, or null when the customer has none we can use. */
  readonly state: SubscriptionState | null;
  /** Reasons to log. Never empty when something was skipped or is ambiguous. */
  readonly notes: readonly string[];
  /** More than one live subscription: a person should look at this. */
  readonly anomaly: boolean;
}

/**
 * Choose from everything Stripe says this customer has.
 *
 * Listing all of them rather than trusting the one an event named is the point
 * of the whole sync pattern: events arrive out of order, and a `deleted` for a
 * subscription that has already been replaced would otherwise wipe the
 * replacement.
 *
 * **Deterministic, and loud when it has to choose.** Two live subscriptions for
 * one customer should be impossible — checkout is refused while a non-terminal
 * one exists — so if it happens, something is wrong and somebody is being
 * double-charged. Picking the newest is a defensible answer and *not* picking
 * one at all would be worse (it would drop a paying customer to free), but it
 * is never done quietly: `anomaly` is what makes it visible.
 *
 * @param entitled decides which statuses count as live. Passed in rather than
 * imported so this file stays free of the tier table.
 */
export function chooseSubscription(
  subscriptions: readonly Stripe.Subscription[],
  entitled: (status: string) => boolean,
): Chosen {
  const notes: string[] = [];
  const understood: SubscriptionState[] = [];

  for (const subscription of subscriptions) {
    const reading = readSubscription(subscription);
    if (reading.kind === "unsupported") {
      notes.push(`${subscription.id}: ${reading.why}`);
      continue;
    }
    understood.push(reading.state);
  }

  if (understood.length === 0) {
    /* No subscription, or none we can read. Either way the owner is on the free
       tier, and the customer mapping is kept — they may subscribe again, and a
       second Stripe customer for one person is how billing histories split. */
    return { state: null, notes, anomaly: false };
  }

  const live = understood.filter((s) => entitled(s.status));
  if (live.length === 0) {
    /* Cancelled, unpaid, or never completed. Store the most recent anyway, so
       `/profile` and `/admin/users` can say what happened rather than showing
       an account that looks as though it never subscribed. */
    return { state: newest(understood), notes, anomaly: false };
  }
  if (live.length === 1) return { state: live[0] ?? null, notes, anomaly: false };

  notes.push(
    `this customer has ${live.length} live subscriptions (${live.map((s) => s.subscriptionId).join(", ")}) ` +
      "and may be paying more than once — taking the most recent",
  );
  return { state: newest(live), notes, anomaly: true };
}

/**
 * The one whose period started last.
 *
 * By period start rather than by array order: Stripe's list order is documented
 * as newest-first but is not something to build entitlement on, and a stable
 * rule that reads the data means two calls cannot disagree.
 */
function newest(states: readonly SubscriptionState[]): SubscriptionState | null {
  return (
    [...states].sort((a, b) => b.currentPeriodStart.getTime() - a.currentPeriodStart.getTime())[0] ??
    null
  );
}
