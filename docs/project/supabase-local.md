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
npm run setup          # all four of the steps below, in order, on a fresh checkout
npm run db:start       # supabase start — first run pulls ~2 GB of images
npm run db:status      # the URLs and keys again
npm run db:stop        # containers down; the data is kept and restored on next start
npm run db:reset       # wipes the database and replays NOTHING — read below first
npm run db:migrate     # apply drizzle/ — this is what creates the `spideryarn` schema
npm run db:generate    # regenerate drizzle/ SQL after editing src/db/schema.ts
npm run db:seed-owner  # the two auth.users rows: the row-owner, and the account you sign in as
npm run db:seed-dev    # experimental features on, and a few articles on that account's shelf
npm run db:admin-password   # the email and password to sign in with, on this machine
npm run db:reown       # move every row from one owner to another — dry run without --apply
```

**`npm run setup` is the one to reach for on a fresh checkout** — a box, a rebuild, a new clone. It
runs `db:start`, `db:migrate`, `db:seed-owner` and `db:seed-dev` in that order and stops at the first
failure with
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
| `dev@spideryarn.local` | `DEV_OWNER_ID` | what rows written *outside* a request belong to — the CLI and the pipeline. [`src/owner.ts`](../../src/owner.ts) |
| `dev-admin@spideryarn.local` | `ADMIN_USER_ID_LOCAL` | the account you sign in as, and the one `/api/admin/*` recognises. [`src/admin.ts`](../../src/admin.ts) |

The second has a password, so signing in is the email form on the landing page — no Google, nothing
to click on a dashboard, and no browser on a machine you cannot reach. **That is what makes a fresh
Hetzner box usable**, where the alternative was the noVNC tunnel
([260831ab](../plans/260831ab-seed-local-admin-user-for-remote-box.md)).

**Neither address is a real person's, and that is the point.** The sign-in account was
`greg@gregdetre.com` until 2026-09-02 — the same address as Greg's *production* account, which is a
different account on a different project reached by a different sign-in. Greg:

> I worry about confusion, because greg@gregdetre.com is my real user on production with Google
> login. So I'd like the dev-dummy user to be called something distinct and different, and that
> highlights it's a dummy.
>
> — Greg, 2026-09-02

**Nothing that decides anything read the address.** `/api/admin/*` compares uuids and
`SPIDERYARN_OWNER_ID` is a uuid, so authorization and ownership are untouched. Plenty of things
*display* it — the sign-in form, the profile page, `/admin/users`, a feedback report's reporter —
which is the point: those are what a person reads.
[`src/admin.ts` § `ADMIN_EMAIL_LOCAL`](../../src/admin.ts) has the reasoning.

Two things the rename does not reach, both found by GPT Sol rather than by running it:

- **A browser you are already signed in to keeps showing the old address** until its session
  refreshes, because the email is a claim inside the JWT it is holding. Sign out and in, or wait for
  the refresh.
- **A `google` identity keeps the address Google gave it.** GoTrue stores one row per sign-in method
  and the rename updates only the `email` one, so a machine whose local account began as a Google
  sign-in — Greg's laptop may be one; this box is not — stays renamed on the surface and old
  underneath, in Studio and on the profile page. `db:seed-owner` **says so** when it sees one, and
  deliberately does not delete it: removing an identity is destructive and is Greg's call.

**A machine seeded before then catches up on its own.** `db:seed-owner` renames the row rather than
refusing, and says so; the password and every open session survive it. It is the one rename this
repo performs unasked, and `planAccountEmail` in
[`scripts/seed-accounts.ts`](../../scripts/seed-accounts.ts) is the four-part fence that makes it
safe: local stack, one fixed id, one fixed old address, nothing destroyed.

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

**And a browser can sign itself in with it**, which is what makes UI checks possible on a machine
with no human at the keyboard:

```
npx tsx scripts/browser-sign-in.ts
```

[`scripts/browser-sign-in.ts`](../../scripts/browser-sign-in.ts) reads this password, launches
Playwright, types it into the real form, and does not return until `GET /api/library` has answered
200 — the server accepting the token, rather than anything the client drew. `signIn(page)` and
`signedInBrowser()` are exported for a script of your own.
[browser-testing-playwright.md § Signing in](browser-testing-playwright.md#signing-in) is where to
read about it.

### One shelf, and how to get there

Rows written **outside** a request — the CLI, the pipeline, `db:import` — belong to whoever
`SPIDERYARN_OWNER_ID` names, and unset that is `DEV_OWNER_ID`, which nobody signs in as. So the
library you see after signing in is empty however much has been ingested, and nothing looks wrong:
the ingest succeeds and the article really is in the database.

**Set it to the administrator's id from [`src/admin.ts`](../../src/admin.ts).** It is on
`gjd-remote push-env`'s allowlist ([`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts)),
so a new box gets it from the laptop and is correct from its first ingest — which is the case that
needs nothing else, because a database that has never been used without it has no rows to move.

```
SPIDERYARN_OWNER_ID=<the admin id from src/admin.ts>
```

**On a database that already has rows, move them — and in this order**, because the move takes no
table lock and anything still writing as the old owner while it runs is neither moved nor noticed
(GPT Sol, 2026-09-01):

1. **Stop the writers** — the dev server, any pipeline run.
2. **Set `SPIDERYARN_OWNER_ID`**, so whatever starts up next is already writing to the destination.
   Between this step and the next, the suite is in the state that turns files red; it is a minute.
3. **Move the rows.**
4. **Start the writers again.**

```
npm run db:reown             # dry run: does every update, then rolls it back
npm run db:reown -- --apply
```

[`scripts/db-reown.ts`](../../scripts/db-reown.ts) moves every row from one owner to another, on a
local database only. Five things about it are deliberate:

- **It says which database it is about to rewrite**, as a password-stripped `Target:` line, before
  it connects — because `.env.local` beats a `DATABASE_URL` exported in the shell, so
  `DATABASE_URL=… npm run db:reown` does not do what it looks like. Same trap, same answer, as
  [database.md](database.md#database_url-npm-run-dbmigrate-does-not-do-what-it-looks-like).
- **A loopback address is not the check.** An `ssh -L` forwarding a remote Postgres onto 127.0.0.1
  satisfies `isLocalDatabaseUrl` exactly as the real container does — Sol ran the case. So the
  identity is settled against `supabase status`, which describes this repo's own containers and
  which no port forwarding can change. The rule is pure and lives in
  [`scripts/db-reown-rules.ts`](../../scripts/db-reown-rules.ts) with
  [its test](../../tests/db-reown-rules.test.ts), because the script does its work at import time.
- **It reads the owned tables out of `information_schema`**, base tables only, not from a list in
  the file. A list would be right the day it was written and quietly short after the next migration,
  and a re-own that misses a table strands rows under an owner nobody signs in as — which looks like
  nothing being wrong until somebody opens the feature that reads them.
- **The dry run is the real write, rolled back.** Not a `select count(*)`: it runs every `update`
  inside a transaction and then rolls back, so the counts are the counts and a unique violation is
  found by Postgres rather than predicted by us. The queue's unique indexes on `jobs` are **partial**
  — four of them, [`src/db/schema.ts`](../../src/db/schema.ts) — and any prediction we wrote here
  would have to re-implement four predicates to avoid crying wolf.
- **It counts again after committing** and names anything that arrived under the old owner while it
  ran. "Nothing was left behind" and "nothing was left behind that we looked for" are different
  sentences, and this is the one that earns the first.

**`article_visibility_changes.actor_owner_id` is left alone.** It records who pressed publish, not
who owns something, and it is not an `owner_id`, so the discovery query never sees it.
**Supabase Storage needs nothing moved**: every row in `storage.objects` has a null `owner`, the
canonical objects are content-addressed and shared between owners by design, and a `staging/<upload
id>` object is reached through the `uploads` row that names it, which does move.

**Skipping the move is what turned eight test files red** when this was measured on 2026-08-31 —
`store-shelf-reads` on `expected 0 to be greater than 0`, because the shelf query runs as the new
owner and every fixture belongs to the old one; `store-roundtrip` on `PublishRefused: the slug
"fowler-phrenology" already belongs to another reader`, because `articles.slug` is unique across
the whole install ([src/owner.ts](../../src/owner.ts) says why). Both are the same cause and both go
away once the rows have moved: done on the box on 2026-09-01, 111 rows across six tables, and the
seven owner-sensitive suites read 363 passed before and 363 passed after.

`npm run setup` says which of the two states this machine is in, on its last line, because the
failure is an absence and an absence needs a check rather than a reader. It cannot fix it: the value
belongs in `.env.local`, and `push-env` **rebuilds** that file from the laptop's copy, so a line
written on the box would be destroyed by the next push and would have looked fine in between.

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

Since 2026-08-31 that list has one more entry: the seeded administrator's *account*, which now has a
password (§ [Signing in](#signing-in-with-no-google-and-no-browser-you-cannot-reach)). It changes
nothing about where the boundary is — anyone reaching this port already holds a service-role key that
outranks any account — but an inbound rule for 54361 now publishes a *login* as well. The password
itself is generated per machine into `~/.config/spideryarn/local-admin-password` and is **not** in
git; this sentence said "a constant in git" until 2026-09-02, describing the version Greg rejected
before it shipped.

### A shelf with something on it

An account you can sign in to is half of it. The other half is having something to open, and a fresh
box has nothing: the corpus under `tests/fixtures/data-root/` is tracked in git but it is in the
*filesystem* store's layout, and until 2026-09-02 nothing put it into Postgres outside the test suite.

```
npm run db:seed-dev
```

[`scripts/db-seed-dev.ts`](../../scripts/db-seed-dev.ts) turns **Experimental Features** on for the
account you sign in as, and puts three corpus articles on its shelf — `writes`, `todo` and
`openai-huggingface`. `npm run setup` runs it as its fourth step, so a box built the documented way
ends with a shelf you can open. Five things about it are deliberate:

- **It is not an account seed and not a third account.** `db:seed-owner` writes the rows; this needs
  one of them to exist already. The argument against adding a `dev@` sign-in account is in
  [260902d](../plans/260902d-a-dev-account-that-is-ready-to-use-on-every-box.md), and it comes down to
  `/api/admin/*` gating on a uuid allowlist.
- **It is not an importer.** It calls `loadArticleIntoPg` from
  [`tests/helpers/load-article.ts`](../../tests/helpers/load-article.ts), which drives the real write
  path. That makes it the **one thing under `scripts/` that imports from `tests/`** — a deliberate
  precedent, because the alternative is a second files → Postgres implementation, which is exactly
  what deleting `db:import` was for.
- **Three of the corpus's five, and never the other two.** `constitution` has no `labels.sourceHash`,
  so `publishRevision` is designed to refuse it — putting it on a shelf is not possible. `noema-…`
  publishes perfectly well and is excluded for a weaker reason: it has no `raw.json`, so there is no
  original document behind it, which is a poor first article to hand somebody.
- **Idempotent on "can it be opened", not "is there a row" and not "is it on the shelf".**
  `beginRevision` writes the `articles` row before there is anything in it, so a half-failed seed
  leaves a slug with `current_revision_id` null; keyed on the row, every later run would call that
  "already seeded". Keyed on the *shelf* it is subtler and still wrong: the library read trusts a
  cached `block_count`, so an article whose block rows have gone is still listed while
  `GET /api/article/<slug>` answers 404. So the question asked is `loadArticle`, the reading route's
  own. A slug owned by *somebody else* is reported and left alone — `articles.slug` is globally
  unique, and moving rows is `db:reown`'s decision, not this one's.
- **It ends by opening every article it seeded**, one at a time, and names any that will not open.
  A count proves nothing — eleven old articles and three failed fixtures look healthy — and a shelf
  listing proves less than it appears to, for the cached-`block_count` reason above. It holds the
  corpus lock across that phase, the same lock `store-parity` and `store-roundtrip` take, so a test
  run cannot clear the corpus between the last load and the answer.

**A full `npm test` turns Experimental Features back off.**
[`tests/owner-isolation.test.ts`](../../tests/owner-isolation.test.ts) deletes the environment
owner's `reader_profiles` row in an `afterAll`, and on a machine where `SPIDERYARN_OWNER_ID` is the
administrator — which is what everything above tells you to do — that is this account's row. Nothing
is wrong; re-run `npm run db:seed-dev` and it is on again in a second, with a new "since" date. Worth
knowing before you go looking for a bug in the switch, which is what the date moving looks like.

**It exits non-zero when `SPIDERYARN_STORE` is not `postgres`, and that is deliberate.** This script
is a CLI script, `tsx scripts/db-seed-dev.ts`, and the variable defaults to `files` for those
([`src/store/live.ts`](../../src/store/live.ts)) — unlike `npm run dev`, which since 2026-09-02
defaults to `postgres` on its own. So the check is really asking whether *this process's* copy of
the variable agrees with what the dev server will use: if `.env.local` has no `SPIDERYARN_STORE`
line, this script sees "unset" (→ `files`) while a plain `npm run dev` will still read Postgres —
but anyone who has set `SPIDERYARN_STORE=files` explicitly, or starts the server some other way,
gets the old failure: every row this wrote is invisible in the browser, the seed works and the shelf
looks empty. A green `npm run setup` over that is the exact failure this command exists to prevent,
so it stops instead. **The seed itself has already committed by then**, so fixing the variable and
re-running costs a second. Set `SPIDERYARN_STORE=postgres` in `.env.local` **on the laptop**; it is
on `push-env`'s allowlist since 2026-09-02, so the box inherits it, and a line typed on the box would
be destroyed by the next push.

And the end-to-end check, which needs no human:

```
npx tsx scripts/browser-sign-in.ts --at /read/writes
```

That signs a browser in with this machine's password, opens a seeded article and fails on any failing
`/api/` call. Note `--at /read/todo` **fails on purpose**: that fixture deliberately has no arc and no
glossary, so those routes 404. Use `writes`.

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
- **`project_id` is still `spideryarn2`, and the directory is `reading2`. Leave the mismatch
  alone.** The field names a *local Docker stack*, not the checkout; it is set explicitly in
  `config.toml` so that the stack is decoupled from wherever the directory lives, which is what let
  the repo move out of Dropbox on 2026-09-01 without touching the database
  ([260901e](../plans/260901e-move-repo-out-of-dropbox-to-dev-spideryarn-reading2.md)).
  Tidying it to `reading2` looks like it works and is a data loss: new `project_id` means new
  container names and **new empty volumes**, so `supabase start` comes up green and healthy with no
  articles, no auth identities and no storage objects, while the real ones sit in the
  `supabase_db_spideryarn2` volume that nothing now points at. Run `npm run setup` afterwards and it
  looks healthier still — schema applied, accounts seeded. Changing it is a volume migration with
  its own plan, not a rename.
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
