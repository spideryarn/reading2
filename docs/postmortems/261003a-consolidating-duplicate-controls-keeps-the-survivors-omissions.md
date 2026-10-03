# Consolidating duplicate controls keeps the survivor's omissions

Code review of `1e42388eb` caught two glossary regressions before this review's fixes were
committed. Whether the reviewed commit reached readers was not checked. Moving the run control
to the top and removing the stale banner's duplicate progress also removed its stalled-driver
warning and its failed-job recovery policy.

## The class: consolidating duplicate controls keeps the survivor's omissions

The two controls represented one job but did not carry the same state. The stale banner used
`Progress` with `owner.stalled` and the full `StepFailure`. The footer, renamed `MoreRow`, passed
`stalled={false}` and kept only `failed.message`, offering a fresh paid run under every failure.
Choosing that implementation as the survivor silently discarded the other control's behavior.

`1e42388eb` introduced the regression for stale lists by removing their banner's `Progress`.
The footer's broader warning omission predates this change: `9d2df3b73c` introduced the constant
`false`, and `d1b5e32740` added a comment calling the stalled state unreachable. But
`useStepJob.stalled` is true after repeated advance failures even while status polls succeed;
the reader in the band need never open the shelf where the warning still appears.

The deleted control also called `failed.retry` for a retryable job and offered no paid run when
another attempt could not help. The survivor instead always offered `more`, starting new work.

## Why the checks agreed

The change's starting-job test checked the spinner, and its failure test checked the sentence.
Neither checked transport health or the action beneath the failure. Hook and `JobProgress`
tests checked derivation and rendering separately, leaving their connection in this panel
unverified. A required boolean prop did not protect against explicitly supplying `false`.

## The fix and the countermeasure

`MoreRow` now forwards `owner.stalled` and uses shared `Progress` whenever a job is running,
starting, or failed. That preserves the full failure policy while leaving the healthy idle
button's append/rewrite tooltip in place. This is also the long-term fix: the connecting
component should pass state through rather than reconstruct recovery from a message.

The panel tests in
[`glossary-find-more-keeps-the-lists-profile.test.tsx`](../../tests/glossary-find-more-keeps-the-lists-profile.test.tsx)
were run against the reviewed code first: **4 failed, 11 passed**. Two failures were the stalled
warning on current and stale lists; the others were missing Retry and an unwanted paid run under
a nonretryable stale-list failure. They check the warning clears, Retry calls the existing
job's callback rather than `more`, and nonretryable failure leaves no button. The state matrix
is the guard against this class: checking only the moved control's normal state cannot prove
it retained the removed control's contract.

Root cause checked independently in a read-only subagent. Related guidance:
[silent-success.md](../reusable/silent-success.md),
[write-postmortem.md](../reusable/write-postmortem.md).
