You are reviewing a plan (and its first implementation) in the Spideryarn repo, read-only. Do not edit any file.

Read: docs/plans/261010j-deploy-test-run-claims-the-box.md (the plan; PRIVATE_RESULT/PARALLEL_ESTIMATE/GAIN_ESTIMATE are placeholders for a measurement still running), then the working-tree diff (`git diff`, including new files scripts/release-lock.ts and tests/deploy-claims-the-box.test.ts), vitest.config.ts, vitest-admission.ts, scripts/deploy.ts (the test gate around `const vitest = (files`), scripts/lockfile.ts, tests/vitest-worker-caps.test.ts, docs/project/testing.md § "A run is not the only thing on the machine" and § "While a deploy runs".

Goal (Greg, 2026-10-10): make the deploy's test run faster, by running more in parallel; conserving box resources (agents pausing tests) is acceptable. Constraint: no flaky DB contention, no loosened correctness gates, prefer a small mechanism reusing the deploy lock and worker sizing.

Please answer:
1. Is the design correct and the simplest that gets most of the gain? Is there a simpler or clearly better option within the same complexity budget (e.g. something about vitest's sequential group that the plan missed)?
2. Correctness risks: can this de-serialise the private-postgres lane, change any test's verdict, or make any existing test red during a deploy (worker-caps tests, fleet-admission tests, readiness-loop, nested createVitest runs inside the deploy's own suite, the deploy's partial reruns)? Can the yield fire when it should not, or fail to fire, in ways that matter (worktrees, readiness runner checkout, gate worktree in /tmp, stale lock, EPERM)?
3. Anything in the plan text that is wrong or overclaimed.

Give findings as a numbered list with severity (P1 must fix / P2 should fix / P3 nit), file:line, and a concrete fix. Be concise.
