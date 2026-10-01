# Gift vouchers send two emails: one to the recipient, one back to whoever made it

Report `spya-vp4mdn`, the follow-up [261001m](261001m-gift-vouchers-for-free-articles.md) left as
*Not built*. Up: [email.md](../project/email.md), [billing.md](../project/billing.md).

> The gift voucher should definitely email the recipient. And I want an email when they claim it.
> No need for expiry. Delegate accordingly.
>
> — Greg, 2026-10-01

## What we are building

1. **On create, the recipient is emailed**: you have been given N free articles on Spideryarn; sign
   in or create an account with this address at `/login` and they are added, with no code to type.
   HTML in the auth templates' shape (`supabase/templates/confirmation.html`) plus a plain-text
   part, in wording Opus drafted. The only value in it is N, an integer the route validated.
   **Never the note**, never the creator. `sendEmail` gains an optional `html`.
2. **On claim, the voucher's creator is emailed** (plain text, `arrivalMessage`'s shape): the
   claimant's address and account id, the articles, when it was made and claimed, and a link to
   `/admin/vouchers`. **Not the note** (Sol F7: it would be one more copy in Resend, the forwarder
   and an inbox, and the page already has it). The address comes from `created_by` through
   `accountEmail`. **If that lookup fails, nothing is sent**: the delivery is marked `failed:
   creator address unavailable` and can be retried from the page (Sol F4: `hello@` is not known to
   be the creator's).
3. **Changing an unclaimed voucher's address sends the recipient's email again, to the new
   address.** That is a new event, and correcting a typo is its usual cause.
4. **No expiry.** Revoke stays the only invalidation.
5. **`/admin/vouchers` shows each delivery's state** in the Status cell: *Email to them: sent 17:20*
   / *not sent: not production* / *failed: Resend answered 422* / *sending…* / *waiting to send*.
   It does so for both kinds, with a **Retry** button on any delivery that may be retried (below).

## At most once: one row per delivery, and its id is Resend's idempotency key

Additive migration, a new table `billing_voucher_emails`:

| column | |
|---|---|
| `id` uuid pk | also the `Idempotency-Key` sent to Resend (`voucher-email/<id>`) |
| `voucher_id` uuid not null → `billing_vouchers(id)` | |
| `kind` text, check in `('gift','claimed')` | to the recipient / to the creator |
| `status` text, check in `('queued','sending','sent','skipped','failed')` | |
| `attempts` integer not null default 0 | bumped by each reservation; the completion must match it |
| `detail` text null, ≤ 200 | the `SendResult` reason (a status code, an error name, or `creator address unavailable`), never an address |
| `created_at`, `updated_at` timestamptz | |

A unique index on `(voucher_id)` where `kind = 'claimed'` allows one claim notice per voucher, ever.

**A delivery is queued in the same transaction as its event**: the voucher insert, the claim's
`UPDATE … RETURNING`, or the address change. The event and its email commit together, so there is
no event without a queued email and no queued email without its event. The email cannot fail the
event, because nothing about sending happens inside that transaction.

**Sending is reserve, send, complete:**

1. **Reserve**: `UPDATE … SET status = 'sending', attempts = attempts + 1 WHERE id = $1 AND <may
   reserve> RETURNING attempts`. It is one statement, so of any number of contenders one wins.
2. **Send** with `Idempotency-Key: voucher-email/<id>`. Resend keeps a key for 24 hours and answers
   a repeat with the first result instead of sending a second email
   ([changelog](https://resend.com/changelog/idempotency-keys)). So retrying a delivery that Resend
   did accept (a timeout, or a crash before step 3) does not send it again inside that window.
3. **Complete**: `UPDATE … SET status = <outcome>, detail = … WHERE id = $1 AND status = 'sending'
   AND attempts = <mine>`.

*May reserve* is `status = 'queued'` for the automatic send after the response. For **Retry** it is
`status IN ('queued','failed','skipped') OR (status = 'sending' AND updated_at < now() - 10
minutes)`. It is **never `sent`**, so a second click after a success is refused (Sol F3). For a
`gift` delivery the voucher must also still be unclaimed and unrevoked. The same predicate, as one
SQL fragment, gives the list its `retryable` flag, so the page and the route cannot disagree. A Retry
more than 24 hours after an ambiguous attempt can send a duplicate; the page says *may have gone* on
a stuck or timed-out delivery, and the admin decides.

**A replayed create is the same create** (Sol F2). The browser mints the voucher's id
(`crypto.randomUUID()`) and sends it, and the insert is `on conflict (id) do nothing`. A replay with
the same body gets the original back (200) and queues nothing; a different body under that id is a
409.

**Each queued delivery is its own `afterResponse` task** (Sol F8), so when two vouchers are claimed
at once and the first notice fails, the second is still sent.

**What can still fail an event, and why that is right**: only the database, which is the database
the event itself is written to. Bookkeeping after the event (reserve and complete) is caught and
logged (a label and the delivery id; never an address or the note). It leaves a state the page
shows, `queued` (never reserved) or `sending` (never completed), and both can be retried (Sol F5).

## Where each send runs

All of them run **after the response** (`afterResponse`), as email.md says (Sol F6: an admin's
request that a proxy retries is no safer for having waited). The create's answer says
`email: "queued"`. The page re-reads once, four seconds after a create, an address change or a
Retry, and its Refresh button is there too.

## Safety

- Creating, changing and Retry are admin routes behind the namespace gate (`/api/admin/vouchers…`
  and `POST /api/admin/voucher-emails/:id/retry`), so nobody else can make Spideryarn email an
  address. New rows go in `tests/authenticated-api-route-contract.test.ts` and the gate's 403 test.
- Resend's free plan is 100 a day, and the admin is one person, so there is no extra rate limit.
- A test pins that the note, the creator id and the voucher id appear in neither part of the
  recipient's email, and that the note is not in the claim notice.
- **`/privacy` gets one sentence.** This is the first email to somebody who never gave us their
  address: an administrator may enter an address to send a gift of articles, and that address gets
  one email saying so.
- **Click tracking.** The link is `https://www.spideryarn.com/login`, which holds no secret. If
  Resend's click tracking were on, the rewritten link would still land on the right page, by way of
  Resend. Our key is send-only (`GET /domains` answers 401 `restricted_api_key`, tried 2026-10-01),
  so whether tracking is off **cannot be checked from here**. It stays a dashboard check for Greg,
  and it matters more for the auth templates' one-time links than for this one.

## Testing

Red first, against Postgres, with an injected sender (the `EmailDeps` seam: a fake `fetch` and an
env that says production). Nothing reaches Resend, and `tests/setup/provider-guard.ts` refuses it
anyway.

- A create queues one `gift` delivery, and the send makes exactly one call: to the voucher's
  address, with N and the `Idempotency-Key` in it and no note. The row ends `sent`.
- A replayed create (same id and body, one after the other and concurrently) makes one voucher and
  one email. A different body under that id is a 409.
- A failing send (Resend 500, and `fetch` throwing) leaves the voucher created and the delivery
  `failed`, with a detail that has no address in it.
- A reserve or complete that throws leaves the create's 201 and the claim's plan read intact, with
  the delivery `queued` or `sending` and retryable.
- Concurrent Retries make one call. A Retry after `sent` is refused. A stale `sending` may be
  retried after ten minutes and carries the same idempotency key. A gift Retry on a claimed or
  revoked voucher is refused.
- A claim queues one notice per voucher, to the creator's resolved address. A failed lookup sends
  nothing and records `creator address unavailable`. Twenty concurrent claims of one voucher make
  one notice. When two vouchers are claimed at once and the first notice fails, the second is still
  sent.
- An address change on an unclaimed voucher queues a new `gift` delivery; no other change does.
- The page draws each state and Retry, and a non-admin gets 403 on the new route.

**One real email of each kind**, to `hello@spideryarn.com` (the configured admin address, which
forwards to Greg) and nobody else. It comes from a scratch script that calls the two message
builders and `sendEmail` with `SPIDERYARN_EMAIL_SEND=1`, not from a local claim, which would email
whatever address the local admin account has.

## Simpler options passed over

- **No stored state: send once from the creating request and once from the claiming one.** That is
  usually at most once, but a failure leaves nothing for the page to show, which Greg asked for, and
  a replay or a crash is unguarded.
- **Six status columns on the voucher instead of a table.** That was the first draft. Latest-state
  columns cannot say which event they describe, and an address change needs a second gift email.
- **Awaiting the send inside the admin's create.** The page would be simpler, but the request is no
  safer against a retry, and it breaks email.md's rule (Sol F6).
- **Falling back to `hello@` when the creator cannot be found.** Sol F4: that address is not known
  to be theirs.

## Stages

1. Server: the migration, the schema, `src/store/pg-voucher-emails.ts` (queue, reserve, complete,
   retry, list), the two messages, `html` and `idempotencyKey` on `sendEmail`, the create, claim
   and patch wiring, the Retry route and the list field, with tests.
2. Client: the minted id, the Status cell, Retry and the delayed re-read, plus `/privacy`, with
   tests and a browser check of the page.
3. Docs (email.md, billing.md, admin.md), the Sol code review, the gates, the push and the note.

## Log

- 2026-10-01: plan written. The prior-work check found nothing beyond 261001m (the live session
  `fbvp4mdn-voucher-emails` is this one).
- 2026-10-01: GPT Sol plan review ([answer](261001p-voucher-emails-plan-review-sol.md)): *rethink*,
  eight findings, all taken. The design above is the second draft.
  - F1: recovering a stuck send could send twice → Resend's idempotency key on a per-delivery id,
    and a completion that must match the attempt.
  - F2: a replayed create made a second voucher → a browser-minted id.
  - F3: a second Retry after a success sent again → `sent` is never retried, and an address change
    is its own delivery.
  - F4: the `hello@` fallback → send nothing.
  - F5: bookkeeping failures → defined states, and tests.
  - F6: the awaited send → after the response.
  - F7: no note in the claim email.
  - F8: one task per delivery.
- 2026-10-01: GPT Sol second plan review ([answer](261001p-voucher-emails-plan-review-2-sol.md)):
  *build with changes*. Five of the eight closed; all new findings taken, and they supersede the
  design above where they differ:
  - **Each provider request is frozen when it is queued**: the row carries `recipient`, `subject`,
    `body_text` and `body_html`, and the send reads only the row. A claim notice's recipient is
    filled once, on the first successful creator lookup. Resend refuses a key reused with a
    different body (`409 invalid_idempotent_request`), so a retry must be the same request. The
    address is now in a second table, so the foreign key cascades on delete.
  - **`attempt_started_at`**, set by the reservation, is what *stale* is measured from, so two
    retries of an old queued row cannot both win.
  - **Event-time eligibility**: the automatic send does not re-check the voucher, so an address
    change that committed is sent even if a claim lands a moment later. Revoking moves the
    voucher's still-queued gift deliveries to `skipped: voucher revoked`; only Retry checks live
    state.
  - An address change queues a delivery only when the normalised address actually differs.
  - The replayed create compares every stored field exactly, and queues only when it inserted.
  - Delivery ids come back from the transaction and are scheduled outside it.
  - The claim's contract, stated plainly: the claim and its queued notice commit together, so a
    failed queue insert rolls the claim back, the plan is still served, and the next visit tries
    again.
- 2026-10-01: **built and landed** in `374ea318a` (server), `b743dd3b9` (client) and `b68513105`
  (review fixes and docs). The migration was regenerated as `20261001191310_billing_voucher_emails`
  after go-deeper's `dig_deeper_bucket` landed first (identical SQL; applied locally). Beyond the
  plan: a gift Retry also requires the voucher still to have the address the delivery was frozen
  with; an address change moves still-queued gift emails for the old address to `skipped: address
  changed`; and the Resend error-name allowlist was checked against Resend's live errors page.
  - **GPT Sol code review** ([answer](261001p-voucher-emails-code-review-sol.md)): *conditional
    approve*, six findings, all fixed by the reviewer and read here. A superseded attempt now stops
    before calling Resend (checked again after the creator lookup), and a concurrent-key 409 stays
    `sending` rather than claiming failure. A thrown send keeps only its error class and is shown
    as *may or may not have gone*, and the Resend response id is no longer logged. Retry also has a
    same-tick guard, and nothing re-reads after unmount. Its sandbox could not reach Postgres; the
    lead ran those suites: 563 passed across ten files, and typecheck is green.
  - **Browser check** (Playwright, system Chrome, 390 and 1280): create, Retry (one request even on a
    double-click), address change (a new delivery row, checked in the database), revoke (Retry
    gone), no sideways page scroll at either width, no console errors. The *Email to you* line
    after a real claim was not exercised in the browser; the tests cover it.
  - **Real sends**: one of each kind to `hello@spideryarn.com` only, both accepted by Resend.
