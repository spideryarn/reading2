# Deploying this to spideryarn.com, and moving the repo

Two jobs that people will want to do together and that are better done apart.

> We want this to replace the old/original version. […] We want to deploy this codebase to Vercel
> […] It's currently live at spideryarn.com - I'd like to swap out what's there with this. […]
> I'd also like to ideally replace the original codebase at `/Users/greg/dev/spideryarn/reading`
> with this one. […] Ideally we'd like to make it easyish to be able to refer back to the old
> codebase for the short-run while we're still borrowing functionality and ideas from it
>
> — Greg, 2026-08-25

**Job A is now half done — see [deployment.md](../project/deployment.md).** On 2026-08-26 the new
Vercel project was created, the production API was built, and the app is live behind Vercel's login
wall on a per-deployment URL. What is *not* done is the database (the Supabase project is still
empty), the beta gate, and the domain — Greg deferred the domain deliberately: *"using a temporary
url rather than the proper spideryarn.com domain — that's a later step"* (2026-08-26). Steps 1, 2 and
8 of [§ The steps](#the-steps) are done; 3, 4, 5, 7 and 9 are not. Job B has not started.

Four things in this plan turned out to be wrong or incomplete once it met the platform, and they are
worth reading before trusting the rest of it — they are in
[first-vercel-deploy-silent-failures.md](../postmortems/first-vercel-deploy-silent-failures.md).
The biggest: step 1 below says "one catch-all Vercel function", and Vercel does not have one.

**The rest of this file is still the plan.**
[Job A](#job-a-onto-spideryarncom) is the deployment, [job B](#job-b-one-repo-old-code-under-legacy)
is the repo move. They share nothing except a date and do not block each other — though job B is the
one with the sequencing trap in it, so read that part before touching either.

**And nothing starts yet.** Greg, 2026-08-25: *"We need to wait for all the other agents to finish
first before we can do anything significant."* Both jobs touch files that other sessions are editing
right now, and job B moves the whole working directory out from under them. The tree has to be quiet
first — that is a precondition, not a courtesy.

## The four decisions Greg made

Asked on 2026-08-25, and the plan below is written to them rather than around them:

| | |
|---|---|
| **Old users** | A few, none paying. Stripe is configured but nobody is being billed, so there is no billing work — but some accounts and documents exist and deserve a heads-up and an export path |
| **Storage and auth** | Supabase for both. *"Another agent is working on getting Supabase to work first. Assume that's in place before we start this work."* This removes the biggest obstacle — see [the dependency](#what-this-plan-needs-from-the-supabase-work) |
| **RLS and realtime** | Neither, for now. *"Let's just use a normal API for everything for now, and we can add RLS in later."* Supabase is the store and the login, not the transport — [§ RLS and realtime](#rls-and-realtime-not-now) |
| **Repo** | One repo. *"Move literally everything that was there into [`legacy/`], including dot-files, so that we're starting with a clean slate"*. Deleting `legacy/` is Greg's call, when he feels ready — no date needed |
| **Visibility** | The site is public; the app is not. Everything sits behind [a hard-coded allowlist](#the-beta-gate) of one email, with a beta notice for everyone else |

---

## What we found

Three agents went and looked: at the old repo on disk, at this codebase's deployability, and at the
Vercel dashboard in Greg's browser.

### The old app

`/Users/greg/dev/spideryarn/reading` — Next.js 15 App Router, React 19, Supabase (Postgres + Auth +
Storage, 35 migrations), Stripe, Google OAuth, Hotjar + GA, four LLM providers via the Vercel AI
SDK. Vercel project **`spideryarn-reading`** on Greg's **Pro** account (team slug `greg-detre`),
deploying from `spideryarn/reading` on `main`, root directory unset, 26 environment variables, two
Supabase integrations. Last production deploy 2026-05-25, healthy.

### The domain

- `spideryarn.com` → 307 → `www.spideryarn.com` (primary), plus `spideryarn-reading.vercel.app`.
- DNS is at an **external registrar**, not Vercel nameservers: apex `A → 216.150.1.1`,
  `www CNAME → 63e40ce30383a400.vercel-dns-016.com`.

Worth stating plainly because it is the best news in this document: **moving the domain to a
different Vercel project is a Vercel-side operation, not a DNS migration.** Detach from the old
project, attach to the new one; the registrar's records keep pointing at Vercel's edge either way.
Rollback is the same operation in reverse, in about a minute.

### This codebase, honestly

It is a **single process with a writable local disk**, and that is the design rather than an
accident — [architecture.md § Server and client](../project/architecture.md#server-and-client) says
"One process, one command." Four things follow, and Vercel has none of them:

| # | What the code assumes | Where | What Vercel gives you |
|---|---|---|---|
| 1 | An API exists in production | [`vite.config.ts`](../../vite.config.ts) mounts `handleApi` as **Vite dev middleware** | `vite build` emits static assets only. `configureServer` is a dev-only hook. The API does not exist in a production build **at all** — confirmed by looking in `dist/` |
| 2 | `data/<slug>/*.json` is durable and readable by the next request | [`src/pipeline.ts:138`](../../src/pipeline.ts), [`src/comments.ts:77`](../../src/comments.ts), [`src/jobs.ts:77`](../../src/jobs.ts), every pipeline stage | A fresh, effectively read-only filesystem per invocation. `/tmp` is writable and worthless — not shared, not persistent |
| 3 | A p-queue and a `Map` of jobs live in one long-lived process | [`src/jobs.ts:48,62`](../../src/jobs.ts) | Stateless invocations. `POST /api/jobs` and the client's polling `GET /api/jobs/:id` can land on different instances with empty Maps |
| 4 | An in-memory `Set` de-duplicates in-flight comment answers | [`src/routes.ts:89`](../../src/routes.ts) (`answering`) | Same problem, smaller blast radius |

Plus one piece of config, which is trivial: `/read/<slug>` is a real path and a static host must
serve `index.html` for it. [library.md](../project/library.md) already warned — "whatever eventually
serves it must do the same". Three lines of `vercel.json`.

**None of this is a flaw**, and the seams are already cut: [`src/api.ts`](../../src/api.ts) says in
its own header that it is "the seam Postgres goes behind", and
[`src/routes.ts`](../../src/routes.ts) is deliberately transport-free so a real server mounts it
unchanged. Greg's Supabase decision walks straight through both of those doors — **#2 stops being
true, and most of #3 with it.** What is left is #1 (write the adapter), the tail of #3 (job
ordering), #4, and the rewrite rule.

### Two facts that make the rest easier

- **Pro plan with Fluid Compute enabled.** Function duration goes well beyond the default 300s
  (Vercel documents up to 800s — *verify before relying on it*). A full ingest is "five steps over
  one or two minutes" ([ingest-queue.md](../project/ingest-queue.md)). It fits in one invocation
  with room to spare. **The timeout was never going to be the blocker; storage was.**
- **The data is tiny.** The 54-minute Noema article is 240 KB of JSON; all of `data/` is 468 KB. It
  matters less now that Supabase is coming, but it is why the fallback in
  [§ If Supabase slips](#if-supabase-slips) is real rather than a consolation prize.

---

## Job A: onto spideryarn.com

### What this plan needs from the Supabase work

Greg's instruction was to assume it is in place. So this is the interface this plan is written
against — **if the other agent's work covers less than this, the gaps come back here as work**:

1. **Article artefacts in Supabase, behind [`src/api.ts`](../../src/api.ts).** `meta`, `blocks`,
   `tree`, `arc`, `comments` — read *and written* through it, so the pipeline stages no longer write
   to local disk in production. This is the one that matters; without it nothing else on this list
   helps.
2. **Job records in Postgres**, not `data/_jobs/*.json` ([`src/jobs.ts`](../../src/jobs.ts)), so a
   `POST` on one instance and a poll on another see the same job.
3. **Auth**, or at least a way to tell Greg apart from a stranger. See
   [the beta gate](#the-beta-gate) — this is not optional if ingest is
   online and the site is public, and Greg has chosen public.
4. **`blocks.json` keeps being a source artefact, not a cache.** It is the only place the ids live
   ([block-ids.md](../project/block-ids.md)); whatever the Supabase schema is, the id-preserving
   re-run behaviour has to survive the move or every note, highlight and gist that ever pointed at
   a block is orphaned. Worth checking explicitly, because it will fail silently.

Greg confirmed on 2026-08-25 that the intent is **both storage and auth**, which is exactly this
list. Still worth one message to whoever owns that work before job A starts, to check items 2 and 4
in particular — those are the two that can be quietly missing while everything else looks finished.
If storage slips and only auth lands, [§ If Supabase slips](#if-supabase-slips) becomes the plan.

### RLS and realtime: not now

> I had dreamed of using RLS instead of an API, but maybe that's overcomplicating things. Use your
> judgment. […] I think the RLS and realtime syncing is aspirational. Let's just use a normal API for
> everything for now, and we can add RLS in later.
>
> — Greg, 2026-08-25

**Decided: a normal API for everything.** Supabase is the store and the login; it is not the
transport. The browser talks to `/api/*`, `/api/*` talks to Supabase, and that is the whole picture.
RLS comes later. Realtime is not in scope at all.

That is the same call [ingest-queue.md](../project/ingest-queue.md) already made about progress —
the client polls rather than streaming ([`src/web/useJobs.ts`](../../src/web/useJobs.ts)) — so
"no realtime" is not a new constraint here, just the existing one holding.

It is worth writing down *why* RLS could never have replaced the API here, because the reasons don't
expire and someone will ask again:

1. **The sanitiser.** [security.md](../project/security.md) says the untrusted party is the content,
   and stage 3 sanitises *before* storage so nothing downstream has to remember. A browser writing
   blocks directly loses that guarantee: RLS controls **who** writes, never **what** they write.
   Restoring it would mean a Postgres trigger that sanitises HTML — a worse version of the thing we
   already have.
2. **The keys.** Ingest makes two Anthropic calls and the explain feature calls OpenRouter. Those
   keys can't go to the client, so those paths need a server whatever the reads do.
3. **The read is one payload, on purpose.** `loadArticle` assembles meta + blocks + tree + arc +
   comments into a single response so that
   [zooming never hits the network](../project/architecture.md#server-and-client). Through PostgREST
   that's several round-trips or an RPC — and an RPC is an API endpoint with extra steps and less
   type safety.

So the API was always going to exist. RLS would have been defence *behind* it, not a replacement for
it, and deferring it is a smaller decision than it sounds.

**What deferring it costs, stated plainly:** the API holds the service-role key, so it is the only
thing between a bug in a route handler and somebody else's rows. With one allowed user
([the beta gate](#the-beta-gate)) there is no "somebody else", which is exactly why this is fine now
and exactly what changes when the second person is let in. **Adding RLS belongs in the same piece of
work as opening the allowlist**, not in its own someday — that is the trigger to watch for.

### The move that makes all of this safe

**Create a *new* Vercel project. Do not reuse `spideryarn-reading`.**

The old project is Next.js-preset, carries 26 environment variables and two Supabase integrations,
and every one of its settings would have to be mutated to serve a Vite SPA. Those mutations are not
versioned and not easily undone. A new project costs nothing, deploys to its own `.vercel.app` URL
where it can be checked properly, and leaves the old one intact. The final step is moving two
domains, and **the rollback is moving them back.** That is the difference between a reversible
change and a one-way door, for ten minutes of extra work.

Suggested name: **`spideryarn`** — the project is Spideryarn; `spideryarn2` is just a working
directory.

### The steps

1. **A production API.** ✅ **Done**, and the shape of it was right: `handleApi` already takes
   `(IncomingMessage, ServerResponse)`, Vercel's Node runtime hands you exactly those, and every
   route came along for free without `routes.ts` being touched. [`src/vercel.ts`](../../src/vercel.ts)
   is the adapter and it is small, as this bullet asked.

   **But "one catch-all Vercel function" is not a thing Vercel has.** Its filesystem routing treats
   every bracketed filename as a *single* segment — `[...path]` is a Next.js idiom that does not
   travel — so `/api/library` arrived and `/api/article/writes` got a platform 404. The catch-all is
   an explicit rewrite in [`vercel.json`](../../vercel.json) instead. Two further surprises, both in
   the postmortem: Vercel compiles `api/*.ts` with this repo's TypeScript 7 and *reports success*
   while shipping a broken function, so the API is precompiled by
   [vite.api.config.ts](../../vite.api.config.ts); and the runtime has `require(ESM)` off, which
   nothing local reproduces.
2. **`vercel.json`.** ✅ **Done**, and this bullet was exactly right — the SPA rewrite worked first
   time and `/read/<slug>` survives a reload. The build command gained a second half (the API), and
   the region is pinned to `lhr1` so the function sits next to the database rather than across an
   ocean from it.
3. **The queue, honestly.** `POST /api/jobs` returns its 202 receipt and continues the work with
   Vercel's `waitUntil`, which is *exactly* the shape [`src/jobs.ts`](../../src/jobs.ts) already
   has — return a receipt, keep working, let the browser poll. What is genuinely lost is p-queue's
   global concurrency-1: a queue inside one process cannot order work across instances. With one
   author and per-slug writes that does not matter yet; when it does, the answer is the
   Postgres-backed queue [ingest-queue.md](../project/ingest-queue.md) already names as the one to
   adopt. **Write that loss down when it happens** — a concurrency guarantee that quietly stopped
   holding is the [silent success](../reusable/silent-success.md) pattern exactly.
4. **The `answering` Set** ([`src/routes.ts:89`](../../src/routes.ts)) gets the same treatment or an
   honest downgrade to "it might answer twice under a double-click".
5. **The beta gate**, before anything is reachable — see [§ The beta gate](#the-beta-gate). This
   belongs *before* the domain move in the order of work, not after it.

   **Not built.** Its job is being done for now by Vercel's own login wall, which costs no code and
   admits only Greg. That is only adequate because there is no custom domain: Vercel's Pro plan
   cannot protect a production *domain*, and `<project>.vercel.app` counts as one — which is why
   there deliberately is no `spideryarn.vercel.app`. **The gate is what makes a stable URL possible**,
   so it is the next thing here rather than a later one.
6. **Environment variables** on the new project: `ANTHROPIC_API_KEY` (pipeline — note it is *not*
   in `.env.local`, it comes from Greg's shell, so it is easy to forget) and `OPENROUTER_API_KEY`
   (the explain call), plus whatever Supabase needs.
7. **Move the two existing articles** into Supabase — Noema and `writes`. Small, but it is the
   difference between launching onto an empty shelf and launching onto a real one.
8. **Deploy to `.vercel.app` and actually read an article on it** before any domain moves. Deployed
   and checked in the browser; *reading an article* waits on step 7, because there is nothing on the
   shelf yet.
9. **Move `spideryarn.com` and `www.spideryarn.com`** to the new project. Keep the old project
   deployed and domainless as the rollback.

### The old app does not have to die the same day

There are a few non-paying users. Two cheap kindnesses, neither of which is on the critical path:

- **Give the old app a home at `old.spideryarn.com`** — one CNAME at the registrar, one domain added
  to the old Vercel project. Note that its `.vercel.app` URL is *not* a substitute: Deployment
  Protection is on ("(Legacy) Standard Protection"), which guards preview and `.vercel.app` URLs
  while leaving the production custom domain public. So `spideryarn-reading.vercel.app` asks for a
  Vercel login and `old.spideryarn.com` would not.
- **Tell them, and offer an export**, before the swap rather than after. Whether anything in
  Supabase is worth extracting before the old project is eventually retired is
  [an open question](#open-questions).

### If Supabase slips

The fallback, kept because it is genuinely good and takes about half a day: **publish statically.**
A script calls `listArticles()` and `loadArticle(slug)` from [`src/api.ts`](../../src/api.ts) — both
already transport-free — and writes `dist/api/library.json` and `dist/api/article/<slug>.json`;
`vercel.json` rewrites `/api/article/:slug` to the `.json`; `data/` comes out of `.gitignore`. Zero
functions, zero storage decisions, nothing running.

It costs ingest and new comments in production: you add an article by running the pipeline locally
and pushing. That is a real cost and a survivable one — the reading view *is* the product, it works
perfectly against static JSON because the client
[gets every zoom level in one payload](../project/architecture.md#server-and-client), and there is
currently one author. If the Supabase work is more than a week or two out, this is the better way to
get spideryarn.com swapped in the meantime, and nothing in it has to be un-built afterwards.

### The beta gate

The problem first, because the gate is the answer to it: **a public site plus online ingest plus no
login is an open proxy and an open wallet.** Anyone can make the server fetch an arbitrary URL, and
anyone can spend `ANTHROPIC_API_KEY` two model calls at a time.
[`src/fetch.ts`](../../src/fetch.ts) address-checks every redirect hop, which handles the worst of
the SSRF ([security.md](../project/security.md)) — but no amount of address checking handles "a
stranger ran your pipeline four hundred times".

Greg's answer, 2026-08-25:

> Perhaps we can add a little hard-coded check for now so that it only works for user
> greg@gregdetre.com (my user), to avoid this issue, and a message that says this is still in beta
> and to email me if they want access

That is the right size of answer. Four things it has to do:

**Which provider, and why it is not really a free choice:** see
[auth.md](../project/auth.md), and [auth-options.md](../research/auth-options.md) for the survey
behind it. The short version is that `owner_id uuid references auth.users(id)` already decided it,
and that Supabase's RLS only accepts externally-issued JWTs from five named providers.

**One allowlist, checked on the server.** A small `src/auth.ts` resolves the Supabase session to an
email and compares it against a hard-coded array holding `greg@gregdetre.com`. `handleApi` checks it
once, at the top, rather than each route remembering to. Hiding the Add button in the client is not
a gate — it is a decoration on one.

**It must fail closed.** If the session lookup throws, or the token is missing, or Supabase is
briefly unreachable, the answer is no. A gate that opens when it is confused is not a gate.

**403 and the beta message — never 200 and an empty shelf.** An empty library and a locked library
look identical to a stranger and identical to us in a log. That is the
[silent success](../reusable/silent-success.md) pattern exactly, and this project keeps writing it
down because it keeps happening.

**A constant, not an environment variable — for now.** Hard-coded is right while the list has one
entry: it shows up in the diff and it cannot be misconfigured in a dashboard at 2am. The moment a
second person is let in it should become a table, because adding a beta user shouldn't need a deploy.

#### What the gate covers is a real decision

Gating the *writes* — `POST /api/jobs`, the comment routes — closes the wallet. Gating *everything*,
reads included, makes spideryarn.com a beta notice for anyone who isn't Greg.

**Recommendation: gate everything, for now.** Two reasons, and the second is the stronger:

- "Still in beta, email me for access" is a coherent thing for a whole site to say. "You may read but
  not add" is a stranger experience nobody asked for.
- The reading view serves **Readability-extracted full text of other people's articles**. Behind a
  login that is plainly personal use. Served publicly on your own domain it is republishing someone
  else's copyrighted work, at whatever scale the shelf grows to. Not a thing to run into by accident
  on a domain with your name on it.

Flipping this later is one line — and when it flips it should be for a curated subset (articles Greg
wrote, or has rights to), not for the shelf as a whole.

#### About that email address

Greg asked whether a `@spideryarn.com` address had already been set up for this. **`hello@spideryarn.com`
exists — but as a test account, not a mailbox.** In the old repo it appears only in
`supabase/seed.sql` as a seeded system-admin user, and in the E2E helpers as the login the tests use
(alongside `test-user1@`…`test-user6@` for the worktrees). Nothing in `app/` or `components/` ever
prints a contact address: the old app says "contact support" in a dozen places and never once says
how.

So **check that mail to `hello@spideryarn.com` actually reaches you before putting it on a public
page.** If it does, it's a good address for this. If it doesn't, a beta gate inviting strangers to
email a dead mailbox is the same failure as the 200-with-nothing above — everything looks fine, and
nobody ever hears from anyone.

---

## Job B: one repo, old code under `legacy/`

Greg's call: *"Move literally everything that was there into that, including dot-files, so that
we're starting with a clean slate."* So this is not the option I would have picked, and the reason
it is fine anyway is worth saying: what makes B expensive is `legacy/` sitting in every `grep`,
every editor index and every agent's search path forever. **What makes that acceptable is deleting
`legacy/` in a few months** once the borrowing has stopped — the history stays in `git log` either
way. Plan on that rather than on living with it.

### The state of things

| | this codebase | the old one |
|---|---|---|
| Path | `/Users/greg/Dropbox/dev/experim/spideryarn2` | `/Users/greg/dev/spideryarn/reading` |
| Git | 56 commits, **no remote at all** | `spideryarn/reading`, public, **no branch protection** |
| `.git` | 4.5 MB | 78 MB (GitHub reports ~60 MB) |
| Tree | 2.8 GB, mostly `node_modules` | 2.8 GB, `node_modules` + `.next` |
| Clean? | dirty — several agents mid-flight | **dirty**: 6 modified, 3 deleted-unstaged, 5 untracked |

### Two things to settle before anything moves

- **The old tree has uncommitted work in it** — 14 entries. Nothing here may discard it, and no
  `checkout` / `restore` / `stash` / `reset` / `clean` goes near it. Greg commits them or
  deliberately keeps them first.
- **Six ghost worktrees.** `git worktree list` shows `reading-worktree1`…`6`, all `prunable`, none
  of those directories still on disk. `git worktree prune` tidies the metadata and destroys nothing
  — but it changes state, so it is Greg's call and not an agent's.

### The sequencing trap

**The moment `main` on `spideryarn/reading` contains this codebase at the root, the existing Vercel
project tries to build it — as a Next.js app.** It will fail. A failed build is harmless in itself
(production keeps serving the last good deployment), but "we pushed and production went red" is a
bad ten minutes to have by accident.

So, **before** pushing the swap, do one of these to `spideryarn-reading`:

- **Disconnect it from git** (recommended). Existing deployments keep serving; it becomes a frozen
  rollback target you can re-promote from the dashboard.
- Or **set its Root Directory to `legacy/`**, so it keeps building the old app from its new home.
  Tidier in principle, but it means both projects rebuild on every push forever, for an app nobody
  is developing.

### The order of operations

1. Settle the dirty tree and the ghost worktrees (above).
2. Disconnect `spideryarn-reading` from git in Vercel.
3. **In `/Users/greg/dev/spideryarn/reading`, on a branch**, sweep the root into `legacy/`:
   `git mv` for tracked paths, plain `mv` for untracked ones — including `.github`, `.vercel`,
   `.husky`, `.claude`, `.cursor`, `.cursorrules`, `.vscode`, `.mcp.json`, `.env*`, `.gitignore`,
   `.DS_Store`. `.git` itself obviously stays at the root.
4. Add this repo as a remote and merge it in:
   `git remote add spideryarn2 /Users/greg/Dropbox/dev/experim/spideryarn2`, fetch, then
   `git merge --allow-unrelated-histories spideryarn2/main`. Because step 3 emptied the root, this
   should be conflict-free — the two trees no longer overlap anywhere.
5. `npm install` at the root, `npm test` and `npm run typecheck`, push.
6. Point the new Vercel project at repo root on `main`.

**Do the git work in the old repo and pull *from* Dropbox, not the other way round.** That is what
makes this safe while five other sessions are live in this tree: they keep working in Dropbox
throughout, and any commits they land during the transition come across with another `git fetch`,
because it is the same history. Only at the very end does everyone move.

### The five side-effects of "literally everything, including dot-files"

Each of these is a thing that will otherwise fail quietly:

1. **`.github/workflows/deploy-production.yml` stops running** — GitHub only reads workflows from
   the repository root. That workflow runs `supabase db push --linked` against the **live** Supabase
   project on every push to `main`, so this is a *good* outcome and removes a genuine hazard. But it
   means old-app migrations no longer auto-deploy, and somebody should know that on purpose rather
   than discover it.
2. **Husky breaks.** `core.hooksPath` will point at a `.husky` that is now under `legacy/`. Either
   `git config --unset core.hooksPath` or repoint it. Left alone, commits either fail or silently
   stop running the hook — and the hook runs ESLint, which this codebase doesn't use anyway
   ([linting.md](../project/linting.md): Biome).
3. **`legacy/.gitignore` still governs `legacy/`.** Good — `node_modules` and `.next` stay ignored
   down there. The root gets this codebase's `.gitignore`, which is the one that matters.
4. **`.env` files are untracked**, so they move with `mv` and not `git mv`, and they must not end up
   committed. Same for this codebase's `.env.local`, which holds `OPENROUTER_API_KEY` and has to be
   copied to the new working directory by hand.
5. **`legacy/.vercel/project.json`** still points at `prj_FnqFKwCuBUqIndPRan41c7p7XFVh`. Harmless,
   but if anyone runs `vercel` from inside `legacy/` it will talk to the old project. Worth knowing
   rather than rediscovering.

### The one that is easy to forget

`/Users/greg/Dropbox/dev/experim/spideryarn2` **is in Dropbox**, syncing `node_modules/` and
`.git/` continuously. That is a CPU tax and a known way to corrupt a repository mid-write. Ending up
at `/Users/greg/dev/spideryarn/reading` fixes it as a side-effect, which is a quiet argument for
doing job B sooner rather than later.

And: `ListAgents` currently shows **five other interactive sessions live in this working tree.**
Step 6 — everyone switching directories — needs a quiet moment and a word to each of them, not an
opportunistic thirty seconds.

---

## Open questions

1. **Does mail to `hello@spideryarn.com` actually reach you?** It was only ever a Supabase seed
   test user — see [§ About that email address](#about-that-email-address). This blocks the wording
   of the beta message and nothing else, but it blocks it completely.
2. **Does the Supabase work cover storage as well as auth, in the shape
   [listed above](#what-this-plan-needs-from-the-supabase-work)?** Greg's intent is both. Worth
   confirming with whoever owns it — particularly that block ids survive the migration, which fails
   silently.
3. **Does anything in the old Supabase need extracting** for those few users before the old project
   is retired — and do they get told before the swap or after? Recommendation: before.
4. **What happens to the old Vercel project** once the domain moves? Recommendation: leave it
   deployed and domainless as the rollback, optionally on `old.spideryarn.com`. Retire it in a
   month, not a day.
5. **Old `/read/<slug>` links will mostly 404** — same route shape, different slugs. This codebase
   has [no 404 page on purpose](../project/library.md), so they land on the library, which is a
   decent place for a stale link to land. Is that enough, or do the handful of real ones deserve
   redirects?
6. **Five of the old project's Vercel env vars carry a "Needs Attention" badge.** Not our problem
   unless the old project is being kept alive — but somebody should look.

## Related docs

- [architecture.md](../project/architecture.md) — the pipeline, the storage layout, and the
  single-process assumption this plan runs into
- [ingest-queue.md](../project/ingest-queue.md) — the queue, and its own note on what happens when
  Postgres lands
- [library.md](../project/library.md) — `/read/<slug>`, and the SPA-fallback warning step 2 satisfies
- [block-ids.md](../project/block-ids.md) — why the Supabase migration must preserve ids, and how
  that fails silently
- [auth.md](../project/auth.md) — the gate's own doc, and
  [auth-options.md](../research/auth-options.md) for why the provider is Supabase Auth
- [database.md](../project/database.md) — where the data lives now and where it is going
- [security.md](../project/security.md) — the sanitiser, and why fetching arbitrary URLs on a public
  server is a different problem from fetching them on a laptop
- [original-version/overview.md](../project/original-version/overview.md) — what the old app is, what
  we borrowed, what we deliberately did not
