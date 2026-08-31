Verdict: revise before building. The architecture is sound, but Slice 0 is broader than necessary and Slice 1’s whitelist is too wide for a generic cache.

## Ranked findings

1. **Cut the `useSession`/`App` offline-user change from Slice 0.** Without a service worker, a cold offline launch cannot boot React anyway. Warm-page navigation already retains the authenticated user in memory. Change only `apiFetch` now.

2. **Cut mutable endpoints from the first whitelist.** Chat, comments, searches, metadata and library need endpoint-aware coherence. A generic GET cache will resurrect deleted or pre-edit state.

3. **Do not defer Slice 2’s minimal provenance.** Serving an old copy without saying so is silent success. Merge the offline-copy strip into Slice 1.

4. **LRU must evict article bundles, not response records.** Once one slug has article, glossary, summary, etc., a `lastOpened` index per URL can orphan artefacts or evict the article while retaining its accessories.

5. **`Response.clone()` cannot recover from a body that fails after headers.** `fetch()` has already resolved by then, so the fallback wrapper never sees the failure.

## 1. Minimal safe Slice 0

Leave useSession.ts (`src/web/useSession.ts:64`) and the App gate (`src/web/App.tsx:129`) unchanged.

In `apiFetch`, the order should be:

1. Validate `/api/`.
2. Determine method and exact cache eligibility.
3. If `navigator.onLine === false`:
   - Cacheable GET: read cache using the current in-memory authenticated user id.
   - Any write: reject with a specific offline-write error.
   - Do not call Supabase or `fetch`.
4. Otherwise call `getSession()` with one named, tested auth-acquisition deadline.
5. If auth times out:
   - Cacheable GET with a known current user: return its cached copy.
   - Otherwise reject; do not send an anonymous request.
6. Make the network request.
7. On transport rejection only, try the cache. Never on abort or any HTTP response.
8. Preserve the existing one-refresh/one-retry 401 behavior exactly.
9. Cache a successful response under the `user.id` belonging to the session that authorized it—not a “last user” pointer.

