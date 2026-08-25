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
```

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

Not needed yet — nothing in the app talks to the remote, and the schema has only ever been applied
to [the local stack](supabase-local.md). Collected here because these four facts are the ones that
turn a five-minute job into an afternoon, and each fails in a way that misdirects you.

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

## See also

- [architecture.md](architecture.md) — the pipeline stages and what a block is
- [supabase-local.md](supabase-local.md) — the Docker stack the schema is developed against
- [certs/README.md](../../certs/README.md) — the CA certificate, why it is committed, and what
  quietly stops being checked without it
- [postgres-migration.md](../plans/postgres-migration.md) — the plan, the schema, the honest risks
- [auth.md](auth.md) — why the auth provider and the database are the same decision
- [library.md](library.md) — the homepage, and the one file a move to Postgres goes behind
- [block-ids.md](block-ids.md) — the spine every table keys on
