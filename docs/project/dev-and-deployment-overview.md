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
| `npm run build` | production bundle — the client into `dist/`, **then** the API into `api-dist/`. The same command Vercel runs; `build:client` and `build:api` are the halves |
| `npm run setup` | **a fresh checkout, in one command** — Docker up, migrations, accounts seeded, a shelf you can open. A new box wants this |
| `npm run db:start` · `db:status` · `db:stop` · `db:reset` | the local Supabase stack in Docker. Engine first: `open -a OrbStack` |
| `npm run db:migrate` · `db:generate` | apply `drizzle/`; regenerate after a schema edit. **Migrate after every reset** |
| `npm run db:seed-owner` · `db:admin-password` | the two `auth.users` rows, and the sign-in this machine was given |
| `npm run db:seed-dev` | experimental features on, and three fixture articles on that account's shelf |
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

**If you have never done any of this here, start with the tutorial rather than the reference.**
[260906a-deployment-and-infrastructure.html](../tutorials/260906a-deployment-and-infrastructure.html)
explains the whole of it to somebody who has not opened the code — the four machines, `npm run
deploy` step by step, what a serverless host takes away, and why most of the deploy script is not
deploying but refusing to believe a green light. Open it in a browser. Everything below is the
reference, and is authoritative wherever the two disagree.

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
- **[feedback-reports.md](feedback-reports.md)** — the other half of the Feedback button: how an
  agent works through the reports that arrive, where the queue lives, and why resolving the Sentry
  issue is the whole of the bookkeeping.
- **[logging.md](logging.md)** — why Pino, what the levels mean here, why path-based redaction makes
  the message string a rule, and why the CLI's `console.log` is not logging and is staying.
- **[hetzner-remote-server-box.md](hetzner-remote-server-box.md)** — the always-on Hetzner box and `gjd-remote`, the one command
  that starts a Claude session on it and gets you back into one. Read it before you run anything
  against the box: the server is disposable and the volume is not, `push-env` builds from an
  allowlist rather than copying your `.env.local`, and every pause you will notice is an ssh
  handshake.
- **[overseer-direction.md](overseer-direction.md)** — where the agent fleet dashboard is
  going: a page that shows every session on the box, what it is blocked on, and eventually the
  decisions agents made without asking — with a coordinator agent, not a person, driving the
  steering. Read it before writing anything that talks to a running session, because it holds the
  measured constraints: "needs you" is usually a modal dialog rather than a text prompt, `send-keys`
  is the only delivery channel yet proven, `claude agents --json` is fast but incomplete, and Codex
  batch jobs cannot receive keystrokes at all.
- **[overseer.md](overseer.md)** — the other half, and the one to open if you *are* the Overseer
  rather than building it: the runbook it reads on waking. The four gates on what it may decide on
  Greg's behalf, the standing scheduled jobs, the three deterministic rules that are worth more than
  any amount of judgement, and the traps — a steering message must be one line, `partial` delivery
  means the text landed and the Enter did not, and a pane can show a prompt that nobody typed.
- **[work-reports.md](work-reports.md)** — what an agent claimed: `overseer report` puts progress, a
  block, a decision or completion on the record, the daemon records it, and Greg reads it in the
  Decisions tab's Claims section. A report is a claim, never a state or a permission; read it before
  building anything that treats one as either.
- **[overseer-queue.md](overseer-queue.md)** — the Overseer's slow lane: work Greg approved and
  deferred, one line each and the product question it waits on, so a lull has something queued and
  gate 3's "is it in the queue?" has a place to look. The Spideryarn product plan sits there whole.
- **[fleet-dashboard-modes.md](fleet-dashboard-modes.md)** — the checklist for adding a tab to that
  dashboard: six places across three files, two of which nothing checks; the end-to-end path for a
  datum depending on whether it rides the pushed snapshot or wants its own route; why an on-demand
  route may only block the event loop for work whose worst case it can state; and the etiquette for
  a night when several sessions are adding tabs at once.
- **[readiness.md](readiness.md)** — the Readiness tab: whether the commit `origin/dev` is on is
  known to pass its checks. The one command that makes a run count
  (`readiness-run.ts`, because a plain `npm test` records nothing), the five clauses a green answer
  needs, why `unknown` is the common and correct answer, and why "on dev" is never a claim about
  what is on GitHub now.
- **[usage-history.md](usage-history.md)** — the Usage limits tab's second half: the last 24 hours of
  Claude's limits, which exists only because nothing else writes them down. Why the daemon writes the
  store and the dashboard only reads it, why this one has no writer lock when `~/.fleet-health/`
  does, why recorder health is derived rather than reported across the process boundary, and the
  eight things the chart may not claim — including why a historical point must never be re-checked
  against today's clock.
- **[fleet-recent-messages.md](fleet-recent-messages.md)** — the Recent messages tab, which reads
  every session's transcript at once: why "the last N messages" is a claim the payload has to earn
  rather than a description, the four premises behind it and the six things that demote it, the guard
  turn that stops a half-read turn counting as a whole one, and why the tab is never polled.
- **[changelog.md](changelog.md)** — how a deploy becomes a line on the public `/changelog`: why a
  version *is* a deploy and why Vercel's list rather than git is the only place that knows which shas
  those were, the append-only NDJSON the process writes, and the four stages — a fan-out of small
  agents reading diffs, a big model checking every claim against them, and a copy pass that is
  forbidden to learn anything new.
- **[worktrees.md](worktrees.md)** — how to stop thirteen agents sharing one checkout, and the
  operational half of it: starting one and what it costs, why the local Supabase stays shared for now
  (measured, and it is not the RAM that blocks it), and both runbooks — the trunk flip to `dev`, run
  2026-09-02, and getting the Mac out of Dropbox, done 2026-09-01.

- **[cron-scheduler.md](cron-scheduler.md)** — there is no scheduler, and nothing here runs on a
  clock. Why that keeps producing sweepers with no caller (two of them so far, both correct code that
  is never called), the rule that follows — don't write a cleanup you cannot call — what we do
  instead, and the four jobs that would justify a real cron if it ever gets built.

Connecting to the **remote** database — which host, the SSL `pg` does not do by default, and the
command that migrated the wrong machine while printing success — is in
[database.md § Connecting to the remote](database.md#connecting-to-the-remote).

## Where the code is

[`src/env.ts`](../../src/env.ts), [`src/models.ts`](../../src/models.ts),
[`src/log.ts`](../../src/log.ts), [`scripts/db-migrate.ts`](../../scripts/db-migrate.ts),
[`supabase/config.toml`](../../supabase/config.toml).

---

Up: [AGENTS.md](../../AGENTS.md)
