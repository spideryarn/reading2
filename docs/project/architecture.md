# Architecture

## Intent

From the brief (Greg, 2026-08-24), verbatim:

> In terms of larger implementation, what I'm imagining is, well, we'll need a web server of some
> kind. It can be a simple one at first. Probably React. Each article — let's say we pull them from
> the web. We run Mozilla Readability … and then into sort of a more sanitized HTML. We give each
> paragraph a unique ID. We generate a table of contents that's quite deeply nested … all the way
> down to a paragraph level. And then we'll add a bunch of other readability — not readability,
> like reading assistant functionality as well.

So: a pipeline of small, independently runnable, independently cacheable stages, each writing JSON
to disk, feeding a simple server and a React client. "It can be a simple one at first" is a design
constraint, not an apology — keep it boring while the ideas are still moving.

## Pipeline

```
  URL
   │
   ▼
 ┌──────────┐   raw.html
 │ 1 fetch  │──────────────►  data/<slug>/raw.html
 └──────────┘
   │
   ▼
 ┌──────────┐   Mozilla Readability → sanitized HTML
 │ 2 extract│──────────────►  data/<slug>/article.html   + meta.json
 └──────────┘                 (title, byline, siteName, lang, url)
   │
   ▼
 ┌──────────┐   split into blocks, assign STABLE RANDOM IDS (see block-ids.md)
 │ 3 blocks │──────────────►  data/<slug>/blocks.json
 └──────────┘                 [{id:"spya-k3m9qt", tag, kind, level?, text,
   │                            words, html, gistable, note?}]  — array order
   │                            IS document order
   │
   ├─────────────────────┐
   ▼                     ▼
 ┌──────────┐        ┌──────────────┐
 │ 4 toc    │        │ 5 summarize  │   gist per node, bottom-up
 │ (tree)   │───────►│              │──►  data/<slug>/tree.json
 └──────────┘        └──────────────┘
   │
   ▼
 ┌──────────┐
 │ 6 serve  │  Node server + React client
 └──────────┘
```

