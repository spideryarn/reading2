---
reports: spya-cqjhbn
ending: shipped
---
# The publication date on the Shelf card

`spya-cqjhbn`, from Greg (admin, proven from the production row; relayed by the Overseer), filed
2026-10-04 17:07 UTC from the signed-in homepage. Sentry confirmed it (event
`43ba0a50bf3847e186b9a6fb8751503b`). This session did not write the Sentry status; the next feedback
sweep does.

> Show the publication date in the logged-in homepage Shelf

**Ending: Shipped.** It is on `dev` and not deployed.

What we did: each card's line under the title now carries the date, after the author and the site,
for example `Anil Seth · NOEMA · 14 Jan 2026 · ~35 min · 141 blocks`. A paper dated only to a year
shows the year. A piece with no publication date shows nothing there.

Left as they were:

- **Table view.** Its Published column still starts hidden (with it showing, the table is wider
  than a desktop window); the Columns menu turns it on.
- **The note at the bottom left while sorted by Published** still says "published 14 Jan 2026", so
  under that one sort a dated card says its date twice. **Q-published-note** in the session's
  debrief.

Checked in a browser at desktop, iPad and phone widths on local dev. Not checked on a real iPad or
phone, or in Safari.

Plan: [261005e](../plans/261005e-an-end-of-article-mark-and-the-publication-date-on-the-shelf-card.md).
What is built: [library.md § The card says when the piece was published](../project/library.md#the-card-says-when-the-piece-was-published).
