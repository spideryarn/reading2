# Figures follow-ups: a table drawn as a picture is a table, Structure's marks you can see, and figures in the Skim route queued

Three admin reports from Greg, 2026-10-15 20:40 UTC, build `f84dc434`, on his
`mental-imagery-functional-mechanisms-and-clinica-spya-fw5zrb` (a PDF paper). Overseer queue item
`qi-647czja2`. They follow up [261011b](261011b-skim-figures-walk-and-structure-figure-marks.md),
which shipped Skim's *Figures* part and Structure's figure marks, deployed in `f84dc434`.

> It's good that we have a "Figures" sub-mode in Skim now.
>
> Perhaps we should also have the option to include some figures along with quotes in the main
> Gist/More/Most Skim trajectories (as the LLM sees fit)
>
> — Greg, 2026-10-15 (`spya-c8z66b`, #584)

> Perhaps indicate where there are figures/tables/etc in Structure mode somehow
>
> — Greg, 2026-10-15 (`spya-zzvm6e`, #585)

> Do we include Tables as well as Figures in Skim mode?
>
> — Greg, 2026-10-15 (`spya-s8pf4r`, #586)

## What we found on his article

Read from production inside `begin read only`, the scratch script deleted afterwards
([database.md](../project/database.md)). The paper has 94 blocks and **three figures and no
tables** (no block and no sentence says *"Table N"*). `figuresOf` finds all three, PDF placeholders
with their captions. The stored tree puts Figures 1 and 2 inside *Mental Imagery and Weak
Perception* (rows 20–31) and Figure 3 inside *The Clinical Relevance of Mental Imagery* (61–67), so
both parts carried a mark. Nothing was missing; the marks were there and not seen.

A browser check on three local articles agreed: every mark rendered, visible and unclipped, and
read as noise — a 12px icon in `--ink-faint` (a mid grey) beside a 15.7px title in `--ink-soft`.

## What changes

1. **#586 — a table drawn as a picture is a table.** Tables are in the Figures walk already (a
   `<table>`, or a `<figure>` holding one). But a table that arrives as a picture — a PDF table the
   model could not copy cell by cell, or a journal that publishes its tables as images — was counted
   and iconed as a *figure*: four such locally (`arxiv-2010`, three `source-*` imports). Now
   `figuresOf` turns a picture-figure whose caption starts *"Table N"* (or *"Supplementary Table
   S2"*, *"Extended Data Table 2"*, *"TABLE IV"*) into a table. The number is required, so a
   caption beginning *"Tables and chairs"* stays a figure. Red test first (`tests/figures.test.ts`).
   **After GPT Sol's plan review** ([261015b-figures-plan-review-sol.md](261015b-figures-plan-review-sol.md),
   finding 2): a picture took the caption straight after it before the one before, so in *picture,
   "Table 1." caption, table* the picture took the table's caption — and with this change would have
   become a table. A *"Table N"* caption with a table of data straight after it is now left to that
   table. Red test first.
2. **#585 — the marks are louder.** `--ink-soft` (an unread title's ink) instead of `--ink-faint`,
   14px icons instead of 12px (the size on Skim's Figures rows), and the count at 0.8rem. One rule
   in `structure-mode.css` and one prop in `FigureMark.tsx`; the drawn and measured rows still share
   the one component.

**The simpler option passed over** for #585: nothing, and the note's answer alone (*"they are
there"*). Passed over because Greg looked straight at them and asked for them, which is the
evidence that they are too quiet. A louder option — accent colour, a word (*"2 figures"*) after the
title — was passed over too: the marks are chrome, and a word on every such row would compete with
the titles for the fit.

## #584, figures in the Gist · More · Most routes: queued, not built here

Not a small change. The Skim step's prompt is at its thirteenth version, each change measured
([skim.md](../project/skim.md)); a stop is a quote (`SkimStop.quoteId`) and the route's walk
(`useSkimMode`, the stop card, the door, pips, carrying between passes, the size plan) is keyed on
quotes throughout. And the ask has a product fork Greg has not decided — *"include some figures
along with quotes"* reads two ways:

Two decisions, not one (GPT Sol's plan review, finding 4):

1. **Where the figure goes.** *A stop of its own*, between quotes: the walk gains a second kind of
   stop, every quote-keyed piece above learns about figures, and the pass-size rules have to say
   whether a figure counts. Or *a companion to a quote stop*: a stop may carry zero or more figure
   references, the quote counts and navigation stay as they are, old routes are unchanged — and
   then whether *companion* means a *Figure 2 ›* chip that jumps to it, or the figure drawn beside
   the quote in the band.
2. **Who picks it.** *The model*, as Greg asked (*"as the LLM sees fit"*): the figures' captions
   and section paths join the prompt's input and hash, the answer gains a validated field, and the
   change is measured on articles with figures as the prompting guide says. Or *a rule*: a stop
   whose paragraph cites *"Figure 2"* gets Figure 2, no prompt change.

The simplest model-backed version is a companion chosen by the model, shown as a chip.

Left as its own queue entry with that question, per the brief's *"if it turns into a big change,
ship #585/#586 and leave #584 a queue entry of its own"*.

## Stages

1. `figuresOf`: table by caption, test first. 2. The marks' ink and size; a browser check in both
themes. 3. GPT Sol code review; gates; the note; the queue entry for #584.
