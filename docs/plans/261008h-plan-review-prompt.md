You are reviewing a plan, read-only. Do not edit files.

The plan: docs/plans/261008h-deploy-reruns-only-the-tests-that-failed-and-ready-deploys-the-first-commit-carrying-its-notes.md

Context to read: scripts/deploy.ts (gatesAt, chooseReadyCommit, preflight's changelog gate, testGateFailure),
scripts/deploy-evidence.ts (testEvidenceFor — its silent-success clauses must survive),
scripts/changelog/release-paths.ts (notesAt), scripts/deploy-checks.ts (changelogGap, failingTestsFromReport),
tools/fleet/readiness.ts (record shape, parseRunRecord), scripts/readiness-run.ts, vitest.config.ts,
docs/project/deployment.md § Deploying a commit already known green, docs/project/overseer.md § Deploying,
docs/plans/261007k-deploy-a-commit-the-readiness-loop-already-saw-green.md, docs/reusable/silent-success.md.
The readiness store is ~/.fleet-readiness/runs/ on this box; you may read it.

Greg has accepted, in substance, the risk that rerunning only the failed test files misses a break
elsewhere. The constraints: nothing may claim evidence it does not have (a reused run that is not
what it claims must fall back to the full suite and say why), and the design should stay simple.

Questions I want answered explicitly:
1. Is the diagnosis of why --ready never deployed right?
2. Is B (deploy the earliest commit on origin/dev containing the green commit G whose notes pass)
   sound? Anything in the changelog gates (changelogGap, servingUnrecorded, `late` commits) or the
   trunk/main ancestry gates that breaks it?
3. Should a GREEN ancestor run count for a later commit (the plan says yes, for consistency with red)?
   Or should partial reuse be limited to red runs, or to a bounded X..Y? Give a recommendation.
4. Rerun set = failed-at-X files ∪ test files changed in X..Y, full suite if test infrastructure
   changed. Is the infra list right? Anything cheap and sound to add?
5. The outcome reporter approach (custom vitest reporter via env var; CLI --reporter overrides config
   reporters) — holes? Nested vitest runs, workers, projects, interrupted runs, files filtered out.
6. Any way the new evidence could be stale, spoofed by an ordinary agent mistake, or about a different
   tree than claimed (e.g. deploy-gate records under logs/deploy/, which any agent could write)?
7. Anything simpler that gets the same result.

Answer with numbered findings, each P1/P2/P3, each with the concrete failure and the fix. End with a
one-line verdict: "VERDICT: proceed", "VERDICT: proceed with changes", or "VERDICT: rethink".
