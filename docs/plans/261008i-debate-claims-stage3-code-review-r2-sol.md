E1 — still open: the bucket, schema CHECK, migration, and `RateBucket` agree, and Dig deeper is untouched; however, the 420-second lease does not cover uncapped setup and finish retries, so concurrency can expire during a live call ([debate.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/debate.ts:2133), [routes.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/routes.ts:6042)).

E3 — fixed: recovery now follows the exact row announced by `begin`, with the newest matching row as the pre-`begin` fallback ([useDebateChecks.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/useDebateChecks.ts:105)).

E4 — fixed: reader checks use the same alternate-address copy rejection as direct Debate.

E5 — fixed: each paid target is drawn in exactly one current, unlisted, own, or earlier group; earlier-version groups are read-only, and Dig further derives targets and addresses from stored rows or refuses the ID.

E6 — still open: the 480-second orphan grace starts at reservation, while setup before the 360-second model deadline remains unbounded and has no durable heartbeat ([pg-debate-claim-checks.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/store/pg-debate-claim-checks.ts:40)).

E7 — still open: after three failed finish writes, a paid answer is discarded and its row remains pending until swept ([routes.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/routes.ts:5938)).

E8 — fixed: the post-reservation address read still closes the race and now precedes allowance admission, so a failed free read consumes no allowance ([routes.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/routes.ts:6019)).

E9 — fixed: focus/visibility refreshes discover another tab’s pending check.

E10 — fixed: free history loading is no longer presented as an active paid search.

E11 — fixed: GET sequencing remains newest-wins, and a delayed `begin` frame can no longer regress a terminal row to pending ([useDebateChecks.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/useDebateChecks.ts:74)).

### New findings

- G1 — P2, established: the guarded-store inventory omitted `pgDebateClaimChecksStore`. Added it; the contract test failed before and passes now ([store-guarded.test.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/tests/store-guarded.test.ts:367)).
- G2 — P1, established: E8’s final store read occurred after irreversible allowance admission, consuming quota without a model call if the read failed. Reordered the read and added a regression test ([debate-claim-checks-routes.test.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/tests/debate-claim-checks-routes.test.ts:542)).
- G3 — P1, established: E3 recovery could select another tab’s older, identical completed check and clear this tab’s picks while its own row remained pending. Fixed with row identity; regression was red then green ([use-debate-checks.test.tsx](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/tests/use-debate-checks.test.tsx:140)).
- G4 — P1, established: a delayed SSE `begin` could replace a completed GET result with pending. Made terminal state monotonic; regression was red then green ([use-debate-checks.test.tsx](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/tests/use-debate-checks.test.tsx:247)).

### Files edited

- [src/debate.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/debate.ts)
- [src/routes.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/routes.ts)
- [src/store/pg-debate-claim-checks.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/store/pg-debate-claim-checks.ts)
- [src/web/useDebateChecks.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/src/web/useDebateChecks.ts)
- [tests/debate-claim-checks-routes.test.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/tests/debate-claim-checks-routes.test.ts)
- [tests/store-guarded.test.ts](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/tests/store-guarded.test.ts)
- [tests/use-debate-checks.test.tsx](/var/tmp/spideryarn-worktrees/fbcaue42-debate-pick-claims/tests/use-debate-checks.test.tsx)

No commit made. The pre-existing untracked review documents were untouched.

### Tests

- Client regressions: 2/6 failed before fixes; 6/6 passed after.
- Relevant non-Postgres suite: 114/114 passed across six files.
- Postgres route test: could not collect because sandbox access to `127.0.0.1:54362` failed with `EPERM`.
- `npm run db:chain`: passed.
- Typecheck fallback: all four projects passed; all 3,549 source files covered.
- Scoped Biome lint: exit 0, with seven existing advisory diagnostics.
- `git diff --check`: passed.

**Verdict: do not land.** E1, E6, and E7 remain open.