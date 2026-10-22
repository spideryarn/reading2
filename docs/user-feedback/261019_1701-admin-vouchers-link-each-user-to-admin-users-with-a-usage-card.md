---
reports: spya-qdd2vc
ending: shipped
comment: Each account on /admin/vouchers now links to /admin/users, which marks that row, and the link's card summarises their usage: sign-ins, shelf, comments, chats, searches, opens, plan and this month's model calls.
---
# /admin/vouchers: link each user to /admin/users, with a usage card

An admin report from Greg (`feedback-reporter.ts` exit 0), a suggestion, `spya-qdd2vc` (#616,
`SPIDERYARN-READING2-K8`), 2026-10-19 17:01 UTC from `/admin/vouchers`, build `cb956387`. Overseer
queue item `qi-59zhsqzf`.

> create link from each user to /admin/users , with a tooltip summarising their usage
>
> see tooltips.md
>
> — Greg, 2026-10-19

**Ending: Shipped**, on `dev`. Plan
[261019k](../plans/261019k-admin-vouchers-links-each-account-to-admin-users-with-a-usage-card.md).

What changed: a claimed voucher's claimant (in Status) and a waiting voucher's address, when exactly
one account already holds it, link to `/admin/users?user=<id>`, which marks that row in the whole
table and scrolls to it. The link carries a rich card with the account's usage, read off the same
rows `/admin/users` draws. An address nobody has signed up with stays plain text.
