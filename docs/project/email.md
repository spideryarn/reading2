# Email: Resend, one domain, one key

Up: [architecture.md](architecture.md)

Spideryarn sends two kinds of email, both through Resend with one key and one domain: **auth
email**, which Supabase sends over SMTP, and **the server's own**, which goes through
[`src/email.ts`](../../src/email.ts) — notices to us about sign-ups and upgrades
([§ Mail the server sends itself](#mail-the-server-sends-itself)), and since 2026-10-01 the two
emails a gift voucher sends, the first we send to somebody who is not yet a reader
([§ Gift voucher emails](#gift-voucher-emails)), and since 2026-10-02 a note to a reader that
their feedback is live, sent by the deploy rather than the server
([§ Feedback that shipped](#feedback-that-shipped)). Anything new that sends mail
should go through `src/email.ts` rather than add a second way or a second provider.

**Auth email — sign-up confirmations, password resets, magic links — goes out through
[Resend](https://resend.com), from `Spideryarn <hello@spideryarn.com>`, since 2026-09-29.** Before
that it went through Supabase's built-in sender, which is capped at **2 emails an hour for the whole
project**. With `mailer_autoconfirm` off, the third email sign-up in any hour got no confirmation and
could not sign in.

- **Resend account:** `gregdetre` (log in as greg@gregdetre.com), free plan, one domain,
  `spideryarn.com`, region eu-west-1.
- **Not through the Vercel Marketplace.** That was the first choice; its "Connect Account" step
  failed three times with "The installation could not be started." and nothing more. So the key is an
  ordinary one, pasted into Vercel's env vars by hand.
- **DNS is at Namecheap** ([deployment.md § The domain](deployment.md#the-domain)): a DKIM TXT on
  `resend._domainkey`, CNAMEs on `send` and `rsend`, and a DMARC TXT on `_dmarc`. No Resend MX
  record was added at the apex, so Namecheap's Email Forwarding stays in place and `hello@` still
  forwards. An agent's DNS edits are blocked by the permission classifier, so DNS changes are Greg's
  to make by hand.
- **`RESEND_API_KEY`** is a "sending access" key scoped to `spideryarn.com`. The same key is in
  Vercel (all three environments), `.env.local` and `.env.prod` on the laptop, and on the box — its
  `.env.local` via `push-env`, and its `.env.prod` appended by hand, because `push-env` never sends
  that file. It is also Supabase's SMTP password.
- **Supabase's side is a script, not dashboard clicks:**
  `npx tsx scripts/supabase-auth-config.ts smtp` writes host `smtp.resend.com:465`, user `resend`,
  the sender, and a limit of 30 emails an hour, then reads them back. Resend's free plan allows 100 a
  day, so that is the real ceiling.
- **To check it works**, trigger a real Supabase Auth email — for example, a password reset for an
  existing account — and look for it in Resend's Emails log and the destination inbox. A 200 from
  the config API, or a direct send through Resend's API, does not exercise Supabase's SMTP settings.
  Done on 2026-09-29: a direct API send and a Supabase "Reset your password" to greg@gregdetre.com
  both showed Delivered in Resend's log, and the first reached the inbox.

## The words: two templates of our own

> The auth emails still use Supabase's default wording. … Rewrite them in Spideryarn's voice and using
> Spideryarn's branding. Keep things simple and reliable.
>
> — Greg, 2026-09-30

**The sign-up confirmation and the password reset are ours**:
[`supabase/templates/confirmation.html`](../../supabase/templates/confirmation.html) and
[`recovery.html`](../../supabase/templates/recovery.html), with their subject lines in
`supabase/config.toml` (`[auth.email.template.confirmation]`, `[…recovery]`). That file is the one
home for the subjects: the local stack reads it, and
`npx tsx scripts/supabase-auth-config.ts templates` sends the same subjects and HTML to the hosted
project and reads them back. **Whether production has them is a question for `show`**. The
templates were written on 2026-09-30 and not applied by the session that wrote them, because that
is a production write:
[260930h](../plans/260930h-auth-emails-in-spideryarn-s-voice.md) has the steps.

Three rules the HTML keeps; the production writer refuses the first two when they are broken, and
`tests/auth-email-templates.test.ts` pins them:

- **The button's link is `{{ .ConfirmationURL }}`, verbatim, and nothing else.** GoTrue builds it,
  so the redirect allow-list still decides where a one-time code may be sent.
- **No other template value**, so nothing a person typed reaches the HTML.
- **Inline styles, table layout, system fonts, one image** (the spider, from the live site, with the
  word beside it so a blocked image loses nothing). Mail clients drop what a web page relies on.

The other four GoTrue emails (magic link, email change, invite, reauthentication) are still
Supabase's, because the app sends none of them.

**A password reset completes in the app since 2026-10-01.** "forgot your password?" on the sign-in
form asks for the email, and the link lands on a screen that sets a new one
([261001i-password-reset.md](../plans/261001i-password-reset.md)). So the recovery email is now
"Reset your Spideryarn password", with a "Choose a new password" button. **Production has the new
words only after `npx tsx scripts/supabase-auth-config.ts templates` is run**, after the code is
deployed. A reset sent from the Supabase dashboard is still an implicit-flow link that our PKCE client
refuses, so it lands signed out; readers' own requests are the ones the words are for.

## Mail the server sends itself

> We had talked in the past about sending out an email to me (the admin user, e.g. to
> hello@spideryarn.com ) whenever a new user signs up and whenever a new user upgrades their pricing
> plan. […] Make sure that we have nice reusable machinery for dealing with email where it makes
> sense to do so.
>
> — Greg, 2026-09-30

[`src/email.ts`](../../src/email.ts) is the machinery: `sendEmail` (one plain-text email, through
Resend's HTTP API, from the same `hello@` sender) and `notifyAdmin` (the same, to us). Built in
[260930i](../plans/260930i-email-admin-on-sign-up-and-plan-upgrade.md). What a caller can rely on:

- **It never throws.** Every outcome is a value — `sent`, `skipped` or `failed` — and a failure is
  also logged under the `email` component. A notice must never fail the request or the payment it is
  about, so the callers send **after** the thing has been recorded.
- **Only production sends.** Anywhere `VERCEL_ENV` is not `production` it logs that it would have
  sent and returns `skipped` — the box's `.env.local` carries the real key, so otherwise every local
  sign-up and test-mode checkout would mail a real inbox. `SPIDERYARN_EMAIL_SEND=1` opts a process
  in for a deliberate manual check, and is ignored under vitest. Tests also refuse `api.resend.com`
  at the network (`tests/setup/provider-guard.ts`).
- **The admin address** is `SPIDERYARN_ADMIN_EMAIL`, and defaults in code to `hello@spideryarn.com`,
  which forwards. No env file carries it; set it only to send somewhere else.
- **Neither the recipient nor the body is logged**, only a label naming the kind of mail.
- **A request never waits for Resend before it is answered.** `src/after-response.ts` starts these
  notices after the routed callback has ended its response, then keeps the serverless invocation
  alive until they settle. A direct non-HTTP caller waits normally rather than dropping the mail.

The three notices, and why each fires when it does:

- **A sign-up** is an account's **first authenticated request**, because the server never sees a
  sign-up — that is Supabase Auth in the browser. `spideryarn.reader_arrivals` is the ledger: its
  primary key hands the row to exactly one request across every instance, and that request sends
  the mail, after its route has answered ([`src/arrivals.ts`](../../src/arrivals.ts)). An email
  sign-up that is never confirmed is never announced. The migration backfilled every account that
  existed, so shipping it announced nobody — including the first real reader, who signed up five
  minutes before that deploy began, which is why the admin heard nothing (SPIDERYARN-READING2-79,
  [261001b](../plans/261001b-sign-up-mail-retried-when-a-send-fails.md)).
- **An upgrade** is decided inside `syncSubscriptionFromStripe`, under the lock it already holds, by
  `planUpgrade` in [`src/billing/tiers.ts`](../../src/billing/tiers.ts): free → paid, or a smaller
  → larger plan. Renewals, recoveries from `past_due` or `unpaid`, downgrades and cancellations send
  nothing. Because the transition is read against the row it replaces, a redelivered webhook or the
  confirm route racing it cannot send twice — [billing.md](billing.md).

- **A reader's feedback**, since 2026-10-02 ([261002j](../plans/261002j-email-the-admin-each-reader-s-feedback.md)):
  every newly created report whose owner is not an admin, after the reader's `POST /api/feedback`
  has been answered — [`src/feedback-notice.ts`](../../src/feedback-notice.ts). It is the first
  admin notice to carry **a reader's own prose**, so the words are quoted line by line (so they
  cannot pass for our lines), defanged (`https[:]//`, `www[.]` — best effort: a bare domain or an address may still be linked by some client),
  and kept out of the subject; the page address stays live only on our own origin. **It has its
  own cap, because this is the one notice a reader can trigger at will:** at most 20 in any 24 hours
  across every reader and 5 from any one, taken from the `feedback-notice` bucket of the shared
  rate-limit table (`FEEDBACK_NOTICE_POLICY` in [feedback-notice.ts](../../src/feedback-notice.ts), counted by
[pg-rate-limit.ts](../../src/store/pg-rate-limit.ts)),
  which counts mails attempted, atomically, rather than reports filed. Resend's 100 a day is shared
  with auth mail, and one reader at the feedback hourly cap of 30 would otherwise spend it in under
  four hours. Every mail says the cap exists; `/admin/feedback` is the full record. **The cap fails open**: if the allowance cannot be read — the database down, or the bucket's migration not yet run, whose CHECK then refuses the row — the mail is sent uncapped and a warning logged, because missing a report is the worse mistake at this volume.

**All three are best-effort.** A crash between the commit and the send loses that notice for good; it is
logged, and `/admin` is the record. A sign-up whose send fails (or finds no key in production) gives
its ledger row back, so the reader's next request tries again — at the cost of a possible duplicate,
and with two double faults still able to lose it
([261001b](../plans/261001b-sign-up-mail-retried-when-a-send-fails.md)). An upgrade's failed send is
not retried.

**Both carry the reader's address**, the account id, and a link to `/admin/users`, the page that
lists every account. They did not until 2026-10-01:

> Yes, please include the newly-signed-up user's email address in the email to me, and include a
> link to the /admin page that lists all the users
>
> — Greg, 2026-10-01

The cost that kept it out is still true — each copy in Resend's log, the forwarder and an inbox is
one more place an erasure has to reach — so /privacy says we email ourselves the address. The
sign-up takes it from the verified token; the upgrade asks the Auth Admin API, because the deployed
server cannot read `auth.users` ([admin-accounts.ts](../../src/store/admin-accounts.ts)), and a
failed lookup says so in the mail rather than stopping it. The address is the reader's own text, so
it goes through `oneLine` in `src/email.ts` and never into a subject —
[261001b](../plans/261001b-admin-sign-up-email-carries-the-address.md).

**Where the existing mail paths get a reader's address.** There is no address on our own tables;
Supabase Auth holds it. The two paths are:

- **Inside a signed-in request**: the verified user the auth wrapper hands the route
  ([`src/routes.ts`](../../src/routes.ts) passes `user.email` to `noteArrival` in
  [`src/arrivals.ts`](../../src/arrivals.ts)).
- **Anywhere else** (a webhook, a job): `accountEmail(ownerId)` in
  [`src/store/admin-accounts.ts`](../../src/store/admin-accounts.ts), which asks the Auth Admin API
  and never throws — it answers `found` or `unavailable` with a reason.

Sending is `sendEmail` or `notifyAdmin` in `src/email.ts`. Their `SendResult` (`sent`, `skipped`,
`failed`) lets each caller decide whether to retry; the sign-up notice's give-the-row-back retry
above is the one worked example.

## Gift voucher emails

> The gift voucher should definitely email the recipient. And I want an email when they claim it.
> No need for expiry.
>
> — Greg, 2026-10-01

Two emails per voucher ([billing.md § Gift vouchers](billing.md); plan
[261001p](../plans/261001p-voucher-emails-to-recipient-and-creator.md), and two rounds of GPT Sol
review that reshaped it):

- **To the recipient**, when the voucher is made and again when an unclaimed voucher's address
  actually changes: *A gift of N free articles on Spideryarn*, HTML in the auth templates' shape plus
  a plain-text part. **Never the private note or the creator.** It may carry a **note to them**
  (`recipient_note`), unlabelled and in italics (the text part sets it on its own lines), placed under
  the heading, above our words, in both letters; Greg signs it himself, and `/admin/vouchers` reminds
  him to
  ([261002b](../plans/261002b-voucher-note-to-recipient-gift-on-profile-whole-dollar-spend.md)). It
  is the one value in the email we did not write, so it is untrusted on render: `noteText`
  ([`src/email.ts`](../../src/email.ts)) makes its line breaks plain and its other control characters
  spaces, and the HTML part escapes it. Never in the subject. Editing it re-sends nothing; an address
  change sends the note as it then stands. It is one of two letters, chosen before the
  event's transaction by `giftAudienceFor` ([261002a](../plans/261002a-fb99-voucher-email-for-existing-user.md)):
  - **An existing reader** — exactly one account with that address *confirmed*, found in the same
    count-checked account list `/admin/users` reads — is told the articles they had left on Free and
    have with the gift (the wall's own `ingestHeadroom` arithmetic), or on a paid plan that the gift
    waits for Free; the link is `https://www.spideryarn.com/`.
  - **Anybody else** — no account, an unconfirmed or duplicated one, or a lookup that failed — gets
    the invitation, which explains Spideryarn and links to `/login`. It is true for a reader too,
    which is why it is the answer to any doubt.
- **To the voucher's creator**, when it is claimed: plain text, the claimant's address and account
  id, the articles, and when. The address is `accountEmail(created_by)`; if that lookup fails,
  **nothing is sent** (`failed: creator address unavailable`, retryable), because `hello@` is not
  known to be the creator's. **Not the note** either: the page has it, and each copy in Resend, the
  forwarder and an inbox is one more place it lives.

**Each email is a row of `billing_voucher_emails`, queued in the transaction of its event** (the
create, the claim, the address change), so the event and its email commit together and nothing about
sending happens inside that transaction. The row **freezes the request**: recipient, subject and both
bodies. A claim notice's recipient is filled once, on the first successful creator lookup. Sending
reads only the row, after the response, in three steps in
[`src/store/pg-voucher-emails.ts`](../../src/store/pg-voucher-emails.ts):

1. **Reserve**: one `UPDATE … RETURNING attempts` moves it to `sending`, bumps `attempts` and stamps
   `attempt_started_at`, so of any number of contenders one wins. The automatic send reserves only a
   `queued` row; Retry may also take `failed`, `skipped`, or a `sending` whose attempt started over
   ten minutes ago — **never `sent`**. A gift's Retry also needs its voucher unrevoked and still at
   the address the email was frozen with, **claimed or not**: an existing reader claims the moment
   they open Spideryarn, so refusing after a claim made their failures permanent (261002a). Retry's
   predicate is one SQL fragment, which also gives the page its `retryable` flag.
2. **Send**, with `Idempotency-Key: voucher-email/<row id>`. Resend keeps a key for 24 hours and
   answers a repeat with the first result, so retrying a send that Resend did accept (a timeout, a
   crash before step 3) does not send it twice within that window. The same key with a different
   body is `409 invalid_idempotent_request`, which is why the request is frozen.
3. **Complete**, only if the row is still `sending` on this attempt.

**What this costs.** The recipient's address is now in a second table, so the foreign key cascades on
delete and an erasure of the voucher reaches it. A Retry more than a day after an ambiguous attempt
can send a duplicate; the page says *may or may not have gone* on a stuck send. Revoking a voucher
moves its still-queued gift email to `skipped: voucher revoked`. A replayed create is the same create:
the browser mints the voucher's id, so a retried POST finds the voucher it made and queues nothing.

**Click tracking is unverified.** The one link holds no secret, so a rewritten link would still land
on `/login`, by way of Resend. Our key is send-only (`GET /domains` answers 401
`restricted_api_key`), so whether tracking is off can only be read in Resend's dashboard (Domains →
spideryarn.com → Configuration).

**Proved once for real** on 2026-10-01: both messages, built by the code above, were sent through
`sendEmail` with `SPIDERYARN_EMAIL_SEND=1` to `hello@spideryarn.com` only, and Resend accepted both
(ids `01a0f8db-5dcd…` and `01a0f8db-5e8c…`). Arrival in the inbox was not checked from here.

## Feedback that shipped

> When someone (other than an admin - I will already be aware) has submitted a Feedback report that
> gets shipped & deployed, send them an email to let them know their feedback is now live!
>
> — Greg, 2026-10-02

**The last step of `npm run deploy`**, and only when the code is live and verified:
[`scripts/feedback-shipped-emails.ts`](../../scripts/feedback-shipped-emails.ts) reads the reports
whose note says `shipped` in `src/feedback-endings.generated.ts` at the commit just deployed, and
emails each one from a reader that the ledger `spideryarn.feedback_shipped_emails` has not already
emailed — one email per report. That is the same moment the Feedback dialog's Earlier tab starts
saying *shipped* ([feedback.md § Shipped or not](feedback.md)). It **reconciles rather than diffs**,
so a deploy whose step did not run, or died part way, is caught up by the next. Plan:
[261002f](../plans/261002f-email-readers-when-their-feedback-ships.md).

- **Never an admin**, never a report id two owners share, and only to the account's **current,
  confirmed** address (not deleted, not banned), read from `auth.users` at send time. The ledger
  stores no address, and cascades with its `feedback` row.
- **Plain text, and no word of the report**: its kind and the day it was filed. `/privacy` names
  this email; the button's hover card says *"so we can write back"*.
- **The ledger's three states.** `sent` is never sent again. `failed` (Resend refused, or no key) is
  retried by the next deploy. `sending` is in flight, or a send that may have gone (the request
  threw), or a crash mid-send; every deploy lists it as needing a person, who checks Resend's log
  and then runs `--retry <owner_id>/<report_id> --send` or marks the row `sent`. A retry cannot take
  a fresh in-flight reservation; an interrupted one becomes retryable after ten minutes. Resend's
  stable, opaque `Idempotency-Key` makes a retry within a day safe without sending either internal
  id to Resend.
- **More than 20 letters in one run sends none** unless a person passes `--cap`, and a map line it
  cannot parse is an error, not "nothing shipped" — the two ways a bug could become a mass mailing.
- **A failure is an after-the-fact check** (`AFTER_THE_FACT_CHECKS`): the deploy goes red, says the
  code is live, and never offers a rollback for it.
- **To look**, `npx tsx scripts/feedback-shipped-emails.ts` is a read-only dry run against
  production and `origin/main`; `--sha` names another commit, `--send` sends.

## See also

- [auth.md](auth.md): what the confirmation email is for, and the sign-in flow around it
- [website-text.md § The contact address](website-text.md#the-contact-address): why the sender is
  `hello@`
- [`scripts/supabase-auth-config.ts`](../../scripts/supabase-auth-config.ts): the `smtp` and
  `templates` commands
