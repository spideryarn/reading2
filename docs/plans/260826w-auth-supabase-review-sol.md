# GPT Sol on the auth plan

> Cross-family review of [260826w-auth-supabase.md](260826w-auth-supabase.md), run 2026-08-26 with
> `gpt-5.6-sol`, high effort, read-only. Kept because AGENTS.md says the reasoning behind a change
> should survive it. **Every finding was re-checked in the repo before being acted on** — see
> [§ The cross-family review](260826w-auth-supabase.md#the-cross-family-review-and-what-it-changed) for
> which, how, and where each one landed. Absolute paths in the original have been rewritten
> repo-relative.

---

# Review: changes required before build

I found no final-state application route that bypasses a correctly placed `requireUser`. However, the plan as written creates a real fail-open deployment window, mishandles `handleApi`’s `try`, and has brittle OAuth callback routing.

## High — the build order deploys a convincing but fake gate

**Wrong:** Step 4 adds the sign-in screen before Step 5 adds server enforcement (`docs/plans/260826w-auth-supabase.md:725-732`).

**Failing case:** after the App branch deploys, a browser shows only Sign In, but this still works anonymously:

```bash
curl https://host/api/library
curl -X POST https://host/api/jobs \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}'
```

That is worse than an obviously unfinished gate because it looks protected. The claim that Vercel SSO is an outer gate is also false for the stable production alias: `docs/project/deployment.md:141-181` records that it is public, contradicting `docs/plans/260826w-auth-supabase.md:661-663`.

**Smallest fix:** do not deploy the UI gate and API gate separately. Land one vertical commit containing:

- client singleton and session hook;
- token-bearing `apiFetch`;
- sign-in and sign-out;
- `requireUser` inside `handleApi`;
- route and auth tests.

Earlier commits may add dependency/config/test scaffolding only.

## High — the proposed gate position is outside the catch that supposedly handles it

**Wrong:** the plan says to call `requireUser` immediately after `url.startsWith("/api/")` and claims the existing `try` will turn its `httpError` into 401/403 (`docs/plans/260826w-auth-supabase.md:483-487`). The `try` does not begin until `src/routes.ts:1835`; the prefix check is at `src/routes.ts:1754`.

**Failing case:** an anonymous `GET /api/library` throws before the `try`. Locally, Vite’s outer catch answers 500 and exposes `err.message` (`vite.config.ts:15-41`). On Vercel, `src/vercel.ts:134-163` answers a generic 500. `handleApi`’s `finally` does not log it.

This fails closed, but the documented 401/403 behavior and logging guarantee are false.

**Smallest fix:** start the `try` before authentication:

```ts
let failure: unknown;
try {
  const user = await requireUser(req);
  // Define/match routes and dispatch only after this.
  // ...
} catch (err) {
  // existing status handling
} finally {
  logRequest(...);
}
```

Route regex construction is pure, so placing the gate immediately before the first dispatch branch is also secure, but the gate must be inside the `try`.

I found no `OPTIONS`, `HEAD`, query-string, body-read, already-written-header, or SSE path around such a gate. Every actual route dispatch is below `src/routes.ts:1835`; body reads and stream headers occur later.

## High — OAuth return routing is incomplete and `/add/` can absorb the auth code

The ordinary root callback is safe, but the blanket claim is not.

### What the four rewrites do

| Incoming URL | Result |
|---|---|
| `/?code=C&state=S` | All four rewrites leave it unchanged. The code survives. |
| `/?error=access_denied&error_description=…` | Unchanged unless it coincidentally contains one of the app’s raw parameter spellings. The SDK sees the error, but the proposed hook has no error state. |
| `/#access_token=A&refresh_token=R…` | `legacyAnchor` sees the entire fragment, not a block id, so it survives. |
| `/?slug=foo&code=C` | Becomes `/read/foo?code=C`; PKCE code survives. |
| `/?slug=foo#access_token=A…` | The slug rewrite at `src/web/main.tsx:136-143` calls `readHref` without the hash. The implicit token is lost. |
| `/read/foo?about=1&code=C` | Becomes `/read/foo/metadata?code=C`; `aboutish` preserves the code and hash (`src/web/main.tsx:173-187`). |
| `/add/https%3A%2F%2Fx.test%2Fa?code=C&state=S` | `canonicalAddHref` treats `?code` and `state` as part of the article URL and rewrites them inside the encoded `/add/` segment (`src/web/router.ts:241-253,311-321`). |

There is a second-order import problem. `main.tsx` statically imports `App` at line 5. Once `App` imports the proposed session hook, the module-scope Supabase client initializes before any code in `main.tsx` runs. The SDK parses `window.location.href` at `node_modules/@supabase/auth-js/src/GoTrueClient.ts:661-672`, then yields while checking PKCE storage. The rewrites can run before the later cleanup at lines 3887-3891.

Consequently, `/add/` authentication may succeed using the already-captured code while leaving that code encoded into the article URL. The subsequent ingest could send the one-time code and state to the target website.

The bookmarked-path promise is independently false unless the button passes `redirectTo`. Without it, Supabase returns to `SITE_URL`, not the current page. [Supabase documents Site URL as the default](https://supabase.com/docs/guides/auth/redirect-urls).

**Smallest fix:** add stable `/login` and `/auth/callback` routes.

- Save a validated same-origin `returnTo` path in `sessionStorage`.
- Always use `/auth/callback` as `redirectTo`.
- Exempt that route from legacy URL canonicalization.
- Let Supabase exchange and clean the callback.
- Navigate to the saved path afterward.
- Show and then remove OAuth error parameters.

This also gives password recovery its required stable landing route. With `flowType: "pkce"`, the appendix’s claim that recovery necessarily returns a token fragment is wrong: `resetPasswordForEmail` generates a PKCE challenge at `node_modules/@supabase/auth-js/src/GoTrueClient.ts:4447-4478`.

## Medium — `apiFetch` needs live session acquisition, not a cached React token

A stream does not fail merely because its token expires halfway through. Authentication is an admission check; once the server has accepted the request, it need not re-authenticate each SSE frame.

The dangerous cases are stale client state, a refresh already in flight, and a restored bfcache page. `apiFetch` must call `getSession()` for every request. The installed SDK refreshes within a 90-second margin and single-flights concurrent refreshes (`node_modules/@supabase/auth-js/src/GoTrueClient.ts:3051-3126`; `lib/constants.ts:3-13`).

A safe core is:

```ts
export async function apiFetch(input: string | URL, init: RequestInit = {}) {
  const url = new URL(input, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) {
    throw new Error("apiFetch only sends credentials to this app's API");
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new AuthRequiredError();

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${data.session.access_token}`);

  const response = await fetch(url, { ...init, headers });
  if (response.status !== 401) return response;

  // The server gate rejected before reading the body, so current JSON/string
  // request bodies are safe to retry once.
  const refreshed = await supabase.auth.refreshSession();
  if (refreshed.error || !refreshed.data.session) return response;

  headers.set("Authorization", `Bearer ${refreshed.data.session.access_token}`);
  return fetch(url, { ...init, headers });
}
```

Do not directly tell the hook “the session is gone” on every 401. A 401 can be a refresh race or verifier failure. Let the SDK’s auth events own session state. Add a `pageshow`/bfcache resync in `useSession`.

Restricting `apiFetch` to same-origin `/api/` is important; otherwise a future absolute URL call leaks the bearer token.

## Medium — email is a weaker authorization identity than `sub`

The proposed attacks do not all yield a bypass:

- Supabase automatically links OAuth identities only around matching verified emails; it specifically avoids automatic linking based on unverified email. [Identity-linking documentation](https://supabase.com/docs/guides/auth/auth-identity-linking).
- Apple relay, Gmail dots, and plus-addresses cause exact-match denials, not false acceptance.
- Remote email/password confirmation establishes mailbox control.
- Local autoconfirm allows anyone with local access to claim an unseeded allowed address.

The real defects are:

- An old JWT with the allowed email remains valid for up to an hour after an email change.
- Authorization changes if mutable account metadata changes.
- Future provider behavior becomes part of the security boundary.

**Smallest fix:** authorize a hard-coded Supabase user UUID and use email only for display. Cost: create/invite the user first, record separate local and remote UUIDs, and update the constant when admitting someone. This is operationally less convenient but cryptographically clearer.

Also validate `role === "authenticated"`, expected `aud`/`iss`, UUID-shaped `sub`, and `is_anonymous !== true`. `getClaims` currently verifies expiry and signature but does not runtime-check all those claims (`node_modules/@supabase/auth-js/src/GoTrueClient.ts:6501-6569`).

## Medium — the route-test plan does not preserve the existing suite

Adding `headers: {}` fixes the TypeError but makes every existing route test receive 401. The harness currently promises “no server and no network” (`tests/routes.test.ts:1-7`), while the proposed real-token test requires local Supabase.

The expired-token test also cannot be minted through the shown admin flow without waiting or controlling the signing key.

**Smallest fix:**

- Give ordinary route tests an authenticated default via an injected/mock verifier.
- Add explicit anonymous and wrong-user cases.
- Test `requireUser` separately with a generated test EC key/JWKS or a verifier stub.
- Keep a live-local-Supabase integration test separate and opt-in.
- Mutation-test the gate by temporarily bypassing `requireUser` and confirming the no-header test goes red.

## Medium — JWKS fetching is latency/availability, not normal correctness

Your ES256 inference is mostly right:

- no `jose` dependency is needed;
- signature verification occurs locally after a public key is available;
- a cold ephemeral invocation may fetch JWKS once.

The installed SDK has a module-global cache (`node_modules/@supabase/auth-js/src/GoTrueClient.ts:223-231`) and fetches an unknown `kid` automatically (`:6366-6401`). Vercel instances are often reused, so this is not necessarily one fetch per invocation.

Do not pass a static `jwks` bundle. Supplied keys take precedence without the SDK cache TTL. That can prolong trust in a revoked key and adds configuration drift. On rotation, the new standby key is published before use, and an unknown `kid` triggers a refresh; Supabase explicitly says `getClaims` handles quick rotation. [Supabase signing-key documentation](https://supabase.com/docs/guides/auth/signing-keys).

First request after a normal rotation should succeed. If the JWKS/Auth network is unavailable on a cold start, fail closed with **503**, not 401: the caller’s credentials are not necessarily wrong.

## Medium — the public Vercel surface is broader than the plan says

`/api/health` is not only a public GET. At `src/vercel-health.ts:130-133`, every method other than GET/HEAD runs `bodyCheck`, which accumulates the entire body without `MAX_BODY_BYTES`.

Concrete request:

```bash
curl -X DELETE https://host/api/health --data-binary @large-file
```

Also, if the compiled handler fails to import, `api/index.js:43-64` exposes its message and stack before application auth can run. Its comment claiming the endpoint is behind Vercel login is stale.

**Smallest fix:**

- public GET/HEAD only;
- 405 for other methods;
- move the POST body diagnostic behind auth or a deployment-only secret;
- cap its body;
- return a generic import-failure body and log the stack.

## Medium — logging, sign-out, rate limits, CORS and CSRF

- Auth `httpError` messages become logged `reason` fields (`src/routes.ts:1721-1738`). They must be fixed prose only: never interpolate the token, header, SDK error, `sub`, or email. Add a sentinel test against the serialized log bytes.
- Sign-out belongs in v1, not Appendix A. It should call `signOut`, abort active client streams, and clear app-owned cached state.
- Supabase’s auth rate limits do not protect `/api/jobs`, chat, comments, lookup, or search. With one fixed UUID this can be accepted temporarily, but document the risk. A real cost limit must be database/provider-backed; an in-memory counter is ineffective across Vercel instances.
- Leaving CORS absent is correct for this same-origin app. Do not publicly exempt `OPTIONS` unless a cross-origin client is deliberately added with an exact Origin allowlist.
- The header-not-cookie CSRF argument is sound: another origin cannot read localStorage, and setting `Authorization` requires preflight. It does not protect against XSS. That matters here because the refresh token lives in localStorage and the app renders untrusted article HTML; the known missing CSP/Trusted Types controls at `docs/project/security.md:801-812` become more consequential.

## Low — factual corrections and drift

- A modern `sb_publishable_…` key is not itself a JWT-shaped user token. The test should still reject it, but `docs/plans/260826w-auth-supabase.md:460-464,610` gives the wrong reason. Legacy `anon` keys were JWTs; publishable keys are independent of signing keys.
- `getClaims(jwt)` and the `jwks` option are real in 2.112.4; `flowType` really defaults to `implicit` (`node_modules/@supabase/auth-js/src/GoTrueClient.ts:194-205,6469-6482`).
- The current `config.toml` Google schema is valid, including `redirect_uri`, `url`, and `skip_nonce_check` (`supabase/config.toml:335-374`). The local redirect list currently contains exact root URLs only, not the planned `/**` entries (`:171-180`).
- The Vite build-time statement is correct. One missing nuance: shell-exported `VITE_*` values outrank `.env.local`, unlike this repo’s Node loader, where `.env.local` deliberately wins. [Vite 8 environment documentation](https://v8.vite.dev/guide/env-and-mode).
- The raw-fetch count has already drifted in the shared tree: it is currently 27 calls across 13 files, because untracked `src/web/useProfile.ts` adds two. There is still no `EventSource`.
- Shell commands using `$VITE_SUPABASE_PUBLISHABLE_KEY` do not obtain values from `.env.local` automatically. Vite and `src/env.ts` load that file; `curl` does not.

## Things the plan gets right that I checked

- ES256 on both projects permits local signature verification after JWKS acquisition; no extra crypto library is needed.
- PKCE must be selected explicitly in the installed SDK.
- One singleton client is right.
- The synchronous `onAuthStateChange` overload and nested-refresh warning match the installed 2.112.4 source.
- Fetch-based SSE can carry `Authorization`; there is no `EventSource`.
- A gate before body reads and stream headers protects every current `handleApi` route.
- `/api/health` is dispatched before `handleApi`.
- Header bearer auth is a sound same-origin CSRF design.
- Vite client variables are compiled at build time.
- `tests/routes.test.ts` really does omit `headers`.

## Questions for the human

1. Authorize the fixed Supabase UUID instead of the email?
2. Make `/login`, `/auth/callback`, and `/reset-password` real routes?
3. Require the client and server gates to land atomically?
4. Keep only GET/HEAD `/api/health` public?
5. Include sign-out in v1?
6. Add a database-backed cost limit now, or explicitly accept that risk for one user?
7. Should auth feed `owner_id` now, or remain deliberately separate for v1?
8. What single production origin should be the Supabase Site URL rather than relying primarily on a broad Vercel wildcard?