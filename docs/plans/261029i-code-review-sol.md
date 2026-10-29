# Code review: Quiz answered in the margin

Review of `git diff origin/dev...HEAD`, 2026-10-29. Findings are written here before their fixes, as requested. Line numbers name the pre-fix snapshot (`01cf93e0c`).

## Findings

1. **Medium — `src/web/useQuiz.ts:778-788`; `src/web/marginalia/MarginQuiz.tsx:238-245`: a losing simultaneous submit never adopts the winning mark.**

   State: the band has claimed a question and the reader presses Answer for the same question in the margin. The margin correctly refuses a second paid call, but stores that refusal as an ordinary failed attempt. When the band's mark lands in `kept`, the restore effect refuses every non-null attempt, leaving “Its mark will be here when it lands” on screen permanently even though the mark has landed.

   **Change:** tag this one transient collision attempt and let the late-kept effect replace it with the winning mark while preserving the margin's draft. The red-first regression failed on the stale collision message, then passed.

2. **Medium — `src/web/marginalia/MarginQuiz.tsx:206-214,290-292`: pointer close/switch is allowed while dictation is busy.**

   State: the box is recording or waiting for its transcript and the reader presses this or another question line. The pointer path calls `show` and changes the keeper/done key; the transcript is then “elsewhere” instead of landing in the box it was spoken into. The keyboard Escape path already refuses the same move while `dictate.busy`, so pointer and keyboard disagree.

   **Change:** `show` now refuses every pointer close/switch while dictation is busy. The regression covers both another question and the current question.

3. **Medium — `src/web/marginalia/MarginQuiz.tsx:238-245`: a kept answer arriving late can populate an empty box during live dictation.**

   State: the reader has started speaking while the box still has no live words, and a completed mark from the band/late read enters `kept`. The restore effect sees `typed === ""` and no local attempt, then writes the old answer under the active dictation. The transcript is now appended to an answer the reader did not choose to restore.

   **Change:** the restore refuses while dictation is busy and depends on the busy state so it can reconsider after dictation is idle. The regression watched the old answer clobber the empty live field before the fix.

4. **Medium — `src/web/QuizPanel.tsx:1287-1293`, `src/web/styles/quiz.css:138-139`: the band's answered question has the green but not the specified tick.**

   State: a kept/completed answer is current in the band. The question gets `quiz-answered`, but no `.quiz-tick` is rendered anywhere; the selector is dead. The plan and `docs/project/quiz.md` say the answered question gets green and a tick in margin and band alike.

   **Change:** render an aria-hidden `Check` on the current answered question; the existing textual answered line remains the assistive announcement.

5. **Medium — `src/web/styles/quiz.css:182-186`: the margin Answer button is below the coarse-pointer minimum.**

   State: an iPad/coarse pointer with the margin answer box open. The new Send-shaped button is under `.marg-quiz-actions`, but the 40px rule only matches `.quiz-actions .chat-send`; it remains `var(--control-h)` (about 36px), against `controls.md`'s 40 × 40px rule.

   **Change:** include `.marg-quiz-actions .chat-send` in the coarse-pointer rule.

6. **High — `evals/quiz-models.ts:102-106,245-263`: the blind writing sheets hide the evidence needed to judge the intervention.**

   State: a smaller-prompt batch invents an unsupported premise or gives an answer its cited passage does not support. The blind sheet shows only question and reference answer, so its reader cannot see either failure and can prefer fluent unsupported questions. That invalidates the writing decision rule.

   **Change:** each blind item now includes its premise and every evidence id/quote. A pure regression pins those fields.

7. **Medium — `evals/quiz-models-lib.ts:163-217`; `evals/quiz-models.ts:112-121`: the dry run omits the hidden verdict call after every mark and ignores partial-run flags.**

   State: the full dry run reports 72 calls, but 48 successful mark trials each make a second `quiz-verdict` call: the real ceiling is 120. `--marks-only --dry-run` still printed writes as well. A reader can approve a materially understated run.

   **Change:** the plan now lists mark and verdict separately, includes all 120 physical calls, filters for `--marks-only`/`--writes-only`, and gives the larger-output prompt a conservative uplift. Free dry runs now print full `120 / $7.80`, marks `96 / $2.94`, writes `24 / $4.86`; plan and eval README say about $8.

8. **Medium — `evals/quiz-models.ts:179-194,295-298`: a failed/unparseable verdict is scored as an explicit `unclear`.**

   State: the hidden call times out or returns prose on the hand-labelled `illPosed` case. Production deliberately folds that into no verdict; the eval then stores `"none"` and credits agreement, rewarding a broken classifier.

   **Change:** optional eval-only diagnostics distinguish `judged`, explicit `unclear`, and `failed` without logging or storing production verdicts. Failed hidden calls are counted and excluded from agreement; a regression covers unclear versus invalid output.

9. **Medium — `evals/quiz-models.ts:233-264`: three separate incumbent-vs-arm sheets reveal the incumbent by repetition.**

   State: for one article/run, the same quiz appears in three pair files while each challenger appears once. A blind reader who reads the set can identify the incumbent by sight, and comparisons waste attention repeating it.

   **Change:** one deterministically shuffled A/B/C/D sheet now contains all four writing arms once, with one separate key.

