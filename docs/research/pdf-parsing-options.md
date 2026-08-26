# PDF → structured HTML: the options, and why we picked the one we did

**Researched 2026-08-25/26**, for [../plans/pdf-ingestion.md](../plans/pdf-ingestion.md). The plan
says what we're building; this file says what else we could have built and why we didn't. Three
Sonnet subagents searched the web, one read the original version's PDF code, and two small probes
were run on real PDFs on this laptop. Prices and benchmark numbers are as found on those dates —
they move, so re-check before quoting them anywhere that matters. Selection followed
[../reusable/third-party-library-selection.md](../reusable/third-party-library-selection.md).

## What we need

Long-form prose in a PDF — academic papers (two-column, footnotes, references, figures, some maths),
essays, book chapters, reports, and sometimes a scan with no text inside it — turned into the same
clean HTML that Mozilla Readability gives us for a web page, so that
[stage 3 onwards](../project/architecture.md#pipeline) runs unchanged. Deployment is Vercel
serverless ([../plans/deploy-and-repo-move.md](../plans/deploy-and-repo-move.md)): no native binaries,
pure JS or WASM only, a 250 MB bundle, and a request body limit of about 4.5 MB.

Greg's framing of the balance, 2026-08-25:

> We want to get the best balance of accuracy, latency, cost, intelligence.

## Two probes, run here

Before believing any of the web research, two PDFs went through `pdfjs-dist` 6.2 on this laptop
(scratch script, not in the repo):

- **Nagel, *What Is It Like to Be a Bat?*** — the 4.9 MB JSTOR PDF that
  [fetching.md](../project/fetching.md#size-and-the-header-that-lies-about-it) uses as its size
  case. It is a **scan with an OCR text layer**: 17 pages, one page image each, plus text. pdf.js
  read all 17 pages in **392 ms**, one line per item with x/y positions. In that geometry the
  running header ("THOMAS NAGEL", top of every page), paragraph indents (x=124 vs x=109) and
  end-of-line hyphenation ("psychophys-" / "ical") are all visible. The junk: a JSTOR cover page,
  a "This content downloaded from…" footer on every page, and footnote markers OCR'd as
  apostrophes (`reduction.'` for `reduction.¹`).
- **BERT (arXiv 1810.04805)** — a two-column pdfTeX paper. pdf.js returned the **left column
  top-to-bottom, not interleaved with the right**. LaTeX writes columns in order in the content
  stream, so the classic "reads straight across both columns" failure is producer-dependent —
  Word, InDesign and OCR engines are the offenders — not universal.

Two lessons: the text layer is usually *there* and usually *nearly right*, and the remaining
problems (furniture, hyphenation, OCR glitches, occasional column jumble, what is a heading) are
exactly the kind a model fixes cheaply and a heuristic never quite does.

## The three families

```
  A. PARSE THE TEXT LAYER          B. HOSTED LAYOUT/OCR SERVICE       C. A MODEL READS THE PAGES
     (pure JS/WASM, our CPU)          (HTTP call, markdown back)         (page images + text, HTML back)

  PDF ─► pdf.js/MuPDF ─► words     PDF ─► Mistral OCR / LlamaParse   PDF ─► Claude / Gemini
         with x,y,font                    / Reducto / Azure DI                per page-range chunk
       ─► OUR heuristics ─► HTML        ─► markdown ─► HTML                ─► HTML, stitched

  time   ~0.4 s / 17 pages           ~5–60 s                          ~20–60 s (chunks in parallel)
  cost   £0                          ~$0.004–0.015 / page             ~$0.007–0.02 / page (Haiku/Gemini Flash)
                                                                       ~$0.015–0.04 / page (Sonnet 5)
  scans  nothing (no text layer)     yes                               yes
  2-col  producer-dependent          mostly                            yes
  reads  characters + positions      characters + layout              the prose — knows a footnote
                                                                       marker is a footnote marker
  new    nothing                     a vendor + a key                  nothing (Anthropic SDK is
  deps                                                                 already here); Gemini = new SDK
```

### A. Pure JS / WASM parsers

| Library | What it gives you | Notes |
|---|---|---|
| **`pdfjs-dist`** (Mozilla pdf.js) | flat list of positioned text items, font name, `hasEOL` | ~14–20M weekly downloads, Mozilla-maintained, TypeScript types. The `legacy` build runs in Node. No paragraphs, no columns — you reconstruct both. The engine everything else wraps. |
| **`unpdf`** (unjs) | same output, serverless-packaged | Strips pdf.js's `canvas` dependency and inlines the worker so it runs in edge/serverless runtimes without shims. Built on pdf.js 5.6. ~1.2k stars. The comfortable way to run pdf.js on Vercel. |
| **`mupdf`** (Artifex MuPDF.js, WASM) | **blocks → lines → spans**, with bbox, font and size | Real structure, better raw material for heading and column heuristics. But **AGPL / commercial dual licence** — deploying it in a product is a licensing question, not just a technical one. ~250–300k weekly downloads, active. No first-hand Vercel report found. |
| `@hyzyla/pdfium` | PDFium (Chrome's engine) in WASM, positioned text | Lower-level than MuPDF's structured text; permissive licence. Newer, smaller. |
| `pdf-parse` | one flat string | Unmaintained for years, nominally revived (2.4.5). No positions, so useless for columns. Skip. |
| `pdf2json` / `pdfreader` | JSON of raw positioned runs | Healthy, ~550k weekly, but old pdf.js-internals-shaped output. Not a fit. |
| **`@opendocsg/pdf2md`** | pdf.js + heuristics → Markdown | The closest existing example of family A done well: frequency-based header/footer removal across pages, heading and list reconstruction. Its own README: *"Multi-column academic papers mostly work but occasionally jumble."* Worth reading as a reference implementation. |
| `pdf-lib` | split/merge PDFs, pure JS, MIT | Not a parser — it is what we'd use to **cut a PDF into page-range chunks** for family C. Last release 2021 but ~2M weekly downloads and stable; `@cantoo/pdf-lib` is a maintained fork if it bites. |
| ~~`pdftotext`, `node-poppler`, `pdf2htmlEX`~~ | | Native binaries. Ruled out on Vercel. |
| ~~`@opendataloader/pdf`~~ | | A Node wrapper around a **Java** CLI. Tops a 200-PDF structure benchmark (0.907) — useful as a ceiling to know about, undeployable here. |

**What the benchmarks say about the ceiling.** Nobody benchmarks a pure-heuristic JS parser
against the state of the art, which is itself informative. The closest data: on READoc, Marker
(an ML layout model) scores ~98% reading-order accuracy and PyMuPDF4LLM — architecturally the
nearest thing to "MuPDF text + heuristics" — ~88–89%. PyMuPDF's own maintainers needed a dedicated
ML layout model (PyMuPDF-Layout, 2026) to get meaningful gains on **footers and section headers**
specifically. Expect family A alone to be "fine for single-column prose, occasionally wrong on
two-column papers, blind to scans", and to cost real engineering time in heuristics that are never
quite finished.

### B. Hosted document-parsing APIs

| Service | Price | Latency | Output | Notes |
|---|---|---|---|---|
| **Mistral OCR** (OCR 4) | $4 / 1,000 pages ($2 batch) | seconds — claims ~2,000 pages/min | markdown, bboxes | Official TS SDK. Mid-pack on OmniDocBench-style comparisons (~82%). Reported: guesses at unclear text; occasional column misalignment. **This is what the original version actually defaults to** (below). |
| **LlamaParse** (Cost Effective tier) | ~$0.004 / page; 10k free credits/month | async, tens of seconds, queue can throttle | markdown | The vendor most explicit about our exact worries: two-column, footnotes, strip headers/footers by page-percentage band. Async-only means polling plumbing. |
| **Reducto** | ~$0.015 / page | sync | markdown/JSON | Accuracy leader on its own table benchmark (90% vs Azure 83%); built for forms/tables more than prose. Node SDK. |
| Upstage Document Parse | $0.01 / page | | HTML/markdown | Cheap; thin independent evidence. |
| Azure Document Intelligence / Google Document AI | $10 / 1,000 pages | | markdown | Mature, big-cloud SDKs, no standout for two-column prose. |
| AWS Textract | ~$0.015 / page | | JSON blocks | Would need our own reflow. |
| Docling for IBM watsonx | $4 / 1,000 pages | | | The Python-only Docling now has a hosted API (2026). |
| Datalab (Marker / Chandra) | credits | | markdown | Chandra tops some 2026 OCR benchmarks; young company. |
| Chunkr, Unstructured, Adobe Extract | flat plans / $0.03 / sales call | | | Nothing differentiating for us. |
| Replicate/Modal-hosted marker, MinerU, olmOCR | cheap per page | **30–90 s cold start** | | Cold start alone blows a one-minute budget unless you pay to keep it warm. |

Family B's shape: cheapest per page, fast, handles scans and columns. Its cost is a vendor and a
key, and — the important one — **it reads characters and layout, not prose.** It cannot be told
"drop the references section and the footnotes" or "this is a JSTOR cover page"; a tidy-up pass
would still be needed after it. That is why it is the v2 cost option rather than the v1 route.

### C. A multimodal model reads the pages

| Route | Page limit | How pages are billed | Price (in/out per MTok) | Notes |
|---|---|---|---|---|
| **Claude, `document` block** | 32 MB; 600 pages on 1M-context models, **100 on Haiku 4.5** (200K) | text (~1,500–3,000 tokens/page) **plus** a page image (~1,000–2,000) — the hybrid the practitioner write-ups recommend, done for you | Haiku 4.5 $1/$5 · Sonnet 5 $2/$10 · Opus 5 $5/$25; Batch API halves all of them | Already our SDK and key. Files API (beta) uploads once and reuses. Citations return `page_location` — a free page-number mapping if we want one later. Prompt caching works on document blocks. |
| Gemini 3.x Flash / Pro | 1,000 pages, 50 MB | flat **258 tokens/page**, embedded text not charged | Flash $0.75/$3.75 · Pro $2/$12 | Cheapest frontier per page by a wide margin; Gemini-3-Flash tops OmniDocBench (90.1%). Costs us a second SDK and key. |
| OpenAI file input | 50 MB | text + image, `detail` low/high | tiers | Least documented of the three for PDFs. |
| Hosted OCR-specialist VLMs (olmOCR 2, Chandra, Nanonets OCR-3, DeepSeek-OCR…) | | token-metered small models | cents per doc | 10–50× cheaper than frontier; quality now roughly level with frontier on prose, not clearly better. Cold-start and hosting caveats as for family B. |

**Where the money goes.** For a dense page, output tokens (the transcription, ~800–1,000 per
page) cost more than the input at Haiku prices — so **sending the page image is nearly free once
you are sending the text at all.** That single fact is why v1 hands the model the PDF rather than
the text layer: the image buys headings, columns and scans for a few cents.

Back-of-envelope for a 20-page two-column paper (assumptions: ~600 words/page, output ≈ 85% of
input words; all chunks in parallel so wall-clock ≈ the slowest chunk):

| Route | Cost | Wall-clock |
|---|---|---|
| Claude Haiku 4.5, native PDF, 4-page chunks | **~$0.15–0.20** | ~20–40 s |
| Claude Sonnet 5, same | ~$0.30–0.35 | ~30–60 s |
| Gemini 3.7 Flash | ~$0.07 | ~10–20 s |
| Mistral OCR | ~$0.08 | ~5 s (then still needs a tidy-up pass) |
| pdf.js + heuristics | $0 | ~0.5 s |

Not measured — derived from the vendors' documented token ranges. Measure on Nagel and BERT before
quoting.

**Failure modes people write up, all of which shape the plan:**

- **Silent summarising.** On long documents the model drifts from transcription into compression
  after page N, and nothing errors. Fix: small page-range chunks, "transcribe verbatim, do not
  summarise", and a **two-sided word-count check against the text layer** per chunk. The original
  version's own "we never checked `finishReason`" bug is the same shape.
- **Hallucinated or dropped sentences**, invisible in clean-looking output. Same fix; a fuzzy diff
  of sampled sentences against the text layer catches the rest.
- **Paragraphs split at chunk boundaries.** Give each chunk the tail of the previous chunk's text
  layer and ask it to mark a continuing paragraph; stitch afterwards.
- **Running headers/footers** — instruct the model, *and* strip repeated lines across pages in code,
  because belt and braces is cheap here.
- **Two tiers is what practitioners actually run**: a cheap pass on everything, a frontier pass only
  on pages that fail a check. Nobody serious puts 100% of volume through a frontier model.

## The original version, checked against its code

[../project/original-version/extraction.md § PDFs](../project/original-version/extraction.md#pdfs-out-of-scope-but-the-lesson-transfers)
summarises the docs. The subagent read the ~14 `PDF_*.md` files **and** the code
(`app/api/upload-pdf/route.ts`, `lib/services/*pdf*`), and found:

- **v1**, `pdf2pic` + GraphicsMagick → page images → vision model. Dead on arrival on Vercel (native
  binaries, 50 MB function cap then). `pdf-to-png-converter`, tried as a pure-JS replacement,
  **crashed on academic PDFs** with a pdf.js font error. MuPDF.js was tried and ripped out because
  it `import("node:fs")`s and broke the Next.js webpack build.
- **v2**, "Vision": client-side pdf.js renders pages to PNG → each page to Gemini Flash → HTML
  fragments stitched → optional Claude refinement. Real, still wired into the UI. Their own numbers:
  **$0.10–0.20 per page, 45–60 s for 20 pages — "100× more expensive"** than v3.
- **v3**, "native": the whole PDF buffer to a provider that ingests PDFs itself. Three providers
  selectable: Claude Sonnet 4 (no bounding boxes), Gemini 2.5 Flash (boxes), Mistral OCR
  (markdown → HTML via `marked`, boxes). **The docs say Gemini is the default; the code says
  Mistral** (`let provider = 'mistral'`, and the Zod default). Claimed: Gemini ~$0.001/page,
  20–30 s per 20 pages; Claude ~$0.003/page, 15–25 s.
- A planned **"2nd-stage refinement layer"** — send v3's HTML plus the PDF to a stronger model,
  explicitly "to deal with footnotes better" — was **never built**. So was the page-parallel
  strategy their most substantive doc describes, with its warning that a 20-page paper as one call
  produces 60,000+ output tokens.
- Their image extraction, for figures: direct XObject extraction covers only **40–60% of academic
  PDFs** (vector figures and text-as-paths are invisible to it); their pure-JS fallback exists but the
  code still defaults to the old `skia-canvas` path that crashed on Vercel with a
  `NODE_MODULE_VERSION` mismatch. One silent-success bug worth remembering: raw `/FlateDecode`
  streams uploaded as `.png` — 200 OK, broken image.
- The whole area is frozen since 2025-07.

What transfers: *give the model the bytes* (right), *chunk and parallelise* (designed, not built —
we build it), *check the output against something* (their v1 bug, our v1 check), *don't render
pages to images yourself on Vercel* (their v1 and v2 pain), and *figures are the hard part* (their
40–60%).

## The decision

**v1 = pdf.js text layer as the free baseline + a vision model reading page-range chunks in
parallel, checked against that baseline.**

> **Settled by measurement, 2026-08-26: the model is Gemini 3.7 Flash through OpenRouter.** Not on
> the benchmark scores this document spends its length on, and not on the price-per-token table
> either — the measured cost gap was 1.7×, where two price-per-token numbers predict 2.5×. It won on
> one thing: every Claude Haiku 4.5 variant silently dropped a page of a scan, three runs out of
> three, and Gemini read it. The evidence is in
> [the plan](../plans/pdf-ingestion.md#the-bake-off-and-what-it-decided-2026-08-26) and
> [`evals/pdf/baselines/bakeoff-2026-08-26.json`](../../evals/pdf/baselines/bakeoff-2026-08-26.json).
>
> Which is a small lesson about this document. Nothing in the research below predicted the finding
> that actually decided it, and one of the two findings from the hour — that putting the PDF before
> the instruction makes the model skip a page — is not the kind of thing any amount of reading
> would have turned up. **A bake-off is not a tiebreaker for the reading; it is the only part of it
> that is evidence.**

Reasons for the shape, in order:

1. ~~**No new vendor.**~~ **Superseded 2026-08-26** — see [the second round](#second-round-2026-08-26).
   The original reasoning was that Gemini Flash is cheaper and benchmarks higher but costs a second
   SDK, key and set of failure modes. Greg reversed it: *whoever reads best wins*, because every
   later stage inherits this stage's mistakes and none of them can detect one. And the cost of the
   reversal turned out to be much smaller than assumed — OpenRouter reaches Gemini and Mistral under
   the key and bill this repo already has.
2. **The image is nearly free once you pay for the output**, and it is what makes scans, columns
   and headings work without heuristics.
3. **A cheap model, not a frontier one.** Greg: *"I'm hoping we won't need a frontier model."*
   Transcription is not reasoning — and the bake-off bore this out, with a $0.005-a-page model
   scoring 0.93–0.95 recall on a dense two-column paper. `MODEL` (Sonnet 5) is the escalation tier, on request, recorded
   in `meta.json` — never a silent switch.
4. **The text layer is kept and used**, not thrown away: it is the page count, the "is this a scan"
   signal, the title, the verification baseline, and (v2) the page-number map.
5. **Family A alone** was rejected on the benchmark ceiling and on the honest admission in
   `pdf2md`'s README. **Family B alone** was rejected because it can't be told what to drop, so a
   model pass follows it anyway; it stays on the table as the cheap first pass of v2.
6. **MuPDF.js** was rejected on AGPL; **`unpdf`** over bare `pdfjs-dist` is a toss-up we settle
   when the code is written — `unpdf` if the legacy build needs shims on Vercel, bare pdf.js if it
   doesn't. The bake-off used bare `pdfjs-dist` (`legacy/build/pdf.mjs`) on a laptop and it was
   fine, which says nothing about Vercel.

## Second round, 2026-08-26

Two more Sonnet searches, prompted by Greg: *"I'm also open to using Mistral-OCR if you think that's
helpful. Make sure to use some Sonnet subagents to research what's available through OpenRouter."*
Everything below is dated, because most of it will be stale within months.

### OpenRouter changes the vendor arithmetic

The first round treated "a second vendor" as a second SDK, key, bill and outage surface. That is
only true of going direct. OpenRouter — already wired here, `OPENROUTER_MODEL` in
[`src/models.ts`](../../src/models.ts) — reaches the alternatives under one key and one bill:

| Reachable via OpenRouter | What it is | Price (2026-08-26) | Notes |
|---|---|---|---|
| `native` PDF engine | passes the PDF's bytes straight to a model that reads PDFs natively (Claude, Gemini) | no per-page fee, just tokens | **the important row** — no conversion step, so no fidelity loss |
| Claude Haiku 4.5 | vision + native PDF | $1 / $5 per MTok, $0.10 cache read | what the plan assumes today |
| Gemini 3.7 Flash | vision + native PDF | $0.375 / $1.875 per MTok | released 2026-08-13; ~2.5× cheaper than Haiku on these pages |
| `mistral-ocr` engine | a PDF→markdown *parser* invoked inside a chat request | $2 / 1,000 pages | **not** the same surface as Mistral's own `/v1/ocr` |
| `cloudflare-ai` engine | PDF→markdown, text-oriented | free | born-digital only; no OCR for scans |
| Qwen3-VL 32B/235B | open-weight vision | $0.10–0.25 / $0.42–0.88 per MTok | no independent quality evidence for this task |

What OpenRouter costs: a thin platform fee, and **prompt caching that only holds within one
provider** — its auto-routing can silently break a cache hit unless routing is made sticky. Not a
capability loss. Structured JSON-schema output is supported.

Two things could not be verified and should be checked before anything depends on them: whether
OpenRouter's `mistral-ocr` engine runs OCR 4.1 or the older, Mistral-deprecated 2503 model; and
whether dots.ocr, olmOCR or InternVL are listed there at all.

### Mistral OCR: not the transcriber, possibly the witness

> **Run, 2026-08-26.** It works, it costs $0.002 a page to parse, and it came back in 6 seconds. Two
> things the run added that the reading below could not: its output arrives as **one flat markdown
> blob with no page boundaries** — two pages in a single string, so the per-page check cannot run
> against it without reconstructing pages ourselves — and a second call within seconds was refused
> with *"The document parsing engine is currently rate limited."* It also misread the library stamp
> on the Wellcome scan as "NELLOGNE LIBRARY INSTITUTE", which is the encouraging kind of error:
> visible, checkable, and not a fluent invented sentence.

The two searches disagreed, and the disagreement is the useful part.

Against it as the main path: independent tests (Reducto, Pulse, a PyImageSearch review) report
invented text on low-resolution scans, dropped headers and footers, tables rendered as images,
headers duplicated across tables, ~17% column misalignment on complex tables and ~1.5% numeric
deviation. It "doesn't validate" what it extracts, and clean markdown hides a flipped digit
perfectly. OpenRouter's wrapper also strips the one thing that would let us catch its errors —
Mistral's own endpoint returns block labels, bounding boxes and confidence; the wrapper returns
flattened text.

For it, on exactly our hardest case: **specialist OCR engines are markedly more honest about
illegibility than general vision models.** On a hallucination-specific benchmark, PP-OCRv6 scored
93.2% against Kimi-K2.6 at 85.0%, Qwen3-VL-235B at 80.6% and MiniMax-M3 at 72.6%. A general model
faced with a damaged word reaches for a plausible one, because that is what it is built to do.

So Mistral OCR's role here is **not transcription — it is the receipt for a scan.** A scan has no
text layer, which is what our check normally compares against; an OCR pass manufactures one for
about 3p on a 17-page document, and it fails differently enough from a vision model that
disagreement is a real signal. Greg's call (2026-08-26): put it in the bake-off on scan pages and
decide from what it actually catches, rather than committing now.

### Silent degradation is documented in production, not theoretical

The strongest finding, and it hardens the plan rather than changing it. LlamaIndex's April 2026
write-up of LlamaParse failures at scale names two modes we had not planned for:

- **Repetition loops** — the decoder sticks, emitting repeated text or whitespace. Reported as
  *worse* with thinking models, which is a point in favour of the plan's "no thinking on Haiku".
- **Recitation blocks** — a provider's own safety filter kills generation partway through long
  structured or boilerplate text, mistaking it for copyright violation. It appears as
  `content_filter` (OpenAI), `RECITATION` (Gemini) or a refusal (Anthropic). A transcription task
  is precisely the shape that trips this.

Their mitigations are cheap and belong in v1: hard `max_tokens` caps, terminate a stream on
detected repetition, bump temperature on retry, and route retries by *finish reason* rather than
retrying blindly.

And the base rate: **ParseBench** (2,000 enterprise pages) found even the best methods reach only
~90% content faithfulness — roughly one page in ten has dropped or invented content, and the
omission is usually silent, a 40-row table returned as 38 rows with nothing to mark it. This is the
number that justifies the whole per-page check.

### Benchmarks: trust them less than the first round did

OmniDocBench is **saturated** — top scores cluster at 90–96% on 1,355 pages, and its exact-match
scoring punishes a semantically correct answer formatted differently. LlamaIndex argued in February
2026 that it needs a successor; none has been adopted. Several leaderboard entries are vendor
self-reported. [OCR Arena](https://ocrarena.ai), a head-to-head ELO, is the better cross-check, and
has Gemini 3 Flash first, then Gemini 3 Pro, Claude Opus 4.6, GPT-5.2.

Neither measures our two hard cases. That is the argument for the bake-off and for
[the eval](../plans/pdf-ingestion.md#the-eval-evalspdf) — our documents are the benchmark that
matters, and they are the only one that stays true when the models change.

### Reading order is a structural failure, not an OCR one

Worth stating plainly because it changes what to look for. A two-column page read straight across
produces interleaved text that is still fluent English — no character is wrong, so a
character-level score will not catch it. Docling has an open, unresolved issue (#2067) on exactly
this. Two approaches compete: detect layout regions first and transcribe each in order, or let one
model reason about layout and content together. Practitioners lean towards the first, because its
failures are *visible* (boxes in the wrong order) rather than silent. We get this for free in a
different way: the pdf.js text layer gives an independent reading order to compare against.

### Dedicated OCR models, and why none of them is the answer here

GLM-OCR (94.6 on OmniDocBench v1.5), PaddleOCR-VL-1.5 (94.5), MinerU2.5 (90.7) and dots.ocr (88.4)
all beat the general models on raw transcription, at a fraction of the cost. All of them are Python
plus GPU model weights. We deploy to Vercel serverless: no native binaries, no GPU. So a dedicated
model is only interesting if somebody hosts it — which is exactly what Mistral OCR is. Licences are
clean if this changes (PaddleOCR-VL Apache 2.0, dots.ocr MIT, olmOCR Apache 2.0, Docling MIT);
MinerU has left AGPL for an Apache-based licence with a revenue cap that would not bind us.

### Corrected by GPT Sol, same day

Two claims above were stronger than their evidence and are corrected in
[the plan](../plans/pdf-ingestion.md#gpt-sols-third-review-2026-08-26); repeated here so this
document doesn't keep asserting them:

- **The honesty numbers are PP-OCRv6 against general vision models.** Applying them to *Mistral OCR
  against Haiku or Gemini* is an extrapolation. Mistral OCR is itself a learned system with language
  priors and can reach for the same plausible wrong word. The independence the scan cross-check
  depends on is a hypothesis to be measured, not a finding.
- **"No fidelity loss" through OpenRouter's `native` engine is not what the documentation says.**
  What it says is that the file goes to a natively-capable model without a conversion step.
  OpenRouter is still an adapter: a different structured-output parameter, and a *normalised*
  `finish_reason` with the provider's real one moved to `native_finish_reason`. And its OCR engine
  returns flattened annotations with no guaranteed page boundaries, so the "manufactured text layer"
  may need reconstructing into pages before it can be compared page by page.

### Sources, second round

openrouter.ai/docs/guides/overview/multimodal/pdfs · openrouter.ai/anthropic/claude-haiku-4.5 ·
openrouter.ai/google/gemini-3.7-flash · openrouter.ai/qwen/qwen3-vl-32b-instruct ·
openrouter.ai/blog/tutorials/prompt-caching-sticky-routing ·
docs.mistral.ai/models/ocr-4-1 (2026-07-16) · mistral.ai/news/ocr-4 ·
llamaindex.ai/blog/engineering-insights-failure-modes-that-break-vlm-powered-ocr-in-production
(2026-04-08) · llamaindex.ai/blog/omnidocbench-is-saturated-what-s-next-for-ocr-benchmarks
(2026-02-24) · llamaindex.ai/blog/llm-ocr (2026-08-03) · ocrarena.ai ·
llm-stats.com/benchmarks/omnidocbench · arxiv.org/pdf/2604.08538 (ParseBench) ·
arxiv.org/pdf/2606.13108 (PP-OCRv6 hallucination numbers) ·
github.com/docling-project/docling/issues/2067 · github.com/opendatalab/MinerU/blob/master/LICENSE.md ·
github.com/allenai/olmocr · huggingface.co/ibm-granite/granite-docling-258M ·
pyimagesearch.com/2025/12/23/mistral-ocr-3-technical-review-sota-document-parsing-at-commodity-pricing ·
github.com/icereed/paperless-gpt/issues/792

## Sources, first round

Family A: npmjs.com/package/pdfjs-dist · github.com/unjs/unpdf · npmjs.com/package/mupdf ·
artifex.com/blog/mupdfjs-with-npm · github.com/hyzyla/pdfium · npmjs.com/package/@opendocsg/pdf2md ·
github.com/opengovsg/pdf2md · opendataloader.org/docs/faq · arxiv.org/pdf/2409.05137 (READoc) ·
pdfmux.com/blog/pdfmux-vs-pymupdf-vs-marker-vs-docling ·
medium.com/@pymupdf/pymupdf-layout-performance-on-doclaynet-a-comparative-evaluation-91d8f41d9f67 ·
vercel.com/kb/guide/troubleshooting-function-250mb-limit

Family B: mistral.ai/news/ocr-4 · docs.mistral.ai/api/endpoint/ocr ·
developers.llamaindex.ai/llamaparse/general/pricing · reducto.ai/pricing ·
llms.reducto.ai/best-document-processing-apis-2026 · upstage.ai/pricing/api ·
cloud.google.com/document-ai/pricing · aws.amazon.com/textract/pricing ·
docling.ai/blog/20260615_00_docling_for_ibm_watsonx · github.com/opendatalab/OmniDocBench ·
huggingface.co/datalab-to/chandra · reducto.ai/blog/lvm-ocr-accuracy-mistral-gemini ·
runpulse.com/blog/beyond-the-hype-real-world-tests-of-mistrals-ocr

Family C: platform.claude.com/docs/en/build-with-claude/pdf-support ·
platform.claude.com/docs/en/about-claude/pricing · ai.google.dev/gemini-api/docs/document-processing ·
ai.google.dev/gemini-api/docs/pricing · developers.openai.com/api/docs/guides/pdf-files ·
benchmarking.nanonets.com/benchmarks · llm-stats.com/benchmarks/omnidocbench ·
e2enetworks.com/blog/complete-guide-open-source-ocr-models-2025 ·
unstract.com/blog/why-pdf-to-markdown-ocr-fails-for-ai-document-processing ·
mlaidigital.com/blogs/dont-use-llms-as-ocr-lessons-from-complex-documents ·
extend.ai/resources/preprocess-documents-llm-agents ·
instavar.com/blog/ai-production-stack/LLM_vs_OCR_Wrong_Debate_Actual_Taxonomy_2026

Original version: `/Users/greg/dev/spideryarn/reading` — `docs/reference/PDF_*.md`,
`docs/planning/250706a_mistral_gemini_native_pdf_v3_pipeline.md`,
`docs/planning/250710a_pure_js_pdf_image_extraction_server_side.md`,
`app/api/upload-pdf/route.ts`, `lib/services/gemini-native-pdf-processor.ts`,
`lib/services/mistral-ocr-pdf-processor.ts`, `lib/services/page-processor.ts`.
