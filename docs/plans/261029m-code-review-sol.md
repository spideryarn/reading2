# GPT Sol's code review of plan 261029m (fixing as it went)

For [261029m](261029m-quiz-green-for-right-and-a-quiet-time-to-recall-again.md); what was done with each finding is in its § The code review.

1. **F1 — High — `src/web/QuizPanel.tsx:929`, `src/web/marginalia/MarginQuiz.tsx:231`.** A late due answer bypassed the empty-recall rule after a cross-surface `claimedElsewhere` collision. **FIXED:** due answers are now withheld before collision replacement. Red-first tests cover both surfaces and confirm a subsequent fresh winner still replaces the collision without destroying the losing draft.

2. **F2 — Medium — `src/web/QuizPanel.tsx:1361`, `src/web/marginalia/MarginQuiz.tsx:191`, `src/web/QuizPanel.tsx:1680`.** “Show my earlier answer” appeared usable during dictation but silently did nothing; after a valid reveal, focus fell away from the answer box. **FIXED:** the button is natively disabled during dictation/marking, and both surfaces return focus and the caret to the textarea after revealing.

3. **F3 — Medium — `src/web/QuizPanel.tsx:1262`.** The band omitted the promised spoken answered/right/due state, and a locally edited right answer lost all green rather than stepping down to answered. **FIXED:** the band now uses the shared spoken suffix and preserves plain answered green for different words while removing the right claim.

4. **F4 — Low — `src/web/QuizPanel.tsx:1385`, `src/web/marginalia/MarginQuiz.tsx:406`.** Every restored mark received due-recall wording, even an ordinary fresh answer revisited with Previous. **FIXED:** “earlier answer / from memory” copy is restricted to due answers; ordinary restored edits retain “previous answer” wording.

5. **F5 — Low — `src/web/QuizPanel.tsx:1689`.** The relative recall date lacked the project’s exact-timestamp companion. **FIXED:** it is now a semantic `<time>` with the exact timestamp in its tooltip and screen-reader text.

6. **F6 — Low — `tests/quiz-kept-answers.test.tsx:318`, `tests/quiz-panel.test.tsx:180`.** Existing fixtures used fixed October timestamps, making ordinary restored answers due, and direct panel tests supplied impossible `attempt.verdict` state without matching shared `kept`. **FIXED:** fixtures now use fresh relative times and production-shaped kept verdicts. Premise and Where-to-look-again tests remain green.

7. **F7 — Low — `src/web/useQuiz.ts:121`.** Comments still claimed verdicts were never rendered and referred to the deleted verdict effect. **FIXED:** comments now describe the shared in-memory verdict and restored-mark purpose accurately.

8. **F8 — Low — `src/web/QuizPanel.tsx:388`, `src/web/marginalia/MarginQuiz.tsx:271`, `src/web/useQuiz.ts:769`.** Biome still reports existing cognitive-complexity advisories in these large functions. **NOT FIXED:** reducing them requires a broader component/hook extraction outside this review’s small-fix scope.

Verification:

- All requested suites passed: 217 tests across six files.
- Typechecking passed for all 4,111 covered source files. The literal `npm run typecheck` launcher was blocked by the sandbox’s IPC restriction (`EPERM`); the identical script passed via `node --import tsx scripts/typecheck.ts`.
- Scoped lint has no errors, only F8’s advisory.
- Light/dark contrast remains above relevant text/icon thresholds.
- No contradictions found in `quiz.md`, `privacy.md`, `marginalia.md`, or `learning-vision.md`.
- No `Date.now()` render-state or StrictMode defect found.
- No commit made.

Files edited:

- `src/web/QuizPanel.tsx`
- `src/web/marginalia/MarginQuiz.tsx`
- `src/web/styles/quiz.css`
- `src/web/useQuiz.ts`
- `tests/marginalia-quiz-answer.test.tsx`
- `tests/quiz-kept-answers.test.tsx`
- `tests/quiz-panel.test.tsx`