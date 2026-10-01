---
reports: spya-u3dgk7, spya-w2kgha
ending: shipped
---
# Annotations mode: marginalia in a right-hand column

Two reports from Greg (admin, verified by account id: `feedback-reporter.ts` exit 0 on both rows) about
one mode, handled as one entry (Overseer queue `qi-3qvv5mbn`): SPIDERYARN-READING2-7E (`spya-u3dgk7`,
filed 2026-09-30 23:11Z, the time in this file's name) and SPIDERYARN-READING2-7K (`spya-w2kgha`,
added to the brief at 00:55), both from `/read/dongetal25-spya-vfmvmm`, build `fe57a1ea`. This session
ran on a pool account with no Sentry sign-in, so the Sentry status write is the next sweep's.

> I think we had suggested in another Feedback report to try adding an experimental Annotations mode,
> that would provide marginalia-snippets that scrolls with the text, i.e. anchored to the blocks
> visible on screen.
>
> Some ideas (taking some inspiration from the `decorated.html` experiments & research:
> - include the "relation-words", e.g. BUT, SO
> - perhaps include socratic-questions for what each section is answering
> - used dashed-underline with hover-tooltips for Ideas/Assumptions
> - add some kind of Arc-rail sentence at the top (and/or the Structure-breadcrumbs that I think I
>   mentioned in another Feedback report)
> - if you think a block is really important but really difficult, we could automatically trigger the
>   ask-for-help question-comments? (7E)

> I would love to play with putting that new Annotations mode as a column on the right-hand-side (i.e.
> right of the text).
>
> Then left-hand-column (if displayed) would be stuff that's unanchored to the text, middle column for
> the text itself, and right-hand-column (if displayed) for annotations anchored to the blocks.
>
> This raises lots of questions about whether both left- and right-hand columns can be visible at the
> same time (ideally yes, if the window is wide enough, otherwise probably only one or the other), etc
> etc.
>
> For now, let's say that Annotations mode is the only one that can appear in this right-hand-column,
> though we'll see in future.
>
> Use Playwright and screenshots etc to try and get this working nicely. Get help from GPT Astra.
>
> I did wonder whether we should be using libraries more to help us with this kind of thing (see
> docs/reusable/third-party-library-selection.md ) - get web research from Sonnet, ask GPT for input,
> use your judgment. (7K)

**Ending: shipped**, as a first version behind the experimental switch:
[261001d](../plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md). `?mode=annotations`
opens no left band and draws a column of notes right of the prose, each level with its paragraph
and scrolling with the page: each part's Socratic question beside its first paragraph, an
*assumes*/*introduces* stamp at each idea's first occurrence (when the ideas have been made), and a
head pinned at the top with the part and section you are in and the arc's sentence. The prose does
not move on a wide window; on one too narrow for the column the notes are hidden and a line says why.
It generates nothing.

Of the five ideas, by ease and value (Opus and GPT Sol agreed independently): the questions, the arc
sentence and a short breadcrumb are in; the ideas are in as margin stamps rather than underlines in
the prose; **relation words are written up as stage 2 and not built** — a new paid model pass,
deferred until the column itself has been tried; **automatic ask-for-help comments are declined** —
they would spend money and write into the reader's own comments without being asked. Both columns at
once is deferred, with the column built so that it is a layout change when wanted. No library: a
Sonnet web pass found nothing that beats a ten-line collision rule. GPT Astra's design pass reshaped
the head, the questions' anchoring and the stamps; the plan records each of its points and which were
taken.

**Follow-up, 2026-10-01: both columns at once** —
[261001i](../plans/261001i-annotations-column-beside-a-band-mode.md). The notes are now a switch
of their own, `?margin=1`, rather than a mode, so they stay open beside whichever band you pick:
the Dock's Annotations button is an on/off toggle at the right-hand end, and pressing Plain closes
the band but keeps the notes. From 900px up you get band, prose and notes; below that the band
wins, with a line under the prose saying the notes need a wider window or the panel closed, and on
a phone the band covers everything as before. Old `?mode=annotations` links open the notes. On
`dev` at `eb76050d`, with GPT Sol's review fixes at `70650d76`.
