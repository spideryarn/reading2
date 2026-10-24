Review complete. I fixed three findings:

- `buildCrossrefs` incorrectly included pre-existing `nearby` drops when classifying the current answer. It now compares the per-call delta, with a red-first regression test. [crossrefs.ts](/var/tmp/spideryarn-worktrees/fbrvj2p7-crossrefs-failure-wording/src/crossrefs.ts:181)
- Importing `auto-mode-steps.ts` broke the client-import purity guard. The dependency is acyclic and browser-safe; I added the pure module to the enforced allowlist. [client-imports.test.ts](/var/tmp/spideryarn-worktrees/fbrvj2p7-crossrefs-failure-wording/tests/client-imports.test.ts:175)
- New code/docs called every `AUTO_MODE_STEPS` job a “main-mode job,” although cross-references is explicitly not a mode. I renamed the private predicate and corrected the plan, postmortem, tests, and reference copy.

Verified:

- Every raw crossref row is counted at most once under its first failing rule. Malformed/non-object rows cannot pass as nearby.
- `generateCrossrefs` supplies fresh counters, although the exported builder permits pre-populated accumulators.
- Every current `AUTO_MODE_STEPS` member writes only to the claim draft; failed/interrupted jobs do not publish it. `labels`, which can mark the published revision failed, remains excluded.
- The label rename has no broken current-code, fixture, or snapshot references. Historical references remain intentionally.
- Existing stored jobs retain their persisted old label; retries/new jobs receive “Adding cross-references.” I did not add a production-data rewrite.
- Report wording and all four reviewed docs now match the code.

Checks:

- Requested four test files: 72 passed.
- Including client-import regression: 77 passed.
- Documentation links: 18 passed.
- Typecheck: all four TypeScript projects passed; all 3,934 files covered. `npm run typecheck` itself hit sandbox IPC `EPERM`, so I ran the same script via `node --import tsx`.
- Scoped lint completed with no errors; only pre-existing complexity/style advisories.
- `git diff --check` passed.

No commit was made. An unrelated untracked feedback note appeared during review; I did not touch it.