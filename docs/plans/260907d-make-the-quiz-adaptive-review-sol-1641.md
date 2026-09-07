I would not build the plan as written. The adaptive ladder is sound, but the correctness signal and navigation state need changing first.

## Findings

1. **Option A puts the most valuable prompt at risk; use a separate classifier.**

   What is wrong: `QUIZ_MARK_SYSTEM` spends substantial effort separating confirmation from grading and explicitly forbids an overall assessment ([quiz-mark.ts](/home/greg/code/spideryarn2/.claude/worktrees/adaptive-quiz/src/quiz-mark.ts:151)). Asking the same generation to decide `GOT` first makes grading its initial framing task. Telling it that the prose must remain unchanged does not remove that conditioning. Eight noisy cases can catch gross “school report” language, but cannot establish that tone, corrections, or generosity stayed unchanged.

   The parsing also has unresolved failure behavior:

   - If the model starts with ordinary prose, the buffered first line must be replayed, not stripped.
   - If it emits no newline, the entire reply remains buffered and streaming disappears.
   - Leading blank lines or a code fence can expose a later `GOT:` line.
   - A malformed `GOT:` line must either leak or be stripped by a heuristic that can delete prose.
   - The plan alternately says “its own SSE frame” and that the verdict “rides the `done` frame.” Those are different protocols. The existing contract is deliberately zero or more deltas followed by one terminal frame ([useQuiz.ts](/home/greg/code/spideryarn2/.claude/worktrees/adaptive-quiz/src/web/useQuiz.ts:55), [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/adaptive-quiz/src/routes.ts:1825)).
   - The extra tokens are immaterial to `MARK_MAX_TOKENS`; contamination and failure handling are the real costs.

   Why it matters: a slightly worse mark is visible on every answer. A missed adaptive move is invisible and comparatively harmless. The risk budget should favor the prose.

   What I would do instead: choose C, with an optional verdict carried only on `done`. Run classification under its own short deadline; classifier failure or malformed output must still finish the mark with no verdict. Abort both calls when the reader leaves. Never log or persist the verdict.

   There is a useful fifth option: classify the completed mark semantically from `{question, reader answer, visible mark}` with a small separate call. That is not option D’s regex. It leaves the marking prompt untouched and avoids sending the whole article twice. Test it against the fixed marking cases first; if it cannot reliably distinguish confirmation, correction, poisoned-reference defense, and an ill-posed question, fall back to a separate classifier over the whole article.

   The plan’s cache argument for C is incorrect. A different classifier system prompt changes bytes before the article, so it cannot read the mark prompt’s cache entry; the project’s caching contract says exactly that ([prompt-caching.md](/home/greg/code/spideryarn2/.claude/worktrees/adaptive-quiz/docs/project/prompt-caching.md:16)). Using the identical system prompt would surrender the isolation C is meant to buy.

2. **The invariant argument is sophistry, although the proposed mechanism is still acceptable.**

   What is wrong: adaptive traversal plainly creates a new encounter order. A path such as easy → medium → hard → medium is not a subsequence of the server’s easy → medium → hard array. Calling it “selection” does not make that fact disappear, and the proposed global “subsequence-by-selection” tripwire is false ([plan](/home/greg/code/spideryarn2/.claude/worktrees/adaptive-quiz/docs/plans/260907d-make-the-quiz-adaptive.md:86)).

   Why it matters: preserving an invariant by redefining “ordering” makes later changes impossible to judge honestly.

   What I would do instead: explicitly amend the invariant:

   > The server remains the sole authority for the static ranking. Adaptive traversal may change cross-band encounter order, but it must preserve the server’s relative order within every band.

   That is the actual design and the proposed per-band test at the end of the plan already approximates it. Keep *Show all twelve* in the untouched server order. Do not move selection server-side merely to preserve the old wording; that would require extra round trips or client-supplied history and would be more machinery for no product gain.

