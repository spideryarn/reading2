---
reports: spya-ax5tmm
ending: shipped
---
# An article opened for the first time starts in Summary, with Marginalia where there is room

`spya-ax5tmm`, from Greg (admin; relayed by the Overseer as his own report), filed 2026-10-04 20:32
UTC from an article. Sentry confirmed it (event `45f3d0f185c2460b86b450d6b336433c`). This session
did not write the Sentry status; the next feedback sweep does.

> When I open an article for the first time, default to Summary/Briefer in left-hand (if there's
> room) and (if there's even more room) Marginalia mode in right-hand

**Ending: Shipped.** It is on `dev` and not deployed.

What we did. When a signed-in reader opens an article this browser has not opened before, at an
address that says nothing about how to look at it:

- with room for a band beside the text (about 700px and up), it opens in Summary, on Brief;
- with room for the notes as well (about 900px and up), Marginalia's column opens on the right too,
  **if the reader's experimental switch is on**, because Marginalia is still behind that switch;
- on a phone it opens as before, the article alone.

It is decided once. Press Plain, leave and come back, and it stays Plain. A link that carries a
passage or a mode is left exactly as sent. Opening this way writes nothing and costs nothing: with no
summary written yet the band says so and offers to write one.

Four choices were made for the simplest version and are questions for Greg in the plan:

- **Q-first-open-no-summary**: it opens Summary even when no summary has been written.
- **Q-first-open-visitors**: signed-out readers of a public article do not get it.
- **Q-first-open-across-devices**: "first" means first in this browser, not first ever.
- **Q-marginalia-switch**: readers with the experimental switch off get Summary only.

One side effect to know: an article already on this browser that was last left in Plain at the top
had nothing remembered, so it gets the default once.

Checked in a browser at 390, 820, 1024 and 1440 on local dev. Not checked on a real iPad or phone,
or in Safari.

Plan: [261005a](../plans/261005a-no-home-icon-beside-the-logo-and-a-first-open-default-of-summary-and-marginalia.md).
