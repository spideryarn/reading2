---
reports: spya-e8ujxn
ending: shipped
---
# Quiz: answers are kept, and are there when you come back

A suggestion from Greg (admin, confirmed against its production row by
`scripts/feedback-reporter.ts`), 2026-10-04 11:18 UTC, relayed by the Overseer. Sentry
SPIDERYARN-READING2-CA; queue item `qi-wdxddd4z`. Filed from
`https://www.spideryarn.com/changelog#release-126`.

> I think when I tried with the quiz, I answered a question or two and then came back to it and it
> looked like the answers had been thrown away. Is there a way for us to store those answers? Is
> that very complicated? If so, let's discuss.

**Ending: shipped**, on `dev`.

They were thrown away, on purpose: nothing about an answer was stored, so it went on a reload, on
leaving Quiz for another mode, and on Next then Previous. It was not complicated to change. Each
finished mark is now a row in `quiz_attempts`, with when it happened, and the panel puts the answer
and what the AI wrote back about it in place again when you land on that question. The privacy page
said quiz answers were not stored; it now says they are.

Two things were left for Greg to decide, and neither holds the work up: whether to store the hidden
right/wrong with each answer, and whether coming back should open at the first question not yet
answered. Both are in the plan, with a recommendation.

Plan, GPT Sol's plan and code reviews, and what landed:
[261005b](../plans/261005b-quiz-answers-are-kept-and-restored.md). The feature:
[quiz.md § Answers are kept](../project/quiz.md).
