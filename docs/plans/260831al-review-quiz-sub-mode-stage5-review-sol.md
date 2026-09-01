## 1. Does each fix close the finding?

1. **No-grade rule — unresolved by design.** The new `gradeWords` counter is instrumentation, not enforcement. It also misses two verdicts already identified in the committed run: “fair too” and “backs this fully” both count as zero. Removing the production log field at [src/quiz-mark.ts:798](/home/greg/code/spideryarn2/src/quiz-mark.ts:798) would leave all counter tests green.

2. **Revision consistency — no. The race was narrowed, not removed.** The second `loadQuiz` at [src/routes.ts:1290](/home/greg/code/spideryarn2/src/routes.ts:1290) catches the tested A→B publication. It still accepts:

   - quiz/question read from revision A;
   - article prose read from revision B;
   - revision C published before the second check, carrying the same batch and restoring A’s fingerprint.

   The second check sees a current quiz again and accepts B’s prose beside A’s question. The comment explicitly acknowledges this ABA case.

   A smaller fix than adding a revision-scoped store API is available: compare the loaded article itself with `found.quiz.sourceHash`, using Quiz’s existing input fingerprint. That binds the question directly to the exact prose/meta/tree being sent and removes the ABA window.

3. **Token-ceiling truncation — yes for the named input.** `finish_reason: "length"` now throws before `done` at [src/quiz-mark.ts:746](/home/greg/code/spideryarn2/src/quiz-mark.ts:746). Partial text remains retryable.

   A sibling remains: the code’s own comment lists `"error"` as a normalized finish reason, but `didNotFinish` accepts it. Partial text plus `finish_reason: "error"` and `[DONE]` is therefore still filed as complete. `"tool_calls"` is also accepted deliberately despite this request supplying no tools.

4. **Eval successful-failure summary — mostly closed.** The report now gives honest obtained/attempted denominators and an unmistakable warning at [evals/quiz.ts:619](/home/greg/code/spideryarn2/evals/quiz.ts:619). Eight failures also exit non-zero.

   Partial failure still exits zero: one successful mark plus seven failures is a successful process. It no longer reports eight marks, so the original silent lie is gone, but exit status alone still does not mean eight inspectable replies were produced.

5. **Attempt binding — only partly closed.**

   - A non-empty edited answer is correctly distinguished from the marked answer.
   - Batch replacement correctly calls the already-aborting `clearAttempt`.
   - An empty box deliberately bypasses the guard at [QuizPanel.tsx:238](/home/greg/code/spideryarn2/src/web/QuizPanel.tsx:238). After select-all/delete, the screen again shows an empty current answer beside feedback for the deleted answer and still says “answered.” That is the original hole.

6. **Abort wiring — only after SSE has opened.** Once [sse](/home/greg/code/spideryarn2/src/routes.ts:735) has installed its `close` listener, the provider signal is genuinely aborted and the generator correctly returns without `done`.

   A disconnect during `loadQuiz`/`loadArticle`/the second `loadQuiz` happens before `sse(res)` at [src/routes.ts:1292](/home/greg/code/spideryarn2/src/routes.ts:1292). The close event is missed; the subsequently created `gone` signal remains live, and the provider call may still start on an already-destroyed response.

## 2. What did the fixes break?

I found no broad regression in the normal successful path. The significant changed behaviours are:

- Any `"length"` completion is rejected even if it happens to end on a coherent sentence. That is a conservative false positive, but it is the right side of this invariant.
- Partial `"content_filter"` output is now rejected rather than accepted. Also appropriate.
- The answer-binding exception for an empty box creates an ordinary-looking stale mark, as above.
- The revision re-check adds another current-revision read without delivering snapshot semantics.
- The abort change itself behaves correctly after the listener exists; the second-order problem is the missed pre-listener disconnect, not over-aborting valid calls.

## 3. Are the new tests real?

Some are; several prove less than their names claim.

- **Length/content-filter tests:** real for those exact finish reasons. The `"stop"` positive control prevents “reject everything” from passing. They do not cover `"error"` or `"tool_calls"`.
- **Generator abandonment test:** real. Removing the early return after reader abort makes it fail.
- **Route abort test:** real for an already-in-flight provider call. It waits until `fetch` has received the signal before closing, so a route that misses disconnects during the preceding reads still passes.
- **Revision test:** real for one publication between the first quiz check and article read. A re-check passes it; an ABA interleaving or otherwise broken snapshot guarantee also passes it.
- **Edited-answer tests:** good for a non-empty replacement, including useful positive controls. The empty-answer test actively requires the remaining mismatch.
- **Batch replacement test:** proves that the effect calls `clearAttempt`; it does not mount `useQuiz`, hold a live request, or verify cancellation. It would pass if `clearAttempt` were a no-op.
- **Grade-word tests:** prove the substring detector recognizes its listed phrases. They do not prove every real mark is logged, and they miss semantic verdicts outside the list.
- **Eval summary:** there is no committed test for failure accounting or exit status. Reintroducing the constant mark count or removing the all-failed exit code would not fail these tests.

The repository cannot prove the tests were watched red interactively; the mutation sensitivity above is what the committed evidence supports.

## 4. Finding 1: no-grade

No prompt change was attempted in this fix, and there was no new eight-case evaluation. The committed [evals/results/quiz.md:274](/home/greg/code/spideryarn2/evals/results/quiz.md:274) predates the fixes and still uses the old `marks: 8` format.

That run remains:

- three explicitly detected grading phrases;
- at least two further verdicts the counter misses;
- therefore no evidence of improvement.

Given the earlier identical-prompt runs scoring 0 and 3, an apparent movement inside one eight-case rerun would indeed be inside the observed noise. If “no grade” is accepted as a strong preference, the added metric is reasonable operational evidence—but it is an incomplete proxy, not an invariant. If it remains an invariant, it is still unfixed.

## Verdict

**No, not shippable yet—even granting the product decision that no-grade is a preference rather than an invariant.**

The smallest ship-enabling pass is:

1. Compare `found.quiz.sourceHash` directly with the fingerprint of the exact loaded article, replacing the second current-revision re-check.
2. Observe response closure before the asynchronous reads, or initialize the cancellation signal as aborted when the response is already destroyed.
3. Treat an empty edited box as superseded, with copy that omits “Press Answer” while the button is disabled.
4. Reject `finish_reason: "error"`; strongly consider `"tool_calls"` too for a request that supplies no tools.

No files were changed.