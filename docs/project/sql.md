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

## See also

- [database.md](database.md) — the store, the migrations, and the traps.
- [experimental-features.md](experimental-features.md) — the switch this file's example is about.
- [`src/db/schema.ts`](../../src/db/schema.ts) — every table, with the reasoning beside it.
