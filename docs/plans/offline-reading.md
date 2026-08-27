# Reading offline

Status: **proposal, nothing built.** Written 2026-08-27. GPT Sol's review of this proposal is in
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
