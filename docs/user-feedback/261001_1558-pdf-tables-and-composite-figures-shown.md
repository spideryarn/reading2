---
reports: spya-pawfwx
ending: shipped
---
# A PDF's tables show their cells, and its multi-panel figures are recovered

Sentry `SPIDERYARN-READING2-8P`, report `spya-pawfwx`, from Greg (provenance checked with
`scripts/feedback-reporter.ts`: the production row is an administrator's), 2026-10-01, on a
JCO paper imported as a PDF:

> Why didn't these tables or figures import correctly?

**Ending: Shipped**, on `dev`. Tables: `d77e138ee`, with the review fixes in `c4d75d727` and
`9f5f3eb8b`. Figures: `e033539f5`, with the review fixes in
`9a984e75d`. The plan, with the measurements, is
[261001q](../plans/261001q-pdf-tables-and-composite-figures.md), and the class is written
up in the postmortem
[261001b](../postmortems/261001b-pdf-tables-and-figures-withheld-by-a-one-thing-rule.md).

What was wrong, in plain words:

- **Tables.** The model copies every table's cells, but the page-builder only ever drew
  the caption. Every table in every PDF import was a caption over an empty box. Now the
  cells are drawn as a table, and a number in a cell that is nowhere on the page is
  caught by the check, as it would be in prose.
- **Figures.** All three were multi-panel: six photos in a grid, three charts in one
  frame, eight blot strips. Each way of recovering a figure assumed one figure is one
  picture, so a composite got nothing, even though the model pointed at each one
  correctly. Now the model's box is rendered from the page, once the page shows the box
  belongs to that caption. On this paper all three figures come out whole. In production,
  26 of 36 PDF figures had no picture before this change.

Greg's two decisions are in the plan:
*"I don't care about re-importing the broken article as much as fixing things so that
future articles will be correct"*, and, choosing how far to go on figures, *"I'd rather
accidentally pull in a bit of extra stuff that got included within the bounding box than
have no figure imported at all"*.

**This article is not re-imported**: that is a production write, and Greg's call. Once the
fix is deployed, the figures come back by re-running only the assets stage on
`jco-2005-01-libre-spya-hk9cc7` (no re-extraction, no new block ids). The tables need a
re-extraction, which also gives each table block a new id.
