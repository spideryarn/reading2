# Reading offline

Status: **Slices 0, 1 and 2 built, 2026-08-27** — see § What was built. Slices 3–5 not started.
Written 2026-08-27. GPT Sol's review of this proposal is in
[offline-reading-review-sol.md](offline-reading-review-sol.md) and its findings are folded in below.

The ask, from Greg, 2026-08-27:

> We would like things to work reasonably well offline (e.g. if the user has internet, is looking at
> an article, and then loses internet, and wants to keep reading etc). Or even better, if the user is
> on one article, loses internet, and wants to be able to click to the Homepage and then open another
> that they had previous open while they had internet…
>
> I realise that it might be a lot of work to make this work perfectly. We're interested in the 80-20
> solution.

## The question that prompted this, answered first

> One question: would it help much if we were using Supabase.js? We had decided to use Drizzle
> instead, but if that would help, maybe that is a reason to reconsider that decision.
>
> — Greg, 2026-08-27

**No. Keep Drizzle.** Two independent reasons, either one sufficient.

**The choice is server-side and invisible to a reader.** The browser never talks to Postgres. It
asks `/api/*` for JSON and the server decides how to fetch it —
[postgres-migration.md § "Data" runs server-side only](postgres-migration.md) is explicit that the
module owning the Supabase client exports auth calls and nothing else, no `.from()` and no `.rpc()`
anywhere in the client. Changing the library the *server* uses to reach Postgres changes nothing
about what an offline *browser* possesses.

**`supabase-js` has no offline story to borrow.** It persists the auth session, not query results.
There is no local cache, no queued mutation, no replay — nothing comparable to Firestore's offline
persistence. Supabase's own answer to the question is to point at third-party sync engines; their
most-upvoted discussion on offline is still open, and the direction stated there is better
integration with PowerSync, Electric and Zero rather than native client persistence.

The cost of reversing, for completeness: roughly ten `src/store/pg-*.ts` modules to rewrite, and the
four transactional operations (publish, block insertion, queue claiming, article reads) would go
back to being PL/pgSQL RPCs — which is the exact thing
[the Drizzle decision](postgres-migration.md) existed to delete. *"That is the tail wagging the
dog."* Several weeks, for zero offline capability. And moving application data into the browser
directly — exposed views, RLS, a new security boundary — would still need the same cache and the
same service worker on top.

**Offline is a browser-caching problem, and it sits entirely above the storage layer.** Nothing in
the Postgres migration blocks it or is blocked by it.

The heavyweight sync engines (PowerSync, ElectricSQL, Zero, RxDB) are also cut. Every one means a
second stateful service, a SQLite or wasm replica in the browser as the primary data layer, and
routing around `/api` — weeks of rearchitecture to solve general offline read+write with merge
semantics, for an app whose only writes are renames and read-state.

## What makes this cheap here

Three properties of the current design, none of them accidental:

```
   44 call sites  ──►  apiFetch()  ──►  fetch()  ──►  /api/*
   (every hook)        api.ts:227
                            ▲
                       one function
```

- **One choke point.** Every client API call goes through `apiFetch` ([`src/web/lib/api.ts`](../../src/web/lib/api.ts)).
- **Reading position is in the URL**, not on the server — see [url-state.md](../project/url-state.md).
  There is no scroll state to sync, which deletes the hardest part of most offline features.
- **Prose needs exactly one call.** `GET /api/article/:slug` returns `{ meta, blocks, tree, arc? }`,
  about 150KB. Glossary, summaries, ideas, chat and search are separate, reader-initiated, and
  nothing fires a model call on page load.

And one property that makes it harder than the choke point suggests: **the whole app is gated on
auth**. `App()` renders `null` until `useSession` settles ([`App.tsx:131`](../../src/web/App.tsx)),
and `useSession` gives up after `SETTLE_MS = 8_000` and shows the sign-in screen
([`useSession.ts:64`](../../src/web/useSession.ts)).

