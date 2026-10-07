# Seventh sweep: the schema declares and enforces what the data already satisfies

Cluster **C7** of the [seventh sweep](261006m-seventh-codebase-sweep-depth-umbrella.md). Its
§ What the review changed is binding here (U3, U11, U13, U16, U22).

**Status, 2026-10-07:** stages 1 to 6, an unplanned 6b, and 8 are built, one commit each, reviewed
by GPT Sol ([§ Review status](#review-status)) and on `dev`. **Stage 7 is not built**: its
constraint breaks 35 test files, two of which exist to test the very rows it forbids
([§ Stage 7](#stage-7-not-built-and-why)). **Not applied to production**, which is the Overseer's:
[§ Waiting to be applied to production](#waiting-to-be-applied-to-production) is the list, and
[§ Before applying to production](#before-applying-to-production) is what to do first.

## Goal

Two models read the schema and both live catalogs and found a handful of rules that every stored
row already obeys and nothing enforces, one missing index, one duplicate index, and eleven objects
that exist in the database and not in [`src/db/schema.ts`](../../src/db/schema.ts). This plan makes
the database hold each of those rules, and makes the file called the source of truth name what is
there. The evidence is in the four `261006d-seventh-sweep-depth-database-schema-*` documents under
[`docs/investigations/`](../investigations/); where a cross-review corrects a finding, the review
wins.

## The simpler option passed over

**One migration with all of it**, which is what the Opus cross-review drew up. Passed over because
each CHECK is a hard refusal on a write path, and a refusal that turns out to be reachable has to
be removable without taking an index and a column with it. One stage, one commit, at most one
migration.

## Stages

1. Index `revision_blocks (article_id, block_id)`.
2. Tighten `referee_criteria_diverging_shape` to all-or-none.
3. Add `referee_claims_empty_unless_done`.
4. `upload_source_guesses.created_at`.
5. Drop `chat_messages_thread_ordinal_idx`.
6. Declare the migration-only indexes and CHECKs in `schema.ts`, with no DDL.
7. `article_revisions_published_has_scalars`, after a sweep of the fixtures that break it.
8. The false schema comments.

## Done when

Every stage's migration applies to the shared local database (which has every earlier one) **and**
the whole chain applies to an empty database; `npm run db:check` is clean; each constraint has a
test in which a violating write is refused and an ordinary write passes; and for each CHECK the
mechanism behind "no ordinary write violates this" is named and tested.

## How the two directions are proved

- **A database with everything earlier**: `npm run db:migrate` against the shared local Supabase,
  reading its `Target:` line.
- **An empty database**: the `private-postgres` test lane. Its global setup
  ([`tests/setup/private-db-global.ts`](../../tests/setup/private-db-global.ts)) mints
  `spideryarn_test_<stamp>_<uuid>` with `CREATE DATABASE … TEMPLATE template0` and runs the real
  migrator over the whole of `drizzle/` ([`scripts/db-test-create.ts`](../../scripts/db-test-create.ts)),
  so any private-lane test that asserts on the new object has seen the chain apply from nothing.
  Watched failing for stage 1: with the new `.sql` edited to `("block_id","article_id")` the index
  test went red on the definition, and green with the edit undone.

## How production was read

Counts and catalog rows only, as `spideryarn_app`, in one message: `BEGIN READ ONLY; SET LOCAL
search_path …; SET LOCAL statement_timeout = '30s'; …; ROLLBACK;`. A scratch node script with `pg`
and the committed CA, the method of [database.md § Connecting to the remote](../project/database.md#connecting-to-the-remote)
("There is no `psql` on the box"). No prose column was selected and nothing was written.

## Stage 1: the index behind the block-identity foreign key

**Production, read 2026-10-07 00:56 UTC:** `revision_blocks` has 105,774 rows and three indexes,
none leading on `article_id` or `block_id`. An index cannot be violated.

**The claim was a hypothesis, so a cascade was timed** (GPT Sol's caution on DBO1: one lookup
multiplied is not a delete). Three throwaway articles were seeded into the shared local database
through the store's own write path (`scratchArticleInPg`: `pgArtifactsIn`, then `publishRevision`),
each from the 141-block corpus article, into a `revision_blocks` of 233,000 rows.
`EXPLAIN (ANALYZE, BUFFERS) DELETE FROM articles WHERE id = …` inside `BEGIN … ROLLBACK`, then real
deletes:

| | whole delete | of which `revision_blocks_identity_fk` (141 calls) | the lookup it runs |
|---|---|---|---|
| before | 3,229 / 3,368 / 3,870 ms | 3,174 / 3,311 / 3,758 ms | Index Scan on the primary key, 2,163 buffers, 27 ms |
| after | 45 / 57 ms | 6.0 / 6.1 ms | Index Only Scan on `revision_blocks_article_block`, 5 buffers, 0.08 ms |

Real deletes, not rolled back: 3,460 ms before (one article), 65 and 52 ms after (the other two).
So the trigger was 97% of the delete, about 23 ms per block id, and the claim holds. The four
sibling keys onto `block_identities` cost 5 to 24 ms for all 141 calls either way.

**The SQL** (`drizzle/20261007005448_revision_blocks_article_block_index.sql`, generated, unedited):

```sql
CREATE INDEX "revision_blocks_article_block" ON "spideryarn"."revision_blocks" USING btree ("article_id","block_id");
```

A plain `CREATE INDEX` in the migration's transaction, which blocks writes to the table while it
builds. Locally, on 233,000 rows, the whole `db:migrate` run was a few seconds; production has
105,774.

**The test** (`tests/db-schema.test.ts`): the index exists with exactly that definition. No plan is
asserted, because a minted test database is too small for the planner to prefer any index.

**What the docs got wrong:** the schema comment on `revision_blocks_identity_fk` said *"identities
are never deleted, so this FK only ever fires on an id that was never minted"*. They are deleted
with their article, which is the only time this key is expensive. Corrected in place.

## Stage 2: the criterion shape is all three or none

**Production, read 2026-10-07 01:02 UTC:** 10 rows (6 `diverging`, 4 `single`), **0** violating the
stronger rule. Local: 0 of 11. The catalog expression was the weak one, as GPT Sol quoted it.

**The SQL** (`drizzle/20261007010230_referee_criteria_shape_all_or_none.sql`, generated, unedited):

```sql
ALTER TABLE "spideryarn"."referee_criteria" DROP CONSTRAINT "referee_criteria_diverging_shape";
ALTER TABLE "spideryarn"."referee_criteria" ADD CONSTRAINT "referee_criteria_diverging_shape"
  CHECK (num_nonnulls("pole_against", "pole_favour", "scale") = case when "kind" = 'diverging' then 3 else 0 end);
```

Same name, stronger rule. Postgres validates the re-added CHECK against the stored rows, so a
violating row would fail the migration with 23514 and roll back the DROP with it. That is the
wanted outcome: rewriting a reader's criterion is not a migration's to do.

**The mechanism "no ordinary write violates this" rests on:** one function,
`configToRow` in `src/referee-criteria.ts`, produces the four columns, and it nulls all three for
any kind but `diverging`. Every writer, read:

| Writer | What it does to the four columns |
|---|---|
| `begin`, the insert (`pg-referee-criteria.ts`) | all four from `configToRow` |
| `begin`, the reset of a failed row | all four from `configToRow`, in one `SET` |
| `finish`, `recolour`, the orphan sweep | names none of them |
| `scripts/backfill-plain-titles.ts` | `results` only |
| `scripts/db-reown.ts` | `owner_id` only |
| test fixtures (six files insert directly) | `single` with no ends, or `diverging` with all three |

**Tested** in `tests/db-referee-criteria.test.ts`: *refuses a stray pole or scale on a kind that has
no ends* (four inserts with one or two stray fields, and the partial `UPDATE` that changes the kind
and leaves a pole behind), **red before the migration** (`promise resolved … instead of
rejecting`), green after; and *takes what configToRow writes, for every kind, on an insert and on a
reset*, which hands the database that function's output for all three kinds and every reset
between them.

## Stage 3: claims are empty unless the run is done

**Production, read 2026-10-07 01:07 UTC:** 4 rows (3 `done`, 1 `error`), **0** violating, 0 whose
`claims` is not an array. Local: 0 of 2.

**The SQL** (`drizzle/20261007010954_referee_claims_empty_unless_done.sql`, generated, unedited):

```sql
ALTER TABLE "spideryarn"."referee_claims" ADD CONSTRAINT "referee_claims_empty_unless_done"
  CHECK ("status" = 'done' or jsonb_array_length("claims") = 0);
```

**The mechanism "no ordinary write violates this" rests on**, three links, each a test case in
`tests/store-pg-referee-claims.test.ts`:

1. `begin` writes `claims: []` on the insert and in the `ON CONFLICT DO UPDATE`, in the same
   statement that sets `pending`. So `done` with claims becomes `pending` and empty at once, with
   no illegal instant between.
2. `finish` and the orphan sweep match only `status = 'pending'`, so the row they touch is already
   empty; the sweep names no `claims`.
3. **An `error` finish cannot carry claims.** GPT Sol's caution: `ClaimsFinish` was one
   `Partial<Pick<…>>`, so `{ status: "error", claims: [a claim] }` compiled. Every caller was read
   (`src/routes.ts` § `runRefereeClaims` is the only one in `src/`; it passes `claims: []` on the
   error path) and none did it. The type is now a two-armed union like `SearchFinish` and
   `CriterionFinish`, with the `error` arm's `claims` typed as the **empty tuple**: `claims: []`
   still compiles, so `routes.ts` is untouched, and anything with a claim in it does not. A
   `@ts-expect-error` in the test holds the compiler's half; the same case casts past the type and
   shows the database refusing the write whole, with the row still `pending` and the attempt still
   usable.

Other writers: `scripts/db-reown.ts` (`owner_id` only). One test helper stood in for a writer and
made a row no writer makes: `tests/referee-stream-lifetime.test.ts` put a finished run back to
`pending` without emptying it. It now sets `claims: []` as `begin` does.

**Tested:** *the database refuses claims on a pending run and on a failed one* (claims written under
a `pending` row; a `done` row with claims relabelled `error` or `pending` by a `status`-only
`UPDATE`) and the cast-past-the-type case were both **red before the migration**; *every ordinary
ending leaves a row the rule allows* walks begin, both error shapes, the sweep, and both `done`
shapes.

**What the docs got wrong:** the schema comment *"No `empty unless done` check, deliberately"* gave
the filesystem store as its reason. Rewritten. `ClaimsFinish`'s own comment said it was a `Pick`
*"rather than the two-armed union its siblings are"* because an error may carry `claims: []`; the
empty tuple says that without admitting the rest.

**One thing to know:** `jsonb_array_length` raises on a non-array, so a `claims` of `{}` is refused
with error 22023 rather than with the constraint's name. No writer can produce one.

## Stage 4: `upload_source_guesses.created_at`

**Production, read 2026-10-07 01:16 UTC:** 5 rows (1 `found`, 4 `none`), none with `claimed_at` at
the epoch or null, and no `created_at` column. Local: 25 rows.

**The SQL** (`drizzle/20261007011627_upload_source_guesses_created_at.sql`). Drizzle generated one
statement, `ADD COLUMN "created_at" timestamp with time zone DEFAULT now()`, which would have
stamped the migration's own time on the 5 existing rows (U11). **Hand-split**, the snapshot left
alone:

```sql
ALTER TABLE "spideryarn"."upload_source_guesses" ADD COLUMN "created_at" timestamp with time zone;
ALTER TABLE "spideryarn"."upload_source_guesses" ALTER COLUMN "created_at" SET DEFAULT now();
```

Checked after applying locally: 25 rows, **0** with a `created_at`; the column is nullable with
default `now()`. Not backfilled from `claimed_at`, which may be a later claim or the epoch.

**No store change.** `claim`'s insert does not name the column, so the default fills it, and its
`ON CONFLICT DO UPDATE` and `release` do not name it either, so neither can move it. `claimed_at`
means what it meant: the eligibility clock.

**Tested:** `tests/created-at-on-action-tables.test.ts` drives the real store: stamped on the first
claim, unchanged through a release (which sets `claimed_at` to the epoch) and a reclaim; and a row
with a null `created_at` stays null through a reclaim and a finish. **Red before the migration**
(`column "created_at" does not exist`). `tests/action-tables-have-created-at.test.ts` refused the
generated one-statement form before the split, by name.

**What the docs got wrong:** the Opus cross-review said to *"change
`tests/action-tables-have-created-at.test.ts:64` to `{ column: "created_at" }`"*. That test fails
on exactly that: *"upload_source_guesses has created_at now, so its entry in WITHOUT_CREATED_AT is
stale — delete the entry"*. The entry is deleted, as GPT Sol's document said. And the entry itself
was the finding: the test accepts any timestamp column as a stand-in and cannot see that one
moves. [sql.md § Store when it happened](../project/sql.md#store-when-it-happened) now says to read
the writers before listing one.

## Stage 5: the duplicate chat-message index goes

A build decision (U22): an index, not data, and re-creatable in one line.

**Both catalogs, read 2026-10-07 01:20 UTC**, from `pg_index` rather than from names:

| index on `chat_messages` | unique | valid | key columns | operator classes | ordering |
|---|---|---|---|---|---|
| `chat_messages_thread_ordinal` (the UNIQUE constraint's) | yes | yes | `1 2 4` | `10065 3126 1978` | `0 0 0` |
| `chat_messages_thread_ordinal_idx` | no | yes | `1 2 4` | `10065 3126 1978` | `0 0 0` |

Identical in production and locally, no predicate and no expression on either, and
`pg_constraint` has `UNIQUE (article_id, thread_id, ordinal)`, validated. A query grouping every
index in the schema by table, method, columns, classes, ordering, expressions and predicate found
this pair and **no other**, in both. Production has 200 chat messages.

**The SQL** (`drizzle/20261007012047_drop_duplicate_chat_messages_index.sql`, made with
`npm run db:generate -- --custom`, since the index was never in `schema.ts` and drizzle had
nothing to diff):

```sql
DROP INDEX "spideryarn"."chat_messages_thread_ordinal_idx";
```

No `IF EXISTS`, on purpose: a database without the index is not the one this was checked against,
and a drop that did nothing would print `✓ migrations applied` over that. `npm run db:generate --
--allow-empty` afterwards answered *no schema changes*, so the snapshot still equals `schema.ts`.

**Tested** (`tests/db-schema.test.ts`): *no table has two indexes on the same columns in the same
order*, the same grouping query, asked of the catalog so it holds for the next table too; and the
two indexes left on `chat_messages`, by definition. **Red before the drop**, naming exactly this
pair.

## Stage 6: the file declares what the database has

**Recounted, 2026-10-07**, by comparing the local catalog with `getTableConfig` over every table in
`schema.ts`: **five** indexes and **five** CHECKs undeclared, as U3 says (six indexes before stage
5). Nothing declared was missing from the catalog.

| Object | Made in |
|---|---|
| `jobs_queued_idx`, `jobs_lease_idx`, `jobs_owner_created_idx` | `0001` |
| `chat_threads_article_updated_idx`, `search_runs_article_created_idx` | `0003` |
| `ai_calls_provider_account_known` | `0023`, widened in `20260902150952` |
| `ai_calls_cost_source_known`, `ai_calls_one_cost_source` | `0023` |
| `ai_calls_price_version_iff_computed` | `0025` |
| `ai_calls_byok_upstream_only` | `20260902141103` |

**Production, read 2026-10-07 01:28 UTC:** all ten present, valid and validated, each with the same
`pg_get_indexdef` / `pg_get_constraintdef` text as locally. 104 indexes and 225 CHECKs in the
schema.

**No DDL runs, and the house process can say so.** `drizzle/20261007012654_declare_migration_only_indexes_and_checks.sql`
is a comment-only file. An ordinary `db:generate` wrote five `CREATE INDEX` and five `ADD
CONSTRAINT` for objects that exist (a database built from the chain refused the first with
`already exists`: tried). The statements were deleted and the snapshot kept as generated, which is
what `0030_drop_summary_steer.sql` did for the same reason. `--custom` would not have done:
it writes a copy of the *previous* snapshot (read in `drizzle-kit/bin.cjs`), so the ten would have
stayed undeclared as far as the next generate knew. Afterwards `db:generate -- --allow-empty`
answers *no schema changes*.

**That the declarations are the objects, and not ten near misses, was measured.** In a scratch
database minted from the chain (`scripts/db-test-create.ts`, dropped afterwards), inside one
rolled-back transaction: read each object's catalog text, drop all ten, run the ten generated
statements, read again. **10 of 10 identical**, including `indoption`.

It was 7 of 10 on the first try. Drizzle's `.desc()` generates `DESC NULLS LAST`; the hand-written
SQL said `DESC`, which Postgres takes as `NULLS FIRST`. The three DESC indexes are declared
`.desc().nullsFirst()`. A name check would have passed either way.

**Tested** (`tests/db-schema.test.ts`, the existing file, no second inventory): the five indexes by
their definition as Postgres prints it; **every** declared CHECK by name and table, validated, and
in the other direction every CHECK in the database is declared (derived from `schema.ts`, so 226
today and the next one free; watched red by renaming one declaration); and the ledger's five by
what they refuse, one forbidden row each after one row of every legal kind.

**What the docs got wrong:** `schema.ts` § `revision_step_runs_step` says `generate` *"knows
nothing about a CHECK expression"*; it generated all five here. That comment is stage 8's.
`database.md` said `--custom` *"writes the snapshot"* without saying whose contents; it now does.

## Stage 6b: two declared indexes that were not the ones in the database

**Not in the brief. Found by stage 6's own check, and built because it is the same defect and runs
no SQL.** With the three new DESC declarations corrected, the obvious question was whether any
index *already* declared had the same fault. A test comparing every declared index with the
catalog, direction and null placement included, went red on two and only two:

| Index | Made by hand as | Declared as | In both catalogs (01:39 UTC) |
|---|---|---|---|
| `ai_calls_owner_started` | `("owner_id", "started_at" DESC)`, `0021` | `.desc()`, i.e. `NULLS LAST` | `DESC`, `indoption 0 3` (`NULLS FIRST`) |
| `ai_calls_scope_started` | `("scope_kind", "started_at" DESC)`, `0023` | `.desc()`, i.e. `NULLS LAST` | `DESC`, `indoption 0 3` (`NULLS FIRST`) |

Nothing is wrong in any database: both have the index as it was made. What was wrong is the file,
and so any table regenerated from it. Declared `.desc().nullsFirst()`.

`drizzle/20261007013835_ledger_indexes_declared_as_made.sql` is comment-only, like stage 6's. The
generator wrote `DROP INDEX` and `CREATE INDEX` for each, which would rebuild two indexes into what
they already are (checked in a scratch database: `pg_get_indexdef` and `indoption` identical
before and after); deleted, snapshot kept as generated. It differs from stage 6's in two fields.

**Why its own migration, when it could have been folded into stage 6's snapshot:** stage 6's
`.sql` had already been applied to the shared local database, and its header says its snapshot is
exactly as generated. Folding would have made that sentence false, and correcting it would change
the file's hash, which means restamping a ledger row by hand in a database every tree shares. A
second empty migration costs a file.

**Tested:** *every declared index exists, on the declared columns in the declared order*, in
`tests/db-schema.test.ts`. Red on exactly these two before the fix.

**Noticed, not acted on (H, unmeasured):** the five indexes drizzle generated itself from a
`.desc()` (`uploads_owner_minted`, `realtime_sessions_owner_issued`, `ingest_events_owner_reserved`,
`quiz_attempts_latest`, `articles_public_listing`) really are `DESC NULLS LAST` in both databases,
and match their declarations. Whether each query that orders by such a column says `nulls last`
too, and so can walk the index rather than sort, was not looked at; every one of those tables is
small. GPT Sol's audit says `articles_public_listing`'s query does.

## Stage 7: not built, and why

`article_revisions_published_has_scalars`: `status <> 'published' or num_nonnulls(word_count,
block_count, part_count, section_count) = 4`. **Documented, not closed.**

**The data and the writer are ready.** Production, read 2026-10-07 00:56 UTC: 470 revisions, 460
published, **0** violating. One statement in `src/` sets `status = 'published'`
(`publishRevisionIn`, `src/store/pg-revisions.ts`), and it sets all four numbers from
`deriveLibraryScalars` in that same `SET`; nothing nulls them afterwards, and a draft does not copy
them (`REVISION_CARRY_POLICY` says `derive`).

**The tests are not.** The constraint was generated (not applied to the shared database) and every
test file that names the table was run against a database built with it: **35 of 124 fail**, where
the cross-review's upper bound was 29. They insert a published revision directly, without the four
numbers:

`article-delete-pg`, `article-rows-snapshot`, `asked-url-claim-session`, `asset-route`,
`backfill-registry-facts-pg`, `blocks-baseline`, `cited-in-spideryarn-pg`, `db-schema`,
`draft-sweep-on-step-start`, `event-times`, `export-route`, `find-article`,
`glossary-ideas-baseline`, `illustrated-route`, `library-log-volume`, `pipeline-slug-claim`,
`public-visibility-pg`, `publication-enqueues-the-labels-successor`, `referee-criteria-store`,
`shelf-terms-pg`, `shelf-topic-sets-pg`, `source-store`, `store-export-bundle`,
`store-export-covers-tables`, `store-export-isolation`, `store-export-referee`,
`store-export-search-kind`, `store-export-thread-kind`, `store-glossary-delete-pg`,
`store-parity-referee`, `store-parity`, `store-pg-referee-claims`, `store-shelf-pg`,
`store-shelf-reads`, `unknown-stored-thread-kind`.

Three reasons this is past a mechanical sweep, which is where the brief said to stop:

1. **Two of them test the rows the constraint forbids.** `tests/library-log-volume.test.ts` is
   about how much `scalarsForShelf` logs when published revisions have no scalars, and
   `tests/store-shelf-reads.test.ts` has *"recomputes the scalars, loudly, when a published
   revision has none"*. A validated CHECK would prevent those published fixtures in a database
   built from the current chain. Re-pointing them at a non-published status would lose what they
   test. The defensive fallback can stay alongside the CHECK, but testing it would then need
   controlled legacy-schema fixtures or another test boundary. Designing that is beyond this
   stage; removing the fallback is not a prerequisite for adding the CHECK.
2. **It collides.** U13 puts cluster C5 before this stage for `tests/store-parity-referee.test.ts`,
   and C5 had not landed on `dev` when this stage's fixture run was made.
3. **Thirty-five files, most of them other clusters' subjects**, each needing four numbers that are
   true of its fixture rather than four zeros.

**What it would take:** separate work on the fallback's test boundary (reason 1), a shared fixture
helper so a direct insert of a published revision cannot forget the numbers, then the migration,
which is one generated statement. The `pg.ts` comment that says this *"needs a migration"* is
left as it is, because it is still true.

## Stage 8: comments that had stopped being true

No migration. The union of GPT Sol's DB2 and the Opus document's DBO11, each checked against the
code before and after rewriting. `src/db/schema.ts` unless noted:

| Where | It said | What is true |
|---|---|---|
| `article_revisions.raw_source_sha256` | *"Nothing writes them yet"* | `artifacts-pg.ts` § `writeRaw` writes both and a draft carries them. The publish gate still does not check the implication, and the comment says so. |
| `article_revisions.labels` | `labels` is *"deliberately NOT a step name of its own"* | A step of its own since 2026-09-06; two steps write the column. |
| `article_revisions.quiz` | *"No attempts table beside it"* | `quiz_attempts`, since 2026-10-05. |
| `article_revisions_nav_label_status` and `revision_step_runs_step` | `generate` *"knows nothing about a CHECK expression"* | It diffs the expression and writes the DROP and ADD (stage 2's migration is one). What it cannot see is the TypeScript union, so the literal is still a second copy. |
| `queue_state` | *"The singleton row is the guarantee"* of concurrency one | A lock every claim takes; `claim` counts running jobs inside it against `maxRunning`. `running_job_id` and `updated_at` are written by nothing. |
| `revision_step_runs` header | `stepIsDone` *"is an `access()` existence check"* | Interruption, then presence, then the stamp. Each step fingerprints its own inputs; the block hash includes classification and frames ambiguous delimiters (`src/source-hash.ts`). |
| `ai_calls` header | *"No `attempt` column"* | There is one, since 2026-10-06. |
| `ai_calls.wire` | *"`messages`, `chat` or `embeddings`"* | Seven members; the comment points at `Wire` in `src/models.ts` and no longer lists them. |
| `referee_claims.claims_omitted` | the route *"writes `claims` and `model` and nothing else today"* | It writes `claimsOmitted` on every successful run. |
| `feedback.screenshot` | *"400,000"* | 2,000,000, in the constant and in `feedback_screenshot_size`. |
| `src/store/article-rows.ts` § `queue_state`, both entries | *"One row saying which job is running"* | A lock row that records nothing. |
| `referee_claims`, the withheld CHECK | the filesystem store could not refuse it | Rewritten in stage 3, with the CHECK. |

The `comments.thread_id` note is history that says it is history, and stays.

## Review status

**GPT Sol's verdict on the built code:** *"ship with these fixes applied, after production
preflight and with bounded migration lock waits. No P0 defect found."* Its
[answer](261007c-seventh-sweep-schema-declare-and-enforce-what-the-data-already-satisfies-code-review-sol.md)
and the [prompt](261007c-seventh-sweep-schema-declare-and-enforce-what-the-data-already-satisfies-code-review-prompt.md)
are beside this file. It changed no migration SQL, snapshot or journal.

| | Finding | What happened |
|---|---|---|
| C1 | P1, conditional. The index build takes `SHARE` on `revision_blocks` and holds it until all seven commit; a long transaction on a later table prolongs that; the runner sets no lock timeout. | **Not fixed in code.** Written into [§ Before applying to production](#before-applying-to-production) as a condition on whoever applies. Production duration is still unmeasured. |
| C2 | P2. The new index inventory in `tests/db-schema.test.ts` did not typecheck (three errors). | Fixed with a guard that throws on an index key with no column configuration. `npm run typecheck` is green. |
| C3 | P2. The money-CHECK tests admitted a wrong CHECK: `ai_calls_byok_upstream_only` without its `cost_source = 'provider'` predicate passed them. | Fixed: two more BYOK refusals and the whole source by money-presence matrix. **Reasoned, not watched failing**: the test writes rows against the real constraint, and the constraint was not altered to see it go red. The two added rows (`is_byok` with `cost_source` `none`, and with `computed`) are refused by that predicate and by no other; the two older ones are refused by `is_byok` and by `provider_account`. |
| C4 | P3. Four comments were inaccurate. | Fixed, each checked against the code: `hashBlocks` hashes role and treatment and frames ambiguous delimiters (`src/source-hash.ts`); `claimsOmitted` is written on the `done` patch only (`src/routes.ts` § `runRefereeClaims`). |
| C5 | P3. `database.md` said all three schema checks derive from the declarations. | Fixed: the money tests name their five rules. |
| C6 | P3. This plan implied stage 7 needs the defensive fallback removed. | Fixed in § Stage 7: both can coexist; what is missing is a test boundary for legacy rows. |

**Run against Postgres after the review, 2026-10-07** (Sol had no database, so its test changes
were unrun until then). Each test run mints a private database and applies the whole chain to it:

- `tests/db-schema.test.ts`, `migration-reconciliations`, `action-tables-have-created-at`,
  `created-at-on-action-tables`, `db-referee-criteria`: 5 files, 111 tests, all pass.
- The referee criteria and claims stores and routes, the chat store, the upload and source-guess
  suites, `store-migration-registry`: 15 files, 224 tests, all pass.
- `npm run db:check` against the shared local database: no drift (49 tables, 663 columns).
  `npm run db:chain`: fine. `npm run db:generate -- --allow-empty`: no schema changes.

**Left:**

- **Stage 7, the published-scalars CHECK, was stopped and stays stopped.** 35 of 124 test files
  insert published revisions without the four numbers, and two tests exist to cover exactly the
  rows it forbids ([§ Stage 7](#stage-7-not-built-and-why)). Sol: stopping is right, and a weaker
  CHECK would enforce a different invariant.
- **Stage 6b was outside the original plan and was kept.** Sol: sound as its own migration.
- **NEW1**, the ordering bug in `scripts/db-reown.ts`: held by the
  [umbrella](261006m-seventh-codebase-sweep-depth-umbrella.md) (U4), not touched here.
- **The questions for the owner**, in the umbrella's § For Greg and the investigations' § For the
  owner: not answered here.
- **Unmeasured:** five drizzle-generated indexes are `DESC NULLS LAST`
  ([§ Stage 6b](#stage-6b-two-declared-indexes-that-were-not-the-ones-in-the-database)). Whether
  the queries that order by those columns can walk them was not checked.

## Waiting to be applied to production

In order. None has been applied; `npm run deploy` (the Overseer's) applies them.

**They will run as one transaction**: drizzle's migrator wraps every pending file in one
(`scripts/deploy-checks.ts` says so, from the installed source), so either all of these land or
none does. The first holds a lock that blocks writes to `revision_blocks` until that transaction
commits. `CREATE INDEX` takes `SHARE` on `revision_blocks`; the CHECK changes take
`ACCESS EXCLUSIVE` and scan their small tables, and the column change takes `ACCESS EXCLUSIVE`
without rewriting old rows. The ordinary index drop also takes `ACCESS EXCLUSIVE` on
`chat_messages`. Those locks last until commit. The criterion's DROP then ADD has no visible
unenforced window: other sessions cannot access the table between them.

The few-second local run is not a production duration guarantee. A long transaction on any later
table can leave this run waiting while it already blocks block writes. The runner supplies no
lock timeout of its own; inspect production's active transactions and locks immediately before
applying, and bound lock waits on the migration connection. This review did not measure production
lock waits or index-build time.

1. `20261007005448_revision_blocks_article_block_index`
2. `20261007010230_referee_criteria_shape_all_or_none`
3. `20261007010954_referee_claims_empty_unless_done`
4. `20261007011627_upload_source_guesses_created_at`
5. `20261007012047_drop_duplicate_chat_messages_index`
6. `20261007012654_declare_migration_only_indexes_and_checks` (comment-only: it records a ledger
   row and runs nothing)
7. `20261007013835_ledger_indexes_declared_as_made` (comment-only, the same)

## Before applying to production

**What is waiting.** Eight migrations, in this order. The seven listed above: an index on
`revision_blocks (article_id, block_id)`; the criterion-shape CHECK dropped and re-added as
all-or-none; a new CHECK that a claims run holds no claims unless it is done; a nullable
`created_at` column on `upload_source_guesses`; the duplicate chat-message index dropped; and two
comment-only files that record a ledger row and run nothing. And an eighth, added on 2026-10-07
from another plan: `20261007065807_drop_queue_state_running_job_id`, **a column drop approved by
Greg on 2026-10-07** (*"yes"*, to the seventh sweep's question 6, relayed by the Overseer). It
drops the foreign key `queue_state_running_job_id_jobs_id_fk` and the column `running_job_id`,
nothing else; nothing ever read or wrote the column, and its one row holds null
([261007g](261007g-keep-the-generate-button-and-drop-the-unused-queue-column.md) § 2). It is the
one destructive statement in the set.

**They land together or not at all.** Drizzle applies every pending file in one transaction.

**The caution (review finding C1).** The index build takes a `SHARE` lock on `revision_blocks`
(105,774 rows, 144 MB) and blocks writes to it until the whole transaction commits. The later
statements need `ACCESS EXCLUSIVE` on four other tables, and the eighth on `queue_state` (with a
lock on `jobs` to drop the key), so a long-running transaction on any of those keeps the migration
waiting while it already blocks block writes. While it holds `queue_state`, every job claim
waits for its table lock until the migration commits or rolls back: `FOR UPDATE NOWAIT`
applies only to row locks. This can occupy the runtime connection pool. The drop is the last
pending file and needs no table rewrite, but its lock lasts to the transaction's end and its
duration has not been measured under production contention. So:

1. Set a finite `lock_timeout` and `statement_timeout` on the migration connection. The runner
   sets neither. At the 02:31 read the connection's own were `lock_timeout` 0 (wait for ever) and
   `statement_timeout` 2min.
2. Run the pre-flight's long-transaction check immediately before applying, as the migration role.
3. Every query labelled `VIOLATIONS` in the pre-flight must return zero rows.

**Applying is the Overseer's, with Greg's knowledge** (`npm run deploy`).

**The pre-flight:**
[261007c-seventh-sweep-schema-production-preflight.sql](261007c-seventh-sweep-schema-production-preflight.sql),
written by GPT Sol. It only reads: `SELECT`s over counts and the catalog inside
`BEGIN READ ONLY; … ROLLBACK;`, no prose column, no statement text from `pg_stat_activity`. Its
ledger literal expects exactly 153 applied rows followed by these eight; rebuild it if another
migration lands first. Run the whole file in one `psql` invocation so the transaction wraps it.

**After applying, the eighth's check inverts.** The pre-flight's `queue_state` VIOLATIONS block
must then return exactly its two "is missing" rows — the column and the key gone. Run its first two
arms alone, inside `BEGIN READ ONLY; … ROLLBACK;`: the third reads the dropped column and will
error. Those two arms were seen to return both rows against a database built from the whole chain
(`scripts/db-test-create.ts`), 2026-10-07.

### The pre-flight's result, 2026-10-07 02:31 UTC

Run once, as **`spideryarn_app`** (the read-only route the investigation used: `DATABASE_URL` from
`.env.prod`, `psql` inside the local Supabase container, `-v ON_ERROR_ROLLBACK=on`). Sol wrote it
for the migration credential, and two checks mean less as the application role; both are marked.

| Check | Result |
|---|---|
| Ledger | 153 rows, watermark `1791297828720`, as expected |
| VIOLATIONS: every earlier migration's stamp and hash, and no extra row | zero rows |
| The seven pending | all seven listed, each clears the watermark, none has a ledger row |
| VIOLATIONS: new objects already present | zero rows |
| `referee_criteria`: invalid shapes | **0** of 10 rows |
| `referee_claims`: claims not an array | 0 of 4 rows |
| `referee_claims`: claims on a run that is not done | **0** of 4 rows |
| `upload_source_guesses` rows that will keep a null `created_at` | 5 |
| `revision_blocks` | 105,774 rows, 144 MB heap |
| VIOLATIONS: the nine existing indexes, exact definition and valid | zero rows |
| VIOLATIONS: the six CHECKs and the UNIQUE constraint, exact text and validated | zero rows |
| The duplicate index is interchangeable with the unique one | true, and the constraint is validated |
| Ownership of the five tables | all owned by `postgres`. `can_act_as_owner` is false, **as it must be for the application role; it says nothing about the migration role** |
| Locks held by other sessions on the five tables | zero rows |
| Transactions older than five seconds | zero rows. **Weak as this role**: Postgres hides other roles' transaction start times from a role without `pg_read_all_stats`, and whether `spideryarn_app` has it was not checked, so this may have seen only the application's own |
| Prepared transactions | zero rows |

Nothing here stops the migrations. It is a reading from 02:31, not a guarantee for the moment of
applying: items 1 and 2 above still stand.

### Run again with the eighth, 2026-10-07 ~07:10 UTC

The updated file, the same way (as `spideryarn_app`, `psql` in the local Supabase container, the
whole file in one invocation, `-v ON_ERROR_ROLLBACK=on`). Every row of the table above read the same
— 153 rows at the same watermark, every VIOLATIONS query empty, the same counts — and the new or
widened checks read:

| Check | Result |
|---|---|
| The eight pending | all eight listed, each clears the watermark, none has a ledger row |
| VIOLATIONS: `running_job_id` and its key present as `0000` made them, and the column empty | zero rows |
| `queue_state` rows | 1 |
| Ownership, now seven tables with `queue_state` and `jobs` | all owned by `postgres`; `can_act_as_owner` false, as above |
| Locks held by other sessions, now including `queue_state` and `jobs` | zero rows |
| Transactions older than five seconds | zero rows (weak as this role, as above) |

A separate read-only count just before it: `queue_state` 1 row, 0 with a `running_job_id`; the key
present; the ledger at 153.
