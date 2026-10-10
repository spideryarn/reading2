SAFE TO APPLY AFTER CHANGES

### Findings

**M1 — P1 — Pre-rename sharing jobs can reject valid concurrent publications**

The candidate extends the compatibility problem already found for Bibliography to `reception` and `sources-claims`.

Evidence:

- The migration creates and maintains new-name twins for `debate` and `debate-claims`: [migration:185](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/drizzle/20261010063350_reception_expand.sql:185).
- In `git show 9ac4332ae^:src/store/pg-revisions.ts`, lines 2978–2985, pre-rename rebasing excludes untouched sharing steps and their known retired spellings.
- At that commit, `RETIRED_STEPS` knows `citations → bibliography`, but not the two prospective Stage 3 names (`git show 9ac4332ae^:src/step-order.ts`, lines 213–217).
- Therefore, if an old Reception or Claims job publishes while another old sharing job is running, the latter ignores the changed old-name row but sees the changed `reception` or `sources-claims` twin as an unrelated step-run change. It declines with `step-runs-moved`, refusing completed work and making the reader retry.

Concrete change: before applying the migration, either:

- deploy a schema-neutral compatibility release that excludes these two prospective twin names during rebase comparison, then drain old sharing jobs; or
- quiesce and drain sharing jobs for the migration/deploy window.

Do not add the names globally to the old `RETIRED_STEPS`: the old pipeline cannot execute the renamed steps.

This is the same rare, recoverable failure class as M1 in the prior review, but the candidate introduces two additional spellings and needs the same explicit acceptance or mitigation.

**M2 — P2 — The new step-run backfills fail open on an “impossible” conflict**

Both copies use `ON CONFLICT DO NOTHING`, while the postcondition checks only that a twin exists—not that every non-name field is equal: [migration:182](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/drizzle/20261010063350_reception_expand.sql:182), [postcondition:232](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/drizzle/20261010063350_reception_expand.sql:232).

This cannot conceal bad data in the declared production state: the preceding CHECK prohibited both new names, and the migration holds an exclusive table lock before widening it. It is nevertheless weaker assurance than the comments claim.

Concrete change: remove both `ON CONFLICT DO NOTHING` clauses so unexpected state aborts the transaction, or make the postcondition bidirectional and compare every carried field. This is the candidate’s equivalent of the prior review’s M2, which was explicitly overruled.

**M3 — P3 — The grant-copy comment overstates what the block copies**

The comment says it copies “whatever is actually on the table,” but the query excludes `PUBLIC` and the owner and does not preserve grant-option status: [migration:101](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/drizzle/20261010063350_reception_expand.sql:101).

That does not affect production: the documented direct ACL is `spideryarn_app=arwd/postgres`, and those four DML grants are copied. The view also receives them independently through default privileges.

Concrete change: narrow the comment to “copies direct non-owner, non-PUBLIC privileges; production’s app-role DML grants are the intended case.”

### Evidence by question

1. **Statements and failure atomicity**

All existing production rows satisfy the new constraints:

- The origin-mode, rate-bucket, step-name, stale-mode and origin-lens replacements are strict widenings.
- The two new origin-shape constraints are vacuously true for existing rows because existing rows cannot yet contain `reception` or `sources-claims`.
- Both new JSONB columns are nullable with no default, so adding them does not rewrite the 530-row article table.
- The backfills copy 82 `debate` values and two `debate_claims` values without transformation.
- The step-run copies preserve every constrained field and valid revision FK.
- The empty claim-check table is renamed without changing rows or attached objects.
- The final block deliberately aborts if any old-name run lacks a twin, any article pair differs, or the view and table row counts differ.

Possible failures are schema drift, an unexpected relation/name collision, lock or statement timeout, deadlock, disk failure, or connection loss—not the supplied data.

Drizzle wraps all pending files and their journal inserts in one transaction: [dialect.cjs:62](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/node_modules/drizzle-orm/pg-core/dialect.cjs:62). Therefore failure in any of the four migrations leaves no application-schema change, data change, view, grant, function replacement, trigger replacement, or journal row from the batch. At most, the journal sequence can retain harmless gaps because PostgreSQL sequences are non-transactional. The migration schema/table bootstrap is outside that transaction, but both already exist in production.

2. **Compatibility view**

The old store works through the view:

