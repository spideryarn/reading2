# Review the code built for stage 2

You reviewed the plan (`docs/plans/260903c-fix-quiz-band-spread-review-sol.md`) and stage 1
(`docs/plans/260903c-stage1-review-sol.md`). This is the review of stage 2's code, and it is the
one that matters most: stage 2 changes what **every** pipeline failure shows a reader, across every
band, so a mistake here is wider than the bug that started it.

Working directory is a git worktree of the Spideryarn repo. Read any file. **You may run tests** —
`npx vitest run <file>` works; a finding you reproduced outranks one you reasoned to. Do not edit.

## What to review

The uncommitted working-tree diff — `git diff HEAD`, plus the untracked new file
`tests/step-failure-seam.test.ts`. It is large: 43 files, ~1260 insertions. A copy is at
`/tmp/claude-1000/-home-greg-code-spideryarn2/88b5a2b0-797c-4c1d-a29a-de36e3f1dfb1/scratchpad/stage2.diff`.

Stage 1 is committed (`e560757d`) and on `dev`; stage 3 is not built. Do not report stage 3's
absence.

## The design you specified, and what was built

You chose option (a): everything undeclared gets safe generic copy; migrate shared error
constructors first; type-level enforcement is unavailable because TypeScript has no checked throws.

Built:

- `src/job-failure.ts` — `stageFailure` gains an overload taking a whole `ReaderFacingFailure`;
  new `readerFailureOf(err, stepLabel)` is the seam.
- `src/messages.ts` — `stepGaveUp`, a total `Record<FailureKind, …>`, unknown → the retryable one.
- `src/jobs.ts` — `step.error`, `job.error` and a cancelled job's error now take the *reader*
  sentence; `Error.message` stays the diagnostic for the log and Sentry; `recordFailureKind` still
  uses `failureKindOf(err)` rather than `reader.kind`, deliberately.
- Migrated: `anthropicCallFailed`, `truncationFailure`, all `MODEL_REFUSED` throw sites,
  `TooLongForOnePass`, the upload refusals, and both quiz refusals (`[quiz-spread]`,
  `[quiz-unanchored]`).
- Client: `useStepJob.failed` is now `StepFailure = { message, retryable, retry }`; `JobProgress`
  draws Retry for a retryable failure, **no button** for one another go cannot change, and the
  ordinary run button only when there is something new to ask for; `starting` threaded to the quiz.

## The one thing the plan did not anticipate

`authored` in `src/monitoring-scrub.ts` forwards an `Error.message` to Sentry **only** if
`kindOfMessage` finds a registered bracketed code at the end of it. Moving the reader sentence off
`Error.message` moved the code off it too — so every migrated failure's diagnostic would have been
silently withheld from Sentry. `diagnosticFor` now appends the reader sentence's code to the
diagnostic. I verified `authored`'s gate myself; the claim is true.

**This is the finding I most want a second opinion on.** Is appending the code the right fix, or is
it working around a `monitoring-scrub` rule that should itself change? Is there any case where a
diagnostic now carries a code that misrepresents it?

## Questions

Cite file:line. Disagree freely. Rank by what matters most.

1. **Does the seam actually close?** Find a path — any step, any throw, any surface — where a raw
   `Error.message` still reaches `step.error`, `job.error`, or a reader's screen. That is the whole
   point of the stage, so try hard to break it. Include the `endAsStorageFailure` / `DraftGoneError`
   path and the outer catch in the walk, which the diff touches only indirectly.

2. **The Sentry interaction above.**

3. **`recordFailureKind(job, failureKindOf(err))` rather than `reader.kind`.** The comment argues
   they are the same whenever a throw site declared one, and differ only for an undeclared failure
   where `reader.kind` is `retry` by fallback and `undefined` is the honest record of nobody having
   said. Is that right, and does anything downstream read `failureKind` in a way that now behaves
   differently? Check the store, the shelf card, and `settleExpired`.

4. **Is `stepGaveUp` good copy, and is its totality real?** Read the four sentences against
   `docs/project/copy.md`. Does naming the step help a reader or leak an internal noun? Would a
   fifth `FailureKind` genuinely be a type error?

5. **The client.** `retryable` is a field of `StepFailure` rather than a separate required prop —
   the implementer argued a boolean beside a string is the shape `useStepJob` already warns about
   ("the failure and its reason are one value … so no later edit can set one and forget the
   other"). Right call? Also check: is "no button at all" correct for a non-retryable failure in a
   *band*, where — unlike the shelf — the reader may have no other route to the thing they wanted?

6. **The tests.** `tests/step-failure-seam.test.ts` is the guard on the class. Is it actually a
   guard, or does it pin only the cases the implementer thought of? Does it inspect the persisted
   pair as you asked? Anything passing for the wrong reason?

7. **What was deliberately left undone** — the thread page still does not pass `starting`;
   Readability's refusal, `NoBlocksProduced`, the PDF page cap and chunk size keep generic copy;
   `anthropicCallFailed` still does not repeat the SDK's config error even as a diagnostic. Are any
   of those wrong to defer? The PDF page cap in particular is claimed to be reader-actionable.

8. Anything else: correctness, a simplification, a comment that is now false, or a place this made
   stage 3 harder.

Say plainly if you find nothing serious.
