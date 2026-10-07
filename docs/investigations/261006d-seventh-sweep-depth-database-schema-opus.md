# Seventh sweep, depth: the database schema and database structures  (Opus, read-only, 2026-10-06)

Brief: [common](261006d-seventh-sweep-depth-prompt-common.md) +
[schema zone](261006d-seventh-sweep-depth-prompt-schema.md). Umbrella:
[261006m](../plans/261006m-seventh-codebase-sweep-depth-umbrella.md). Finding IDs are `DBO<n>`.
GPT Sol read the same zone separately; I did not read its document.

Two databases were asked, both read-only: the shared **local** Supabase Postgres (212 articles,
232,489 block rows) for `EXPLAIN (ANALYZE, BUFFERS)`, and **production** (62 articles, 105,774
block rows, statistics since 2026-08-20) for counts and catalog queries. Every production statement
ran inside `BEGIN READ ONLY; … ROLLBACK;` as `spideryarn_app`, and selected only counts, sizes,
catalog rows and code-valued columns (status, kind, bucket). Nothing was written anywhere; no
tracked file was changed. Every statement and its output is in the appendix.

**The short version.** The schema is carefully kept: 225 CHECK constraints in production, composite foreign keys, a reason written beside nearly every decision, and no
difference at all between the local and the production catalog. I found no live correctness defect.
What I found is one missing index that makes deleting an article cost a scan of the largest index
per block, three kinds of rows that only ever accumulate, eight columns that are written and never
read, and two constraints held back for a reason that stopped being true on 2026-09-05.

## What I read

**In full (code, comments stripped; comments read where a finding touched them):**
`src/db/schema.ts`, all 49 tables, 662 columns, every constraint and index.

**In full:** `docs/project/sql.md`; `docs/reusable/improve-the-codebase.md` § the schema;
`src/db/schema-drift.ts` (outline); `tests/action-tables-have-created-at.test.ts` (the exemption
list); `drizzle/20261006035355_rename_remember_thread_kind_to_learn.sql`; the header of
`drizzle/20261002140803_structure_step.sql`.

**In part:** `docs/project/database.md` (the operating manual, roles, connecting to the remote, the
`restrict` / `no action` section, tightening an invariant, what is not done); `src/store/pg.ts`
(the article, blocks and library query builders, `scalarsForShelf`); `src/store/pg-jobs.ts`,
`ai-calls-spend-pg.ts`, `pg-rate-limit.ts` (query shapes only, by grep); `pg-revisions.ts` §
`sweepAbandonedDrafts`; `pg-shelf.ts` § the delete; `pg-admin.ts`; `public-reader.ts`;
`src/owner.ts` (header); `src/upload-records.ts` § `asOf`; `scripts/db-reown.ts` (header).

**The last 40 migrations: statement kinds counted for all 40** (appendix), two read in full. That
is less than the brief asked ("all of the last 40"). I spent the time on the two live catalogs
instead, because they are what the migrations add up to and they can be compared exactly.

**Skipped:** the other 114 migrations; most of the 44,425 lines under `src/store/`. Chosen by what
the catalog and the counts pointed at, not by churn.

## What the method could not see

- **A column nothing *reads*.** I counted word-boundary mentions of each column's two spellings
  outside `schema.ts` (appendix § Column mentions). That finds a column nobody names (one:
  `queue_state.running_job_id`). It cannot tell a read from a write for a column named `status` or
  `title`. The eight `owner_id` columns in DBO5 were checked by hand, per store file.
- **Whether a delete is slow in production.** Production has never deleted an article
  (`n_tup_del = 0` on `articles`), and I could not run a delete anywhere. DBO1's timing is one
  lookup measured locally, multiplied.
- **Local index statistics** mostly reflect the test suite. I quote production `idx_scan` and treat
  local plans on small tables (jobs 90 rows, chat 194) as showing the query shape only.
- **Planner choices in production.** `EXPLAIN` there was outside what I was allowed to run.
- **Which rows are test rows.** Production `feedback` has 471 rows from one owner; I did not look
  at what they say.
- **Storage** (Supabase buckets) and `auth.*`: not looked at.

## Findings

Ranked by ease × value. There is no Tier 0.

| ID | Tier | Evidence | Ease | Value | Class | One line |
|---|---|---|---|---|---|---|
| DBO1 | 1 | C (plan measured locally) | 5 | 3 | additive-safe | `revision_blocks_identity_fk` has no index; deleting an article scans a whole index once per block id |
| DBO8 | 1 | R (0 of 460) | 5 | 2 | additive-safe | the CHECK `pg.ts` says "needs a migration" is satisfied by every production row |
| DBO3 | 1 | R (catalog) | 5 | 1 | safe drop | `chat_messages_thread_ordinal_idx` duplicates the UNIQUE index on the same three columns |
| DBO11 | 1 | C | 5 | 2 | no migration | four comments that are false today |
| DBO7 | 1 | R (1 row) | 4 | 1 | needs the owner | `citation-find`: one production row, so the CHECK cannot be narrowed until it is deleted |
| DBO10 | 1 | R (0 mentions, null in prod) | 4 | 1 | needs the owner | `queue_state.running_job_id` is read and written by nothing |
| DBO9 | 1 | R (0 of 4) | 4 | 1 | additive-safe | a `referee_claims` CHECK withheld for the filesystem store, which is gone |
| DBO2 | 2 | R (13 of 62) | 3 | 3 | needs the owner | article rows that never published are kept for ever, with 38% of all block ids |
| DBO5 | 2 | R (0 of 157 differ) / C | 3 | 3 | needs the owner, or additive-safe | eight `owner_id` columns written on insert and read by nothing |
| DBO4 | 2 | R (catalog diff) | 3 | 2 | no migration | 6 indexes and 5 CHECKs exist only in migrations; `db:check` compares columns only |
| DBO6 | 3 | R (counts) | 2 | 3 | needs the owner | 86% of block rows and ~90% of revision bytes belong to revisions nothing shows |
| DBO12 | 3 | R (2 dangling) / H (harm) | 2 | 2 | — | reader rows keyed on ids that live inside a JSON artefact |
| DBO13 | 2 | C | 3 | 1 | additive | a state flag read out of `tree` JSON with `->>`, beside a sibling that is a column |

### DBO1 — deleting an article does one whole-index scan per block id

`src/db/schema.ts` § `revision_blocks`, `foreignKey({ name: "revision_blocks_identity_fk", columns:
[t.articleId, t.blockId] … })`. The table's indexes are the primary key `(revision_id, block_id)`,
`UNIQUE (revision_id, ordinal)` and the GIN on `fts`. None leads on `article_id` or `block_id`.

When a `block_identities` row is deleted, Postgres checks the foreign key by looking in
`revision_blocks` for `article_id = $1 and block_id = $2`. Deleting an article cascades to every
one of its `block_identities` rows, so that lookup runs once per block id. With no usable index it
reads the whole primary-key index each time:

```
Index Scan using revision_blocks_revision_id_block_id_pk on revision_blocks x
  (actual time=2.631..23.768 rows=12 loops=1)
  Index Cond: (block_id = 'spya-zkzg0w'::text)      <- second column, so every leaf page is read
  Filter: (article_id = '…'::uuid)
  Buffers: shared hit=2147
Execution Time: 23.837 ms        (398 ms on a cold cache)
```

Local, 232,489 block rows. The sample article has 3,053 block ids, so its delete would be about
3,053 × 24 ms ≈ 73 s of lookups. Production has 105,774 block rows (a 10 MB index, about half the
local one), an average of 435 block ids per article and a largest of 6,089. So a typical delete is
seconds and the largest is on the order of a minute, inside the one transaction in
`src/store/pg-shelf.ts` § `tx.delete(articles)`, behind the billing-account lock that transaction
takes first.

**Not reproduced as a delete.** I may not write. The plan is measured; the multiplication is mine.
Production has never deleted an article since 2026-08-20, so nobody has met this yet. The sibling
foreign keys onto `block_identities` (`comments`, `chat_threads` ×2, `reading_time`) are fine: each
of those tables has a primary key that leads on `article_id`.

**The fix, as a separate claim:**

```sql
CREATE INDEX "revision_blocks_article_block" ON "spideryarn"."revision_blocks" ("article_id", "block_id");
```

Additive-safe: an index, 105,774 rows, about the size of the existing 10 MB primary key. A plain
`CREATE INDEX` inside the migration's transaction blocks writes to the table for well under a
second at this size. It duplicates nothing. Check afterwards with the appendix's Q17, which should
become an index scan on the new name touching a handful of buffers.

### DBO8 — "published implies the four numbers are non-null" is true of every row, and still a comment

`src/store/pg.ts` § `scalarsForShelf`, the doc comment: *"The right long-term answer is a check
constraint saying published implies the four numbers are non-null; that needs a migration."* The
function carries a fallback that re-reads an article's whole text when any of `word_count`,
`block_count`, `part_count`, `section_count` is null.

Production: 460 published revisions, **0** missing any of the four. Local: 930, 0. And
`block_count` equals the counted `revision_blocks` rows for all 460.

```sql
ALTER TABLE "spideryarn"."article_revisions" ADD CONSTRAINT "article_revisions_published_has_scalars"
  CHECK ("status" <> 'published' OR num_nonnulls("word_count","block_count","part_count","section_count") = 4);
```

Additive-safe (0 violating rows of 470). Removing the fallback branch afterwards is a second,
separate change, and it needs the importer's write path read first.

### DBO3 — an exact duplicate index

`drizzle/0002` made `chat_messages_thread_ordinal UNIQUE (article_id, thread_id, ordinal)`.
`drizzle/0003`, the next migration, made `chat_messages_thread_ordinal_idx` on the same three
columns, not unique. Both are in the production catalog; only the first is in `schema.ts`. The
planner uses the non-unique one (1,456 scans against 63), and would use the unique one identically
if it were alone.

```sql
DROP INDEX "spideryarn"."chat_messages_thread_ordinal_idx";
```

Not additive, and not destructive either: no data goes, and it is undone by re-creating it. 32 kB.
Value is small — one fewer index to maintain on every chat message, and one fewer catalog-only
object for DBO4.

### DBO11 — four comments that are false today

All proved from the code or the production counts beside them. Correcting a stale comment needs no
approval here; I list them because I may not edit.

1. `ai_calls.wire`: *"`messages`, `chat` or `embeddings`"*. Production holds **seven** values:
   `chat` 1100, `messages` 689, `transcription` 301, `embeddings` 155, `realtime` 59, `images` 45,
   `decisions` 16. Two CHECKs in the same table already name `'realtime'`.
2. `revision_step_runs_step`: *"`drizzle-kit generate` … knows nothing about a CHECK expression — so
   this one is hand-maintained"*. The `chat_threads.kind` comment in the same file says *"This note
   used to say `generate` cannot see a check expression. It does now."* One of the two is stale,
   and the migrations of 2026-10-05 show which.
3. `src/store/article-rows.ts` § `queue_state`: *"One row saying which job is running"*. It never
   says that (DBO10). `schema.ts`'s own comment is right: it is a lock row.
4. `referee_claims` and `comments.thread_id`: both justify a missing constraint by *"the
   filesystem store cannot refuse one"* (DBO9). True when written; the store went on 2026-09-05.

**One I withdrew.** I first read `uploads.status = 'expired'` as never stored, because
`src/upload-records.ts` § `asOf` derives it on read and a grep for the literal write found none.
The local database has 1 such row of 192, and `NEXT` in `src/source.ts` has edges into `expired`,
so a generic transition writes it. Production has 0. The comment stands.

### DBO7 — the `citation-find` bucket: one row in production

`src/db/schema.ts` § `rate_limit_events_bucket`; the comment says removing the value *"needs a
migration that first proves no such rows remain"*.

```
        bucket        | count |   first    |    last
 citation-find        |     1 | 2026-09-29 | 2026-09-29
```

**One row in production** (three locally). So a narrowed CHECK is **not** satisfiable by today's
data, in either database. The row will never leave by itself: `src/store/pg-rate-limit.ts` sweeps
old rows only for the `(owner, bucket)` being spent, and nothing spends this bucket any more. The
same is true of any bucket a reader stops using (three `link-summary-fill` rows from 2026-09-12 are
still there).

The migration is the house pattern from the `remember` → `learn` rename: `DROP CONSTRAINT`, then
`DELETE FROM rate_limit_events WHERE bucket = 'citation-find'`, then `ADD CONSTRAINT` with seven
values, so the re-added CHECK is the postcondition. **Needs the owner**, because it deletes a
production row — one rate-limit event a week old, with no reader content in it. What it removes:
one row and one CHECK value. What it costs: a migration, and editing the three places that list the
buckets.

For every other CHECK value I found with no production rows, see § Siblings compared; none of the
others is retired.

### DBO10 — `queue_state.running_job_id` is a dead column

`grep -rnE "running_job_id|runningJobId" src scripts tools evals tests` outside `schema.ts`: **0**.
The table is used only as a row to lock (`select 1 from queue_state where id = 1 for update
nowait`, `pg-jobs.ts`). Production: the column is null, and `updated_at` has not moved since the
row was made on 2026-08-26 — which is also the column
`tests/action-tables-have-created-at.test.ts` names as this table's "when".

Dropping the column and its foreign key to `jobs` **needs the owner** (a column drop). It removes
one nullable column and one FK; it costs a migration. No urgency.

### DBO9 — a constraint withheld for a store that no longer exists

`src/db/schema.ts` § `referee_claims`: *"**No `empty unless done` check, deliberately** … the
filesystem store cannot refuse one, and a constraint only one of the two stores keeps turns a shrug
on a laptop into a 500 on Vercel."* The filesystem store was deleted on 2026-09-05.

```sql
ALTER TABLE "spideryarn"."referee_claims" ADD CONSTRAINT "referee_claims_empty_unless_done"
  CHECK ("status" = 'done' OR jsonb_array_length("claims") = 0);
```

Production: 0 violating of 4 rows; local 0 of 2. Additive-safe. Check `begin` and the sweep in
`src/store/pg-referee-claims.ts` write `[]` on every path back to `pending` before adding it.

