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
 * handful at a time for one paid tier, and they arrive in bursts *per customer*
 * — which is precisely the case the lock exists for. **If that ever stops being
 * true**, the fix is not to drop the lock but to make the write conditional on
 * freshness: keep a monotonic marker from Stripe beside the row and refuse a
 * write older than the one already stored. That is more machinery than this
 * needs today.
 */

import { eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { billingAccounts } from "../db/schema.js";
import { errorFields, log } from "../log.js";
import { chooseSubscription } from "./subscription.js";
import { assertLivemode, stripeClient } from "./stripe.js";
import { isEntitledStatus } from "./tiers.js";

const logger = log("store");

/** What a sync did, for the caller to log and for tests to assert on. */
export type SyncResult =
  /** The customer maps to an owner and their row now matches Stripe. */
  | { readonly kind: "synced"; readonly ownerId: string; readonly status: string | null }
  /**
   * No `billing_accounts` row carries this customer id.
   *
   * **Not an error, and not a success either.** It happens legitimately for a
   * few seconds: Checkout completes, Stripe fires, and our own success callback
   * has not yet written the mapping. The caller answers 5xx so Stripe retries,
   * which is what closes that window. It also happens permanently for a customer
   * created by hand in the dashboard, and Stripe gives up on those after a few
   * days — which is the right outcome for an event about somebody who is not a
   * reader here.
   */
  | { readonly kind: "unmapped"; readonly customerId: string };

/**
 * Bring one customer's row into line with Stripe.
 *
 * @param customerId a `cus_…`, taken from the event only as a lookup key.
 *
 * Idempotent: running it twice produces the same row, which is what makes a
 * Stripe retry safe. "No-op" here means *the same resulting state*, not zero
 * work — it always asks Stripe.
 */
export async function syncSubscriptionFromStripe(customerId: string): Promise<SyncResult> {
  const stripe = stripeClient();

  return await getDb().transaction(
    async (tx) => {
      /* The lock, and the mapping lookup, in one statement. Unlike admission
         there is nothing to create first: a customer we have never heard of is
         not an owner we may invent, so zero rows is an answer rather than a
         race. `billing_accounts.stripe_customer_id` is unique, so this is at
         most one row. */
      const [row] = await tx
        .select({ ownerId: billingAccounts.ownerId })
        .from(billingAccounts)
        .where(eq(billingAccounts.stripeCustomerId, customerId))
        .for("update")
        .limit(1);

      if (!row) return { kind: "unmapped", customerId } satisfies SyncResult;

      /* **All of them, not the one the event named.** A late `deleted` for a
         subscription that has already been replaced would otherwise wipe the
         replacement. `status: "all"` because a cancelled one is still worth
         storing — `/profile` saying "your subscription ended" is a different
         thing from an account that looks as though it never subscribed. */
      const list = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
        expand: ["data.items.data.price"],
      });
      for (const subscription of list.data) {
        assertLivemode(subscription.livemode, `subscription ${subscription.id}`);
      }

      const chosen = chooseSubscription(list.data, isEntitledStatus);
      for (const note of chosen.notes) {
        logger.warn({ customerId, ownerId: row.ownerId, note }, "reading a Stripe subscription");
      }
      if (chosen.anomaly) {
        logger.error(
          { customerId, ownerId: row.ownerId },
          "this customer has more than one live subscription and may be paying twice",
        );
      }

      const state = chosen.state;
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

/** Log a sync failure without letting a Stripe message reach the response. */
export function noteSyncFailure(customerId: string, err: unknown): void {
  logger.error({ customerId, ...errorFields(err) }, "could not sync a customer from Stripe");
}
