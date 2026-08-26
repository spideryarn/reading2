# Database

This is a **stub**. Today there is no database: the store is JSON files on disk. It is written now
because [auth.md](auth.md) needed something to point at — the auth decision turns on a foreign key
into `auth.users`, which only makes sense once you know where the rest of the data is going.

## Today: files under `data/<slug>/`

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
  <uuid>.json   one file per upload attempt   (see below)
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

`data/_uploads/` is **queue state, not article state** — created, claimed and finished inside one
ingest, and meaningless once the article exists. It is on the filesystem because `data/_jobs/` is,
and it moves when that moves ([job-queue-rethink.md](../plans/job-queue-rethink.md)). The rules it
obeys are in [`src/source.ts`](../../src/source.ts) and touch no storage, which is what makes that
move a change of adapter.

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

```bash
npm run db:seed-owner   # the one auth.users row every owner_id points at
npm run db:import       # data/<slug>/ → Postgres, idempotent
npm run db:export -- --out /tmp/rollback   # and back out again
```

| File | What it is |
|---|---|
| [`src/store/contracts.ts`](../../src/store/contracts.ts) | the seam — deliberately `src/api.ts`'s surface, function for function |
| [`src/store/index.ts`](../../src/store/index.ts) | which store is in use. **No fallback lives here**, by design |
| [`src/store/pg.ts`](../../src/store/pg.ts) · [`pg-comments.ts`](../../src/store/pg-comments.ts) | the Postgres reader and comment store |
| [`src/store/import.ts`](../../src/store/import.ts) · [`export.ts`](../../src/store/export.ts) | the importer, and the exporter that is the rollback |
| [`src/owner.ts`](../../src/owner.ts) | who owns a row — the one file the beta gate has to change |
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

Everything below is still planned, not built. The whole design — the schema, the reasoning, and the things that break quietly —
is in [postgres-migration.md](../plans/postgres-migration.md). The parts worth knowing before you
touch anything storage-shaped:

- **A block id is an identity; its text is a revision.** Foreign-keying comments to the current block
  rows would have broken a documented behaviour. See [block-ids.md](block-ids.md).
- **The tree stays JSONB; the blocks become rows.**
- **`owner_id uuid not null references auth.users(id)`, from day one** — populated with the session
  user, so no query above the adapter changes when a second person is let in. This is the line that
  decided [the auth choice](auth.md). `not null` on purpose: a row with no owner is not a state this
  system has.
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
eu-west-2, Postgres 17.6, 14 migrations, 14 tables, both roles, the owner account, and five
articles — 635 blocks, 24 comments, 56 chat messages. `listArticles` and `loadArticle` have been
served from it through the **transaction** pooler, which is the path production uses. See
[§ Roles](#roles) for how it was bootstrapped and [§ What is not done](#what-is-not-done-yet) for
what is still missing. Nothing in the *deployed* app points at it yet; `SPIDERYARN_STORE` and
`DATABASE_URL` are recorded in `.env.prod`, which is read by nothing.

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
