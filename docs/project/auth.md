# Auth

**Decided 2026-08-25: Supabase Auth.** The working that produced that is in
[docs/research/auth-options.md](../research/auth-options.md) — this file is the decision and where
its pieces live.

This is a **stub**. It should grow as the gate gets built; right now the design lives in the deploy
plan and nothing is implemented yet.

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

## Still open

- **Nothing is implemented.** `src/auth.ts` does not exist yet. It arrives with the Supabase work.
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
