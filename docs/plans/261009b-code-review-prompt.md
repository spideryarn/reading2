You are reviewing a small change in the Spideryarn repo (this worktree). Review both the plan's
diagnosis and the code. You may fix what you find inside this change's scope (the three files in the
diff); report anything wider without fixing it.

Read first:
- docs/plans/261009b-deploy-names-the-nearer-test-run-still-going-when-it-runs-the-whole-suite.md (the plan, including its diagnosis)
- docs/plans/261009b-code-review.diff (the change)
- scripts/deploy-evidence.ts § partialEvidenceFor and readinessFullRuns; scripts/deploy.ts § partialEvidenceAt and the test gate (~line 1160–1240)
- docs/plans/261008h-deploy-reruns-only-the-tests-that-failed-and-ready-deploys-the-first-commit-carrying-its-notes.md (the design this sits in)
- Evidence: ~/.fleet-readiness/runs/001791500866508-39a00e871fcc.json (green on e229c575, started 23:07Z, finished 00:21Z) and 001791495193767-260ec0c4c48f.json (void on 25c673ca); /home/greg/code/spideryarn2/logs/tmux-jobs/deploy-0100-0055-3891598.log (the deploy); `git log -1 --format=%ci af37412f` (committed 00:55 +0100). The replay script is /tmp/claude-1000/-home-greg-code-spideryarn2/168d09ce-0c01-4be8-b6ad-7fe7f9e2ab1d/scratchpad/replay.ts (run with `npx tsx <it> af37412f <ISO time>`).

Questions:
1. Is the diagnosis right — that the brief's premise was a BST/UTC confusion, and that the existing
   partial path already reuses a parent's green run across a notes-only commit (changelog-pending.json
   is neither a test file nor test infrastructure)? Is there any path in which a notes-only commit on
   top of a green, finished, version-3 readiness run would still run the whole suite (exact-commit path,
   partial path, `--ready`)? If yes, that is the real bug: say so concretely.
2. Is choosing 25c673ca (the void settled run) over the still-running e229c575 correct under 261008h?
3. The code: does `refuse` change any decision (it must only change words)? Is `nearerGoing` right
   (running, nearer than x, ancestor-or-equal of the candidate via `related`)? Any silent-success
   clause weakened? Is the test meaningful?
4. Is the deployment.md sentence accurate?

Gates: `npx vitest run tests/deploy-partial-evidence.test.ts tests/deploy-ready.test.ts tests/deploy-checks.test.ts` and `npm run --silent typecheck`.

End your answer with a line `VERDICT: ship | ship after my fixes | do not ship`, and list each finding with severity (P1/P2/P3).
