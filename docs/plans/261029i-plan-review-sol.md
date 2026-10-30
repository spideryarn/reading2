I would not approve the plan unchanged. The main blockers are shared verdict state and an eval arm that currently cannot test thirty questions.

Line references below are against committed `HEAD` (`9b6785b25`), because another process began editing the shared worktree during the review. I made no edits.

1. **High — Margin answers lose the verdict needed by Quiz’s adaptive behavior.**

   The plan shares only `kept` through `useQuizRead` (`docs/plans/261029i…md:50-59`). But `QuizRead.noteMark` carries answer/reply/time, not verdict (`src/web/useQuiz.ts:319-327`), while the band’s verdict map is private to `QuizPanel` (`src/web/QuizPanel.tsx:468-491,917-932`). Therefore a margin answer can be ticked and restored, but opening it in Quiz produces a `restored` attempt that the verdict effect deliberately ignores. The next premise and “Where to look again” will behave as though it was never judged (`docs/project/quiz.md:408-411,610-624`). Green also cannot reliably appear in both surfaces.

   Fix: put an ephemeral, batch-keyed verdict map in `useQuizRead`, updated by every completed mark. A newer completed mark with no verdict must delete the previous verdict; restored marks must not. Expose it to both band and margin, and clear it on article/batch replacement. Keep it entirely client-side—never stored or logged.

2. **Medium — Independent hooks weaken the one-live-request invariant and leave batch/close lifecycle gaps.**

   The existing guard is a local ref (`src/web/useQuiz.ts:726-779`). With one hook in the band and one per margin note, the same question can be submitted twice while band and margin are both visible, buying two marks and racing two results into `noteMark`. Different blocks being open is harmless; duplicate marking of the same question is not.

   A replacement batch is another gap: `QuizNote` currently has the static key `"quiz"` (`src/web/marginalia/MarginaliaColumn.tsx:392-394`), while only the band explicitly clears and aborts on a batch change (`src/web/QuizPanel.tsx:523-550`). Toggling a margin box closed also does not unmount its hook, so an unseen request continues unless closure explicitly aborts it.

   Fix: add a shared in-flight acquisition keyed by slug/batch/question to `useQuizRead`; each hook releases it in `finally` and on unmount. Key the margin subtree by `batchId`, and explicitly abort when switching questions within a note. Whether closing a box should abort is a judgment call, but it must be chosen and tested; matching the band means aborting.

3. **Medium — `flushSync` probably works, but it is unnecessary and does not by itself solve restoration.**

   This is not a stale-closure defect: after a synchronous render, `toggle` consults refs such as `latest.current`, and the textarea ref should be committed. But `useDictationField` already tolerates an absent box: it falls back from `box.current` when choosing the insertion point (`src/web/useDictationField.ts:368-415`), and its `requestAnimationFrame` refocus finds a box mounted at the end of the event (`src/web/useDictationField.ts:485-493`). Safari’s privileged `getUserMedia` request happens synchronously inside `toggle` (`src/web/useDictation.ts:1701-1717,2463-2504`).

   The simpler handler is `setOpen(true); dictate.toggle();` in the same press, without `flushSync`. Keep the draft/kept answer in state even while closed so a direct microphone press knows whether it is inserting into an earlier answer. Test both a fresh and a restored answer. This keeps Safari’s gesture and avoids reliance on passive restoration effects running inside `flushSync`.

4. **Medium — The proposed context lacks data required to render a safe mark and may rerender every Quiz note.**

   The plan says `MarginQuizContext` carries only slug and the quiz read (`docs/plans/261029i…md:106-107`). The shared `Mark` also requires the article’s validated block map and jump action for `CitedText` (`src/web/QuizPanel.tsx:1656-1703`). Reader already owns that map (`src/web/reader/Reader.tsx:2656-2673`).

   Also, `useQuizRead` constructs a new return object on every owner render (`src/web/useQuiz.ts:601-616`). Memoising a context value around the whole `read` object therefore does not stabilize it; context consumers beneath `memo(TableView)` will still wake on unrelated owner renders.

   Fix: define a narrow context containing stable fields: slug, current quiz/batch, kept map, verdict map, mark coordination methods, refresh, `blockText`, and `onJump`. Memoise from those fields rather than the whole `QuizRead`.

