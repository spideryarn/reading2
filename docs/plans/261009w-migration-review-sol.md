SAFE TO APPLY AFTER CHANGES

### M1 — P1 — Pre-rename code can reject valid concurrent publications

After the migration creates mirrored `bibliography` step-run rows, a still-running pre-rename instance can wrongly decide that an unrelated sharing job cannot be rebased.

Evidence:

- The required pre-rename version, `git show 68d9ed837^:src/store/pg-revisions.ts`, excludes only the old sharing-step names—including `citations`—when comparing `revision_step_runs`.
- The migration creates and thereafter maintains a `bibliography` twin for every `citations` row: [20261010030345_bibliography_expand.sql:102](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/drizzle/20261010030345_bibliography_expand.sql:102).
- If a Citations job publishes while an old-code Quotes or other sharing job is running, the latter ignores the changed `citations` row but sees the changed `bibliography` twin as an unrelated change. Its rebase fails with `step-runs-moved`, so completed work is rejected and the reader must retry.
- The new code handles the retired spelling in [pg-revisions.ts:2978](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/src/store/pg-revisions.ts:2978), but that cannot protect pre-rename processes during migration-first deployment.

Concrete change: first deploy a schema-neutral compatibility release based on the pre-rename code which also excludes `bibliography` whenever `citations` is an untouched sharing step. Wait for that release to replace all older instances and for already-running sharing jobs to drain; only then apply these migrations and deploy the rename. Alternatively, quiesce sharing jobs and drain them completely during deployment.

### M2 — P2 — The step-run backfill’s assurance is fail-open

The migration comment says an existing `bibliography` row would be unexpected, but the copy uses `ON CONFLICT DO NOTHING`. The postcondition then checks only that a twin exists, not that the twin contains the same job, status, timestamps, error, and other fields: [backfill](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/drizzle/20261010030345_bibliography_expand.sql:102), [postcondition](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/drizzle/20261010030345_bibliography_expand.sql:176).

This cannot mask bad data in the supplied production state: the previously enforced CHECK made a `bibliography` row impossible, and the migration holds locks against concurrent insertion. It is nevertheless weaker than its stated safety contract.

Concrete change: remove `ON CONFLICT DO NOTHING`, preferably, so an impossible conflict aborts the transaction. Alternatively, extend the postcondition to require bidirectional, field-for-field equality of every `citations`/`bibliography` pair.

## Evidence by question

1. **Every migration statement**

   - The three CHECK replacements on `chat_threads`, `revision_step_runs`, and `article_revisions` are strict expansions of their existing allowed values. Every row satisfying the old checks satisfies the new checks.
   - `ADD COLUMN bibliography jsonb` is nullable and has no default, so existing rows are valid and PostgreSQL need not rewrite the 100 MB table.
   - `UPDATE article_revisions SET bibliography = citations` copies the 91 non-null values exactly. The other rows remain null in both columns.
   - The step-run `INSERT … SELECT` changes only `step_name`; it copies all constrained fields and the existing valid `revision_id`. The old CHECK guarantees no pre-existing `bibliography` conflict on the stated production schema.
   - Both trigger functions use valid, schema-qualified references. Their invariant is established before the triggers are installed, and the final `DO` block sees the transaction’s own writes.
   - The final block correctly detects missing article equality or a missing `bibliography` twin, subject to M2’s field-equality gap.
   - The stale-notice migration only expands its CHECK with `bibliography`: [20261010044614_stale_notice_bibliography.sql:19](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/drizzle/20261010044614_stale_notice_bibliography.sql:19).

   No supplied production data should make these statements fail. Environmental failures remain possible: schema drift, a lock timeout, statement timeout, deadlock, disk error, or loss of connection.

   Drizzle wraps **all pending migrations and their journal inserts in one database transaction**: [dialect.cjs:62](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/node_modules/drizzle-orm/pg-core/dialect.cjs:62). Thus failure in 030345, 030425, or 044614 rolls all three back; none of their schema or data changes is left partially applied. The migration schema/table setup happens outside that transaction, but already exists in production and contains no application data.