3. **`path + cursor + rung` does not define the navigation behavior.**

   What is wrong: after `A → B → C → Previous to B → pick D from the list`, the proposed state cannot simultaneously preserve:

   - C as already seen,
   - Previous from D returning to B,
   - a unique path,
   - and `cursor + 1` as the displayed question number.

   Appending D makes Previous return C. Truncating C allows it to be selected adaptively again unless there is separate seen state. Recording duplicate visits can make the numerator exceed the number of questions. The plan also does not say whether Next from an earlier cursor follows existing history or calculates a fresh adaptive branch.

   Why it matters: these are ordinary UI actions, not exotic edges, and the wrong implementation will silently repeat questions or apply an old verdict twice.

   What I would do instead: specify the transition table before stage 1: Next at the tail versus inside history; answered, unanswered, failed, and superseded attempts; list picks of seen and unseen questions; Previous followed by a new answer; and batch reset. Keep an explicit unique `seenIds` if navigation history may be truncated or contain revisits.

   I would also remove independent `rung` state. Derive the next target from the band of the question actually being answered. That prevents the hidden rung and the presented question from diverging, handles manual picks naturally, and removes one state variable.

4. **The ladder edges need a total rule, and manual selection should not suppress learning from the answer.**

   What is wrong:

   - “Direction of travel, then the other way, then anything” is undefined when there was no verdict, including a skip or failed mark.
   - A batch shorter than `SPREAD_FROM` need not contain any easy question ([quiz.ts](/home/greg/code/spideryarn2/.claude/worktrees/adaptive-quiz/src/quiz.ts:345)), so “the first question is … easy” is false. It is merely the easiest band available.
   - The plan conflates picking a question with answering it. Picking from the list should not itself change difficulty, but a finished answer to that question is still precisely the evidence Greg asked adaptivity to use.

   What I would do instead: from `currentQuestion.band`, compute the bounded target:

   - right: one band harder;
   - wrong: one band easier;
   - no trustworthy verdict: same band.

   Search the target first, then continue in the verdict’s direction, then reverse; with no verdict, prefer the same band, then the nearer easier band, then harder. Within each band, always take the first unseen question in server order. This exhausts all bands explicitly, so “then anything” disappears.

   A struggling reader can eventually receive a hard question when every easier question has been exhausted. That is unavoidable if all questions remain available and the quiz does not auto-end; document it as exhaustion, not successful adaptation.

5. **`partly` is scope creep and the wrong third state.**

   What is wrong: it changes Greg’s explicit binary rule and introduces a fuzzy category likely to absorb a large fraction of answers. That can make the ladder mostly stationary while appearing adaptive.

   Why it matters: the distinction between “partly but sufficient” and “partly and materially wrong” is exactly the difficult grading decision the marking prompt already handles carefully.

   What I would do instead: have two decision values plus absence:

   - `yes`: nothing materially missing or contradicted;
   - `no`: a contradiction or omission changes whether the question was answered;
   - no verdict: ambiguous meaning, an unsettled question, classifier failure, or malformed output.

   A partial answer is therefore not automatically a third class. It is `yes` if sufficient and `no` if the missing part matters. Absence holds the band as a safety behavior, not as a third grade.

6. **The simulated-reader measurement is circular.**

   What is wrong: defining a reader as “yes on easy and medium, no on hard” and then showing that the ladder moves according to those values proves the transition code follows its own rule. It does not show that the bands suit a real reader or that the classifier produces the right signal.

   What I would do instead:

   - Keep the simulation, but call it an acceptance test or worked trace.
   - Hand-label the existing eight marking cases with expected binary verdicts, add at least one materially partial and one genuinely ambiguous case, and test the classifier against those labels. Repeat enough to expose model variance.
   - For actual product evidence, conduct a small manual run in which a reader answers normally and independently judges whether each next question was an appropriate move. Record only the question/band sequence and expected transition, not their answer text.

7. **No automatic ending after wrong answers is the right v1 decision.**

   I agree with the plan here. Ending after three hidden `no` verdicts would reveal a judgement more strongly than any difficulty label, and classifier noise could terminate a useful quiz. Continuing is not forced grinding: the reader still chooses whether to press Next or answer.

   I would remove the suggestion that adding it later is merely “one counter and one sentence.” That sentence would expose hidden grading and needs a fresh product decision, not a cheap implementation follow-up.

**Verdict: build it with the changes above.** Specifically: isolate correctness classification from `QUIZ_MARK_SYSTEM`, use binary verdicts plus absence, put the optional verdict only on the terminal `done`, rewrite the ordering invariant honestly, derive difficulty from the current question rather than independent rung state, and fully specify navigation before implementing the panel.