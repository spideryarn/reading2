# Auth

**Decided 2026-08-25: Supabase Auth.** The working that produced that is in
[docs/research/260825a-auth-options.md](../research/260825a-auth-options.md) — this file is the decision and where
its pieces live.

**Built 2026-08-27, and live on `www.spideryarn.com` the same day.** The server gate refuses
anonymous requests (`401 … [auth-none]`) and the browser half can sign somebody in.

**For a few hours it could not, and the shape of that is worth keeping.** `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` are read at **build** time, and they were not set on the Vercel
project — so [`src/web/lib/supabase.ts`](../../src/web/lib/supabase.ts) threw at module load,
exactly as its comment promises, and **the whole site was a blank page**. Not a broken sign-in
button: nothing rendered at all, because the throw happens before React mounts.

Three things that made it hard to see, all worth remembering:

- **The server half looked fine throughout.** `/api/health` answered, `/api/library` returned its
  401. Every check you would naturally run on "is auth working in production" passed, because they
  all test the half that was working. [silent success](../reusable/silent-success.md) again.
- **`curl` cannot see it.** The HTML shell returns `200` with the right `<title>`; the failure is a
  console error in the browser. It took loading the page in a real one to know.
- **It was safe, and safe by accident.** No session could be obtained, so the gate refused
  everything — but that is the blank page doing the work, not the design.

