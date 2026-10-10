Two findings fixed:

- **F5 — P2:** Empty or whitespace-only `VITEST_MAX_WORKERS` bypassed yielding, although the worker parser treats it as unset. Fixed normalization in [vitest-admission.ts:468](/var/tmp/spideryarn-worktrees/agent-ad0771f45a448b407/vitest-admission.ts:468), with regressions in [deploy-claims-the-box.test.ts:63](/var/tmp/spideryarn-worktrees/agent-ad0771f45a448b407/tests/deploy-claims-the-box.test.ts:63). Both cases failed before the fix.
- **F6 — P3:** The message claimed a final worker count before CLI overrides; docs overstated immunity to memory admission and changelog lock duration. Corrected [vitest.config.ts:121](/var/tmp/spideryarn-worktrees/agent-ad0771f45a448b407/vitest.config.ts:121), related comments, and `testing.md:179`, `deployment.md:346`, `overseer.md:609`.

Validation: **178 targeted tests passed**, typechecking passed via the Node tsx loader, and lock paths agreed across 11 checkouts, including the live `/tmp` gate. Private-postgres remains serial; no stale `deploy-checks` lock references remain.

Wider limitation unchanged: fleet/readiness previews omit yielding, as the plan acknowledges. No full suite run and no commits.