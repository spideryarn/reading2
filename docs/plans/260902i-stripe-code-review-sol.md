Verdict: I would not ship the quota path yet. The webhook verification and row-locking strategy are sound, and `usageSql` is parameterised correctly, but reservation settlement still has silent free-ingest paths.

## 1. Anything outright broken

1. **High — `releaseReservation` can release a reservation whose job actually committed.**  
   [src/store/pg-billing.ts:224](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/store/pg-billing.ts:224)

   The comment assumes that if `enqueue()` throws, no job exists. A database INSERT can commit and then lose its response. Calling `releaseReservation` after that ambiguous failure sets `released_at`; the committed job subsequently succeeds, and `settleReservation` silently updates zero rows. The ingest is free.

   Make the release conditional on `NOT EXISTS (SELECT 1 FROM jobs WHERE ingest_event_id = …)`. Also use database `now()` rather than `new Date()`; otherwise clock skew between Vercel and Supabase can violate `released_at >= reserved_at` and leak a paying customer’s slot.

2. **High — `settleReservation` silently accepts missing, released, or already-settled reservations.**  
   [src/store/pg-billing.ts:257](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/store/pg-billing.ts:257)

   The UPDATE has no `RETURNING` or affected-row assertion. Zero updated rows still lets the publication/job-ending transaction commit. That directly contradicts the claimed atomic charge guarantee.

   Require exactly one returned row for a winning terminal transition. A null `ingestEventId` may legitimately no-op; a non-null ID that cannot transition must abort the transaction.

   This is compounded by [jobs.ingestEventId](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/db/schema.ts:1760) having no foreign key. “Jobs are deletable” is not a reason to omit one: a default `NO ACTION` FK from job to event does not cascade when the job is deleted. Ideally make it composite—`(ingest_event_id, owner_id) → (id, owner_id)`—so a job cannot charge another owner’s reservation.

3. **High — `reserveIngest` locks the billing row but uses entitlement read outside that lock.**  
   [src/store/pg-billing.ts:154](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/store/pg-billing.ts:154)

   `entitlement` is passed in, while the locked SELECT reads only `ownerId`. A webhook can change active→cancelled or free→active between the caller’s entitlement read and this lock. The function then either grants Reader quota after cancellation or refuses a newly paying customer.

   Derive entitlement from the row returned by the locked SELECT. If a stale period requires a Stripe resync, do that before this transaction, then enter and re-read the row under the lock.

4. **High in the anomaly path — `chooseSubscription` can still drop a paying Reader to free.**  
   [src/billing/subscription.ts:181](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/billing/subscription.ts:181)

   It selects among live statuses without knowing which price is recognised. If an active Reader subscription coexists with a newer active unknown-price subscription, the unknown one wins; later `tierForPrice` returns `null`, despite the customer still having a valid Reader subscription.

   Picking is better than refusing, but pick the newest **recognised entitled** subscription. Still report the anomaly across all live subscriptions.

5. **Medium — `usageOf` fails open if the result shape is unexpected.**  
   [src/store/pg-billing.ts:126](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/store/pg-billing.ts:126)

   A missing row, driver-shape change, or malformed count becomes `{used: 0, inFlight: 0}`. This query is an aggregate without grouping, so absence is impossible under correct execution. Throw on no row, non-integers, negatives, or non-finite values. Defaulting a quota calculation to zero is the wrong failure direction.

