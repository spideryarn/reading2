## 1. Medium — the reader message is factually wrong after validation

The gate correctly measures survivors, but the message calls the survivor count the number the AI “wrote.” `toQuestions` can discard questions before `fresh.length` is computed ([src/quiz.ts:569](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/quiz.ts:569)), yet the message says the service wrote that number ([src/quiz.ts:601](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/quiz.ts:601)).

I reproduced this with 12 returned questions, seven unanchored and five surviving. It reports:

> The AI service wrote 5 questions…

That fails copy rule 1’s more basic requirement: accurately say what happened. The existing test only supplies five entirely valid questions, so it cannot catch this ([tests/quiz.test.ts:297](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/tests/quiz.test.ts:297)). “Five usable questions were left after checking…” would be accurate.

The following clause also overstates the consequence. A batch containing easy and medium questions but no hard one still builds from easier to harder; it merely does not reach the hard end ([src/quiz.ts:602](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/quiz.ts:602)). “Would not cover the full range from easier to harder” is closer.

`missingEndsInReaderWords` produces correct text for all three reachable non-empty results. It is not total: `missingEndsInReaderWords([])` incorrectly says there is no hard question ([src/quiz.ts:337](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/quiz.ts:337)). The current caller guards that case, so this is maintainability rather than a runtime bug.

## 2. Medium — the prompt now discloses a weaker floor that contradicts its stronger instruction

Keeping the three-of-each request is right. The model does not observe the gate, and there is no learning loop that would cause gradual “drift over time.”

However, the prompt says both:

- A full batch “must” have three of each.
- Only a batch with nothing at one end is thrown away.

Those are competing definitions of “not optional” ([src/quiz.ts:801](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/quiz.ts:801)). Revealing the lower enforcement floor can weaken compliance immediately by making one-per-end look sufficient.

The button-level UX is noise to the model. It cannot press the button or improve that interaction, and the detailed consequence distracts from the output instruction. I would keep the three-of-each instruction and simply remove the false retry consequence, as the plan originally specified. If the floor must be mentioned, explicitly label three as the target and one-per-end as the minimum rather than calling both mandatory.

The prompt test only confirms the unchanged three-of-each text; it does not prove that the false “article is asked again” claim was removed or prevent its return ([tests/quiz.test.ts:618](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/tests/quiz.test.ts:618)).

## 3. Low-to-medium — truncation can still manufacture a spread failure

This is a real, pre-existing defect, not a regression in `missingBandEnds`.

`toQuestions` stops as soon as the first twelve survivors have been collected ([src/quiz.ts:481](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/quiz.ts:481)). The spread gate then sees only those twelve ([src/quiz.ts:598](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/quiz.ts:598)).

I reproduced a response with thirteen valid questions whose only hard question was thirteenth. The cap discarded it and the whole batch then failed for having no hard question. Merely moving the gate before truncation would be wrong because the stored twelve would still lack an end; fixing this requires cap selection that preserves an easy and hard survivor.

It is probably infrequent because the prompt asks for at most twelve, so I would not block the central stage-1 fix on it. But it contradicts the intended “over-cap degrades rather than fails” behavior and deserves either a test/fix now or an explicit deferral.

## 4. The core gate, boundary, and type are correct

`missingBandEnds` directly represents the intended invariant and correctly returns each absent end once ([src/quiz.ts:322](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/quiz.ts:322)). Measuring `questions.length` is right because these are the survivors that would enter the artefact.

`SPREAD_FROM = 4` exactly preserves the old boundary: `floor(n / 4)` first became non-zero at four. The tests cover both sides explicitly at three and four ([tests/quiz.test.ts:208](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/tests/quiz.test.ts:208), [tests/quiz.test.ts:222](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/tests/quiz.test.ts:222)).

The plan itself contains a wording contradiction: it says to preserve `bandQuota(3) === 0`, then calls demanding spread from four padding ([plan:160](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/docs/plans/260903c-fix-quiz-build-band-spread-failure-and-lost-quiz-answers.md:160)). The implementation chose the unambiguous requirement—preserve existing behavior—and the project doc is coherent.

`QuizBandEnd` is a good narrowing. It makes an impossible `medium` result a type error ([src/quiz.ts:229](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/quiz.ts:229)). Exporting it is harmless and reasonable because it appears in an exported function signature, though no present external caller uses the name.

## 5. Message classification and tests

The message is privacy-safe: it exposes no provider body or article content. Its action is useful, though “Writing the questions again…” would match the visible button better than “Asking again.”

It does violate the documented convention that reader-facing failure messages live in `messages.ts` and end in a bracketed code ([copy.md:8](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/docs/project/copy.md:8), [copy.md:90](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/docs/project/copy.md:90)). This should become a `ReaderFacingFailure` with `kind: "retry"` and its own code in stage 2.

Importantly, the missing code does not currently make retryability wrong. Jobs already call `failureKindOf` ([src/jobs.ts:741](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/jobs.ts:741)); an uncoded message produces `undefined`, and undefined deliberately remains retryable ([src/job-failure.ts:126](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/job-failure.ts:126)). It does make the classification implicit and would cause stage 2’s generic fallback to replace this useful copy unless it is migrated as planned.

The new assertions are not accidentally matching old arithmetic in the way `.toThrow(/easy/)` did. The reachable helper branches and production case are genuinely exercised. Two smaller weaknesses remain:

- The table claims to cover every gated size but skips 6, 7, 10, and 11 ([tests/quiz.test.ts:169](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/tests/quiz.test.ts:169)). The direct 3/4 boundary is covered, but generating 4–12 would fulfill the stated intent and guard against future size-dependent arithmetic.
- Several comments and a test name still say “quotas,” although quotas were deleted ([tests/quiz.test.ts:2](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/tests/quiz.test.ts:2), [tests/quiz.test.ts:618](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/tests/quiz.test.ts:618)).
- The copy test claims to exclude band vocabulary, but explicitly requires the unquoted words “easy” and “hard”; its negative regex only rejects quoted versions ([tests/quiz.test.ts:316](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/tests/quiz.test.ts:316), [tests/quiz.test.ts:323](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/tests/quiz.test.ts:323)). Those words are ordinary reader language, so the assertions are reasonable; the comment is not.

## 6. `PROMPT_VERSION` should remain unchanged

No paid rebuild happens automatically. A version mismatch sets `outdated` ([src/store/pg.ts:2702](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/store/pg.ts:2702)); Quiz continues to display and mark the existing questions, while showing a “Write them again” button ([src/web/QuizPanel.tsx:624](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/web/QuizPanel.tsx:624)). Pressing it starts a forced paid rebuild ([src/web/useQuiz.ts:252](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/web/useQuiz.ts:252)).

So “invite a paid rebuild” is exactly right, and not bumping is justified because the requested questions and distribution did not change—only the explanation of failure handling did.

Overall: no serious defect in the new presence gate. I would fix the inaccurate reader message and simplify the contradictory prompt passage before calling stage 1 finished. The over-cap interaction is real but pre-existing and reasonably deferrable. The focused four-file run passed 87/87.