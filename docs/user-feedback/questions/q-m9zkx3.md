---
id: q-m9zkx3
report: spya-fytjtf
status: open
asked: 2026-10-29
title: Should Quiz store whether an answer was judged right, so the deeper green lasts and spacing can adapt?
refs: q-cj0fv8 (reply spya-v2aehw) · qi-pc9ekn26 · docs/plans/261029m-quiz-green-for-right-and-a-quiet-time-to-recall-again.md · docs/user-feedback/261029_0037-quiz-runs-with-the-margin-and-its-questions-sit-there.md
---
Built from your reply (on dev, not yet deployed): answered is pale green, judged right is a deeper green, and an answer three days old fades with a small clock and opens with an empty box so you try it from memory. The deeper green lasts only until you reload, because whether you got it right is deliberately not saved. Should we start saving it?

A. Keep it as built (no change). Right shows deeper green for the rest of that visit, then plain green. Every answer comes back after three days, right or wrong. Costs nothing. Gives up: the deeper green disappears on reload, and spacing cannot tell what you got wrong.

B. Save right/wrong with each answer. The deeper green stays. Spacing adapts: got it wrong, back in a day; got it right, back in a week, then longer each time you get it right again. Cost: about a day, plus a change to the public privacy page, which today does not list it. Gives up: a stored machine judgement about you, which we have avoided on purpose; and the check is sometimes wrong (it once called an unanswerable question "right"), so a wrong save would space a question badly.

My recommendation: A for a week of your own reading, then decide. If the green going on reload bothers you, or the three-day comeback feels badly timed, that points to B.

Details

What you said (reply to q-cj0fv8, 2026-10-29): "find a way to give positive feedback for them answering, and even more positive feedback if they got it right, and maybe some other indication if it's sort of stale or previous and you think that it's time that they reminded themselves. So if you want to build in a kind of basic version of the spacing effect somehow, that could be good."

What was built (plan 261029m), the same in the margin and in the Learn band:

```
  ? not answered            question mark
  ✓ answered                tick, pale green
  ⊙ judged right            ringed tick, deeper green       (this visit only)
  ↺ answered 3+ days ago    clock, the green faded           box opens empty:
                                                             "You answered this 5 days ago.
                                                              Try it from memory first."
                                                              [Show my earlier answer]
```

No red, no score, no count. A failed check just leaves plain green. "Show my earlier answer" never overwrites what you have typed; it shows the old answer beside it. The Learn band also opens at the first question that is unanswered or due.

Why three days, and the same every time: it is worked out from when the answer was saved, which we already store, so nothing new is kept. A schedule that grows (a day, then three, then a week) needs to know how each try went, which is B. The research does not settle the exact interval; three days is a judgement, short enough that you meet it while reading an article over a week.

Why B is a question for you: it changes what we keep about a reader, and the privacy record says right/wrong is not kept. The check that decides "right" is a cheap model reading the mark; it was built on the understanding that its mistakes are invisible and harmless. Showing its answer as colour for one visit is a small step; saving it and letting it steer the spacing is a bigger one.
