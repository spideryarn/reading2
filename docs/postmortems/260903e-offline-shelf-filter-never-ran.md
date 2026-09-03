# The offline shelf filter never ran once

**Written 2026-08-27, found 2026-09-03, fixed the same day.** For a fortnight, a reader who lost the
network and went back to the homepage was shown **every article on their shelf**, including the ones
whose prose had been evicted from the local cache. Tapping one of those opened an error.

The function that exists to prevent exactly that ran on nothing, every time, for its entire life. It
was covered by a test. The test passed.

Found while tracing something else, for
[260903g-faster-shelf-load-and-tidier-homepage-controls.md](../plans/260903g-faster-shelf-load-and-tidier-homepage-controls.md)
§ Stage 2, and independently confirmed by GPT Sol.

## What happened

`onlyWhatWeHave` in [`src/web/lib/api.ts`](../../src/web/lib/api.ts) is the last step of the offline
shelf. When `fetch` itself rejects, `apiFetch` reads the saved copy of `GET /api/library` back out of
IndexedDB and filters it through `cachedSlugs()` — the articles whose blocks we really still hold —
so the shelf offers nothing it cannot open. Its own comment states the reasoning well:

> **A library page that lists articles it cannot open is worse than a short one.** Offline, every
> card is a promise, and one that opens to an error is a promise broken at the moment the reader is
> least able to do anything about it.

Its first line was:

```ts
if (!Array.isArray(body)) return body;
```

And [`src/routes.ts`](../../src/routes.ts) answers that route with an **object**:

```ts
send(res, 200, { articles: await listArticles({ archived }) });
```

So the guard matched on the first line of every call, the body was handed back untouched, and
`cachedSlugs()` was never so much as consulted. There is no failure mode here in which it partly
worked: the filter was unreachable from the day it was written.

## The root cause, and the class

The root cause is not the `Array.isArray` line. It is that **`GET /api/library`'s envelope had no
name.** `LibraryEntry` — the *element* — has lived in [`src/types.ts`](../../src/types.ts) since the
beginning and is imported by both the server (`src/store/pg-shelf.ts`) and the client
(`src/web/useShelf.ts`, `ProfilePage.tsx`, `link-facts.ts`). The object *around* it was never
written down anywhere. Instead it was hand-copied, inline, at five separate sites:

| where | what it says the body is |
|---|---|
| `src/routes.ts` — the producer | `{ articles: [...] }`, inferred, unnamed |
| `src/web/useShelf.ts` | `readJson<{ articles: LibraryEntry[] }>` |
| `src/web/ProfilePage.tsx` | `readJson<{ articles: LibraryEntry[] }>` |
| `src/web/link-facts.ts` | `readJson<{ articles: LibraryEntry[] }>` |
| `src/web/lib/api.ts` — `onlyWhatWeHave` | **a bare array** |

Four copies agreed and the fifth did not, and nothing in the language or the suite was in a position
to notice, because no two of those five ever meet. The fifth is the one that reads the body back off
IndexedDB, where it arrives as `unknown` — the one seam at which no compiler could have helped, and
therefore the one that most needed the contract to be written down.

**The class: contract drift with a vacuous test.** The producer and the consumer disagreed about the
envelope, and the test that was supposed to cover the consumer invented a *third* shape — so it was
green against code that never ran.

Both halves are needed to name it. Contract drift alone is ordinary and usually loud; something
throws. What made this one silent for a fortnight is that the drift was in a **shape-tolerant**
function, whose designed response to an unrecognised body is to do nothing and say nothing, and the
test was written from the same false premise as the code.

It belongs to the family in [silent-success.md](../reusable/silent-success.md) — *a thing reports
success while doing nothing, and the check you would naturally run agrees with it* — and it is a
particularly clean specimen, because the shared assumption is nameable in one sentence: **the author
of the test read the implementation to decide what to feed it.** Care applied through that
assumption produces the same wrong answer more confidently, which is why "be careful" is not the
remedy.

### The two tests, and how the file came to document the bug as correct

`tests/api-fetch-offline.test.ts` had this pair, side by side:

```ts
const shelf = [{ slug: "kept" }, { slug: "evicted" }];      // a shape the server has never sent

it("drops entries whose prose we no longer hold", ...)       // green, against the filter's own premise
it("leaves an unexpected shape alone rather than emptying the shelf", ...)   // { entries: "surprise" }
```

The first fed a bare array and passed, because that is precisely the branch the filter could handle
and precisely the one production never produces. The second pinned an unrecognised **object** as
passing through unchanged — which is the branch the *real* payload took. Between them the file
asserted that the bug was the specification. Twenty-four tests passed.

**A third fact makes this sharper, and it is the useful one.** The envelope *was* already asserted
against the real route, in `tests/routes.test.ts` § "the library route", which calls `GET
/api/library` and reads `.articles` off the reply. So both halves of the contract were pinned by
tests in this repo the whole time — in two files that have no reason ever to be opened together, and
with nothing in the type system to make them meet. The knowledge was present and unjoined.

## Which commit introduced it

**`ad90b175`, "Keep the article a reader is holding when the connection goes", 2026-08-27** — the
implementation and its misleading test arrived in the same commit. Verified rather than assumed:

```
git log -S "onlyWhatWeHave" -- src/web/lib/api.ts                  → ad90b175, and nothing else
git log -S "the offline shelf offers only what it can open" -- tests/…  → ad90b175, and nothing else
```

