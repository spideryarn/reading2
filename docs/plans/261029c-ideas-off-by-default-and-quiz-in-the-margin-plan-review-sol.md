I found two serious plan issues; the core implementation approach is otherwise sound.

## Findings

1. **High — Skim will not automatically re-plan when Ideas arrive later.**

   The plan says the next Skim open will re-plan a stale route ([plan:59](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/docs/plans/261029c-ideas-off-by-default-and-quiz-in-the-margin.md:59)). In reality, the automatic run is gated on `status === "none"` ([useSkim.ts:427](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/src/web/useSkim.ts:427)); an existing route remains `ready` while separately marked stale ([useSkim.ts:232](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/src/web/useSkim.ts:232)). The reader instead gets the manual “Plan it again” banner ([SkimPanel.tsx:423](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/src/web/SkimPanel.tsx:423)).

   Failure scenario: import creates a Quotes-only route; the reader later generates Ideas; reopening Skim continues to show the old route until they explicitly request another paid run. The plan should either describe that truth or deliberately add automatic re-planning.

2. **High — changing `AUTO_MODE_STEPS` also changes author-gift preparation, and the plan omits the resulting failing tests.**

   `enqueueMainModesIn` is shared by ordinary publication and gift preparation ([pg-main-modes.ts:6](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/src/store/pg-main-modes.ts:6), [pg-gift-prep.ts:141](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/src/store/pg-gift-prep.ts:141)). Therefore gifts will also stop generating Ideas and will get a Quotes-only Skim route. That may be intended, but the plan does not acknowledge the product change.

   It also lists only `tests/auto-modes.test.tsx` ([plan:68](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/docs/plans/261029c-ideas-off-by-default-and-quiz-in-the-margin.md:68)), while hard-coded expectations in [gift-prep.test.ts:88](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/tests/gift-prep.test.ts:88) and [publication-queues-the-main-modes.test.ts:121](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/tests/publication-queues-the-main-modes.test.ts:121) will fail.

3. **Medium — the planned Quiz completion wiring can issue two sequential refresh requests.**

   `useQuizRead` already refreshes through `useStepFinished` ([useQuiz.ts:535](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/src/web/useQuiz.ts:535)). The plan adds another quiet `useStepJob` completion callback invoking the same refresh ([plan:90](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/docs/plans/261029c-ideas-off-by-default-and-quiz-in-the-margin.md:90)). Both subscribers receive the completion, and `useOrderedRead.refresh` intentionally schedules a trailing read when one is already running ([useOrderedRead.ts:193](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/src/web/useOrderedRead.ts:193)).

   Failure scenario: a margin-started Quiz finishes; the first callback begins a GET, the second arms another GET immediately afterward, causing needless network work and extra Reader/TableView renders. The plan needs one owner for completion refresh.

4. **Medium — three source-of-truth docs would become materially false.**

   The plan has no documentation stage, but:

   - Marginalia currently says opening it never runs another mode ([marginalia.md:23](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/docs/project/marginalia.md:23)).
   - Quiz says questions appear in the prose in every mode ([quiz.md:438](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/docs/project/quiz.md:438)).
   - Skim says automatic planning finds Ideas first ([skim.md:245](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/docs/project/skim.md:245)).

   Failure scenario: a later change follows these documents and restores prose questions, assumes opening the margin has no AI cost, or incorrectly restores Ideas as an import prerequisite.

5. **Medium — the browser check cannot exercise the risky auto-run interaction.**

   The proposed check uses an article that already has Quiz data ([plan:132](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/docs/plans/261029c-ideas-off-by-default-and-quiz-in-the-margin.md:132)). It therefore cannot prove the arrival run, completion refresh, or simultaneous margin-plus-band behavior.

   Add automated coverage for:

   - Margin and a press-armed Quiz band mounting together with no Quiz: exactly one POST.
   - Hidden margin, visitor, and awaiting-Structure states: no POST.
   - One completion causing one Quiz refresh.
   - Wide margin: margin card only; narrow/band-covering layout: prose question retained.

## Requested technical checks

- **Skim filtering is correct:** filtering its queued reads against the new automatic-mode set leaves `["quotes", "skim"]`, so the Skim job still retries Quotes. Do not change the general `STEP_READS` relationship.
- **The server accepts missing Ideas:** the pipeline explicitly plans from Quotes alone ([pipeline.ts:5926](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/src/pipeline.ts:5926)); only missing usable Quotes blocks it ([pipeline.ts:5974](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/src/pipeline.ts:5974)).
- **Shared Quiz auto-attempt is safe:** both hooks call the same atomic `(slug, step)` claim ([jobEngine.ts:490](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/src/web/jobEngine.ts:490)). One wins and starts the job; the other declines. I see no inherent lost or double run, but it deserves the test above.
- **`marginRoom` is the right suppression condition:** it is true only when the margin is open and has actual width ([Reader.tsx:756](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/src/web/reader/Reader.tsx:756)). Narrow/band-covering layouts retain the prose question; visitors have no Quiz artefact or auto-run capability.
- **TableView cost should be modest** if the new context value and anchored-question map are memoized. The unavoidable render is when Quiz data arrives. Avoid copying Quiz into `ownerFeed`; derive its margin notes from the existing Quiz read, and fix the duplicate-refresh path above.
- **Transitional exception:** already-queued database jobs contain explicit step arrays ([pg-main-modes.ts:87](/var/tmp/spideryarn-worktrees/fbshwpw5-ideas-off-quiz-in-margin/src/store/pg-main-modes.ts:87)), so jobs queued before deployment may still buy Ideas. New imports will not.