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
| [`src/web/SignInPage.tsx`](../../src/web/SignInPage.tsx) | the screen |
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

## What auth is for here

Not user accounts. There is one user. The gate exists because **a public site plus online ingest plus
no login is an open proxy and an open wallet** — anyone can make the server fetch an arbitrary URL,
and anyone can spend `ANTHROPIC_API_KEY` two model calls at a time.

The full statement of the problem, Greg's answer in his own words, and the four things the gate has to
do are in
[deploy-and-repo-move.md § The beta gate](../plans/deploy-and-repo-move.md#the-beta-gate). Read that
before building any of it. The short version:

- **One allowlist, checked on the server.** A small `src/auth.ts` resolves the Supabase session to an
  email and compares it against a hard-coded array holding `greg@gregdetre.com`. `handleApi` checks it
  once, at the top.
- **It must fail closed.** Session lookup throws, token missing, Supabase unreachable — the answer is
  no. A gate that opens when it is confused is not a gate.
- **403 and the beta message**, never 200 and an empty shelf.

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
- **Whose shelf.** The gate says who you are; nothing yet asks whose data this is.
  `currentOwnerId()` is still process-wide, so every admitted person sees the same library. That is
  a decision for Greg rather than a bug, and it is written up at
  [§ The gate says who you are](../plans/auth-ui-and-production.md#the-gate-says-who-you-are-nothing-yet-asks-whose-shelf-this-is).
- **A spend limit**, which is the control that is actually missing and always was.
- **Email in production** needs SMTP: `mailer_autoconfirm` is false there, so a sign-up sends a
  confirmation and Supabase's built-in mailer is not for production use. Google works without it.

## Still open

- **The allowlist should become a table** the second time somebody is let in — adding a beta user
  should not need a deploy.
- **Whether to put Cloudflare Access in front** as an outer, code-free gate. Free to 50 users, and it
  cannot be opened by a bug in a route handler. Optional, not required; the trade is a second piece of
  infrastructure. See
  [the research doc](../research/auth-options.md#the-minimal-end-no-auth-library-at-all).
- **Authenticating against the old app's Supabase project means authenticating against its 9 existing
  users**, on an email provider that is already enabled. The allowlist is what makes that safe, so it
  must never quietly become "any authenticated user".

## See also

- [auth-options.md](../research/auth-options.md) — the full survey and the sources
- [database.md](database.md) — the store `auth.users` sits beside
- [security.md](security.md) — the two untrusted parties, and why neither is another user
- [deploy-and-repo-move.md](../plans/deploy-and-repo-move.md) — the gate's design, in the plan that
  needs it
