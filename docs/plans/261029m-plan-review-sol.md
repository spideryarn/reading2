# GPT Sol's review of plan 261029m (read-only, before the build)

For [261029m](261029m-quiz-green-for-right-and-a-quiet-time-to-recall-again.md); what each finding changed is in its § The plan review.

Found 10 issues. F1, F2, F3, and F5 should change the plan before implementation continues.

**F1 — High — Two verdict records will disagree after a margin answer.**

The plan puts the verdict in shared `kept`, but deliberately leaves `QuizPanel.verdicts` separate (`docs/plans/261029m-quiz-green-for-right-and-a-quiet-time-to-recall-again.md:79`). That local map is updated only from the band’s `attempt` (`src/web/QuizPanel.tsx:921`). A margin answer can therefore turn both surfaces deeper green while the band still shows the next premise and omits—or retains stale—*Where to look again*. A later margin re-answer with no verdict also cannot clear an older band verdict.

Fix: make the shared `kept` entry the sole verdict source. Derive `QuizPanel`’s verdict map from `kept`, deleting the local verdict state/effect. Test margin-right → premise hidden, margin-wrong → section offered, margin no-verdict → old verdict cleared, same-row revalidation → verdict retained, and a newer server row → verdict removed.

**F2 — High — Rendering the classifier invalidates the reason it was allowed to be cheap and fallible.**

The existing design explicitly says classifier mistakes are acceptable because they are invisible and only affect scaffolding (`docs/project/quiz.md:162`, `docs/project/quiz.md:174`). The plan now exposes that output as positive feedback, despite the known ill-posed case judged `right` (`docs/plans/261029m-quiz-green-for-right-and-a-quiet-time-to-recall-again.md:123`). Screenshots and stubbed streams cannot evaluate this risk.

Fix: add a verdict-quality gate before shipping the deeper green, including the known ill-posed case and false-positive acceptance criteria. If the eval cannot run until 1 November, ship answered/due first and hold right. Describe it consistently as “the check thought this looked right,” not as ground truth.

**F3 — High — “Show my earlier answer” can destroy the recall draft.**

The plan says the button should restore the earlier answer into the box (`docs/plans/261029m-quiz-green-for-right-and-a-quiet-time-to-recall-again.md:100`). Existing restoration replaces `typed`; the implementation now appearing in the worktree does exactly that (`src/web/marginalia/MarginQuiz.tsx:191`). If the reader tries from memory and then asks to compare, their new answer is silently overwritten.

Fix: reveal the earlier answer and mark below the draft without changing the textarea. At minimum, refuse replacement once the draft is non-empty and explain why. Test that typed and dictated drafts survive disclosure.

**F4 — Medium — Cross-surface drafts can receive a right look earned by different words.**

The band and margin may each hold a draft while only one has a mark. The losing draft is intentionally preserved (`tests/marginalia-quiz-answer.test.tsx:368`). But the proposed look comes directly from shared `kept`; the band’s `superseded` check only works when it has its own `attempt`, and the margin ignores its visible draft when choosing the line’s look (`src/web/marginalia/MarginQuiz.tsx:268`). Thus answer A can be judged right while answer B is visibly in the box under a deeper-green question.

Fix: associate the displayed right state with the exact answer. When an open draft differs from `kept.answer`, suppress or downgrade `right`. Test both directions: band draft/margin mark and margin draft/band mark.

**F5 — High — The split margin/band spacing behavior can reset the timer without any recall.**

The plan intentionally opens due questions empty only in the margin; the band restores the old answer (`docs/plans/261029m-quiz-green-for-right-and-a-quiet-time-to-recall-again.md:104`). The reader can submit those already-visible words again, producing a fresh `answeredAt` and clearing due without retrieving anything. Due questions also still count as answered when the band chooses its first unanswered question (`src/web/QuizPanel.tsx:609`), so the spacing prompt can be skipped entirely.

Fix: choose one coherent v1:

- Simpler: due is indication-only everywhere; do not claim the feature performs retrieval.
- Actual recall: due questions are actionable in resume/list ordering and open empty in both surfaces.

Do not let merely resubmitting the restored old answer reset the spacing state.

**F6 — Medium — “Never as words” conflicts with the accessible design.**

The constraint says the verdict is never rendered as words (`docs/plans/261029m-quiz-green-for-right-and-a-quiet-time-to-recall-again.md:50`), while the accessibility text explicitly says “answered, and it looks right” (`docs/plans/261029m-quiz-green-for-right-and-a-quiet-time-to-recall-again.md:98`). Removing that text would make the distinction color/icon-dependent.

Fix: change the rule to “no unqualified grade, score, or evaluative sentence in the mark.” Permit equivalent accessible wording such as “the check thought this looked right,” and preferably expose the same qualification in a tooltip for sighted readers.

**F7 — Medium — The three-day clock contract is underspecified.**

“More than three days,” whole-day display, and the planned “four days old” test do not define whether due begins at 72 hours, after three complete days, or at 96 hours (`docs/plans/261029m-quiz-green-for-right-and-a-quiet-time-to-recall-again.md:55`). `answeredAt` is server time while `now` is the device clock; a wrong laptop clock can make a fresh answer immediately due. Computing only during render also means an open page does not become due at the threshold.

Fix: define `dueAt = answeredAt + 72 hours`, compare instants rather than local calendar dates, clamp future ages, and establish a server-clock offset from the quiz response. Refresh at the nearest deadline or on visibility/focus. Test 72h−1ms, exactly 72h, +1ms, timestamps spanning DST/offset changes, future timestamps, and fake-time threshold crossing.

**F8 — Medium — The proposed microphone test cannot prove the keeper binding.**

The relevant test file mocks dictation as unsupported and its `toggle` does nothing (`tests/marginalia-quiz-answer.test.tsx:58`). A test that merely observes an empty box after pressing the microphone cannot detect a recording bound to `quiz:<slug>:` rather than the due question—the failure the synchronous render exists to prevent.

Fix: use a controllable dictation mock that records the keeper key at `toggle`, then completes a transcript. Assert the key names the due question and the transcript lands in that box. Also release a late kept read during dictation and verify it never fills the deliberate vacancy.

**F9 — Low — The privacy claim is imprecise, and the privacy reasoning doc is omitted from Stage 3.**

The public privacy page does not promise that right/wrong is unkept; that statement exists only in a source comment (`src/web/PrivacyPage.tsx:213`). The internal privacy doc says the hidden verdict lives in the panel for the visit (`docs/project/privacy.md:974`), which becomes stale once it moves to the shared read and is visibly represented. Stage 3 does not list that doc.

Fix: say “the project’s privacy record,” not “the public page’s promise,” and update `privacy.md` to say the verdict is held in shared in-memory quiz state, rendered as a qualified visual indication, and never stored or logged. No public-page change is needed for this non-persistent version; storing it later would require an explicit public disclosure and test.

**F10 — Low — The evidence does not select a three-day interval.**

The cited study tested whether retrieval beat rereading on a final test two days later; it did not compare two-day and three-day retrieval schedules (`docs/research/261010a-reading-and-learning-evidence/01-retrieval-practice.md:44`, `docs/research/261010a-reading-and-learning-evidence/01-retrieval-practice.md:113`). “Three is the nearest round number past that” overstates what the result supports.

Fix: call three days a product heuristic chosen for a week-long reading pattern. Cite the actual equal-versus-expanding spacing work separately if retained, and define what observation would cause the interval to change.

No files were edited. During the review, another process began an uncommitted implementation in `useQuiz.ts`, `MarginQuiz.tsx`, and `QuizPanel.tsx`; I used those live lines only where they made a plan hazard concrete.