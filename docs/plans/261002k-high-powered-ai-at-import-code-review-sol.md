Verdict: approve after review fixes; no P0 remains.

Review written to [261002k-high-powered-ai-at-import-code-review-sol.md](/home/greg/code/spideryarn2/.claude/worktrees/fbs2rsxy-high-powered-at-import/docs/plans/261002k-high-powered-ai-at-import-code-review-sol.md).

Fixed:

- P1: Retry could lose a checked pre-claim intent after a terminal 404.
- P1: refused switch-off incorrectly appeared off and could not be retried.
- P2: import/help copy overclaimed which work would use Opus.
- P2: tests did not distinguish the allocated job slug or cover StrictMode/new-address boundaries.

Verification:

- Focused tests: 83 passed.
- Typecheck: all four projects passed via the direct script; the npm wrapper hit sandbox IPC denial.
- Lint and `git diff --check`: passed.
- Full `npm test` could not start because sandboxing denied Postgres access; no database was touched.
- No commit created.