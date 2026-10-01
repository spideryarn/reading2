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
