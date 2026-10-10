---
reports: spya-u62q09
ending: shipped
---

# Metadata's AI processing, named as the modes are

Report #516, `spya-u62q09` (SPIDERYARN-READING2-FW), Greg, 2026-10-09 12:25 UTC, a suggestion filed
from the Metadata page of the Attention paper (`arxiv-1706-03762-spya-wyt7j0`). Admin provenance
proved by `feedback-reporter.ts` (exit 0). Queue item `qi-yckkzqah`.

> Can you make sure that the AI processing sections here map to whatever we're calling the nodes, or
> have a clear explanation of what they are?
>
> And in general, if you rename stuff, make sure that you've renamed it thoroughly. So not just in
> the UI, but also variables and comments and file names and database columns and whatever else.

**Shipped.** Every row in *AI processing* is now named the way the mode bar names it: *Summary ›
Thread*, *Learn › Quiz*, *Diagram › Sketch*, *Sources › Reception*. Under each name is one line
saying what it is, taken from the mode's or sub-mode's own description. Rows that are not a mode say
where they show up: the arc is in Structure and Marginalia, and the relation words are in Marginalia.
The *What we did to it* list below uses the same names. Before, it used the pipeline's own phrases
(*Writing the questions* and *Finding the questions* were two different modes, and *Asking the web*
was Reception). The *Start this article again* row's names, and the command bar's *Run again* rows,
come from the same table (`src/web/step-names.ts`). So a mode rename changes all of them at
once: Peer review becoming Sources, which landed while this was being built, reached every row
without an edit to the table's names.
[Plan 261009x](../plans/261009x-metadata-ai-processing-named-as-the-modes-are.md).

**The second paragraph** is already a rule
([rename-or-move.md § A rename on screen is a rename all the way down](../reusable/rename-or-move.md#a-rename-on-screen-is-a-rename-all-the-way-down)).
Its list leaves out comments and database column names, which Greg named. Rule docs change only with
his yes, so the before and after went to him as
[q-fneq6t](questions/q-fneq6t.md) rather than as an edit.
