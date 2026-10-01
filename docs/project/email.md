# Email: Resend, one domain, one key

Up: [architecture.md](architecture.md)

Spideryarn sends two kinds of email, both through Resend with one key and one domain: **auth
email**, which Supabase sends over SMTP, and **the server's own**, which goes through
[`src/email.ts`](../../src/email.ts) — today only notices to us about sign-ups and upgrades
([§ Mail the server sends itself](#mail-the-server-sends-itself)). Anything new that sends mail
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

**A password reset cannot complete in the app yet.** There is no "Forgot password?" link and no
set-a-new-password screen. A reset sent from the dashboard lands as an implicit-flow link that our
PKCE client refuses. That is why the recovery email says only "Continue to Spideryarn", rather than
promising a reset or a completed login. The plan above has the measurement and the deferred build.

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

The two notices, and why each fires when it does:

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

**Both are best-effort.** A crash between the commit and the send loses that notice for good; it is
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

## See also

- [auth.md](auth.md): what the confirmation email is for, and the sign-in flow around it
- [website-text.md § The contact address](website-text.md#the-contact-address): why the sender is
  `hello@`
- [`scripts/supabase-auth-config.ts`](../../scripts/supabase-auth-config.ts): the `smtp` and
  `templates` commands
