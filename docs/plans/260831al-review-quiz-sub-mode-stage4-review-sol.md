## Findings

1. **Blocker — the no-grade rule is not enforceable by this prompt, and the committed eval shows it leaking.**  
   [src/quiz-mark.ts:241](/home/greg/code/spideryarn2/src/quiz-mark.ts:241), [src/quiz-mark.ts:408](/home/greg/code/spideryarn2/src/quiz-mark.ts:408), [evals/results/quiz.md:130](/home/greg/code/spideryarn2/evals/results/quiz.md:130)

   The prompt bans inventories and overall assessments, then asks for the supported part, the missing part, and—when nothing is missing—to “say so.” The final instruction, “Tell them how their answer sits,” reinforces the grading frame. The eval consequently produces three explicit banned verdicts, including “correctly tied together,” “correctly described,” and “tracks the article.” It also produces unflagged verdicts such as “fair too” and “backs this fully.”

   More seriously, `elsewhere` calls Seth’s proposed remedy something the answer “doesn’t mention,” although the question only asks what goes wrong. That appears to treat material in the reference answer as required despite the entitlement rules. The poisoned-reference and ill-posed cases do side with the article, so that rule works on those inputs; “different answers are not wrong” and “no grade” do not hold reliably.

   **Confidence: certain; this is observed output, not a prediction.**

2. **Blocker — the batch check and article read are not from the same revision.**  
   [src/routes.ts:1197](/home/greg/code/spideryarn2/src/routes.ts:1197), [src/routes.ts:1220](/home/greg/code/spideryarn2/src/routes.ts:1220), [src/store/pg.ts:1839](/home/greg/code/spideryarn2/src/store/pg.ts:1839), [src/store/pg.ts:2452](/home/greg/code/spideryarn2/src/store/pg.ts:2452)

   `loadQuiz` reads and validates revision A. Later, `loadArticle` independently resolves the current revision again. If a new article revision is published between those awaits, the route returns 200 and sends the model revision A’s question/reference/evidence with revision B’s article. The marker can therefore assess an answer to the old question against changed prose.

   A quiz-only forced regeneration after `loadQuiz` does not substitute another question—the captured object remains the old one—but a concurrent article publication defeats the source-staleness guarantee. The prior plan review explicitly required all four inputs from the same revision; that part was not implemented.

   **Confidence: high; the exact failing interleaving is visible in the two independent reads.**

3. **High — output cut off at `MARK_MAX_TOKENS` is reported as complete.**  
   [src/quiz-mark.ts:538](/home/greg/code/spideryarn2/src/quiz-mark.ts:538), [src/quiz-mark.ts:612](/home/greg/code/spideryarn2/src/quiz-mark.ts:612), [src/quiz-mark.ts:667](/home/greg/code/spideryarn2/src/quiz-mark.ts:667)

   When OpenRouter reports `finish_reason: "length"`, it is stored in `finishReason`. Any non-null finish reason is accepted as evidence that the stream finished, and any non-empty partial text then produces `done`. The route sends that frame and the client ticks the question.

   Input: a mark exceeding the 1,200-token ceiling. Result: a visibly truncated reply is presented as successful rather than failed and retryable. The stream tests cover EOF and explicit error frames, but not provider truncation.

   **Confidence: certain.**

4. **Medium — the fourth silent-success bug is the eval’s successful-failure summary.**  
   [evals/quiz.ts:570](/home/greg/code/spideryarn2/evals/quiz.ts:570), [evals/quiz.ts:621](/home/greg/code/spideryarn2/evals/quiz.ts:621)

   A failed marking call is printed and then skipped. The summary nevertheless always says `marks: 8`, while the banned-phrase, invented-id, misplaced-quote and uncited counters include only successful replies. If all eight marking calls fail, the command exits normally and reports eight marks with zero quality failures.

   The check that passes is the natural one: successful process exit plus “marks: 8” and zero counters. The thing being checked—the marker producing eight inspectable replies—can be completely broken.

   **Confidence: certain.**

5. **Medium — an attempt is not bound to the answer currently visible in the panel.**  
   [src/web/QuizPanel.tsx:260](/home/greg/code/spideryarn2/src/web/QuizPanel.tsx:260), [src/web/QuizPanel.tsx:276](/home/greg/code/spideryarn2/src/web/QuizPanel.tsx:276), [src/web/QuizPanel.tsx:318](/home/greg/code/spideryarn2/src/web/QuizPanel.tsx:318)

   After a successful mark, the textarea becomes editable again. Editing it does not clear the reply or answered tick. Until the reader submits again, the screen therefore shows answer B beside a mark computed for answer A, looking entirely normal.

   The same missing invalidation appears on batch replacement: [QuizPanel.tsx:145](/home/greg/code/spideryarn2/src/web/QuizPanel.tsx:145) resets local fields but does not clear the owner’s live attempt. If the old mark is still running, the new batch’s Answer button appears enabled, but [useQuiz.ts:274](/home/greg/code/spideryarn2/src/web/useQuiz.ts:274) silently returns because the hidden old request still owns `live.current`.

   This is the fifth quiet panel rule: the displayed mark must remain bound to the exact displayed answer and batch. The panel tests do not exercise either transition.

   **Confidence: high.**

6. **Medium — leaving the question aborts the browser read, not the paid server call.**  
   [src/routes.ts:740](/home/greg/code/spideryarn2/src/routes.ts:740), [src/routes.ts:1225](/home/greg/code/spideryarn2/src/routes.ts:1225), [src/quiz-mark.ts:549](/home/greg/code/spideryarn2/src/quiz-mark.ts:549)

   The SSE helper notices response closure only to stop writing frames. `markOneAnswer` creates no abort controller and passes no `signal` to `markAnswerStream`. Navigating away therefore leaves OpenRouter generating and spending until completion; a retry can begin another paid call, and telemetry records the unseen first call as successfully marked.

   There is a second half: even if a signal were connected, the generator sets `stopped = true` on reader abort but then continues to the non-empty-reply path and can yield `done`. It needs to terminate after recording abandonment.

   **Confidence: certain.**

I found no ordering defect: [src/quiz.ts:553](/home/greg/code/spideryarn2/src/quiz.ts:553) stores the lexicographically sorted array, the storage round trip preserves array order, and the panel does not sort it again.

## Is this shippable?

No. The smallest ship-enabling hardening pass is: load the quiz and article from one revision snapshot; make `finish_reason: "length"` an error; invalidate/abort attempts when their answer or batch changes; and stop trusting raw streamed model prose to obey the no-grade invariant. The last point needs enforcement before a successful `done`, not another emphatic prompt paragraph—the committed eval already demonstrates that prompt-only enforcement is variable. No files were changed.