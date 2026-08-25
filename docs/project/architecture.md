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
 ┌──────────┐   Mozilla Readability (NOT a sanitiser — security.md)
 │ 2 extract│──────────────►  data/<slug>/article.html   + meta.json
 └──────────┘                 (title, byline, siteName, lang, url)
   │
   ▼
 ┌──────────┐   SANITIZE (security.md), split into blocks, assign STABLE
 │ 3 blocks │   RANDOM IDS (block-ids.md)
 │          │──────────────►  data/<slug>/blocks.json
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
| 1 | fetch — see [fetching.md](fetching.md) | **fetch agent** ([`src/fetch.ts`](../../src/fetch.ts)); run as a step of the ingest queue, [ingest-queue.md](ingest-queue.md) | `raw.html` |
| 2 | extract / Readability — see [content-extraction.md](content-extraction.md) | **extraction agent** | `article.html`, `meta.json` (the article's identity — [library.md](library.md#metajson-and-the-articles-identity)) |
| 3 | **sanitize** + blocks + stable ids — see [security.md](security.md), [block-ids.md](block-ids.md) | **blocks + ToC agent** | `blocks.json` |
| 4 | table of contents (deeply nested) — see [table-of-contents.md](table-of-contents.md) | **blocks + ToC agent** | `tree.json` (structure) |
| 5 | summarize (gists per node) | granularity zoom | `tree.json` (gists) |
| 5b | the arc — one article-level sentence per part ([granularity-zoom.md § The arc](granularity-zoom.md#the-arc)) | **granularity zoom** | `arc.json` |
| 5c | the thread — the article as numbered posts ([tweet-thread-page.md](../plans/tweet-thread-page.md)). **Not run by a plain add**: in `STEP_ORDER`, out of `DEFAULT_INGEST_STEPS` | **tweet thread** ([`src/tweets.ts`](../../src/tweets.ts)) | `tweets.json` |
| 5d | the glossary — the terms this piece uses, defined from it ([glossary.md](glossary.md)). **Not run by a plain add**, same as 5c | **glossary** ([`src/glossary.ts`](../../src/glossary.ts)) | `glossary.json` |
| 6 | server + client — see [granularity-zoom.md § The tabular view](granularity-zoom.md#the-tabular-view). **Sanitises again at ingress** ([security.md](security.md#sanitised-twice-on-purpose)) — stage 3 used jsdom's parser, this one uses the browser's | **granularity zoom** | `src/api.ts`, `src/routes.ts`, `src/web/` |
| 6b | ingest queue — runs stages 1–5b on demand ([ingest-queue.md](ingest-queue.md)) | **granularity zoom** | `data/_jobs/`, `src/jobs.ts`, `src/pipeline.ts` |
| 7 | reading assistant: comments — see [comments.md](comments.md) | **granularity zoom** | `comments.json`, `src/explain.ts` |

Stage 3 was previously unassigned. Greg settled it on 2026-08-24: it belongs with the ToC, since the
ToC is the first thing that has to address blocks and would otherwise be built on someone else's
assumptions about what a block is.

Current code: [`src/extract.ts`](../../src/extract.ts) (documented in
[content-extraction.md](content-extraction.md)) does fetch + Readability + a standalone HTML page in
one script, writing to `output/`. That's the prototype stages 1–2 are growing out of; the
standalone-HTML output becomes a debug view once the server exists.

**The queue is stage 6's, but the stages are not.** [`src/pipeline.ts`](../../src/pipeline.ts) calls
each stage through the function that stage exports, and each stage's CLI calls the same function —
one code path per stage, and no reimplementation of anybody's work. Adding a step means adding an
entry to `STEPS` there; changing what a step *does* means changing that stage, in its own file, as
its owner. On 2026-08-25 Greg chose in-process over spawning subprocesses, which is what made a small
edit to each of the four stage files necessary: see
[ingest-queue.md § They are the same functions the CLI runs](ingest-queue.md#they-are-the-same-functions-the-cli-runs).

## Storage

[database.md](database.md) covers this layout as a whole, and what changes when it becomes Supabase
Postgres.

Filesystem, one directory per article, no database:

```
  data/_jobs/       ingest job records, one file per job (ingest-queue.md)
  data/<slug>/
    raw.html        raw fetched page — kept so a re-extraction needn't re-fetch
    article.html    Readability-extracted — NOT yet sanitised (security.md)
    meta.json       title, byline, site, lang, url, fetchedAt
    blocks.json     the block sequence with stable ids   ← the spine
                    (array order IS document order — block-ids.md)
    tree.json       nodes: ranges, titles, gists
    arc.json        one sentence per part: where the argument stands there
                    (stage 5b — joined to the tree by RANGE, never by node id)
    tweets.json     the article as a numbered thread (stage 5c, on demand only —
                    docs/plans/tweet-thread-page.md). Carries a sourceHash of
                    blocks.json, so a thread that has gone stale can say so.
    glossary.json   the terms the piece uses, and which blocks use them (stage 5d,
                    on demand only — glossary.md). Carries a sourceHash too, and
                    a `passes` count, because the list grows a batch at a time.
    reader.json     per-reader state: progress, highlights, notes (all keyed by block id)
```

Anything expensive is cached on a content hash. `tree.json` is keyed on
`hash(blocks.json) + prompt version + model id` — change any of those and it regenerates.

**That was aspirational until 2026-08-25, and now one artefact really does it.** `tweets.json`
carries a `sourceHash` and the pipeline reads it (`isDone` on a step, see
[ingest-queue.md](ingest-queue.md#a-step-can-now-say-whether-its-artefact-is-current-not-just-present));
`tree.json` and `arc.json` still carry no hash, so for them "cached" still means "the file is
there", and they still rely on the force-cascade to notice that something upstream moved.

`blocks.json` is the exception: it is a **source artefact, not a cache**. It is the only place the
ids live, and stage 3 carries them forward by matching text on re-run — so deleting it destroys
every id permanently, and orphans every note, highlight and gist that pointed at one. See
[block-ids.md § Surviving stage 2](block-ids.md#surviving-stage-2-which-is-the-case-that-actually-matters).

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
  it needs for every zoom level in one payload; zooming must never hit the network. `GET /api/library`
  returns one small record per article for the homepage — [library.md](library.md). The comment
  endpoints ([comments.md](comments.md)) and the six job endpoints
  ([ingest-queue.md](ingest-queue.md)) are the rest. All of them live in
  [`src/routes.ts`](../../src/routes.ts), which is the connect-shaped wrapper a standalone server
  would mount unchanged.
- **`src/api.ts` is the seam a database goes behind.** It is the only file that knows articles are
  directories; everything above it sees `Article` and `LibraryEntry`, both shaped as rows rather than
  as files. See [library.md § When this becomes Postgres](library.md#when-this-becomes-postgres).
- React client. The reading view is described in
  [granularity-zoom.md § Interaction](granularity-zoom.md#interaction) — note especially that scroll
  position is a **block id**, never a pixel offset. Brand and reading tokens come from
  [`styles/tokens.css`](../../styles/tokens.css), and the logo/favicons from
  [`public/`](../../public/) — both lifted from the previous version, see
  [original-version/overview.md](original-version/overview.md). Plain CSS variables, adopt or remap as you like;
  Spideryarn orange `#DB8A45` is the accent, on a dark-only palette — see
  [web-client.md](web-client.md).
- **The queue runs in the server process** ([`src/jobs.ts`](../../src/jobs.ts), p-queue, concurrency
  1). `POST /api/jobs` returns 202 with a receipt and the browser polls; nothing long-running happens
  inside a request handler. Job records survive a restart, and anything left `running` by a dead
  process is turned into a visible error rather than a spinner that never stops — the same argument
  `sweepOrphaned` makes for comments.
- LLM calls happen in the pipeline, not in request handlers — with **two deliberate exceptions**,
  [`src/explain.ts`](../../src/explain.ts) and [`src/converse.ts`](../../src/converse.ts) (chat,
  added 2026-08-25 — [chat-mode.md](../plans/chat-mode.md)). Both take input that does not exist
  until the reader produces it, so there is nothing to precompute; chat additionally *streams*,
  which is the first response in this app that is not a single JSON body. A reader's text selection
  cannot be precomputed or
  cached on a content hash, because it does not exist until they make it. See
  [comments.md § Why this call is not a pipeline stage](comments.md#why-this-call-is-not-a-pipeline-stage).
  That call goes to **OpenRouter** (`OPENROUTER_API_KEY`); everything in the pipeline uses the
  Anthropic SDK. Before writing any Anthropic SDK code, load the `claude-api` skill for current
  model ids and parameters.

## Conventions

- TypeScript, ESM (`"type": "module"`), strict mode — see [`tsconfig.json`](../../tsconfig.json).
- Every stage is runnable on its own against a slug, so any one can be re-run without the others.
- Test article: `output/noema-mythology-of-conscious-ai.html` (Anil Seth, ~54 min, long and largely
  *unstructured*). It's the deliberate hard case for anything that assumes headings exist.
- **`output/` is generated and not in version control**, alongside `data/`. Both are rebuilt by
  running the pipeline, so a fresh clone starts with neither and the test article above has to be
  fetched again. One consequence is worth stating plainly, because it is the sort of thing nothing
  reports: `output/<slug>.blocks.json` is where stage 3 keeps its ids, so the **only** block ids
  under version control are the ones in [`example/`](../../example/README.md). Ids for a real
  article live on the machine that generated them and nowhere else — see
  [block-ids.md](block-ids.md).
