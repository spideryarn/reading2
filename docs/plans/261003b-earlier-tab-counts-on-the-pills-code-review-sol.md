Reviewed and fixed the in-scope findings. No database or git-changing commands were run; changes remain uncommitted.

- **P0 — None.**

- **P1 — [tests/store-transaction-isolation.test.ts:114](/home/greg/code/spideryarn2/.claude/worktrees/fb95-earlier-tab-counts/tests/store-transaction-isolation.test.ts:114):** the repository isolation-policy test assumed every transaction in a file shared one policy, so `pg-feedback.ts`’s new read-only repeatable-read transaction would fail the full suite alongside its read-committed submit transaction. I keyed exceptions by file plus named options constant and added a check that every exception is actually used.

- **P2 — [FeedbackEarlier.tsx:86](/home/greg/code/spideryarn2/.claude/worktrees/fb95-earlier-tab-counts/src/web/FeedbackEarlier.tsx:86), [feedback-dialog.test.tsx:1533](/home/greg/code/spideryarn2/.claude/worktrees/fb95-earlier-tab-counts/tests/feedback-dialog.test.tsx:1533):** `more: true` accepted fewer than 50 returned rows. This let the test bless the impossible sentence “Showing the 50 most recent of your 45…”. The guard now requires a full capped page; the test uses 50 unique rows and 115 not-shipped reports. The plan’s example was corrected too.

- **P2 — [FeedbackEarlier.tsx:100](/home/greg/code/spideryarn2/.claude/worktrees/fb95-earlier-tab-counts/src/web/FeedbackEarlier.tsx:100):** the shape guard accepted duplicate report IDs, status counts contradicted by listed rows, and shipped rows in a Not shipped answer. These are now rejected, with targeted tests.

- **P2 — [FeedbackEarlier.tsx:273](/home/greg/code/spideryarn2/.claude/worktrees/fb95-earlier-tab-counts/src/web/FeedbackEarlier.tsx:273):** the pill’s DOM text was `Not shipped1`; CSS gap supplied only visual separation. I added a literal space and pinned `Not shipped 1` in the test.

The store and route logic are otherwise sound: the transaction is safe through the transaction pooler, uses no session-scoped feature or prepared statement, both queries remain on one transaction connection, the count and filter share `idMember`, and both are owner-scoped. The route includes counts on every valid filter response.

Checks:

- Dialog and route: 133 tests passed; final dialog suite: 90 passed.
- Typecheck: all four projects passed; all 2,772 source files covered.
- Biome lint and `git diff --check`: passed.
- The requested combined command could not collect the Postgres store suite because this sandbox denies Docker/local-database access with `EPERM`; no database-backed assertion ran here.

**Verdict: GO — no unresolved findings; rerun the DB-backed focused command outside this sandbox before pushing.**