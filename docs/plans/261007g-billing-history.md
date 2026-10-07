# Billing: the history moved out of the reference doc

Moved verbatim from [docs/project/billing.md](../project/billing.md) on 2026-10-07, when the docs sweep
split over-long reference docs (docs/plans/261007a-docs-sweep-signposts-truth-and-coverage.md § Three
questions, 3). The reference doc keeps what is true now; this keeps how it came to be. Nothing here is
current unless the reference doc says so.

## Billing

As of 2026-09-03 there are checkout,
portal and confirm routes, and the **whole round trip has been run for real** in Stripe test mode:
card `4242…` through hosted Checkout → signed webhook → `syncSubscriptionFromStripe` (which had
never executed until then) → an `active` row with the period Stripe reported → the same account
admitting a fourth ingest where a free one is refused, and refusing the twenty-first with Stripe's
own renewal date on it.

**The first live sale happened the same day** — see
[The first live sale](#the-first-live-sale-and-the-four-things-it-measured), which is where the
facts that only a real purchase can establish are written down.

The **reader-facing surface** landed the same day — see [What a reader sees](../project/billing.md#what-a-reader-sees).

## Adding a tier or a currency

### Seeded descriptions that duplicated the allowance

The two seeded rows did repeat it, which read on screen as *"20 articles
a month. 20 articles a month. Reading what you have already added is always free."* until a browser
run caught it on 2026-09-03; `drizzle/20260903090000_…` took the first sentence back out.

## Tax: the two fields that decide what a reader is charged

The first
Checkout on the new account died with `Invalid line_items[0]: the product tax code is missing`, which
our route correctly reported to the reader as "we could not reach Stripe just now".

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

**Two: [Managed Payments](../project/billing.md#managed-payments-and-what-it-is-worth) is really on**, with the
consequences and the statement descriptor recorded there.

**Three: [Adaptive Pricing](../project/billing.md#adaptive-pricing-and-why-a-london-customer-paid-euros) charged a
British customer in euros**, because he was in Greece.

**Four: a cancellation is expressed as a timestamp, and we were reading a boolean** — below. It was
a live bug for a few hours on 2026-09-03 and is fixed; the payload is kept because it is the only
one of its kind we have.

The cancellation payload and current handling remain in
[billing.md § How Stripe says a subscription is ending](../project/billing.md#how-stripe-says-a-subscription-is-ending).

## How Stripe says a subscription is ending

[`src/billing/subscription.ts`](../../src/billing/subscription.ts) read only
`cancel_at_period_end === true`, so the sync stored `false` and `/profile` went on saying the plan
renews. Verified against the production row after the webhook had run: Stripe said cancelled, we
said nothing.

## What a reader sees

Built 2026-09-03, and it is the half that had been missing: the refusal copy had been pointing at
*"the Upgrade button on your profile page"* since the wall went up, and there was no such button.

## Deleting an article freezes its price rather than moving it

The trigger landed before the delete
path did (`DELETE /api/library/:slug`, 2026-09-06).

## A job ends at seven sites, and every one of them settles

The four release outcomes and current settlement rules remain in
[billing.md § A job ends at seven sites](../project/billing.md#a-job-ends-at-seven-sites-and-every-one-of-them-settles).

Until 2026-09-03 all four logged the same sentence at `warn`, and a test asserted
that the charge silently survived — GPT Sol, finding 3.

An earlier version of this paragraph said the loser's
settlement "rolls back with the transition that lost", which was a plausible sentence about
something that never happens — GPT Sol, 2026-09-03.

## Billing is a Postgres feature

### Former guards against filesystem billing in production

It used to rest on
a boot refusal in `src/store/index.ts` and a `/api/health` warning, both of which went with the
thing they were guarding against on 2026-09-05.

## Spideryarn has its own Stripe account

Two settings collided in one morning before the
split — the portal login link and the one-subscription toggle — which is what made the pattern
obvious.

## Not built yet

- ~~**A subscriber is offered no plan change**~~ — **done, 2026-09-04**. Stripe permitted the
  switch that morning and the gate became tier-aware that evening; a Reader is offered Researcher on
  both pages, through the Portal. [Reader → Researcher](../project/billing.md#reader-researcher-open-at-stripe-and-open-in-our-own-ui).

## Reader → Researcher: open at Stripe, and open in our own UI

Found by GPT Sol on 2026-09-03 and then confirmed
against the live Portal configuration, which is the half that matters: `subscription_update` read
`{ enabled: false, default_allowed_updates: [] }` on the account taking real money. A Reader who
pressed **Upgrade to Researcher** was sent to a Portal with no *Switch plan* button on it, and the
only route left was to cancel, wait out the paid period and subscribe again — asking somebody who
wants to pay us five times more to first stop paying us anything.

[260903i](../plans/260903i-fix-the-upgrade-path-and-the-cancellation-telling.md) closed it, applied
live on 2026-09-04.

### The live Portal configuration check

`stripe:check --prod` went from five
blocking problems to none the same day.

### And then the dead end moved into our own UI, where it was closed the same day

`canCheckout` ([`src/billing/summary.ts`](../../src/billing/summary.ts)) meant *"has no open
subscription"* — the same question `startCheckout` asks — and not *"has somewhere to go"*, while
every plan button on both pages was gated on it. So a paying Reader was drawn no button anywhere and
the switch Stripe had just permitted was one nothing offered.
