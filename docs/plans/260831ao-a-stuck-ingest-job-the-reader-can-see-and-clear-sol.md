The smallest sound design is: keep the existing cards, make recovery automatic when the reader returns, and let Stop mean what it says. Do not add a queue panel, an hour timer, takeover, or a cleanup-only cron.

The state model should be:

| State | Meaning | Reader action |
|---|---|---|
| `queued` | Safe to continue; no runner owns it | Nothing—resume automatically |
| `running`, lease live | A runner may still be working | Stop |
| `running`, lease expired | The attempt was interrupted | Continue |
| `running`, cancelling, lease expired | The requested stop has completed | Continue, if wanted |

“Continue” can use today’s Retry machinery. It is better copy for interruption because completed steps are retained.

## 1. Keep the existing surfaces

A separate queue panel would duplicate `JobCard`, create another place where status and actions can disagree, and make queue management feel like a product feature. The add page is the right primary surface; the shelf box is the recovery surface.

What is missing is not another panel:

- Mount the job driver once in the authenticated application shell, independently of whether a card is visible. Any Spideryarn page should keep imports moving. Navigating from the shelf to the reading view should not silently pause them.
- On a duplicate paste, return the existing active job’s receipt or ID and show that card. Do not answer only with “wait or stop it first.”
- Any other 409 caused by an active job should include a way to reach that job.
- Say the browser dependency plainly: “Keep a Spideryarn tab open while this imports. If you close them all, it will continue when you return.”

That last sentence is necessary until there is a real background runner. Calling this a queue without saying that currently over-promises.

Cost: moving the driver to the application shell, sharing its state with the existing two surfaces, and changing the collision response contract. No new UI system.

## 2. Do not add an hour auto-cancel

An hour is the wrong clock. It is simultaneously:

- Meaningless for `queued`, which may merely be waiting for the reader to return.
- Far too late for `running`, whose claimant is already invalid after 12.67 minutes.
- A second, weaker account of liveness that could disagree with the lease.

The correctness clock is the database lease, compared using database time. When it expires:

- Without a Stop request: “This import was interrupted before it finished. Continue to pick up from the last completed step.”
- With `cancelling=true`: settle it as `cancelled`, not interrupted.

Elapsed time and last streamed progress are useful display clocks, but should never decide ownership.

## 3. Do not expire queued jobs

I disagree with the premise that `queued` needs `stale_after`. A queued job has no unsafe owner to evict and is immediately safe to claim. When the reader returns, failing it and asking them to Retry just before the browser could have continued it would manufacture a failure.

Of the listed choices, use **(c), narrowly**, for expired running attempts: `GET /api/jobs` should reconcile that owner’s expired rows before returning the list. Avoid performing an empty global `UPDATE` every second; list first and reconcile only when an expired candidate exists, or provide an owner-scoped store operation.

Why not the others:

- **(a) `stale_after`:** measures absence, not failure, and still needs something to enforce it.
- **(b) every authenticated request:** couples unrelated reads to ingest mutation and still does not guarantee useful traffic.
- **(d) cron:** a cleanup-only cron turns dormant work into failed work while nobody is watching. It does not finish an import.

A cron becomes the honest answer only if the product promise is “paste this and close the browser.” In that case, build a scheduler that actually claims and advances jobs. Do not add a cron merely to repaint their statuses.

The abandoned-queued remedy is therefore rendezvous, not expiry: any app page drives it, and another paste finds and watches the existing job.

## 4. Keep failure-and-Continue; do not take over

An expired lease should not become an automatic takeover yet. The lease proves the old attempt may no longer commit the job; it does not make partially written artefacts transactional.

Failure followed by Continue is adequate here:

- Completed steps skip in milliseconds.
- Only the interrupted step must be repeated.
- The reader sees that work stopped rather than watching a silent restart.
- It avoids automatically repeating a paid model call.

The remaining gap is one click, not a full restart. Transactional artefact writes may later justify automatic resume, but they are not justified merely to remove that click.

## 5. Yes, Stop should immediately clear an expired claim

Use one atomic transition based on database time:

- queued → `cancelled`
- running with live lease → `cancelling`
- running with expired lease → `cancelled`

Also make the ordinary expiry sweep respect an existing `cancelling=true` and settle it as cancelled.

The theoretical risk is an overdue claimant continuing to write artefacts. But the existing system already permits Retry after `failExpired`, which creates the same possible overlap. This change introduces no new safety assumption: lease expiry, self-abort, attempt fencing, and interrupted-step markers already have to make that safe.

Do not offer “Force stop” before lease expiry. A live claim may genuinely be working, and clearing it could create two writers.

While waiting, use accurate copy: “Stopping after the current step…” rather than an indefinite disabled “Stopping…”.

## 6. Show time and activity, but not a fake progress bar

For an active model step, show something like:

> Building the table of contents · 2m 14s · 18 KB received  
> This step often takes a few minutes.

Use a measured range if one exists; otherwise omit the estimate and show elapsed time plus bytes. A determinate percentage would be invented because the response size and provider latency are unknown.

Also distinguish:

- “Waiting to continue” for queued.
- “This is taking longer than usual. You can stop it.” after a measured threshold.
- “Stopping after the current step…” after Stop.

This makes legitimate slowness understandable. It does not make lease reconciliation or correct cancellation unnecessary: explanatory copy cannot release a held slug.

## 7. The missing failure: the driver can fail while polling succeeds

`drive()` currently catches `/advance` failures and retries silently. If `GET /api/jobs` continues working while `/advance` repeatedly returns 500, the card can remain confidently `queued` forever. No lease exists to catch it, and every status poll looks healthy.

Track consecutive advance failures in the client. After a short threshold, keep retrying but show:

> Spideryarn can see this import but cannot continue it right now. It will keep trying.

Keep Stop available. This is a communication failure rather than a server ownership state, so it does not need a durable job status.

## If only one piece is built

Move the driver to the application shell and make it a reconciliation point: any page resumes queued jobs, expired running jobs become actionable, and duplicate additions reconnect to the existing job. That removes the reader-visible dead end with the fewest new parts.

After that, fix expired cancellation semantics. Elapsed-time copy is third. A cron or takeover is not warranted for this failure.