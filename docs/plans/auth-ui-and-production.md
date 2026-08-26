# The sign-in screen, and making it true in production

**2026-08-26.** The second half of [auth-supabase.md](auth-supabase.md). That plan proved Google
sign-in works against the local stack with no app code in the way; this one builds the app code and
carries it to Vercel.

> Ok, now let's add the UI elements to the app, and do anything else that will also make this work
> when we deploy to prod.
>
> — Greg, 2026-08-26

Read [auth-supabase.md](auth-supabase.md) first. It owns the *decisions* — why Supabase, why a
bearer token rather than a cookie, why the sign-in screen and the server gate must ship in one
commit, and who gets in. This file owns the *work*: the files to write, the twenty-five call sites
to move, the six things to set on two dashboards, and the checks that say whether any of it landed.

---

## The one thing that blocks production, measured today

**Google will refuse every production sign-in until one redirect URI is registered.** Not a guess —
here is the check, run against a URI known to be registered, one known not to be, and the two that
matter:

```
REJECTED  https://not-registered.example/cb                            (invalid_request)
ACCEPTED  http://127.0.0.1:54361/auth/v1/callback                      ← added this morning
ACCEPTED  https://blsgjlrezruxcfdyrqpk.supabase.co/auth/v1/callback    ← the OLD app's project
REJECTED  https://alschkahzfagtppxspfq.supabase.co/auth/v1/callback    (redirect_uri_mismatch)
```

