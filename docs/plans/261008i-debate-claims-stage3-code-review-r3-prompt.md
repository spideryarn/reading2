# Narrow check: 261008i stage 3, the fix for E1, E6 and E7 after round 2

Read-only. Repo: Spideryarn, this worktree. Your round 2 is
`docs/plans/261008i-debate-claims-stage3-code-review-r2-sol.md`: E1, E6 and E7 still open. Discovery
is closed; check only this fix. Candidate: commit `3b8296652`, the `src/routes.ts` hunks in
`runDebateClaimCheck` and `CHECK_FINISH_RETRY_MS` (and its two test changes in
`tests/debate-claim-checks-routes.test.ts`). The G1–G4 changes in the same commit are your own
round-2 fixes; ignore them.

The fix: the call's deadline (`AbortSignal.timeout(DEBATE_CHECK_TIMEOUT_MS)`, 360 s) is now
created right after the reservation (`begin`) and passed to `generateClaimCheck`, so setup comes out
of the model's time. The allowance (lease = deadline + 60 s, `DEBATE_CHECK_RATE_POLICY` in
`src/debate.ts`) is taken after the reservation; the sweep's grace is deadline + 120 s from the
row's `created_at` (`CHECK_ORPHAN_GRACE_MS`). Finish retries: waits of 1 s, 3 s, 10 s.

Questions, one line each: (1) Does the lease now cover reservation → last finish attempt, given
ordinary store latency? (2) Does the grace? (3) Is anything still unbounded other than a single
store write hanging for over a minute (Postgres here has no statement timeout)? (4) Does an
already-aborted signal at call time end as a stored `error` with the allowance freed and the stream
closed, or can it hang or throw past the `finally`? (5) Any defect this introduced?

Give each of E1, E6, E7 "closed" or "still open: <exact path>", then any new finding (IDs H1…,
P0–P3, established or reasoned, file:line). One-line verdict. Do not edit files.
