<!-- GPT Sol's review of the BUILT auth code, 2026-08-27. Kept verbatim except that
     its absolute-path links were turned into plain `file:line` references — they
     pointed at this laptop. What was done about each finding is in
     260826ae-auth-ui-and-production.md § The review of the built code. -->

No. This is not safe to deploy merely once the dashboards are configured. The API gate itself is fail-closed, but the authenticated user is discarded, so every valid Supabase account receives the same shared account and can spend the shared model budget. The health endpoint and sanitizer also need changes before deployment.

I made no edits. I ran the focused, non-mutating test set: all 86 tests passed, including while several failures below remain possible.

1. **Blocker — authentication does not provide authorization or ownership**

`requireUser()` returns an identity, but `routes.ts` discards it. `auth.ts` allows every successfully authenticated Supabase user. The stores continue to use the process-wide `SPIDERYARN_OWNER_ID`; for example `owner.ts` and `pg-shelf.ts`.

Consequently, any person who can create a Supabase account can see and change the same library, profile, chats, searches and reader state, and can run paid model operations. This is more serious than the plan’s description of a shared wallet.

This was answered in prose, not code. The plan hands ownership back as a later decision, while `docs/project/auth.md` still contradicts itself: it describes a one-email allowlist and a test rejecting the wrong email, then later admits that all signed-in users share one shelf.

Before deployment, either:

- reinstate the one-email allowlist as the small beta-safe fix; or
- carry the returned user identity through request-scoped stores and constrain every read and write by that owner.

2. **High — the public health endpoint is an unauthenticated database amplification endpoint**

The application handlers are gated, but `vercel.ts` handles `/api/health` before the gate. GET and HEAD call `listArticles()` in `vercel-health.ts`.

That is not a cheap health query. `pg.ts` loads article/revision data and then performs per-article block and comment work. An anonymous caller can repeatedly cause an expanding N+1 workload. HEAD is just as expensive as GET.

The response also exposes raw database or SSL error messages plus runtime, region, commit and environment diagnostics. The plan considered caching or dropping the article count, but neither happened in code.

The advertised 8 KB cap is only a storage cap: it reads a complete incoming chunk before noticing it is too large, then returns a successful truncated diagnostic. It neither rejects with 413 nor provides a hard transport cap.

Make the public endpoint a constant-time liveness response. Put detailed diagnostics and POST behind authentication or a deployment-only secret. If an article count is genuinely needed, issue `count(*)`; do not call `listArticles()`.

3. **High — the “article HTML cannot address our API” sanitizer rule has concrete bypasses**

`isOwnApi()` resolves URLs against `https://spideryarn.invalid`. It therefore treats every absolute URL as foreign, including the application’s real production origin.

These survive sanitation:

- `https://<actual-production-host>/api/...`
- `//<actual-production-host>/api/...`
- mixed `srcset`, such as `"/safe.png 1x, /api/health 2x"`
- `<table background="/api/health">`
- SVG resource values such as `fill="url(/api/health)"`

I verified those directly through `sanitizeHtml()`. The mixed `srcset` survives because `URL_ATTRS` passes the entire candidate list to `new URL()` rather than parsing each candidate. DOMPurify allows additional URL-bearing HTML and SVG attributes that are not in that list.

Uppercase attributes, encoded `href` values and `xlink:href` were normalized and caught. Meta refresh was removed. Inline CSS is forbidden, but SVG presentation attributes remain relevant.

There is also a cache-version error: `SANITIZER_VERSION` is still `1`, despite the newly tightened policy and the adjacent instruction saying stricter hooks require a bump. Previously stored version-1 artifacts can therefore be mistaken for artifacts sanitized under the new policy.

The fix needs:

- browser-side comparison with `location.origin`;
- configured application origins for server-side sanitation;
- real `srcset` candidate parsing;
- coverage for `background` and allowed SVG resource attributes, or a narrower SVG allowlist;
- a sanitizer-version bump.

4. **Medium — `AuthCallback` can report the wrong authentication attempt as successful**

`getSession()` does wait for the SDK’s initialization promise, so it should not normally resolve before a successful PKCE exchange finishes. That part is sound.

The problem is that `AuthCallback.tsx` treats the existence of any session as proof that this callback succeeded. Supabase preserves an existing session when a new callback exchange fails. A user who already has a session can therefore receive a bad or expired callback and be redirected as though that attempted sign-in or account switch succeeded.

Call the public `supabase.auth.initialize()` and inspect its returned error for this exact initialization. Only then read the session.

Other callback issues:

- The ten-second deadline can display failure for a legitimate slow exchange. It does not cancel the exchange, so the original promise may later navigate anyway.
- `AUTH_PARAMS` omits the SDK’s `sb_flow_id`, so a failed exchange can leave an authentication parameter in the URL.
- A provider denial or exchange failure does not consume the stored return destination, despite the helper’s claim that failed sign-ins do not survive.
- The component and SDK both using `history.replaceState` is otherwise harmless: the SDK captures the parameters before exchange, and repeated deletion is idempotent.

5. **Medium — `useSession` can leave the entire application blank indefinitely**

