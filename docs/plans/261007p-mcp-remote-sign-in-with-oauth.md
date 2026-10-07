# MCP, remote: sign in from Cowork on the web or phone, with OAuth

**Status, 2026-10-07: stage 1 built, reviewed, on `dev`, and switched off** (`MCP_OAUTH_CLIENT_ID`
unset, so `/api/mcp` refuses everyone). Switching on is Greg's (§ Questions, Question 2), after the
spike in § What landed. The plan was revised after Sol's `rethink` (§ Revised, below). Queue item `qi-n9ntngfq`. The remote half deferred by
[261007j § Deferred](261007j-mcp-server-for-spideryarn-admins-first.md#deferred-with-queue-entries)
(its Question 1, option C). The local server and its tools are
[mcp.md](../project/mcp.md); the tools added today are
[261007o](261007o-mcp-private-link-and-admin-user-tools.md).

## What Greg said

> I can live with it being something simple (e.g. fixed-key), but I'd prefer Google OAuth or
> similar if possible
>
> — Greg, 2026-10-07

He has approved changing the sign-in gate for this; the change to
[security-map.md](../project/security-map.md) is written out below, before and after.

## What it is, in plain words

Today the MCP server runs **on Greg's Mac**: Claude Desktop starts it, and it calls the site as
him. Cowork on the web, or Claude on a phone, cannot start a program on a Mac. They can only talk to
a server at an address. So this puts the same tools **at an address on the site**,
`https://www.spideryarn.com/api/mcp`, and lets Claude sign in to it the standard way:

```
 Greg, in Claude (web or phone)               Spideryarn                      Supabase Auth
 ────────────────────────────                 ──────────                      ─────────────
 Settings → Connectors → Add custom
   address: …spideryarn.com/api/mcp  ──►  POST /api/mcp, no token
                                      ◄──  401, "sign in at Supabase" (where, in a header)
 Claude registers itself as a client ─────────────────────────────────────►  /auth/v1/oauth/…
 a browser tab opens  ──────────────────────────────────────────────────────►  authorize
                                           /oauth/consent?authorization_id=…  ◄── redirect
                                           (signed in with Google as usual)
                                           "Claude wants to use Spideryarn
                                            as greg@… — Allow / Deny"
                                           Allow ─────────────────────────►  approve
 back in Claude, with a token  ◄────────────────────────────────────────────  code → token
 every tool call: POST /api/mcp, Bearer <token>  ──►  checked, then the same tools run as Greg
```

Supabase's **OAuth server** (in beta) does the token-issuing half: client registration, the
authorization code with PKCE, tokens and refresh. We write three things: the consent page, the
`/api/mcp` route, and the rule that keeps these tokens out of the rest of the API.

## Revised after Sol's plan review (`rethink`), before any code

[261007p-mcp-plan-review-sol.md](261007p-mcp-plan-review-sol.md) found ten things; the first changes the
shape, and a research pass confirmed it from Supabase's source:

> **A Supabase OAuth token is a whole Supabase credential for the account.** Supabase's own Auth API
> (`PUT /auth/v1/user`: change the password; the MFA endpoints) checks the signature and the
> session, never `client_id` or `aud`. Our site can refuse the token everywhere but `/api/mcp`; it
> cannot stop the token being taken straight to Supabase. Scopes restrict nothing ("do not control
> access to your database tables or API endpoints", Supabase's token-security page).

Combined with open client registration, that is an account takeover by phishing: anyone registers
a client called "Claude", sends Greg the authorize link, he presses Allow on a real Spideryarn page,
and their token changes his password. So the design is now:

- **No open registration. One client, registered by hand** in Supabase (Authentication → OAuth
  Apps): confidential, redirect `https://claude.ai/api/mcp/auth_callback` exactly. Greg adds the
  connector in Claude with *Use your own OAuth client* and pastes its id and secret. Nobody else can
  obtain a token at all, so the phishing route is closed rather than warned about (F6).
- **`/api/mcp` accepts only that client's tokens**: `client_id` must equal `MCP_OAUTH_CLIENT_ID`
  from the environment. Unset, the route refuses everyone, so **it ships dark** and nothing changes
  until Greg switches it on. That is also the binding Sol's F2 asks for, in the form Supabase can
  give: there is one client and it exists for this one resource. (Supabase issues `aud:
  "authenticated"` and ignores the `resource` parameter Claude sends; a Custom Access Token Hook
  could set `aud`, which our gate would then also check, but it changes nothing at Supabase's own
  endpoints, so it is left out of v1.)
- **What is left, and it is Greg's to accept or not** (Question 2 below): the token lives on
  Anthropic's connector servers (the model never sees it), and while it is valid it could change
  the account at Supabase. Two production Auth settings shrink that: *secure password change*
  (re-authentication by email before a password change; `false` locally today) and the email
  double confirmation (on). The spike checks what the token can and cannot do with them on.
- F3: the spike sends `resource=…/api/mcp` on the authorize and token requests as Claude does, and
  a real Claude.ai connector is the acceptance test, which only Greg can run.
- F4: `vercel.json` rewrites `/.well-known/oauth-protected-resource/api/mcp` to
  `/api/index?__spy_path=mcp/resource-metadata`, before the SPA catch-all.
- F5: a fresh `McpServer`, transport and identity-bound context **per request**, with
  `enableJsonResponse: true`, closed afterwards; tested with two overlapping requests.
- F7: `Origin`, when present, must be the site's own origin or `https://claude.ai`; absent is
  allowed; anything else is 403. Resource and metadata addresses come from configuration
  (`PUBLIC_SITE_URL` or the existing equivalent), never the request's `Host`.
- F8: the remote approver throws the existing `CannotAsk` with the page to use, whatever the OS.
- F9: the tests listed below grow: another owner's article invisible through the tools, the admin
  and billing refusals preserved, a browser token still accepted by the ordinary gate, the consent
  page keeping `authorization_id` through sign-in, and the stdio suites unchanged.
- F10: revocation, honestly: removing the client in Supabase or unsetting `MCP_OAUTH_CLIENT_ID`
  stops new tokens; an access token already issued is valid up to its expiry (an hour,
  `jwt_expiry`) at Supabase, though unsetting the variable refuses it at `/api/mcp` at once.

The in-process `Api` through `handleApi` stands (Sol: "defensible if its verifier is private,
created per verified request, and used only for tool-constructed requests").

Everything below is the original plan, amended by the list above where they differ.

## What gets built

### 1. The consent page, `/oauth/consent`

A small page in the app. Supabase sends the browser there with `?authorization_id=…`. If the
person is not signed in, the usual sign-in, then back here. It reads the request with
`supabase.auth.oauth.getAuthorizationDetails(id)` and shows, in plain words: which app is asking
(the client's name **and the host of its redirect address**, since a registered name is whatever the
registrant typed), which account it will act as, and what that means: *"It will be able to do what
you can do on Spideryarn: read and organise your shelf, import articles, and, as an administrator,
see readers and gift vouchers. It cannot send email or publish anything without you; those need
the Mac app."* Then **Allow** and **Deny**, calling `approveAuthorization` / `denyAuthorization`,
which redirect back to the app. A request already consented to redirects straight on. Desktop, iPad
and phone widths; browser-checked.

### 2. `POST /api/mcp`

One route, dispatched in `serveApi` **before** the ordinary gate, as the Stripe webhook is, because
it does its own:

- **The token must be an OAuth token**: verified exactly as `requireUser` verifies (signature,
  expiry, `sub`, `role`, `email`), **and** carrying a `client_id` claim, which Supabase puts on
  tokens it issues to an OAuth client and never on a browser session's. A browser session's token
  is refused here. A missing or bad token is a 401 with
  `WWW-Authenticate: Bearer resource_metadata="https://<site>/api/mcp/resource-metadata"`, which is
  how an MCP client finds out where to sign in.
- **Administrator only, for now.** `isAdmin(user.id)`, else 403. Greg's own account is the only one
  this has been designed for; offering it to readers is a later decision (scopes, per-client
  revocation, abuse), and the consent page's wording would change with it.
- **The tools are the same `TOOLS` list**, run with an `Api` that calls the site's own routes
  **in-process**, through `handleApi`, as the already-verified user. Every route's own checks (the
  owner scoping, the admin namespace, billing) apply exactly as they do to the local server's HTTP
  calls. No token travels inside: the in-process `Api` hands `handleApi` a verifier bound to this
  one verified identity, so nothing new can be made to authenticate.
- **Stateless Streamable HTTP**, `WebStandardStreamableHTTPServerTransport` from the SDK already
  installed (`@modelcontextprotocol/server` 2.3.1), with `sessionIdGenerator: undefined` and JSON
  responses: one request, one answer, which is what a serverless function wants. `GET` and `DELETE`
  are 405.
- **The asking tools refuse remotely.** `create_gift_voucher`, a re-addressing
  `update_gift_voucher`, `retry_gift_voucher_email`, `make_article_public` and
  `create_private_link` need the macOS dialog, which a server on Vercel cannot show; the remote
  `Approver` says no with a sentence naming the web page to use instead. So from a phone the agent
  can read, list, tag, import and look up readers, but cannot send mail, publish or hand over a key.
  (Question 1 below.)

`GET /api/mcp/resource-metadata` answers the RFC 9728 document: `resource`
(`https://<site>/api/mcp`), `authorization_servers` (`<SUPABASE_URL>/auth/v1`),
`bearer_methods_supported: ["header"]`. Public, `no-store`. And `vercel.json` rewrites
`/.well-known/oauth-protected-resource/api/mcp` to it, for clients that look there first.

### 3. OAuth tokens are refused everywhere else

`requireUser` refuses a token with a `client_id` claim: 401, `[auth-oauth-token]`. Without this, a
token Greg granted Claude for the MCP would also open every other route of the API, including ones
that are not tools; the MCP spec forbids a token passing through to anything but the resource it
was issued for. This is the change to the sign-in gate.

### What the security map gains

**Before** (security-map.md, the parties table and the auth section, today): a request to `/api/*`
is authenticated by a Supabase access token from the browser's session; every authenticated route
is behind `requireUser`.

**After**, a new subsection under the sign-in gate:

> **An AI app's token, since 2026-10-07.** Supabase's OAuth server issues tokens to AI apps the
> owner approves on `/oauth/consent`. Such a token carries a `client_id` claim. It is accepted at
> exactly one route, `POST /api/mcp`, which serves the MCP tools as that owner (administrator only,
> for now), and refused by `requireUser` everywhere else, so a connector's token cannot reach a
> route that is not a tool. The tools that send mail, publish or hand over a private link refuse
> over this route, because their approval is a dialog on the owner's Mac. Dynamic client
> registration is on, so anyone can register a client; what stops a stranger's client is the owner's
> consent, which names the client and where it redirects. Revoking: Supabase's per-user grants
> (dashboard), or signing out everywhere.

## Configuration

- **Local**: `supabase/config.toml` `[auth.oauth_server] enabled = true`,
  `allow_dynamic_registration = true` (the stanza is already there, off). Needs a restart of the
  shared local Supabase stack to take effect, which interrupts other agents for about a minute;
  done once, at a quiet moment, and said in the debrief.
- **Production, Greg's to switch on** (dashboard, Authentication → OAuth Server): enable, authorization
  path `/oauth/consent`, dynamic registration on; Site URL is already `https://www.spideryarn.com`.
  Then deploy (the Overseer). Then, in Claude: Settings → Connectors → Add custom connector →
  `https://www.spideryarn.com/api/mcp`.

## Tests, red first

- `requireUser` refuses a token whose claims carry `client_id`, and still accepts one without.
- `/api/mcp`: no token → 401 with the `resource_metadata` header; a browser token (no `client_id`)
  → 401; a non-admin's OAuth token → 403; the admin's → `tools/list` answers the tool names.
- Driven with the SDK's client over the real route: `list_articles` reaches the library route as
  that user (the in-process `Api`), an admin tool reaches `/api/admin/users`, and an asking tool
  refuses without writing.
- The metadata route answers the document, unauthenticated.
- The consent page: renders the client name and redirect host, Allow calls approve, Deny calls deny
  (with the Supabase calls faked).

## The spike, against the local stack

With the OAuth server on locally: register a client (dynamic registration), authorize with PKCE as
the local admin, approve on the consent route through supabase-js, exchange the code, then run the
SDK's client over HTTP against `/api/mcp` with the token: `whoami`, `list_articles`, `list_users`.
Then the absences: the same token on `GET /api/library` is a 401; the local reader-b's OAuth token
on `/api/mcp` is a 403. And one thing to find out rather than assume: **what else the OAuth token
opens at Supabase itself**, for example `PUT /auth/v1/user` (changing the account's password or
email). Supabase's Data API cannot see our schema (database.md), but the Auth API is Supabase's. If
it can, that is written up as a finding for Greg before production is switched on.

## What landed (stage 1)

Built by an Opus subagent (the consent page by a fork of it), reviewed by Sol, gates run here.

- `src/auth.ts`: the claim checks split into `verifiedClaims` and `personFrom`, shared by both gates;
  `requireUser` refuses a `client_id`, `[auth-oauth-token]`.
- `src/mcp/remote.ts`: Origin, then `MCP_OAUTH_CLIENT_ID` (unset → 401 `[mcp-off]`, with the same
  sign-in challenge so a client sees one shape), then the token and its `client_id`, then the
  administrator; a fresh server and transport per POST; the in-process `Api`; `REMOTE_APPROVER`;
  the resource metadata. Dispatched in `serveApi` after the Stripe webhook, before the gate.
- `src/site-origin.ts`: `billingReturnOrigin`'s logic, moved so the MCP's resource address and
  Stripe's return address are one answer, not two.
- `src/web/OAuthConsentPage.tsx` at `/oauth/consent`; `vercel.json`'s well-known rewrite;
  `supabase/config.toml` OAuth server on, dynamic registration off.
- Tests: `tests/mcp-remote.test.ts` (14, local Postgres: the gate's refusals, the tools through the
  SDK's client reading the admin's article and not another reader's, the asking tools refusing with
  the row unchanged, two overlapping clients), `mcp-remote-boundaries`, `mcp-remote-lifetime`,
  `mcp-remote-import-graph`, `oauth-consent-page` (11+), and cases in `auth`, `public-read-rewrite`,
  `owner-isolation` (`serveApi` may now import `./mcp/remote.js`). Three cases in `mcp-remote` passed
  before the code existed (another app's token, the variable unset, the token on `/api/library`),
  because the behaviour already held; they are guards, not red-first evidence.

**Not done, and why: the spike against a real OAuth server.** It needs the shared local Supabase
restarted with the OAuth server on, which interrupts every other session on the box for a minute,
late on a busy evening, for a route that is switched off. So it is **the first step of switching
on**, before production: restart the local stack with this `config.toml`, register a confidential
client by hand, run authorize (with `resource=`) → consent → token, and check (a) the token has
`client_id` and `/api/mcp` serves it, (b) the same token on `/api/library` is a 401, (c) what
`PUT /auth/v1/user` does with it with *secure password change* on and off. (c) is the fact Greg's
decision rests on.

## Review

**Plan review (GPT Sol):** `VERDICT: rethink`, ten findings,
[261007p-mcp-plan-review-sol.md](261007p-mcp-plan-review-sol.md); taken as § Revised above. F1 (the token
is a whole Supabase credential) is not defended in code, because it cannot be from our side; it is
reduced (one registered client, no dynamic registration) and put to Greg as Question 2.

**Code review (GPT Sol, write-capable):**
[261007p-mcp-stage-1-code-review-sol.md](261007p-mcp-stage-1-code-review-sol.md). Four fixed by Sol, each
red first: **C1 (P1)** the consent page kept the previous request's details while Allow used a new
`authorization_id`, so it could approve something not on screen; C2 an oversized body destroyed the
connection before its 413; C3 a client disconnecting left the per-request server and the sentinel
verifier alive; C4 the consent page described the tools and not the credential, and the security
map called the Supabase risk accepted when it is Greg's to decide. Postmortems 261007v–y. Its `not
ready` was only the checks its sandbox could not run (Postgres, sockets, typecheck); run here
afterwards: typecheck clean, 15 files and 348 tests green.

## The simpler option passed over

**A fixed key** (option B in 261007j): a key made on `/profile`, pasted into the connector's
settings. Half the work. Passed over because Greg prefers OAuth, because a key in a connector's
settings is a long-lived credential we must also build revocation for, and because OAuth is the only
version that could ever extend to other readers. We would fall back to it only if Supabase's OAuth
server proves unworkable with Claude's connector (say, its registration or metadata turns out
incompatible), and the spike above is where that would show.

## Questions for Greg (not blocking)

**Question 1: should the tools that need your approval work from the phone?** Today they need the
dialog on your Mac, so remotely they refuse: from Cowork on the web the agent can read, organise,
import and look up readers, but cannot send a gift, publish, or hand over a private link. Making
them work remotely means a different kind of approval: for example the tool answers *"approve at
spideryarn.com/approve/…"* and you tap a button on a Spideryarn page signed in as you. That is a
page, a table and a test or two. Recommendation: wait until you have used the read-only remote
version and miss it.

**Question 2: switching it on in production, knowing what the token can do.** Until you do, the
route refuses everyone and nothing changes for readers. Switching on is: turn on Supabase's OAuth
server (no dynamic registration), register one OAuth app for Claude's callback, put its id in
Vercel as `MCP_OAUTH_CLIENT_ID`, deploy, add the connector in Claude with that id and secret.

What you would be accepting: the token Claude holds for you is, at Supabase, a sign-in to your
account for up to an hour at a time, and it is refreshed. Spideryarn only lets it run the MCP tools,
but Supabase itself would let it change your password unless *secure password change* is on (then
it would need a code from your email). The model never sees the token; Anthropic's connector
service holds it. Recommendation: turn *secure password change* on first (it costs you an email
code when you change your own password), then switch this on.
