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
| 6 | server + client | unclaimed | — |

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
    tree.json       nodes: ranges, titles, gists
    reader.json     per-reader state: progress, highlights, notes (all keyed by block id)
```

Anything expensive is cached on a content hash. `tree.json` is keyed on
`hash(blocks.json) + prompt version + model id` — change any of those and it regenerates.

## Server and client

- One Node process, TypeScript + ESM, run with `tsx`. Express or Hono; pick one and don't revisit it.
- API is thin: `GET /api/article/<slug>` returns `meta + blocks + tree`. The client has everything
  it needs for every zoom level in one payload; zooming must never hit the network.
- React client. The reading view is described in
  [granularity-zoom.md § Interaction](granularity-zoom.md#interaction) — note especially that scroll
  position is a **block id**, never a pixel offset.
- LLM calls happen in the pipeline, not in request handlers. Before writing any Anthropic SDK code,
  load the `claude-api` skill for current model ids and parameters.

## Conventions

- TypeScript, ESM (`"type": "module"`), strict mode — see [`tsconfig.json`](../../tsconfig.json).
- Every stage is runnable on its own against a slug, so any one can be re-run without the others.
- Test article: `output/noema-mythology-of-conscious-ai.html` (Anil Seth, ~54 min, long and largely
  *unstructured*). It's the deliberate hard case for anything that assumes headings exist.
