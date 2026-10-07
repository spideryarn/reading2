You are reviewing CODE in this worktree, built from docs/plans/261007k-deploy-a-commit-the-readiness-loop-already-saw-green.md. You reviewed the plan earlier (docs/plans/261007k-deploy-a-commit-the-readiness-loop-already-saw-green-review-sol.md); the plan's last section, "After the plan review", says what was done about each of your findings. The change is commit 6efd129f0: `git show 6efd129f0 -- scripts tools tests`.

This is the production deploy path (scripts/deploy.ts) and it is held to a higher standard. The question is always the one in docs/reusable/silent-success.md: can a record that only LOOKS like evidence make the deploy skip its test gate, or make `--ready` ship the wrong commit?

House rule for this review: **fix what you find, inside this change**, with a test that fails without your fix. Do not widen the change beyond these files unless a fix requires it; report anything wider instead of doing it. Do not commit. Do not run `npm run deploy` in any mode (a production deploy may be running and holds the release lock). Do not touch ~/.fleet-readiness or the readiness runner worktree. You may run `npx vitest run <files>` and `npm run typecheck`.

Please check in particular:
1. scripts/deploy-evidence.ts `testEvidenceFor`: any path to `reuse` that should be `run`. Consider how `readinessVerdict` picks the `test` evidence record (newest settled event) versus the record whose rows/stamp are checked, started records, two records with identical `at`, a `check` pass whose verdict evidence is a different record than the newest check.
2. scripts/readiness-run.ts `preparationFromEnv` and where `common.preparation` is set: is the stamp written into both the started and finished records, and can a stamp ever be attached to a run it does not describe?
3. scripts/readiness-loop.ts: `linkRunnerEnvLocal`, `refreshRunnerCorpus`, `preparationEnv`, and the tick ordering (link at tick start; refresh and stamp only when decision is run; stamp only when `preparation.preparedFor === decision.sha`). Anything that can stamp a run whose preparation did not happen, or break the loop on the box (the runner currently has a regular-file .env.local copy that will be replaced by a symlink on restart).
4. scripts/deploy.ts: `chooseReadyCommit`, the `--ready` trunk gate, `preflight` returning null, the always-`npm ci` change, the test-gate reuse inside `gatesAt` (note it `return`s from inside a try/finally — check the teardown still runs and nothing after it was skipped that should run), and the summary line.
5. tools/fleet/readiness.ts parser change for `preparation`.

At the end, write a short report: numbered findings with severity, what you changed (file + one line each) and which test now covers it, and anything you deliberately left for me.
