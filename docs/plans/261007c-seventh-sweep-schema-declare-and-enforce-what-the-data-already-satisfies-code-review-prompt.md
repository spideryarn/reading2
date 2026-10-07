# Code review (write-capable): the schema cluster's seven migrations

You are reviewing, and may fix, one committed stage in this worktree. **These migrations will be
applied to the one production database, which holds real readers' data. Review them at that
standard.**

**The stage:** on branch `worktree-sweep7-schema`: `54b5975be` (1, an index), `a81f6d8c1` (2, a
CHECK tightened), `dc19c772e` (3, a CHECK added), `5af6e1f70` (4, a `created_at` column),
`f66e23f97` (5, a duplicate index dropped), `29f791e02` (6, ten migration-only objects declared in
`schema.ts`; a comment-only migration), `a5ffce600` (6b, two index declarations corrected; a
comment-only migration; **outside the original plan, added by the builder**), `6fcca3839` and
`d4bbcd76e` (8, comments). `f60720bdc` is a merge of `origin/dev`. Read each with `git show`, and
read every new file under `drizzle/` in full, with its snapshot and the journal entry.

The plan: `docs/plans/261007c-seventh-sweep-schema-declare-and-enforce-what-the-data-already-satisfies.md`
(it has the production counts, the timings, and stage 7's reason for stopping). The umbrella:
`docs/plans/261006m-seventh-codebase-sweep-depth-umbrella.md`, cluster C7 and § What the review
changed (U3, U11, U13, U16, U22 are binding). The findings:
`docs/investigations/261006d-seventh-sweep-depth-database-schema-*` (your family's read, Opus's,
and both cross-reviews). How migrations work here: `docs/project/database.md`.

You have **no database and no network**. So this review is of the SQL, the snapshots, the journal,
`src/db/schema.ts`, the writers, and the tests as text. Do not report database tests as failing.

**Try to break each of these.**

1. **Applying the chain to production.** The builder says the production ledger was at 153 rows,
   matching `dev` before these, and that Drizzle wraps all pending files in one transaction. For
   each `.sql`: can it fail on production's catalog as the investigation recorded it (object
   already exists / does not exist; a name that differs between local and production; migration 5
   has no `IF EXISTS` on purpose — is that right if production lacks or has renamed the index)?
   If one statement fails, do all seven roll back cleanly? What locks does each take and for how
   long (the index build on `revision_blocks`, 105,774 rows, is not `CONCURRENTLY` because it is
   inside a transaction: is a write block of that length acceptable, and is it stated)? Does
   tightening a CHECK via DROP then ADD leave a window, or scan under an `ACCESS EXCLUSIVE` lock?
2. **Order and timestamps.** Do the seven sort after every migration on `origin/dev`, and will a
   migration another branch lands later with an earlier timestamp be skipped or refused? (Read
   database.md for how the journal and `db:chain` treat that.)
3. **Stage 4.** `created_at` must be added nullable with NO default and the default set in a second
   statement, so the five existing rows are not given an invented date (U11). Confirm from the SQL
   and from the snapshot that a later `db:generate` will not "fix" it back into one statement or
   emit a diff.
4. **Stages 6 and 6b: the comment-only migrations.** The claim is that `schema.ts` now declares ten
   objects that already existed and that no DDL runs, with the snapshot kept as generated. Check
   that the snapshot really matches what the earlier migrations created (definition, column order,
   `DESC NULLS FIRST` versus `NULLS LAST`, partial-index predicates, CHECK expression text) and
   that `db:generate` on this tree reports no diff. The builder found two index declarations that
   had been wrong all along (`ai_calls_owner_started`, `ai_calls_scope_started`): is the corrected
   declaration what the original migration created? Is 6b sound as its own comment-only migration,
   or should it be folded/dropped? An empty database built from the whole chain must end up with
   exactly the objects `schema.ts` declares: find a counter-example.
5. **The CHECKs as refusals (stages 2 and 3).** For each, find a writer that can violate it: every
   store function, the orphan sweep, scripts under `scripts/` (backfills, repairs, re-own,
   export/import bundles in `src/store/export*.ts` — can an EXPORTED article with a row that
   predates the constraint fail to import?), and test helpers that stand in for writers. Stage 3
   narrowed `ClaimsFinish` to a union whose error arm types `claims` as the empty tuple: is the
   type sound, and does any caller cast past it?
6. **The new tests** (`tests/db-schema.test.ts` and others): could each pass against a wrong
   migration (a name-only check; an index with the right name and wrong columns or order)?
7. **Stage 7 was stopped** (the published-scalars CHECK: 35 of 124 test files insert published
   revisions without the four numbers, and two tests exist to cover exactly the rows it forbids).
   Is stopping right? Is there a smaller correct version, or should the CHECK be dropped from the
   plan because the read-side fallback it would make redundant is deliberately kept?
8. **Comments (stage 8) and the edits to `database.md` and `sql.md`:** every rewritten sentence is
   a claim; check each against the code and the migrations.

**Fix what is inside this stage**, narrowly. A migration file that is wrong is fixed IN PLACE only
if you say so loudly: the builder has already applied all seven to the shared local database, so a
changed `.sql` there will not re-run; say exactly what the orchestrator must do locally if you
change one. **Report, do not fix, anything wider.** Do not touch `scripts/db-reown.ts`,
`queue_state`, the `citation-find` bucket, any retention or deletion, `src/routes.ts`,
`src/jobs.ts`, `src/store/pg-jobs.ts`, `src/store/pg-session.ts`. Do not commit. Do not attribute
any decision to the product owner in docs: these choices were the orchestrator's (Claude's) and the
builder's.

**Reply format.** Findings C1, C2, …; P0 (production data lost or the production migration fails
half-applied) / P1 (a write a reader makes is refused, or production is blocked for a noticeable
time, or schema and database disagree afterwards) / P2 / P3. For each: the input or statement;
reasoned or reproduced; fixed or not. Then files changed, what you ran, and a verdict: ship /
ship with these fixes applied / do not ship. Then, separately and plainly: **the exact pre-flight
checks someone should run read-only against production immediately before applying these**, as SQL.