The variables are set on **Production only**, so a preview deployment still throws this. See
[deployment.md § Environment variables](deployment.md#environment-variables) and
[§ The domain](deployment.md#the-domain), since the move onto the custom domain is what made a
blank page matter.

**The build is planned in [260826w-auth-supabase.md](../plans/260826w-auth-supabase.md)** (2026-08-26) — what to
click in Google Cloud and in the Supabase dashboard, the client seam, the gate, the tests, and an
appendix of the screens that come later. Read that before writing any of this. Two things in it
that are cheap to get wrong and are measured rather than assumed: both the local and the remote
project already sign tokens with **asymmetric ES256 keys**, so verification is local and needs no
network call and no extra crypto library; and `flowType` in `createClient` **defaults to
`implicit`**, not `pkce`.

## Where the pieces are

| | |
|---|---|
| [`src/auth.ts`](../../src/auth.ts) | **the gate.** `requireUser(req, verify?)`, called once at the top of `handleApi`'s `try` |
| [`src/routes.ts`](../../src/routes.ts) | that one call, and the comment saying why it is *inside* the `try` |
| [`src/web/lib/supabase.ts`](../../src/web/lib/supabase.ts) | the browser client. One of them, module scope, `flowType: "pkce"` |
| [`src/web/lib/api.ts`](../../src/web/lib/api.ts) | `apiFetch` — the token goes on here, for all 31 call sites — and `leavingFetch` for `pagehide` |
| [`src/web/useSession.ts`](../../src/web/useSession.ts) | who is signed in, as state |
| [`src/web/LandingPage.tsx`](../../src/web/LandingPage.tsx) | **what being signed out looks like** — the pitch, four screenshots of it working, and the buttons |
| [`src/web/SignInControls.tsx`](../../src/web/SignInControls.tsx) | the Google button and the email form, and every line of auth logic in them. Two pages render it |
| [`src/web/SignInPage.tsx`](../../src/web/SignInPage.tsx) | the compact screen at `/login`, for a password-reset landing |
| [`src/web/AuthCallback.tsx`](../../src/web/AuthCallback.tsx) | where Google returns to, and why it reads the URL itself |
| [`src/web/auth-return.ts`](../../src/web/auth-return.ts) | where the reader was going, in `sessionStorage`, with three rules |
| [`src/web/AccountSection.tsx`](../../src/web/AccountSection.tsx) | signed in as / sign out, on `/profile` |
| [`src/web/SourceLink.tsx`](../../src/web/SourceLink.tsx) | the PDF link, because a navigation carries no header |
| [`scripts/check-remote-auth.sh`](../../scripts/check-remote-auth.sh) | which providers the **remote** project has on. Two controls in every run |
| [`scripts/supabase-auth-config.ts`](../../scripts/supabase-auth-config.ts) | `show` / `apply` the project's auth settings through the Management API. **Not** `supabase config push`, and the header says why |
| [`scripts/check-owner-identity.ts`](../../scripts/check-owner-identity.ts) | whose shelf a sign-in lands on — run before and after the first Google sign-in |
| [`scripts/check-google-redirect.sh`](../../scripts/check-google-redirect.sh) | does Google accept a given redirect URI for our client. Checks a known-bad one every time |
| [`scripts/check-production-gate.sh`](../../scripts/check-production-gate.sh) | the live site refuses an anonymous request |
| [`scripts/seed-accounts.ts`](../../scripts/seed-accounts.ts) | who `npm run db:seed-owner` creates **locally**, and the fence that keeps it off anything else |

## Locally, signing in needs no Google at all

`npm run db:seed-owner` creates `dev-admin@spideryarn.local` at the id `src/admin.ts` recognises,
with a password generated for that machine, so the email form on the landing page is the whole of it — no
OAuth, no dashboard, and no browser on a machine you cannot reach. That last part is why it exists:
a fresh Hetzner box had no way in that did not go through the noVNC tunnel.
`npm run db:admin-password` prints the credentials.
[supabase-local.md § Signing in](supabase-local.md#signing-in-with-no-google-and-no-browser-you-cannot-reach)
is the detail, and [260831ab](../plans/260831ab-seed-local-admin-user-for-remote-box.md) is the reasoning.

**Production is untouched by any of it.** The seed refuses to run against anything but this repo's
own local stack, and checks that against `supabase status` rather than against `SUPABASE_URL` —
because everything else in the run reads that same variable, so a forwarded port would have every
step agreeing with every other one.

## The four things worth knowing before you touch any of it

1. **The gate is inside `handleApi`'s `try`.** Above it, a thrown `httpError` escapes the catch:
   500 in dev with the message in the body, a blank 500 on Vercel, and the `finally` never runs so
   **the refusal is never logged**. It still fails closed, which is the only mercy.
2. **A 401 is not "the session is gone".** `apiFetch` refreshes once and retries once, and leaves
   sign-out to the SDK's auth events. Dropping a reader out of an article because one request lost
   a refresh race is worse than the bug it would prevent.
3. **JWKS unreachable is 503, not 401.** A 401 tells a good session to throw itself away and
   refresh, which cannot help, and reports our outage as the reader's mistake.
4. **`/auth/callback` is exempt from every rewrite in `main.tsx`.** `canonicalAddHref` folds
   `location.search` into an article's address — its whole job — so a return landing on `/add/…`
   would put our one-time auth code in a stranger's access log.

## The signed-out page is the landing page

Since 2026-08-27, no session shows you [`LandingPage.tsx`](../../src/web/LandingPage.tsx) rather
than a bare form: what the thing is, four screenshots of it working, and the sign-in buttons
themselves. Greg asked for it and made both of the calls that shape it.

**The buttons are on the page.** Not a Sign in link to `/login` — a landing page whose only control
sends you somewhere else has put a click between a person and the thing they came for. So the form
moved into [`SignInControls.tsx`](../../src/web/SignInControls.tsx) and two pages render it. One
implementation rather than two, and the reason is not tidiness: a second copy of `signInWithOAuth`
is a second place for `redirectTo` to be wrong, and the way *that* goes wrong is our one-time
authorisation code folded into somebody else's URL (see point 4 above).

**A deep link gets the same page.** `/read/some-article` while signed out is the full landing page,
not a shorter prompt. One signed-out page rather than two, and nothing is lost by it: the address
bar still holds the article, so `auth-return.ts` lands you on it after Google returns.

`/login` is the one exception, because it is a page somebody was *sent* rather than a statement
about who they are. It keeps the compact screen.

**The Alpha sign is deliberate and it is load-bearing**, not decoration — Greg asked for it to be
prominent, and it is a badge beside the wordmark *and* a strip under it. The page has screenshots on
it, so the thing a stranger must not conclude is that this is a product they can sign up for.
Access is not open — see [§ Whose data is it](#whose-data-is-it); the alternative to saying so
plainly is a Google button that works and then hands a stranger a reading tool somebody else is
paying for.

The screenshots live in `src/web/assets/` and are all of one article — *The Mythology of AI
Consciousness*, which is on the public web with nothing sensitive in it. Imported through Vite
rather than dropped in `public/`, so they are content-hashed and a redeploy cannot serve a stale one.

**There are four, and getting them took two goes.** The first attempt produced one, and the reason
is worth recording because it was environmental rather than a decision: partway through capturing
them Chrome's window went `visibilityState: "hidden"`, which paints every screenshot solid black,
and nothing reachable from an agent's side raises an occluded window — two Chrome instances were
running and AppleScript addresses only the other one. This is a new entry on
[browser-testing.md](browser-testing.md)'s list of ways the browser lies to you, and a particularly
quiet one: the capture *succeeds*, at the right dimensions, and returns a black rectangle. The way
past it, on 2026-08-27, was Greg taking the other three himself, with the machine's own screenshot
key.

That is what changed the rules the page had been following, and both changes are the same lesson:

- **Each shot declares its own width and height.** There was one `SHOT_W`/`SHOT_H` pair for the
  whole page, which held while every capture came from one browser window on one afternoon. Real
  screenshots of real features are not one shape — two of these are portraits, one is a wide hero,
  one a landscape card — and a rule saying otherwise has exactly one way out, which is cropping good
  pictures to please a test. So the numbers sit in a `SHOTS` record beside the file each belongs to,
  and [`tests/landing-assets.test.ts`](../../tests/landing-assets.test.ts) reads that record and
  checks every entry against the bytes on disk, in both directions: an import with no entry is a
  picture drawn with no space reserved, an entry with no import is a file nothing points at.
- **PNG, quantised, rather than JPEG.** The first shot was a JPEG because the browser automation
  tool produces JPEG. A person's screenshot key produces PNG, and that is the better format here
  anyway: JPEG rings visibly around small light text on a near-black ground, and `pngquant` at
  65–92 takes a UI screenshot — a few dozen flat colours — below what JPEG manages regardless. The
  hero is 119 KB against 280 KB as a JPEG; all four together are under 280 KB.

Adding one later: capture it, run `pngquant --quality 65-92 --speed 1`, downscale to about twice the
width it will be drawn at (the column is 720 px, so 1440), drop it in `assets/`, and give it a
`SHOTS` entry with the real numbers. The `Shot` component takes a max-width utility, which is how
the portraits avoid filling the column.

## The button on the live site does not work yet

**2026-08-27.** Greg pressed *Continue with Google* on `spideryarn.com` and got a page of JSON on
`supabase.co`:

```json
{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}
```

Nothing in the sign-in code is wrong. The button built the right authorize URL, with the right
`redirect_to` and a PKCE challenge, and handed the browser over; the project answered that Google is
switched off. Two settings on two dashboards, neither of them in this repo, and **only Greg can make
the first of them** — Google Cloud Console blocks agents twice over.
[260827i-google-sign-in-production.md](../plans/260827i-google-sign-in-production.md) is the whole of it: what is
measured, the two scripts, the order, and the check that says whether it took.

**Two things came out of it that are about this app rather than about a dashboard.**

**A misconfigured provider shows our own sentence, not somebody else's JSON** — from the deploy that
carries this change onward. (The page of JSON is what the build that was live at the time did, and
none of the settings above need a deploy, so the two halves land separately.)
`googleSignInAvailable()` in [`src/web/lib/supabase.ts`](../../src/web/lib/supabase.ts) asks the
project whether Google is on, **on the click** and not on first paint, before `signInWithOAuth`
navigates. There is no other place to catch this: that call makes no request, it assigns
`location`, so the 400 exists only after our code has stopped running on an origin that is not ours.
**It fails open** — offline, blocked, slow, a body we do not recognise, `google` missing rather than
`false`, all proceed exactly as before. A preflight that refuses when it is merely confused does not
prevent a bad error message, it prevents signing in, on a working site, for a reason the reader
cannot see. Eight tests, five of them that one point.

**All five sign-in sentences now live in [`src/messages.ts`](../../src/messages.ts)**, with a
registered `kind`, which is what [copy.md](copy.md) has always said and what the auth screens had
never done. Moving them was not tidying: the suite's own invariants rejected two on arrival, and it
turned up a real bug — both of `AuthCallback.tsx`'s error sentences said *Google*, while `signUp`
sends its email-confirmation link to the same callback, so an expired confirmation blamed a provider
that had never been asked.

**Whether the first Google sign-in gives Greg his own shelf is not obvious**, and it is the failure
that would look most like data loss. Every row carries an `owner_id`, the existing articles belong to
an account created through the admin API before there was any way to sign in, and a Google sign-in
either links to it or makes a second one — in which case everything works and the shelf is empty.
[`scripts/check-owner-identity.ts`](../../scripts/check-owner-identity.ts) is the before-and-after
reading. GPT Sol raised it; it is the one thing in that review no spec could settle.

## What auth is for here

The gate exists because **a public site plus online ingest plus no login is an open proxy and an open
wallet** — anyone can make the server fetch an arbitrary URL, and anyone can spend
`OPENROUTER_API_KEY` two model calls at a time — and since 2026-08-27 that is the key the whole app
runs on, not just the pipeline ([ai-gateway.md](ai-gateway.md)). That is not hypothetical: on 2026-08-26, before
`src/auth.ts` existed, an anonymous `POST /api/jobs` against the production hostname returned 202 and
created a running job.

The full statement of the problem and Greg's answer in his own words are in
[260825d-deploy-and-repo-move.md § The beta gate](../plans/260825d-deploy-and-repo-move.md#the-beta-gate).

- **It must fail closed.** Session lookup throws, token missing, Supabase unreachable — the answer is
  no. A gate that opens when it is confused is not a gate. The one refinement: "Supabase unreachable"
  answers **503**, not 401, because telling a good session it is bad sends the reader round a refresh
  loop that cannot succeed.
- **403 and the beta message**, never 200 and an empty shelf.

### The bit this page used to get wrong

This section described a one-email allowlist as though it were built, and two paragraphs later
admitted that every signed-in reader shared one shelf. Both halves were written before the gate
existed and they contradicted each other; GPT Sol's review of the built code named the contradiction
on 2026-08-27. What is actually true:

**There is no allowlist.** Greg's call, twice — *"We can get rid of the allowlist once we've added
authentication. I'll accept the risk."* `isAllowed()` in [`src/auth.ts`](../../src/auth.ts) returns
`true` for anybody Supabase will vouch for, and it is a function rather than an inline `true` so that
narrowing it later is an edit in one place.

**And every reader gets their own shelf**, which is the part that had not been built when that
decision was made. The gate proved a person existed and then dropped the identity on the floor, so
the risk Greg accepted (a shared wallet) was not the whole risk: `articles.slug` is globally unique,
so a second account did not get an empty library, it got Greg's. Sol led its review with it:

> any person who can create a Supabase account can see and change the same library, profile, chats,
> searches and reader state, and can run paid model operations

Offered the small fix (bring the allowlist back) or the real one, Greg chose the real one. How it
works is in [§ Whose data is it](#whose-data-is-it) below.

## Whose data is it

**One line joins the gate to the store**, and it is `setRequestOwner(user.id)` in
[`src/routes.ts`](../../src/routes.ts), immediately after `requireUser`. Everything else follows from
it.

- **The owner is request-scoped**, in an `AsyncLocalStorage` opened by `handleApi` and read by
  `currentOwnerId()` in [`src/owner.ts`](../../src/owner.ts). Not an argument threaded through forty
  store functions: eleven call sites sit four or five frames below a route handler, the CLI shares
  most of them and has no request, and every one of those parameters would have had to be optional —
  which is the shape that lets a caller forget it and get the wrong person's data.
- **`run()` with a fresh box per request, never `enterWith`.** With HTTP keep-alive several requests
  share a calling async context, and `enterWith` mutates it — so request two could read request one's
  owner in the window before its own gate ran. That is the worst bug this area could have and it
  would never show up in testing, where connections are not reused.
- **Inside a request the signed-in user wins, and `SPIDERYARN_OWNER_ID` does not get a vote.** That
  ordering is load-bearing. The environment used to win outright and
  [deployment.md](deployment.md) tells you to set that variable on Vercel — so with the old
  precedence, deploying exactly as documented would have handed every signed-in stranger Greg's owner
  id, every query would have matched, and the isolation would have been dead code that looked like it
  was working.
- **Reading before the gate throws**, rather than falling back to the environment. The tempting
  fallback is a real person's data, and the request would have succeeded and returned it.
- **Every path from a slug to an article carries an owner filter**, through one predicate —
  `ownedSlug()` in [`src/store/pg.ts`](../../src/store/pg.ts). That is the whole of the isolation:
  comments, chat threads, searches and glossary lookups are reached only through an `articleId` that
  came from one of those paths. There were five near-identical `articleIdFor` helpers across the pg
  modules and no way to tell by looking whether all five had been done, so
  [`tests/owner-isolation.test.ts`](../../tests/owner-isolation.test.ts) asserts that **no file under
  `src/store/` writes `eq(articles.slug, …)` outside `pg.ts`**.
- **A slug you do not own is 404, not 403.** "There is no such article" is all a stranger should learn
  about it; a 403 confirms it exists. It falls out of the design rather than being a second decision —
  the row simply does not match the `where`.
- **The filesystem store refuses to boot in production**, because it has no owner column and nowhere
  to put one — one directory per slug under `data/`, one profile file, no second reader. On Vercel it
  would have failed anyway for want of a writable disk, but as an ENOENT on the first read, which
  reads as a missing article rather than as a store that should never have been selected.

### The two things the first version of this walked straight past

GPT Sol reviewed the ownership work the day it landed and came back **BLOCKER —
the isolation claim is false**, with two live cross-reader reads. Both were
outside the store, which is exactly why the predicate above did not catch them:

- **`GET /api/source/:slug` read the reader's PDF straight off disk.** It was
  authenticated and not authorised — it took a slug, opened `data/<slug>/raw.pdf`
  and returned it, never once asking whose article that was. It now calls
  `shelfStore.read(slug)` first, which is the same owner-filtered lookup
  everything else uses, and it calls it *before* it goes for the bytes. It no
  longer touches the disk at all: on 2026-08-31 the read went through
  `sourceStore` ([`src/store/index.ts`](../../src/store/index.ts)), whose
  Postgres side resolves the slug through `ownedSlug` as well — so the ordering
  is belt and the query is braces.
- **The ingest queue was completely open.** `Job` had no owner and there is one
  global map, so any signed-in stranger could list every reader's slugs, source
  URLs, uploaded filenames, guidance text and errors — and cancel, retry, advance
  or delete any of them by id. Disclosure, denial of service and somebody else's
  model spend, from one endpoint.

And Sol put them together, which is the part worth remembering:

> Combining findings 1 and 2 gives Bob a reliable sequence: list Alice's PDF job,
> take its slug, then download its source.

Jobs now carry an `ownerId`, stamped at `enqueue` and filtered on every read and
every mutation. The predicate is `mine()` in [`src/jobs.ts`](../../src/jobs.ts),
and it asks **"is there a reader to answer to"** rather than "who is it": inside
a request there is, and they see their own; outside one — the housekeeping sweep,
the CLI, the pipeline — there is not, and it sees everything. A sweep that could
only tidy its own jobs would leave every real user's finished job on disk for
ever, and would do it silently.

Two more things came out of the same review and are fixed:

- **A queued callback does not inherit an owner.** An `AsyncLocalStorage` context
  is captured when an async resource is made, and p-queue stores a plain
  function — so with concurrency 1, Alice's job followed by Bob's runs *the whole
  of Bob's* in Alice's context. Measured here, not guessed. Nothing in the
  pipeline reads the owner yet, so it was a landmine rather than a bug; the owner
  is now captured on the job and re-entered with `runAsOwner`.
- **`npm run db:import` could take somebody else's article.** The article id is
  derived from the slug, so importing a slug another owner holds resolved to
  *their* row, updated it, deleted their comments, chat, searches and lookups by
  `articleId`, and reinserted them under the importer's owner — every write
  reporting success. It was fixed to read the owner first and refuse by name, and
  **the importer itself was deleted on 2026-09-01**
  ([260831b-finish-the-database-move.md](../plans/260831b-finish-the-database-move.md) § Stage 3), so
  this route is gone rather than guarded. Kept here because the *shape* recurs: anything that
  resolves an article id from a slug without reading the owner does this.

### The one deliberate exception

**`GET /api/admin/users` reads across owners on purpose**, and it is the only thing that does. It
answers *"who are the readers"*, which cannot be asked with an owner filter on it. Everything above
this line still holds: one route, in a gated namespace, open to one account id, returning **limited
account metadata (the id, the email address, the sign-in providers), counts and dates** — never a
title, a URL, a filename, or a sentence of anybody's reading. [admin.md](admin.md) is the whole of it, including which of its three refusals is a gate
and which two are courtesies.

### What is still shared, and what is still open

- **`articles.slug` is globally unique**, deliberately, because it is the URL contract. Two people
  ingesting the same URL is a question the beta gate has to answer rather than a bug to fix in the
  store — see [ingest-queue.md](ingest-queue.md) for the two functions that decide whether two
  addresses are one article.
- **The ingest queue is not in Postgres.** `data/_jobs/` is on disk. It carries an owner now and is
  filtered by it, but `jobs.owner_id` in the schema is still unused and the queue does not work on
  Vercel at all — there is no writable disk.
- **`SPIDERYARN_STORE=files` has no isolation at all**, and unset still means `files`. The production
  boot refusal in [`src/store/index.ts`](../../src/store/index.ts) is the whole of the mitigation, so
  on any non-production host two signed-in readers share the complete library, profile, comments,
  chat and searches. Authentication does not make that configuration multi-user-safe, and nothing
  short of moving the filesystem store to per-owner directories would.
- **Child rows are trusted to match their article.** Comments, chat threads, searches and lookups are
  filtered by `articleId` alone — the owner column on them is written, never read — so the isolation
  rests on the invariant that a child's owner equals its article's owner. Nothing in the database
  enforces it. The importer was the one thing that could break it, and it was deleted on 2026-09-01 —
  so nothing writes a child row under an owner other than the request's.
- **`/api/health` runs before the gate**, outside a request, so `currentOwnerId()` falls back to the
  environment owner and an unauthenticated caller learns that owner's article count. No content
  leaks. Sol rated it low and so do I, but it is a real thing the endpoint says.
- **Upload records written before they carried an owner** are accepted from any caller who knows the
  UUID.
- **No RLS.** The filtering is in the queries, not in the database. RLS is the belt to this pair of
  braces and is deferred — [§ RLS and realtime](../plans/260825d-deploy-and-repo-move.md#rls-and-realtime-not-now).

## Why Supabase Auth

Greg asked whether there was something better or simpler, having used it before, and then
specifically about Better Auth and open-source options. Short version of the answer:

- **The schema already decided it.** `owner_id uuid references auth.users(id)` is a foreign key into
  Supabase's own auth table, on every table, from day one — see
  [260825f-postgres-migration.md § Auth](../plans/260825f-postgres-migration.md#auth-the-gate-is-someone-elses-plan).
- **RLS needs it.** Supabase's third-party auth supports exactly five providers — Clerk, Firebase,
  Auth0, Cognito, WorkOS. Only those let an externally-issued JWT drive `auth.uid()`. Better Auth,
  Logto, Ory and Zitadel are not on the list, so any of them strands the RLS path that
  [§ RLS and realtime](../plans/260825d-deploy-and-repo-move.md#rls-and-realtime-not-now) defers but wants
  back.
- **It is the open-source option.** Supabase Auth is itself an open-source, self-hostable auth server.
  The open-source question turned out to be an argument for staying, not for leaving.
- **It is ten lines.** That was the estimate, and it is the one bullet here written before the code.
  What got built is `getClaims(token)` — local verification against the cached JWKS, no network call
  — followed by four claim checks rather than an email comparison, because there is no allow-list to
  compare against. Roughly the size promised, not the shape.

The alternatives, what each would cost, and the traps — Lucia is dead, Vercel's password protection
does not cover a production domain without a $150/month add-on — are all in
[the research doc](../research/260825a-auth-options.md).

## The one test that has to exist

**A request with no session is refused**, and the suite has to be able to *see* that fail — it was
proved by commenting `requireUser` out, which turns [`tests/routes.test.ts`](../../tests/routes.test.ts)
from 54 green to 2 red.

This used to say "and a request with the wrong email", from the days of the one-email allowlist.
There is no allowlist now ([§ The bit this page used to get wrong](#the-bit-this-page-used-to-get-wrong)),
so the second half of the sentence describes a refusal that deliberately does not happen. What
replaced it is [`tests/owner-isolation.test.ts`](../../tests/owner-isolation.test.ts): the question
is no longer *who is allowed in* but *whose rows they see*.

Every realistic failure here is a fail-open bug: an empty env var read as "allow all", middleware not
mounted on every route, a verify call that silently accepts an unsigned token. See
[silent-success.md](../reusable/silent-success.md) — this is that pattern with a security consequence.

## What is not done

- **Google sign-in in production**, still, as of 2026-08-27 — see
  [§ The button on the live site does not work yet](#the-button-on-the-live-site-does-not-work-yet)
  just below, which is the current state and the two things that fix it. The `VITE_*` half of this
  bullet is done: both variables are on the Vercel project, Production only, and the site renders.
- **A spend limit**, which is the control that is actually missing and always was.
- **Email in production** needs SMTP: `mailer_autoconfirm` is false there, so a sign-up sends a
  confirmation and Supabase's built-in mailer is not for production use. Google works without it.

## Still open

- **Anyone with a Google account can still sign in** — *once the consent screen is published, and it
  deliberately is not.* Looked at on 2026-08-27 after Sol pointed out the claim had been asserted
  rather than measured: it is **`Testing`, `External`**, which means only accounts on its test-user
  list get through, and Google enforces that before a request reaches us. So there *is* an allowlist
  after all — it is just not ours and not in this repo. Keeping it that way is the cheap stand-in for
  the spend limit below, and publishing is a button on the day that limit exists — no verification is
  needed, and **no scary interstitial either way**: Google's own exception for apps requesting only
  `email`, `profile` and `openid` covers both the unverified-app warning and the seven-day
  authorisation expiry, so staying in Testing costs a listed reader nothing. See
  [260827i-google-sign-in-production.md](../plans/260827i-google-sign-in-production.md). Ownership is what stops a
  reader who does get in from reading your
  library; nothing stops them making an account and spending your model budget on their own. A spend
  limit is the control for that, and it is the next bullet. If it turns out to be needed sooner,
  `isAllowed()` in [`src/auth.ts`](../../src/auth.ts) is the one line to change.
- **Whether to put Cloudflare Access in front** as an outer, code-free gate. Free to 50 users, and it
  cannot be opened by a bug in a route handler. Optional, not required; the trade is a second piece of
  infrastructure. See
  [the research doc](../research/260825a-auth-options.md#the-minimal-end-no-auth-library-at-all).
- **Authenticating against the old app's Supabase project means authenticating against its 9 existing
  users**, on an email provider that is already enabled. Any of them can sign in here. What they
  cannot do is see anybody else's articles — that is what
  [§ Whose data is it](#whose-data-is-it) is for, and it is why that section had to be built rather
  than an allowlist kept.

## See also

- [260825a-auth-options.md](../research/260825a-auth-options.md) — the full survey and the sources
- [database.md](database.md) — the store `auth.users` sits beside
- [security.md](security.md) — the two untrusted parties, and why neither is another user
- [260825d-deploy-and-repo-move.md](../plans/260825d-deploy-and-repo-move.md) — the gate's design, in the plan that
  needs it