`comments.thread_id` has no foreign key for two reasons, one of them the same dead one. The other
is real (a deleted thread must not take the reader's mark with it). Postgres 17 can say that
directly — `ON DELETE SET NULL (thread_id)` on a composite key — which was not available to the
plan of 2026-08-28. Production has 0 comments with a `thread_id`. I am not proposing it: nothing
shows the dangling pointer hurts.

### DBO2 — article rows that never published

`src/store/pg-admin.ts` § `adminQueries` says it plainly: *"`beginRevision` writes the `articles`
row before there is anything in it, so a first ingest that fails leaves a row with no current
revision — one the shelf never shows."* Every read inner-joins the current revision, so these rows
are invisible. Nothing deletes them.

Production, 13 of 62 article rows (local: 77 of 212):

```
ghosts | identities | checkpoints | ai_calls | uploads_by_slug | purpose | title_override | comments | owners
    13 |       9303 |         196 |      332 |               6 |       0 |              0 |        0 |      1
```

They have no revision left (the abandoned-draft sweep took those) but keep **9,303 of 24,344
block ids (38%)** and 196 of 594 checkpoints, because `block_identities` is never deleted except by
its article. All 13 belong to one account. None carries anything a reader typed.

**Needs the owner**, twice over: removing the 13 is a delete in production, and stopping new ones
is a choice (delete the row when a first import ends in `error` or `cancelled`; or sweep rows with
no current revision and no active job after some days). The first is simpler but must not race a
retry of the same job. DBO1 makes each such delete slow today, so do DBO1 first.

### DBO5 — eight `owner_id` columns that are written and never read

`src/owner.ts`, header: tables such as `revision_blocks` and `chat_messages` carry no owner because
*"carrying the owner twice is a second copy to disagree with the first"*. Newer tables follow it
(`quiz_attempts`, `glossary_hidden_entries`, `article_tags`, `reading_time`: *"ownership is
inherited through the article"*). Eight older ones do not: `comments`, `chat_threads`,
`search_runs`, `glossary_lookups`, `citation_finds`, `citation_investigations`,
`referee_criteria`, `referee_claims`. Each has `article_id` **and** `owner_id`.

In each of their store files the column appears once, in the insert (`ownerId: currentOwnerId()`),
and in no `where`, join or select (grep in the appendix). Every read goes through `ownedSlug` on
`articles`. Outside `src/`, `scripts/db-reown.ts` has to move all eight, and each adds a
`restrict` foreign key to `auth.users` — the thing `database.md § What is not done yet` says blocks
deleting an account.

Production: **0 rows of 157** where the child's owner differs from its article's. So the copy
agrees today, and nothing but the insert sites keeps it so. (`link_summaries` is different: its
`owner_id` is part of the primary key and is read.)

Two ways out, and the choice is the owner's:

- **Drop the eight columns.** Removes eight columns, eight foreign keys, eight stanzas of
  `db-reown.ts`. Costs a migration that drops columns, and forecloses a future where somebody other
  than the owner writes on an article.
- **Keep them and make the database hold the agreement**: `UNIQUE (id, owner_id)` on `articles`,
  then `FOREIGN KEY (article_id, owner_id) REFERENCES articles (id, owner_id) ON UPDATE CASCADE` on
  each. Additive-safe (0 violating rows). The house already does exactly this once:
  `jobs_ingest_event_fk` onto `ingest_events_id_owner`.

### DBO4 — eleven objects that exist only in migrations

Comparing the production catalog with `schema.ts` by name (appendix § Drift): every name in
`schema.ts` exists in production, and local and production are identical. The other direction has
three groups:

- **Expected**: primary keys and Drizzle's auto-named column constraints; the 22 owner keys onto
  `auth.users`, `articles_current_revision_fk`, `jobs_ingest_event_fk`. `schema.ts` says
  these are hand-written, and `tests/db-schema.test.ts` lists them.
- **Six indexes**: `jobs_queued_idx`, `jobs_lease_idx`, `jobs_owner_created_idx` (`0001`),
  `chat_threads_article_updated_idx`, `chat_messages_thread_ordinal_idx`,
  `search_runs_article_created_idx` (`0003`). All used in production (361 to 30,287 scans). Two
  are the job queue's claim and sweep indexes.
- **Five CHECKs on `ai_calls`**: `ai_calls_cost_source_known`, `ai_calls_one_cost_source`,
  `ai_calls_price_version_iff_computed`, `ai_calls_provider_account_known`,
  `ai_calls_byok_upstream_only`.

`schema.ts` is described as "the source of truth" and a reader of the `jobs` table there will not
learn that its queue is indexed. `npm run db:check` (`src/db/schema-drift.ts`) compares columns and
defaults, not constraints or indexes, so losing one of these eleven on a rebuilt database would be
silent. The stated reason for keeping CHECKs out — that `drizzle-kit generate` cannot see them — is
the comment DBO11.3 shows to be stale.

**The fix, as a separate claim.** Either declare the eleven in `schema.ts` (the next `generate`
will then emit `CREATE`s for objects that already exist, so the migration must be hand-emptied and
the snapshot kept — the error-prone step), or the cheaper half: one test that asks the catalog for
every index and CHECK name and fails on any that is neither in `schema.ts` nor on a short listed
set. That test would have caught DBO3. It may duplicate part of `tests/db-schema.test.ts`, which
already lists the foreign keys; read that first.

### DBO6 — superseded revisions are most of the database

`schema.ts` § `revision_phrase_runs`: *"Old revisions are kept on purpose"*. `sweepAbandonedDrafts`
removes abandoned drafts only; *"published revisions are never candidates"*.

Production:

```
   status  | is_current | revisions | blocks          is_current | revisions |  html   | big_jsonb
 published | f          |       411 |  90870                   f |       421 | 38 MB   | 18 MB
 published | t          |        49 |  10704                   t |        49 | 4324 kB | 2327 kB
 failed    | f          |        10 |   4200
```

49 articles, 470 revisions: 9.6 each on average, 41 at most. **86% of `revision_blocks` and about
nine tenths of the revision bytes** belong to revisions no reader is shown. Every job that writes
to an article opens a draft that copies the published one's blocks, so the cost of one more mode on
one article is a full copy of its text.

I did not find what reads a superseded published revision, beyond `based_on_revision_id` (lineage)
and the export doc's *"Earlier revisions: they exist and carry lineage, so this is a product
decision"*. That is a hypothesis about an absence; I did not grep every store file for it.

This is 231 MB today and not a problem. It is here because it is the one thing in the schema that
grows with use rather than with content, and because DBO1's cost is proportional to it. See § For
the owner.

### DBO12 — reader rows keyed on ids that live inside JSON

`glossary_lookups`, `glossary_hidden_entries`, `citation_finds` and `citation_investigations` are
keyed `(article_id, entry_id)`, and `entry_id` is the id of an element inside
`article_revisions.glossary` / `.citations`. No foreign key can reach inside a JSON value, and the
artefact is rewritten per revision. `src/store/pg-glossary-hidden.ts` already has to open the blob
in SQL (`jsonb_array_elements(r.glossary -> 'entries')`, `e ->> 'id'`) to ask whether an id exists.

Production: 1 of 7 `glossary_lookups` and the only `glossary_hidden_entries` row name an entry that
is not in the article's current glossary. Whether that is harmless (the row is simply never
matched) I did not establish. `sql.md`: *"If you find yourself wanting an index on something inside
the blob, or a check on it, that sentence has stopped being true."* Named, not designed: the entries
a reader can attach things to are a table, and they are stored as a blob.

### DBO13 — one "not ready yet" flag is a column, its sibling is inside the tree

`article_revisions.nav_label_status` is a column with a CHECK. The same kind of fact for the
structure — *this tree is a stand-in* — is `tree.provisional = 'awaiting-structure'`, read in SQL
by `src/store/pg-revisions.ts` § `revisionAwaitsStructure` with `tree ->> 'provisional'`.
Production has 0 provisional trees at this moment. Low value; noted because a second query inside
that blob would make it worth a column.

## Per-table table

Production rows are `count(*)`-grade (`n_live_tup`, or an exact count where a finding uses one).
"JSON" lists JSONB columns and the verdict under `sql.md`. Blank means nothing found.

| Table | What it holds; owner key | Prod rows | JSON | Found |
|---|---|---|---|---|
| `articles` | one document; `owner_id` | 62 | — | 13 never published (DBO2). No index leads on `owner_id` (see Hot queries). `updated_at` null on 58: new column, not backfilled, as designed |
| `article_revisions` | one extraction; via article | 470 | 20 artefact blobs + `authors`: opaque, argued in the file | 421 not current (DBO6). Scalars CHECK missing (DBO8). `tree.provisional` (DBO13). `note` 0 of 470, `title_original` 0, reading-difficulty 0: the last two are days old |
| `block_identities` | every block id ever minted; via article | 24,344 | — | 38% belong to never-published articles (DBO2) |
| `revision_blocks` | the blocks of a revision | 105,774 | — | Identity FK unindexed (DBO1). Kind `callout`: allowed, produced by nothing, 0 rows (§ Siblings). `context_id`: 0 rows in both databases though `src/callouts.ts` produces it; I did not find out why. Roles other than `footnote` have readers and no producer yet (`src/supplement.ts` says so) |
| `revision_step_runs` | which step ran on a revision | 4,845 | — | 129 rows with no `started_at` or `finished_at`, all on revisions made before 2026-09-12; 0 of 1,293 since 2026-10-03 |
| `revision_phrase_runs` | shelf phrases per revision | 49 | `candidates`: opaque, argued | |
| `raw_sources` | fetched source objects, by hash | 46 | — | |
| `article_tags` | reader's tags | 6 | — | |
| `article_visibility_changes` | audit of public/private | 16 | — | Insert-only; no reader in `src/` or `scripts/`. Index unused in both databases; it serves the FK |
| `article_share_link_events` | audit of share links | 0 | — | Same |
| `jobs` | queue rows; `owner_id`, joined to its article by `slug` text | 64 | `steps` (status inside JSON, known in `sql.md`), `reset` | 0 retired step names in `steps`. Three catalog-only indexes (DBO4) |
| `queue_state` | one row to lock | 1 | — | Dead column (DBO10) |
| `uploads` | upload attempts; `owner_id` | 20 | — | `uploads_owner_claimed_sha256` 0 scans in production |
| `upload_source_guesses` | where an upload came from | 5 | — | |
| `comments` | reader's marks and notes | 27 | `citations`: opaque | `owner_id` write-only (DBO5). `thread_id` no FK (DBO9) |
| `chat_threads` | conversations | 56 | — | `owner_id` write-only (DBO5). Origin columns: 0 rows yet, a day old |
| `chat_messages` | turns | 200 | `citations`, `tools`, `passages`: opaque | Duplicate index (DBO3). `stance` legacy, 4 rows, documented |
| `search_runs` | saved searches | 45 | `hits`: opaque | `owner_id` write-only (DBO5) |
| `glossary_lookups` | Look it up answers | 7 | `citations` | DBO5, DBO12 |
| `glossary_hidden_entries` | entries the reader hid | 1 | — | DBO12 |
| `citation_finds` | found sources | 4 | — | DBO5, DBO12 |
| `citation_investigations` | investigations | 4 | `sources`, `paper_passages` | DBO5, DBO12 |
| `referee_criteria` | referee runs | 10 | `results` | DBO5 |
| `referee_claims` | claims run | 4 | `claims` | DBO5, DBO9 |
| `quiz_attempts` | quiz answers | 0 | — | |
| `reading_time` | seconds per block | 1,446 | — | No timestamp, on purpose: the privacy page promises totals, not a history. The test says it is Greg's call |
| `reader_profiles`, `reader_arrivals` | per reader | 3, 4 | — | |
| `feedback`, `feedback_shipped_emails` | reports | 471, 0 | `diagnostics`: versioned, opaque | 471 rows, one owner; `feedback` primary key has 31,700 scans. Not looked into |
| `checkpoints` | paid work a failed attempt keeps | 594 | `value`: opaque | 368 unused for 14 days. The 90-day sweep is a manual script nothing schedules (documented); 0 deletes ever in production |
| `ai_calls` | the spend ledger; `owner_id` | 2,366 | — | 5 catalog-only CHECKs (DBO4). `wire` comment (DBO11.1). `scope_kind`, `wire`, `outcome` have no CHECK. 176 rows carry `hierarchy` / `trajectory`: deliberate, the ledger is append-only and `RENAMED` in `src/cost-categories.ts` maps them |
| `realtime_sessions` | voice sessions | 13 | — | |
| `ingest_events` | quota slots | 2 | — | |
| `billing_*` (5 tables) | tiers, accounts, vouchers, emails | 2–6 each | — | Read the definitions only |
| `rate_limit_events` | spend allowances | 12 | — | DBO7 |
| `link_previews`, `link_summaries` | hover cards | 14, 3 | — | |
| `shelf_topic_scores`, `shelf_topic_sets` | shelf topics | 2, 1 | `scores`, `topics`, `members`: read whole | |
| `bibliographic_*` (3), `citation_index_*` (2) | registry caches | 26, 3, 4, 0, 0 | — | |

**Names that no longer match the code.** None in the catalog: no table, column, constraint or
index contains `hierarchy`, `trajectory`, `toc` or `remember`. `root_gist` and `gistable` keep the
word "gist" after the gist columns left the reading view; both are still written and read.

**Timestamps.** `tests/action-tables-have-created-at.test.ts` holds the rule and its 20 listed
tables are each argued. The two I would question: `queue_state` (its named column never moves, DBO10) and
`revision_step_runs` (`started_at` is nullable; fine since 2026-10-03).

## Hot queries and the index that serves each

Local `EXPLAIN (ANALYZE, BUFFERS)`, full text in the appendix. "Shape" means the table is too small
locally for the plan to prove anything, so the verdict comes from the predicate and the index
definitions.

| Query (store function) | Served by | Verdict |
|---|---|---|
| Article read: owner + slug → current revision (`pg.ts` § `currentRevisionQuery`) | `articles_slug_unique`, then `article_revisions_pkey` | Measured: 7 buffers |
| Blocks of a revision in order (`blocksQuery`) | `revision_blocks_revision_ordinal` | Measured: bitmap scan + sort, 403 buffers for 3,053 blocks |
| Library list (`listArticlesQuery`) | **none on `owner_id`**: seq scan of `articles` | Shape. With `enable_seqscan = off` the plan is still a seq scan. 62 rows and 16 kB in production (31,581 seq scans, all cheap). Not worth an index until there are thousands of articles |
| Comment counts for the shelf (`commentCounts`) | `comments` PK prefix | Shape |
| Jobs list poll (`pg-jobs.ts` § `list`) | `jobs_owner_created_idx` (catalog-only) | Shape; 1,840 production scans |
| Claim: other running jobs | `jobs_lease_idx` (catalog-only) | Measured: 1 buffer |
| Claim: predecessor on a slug (`blockedByAnother`) | `jobs_slug_order` | Measured: index-only, 2 buffers |
| Expired-lease sweep | `jobs_lease_idx` | Measured: 1 buffer |
| Chat threads of an article | `chat_threads_article_updated_idx` (catalog-only) | Shape |
| Chat messages of a thread | `chat_messages_thread_ordinal_idx` (the duplicate) | Measured; the UNIQUE twin would serve it |
| Comments of an article | PK prefix | Measured |
| Spend by owner in a window, product scopes | `ai_calls_scope_started` | Measured |
| Spend grouped over a window only (admin) | none; seq scan | Measured: 543 buffers for 13,581 rows. Admin page, 2,366 rows in production. Fine |
| Spend for one article (`belongsTo`) | none chosen; seq scan | Measured locally; production uses `ai_calls_article` (13,095 scans). Fine |
| Rate-limit counts, and the global fuse | `rate_limit_events_owner_bucket_started`, `…_bucket_started` | Shape |
| Public shelf | `articles_public_listing` | Measured: index-only |
| **FK lookup on deleting a block id** | **none** | **DBO1** |

**Indexes with 0 production scans since 2026-08-20**, excluding unique indexes that exist to
enforce a rule: `checkpoints_last_used_at` (the manual sweep has never run there),
`article_revisions_raw_sha256`, `uploads_owner_claimed_sha256`, `ingest_events_article_id_live`,
`article_visibility_changes_article_at`, `article_share_link_events_article_at`. Each has a query
or a foreign key it serves and is 8–40 kB. I propose dropping none of them.

**Duplicates and prefixes.** One exact duplicate (DBO3). `article_revisions_article_id_id` and
`ingest_events_id_owner` look redundant with their primary keys and are not: each is the target of
a composite foreign key.

## Siblings compared

| The thing | Each sibling | How each handles it |
|---|---|---|
| A closed list of codes in a text column | `revision_step_runs.step_name`, `checkpoints.namespace`, `rate_limit_events.bucket`, `chat_threads.kind`, `ai_calls.cost_source`, `provider_account` | CHECK, hand-kept, a test ties it to the TS union |
| | `ai_calls.scope_kind`, `wire`, `outcome` | **No CHECK and no sentence saying why.** Production holds 2, 7 and 3 values |
| | `jobs.failure_kind`, `ai_calls.failure_class`, `realtime_sessions.close_reason` | No CHECK, with the reason written beside each |
| CHECK values nothing produces any more | `rate_limit_events.bucket = 'citation-find'` | Retired; **1** production row (DBO7) |
| | `revision_blocks.kind = 'callout'` | `src/types.ts` § `BlockKind`: *"legacy and is produced by nothing"*. **0** rows of 105,774 in production, 0 of 232,489 locally. Narrowing the CHECK is satisfiable today; it also means narrowing the type, and `src/vocabulary.ts` still tests for the kind |
| | `chat_messages.stance` (all four values) | Legacy, read-only, documented. 4 production rows (`balanced` 3, `socratic` 1), so not narrowable |
| CHECK values with no production rows that are live | `uploads.status` `pending` / `expired`, `rate_limit_events.bucket = 'feedback-notice'` | Transient or simply unused so far; each has a writer |
| | `revision_step_runs.step_name = 'metadata'`, `checkpoints.namespace = 'structure-deepen'`, `ingest_events.kind` `high_power` / `minimal`, `chat_threads.origin_mode` (all four) | 0 rows each. Each has a producer in `src/` except `origin_mode = 'summary'`, which the comment says is wider than the type on purpose |
| Owner of an article's child rows | `comments`, `chat_threads`, `search_runs`, `glossary_lookups`, `citation_finds`, `citation_investigations`, `referee_criteria`, `referee_claims` | Own `owner_id`, unread (DBO5) |
| | `quiz_attempts`, `glossary_hidden_entries`, `article_tags`, `reading_time`, `checkpoints`, `upload_source_guesses` | None; inherited through the article |
| Owner FK name | 21 tables | `<table>_owner_fk` |
| | `ai_calls` | `ai_calls_owner_id_users_id_fk` |
| `on delete` of the owner FK | most | `restrict` |
| | `link_summaries`, `rate_limit_events`, `reader_arrivals`, `shelf_topic_scores`, `shelf_topic_sets` | `cascade` (`database.md` knows) |
| A renamed step | `revision_step_runs`, `jobs.steps`, `checkpoints` | Rows rewritten in the migration |
| | `ai_calls` | Left, on purpose, and mapped at the read |
| "Not ready yet" for an artefact | nav labels | `nav_label_status` column + CHECK |
| | structure | `tree.provisional` inside JSON (DBO13) |
| Things that only accumulate | abandoned drafts | Swept (`sweepAbandonedDrafts`) |
| | finished jobs | Trimmed (`trimFinished`) |
| | never-published articles, superseded revisions, unused rate buckets, checkpoints | Not swept (DBO2, DBO6, DBO7; checkpoints by a manual script) |

## For the owner

1. **Should a superseded published revision be kept for ever?** (DBO6.) Today every job copies the
   article's blocks into a new revision and the old one stays. It removes nothing to keep them; it
   costs a full copy of the text per job, which is 86% of the largest table already. Deleting them
   would remove the only stored history of what an article looked like before each re-run, and the
   lineage chain. A middle course is keeping the last few. Nothing forces this now.
2. **The 13 never-published article rows** (DBO2): delete them, and decide whether a failed first
   import should leave a row at all. Removes 13 invisible rows and 9,303 block ids. Costs a
   production delete and a small sweep or a change to how a first import fails.
3. **The eight unread `owner_id` columns** (DBO5): drop them, or keep them and add the foreign key
   that makes them true. Dropping forecloses "somebody other than the owner writes on an article".
4. **`citation-find`** (DBO7): one production row to delete before the CHECK can be narrowed.
5. **`queue_state.running_job_id`** (DBO10): drop, whenever a migration is going past.

## Considered and not proposed

- **An index on `articles (owner_id)`.** No query is slow: the table is 16 kB. Revisit at a few
  thousand articles.
- **An index on `ai_calls (started_at)`** for the admin window report. 2,366 rows.
- **Dropping the six never-scanned indexes.** Each is small and has a named purpose.
- **CHECKs on `ai_calls.scope_kind` / `wire` / `outcome`.** Additive-safe by construction, but
  `wire` has grown from three values to seven without anyone updating its comment, which is the
  argument `failure_class` gives for having none. A product-neutral call either way; I would only
  fix the comment.
- **A foreign key on `comments.thread_id`.** Now expressible, no evidence it is needed (DBO9).
- **Indexes for the other unindexed foreign keys** (`realtime_sessions.article_id`,
  `article_revisions.based_on_revision_id`, `jobs.upload_id`, `ingest_events.superseded_by`). Each
  is a seq scan of a table under 1 MB.
- **Rewriting `ai_calls` rows that say `hierarchy`.** Decided against in the migration header, and
  handled at the read.
- **Splitting `schema.ts`.** Refused by the fifth sweep; I bring nothing new.
- **Booleans that could be timestamps** (`stopped`, `interrupted`, `help`, `cancelling`,
  `reserves_name`, `fixture`). `sql.md` prefers a timestamp where a flag is an event; several of
  these already have a sibling time column. No drift proved.

## How a migration is written and applied here, and where it goes wrong

Edit `src/db/schema.ts`; `npm run db:generate` writes a `.sql` under `drizzle/`; hand-edit it where
generation cannot know (data movement, `auth.users` keys, triggers); `npm run db:migrate` applies
it locally; the Overseer's `npm run deploy` applies it to production as `postgres` over the session
pooler. The ledger is `spideryarn_migrations.__drizzle_migrations`.

Error-prone, in the order I would worry:

1. **A widened or renamed code list is three hand-kept copies** (TS union, `schema.ts` literal,
   migration), and 13 of the last 40 migrations are a `DROP CONSTRAINT` / `ADD CONSTRAINT` pair.
   Tests tie most pairs together; `scope_kind`, `wire` and `outcome` have nothing.
2. **Data movement must sit between the DROP and the ADD**, and `generate` never writes it. Three
   migrations document the trap; the pattern is followed.
3. **Hand-written objects are invisible to `schema.ts` and to `db:check`** (DBO4).
4. **`ADD COLUMN … DEFAULT now()`** invents a time for old rows; a test refuses it.
5. **One local database for every worktree**, so one tree's unlanded migration blocks the others.
6. **Which database a command reaches** — read the `Target:` line (`database.md`).

## One level up

The approach is sound, and unusually so: constraints are treated as the place a rule lives, each
JSON column argues for itself, and the two catalogs agree exactly. The weakness is the opposite of
the usual one. Rows are well guarded while they exist and nothing decides when they stop existing:
revisions, failed first imports, rate events, checkpoints and block ids all accumulate, each for a
stated local reason, and the only delete path that matters — an article — has never run in
production and is missing the one index that would make it cheap. The second, smaller weakness is
that the file called the source of truth is not the whole truth: eleven objects and a good many
decisions live only in migrations and comments, and two of those comments still defend a missing
constraint against a filesystem store that was deleted a month ago.

---

# Appendix: every statement run, with its output

Two wrappers were used. Local: `docker exec -i supabase_db_spideryarn2 psql -U postgres` with the
input wrapped in `BEGIN READ ONLY; SET LOCAL search_path = spideryarn, public; … ROLLBACK;`.
Production: the same container's `psql`, pointed at `DATABASE_URL` from `.env.prod` (never
printed), wrapped in `BEGIN READ ONLY; SET LOCAL search_path …; SET LOCAL statement_timeout =
'30s'; … ROLLBACK;`. Both connections reported `transaction_read_only = on`; production's
`current_user` was `spideryarn_app`. One statement was refused by that guard (`SELECT … FOR KEY
SHARE`, locally) and was rerun without the lock clause.

## A0. Connection check

Database: **local, then production (same output shape; production shown)**.

```sql
select current_database(), current_user, current_setting('transaction_read_only') as ro, split_part(version(),' ',2) as v;
select count(*) as tables from information_schema.tables where table_schema='spideryarn';
```

```
 current_database |  current_user  | ro |  v   
------------------+----------------+----+------
 postgres         | spideryarn_app | on | 17.6
(1 row)

 tables 
--------
     49
(1 row)
```