## The trap that has to be fixed first

**Offline, an hour into a session, every API call hangs for ~25 seconds and then reports an auth
error.** Not "you are offline" — an auth error.

`apiFetch` awaits `supabase.auth.getSession()` before every request
([`api.ts:242`](../../src/web/lib/api.ts)). The installed client treats a token within a 90-second
margin as expired and attempts a refresh with exponential backoff — 200ms, 400ms, 800ms… — bounded
by `AUTO_REFRESH_TICK_DURATION_MS`, which is 30 seconds
(`node_modules/@supabase/auth-js/dist/module/lib/constants.js:3`). Offline every attempt fails
instantly, so it burns about 25 seconds of backoff, gives up, sends the request with no token, and
`apiFetch` returns the resulting 401 to the caller.

Sol found the worse half: on a **cold** offline launch this happens *before* the app renders
anything, `useSession` times out at 8 seconds, and the reader lands on the **sign-in page** — with
a perfectly good cached article sitting in IndexedDB that nothing ever asked for.

So the auth path is not a detail to tidy up afterwards. It is the first thing to build:

- Persist the last successfully authenticated **user id** under our own control.
- Model auth as four states, not two: `checking | online-session | offline-known-user | signed-out`.
- Start the article-cache lookup **before or in parallel with** Supabase initialisation, never after.
- Treat `navigator.onLine === false` as a fast-path *hint* to serve the cache immediately — never as
  proof that a request would have worked. It lies on captive portals and VPNs.
- Never turn a caller's `AbortError` into a cache fallback.
- Never fall back after an authoritative 401, 403, 404 or 410 — those are answers, and hiding them
  behind old data is the [silent-success](../reusable/silent-success.md) pattern with a reader
  attached.
- Clear or deactivate a user's cache on explicit sign-out or account switch.

"Previously authenticated on this device" is not "currently authorised by the server". Letting a
reader read with an expired token is a product decision, and it should be made deliberately.

## The two layers

**Layer 1 — cache in the page, at `apiFetch`.** Write-through into IndexedDB on a successful GET of
a whitelisted read endpoint. Records look like:

```
{ userId, url, body, etag, savedAt, checkedAt, lastOpened, bytes }
```

Network-first while the network is healthy: `200` validates and atomically replaces; `304` keeps the
body and updates `checkedAt`; a transport failure or a selected 5xx serves the saved body; 401/403/
404/410 pass straight through.

**Start with `GET /api/article/:slug` only.** Not every successful GET. `/api/library` can follow,
but the offline shelf must show **the intersection of the cached shelf and the article bodies we
actually hold** — a shelf full of dead links is worse than a short one.

**Layer 2 — a service worker, shell only.** `index.html`, hashed JS/CSS, fonts, icons, and a
navigation fallback. No `/api/*` runtime route at all. Without it, a cold load or hard refresh at
`/read/<slug>` while offline hits Vercel's SPA rewrite, gets nothing, and shows the browser's error
page — React never boots, so layer 1's cache never runs.

### Why the API data is in the page and not the worker

My first reasoning for this was wrong and worth recording so nobody repeats it: I claimed a service
worker cannot carry the bearer token because it cannot read `localStorage`. **A worker receives the
complete `event.request`, `Authorization` header included, and can forward it** — a 401 comes back
to `apiFetch`, which refreshes and retries as it already does.

The real reasons still hold, and they are better ones:

- **Cache Storage is origin-scoped**, shared by every account using the same browser profile, and
  `Cache.match` keys on URL/method plus response `Vary`. There is no stable user partition for free.
- **Keying on the bearer token breaks when the token rotates**; keying on URL alone crosses accounts.
  Either way the worker needs custom key logic or a user-id handshake from the page.
- **The worker sees nothing until the page calls `fetch`** — and today `apiFetch` waits on Supabase
  first. The auth hang above happens entirely upstream of the worker.
