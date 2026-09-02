# Review: the Stripe billing code as built

You are reviewing **code that exists**, not a plan. The plan behind it was reviewed by you twice
already and those findings are folded in; do not re-litigate the design unless the code contradicts
it. Product decisions (one paid tier, $10/month for 100 ingests, 3 lifetime free, hard block,
reading never gated) are settled with the owner and are not in scope.

The scoped diff of the source is attached below. Tests exist and pass (120 of them); the two
Postgres-backed suites currently **skip**, because a migration is blocked on an unrelated
snapshot-chain repair — so treat anything that depends on the database as **unverified by
execution** and weight it accordingly.

Answer in this order, and be concrete with file and symbol names:

1. **Anything outright broken** — a bug that would cost money, grant entitlement wrongly, refuse a
   paying customer, or lose a webhook. Rank by severity.
2. **Anything unverified that you would not ship on reasoning alone** — specifically, which of the
   database-dependent paths most needs a test to have actually *run* before this goes near real
   money, and what that test should assert.
3. **Anything simpler.** This repo prefers fewer moving parts. Where have I added machinery that
   earns nothing?
4. **Anything the comments claim that the code does not do.** The comments are long and assertive
   on purpose; a comment that is confidently wrong is worse here than no comment.

## What you need to know about the codebase

- Postgres via Drizzle; the connection pool is deliberately small (`DATABASE_POOL_MAX`, default 5)
  because Supabase's pooler limit is global and serverless multiplies instances.
- Every store transaction is pinned `READ COMMITTED` explicitly. `insert … on conflict do nothing`
  is only an escape from a concurrent writer at that level; at `repeatable read` it raises `40001`
  and nothing retries it.
- A prior postmortem in this repo: *"a row lock is taken on rows the statement returns, so a
  `SELECT … FOR UPDATE` that matches nothing locks nothing"*. `reserveIngest` is written against
  that: it creates the anchor row before locking it. This was measured with two real connections —
  the second transaction blocks for as long as the first holds the row, then reads its committed
  value.
- Jobs are reader-deletable (`DELETE /api/jobs/:id`), which is why quota is not a count of job rows.
- `enqueueOrGet` is **not** a transaction — a bounded retry loop of two pooled statements around
  `on conflict do nothing` — so the reservation id rides the job's own INSERT
  (`jobs.ingest_event_id`) rather than being attached afterwards.
- The route dispatcher is hand-written. `serveApi` has a `try` block; the webhook is an exact
  pre-auth path matched inside it, before `requireUser`.
- Reader-facing failure messages carry a bracketed code and a `kind` (`retry` / `ours` / `bug` /
  `blocked`) which decides whether the interface offers another go.

## The specific things I am least sure about

- **`syncSubscriptionFromStripe` holds a pooled connection across a network call to Stripe.** I
  took correctness (no stale overwrite) over throughput, and wrote down the trade. Is that right at
  a scale of a handful of subscribers, and is the escape hatch I describe (a monotonic freshness
  marker) the right one if it stops being right?
- **`settleReservation` takes a `tx` and is meant to be called from inside the transaction that
  ends the job.** It is not yet wired into `settleIn`. Does its shape actually force that, or can a
  caller trivially use it wrongly?
- **The webhook returns 503 for an unmapped customer** so Stripe retries, on the theory that
  Checkout can fire before our own success callback writes the mapping. Is a retry storm from a
  customer created by hand in the dashboard an acceptable cost?
- **`chooseSubscription` picks the newest live subscription and sets an anomaly flag** when there is
  more than one. Is picking better than refusing?
- **`usageSql` is built with `sql` template interpolation** including `periodStart.toISOString()`.
  I believe those are parameterised by Drizzle rather than concatenated — confirm or deny, because
  if I am wrong that is an injection surface reachable from Stripe-controlled data.

## The diff

