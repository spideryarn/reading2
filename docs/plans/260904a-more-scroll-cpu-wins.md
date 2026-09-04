# A few more scroll wins, and one of them is not React's fault

**Status:** built and measured, 2026-09-04. Reviewed at plan stage by GPT Sol
([the answer](260904a-more-scroll-cpu-wins-review-sol.md)), which found a real hole in stage 2 before it
shipped — see there. Awaiting the second, built-code review.

Follows [260903l](260903l-prose-innerhtml-rewritten-on-every-scroll-render.md), which took scrolling a
551-block article from **77% to 49% of one core** by stopping React rewriting every paragraph's
`innerHTML` on every render. Greg then asked how much work and how much benefit was left, and
afterwards: *"looking for a few more big wins that won't add too much complexity"*.

**The constraint is in that sentence.** Two clean wins beat four braided ones. Anything that adds a
second way to do something already done here is out, whatever it measures.

## What is left, and how we know

A **floor experiment** decided the ceiling of everything below. The live DOM was captured, every
`<script>` stripped, the stylesheet re-pointed at the production CSS, and the result served and
scrolled with the same wheel pattern. That is what the browser costs with no JavaScript at all. Two
runs each, both against the **production** build, both on the same 551-row / 66,123px / 14,371-node
page.

| 25s of wheel events on the same document | main-thread CPU, % of one core | script | layout | style | layouts | style recalcs |
|---|---:|---:|---:|---:|---:|---:|
| live app, production build | 46.4 / 49.0 | 18.6 / 17.4 | 0.8 | 0.9 / 0.8 | 354 / 361 | 445 / 446 |
| static clone, zero JS — **the floor** | **11.9 / 11.9** | 0.5 | 0.1 | 0.0 | **5** | **0** |

**The floor is around 12 points, not 20.** An earlier note in this plan said "roughly 20 points are
irreducible", from a comparison against the *dev* server with a cruder probe. The runs above are the
ones to believe, and they point the other way: most of the 49 is app-attributable, so it argues for
going after renders rather than after the browser's own layout cost.

**Two things stop that subtraction being exact, and both were GPT Sol's.** The two sides did not
receive the same input — 325–335 wheel events live against 369–370 static, which is the harness bias
stage 0 fixes — so "35 app-attributable points" is a direction, not a figure. And "zero JS" is
literally false: the frame probe is JavaScript, which is what the floor's 0.5% script time *is*.
Read it as **zero application JavaScript**.