Supabase documents that `getSession()` refreshes when necessary, confirming why the deadline is needed. [Supabase `getSession`](https://supabase.com/docs/reference/javascript/auth-getsession).

Must not change:

- Callback-before-gate ordering.
- Normal online `getSession()` per request.
- Existing header/body/signal preservation.
- One 401 refresh and retry.
- No sign-out merely because one request returns 401.
- No cached fallback after 401/403/404/410/500.
- No offline write success simulation.

At inspection time, the concurrent WIP still awaits `accessToken()` before any offline check at api.ts (`src/web/lib/api.ts:243`); that preserves the original hang.

## 2. Persisting the user id

It is safe only as a cache-partition selector. It is not authentication.

If eventually needed for SW-backed cold launch:

- Put a versioned opaque user id in `localStorage`; it is tiny and must be read synchronously.
- Store no email, token, refresh token, session object, or authorization claim.
- Keep bodies in IndexedDB.
- Clear the pointer synchronously on `SIGNED_OUT`; delete that user’s cache best-effort.
- Replace it atomically when account B signs in.
- Never fabricate a Supabase `User` from it.

Shared-iPad failure: if A closes the browser without signing out, another person can read A’s cached material offline if the gate trusts that pointer. Remote revocation cannot be checked offline. That is inherent “remember this device” behavior, not something partitioning fixes.

Therefore defer this until the service worker decision. If built later, `offline-known-user` should unlock only cached article routes and a filtered offline shelf—not Profile, Add, jobs, or writes.

## 3. The whitelist

One object store is not the correctness problem; one policy is.

Start with:

- `/api/article/:slug`
- `/api/summary/:slug`
- `/api/ideas/:slug`
- `/api/tweets/:slug`
- `/api/glossary/:slug`, only if reset and lookup explicitly refresh/invalidate it

Cut for now:

- `/api/chat/:slug`
- `/api/comments/:slug`
- `/api/search/:slug`
- `/api/metadata/:slug`
- `/api/library`

Why:

- Chat/comments/search are mutated by streams, optimistic deletes, renames and recolouring.
- A successful mutation does not automatically produce a later GET.
- Jobs mutate glossary/summary/ideas/tweets through `/api/jobs`, not the artefact URL.
- Library PATCH affects library, article title and metadata.
- The open-counter POST would constantly invalidate `/api/library`.
- Invalidating after every write avoids stale data but often deletes the only offline copy.

Add mutable data later with endpoint-specific cache patching or a canonical refetch after mutation completion. Do not build a generic invalidation graph.

`/api/library` specifically depends on the deferred “intersection with cached article bodies” filter. Either build that filter with it or defer both.

## 4. Cache writes

Your basic rules are right, with additions:

- Accept exactly status 200.
- Parse the media type exactly, allowing parameters such as `application/json; charset=utf-8`; do not use a loose substring match.
- Validate that the body really is JSON before replacing a known-good entry.
- Wrap synchronous `clone()` failure and asynchronous clone/body/IDB rejection.
- Cache failure must never fail the network response.
- A quota failure must retain any previous good copy and must not mark the new response as available offline.
- Prevent slower, older asynchronous writes from overwriting a newer response.

IndexedDB is asynchronous, but structured cloning large objects can still happen on the main thread. A 150KB write is probably acceptable, but only a real iPad measurement can establish that. [IndexedDB performance guidance](https://web.dev/articles/indexeddb-best-practices-app-state?hl=en).

The body-mid-read limitation needs an explicit decision:

- Cheapest: document that Slice 1 falls back only when `fetch()` rejects before headers; preserve the previous cache if the new body dies.
- Stronger: buffer cacheable JSON responses inside `apiFetch`, then return a reconstructed unread `Response`. This catches mid-body failure but changes `apiFetch` semantics more substantially.

I would take the cheaper version initially.

## 5. Ordering

Recommended order:

1. `apiFetch` fast failure and centralized offline-write refusal.
2. Narrow cache plus minimal offline-copy provenance.
3. Derived artefacts.
4. Offline shelf filtering and `/api/library`.
5. Mutable reader-owned endpoint coherence, only if its value justifies it.
6. Service worker plus persisted offline identity.
7. ETags.

ETags and the service worker are not Slice 1 dependencies. The library filter is a dependency of caching `/api/library`.

## 6. Ongoing friction

The lasting costs are:

- Maintaining the endpoint-policy registry.
- Mutation-to-cache coherence across jobs and streams.
- IndexedDB schema migrations and multi-tab upgrades.
- Account-switch/sign-out privacy.
- Article-group LRU accounting.
- Proving whether the UI is showing network, React memory, or IndexedDB.
- Later service-worker/client-version compatibility.

Simplify now by using one retention rule—such as 100 distinct article bundles—instead of both record count and approximate serialized bytes. A small manifest store for article-level LRU is cleaner than loading or sorting response bodies.

The `idb` choice is correct: its official API supports typed indexes/cursors, while `idb-keyval` explicitly directs indexed use cases to `idb`. [idb](https://github.com/jakearchibald/idb), [idb-keyval](https://github.com/jakearchibald/idb-keyval). No TanStack Query is also correct.

`vite-plugin-pwa` with `injectManifest` is reasonable later; it compiles a custom worker and injects the asset manifest. Recheck the package when Layer 2 begins rather than installing it now. [Official injectManifest guide](https://vite-pwa-org.netlify.app/guide/inject-manifest).

## 7. Tests that matter

Slice 0:

- Offline false is checked before `getSession`; assert `getSession` and `fetch` were never called.
- Unresolved `getSession` reaches fallback by the fake-timer deadline.
- Auth timeout never sends an anonymous request.
- Ordinary online request still obtains the session every time.
- 401 refreshes and retries exactly once.
- 401/403/404/410/500 never read cache.
- Caller abort during token wait or fetch never reads cache.
- A response authorized as user B is never written under stale pointer A.
- `SIGNED_OUT` clears active cache identity synchronously.

Slice 1:

- Exact whitelist matching; prefix lookalikes and `/api/library/search` fail.
- Only 200 JSON GET writes.
- JSON with charset works; HTML and malformed JSON do not replace cache.
- Caller can still read the original response body.
- Clone failure, body-read failure and `QuotaExceededError` leave the network response usable.
- Transport rejection uses cache; cache miss preserves the original error.
- User A data is invisible to user B.
- LRU evicts every response for one slug together.
- A newer asynchronous write cannot be overwritten by an older one.
- Unmount/remount a hook before testing fallback, proving the result came from IndexedDB rather than React state.
- A successful delete/edit either updates the cache or, for endpoints cut from Slice 1, proves they are not cacheable.

Vitest needs:

- `fake-indexeddb` or an injected fake `IDBFactory`; Node/jsdom does not provide IndexedDB.
- Stubbed configurable `navigator.onLine`.
- A mocked Supabase singleton capturing `onAuthStateChange`, `getSession`, and `refreshSession`.
- Fake timers for auth deadlines.
- A custom failing `ReadableStream` for the mid-body case.
- jsdom only for hook/App tests; storage-policy tests can remain Node tests.

Finally, the band claim is directionally right but overstated. The six bands are conditionally mounted at App.tsx (`src/web/App.tsx:1326`), but comments, chat-anchor summaries and glossary terms already fetch when `Reader` mounts at App.tsx (`src/web/App.tsx:621`). Summary mode still has the tree’s free gist rung offline; Diagram’s default tree also fetches nothing. Full chat, ideas, saved searches, longer summaries and the richer glossary panel do remount and refetch, so the underlying motivation remains valid.

