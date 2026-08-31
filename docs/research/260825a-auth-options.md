# Auth options: what we looked at, and why Supabase Auth won

> **Status.** Research, 2026-08-25. The decision this produced lives in
> [docs/project/auth.md](../project/auth.md); this file is the working underneath it, kept so nobody
> has to run the search again. Followed the process in
> [third-party-library-selection.md](../reusable/third-party-library-selection.md).

Greg asked two questions, on 2026-08-25:

> In the past, I'd used Supabase to handle authentication. Are there better/simpler ways?

and then, after the first round:

> What about Better Auth or other open source options?

**The answer to both is: stay with Supabase Auth.** Not because the alternatives are bad — several
are excellent — but because one line of schema that is already written decides it, and because the
open-source question turns out to be an argument *for* Supabase rather than against it.

## The line of schema that decided it

[260825f-postgres-migration.md](../plans/260825f-postgres-migration.md) already puts this on every table:

```sql
owner_id uuid references auth.users(id),
```

That is a foreign key into Supabase's own `auth.users`. Pick any other provider and it has to go —
either drop the key and keep emails as loose strings, or write a sync job that copies users into
`auth.users` so the key still resolves. Both are worse than doing nothing.

And there is a second, sharper constraint behind it. **Supabase's third-party auth feature supports
exactly five providers**: Clerk, Firebase Auth, Auth0, AWS Cognito, and WorkOS. That is the feature
that lets an externally-issued JWT drive `auth.uid()`, which is what every RLS policy keys off. There
is no generic OIDC-issuer option for that mechanism. So:

```
   provider on Supabase's list of five ──►  auth.uid() works, RLS is available later
   provider not on it                  ──►  hand-rolled token exchange, or no RLS
```

