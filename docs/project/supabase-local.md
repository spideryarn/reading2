# Supabase, running locally

**A whole Supabase stack in Docker on this laptop, and nothing else.** No cloud project, no
`supabase link`, no remote credentials — the CLI mints its own keys and the database is a container.
Set up 2026-08-25.

The reading app still reads and writes JSON files under `data/`; this is the database the storage
layer is being built against, and what [`npm run db:migrate`](../../scripts/db-migrate.ts) points
at while the schema is being worked out. What goes *in* the database is
[260825f-postgres-migration.md](../plans/260825f-postgres-migration.md); where the data lives today is
[database.md](database.md).

## Running it

```bash
npm run setup          # all three of the steps below, in order, on a fresh checkout
npm run db:start       # supabase start — first run pulls ~2 GB of images
npm run db:status      # the URLs and keys again
npm run db:stop        # containers down; the data is kept and restored on next start
npm run db:reset       # wipes the database and replays NOTHING — read below first
npm run db:migrate     # apply drizzle/ — this is what creates the `spideryarn` schema
npm run db:generate    # regenerate drizzle/ SQL after editing src/db/schema.ts
npm run db:seed-owner  # the two auth.users rows: the row-owner, and the account you sign in as
npm run db:admin-password   # the email and password to sign in with, on this machine
```

**`npm run setup` is the one to reach for on a fresh checkout** — a box, a rebuild, a new clone. It
runs `db:start`, `db:migrate` and `db:seed-owner` in that order and stops at the first failure with
what to do about it ([`scripts/setup-local.ts`](../../scripts/setup-local.ts)). Every step is still
its own command, so nothing here has to be done through it. It exists because the order is real and
was written down in three separate docs, and a box got built without two of the steps
([260831x](../plans/260831x-remote-box-dev-environment.md)).

