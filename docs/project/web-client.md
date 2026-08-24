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
| [`src/web/styles.css`](../../src/web/styles.css) + [`styles/tokens.css`](../../styles/tokens.css) | reading typography and brand tokens, lifted from [the original version](original-version.md) |
| [`src/api.ts`](../../src/api.ts) | server side: `loadArticle(slug)`, mounted as dev middleware in [`vite.config.ts`](../../vite.config.ts) |

Running it: [setup-dev.md](setup-dev.md). Slug selection is `/?slug=<slug>`, defaulting to
`example`; deep links are `/#spya-k6fpme`.

## The constraints it works under

- **Position is a block id, never a pixel offset or a selector.** Scroll restore, deep links,
  everything. [block-ids.md](block-ids.md) — read it before touching anything that resolves an id.
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
