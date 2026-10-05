# Navigation priority must be settled before answer state changes

Review of `5d5ae9cfc`, the [quiz opening change](../plans/261005b-quiz-answers-are-kept-and-restored.md#opening-at-the-first-unanswered-question),
reproduced two new opening defects and an older draft-loss race in the panel. These were caught
with a posed server during review; this run did not change any reader's data.

## What failed

The new regressions in [quiz-kept-answers.test.tsx](../../tests/quiz-kept-answers.test.tsx) failed
on the candidate with these observed outcomes:

- An arrival received after the panel began waiting for reading levels requested question 3;
  the panel showed question 2, in both ordinary rendering and StrictMode.
- A 404 followed by the same batch returning should have reopened at unanswered question 2;
  the panel showed answered question 1.
- Reading levels excluding the open question arrived in the same commit as an arrival requesting
  that question. The heading stayed correct, but the draft became empty.

## The class: cursor priority is not navigation priority

An arrival's final cursor write cannot undo an earlier effect's draft deletion or mark cancellation.
The filter called `move` before the arrival effect. The arrival then wrote the requested index
last, leaving the right question above an empty box. Priority must be resolved before cleanup,
not just before deciding which index wins.

The opening effect had two related lifetime mistakes. It omitted arrival from its dependencies
while waiting, so it did not observe a later explicit destination before the arrival was consumed.
Turning off the reading filter then woke the opening effect with no arrival left, and its automatic
choice overruled the explicit one. Its completion marker also survived a null quiz even though
the cursor and draft reset there; the same batch returning was incorrectly treated as already open.

Both opening defects were introduced by `5d5ae9cfc`. The filter arrived in `96d54a221` and arrivals
in `2255f2e37`, making their competition reachable. `3ca876471` made the arrival win the cursor
without preventing the filter's earlier answer cleanup. Provenance was checked in a read-only
root-cause subagent against those commits.

## Why the existing tests passed

The opening tests supplied an arrival at mount, never after initialization had begun waiting.
The integration fixture also cleared a module variable without scheduling the parent render that
`Reader` schedules when it clears an arrival. No test made a quiz disappear and return with the
same identity. Existing same-question arrival cases did not activate filtering in that commit;
the filter/arrival competition case mounted before a draft could exist.

## The fix within the existing design

Pending opening now depends on arrival and clears its completion marker when quiz goes null.
The filter yields to a valid arrival whose effect is about to run, leaving navigation and cleanup
to that effect. Tracking which arrival was handled keeps a stale prop from defeating a later
filter press. Foreign or unknown destinations retain ordinary filtering.

The existing pending-question boundary still holds restoration back until a destination is
committed. Direct opening setters remain safe: no question of that opening has been drawn, and
the batch reset clears the previous batch's answer state.

## What would have caught the class, ranked by ease against value

1. **Real-panel transition tests with realistic parent rerenders.** Added here, with observed
   failures before the fixes. Assert question, answer and attempt together; the right heading
   alone approves the draft-loss defect.
2. **Exercise input ordering and identity reuse.** Deliver explicit navigation before, during and
   after readiness; make data disappear and reappear with the same id; combine navigation with
   filtering while answer state exists. These are small extensions of an existing fixture.
3. **Replace navigation with a state-machine framework.** Rejected for this repair. The panel
   already expresses pending navigation; a framework would add machinery and still require the
   same independent transition tests.

Up: [Postmortems](../project/postmortems.md)
