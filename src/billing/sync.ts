/**
 * **Ask Stripe what is true, and write that down.** One function, for every
 * event.
 *
 * The pattern is t3dotgg/stripe-recommendations', and the reason it is worth
 * copying is that it collapses about 250 event shapes into one code path.
 * Nothing here reads a webhook payload for *state* — only for which customer to
 * ask about. Events arrive out of order, and a handler that applies each
 * payload's contents builds a picture no single event ever described: a
 * `deleted` overtaking an `updated` resurrects a cancelled subscription, and
 * nothing looks wrong afterwards.
 *
 * ## The lock is held across the Stripe call, deliberately
 *
 * Fetch-then-write without serialisation lets a slow handler commit stale state
 * after a fresher one — the same subscription restored after cancellation, or a
 * renewal reverted. So the customer's `billing_accounts` row is locked
 * `for update` *before* Stripe is asked, and released after the write.
 *
 * **This is a trade, and the other side of it is real.** GPT Sol's second review
 * pointed out that holding a pooled connection across a network call is how the
 * pool gets tight: `DATABASE_POOL_MAX` is 5, so five concurrent webhooks for
 * five different customers hold every connection for the length of a Stripe
 * round trip. It does not *deadlock* — the holder needs no second connection —
 * but it queues.
 *
 * We take correctness, because at this scale the throughput cost is
 * hypothetical and the stale-write is not: subscription webhooks arrive a
 * handful at a time across two paid tiers, and they arrive in bursts *per customer*
 * — which is precisely the case the lock exists for. **If that ever stops being
 * true**, the fix is not to drop the lock but to make the write conditional on
 * freshness: keep a monotonic marker from Stripe beside the row and refuse a
 * write older than the one already stored. That is more machinery than this
 * needs today.
 */

import type Stripe from "stripe";

import { eq } from "drizzle-orm";

import { articles } from "./half-units.js";
import { getDb } from "../db/client.js";
import { allTiers } from "../store/pg-tiers.js";
import { billingAccounts } from "../db/schema.js";
import { log } from "../log.js";
import { nextQuotaAdjustment } from "./quota-adjustment.js";
import { chooseSubscription } from "./subscription.js";
import { assertLivemode, stripeClient } from "./stripe.js";
import { choiceRules, quotaRules } from "./tiers.js";

const logger = log("store");

/** What a sync did, for the caller to log and for tests to assert on. */
export type SyncResult =
  /** The customer maps to an owner and their row now matches Stripe. */
  | { readonly kind: "synced"; readonly ownerId: string; readonly status: string | null }
  /**
   * No `billing_accounts` row carries this customer id.
   *
   * **Not an error, and not a success either — and it should be rare.** An
   * earlier version of this said it happens for a few seconds after Checkout
   * completes, while our success callback catches up. That describes a design
   * that is deliberately not built: `startCheckout` (./checkout.ts) commits the
   * customer→owner mapping **before** a Checkout Session naming that customer
   * exists, precisely so this branch is never the ordinary case. A browser
   * return is not a delivery guarantee.
   *
   * What is left here is a customer created by hand in the dashboard, a
   * `stripe trigger` fixture, or a real fault. The caller answers 5xx so Stripe
   * retries; Stripe gives up after a few days, which is the right outcome for an
   * event about somebody who is not a reader here.
   *
   * **`stripe listen` does not retry**, so in local testing this is one delivery
   * lost rather than a window that closes itself.
   */
  | { readonly kind: "unmapped"; readonly customerId: string };

/**
 * **A seam: what Stripe says this customer's subscriptions are.**
 *
 * Injected only by tests, and the default is the real thing, so forgetting to
 * inject cannot make a production build inert — the same reasoning as `sync` on
 * `serveStripeWebhook` (./webhook.ts) and `verify` on `handleApi`.
 *
 * It exists because the quota arithmetic below is about a **transition** — what
 * the row said before, against what Stripe says now — and a transition cannot be
 * exercised by writing a row and reading it back. Testing the pure function
 * alone and trusting the wiring is the exact mistake `tests/billing-tiers.test.ts`
 * exists to stop us making again.
 */
export type ListSubscriptions = (customerId: string) => Promise<Stripe.Subscription[]>;

