# Preload the most recently opened shelf articles

Status: **built, 2026-10-03** (see § What was built; the names in the earlier sections are the draft's). Report spya-j78fff, Overseer queue item qi-knrdvcxk.

The ask, from Greg, 2026-09-29 (the whole report is in the user-feedback note):

> if I've been reading an article and then I click to go back to the home page, and then I click on
> the article again, it still takes a few seconds to load … when I go to the home page, it would be
> great to sort of preload somehow the top five articles if they haven't already been loaded and
> refresh them if they have, so that if I click any of the top five articles in my shelf … that they
> load effectively instantly. Like, that would be cool so long as it doesn't create too much
> complexity or risk of bugs.

and, about offline: *"if that's still true, let's hold off."* It is still true, so offline stays
deferred ([260827r-offline-reading.md](260827r-offline-reading.md), slices 3–5).

## Where the seconds go

Opening an article from the shelf is a client-side navigation (`Link` → `navigate`), and the reading
view's code is in the main bundle, so no chunk downloads. What the reader waits for is one chain,
`useArticleAccess` → `findArticle` (`src/web/article/access.ts`):

1. `apiFetch` gets the token and reserves an IndexedDB ticket.
2. **`GET /api/article/<slug>`**: a serverless function, a JWT check, three queries and about 150KB
   of JSON (every block's HTML, the tree, the arc). This is the slow part, and the only part that
   needs the network.
3. Sanitising, maths (a `temml` chunk, only if there is TeX), and PDF figures, which are fetched
   through `/api/asset/…`. Those are `immutable` and the browser's HTTP cache already serves them
   on a second visit.

Nothing is kept between visits. Leaving for the shelf and coming back re-runs all of step 2. The
IndexedDB copy that `apiFetch` writes is read back only when the network itself fails.

## What we're building

**When the shelf has its live list, fetch the five most recently opened articles' payloads into
memory. When the reader opens one of them, the reading view takes that answer instead of asking the
server.**

```
shelf loads ──► live list ──► idle ──► GET /api/article/a ─┐
                                       GET /api/article/b  ├─► slots: {owner, slug, promise, issuedAt, generation}
                                       … (top 5 by lastOpenedAt)
click "a" ──► findArticle ──► takePrefetched("a")
                                ├─ a slot that's usable → its response; the slot is deleted
                                └─ none / too old / a write since / another reader / not 200 → normal fetch
```

The rules that keep it free of staleness and visual artefacts:

- **One use, then gone.** A slot is deleted when it is taken. Opening the same article again without
  passing through the shelf fetches as today. Every visit to the shelf refreshes all five, which is
  Greg's *"refresh them if they have"*.
- **Never painted twice.** The reading view draws the prefetched payload as its one and only first
  draw, exactly as if the server had just sent it. There is no stale-then-fresh swap, so there is
  nothing for the eye to catch.
- **A short life.** A slot older than **60 seconds** is ignored (two minutes in the first draft, see below). The case in the report is
  "back to the shelf, then straight back in", which takes seconds.
- **A write throws them all away, unless it is on a short list of writes known not to touch an
  article's payload.** A counter goes up whenever a non-GET is sent through `apiFetch` or
  `leavingFetch` (on send *and* on completion), and a slot made under an older count is ignored. A
  list of *affecting* writes would go silently stale the day someone adds one (a rename is
  `PATCH /api/library/<slug>`, and archiving and sharing are other routes; none of them name
  `/api/article/`). So the list is the other way round: **writes that leave every article payload
  current**. If it is wrong, the cost is a lost preload, never a stale article.

  Without the list, the feature would fail for exactly the case in the report. Leaving an article
  sends writes of its own: the reading-time flush (`POST /api/reading-time/…` via `leavingFetch`),
  the open record (`POST /api/library/<slug>/open`), and any comment or chat still saving. Those can
  finish *after* the shelf has issued its prefetches, and would discard the very article the reader
  is about to reopen. The candidates are `/api/reading-time/`, `/api/library/<slug>/open`,
  `/api/comments/`, `/api/chat/`, `/api/quiz/`, `/api/feedback` and `/api/reader`. Each is to be
  checked against what `GET /api/article/<slug>` returns (`meta`, `blocks`, `tree`, `arc`,
  `assets`, `visibility`, `archivedAt`, `sourceGuess`, `highPowerSince`). One test drives that
  flow, a prefetch and then a reading-time flush landing, and asserts the slot survives. A second
  asserts that a rename does not.
- **Whose it is.** A slot records the owner it was fetched for (from the same `accessToken()` answer
  `apiFetch` uses) and is taken only by the same owner.
- **Only a 200 counts.** A 401, 404, 409 or a network failure in the prefetch is discarded, and the
  reading view asks for itself. The prefetch never decides what an error page says.
- **It costs the reader nothing when it misses.** `takePrefetched` gives an answer straight away or
  `null`; an in-flight prefetch is awaited (it is the same request the reader would otherwise make,
  already under way). If it fails, the normal fetch follows.

Being polite about it: the prefetch starts only after the live shelf has arrived, in an idle
callback, all five at once (the draft said two at a time; see § What was built). It is skipped under `navigator.connection.saveData`.
Articles never opened (no `lastOpenedAt`) are not candidates, and nor are archived ones. The
prefetch goes through `apiFetch`, so it also refreshes the offline copy as a side effect, and
nothing about that store changes.

## After GPT Sol's plan review

The review is
[261003d-preload-recent-shelf-articles-review-sol.md](261003d-preload-recent-shelf-articles-review-sol.md).
It said not to build the plan as written. What changed:

- **P0, the owner.** A separate owner lookup beside `apiFetch` can label B's response as A's
  during an account switch. Now `apiFetch`'s body becomes `apiFetchOwned`, which returns
  `{ response, owner }` with the owner of the credential that *actually* answered, retry included.
  `apiFetch` is that, minus the owner. The slot keeps that owner. The reading view passes the
  `readerId` it already has down to `findArticle`, and a slot is taken only on an exact match.
- **P1, an offline copy is not a preload.** `apiFetch` answers a transport failure with a synthetic
  200 marked `x-spideryarn-offline: copy`. A slot holds only a real 200 without that header.
- **P1, the trigger was too late.** The shelf paints from its cached copy first, and
  `liveArticlesLoaded` waits for the network, so a quick click beat the prefetch. The trigger is
  now "the shelf has a list", cached or live. It runs again when the list changes, and an article
  prefetched in the last 15 seconds is not asked for again. The article request itself is always
  live.
- **P1, the staleness was overstated.** A pipeline run that publishes, or a rename in *another*
  tab, moves nothing on this page. Such a change can therefore be up to a slot's life old. **The
  life is now 60 seconds, not two minutes.** That is the same kind of staleness as an article
  left open in a second tab, which also never refreshes itself. Sol suggested 15–30 seconds. I
  chose 60 because the report's case ("back to the home page, then click") includes looking at
  the shelf for a moment, and 15 seconds would miss much of it.
- **P2, the exemptions are exact.** They are no longer prefixes. Only two shapes are exempt:
  `POST /api/library/<slug>/open` and `POST /api/reading-time/<slug>`, the writes that leaving an
  article always sends. Every other write drops every slot.
- **P2, aborts.** Each slot has its own `AbortController`. A slot dropped by a new batch, a write
  or expiry is aborted. A taken slot is aborted when the article load's signal is. The Library's
  effect cancels its pending idle callback on unmount.
- **P2, one slot vs five, not taken.** Sol suggested a single slot for the most recent article.
  Greg asked for the top five, and the extra four are a loop rather than a mechanism, so it stays
  five.
- **P2, tests that cannot pass while the feature does nothing.** Added: a test across the
  Library's prefetch hook and `findArticle` that counts article requests (exactly one, made by the
  prefetch), a new batch dropping old slots, and `leavingFetch` moving the counter.

## Where the code goes

- **`src/web/lib/prefetch-article.ts`** (new, about 100 lines): `prefetchArticles(slugs)`,
  `takePrefetched(slug)` and the slot map, plus `noteWrite()` for the counter. It is the whole
  feature in one module, so deleting it is one file and two call sites.
- **`src/web/lib/api.ts`**: call `noteWrite(path)` for every non-GET through `apiFetch` and `leavingFetch`, before sending and on completion,
  and export the owner lookup the slots need.
- **`src/web/article/access.ts` § `findArticle`**: `(await takePrefetched(slug, owner)) ??
  (await apiFetch(…))`, owned route only.
- **`src/web/Library.tsx`**: one effect. Once `shelf.liveArticlesLoaded`, take the top five by
  `lastOpenedAt` and call `prefetchArticles`.

Tests (`tests/prefetch-article.test.ts`), each to be seen red first:

- a taken slot is gone, and a second take returns `null`
- a slot older than the TTL, from another owner, issued before a write, or holding a non-200 →
  `null` (the normal fetch runs)
- a rejected prefetch → `null`, not a throw
- `findArticle` uses the prefetched response and makes no request of its own
- a non-GET through `apiFetch` bumps the counter, which `api.ts`'s own test asserts

## Passed over

- **Stale-while-revalidate from the IndexedDB copy.** The shelf already does this, and it would make
  even a cold open instant. But it paints an old article and then swaps in the new one. That swap
  is the *"weird visual artifacts"* Greg named, and for an article it can move the text under the
  reader's eyes (a re-run structure, a re-extracted block). Rejected for this report. It's worth
  revisiting only alongside offline.
- **HTTP caching (`Cache-Control: max-age` / ETags on `/api/article/`).** Generic, but the payload
  changes when the pipeline re-runs or the reader renames. A max-age would serve a stale article
  with no way for us to invalidate it on a write. An ETag still pays the function's cold start and
  the queries, which is most of the wait.
- **A service worker.** It belongs to offline, which stays deferred.
- **Prefetching on hover.** Cheaper per article, but it misses touch screens, and a hover gives
  about 200ms, which doesn't cover a multi-second load. Greg asked for the top five.

## Deferred, named

- PDF figures and the maths chunk are not prefetched. The browser caches both after the first visit,
  which is the case in the report.
- The ~10 side requests the reading view makes after the prose is drawn (glossary, comments, chat…)
  are not prefetched. They don't hold back the prose.

## What was built

- **[`src/web/lib/prefetch-article.ts`](../../src/web/lib/prefetch-article.ts)** has
  `preloadArticles(slugs)` and `takePreloaded(slug, readerId, signal)`, and the rules are in its
  header.
- **[`src/web/lib/writes.ts`](../../src/web/lib/writes.ts)** holds the write count and the two
  exact exemptions. It is a module of its own so that `api.ts` and the preload don't import each
  other.
- **[`src/web/lib/api.ts`](../../src/web/lib/api.ts)**: `apiFetchOwned` returns
  `{ response, owner }`, and `apiFetch` is that minus the owner. Both it and `leavingFetch` count a
  write on sending and again on finishing.
- **[`src/web/usePreloadRecent.ts`](../../src/web/usePreloadRecent.ts)** is called once from
  `Library`, with the cached or live list.
- **`findArticle`** now takes the `readerId` rather than a boolean. So does `resolveAccess`; its
  three test callers changed with it.

**All five go at once, not two at a time.** A queue would have added a third state for a slot,
"asked for but not yet sent". A click on that article would then wait behind somebody else's
request, or need the slot to be promoted. Five GETs over one HTTP/2 connection, in an idle
callback after the shelf has drawn, cost less than that mechanism.

**Seen red.** `tests/prefetch-article.test.tsx` has 16 tests. Each rule was broken in turn by a
script, and for each one at least one test went red: the feature switched off, no owner check,
offline copy accepted, no exemptions, `leavingFetch` not counted, no count on completion, no
lifetime, no abort link, not single-use, archived rows included. The `leavingFetch` one first
survived, because the stubbed write finished at once and the count on completion hid the missing
count on sending. That test now holds the write open.


### StrictMode hid it twice, and only a real browser saw it

A Sonnet browser check on the box (Playwright, local sign-in, request log) found that in
`npm run dev` the reading view **still asked the server on every click**, while all sixteen tests
were green. `<StrictMode>` runs effect, cleanup, effect, synchronously. The first version took the
slot out of the map and aborted it with the load: the first effect run took it, the cleanup killed
it, and the second run, the one the reader sees, found nothing. The second version put the slot
back on abort, but a microtask later, after the second run had already looked. The test for it had
an `await` between cleanup and the second run, so it passed; the browser didn't.

What was built in the end: **the slot stays in the map while a load waits on it**, marked with that
load's signal. A later load adopts it once that signal has aborted, and it leaves the map only when
its answer is handed over. The test now runs effect, cleanup, effect with no `await` between them.
It went red against the second version, as the browser had. Nothing aborts a preload on the reading
view's behalf any more, because it is not the reader's request to cancel. It ends by the usual
rules.

That change opened a hole, which the mutation script found: without the delete on handover, a slot
whose first load had since been released (leaving the article does that) became adoptable again.
It held a body already read, and the next open would have drawn an error page. The single-use test
now releases the first load before opening again.

With StrictMode rewritten out of the page, the check passed: no article GET on a preloaded click,
on a second click after going back to the shelf, or on a second preloaded article. The control (an
article that was not preloaded) did send its GET.

### What the preload does not buy, measured in the dev build

Locally, click-to-prose was **1.1–1.4s preloaded against 1.7s not**. The local server answers the
article GET in a few hundred milliseconds, so locally the preload saves only that. In production,
that GET is the serverless cold start and the seconds Greg reported. A CPU profile of a preloaded
click shows the rest is the reading view's first render. Nothing in it waits on the network (PDF
figures go out but are not waited on, and there is no auth call). It is CPU: about 650–950ms of
React's development build (`jsxDEV`, `createElement`, prop validation), 70ms of forced layout from
`clientWidth`, and 40–55ms of DOMPurify. The development-only part disappears in a production build.
How much of the remainder is left is unmeasured. That is the next place to look if a preloaded open
still feels slow in production. It is a property of the reading view, not of loading, so it is
outside this report.
