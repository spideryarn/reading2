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

#### What landed, 2026-09-03

**[`scripts/bench-cold-start.ts`](../../scripts/bench-cold-start.ts)**, modelled on
[`bench-shelf-reads.ts`](../../scripts/bench-shelf-reads.ts) and refusing the same way. One **fresh
child process per measurement**, because a module can only be imported once per process and the
second reading is microseconds — which reads exactly like "we made it fast". It throws on a missing
bundle, a bundle smaller than 100 kB, a bundle **older than anything under `src/`**, a child that
died or was signalled, a child that printed no reading, a reading that will not parse, and any
reading under `MIN_PLAUSIBLE_MS`. And it checks the *outcome* of the fresh-process discipline rather
than restating it: every reading's pid distinct, and none of them the harness's own.

**Read the load line before the table.** This box is shared, and it was at a load average of 108–136
across 16 cores while these ran — eight times oversubscribed. So the harness now prints the load and
marks a contended run, and the numbers below are **upper bounds**: Sol's ~2.61 s for the same bundle
on a quiet machine is about 3.5× faster, and the *ordering* is what survives every run.

| import | ms (median of 3) | RSS |
|---|---|---|
| **`api-dist/vercel.js` (the whole bundle)** | **9,364** | 247 MB |
| `drizzle-orm/node-postgres` | 1,953 | 281 MB |
| `drizzle-orm/pg-core` | 1,873 | 253 MB |
| `jsdom` | 1,650 | 153 MB |
| `@sentry/node-core/light` | 896 | 84 MB |
| `pdf-lib` | 885 | 67 MB |
| `stripe` | 456 | 78 MB |
| `undici` | 387 | 76 MB |
| `@anthropic-ai/sdk` | 240 | 64 MB |
| `mdast-util-from-markdown` | 192 | 62 MB |
| `@supabase/supabase-js` | 100 | 56 MB |
| `pg` | 66 | 56 MB |
| `fflate`, `@mozilla/readability`, `p-queue`, `dompurify` | under 55 each | |

Not additive — the bundle's figure already contains every row below it. **Two things in there were
not on the list Stage 4 was written against**, and finding them is what the harness is for:
**`drizzle-orm/pg-core` is a second cost beside `node-postgres`** (so "the drizzle import" is two
imports, not one), and **`@sentry/node-core/light` outranks Stripe**. Stage 4's shortlist should be
drizzle ×2, jsdom, Sentry, pdf-lib — in that order — rather than the jsdom-first assumption above.

**The instrument, and the seam.** `api/index.js` cannot import [`src/log.ts`](../../src/log.ts) — it
is plain JavaScript outside the compiled bundle on purpose, and the logger is on the far side of the
very import being measured. So it takes `performance.now()` either side and hands the numbers across
to [`src/cold-start.ts`](../../src/cold-start.ts), re-exported by
[`src/vercel.ts`](../../src/vercel.ts) as `reportBundleImport` / `reportFirstRequest`. **The
measuring happens outside the logged world; the logging happens inside it.**

`api/index.js` calls both **unconditionally, on every request**, and `src/cold-start.ts` drops all
but the first. One decision, in one place, that a test can reach — a flag in `api/index.js` too
would be the same rule written twice, with the copy nothing can import being the copy nothing
checks. Both lines go out under the **`health`** component, whose own comment in `src/log.ts` says it
is for the things reporting on the *deployment* rather than the application; a sixteenth component
for two lines an instance would be a filter nobody would build.

```
{"component":"health","phase":"moduleImport","ms":8844,"msg":"cold start: module import"}
{"component":"health","phase":"firstRequest","ms":8999,"msg":"cold start: first request"}
```

Those two are real, from driving the actual `api/index.js` against the actual `api-dist/vercel.js`
three times: **exactly two lines for three requests**, and the gap between them says the
`/api/health` work itself was ~155 ms of an ~9 s invocation. That is the shape Sol's second-number
argument predicted, and it is why there are two — an import moved inside the handler would shrink
`moduleImport` and leave `firstRequest` exactly where it is.

**Tested, and each guard watched go red on its own.** `tests/bench-cold-start.test.ts` (16) and
`tests/cold-start-report.test.ts` (5). Five mutation controls, each reverted after: the `ms` floor
removed → the two floor cases fail and nothing else; the duplicate-pid check removed → one case; the
staleness check removed → one case; each of the two once-per-instance guards removed → *"expected
[ …(3) ] to have a length of 1 but got 3"*, which names the thing it is about. The staleness guard
was also run against the real tree, where it refused with *"api-dist/vercel.js is stale:
src/cold-start.ts is newer than it"*.

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

