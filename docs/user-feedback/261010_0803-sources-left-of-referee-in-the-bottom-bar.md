---
reports: spya-eyaf3n
ending: shipped
comment: Sources now sits to the left of Referee in the bottom bar, and in the command bar's list.
---
# Bottom bar: Sources to the left of Referee

Greg (admin, `feedback-reporter.ts` exit 0), 2026-10-10 08:03 UTC, a suggestion filed from Sources
on `/read/lawrence-kuhn-2024-a-landscape-of-consciousness-spya-hs82mz`. Sentry
SPIDERYARN-READING2-GT (#545). Queue entry `qi-v97rbaws`.

> Sources should be to the left of referee in the bottom bar.

**Ending: Shipped**, on `dev`. Plan
[261011a](../plans/261011a-sources-left-of-referee-in-the-bottom-bar.md).

The two buttons swapped inside their own group, so the separator line before the group now sits
before Sources. Nothing else in the bar moved. The order has one home, `MODES_UI` in
`src/web/Dock.tsx`; the command bar, the More menu and the phone and touch bar all read it, so they
follow. Referee is still behind the experimental switch, so most readers see only Sources there,
as before.
