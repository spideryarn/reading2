# Deployment

Spideryarn on Vercel: how it gets there, what is live, and the five things that
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
| Vercel project | **`spideryarn-reading2`**, team `greg-detre` — a new project, [dashboard here](https://vercel.com/greg-detre/spideryarn-reading2). Created as `spideryarn` and renamed by Greg on 2026-08-26. `spideryarn-reading`, which serves spideryarn.com, is untouched |
| Git | **connected** since 2026-08-26 to [`spideryarn/reading2`](version-control.md), production branch `main` — so a push to `main` deploys. `vercel deploy` from a working directory still works and is still useful; see [Deploying](#deploying) for why the two differ |
| Region | `lhr1` (London), chosen to match the Supabase project in `eu-west-2`. The edge answers from wherever you are; the *function* runs in London, next to the database |
| Node | 24.x. Greg, 2026-08-26: *"I'm happy to use Node 24 unless there's a good reason not to"* — there was one candidate reason and it turned out to be false, see [require(ESM)](#the-runtime-has-requireesm-turned-off) |
| URL | a per-deployment `spideryarn-<hash>-greg-detre.vercel.app`, which asks for a login — **and `spideryarn-greg-detre.vercel.app`, which does not**. See [Who can reach it](#who-can-reach-it) |

**`spideryarn.vercel.app` was removed and `spideryarn-greg-detre.vercel.app` was
not**, which is why the app is currently readable by anybody who has that second
address. Vercel generates *two* of these, and removing one of them looks exactly
like removing the problem — see [Who can reach it](#who-can-reach-it).

## Deploying

There are now **two** ways in, and they build different code. That is the whole
thing to understand about this section.

### From git — a push to `main`

Since 2026-08-26 the project is connected to
[`spideryarn/reading2`](version-control.md), production branch `main`. **A push
to `main` builds and deploys to production**, with no command to run.

The build machine clones the repo, so what ships is **the commit** — nothing on
anybody's disk reaches it. That is the point of connecting it: a deploy stops
depending on whose working tree was current when somebody typed a command.

### From the working tree — `vercel deploy`

```
vercel deploy --prod --scope greg-detre
```

This uploads the working directory (minus
[`.vercelignore`](../../.vercelignore)), installs, builds, and prints a URL. It
is still here on purpose — it is how you ship something that is not committed
yet, which with the database work in flight is often what you want.

**It deploys your working tree, not a commit.** With several agents live in this
directory that is worth saying out loud: whatever is on disk is what ships,
including someone else's half-finished edit. Check `npm test` and
`npm run typecheck` before deploying and read whose errors they are.

### The two do not agree, and git is the one telling the truth

The first git-sourced deploy, 2026-08-26, **failed** — and the same code built
fine from the working tree, because the working tree had files in it that git
did not:

```
[MISSING_EXPORT] "readRaw" is not exported by "src/fetch.ts"       src/routes.ts:93
[MISSING_EXPORT] "normaliseUrl" is not exported by "src/ingest.ts"  src/routes.ts:94
```

`src/routes.ts` had been committed importing two exports whose *definitions* were
still sitting uncommitted in `src/fetch.ts` and `src/ingest.ts`. This is the
second time on this page: the earlier one was committed imports of two whole
files nobody had `git add`ed. Same cause, one level down — and it is precisely
what the [named-pathspec commit rule](version-control.md) costs you. Naming only
your own files is what keeps you from committing somebody else's half-finished
work, and it is also what lets you leave your own dependency behind.

**So a green `npm run build` on this laptop says nothing about whether `main`
builds.** Before pushing anything that adds a cross-file import, check that the
file you imported *from* has no uncommitted changes of yours left in it:

```
git status --short src/
```

Note that looking for *missing files* is not enough. That check passes here —
both files are committed, and it is an export inside them that is missing. The
only test that actually answers the question is a build of the committed tree,
which is now what a push gets you.

### "The repository couldn't be found" is usually not about the repository

Connecting the repo failed first time with:

```
The repository "reading2" couldn't be found. Make sure there are no typos
and that you have access to it.
```

Every word of which points at the repo, and none of it was the problem. The
Vercel **GitHub App** was installed on the `spideryarn` org with access to all
repositories, and Greg is an org admin — that side was fine. What was missing was
the *account-level* GitHub login connection on the Vercel side: `GET /v2/user`
reported `githubLogin: null`, and listing git namespaces returned GitHub's
`401 Bad credentials`.

Two different things, and Vercel needs both:

| | What it is | Where to fix it |
|---|---|---|
| GitHub **App** installation | the org granting Vercel access to repositories | GitHub org settings |
| GitHub **login connection** | your Vercel account knowing who you are on GitHub | `vercel.com/account/settings/authentication` |

Reconnecting the second one — one button, no consent screen, since the
authorization was already on file — made the repo visible immediately. So when
Vercel says it cannot see a repo, check `githubLogin` before you go looking at
permissions.

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

**Anybody with the address can read the app right now.** That is a deliberate
choice as of 2026-08-26, not an accident — but it was an accident first, and the
shape of the mistake is worth keeping.

**Vercel Authentication is on, set to "production deployment URLs and all
previews".** It works. Per-deployment URLs redirect to a Vercel login and only
Greg gets in:

```
spideryarn-123clvpp1-greg-detre.vercel.app   302 -> login    protected
spideryarn-greg-detre.vercel.app             200 -> the app  open
```

The trap is what Vercel counts as a *production domain*. On Pro those cannot be
covered by Vercel Authentication at all, and the auto-generated `.vercel.app`
addresses **are** production domains. So the setting reports itself as enabled,
and is, while the app is served to the world.

**Vercel generates two of them** — `<project>.vercel.app` *and*
`<project>-<team>.vercel.app`. Only the first was removed. This page then said
"removing the domain is what actually closed it", and that sentence was wrong
from the day it was written: `spideryarn-greg-detre.vercel.app` had been serving
the whole app the entire time. Verified 2026-08-26 with an unauthenticated
`curl` from outside — the check nobody had run, because the dashboard says
"Protected" and the per-deployment URL really does ask for a login. A textbook
[silent success](../reusable/silent-success.md): the obvious check shares its
assumption with the thing it is checking.

**Deleting it is not available either.** A `--prod` deploy regenerates it, and
Vercel staff have confirmed there is no way to stop the generated production
alias existing. The only lever is deployment-protection *scope*, and "All
Deployments" needs the **Advanced Deployment Protection** add-on — $150/month,
30-day minimum — on top of Pro.

So the options were: pay $150/month; stop deploying to production and use
protected preview deploys only; or accept it. Greg, 2026-08-26, chose to accept
it: there is no database attached yet, so there is nothing behind the URL to
leak, and the responses carry `x-robots-tag: noindex`. **Do not treat this as
private, and do not put real reader data behind it while it stands.**

The real answer is [the beta gate](../plans/deploy-and-repo-move.md#the-beta-gate),
which is what the custom domain needs anyway — application-level auth, which no
plan tier can take away.

**The rename moved the address, and there are three of them now.** Measured
2026-08-26, after the project became `spideryarn-reading2` and was connected to
git:

```
spideryarn-greg-detre.vercel.app                    200   the app — last good build, pre-rename
spideryarn-reading2-greg-detre.vercel.app           404   DEPLOYMENT_NOT_FOUND
spideryarn-reading2-git-main-greg-detre.vercel.app  200   "Deployment has failed"
```

The new-name aliases exist the moment you connect git, and they point at
whatever the production branch last produced — which so far is a failed build.
So the app is still answering on its **old** address, and will keep doing so
until `main` builds. Vercel does not guarantee a pre-rename generated URL keeps
working, so do not write this one down anywhere that matters.

The `-git-main-` one is a *branch* alias — connecting a repo adds one per
branch, and it will track `main` from now on.

## Environment variables

Set on the project, for `production` and `preview`. None of them lives in a file
here; [`.env.prod`](../../.env.example) is a record of what production needs and
is read by nothing.

| | |
|---|---|
| `SPIDERYARN_STORE=postgres` | which store serves reads. **Unset means `files`**, and on a host with no durable disk that is an empty shelf and a 200 |
| `DATABASE_URL` | **not set yet**, which is why `/api/health` is a 503 and nothing can be read in production. Supabase's **transaction** pooler, port 6543. See [database.md § Connecting to the remote](database.md#connecting-to-the-remote) for why that one and not the other two |
| `PGSSLROOTCERT=certs/supabase-ca.crt` | **required here, unlike locally** — see [the certificate](#the-certificate-moved-and-nothing-would-have-said-so) |
| `NODE_OPTIONS=--experimental-require-module` | see [require(ESM)](#the-runtime-has-requireesm-turned-off). **Set on Production only, not Preview** (measured 2026-08-26) — so a preview deployment used to check anything will fail for a reason unrelated to whatever you are checking |
| `NODEJS_HELPERS=0` | see [the request body](#the-request-body) |
| `ANTHROPIC_API_KEY` | the pipeline stages. Note it is *not* in `.env.local` — it comes from Greg's shell, so it is the easy one to forget |
| `OPENROUTER_API_KEY` | explain, and chat |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | the gate verifies tokens with these. `SUPABASE_ANON_KEY` is the legacy fallback and is what is set today |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | **not set, and read at BUILD time.** Vite compiles them into the bundle, so setting them after a deploy changes nothing until the next one. Missing means `src/web/lib/supabase.ts` throws at module load and the site is a blank page — see [auth-ui-and-production.md § The release fence](../plans/auth-ui-and-production.md#the-release-fence) |
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

## The five that fail quietly

Each reported success while being wrong. The first four were found on 2026-08-26
by the deployment itself and are written up in
[first-vercel-deploy-silent-failures.md](../postmortems/first-vercel-deploy-silent-failures.md);
the fifth was found in review before it could bite, which is the only reason it
is not in there too.

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

### The request body

`readBody` in [`src/routes.ts`](../../src/routes.ts) consumes the raw request
stream with `for await (const chunk of req)`. Vercel's request helpers read that
stream **first** and replay it through `req.on("data")` — not through the async
iterator — so with helpers on, every `POST` body arrives **empty**. Nothing
errors: each route reports a missing field, as though the client had sent a bad
request. `NODEJS_HELPERS=0` turns the helpers off and hands the function the raw
Node request, which is the shape `handleApi` was written against anyway.

Found by GPT Sol in review, 2026-08-26, from Vercel's own source rather than its
documentation.

**`POST /api/health` is how you check it is still true**, after a platform change
or a runtime bump:

```
curl -X POST .../api/health -d '{"hello":"world"}'
```

It reports `bytes`, and it counts them with the *same* `for await` loop
`readBody` uses. A check that reads the body a different way from the code it is
vouching for can pass while the real path fails. `bytes: 0` against a request
that had one means something read it first.

### The `sources` bucket has to exist on the remote too

Uploading a PDF (2026-08-27) puts bytes in Supabase Storage, in a bucket called `sources`.
[`supabase/config.toml`](../../supabase/config.toml) declares it, and **that only creates it
locally** — a remote project needs `supabase seed buckets --project-ref <ref>`, or the equivalent
insert into `storage.buckets`.

This is on the "fails quietly" list rather than beside it because of *how* it fails: nothing checks
for the bucket at boot. `POST /api/uploads` mints a grant against a path in a bucket that is not
there, the browser gets a signed URL that looks perfectly good, and the `PUT` is what discovers it.
The reader sees an upload failure on a file that is fine.

The other half of the same setting: `SUPABASE_SERVICE_ROLE_KEY` must be present in the deployed
environment, because minting a grant is server-only by construction — the anon key gets
`403 Unauthorized: new row violates row-level security policy`, which is the right answer. Without
the key, `uploadGrants()` returns `null` and `POST /api/uploads` answers 503 saying uploading is not
switched on, which is at least honest.

## What does not work in production yet

Reading an article, the shelf, comments, **chat and meaning-search** all come
from Postgres now — the last two since step 10 landed on 2026-08-26. What still
writes to a local filesystem, which a serverless host does not have:

- **adding an article** ([`src/jobs.ts`](../../src/jobs.ts)) — and this one is
  more than storage: the queue assumes one long-lived process
- **`deleteGlossary`** — still refused by `notMigrated` in
  [`src/store/index.ts`](../../src/store/index.ts), which is the right failure.
  It nulls the glossary on a *published* revision, and whether a published
  revision may be mutated at all is an open decision in step 11

Greg, 2026-08-26, chose to ship with these broken rather than wait for them.

**Chat and meaning-search were the dangerous pair, and it is worth knowing why
the danger did not show up here.** Until that day they did not check
`SPIDERYARN_STORE` at all — they called `node:fs/promises` unconditionally, so
what stopped them in production was the host refusing the write rather than the
app refusing to try. That is fine here and was quietly wrong everywhere else: on
a laptop running `SPIDERYARN_STORE=postgres` there is a writable disk, and the
same two calls **succeeded, reported success, and landed in a store every
Postgres read ignores** — the outcome `src/store/index.ts` calls the worst
available. A read-only disk is not a guard; it just happened to be standing in
the same doorway. `tests/store-writes-land-in-postgres.test.ts` is the guard, and
it asserts no file appears rather than trusting the host to make one impossible.

## What the reader sees when the server fails

Worth knowing because the first deployment demonstrated it: while every API route
was returning Vercel's plain-text 500, the homepage rendered

    Unexpected token 'A', "A server e"... is not valid JSON

and logged **nothing** to the browser console. Twelve call sites had each written
`await r.json()` *before* checking `r.ok`, so the parser threw first and the line
that turns a server error into a readable message never ran.

That is fixed in [`src/web/lib/api.ts`](../../src/web/lib/api.ts), which every
client `fetch` now reads its response through — see
[web-client.md § Reading an API response](web-client.md#reading-an-api-response).
It matters here rather than only there: when this deployment breaks, what the
reader is told about it is the only symptom most people will ever report.

## Still to do before this is a real deployment

0. **Get `main` building**, which it is not as of 2026-08-26 — see
   [the two do not agree](#the-two-do-not-agree-and-git-is-the-one-telling-the-truth).
   The exports it is missing are already committed *locally*; they have simply
   not been pushed. Until that happens every git deploy fails, and the address
   below serves the last good build from before the connection.
1. ~~**The database.**~~ **Done, 2026-08-26.** Schema applied to
   `alschkahzfagtppxspfq`: 14 migrations, 14 tables, `spideryarn_app` granted and
   verified, `spideryarn` confirmed invisible to the Data API by a real anonymous
   request. [database.md § Roles](database.md#roles) records what was actually run,
   which is **not** what that section used to say — the migration role the plan
   called for cannot be granted `REFERENCES` on `auth.users`, and the grant that
   was supposed to do it is a silent no-op.
2. ~~**An owner in `auth.users`**~~ — `greg@gregdetre.com` →
   `001bb7a0-7720-4f1b-8b9d-1ee6e63d132a`. Still to set `SPIDERYARN_OWNER_ID` here.
3. ~~**`DATABASE_URL`**~~ — set on Vercel production 2026-08-27, transaction
   pooler, no `ssl*` parameters, verified by connecting with the exact value
   Vercel holds. `SPIDERYARN_OWNER_ID` too; the rest were already there.
4. ~~**Import the articles**~~ — done 2026-08-27. Five articles, 635 blocks, 24
   comments, 56 chat messages, and reads verified through the store seam over the
   transaction pooler. `ball-lightning` and `coolabah-memory` have no
   `blocks.json`/`tree.json` yet, so the importer correctly skipped them.
5. **[The beta gate](../plans/deploy-and-repo-move.md#the-beta-gate)**, which is
   what makes a stable URL possible and what the domain move needs.

## It is up, and here is the reading of it

**2026-08-27, commit `bfe3a77`.** `/api/health` on the production alias:

```json
{ "ok": true, "warnings": [], "node": "v24.18.0", "region": "lhr1",
  "store": { "name": "postgres", "articles": 5 },
  "ssl": { "mode": "verified", "why": "verified against certs/supabase-ca.crt" } }
```

Three things that reading tells you which a `Ready` status does not: reads are coming from Postgres
rather than an empty disk, the server's certificate is being *checked* rather than merely encrypted
against, and the commit is the one you think it is.

Getting there needed one fix, and it is the best example this repo has of why `Ready` means nothing.
The first successful build in seven hours returned `500` to every request, because
[`src/pdf.ts`](../../src/pdf.ts) imported pdf.js at module scope and Vercel's tracer had left
pdf.js's own optional native dependency out of the bundle — so *loading* the API threw
`DOMMatrix is not defined`, on every route, PDF or not, and never on a laptop.
[pdfjs-dommatrix-serverless.md](../postmortems/pdfjs-dommatrix-serverless.md).

**The API routes are gated and `/api/health` is not.** An unauthenticated request to `/api/library`
returns `401 You need to be signed in to do that. [auth-none]`; the health endpoint answers anybody,
which is what a health endpoint is for. It reports environment variable *names* only. Note the
production hostname cannot be SSO-protected on the Pro plan, so the gate in
[`src/auth.ts`](../../src/auth.ts) is the thing standing between a stranger and the shelf — not
Vercel.

## See also

- [deploy-and-repo-move.md](../plans/deploy-and-repo-move.md) — the plan, the
  domain move, and the beta gate
- [database.md](database.md) — the roles, the three hosts, and the enforced SSL
- [architecture.md](architecture.md) — the single-process assumption this runs into
- [logging.md](logging.md) — Vercel's one-day retention and the traps in its log view
- [silent-success.md](../reusable/silent-success.md) — the pattern every failure
  on this page is an instance of
