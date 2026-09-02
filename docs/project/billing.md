# Billing

Parent: [security-map.md](security-map.md), beside [auth.md](auth.md) and [admin.md](admin.md) —
the same family of questions. Who are you, what may you do, and what stops somebody who is not
asking politely. The build is
[260902i](../plans/260902i-stripe-payments-and-subscription-tiers.md).

**Status: half built.** The Stripe side, the schema and the quota mechanism exist; the routes and
the reader-facing surface do not. What is not built is marked *not built* below rather than
described in the present tense.

## What we sell, and the one promise

| | ingests | USD | GBP | EUR |
|---|---|---|---|---|
| **Free** | 3, lifetime | — | — | — |
| **Reader** | 20 / month | $10 | £8 | €9 |
| **Researcher** | 150 / month | $50 | £40 | €45 |

The table in code is [`PAID_TIERS`](../../src/billing/tiers.ts), and it is the only place these
numbers live.

**The quotas moved on 2026-09-02, and the reason is worth keeping.** Reader started at 100 ingests
for $10 because nobody had measured what an ingest costs. When measurement came back saying a full
article can cost around **£1**, that was not finger-in-the-air optimism — it was an invitation to
lose £90 a month per user. Reader dropped to 20. Greg, 2026-09-02:

> it can cost £1 to fully process an article, so let's say that the $10 plan gets you 20 articles
> (which we can always increase later)

**Raising a quota is a one-line change** in `PAID_TIERS` — no Stripe object, no migration, no price
change. That asymmetry is deliberate and worth preserving: we can be generous later cheaply, and
being generous now is the expensive mistake to unwind.

### Why three currencies rather than one

A Stripe Price can carry several currencies (`currency_options`), and hosted Checkout picks by the
customer's location. We use it because the alternative costs real money:

**Stripe adds +2% whenever the price's currency differs from the account's settlement currency**,
and it is triggered by the *price*, not by the customer. The account is GB and settles in GBP, so a
USD-only price would have charged that 2% on **every** sale — including UK customers, who would
otherwise sit in Stripe's cheapest band (1.5% + 20p, so 3.5% + 20p instead). On top of that a UK
customer paying in USD often meets their own bank's foreign-transaction fee, ~2.75–3% on many
mainstream cards, which is invisible to us and a known conversion-killer.

**The amounts are chosen, never converted at run time.** A customer seeing €8.62 knows they are
being shown somebody else's price. They were set at roughly GBP/USD 1.35 and EUR/USD 1.16, rounded
up to whole units, which lands each about 4–8% above spot — headroom on purpose, because a price
set at spot goes underwater the moment the rate moves and **Stripe prices cannot be edited**. Two
properties `tests/billing-tiers.test.ts` pins: the ratio between tiers is **5× in every currency**,
so the pricing page tells one story everywhere; and the amounts are whole units, which is the
prosumer-tool convention (Linear, Copilot, Notion) rather than the `.99` of consumer subscriptions.

## Adding a tier or a currency

Both are one edit to [`PAID_TIERS`](../../src/billing/tiers.ts) and a re-run of the setup script.
The list is walked rather than hardcoded, so nothing else has a tier's name in it.

**A new currency** — add it to `CURRENCIES`, add an amount to every tier's `amounts`, run
`npx tsx scripts/stripe-setup.ts` (dry run) then `--apply`. The script sees the live price lacks the
currency, creates a **new** price, and moves the lookup key onto it with `transfer_lookup_key`.
Paste the new ids into `.env.local`.

**A new tier** — add an entry with a fresh `id`, `lookupKey` and `envVar`, then:

1. `npx tsx scripts/stripe-setup.ts --apply`, and paste the new `STRIPE_PRICE_…` into `.env.local`.
2. Add that variable name to `.env.example`, to `ALLOWLIST` in
   [`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts), and to the env table in
   [deployment.md](deployment.md#environment-variables).
3. At go-live, create it in live mode and set the variable in Vercel.

`tests/billing-tiers.test.ts` will fail if you miss a currency, reuse a lookup key or an
environment variable, or make a dearer tier that allows fewer ingests.

### The three things that make this safe to change

- **Existing subscribers are never moved.** A replaced price stays alive and unarchived, so anyone
  already billing on it keeps their terms. Migrating them is a separate, visible decision — not a
  side effect of running a setup script.
- **The lookup key is the identity, not the name.** Never change one. It is how a re-run finds what
  it made last time instead of minting a second price that nobody notices until two customers are
  on different ones.
- **An unrecognised price falls to the free tier**, logged. So a price you created and forgot to
  configure costs a customer an email, not us a hundred ingests a month.

### VAT, flagged rather than resolved

Worth a look before EU revenue is real, and **not** the "we're below the threshold" situation we
assumed: the €10,000 distance-selling threshold applies to businesses established *in* the EU. For
a UK seller after Brexit, VAT on B2C digital services to EU consumers is in principle due from the
first sale, via the Non-Union OSS scheme. Not a blocker for launching, and not a reason to choose a
different EUR number — but it is a conversation with an accountant rather than an assumption.

**Reading is never gated, and this is the promise the copy makes out loud.** Greg, 2026-09-02:

> if a user has hit their quota, they should still be able to read their existing and
> Public-readable articles, just not incur extra spend.

So the quota sits on the one action that spends money — adding something new — and nowhere else.
Every refusal message in [`src/messages.ts`](../../src/messages.ts) (`pay-free`, `pay-limit`) ends
by saying so, because it is the thing a reader will actually be worried about.

## We never touch a card

Hosted Stripe Checkout and the hosted Customer Portal, both of which are redirects. Billing
history, receipts, payment-method changes and cancellation are all the Portal's job. We store
opaque Stripe ids and nothing else, which keeps us in Stripe's lightest PCI scope (SAQ-A), and the
entire custom billing UI is two buttons. Greg, 2026-09-02:

> we don't want to process/touch/store sensitive info like card details.

The corollary worth knowing: **there is no "our billing page" to build**, and proposals to build
one should be read as proposals to take on card-adjacent risk we have deliberately declined.

## The quota, and the one thing it has to survive

A slot is **one successful new ingest** — a URL added, or a PDF uploaded. Re-running a pipeline
step on an article you already have is free. A failed ingest is free. Deleting an article does not
give the slot back.

It is an **abuse boundary against model spend**, not an invoice. Nothing is derived from it and it
reconciles against nothing; the subscription is a fixed charge. (Cost attribution lives in
`ai_calls` — [database.md](database.md) — and the two ledgers are deliberately separate.)

The thing it has to survive is a script firing twenty concurrent `POST /api/jobs` at a free
account. A plain "count, then decide" cannot: twenty requests all read zero and all pass. So:

1. Admission takes `select … for update` on the owner's `billing_accounts` row.
2. **The row is created before it is locked** — `insert … on conflict do nothing` first. A free
   reader has no billing row, and
   [a `FOR UPDATE` that matches nothing locks nothing](../postmortems/260901f-a-for-update-that-locks-nothing.md),
   so locking a row that might not exist would serialise nobody *in exactly the case the boundary
   is for*. This is the single most important line in
   [`src/store/pg-billing.ts`](../../src/store/pg-billing.ts).
3. Usage is successes in the period **plus every unsettled reservation**, so a second request sees
   the first whether or not it has reached `enqueue()` yet.
4. The reservation is written under the lock; `enqueue()` is called **outside** it. Holding a
   transaction open while `enqueue()` takes a second pooled connection deadlocks at
   `DATABASE_POOL_MAX`, which is 5.

**Nothing that opens its own transaction, and nothing that touches the network, may be called
between the lock and the commit.** That is the rule a later change is most likely to break.

### Three things that look like improvements and are not

- **Expiring an unsettled reservation.** An earlier draft gave them six hours. That is a bypass,
  not a safety valve: hold 100 jobs queued for six hours, reserve 100 more, and 200 succeed in one
  period — repeatable, and easier the more contended the queue is, because contention is what ages
  it. A leaked slot is a support conversation; the bypass is unbounded spend. Any expiry rule has
  to prove the reservation never produced a job, and `jobs.ingest_event_id` is what would make
  that a query rather than a guess.
- **Linking the job to the reservation after `enqueue()` returns.** Broken three ways: a job that
  publishes before the update lands is never charged (an all-cached job finishes in milliseconds);
  a crash in the gap leaves a runnable job nobody paid for; and two duplicate Adds that
  `enqueueOrGet` deduplicates into one job point two reservations at it. The link goes the other
  way and rides the job's own INSERT, which is atomic without needing a transaction.
- **Releasing a slot from `/cancel`.** A Stop during the last step may still finish as `done`. A
  release from outside that transition loses the race, and the publication then finds the
  reservation released and charges nothing. Success and release both live in the transaction that
  ends the job — [`src/store/pg-session.ts`](../../src/store/pg-session.ts) `settleIn`.

### Known limit

A failure releases its slot, so somebody who can reliably make expensive ingests *fail* can repeat
for ever. True of every design considered, because the quota counts successes and that is the
product rule. The answer when it matters is a daily attempt cap, not a change to any of the above.

## Billing is a Postgres feature

Quota is enforced under `SPIDERYARN_STORE=postgres` and not otherwise. Settlement joins the
Postgres publish transaction, which has no filesystem counterpart, and writing a second
filesystem ledger would be two implementations of one count.

**This cannot leak into production**: [`src/store/index.ts`](../../src/store/index.ts) throws at
*import* when a filesystem store is live there, so the app fails to start rather than serving
unmetered ingests. Locally it is visible — `/api/health` warns about a non-Postgres store.

## Test and live must never cross

A production deployment on `sk_test_…` would take card `4242…`, write `active` subscription rows
and grant real quota for money that does not exist — while every "is the variable set" check
stayed green. That is [silent-success.md](../reusable/silent-success.md) exactly, so it is
refused in three places, all keyed on the credential's own prefix rather than on a variable name:

| | |
|---|---|
| [`src/billing/stripe.ts`](../../src/billing/stripe.ts) | The client refuses to be constructed at all. Also asserts `livemode` on every object retrieved, because a webhook endpoint pointed at the wrong deployment is the one way a live event reaches a test one. |
| [`src/vercel-health.ts`](../../src/vercel-health.ts) | `/api/health` warns. Stripe is the first entry there where *absence* is fine and *presence of the wrong thing* is catastrophic, which is why a `valid` clause is now checked whether or not a `breaks` clause is set. |
| [`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts) | A live key never reaches the shared dev box, under any variable name. |