- The page layer *knows* it served a saved copy, so the banner is a fact rather than a guess from
  `navigator.onLine`.

## What the reader sees

Per [copy.md](../project/copy.md) — say what happened, say whose problem it is, say what to do next,
and carry a bracketed code so a test need not pin prose:

> Spideryarn couldn't reach its server. Showing the copy saved on 14 August. Reconnect to check for
> changes. `[offline-copy]`

Call it an **offline copy**, not "stale" — *stale* already means an artefact/article mismatch
elsewhere in this app and reusing it would collide.

If reconnecting finds a changed ETag, **do not replace the article under the reader.** Offer *"A
newer version is available — reload when ready."*

## What already works offline, and what does not

Established by reading the code, 2026-08-27 — the Claude-in-Chrome extension was not connected, so
this has not yet been watched happening in a browser.

Greg's impression was that things *"seemed to work ok within an article for at least the things I'd
already downloaded"*. Half right, and the other half is the best argument for doing this at all:

```
  offline, article already open on screen
  ---------------------------------------
  keep reading the prose            works   (held in React state)
  the ToC / tree                    works   (arrives inside the article payload)
  scroll, zoom columns, up/down     works   (all client-side)
  switch to the summary band        BREAKS  (panel remounts, refetches)
  switch to glossary, ideas, chat   BREAKS  (same)
  go Home, come back                BREAKS  (whole page remounts)
```

Every band is mounted only while it is open — `{mode === "glossary" && …}`
([`App.tsx:1289`](../../src/web/App.tsx)) — and each fetches on mount. That is deliberate and the
reason is good: *"`useSummaries` fetches on mount, and calling it up in `Reader` would charge every
reader of every article a request for a panel almost none of them will open"*
([`App.tsx:2088`](../../src/web/App.tsx)). The consequence is that everything already computed for
the article in front of you — glossary, summaries, ideas, chat history — is one band-switch away
from an error, offline.

So the cache earns its keep even in the narrowest case Greg cares most about: the document already
open.

## Libraries

Chosen against [third-party-library-selection.md](../reusable/third-party-library-selection.md),
whose first criterion is a long-lived, heavily-documented community.

**`idb`** — Jake Archibald's promise wrapper, 1.4KB gzipped, 24.5M weekly downloads, the wrapper MDN
and web.dev reach for and the one Workbox and Firebase use internally. We need one thing beyond
get/put: **order by `lastOpened`, for eviction**. That needs a real IndexedDB index, which rules out
`idb-keyval` (0.8KB but a single store with no indexes — an LRU pass would have to load every cached
article body into memory to sort them, defeating the size cap). `dexie` is excellent and actively
maintained but is 31KB of schema-migration and live-query machinery we would not use.
`localforage` is out: last release 2021, still references WebSQL, which browsers removed.

**`vite-plugin-pwa`, in `injectManifest` mode — later, only if layer 2 happens.** Its peer range
covers Vite 8. The one part worth not hand-rolling is the precache manifest of Vite's hashed
filenames, which has to be re-derived correctly on *every* deploy and fails silently when it isn't.
The fetch handler itself we write by hand, because the rules that matter — deny `/api/`, no
`skipWaiting`, the kill switch — are ours.

**Nothing else.** Online/offline detection is ~20 lines of `useSyncExternalStore` over the `online`
and `offline` events, and no generic hook would fit the four-state auth machine anyway. The cache
policy is ~50 lines against `idb`; the purpose-built "fetch with an IndexedDB fallback" packages are
all single-maintainer or the wrong shape, and none encodes our rules (401/403/404/410 pass straight
through, never fall back after an `AbortError`).

