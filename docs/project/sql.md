# How we use SQL here

What to reach for when you add a column or a table. [database.md](database.md) is the operating
manual — which store is live, how migrations are applied, and the traps that have cost a day each.
This file is shorter and is about **taste**: the shape we want the schema to have.

Greg, 2026-08-31, when the experimental-features switch needed somewhere to live:

> I'd prefer to use a proper field, perhaps a nullable date-time, where null (default) means false,
> and we store the date when it was set if true … we prefer to maintain referential integrity and get
> the database to do as much work for us as possible (foreign keys and proper fields rather than json
> and nullable date-time over boolean for the extra information).

Three rules come out of that, and one caveat.

## Get the database to do the work

It has constraints, defaults, foreign keys and types. Every one of them is a rule that holds for
**every** writer — including the script somebody runs once at midnight, and the migration that
backfills a column three months from now. A rule enforced in TypeScript holds only for the callers
that went through that TypeScript.

The pattern to copy is `revision_step_runs_step`, the CHECK that lists the pipeline's step names: it
has caught three separate omissions ([database.md](database.md), `drizzle/0031_sketch.sql`), each
time at the insert rather than in a job dying somewhere far away.

## Referential integrity, on purpose and by name

A row that points at another row gets a foreign key. Every `owner_id` references `auth.users(id)`;
everything under an article cascades from `articles.id`, which is
[how deletion works](database.md#checkpoints-work-a-failed-attempt-already-paid-for) rather than a
tidiness measure — an article going away has to take the reader's transcriptions with it.

`on delete` is a decision, not a default. `restrict` on the owner keys was inherited rather than
chosen, and [database.md § What is not done yet](database.md#what-is-not-done-yet) says what that
costs.

## `SELECT … FOR UPDATE` cannot lock a row that is not there

A row lock is taken on the rows the statement *returns*, so a `FOR UPDATE` that matches nothing locks
nothing. `select … for update` followed by `if (!found) insert` therefore protects nothing at all in
the one case it was written for, and two concurrent callers both insert — the loser aborting its
whole transaction on the unique index, not just its own statement.

Insert **`on conflict do nothing`, targeted at the key**, then read the row back and work from what
came back rather than from what you tried to write.
[`lockOrCreateArticle`](../../src/store/pg-revisions.ts) is the pattern.

It needs `read committed`, PostgreSQL's default, and **the transaction has to ask for it** rather
than inherit it — a `default_transaction_isolation` on the role or the database changes it silently
and nothing fails on a laptop. Above `read committed`, `do nothing` stops being an escape at all:
an `on conflict do nothing` that meets a conflicting row from outside its own snapshot raises
`40001 could not serialize access due to concurrent update` at the *insert*, so the read back is
never reached — and nothing in `src/` retries `40001`, so the whole transaction is lost and the
reader is told it was "a moment's trouble". Measured, 2026-09-01, both arrival orders.

So pin it where the transaction opens, as [`pg-session.ts`](../../src/store/pg-session.ts) §
`READ_COMMITTED` and [`pg-feedback.ts`](../../src/store/pg-feedback.ts) do, and prove the pin by
asking the transaction — `select current_setting('transaction_isolation')` inside it, down a
connection whose default is *wrong*, which is what
[`tests/store-session-isolation.test.ts`](../../tests/store-session-isolation.test.ts) sets up.
Asserting that an option was passed is not the same check and does not survive a refactor.

**The rest of `src/store/` still inherits its level.** Of 21 Postgres transactions, two files pin:
`pg-session.ts` (three) and `pg-feedback.ts` (one). The unpinned ones that depend on the level are in
`pg-revisions.ts`, `pg-chat.ts`, `pg-searches.ts`, `pg-referee-criteria.ts`, `pg-referee-claims.ts`,
`pg-visibility.ts` and `pg-jobs.ts` — every one of them takes a lock or an upsert and then reads.
Pinning them is a separate, mechanical piece of work.

It hides, because the collision needs the row to be absent and it is absent only the first time
anybody writes it. Suspect it whenever a duplicate-key error names a table keyed by something that is
not the caller's own id — a content hash, a slug, a natural key — and nobody can reproduce it twice.
[260901f](../postmortems/260901f-a-for-update-that-locks-nothing.md) is the instance, with the audit
of every `for update` in `src/store/`.

## A nullable timestamp says more than a boolean

Where a flag is "off, or on since some moment", store the moment. `null` is off, a date is on, and
the same storage carries strictly more of the truth — for free, and with no second column to
disagree with the first.

`reader_profiles.experimental_since` is the worked example
([experimental-features.md](experimental-features.md)):

- **Nothing to backfill, and nothing to decide.** Nullable means every existing row already says
  off. (A `boolean not null default false` would not have rewritten the table either — Postgres
  stores a constant default as metadata since 11 — but it would still have been a value written for
  every reader to mean "we never asked", which is what `null` says for nothing.)
- **"Since when" has an answer**, which is the question a reader actually asks about a switch they
  do not remember flipping.
- **Re-asserting it must not move it.** `coalesce(experimental_since, now())` in the `do update`, so
  turning on something already on keeps the first date — otherwise the column quietly means "when
  did the client last send true". `src/store/pg-reader.ts`.

The same shape is worth reaching for anywhere a boolean is really an event: archived, published,
confirmed, dismissed.

## Columns, not JSON — with an exception that has to argue for itself

A field you filter, sort, join or constrain on is a column. JSON is what you reach for when the
value is **one opaque thing the database has no business reading**, and the schema has a few of
those on purpose: `article_revisions.summary`, `.ideas`, `.sketch`, `glossary_lookups.citations`.
Each is an artefact that only means anything against the article it was written for, and
[src/db/schema.ts](../../src/db/schema.ts) states the case beside each one.

So the rule is not "never JSONB". It is: **the default is a column, and a JSONB column needs a
sentence saying why it is not one.** If you find yourself wanting an index on something inside the
blob, or a check on it, that sentence has stopped being true.

`data/reader.json` and its neighbours are not counter-examples: the filesystem store is a JSON file
by construction, and [architecture.md](architecture.md) is where that split lives.

## Migrating data *inside* a JSONB column, and the operator that lies

**`@>` asks about containment of a whole element, not of a value somewhere inside one.** This is the
trap, and it is the shape of a statement that runs, reports success, and changes nothing.

`jobs.steps` is a `JobStep[]` — its elements are **objects**, `{"name":"toc", …}`, not bare strings
([`src/db/schema.ts`](../../src/db/schema.ts) § `jobs`). A migration written to rename a step reached
for the obvious thing:

```sql
-- WRONG. Matches no row that has ever existed in this table.
UPDATE jobs SET steps = … WHERE steps @> '["toc"]'::jsonb;
```

`'["toc"]'` asks *does this array contain the string `"toc"`*. It contains objects, so the answer is
always no — the `UPDATE` succeeds, touches nothing, and the deploy carries on. Nobody finds out until
a job fails a constraint days later. The version that works reads the field:

```sql
UPDATE jobs SET steps = (
  SELECT jsonb_agg(CASE WHEN e->>'name' = 'toc'
                        THEN jsonb_set(e, '{name}', '"hierarchy"')
                        ELSE e END ORDER BY ord)
  FROM jsonb_array_elements(steps) WITH ORDINALITY AS t(e, ord)
) WHERE steps @> '[{"name":"toc"}]'::jsonb;
```

Three things to copy from it, not just the idea:

- **`e->>'name'`**, because the value is inside the element.
- **`WITH ORDINALITY` and `ORDER BY`**, because `jsonb_agg` over `jsonb_array_elements` does not
  otherwise promise the original order back, and for `steps` the order *is* the meaning.
- **A containment test that matches the real shape** — `'[{"name":"toc"}]'` — if you want one at all.

**And check what else was derived from the blob.** `jobs.work_key` is
[`workKeyFor`](../../src/jobs.ts)'s hash of the step names *and four other things*, and it is what
active-job de-duplication compares. Rewriting the steps without recomputing the key makes one request
look like two. Worse, that function's own comment says it must hash exactly what `sameWork` reads
"or there are two rules for one question and they drift" — so a migration that edits the steps behind
the key breaks an invariant a test is actively holding together. **A JSONB column with something
downstream keyed off it is two things to migrate, and the second one has no constraint to catch you.**

**This is not a hypothetical — here are both predicates against the same table at the same instant**
(local, 2026-08-31):

```
WRONG   steps @> '["toc"]'            ->  0
RIGHT   steps @> '[{"name":"toc"}]'   ->  3
stored shape:  [{"name":"toc","label":"Building the hierarchy","status":"pending"}]
```

Three rows the migration had to move, and the obvious predicate finds none of them while raising no
error at all. Note also what the stored shape gives away: an element carries a **`label` and a
`status`** as well as a name, so anything that rewrites elements wholesale rather than with
`jsonb_set` throws away a running job's state.

**Before you trust any of it: run the `SELECT` half first and count the rows.** A data migration that
matched nothing looks exactly like one that worked —
[silent-success.md](../reusable/silent-success.md), and
[260831ak](../plans/260831ak-rename-the-toc-step-to-hierarchy-everywhere.md) is where this one was
caught, in review, in a statement written specifically to prevent that failure.

## See also

- [database.md](database.md) — the store, the migrations, and the traps.
- [experimental-features.md](experimental-features.md) — the switch this file's example is about.
- [`src/db/schema.ts`](../../src/db/schema.ts) — every table, with the reasoning beside it.