5. **Medium — Green-on-right is a product judgment, not a consequence of Greg’s words.**

   Greg asked for satisfying, subtle visual feedback, but did not explicitly ask to expose correctness. Green-on-right reverses the stronger existing rule that right, wrong and unjudged look alike (`docs/project/quiz.md:155-177,309-316`). Absence of green will inevitably be read as “wrong”, even though it also means classifier failure or no verdict; the docs already record a real misclassification of the ill-posed case (`docs/project/quiz.md:173-177`).

   My recommendation is green for a completed, current mark—rewarding the act of answering—while the tick remains the durable “answered” state. That preserves the hidden-verdict contract and is closer to “not gamification”. If right-only green is retained, get explicit confirmation from Greg. Either way, superseded drafts must lose green, restored answers should retain only the tick, and the shared visit verdict from finding 1 must drive both surfaces.

   This finding is a **judgment call**, not a mechanical defect.

6. **High — The “up to thirty” prompt arm will still ask for and retain only twenty.**

   The proposed replacement changes only prompt paragraphs (`docs/plans/261029i…md:161-164`), but the user prompt independently says “up to 20” (`src/quiz.ts:957-966`) and validation hard-caps the result at twenty, dropping the tail (`src/quiz.ts:215-225,456-470`). The blind reader would never see questions 21–30, so the experiment cannot measure “more often” as designed.

   Fix: thread an eval-only `maxQuestions` through both `renderPrompt` and validation, defaulting to `MAX_QUESTIONS`. Assert all three replacement points—the system text, user prompt, and validator ceiling. Include the larger possible output in dry-run cost/token estimates. Alternatively, keep the arm capped at twenty and describe it only as “smaller/easier”, not “more often”.

7. **High — Importing the fixed cases directly from `evals/quiz.ts` executes that eval.**

   The plan says the eight cases are imported from `evals/quiz.ts` (`docs/plans/261029i…md:150-157`). That file is an executable with top-level `await withLedger("eval", main)` (`evals/quiz.ts:390-395`). Importing it would run the old eval, spend extra calls, and write its results before the new harness starts.

   Fix: extract `CASES` and its pure scoring helpers into a side-effect-free module such as `evals/quiz-cases.ts`; both eval entry points import that. Do not import one executable eval from another.

8. **Medium — A stream model override must also correct the returned model identity.**

   `messagesWireBody` currently resolves the model internally and the ledger records that resolved value (`src/messages-stream.ts:565-596,645-650`). But `generateQuiz` stamps `quiz.generator` and reports `QuizRun.model` from `generatorFor(power)`, regardless of the wire call (`src/quiz.ts:525-532,1169-1192`). A Haiku arm could therefore be labelled Sonnet even if the ledger is right.

   Fix: resolve the override once, pass that exact model into the wire and ledger, and use `call.model` in the eval result. Explicitly prohibit experiment artefacts from being persisted: their normal prompt version and generator stamp are not production freshness claims. `generationKey` itself is safe if these artefacts remain eval-only; Haiku correctly forms a different generation if one is ever stored.

9. **Medium — The marking decision rule contradicts the existing eval’s human-read contract.**

   The rule accepts Haiku mainly on poisoned-reference behavior, grade words and verdict agreement (`docs/plans/261029i…md:170-174`). But the existing eval explicitly says deterministic counts cannot detect patronising tone or an invented correction (`evals/quiz.ts:53-60`), and names `differentWords`, `elsewhere`, `moreComplete` and `poisonedReference` as the critical qualitative cases (`evals/quiz.ts:25-51`).

   Fix: preregister matched comparisons and qualitative hard failures. Haiku should pass the poisoned case against the article—not merely “match Sonnet”—and produce no severe false correction in those four critical cases across the repeats. Define pairings separately for model and prompt comparisons, randomise A/B, allow ties, and replace “within a few points” with a numeric non-inferiority margin before running. With only two articles, avoid treating a few percentage points as meaningful precision.

10. **Low — The test plan omits the riskiest layout and interaction paths.**

   The column can be only 200px wide (`src/web/layout.ts:541-555`), and the current coarse-pointer floor covers only the whole question button (`src/web/styles/marginalia.css:566-570`). The planned tests (`docs/plans/261029i…md:189-197`) do not cover the direct microphone press, minimum-width wrapping, or keyboard disclosure semantics.

   Add checks for:

   - Microphone and question as sibling buttons—never nested interactive controls—with accessible names.
   - `aria-expanded`/`aria-controls`, focus after keyboard opening, and stopped key bubbling.
   - 40px microphone/send targets on coarse pointers.
   - The textarea, actions and *Open in Quiz* at the 200px margin width.
   - ResizeObserver relayout while a streamed mark grows.
   - Same-handler microphone start on Chromium and WebKit/Safari.
   - Closing, batch replacement and StrictMode replay while a mark is active.

The visitor gate itself looks sound: Quiz notes are still produced only from the owner’s `drawnQuiz` (`src/web/reader/Reader.tsx:2893-2896`). `memo(TableView)` can also remain intact if the context is narrowed as above.