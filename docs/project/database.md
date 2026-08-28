# Database

**The database is Supabase Postgres, and everything is moving into it.**

> We were using flat JSON files initially, but we're moving everything to Postgres/Supabase to run
> across Vercel webservers that don't have a shared filesystem.
>
> — Greg, 2026-08-28

That is the whole reason, and it is the same one [vision.md](vision.md#one-the-database) gives for
reversing *"filesystem over database"*: a single writable disk is the thing serverless hosting does
not have, so the choice is a database or no deploy. The work is
[postgres-migration.md](../plans/postgres-migration.md); there are 27 migrations under `drizzle/` and
the schema is [`src/db/schema.ts`](../../src/db/schema.ts).

**This file opened by saying "there is no database" until 2026-08-28**, which was true when it was
written as a stub for [auth.md](auth.md) to point at and had not been true for some time.

## Which store is live, and the one refusal that matters

`SPIDERYARN_STORE` still **defaults to `files`**, so a fresh checkout runs on disk and nothing
changes for anyone who has not opted in. But [`src/store/index.ts`](../../src/store/index.ts)
**refuses to boot on `files` in production**, and the reason generalises well beyond deployment: the
filesystem store has **no owner column**, so it has no second reader, and a store with no second
reader cannot express "somebody who is not the owner". That is why
[auth.md](auth.md#whose-data-is-it) is a Postgres story, and why
[public-read-only-access.md](../plans/public-read-only-access.md#postgres-is-the-destination-and-this-feature-cannot-work-without-it)
is Postgres-only by nature rather than by preference — `data/` is one directory per slug and there is
nowhere in it to record who may read what.

The house rule where the two stores meet is a **refusal, never a fallback**:

> Do not catch a Postgres error and fall back to files.

A fallback would hide exactly the divergence the parity test exists to find, and would do it in
production, silently. The same reasoning governs each place a feature has no filesystem answer —
admin's user list, the visibility switch, public reading — and each of them refuses with its own
sentence rather than returning a plausible default. Those branches are **scaffolding around a store
that is going away**, and they get deleted rather than maintained.

## The filesystem era: files under `data/<slug>/`

One directory per article, one file per pipeline stage:

```
data/writes/
  raw.html      fetched bytes          (stage 1)
  meta.json     title, url, fetched-at
  blocks.json   the sanitised blocks   (stage 3)
  tree.json     the ToC / zoom tree    (stages 4-5)
  arc.json
  comments.json
  tweets.json
  glossary.json
data/_jobs/
  spya-*.json   one file per ingest job
data/_uploads/
  <uuid>.json   one file per upload attempt   (files store only — see below)
```

**And, since 2026-08-27, one thing that is deliberately not a file here at all.** An uploaded PDF's
bytes go to **Supabase Storage**, in the private `sources` bucket, because the browser has to be
able to write them without passing through our server — a serverless function refuses a body over
4.5 MB. The article's directory still gets its `raw.pdf` and `raw.json` the way a fetched one does;
Storage additionally holds a copy at `sha256/<hash>.pdf`, keyed by its own contents so two readers
with the same paper converge on one object.

So there are now **two** stores under the filesystem era, and the seam between them is
[`src/store/blobs.ts`](../../src/store/blobs.ts). That is early rather than premature: the eventual
design has *every* raw document — fetched or uploaded, HTML or PDF — as an object with the row
holding a key and a checksum, which is
[the appendix of pdf-upload-and-storage.md](../plans/pdf-upload-and-storage.md#appendix-where-the-bytes-should-eventually-live),
and the seam is what makes that a follow-on rather than a rewrite.

**Since 2026-08-27 that follow-on is planned rather than merely intended** —
[raw-bytes-in-storage.md](../plans/raw-bytes-in-storage.md), which answers the question it turns on
(*should everything large go to Storage, for consistency?*) with a measured no. The line it draws is
not size but **immutability**: content-addressed and immutable goes to Storage, revision-scoped and
rewritable stays in Postgres. Raw source is 86% of every byte here and the only thing on the first
side of that line.

`data/_uploads/` is **queue state, not article state** — created, claimed and finished inside one
ingest, and meaningless once the article exists. It was on the filesystem because `data/_jobs/` is,
and it said it would move when that moved.

**It moved first, on 2026-08-27**, and the reason it did not wait is that it had a harder deadline
than the queue: minting a grant and queueing the job are **two HTTP requests**, and on a serverless
host they may not run on the same machine, so a record on a function's local disk is one the second
request cannot find. There is now a `spideryarn.uploads` table and two adapters behind
[`src/store/uploads.ts`](../../src/store/uploads.ts) — `SPIDERYARN_STORE` picks one, exactly as it
does for everything else. The rules the record obeys never moved at all: `canTransition`,
`grantExpired` and `sweepable` are in [`src/source.ts`](../../src/source.ts) and touch no storage,
which is what made this a change of adapter rather than of rules.

**The one place the two adapters are genuinely different code** is the claim, and it is worth
knowing which way round it goes. Finalising has to be *exactly once*, and read-then-write has a gap
in it however short — so the filesystem needs a create-only marker file beside the record
(`open(…, "wx")`, atomic at the kernel, working across processes rather than only across the awaits
in one). Postgres needs one conditional `UPDATE` and `rowCount`. The database makes the filesystem
adapter's cleverest piece of machinery disappear. `tests/store-uploads-parity.test.ts` runs the same
two-simultaneous-claims race against both.

**And the queue has not moved**, so this is not yet a deployable upload — see
[durable-queue-and-uploads.md](../plans/durable-queue-and-uploads.md), whose first line is about why
a durable record for one part of an ingest does not make the ingest durable.

**Reads** all go through [`src/api.ts`](../../src/api.ts) — `loadArticle`, `loadTweets`,
`loadGlossary`, `articleMetadata`, `listArticles`. (`deleteGlossary` is the one *write* that goes
through it, and [glossary.md](glossary.md) says why it has to.) [library.md](library.md) makes the same point from the other side.

**Writes do not.** This doc used to say "`src/api.ts` is the one file the store lives behind", and
that is only half true — it is the *read* seam. The write path is
`PipelineStep.outputs(ctx): string[]`, an interface that returns **file paths**, implemented across
seven stage modules (`fetch`, `extract`, `blocks`, `toc`, `arc`, `tweets`, `glossary`). Any estimate that treats
the Postgres move as a one-file change is wrong, and this is where that mistake starts.

Why files at all: *"Prefer boring: filesystem over database, one server process"* —
[AGENTS.md](../../AGENTS.md). Each stage writes JSON and every stage stays independently runnable.
See [architecture.md](architecture.md#stage-ownership).

**Caching is not what the docs claim.** "Anything expensive is cached on a content hash" is true of
exactly two stages of seven: `tweets` and `glossary`, via `hashBlocks` in
[`src/source-hash.ts`](../../src/source-hash.ts) and the optional `isDone(ctx)` hook on
`PipelineStep`. (That helper began life inside `src/tweets.ts` and moved out when the glossary needed
the identical question answered — two stages computing "the same" fingerprint two ways can only ever
disagree.) `toc` and `arc` still use `stepIsDone`, an
`access()` existence check — a file exists, therefore the step is done, whatever it was generated
from. When it comes to generalising this, copy their choice of **hash input**, not just the idea:
it hashes `id \t text` per block, deliberately *not* the bytes of `blocks.json`, because those bytes
change when an unread field is recomputed and *don't* change when two blocks swap ids.

## Next: Supabase Postgres

**The schema now exists and has been applied to a real Postgres — locally.** Nothing reads or writes
it; the app is still entirely on files. What is built:

| File | What it is |
|---|---|
| [`src/db/schema.ts`](../../src/db/schema.ts) | the nine tables, in TypeScript. The source of truth |
| [`drizzle/0000_initial_schema.sql`](../../drizzle/0000_initial_schema.sql) | generated from it by `npm run db:generate` |
| [`drizzle/0001_auth_fks_and_guards.sql`](../../drizzle/0001_auth_fks_and_guards.sql) | hand-written: the `auth.users` FKs, the current-revision pointer, the indexes, and the two guards that make global concurrency 1 a database fact rather than a convention |
| [`tests/db-schema.test.ts`](../../tests/db-schema.test.ts) | nine assertions that the schema *enforces* what the plan promises |
| [`scripts/db-migrate.ts`](../../scripts/db-migrate.ts) | `npm run db:migrate` |

```bash
npm run db:start     # docs/project/supabase-local.md
npm run db:migrate   # apply drizzle/ to DATABASE_URL
npm test             # tests/db-schema.test.ts now runs for real
```

**`npm run db:migrate`, never `drizzle-kit push`.** `drizzle.config.ts` deliberately carries no
connection details, so `push` — which introspects a live database and computes a diff — cannot
connect at all. That is a guard rail rather than a rule to remember.

The schema tests **skip** rather than fail when there is no database, and a skipped test protects
nothing. `npm test` on a fresh clone reports them as skipped, not passed, so the difference is
visible; it was not in the first version of that file, which reported nine passes for having checked
nothing.

**Reads now come out of Postgres when you ask them to.** `SPIDERYARN_STORE=postgres npm run dev`
serves every article, the library, the metadata page and the reader's comments from the database
instead of from disk; `files` remains the default. The work, and what is still missing, is in
[postgres-storage-implementation.md](../plans/postgres-storage-implementation.md).

**Writes do not.** Every pipeline stage still writes `data/<slug>/*.json` directly —
`ArtifactStore.write()` has no production caller at all — so an article ingested with
`SPIDERYARN_STORE=postgres` set produces files on disk and an empty draft revision that
`publishRevision` then refuses. The job record moved on 2026-08-27
([ingest-queue.md](ingest-queue.md)) and the artefacts did not, which is why an ingest still cannot
run on a host without a writable disk. The plan for the other half, and an honest account of its
size, is [transactional-stage-runner.md](../plans/transactional-stage-runner.md).

```bash
npm run db:seed-owner   # the one auth.users row every owner_id points at
npm run db:import       # data/<slug>/ → Postgres, idempotent
npm run db:export -- --out /tmp/rollback   # and back out again
```

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
[delete-the-importer.md](../plans/delete-the-importer.md).

| File | What it is |
|---|---|
| [`src/store/contracts.ts`](../../src/store/contracts.ts) | the seam — deliberately `src/api.ts`'s surface, function for function |
| [`src/store/index.ts`](../../src/store/index.ts) | which store is in use. **No fallback lives here**, by design |
| [`src/store/pg.ts`](../../src/store/pg.ts) · [`pg-comments.ts`](../../src/store/pg-comments.ts) | the Postgres reader and comment store |
| [`src/store/import.ts`](../../src/store/import.ts) · [`export.ts`](../../src/store/export.ts) | the importer, and the exporter that is the rollback |
| [`src/owner.ts`](../../src/owner.ts) | who owns a row — the request-scoped owner, and the environment's when there is no request |
| [`tests/store-parity.test.ts`](../../tests/store-parity.test.ts) | both stores must answer identically, compared as the **API-shaped** result |
| [`tests/store-artefact-manifest.test.ts`](../../tests/store-artefact-manifest.test.ts) | a new artefact beside an article turns up as a red test rather than as archaeology |

Three rules that outrank convenience, all learned the expensive way:

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
  on the homepage. Every Postgres store is now wrapped **at its export**, so there is no unguarded
  spelling left to import, and [`tests/store-guarded.test.ts`](../../tests/store-guarded.test.ts)
  asks the objects rather than the source. See
  [the postmortem](../postmortems/unguarded-job-store-and-the-migration-that-migrated-the-laptop.md).

Everything below is still planned, not built. The whole design — the schema, the reasoning, and the things that break quietly —
is in [postgres-migration.md](../plans/postgres-migration.md). The parts worth knowing before you
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
  `ownedSlug()` in [`src/store/pg.ts`](../../src/store/pg.ts), which is the only sanctioned spelling
  and the thing a test greps for; [auth.md § Whose data is it](auth.md#whose-data-is-it) has the
  design and [`src/owner.ts`](../../src/owner.ts) has where the id comes from.
- **Drizzle for data, Supabase for Auth alone** — over `pg`, through Supabase's transaction-mode
  pooler. Greg reversed the original `supabase-js` choice once he decided the API layer, not RLS, is
  the security boundary: without RLS, PostgREST contributes only its restrictions, and every
  transaction would have had to become a PL/pgSQL function to work around it. See
  [§ The client](../plans/postgres-migration.md#the-client-drizzle-for-data-supabase-for-auth).
- **RLS is deferred**, so grants carry the whole weight —
  [§ RLS and realtime](../plans/deploy-and-repo-move.md#rls-and-realtime-not-now). The answer is
  structural rather than careful: **don't expose the `spideryarn` schema through the Data API at
  all**, and give the runtime a dedicated least-privilege role. PostgREST then cannot see the schema
  whatever the keys are.
- **Supabase is the store and the login, never the transport.** The browser talks to `/api/*`, and
  `/api/*` talks to Postgres. The one exception is Auth, which *does* run in the browser — the rule
  that holds is "no application **data** query leaves the server", not "no Supabase call".

## Connecting to the remote

**The remote is up and has the data**, as of 2026-08-27: project `alschkahzfagtppxspfq`,
eu-west-2, Postgres 17.6, **18 migrations, 15 tables**, both roles, the owner account, and five
articles — 635 blocks, 24 comments, 56 chat messages. `listArticles` and `loadArticle` have been
served from it through the **transaction** pooler, which is the path production uses. See
[§ Roles](#roles) for how it was bootstrapped and [§ What is not done](#what-is-not-done-yet) for
what is still missing.

**And the deployed app now does point at it**, which is how the next paragraph came to be written.

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
[the postmortem](../postmortems/unguarded-job-store-and-the-migration-that-migrated-the-laptop.md).

The facts below are the ones that turn a five-minute job into an afternoon, and each fails in a way
that misdirects you.

**Which host.** Supabase offers three, and the obvious one is wrong for production:

| | Use | Why |
|---|---|---|
| direct — `db.<ref>.supabase.co:5432` | local admin work | **IPv6-only** unless the paid IPv4 add-on is on. Works from Greg's laptop; will not resolve from Vercel |
| session pooler | **migrations** | IPv4, and a real session — which DDL and the migrator's bookkeeping both need |
| transaction pooler — port 6543 | **the running app** | one connection per transaction. `LISTEN/NOTIFY`, session advisory locks and `SET` outside a transaction all silently stop working here |

The username differs too: pooler connections are `postgres.<project-ref>`, not plain `postgres`.

**SSL is enforced**, so a plain connection is refused — and `pg` does not use SSL by default, so the
refusal arrives looking like a credentials error. [`scripts/db-migrate.ts`](../../scripts/db-migrate.ts)
handles this off the same is-this-local test that guards remote runs: local is a container with no
certificate and must *not* use SSL; remote must.

**The certificate is committed**, at [`certs/supabase-ca.crt`](../../certs/supabase-ca.crt), and
found by path — so verified connections are the default rather than something to configure.
[certs/README.md](../../certs/README.md) explains why committing a certificate is right here (it is
Supabase's public root CA, carrying no project identifier) and what silently degrades without it:
the connection keeps working and stays encrypted, but stops checking *who it is talking to*, which
looks identical from the outside. [tests/db-tls.test.ts](../../tests/db-tls.test.ts) is the guard.

**Three credentials, and none of them is the superuser.** A runtime role with DML on `spideryarn`
and nothing else; a migration role with DDL; and the browser's publishable key, which reaches Auth
only because `spideryarn` is not an exposed schema. The `postgres` password must not go near Vercel.
Creating those roles is the one genuinely manual step — it needs passwords, which do not belong in a
migration file — and it is [step 1](../plans/postgres-migration.md#the-order-of-work).

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

Seven `owner_id` columns are `references auth.users(id)`. Creating those foreign keys needs
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
-- as `postgres` and inherit its search_path. See docs/plans/semantic-search.md.
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

**It migrates the laptop's container and prints `✓ migrations applied`.** `.env.local` deliberately
beats the shell — [`src/env.ts`](../../src/env.ts), and the reason is good — so a `DATABASE_URL` set
on the command line is *replaced* by the local one before `db-migrate.ts` ever reads it. There is a
one-line warning on stderr, above the output you are actually watching.

So the remote URL has to be set **after** `loadEnvLocal()` runs, not before it. Either export it in
a process that has no `.env.local` to read, or wrap it:

```ts
import { loadEnvLocal } from "../src/env.js";
loadEnvLocal();                                   // let the file win first
process.env.DATABASE_URL = process.env.REMOTE_DATABASE_URL!;   // then override it
await import("../scripts/db-migrate.ts");
```

The same trap catches `npm run db:import` and anything else pointed at the remote from this
directory. It is [silent-success.md](../reusable/silent-success.md) exactly: the check you would
naturally run — "did it say it worked?" — shares its assumption with the code.

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
  [§ RLS and realtime](../plans/deploy-and-repo-move.md#rls-and-realtime-not-now).
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

## Two traps recorded elsewhere, repeated here because they are expensive

- **The Supabase CLI does not know about our migrations.** Ours are Drizzle's, in
  `spideryarn_migrations.__drizzle_migrations`; the CLI reads
  `supabase_migrations.schema_migrations` and sees an empty history. So **`supabase db reset
  --linked` drops `spideryarn` and cannot put it back** — it replays only the migrations it knows
  about, and it knows about none of ours. Never run it against a project that matters. Same for
  `drizzle-kit push`, which introspects a live database and computes a diff; only `generate` and
  `migrate` are safe. See
  [§ A new project](../plans/postgres-migration.md#a-new-project-and-what-that-deletes).
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

## What is not done yet

- **The uplink can be the constraint, and it does not look like one.** On 2026-08-26 this laptop
  uploaded at 6–17 KB/s and a single `INSERT` blew a two-minute `statement_timeout`; the next morning
  the same link ran at 119 KB/s and the whole import took under two minutes. The tell is
  `pg_stat_activity` showing the statement `active` on `Client:ClientRead` — the server waiting for
  you. Measure the upload before blaming the database.
- **Vercel does not have these values yet** — `SPIDERYARN_STORE`, `DATABASE_URL`,
  `SPIDERYARN_OWNER_ID`, `PGSSLROOTCERT`. See [deployment.md](deployment.md#environment-variables).
- **`on delete restrict` is inherited, not chosen.** All seven `owner_id` foreign keys use it, which
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
- [postgres-migration.md](../plans/postgres-migration.md) — the plan, the schema, the honest risks
- [auth.md](auth.md) — why the auth provider and the database are the same decision
- [library.md](library.md) — the homepage, and the one file a move to Postgres goes behind
- [block-ids.md](block-ids.md) — the spine every table keys on
