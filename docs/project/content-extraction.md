# Content extraction (readability)

Strips a rich HTML page (article/blog post) down to the main content — drops nav, ads, sidebars, comments — using [Mozilla Readability](https://github.com/mozilla/readability) (the Firefox Reader View algorithm).

- Script: `src/extract.ts`
- Run: `npm run extract -- <slug> [--force]`, which re-runs this stage on an article you already
  have, **or paste the URL into the homepage's add box** and the ingest queue runs it along with the
  four stages after it — [ingest-queue.md](ingest-queue.md). Both are the same code path now rather
  than two that agree: the command enqueues a job and advances it
  ([setup-dev.md](setup-dev.md#the-stage-commands-are-one-script-and-they-drive-the-queue)).
  Until 2026-09-05 it took a **URL**, fetched the page itself and wrote `output/<slug>.html` and
  `data/<slug>/meta.json` by hand; making an article from an address is `npm run ingest` now.
- The fetch itself is no longer here. Stage 1 is [`src/fetch.ts`](../../src/fetch.ts), which keeps
  what it got as a content-addressed object in the `sources` bucket, with a manifest naming it, so
  re-extracting costs nothing and does not ask the publisher again. Since 2026-08-31 it writes no
  files — [fetching.md § What stage 1 leaves behind](fetching.md#what-stage-1-leaves-behind-since-2026-08-31-nothing-on-disk).
- Output: a standalone, styled HTML page and the metadata, **both returned rather than written**. The
  page is HTML and not Markdown, to avoid losing structure, links and images. Since 2026-09-05
  nothing puts either on a disk from this stage; `npm run eval:pdf-read`, which is the *other*
  extractor and a quality tool rather than a stage runner, still writes its two files for a person to
  look at.
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
                                            ├──►  article.html + meta.json  ──► blocks ─► hierarchy ─► arc
  raw.json says "pdf"   ──►  a model reads ─┘
                             the pages
```

**The branch is on the manifest, never on the URL.** A `.pdf` address that served a Cloudflare
challenge is HTML; an `application/octet-stream` that starts `%PDF-` is a PDF. Stage 1 already looked
at the bytes and wrote down what it found ([fetching.md](fetching.md#what-kind-of-document-it-is)),
so stage 2 reads the manifest rather than guessing — and rather than picking "whichever raw file is
there", which makes a stale file authoritative by accident after a refresh. Content addressing
closes that a second way: since 2026-08-31 stage 2 asks `readRawBytes(manifest)` for the bytes, and
they are named by what they *are*, so a manifest cannot point at last week's document.

The differences that matter to a reader:

- **A PDF costs money to extract.** Readability is free and deterministic; a model reading pages is
  neither. Every chunk's raw response is checkpointed against the **article**, one row per chunk
  ([`src/store/checkpoints.ts`](../../src/store/checkpoints.ts)), so a second attempt at a document
  the first one ran out of time on buys only the chunks it has not got — and re-running after a
  *renderer* fix is free. A **prompt** change is deliberately not free: the key carries
  `promptFingerprint()`. And `npm run eval:pdf-read` (`npm run pdf` until 2026-09-05) remembers
  nothing between runs at all, because a command
  line has no article to key on and takes `nullCheckpointStore()`.
- **It is checked, and since 2026-08-30 it no longer fails.** The transcription is scored per page
  against the PDF's own text layer ([`src/pdf-score.ts`](../../src/pdf-score.ts)). This used to
  `throw`, and the argument for throwing was the point of the whole stage — a model can drop a
  paragraph, summarise one or invent one, and all three read as fluent English. What changed was
  evidence, not opinion: the first PDFs on production were refused over rotated stamps, chart labels
  and maths notation. Greg's call, 2026-08-30, against the stated order of capability then
  robustness: *"publish it and say what looked wrong. A reader can see the note and judge; a reader
  with no article cannot."* `1ed4407e`.

  **The saying-so is the half that is not built.** The *score* is shown — the masthead's source note
  and the metadata page's `Missed` row both report recall and pages checked. The specific complaints
  go to `meta.quality`, and **nothing renders it**, so the sentence in
  [`src/pdf-read.ts`](../../src/pdf-read.ts) § `runPdfExtract` — "if the reader does not look, nobody
  looks" — currently describes a reader who cannot. Restoring a gate later means choosing which
  failures are fatal, and the missing-run check is the one worth it; note that `coverageOf`'s
  `missing` is *any requested page with no record at all*, so a gate on it as-is would refuse a blank
  verso or a full-page figure, which is the false-refusal class that stood the old one down.
- **A PDF can be too long, and on the queue's path it is refused in stage 1.** The cap is
  [`src/uploads.ts`](../../src/uploads.ts) § `MAX_PAGES` — a limit on what reading a document is
  allowed to cost, not a technical one — and since 2026-09-04 it is enforced where the bytes first
  arrive rather than here: `refuseAnOverlongPdf` in [`src/pipeline.ts`](../../src/pipeline.ts) counts
  the pages before an upload is promoted to its canonical name or a fetched document is stored, so
  the reader hears it in seconds instead of after a job card has been running. `pass0`'s own guard
  stays as the backstop for anything ingested before that, or re-extracted after the cap moves
  again — and it is the *only* guard for the stage CLIs, which do not go through the queue's stage 1
  at all: the queue stores whatever it fetched, and `npm run eval:pdf-read` keeps the original before
  `runPdfExtract` counts anything. Neither can reach a reader's job.
- **A PDF that will not open at all is refused here, and says which way.** Locked with a password, or
  damaged past parsing — two sentences and two codes, `PDF_LOCKED` and `PDF_DAMAGED` in
  [`src/messages.ts`](../../src/messages.ts), because only one of them mentions a password. Both are
  `blocked`, so no Retry button: until 2026-09-04 they had no sentence at all and arrived as the
  generic retryable one, which is a button that could never work
  ([copy.md](copy.md#the-four-rules), rule 2). Stage 1's page counter deliberately lets such a file
  through — a cost gate is not a validity gate — so this is where it lands.
- **A hundred chunks at a time, and the width buys latency rather than money.** `CHUNK_CONCURRENCY`
  went 8 → 16 → 100 on 2026-09-04, the last step measured on the live wire rather than argued from
  the 740-second deadline: all 69 chunks of a 142-page paper fired at once came back in **69 s**,
  twice, with nothing refused. End to end the step went **394 s → 248 s and 142 s** over two runs,
  not 394 → 69, because it is now bounded by its slowest chunk asked twice rather than by how many
  waves it needs — so further width buys nothing ([`src/pdf-read.ts`](../../src/pdf-read.ts) has the
  table). **Cost and transcription quality are unchanged by width**, and the two runs prove it in
  opposite directions: $0.49/9 notes and $0.62/17 notes against $0.63/12 at width 16. What varies is
  how many chunks fail their check, which is model variance. Width buys latency and nothing else.
- **The width is governed, not just raised.** A probe could not provoke a rate limit at 150, 250 or
  even 400 concurrent requests, which says the ceiling is this account's own tier at the provider
  rather than a shared pool — a fact about configuration that can change without telling us. So
  `WidthGate` ([`src/concurrency.ts`](../../src/concurrency.ts)) halves the width on the first 429 of
  an epoch, holds new requests briefly while that takes effect, and earns the width back one slot per
  successful call. A hundred chunks meeting one overload therefore halve it once rather than a
  hundred times. Underneath it the per-chunk retry is unchanged: the chunk waits and asks again,
  honouring the provider's own `Retry-After` in full up to `MAX_RETRY_AFTER_MS` (60 s) and failing
  this attempt rather than truncating a wait the provider actually asked for.
- **A chunk is bounded by bytes as well as by words.** Words alone let a run of image-heavy pages
  through, so `MAX_CHUNK_BYTES` (3 MB) is a *planning* bound on the encoded page images — distinct
  from `MAX_ENCODED_BYTES` (30 MB), the hard request ceiling. Both are in
  [`src/pdf-read.ts`](../../src/pdf-read.ts), and the planning bound **cannot split a page**: a
  single page heavier than it still goes out over the limit, which is the honest edge rather than an
  oversight.
- **A long PDF is expected to need two lease windows, and that is what the checkpoints are for.**
  Measured in a browser on 2026-09-04: a 144-page paper spent nearly all of the first window in
  `extract`, and `hierarchy` was cut off. The second window is a press of Retry rather than an
  automatic requeue — a cooperative deadline abort is not a lapsed lease
  ([ingest-queue.md](ingest-queue.md)) — and the chunks the first attempt finished are read back
  rather than re-bought.
- **A scan cannot be checked at all**, has no text layer to check against, and says so on the page.
- **A word broken by a page break is mended from the text layer, not by a second model call.** The
  chunks are read in parallel and none of them sees over its own edge, so `dis-` / `patcher` arrives
  as two records and used to render as "dis patcher". `mendSeamHyphens` in
  [`src/pdf-read.ts`](../../src/pdf-read.ts) glues it back where pass 0's own lines say so on both
  pages, and declines otherwise — the evidence rules, and the case it deliberately gives up on, are
  in the comment above the function.

The whole of it — the model, the prompt, the chunking, the check, and what it cost to decide — is in
[../plans/260826c-pdf-ingestion.md](../plans/260826c-pdf-ingestion.md).

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
for an off-screen menu and wrong for a collapsed section of the article. On Anthropic's *Claude's
Constitution* that discards three accordion bodies holding **39,355 characters — a fifth of the
piece**, including whole named sections. Nothing throws. The article reaches the shelf looking
complete, which is the shape [silent-success.md](../reusable/silent-success.md) is about.

(The instrument scores 48,147 characters absent from that page in total; 39,355 of them are the
accordions and come back. The rest is front matter and boilerplate that Readability drops on purpose.
The two numbers were run together in an earlier draft of this paragraph — caught by GPT Sol's review,
2026-08-28.)

Nothing in this stage looks at its own output and asks whether it is any good. There is now an
instrument that does — [`evals/extraction/inventory.mts`](../../evals/extraction/inventory.mts),
which flattens the fetched page into blocks and says which survived — and it is an eval, run by
hand, not a gate ([evals/README.md](../../evals/README.md)).

**That one is fixed**, 2026-08-28: `unhideCollapsedSections` in [`src/extract.ts`](../../src/extract.ts)
removes `aria-hidden="true"` before Readability looks at the page, recovering 39,355 of those
characters for nothing — no model, no money, no latency. It removes `aria-hidden` and **only** that:
`[hidden]` and inline `display: none` are stronger claims, and the measurement that says so is on the
function.

**A class is gone before stage 3 can read it, and that is a second thing this stage has to catch.**
Readability runs with `keepClasses: false` and unwraps the containers those classes were on, so
markup that says *this box is set apart from the argument* — Substack's
`<div data-callout class="callout-block">`, a MkDocs admonition — reaches stage 3 as a bare `<p>`,
indistinguishable from body prose. Nine of them on the article that made us look. Same shape as
footnotes, same answer: recognise it here, where the page is still as the author wrote it, and leave
a stamp on the elements that survive — [`src/callouts.ts`](../../src/callouts.ts) and
[`src/notes.ts`](../../src/notes.ts), and [../plans/260831ae-callouts-the-box-the-author-drew.md](../plans/260831ae-callouts-the-box-the-author-drew.md)
for what is recognised and what is deliberately not.

Both passes stamp and move on; neither rewrites the author's words, because stage 3 recovers a
block's id by matching its tag and its text and a re-worded block is a re-minted id
([block-ids.md](block-ids.md)).

**The attributes themselves belong to [`src/reserved.ts`](../../src/reserved.ts)**, which is the one
file allowed to name a `data-spya-*` attribute and owns the scrub that makes them ours — every copy
the page arrived carrying is removed before we write one, `<template>` fragments included. A
recogniser registers a name there and uses that scrub;
[tests/reserved.test.ts](../../tests/reserved.test.ts) fails if a fourth one invents its own. What a
recognised callout produces is a **context** — an authored grouping a run of blocks belongs to,
`Block.context` in [types.ts](../../src/types.ts) — and deliberately *not* a `kind`, because a
heading inside a box is still a heading.
[260831af](../plans/260831af-carrying-markup-facts-past-readability.md) has the reasoning and the
option that was passed over.

The rest is not fixed, and the largest of it is not truncation at all:

> **13 of the 15 fixture pages lose 10% or more of some structural element** — tables, formulas,
> code, headings. Wikipedia's *Transformer* article arrives with **0 of its 188 `<math>` elements**;
> a 24,000-word ACX review keeps 19 of 134 headings.

(Wikipedia is the gentler of those two: the `<math>` is inside `style="display: none"` and the
**188 fallback images survive**, so the reader sees every formula. What is lost is the machine-readable
copy. The ACX case has no fallback — those headings are simply gone.)

That matters here more than in most reading apps, because the table of contents and the
granularity-zoom tree are the same structure, built from headings
([granularity-zoom.md](granularity-zoom.md#the-tree)). An article whose headings were dropped at this
stage has no tree to build at stages 4 and 5, and nothing reports it. The character comparison barely
notices — the prose around a discarded formula is intact.

The measurements, the five bugs the instrument shipped with, the fifteen committed fixtures, and what
a model pass would and would not buy are all in
**[../plans/260827ab-readability-repair-pass.md](../plans/260827ab-readability-repair-pass.md)**.

**And there is a second failure, opposite in direction, found 2026-08-30.** Everything above measures
what Readability *threw away*. Nothing measured what it *kept* — and Paul Graham's *How to Do Great
Work*, which the corpus scores as losing nothing at all (ratio 1.000), reaches the reader as 328
blocks of which **87 hold six characters or fewer**: `[1]`…`[29]`, a bare `[`, a bare number. They are
all `gistable`, so the table of contents, the summaries and the zoom tree treat punctuation as
content. The same shape is on Wikipedia (nineteen `[edit]`), MDN (thirty `http` code-fence labels),
RFC 9110 (`¶` permalinks) and a MacTutor biography (bare years, and the words `in` and `'s`, split
mid-sentence).

The instrument for it is [`evals/extraction/probe.mts`](../../evals/extraction/probe.mts), which runs
this stage **and stage 3's real splitter** and reports what a reader would actually get. What a model
pass buys, what a four-line regex buys for free, and the two fixtures whose whole article arrives as
one 67,890-character block are in
**[../plans/260830at-readability-tidy-pass.md](../plans/260830at-readability-tidy-pass.md)**.

**And a third instrument answers by identity rather than by matching text.**
[`evals/extraction/provenance.mts`](../../evals/extraction/provenance.mts) stamps every source
element before Readability and takes the DOM back through Readability's `serializer` option
(`readArticleWithProvenance` in [`src/extract.ts`](../../src/extract.ts)), so an output node says
which source node it came from — which is the only way to see a *duplicated* passage, invisible to
any substring test. Over 35 fixtures and 83,091 output elements: 98.7% carry a stamp directly, and
the stamping is inert on every one of them — the extracted HTML is byte-identical once the stamps are
removed, checked rather than assumed because Readability weights `class` and `id`. Read the
`distinct` and `fanout` columns before trusting the fallback, and read `mapped` as "located within"
rather than "came from": on Paul Graham's page 217 output nodes resolve to one source element.

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
you do is open it — so it goes through `sanitizeHtml` before it leaves this stage. Note that this
page **is** the `extractedHtml` artefact, not a second copy of it: stage 3 reads it and stamps block
ids into it. That is worth stating rather than tidying, because making the artefact the bare body
would change every block stage 3 cuts, on every article.

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

The standalone styled HTML output doubles as a debug view; the durable artefacts are the same two
things this stage returns, and where they land is the store's decision — `output/<slug>.html` plus
`data/<slug>/meta.json` on a filesystem, columns on `article_revisions` in Postgres.

The metadata landed on 2026-08-25, when the library needed something to put on a card: title,
byline, site, language, source URL, fetch date and Readability's excerpt. **It is the only place the
source URL and the byline survive past this script**, and it is rebuilt on every run, because
re-extracting is how you refresh a page and the fetch date should follow. One subtlety worth reading
before touching it — the **command line** derives the slug from the *output filename* rather than
from the URL, because that is what stages 3 and 4 will name the data directory after; `runExtract`
itself now takes the slug as an argument, since the queue has always known it. Both are in
[library.md § meta.json](library.md#metajson-and-the-articles-identity).

Why any of this exists at all: [vision.md](vision.md).

## Prior art

The previous version of Spideryarn ran a Readability-based extraction path in production and wrote
down what went wrong with it. See
[original-version/extraction.md](original-version/extraction.md) for the pointers.
