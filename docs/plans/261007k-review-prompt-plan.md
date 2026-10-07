You are reviewing a PLAN (not code) in this repository: docs/plans/261007k-deploy-a-commit-the-readiness-loop-already-saw-green.md. Read-only review; do not edit files.

Context: scripts/deploy.ts is the production deploy (it gates one sha in a throwaway worktree, applies migrations, pushes <sha>:main). The readiness loop (scripts/readiness-loop.ts, scripts/readiness-run.ts, tools/fleet/readiness*.ts, docs/project/readiness.md) records full `npm run check` runs per dev commit in ~/.fleet-readiness/runs/. The plan lets the deploy (a) pick the newest green commit on origin/dev with `--ready`, and (b) skip its ~60-minute `test` gate when a readiness record provably covers the exact sha. Read docs/reusable/silent-success.md: the danger is a record that only looks like evidence.

Please read the plan, then the code it touches: scripts/deploy.ts (preflight, gatesAt, main, summarise), scripts/deploy-checks.ts (trunkGap, changelogGap, parseDeployArgs), tools/fleet/readiness-verdict.ts (readinessVerdict, aboutDevTree, timelines, reduceTimeline), tools/fleet/readiness-store.ts, tools/fleet/readiness.ts, scripts/readiness-loop.ts (ensureRunnerWorktree, prepareRunner, runReadinessCheck, tick), scripts/readiness-run.ts, scripts/check.ts, scripts/corpus-materialise.ts, scripts/changelog/release-notes.ts and release-paths.ts.

Find:
1. Any way the reuse rule (§2) would let the deploy skip the test gate for a sha whose suite was NOT shown to pass in an environment equivalent to the deploy's. Concrete scenarios, please.
2. Any way `--ready` would ship something it should not (wrong commit, commit not on origin/dev, commit behind production, missing notes), or the trunk-gate change under --ready weakens a guarantee plain deploy has.
3. Whether the "make the runner the same" table (§3) misses a difference, or whether the two fixes (symlink .env.local, re-materialise corpus before each check) are wrong or insufficient — e.g. a hand-run readiness-run.ts in the runner dir bypassing the corpus refresh.
4. Whether the changelog reasoning (§4) is right.
5. Anything simpler that gets the same result.

Answer with numbered findings, each with severity (P0 blocks, P1 should fix before building, P2 worth doing, P3 note), the scenario, and the fix you recommend. Be concise.
