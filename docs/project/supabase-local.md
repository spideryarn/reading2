# Supabase, running locally

**A whole Supabase stack in Docker on this laptop, and nothing else.** No cloud project, no
`supabase link`, no remote credentials — the CLI mints its own keys and the database is a container.
Set up 2026-08-25.

The reading app still reads and writes JSON files under `data/`; this is the database the storage
layer is being built against, and the thing [`drizzle-kit migrate`](../../drizzle.config.ts) points
at while the schema is being worked out. What goes *in* the database is
[postgres-migration.md](../plans/postgres-migration.md); where the data lives today is
[database.md](database.md).

## Running it

```bash
npm run db:start       # supabase start — first run pulls ~2 GB of images
npm run db:status      # the URLs and keys again
npm run db:stop        # containers down; the data is kept and restored on next start
npm run db:reset       # wipes the database and replays NOTHING — read below first
```

Docker has to be running first. Greg's `docker` context points at **OrbStack**, so `open -a
OrbStack` is what starts the engine; `docker info` failing with *"Cannot connect to the Docker
daemon"* means it isn't up, even though the socket file at `~/.orbstack/run/docker.sock` still
exists from last time.

| What | Where |
|---|---|
| Studio (the dashboard, table editor, SQL editor) | <http://127.0.0.1:54363> |
| API gateway — REST, auth, storage | <http://127.0.0.1:54361> |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54362/postgres` |
| Mailpit — every email the local auth server "sends" | <http://127.0.0.1:54364> |

