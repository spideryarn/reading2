Your Supabase conclusion is right. Keep Drizzle.

Your layer split is also broadly right, but two parts are wrong:

- A service worker can see and forward the page’s `Authorization` header.
- Layer 1 is not “one file plus a few lines.” Correct offline auth, cache provenance, account isolation, shelf behavior, and testing make it the larger layer.

## Ranked recommendation

1. Keep Drizzle and the API boundary.
2. Cache only `GET /api/article/:slug` initially, plus enough metadata to render an offline-only shelf.
3. Put that cache in the page layer, not the service worker.
4. Add a shell-only service worker because iPadOS tab eviction makes cold restart a real scenario.
5. Introduce an explicit “known user, offline” auth state. Cache fallback must happen before waiting for token refresh.
6. Auto-cache the last 100 opened articles or 50MB, whichever comes first.
7. Add content-derived ETags and saved/checked timestamps, but don’t block the first offline release on ETags.

Cut:

- Supabase data access in the browser.
- PowerSync/Electric/Zero/etc.
- API runtime caching in Workbox.
- Cached comments, chat, searches, jobs, glossary generation, and other artefacts.
- Offline writes.
- A “Keep offline” button—it promises persistence Safari cannot guarantee.
- Automatic `skipWaiting`.

## Supabase: your two claims check out

The Drizzle versus `supabase-js` decision is currently server-side and invisible to the browser. Moving the server adapters from Drizzle to `supabase-js` would change how the server reaches Postgres, not what an offline browser possesses.