**Not TanStack Query — and this is the one worth explaining.** By the community criterion it is the
best-represented library in the entire search, and it would replace ten hand-rolled hooks that each
reinvent loading and error state. But it conflates two jobs: *make articles readable offline*, which
is a change to one function, and *stop every feature hand-rolling its own hook*, which is a real but
separate refactor nobody has asked for. Doing both at once turns a 4–6 day feature into a much
larger one, against code that already works. It interoperates with a plain `apiFetch` as its
`queryFn`, so it can be adopted for **new hooks only** later, with no forced migration — a separate
conversation.

## The plan, ordered by ease against value

### Slice 0 — make the offline failure fast and honest *(half a day)*

Cheapest thing here, fixes a real bug today whether or not anything else gets built, and nothing else
works without it. Today an offline reader an hour into a session waits ~25 seconds and is then told
their credentials are bad.

- Do not enter a token refresh that cannot succeed. Treat `navigator.onLine === false` as a hint to
  skip it, and put a short deadline on the attempt regardless.
- Persist the last authenticated user id ourselves, so "we know who you are and cannot reach the
  server" is representable.
- Let the app render for a known user without a live session, rather than timing out into sign-in.

### Slice 1 — the cache *(~2 days)*

- One `idb` store, records `{ userId, url, body, savedAt, lastOpened, bytes }`, `lastOpened` indexed.
- Write through on a **200 JSON** response to a whitelisted GET. Never cache a non-200 — a 404 from
  `/api/glossary/:slug` is the ordinary "not generated yet" answer and must not be frozen in.
- Read back **only** on a transport failure. Not on 401/403/404/410, not on an `AbortError`.
- Whitelist: `/api/article/:slug` and the per-article artefacts Greg named — glossary, summary,
  ideas, metadata, tweets, chat, comments, searches — plus `/api/library`.
- Do not cache `/api/library/search`, `/api/jobs`, `/api/models`.
- Evict least-recently-opened past 100 articles or 50MB.
- Suppress the open-counter `POST` and other fire-and-forget writes while offline.

### Slice 2 — say so *(half a day)*

One strip for the connection, one line on the article for its saved date. Driven by what actually
happened to requests, never by `navigator.onLine` alone.

### Later, in this order

3. Offline Home lists only articles whose bodies we actually hold.
4. Content-derived ETags and `304` handling, so a cached copy can be checked rather than trusted.
5. The shell service worker, for reload and cold start.

## What was built

Two Sol reviews, the second of them
[offline-reading-slices-review-sol.md](offline-reading-slices-review-sol.md), on the sliced plan
above. Slices 0, 1 and 2 landed together, because Sol's third finding was that shipping the cache
without the strip is exactly the silent success this repo keeps writing postmortems about.

- **[`src/web/lib/offline-store.ts`](../../src/web/lib/offline-store.ts)** — the IndexedDB store.
  Records are keyed on `${userId}\n${url}`; eviction is by **article**, not by response.
- **[`src/web/lib/api.ts`](../../src/web/lib/api.ts)** — the auth deadline, the cache read on
  transport failure, the write-through, and invalidation after a successful mutation.
- **[`src/web/offline.ts`](../../src/web/offline.ts)** — connected, and reading-a-copy, kept as two
  facts rather than one.
- **[`src/web/OfflineStrip.tsx`](../../src/web/OfflineStrip.tsx)** — the one line at the bottom.
- Tests: `tests/api-fetch-offline.test.ts` (order of operations, `apiFetch`'s cache mocked) and
  `tests/offline-store.test.ts` (the store, against a real IndexedDB via `fake-indexeddb`).

### Where this diverged from Sol's review, and why

**Kept the wider whitelist, and added invalidation instead.** Sol wanted chat, comments and saved
searches cut from the first slice, because they are lists the reader mutates and a cache kept past a
delete resurrects what they deleted. That risk is real, but the ask was explicit —

> I'm hoping that stuff that has already been computed (e.g. existing ToC, glossary, summary, ideas,
> chat history, etc etc) will be available?
>
> — Greg, 2026-08-27