Supabase normally sends `INITIAL_SESSION`, including after an initialization error, so subscribing only to `onAuthStateChange` is sufficient when initialization eventually settles.

It is not sufficient when initialization hangs. `useSession.ts` has no deadline or error state, while `App.tsx` renders `null` while loading. A stuck PKCE or refresh request can therefore produce a permanently blank page.

The `pageshow` call to `getSession()` does not repair that case because it waits for the same unresolved initialization.

Add a bounded initialization state with a visible failure and retry action. Do not use an indefinitely blank render as the error path.

6. **Medium — genuinely bad tokens can be mislabeled as infrastructure failures**

`auth.ts` maps every `AuthApiError` to “unavailable.” Supabase also uses `AuthApiError` for 4xx token failures, including failures encountered when `getClaims()` falls back to `getUser()`.

A malformed token with an unsupported or unknown key can therefore produce 503 instead of 401. This does not fail open—the request remains blocked—but it prevents the browser’s 401 refresh path and can leave polling code retrying indefinitely rather than returning the user to sign-in.

Classify using status and error code:

- retryable/network/5xx errors → unavailable/503;
- 4xx token, session and claim errors → bad token/401.

7. **`apiFetch` is mostly correct, but its lifecycle paths are weakly tested**

The important core behavior holds:

- There is exactly one 401 retry, so no loop.
- Current mutation bodies are replayable strings.
- A 401 occurs before the handler starts, so retrying does not duplicate model work.
- It does not consume the successful response body, so `useChat.ts` can still stream SSE normally.

The module-scope subscription and token cache are not a production leak in the normal singleton/page-lifetime design. Same-tab sign-out clears the cache. Cross-tab changes work where the SDK’s BroadcastChannel works; without it, normal `apiFetch` reads storage again, but `leavingFetch` can retain the stale cached token. Hot reload can also accumulate old subscriptions during development.

`keepalive` plus deliberately not awaiting is the right browser mechanism for page exit. Browsers impose an approximately 64 KiB keepalive body budget. The only current use—the profile, capped near 1,500 characters—is comfortably below that, but `leavingFetch` is generic and silently swallows failure. Give it an explicit body-size guard.

There is also a profile-saving race: `visibilitychange` can begin an ordinary fetch, then `pagehide` sees the same body in flight and declines to send the keepalive copy. The ordinary request can be killed during navigation. Because the profile PATCH is idempotent, pagehide should be allowed to send the keepalive duplicate.

8. **The return-path guard is not an open redirect, but its integration is untested**

The stored destination accepts only same-site paths beginning with `/` and rejects `//`, schemes and callback paths. The guarded `/add/` rewrite removes authentication parameters before constructing the destination. I found no remaining direct route by which `?code=` becomes part of an `/add/` source URL.

The weakness is test coverage: `router.test.ts` tests pure helpers and explicitly leaves the `main.tsx` side effect untested. Removing or reordering the actual guard could leave the suite green.

9. **`SourceLink` still exposes a raw authenticated API URL**

`SourceLink.tsx` still renders `<a href="/api/source/...">` and relies on intercepting an ordinary click.

A normal click works through `apiFetch`, but middle-click, Open in New Tab, copied URLs and some assistive navigation bypass the handler and reach the API without an Authorization header, producing a 401 page. The test explicitly exempts `SourceLink`, so it passes while this behavior remains.

Use a control without a raw `/api` href, or mint an object URL or short-lived authorized source URL before offering anchor semantics.

10. **The passing tests overstate what was verified**

Specific green-test gaps:

- `auth.test.ts` injects already-classified verifier results. It never exercises `verifyWithSupabase`, SDK errors, JWK fallback or the incorrect `AuthApiError` classification.
- `sanitize-own-api.test.ts` calls `spideryarn.invalid` the same origin and tests only a single-candidate `srcset`. Actual deployed origins, protocol-relative self URLs, mixed candidates, `background` and SVG resource attributes are absent.
- There are no component tests for `AuthCallback`, including existing-session-plus-failed-exchange, timeout, denial, parameter cleanup or missing verifier.
- There are no `useSession` initialization/hang tests.
- `api-fetch.test.ts` does not exercise `leavingFetch`, token-cache invalidation, cross-tab sign-out or keepalive-size behavior.
- `no-api-hrefs.test.ts` exempts the one component that still renders an API `href`.
- `no-secrets-in-bundle.test.ts` can pass if `dist` is absent and can inspect a stale build; it does not prove that the current source was freshly built without secrets.
- There are no health endpoint tests covering public cost, raw diagnostics, HEAD, method behavior or oversized bodies.

The application-handler gate itself did hold up under review: nothing before `requireUser()` invokes a route handler, parses a request body, writes streaming headers or spends model money. OPTIONS and HEAD do not bypass it, and route-specific errors occur after it. `/api/health` is the intentional public exception described above.

The minimum deployment bar is: enforce the intended user allowlist or ownership boundary, replace the public health query, close the sanitizer bypasses and bump its version, use the callback’s actual initialization result, bound session initialization, and correct the token-error classification. After those changes and tests for the real integration seams, I would reassess deployment safety.