Stages 4 and 5 are drawn separately but produce **one structure**. See
[the tree](granularity-zoom.md#the-tree): a deeply-nested table of contents that goes "all the way
down to a paragraph level" *is* the granularity-zoom tree. The ToC is that tree rendered as
navigation; the zoom view is that tree rendered as text. They must not diverge into two trees.

## What a block is <a id="what-a-block-is"></a>

**A block is the *finest* unit a reader takes in as one thing.** An `<li>` is a block; the `<ul>`
around it is not. Containers — `<ul>`, `<ol>`, `<div>`, `<section>` — are descended into and never
emitted.

The obvious alternative was one block per *top-level flow element*, treating a whole list as a
single block. We rejected it because it quietly decides something that isn't ours to decide. Greg's
framing (2026-08-24):

> a list of one-word bullets might only need an entry at the list level, but a list of detailed
> discussion-entries might need a ToC for each item

If the `<ul>` is one block, the second case is simply unreachable — no id exists to point at an
individual item, and no later stage can recover one. Making blocks the finest unit costs nothing and
turns that judgement into a choice the ToC makes per list: a node covering the whole list is one
row, the leaves beneath it are a row each. Both are just depths of a tree that already exists.

The same logic applies to an `<li>` containing a nested list: the item's own text and the sub-items
are separate readable units, so the item is emitted with its sublists stripped and the sublist is
descended into. Blocks in the flat sequence must never contain one another's text, or the tree's
ranges would overlap.

Not every block gets summarised. Images, rules, and pull-quotes that repeat body text carry
`gistable: false` — addressable, so the ToC can point at a diagram, but never the subject of a row
of their own. See [block-ids.md § What gets an id](block-ids.md#what-gets-an-id).

## Stage ownership

Several agents work this repo in parallel. Stay in your stage; communicate through the JSON
artefacts on disk, not by reaching into another stage's code.

| # | Stage | Owner | Artefact |
|---|-------|-------|----------|
| 1 | fetch | unclaimed (currently inline in `src/extract.ts`) | `raw.html` |
| 2 | extract / Readability / sanitize — see [content-extraction.md](content-extraction.md) | **extraction agent** | `article.html`, `meta.json` |
| 3 | blocks + stable ids — see [block-ids.md](block-ids.md) | **blocks + ToC agent** | `blocks.json` |
| 4 | table of contents (deeply nested) — see [table-of-contents.md](table-of-contents.md) | **blocks + ToC agent** | `tree.json` (structure) |
| 5 | summarize (gists per node) | granularity zoom | `tree.json` (gists) |
| 6 | server + client — see [granularity-zoom.md § The tabular view](granularity-zoom.md#the-tabular-view) | **granularity zoom** | `src/api.ts`, `src/web/` |

Stage 3 was previously unassigned. Greg settled it on 2026-08-24: it belongs with the ToC, since the
ToC is the first thing that has to address blocks and would otherwise be built on someone else's
assumptions about what a block is.

Current code: [`src/extract.ts`](../../src/extract.ts) (documented in
[content-extraction.md](content-extraction.md)) does fetch + Readability + a standalone HTML page in
one script, writing to `output/`. That's the prototype stages 1–2 are growing out of; the
standalone-HTML output becomes a debug view once the server exists.

## Storage

Filesystem, one directory per article, no database:

```
  data/<slug>/
    raw.html        raw fetched page
    article.html    sanitized, Readability-extracted
    meta.json       title, byline, site, lang, url, fetchedAt
    blocks.json     the block sequence with stable ids   ← the spine
                    (array order IS document order — block-ids.md)
    tree.json       nodes: ranges, titles, gists
    reader.json     per-reader state: progress, highlights, notes (all keyed by block id)
```

Anything expensive is cached on a content hash. `tree.json` is keyed on
`hash(blocks.json) + prompt version + model id` — change any of those and it regenerates.

## Server and client

- One process, one command: `npm run dev`. The API is currently mounted as **Vite dev middleware**
  ([`vite.config.ts`](../../vite.config.ts)) rather than as a separate server, so there is nothing to
  run in a second terminal while the ideas are still moving. The reads live in
  [`src/api.ts`](../../src/api.ts) as a plain transport-free `loadArticle(slug)` — that is the seam a
  standalone Node server wraps when one is needed, so choosing Express or Hono stays a deferred
  decision rather than a revisited one.
- `loadArticle` looks in `data/<slug>/` first and falls back to [`example/`](../../example/README.md),
  the hand-authored placeholder. Real pipeline output therefore supersedes the fixture with no code
  change.
- API is thin: `GET /api/article/<slug>` returns `meta + blocks + tree`. The client has everything
  it needs for every zoom level in one payload; zooming must never hit the network.
- React client. The reading view is described in
  [granularity-zoom.md § Interaction](granularity-zoom.md#interaction) — note especially that scroll
  position is a **block id**, never a pixel offset. Brand and reading tokens come from
  [`styles/tokens.css`](../../styles/tokens.css), and the logo/favicons from
  [`public/`](../../public/) — both lifted from the previous version, see
  [PREVIOUS_VERSION.md](PREVIOUS_VERSION.md). Plain CSS variables, adopt or remap as you like;
  Spideryarn orange `#DB8A45` is the accent, light mode only.
- LLM calls happen in the pipeline, not in request handlers. Before writing any Anthropic SDK code,
  load the `claude-api` skill for current model ids and parameters.

## Conventions

- TypeScript, ESM (`"type": "module"`), strict mode — see [`tsconfig.json`](../../tsconfig.json).
- Every stage is runnable on its own against a slug, so any one can be re-run without the others.
- Test article: `output/noema-mythology-of-conscious-ai.html` (Anil Seth, ~54 min, long and largely
  *unstructured*). It's the deliberate hard case for anything that assumes headings exist.
