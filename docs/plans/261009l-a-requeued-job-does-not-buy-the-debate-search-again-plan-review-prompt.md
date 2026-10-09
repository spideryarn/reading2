You are reviewing a PLAN (not code) in the Spideryarn repo, read-only. Read
docs/plans/261009l-a-requeued-job-does-not-buy-the-debate-search-again.md first, then
docs/plans/261009e-paid-web-search-not-retried-after-it-was-sent.md (finding 3 is this bug),
src/jobs.ts (LEASE_MS, REQUEUE_BUDGET, runStep, walkClaim, transitionAfter, the pauseForDeadline call),
src/store/pg-jobs.ts (settleExpired, pauseForDeadline, settledSteps, claimIn), src/store/jobs.ts
(JobStore contract), src/store/pg-session.ts (beginStep), src/store/pg-revisions.ts (beginStepRun),
src/pipeline.ts (PipelineStep, the `debate` step) and src/debate.ts.

The bug: a lapsed lease (process gone) or the claimant's own 740 s deadline requeues the job, and
the next window runs the `debate` step again, buying its paid openrouter:web_search a second/third
time.

Questions, answer each:
1. Is option 4 (a per-job marker written before beginStep, and a later window of the same job
   refusing to begin that step again) correct and the simplest safe choice? Compare honestly with
   option 3 and with any better option you see (e.g. using revision_step_runs, which the draft keeps
   across requeues — I avoided it because a draft copies step-run rows from the published revision
   and a reader's Retry might reuse state; verify whether that worry is real).
2. Holes: any path where a later window still re-runs the paid call (forced steps / stillForced,
   retryJob reusing the job row, enqueue joining an existing job, the CLI path that takes no lease,
   a job that lists debate twice, a job whose earlier step pauses before debate begins)?
3. Any path where the marker wrongly refuses a run the reader explicitly asked for?
4. Is failing the step (stageFailure, job settles) the right ending, versus ending the job
   INTERRUPTED? What does the Debate panel show for each, and does it offer the reader a press?
5. Which OTHER pipeline steps buy non-idempotent paid work that should get oncePerJob too
   (web search, or anything expensive and un-checkpointed)? List them with file:line.
6. Anything in the test plan that would pass without the fix (a check never seen red)?

Write your findings as a numbered list, each with severity (blocker / should / nit), evidence
(file:line), and a concrete recommendation. End with a one-line verdict: APPROVE, APPROVE WITH
CHANGES, or REJECT.
