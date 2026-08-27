# Content extraction (readability)

Strips a rich HTML page (article/blog post) down to the main content — drops nav, ads, sidebars, comments — using [Mozilla Readability](https://github.com/mozilla/readability) (the Firefox Reader View algorithm).

- Script: `src/extract.ts`
- Run: `npm run extract -- <url> [outFile]` (the output defaults to `output/<slug>.html`, with
  the slug derived from the URL — it used to be a fixed `output/article.html`), **or paste the URL
  into the homepage's add box** and the ingest queue runs it, along with the four stages after it —
  [ingest-queue.md](ingest-queue.md). The CLI and the queue call the same function, so there is one
  code path and no way for them to disagree.
- The fetch itself is no longer here. Stage 1 is [`src/fetch.ts`](../../src/fetch.ts), which keeps
  what it got in `data/<slug>/raw.html` — or `raw.pdf` — with a `raw.json` manifest beside it saying
  which, so re-extracting costs nothing and does not ask the publisher again.
- Output: a standalone, styled HTML file (not Markdown — kept as HTML to avoid losing structure/links/images)
- Dependencies: `@mozilla/readability` + `jsdom` (parses HTML into a DOM, since Node has none natively)
- Sample run: `output/noema-mythology-of-conscious-ai.html`, extracted from https://www.noemamag.com/the-mythology-of-conscious-ai/

For background on why Readability was chosen over alternatives (trafilatura, defuddle, Diffbot, Jina Reader, LLM-based extraction, etc.), see the research discussion earlier in this project's chat history — no separate write-up exists yet.

## The fetch above it

Stage 1 moved out of this script into [`src/fetch.ts`](../../src/fetch.ts) on 2026-08-25 —
[fetching.md](fetching.md). What that buys this stage: HTML already decoded with the page's own
character encoding rather than assumed to be UTF-8, a PDF refused by name instead of arriving as
Readability-proof gibberish, and a typed failure rather than `Fetch failed: 403`.

## Two extractors, one artefact

**Since 2026-08-26 a PDF is no longer refused.** There is a second extractor beside this one —
[`src/pdf-read.ts`](../../src/pdf-read.ts) — and it produces the same `article.html` + `meta.json`,
so stage 3 onwards cannot tell which of the two made a given article. That convergence is the whole
design, and it is why the PDF path is not a parallel pipeline.

```
  raw.json says "html"  ──►  Readability  ──┐
                                            ├──►  article.html + meta.json  ──► blocks ─► toc ─► arc
  raw.json says "pdf"   ──►  a model reads ─┘
                             the pages
```

**The branch is on the manifest, never on the URL.** A `.pdf` address that served a Cloudflare
challenge is HTML; an `application/octet-stream` that starts `%PDF-` is a PDF. Stage 1 already looked
at the bytes and wrote down what it found ([fetching.md](fetching.md#what-kind-of-document-it-is)),
so stage 2 reads `raw.json` rather than guessing — and rather than picking "whichever raw file is
there", which makes a stale file authoritative by accident after a refresh.

The differences that matter to a reader:

- **A PDF costs money to extract.** Readability is free and deterministic; a model reading pages is
  neither. Every chunk's raw response is cached, so re-running the stage after a renderer fix is free.
- **It is checked, and it can fail.** The transcription is scored per page against the PDF's own text
  layer ([`src/pdf-score.ts`](../../src/pdf-score.ts)) and the step fails, naming the page, rather
  than writing a half-transcribed article that reads fluently.
- **A scan cannot be checked at all**, has no text layer to check against, and says so on the page.

The whole of it — the model, the prompt, the chunking, the check, and what it cost to decide — is in
[../plans/pdf-ingestion.md](../plans/pdf-ingestion.md).

**And since 2026-08-27 the PDF need not have been fetched at all.** A reader can upload one, and
that is a change to stage *1*, not to this stage: the acquisition step verifies the bytes and writes
the same `raw.json` with `origin: "upload"`, so the branch above reads `"pdf"` and nothing here
knows the difference. The one thing this stage does notice is the absence of a URL — an uploaded
document has none — which is why `requireUrl` moved *inside* the HTML branch. It was at the top,
and Readability is the only caller that ever wanted it: not as something to fetch, but as a base
for relative links, which a PDF has not got. Asking for it up here made a missing URL the first
thing an upload hit, three stages after the last thing that could have supplied one. The upload path
is [ingest-queue.md § Uploading a PDF](ingest-queue.md#uploading-a-pdf).

One thing it does **not** yet buy, and should: `fetchDocument` reports the URL it *ended up* at
after redirects, and this stage still hands Readability the URL that was typed. Where those differ,
relative links resolve against the wrong origin.

## What it gets wrong, and how we know

**An accordion is closed, not absent — and Readability cannot tell.** It skips
`aria-hidden="true"` nodes on purpose (`Readability.js:2701`, its visibility check), which is right
for an off-screen menu and wrong for a collapsed section of the article. On
[`data/constitution`](../../data/constitution) — Anthropic's Claude's Constitution — that loses
**48,147 characters, 26% of the piece**, including whole named sections. Nothing throws. The article
reaches the shelf looking complete, which is the shape
[silent-success.md](../reusable/silent-success.md) is about.

Nothing in this stage looks at its own output and asks whether it is any good. There is now an
instrument that does — [`evals/extraction/inventory.mts`](../../evals/extraction/inventory.mts),
which flattens the fetched page into blocks and says which survived — and it is an eval, run by
hand, not a gate ([evals/README.md](../../evals/README.md)).

The measurements, the four bugs the instrument shipped with, what a model pass would and would not
buy, and the four-line deterministic fix that recovers 39,355 of those characters for nothing, are
all in **[../plans/readability-repair-pass.md](../plans/readability-repair-pass.md)**. Nothing here
has changed yet; the plan says what would have to be true first.

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

What this stage owes stage 3: HTML whose element structure is stable run-to-run. **Sanitising is
still stage 3's job**, not a promise made here — but since 2026-08-26 this stage does sanitise the
one thing it writes for a person to open.

> **This file used to promise "sanitized HTML" and no part of the pipeline kept the promise.**
> Readability is not a sanitiser and
> [says so in its own SECURITY.md](https://github.com/mozilla/readability/blob/main/SECURITY.md);
> `<img onerror>` and `<svg onload>` came through and executed in the reading view. The wrong claim
> was the dangerous part — a reader checking whether extraction was safe would have found that line
> and stopped looking.
>
> Fixed 2026-08-25, at **stage 3** rather than here: see [security.md](security.md) for why, and for
> what the sanitiser keeps and drops.

**The debug page is sanitised here, 2026-08-26.** The window between running this stage and running
stage 3 is exactly what `output/<slug>.html` is for — the command prints the path and the next thing
you do is open it — so the file goes through `sanitizeHtml` before it is written.

The estimate for that fix, written down here and in security.md, was two lines. It was not, and the
reason is the useful part: sanitising the body closes one hole and there were **four**. Readability
hands `title`, `byline`, `siteName` and `lang` back as *text* it took the `textContent` of, and
`textContent` decodes entities — so a title of `Real&lt;/title&gt;&lt;img …&gt;` comes back as real
markup, and this file wrote all four into the template unescaped. A live `<img onerror>` in the
byline and a live handler on `<html lang>` were both reproduced. Any string interpolated into markup
is markup, however it was obtained.
[security.md § Stage 2's debug page](security.md#stage-2s-debug-page) has the table and the reasoning;
[`tests/extract-sanitize.test.ts`](../../tests/extract-sanitize.test.ts) has the payloads, each one
checked against real Readability output first.

Stage 3 is unaffected by this — it sanitises whatever it is handed, so a body arriving clean is a
no-op and `blocks.json` comes out identical. That is asserted rather than assumed, because the two
stages share this file and stage 3 writes block ids back into it.
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
