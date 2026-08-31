The plan is not wrong in its bones. Column comparison is a good runtime backstop. But as written, it detects a bad deployment after promotion; it does not prevent one.

1. **blocker — The check is not wired into the release path.**

   With the plan as written:

   1. `raw_source_sha256` reaches `main`.
   2. The current [Vercel build command](/Users/greg/Dropbox/dev/experim/spideryarn2/vercel.json:4) does not check the database, so the build succeeds.
   3. Vercel promotes it.
   4. Only the next `/api/health` poll reports 503 and pages someone. A reader can lose the race.

   In fact, the existing health store query already selects nearly every revision column, including the new raw-source columns, so it would probably fail after promotion even without this new check; the proposed block mainly improves diagnosis.

   **Suggested change:** make `db:check` a Vercel build gate before either build command. A failed build leaves the previous deployment serving. Also add it to the parallel, currently uncommitted [deploy pipeline](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/deploy.ts:785), after migrations and before `git push`, using the app-role URL rather than the migrator role. Make the Vercel deployment status the named listener; do not rely on an uptime page as the first listener.

2. **should-fix — Columns and the ledger answer different questions; keep both.**

   The permission reasoning is sound, not rationalisation. Do not grant the runtime role access to the migration ledger merely for health reporting. The ledger is deliberately isolated from `schemaFilter` and runtime access ([configuration rationale](/Users/greg/Dropbox/dev/experim/spideryarn2/drizzle.config.ts:7)).

   But lines 41–45 overclaim what column comparison proves:

   - The ledger catches pending migrations containing only constraints, indexes, defaults, grants, triggers, backfills, functions or type changes.
   - It catches a database whose history is ahead of the checked-out commit.
   - Columns catch a manually dropped column, a damaged restore, or a ledger that says “applied” while the relation is wrong.
   - If somebody manually adds the columns without updating the ledger, the column check passes—but the next migration run may try to add them again and fail.

   **Suggested change:** define two complementary guards: ledger consistency under the migration credential during deployment, and runtime schema compatibility under `spideryarn_app`. The current deployment work already implements the former at [scripts/deploy.ts:370](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/deploy.ts:370).

3. **blocker — The identifier-extraction contract is underspecified and easy to implement incorrectly.**

   `getTableColumns()` returns an object keyed by TypeScript names such as `rawSourceSha256`; those keys are not database names such as `raw_source_sha256`—the repository already demonstrates that distinction at [src/store/pg.ts:189](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:189).

   **Suggested change:** specify:

   - Use `Object.values(getTableColumns(table)).map(column => column.name)`.
   - Use `getTableConfig(table).schema` and `.name`.
   - Compare exact identifiers; never lowercase or case-fold them.
   - Select only actual `PgTable` exports—the module also exports the `spideryarn` schema object.
   - Assert discovery is non-empty and currently finds all 16 tables.
   - Join `information_schema.tables` and require `BASE TABLE`. `information_schema.columns` includes view columns, so a same-shaped view could otherwise pass. [PostgreSQL confirms both tables and views appear there.](https://www.postgresql.org/docs/current/infoschema-columns.html)

   Generated columns and the current custom `bytea`/`tsvector` types are ordinary columns for this existence check. Include `revision_blocks.fts` as a green control.

4. **should-fix — Privilege filtering can produce both misleading alarms and false confidence.**

   PostgreSQL exposes only columns on which the current role has ownership or some privilege. Therefore, yes: a wholly inaccessible column can look missing. [That filtering is explicit in the PostgreSQL documentation.](https://www.postgresql.org/docs/current/infoschema-columns.html)

   Under today’s table-level `SELECT` grants, that is not a spurious production alarm: the grant applies to every column, and an invisible column is unusable by the application. But “some privilege” is weaker than “readable”: a column visible through `INSERT` alone could appear healthy while a select fails. Likewise, schema object names can remain visible without schema `USAGE`, even though the role cannot access them. [PostgreSQL describes that distinction here.](https://www.postgresql.org/docs/current/ddl-priv.html)

   **Suggested change:** in the same query, assert:

   - `has_schema_privilege(current_user, 'spideryarn', 'USAGE')`;
   - expected table privileges, at least `SELECT`, and preferably the documented DML grant;
   - column `SELECT` privilege where column-specific grants exist.

   Report `missing_or_inaccessible`, not simply `missing`. The deployment check must run once as `spideryarn_app`; an administrator seeing every column proves nothing about Vercel’s role.

5. **should-fix — “Extra columns cannot break old code” is false.**

   A database-only column that is `NOT NULL`, has no default, and is not generated or identity will break inserts from rolled-back code that omits it. That matters during the migration-first window because old Vercel functions continue serving until promotion.

   **Suggested change:** continue ignoring harmless extras, but fail on database-only required columns: `is_nullable = NO`, no default, not generated, not identity. Revise the rollback claim accordingly.

   For the first open question: compare existence and nullability now; defer general type comparison. Type comparison needs deliberate canonicalisation—`information_schema.data_type` treats arrays, domains and user-defined types specially. [PostgreSQL warns that its type representation is not straightforward.](https://www.postgresql.org/docs/current/infoschema-columns.html) Add types only after mutation tests prove the normaliser against this schema.

6. **should-fix — Keep the check in `/api/health`, and keep it hard-failing, but cache it.**

   `/api/health` is already a deep deployment-readiness check, not a shallow process-liveness endpoint: every warning deliberately produces 503 at [src/vercel-health.ts:548](/Users/greg/Dropbox/dev/experim/spideryarn2/src/vercel-health.ts:548). Schema incompatibility belongs there as the last backstop. Do not introduce an informational warning that leaves `ok:true`.

   However, the endpoint is public. The new query needs the same 30-second cache and concurrent-request coalescing as the store check at [src/vercel-health.ts:287](/Users/greg/Dropbox/dev/experim/spideryarn2/src/vercel-health.ts:287). A query error must become `schema.error` plus 503, not an empty result that masquerades as a successful comparison.

   Once the build gate exists, an uptime page should occur only for out-of-band production drift or privilege loss—both page-worthy.

7. **should-fix — The proposed destructive proof has no safe restoration path, and CI is required.**

   After `DROP COLUMN jobs.profile`, the Drizzle ledger still says migration `0014` ran. Rerunning `db:migrate` will not restore the column. “Restore” is therefore not an adequate procedure.

   **Suggested change:**

   - Test the core checker inside a transaction using the same database client: drop, compare, assert red, then roll back.
   - Mock that core result when testing CLI exit status and health warning plumbing.
   - Add cases for query failure, zero discovered tables, a view replacing a table, camelCase versus snake_case, generated columns, and privilege loss.
   - Add mandatory CI using a throwaway Supabase-compatible database: start empty, apply all migrations, run `db:check`, and fail—not skip—if the database was never reached.

   Recommendation for the third open question: **yes, CI is mandatory**, but it proves that committed migrations produce the declared schema. It does not prove production has applied them; the Vercel/deploy gate remains necessary.