`.env.local` carries `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and
`DATABASE_URL`, loaded by [`src/env.ts`](../../src/env.ts) like everything else
([setup-dev.md § Secrets](setup-dev.md#secrets)).

**Those keys are not secret.** They are the CLI's fixed local demo values — byte-identical on every
Supabase developer's machine on earth, and signed with a JWT secret that is the literal string
`super-secret-jwt-token-with-at-least-32-characters-long`. Treating them as credentials is a
category error in one direction; forgetting that `service_role` bypasses every policy is the error
in the other, so keep it server-side even here, where "even here" costs nothing.

## The two settings that are not the default

Both are in [`supabase/config.toml`](../../supabase/config.toml), which also says this in a comment
at the top, because that file gets regenerated.

**Ports are the `5436x` block, not the CLI's `5432x`.** The old app at
`/Users/greg/dev/spideryarn/reading` runs *its own* local Supabase
([original-version/](original-version/overview.md)) on 54341–54344, and it leaves the CLI defaults in
place for the shadow database (54320) and the pooler (54329) — which are exactly the two the
defaults would have collided with. Both stacks need to be able to run at once, so ours moved
wholesale rather than in the two spots that clash today.

| | Ours | Theirs | CLI default |
|---|---|---|---|
| API | 54361 | 54341 | 54321 |
| Postgres | 54362 | 54342 | 54322 |
| Studio | 54363 | 54343 | 54323 |
| Mailpit | 54364 | 54344 | 54324 |
| Analytics | 54367 | — | 54327 |
| Shadow db | 54360 | 54320 | 54320 |
| Pooler | 54369 | 54329 | 54329 |

**Postgres is 15.8, not the CLI's default 17 — and this one is now unfinished business.** It was
pinned to match the remote we expected to reuse, the old app's project, which runs **15.8**
([§ The live project](../plans/postgres-migration.md#the-live-project)). Hours later Greg reversed
that and chose a **new** project instead ([§ A new project](../plans/postgres-migration.md#a-new-project-and-what-that-deletes)) —
and a new Supabase project is created on 17. So local is currently pinned to the version of a
database we have decided not to use.

It is pinned in the *safe* direction, which is why it has not been changed in a hurry: writing SQL
on 15 and running it on 17 works, and 17-on-15 is the pairing that fails at deploy time in something
written weeks earlier. But it is still a mismatch, and the moment the new project exists this line
should move to whatever that project actually reports. Changing it is one line in `config.toml`,
then `supabase stop --no-backup && supabase start` — **the major version cannot change under an
existing data directory**, so that is a wipe, and every migration has to be re-applied with
`drizzle-kit migrate` afterwards.

One more thing worth knowing rather than changing: **`[api].schemas` does not list `spideryarn`.**
The `spideryarn` schema is deliberately invisible to PostgREST, because
[the API layer is the security boundary here](../plans/deploy-and-repo-move.md#rls-and-realtime-not-now),
not RLS. That is the safe default and it should stay until something specific needs it — see
[§ The Supabase docs' grant block opens the database](../plans/postgres-migration.md#the-supabase-docs-grant-block-opens-the-database).

## The ways this goes wrong quietly

- **`supabase db reset` is fine locally and catastrophic linked.** `--linked` drops remote objects
  and replays only *this* repo's migrations, so anything the old app owns is gone and not
  recoverable from our history. `npm run db:reset` has no `--linked` in it and must never grow one.
  **This got sharper, not softer, when Spideryarn moved to its own Supabase project
  ([§ A new project](../plans/postgres-migration.md#a-new-project-and-what-that-deletes)):** our
  migrations are Drizzle's, and the Supabase CLI cannot see them at all. It reads
  `supabase_migrations.schema_migrations`, ours live in `spideryarn_migrations`, so a linked reset
  finds an empty history, drops `spideryarn` and replays nothing. The same applies to
  `drizzle-kit push`, which introspects a live database — only `generate` and `migrate` are safe
  against anything that matters.
- **`npm run db:reset` empties the database and puts nothing back.** `supabase db reset` replays
  `supabase/migrations/`, which is empty here on purpose, so it drops the `spideryarn` schema and
  reports success. It is not the "start again from the schema" command it looks like — that is
  `npm run db:reset` **followed by** `drizzle-kit migrate`.
- **The CLI picks its project from the working directory.** Run `supabase status` from the old repo
  and you get the old repo's stack, with a confident answer and the wrong ports. The two are told
  apart by `project_id` — ours is `spideryarn2`, theirs is `syr` — which is also what every container
  is named after (`supabase_db_spideryarn2`).
- **Upgrading the CLI and re-running `supabase init --force` rewrites `config.toml`** and throws the
  port block and the Postgres version away. It reports success, `supabase start` works, and the
  collision only shows up when both stacks are up at once. Diff the file afterwards.
- **`supabase stop` keeps your data; it is not a reset.** So a schema you applied by hand in Studio
  survives a stop/start and does *not* survive a `db:reset`, which is the opposite of what people
  expect from a container. Anything that matters belongs in a migration file.
- **A stale socket looks like a running daemon.** `~/.orbstack/run/docker.sock` exists whether or not
  OrbStack is running. `ls` proves nothing; `docker info` is the check.

## What is deliberately not set up

- **Not linked to any cloud project.** Greg's call, 2026-08-25: local first, nothing from the cloud.
  `supabase link` has never been run here, so every command in this file acts on the containers and
  nothing else.
- **`supabase/migrations/` is empty, and stays empty.** That is not a gap — **the Supabase CLI is not
  our migration tool.** The schema lives in [`src/db/schema.ts`](../../src/db/schema.ts), the SQL is
  generated into [`drizzle/`](../../drizzle), and `drizzle-kit migrate` applies it against
  `DATABASE_URL`. Read [`drizzle.config.ts`](../../drizzle.config.ts) before running anything: it
  explains why `push` is never safe and why the ledger is deliberately in its own schema.
- **No `seed.sql`.** `supabase start` warns about the missing file on every run. That warning is
  expected and harmless until there is something to seed — possibly the `example` fixture, which is
  [an open question](../plans/postgres-migration.md#open-questions).

So the split is: **the Supabase CLI owns the stack, Drizzle owns the schema inside it.** Anything
that mixes those two up is the class of mistake
[§ A new project, and what that deletes](../plans/postgres-migration.md#a-new-project-and-what-that-deletes)
is about.

## See also

- [database.md](database.md) — where the data lives today, and the shape it is moving into
- [postgres-migration.md](../plans/postgres-migration.md) — the schema, the order of work, the traps
- [auth.md](auth.md) — the one-email beta gate this local auth server will host
- [setup-dev.md](setup-dev.md) — the rest of the dev commands
- [original-version/](original-version/overview.md) — the other repo on this laptop, and its stack
