The missing-column core is sound, and the health cache works by inspection. I found one known blocker and four meaningful gaps.

1. **Blocker — it still does not prevent a bad release.**

   [`db:check`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/db-check.ts:67) is useful manually, but neither [`vercel.json`](/Users/greg/Dropbox/dev/experim/spideryarn2/vercel.json:4) nor the deploy sequence runs it before promotion.

   Shipping this slice is still better than not shipping it: health gains a specific diagnosis, and operators gain a manual command. But the incident class is not closed.

   **Concrete change:** after migrations and before the push at [`scripts/deploy.ts:1089`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/deploy.ts:1089), run the checker from the captured SHA’s worktree against the app-role URL. Run it even with `--skip-migrations`. Also add a production-only Vercel build gate so a direct push cannot bypass the deploy script.

2. **Should-fix — declared-column default and nullability drift can look healthy.**

   [`declaredTables()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema-drift.ts:77) discards everything except column names. [`requiredButUndeclared`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema-drift.ts:168) examines requiredness only for columns absent from TypeScript.

   Concrete false-green: `jobs.cancelling` is declared `NOT NULL DEFAULT false`, while [`tryEnqueue`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:100) omits it. Drop that database default and the current checker remains clean because the column exists, but every new job insert fails.

   The same problem applies if a declared nullable column becomes `NOT NULL`, or a declared non-null column becomes nullable and returns `null` where TypeScript says it cannot.

   **Concrete change:** retain Drizzle’s `notNull`, `hasDefault`, `generated`, and identity metadata. Compare declared-column nullability and required database defaults, not only database-only extras. Add a rollback test that drops `jobs.cancelling`’s default and proves the report goes red.

3. **Should-fix — the privilege gap is real.**

   `information_schema.columns` exposes columns for which the role has some privilege. A role with schema `USAGE` and table `INSERT`, but no `SELECT`, can therefore supply every expected row to [`ACTUAL_SCHEMA_SQL`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema-drift.ts:111). The report is clean while application selects fail.

   Today’s table-wide DML grants reduce the likelihood; they do not make the check detect an out-of-band `SELECT` revocation.

   **Concrete change:** return `has_column_privilege(..., 'SELECT')` for each column and treat non-selectable expected columns as inaccessible. Since the documented role contract is full DML, the deploy gate should preferably assert table-level `SELECT`, `INSERT`, `UPDATE`, and `DELETE` separately too.

4. **Should-fix — the caller tests are missing, and several assertions overclaim.**

   I ran the two relevant suites: all 37 tests passed, including all five real-database mutation tests. The core tests are valuable: dropped column, required extra, view replacement, and rollback genuinely exercise the query.

   However:

   - Every current health test would pass if the schema integration were deleted. None asserts `schema`, a schema warning, or schema-driven 503.
   - The flood test counts only `listArticles`; schema coalescing could issue 25 queries and still pass.
   - No test makes the schema query reject and asserts `schema.error` plus 503.
   - No test covers the filesystem-store omission or proves `getDb()` was not called.
   - No test exercises `db-check.ts`; it could always exit zero while every comparison test remained green.
   - The schema-`USAGE` test supplies `schemaUsable:false` directly, so it passes if the SQL privilege expression is broken.
   - The real-database suite silently skips when Postgres is absent or unreachable.
   - The view test at [`tests/db-schema-drift.test.ts:261`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/db-schema-drift.test.ts:261) proves at least one `jobs` column is missing, not that all declared `jobs` columns were excluded.
   - The 16-table assertion checks a count, not the exact table set.

   **Concrete change:** mock `getDb().execute()` before importing health and add missing/error/files/concurrent cases; refactor the CLI into an injectable `main()` and assert its exit status; require Postgres in CI; compare the exact expected table and view-missing column sets.

5. **Should-fix — zero rows produce the correct failure but a false diagnosis.**

   [`readActualSchema([])`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema-drift.ts:129) necessarily says `schemaUsable:false`, because the privilege expression exists only on column rows. An empty schema can therefore have valid `USAGE` while health claims it does not.

   Reporting all declared columns missing is correct. Reporting lost schema `USAGE` is misleading.

   **Concrete change:** anchor the query on a one-row schema-access CTE and left-join the base-table columns. Filter the null sentinel in `readActualSchema`. Then an empty usable schema reports only the genuinely missing columns.

6. **Should-fix — the new request-path log violates the project logging contract.**

   [`console.error()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/vercel-health.ts:440) runs inside a server request path. It also claims to log the “whole error” while logging only its message.

   **Concrete change:** use `src/log.ts` and log the error object through the health logger, leaving the bounded message only in the public response.

The direct answers:

- Interpolating `SCHEMA` is safe here because it is a source-owned constant with no caller-controlled path. It would stop being safe immediately if made configurable.
- The `BASE TABLE` join correctly rejects an ordinary view occupying the expected name.
- The health implementation genuinely coalesces: waiters share `schemaInFlight`, the cache is populated before that promise resolves, and `finally` clears it.
- A normal query exception becomes `schema.error`, makes `failed` true, and produces 503.
- `STORE === "postgres"` is the correct gate, and omitting `schema` on the filesystem store is clearer than returning `null`.
- Types, constraints, indexes, triggers, and migration history remain deliberate blind spots; a same-named base table with the right column names but wrong types can still pass.