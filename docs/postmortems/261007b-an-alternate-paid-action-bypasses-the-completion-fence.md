# An alternate paid action bypasses the completion fence

The write-capable review of [261007b](../plans/261007b-seventh-sweep-rewrite-hold-on-the-six-forced-verbs-without-one.md)
reproduced an enabled forced control after a retried job finished but before its result GET landed.
The old result remained visible, permitting another paid run. This was a candidate-worktree
reproduction; no production incident or reader charge was investigated.

## The class: an alternate paid action bypasses the completion fence

The mode's forced verb called `useRewriteHold.run`, but `JobProgress`'s Retry called the separate
`StepFailure.retry` supplied by `useStepJob`. Both could write the same artefact. Only the first
path captured its identity and job ID in the durable hold.

Retry's mount-local `starting` and synchronous `inFlight` protected its POST and first appearance
in the job list. They did not protect the interval between job completion and a fresh result read.
Hiding a failed job while a forced run was held prevented overlapping controls; it did not make a
later Retry establish a hold of its own. The sibling forced verbs were protected by action-level
state, while Retry still relied on job progress.

`46439f1c2f3432348ccd2b239d538b525cf2e4f6` introduced the shared Retry callback on 2026-09-03
while separating retryable failures from failures another run could not change. The missing seam
became a bypass of the **shared** completion fence in
`fb514efd3846b30bc521aed6c17c8a36ea10db20`, which added the hold to six modes on 2026-10-04
without routing Retry through it. `92b9396292`, from 2026-09-30, appears in blame for the current
callback because it added Retry's POST/first-poll protection; that earlier change did not create
the shared-hold bypass. The reviewed `8720c3af3` extended the existing hold wiring to six more modes and
inherited the omission. It did not introduce the alternate Retry path.

## Why the checks agreed

The hold table pressed each mode's own forced verb, then exercised read provenance, failures and
remounts. Those checks correctly established that path's hold. The source membership guard looked
for forced request construction; Retry uses `/api/jobs/:id/retry`, with no `force` property at the
call site. Membership was therefore no proof that every paid action used the hold.

The builder noticed Retry's separate route and recorded it as unreproduced. Review then added
`Retry holds the old result through its completion GET` in
[rewrite-hold.test.tsx](../../tests/rewrite-hold.test.tsx). The original run produced **nine
behavior failures**: the forced control was enabled while the retried result GET remained pending.
Thread's first fixture lacked a Retry button; that harness failure was corrected by using its stale
banner, and is not counted as evidence of the completion gap. Sketch and Illustrated's loaded
branches deliberately lack `JobProgress` Retry; their actual hooks are exercised separately.
With the corrected fixtures, disabling only Retry's hold registration produced **12 failed,
343 skipped**; restoring the registration produced **12 passed, 343 skipped**. Ten probes use
the real loaded UI's Retry, and two use the picture hooks' actual failure callbacks.

## The fix that holds beyond this instance

[useStepJob.ts](../../src/web/useStepJob.ts) now exposes a stable, mount-owned Retry-hold
registration, and its raw Retry returns the replacement job's ID or `null`.
[rewrite-hold.ts](../../src/web/rewrite-hold.ts) registers the mode's existing `run` wrapper.
Retry keeps its endpoint and its policy of skipping completed steps, but acquires the same hold
as the mode's forced verb. The exact replacement ID lets the existing release rules distinguish
failure, cancellation, refusal and a fresh unchanged result. Cleanup removes its own registration
without removing an active hold or preventing a pending POST from recording its answer.

This is the long-term fix for the mode-local seam. It does not establish a hold for Metadata or
the command bar's independent re-run rows; those wider surfaces remain reported in the plan.

## Countermeasures, ranked by ease against value

1. **Exercise every paid entry point through completion and the following read.** Implemented in
   the shared hold table, including Retry. The assertions observe both controls and requests;
   POST-only double-click tests cannot establish a completion fence.
2. **Register the action fence at the shared alternate-action seam.** Implemented once for Retry,
   so every mode using the hold inherits it without another panel-specific wrapper. The existing
   hold remains responsible for release evidence.
3. **Enumerate alternate actions alongside forced request construction.** Useful review work:
   inspect retries and helpers that do not spell `force` at the call site. The current membership
   guard alone cannot prove behavioral coverage.
4. **Wrap Retry independently in every panel, or replace Retry with an ordinary forced POST.**
   Rejected: the former duplicates lifecycle wiring; the latter changes which steps run and can
   buy work the retry endpoint intentionally skips. Moving the loaded picture branches onto
   `JobProgress` is also outside this repair and unnecessary to protect their hooks.

I would test the second route into a paid action before treating a green test of the first route
as coverage of the action. A queue's progress guard and an artefact's completion fence answer
different questions.

Up: [Postmortems](../project/postmortems.md).
