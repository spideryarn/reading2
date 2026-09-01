# Dev and deployment overview

Running Spideryarn on your laptop, and shipping it. One process and one terminal — `npm run dev`
serves the client *and* the API as Vite middleware — and one Vercel project fed by `main`.

## Two rules first

- **Several agents work this one tree at once.** Commit only your own files, naming them on
  `git add` *and* on `git commit`. The `--` at the end is load-bearing:
  [version-control.md](version-control.md) has the recipe and the accident behind it.
- **A push to `main` and a `vercel deploy` build different code** — the commit, versus whatever is
  on your disk. A green build here says nothing about whether `main` builds, and the first git
  deploy proved it: [deployment.md § Deploying](deployment.md#deploying).

## The commands

| Command | What it does |
|---|---|
| `npm install`, then `npm run dev` | Vite + the API middleware, <http://localhost:5273>. **The port has to be 5273** — the auth allow-list names it |
| `npm run dev:pretty` | the same, through `pino-pretty`, for a human |
| `npm test` · `npm run typecheck` · `npm run lint` | when you finish a change, not just before you commit |
| `npm run build` | production bundle into `dist/` |
| `npm run setup` | **a fresh checkout, in one command** — Docker up, migrations, accounts seeded. A new box wants this |
| `npm run db:start` · `db:status` · `db:stop` · `db:reset` | the local Supabase stack in Docker. Engine first: `open -a OrbStack` |
| `npm run db:migrate` · `db:generate` | apply `drizzle/`; regenerate after a schema edit. **Migrate after every reset** |
| `npm run db:seed-owner` · `db:admin-password` | the two `auth.users` rows, and the sign-in this machine was given |
| `npm run cost` | what the model calls have cost — this UTC month by default; `-- --month 2026-07`, `-- --all`, `-- --reconcile` |

Secrets are one gitignored `.env.local`, and **it beats what your shell exported** — so
`FOO=… npm run dev` does not do what it looks like. Copy `.env.example` and edit the file.

### The pipeline, one stage at a time

Every stage re-runs on its own **through the queue** — `POST /api/jobs { slug, steps, force }`
([ingest-queue.md](ingest-queue.md)). Five stages also have an npm script, the ones that take a URL,
a file or a `blocks.json`; the eight that read an article out of a folder lost theirs on 2026-09-01.
You rarely need the scripts — pasting a URL
into the homepage runs the same chain through the ingest queue — but they are how you look at one
stage's output. The list, with what each argument means, is in
[setup-dev.md](setup-dev.md); `package.json` is the authority. `npm run validate-tree -- <dir>`
is the one worth knowing unprompted: a bad tree draws a *wrong article* rather than crashing.

## The docs

- **[setup-dev.md](setup-dev.md)** — the long version of the above: the four env variables without
  which you get a blank page, and **which model each job uses** — two tiers, and three spellings of
  a model id of which only one is a name.
- **[supabase-local.md](supabase-local.md)** — the stack in Docker: the ports, why the local keys
  are not secrets, and the five ways it fails quietly — a stale socket that looks like a running
  daemon among them.
- **[version-control.md](version-control.md)** — the remote, and why a commit can be green here and
  broken everywhere else.
- **[debugging.md](debugging.md)** — **start here when something is broken.** A signposting page:
  which of the three places (health, Vercel logs, Sentry) answers which question, and in what order.
- **[deployment.md](deployment.md)** — Vercel: the domain move that never touched the registrar, the
  build that reports success and ships a function failing on every request, and who can reach the
  app today (more people than you would think). The *process* side.
- **[vercel-hosting-deployment.md](vercel-hosting-deployment.md)** — the *inspection* side: the two
  log queries and the three traps, including the one that cost an afternoon — the Vercel error
  dashboard never shows an application failure, because the app answered 200.
- **[sentry-error-monitoring.md](sentry-error-monitoring.md)** — it is installed and it is on, which
  is not what a quick grep suggests. What reaches it, why a failed step is a 200, and the two gaps.
- **[ai-gateway.md](ai-gateway.md)** — every paid call goes through one of two seams, and each one
  leaves a row behind. `npm run cost` is how you read them back.
- **[feedback.md](feedback.md)** — the Feedback button and where a bug report goes: our own Postgres
  first, Sentry second, and an allowlist between the browser and both. The one place a reader's own
  prose is deliberately allowed out, which is why the rule for adding a field is written down.
- **[logging.md](logging.md)** — why Pino, what the levels mean here, why path-based redaction makes
  the message string a rule, and why the CLI's `console.log` is not logging and is staying.
- **[hetzner-remote-server-box.md](hetzner-remote-server-box.md)** — the always-on Hetzner box and `gjd-remote`, the one command
  that starts a Claude session on it and gets you back into one. Read it before you run anything
  against the box: the server is disposable and the volume is not, `push-env` builds from an
  allowlist rather than copying your `.env.local`, and every pause you will notice is an ssh
  handshake.
- **[worktrees.md](worktrees.md)** — the plan to stop thirteen agents sharing one checkout, and
  the operational half of it: what the trunk move to `dev` costs, why the local Supabase stays
  shared for now (measured, and it is not the RAM that blocks it), and the two runbooks that are
  written but not yet run — flipping the trunk, and getting the Mac out of Dropbox.

Connecting to the **remote** database — which host, the SSL `pg` does not do by default, and the
command that migrated the wrong machine while printing success — is in
[database.md § Connecting to the remote](database.md#connecting-to-the-remote).

## Where the code is

[`src/env.ts`](../../src/env.ts), [`src/models.ts`](../../src/models.ts),
[`src/log.ts`](../../src/log.ts), [`scripts/db-migrate.ts`](../../scripts/db-migrate.ts),
[`supabase/config.toml`](../../supabase/config.toml).

---

Up: [AGENTS.md](../../AGENTS.md)
