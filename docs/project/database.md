# Database

Up: [architecture.md](architecture.md)

**The database is Supabase Postgres, and since 2026-09-05 all relational application data is in
it.** Raw source documents and article images use the blob seam: Supabase Storage when credentials
are present, and `data/_blobs/` as the local fallback, described below.

> We were using flat JSON files initially, but we're moving everything to Postgres/Supabase to run
> across Vercel webservers that don't have a shared filesystem.
>
> — Greg, 2026-08-28

That is the whole reason, and it is the same one [vision.md](vision.md#one-the-database) gives for
reversing *"filesystem over database"*: a single writable disk is the thing serverless hosting does
not have, so the choice is a database or no deploy. The work is
[260825f-postgres-migration.md](../plans/260825f-postgres-migration.md); the migrations are under `drizzle/` and
the schema is [`src/db/schema.ts`](../../src/db/schema.ts).

**Where to look for an article's data.** Every application table is in the `spideryarn` schema, not
`public`, so
a query or a dashboard filtered to `public` finds nothing. An article's AI artefacts — quotes, ideas,
timeline, glossary and the rest — are `jsonb` columns on `spideryarn.article_revisions`, and
`articles.current_revision_id` points at the published one; they are not tables of their own. The
`checkpoints` table is a cache of work a failed attempt paid for, not where finished artefacts live
([§ Checkpoints](#checkpoints-work-a-failed-attempt-already-paid-for)).

**Before you add a column or a table, read [sql.md](sql.md)** — the shape we want the schema to have,
in Greg's words: real columns rather than JSON, foreign keys rather than good intentions, and a
nullable timestamp wherever a boolean would throw away when it happened. This file is the operating
manual; that one is the taste.

**This file opened by saying "there is no database" until 2026-08-28**, which was true when it was
written as a stub for [auth.md](auth.md) to point at and had not been true for some time.

## In this doc

- [§ A new migration, in five lines](#a-new-migration-in-five-lines) — how a migration is named,
  generated and applied; start here to add a column or a table
- [§ There is one store, and nothing left of the flag](#there-is-one-store-and-nothing-left-of-the-flag) — why no
  `SPIDERYARN_STORE` or filesystem store exists any more (history)
- [§ The filesystem era](#the-filesystem-era-files-under-dataslug) — what `data/<slug>/` held, and
  what outlived it: source documents, upload attempts, cache keys (history)
- [§ Next: Supabase Postgres](#next-supabase-postgres) — the files that hold the schema, the
  commands, how a job's writes reach a published revision, the `db:export` rollback, and the rules
  that outrank convenience
- [§ The four token columns](#the-four-token-columns-and-why-they-are-not-defaulted) — why
  `ai_calls` token counts have no default
- [§ Connecting to the remote](#connecting-to-the-remote) — reaching production's database, and
  [the four migrations the local ledger said were applied](#the-four-migrations-that-were-not-there-and-the-command-that-said-they-were)
- [§ A watermark is not a ledger](#a-watermark-is-not-a-ledger) — a migration that was skipped under
  `✓ migrations applied`, the guard, and a journal mid-merge
- [§ Two worktrees generated at once](#two-worktrees-generated-at-once) — `drizzle/meta/` forks, the
  gates that stop them, and [repairing one](#repairing-a-fork-what-the-losing-migration-is-decides-everything)
- [§ Roles](#roles) — the three database roles, applying migrations on the remote
  ([step two](#step-two-apply-the-migrations)), and
  [why `DATABASE_URL=… npm run db:migrate` reaches a different database than it names](#database_url-npm-run-dbmigrate-does-not-do-what-it-looks-like)
- [§ A null column and an absent field](#a-null-column-and-an-absent-field-are-the-same-fact-and-you-must-choose-which) —
  a field that was missing on disk and is `null` in a row
- [§ `restrict` and `no action`](#restrict-and-no-action-are-the-same-rule-at-two-different-moments) —
  choosing an `on delete` rule
- [§ Tightening an invariant over stored data](#tightening-an-invariant-over-stored-data-is-a-migration) —
  a new validator rule that makes stored data illegal: sweep the rows in the same commit
- [§ Two traps recorded elsewhere](#two-traps-recorded-elsewhere-repeated-here-because-they-are-expensive) —
  `supabase db reset --linked`, and the other expensive one
- [§ Checkpoints](#checkpoints-work-a-failed-attempt-already-paid-for) — the cache of model work a
  failed attempt already paid for
- [§ What is not done yet](#what-is-not-done-yet) — known gaps (uplink, Vercel env, `restrict`)

## A new migration, in five lines

1. Change [`src/db/schema.ts`](../../src/db/schema.ts) (read [sql.md](sql.md) first for the shape).
2. `npm run db:generate -- --name <what_it_does>` writes `drizzle/<yyyyMMddHHmmss>_<what_it_does>.sql`,
   plus a snapshot and a journal entry under `drizzle/meta/`. The timestamp prefix is
   `migrations.prefix` in [`drizzle.config.ts`](../../drizzle.config.ts); the files before 2026-09-02
   are numbered `0000`–`0052`. For hand-written SQL, `-- --custom --name <what_it_does>`, never a
   file created by hand ([§ What stops it now](#what-stops-it-now)).
3. Read the generated `.sql`; hand-edit it if drizzle's guess is wrong (a default that must not
   rewrite old rows: [sql.md § Store when it happened](sql.md#store-when-it-happened)).
4. `npm run db:migrate` applies it to the local Supabase. Never `drizzle-kit push`, and never run the
   DDL by hand in `psql` or Studio ([§ Next: Supabase Postgres](#next-supabase-postgres)).
5. `npm run db:check` says whether the live schema and `schema.ts` now agree. Production's migrations
   are applied by `npm run deploy`, which only the Overseer runs ([deployment.md](deployment.md)), and the one rule to read before pointing a command at it is
   [`DATABASE_URL=… npm run db:migrate` does not do what it looks like](#database_url-npm-run-dbmigrate-does-not-do-what-it-looks-like).

## There is one store, and nothing left of the flag

**`SPIDERYARN_STORE` chose between a directory under `data/` and Postgres until 2026-09-05.** It
chooses nothing now: [`src/store/index.ts`](../../src/store/index.ts) wires Postgres and only
Postgres. A validator in `src/store/live.ts` outlived the choice by a day, because Vercel's Preview
and Production environments still carried the variable and silently ignoring somebody who asked for
the store that is gone would be the failure this whole migration was leaving behind. Greg removed it
from both on 2026-09-06 and that file went with it
([260903f](../plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md) § I).
**Nothing reads the name now**, and
[`tests/one-store-only.test.ts`](../../tests/one-store-only.test.ts) says so with an empty allowlist.

Everything below about *why* the filesystem store could not be the live one is kept, because it is
the argument that got us here rather than a description of a switch. The sharpest form: the
filesystem store had **no owner column**, so it had no second reader, and a store with no second
reader cannot express "somebody who is not the owner". That is why
[auth.md](auth.md#whose-data-is-it) is a Postgres story, and why
[260827ai-public-read-only-access.md](../plans/260827ai-public-read-only-access.md#postgres-is-the-destination-and-this-feature-cannot-work-without-it)
is Postgres-only by nature rather than by preference — `data/` is one directory per slug and there is
nowhere in it to record who may read what.

The house rule where the two stores met was a **refusal, never a fallback**:

> Do not catch a Postgres error and fall back to files.

A fallback would have hidden exactly the divergence the parity test existed to find, and done it in
production, silently. The same reasoning governed each place a feature had no filesystem answer —
admin's user list, the visibility switch, public reading — and each refused with its own sentence
rather than returning a plausible default. Those branches were scaffolding, and they went with the
store.

Every store seam must have a **Postgres implementation**, and
[`tests/store-seams-have-two-implementations.test.ts`](../../tests/store-seams-have-two-implementations.test.ts)
derives both the seams and the implementations from the source rather than from a list anybody
maintains. A seam with no Postgres side is a 501 for every reader, and it looks exactly like a seam
that works — which is how Claims shipped filesystem-only and answered 501 in production for four
hours with every test green
([260901e](../postmortems/260901e-claims-shipped-filesystem-only-and-returned-501-in-production.md)).
A `pgFooStore` whose every method calls `notMigrated` is the same 501 by a longer route, so the same
test flags it — though that helper was deleted on 2026-09-06 once every seam had a real adapter, so
that case is now a tripwire on a revival rather than a check on today's source.

That guard asked for *two* implementations, and carried a `SEAM_ASYMMETRIES` map for the seams that
deliberately had one, until 2026-09-05. Two was never the point: it was asking for a Postgres side
in a world where `files` was the default and would otherwise hide its absence. With one store the
map would have had to name every seam, so it went and the assertion narrowed to what still matters
([260903f](../plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md) § G).

## The filesystem era: files under `data/<slug>/`

**This was the store until 2026-09-05, and it is gone.** This section keeps its outline, the one
estimate it taught us to distrust, and the pieces that outlived it. The full history — what each
file held, how two stores were kept answering alike, and the order things moved in — is in
[260831b-finish-the-database-move.md](../plans/260831b-finish-the-database-move.md) and
[260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md](../plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md).

**What it was.** One directory per article, one JSON file per pipeline stage (`raw.html`,
`meta.json`, `blocks.json`, `tree.json`, and one per AI artefact), with ingest jobs under
`data/_jobs/` and upload attempts under `data/_uploads/`. It was the store because of an early
principle, *"Prefer boring: filesystem over database, one server process"*, reversed for the reason
Greg gives at the top of this file.

**The estimate it taught us to distrust.** Reads went through `src/api.ts`, and this doc once called
that "the one file the store lives behind". It was only the *read* seam. Writes went through
`PipelineStep.outputs(ctx)`, which returned **file paths** and was implemented across seven stage
modules, so any estimate that treated the Postgres move as a one-file change was wrong from the
start. Both went on 2026-09-05. A step now declares `produces` — the *kinds* it makes — and returns
its product to the store ([§ Next: Supabase Postgres](#next-supabase-postgres), below).

Old `data/` fixtures may still carry `labels-progress.json` or `pdf-chunks/`; nothing reads them.
Those were **checkpoints**, and they have been rows since 2026-09-01, because a directory could not
do the one job they exist for — [§ Checkpoints](#checkpoints-work-a-failed-attempt-already-paid-for).

### What outlived it: source documents live in Storage

A raw source document's bytes go to **Supabase Storage**, in the private `sources` bucket, keyed by
their own contents (`sha256/<hash>.pdf`) so two readers with the same paper converge on one object.
Uploads went there first, on 2026-08-27, because the browser has to be able to write them without
passing through our server — a serverless function refuses a body over 4.5 MB. Since 2026-09-01 a
revision row holds a reference to its source document rather than the bytes; the `raw_bytes` column
was dropped. [260827o-raw-bytes-in-storage.md](../plans/260827o-raw-bytes-in-storage.md) drew the
line that decided it: not size but **immutability** — content-addressed and immutable goes to
Storage, revision-scoped and rewritable stays in Postgres.

**What the bucket will accept is a decision, and it is enforced on both sides.** `sources` declares
five types in [`supabase/config.toml`](../../supabase/config.toml) — PDF, HTML, and PNG/JPEG/GIF for
the article images that arrived with [260829b](../plans/260829b-hosting-the-articles-images.md) — and
our own byte-sniffing in [`src/assets.ts`](../../src/assets.ts) independently admits those same three
image kinds. **SVG is absent from both on purpose**, an SVG being a script-bearing document rather
than a picture; Storage answers `415` to one even under the service key, measured against the running
container. So it cannot be stored today even by mistake, which is the point of having the line twice.

The hazard is that the two sides are widened separately, and the doc that owns that hazard is
[deployment.md § the bucket checks](deployment.md#who-can-reach-it) — `bucketDrift` in
[`scripts/deploy-checks.ts`](../../scripts/deploy-checks.ts) compares declared against running. It
exists because the allowlist has drifted on production twice
([260903f](../postmortems/260903f-the-bucket-allowlist-drifted-again-on-production.md)). Adding an
image format means the config, the sniffer, and a thought about what the sanitiser now has to survive.

The seam is [`src/store/blobs.ts`](../../src/store/blobs.ts). Blobs follow the credentials, not any
flag: with a Supabase service key they go to Storage; without one, under `data/_blobs/`, which is
enough for tests and a laptop and cannot mint an upload grant, so nothing in production can come to
depend on it.

### What outlived it: upload attempts are a table

`data/_uploads/` was **queue state, not article state** — created, claimed and finished inside one
ingest. It moved first, on 2026-08-27, because minting a grant and queueing the job are **two HTTP
requests**, and on a serverless host they may not run on the same machine. It is the
`spideryarn.uploads` table behind [`src/store/uploads.ts`](../../src/store/uploads.ts). The rules the
record obeys never moved: `canTransition`, `grantExpired` and `sweepable` are in
[`src/source.ts`](../../src/source.ts) and touch no storage, which is what made this a change of
adapter rather than of rules. Finalising has to be *exactly once*; the filesystem needed a
create-only marker file (`open(…, "wx")`) for that, and Postgres needs one conditional `UPDATE` and
`rowCount` ([260827h-durable-queue-and-uploads.md](../plans/260827h-durable-queue-and-uploads.md)).

### What outlived it: what a stage's cache is keyed on

**Caching was not what the docs claimed, and since 2026-08-31 it very nearly is.** "Anything
expensive is cached on a content hash" began as a claim about `tweets` and `glossary` alone, via
`hashBlocks` in [`src/source-hash.ts`](../../src/source-hash.ts) and the optional `isDone(ctx)` hook
on `PipelineStep`. (That helper began life inside `src/tweets.ts` and moved out when the glossary
needed the identical question answered — two stages computing "the same" fingerprint two ways can
only ever disagree.) Which steps carry a stamp is read off each entry's `stamp` in
[`src/pipeline.ts`](../../src/pipeline.ts) § `STEPS`, not counted here.

**Every article-reading stage is fingerprinted against everything its prompt reads** — the blocks,
the tree and the head — through **one function per prompt head** in `src/source-hash.ts`:
`articleFingerprint` for the stages that send `articleText`, and `articleWithIdsFingerprint` for
those whose head also prints a `URL:` line and whose absent-metadata fallback is a synthetic
`TITLE: <tree.slug>`. A stage with a head of its own adds a function and a domain string rather than
widening one of these — which is what `timeline` did when it needed the publication date
(`datedArticleFingerprint`). The stages that once hashed less than that were harmless only while the
pipeline's artefact reads returned `null` and every stage re-ran regardless; once those reads
succeeded, an incomplete stamp would have let a **stale artefact skip**.
[260831b-finish-the-database-move.md](../plans/260831b-finish-the-database-move.md) § stage 1.
`assets` keeps the narrow blocks-only hash, honestly: it fetches the images the blocks name and has
no prompt.

`structure` still has no stamp and is done when its artefacts exist, whatever they were generated
from. That is deliberate rather than pending, and [`src/pipeline.ts`](../../src/pipeline.ts) §
`structure` explains at length why a stamp there needs consumer invalidation first. When it comes to
generalising this, copy their choice of **hash input**, not just the idea: `hashBlocks` hashes
`id \t text` per block, deliberately *not* the serialised blocks, because those bytes change when an
unread field is recomputed and *don't* change when two blocks swap ids — and the article
fingerprints put the tree's `structureHash` and the prompt head beside it, because a stage's
fingerprint has to cover **everything its prompt reads** — including the lines that are not about
the article's text at all, and including whatever the stage substitutes when an input is missing.

**A stored run is stamped with the hash of the exact blocks it sent, not of the blocks the store
reads when the row is made.** For Search and Criteria the handler loads the article first, passes
`hashBlocks` of it into `begin` as a required `sourceHash`, and hands that same article to the model;
read inside `begin`, a re-extraction landing in between left a fresh answer stamped stale. The cost
is that a failed `loadArticle` is now an HTTP error with no stored row, where it was a stored error
run (`7fc1b41fb`, 2026-10-05).

## Next: Supabase Postgres

**The heading is from when this was the plan; it is now the store, and the only one.** This section
is the operating manual for it: the files that hold the schema, the commands, how a job's writes
reach a published revision, and the backup. The pieces:

| File | What it is |
|---|---|
| [`src/db/schema.ts`](../../src/db/schema.ts) | the tables, in TypeScript. The source of truth. There were nine when this line was written and eighteen on 2026-08-29; `tests/db-schema-drift.test.ts` holds the current list, and holds it as a *set* rather than a count so that one table swapped for another is still somebody's job to look at |
| [`drizzle/0000_initial_schema.sql`](../../drizzle/0000_initial_schema.sql) | generated from it by `npm run db:generate` |
| [`drizzle/0001_auth_fks_and_guards.sql`](../../drizzle/0001_auth_fks_and_guards.sql) | hand-written: the `auth.users` FKs, the current-revision pointer, the indexes, and the guards that made the global job cap a database fact rather than a convention (the cap is six since [`drizzle/0032_jobs_concurrency_cap.sql`](../../drizzle/0032_jobs_concurrency_cap.sql)) |
| [`tests/db-schema.test.ts`](../../tests/db-schema.test.ts) | that the schema *enforces* what the plan promises — nine cases when this line was written, 23 on 2026-08-29. Run it rather than counting from here |
| [`scripts/db-migrate.ts`](../../scripts/db-migrate.ts) | `npm run db:migrate` |

```bash
npm run db:start       # docs/project/supabase-local.md
npm run db:migrate     # apply drizzle/ to DATABASE_URL
npm run db:seed-owner  # required on a fresh database — see supabase-local.md
npm test               # tests/db-schema.test.ts now runs for real
```

**Skip `db:seed-owner` on a fresh database and dozens of test files fail on a foreign key**, not on
anything that names itself: `StoreFailure: This app asked its database for something it would not
do, so that did not go through` names neither the constraint nor the fix.
[supabase-local.md § Running it](supabase-local.md#running-it) has the symptom in full and the fix.

**`npm run db:migrate`, never `drizzle-kit push`.** `drizzle.config.ts` deliberately carries no
connection details, so `push` — which introspects a live database and computes a diff — cannot
connect at all. That is a guard rail rather than a rule to remember.

**A migration's DDL run by hand, in `psql` or Studio, changes the schema and writes no ledger row.**
Every worktree on the box shares one local Supabase, so the next `db:migrate` anywhere then meets a
schema and a ledger that disagree. On 2026-09-28 a session whose `db:migrate` refused — because a
peer had already applied its own unlanded migration — ran its DDL directly to get past it, and that
wedged `db:migrate` for every tree until the Overseer repaired the ledger by hand. A refusal over a
peer's migration is the guard in [§ A watermark is not a ledger](#a-watermark-is-not-a-ledger)
working; the peer whose migration is in the way is the one who can resolve it.

The schema tests **skip** rather than fail when there is no database, and a skipped test protects
nothing. `npm test` on a fresh clone reports them as skipped, not passed, so the difference is
visible; it was not in the first version of that file, which reported nine passes for having checked
nothing.

**Reads come out of Postgres, and since 2026-09-05 there is nowhere else for them to come from.**
Every article, the library, the metadata page and the reader's comments. There was an escape hatch
back to disk — `SPIDERYARN_STORE=files npm run dev` — and it went with the store it named. The work,
and what is still missing, is in
[260826e-postgres-storage-implementation.md](../plans/260826e-postgres-storage-implementation.md).

**Writes go straight into Postgres now — no disk in between.** Since 2026-09-01 every pipeline stage
returns its product — `{ detail, parts, stamp }` — instead of writing a file, and the claim's own
session (`pgStoreSession`, [`src/store/pg-session.ts`](../../src/store/pg-session.ts)) writes each
one into that claim's draft revision as the job runs. A `done` ending publishes the draft and
finishes the job in **one transaction**
([ingest-queue.md § A finished job publishes the article](ingest-queue.md#a-finished-job-publishes-the-article-and-until-2026-08-30-it-did-not)).
Until 2026-09-01 a decorator, `publishingSession`, stood in the gap: the stages wrote their own files
and it copied a finished job's into a draft after the fact. That is gone —
[260831b-finish-the-database-move.md](../plans/260831b-finish-the-database-move.md) § Stage 3 is the
write-up, and it is worth reading once because several other plans and reviews refer back to it.

**A draft may only replace the revision it was copied from.** `beginDraftIn` copies whatever is
published when the draft opens, and the job then runs for minutes; if something else publishes in
between, moving the pointer to that draft buries work nobody meant to lose, and every check involved
reports success. So the revision records its own base in `based_on_revision_id`, set once when the
draft is minted and never touched again — a recorded lineage, not a value recomputed from whatever
happens to be current at the moment something asks for it. Publication compares that recorded base
with the revision it is about to replace, and refuses if they differ — inside `publishRevisionIn` in
[`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts), before the pointer moves, so every
caller is checked and not just the pipeline. It lived in the session until 2026-09-01, and standalone
`publishRevision` walked past it
([260901d-stage3-code-review-sol.md](../plans/260901d-stage3-code-review-sol.md) finding 1). A `null`
base publishes only over an article serving nothing, which is fail-closed for a draft minted before
the column existed.

**And a publication is judged on the input it changes, not the input it carries forward.** The same
copy is why: `beginDraftIn` hands every draft the published blocks and tree, so a glossary or quotes
or debate step arrives at the gate holding artefacts it never looked at. `checkTree`'s problems
against an *unchanged* pair are pre-existing — they are in front of readers either way — so they are
carried out on `PublishRevisionResult.carriedTreeProblems` and logged after the commit rather than
refusing. Anything that alters either half is judged in full, and everything else the gate checks —
no blocks, no tree, the `structure` run's status, its `input_hash` — stays unconditional. The
comparison is one boolean computed in the database over both halves, because `checkTree` validates
the pair and a tree-only test would let a changed block launder a fresh problem through.

Added 2026-09-05, after a rule tightened that morning retroactively invalidated stored trees and took
roughly one article in twenty off the air entirely — at a paid model call per attempt, with the
reader told to try again:
[260905f](../postmortems/260905f-a-tightened-tree-rule-wedged-every-article-that-already-broke-it.md).
The lesson worth carrying has its own section below:
[§ Tightening an invariant over stored data is a migration](#tightening-an-invariant-over-stored-data-is-a-migration).

**There is one write path.** `ArtifactStore.write()` has one caller and every step reaches it.
Since 2026-08-29 a step returns a *product* —
`{ detail, parts?, stamp? }` — and the commit after it
([`src/store/session.ts`](../../src/store/session.ts)) writes that product, checks it, and finishes
the step. The boundary landed empty on purpose, so that the stages could move behind it one at a
time; by 2026-08-31 every one of them had. `LEGACY_UNCONVERTED_STEPS` in
[`src/pipeline.ts`](../../src/pipeline.ts) is the list of steps still exempted from returning
`parts` — **empty**, and kept rather than deleted, because a step off it must return `parts` or the
type checker refuses it: the exemption has to be asked for by name, not fallen into.
[260827aa-delete-the-importer.md § D1](../plans/260827aa-delete-the-importer.md),
[260831b-finish-the-database-move.md § Stage 2](../plans/260831b-finish-the-database-move.md).

```bash
npm run db:seed-owner   # the auth.users rows: the row-owner, and the account you sign in as
npm run db:export -- --out /tmp/rollback   # Postgres → data/<slug>/, the rollback
```

**`db:export` says which database it read**, on a `Target:` line before the first `✓`, because the
one thing a rollback must not get wrong is which database it is a rollback of — until 2026-09-03 it
took `.env.local`'s over the one on the command line, and see § `DATABASE_URL=… npm run db:migrate`
below for how that goes.

**`db:export` needs the bucket as well as the database.** A revision row holds a *reference* to its
source document rather than the document, so `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are as
required as `DATABASE_URL`, and all three must name the same Supabase project. Set them and the
export refuses on the first line, before it writes anything.

That is a refusal rather than a warning because of what the alternative did:
[`blobStore()`](../../src/store/blobs.ts) falls back to `data/_blobs/` when either credential is
missing, so an export with the key unset read a directory that had never held those objects and
wrote article directories with their source documents absent — **a backup that looks complete and is
not**, in the one command anybody runs after losing something. The refusal lives in
`postgresBlobStore` in [`src/store/blobs.ts`](../../src/store/blobs.ts), which is also what
`src/store/index.ts` checks the pair with at boot: one pair, constructed in one place rather than
checked in two. [silent-success.md](../reusable/silent-success.md) ·
[260827aa-delete-the-importer.md](../plans/260827aa-delete-the-importer.md).

**A table the exporter has never heard of behaves exactly like one it has nothing to say about**, and
that is the other way this backup can look complete and not be. `db:export` reads a hand-written list
of tables, so `referee_criteria` — added on 2026-08-31 — was dropped silently for a day, with the run
reporting success and listing the files it *did* write. Nothing could have gone red: a file that is
never written is a file the round-trip test never misses.

So `ARTICLE_TABLE_COVERAGE` in [`src/store/article-rows.ts`](../../src/store/article-rows.ts) names
every table that reaches an article and says, for each, which file it goes into or **in words** why
it is not needed. Since 2026-09-01 it answers that twice, because the rollback and the reader's
export now share one owner-scoped query walk and nothing else — [export.md](export.md).
[`tests/store-export-covers-tables.test.ts`](../../tests/store-export-covers-tables.test.ts) checks
that record two ways, and they fail differently:

- **Is the list complete?** The tables come *from the schema*, never from a second copy of the names,
  and the walk follows **foreign keys** as well as `article_id` columns — so a child table keyed only
  by `criterion_id`, `thread_id` or `revision_id` is in scope for the same reason its parent is.
  `revision_step_runs` was already such a table and was invisible until 2026-09-01. The walk
  deliberately over-reaches: it pulls in `jobs`, because a job points at the draft revision it is
  building, and `queue_state` behind it. Over-reach costs one written-down sentence; under-reach
  costs a rollback that quietly loses somebody's work. No database needed.
- **Is the list true?** Every table the record calls exported gets a row with a sentinel string in it,
  `exportArticle` runs, and that string has to come back out of the file the record names. This half
  needs Postgres and skips (loudly) without it.

The second half used to search `src/store/export.ts` for `put("<filename>"`, and GPT Sol was right
that this was theatre — it tied a table to a *string in the source*, not to a query or a serialized
value, so declaring a new table into an existing file such as `comments.json`, or writing
`// TODO: put("new-file.json", …)`, satisfied it while exporting nothing. Trading an always-running
check that proves nothing for a sometimes-skipped one that proves something is the right way round:
the first reads as the check having been done.

`put` in `exportArticle` now takes the table it is writing from, and `ExportResult.tables` is what
the run actually touched — an observed fact rather than a claim, and the only thing that catches a
file built from the right rows by code that never names the table.

Note the limit that remains: the guard sees a missing **table**, not a missing **column**. A new
column on an exported table is still a hand-written line in `exportArticle`, which is how `tools`,
`stance`, `shelf.purpose` and `comments.valence` each went missing once.

| File | What it is |
|---|---|
| [`src/store/contracts.ts`](../../src/store/contracts.ts) | the seam — what a store can be asked. It was cut as the deleted `src/api.ts`'s surface, function for function, so the cutover changed one variable |
| [`src/store/index.ts`](../../src/store/index.ts) | wires the Postgres stores — the only ones. **No fallback lives here**, by design |
| [`src/store/pg.ts`](../../src/store/pg.ts) · [`pg-comments.ts`](../../src/store/pg-comments.ts) | the Postgres reader and comment store |
| [`src/store/export.ts`](../../src/store/export.ts) | the exporter that is the rollback. **There is no importer** — `npm run db:import` and `src/store/import.ts` were deleted on 2026-09-01, because a re-import wrote `raw_bytes` and left the source reference alone, describing two different acquisitions in one row. (That column was dropped on 2026-09-01; the document is an object in the `sources` bucket.) [260831b-finish-the-database-move.md](../plans/260831b-finish-the-database-move.md) § Stage 3 |
| [`src/owner.ts`](../../src/owner.ts) | who owns a row — the request-scoped owner, and the environment's when there is no request |
| [`tests/store-parity.test.ts`](../../tests/store-parity.test.ts) | the corpus loaded into Postgres through the real write path and read back. It compared two stores until 2026-09-05; its header says what survived and what was dropped |
| [`tests/store-parity-referee.test.ts`](../../tests/store-parity-referee.test.ts) | what the Postgres store answers about Referee mode — a parity suite until 2026-09-05, written after Claims shipped filesystem-only |
| [`tests/store-seams-have-two-implementations.test.ts`](../../tests/store-seams-have-two-implementations.test.ts) | every seam in `contracts.ts` has a Postgres implementation — see [§ There is one store](#there-is-one-store-and-nothing-left-of-the-flag) |
| [`tests/referee-routes-postgres.test.ts`](../../tests/referee-routes-postgres.test.ts) | Referee's routes driven against Postgres — which every route suite does since 2026-09-05, and this one did first |
| [`tests/store-artefact-manifest.test.ts`](../../tests/store-artefact-manifest.test.ts) | a new artefact beside an article turns up as a red test rather than as archaeology |

The rules that outrank convenience, all learned the expensive way:

- **Never catch a Postgres error and fall back to files.** It hides divergence, in production, where
  nobody is comparing. A write with no Postgres implementation yet must refuse (501) rather than
  write a file nothing will read back.
- **Read through the app's own loaders, not by reopening the file.** The importer read
  `comments.json` as a `Comment[]` when it is `{"comments": [...]}`, and imported 17 KB of the
  reader's questions as zero comments while printing a tick.
- **A skipped test protects nothing, and a *silently* skipped one is worse.** The parity suite's
  database probe timed out at 2s under load and opted the whole suite out inside a run that still
  reported a green 1103 passed.
- **A guard belongs on the thing, not on the place.** `guardDbStore` was applied at every selection
  in `src/store/index.ts` and at none of the three outside it, so on 2026-08-27 the shelf rendered a
  failed `select … from "spideryarn"."jobs"` — its columns, its `where` and the owner's uuid — in red
  on the homepage. Every Postgres store the owner's routes use is now wrapped **at its export**, so
  there is no unguarded spelling left to import, and
  [`tests/store-guarded.test.ts`](../../tests/store-guarded.test.ts) asks the objects rather than the
  source. **The public reader is the one exception and is not an oversight**:
  [`src/store/public-reader.ts`](../../src/store/public-reader.ts) scrubs its own, deliberately and
  more narrowly, because its import graph is closed and walked by
  [`tests/public-imports.test.ts`](../../tests/public-imports.test.ts). See
  [the postmortem](../postmortems/260827c-unguarded-job-store-and-the-migration-that-migrated-the-laptop.md).

The decisions the schema was built on are below, all of them built. The whole design — the schema, the reasoning, and the things that break quietly —
is in [260825f-postgres-migration.md](../plans/260825f-postgres-migration.md). The parts worth knowing before you
touch anything storage-shaped:

- **A block id is an identity; its text is a revision.** Foreign-keying comments to the current block
  rows would have broken a documented behaviour. See [block-ids.md](block-ids.md).
- **The tree stays JSONB; the blocks become rows.**
- **`owner_id uuid not null references auth.users(id)`, from day one** — populated with the session
  user. This is the line that decided [the auth choice](auth.md). `not null` on purpose: a row with
  no owner is not a state this system has.

  It said "so no query above the adapter changes when a second person is let in", and **that was
  wrong in the way that matters**. Having the column is not having the `where`. Nothing filtered on
  it until 2026-08-27, and because `articles.slug` is globally unique the second person did not get
  an empty library — they got the first one's. Every path from a slug to an article now goes through
  `ownedSlug()` in [`src/store/owned-slug.ts`](../../src/store/owned-slug.ts), which is the only sanctioned spelling
  and the thing a test greps for; [auth.md § Whose data is it](auth.md#whose-data-is-it) has the
  design and [`src/owner.ts`](../../src/owner.ts) has where the id comes from.
- **Drizzle for data, Supabase for Auth alone** — over `pg`, through Supabase's transaction-mode
  pooler. Greg reversed the original `supabase-js` choice once he decided the API layer, not RLS, is
  the security boundary: without RLS, PostgREST contributes only its restrictions, and every
  transaction would have had to become a PL/pgSQL function to work around it. See
  [§ The client](../plans/260825f-postgres-migration.md#the-client-drizzle-for-data-supabase-for-auth).
- **RLS is deferred**, so grants carry the whole weight —
  [§ RLS and realtime](../plans/260825d-deploy-and-repo-move.md#rls-and-realtime-not-now):

  > I had dreamed of using RLS instead of an API, but maybe that's overcomplicating things. Use your
  > judgment. […] I think the RLS and realtime syncing is aspirational. Let's just use a normal API
  > for everything for now, and we can add RLS in later.
  >
  > — Greg, 2026-08-25

  The answer is
  structural rather than careful: **don't expose the `spideryarn` schema through the Data API at
  all**, and give the runtime a dedicated least-privilege role. PostgREST then cannot see the schema
  whatever the keys are.
- **Supabase is the store and the login, never the transport.** The browser talks to `/api/*`, and
  `/api/*` talks to Postgres. The one exception is Auth, which *does* run in the browser — the rule
  that holds is "no application **data** query leaves the server", not "no Supabase call".

## The four token columns, and why they are not defaulted

**`auth.users.confirmation_token`, `recovery_token`, `email_change` and `email_change_token_new` are
nullable with no default, and we have left them that way** — not from inattention, so here is the
reasoning before someone spends an afternoon rediscovering it.

The hazard is real. GoTrue scans those four into non-null Go strings, so **one row with any of them
NULL makes `GET /auth/v1/admin/users` answer 500 for the whole database** — the dev server's
`/admin` page with it. Supabase's own troubleshooting page
([scan error on `confirmation_token`](https://supabase.com/docs/guides/troubleshooting/scan-error-on-column-confirmation_token-converting-null-to-string-is-unsupported-during-auth-login-a0c686))
names these exact four, and its remedy is a one-time `UPDATE` of existing rows rather than a default,
so it does not stop recurrence. [supabase/auth#1940](https://github.com/supabase/auth/issues/1940)
proposes the default and is open with no maintainer response; nothing in releases up to v2.197
fixes it. The other four token columns on that table *already* default to `''`, and `''` is exactly
what GoTrue writes into every row it creates — so defaulting them would have matched Supabase's own
behaviour, not deviated from it.

**We tried, and the migration cannot run.** `auth.users` is owned by `supabase_auth_admin`;
migrations connect as `postgres`, which is **not a superuser and cannot even `SET ROLE`** to that
owner. `alter table auth.users alter column … set default ''` therefore fails with
`ERROR: must be owner of table users`. The SQL itself is correct — it applies as `supabase_admin`,
verified in a rolled-back transaction — but it cannot go through `npm run db:migrate`.
[`0001`](../../drizzle/0001_auth_fks_and_guards.sql) is not a counter-example: adding a foreign key
*to* `auth.users` needs the `REFERENCES` privilege, not ownership.

**And that settles it, because hosted Supabase is more restricted, not less.** A fix we cannot apply
to production was never going to protect production's `/admin`, which was the main prize. What was
left was a superuser step outside the migration system, invisible to the reconcile guard, needing a
re-run after every `db:reset`, and protecting only local manual inserts.

**What actually protects us**, and is enough for the cause we saw:
[`tests/helpers/seed-auth-user.ts`](../../tests/helpers/seed-auth-user.ts) is the one way a test
writes such a row, and [`tests/auth-user-seeding.test.ts`](../../tests/auth-user-seeding.test.ts)
fails if anything under `tests/` hand-rolls the insert again. Anything creating a user through
GoTrue's admin API — `scripts/db-seed-owner.ts`, a real signup — never produces a NULL in the first
place. **The residue is a hand-written `psql` or Studio insert against `auth.users`**: set those four
columns to `''`, or the account list stops answering for everybody.
[The postmortem](../postmortems/260902b-four-bugs-behind-one-word-flaky.md) has the diagnosis.

## Connecting to the remote

**The remote is up and has the data**, as of 2026-08-27: project `alschkahzfagtppxspfq`,
eu-west-2, Postgres 17.6, **18 migrations, 15 tables**, both roles, the owner account, and five
articles — 635 blocks, 24 comments, 56 chat messages. `listArticles` and `loadArticle` have been
served from it through the **transaction** pooler, which is the path production uses. See
[§ Roles](#roles) for how it was bootstrapped and [§ What is not done](#what-is-not-done-yet) for
what is still missing.

**And the deployed app now does point at it**, which is how the next paragraph came to be written.

### The local ledger cannot tell you what the remote is missing

The two databases drift independently, and they drift by a lot. On 2026-09-02 a laptop that was
four migrations behind was used to say, in a question put to Greg, that the deploy would apply
**four** migrations to production. It applied **fifteen** — production was at `0036` and the laptop
at `0047`. The answer was arrived at honestly, by counting rows in
`spideryarn_migrations.__drizzle_migrations` and subtracting; it was just the wrong database's rows.

So **do not quote a pending count for production from anything local**. The number production would
actually apply comes from `migrationPlan()` in [`scripts/deploy.ts`](../../scripts/deploy.ts), which
reads the remote's own ledger and prints the list under `── Migrations`, each tag on its own line
and destructive statements called out. `npm run deploy -- --dry-run` reaches that step without
applying anything. Read that list before you promise anyone a number.

The general form is the one this whole section keeps restating: [a number is about whichever
database you asked](#database_url-npm-run-dbmigrate-does-not-do-what-it-looks-like), and it never
says which one that was.

### The four migrations that were not there, and the command that said they were

Later on 2026-08-27, `spideryarn.com` rendered a failed
`select … from "spideryarn"."jobs"` on the homepage, in red, column list and all. The remote had
**14** of the 18 migrations: `jobs` was missing `profile`, `failure_kind`, `upload_id`,
`upload_filename` and `work_key`, and `spideryarn.uploads` did not exist, so uploading a PDF could
not work either.

They were missing because **the documented way of applying them applied them to the laptop.**
`loadEnvLocal()` lets `.env.local` beat the shell — [`src/env.ts`](../../src/env.ts) explains why,
and for the app it is right — so `DATABASE_URL=<remote> npm run db:migrate` had its URL replaced by
`127.0.0.1:54362` *before* the remote check ran. `isLocalDatabaseUrl` agreed, the
`DB_MIGRATE_ALLOW_REMOTE` guard was satisfied, the dev database moved forward, and it printed
`✓ migrations applied`. A [silent success](../reusable/silent-success.md) of the purest kind: the
check shared its assumption with the code.

[`scripts/db-migrate.ts`](../../scripts/db-migrate.ts) now reads the shell's `DATABASE_URL` **before**
`loadEnvLocal()` and prefers it — the target of a migration is an argument, not configuration, and
this is the one place the shell means it — and prints a password-stripped `Target:` line whatever
happens. Read that line. It is the whole guard:

```
Target: postgresql://postgres.alschkahzfagtppxspfq@aws-0-eu-west-2.pooler.supabase.com:5432/postgres
Applying migrations from drizzle …
✓ migrations applied
```

**Verify afterwards as the app role, not as `postgres`.** They are different roles over different
poolers and only one of them is what Vercel uses; a migration that succeeds for `postgres` and a
table the app cannot see look identical from the migrator's side. The check that settles it is
running the query that failed. The full story is in
[the postmortem](../postmortems/260827c-unguarded-job-store-and-the-migration-that-migrated-the-laptop.md).

The facts below are the ones that turn a five-minute job into an afternoon, and each fails in a way
that misdirects you.

**Which host.** Supabase offers three, and the obvious one is wrong for production:

| | Use | Why |
|---|---|---|
| direct — `db.<ref>.supabase.co:5432` | local admin work | **IPv6-only** unless the paid IPv4 add-on is on. Works from Greg's laptop; will not resolve from Vercel |
| session pooler | **migrations** | IPv4, and a real session — which DDL and the migrator's bookkeeping both need |
| transaction pooler — port 6543 | **the running app** | one connection per transaction. `LISTEN/NOTIFY` and session advisory locks silently stop working here, and a `SET` outside a transaction **leaks to the next client** — see below |

The username differs too: pooler connections are `postgres.<project-ref>`, not plain `postgres`.

**Never `SET` anything on the transaction pooler — least of all `default_transaction_read_only`.**
`.env.prod`'s `DATABASE_URL` is port 6543, and Supavisor does not reset a backend when it hands it
back, so a plain `SET` outlives your `psql` and applies to whoever gets that backend next — which,
at our traffic, is every production request. On 2026-09-30 an agent reading feedback ran
`psql "$DB" -c "set default_transaction_read_only=on" -c "select …"` as a safety habit, and every
write in production failed with SQLSTATE `25006` (`PreventCommandIfReadOnly`), shown to readers as
`[db-busy]`, until the backend was `RESET`. To read safely, use `begin read only; …; commit;` (the
setting dies with the transaction), or the session pooler on port 5432. To tell whether a backend is
poisoned: `select current_setting('default_transaction_read_only')` via 6543 says `on` while the
same query via 5432 says `off`; `reset default_transaction_read_only` via 6543 clears it.

**There is no `psql` on the box.** The reads made from there on 2026-09-30 were a small node script: `pg`
imported by absolute path from a tree's `node_modules`, the committed CA passed as `ssl: { ca }`,
and every query inside `begin read only` … `rollback`. Without `ssl` the pooler answers
`ESSLREQUIRED`. The auto-mode classifier refuses `rejectUnauthorized: false` as TLS weakening, and
on 2026-09-30 a session that reached for it lost the lookup. The Overseer's notes of the same day
say the bucket can be read with `GET /storage/v1/object/info/sources/sha256/<hash>.<ext>`, a made-up
hash answering 400 as the control; that has not been re-checked since.

**SSL is enforced**, so a plain connection is refused — and `pg` does not use SSL by default, so the
refusal arrives looking like a credentials error. [`scripts/db-migrate.ts`](../../scripts/db-migrate.ts)
handles this off the same is-this-local test that guards remote runs: local is a container with no
certificate and must *not* use SSL; remote must.

**The certificate is committed**, at [`certs/supabase-ca.crt`](../../certs/supabase-ca.crt), and
found by path — so verified connections are the default rather than something to configure.
[certs/README.md](../../certs/README.md) explains why committing a certificate is right here (it is
Supabase's public root CA, carrying no project identifier). Without it, a remote connection is
**refused** — it used to carry on encrypted but unverified, which looks identical from the outside
— and so is a remote `DATABASE_URL` carrying `sslmode` or any other TLS key `pg` would let override
the CA: [security.md § verified or refused](security.md#database-tls).
[tests/db-tls.test.ts](../../tests/db-tls.test.ts) guards the file.

**Three credentials, and none of them is the superuser.** A runtime role with DML on `spideryarn`
and nothing else; a migration role with DDL; and the browser's publishable key, which reaches Auth
only because `spideryarn` is not an exposed schema. The `postgres` password must not go near Vercel.
Creating those roles is the one genuinely manual step — it needs passwords, which do not belong in a
migration file — and it is [step 1](../plans/260825f-postgres-migration.md#the-order-of-work).

## A watermark is not a ledger

**drizzle does not track which migrations ran.** Its node-postgres migrator reads *one* row —
`select … from __drizzle_migrations order by created_at desc limit 1` — **once**, before its loop,
and then applies every journal entry whose `when` is strictly greater than that number. It never
compares the hashes it stored, and it never asks whether an older entry is missing. Read it in
`node_modules/drizzle-orm/pg-core/dialect.cjs`, `PgDialect.migrate`; the hash is `sha256` of the
whole `.sql` file (`node_modules/drizzle-orm/migrator.cjs`).

So **an entry stamped below the newest applied row is skipped for ever, in silence**, under a
`✓ migrations applied`. On 2026-08-31 that was four migrations on Greg's laptop —
`0032_jobs_concurrency_cap`, `0033_quotes`, `0034_flowery_wolfsbane`, `0036_drop_summary_column` —
none of which could ever run again. `article_revisions.quotes` did not exist while the command that
was supposed to create it reported success. [silent-success.md](../reusable/silent-success.md)
again, and the same shape as [the accident above](#the-four-migrations-that-were-not-there-and-the-command-that-said-they-were).

Two things sank them:

- `0035_timeline`'s journal entry was written **by hand** with a round `when` of `1788200000000`,
  later than every migration around it including `0036`'s real `1788175229610`. Any database that
  applies `0035` can never apply `0036`.
- two local migrations, generated later the same evening and then renumbered into
  `0037_experimental_features_and_callout_blocks`, left ledger rows that raised the watermark above
  origin's `0032`–`0034`.

**The published timestamps were not corrected**, and must not be. Production may have applied
`0032`–`0035` correctly; re-stamping them makes them re-run there and fail.

### The guard

[`scripts/migration-ledger.ts`](../../scripts/migration-ledger.ts) holds the judgements, and
[`scripts/db-migrate.ts`](../../scripts/db-migrate.ts) runs them **before** `migrate()` as well as
after. Before matters: the migrator commits every pending file in one transaction, so a post-hoc
check would notice the gap only once the migrations *after* it had already run against a schema that
never had it.

The preflight refuses — exit non-zero, no DDL, and no `✓` — unless all of:

1. the applied journal entries are a contiguous prefix **in journal order**, which is not timestamp
   order;
2. the pending ones are the remaining suffix;
3. **every pending entry's `when` clears the newest `created_at` in the ledger.** This is the one
   that catches the defect. A database through `0034` is fine — both `0035` and `0036` clear its
   watermark, inverted stamps and all. A database through `0035` is broken, because `0036` never
   can;
4. every applied row's hash matches the file on disk;
5. the journal itself has no duplicate tags, no duplicate stamps, no broken indices, a `.sql`
   file for every entry — **and an entry for every `.sql` file**.

The last half of 5 is the direction that was missing until 2026-08-31, and it is the one that
happened. Two sessions in this tree ran `drizzle-kit generate` minutes apart without pulling; both
produced an `0032`, the journal named one of them, and `0032_experimental_features.sql` sat in the
folder never running while nothing said so. A file the journal does not name is either a migration
that will never run or debris, and only a person can tell which, so it is fatal. It is checked in
`journalProblems`, which needs no database, so
[tests/migration-journal.test.ts](../../tests/migration-journal.test.ts) catches it in CI on every
branch rather than on whoever migrates next. Predicted as failure row 8 of
[260828r-worktrees.md](../plans/260828r-worktrees.md), for two worktrees; it happened between two
sessions in one tree.

### When the journal itself is mid-merge

Every one of those checks reads `drizzle/meta/_journal.json` first, so a journal that will not parse
takes all of them out together. That is not hypothetical: nearly every change appends to the same
last entry, so this file conflicts more than any other in the repo, and nothing but tooling ever
opens it — the markers sit there unseen. On 2026-09-02 a half-finished merge in the shared primary
left `<<<<<<< HEAD` in it, `db:migrate` died on a `SyntaxError` at a byte offset, and the ledger got
the blame: it reported three rows belonging to no migration, all three of which turned out to be
real migrations. `spideryarn.ai_calls` stayed behind the code meanwhile, so **every paid call on the
box was recorded nowhere** for hours.

`readJournal` now refuses a journal whose first marker it can see, naming the file, the line and the
marker, so `db:migrate` and `db:generate` say what is wrong instead of guessing. It reads real lines
rather than regexing the file, and accepts markers longer than the default seven plus diff3's
`|||||||` — but `conflict-marker-size` is configurable downwards, and `db:chain` calls drizzle
directly, so this is a good first line rather than a fence.

Resolving it is **not** resolving the fork — see
[Repairing a fork](#repairing-a-fork-what-the-losing-migration-is-decides-everything), which is the
half that matters and the reason the message points there rather than restating it.

### Rule 4 on a laptop: the draft that ran, and the file that was committed

`db-repair-migration-ledger.ts` does not clear a **rule 4** refusal — it repairs watermark gaps, and
against a hash mismatch it reports *"nothing to reconcile"* while `db:migrate` keeps refusing. The
laptop is then stuck with every later migration pending.

It happened on 2026-09-01, to `0021_ai_calls_ledger` and `0036_drop_summary_column`. Neither file had
changed since it was committed and neither ledger hash matched **any** committed version of it — the
tell that this machine had applied a *working draft* and the file was tidied before it was committed.
That is a laptop-only shape: nothing else ever runs uncommitted SQL.

The remedy is to restamp those two rows' hashes, and the thing that makes it legitimate is doing what
the repair script does — **probe the postconditions first, in the catalogue, not by reading the
migration and believing it**. Here: `article_revisions.summary` gone, `revision_step_runs_step`
holding exactly 0036's list, no orphan `summary` rows, `ai_calls` present with all its columns. A
restamped row then means *"this database is at that migration's postcondition"*, the same weaker
claim the repair script's header describes, and `npm run db:check` is what says so afterwards.

**Against a remote, none of this applies**: a hash mismatch there means the published file was
edited after it ran, which is a different and worse problem, and the answer is not a restamp.

**Rows the journal has never heard of** get a policy rather than a rule, because a laptop
legitimately carries them and production never should. Remote: refuse. Laptop with anything still
pending: refuse, because an orphan row may be the same DDL as a pending migration under a new
number — clear it before migrating. Laptop with nothing pending: report and carry on, so a
renumbered local migration does not wedge the machine for ever. "Remote" is
`isLocalDatabaseUrl` in [`src/db/ssl.ts`](../../src/db/ssl.ts), the same test that decides TLS and
that guards remote runs, so local cannot mean one thing to the guard and another to the thing it
guards.

The **postflight** asserts that every journal entry ends with exactly one matching `(when, hash)`
row. It is metadata, not schema: it is green by construction for anyone who inserts bookkeeping rows
by hand, so it catches "the migrator said yes and applied nothing" and cannot catch "the row is
there and the column is not". `npm run db:check` and
[`src/db/schema-drift.ts`](../../src/db/schema-drift.ts) are the other half — and that file's own
header says which things it does not cover.

The whole run holds a **session advisory lock**. drizzle takes none, so without it two invocations
read the same watermark and both attempt the same DDL.

**Never hand-write a `when`.** [tests/migration-journal.test.ts](../../tests/migration-journal.test.ts)
fails on any entry stamped no later than one above it in the journal. The published `0035`/`0036`
pair is grandfathered by name *and* by both timestamps, so regenerating either file takes the
exemption away rather than inheriting it.

The whole story, including why `0033_quotes` could not be replayed verbatim and what the repair
recorded instead, is in
[the postmortem](../postmortems/260831h-db-migrate-applies-nothing-when-a-journal-timestamp-jumps-the-queue.md).

## Two worktrees generated at once

The section above is about the journal. This one is about `drizzle/meta/`, which is a **different
file, a different failure, and the one that reports success.**

Every `drizzle-kit generate` writes `drizzle/meta/<prefix>_snapshot.json` carrying an `id` and the
`prevId` of the one before it: a linked list, and the thing the *next* migration is diffed against.
Two worktrees generating from the same trunk write two snapshots with one `prevId`. The database
never notices — `migrate()` reads the journal and the `.sql` files and never opens a snapshot — so
everything works right up until somebody changes the schema again, and then:

```
npx drizzle-kit check      names both files, exit 1
npm run db:generate        the same red "Error:", exit 0, nothing written
```

**The generate path exits zero.** Both `process.exit` calls are a few lines apart in
`node_modules/drizzle-kit/bin.cjs` and only one of them says 1. Verified 2026-09-02 against a copy of
`drizzle/` carrying a second snapshot that claimed `0051`'s parent. It is
[silent-success.md](../reusable/silent-success.md) exactly: the operator asked for a migration, got a
success code, and got no migration.

### What stops it now

| | |
|---|---|
| `migrations.prefix: "timestamp"` in [`drizzle.config.ts`](../../drizzle.config.ts) | Two agents no longer both mint `0052`. **Reduction, not prevention** — the stamp is one-second resolution, and the snapshot is named from the prefix alone, so same-second collisions survive it. |
| `npm run db:chain` (`drizzle-kit check`), a gate in [`scripts/check.ts`](../../scripts/check.ts) | The fork, read the way `generate` will read it. It was already in `npm run deploy` and nowhere else, so a fork used to surface at the deploy. |
| [`scripts/migration-snapshots.ts`](../../scripts/migration-snapshots.ts), via `npm test` and a warning in `db:migrate` | The holes and breaks `drizzle-kit check` is green on, plus the rename trap — drizzle diffs against whichever snapshot sorts **last**, so an old one renamed to sort last rewinds every future migration in silence. |
| [`scripts/db-generate.ts`](../../scripts/db-generate.ts) | Success must have produced a `.sql`, a snapshot **and** a journal entry, or an explicit `-- --allow-empty`. This is the one that closes the class rather than the case: there are three exit-0-with-no-output paths in `generate`, and this does not care which one you hit. |

**Write hand-written SQL with `npm run db:generate -- --custom --name <what_it_does>`, never by
creating a file.** `--custom` writes the snapshot and the journal entry as well as the (empty) `.sql`
for you to fill in. `0029_assets` was hand-made without one, so the next generate diffed against
`0028`, re-emitted DDL that had already run, and failed on `column "assets" … already exists` — the
repair is written up at the top of
[`drizzle/0030_drop_summary_steer.sql`](../../drizzle/0030_drop_summary_steer.sql), and that hole is
still in the folder as a named exception today.

### Two facts about a fork repair, both learned the hard way on 2026-09-02

Written down because both were reverse-engineered under pressure, by two agents independently, on
the day four migrations forked three ways across five worktrees.

**A snapshot's `id` is inert, so a repair should keep it.** `preparePgMigrationSnapshot` mints it
with `crypto.randomUUID()`; nothing anywhere derives or validates it from the snapshot's contents.
Its only readers are the next snapshot's `prevId` and a zod string check. So when you rebuild a
snapshot's contents and repoint its `prevId`, **keep the existing `id`** — every migration already
chained onto it then keeps resolving instead of dangling, including ones nobody has told you about.
Minting a fresh id turns one repair into a cascade. Settled from drizzle-kit's own source rather
than assumed, because "the id is inert" is exactly the kind of claim that is true until some tool
hashes it.

**`db:chain` and `tests/migration-snapshots.test.ts` check structure only — neither can see a stale
snapshot.** [`scripts/migration-snapshots.ts`](../../scripts/migration-snapshots.ts)'s own header
says so, and it is the trap that makes a repair *look* finished: repointing `prevId` without
rebuilding contents passes both gates, and then the next `db:generate` in some third worktree diffs
against a picture that never had the other branch's tables in it, re-emits their DDL, and
`db:migrate` fails on `already exists` — landing on whoever generated, not on whoever repaired.

The check that proves **contents** is:

```bash
npm run db:generate -- --allow-empty     # then answer: no schema changes
```

That is drizzle asserting the snapshot equals what it would serialise from
[`src/db/schema.ts`](../../src/db/schema.ts) today, which is the actual claim a repair makes. Run it
before declaring a chain repaired; green on the structural gates alone means nothing.

**And rebuild from a tree that is exactly the trunk.** A rebuild takes its contents from the current
`schema.ts`, so doing it from a tree carrying unlanded schema work bakes those objects into a
snapshot dated before they exist — a third costume for the same fault.

### Repairing a fork: what the losing migration is decides everything

The journal half of the conflict is easy — take the trunk's file whole:

```bash
git show origin/dev:drizzle/meta/_journal.json > drizzle/meta/_journal.json
```

A file write rather than a `git checkout`, so it stays inside
[AGENTS.md](../../AGENTS.md#working-in-a-tree-several-agents-share)'s rules.

**That line assumes your side is the one being rebuilt**, so its entry comes back on the regenerate.
When **both** sides survive — the row below where both are already applied — taking the trunk's file
whole deletes your own entry instead, and you get a migration with no journal row. Keep both, in
`when` order.

> **Resolving the journal is not resolving the fork, and this is the trap the section is named for.**
> Git conflicts on `_journal.json` because both sides appended a line. It does *not* conflict on the
> snapshots, because each side wrote a **new file** and git merges two new files without a word. So
> the conflict you can see is the half that does not matter, and the half that does arrives silently.
> On 2026-09-02 that produced exactly the fork below: the journal was resolved carefully, the
> filenames were checked for collisions, and `0052_per_article_job_queue` and
> `20260902141103_byok_upstream_nanos` went to `dev` as two children of `0051`. It was caught by a
> code review, not by anything that ran. **After any merge that touches `drizzle/`, run
> `npm run db:chain`** — it takes a second and it is the whole of the check.

The snapshot half cannot be merged. Snapshots are a linear chain and drizzle has no notion of two
parents — Alembic and Django both model migrations as a DAG and can write an explicit merge node;
drizzle cannot. **And the obvious hand-fix is a trap:** repointing the loser's `prevId` at the
winner's `id` leaves its *contents* still diffed from before the winner's changes, so the next
generate re-emits the winner's DDL and `db:migrate` fails on `already exists` one migration later, in
whichever worktree generates next. Deleting the loser's snapshot is the same bug mirrored — that is
the `0029` story above.

So the loser is rebuilt, and **how depends on what it is**. Keep the original file wherever it is
going, in every row:

| the losing migration is | do this |
|---|---|
| unpublished, purely generated | delete its `.sql`, its snapshot and its journal entry, then `npm run db:generate` again. The simple case, and the common one. |
| unpublished, hand-edited or `--custom` | **keep the original SQL.** Regenerate only the schema part and re-apply the custom part by hand — a backfill, a grant, a function, `NOT VALID`, RLS. An ordinary `generate` may say "no schema changes" and hand you no replacement at all. |
| already applied to the shared local Postgres | preserve it and regenerate the *other* side, or reset. **Greg's call** — `npm run db:reset` empties the database and puts nothing back. |
| **both** sides applied, and they touch **disjoint tables** | neither is the loser. Hand-merge the snapshot — § below. |
| **applied to production** | **never delete, re-stamp or regenerate it.** Published migrations are immutable; the repair is a new forward migration. |

#### When both are applied and disjoint, merge the snapshot rather than rebuilding one

The common case for two agents: each added a table or some indexes, they never touched the same one,
and both are already in the shared database, so neither may be deleted and neither may be re-stamped.

Then the repair is one object. Diff the two children against their shared parent and check they
differ in **disjoint** `tables[…]` entries and in nothing else — not `enums`, `schemas`, `sequences`,
`policies`, `views`, `roles` or `_meta`. If that holds, the later child's snapshot with the earlier
child's table object dropped into it *is* the correct post-both state, assembled out of drizzle's own
serialisations rather than written by hand. Repoint `prevId` at the earlier child's `id`, and leave
the journal, both `.sql` files and the database untouched.

**Keep the rebuilt snapshot's own `id`.** Only `prevId` moves. The `id` is minted with
`crypto.randomUUID()` in `preparePgMigrationSnapshot` and nothing anywhere derives or validates it
from the contents — its only readers are the next snapshot's `prevId` and a zod string check. So
re-minting it buys nothing and costs everything downstream: any migration already chained onto the
old value dangles, and `drizzle-kit check` groups by `prevId` alone and **will not tell you**. Only
[`scripts/migration-snapshots.ts`](../../scripts/migration-snapshots.ts) resolves links, and only for
migrations that are in the tree — a peer's unpushed child is invisible to every check you can run.
There was one on 2026-09-02, and preserving the id is what kept it resolving.

**Green structural checks prove nothing about the contents.** `npm run db:chain` and
`tests/migration-snapshots.test.ts` are structure only, and `migration-snapshots.ts`'s own header
says a stale-but-structurally-perfect snapshot passes both. The check that proves the merge is:

```bash
npm run db:generate -- --allow-empty     # must answer: no schema changes
```

That is drizzle saying the snapshot equals what it would serialise from `src/db/schema.ts` today,
which is the actual claim — that no future generate re-emits either migration's DDL. If it writes a
migration instead, read the `.sql`: it names exactly what the merge missed.

**Do it from a tree that is exactly the trunk.** A rebuilt snapshot takes its contents from the
current `src/db/schema.ts`, so a tree carrying unlanded schema work bakes those objects into a
snapshot dated before they exist — the same fault one turn further on, and much harder to see.

Two more things that bite. `drizzle-kit generate` asks whether a thing was **renamed or dropped and
recreated**, and answering differently the second time produces different and possibly destructive
SQL — so answer it the same way. And regenerating changes a migration's `when`; a fresh `Date.now()`
is later than everything only if your clock is not behind and no later-stamped branch merges
concurrently, so the inversion check above stays load-bearing.

A `db:migrate` that prints a `⚠ drizzle/meta/ is not a well-formed chain` warning is telling you
this happened; the migration it is about to run is unaffected.

### That rename question needs a terminal, and without one you get silence

**The rename prompt above is interactive, and an agent has no TTY.** When
`drizzle-kit generate` wants to ask it and cannot, it prints

```
Error: Interactive prompts require a TTY terminal
```

and then **exits 0 having written nothing**. `npm run db:generate` catches the
empty folder and says so — that wrapper exists for the forked-chain case and it
covers this one too — but the underlying failure is
[silent success](../reusable/silent-success.md) in its purest form: the schema
says one thing, `drizzle/` says another, and the obvious conclusion is *nobody has
run the generator yet*. It cost several hours on 2026-09-02, with a destructive
change sitting uncommitted and three agents all reaching that conclusion
independently.

**The prompt only appears when a column is added and another dropped in the same
diff** — drizzle cannot tell a rename from a replacement, so it asks. Add and
drop in two separate migrations and it never comes up, which is the way out if
you would rather not fight it. A plain `ADD COLUMN` or new table generates fine
headless. Hand-writing the `.sql` to dodge the prompt is worse than either: it
leaves no snapshot in `drizzle/meta/`, so the next `generate` diffs against a
schema that never had your change and emits it again.

To answer it without a terminal, give it one:

```bash
(sleep 8; printf '\r'; sleep 30) | script -qec "npx drizzle-kit generate --name your_name" /dev/null
```

Three things about that line, each of which took a go to find:

- **`\r`, not `\n`.** The prompt reads the TTY in raw mode, where Return is a
  carriage return. A newline leaves it sitting on the question until the timeout.
- **The first `sleep` waits for the prompt to be drawn**, and the second keeps
  stdin open while drizzle writes the files. Close stdin early and `script` kills
  the shell mid-write — the run looks exactly like the failure it is working
  around.
- **It accepts whatever option is highlighted**, which is the first one:
  `+ <column> create column`. That is the answer you want when the new column is
  a different fact rather than the old one renamed — `route_kind` → `url` on
  2026-09-02 was a replacement, and treating it as a rename would have kept ten
  route names in a column validated as web addresses. **If you want the other
  option, this recipe is not enough** — send arrow keys, or do it from a real
  terminal.

Answer it the same way every time you regenerate, for the reason the paragraph
above gives.

### What no lock can cover

A **non-additive** migration — a dropped column — applied by one worktree breaks the running dev
server of every other worktree at once. That is inherent to one shared database, not something the
advisory lock in `db:migrate` pretends to cover. See
[worktrees.md](worktrees.md).

The reasoning, the four failure modes, everything considered and rejected, and what the rest of the
world does about it are in
[260902c-concurrent-migrations-across-worktrees.md](../plans/260902c-concurrent-migrations-across-worktrees.md).

## Roles

**Applied to the real project on 2026-08-26.** What follows is what was actually run, which is not
what this section used to say. The plan had a dedicated migration role; the platform does not allow
one, and the way it refuses is silent. See
[the migration role that cannot exist](#the-migration-role-that-cannot-exist).

Run the SQL through the **Management API**, not the dashboard's editor:

```
supabase login                                    # once per machine, a human step
supabase db query --linked --project-ref alschkahzfagtppxspfq -f some.sql
```

Both run as `postgres` and neither needs the database password, so the reason for preferring the
dashboard is preserved. The CLI is better only because a file is exact and a paste is not. Use
**only** `db query`: the Supabase CLI reads `supabase_migrations.schema_migrations` and knows nothing
about our Drizzle history, so `supabase db push` and `supabase db reset --linked` are destructive
here — see [the traps below](#two-traps-recorded-elsewhere-repeated-here-because-they-are-expensive).

| Role | Has | Used by |
|---|---|---|
| `postgres` | everything the platform allows, **but is not a superuser** | `npm run db:migrate`, from a laptop, over the **session** pooler |
| `spideryarn_app` | DML on `spideryarn` and nothing else | the running server, over the **transaction** pooler |
| `spideryarn_migrator` | DDL on `spideryarn`, but **not** `REFERENCES` on `auth.users` | nothing. It exists and is unused |

`spideryarn_app` is the only credential that goes to Vercel, and it is the one this split was
really for. It cannot read `auth`, cannot create objects, and is invisible to the Data API — all
three verified after the fact rather than assumed.

### The migration role that cannot exist

The `owner_id` columns are `references auth.users(id)` — seven when this was written, and more since; the foreign keys are in hand-written migrations, so `grep 'REFERENCES "auth"."users"' drizzle/*.sql` lists them. Creating those foreign keys needs
`REFERENCES` on `auth.users`, and **no role we can reach is able to grant it**:

- `auth.users` is owned by `supabase_auth_admin`, which nothing is a member of.
- `postgres` *holds* `REFERENCES` on it but **without grant option**. Its ACL entry is
  `postgres=ar*wdDxtm/supabase_auth_admin` — the `*` sits after `r`, so `SELECT` alone is grantable.
- Postgres answers a `GRANT` you lack grant option for with a **warning, not an error**.

So `grant references on table auth.users to spideryarn_migrator` — which this document used to
give as step one — runs, reports success, and grants nothing. It was caught only by asking
`has_table_privilege` afterwards. [silent-success.md](../reusable/silent-success.md); this is the
purest example in the repo, because the statement is *correct SQL that the platform will never obey*.

`grant postgres to spideryarn_migrator` would work by inheritance, and was rejected: it makes the
migrator postgres-equivalent, which is the thing the split existed to avoid, and Supabase's
`supautils` extension blocks reserved-role grants anyway.

**GPT Sol proposed the fix worth doing later**: one table of our own, `spideryarn_identity.owners`,
created as `postgres` and foreign-keyed to `auth.users`; every `owner_id` then references *that*,
the migrator legitimately holds `REFERENCES` on a table we own, and seven dependencies on a
Supabase-owned table become one. It was not done on 2026-08-26 only because it means editing
migrations `0001`, `0003` and `0011` while several agents were appending new ones — and Drizzle does
not re-verify the hash of an applied migration, so an edit would have left local and remote
silently disagreeing. Do it when the tree is quiet.

### Step one: the roles, before any migration

Invent two passwords and run this. **Note what is not here**: no
`grant references on table auth.users`. That statement cannot work, and saying it cannot work is
the whole of [the section above](#the-migration-role-that-cannot-exist).

```sql
create role spideryarn_migrator with login password 'MIGRATOR_PASSWORD';
create role spideryarn_app      with login password 'APP_PASSWORD';

grant connect on database postgres to spideryarn_migrator, spideryarn_app;

-- Kept even though the migrator is currently unused: it is what the role would
-- need if spideryarn_identity.owners ever lands and the migrator starts working.
grant create on database postgres to spideryarn_migrator;
grant usage on schema auth to spideryarn_migrator;

-- pgvector lives in the `extensions` schema, and neither of these roles can see
-- it without being told. **This is not optional and it does not fail locally.**
-- Supabase puts `extensions` on the `postgres` role's search_path with a
-- PER-ROLE `alter role`; the compiled-in default is only `"$user", public`, so
-- a role we create ourselves gets nothing. Drizzle emits `vector(1024)` and
-- `vector_cosine_ops` fully unqualified with no way to schema-qualify them, so
-- the first migration that adds a vector column fails on the real project with
-- `type "vector" does not exist` — while passing on a laptop, where we connect
-- as `postgres` and inherit its search_path. See docs/plans/260826n-semantic-search.md.
grant usage on schema extensions to spideryarn_migrator, spideryarn_app;
alter role spideryarn_migrator set search_path = "$user", public, extensions;
alter role spideryarn_app      set search_path = "$user", public, extensions;
```

### Step two: apply the migrations

From a laptop, as **`postgres`**, over the **session** pooler — port 5432, username
`postgres.<project-ref>`. Not the transaction pooler: DDL and the migrator's own bookkeeping both
want a real session. `scripts/db-migrate.ts` refuses a non-localhost URL unless you also say so on
the command line, which is deliberate and is not to be moved into a file.

`postgres` rather than `spideryarn_migrator` because of the `auth.users` grant that cannot be made.
The consequence to carry forward: **`postgres` owns every object**, which changes step three.

**The username carries the project ref for *every* role, not just `postgres`.** Supavisor reads the
part after the dot to work out which project you are asking for, so `spideryarn_app` connects as
`spideryarn_app.<project-ref>`. Get this wrong in the two available ways and the two errors say
different things, which is the useful part:

| Error | Means |
|---|---|
| `Tenant or user not found` | the **ref** is wrong, or you are on the wrong pooler host |
| `user not found in the database` | the ref is right, the **role** does not exist yet |

Which pooler host is not guessable, and both spellings resolve in DNS: `aws-0-eu-west-2` is this
project's, and `aws-1-eu-west-2` answers `Tenant or user not found` for it. Copy the hostname from
Dashboard → Connect rather than assuming.

**A freshly reset database password is rejected for about a minute**, and the rejection is
`password authentication failed` — byte-identical to the error for a password that is simply wrong.
So the obvious conclusion ("I must have copied it wrong") is available and false. Wait a minute and
try again before resetting it a second time. Verified 2026-08-26: the same string failed, then
succeeded, with nothing changed but the clock.

### `DATABASE_URL=… npm run db:migrate` does not do what it looks like

**It used to migrate the laptop's container and print `✓ migrations applied`**, on 2026-08-27,
while the remote it named stayed four migrations behind. `.env.local` deliberately beats the shell —
[`src/env.ts`](../../src/env.ts), and the reason is good — so a `DATABASE_URL` given on the command
line was *replaced* by the local one before `db-migrate.ts` ever read it, with one line of warning
on stderr above the output you were actually watching.

**A command whose target is an argument now resolves it explicitly**, with
`resolveTargetUrl({ shellWins: true })` — [`src/env.ts`](../../src/env.ts), where the exception is
made beside the rule it excepts, and where the list of which scripts choose which way is kept,
along with why `db:seed-dev` and `db:reown` deliberately keep letting the file win. `db:migrate`,
`db:check` and `db:export` are three of the shell-wins ones, so `DATABASE_URL=<remote> npm run
db:export -- --out /tmp/rollback` does now export the remote.

**Do not reach for the old wrapper** — a script that set `process.env.DATABASE_URL` after
`loadEnvLocal()` and then imported one of these. It reads the environment as it was *before* any of
our code ran, so a shell that also exports `DATABASE_URL` beats the assignment and the wrapper
quietly does nothing. Put the URL on the command line.

**What is left of the trap is any command that has not been given that resolution**, and the way to
tell is the same either way: **read the `Target:` line rather than the success line.** A command
that prints no `Target:` line has resolved nothing and is going wherever `.env.local` points. It is
[silent-success.md](../reusable/silent-success.md) exactly: the check you would naturally run — "did
it say it worked?" — shares its assumption with the code.

### Step three: let the app see what the migrations made

Only now do the tables exist, which is why this cannot be folded into step one.

```sql
grant usage on schema spideryarn to spideryarn_app;
grant select, insert, update, delete
  on all tables in schema spideryarn to spideryarn_app;
grant usage, select on all sequences in schema spideryarn to spideryarn_app;

-- The same, for tables a *future* migration adds. Without this, every new table
-- is invisible to the app until somebody remembers to come back here — and the
-- symptom is "permission denied for table X" in production, long after the
-- migration that looked like it worked.
--
-- FOR ROLE postgres, because postgres is what applies the migrations and
-- therefore what owns the tables. `alter default privileges for role X` affects
-- only objects created by X — name the wrong role and the statement succeeds,
-- does nothing, and you find out one migration later.
alter default privileges for role postgres in schema spideryarn
  grant select, insert, update, delete on tables to spideryarn_app;
alter default privileges for role postgres in schema spideryarn
  grant usage, select on sequences to spideryarn_app;
```

**Prove it rather than reading it back.** `GRANT ... ON ALL TABLES` succeeds against zero tables,
and a default-privilege rule attached to the wrong role looks identical to one attached to the right
role until a new table appears. The check that actually settles it is a canary:

```sql
create table spideryarn.zz_canary (id int);
select has_table_privilege('spideryarn_app','spideryarn.zz_canary','select');  -- must be true
drop table spideryarn.zz_canary;
```

**Run, and true, on 2026-08-27** — in a transaction that was rolled back, and for all four verbs
rather than only `select`, immediately before applying `drizzle/0014`, which creates the first new
table since the rule was written. This is the check worth keeping: a migration that creates a table
the app cannot see reports success and then fails on every request that touches it, which reads like
a broken feature rather than a missing grant. `pg_default_acl` showed
`spideryarn_app=arwd/postgres` for role `postgres` in schema `spideryarn`, and the canary agreed.

### Step two and a half: the extensions the schema needs

```sql
create extension if not exists vector schema extensions;
```

**With no `schema` clause this installs into `public`**, against Supabase's own convention for
`pgcrypto` and `uuid-ossp`. It needs no superuser, and `create extension` is transactional, so it
can be rehearsed inside a `begin; … rollback;`.

### The things to check afterwards, because none of them announces itself

Every one of these was run against the real project on 2026-08-26 and is recorded here as a command
rather than a claim, because the difference between "we granted that" and "that is granted" is the
entire subject of this section.

- **`spideryarn` must not be in the Data API's exposed schemas.** Do not check this in Settings →
  API; check it with a real anonymous request, which is the thing an attacker would send:

  ```
  curl "https://<ref>.supabase.co/rest/v1/articles?select=id" \
       -H "apikey: <anon key>" -H "Accept-Profile: spideryarn"
  ```

  The right answer is `PGRST106 — Only the following schemas are exposed: public, graphql_public`.
  This is the whole reason deferring RLS is survivable: PostgREST cannot serve a schema it cannot
  see, whatever key is presented. See
  [§ RLS and realtime](../plans/260825d-deploy-and-repo-move.md#rls-and-realtime-not-now).
  GPT Sol pointed out that [`tests/db-schema.test.ts`](../../tests/db-schema.test.ts) checks only
  `anon`'s table privilege, which is a different fact and would still pass if the schema *were*
  exposed.

- **The negative matrix for `spideryarn_app`**, all of which must be `false`:

  ```sql
  select has_table_privilege ('spideryarn_app','auth.users','select'),   -- reading the user table
         has_schema_privilege('spideryarn_app','auth','usage'),          -- seeing the auth schema
         has_schema_privilege('spideryarn_app','spideryarn','create');   -- making its own tables
  ```

  A grant present by accident looks exactly like a grant that is absent, until the day it matters.

- **`statement_timeout` is 2 minutes** for any role without one of its own (`anon` gets 3s,
  `authenticated` 8s). That is a *database* default, so `show statement_timeout` on a fresh
  connection is the only honest way to read it — the Management API's own session reports its own
  value, not yours. It matters more than it sounds: a slow uplink turns a single large `INSERT` into
  a `57014 canceling statement due to statement timeout`, and `pg_stat_activity` then shows the
  statement `active` on `Client:ClientRead`, which means the *server is waiting for you*.

### An owner exists before any row does

`npm run db:seed-owner` deliberately refuses to run against anything but the local stack, so on the
remote the owner is a **real** account. Created 2026-08-26 through the Auth admin API rather than the
dashboard, because it is one request and leaves a uuid in the response:

```
curl -X POST "https://<ref>.supabase.co/auth/v1/admin/users" \
     -H "apikey: <service_role key>" -H "Authorization: Bearer <service_role key>" \
     -H "Content-Type: application/json" \
     -d '{"email":"greg@gregdetre.com","email_confirm":true}'
```

`greg@gregdetre.com` → `001bb7a0-7720-4f1b-8b9d-1ee6e63d132a`, which is `SPIDERYARN_OWNER_ID` in
`.env.prod` and must be set on Vercel. Check for triggers on `auth.users` before creating anybody —
this project has none, but [the old one does](#two-traps-recorded-elsewhere-repeated-here-because-they-are-expensive),
and a `SECURITY DEFINER` trigger that fails takes the signup down with it.
[`src/owner.ts`](../../src/owner.ts) defaults to the fixed development uuid, which is the right
default on a laptop and the wrong one in production — and it fails loudly, on the foreign key, rather
than writing rows nobody owns.

## A null column and an absent field are the same fact, and you must choose which

Postgres carries a **null column** where the filesystem carries an **absent field**. Every artefact
that crosses between the two stores meets this, and it bit twice on 2026-08-28 in two different
files — which is what makes it worth a section rather than a comment.

The trap is that the two places pull in **opposite directions**, so there is no single right answer
to copy.

**As a hash input, the two spellings must collapse.** `src/source-hash.ts` § `hashBlocks` uses
loose `!= null`, which catches `null`
and `undefined` in one test, and then `?? ""` so both normalise to the same bytes. They have to: the
same article read from either store must hash identically, or every `sourceHash` comparison in the
pipeline says "the text changed" when nothing did.

**As a presence signal, the two spellings must not collapse.** `src/public/dto.ts` §
`publicArticle` uses strict `!== null`, and its comment
explains why truthiness would be worse — an artefact is always truthy, so the day one can be falsy
while present, truthiness would report it as never built. The whole payload rests on
present-versus-absent.

The consequence of that strictness is the part to know: **an omitted key takes the *present*
branch.** `undefined !== null` is true, so leaving a parameter out is not the same as passing `null`,
and the value goes on to be read as though it were there. That is what failed
`tests/block-roles.test.ts` with `Cannot read properties of undefined` inside `publicGlossary` — a
test written before the signature grew four parameters. The reader was right; the caller was wrong.

**So: decide which register you are in before choosing the operator.** Loose `!= null` where the two
spellings are one fact and must produce identical bytes. Strict `!== null` where the distinction
between built and not-built is the thing being transmitted — and then make callers spell `null` out,
because the type system will not.

## `restrict` and `no action` are the same rule at two different moments

They look interchangeable — both mean *you may not delete a row something else points at* — and
[sql.md](sql.md#referential-integrity-on-purpose-and-by-name) is right that `on delete` is a decision
rather than a default. The decision has a third option, and picking the wrong one of the two obvious
ones breaks something that has nothing to do with the constraint.

**`restrict` is checked row by row as a delete happens. `no action` is checked at the end of the
statement.** That is the whole difference, and it decides what happens when *two tables that both
cascade from `articles`* also point at each other.

`referee_criteria` and `comments` are exactly that pair — the referee's own mark on a passage is a
comment carrying a `criterion_id`
([260831an](../plans/260831an-referee-mode-for-peer-reviewers.md), `drizzle/0042`). Three choices:

- **`cascade`** would delete the referee's own sentences about the paper when a criterion is deleted.
  Their words are theirs and are not derived from anything. Wrong on its face.
- **`restrict`** says the right thing and says it too early. Deleting the **article** cascades into
  both tables in an order Postgres does not promise, so it can fire while the comment rows are still
  there and refuse a delete that is entirely legitimate — a bug that would appear as "this article
  cannot be deleted", months later, only for articles with referee marks on them.
- **`no action`** is the same rule at end of statement. Deleting a criterion on its own still fails,
  loudly, with rows to point at; deleting the article succeeds, because by then neither row exists.

**Verified against the local database rather than reasoned about**, and pinned by two tests in
[`tests/db-referee-criteria.test.ts`](../../tests/db-referee-criteria.test.ts) that do the delete both
ways round — the pair is the only thing saying `no action` was chosen rather than left there by
drizzle-kit's default. The house already had one instance of this shape and did not say why:
`revision_blocks_identity_fk` is "no cascade, and no `restrict` either".

The same table pair is worth reading for a second reason: `referee_criteria` is `search_runs` with a
kind, two poles and a scale, and [`src/db/schema.ts`](../../src/db/schema.ts) states beside it why it
could not be `search_runs` with a column added. The short version is a unit: `SearchHit.confidence`
is a 0–100 match strength whose validator clamps negatives to zero, so a signed valence sent through
it arrives as `0` and every negative judgement is gone with nothing to see.

## Tightening an invariant over stored data is a migration

**Sweep the rows in the same commit, or say in the commit message why not.**

A migration is not only a `.sql` file. Any change that makes some already-stored shape illegal is a
migration of that data, whether or not the schema moved — a new rule in a validator, a narrowed
union, a stricter parse, a check now run at a place it was not run before. Fixing the *producer* is
half the job; the rows the old producer wrote are the other half, and they are the half nothing
reminds you about.

*Say why not* is a real answer — the invalid rows may be harmless, or few enough to repair by hand,
or a sweep may touch real reader data, which is Greg's call. But it goes in the commit message,
because a rule tightened silently is indistinguishable from one whose data was checked. The question
to ask first is **what reads this invariant, and what does it do when it is broken**: one that only
warns can be swept later, and one standing in front of a gate that refuses whole artefacts cannot.

`c8e2cc7e` on 2026-09-05 is the cost of getting it wrong. Its own comment said the new rule applied
*"for the ones already stored"* and read that as a feature; nothing migrated them, and roughly one
article in twenty could then publish nothing at all for eleven hours, at a paid model call per
attempt.
[260905f](../postmortems/260905f-a-tightened-tree-rule-wedged-every-article-that-already-broke-it.md).

## Two traps recorded elsewhere, repeated here because they are expensive

- **The Supabase CLI does not know about our migrations.** Ours are Drizzle's, in
  `spideryarn_migrations.__drizzle_migrations`; the CLI reads
  `supabase_migrations.schema_migrations` and sees an empty history. So **`supabase db reset
  --linked` drops `spideryarn` and cannot put it back** — it replays only the migrations it knows
  about, and it knows about none of ours. Never run it against a project that matters. Same for
  `drizzle-kit push`, which introspects a live database and computes a diff; only `generate` and
  `migrate` are safe. See
  [§ A new project](../plans/260825f-postgres-migration.md#a-new-project-and-what-that-deletes).
- **The grant block in the Supabase custom-schemas guide opens the database.** Granting to `anon`
  plus permissive-or-absent RLS means the public key reads everything, and nothing errors.
- **Block ids are unique only *within* an article.** The primary key is `(article_id, block_id)`,
  never `block_id` alone. A global unique index starts rejecting valid inserts at around a hundred
  articles; a global *upsert* silently overwrites one article's paragraph with another's.
- **`LISTEN`/`NOTIFY` does not work through a transaction-mode pooler**, along with session advisory
  locks, `SET` outside a transaction, and temp tables expected to outlive one. This matters because
  [ingest-queue.md](ingest-queue.md#when-this-becomes-postgres) recommended `LISTEN/NOTIFY` for
  worker wakeups before we knew that. Keep polling.
- **The old project has a live trigger on `auth.users`.** It is `SECURITY DEFINER` and writes
  `public.profiles`, so every future Spideryarn signup writes a row into the *old* app — and a failure
  there fails the signup. Greg's own login won't fire it, so it will not show up in testing.

## Checkpoints — work a failed attempt already paid for

Two stages keep working state that has to **survive their own failure**: `structure` records each
batch of nav labels as it comes back — the `labels` step's since 2026-09-06, though the namespace
still carries the old owner's name (below) — and the PDF reader records each transcribed chunk. A 429 eight
batches into a book then costs one batch rather than eight, and these are the expensive calls.

**Four namespaces**, and the list is `CheckpointNamespace` in
[`src/store/checkpoints.ts`](../../src/store/checkpoints.ts): `pdf-chunk` for a transcribed chunk,
and three named for the `structure` step (called `hierarchy` until 2026-10-02) — `structure-whole-document` (the one whole-document
call for the tree), `structure-deepen` (each scoped call that splits a section too fat to read,
[`src/structure-deepen.ts`](../../src/structure-deepen.ts)) and `structure-labels` (the nav-label
batches). They are separate because they are separate questions with separate prices: a run that
dies in the labels must not buy the tree again.

**`structure-labels` belongs to the `labels` step since 2026-09-06, and carries the old owner's name on purpose.**
`batchFingerprint` carries no step and no job identity, so every stored row survived the split
([260906a](../plans/260906a-labels-leave-the-blocking-hierarchy-step.md)) — but only because the
namespace did not move. Renaming it to match the new owner would have invalidated every row and
bought the next run nothing. So the name records where these batches came from rather than who asks
for them now, and that is the trade. (It was `hierarchy-labels` until 2026-10-02, when the step was
renamed and the migration moved every row along with the name, so nothing was orphaned —
[261002b](../plans/261002b-rename-the-hierarchy-step-to-structure-everywhere.md).) Adding one is a migration, since the CHECK on the
table is the other copy of the list — and since 2026-09-05 `tests/db-schema.test.ts` inserts a row
under every name, so the two cannot drift in silence. Before that they could, and the symptom would
have been a `warn` nobody reads and a bill that goes up.

**There is no `delete`**, deliberately, and nothing needs one. A row is replaced by writing over it,
and the one caller that has to ignore what is stored — a repeat measuring whether the deepening
verdict is stable — skips the *read* instead, for the articles it names:
`SPIDERYARN_DEEPEN_REASK`, in [structure-step.md § the deepening wave](structure-step.md#deepening). It is a
list of slugs rather than a boolean, because a boolean read on every wave spends money on every
article a worker later picks up.

They live behind [`src/store/checkpoints.ts`](../../src/store/checkpoints.ts), with
[`checkpoints-pg.ts`](../../src/store/checkpoints-pg.ts) writing the `checkpoints` table. A stage is
handed one through **[`StoreSession.checkpoints`](../../src/store/session.ts)** — the third argument
to `PipelineStep.run` — and never builds one for itself.

**This was a directory until 2026-09-01, and it was not a tidiness problem.** The files went to
`data/<slug>/`, which on Vercel was job-scoped `/tmp` (that scoping — `src/job-scope.ts` and
`src/store/data-root.ts` — was itself deleted 2026-09-05, once every store was Postgres); a retry was
a new job id by design and landed on a different machine anyway, so **every attempt at a long PDF
started from zero**. A document dense
enough to plan a chunk per page can miss the 740s step deadline ([`src/pdf-read.ts`](../../src/pdf-read.ts)
§ `CHUNK_CONCURRENCY` has the arithmetic, against `MAX_PAGES`), so an accepted document could fail
for ever without ever accumulating enough finished work to get under it — a liveness failure rather
than a bill. GPT Sol revised its own earlier judgement to say so:
[260901d-simpler-finish-sol.md § 4](../plans/260901d-simpler-finish-sol.md). The seam had existed
since 2026-08-29 with no caller, for one reason: **a stage was never handed the stable `articleId`**,
which is the only thing a checkpoint may be keyed on.

The proof is [`tests/checkpoints-durable-resume.test.ts`](../../tests/checkpoints-durable-resume.test.ts),
which kills a chunked extraction part way, starts a second job over the same article, and counts
model calls. With the key scoped per job — which is what the directory was — the second attempt
re-reads all six chunks when it owes one.

What to know before touching any of it:

- **The key is the article and the question, never the revision.** A retry is a new job and a new job
  begins a new draft revision, so a checkpoint keyed on the revision is written on every run and read
  on none. Nothing errors; the bill goes up. It is the one way this table could have been useless.
- **The store never interprets the key**, so *the caller* has to put every input the work depends on
  into it — including the reader's own, if there ever is one. Neither existing key has a person in it
  and neither piece of work depends on one.
- **No `owner_id`,** because `article_id` is `not null` and `articles.owner_id` is the owner — the
  rule [`src/owner.ts`](../../src/owner.ts) states. `on delete cascade` is privacy work rather than
  tidiness: a checkpoint holds a transcription of the reader's own document.
- **`on delete cascade` is the retention policy; the sweep is the leftovers.** The only deletion with
  a deadline is an article going away, and that is automatic — the transcription goes with it. There
  are no orphans. What the sweep is for is the narrow case of a *live* article whose
  checkpoints are dead because the question changed (prompt version, model, or re-extracted text):
  ninety days on `last_used_at`, `npx tsx scripts/checkpoints-sweep.ts` to report, `--delete` to do
  it. **It sweeps Postgres only**, since 2026-09-01. Nothing schedules it, and what makes that safe
  is that every row costs a paid model call to create, so the table cannot grow faster than the bill.
  **There is deliberately no delete on success**: `labels.ts` used to mint a `runId` and refuse to
  delete a file that was not its own, machinery that existed only because the unit of deletion — one
  file holding every batch — was larger than the unit of work. One row per batch removes the hazard
  rather than guarding it.
- **The key is 16 lower-case hex characters by practice, not by contract.** What
  `checkpoints_key_format` and `CHECKPOINT_KEY_RE` (`src/store/checkpoints.ts`) actually allow is 1
  to 128 of `[a-z0-9_-]` starting on a letter or digit; every producer so far happens to mint 16 hex
  and there is no reason to break the habit. Read the regex as the rule and the habit as the habit —
  this line said the CHECK pinned the length until 2026-09-05, which would have misled anyone adding
  a checkpoint on its authority. Both
  producers are checked against it by the tests that own them — `tests/labels-batching.test.ts` on
  the real `batchFingerprint`, `tests/pdf-read.test.ts` on the keys a real run stores. Add a
  third checkpoint and its key has to satisfy that too; a `:` separator or upper-case hex would land
  cleanly and be rejected by the database later.
- **A checkpoint may not take a step down with it.** Every call into the store from either stage is
  wrapped: a read that throws is a miss, a write that throws costs one re-buy, and both are logged at
  `warn`. The worst a broken checkpoint may cost is the saving. The filesystem version could not say
  that — a full `/tmp` made `mkdir` throw straight out of the stage, which is a cache becoming an
  outage.
- ~~**A laptop with `SPIDERYARN_STORE=files` checkpoints nothing.**~~ Not since 2026-09-05: there is
  one store and every run has an `articles` row to key on. `fsStoreSession` had none and handed out
  `nullCheckpointStore()`, and the stage command lines defaulted to the same. Articles came out
  identical and a *second* attempt after a killed
  one pays again. That is a decision, written down at `nullCheckpointStore` in
  [`src/store/checkpoints.ts`](../../src/store/checkpoints.ts), and it ends when the filesystem store
  does.

A checkpoint write deliberately does **not** join the artefact transaction — preserving the work of a
*failed* attempt is the whole point, and one rolled back with the attempt is worthless. The Postgres
adapter uses `getDb()` and takes no `tx`.

## What is not done yet

- **The uplink can be the constraint, and it does not look like one.** On 2026-08-26 this laptop
  uploaded at 6–17 KB/s and a single `INSERT` blew a two-minute `statement_timeout`; the next morning
  the same link ran at 119 KB/s and the whole import took under two minutes. The tell is
  `pg_stat_activity` showing the statement `active` on `Client:ClientRead` — the server waiting for
  you. Measure the upload before blaming the database.
- **Vercel's recorded configuration** — `DATABASE_URL`, `SPIDERYARN_OWNER_ID`,
  `PGSSLROOTCERT` — is in [deployment.md](deployment.md#environment-variables). (`SPIDERYARN_STORE` was
  on this list, then became its opposite — set there and wanting taking off. Greg removed it from
  Preview and Production on 2026-09-06 and stage I of
  [260903f](../plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md) deleted
  the last code that named it.)
- **`on delete restrict` is inherited, not chosen.** Most `owner_id` foreign keys use it (a few later tables cascade instead; `grep 'REFERENCES "auth"."users"' drizzle/*.sql` shows which), which
  means deleting the user from the Auth admin API or the dashboard will fail with `23503` while any
  row is owned. Supabase's own guidance is `cascade` or `set null`; keeping `restrict` is defensible
  for a reading library, but it needs an export/delete workflow rather than silence.
- **`spideryarn_identity.owners`** — the fix for the migration role, described in
  [§ The migration role that cannot exist](#the-migration-role-that-cannot-exist).

## See also

- [architecture.md](architecture.md) — the pipeline stages and what a block is
- [supabase-local.md](supabase-local.md) — the Docker stack the schema is developed against
- [certs/README.md](../../certs/README.md) — the CA certificate, why it is committed, and what
  quietly stops being checked without it
- [260825f-postgres-migration.md](../plans/260825f-postgres-migration.md) — the plan, the schema, the honest risks
- [auth.md](auth.md) — why the auth provider and the database are the same decision
- [library.md](library.md) — the homepage, and the one file a move to Postgres goes behind
- [block-ids.md](block-ids.md) — the spine every table keys on
- [sql.md](sql.md) — how we use SQL: columns over JSON, keys over conventions, dates over booleans
