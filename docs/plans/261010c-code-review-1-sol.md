APPROVE WITH CHANGES

### Findings

- **C1 — P1:** Concurrent Send requests could let a superseded attempt create a voucher from its stale frozen snapshot after another request unfroze the gift. The voucher creation transaction now locks and revalidates the exact send attempt immediately before insertion; revoked attempts return `superseded`. Evidence: [pg-author-gifts.ts:774](/var/tmp/spideryarn-worktrees/author-gift/src/store/pg-author-gifts.ts:774), [pg-vouchers.ts:519](/var/tmp/spideryarn-worktrees/author-gift/src/store/pg-vouchers.ts:519), [routes.ts:9880](/var/tmp/spideryarn-worktrees/author-gift/src/routes.ts:9880).  
  **FIXED (`src/store/pg-author-gifts.ts`, `src/store/pg-vouchers.ts`, `src/routes.ts`; regression test [author-gifts.test.ts:481](/var/tmp/spideryarn-worktrees/author-gift/tests/author-gifts.test.ts:481)).**

- **C2 — P2:** Lookup cost aggregation joins `author_lookups.run_id` to the growing AI-call ledger without an index on `ai_calls.run_id`. Added the index to the schema, migration, and snapshot. Evidence: [schema.ts:4072](/var/tmp/spideryarn-worktrees/author-gift/src/db/schema.ts:4072), [20261009220519_author_gifts.sql:67](/var/tmp/spideryarn-worktrees/author-gift/drizzle/20261009220519_author_gifts.sql:67).  
  **FIXED (`src/db/schema.ts`, migration and snapshot; red-first schema regression test [author-lookup.test.ts:360](/var/tmp/spideryarn-worktrees/author-gift/tests/author-lookup.test.ts:360)).**

No further findings from the requested audit. In particular, voucher replay delivery lookup, owner impersonation, exact-address validation, lookup claim/finish fencing, draft-only application, note truncation, provenance clearing, authorization, and additive constraints match Revision 3.

Validation:

- `tests/author-lookup.test.ts`: 23 passed.
- Typecheck: passed via the underlying `node --import tsx scripts/typecheck.ts`; the npm wrapper hit the sandbox’s IPC `EPERM`.
- Drizzle schema check and scoped Biome lint: passed.
- `git diff --check`: passed.
- The DB-backed race test in `tests/author-gifts.test.ts` was added but cannot run in this sandbox. Please rerun the DB-backed command from the prompt.

Files changed:

- `drizzle/20261009220519_author_gifts.sql`
- `drizzle/meta/20261009220519_snapshot.json`
- `src/db/schema.ts`
- `src/routes.ts`
- `src/store/pg-author-gifts.ts`
- `src/store/pg-vouchers.ts`
- `tests/author-gifts.test.ts`
- `tests/author-lookup.test.ts`

No commit was created, and concurrent UI/MCP files were not touched.