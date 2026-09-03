# Billing

Parent: [security-map.md](security-map.md), beside [auth.md](auth.md) and [admin.md](admin.md) —
the same family of questions. Who are you, what may you do, and what stops somebody who is not
asking politely. The build is
[260902i](../plans/260902i-stripe-payments-and-subscription-tiers.md).

**Status: the quota is live and so is the paying — bar the button.** Tiers are database rows as of
2026-09-02; a job's ending settles its slot at all seven places a job can end and adding an article
takes one, so a free account is held to three lifetime ingests. As of 2026-09-03 there are checkout,
portal and confirm routes, and the **whole round trip has been run for real** in Stripe test mode:
card `4242…` through hosted Checkout → signed webhook → `syncSubscriptionFromStripe` (which had
never executed until then) → an `active` row with the period Stripe reported → the same account
admitting a fourth ingest where a free one is refused, and refusing the twenty-first with Stripe's
own renewal date on it.

What is still missing is the **surface**: `/profile` has no Upgrade or Manage-billing button, so a
reader cannot reach any of it without a `curl`. What is not built is marked *not built* below rather
than described in the present tense.

## What we sell, and the one promise

| | ingests | USD | GBP | EUR |
|---|---|---|---|---|
| **Free** | 3, lifetime | — | — | — |
| **Reader** | 20 / month | $10 | £8 | €9 |
| **Researcher** | 150 / month | $50 | £40 | €45 |