## A1. Catalog dump, and the local / production diff

Database: **both**. The same file was run against each and the two outputs compared with `diff`.

```sql
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'
select 'IDX', tablename, indexname, indexdef from pg_indexes where schemaname='spideryarn' order by 2,3;
select 'CON', c.conrelid::regclass::text, c.conname, c.contype, c.convalidated, pg_get_constraintdef(c.oid)
  from pg_constraint c join pg_namespace n on n.oid=c.connamespace
  where n.nspname='spideryarn' and c.contype <> 'n' order by 2,3;
select 'COL', table_name, column_name, data_type, is_nullable, coalesce(column_default,'')
  from information_schema.columns where table_schema='spideryarn' order by 2, ordinal_position;
select 'TRG', event_object_table, trigger_name, action_timing, event_manipulation from information_schema.triggers where trigger_schema='spideryarn' order by 2,3,5;
```

Each output is 1,152 lines: 104 indexes, 353 constraints (not-null excluded), 662 columns, 5 trigger rows.
`diff` of the two outputs — the only difference is the position of one column:

```
580a581
> COL|article_revisions|quotes|jsonb|YES|
583d583
< COL|article_revisions|quotes|jsonb|YES|
```

Production indexes (`pg_indexes`):

```
ai_calls|ai_calls_article | INDEX ai_calls_article ON ai_calls USING btree (article_id)
ai_calls|ai_calls_job | INDEX ai_calls_job ON ai_calls USING btree (job_id)
ai_calls|ai_calls_owner_started | INDEX ai_calls_owner_started ON ai_calls USING btree (owner_id, started_at DESC)
ai_calls|ai_calls_pkey | UNIQUE INDEX ai_calls_pkey ON ai_calls USING btree (id)
ai_calls|ai_calls_realtime_event | UNIQUE INDEX ai_calls_realtime_event ON ai_calls USING btree (realtime_session_id, provider_event_id, event_kind) WHERE (realtime_session_id IS NOT NULL)
ai_calls|ai_calls_scope_started | INDEX ai_calls_scope_started ON ai_calls USING btree (scope_kind, started_at DESC)
article_revisions|article_revisions_article_id_id | UNIQUE INDEX article_revisions_article_id_id ON article_revisions USING btree (article_id, id)
article_revisions|article_revisions_pkey | UNIQUE INDEX article_revisions_pkey ON article_revisions USING btree (id)
article_revisions|article_revisions_raw_sha256 | INDEX article_revisions_raw_sha256 ON article_revisions USING btree (raw_sha256, article_id) WHERE (raw_sha256 IS NOT NULL)
article_share_link_events|article_share_link_events_article_at | INDEX article_share_link_events_article_at ON article_share_link_events USING btree (article_id, created_at)
article_share_link_events|article_share_link_events_pkey | UNIQUE INDEX article_share_link_events_pkey ON article_share_link_events USING btree (id)
article_tags|article_tags_article_id_tag_pk | UNIQUE INDEX article_tags_article_id_tag_pk ON article_tags USING btree (article_id, tag)
article_visibility_changes|article_visibility_changes_article_at | INDEX article_visibility_changes_article_at ON article_visibility_changes USING btree (article_id, at)
article_visibility_changes|article_visibility_changes_pkey | UNIQUE INDEX article_visibility_changes_pkey ON article_visibility_changes USING btree (id)
articles|articles_pkey | UNIQUE INDEX articles_pkey ON articles USING btree (id)
articles|articles_public_listing | INDEX articles_public_listing ON articles USING btree (public_at DESC NULLS LAST, slug) WHERE (visibility = 'public'::text)
articles|articles_share_token_unique | UNIQUE INDEX articles_share_token_unique ON articles USING btree (share_token)
articles|articles_short_id_unique | UNIQUE INDEX articles_short_id_unique ON articles USING btree (short_id)
articles|articles_slug_unique | UNIQUE INDEX articles_slug_unique ON articles USING btree (slug)
bibliographic_records|bibliographic_records_pkey | UNIQUE INDEX bibliographic_records_pkey ON bibliographic_records USING btree (id)
bibliographic_service_slots|bibliographic_service_slots_service_slot_pk | UNIQUE INDEX bibliographic_service_slots_service_slot_pk ON bibliographic_service_slots USING btree (service, slot)
bibliographic_services|bibliographic_services_pkey | UNIQUE INDEX bibliographic_services_pkey ON bibliographic_services USING btree (service)
billing_accounts|billing_accounts_pkey | UNIQUE INDEX billing_accounts_pkey ON billing_accounts USING btree (owner_id)
billing_accounts|billing_accounts_stripe_customer_id_unique | UNIQUE INDEX billing_accounts_stripe_customer_id_unique ON billing_accounts USING btree (stripe_customer_id)
billing_accounts|billing_accounts_stripe_subscription_id_unique | UNIQUE INDEX billing_accounts_stripe_subscription_id_unique ON billing_accounts USING btree (stripe_subscription_id)
billing_tier_prices|billing_tier_prices_tier_id_currency_pk | UNIQUE INDEX billing_tier_prices_tier_id_currency_pk ON billing_tier_prices USING btree (tier_id, currency)
billing_tiers|billing_tiers_lookup_key | UNIQUE INDEX billing_tiers_lookup_key ON billing_tiers USING btree (lookup_key)
billing_tiers|billing_tiers_pkey | UNIQUE INDEX billing_tiers_pkey ON billing_tiers USING btree (id)
billing_tiers|billing_tiers_price_id | UNIQUE INDEX billing_tiers_price_id ON billing_tiers USING btree (stripe_price_id)
billing_voucher_emails|billing_voucher_emails_one_claimed | UNIQUE INDEX billing_voucher_emails_one_claimed ON billing_voucher_emails USING btree (voucher_id) WHERE (kind = 'claimed'::text)
billing_voucher_emails|billing_voucher_emails_pkey | UNIQUE INDEX billing_voucher_emails_pkey ON billing_voucher_emails USING btree (id)
billing_voucher_emails|billing_voucher_emails_voucher | INDEX billing_voucher_emails_voucher ON billing_voucher_emails USING btree (voucher_id, kind, created_at)
billing_vouchers|billing_vouchers_claimed_by | INDEX billing_vouchers_claimed_by ON billing_vouchers USING btree (claimed_by)
billing_vouchers|billing_vouchers_pkey | UNIQUE INDEX billing_vouchers_pkey ON billing_vouchers USING btree (id)
billing_vouchers|billing_vouchers_unclaimed_email | INDEX billing_vouchers_unclaimed_email ON billing_vouchers USING btree (email) WHERE (claimed_by IS NULL)
block_identities|block_identities_article_id_block_id_pk | UNIQUE INDEX block_identities_article_id_block_id_pk ON block_identities USING btree (article_id, block_id)
chat_messages|chat_messages_article_id_thread_id_id_pk | UNIQUE INDEX chat_messages_article_id_thread_id_id_pk ON chat_messages USING btree (article_id, thread_id, id)
chat_messages|chat_messages_thread_ordinal | UNIQUE INDEX chat_messages_thread_ordinal ON chat_messages USING btree (article_id, thread_id, ordinal)
chat_messages|chat_messages_thread_ordinal_idx | INDEX chat_messages_thread_ordinal_idx ON chat_messages USING btree (article_id, thread_id, ordinal)
chat_threads|chat_threads_article_id_id_pk | UNIQUE INDEX chat_threads_article_id_id_pk ON chat_threads USING btree (article_id, id)
chat_threads|chat_threads_article_updated_idx | INDEX chat_threads_article_updated_idx ON chat_threads USING btree (article_id, updated_at DESC)
chat_threads|chat_threads_one_explore | UNIQUE INDEX chat_threads_one_explore ON chat_threads USING btree (article_id) WHERE (kind = 'explore'::text)
chat_threads|chat_threads_one_learn | UNIQUE INDEX chat_threads_one_learn ON chat_threads USING btree (article_id) WHERE (kind = 'learn'::text)
chat_threads|chat_threads_one_tutorial | UNIQUE INDEX chat_threads_one_tutorial ON chat_threads USING btree (article_id) WHERE (kind = 'tutorial'::text)
checkpoints|checkpoints_article_id_namespace_key_pk | UNIQUE INDEX checkpoints_article_id_namespace_key_pk ON checkpoints USING btree (article_id, namespace, key)
checkpoints|checkpoints_last_used_at | INDEX checkpoints_last_used_at ON checkpoints USING btree (last_used_at)
citation_finds|citation_finds_article_id_entry_id_pk | UNIQUE INDEX citation_finds_article_id_entry_id_pk ON citation_finds USING btree (article_id, entry_id)
citation_index_citers|citation_index_citers_work_id_position_pk | UNIQUE INDEX citation_index_citers_work_id_position_pk ON citation_index_citers USING btree (work_id, "position")
citation_index_lookups|citation_index_lookups_pkey | UNIQUE INDEX citation_index_lookups_pkey ON citation_index_lookups USING btree (work_id)
citation_investigations|citation_investigations_article_id_entry_id_pk | UNIQUE INDEX citation_investigations_article_id_entry_id_pk ON citation_investigations USING btree (article_id, entry_id)
comments|comments_article_id_id_pk | UNIQUE INDEX comments_article_id_id_pk ON comments USING btree (article_id, id)
feedback|feedback_owner_created_idx | INDEX feedback_owner_created_idx ON feedback USING btree (owner_id, created_at)
feedback|feedback_owner_id_id_pk | UNIQUE INDEX feedback_owner_id_id_pk ON feedback USING btree (owner_id, id)
feedback_shipped_emails|feedback_shipped_emails_owner_id_report_id_pk | UNIQUE INDEX feedback_shipped_emails_owner_id_report_id_pk ON feedback_shipped_emails USING btree (owner_id, report_id)
glossary_hidden_entries|glossary_hidden_entries_article_id_entry_id_pk | UNIQUE INDEX glossary_hidden_entries_article_id_entry_id_pk ON glossary_hidden_entries USING btree (article_id, entry_id)
glossary_lookups|glossary_lookups_article_id_entry_id_pk | UNIQUE INDEX glossary_lookups_article_id_entry_id_pk ON glossary_lookups USING btree (article_id, entry_id)
ingest_events|ingest_events_article_id_live | INDEX ingest_events_article_id_live ON ingest_events USING btree (article_id) WHERE (article_id IS NOT NULL)
ingest_events|ingest_events_high_power_once | UNIQUE INDEX ingest_events_high_power_once ON ingest_events USING btree (article_id) WHERE ((kind = 'high_power'::text) AND (article_id IS NOT NULL))
ingest_events|ingest_events_id_owner | UNIQUE INDEX ingest_events_id_owner ON ingest_events USING btree (id, owner_id)
ingest_events|ingest_events_one_upgrade_in_flight | UNIQUE INDEX ingest_events_one_upgrade_in_flight ON ingest_events USING btree (article_id) WHERE ((kind = 'ingest'::text) AND (article_id IS NOT NULL) AND (succeeded_at IS NULL) AND (released_at IS NULL))
ingest_events|ingest_events_owner_reserved | INDEX ingest_events_owner_reserved ON ingest_events USING btree (owner_id, reserved_at DESC NULLS LAST)
ingest_events|ingest_events_pkey | UNIQUE INDEX ingest_events_pkey ON ingest_events USING btree (id)
jobs|jobs_active_source | UNIQUE INDEX jobs_active_source ON jobs USING btree (owner_id, url_key) WHERE ((status = ANY (ARRAY['queued'::text, 'running'::text])) AND reserves_name)
jobs|jobs_active_work | UNIQUE INDEX jobs_active_work ON jobs USING btree (owner_id, slug, work_key) WHERE ((status = ANY (ARRAY['queued'::text, 'running'::text])) AND (NOT cancelling))
jobs|jobs_draft_revision_unique | UNIQUE INDEX jobs_draft_revision_unique ON jobs USING btree (draft_revision_id) WHERE (draft_revision_id IS NOT NULL)
jobs|jobs_ingest_event_unique | UNIQUE INDEX jobs_ingest_event_unique ON jobs USING btree (ingest_event_id) WHERE (ingest_event_id IS NOT NULL)
jobs|jobs_lease_idx | INDEX jobs_lease_idx ON jobs USING btree (lease_expires_at) WHERE (status = 'running'::text)
jobs|jobs_owner_created_idx | INDEX jobs_owner_created_idx ON jobs USING btree (owner_id, created_at DESC)
jobs|jobs_pkey | UNIQUE INDEX jobs_pkey ON jobs USING btree (id)
jobs|jobs_queued_idx | INDEX jobs_queued_idx ON jobs USING btree (created_at) WHERE (status = 'queued'::text)
jobs|jobs_reserved_slug | UNIQUE INDEX jobs_reserved_slug ON jobs USING btree (slug) WHERE ((status = ANY (ARRAY['queued'::text, 'running'::text])) AND reserves_name)
jobs|jobs_slug_order | INDEX jobs_slug_order ON jobs USING btree (slug, created_at, id) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]))
link_previews|link_previews_expires_at | INDEX link_previews_expires_at ON link_previews USING btree (expires_at)
link_previews|link_previews_pkey | UNIQUE INDEX link_previews_pkey ON link_previews USING btree (target)
link_summaries|link_summaries_expires_at | INDEX link_summaries_expires_at ON link_summaries USING btree (expires_at)
link_summaries|link_summaries_owner_id_article_id_target_block_id_pk | UNIQUE INDEX link_summaries_owner_id_article_id_target_block_id_pk ON link_summaries USING btree (owner_id, article_id, target, block_id)
queue_state|queue_state_pkey | UNIQUE INDEX queue_state_pkey ON queue_state USING btree (id)
quiz_attempts|quiz_attempts_latest | INDEX quiz_attempts_latest ON quiz_attempts USING btree (article_id, batch_id, question_id, created_at DESC NULLS LAST)
quiz_attempts|quiz_attempts_pkey | UNIQUE INDEX quiz_attempts_pkey ON quiz_attempts USING btree (id)
rate_limit_events|rate_limit_events_bucket_started | INDEX rate_limit_events_bucket_started ON rate_limit_events USING btree (bucket, started_at)
rate_limit_events|rate_limit_events_owner_bucket_started | INDEX rate_limit_events_owner_bucket_started ON rate_limit_events USING btree (owner_id, bucket, started_at)
rate_limit_events|rate_limit_events_pkey | UNIQUE INDEX rate_limit_events_pkey ON rate_limit_events USING btree (id)
raw_sources|raw_sources_sha256_kind_pk | UNIQUE INDEX raw_sources_sha256_kind_pk ON raw_sources USING btree (sha256, kind)
reader_arrivals|reader_arrivals_pkey | UNIQUE INDEX reader_arrivals_pkey ON reader_arrivals USING btree (owner_id)
reader_profiles|reader_profiles_pkey | UNIQUE INDEX reader_profiles_pkey ON reader_profiles USING btree (owner_id)
reading_time|reading_time_article_id_block_id_pk | UNIQUE INDEX reading_time_article_id_block_id_pk ON reading_time USING btree (article_id, block_id)
realtime_sessions|realtime_sessions_owner_issued | INDEX realtime_sessions_owner_issued ON realtime_sessions USING btree (owner_id, issued_at DESC NULLS LAST)
realtime_sessions|realtime_sessions_pkey | UNIQUE INDEX realtime_sessions_pkey ON realtime_sessions USING btree (id)
referee_claims|referee_claims_pkey | UNIQUE INDEX referee_claims_pkey ON referee_claims USING btree (article_id)
referee_criteria|referee_criteria_article_id_id_pk | UNIQUE INDEX referee_criteria_article_id_id_pk ON referee_criteria USING btree (article_id, id)
revision_blocks|revision_blocks_fts | INDEX revision_blocks_fts ON revision_blocks USING gin (fts)
revision_blocks|revision_blocks_revision_id_block_id_pk | UNIQUE INDEX revision_blocks_revision_id_block_id_pk ON revision_blocks USING btree (revision_id, block_id)
revision_blocks|revision_blocks_revision_ordinal | UNIQUE INDEX revision_blocks_revision_ordinal ON revision_blocks USING btree (revision_id, ordinal)
revision_phrase_runs|revision_phrase_runs_article | INDEX revision_phrase_runs_article ON revision_phrase_runs USING btree (article_id)
revision_phrase_runs|revision_phrase_runs_revision_id_extractor_version_pk | UNIQUE INDEX revision_phrase_runs_revision_id_extractor_version_pk ON revision_phrase_runs USING btree (revision_id, extractor_version)
revision_step_runs|revision_step_runs_revision_id_step_name_pk | UNIQUE INDEX revision_step_runs_revision_id_step_name_pk ON revision_step_runs USING btree (revision_id, step_name)
search_runs|search_runs_article_created_idx | INDEX search_runs_article_created_idx ON search_runs USING btree (article_id, created_at DESC)
search_runs|search_runs_article_id_id_pk | UNIQUE INDEX search_runs_article_id_id_pk ON search_runs USING btree (article_id, id)
shelf_topic_scores|shelf_topic_scores_owner_id_scope_pk | UNIQUE INDEX shelf_topic_scores_owner_id_scope_pk ON shelf_topic_scores USING btree (owner_id, scope)
shelf_topic_sets|shelf_topic_sets_pkey | UNIQUE INDEX shelf_topic_sets_pkey ON shelf_topic_sets USING btree (owner_id)
upload_source_guesses|upload_source_guesses_pkey | UNIQUE INDEX upload_source_guesses_pkey ON upload_source_guesses USING btree (article_id)
uploads|uploads_owner_claimed_sha256 | INDEX uploads_owner_claimed_sha256 ON uploads USING btree (owner_id, claimed_sha256)
uploads|uploads_owner_minted | INDEX uploads_owner_minted ON uploads USING btree (owner_id, minted_at DESC NULLS LAST)
uploads|uploads_pkey | UNIQUE INDEX uploads_pkey ON uploads USING btree (id)
```

Production foreign keys (`pg_constraint`, `contype = 'f'`; all validated):

