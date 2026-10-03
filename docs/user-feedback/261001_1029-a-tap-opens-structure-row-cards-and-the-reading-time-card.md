---
reports: spya-a868zs, spya-vskqfn
ending: shipped
---
# A tap opens Structure's row cards and the reading-time line's card

The half of two reports that earlier sessions shipped for a mouse only. Overseer queue item
`qi-djn8h9bn`, found by the [2026-10-02 re-check](261002-recheck-all-reports.md). Both are from Greg
(admin; `scripts/feedback-reporter.ts` exited 0 for each, which proves the production rows).

[SPIDERYARN-READING2-3N](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3N), spya-a868zs,
2026-09-12 10:27, in Structure mode:

> Add rich tooltips to Structure mode (so I can see summary of that bit of the text)

[SPIDERYARN-READING2-80](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-80), spya-vskqfn,
2026-10-01 10:29:

> There are vertical lines now next to some blocks. What are they for? They should ideally have
> tooltips to explain themselves.

**Ending: Shipped.** On `dev`, not deployed. Resolve 3N and 80.

## What we did

The cards themselves shipped earlier: Structure's in
[260912_1027](260912_1027-rich-tooltips-in-structure-mode.md), and the reading-time line's in
[261001_0951](261001_0951-quieter-switch-line-tooltips-readers-only-filter.md) and
[261001_1604](261001_1604-reading-time-line-rich-card-and-quieter-cross-references.md). Each note
said that a tap could not open them, so on an iPad they did not exist. Now:

- **A Structure row, in both faces** (the two columns and the nested list): the first tap opens
  its card, which ends "Tap again to go here", and the second tap goes there. This is the spine's
  rule (touch.md). The part you are standing in has no card and still goes there on the first tap.
- **The reading-time line**: a tap opens its "Reading time" card. A tap anywhere else, or a
  scroll, closes it. The line is under 6px wide, so on a touch screen the target now also reaches
  over the empty gutter column to its left. Any icon drawn there still gets its own tap.

[The plan](../plans/261003c-tap-opens-structure-row-cards-and-the-reading-time-card-on-touch.md),
with GPT Sol's plan and code reviews beside it.
