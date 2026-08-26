# Deployment

Spideryarn on Vercel: how it gets there, what is live, and the four things that
break without saying so.

> I'm inclined to think we should set up a new Vercel project, rather than
> interfering with the existing one there too. […] Ideally we'd get to the point
> where we're live in Vercel (though using a temporary url rather than the proper
> spideryarn.com domain — that's a later step)
>
> — Greg, 2026-08-26

The plan behind this is [deploy-and-repo-move.md](../plans/deploy-and-repo-move.md),
which is still the place for *why a new project* and for the domain move that has
not happened. This file is what exists now.

## Where it is

| | |
|---|---|
| Vercel project | **`spideryarn`**, team `greg-detre` — a new project. `spideryarn-reading`, which serves spideryarn.com, is untouched |
| Git | **none.** This repo has no remote, so deploys are `vercel deploy` from a working directory. Nothing rebuilds on push, because there is nothing to push to |
| Region | `lhr1` (London), chosen to match the Supabase project in `eu-west-2`. The edge answers from wherever you are; the *function* runs in London, next to the database |
| Node | 24.x. Greg, 2026-08-26: *"I'm happy to use Node 24 unless there's a good reason not to"* — there was one candidate reason and it turned out to be false, see [require(ESM)](#the-runtime-has-requireesm-turned-off) |
| URL | a per-deployment `spideryarn-<hash>-greg-detre.vercel.app` |

**There is deliberately no `spideryarn.vercel.app`.** It existed for about twenty
minutes and was removed, because it is the one URL the protection below does not
cover — see [Who can reach it](#who-can-reach-it).

## Deploying

```
vercel deploy --prod --scope greg-detre
```

That is the whole command. It uploads the working directory (minus
[`.vercelignore`](../../.vercelignore)), installs, builds, and prints a URL.

**It deploys your working tree, not a commit.** With several agents live in this
directory that is worth saying out loud: whatever is on disk is what ships,
including someone else's half-finished edit. Exporting `HEAD` instead is the
obvious fix and did not work on 2026-08-26, because `HEAD` did not build —
`src/routes.ts` had been committed importing two files nobody had `git add`ed.
Check `npm test` and `npm run typecheck` before deploying and read whose errors
they are.

### The build is two commands, and the second one is the point

```
npm run build && npx vite build --config vite.api.config.ts
```

The first builds the client into `dist/`. The second compiles the API into
`api-dist/vercel.js`, and [vite.api.config.ts](../../vite.api.config.ts) explains
at length why it has to exist: Vercel compiles TypeScript under `api/` with this
repo's **TypeScript 7**, which its builder cannot drive, and then *reports
success and ships a function that fails on every request*. So `api/` holds one
hand-written JavaScript file — [`api/index.js`](../../api/index.js) — and the
real handler is [`src/vercel.ts`](../../src/vercel.ts), compiled by the same tool
that compiles the client.

This is the same shape as [linting.md](linting.md): TypeScript 7 removed the API
ESLint needed, and it removed the one Vercel's builder needs too.

## Who can reach it

**Vercel Authentication, set to "production deployment URLs and all previews".**
Every URL this project has asks for a Vercel login, and only Greg gets in. No
code, one setting.

The thing to understand — because it is a trap and not a detail — is what Vercel
counts as a *production domain*. On the Pro plan those cannot be SSO-protected at
all, and `<project>.vercel.app` **is one**. So while `spideryarn.vercel.app`
existed it served the whole app to anybody, with the protection switched on and
reporting itself as enabled. Removing the domain is what actually closed it.

The cost is that each deploy has a new hostname. That is the accepted trade for
now — Greg, 2026-08-26, chose it over the alternatives. It stops being the answer
when [the beta gate](../plans/deploy-and-repo-move.md#the-beta-gate) lands, which
is what the real domain needs anyway.

## Environment variables

Set on the project, for `production` and `preview`. None of them lives in a file
here; [`.env.prod`](../../.env.example) is a record of what production needs and
is read by nothing.

| | |
|---|---|
| `SPIDERYARN_STORE=postgres` | which store serves reads. **Unset means `files`**, and on a host with no durable disk that is an empty shelf and a 200 |
| `DATABASE_URL` | Supabase's **transaction** pooler, port 6543. See [database.md § Connecting to the remote](database.md#connecting-to-the-remote) for why that one and not the other two |
| `PGSSLROOTCERT=certs/supabase-ca.crt` | **required here, unlike locally** — see [the certificate](#the-certificate-moved-and-nothing-would-have-said-so) |
| `NODE_OPTIONS=--experimental-require-module` | see [require(ESM)](#the-runtime-has-requireesm-turned-off) |
| `NODEJS_HELPERS=0` | see [the request body](#the-request-body) |
| `ANTHROPIC_API_KEY` | the pipeline stages. Note it is *not* in `.env.local` — it comes from Greg's shell, so it is the easy one to forget |
| `OPENROUTER_API_KEY` | explain, and chat |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | for the beta gate, which does not exist yet |
| `LOG_LEVEL=info` | [logging.md](logging.md) |

## `/api/health`, and why to look at it first

`GET /api/health` reports what the deployment **is**, rather than what we believe
we configured: which store is serving reads, whether TLS verifies the server,
what `req.url` looked like when it arrived, the Node version, the region, and
which environment variables are set — names only, never values.

It is deliberately hard to please. Anything in `warnings` makes it 503. An
earlier version returned 200 whenever nothing threw, which meant it went green
with the wrong store, with unverified TLS, and with an empty database — the three
things it exists to catch. A health check that passes when the deployment is
wrong is worse than none, because it is the thing you point at to argue nothing
is wrong. [silent-success.md](../reusable/silent-success.md).

## The four that fail quietly

Each of these was found on 2026-08-26, each reported success while being wrong,
and each is written up in
[first-vercel-deploy-silent-failures.md](../postmortems/first-vercel-deploy-silent-failures.md).

### The build compiles TypeScript it cannot compile

`error TS2688: Cannot find type definition file for 'node'` appears in the build
log, and then the build **succeeds** and uploads a function that answers
`FUNCTION_INVOCATION_FAILED` on every request, with the reason in no log at all.
Fixed structurally — there is no TypeScript under `api/` for it to find. If you
ever add a `.ts` file there, this comes back.

### `[...path]` is not a catch-all

Vercel's filesystem routing treats **every** bracketed filename as one segment;
the `...` is a Next.js convention and is not honoured here. Measured:

```
/api/library         -> reached the function
/api/article/writes  -> 404 NOT_FOUND, from the platform
/api/jobs/abc/retry  -> 404 NOT_FOUND, from the platform
```

That is nearly every route in [`src/routes.ts`](../../src/routes.ts), failing
before any of our code runs and therefore appearing in no log we write. The
catch-all is an explicit rewrite in [`vercel.json`](../../vercel.json) instead,
carrying the real path in `__spy_path`, and `originalUrl` in
[`src/vercel.ts`](../../src/vercel.ts) puts `req.url` back together before
anything routes on it. [`tests/vercel-url.test.ts`](../../tests/vercel-url.test.ts)
pins the two nasty cases: a second `__spy_path` supplied by the client, and the
decode that has to happen **exactly once** because Vercel encodes exactly once.

### The runtime has `require(ESM)` turned off

`jsdom` → `html-encoding-sniffer` (CommonJS) → `@exodus/bytes` (ESM) throws
`ERR_REQUIRE_ESM` in the deployed function and **works on every Node we could
test locally**, 22, 24 and 26 alike. So the difference is Vercel's runtime, not
the code, and nothing on a laptop will ever reproduce it.
`NODE_OPTIONS=--experimental-require-module` turns it back on.

It was findable only because [`api/index.js`](../../api/index.js) imports the
compiled handler *inside* the request handler rather than at module level. A
module-level import that throws takes the function down before anything of ours
runs; inside a `try`, the same failure answers with a stack you can read. Keep it
that way.

### The certificate moved, and nothing would have said so

[`src/db/ssl.ts`](../../src/db/ssl.ts) finds the CA certificate by walking up
from `src/db/`. In production that file is **bundled**, so `import.meta.dirname`
is the bundle's directory and the walk lands somewhere else — which does not
error. It degrades to `encrypted-unverified`: still encrypted, no longer checking
who it is talking to, and identical from the outside. Hence `PGSSLROOTCERT` is
set explicitly, which makes a missing certificate throw instead, and hence
`/api/health` reports the mode.

There is a second way to lose the same guarantee, found by GPT Sol in review:
`pg` **discards** an explicit `ssl` object if the connection string carries
`sslmode`, `sslrootcert`, `sslcert` or `sslkey`. The CA is then loaded, reported
as verified, and not used. `/api/health` warns when `DATABASE_URL` carries any of
them; keep them out of it.

## What does not work in production yet

Reading an article, the shelf, and comments come from Postgres. These four still
write to a local filesystem, which a serverless host does not have, and will
**error** when used:

- **chat** ([`src/chat.ts`](../../src/chat.ts)) — `data/<slug>/chat.json`
- **meaning-search** ([`src/searches.ts`](../../src/searches.ts))
- **glossary web lookups** — refused loudly by `notMigrated` in
  [`src/store/index.ts`](../../src/store/index.ts), which is the right failure
- **adding an article** ([`src/jobs.ts`](../../src/jobs.ts)) — and this one is
  more than storage: the queue assumes one long-lived process

Greg, 2026-08-26, chose to ship with these broken rather than wait for them. They
are steps 7–10 of [postgres-migration.md](../plans/postgres-migration.md).

## Still to do before this is a real deployment

1. **The database.** The Supabase project exists and is **empty** — no schema, no
   rows. [database.md § Roles](database.md#roles) is the sequence, and it is
   deliberately done from the dashboard so that the `postgres` superuser password
   is never needed and never lands on a laptop.
2. **An owner in `auth.users`**, then `SPIDERYARN_OWNER_ID` on the project.
3. **`DATABASE_URL`** — the transaction pooler, with no `ssl*` parameters in it.
4. **Import the articles**: `npm run db:import`.
5. **[The beta gate](../plans/deploy-and-repo-move.md#the-beta-gate)**, which is
   what makes a stable URL possible and what the domain move needs.

## See also

- [deploy-and-repo-move.md](../plans/deploy-and-repo-move.md) — the plan, the
  domain move, and the beta gate
- [database.md](database.md) — the roles, the three hosts, and the enforced SSL
- [architecture.md](architecture.md) — the single-process assumption this runs into
- [logging.md](logging.md) — Vercel's one-day retention and the traps in its log view
- [silent-success.md](../reusable/silent-success.md) — the pattern every failure
  on this page is an instance of