- Its SELECT, INSERT … RETURNING, DELETE, UPDATE … RETURNING and sweep operations all target the old relation name.
- A simple one-table view with direct column references is automatically updatable; PostgreSQL rewrites its DML to the base table. [PostgreSQL `CREATE VIEW`](https://www.postgresql.org/docs/17/sql-createview.html)
- The partial unique index remains attached to the renamed table with the literal name `debate_claim_checks_one_pending`. A violation through the view therefore still exposes that name to `violatesConstraint`.
- The integration test exercises old-shape INSERT/RETURNING, exact `23505` constraint reporting, UPDATE/RETURNING and SELECT: [reception-expand-pg.test.ts:241](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/tests/reception-expand-pg.test.ts:241).

Defaults are also sound:

- `id` has no database default; the old store supplies `mintId()`.
- `dig_further`, `results`, and `created_at` retain their base-table defaults; nullable columns including `finished_at` become null when omitted.
- `RETURNING` returns the resulting base row, including defaulted values. [PostgreSQL `INSERT`](https://www.postgresql.org/docs/17/sql-insert.html)

For grants, production grants `spideryarn_app` SELECT/INSERT/UPDATE/DELETE and schema USAGE: [database.md:1227](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/docs/project/database.md:1227). PostgreSQL’s table default privileges include views, so the newly created view already receives those grants; the DO block copies the same direct ACL from the renamed table as a second route. [PostgreSQL default privileges](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html)

`SELECT *` does freeze the view’s current 16-column list; later base-table columns will not appear automatically. That is harmless and useful here: old code expects precisely this old contract, while base-table constraints and defaults still govern writes. The contract migration drops the view before destructive schema changes.

3. **Trigger functions**

The trigger definitions remain correct:

- The article function preserves Stage 2’s `citations ↔ bibliography` block verbatim and adds two equivalent pairs. INSERT fills the omitted spelling; UPDATE mirrors either changed spelling, including null; the new spelling wins when one statement changes both.
- The recreated trigger listens to all six columns: [migration:172](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/drizzle/20261010063350_reception_expand.sql:172). INSERT always fires; unrelated updates remain free of trigger work.
- The step-run backfills happen before `step_name_partner` learns the new pairs, avoiding redundant mirroring. The existing mirror trigger resolves the partner function on each invocation and therefore immediately gains all three symmetric pairs after replacement.
- `CREATE OR REPLACE FUNCTION` preserves function identity, ownership, privileges and dependencies. The migration restates the previous language, volatility, invoker security and empty search path, so no function property is accidentally lost. [PostgreSQL `CREATE FUNCTION`](https://www.postgresql.org/docs/17/sql-createfunction.html)
- Dropping and recreating the article trigger loses no meaningful state: Stage 2 created it earlier in this same uncommitted batch with the default enabled state, no comment, arguments, transition tables, condition, or special timing.

The prior limitations remain: directly changing a step’s name can collide with its twin, and raw concurrent writes through opposite spellings can deadlock; ordinary application code does neither.

4. **Snapshot and removed Drizzle statements**

The snapshot is consistent with the database produced by the edited SQL:

- Normalizing only the old relation name and qualified expressions makes the prior snapshot’s `debate_claim_checks` object equal to the new snapshot’s `sources_claim_checks` object.
- The new snapshot retains the legacy-named PK, four CHECKs, article FK and partial unique index under the renamed table: [snapshot:8190](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/drizzle/meta/20261010063350_snapshot.json:8190).
- `schema.ts` explicitly declares those legacy names: [schema.ts:2395](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/src/db/schema.ts:2395).
- PostgreSQL’s table rename preserves attached constraints and indexes and their names; their stored relation references follow the table rename. Rebuilding them would add work without changing state.
- The manually added owner FK and compatibility view remain intentionally outside Drizzle’s snapshot, as before. Generation compares `schema.ts` with the terminal snapshot rather than introspecting the live database, so it will neither re-emit nor drop them.

The four snapshots form a continuous chain in journal order. I independently ran the read-only `npm run db:chain`; it passed. I did not rerun `db:generate`, because it may write artifacts; the builder’s reported no-change result agrees with the snapshot comparison.

5. **Locks and duration**

The `ALTER TABLE` operations take `ACCESS EXCLUSIVE` locks on the claim-check, chat, rate-limit, step-run, stale-dismissal and article-revision tables. These block writes and ordinary SELECTs and remain held until the transaction commits. Earlier migrations already hold the article, chat and step-run locks, so this migration extends their duration rather than creating an externally visible Stage 2-only state. [PostgreSQL locking](https://www.postgresql.org/docs/17/explicit-locking.html)

At the supplied sizes:

- two article backfills copy about 246 KB across at most 84 rows;
- the step copies touch a subset of the 175 old-name rows;
- the step CHECK scans 5,476 rows;
- chat CHECKs scan 64 rows;
- the claim-check table and newly created stale-dismissal table are empty.

This should take well under a second once locks are acquired. The one unspecified scan is `rate_limit_events`; repository documentation expects only a few hundred bounded rows at this readership, but its production count was not supplied. Lock waiting, rather than row processing, is the practical duration risk. The runner’s 15-second lock timeout and ten-minute statement timeout abort the entire batch safely: [db-migrate.ts:143](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/scripts/db-migrate.ts:143).

6. **Rollback**

A transaction failure before commit is clean. Rolling application code back after the migration committed is not fully safe:

- article artefacts and step runs remain available under the old spellings;
- old claim-check operations continue through the view;
- but jobs queued with `reception` or `sources-claims` cannot be executed by old workers;
- chats stored with the new origins lose their way back in old code;
- new-name stale dismissals are ignored, so notices can reappear;
- `sources-claim-check` rate events are not counted by old code, temporarily resetting allowances and the global fuse.

A candidate-only down migration, retaining Stage 2’s Bibliography expand, should first stop and drain new-code writers, then transactionally:

1. Rewrite job arrays, chat origins, rate buckets and stale-dismissal modes to their old spellings, resolving stale-dismissal key collisions deterministically.
2. Drop the old-name view and rename `sources_claim_checks` back to `debate_claim_checks`; its old constraint/index names and table grants already survive.
3. Drop the step mirror trigger, copy authoritative new-name runs onto their old twins, delete the two new-name run sets, redefine `step_name_partner` to the Bibliography pair only, recreate the trigger, and restore the earlier CHECK.
4. Copy and verify `reception → debate` and `sources_claims → debate_claims`; drop/redefine the article trigger and function back to the Bibliography-only version; then drop the two new columns.
5. Restore the pre-candidate chat, rate-limit and stale-dismissal constraints.
6. Run postconditions before commit.

Do not simply drop the shared functions or triggers: the preceding Bibliography expand still needs them.

For Greg: this migration renames the empty claim-check table, leaves a writable old-name view over it, copies roughly 246 KB of article data plus at most 175 small step rows, widens several checks, and extends the existing old/new-name mirrors. Once its locks are available, the work should finish in under a second; any database failure rolls back all four pending migrations. The material risk is the same narrow overlap bug as the Bibliography migration: an old sharing job can reject completed work if Reception or Claims publishes beside it during the deployment window.