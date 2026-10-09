# Code review: 261009o — a requeued job does not buy the Illustrated plates again

You are reviewing BUILT CODE in this worktree, and you may fix what you find inside this change
(workspace-write). Do not touch anything outside the change's scope; report wider findings instead.
Do not run git commands that discard work (checkout, restore, stash, reset, clean).

Read first:
- docs/plans/261009o-a-requeued-job-does-not-buy-the-illustrated-plates-again.md (the plan, with
  your plan review folded in)
- The scoped diff: `git diff HEAD` (also saved at
  /tmp/claude-1000/-home-greg-code-spideryarn2/240255e4-80e8-41d0-aefe-9049d4711520/scratchpad/261009o.diff)

The change: a `PaidPurchase` type (`StepName | "illustrated-plates"`, src/types.ts);
`JobStore.beginPaidStep` takes one; `StepContext.beginPaidWork` is that call bound to the claim, set
by `runStep` (src/jobs.ts); `generateIllustrated` gets `beginPlates`, awaited after the plate fit
check and before `drawPlates` when there is at least one plate (src/illustrated.ts); the pipeline's
`illustrated.run` wires it and throws `stageFailure(PLATES_NOT_REPEATED)` on `"begun-before"`
(src/pipeline.ts); a new sentence and code `jb-plates-once` (src/messages.ts).

Tests: tests/illustrated-step-registration.test.ts § "the brief between windows" (the red-first case:
a first window whose plate call never returns, then a second window of the same job; plus a hand-back
control and a fresh-job control), tests/jobs-paid-step-once.test.ts (the walk hands the step the
claim's marker; a store case for the shared column). Run them:
`npx vitest run tests/illustrated-step-registration.test.ts tests/jobs-paid-step-once.test.ts tests/illustrated-run.test.ts tests/messages.test.ts`
and `npm run typecheck`.

Look for: any path where a later window of the same job can still send a plate; anything that
refuses the deliberate hand-back; anything the marker breaks when `beginPaidWork` throws
(StaleAttemptError on a lost claim) — does it surface as the right failure?; whether
the abandoned never-resolving promise in the test leaks state into later cases (the module-level
`plateHangs`, `answers`, counters); reader-facing wording; comments that are now stale anywhere in
src/ or docs/project/ about Illustrated not being covered; whether a test you would expect is missing.
Check by mutation where cheap (e.g. remove the `beginPlates` call and confirm a test goes red).

Write findings ranked must / should / could with file:line, say for each whether you fixed it, and end
with `VERDICT: APPROVE | APPROVE WITH CHANGES (made) | REJECT`.