2. **The `revision_step_runs` mirror**

   - There is no inbound FK to `revision_step_runs`; it only has an outbound FK to `article_revisions`: [schema.ts:3437](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/src/db/schema.ts:3437). Replacing a partner row cannot strand another table.
   - A normal insert/update/delete of either spelling produces the same operation on its partner. Every non-name field is copied, so the replacement satisfies the FK, CHECK, not-null constraints, and composite key.
   - `pg_trigger_depth() > 1` prevents recursive mirroring. Cascading deletion of an article is also safe: both rows are already cascade targets.
   - PostgreSQL queues row-level `AFTER` triggers until the statement has completed its underlying row changes. Consequently the draft’s multi-row `INSERT … SELECT` can copy both spellings before reconciliation occurs; the existing integration test exercises this case: [bibliography-expand-pg.test.ts:226](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/tests/bibliography-expand-pg.test.ts:226). [PostgreSQL trigger behavior](https://www.postgresql.org/docs/current/trigger-definition.html).
   - A raw concurrent transaction updating `citations` while another updates `bibliography` could acquire the two rows in opposite order and deadlock. PostgreSQL would abort one whole transaction. Ordinary application publication does not take that path: ownership/job locking serializes writes to the same draft.
   - A direct update changing a row’s identity from `citations` to `bibliography` is unsupported and would encounter the existing twin’s primary key before the `AFTER` trigger. Neither old nor new application code performs such a rename.
   - The exact pre-rename code writes `citations`; the trigger mirrors it to `bibliography`. New code writes `bibliography`; the same trigger mirrors it to `citations`. Trigger-side rows do not alter the outer statement’s reported row count.
   - The functions use PostgreSQL’s default `SECURITY INVOKER`, which is correct here. `search_path = ''` is safe because application objects are fully qualified and `pg_catalog` remains implicitly searchable. [CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html), [schema search path](https://www.postgresql.org/docs/current/ddl-schemas.html).
   - `spideryarn_app` has INSERT, UPDATE, and DELETE on application tables under the documented grants/default privileges: [database.md:1227](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/docs/project/database.md:1227). It can therefore fire the invoker-security trigger successfully.

3. **The `article_revisions` mirror**

   - INSERTs with only `citations`, including the old draft `INSERT … SELECT`, populate `bibliography`.
   - INSERTs with only `bibliography`, including the new draft copy, populate `citations`.
   - If both are supplied differently, `bibliography` is deliberately authoritative.
   - Updating either named column mirrors the changed value, including clearing it to null. Naming both columns makes `bibliography` authoritative.
   - An UPDATE of unrelated columns does not fire the trigger, but cannot disturb an already-established equality.
   - Ordinary `COPY FROM` invokes row triggers and CHECK constraints, so it is covered. [PostgreSQL COPY](https://www.postgresql.org/docs/current/sql-copy.html).
   - Only privileged operations that explicitly disable triggers or use replica trigger semantics bypass it; the application role cannot do those.

4. **Locks and duration**

   - Each `ALTER TABLE` takes an `ACCESS EXCLUSIVE` lock on its table. Those locks remain until the single migration transaction commits.
   - The backfill UPDATE and INSERT take row-exclusive/table and affected-row locks; the stronger migration locks already dominate where applicable.
   - `CREATE TRIGGER` ordinarily takes `SHARE ROW EXCLUSIVE`; on the two existing tables the transaction already holds stronger locks.
   - Function creation mainly changes catalogs. The postcondition’s reads take access-share locks, again under the existing stronger locks.
   - The final stale-notice CHECK locks only the newly created, empty table, which is not visible outside the transaction yet. [ALTER TABLE locking](https://www.postgresql.org/docs/current/sql-altertable.html), [PostgreSQL lock modes](https://www.postgresql.org/docs/current/explicit-locking.html).

   Existing readers holding compatible snapshots can finish. Once an exclusive lock is requested/acquired, new statements touching the affected tables can wait; no reader sees half-migrated data. The runner sets a 15-second lock timeout and 10-minute statement timeout: [db-migrate.ts:143](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/scripts/db-migrate.ts:143).

   At the supplied sizes—530 revisions, 91 JSON documents totalling 888 KB, 5,476 small step rows, and 64 chat threads—the actual scans and writes should normally take well under a second once locks are obtained. Lock waiting, not data volume, is the material duration risk. A timeout rolls the entire migration transaction back.

5. **Independence and ordering**

   `20261010044614_stale_notice_bibliography.sql` does not depend on the new article column, either trigger, or any other part of 030345. It does depend on 030425 having created `stale_notice_dismissals` and its named CHECK constraint; without that migration it fails immediately and atomically.

   The journal order 030345 → 030425 → 044614 is therefore valid. There is no dependency from 030345 to either stale-notice migration.

6. **Rollback and down migration**

   If rolled back before new code has stored any new identifiers, old code can generally continue because both database spellings are maintained, apart from M1’s concurrent-rebase defect.

   After new code has run, rollback is not clean:

   - Queued job `steps` or reset arrays may contain `bibliography`, which old workers do not understand.
   - `chat_threads.origin_mode = 'bibliography'` is allowed by the database but old code cannot reconstruct that origin correctly.
   - Bibliography stale-notice dismissals may be ignored by old code, making a dismissed notice reappear.
   - Revision JSON and step-run state remain readable through their mirrored `citations` copies.

   A true down migration must first stop and drain new-code writers, then transactionally:

   1. Rewrite job arrays, chat origins, and stale-dismissal keys from `bibliography` to `citations`, merging any collisions.
   2. Copy authoritative `bibliography` article data back to `citations` and verify every run pair.
   3. Drop the step-run mirror trigger **before** deleting `bibliography` rows; otherwise deleting them also deletes their `citations` partners.
   4. Delete the bibliography run rows and narrow the step CHECK.
   5. Drop the article trigger and functions, then drop the `bibliography` column.
   6. Narrow the chat and stale-notice CHECKs only after their data has been rewritten.

For Greg: these migrations add a second name for Bibliography data, copy roughly 1 MB of existing data, and keep the old and new names synchronized so old and new releases can overlap. The database work itself should take less than a second after it gets its locks, although requests may briefly wait. Any database failure rolls the whole set back. The change needed before production is a small compatibility release: without it, an old server can occasionally reject a completed mode-generation job when it overlaps with Citations/Bibliography work.