**Not ready.**

1. The terminal-transition inventory is complete, with one naming correction:

   - PostgreSQL: `finishIn`, `settleExpired`, `requestCancel`’s terminal branches, and `releaseStepIn`’s cancelling branch all stamp `finishedAt`.
   - Filesystem: `finish`, cancelling `releaseStep`, `settleExpired`, immediate `requestCancel`, and startup recovery through `sweepStopped` all stamp it. `settleExpired` and `requestCancel` share `settleAbandoned`.

2. The PostgreSQL retention statement is correct. The derived table must project `is_done`; `ORDER BY rank ASC, is_done ASC` puts non-success first because PostgreSQL sorts `false` before `true`. `finished_at DESC NULLS LAST` is also correct—without the explicit clause, `DESC` would put nulls first.

3. Case 1 is necessarily red now and green afterwards. Case 2 is not concrete enough to guarantee that:

   - Use exactly three successes with `keep = 2`.
   - Create A, then B, then C.
   - Stamp finishes B, then C, then A with distinct fixed instants.
   - Assert A and C survive.

   Current code keeps B/C by creation time and deletes A; the revision keeps A/C by finish time. Reuse `stampFinished` here as well as in the tie test, otherwise millisecond ties can make the green result flaky.

4. The `stampFinished` seam is justified; no `JobStore` operation can tie or choose `finishedAt`. Make the filesystem helper async and persist the mutation, so its index and durable record do not disagree.

5. The plan still overclaims “a just-ended job is never deleted.” In practice, production passes 50 and parity tests pass 2; nothing passes 0 or 1. At `keep = 0`, everything goes. At `keep = 1` with both kinds present, the non-success wins and a fresh success is deleted. Qualify the guarantee to `keep >= 2` and the current production constant.

   Also, PostgreSQL stamps with `now()`, which is transaction-start time, not commit time. Consequently “rank 1 by construction” is not literally guaranteed under overlapping transactions. The simpler fix is to soften that claim rather than widen this work into rewriting every timestamp.

6. Stage 2 is worth keeping. Test that a 404 causes one attempt, no failure-count increment, no wait, and loop termination.

7. Move the stale-wording edits into Stage 1. In Stage 3, add the required full `npm test` and lint of touched files. The proposed browser check is not evidence for this bug unless the owner first has a saturated non-success history; either establish that precondition or drop it as a retention verification.