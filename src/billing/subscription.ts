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
 * ## A cancellation is a timestamp, and the boolean beside it stays false
 *
 * The same class of drift, found the same way — by a real subscription rather
 * than by a fixture. Cancelling through the hosted Customer Portal sets
 * `cancel_at` and leaves `cancel_at_period_end` at `false`, so code reading only
 * the boolean stores "not cancelling" about a subscription Stripe has already
 * scheduled to end. Nothing errors, and the reader is told their plan renews.
 * Both fields are read here and both are stored; the single answer the browser
 * gets is derived once, by `planEndsAt` in src/billing-plan.ts.
 * docs/project/billing.md § *The first live sale* has the payload.
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
  /**
   * When Stripe will end it, if an ending is already scheduled.
   *
   * **Both this and `cancelAtPeriodEnd` are here because they are two raw
   * Stripe facts, and neither is derivable from the other.** A cancellation
   * through the hosted Customer Portal sets *this* and leaves the boolean
   * `false`; one through the API can do the reverse. Turning the pair into the
   * single question a reader is asking — *when does my plan end* — is
   * `planEndsAt` in src/billing-plan.ts, and it happens in exactly one place so
   * that two interpretations cannot drift apart.
   *
   * See docs/project/billing.md § *The first live sale*: reading only the
   * boolean is how a real cancellation went untold on 2026-09-03.
   */
  readonly cancelAt: Date | null;
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
      /* **`cancel_at`, never `canceled_at`.** The second one is when somebody
         pressed cancel, which for a period-end cancellation is in the past
         while the plan is still running — reading it as an ending would tell a
         paid-up reader their plan finished last Tuesday. */
      cancelAt: at(subscription.cancel_at),
      livemode: subscription.livemode === true,
    },
  };
}

/**
 * What choosing needs to know that this file deliberately does not.
 *
 * Every field is a question about the tier table or the clock, and all of them
 * are passed in so `chooseSubscription` stays pure and the tier rows stay in
 * `src/store/pg-tiers.ts`. **None of them has a default.** The `recognised`
 * predicate that these replace used to default to "recognise everything", and a
 * caller that forgot it dropped a paying reader to free — a permissive default
 * on a decision about money is a bug waiting for its first forgetful caller.
 */
