# Later effects still read the render before earlier state writes

Caught during review of the unlanded quiz-answer persistence change
([261005b](../plans/261005b-quiz-answers-are-kept-and-restored.md)). A reader who reopened Quiz by
pressing its second question in the prose could see their first question's kept answer in the second
question's box. The second question's own answer and mark were not restored. The stored rows were
correct; the defect was in the panel. Nothing reached a reader through this review run.

## What happened

The new regression in [quiz-kept-answers.test.tsx](../../tests/quiz-kept-answers.test.tsx),
`restores the arrival's question when the band mounts over an already loaded batch`, loads the
quiz and both kept answers while the band is absent, then mounts it with an arrival requesting
question two. On the candidate it reached question two, but the box assertion failed:

```text
Expected: "What I said to two."
Received: "What I said to one."
```

The band's first render selects question one because its cursor starts at zero. In the passive
effect phase, the arrival effect calls `move(1, false)`, scheduling a new cursor, an empty box and
no attempt. The restoring effect runs later, but its closure still contains question one's id and
kept answer from that same render. Its writes put question one's answer and attempt back after
the arrival's clears. The next render shows question two above that answer. Its restoring effect
refuses to replace a nonempty box or an existing attempt, so the mismatch remains.

## The class: effect order is mistaken for state visibility

An earlier effect's state setter schedules a later render. It does not change the values captured
by another effect from the current render. Declaration order can make a later setter win without
making its input current. Here the safety rule that preserves a draft then preserves the incorrectly
restored answer too.

The sibling navigation paths were checked: a filtered-out current question and a replacement batch
already suppress `question` until their moves settle. An arrival at the question already shown does
not move and must preserve drafts. The uncovered path was a valid arrival to a different question
while a question and its kept answer were already available on the mounting render. The related
[publication-phase postmortem](260906d-one-publication-slot-two-producers-two-commit-phases.md)
also concerns effect ordering, but its mechanism is a shared slot cleared in a different commit
phase; this defect needs neither a cleanup nor different phases.

## Why the original tests stayed green

The existing combined batch/filter/arrival test requests question one while the filter initially
hides it. That render has no question to restore, so the stale closure cannot write anything.
The ordinary mount test has no arrival and correctly restores question one. Separate green checks
of navigation and restoration therefore missed the interaction when both have useful data in the
same first render.

Introduced by `523e771cf`, confirmed by `git log -S 'const keptHere'` and the restoration diff.
The commit adds kept answers and the restoring effect to implement reload, mode-switch and
Previous restoration. The older arrival machinery was correct without this later writer.

## The fix that is right for the long term

Restore only when navigation has settled on the question being restored. The narrow review fix
skips restoration while a valid arrival from the current batch requests a different question.
The subsequent cursor render triggers restoration for that destination. An unknown question or
an arrival from another batch must not suppress restoration. Same-question arrivals still leave
drafts and live marks alone.

This uses the panel's existing boundary: batch changes and filtering suppress their uncommitted
question, and the new guard covers arrival navigation. Merely moving the restoring effect farther
down the file would preserve the bug. Any future passive navigation path must carry the same
settled-question boundary before it can restore answer state.

## What would have caught it, ranked by ease against value

1. **Mount a real panel over preloaded data with a different requested destination.** Added in
   this review, observed red on the candidate and green with the guard. Assert the question, box,
   mark and attempt id together; checking only the heading approves this broken state.
2. **Exercise effect-driven moves when both origin and destination already have answers.** A small
   extension of the same integration fixture, with same-question, invalid-arrival and StrictMode
   variants protecting the guard's boundaries. It targets state visibility rather than effect
   declaration order.
3. **Replace navigation with a new state-machine framework.** Rejected for this fix. Existing
   navigation already expresses its pending states; a framework would add machinery without
   independently proving that restored data belongs to the displayed question.

The lesson I would keep is to test the next render's complete state when effects both navigate and
restore. Seeing the right heading does not establish that its answer came from the right question.

Up: [Postmortems](../project/postmortems.md)
