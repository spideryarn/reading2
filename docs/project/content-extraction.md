# Content extraction (readability)

Strips a rich HTML page (article/blog post) down to the main content — drops nav, ads, sidebars, comments — using [Mozilla Readability](https://github.com/mozilla/readability) (the Firefox Reader View algorithm).

- Script: `src/extract.ts`
- Run: `npm run extract -- <url> [outFile]` (defaults to `output/article.html`)
- Output: a standalone, styled HTML file (not Markdown — kept as HTML to avoid losing structure/links/images)
- Dependencies: `@mozilla/readability` + `jsdom` (parses HTML into a DOM, since Node has none natively)
- Sample run: `output/noema-mythology-of-conscious-ai.html`, extracted from https://www.noemamag.com/the-mythology-of-conscious-ai/

For background on why Readability was chosen over alternatives (trafilatura, defuddle, Diffbot, Jina Reader, LLM-based extraction, etc.), see the research discussion earlier in this project's chat history — no separate write-up exists yet.

## Where this sits

This is **stage 2** of the pipeline — see [architecture.md § Pipeline](architecture.md#pipeline).
It feeds the block-splitting stage that assigns the stable ids everything else anchors to
([AGENTS.md § The one contract that matters](../../AGENTS.md#the-one-contract-that-matters)), which
in turn feeds the deeply-nested table of contents and the
[granularity-zoom tree](granularity-zoom.md#the-tree) — one structure, not two.

Two open questions land on this stage: whether extraction or the blocks stage owns id assignment and
how ids survive re-extraction ([Q2](open-questions.md#q2)), and what counts as a block
([Q3](open-questions.md#q3)).

The standalone styled HTML output is a debug view; once the server exists
([architecture.md § Server and client](architecture.md#server-and-client)), the durable artefacts are
`article.html` + `meta.json` under `data/<slug>/`.

Why any of this exists at all: [vision.md](vision.md).
