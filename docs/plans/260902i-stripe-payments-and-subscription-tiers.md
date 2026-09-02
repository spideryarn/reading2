# Stripe payments and subscription tiers

## Goal, context

Introduce payments: a freemium model with one paid tier, processed by Stripe.

- **Free**: sign in and ingest **3 articles, lifetime** — enough to play with the product.
- **Paid ("Reader", name TBC)**: **$10/month for 100 article ingests per billing period.**
- Reading is never gated. Greg, 2026-09-02:

  > To be clear: if a user has hit their quota, they should still be able to read their existing
  > and Public-readable articles, just not incur extra spend.

Pricing is deliberately finger-in-the-air. Greg, 2026-09-02:

> Right now I have no idea of the costs involved for uploading an article … I was thinking
> something like $10 a month allows you to upload 100 articles. In practice, that might actually
> mean that we're working at a loss depending on how much it costs to upload an article, but I'm
> assuming that most people won't max it out.

Cost-tracking and cost-estimating are **out of scope** — other agents are working on those. This
plan is the billing machinery: Stripe integration, a billing-account record per owner, and quota
enforcement at the ingest choke points.

**Status**: plan reviewed by GPT Sol 2026-09-02 (verdict: rework —
[review](260902i-stripe-payments-and-subscription-tiers-review-sol.md)); findings folded into this
revision. One open question for Greg is flagged inline (backfill, in the schema stage).

## References

- [auth.md](../project/auth.md) — identity is Supabase Auth; every row's owner is a `uuid` into
  `auth.users`. There is no local users table; `reader_profiles`
  ([`src/db/schema.ts`](../../src/db/schema.ts), keyed by `ownerId` as PK) is the existing
  per-owner singleton a `billing_accounts` table parallels.
- [`src/routes.ts`](../../src/routes.ts) — the hand-written dispatcher. `POST /api/jobs`
  (~`:6589`) is the ingest admission point (both URL and PDF-upload shapes); `POST /api/uploads`
  (~`:6573`) mints PDF staging uploads and gets a non-reserving eligibility check. The
  public-routes namespace (`src/public/routes.ts`, dispatched before the auth gate) is
  **read-only by construction**, so the Stripe webhook is an **exact-route** pre-auth match, not a
  namespace.
- [`src/jobs.ts`](../../src/jobs.ts) `enqueue()` — also reached by CLI/scripts and by *re-runs* of
  single pipeline steps on existing articles; those must not spend quota. `Job.url` cannot carry
  "this is a new ingest" (re-runs recover the URL too), hence the durable `counts_as_ingest`
  provenance below.
- [`src/store/pg-session.ts`](../../src/store/pg-session.ts) (~`:444`) — the transaction that
  publishes a revision and finishes a job; the ingest-success ledger insert joins it.
- [`src/store/pg-admin.ts`](../../src/store/pg-admin.ts) — per-owner `count(*)` machinery.
  [admin.md](../project/admin.md), [`src/admin.ts`](../../src/admin.ts),
  [`src/web/admin-columns.tsx`](../../src/web/admin-columns.tsx) — where plan/status/usage columns
  go.
- [`src/ai-spend.ts`](../../src/ai-spend.ts) + `ai_calls` ledger — the existing per-owner spend
  substrate; adjacent, not touched by this plan.
- [deployment.md](../project/deployment.md) — env-var table (~`:559`), `NODEJS_HELPERS=0` (raw
  bodies, which Stripe signature verification needs), `/api/health`.
