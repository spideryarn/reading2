# Auth

**Decided 2026-08-25: Supabase Auth.** The working that produced that is in
[docs/research/auth-options.md](../research/auth-options.md) — this file is the decision and where
its pieces live.

**Built, locally, on 2026-08-27.** Not yet true in production — see [§ What is not done](#what-is-not-done).

**The build is planned in [auth-supabase.md](../plans/auth-supabase.md)** (2026-08-26) — what to
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
| [`src/web/LandingPage.tsx`](../../src/web/LandingPage.tsx) | **what being signed out looks like** — the pitch, four screenshots, and the buttons |
| [`src/web/SignInControls.tsx`](../../src/web/SignInControls.tsx) | the Google button and the email form, and every line of auth logic in them. Two pages render it |
| [`src/web/SignInPage.tsx`](../../src/web/SignInPage.tsx) | the compact screen at `/login`, for a password-reset landing |
| [`src/web/AuthCallback.tsx`](../../src/web/AuthCallback.tsx) | where Google returns to, and why it reads the URL itself |
| [`src/web/auth-return.ts`](../../src/web/auth-return.ts) | where the reader was going, in `sessionStorage`, with three rules |
| [`src/web/AccountSection.tsx`](../../src/web/AccountSection.tsx) | signed in as / sign out, on `/profile` |
| [`src/web/SourceLink.tsx`](../../src/web/SourceLink.tsx) | the PDF link, because a navigation carries no header |

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
than a bare form: what the thing is, four screenshots of the reading view, and the sign-in buttons
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

## What auth is for here

The gate exists because **a public site plus online ingest plus no login is an open proxy and an open
wallet** — anyone can make the server fetch an arbitrary URL, and anyone can spend
`ANTHROPIC_API_KEY` two model calls at a time. That is not hypothetical: on 2026-08-26, before
`src/auth.ts` existed, an anonymous `POST /api/jobs` against the production hostname returned 202 and
created a running job.

The full statement of the problem and Greg's answer in his own words are in
[deploy-and-repo-move.md § The beta gate](../plans/deploy-and-repo-move.md#the-beta-gate).

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

### What is still shared, and what is still open

- **`articles.slug` is globally unique**, deliberately, because it is the URL contract. Two people
  ingesting the same URL is a question the beta gate has to answer rather than a bug to fix in the
  store — see [ingest-queue.md](ingest-queue.md) for the two functions that decide whether two
  addresses are one article.
- **The ingest queue is not in Postgres.** `data/_jobs/` is on disk and carries no owner, so jobs are
  shared. It does not work on Vercel at all today, which is the only reason that is not urgent.
- **No RLS.** The filtering is in the queries, not in the database. RLS is the belt to this pair of
  braces and is deferred — [§ RLS and realtime](../plans/deploy-and-repo-move.md#rls-and-realtime-not-now).

## Why Supabase Auth

Greg asked whether there was something better or simpler, having used it before, and then
specifically about Better Auth and open-source options. Short version of the answer:

- **The schema already decided it.** `owner_id uuid references auth.users(id)` is a foreign key into
  Supabase's own auth table, on every table, from day one — see
  [postgres-migration.md § Auth](../plans/postgres-migration.md#auth-the-gate-is-someone-elses-plan).
- **RLS needs it.** Supabase's third-party auth supports exactly five providers — Clerk, Firebase,
  Auth0, Cognito, WorkOS. Only those let an externally-issued JWT drive `auth.uid()`. Better Auth,
  Logto, Ory and Zitadel are not on the list, so any of them strands the RLS path that
  [§ RLS and realtime](../plans/deploy-and-repo-move.md#rls-and-realtime-not-now) defers but wants
  back.
- **It is the open-source option.** Supabase Auth is itself an open-source, self-hostable auth server.
  The open-source question turned out to be an argument for staying, not for leaving.
- **It is ten lines.** `supabase.auth.getUser(token)`, then compare `.email`.

The alternatives, what each would cost, and the traps — Lucia is dead, Vercel's password protection
does not cover a production domain without a $150/month add-on — are all in
[the research doc](../research/auth-options.md).

## The one test that has to exist

Whatever gets built, assert that **a request with no session and a request with the wrong email are
both refused**. Every realistic failure here is a fail-open bug: an empty env var read as "allow all",
middleware not mounted on every route, a verify call that silently accepts an unsigned token. See
[silent-success.md](../reusable/silent-success.md) — this is that pattern with a security consequence.

## What is not done

- **Production.** Google has never been told this project's callback URI, the remote project has
  Google switched off, and no `VITE_*` variable is set on Vercel. Until all three,
  the deployed site has a gate and no way through it. The steps, and the order that avoids
  deploying a blank page, are in
  [auth-ui-and-production.md](../plans/auth-ui-and-production.md#what-has-to-be-true-before-this-is-promoted).
- **A spend limit**, which is the control that is actually missing and always was.
- **Email in production** needs SMTP: `mailer_autoconfirm` is false there, so a sign-up sends a
  confirmation and Supabase's built-in mailer is not for production use. Google works without it.

## Still open

- **Anyone with a Google account can still sign in.** Ownership is what stops them reading your
  library; nothing stops them making an account and spending your model budget on their own. A spend
  limit is the control for that, and it is the next bullet. If it turns out to be needed sooner,
  `isAllowed()` in [`src/auth.ts`](../../src/auth.ts) is the one line to change.
- **Whether to put Cloudflare Access in front** as an outer, code-free gate. Free to 50 users, and it
  cannot be opened by a bug in a route handler. Optional, not required; the trade is a second piece of
  infrastructure. See
  [the research doc](../research/auth-options.md#the-minimal-end-no-auth-library-at-all).
- **Authenticating against the old app's Supabase project means authenticating against its 9 existing
  users**, on an email provider that is already enabled. Any of them can sign in here. What they
  cannot do is see anybody else's articles — that is what
  [§ Whose data is it](#whose-data-is-it) is for, and it is why that section had to be built rather
  than an allowlist kept.

## See also

- [auth-options.md](../research/auth-options.md) — the full survey and the sources
- [database.md](database.md) — the store `auth.users` sits beside
- [security.md](security.md) — the two untrusted parties, and why neither is another user
- [deploy-and-repo-move.md](../plans/deploy-and-repo-move.md) — the gate's design, in the plan that
  needs it
