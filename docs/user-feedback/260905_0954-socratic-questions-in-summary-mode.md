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

## The wording changed on 2026-09-07, and this is where it went

The questions this report shipped were the ones Greg called *"a bit crap"* the same morning: the
prompt asked for the question *"this node's text answers and its gist does NOT"*, which instructs the
model to strip out everything the gist carries, so a bare why-question was the correct output.
`antikythera` still carries ten of them in the wild.

Four rewordings were built into an eval and measured over seven real articles, and **V4** — the shape
Greg drew himself — shipped as `toc/7`:

> Computational functionalism — why isn't computation sufficient for consciousness? (4 arguments)

Topic first in the author's own term, a question that presupposes where the section lands, and a
bracketed hint giving the **shape** of the answer and never its content.
[summaries.md § The shape it has](../project/summaries.md) is the doc;
[260907d](../plans/260907d-ship-socratic-v4-repair-the-eval-gate-and-answer-q7.md) is the work, and
[260905_1803](260905_1803-only-the-socratic-question.md) is the report it answers.

**The cost, named rather than buried:** these lines are nearly twice as long — a median of 18 words
against 10 — while Greg's same brief also asked for simpler language and a briefer top-level line.
The repaired eval could not separate the two wordings, so nothing was tuned to close that gap; what
it *could* say is that the two differ where he said they would, V4 telling the reader more about what
is coming and giving away marginally more in doing it.

**The layout argument in this note is untouched by any of that**, and still reads correctly for the
questions it was written about — see § *The gist stayed for one day* in
[summaries.md](../project/summaries.md).

[The plan](../plans/260905e-feedback-diagram-text-column-and-socratic-summaries.md) § 1V, which has
the before-and-after questions in full;
[summaries.md § The question under the claim](../project/summaries.md#the-question-under-the-claim)
is the doc.
