# Review prompt: the Stripe checkout, portal and confirm routes

You are reviewing **built code**, not a plan. Be specific and adversarial; say what is wrong and
where. Rank findings P1 (would lose money, grant entitlement wrongly, or leak one reader's state to
another) / P2 (real defect, bounded blast radius) / P3 (worth fixing, not urgent). If something is
fine, say so briefly rather than inventing work.

## What this is

Spideryarn is a reading app. Payments are Stripe: hosted Checkout and the hosted Customer Portal,
never our own card UI. The quota (three lifetime ingests free, 20/month on Reader, 150/month on
Researcher) has been enforced since yesterday and there was **no way to pay** until this change.

This change adds three authenticated routes and the module behind them:

| | |
|---|---|
| `POST /api/billing/checkout` `{ tierId, currency? }` | a hosted Checkout Session, or the Portal if they already have a subscription |
| `POST /api/billing/portal` | a hosted Portal session |
| `POST /api/billing/confirm` `{ sessionId }` | the browser's return path: prove the session is theirs, then sync |

The evidence handed to the reviewer was a generated bundle — `src/billing/checkout.ts` and
`tests/billing-checkout.test.ts` in full, then a diff of the four pre-existing files touched
(`tiers.ts`, `sync.ts`, `messages.ts`, `routes.ts`). It was deleted after the review rather than
kept: it is a copy of files that are in the tree, and a second copy of code is the thing nothing
keeps in step. Rebuild it with `git diff -- <those four>` prepended by the two whole files.

## The context you need

- **`billing_accounts`** is one row per owner. `owner_id` is the PK (a `auth.users` uuid);
  `stripe_customer_id` and `stripe_subscription_id` are unique and nullable; `status` is Stripe's raw
  text. A CHECK enforces that a subscription id cannot exist without a customer id.
- **The webhook** (`POST /api/webhooks/stripe`, already built) never trusts a payload for state. It
  reads the event's customer, looks it up in `billing_accounts.stripe_customer_id`, and calls
  `syncSubscriptionFromStripe(customerId)`, which locks that row `for update`, asks Stripe for **all**
  that customer's subscriptions, and overwrites the row. **If the lookup finds no row it answers 503**
  so Stripe retries.
- **Therefore the whole guarantee of this change** is that the committed customer→owner mapping
  exists *before* a Checkout Session naming that customer exists. A browser return callback cannot be
  relied on to write it.
- **The claim on the customer is a conditional UPDATE and deliberately not a lock**
  (`where owner_id = $1 and stripe_customer_id is null`). Zero rows means a concurrent request won;
  the loser re-reads and adopts the winner's customer, abandoning its own Stripe customer. That
  orphan is an accepted cost, decided already — do not relitigate it, but *do* say if the code fails
  to implement it correctly.
- **The store**: Drizzle over Postgres, `read committed` everywhere. `getDb()` returns a pooled
  handle; `DATABASE_POOL_MAX` is 5.
- **`assertLivemode(livemode, what)`** throws `StripeConfigError` when a Stripe object's mode
  disagrees with the deployment's (production expects live, everything else expects test).
- **`httpError(status, message)`** attaches a status the dispatcher turns into the response code. The
  message reaches the reader verbatim.
- Tiers are **database rows** (`billing_tiers`), read through a 30-second cache. `stripe_price_id`
  and `livemode` are written by `scripts/stripe-setup.ts`.

## What to look at hardest

1. **Ordering and races.** Is there any interleaving in which a Checkout Session capable of taking
   payment exists while `billing_accounts.stripe_customer_id` is null or wrong for that owner? Any in
   which two owners end up sharing a customer, or one owner ends up with two mapped customers?
2. **`confirmCheckout`.** Can one reader make it act on another's Checkout Session, or learn anything
   about another account from its replies or its timing? Is the ownership proof complete? Note that
   `client_reference_id` is set by us and `customer` is compared against our own committed row.
3. **Selling the wrong thing.** Can the request influence which price is charged, in which currency,
   or in which Stripe mode? Can a retired tier be sold? Can a second subscription be sold beside a
   live one — and is `TERMINAL_STATUSES` (`canceled`, `incomplete_expired`) the right list, given that
   `past_due` and `unpaid` are *not* entitled but are still subscriptions Stripe may collect on?
4. **Failure modes and status codes.** Anything that turns a fault into a silent success, or a
   refusal into a 500. Anything that returns 2xx over work that did not happen.
5. **Return URLs.** `billingReturnOrigin()` decides production first and reads no environment
   variable there. Is there any way to make a paying customer return to a host we do not own?
6. **Comments that claim more than the code does.** An earlier review of this feature found eleven of
   these and they are treated as defects here. Quote any you find.
7. **The tests.** Two of them were wrong before they were right (both recorded in the plan). Are any
   of the remaining 50 passing for a reason other than the one their name gives? Is any assertion
   satisfiable by code that does not do what the test claims to check?

## What has already been verified, so you need not re-check it

- 50 tests pass against a real Postgres, and twelve one-at-a-time mutations of the implementation
  were each watched red (the table is in the plan doc).
- The **real round trip ran** on 2026-09-03: a test-mode Checkout paid with `4242 4242 4242 4242`
  through the hosted page, `stripe listen` forwarding to the dev server, and
  `syncSubscriptionFromStripe` executing against the real Stripe for the first time — writing an
  `active` subscription with a period read off the subscription *item*. The same account then admitted
  an ingest that a free account would have been refused, and was refused the twenty-first with
  Stripe's own renewal date.

Tell me what is still wrong.
