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

## Waiting to be applied to production

In order. None has been applied; `npm run deploy` (the Overseer's) applies them.

1. `20261007005448_revision_blocks_article_block_index`