```
ai_calls | ai_calls_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL
ai_calls | ai_calls_owner_id_users_id_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT
ai_calls | ai_calls_realtime_session_id_realtime_sessions_id_fk | FOREIGN KEY (realtime_session_id) REFERENCES realtime_sessions(id) ON DELETE RESTRICT
article_revisions | article_revisions_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
article_revisions | article_revisions_based_on_revision_id_article_revisions_id_fk | FOREIGN KEY (based_on_revision_id) REFERENCES article_revisions(id) ON DELETE SET NULL
article_revisions | article_revisions_raw_source_fk | FOREIGN KEY (raw_source_sha256, raw_source_kind) REFERENCES raw_sources(sha256, kind)
article_share_link_events | article_share_link_events_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL
article_tags | article_tags_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
article_visibility_changes | article_visibility_changes_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL
articles | articles_current_revision_fk | FOREIGN KEY (id, current_revision_id) REFERENCES article_revisions(article_id, id)
articles | articles_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT
bibliographic_service_slots | bibliographic_service_slots_service_bibliographic_services_serv | FOREIGN KEY (service) REFERENCES bibliographic_services(service) ON DELETE CASCADE
billing_accounts | billing_accounts_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT
billing_tier_prices | billing_tier_prices_tier_id_billing_tiers_id_fk | FOREIGN KEY (tier_id) REFERENCES billing_tiers(id) ON DELETE CASCADE
billing_voucher_emails | billing_voucher_emails_voucher_id_billing_vouchers_id_fk | FOREIGN KEY (voucher_id) REFERENCES billing_vouchers(id) ON DELETE CASCADE
billing_vouchers | billing_vouchers_claimed_by_billing_accounts_owner_id_fk | FOREIGN KEY (claimed_by) REFERENCES billing_accounts(owner_id) ON DELETE RESTRICT
block_identities | block_identities_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
chat_messages | chat_messages_thread_fk | FOREIGN KEY (article_id, thread_id) REFERENCES chat_threads(article_id, id) ON DELETE CASCADE
chat_threads | chat_threads_anchor_identity_fk | FOREIGN KEY (article_id, anchor_block_id) REFERENCES block_identities(article_id, block_id)
chat_threads | chat_threads_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
chat_threads | chat_threads_origin_identity_fk | FOREIGN KEY (article_id, origin_block_id) REFERENCES block_identities(article_id, block_id)
chat_threads | chat_threads_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT
checkpoints | checkpoints_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
citation_finds | citation_finds_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
citation_finds | citation_finds_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT
citation_index_citers | citation_index_citers_work_id_citation_index_lookups_work_id_fk | FOREIGN KEY (work_id) REFERENCES citation_index_lookups(work_id) ON DELETE CASCADE
citation_investigations | citation_investigations_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
citation_investigations | citation_investigations_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT
comments | comments_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
comments | comments_criterion_fk | FOREIGN KEY (article_id, criterion_id) REFERENCES referee_criteria(article_id, id)
comments | comments_identity_fk | FOREIGN KEY (article_id, block_id) REFERENCES block_identities(article_id, block_id)
comments | comments_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT
feedback | feedback_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT
feedback_shipped_emails | feedback_shipped_emails_feedback_fk | FOREIGN KEY (owner_id, report_id) REFERENCES feedback(owner_id, id) ON DELETE CASCADE
glossary_hidden_entries | glossary_hidden_entries_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
glossary_lookups | glossary_lookups_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
glossary_lookups | glossary_lookups_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT
ingest_events | ingest_events_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL
ingest_events | ingest_events_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT
ingest_events | ingest_events_superseded_by_ingest_events_id_fk | FOREIGN KEY (superseded_by) REFERENCES ingest_events(id)
jobs | jobs_draft_revision_id_article_revisions_id_fk | FOREIGN KEY (draft_revision_id) REFERENCES article_revisions(id) ON DELETE SET NULL
jobs | jobs_ingest_event_fk | FOREIGN KEY (ingest_event_id, owner_id) REFERENCES ingest_events(id, owner_id)
jobs | jobs_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT
jobs | jobs_upload_id_uploads_id_fk | FOREIGN KEY (upload_id) REFERENCES uploads(id) ON DELETE SET NULL
link_summaries | link_summaries_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
link_summaries | link_summaries_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
queue_state | queue_state_running_job_id_jobs_id_fk | FOREIGN KEY (running_job_id) REFERENCES jobs(id) ON DELETE SET NULL
quiz_attempts | quiz_attempts_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
rate_limit_events | rate_limit_events_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
reader_arrivals | reader_arrivals_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
reader_profiles | reader_profiles_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT
reading_time | reading_time_block_fk | FOREIGN KEY (article_id, block_id) REFERENCES block_identities(article_id, block_id) ON DELETE CASCADE
realtime_sessions | realtime_sessions_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL
realtime_sessions | realtime_sessions_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT
referee_claims | referee_claims_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
referee_claims | referee_claims_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT
referee_criteria | referee_criteria_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
referee_criteria | referee_criteria_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT
revision_blocks | revision_blocks_identity_fk | FOREIGN KEY (article_id, block_id) REFERENCES block_identities(article_id, block_id)
revision_blocks | revision_blocks_revision_fk | FOREIGN KEY (article_id, revision_id) REFERENCES article_revisions(article_id, id) ON DELETE CASCADE
revision_phrase_runs | revision_phrase_runs_revision_fk | FOREIGN KEY (article_id, revision_id) REFERENCES article_revisions(article_id, id) ON DELETE CASCADE
revision_step_runs | revision_step_runs_revision_id_article_revisions_id_fk | FOREIGN KEY (revision_id) REFERENCES article_revisions(id) ON DELETE CASCADE
search_runs | search_runs_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
search_runs | search_runs_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT
shelf_topic_scores | shelf_topic_scores_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
shelf_topic_sets | shelf_topic_sets_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
upload_source_guesses | upload_source_guesses_article_id_articles_id_fk | FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
uploads | uploads_owner_fk | FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT
```

Production triggers:

```
TRG|articles|ingest_events_freeze_article_price|BEFORE|DELETE
TRG|ingest_events|ingest_events_require_price_on_unlink|BEFORE|UPDATE
TRG|ingest_events|ingest_events_superseded_by_ingest|BEFORE|INSERT
TRG|ingest_events|ingest_events_superseded_by_ingest|BEFORE|UPDATE
TRG|queue_state|queue_state_no_delete|BEFORE|DELETE
```

The CHECK definitions (225) are not reproduced; they match `src/db/schema.ts` plus the five named in DBO4, whose definitions are:

```
ai_calls_byok_upstream_only | CHECK (((byok_upstream_nanos IS NULL) OR ((cost_source = 'provider'::text) AND (is_byok IS TRUE) AND (provider_account = 'openrouter'::text))))
ai_calls_cost_source_known | CHECK ((cost_source = ANY (ARRAY['provider'::text, 'computed'::text, 'none'::text])))
ai_calls_one_cost_source | CHECK ((((cost_source = 'provider'::text) AND (credits_used_nanos IS NOT NULL) AND (computed_cost_nanos IS NULL)) OR ((cost_source = 'computed'::text) AND (credits_used_nanos IS NULL) AND (computed_cost_nanos IS NOT NULL)) OR ((cost_source = 'none'::text) AND (credits_used_nanos IS NULL) AND (computed_cost_nanos IS NULL))))
ai_calls_price_version_iff_computed | CHECK ((((cost_source = 'computed'::text) AND (price_version IS NOT NULL)) OR ((cost_source <> 'computed'::text) AND (price_version IS NULL))))
ai_calls_provider_account_known | CHECK ((provider_account = ANY (ARRAY['openrouter'::text, 'anthropic'::text, 'openai'::text])))
```

## A2. Drift: catalog names against `src/db/schema.ts`

Not SQL. Names from A1 (`indexname`, `conname`) were each looked for as a quoted string in `schema.ts`; names from `schema.ts` (`check("…")`, `index("…")`, `uniqueIndex("…")`, `unique("…")`, `name: "…"`; 163 of them) were each looked for in A1.

- In `schema.ts` and not in production: **none**.
- In production and not in `schema.ts`, after removing primary keys, auto-named column constraints and the hand-written foreign keys: the six indexes and five CHECKs listed in DBO4.

## A3. Production statistics: tables and index scans

Database: **production**. Statistics were last reset on 2026-08-20.

```sql
select stats_reset, now() as asked_at from pg_stat_database where datname = current_database();
select relname, n_live_tup, n_dead_tup, seq_scan, seq_tup_read, idx_scan, n_tup_ins, n_tup_upd, n_tup_del,
       pg_size_pretty(pg_total_relation_size(relid)) as total, pg_size_pretty(pg_relation_size(relid)) as heap,
       last_autoanalyze::date as analyzed
  from pg_stat_user_tables where schemaname='spideryarn' order by pg_total_relation_size(relid) desc;
select s.relname, s.indexrelname, s.idx_scan, s.idx_tup_read, pg_size_pretty(pg_relation_size(s.indexrelid)) as size,
       i.indisunique as uniq, i.indisprimary as pk
  from pg_stat_user_indexes s join pg_index i on i.indexrelid = s.indexrelid
  where s.schemaname='spideryarn' order by s.idx_scan asc, pg_relation_size(s.indexrelid) desc;
```

```
          stats_reset          |           asked_at            
-------------------------------+-------------------------------
 2026-08-20 19:53:32.634995+00 | 2026-10-06 22:25:12.960973+00
(1 row)

           relname           | n_live_tup | n_dead_tup | seq_scan | seq_tup_read | idx_scan | n_tup_ins | n_tup_upd | n_tup_del |  total  |    heap    |  analyzed  
-----------------------------+------------+------------+----------+--------------+----------+-----------+-----------+-----------+---------+------------+------------
 revision_blocks             |     105774 |        420 |       47 |      1428020 |    23633 |    159609 |         0 |     53835 | 231 MB  | 144 MB     | 2026-10-05
 article_revisions           |        470 |         34 |      265 |        95218 |   228260 |       588 |      1357 |       118 | 100 MB  | 1016 kB    | 2026-10-05
 checkpoints                 |        594 |          0 |       12 |         3575 |      767 |       594 |       330 |         0 | 4696 kB | 176 kB     | 2026-10-02
 block_identities            |      24344 |          0 |        3 |          360 |   197740 |     24344 |         0 |         0 | 3328 kB | 1624 kB    | 2026-10-04
 feedback                    |        470 |         59 |      211 |        72335 |    31885 |       470 |       649 |         0 | 3016 kB | 512 kB     | 2026-10-06
 ai_calls                    |       2366 |          0 |      158 |       227209 |    19521 |      2363 |       139 |         0 | 1544 kB | 952 kB     | 2026-10-04
 revision_step_runs          |       4845 |         10 |      102 |        96947 |    11712 |      5906 |      1363 |      1061 | 960 kB  | 600 kB     | 2026-10-05
 revision_phrase_runs        |         49 |         17 |      512 |        21864 |     3263 |       126 |         0 |        77 | 512 kB  | 16 kB      | 2026-10-04
 chat_messages               |        200 |         66 |       66 |         5164 |     1581 |       241 |        77 |        41 | 368 kB  | 136 kB     | 2026-10-04
 jobs                        |         64 |         29 |    54448 |      2691054 |    99673 |       554 |      3666 |       490 | 280 kB  | 64 kB      | 2026-10-05
 reading_time                |       1446 |         96 |       23 |        17734 |     9650 |      1446 |      8005 |         0 | 272 kB  | 120 kB     | 2026-10-06
 search_runs                 |         45 |         18 |       32 |          839 |      579 |        56 |        48 |        11 | 208 kB  | 56 kB      | 2026-10-04
 articles                    |         62 |         24 |    31581 |       672700 |    20272 |        68 |       904 |         0 | 128 kB  | 16 kB      | 2026-10-05
 chat_threads                |         56 |         12 |      786 |        27407 |      615 |        72 |       114 |        16 | 128 kB  | 16 kB      | 2026-10-03
 comments                    |         27 |         11 |       43 |          860 |     2615 |        37 |         1 |        10 | 112 kB  | 48 kB      | 
 referee_criteria            |         10 |         10 |        6 |           20 |       85 |        10 |        10 |         0 | 96 kB   | 8192 bytes | 
 rate_limit_events           |         12 |          7 |      186 |         3186 |       82 |        66 |        66 |        54 | 96 kB   | 8192 bytes | 2026-10-03
 ingest_events               |          2 |          2 |       31 |            4 |       32 |         2 |         2 |         0 | 96 kB   | 8192 bytes | 
 referee_claims              |          4 |          4 |        6 |            7 |       22 |         4 |         4 |         0 | 88 kB   | 8192 bytes | 
 shelf_topic_sets            |          1 |          4 |        3 |            1 |      160 |         1 |        11 |         0 | 80 kB   | 8192 bytes | 
 billing_voucher_emails      |          2 |          4 |        5 |            0 |       13 |         2 |         4 |         0 | 72 kB   | 8192 bytes | 
 shelf_topic_scores          |          2 |         10 |        2 |            0 |      561 |         2 |        65 |         0 | 72 kB   | 24 kB      | 2026-10-01
 bibliographic_records       |         26 |         14 |        5 |           54 |       84 |        27 |        26 |         1 | 72 kB   | 24 kB      | 2026-10-05
 bibliographic_service_slots |          4 |          0 |        2 |            0 |      317 |         4 |        54 |         0 | 64 kB   | 8192 bytes | 2026-10-05
 reader_profiles             |          3 |         11 |     2187 |         4262 |     2777 |         3 |       101 |         0 | 64 kB   | 8192 bytes | 2026-10-05
 uploads                     |         20 |          2 |       77 |         1090 |       98 |        20 |        59 |         0 | 64 kB   | 8192 bytes | 2026-09-24
 billing_accounts            |          3 |          7 |       28 |           33 |      206 |         3 |         7 |         0 | 64 kB   | 8192 bytes | 
 billing_vouchers            |          3 |          1 |       15 |           18 |      310 |         3 |         1 |         0 | 64 kB   | 8192 bytes | 
 billing_tiers               |          2 |          4 |      182 |          358 |       12 |         2 |         4 |         0 | 64 kB   | 8192 bytes | 
 link_previews               |         14 |         13 |       16 |           13 |       70 |        14 |        13 |         0 | 64 kB   | 8192 bytes | 
 glossary_lookups            |          7 |          0 |        8 |           29 |      703 |         7 |         0 |         0 | 48 kB   | 8192 bytes | 
 article_visibility_changes  |         16 |          0 |        4 |            0 |        0 |        16 |         0 |         0 | 48 kB   | 8192 bytes | 
 realtime_sessions           |         13 |          5 |       99 |         1097 |      249 |        13 |        49 |         0 | 48 kB   | 8192 bytes | 2026-10-04
 link_summaries              |          3 |          3 |       11 |           12 |       16 |         3 |         3 |         0 | 48 kB   | 8192 bytes | 
 citation_investigations     |          4 |          0 |       15 |            5 |       96 |         4 |         0 |         0 | 48 kB   | 8192 bytes | 
 article_tags                |          6 |          0 |        8 |           18 |     3792 |         6 |         0 |         0 | 32 kB   | 8192 bytes | 
 upload_source_guesses       |          5 |          7 |       46 |          204 |     1746 |         5 |         7 |         0 | 32 kB   | 8192 bytes | 
 citation_finds              |          4 |          0 |       13 |           14 |      154 |         4 |         0 |         0 | 32 kB   | 8192 bytes | 
 bibliographic_services      |          3 |         27 |        2 |            2 |       84 |         3 |        27 |         0 | 32 kB   | 8192 bytes | 
 billing_tier_prices         |          6 |          0 |      181 |         1074 |        6 |         6 |         0 |         0 | 32 kB   | 8192 bytes | 
 queue_state                 |          1 |          0 |      492 |          490 |    11225 |         1 |         0 |         0 | 32 kB   | 8192 bytes | 
 glossary_hidden_entries     |          1 |          0 |        2 |            0 |      202 |         1 |         0 |         0 | 32 kB   | 8192 bytes | 
 raw_sources                 |         46 |          0 |        2 |            0 |     1446 |        46 |         0 |         0 | 32 kB   | 8192 bytes | 
 reader_arrivals             |          4 |          0 |        6 |           15 |      751 |         4 |         0 |         0 | 24 kB   | 8192 bytes | 
 quiz_attempts               |          0 |          0 |        3 |            0 |       16 |         0 |         0 |         0 | 24 kB   | 0 bytes    | 
 article_share_link_events   |          0 |          0 |        3 |            0 |        0 |         0 |         0 |         0 | 24 kB   | 0 bytes    | 
 citation_index_lookups      |          0 |          0 |        1 |            0 |        0 |         0 |         0 |         0 | 16 kB   | 0 bytes    | 
 feedback_shipped_emails     |          0 |          0 |       25 |            0 |        0 |         0 |         0 |         0 | 16 kB   | 0 bytes    | 
 citation_index_citers       |          0 |          0 |        2 |            0 |        0 |         0 |         0 |         0 | 16 kB   | 0 bytes    | 
(49 rows)

           relname           |                     indexrelname                      | idx_scan | idx_tup_read |    size    | uniq | pk 
-----------------------------+-------------------------------------------------------+----------+--------------+------------+------+----
 checkpoints                 | checkpoints_last_used_at                              |        0 |            0 | 40 kB      | f    | f
 article_revisions           | article_revisions_raw_sha256                          |        0 |            0 | 40 kB      | f    | f
 billing_accounts            | billing_accounts_stripe_subscription_id_unique        |        0 |            0 | 16 kB      | t    | f
 ingest_events               | ingest_events_pkey                                    |        0 |            0 | 16 kB      | t    | t
 articles                    | articles_short_id_unique                              |        0 |            0 | 16 kB      | t    | f
 chat_threads                | chat_threads_one_learn                                |        0 |            0 | 16 kB      | t    | f
 ingest_events               | ingest_events_article_id_live                         |        0 |            0 | 16 kB      | f    | f
 billing_tiers               | billing_tiers_lookup_key                              |        0 |            0 | 16 kB      | t    | f
 billing_tiers               | billing_tiers_price_id                                |        0 |            0 | 16 kB      | t    | f
 chat_threads                | chat_threads_one_tutorial                             |        0 |            0 | 16 kB      | t    | f
 uploads                     | uploads_owner_claimed_sha256                          |        0 |            0 | 16 kB      | f    | f
 article_visibility_changes  | article_visibility_changes_pkey                       |        0 |            0 | 16 kB      | t    | t
 article_visibility_changes  | article_visibility_changes_article_at                 |        0 |            0 | 16 kB      | f    | f
 articles                    | articles_share_token_unique                           |        0 |            0 | 16 kB      | t    | f
 billing_voucher_emails      | billing_voucher_emails_one_claimed                    |        0 |            0 | 8192 bytes | t    | f
 chat_threads                | chat_threads_one_explore                              |        0 |            0 | 8192 bytes | t    | f
 article_share_link_events   | article_share_link_events_pkey                        |        0 |            0 | 8192 bytes | t    | t
 quiz_attempts               | quiz_attempts_pkey                                    |        0 |            0 | 8192 bytes | t    | t
 citation_index_citers       | citation_index_citers_work_id_position_pk             |        0 |            0 | 8192 bytes | t    | t
 citation_index_lookups      | citation_index_lookups_pkey                           |        0 |            0 | 8192 bytes | t    | t
 feedback_shipped_emails     | feedback_shipped_emails_owner_id_report_id_pk         |        0 |            0 | 8192 bytes | t    | t
 ingest_events               | ingest_events_one_upgrade_in_flight                   |        0 |            0 | 8192 bytes | t    | f
 ingest_events               | ingest_events_high_power_once                         |        0 |            0 | 8192 bytes | t    | f
 article_share_link_events   | article_share_link_events_article_at                  |        0 |            0 | 8192 bytes | f    | f
 link_summaries              | link_summaries_expires_at                             |        3 |            0 | 16 kB      | f    | f
 jobs                        | jobs_ingest_event_unique                              |        4 |            2 | 16 kB      | t    | f
 billing_voucher_emails      | billing_voucher_emails_pkey                           |        6 |            6 | 16 kB      | t    | t
 billing_tier_prices         | billing_tier_prices_tier_id_currency_pk               |        6 |            0 | 16 kB      | t    | t
 ingest_events               | ingest_events_id_owner                                |        6 |            6 | 16 kB      | t    | f
 billing_accounts            | billing_accounts_stripe_customer_id_unique            |        6 |            7 | 16 kB      | t    | f
 billing_voucher_emails      | billing_voucher_emails_voucher                        |        7 |            8 | 16 kB      | f    | f
 billing_tiers               | billing_tiers_pkey                                    |       12 |           12 | 16 kB      | t    | t
 link_summaries              | link_summaries_owner_id_article_id_target_block_id_pk |       13 |            3 | 16 kB      | t    | t
 link_previews               | link_previews_expires_at                              |       13 |            0 | 16 kB      | f    | f
 billing_vouchers            | billing_vouchers_pkey                                 |       16 |           14 | 16 kB      | t    | t
 quiz_attempts               | quiz_attempts_latest                                  |       16 |            0 | 8192 bytes | f    | f
 search_runs                 | search_runs_article_id_id_pk                          |       17 |            3 | 16 kB      | t    | t
 rate_limit_events           | rate_limit_events_pkey                                |       22 |           22 | 16 kB      | t    | t
 referee_claims              | referee_claims_pkey                                   |       22 |            5 | 16 kB      | t    | t
 rate_limit_events           | rate_limit_events_owner_bucket_started                |       24 |           70 | 16 kB      | f    | f
 ingest_events               | ingest_events_owner_reserved                          |       26 |           13 | 16 kB      | f    | f
 uploads                     | uploads_owner_minted                                  |       30 |          121 | 16 kB      | f    | f
 rate_limit_events           | rate_limit_events_bucket_started                      |       36 |           41 | 16 kB      | f    | f
 jobs                        | jobs_active_source                                    |       36 |           10 | 16 kB      | t    | f
 revision_blocks             | revision_blocks_fts                                   |       45 |         7271 | 21 MB      | f    | f
 ai_calls                    | ai_calls_realtime_event                               |       54 |          330 | 16 kB      | t    | f
 link_previews               | link_previews_pkey                                    |       57 |           21 | 16 kB      | t    | t
 ai_calls                    | ai_calls_owner_started                                |       59 |        63434 | 184 kB     | f    | f
 chat_messages               | chat_messages_article_id_thread_id_id_pk              |       62 |            6 | 40 kB      | t    | t
 jobs                        | jobs_reserved_slug                                    |       62 |           16 | 16 kB      | t    | f
 chat_messages               | chat_messages_thread_ordinal                          |       63 |            6 | 40 kB      | t    | f
 uploads                     | uploads_pkey                                          |       68 |           68 | 16 kB      | t    | t
 bibliographic_records       | bibliographic_records_pkey                            |       84 |           30 | 16 kB      | t    | t
 bibliographic_services      | bibliographic_services_pkey                           |       84 |           81 | 16 kB      | t    | t
 referee_criteria            | referee_criteria_article_id_id_pk                     |       85 |           50 | 16 kB      | t    | t
 realtime_sessions           | realtime_sessions_pkey                                |       87 |           87 | 16 kB      | t    | t
 citation_investigations     | citation_investigations_article_id_entry_id_pk        |       96 |           33 | 16 kB      | t    | t
 articles                    | articles_public_listing                               |      120 |         1409 | 16 kB      | f    | f
 billing_vouchers            | billing_vouchers_unclaimed_email                      |      131 |            3 | 16 kB      | f    | f
 citation_finds              | citation_finds_article_id_entry_id_pk                 |      154 |           41 | 16 kB      | t    | t
 shelf_topic_sets            | shelf_topic_sets_pkey                                 |      160 |          148 | 16 kB      | t    | t
 realtime_sessions           | realtime_sessions_owner_issued                        |      162 |          662 | 16 kB      | f    | f
 billing_vouchers            | billing_vouchers_claimed_by                           |      163 |           28 | 16 kB      | f    | f
 feedback                    | feedback_owner_created_idx                            |      185 |         6730 | 40 kB      | f    | f
 billing_accounts            | billing_accounts_pkey                                 |      200 |          197 | 16 kB      | t    | t
 glossary_hidden_entries     | glossary_hidden_entries_article_id_entry_id_pk        |      202 |           31 | 16 kB      | t    | t
 revision_phrase_runs        | revision_phrase_runs_article                          |      250 |          375 | 16 kB      | f    | f
 chat_threads                | chat_threads_article_id_id_pk                         |      254 |          254 | 16 kB      | t    | t
 bibliographic_service_slots | bibliographic_service_slots_service_slot_pk           |      317 |          313 | 16 kB      | t    | t
 chat_threads                | chat_threads_article_updated_idx                      |      361 |          526 | 16 kB      | f    | f
 ai_calls                    | ai_calls_job                                          |      557 |         1673 | 56 kB      | f    | f
 shelf_topic_scores          | shelf_topic_scores_owner_id_scope_pk                  |      561 |          543 | 16 kB      | t    | t
 search_runs                 | search_runs_article_created_idx                       |      562 |         1030 | 16 kB      | f    | f
 glossary_lookups            | glossary_lookups_article_id_entry_id_pk               |      703 |           67 | 16 kB      | t    | t
 reader_arrivals             | reader_arrivals_pkey                                  |      751 |          749 | 16 kB      | t    | t
 checkpoints                 | checkpoints_article_id_namespace_key_pk               |      767 |         1886 | 96 kB      | t    | t
 jobs                        | jobs_draft_revision_unique                            |      851 |          230 | 16 kB      | t    | f
 raw_sources                 | raw_sources_sha256_kind_pk                            |     1446 |         1400 | 16 kB      | t    | t
 chat_messages               | chat_messages_thread_ordinal_idx                      |     1456 |         4854 | 32 kB      | f    | f
 upload_source_guesses       | upload_source_guesses_pkey                            |     1746 |          409 | 16 kB      | t    | t
 jobs                        | jobs_owner_created_idx                                |     1840 |         6847 | 16 kB      | f    | f
 jobs                        | jobs_queued_idx                                       |     1869 |         1168 | 16 kB      | f    | f
 ai_calls                    | ai_calls_pkey                                         |     2341 |            0 | 88 kB      | t    | t
 comments                    | comments_article_id_id_pk                             |     2615 |        12678 | 16 kB      | t    | t
 reader_profiles             | reader_profiles_pkey                                  |     2777 |         2747 | 16 kB      | t    | t
 revision_phrase_runs        | revision_phrase_runs_revision_id_extractor_version_pk |     3013 |         3390 | 16 kB      | t    | t
 ai_calls                    | ai_calls_scope_started                                |     3415 |        29002 | 168 kB     | f    | f
 article_tags                | article_tags_article_id_tag_pk                        |     3792 |          740 | 16 kB      | t    | t
 jobs                        | jobs_active_work                                      |     5961 |        15001 | 16 kB      | t    | f
 revision_blocks             | revision_blocks_revision_id_block_id_pk               |     7753 |        16483 | 10008 kB   | t    | t
 articles                    | articles_pkey                                         |     9054 |         9917 | 16 kB      | t    | t
 reading_time                | reading_time_article_id_block_id_pk                   |     9650 |        18838 | 112 kB     | t    | t
 articles                    | articles_slug_unique                                  |    11098 |        11213 | 16 kB      | t    | f
 queue_state                 | queue_state_pkey                                      |    11225 |        11224 | 16 kB      | t    | t
 revision_step_runs          | revision_step_runs_revision_id_step_name_pk           |    11712 |        20120 | 320 kB     | t    | t
 ai_calls                    | ai_calls_article                                      |    13095 |      1539833 | 40 kB      | f    | f
 revision_blocks             | revision_blocks_revision_ordinal                      |    15835 |      2812751 | 9736 kB    | t    | f
 jobs                        | jobs_slug_order                                       |    18717 |        31822 | 16 kB      | f    | f
 jobs                        | jobs_lease_idx                                        |    30287 |        59241 | 16 kB      | f    | f
 feedback                    | feedback_owner_id_id_pk                               |    31700 |        31399 | 56 kB      | t    | t
 jobs                        | jobs_pkey                                             |    40046 |        38656 | 16 kB      | t    | t
 article_revisions           | article_revisions_pkey                                |    82390 |        84838 | 40 kB      | t    | t
 article_revisions           | article_revisions_article_id_id                       |   145870 |       153976 | 56 kB      | t    | f
 block_identities            | block_identities_article_id_block_id_pk               |   197740 |       344726 | 1664 kB    | t    | t
(104 rows)
```

