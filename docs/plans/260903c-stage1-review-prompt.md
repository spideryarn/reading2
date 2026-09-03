# Review the code built for stage 1

You reviewed this plan before it was built and your review is at
`docs/plans/260903c-fix-quiz-band-spread-review-sol.md`. This is the second review — of the code
that came out. Weight it higher than the plan review: a plan-stage review cannot find a function
that writes one thing and then refuses the request.

Working directory is a git worktree of the Spideryarn repo. Read any file. **You may run tests** —
`npx vitest run tests/quiz.test.ts` works here; a finding you reproduced outranks one you reasoned
to. Do not edit anything.

## What to review

The uncommitted working-tree diff, which is also written out at
`/tmp/claude-1000/-home-greg-code-spideryarn2/88b5a2b0-797c-4c1d-a29a-de36e3f1dfb1/scratchpad/stage1.diff`.
Get it yourself with `git diff HEAD`. Five files:

- `src/quiz.ts` — the substance
- `tests/quiz.test.ts` — the tests
- `tests/quiz-step-registration.test.ts`, `tests/stage-stamp-agreement.test.ts` — stale comments only
- `docs/project/quiz.md` — the doc

The plan is `docs/plans/260903c-fix-quiz-build-band-spread-failure-and-lost-quiz-answers.md`;
stage 1 is the scope. Stages 2 and 3 are **not** built yet — do not report their absence as a
finding, but do say if stage 1 has made either harder.

## What was done

`bandQuota` (`min(3, floor(n/4))`) and `quotaShortfall` are deleted, replaced by
`missingBandEnds(questions): QuizBandEnd[]` — a presence check, empty is the pass — with a named
`SPREAD_FROM = 4` boundary below which nothing is asked. The thrown message was rewritten as reader
copy. The prompt's false "the article is asked again" claim was removed while its three-of-each ask
was kept. `PROMPT_VERSION` was deliberately not bumped.

## Evidence of red-then-green

Before the change, `npx vitest run tests/quiz.test.ts` gave 15 failed / 36 passed, including this,
which reproduces the production failure with the byte-identical string from the Vercel log:

```
FAIL > builds the batch production rejected: nine questions, one of them hard
Error: The batch does not use both ends of the band scale, so the reader would meet 9
questions in an order that means nothing. wanted 2 "hard", got 1. A batch of this size
has to carry both ends — src/quiz.ts § bandQuota. Run it again; if it keeps landing
here, the prompt's spread rule is the thing to change.
  ❯ buildQuiz src/quiz.ts:532:11
```

After: 51 passed. I have independently re-run `tests/quiz.test.ts`,
`tests/quiz-step-registration.test.ts`, `tests/stage-stamp-agreement.test.ts` and
`tests/doc-links.test.ts` together — 87 passed — and `npm run typecheck` is clean.

## Questions

Cite file:line. Disagree freely.

1. **Is `missingBandEnds` correct, and is its boundary right?** Check the `SPREAD_FROM` exemption
   against the behaviour it replaced, and check the reader-copy helper `missingEndsInReaderWords`
   for a case it gets wrong. Is `questions.length < SPREAD_FROM` the right test, given the count is
   survivors and `MAX_QUESTIONS` truncation happens elsewhere? The implementer flagged that
   truncation-vs-gate ordering as something they did not change — is it a real defect?

2. **Is the new thrown message actually safe and actually useful?** It reads: *"The AI service wrote
   5 questions for this article, but there is no hard one among them to finish on, so they would not
   build up from easier to harder the way a quiz should. Asking again usually gets a better spread."*
   Check it against `docs/project/copy.md` — rule 1, rule 3, and the bracketed-code convention. It
   has **no bracketed code**; should it, given `kindOfMessage` in `src/messages.ts` reads codes to
   decide retryability and this failure *is* worth retrying? That interaction matters because stage
   2 will route this through `failureKindOf`.

3. **The prompt edit.** Read the new `THE SPREAD IS NOT OPTIONAL` block. It now tells the model that
   a failing batch leaves the reader "with no quiz until they notice and press the button a second
   time". Is describing our UX to the model useful, harmful, or noise? And is keeping the
   three-of-each ask while the gate demands one going to drift the model's output downward over
   time?

4. **`PROMPT_VERSION` not bumped.** The reasoning is recorded on the `QUIZ_SYSTEM` docblock: the
   requested distribution is unchanged, only a false consequence was removed, and bumping would mark
   every existing quiz `outdated` and invite a paid rebuild. Is that right? Check what `outdated`
   actually triggers.

5. **The tests.** Are they the right tests? The implementer reports that an old assertion
   (`.toThrow(/easy/)`) had been passing for the wrong reason — matching the word inside `wanted 3
   "easy"`, i.e. the developer arithmetic rather than the product rule. Is anything in the new set
   passing for the wrong reason in the same way? Is the table-driven block actually covering the
   boundary on both sides?

6. **`QuizBandEnd`.** The plan said `missingBandEnds` would return `QuizBand[]`; the implementer
   narrowed it to `Extract<QuizBand, "easy" | "hard">` and exported it. Right call?

7. Anything else: correctness, a simplification, something in the comments that is now false, or
   anywhere the diff has made stage 2 harder.

Answer in prose with headed sections, ranked by what matters most. Say plainly if you find nothing
serious.
