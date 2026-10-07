Fixed five findings; changes are uncommitted.

1. **P1 — Tied passes made input order choose the evidence.** [deploy-evidence.ts](/var/tmp/spideryarn-worktrees/deploy-from-green/scripts/deploy-evidence.ts) now refuses ambiguous timestamps. `deploy-ready.test.ts` covers both orders with differing preparation, failed builds and standalone tests.

2. **P1 — An overlapping active check could disappear behind a later finish.** `deploy-evidence.ts` now refuses reuse while a relevant check is running. Covered by the started-before-finish regression.

3. **P1 — Preparation could leak into another run.** [readiness-loop.ts](/var/tmp/spideryarn-worktrees/deploy-from-green/scripts/readiness-loop.ts) and [readiness-run.ts](/var/tmp/spideryarn-worktrees/deploy-from-green/scripts/readiness-run.ts) strip inherited stamps from child environments. Covered by the inheritance regression in `readiness-preparation.test.ts`.

4. **P1 — The stamp did not prove which environment the wrapper read.** `readiness-run.ts` verifies `.env.local` at both ends; [readiness.ts](/var/tmp/spideryarn-worktrees/deploy-from-green/tools/fleet/readiness.ts) preserves an exact finished-run verification flag, required for reuse. This also prevents older wrappers merely echoing a newer loop version. Covered by wrapper integration, old-wrapper refusal and parser tests.

5. **P2 — A rejected runner could still lose its `.env.local` copy.** `readiness-loop.ts` validates before replacement and avoids linking after refused advancement. Covered by the unregistered-runner preservation test.

Inspection found no further defect in `deploy.ts`: the chosen SHA reaches the push, null preflight results record failures, and reuse still executes teardown.

**Validation:** 63 focused tests pass; full TypeScript checking passes via `node --import tsx scripts/typecheck.ts` because the npm command’s tsx IPC is sandbox-blocked. Regression failures were observed before fixes; removing the finished-record validation also made its test fail.

**Left for you:** rerun the broader readiness suites outside this sandbox—219 passed, eight failed around restricted subprocess/FIFO operations. Full process-environment equivalence and detecting `.env.local` changes later reverted remain broader limitations.

No deploy, commit, readiness-store access or runner-worktree modification was performed.