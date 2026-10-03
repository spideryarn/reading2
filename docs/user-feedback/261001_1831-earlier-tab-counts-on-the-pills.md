---
reports: spya-yj2vdr
ending: shipped
---
# The Earlier tab's pills say how many

Report `spya-yj2vdr`, [SPIDERYARN-READING2-95](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-95),
from Greg (admin), 2026-10-01 18:31 UTC, relayed by the Overseer (queue item `qi-r6hhx6ma`), build
`43be719b`:

> In Feedback / Earlier / Not shipped, it says at the bottom "Showing your 50 most recent."
>
> Is that true? Are there >50 not shipped?
>
> Perhaps include a number/badge in the tab-pills for Shipped and Not shipped?

**Ending: Shipped**, on `dev`. Plan
[261003b](../plans/261003b-earlier-tab-counts-on-the-pills.md).

**Was it true? Yes.** The line appears only when the filter matched more than 50. A read-only count
of production's feedback rows (all 345 are Greg's) under the shipped map in build `43be719b` gives
115 not shipped. Under `main`'s map on 2026-10-03 it is 40, so the line no longer appears there.

What changed: each pill now carries its count (`All 345 · Shipped 305 · Not shipped 40`), and when
the list is cut short it says how many there are: "Showing the 50 most recent of your 115
not-shipped reports."
