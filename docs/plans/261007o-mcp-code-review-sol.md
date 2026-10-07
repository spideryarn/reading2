1. **C1 — P2, fixed: long titles hid the article identity during approval.** The dialog truncates each line at 300 characters; a 400-character title removed the trailing slug. [Fix](/var/tmp/spideryarn-worktrees/mcp-admin-tools-oauth/src/mcp/tools.ts:470): display the slug separately. The [rendered-dialog regression](/var/tmp/spideryarn-worktrees/mcp-admin-tools-oauth/tests/mcp-tools.test.ts:699) failed before the fix and now passes.

2. **C2 — P2, fixed: recent sign-ins could sort behind older activity.** `lastReadAt ?? lastSignInAt` preferred an old read over a newer sign-in, potentially excluding recently active users under `limit`. [Fix](/var/tmp/spideryarn-worktrees/mcp-admin-tools-oauth/src/mcp/tools.ts:203): select the latest date. The [ordering regression](/var/tmp/spideryarn-worktrees/mcp-admin-tools-oauth/tests/mcp-tools.test.ts:856) failed before the fix and now passes.

No additional concrete defects found in key-disclosure paths, approval/execution binding, option forwarding, admin authorization, or privacy wording. Root-cause postmortems were added for both fixes. Nothing was committed or staged.

Validation: 108 tests passed across the three non-database suites; lint and diff checks passed. `npm run typecheck` hit sandbox IPC restrictions, but the same script passed via `node --import tsx scripts/typecheck.ts`.

The exact four-suite command was attempted but blocked by sandbox restrictions on local Postgres and Docker. Database concurrency tests remain unverified here.

VERDICT: not ready