# The homepage is slow because of the cold start, not because of the shelf

Greg, 2026-09-03:

> The logged-in Homepage list of articles seems slow to load (reading from shelf). Why? Would it
> help to load it progressively, e.g. a first pass to get just the sorted titles, then get the extra
> metadata in a second pass? Or something better/simpler than that. … Don't over-engineer or add too
> much complexity.
>
> Move the search bar so it's just above the list of articles.
>
> Maybe the "Add an article" section could be default-collapsed with a very big button to open? Or
> just a bit more compact somehow?

And, when the diagnosis came back and the answer turned out to have two halves:

> And to be clear, it was the delay "Reading the shelf" for a logged-in user with fewer than a dozen
> articles that I noticed most.
>
> — Greg, 2026-09-03

That sentence is what ranks this whole plan. **Fewer than a dozen articles** rules out everything
that scales with the size of the shelf, and the message he names starts its clock at a specific
place in the code, which rules out most of the rest.

**The title is a hypothesis until Stage 1 measures it.** It is written as a claim because every
reading so far points one way, but nothing in production has yet been instrumented, and the honest
version until then is *likely cold module initialisation*.

## The answer to "why"

### It is not the query, and progressive loading would make it worse

[260828c-library-read-latency.md](260828c-library-read-latency.md) already fixed the shelf's reads in
August: 13 statements / 641 KB / 558 ms → **2 statements / 4,055 bytes / 3 ms**. Every field a card
draws is already a column on `article_revisions`
([`REVISION_PROJECTIONS.library`](../../src/store/pg.ts)), so there is no per-article artefact read
left to remove.

Measured again from scratch for this plan, against the local Postgres, counting statements in the
Postgres log by connection pid, at four shelf sizes:

| articles | statements | DB time | response |
|---|---|---|---|
| 14 (the real local shelf) | **2** | ~12 ms | 6.5–7.9 KB |
| 53 | **2** | ~8 ms | 18.4 KB |
| 203 | **2** | ~9.5 ms | 59 KB |
| 1004 | **2** | ~25 ms | 280 KB |

Two statements at every size — one join, and one grouped `count` over `comments` with an `IN` list.
At Greg's dozen articles the database is doing single-digit milliseconds of work and returning about
7 KB.

**So a first pass for titles and a second for metadata would split a 7 KB answer into two round
trips to save nothing** — and both passes hit the same cold function at the same moment, so the
message appears at exactly the same time and the shelf then *settles later*. It would also cost a
second endpoint or query parameter, a second loading state in `useShelf`, cards that reflow as the
numbers land, `sinkLast` needing the `fixture` flag in pass one, and re-ordering under the reader for
the three sort keys — length, times opened, questions — that are precisely the "extra metadata".
**Rejected**, and Fable and GPT Sol agree.

### It is the serverless cold start, and nothing we record can see it

Production runtime logs for the current deployment, `GET /api/library 200`, last 24 h: **9, 10, 11,
11, 12, 16 ms** warm; **131 ms** and **208 ms** for the first request after a five-minute and a
forty-minute gap (pool connect, then the JWKS fetch in `getClaims`).

Those numbers are recorded from [`src/routes.ts`](../../src/routes.ts), and the clock starts
**after** `api/index.js` has finished `await import("../api-dist/vercel.js")` — a **3,477 kB**
server bundle, unminified by design ([`vite.api.config.ts`](../../vite.api.config.ts)), which at
module scope statically imports **jsdom** (six modules — see Stage 4), **Stripe**, the
**`@anthropic-ai/sdk`**, pg + drizzle and Sentry. A bare `GET /api/library` pays for all of it.

**The module-import cold start is invisible in every number the app records**, and it is the only
thing in the path large enough to reach 600 ms on its own. It also explains "*seems* slow" rather
than "is slow": it is the first open after a break, not every open.

### The 600 ms message has a precise start, and two suspects do not reach it