[260825d-deploy-and-repo-move.md § RLS and realtime](../plans/260825d-deploy-and-repo-move.md#rls-and-realtime-not-now)
defers RLS but explicitly wants it back. Anything that strands that path is paying a real cost.

**The irony worth remembering: the proprietary options preserve the RLS design, and the open-source
library breaks it.** Clerk and WorkOS are on the list. Better Auth, Logto, Ory and Zitadel are not.

## Managed services

| Option | 2026 status | Free tier | Fits a Vite SPA + Node API? | Code for "is this greg@" | On Supabase's list of five? |
|---|---|---|---|---|---|
| **Supabase Auth** | Core Supabase product, 100k GitHub stars | 50,000 MAU | Native — same client already used for Postgres | ~10 lines: `getUser(token)` + email compare | n/a — it *is* the first party |
| WorkOS AuthKit | Active, growing as the Auth0 alternative | 1,000,000 MAU | Framework-agnostic redirect, one callback route | ~15 lines | Yes |
| Clerk | Active, best prebuilt UI | 50,000 MRU | Native React SDK, not Next-locked | ~15 lines, but email needs a custom session claim configured first | Yes |
| Firebase Auth | GA, mature, huge tutorial base | 50,000 MAU | Framework-agnostic | ~10 lines | Yes |
| Auth0 (Okta) | GA, but support quality visibly down post-acquisition | ~7,500 MAU | Framework-agnostic, enterprise ceremony | ~20 lines + dashboard setup | Yes |
| Stytch | Active, B2B/passwordless focus | 10,000 MAU | Framework-agnostic | ~15 lines | No |
| Kinde | Active, smaller player | 10,500 MAU | Framework-agnostic | ~15 lines | No |
| Stack Auth | OSS, YC S24, ~6.7k stars | Free | Framework-agnostic | ~10-15 lines | No |

**Auth0 is the one to avoid.** The free tier ends around 7,500 users and the overage climbs fast
(~$0.07/MAU), so growth punishes it harder than anything else here. Support quality has dropped since
Okta acquired it, through repeated layoffs hitting former Auth0 staff.

**Stack Auth's natural home is Neon**, a serverless-Postgres competitor to Supabase. Pairing it here
would mean two Postgres-adjacent vendors for no reason.

**Kinde fails selection criterion #1** — the smallest docs and tutorial footprint of the credible
options, which matters because that criterion exists so coding models have material to work from.

## Better Auth

Better Auth deserved the closer look Greg asked for, and it is a genuinely good project. Three things
in its favour:

- **Auth.js did not merely recommend it — it merged into it.** "Auth.js is now part of Better Auth"
  is an official post; the NextAuth team joined them and now point new projects at Better Auth unless
  they need stateless sessions with no database. That consolidates a lot of community.
- **Users live in your own Postgres**, not a vendor's store. On the lock-in axis it beats every
  proprietary option outright.
- **It works outside a meta-framework.** First-class React client (`createAuthClient`), and a Vite
  SPA plus separate Node API is a supported shape rather than a workaround. No blocker found here.

It still loses, on four counts:

1. **RLS.** Not on Supabase's list of five. Better Auth ships a JWT plugin with asymmetric signing
   and a JWKS endpoint — the right shape on paper — but pointing Supabase at it does not work in
   practice. What people actually run is a manual token exchange: verify the Better Auth JWT
   server-side, mint a second Supabase-signed JWT with the right claims, use that for every
   RLS-guarded call. An extra hop on every database access, unsupported by both vendors.
2. **A third migration authority.** Better Auth creates `user`, `session`, `account` and
   `verification` through its own CLI. That arrives straight into
   [§ A new project](../plans/260825f-postgres-migration.md#a-new-project-and-what-that-deletes).
   Spideryarn already runs two migration authorities — Drizzle's, for `spideryarn`, and Supabase's
   own, for `auth` and `storage`, which we neither own nor touch. Better Auth would make it three,
   and the third would want to write tables next to schemas it does not own. Workable — generate the SQL and hand-fold it into a
   timestamped migration — but that is permanent manual glue, re-done every time a plugin adds a
   column.
3. **A live CVE stream.** Three in 2025-2026, two critical: unauthenticated API-key creation leading
   to account takeover (CVE-2025-61928), an SSRF at CVSS 9.6 in `@better-auth/sso`
   (CVE-2026-53513), and insecure crypto defaults at CVSS 8.7 in the `oidcProvider`/`mcp` plugins
   (CVE-2026-67336). All in optional plugins rather than the core session path — but it is a larger,
   faster-moving surface than ten lines of `getUser()`.
4. **Effort.** Its own tables, its own migration, an outbound email service, cookie middleware, CORS,
   *then* the email compare. A weekend against ten lines.

One thing genuinely unverified: how Better Auth's tables behave under `supabase db reset` and
seeding order. Nobody has written it down. If this decision is ever revisited, that is a thing to
test rather than assume.

**If we were starting cold on a Vite SPA with no Supabase, Better Auth would probably be the pick.**
That is not the situation.

## Self-hosted identity providers

Surveyed: Keycloak, Ory (Kratos/Hydra), Zitadel, Authentik, Authelia, Logto, SuperTokens, Casdoor,
Hanko, FusionAuth, SST's OpenAuth.

**The verdict on the whole category is no.** Every serious option wants a long-running container plus
a database, and several want Redis. That is a second always-on service beside a serverless app, to
check one hard-coded email address. You would be running a JVM to protect `greg@gregdetre.com`. It is
also the exact opposite of the "prefer boring: one server process" line in
[AGENTS.md](../../AGENTS.md).

Specifics worth keeping:

- **Authelia** is the closest to lightweight — it can run with a file backend and no database — but
  it is a forward-auth proxy pattern needing a reverse proxy you control, which on Vercel you do not
  have. Wrong shape, not just heavy.
- **FusionAuth is not open source.** The community edition is free and unlimited-MAU, but it is
  source-available under a custom licence, not OSI-approved, with redistribution restricted. It fails
  the exact motive that makes people ask this question in the first place.
- **Hanko** is AGPL and passkey-first, with a thin tutorial ecosystem.
- **SST's OpenAuth** is the interesting outlier: not a service you point at but an issuer you deploy
  inside your own app (Hono-based, runs fine on Vercel functions). No separate box, no SaaS
  dependency. But it is beta, small, and it makes you the maintainer of a standards-compliant OIDC
  issuer — far more machinery than a one-email gate needs.

**The only sensible way into this category is a managed free tier of an open-source project**, which
gets the code without the operations. Two qualify: **Logto Cloud** (MPL-2.0, 50,000 MAU free, and the
hosted service runs the same code as the Docker image, so "self-host later" is a redeploy rather than
a migration) and **Ory Network** (Apache-2.0, more config ceremony for the same outcome). Both are
good. Neither is on Supabase's list of five, so both cost the RLS path.

## The minimal end: no auth library at all <a id="the-minimal-end-no-auth-library-at-all"></a>

Worth recording because two of these are ideas people will have again.

**Cloudflare Access** is the one real contender. Free up to 50 users, gates the domain with zero
application code, deny-by-default at the edge. Its distinctive virtue is that the gate lives *outside*
the app, so a bug in a route handler cannot open it — structurally fail-closed rather than
fail-closed-if-you-wrote-it-right, which is precisely what
[§ The beta gate](../plans/260825d-deploy-and-repo-move.md#the-beta-gate) is afraid of. The cost is proxying
the domain through Cloudflare (orange-cloud DNS, TLS Full/Strict), a second piece of infrastructure in
front of Vercel.

But it does a different job from Supabase Auth, and at one user the difference is invisible:

```
   Cloudflare Access              Supabase Auth
   ─────────────────              ─────────────
   "is this person allowed in?"   "which person is this, as a uuid?"
            │                              │
            ▼                              ▼
   keeps strangers out            fills in owner_id
   no app code                    makes auth.uid() work
   cannot fill owner_id           lets RLS come back later
```

**Vercel's own password protection will not gate the production domain.** Standard Protection (free,
all plans) covers preview and auto-generated deployment URLs only. Scoping it to "All Deployments"
requires the Advanced Deployment Protection add-on — **$150/month on Pro**, free only on Enterprise.
Written down because it is an obvious idea that costs an afternoon to disprove.

**Rolling a signed cookie by hand is not the classic mistake here**, though it usually is. The classic
mistake is home-made password storage, OAuth state and PKCE, or session invalidation across many
users. This app has none of that: no passwords, one email, no signup. With `iron-session` or `jose`
doing the sealing, what remains really is "check a signed cookie". We are not doing it — Supabase Auth
is fewer lines and comes with the `auth.users` row — but the reasoning is recorded so the option is
rejected on cost rather than on superstition.

The real risk in any of these is the ordinary fail-open bug: an empty env var read as "allow all",
middleware not mounted on every route, a verify call that silently accepts an unsigned token.
Whatever we build, **one test must assert that a request with no cookie and a request with the wrong
email are both refused.**

## Traps and dead ends

- **Lucia is dead.** Deprecated March 2025 and converted into a "copy this file into your project"
  learning resource. It is not an installable library any more. Training data still recommends it, so
  expect it to come up again.
- **Arctic and Oslo** (same author) — Arctic deprecated July 2026; only `@oslojs/encoding` is still
  maintained.
- **Auth.js / NextAuth v5** works outside Next.js now, but see above: its team merged into Better
  Auth. Adopting it fresh means adopting what its own maintainers no longer recommend for new work.
- **Passport.js** still works and has a big legacy base, but its examples skew pre-2023 and momentum
  has left it.
- **Do not confuse Supabase's two OIDC features.** "Third-party auth" trusts a JWT someone else
  issued (the list of five). "Custom OAuth providers" is for login redirects that end in a
  *Supabase-issued* session. Only the first one matters for RLS.

## Lock-in, which is the real question underneath "open source"

Supabase Auth is itself an open-source auth server, Postgres-backed and self-hostable, with a
documented path to running it yourself. On "can I leave without a rewrite" it beats Clerk, WorkOS,
Stytch, Kinde and FusionAuth — none of which can be forked — and roughly ties Logto and Ory. The users
are rows in a database we can `pg_dump`.

But the architecture protects us more than the vendor choice does:

```
  vendor lock-in lives here ──►  owner_id uuid references auth.users(id)
                                 ~10 lines in src/auth.ts

  NOT here ──►  the rest of the app, which never sees a session
```

[§ RLS and realtime](../plans/260825d-deploy-and-repo-move.md#rls-and-realtime-not-now) decided the browser
talks to `/api/*` and never to Supabase directly, and the gate is one small `src/auth.ts` checked once
at the top of `handleApi`. So no component knows who issued the token. Swapping providers later means
rewriting one file and one foreign key. That decision is worth more than picking a provider on
ideological grounds, and it is the reason this choice is cheap to get wrong.

## What would change the answer

- **Selling to companies** that need SAML, SCIM and directory sync for their IT departments. Then
  WorkOS wins — SSO is its actual product rather than an enterprise upsell — and it is on the list of
  five, so `auth.uid()` and RLS survive the move.
- **Serious scale.** WorkOS's 1M-MAU free tier outlasts Supabase's 50k, though by then it is a
  different business and re-evaluating is reasonable anyway. Supabase Pro is $25/mo for 100k MAU, then
  $0.00325/MAU.
- **Dropping Supabase Postgres.** If storage went somewhere else, the foreign key argument evaporates
  and Better Auth becomes the front-runner.
- **Wanting a gate that cannot be opened by an application bug.** Add Cloudflare Access in front,
  keeping Supabase Auth inside for identity. The two compose; they do not compete.

## Sources

Pricing pages change — the figures above were read on 2026-08-25 and should be re-checked before
anyone spends money on them.

- Supabase: [pricing](https://supabase.com/pricing) ·
  [third-party auth, the list of five](https://supabase.com/docs/guides/auth/third-party/overview) ·
  [custom OAuth providers, the other thing](https://supabase.com/docs/guides/auth/custom-oauth-providers) ·
  [JWTs](https://supabase.com/docs/guides/auth/jwts) ·
  [100,000 GitHub stars](https://supabase.com/blog/100000-github-stars)
- Better Auth: [database concepts](https://better-auth.com/docs/concepts/database) ·
  [CLI](https://better-auth.com/docs/concepts/cli) ·
  [JWT plugin](https://better-auth.com/docs/plugins/jwt) ·
  [Auth.js joins Better Auth](https://better-auth.com/blog/authjs-joins-better-auth) ·
  [the NextAuth discussion](https://github.com/nextauthjs/next-auth/discussions/13252) ·
  [CVE-2025-61928](https://www.wiz.io/vulnerability-database/cve/cve-2025-61928) ·
  [CVE-2026-53513](https://securityonline.info/better-auth-ssrf-cve-2026-53513/) ·
  [CVE-2026-67336](https://www.thehackerwire.com/cve-2026-67336-better-auth-insecure-cryptographic-defaults/) ·
  [the token-exchange pattern people actually run](https://queen.raae.codes/2025-05-01-supabase-exchange/)
- Managed: [Clerk pricing](https://clerk.com/pricing) ·
  [WorkOS pricing](https://workos.com/pricing.md) ·
  [Stytch pricing](https://stytch.com/pricing) ·
  [Kinde pricing](https://www.kinde.com/pricing/) ·
  [Auth0 pricing](https://auth0pricing.com/) ·
  [Auth0 support after Okta](https://ssojet.com/blog/auth0-support-after-okta) ·
  [Firebase Auth pricing](https://blog.logto.io/firebase-authentication-pricing)
- Self-hosted: [Logto pricing](https://logto.io/pricing) · [Ory pricing](https://www.ory.com/pricing) ·
  [is self-hosting Keycloak worth it in 2026](https://skycloak.io/blog/is-self-hosting-keycloak-worth-it-2026/) ·
  [Keycloak supported configurations](https://www.keycloak.org/server/supported-configurations) ·
  [Authentik 2025.10 drops Redis](https://docs.goauthentik.io/releases/2025.10/) ·
  [Authelia vs Authentik](https://www.cerbos.dev/blog/authelia-vs-authentik-2026-idp) ·
  [SuperTokens self-host](https://supertokens.com/docs/deployment/self-host-supertokens) ·
  [FusionAuth licence FAQ](https://fusionauth.io/license-faq) · [OpenAuth](https://openauth.js.org/)
- The minimal end: [Vercel password protection](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/password-protection) ·
  [the $150 add-on](https://vercel.com/blog/protecting-deployments) ·
  [Cloudflare Zero Trust pricing](https://zerotrustcost.com/cloudflare-zero-trust-pricing) ·
  [iron-session](https://github.com/vvo/iron-session)
- Dead ends: [Lucia's deprecation](https://github.com/lucia-auth/lucia/discussions/1714) ·
  [Arctic and Oslo](https://pilcrowonpaper.com/blog/18)

## See also

- [auth.md](../project/auth.md) — the decision this produced, and the shape of the gate
- [database.md](../project/database.md) — the store the foreign key points into
- [260825d-deploy-and-repo-move.md § The beta gate](../plans/260825d-deploy-and-repo-move.md#the-beta-gate) — what the
  gate has to do, and the three ways a gate fails open
- [260825f-postgres-migration.md § Auth](../plans/260825f-postgres-migration.md#auth-the-gate-is-someone-elses-plan) —
  the `owner_id` columns, and why deferring RLS puts the whole weight on the grants
- [security.md](../project/security.md) — the two untrusted parties, and why neither is another user