/**
 * What a caller may tell this function. The test seam, and nothing else.
 *
 * **It briefly carried a `changedAt`**, taken from the delivering event's
 * `created` so that a mid-period plan change could be prorated against the
 * moment it happened rather than the moment we heard. That was removed on
 * 2026-09-04: the event that provokes a sync is not necessarily the event that
 * caused the change the sync then fetches, so the timestamp scaled the wrong
 * transition. ./quota-adjustment.ts § *Why `f` is taken at the sync*.
 */
export interface SyncOptions {
  /** The test seam described above. Never set in production. */
  readonly listSubscriptions?: ListSubscriptions;
}

/**
 * Every subscription this customer has, as Stripe returns them.
 *
 * **All of them, not the one the event named.** A late `deleted` for a
 * subscription that has already been replaced would otherwise wipe the
 * replacement. `status: "all"` because a cancelled one is still worth storing —
 * `/profile` saying "your subscription ended" is a different thing from an
 * account that looks as though it never subscribed.
 *
 * **Paginated, and it was not.** Stripe's page maximum is 100, so a single
 * `limit: 100` says "the first hundred", not "all" — and an older *active*
 * subscription can sit behind a hundred cancelled ones. The cap below is a guard
 * against an unbounded loop rather than a page size; reaching it is a fact worth
 * logging, not a normal outcome. GPT Sol, 2026-09-02.
 */
async function listFromStripe(): Promise<ListSubscriptions> {
  const stripe = await stripeClient();
  return async (customerId) => {
    const subscriptions: Stripe.Subscription[] = [];
    const MAX_SUBSCRIPTIONS = 1000;
    for await (const subscription of stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
      expand: ["data.items.data.price"],
    })) {
      assertLivemode(subscription.livemode, `subscription ${subscription.id}`);
      subscriptions.push(subscription);
      if (subscriptions.length >= MAX_SUBSCRIPTIONS) {
        logger.error(
          { customerId, count: subscriptions.length },
          "stopped reading this customer's subscriptions at the cap — something is very wrong",
        );
        break;
      }
    }
    return subscriptions;
  };
}

/**
 * Bring one customer's row into line with Stripe.
 *
 * @param customerId a `cus_…`, taken from the event only as a lookup key.
 *
 * **Idempotent in entitlement, not in the row.** Running it twice leaves the
 * same subscription, status and period — which is what makes a Stripe retry
 * safe — but `last_synced_at` and `updated_at` move every time, because they
 * record when we asked rather than what we found. An earlier version of this
 * said "the same row", which is the sort of claim somebody later tests and
 * finds false. "No-op" here means the same resulting *entitlement*, never zero
 * work: it always asks Stripe.
 */
