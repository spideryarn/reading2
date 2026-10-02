---
reports: spya-x9taw3
ending: shipped
---
# Gifts visible on /profile, and the plan explained on both pages

Report `spya-x9taw3`, a suggestion, from Greg (admin), 2026-10-01, dispatched by the Overseer on
2026-10-02 with no Sentry mirror, on `/`:

> If a user has received a gift voucher, then make that a bit more visible in the profile, a little
> bit like you do already on the logged in homepage.
>
> Make sure there are tooltips and stuff in both cases that are linked to the pricing page and
> explain the model and when the monthly limits will reset and what they'll reset to. Just generally
> make sure that as much as possible it's clear to the user where they stand and how it works and
> what will change.
>
> Maybe make these be reusable UI components across both these places. Use your judgment.

**Ending: Shipped**, on `dev`. Plan
[261002b](../plans/261002b-voucher-note-to-recipient-gift-on-profile-whole-dollar-spend.md) § Stage 2.

What changed: `/profile` now shows a gift in a highlighted panel: how many articles, when it was
added, and whether it counts now or is waiting until the reader is on Free. Both `/profile` and the
homepage box have an (i) beside the plan. Hover it to see where you stand; click it to go to Pricing.
Both also have a *How … works* section. For a paid plan, these say when the month's allowance starts
again and what it goes back to. All three pieces are shared components (`src/web/PlanHelp.tsx`).