6. **Lower severity — `syncSubscriptionFromStripe` does not list “all” subscriptions.**  
   [src/billing/sync.ts:98](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/billing/sync.ts:98)

   `limit: 100` fetches one page. Stripe’s maximum page size is 100 and pagination is explicit, so an older active subscription can be omitted behind 100 newer records. Use auto-pagination with a defensible total cap. [Stripe’s list API documents the 100-item maximum and cursors](https://docs.stripe.com/api/subscriptions/list).

### The pooled connection across Stripe

Keeping the lock is reasonable for a handful of subscribers. Correctness wins here. However, the installed Stripe client defaults to an 80-second timeout and one network retry, so five degraded calls can occupy the entire pool for a long time. Set a much shorter request timeout before shipping.

A monotonic marker is the right eventual direction only if it is a real fencing token. `event.created` alone is not enough: it has one-second resolution and describes the triggering event, not the fetched snapshot. The robust escape hatch is:

1. In a short transaction, increment/store a per-customer sync generation.
2. Fetch Stripe without a connection held.
3. Conditionally write only if that generation is still current.

## 2. Anything unverified I would not ship on reasoning alone

In priority order:

1. **Settlement atomicity, through real `pg-session.settleIn`.** This test does not yet exist because the wiring does not exist. Reserve a slot, attach it to a real job, and assert:

   - `done` publishes the revision, ends the job, and sets `succeeded_at` in one commit.
   - `error` and cancellation end the job and set `released_at`.
   - An injected settlement failure rolls back publication and the terminal job transition.
   - A non-null missing/already-released reservation makes publication fail.
   - A queued-cancel and a cancel racing final publication settle exactly once according to the winning job transition.

2. **The existing concurrency suite must actually run.**  
   `tests/billing-quota-race.test.ts` is the direct proof that twenty simultaneous requests cannot pass a three-slot limit. The deterministic “second transaction remains blocked” assertion and the twenty-request burst both need to execute against the generated migration.

3. **The actual migration constraints must run.**

   Assert not merely that tables exist, but that:

   - both owner FKs exist;
   - the job→reservation FK exists, preferably owner-matching;
   - `jobs_ingest_event_unique` rejects reuse;
   - terminal timestamps cannot coexist or precede reservation;
   - deleting a job preserves its ingest event;
   - deleting an owner with ledger history is refused as intended.

4. **`syncSubscriptionFromStripe` needs a real-Postgres controlled-interleaving test.** None of the webhook tests calls the real sync. With two connections and a stubbed Stripe client, prove the second call does not reach Stripe until the first transaction commits, then prove its fresher response is the final row. Also test that cancellation clears every nullable field and that replay changes only diagnostic timestamps.

5. **Add the ambiguous-enqueue test.** Insert a job carrying the reservation, simulate a thrown/unknown enqueue outcome, call the standalone release path, and assert the reservation is not released.

## 3. Anything simpler

- Delete `SettlementTx`. It does not enforce transaction membership: `getDb()` structurally has `execute`, so `settleReservation(getDb(), …)` is trivial and type-correct. Put `settleReservationIn` beside `settleIn`, accept its actual `Tx`, and keep it unexported if possible.

- Replace `Entitlement`’s independent optional fields with a discriminated union:

  ```ts
  type Entitlement =
    | { tier: "free"; limit: number }
    | { tier: "reader"; limit: number; periodStart: Date; periodEnd: Date };
  ```

  This is both simpler to consume and actually enforces the invariant the comment claims.

- Remove `firstRow`’s unused multi-driver compatibility. This repository has one node-postgres driver. Read its typed `.rows[0]` and throw if the aggregate row is absent.

- Replace the dynamic `sql.raw` column selection with two ordinary Drizzle `.set(...)` objects. The present union makes it safe, but the machinery buys little.

- `noteSyncFailure` is unused and duplicates the webhook’s existing error logging. Remove it unless another concrete caller appears.

- `lastSyncedAt` and `updatedAt` are currently written together on every sync. Unless they will intentionally diverge, keep one.

## 4. Comments that claim more than the code does

- [pg-billing.ts:5](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/store/pg-billing.ts:5), [schema.ts:1744](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/db/schema.ts:1744), and [schema.ts:3315](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/db/schema.ts:3315) describe admission and settlement as already wired. They are not.

- [tiers.ts:35](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/billing/tiers.ts:35) says the types make period bounds optional together. They are independently optional.

- [tiers.ts:91](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/billing/tiers.ts:91) says the caller resyncs and then fails closed. No such caller exists, and this function returns the ordinary free entitlement rather than a 503/refusal.

- [schema.ts:1755](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/db/schema.ts:1755) says a foreign key would imply a wrong cascade. It would not; `NO ACTION` is the default.

- [pg-billing.ts:214](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/store/pg-billing.ts:214) says an `enqueue()` throw proves no job references the reservation. It does not.

- [sync.ts:70](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/billing/sync.ts:70) says replay produces “the same row.” Both timestamps change. It is entitlement-idempotent, not row-idempotent.

- [sync.ts:93](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/billing/sync.ts:93) says “all of them”; only the first 100 are fetched.

- [webhook.ts:213](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/billing/webhook.ts:213) says Checkout normally beats the success callback that writes the mapping. That must not become the implementation. A browser return callback is not reliable; the mapping must be durable before creating a Checkout Session capable of taking payment. Under that invariant, “unmapped” is an anomaly or dashboard-created customer, not a normal race.

  Keeping 503 is acceptable at this scale: Stripe retries non-2xx deliveries with exponential backoff for up to three days, so it is finite noise rather than an unbounded storm. [Stripe documents that retry policy](https://docs.stripe.com/webhooks?lang=node). Log it as an anomaly and do not rely on it to repair browser-dependent mapping.

- [webhook.ts:261](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/billing/webhook.ts:261) implies returning 400 avoids retry. Stripe retries any non-2xx, including 400.

- [webhook.ts:33](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/billing/webhook.ts:33) says an oversized body is refused before being read into memory. Node has already materialised the current chunk; the code merely avoids retaining chunks beyond the cap.

- [tiers.ts:20](/home/greg/code/spideryarn2/.claude/worktrees/stripe-payments/src/billing/tiers.ts:20) says a second paid tier is “a row here.” There is no row/table: it requires changes to the union, quota constants, price mapping, and `entitlementFor`.

Finally, the interpolation concern is clear: **confirmed parameterised**. With the installed Drizzle dialect, `usageSql` compiles the two ISO timestamps and owner UUID to `$1`, `$2`, and `$3`, with all values in `params`. There is no injection through those interpolations.