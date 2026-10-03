---
reports: spya-mafmm6
ending: shipped
---
# Quiz: how much you have read, as a small pie chart

A suggestion from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0), sent from
Remember → Quiz on `what-if-we-had-bigger-brains-imagining-minds-beyond-ours` on 2026-10-01, and
picked up from the Overseer queue as `qi-kvr8h559`. This session had no Sentry sign-in; the report
text came in the brief, and the next sweep does the Sentry write from this note.

> In Quiz mode, instead of "about X% of the piece read so far", use a little pie-chart or sparkline,
> with a rich tooltip (see tooltips.md).
>
> And make a note in design.md or similar to prefer little charts/icons/etc rather than text.

**Ending: Shipped.** On `dev`, not deployed.

## What we did

[Plan 261003e](../plans/261003e-quiz-read-so-far-as-a-small-pie-chart.md), with GPT Sol reviews of
the plan and the code.

- The sentence is now a 14px pie beside **Only what I've read** (`src/web/SharePie.tsx`, generic for
  the next share of a whole). Its card says "About 40% of the piece read so far" and how that is
  counted. It is a button, so a tap and the keyboard open the card as well as hover. The slice is
  the exact share, so "under 1%" and "over 99%" are told by the card's words.
- The design note is
  [design-css-overview.md § Draw a number rather than print it](../project/design-css-overview.md),
  with both of Greg's quotes on this (2026-08-31 and this one).

Nothing deferred: both halves are built. A per-section strip of what you have read was considered
and not built, because it wasn't asked for and the spine already draws it.
