# Architecture

## Intent

From the brief (Greg, 2026-08-24), verbatim:

> In terms of larger implementation, what I'm imagining is, well, we'll need a web server of some
> kind. It can be a simple one at first. Probably React. Each article — let's say we pull them from
> the web. We run Mozilla Readability … and then into sort of a more sanitized HTML. We give each
> paragraph a unique ID. We generate a table of contents that's quite deeply nested … all the way
> down to a paragraph level. And then we'll add a bunch of other readability — not readability,
> like reading assistant functionality as well.

So: a pipeline of small, independently runnable stages, each writing JSON to disk, feeding a simple
server and a React client. (*Independently cacheable* was the intent and is not yet the fact — two
stages of seven cache on a content hash, the rest on a file existing. See
[database.md](database.md#the-filesystem-era-files-under-dataslug).) "It can be a simple one at first" is a design
constraint, not an apology — keep it boring while the ideas are still moving.

## Pipeline

```
  URL
   │
   ▼
 ┌──────────┐   raw.html OR raw.pdf, and raw.json saying which
 │ 1 fetch  │──────────────►  data/<slug>/raw.{html,pdf} + raw.json
 └──────────┘
   │
   ▼
 ┌──────────┐   HTML → Mozilla Readability (NOT a sanitiser — security.md)
 │ 2 extract│   PDF  → a model reads the pages, and the transcription is
 │          │          CHECKED against the PDF's own text layer, per page
 │          │          (pdf-ingestion.md; the branch is on raw.json, never
 │          │           on the URL)
 │          │──────────────►  data/<slug>/article.html   + meta.json
 └──────────┘                 (title, byline, siteName, lang, url)
   │
   ▼
 ┌──────────┐   SANITIZE (security.md), split into blocks, assign STABLE
 │ 3 blocks │   RANDOM IDS (block-ids.md)
 │          │──────────────►  data/<slug>/blocks.json
 └──────────┘                 [{id:"spya-k3m9qt", tag, kind, level?, text,
   │                            words, html, gistable, note?,
   │                            role?, treatment?, noteId?}]  — array order
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

**`gistable` is not the policy, and since 2026-08-28 it does not pretend to be.** It is the
splitter's intrinsic "this block has independently describable prose" fact, and nothing else.
The five questions the rest of the pipeline actually asks — may this be searched, may an automatic
model call read it, may it be embedded, may the ToC write a row about it, does it go on the clock —
are named predicates in [`src/block-policy.ts`](../../src/block-policy.ts), which is `gistable`'s
only policy-reading consumer. They are **not** five spellings of one formula: a footnote is
searchable and is not on the clock, and a pull-quote is on the clock and gets no row.
See [footnotes.md § `gistable: false` is not the switch](../plans/footnotes.md).

Stage 3 also reads back the footnote stamps stage 2 left in the DOM and writes `role`, `treatment`
and `noteId` onto the blocks inside the notes container — apparatus rather than argument, and which
note each block belongs to, since **a note is a range of blocks and not one block**. Nothing reads
those fields yet; the predicates that will are the next stage.
[docs/plans/footnotes.md](../plans/footnotes.md).

## Stage ownership

Several agents work this repo in parallel. Stay in your stage; communicate through the JSON
artefacts on disk, not by reaching into another stage's code.

| # | Stage | Owner | Artefact |
|---|-------|-------|----------|
| 1 | fetch — see [fetching.md](fetching.md) | **fetch agent** ([`src/fetch.ts`](../../src/fetch.ts)); run as a step of the ingest queue, [ingest-queue.md](ingest-queue.md) | `raw.html` or `raw.pdf`, plus `raw.json` |
| 2 | extract — **two extractors, one artefact**: Readability for a page ([content-extraction.md](content-extraction.md)), a model reading the pages for a PDF ([../plans/pdf-ingestion.md](../plans/pdf-ingestion.md)) | **extraction agent** | `article.html`, `meta.json` (the article's identity — [library.md](library.md#metajson-and-the-articles-identity)) |
| 3 | **sanitize** + blocks + stable ids — see [security.md](security.md), [block-ids.md](block-ids.md) | **blocks + ToC agent** | `blocks.json` |
| 4 | table of contents (deeply nested) — see [table-of-contents.md](table-of-contents.md) | **blocks + ToC agent** | `tree.json` (structure) |
| 5 | summarize (gists per node) | granularity zoom | `tree.json` (gists) |
| 5b | the arc — one article-level sentence per part ([granularity-zoom.md § The arc](granularity-zoom.md#the-arc)) | **granularity zoom** | `arc.json` |
| 5c | the thread — the article as numbered posts ([tweet-thread-page.md](../plans/tweet-thread-page.md)). **Not run by a plain add**: in `STEP_ORDER`, out of `DEFAULT_INGEST_STEPS` | **tweet thread** ([`src/tweets.ts`](../../src/tweets.ts)) | `tweets.json` |
| 5d | the glossary — the terms this piece uses, defined from it ([glossary.md](glossary.md)). **Not run by a plain add**, same as 5c | **glossary** ([`src/glossary.ts`](../../src/glossary.ts)) | `glossary.json` |
| 5f | the **ideas** — the propositions the piece needs you to hold, the ones it assumes and the ones it adds ([ideas.md](ideas.md)). **Not run by a plain add**, same as 5c–5d. The first stage whose freshness covers the *tree* as well as the blocks, and the first that lets the model name block ids — so every one it names is checked against `blocks.json` | **ideas** ([`src/ideas.ts`](../../src/ideas.ts)) | `ideas.json` |
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

**Half-moved, as of 2026-08-31.** Every *reader* store is Postgres under `SPIDERYARN_STORE=postgres`,
which is what production runs; the *pipeline* still writes the filesystem layout below, because
[`src/jobs.ts`](../../src/jobs.ts) imports `fsArtifacts` directly and never joins that selection. The
gap between the two halves is not cosmetic — it is where three live faults came from, including one
that mints new block ids over an article that already had them. Finishing it is
[finish-the-database-move.md](../plans/finish-the-database-move.md); the reasoning is
[delete-the-importer.md](../plans/delete-the-importer.md).

The layout the pipeline writes, one directory per article:

```
  data/_jobs/       ingest job records, one file per job (ingest-queue.md)
  data/<slug>/
    raw.html        raw fetched page — kept so a re-extraction needn't re-fetch
      or raw.pdf    the fetched PDF, as bytes
    raw.json        WHICH of those two is authoritative, and the provenance
                    with it: final URL, content type, encoding, bytes, sha256.
                    Read by stage 2 — a refresh can leave BOTH raw files there,
                    and "whichever exists" then picks the stale one silently
    pdf-chunks/     PDFs only: one cached model response per page range, keyed
                    on the bytes + the prompt version + the reader, so fixing
                    the renderer costs nothing (pdf-ingestion.md). Written
                    atomically, and an entry that will not parse is discarded
                    and re-read rather than thrown
                    (../postmortems/pdf-chunk-cache-corrupt-entry.md)
    article.html    extracted — NOT yet sanitised (security.md)
    meta.json       title, byline, site, lang, url, fetchedAt
    blocks.json     the block sequence with stable ids   ← the spine
                    (array order IS document order — block-ids.md)
    tree.json       nodes: ranges, titles, gists
    arc.json        one sentence per part: where the argument stands there
                    (stage 5b — joined to the tree by RANGE, never by node id)
    tweets.json     the article as a numbered thread (stage 5c, on demand only —
                    docs/plans/tweet-thread-page.md). Carries a sourceHash, so a
                    thread that has gone stale can say so.
    glossary.json   the terms the piece uses, and which blocks use them (stage 5d,
                    on demand only — glossary.md). Carries a sourceHash too, and
                    a `passes` count, because the list grows a batch at a time.
    summary.json    RETIRED 2026-08-31. Stage 5e wrote the two generated summary
                    lengths here; the stage is gone and nothing reads the file
                    (../plans/gist-only-summaries.md). Existing files and the
                    Postgres column that holds them were left alone — what is in
                    them is real readers' summaries. Summary mode now draws the
                    gists on the tree.
    ideas.json      the propositions the piece needs you to hold — the ones it
                    assumes and the ones it adds (stage 5f, on demand only —
                    ideas.md).
    reader.json     per-reader state: progress, highlights, notes (all keyed by block id)
```

Anything expensive is cached on a content hash. `tree.json` is keyed on
`hash(blocks.json) + prompt version + model id` — change any of those and it regenerates.

**That was aspirational until 2026-08-25, and six artefacts really do it now.** `tweets.json` was
first, and the pipeline reads its hash (`isDone` on a step, see
[ingest-queue.md](ingest-queue.md#a-step-can-now-say-whether-its-artefact-is-current-not-just-present));
`arc.json` joined on 2026-08-29 with the first fingerprint that covered everything its prompt reads.

**Since 2026-08-31 the six article-reading stages are fingerprinted against everything their prompt
reads** — the blocks, the tree, *and the head* — in
[`src/source-hash.ts`](../../src/source-hash.ts). Before that, four of the six hashed the blocks
alone and two omitted the metadata, so the sections could be re-cut, or the page re-extracted under a
new headline, and every one of them went on reporting itself current.

**One function per prompt head**, and one function for all of them was the first attempt. Three
heads exist today and the list grows as stages arrive:

| function | stages | what its head prints |
|---|---|---|
| `articleFingerprint` | `arc`, `tweets`, `glossary`, `summary`, `quotes` | `TITLE:`, `BY:`, `PUBLISHED IN:` (`articleText`) |
| `articleWithIdsFingerprint` | `ideas`, `sketch` | those three **and `URL:`** (`articleWithIds`) |
| `datedArticleFingerprint` | `timeline` | those four **and the publication date**, which is its reference frame |

The last two also hash the synthetic `TITLE: <tree.slug>` those two stages fall back to when there is
no `meta.json`, through the shared `fallbackHeadTitle` — `structureHash` does not cover `tree.slug`,
so re-slugging a metadata-less article moved the prompt and nothing else. Widening the first function
instead would have spent four model calls on a `URL:` line the model was never shown. GPT Sol found
both halves, 2026-08-31.

That was harmless only while the pipeline's artefact reads answered `null` and the step re-ran
regardless; the failure arrives with the reads that make it work.
[finish-the-database-move.md](../plans/finish-the-database-move.md) § stage 1.

`assets.json` keeps the narrow hash — the blocks and nothing else — because that is genuinely all it
is built from: a list of images to fetch, no prompt and no head.

`tree.json` still carries no hash, so for it "cached" still means "the file is
there" and it still relies on the force-cascade to notice that something upstream moved — see
[`src/pipeline.ts`](../../src/pipeline.ts) § `toc`, where a stamp was written and withdrawn because
it needs consumer invalidation first.

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
- `loadArticle` looks in `data/<slug>/`, and in [`example/`](../../example/README.md) — the
  hand-authored placeholder — **only for the slug `example`**. Real pipeline output under
  `data/example/` still supersedes the fixture with no code change. It used to fall back to the
  fixture for *every* slug, which meant an article with no tree yet, or no article at all, was
  answered with the fixture's prose under the reader's own address; the reasoning for taking that
  away is on `candidateDirs` in [`src/api.ts`](../../src/api.ts), and the security half of it is in
  [security.md § Why it survived being looked at](security.md#why-it-survived-being-looked-at).
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
  That call goes to **OpenRouter** (`OPENROUTER_API_KEY`) — and since 2026-08-27 so does
  everything else, the pipeline included. ~~everything in the pipeline uses the Anthropic SDK~~:
  the pipeline still *uses* the SDK, but pointed at OpenRouter's Anthropic-compatible endpoint
  rather than at `api.anthropic.com`. One vendor, two wire shapes —
  [ai-gateway.md](ai-gateway.md). Before writing any Anthropic SDK code, load the `claude-api`
  skill for current model ids and parameters.

## Conventions

- TypeScript, ESM (`"type": "module"`), strict mode — see [`tsconfig.json`](../../tsconfig.json).
- Every stage is runnable on its own against a slug, so any one can be re-run without the others.
- Anything expensive should be cached on a content hash. Seven stages do it, and copy *their* choice
  of hash input rather than only the idea — the rule is that a fingerprint covers **everything the
  stage's prompt reads** — for six of the seven that is the blocks, the tree and the head, and there
  are two head functions because there are two heads
  ([`src/source-hash.ts`](../../src/source-hash.ts)); for `assets` it is the blocks alone. [database.md](database.md#the-filesystem-era-files-under-dataslug).
- **A cache whose key is deterministic must be written atomically and read tolerantly**, and the two
  are one rule. `writeFile` truncates before it writes, so a killed process leaves a file that exists
  and does not parse; the key does not change between runs, so every later run finds that same file
  and fails the same way, for ever. Write beside the target and `rename` (`writeAtomic` in
  [`src/toc.ts`](../../src/toc.ts), [`src/labels.ts`](../../src/labels.ts),
  [`src/pdf-read.ts`](../../src/pdf-read.ts)); treat an entry that will not parse as a miss and say so
  in the log. It wedged one article's PDF extract permanently —
  [pdf-chunk-cache-corrupt-entry.md](../postmortems/pdf-chunk-cache-corrupt-entry.md).
- What the model calls cost, and the three prompt caches that stop us paying for the article twice,
  are in [prompt-caching.md](prompt-caching.md).
- **Where the calls actually go** is [ai-gateway.md](ai-gateway.md): every paid call goes through
  OpenRouter, why the seven pipeline stages kept Anthropic's Messages protocol instead of being
  translated into OpenAI's shape, and the four things on that path that fail without saying so.
- Test article: `output/noema-mythology-of-conscious-ai.html` (Anil Seth, ~54 min, long and largely
  *unstructured*). It's the deliberate hard case for anything that assumes headings exist.
- **`output/` is generated and not in version control**, alongside `data/`. Both are rebuilt by
  running the pipeline, so a fresh clone starts with neither and the test article above has to be
  fetched again. One consequence is worth stating plainly, because it is the sort of thing nothing
  reports: `output/<slug>.blocks.json` is where stage 3 keeps its ids, so the **only** block ids
  under version control are the ones in [`example/`](../../example/README.md). Ids for a real
  article live on the machine that generated them and nowhere else — see
  [block-ids.md](block-ids.md).
