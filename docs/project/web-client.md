# The web client (stage 6)

The reading view: the article rendered as a table, one row per block, columns running coarse to
verbatim. Greg's framing, 2026-08-24:

> up-down is chronology in the document and left-right is granularity, with a column for each level
> of the table of contents

> so by scrolling rightwards, you get more detail. By scrolling downwards, you progress through the
> chronology of the article.

Why the feature exists and what a gist may and may not be:
[granularity-zoom.md](granularity-zoom.md). This doc is just the client's own signposts.

## Where the code is

| File | What it does |
|---|---|
| [`index.html`](../../index.html) + [`src/web/main.tsx`](../../src/web/main.tsx) | Vite entry |
| [`src/web/App.tsx`](../../src/web/App.tsx) | fetches `/api/article/<slug>`, masthead, the granularity controls |
| [`src/web/tree.ts`](../../src/web/tree.ts) | tree → table geometry (`rowSpan` per node range) |
| [`src/web/TableView.tsx`](../../src/web/TableView.tsx) | the table itself: hover chain, deep links |
| [`src/web/Spine.tsx`](../../src/web/Spine.tsx) | the bird's-eye rail down the far left — [granularity-zoom.md](granularity-zoom.md#the-spine-a-birds-eye-rail) |
| [`src/web/Tooltip.tsx`](../../src/web/Tooltip.tsx) | hover tooltips over Floating UI — [tooltips.md](tooltips.md) |
| [`src/web/styles.css`](../../src/web/styles.css) + [`styles/tokens.css`](../../styles/tokens.css) | reading typography and brand tokens, lifted from [the original version](original-version.md) |
| [`src/web/params.ts`](../../src/web/params.ts) | what every URL parameter means — [url-state.md](url-state.md) |
| [`src/web/position.ts`](../../src/web/position.ts) | reading position → the section that goes in `?at=` |
| [`src/web/layout.ts`](../../src/web/layout.ts) | which columns fit and how wide — [granularity-zoom.md](granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them) |
| [`src/web/scroll.ts`](../../src/web/scroll.ts) | `scrollToBlock`, shared so a restore and a jump land identically |
| [`src/api.ts`](../../src/api.ts) | server side: `loadArticle(slug)`, mounted as dev middleware in [`vite.config.ts`](../../vite.config.ts) |

Running it: [setup-dev.md](setup-dev.md). Slug selection is `/?slug=<slug>`, defaulting to
`noema-mythology-of-conscious-ai` — the real pipeline output, which is gitignored, so a fresh clone
falls through to the committed `example/` fixture and still works ([`src/api.ts`](../../src/api.ts)).
Deep links are `/?at=spya-k6fpme`. Every other bit of view state is in the URL too —
see [url-state.md](url-state.md) for the full set and for why scrolling *replaces* the history
entry while toggling a column *pushes* one.

## Dark mode

The reading view is **dark only** — an all-but-black page, off-white text, Spideryarn orange
unchanged. There is no toggle, no `prefers-color-scheme` branch and no light fallback. Greg,
2026-08-24:

> actually, it's night, and I'd quite like to be in dark mode. I don't want to add too much
> complexity, so I'm happy just to switch over and say we're going to make it always be in dark mode
> … which means the CSS is going to need a black background, white text, but keep the orange where
> possible.

This reverses the "light mode only" inherited from the original app — see
[original-version.md § Decision: the palette](original-version.md#decision-the-palette), which now
records the reversal. What made it cheap: the palette had already been collapsed into one source, so
switching themes meant changing values, not chasing colours through the stylesheet.

How it's put together, and what to know before touching it:

- **The variable *names* did not change.** [`styles/tokens.css`](../../styles/tokens.css) still
  defines `--background`, `--foreground`, `--muted`, `--sidebar` and friends; only their values
  flipped. Nothing downstream needed rewiring, and anything copied from the original codebase still
  resolves.
- **The orange is untouched — `#DB8A45`, unconditionally.** It's the one colour that needed no
  adjusting, and it works *better* here: `#DB8A45` on the near-black page is about 7.8:1, against
  about 2.6:1 on white. Orange text was borderline in light mode and is comfortable now, so the
  highlight can carry more work than it used to.
- **Not literally black-on-white inverted.** The page is `oklch(0.145 0 0)` and the text
  `oklch(0.97 0 0)`, because pure white on pure black haloes badly in Georgia at 17px.
- **Soft and faint greys run the other way.** In [`src/web/styles.css`](../../src/web/styles.css),
  `--ink-soft` / `--ink-faint` now *descend* in lightness from `--ink` instead of ascending. Anything
  that read `color-mix(…, black)` to darken the orange became `color-mix(…, white)` to lift it — that
  one lives in `--highlight-ink` now, so it's stated once.
- **Panels are lighter than the page, not darker.** `--sidebar` sits above `--background`; on a dark
  ground a raised surface reads as forward. The same inversion catches `--accent`, which is still
  shadcn's "hover surface" meaning and is now a dark grey — the trap described in
  [original-version.md](original-version.md#brand-facts-now-load-bearing) is unchanged in kind, only
  the failure mode flipped: a highlight that goes near-white becomes one that vanishes into the page.
- **`color-scheme: dark` is declared twice on purpose** — on `:root` in `tokens.css` for scrollbars
  and form controls, and again as a `<meta>` in [`index.html`](../../index.html) so the browser
  paints its canvas dark *before* the stylesheet loads. Without the meta there's a white flash on
  first paint. `theme-color` is the page black rather than the orange for the same reason.

If a light mode is ever wanted back, the shape of the change is a `[data-theme]` attribute on
`:root` and a second block of the same variable names — not a `prefers-color-scheme` media query,
which would give the reader no way to override it.

## The constraints it works under

- **Position is a block id, never a pixel offset or a selector.** Scroll restore, deep links,
  everything — and it is stored as the id of a *section's first block*, never a node id, which is
  regenerated with the tree ([url-state.md](url-state.md#the-unit-is-a-section-not-a-position)).
  [block-ids.md](block-ids.md) — read it before touching anything that resolves an id.
  In particular, ids are random: resolve a range by looking both endpoints up in the block sequence,
  never by comparing id strings.
- **One payload, no network on zoom.** `GET /api/article/<slug>` returns `meta + blocks + tree`
  together, so changing granularity is pure client state
  ([architecture.md § Server and client](architecture.md#server-and-client)).
- **The table geometry assumes a valid tree.** Contiguous ranges, children exactly partitioning
  their parent ([granularity-zoom.md § The tree](granularity-zoom.md#the-tree)). A tree that breaks
  those renders a plausible *wrong* article rather than an error — run `npm run validate-tree`.
- **Never substitute generated text for prose silently.** The verbatim column is the author's words;
  a gist stands in for text only where the reader chose that level. See
  [vision.md](vision.md#principles) — "no hidden reformulation".
