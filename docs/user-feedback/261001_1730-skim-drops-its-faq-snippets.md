---
reports: spya-bjbcxp
ending: shipped
parts: 2
---
# Skim (then Trajectory) drops its FAQ snippets

[SPIDERYARN-READING2-8Z](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-8Z), report
spya-bjbcxp, a suggestion from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0 — the
row, not the Sentry event, which had no recorded event id), sent from Trajectory at
`https://www.spideryarn.com/read/arxiv-2508-spya-wrzxkg?mode=trajectory&…`, build `43be719b`.

> In Trajectory/Skim mode:
> - Remove the FAQ snippets (they don't add much)
> - Update the fonts to be clear about what's author-generated vs AI-generated (as elsewhere)

**This note is the first half, shipped on `dev`:** the FAQ question no longer sits above the current
stop, and the mode no longer reads the FAQ at all. The terms, ideas and events on the stop's card
stay, and so does the Quiz cue above the quote, which is a different thing. A test pins it. Stage 1
of [261001r](../plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md), which also
renamed the mode to Skim (spya-skxhcz).

**The second half, the typeface**, was routed by the Overseer to the queued
`fb8g-ai-typeface-everywhere` work, and its note will be the other of the two parts.