`useSlow(articles === null)` with `SLOW_AFTER_MS = 600` ([`useSlow.ts`](../../src/web/useSlow.ts))
is the message Greg is quoting. Its clock starts when `Library` mounts — and `Library` mounts only
after `App` has stopped returning `null` for `loading`
([`App.tsx`](../../src/web/App.tsx), the `if (loading) return null` gate), which is after the boot
chunk, the main chunk, React and Supabase's `INITIAL_SESSION` have **all** finished. So:

- **The 1.39 MB client bundle cannot cause this message.** It lengthens the *blank before the shelf*,
  which is a real complaint and a different one.
- **`await accessToken()` almost certainly cannot either.** `@supabase/auth-js` runs
  `_recoverAndRefresh()` before it emits `INITIAL_SESSION`, and `App` waits for that event, so the
  refresh is already done by the time `apiFetch` asks. **It is *not* "an in-memory read behind a Web
  Lock"** — that was in this plan's first draft and is wrong for the installed 2.112.4, where
  `getSession()` reads storage again and the default path is lockless. The conclusion survives the
  correction; only the reasoning was wrong.

Both were leading suspects on the first draft. Fable's review removed them, which is why the plan
below leads with something else, and Sol's corrected the second one's justification.

## What the work turned up: the offline shelf filter has never run

Not in the brief, found while tracing, and it is the shape this repo keeps writing postmortems about
([silent-success.md](../reusable/silent-success.md)).

`onlyWhatWeHave` ([`src/web/lib/api.ts`](../../src/web/lib/api.ts)) exists so the offline shelf lists
only articles whose prose is still held locally. Its first line is
`if (!Array.isArray(body)) return body;` — and the route sends `{ articles: [...] }`, an **object**
([`src/routes.ts`](../../src/routes.ts)). It returns the body untouched and always has: offline, the
shelf lists every article, and tapping an evicted one fails.

**Why nobody noticed.** `tests/api-fetch-offline.test.ts` § *"the offline shelf offers only what it
can open"* feeds `readCache` a **bare array** — a shape the server has never produced — and passes.
The test beside it pins `{ entries: "surprise" }` passing through, which is the very branch the real
payload takes. A test written against an invented fixture rather than the route's own shape.

## What the cross-family review changed

GPT Sol reviewed this plan before anything was built and returned **not ready to build**, with six
must-fixes. Five were right and one was the best catch of the day; they are folded in below, and the
three that correct a *claim* rather than a design are recorded here rather than quietly deleted.

- **The order was wrong.** Stale-while-revalidate led, and it makes the symptom disappear before the
  cause has been measured — so it would also hide whether the cold-start fix worked. That is the
  same objection this plan makes to the warming cron. Measurement now leads, and SWR is last and
  conditional.
- **"Rename and archive already patch local state, so a stale card cannot outlive the revalidate"
  was false.** They patch the React list; they do not rewrite the cached response. An old title or
  an archived card can come back for a moment on the next load.
- **"An in-memory read behind a Web Lock" was false** — corrected in place above.
- **"Both AI SDKs" was false.** `package.json` has exactly one, `@anthropic-ai/sdk`. Checked.

And the catch that would have shipped a real regression, which has its own paragraph in Stage 3.

## The stages

Ordered so that the two independent, certain-value pieces land early, the risky architectural one is
late, and nothing hides the measurement.

**A constraint worth stating first: production cannot be measured from this box.** There is no Vercel
credential here and no production database access. So Stage 1 produces a *local* harness plus an
instrument that pays off on Greg's next deploy, and no stage in this plan may claim a production
number it did not see.

### Stage 1 — measure the cold start, and leave something that keeps measuring it

Nothing today records it: the server's own clock starts *after*
`await import("../api-dist/vercel.js")`, which is why every logged number says 10 ms.

Sol measured the current emitted bundle locally while reviewing, and the numbers are why this stage
leads rather than being assumed:

| import | time | note |
|---|---|---|
| the whole `api-dist/vercel.js` | **~2.61 s**, 259 MB RSS | this is the invisible cost |
| `drizzle-orm/node-postgres` | ~942 ms | |
| `jsdom` | ~875 ms | |
| `stripe` | ~165 ms | |
| `@anthropic-ai/sdk` | ~82 ms | |

Not additive, not production, and directional only — but 2.61 s against a 600 ms threshold settles
that module initialisation is the thing to look at.

- A committed harness — `scripts/bench-cold-start.ts`, beside
  [`scripts/bench-shelf-reads.ts`](../../scripts/bench-shelf-reads.ts), which is the model for it —
  timing the bundle import and each heavy dependency, in a fresh process per run. **It throws rather
  than shrugging** on a missing bundle or a zero reading, the rule that file already follows.
- **Two instruments in production, not one.** The time inside `await import(...)` in `api/index.js`,
  logged once per instance; *and* the end-to-end duration of the first handler call. Sol's reason for
  the second is the one that matters: a handler-local dynamic import makes the outer timer look
  better while merely moving the same wait later in the same request. One number alone would report
  a success that had not happened.

Done when: the harness runs, its numbers are in this file, and both log lines exist.

### Stage 2 — the offline envelope, and its postmortem

Independent of everything else, small, and a real bug — so it lands early rather than waiting behind
the architectural work.

**The fix keeps the envelope**, on Sol's argument, rather than unwrapping it: the downstream caller
reads `.articles`, and `readJson` only parses.

```ts
{ ...body, articles: body.articles.filter(...) }
```

with anything that is not an object carrying an `articles` array returned unchanged.

**The test is rewritten against the route's real shape.** The existing bare-array case becomes an
explicit "an unexpected legacy shape passes through" test, so the shape that *is* produced and the
shape that is merely tolerated stop being the same test.

**And a postmortem**, because the class is worth the filing: **contract drift with a vacuous test** —
producer and consumer disagreed about the envelope, and the test invented a third shape, so it was
green against code that never ran. Sol puts the implementation and its misleading test in the same
commit, `ad90b175`; that gets checked rather than repeated. Ranked recommendations for what would
have caught the class, per [engineering-manager.md](../reusable/engineering-manager.md).

Done when: the new test is red against the old filter and green after; the legacy-shape test passes;
the postmortem is written.