export interface ChoiceRules {
  /** Which raw Stripe statuses carry entitlement — `isEntitledStatus` in ./tiers.ts. */
  readonly entitled: (status: string) => boolean;
  /**
   * Which statuses mean Stripe is finished with the subscription —
   * `isTerminalStatus` in ./tiers.ts.
   *
   * Used only for the anomaly count, and it is the *same* allowlist that
   * `subscriptionState` (./tiers.ts) uses to refuse a second checkout. So
   * the anomaly fires on exactly the thing checkout would have refused to sell
   * beside, which is the property that makes it worth logging at `error`.
   */
  readonly terminal: (status: string) => boolean;
  /**
   * How many ingests a period this price sells, or `null` for a price no tier
   * sells. Both the recognition test and the ranking key, in one question.
   */
  readonly allowanceFor: (priceId: string) => number | null;
  /** The instant the period test is made against. Passed, never read from the clock. */
  readonly now: Date;
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
 * double-charged. Choosing is still better than refusing to (that would drop a
 * paying customer to free), but it is never done quietly: `anomaly` is what
 * makes it visible.
 *
 * ## The order of the sieve, and why the last two steps are in that order
 *
 * understood → entitled → **a price a tier sells** → **a period containing
 * now** → strongest.
 *
 * The reader who holds both tiers is paying for both, so the allowance they get
 * should be the larger — the accident's cost belongs with us, not with them. It
 * used to be the *newest*, which handed a second-tab Reader purchase to
 * somebody already paying for Researcher and metered them at 20.
 *
 * **But strongest-alone is worse than the bug it fixes**, and this is the part
 * to keep: a subscription can be `active` with a period that ended, because an
 * invoice that cannot be *finalised* never enters dunning. Ranked on allowance
 * alone, a stale Researcher beats a current Reader for ever; the stored row then
 * fails the period test in `entitlementFromRow` (src/store/pg-billing.ts), so
 * admission resyncs, this function picks the same stale row again, and the
 * reader gets a 503 rather than the 20 ingests they are paying for. Under-serving
 * is a bad day; locking the account out is a broken product. GPT Sol, 2026-09-03.
 *
 * **And the rule this replaced had the same failure**, which is worth knowing
 * before anybody argues the period test is belt-and-braces. A stale subscription
 * is not always the older one: a Researcher bought on the 20th with a billing
 * anchor on the 25th gets a short initial period, the 20th to the 25th, and if
 * that first invoice cannot be finalised it goes stale with a period start
 * *newer* than the Reader it sits beside — so `newest()` picked it too. The
 * fixture is in tests/billing-subscription.test.ts.
 *
 * The period test here is `start <= now < end` — **the same half-open interval
 * `entitlementFromRow` calls stale**, deliberately, so selection and admission
 * cannot disagree about what "current" means. If one of them changes, both must.
 *
 * ## The ranking key is the allowance, and it is mutable on purpose
 *
 * `billing_tiers.ingests_per_period` is a column somebody can `UPDATE`, so
 * "largest current allowance wins" means an edit to that table can change which
 * subscription a double-subscribed reader is metered on — and because the two
 * subscriptions' periods are not aligned, the switch moves the usage window,
 * which can un-count ingests already taken. That is a real consequence and it is
 * accepted, because:
 *
 * - **the allowance is what the reader bought.** Ranking on it means the rule
 *   can be stated in one sentence a customer would accept — you get the bigger
 *   of the two things you are paying for;
 * - **it only ever runs in an anomaly** that is logged at `error` beside it: one
 *   customer holding two subscriptions at once. Nobody with a single
 *   subscription can be moved by this at all;
 * - **an `UPDATE` to that column already moves every subscriber's limit
 *   mid-period**, because `entitlementFromRow` reads it live. So the *limit*
 *   moving is not new. **The window moving is** — and that is the extra
 *   consequence being accepted here, not waved away: switching the winner
 *   switches the stored period too, and with two subscriptions whose periods do
 *   not align, ingests already spent can fall outside the new window and stop
 *   counting. Confined to the anomaly above, and cheaper than the lockout the
 *   alternatives risk.
 *
 * **`billing_tiers.sort_order` was the alternative and is rejected.** It is not
 * more stable — it is an equally mutable column — and it is a *display* column:
 * ranking entitlement on it would let reordering the pricing page silently
 * change what somebody is metered at, and nothing constrains it to ascend with
 * allowance, so a mis-set row would hand the reader the *smaller* allowance
 * while looking perfectly fine. A genuinely immutable key would have to be a new
 * column that nothing else uses, which is machinery for a case Greg has
 * deliberately left open (billing.md § *Subscribing twice*).
 *
 * ## The anomaly counts what checkout would have refused, not what we entitle
 *
 * Over the **raw** list, before unreadable shapes are dropped, and over
 * non-terminal rather than entitled statuses: an `active` beside an `unpaid` is
 * two invoices Stripe may still collect, and counting only the entitled ones
 * said "nothing to see here" about exactly that. A subscription we cannot read
 * counts too — a shape we do not understand is not a reason to believe nobody is
 * being charged for it.
 */
export function chooseSubscription(
  subscriptions: readonly Stripe.Subscription[],
  rules: ChoiceRules,
): Chosen {
  const { entitled, terminal, allowanceFor, now } = rules;
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

  /* **Counted before anything is filtered**, so a subscription we cannot read
     still counts as one the customer may be paying for. */
  const collectable = subscriptions.filter((s) => !terminal(s.status));
  const anomaly = collectable.length > 1;
  if (anomaly) {
    notes.push(
      `this customer has ${collectable.length} subscriptions Stripe may still collect on ` +
        `(${collectable.map((s) => `${s.id} ${s.status}`).join(", ")}) and may be paying more ` +
        "than once — taking the strongest current one",
    );
  }

  if (understood.length === 0) {
    /* No subscription, or none we can read. Either way the owner is on the free
       tier, and the customer mapping is kept — they may subscribe again, and a
       second Stripe customer for one person is how billing histories split. */
    return { state: null, notes, anomaly };
  }

  const live = understood.filter((s) => entitled(s.status));
  if (live.length === 0) {
    /* Cancelled, unpaid, or never completed. Store the most recent anyway, so
       `/profile` and `/admin/users` can say what happened rather than showing
       an account that looks as though it never subscribed. */
    return { state: newest(understood), notes, anomaly };
  }

  const sellable = live.filter((s) => allowanceFor(s.priceId) !== null);
  if (sellable.length === 0) {
    notes.push(
      `none of this customer's live subscriptions is on a price this build sells ` +
        `(${live.map((s) => s.priceId).join(", ")}) — storing the most recent anyway`,
    );
    return { state: newest(live), notes, anomaly };
  }

  const current = sellable.filter((s) => s.currentPeriodStart <= now && now < s.currentPeriodEnd);
  if (current.length === 0) {
    /* **Diagnostic, not entitlement.** Nothing here can be metered — whatever we
       store, `entitlementFromRow` will call it stale — so the choice is between
       a row that says "your plan ended on the 3rd" and one that says the reader
       never subscribed. The first is more use to them and to whoever reads
       /admin/users. It does mean admission answers 503 until Stripe renews the
       subscription or somebody looks, which is the case Stage 4 of
       docs/plans/260903i-… is about; this note is the only thing that says so. */
    notes.push(
      `none of this customer's live subscriptions has a period containing ${now.toISOString()} ` +
        `(${sellable.map((s) => `${s.subscriptionId} ${s.currentPeriodStart.toISOString()}..${s.currentPeriodEnd.toISOString()}`).join(", ")}) ` +
        "— storing the most recent for diagnosis; it entitles nothing",
    );
    return { state: newest(sellable), notes, anomaly };
  }
  return { state: strongest(current, allowanceFor), notes, anomaly };
}

/**
 * The largest allowance, and a total order underneath it.
 *
 * The tie-breaks matter as much as the key: two subscriptions on the same tier
 * are ranked by later period start and then by id, so the answer cannot depend
 * on the order Stripe happened to list them in. A comparator that returns 0 for
 * two different subscriptions leaves the winner to `sort`'s stability, which is
 * "whatever the array said" wearing a rule's clothes.
 */
function strongest(
  states: readonly SubscriptionState[],
  allowanceFor: (priceId: string) => number | null,
): SubscriptionState | null {
  return (
    [...states].sort((a, b) => {
      /* Only ever called on states that passed the `!== null` filter above. */
      const byAllowance = (allowanceFor(b.priceId) ?? 0) - (allowanceFor(a.priceId) ?? 0);
      if (byAllowance !== 0) return byAllowance;
      const byStart = b.currentPeriodStart.getTime() - a.currentPeriodStart.getTime();
      if (byStart !== 0) return byStart;
      return a.subscriptionId.localeCompare(b.subscriptionId);
    })[0] ?? null
  );
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
    [...states].sort((a, b) => {
      const byStart = b.currentPeriodStart.getTime() - a.currentPeriodStart.getTime();
      /* Same tie-break reasoning as `strongest`: a comparator that returns 0
         hands the decision back to the array order it exists to ignore. */
      return byStart !== 0 ? byStart : a.subscriptionId.localeCompare(b.subscriptionId);
    })[0] ?? null
  );
}
