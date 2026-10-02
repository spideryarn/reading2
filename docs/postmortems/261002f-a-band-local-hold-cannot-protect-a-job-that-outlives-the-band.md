# A band-local hold cannot protect a job that outlives the band

Caught in the code review of [261002f](../plans/261002f-quiz-regenerate-for-my-profile.md),
before this change was committed. The new Quiz hold protects a mounted band after a paid rewrite
finishes but before its replacement GET succeeds. Two gaps in the panel were fixed during review;
the band-lifetime gap remains a P1 for the implementer. There is no production-incident evidence.

## The class: local UI state outlived by its operation

`useQuiz` owns `pressedOn`, but its conditional band unmounts on Recall or any other mode.
The paid job and `useQuizRead`'s old batch survive that unmount. Returning discards the only
evidence that the old batch is waiting for a replacement, and enables another paid Regenerate
while the opening revalidation is pending or fails.

The original panel also omitted `rewriting` from the stale banner's run control and gave a held
current batch no read retry. Those are the same operation described by different controls, with
only the new badge consulting its full state. The review fixes make the stale banner honour the
hold and show a read-only recovery control for both stale and current batches.

**Introduced by the uncommitted 261002f diff**, against HEAD `03d0cad95`; no introducing commit yet.
The root cause was independently checked in the review's `rewrite_lifecycle` subagent.

## Why the original tests stayed green

The new hold test mocked `useStepJob` as permanently idle and passed batches to the hook by hand.
It proved a boolean within one mount. The panel test passed `rewriting` by hand too. Neither
exercised actual job completion, a failed replacement GET, the stale banner, or band unmounting.

The two new panel regressions failed before the fixes: the read-retry button was absent, and
*Write them again* remained available on a stale batch with `rewriting: true`.
`tests/quiz-regenerate-revalidation.test.tsx` now exercises the real reader, real job hook and
actual profile panel through a terminal job, delayed and failed reads, and a successful GET retry.
An additional temporary test retained the read, unmounted/remounted its band during the held GET,
and failed on the actual button: `expected false to be true` for `Regenerate.disabled`. That
reproduction was removed after recording the open finding; the passing tests do not claim to
cover that unresolved lifetime.

## The fix that is right for the long term

Keep the pending-replacement state with the persistent quiz reader, and preserve terminal failure
information across band changes so cancellation or failure still permits a paid retry. Moving
only the boolean would preserve a dead hold if the job failed while Quiz was closed. This review
leaves that ownership change to the implementer; its panel fixes do not close it.

**Done before commit:** the hold moved to `useQuizRead` (`held`/`hold`/`release`); the band releases
it on `failed`, or once the job list is loaded and idle and a read has landed since — the case of a
job that failed while Quiz was closed, which a fresh mount cannot otherwise tell from one still
being read. Two remount tests in `tests/quiz-regenerate-revalidation.test.tsx`, each seen red
against a mutant. Plan [261002f § Code review](../plans/261002f-quiz-regenerate-for-my-profile.md).

## Countermeasures ranked by cost and value

1. **Exercise every paid entry point with a held replacement and a failed GET.** Small jsdom
   regressions; done for the badge and stale banner, including a successful read-only recovery.
2. **Unmount only the conditional UI while retaining its persistent reader.** Cheap, and tests
   the lifetime contract rather than assuming one mounted hook represents the app.
3. **A general cross-mode regeneration state machine.** Rejected for this review: it would change
   other modes and shared hooks, beyond the requested scope. The existing Quiz read is the first
   place to put its own durable hold.

I would ask what survives leaving the screen before putting a payment guard in the screen's state.
Holding a second press is only useful if the hold survives the operation it protects.

Up: [postmortems.md](../project/postmortems.md).