```diff
diff --git a/src/billing/subscription.ts b/src/billing/subscription.ts
new file mode 100644
index 0000000..bea7e1a
--- /dev/null
+++ b/src/billing/subscription.ts
@@ -0,0 +1,209 @@
+/**
+ * Reading a Stripe subscription into the handful of fields entitlement needs.
+ *
+ * **Pure**: no network, no database, no environment. Given a Stripe object it
+ * returns either a state we understand or a reason we do not, and the caller
+ * (src/billing/sync.ts) is what talks to anything. That split is deliberate —
+ * every rule below is a decision about money, and decisions about money should
+ * be testable without a Stripe account.
+ *
+ * ## The billing period is on the *item*, not the subscription
+ *
+ * Stripe's Basil release (2025-03-31) removed `current_period_start` and
+ * `current_period_end` from the Subscription object and moved them onto each
+ * subscription item. Code written against the old shape does not fail — it
+ * reads `undefined`, and then either stores nothing or stores `NaN`, and the
+ * quota window silently becomes wrong. The installed SDK's types agree: the
+ * fields are declared on `SubscriptionItems`, and on `Subscriptions` only as a
+ * *list filter*. `STRIPE_API_VERSION` in ./stripe.ts is what keeps that true,
+ * and `tests/billing-stripe.test.ts` fails if the pin and the SDK drift apart.
+ *
+ * ## Everything unrecognised falls to free
+ *
+ * A subscription with two items, a quantity above one, a one-off price, a
+ * yearly interval, a period that does not parse — none of these is something
+ * this app knows how to meter, and all of them are things a person can create
+ * by hand in the Stripe dashboard in about four clicks. So each returns a
+ * refusal with a reason, the caller logs it, and the owner keeps the free tier
+ * until somebody looks. The other direction — assume Reader and hand out a
+ * hundred ingests a month for a price nobody costed — is silent, and it is
+ * silent in the direction that costs money.
+ */
+
+import type Stripe from "stripe";
+
+/** What a subscription we understand tells us. */
+export interface SubscriptionState {
+  readonly subscriptionId: string;
+  readonly priceId: string;
+  /** Raw Stripe status. An allowlist in ./tiers.ts decides what it means. */
+  readonly status: string;
+  readonly currentPeriodStart: Date;
+  readonly currentPeriodEnd: Date;
+  readonly cancelAtPeriodEnd: boolean;
+  readonly livemode: boolean;
+}
+
+/**
+ * A subscription read, or the reason it could not be.
+ *
+ * A discriminated union rather than `SubscriptionState | null`, because "why
+ * not" is the whole value of the failure case: it is what gets logged, and what
+ * somebody reads three weeks later wondering why a customer who is plainly
+ * paying is on the free tier.
+ */
+export type Reading =
+  | { readonly kind: "understood"; readonly state: SubscriptionState }
+  | { readonly kind: "unsupported"; readonly why: string };
+
+/** Stripe sends unix seconds; a Date needs milliseconds. */
+function at(seconds: number | null | undefined): Date | null {
+  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
+  const date = new Date(seconds * 1000);
+  return Number.isNaN(date.getTime()) ? null : date;
+}
+
+/**
+ * Read one subscription.
+ *
+ * @param subscription as Stripe returned it — never a payload from a webhook
+ * event, which describes a moment that may already be over.
+ */
+export function readSubscription(subscription: Stripe.Subscription): Reading {
+  const no = (why: string): Reading => ({ kind: "unsupported", why });
+
+  const items = subscription.items?.data ?? [];
+  if (items.length !== 1) {
+    /* One item is what we sell. Two is either a plan we did not design or
+       somebody adding a line in the dashboard, and either way the period and
+       the price become ambiguous rather than merely unknown. */
+    return no(`expected exactly one subscription item, found ${items.length}`);
+  }
+
+  const item = items[0];
+  if (!item) return no("the subscription item was missing");
+
+  /* `quantity` is optional in the API and means one when absent. Anything above
+     one is a bulk arrangement nobody has priced. */
+  const quantity = item.quantity ?? 1;
+  if (quantity !== 1) return no(`expected a quantity of 1, found ${quantity}`);
+
+  const price = item.price;
+  if (!price?.id) return no("the subscription item carried no price");
+  if (price.type !== "recurring" || !price.recurring) {
+    return no(`price ${price.id} is not a recurring price`);
+  }
+  if (price.recurring.interval !== "month" || (price.recurring.interval_count ?? 1) !== 1) {
+    /* Monthly is the only shape the quota's period arithmetic is written for.
+       An annual plan is a product decision, not something to infer from a
+       price that turned up. */
+    return no(
+      `price ${price.id} renews every ${price.recurring.interval_count ?? 1} ${price.recurring.interval}(s), not monthly`,
+    );
+  }
+
+  /* THE ONE THAT MOVED. Read from the item; see the header. */
+  const start = at(item.current_period_start);
+  const end = at(item.current_period_end);
+  if (!start || !end) {
+    return no(
+      "the subscription item carried no billing period — check STRIPE_API_VERSION against the " +
+        "Stripe changelog, because these fields have moved once already",
+    );
+  }
+  if (start >= end) return no("the billing period ends before it starts");
+
+  return {
+    kind: "understood",
+    state: {
+      subscriptionId: subscription.id,
+      priceId: price.id,
+      status: subscription.status,
+      currentPeriodStart: start,
+      currentPeriodEnd: end,
+      cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
+      livemode: subscription.livemode === true,
+    },
+  };
+}
+
+/** Which of a customer's subscriptions is *the* one, and whether that is odd. */
+export interface Chosen {
+  /** The subscription to store, or null when the customer has none we can use. */
+  readonly state: SubscriptionState | null;
+  /** Reasons to log. Never empty when something was skipped or is ambiguous. */
+  readonly notes: readonly string[];
+  /** More than one live subscription: a person should look at this. */
+  readonly anomaly: boolean;
+}
+
+/**
+ * Choose from everything Stripe says this customer has.
+ *
+ * Listing all of them rather than trusting the one an event named is the point
+ * of the whole sync pattern: events arrive out of order, and a `deleted` for a
+ * subscription that has already been replaced would otherwise wipe the
+ * replacement.
+ *
+ * **Deterministic, and loud when it has to choose.** Two live subscriptions for
+ * one customer should be impossible — checkout is refused while a non-terminal
+ * one exists — so if it happens, something is wrong and somebody is being
+ * double-charged. Picking the newest is a defensible answer and *not* picking
+ * one at all would be worse (it would drop a paying customer to free), but it
+ * is never done quietly: `anomaly` is what makes it visible.
+ *
+ * @param entitled decides which statuses count as live. Passed in rather than
+ * imported so this file stays free of the tier table.
+ */
+export function chooseSubscription(
+  subscriptions: readonly Stripe.Subscription[],
+  entitled: (status: string) => boolean,
+): Chosen {
+  const notes: string[] = [];
+  const understood: SubscriptionState[] = [];
+
+  for (const subscription of subscriptions) {
+    const reading = readSubscription(subscription);
+    if (reading.kind === "unsupported") {
+      notes.push(`${subscription.id}: ${reading.why}`);
+      continue;
+    }
+    understood.push(reading.state);
+  }
+
+  if (understood.length === 0) {
+    /* No subscription, or none we can read. Either way the owner is on the free
+       tier, and the customer mapping is kept — they may subscribe again, and a
+       second Stripe customer for one person is how billing histories split. */
+    return { state: null, notes, anomaly: false };
+  }
+
+  const live = understood.filter((s) => entitled(s.status));
+  if (live.length === 0) {
+    /* Cancelled, unpaid, or never completed. Store the most recent anyway, so
+       `/profile` and `/admin/users` can say what happened rather than showing
+       an account that looks as though it never subscribed. */
+    return { state: newest(understood), notes, anomaly: false };
+  }
+  if (live.length === 1) return { state: live[0] ?? null, notes, anomaly: false };
+
+  notes.push(
+    `this customer has ${live.length} live subscriptions (${live.map((s) => s.subscriptionId).join(", ")}) ` +
+      "and may be paying more than once — taking the most recent",
+  );
+  return { state: newest(live), notes, anomaly: true };
+}
+
+/**
+ * The one whose period started last.
+ *
+ * By period start rather than by array order: Stripe's list order is documented
+ * as newest-first but is not something to build entitlement on, and a stable
+ * rule that reads the data means two calls cannot disagree.
+ */
+function newest(states: readonly SubscriptionState[]): SubscriptionState | null {
+  return (
+    [...states].sort((a, b) => b.currentPeriodStart.getTime() - a.currentPeriodStart.getTime())[0] ??
+    null
+  );
+}
diff --git a/src/billing/sync.ts b/src/billing/sync.ts
new file mode 100644
index 0000000..c65da6d
--- /dev/null
+++ b/src/billing/sync.ts
@@ -0,0 +1,152 @@
+/**
+ * **Ask Stripe what is true, and write that down.** One function, for every
+ * event.
+ *
+ * The pattern is t3dotgg/stripe-recommendations', and the reason it is worth
+ * copying is that it collapses about 250 event shapes into one code path.
+ * Nothing here reads a webhook payload for *state* — only for which customer to
+ * ask about. Events arrive out of order, and a handler that applies each
+ * payload's contents builds a picture no single event ever described: a
+ * `deleted` overtaking an `updated` resurrects a cancelled subscription, and
+ * nothing looks wrong afterwards.
+ *
+ * ## The lock is held across the Stripe call, deliberately
+ *
+ * Fetch-then-write without serialisation lets a slow handler commit stale state
+ * after a fresher one — the same subscription restored after cancellation, or a
+ * renewal reverted. So the customer's `billing_accounts` row is locked
+ * `for update` *before* Stripe is asked, and released after the write.
+ *
+ * **This is a trade, and the other side of it is real.** GPT Sol's second review
+ * pointed out that holding a pooled connection across a network call is how the
+ * pool gets tight: `DATABASE_POOL_MAX` is 5, so five concurrent webhooks for
+ * five different customers hold every connection for the length of a Stripe
+ * round trip. It does not *deadlock* — the holder needs no second connection —
+ * but it queues.
+ *
+ * We take correctness, because at this scale the throughput cost is
+ * hypothetical and the stale-write is not: subscription webhooks arrive a
+ * handful at a time for one paid tier, and they arrive in bursts *per customer*
+ * — which is precisely the case the lock exists for. **If that ever stops being
+ * true**, the fix is not to drop the lock but to make the write conditional on
+ * freshness: keep a monotonic marker from Stripe beside the row and refuse a
+ * write older than the one already stored. That is more machinery than this
+ * needs today.
+ */
+
+import { eq } from "drizzle-orm";
+
+import { getDb } from "../db/client.js";
+import { billingAccounts } from "../db/schema.js";
+import { errorFields, log } from "../log.js";
+import { chooseSubscription } from "./subscription.js";
+import { assertLivemode, stripeClient } from "./stripe.js";
+import { isEntitledStatus } from "./tiers.js";
+
+const logger = log("store");
+
+/** What a sync did, for the caller to log and for tests to assert on. */
+export type SyncResult =
+  /** The customer maps to an owner and their row now matches Stripe. */
+  | { readonly kind: "synced"; readonly ownerId: string; readonly status: string | null }
+  /**
+   * No `billing_accounts` row carries this customer id.
+   *
+   * **Not an error, and not a success either.** It happens legitimately for a
+   * few seconds: Checkout completes, Stripe fires, and our own success callback
+   * has not yet written the mapping. The caller answers 5xx so Stripe retries,
+   * which is what closes that window. It also happens permanently for a customer
+   * created by hand in the dashboard, and Stripe gives up on those after a few
+   * days — which is the right outcome for an event about somebody who is not a
+   * reader here.
+   */
+  | { readonly kind: "unmapped"; readonly customerId: string };
+
+/**
+ * Bring one customer's row into line with Stripe.
+ *
+ * @param customerId a `cus_…`, taken from the event only as a lookup key.
+ *
+ * Idempotent: running it twice produces the same row, which is what makes a
+ * Stripe retry safe. "No-op" here means *the same resulting state*, not zero
+ * work — it always asks Stripe.
+ */
+export async function syncSubscriptionFromStripe(customerId: string): Promise<SyncResult> {
+  const stripe = stripeClient();
+
+  return await getDb().transaction(
+    async (tx) => {
+      /* The lock, and the mapping lookup, in one statement. Unlike admission
+         there is nothing to create first: a customer we have never heard of is
+         not an owner we may invent, so zero rows is an answer rather than a
+         race. `billing_accounts.stripe_customer_id` is unique, so this is at
+         most one row. */
+      const [row] = await tx
+        .select({ ownerId: billingAccounts.ownerId })
+        .from(billingAccounts)
+        .where(eq(billingAccounts.stripeCustomerId, customerId))
+        .for("update")
+        .limit(1);
+
+      if (!row) return { kind: "unmapped", customerId } satisfies SyncResult;
+
+      /* **All of them, not the one the event named.** A late `deleted` for a
+         subscription that has already been replaced would otherwise wipe the
+         replacement. `status: "all"` because a cancelled one is still worth
+         storing — `/profile` saying "your subscription ended" is a different
+         thing from an account that looks as though it never subscribed. */
+      const list = await stripe.subscriptions.list({
+        customer: customerId,
+        status: "all",
+        limit: 100,
+        expand: ["data.items.data.price"],
+      });
+      for (const subscription of list.data) {
+        assertLivemode(subscription.livemode, `subscription ${subscription.id}`);
+      }
+
+      const chosen = chooseSubscription(list.data, isEntitledStatus);
+      for (const note of chosen.notes) {
+        logger.warn({ customerId, ownerId: row.ownerId, note }, "reading a Stripe subscription");
+      }
+      if (chosen.anomaly) {
+        logger.error(
+          { customerId, ownerId: row.ownerId },
+          "this customer has more than one live subscription and may be paying twice",
+        );
+      }
+
+      const state = chosen.state;
+      await tx
+        .update(billingAccounts)
+        .set({
+          /* Every field written on every sync, including to null. A partial
+             update is how a cancelled subscription keeps a period that makes it
+             look current. */
+          stripeSubscriptionId: state?.subscriptionId ?? null,
+          priceId: state?.priceId ?? null,
+          status: state?.status ?? null,
+          currentPeriodStart: state?.currentPeriodStart ?? null,
+          currentPeriodEnd: state?.currentPeriodEnd ?? null,
+          cancelAtPeriodEnd: state?.cancelAtPeriodEnd ?? false,
+          livemode: state?.livemode ?? null,
+          lastSyncedAt: new Date(),
+          updatedAt: new Date(),
+        })
+        .where(eq(billingAccounts.ownerId, row.ownerId));
+
+      return {
+        kind: "synced",
+        ownerId: row.ownerId,
+        status: state?.status ?? null,
+      } satisfies SyncResult;
+    },
+    /* Pinned, as everywhere else in the store. */
+    { isolationLevel: "read committed" },
+  );
+}
+
+/** Log a sync failure without letting a Stripe message reach the response. */
+export function noteSyncFailure(customerId: string, err: unknown): void {
+  logger.error({ customerId, ...errorFields(err) }, "could not sync a customer from Stripe");
+}
diff --git a/src/billing/tiers.ts b/src/billing/tiers.ts
new file mode 100644
index 0000000..ae83333
--- /dev/null
+++ b/src/billing/tiers.ts
@@ -0,0 +1,96 @@
+/**
+ * What each tier is allowed to do, and how a Stripe subscription becomes one.
+ *
+ * Pure: no database, no network, no environment beyond the configured price id.
+ * Everything here is a decision, so it is all in one small file that can be read
+ * in a minute — docs/plans/260902i-stripe-payments-and-subscription-tiers.md.
+ *
+ * ## The quota is an abuse boundary, not an invoice
+ *
+ * A subscription is a fixed monthly charge; the ingest count exists to stop one
+ * account spending unbounded model money, not to price anything. So it is
+ * deliberately generous, and the numbers being finger-in-the-air is fine. Greg,
+ * 2026-09-02: *"I'm assuming that most people won't max it out."*
+ *
+ * **Reading is never limited by any of this.** An account at its ceiling can
+ * still read everything it has and everything public; what it cannot do is add
+ * something new, which is the only action that spends.
+ */
+
+/** The two tiers. A second paid tier is a row here, a price in Stripe, and nothing else. */
+export type Tier = "free" | "reader";
+
+/** Three, lifetime — enough to play with, and no period logic for people who never pay. */
+export const FREE_LIFETIME_INGESTS = 3;
+
+/** One hundred per billing period, at $10/month. */
+export const READER_PERIOD_INGESTS = 100;
+
+/**
+ * What an owner may do right now.
+ *
+ * `periodStart`/`periodEnd` are a **half-open** interval `[start, end)` and are
+ * absent for the free tier, whose period is all of time — so a caller must
+ * treat "no period" as "count everything ever" rather than as "count nothing",
+ * and the types say which by making them optional together.
+ */
+export interface Entitlement {
+  readonly tier: Tier;
+  /** How many new ingests the period allows. */
+  readonly limit: number;
+  readonly periodStart?: Date;
+  readonly periodEnd?: Date;
+}
+
+/** Nobody has paid, or nobody could be identified. Never an error — it is a tier. */
+export const FREE: Entitlement = { tier: "free", limit: FREE_LIFETIME_INGESTS };
+
+/**
+ * The Stripe subscription statuses that carry entitlement.
+ *
+ * `past_due` is in the list on purpose: a card that failed once is a customer
+ * Stripe is still dunning, and cutting them off on the first retry is a worse
+ * experience than the few pounds it saves. Dunning is configured so that
+ * `past_due` eventually becomes `canceled` or `unpaid`, which are not here.
+ *
+ * `incomplete` and `incomplete_expired` are absent: those are subscriptions
+ * whose *first* payment never succeeded, so nobody has ever paid anything.
+ *
+ * **Read as an allowlist over raw text**, not as a database enum. Stripe may
+ * add a status, and a status this file has never heard of falls to the free
+ * tier — which is the direction that costs a customer an email rather than
+ * costing us an unbounded bill.
+ */
+export const ENTITLED_STATUSES: readonly string[] = ["active", "trialing", "past_due"];
+
+/** Does this raw Stripe subscription status carry entitlement? */
+export function isEntitledStatus(status: string | null | undefined): boolean {
+  return status !== null && status !== undefined && ENTITLED_STATUSES.includes(status);
+}
+
+/**
+ * Which tier a Stripe price sells, or `null` for a price we do not recognise.
+ *
+ * Keyed by price id and given the configured id explicitly rather than reading
+ * the environment, so this stays pure and a test does not have to stub
+ * anything. `null` rather than a throw or a default: an unrecognised price is a
+ * real situation — an old price still on a grandfathered subscription, a price
+ * created by hand in the dashboard — and the caller's job is to log it and fall
+ * to free, never to hand out Reader quota for a price nobody costed.
+ */
+export function tierForPrice(priceId: string | null | undefined, readerPriceId: string): Tier | null {
+  if (!priceId) return null;
+  return priceId === readerPriceId ? "reader" : null;
+}
+
+/** What that tier allows over the period Stripe says the subscription is in. */
+export function entitlementFor(tier: Tier, period?: { start: Date; end: Date }): Entitlement {
+  if (tier === "free") return FREE;
+  return period
+    ? { tier: "reader", limit: READER_PERIOD_INGESTS, periodStart: period.start, periodEnd: period.end }
+    : /* A Reader subscription whose period we could not read is not a Reader
+         subscription we can meter. The caller resyncs once and then fails
+         closed rather than choosing between an unlimited window and a false
+         block on somebody who has paid — see the plan's period arithmetic. */
+      FREE;
+}
diff --git a/src/billing/webhook.ts b/src/billing/webhook.ts
new file mode 100644
index 0000000..554d4dc
--- /dev/null
+++ b/src/billing/webhook.ts
@@ -0,0 +1,290 @@
+/**
+ * The Stripe webhook: verify the bytes, then act on what Stripe says.
+ *
+ * The route is an **exact** pre-auth path, `POST /api/webhooks/stripe`, matched
+ * inside `serveApi`'s `try` and before `requireUser` — Stripe has no session and
+ * never will. Exact, not a namespace: `/api/webhooks/anything-else` must stay
+ * unavailable rather than becoming a place a future handler is added without
+ * anybody re-reading this file.
+ * docs/plans/260902i-stripe-payments-and-subscription-tiers.md.
+ *
+ * ## Everything here is written to fail closed
+ *
+ * This is the one route on the server that no human is signed in to, and it is
+ * the one that grants entitlement. So:
+ *
+ * - **The raw bytes are verified before anything parses them.** A body that is
+ *   parsed and re-encoded is a *different* byte string — key order, whitespace,
+ *   number formatting — and its signature will not match. That is why this
+ *   module takes a `Buffer` and never a parsed object, and why `readBody` in
+ *   src/routes.ts (which always `JSON.parse`s) cannot be reused here.
+ * - **An unconfigured secret is a refusal, not a bypass.** No
+ *   `STRIPE_WEBHOOK_SECRET` means every delivery is rejected. The tempting
+ *   alternative — skip verification when unconfigured, "for local development" —
+ *   turns one missing environment variable in production into an endpoint that
+ *   grants subscriptions to anyone who can POST JSON.
+ * - **`currentOwnerId()` is never called.** There is no request owner in webhook
+ *   scope; the owner comes from the customer→owner mapping in the database,
+ *   which is authoritative. Metadata on the Stripe object is recovery data and
+ *   an assertion, never a source of truth — anyone who can forge a request can
+ *   put any owner id in it, and the only reason they cannot is the signature.
+ * - **The event type is allowlisted.** Stripe can send ~250 event shapes and we
+ *   act on four.
+ * - **A body larger than the cap is refused before it is read into memory.**
+ */
+
+import type { IncomingMessage, ServerResponse } from "node:http";
+import type Stripe from "stripe";
+
+import { errorFields, log } from "../log.js";
+import { assertLivemode, stripeClient } from "./stripe.js";
+import { type SyncResult, syncSubscriptionFromStripe } from "./sync.js";
+
+/* `http`, because this is a request handler and its lines sit beside the
+   ordinary request log. Not `store` — nothing here writes anything; the sync it
+   calls does its own logging under `store`. */
+const logger = log("http");
+
+/**
+ * The one path, exactly.
+ *
+ * Exported so `src/routes.ts` matches on the same string this module documents,
+ * and so a test can assert that a sibling path is not reachable.
+ */
+export const WEBHOOK_PATH = "/api/webhooks/stripe";
+
+/**
+ * The four events that mean "this customer's subscription state may have
+ * changed", and nothing else.
+ *
+ * All four do the same thing — resync from Stripe — because the payload is
+ * never trusted for state. That is the whole point of the pattern: events can
+ * arrive out of order, and a handler that applies each payload's contents
+ * builds a picture that no single event ever described.
+ *
+ * `invoice.payment_failed` is deliberately absent. `past_due` is an entitled
+ * status (src/billing/tiers.ts), and the transition into and out of it arrives
+ * on `customer.subscription.updated` anyway — so handling the invoice event
+ * would be a second path to the same conclusion, free to disagree with the
+ * first.
+ */
+export const HANDLED_EVENTS: readonly string[] = [
+  "checkout.session.completed",
+  "customer.subscription.created",
+  "customer.subscription.updated",
+  "customer.subscription.deleted",
+];
+
+/**
+ * The most a Stripe webhook body may be.
+ *
+ * Stripe's own payloads are a few kilobytes; a subscription with many items is
+ * still well inside this. Generous enough never to refuse a real delivery, small
+ * enough that an unauthenticated endpoint cannot be used to buy memory.
+ */
+export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
+
+/** Why a delivery was refused, in a form the route can turn into a status. */
+export class WebhookRefused extends Error {
+  readonly status: number;
+  constructor(status: number, message: string) {
+    super(message);
+    this.name = "WebhookRefused";
+    this.status = status;
+  }
+}
+
+/**
+ * Read the exact bytes that arrived, refusing anything oversized.
+ *
+ * A deliberate near-copy of `readBody` in src/routes.ts with the `JSON.parse`
+ * removed, rather than a refactor of it into a shared helper. The duplication is
+ * six lines; the coupling would be a shared function whose *other* caller has
+ * every reason to keep parsing, and whose signature would then have to carry a
+ * "give me the bytes instead" flag on the one path where getting it wrong means
+ * a signature check that passes on rewritten input.
+ */
+export async function readRawBody(
+  req: AsyncIterable<Buffer | string>,
+  limit = MAX_WEBHOOK_BODY_BYTES,
+): Promise<Buffer> {
+  const chunks: Buffer[] = [];
+  let size = 0;
+  for await (const chunk of req) {
+    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
+    size += buf.length;
+    if (size > limit) throw new WebhookRefused(413, "Webhook body too large");
+    chunks.push(buf);
+  }
+  return Buffer.concat(chunks);
+}
+
+/**
+ * The configured signing secret, or a refusal.
+ *
+ * Locally this is minted per machine by `stripe listen`, which is why it is not
+ * on the `gjd-remote push-env` allowlist — one machine's value is wrong on
+ * another's. In production it is the dashboard endpoint's secret, set on Vercel.
+ */
+function signingSecret(): string {
+  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
+  if (!secret) {
+    throw new WebhookRefused(
+      503,
+      "STRIPE_WEBHOOK_SECRET is not set, so no webhook delivery can be verified",
+    );
+  }
+  return secret;
+}
+
+/**
+ * Verify a delivery and return the event, or throw.
+ *
+ * @param raw the exact bytes that arrived — never a re-encoding of them.
+ * @param signature the `stripe-signature` header, verbatim.
+ *
+ * The signature covers a timestamp as well as the payload, and the SDK enforces
+ * a tolerance window, so a captured delivery cannot be replayed indefinitely.
+ */
+export function verifyEvent(raw: Buffer, signature: string | undefined): Stripe.Event {
+  if (!signature) throw new WebhookRefused(400, "No stripe-signature header");
+  const secret = signingSecret();
+
+  let event: Stripe.Event;
+  try {
+    event = stripeClient().webhooks.constructEvent(raw, signature, secret);
+  } catch (err) {
+    /* The reason is never echoed to the caller. "No signatures found matching
+       the expected signature" and "timestamp outside the tolerance zone" are
+       both useful to us and both a hint to somebody probing the endpoint. It
+       goes to the log, not to the response. */
+    throw new WebhookRefused(400, `Webhook signature verification failed: ${(err as Error).message}`);
+  }
+
+  /* Belt and braces over the key check in stripe.ts: a webhook endpoint left
+     pointed at the wrong deployment is the one way a live event reaches a test
+     deployment, and then the payload is the only thing that knows. */
+  assertLivemode(event.livemode, `the ${event.type} event`);
+  return event;
+}
+
+/** Is this an event we act on? Everything else is acknowledged and ignored. */
+export function isHandled(type: string): boolean {
+  return HANDLED_EVENTS.includes(type);
+}
+
+/**
+ * The Stripe customer this event concerns, or null if it names none.
+ *
+ * Every handled event carries a customer, and it is the *only* thing taken from
+ * the payload: it is a lookup key into our own mapping, not a fact we store.
+ * Everything else — status, price, period — is fetched fresh from Stripe by the
+ * sync function, because an out-of-order event's payload describes a moment that
+ * may already be over.
+ */
+export function customerOf(event: Stripe.Event): string | null {
+  const object = event.data.object as { customer?: string | { id: string } | null };
+  const customer = object.customer;
+  if (!customer) return null;
+  return typeof customer === "string" ? customer : customer.id;
+}
+
+/** The whole response this route ever sends. Never a Stripe message. */
+function answer(res: ServerResponse, status: number, body: Record<string, unknown>): void {
+  res.statusCode = status;
+  res.setHeader("Content-Type", "application/json");
+  res.setHeader("Cache-Control", "no-store");
+  res.end(JSON.stringify(body));
+}
+
+/**
+ * Serve `POST /api/webhooks/stripe`.
+ *
+ * ## What each status means to Stripe, which is the only reader
+ *
+ * **2xx is a promise**, not an acknowledgement: it tells Stripe this delivery
+ * never needs sending again. So it is returned only when the customer's row now
+ * matches Stripe, or when the event is one we deliberately ignore. Anything
+ * else — an unknown customer, a Stripe failure, a database failure — is 5xx, so
+ * the delivery is retried. Getting that backwards is how a cancelled
+ * subscription keeps its entitlement for ever: one 200 over a failed write and
+ * the event is gone.
+ *
+ * **An unmapped customer is 503 rather than 200**, and the window it covers is
+ * real: Checkout completes, Stripe fires immediately, and our own success
+ * callback has not yet written the mapping. A retry a few seconds later finds
+ * it. For a customer created by hand in the dashboard the retries eventually
+ * stop, which is the right end for an event about somebody who is not a reader
+ * here.
+ *
+ * **The response body never carries a reason.** Stripe does not read it, and
+ * the one other party who might is somebody probing the endpoint — for whom
+ * "signature verification failed: timestamp outside the tolerance zone" is a
+ * hint. Reasons go to the log.
+ *
+ * @param sync a seam, so tests exercise every branch without a database. The
+ * default is the real thing, so forgetting to inject cannot make a production
+ * build inert — the same reasoning as `verify` on `handleApi`.
+ */
+export async function serveStripeWebhook(
+  req: IncomingMessage,
+  res: ServerResponse,
+  method: string,
+  sync: (customerId: string) => Promise<SyncResult> = syncSubscriptionFromStripe,
+): Promise<void> {
+  if (method !== "POST") {
+    res.setHeader("Allow", "POST");
+    answer(res, 405, { error: "Method not allowed" });
+    return;
+  }
+
+  let event: Stripe.Event;
+  try {
+    const raw = await readRawBody(req);
+    const signature = req.headers["stripe-signature"];
+    event = verifyEvent(raw, Array.isArray(signature) ? signature[0] : signature);
+  } catch (err) {
+    const status = err instanceof WebhookRefused ? err.status : 400;
+    /* Logged with the reason, answered without it. */
+    logger.warn({ status, ...errorFields(err) }, "refused a Stripe webhook delivery");
+    answer(res, status, { error: "Webhook refused" });
+    return;
+  }
+
+  if (!isHandled(event.type)) {
+    /* 200: we are certain we do not want it, so a retry would be pure cost. */
+    return answer(res, 200, { received: true, handled: false });
+  }
+
+  const customer = customerOf(event);
+  if (!customer) {
+    /* A handled event with no customer is malformed rather than unlucky, and a
+       retry would send the same malformed thing again. */
+    logger.error({ type: event.type, event: event.id }, "a handled Stripe event named no customer");
+    answer(res, 400, { error: "Webhook refused" });
+    return;
+  }
+
+  try {
+    const result = await sync(customer);
+    if (result.kind === "unmapped") {
+      logger.warn(
+        { type: event.type, customerId: customer },
+        "no billing account maps to this Stripe customer yet — asking Stripe to retry",
+      );
+      answer(res, 503, { error: "Not ready" });
+      return;
+    }
+    logger.info(
+      { type: event.type, ownerId: result.ownerId, status: result.status },
+      "synced a customer from Stripe",
+    );
+    answer(res, 200, { received: true, handled: true });
+  } catch (err) {
+    /* **5xx, so Stripe retries.** The handler awaits a durable write and
+       returns 2xx only when one happened; a 200 here would silently drop the
+       one event that said this subscription had changed. */
+    logger.error({ type: event.type, customerId: customer, ...errorFields(err) }, "webhook sync failed");
+    answer(res, 500, { error: "Sync failed" });
+  }
+}
diff --git a/src/db/schema.ts b/src/db/schema.ts
index ef0da1e..71b527b 100644
--- a/src/db/schema.ts
+++ b/src/db/schema.ts
@@ -1738,6 +1738,27 @@ export const jobs = spideryarn.table(
      */
     urlKey: text("url_key"),
 
+    /**
+     * **The quota slot this job is spending, or null if it is spending none.**
+     *
+     * Set by the authenticated new-ingest route and written by *this row's own
+     * INSERT*, which is the entire point: the job and its provenance become
+     * true in one statement, so there is no moment where a job exists and
+     * nothing knows to charge for it. Every other shape was broken — see
+     * `ingest_events` § *Provenance lives on the job*.
+     *
+     * Null for everything that must not be charged: pipeline work from the CLI,
+     * a re-run of one step on an article already ingested, seeding. Those
+     * settle nothing, because there is nothing to settle, and no flag anywhere
+     * had to be remembered to make that true.
+     *
+     * **Not a foreign key**, and deliberately: `ingest_events` is the record of
+     * what an account was charged for, jobs are reader-deletable, and a
+     * cascade in either direction would be wrong. It is a plain uuid, exactly
+     * as `owner_id` is.
+     */
+    ingestEventId: uuid("ingest_event_id"),
+
     createdAt: createdAt(),
     startedAt: timestamp("started_at", { withTimezone: true }),
     finishedAt: timestamp("finished_at", { withTimezone: true }),
@@ -1929,6 +1950,22 @@ export const jobs = spideryarn.table(
     index("jobs_slug_order")
       .on(t.slug, t.createdAt, t.id)
       .where(sql`${t.status} in ('queued','running')`),
+    /**
+     * **One job per quota slot, enforced rather than intended.**
+     *
+     * A slot buys one ingest. Without this, two jobs carrying one
+     * `ingest_event_id` would each be able to settle it, and the failure is
+     * silent in the direction that costs money: the second publication finds
+     * the row already `succeeded_at` and charges nothing. Unique rather than a
+     * plain index so that the mistake is a constraint violation at the insert,
+     * where somebody is looking.
+     *
+     * Partial, because null means "spends no quota" and there are a great many
+     * of those — every CLI run and every step re-run.
+     */
+    uniqueIndex("jobs_ingest_event_unique")
+      .on(t.ingestEventId)
+      .where(sql`${t.ingestEventId} is not null`),
   ],
 );
 
@@ -3161,3 +3198,204 @@ export const checkpoints = spideryarn.table(
     index("checkpoints_last_used_at").on(t.lastUsedAt),
   ],
 );
+
+/* --------------------------------------------------------------- billing -- */
+
+/**
+ * **One row per owner, and every owner gets one** — the anchor the ingest quota
+ * serialises on, whether or not anybody has ever paid.
+ *
+ * docs/project/billing.md, and
+ * docs/plans/260902i-stripe-payments-and-subscription-tiers.md.
+ *
+ * ## Why a free reader has a row here
+ *
+ * It reads like waste — a table of subscriptions holding rows for people with
+ * no subscription — and it is the whole reason the quota cannot be bypassed.
+ * Admission takes `select … for update` on this row so that concurrent requests
+ * for one owner are counted one at a time, and **a row lock is taken on rows
+ * the statement returns, so a `for update` that matches nothing locks nothing**
+ * (docs/postmortems/260901f-a-for-update-that-locks-nothing.md). The free tier
+ * is exactly where the boundary matters, so exactly there the row must exist.
+ * Admission creates it with `on conflict do nothing` and then locks it, which
+ * is that postmortem's prescribed shape; measured on 2026-09-02, a second
+ * transaction blocks for as long as the first holds it and then reads the
+ * first's committed value.
+ *
+ * It is also where a comp subscription will live — a journalist given a free
+ * month has no Stripe subscription at all, so there is nowhere else to put it.
+ *
+ * ## What is stored, and what is deliberately not
+ *
+ * Opaque Stripe ids and the few fields entitlement is derived from. **No card
+ * data, ever** — hosted Checkout and the hosted Customer Portal mean none of it
+ * reaches this server, which is what keeps us in Stripe's lightest PCI scope.
+ * `status` is raw Stripe text rather than an enum or a CHECK: entitlement comes
+ * from an allowlist in src/billing/tiers.ts, so a status Stripe invents next
+ * year falls to the free tier instead of failing an insert inside a webhook.
+ */
+export const billingAccounts = spideryarn.table(
+  "billing_accounts",
+  {
+    /** `auth.users(id)`. FK in the custom migration, as with every other `owner_id`. */
+    ownerId: uuid("owner_id").primaryKey(),
+    /**
+     * The Stripe customer, once one exists. Nullable because admission creates
+     * this row long before anybody visits Checkout, and **unique** because two
+     * owners sharing a customer would cross two people's billing — Postgres
+     * allows many nulls under a unique constraint, which is exactly the
+     * behaviour wanted here.
+     */
+    stripeCustomerId: text("stripe_customer_id").unique(),
+    /** The current subscription, if any. Unique for the same reason. */
+    stripeSubscriptionId: text("stripe_subscription_id").unique(),
+    /** Which price it is on — the key into the tier map. */
+    priceId: text("price_id"),
+    /** Raw Stripe status. See the header: an allowlist decides, not this column. */
+    status: text("status"),
+    /**
+     * The billing period, **read from the subscription item rather than the
+     * subscription** — Stripe's Basil release (2025-03-31) removed these from
+     * the Subscription object. Half-open `[start, end)` everywhere that reads
+     * them. src/billing/stripe.ts pins the API version that keeps this true.
+     */
+    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
+    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
+    /** Cancelled, but paid up until the period ends — still entitled until then. */
+    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
+    /**
+     * Which side of Stripe's test/live divide this row came from.
+     *
+     * Stored rather than inferred so that a row written by a misconfigured
+     * deployment can be *seen* afterwards. A production deployment on a test
+     * key would write `false` here while granting real quota, and this column
+     * is the only thing that would say so — src/billing/stripe.ts refuses such
+     * a key, and this is the record of what happened if it ever did not.
+     */
+    livemode: boolean("livemode"),
+    /** When Stripe was last asked. Diagnostic; entitlement never reads it. */
+    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
+    createdAt: createdAt(),
+    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
+  },
+  (t) => [
+    /* A period that ends before it starts would make every half-open count
+       empty, which reads as "no ingests used" rather than as an error. */
+    check(
+      "billing_accounts_period_order",
+      sql`${t.currentPeriodStart} is null or ${t.currentPeriodEnd} is null or ${t.currentPeriodStart} < ${t.currentPeriodEnd}`,
+    ),
+    /* A subscription belongs to a customer. A row with the second and not the
+       first could only come from a bug, and it would leave the customer→owner
+       mapping — the authoritative one — unreachable from the subscription. */
+    check(
+      "billing_accounts_subscription_needs_customer",
+      sql`${t.stripeSubscriptionId} is null or ${t.stripeCustomerId} is not null`,
+    ),
+  ],
+);
+
+/**
+ * **Every new ingest an owner is charged for, reserved before it runs and
+ * settled when it ends.** One row per *attempt to spend* — not per article, and
+ * not per job.
+ *
+ * ## Why this is not a count of jobs, or of articles
+ *
+ * Jobs are reader-deletable (`DELETE /api/jobs/:id`), so a quota derived from
+ * job rows is erasable by the person being counted — which is the one thing an
+ * abuse boundary may not be. Articles answer a different question again: they
+ * can be archived, and deleting one does not refund the slot. Nothing deletes
+ * from this table.
+ *
+ * ## The three timestamps, and why they are not one status column
+ *
+ * `reserved_at` is set at admission, inside the transaction holding the owner's
+ * `billing_accounts` lock — that write is what makes a second concurrent
+ * request see the first one. `succeeded_at` is set in the *same* Postgres
+ * transaction that publishes the revision (src/store/pg-session.ts `settleIn`,
+ * the `done` branch), so there is no window in which an ingest has succeeded
+ * and not been counted, and none in which a failure has been charged.
+ * `released_at` is set when the job fails or is cancelled.
+ *
+ * Nullable timestamps rather than a status enum because a nullable timestamp
+ * says more than a boolean (docs/project/sql.md): each of these is genuinely an
+ * event with a moment, they can be read independently, and there is no second
+ * column to disagree with the first. The CHECK below rules out the one
+ * combination that is not a state.
+ *
+ * ## Usage, and why an unsettled reservation never expires
+ *
+ * An owner's usage is successes inside the period **plus** every reservation
+ * that has not settled:
+ *
+ *     succeeded_at >= start and succeeded_at < end        -- charged
+ *     succeeded_at is null and released_at is null        -- in flight
+ *
+ * **There is deliberately no age limit on the second clause**, and an earlier
+ * draft of this table had a six-hour one. GPT Sol's review, 2026-09-02, showed
+ * it was a straightforward bypass rather than a safety valve: with a limit of
+ * 100, hold 100 jobs queued for six hours, reserve 100 more, and all 200 can
+ * then succeed inside one period — repeatable in cohorts, and *easier* the more
+ * contended the job queue is, because contention is what ages the queue. Any
+ * expiry rule has to be able to prove the reservation never produced a job, and
+ * the honest v1 answer is not to have one: a leaked reservation costs its owner
+ * one slot, which is a support conversation, and the bypass costs unbounded
+ * model spend, which is the thing this table exists to stop.
+ *
+ * The leak needs the process to die between the reservation committing and
+ * `enqueue()` returning — every other path releases it. A reconciliation that
+ * frees only reservations *provably* without a job is possible later, because
+ * `jobs.ingest_event_id` makes "without a job" a query rather than a guess.
+ *
+ * ## Provenance lives on the job, not here
+ *
+ * The link is `jobs.ingest_event_id`, written by the same INSERT that creates
+ * the job, and this table has no `job_id` column. That direction is the whole
+ * safety argument, and the other way round was broken three ways: a job that
+ * published before a follow-up `update … set job_id` landed was never charged;
+ * a crash in that gap left a runnable job nobody paid for; and two duplicate
+ * Adds that `enqueueOrGet` deduplicates into one job would have pointed two
+ * reservations at it, so one publication settled both.
+ *
+ * A job with a null `ingest_event_id` — pipeline work from the CLI, a re-run of
+ * one step, seeding — settles nothing and is therefore free. That is the entire
+ * provenance mechanism: no flag to set, and none to forget.
+ */
+export const ingestEvents = spideryarn.table(
+  "ingest_events",
+  {
+    id: uuid("id").primaryKey().defaultRandom(),
+    /** `auth.users(id)`. FK in the custom migration. */
+    ownerId: uuid("owner_id").notNull(),
+    reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(),
+    /** Set inside the publish transaction. Null until the ingest succeeds. */
+    succeededAt: timestamp("succeeded_at", { withTimezone: true }),
+    /** Set when the job failed, was cancelled, or never became a job at all. */
+    releasedAt: timestamp("released_at", { withTimezone: true }),
+    /**
+     * What the article was called at the time — **diagnostic only**. A slug is
+     * mutable, so it could never be this row's identity; it is here so that a
+     * support conversation about "which article was that" has an answer.
+     */
+    slug: text("slug"),
+  },
+  (t) => [
+    /* A reservation settles once, and only one way. `num_nonnulls` rather than
+       a pair of `is null` disjunctions because it says the rule rather than
+       encoding it — GPT Sol, 2026-09-02. In the database rather than in
+       TypeScript because three separate code paths write these columns, and a
+       rule that lives in one of them is not a rule. */
+    check("ingest_events_settled_once", sql`num_nonnulls(${t.succeededAt}, ${t.releasedAt}) <= 1`),
+    /* Neither terminal moment can precede the reservation it settles. Cheap,
+       and it is the constraint that would catch a clock or a code path writing
+       one of these from somewhere unexpected. */
+    check(
+      "ingest_events_settled_after_reserved",
+      sql`(${t.succeededAt} is null or ${t.succeededAt} >= ${t.reservedAt})
+          and (${t.releasedAt} is null or ${t.releasedAt} >= ${t.reservedAt})`,
+    ),
+    /* The admission query, which runs on the critical path of every ingest. */
+    index("ingest_events_owner_reserved").on(t.ownerId, t.reservedAt.desc()),
+  ],
+);
diff --git a/src/messages.ts b/src/messages.ts
index 009a019..683e0ea 100644
--- a/src/messages.ts
+++ b/src/messages.ts
@@ -351,6 +351,17 @@ export const CODE_KINDS: Record<string, FailureKind> = {
      docs/project/feedback.md. */
   "fb-send": "retry",
   "fb-store": "ours",
+  /* The subscription allowance, `pay-`. All three are registered rather than
+     left to fall through, and the two `blocked` ones are the reason: an
+     unrecognised code means *offer another go*, so "you have used all three of
+     your free articles" would have arrived with a Retry button beside it —
+     pressing it does not move the count, and a button that cannot work is the
+     mistake this table exists to prevent. `pay-off` is `ours`: a deployment
+     with no Stripe configured is nothing the reader can act on.
+     docs/project/billing.md. */
+  "pay-free": "blocked",
+  "pay-limit": "blocked",
+  "pay-off": "ours",
 };
 
 
@@ -1826,3 +1837,86 @@ export const FEEDBACK_NOT_AVAILABLE: ReaderFacingFailure = {
     "in. Trying again will not help. The Copy button below puts the report on your clipboard. " +
     "[fb-store]",
 };
+
+/* ---- the subscription allowance. docs/project/billing.md ----------------------- */
+
+/**
+ * The account has added everything its plan allows.
+ *
+ * **`blocked`, and the `pay-` prefix is new.** `blocked` is what `kind` is for:
+ * it answers "will another go at this help", and the answer is no — the count
+ * does not move because a button was pressed twice. What it must not be is
+ * `retry`, which would put a Retry button on a wall.
+ *
+ * It stretches `blocked` slightly, and knowingly. copy.md describes that kind as
+ * a refusal the reader can get past *by asking for less*, and here they get past
+ * it by paying or by waiting. The alternative was a fifth kind for one case, and
+ * the thing `kind` is actually consulted for — should we offer another go —
+ * gives the same answer either way.
+ *
+ * **Both sentences end by saying reading is unaffected**, which is the one thing
+ * a reader will actually be worried about and the one promise this product makes
+ * about money (Greg, 2026-09-02: *"if a user has hit their quota, they should
+ * still be able to read their existing and Public-readable articles"*). Neither
+ * says "upgrade" as a bare instruction: the free one names where the button is,
+ * because a sentence telling somebody to do a thing without saying where is a
+ * sentence that makes them hunt.
+ *
+ * A factory rather than a constant because the numbers have to be in it —
+ * "you've reached your limit" without the limit leaves the reader unable to tell
+ * whether it is the plan or a fault. Registered in `FROM_FACTORIES` in
+ * tests/messages.test.ts, since `CONSTANTS` cannot see it.
+ */
+export function ingestQuotaReached(quota: {
+  limit: number;
+  /** When the allowance resets. Absent for the free tier, whose limit is lifetime. */
+  resetAt?: Date;
+}): ReaderFacingFailure {
+  const kept =
+    "Everything you have already added stays exactly where it is — reading is never limited.";
+
+  if (!quota.resetAt) {
+    return {
+      kind: "blocked",
+      message:
+        `You have added all ${quota.limit} articles a free account can add. Trying again will not ` +
+        "help — the count will be the same. Adding more needs a subscription, and the Upgrade " +
+        `button on your profile page sets one up. ${kept} [pay-free]`,
+    };
+  }
+
+  /* Day, month and year, in the reader's words rather than an ISO stamp. `UTC`
+     so the sentence does not change depending on where the server is standing —
+     the boundary itself is Stripe's, and it is not to the hour anyway. */
+  const when = quota.resetAt.toLocaleDateString("en-GB", {
+    day: "numeric",
+    month: "long",
+    year: "numeric",
+    timeZone: "UTC",
+  });
+  return {
+    kind: "blocked",
+    message:
+      `You have added all ${quota.limit} articles this billing period covers. Trying again will ` +
+      `not help until your allowance starts again on ${when}. ${kept} [pay-limit]`,
+  };
+}
+
+/**
+ * Billing is configured wrongly, or not at all, on this deployment.
+ *
+ * `ours` rather than `retry` or `blocked`: nothing the reader does changes it,
+ * and it is not a refusal of what they asked for. It is what a checkout or a
+ * portal route answers when `stripeConfigProblem()` has something to say — a
+ * missing key, or a key from the wrong mode (src/billing/stripe.ts). Reachable
+ * on a developer's machine and, if we ever get it wrong, in production; written
+ * plainly for both, because copy.md's whole point is that we do not know who is
+ * reading.
+ */
+export const BILLING_NOT_AVAILABLE: ReaderFacingFailure = {
+  kind: "ours",
+  message:
+    "Subscriptions are not set up on this copy of the app, so there is nothing to buy here just " +
+    "now. Trying again will not help — it needs somebody to configure it. Nothing you have is " +
+    "affected, and reading carries on as normal. [pay-off]",
+};
diff --git a/src/routes.ts b/src/routes.ts
index 65289ca..5891f13 100644
--- a/src/routes.ts
+++ b/src/routes.ts
@@ -256,6 +256,7 @@ import { describeAdminMiss, isAdmin } from "./admin.js";
 import type { NewFeedback, Visibility } from "./store/contracts.js";
 import { assertVerifiedUser, requireUser, type VerifiedUser, type Verifier } from "./auth.js";
 import { placingFailed, UPLOAD_MISSING, UPLOAD_UNAVAILABLE } from "./messages.js";
+import { WEBHOOK_PATH, serveStripeWebhook } from "./billing/webhook.js";
 import { isPublicNamespace, servePublicApi } from "./public/routes.js";
 import { currentOwnerId, runInRequest, setRequestOwner } from "./owner.js";
 import {
@@ -5463,6 +5464,26 @@ async function serveApi(
       return true;
     }
 
+    /**
+     * **The Stripe webhook — the second thing on this server that runs before
+     * the gate, and the only one that is handed the request.**
+     *
+     * Stripe has no session and never will, so this cannot sit behind
+     * `requireUser`. An **exact** path rather than a namespace, unlike the
+     * public branch above: nothing else under `/api/webhooks/` should become
+     * reachable because somebody added a second provider without re-reading
+     * src/billing/webhook.ts.
+     *
+     * Inside the `try` for the reason the comment below gives at length, and
+     * before anything else touches `req`, because the signature is over the
+     * bytes as they arrived — something that had already consumed the stream
+     * would leave nothing to verify.
+     */
+    if (path === WEBHOOK_PATH) {
+      await serveStripeWebhook(req, res, method);
+      return true;
+    }
+
     /* **The gate, and it is inside the `try` — that is the whole of this
        comment's content.** An earlier plan put it just after the `/api/` prefix
        check, eighty-five lines above, on the theory that this `try` would turn
diff --git a/src/store/pg-billing.ts b/src/store/pg-billing.ts
new file mode 100644
index 0000000..aed9928
--- /dev/null
+++ b/src/store/pg-billing.ts
@@ -0,0 +1,263 @@
+/**
+ * The ingest quota: reserving a slot, settling it, and counting what is used.
+ *
+ * Postgres only — there is no filesystem half and there will not be one. The
+ * settlement joins the publish transaction in src/store/pg-session.ts, which has
+ * no filesystem counterpart, so quota is enforced when `SPIDERYARN_STORE=postgres`
+ * and not otherwise. That is a decision rather than an oversight, and it cannot
+ * leak into production: src/store/index.ts throws at *import* when a filesystem
+ * store is live there, so the app fails to start rather than serving unmetered
+ * ingests. docs/project/billing.md.
+ *
+ * ## The one thing this file exists to get right
+ *
+ * A script firing twenty concurrent `POST /api/jobs` at a free account with
+ * three lifetime ingests must not get twenty through. A plain "count, then
+ * decide" cannot stop that: twenty requests all read zero and all pass.
+ *
+ * So admission is serialised per owner, on the owner's `billing_accounts` row —
+ * and **the row is created before it is locked**, which is the part that is easy
+ * to get wrong and was got wrong here before, in another table: *"a row lock is
+ * taken on rows the statement returns, so a `SELECT … FOR UPDATE` that matches
+ * nothing locks nothing"*
+ * (docs/postmortems/260901f-a-for-update-that-locks-nothing.md). A free reader
+ * has no billing row, so locking one that might not exist would serialise
+ * nobody, in exactly the case the boundary is for. `insert … on conflict do
+ * nothing` then `for update` is that postmortem's prescribed shape.
+ *
+ * Measured on 2026-09-02 with two real connections: the second transaction
+ * blocks for as long as the first holds the row, then reads the first's
+ * committed value. `tests/billing-quota-race.test.ts` is that measurement, kept.
+ *
+ * ## Why the lock is not held across `enqueue()`
+ *
+ * The obvious shape — hold the lock, count, create the job, commit — cannot be
+ * built and should not be. `enqueueOrGet` (src/store/pg-jobs.ts) is deliberately
+ * not a transaction, and holding a transaction open on one pooled connection
+ * while `enqueue()` takes a second would deadlock the pool at
+ * `DATABASE_POOL_MAX` concurrent admissions, which defaults to 5.
+ *
+ * Instead the **reservation** is what is written under the lock. A later
+ * admission counts unsettled reservations as used, so it sees an earlier one
+ * whether or not that one has reached `enqueue()` yet. **Nothing that opens its
+ * own transaction, and nothing that talks to the network, may be called between
+ * the lock and the commit** — that is the rule that keeps the pool argument
+ * true.
+ */
+
+import { and, eq, isNull, sql } from "drizzle-orm";
+
+import type { Entitlement } from "../billing/tiers.js";
+import { getDb } from "../db/client.js";
+import { billingAccounts, ingestEvents } from "../db/schema.js";
+import { log } from "../log.js";
+
+const logger = log("store");
+
+/** A slot was taken. The id goes on the job row, in the job's own INSERT. */
+export interface Admitted {
+  readonly kind: "admitted";
+  readonly reservationId: string;
+}
+
+/** The account is at its ceiling. Carries what a refusal message needs. */
+export interface Refused {
+  readonly kind: "refused";
+  readonly used: number;
+  readonly limit: number;
+  /** When the allowance resets, for a paid account. Absent means never. */
+  readonly resetAt?: Date;
+}
+
+export type Admission = Admitted | Refused;
+
+/** What an owner has used, for `/profile` and `/admin/users`. */
+export interface Usage {
+  /** Successful ingests inside the current period. */
+  readonly used: number;
+  /** Reservations taken and not yet settled — jobs in flight. */
+  readonly inFlight: number;
+}
+
+/**
+ * The usage half of admission, as SQL, so that the gate and the display ask the
+ * same question of the same columns rather than two questions that agree today.
+ *
+ * Half-open on the period — `>= start and < end` — so an ingest at the instant a
+ * period rolls over is counted once, in the new period, rather than in both or
+ * in neither.
+ *
+ * **In-flight has no age limit**, and that is the correction that matters most
+ * in this file. See `ingest_events` in src/db/schema.ts: an expiry here is a
+ * quota bypass, because held-open jobs are something a caller can arrange.
+ */
+function usageSql(ownerId: string, entitlement: Entitlement) {
+  const { periodStart, periodEnd } = entitlement;
+  const inPeriod =
+    periodStart && periodEnd
+      ? sql`succeeded_at >= ${periodStart.toISOString()}::timestamptz
+            and succeeded_at < ${periodEnd.toISOString()}::timestamptz`
+      : /* The free tier's period is all of time, so any success counts. */
+        sql`true`;
+
+  return sql`
+    select
+      count(*) filter (where succeeded_at is not null and ${inPeriod})::int as used,
+      count(*) filter (where succeeded_at is null and released_at is null)::int as in_flight
+    from spideryarn.ingest_events
+    where owner_id = ${ownerId}::uuid`;
+}
+
+/** Drizzle's `execute` shape differs by driver; this reads either. */
+function firstRow(result: unknown): Record<string, unknown> | undefined {
+  const withRows = result as { rows?: Array<Record<string, unknown>> };
+  if (Array.isArray(withRows.rows)) return withRows.rows[0];
+  return Array.isArray(result) ? (result[0] as Record<string, unknown>) : undefined;
+}
+
+function usageOf(result: unknown): Usage {
+  const row = firstRow(result);
+  return { used: Number(row?.used ?? 0), inFlight: Number(row?.in_flight ?? 0) };
+}
+
+/** What this owner has used against the entitlement they currently hold. */
+export async function usageFor(ownerId: string, entitlement: Entitlement): Promise<Usage> {
+  return usageOf(await getDb().execute(usageSql(ownerId, entitlement)));
+}
+
+/**
+ * Take a slot for a new ingest, or refuse.
+ *
+ * One transaction, one connection, nothing else called from inside it. The
+ * returned `reservationId` must be handed to `enqueue()` so that it lands in the
+ * job's own INSERT — see `jobs.ingest_event_id`. If it never reaches a job,
+ * `releaseReservation` gives it back.
+ *
+ * @param slug the intended slug, stored as a diagnostic only — it is mutable,
+ * so it is never this row's identity.
+ */
+export async function reserveIngest(
+  ownerId: string,
+  entitlement: Entitlement,
+  slug?: string,
+): Promise<Admission> {
+  return await getDb().transaction(
+    async (tx) => {
+      /* The anchor. `do nothing` rather than `do update` because there is
+         nothing to change — the row's existence is the whole point, and an
+         update would touch `updated_at` on every ingest for no reason. */
+      await tx
+        .insert(billingAccounts)
+        .values({ ownerId })
+        .onConflictDoNothing({ target: billingAccounts.ownerId });
+
+      /* And now it is certain to be there, so this locks something. Every other
+         admission for this owner waits here. */
+      const locked = await tx
+        .select({ ownerId: billingAccounts.ownerId })
+        .from(billingAccounts)
+        .where(eq(billingAccounts.ownerId, ownerId))
+        .for("update")
+        .limit(1);
+      if (locked.length === 0) {
+        /* Unreachable — the insert above guarantees a row and this transaction
+           holds it. Loud rather than silent, because the only way here is the
+           failure this whole file is about. */
+        throw new Error(`billing_accounts row for ${ownerId} vanished under its own lock`);
+      }
+
+      const usage = usageOf(await tx.execute(usageSql(ownerId, entitlement)));
+      const used = usage.used + usage.inFlight;
+      if (used >= entitlement.limit) {
+        return {
+          kind: "refused",
+          used,
+          limit: entitlement.limit,
+          ...(entitlement.periodEnd ? { resetAt: entitlement.periodEnd } : {}),
+        } satisfies Refused;
+      }
+
+      const [reservation] = await tx
+        .insert(ingestEvents)
+        .values({ ownerId, ...(slug ? { slug } : {}) })
+        .returning({ id: ingestEvents.id });
+      if (!reservation) throw new Error("reserving an ingest slot returned no row");
+      return { kind: "admitted", reservationId: reservation.id } satisfies Admitted;
+    },
+    /* Pinned rather than inherited. `on conflict do nothing` is only an escape
+       from a concurrent writer at `read committed`; at `repeatable read` it
+       raises 40001 at the insert, and nothing in src/ retries that
+       (docs/postmortems/260901f-…). Every other transaction in the store is
+       pinned for the same reason. */
+    { isolationLevel: "read committed" },
+  );
+}
+
+/**
+ * Give back a slot that never became a job.
+ *
+ * The **only** safe standalone release: `enqueue()` threw, or it deduplicated
+ * this request onto an existing job that carries its own reservation. In both
+ * cases no job row references this id, so nothing can be racing to settle it.
+ *
+ * Releasing by *job* must never happen this way. A `/cancel` that sets
+ * `released_at` from outside the job's own transition can lose a race with the
+ * publication it was trying to stop — the job publishes, and its settlement
+ * finds the reservation already released and charges nothing. So success and
+ * release both live in `settleIn`'s transaction, below. GPT Sol, 2026-09-02.
+ */
+export async function releaseReservation(reservationId: string): Promise<void> {
+  await getDb()
+    .update(ingestEvents)
+    .set({ releasedAt: new Date() })
+    .where(
+      and(
+        eq(ingestEvents.id, reservationId),
+        isNull(ingestEvents.succeededAt),
+        isNull(ingestEvents.releasedAt),
+      ),
+    );
+}
+
+/** The transaction handle `settleIn` has. Narrow on purpose: only `execute`. */
+export interface SettlementTx {
+  execute(query: ReturnType<typeof sql>): Promise<unknown>;
+}
+
+/**
+ * Settle a job's reservation **inside the transaction that ends the job**.
+ *
+ * This is the guarantee the whole design rests on: the charge commits with the
+ * revision it is charging for, and the release commits with the failure it is
+ * excusing. There is no window in which an ingest has succeeded and not been
+ * counted, none in which a failure has been charged, and no way for a cancel
+ * racing a publication to leave the two disagreeing — whichever transition wins
+ * the job fence is the one whose settlement lands, because they are the same
+ * transaction.
+ *
+ * A job with a null `ingestEventId` settles nothing: pipeline work from the CLI,
+ * a re-run of one step, seeding. The caller passes what the job carries and does
+ * not have to know which kind it has.
+ */
+export async function settleReservation(
+  tx: SettlementTx,
+  ingestEventId: string | null | undefined,
+  outcome: "succeeded" | "released",
+): Promise<void> {
+  if (!ingestEventId) return;
+  const column = outcome === "succeeded" ? sql.raw("succeeded_at") : sql.raw("released_at");
+  await tx.execute(sql`
+    update spideryarn.ingest_events
+       set ${column} = now()
+     where id = ${ingestEventId}::uuid
+       and succeeded_at is null
+       and released_at is null`);
+}
+
+/** Log a refusal where the reason is still in hand. Never the reader's prose. */
+export function noteRefusal(ownerId: string, refused: Refused): void {
+  logger.info(
+    { ownerId, used: refused.used, limit: refused.limit },
+    "ingest refused: the account is at its quota",
+  );
+}
```
