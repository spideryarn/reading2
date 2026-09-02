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
plan is the billing machinery: Stripe integration, a subscription record per owner, and quota
enforcement at the ingest choke point.

## References

- [auth.md](../project/auth.md) — identity is Supabase Auth; every row's owner is a `uuid` into
  `auth.users`. There is no local users table; `reader_profiles`
  ([`src/db/schema.ts`](../../src/db/schema.ts), keyed by `ownerId` as PK) is the existing
  per-owner singleton a `subscriptions` table parallels.
- [`src/routes.ts`](../../src/routes.ts) — the hand-written dispatcher. `POST /api/jobs`
  (~`:6589`) is the single ingest choke point (both URL and PDF-upload shapes); the owner is
  already resolved there via `requireUser()` → `setRequestOwner()`. The public-routes namespace
  (`src/public/routes.ts`, dispatched before the auth gate) is **read-only by construction**, so a
  Stripe webhook does not fit it — it needs its own pre-auth namespace.
- [`src/jobs.ts`](../../src/jobs.ts) `enqueue()` — also reached by CLI/scripts and by *re-runs* of
  single pipeline steps on existing articles; those must not spend quota, which is why enforcement
  sits in the route, not here.
- [`src/store/pg-admin.ts`](../../src/store/pg-admin.ts) — per-owner `count(*)` machinery; its
  header explicitly welcomes one more statement per table. [admin.md](../project/admin.md),
  [`src/admin.ts`](../../src/admin.ts), [`src/web/admin-columns.tsx`](../../src/web/admin-columns.tsx)
  — where plan/status/usage columns go.
- [`src/ai-spend.ts`](../../src/ai-spend.ts) + `ai_calls` ledger — the existing per-owner spend
  substrate; adjacent, not touched by this plan.
- [deployment.md](../project/deployment.md) — env-var table (~`:559`), `NODEJS_HELPERS=0` (raw
  bodies, which Stripe signature verification needs), `/api/health` env-name reporting.
