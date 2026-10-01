---
reports: spya-ewbgcx
ending: shipped
---
# Email the admin on each sign-up and plan upgrade

[SPIDERYARN-READING2-6T](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6T), a suggestion
from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0), sent from Trajectory on
`pmc13013618-spya-uekgh6`. The time in the file name is when this session picked the report up. It
had no Sentry access and the report text came in the brief, so there is no `reports:` header yet;
the next feedback sweep adds it from the issue's `report_id` tag.

> We had talked in the past about sending out an email to me (the admin user, e.g. to
> hello@spideryarn.com ) whenever a new user signs up and whenever a new user upgrades their pricing
> plan. We've just enabled resend and the resend API key, so I'm hoping that this should be doable
> now. Make sure that we have nice reusable machinery for dealing with email where it makes sense to
> do so.

**Ending: Shipped** to `dev`, and **not yet live**: it needs a deploy, which also applies one
additive migration (`reader_arrivals`, backfilled from every existing account, so nobody already
signed up gets announced). Resolve 6T; the next feedback sweep does the Sentry status write.

What changed:

- **`src/email.ts`** is the machinery: `sendEmail` and `notifyAdmin`, through Resend's HTTP API with
  the key and sender auth mail already uses. It never throws, and it **sends only in production**.
  The admin address is `SPIDERYARN_ADMIN_EMAIL`, defaulting in code to `hello@spideryarn.com`, so no
  env file changed.
- **A sign-up** mails "New sign-up on Spideryarn" on an account's first signed-in request. The
  server never sees the sign-up itself, so an email sign-up that is never confirmed is never
  announced.
- **An upgrade** (free → paid, or a smaller → larger plan) mails "Plan upgrade: Free → Spideryarn
  Reader", from the one function every Stripe path goes through, at most once per change.
- **Neither mail carries the reader's address**, only the account id and a link to `/admin`. GPT
  Sol's plan review argued for this on privacy grounds. If you want the address in the sign-up mail,
  it is one line in `src/arrivals.ts` and a sentence on `/privacy`.
- Both are sent after the response, so neither a reader nor Stripe waits on Resend, and a failed send
  is logged, never an error.
- `/privacy` now lists Resend, which has carried auth mail since 2026-09-29 and was missing. Its
  Stripe line still says payments are "not switched on yet", which is out of date and was left for
  you.

To check it once deployed: sign up with a new address and confirm it, and see the mail reach
`hello@`.

Plan, both GPT Sol reviews and the deferred list:
[260930i-email-admin-on-sign-up-and-plan-upgrade.md](../plans/260930i-email-admin-on-sign-up-and-plan-upgrade.md).

## Follow-up, 2026-10-01: the address is in, and the link goes to every user

> Yes, please include the newly-signed-up user's email address in the email to me, and include a
> link to the /admin page that lists all the users
>
> — Greg, 2026-10-01 (relayed by the Overseer)

**Shipped** to `dev` in `1f6ae0d7` and `de0521c3`, **not yet live**: it needs a deploy, with no
migration.

- **Both mails** now say `Email: <address>` above the account id, and link
  `https://www.spideryarn.com/admin/users` (the page listing every account) instead of `/admin`.
- **Sign-up** takes the address from the reader's verified sign-in token. **Upgrade** has no
  signed-in reader (it comes from Stripe), so it asks Supabase's Auth Admin API for that one
  account; if that fails, the mail still goes and says the address could not be looked up.
- The address is the reader's own text, so it is flattened to one line (it cannot forge a second
  link underneath) and never goes in the subject.
- **`/privacy`'s Resend entry** now says we email ourselves a note with the reader's address and
  account id (and the plans), the first time they use Spideryarn after signing up and on each
  upgrade, through Resend and then Namecheap's forwarding to our inbox.

To check once deployed: the next sign-up mail to `hello@` shows the address and the `/admin/users`
link. Plan and both GPT Sol reviews:
[261001b-admin-sign-up-email-carries-the-address.md](../plans/261001b-admin-sign-up-email-carries-the-address.md).
