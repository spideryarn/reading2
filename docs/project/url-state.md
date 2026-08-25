# URL state

Everything the reader can change lives in the query string. Nothing the reader can change lives in
`useState`, and nothing lives in `localStorage`.

> Ideally, I would like to be able to remember the state. So if I, for example, scroll down to a
> particular place in the doc for example (or changed something else, etc etc), that should update
> the URL somehow.
>
> — Greg, 2026-08-25

> if I reload the page, I'd like it to return to the same location
>
> Or if I send someone a url

Those last two are not two features. They are one property — **the URL is always current** — looked
at from two sides. Reload reads the address bar; copy-paste reads the address bar. Neither needs any
storage, any server, or any code of its own, and the two can never disagree about where you were.

The code is [`src/web/params.ts`](../../src/web/params.ts) (what a link means) and
[`src/web/position.ts`](../../src/web/position.ts) (the section arithmetic behind `?at=`). Both are
pure and both are tested — [`tests/url-state.test.ts`](../../tests/url-state.test.ts).

## The parameters

| Param | Meaning | History | Example |
|---|---|---|---|
| `slug` | which article | push | `?slug=noema-mythology-of-conscious-ai` |
| `cols` | which gist columns are on. **Absent means automatic** — fit to the window ([granularity-zoom.md § fitting](granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them)). Present means the reader chose, and the window must not overrule them. | push | `?cols=0,1,2`, or `?cols=none` |
| `text` | `1` reading mode, `0` outline mode | push | `?text=0` |
| `at` | the section in view, as its first block's id | **replace**, debounced | `?at=spya-tgnssb` |
| `note` | the explanation dialog that is open, as its comment id — [comments.md](comments.md) | **replace** | `?note=spya-k6fpme` |
| `about` | the masthead's details panel — source, counts, which model built the tree and the arc | **replace** | `?about=1` |

The bird's-eye rail is deliberately **not** a parameter. Its visibility is derived, not chosen — it
is off in outline mode and collapses to ticks when labels would cost a gist column, both decided by
`fitView` ([granularity-zoom.md § fitting](granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them)).
Nothing the reader sets means there is nothing to remember. If it ever gains a toggle it gains a
param, and `parseAsBit` is already the right parser for it.

`cols=none` exists because the empty list would otherwise serialize to an empty string, which is
indistinguishable from the parameter being absent — and absent means *automatic*, which is the
opposite of "the reader turned every column off".

## Three decisions

### Position replaces history; deliberate acts push

> scrolling should replace rather than adding to history because we don't need the back button to
> change scrolling
>
> — Greg, 2026-08-25

So `at` is `history: 'replace'` — the address bar stays current without ever adding an entry. Back
then undoes the last thing you *did*: switched article, toggled a column, went to outline mode. It
never crawls you back up the page one screen at a time, and it always eventually leaves the page,
which a scroll-history would make miserable (browsers throttle rapid Back, so 200 entries is not
merely tedious).

The one exception is **clicking a gist to jump**, which pushes. That is a scroll, but it is a
deliberate act — you flung yourself across the article and may well want that undone. The override is
per-call in `App.tsx`, not in the parser.

### Debounced, not throttled

Greg's suggestion, and the right one. Mid-flick the URL is of no use to anybody, so there is nothing
to gain by keeping it live through the movement and something to lose: browsers rate-limit
`replaceState` (~50ms in Chrome, ~120ms in Safari) and warn when you push past it. Waiting for the
reader to settle also means the URL records where they **landed**, rather than every section they
flew over on the way. `POSITION_SETTLE_MS` is 300ms.

### The unit is a section, not a position

> store the section rather than the exact position?
>
> — Greg, 2026-08-25

`?at=` holds the id of the **first block of the section the reader is in** — depth `leafDepth - 1`,
which is what `columnLabel` already calls "Sections". Three things follow:

- **The update rate collapses.** The example article is 139 blocks but 36 sections, so most scrolling
  writes nothing at all.
- **The URL means something.** "The section that starts here" survives the article being re-extracted
  at a different length. A pixel offset would be a lie the moment anything reflowed — and it reflows
  constantly here, because toggling a granularity column changes every row height.