Only the first column is CPU (`ThreadTime`); the four after it are wall-clock inside main-thread
tasks — [§ The last column is not CPU](../project/performance.md#the-last-column-is-not-cpu).

### What a reader can actually feel

The frame probe is the number that matters more than the percentage, and it is the one nobody had
looked at:

| | median frame | p95 | worst | frames over 32ms |
|---|---:|---:|---:|---:|
| live app | 16.7ms | **33.4 / 33.3ms** | **133 / 117ms** | **94 of 1300, 89 of 1325 — about 7%** |
| static clone | 16.7ms | 16.8ms | 33.4ms | 4 of 1497 — 0.3% |

**The live page drops about one frame in fourteen; the same document with no JavaScript drops one in
three hundred.** The scroll itself stays smooth because it is compositor-driven — every `wheel`
listener on the page is passive ([`keynav.ts:402`](../../src/web/keynav.ts),
[`swipe.ts:329`](../../src/web/swipe.ts), [`scroll.ts:457`](../../src/web/scroll.ts),
[`follow.ts:172`](../../src/web/follow.ts)) — so what a reader sees lag by up to a tenth of a second
is the panels, the spine band and the gist columns, not the prose.

**Whether those long frames *are* the `TableView` renders was an assumption**, and Sol was right to
say the tables do not demonstrate it — a render count and a long-frame count sitting in the same run
is not a correlation. Stage 2 turned it into evidence the only way available: remove the renders and
see whether the long frames go. They did, from 10.8% of frames to 2.6%.

### The scroll-distance anomaly was the harness, and it biases every comparison

An earlier note called out that the live page covered 10,740px while the static clone covered
25,440px, and worried it was dropped frames. It is not, and that pair of numbers came from the dev
run. In production the gap is real but small: **325 / 335 wheel events dispatched live against
370 / 369 static**, and 39,000 / 40,200px of travel against 44,400 / 44,280px — about 11%, and
`totalDistance` is exactly `dispatched × 120` on both sides, so **every event that was sent landed
its full delta**.

The mechanism is the dispatch loop `await`ing each `Input.dispatchMouseEvent` ack before sleeping, so
a busy renderer starves it: live `sendMsTotal` is 5,364ms of the 25s window against 2,661ms static,
with 8 sends over the step interval against 0.

**The consequence is worth more than the explanation.** A slower page receives fewer wheel events, so
it is asked to do less work — which means every before/after run on this harness has **understated**
the improvement, including the 77→49 in 260903l. Fixed in stage 0.

## Stages

### Stage 0 — make the harness stop flattering the slow side

One change to [`measure-cpu.ts`](../../scripts/measure-cpu.ts): dispatch wheel events on a fixed
cadence instead of awaiting each ack (or await with a cap), and promote `dispatched` and
`totalDistance` to printed outputs alongside the CPU line. Without it, "before" and "after" are not
given the same input, and the bias runs in the flattering direction.

Also written into [performance.md](../project/performance.md): **where the pointer is, is a variable
in every measurement**, and the pointer-position runs below are how that was established.

### Stage 1 — cache `page(blocks)` — **done**

One `WeakMap<Block[], Page>` in [`search-hits.ts`](../../src/web/search-hits.ts), and `findLiteral`
switched to use `page()` rather than its own copy of the same `blocks.map(renderedText)` loop.

Not a scroll win. It is the largest O(article) computation **that anybody has identified** in the
client — Sol's correction; "the largest" was unmeasured — and it addresses
[`performance.md § Still open`](../project/performance.md#still-open-ranked-with-citations) item 2.

**Not "closes it outright", which the first draft claimed twice.** Item 2 also says the search commits
twice per keypress, and a cache does nothing about that. Nor does this "take the parse half out of
item 1": comment and chat anchor resolution call `renderedText` directly
([`TableView.tsx:424` and `:435`](../../src/web/TableView.tsx)), on a path `page()` never touches.

**It turned out to be two functions, and the second one is why the item would otherwise have been
closed dishonestly.** `literalSpans` called `foldCase` on its block — a walk by code point building a
`number[]` as long as the text — **once per block, per keypress**. That is the "folded text and offset
map" half of item 2, and caching the parse would have left it running while the item was marked done.
It now has its own `WeakMap` on the same `blocks` key, filled **lazily**: five of the six resolvers
never fold anything, and a reader who never opens the find box should not be holding an offset map
the length of the article in case they do. Two small caches rather than one larger `Page`, for that
reason and no other.

**Done, and this is what was watched:** [`tests/article-parsed-once.test.ts`](../../tests/article-parsed-once.test.ts)
counts parses through a `vi.mock` spy on `renderedText` and folds through
`String.prototype.toLowerCase`. Three of its assertions were **watched red on the old code** — a
second resolver call and a second keystroke each re-did the whole article (`expected 10 to be +0`,
`expected 530 to be less than 150`). The fourth, that folding is lazy, guards a decision rather than
a bug that existed, so it was never red; the test says so in its own comment rather than implying
otherwise.

An early draft of the fold test asserted a resolver made **zero** `toLowerCase` calls and was wrong
by 52 — `quote-match.ts` lowercases too. Every assertion there is now about the *difference* a
whole-article fold makes, not an absolute count. And each test builds its own `blocks` array, because
a `WeakMap` entry outlives the test that made it and a shared fixture let the second test measure the
first one's leftovers.

### Stage 2 — `memo(TableView)` and `memo(Spine)` — **done**

The big one. `TableView` takes **28 props and 24 were already identity-stable.** The four that were
not were inline arrows at the call site in [`App.tsx`](../../src/web/App.tsx) — `onOpenChat`,
`onChatAbout`, `onSelect`, `onOpenComment` — and each closes only over values that are themselves
stable. Four `useCallback`s and one `memo()`. `Spine` needed nothing but the wrapper.

**Nothing inside `TableView` changed.** And nothing blocked it: `useReadingPosition` returns
`{ at, jumpTo }` and `at` is never passed to `TableView` nor derived into any prop, so the memo was
not dead on arrival. Sol verified the second dependency level too, and pinned the one claim that
would have made the whole stage worthless if false — that nuqs's `useQueryState` setter is
identity-stable, so `onJump` is (`nuqs/dist/index.js:715`, `:572`, `:495`; adapter `react.js:52`).

Two corrections it made to the plan's own reasoning, both kept:

- **"No `createContext` in `src/`" is not "no context".** Lucide's icons consume one
  (`lucide-react/dist/esm/Icon.mjs:14`), and a context update routes around `memo`. It happens to be
  safe because `main.tsx` passes constants and Lucide memoises the value — but the argument had to
  be about *that*, not about our own source.
- **`Reader` does not go to zero renders**, which the plan claimed. It owns the `?at=` subscription,
  so it goes on rendering; only its memoised children skip. Measured: `Reader` 87–88 before, 88–89
  after. Unchanged, exactly as predicted.

#### The hole Sol found, which would have shipped

[`blockHref`](../../src/web/BlockRef.tsx) built 551 permalinks a render by reading `location.search`
**during render with no subscription**, justified by "every parameter in the URL is `useQueryState`
in App, so any change to the query string re-renders this whole tree".

That was half true, and the half that was false is the interesting half. **nuqs subscriptions are
key-isolated**: the adapter filters `location.search` down to the keys each hook watches and returns
the cached snapshot when those are unchanged (`nuqs/dist/adapters/react.js:37`). So ten reading
parameters owned by *child* components wake only that child and never `Reader` at all — Sol's audit
names them: `rank`, `bar`, `run`, `conf`, `deep`, `diagram`, `dx`, `dhue`, `referee`, `remember`.

It never bit, because `?at=` re-rendered the whole reading view eighty-odd times a scroll and
refreshed every href on the way past. **The memo turns a self-healing staleness into a permanent
one**: change the diagram's hue, copy a paragraph's link, send somebody the view you had a minute
ago. My first version of this stage passed the query string down as a prop and read it from
`location.search` in `Reader` — which has exactly the same hole, because `Reader` is one of the
components that does not wake.

Sol's fix was a `useQueryStates` subscription over an inventory of the reading parameters, kept in
`params.ts`. **What landed is different, and the reason is the thirty-sixth parameter.** An inventory
is correct until somebody adds one and forgets, and the failure is a quietly wrong link rather than
anything that breaks. So [`router.ts`](../../src/web/router.ts) gained `watchHistoryWrites()`, which
wraps `history.pushState`/`replaceState` to fire the app's existing `NAVIGATED` event, and
`useAddressSearch()`, a `useSyncExternalStore` whose snapshot is the query **string** — so `Object.is`
compares it by value and a write that changes nothing renders nothing. `Reader` subscribes, drops
`at`, and passes the rest down as `carried`.

Patching history is not a new kind of thing here: nuqs's own `enableHistorySync()` does it, and
[`main.tsx`](../../src/web/main.tsx) already carries the long note on why we opted into that. This is
one more wrapper on the same function, called explicitly next to it so the order is a decision.

Two things fell out of it that are worth more than the perf:

- **`blockHref` stopped round-tripping through `URLSearchParams`**, which re-encodes `?cols=0,2` as
  `?cols=0%2C2` — still correct, still parses, and no longer readable by the person you send it to.
  `carriedSearch` and `params.ts` both refuse that round trip on purpose; this one was quietly doing
  it. Building the address as text is also *shorter* than what it replaced.
- **The `<a href>` and the click handler now use the same string.** They were two separate calls to
  `blockHref`, which is a link whose status bar and whose click can disagree.

Dropping `at` reuses `hasKey` from `router.ts` rather than a new filter, and that matters: `?%61t=`
is `?at=`, so the obvious `startsWith("at=")` leaves both in the query and `get("at")` returns the
stale one. That was the ninth address bug here and the second of its exact shape.

**Two things deliberately not done**, both the "silently never updates" shape: no custom `areEqual`
comparator (the tempting one compares `block.id` and freezes the prose forever), and the
`?? { __html: block.html }` fallback at `TableView.tsx:1036` stays on the parent's side of any future
memo boundary — a block missing from the map would otherwise get a fresh object every render and go
straight back to unconditional `innerHTML` writes, for that one block. That is
[260903l](260903l-prose-innerhtml-rewritten-on-every-scroll-render.md) reintroduced.

#### What it measured

Both sides on the production build, the **same harness**, and — because of stage 0 — the same input:
417 wheel events and 50,040px of travel on every run. "Before" is a detached worktree at `HEAD`,
built and served on its own port.

| 25s scroll | before | after |
|---|---:|---:|
| `TableView` renders | 87 / 88 | **0 / 0** |
| `Spine` renders | 149 / 151 | **63 / 63** |
| `Reader` renders | 87 / 88 | 89 / 88 |
| **main-thread CPU**, % of one core | 56.1 / 55.1 | **44.1 / 42.1** |
| **p95 frame** | 66.6 / 50.0ms | **16.8 / 16.8ms** |
| **frames over 32ms** | 12.1% / 9.5% | **2.8% / 2.4%** |
| frames drawn in the window | 1163 / 1209 | 1452 / 1453 |

The frame numbers are the ones to quote. **p95 goes from 50–67ms to 16.8ms** — from a tail below
20fps to a clean 60fps frame — and roughly one dropped frame in nine becomes one in thirty-eight.
The page also draws about 22% more frames in the same window.

`Spine` halving rather than going to zero is right: the rail has its own scroll listener and *should*
re-render as the reader moves. What went was the half its parent was causing.

**A null result caught on the way, and it is the reason to say all this out loud.** The first
"before" run reported `Reader=89 Spine=63` and no `TableView` at all — identical to the after. The
`vite preview` serving the old build had resolved its `outDir` against the wrong working directory
and was serving the *new* bundle to both ports. Both pages answered 200, both rendered 551 rows, and
the only thing that gave it away was that the before numbers were too good. `curl`ing the two script
tags settled it: `index-x25MXLI8.js` against `index-HpPRPUZM.js`.
[silent-success.md](../reusable/silent-success.md), again, and this page's own rule about believing
the `N rows` line rather than the percentage does not go far enough — **check you are measuring two
different things.**

### Not a stage — hovering the prose, which two reviewers predicted and the measurement refuted

Both the survey and Fable independently flagged this, and it was the most interesting thing either of
them said, so it was measured before anything was built on it.

The prediction: [`TableView.tsx:826`](../../src/web/TableView.tsx) sets `hoveredRow` state on
`onMouseEnter`, and Chrome dispatches boundary events when elements move under a **stationary**
pointer — so wheel-scrolling with the cursor resting on the prose, which is where a reader's cursor
is, would fire one `setHoveredRow` per row crossed, each a full `TableView` render. If true it would
have been larger than everything else here, and `React.memo` would not have touched it, because the
state lives inside the memoised component.

**It does not happen.** Production build, `?perf=1`, 25s of wheel events, coordinate verified each run
with `table.zoom.contains(document.elementFromPoint(x, y))`:

| pointer | verified | `TableView` renders |
|---|---|---:|
| (400, 400), over a `<figure>` inside a row | `insideTable: true` | 77, 79, 77 |
| (5, 400), on the spine rail | `insideTable: false` | 74, 76 |

`Spine` moved the same small amount (131 against 127), and `Reader` tracked `TableView` exactly in
every run. A 3.5% gap is run-to-run noise, not a mechanism.

Then the mechanism itself was checked rather than inferred: a capture-phase `mouseenter` listener
scoped to `tr[data-block]`, 60 synthetic wheel events over 3.6s with the pointer held still over the
table — **0 events**. The same listener with three real `mouse.move()` calls across row boundaries at
the same coordinates — **12 events**. The instrument works; the hover simply is not firing. This
Chrome does not recompute hover targets from a compositor scroll under a stationary synthetic
pointer.

**What that leaves open, said plainly:** it rules out the mechanism for *synthetic* wheel events over
CDP. A real trackpad on real hardware may behave differently — some user agents do recompute `:hover`
after a scroll with no pointer motion — and closing that needs a real input device, which nobody
here has. It is not a reason to build anything now.

**And it corrected the render count.** Every earlier note said ~34 renders per scroll; the measured
figure is **77–79**, with `Reader` tracking it exactly. That makes stage 2 worth more than it looked,
not less.

### Folded into stage 2 — `blockHref` parsing the query string 551 times a render

[`BlockRef.tsx:64`](../../src/web/BlockRef.tsx) does `new URLSearchParams(location.search)` →
`set("at", id)` → `toString()` per call, once per block. ~18,700 parse-and-serialise cycles per
scroll today. The carried query does not depend on the row, so it can be built once per render and
the `at=<id>` concatenated.

**It is done, as part of stage 2 rather than after it**, and Sol was right that it had to be: stage 2
composes the address once and passes it down, so leaving a second implementation parsing it 551
times would have undone the thing it just built. The old "~18,700 calls" figure in the first draft
was stale anyway — at the measured 87 renders it was closer to 48,000.

## Not doing: memoise the rows

The survey found 0 hard props at the row level too, so it is buildable — but it buys nothing stage 2
does not already buy for scrolling, and it costs an extracted component, a reshaped prop list
(`hitStrength.get(id)` rather than the Map, and so on) and a new `activeChain`-shaped decision where
passing the `Set` re-renders all 551 rows on every hover. That is more parts touching each other for
a case stage 2 covers, and the measured result is that stage 2 covers it completely: `TableView`
renders per scroll went to **0**, so there is no per-row reconciliation left to skip. If a
real-hardware measurement ever shows hover is a cost, revisit — as a hover question, not a scroll
one, and Sol's cheapest version is to replace the three `.row-active` selectors with `tr:hover` and
keep `hoveredRow` only when `columns.length > 0`.

## Already done, found while surveying

**`performance.md § Still open` item 5 is stale.** It says an article with no glossary rebuilds
`termSelections` every render because `App.tsx` reads `glossaryRead.glossary?.entries ?? []`. That
was fixed by the reader-capability work: [`App.tsx:1875`](../../src/web/App.tsx) now falls back to
`NO_TERMS`, a module constant in
[`reader-capability.ts:156`](../../src/web/reader-capability.ts), with a comment saying exactly why.
The doc is corrected as part of this plan.

## Off the table

**`content-visibility: auto` on the rows.** It was the one candidate that attacked the browser's own
cost rather than ours, and both reviewers killed it. CSS containment does not apply to internal table
elements, so it cannot go on `tr` or `td` at all — it would have to go on `div.prose`, leaving the
gist cells and gutters laid out anyway. And the failure mode is worse than the no-op: a row that has
never been on screen takes its `contain-intrinsic-size` estimate, so `scrollToBlock` and a deep link
land at a position that then shifts as neighbours render, the spine's bands are built from estimated
heights, and every row that becomes rendered changes `scrollHeight` — which fires `Spine`'s
`ResizeObserver(document.body)`, 551 rect reads and a rail re-render. A new per-scroll cost and a
correctness regression, with the CPU number looking good while both happened.

**Two corrections from Sol, and the first is embarrassing.** The draft dismissed this partly because
"layout is already 0.8%" — which is `LayoutDuration`, wall-clock inside tasks, *not CPU*, and
`content-visibility` avoids paint and raster work as well as layout. That is the same category
mistake [§ The last column is not CPU](../project/performance.md#the-last-column-is-not-cpu) exists
to prevent, in softer form, one round after making it outright. And it is **not a general no-op**:
`.prose` is an ordinary block and is perfectly eligible, so a version that goes there rather than on
the rows exists and would keep every row and every stable id in the DOM. The height-estimation,
deep-link, spine and `ResizeObserver` risks above are what rule it out for *this* round, not
ineligibility.

If anybody picks it up, Sol's shape for the experiment is right: a static-clone A/B with a fixed
wheel count and explicit `scrollToBlock` and deep-link checks, not a product change. And a DOM tag
census first — every block carries a Lucide permalink SVG and every owner row another chat SVG
([`BlockGutter.tsx`](../../src/web/BlockGutter.tsx) around lines 287 and 334), so several hundred
invisible SVG subtrees are in the floor and nobody has priced them.

**Virtualising the table** — rendering only the visible rows — is the largest theoretical win and is
not going to happen. Every feature here addresses text by a stable block id and assumes the whole
document is in the DOM: Hierarchy, search hit marks, comment anchors, the reading position,
`follow.ts`. Virtualisation is not an optimisation of that design, it is a different one. Fable's version of the
objection is more concrete than the contract: [`scroll.ts`](../../src/web/scroll.ts),
[`keynav.ts:217`](../../src/web/keynav.ts), `Spine.measure`, `useReadingPosition`,
[`useColumnContext.ts`](../../src/web/useColumnContext.ts),
[`internal-links.ts`](../../src/web/internal-links.ts) and the hover card all find rows with
`document.querySelector('tr[data-block=…]')` and read their rects. Virtualising means giving every
one of them a virtual coordinate model, which is the whole client.

**Merging the four per-frame `window.scrollY` readers.** Layout is 0.8% and 354 layouts in 25s; the
per-frame reads are bounded and forced layouts are not the cost. A coordination refactor across four
files for no measured win.

## Appendix: how `page(blocks)` was found, and what it cost

[`search-hits.ts`](../../src/web/search-hits.ts) built a `Page` from the blocks:

```ts
function page(blocks: Block[]): Page {
  const texts = blocks.map((b) => renderedText(b.html));
  return { index: new Map(blocks.map((b, i) => [b.id, i])), texts, scale: ruler(texts) };
}
```

and `renderedText` ([`annotate.ts`](../../src/web/annotate.ts)) is
`document.createElement("div"); el.innerHTML = html; return el.textContent` — **a full HTML parse per
block**, 551 of them per call on the test article.

Six exported resolvers call it. Two of them **inside a loop**:
[`ClaimsPanel.tsx`](../../src/web/ClaimsPanel.tsx) once per shown claim,
[`CriteriaPanel.tsx`](../../src/web/CriteriaPanel.tsx) once per ticked criterion — so referee mode
was **O(claims × blocks)** parses, and ticking one criterion paid for all of them again.
[`App.tsx`](../../src/web/App.tsx) paid a whole pass per search keypress, and `foldCase` paid a
second one underneath it.

**One precondition, and it is not enforced.** Keying on the array's identity is only sound because
`article.blocks` is replaced wholesale rather than mutated — `sanitizeArticle`
([`sanitize.ts`](../../src/web/sanitize.ts)) returns a new array, and nothing on the client mutates
one in place. But `Article.blocks` is a mutable `Block[]` in [`types.ts`](../../src/types.ts), so the
type permits what the cache forbids. Sol's advice, and it is right: do **not** add a content hash —
that is a parse to avoid a parse — but move these APIs towards `readonly Block[]` when something
else is open in there.

## Loose end, not a stage

The live page reports **51,822 event listeners** (`counts.listeners` in the production run), against
zero on the static clone — about 94 per block. No application code attaches anything per element;
React's delegation and its `onclick = noop` trap account for some thousands at most. Five minutes
with `getEventListeners($0)` on a `tr`, a `td`, a prose `<a>` and `document` would name it. Not a
scroll cost as far as anything here shows, but 94 per block is not a number to leave unexplained.