— so rather than drop them, any successful non-GET now clears the cached reads under the same
resource prefix. `DELETE /api/chat/<slug>/<thread>` clears `/api/chat/<slug>`. The cost is the one
Sol named and it is accepted rather than solved: delete a comment and immediately lose your
connection, and you have no cached comments for that article until you are back online. A worse
offline experience and a correct one.

**Kept `/api/library`, and built the filter with it.** Sol said either build the
cached-shelf-intersection filter or defer both. Built it: `onlyWhatWeHave` in `api.ts` filters the
cached shelf through `cachedSlugs()`, which asks the database rather than trusting a flag. A shelf
that lists articles it cannot open is worse than a short one.

**Did not build the offline-known-user gate**, exactly as Sol recommended — `useSession.ts` and the
`App()` gate are untouched. The stored user id partitions the cache and nothing else; it is not an
authorisation and there is no path by which it becomes one. That decision comes back with the
service worker, if it does.

**Took the cheap answer on a body that dies mid-read.** `apiFetch` falls back only when `fetch()`
itself rejects. A body that fails after its headers arrived leaves the previous copy alone rather
than replacing it with half a document — but it is not rescued. Buffering every cacheable response
to fix that would change what `apiFetch` returns for every caller, which is not an 80/20.

### Two bugs found by testing, both worth keeping

**Three "does not save…" tests could not fail.** They asserted `writeCache` had not been called,
immediately after an `await` — but the save is deliberately fire-and-forget, so it had not happened
*yet* rather than never. Run against a `cacheable()` forced to `true`, all three still passed. They
now wait a turn first. A negative assertion about an unawaited promise is not a test.

**`tests/client-imports.test.ts` had a latent bug this was the first code to hit.** It read one
leading `../` as "this import leaves `src/web`", which is only true for a file sitting directly in
`src/web`. `src/web/lib/` is two deep, so `api.ts` importing `../offline.js` — a sibling of its own
parent, plainly inside the client — was reported as an escape. Nothing had caught it because
everything under `lib/` had until now imported only its own directory. The rule now resolves the
specifier against the importing file. Checked both ways: it still catches an import reaching outside
`src/`, and one reaching a `src/` module that is not on the shared allowlist.

## Decisions Greg made, 2026-08-27

**Cold start: build layer 1 first, decide on layer 2 later.** Nothing in layer 1 is wasted if layer
2 follows.

> **Sol disagrees, and the disagreement is worth keeping.** On desktop, cold-launch offline is
> arguably completionism. On iPadOS, suspended pages are routinely discarded under memory pressure,
> so returning to "the same app" often means rebuilding it from scratch — which makes layer 2 a
> normal reading path there rather than an edge case. Revisit once layer 1 has been lived with.

**Keep every article you open, newest kept.** Automatic, LRU by last-opened, capped at something
simple like 100 articles or 50MB. No "keep offline" button — it would promise a persistence Safari
cannot guarantee, and it asks the reader to think about it at exactly the moment they don't.

Derive "available offline" from **a live IndexedDB query**, never from a server field or a remembered
boolean, so the shelf cannot advertise an article the LRU already dropped.

**Offline writes are refused, not queued.** A clear message, nothing queued, nothing lost silently,
no sync code and no conflict resolution. Model features cannot work offline regardless.

## What a reader does not get, and should be told

- **Images and embeds are not cached.** The article JSON does not contain them. "Offline prose" is
  achievable; "the article exactly as it looked online" is not, without caching external media.
- **iPad, not installed to the Home Screen: the cache can vanish.** WebKit still deletes all
  script-writable storage — IndexedDB, Cache Storage and the service-worker registration together —
  after seven days of Safari use without interaction with the site. Not seven wall-clock days, and
  scrolling does not count as interaction. **Home Screen web apps are exempt**, which is the single
  biggest thing a reader can do to improve their own offline story.