- **It is a block id**, so it obeys [the one contract](block-ids.md). Position is a block id, never an
  offset and never a selector.

Stated plainly, the cost: reopening a link puts you at the top of the section you were in, not on the
paragraph you were on. Within a section that is a few paragraphs of backtracking.

**It is emphatically not a node id.** Node ids (`n0003`) are handed out sequentially when the tree is
generated and are regenerated whenever `tree.json` is rebuilt, so a URL holding one would silently
point somewhere else after the next run. Block ids are minted once and preserved. The distinction is
easy to lose because the section *is* a node — hence the id of its first **block**.

## Why the query string and not the hash

Deep links used to be `/#spya-k6fpme`. They now arrive as `?at=spya-k6fpme`;
[`main.tsx`](../../src/web/main.tsx) rewrites the old form before React mounts, so old links keep
working.

The hash had to go for two reasons. Blocks carry their id in the HTML, so the browser scrolls to the
block *itself* on load — and then our own code scrolls again to offset it below the sticky bars, so
you watch it land twice. And a hash-based position beside query-string everything-else is two
unsynchronised state systems, with `hashchange` and `popstate` to reconcile. One query string, one
listener.

Related: [`main.tsx`](../../src/web/main.tsx) sets `history.scrollRestoration = 'manual'`. The
browser's own restore is both wrong and late — wrong because the offset it remembers was measured
against whichever columns happened to be open, and late because it lands after ours and therefore
wins.

## The library: nuqs

Chosen 2026-08-25 against
[third-party-library-selection.md](../reusable/third-party-library-selection.md). **nuqs 2.10.0**,
published five days before it was picked; ~4.5M downloads a week, 10.8k stars, commits the same week.
`useQueryState` is deliberately `useState`-shaped, parsers are composable and typed, and it has one
runtime dependency.

Two things decided it over the alternatives:

- **It does not require a router.** `nuqs/adapters/react` is the plain-SPA adapter: one
  `<NuqsAdapter>` in `main.tsx`, no route tree, no Vite config. If this app ever gains a router we
  change that one import and every call site is untouched.
- **Rate-limiting and replace-vs-push are the API**, not something bolted on. Those are exactly the
  two decisions above, and they are one option each.

| Rejected | Why |
|---|---|
| **react-router v7** `useSearchParams` | Would mean adopting a router for state alone, and gives raw strings — no parsing, no defaults, no rate limiting. We'd hand-roll a parser layer on top and arrive back at nuqs. |
| **TanStack Router** | The strongest typed-search story of the lot, but it needs a full route tree. Real framework churn while the ideas are still moving; revisit if we ever get genuine multi-document routes. |
| **use-query-params** | The previous generation of this idea, and now inactive — last publish nine months ago. |
| **Hand-rolled `URLSearchParams` + `pushState`** | The four traps are all ones we'd hit: history spam from un-throttled writes, `push` where `replace` was meant, forgetting `popstate` so the UI drifts from the URL on Back, and re-parsing every render. Perhaps 150 lines to get right and then own. |

Gotcha worth knowing: `throttleMs` is deprecated as of nuqs 2.5.0. Use
`limitUrlUpdates: debounce(ms)` / `throttle(ms)`, which is what `params.ts` does.

## See also

- [web-client.md](web-client.md) — the reading view this is the state layer for
- [granularity-zoom.md](granularity-zoom.md) — what the columns and the spine actually do
- [block-ids.md](block-ids.md) — **read before touching anything that resolves an id**
- [browser-testing.md](browser-testing.md) — the URLs worth checking by hand
- [testing.md](testing.md) — what's pinned deterministically

## `note` replaces, even though opening a dialog is deliberate

Every other deliberate act pushes. `note` is the exception, and the reason is arithmetic rather than
principle: opening a panel and closing it again is *two* state changes, so pushing would put two
entries on the stack for one gesture and Back would walk the reader through panels they had already
finished with. Replacing keeps the paste-a-link property, which is the part that earns the parameter
its place.

A comment id is minted by the same `mintId` as a block id ([block-ids.md](block-ids.md)), so
`parseAsBlockId` validates it and a mangled `?note=` degrades to "no dialog" rather than to an
error — the same bargain as `?at=`.
