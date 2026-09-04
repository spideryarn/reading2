# Billing

Parent: [security-map.md](security-map.md), beside [auth.md](auth.md) and [admin.md](admin.md) —
the same family of questions. Who are you, what may you do, and what stops somebody who is not
asking politely. The build is
[260902i](../plans/260902i-stripe-payments-and-subscription-tiers.md).

**Status: live, and it has taken real money.** Tiers are database rows as of
2026-09-02; a job's ending settles its slot at all seven places a job can end and adding an article
takes one, so a free account is held to three lifetime ingests. As of 2026-09-03 there are checkout,
portal and confirm routes, and the **whole round trip has been run for real** in Stripe test mode:
card `4242…` through hosted Checkout → signed webhook → `syncSubscriptionFromStripe` (which had
never executed until then) → an `active` row with the period Stripe reported → the same account
admitting a fourth ingest where a free one is refused, and refusing the twenty-first with Stripe's
own renewal date on it.

**The first live sale happened the same day** — see
[The first live sale](#the-first-live-sale-and-the-four-things-it-measured), which is where the
facts that only a real purchase can establish are written down.

The **reader-facing surface** landed the same day — see [What a reader sees](#what-a-reader-sees).
What is not built is marked *not built* below rather than described in the present tense.

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

**Measured since, and the estimate holds**: an ingest is $0.03–$0.39 depending on length, and an
article with every mode generated is $0.35–$1.55 —
[cost-per-article-2026-09-03.md](../../evals/results/cost-per-article-2026-09-03.md), which also
says which parts of that are the expensive ones.

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
values ('scholar', 'Spideryarn Scholar', 'For people who read for a living.', 500,
        'spideryarn_scholar_monthly', 30);
```

**A description must not restate the allowance.** `/profile` renders `ingests_per_period`
structurally and puts the description beside it, so a description that opens by repeating the number
is a second copy the one-`UPDATE` quota change above does not touch — raise the quota to 50 and the
sentence goes on saying 20. The two seeded rows did repeat it, which read on screen as *"20 articles
a month. 20 articles a month. Reading what you have already added is always free."* until a browser
run caught it on 2026-09-03; `drizzle/20260903090000_…` took the first sentence back out.

Then, for either:

```bash
npm run stripe:setup                     # says what it would do
npm run stripe:setup -- --apply          # creates the Stripe objects, writes the id back
```

**Changing an amount works the same way** — edit the row, run the script. Stripe prices are
immutable, so it creates a *new* price and moves the lookup key onto it with
`transfer_lookup_key`. The old price stays alive and unarchived, so anyone already subscribed
keeps billing at the price they were sold; moving them is a separate, deliberate act.

> [!WARNING]
> **They keep billing and lose their allowance. Do not change a price with live subscribers until
> this is fixed.**
>
> `tierForPrice` ([`src/billing/tiers.ts`](../../src/billing/tiers.ts)) matches a subscription's
> price against `billing_tiers.stripe_price_id`, of which there is exactly one per tier — the
> *current* one. A grandfathered subscriber is therefore on a price no tier sells, and
> `entitlementFromRow` ([`src/store/pg-billing.ts`](../../src/store/pg-billing.ts)) fails towards
> free, as it should when it cannot recognise a price. So they go on paying and drop to three
> lifetime ingests. It logs a warning nobody is reading and tells the reader nothing.
>
> Demonstrated on 2026-09-03 rather than reasoned about: after the VAT fix below replaced both
> prices, the test subscriber — `active`, paid, unchanged — resolved to
> `{"tier":"free","limit":3}`.
>
> The fix is to stop identifying a tier by its current price. Every price this script creates
> already carries `metadata.tier`, so `syncSubscriptionFromStripe` could read it and store a
> `tier_id` on `billing_accounts`, leaving entitlement to read that instead — the price id stays as
> a record of what they bought. A price-history table is the heavier alternative. **Not built.**

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

### Tax: the two fields that decide what a reader is charged

Both live in [`scripts/stripe-setup.ts`](../../scripts/stripe-setup.ts), both were found by driving a
real purchase on 2026-09-03, and neither is visible to any unit test — nothing here renders a Stripe
invoice.

**`tax_code` on the product.** A Stripe account created from 2026 has **Managed Payments** on by
default — Stripe as merchant of record — and it refuses to sell a product without one. The first
Checkout on the new account died with `Invalid line_items[0]: the product tax code is missing`, which
our route correctly reported to the reader as "we could not reach Stripe just now". Ours is
`txcd_10103000`, *SaaS — personal use*.

**`tax_behavior` on the price, and this one is the money.** Its default, `unspecified`, behaves as
*exclusive*: tax goes **on top**. A reader shown €9 was charged **€10.71** — €9.00 plus 19% German
VAT — which is not the price on the page and, for a consumer sale in the UK or EU, not a price that
may be advertised that way. It is now `inclusive`, measured side by side on the same customer: the
old price totalled 1071, the new one 900. `tax_behavior` is immutable like the amount, so fixing it
meant minting new prices; `differences()` now checks it, so a price predating this is replaced rather
than kept.

The consequence to be aware of is that the **net varies by the buyer's country** — €9 is €7.56 in
Germany at 19% and €7.44 in Ireland at 21%. That is the price of quoting one honest number
everywhere.

### Managed Payments, and what it is worth

**On, and confirmed on by the first live sale** — `managed_payments: { enabled: true }` on
`sub_1UBYxA…`, 2026-09-03. It arrived as a default rather than a decision, which is why it is
written up here. Stripe becomes merchant of record and **registers, files and remits VAT/GST in its
own name** across 80+ countries including the UK, the EU and the US — which retires the OSS problem
below rather than managing it. It also takes fraud liability and fights disputes.

It costs **3.5% on top of** normal processing — on an £8 subscription, roughly 32p becomes 60p.
Checkout and Payment Links only, digital goods only, and Stripe may refund a customer without asking
if a support escalation goes unanswered for 48 hours. Three further restrictions matter to anything
built on top of it, and they rule out designs rather than merely costing money: **a subscription may
only be created through Checkout or a Payment Link**, invoice items may not be attached to a
customer, and one-off invoices outside the billing period cannot be generated
([eligibility](https://docs.stripe.com/payments/managed-payments/eligibility)).

**The statement descriptor is `ONELINK* SPIDERYARN`**, read off the live charge — not the
`LINK.COM* SPIDERYARN.COM` this section predicted before anybody had paid. Receipts, invoices and
subscription management live on link.com, and the invoice's `account_name` is literally **"Link"**
with `issuer.type: "stripe"`, so a customer's paperwork says Link and not Spideryarn.

Turn it off at `dashboard.stripe.com/settings/managed-payments` (per mode) or per session with
`managed_payments[enabled]=false`. **Still unverified**: what happens to subscriptions already
running when it is toggled — which was the argument for deciding before anyone had subscribed, and
somebody now has.

### Adaptive Pricing, and why a London customer paid euros

**Managed Payments turns [Adaptive Pricing](https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing)
on by default**, and it picks the currency from where the customer physically is. On the first live
sale that was Greece, so a customer with a **GB billing address and a GB card was charged €9.00**
rather than £8.00. Stripe Tax, meanwhile, used the *billing address*: the invoice carries 20% UK VAT,
not Greece's 24%. So the two halves of the transaction answered "where is this customer?" differently
and both were arguably right.

This is worth knowing rather than fixing, but it is not free. It defeats the reason
[three currencies](#why-three-currencies-rather-than-one) exist: the account settles in GBP, so a
EUR charge takes Stripe's **+2% cross-currency fee** — exactly the charge that section set out to
avoid. Measured end to end on the live sale:

| | |
|---|---|
| Customer paid | **€9.00** |
| less 20% UK VAT, inclusive (Stripe remits it) | €7.50 |
| landed in the Spideryarn balance | **£5.98** |

so roughly 8% of the net went in fees — Managed Payments' 3.5%, card processing, and the 2% that
Adaptive Pricing invited. A UK reader sitting in the UK gets £8 and avoids that last part; a UK
reader on holiday does not. **Not a bug, and not currently worth engineering around** — but it does
mean the three-currency design saves less than it looks like it should, and anybody reading the
revenue numbers should not be surprised by a euro line from a British customer.

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

## The first live sale, and the four things it measured

Greg bought Reader on the live account on **2026-09-03 at 11:37 UTC** — `cus_VBwqG2jsgqOKh4`,
`sub_1UBYxALv4piDbwcbVew6jxqN`, on `acct_1UBW3NLv4piDbwcb`. Live mode gets exactly one first
customer, so what it settled is written down here rather than re-derived.

The day also produced four faults, recorded below beside the things they bite. Why none of them was
visible to a green suite, a passing `stripe:check` or a code review is
[260904a](../postmortems/260904a-four-billing-faults-and-the-witnesses-that-agreed-with-the-code.md);
the fixes are [260903i](../plans/260903i-fix-the-upgrade-path-and-the-cancellation-telling.md).

**One: the live round trip works, end to end and unattended.** Hosted Checkout → signed webhook →
`syncSubscriptionFromStripe` → a production `billing_accounts` row reading `status=active`,
`livemode=true`, the right price and a period ending 2026-10-03. `last_synced_at` was **11 seconds**
after the charge. The test-mode run had proved the code; this proved the deployed webhook endpoint,
the live keys and the production database, none of which the test run touches.

**Two: [Managed Payments](#managed-payments-and-what-it-is-worth) is really on**, with the
consequences and the statement descriptor recorded there.

**Three: [Adaptive Pricing](#adaptive-pricing-and-why-a-london-customer-paid-euros) charged a
British customer in euros**, because he was in Greece.

**Four: a cancellation is expressed as a timestamp, and we were reading a boolean** — below. It was
a live bug for a few hours on 2026-09-03 and is fixed; the payload is kept because it is the only
one of its kind we have.

### How Stripe says a subscription is ending

Greg cancelled the live subscription through the Portal on 2026-09-03. Stripe expressed it as a
**`cancel_at` timestamp** and left the old boolean alone:

```
"status": "active",
"cancel_at": 1791027429,       // 2026-10-03 11:37 UTC, the period end
"canceled_at": 1788435966,     // when the reader pressed cancel
"cancel_at_period_end": false, // <-- still false
"cancellation_details": { "reason": "cancellation_requested" }
```

[`src/billing/subscription.ts`](../../src/billing/subscription.ts) read only
`cancel_at_period_end === true`, so the sync stored `false` and `/profile` went on saying the plan
renews. Verified against the production row after the webhook had run: Stripe said cancelled, we
said nothing.

**What the code does now.** Both raw facts are read and both are stored — `cancel_at` is a nullable
timestamp column on `billing_accounts` beside `cancel_at_period_end`, because neither implies the
other: the hosted Portal writes the timestamp, an API cancellation writes the boolean. **They are
turned into one answer in exactly one place**, `planEndsAt` in
[`src/billing-plan.ts`](../../src/billing-plan.ts):

```
endsAt = cancelAt ?? (cancelAtPeriodEnd ? currentPeriodEnd : null)
```

and it is that single date — not the two flags — that
[`src/billing/summary.ts`](../../src/billing/summary.ts) puts on the wire and
[`BillingSection.tsx`](../../src/web/BillingSection.tsx) draws, as *"Your plan ends on 3 October
2026"*. Two independently-interpreted cancellation flags reaching the browser is how a page and a
route come to disagree, which would be this same bug a second time (GPT Sol, 2026-09-03). Note that
`cancel_at` is **not always the period end** — Stripe permits an ending scheduled for any future
moment — so the two dates are kept apart: `periodEnd` is the renewal and `endsAt` is the ending.

**Entitlement did not move, and must not.** The subscription stays `active` until the period ends,
which is exactly what we grant; a scheduled ending is a fact about the future and entitlement is a
fact about now. `tests/billing-admission.test.ts` § *a cancellation that has not happened yet takes
nothing away* pins it at the wall, in both cancellation shapes, with the mirror case that a period
genuinely over is still refused.

**`cancel_at` is written on every sync, including to null** — [`sync.ts`](../../src/billing/sync.ts)
writes every field every time, so a reader who cancels and then changes their mind in the Portal
stops being told their plan ends.

The class is the one this file keeps meeting: **a Stripe field whose meaning drifted under a pinned
API version**, the same shape as `current_period_start` moving to the subscription item.
[silent-success.md](../reusable/silent-success.md) — the boolean is still there, still parses, and
still means something, just not the thing the code wanted. It survived a green suite because every
fixture had been written from the same assumption as the code; the regression test is built from the
payload above rather than from a boolean.

> [!WARNING]
> **The live row predates the column.** `cancel_at` landed after the cancellation webhook had already
> been delivered, and `/profile` never resyncs from Stripe, so the one live cancelled subscription
> reads `cancel_at = null` until something syncs that customer again. See
> [The live row that needs a backfill](#the-live-row-that-needs-a-backfill).

### The live row that needs a backfill

**One production row, and nothing automatic will fix it.** `sub_1UBYxALv4piDbwcbVew6jxqN` was
cancelled on 2026-09-03; the `customer.subscription.updated` webhook that carried the cancellation
was delivered and handled *before* `cancel_at` existed as a column, so the row now reads
`cancel_at = null` under a subscription Stripe has scheduled to end on 3 October. `/profile`
[never resyncs from Stripe](#what-a-reader-sees), so nobody looking at the page can cause the row to
catch up.

**The recommendation is to make Stripe tell us again, not to type the date in.** Re-deliver that
event from the Stripe Dashboard (Developers → Events → the `customer.subscription.updated` for that
subscription → *Resend*), or make any change to the subscription that Stripe emits an event for.
`syncSubscriptionFromStripe` then does exactly what it does for everyone else — asks Stripe what is
true and writes all of it down, this time with a column to put it in.

That is preferred over an `UPDATE … set cancel_at = '2026-10-03T11:37:09Z'` for three reasons, and
the third is the one that decides it:

1. It goes through the code path this change was made to fix, so a successful backfill is also
   evidence the fix works against the live account — an `UPDATE` proves only that the column accepts
   a timestamp.
2. It writes **every** field, so anything else that has drifted since the last sync is corrected too.
3. **A hand-typed timestamp is a number we chose, not one Stripe gave us.** Reading `1791027429` off
   a document and converting it by hand is exactly the sort of step that lands the right value in the
   wrong row or the wrong value in the right one, on the one production row that has a paying reader
   attached to it.

A one-row `UPDATE` is the fallback if re-delivery is not available, and it should be run with the
`where` clause naming `stripe_subscription_id` rather than the owner. Either way it is a write to
production data on a live subscriber's account, so it is **Greg's call to make and to run** —
AGENTS.md § *Real data belongs to the reader*. Nothing in this change has run against production.

**Nobody else can be in this state.** The window was the few hours between the cancellation and the
migration, on an account with one live subscription; every cancellation from now on arrives with the
column already there.

## What a reader sees

Built 2026-09-03, and it is the half that had been missing: the refusal copy had been pointing at
*"the Upgrade button on your profile page"* since the wall went up, and there was no such button.

**`/profile` has a Plan section**, directly under Account — [`BillingSection.tsx`](../../src/web/BillingSection.tsx)
over [`useBilling.ts`](../../src/web/useBilling.ts). It says which plan, how much of it is used, and
what may be bought, and it has the two buttons that leave for Stripe. There is nothing else to it,
because there is nothing else to build: Checkout and the Portal are hosted.

**`GET /api/billing/usage`** is what it reads — [`src/billing/summary.ts`](../../src/billing/summary.ts),
with the wire shape and the words in the pure [`src/billing-plan.ts`](../../src/billing-plan.ts).
Three decisions worth knowing:

- **A route of its own, not a field on `GET /api/reader`.** That route is fetched from every article
  page by `useHasProfile`, so a billing field on it would put a `billing_accounts` read and an
  `ingest_events` aggregate on the path of opening an article, for data only `/profile` draws.
- **A GET, unlike the other three billing routes**, which are POSTs because each *creates a Stripe
  object*. This creates nothing and touches no network.
- **It never resyncs from Stripe.** Admission does, once, because it has to decide something. A read
  of your own plan does not: a stored period that has run out comes back as *we could not confirm
  your plan*, rather than as a guess between two wrong numbers.

**`ReaderPlan` is a discriminated union and the `lapsed` arm has no `used` field.** That is the
policy from *the quota* below made unbuildable rather than merely discouraged: a reader who took
forty articles on Reader and cancelled must never be shown *"40 of 3 used"*, and the number is not
on the wire for the page to print. `tests/billing-plan.test.ts` is the second half of it — that the
words chosen do not reconstruct the ratio from the numbers that *are* there, and that they make the
same three promises `pay-lapsed` makes.

**The refusal carries a way out of itself.** `QuotaNotice`
([`src/web/QuotaNotice.tsx`](../../src/web/QuotaNotice.tsx)) draws an ingest failure and puts a link
to `/profile` beside it when — and only when — the message's code is one of the three in
`QUOTA_CODES`. It is one component in four places (the shelf's add box, a job card's refused
**Retry**, the `/add/` page a pasted URL navigates to, and the upload picker), because four
renderings of one refusal would be four chances for three of them to stop offering the link.
`pay-off`, `pay-down` and `pay-none` are `pay-` codes too and get no link: nobody buys their way out
of a Stripe outage.

**And it had to be told the refusal durably, which cost a bug to learn.** The first version rendered
`queue.error` — engine state that the failed POST's *own* follow-up poll clears — so the 402 and the
link vanished before anybody could read them, leaving the generic *"It didn't get as far as the
queue"*. Every unit test in the change was green; a browser check on a real free account found it.
Both surfaces now snapshot `queue.lastFailure()` right after the await, which is what
[`src/web/useStepJob.ts`](../../src/web/useStepJob.ts) already did after the same discovery in
August. `tests/refused-job-reason-survives.test.tsx` holds it, with the poll held so the frame
before it can be asserted separately from the frame after.

**What the browser may send is still only a tier id.** The Upgrade button posts `{ tierId }` and no
currency at all — hosted Checkout picks by the customer's location, which is the whole reason a price
carries three. The page shows all three amounts rather than guessing one from the locale.

**Manage billing appears the moment somebody first presses Upgrade, not when they pay**, and that is
the ordering guarantee showing through rather than a bug: the customer→owner mapping is committed
*before* a Checkout Session exists, so an abandoned Checkout leaves a real mapped Stripe customer.
The Portal then opens on no payment method and no invoices, which is the honest state of an account
that started to subscribe and stopped. Seen in the browser on 2026-09-03 and written down because it
looks wrong for as long as it takes to remember why the mapping comes first.

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
npm run stripe:setup                     # say what it would do — the sandbox, and this laptop
npm run stripe:setup -- --apply          # do it
npm run stripe:check                     # read-only: is this account fit to take money?

npm run stripe:setup -- --prod           # the same three, against LIVE and the production database
npm run stripe:setup -- --prod --apply
npm run stripe:check -- --prod
```

**`--prod` is how you reach production, and naming the target on the command line is not.**
Both scripts call `loadEnvLocal()`, so `.env.local` beats the shell by design ([`src/env.ts`](../../src/env.ts));
`DATABASE_URL=… STRIPE_SECRET_KEY=… npm run stripe:setup` therefore talks to the sandbox and the
laptop whatever you type. The Stripe half fails loudly — a test key with `VERCEL_ENV=production`
trips the mode guard — and **the database half fails silently**, creating live prices and writing
their ids to your laptop while printing success. `--prod` takes both credentials from `.env.prod`
together, so a mismatched pair has to be written into that one file rather than assembled by
accident on a command line. [`scripts/stripe-target.ts`](../../scripts/stripe-target.ts),
[260903h](../plans/260903h-stripe-scripts-reach-production.md).

What `--prod` requires, before anything is created: a `DATABASE_URL` that **`pg`'s own parser**
resolves to a hosted Supabase host (`*.pooler.supabase.com`, or `db.<ref>.supabase.co`) over TLS.
That is an allowlist, and it is deliberately not a list of local spellings to refuse — the version
that was accepted `local%68ost`, `2130706433` and `postgresql:///postgres`, because `new URL` and
`pg` do not agree on what the host is. It then wants that database to match `SUPABASE_URL` in the
same file, both credentials present and non-empty, and a Stripe key that opens Spideryarn's own
account. It does **not** check that the row contents or `.env.prod` are current.

**Do it in this order**, because only the first step is free:

1. `npm run stripe:check -- --prod` — read-only.
2. Read the three identity lines it prints: the `.env.prod` it read, the `Target:` database, and the
   account id. If any is not what you expect, stop.
3. `npm run stripe:setup -- --prod` — the dry run. Read what it says it would change.
4. `npm run stripe:setup -- --prod --apply`.
5. `npm run stripe:check -- --prod` again.

Every run prints its target before it does anything — including a run that is about to fail on a bad
key, since that is when you most want to know what it was aimed at:

```
Stripe setup — LIVE mode, API 2026-08-26.dahlia
  Target: postgresql://spideryarn_app.alschkahzfagtppxspfq@aws-0-eu-west-2.pooler.supabase.com:6543/postgres
  Account: acct_1UBW3NLv4piDbwcb
```

A mistyped flag is refused rather than ignored: `--prodd` would otherwise mean "the sandbox", which
is not what the person typing it meant.

**A `prod_…` id is not enough to tell the modes apart.** Read back on 2026-09-03,
`prod_VBu1bNwCZAIWwc` exists in *both* accounts — same id, `livemode=false` in one and `true` in the
other, created fifty minutes apart. So two runs' output can look identical while touching different
accounts, and it is worth knowing before you compare a sandbox run against a live one. The account
id and the `Target:` line are what distinguish them.

`stripe:check` writes nothing. It is what you run against **live** before trusting it, and against a
sandbox to see whether the two agree: the business name a customer reads on the Checkout page, the
statement descriptor, the tax code without which nothing sells, `tax_behavior`, every currency
against its row, the portal's cancel and card-update features, and whether any endpoint is listening
for the webhook that grants entitlement. `✗` exits non-zero. It exists because every check it makes
is one a real purchase found on 2026-09-03 and no unit test can —
[`scripts/stripe-check.ts`](../../scripts/stripe-check.ts) says which.

Idempotent by `lookup_key`, not by product name — a name is a label a human may edit, and matching
on one is how you end up with two $10 prices and two cohorts of customers on different ones. It
**refuses** to adopt a lookup key pointing at a different amount, because Stripe prices are
immutable and "change the price" is really "create a price and move the variable".

`STRIPE_SECRET_KEY` travels on the `gjd-remote push-env` allowlist. There is no price variable to
carry: the ids are rows.
`STRIPE_WEBHOOK_SECRET` deliberately does not: locally it is minted per machine by
`stripe listen`, so one machine's value is wrong on another's.

Greg's manual surface is the account, the keys, and the few dashboard-only settings — customer
email receipts, dispute auto-cancellation and the dunning schedule. Everything else is the script.

### Spideryarn has its own Stripe account

`acct_1UBW3NLv4piDbwcb`, live, with sandbox `acct_1UBW3ULUG7Oye8CX` — **not** the
`acct_1GHoSxLZ0dGTJEEP` that bills Greg's consulting work. Greg's call, 2026-09-03, and the reasoning
is worth keeping because the obvious argument for splitting turned out to be the wrong one.

The obvious argument was the statement descriptor: a Spideryarn customer would read
`GREG DETRE CONSULTING` on their bank statement. That is **solvable inside one account** — Stripe
resolves the descriptor Invoice → Product → account default, so a `statement_descriptor` on the
Spideryarn product would have done it, and per-session `branding_settings` would have fixed the
Checkout page too.

What could not be solved per-product is everything else, because it is account-wide: the **Customer
Portal** (one headline, one custom domain — and it is our entire self-serve billing UI), the
**customer email sender**, the **dunning and retry cadence**, **Radar** rules, the payout schedule,
and the blast radius if Stripe ever freezes an account. A consumer subscription and B2B consulting
invoicing want different answers to all of those. Two settings collided in one morning before the
split — the portal login link and the one-subscription toggle — which is what made the pattern
obvious.

The costs, paid knowingly: a second account verifies from scratch and inherits nothing, and there are
two payout streams to reconcile. **A separate Stripe account is not a separate tax position** — that
follows the legal entity, and both trade under the same company.

Settings do **not** cross between a sandbox and live, or between accounts: products, prices, portal
configuration, webhook endpoints, business name, branding and every dashboard toggle start empty in
live and must be set again there. `npm run stripe:check` is how you find out whether they were.

### Subscribing twice: looked at, and deliberately left open

Nothing spans the "do they already subscribe?" check and `checkout.sessions.create`, so in principle
a reader could hold two payable Checkout pages at once and complete both. Measured on 2026-09-03: a
test customer already holding an `active` subscription was served a full "Subscribe with obligation
to pay" page for a second one, so the gap is real rather than theoretical.

**Greg's call, 2026-09-03: not worth closing.** It takes two Checkout pages opened before either is
paid, and then two card forms filled in on purpose — `useBilling`'s `if (busy) return` already eats
the double-click, and `hasOpenSubscription` already turns the ordinary second attempt into the
Portal.

What was weighed and passed over, so nobody re-derives it:

- **Stripe's own [Limit customers to one subscription](https://dashboard.stripe.com/settings/checkout#subscriptions)**
  (Settings → Checkout and Payment Links). No documented API — `/v1/account`'s `settings` has no
  Checkout section — so it is a dashboard click, per mode. It **redirects a Checkout page as it
  loads**; it is not a refusal at `sessions.create`, so it would not have closed the two-tab case
  anyway. When its destination is the Portal it also depends on `login_page.enabled`, which would
  silently make it do nothing — and that field was **account-wide** on an account that also billed
  Greg's consulting work, which is one of the collisions that prompted the split above.
- **Reusing an open Session** — the actual close, and it needs stored session state plus expiry
  handling.
- **An idempotency key** on `sessions.create` — no help, because the window here is a second tab
  rather than a second click.

If it ever does happen, the thing that should say so is `chooseSubscription`'s anomaly — and it has
a hole: it counts only *entitled* subscriptions, so an `active` beside an `unpaid` is two collectable
invoices and nothing logged. Counting over non-terminal statuses instead, from the raw Stripe list
before unreadable shapes are filtered out, is the fix if this is ever picked back up.

**And the reader would be left on the wrong one of the two.** `newest()` picks by *latest period
start*, not by largest allowance, so somebody who completed a Researcher page and then a Reader page
pays for both and is metered at Reader's 20. Deliberate as a tie-break — it is a stable rule that
reads the data rather than trusting Stripe's list order — but it means the accident's cost lands on
the customer rather than on us, which is the wrong way round. Picking the highest-allowance live
tier would be the kinder rule. GPT Sol, 2026-09-03.

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

**No invoice event is one of the four, and there is one worth adding.** Entitlement reads
`subscription.status`, and Stripe leaves a subscription **`active` when an invoice cannot be
finalised** — an automatic-tax or customer-location failure being the likely cause here, since
Managed Payments computes tax on every renewal. Nothing is collected and nothing is refused: the
reader keeps their allowance on a renewal we were never paid for, and the only signal is
`invoice.finalization_failed`, which we ignore. Not seen in the wild, and the cost is bounded by one
month of one subscription — but it is the one invoice event whose absence changes what somebody gets
for free. GPT Sol, 2026-09-03.

### Pointing Stripe at it

**Locally**, nothing is registered at Stripe. `stripe listen` holds a connection open and forwards,
minting its own signing secret each time it starts — which is why `STRIPE_WEBHOOK_SECRET` is
per-machine and never travels:

```bash
stripe listen --api-key "$STRIPE_SECRET_KEY" \
  --forward-to http://localhost:5273/api/webhooks/stripe \
  --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted
```

It prints `whsec_…` on the line that says *Ready!*. Put that in `.env.local` and **restart the dev
server** — the value is read at startup, so a server already running is still checking signatures
against the previous session's secret and will reject every delivery with a 400. Pass `--api-key`
rather than relying on `stripe login`: the CLI's stored login is whichever account somebody
authenticated last, which is not necessarily this one.

**In production**, it is a registered endpoint at
[dashboard.stripe.com/webhooks](https://dashboard.stripe.com/webhooks) (the live URL, with no
`/test/`), pointing at `https://www.spideryarn.com/api/webhooks/stripe`, subscribed to exactly the
four events in `HANDLED_EVENTS`, with its own permanent `whsec_…` revealed on the endpoint's own
page. That secret is per-endpoint and unrelated to the API keys; it goes in the Vercel production
environment.

**Done on 2026-09-03**: endpoint `we_1UBXjMLv4piDbwcbrLUPudWD`, and both `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET` set on Vercel Production. Until that day **neither was set there at all**,
so live Checkout would have answered 503 however well the Stripe account was configured — the
account and the deployment are two separate places to finish the job, and `stripe:check` only sees
the first.

`npm run stripe:check -- --prod` fails if nothing is listening at that URL, because a live account
with no endpoint takes money and grants nothing — the one failure mode where every other check
passes and the customer is simply not served. It checks Stripe's side; what it cannot see is whether
the deployment holds the secrets, which is `vercel env ls production`.

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

## What `/admin/users` shows

Two columns since 2026-09-03 — **Plan** and **Ingests** — beside the spend column, because "who is
paying" and "who is expensive" are two halves of one question.

**The plan is decided by `entitlementFromRow`**, the same function `reserveIngest` decides with under
its lock. That reuse is the point: a row this page draws as *reader, 4 of 20* is a row the wall would
admit, and one it draws as free is one refused at three. The status is shown **raw**, beside the
plan rather than folded into it — `free` over `canceled` is a lapsed subscriber, and `reader` over
`past_due` is the case somebody would otherwise "fix", since `past_due` is entitled on purpose.

**The administrator's own row shows an em dash**, not a count. The exemption is total — no slot is
reserved at all, so an administrator's ingests are legitimately absent from `ingest_events` — and the
page decides it with `isAdmin`, which is already in the browser bundle beside the `admin` marker.

The plan said this would be "one field on `AdminUser`, one column, one per-owner statement in
`pg-admin.ts`". It is **four fields, two columns and three reads** (the ledger aggregate, every
`billing_accounts` row, and the cached tier table), and the reasons are on `AdminUser` in
[`src/admin.ts`](../../src/admin.ts): a plan with no usage figure does not answer the operational
question, a usage figure with no limit has no scale, and the limit is a row somebody may raise at
any time. See [admin.md](admin.md).

## Not built yet

**Go-live happened on 2026-09-03** — see
[The first live sale](#the-first-live-sale-and-the-four-things-it-measured). What is left:

- **Comp subscriptions** for journalists and QA. Until then the only exemption is the hardcoded
  admin check.
- **Backfilling the one live cancelled row** — see
  [The live row that needs a backfill](#the-live-row-that-needs-a-backfill). The code is fixed; the
  row predates the column.
- **Grandfathered subscribers keep paying and lose their allowance** — the warning under
  [Adding a tier or a currency](#adding-a-tier-or-a-currency). Nobody is grandfathered yet, so this
  is a trap rather than a live fault, and changing a price is what springs it.
- **Reader → Researcher**, below, which is a dead end rather than a rough edge.

The order is in
[the plan](../plans/260902i-stripe-payments-and-subscription-tiers.md#where-the-build-stands).

### A paying Reader cannot become a Researcher

> [!WARNING]
> **The one upgrade that makes us more money is the one there is no way to perform.** Found by GPT
> Sol on 2026-09-03 and then confirmed against the live Portal configuration, which is the half that
> matters — the code alone does not say what Stripe is configured to allow.

The loop closes on itself in three steps:

1. A Reader subscriber presses **Upgrade to Researcher** on `/profile`.
2. `startCheckout` ([`src/billing/checkout.ts`](../../src/billing/checkout.ts)) sees
   `hasOpenSubscription` and deliberately returns the **Portal** instead of a Checkout page — right,
   given Managed Payments forbids creating a second subscription outside Checkout.
3. The live Portal configuration `bpc_1UBY0iLv4piDbwcb5ypEUfFO` reads
   **`subscription_update: { enabled: false, default_allowed_updates: [] }`**. There is no *Switch
   plan* button on the page they land on.

So the only route from Reader to Researcher is to cancel, wait out the paid period, and subscribe
again — losing a month, and asking somebody who wants to pay us five times more to first stop paying
us anything.

`ensurePortalConfiguration` never sets `subscription_update`, and it **does not reconcile features on
a configuration that already exists**, so editing the script alone will not fix the live account. Two
things then have to be decided rather than defaulted, because Stripe's defaults are wrong for us:
`proration_behavior` (`none` would give away Researcher for the rest of the month) and
`billing_cycle_anchor` (`unchanged` keeps the dates, which is what makes existing usage count towards
the new 150 rather than resetting).

**`stripe:check` did not catch this**, and that is the more useful lesson: it verifies cancellation,
invoices and card updates, and never asks whether a plan switch is possible. A check that has never
seen the thing it is meant to protect fail is
[not evidence](../reusable/silent-success.md); this one passed cleanly on live day with the upgrade
path shut.

## Where the code is

| | |
|---|---|
| [`src/billing/stripe.ts`](../../src/billing/stripe.ts) | The only place a Stripe client is constructed. Mode guards, pinned API version. |
| [`src/billing/tiers.ts`](../../src/billing/tiers.ts) | What an entitlement *is*, which statuses are entitled, which price sells what. Pure — the tiers themselves are rows. |
| [`src/store/pg-tiers.ts`](../../src/store/pg-tiers.ts) | Reading `billing_tiers` and its prices, cached for thirty seconds because admission asks on every ingest. |
| [`src/billing/subscription.ts`](../../src/billing/subscription.ts) | Reading a Stripe subscription into the fields entitlement needs, and refusing everything unrecognised. Pure. |
| [`src/billing/webhook.ts`](../../src/billing/webhook.ts) | Verification. |
| [`src/billing/checkout.ts`](../../src/billing/checkout.ts) | The three billing routes: the order that makes the mapping durable, the Portal redirect, and the proof that a Checkout Session belongs to the reader asking about it. |
| [`scripts/stripe-check.ts`](../../scripts/stripe-check.ts) | Read-only. Whether an account is actually fit to take money, one check per thing a real purchase has caught. |
| [`src/store/pg-billing.ts`](../../src/store/pg-billing.ts) | Reserve, settle, count. The lock. |
| [`src/billing/admission.ts`](../../src/billing/admission.ts) | Which requests spend a slot, the refusal a reader sees, and the release. The only caller of `reserveIngest`. |
| [`src/billing-plan.ts`](../../src/billing-plan.ts) | What `/profile` is told and what it says. Pure — no database, no network, no React, so the browser can have it. |
| [`src/billing/summary.ts`](../../src/billing/summary.ts) | `GET /api/billing/usage`: the row, the tiers and the ledger, turned into a `ReaderPlan`. |
| [`src/web/BillingSection.tsx`](../../src/web/BillingSection.tsx) · [`useBilling.ts`](../../src/web/useBilling.ts) | The Plan section on `/profile`, and the two redirects. |
| [`src/web/QuotaNotice.tsx`](../../src/web/QuotaNotice.tsx) | An ingest failure with a link to `/profile` beside it, when the failure is the quota. |
| [`src/store/pg-session.ts`](../../src/store/pg-session.ts) | Three of the seven sites a job ends at, and the only one that charges. |
| [`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts) | The other four — `settleExpired`, `requestCancel`, `finish` and `releaseStep` — plus the job INSERT that writes `ingest_event_id`. |
| [`src/db/schema.ts`](../../src/db/schema.ts) | `billing_tiers`, `billing_tier_prices`, `billing_accounts`, `ingest_events`, `jobs.ingest_event_id`. |