`STRIPE_API_VERSION` is pinned to the version the installed SDK's own types were generated from —
the only version whose types are not lying. Bumping the `stripe` package means bumping that line
and re-reading the changelog; `tests/billing-stripe.test.ts` fails if they drift apart. This is
not ceremony: Stripe's Basil release (2025-03-31) **moved the billing period off the Subscription
onto its items**, and code written against the old shape does not crash — it reads `undefined`,
stores an absent period, and meters against it.

## Setting it up

```bash
npx tsx scripts/stripe-setup.ts            # say what it would do
npx tsx scripts/stripe-setup.ts --apply    # do it
```

Idempotent by `lookup_key`, not by product name — a name is a label a human may edit, and matching
on one is how you end up with two $10 prices and two cohorts of customers on different ones. It
**refuses** to adopt a lookup key pointing at a different amount, because Stripe prices are
immutable and "change the price" is really "create a price and move the variable".

`STRIPE_SECRET_KEY` and `STRIPE_PRICE_READER` travel on the `gjd-remote push-env` allowlist.
`STRIPE_WEBHOOK_SECRET` deliberately does not: locally it is minted per machine by
`stripe listen`, so one machine's value is wrong on another's.

Greg's manual surface is the account, the keys, and the few dashboard-only settings — customer
email receipts, dispute auto-cancellation, the dunning schedule, and live-mode activation.
Everything else is the script.

## The webhook

`POST /api/webhooks/stripe`, an **exact** pre-auth path — not a namespace, so sibling paths stay
unavailable. It is the one route nobody is signed in to and the one that grants entitlement, so
[`src/billing/webhook.ts`](../../src/billing/webhook.ts) fails closed everywhere:

- The **raw bytes** are verified before anything parses them. A parsed-and-re-encoded body is a
  different byte string and its signature will not match, which is why `readBody` in
  [`src/routes.ts`](../../src/routes.ts) — which always parses — cannot be reused here.
- **An unset signing secret refuses every delivery.** The tempting alternative, skipping
  verification when unconfigured "for local development", turns one missing environment variable
  in production into an endpoint that grants subscriptions to anyone who can POST JSON.
- `currentOwnerId()` is **never** called; there is no request owner in webhook scope. The
  customer→owner mapping in the database is authoritative, and metadata on the Stripe object is
  recovery data, never a source of truth.
- Four event types are acted on, and all four do the same thing: **resync from Stripe**. Payloads
  are never trusted for state, because events arrive out of order and a handler that applies each
  payload's contents builds a picture no single event described.

Tests sign payloads offline with the SDK's own signer, and `api.stripe.com` is refused by
[`tests/setup/provider-guard.ts`](../../tests/setup/provider-guard.ts) so no test can reach Stripe
for real with the key sitting in `.env.local`.

## Not built yet

Admission wired into `POST /api/jobs`; settlement wired into `settleIn`; `syncSubscriptionFromStripe`
and the webhook route itself; `POST /api/billing/checkout` and `/portal`; the `/profile` surface;
admin columns; comp subscriptions for journalists and QA; go-live. The order is in
[the plan](../plans/260902i-stripe-payments-and-subscription-tiers.md#where-the-build-stands).

## Where the code is

| | |
|---|---|
| [`src/billing/stripe.ts`](../../src/billing/stripe.ts) | The only place a Stripe client is constructed. Mode guards, pinned API version. |
| [`src/billing/tiers.ts`](../../src/billing/tiers.ts) | What each tier allows, which statuses are entitled, which price sells what. Pure. |
| [`src/billing/subscription.ts`](../../src/billing/subscription.ts) | Reading a Stripe subscription into the fields entitlement needs, and refusing everything unrecognised. Pure. |
| [`src/billing/webhook.ts`](../../src/billing/webhook.ts) | Verification. |
| [`src/store/pg-billing.ts`](../../src/store/pg-billing.ts) | Reserve, settle, count. The lock. |
| [`src/db/schema.ts`](../../src/db/schema.ts) | `billing_accounts`, `ingest_events`, `jobs.ingest_event_id`. |
