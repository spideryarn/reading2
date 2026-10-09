# Plan review: 261009o — a requeued job does not buy the Illustrated plates again

You are reviewing a PLAN (read-only). Repo: this worktree. Read:

- docs/plans/261009o-a-requeued-job-does-not-buy-the-illustrated-plates-again.md (the plan)
- docs/plans/261009l-a-requeued-job-does-not-buy-the-debate-search-again.md (the sibling fix it extends)
- src/illustrated.ts § generateIllustrated, drawPlates, BriefBank
- src/pipeline.ts § STEPS.illustrated.run, briefBank, PipelineStep.oncePerJob, StepContext
- src/jobs.ts § REQUEUE_BUDGET comment, runStep (the oncePerJob / beginPaidStep block, and the ctx it builds)
- src/store/pg-jobs.ts § beginPaidStep, settleExpired, pauseForDeadline; src/store/jobs.ts § beginPaidStep
- src/messages.ts § PAID_STEP_NOT_REPEATED, CODE_KINDS
- tests/illustrated-step-registration.test.ts § "the brief between windows"; tests/jobs-paid-step-once.test.ts

Questions:
1. Does the chosen design (a once-per-job marker on the job row at the plate phase) actually prevent a
   second window of the same job from buying the plates again, after a lapse and after a deadline pause?
   Any path that still re-buys (forced steps, Retry joining an active job, the chain sketch+illustrated,
   a Stop, the eval)?
2. Can it strand an article half-finished, or refuse the step's own deliberate hand-back?
3. Is one shared `paid_step_begun` column for both `debate` and `illustrated-plates` safe? The plan
   argues at most one marked purchase is unfinished at a time.
4. Is the option comparison honest (per-plate checkpoint rejected)? Is there a simpler option?
5. Are the tests sufficient, and will test 1 really be red before the fix?

Write findings ranked must / should / could, each with file:line evidence, and end with a verdict line
`VERDICT: APPROVE | APPROVE WITH CHANGES | REJECT`.