- `navigator.storage.persist()` is implemented on iOS and worth ten lines called opportunistically
  after meaningful use — inspect the boolean and log it for diagnosis. It is a heuristic, not a
  guarantee, and it must not change what the UI promises.

Quota itself is not the problem: since iPadOS 17 WebKit advertises an origin quota around 60% of
disk. 100 articles is roughly 15MB; the built shell is about 1.7MB. **Eviction is the problem.**

## Staleness needs an identity the payload does not have

`Article` ([`src/types.ts:964`](../../src/types.ts)) carries no revision id. Prefer a **content-derived
ETag** computed identically across the filesystem and Postgres stores. A database revision UUID is
the wrong choice here: it would not exist consistently during the dual-store period, and it can
change without the payload meaningfully changing.

## Service worker and Vercel, when layer 2 happens

- Worker at `/sw.js`, root scope. Vercel gives real filesystem assets precedence over rewrites, so
  the SPA catch-all should not eat it — **verify in production anyway**, because
  [deployment.md](../project/deployment.md) records the same catch-all answering `/robots.txt` with
  `200 text/html`, which a crawler reads as *no such file*.
- Explicit `Cache-Control: no-cache` on the worker script itself.
- Navigation fallback to the precached `/index.html`; explicit denylist for `/api/`.
- **No `registerType: "autoUpdate"`** — vite-plugin-pwa makes that imply `skipWaiting` and
  `clientsClaim`, and Workbox warns it can mix an old page with newly activated assets and break
  lazy loading. Let an updated worker wait, then offer a controlled reload.
- Keep the API backward-compatible with at least the previous client: a worker can preserve an old
  bundle far longer than an ordinary deployment can.
- **Ship a kill-switch worker** at the same URL that activates, deletes only `spideryarn-*` caches,
  unregisters and reloads. A bad worker cannot be repaired on a device that stays offline.

## Effort

Sol's estimates, which are higher than my first guess of "about a day" for layer 1 — the difference
is user partitioning, the offline auth state, the local shelf, provenance UI and the tests, none of
which are optional if the thing is to be honest:

| Work | Estimate |
|---|---:|
| Bare happy-path article cache | 1–2 days |
| Layer 1 done honestly | **4–6 days** |
| Layer 2: shell, fallback, update UX, headers, kill switch, production check | **2–3 days** |
| ETag/304 across both stores | **1 day** |
| Real iPad, upgrade and failure testing | **1–2 days** |
| Credible first release | **7–10 days** |

## The tests that have to exist

This feature's whole failure mode is [silent success](../reusable/silent-success.md) — it looks like
it works because you tested it in the one state where the answer came from somewhere else.

1. Warm article, offline: prove separately that it came from React memory, and that it came from
   IndexedDB. These are different code paths and one masks the other.
2. Offline Home lists **only** articles whose bodies are actually held.
3. Hard reload `/read/<slug>` offline with `navigator.serviceWorker.controller` present.
4. Terminate Safari, airplane mode, cold launch.
5. Force the token expired, then check cached prose appears **promptly** — not after 8 or 25 seconds.
6. User A → sign out → user B → offline: no cross-account article.
7. Cache write throws `QuotaExceededError`: the UI must not claim the article is saved.
8. API returns 200-with-HTML, 401, 404, 500, an aborted request, and a body that dies mid-read.
9. Deploy a new shell with an old tab open: no mixed bundle.
10. Request `/sw.js` in production and assert status, content type, a body marker, cache header and
    root scope.

Every one of these must be watched **failing** before it is trusted. A check you have never seen go
red is not evidence.

## Also worth knowing before starting

Opening an article fires ancillary calls and the open-counter `POST /api/library/:slug/open`. Offline
mode has to suppress those, or a "working" reader quietly launches failed token refreshes and lights
up red panels around perfectly good prose.

And each feature hook owns its own loading and error state, so one transport-level cache flag does
**not** automatically produce honest UI across the app.