**After any reset, run `npm run db:migrate`.** Our migrations are Drizzle's, in `drizzle/`, and the
Supabase CLI cannot see them — so a reset leaves the `spideryarn` schema absent and
[its tests](../../tests/db-schema.test.ts) go back to skipping rather than failing. They now say so:
the shared probe in [`tests/helpers/pg-ready.ts`](../../tests/helpers/pg-ready.ts) prints one line
naming the suite and the missing table, with `npm run db:migrate` in it — see
[testing.md § A suite that cannot run](testing.md#a-suite-that-cannot-run-and-how-to-make-it-say-so).
The tables and what they promise are in [database.md](database.md#next-supabase-postgres).

**And then run `npm run db:seed-owner`, on a database that has never had one run before.** Skip it
and every insert that carries an `owner_id` has nothing to point at, and the failure does not say
so: `StoreFailure: This app asked its database for something it would not do, so that did not go
through` names neither the constraint nor the fix. `LOG_LEVEL=debug` gives the real answer —
sqlstate `23503`, a foreign key such as `uploads_owner_fk` with no owner row. Found this way
2026-08-31, setting up the remote box: seeding took the suite from 41 failing files to 23.
[database.md § next: Supabase Postgres](database.md#next-supabase-postgres) has the command.

### Signing in, with no Google and no browser you cannot reach

`db:seed-owner` writes **two** rows, and they are two different people:

| | | |
|---|---|---|
| `dev@spideryarn.local` | `DEV_OWNER_ID` | what rows written *outside* a request belong to — the CLI, the pipeline, `db:import`. [`src/owner.ts`](../../src/owner.ts) |
| `greg@gregdetre.com` | `ADMIN_USER_ID_LOCAL` | the account you sign in as, and the one `/api/admin/*` recognises. [`src/admin.ts`](../../src/admin.ts) |

The second has a password, so signing in is the email form on the landing page — no Google, nothing
to click on a dashboard, and no browser on a machine you cannot reach. **That is what makes a fresh
Hetzner box usable**, where the alternative was the noVNC tunnel
([260831ab](../plans/260831ab-seed-local-admin-user-for-remote-box.md)).

```
npm run db:admin-password
```

**The password is generated per machine**, on the first seed, into
`~/.config/spideryarn/local-admin-password` at `0600`. So there is no password in this repo to look
up, the laptop's and the box's are different, and the command above is how you read one. The seed
also prints it once, on the run that creates it.

Not in `.env.local`, deliberately: `gjd-remote push-env` *rebuilds* that file, so a value written on
the box would be destroyed by the next push and a value pushed from the laptop would give both
machines one credential.
[`scripts/seed-accounts.ts`](../../scripts/seed-accounts.ts) carries the rest of the reasoning,
including the constant-in-git version this replaced and why Greg chose against it.

Four things worth knowing before you rely on it:

- **The id is the point, not the address.** `/api/admin/*` gates on a uuid, so signing up by hand
  through the same form gets the right email on a random id and is then refused by the page it was
  meant to open — with the client quietly drawing the shelf instead
  ([260828f](../postmortems/260828f-admin-id-was-the-local-one.md)). Seeding is what puts the account
  at the id `src/admin.ts` already names. If an account already holds that address on another id,
  the seed **refuses and says which of the two things to do**; it does not pick.
- **Re-running it does not sign you out.** It signs in first and writes only when the password is
  actually wrong, because GoTrue's admin password update revokes every session for that user —
  measured, and this is a command you are told to run after every reset.
- **`npm run db:reset` does not change the password**, because the file is not in the database.
  Deleting the file does: the next seed makes a new one and sets it, and every open session for that
  account ends.
- **It refuses to run against anything but this repo's own stack**, and checks that against
  `supabase status` rather than against `SUPABASE_URL` — everything else in the run reads that
  variable, so a forwarded port would have every step agreeing with every other one.

### One shelf, not two — and why it is not switched on

By default the two accounts above mean the library you see when you sign in is **empty**, however
much the CLI has ingested: those rows belong to `DEV_OWNER_ID`. The setting that changes it is

```
SPIDERYARN_OWNER_ID=<the admin id from src/admin.ts>
```

which puts CLI, pipeline and `db:import` work on the shelf you actually look at. It is on
`gjd-remote push-env`'s allowlist ([`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts)),
so a box gets it from the laptop rather than needing a line typed on the box — which that file would
destroy at the next push, since it rebuilds `.env.local` rather than merging into it.

**It is left blank on the laptop, and here is what happens if you set it without moving the rows
first.** Measured 2026-08-31, not predicted: **eight test files go red.** Two shapes, and both are
the same cause:

- `store-shelf-reads` fails on `expected 0 to be greater than 0` — the shelf query runs as the new
  owner and every fixture belongs to the old one, so the corpus it means to check is simply not
  there.
- `store-roundtrip` fails with `PublishRefused: the slug "fowler-phrenology" already belongs to
  another reader`. `articles.slug` is unique across the whole install
  ([src/owner.ts](../../src/owner.ts) says why), so your own articles, under the other id, block
  re-ingesting their own URLs.

Nothing is corrupted by trying it — unset the variable and the suite is green again — but it makes
the point that this is **one setting and a data move, not one setting.** A database that has never
been used without it, which is what a new box is, has neither problem: it is correct from its first
ingest. An existing one needs its rows re-owned first, and that has deliberately not been done here.

Docker has to be running first. On Greg's laptop the `docker` context points at **OrbStack**, so
`open -a OrbStack` is what starts the engine; `docker info` failing with *"Cannot connect to the
Docker daemon"* means it isn't up, even though the socket file at `~/.orbstack/run/docker.sock`
still exists from last time.

**On the remote box, there is no OrbStack.** Docker Engine is installed from Docker's own apt repo
by [`infra/hetzner/provision.sh`](../../infra/hetzner/provision.sh) and runs as a systemd service —
nothing to open. In the Supabase CLI version it pins, the Postgres data directory and storage
objects are bind-mounted from `~/.local/state/supabase/managed/` rather than kept inside Docker, and
on the box that path is on the persistent volume, so a server rebuild loses only re-pullable image
layers, not data — the deliberate reason Docker's own `data-root` was left where it was.
[infra/hetzner/README.md](../../infra/hetzner/README.md) is the box itself;
[260831x-remote-box-dev-environment.md](../plans/260831x-remote-box-dev-environment.md) is the fuller
story of setting this stack up there.

| What | Where |
|---|---|
| Studio (the dashboard, table editor, SQL editor) | <http://127.0.0.1:54363> |
| API gateway — REST, auth, storage | <http://127.0.0.1:54361> |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54362/postgres` |
| Mailpit — every email the local auth server "sends" | <http://127.0.0.1:54364> |

`.env.local` carries `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and
`DATABASE_URL`, loaded by [`src/env.ts`](../../src/env.ts) like everything else
([setup-dev.md § Secrets](setup-dev.md#secrets)). The **remote** project's values sit in `.env.prod`
alongside it — same variable names, so code written against local finds them in production — and
**nothing loads that file**: `src/env.ts` reads `.env.local` and only `.env.local`. Both are
gitignored by `.env*`, which covers the next one somebody makes as well.

**Those keys are not secret.** They are the CLI's fixed local demo values — byte-identical on every
Supabase developer's machine on earth, and signed with a JWT secret that is the literal string
`super-secret-jwt-token-with-at-least-32-characters-long`. Treating them as credentials is a
category error in one direction; forgetting that `service_role` bypasses every policy is the error
in the other, so keep it server-side even here, where "even here" costs nothing.

**And the stack listens on every interface, not just localhost.** `db:start` prints `All services
bind to 0.0.0.0 (network-accessible, not just localhost)`, verified against the CLI's own source.
Combined with keys that are public and identical everywhere, whatever firewall sits in front of the
machine is the *only* thing stopping anyone who can reach these ports from having full access. On
the remote box that is the Hetzner firewall's SSH-and-mosh-only inbound rule
([infra/hetzner/README.md](../../infra/hetzner/README.md)) — worth knowing before anyone edits a
firewall rule there.

Since 2026-08-31 that list has one more entry: the seeded administrator's password, which is also a
constant in git (§ [Signing in](#signing-in-with-no-google-and-no-browser-you-cannot-reach)). It
changes nothing about where the boundary is — anyone reaching this port already holds a service-role
key that outranks any account — but an inbound rule for 54361 now publishes a *login* as well.

## The ports, and the Postgres version

Both live in [`supabase/config.toml`](../../supabase/config.toml), which repeats the reasoning in a
comment at the top, because that file gets regenerated.

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

**`major_version` is 17, and the rule is that it tracks the remote — not the CLI.** It happens to
equal the CLI's default today, which is exactly why it is worth writing down: nobody should read
this line as "we left it alone". It was **15** for the first few hours of this stack's life, pinned
to the old app's project (**15.8**) back when we expected to reuse it
([§ The old project](../plans/260825f-postgres-migration.md#the-old-project-we-inspected-and-did-not-use)). Greg then chose a **new**
project ([§ A new project](../plans/260825f-postgres-migration.md#a-new-project-and-what-that-deletes)),
so local moved to 17. That project now exists — `alschkahzfagtppxspfq`, `eu-west-2` — and reports
**17.6.1.165**; local reports **17.6**. Checked against the dashboard on 2026-08-25 rather than
assumed from the CLI's default, which is the whole point of the rule.

Two reasons to keep them equal rather than merely close. The obvious one is that 17-only SQL written
against a 15 remote fails at deploy time, in something authored weeks earlier. The quieter one is
that a *lower* local version doesn't error either — it just means the thing you tested is not the
thing you shipped, and the difference surfaces as behaviour rather than as a message.

**Changing it is a wipe.** The major version cannot change under an existing data directory, so:

```bash
# after editing major_version in supabase/config.toml
supabase stop --no-backup && supabase start
npm run db:migrate        # every migration has to be applied again
```

Done once already, going 15 → 17, and the local database is empty enough that it cost nothing.
Check what is in it before doing it again — anything applied by hand in Studio, and any auth user
you created to test the gate with, is gone and is not in a migration file.

One more thing worth knowing rather than changing: **`[api].schemas` does not list `spideryarn`.**
The `spideryarn` schema is deliberately invisible to PostgREST, because
[the API layer is the security boundary here](../plans/260825d-deploy-and-repo-move.md#rls-and-realtime-not-now),
not RLS. That is the safe default and it should stay until something specific needs it — see
[§ The Supabase docs' grant block opens the database](../plans/260825f-postgres-migration.md#the-supabase-docs-grant-block-opens-the-database).

## The ways this goes wrong quietly

- **`supabase db reset` is fine locally and catastrophic linked.** `--linked` drops remote objects
  and replays only *this* repo's migrations, so anything the old app owns is gone and not
  recoverable from our history. `npm run db:reset` has no `--linked` in it and must never grow one.
  **This got sharper, not softer, when Spideryarn moved to its own Supabase project
  ([§ A new project](../plans/260825f-postgres-migration.md#a-new-project-and-what-that-deletes)):** our
  migrations are Drizzle's, and the Supabase CLI cannot see them at all. It reads
  `supabase_migrations.schema_migrations`, ours live in `spideryarn_migrations`, so a linked reset
  finds an empty history, drops `spideryarn` and replays nothing. The same applies to
  `drizzle-kit push`, which introspects a live database — only `generate` and `migrate` are safe
  against anything that matters.
- **`npm run db:reset` empties the database and puts nothing back.** `supabase db reset` replays
  `supabase/migrations/`, which is empty here on purpose, so it drops the `spideryarn` schema and
  reports success. It is not the "start again from the schema" command it looks like — that is
  `npm run db:reset` **followed by** `npm run db:migrate`.
- **`npm run db:migrate` goes wherever `DATABASE_URL` points** — and there is now a remote for it to
  point at. [`scripts/db-migrate.ts`](../../scripts/db-migrate.ts) guards this: it refuses any URL
  that is not `127.0.0.1` or `localhost` unless `DB_MIGRATE_ALLOW_REMOTE=yes` is set as well. Keep
  that variable out of every env file and off your shell profile — it is meant to be a thing you
  type deliberately, once, and never a thing that is already true.
- **The CLI picks its project from the working directory.** Run `supabase status` from the old repo
  and you get the old repo's stack, with a confident answer and the wrong ports. The two are told
  apart by `project_id` — ours is `spideryarn2`, theirs is `syr` — which is also what every container
  is named after (`supabase_db_spideryarn2`).
- **Upgrading the CLI and re-running `supabase init --force` rewrites `config.toml`.** The port block
  goes, and `major_version` goes back to whatever the CLI defaults to — which matches the remote
  today only by coincidence. It reports success and `supabase start` works, so the collision shows up
  later, when both stacks are up at once. Diff the file afterwards.
- **`supabase stop` keeps your data; it is not a reset.** So a schema you applied by hand in Studio
  survives a stop/start and does *not* survive a `db:reset`, which is the opposite of what people
  expect from a container. Anything that matters belongs in a migration file.
- **A stale socket looks like a running daemon.** `~/.orbstack/run/docker.sock` exists whether or not
  OrbStack is running. `ls` proves nothing; `docker info` is the check.
- **`docker ps | grep supabase` finds somebody else's stack.** This machine runs more than one
  Supabase project at a time — `_hellozenno` was up alongside `_spideryarn2` on 2026-08-31, twelve
  healthy containers each. Grepping for `supabase` returns another project's stack looking perfectly
  healthy, which is worse than returning nothing. **Filter on `_spideryarn2`**, the `project_id`
  every one of our containers is named after.
- **An empty `docker ps` is not proof there are no containers.** On 2026-08-31 a `docker ps -a`
  piped through `grep` and `head` printed nothing and exited 0, and that was read as "the stack is
  gone". It was not: 24 containers were running and `supabase_db_spideryarn2` had been up 46 hours.
  Same family as the stale socket above — **a check that produces no output looks exactly like a
  check that found nothing.** `docker info` answers "is the daemon up"; `docker ps --format
  '{{.Names}}' | grep _spideryarn2` answers "is our stack up"; neither is answered by silence.

## The `sources` bucket, and the one thing about it that is local-only

Since 2026-08-27 the stack is not only a database here — uploaded PDFs live in Supabase Storage, in
a bucket declared in [`supabase/config.toml`](../../supabase/config.toml):

```toml
[storage.buckets.sources]
public = false
file_size_limit = "50MiB"
allowed_mime_types = ["application/pdf"]
```

`npm run db:start` creates it, so nobody has to remember a dashboard click and nobody has to be told
about it. `sources` and not `pdfs`, because it holds *the document an article was made from*, which
is what `GET /api/source/:slug` already names, and PDFs are only the first kind. Private, always:
these are a reader's own documents.

**Declaring it here does not create it on a remote project.** That needs
`supabase seed buckets --project-ref <ref>` — checked against the CLI we have, 2.115.0; a web search
will tell you the flag is `--linked` and on this version it is not — or the equivalent insert into
`storage.buckets`. It is a deployment step, it is in
[deployment.md](deployment.md#the-sources-bucket-has-to-exist-on-the-remote-too), and it is exactly
the kind of thing that fails by appearing to work: nothing notices a missing bucket until the first
upload.

The whole upload path is [ingest-queue.md § Uploading a PDF](ingest-queue.md#uploading-a-pdf); what
was measured against these containers rather than read in a doc is in
[260826u-pdf-upload-and-storage.md § What was measured, not read](../plans/260826u-pdf-upload-and-storage.md#what-was-measured-not-read).

## What is deliberately not set up

- **Not linked to any cloud project.** Greg's call, 2026-08-25: local first, nothing from the cloud.
  `supabase link` has never been run here, so every command in this file acts on the containers and
  nothing else.
- **`supabase/migrations/` is empty, and stays empty.** That is not a gap — **the Supabase CLI is not
  our migration tool.** The schema lives in [`src/db/schema.ts`](../../src/db/schema.ts), the SQL is
  generated into [`drizzle/`](../../drizzle), and [`npm run db:migrate`](../../scripts/db-migrate.ts)
  applies it against `DATABASE_URL`. Note that it is **not** `drizzle-kit migrate`: drizzle-kit takes
  its connection from [`drizzle.config.ts`](../../drizzle.config.ts), and credentials there would
  also hand a live database to `drizzle-kit push`, which must never reach one. The config is
  credential-free on purpose, so `push` fails with "no connection" rather than relying on everyone
  remembering.
- **No `seed.sql`.** `supabase start` warns about the missing file on every run. That warning is
  expected and harmless until there is something to seed — possibly the `example` fixture, which is
  [an open question](../plans/260825f-postgres-migration.md#open-questions).

So the split is: **the Supabase CLI owns the stack, Drizzle owns the schema inside it.** Anything
that mixes those two up is the class of mistake
[§ A new project, and what that deletes](../plans/260825f-postgres-migration.md#a-new-project-and-what-that-deletes)
is about.

## See also

- [database.md](database.md) — where the data lives today, and the shape it is moving into
- [260825f-postgres-migration.md](../plans/260825f-postgres-migration.md) — the schema, the order of work, the traps
- [auth.md](auth.md) — the one-email beta gate this local auth server will host
- [setup-dev.md](setup-dev.md) — the rest of the dev commands
- [original-version/](original-version/overview.md) — the other repo on this laptop, and its stack
