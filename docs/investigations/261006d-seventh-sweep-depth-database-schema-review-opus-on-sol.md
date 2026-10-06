# Cross-family review: Opus on GPT Sol's database-schema investigation (2026-10-06)

Brief: [cross-review](261006d-seventh-sweep-depth-prompt-cross-review.md). Reviewed:
[THEIRS, GPT Sol](261006d-seventh-sweep-depth-database-schema-sol.md). Compared with:
[YOURS, Opus](261006d-seventh-sweep-depth-database-schema-opus.md). Umbrella:
[261006m](../plans/261006m-seventh-codebase-sweep-depth-umbrella.md).

Sol had no database. I did, so every query Sol wrote for the orchestrator was run here, and DB1 was
reproduced by a test. Checkout `bf78e90c7`. No tracked file changed; the two probe files I made were
deleted after the run.

**The short version.** Sol's main finding, DB1, is real and now reproduced: on an article with twenty
finished criteria where the oldest has a reader note, adding a twenty-first fails and goes on
failing. Production has no such article today (most criteria on one article: 4; notes on a
criterion: 0). DB3 and DB4 are true and cheap. DB5's index would not be used by the planner at
today's data, so it should not be built. Four additive changes from the two documents can go in one
migration; a fifth (Opus's DBO8) is safe for the data but breaks about 29 test fixtures, which
neither document noticed.

## How the databases were asked

The method is the Opus appendix's, reused.

- **Local**: `docker exec -i supabase_db_spideryarn2 psql -U postgres`, input wrapped in
  `BEGIN READ ONLY; SET LOCAL search_path = spideryarn, public; … ROLLBACK;`.
- **Production**: the same container's `psql` with `DATABASE_URL` from `.env.prod` passed through
  the environment (never on a command line, never printed), wrapped in `BEGIN READ ONLY; SET LOCAL
  search_path …; SET LOCAL statement_timeout = '30s'; … ROLLBACK;`, one invocation.

```
  current_user  | ro |  v   | tables          (production)
 spideryarn_app | on | 17.6 |     49
 postgres       | on | 17.6 |     49          (local)
```

Production statements selected only `count(*)`-style aggregates, code-valued columns (`kind`,
`status`) and catalog rows. Local `EXPLAIN` output below has uuids and block ids masked.

## Sol's findings, in Sol's order

### DB1 — criterion trimming tries to delete a criterion that has reader notes

**Verdict: confirmed, and reproduced. Evidence R (was C). Tier 0 stands. P1.**

Traced: `src/routes.ts` § `runRefereeCriterion` calls `refereeCriteriaStore.begin` before `sse(res)`
and before `runCriterionStream`, so Sol is right that no paid call is lost. `begin`
(`src/store/pg-referee-criteria.ts`) inserts, selects everything past `.offset(MAX_CRITERIA - 1)`,
drops only `pending` ids, and deletes the rest. `comments_criterion_fk` is `NO ACTION`
(`confdeltype = a`, validated, in both catalogs).

Probe: a throwaway test with the fixture of `tests/store-parity-referee.test.ts`, run in the
private-Postgres lane through a throwaway config (the tracked config takes lane membership from
`TEST_LANES`, so a new file would land in the lane with no database). Two cases: a control with no
note, and Sol's failing input.

```
npx vitest run tests/zz-dbprobe-db1.test.ts --config vitest.dbprobe.config.ts --reporter=verbose --silent=false

stdout | … CONTROL: with no note on the oldest criterion, criterion 21 is accepted and the oldest is trimmed
CONTROL kept: 20 oldest present: false new present: true
 ✓ |private-postgres| … CONTROL … 564ms
stdout | … DB1: with a reader note on the oldest criterion, what does begin(criterion 21) do?
DB1 result: {"threw":true,"errorName":"StoreFailure","errorMessage":"This app asked its database for
something it would not do, so that did not go through. That is a bug here rather than anything you
did, and trying again will not help until somebody fixes it. It has b","criteriaAfter":20,
"oldestStillThere":true,"newCriterionThere":false,"begunReturned":false,"commentsAfter":1,
"commentStillMarked":true}
 ✓ |private-postgres| … DB1 … 495ms
 Test Files  1 passed (1)   Tests  2 passed (2)
```

So: the insert rolls back, the note and its criterion survive, and the reader is shown the generic
store-failure sentence. Sol understated one thing: **the article is wedged, not failed once.** Every
later `begin` selects the same oldest marked row and fails the same way, until the reader deletes
the note or the criterion by hand. Nothing tells them that is the way out.

Sol's production query, and context:

```
 marked_terminal_rows_at_trim_boundary | affected_articles
                                     0 |                 0
 criteria | articles_with_criteria | most_on_one_article | comments_with_criterion | criteria_with_a_note
       10 |                      6 |                   4 |                       0 |                    0
```

No witness in production and none near (4 of 20). Local: 11 criteria, most 3, one marked note.
Sol's local plan is a seq scan of an 11-row table (18 buffers, 0.4 ms); it shows nothing, as Sol
expected.

**The fix, as a separate claim: agreed, and it is the smallest one.** Keep referenced criteria the
way pending ones are kept. It duplicates nothing and adds no refusal. Sol's point about concurrency
is correct and I checked the reasoning: a single `DELETE … WHERE NOT EXISTS (comment)` is not
enough, because a concurrent comment insert holds only a key-share lock on the criterion row, the
delete waits for it, does not re-evaluate its `WHERE` (the row was not changed), and then fails the
foreign key exactly as today. Two statements under `READ COMMITTED` (lock the candidates `FOR
UPDATE`, then delete those with no comment) close it. The select already exists, so this is a few
lines. If the builder wants less, the one-statement form is acceptable as v1: the leftover race
needs a note placed on a twenty-first-oldest criterion in the same instant as an add, and its cost
is one failed request that succeeds on retry.

**Owner?** No. The consequence (an article can show more than twenty criteria when old ones carry
notes) has a precedent in the same function: the cap is already "twenty plus however many older
criteria are still running". The only alternative deletes a reader's words or their marks. Build it
and tell him.

### DB2 — eight schema comments describe contracts the code has replaced

**Verdict: confirmed (7 of 8 checked line by line; the eighth, `refereeClaims.claimsOmitted`, by
its writer only). Evidence C. Tier 1.**

| Sol's row | What I found |
|---|---|
| `rawSourceSha256` "Nothing writes them yet" | `schema.ts:906`; `artifacts-pg.ts:1191` writes `rawSourceSha256: storedSha256` |
| `labels` "deliberately NOT a step name" | `schema.ts:1288`; `src/pipeline.ts:3429` has a step `name: "labels"` |
| `quiz` "No attempts table beside it" | `schema.ts:1077`; `quiz_attempts` exists (0 rows in production) |
| `queueState` "concurrency 1 … the singleton row is the guarantee" | `pg-jobs.ts:1313` `if (running >= maxRunning)`; the cap is six |
| `revisionStepRuns` "`stepIsDone` is an `access()` existence check" | `schema.ts:3001`; `pipeline.ts` § `stepIsDone` checks interruption, artefacts, then the stamp |
| `aiCalls` "No `attempt` column" | `schema.ts:3321` against `schema.ts:3427` `attempt: smallint("attempt")` |
| `claimsOmitted` | `routes.ts:5432` `patch = { status: "done", claims, model, claimsOmitted }` |
| `feedback.screenshot` "400,000" | `schema.ts:5264`; `src/types.ts:7304` is `2_000_000` and the CHECK at `schema.ts:5404` is `<= 2000000` |

**The fix:** correct them in place. No approval needed (CLAUDE.md: stale comments are corrected
without asking). Sol's caution is right: do not write that the publish gate enforces the
source-reference rule.

### DB3 — the criterion shape CHECK allows one or two stray fields on a non-diverging row

**Verdict: confirmed. Evidence C for the gap, R for "no row violates the stronger rule". Tier 1.
Additive-safe.**

The production catalog has exactly the expression Sol quotes:

```
referee_criteria_diverging_shape | CHECK (((kind = 'diverging'::text) = ((pole_against IS NOT NULL)
                                   AND (pole_favour IS NOT NULL) AND (scale IS NOT NULL))))
```

For `kind = 'single'` with one pole set, both sides are false, so it passes. `configToRow`
(`src/referee-criteria.ts:624`) writes all three null for the other kinds, on the insert and on the
reset, so no ordinary request can reach the stronger rule.

```
 rows | invalid_criterion_shapes        kind    | count          (production)
   10 |                        0      diverging |     6
                                      single    |     4
```

Local: 0 of 11.

**The fix:** agreed. Same constraint name, stronger expression. It is a replace, so the migration is
a `DROP CONSTRAINT` then `ADD CONSTRAINT`; with 10 rows there is no case for `NOT VALID`. Add the
two forbidden-row cases to `tests/db-referee-criteria.test.ts`.

### DB4 — releasing a source guess overwrites its only start time

**Verdict: confirmed, and slightly understated. Evidence C. Tier 1. Additive-safe.**

`src/store/pg-source-guesses.ts` § `release` sets `claimedAt: sql\`to_timestamp(0)\``. And § `claim`
is an upsert that sets `claimed_at = now()` on every reclaim, so even without a release the column
is "the latest claim", never "when this row was made".
`tests/action-tables-have-created-at.test.ts:64` accepts it as the table's "when".

```
 rows | released_rows_with_synthetic_start | claimed_null        (production)
    5 |                                  0 |            0
```

Local: 25 rows, 0 at the epoch. The catalog confirms there is no `created_at` column in either
database.

**The fix:** agreed: a nullable `created_at`, default added in a second statement so old rows stay
null rather than getting an invented date (the house pattern of
`drizzle/20261003170347_store_when_it_happened.sql`; a test refuses the one-statement form). No
store change is needed: the upsert's `ON CONFLICT DO UPDATE` does not touch a column it does not
name. Then point the test's entry for this table at `created_at`. Five production rows keep a null.

### DB5 — no index leads on `articles.owner_id`

**Verdict: the fact is confirmed; the proposal is overstated. Evidence R that the index would not
help today. Tier 3 at most. Do not build.**

The five `articles` indexes in production are as Sol lists; none leads on `owner_id`.

```
 articles | owners | heap           largest_owner_shelf        (production)
       62 |      3 | 16 kB                           60
```

One owner holds 60 of 62 rows, so `owner_id = $1` selects 97% of a two-page table. Locally it is
184 of 212. No planner uses an index for that. Sol's two query shapes, local:

```
-- shape 1 (articleUrls)
 Hash Right Join (actual time=0.359..2.076 rows=184 loops=1)
   ->  Seq Scan on article_revisions r (rows=1340)   Buffers: shared hit=242
   ->  Seq Scan on articles a (rows=184)  Filter: (owner_id = '<uuid>')  Rows Removed by Filter: 28
       Buffers: shared hit=25
 Execution Time: 2.156 ms
-- shape 2 (shelf list core)
 Sort … -> Hash Join -> Seq Scan on article_revisions (242 buffers) + Seq Scan on articles (25 buffers)
 Execution Time: 1.834 ms
-- the articles half alone
 Seq Scan on articles a (rows=184)  Buffers: shared hit=25   Execution Time: 0.189 ms
```

The cost in both shapes is the scan of `article_revisions` (242 of 267 buffers), which an index on
`articles` does nothing about. I could not build the candidate index to show an "after" (read-only),
but Opus already forced the point (`enable_seqscan = off` still gave a seq scan), and the
selectivity above explains why. Sol asked for measurement before building; the measurement says no.
Opus's "revisit at a few thousand articles" is the right note.

### DB6 — `queue_state.running_job_id` has no reader or writer

**Verdict: confirmed. Evidence R. Tier 1 for the comment, needs the owner for the drop.**

```
grep -rnE '\b(runningJobId|running_job_id)\b' src scripts tools evals tests
src/db/schema.ts:2985:    runningJobId: text("running_job_id").references(() => jobs.id, { onDelete: "set null" }),
```

One hit, the declaration. Production and local: 1 row, pointer null. Sol's split is right: fix the
description in `src/store/article-rows.ts` now (it is also Opus's DBO11.3); the column drop is the
owner's and buys almost nothing.

### Sol's "historical vocabulary" counts (in its "For the owner")

| Value | Production | Local | Can the CHECK be narrowed on today's rows? |
|---|---|---|---|
| `rate_limit_events.bucket = 'citation-find'` | 1 | 3 | No, until the row is deleted (Opus DBO7) |
| `chat_messages.stance is not null` | 4 | 4 | No |
| `revision_blocks.role` in the four reserved | 0 | 0 | Yes, but the roles are reserved on purpose |
| `chat_threads.origin_mode = 'summary'` | 0 | 0 | Yes, but wider than the type on purpose |
| `revision_blocks.kind = 'callout'` (Opus's, not Sol's) | 0 | 0 | Yes, but it narrows `BlockKind` too |

Sol proposes none of these as a change, correctly.

### Sol's table and index audits

Spot-checked, not re-derived. Two rows are wrong for want of a catalog:

- "`threadsFor` messages: Unique article/thread/ordinal". Production answers that query from the
  non-unique twin `chat_messages_thread_ordinal_idx` (1,456 scans against 63), which is not in
  `schema.ts` at all. This is Opus's DBO3 and DBO4.
- "I found no index removal justified by these reads." One exact duplicate exists (DBO3).

"153 SQL migration files, rather than the brief's 154": Sol is right, `ls drizzle/*.sql | wc -l`
is 153.

## Agreements

Reached independently by both, so worth most:

| Sol | Opus | What |
|---|---|---|
| DB6 | DBO10 | `queue_state.running_job_id` is dead; the drop is the owner's |
| DB6 (description) | DBO11.3 | `article-rows.ts` says the row names the running job; it never has |
| DB2 | DBO11 | stale comments in `schema.ts`. Only one item overlaps, so the union is 11 comments, not 8 or 4 |
| DB5 | "Considered and not proposed" | no index leads on `owner_id`. Sol: measure first; Opus: not worth it. Measured here: not worth it |
| historical vocabulary | DBO7 and § Siblings | `citation-find` is retired with rows left; `stance` is legacy; reserved roles have no rows |
| "possible future structural change" | DBO12 | reader rows keyed on ids that live inside a JSON artefact; neither designs a fix |
| migration procedure | § How a migration is written | same procedure, same list of traps |

## Disagreements, settled

1. **Is there a live defect?** Opus: "I found no live correctness defect … There is no Tier 0."
   Sol: DB1. **Sol is right**, reproduced above. Opus read the catalog and the counts; the bug is in
   a store function's delete and needs no unusual data to exist, only to be reached.
2. **Is any index removable?** Sol: none. Opus: one duplicate. **Opus is right**; it is in the
   catalog and not in `schema.ts`, which is the only place Sol could look.
3. **Should `articles (owner_id)` be indexed?** Settled under DB5: no.
4. **Is the `referee_criteria` shape rule complete?** Opus's table has nothing against
   `referee_criteria` but the `owner_id`; Sol found the CHECK gap. **Sol is right** (DB3).
5. **Is `upload_source_guesses` sound on timestamps?** Opus questions only `queue_state` and
   `revision_step_runs`. **Sol is right** that `claimed_at` is not a creation time (DB4).

## Missed by both

1. **Opus's DBO8 CHECK breaks the test suite as written. P2, evidence C.** The rule "published
   implies four scalars" holds for every production row (0 of 460) and every local row (0 of 930),
   because `publishRevision` writes `{ status: "published", ...scalars }` in one statement
   (`src/store/pg-revisions.ts:2417`). But test fixtures insert a published revision directly with
   no scalars — `tests/store-parity-referee.test.ts` does (`status: "published", title: …`), and
   about 29 files under `tests/` and `scripts/` mention a published status without ever naming
   `wordCount` / `word_count`. `NOT VALID` does not help: it still checks new rows. So DBO8 is
   additive-safe for data and is not a one-line migration; it needs a fixture sweep first, or a
   shared fixture helper. Build it on its own.
2. **Deleting a marked criterion by hand gives the "this is a bug here" sentence. P1, evidence C
   (not run).** `DELETE` on one criterion (`src/routes.ts:10893`) calls `remove` with no check; the
   foreign key refuses it by design (`database.md § restrict and no action`), and
   `src/routes.ts:1478` says such an error "becomes a generic store failure". So the one refusal the
   schema makes on purpose reaches the reader as an apology for a bug, with no hint that the notes
   are why. It is also the only way out of the DB1 wedge today. A tagged refusal with a sentence
   ("this criterion has your notes on it") is the fix; the wording is reader-facing copy, so that
   part is the owner's or `copy.md`'s.
3. **DB1's wedge is permanent**, noted above; Sol's text reads as one failed request.

## For each of Sol's proposed constraints and indexes

| Sol | Proposed | Production rows that would violate | Additive-safe? |
|---|---|---|---|
| DB1 | none (code fix) | 0 marked criteria at the trim boundary; 0 notes on any criterion | n/a: no schema change |
| DB3 | stronger `referee_criteria_diverging_shape` | **0 of 10** | Yes |
| DB4 | `upload_source_guesses.created_at`, nullable, default `now()` | n/a (5 rows keep null; 0 rows at the epoch) | Yes |
| DB5 | `articles_owner_idx (owner_id)` | n/a (62 rows, 16 kB, one owner has 60) | Safe but useless; do not build |
| DB6 | drop `queue_state.running_job_id` | 0 non-null of 1 | No: a column drop, needs the owner |

## One ordered list for a single migration (the additive-safe union of both documents)

**How it is written here** (`docs/project/database.md`): edit `src/db/schema.ts`, then
`npm run db:generate -- --name <what_it_does>`, which writes the `.sql`, the snapshot and the
journal entry together. `generate` sees CHECK expressions and indexes now (220 `check(` calls in
`schema.ts`; `drizzle/20261005200628_reading_difficulty.sql` is a generated example), so none of
the four below needs `--custom`. Hand-edit the generated `.sql` only where noted. Never create the
file by hand and never write a `when`. Apply locally with `npm run db:migrate` and read its
`Target:` line; production is applied by the Overseer's `npm run deploy`. One local database serves
every worktree, so land the migration promptly once applied.

`NOT VALID` + `VALIDATE` is not warranted for any of them: the three constrained tables hold 10, 4
and 5 production rows, and no constraint in either catalog is unvalidated today (`not_validated =
0`), so a first one would be a new idiom for no gain. The index is on the one large table (105,774
rows, 231 MB with its text; the comparable primary-key index is 10 MB) and a plain `CREATE INDEX`
inside the migration's transaction blocks writes to it for about a second. `CONCURRENTLY` cannot run
in a transaction and is not needed at this size.

| # | From | DDL | Production count behind it | `schema.ts` change |
|---|---|---|---|---|
| 1 | Opus DBO1 | `CREATE INDEX "revision_blocks_article_block" ON "spideryarn"."revision_blocks" ("article_id","block_id");` | 105,774 rows to index; nothing can violate. Local lookup it replaces: 2,139 buffers, 425 ms cold | in `revisionBlocks`' third argument, beside `revision_blocks_fts`: `index("revision_blocks_article_block").on(t.articleId, t.blockId)`, with a line saying it serves `revision_blocks_identity_fk` on an article delete |
| 2 | Sol DB3 | `ALTER TABLE "spideryarn"."referee_criteria" DROP CONSTRAINT "referee_criteria_diverging_shape";` then `ALTER TABLE "spideryarn"."referee_criteria" ADD CONSTRAINT "referee_criteria_diverging_shape" CHECK (num_nonnulls("pole_against","pole_favour","scale") = CASE WHEN "kind" = 'diverging' THEN 3 ELSE 0 END);` | 0 of 10 violate (local 0 of 11) | replace the `sql` in `check("referee_criteria_diverging_shape", …)` with `` sql`num_nonnulls(${t.poleAgainst}, ${t.poleFavour}, ${t.scale}) = case when ${t.kind} = 'diverging' then 3 else 0 end` `` |
| 3 | Opus DBO9 | `ALTER TABLE "spideryarn"."referee_claims" ADD CONSTRAINT "referee_claims_empty_unless_done" CHECK ("status" = 'done' OR jsonb_array_length("claims") = 0);` | 0 of 4 violate (3 `done`, 1 `error`; local 0 of 2) | add `check("referee_claims_empty_unless_done", sql`${t.status} = 'done' or jsonb_array_length(${t.claims}) = 0`)` and rewrite the comment at `schema.ts:2165` ("No `empty unless done` check, deliberately"), whose reason was the filesystem store |
| 4 | Sol DB4 | `ALTER TABLE "spideryarn"."upload_source_guesses" ADD COLUMN "created_at" timestamp with time zone;` then `ALTER TABLE "spideryarn"."upload_source_guesses" ALTER COLUMN "created_at" SET DEFAULT now();` | 5 rows, all keep null; 0 at the epoch | add `createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()` (nullable, like `schema.ts:4459`). **Hand-edit:** `generate` emits one `ADD COLUMN … DEFAULT now()`; split it into the two statements. Then change `tests/action-tables-have-created-at.test.ts:64` to `{ column: "created_at" }` |

Checks before adding #3: every writer keeps the rule. `begin` writes `claims: []` (both branches,
`pg-referee-claims.ts:212` and `:222`), the route's error patch is `claims: []`
(`routes.ts:5435`), and `finish` leaves `claims` alone when the patch omits it. The one way to trip
it is a caller passing `{ status: "error", claims: [non-empty] }`; nothing does.

**Fifth, and not in the same migration:**

| # | From | DDL | Production count | Why apart |
|---|---|---|---|---|
| 5 | Opus DBO8 | `ALTER TABLE "spideryarn"."article_revisions" ADD CONSTRAINT "article_revisions_published_has_scalars" CHECK ("status" <> 'published' OR num_nonnulls("word_count","block_count","part_count","section_count") = 4);` | 0 of 460 published violate (470 revisions; local 0 of 930) | Safe for the data; fails every test fixture that inserts a published revision without the four numbers (see Missed by both, 1). Sweep the fixtures first. `schema.ts`: a `check(…)` on `articleRevisions` and delete the sentence in `src/store/pg.ts` § `scalarsForShelf` that says this "needs a migration" |

**Deliberately left out of the list:** `articles_owner_idx` (DB5, measured useless); the eight
composite owner foreign keys (DBO5's second option: additive, 0 of 157 rows differ, but it is one
half of a choice that is the owner's); CHECKs on `ai_calls.scope_kind` / `wire` / `outcome` (neither
document proposes them); declaring the eleven catalog-only objects in `schema.ts` (DBO4: no DDL
should run, and the generated migration would have to be emptied by hand).

**With the migration, but not in it:** the DB1 code fix and its regression test; the eleven comment
corrections (DB2, DBO11); two forbidden-row tests for #2 and one for #3.

## What needs the owner

Each of these drops, deletes or rewrites something. Counts are production.

1. **Drop the duplicate index `chat_messages_thread_ordinal_idx`** (Opus DBO3). 32 kB on a 200-row
   table. No data goes; the UNIQUE index on the same three columns serves the same queries. The
   lowest-risk item here, listed only because it is a drop.
2. **Drop `queue_state.running_job_id` and its foreign key** (Sol DB6, Opus DBO10). One row, value
   null, nothing reads or writes it.
3. **Delete one `rate_limit_events` row, then narrow the bucket CHECK** (Opus DBO7; Sol counts it).
   1 row with bucket `citation-find`, from 2026-09-29, no reader content. Until it goes the CHECK
   cannot lose the value.
4. **Delete the 13 article rows that never published, and decide whether a failed first import
   should leave a row** (Opus DBO2). 13 of 62 articles; they hold 9,303 of 24,344 block ids, 0
   comments, 0 queued or running jobs; Opus counted 196 of 594 checkpoints and one owner. Do item 1
   of the migration first, or each delete is slow.
5. **The eight `owner_id` columns nothing reads** (Opus DBO5): drop them (eight columns, eight
   foreign keys to `auth.users`), or keep them and add the foreign keys that make them true. 157
   rows across the eight tables, 0 where the copy disagrees with the article's owner.
6. **Superseded revisions** (Opus DBO6): 411 published and 10 failed revisions that are no article's
   current one, holding 95,070 of 105,774 block rows. Keep for ever, keep the last few, or delete.
   Nothing forces it.
7. **Legacy values with rows**: `chat_messages.stance`, 4 rows. Nobody proposes rewriting them.
8. **To be told, not asked** (DB1): after the fix an article can list more than twenty criteria when
   old ones carry notes. And the sentence a reader sees when they delete a criterion that has notes
   (Missed by both, 2) is reader-facing copy.

## Build order

Tier 0 first, then ease × value. File sets are marked so items can be put in separate worktrees.

| Order | Item | Files | Overlaps |
|---|---|---|---|
| 1 | DB1 fix + regression test (twenty done, a note on the oldest, begin one more; all four survive) | `src/store/pg-referee-criteria.ts`, `tests/store-parity-referee.test.ts` | none |
| 2 | The four-statement migration (#1 to #4 above) + its tests | `src/db/schema.ts`, `drizzle/*`, `drizzle/meta/*`, `tests/action-tables-have-created-at.test.ts`, `tests/db-referee-criteria.test.ts`, `tests/store-pg-referee-claims.test.ts` | `schema.ts` with 3 and 5 |
| 3 | Comment corrections (DB2's eight, DBO11's four, one shared) | `src/db/schema.ts`, `src/store/article-rows.ts` | `schema.ts` with 2: same worktree as 2, or after it |
| 4 | Tagged refusal when a marked criterion is deleted (Missed 2) | `src/store/pg-referee-criteria.ts`, `src/store/db-errors.ts` or the route, a client message | `pg-referee-criteria.ts` with 1: same worktree as 1 |
| 5 | DBO8: fixture sweep, then the CHECK, then drop the fallback in `scalarsForShelf` | ~29 test files, `src/db/schema.ts`, `drizzle/*`, `src/store/pg.ts` | `schema.ts` and `drizzle/` with 2: after 2 lands |
| 6 | DBO4's cheaper half: a test that fails on a catalog index or CHECK that is neither in `schema.ts` nor on a short list | `tests/db-schema.test.ts` | none |
| — | Everything under "What needs the owner" | | waits on him |

Two worktrees cover it without collisions: {1, 4} and {2, 3, then 5}; 6 can go in either.

## Appendix: statements run

Production, one read-only transaction (outputs quoted in the sections above; the rest here):

```sql
-- DB1: Sol's query verbatim, then
select count(*) as criteria, count(distinct article_id) as articles_with_criteria,
       (select max(n) from (select count(*) n from referee_criteria group by article_id) x) as most_on_one_article,
       (select count(*) from comments where criterion_id is not null) as comments_with_criterion,
       (select count(distinct (article_id, criterion_id)) from comments where criterion_id is not null) as criteria_with_a_note
from referee_criteria;
select conname, confdeltype, convalidated from pg_constraint where conname = 'comments_criterion_fk';
-- DB3
select count(*) as rows, count(*) filter (where num_nonnulls(pole_against, pole_favour, scale) <>
       case when kind = 'diverging' then 3 else 0 end) as invalid_criterion_shapes from referee_criteria;
select kind, count(*) from referee_criteria group by 1;
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'spideryarn.referee_criteria'::regclass and contype = 'c';
-- DB4
select count(*) as rows, count(*) filter (where claimed_at = to_timestamp(0)), count(*) filter (where claimed_at is null)
  from upload_source_guesses;
select column_name, data_type, is_nullable, column_default from information_schema.columns
 where table_schema='spideryarn' and table_name='upload_source_guesses';
-- DB5: Sol's two counts, plus
select count(distinct owner_id), pg_size_pretty(pg_relation_size('spideryarn.articles')) from articles;
select indexname from pg_indexes where schemaname='spideryarn' and tablename='articles';
select seq_scan, idx_scan, n_live_tup from pg_stat_user_tables where schemaname='spideryarn' and relname='articles';
-- DB6 and the historical vocabulary: Sol's five counts verbatim, plus kind = 'callout'
-- Opus's proposals, re-counted: DBO8, DBO9 (+ status breakdown), revision_blocks size, chat_messages
-- index scans, the eight owner_id agreement counts, never-published articles, superseded revisions,
-- the six catalog-only indexes, and
select count(*) as not_validated from pg_constraint c join pg_namespace n on n.oid=c.connamespace
 where n.nspname='spideryarn' and not c.convalidated;
```

```
 relname  | seq_scan | idx_scan | n_live_tup               (production)
 articles |    31612 |    20318 |         62

 revisions | published | dbo8_violating        rows | dbo9_violating
       470 |       460 |              0           4 |              0

 revision_blocks | pk_size  | total            indexrelname                     | idx_scan | size
          105774 | 10008 kB | 231 MB           chat_messages_thread_ordinal     |       63 | 40 kB
                                               chat_messages_thread_ordinal_idx |     1456 | 32 kB

 articles | no_current | their_block_ids | all_block_ids | their_comments | their_active_jobs
       62 |         13 |            9303 |         24344 |              0 |                 0

 is_current |  status   | revisions | blocks
 f          | failed    |        10 |   4200
 f          | published |       411 |  90870
 t          | published |        49 |  10704
```

The eight `owner_id` tables: comments 27, chat_threads 56, search_runs 45, glossary_lookups 7,
citation_finds 4, citation_investigations 4, referee_criteria 10, referee_claims 4; `differ` is 0
in every one.

Local, `EXPLAIN (ANALYZE, BUFFERS)`: Sol's plans for DB1, DB3, DB4 and DB6 are seq scans of tables
of 11, 11, 25 and 1 rows (0.07 to 0.43 ms) and show nothing about an index either way. DB5's are
quoted above. The foreign-key lookup behind migration item 1:

```
 Index Scan using revision_blocks_revision_id_block_id_pk on revision_blocks x (actual time=331.751..424.588 rows=4 loops=1)
   Index Cond: (block_id = '<block>'::text)
   Filter: (article_id = '<uuid>'::uuid)
   Buffers: shared hit=1 read=2138
 Execution Time: 424.631 ms
```

Greps: `running_job_id` (above); `ls drizzle/*.sql | wc -l` = 153; `grep -c 'check(' src/db/schema.ts`
= 220; files naming a published status and never `wordCount` / `word_count`, under `tests/`,
`scripts/` and `src/` outside `src/web`: 29 (an upper bound on fixtures DBO8 would break, not a
count of them).
