# Show only the Socratic question, not both

**[SPIDERYARN-READING2-24](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-24)** · reported
2026-09-05 18:03 UTC · *shipped*

## What Greg said

> I quite like some of these new Socratic questions in the summary mode, but the intent wasn't that
> we would show both the gist and the Socratic question, the intent was that we would show only the
> Socratic question when we have one.

## What we did

`question ?? gist`, one line per row —
[`SummaryPanel.tsx`](../../src/web/SummaryPanel.tsx). The styling moved with it: `.summ-question` was
0.87rem italic `--ink-faint` as a second line, and would have made every row's only sentence look
like a footnote to a claim no longer above it. It now takes `.summ-text`'s weight exactly, and the
italic went with the demotion — it marked the question as a different kind of thing from the sentence
above, and there is no sentence above.

## Why this is a reversal, and why the old reasoning is still in the file

The morning's version ([1V](260905_0954-socratic-questions-in-summary-mode.md)) drew both,
deliberately, arguing that *"a reader deciding whether to descend needs to know what the section
says"*. **That was right about the questions it was written for.** The first prompt asked for the
question *"this node's text answers and its gist does NOT"* — it instructed the model to strip out
everything the gist carried, so a generic why-question was the correct output, and a generic
why-question genuinely cannot carry a row alone.

So the argument is preserved rather than deleted, in `SummaryPanel.tsx` and in
[summaries.md § The gist stayed for one day](../project/summaries.md). What changed is not the layout
principle but what a question is allowed to contain.

## The test that caught it, which is the part worth keeping

`summary-expand.test.tsx` already asserted the old rule with the message *"a question replaced a gist
instead of joining it — the panel stopped saying what the article says"*. It went red on this change,
which is exactly what it was for. It is **inverted rather than relaxed** — the gists must now be
*gone* — because "either would do" is how a rule stops holding anything.

New: [`tests/summary-question-replaces-gist.test.tsx`](../../tests/summary-question-replaces-gist.test.tsx),
five cases. Every one asserts a presence **and** an absence, because a panel that dropped both lines
would pass any test that only asked whether the question appears. Watched red first against the
restored old render: *"expected [ Array(2) ] to not include 'The gist of First part.'"*

## Two things this does not fix

1. **A depth-1 node built by the deepening cascade has no question at all**, because `EXPAND_SYSTEM`
   has no such field, so the panel can draw a question on one part and a gist on its neighbour. That
   was invisible while the question was a faint second line and is not now. Found by GPT Sol as P1-5
   of the plan review, recorded in
   [260905f](../plans/260905f-socratic-summaries-eval-admin-page-gating-short-selections.md).
2. **The questions themselves are still the first version**, which is the one Greg called *"a bit
   crap"* this morning — `antikythera` carries ten in the wild and they are lookups, yes/no questions
   and the gist reasked. Better wording is what [`evals/summaries`](../../evals/summaries/) is
   choosing between; this report was about the render, and the render is done either way.

Existing articles show no question until `npm run hierarchy -- <slug> --force`.