GPT Sol's attribution was right. And the envelope was **not** a later change that drifted out from
under it: `git log -S 'articles: await listArticles' -- src/routes.ts` gives `12081b0d`
(2026-08-25), and `git merge-base --is-ancestor 12081b0d ad90b175` confirms the route was already
sending `{ articles }` two days before the filter was written. So this is not drift over time. **It
was wrong at birth**, which is worth stating because the two have different preventions: drift wants
a check that runs repeatedly, birth wants the contract to be visible at the moment of writing.

## The fix

Filter inside the envelope and hand the envelope back
([`src/web/lib/api.ts`](../../src/web/lib/api.ts)):

```ts
if (typeof body !== "object" || body === null || Array.isArray(body)) return body;
const { articles } = body as { articles?: unknown };
if (!Array.isArray(articles)) return body;
const have = await cachedSlugs(user);
return { ...body, articles: articles.filter(/* keep the slugs we hold */) };
```

**Keeping the envelope is the load-bearing choice, and the tempting alternative would have shipped a
second bug.** Unwrapping to a bare list would have made the offline shelf match the filter; it would
also have broken all three consumers, which read `.articles` off whatever `readJson` parsed —
`readJson` only parses, so the shape has to survive intact. The three sites are listed in the table
above; none of them is defensive about it. Sol argued for keeping the envelope and that is what
landed.

Everything that is not an object carrying an `articles` array is still returned unchanged. The
shape-tolerance was never the problem — being tolerant of the *only* shape that exists was.

The tests are rewritten against the route's real shape, and the invented one is retained under an
honest name:

- the envelope is filtered, and the rest of it survives;
- a bare array is an **unexpected legacy shape**, passed through unchanged;
- `{ entries: "surprise" }` and `{ articles: "surprise" }` are not emptied;
- and "does not filter an article payload" now uses a payload the filter *would* bite, so the path
  gate is the only thing stopping it — with the old bare-array fixture that test could not fail.

All three new assertions were watched go red against the old filter first. Their directions are the
clearest evidence in this write-up: the two real-envelope tests failed because nothing was filtered,
and the legacy bare-array test failed because it *was* — the old code only ever worked on a shape
that has never existed.

## What would have caught the whole class, ranked

Ranked by ease against value, which for this class pull in the same direction. The first two are one
job and are done; the last two are recommendations.

**1. Name the envelope once, in the file both sides already share. (Done. Cheap, wide.)**
`LibraryResponse` is now in [`src/types.ts`](../../src/types.ts) beside `LibraryEntry`, and
`src/routes.ts` annotates what it sends with it rather than letting it be inferred. On its own this
would **not** have reddened this bug — `onlyWhatWeHave` receives `unknown` off IndexedDB and no type
can survive a storage round-trip — and saying so matters, because "we added a type" is exactly the
kind of fix that gets believed without being tested. What it buys is that the contract now has one
place to be wrong in, and that the next item becomes possible. The three client consumers still
retype it inline; converting them (one is `useShelf.ts`, off-limits in this stage) is a small
follow-up.

**2. Type the test fixture against that name. (Done. Nearly free, and it is the one that fires.)**
The fixture is declared `Record<keyof LibraryResponse, { slug: string }[]>`, so a fixture that drifts
back to a bare array fails `npm run typecheck` before the suite runs — checked by making it a bare
array on purpose and watching it error with *"Property 'articles' is missing"*, then putting it
back. Deliberately **not** `as LibraryResponse`: a cast would accept a bare array again and would be
precisely the reassurance that failed here. Keying off `keyof` checks the envelope while leaving the
entries minimal, which is all this file needs them to be. **This is the recommendation to carry
elsewhere** — a fixture standing in for a real payload should be typed by the producer's own type,
not by hand.

**3. A rule for the reviewer, and a cheaper one than it sounds. (Free; costs discipline.)** The
repo already requires red-before-green. This case needs a narrower rule that red-before-green does
*not* give you, because a vacuous test goes red perfectly well against its own invented shape: **a
fixture standing in for a real payload must be derived from the producer, never from the function
under test.** The tell is an author opening the implementation to decide what to feed it. Worth
saying out loud in review because it is invisible in the diff — a bare array and an envelope look
equally plausible on the page.

**4. A shared fixture derived from the real route. (Highest fidelity, real cost — not now.)**
`tests/routes.test.ts` already calls `GET /api/library` for real; that reply could seed the offline
test's fixture, and then the two facts that sat unjoined for a fortnight would be the same object.
Rejected for now: it couples a fast, fully-mocked unit file to a database-backed integration file
and gives up the isolation that makes the offline tests worth having, for a benefit items 1 and 2
mostly deliver at a fraction of the price. Revisit if this class recurs on a second route.

Not recommended: a runtime warning when `onlyWhatWeHave` meets a shape it does not recognise. It
sounds like the obvious answer — the function fails silently, so make it speak — but it fires in the
browser of a reader who is offline, where nobody is watching, and the legacy shape it would warn
about is one we deliberately tolerate. It would have produced a console line nobody read.

## See also

- [library.md § Offline, the shelf lists only what it can open](../project/library.md#offline-the-shelf-lists-only-what-it-can-open) — the shelf's own doc
- [260827r-offline-reading.md](../plans/260827r-offline-reading.md) — what offline reading is meant to do
- [silent-success.md](../reusable/silent-success.md) — the family this belongs to
- [260903g-faster-shelf-load-and-tidier-homepage-controls.md](../plans/260903g-faster-shelf-load-and-tidier-homepage-controls.md) — the work that turned it up
