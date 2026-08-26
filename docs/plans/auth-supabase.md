# Signing in — Supabase Auth, Google first

**Status: plan, 2026-08-26. Steps 0–2 partly done; nothing in the app has changed yet.**

| | |
|---|---|
| `@supabase/supabase-js@^2.112.4` | **installed** |
| The Google credentials, under Supabase's own variable names in `.env.local` | **done** |
| `[auth.external.google]` in `supabase/config.toml`, and a stack restart | **done** — `/auth/v1/settings` now reports `google: true` |
| `http://127.0.0.1:54361/auth/v1/callback` registered on the Google OAuth client | **not done, and blocking.** A real browser sign-in dies on Google's `Error 400: redirect_uri_mismatch`. See [step 0](#step-0-what-greg-has-to-click-10-minutes-and-nobody-else-can-do-it) — and read [§ The check that could not fail](#the-check-that-could-not-fail) before trusting any command in this document. |
| Everything in the app — client, gate, screen, tests | **not started** |
| **A cross-family review** | **could not run.** See [§ The review that did not happen](#the-review-that-did-not-happen). |

The provider argument is over — [auth.md](../project/auth.md) decided Supabase Auth on 2026-08-25,
and [auth-options.md](../research/auth-options.md) is the survey behind it. This document is the
build: what to click, what to write, in what order, and the six ways it will report success while
doing nothing.

Greg, 2026-08-26, on what this is for:

> Let's set up authentication, ideally via Supabase. The most important is via Google SSO, but it
> would be nice to support email+password and one or two others too.

and on how far to go:

> Email+password would be great, and Apple would be a nice-to-have. But if it complicates things,
> I'd be happy just to get Google working for v1.

So: **Google is v1**. Email+password is v1.1 and is cheap because the plumbing is the same.
Apple is [Appendix B](#appendix-b-apple-and-why-it-is-not-in-v1) and is not cheap.

---

## What is already true

Everything in this section was **measured on 2026-08-26**, not read in a doc. That matters, because
four of the six facts contradict what a model would guess.

| Measured | What it means |
|---|---|
| The local stack runs GoTrue **v2.195.0**, and `http://127.0.0.1:54361/auth/v1/.well-known/jwks.json` serves an **ES256** key | The local project is already on **asymmetric signing keys**. Not the legacy shared secret. |
| A real access token from the local stack has header `{"alg":"ES256","kid":"b81269f1-…"}` | It really is signing with that key. The `JWT_SECRET` that `supabase status` still prints is vestigial here. |
| `https://alschkahzfagtppxspfq.supabase.co/auth/v1/.well-known/jwks.json` **also** serves an ES256 key | The remote project is on asymmetric keys too. **The one difference that usually breaks this migration is not present.** |
| Remote `/auth/v1/settings` says `mailer_autoconfirm: false`; local says `true` | Email sign-up works instantly on this laptop and **waits for a confirmation email in production**. See [step 6](#step-6-email-password). |
| Remote `/auth/v1/settings` says `disable_signup: false`, and only `email` is enabled | Today, **anyone on earth can create an account on the production project.** Nothing yet stops them, because nothing yet reads a session. |
| The old app's `supabase/config.toml` has `[auth.external.google] enabled = true` with `skip_nonce_check = true`, pointed at `env(GOOGLE_OAUTH_CLIENT_ID)` | **Local Google SSO is a solved problem in this house.** The old app does exactly what we are about to do, against its own local stack on port 54341. We are copying a working recipe, not inventing one. |

Two more, from the npm registry and the shipped type definitions rather than from memory:

- **`@supabase/supabase-js` is at `2.112.4`** (published 2026-08-24). A `3.0.0-next.29` exists on the
  `next` tag. **Use 2.x.** A pre-release major on the week we wire up the login is not a trade
  anyone wants.
- **`supabase.auth.getClaims(jwt)` exists in 2.112.4** and is the modern verifier. Its own doc
  comment: *"If your project is using asymmetric JWT signing keys, then the verification is done
  locally usually without a network request using the WebCrypto API."* `@supabase/auth-js` depends
  on nothing but `tslib`, so **this needs no `jose`, no `jsonwebtoken`, no second crypto library.**

And one measured today that contradicts a live GitHub issue. [CLI #4324](https://github.com/supabase/cli/issues/4324)
reports `auth.admin.createUser` failing locally with *"token contains an invalid number of
segments"* when the new `sb_secret_…` key format is used. **It worked here**, first try, against
`sb_secret_N7UND0…` on this stack — a user was created and signed in and produced a valid ES256
token. Recorded so nobody spends an afternoon working around a bug this stack does not have.

### The three things the research changed

Written out because each was a *plausible* assumption that is wrong, and each would have cost a day.

**1. `flowType` does not default to `pkce`. It defaults to `implicit`.** Every current Supabase doc
recommends PKCE for browser apps and none of them make it the default in `createClient`. The
implicit flow returns the token in the URL **fragment** rather than as an exchangeable code, which
changes what comes back to `main.tsx` and puts an access token in the browser's history. Set
`flowType: "pkce"` explicitly. This is the single most likely thing for somebody to leave out
because "the docs are all about PKCE".

**2. The `onAuthStateChange` deadlock is half-fixed, and the half that remains is the one that
matters.** The widely-cited advice is "never `await` inside the callback". In 2.112.4 that is now
too strong *and* too weak, and the shipped types say both things:

- Too strong: `GoTrueClient.d.ts:95-107` describes a `_pendingInitNotifications` queue that exists
  precisely so a callback firing during `initialize()` can call `getSession()`/`getUser()` without
  deadlocking. The doc comment on the event list says callbacks *"can be `async` and can safely
  call other Supabase auth methods."*
- Too weak: the **async overload is marked `@deprecated`** at `GoTrueClient.d.ts:2061`, with the
  reason spelled out — *"Async callbacks can deadlock when they trigger a nested refresh from a
  `TOKEN_REFRESHED` event."*

So the rule for this repo is narrower and more useful than the folklore: **use the synchronous
overload; do not do refresh-triggering work inside the callback.** Reading the session out and
putting it in React state is fine.

**3. The publishable key is a valid signed JWT with no `sub` claim.** It is sitting in our own
browser bundle, so a client bug that forwards the wrong string produces a *correctly signed* token.
`getClaims` will verify it happily. **The gate must require `sub` and `email` explicitly**, not
merely "the signature checked out". That is now a test.

### Which Google OAuth client

Greg's answer to "new client or reuse": **reuse the old app's.** It lives in Google Cloud project
number **815353440959**, client id `815353440959-ov99gpv5i….apps.googleusercontent.com`, and its id
and secret are already in `/Users/greg/dev/spideryarn/reading/.env.local` as `GOOGLE_OAUTH_CLIENT_ID`
and `GOOGLE_OAUTH_CLIENT_SECRET`.

They have been copied into this repo's `.env.local` under the names Supabase's CLI wants —
`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` — because
`supabase/config.toml` reads them by those names and by no other. `.env*` is gitignored, so nothing
crossed into git. **The client id is not a secret** (it travels in every redirect URL); the secret is.

---

## The shape of it

```
   BROWSER                                    │  SERVER (same origin, always)
                                              │
   ┌──────────────────────────────────┐       │   ┌──────────────────────────────┐
   │ src/web/lib/supabase.ts          │       │   │ src/routes.ts  handleApi()   │
   │  createClient(url, publishable)  │       │   │                              │
   │  ONE module-scope singleton      │       │   │   if (!url.startsWith        │
   └───────────┬──────────────────────┘       │   │       ("/api/")) return false│
               │ session (localStorage)       │   │                              │
               ▼                              │   │   ┌──────────────────────┐   │
   ┌──────────────────────────────────┐       │   │   │ src/auth.ts          │   │
   │ src/web/useSession.ts            │       │   │   │  requireUser(req)    │◄──┼── THE GATE
   │  onAuthStateChange → React state │       │   │   │  • Bearer header?    │   │   ONE call,
   └───────────┬──────────────────────┘       │   │   │  • getClaims(jwt)    │   │   at the top,
               │                              │   │   │  • email on the list?│   │   before any
      ┌────────┴────────┐                     │   │   └──────────┬───────────┘   │   route matches
      ▼                 ▼                     │   │              │               │
   no session       session                   │   │        ok ───┴─── no ──► 401/403
      │                 │                     │   │              │
      ▼                 ▼                     │   │              ▼
   SignInPage      the whole app              │   │        the 40-odd routes
                        │                     │   └──────────────────────────────┘
                        │ every fetch         │
                        ▼                     │
   ┌──────────────────────────────────┐       │
   │ src/web/lib/api.ts  apiFetch()   │───────┼──►  Authorization: Bearer <access_token>
   │  the ONLY place a token is       │       │
   │  attached — 25 call sites move   │       │
   └──────────────────────────────────┘       │
```

Three things about that picture are decisions rather than drawings.

**The token goes in a header, not a cookie.** A cookie would attach itself to all 25 `fetch` calls
for free, which is genuinely tempting. It loses on two counts. First, `@supabase/supabase-js` stores
the session in `localStorage` by default and putting it in a cookie means either `@supabase/ssr`
(which exists for server-rendered frameworks we are not) or a hand-written storage adapter. Second,
a cookie that rides along automatically is a cookie that rides along on requests nobody audited —
that is what CSRF is. A header is attached deliberately, at one seam, by code you can read.

**The gate is one call at the top of `handleApi`, not a check in each route.** Copied straight from
[deploy-and-repo-move.md § The beta gate](deploy-and-repo-move.md#the-beta-gate): *"`handleApi`
checks it once, at the top, rather than each route remembering to."* A route added next month is
gated because it exists, not because somebody remembered.

**The Supabase client is created at module scope, exactly once.** Not in a component, not in an
effect, not in a `useMemo`. Two reasons, and the second is the one that costs an afternoon:

- `main.tsx` renders inside `<StrictMode>`, which double-invokes effects in development. A PKCE
  authorisation code **can only be exchanged once** — the second attempt fails with a code-verifier
  error. Creating the client at module scope means `detectSessionInUrl` runs once, on import,
  before React has an opinion.
- Two clients means two token-refresh timers racing each other on the same refresh token, and
  rotation makes the loser's token invalid. It looks like random sign-outs.

---

## Step 0 — what Greg has to click (10 minutes, and nobody else can do it)

Everything else in this plan is code. This step is a browser and an account, and it blocks
[step 2](#step-2-turn-google-on-locally).

**In the Google Cloud console**, project 815353440959 → APIs & Services → Credentials → the OAuth
2.0 Client ID ending `…apps.googleusercontent.com`. Add to **Authorised redirect URIs**:

```
http://127.0.0.1:54361/auth/v1/callback          ← this repo's local Supabase stack
https://alschkahzfagtppxspfq.supabase.co/auth/v1/callback   ← the new remote project
```

Leave the old app's entries alone. One OAuth client can hold many redirect URIs, and this is
precisely what that is for.

**That first line is measured, not guessed** — and the distinction matters, because `localhost` and
`127.0.0.1` are *different strings* to Google even though they are the same machine. With Google
turned on locally, `/auth/v1/authorize?provider=google` 302s to Google carrying
`redirect_uri=http%3A%2F%2F127.0.0.1%3A54361%2Fauth%2Fv1%2Fcallback`. That, character for character,
is what has to be registered.

**And you can check it from a terminal, without a browser** — but only if the check follows the
redirect chain, and the obvious version of it does not. See
[§ The check that could not fail](#the-check-that-could-not-fail) below; this is the corrected one:

```bash
U=$(curl -s -o /dev/null -w "%{redirect_url}" "http://127.0.0.1:54361/auth/v1/authorize?provider=google")
L=$(curl -s -o /dev/null -w "%{redirect_url}" "$U")
python3 -c '
import sys, base64, re, urllib.parse
e = urllib.parse.parse_qs(urllib.parse.urlparse(sys.argv[1]).query).get("authError", [""])[0]
if not e:
    print("ACCEPTED - Google did not reject the redirect_uri")
else:
    raw = base64.urlsafe_b64decode(e + "=" * (-len(e) % 4)).decode("utf8", "replace")
    m = re.search(r"[a-z][a-z_]{6,}", raw)
    print("REJECTED -", m.group(0) if m else "reason not readable")
' "$L"
```

Two hops, because there are two: GoTrue 302s to Google, and *Google* 302s to its error page. The
reason is base64 in the `authError` parameter of that second redirect, wrapped in protobuf framing
and localised prose — hence the decode. On 2026-08-26 this prints
`REJECTED - redirect_uri_mismatch`, which is also exactly what a browser sign-in shows.

Google can take a few minutes to propagate a new URI, so re-run a couple of times before concluding
anything.

### The check that could not fail

The first version of that check was one line:

```bash
curl -s "$U" | grep -c redirect_uri_mismatch     # 0 = accepted, 1 = rejected  ← WRONG
```

**It returns 0 whatever is true**, because `curl` without `-L` fetches the *body of a 302*, and the
body of a 302 is a stub containing a link — never the error page. The word it greps for is in the
`Location` header of the next hop, base64-encoded, where `grep` was never going to see it.

It was worse than a wrong answer, because it was reported as evidence twice. The first run, against
an unregistered URI, printed the rejection in a *different* command's `-w "location=…"` output, and
that was misread as the grep matching. From then on the check "returned 0", which was read as "the
URI got registered" — and that was written into this plan's status table, and told to Greg. The
browser was what disagreed, on the actual sign-in, with `Error 400: redirect_uri_mismatch` naming
the same URI.

Three things worth carrying, and they are the whole of
[silent-success.md](../reusable/silent-success.md) in one afternoon:

- **A check that has never been seen to fail has not been tested.** The fix is to run it against the
  broken state *first*, deliberately, and watch it say so. "It agrees with what I hoped" is not the
  same evidence as "it can tell the two apart".
- **`grep` over `curl` output silently changes what it is looking at** the moment a redirect appears
  between you and the page. `-L`, or read the `Location` yourself — but decide which.
- **The browser was right and the terminal was wrong.** When a cheap proxy for a test disagrees with
  the real thing, the real thing wins, and the proxy is the bug.

**In the Supabase dashboard** for `alschkahzfagtppxspfq` → Authentication → Sign In / Providers →
Google: enable it, paste the same client id and secret. (The dashboard shows you its callback URL —
check it matches the second line above rather than trusting this document.)

Also on that dashboard, Authentication → URL Configuration:

- **Site URL** — the production origin.
- **Redirect URLs** — the allow-list for where Supabase may send the reader back *inside our app*
  (a different thing from Google's redirect URI, which points at Supabase). Entries are **exact
  matches** unless they carry a wildcard, and the wildcard has a trap: **`/*` matches one path
  segment; nested paths need `/**`.** `http://localhost:5273/**` locally. See
  [step 8](#step-8-production) for the production shape and why it is more awkward here than usual.

---

## Step 1 — the client library

```bash
npm install @supabase/supabase-js@^2.112.4
```

One dependency, no others. Not `@supabase/ssr` — that exists to reconcile cookies between a server
renderer and a browser, and this app has no server renderer. Not `@supabase/auth-ui-react` — see
[step 5](#step-5-the-sign-in-screen). Not `jose` — `getClaims` brings its own verification.

Two new **client-visible** environment variables, which in Vite means they must be named `VITE_*`
and are compiled into the bundle:

```
VITE_SUPABASE_URL=http://127.0.0.1:54361
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
```

Vite reads `.env.local` from the project root by itself, so these sit beside the existing
`SUPABASE_URL`. They are deliberately **not** the same variables: `src/env.ts` loads `.env.local`
into `process.env` for Node, and `import.meta.env` is a different mechanism with different rules.
Naming them apart stops anybody assuming one is the other.

> **`VITE_SUPABASE_PUBLISHABLE_KEY` is in the JavaScript bundle and that is correct.** It is the
> publishable key — its whole job is to be public. The one that must never be near this prefix is
> `SUPABASE_SERVICE_ROLE_KEY` / `sb_secret_…`, which bypasses every policy in the database. A test
> should assert that no `VITE_` variable's value looks like a secret key; see
> [step 7](#step-7-the-tests-that-have-to-exist).

---

## Step 2 — turn Google on locally

Append to `supabase/config.toml`, copying the old app's block verbatim:

```toml
[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
redirect_uri = ""
url = ""
# Required for local sign in with Google auth — the old app sets this too.
skip_nonce_check = true
```

`skip_nonce_check` deserves a sentence, because it is the sort of line somebody deletes while
tidying. Google's ID token carries a nonce that GoTrue checks against one it stored; against a local
stack that check fails for reasons to do with how the local instance is addressed, and the sign-in
dies at the last hop with an unhelpful message. It is **local only** — do not set anything like it
on the remote project, where the check works and is doing real work.

> **Coordination.** Another agent is working on the remote Supabase setup, and `supabase/config.toml`
> is a file we both touch. This block is additive and at the end of the `[auth.external.*]` run, so a
> merge is unlikely to be interesting — but restarting the local stack is not free for whoever else
> is using it. Say so before running `npm run db:stop && npm run db:start`.

Then verify, rather than believing:

```bash
npm run db:stop && npm run db:start
curl -s http://127.0.0.1:54361/auth/v1/settings -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" \
  | python3 -c 'import sys,json; print("google:", json.load(sys.stdin)["external"]["google"])'
#   → google: True     (it says False today — that is the before-picture)

curl -sI "http://127.0.0.1:54361/auth/v1/authorize?provider=google" | grep -i ^location
#   → the Google consent URL. Read `redirect_uri=` out of it and register THAT in step 0.
```

That second command is the whole point of this step. It is the only way to learn what GoTrue will
send Google without going through a browser, and getting it wrong is the single most likely way this
whole plan stalls.

### Test the whole Google round trip before writing any app code

Worth doing in this order, because it separates "Google and Supabase are talking" from "our React
is right", and those two failures look identical from a login screen that does nothing.

Count the users first, so there is a before-picture:

```bash
curl -s "$SUPABASE_URL/auth/v1/admin/users" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET" \
  | python3 -c 'import sys,json;print([(u["email"],u["app_metadata"].get("provider")) for u in json.load(sys.stdin)["users"]])'
```

On 2026-08-26 that was two users, both `email` — `dev@spideryarn.local` and a probe account. Then
open this in a browser and sign in as normal:

```
http://127.0.0.1:54361/auth/v1/authorize?provider=google&redirect_to=http://localhost:5273
```

Run the count again. **A third user, with provider `google`, is the proof.** No client library, no
sign-in screen, no `apiFetch` — if this works, everything left is React, and if it does not, no
amount of React was ever going to help. `http://localhost:5273` is already in
`additional_redirect_urls`, so the round trip lands somewhere real.

---

## Step 3 — the client seam

Three small files, and one refactor that is bigger than it sounds.

### `src/web/lib/supabase.ts`

The singleton. Module scope, created once, exported. Options that matter:

```ts
createClient(url, publishableKey, {
  auth: {
    persistSession: true,      // localStorage; survives a reload
    autoRefreshToken: true,
    detectSessionInUrl: true,  // consumes ?code=… on the way back from Google
    flowType: "pkce",          // NOT the default — the default is "implicit"
  },
})
```

The first three are already the browser defaults and are written out anyway, because this file is
where somebody will come looking to turn one of them off. **`flowType` is the one that is doing
work**: leave it out and you get the implicit flow, a token in the URL fragment, and a different
thing arriving back at `main.tsx` than the rest of this plan describes.

### `src/web/useSession.ts`

A hook over `onAuthStateChange`, returning `{ session, user, loading }`. Two rules:

- **Use the synchronous callback overload, and do no refresh-triggering work inside it.** Not the
  blanket "never `await` in there" that most write-ups give — see
  [§ The three things the research changed](#the-three-things-the-research-changed) for what 2.112.4
  actually does. Reading the session out and calling `setState` is exactly what this callback is
  for. Anything that could itself cause a token refresh goes outside it.
- **`loading` starts `true` and there is no third state.** Between page load and the first
  `INITIAL_SESSION` event there is a moment where the session is unknown, and rendering the sign-in
  page during it makes a signed-in reader see a login screen flash on every reload.

Also worth knowing before writing the effect: `SIGNED_IN` *"can fire very frequently"* and is
re-emitted when a tab regains focus, so it is not a "the user just logged in" event and must not be
treated as one.

### `src/web/lib/api.ts` — `apiFetch`

The one that costs real work. There are **25 raw `fetch(` calls across 12 files** in `src/web/`
today (`useJobs`, `useChat`, `useShelf`, `useComments`, `useGlossary`, `useSummaries`,
`useSearch`, `useLibrarySearch`, `App.tsx`, `Metadata.tsx`, `ShelfEntry.tsx`, `Tweets.tsx`). Each
becomes `apiFetch(…)`, which:

1. reads the current access token from the Supabase client and sets `Authorization: Bearer …`;
2. leaves everything else — method, body, signal, streaming response — exactly alone;
3. on a **401**, tells the session hook the session is gone, so the app falls back to the sign-in
   screen rather than showing 25 separate error toasts.

This file already exists and already owns the "how do we read an API response" decision — its header
explains that twelve call sites had independently written the same wrong four lines. This is the
same argument one layer up, and putting it anywhere else would be a second seam.

**Streaming is not special here**, and that is worth stating because it looks like it should be.
`src/web/lib/sse.ts` reads events off a `fetch` body, and `useChat.ts` says in its own comment that
it uses `fetch` rather than `EventSource` — so every streaming call already goes through a `fetch`
that can carry a header. Had any of them used `EventSource`, which cannot set headers, this whole
design would have had to be cookies. It is worth knowing that we got that for free.

---

## Step 4 — the gate

### `src/auth.ts`

```ts
export const ALLOWED_EMAILS = ["greg@gregdetre.com"] as const;

export interface AuthedUser { id: OwnerId; email: string }

/** Throws httpError(401|403). Never returns a user it is not sure about. */
export async function requireUser(req: IncomingMessage): Promise<AuthedUser>
```

What it does, in order:

1. Read `authorization`. Missing, or not `Bearer <something>` → **401**.
2. `supabase.auth.getClaims(token)` against a server-side client built from `SUPABASE_URL` and the
   **publishable** key. Error, or no claims → **401**. Verification is local, against the cached
   JWKS, because both projects sign ES256 (measured above).
3. **`claims.sub` absent → 401.** Not a formality. The publishable key *is* a validly signed
   Supabase JWT — it identifies a role rather than a person, and it has no `sub`. It is in our own
   browser bundle, so the wrong string reaching this function is a plausible client bug rather than
   an attack, and it would arrive with a perfect signature. "The signature checked out" is not the
   same claim as "this is a user".
4. `claims.email` absent, or not in `ALLOWED_EMAILS` (compared **lower-cased and trimmed**) →
   **403**, with the beta message.
5. Otherwise return `{ id: claims.sub, email: claims.email }`.

**Note the ordering: the gate runs before any body is read or validated.** So a malformed request
from a stranger gets 401 rather than 400, which is right — we owe an unauthenticated caller no
diagnosis of their JSON. The old app got the equivalent ordering wrong in the other direction and
recorded it (`old:docs/reference/TESTING_AUTH_MIDDLEWARE_SOLUTION.md`): auth throwing inside a
generic `catch` turned expected 400s into 500s. Ours cannot do that — `httpError` carries its own
status and `handleApi`'s `catch` honours it — but the tests should pin the order anyway.

Every failure path throws. There is no branch that returns `null` and lets a caller decide, because
a caller that forgets to check is exactly the bug this file exists to prevent.

**Use the publishable key, not the service-role key.** `getClaims` needs no privilege — it fetches a
public JWKS and does arithmetic. Handing it the secret key would work, and would put a
database-bypassing credential into a code path that runs on every request for no benefit.

### The wiring in `handleApi`

Immediately after the `if (!url.startsWith("/api/")) return false` line and **before any route
matches**, so a new route is gated by default. The `try` block already in place turns a thrown
`httpError` into the right status, so this is genuinely a few lines.

**One exemption, and it is not in `handleApi` at all.** `/api/health` is answered by `src/vercel.ts`
*before* `handleApi` is called, so it stays public by construction. That is defensible — it is a
deployment probe that must work when the application does not, and it returns environment variable
*names* (booleans), the node version, the region, the commit SHA and an article count. No secrets.
But it does leak how many articles are on the shelf, and it is the one thing here that a stranger
can read. Worth a line in [security.md](../project/security.md); worth revisiting if it ever grows.

### Copy

The 403 body goes in [`src/copy.ts`'s](../project/copy.md) house style — say what happened, whose
problem it is, what to do next, and a bracketed code at the end. Something like:

> Spideryarn is still in private beta. If you'd like access, email hello@spideryarn.com. [beta]

**Check that mailbox first.** [deploy-and-repo-move.md](deploy-and-repo-move.md#about-that-email-address)
already found that `hello@spideryarn.com` appears in the old repo only as a seeded test account, and
inviting strangers to email a dead mailbox is the same silent failure as a 200 with nothing in it.

---

## Step 5 — the sign-in screen

**Hand-built, in this repo's own components.** This was researched properly rather than assumed, and
every alternative fails on a different axis:

- **`@supabase/auth-ui-react` is dead.** Unmaintained since February 2024; the
  [`supabase-community/auth-ui`](https://github.com/supabase-community/auth-ui) repo was **archived
  on 23 October 2025** and is read-only. Training data still recommends it, so expect it to come up
  again — the same shape as Lucia in [auth-options.md](../research/auth-options.md).
- **Supabase's own replacement does not cover us.** The [Supabase UI Library](https://supabase.com/ui)
  is current and good, and its auth blocks — `password-based-auth`, `social-auth`, `oauth-consent` —
  are **Next.js only**, built on server actions and cookie-based SSR sessions. Its non-auth blocks
  have React variants; the auth ones never got one. (Its social block also defaults to GitHub.)
- **shadcn's `login-01`…`login-05` blocks are markup with no logic.** They work fine outside Next,
  and they buy a `Card`/`Input`/`Label` skeleton we do not have yet — not any of the Supabase
  wiring, which is the part with the traps in it.

`src/web/components/ui/` contains exactly two things today — `button.tsx` and `toggle.tsx`. So the
recommendation is: **`npx shadcn add input label`** (the CLI is already proven here and applies the
`tw:` prefix itself), reuse the existing `Button`, and **skip `Card`** — a centred `<form>` on the
existing tokens is less work than overriding shadcn's card chrome for one screen, which is the same
reasoning [shadcn-migration.md](shadcn-migration.md) used to reject `Dialog` and `Sheet`.
**Estimate: 80–150 lines** for the whole page.

The gate itself goes in `App.tsx`, where `useRoute()` already branches four ways:

```
loading  → nothing (not a spinner; it is one frame)
no user  → <SignInPage />
user     → the app exactly as it is today
```

A whole-app gate rather than a `/login` route, because [url-state.md](../project/url-state.md) says
every bit of view state lives in the URL and "who you are" is not view state. It also means a
bookmarked `/read/<slug>?at=spya-…` survives a sign-in: the address never changes, so after the
round trip the reader lands on the paragraph they left.

### The Google button is specified, not designed

[Google's branding guidelines](https://developers.google.com/identity/branding-guidelines) (page
updated 2026-07-07) are a condition of using the API rather than a suggestion, and the good news is
that **the dark theme is one of the three official variants** — so this near-black page does not
have to argue with them:

| | |
|---|---|
| Text | exactly **"Sign in with Google"**, "Sign up with Google" or "Continue with Google". Localisable; not otherwise rewordable. |
| Dark theme | fill `#131314`, stroke `#8E918F`, text `#E3E3E3` |
| The mark | pre-approved PNG/SVG downloads exist for all three themes. **Use the asset.** The "G" may not be recoloured or resized, and the button may not be scaled out of aspect ratio. |
| Shape | rectangular or pill; standard or icon-only |

One implementation note that saves a wrong turn: Google's *recommended* path is its
Identity-Services JavaScript button, and that button is built for Google's own One Tap / ID-token
flow. `signInWithOAuth` is a plain redirect, so it is not the right shape. **Put the downloaded
dark-theme asset inside an ordinary `<button onClick>`.** The SVG expects Google Sans, so give it a
real fallback stack or use the PNG.

---

## Step 6 — email + password

Everything above is provider-agnostic; this is one more form and two calls,
`signInWithPassword` and `signUp`. The complications are all in the email, not the code:

- **Locally it just works.** `mailer_autoconfirm: true` (measured), so a sign-up is immediately
  usable, and Mailpit at <http://127.0.0.1:54364> catches anything that is sent.
- **In production it does not.** `mailer_autoconfirm: false` (measured), so a sign-up sends a
  confirmation email and the account is unusable until it is clicked. Supabase's built-in mailer is
  heavily rate-limited and explicitly not for production. The old app has `GMAIL_SMTP_USER` /
  `GMAIL_SMTP_PASSWORD` in its `.env.local`, so **there is already a working SMTP sender in the
  house** — that is the cheapest path, and the local `[auth.email.smtp]` block is commented out and
  ready.
- **Forgot-password is a flow, not a button**, and it is in [Appendix A](#appendix-a-the-screens-we-are-not-building-yet)
  rather than here.

While email is enabled and `disable_signup` is false, **anybody can create an account on the
production project**. That is only safe because of the allowlist — which is the next section's
problem.

---

## Step 7 — the tests that have to exist

[auth.md](../project/auth.md) already names the one that matters:

> assert that **a request with no session and a request with the wrong email are both refused**.

`tests/routes.test.ts` already drives `handleApi` with a fake request and no network, so this is
cheap. **One thing will break first:** that harness builds its fake request with only `{ method, url }`
and **no `headers`**, so the moment `requireUser` reads `req.headers.authorization` every existing
test in the file throws on `undefined`. Add `headers: {}` to the harness in the same commit.

The list:

| Test | Why it exists |
|---|---|
| No `Authorization` header → 401 | The base case. |
| `Bearer garbage` → 401 | Not a JWT at all. |
| A **correctly signed** token for the wrong email → 403 | The allowlist actually being read. Needs a real token — mint one locally (below). |
| A token signed by **something else** → 401 | The one that catches a verifier that decodes without verifying. Sign a token with a key we make up; it must be refused. |
| An **expired** token → 401 | `getClaims` checks `exp`; pin it, because there is an `allowExpired` option somebody could pass. |
| The **publishable key itself** as a Bearer token → 401 | It is a JWT-shaped string, and it is sitting in the browser bundle. |
| A gated route with a good token → 200 | Otherwise a gate that refuses everything passes every test above. |
| No `VITE_*` variable holds a secret-shaped key | Guards the bundle. |

**The old app seeds users a different way, and it is worth knowing which to copy.** Its
`supabase/seed.sql` writes rows straight into `auth.users` with
`crypt('ASDFasdf1', gen_salt('bf'))`, idempotently, at fixed uuids — including one for
`greg@gregdetre.com`. That is the right tool for a **fixture that must survive `supabase db reset`
and be identical on a fresh clone**, which is exactly the argument `src/owner.ts` already makes for
`DEV_OWNER_ID` being a constant. It is the wrong tool for a unit test, because it writes to the
database rather than to the test.

**Minting a real token for a test is easy and worth doing** — this was measured today against the
local stack:

```bash
curl -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SECRET_KEY" -H "Authorization: Bearer $SECRET_KEY" \
  -d '{"email":"…","password":"…","email_confirm":true}'      # instantly usable
curl -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" …  # → a real ES256 access token
```

That gives the wrong-email 403 test a genuinely signed token rather than a hand-rolled fake, which
is the difference between testing the allowlist and testing the string comparison.

> **Note the tree is not green right now.** Two `npm test` runs today failed differently — Postgres
> store tests timing out on one run, `chat-tools` / `doc-links` / `library-log-volume` on the next.
> That is several agents editing one working tree, not this work. Establish which failures are
> yours by re-running before and after, not by trusting a single run.

---

## Step 8 — production

Three things, and the second is genuinely awkward.

**Vercel environment variables.** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are read
**at build time**, not at runtime — they are compiled into the bundle. Setting them after a deploy
changes nothing until the next build. This is the single most common way a Vite app ships pointing
at localhost.

**The redirect allow-list versus Vercel's hostnames.** [deployment.md](../project/deployment.md)
records that this project's URL is a per-deployment `spideryarn-<hash>-greg-detre.vercel.app`, and
that there is deliberately **no** stable `spideryarn.vercel.app` — it was removed because a
production domain cannot be SSO-protected on the Pro plan. So there is no fixed origin to register.
Supabase's redirect allow-list takes glob patterns, so `https://spideryarn-*-greg-detre.vercel.app/**`
covers it. Two consequences worth writing down:

- A glob that wide trusts every deployment under that name. That is fine while the team is one
  person and the account is Greg's, and it should be narrowed to the real domain the moment
  spideryarn.com moves across.
- Vercel's own SSO protection sits **in front of** all of this. A browser that has not passed
  Vercel's login never reaches the app at all, so the beta gate is currently the *second* of two
  gates. Do not read "it asked me to log in" as evidence that this code works.

**`SPIDERYARN_OWNER_ID` still governs who owns rows.** The gate identifies people; it does not yet
fill in `owner_id`. See [Appendix C](#appendix-c-owner_id-rls-and-the-second-person).

---

## The ways this fails silently

Six, and every one of them looks like success from the outside. This is the
[silent-success](../reusable/silent-success.md) list for this piece of work.

1. **A verifier that decodes instead of verifying.** `JSON.parse(atob(token.split(".")[1]))` gives
   you an email. It also gives an attacker any email they type. This is why `getClaims` is
   non-negotiable and why one test signs a token with the wrong key.
2. **`getSession()` on the server.** It reads storage and returns whatever is there without checking
   a signature. Supabase's own type definitions carry a security notice about it. Server code uses
   `getClaims`; `getSession` is a browser convenience.
3. **A gate mounted on some routes.** Which is why it goes above the route table rather than in it.
4. **An empty allowlist read as "allow everyone".** `ALLOWED_EMAILS.includes(email)` on an empty
   array is `false`, which fails closed — but `ALLOWED_EMAILS.length === 0 || …` written by a
   well-meaning future editor fails open. Pin the empty case in a test so the behaviour is stated
   rather than incidental.
5. **The client hiding the Add button instead of the server refusing the POST.** Decoration on a
   gate, not a gate.
6. **A 200 with an empty shelf instead of a 403.** Named in the deploy plan for exactly this
   reason: an empty library and a locked library look identical to a stranger, and identical in a
   log.

---

## What Greg decided, and the one thing worth pushing back on

> We can get rid of the allowlist once we've added authentication. I'll accept the risk
>
> — Greg, 2026-08-26

and

> Hard-coded constant for now. Though like I said earlier, we might remove it later once we're sure
> that authentication is working

So the allowlist ships as a constant in v1, and its removal is a decision he has already taken in
principle. **One thing to say out loud before that happens**, because it is a cheap fix and it will
not be obvious later: *"authenticated" is not a small set.* Anyone with a Google account can sign in
in about four seconds, and the wallet the gate exists to protect is `ANTHROPIC_API_KEY` at two model
calls per article. Deleting the allowlist opens the ingest pipeline to the entire internet.

The middle path costs one click and no code: **turn signups off** on the remote project
(`disable_signup`, currently `false`). Then existing users can sign in, nobody new can appear, and
letting a beta user in is one invite from the dashboard rather than a deploy. That gets the thing
Greg actually wants — no allowlist to maintain — without the thing he is accepting the risk of.

Recommended, not decided. His call.

---

## The order to build it

Each of these is a commit, and each leaves the tree working.

1. **Step 0** — Greg clicks. Blocks everything else. *(Greg)*
2. **Steps 1–2** — install, config, `VITE_*` vars, restart, verify with curl that `google: true`.
   Nothing in the app changes. *(30 min)*
3. **Step 3** — the singleton, the session hook, and `apiFetch` across 25 call sites. Still no gate,
   so the app behaves identically whether or not you are signed in. *(2 hours, mostly mechanical)*
4. **Step 5** — the sign-in screen and the `App.tsx` branch. Now you can sign in with Google and see
   your own email. **This is the first browser test, and the one worth doing carefully.** *(2 hours)*
5. **Step 4 + 7** — the gate and its tests, together, in one commit. Never the gate alone: a gate
   without the no-session test is the thing this whole document is afraid of. *(2 hours)*
6. **Step 6** — email + password. *(1 hour local, plus SMTP in production)*
7. **Step 8** — production. *(unknown; depends on the remote Supabase work in flight)*
8. **Docs** — [auth.md](../project/auth.md) stops being a stub, [security.md](../project/security.md)
   gains the health-endpoint note, [supabase-local.md](../project/supabase-local.md) gains the Google
   block and the `db:reset` consequence, [setup-dev.md](../project/setup-dev.md) gains the new
   environment variables, and [open-questions.md](../project/open-questions.md) loses whatever this
   answers.

---

## The review that did not happen

[AGENTS.md](../../AGENTS.md) says every plan under `docs/plans/` goes to GPT Sol before it is built.
**This one has not been reviewed, and that is not because it found nothing.** Both Codex
authentication paths are out of credits, on 2026-08-26:

- `CODEX_API_KEY` from `.env.local` → *"The account is out of credits."*
- Falling back to the logged-in ChatGPT subscription in `~/.codex/auth.json` → *"Your workspace is
  out of credits. Ask your workspace owner to refill in order to continue."* It got 122k tokens into
  the review — the activity log shows it reading `@supabase/auth-js`'s type definitions, which is
  exactly the right place to be looking — and then died.

The prompt is written and kept, so re-running is one command once credits exist. It asks nine
specific adversarial questions, and the two most valuable are the ones this document is least sure
of: whether the four URL rewrites in `src/web/main.tsx` damage a `?code=…` on the way back from
Google, and what `apiFetch` must do about a token that expires mid-stream.

**Do not build [step 4](#step-4-the-gate) without it.** The plan-stage review is cheap insurance on
a piece of code whose failure mode is silent and whose blast radius is the whole API.

---

## Open questions

1. **Should the Google client secret be rotated?** The old app's repo (`spideryarn/reading`) is
   **public on GitHub**, and its own
   `docs/planning/260525a_security_remediation_runbook.md` records a Supabase personal access token
   leaked in a commit in April 2026 and used to deploy a malicious Edge Function on project
   `blsgjlrezruxcfdyrqpk` in May. It was remediated on 2026-05-25. The Google OAuth **secret** lives
   in that repo's gitignored `.env.local` and there is no evidence it was exposed — but we are now
   reusing that same client in a second app, which doubles what one leak would cost. Rotating it is
   a two-minute job in the Google console plus two paste operations, and it is much cheaper to do
   now than to wonder about later. **Greg's call; recommended.**
2. **Does `hello@spideryarn.com` receive mail?** The 403 message invites strangers to write to it.
   Test before shipping the copy.
3. **`disable_signup` on the remote project** — the recommendation above. Greg's call.
4. **Does `supabase db reset` destroy the local Google-signed-in user?** Yes, and that is fine, but
   it also destroys `DEV_OWNER_ID`'s rows' owner. Worth a line in supabase-local.md.
5. **What happens to the old project's 9 users?** Nothing — we are on a new project
   (`alschkahzfagtppxspfq`), which has its own empty `auth.users`. The concern
   [auth.md](../project/auth.md) raised about inheriting them applies to the *old* project and is
   now moot. Worth deleting from that file.

---

# Appendix A — the screens we are not building yet

None of these are in v1. They are written down so that "add forgot-password" is a morning rather
than a design exercise, and because the list of what a complete set looks like is exactly the sort
of thing that is expensive to rediscover.

Each one is a Supabase call plus a screen. The call is never the hard part.

| Screen | The call | Why it is deferred |
|---|---|---|
| **Forgot password** — enter your email | `resetPasswordForEmail(email, { redirectTo })` | Needs working outbound email in production. Until SMTP is configured this screen sends nothing and says it did. |
| **Set a new password** — the page the email link lands on | `updateUser({ password })`, after the recovery token in the URL has become a session | The link arrives with a token in the URL fragment, which means this page has to exist at a **stable address** that survives the app's four URL rewrites in `main.tsx`. That is the actual work. |
| **Check your email** — after sign-up or reset | none | Trivial, but it must not claim an email was sent when the provider errored. |
| **Confirm your email** — the landing page for a sign-up link | none, `detectSessionInUrl` does it | Only needed once `mailer_autoconfirm` is false, i.e. only in production. |
| **Resend confirmation** | `resend({ type: "signup", email })` | Rate-limited server-side; the button has to say so rather than appearing broken. |
| **Change password while signed in** | `updateUser({ password })` | Needs `secure_password_change` thinking — should it require re-authentication? Local config has it `false`. |
| **Change email** | `updateUser({ email })` | `double_confirm_changes = true` in config: it emails **both** addresses. Two emails, two clicks, and a state in between where neither is confirmed. The fiddliest of these. |
| **Sign out** | `signOut()` | One line. Belongs in v1 or immediately after — being unable to sign out of a beta is a bad look. |
| **Account / profile page** | — | There is nothing to put on it yet. |
| **Link a second provider** to one account | `linkIdentity()` | Needs `enable_manual_linking = true`. The real question underneath it is what happens when the same person signs in with Google *and* email+password: Supabase may create **two users** with the same address unless identities are linked. Worth knowing before offering both. |
| **Magic link / email OTP** | `signInWithOtp` | Same email plumbing as password reset, and it deletes the need for four of the screens above. If the email work gets done anyway, this is arguably a better second method than passwords. |
| **A beta-users table** replacing the constant | a migration and a query | The moment a second person is let in. [auth.md](../project/auth.md) already says so. |
| **An admin screen** for that table | — | Only once inviting someone through Studio has become annoying. |

---

# Appendix B — Apple, and why it is not in v1

Greg: *"Apple would be a nice-to-have. But if it complicates things…"*. It complicates things.

Apple is not "another OAuth provider" in the way GitHub is. It needs:

- a **paid Apple Developer account** ($99/year) — everything else here is free;
- an App ID, a **Services ID**, and a private key file downloaded once and never again;
- a client secret that is **not a string but a signed JWT you generate yourself**, and which
  **expires after at most six months** — so it needs regenerating and re-pasting into the Supabase
  dashboard, forever, or the login breaks on a day nobody touched anything;
- a nuisance about the email: Apple offers users a private relay address, so the email you get is
  not the one they know they have. An email-based allowlist and Hide My Email interact badly.

It also returns the user's name only on the **first** authorisation, which is a classic source of
"why is everyone called null".

**Recommendation: skip until there is a reason.** The reason would be an iOS app, or beta users who
live on Apple devices and would rather not use Google. If it does get built, do it when there is
somebody to test it with — the first-authorisation-only behaviour means you get one clean run per
test account.

**GitHub, by contrast, is about twenty minutes**: an OAuth app on github.com, an id, a secret, one
line in `config.toml` and one in the dashboard. If a second provider is wanted for its own sake
rather than for a specific person, that is the one.

---

# Appendix C — `owner_id`, RLS, and the second person

Deliberately out of scope for v1, and this section is the note that stops it being a surprise.

The gate identifies people. It does not yet decide who owns rows. `src/owner.ts` still resolves the
owner from `SPIDERYARN_OWNER_ID`, or from `DEV_OWNER_ID` locally, and its own header says so:

> When the gate lands this gains a request argument and the constant goes; the signature is already
> shaped for it, which is the whole reason it is a function rather than an exported value.

Three things follow, and the first is a real trap:

**Signing in with Google creates a *new* `auth.users` row with a random uuid**, which is not
`DEV_OWNER_ID` and not whatever `SPIDERYARN_OWNER_ID` is set to. Today that is invisible, because —
as `src/owner.ts` records from GPT Sol's review — *"Nothing in `src/store/pg.ts` filters on
`owner_id`"*. The day it does, every existing article belongs to a user who cannot log in.
The fix is one `UPDATE`, and knowing it is coming is worth more than the `UPDATE`.

**`articles.slug` is globally unique on purpose**, because it is the URL contract. Two people
ingesting the same URL is a question for whoever adds the second person.

**RLS is still deferred**, and the whole reason Supabase Auth won the provider argument is that it
keeps that door open: `auth.uid()` works because the JWT is Supabase's own. See
[auth-options.md § The line of schema that decided it](../research/auth-options.md).

---

## See also

- [auth.md](../project/auth.md) — the decision, and the shape of the gate
- [auth-options.md](../research/auth-options.md) — why Supabase Auth, and the eleven things it beat
- [deploy-and-repo-move.md § The beta gate](deploy-and-repo-move.md#the-beta-gate) — what the gate
  has to do, and the three ways a gate fails open
- [supabase-local.md](../project/supabase-local.md) — the local stack this is tested against
- [security.md](../project/security.md) — the two untrusted parties, and why neither is another user
- [deployment.md](../project/deployment.md) — the Vercel project, and why there is no stable hostname
- [silent-success.md](../reusable/silent-success.md) — the pattern the whole middle of this document
  is an instance of
