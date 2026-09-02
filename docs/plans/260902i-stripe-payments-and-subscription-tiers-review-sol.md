The direction is good—hosted Checkout/Portal, one authoritative sync path, and route-level ingest classification—but the plan is not build-ready. The quota accounting and Stripe synchronization both have correctness holes that can produce free spend or stale entitlement.

## P1 — blocking

1. **The quota design cannot enforce “successful ingests” or the hard cap as written.**

   [Principles lines 64–70](/home/greg/code/spideryarn2/docs/plans/260902i-stripe-payments-and-subscription-tiers.md:64), [schema lines 117–120](/home/greg/code/spideryarn2/docs/plans/260902i-stripe-payments-and-subscription-tiers.md:117), and [enforcement lines 134–140](/home/greg/code/spideryarn2/docs/plans/260902i-stripe-payments-and-subscription-tiers.md:134) leave three gaps:

   - `POST /api/jobs` only accepts work; success occurs minutes later.
   - Nothing durably carries “this job is a new ingest” from the route into the job lifecycle. `Job.url` cannot provide that provenance because existing-article reruns also recover and store the article URL.
   - Counting only completed ingests before enqueue means a new free account can launch many concurrent jobs while its success count is zero. Calling that a “small race” understates a straightforward scripted quota bypass.

   Change the schema stage to build `ingest_events` unconditionally. Current articles are soft-archived, but real hard deletes exist in maintenance/tests, and one ledger is simpler than two conditional counting implementations. It should contain an immutable event ID, `owner_id`, unique successful job/attempt identity, `succeeded_at default now()`, and optionally `article_id on delete set null` plus a diagnostic slug snapshot. A mutable slug must not be its identity.

   Add durable `counts_as_ingest` provenance to jobs, set only by the authenticated new-ingest route and copied by a failed ingest’s retry. Insert the success event in the same Postgres transaction that publishes the revision and finishes the job—currently the transaction in [pg-session.ts](/home/greg/code/spideryarn2/src/store/pg-session.ts:444). An insert after job completion has a crash gap; an insert before publication charges failures.

   Finally, make admission atomic. The quota transaction must count successful events plus active quota-marked jobs, then reserve/insert the new job under the same per-owner lock. Failed or cancelled jobs stop occupying a reservation but never create a success event. The semantic choice can remain in the route; the database primitive beneath it must be atomic. Add a concurrent test that launches more than the remaining allowance and proves no more than the allowance is admitted.

