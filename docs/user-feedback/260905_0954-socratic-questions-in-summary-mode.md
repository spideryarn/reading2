# Socratic questions in Summary mode

**[SPIDERYARN-READING2-1V](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1V)** · reported
2026-09-05 09:54 UTC · kind: suggestion · *shipped, but not as asked*

## What the reader said

> Tweak the prompt that generates the Summary mode to be a bit more in the form of Socratic
> questions that encourage the reader to read the actual text to get the full answers

## What we did

**The literal request could not be carried out, and finding out why is most of the work.** There is
no prompt that generates Summary mode. The sentence in that panel is the `gist` stage 4 writes onto
every node — and that same string is drawn in **ten other places** (the granularity-zoom columns,
the spine tooltips, the shelf cards, the diagram cards), *and* is fed back into the later structure
waves as context. Making it Socratic would have turned shelf blurbs into questions and degraded the
trees the cascade builds. One prompt edit, ten regressions.

So the question is a **second field** instead: one Socratic question on the article and on each of
its parts, written by the same stage-4 call, drawn **only** in Summary mode, under the gist. The
gist stays, because *"a bit more"* was the brief and a panel of nothing but questions would stop the
panel doing its job — a reader deciding whether to descend needs to know what the section says.

Root and parts only, enforced in code: one per section on a fifty-section article is noise.

Verified with a real run on a real article (noema, 141 blocks, ~$0.10). The model wrote six
questions, none deeper than a part, and all of them the *why / how / what follows* kind rather than
lookups. That run also caught a bug of mine: one question came back without a question mark, and my
first validator would have silently thrown it away.

**One thing worth knowing:** existing articles show no questions until their hierarchy is re-run —
`npm run hierarchy -- <slug> --force`. Nothing backfills on its own.

[The plan](../plans/260905e-feedback-diagram-text-column-and-socratic-summaries.md) § 1V, which has
the before-and-after questions in full;
[summaries.md § The question under the claim](../project/summaries.md#the-question-under-the-claim)
is the doc.