- [t3dotgg/stripe-recommendations](https://github.com/t3dotgg/stripe-recommendations) — the
  sync-function pattern adopted below. Stripe docs:
  [Checkout](https://docs.stripe.com/payments/checkout/how-checkout-works) ·
  [Customer Portal](https://docs.stripe.com/customer-management/integrate-customer-portal) ·
  [subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks) ·
  [webhook signatures](https://docs.stripe.com/webhooks/signature) ·
  [CLI webhook testing](https://docs.stripe.com/cli/intro_webhooks).

## Principles, key decisions

All agreed with Greg 2026-09-02 unless marked otherwise.

- **One paid tier at launch.** Simpler option taken; a second tier waits until someone wants it.
  The tier→quota map is app config keyed by Stripe price id, so adding one later is a config row,
  a price in Stripe, and portal configuration — not a schema change.
- **Free = 3 ingests, lifetime** (not per month). Matches "just to play around"; no period logic
  for free users.
- **Quota unit: successful new ingests** (URL or PDF), counted per Stripe billing period for paid
  users. Re-running pipeline stages on an existing article is free. Deleting an article does not
  refund the slot — so counting must survive article deletion (see the ledger note in the schema
  stage).
- **At the limit: hard block with an upgrade prompt.** The ingest request is refused with a clear
  message ([copy.md](../project/copy.md)) — upgrade link for free users, reset date for paid. No
  overage, no grace band in v1. **Reading is never blocked** (Greg's quote above).
- **Hosted Stripe Checkout + hosted Customer Portal; we never touch card data.** The entire
  custom billing UI is two redirect buttons. Billing/invoice history, receipts, payment-method
  changes and cancellation are all the Stripe-hosted Portal's job, not ours; the portal is
  configured for end-of-period cancellation so nobody loses access they've paid for. Card details
  never reach our servers — we store only opaque Stripe ids — which keeps us in Stripe's lightest
  PCI scope (SAQ-A). Greg, 2026-09-02:

  > make sure we have all the machinery we might need (ideally making as much use of Stripe as
  > possible rather than building ourselves) for people to see their billing history, change
  > payment methods, cancel subscriptions, etc etc. And we want to minimise our infosec risk,
  > i.e. we don't want to process/touch/store sensitive info like card details.
- **Set up via API, not by hand, wherever Stripe allows.** Product, price, Customer Portal
  configuration and the production webhook endpoint are all creatable through the Stripe API with
  the secret key, so the agent does those; Greg's manual surface is the account itself, the keys,
  and the few dashboard-only settings (customer email receipts, live-mode activation).
- **Webhooks feed one dumb sync function.** Four events (`checkout.session.completed`,
  `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`)
  all trigger the same `syncSubscriptionFromStripe(customerId)`: fetch current state fresh from
  Stripe, write it down. Never trust an individual event payload for state — they arrive out of
  order. Also called synchronously on checkout-success return, so the UI is right before the
  webhook lands. Idempotent by construction, which is also the webhook-retry story.
- **No Stripe customer for free users.** Created lazily at first checkout; our owner uuid rides in
  `client_reference_id` and `metadata` so webhooks can always map back.
- **Entitled statuses: `active`, `trialing`, `past_due`** (Stripe's retry window); anything else
  is the free tier. We never delete articles on downgrade — the quota gates new ingests only.
- **Quota clock = Stripe billing period** (`current_period_start/end`), not calendar month, so the
  quota clock and the billing clock cannot disagree.
- **Skip Stripe Entitlements API** (extra sync surface for one number per tier) and **skip Stripe
  Tax** for now (far below UK VAT threshold; price VAT-inclusive; revisit before revenue is real).
- **Admin/dev exemption**: owners in `ADMIN_USER_IDS`, and the seeded dev accounts, bypass quota.
- **Known hole, accepted for v1**: chat, comments, quizzes and search spend AI money and are not
  gated, so a free user with 3 articles can still incur unbounded spend. Deliberately deferred
  until the cost-tracking work lands; the natural future choke point is the AI gateway
  ([ai-gateway.md](../project/ai-gateway.md)), through which every paid call already flows.

**Simpler options passed over**: Payment Links (no clean owner-id passthrough or redirect
control); polling Stripe on request instead of webhooks (payment failures and cancellations
wouldn't propagate until the user visits a billing page); counting articles *held* rather than
ingests (turns the product into a storage cap and makes monthly reset incoherent); calendar-month
quota (a second clock that can disagree with billing).

## Stages & actions

### Stage: Stripe account and environment plumbing (Greg + agent)

- [ ] **Greg (manual, test mode)**: create the Stripe account at dashboard.stripe.com; copy the
  **test-mode secret key** (`sk_test_…`) into `.env.local` as `STRIPE_SECRET_KEY`. That is the
  whole blocking manual step — everything below it the agent does with that key.
- [ ] **Greg (dashboard-only, optional now)**: Settings → Customer emails — turn on email
  receipts for successful payments and notifications for failed ones.
- [ ] Agent: install the Stripe CLI on this box (binary from GitHub releases; `--api-key` mode,
  no interactive login needed).
- [ ] Agent, via API: create product "Spideryarn Reader" + $10/mo recurring price; create the
  Customer Portal configuration (invoice history on, payment-method update on, cancellation at
  period end); record the price id as `STRIPE_PRICE_READER`.
- [ ] Add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_READER` to `.env.example`,
  the deployment.md env table, and the `/api/health` env-name report.
- [ ] `npm install --save-exact stripe`; a `src/billing/stripe.ts` that constructs the client and
  pins the API version.
- [ ] Verify locally with Stripe CLI:
  `stripe listen --api-key sk_test_… --forward-to localhost:PORT/api/webhooks/stripe`
  (this mints the local `whsec_…`).

**Go-live (later, when we ship this)**:

- [ ] **Greg (manual)**: activate live mode — business verification and a bank account for
  payouts; Stripe requires this of the account holder.
- [ ] **Greg (manual)**: set live `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_READER` in Vercel env (production) — no Vercel credential exists on this box.
- [ ] Agent, via API with the live key: recreate product/price/portal config; create the
  production webhook endpoint pointing at `https://<prod-host>/api/webhooks/stripe` subscribed to
  the four events; hand Greg the signing secret for the Vercel env step above.

### Stage: Schema + sync function + webhook route

- [ ] Resolve **how article deletion works today** (hard delete vs archive). If articles can be
  hard-deleted, add an append-only `ingest_events` ledger (owner_id, article slug, created_at)
  written on successful ingest; if deletion is soft, count `articles` rows including archived.
  Quota must count what was ingested, not what survives.
- [ ] Tests first: sync function writes/updates a subscription row from a mocked Stripe response;
  webhook route rejects a bad signature; replayed event is a no-op.
- [ ] Drizzle migration: `subscriptions` table keyed on `owner_id` — `stripe_customer_id`,
  `stripe_subscription_id`, `price_id`, `status`, `current_period_start`, `current_period_end`,
  `cancel_at_period_end`, timestamps.
- [ ] `syncSubscriptionFromStripe(customerId)` in `src/billing/`.
- [ ] `POST /api/webhooks/stripe`: new pre-auth namespace beside the `isPublicNamespace` dispatch
  in `src/routes.ts` — signature verification over the raw body stands in for auth; extracts the
  customer id whatever the event type; calls the sync function; returns 200 fast.
- [ ] `npm test`, `npm run typecheck`.

### Stage: Quota enforcement at the ingest choke point

- [ ] Tests first: free owner blocked on 4th ingest; paid owner blocked on 101st within a period;
  step re-run on an existing article never counts or blocks; admin owner never blocked; blocked
  response carries the machine-readable reason + upgrade/reset info.
- [ ] `entitlementFor(ownerId)` → `{ tier, limit, periodStart?, periodEnd? }` from the
  subscriptions row + a hardcoded `TIERS` map keyed by price id.
- [ ] Enforce in `POST /api/jobs` for **new-ingest shapes only** (`url` / `uploadId` present); a
  small acknowledged race between concurrent enqueues is acceptable at alpha scale.
- [ ] Reader-facing refusal copy per [copy.md](../project/copy.md).
- [ ] `npm test`, `npm run typecheck`.

### Stage: Checkout, portal, and the reader-facing UI

- [ ] `POST /api/billing/checkout` (creates Checkout Session, `client_reference_id` = owner uuid)
  and `POST /api/billing/portal` (Portal session) as ordinary authenticated routes.
- [ ] Success-page return path calls the sync function directly (don't wait for the webhook).
- [ ] `/profile`: current plan, usage this period ("N of 100"), Upgrade / Manage-billing buttons.
- [ ] The at-quota refusal in the ingest UI surfaces the upgrade path.
- [ ] Confirm the API-created Portal configuration covers the full self-serve set: invoice/billing
  history, payment-method update, cancel at period end (plan switching arrives with a second
  tier).
- [ ] Browser check via a Sonnet subagent ([browser-control.md](../project/browser-control.md)):
  free account hits the wall at 3, checkout round-trip in test mode with card `4242…`, portal
  round-trip, cancelled sub reverts to free limits without touching existing articles.
- [ ] Stop & review with Greg.

### Stage: Admin visibility + docs

- [ ] `/admin/users`: plan, status, ingests this period — one field on `AdminUser`, one column,
  one per-owner statement in `pg-admin.ts`.
- [ ] New evergreen doc `docs/project/billing.md` (owner: proposed under
  [security-map.md](../project/security-map.md), beside admin.md, since its core concern is an
  unauthenticated webhook and entitlement enforcement — **confirm owner with Greg**); update
  auth.md / deployment.md / architecture.md cross-links; `tests/doc-links.test.ts` green.
- [ ] Final health check: `npm test`, `npm run typecheck`, `npm run check`, lint on touched files.
- [ ] Test consolidation pass (subagent).

### Stage: External critique (required, before building)

- [ ] Commit this doc (pre-critique version).
- [ ] GPT Sol review via `scripts/run-codex.ts` (prompt + answer files share this doc's letter);
  verify a verdict actually arrived (exit code *and* non-empty answer file).
- [ ] Fold surviving findings back in here; take new questions to Greg; commit the revision.
- [ ] After implementation: second Sol review of the code diff — weighted higher than this one.

## Appendix

### Research summary (2026-09-02, web + repo exploration by subagents)

- Hosted Checkout + Customer Portal is where current (2025–26) solo-dev guidance converges;
  embedded Checkout/Elements buys only a non-redirect UX at real integration cost.
- The canonical failure mode is event-payload-driven webhook handlers ("split brain" when events
  arrive out of order); the fetch-fresh-and-overwrite sync function collapses ~250 event shapes
  into one idempotent code path.
- Webhook must see the **raw** body (signature verification) and run on the Node runtime — both
  already true of our single Vercel function (`NODEJS_HELPERS=0`).
- Stripe CLI test loop: `stripe listen --forward-to …` + `stripe trigger checkout.session.completed`;
  the CLI's `whsec_…` is distinct from the dashboard one used in prod.
- Repo has **zero** existing payments code; nearest neighbours are the `ai_calls` per-owner spend
  ledger and the per-owner counting in `pg-admin.ts`.

### Deferred / out of scope

- Second paid tier; annual pricing; Stripe Tax / VAT registration; gating chat/comments/quiz/
  search spend (waits for cost-tracking); overage or grace bands; metered billing; Entitlements
  API; hosting a pricing/marketing page beyond what `/profile` needs.
