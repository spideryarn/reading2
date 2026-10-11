---
reports: spya-cfbp0q, spya-dkddku
ending: shipped
comment: Pasting "Name <email>" into a voucher's address box now keeps the address and fills an empty name. Several vouchers to one person always added up; a test now holds it, and the form says when an address already has gifts.
---
# /admin/vouchers: paste `Name <email>`, and several vouchers to one person add up

Two admin reports from Greg (`feedback-reporter.ts` exit 0 on both), both suggestions, filed
2026-10-11. Overseer queue item `qi-x3ndt2yw`. This session had no Sentry sign-in and did not write
the Sentry status; the next feedback sweep does.

`spya-cfbp0q` (#549, `SPIDERYARN-READING2-GY`), 00:57 UTC from `/admin/vouchers`, build `00081085`:

> If I paste in a combination name and email address (e.g. `Firstname Lastname <firstname@example.com>`
> into the email address, accept that - keep just the email address, and immediately populate the
> name if it's empty.
>
> — Greg, 2026-10-11

`spya-dkddku` (#557, `SPIDERYARN-READING2-H6`), 01:37 UTC from `/`, build `2c38ec32`:

> It should be possible to send multiple gift vouchers to the same person and they're additive.
>
> — Greg, 2026-10-11

## What we did

Both shipped to `dev`; the plan, GPT Sol's two reviews and the reasoning are
[261011k](../plans/261011k-vouchers-paste-name-and-address-several-to-one-person-add-up.md).

- **The paste.** Every address box on the page that sits beside a name box — the new voucher, a
  waiting voucher's Edit, an author gift's draft — turns `Name <address>` (or `"Name" <address>`)
  into the address, and fills *Their name* only if it is empty. Anything not that shape is left as
  typed, for the server to judge as before.
- **Additive.** It already was: nothing stops two vouchers to one address, the claim takes all of
  them, and the Free allowance is the base plus their sum (20 then 10 raise it from 3 to 33
  articles, for good; revoking one takes back only its own). A test now holds that, and the form
  says *"This address already has 2 gifts (30 articles). This one adds to them."* when it does.
