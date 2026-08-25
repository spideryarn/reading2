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

**v1 = pdf.js text layer as the free baseline + Claude Haiku 4.5 reading page-range chunks in
parallel, checked against that baseline.** Reasons, in order:

1. **No new vendor.** The Anthropic SDK and key are already here; every pipeline stage uses them.
   Gemini Flash is cheaper and benchmarks higher, and it costs a second SDK, a second key and a
   second set of failure modes — the right v2 experiment if Haiku's cost or latency bites, not the
   v1 default.
2. **The image is nearly free once you pay for the output**, and it is what makes scans, columns
   and headings work without heuristics.
3. **Haiku, not Sonnet, not Opus.** Greg: *"I'm hoping we won't need a frontier model."*
   Transcription is not reasoning. `MODEL` (Sonnet 5) is the escalation tier, on request, recorded
   in `meta.json` — never a silent switch.
4. **The text layer is kept and used**, not thrown away: it is the page count, the "is this a scan"
   signal, the title, the verification baseline, and (v2) the page-number map.
5. **Family A alone** was rejected on the benchmark ceiling and on the honest admission in
   `pdf2md`'s README. **Family B alone** was rejected because it can't be told what to drop, so a
   model pass follows it anyway; it stays on the table as the cheap first pass of v2.
6. **MuPDF.js** was rejected on AGPL; **`unpdf`** over bare `pdfjs-dist` is a toss-up we settle
   when the code is written — `unpdf` if the legacy build needs shims on Vercel, bare pdf.js if it
   doesn't.

## Sources

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
