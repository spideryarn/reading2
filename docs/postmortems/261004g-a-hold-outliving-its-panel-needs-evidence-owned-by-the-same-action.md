# A hold outliving its panel needs evidence owned by the same action

Review of `fb514efd3` found gaps in Regenerate's shared hold before landing. Two clicks before
React rendered sent two forced POSTs. An earlier online answer released a hold made on a newer
offline artefact; another job's failure released a pending forced POST after remount. Conversely,
this press's own failed or cancelled terminal row left an offline remount held. These were review
reproductions, not reported reader incidents.

## The class: durable action state answered with local or unrelated evidence

The hold outlived the panel, but enforcement and release evidence did not consistently share that
ownership. Button disabling waited for React's next commit. `latest` proved that a read had once
succeeded, without proving it started after this press. `queue.failed` described the mount's watched
job, which could differ from the job recorded by the hold. The `rewriting` identity comparison also
treated a different offline copy as permission to spend, although the hold itself remained stored.

Retaining the action's job ID was necessary; every release and permission decision needed to honour
that ownership too. A rejected start callback had a related hole: it left a hold that could never
acquire a job ID. The production queue catches ordinary transport failures, so that last case was
a boundary defect rather than a demonstrated reader path.

## Why the tests agreed

The original six-mode table used one click, matching online/offline identities and the same watched
job. Those correlated fixtures could not expose the ownership mismatches. The added cases in
[rewrite-hold.test.tsx](../../tests/rewrite-hold.test.tsx) failed before the fixes: six double-click
cases, two retained-reader historical-answer cases, six different-offline-identity cases, six
unrelated-job failures, twelve own-error/cancelled offline remounts, and one rejected callback.

## The fix

[rewrite-hold.ts](../../src/web/rewrite-hold.ts) fences the verb synchronously. A module-wide
read-start clock fences replacement evidence to the press across remounts. A different offline
identity keeps the hold. [useStepJob.ts](../../src/web/useStepJob.ts) returns the exact terminal
status from `ended(id)`, so only this press's failure or cancellation releases it. While held, the
six mode hooks suppress unrelated failure controls and retain the read-only recovery control. A
rejected callback drops its own hold and propagates the rejection.

## Countermeasures, ranked by ease against value

1. **Keep the added adversarial interleavings** — implemented in the real six-mode table, exercising
   controls, transport provenance and mount boundaries. Much cheaper than another abstraction.
2. **Identify the action and observation behind each release predicate** — check historical,
   unrelated and remounted evidence separately; success beside an action is not success of it.
3. **A generic read hook** — rejected. Precise ownership and provenance close these gaps while each
   mode keeps its own read semantics.

The long-term fix is the one implemented: the action owns its fence, and each observation earns
the right to release it. React's rendering schedule and whichever job a panel most recently watched
cannot supply that proof.

Up: [Postmortems](../project/postmortems.md).