These live in the **`billing_tiers` table**, not in code — see
[Adding a tier or a currency](#adding-a-tier-or-a-currency). They are repeated here because a row
is something a person can change, and a document that only says "look at the database" is no use to
somebody deciding whether to.

**The quotas moved on 2026-09-02, and the reason is worth keeping.** Reader started at 100 ingests
for $10 because nobody had measured what an ingest costs. When measurement came back saying a full
article can cost around **£1**, that was not finger-in-the-air optimism — it was an invitation to
lose £90 a month per user. Reader dropped to 20. Greg, 2026-09-02:

> it can cost £1 to fully process an article, so let's say that the $10 plan gets you 20 articles
> (which we can always increase later)

**Raising a quota is one `UPDATE`** — no deploy, no Stripe object, no migration. That asymmetry is
deliberate and worth preserving: we can be generous later cheaply, and being generous now is the
expensive mistake to unwind.

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
properties `tests/billing-tiers.test.ts` pins against the real rows: every active tier is priced in
every currency any tier offers, and the amounts are whole units — the prosumer-tool convention
(Linear, Copilot, Notion) rather than the `.99` of consumer subscriptions. The seeded numbers also
keep a 5× ratio between tiers in every currency, so the pricing page tells one story everywhere.

## Adding a tier or a currency

**Tiers are rows, not code.** `billing_tiers` and `billing_tier_prices` are the source of truth,
and Stripe follows them. Greg, 2026-09-02:

> instead of adding them as environment variables, could we add them to the database, so that it's
> easier to modify (e.g. for agents, in UI, etc)

So there is no `STRIPE_PRICE_*` environment variable and nothing to paste onto three machines.

**Raise a quota** — one `UPDATE`, no deploy, no Stripe call, no migration:

```sql
update spideryarn.billing_tiers set ingests_per_period = 50 where id = 'reader';
```

Live within thirty seconds (`src/store/pg-tiers.ts` caches the table for that long).

**Add a currency** — insert a price row, then run the script:

```sql
insert into spideryarn.billing_tier_prices (tier_id, currency, unit_amount)
values ('reader', 'cad', 1400), ('researcher', 'cad', 7000);
```

**Add a tier** — insert the tier and its prices, then run the script:

```sql
insert into spideryarn.billing_tiers
  (id, product_name, description, ingests_per_period, lookup_key, sort_order)
values ('scholar', 'Spideryarn Scholar', '500 articles a month.', 500,
        'spideryarn_scholar_monthly', 30);
```

Then, for either:

```bash
npx tsx scripts/stripe-setup.ts            # says what it would do
npx tsx scripts/stripe-setup.ts --apply    # creates the Stripe objects, writes the id back
```

**Changing an amount works the same way** — edit the row, run the script. Stripe prices are
immutable, so it creates a *new* price and moves the lookup key onto it with
`transfer_lookup_key`. The old price stays alive and unarchived, so **anyone already subscribed
keeps billing at the price they were sold**; moving them is a separate, deliberate act.

### What holds these rows to account

The invariants used to be TypeScript — a union of tier names, constants, and tests over them. Rows
have no compiler, so they moved into the schema, where they hold for every writer including a
hand-typed `UPDATE` at midnight:

| | |
|---|---|
| `billing_tiers_ingests_positive` | a tier that allows nothing is not a tier, and a negative one puts every account instantly over its limit |
| `billing_tiers_id_format` | the id reaches logs and URLs, so lower-case and no spaces |
| `billing_tiers_lookup_key`, `billing_tiers_price_id` | unique. Two tiers sharing either would make `price → tier` ambiguous, and that lookup is what entitlement is decided by |
| `billing_tier_prices_amount_positive` | free is the absence of a subscription, not a zero-priced one |
| `billing_tier_prices_currency_format` | three lower-case letters, because `USD` would be accepted here and rejected by Stripe one script-run later |
| FK with `on delete cascade` | deleting a tier takes its prices; nothing is orphaned |

Two things a CHECK cannot say live in `tests/billing-tiers.test.ts` against the **real rows**: that
a dearer tier allows more ingests (a statement about pairs of rows), and that every active tier is
priced in every currency any tier offers — because a missing `currency_options` entry does not fail,
it silently shows somebody the base-currency price.

### Three things that are easy to get wrong

- **`active`, not `DELETE`.** Retiring a tier is a flag. Deleting the row of a tier somebody is
  subscribed to orphans their entitlement, and `tierForPrice` deliberately still matches an
  inactive tier so existing subscribers keep their allowance until they cancel.
- **`db:reset` reverts the seeded rows.** The two launch tiers are seeded by
  `drizzle/20260902181004_seed_billing_tiers.sql`, so a reset puts the original numbers back. That
  is inherent to seeding configuration in a migration, and it is why the numbers are also written
  down at the top of this document.
- **The lookup key is the identity, not the name.** Never change one on a tier that has been sold:
  it is how a re-run finds the price it made last time instead of minting a second one.

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
Every refusal message in [`src/messages.ts`](../../src/messages.ts) (`pay-free`, `pay-limit`,
`pay-lapsed`) ends by saying so, because it is the thing a reader will actually be worried about.

**A lapsed subscriber is blocked, and the third sentence exists so it does not read as a bug.** The
free count is lifetime and *includes paid months*, so somebody who took forty articles on Reader and
cancelled is past the free allowance permanently. Greg chose that on 2026-09-03 over tier-scoping
the count or granting a fresh allowance on cancel — one rule, no new state, and nothing to farm by
subscribing and cancelling. But "you have added all 3 articles a free account can add", to somebody
looking at forty of them, reads as arithmetic going wrong, so `pay-lapsed` names the ended plan and
resubscribing instead. It is chosen from the **billing row** — a subscription id beside a status the
allowlist does not entitle — and not from `used > limit`, which is the same answer most of the time
and a wrong one the day somebody lowers a tier's `ingests_per_period`.

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

### Which requests spend a slot, and why the wall is at the routes

[`src/billing/admission.ts`](../../src/billing/admission.ts) holds the decision, and it lives at the
routes rather than inside `enqueue()` — which is the tempting single choke point and the wrong one.
`enqueue()` also serves **step re-runs on an article already on the shelf**, and by the time a
request reaches it a re-run's job carries a URL too, filled in from the article's own metadata. Only
the route still knows what was asked for.

| | |
|---|---|
| `POST /api/jobs {url}` | reserves |
| `POST /api/jobs {uploadId}` | reserves |
| `POST /api/jobs/:id/retry`, when the old job carried a slot | reserves a **fresh** one |
| `POST /api/jobs {slug, steps}` — a glossary, ideas, a quiz | free |
| `POST /api/jobs/:id/retry` of a re-run | free |
| `POST /api/uploads` | asks, reserves nothing — refuses at the door so nobody transfers 11 MB to be told no |

**Retry is a second front door.** It never passes through the `POST /api/jobs` handler — straight to
`retryJob` → `enqueue()` — so a check bolted onto that handler alone leaves a failed ingest
retryable free, for ever. And it must ask `jobs.ingest_event_id` rather than `Job.url`, because a
re-run recovers a URL too; that column is the only place the answer is written down.

**Every path that reserves and produces no job gives the slot back**, and `withIngestSlot` does it
by releasing on *every* path rather than by enumerating them: `releaseReservation`'s
`not exists (select 1 from jobs where ingest_event_id = …)` is exactly the question — *did a job end
up spending this?* — and it asks it of committed rows rather than of our idea of what happened. The
enumerating version would have to be right about `enqueue`'s four outcomes and about a throw over an
INSERT that committed and lost its reply.

**The administrator is exempt, and takes no slot at all** — `isAdmin()`
([`src/admin.ts`](../../src/admin.ts)), a comparison against two hardcoded uuids, so nothing a
request carries can put anybody else in the list. Without it Greg is held to three lifetime articles
on his own production instance, and comp subscriptions — the eventual mechanism — are a post-go-live
stage. Nothing is reserved rather than reserved-and-forgiven, so an admin's jobs carry a null
`ingest_event_id` like any re-run: **their ingests are legitimately absent from `ingest_events`**,
which is worth knowing before reading that table as a record of everything ever added.

**Known and accepted:** with one slot left, a double-click on Add reserves twice and the second is
refused before deduplication would have collapsed it onto the first job. Fixing that means inserting
the job before reserving, which is the bypass.

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
- **Releasing a slot from `/cancel`, outside the transition that ends the job.** A Stop during the
  last step may still finish as `done`. A release from outside loses the race, and the publication
  then finds the reservation released and charges nothing. Every settlement rides the statement
  that ends the job — see below.

### A job ends at seven sites, and every one of them settles

The plan first said "both branches of `settleIn`", which undercounts by five:

| | |
|---|---|
| `settleIn`, `done` | **charged** |
| `settleIn`, `error` / `cancelled` | released |
| `settleIn`'s **release** that resolves to a cancellation — a Stop landed while the step ran, so `releaseStepIn` ended the job instead of queueing it. Inside `settleIn`, and not one of "both branches" | released |
| `settleExpired` — the reader closed the tab and the lease lapsed | released |
| `requestCancel`'s terminal branch — Stop on a queued job, or one whose claimant is provably gone | released |
| `pgJobStore.finish` — the store's own ending | released |
| `pgJobStore.releaseStep`, when its own `case when cancelling` ends the job | released |

The first three are [`src/store/pg-session.ts`](../../src/store/pg-session.ts); the last four are
[`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts), and each of those had to grow a transaction,
because a bare `UPDATE` cannot carry a settlement with it. Miss `settleExpired` or `requestCancel`
and pressing **Stop** costs a slot for ever.

**The last two have no caller in `src/`** and were missing until GPT Sol counted the paths
(2026-09-03). That made them a trap rather than a leak — but they are the advertised `JobStore` API,
and `forget`/`trimFinished` delete terminal jobs, so a job ended through either of them and then
forgotten leaves a reservation `in_flight` for ever with nothing left to say what it was spent on.
They **release even for a `done`**, because that path moves the job row and publishes nothing: the
only transition entitled to charge is the one that publishes in the same transaction.

**The charge is strict and the releases are tolerant**, which is the one asymmetry to remember. A
charge that matches no row throws and takes the publication back with it — publishing without
charging is a free ingest, charging without publishing is a debit for an article nobody got. A
release that matches no row is logged: a thrown ledger anomaly inside `requestCancel` turns the
reader's Stop button into a 500.

**Tolerant is not silent, and it used to be.** A release finds no row for four different reasons and
only one of them is fine. *Already released* is ordinary and idempotent — debug, or nothing. *Already
succeeded* is a contradiction: the job ended other than successfully and the slot is charged anyway,
so somebody has been billed for an article they did not get. *The row is gone* means the ledger has
lost a row a foreign key should have held. Both of those are **`error`-level**, with the ids, and
neither throws. Until 2026-09-03 all four logged the same sentence at `warn`, and a test asserted
that the charge silently survived — GPT Sol, finding 3.

**A cancel racing a final publication settles exactly once**, and it is the job fence that does it,
not the tolerance. The loser never reaches settlement: a `requestCancel` that lost matches no
`ACTIVE` row and returns before it would settle, and a claimant that lost raises `StaleAttemptError`
out of `finishIn`, above its own settlement. An earlier version of this paragraph said the loser's
settlement "rolls back with the transition that lost", which was a plausible sentence about
something that never happens — GPT Sol, 2026-09-03.

That pair is not a race at all, in fact: which of them ends the job is decided by the **lease**
rather than by arrival order, so there is nothing for two connections to contend over. The
contentions that really are order-decided are two writers that can *both* end the job — two Stops on
one queued job, and two `finish` calls on one live claim — and `tests/billing-settlement.test.ts`
holds each of those with a third connection holding the job row while both queue behind it, then
asserting that neither has answered before it lets go. A Stop against the **expiry sweep** is the
third such pair and is deliberately not tested that way: `advanceJobWith` sweeps *unscoped*, so any
dev server on the same database joins the race as a writer nobody asked for.
`releaseReservation`'s own doc comment carries the one interleaving that is unreachable and why:
only the request that reserved may release, and only after its enqueue has returned.

`tests/billing-settlement.test.ts` holds all of it, against a real database.

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

`STRIPE_SECRET_KEY` travels on the `gjd-remote push-env` allowlist. There is no price variable to
carry: the ids are rows.
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

## The three billing routes

All three are POSTs behind the gate, at exact paths, and all three live in
[`src/billing/checkout.ts`](../../src/billing/checkout.ts) rather than in `src/routes.ts` — the
order of operations below is the guarantee, and it is worth being readable in one place.

| | |
|---|---|
| `POST /api/billing/checkout` `{ tierId, currency? }` | a hosted Checkout Session, or the Portal if they already have a subscription |
| `POST /api/billing/portal` | a hosted Portal session — invoices, card, cancellation |
| `POST /api/billing/confirm` `{ sessionId }` | the return path: prove the session is theirs, then sync |

**POST rather than GET even for the two that only ask Stripe a question**, because all three
*create* a Stripe object and a GET is something a browser prefetches, a crawler follows and a cache
keeps.

### The customer→owner mapping must exist before the Session does

The webhook finds an owner by `billing_accounts.stripe_customer_id` and answers 503 when it cannot.
So a Checkout Session capable of taking money must never exist before that row is committed —
otherwise somebody pays and gets nothing until Stripe stops retrying, about three days later. The
browser's return to `/profile` cannot close that window: a redirect is not a delivery guarantee, and
the reader may close the tab. Hence, in this order:

1. the owner, from the gate — never from the request body;
2. `insert billing_accounts (owner_id) on conflict do nothing`, the same anchor admission uses;
3. read it back. An existing customer is reused; a subscription that is **not over** redirects to
   the Portal rather than selling a second one;
4. `customers.create`, then `update … set stripe_customer_id = $cus where owner_id = $owner and
   stripe_customer_id is null`. **Zero rows means a concurrent request won**: re-read, use the
   winner's customer, abandon ours;
5. *only now* `checkout.sessions.create({ customer, client_reference_id, … })`.

**`customer` is always passed explicitly.** Letting Checkout's `customer_creation` mint one produces
a customer that is unmapped by construction until a callback runs, which is the unreliable
return-path design step 1 exists to rule out.

**The conditional UPDATE is the whole concurrency story — there is no lock.** At `read committed` the
second statement blocks on the first's row lock, then re-evaluates its predicate against the
committed value and declines. The loser's Stripe customer is orphaned, which costs nothing and is
invisible; `stripe_customer_id` is unique, so two owners can never share one however the race goes.
Sol asked for serialisation here and Fable was right that it buys nothing *for the mapping*.

**What the race can still cost, stated rather than glossed:** nothing spans the subscription check
and `sessions.create`, so two concurrent requests can both see no subscription and both be handed a
payable Session — two subscriptions and two invoices if both are completed. That is a risk this plan
weighed and accepted (reusing an open Session needs stored session state and expiry handling). What
catches it afterwards is `chooseSubscription`'s multiple-live anomaly, which logs at `error` and
never picks quietly — **and that net has a hole**: it counts only *entitled* subscriptions as live,
so an `active` beside an `unpaid` is two real invoices and no anomaly reported. If it is ever
tightened, Stripe's own "limit customers to one subscription" Checkout setting is the cheapest first
move, and nothing here configures or checks it. GPT Sol, 2026-09-03.

### Over is a shorter list than unentitled

Checkout refuses while a **non-terminal** subscription exists, and `TERMINAL_STATUSES`
([`src/billing/tiers.ts`](../../src/billing/tiers.ts)) is `canceled` and `incomplete_expired` and
nothing else. That is a different question from entitlement: `past_due` and `unpaid` are *not*
entitled but are still subscriptions Stripe holds and may still collect on, so selling beside one
charges the reader twice. A status we have never heard of counts as not terminal — the cost of being
wrong that way is a reader sent to the Portal to look at what they have.

### Two things that are deliberately not cached, and one that is

`tierToSell` reads `readTiers()` — **uncached** — while admission reads the 30-second `allTiers()`.
The asymmetry is the point. A stale *quota* for half a minute is harmless; a stale *sale* is not,
because a Session minted from an old snapshot can sell a tier somebody has just retired or a price
they have just replaced, and a Checkout Session stays payable for about a day, after which the
subscription bills on the old price for as long as it lasts. `recordTierPrice` clears only the setup
script's own process, so a running web instance never hears about the change at all. Checkout happens
a handful of times a day; the extra pair of statements costs nothing. GPT Sol, 2026-09-03.

### What a failure at Stripe looks like

Three kinds, and flattening them was a real defect until 2026-09-03:

| | |
|---|---|
| unset key, wrong mode, or a `livemode` that disagrees | **503**, `pay-off` — this deployment cannot take money at all |
| a timeout, a rate limit, a 500 from Stripe | **502**, `pay-down` — the one `pay-` code that is `retry` |
| a bug in our own code | **500** with its stack, so it is reported |

Before that every Stripe SDK failure escaped untouched and the dispatcher put **Stripe's own
sentence** in the response beside a 500 — breaking [copy.md](copy.md)'s *never the provider's words*
and claiming our arithmetic was at fault when it was not. The confirm route had the mirror of it: it
answered *no such checkout session* to any retrieval failure, blaming the identifier for an outage.
Only a genuine 404 from Stripe means that now.

### What the browser may decide, and what it may not

The request names a **tier id**; `billing_tiers` says which Stripe price that sells. A price id from
the request is **refused rather than ignored** — accepting one would let anybody check out against
any price in the Stripe account, and silently dropping it would let them believe they had chosen.
The same for `customer` and any spelling of an owner id.

`/api/billing/confirm` takes only a Checkout Session id and proves it is this reader's before
syncing: `client_reference_id` **and** the session's customer must both match the mapping already
committed for the caller. Either alone would be enough for somebody who can influence the other.
Every refusal is the same 404 with the same words, so the reply cannot be used to ask *did that
person subscribe?*. It is a convenience, not the mechanism — the webhook is what makes a
subscription real.

### Where Stripe sends them back to

`billingReturnOrigin()` builds the URLs server-side and **never from a request header**: a `Host` an
attacker chooses would become the address a paying customer returns to. Production is decided first
and reads no variable, so nothing in the environment can redirect a real customer.
`SPIDERYARN_BASE_URL` is a local override for a worktree's dev server on 5274, 5275…
([worktrees.md](worktrees.md)).

## Not built yet

The `/profile` surface, the admin columns, comp subscriptions for journalists and QA, and go-live.
The wall now has a door in it — what is missing is the button on the page that opens it. The order
is in [the plan](../plans/260902i-stripe-payments-and-subscription-tiers.md#where-the-build-stands).

## Where the code is

| | |
|---|---|
| [`src/billing/stripe.ts`](../../src/billing/stripe.ts) | The only place a Stripe client is constructed. Mode guards, pinned API version. |
| [`src/billing/tiers.ts`](../../src/billing/tiers.ts) | What an entitlement *is*, which statuses are entitled, which price sells what. Pure — the tiers themselves are rows. |
| [`src/store/pg-tiers.ts`](../../src/store/pg-tiers.ts) | Reading `billing_tiers` and its prices, cached for thirty seconds because admission asks on every ingest. |
| [`src/billing/subscription.ts`](../../src/billing/subscription.ts) | Reading a Stripe subscription into the fields entitlement needs, and refusing everything unrecognised. Pure. |
| [`src/billing/webhook.ts`](../../src/billing/webhook.ts) | Verification. |
| [`src/billing/checkout.ts`](../../src/billing/checkout.ts) | The three billing routes: the order that makes the mapping durable, the Portal redirect, and the proof that a Checkout Session belongs to the reader asking about it. |
| [`src/store/pg-billing.ts`](../../src/store/pg-billing.ts) | Reserve, settle, count. The lock. |
| [`src/billing/admission.ts`](../../src/billing/admission.ts) | Which requests spend a slot, the refusal a reader sees, and the release. The only caller of `reserveIngest`. |
| [`src/store/pg-session.ts`](../../src/store/pg-session.ts) | Three of the seven sites a job ends at, and the only one that charges. |
| [`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts) | The other four — `settleExpired`, `requestCancel`, `finish` and `releaseStep` — plus the job INSERT that writes `ingest_event_id`. |
| [`src/db/schema.ts`](../../src/db/schema.ts) | `billing_tiers`, `billing_tier_prices`, `billing_accounts`, `ingest_events`, `jobs.ingest_event_id`. |
