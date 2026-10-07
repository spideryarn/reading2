# Plan review: 261007l

Review the plan at docs/plans/261007l-illustrated-fits-a-claim-and-a-late-stop-says-so.md before it is built. Read-only.

Read the code it names: src/illustrated.ts (`generateIllustrated`, `drawPlates`, `wasAborted`, `ILLUSTRATED_ANSWER_TOKENS`), src/pipeline.ts (`STEPS.illustrated`, `StepContext`), src/jobs.ts (`STEP_BUDGET_MS.illustrated`, `runStep`'s handling of `NeedsAnotherWindow`, `REQUEUE_BUDGET`, `transitionAfter`), src/another-window.ts, src/structure.ts (how it throws `NeedsAnotherWindow` and uses checkpoints), src/store/checkpoints.ts and the `checkpoints` table in src/db/schema.ts, src/token-budget.ts, src/ai-call.ts (`openRouterImage`, `asTransportAttempts`: does an aborted signal stop retries?), src/store/pg-jobs.ts (`requestCancel`, `finishIn`, `toJob`, `cancelRequestedAt`), src/job-state.ts, src/web/AddArticle.tsx (`JobCard`), tests/jobs-lease-budget.test.ts.

The production numbers in the plan's table were read today from `spideryarn.ai_calls` (step_name = 'illustrated'); take them as given.

Questions:
1. Does the design actually guarantee that no single request (brief, or one plate draw including its retries) can outrun a claim, and that the step never discards a finished brief at the deadline when a window is left? Find any path where it still can.
2. Is `cancel_requested_at IS NOT NULL AND status = 'done'` exactly "a Stop arrived but the job finished anyway"? Any path that stamps it without a reader's Stop, or a done job whose Stop was honoured?
3. Is keying the checkpoint by job id right (forced repaint must not reuse a brief; later windows of the same job must)? Is there a cheaper key that does both?
4. Anything that breaks: the stop-during-last-step `discardOnAbort` path (261007f), `wasAborted`'s treatment of provider TimeoutError, the eval runner (evals/illustrated/run.ts), the `checkpoints_namespace` CHECK and its test in tests/db-schema.test.ts.
5. Is there a simpler design that meets the requirement?

Answer with numbered findings, each: severity (high/medium/low), what is wrong, the concrete failure, the smallest fix. Say plainly if the plan is sound.
