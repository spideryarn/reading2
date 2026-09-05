# The enlarged diagram's prompt, in a column beside it

**[SPIDERYARN-READING2-1P](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1P)** · reported
2026-09-05 08:00 UTC · kind: suggestion · *shipped*

## What the reader said

> For the Illustrated diagram, if I have clicked Enlarge, show the prompt text in a column to one
> side so I can scroll up down independently through that text while looking at the image it refers
> to.

## What we did

Built it as asked. At full screen the brief is now a column of its own beside the plate, each with
its own scroller — an `<aside className="ill-aside">` that is a sibling of the existing
`.ill-in-full` inside the same `<dialog>`, so neither column knows about the other and no shared
component was touched.

Checked first that it was worth a column: across the 15 stored plates the prompt runs **240–345
words**, so a reader really does lose their place in it.

Below 1080px there is no room, so one media query flips the column off and the band's existing
`<details>` back on — the prompt is on screen exactly once at any width. Stacking was rejected
because `.ill-in-full` is `height: 100dvh`, so a stacked column starts one screen down, which is the
scrolling this report is about.

Escape, the backdrop click and the article's arrow keys are all unchanged; the new scroller is
focusable so a keyboard reader can reach the bottom of it.

[The plan](../plans/260905e-feedback-diagram-text-column-and-socratic-summaries.md) § 1P;
[diagram.md § At full screen the brief is a column](../project/diagram.md#at-full-screen-the-brief-is-a-column-not-a-details)
is the doc.
