You are reviewing BUILT CODE in the Spideryarn repo (this worktree). You may edit files to fix what
you find inside this change's scope; report anything wider instead of changing it.

Read first: docs/plans/261009l-a-requeued-job-does-not-buy-the-debate-search-again.md (the plan, with
your own plan review and what was and was not taken), then the scoped diff in
docs/plans/261009l-a-requeued-job-does-not-buy-the-debate-search-again-code-review.diff.

The change: `PipelineStep.oncePerJob` (on `debate` only); two new nullable columns on `jobs`
(`paid_step_begun`, `paid_step_begun_at`, migration drizzle/20261009132350_job_paid_step_begun.sql);
`JobStore.beginPaidStep` (src/store/jobs.ts contract, src/store/pg-jobs.ts implementation); `runStep`
in src/jobs.ts calls it before `session.beginStep` for a oncePerJob step and throws
`stageFailure(PAID_STEP_NOT_REPEATED)` on `"begun-before"`; new reader sentence and code
`jb-paid-once` in src/messages.ts; test tests/jobs-paid-step-once.test.ts.

Check in particular:
1. Correctness of `beginPaidStep`: fence (liveAttempt), lock, the two refusals, StaleAttemptError on a
   lost claim, transaction isolation. Does anything else that writes the `jobs` row (settleExpired's
   requeue, pauseForDeadline, claimIn, finish/releaseStep, retry/enqueue paths, toJob/row mapping,
   any `select()` of all columns into a type, export code in src/export or db-export, admin/fleet
   readers, tests/db-schema.test.ts expectations) need to know about the new columns?
2. Where the check sits in runStep: what happens on each exit (StaleAttemptError from the new call,
   a Stop or deadline arriving, the stage failure path) — does the step/job settle correctly and is
   the job's ending the one the plan says? Any path where a oncePerJob step is begun without the
   marker, or refused when the reader asked (a fresh job, a forced step, a coalesced enqueue)?
3. The registered code: does tests/messages.test.ts / every-ai-code-is-registered / monitoring-scrub
   need anything more? Is the sentence plain and true?
4. The test: is anything in it unable to go red? Does it leak rows? Does it belong in the
   private-postgres lane as registered?
5. Docs and comments touched: anything stale or false.

Run `npm run typecheck` and `npx vitest run tests/jobs-paid-step-once.test.ts tests/messages.test.ts
tests/db-schema.test.ts tests/store-migration-registry.test.ts` after any edit.

Write your findings as a numbered list (severity: blocker / should / nit; evidence file:line; what
you changed, or the recommendation if you did not). End with one line: APPROVE, APPROVE WITH CHANGES
(made), or REJECT.
