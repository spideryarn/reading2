---
id: q-kp34gz
report: spya-hrfj6q
status: answered
asked: 2026-10-10
title: Should a stored Referee failure say when it happened?
refs: qi-75r4ct5p · docs/plans/261010f-a-stale-referee-criterion-overflow-and-the-calls-one-notch-from-it.md · docs/user-feedback/261009_2359-referee-criterion-answer-was-longer-than-there-was-room-for.md · SPIDERYARN-READING2-GN
acted: spya-b4b4bm
---
The Referee error you reported on 9 October was from a run on 5 September, before the fix of 28 September, but nothing on screen said so. Should a failed Referee row show its date?

A. Show the date on failed rows only, e.g. "This failed on 5 September" above the message and the Try again button. Small: one line in the Criteria and Claims panels, from a timestamp already stored. It tells you a failure is old, and that Try again runs today's code.
B. Leave it as it is. Try again already re-runs under today's code, and a failure that old is rare now that the cause is fixed.

Recommendation: A. It is cheap, and it would have saved this report.

Details

You opened Referee on the Kuhn "Landscape of consciousness" paper and saw "The answer was longer than there was room for … [ai-overflowed-no-ask]". That message belonged to a criterion run on 5 September. At the time the model's thinking could use up the whole answer allowance. That was fixed on 28 September, and four fresh runs on the same paper all succeed now. The failed row was stored and shown again each time the mode opened, looking exactly like a new failure.

Nothing was built for this. Option A would add a date to failed rows in Referee only. Doing it everywhere a stored failure is shown is a bigger change and would be its own plan.

## Greg's answer, 2026-10-10 (in the Feedback dialog, reply `spya-b4b4bm`)

> B

Settled: B. Nothing changes: a failed Referee row does not show its date, and Try again re-runs under today's code. (Feedback sweep, 2026-10-10.)