**Done, 2026-09-03.** Both jobs landed in
[`Library.tsx`](../../src/web/Library.tsx), [`AddArticle.tsx`](../../src/web/AddArticle.tsx) and
[`UploadPicker.tsx`](../../src/web/UploadPicker.tsx). The page renders in the order Greg asked for,
read back off the DOM rather than off the source: `header → section` (add box and its jobs) `→ div`
(search) `→ div` (`ShelfControls`) `→ ul` (the list) `→ section` (Show deleted). Errors, Undo and the
"n of m" count sit where the plan puts them; `ShelfControls` and everything below it is untouched.

**The add box, re-measured with `getBoundingClientRect` in the same signed-in browser:**

| | before | after | first card's top edge |
|---|---|---|---|
| 1280 × 900 | 300.3 px (33% of the screenful) | **164.3 px (18%)** | 562 → **426** |
| 390 × 844 | 316.3 px (37%) | **223.3 px (26%)** | 686 → **593** |

**The 390 "before" is 316 px, not the 454 px at the top of this stage.** Both were measured the same
way; the shelf state was not the same, and the shared local database had moved on between them.
316 → 180 is the honest comparison, because both halves of it came from the same run of the same
script minutes apart. The 136 px that went at *both* widths is the dashed box, which is what the
stage said it would be.

**How the space was found.** `UploadPicker` no longer draws a rectangle of its own. It hands
`AddArticle` two pieces and wraps the whole section: the **button**, a small outline `PDF` control on
the URL row beside Add, and the **status** (the chosen file, the progress bar, the refusals, Send
it), placed directly under that row. Everything else about the upload — the file, the transfer, the
cancellation — stays in the one component that runs it. The **drop target** is now that wrapper,
which covers the card's own padding and so is *much* larger than the dashed strip ever was, while
drawing nothing at rest: the border is transparent until a file is over it, then orange. Measured:
`rgba(0,0,0,0)` at rest, `rgb(219,138,69)` with a file over it (read after the 150 ms
`transition-colors`, which is why a read in the same tick says transparent and means nothing).

**Both ways in were exercised, and the evidence is the address rather than the screen.** A real PDF
(`evals/pdf/easy/source.pdf`, 141 KB) went up by the file picker → *Send it* → `/add/upload/0bee882d…`,
and by a dispatched `dragenter`/`dragover`/`drop` carrying a real `File` → `/add/upload/a474c7a1…`.
That address only exists once the bytes are in the object store and a grant has been minted, so it is
not something a filename on screen could fake. The drop landed **on the URL input**, and a second run
dropped on the **disclosure paragraph** → `/add/upload/b5f03ba2…`; neither was a drop target before
this change.

**The disclosure is visible at rest at both widths** — `ADDING_SENDS_TEXT_AWAY`, read out of the DOM
with a non-zero box, directly under the row, with nothing typed and no file chosen. The near-miss the
review caught is now written into the comment at its call site, so the next person to compact this box
finds the reason before the idea.

**What the cross-family review changed, and it was both findings.** GPT Sol read the finished diff
and returned **do not ship**, twice rightly:

- **The row did not wrap, so the URL input was crushed.** Three controls side by side left it at
  155 px at 390 and **85 px at 320** — about 59 px of usable text. Zero page overflow is not the same
  as a usable field, and text zoom makes it worse. Fixed as Sol proposed and as this repo's own rule
  already said: the input keeps a real floor (`min-w-48`), the two buttons are kept together in their
  own box so the row can never break *between* them, and the row wraps when the floor cannot be met.
  Now 661 px / **306 px** / **236 px** at 1280 / 390 / 320, `scrollWidth - clientWidth` still 0 at
  all three. It costs 43 px at 390 — the whole difference between the 180 px this first measured and
  the 223 px above — and no breakpoint, because the shelf has none
  ([design-css-overview.md § Narrow windows](../project/design-css-overview.md#narrow-windows-wrap-do-not-shrink)).
- **The title promised a bigger target than existed.** *"drop one anywhere on this box"*, while the
  handlers covered only the form. A PDF let go on the disclosure line or a job row fell through to
  the browser, which opens it over the page — a worse failure than the old dashed box's, because the
  old one at least looked like what it was. Fixed by making the promise true rather than by shrinking
  it: the wrapper now takes the whole section, `-m-4 … p-4` so it reaches the card's edge, and the
  drop on the disclosure paragraph above is the proof.

Sol found no defect in the render prop (no ownership, identity, re-render or focus problem; the
hidden `input` is `display:none` and cannot affect hit-testing or the drag depth count), confirmed
the second-drop refusal, abort, quota and retry paths intact, and confirmed the biome suppression is
correctly placed and active.

No test asserted the old page order or the dropzone's markup, so none needed changing.
[library.md](../project/library.md#finding-an-article-and-finding-a-passage-in-one) and
[ingest-queue.md](../project/ingest-queue.md#uploading-a-pdf) were updated in the same commit.

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

**And Stage 1's ranking is not the one this stage was written against.** Two things it turned up:

- **"The drizzle import" is two**, not one — `drizzle-orm/node-postgres` *and* `drizzle-orm/pg-core`,
  the largest pair on the list.
- **`@sentry/node-core/light` outranks Stripe**, and `pdf-lib` outranks it too. **jsdom is third.**

That matters because of which of them the shelf actually needs. Drizzle is on the shelf's own query
path and cannot be moved off it at all; Sentry is arguably load-bearing. jsdom, `pdf-lib`, Stripe and
the Anthropic SDK are needed by **no part of answering `GET /api/library`**. So the reachable prize is
the smaller half of the list, and there is a floor under it that no amount of work removes.

**Individual import costs are not additive** — they share dependencies, and the parts sum to more
than the 9.4 s whole — so the honest statement of the ceiling is "some fraction, with a hard drizzle
floor", not a number.

So: attempt the smallest change the harness shows actually moves the number, re-measuring the emitted
bundle after each step, and **stop and report rather than pressing on** if the seam turns out to need
a redesign. That is a decision for Greg, not something to slip into a stage.

Done when: a before/after number from Stage 1's harness is in this file — including the honest
outcome if it is "no cheap seam exists".

#### What landed, 2026-09-03 — **the module import is 40% shorter**

**The headline, and read the method before the number.** The harness's own figure moved
**2,371 ms → 1,470 ms** for the whole bundle. But two harness runs an hour apart on this box are not
a comparison — the load average went 9 → 73 → 3 while this work was happening, and the same unchanged
bundle timed 2.5 s and 10.2 s on the same afternoon. So the number that decides anything is a
**paired** one: the two bundles imported alternately, in fresh processes, seconds apart, so both arms
see the same box.

| | before | after |
|---|---|---|
| `api-dist/vercel.js`, median of 15 (load 4.3/16 cores) | **2,371 ms** | **1,476 ms** |
| the same, minimum of 15 | 2,252 ms | 1,353 ms |
| **paired difference, round by round** | — | **944 ms median, 15 rounds out of 15 in that direction** |
| RSS after the import | 225 MB | 198 MB |

The Stage 1 harness on the finished bundle at load 3.3: **1,470 ms, 198 MB**. Its own "before" reading
was 2,525 ms at load 9.2 and 9,364 ms at load 108, which is the whole argument for pairing.

**How the marginal cost of each dependency was found**, since the standalone import times at the top
of Stage 1 do not say what *removing* one from the bundle is worth. A Node `registerHooks` resolver
swapped one package at a time for an empty stub **inside the real built bundle**, and the arms were
interleaved. Only the bundle's own imports were stubbed, not a dependency's — which is how it turned
up that **jsdom `require`s undici itself**, so undici's own 162 ms is hidden behind jsdom and
stubbing it alone saves nothing at all. Least-contended reading of 9 rounds, load 72:

| stubbed out | bundle import | marginal cost |
|---|---|---|
| nothing | 3,278 ms | — |
| jsdom (+ dompurify, which cannot start without it) | 2,236 ms | **~1,040 ms** |
| pdf-lib | 2,804 ms | ~474 ms |
| stripe | 3,046 ms | ~232 ms |
| `@anthropic-ai/sdk` | 3,063 ms | ~215 ms |
| undici | 3,389 ms | **~0** — jsdom loads it anyway |
| everything droppable at once | 1,837 ms | ~1,440 ms, and **not the sum**: with jsdom gone, undici starts counting |

**What moved, and the seam each one took.**

- **jsdom — the prize, and it did *not* need the redesign.** Sol's finding was right as far as it
  goes: `splitIntoBlocks`, `readArticle`, `imageUrlsIn`, `articleLinks` and `sanitizeHtml` are
  synchronous exported functions with call sites and tests throughout the repo, and `await
  import("jsdom")` inside any of them turns that whole chain async. But jsdom is **CommonJS**, so
  `createRequire(import.meta.url)("jsdom")` loads exactly the same module — through the same CJS
  cache Node's ESM loader would have used — **synchronously**, on first use. Not one signature
  changed. [`src/jsdom-lazy.ts`](../../src/jsdom-lazy.ts) is the one place that says why, and the six
  modules each destructure what they need at the top of the function that needs it.
  [`src/sanitize.ts`](../../src/sanitize.ts) built its DOMPurify at module evaluation and now builds
  it on the first sanitise — same instance, once per process, later.
- **pdf-lib** — one `await import` inside `cutPages`, which was already async and is the only thing in
  [`src/pdf-read.ts`](../../src/pdf-read.ts) that touches the package. The `src/pdf.ts` pattern
  exactly.
- **Stripe** — `stripeClient()` is now async, and with it `verifyEvent` and `billingClient`. Three
  call sites, all already inside async functions; `ensurePortalConfiguration`'s default parameter
  became an optional argument, because a default cannot await. The alternative — a warm-up call that
  has to happen first — is an ordering rule nothing enforces, failing only on the billing path.

**What did not move, and why.**

- **`@anthropic-ai/sdk` (~215 ms): stopped and reported, per this stage's own rule.** The seam is
  three synchronous functions, not one. `messagesClient()` constructs the client; `streamMessage()`
  calls it synchronously and is called by **eleven** stages; `anthropicCallFailed()` needs the SDK's
  error classes for two `instanceof` checks and is called from eleven `catch` blocks. Making
  `streamMessage` async is not only 24 call sites — it moves `beginSpend()`, which registers a call
  *before the stream opens*, to after an await, and `tests/messages-stream.test.ts` has concurrency
  cases that turn on exactly that ordering. That is a change to the spend ledger's semantics for 6%
  of the import, and `throw anthropicCallFailed(err)` compiles fine without the `await` — TypeScript
  will not catch a missed site. **Greg's call, not a stage's.** If it is wanted, the honest cost is
  ~50 edits across every pipeline stage plus a rename, so that a missed site is a compile error.
- **undici (162 ms standalone): nothing to win, measured.** jsdom requires it. Now that jsdom is lazy
  it may be worth a second look — `src/fetch.ts`'s `pinnedAgent` is the only user.
- **drizzle (`node-postgres` 865 ms + `pg-core` 760 ms) and `@sentry/node-core/light` (322 ms): the
  floor.** The shelf's own query goes through drizzle, and Sentry has to be up before the code that
  might fail. Together with the ~1.4 s of our own 3.5 MB of bundle, that is what the 1,470 ms is.

**Correctness, and the one way this could have been an outage.** A specifier the deployment's file
tracer cannot read is how two production outages started here (`@napi-rs/canvas`, then
`pdf.worker.mjs` — [260827a](../postmortems/260827a-pdfjs-dommatrix-serverless.md)): the bundle
ships, the package does not, every request 500s, and jsdom would take the **public reading page**
down with it because `src/sanitize.ts` is on that path. So it was measured rather than reasoned
about. `@vercel/nft` over the real built bundle collects **3,031 files before the change and 3,031
after**, with jsdom's entry point, all 637 of its files, pdf-lib's 139 and Stripe's 386 present in
both, and the same three pre-existing unresolved warnings (`canvas`, `pg-native`,
`cloudflare:sockets`) either side. `createRequire` also resolves correctly from `api-dist/` itself,
run there rather than argued about.

Two guards landed with it, and the second one was **watched go red for the right reason** — a static
`import { JSDOM } from "jsdom"` put back into `src/collect-assets.ts`, rebuilt, and the failure said
*"jsdom is imported at module scope again"* and named the seam it should have used. Reverted, rebuilt,
green again.

- `tests/pdf-bundle-trace.test.ts` — the three packages added to `MUST_SHIP`, so the real tracer has
  to keep collecting them.
- `tests/cold-start-lazy-imports.test.ts` — reads the emitted bundle's own import statements and
  fails if any of the three is back at module scope. Nothing else can see that happen: re-adding the
  import is *correct code*, passes every other test, and silently puts a second of cold start back.

`npm test`: **4 files / 5 tests red**, none of them mine. `store-jobs-parity` (2) prints the suite's
own `TEST DATABASE CONTENDED` banner and was red in this plan's baseline; `no-undeclared-spend` and
`admin-feedback-store` pass on their own; `diagram-css` reads `src/web/styles.css` and
`src/web/DiagramPanel.tsx`, neither of which anything in this tree has modified, so it is red against
committed CSS from `f3b8861d`. `npm run typecheck` and `npm run check`'s other gates are clean; biome
on the touched files reports only the two findings that were already there.

### Stage 5 — stale-while-revalidate

**Unblocked by Stage 1, and this is a change to the plan worth stating.** Sol's argument for putting
this last was that it hides the very thing Stage 4 is judged by. That argument was correct and is now
spent: Stage 1 committed a harness *and* two production log lines that report the cold start
regardless of what the client paints. **The measurement is permanent, so SWR can no longer conceal
it** — `firstRequest` brackets the whole invocation and cannot be improved by moving work around
inside it.

What survives is the ordering: Stage 4 is attempted first, so the cause gets its chance before the
symptom is covered. But this is no longer conditional on Stage 4 succeeding, because it is the thing
the reader actually feels and Greg named it as what he noticed.

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

**Done, 2026-09-03.** All seven bullets are built.
[`src/web/lib/cached-shelf.ts`](../../src/web/lib/cached-shelf.ts) reads the copy back and validates
it; [`useShelf`](../../src/web/useShelf.ts) owns the race and now takes a `readerId` passed down from
`SignedIn`. The generation counter is `answered`, a ref bumped by a live answer that paints **and by
a 401 that clears** — both are the server having spoken — and deliberately not by a transport failure
or a 5xx, which said nothing about the shelf and leave a late copy free to land under the error.

**And one thing the contract implied rather than said.** *Clear on a change of reader* is not one
edit: the previous reader's `GET /api/library` is still in flight, and when it lands it puts their
titles back one frame after we took them down. So there is a second ref, `reader`, bumped by the
effect and checked before anything writes a list — a separate number because it answers a separate
question (`settled` is *whether* the network has spoken; `reader` is *who about*). Its test was
watched go red too. The hole predates this stage, and eager painting is what made it worth closing
rather than noting.

**GPT Sol reviewed the built code and returned *not safe to commit* on three findings. All three
were right**, and the third names a test of mine that tested nothing.

- **An A response could be filed in B's IndexedDB partition**, and this stage is what made it
  matter. `saving()` and `attempt()`'s offline fallback both asked `lastKnownUser()` when the
  *answer* arrived, which is after the round trip — so a direct A→B sign-in inside that window put
  A's body under B's key, and the shelf now reads that key on every repeat visit rather than only
  when the network is gone. `apiFetch` captures the owner once, when the request goes out, and
  carries it into both. Two tests in `tests/api-fetch-offline.test.ts` switch the signed-in user
  *inside* the `fetch` stub; both were watched fail first. **Passing `readerId` down was necessary
  and was not sufficient**, which is the correction worth keeping.
- **The clear-on-reader-change is a passive effect, so it runs after the first commit for the new
  reader** — my comment claimed it was synchronous with the render, and that was simply false.
  `App.tsx` now gives `<Library>` a `key={user.id}`, which removes the frame by removing the
  instance; the hook still clears for itself, and now also clears `renaming`, `actionError` and the
  in-flight `archiving` set. Sol also found the writes I had left unfenced: `archive`'s reply sets
  `undoable`, and the Undo strip draws a **title** from it, so A's article could be named on B's
  screen with a button offering to restore it. `archive`, `undo`, `rename`, `restore` and
  `loadArchived` all check `stillOurs(asked)` before every `setState` now, and `loadArchived`'s check
  moved to after the body is parsed rather than before.
- **Overlapping reloads were unordered, and the test I wrote for that never called `reload` twice.**
  It posed two answers, reached the first, and was a duplicate of the case above it wearing a
  different name — a test that could not have failed. `answered` is now the pair `issued`/`settled`:
  each reload takes a number, an answer is applied only if it is not older than the newest one
  applied, and the cached read compares the same `settled` against what it was when it began. One
  pair serves both guards, so this is fewer moving parts than the counter it replaced, not more. The
  corrected test really does reload, a new one drives two reloads that finish in the other order, and
  both were watched fail.

**A second review of the fixes found two more, and both were right.**

- **Capturing the owner at the start of `apiFetch` was still the wrong rule.** It closed the window
  that spans the round trip and left a smaller one in front of it: the session can change *while the
  token is being fetched*, so the request goes out with B's token and the reply is filed under A.
  The rule Sol gave is better than the one it replaces — **the drawer belongs to whoever's token the
  server is about to check** — so `accessToken` now returns a `Credential`, the token and the id out
  of the same session object, and the refresh retry takes the id from the session the refresh
  returned. The test switches the account *inside* `getSession()` and was watched fail against the
  capture-at-start version. What was **not** taken is his further suggestion to refuse a request
  whose call-start owner and token owner differ: during a first sign-in they differ routinely
  (`lastKnownUser()` is null, the session has a user), so that rule would refuse legitimate traffic.
- **The ordering guard was on the success path only.** Two reloads overlap, the newer paints, the
  older then fails — and its message went up over a shelf that is perfectly current. Worse for
  `undo`, which awaits `reload()` and clears the Undo strip only if it resolves: an overtaken
  rejection leaves the strip and an action error on screen for an article that has already been
  restored and drawn. An overtaken failure is now neither reported nor rethrown but **resolved**,
  because the caller's post-condition — the shelf is current — is what the newer answer just made
  true. Watched fail first.

**What it does in a browser.** Headless Chrome against the dev server, one context so IndexedDB and
the session persist, `GET /api/library` held for 6,000 ms by a route interceptor, every time read
from the page's own `performance.now()`:

| | app mounted | first article | "Reading the shelf…" |
|---|---|---|---|
| repeat visit, copy saved | 2,091 ms | **2,391 ms** (18 articles) | **never appeared** |
| control, IndexedDB deleted | 2,208 ms | 8,658 ms | 2,840 ms |

The control is the half that makes the other half mean anything: same delay, same page, and it
behaves exactly as the homepage did before this stage. The ~2 s mount is the unbundled Vite dev
server on a loaded shared box and is not the shelf.

**The tests were watched go red, six ways.** Removing the cached read reddens 4 of the 13; removing
the generation check reddens 3 — including both "a late copy must not overwrite the live answer"
cases, which is the direction a boolean gets wrong; removing the cleanup's `cancelled` flag reddens
the change-of-reader test; removing the clear-on-reader-change reddens one; removing the 401 branch
reddens one; removing validation reddens 3.

**And one test cannot go red, which is written into it rather than left to be discovered.** React
silently drops a `setState` aimed at an unmounted root — no render, no warning — so *"commits nothing
after unmount"* passes against a build with `cancelled` removed. Measured, not assumed. The guard it
depends on is proved by the change-of-reader test, which exercises the same cleanup line; what is
left in the unmount test is that unmounting mid-read throws nothing and schedules nothing. It also
needs `IS_REACT_ACT_ENVIRONMENT`: without it, `root.unmount()` itself logs a `console.error` and the
assertion would have passed for the wrong reason, which is what it did on the first run.

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
Stage 1 (measure) — **done**, 2026-09-03; the harness, its numbers and the two log lines are in
§ Stage 1 above. Stage 4 has its shortlist, and it is not the one Stage 4 was written against.
Stage 2 (the offline envelope) — **done**, 2026-09-03.
Stage 3 (the two layout jobs) — **done**, 2026-09-03; the add box is 45% shorter at 1280 and 29%
shorter at 390, and both ways of uploading a PDF were exercised end to end. Reviewed by GPT Sol,
which returned *do not ship* on two findings; both are fixed and both are written up. Numbers in
§ Stage 3.
Stage 4 (reduce the cold start) — **done**, 2026-09-03, and it moved further than the stage expected:
the module import is **40% shorter**, 944 ms off a 2,371 ms median, paired 15 rounds out of 15.
jsdom, pdf-lib and Stripe left module scope; `@anthropic-ai/sdk` is **stopped and reported** rather
than done, because its seam is three synchronous functions and one of them would move the spend
ledger's ordering. Numbers, method and the tracer comparison in § Stage 4.
Stage 5 (stale-while-revalidate) — **done**, 2026-09-03; the repeat visit paints 18 articles while
the server is held for six seconds, and the control with the copy deleted still says "Reading the
shelf…". Table and the six red-first experiments in § Stage 5.

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
