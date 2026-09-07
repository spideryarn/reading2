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

## Two things this did not fix — **both closed on 2026-09-07**

Greg's answer, given 2026-09-06 when both were put to him:

> Ship v4, then fix the eval, and consider tweaks if you learn something useful from it
>
> — Greg, 2026-09-06

[260907d](../plans/260907d-ship-socratic-v4-repair-the-eval-gate-and-answer-q7.md) is that work.

1. **The cascade's parts had no question at all**, because `EXPAND_SYSTEM` had no such field, so the
   panel could draw a question on one part and a gist on its neighbour. Found by GPT Sol as P1-5 of
   the plan review; **fixed at generation as `expand/4`.** The prompt gained a QUESTIONS block
   carrying the same rules stage 4 uses, and the request marks each target `ASK QUESTION ON CHILDREN`
   or `OMIT QUESTION` — per target, because one call batches parents at different depths. A part that
   was asked and came back without one is named in `DeepenStats.missingQuestions` and logged; it never
   throws, is never retried, and is never filled in by a second call.

   Proven live rather than argued: a root-only tree over noema's 141 real blocks, one real call, and
   **all five parts came back with a question** — one of them *"Consciousness & Computation — Why
   might computation not be sufficient for consciousness? (four arguments)"*, which is Greg's own
   worked example, on the same node, from the cascade path this time.

   **The scope is narrower than the symptom, and [summaries.md](../project/summaries.md) says so:**
   this closes the flat-article case. A part can still lose its question two other ways — a restated
   rung spliced away so its depth-2 children come up in its place, and a wave-1 omission — and the
   first is counted while the second is not.

2. **The questions themselves are no longer the first version.** V4 shipped as `toc/7`:
   `<topic> — <question>? (<shape hint>)`, the shape Greg drew, copied byte-for-byte out of the file
   the eval measured. `antikythera`'s ten lookups in the wild stay until its hierarchy is re-run —
   nothing backfills, which is the answer Greg gave for `toc/6` and it holds here.

**And the eval that could not choose between the wordings now can run.** Its calibration gate had
failed and it reported no ranking; the anchor it failed on was not actually a bad line, and — the
finding that mattered — the judge's rubric had **no criterion for the lookup failure every variant
forbids**. Both were repaired and the gate passed for the first time.

**What it then said is worth Greg's attention rather than a footnote.** It named no leader, because
the two completed repeats had different ones. But the run happened to carry **one generation of the
pre-V4 wording against three of V4** — three arms turned out to share the V4 recipe — and the pre-V4
control ranked ahead of all three, head-to-head in 9, 8 and 11 of 12 lineups. That is one control
generation on one document: directional, not dispositive, and **not enough to revert a wording Greg
chose that morning**. So nothing was tweaked, which was the third of his three instructions — but the
next run is now a specific experiment (balanced replicates over more documents) rather than a wish,
and it is on `awaiting-approval.md` for him.

A first draft of this write-up dismissed that lead as noise, on a comparison of two statistics that
are not on the same scale. GPT Sol caught it. **Explaining a result away is as much a way of not
doing the work as inventing one**, and the plan doc keeps both the error and the correction.

Existing articles show no question until `npm run hierarchy -- <slug> --force`.
