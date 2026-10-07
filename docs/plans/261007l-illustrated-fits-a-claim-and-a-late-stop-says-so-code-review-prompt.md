# Code review: 261007l

You are reviewing, and fixing, the code built from docs/plans/261007l-illustrated-fits-a-claim-and-a-late-stop-says-so.md. Read the plan first, including its § "What the plan review changed", and your own plan review at docs/plans/261007l-illustrated-fits-a-claim-and-a-late-stop-says-so-plan-review-sol.md.

The work is in this worktree. Two parts:

- **Part 2** (already committed, `git show 12198fcaf`): `Job.stopCameTooLate` from `toJob` (src/store/pg-jobs.ts), a `kept` display state and `STOP_CAME_TOO_LATE` in src/job-state.ts, tests in tests/job-state.test.ts, tests/jobs-walk.test.ts, tests/job-card-progress.test.tsx.
- **Part 1** (uncommitted, `git diff HEAD`): src/illustrated.ts (`ILLUSTRATED_ANSWER_TOKENS`, `BRIEF_CAP_MS`, `PLATE_CAP_MS`, `SETTLE_MARGIN_MS`, `BriefBank`, `generateIllustrated`, `drawPlates`), src/pipeline.ts (`briefBank`, `STEPS.illustrated.run`, `StepContext.jobId`), src/jobs.ts (`jobId` on the context; comments), src/another-window.ts (comment), src/store/checkpoints.ts and src/db/schema.ts (the `illustrated-brief` namespace), drizzle/20261007143534_checkpoints_illustrated_brief.sql, tests/illustrated-run.test.ts, tests/illustrated-step-registration.test.ts, tests/jobs-lease-budget.test.ts, and docs.

Look hard for:

1. Any path where a single Illustrated request (the brief, or one plate draw with its retries) can still run past the claim's deadline, or where a finished brief is thrown away when it could have been kept.
2. The clocks: `AbortSignal.timeout` + `AbortSignal.any` usage, whether a reader's Stop still cancels promptly, whether a timer could keep a process alive or leak, and whether the brief's clock expiry is reported with the right reader sentence and kind.
3. `NeedsAnotherWindow` thrown with no window left: confirm in src/jobs.ts that this ends the job *interrupted* (not a silent success, not a terminal failure with no retry), and that nothing else assumes the old "only when anotherAvailable" rule.
4. The checkpoint key and the read/write wrapping in `briefBank`: correctness, and whether a malformed checkpoint value could crash or be trusted.
5. `discardOnAbort` now has no reachable producer (the plan says why). Decide: remove the field, its producer and its consumer in src/jobs.ts plus the tests that construct it, or leave it. Do whichever leaves the code simplest and correct, and say what you did.
6. Part 2: anything wrong with the predicate or the sentence, and whether every renderer of the job card shows it.
7. Tests that would stay green if the code were wrong.

**Fix what you find inside this scope**, with a test seen red first for any defect. Do not commit, do not push, do not touch git history, do not run any destructive git command, and do not run `npm run db:migrate` or anything against a remote database. Do not invent quotes from Greg. Report anything wider than this scope for me to decide.

Run `npx vitest run tests/illustrated-run.test.ts tests/illustrated-step-registration.test.ts tests/jobs-lease-budget.test.ts tests/job-state.test.ts tests/job-card-progress.test.tsx tests/jobs-walk.test.ts tests/job-hands-back-for-another-window.test.ts` and `npm run typecheck` after your changes. Note: the local database does not have this migration applied (a peer's unlanded migration blocks `db:migrate`), so tests/db-schema.test.ts's namespace case is expected to fail locally for that reason alone.

Answer with numbered findings: severity, what was wrong, what you changed (file and line), and the red-then-green evidence. Then a list of anything left for me.