## A4. Production counts by code value

Database: **production**.

```sql
\echo == rate_limit_events by bucket
select bucket, count(*), min(started_at)::date as first, max(started_at)::date as last, count(*) filter (where lease_until is null) as no_lease from rate_limit_events group by 1 order by 1;
select count(*) as citation_find_rows from rate_limit_events where bucket = 'citation-find';
\echo == article_revisions by status / currentness
select r.status, count(*) as revisions, count(*) filter (where a.current_revision_id = r.id) as current,
       count(*) filter (where j.id is not null) as held_by_active_job
  from article_revisions r join articles a on a.id = r.article_id
  left join jobs j on j.draft_revision_id = r.id and j.status in ('queued','running')
  group by 1 order by 1;
select count(*) as articles, count(*) filter (where current_revision_id is null) as no_current, count(*) filter (where fixture) as fixtures,
       count(*) filter (where visibility='public') as public, count(*) filter (where archived_at is not null) as archived,
       count(distinct owner_id) as owners, count(*) filter (where short_id is null) as no_short_id,
       count(*) filter (where processing='minimal') as minimal, count(*) filter (where share_token is not null) as shared,
       count(*) filter (where asked_url is not null) as asked_url, count(*) filter (where updated_at is null) as no_updated_at
  from articles;
\echo == blocks per revision status
select r.status, (a.current_revision_id = r.id) as is_current, count(distinct r.id) as revisions, count(b.*) as blocks
  from article_revisions r join articles a on a.id=r.article_id left join revision_blocks b on b.revision_id = r.id group by 1,2 order by 1,2;
\echo == jobs
select status, count(*), min(created_at)::date, max(created_at)::date from jobs group by 1 order by 1;
\echo == step names in revision_step_runs
select step_name, count(*) from revision_step_runs group by 1 order by 1;
\echo == checkpoints namespaces
select namespace, count(*), min(last_used_at)::date, max(last_used_at)::date from checkpoints group by 1 order by 1;
\echo == chat_threads kinds/origin
select kind, origin_mode, count(*) from chat_threads group by 1,2 order by 1,2;
\echo == chat_messages stance/status/role
select role, status, stance, count(*), count(*) filter (where help) as help, count(*) filter (where stopped) as stopped, count(*) filter (where interrupted) as interrupted, count(*) filter (where passages is not null) as passages, count(*) filter (where tools is not null) as tools from chat_messages group by 1,2,3 order by 1,2,3;
\echo == comments
select status, count(*), count(*) filter (where thread_id is not null) as thread_id, count(*) filter (where criterion_id is not null) as criterion, count(*) filter (where colour is not null) as colour, count(*) filter (where quote is null) as whole_block from comments group by 1;
\echo == search_runs
select kind, status, count(*) from search_runs group by 1,2 order by 1,2;
\echo == uploads
select status, count(*) from uploads group by 1 order by 1;
\echo == ingest_events
select kind, count(*), count(*) filter (where succeeded_at is not null) as ok, count(*) filter (where released_at is not null) as released, count(*) filter (where superseded_by is not null) as superseded from ingest_events group by 1;
\echo == link_previews / link_summaries
select outcome, count(*) from link_previews group by 1; select status, count(*) from link_summaries group by 1;
\echo == feedback
select environment, kind, count(*), count(*) filter (where screenshot is not null) as shots, count(*) filter (where ignored_at is not null) as ignored from feedback group by 1,2 order by 1,2;
```

```
== rate_limit_events by bucket
        bucket        | count |   first    |    last    | no_lease 
----------------------+-------+------------+------------+----------
 citation-find        |     1 | 2026-09-29 | 2026-09-29 |        1
 citation-investigate |     2 | 2026-10-04 | 2026-10-05 |        2
 dig-deeper           |     1 | 2026-10-02 | 2026-10-02 |        1
 link-preview-fetch   |     1 | 2026-10-04 | 2026-10-04 |        1
 link-summary-fill    |     3 | 2026-09-12 | 2026-09-12 |        3
 shelf-topics         |     2 | 2026-10-04 | 2026-10-05 |        2
 upload-source-guess  |     2 | 2026-10-01 | 2026-10-01 |        2
(7 rows)

 citation_find_rows 
--------------------
                  1
(1 row)

== article_revisions by status / currentness
  status   | revisions | current | held_by_active_job 
-----------+-----------+---------+--------------------
 failed    |        10 |       0 |                  0
 published |       460 |      49 |                  0
(2 rows)

 articles | no_current | fixtures | public | archived | owners | no_short_id | minimal | shared | asked_url | no_updated_at 
----------+------------+----------+--------+----------+--------+-------------+---------+--------+-----------+---------------
       62 |         13 |        0 |     16 |       31 |      3 |          10 |       0 |      0 |         0 |            58
(1 row)

== blocks per revision status
  status   | is_current | revisions | blocks 
-----------+------------+-----------+--------
 failed    | f          |        10 |   4200
 published | f          |       411 |  90870
 published | t          |        49 |  10704
(3 rows)

== jobs
  status   | count |    min     |    max     
-----------+-------+------------+------------
 cancelled |     2 | 2026-09-28 | 2026-09-28
 done      |    60 | 2026-10-04 | 2026-10-05
 error     |     2 | 2026-10-03 | 2026-10-04
(3 rows)

== step names in revision_step_runs
  step_name  | count 
-------------+-------
 arc         |   340
 assets      |   449
 blocks      |   470
 citations   |    82
 crossrefs   |    56
 debate      |    73
 extract     |   470
 faq         |    76
 fetch       |   470
 glossary    |   295
 ideas       |   225
 illustrated |    78
 labels      |   276
 quiz        |    60
 quotes      |   268
 relations   |    51
 simple      |   108
 sketch      |   160
 skim        |    93
 structure   |   470
 timeline    |   104
 tweets      |   171
(22 rows)

== checkpoints namespaces
        namespace         | count |    min     |    max     
--------------------------+-------+------------+------------
 pdf-chunk                |   387 | 2026-09-02 | 2026-10-05
 structure-labels         |   170 | 2026-09-02 | 2026-10-05
 structure-whole-document |    37 | 2026-09-04 | 2026-10-05
(3 rows)

== chat_threads kinds/origin
    kind    | origin_mode | count 
------------+-------------+-------
 candidates |             |     3
 chat       |             |    44
 learn      |             |     7
 tutorial   |             |     2
(4 rows)

== chat_messages stance/status/role
   role    | status |  stance  | count | help | stopped | interrupted | passages | tools 
-----------+--------+----------+-------+------+---------+-------------+----------+-------
 assistant | done   | balanced |     3 |    0 |       0 |           0 |        0 |     1
 assistant | done   | socratic |     1 |    0 |       0 |           0 |        0 |     0
 assistant | done   |          |    95 |    0 |       2 |           6 |        8 |    20
 assistant | error  |          |     1 |    0 |       0 |           0 |        0 |     1
 user      | done   |          |   100 |   10 |       0 |           0 |        0 |     0
(5 rows)

== comments
 status | count | thread_id | criterion | colour | whole_block 
--------+-------+-----------+-----------+--------+-------------
 none   |     6 |         0 |         0 |      2 |           3
 done   |    21 |         0 |         0 |      0 |           0
(2 rows)

== search_runs
  kind   | status | count 
---------+--------+-------
 meaning | done   |    37
 quick   | done   |     8
(2 rows)

== uploads
  status  | count 
----------+-------
 claimed  |     1
 rejected |     1
 verified |    18
(3 rows)

== ingest_events
  kind  | count | ok | released | superseded 
--------+-------+----+----------+------------
 ingest |     2 |  2 |        0 |          0
(1 row)

== link_previews / link_summaries
  outcome  | count 
-----------+-------
 ok        |     6
 alias     |     1
 transient |     2
 permanent |     5
(4 rows)

 status | count 
--------+-------
 ready  |     3
(1 row)

== feedback
 environment |    kind    | count | shots | ignored 
-------------+------------+-------+-------+---------
 production  | problem    |    55 |     4 |       0
 production  | suggestion |   375 |     5 |       0
 production  |            |    40 |     1 |       0
(3 rows)
```

## A5. Production counts behind each proposed constraint

Database: **production**. 0 in a `violating` / `differ` / `missing` column means today's rows already satisfy the rule.

