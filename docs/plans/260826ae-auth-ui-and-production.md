# The sign-in screen, and making it true in production

**2026-08-26.** The second half of [260826w-auth-supabase.md](260826w-auth-supabase.md). That plan proved Google
sign-in works against the local stack with no app code in the way; this one builds the app code and
carries it to Vercel.

> Ok, now let's add the UI elements to the app, and do anything else that will also make this work
> when we deploy to prod.
>
> — Greg, 2026-08-26

Read [260826w-auth-supabase.md](260826w-auth-supabase.md) first. It owns the *decisions* — why Supabase, why a
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
([§ Which Google OAuth client](260826w-auth-supabase.md#which-google-oauth-client)), so it already knows the
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
paid for once ([§ The check that could not fail](260826w-auth-supabase.md#the-check-that-could-not-fail),
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
| `spideryarn-greg-detre.vercel.app` | **200, serving the whole app and API to anyone** — and see below, it is writable too |
| `spideryarn-reading2-git-main-…vercel.app` | 200, but it is the *branch alias* and it points at a **failed build** — "Deployment has failed" |
| `spideryarn-reading2-greg-detre.vercel.app` | 404. The obvious guess after the project rename, and it is not a hostname |
| Custom domains | **none**. `vercel domains ls` → 0 |
| `DATABASE_URL` on Vercel | **not set.** So the public site's API answers `{"error":"DATABASE_URL is not set…"}` |
| `NODE_OPTIONS` on Vercel | set for **Production only, not Preview** — see [§ The preview environment is missing a flag](#the-preview-environment-is-missing-a-flag) |
| `VITE_*` variables on Vercel | none, and they are read **at build time** |

### It is not only readable. It is writable, right now

Running `scripts/check-production-gate.sh` against the live site today, before any of this is built:

```
FAIL  GET  /api/library  refused → got 500, wanted 401
FAIL  POST /api/jobs     refused → got 202, wanted 401
FAIL  DELETE /api/health rejected → got 200, wanted 405
```

**A 202 means the job was created.** `GET /api/jobs` on production then showed it: id `spya-pchqc5`,
`https://example.com`, `fetch` already running, with `toc` and `arc` — two model calls — queued
behind it. That is the open wallet this gate exists to close, and it is open now, on a public URL,
with no login in front of it.

Two things keep the bill small and neither is a control: the pipeline advances through
`POST /api/jobs/:id/advance`, which a browser drives — and which is just as unauthenticated — and
the store cannot write without `DATABASE_URL`. Both are accidents of an unfinished deployment, not
protection.

**I created that job**, by running the check. One job, for `example.com`; a second POST returned the
same one rather than a new one, and I did not advance it. It is `spya-pchqc5` if it wants deleting.

**The check failing here is the point.** These lines had never been seen to fail before today, and a
gate check that has only ever passed is worth nothing — [the mistake this repo already paid
for](#the-check-and-why-it-is-written-this-way). Run it again after the gate lands and every one of
these must flip.

**The project was renamed and the old hostname survived it.** `spideryarn-greg-detre.vercel.app`
still serves — so the redirect allow-list has to cover *two* name families, not one.
[deployment.md](../project/deployment.md) already says a generated hostname is not guaranteed to
keep working after a rename; this is the case where it did, and it is the public one.

---

## What got built, 2026-08-27

Everything in parts 1–3 and 5, plus the health hardening. **Locally only** — production is still
[waiting on Greg's two dashboards](#what-greg-has-to-do) and on `DATABASE_URL`.

| | |
|---|---|
| `src/auth.ts` | `requireUser`, the verifier seam, 401/403/**503** |
| `src/routes.ts` | one line, inside the `try`, above the route table |
| `src/web/lib/supabase.ts` | the client. Throws by name if a `VITE_*` is missing |
| `src/web/lib/api.ts` | `apiFetch` (+ `leavingFetch` for `pagehide`), and **all 32 call sites in 15 files** |
| `src/web/useSession.ts`, `SignInPage.tsx`, `AuthCallback.tsx`, `auth-return.ts`, `AccountSection.tsx`, `GoogleMark.tsx`, `SourceLink.tsx` | the screens and the seams |
| `src/web/router.ts`, `main.tsx`, `App.tsx` | `/login`, `/auth/callback`, the four guarded rewrites, the whole-app gate |
| `src/sanitize-policy.ts` | an article may not address our own API |
| `src/vercel-health.ts`, `api/index.js` | 405, an 8KB cap, and the stack goes to the log |
| 6 new test files, 6 harnesses updated | 207 tests across the 13 suites this touches |

**32, not 31.** Another agent added `useChatAnchors.ts` while this was being written, and a second
sweep of the whole directory caught it. Worth recording because the count in this plan was measured
carefully and was still stale within the hour — the sweep is the check, not the number.

**The gate was proved by removing it.** With `await requireUser(...)` commented out,
`tests/routes.test.ts` goes from 54 green to **2 red**; put back, 54 green, and the file is
byte-identical to a copy taken before. A gate test that has never been seen to fail proves nothing.

**The bundle check caught something on its first run and it was a false positive** — the SDK's own
`key.startsWith("sb_secret_")`, a prefix test rather than a credential. The detector now wants the
twenty-odd characters that make it an actual key. Checking the hit rather than trusting it is the
whole reason to write these down.

**The browser pass: 7 of 7.** A Sonnet subagent drove a real Chrome tab
([browser-testing.md](../project/browser-testing.md) first, as the working agreements require).
Signed out gives the sign-in screen and not the shelf; email-and-password sign-up lands straight in
the app with no email to click; `/api/library` and `/api/jobs` answer 200 while a raw
unauthenticated `fetch('/api/library')` from the same page gets 401; a reload keeps you signed in
with no visible flash; the account block reads *"Signed in as browsertest@spideryarn.local · via
email"* and signing out returns you to the sign-in screen and keeps you there. Google's button was
checked against the brand rules by eye — dark pill, legible, mark not stretched.

`/auth/callback?code=FAKE123` resolved in well under the deadline to
*"That sign-in could not be completed…  [auth-exchange]"*, with `code=FAKE123` stripped from the
address bar. **That is the case the first design could not have handled at all** — the SDK reports a
failed exchange to nobody, so a callback waiting on an auth event would have sat on "Signing you
in…" for ever, and the single test first proposed for it would have passed throughout.

**The address survives the gate**, which is the design claim and was checked in both states:
signed out at `/read/<slug>?at=…` or `/profile`, the address bar does not move — only the content
becomes the sign-in screen. That is why the gate is a whole-app branch rather than a `/login`
redirect ([url-state.md](../project/url-state.md): who you are is not view state), and it is what
makes the `sessionStorage` return path a belt-and-braces for the Google round trip rather than the
only thing holding the reader's place.

*(One line in the browser report — a direct load of `/profile` redirecting to `/` — turned out to be
a misread rather than an observation. Worth chasing anyway: the server answers 200 on all five
paths, so a changed address bar could only have been our own code, and the only redirects to root
in `src/web/` are two lines both written today. It reproduced clean in both auth states.)*

**And it found a trap in the testing rather than in the code.** The first check showed the *shelf*,
not the sign-in screen — because the tab had a session in `localStorage` from earlier in the day. A
signed-out check in a browser you have used before is not signed out until you clear storage. Now
written up in [browser-testing.md](../project/browser-testing.md#signed-out-is-not-signed-out-in-a-browser-you-have-used-before),
because it is the commonest way to conclude a working gate is broken — or a broken one is working.

**Checked against a genuinely signed token, which is the one thing the unit tests mock.** A
password grant from the local stack gives a real 928-character ES256 token; the gate was then asked
five questions through the running dev server:

```
with a REAL token          -> 200
with no token              -> 401
with one character changed -> 401   ← the signature is VERIFIED, not decoded
with the publishable key   -> 401   ← the key in the browser bundle is not a login
POST /api/jobs, no token   -> 401   ← the open wallet, closed
```

The third line is the one worth having. `JSON.parse(atob(token.split(".")[1])).email` would answer
200 to all five, and every unit test in `tests/auth.test.ts` would still pass, because they hand
`requireUser` a stubbed verifier. This is the check that the stub is standing in for something real.

**The local Google round trip is still unverified, and the reason is worth writing down** — it is
[Sol's finding #2](#the-cross-family-review-and-what-it-changed) happening exactly as predicted.
The `/**` entries were added to `supabase/config.toml`, but **GoTrue reads that file when its
container starts**, and the container has been up since before the edit:

```
$ docker inspect supabase_auth_spideryarn2 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep URI_ALLOW
GOTRUE_URI_ALLOW_LIST=http://localhost:5273,http://127.0.0.1:5273
```

Two exact roots, no `/**`. So a Google sign-in today succeeds *at Supabase* and then returns the
reader to the bare site URL instead of to `/auth/callback` — the callback page never runs, and the
reader's saved place is never restored. Which is not a red error anywhere; it looks like landing on
the shelf.

That is visible in the local user table: `greg@gregdetre.com` has a `last_sign_in_at` from this
evening, from a sign-in that went through Google fine and came back to the wrong address.

**`npx supabase stop && npx supabase start` applies it.** Not done here, because several agents
share this stack and a restart would interrupt whatever they are mid-request on. Worth one line to
whoever restarts next.

**What is deliberately not done here:** email in production (needs SMTP), `owner_id` scoping (needs
[Greg's decision](#the-gate-says-who-you-are-nothing-yet-asks-whose-shelf-this-is)), and everything
in part 4 that requires a dashboard.

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
[260826w-auth-supabase.md § Step 3](260826w-auth-supabase.md#srcweblibsupabasets); the one doing work is
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

**One call site is not like the others, and converting it naively makes it worse.**
`useProfile.ts:76` flushes an unsaved profile from a `pagehide` handler, and it already passes
`keepalive: true` for exactly that case. `apiFetch` as described `await`s `getSession()` *before*
the request starts — and a page being torn down can be killed inside that await. A best-effort save
becomes a save that often never leaves. So the leaving path needs a token it already has and a
`fetch` that starts immediately, and the debounced save should also fire on `visibilitychange`
rather than leaving everything to the last moment. Test it with a deliberately slow session lookup;
otherwise the bug only appears on someone's real machine, once, and unreproducibly. GPT Sol.

What `apiFetch` does, and the one thing it must not do, are in
[260826w-auth-supabase.md § apiFetch](260826w-auth-supabase.md#srcweblibapits-apifetch). Repeating only the
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

**And `window.open` gives up what the anchor had.** The `<a>` carries `rel="noreferrer noopener"`;
a script-opened tab does not, so it must be `null`ed explicitly before the untrusted document
loads. Close the blank tab and show the error if the fetch fails, rather than leaving the reader
staring at `about:blank`.

**Worth knowing before spending a day on this:** `sendSource` at `src/routes.ts:143` reads the PDF
off the local filesystem via `fsLocations(slug)`, so **this link is already broken in production**
and will stay broken until source storage moves to the database. The token fix is still right, and
it is not urgent. GPT Sol found both.

**A grep is one guard**, and it belongs in the test suite: no `href` in `src/web/` may start with
`/api/`. It will notice when somebody adds a third one *to our own code*, which is not the same as
noticing every one.

### The third class: an article can link to our API

The sweep below covers the code we write. **It does not cover the HTML we render**, and that is
where the third one is. The sanitiser deliberately keeps links and images, relative ones included —
`tests/sanitize.test.ts:77` pins that `<img src="/d.png">` survives, because the block splitter
needs figures. So an article can contain:

```html
<img src="/api/health">          <!-- fires on render, unauthenticated, at a public endpoint -->
<a href="/api/library">…</a>     <!-- a 401 page where the reader expected a link to go -->
```

No bearer token on either, and **no source-code grep can see them** — they arrive from a stranger's
web page at runtime. GPT Sol found this; confirmed by reading the sanitiser's own test.

The harm is bounded — the gate refuses the anchor, and `/api/health` is the only thing the image can
reach — but "bounded" is a thing to decide rather than discover. So: **audit URL-bearing attributes
in `src/sanitize.ts` and drop or rewrite anything that resolves to this origin under `/api/`.** Not
only `href` and `src`: `srcset`, `<source>`, `<audio>`, `<video>`, `<track>`, and SVG's own URL
attributes. Behavioural tests, one per attribute, because a rule that covers four of six looks
exactly like a rule that covers six.

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
([260826w-auth-supabase.md § Step 5](260826w-auth-supabase.md#step-5-the-sign-in-screen)).

- `npx shadcn add input label` — `src/web/components/ui/` has only `button.tsx` and `toggle.tsx`.
- No `Card`. A centred `<form>` on the existing tokens, same call
  [260825a-shadcn-migration.md](260825a-shadcn-migration.md) made about `Dialog`.
- **The Google button is specified, not designed.** Exact wording, the dark-theme palette
  (`#131314` / `#8E918F` / `#E3E3E3`), and the rule that the mark is a downloaded asset rather than
  something we draw, are all in
  [260826w-auth-supabase.md § The Google button](260826w-auth-supabase.md#the-google-button-is-specified-not-designed).
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
[260826w-auth-supabase.md § /auth/callback](260826w-auth-supabase.md#authcallback-the-one-route-this-must-add).

The work:

- `parseRoute` gains `{ kind: "callback" }` and `{ kind: "login" }`.
- **`main.tsx` runs four `history.replaceState` rewrites before React mounts. `/auth/callback` is
  exempt from all four**, and the exemption goes *first*, above `canonicalAddHref`. Reviewed and
  confirmed correct in that order; Vercel's SPA rewrite serves the route fine.
- `redirectTo` is always `${location.origin}/auth/callback`. Never the current page.
- Where the reader was going lives in `sessionStorage`, under the rules below.

### Three things the first version of this got wrong

**The local project does not allow that address.** `supabase/config.toml:203` reads

```toml
additional_redirect_urls = ["http://localhost:5273", "http://127.0.0.1:5273"]
```

— two exact roots, no `/**`. This morning's successful sign-in passed no `redirectTo` at all, so it
went to the Site URL and never tested this. The moment `redirectTo` names `/auth/callback`, Supabase
either refuses it or quietly falls back to `/`, and the browser test proves nothing. **Add `/**`
entries for both roots before the browser pass**, and the same globs to the remote project. Named in
the first review and not carried forward; caught again here.

**`onAuthStateChange` cannot see a failed exchange, so the error state as described is unreachable.**
Read from the installed SDK rather than assumed: `_initialize()` in
`@supabase/auth-js/dist/module/GoTrueClient.js:376` calls `_getSessionFromURL`, and on an error it
`_debug`-logs and `return { error }` — it notifies no subscriber. Listeners get
`INITIAL_SESSION, null`, which is indistinguishable from "not signed in". Meanwhile **the failed
parameters stay in the URL**, because only a successful exchange strips `code`.

So the callback component reads `location.search` itself: capture a known-safe error code, clear
*every* auth parameter (`code`, `state`, `error`, `error_description`, `error_code`), wait for
initialisation to settle, then navigate. Without that, `/auth/callback?code=X` sits on screen for
ever — and the test as first written passes the whole time, because `code=X` is indeed not inside
an `/add/` path.

**`sessionStorage` needs more than a same-origin check.** It is tab-scoped, so cross-tab confusion
is limited, but a stale entry from a sign-in three days ago is not. Store `{ path, createdAt }`,
delete it *before* navigating, give it a short TTL, and refuse `/auth/callback` as a destination so
a bad value cannot loop. Validate with

```ts
new URL(value, location.origin).origin === location.origin
```

and **not** `value.startsWith("/")`, which happily accepts `//evil.example` — a protocol-relative
URL, and an open redirect.

### The tests that follow from that

Four, not one. The single test first proposed here — "`code=X` never ends up inside an `/add/`
path" — is true of a completely broken callback.

| | |
|---|---|
| Success | lands on the saved path, and the URL has no auth parameters left on it |
| Exchange failure | shows a message, clears the parameters, does not sit on `?code=` |
| `?error=access_denied` | shows a message rather than a bare sign-in screen |
| No verifier in storage | the PKCE verifier is gone (different browser, cleared storage) — refuse cleanly |
| Return path `//evil.example` | refused |

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
[260826w-auth-supabase.md § Step 4](260826w-auth-supabase.md#step-4-the-gate). The two things worth restating,
because both are the kind of detail that survives a plan and dies in an editor:

**Inside the `try`.** Measured again today against the current file: the `/api/` prefix check is
`src/routes.ts:1992`, and the `try` begins at `:2077`. Eighty-five lines. A `requireUser` above the
`try` throws past the catch — 500 with the message in dev, blank 500 on Vercel, and `logRequest`
never runs, so **the refusal is never written down**.

**A JWKS that will not load is not a bad credential.** The previous plan maps every `getClaims`
failure to 401, and the first review asked for a **503** when the failure is the key set being
unreachable rather than the token being wrong. That correction was never folded in, so it is folded
in here: a 401 tells a client with a perfectly good session to throw it away and try to refresh,
which cannot help, and it reports our outage as their fault. Signature invalid, expired, malformed →
401. Cannot reach or parse the JWKS → 503.

**Signing out is more than a button.** The screen is only the visible half: an active chat stream
holds a `fetch` that the server has already admitted, and app state holds an article, a profile and
a thread. Sign-out aborts every in-flight stream and clears what the client is holding, or the next
person at the keyboard sees the last one's reading. Named in the first review, dropped from the
second; back now.

**Errors carry their status by convention here**, not by class: `httpError(status, message)` at
`src/routes.ts:157` does `Object.assign(new Error(message), { status })`, and the catch at `:2450`
reads `.status`. So `requireUser` throws `httpError(401, …)` and needs nothing else to be reported
correctly. Every message it throws must be **fixed prose we wrote** — never the token, the header,
the SDK's error, the `sub` or the email — because `logRequest` writes it into a `reason` field and
redaction matches key paths, never text.

### The gate says who you are. Nothing yet asks whose shelf this is

**This needs a decision from Greg before the work is deployed, and it was not on the table when the
allowlist was dropped.**

`currentOwnerId()` at `src/owner.ts:71` reads one process-wide `SPIDERYARN_OWNER_ID`, and its own
docstring says the Postgres reads do not filter by owner — *"When the gate lands this gains a
request argument and the constant goes."* This is that moment, and this plan does not do it.

So the deployed result of building exactly what is written here is: **anyone with a Google account
signs in and gets Greg's shelf** — his articles, his reading positions, his profile, his chats, his
searches — with the ability to rename and archive them.

That is not what was decided. The decision was:

> We can get rid of the allowlist once we've added authentication. I'll accept the risk
>
> — Greg, 2026-08-26

and the risk that was put to him, twice and in writing, was **model spend**:
[260826w-auth-supabase.md § Who gets in](260826w-auth-supabase.md#who-gets-in) says "what that buys them is the
ingest pipeline and `ANTHROPIC_API_KEY`". It does not say "and everything you have ever read". A
decision made on one set of facts is not consent to a different one, so this goes back to him
rather than through.

Three ways out, and they are not equally sized:

1. **Put the allowlist back for this release.** One line in `isAllowed`, which exists as a function
   precisely so this is an edit in one place. Ship the gate, decide the rest later.
2. **Scope the data properly** — thread `claims.sub` through `currentOwnerId` and every owner-scoped
   read and write. This is the right end state, it is what the schema was built for
   ([Appendix C](260826w-auth-supabase.md#appendix-c-owner_id-rls-and-the-second-person)), and it is
   its own piece of work rather than a corner of this one.
3. **Decide the shelf is shared and say so out loud** in
   [security.md](../project/security.md) and [deployment.md](../project/deployment.md). Defensible
   while nothing private is in it; indefensible silently.

**Recommendation: (1) now, (2) next.** It costs one line, it does not reopen the decision Greg made
about who *should* eventually get in, and it means the answer to "who can read my library" is not
"whoever finds the URL" during the window where nobody has thought about it yet. GPT Sol raised it;
verified by reading `src/owner.ts` and grepping the Postgres store for an owner filter, which has
none.

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

**"Health hardening" must explicitly include `api/index.js`, not just `src/vercel-health.ts`.**
The import-failure branch at `api/index.js:43` returns the failure to the caller behind this comment:

> Everything here is behind the deployment's login wall, so the stack is not being handed to
> strangers.

That sentence is **false**, and measurably so — `spideryarn-greg-detre.vercel.app` answered an
unauthenticated `curl` today. Fix the comment along with the code, because the comment is why nobody
looked.

And note what stays public even after all that: an unauthenticated GET still **reads the database**
(`listArticles` for the article count) and returns environment-variable names, Node version, region
and commit SHA. That is a deliberate trade — the endpoint has to work when the app does not — but
it is a database round trip anyone can ask for in a loop. Cache the count for a minute, or drop it.

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

The list is in [260826w-auth-supabase.md § Step 7](260826w-auth-supabase.md#step-7-the-tests-that-have-to-exist),
including the harness problem: `tests/routes.test.ts` builds its fake request as `{ method, url }`
with **no `headers`**, so `req.headers.authorization` throws on `undefined` in every existing test,
and adding `headers: {}` converts the whole file from "throws" to "401" — which is worse, because it
still looks like a test suite.

**And it is six harnesses, not one.** `tests/routes.test.ts` is the one the previous plan named;
`grep -rln handleApi tests/` finds six files driving it with hand-built requests, and four of them
set no `headers` at all:

```
tests/routes.test.ts             tests/chat-route.test.ts
tests/chat-anchor-route.test.ts  tests/chat-live-turn.test.ts
tests/store-wiring.test.ts       tests/vercel-url.test.ts
```

So the injected verifier is not a convenience for one file — it is the only way six suites keep
being about what they are about. Give each an authenticated default.

**One test in the old list is impossible and must go.** "A correctly signed token for the wrong
email → 403" cannot pass while `isAllowed` returns true for everyone. Either the allowlist comes
back — see [§ whose shelf this is](#the-gate-says-who-you-are-nothing-yet-asks-whose-shelf-this-is),
which is the open question — and the test is real, or it does not and the test is a fiction that
would be written to pass. Do not keep a test whose subject does not exist.

Additions this plan makes:

| Test | Why |
|---|---|
| No `href` in `src/web/` starts with `/api/` | The `<a>` that cannot carry a token. Catches *our* third one, not an article's |
| Sanitised article HTML drops same-origin `/api/` in `href`, `src`, `srcset`, `<source>`, SVG | The class a grep cannot see |
| The four callback tests | [above](#the-tests-that-follow-from-that) — success, exchange failure, denial, missing verifier |
| `apiFetch`: header merging, exactly one retry, body and signal preserved, refresh failure, cross-origin refused | The seam every other request goes through, tested directly rather than through a route |
| `useProfile` flush on a slow `getSession()` still leaves | The `pagehide` save the token lookup can eat |
| No `VITE_*` variable, and nothing in the **deployed** bundle, is a secret-shaped key | Guards the bundle — and see below, because the obvious version of this check is broken |
| `requireUser` commented out → the no-header test goes red | The gate's own [check-against-the-broken-state](../reusable/silent-success.md). Do it by hand once, and write down the pair of results |

**The bundle check as first written does not work**, in two ways, and both are the house speciality.
`grep -rc "sb_secret_\|service_role" dist/` prints a count per file and **exits 1 when it finds
nothing** — so the passing case looks like a failure and the failing case looks like a pass, in a
checklist read by eye. And a legacy service-role key does not contain the string `service_role` in
the clear: it is a JWT, and the role is inside the base64 payload. So the check must decode
JWT-shaped strings, and it must run against **assets downloaded from the deployment**, not against
whatever `dist/` this laptop last built.

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

### 3. One decision, not a click

[§ whose shelf this is](#the-gate-says-who-you-are-nothing-yet-asks-whose-shelf-this-is) — signing
in without owner-scoped data means any Google account gets *your* library, not just your API budget.
That is a different fact from the one the no-allowlist decision was made on. One line either way,
and it is yours.

The Vercel variables can be set from here with `vercel env add`. Say the word.

---

## What has to be true before this is promoted

The plan used to say "nothing else", which was wrong: authentication landing on a deployment that
cannot read its own database gives a site you can sign into and not use. **These are prerequisites
for promotion, not follow-ups.**

| | |
|---|---|
| `DATABASE_URL` set on Vercel | Not set today. Without it every API call fails after a successful sign-in |
| Remote database has schema, owner and articles | [deployment.md:373](../project/deployment.md) — still outstanding, and not this plan's work |
| `NODE_OPTIONS` on **Preview** | So a preview build can be used to check this at all |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Compiled in. Missing → `supabase.ts` throws at module load → **a blank page** |
| Google redirect URI registered | Otherwise every sign-in is `redirect_uri_mismatch` |
| Google enabled on the remote project | `"google": false` today |
| Supabase redirect allow-list, with `/**` | Otherwise the callback is refused |

### The release fence

**A push to `main` deploys.** ([deployment.md](../project/deployment.md).) So the order is not a
preference:

1. Set every variable above, on Preview *and* Production.
2. `vercel deploy` — a **preview**, not a push. Check sign-in against it end to end.
3. Only then push to `main`, or promote that exact deployment.

Get this backwards and the failure is not subtle: the gate is live, the client throws on load, and
the site is a blank page nobody — Greg included — can sign into. The deliberate throw on a missing
`VITE_*` is right, and it is exactly what makes the order matter. GPT Sol.

---

## The order to build it

0. **Greg decides whether the allowlist comes back**
   ([§ whose shelf this is](#the-gate-says-who-you-are-nothing-yet-asks-whose-shelf-this-is)).
   One line, and it changes what step 3 has to be true about.
1. **Greg's two dashboards** — in parallel with everything below. Blocks promotion, not building.
2. **Scaffolding, safe to commit alone:** `npx shadcn add input label`, the Google asset, the
   `/**` redirect entries in `supabase/config.toml`, the `VITE_*` variables locally,
   `/api/health` **and `api/index.js`** hardening, the `/api/` audit in the sanitiser.
   *(2 hours)*
3. **The vertical commit.** Client singleton, session hook, `apiFetch` and all 31 call sites, the
   two `<a>`s, `/login` and `/auth/callback`, the sign-in screen, sign-out on `/profile`,
   `requireUser` inside `handleApi`, and the tests. *(a day)*
4. **Browser pass** — a Sonnet subagent against the local stack, driving a real Google sign-in.
   [browser-testing.md](../project/browser-testing.md) first.
5. **GPT Sol on the built code**, weighted higher than the review of this plan, because a plan-stage
   review cannot see a call site that was missed.
6. **Production**, in the order the [release fence](#the-release-fence) sets: every variable and
   dashboard first, then a **preview** deployment checked end to end, and only then a push to
   `main`. Then `./scripts/check-production-gate.sh` from outside, signed out.
7. **Docs.** [auth.md](../project/auth.md) stops being a stub;
   [security.md](../project/security.md) gains the health note and the sentence that the gate admits
   anyone with a Google account; [deployment.md](../project/deployment.md) gains the `VITE_*` row and
   the `NODE_OPTIONS` gap; [setup-dev.md](../project/setup-dev.md) gains the new variables.

**Why step 3 is one commit and not five** is the single most important line of the previous review:
between a sign-in screen and a server gate the site *looks* protected while `curl /api/jobs` still
spends the Anthropic key, and a gate that appears to be there does not get finished.
[260826w-auth-supabase.md § ONE commit](260826w-auth-supabase.md#the-sign-in-screen-and-the-server-gate-ship-in-one-commit).

---

## The production checklist

`scripts/check-production-gate.sh`, run from outside and signed out. It takes both hostnames by
default, because "check both" in prose gets done once.

```bash
./scripts/check-production-gate.sh
```

Every line **asserts a status or a body**, which the first draft of this section did not:

| Checked | Because the obvious version is wrong |
|---|---|
| `GET /` is 200 **and not** Vercel's failure page | "Deployment has failed" is also a 200. The branch alias served exactly that today |
| `GET /api/library` is **401** | Printing the body proves nothing — a shelf and a refusal look alike at a glance |
| `POST /api/jobs` is **401** | The one that is 202 today |
| `/api/health` says `"ok":true` | The endpoint is allowed to answer `ok:false`; "it responded" is not the check |
| `DELETE /api/health` is **405** | The unbounded body read |
| The **served** JS carries no secret-shaped key | Downloaded from the deployment, not read from a local `dist/`. JWT-shaped strings are decoded, because a legacy service-role key does not spell `service_role` in the clear |

And the one that is not a script: **sign in with Google in a browser you are not already Greg in**,
and confirm you land back where you started rather than on the shelf.

---

## Open questions

- **Spend limit.** The gate admits anyone with a Google account, by
  [Greg's explicit decision](260826w-auth-supabase.md#who-gets-in). The control that is actually missing is a
  cap on model spend, and it always was — an allowlist of one never limited what Greg could spend
  either. In-memory counters are useless across Vercel instances, so it is database-backed or set at
  the provider. Its own piece of work; a line for
  [open-questions.md](../project/open-questions.md).
- **`owner_id`.** The gate identifies people; it does not yet fill in who owns a row. Greg's
  Supabase `sub` is `f4d08b58-5573-4811-9887-e26c114fb324` and every local article is stamped with
  `DEV_OWNER_ID` `00000000-0000-4000-8000-000000000001`. One `UPDATE`, and it is
  [Appendix C](260826w-auth-supabase.md#appendix-c-owner_id-rls-and-the-second-person) rather than this.
- **Whose shelf.** The one that needs Greg, and the one this plan will not decide for him:
  [§ The gate says who you are](#the-gate-says-who-you-are-nothing-yet-asks-whose-shelf-this-is).
- **The SDK on the server**, 7MB of `node_modules` to verify a signature:
  [§ The server-side cost](#the-server-side-cost-of-the-sdk-which-nobody-has-weighed). Ship it,
  measure it, and only then consider the sixty hand-written lines.
- **Whether `/login` should exist as a route at all**, given the screen is a whole-app gate. It falls
  out of the callback work for free and Appendix A's password-reset landing needs one, so the answer
  is probably yes — but nothing in v1 links to it.

---

## The cross-family review, and what it changed

Ran 2026-08-26 (GPT Sol, high effort, read-only). The full answer is at
[260826ae-auth-ui-and-production-review-sol.md](260826ae-auth-ui-and-production-review-sol.md). Its verdict on the
first draft was **"not safe to build as written"**, and it was right.

**Every finding below was checked here before being acted on**, as [AGENTS.md](../../AGENTS.md)
requires — five of them by reading the file it named, one by running a command.

| Finding | Verified how | What changed |
|---|---|---|
| Production stays unusable: `DATABASE_URL` unset, and the plan said "nothing else" | `vercel env ls` — no `DATABASE_URL` | [§ What has to be true before this is promoted](#what-has-to-be-true-before-this-is-promoted), and the [release fence](#the-release-fence) |
| Local Supabase allows two exact roots, not `/auth/callback` | `supabase/config.toml:203` | `/**` entries, before the browser pass |
| `onAuthStateChange` never sees a failed code exchange | Read `GoTrueClient.js:376` — `_initialize` `_debug`-logs and `return { error }`, notifying nobody | The callback component reads the URL itself; four tests, not one |
| `startsWith("/")` accepts `//evil.example` | Known open-redirect shape | `new URL(v, origin).origin` check, TTL, delete-before-navigate |
| Every signed-in user gets the same shelf | `src/owner.ts:71` is process-wide; no owner filter in the pg store | [§ whose shelf this is](#the-gate-says-who-you-are-nothing-yet-asks-whose-shelf-this-is) — **back to Greg** |
| Article HTML can carry `/api/` in `img`/`href` | `tests/sanitize.test.ts:77` pins that `<img src="/d.png">` survives | [§ The third class](#the-third-class-an-article-can-link-to-our-api) |
| `apiFetch` breaks the `pagehide` profile save | `src/web/useProfile.ts:110` already sets `keepalive` — the new `await` is what breaks it | An immediate path for the leaving case |
| Six test harnesses drive `handleApi`, not one | `grep -rln handleApi tests/` | All six named; injected verifier for each |
| "Wrong email → 403" cannot pass while `isAllowed` is always true | Read both | Test deleted rather than written to pass |
| JWKS unreachable should be 503, not 401 | Carried over from the first review, never folded in | Folded in |
| `api/index.js:43` publishes a stack behind a comment claiming a login wall | The comment; and an unauthenticated `curl` | Named explicitly in the hardening work |
| `grep -rc` exits 1 on no match; `service_role` is inside the JWT payload | Ran it: `exit=1` | The bundle check decodes, and reads the **served** assets |
| The checklist observed rather than asserted | — | Replaced by `scripts/check-production-gate.sh`, which fails today |
| `window.open` drops the anchor's `noopener`; `sendSource` is filesystem-only | `src/routes.ts:143` | Both written down |

**One thing it got slightly wrong, and it does not matter.** It said the redirect probe has no
control line and no `UNKNOWN` branch. It was reading the abbreviated snippet in this document; the
script had both. Its underlying point stood anyway — the `UNKNOWN` branch exited 0, and a rejected
URI also exited 0, so the check could not fail a caller. Both fixed, and both tested in the failing
direction.

**What it did not change.** The gate's placement inside `handleApi`'s `try` was reviewed again and
found sound, and it confirmed there is no application-handler fail-open once it is there:
`OPTIONS` and `HEAD` do not slip past, duplicate `__spy_path` is refused, and the SPA fallback
reaches no data.

---

## The review of the built code, and what it changed

Ran 2026-08-27 (GPT Sol, high effort, read-only), on the commit rather than on the plan. Kept at
[260827a-auth-ui-code-review-sol.md](260827a-auth-ui-code-review-sol.md). **This is the one AGENTS.md says to weight
higher**, and it earned that: a plan-stage review cannot run five malformed URLs through
`sanitizeHtml` and watch them come out the other side.

Its verdict — *"not safe to deploy merely once the dashboards are configured"* — and its six-item
bar. Five were code and are done; the sixth is Greg's.

| Finding | Verified how | Done |
|---|---|---|
| **Blocker** — the authenticated user is discarded, so every account shares one shelf and one budget | Confirms [§ whose shelf this is](#the-gate-says-who-you-are-nothing-yet-asks-whose-shelf-this-is), reached independently | **No — Greg's call** |
| **High** — `/api/health` calls `listArticles()` unauthenticated: an N+1 amplification, HEAD included | Read `pg.ts` | Cached 30s; error truncated to 200 chars with the full text logged |
| **High** — five sanitiser bypasses | **Ran all five through `sanitizeHtml`** — see below | All five closed, `SANITIZER_VERSION` 1 → 2 |
| **High** — the 8KB "cap" read the whole chunk then answered 200 | Read the loop | 413, and the socket destroyed |
| **Medium** — `AuthCallback` treats *any* session as proof *this* attempt worked | Read the SDK | `initialize()`, whose error is about this attempt |
| **Medium** — `useSession` can leave the whole app blank for ever if init hangs | Read it against `App.tsx` returning `null` | An 8s settle that ends as "signed out" |
| **Medium** — every `AuthApiError` mapped to 503, and Supabase uses it for 4xx too | `AuthApiError` carries a `status` | Classified by status; 4xx → 401, 5xx/no-status → 503 |
| `leavingFetch` swallows a body over the ~64KiB keepalive budget | Reasoned; guard added | Refuses and says so |
| A `visibilitychange` save made the following `pagehide` decline to send | Read `useProfile` | `leaving` ignores in-flight; the PATCH is idempotent |
| `SourceLink` still rendered an API `href` — middle-click and "Open in new tab" bypass the handler | Read it | A `<button>`, and **the test's exemption removed** |

### The five bypasses, because the shape of the mistake matters more than the fix

The rule I wrote stripped `<img src="/api/health">` and let all of these through:

```
SURVIVES  a mixed srcset       "/safe.png 1x, /api/health 2x"
SURVIVES  <table background="/api/health">
SURVIVES  <rect fill="url(/api/health)">
SURVIVES  https://<our own production host>/api/library
SURVIVES  //<our own production host>/api/library
stripped  /api/health
```

Three separate errors. The whole `srcset` value is not a URL, so `new URL()` threw and the code
concluded there was nothing to see. `background` and SVG's functional IRIs were not in the
attribute list — and `fill="url(…)"` is not a URL attribute at all, it is an attribute that
*contains* one. And resolving everything against a placeholder origin made **our own host foreign**,
which is why the fully-qualified spelling walked through the check written to stop it.

**My own test passed the whole time**, because I wrote the cases I had thought of. That is finding
#10 of the review — *"the passing tests overstate what was verified"* — and it is fair. The five are
now named individually in `tests/sanitize-own-api.test.ts`, together with the legitimate markup they
must not eat: `url(#gradient)`, a clean multi-candidate `srcset`, `//example.com/api/x`.

**And `SANITIZER_VERSION` was still 1.** The paragraph directly above that constant says to bump it
whenever a hook gets stricter, because otherwise an artefact stored under the old policy claims to
have been cleaned by one it has never seen. I made the policy stricter and did not bump it. It is 2.

### What it did not find

*"The application-handler gate itself did hold up under review: nothing before `requireUser()`
invokes a route handler, parses a request body, writes streaming headers or spends model money.
OPTIONS and HEAD do not bypass it, and route-specific errors occur after it."* And on `apiFetch`:
one retry so no loop, replayable bodies, and the success body untouched so `useChat` still streams.

---

## The blocker, and what Greg decided

GPT Sol's review of the built code led with one finding and would not be talked out of it:

> **Blocker — authentication does not provide authorization or ownership.** `requireUser()` returns
> an identity, but `routes.ts` discards it… any person who can create a Supabase account can see and
> change the same library, profile, chats, searches and reader state, and can run paid model
> operations. **This is more serious than the plan's description of a shared wallet.**

That last sentence is the whole of it. The risk Greg had accepted twice — *"I'm not worried about the
risk without the allowlist"* — was about **money**: somebody spending `ANTHROPIC_API_KEY`. Nobody had
said out loud that `articles.slug` is globally unique, so a stranger who signed in did not get an
empty shelf to fill with their own reading. They got Greg's, with Delete on every card.

Sol offered two fixes, and on 2026-08-27 Greg was shown both and chose the second:

> - reinstate the one-email allowlist as the small beta-safe fix; or
> - carry the returned user identity through request-scoped stores and constrain every read and write
>   by that owner.

### What was built

The design and the reasoning live in [auth.md § Whose data is it](../project/auth.md#whose-data-is-it)
rather than here, because it is now how the thing works rather than a plan for it. In brief:

| | |
|---|---|
| `src/owner.ts` | an `AsyncLocalStorage` box; `currentOwnerId()` reads it inside a request and the environment outside one |
| `src/routes.ts` | `handleApi` opens the scope, `serveApi` is the old body, and `setRequestOwner(user.id)` is the one line that joins the gate to the store |
| `src/store/pg.ts` | `ownedSlug()` and `ownedByReader()` — the only sanctioned way to name an article |
| eight store modules | five near-identical `articleIdFor` helpers, `pgShelfStore`'s three writes, `lockArticle`, and the library search, all through the predicate |
| `src/store/index.ts` | refuses to boot on the filesystem store in production, because it has no owner column |
| `tests/owner-isolation.test.ts` | 19 tests in four parts — the scope, a static guard, the queries against real Postgres, and the HTTP seam |

**Three decisions worth keeping.**

*An AsyncLocalStorage rather than an argument.* Eleven call sites, four or five frames below a route
handler, and the CLI shares most of them and has no request — so every threaded parameter would have
had to be optional, which is the shape that lets a caller forget it.

*`run()` and never `enterWith`.* With HTTP keep-alive several requests share a calling async context.
`enterWith` mutates it, so request two could read request one's owner before its own gate ran. That
is the worst bug this could have, and it would never appear in testing, where connections are not
reused.

*The session user beats `SPIDERYARN_OWNER_ID`.* The environment used to win outright and
[deployment.md](../project/deployment.md) tells you to set that variable on Vercel. With the old
precedence, deploying exactly as documented would have handed every signed-in stranger Greg's owner
id — every query would have matched, and the isolation would have been dead code that looked like it
was working. That is [silent-success](../reusable/silent-success.md) with a deploy guide pointing at
it, and it has a test of its own.

### Every one of these tests was watched failing

A check that has only ever been green is not evidence, so each of these was seen to fail. The readings, taken by breaking the code
and putting it back byte-identical:

| broken on purpose | what went red |
|---|---|
| `ownedSlug()` reverted to `eq(articles.slug, slug)` | 6 of the 8 Postgres tests; the two that stayed green are on independent filters |
| `ownedSlug` put back into `pg-shelf.ts` | the static guard, naming `pg-shelf.ts` |
| `setRequestOwner(user.id)` removed | both HTTP tests — and **nothing else**, which is why they exist |
| every `AuthApiError` classified as unavailable again | the 4xx test in `auth-verify.test.ts` |
| `if (initError)` in `AuthCallback` disabled | the existing-session-plus-failed-exchange test |
| `SETTLE_MS` raised to ten hours | the blank-page test in `use-session.test.ts` |
| the `onCallback` guard deleted, and a fifth rewrite added | the `main.tsx` structural test, both times |

The first HTTP test also **failed for real on its first run**, before any of that: person B was handed
person A's profile, because the suite had not forced `SPIDERYARN_STORE=postgres` and the filesystem
store has no owner column. That is the hole `src/store/index.ts` now refuses to boot into.

### What Sol found in the ownership work

The built change went back for a second review the same day, and it came back
**BLOCKER — the isolation claim is false**. The full text is in
[260827e-ownership-code-review-sol.md](260827e-ownership-code-review-sol.md); it was right, and
the reason is worth keeping.

The claim I asked it to attack was this: *every path from a slug to an article
carries an owner filter, and that is the whole of the isolation, because the other
owned tables are reached only through an `articleId` that came from one of those
paths.* That is true of the store. It is not true of the application, and the two
live holes were both **outside the store** — which is precisely why a predicate
inside it, and a static guard that greps for that predicate, saw neither:

| | |
|---|---|
| `GET /api/source/:slug` | read `data/<slug>/raw.pdf` straight off disk, never resolving the slug at all |
| the ingest queue | `Job` had no owner; list, get, cancel, retry, advance and delete all took an id and did not ask whose |

And Sol chained them, which is the part I would not have thought of:

> Combining findings 1 and 2 gives Bob a reliable sequence: list Alice's PDF job,
> take its slug, then download its source.

Both are fixed, along with two latent ones from the same review — that a p-queue
callback does not inherit an owner (measured: with concurrency 1, Bob's whole task
runs in Alice's context), and that `npm run db:import` could take another owner's
article and everything anchored to it, reporting success at every step. Each has a
test that was watched failing:

| broken on purpose | what went red |
|---|---|
| `mine()` in jobs.ts returning `true` again | 7 of the 9 in `owner-jobs.test.ts` |
| the `shelfStore.read` removed from `sendSource` | the ordering test in `owner-isolation.test.ts` |

**The lesson I would keep** is about the shape of the guard rather than the bugs.
A predicate plus a grep is a good way to make sure every query of a known kind is
right, and it is no way at all to find the code that never makes that kind of
query. `sendSource` and the jobs routes were invisible to it for the same reason
they were broken: they never asked the store anything.

### What this does not close

- **Anyone with a Google account can still sign in** and spend the model budget. That is the risk
  Greg actually accepted, and a spend limit is its control. `isAllowed()` is one line if it turns out
  to be needed sooner.
- **`SPIDERYARN_STORE=files` has no isolation**, and unset still means `files`. Production refuses to
  boot on it; every other host does not.
- **Child rows are trusted to match their article.** The owner column on comments, chat, searches and
  lookups is written and never read, and nothing in the database enforces the invariant.
- **The ingest queue is on disk.** It carries an owner now, but `jobs.owner_id` in the schema is still
  unused and the queue does not work on Vercel at all.
- **No RLS.** The filtering is in the queries, so a query written without the predicate is the whole
  exposure — which is what the static guard is for, and it is a grep rather than a proof.
- **`articles.slug` stays globally unique.** Two people ingesting the same URL is still an open
  question rather than a thing that works.

## See also

- [260826w-auth-supabase.md](260826w-auth-supabase.md) — the decisions, and everything this plan builds on
- [260826w-auth-supabase-review-sol.md](260826w-auth-supabase-review-sol.md) — GPT Sol on that plan
- [auth.md](../project/auth.md) — what auth is for here
- [deployment.md](../project/deployment.md) — Vercel, and the five things that fail without saying so
- [security.md](../project/security.md) — the two untrusted parties
- [silent-success.md](../reusable/silent-success.md) — the pattern behind the checks in this file