**Done, 2026-09-03.** All three new assertions were watched go red first, and their *directions* are
the evidence: the two real-envelope cases failed because nothing was filtered, and the bare-array
case failed because it *was* — the old guard only ever worked on a shape production has never sent.
`tests/api-fetch-offline.test.ts` is now **27 passed**. Two preventions landed with the fix rather
than staying as prose: `LibraryResponse` is named once in [`src/types.ts`](../../src/types.ts) and
annotates the route's own `send(...)`, and the test fixture is typed off `keyof` it — proved to fire
by making it a bare array and watching `npm run typecheck` reject it. The postmortem is
[260903e-offline-shelf-filter-never-ran.md](../postmortems/260903e-offline-shelf-filter-never-ran.md),
and [library.md](../project/library.md#offline-the-shelf-lists-only-what-it-can-open) now says the
shelf has an offline half at all, which it did not.

### Stage 3 — the two layout jobs

Both asked for directly, both independent.

- **The search box moves to just above the list.** Stated exactly, because "below the add box" is not
  the same instruction: the order becomes **add box and its jobs → errors and Undo → search →
  `ShelfControls` → the "n of m" count → the list**.
- **The add box gets compact, and keeps its input visible.** Greg's call, given the choice:

  > Compact, input stays visible
  >
  > — Greg, 2026-09-03

  The measured "before", from `getBoundingClientRect` in a real browser rather than by eye:

  | | add box height | share of the first screenful |
  |---|---|---|
  | 1280 × 900 | 300 px | **33%** |
  | 390 × 844 | 454 px | **54%** |

  At 390 the first card's top edge sits at **y = 824 of an 844 px viewport** — a twenty-pixel sliver,
  so on a phone the shelf's own list is entirely below the fold.

  **The space is going to the PDF dropzone**, not the URL row: a dashed rectangle holding an icon,
  "Or drop a PDF here" and an "Upload a PDF" button, about 130 of those 300 px, for the rarer of the
  two ways in. So that loses its box and becomes a small control on the URL row.

  **The disclosure stays visible, and this is the finding that nearly shipped a regression.** The
  first draft said `ADDING_SENDS_TEXT_AWAY` could appear only once a URL had been typed. But
  [`UploadPicker.tsx`](../../src/web/UploadPicker.tsx) says of itself, in these words:

  > **A drop uploads it. Dropping is the commit gesture.**

  So a reader can drop a manuscript and have it sent **without ever having typed anything**, and a
  disclosure gated on typing would never have been shown to them. It is a confidentiality promise,
  and the peer-reviewer holding someone else's paper is exactly who it is for
  ([referee-mode.md](../project/referee-mode.md)). It stays visible while either way in is available.

  **Compacting `UploadPicker` is a layout change and nothing else**: drag-and-drop, the selected-file
  state, progress, cancellation, quota errors and retry all keep working. Removing the dashed border
  must not remove the drop target.

Done when: screenshots at 1280 and 390 show the new order; the add box is materially shorter,
re-measured the same way; a PDF still uploads by drop *and* by button; the disclosure is visible at
rest; and nothing in `ShelfControls` has moved.

### Stage 4 — reduce the cold start, measured against Stage 1

**A spike, not a predetermined edit.** The first draft called this cheap; Sol showed it is not, and
the correction is the useful part:

- jsdom is statically imported by **six** modules, not two — `blocks.ts`, `extract.ts`, `sanitize.ts`,
  `collect-assets.ts`, `injection-scan.ts`, `chat-tools.ts` (checked).
- [`src/sanitize.ts`](../../src/sanitize.ts) constructs its DOMPurify/jsdom instance **at module
  evaluation**.
- `blocks.ts` and several consumers expose **synchronous** APIs, so `await import("jsdom")` inside
  them propagates async outwards.
- The shelf reaches the heavy graph by `routes → store/index → pg → sanitize / pipeline /
  collect-assets`, so moving the imports in `blocks.ts` and `extract.ts` alone **removes nothing from
  the cold path**.

The likely seam is route/store module splitting, which is architectural. So: attempt the smallest
change the harness shows actually moves the number, re-measuring the emitted bundle after each step,
and **stop and report rather than pressing on** if the seam turns out to need a redesign. That is a
decision for Greg, not something to slip into a stage.

Done when: a before/after number from Stage 1's harness is in this file — including the honest
outcome if it is "no cheap seam exists".

### Stage 5 — stale-while-revalidate, only if Stage 4 leaves it worth doing

Last, and **conditional**, because it hides the very thing Stage 4 is judged by. If Stage 4 gets the
cold start under the threshold this may not be needed at all; if it does not, this is what the reader
actually feels.

The machinery exists: `apiFetch` already writes every GET body to IndexedDB and `cacheable()` already
special-cases `/api/library` — it is simply only read when the transport *fails*. But the contract has
to be written down before it is built, and this is the half the first draft was missing:

- **Identity comes from the authenticated session, not from `lastKnownUser()`.** `user.id` is passed
  from `SignedIn` into `Library` and `useShelf`. Titles are reader data, and the lookup should be
  keyed by the identity React has just authenticated rather than by a second remembered one.
  `lastKnownUser()` is *usually* right, and the reason it is not good enough is concrete: a direct
  A→B sign-in calls `rememberUser(B)` and **never** `forgetUser(A)`, which only runs on a null
  session ([`src/web/lib/api.ts`](../../src/web/lib/api.ts)). Rows stay partitioned; the first
  draft's claim that this covers "sign-out and account switches" was stronger than the code.
- **A generation counter, not a boolean.** `reload()` is public and job-driven reloads overlap, so
  "has the live answer landed" is not one bit. The cached continuation checks the generation
  immediately before committing, and is cancelled on unmount.
- **An explicit failure policy**, since eager painting changes what a failure means: keep the stale
  shelf and show the error for a transport failure or a 5xx; clear it on a final 401 or a change of
  reader.
- **The cached body is validated before it is painted.** A response saved by an older deployment can
  lack a field that is now required, and `entry.words.toLocaleString()` would throw — today that risk
  exists only offline, and SWR would run it on every repeat visit.
- **Not through `onlyWhatWeHave`.** Right for the offline case — *only show me what I can open* — and
  wrong here, where it would hide perfectly good network-backed articles because their prose happens
  to have been evicted locally. Sol agrees.
- **Honest about staleness.** An old title or an archived card can show for a moment, and counts and
  order can jump when the live answer arrives. Acceptable — renames are cosmetic and Delete is
  archive — but said out loud rather than discovered.
- **No promise that `useSlow` "never fires".** IndexedDB is async and a blocked read can still take
  longer than 600 ms.

Tests both ways round: cache first then live replaces it, **and** live first then a late cache result
cannot overwrite it — plus unmount, a change of reader, and the chosen 401/5xx policy.

### Not doing

- **Progressive/two-pass loading** — § above, and both reviews agree.
- **The `ArticlePage` extraction.** It was a stage; dropped on Sol's advice and Greg's "don't
  over-engineer". A 4,500-line move that does not touch what Greg noticed, and not mechanical —
  `tests/sanitize-client.test.ts` and four other tests read `App.tsx` **as source** (checked), and a
  single misplaced shared import silently pulls the supposedly-lazy code back into the main chunk,
  which is exactly what happened to `ChatPanel` and `QuotesPanel` in the spike. If blank-before-shelf
  is ever measured as a real problem it gets its own plan. `modulepreload` is much smaller and can be
  assessed on its own.
- **A warming cron.** Named to Greg as an option; it papers over Stage 4.
- **An HTTP cache header on `/api/library`** — `private, max-age` shows a stale shelf after another
  device archives something, and an ETag still pays the cold start.
- **An index on `spideryarn.articles`.** It has none beyond its two unique constraints, so the shelf
  sequentially scans every owner's rows — but at a dozen articles that is not what Greg noticed, and
  the sort spans two tables (`coalesce(revision.fetched_at, article.created_at)`) so one index cannot
  serve it. Worth doing on its own merits; noted so it is not lost.

## Status

Stage 0 (diagnose) — **done**, reviewed by Fable and GPT Sol, rewritten on Sol's six findings.
Stage 1 next.

Baseline for comparison, `npm test` on this worktree before any change — **5 files / 6 tests red** of
586 files / 10,506 tests, and these are the five, so that a sixth is mine:

| file | failing |
|---|---|
| `tests/store-jobs-parity.test.ts` | 2 — claim over cap; frees a stalled slot |
| `tests/store-shelf-reads.test.ts` | 1 — *agree about every article on the shelf* |
| `tests/admin-store.test.ts` | 1 — the whole shape, every field's type |
| `tests/scroll-glide.test.ts` | 1 — stops a jump still in flight |
| `tests/pdf-bundle-trace.test.ts` | 1 — untraceable specifier (120 s timeout) |

Three of those touch the shared local Postgres, which several agents and a seeding run were using at
the time, so they are contention rather than real. **`store-shelf-reads` was checked rather than
assumed**, because it is the shelf parity test and this work touches the shelf: run on its own it is
**10 passed, 0 failed**. So the shelf's own tests are green going in, and a red one later is mine.

`tests/api-fetch-offline.test.ts` is **24 passed** — which is the point of Stage 2, not a
contradiction of it.
