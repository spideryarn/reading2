# Content extraction (readability)

Strips a rich HTML page (article/blog post) down to the main content — drops nav, ads, sidebars, comments — using [Mozilla Readability](https://github.com/mozilla/readability) (the Firefox Reader View algorithm).

- Script: `src/extract.ts`
- Run: `npm run extract -- <url> [outFile]` (defaults to `output/article.html`), **or paste the URL
  into the homepage's add box** and the ingest queue runs it, along with the four stages after it —
  [ingest-queue.md](ingest-queue.md). The CLI and the queue call the same function, so there is one
  code path and no way for them to disagree.
- The fetch itself is no longer here. Stage 1 is [`src/fetch.ts`](../../src/fetch.ts), which keeps
  what it got in `data/<slug>/raw.html` — so re-extracting costs nothing and does not ask the
  publisher again.
- Output: a standalone, styled HTML file (not Markdown — kept as HTML to avoid losing structure/links/images)
- Dependencies: `@mozilla/readability` + `jsdom` (parses HTML into a DOM, since Node has none natively)
- Sample run: `output/noema-mythology-of-conscious-ai.html`, extracted from https://www.noemamag.com/the-mythology-of-conscious-ai/

For background on why Readability was chosen over alternatives (trafilatura, defuddle, Diffbot, Jina Reader, LLM-based extraction, etc.), see the research discussion earlier in this project's chat history — no separate write-up exists yet.

## The fetch above it

Stage 1 moved out of this script into [`src/fetch.ts`](../../src/fetch.ts) on 2026-08-25 —
[fetching.md](fetching.md). What that buys this stage: HTML already decoded with the page's own
character encoding rather than assumed to be UTF-8, a PDF refused by name instead of arriving as
Readability-proof gibberish, and a typed failure rather than `Fetch failed: 403`.

One thing it does **not** yet buy, and should: `fetchDocument` reports the URL it *ended up* at
after redirects, and this stage still hands Readability the URL that was typed. Where those differ,
relative links resolve against the wrong origin.

## Where this sits

This is **stage 2** of the pipeline — see [architecture.md § Pipeline](architecture.md#pipeline).
It feeds the block-splitting stage that assigns the stable ids everything else anchors to
([AGENTS.md § The one contract that matters](../../AGENTS.md#the-one-contract-that-matters)), which
in turn feeds the deeply-nested table of contents and the
[granularity-zoom tree](granularity-zoom.md#the-tree) — one structure, not two.

Two questions that used to land on this stage were settled on 2026-08-24, both away from it:
id assignment belongs to **stage 3**, not extraction, and ids are random so they survive
re-extraction ([block-ids.md](block-ids.md)); a block is the *finest* unit a reader takes in as one
thing ([architecture.md § What a block is](architecture.md#what-a-block-is)).

What this stage owes stage 3: HTML whose element structure is stable run-to-run. **Still not
sanitized HTML** — but that is now a decision rather than an oversight.

> **This file used to promise "sanitized HTML" and no part of the pipeline kept the promise.**
> Readability is not a sanitiser and
> [says so in its own SECURITY.md](https://github.com/mozilla/readability/blob/main/SECURITY.md);
> `<img onerror>` and `<svg onload>` came through and executed in the reading view. The wrong claim
> was the dangerous part — a reader checking whether extraction was safe would have found that line
> and stopped looking.
>
> Fixed 2026-08-25, at **stage 3** rather than here: see [security.md](security.md) for why, and for
> what the sanitiser keeps and drops. One consequence lands on this stage and is still open — the
> standalone debug page this script writes is *not* sanitised, so opening `output/<slug>.html`
> directly in a browser before running stage 3 will execute whatever survived Readability. Two
> lines fix it (import `sanitizeInPlace` from [`src/sanitize.ts`](../../src/sanitize.ts), call it on
> the document before writing); it was left for whoever owns this stage. See
> [security.md § Known gaps](security.md#known-gaps).
Ids are preserved by matching on the `spya-` attribute already in the document, so extraction must
not strip unrecognised `id` attributes — doing so would re-mint every id and orphan every note.

The standalone styled HTML output is a debug view; once the server exists
([architecture.md § Server and client](architecture.md#server-and-client)), the durable artefacts are
`article.html` + `meta.json` under `data/<slug>/`.

`meta.json` landed on 2026-08-25, when the library needed something to put on a card: title, byline,
site, language, source URL, fetch date and Readability's excerpt. **It is the only place the source
URL and the byline survive past this script**, and it is written on every run, because re-extracting
is how you refresh a page and the fetch date should follow. One subtlety worth reading before
touching it — the slug comes from the *output filename* rather than from the URL, because that is
what stages 3 and 4 will name the data directory after. Both are in
[library.md § meta.json](library.md#metajson-and-the-articles-identity).

Why any of this exists at all: [vision.md](vision.md).

## Prior art

The previous version of Spideryarn ran a Readability-based extraction path in production and wrote
down what went wrong with it. See
[original-version/extraction.md](original-version/extraction.md) for the pointers.