2. **“Fetch fresh and overwrite” is still vulnerable to concurrent stale writes.**

   [Lines 74–79](/home/greg/code/spideryarn2/docs/plans/260902i-stripe-payments-and-subscription-tiers.md:74) solve delivery ordering but not execution ordering:

   1. Handler A fetches state S1.
   2. Stripe changes to S2.
   3. Handler B fetches and writes S2.
   4. Handler A writes stale S1 last.

   That can restore entitlement after cancellation or revoke a valid renewal until another event happens. Stripe explicitly does not guarantee event delivery order, and duplicate delivery is normal. [Stripe’s webhook guidance](https://docs.stripe.com/webhooks?lang=node)

   Serialize the entire fetch-and-write operation per Stripe customer using a database advisory/row lock that works across Vercel instances. The lock must cover the Stripe fetch, not merely the upsert. Add a controlled interleaving test that would otherwise make S1 land after S2.

3. **Customer creation, customer ownership, and multiple-subscription selection are unspecified.**

   [Lines 80–81](/home/greg/code/spideryarn2/docs/plans/260902i-stripe-payments-and-subscription-tiers.md:80) and [checkout lines 146–148](/home/greg/code/spideryarn2/docs/plans/260902i-stripe-payments-and-subscription-tiers.md:146) need an explicit protocol.

   Stripe permits multiple independent subscriptions for one customer, including multiple subscriptions to the same price. [Stripe’s multiple-subscriptions documentation](https://docs.stripe.com/billing/subscriptions/quantities?locale=en-GB) Two concurrent checkout requests can also create duplicate customers or two completable sessions. A singleton row cannot safely “pick the first” subscription.

   Amend the plan to require:

   - One persisted billing-account row per owner, retained even after cancellation.
   - Unique `stripe_customer_id` and unique nullable `stripe_subscription_id`.
   - Serialized customer creation per owner, reuse of the mapped customer, and a Stripe idempotency key for ambiguous retries. Stripe idempotency helps with retries but is not permanent—keys can be pruned after 24 hours—so it is not the sole uniqueness mechanism. [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests)
   - Reuse of an unexpired open Checkout Session, or another server-side rule preventing concurrent sessions.
   - Checkout refusal/portal redirect when a non-terminal subscription already exists.
   - `syncSubscriptionFromStripe` lists all relevant subscriptions and applies a written deterministic policy: zero means free while retaining the customer; one supported subscription is current; multiple entitled subscriptions are an anomaly that is logged and surfaced rather than silently selected.
   - Replacement subscriptions overwrite the current subscription fields; a late deletion event for the old subscription must resync the customer and retain the replacement.

   An abandoned Checkout should leave only a reusable mapped customer/open session, not a second customer on the next click.

4. **The pre-auth boundary and owner mapping need to be specified as security invariants.**

   [Webhook lines 127–129](/home/greg/code/spideryarn2/docs/plans/260902i-stripe-payments-and-subscription-tiers.md:127) say “namespace,” which risks exempting more than one exact endpoint from the auth gate.

   Require an exact `POST /api/webhooks/stripe` match inside the existing `try`, before `requireUser()`. Sibling `/api/webhooks/*` paths must remain unavailable, and other API paths must still reach auth. The handler must:

   - Read a size-capped raw `Buffer` once and pass those exact bytes to Stripe’s SDK.
   - Require both the signature header and configured secret; missing configuration fails closed.
   - Verify before parsing or extracting IDs.
   - Allowlist event types.
   - Never call `currentOwnerId()` in the empty pre-auth request scope.
   - Await durable synchronization and return 2xx only when the relevant state exists and is synchronized/unchanged; Stripe or database failure must return 5xx for retry.
   - Construct all redirect/return URLs server-side.

   Stripe signatures fail if JSON is parsed and re-encoded, even when it is logically identical. [Stripe signature guidance](https://docs.stripe.com/webhooks/signature?lang=node&locale=en-GB)

   `client_reference_id` and metadata are safe only because authenticated server code writes them. Do not accept an owner UUID in the checkout body, and do not let a webhook overwrite an existing customer→owner mapping from metadata alone. The database mapping should be authoritative; Customer, Checkout Session, and `subscription_data.metadata` should carry the UUID as redundant recovery/assertion data.

   The checkout-success endpoint must be authenticated, accept only a Checkout Session ID, retrieve it from Stripe, and prove that its mapped customer/client reference is the current user before syncing. Never accept a customer ID or owner ID from the browser.

5. **Production can silently run against Stripe test mode.**

   [Environment lines 102–113](/home/greg/code/spideryarn2/docs/plans/260902i-stripe-payments-and-subscription-tiers.md:102) add only env-name reporting. A production deployment with `sk_test_…` would grant paid entitlement for test-card purchases while health appeared green.

   Add configuration validation:

   - Production refuses a non-live secret key.
   - Non-production refuses live keys unless explicitly authorized.
   - Webhook `event.livemode`, retrieved Customer/Subscription, and configured Price mode must agree.
   - Retrieve and validate the configured price during a release check: active, recurring monthly, expected currency/amount, and live/test mode.
   - Tests prove a test key/event cannot write production entitlement.

6. **The billing-period fields are wrong for a current Stripe API unless the plan deliberately pins an older version.**

   [Lines 84–85](/home/greg/code/spideryarn2/docs/plans/260902i-stripe-payments-and-subscription-tiers.md:84) and [schema lines 123–125](/home/greg/code/spideryarn2/docs/plans/260902i-stripe-payments-and-subscription-tiers.md:123) assume subscription-level `current_period_start/end`. Stripe’s 2025-03-31 Basil change removed those fields from the Subscription and moved them to Subscription Items. [Stripe changelog](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end?locale=en-GB)

   Name the exact pinned API version in the plan and, preferably, use the configured Reader subscription item’s period. Validate exactly one supported recurring item with quantity one. Unknown prices, quantities, or item combinations must fail closed rather than accidentally receiving the Reader quota.

7. **A stale stored billing period can become an unlimited window.**

   If the webhook is late and `now >= current_period_end`, counting only `[oldStart, oldEnd)` makes every later ingest invisible until synchronization. Conversely, continuing to count the expired period falsely blocks a valid renewal.

   Specify that entitlement checks use database time and half-open intervals—`succeeded_at >= start AND succeeded_at < end`. If the stored period does not contain `now`, synchronously resync Stripe once; if the returned state still has no current period or Stripe is unavailable, return 503 rather than allow spend. Add exact-boundary and delayed-renewal tests.

## P2 — should fix

1. **Use the append-only ledger for every environment and decide historical backfill.**

   The schema should also pin nullable subscription fields, `period_start < period_end`, owner/customer/subscription uniqueness, `livemode`, and `last_synced_at`. Keep raw Stripe status as text and derive entitlement from an exact allowlist so a future Stripe status fails free rather than breaking an enum migration.

   State whether pre-launch non-fixture articles are backfilled as lifetime free ingests or grandfathered. Otherwise two implementations can produce different “lifetime” counts.

2. **Revise the webhook event set and payment-method assumptions.**

   `invoice.payment_failed` is largely redundant when `past_due` remains entitled and subscription changes trigger `customer.subscription.updated`. The minimal state-oriented set is more naturally:

   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

   Stripe documents `customer.subscription.updated` for renewals and changes. [Subscription webhook documentation](https://docs.stripe.com/billing/subscriptions/webhooks)

   Either adopt that set or explain why invoice events are necessary. If Checkout permits delayed payment methods, add the asynchronous success/failure events; the simpler v1 is to configure card-only Checkout and say so.

3. **Refunds, disputes, and failed-payment exhaustion need an explicit v1 policy.**

   A refund does not itself cancel a subscription, and a dispute can leave it cycling unless Stripe’s automatic dispute-cancellation setting is enabled. [Refund documentation](https://docs.stripe.com/refunds), [subscription cancellation/disputes](https://docs.stripe.com/billing/subscriptions/cancel?dashboard-or-api=api)

   The smallest acceptable v1 is: refunds are handled manually and must be accompanied by cancellation when access should end; configure automatic dispute cancellation; configure dunning so `past_due` eventually becomes a non-entitled status. Add these dashboard steps beside the Portal configuration.

4. **The test list needs outcome-level controls.**

   Add tests for:

   - A valid signature over exact bytes writes the expected owner row.
   - The same signature over parsed/re-encoded JSON fails.
   - Missing secret/header, oversized body, wrong method, and sibling webhook path.
   - Relevant signed event with unknown mapping, Stripe failure, or DB failure does not return 200.
   - Replay produces the same logical state and no duplicate ledger/event—not necessarily zero Stripe calls.
   - Two overlapping syncs cannot commit stale state.
   - Customer creation/checkout double-click and multiple-subscription anomaly.
   - Failed/cancelled ingest, successful retry, duplicate completion, archive, and hard delete.
   - Concurrent quota admissions.
   - Every Stripe status, unknown price, stale period, and exact period boundaries.
   - Authenticated success callback cannot sync another owner’s session.
   - Test/live mode mismatch.

   The current “replayed event is a no-op” wording should be changed: fetch-and-upsert may execute again while remaining idempotent. If an event-receipt table is added, mark an event processed only after synchronization succeeds; otherwise a crash can permanently suppress the retry.

5. **Gate upload minting when the owner is already ineligible.**

   `POST /api/uploads` currently precedes `POST /api/jobs`, so an at-quota account could still mint and fill staging storage repeatedly. Do a non-reserving eligibility check before minting an upload, then perform the authoritative atomic admission at `/api/jobs`.

6. **Scope “seeded dev account” exemption to the local project.**

   Do not make `DEV_OWNER_ID` a production exemption merely because the UUID matches. Tie it to verified local Supabase/environment identity. The admin exemption can continue using the existing server-side `isAdmin()` decision.

## P3 — nice to improve

- Move the “External critique” stage before all build stages; its current position after implementation-shaped stages contradicts “required, before building.”
- Front-load one thin real Checkout→signed webhook→database round trip before quota/UI work. `stripe trigger checkout.session.completed` creates an unrelated fixture customer and can “verify” delivery while correctly writing nothing.
- Replace “returns 200 fast” with “awaits the authoritative sync and returns 2xx only after durable state.” An asynchronous webhook queue is unnecessary complexity for v1; Stripe retries are adequate if failures remain non-2xx.
- Name the simpler alternatives now being chosen: exact webhook route rather than a namespace, unconditional ledger rather than conditional article counting, card-only Checkout rather than asynchronous-payment handling, and no webhook queue/event-dedupe machinery unless observability demonstrates a need.

**Verdict: rework.**