The last line is this project. The OAuth client is shared with the old app
([§ Which Google OAuth client](auth-supabase.md#which-google-oauth-client)), so it already knows the
*old* project's callback and the local one, and has never been told about this one.

That is a Google Cloud Console edit, and **nobody but Greg can make it** — see
[§ What Greg has to do](#what-greg-has-to-do). Everything else in this plan can be built and tested
locally while it is outstanding.

### The check, and why it is written this way

`scripts/check-google-redirect.sh`, to be added with this work:

```bash
CID=$(grep '^SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=' .env.local | cut -d= -f2- | tr -d '"')
final=$(curl -s -L -o /dev/null -w "%{url_effective}" \
  "https://accounts.google.com/o/oauth2/v2/auth?client_id=$CID&redirect_uri=$uri&response_type=code&scope=email")
case "$final" in
  */signin/oauth/error*)  echo "REJECTED" ;;   # authError= is base64; decode it for the reason
  */signin/identifier*)   echo "ACCEPTED" ;;
esac
```

**Three things about it are load-bearing**, and the first two are the same mistake this repo already
paid for once ([§ The check that could not fail](auth-supabase.md#the-check-that-could-not-fail),
and the memory it produced):

1. **`-L`.** Without it curl fetches the body of a 302, which is a stub, and the grep finds nothing
   whatever is true.
2. **The verdict is the landing page, not a string in the body.** An earlier version grepped for
   `redirect_uri_mismatch` and reported `0` for all four URIs above — including the known-bad one —
   because the string lives in a base64 `authError` parameter on the *final URL*. A check whose
   failure mode is "finds nothing" agrees with you by default.
3. **It is run against a known-bad URI every time.** The first line of that output is not decoration.
   A row of ACCEPTEDs proves nothing unless something in the same run says REJECTED.

---

## What is already true

Measured on 2026-08-26, not assumed.

| | |
|---|---|
| Local Google sign-in | **works**, end to end, by a human. 3 users in the local stack. |
| Local redirect URI | registered. `http://127.0.0.1:54361/auth/v1/callback` — ACCEPTED above |
| Remote project (`alschkahzfagtppxspfq`) signs | **ES256**, JWKS live at `/auth/v1/.well-known/jwks.json` |
| Remote Google provider | **`"google": false`** — off. Read from `/auth/v1/settings` |
| Remote email provider | `"email": true`, `disable_signup: false`, `mailer_autoconfirm: false` |
| Remote publishable key | `sb_publishable_GrWX6tXl8CKN1TF0pcIn1Q_MgVR2cFW` — not a secret, it ships in the bundle |
| Remote redirect URI at Google | **not registered** — the blocker above |
| App code touching auth | **none yet**. `src/auth.ts` does not exist |
| Raw `fetch(` in `src/web/` | **31 calls in 14 files** — see [§ apiFetch](#the-refactor-thirty-one-call-sites) |
| `<a href="/api/…">` in `src/web/` | **2**, both in `Masthead.tsx`. These are the ones a bearer token cannot reach |

### Production, as it stands right now

Also measured today, and three of these are surprises worth having before writing any code.

| | |
|---|---|
| `spideryarn-greg-detre.vercel.app` | **200, serving the whole app and API to anyone.** `GET /api/library` answers a stranger |
| `spideryarn-reading2-git-main-…vercel.app` | 200, but it is the *branch alias* and it points at a **failed build** — "Deployment has failed" |
| `spideryarn-reading2-greg-detre.vercel.app` | 404. The obvious guess after the project rename, and it is not a hostname |
| Custom domains | **none**. `vercel domains ls` → 0 |
| `DATABASE_URL` on Vercel | **not set.** So the public site's API answers `{"error":"DATABASE_URL is not set…"}` |
| `NODE_OPTIONS` on Vercel | set for **Production only, not Preview** — see [§ The preview environment is missing a flag](#the-preview-environment-is-missing-a-flag) |
| `VITE_*` variables on Vercel | none, and they are read **at build time** |

**The project was renamed and the old hostname survived it.** `spideryarn-greg-detre.vercel.app`
still serves — so the redirect allow-list has to cover *two* name families, not one.
[deployment.md](../project/deployment.md) already says a generated hostname is not guaranteed to
keep working after a rename; this is the case where it did, and it is the public one.

---

## The shape of the change

```
  BROWSER                                        SERVER
  ───────                                        ──────

  main.tsx  ── /auth/callback exempt from
      │        all four rewrites
      ▼
  App.tsx ─── useSession()
      │         │
      │         ├── loading → nothing (one frame)
      │         ├── no user → <SignInPage />
      │         └── user    → the app, unchanged
      │
      ▼
  every request ── apiFetch() ──── Authorization: Bearer ──►  handleApi
                       │                                          │
                 getSession() every time,                    INSIDE the try:
                 never a cached token                        requireUser(req)
                                                                  │
                                                      getClaims → JWKS (local, cached)
                                                                  │
                                                            401 / 403 / on you go
```

Two arrows are not on that diagram and both are bugs waiting to happen:

- **`<a href="/api/source/…">`** — a plain navigation. It carries no header, so under the gate the
  reader's own PDF becomes a 401. [§ The two links a token cannot reach](#the-two-links-a-token-cannot-reach).
- **`/api/health`** — answered by `src/vercel.ts` *before* `handleApi`, so it is outside the gate by
  construction. That is fine for a GET and not fine for what it currently does with a POST.
  [§ Health](#health-must-be-fixed-before-it-can-be-an-exemption).

---

## Part 1 — the client seam

### `src/web/lib/supabase.ts`

Module scope, one client, exported. The options are in
[auth-supabase.md § Step 3](auth-supabase.md#srcweblibsupabasets); the one doing work is
`flowType: "pkce"`, because the default is `implicit` and the whole of this plan assumes a `?code=`
on the way back rather than a token in the fragment.

It reads `import.meta.env.VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. **If either is
missing, throw at module load with a sentence naming the variable.** Not a silent `undefined` that
turns into a 400 from an API nobody can find — the failure of a build-time variable is invisible
otherwise, and this is the app's single most likely production misconfiguration.

### `src/web/useSession.ts`

`{ session, user, loading, error }` over `onAuthStateChange`. The rules are in the previous plan.
Two things this file adds:

- **`error` is real state.** A return from Google can carry `?error=access_denied`, and without
  somewhere to put it the reader sees the sign-in screen again with no explanation.
- **A `pageshow` resync**, for a page restored from the bfcache with a token that expired while it
  was away.

### The refactor: thirty-one call sites

`apiFetch` goes in `src/web/lib/api.ts`, beside `readJson` — that file already owns "how do we talk
to our API" and a second seam would be worse than the work.

The count in the previous plan was 25 across 12 files; **it is 31 across 14**, counted today:

| File | Calls | | File | Calls |
|---|---|---|---|---|
| `useChat.ts` | 5 | | `Metadata.tsx` | 2 |
| `useShelf.ts` | 3 | | `App.tsx` | 2 |
| `useSearch.ts` | 3 | | `useSummaries.ts` | 1 |
| `useProfile.ts` | 3 | | `useLibrarySearch.ts` | 1 |
| `useGlossary.ts` | 3 | | `useJobs.ts` | 1 ← already a wrapper, `send()` |
| `useComments.ts` | 3 | | `Tweets.tsx` | 1 |
| `ProfilePage.tsx` | 2 | | `ShelfEntry.tsx` | 1 |

`useJobs.ts` is the easy one: its seven `/api/jobs…` calls already go through one local `send()`, so
that file is a one-line change covering seven requests. The rest are individual.

What `apiFetch` does, and the one thing it must not do, are in
[auth-supabase.md § apiFetch](auth-supabase.md#srcweblibapits-apifetch). Repeating only the
rule that gets forgotten: **a 401 is not "the session is gone"**. Refresh once, retry once, and
leave sign-out to the SDK's own auth events.

### The two links a token cannot reach

`Masthead.tsx:133` and `:142`:

```tsx
<a href={`/api/source/${meta.slug}`} target="_blank" rel="noreferrer noopener">
```

Two anchors, both opening the original PDF in a new tab. **A navigation carries no `Authorization`
header**, so the day the gate lands these become a 401 page where the reader's own document used to
be — and it will look like the PDF is missing rather than like auth is working.

Three ways out, and the third is the one to take:

1. **Exempt `/api/source/`.** No. It serves a stranger's uploaded PDF from our origin; that is the
   one route with a body worth protecting.
2. **A short-lived token in the query string.** Works, and puts a credential in an address bar, a
   browser history and a log line — the exact thing [logging.md](../project/logging.md) redacts for
   and cannot redact here, because redaction matches key paths and never text.
3. **Fetch it, then open it.** An `onClick` that opens the tab *synchronously* (so the popup blocker
   allows it), `apiFetch`es the PDF, and points the tab at a `blob:` URL when it arrives.

The synchronous-open detail is not fussiness: `window.open` after an `await` is blocked by every
browser, and the symptom is nothing happening at all. Revoke the object URL on unmount.

**A grep is the guard here**, and it belongs in the test suite: no `href` in `src/web/` may start
with `/api/`. It is the only thing that will notice when somebody adds the third one.

**And there is no third one today** — swept for rather than assumed. No `EventSource` (`useChat.ts`
says in its own comment why it uses `fetch` instead, and that choice is the reason this whole design
can be a header rather than a cookie), no service worker, no `sendBeacon`, no `window.open`, no
`<form action>` — every form in the app is an `onSubmit` handler — and no `<img>` or `<link>`
pointing at `/api/`. `index.html` references only static files in `public/`. Article HTML carries a
stranger's image URLs, not ours, because there is no image-proxy route.

---

## Part 2 — the screens

### `SignInPage.tsx`

Hand-built. Every off-the-shelf option was checked and each fails on a different axis —
`@supabase/auth-ui-react` archived October 2025, Supabase's replacement blocks are Next-only,
shadcn's login blocks are markup with no logic
([auth-supabase.md § Step 5](auth-supabase.md#step-5-the-sign-in-screen)).

- `npx shadcn add input label` — `src/web/components/ui/` has only `button.tsx` and `toggle.tsx`.
- No `Card`. A centred `<form>` on the existing tokens, same call
  [shadcn-migration.md](shadcn-migration.md) made about `Dialog`.
- **The Google button is specified, not designed.** Exact wording, the dark-theme palette
  (`#131314` / `#8E918F` / `#E3E3E3`), and the rule that the mark is a downloaded asset rather than
  something we draw, are all in
  [auth-supabase.md § The Google button](auth-supabase.md#the-google-button-is-specified-not-designed).
  This is a condition of using the API, not a style preference.
- Email + password sits under it, behind a "or use an email address" disclosure. Locally it works
  immediately (`mailer_autoconfirm: true`); in production it does not, which is
  [§ Email in production](#email-in-production-is-not-free).

Estimate 80–150 lines.

### `/auth/callback`, and the rewrite it must dodge

This is the route the whole design turns on, and the reason is a security bug rather than a
nicety: `canonicalAddHref` folds `location.search` **into the article URL**, so a Google return to
`/add/…?code=C&state=S` would encode our one-time authorisation code inside a stranger's address and
then fetch it. The full account, with the diagram, is in
[auth-supabase.md § /auth/callback](auth-supabase.md#authcallback-the-one-route-this-must-add).

The work:

- `parseRoute` gains `{ kind: "callback" }` and `{ kind: "login" }`.
- **`main.tsx` runs four `history.replaceState` rewrites before React mounts. `/auth/callback` is
  exempt from all four**, and the exemption goes *first*, above `canonicalAddHref`.
- `redirectTo` is always `${location.origin}/auth/callback`. Never the current page.
- Where the reader was going lives in `sessionStorage`, validated as a same-origin path on the way
  out and on the way back.

**Test the exemption by its consequence, not by reading it.** The test that matters is: land on
`/auth/callback?code=X`, and assert `location.href` never contains `code=X` inside an `/add/` path.

### Signing out

On the **`/profile` page**, which is already the page about you rather than about an article
([reader-profile.md](../project/reader-profile.md)). It gains a short block: the email, which
provider vouched for it, and Sign out. The library header gains a link to it beside `Design`.

That is two clicks from the reading view, which is right — signing out is not something to make easy
to do by accident, and a permanent account chip in the corner would be competing with the wordmark
for the one rectangle [HomeLogo.tsx](../../src/web/HomeLogo.tsx) spends fifty lines justifying.

---

## Part 3 — the gate

`src/auth.ts` and the wiring are specified in
[auth-supabase.md § Step 4](auth-supabase.md#step-4-the-gate). The two things worth restating,
because both are the kind of detail that survives a plan and dies in an editor:

**Inside the `try`.** Measured again today against the current file: the `/api/` prefix check is
`src/routes.ts:1992`, and the `try` begins at `:2077`. Eighty-five lines. A `requireUser` above the
`try` throws past the catch — 500 with the message in dev, blank 500 on Vercel, and `logRequest`
never runs, so **the refusal is never written down**.

**Errors carry their status by convention here**, not by class: `httpError(status, message)` at
`src/routes.ts:157` does `Object.assign(new Error(message), { status })`, and the catch at `:2450`
reads `.status`. So `requireUser` throws `httpError(401, …)` and needs nothing else to be reported
correctly. Every message it throws must be **fixed prose we wrote** — never the token, the header,
the SDK's error, the `sub` or the email — because `logRequest` writes it into a `reason` field and
redaction matches key paths, never text.

### Health must be fixed before it can be an exemption

`/api/health` is answered in `src/vercel.ts` before `handleApi` is reached, so it stays public
whatever the gate does. A read-only probe that must work when the application does not is a
reasonable thing to leave open. **It is not read-only.** `src/vercel-health.ts` sends every
non-GET/HEAD method into `bodyCheck`, which does `for await (const chunk of req) chunks.push(chunk)`
then `Buffer.concat` — and `MAX_BODY_BYTES` lives in `src/routes.ts`, not here. So:

```bash
curl -X DELETE https://host/api/health --data-binary @something-enormous
```

is an unauthenticated request that reads as much as anyone cares to send.

Before "the gate covers everything except health" is a true sentence: **GET and HEAD public; 405 for
everything else; the POST body diagnostic behind auth or a deployment secret and capped; and a
generic body for an import failure with the stack going to the log.** Found by GPT Sol on the
previous plan, confirmed by reading the file, still true today.

---

## Part 4 — production

### The two hostnames, and the allow-list that has to cover both

Supabase refuses to redirect anywhere not on the project's allow-list, and it takes globs. Both of
these serve today:

```
https://spideryarn-greg-detre.vercel.app/**              ← the pre-rename generated production host
https://spideryarn-*-greg-detre.vercel.app/**            ← per-deployment, pre-rename names
https://spideryarn-reading2-*-greg-detre.vercel.app/**   ← per-deployment, post-rename names
```

`/**` and not `/*` — one star does not cross a slash, so `/*` would cover `/auth` and not
`/auth/callback`. That is a real trap; the wildcard looks right and silently matches nothing.

Site URL is `https://spideryarn-greg-detre.vercel.app`.

Two things to say plainly about globs that wide. They trust every deployment under those names,
which is acceptable while the account is one person's and should be narrowed to the real domain the
day spideryarn.com moves across. And **there is nothing in front of this** — no Vercel SSO on a
production hostname without a $150/month add-on, no custom domain, no outer gate. This code is the
only gate there is.

### The environment variables

`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, on **Production and Preview**, set
**before** the build that needs them. Vite compiles them into the bundle; setting them after a
deploy changes nothing until the next one. This is the single most common way a Vite app ships
pointing at localhost, and it fails with a working page and a broken login rather than with an
error.

The server side needs `SUPABASE_URL` and a key for `getClaims`. `SUPABASE_URL` and
`SUPABASE_ANON_KEY` are already set on both environments (11h ago). Add
`SUPABASE_PUBLISHABLE_KEY` and have `src/auth.ts` prefer it, falling back to the legacy anon key —
the legacy keys still work on this project, and a fallback means the deploy does not have to be
simultaneous with the dashboard edit.

Locally, `VITE_*` go in `.env.local`, which Vite reads by itself. It is gitignored.

### The preview environment is missing a flag

`vercel env ls` today:

```
NODE_OPTIONS      Production            ← only
NODEJS_HELPERS    Preview, Production
```

`NODE_OPTIONS=--experimental-require-module` is on Production and **not on Preview**.
[deployment.md § The runtime has require(ESM) turned off](../project/deployment.md) explains what it
is for. Nothing here caused it and it is not this plan's bug, but any preview deployment used to
check this work will fail for a reason that has nothing to do with auth, and that is an afternoon.
Set it, or deploy straight to production and know why.

### The last build on main failed, and the branch alias is showing it

`spideryarn-reading2-git-main-greg-detre.vercel.app` currently serves **"Deployment has failed"**.
The build log:

```
[MISSING_EXPORT] "readRaw" is not exported by "src/fetch.ts".       src/routes.ts:93
[MISSING_EXPORT] "normaliseUrl" is not exported by "src/ingest.ts". src/routes.ts:94
```

This is [deployment.md](../project/deployment.md)'s named failure exactly: `src/routes.ts` committed
importing exports still sitting uncommitted in somebody's working copy. **It has since been fixed** —
both exports are in `HEAD` now — so the next push should go green. Two consequences for this work:

- Do not read a red branch alias as evidence about the auth commit. Check the build that has your
  commit's SHA in it.
- Confirm main builds *before* pushing the auth work, so a failure has one cause rather than two.
  `npm run build && npx vite build --config vite.api.config.ts` is what Vercel runs.

### The server-side cost of the SDK, which nobody has weighed

`src/auth.ts` calls `supabase.auth.getClaims(token)`, which means `@supabase/supabase-js` is now
imported by the serverless function. `vite.api.config.ts` leaves **everything external** and lets
Vercel's dependency tracing pull it in, so that import drags the whole client along:

```
@supabase/auth-js       3.2M     ← the only part we use
@supabase/postgrest-js  1.5M
@supabase/realtime-js   1.0M
@supabase/storage-js    1.0M
@supabase/functions-js  480K
```

Roughly 7MB of `node_modules` added to a function whose bundle is 3.3MB today, to do arithmetic on
a public key. That is a cold-start cost on every request that arrives at an idle instance, which on
a site with one reader is most of them.

Three options, and the recommendation is the first:

1. **Ship `getClaims` and measure.** It is the maintained path, it caches the JWKS and handles key
   rotation, and the previous plan's argument for it stands. If cold starts are visibly worse, we
   will know from `/api/health` timings rather than from a guess.
2. Import `@supabase/auth-js` directly — saves ~4MB, gives up the convenience wrapper.
3. **Verify ES256 ourselves** against the JWKS with `crypto.subtle`. Sixty lines, no dependency, and
   both projects are on ES256 so there is no HS256 path to get wrong.

**Option 3 is not the same mistake as `JSON.parse(atob(...))`**, and the difference has to be stated
because they look alike from a distance: one checks the signature and one does not. It is still the
option with the most rope, and the wrong-key test in
[Part 5](#part-5-the-tests) is what would catch it. Do not take it without a measurement saying
option 1 is a problem.

### Email in production is not free

`mailer_autoconfirm: false` on the remote project, so a sign-up sends a confirmation email and the
account does not work until it is clicked. Supabase's built-in mailer is rate-limited and explicitly
not for production. The old app already has `GMAIL_SMTP_USER` / `GMAIL_SMTP_PASSWORD` working, so
that is the cheap path — but it is **not in v1**. Google works without it.

### Enabling Google on the remote project

`"google": false` today. It needs the client id and secret, and the Site URL and allow-list above.

**Do not use `supabase link` + `supabase config push` to do it.** `supabase/config.toml` carries
`skip_nonce_check = true`, which is correct locally and is a security setting nobody should push to
a production project. `config push` sends the whole `[auth]` block. Dashboard clicks, or the
Management API with a personal access token — either way the local-only line stays local.

---

## Part 5 — the tests

The list is in [auth-supabase.md § Step 7](auth-supabase.md#step-7-the-tests-that-have-to-exist),
including the harness problem: `tests/routes.test.ts` builds its fake request as `{ method, url }`
with **no `headers`**, so `req.headers.authorization` throws on `undefined` in every existing test,
and adding `headers: {}` converts the whole file from "throws" to "401" — which is worse, because it
still looks like a test suite.

Four additions this plan makes to that list:

| Test | Why |
|---|---|
| No `href` in `src/web/` starts with `/api/` | The `<a>` that cannot carry a token. A grep, and the only thing that catches the third one |
| `/auth/callback?code=X` never leaves `code=X` inside an `/add/` path | Tests the rewrite exemption by its consequence rather than by its presence |
| No `VITE_*` variable, and no string in `dist/`, matches `sb_secret_`/`service_role` | Guards the bundle. Run against the built output, not the source |
| `requireUser` commented out → the no-header test goes red | The gate's own [check-against-the-broken-state](../reusable/silent-success.md). Do it by hand once, and write down the pair of results |

**Note the tree is shared and is not reliably green.** Establish which failures are yours by running
`npm test` before and after your change, not by reading one run.

---

## What Greg has to do

Two dashboards, ten minutes, and the first one blocks production sign-in entirely.

### 1. Google Cloud Console — add one redirect URI

Project 815353440959, the OAuth client shared with the old app.

1. <https://console.cloud.google.com/apis/credentials>
2. Click the OAuth 2.0 Client ID (the Web application one).
3. Under **Authorised redirect URIs**, click **+ ADD URI**.
4. Paste exactly:
   ```
   https://alschkahzfagtppxspfq.supabase.co/auth/v1/callback
   ```
5. **Save.** It can take a few minutes to take effect.

Leave the existing entries alone — the `127.0.0.1` one is local sign-in and the
`blsgjlrezruxcfdyrqpk` one is the old app.

**Why you and not an agent:** three attempts on 2026-08-26 failed on two independent blocks — Google
throws a passkey re-auth challenge at Cloud Console, and Claude Code's own permission classifier
refuses to navigate to credentials pages. Neither is fixable from inside a session.

Then say so, and this is checkable from a terminal in five seconds:

```bash
./scripts/check-google-redirect.sh https://alschkahzfagtppxspfq.supabase.co/auth/v1/callback
```

### 2. Supabase dashboard — turn Google on for the remote project

<https://supabase.com/dashboard/project/alschkahzfagtppxspfq>

- **Authentication → Sign In / Providers → Google → enable.** Paste the same client id and secret
  the local stack uses (they are in `.env.local` as `SUPABASE_AUTH_EXTERNAL_GOOGLE_*`).
- **Authentication → URL Configuration:**
  - Site URL: `https://spideryarn-greg-detre.vercel.app`
  - Redirect URLs: the three globs in
    [§ The two hostnames](#the-two-hostnames-and-the-allow-list-that-has-to-cover-both).

Alternatively, create a **personal access token** at
<https://supabase.com/dashboard/account/tokens> and put it in `.env.local` as
`SUPABASE_ACCESS_TOKEN`, and this can be done from the terminal instead — including reading it back
to check it took.

### 3. Nothing else

The Vercel variables can be set from here with `vercel env add`. Say the word.

---

## The order to build it

1. **Greg's two dashboards** — in parallel with everything below. Only blocks the last step.
2. **Scaffolding, safe to commit alone:** `npx shadcn add input label`, the Google asset,
   `scripts/check-google-redirect.sh`, the `VITE_*` variables locally, `/api/health` hardening.
   *(1 hour)*
3. **The vertical commit.** Client singleton, session hook, `apiFetch` and all 31 call sites, the
   two `<a>`s, `/login` and `/auth/callback`, the sign-in screen, sign-out on `/profile`,
   `requireUser` inside `handleApi`, and the tests. *(a day)*
4. **Browser pass** — a Sonnet subagent against the local stack, driving a real Google sign-in.
   [browser-testing.md](../project/browser-testing.md) first.
5. **GPT Sol on the built code**, weighted higher than the review of this plan, because a plan-stage
   review cannot see a call site that was missed.
6. **Production.** Vercel variables, confirm `main` builds, deploy, then the checklist below from
   *outside* — a different network, signed out.
7. **Docs.** [auth.md](../project/auth.md) stops being a stub;
   [security.md](../project/security.md) gains the health note and the sentence that the gate admits
   anyone with a Google account; [deployment.md](../project/deployment.md) gains the `VITE_*` row and
   the `NODE_OPTIONS` gap; [setup-dev.md](../project/setup-dev.md) gains the new variables.

**Why step 3 is one commit and not five** is the single most important line of the previous review:
between a sign-in screen and a server gate the site *looks* protected while `curl /api/jobs` still
spends the Anthropic key, and a gate that appears to be there does not get finished.
[auth-supabase.md § ONE commit](auth-supabase.md#the-sign-in-screen-and-the-server-gate-ship-in-one-commit).

---

## The production checklist

Run from outside, signed out, on both hostnames. **Every line has an expected answer; a line without
one is not a check.**

```bash
H=https://spideryarn-greg-detre.vercel.app

curl -s -o /dev/null -w "%{http_code}\n" $H/                # 200 — the app still loads
curl -s $H/api/library                                      # {"error":"…"} 401, NOT a shelf
curl -s -X POST $H/api/jobs -H 'content-type: application/json' \
     -d '{"url":"https://example.com"}'                     # 401, NOT 202
curl -s $H/api/health | head -c 200                         # still answers; ok:true once DATABASE_URL is set
curl -s -X DELETE $H/api/health                             # 405
grep -rc "sb_secret_\|service_role" dist/                    # 0
```

And the one that is not a curl: **sign in with Google in a browser you are not already Greg in**,
and confirm the reader lands back where they started rather than on the shelf.

---

## Open questions

- **Spend limit.** The gate admits anyone with a Google account, by
  [Greg's explicit decision](auth-supabase.md#who-gets-in). The control that is actually missing is a
  cap on model spend, and it always was — an allowlist of one never limited what Greg could spend
  either. In-memory counters are useless across Vercel instances, so it is database-backed or set at
  the provider. Its own piece of work; a line for
  [open-questions.md](../project/open-questions.md).
- **`owner_id`.** The gate identifies people; it does not yet fill in who owns a row. Greg's
  Supabase `sub` is `f4d08b58-5573-4811-9887-e26c114fb324` and every local article is stamped with
  `DEV_OWNER_ID` `00000000-0000-4000-8000-000000000001`. One `UPDATE`, and it is
  [Appendix C](auth-supabase.md#appendix-c-owner_id-rls-and-the-second-person) rather than this.
- **Whether `/login` should exist as a route at all**, given the screen is a whole-app gate. It falls
  out of the callback work for free and Appendix A's password-reset landing needs one, so the answer
  is probably yes — but nothing in v1 links to it.

---

## See also

- [auth-supabase.md](auth-supabase.md) — the decisions, and everything this plan builds on
- [auth-supabase-review-sol.md](auth-supabase-review-sol.md) — GPT Sol on that plan
- [auth.md](../project/auth.md) — what auth is for here
- [deployment.md](../project/deployment.md) — Vercel, and the five things that fail without saying so
- [security.md](../project/security.md) — the two untrusted parties
- [silent-success.md](../reusable/silent-success.md) — the pattern behind the checks in this file