- [t3dotgg/stripe-recommendations](https://github.com/t3dotgg/stripe-recommendations) — the
  sync-function pattern adopted (and hardened, per the review) below. Stripe docs:
  [Checkout](https://docs.stripe.com/payments/checkout/how-checkout-works) ·
  [Customer Portal](https://docs.stripe.com/customer-management/integrate-customer-portal) ·
  [subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks) ·
  [webhook signatures](https://docs.stripe.com/webhooks/signature) ·
  [Basil changelog: subscription period fields moved to items](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end) ·
  [idempotency](https://docs.stripe.com/api/idempotent_requests) ·
  [CLI webhook testing](https://docs.stripe.com/cli/intro_webhooks).

## Principles, key decisions

Product decisions agreed with Greg 2026-09-02; engineering hardening from the Sol review, checked
before adoption.

### Product

- **One paid tier at launch.** Simpler option taken; a second tier waits until someone wants it.
  The tier→quota map is app config keyed by Stripe price id, so adding one later is a config row,
  a price in Stripe, and portal configuration — not a schema change.
- **Free = 3 ingests, lifetime** (not per month). Matches "just to play around"; no period logic
  for free users.
- **Quota unit: successful new ingests** (URL or PDF). Re-running pipeline stages on an existing
  article is free. Deleting or archiving an article does not refund the slot.
- **At the limit: hard block with an upgrade prompt.** Refusal carries clear copy
  ([copy.md](../project/copy.md)) — upgrade link for free users, reset date for paid. No overage,
  no grace band in v1. **Reading is never blocked** (Greg's quote above).
- **Hosted Stripe Checkout + hosted Customer Portal; we never touch card data.** The entire
  custom billing UI is two redirect buttons. Billing/invoice history, receipts, payment-method
  changes and cancellation are all the Stripe-hosted Portal's job, not ours; the portal is
  configured for end-of-period cancellation so nobody loses access they've paid for. Card details
  never reach our servers — we store only opaque Stripe ids — which keeps us in Stripe's lightest
  PCI scope (SAQ-A). **Checkout is card-only in v1**, so no asynchronous payment-method events
  exist. Greg, 2026-09-02:

  > make sure we have all the machinery we might need (ideally making as much use of Stripe as
  > possible rather than building ourselves) for people to see their billing history, change
  > payment methods, cancel subscriptions, etc etc. And we want to minimise our infosec risk,
  > i.e. we don't want to process/touch/store sensitive info like card details.
- **Set up via API, not by hand, wherever Stripe allows.** Product, price, Customer Portal
  configuration and the production webhook endpoint are all creatable through the Stripe API with
  the secret key, so the agent does those; Greg's manual surface is the account itself, the keys,
  and the few dashboard-only settings (customer email receipts, dispute auto-cancellation,
  dunning, live-mode activation).
- **Refunds/disputes/dunning, v1 policy**: refunds are manual and must be paired with a
  cancellation when access should end; Stripe's automatic subscription-cancellation on dispute is
  enabled; dunning is configured so `past_due` eventually becomes `canceled`/`unpaid` (which are
  not entitled) rather than cycling forever.
- **Known hole, accepted for v1**: chat, comments, quizzes and search spend AI money and are not
  gated, so a free user with 3 articles can still incur unbounded spend. Deliberately deferred
  until the cost-tracking work lands; the natural future choke point is the AI gateway
  ([ai-gateway.md](../project/ai-gateway.md)).

### Quota accounting (reworked per Sol P1.1, P1.7, P2.5)

- **An unconditional append-only `ingest_events` ledger** is the source of truth for "successful
  ingests": immutable id, `owner_id`, unique successful job identity, `succeeded_at`
  (`default now()`), `article_id` (`on delete set null`) plus a diagnostic slug snapshot. A
  mutable slug is never its identity. One ledger, every environment — soft-archive is today's
  deletion story but hard deletes exist in maintenance/tests, and one mechanism beats two
  conditional ones.
- **Durable `counts_as_ingest` provenance on jobs**, set only by the authenticated new-ingest
  route (and copied by a failed ingest's retry). `Job.url` cannot carry this — re-runs have URLs
  too.
- **The ledger insert joins the same Postgres transaction** that publishes the revision and
  finishes the job (`pg-session.ts` ~`:444`). After-completion inserts have a crash gap;
  before-publication inserts charge failures.
- **Admission is atomic**: under a per-owner lock, count successful events **plus active
  quota-marked jobs**, then admit and insert the job in the same transaction. Failed/cancelled
  jobs stop occupying a reservation but never become a success event. This replaces the earlier
  draft's "small acknowledged race", which Sol correctly called a scripted bypass: N concurrent
  enqueues against a zero success-count all pass a count-only check.
- **Period arithmetic is half-open on database time**: `succeeded_at >= start AND < end`. If the
  stored period does not contain `now`, resync from Stripe once synchronously; if there is still
  no current period (or Stripe is down), **fail closed with 503** rather than allow spend — a
  stale period must become neither an unlimited window nor a false block on a valid renewal.
- **`POST /api/uploads` gets a non-reserving eligibility check** so an at-quota account cannot
  mint staging uploads repeatedly; the authoritative admission stays at `POST /api/jobs`.

### Stripe state (reworked per Sol P1.2, P1.3, P1.6, P2.2)

- **One `billing_accounts` row per owner, retained after cancellation**: `owner_id` PK,
  `stripe_customer_id` (unique), `stripe_subscription_id` (unique, nullable), `price_id`, raw
  Stripe `status` as **text** (entitlement derived from an exact allowlist, so an unknown future
  status fails to free rather than breaking an enum), `current_period_start/end`,
  `cancel_at_period_end`, `livemode`, `last_synced_at`, timestamps; check `period_start <
  period_end`.
- **Entitled statuses: `active`, `trialing`, `past_due`**; anything else (or no row) is free
  tier. We never delete articles on downgrade.
- **Billing period comes from the subscription item, not the subscription** — Stripe's Basil
  release (2025-03-31) removed `current_period_start/end` from the Subscription object. The plan
  pins an exact API version in `src/billing/stripe.ts`; sync validates exactly one supported
  recurring item at quantity one, and any unknown price/quantity/item combination **fails closed
  to free**, logged, rather than accidentally receiving Reader quota.
- **`syncSubscriptionFromStripe(customerId)` is serialized per customer** with a Postgres
  advisory lock spanning the **Stripe fetch and the write** — fetch-then-overwrite without the
  lock lets a slow handler commit stale state after a newer one (restoring a cancelled
  subscription, or reverting a renewal). It lists all the customer's subscriptions and applies a
  deterministic written policy: zero → free (customer mapping retained); one supported → current;
  multiple entitled → anomaly, logged and surfaced, never silently picked from. A late deletion
  event for a replaced subscription resyncs and retains the replacement.
- **Webhook event set (state-oriented)**: `checkout.session.completed`,
  `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`. All trigger the same sync; payloads are never trusted for
  state. `invoice.payment_failed` dropped — `past_due` is entitled and status transitions arrive
  via `subscription.updated`.
- **The handler awaits durable sync and returns 2xx only when state is synchronized**; Stripe or
  database failure returns 5xx so Stripe retries. Replays re-run the (idempotent) sync — "no-op"
  means same resulting state, not zero work.
- **Customer creation is serialized per owner** (reuse the mapped customer; Stripe idempotency
  keys for retries, but they expire after ~24h so the DB uniqueness is the real mechanism).
  Checkout is refused (redirected to the Portal) when a non-terminal subscription exists; an open
  unexpired Checkout Session is reused rather than a second one created. An abandoned Checkout
  leaves only a reusable mapped customer.

### Security invariants (per Sol P1.4, P1.5, P2.6)

- **Exact pre-auth route `POST /api/webhooks/stripe`** inside the existing `try`, before
  `requireUser()` — not a namespace; sibling paths stay unavailable. The handler: reads a
  size-capped raw `Buffer` once and hands those exact bytes to the SDK (parse-then-re-encode
  breaks signatures); requires both signature header and configured secret, failing **closed**
  when unconfigured; verifies before parsing; allowlists event types; **never calls
  `currentOwnerId()`** (there is no request owner in webhook scope); builds any URLs server-side.
- **The database customer→owner mapping is authoritative.** `client_reference_id`/metadata carry
  the owner uuid as redundant recovery/assertion data only — a webhook never overwrites an
  existing mapping from metadata, and no billing route ever accepts an owner or customer id from
  the browser. The checkout-success callback is authenticated, accepts only a Checkout Session
  id, retrieves it from Stripe, and proves the session's customer maps to the current user before
  syncing.
- **Live/test mode cannot silently cross.** Production refuses a non-live secret key;
  non-production refuses live keys; `event.livemode`, retrieved objects, and the configured price
  must agree; a release check retrieves the configured price and validates active + recurring
  monthly + expected amount/currency/mode. A prod deploy on `sk_test_…` would otherwise grant
  entitlement for test-card purchases while `/api/health` stayed green — the classic
  [silent success](../reusable/silent-success.md).
- **Dev-account exemption is scoped to verified local environment identity**, not a bare uuid
  match that would also fire in production; admin exemption uses the existing server-side
  `isAdmin()`.

### Simpler options passed over

Payment Links (no clean owner-id passthrough or redirect control); polling Stripe on request
instead of webhooks (failures/cancellations wouldn't propagate); counting articles *held* rather
than ingests (a storage cap, incoherent with monthly reset); calendar-month quota (a second clock
disagreeing with billing); conditional article-counting instead of the unconditional ledger (two
implementations of "lifetime count"); async-payment-method Checkout (event surface for nothing we
need); a webhook queue or event-dedupe table (Stripe's retries + idempotent sync suffice at this
scale — revisit only if observability shows a need). And the ones we chose *because* simpler:
exact webhook route over a namespace; hosted surfaces over any owned billing UI.

## Stages & actions

### Stage: Stripe account and environment plumbing (Greg + agent)

- ✅ **Greg (manual, test mode)**: Stripe account created; `STRIPE_SECRET_KEY` in `.env.local`
  on the box and the laptop (2026-09-02).
- ✅ `STRIPE_SECRET_KEY` added to the `gjd-remote push-env` allowlist
  ([`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts)) so future boxes inherit it —
  with a shape-based refusal of any **live**-mode Stripe secret (`sk_live_`/`rk_live_`), under
  any variable name, mirroring the Supabase-JWT check. `STRIPE_WEBHOOK_SECRET` deliberately NOT
  allowlisted: locally it is minted per machine by `stripe listen`, like the admin password.
  Tests in [`tests/gjd-remote-env.test.ts`](../../tests/gjd-remote-env.test.ts), red first.
  `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` documented in `.env.example`.
- [ ] **Greg (dashboard-only, optional now)**: Settings → Customer emails — receipts for
  successful payments, notifications for failed ones. Billing → Subscriptions: enable automatic
  subscription cancellation on dispute; review dunning/retry schedule so `past_due` terminates.
- [ ] Agent: install the Stripe CLI on this box (binary from GitHub releases; `--api-key` mode,
  no interactive login needed).
- [ ] Agent, via API: create product "Spideryarn Reader" + $10/mo recurring price (card-only
  Checkout config); create the Customer Portal configuration (invoice history, payment-method
  update, cancel at period end); record the price id as `STRIPE_PRICE_READER`.
- [ ] Add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_READER` to `.env.example`,
  the deployment.md env table, and `/api/health`.
- [ ] `npm install --save-exact stripe`; `src/billing/stripe.ts` constructs the client, **pins
  the exact API version** (named in code, verified against current Stripe docs at implementation
  time), and enforces the live/test key-vs-environment rules above.

### Stage: Thin end-to-end round trip (front-loaded risk, per Sol P3)

One real Checkout → signed webhook → database row, before any quota or UI work. Note
`stripe trigger checkout.session.completed` creates an unrelated fixture customer and can
"verify" delivery while correctly writing nothing — the round trip must assert the **row**, not
the delivery.

- [ ] Tests first: valid signature over exact bytes writes the expected owner row; same payload
  parsed-and-re-encoded fails; missing secret/header, oversized body, wrong method, sibling
  `/api/webhooks/*` path all refused; signed event with unknown mapping / Stripe failure / DB
  failure does **not** return 200.
- [ ] Drizzle migration: `billing_accounts` as specified above.
- [ ] `syncSubscriptionFromStripe` with the per-customer advisory lock; controlled-interleaving
  test proving stale state cannot land after fresher state; replay test (same logical state, no
  duplicates).
- [ ] Exact-route webhook handler as specified in the security invariants.
- [ ] Manual verification with `stripe listen --api-key … --forward-to
  localhost:PORT/api/webhooks/stripe` and a real test-mode Checkout completed by hand.
- [ ] `npm test`, `npm run typecheck`. Commit.

### Stage: Quota ledger and atomic admission

- ✅ **Backfill: decided — the ledger starts empty** (pre-launch articles are grandfathered and
  never counted). Greg, 2026-09-02:

  > We have no existing real users (probably only me) no production - I'm fine for you to do
  > whatever's simplest for them.
- [ ] Tests first: free owner blocked on 4th ingest; paid owner blocked on 101st in-period;
  **concurrent admissions** — launch more than the remaining allowance, prove no more than the
  allowance is admitted; step re-run never counts or blocks; failed/cancelled ingest frees its
  reservation and creates no event; successful retry of a failed ingest counts once; duplicate
  completion counts once; archive and hard delete leave the count unchanged; exact period
  boundaries (half-open); delayed-renewal (stale stored period → resync → 503 when Stripe
  unavailable); admin owner never blocked; dev exemption inert outside local; blocked response
  carries machine-readable reason + upgrade/reset info.
- [ ] Migration: `ingest_events` ledger + `counts_as_ingest` on jobs.
- [ ] Ledger insert inside the publish/finish transaction (`pg-session.ts` ~`:444`).
- [ ] `entitlementFor(ownerId)` → `{ tier, limit, periodStart?, periodEnd? }` from
  `billing_accounts` + the hardcoded `TIERS` map; unknown price → free, logged.
- [ ] Atomic admission in `POST /api/jobs` (new-ingest shapes only); non-reserving eligibility
  check in `POST /api/uploads`.
- [ ] Reader-facing refusal copy per [copy.md](../project/copy.md).
- [ ] `npm test`, `npm run typecheck`. Commit.

### Stage: Checkout, portal, and the reader-facing UI

- [ ] Tests first: checkout route refuses when a non-terminal subscription exists (redirects to
  portal); reuses an open session; serialized customer creation under concurrent requests
  (double-click test); authenticated success callback cannot sync another owner's session;
  live/test mode mismatch refused.
- [ ] `POST /api/billing/checkout` and `POST /api/billing/portal` as ordinary authenticated
  routes, per the customer-creation protocol above.
- [ ] Success-page return path: authenticated, session-id-only, ownership-proved, then sync.
- [ ] `/profile`: current plan, usage this period ("N of 100"), Upgrade / Manage-billing buttons.
- [ ] The at-quota refusal in the ingest UI surfaces the upgrade path.
- [ ] Confirm the API-created Portal configuration covers the full self-serve set: invoice/
  billing history, payment-method update, cancel at period end.
- [ ] Browser check via a Sonnet subagent ([browser-control.md](../project/browser-control.md)):
  free account hits the wall at 3; checkout round-trip in test mode with card `4242…`; portal
  round-trip (history, payment method, cancel); cancelled sub reverts to free limits without
  touching existing articles.
- [ ] Stop & review with Greg.

### Stage: Admin visibility + docs

- [ ] `/admin/users`: plan, status, ingests this period — one field on `AdminUser`, one column,
  one per-owner statement in `pg-admin.ts`.
- [ ] New evergreen doc `docs/project/billing.md` (owner: proposed under
  [security-map.md](../project/security-map.md), beside admin.md — **confirm owner with Greg**);
  update auth.md / deployment.md / architecture.md cross-links; `tests/doc-links.test.ts` green.
- [ ] Final health check: `npm test`, `npm run typecheck`, `npm run check`, lint on touched
  files.
- [ ] Test consolidation pass (subagent).

### Stage: Comp subscriptions (later — after go-live is stable)

Greg, 2026-09-02:

> it would be nice (as a later stage) for me to be able to give users a free 1-month (e.g. for
> journalists) and/or lifetime subscription (for me, QA, close friends, etc).

- [ ] **App-side comp, not Stripe coupons**: two nullable columns on `billing_accounts` —
  `comp_until` (timestamptz; a far-future/`infinity` value or a separate lifetime flag for
  lifetime) — granted from `/admin/users` (or a small script). `entitlementFor` treats an active
  comp as Reader-tier quota; comp and a real subscription can coexist (take the better).
  *Simpler option passed over: Stripe 100%-off promotion codes or trials — Stripe-native, but
  they force the recipient through Checkout and (usually) a card form, which is exactly wrong for
  a journalist you're trying to give frictionless access.*
- [ ] Comp status visible on `/admin/users` and on the user's own `/profile`.
- [ ] Tests: comp grants Reader quota; expiry reverts to free without touching articles; comp
  plus subscription takes the better of the two.

### Stage: Go-live (when we ship this)

- [ ] **Greg (manual)**: activate live mode — business verification and a payout bank account;
  Stripe requires the account holder.
- [ ] **Greg (manual)**: set live `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_READER` in Vercel env (production) — no Vercel credential exists on this box.
- [ ] Agent, via API with the live key: recreate product/price/portal config; create the
  production webhook endpoint at `https://<prod-host>/api/webhooks/stripe` subscribed to the four
  events; hand Greg the signing secret for the Vercel step.
- [ ] Release check: retrieve and validate the configured live price (active, recurring monthly,
  amount/currency, livemode).

### ✅ Stage: External critique of the plan

- ✅ Pre-critique version committed (6a94889); prompt at
  [260902i-…-review-prompt.md](260902i-stripe-payments-and-subscription-tiers-review-prompt.md).
- ✅ GPT Sol review returned (exit 0, non-empty answer):
  [260902i-…-review-sol.md](260902i-stripe-payments-and-subscription-tiers-review-sol.md).
  **Verdict: rework.** All seven P1s and the P2s checked and folded into this revision; the
  backfill question (P2.1) escalated to Greg in the ledger stage.
- [ ] After implementation: second Sol review of the code diff — weighted higher than this one
  (a plan review cannot find the bug that doesn't exist yet).

## Appendix

### Research summary (2026-09-02, web + repo exploration by subagents)

- Hosted Checkout + Customer Portal is where current (2025–26) solo-dev guidance converges;
  embedded Checkout/Elements buys only a non-redirect UX at real integration cost.
- The canonical failure mode is event-payload-driven webhook handlers ("split brain" when events
  arrive out of order); the fetch-fresh-and-overwrite sync function collapses ~250 event shapes
  into one code path — **but needs per-customer serialization** (Sol P1.2) to be actually safe.
- Webhook must see the **raw** body (signature verification) and run on the Node runtime — both
  already true of our single Vercel function (`NODEJS_HELPERS=0`).
- Stripe CLI test loop: `stripe listen --api-key … --forward-to …`; the CLI's `whsec_…` is
  distinct from the dashboard one used in prod; `stripe trigger` fixtures don't touch our
  mappings, so assertions must be on rows, not deliveries.
- Repo has **zero** existing payments code; nearest neighbours are the `ai_calls` per-owner spend
  ledger and the per-owner counting in `pg-admin.ts`.

### Deferred / out of scope

- Second paid tier; annual pricing; Stripe Tax / VAT registration (far below UK threshold; price
  VAT-inclusive; revisit before revenue is real); Stripe Entitlements API; gating chat/comments/
  quiz/search spend (waits for cost-tracking; future choke point is the AI gateway); overage or
  grace bands; metered billing; async payment methods; webhook queue/event-dedupe machinery;
  pricing/marketing page beyond `/profile`.
