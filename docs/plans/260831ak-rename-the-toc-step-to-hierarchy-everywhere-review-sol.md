## Verdict

The three-statement CHECK migration is correct for `revision_step_runs`, provided it runs in one transaction with all old workers stopped. The overall plan is not yet safe: as written, it would fail to migrate queued jobs, break in-flight work, ignore existing filesystem interruption markers, and incorrectly rewrite historical migration-repair logic.

### Critical

1. **The database/code rollout is not atomically compatible.**

   Migration runs before the new deployment at [scripts/deploy.ts:869](/home/greg/code/spideryarn2/scripts/deploy.ts:869) and [scripts/deploy.ts:898](/home/greg/code/spideryarn2/scripts/deploy.ts:898). Once rows and the CHECK change:

   - An old worker trying to start `"toc"` gets CHECK violation `23514`.
   - An old worker already running `"toc"` finishes with `WHERE step_name = 'toc'`; the migrated row is now `"hierarchy"`, so zero rows update and `StepRunNotHeld` is thrown at [src/store/pg-revisions.ts:1071](/home/greg/code/spideryarn2/src/store/pg-revisions.ts:1071).
   - New code deployed before the migration has the inverse failure.
   - Merely rewriting queued job JSON does not change a job already held in an old process.

   “Drain if anything is running” is insufficient. It must cover `queued`, `running`, claimed/in-memory jobs, enqueue endpoints and advancement endpoints, across both database and filesystem queues.

   The safe choices are either:

   - A real maintenance window: block new work, stop workers/old application instances, resolve every active job, assert zero queued/running jobs, migrate, deploy, then reopen.
   - An expand/migrate/contract rollout accepting both names temporarily. That necessarily takes more than one production commit/deployment.

2. **The proposed `jobs.steps` SQL updates nothing.**

   `jobs.steps` is `JobStep[]`, not `StepName[]`, at [src/db/schema.ts:1133](/home/greg/code/spideryarn2/src/db/schema.ts:1133). Elements look like `{"name":"toc", ...}`, not `"toc"`. Therefore the plan’s comparison `e = '"toc"'::jsonb` and containment test `steps @> '["toc"]'` match no real jobs.

   A correct rewrite must inspect `element->>'name'`, use `jsonb_set(element, '{name}', '"hierarchy"')`, preserve every other field and aggregate with ordinality to preserve order.

   There is a second coupled value: `jobs.work_key` hashes the ordered step names at [src/jobs.ts:1708](/home/greg/code/spideryarn2/src/jobs.ts:1708) and is compared for active-job deduplication at [src/store/pg-jobs.ts:161](/home/greg/code/spideryarn2/src/store/pg-jobs.ts:161). Rewriting an active job’s steps without recomputing its exact work key makes an identical request look like different work. This reinforces the need to drain active jobs rather than migrating them live.

   Filesystem jobs have the same persisted structure and optional work key at [src/store/jobs-fs.ts:92](/home/greg/code/spideryarn2/src/store/jobs-fs.ts:92). Locally, eight job files still contain `name: "toc"`; none contains the string-array shape assumed by the plan.

### High

3. **Do not rename the literals in `db-repair-migration-ledger.ts`.**

   Those lines describe migration `0036`’s historical postcondition, explicitly marked “Verbatim” at [scripts/db-repair-migration-ledger.ts:203](/home/greg/code/spideryarn2/scripts/db-repair-migration-ledger.ts:203). Changing [line 229](/home/greg/code/spideryarn2/scripts/db-repair-migration-ledger.ts:229) or [line 245](/home/greg/code/spideryarn2/scripts/db-repair-migration-ledger.ts:245) would cause repair of an old database to:

   - Reject ordinary `"toc"` rows as unexpected, or
   - Re-add a `"hierarchy"` CHECK while existing rows still contain `"toc"`.

   It would then stamp the hash and timestamp of `0036` at [scripts/db-repair-migration-ledger.ts:503](/home/greg/code/spideryarn2/scripts/db-repair-migration-ledger.ts:503), falsely claiming the database has `0036`’s postcondition. Historical SQL, snapshots and reconciliation entries must retain `"toc"`; only the new migration changes current state.

4. **Existing filesystem interruption markers become invisible.**

   Artefacts themselves are safe: the `toc` mapping points to stable `tree.json`, `labels.json` and `blocks.json` paths at [src/store/artifacts-fs.ts:137](/home/greg/code/spideryarn2/src/store/artifacts-fs.ts:137). Renaming the map key does not orphan them.

   Markers are different: their path includes the step name, `steps/<step>.running`, at [src/store/artifacts-fs.ts:431](/home/greg/code/spideryarn2/src/store/artifacts-fs.ts:431). After the rename, `interrupted("hierarchy")` will not see `toc.running` at [src/store/artifacts-fs.ts:637](/home/greg/code/spideryarn2/src/store/artifacts-fs.ts:637).

   There are currently two `toc.running` markers locally, and both articles have all three output files. Consequently [stepIsDone](/home/greg/code/spideryarn2/src/pipeline.ts:835) would see no new marker, see all outputs, and return true because this step deliberately has no freshness stamp. That is a silent skip of output explicitly marked interrupted. Rename those marker files or support both names temporarily.

