You are reviewing code you may fix. You are in a git worktree; edit files in it directly. Do not commit,
push, or run `npm run deploy` in any form. Do not touch any database other than the local test one the
suite creates.

The work: docs/plans/261008h-deploy-reruns-only-the-tests-that-failed-and-ready-deploys-the-first-commit-carrying-its-notes.md
(read it, including § After the plan review — that was your plan review, docs/plans/261008h-plan-review-sol.md).
The diff: docs/plans/261008h-code-review.diff (commit HEAD, against HEAD~1).

Files: scripts/vitest-outcome-reporter.ts, tools/fleet/test-outcome.ts, scripts/deploy-evidence.ts
(partialEvidenceFor, readinessFullRuns, deployFullRun, firstCarryingNotes, runnerRecordProblem),
scripts/deploy.ts (gatesAt's test step, partialEvidenceAt, deployFullRuns/recordDeployRun,
chooseReadyCommit), scripts/readiness-run.ts, tools/fleet/readiness.ts (testOutcome on the record),
vitest.config.ts, tests/setup/private-db-global.ts, and the tests tests/deploy-partial-evidence.test.ts,
tests/vitest-outcome-reporter.test.ts, tests/readiness-preparation.test.ts.

The standard (docs/reusable/silent-success.md): nothing may claim evidence it does not have. Every way a
reused or partial run is not what it claims must end in the whole suite with a reason, or in a red gate.
Greg accepted the risk that rerunning only failed files plus changed test files misses a break elsewhere;
that risk is not a finding. Keep the design simple.

Look especially for:
1. Any path where the deploy's test gate passes without evidence: e.g. the partial path firing when the
   exact-commit path should have refused; a rerun with an empty file list that should have run something;
   vitest invoked with file arguments that don't mean what we think (substring filters, paths relative to
   which root); a rerun whose report file is a stale one from the full run in the same temp dir.
2. The reporter: does `process.once("exit")` actually fire and write in vitest 4.1.11 for both a clean
   exit and process.exit(code)? Does deleting the env var in the constructor happen before workers fork in
   all pools used by vitest.config.ts? Is globTestSpecifications() without filters the right "whole suite"?
   Does `onProcessTimeout` really leave the file un-finalised?
3. readinessFullRuns + partialEvidenceFor timeline: does a running readiness check, or a newer failed test
   run, on the nearest commit always block? Can a nearer run be skipped because it is outside the window
   while an older-but-further one is used (it must not)?
4. --ready: chooseReadyCommit's walk (commitsFrom, firstCarryingNotes with the origin/main and serving
   checks) — anything that would pick a commit the preflight then refuses, or pick a commit not on dev.
5. recordDeployRun / deployFullRun provenance: anything that lets a record from another sha, a dirty tree,
   or a different .env.local stand in.
6. readiness-run.ts: can testOutcome end up on a record it does not describe?

Run `npm run typecheck` and the test files above (`npx vitest run <files>`) after any change. Fix what you
find inside this scope; report anything wider without fixing it. End your answer with numbered findings
(P1/P2/P3, each: the failure, and what you changed or recommend), then one line:
"VERDICT: ship", "VERDICT: ship after my fixes", or "VERDICT: do not ship".
