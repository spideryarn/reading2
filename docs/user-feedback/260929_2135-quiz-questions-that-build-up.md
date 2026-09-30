---
reports: spya-jc2ub9
ending: shipped
---
# Quiz questions that build up to the takeaways

**[SPIDERYARN-READING2-5W](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-5W)** · report
`spya-jc2ub9` · reported 2026-09-29 21:35 UTC, from Greg's own account (an admin suggestion;
provenance checked with `scripts/feedback-reporter.ts`, exit 0) · **ending: shipped** on `dev`

## What Greg said

> For the quiz mode, maybe what we want is, like, more questions, but try and make them easier,
> where maybe only a sentence or two is needed, and make the questions build on one another
> gradually, and so that each answer is not that effortful, but that by the time you've answered a
> whole bunch of them, you know, you've kind of gradually built up towards an understanding of why
> it is the way, you know, what the key takeaways are.

## What we did

The quiz is now **a path, not a pool**: up to twenty small questions in the model's order, each
answerable in a sentence or two, leaning on the one before and ending at the piece's takeaways and
why they hold. Most steps carry a **premise** — one sentence restating the previous answer — which is
shown unless the reader just got that previous question right. That keeps the quiz adaptive, as Greg
chose on 2026-09-06 ([260905_1800](260905_1800-quiz-questions-too-hard.md)), without a control and
without ever reordering the path. The band ladder, the band sort and the spread gate went.

Plan, two GPT Sol plan reviews, the code review and the measurements:
[260930c](../plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md).

**Measured**, as [prompting-guide.md](../project/prompting-guide.md) asks: five local articles, the old
prompt twice (the control) and the new one, blind-judged by a fresh subagent with the article's
outline and cited passages in front of it. Questions per quiz went from 10–12 to 15–20 and reference
answers from ~48 words to ~30; the judge picked the new quiz as the one that builds up, and the one
that asks less per question, on all five, where the control judge said none of the old quizzes built
up at all. Five pairs is a handful, so that is "it happened", not "by how much".

**Named limits, for Greg:** on a dense paper some premises set the scene instead of restating the
previous answer (reduced by a prompt rule, not eliminated); and a long paper can plan for most of
the quiz's token and time budget (54k tokens, ~7.5 minutes measured on one), so the quiz step now
reserves 600 s of job time before it starts. An existing quiz stays a pool until re-run from
Metadata, since `outdated` is deliberately silent.