```sql
\echo == C1 published => four library scalars present
select count(*) filter (where status='published') as published,
       count(*) filter (where status='published' and num_nonnulls(word_count, block_count, part_count, section_count) < 4) as published_missing_scalar,
       count(*) filter (where status='published' and num_nonnulls(word_count, block_count, part_count, section_count) < 4 and exists (select 1 from articles a where a.current_revision_id = r.id)) as current_missing_scalar
  from article_revisions r;
\echo == C2 referee_claims: not done => claims empty
select count(*) as rows, count(*) filter (where status <> 'done' and jsonb_array_length(claims) > 0) as violating from referee_claims;
\echo == C3 comments.thread_id pointing at no thread
select count(*) filter (where thread_id is not null) as with_thread, count(*) filter (where thread_id is not null and not exists (select 1 from chat_threads t where t.article_id = c.article_id and t.id = c.thread_id)) as dangling from comments c;
\echo == C4 child.owner_id <> articles.owner_id (one fact stored twice)
select 'comments' as t, count(*) as rows, count(*) filter (where c.owner_id <> a.owner_id) as differ from comments c join articles a on a.id=c.article_id
union all select 'chat_threads', count(*), count(*) filter (where c.owner_id <> a.owner_id) from chat_threads c join articles a on a.id=c.article_id
union all select 'search_runs', count(*), count(*) filter (where c.owner_id <> a.owner_id) from search_runs c join articles a on a.id=c.article_id
union all select 'glossary_lookups', count(*), count(*) filter (where c.owner_id <> a.owner_id) from glossary_lookups c join articles a on a.id=c.article_id
union all select 'citation_finds', count(*), count(*) filter (where c.owner_id <> a.owner_id) from citation_finds c join articles a on a.id=c.article_id
union all select 'citation_investigations', count(*), count(*) filter (where c.owner_id <> a.owner_id) from citation_investigations c join articles a on a.id=c.article_id
union all select 'referee_criteria', count(*), count(*) filter (where c.owner_id <> a.owner_id) from referee_criteria c join articles a on a.id=c.article_id
union all select 'referee_claims', count(*), count(*) filter (where c.owner_id <> a.owner_id) from referee_claims c join articles a on a.id=c.article_id
union all select 'link_summaries', count(*), count(*) filter (where c.owner_id <> a.owner_id) from link_summaries c join articles a on a.id=c.article_id
union all select 'realtime_sessions(article_id set)', count(*), count(*) filter (where c.owner_id <> a.owner_id) from realtime_sessions c join articles a on a.id=c.article_id
union all select 'ai_calls(article_id set)', count(*), count(*) filter (where c.owner_id <> a.owner_id) from ai_calls c join articles a on a.id=c.article_id
union all select 'ingest_events(article_id set)', count(*), count(*) filter (where c.owner_id <> a.owner_id) from ingest_events c join articles a on a.id=c.article_id;
\echo == C5 visibility vs public_at
select count(*) filter (where visibility='public' and public_at is null) as public_no_date, count(*) filter (where visibility='private' and public_at is not null) as private_with_date from articles;
\echo == C6 current revision is published
select count(*) filter (where r.status <> 'published') as current_not_published, count(*) as with_current from articles a join article_revisions r on r.id = a.current_revision_id;
\echo == C6b articles with no current revision: do they have any revision, any job?
select count(*) as no_current, count(*) filter (where exists (select 1 from article_revisions r where r.article_id=a.id)) as have_revisions,
       count(*) filter (where exists (select 1 from jobs j where j.slug=a.slug)) as have_job_row,
       count(*) filter (where archived_at is not null) as archived, min(created_at)::date as oldest, max(created_at)::date as newest
  from articles a where current_revision_id is null;
\echo == C7 jobs terminal => finished_at ; C8 step runs done => finished_at
select count(*) filter (where status in ('done','error','cancelled')) as terminal, count(*) filter (where status in ('done','error','cancelled') and finished_at is null) as terminal_no_finish, count(*) filter (where started_at is null and status <> 'queued') as started_null from jobs;
select status, count(*), count(*) filter (where finished_at is null) as no_finished_at, count(*) filter (where started_at is null) as no_started_at, count(*) filter (where attempt_id is null) as no_attempt from revision_step_runs group by 1 order by 1;
\echo == C9 block_count column vs counted blocks (published revisions)
select count(*) as published_with_count, count(*) filter (where r.block_count <> (select count(*) from revision_blocks b where b.revision_id = r.id)) as differ from article_revisions r where status='published' and block_count is not null;
\echo == C10 queue_state
select count(*) as rows, count(*) filter (where running_job_id is not null) as running_job_id_set, (max(updated_at) = min(updated_at)) as updated_at_never_moved, min(updated_at)::date as updated_at from queue_state;
\echo == C13 jobs.draft_revision belongs to the article named by jobs.slug ; C14/C15 recorded slugs
select count(*) filter (where j.draft_revision_id is not null) as with_draft, count(*) filter (where j.draft_revision_id is not null and a.slug <> j.slug) as slug_differs from jobs j left join article_revisions r on r.id=j.draft_revision_id left join articles a on a.id=r.article_id;
select 'ai_calls' as t, count(*) as with_article, count(*) filter (where c.article_slug is distinct from a.slug) as slug_differs from ai_calls c join articles a on a.id=c.article_id
union all select 'realtime_sessions', count(*), count(*) filter (where c.article_slug is distinct from a.slug) from realtime_sessions c join articles a on a.id=c.article_id
union all select 'ingest_events', count(*), count(*) filter (where c.slug is distinct from a.slug) from ingest_events c join articles a on a.id=c.article_id;
\echo == code-valued columns with no CHECK: distinct values
select 'ai_calls.scope_kind' as col, scope_kind as v, count(*) from ai_calls group by 2
union all select 'ai_calls.wire', wire, count(*) from ai_calls group by 2
union all select 'ai_calls.outcome', outcome, count(*) from ai_calls group by 2
union all select 'ai_calls.cost_source', cost_source, count(*) from ai_calls group by 2
union all select 'ai_calls.provider_account', provider_account, count(*) from ai_calls group by 2
union all select 'ai_calls.event_kind', event_kind, count(*) from ai_calls group by 2
union all select 'ai_calls.failure_phase', failure_phase, count(*) from ai_calls group by 2
union all select 'jobs.failure_kind', failure_kind, count(*) from jobs group by 2
union all select 'article_revisions.source', source, count(*) from article_revisions group by 2
union all select 'article_revisions.extract_method', extract_method, count(*) from article_revisions group by 2
union all select 'article_revisions.nav_label_status', nav_label_status, count(*) from article_revisions group by 2
union all select 'article_revisions.raw_source_kind', raw_source_kind, count(*) from article_revisions group by 2
union all select 'revision_blocks.kind', kind, count(*) from revision_blocks group by 2
union all select 'revision_blocks.role', role, count(*) from revision_blocks group by 2
union all select 'revision_blocks.treatment', treatment, count(*) from revision_blocks group by 2
union all select 'revision_blocks.context_type', context_type, count(*) from revision_blocks group by 2
union all select 'referee_criteria.kind', kind, count(*) from referee_criteria group by 2
union all select 'referee_criteria.scale', scale, count(*) from referee_criteria group by 2
union all select 'citation_finds.lookup_state', lookup_state, count(*) from citation_finds group by 2
union all select 'citation_investigations.paper_state', paper_state, count(*) from citation_investigations group by 2
union all select 'citation_investigations.searches_from', searches_from, count(*) from citation_investigations group by 2
union all select 'upload_source_guesses.status', status, count(*) from upload_source_guesses group by 2
union all select 'revision_phrase_runs.skipped', skipped, count(*) from revision_phrase_runs group by 2
union all select 'bibliographic_records.state', state, count(*) from bibliographic_records group by 2
union all select 'billing_voucher_emails.kind/status', kind||'/'||status, count(*) from billing_voucher_emails group by 2
union all select 'shelf_topic_scores.scope', scope, count(*) from shelf_topic_scores group by 2
union all select 'articles.processing', processing, count(*) from articles group by 2
order by 1, 2;
\echo == revisions: stored size by currentness (sizes only)
select (a.current_revision_id = r.id) as is_current, count(*) as revisions,
       pg_size_pretty(sum(coalesce(pg_column_size(r.extracted_html),0) + coalesce(pg_column_size(r.stamped_html),0))) as html,
       pg_size_pretty(sum(coalesce(pg_column_size(r.tree),0)+coalesce(pg_column_size(r.labels),0)+coalesce(pg_column_size(r.glossary),0)+coalesce(pg_column_size(r.citations),0)+coalesce(pg_column_size(r.assets),0)+coalesce(pg_column_size(r.sketch),0)+coalesce(pg_column_size(r.illustrated),0)+coalesce(pg_column_size(r.debate),0))) as big_jsonb
  from article_revisions r join articles a on a.id = r.article_id group by 1;
select count(*) as articles_with_revisions, max(n) as max_revisions, round(avg(n),1) as avg_revisions, percentile_cont(0.5) within group (order by n) as median from (select article_id, count(*) n from article_revisions group by 1) s;
select max(n) as max_identities, round(avg(n)) as avg_identities from (select article_id, count(*) n from block_identities group by 1) s;
select count(*) as revisions_nothing_is_based_on_and_not_current from article_revisions r where status='published' and not exists (select 1 from articles a where a.current_revision_id=r.id) and not exists (select 1 from article_revisions c where c.based_on_revision_id = r.id);
\echo == article_revisions column emptiness (which columns no row fills)
select count(*) as n, count(byline) as byline, count(excerpt) as excerpt, count(note) as note, count(lang) as lang, count(site_name) as site_name, count(raw_encoding) as raw_encoding, count(raw_filename) as raw_filename, count(root_gist) as root_gist, count(arc) as arc, count(extracted_html) as extracted_html, count(stamped_html) as stamped_html, count(unverified) as unverified, count(recall) as recall, count(pages) as pages, count(title_original) as title_original, count(journal) as journal, count(published_year) as published_year, count(reading_language) as reading_rated from article_revisions;
select count(*) as blocks, count(*) filter (where gistable) as gistable, count(note) as note, count(note_id) as note_id, count(context_id) as context_id, count(level) as level from revision_blocks;
```

```
== C1 published => four library scalars present
 published | published_missing_scalar | current_missing_scalar 
-----------+--------------------------+------------------------
       460 |                        0 |                      0
(1 row)

== C2 referee_claims: not done => claims empty
 rows | violating 
------+-----------
    4 |         0
(1 row)

== C3 comments.thread_id pointing at no thread
 with_thread | dangling 
-------------+----------
           0 |        0
(1 row)

== C4 child.owner_id <> articles.owner_id (one fact stored twice)
                 t                 | rows | differ 
-----------------------------------+------+--------
 comments                          |   27 |      0
 chat_threads                      |   56 |      0
 search_runs                       |   45 |      0
 glossary_lookups                  |    7 |      0
 citation_finds                    |    4 |      0
 citation_investigations           |    4 |      0
 referee_criteria                  |   10 |      0
 referee_claims                    |    4 |      0
 link_summaries                    |    3 |      0
 realtime_sessions(article_id set) |   13 |      0
 ai_calls(article_id set)          | 2069 |      0
 ingest_events(article_id set)     |    2 |      0
(12 rows)

== C5 visibility vs public_at
 public_no_date | private_with_date 
----------------+-------------------
              0 |                 0
(1 row)

== C6 current revision is published
 current_not_published | with_current 
-----------------------+--------------
                     0 |           49
(1 row)

== C6b articles with no current revision: do they have any revision, any job?
 no_current | have_revisions | have_job_row | archived |   oldest   |   newest   
------------+----------------+--------------+----------+------------+------------
         13 |              0 |            0 |        0 | 2026-09-03 | 2026-10-01
(1 row)

== C7 jobs terminal => finished_at ; C8 step runs done => finished_at
 terminal | terminal_no_finish | started_null 
----------+--------------------+--------------
       64 |                  0 |            2
(1 row)

 status | count | no_finished_at | no_started_at | no_attempt 
--------+-------+----------------+---------------+------------
 done   |  4845 |            129 |           129 |       4194
(1 row)

== C9 block_count column vs counted blocks (published revisions)
 published_with_count | differ 
----------------------+--------
                  460 |      0
(1 row)

== C10 queue_state
 rows | running_job_id_set | updated_at_never_moved | updated_at 
------+--------------------+------------------------+------------
    1 |                  0 | t                      | 2026-08-26
(1 row)

== C13 jobs.draft_revision belongs to the article named by jobs.slug ; C14/C15 recorded slugs
 with_draft | slug_differs 
------------+--------------
          0 |            0
(1 row)

         t         | with_article | slug_differs 
-------------------+--------------+--------------
 ai_calls          |         2069 |            0
 realtime_sessions |           13 |            0
 ingest_events     |            2 |            2
(3 rows)

== code-valued columns with no CHECK: distinct values
                  col                  |             v              | count  
---------------------------------------+----------------------------+--------
 ai_calls.cost_source                  | computed                   |     59
 ai_calls.cost_source                  | none                       |    338
 ai_calls.cost_source                  | provider                   |   1968
 ai_calls.event_kind                   | backend                    |      8
 ai_calls.event_kind                   | response                   |     16
 ai_calls.event_kind                   | transcription              |     13
 ai_calls.event_kind                   | voice                      |     22
 ai_calls.event_kind                   |                            |   2306
 ai_calls.failure_phase                |                            |   2365
 ai_calls.outcome                      | aborted                    |     25
 ai_calls.outcome                      | error                      |     14
 ai_calls.outcome                      | ok                         |   2326
 ai_calls.provider_account             | openai                     |     59
 ai_calls.provider_account             | openrouter                 |   2306
 ai_calls.scope_kind                   | job_step                   |   1608
 ai_calls.scope_kind                   | request                    |    757
 ai_calls.wire                         | chat                       |   1100
 ai_calls.wire                         | decisions                  |     16
 ai_calls.wire                         | embeddings                 |    155
 ai_calls.wire                         | images                     |     45
 ai_calls.wire                         | messages                   |    689
 ai_calls.wire                         | realtime                   |     59
 ai_calls.wire                         | transcription              |    301
 article_revisions.extract_method      | openai/gpt-5.6-luna/pdf-v1 |      2
 article_revisions.extract_method      | openai/gpt-5.6-luna/pdf-v2 |     40
 article_revisions.extract_method      | openai/gpt-5.6-luna/pdf-v3 |     80
 article_revisions.extract_method      | openai/gpt-5.6-luna/pdf-v4 |    183
 article_revisions.extract_method      |                            |    165
 article_revisions.nav_label_status    | failed                     |      1
 article_revisions.nav_label_status    | pending                    |     29
 article_revisions.nav_label_status    | ready                      |    440
 article_revisions.raw_source_kind     | html                       |    146
 article_revisions.raw_source_kind     | pdf                        |    303
 article_revisions.raw_source_kind     |                            |     21
 article_revisions.source              | pdf                        |    305
 article_revisions.source              |                            |    165
 articles.processing                   | full                       |     62
 bibliographic_records.state           | found                      |     26
 billing_voucher_emails.kind/status    | gift/sent                  |      2
 citation_finds.lookup_state           | assessed                   |      1
 citation_finds.lookup_state           | not-identified             |      2
 citation_finds.lookup_state           |                            |      1
 citation_investigations.paper_state   | no-address                 |      3
 citation_investigations.paper_state   | read                       |      1
 citation_investigations.searches_from | neither                    |      1
 citation_investigations.searches_from | server_tool_use_details    |      3
 jobs.failure_kind                     | retry                      |      1
 jobs.failure_kind                     |                            |     63
 referee_criteria.kind                 | diverging                  |      6
 referee_criteria.kind                 | single                     |      4
 referee_criteria.scale                | rg                         |      6
 referee_criteria.scale                |                            |      4
 revision_blocks.context_type          |                            | 105774
 revision_blocks.kind                  | caption                    |     35
 revision_blocks.kind                  | code                       |     49
 revision_blocks.kind                  | heading                    |  14109
 revision_blocks.kind                  | media                      |   2982
 revision_blocks.kind                  | other                      |     43
 revision_blocks.kind                  | quote                      |   1285
 revision_blocks.kind                  | text                       |  87271
 revision_blocks.role                  | footnote                   |   1049
 revision_blocks.role                  |                            | 104725
 revision_blocks.treatment             | supplement                 |   1049
 revision_blocks.treatment             |                            | 104725
 revision_phrase_runs.skipped          |                            |     49
 shelf_topic_scores.scope              | active                     |      1
 shelf_topic_scores.scope              | all                        |      1
 upload_source_guesses.status          | found                      |      1
 upload_source_guesses.status          | none                       |      4
(69 rows)

== revisions: stored size by currentness (sizes only)
 is_current | revisions |  html   | big_jsonb 
------------+-----------+---------+-----------
 f          |       421 | 38 MB   | 18 MB
 t          |        49 | 4324 kB | 2327 kB
(2 rows)

 articles_with_revisions | max_revisions | avg_revisions | median 
-------------------------+---------------+---------------+--------
                      49 |            41 |           9.6 |      9
(1 row)

 max_identities | avg_identities 
----------------+----------------
           6089 |            435
(1 row)

 revisions_nothing_is_based_on_and_not_current 
-----------------------------------------------
                                             1
(1 row)

== article_revisions column emptiness (which columns no row fills)
  n  | byline | excerpt | note | lang | site_name | raw_encoding | raw_filename | root_gist | arc | extracted_html | stamped_html | unverified | recall | pages | title_original | journal | published_year | reading_rated 
-----+--------+---------+------+------+-----------+--------------+--------------+-----------+-----+----------------+--------------+------------+--------+-------+----------------+---------+----------------+---------------
 470 |    363 |     165 |    0 |  148 |        53 |          146 |          163 |       460 | 340 |            449 |          470 |          1 |    304 |   305 |              0 |      29 |             19 |             0
(1 row)

 blocks | gistable | note | note_id | context_id | level 
--------+----------+------+---------+------------+-------
 105774 |   102270 | 3504 |    1049 |          0 | 14109
(1 row)
```

## A6. Production counts: never-published articles, ids inside JSON, retired names

Database: **production**.

```sql
\echo == never-published article rows: what hangs off them (counts only)
with ghost as (select id, slug, owner_id from articles where current_revision_id is null)
select (select count(*) from ghost) as ghosts,
       (select count(*) from articles a join ghost g using (id) where a.purpose is not null) as with_purpose,
       (select count(*) from articles a join ghost g using (id) where a.title_override is not null) as with_title_override,
       (select count(*) from articles a join ghost g using (id) where a.opens > 0) as opened,
       (select count(*) from articles a join ghost g using (id) where a.short_id is null) as no_short_id,
       (select count(*) from block_identities b join ghost g on g.id=b.article_id) as identities,
       (select count(*) from checkpoints c join ghost g on g.id=c.article_id) as checkpoints,
       (select count(*) from ai_calls c join ghost g on g.id=c.article_id) as ai_calls,
       (select count(*) from ingest_events c join ghost g on g.id=c.article_id) as ingest_events,
       (select count(*) from comments c join ghost g on g.id=c.article_id) as comments,
       (select count(*) from chat_threads c join ghost g on g.id=c.article_id) as chat_threads,
       (select count(*) from upload_source_guesses c join ghost g on g.id=c.article_id) as source_guesses,
       (select count(*) from uploads u join ghost g on g.slug=u.slug) as uploads_by_slug,
       (select count(distinct owner_id) from ghost) as owners;
select date_trunc('week', created_at)::date as week, count(*) from articles where current_revision_id is null group by 1 order by 1;
\echo == ids that live inside a JSON artefact and are pointed at by rows with no foreign key
select 'glossary_lookups' as t, count(*) as rows,
       count(*) filter (where not exists (select 1 from articles a join article_revisions r on r.id=a.current_revision_id, jsonb_array_elements(coalesce(r.glossary->'entries','[]'::jsonb)) e where a.id=l.article_id and e->>'id' = l.entry_id)) as not_in_current_glossary
  from glossary_lookups l
union all select 'glossary_hidden_entries', count(*),
       count(*) filter (where not exists (select 1 from articles a join article_revisions r on r.id=a.current_revision_id, jsonb_array_elements(coalesce(r.glossary->'entries','[]'::jsonb)) e where a.id=l.article_id and e->>'id' = l.entry_id))
  from glossary_hidden_entries l;
select jsonb_typeof(citations) as citations_type, count(*) from article_revisions where citations is not null group by 1;
\echo == step runs with no time at all
select count(*) as no_times, min(r.created_at)::date as first_revision, max(r.created_at)::date as last_revision, count(distinct s.step_name) as steps
  from revision_step_runs s join article_revisions r on r.id = s.revision_id where s.started_at is null and s.finished_at is null;
select count(*) as rows_since_oct3, count(*) filter (where s.started_at is null) as no_started_at from revision_step_runs s join article_revisions r on r.id=s.revision_id where r.created_at >= '2026-10-03';
\echo == chat threads: more than one 'candidates' per article?
select kind, count(*) as threads, count(distinct article_id) as articles, max(n) as max_per_article from (select kind, article_id, count(*) over (partition by kind, article_id) n from chat_threads) s group by 1 order by 1;
\echo == tree stand-in flag kept inside JSON
select count(*) filter (where tree->>'provisional' is not null) as provisional_trees, count(*) filter (where tree is null) as no_tree, count(*) as revisions from article_revisions;
\echo == jobs.steps: is every element an object with name/status (shape the SQL in pg-jobs.ts assumes)
select count(*) as jobs, count(*) filter (where jsonb_typeof(steps) <> 'array') as not_array, count(*) filter (where exists (select 1 from jsonb_array_elements(steps) e where e->>'name' is null or e->>'status' is null)) as bad_element,
       count(*) filter (where exists (select 1 from jsonb_array_elements(steps) e where e->>'name' in ('hierarchy','toc','trajectory','remember'))) as retired_step_name from jobs;
\echo == ai_calls.step_name / purpose values carrying retired names (codes, not prose)
select count(*) filter (where step_name in ('hierarchy','toc','trajectory')) as retired_step_name, count(*) filter (where purpose ~ '(hierarchy|trajectory|remember|toc)') as purpose_with_retired_word, count(distinct purpose) as purposes, count(distinct step_name) as step_names from ai_calls;
select step_name, count(*) from ai_calls where step_name in ('hierarchy','toc','trajectory') group by 1;
select purpose, count(*), min(started_at)::date, max(started_at)::date from ai_calls where purpose ~ '(hierarchy|trajectory|remember|toc)' group by 1 order by 1;
\echo == checkpoints: keys by namespace older than 14 days (is anything swept?)
select namespace, count(*) filter (where last_used_at < now() - interval '14 days') as unused_14d, count(*) as rows, pg_size_pretty(sum(pg_column_size(value))) as value_size from checkpoints group by 1 order by 1;
\echo == feedback rows per day (the table with 31,700 primary-key scans)
select count(*) as rows, count(distinct owner_id) as owners, min(created_at)::date as first, max(created_at)::date as last, count(*) filter (where mirrored_at is null) as not_mirrored from feedback;
```