5. **`ai_calls.purpose` and the filesystem spend ledger are missed.**

   The plan updates `ai_calls.step_name`, but the same call also persists `"toc"` as `purpose` at [src/db/schema.ts:1560](/home/greg/code/spideryarn2/src/db/schema.ts:1560). The values originate at [src/hierarchy.ts:1461](/home/greg/code/spideryarn2/src/hierarchy.ts:1461), are copied into the ledger row at [src/ai-spend.ts:750](/home/greg/code/spideryarn2/src/ai-spend.ts:750), and become `ai_calls.purpose` at [src/store/ai-calls-pg.ts:131](/home/greg/code/spideryarn2/src/store/ai-calls-pg.ts:131).

   Updating only `step_name` leaves one row saying `step_name='hierarchy', purpose='toc'` and splits purpose-based cost history.

   The filesystem ledger at `data/_ai-calls.jsonl` also persists both fields; its location is defined at [src/store/ai-calls-fs.ts:70](/home/greg/code/spideryarn2/src/store/ai-calls-fs.ts:70). The plan needs either a filesystem migration or an explicit read-time alias.

6. **Several exact comparisons are not guaranteed to be found by changing `StepName`.**

   In particular:

   - The publication guard queries exactly `"toc"` at [src/store/pg-revisions.ts:1171](/home/greg/code/spideryarn2/src/store/pg-revisions.ts:1171). If missed, every migrated revision appears to lack its hierarchy run and cannot publish.
   - Database freshness uses both `case "toc"` and `byStep.get("toc")` at [src/store/pg.ts:1978](/home/greg/code/spideryarn2/src/store/pg.ts:1978).
   - Import records a `"toc"` run at [src/store/import.ts:1453](/home/greg/code/spideryarn2/src/store/import.ts:1453); against the narrowed CHECK that becomes a `23514`.

   Some are compiler-checked, but the Drizzle text-column comparison is simply `string`, so `typecheck` alone is not sufficient.

7. **Drizzle bookkeeping must be part of the migration artefact.**

   `db:migrate` reads only entries named by `_journal.json` at [node_modules/drizzle-orm/migrator.js:12](/home/greg/code/spideryarn2/node_modules/drizzle-orm/migrator.js:12). A standalone SQL file is invisible and produces the exact “nothing applied” failure under review.

   After `0038` lands, the migration should be the next free index—currently `0039`—and include:

   - `drizzle/0039_<name>.sql`
   - A matching journal entry with the next `idx`, exact filename tag, `version: "7"`, breakpoints, and a `when` greater than every existing watermark.
   - `drizzle/meta/0039_snapshot.json` representing the final schema and linking to the `0038` snapshot.

   The snapshot is not used by `db:migrate`, but omitting or leaving `"toc"` in it makes the next `db:generate` diff against the wrong schema.

   The best route is normal `npm run db:generate -- --name=...` after changing `schema.ts`, then edit that newly generated SQL before it is applied to insert the data updates between generated `DROP CONSTRAINT` and `ADD CONSTRAINT` statements. The migrator wraps all pending statements in one transaction at [node_modules/drizzle-orm/pg-core/dialect.js:60](/home/greg/code/spideryarn2/node_modules/drizzle-orm/pg-core/dialect.js:60).

   At review time `_journal.json`, `0038`, its snapshot, and `schema.ts` are already shared-tree changes. `0038` must be committed by its owner before generating or numbering this migration. Do not include or overwrite those hunks in the rename commit.

### Medium

8. **Two more persisted vocabularies need explicit treatment.**

   - `toc-labels` is correctly identified, but the current label pipeline does not use the checkpoint store; it still writes `labels-progress.json`. The checkpoint seam says it is not a `StepName` at [src/store/checkpoints.ts:130](/home/greg/code/spideryarn2/src/store/checkpoints.ts:130), and filesystem directories include the namespace at [src/store/checkpoints-fs.ts:76](/home/greg/code/spideryarn2/src/store/checkpoints-fs.ts:76). Rename the database rows and CHECK, and rename/alias any filesystem namespace directories. Locally there are currently no such directories, so the plan’s claimed immediate model-call rebuy does not apply to the current implementation.
   - `"toc/2"` is persisted as the tree prompt version at [src/hierarchy.ts:57](/home/greg/code/spideryarn2/src/hierarchy.ts:57), in database `tree` JSON at [src/db/schema.ts:535](/home/greg/code/spideryarn2/src/db/schema.ts:535), filesystem `tree.json`, and `labels.structureVersion` at [src/labels.ts:2414](/home/greg/code/spideryarn2/src/labels.ts:2414). Nothing currently reads `structureVersion`, so this does not trigger a paid rerun today. The plan should deliberately preserve it as a historical protocol identifier or migrate it; otherwise old and new artefacts retain different vocabularies unnoticed.

## Migration-order conclusion

For `revision_step_runs` itself, this is the right order:

1. Drop the CHECK.
2. Update `"toc"` rows.
3. Re-add the narrowed CHECK.

Use schema-qualified names such as `"spideryarn"."revision_step_runs"`; the unqualified SQL shown in the plan depends on a search path the migrator does not establish.

No source migration or current schema contains another `toc` enum, generated column, trigger, view, partial index or seeded row. The primary key containing `step_name` updates automatically. The other persisted homes are `jobs.steps`, `jobs.work_key`, both `ai_calls` classifications, checkpoint namespaces, filesystem jobs/markers/ledgers, and artefact version metadata.

So, plainly: **the plan would currently break queued or running jobs, silently fail to migrate their JSON, and silently skip two locally interrupted filesystem hierarchy runs.**