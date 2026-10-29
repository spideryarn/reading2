---
id: q-cj0fv8
report: spya-fytjtf
status: open
asked: 2026-10-29
title: In the margin's Quiz, should a question turn green when you answer it, or only when the AI judges it right?
refs: q-ejp09q (reply spya-jzgrua) · qi-msd5tmda · docs/plans/261029i-quiz-answered-in-the-margin-with-voice-and-a-quiet-green.md · docs/plans/261029i-plan-review-sol.md · docs/user-feedback/261029_0037-quiz-runs-with-the-margin-and-its-questions-sit-there.md
---
You asked for "a subtle green" when you answer a Quiz question, not gamification. Built (on dev, not yet deployed): a question turns a pale green, with a tick, as soon as your answer has been marked, whether you got it right or not. Should green mean "you got it right" instead?

```
                                  A: green = answered (built)   B: green = judged right
  answered, judged right          tick + green                  tick + green
  answered, judged wrong          tick + green                  tick only (never red)
  answered, check failed          tick + green                  tick only
  answered on an earlier visit    tick + green                  tick only (right/wrong is not kept)
  not answered                    question mark                 question mark
```

A. Green means answered (built). Every answered question goes green and stays green on later visits, so the margin fills with quiet green as you read. Costs nothing more. Gives up: it says nothing about whether you were right; the written mark under your answer still says what you got and what is missing.

B. Green means judged right. A small hidden AI check already decides right or wrong after each mark (it picks which hints the next question shows); B shows its answer as colour, and an answered-but-not-right question keeps just the tick. Cost: about a day. Gives up three things: no green reads as "wrong", even when the check simply failed or declined (it does, and it once called an unanswerable question "right"); the green vanishes on your next visit, because right/wrong is deliberately not stored (the privacy page says so); and it reverses the rule that Quiz never grades you.

My recommendation: A, for a week of your own reading, then decide. It gives the "done it" satisfaction without a grade, and it is the cheaper one to change later.

Details

What you said (reply to q-ejp09q, 2026-10-29): "some kind of nice feedback, visual feedback actually, it might be quite important, not gamification. But just some of that sense of satisfaction of, you know, turning it a subtle green or whatever."

What was built from that reply (plan 261029i): a Quiz question in the margin now opens a small answer box right there instead of jumping to Learn; a microphone beside each question opens the box and starts listening in one press; the mark streams in under your answer; Open in Quiz is one line down, for the whole quiz. The same green appears on the question in the Learn band once answered.

Why A was built first: the plan's first draft was B. GPT Sol's review argued that what green means is a product choice your words do not settle, and that B breaks the three rules above. A keeps every rule and is simpler, so it went first and this question asks you to choose.

What would decide it: if, reading with A, the green feels empty because it comes whatever you write, B. If it feels right as a sign of progress through the piece, keep A.

The other half of your reply, Haiku and Sonnet evals for Quiz, is written and waits for the OpenRouter key to reset on 1 November (about $8 to run). "Smaller and more often" is built into that eval as a second prompt, to be shipped only if it reads better.
