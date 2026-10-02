---
reports: spya-r2auqd, spya-rpqqxb
ending: shipped
---
# Summary writes every level when opened, and Brief is for a reader in a hurry

Two reports from Greg (admin, verified by `scripts/feedback-reporter.ts`), both on
`/read/s41598-023-33209-9-spya-hxekgz`, the rat-rearing paper. Overseer queue item `qi-52z3tb69`.

## SPIDERYARN-READING2-9P (`spya-r2auqd`), 2026-10-01 19:56 UTC, build `6bdf24dc`

> I still see the "Write it" button if I open up Summary mode for the first time for a given
> article and move the slider directly to Briefer. So Briefer and Fuller and Simple should all
> auto-generate as needed when they're first opened without me needing to hit the "Write it"
> button.
>
> Oh, and I think we want Briefer to be the default.

**Ending: Shipped.** Most of it was already on `dev` from two sessions dispatched earlier. His build
had neither: pressing Summary writes the levels (7T, `3a9e040f4`,
[261002a](../plans/261002a-summary-generates-on-open.md)), and Summary opens on Brief (8N, `ac466a12e`,
[261002c](../plans/261002c-summary-opens-on-brief.md)). A browser check on dev confirmed every
desktop path. One hole was left, found by GPT Sol: a touch drag that the browser takes back for
scrolling moved the level without starting the write, leaving *Write it* on Brief. That is fixed
here, so a drag now starts the write on its first move.
[261002h](../plans/261002h-brief-summary-plainer-for-a-reader-in-a-hurry.md).

## `spya-rpqqxb`, 2026-10-02 09:51 UTC (never reached Sentry; added by the Overseer)

> The Briefer summary should also use slightly simpler language, and slightly less jargon, i.e.
> assume it's for someone with less expertise or in more of a hurry.
>
> And in general, do some web research on what makes for a good summary. e.g. perhaps start with
> the goal of the paper, and end with the conclusion/takeaways?

**Ending: Shipped.** Brief is now written for a reader in a hurry from outside the field, even when
the reader's profile claims the field. His own profiled Brief had been denser in jargon than the
Simple beside it. It allows at most two technical terms, each explained, and one plain phrase of
method. Every level opens on the piece's goal and ends on its takeaway, and that shape was already
there. Measured blind: plainer in 11 of 12 decided pairs, 8:0 for an expert reader, with fidelity
faults unchanged (12 against 12). Takes effect for summaries written from the next deploy
(`simple-prompt/5`); stored ones are not rewritten unasked. The research is
[261002c](../research/261002c-what-makes-a-good-summary.md), and the eval is
[261002q](../investigations/261002q-brief-plainer-prompt-eval.md).