export async function syncSubscriptionFromStripe(
  customerId: string,
  options: SyncOptions = {},
): Promise<SyncResult> {
  /* Built out here rather than inside the transaction, exactly where the client
     was before this seam existed: constructing it can throw
     `StripeConfigError`, and that throw belongs outside a transaction it would
     do nothing but roll back. */
  const listSubscriptions = options.listSubscriptions ?? (await listFromStripe());
  /* Read once, before the transaction opens. An empty list is a deployment
     whose setup script has not run, which must not turn a webhook into a 500. */
  const tiers = await allTiers();

  return await getDb().transaction(
    async (tx) => {
      /* The lock, and the mapping lookup, in one statement. Unlike admission
         there is nothing to create first: a customer we have never heard of is
         not an owner we may invent, so zero rows is an answer rather than a
         race. `billing_accounts.stripe_customer_id` is unique, so this is at
         most one row. */
      const [row] = await tx
        .select({
          ownerId: billingAccounts.ownerId,
          /* Read under the lock, because the quota arithmetic below is about the
             **transition** — what this row says now, against what Stripe says —
             and the write that replaces them happens in the same transaction.
             Read them outside it and a concurrent sync could apply the same
             plan change twice. */
          stripeSubscriptionId: billingAccounts.stripeSubscriptionId,
          priceId: billingAccounts.priceId,
          currentPeriodStart: billingAccounts.currentPeriodStart,
          quotaLimitDelta: billingAccounts.quotaLimitDelta,
          quotaPeriodStart: billingAccounts.quotaPeriodStart,
        })
        .from(billingAccounts)
        .where(eq(billingAccounts.stripeCustomerId, customerId))
        .for("update")
        .limit(1);

      if (!row) return { kind: "unmapped", customerId } satisfies SyncResult;

      /* Inside the lock, deliberately — see the header. `listFromStripe` is
         what this was before the seam, comment for comment. */
      const subscriptions = await listSubscriptions(customerId);

      /* One instant for the whole write, read here rather than inside, so both
         decisions that govern entitlement stay pure functions of their inputs —
         and so the subscription chosen and the allowance prorated cannot be
         answered against two different moments. What the tier table answers is
         `choiceRules` and `quotaRules` in ./tiers.ts. */
      const now = new Date();
      const chosen = chooseSubscription(subscriptions, choiceRules(tiers, now));
      for (const note of chosen.notes) {
        logger.warn({ customerId, ownerId: row.ownerId, note }, "reading a Stripe subscription");
      }
      if (chosen.anomaly) {
        logger.error(
          { customerId, ownerId: row.ownerId },
          /* **Non-terminal, not live.** The count behind this is subscriptions
             Stripe may still collect on — an `active` beside an `unpaid` is two
             collectable invoices — so saying "live" would send whoever reads
             this looking at the wrong list. The note beside it names them. */
          "this customer has more than one non-terminal subscription and may be paying twice",
        );
      }

      const state = chosen.state;
      /* **The allowance prorates, because the price does.** A mid-period plan
         change moves the limit by what is left of the period, so that upgrading
         with an hour to go buys an hour's worth rather than a month's —
         ./quota-adjustment.ts has the arithmetic, the ordering rule and the
         reasoning. It is decided here and *stored*, so that admission reads an
         integer under its own lock rather than doing time arithmetic there. */
      const quota = nextQuotaAdjustment({
        stored: {
          subscriptionId: row.stripeSubscriptionId,
          priceId: row.priceId,
          currentPeriodStart: row.currentPeriodStart,
          /* Named as a count of articles on the way out of the database, which
             is the unit the column is in — src/billing/half-units.ts. */
          adjustment: {
            delta: row.quotaLimitDelta === null ? null : articles(row.quotaLimitDelta),
            periodStart: row.quotaPeriodStart,
          },
        },
        incoming: state
          ? {
              subscriptionId: state.subscriptionId,
              priceId: state.priceId,
              periodStart: state.currentPeriodStart,
              periodEnd: state.currentPeriodEnd,
            }
          : null,
        now,
        rules: quotaRules(tiers),
      });

      await tx
        .update(billingAccounts)
        .set({
          /* Every field written on every sync, including to null. A partial
             update is how a cancelled subscription keeps a period that makes it
             look current. */
          stripeSubscriptionId: state?.subscriptionId ?? null,
          priceId: state?.priceId ?? null,
          status: state?.status ?? null,
          currentPeriodStart: state?.currentPeriodStart ?? null,
          currentPeriodEnd: state?.currentPeriodEnd ?? null,
          cancelAtPeriodEnd: state?.cancelAtPeriodEnd ?? false,
          /* **Null on every sync that finds no ending**, which is what makes an
             un-cancelled subscription stop claiming a date it once had. A
             reader who cancels and then changes their mind in the Portal is
             exactly the case a partial update would leave saying "ends on the
             3rd" for ever. */
          cancelAt: state?.cancelAt ?? null,
          /* **In the same statement as `price_id` and the period**, which is
             what makes a redelivered webhook safe: the delta is measured from
             the stored price, so a second delivery that found the old price
             still there would pay the difference out twice. No branch of
             `nextQuotaAdjustment` skips this write — every field on every sync,
             as above. */
          quotaLimitDelta: quota.delta,
          quotaPeriodStart: quota.periodStart,
          livemode: state?.livemode ?? null,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(billingAccounts.ownerId, row.ownerId));

      return {
        kind: "synced",
        ownerId: row.ownerId,
        status: state?.status ?? null,
      } satisfies SyncResult;
    },
    /* Pinned, as everywhere else in the store. */
    { isolationLevel: "read committed" },
  );
}
