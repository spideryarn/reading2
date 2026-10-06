# Review and fix: stage 1 of 261006d — an aborted AI call's ledger row says who stopped it

Repo: this worktree, branch `worktree-qi-pwhxm2t2-count-stalls`, TypeScript + ESM, vitest.

## The candidate

Committed: the single commit at `HEAD` whose subject starts `261006d stage 1`.
`git show --stat HEAD` lists the changed paths; `git diff HEAD~1..HEAD` is the diff.

The spec is `docs/plans/261006d-count-stalls-and-deadlines-apart-from-a-reader-s-stop.md`
(§ The design, and § Progress for what the build learned). Your own plan review is
`docs/plans/261006d-plan-review-sol.md` (F15–F20). Start with `src/call-failure.ts`,
`src/ai-call.ts` (`Meter.stopped`, `Meter.failed`, `Meter.finish`, `openRouterStream`'s `finally`),
`src/messages-stream.ts` (`recordFailure`, the `abort` listener, the retry loop), and the call
sites: the eight runners, `src/structure-slices.ts`, `src/collect-pdf-figures.ts`. That is where to
start, not a limit.

## What to do

You may write. **Fix what is inside this stage, narrowly, with a failing test seen red first**;
report and do not fix anything wider. Out of bounds for edits: `src/cost-cube.ts`,
`src/cost-analysis.ts`, `scripts/cost-analysis*.ts`, `src/web/**` and everything under `docs/`
except your answer file. Another agent is editing those for stage 2 right now, so do not touch
them, and expect them to change under you. Do not commit. Do not quote Greg anywhere.

Attack it:

- Is every `aborted` row classed by the clock or person that actually stopped it, on both wires,
  at every place an aborted end is made? Is the phase the seam's own acceptance boundary?
- Did any decision that used to turn on "the failure is null" change by accident (the Messages
  retry loop, the eval budget in `evals/dig-deeper/budget.ts`, slot charging, anything else that
  reads `SpendRecord.failure`)?
- Does a provider error still win over a later abort where it did before (261006b's F9)?
- Are there stall or deadline clocks that reach a gateway and still record `abort`?
  (`src/collect-assets.ts` near line 910 was not traced.)
- Do the tests test it? Mutate the code and see whether they notice. Run the relevant files
  yourself: `npx vitest run tests/call-failure.test.ts tests/ai-call-transport-retry.test.ts
  tests/messages-stream.test.ts tests/ai-call-failure-log.test.ts` need nothing outside the tree.

Is each statement in the new comments accurate? Ask that, not "is it sound".

Severity: **P0** data loss, security, incorrect charging, service broadly unusable. **P1**
user-visible wrong behaviour or an authoritative contract violated. **P2** design or
maintainability risk. **P3** prose. Say established or reasoned for each. Number findings
**F21 upward**. For each: what you found, whether you fixed it, the red-then-green evidence.
End with `VERDICT: ship it` or `VERDICT: change first`.

## My own suspicions, worth less than yours

- The PDF figure budget is a step-wide clock recorded as `deadline`, while the job deadline
  (`DeadlineReached`, `src/jobs.ts`) stays `abort`. The plan admits the line is not principled.
  Is recording the figure budget as `deadline` misleading for the question the count is for
  (how often does a provider go quiet or slow part-way)?
- `abortClass` treats any `AbortSignal.timeout` as ours.
- The `AbortSignal.any` list-order caveat in the `abortClass` comment.
