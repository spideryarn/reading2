---
reports: spya-yfw7b3
ending: shipped
---
# No sign-up email for Cody Dong

[SPIDERYARN-READING2-79](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-79), a problem
reported by Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0) from `/admin/users` on
build `fe57a1ea`. The time in the file name is the feedback row's `created_at` (22:42:41Z), in
London time.

> It looks like we've had at least one signup (from Cody Dong) - but I don't think I received an
> email notifying me

**Ending: Shipped** to `dev`, but mostly as an explanation. **Cody's silence was correct**: he signed
up at 17:42Z on 2026-09-30, five minutes *before* the deploy that created `reader_arrivals` began
(17:47Z). That migration backfilled every existing account, him included — his row carries his
account's creation time to the microsecond, which only the backfill writes — so he counted as an
existing reader. No account has been created since, so the sign-up mail has not yet been sent for
real. Evidence, and GPT Sol's check of it, in
[261001b](../plans/261001b-sign-up-mail-retried-when-a-send-fails.md).

What shipped anyway: the check turned up a way the *next* sign-up could go silent. A Resend failure
came back as a value that nothing looked at, so the ledger row stayed and that reader was never
announced. Now a failed send gives the row back, and the reader's next request tries again. Needs a
deploy; no migration.

**For Greg:** a test sign-up (a `+alias` address, confirmed, one page load) is the one way to see
Resend → `hello@` → your inbox work end to end.