10. **Medium — `evals/quiz-models-lib.ts:141-160`: “dropped questions” adds overlapping evidence counters as though each were a question.**

   State: one rejected question has two bad evidence entries. `unknownIds`, `unquoted`, and `unanchored` can all increment, so the report claims three or more dropped questions for one candidate; malformed evidence also shares the question counter. The arm comparison can penalise evidence-rich output multiple times.

   **Change:** new runs carry an exact optional whole-question count, incremented once per rejected candidate and for the over-cap tail. Stored older artefacts remain readable; their report falls back to only non-overlapping whole-question counters.

11. **Low — `evals/quiz-models-lib.ts:148,157-158`: `blocksBetween` and `longestGap` count the destination anchor, not blocks between anchors.**

   State: questions anchor at block indices 2 and 5. The report says three blocks are “between” them, although only indices 3 and 4 are between them. Adjacent anchors report one instead of zero. This makes both named eval measures off by one.

   **Change:** calculate `max(0, next - previous - 1)` and correct the pure test.

12. **Low — `evals/quiz-models-lib.ts:20-21`; `evals/quiz-models.ts:43,65-88`: arm identity and result directories can mislead a later read.**

   State: the named “sonnet” constants were evaluated before `loadEnvLocal`, while the runner did not persist the model each call actually reported; a shell override could make the labels false. Separately, every run wrote the same directory, so a failed rerun could leave old blind sheets beside new results.

   **Change:** pin the declared Sonnet arms to the explicit OpenRouter model id, persist each successful call's reported model, and write every run under a timestamped child directory.

13. **Low accessibility — `src/web/marginalia/MarginQuiz.tsx:261-280`: every question-line microphone has the same accessible name.**

   State: a screen-reader button list/rotor contains several Quiz microphones. Each is only “Answer out loud”, with no programmatic association to the question, so the reader cannot tell which one it answers.

   **Change:** associate each microphone with its question text via `aria-describedby` while retaining the concise button name.

14. **Low copy/docs — `src/web/marginalia/tips.ts:84`; `docs/project/quiz.md:510-511`; `src/web/marginalia/MarginQuiz.tsx:19-21`.**

   The tooltip calls *Open in Quiz* a link and says it “opens every question together”, though it is a button that opens the walk at this question. The implementation doc and source comment also refer vaguely to “the follow-up” instead of the actual decision record `q-cj0fv8`.

   **Change:** correct the tooltip and name the decision record.

## Reviewed invariants with no finding

- `useQuizMark` acquires the shared claim only after its early-return cases, and every path after acquisition is inside the same `try/finally`; real fetch cancellation unwinds that `finally`, while the stream has a stall clock and an overall deadline. Unmount, switch, abort, throw and terminal completion therefore release it. The band's marking flow remains the pre-lift implementation.
- `flushSync` is justified: it commits the question-specific dictation keeper before `toggle` asks for microphone permission inside the user gesture. The keyed batch remount, owner-only context, context outside `memo(TableView)`, and `stale: false` derived from the already non-stale `drawnQuiz` are sound.
- The experiment overrides are only reachable through explicit eval arguments; normal production callers do not pass them. Every smaller-prompt replacement is exact-once and the 30-question cap reaches prompt, request and validator.
- The quiet green keeps ordinary ink on a 13% wash; computed contrast remains comfortably above 4.5:1 in both themes. The margin row wraps at 200px, sibling buttons keep valid semantics, and the tick has a textual answered state.

## Checks

- Red-first margin regression: **4 failed, 7 passed** before the fixes — the two dictation lifecycle cases, absent band tick, and stale claim-collision message all failed for their intended reason. After the fixes that file printed **1 file passed, 11 tests passed**.
- Requested command: `npx vitest run tests/marginalia-quiz-answer.test.tsx tests/marginalia-quiz.test.tsx tests/quiz-panel.test.tsx tests/quiz-kept-answers.test.tsx tests/quiz-mark-stream.test.tsx tests/quiz-models-eval.test.ts tests/quiz.test.ts` — **7 files passed, 268 tests passed**.
- Additional hidden-verdict coverage: `npx vitest run tests/quiz-models-eval.test.ts tests/quiz-verdict.test.ts` — **2 files passed, 26 tests passed**.
- `npm run typecheck` could not start `tsx` in this sandbox: it printed `listen EPERM ... /tmp/tsx-1000/14.pipe`. Running the same script without the `tsx` CLI IPC server, `node --import tsx scripts/typecheck.ts`, exited 0 and printed all five projects green, ending **“✓ all 4097 source files are covered by some project”**.
- Free eval checks: full dry run **120 calls, roughly $7.80**; marks-only **96 / $2.94**; writes-only **24 / $4.86**. No model was called.
- Touched-file Biome lint exited 0 with no warnings/errors (three pre-existing complexity infos for `main`, `markAnswerStream`, and `QuizPanel`).
- `npm test` was attempted and could not start the repository-wide lanes because the shared local Postgres was unavailable: `connect EPERM 127.0.0.1:54362`, then **“No database, and every test that touches the store needs one.”** The requested deterministic touched suites above completed independently and passed.
