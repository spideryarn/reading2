---
reports: spya-cm0qa7
ending: shipped
---
# Whole dollars in /admin/users' Spend column

Report `spya-cm0qa7`, a suggestion, from Greg (admin), 2026-10-01, dispatched by the Overseer on
2026-10-02 with no Sentry mirror, on `/admin/users`:

> For the spend column on https://www.spideryarn.com/admin/users , round to integer dollars (with
> exact figure as tooltip)

**Ending: Shipped**, on `dev`. Plan
[261002b](../plans/261002b-voucher-note-to-recipient-gift-on-profile-whole-dollar-spend.md) § Stage 3.

What changed: the cell reads `$3`, and hovering shows the exact `$3.1416` with the call count and
month. A real cost under fifty cents reads `<$1` rather than `$0`, so it does not look free.
