# GPT Sol, code review of plan 261008j (2026-10-09)

Up: [the plan](261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md). Its answer, verbatim; the prompt was `review/261008j-code-review-prompt.md` in the build worktree.

VERDICT: ship after fixes

1. **P1 — [src/shelf-topic-sets.ts:533](/var/tmp/spideryarn-worktrees/public-shelf-topic-pills/src/shelf-topic-sets.ts:533): withdrawn wording could survive a rebuild.** Previous labels were supplied to the model after un-sharing, while rebuilt memberships removed the article’s ID and lifted withholding. **Fixed:** public rebuilds clear previous labels when an input disappears. Reader behavior is preserved. Regression observed red, then green.

2. **P2 — [src/public-shelf-topics.ts:138](/var/tmp/spideryarn-worktrees/public-shelf-topic-pills/src/public-shelf-topics.ts:138): an un-share during a rethink could leave topics hidden indefinitely.** Its trigger found the live claim; the running job wrote its stale snapshot and drained only arrivals. **Fixed:** one bounded reconciliation pass, within the same site scopes and request collector, using a separate allowance. The drain skips withdrawn-input trees. Removal and removal-plus-arrival regressions pass.

3. **P2 — [scripts/share-local-articles.ts:80](/var/tmp/spideryarn-worktrees/public-shelf-topic-pills/scripts/share-local-articles.ts:80): the local sharing helper bypasses refresh triggers.** It calls the store directly, so topics wait for another trigger. **Left for you:** broader script integration. MCP uses the HTTP routes and gets the refresh.

Gates run:

- Requested nine-suite Vitest command: **blocked by Docker access**. Postgres, owner-isolation, and billing-admin-plan suites remain unverified.
- Six runnable requested suites: **112 tests passed**.
- `npm run typecheck`: launcher blocked by sandbox IPC permissions. Node-loader fallback compiled all four projects successfully, then **failed coverage** on existing `review/local-public.ts` and `review/local-refresh.ts`.
- Touched-file lint: passed, with one complexity advisory.
- Documentation links: **18 tests passed**. Scoped whitespace check passed.

Fixes are applied; rerun the blocked gates before shipping. No commit, push, deploy, or database write was made.