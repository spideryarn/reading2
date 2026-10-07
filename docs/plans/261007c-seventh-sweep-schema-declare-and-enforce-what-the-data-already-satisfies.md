# Seventh sweep: the schema declares and enforces what the data already satisfies

Cluster **C7** of the [seventh sweep](261006m-seventh-codebase-sweep-depth-umbrella.md). Its
§ What the review changed is binding here (U3, U11, U13, U16, U22).

**Status, 2026-10-07:** being built, one stage per commit, in a worktree. Not pushed and **not
applied to production**: a GPT Sol review comes first, and production is the Overseer's.
[§ Waiting to be applied to production](#waiting-to-be-applied-to-production) is the list.

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

## Waiting to be applied to production

In order. None has been applied; `npm run deploy` (the Overseer's) applies them.

**They will run as one transaction**: drizzle's migrator wraps every pending file in one
(`scripts/deploy-checks.ts` says so, from the installed source), so either all of these land or
none does. The first holds a lock that blocks writes to `revision_blocks` until that transaction
commits; the others are metadata changes on tables of 4 to 200 rows.

1. `20261007005448_revision_blocks_article_block_index`
2. `20261007010230_referee_criteria_shape_all_or_none`
3. `20261007010954_referee_claims_empty_unless_done`
4. `20261007011627_upload_source_guesses_created_at`
5. `20261007012047_drop_duplicate_chat_messages_index`
6. `20261007012654_declare_migration_only_indexes_and_checks` (comment-only: it records a ledger
   row and runs nothing)
