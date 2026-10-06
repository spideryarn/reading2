# Review: a plan to record the pipeline's job deadline as `deadline`, and to class live conversation's stops, in `ai_calls`

Repo: this worktree, branch `worktree-job-deadline-class`, base `9a47c3679`. TypeScript + ESM.
Read-only review: change no file.

## The candidate

Live, pre-commit. Untracked files:

- `docs/plans/261006f-count-the-pipeline-job-deadline-as-a-deadline-and-class-live-conversation-stops.md`
- `docs/plans/261006f-plan-review-prompt.md` (this prompt)

It builds on committed work: `docs/plans/261006d-count-stalls-and-deadlines-apart-from-a-reader-s-stop.md`
(read § Left for later and the stage 1 notes), `src/call-failure.ts` (`abortClass`,
`CallDeadlineReached`), `src/jobs.ts` (`DeadlineReached`, the claim's controller near the
`controller.abort(new DeadlineReached())` line, `cancelJob`), `src/live.ts` (`REALTIME_OUTCOME`,
`ledgerRow` and the `failureClass: null` block), `src/cost-cube.ts` (`failureCountsOf`,
`failureCauses`, `FAILURE_NOTES`), and the browser side of live conversation under
`src/web/live/`. Those are where to start, not a limit on scope.

## What you can run

The tree is read-only; /tmp is writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) or a small Node snippet. No network, no Postgres.

## Attack it

Is each statement in the plan accurate against the code? In particular:

- Which paths from `StepContext.signal` in `src/jobs.ts` to a gateway (`src/ai-call.ts`,
  `src/messages-stream.ts`) lose the abort reason, so that the job deadline would still be
  recorded as `abort` after the change? Name each file and line. Name any that are fine.
- Does making `DeadlineReached` a subclass of `CallDeadlineReached` change anything that reads the
  reason's `name`, `message` or class (logs, `errorFields`, the copy a reader sees, tests)?
- Is "no clock of ours ever stops a live response" true for both live engines (the realtime one
  and GPT-Live)? Find every place the browser or the server cancels, closes or abandons a live
  response, and say what status the resulting ledger row carries, if there is a row at all.
- Does a row with `failure_class = 'abort'` and a null `failure_phase` break or mislead any reader
  of those columns (the folds, the causes table, the cost analysis, the two-reads check, any SQL,
  any type that assumes class and phase are null together)?
- Can the changed *not measured* rule now show a wrong zero?
- Is anything simpler and as good, or is either half not worth doing?

Severity: **P0** data loss, security, incorrect charging, service broadly unusable. **P1**
user-visible wrong behaviour or an authoritative contract violated. **P2** design or
maintainability risk, no wrong behaviour today. **P3** prose defect. Refuse (*change first*) only
on an established P0 or P1: direct evidence, no unresolved inference. Say for each finding whether
it is established or reasoned, and give (a) what shows it and (b) the smallest change that closes
it.

Number findings **F29 upward** (F1 to F28 are taken by the 261006b and 261006d chain). End with a
verdict line: `VERDICT: build it` or `VERDICT: change first`.

## My own suspicions, worth less than yours

- `incomplete` (the output cap, a content filter) is nobody's Stop. Calling it `abort` leans on
  "anything else"; it may deserve saying on the page.
- The pipeline's `fatal.abort()` relays in `src/labels.ts`, `src/pdf-read.ts` and
  `src/structure-deepen.ts` may compose the job signal in a way that drops the reason.
- A class with no phase may be a shape some type forbids.

Do not change any file.
