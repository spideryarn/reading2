**The plan is not sound as written.** The split and checkpoint are sensible, but the timing guarantee needs changes.

1. **High — the brief has an estimate, not a clock.**  
   `deadlineFor(52_000)` returns 685 s, but [the brief call](/var/tmp/spideryarn-worktrees/illustrated-split-and-late-stop/src/illustrated.ts:1172) never enforces that deadline. `streamMessage` sets no whole-call timeout; slow streams, prefill and transport retries can still consume the claim and lose an unfinished brief. Reducing `max_tokens` does not establish a wall-clock bound.  
   **Smallest fix:** enforce one brief timeout around the entire `finalMessage()` operation, including retries, using a signal composed with the claimant’s signal.

2. **High — “no window left: runs on” defeats admission, and the gates reserve no cleanup time.**  
   On the final window, a 600 s brief leaves roughly 140 s. The plan permits starting four plates requiring up to 480 s; the claim interrupts a later plate. Even with another window available, admitting plates with exactly `n × 120 s` remaining leaves nothing for bookkeeping, image storage or settlement.  
   **Smallest fix:** check remaining time regardless of requeue availability. Hand back when another window exists; otherwise report insufficient time without starting the request. Include a cleanup margin in admission, and start each request’s timer immediately before that request.

3. **High — the new plate timeout conflicts with `wasAborted`.**  
   [It treats `TimeoutError` as cancellation](/var/tmp/spideryarn-worktrees/illustrated-split-and-late-stop/src/illustrated.ts:1290), even when the claimant’s signal remains live. A normal `AbortSignal.timeout` expiration would stop the whole plate loop. The resulting `cancelled: true` reaches `discardOnAbort`, but that guard throws only if the claimant’s signal actually aborted; otherwise the partial set can be committed. Provider `TimeoutError` already has this problem.  
   **Smallest fix:** distinguish claimant cancellation from the plate clock explicitly. Claimant cancellation stops the set and preserves the existing `discardOnAbort` protection; plate timeout and provider timeout mark that plate failed and continue. Create the plate clock once around `openRouterImage`, not per transport attempt. Its retry loop already stops when the supplied signal aborts.

4. **Medium — a failed bank write can discard and repeatedly rebuy a completed brief.**  
   The migration fallback says checkpoint writes warn and execution continues. If the brief finishes with too little time for plates, the step then throws `NeedsAnotherWindow` without having saved it. Each subsequent window buys it again; the final window runs into finding 2.  
   **Smallest fix:** apply the namespace migration before enabling the split, and require an acknowledged checkpoint write before deliberately handing back a newly generated brief. Handle failed persistence explicitly rather than describing a warn-only write as banking.

5. **Medium — the Stop sentence asserts an ordering the timestamp cannot prove.**  
   `cancel_requested_at IS NOT NULL AND status = 'done'` means **an accepted Stop followed by completion**. It does not prove the last step had already finished when Stop arrived. [The assets step](/var/tmp/spideryarn-worktrees/illustrated-split-and-late-stop/src/pipeline.ts:3677) can honour the abort, stop fetching images, return a partial manifest, and still finish `done` under 261007f.  
   **Smallest fix:** keep the predicate, but use truthful copy, for example: “You pressed Stop during the last step. The work it returned was kept.” I found no application path stamping the column independently of `requestCancel`; honoured cancellations that end `cancelled` do not match, and Retry creates a new job.

The proposed **job id + input fingerprint + brief model** key is appropriate. Job id alone is cheaper and meets the two identity requirements, but loses protection against changed inputs or model selection between windows; retain the proposed key.

The schema change must update `CheckpointNamespace`, `CHECKPOINT_NAMESPACES`, the schema CHECK and the migration together. The existing database test already exercises every declared namespace. Preserve `IllustratedRun`’s required fields on checkpoint hits—zero brief usage/time for that window avoids an absent `message`; the eval runner can remain unchanged.

The simplest robust design is still this two-unit split: **enforced clocks, durable brief checkpoint, admission with cleanup margin, and explicit exhausted-window handling**. Plate checkpoints are unnecessary for the stated requirement.