```
== never-published article rows: what hangs off them (counts only)
 ghosts | with_purpose | with_title_override | opened | no_short_id | identities | checkpoints | ai_calls | ingest_events | comments | chat_threads | source_guesses | uploads_by_slug | owners 
--------+--------------+---------------------+--------+-------------+------------+-------------+----------+---------------+----------+--------------+----------------+-----------------+--------
     13 |            0 |                   0 |      0 |           0 |       9303 |         196 |      332 |             0 |        0 |            0 |              0 |               6 |      1
(1 row)

    week    | count 
------------+-------
 2026-08-31 |     6
 2026-09-07 |     2
 2026-09-28 |     5
(3 rows)

== ids that live inside a JSON artefact and are pointed at by rows with no foreign key
            t            | rows | not_in_current_glossary 
-------------------------+------+-------------------------
 glossary_lookups        |    7 |                       1
 glossary_hidden_entries |    1 |                       1
(2 rows)

 citations_type | count 
----------------+-------
 object         |    82
(1 row)

== step runs with no time at all
 no_times | first_revision | last_revision | steps 
----------+----------------+---------------+-------
      129 | 2026-08-25     | 2026-09-12    |     8
(1 row)

 rows_since_oct3 | no_started_at 
-----------------+---------------
            1293 |             0
(1 row)

== chat threads: more than one candidates per article?
    kind    | threads | articles | max_per_article 
------------+---------+----------+-----------------
 candidates |       3 |        3 |               1
 chat       |      44 |       16 |               6
 learn      |       7 |        7 |               1
 tutorial   |       2 |        2 |               1
(4 rows)

== tree stand-in flag kept inside JSON
 provisional_trees | no_tree | revisions 
-------------------+---------+-----------
                 0 |       0 |       470
(1 row)

== jobs.steps: is every element an object with name/status (shape the SQL in pg-jobs.ts assumes)
 jobs | not_array | bad_element | retired_step_name 
------+-----------+-------------+-------------------
   64 |         0 |           0 |                 0
(1 row)

== ai_calls.step_name / purpose values carrying retired names (codes, not prose)
 retired_step_name | purpose_with_retired_word | purposes | step_names 
-------------------+---------------------------+----------+------------
               176 |                        69 |       45 |         22
(1 row)

 step_name  | count 
------------+-------
 trajectory |    16
 hierarchy  |   160
(2 rows)

  purpose   | count |    min     |    max     
------------+-------+------------+------------
 hierarchy  |    53 | 2026-08-30 | 2026-10-01
 trajectory |    16 | 2026-09-28 | 2026-10-01
(2 rows)

== checkpoints: keys by namespace older than 14 days (is anything swept?)
        namespace         | unused_14d | rows | value_size 
--------------------------+------------+------+------------
 pdf-chunk                |        269 |  387 | 3171 kB
 structure-labels         |         89 |  170 | 629 kB
 structure-whole-document |         10 |   37 | 187 kB
(3 rows)

== feedback rows per day (the table with 31,700 primary-key scans)
 rows | owners |   first    |    last    | not_mirrored 
------+--------+------------+------------+--------------
  471 |      1 | 2026-09-02 | 2026-10-06 |          292
(1 row)
```

## A7. Local EXPLAIN (ANALYZE, BUFFERS): the hot queries

Database: **local**. The run stops at Q17, which the read-only transaction refused; A8 reruns it without `FOR KEY SHARE`. Q11b could not hide an index in a read-only transaction and shows nothing new.

```sql
\pset format unaligned
\pset tuples_only on
select 'local rows: articles='||(select count(*) from articles)||' revisions='||(select count(*) from article_revisions)||' blocks='||(select count(*) from revision_blocks)||' identities='||(select count(*) from block_identities)||' jobs='||(select count(*) from jobs)||' ai_calls='||(select count(*) from ai_calls)||' chat_messages='||(select count(*) from chat_messages)||' comments='||(select count(*) from comments)||' rate_limit_events='||(select count(*) from rate_limit_events);
-- sample ids: the owner with most articles; that owner's article with the largest current revision
select owner_id as o from articles group by 1 order by count(*) desc limit 1 \gset
select a.id as aid, a.slug as slug, a.current_revision_id as rid from articles a join article_revisions r on r.id=a.current_revision_id where a.owner_id = :'o' order by r.block_count desc nulls last limit 1 \gset
select block_id as bid from revision_blocks where revision_id = :'rid' order by ordinal limit 1 \gset
select coalesce((select thread_id from chat_messages group by article_id, thread_id order by count(*) desc limit 1),'spya-xxxxxx') as tid \gset
select coalesce((select article_id::text from chat_messages group by article_id, thread_id order by count(*) desc limit 1), :'aid') as caid \gset

\echo ### Q1 article read (pg.ts currentRevisionQuery): owner + slug -> current revision
explain (analyze, buffers, costs off, timing off, summary off) select a.id, r.id from articles a join article_revisions r on r.id = a.current_revision_id where a.owner_id = :'o' and a.slug = :'slug' limit 1;
\echo ### Q2 blocks read (pg.ts blocksQuery)
explain (analyze, buffers, costs off, timing off, summary off) select block_id, tag, kind, level, words from revision_blocks where revision_id = :'rid' order by ordinal;
\echo ### Q3 library list (pg.ts listArticlesQuery, simplified to its joins and predicates)
explain (analyze, buffers, costs off, timing off, summary off) select a.id, r.id, array(select tag from article_tags t where t.article_id = a.id) from articles a join article_revisions r on r.id = a.current_revision_id where a.owner_id = :'o' and a.archived_at is null order by a.last_opened_at desc nulls last;
\echo ### Q3b the same with seqscan disabled (does any index lead on owner_id?)
set local enable_seqscan = off;
explain (costs off) select a.id from articles a where a.owner_id = :'o' and a.archived_at is null;
set local enable_seqscan = on;
\echo ### Q4 comment counts for the shelf (pg.ts commentCounts)
explain (analyze, buffers, costs off, timing off, summary off) select article_id, count(*) from comments where article_id in (select id from articles where owner_id = :'o' limit 50) group by 1;
\echo ### Q5 jobs list poll (pg-jobs.ts list)
explain (analyze, buffers, costs off, timing off, summary off) select id from jobs where owner_id = :'o' and dismissed_at is null order by created_at desc, id desc;
\echo ### Q6 jobs get by id (pg-jobs.ts get)
explain (analyze, buffers, costs off, timing off, summary off) select id from jobs where id = 'spya-aaaaaa' and owner_id = :'o' and dismissed_at is null limit 1;
\echo ### Q7 claim: running others (pg-jobs.ts claim, inside queue_state lock)
explain (analyze, buffers, costs off, timing off, summary off) select id, slug, steps from jobs where status = 'running' and id <> 'spya-aaaaaa';
\echo ### Q8 claim: predecessor scan on one slug (pg-jobs.ts blockedByAnother)
explain (analyze, buffers, costs off, timing off, summary off) select id from jobs where status in ('queued','running') and slug = :'slug' order by created_at, id;
\echo ### Q9 expired-lease sweep (pg-jobs.ts sweep)
explain (analyze, buffers, costs off, timing off, summary off) select id from jobs where status = 'running' and (lease_expires_at is null or lease_expires_at <= now());
\echo ### Q10 chat threads of an article (pg-chat.ts)
explain (analyze, buffers, costs off, timing off, summary off) select id from chat_threads where article_id = :'caid' order by updated_at desc;
\echo ### Q11 chat messages of a thread
explain (analyze, buffers, costs off, timing off, summary off) select id from chat_messages where article_id = :'caid' and thread_id = :'tid' order by ordinal;
\echo ### Q11b the same with the non-unique duplicate hidden: is the UNIQUE twin chosen instead?
explain (costs off) select id from chat_messages where article_id = :'caid' and thread_id = :'tid' order by ordinal;
\echo ### Q12 comments of an article
explain (analyze, buffers, costs off, timing off, summary off) select id from comments where article_id = :'aid' order by created_at;
\echo ### Q13 ai_calls spend by owner in a window (ai-calls-spend-pg.ts, scope filter)
explain (analyze, buffers, costs off, timing off, summary off) select owner_id, sum(credits_used_nanos) from ai_calls where started_at >= now() - interval '30 days' and scope_kind in ('request','job_step') group by 1;
\echo ### Q13b ai_calls window only (the admin grouped report)
explain (analyze, buffers, costs off, timing off, summary off) select owner_id, scope_kind, purpose, step_name, count(*) from ai_calls where started_at >= now() - interval '30 days' group by 1,2,3,4;
\echo ### Q14 ai_calls for one article (belongsTo)
explain (analyze, buffers, costs off, timing off, summary off) select scope_kind, count(*) from ai_calls where article_id = :'aid' or (article_id is null and owner_id = :'o' and article_slug = :'slug' and started_at >= now() - interval '90 days') group by 1;
\echo ### Q15 rate limit counts (pg-rate-limit.ts)
explain (analyze, buffers, costs off, timing off, summary off) select count(*) filter (where started_at > now() - interval '1 hour'), count(*) filter (where lease_until > now()) from rate_limit_events where owner_id = :'o' and bucket = 'dig-deeper';
\echo ### Q16 rate limit global fuse
explain (analyze, buffers, costs off, timing off, summary off) select count(*) from rate_limit_events where bucket = 'dig-deeper' and started_at > now() - interval '1 day';
\echo ### Q17 the RI check Postgres runs for revision_blocks_identity_fk when a block_identities row is deleted (article delete)
explain (analyze, buffers, costs off, timing off, summary off) select 1 from only revision_blocks x where article_id = :'aid' and block_id = :'bid' for key share of x;
\echo ### Q17b same, seqscan off: what is the best index available?
set local enable_seqscan = off;
explain (costs off) select 1 from only revision_blocks x where article_id = :'aid' and block_id = :'bid' for key share of x;
set local enable_seqscan = on;
\echo ### Q18 RI set-null checks on article delete that have no index: realtime_sessions.article_id
explain (costs off) select 1 from realtime_sessions where article_id = :'aid';
\echo ### Q19 RI set-null on revision delete: article_revisions.based_on_revision_id
explain (analyze, buffers, costs off, timing off, summary off) select 1 from article_revisions where based_on_revision_id = :'rid';
\echo ### Q20 public shelf listing
explain (analyze, buffers, costs off, timing off, summary off) select slug from articles where visibility = 'public' order by public_at desc nulls last, slug asc limit 50;
\echo ### Q21 full-text search in one revision
explain (analyze, buffers, costs off, timing off, summary off) select block_id from revision_blocks where revision_id = :'rid' and fts @@ websearch_to_tsquery('english','the');
```

```
local rows: articles=212 revisions=1340 blocks=232489 identities=32074 jobs=90 ai_calls=13581 chat_messages=194 comments=68 rate_limit_events=50
### Q1 article read (pg.ts currentRevisionQuery): owner + slug -> current revision
Limit (actual rows=1 loops=1)
  Buffers: shared hit=7
  ->  Nested Loop (actual rows=1 loops=1)
        Buffers: shared hit=7
        ->  Index Scan using articles_slug_unique on articles a (actual rows=1 loops=1)
              Index Cond: (slug = '<id>'::text)
              Filter: (owner_id = '<uuid>'::uuid)
              Buffers: shared hit=3
        ->  Index Only Scan using article_revisions_pkey on article_revisions r (actual rows=1 loops=1)
              Index Cond: (id = a.current_revision_id)
              Heap Fetches: 1
              Buffers: shared hit=4
Planning:
  Buffers: shared hit=6
### Q2 blocks read (pg.ts blocksQuery)
Sort (actual rows=3053 loops=1)
  Sort Key: ordinal
  Sort Method: quicksort  Memory: 242kB
  Buffers: shared hit=29 read=374
  ->  Bitmap Heap Scan on revision_blocks (actual rows=3053 loops=1)
        Recheck Cond: (revision_id = '<uuid>'::uuid)
        Heap Blocks: exact=375
        Buffers: shared hit=29 read=374
        ->  Bitmap Index Scan on revision_blocks_revision_ordinal (actual rows=3053 loops=1)
              Index Cond: (revision_id = '<uuid>'::uuid)
              Buffers: shared hit=28
Planning:
  Buffers: shared hit=12
### Q3 library list (pg.ts listArticlesQuery, simplified to its joins and predicates)
Sort (actual rows=119 loops=1)
  Sort Key: a.last_opened_at DESC NULLS LAST
  Sort Method: quicksort  Memory: 33kB
  Buffers: shared hit=421
  ->  Nested Loop (actual rows=119 loops=1)
        Buffers: shared hit=418
        ->  Seq Scan on articles a (actual rows=181 loops=1)
              Filter: ((archived_at IS NULL) AND (owner_id = '<uuid>'::uuid))
              Rows Removed by Filter: 31
              Buffers: shared hit=25
        ->  Memoize (actual rows=1 loops=181)
              Cache Key: a.current_revision_id
              Cache Mode: logical
              Hits: 61  Misses: 120  Evictions: 0  Overflows: 0  Memory Usage: 15kB
              Buffers: shared hit=270
              ->  Index Only Scan using article_revisions_pkey on article_revisions r (actual rows=1 loops=120)
                    Index Cond: (id = a.current_revision_id)
                    Heap Fetches: 31
                    Buffers: shared hit=270
        SubPlan 1
          ->  Bitmap Heap Scan on article_tags t (actual rows=0 loops=119)
                Recheck Cond: (article_id = a.id)
                Heap Blocks: exact=4
                Buffers: shared hit=123
                ->  Bitmap Index Scan on article_tags_article_id_tag_pk (actual rows=0 loops=119)
                      Index Cond: (article_id = a.id)
                      Buffers: shared hit=119
Planning:
  Buffers: shared hit=50
### Q3b the same with seqscan disabled (does any index lead on owner_id?)
Seq Scan on articles a
  Filter: ((archived_at IS NULL) AND (owner_id = '<uuid>'::uuid))
### Q4 comment counts for the shelf (pg.ts commentCounts)
HashAggregate (actual rows=4 loops=1)
  Group Key: comments.article_id
  Batches: 1  Memory Usage: 24kB
  Buffers: shared hit=15
  ->  Hash Semi Join (actual rows=15 loops=1)
        Hash Cond: (comments.article_id = articles.id)
        Buffers: shared hit=15
        ->  Seq Scan on comments (actual rows=68 loops=1)
              Buffers: shared hit=12
        ->  Hash (actual rows=50 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 11kB
              Buffers: shared hit=3
              ->  Limit (actual rows=50 loops=1)
                    Buffers: shared hit=3
                    ->  Seq Scan on articles (actual rows=50 loops=1)
                          Filter: (owner_id = '<uuid>'::uuid)
                          Rows Removed by Filter: 6
                          Buffers: shared hit=3
Planning:
  Buffers: shared hit=23
### Q5 jobs list poll (pg-jobs.ts list)
Sort (actual rows=50 loops=1)
  Sort Key: created_at DESC, id DESC
  Sort Method: quicksort  Memory: 26kB
  Buffers: shared hit=45
  ->  Seq Scan on jobs (actual rows=50 loops=1)
        Filter: ((dismissed_at IS NULL) AND (owner_id = '<uuid>'::uuid))
        Rows Removed by Filter: 40
        Buffers: shared hit=42
Planning:
  Buffers: shared hit=11
### Q6 jobs get by id (pg-jobs.ts get)
Limit (actual rows=0 loops=1)
  Buffers: shared hit=2
  ->  Index Scan using jobs_pkey on jobs (actual rows=0 loops=1)
        Index Cond: (id = '<id>'::text)
        Filter: ((dismissed_at IS NULL) AND (owner_id = '<uuid>'::uuid))
        Buffers: shared hit=2
### Q7 claim: running others (pg-jobs.ts claim, inside queue_state lock)
Index Scan using jobs_lease_idx on jobs (actual rows=0 loops=1)
  Filter: (id <> '<id>'::text)
  Buffers: shared hit=1
Planning:
  Buffers: shared hit=17
### Q8 claim: predecessor scan on one slug (pg-jobs.ts blockedByAnother)
Index Only Scan using jobs_slug_order on jobs (actual rows=0 loops=1)
  Index Cond: (slug = '<id>'::text)
  Heap Fetches: 0
  Buffers: shared hit=2
Planning:
  Buffers: shared hit=5
### Q9 expired-lease sweep (pg-jobs.ts sweep)
Index Scan using jobs_lease_idx on jobs (actual rows=0 loops=1)
  Filter: ((lease_expires_at IS NULL) OR (lease_expires_at <= now()))
  Buffers: shared hit=1
Planning:
  Buffers: shared hit=3
### Q10 chat threads of an article (pg-chat.ts)
Sort (actual rows=4 loops=1)
  Sort Key: updated_at DESC
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=2
  ->  Seq Scan on chat_threads (actual rows=4 loops=1)
        Filter: (article_id = '<uuid>'::uuid)
        Rows Removed by Filter: 72
        Buffers: shared hit=2
Planning:
  Buffers: shared hit=89
### Q11 chat messages of a thread
Index Scan using chat_messages_thread_ordinal_idx on chat_messages (actual rows=12 loops=1)
  Index Cond: ((article_id = '<uuid>'::uuid) AND (thread_id = '<id>'::text))
  Buffers: shared hit=8 read=1
Planning:
  Buffers: shared hit=6
### Q11b the same with the non-unique duplicate hidden: is the UNIQUE twin chosen instead?
Index Scan using chat_messages_thread_ordinal_idx on chat_messages
  Index Cond: ((article_id = '<uuid>'::uuid) AND (thread_id = '<id>'::text))
### Q12 comments of an article
Sort (actual rows=0 loops=1)
  Sort Key: created_at
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=1 read=1
  ->  Index Scan using comments_article_id_id_pk on comments (actual rows=0 loops=1)
        Index Cond: (article_id = '<uuid>'::uuid)
        Buffers: shared hit=1 read=1
Planning:
  Buffers: shared hit=6
### Q13 ai_calls spend by owner in a window (ai-calls-spend-pg.ts, scope filter)
HashAggregate (actual rows=3 loops=1)
  Group Key: owner_id
  Batches: 1  Memory Usage: 24kB
  Buffers: shared hit=321 read=2
  ->  Bitmap Heap Scan on ai_calls (actual rows=2703 loops=1)
        Recheck Cond: ((scope_kind = ANY ('{request,job_step}'::text[])) AND (started_at >= (now() - '30 days'::interval)))
        Heap Blocks: exact=297
        Buffers: shared hit=321 read=2
        ->  Bitmap Index Scan on ai_calls_scope_started (actual rows=2730 loops=1)
              Index Cond: ((scope_kind = ANY ('{request,job_step}'::text[])) AND (started_at >= (now() - '30 days'::interval)))
              Buffers: shared hit=24 read=2
Planning:
  Buffers: shared hit=19
### Q13b ai_calls window only (the admin grouped report)
HashAggregate (actual rows=101 loops=1)
  Group Key: owner_id, scope_kind, purpose, step_name
  Batches: 1  Memory Usage: 81kB
  Buffers: shared hit=543
  ->  Seq Scan on ai_calls (actual rows=12365 loops=1)
        Filter: (started_at >= (now() - '30 days'::interval))
        Rows Removed by Filter: 1216
        Buffers: shared hit=543
Planning:
  Buffers: shared hit=17
### Q14 ai_calls for one article (belongsTo)
HashAggregate (actual rows=2 loops=1)
  Group Key: scope_kind
  Batches: 1  Memory Usage: 24kB
  Buffers: shared hit=543
  ->  Seq Scan on ai_calls (actual rows=429 loops=1)
        Filter: ((article_id = '<uuid>'::uuid) OR ((article_id IS NULL) AND (owner_id = '<uuid>'::uuid) AND (article_slug = '<id>'::text) AND (started_at >= (now() - '90 days'::interval))))
        Rows Removed by Filter: 13152
        Buffers: shared hit=543
Planning:
  Buffers: shared hit=7
### Q15 rate limit counts (pg-rate-limit.ts)
Aggregate (actual rows=1 loops=1)
  Buffers: shared hit=1
  ->  Seq Scan on rate_limit_events (actual rows=5 loops=1)
        Filter: ((owner_id = '<uuid>'::uuid) AND (bucket = 'dig-deeper'::text))
        Rows Removed by Filter: 45
        Buffers: shared hit=1
Planning:
  Buffers: shared hit=6
### Q16 rate limit global fuse
Aggregate (actual rows=1 loops=1)
  Buffers: shared hit=1
  ->  Seq Scan on rate_limit_events (actual rows=0 loops=1)
        Filter: ((bucket = 'dig-deeper'::text) AND (started_at > (now() - '1 day'::interval)))
        Rows Removed by Filter: 50
        Buffers: shared hit=1
### Q17 the RI check Postgres runs for revision_blocks_identity_fk when a block_identities row is deleted (article delete)
psql:<stdin>:53: ERROR:  cannot execute SELECT FOR KEY SHARE in a read-only transaction
```