`supabase-js` persists the auth session, not database query results. Supabase’s own current offline material uses separate local databases and sync engines, and Supabase explicitly describes its direction as improving third-party integrations such as PowerSync, Electric and Zero rather than adding native offline persistence to the client. [Supabase client initialization](https://supabase.com/docs/reference/javascript/initializing), [Supabase on offline integrations](https://supabase.com/blog/triplit-joins-supabase).

Changing server-side Drizzle to `supabase-js` would be several weeks here: there are ten Postgres store modules and numerous multi-table transactions that PostgREST would require RPCs or redesign to preserve. Moving application data directly into the browser would additionally require exposed schemas/views, RLS, client query rewrites, and a new security boundary. It would still need the same offline cache and service worker.

## 1. Page cache versus service-worker API cache

Keep protected API data in the page layer.

Your bearer-token explanation is partly wrong. A worker receives the complete `event.request`, including `Authorization`, and can forward it. A 401 can return to `apiFetch`, which refreshes and retries.

The hard parts are instead:

- Cache Storage is origin-scoped, just like IndexedDB. It is shared by accounts using the same browser profile.
- Normal Cache matching principally uses URL/method and response `Vary`; it does not automatically give you a stable user partition. [Cache matching semantics](https://developer.mozilla.org/en-US/docs/Web/API/Cache/match), [Vary](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Vary).
- Keying on the bearer token fails when the token rotates.
- Keying only on URL can cross accounts.
- A worker needs custom cache-key logic or a user-id message from the page.
- Most importantly, the worker sees nothing until the page calls `fetch`. Today `apiFetch` waits for Supabase first, so auth can hang before the worker gets a request.

You already have the better semantic seam in [api.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/lib/api.ts:227). Use IndexedDB records such as:

```text
{ userId, url, body, etag, savedAt, checkedAt, lastOpened, bytes }
```

Don’t cache every successful GET. Start with articles. Optionally cache `/api/library`, but offline Home should show the intersection of the cached shelf and actually cached article bodies—not a shelf full of dead links.

## 2. Is the service worker worth it?

Yes, because iPad is a target.

For a live tab:

- Goal 1 already works after the article has rendered; React already holds the article.
- Layer 1 buys opening another cached article and offline Home.
- IndexedDB survives route changes and reloads, but without a cached shell an offline reload cannot execute the code that reads it.

On desktop, cold-launch support could be called completionism. On iPadOS, suspended pages are routinely discarded under memory pressure. Returning to the “same app” often means rebuilding it. Layer 2 therefore protects a normal reading path, not an edge case.

Keep it shell-only: `index.html`, hashed JS/CSS, fonts, icons, and navigation fallback. No `/api/*` runtime route.

## 3. The auth trap is real and worse than suspected

Current `apiFetch` calls `getSession()` before `fetch` [here](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/lib/api.ts:242). The installed Supabase client:

- Waits for initialization.
- Treats a token inside a 90-second margin as expired.
- Attempts a refresh with exponential retries bounded around a 30-second tick—but an individual `fetch` has no deadline. [Installed `GoTrueClient.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/@supabase/auth-js/src/GoTrueClient.ts:2864).

Meanwhile, [useSession.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useSession.ts:48) gives up after eight seconds, and [App.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:129) gates the entire application on that result. A cold offline launch can therefore become the landing page before the article cache is consulted.

Correct shape:

- Persist the last successfully authenticated user id under your control.
- Model auth as `checking | online-session | offline-known-user | signed-out`.
- Start the article-cache lookup before or in parallel with Supabase initialization.
- If `navigator.onLine === false`, use it as a fast-path hint and serve the cache immediately.
- If connectivity appears available, race auth/network against a short cached-fallback deadline.
- Never use `navigator.onLine` as proof that a request will work.
- Never turn caller cancellation/`AbortError` into a cache fallback.
- Don’t fall back after an authoritative 401, 403, 404, or 410.
- Permit cached reading with an expired token only as an explicit product decision: “previously authenticated on this device” is not “currently authorised by the server.”
- Clear or deactivate that user’s cache on explicit logout/account switch.

Without that offline-known-user state, cold offline reading will fail whenever the access token has expired.

## 4. iPadOS storage reality

The quota is not your problem. Eviction is.

Since Safari/iPadOS 17, WebKit advertises an origin quota around 60% of total disk for browser apps; Home Screen web apps receive the browser-app quota. Both IndexedDB and Cache Storage count against it. [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/).

The seven-day rule is still documented: for an ordinary Safari site, script-writable storage—including IndexedDB, service-worker registration and Cache Storage—can be deleted after seven days of Safari use without user interaction with that site. It is not simply seven wall-clock days, and scrolling is not interaction. Home Screen web apps are explicitly exempt. [Current WebKit tracking-prevention documentation](https://webkit.org/tracking-prevention/).

`navigator.storage.persist()` is implemented on iOS. Call it opportunistically after meaningful use, inspect the boolean, and log it for diagnosis. WebKit grants according to heuristics such as Home Screen installation. It is worth ten lines; it is not a guarantee and should not change the UI promise.

Consequently, “an article I read last week” is not guaranteed in normal Safari. Installation materially improves that story.

## 5. Staleness

Use network-first semantics whenever the network is healthy:

- `200`: validate and atomically replace the cache.
- `304`: keep the body and update `checkedAt`.
- Transport failure or selected 5xx: use the cached body.
- 401/403/404/410: do not conceal the answer with old data.

The current `Article` response has no revision identity [in its type](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:964), although Postgres has one internally. Prefer a strong content-derived ETag across both file and Postgres stores. A database revision UUID would not exist consistently during the dual-store period and may change without meaningful payload changes.

Do not call the cache result `stale`; that term already means artefact/article mismatch elsewhere. Call it an “offline copy.”

Suggested status:

> Spideryarn couldn’t reach its server. Showing the copy saved on 14 August. Reconnect to check for changes. [offline-copy]

If reconnecting discovers a changed ETag, don’t replace the article underneath the reader. Offer “A newer version is available—reload when ready.”

## 6. Quota and retention

At the stated size:

- 100 articles ≈ 15MB.
- 1,000 articles ≈ 150MB.
- The current built shell is about 1.7MB.

That is tiny relative to modern WebKit quotas. Use automatic caching, because “previously opened” is exactly the requested mental model.

Cap it at something simple such as 100 articles or 50MB. Evict least-recently-opened entries. Derive “Available offline on this device” from a live IndexedDB query—never from a server field or remembered boolean. That prevents the shelf from advertising an article your own LRU already removed.

A “Keep offline” control should wait until you can provide clearer persistence and storage-management UX.

## 7. Service worker and Vercel traps

The current rewrite is compatible with a root `/sw.js`: Vercel gives real filesystem assets precedence over rewrites. [Vercel configuration behavior](https://vercel.com/docs/project-configuration/vercel-json). Still verify in production that `/sw.js` returns JavaScript, not the SPA’s `index.html`.

Configuration requirements:

- Worker at `/sw.js`, root scope.
- Explicit `Cache-Control: no-cache` or `max-age=0, must-revalidate` for the worker script.
- Navigation fallback to precached `/index.html`.
- Explicit denylist for `/api/`.
- No API runtime caching.
- No `registerType: "autoUpdate"`: vite-plugin-pwa makes that imply `skipWaiting` and `clientsClaim`. [vite-plugin-pwa warning](https://vite-pwa-org.netlify.app/guide/auto-update).
- Let an updated worker wait, then offer a controlled reload. Workbox warns that `skipWaiting` can mix an old page with newly activated cached assets and break lazy loading. [Workbox lifecycle](https://developer.chrome.com/docs/workbox/service-worker-lifecycle).
- Keep the API backward-compatible with at least the previous client. A worker can preserve an old bundle far longer than an ordinary deployment.
- Maintain a kill-switch worker at the same URL that activates, deletes only `spideryarn-*` caches, unregisters, and reloads. A bad worker cannot be repaired on devices that remain offline.

The server rewrite to `?__spy_path=` is invisible to the worker; it sees the original `/api/...` request.

## 8. What makes this harder than it looks

The choke point helps, but three things broaden the work:

- Whole-app auth gating blocks cached content before data fetching starts.
- Each feature hook owns its own errors/loading state, so one transport-level cache flag does not automatically produce honest UI.
- Rendering an article starts ancillary calls and the open-counter POST. Offline mode must suppress those, or the “working” reader will quietly launch failed auth refreshes and red panels.

Also, article JSON does not include remote images or embeds. “Offline prose” is achievable; “the complete article exactly as online” is not without caching external media.

## 9. Effort

| Work | Competent-dev estimate |
|---|---:|
| Bare happy-path article cache | 1–2 days |
| Layer 1 done honestly: user partitioning, offline auth state, article/local shelf, provenance UI, limits, failure classification, tests | **4–6 days** |
| Layer 2: shell precache, navigation fallback, update UX, Vercel headers, kill switch, production verification | **2–3 days** |
| ETag/304 support across both stores | **1 day** |
| Real iPad and upgrade/failure testing | **1–2 days** |
| Total credible first release | **7–10 days** |

## Silent-success tests that must exist

1. Warm article, offline: prove it is React memory, then separately prove an IDB hit.
2. Offline Home opens only locally available articles.
3. Hard reload `/read/<slug>` offline with `navigator.serviceWorker.controller` present.
4. Terminate Safari/PWA, enable airplane mode, cold launch.
5. Force the Supabase token expired, then verify cached prose appears promptly—not after 8 or 30 seconds.
6. User A → logout → user B → offline: no cross-account article.
7. Cache write throws `QuotaExceededError`: UI must not claim the article is saved.
8. API returns 200 HTML, 401, 404, 500, aborted request, and a response whose body dies mid-read.
9. Deploy a new shell while an old tab is open; verify no mixed bundle.
10. Request `/sw.js` in production and assert status, content type, body marker, cache header, and root scope.

The blunt conclusion: build both layers, but make Layer 1 much narrower and more deliberate. The service worker is the easy half. Offline identity and truthful cache provenance are the real design.