## A8. Local EXPLAIN: foreign-key lookups and the never-scanned indexes

Database: **local**.

```sql
\pset format unaligned
\pset tuples_only on
select owner_id as o from articles group by 1 order by count(*) desc limit 1 \gset
select a.id as aid, a.slug as slug, a.current_revision_id as rid from articles a join article_revisions r on r.id=a.current_revision_id where a.owner_id = :'o' order by r.block_count desc nulls last limit 1 \gset
select block_id as bid from revision_blocks where revision_id = :'rid' order by ordinal limit 1 \gset
\echo ### Q17 the lookup Postgres runs for revision_blocks_identity_fk when one block_identities row is deleted (FOR KEY SHARE dropped: read-only transaction)
explain (analyze, buffers, costs off, timing on, summary on) select 1 from only revision_blocks x where article_id = :'aid' and block_id = :'bid';
\echo ### Q17b same, seqscan off: the best index available
set local enable_seqscan = off;
explain (analyze, buffers, costs off, timing on, summary on) select 1 from only revision_blocks x where article_id = :'aid' and block_id = :'bid';
set local enable_seqscan = on;
\echo ### Q17c how many identity rows one article delete would check
select 'identities of the sample article: '||count(*) from block_identities where article_id = :'aid';
\echo ### Q18 RI set-null on article delete with no index: realtime_sessions.article_id
explain (costs off) select 1 from realtime_sessions where article_id = :'aid';
\echo ### Q19 RI set-null on revision delete: article_revisions.based_on_revision_id
explain (analyze, buffers, costs off, timing on, summary on) select 1 from article_revisions where based_on_revision_id = :'rid';
\echo ### Q19b RI check on uploads delete: jobs.upload_id ; on ingest_events delete: ingest_events.superseded_by
explain (costs off) select 1 from jobs where upload_id = '00000000-0000-0000-0000-000000000000';
explain (costs off) select 1 from ingest_events where superseded_by = '00000000-0000-0000-0000-000000000000';
\echo ### Q20 public shelf listing
explain (analyze, buffers, costs off, timing off, summary off) select slug from articles where visibility = 'public' order by public_at desc nulls last, slug asc limit 50;
\echo ### Q21 full-text search in one revision
explain (analyze, buffers, costs off, timing off, summary off) select block_id from revision_blocks where revision_id = :'rid' and fts @@ websearch_to_tsquery('english','the');
\echo ### Q22 revision by raw_sha256 (article_revisions_raw_sha256: 0 scans in production)
explain (costs off) select article_id from article_revisions where raw_sha256 = 'x' and article_id = :'aid';
\echo ### Q23 checkpoints sweep by last_used_at (0 scans in production)
explain (costs off) select 1 from checkpoints where last_used_at < now() - interval '30 days';
\echo ### Q24 local idx_scan for the indexes production never scanned
select indexrelname||' '||idx_scan from pg_stat_user_indexes where schemaname='spideryarn' and indexrelname in ('checkpoints_last_used_at','article_revisions_raw_sha256','uploads_owner_claimed_sha256','ingest_events_article_id_live','article_visibility_changes_article_at','article_share_link_events_article_at','chat_messages_thread_ordinal','chat_messages_thread_ordinal_idx','articles_short_id_unique') order by 1;
```

```
### Q17 the lookup Postgres runs for revision_blocks_identity_fk when one block_identities row is deleted (FOR KEY SHARE dropped: read-only transaction)
Index Scan using revision_blocks_revision_id_block_id_pk on revision_blocks x (actual time=74.131..397.862 rows=12 loops=1)
  Index Cond: (block_id = '<id>'::text)
  Filter: (article_id = '<uuid>'::uuid)
  Buffers: shared hit=6 read=2141
Planning:
  Buffers: shared hit=6
Planning Time: 0.182 ms
Execution Time: 397.925 ms
### Q17b same, seqscan off: the best index available
Index Scan using revision_blocks_revision_id_block_id_pk on revision_blocks x (actual time=2.631..23.768 rows=12 loops=1)
  Index Cond: (block_id = '<id>'::text)
  Filter: (article_id = '<uuid>'::uuid)
  Buffers: shared hit=2147
Planning Time: 0.118 ms
Execution Time: 23.837 ms
### Q17c how many identity rows one article delete would check
identities of the sample article: 3053
### Q18 RI set-null on article delete with no index: realtime_sessions.article_id
Seq Scan on realtime_sessions
  Filter: (article_id = '<uuid>'::uuid)
### Q19 RI set-null on revision delete: article_revisions.based_on_revision_id
Seq Scan on article_revisions (actual time=1.505..1.645 rows=3 loops=1)
  Filter: (based_on_revision_id = '<uuid>'::uuid)
  Rows Removed by Filter: 1337
  Buffers: shared hit=242
Planning:
  Buffers: shared hit=6
Planning Time: 0.167 ms
Execution Time: 1.677 ms
### Q19b RI check on uploads delete: jobs.upload_id ; on ingest_events delete: ingest_events.superseded_by
Seq Scan on jobs
  Filter: (upload_id = '<uuid>'::uuid)
Seq Scan on ingest_events
  Filter: (superseded_by = '<uuid>'::uuid)
### Q20 public shelf listing
Limit (actual rows=13 loops=1)
  Buffers: shared hit=12
  ->  Index Only Scan using articles_public_listing on articles (actual rows=13 loops=1)
        Heap Fetches: 11
        Buffers: shared hit=12
Planning:
  Buffers: shared hit=22
### Q21 full-text search in one revision
psql:<stdin>:25: NOTICE:  text-search query contains only stop words or doesn't contain lexemes, ignored
Bitmap Heap Scan on revision_blocks (actual rows=0 loops=1)
  Recheck Cond: (fts @@ ''::tsquery)
  Filter: (revision_id = '<uuid>'::uuid)
  ->  Bitmap Index Scan on revision_blocks_fts (actual rows=0 loops=1)
        Index Cond: (fts @@ ''::tsquery)
Planning:
  Buffers: shared hit=32 read=6
### Q22 revision by raw_sha256 (article_revisions_raw_sha256: 0 scans in production)
Index Only Scan using article_revisions_raw_sha256 on article_revisions
  Index Cond: ((raw_sha256 = 'x'::text) AND (article_id = '<uuid>'::uuid))
### Q23 checkpoints sweep by last_used_at (0 scans in production)
Seq Scan on checkpoints
  Filter: (last_used_at < (now() - '30 days'::interval))
### Q24 local idx_scan for the indexes production never scanned
article_revisions_raw_sha256 13
article_share_link_events_article_at 0
article_visibility_changes_article_at 0
articles_short_id_unique 2429
chat_messages_thread_ordinal 1659
chat_messages_thread_ordinal_idx 272936
checkpoints_last_used_at 1074
ingest_events_article_id_live 0
uploads_owner_claimed_sha256 1272
```

## A9. Local counts, for comparison

Database: **local**.

```sql
select count(*) filter (where status='published') as published, count(*) filter (where status='published' and num_nonnulls(word_count, block_count, part_count, section_count) < 4) as published_missing_scalar from article_revisions;
select count(*) as articles, count(*) filter (where current_revision_id is null) as never_published from articles;
select count(*) as rows, count(*) filter (where status <> 'done' and jsonb_array_length(claims) > 0) as violating from referee_claims;
select count(*) as citation_find_rows from rate_limit_events where bucket = 'citation-find';
select relname, n_tup_del from pg_stat_user_tables where schemaname='spideryarn' and relname in ('articles','block_identities');
```

```
 published | published_missing_scalar 
-----------+--------------------------
       930 |                        0
(1 row)

 articles | never_published 
----------+-----------------
      212 |              77
(1 row)

 rows | violating 
------+-----------
    2 |         0
(1 row)

 citation_find_rows 
--------------------
                  3
(1 row)

     relname      | n_tup_del 
------------------+-----------
 articles         |    100324
 block_identities |    626932
(2 rows)
```

## A10. Local counts: the legacy block kind, stored upload expiry

Database: **local**.

```sql
select count(*) filter (where kind = 'callout') as callout_kind_rows, count(*) filter (where context_id is not null) as with_context, count(*) as blocks from revision_blocks;
select count(*) filter (where status = 'expired') as expired_uploads, count(*) as uploads from uploads;
```

```
 callout_kind_rows | with_context | blocks 
-------------------+--------------+--------
                 0 |            0 | 232489
(1 row)

 expired_uploads | uploads 
-----------------+---------
               1 |     192
(1 row)
```

## A11. Column mentions outside `schema.ts`

Not SQL. For each of the 662 columns, word-boundary occurrences of the camelCase property and the snake_case name in `src/`, `scripts/`, `tools/`, `evals/` (code) and in tests, excluding `src/db/schema.ts`. Columns with six or fewer code mentions:

```
662 columns
article_visibility_changes.actor_owner_id                   camel=actorOwnerId                 code:3+1 tests:14
article_visibility_changes.from_visibility                  camel=fromVisibility               code:1+0 tests:7
article_visibility_changes.to_visibility                    camel=toVisibility                 code:4+0 tests:7
article_share_link_events.actor_owner_id                   camel=actorOwnerId                 code:3+1 tests:14
block_identities.first_seen_at                    camel=firstSeenAt                  code:3+0 tests:4
referee_criteria.colour_at                        camel=colourAt                     code:3+3 tests:25
comments.colour_at                        camel=colourAt                     code:3+3 tests:25
uploads.claimed_bytes                    camel=claimedBytes                 code:6+0 tests:13
jobs.cancel_requested_at              camel=cancelRequestedAt            code:1+0 tests:9
jobs.upload_filename                  camel=uploadFilename               code:5+0 tests:1
queue_state.running_job_id                   camel=runningJobId                 code:0+0 tests:0
chat_threads.renamed_at                       camel=renamedAt                    code:1+1 tests:7
chat_threads.origin_item_id                   camel=originItemId                 code:4+0 tests:13
chat_threads.origin_block_id                  camel=originBlockId                code:4+0 tests:17
chat_threads.origin_quote                     camel=originQuote                  code:5+0 tests:20
chat_threads.origin_lens                      camel=originLens                   code:4+0 tests:16
search_runs.colour_at                        camel=colourAt                     code:3+3 tests:25
citation_finds.found_at                         camel=foundAt                      code:5+0 tests:9
citation_finds.lookup_support                   camel=lookupSupport                code:6+0 tests:1
reader_arrivals.first_seen_at                    camel=firstSeenAt                  code:3+0 tests:4
billing_accounts.last_synced_at                   camel=lastSyncedAt                 code:1+1 tests:3
bibliographic_records.authors_family                   camel=authorsFamily                code:0+4 tests:4
bibliographic_records.authors_given                    camel=authorsGiven                 code:0+4 tests:4
bibliographic_records.published_day                    camel=publishedDay                 code:0+5 tests:2
bibliographic_services.next_start_at                    camel=nextStartAt                  code:0+6 tests:5
bibliographic_services.cooldown_until                   camel=cooldownUntil                code:0+6 tests:4
```

`queue_state.running_job_id` is the only column with none. The rest are event times and audit columns that are written once and read by an export or not at all, which is the house rule for timestamps.

The eight `owner_id` columns of DBO5 cannot be found this way (the name is everywhere). The check was this, per store file, showing every non-comment line that names the column:

```
grep -nE "ownerId|owner_id" src/store/pg-comments.ts src/store/pg-chat.ts src/store/pg-searches.ts \
  src/store/pg-glossary.ts src/store/pg-lookups.ts src/store/pg-citation-finds.ts \
  src/store/pg-citation-investigations.ts src/store/pg-referee-criteria.ts src/store/pg-referee-claims.ts

pg-comments.ts:229                 .values({ articleId, id, ownerId: currentOwnerId(), ...fields })
pg-chat.ts:325                     ownerId: currentOwnerId(),
pg-searches.ts:272                 ownerId: currentOwnerId(),
pg-lookups.ts:88, :167             ownerId: currentOwnerId(),
pg-citation-finds.ts:47            .values({ articleId, entryId, ownerId: currentOwnerId(), ...values })
pg-citation-investigations.ts:33   .values({ articleId, entryId, ownerId: currentOwnerId(), ...values })
pg-referee-criteria.ts:226         ownerId: currentOwnerId(),
pg-referee-claims.ts:210, :220     ownerId: currentOwnerId(),
```

Nine inserts, no read. `grep -rnE "\b(commentsTable|comments|chatThreads|searchRuns|glossaryLookups|citationFinds|citationInvestigations|refereeCriteria|refereeClaims)\.ownerId" src` outside `schema.ts` and tests: 0.

## A12. The last 40 migrations, by statement kind

Not SQL run against a database: a count of the statements in each file.

```
20261001211225_bulk_import_minimal.sql                         4 ADD COLUMN; 5 ADD CONSTRAINT; 2 CREATE INDEX; 1 CREATE OR REPLACE FUNCTION; 1 CREATE TRIGGER; 1 CREATE UNIQUE INDEX; 2 DROP CONSTRAINT
20261001224759_skim.sql                                        1 ADD CONSTRAINT; 2 DO $$; 1 DROP CONSTRAINT; 1 RENAME COLUMN; 3 UPDATE
20261002012754_billing_voucher_recipient_note.sql              1 ADD COLUMN; 1 ADD CONSTRAINT
20261002100053_job_dismissed_at.sql                            1 ADD COLUMN
20261002134525_glossary_hidden_entries.sql                     1 ADD CONSTRAINT; 1 CREATE TABLE
20261002140803_structure_step.sql                              2 ADD CONSTRAINT; 2 DO $$; 2 DROP CONSTRAINT; 4 UPDATE
20261002153556_search_runs_kind.sql                            1 ADD COLUMN; 1 ADD CONSTRAINT
20261002170242_glossary_lookups_added_name.sql                 1 ADD COLUMN; 1 ADD CONSTRAINT
20261002171041_feedback_shipped_emails.sql                     1 ADD CONSTRAINT; 1 CREATE TABLE
20261002215335_feedback_notice_bucket.sql                      1 ADD CONSTRAINT; 1 DROP CONSTRAINT
20261002232057_tutorial_thread_kind.sql                        1 ADD CONSTRAINT; 1 CREATE UNIQUE INDEX; 1 DROP CONSTRAINT
20261002232435_jobs_illustration_note.sql                      1 ADD COLUMN
20261003035927_article_tags.sql                                1 ADD CONSTRAINT; 1 CREATE TABLE
20261003050050_comments_colour.sql                             1 ADD COLUMN; 2 ADD CONSTRAINT
20261003103702_relations.sql                                   1 ADD COLUMN; 1 ADD CONSTRAINT; 1 DROP CONSTRAINT
20261003125044_referee_claims_attempt.sql                      1 ADD COLUMN
20261003141355_feedback_ignored_at.sql                         1 ADD COLUMN
20261003144630_gpt_live_sessions_and_usage.sql                 4 ADD COLUMN; 3 ADD CONSTRAINT; 1 DROP CONSTRAINT
20261003161906_shelf_topic_sets.sql                            1 CREATE TABLE
20261003162711_feedback_screenshot_size_two_megabytes.sql      1 ADD CONSTRAINT; 1 DROP CONSTRAINT
20261003170347_store_when_it_happened.sql                      17 ADD COLUMN; 5 ALTER COLUMN
20261003184359_explore_thread_kind.sql                         1 ADD CONSTRAINT; 1 CREATE UNIQUE INDEX; 1 DROP CONSTRAINT
20261003202922_citation_investigation_influence.sql            5 ADD COLUMN; 2 ADD CONSTRAINT
20261003235102_article_journal_and_registry_published_day.sql  2 ADD COLUMN; 1 ADD CONSTRAINT
20261004001803_registry_published_day_only_on_found.sql        1 ADD CONSTRAINT; 1 DROP CONSTRAINT
20261004135541_reader_auto_modes_off_at.sql                    1 ADD COLUMN
20261004152851_chat_message_hint_opened_at.sql                 1 ADD COLUMN; 1 ADD CONSTRAINT
20261004164715_citation_index_and_openalex_service.sql         2 ADD CONSTRAINT; 2 CREATE TABLE; 1 DROP CONSTRAINT; 2 INSERT INTO
20261004165444_article_published_year.sql                      1 ADD COLUMN; 2 ADD CONSTRAINT
20261005032955_quiz_attempts.sql                               1 ADD CONSTRAINT; 1 CREATE INDEX; 1 CREATE TABLE
20261005105117_article_title_original.sql                      1 ADD COLUMN
20261005151925_bibliographic_records_cited_by_count.sql        2 ADD COLUMN; 2 ADD CONSTRAINT
20261005181010_chat_thread_origin.sql                          4 ADD COLUMN; 5 ADD CONSTRAINT
20261005184047_article_share_link.sql                          2 ADD COLUMN; 4 ADD CONSTRAINT; 1 CREATE INDEX; 1 CREATE TABLE
20261005200628_reading_difficulty.sql                          5 ADD COLUMN; 3 ADD CONSTRAINT
20261005203554_chat_thread_origin_lens.sql                     1 ADD COLUMN; 3 ADD CONSTRAINT; 2 DROP CONSTRAINT
20261006014116_ai_calls_attempt_and_failure.sql                4 ADD COLUMN; 1 ADD CONSTRAINT
20261006035355_rename_remember_thread_kind_to_learn.sql        1 ADD CONSTRAINT; 1 CREATE UNIQUE INDEX; 1 DROP CONSTRAINT; 1 DROP INDEX; 1 UPDATE
20261006042012_chat_thread_origin_item.sql                     1 ADD CONSTRAINT
20261006144348_articles_asked_url.sql                          1 ADD COLUMN

total over the 40: 64 ADD COLUMN; 54 ADD CONSTRAINT; 5 ALTER COLUMN; 4 CREATE INDEX; 1 CREATE OR REPLACE FUNCTION; 8 CREATE TABLE; 1 CREATE TRIGGER; 4 CREATE UNIQUE INDEX; 4 DO $$; 16 DROP CONSTRAINT; 1 DROP INDEX; 2 INSERT INTO; 1 RENAME COLUMN; 8 UPDATE
files with a DROP CONSTRAINT: 13
files with a DROP COLUMN / DROP TABLE / DELETE: 0
```
