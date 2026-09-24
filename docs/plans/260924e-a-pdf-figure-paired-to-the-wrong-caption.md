# A PDF figure paired to the wrong caption

Greg, 2026-09-24, on his copy of Chris Olah's *Distributed Representations: Composition &
Superposition* (`/read/distributed-representations-composition-superpos-spya-fs7zvp?at=spya-vh4zjj`),
which showed *Thorpe's "Local Code" Example — We couldn't recover this figure from the PDF*:

> Why not? If this is a straight bug, let's fix it. If it's subtle/unfixable, could we ask Luna or
> some other model (maybe Sonnet web research on what's best at this) to provide a bounding box and
> then something else that can extract the image programmatically from the rendered PDF with
> something akin to a screenshot? Note that this PDF tooling ideally needs to run on Vercel, which
> has restrictions on what we can run. If that ends up being the blocker, consider whether it would
> help to run in the browser or even as a Supabase Edge Function. Run spikes as needed.

The postmortem is
[260924a-a-figure-paired-on-the-transcripts-page-claim.md](../postmortems/260924a-a-figure-paired-on-the-transcripts-page-claim.md).

## What happened

This session has no production access, so the PDF was **rebuilt**: the essay printed from
`transformer-circuits.pub` with Chrome, at A4 and at Letter (the pictures fall on the same pages
in both), and ingested locally. The failure reproduced exactly: the "Local Code" figure was
caption-only, `no-raster`, on page 1.

The essay's figures are PNGs in the web page, so the printed PDF carries them as ordinary embedded
images, which the bitmap route handles. Nothing is drawn with vector paths. The problem is the
**page number**:

| caption the transcript wrote | page it claimed | where the picture really is | outcome |
| --- | --- | --- | --- |
| Thorpe's "Local Code" Example | 1 | 2 | `no-raster` (page 1 has no picture) |
| Thorpe's "Semi-Local Code" Example | 2 | 3 | **stored, and the picture is the Local Code one** |
| Thorpe's "Highly Distributed Code" Example | 3 | 4 | **stored, and the picture is the Semi-Local one** |
| Thorpe's "Semi-Distributed Code" Example | 5 | 6 | `ambiguous` (page 5 has two pictures) |

The transcriber (`pdf-v4`, Luna) returns a `page` for every record. For a figure it gave the page
where the paragraph *introducing* the figure ends, because Chrome pushed each tall picture onto
the next page. These captions are not printed anywhere as text: each is a title drawn **inside** the
PNG, so the text layer never contains them. `pairPageFigures` trusts the model's page completely. It
attaches the one picture on that page to the one caption on that page, and nothing asks whether
that caption belongs to that picture.

So "couldn't recover" is the harmless half. The harmful half is two figures showing the **wrong
picture** under a caption, which
[260906a § What Fable settled](260906a-figures-from-a-pdf-are-placeholders-with-no-image.md#what-fable-settled-2026-09-06)
ranks as far worse than a missing one: *"a missing figure is visible, a swapped one looks
correct."* Greg's production copy is very likely showing the same two swaps, since his PDF produced
the same first failure.

## Stage 1: the fix, built here

**A picture attaches to a caption only if that caption is printed on the picture's page.** It is
checked on the text layer the raster reader already fetches for its scanned-page rule, using the
same normalisation as the drawn route's `findCaption` (letters and digits, NFKD, lower case,
first `CAPTION_MATCH_CHARS`), on the caption **up to its first TeX span**, because the transcriber
writes maths as `\(\alpha\)` and the page prints α. A marker that passes every other rule but fails this one is refused
with a new word, `caption-not-in-page-text`, and the picture goes to `unclaimed`.

Measured on every local PDF article with figures (`captioncheck.ts` in the session scratchpad,
reproducible from the local database):

| document | figures | caption printed on the claimed page |
| --- | --- | --- |
| analog-cognition (8 stored today) | 8 | 8 of 8 |
| entropy-24-00930 (4 stored today) | 4 | 4 of 4 |
| the rebuilt Olah essay (2 stored today, both wrong) | 4 | 0 of 4 |

The same three documents were then run through `collectPdfFigures` itself, with the markers and
captions from their published blocks (`collect-real.ts` in the scratchpad): 8 of 8 and 4 of 4
stored, and 0 of 4 on the essay, where the two former swaps are now `caption-not-in-page-text`.

**The claim is deliberately narrow** (GPT Sol, plan review): this blocks the reproduced swaps and
lost none of the 12 correct figures measured here. Twelve figures from two papers is not a
population, and the substring test has known ways to miss a caption that is visibly printed: text
runs stored out of reading order, a caption set as outlines, a caption the transcriber tidied. Each
of those costs a figure rather than showing a wrong one. It also does **not** close the class. A
page that prints the caption *and* holds an unrelated picture, while the real figure is on the next
page, still pairs wrongly, because nothing records where on the page a picture is painted. Stage 2
is what would close that.

For the reader, the two swapped figures change from a wrong picture to the existing caption-only
line. `PDF_FIGURE_RECOVERY_POLICY` goes to `pdf-figures/4`, so an article stored under `3` reads
stale rather than current. Nothing re-runs on its own.

The drawn route needs no change: `locateDrawnFigure` already refuses a caption it cannot find on
the page (`caption-not-found`).

**The simpler option passed over:** telling the transcriber that a figure's `page` is the page its
picture is drawn on. That is a one-line prompt change, but it needs a `pdf-v5` bump and it is still
the model's unverified claim. A different page break would bring the same swap back, with nothing
to catch it. The check above holds whatever the model says; a prompt change can be added on top,
but it cannot replace the check.

## Stage 2: recovering these figures, a decision for Greg (not built)

Stage 1 makes the essay honest, but it leaves all four figures caption-only. Recovering them
needs something that looks at the page. The spike tried Greg's suggestion: render the claimed page
and its neighbours with PDFium, ask a model for the page and box of "the figure with this caption",
and crop that box with PDFium.

**Where it runs: Vercel, with nothing new.** PDFium compiled to WebAssembly (`@embedpdf/pdfium`)
has been in the Vercel bundle since
[260912a](260912a-figure-2-vector-figures-from-a-pdf.md). It is what draws vector figures today,
and it rendered every page and crop in this spike. So neither the browser nor a Supabase Edge
Function is needed.

Model research (a Sonnet subagent, 2026-09-24): Gemini's `box_2d` convention (`[ymin, xmin, ymax,
xmax]`, 0–1000) is the documented, purpose-trained one; Qwen3-VL is strong but its coordinates live in a
resized frame; Claude resizes images before answering in pixels; GPT's grounding is reported weak.

Spike results. Each call sends the claimed page and its neighbours at 1131 × 1600 px:

| model (OpenRouter) | "Local Code" (claimed p1) | "Semi-Distributed" (claimed p5, two pictures on p6) | time | cost per figure |
| --- | --- | --- | --- | --- |
| `google/gemini-3-flash-preview` | p2, tight and correct | p6, the right one of the two, tight | ~2 s | $0.0013–0.0018 |
| `openai/gpt-5.6-luna` | p2, same box as Gemini ±1% | p6, same | 4–6 s | not reported (tokens 4.5k–6.7k in) |
| `anthropic/claude-sonnet-5` | p2, box far too tall (took the prose too) | not run | 3 s | $0.010 |
| `google/gemini-2.5-pro` | p2, box with x and y swapped | not run | 20 s | $0.024 |
| `qwen/qwen3-vl-235b-a22b-instruct` | p2, box with x and y swapped | not run | 1.6 s | $0.0010 |

Two things the spike showed that a design would have to respect:

- **An embedded picture should be taken whole, not re-rendered.** Chrome's print had clipped
  these wide figures at the page edge, so the crop matched the printed page, while the embedded
  PNG is the whole figure. So for a page with images, the box would only *choose* which embedded
  image, by overlap, and the bitmap route would store it as it does now. Rendering the box is only
  for figures drawn with vector paths.
- **The model's answer is still a claim, and overlap alone is not a check of it** (GPT Sol, plan
  review, finding 5): a model that picks the wrong one of two pictures still overlaps one. A build
  would first have to record, for each image paint, its box, transform, clip and mask. Neither
  `RasterCandidate` nor `PageLayout` carries any of that today. Then it would require the model's
  box to *cover* one paint and no other, and take the embedded image whole only when it is painted
  once, unclipped and unmasked. Otherwise it would render the region, or refuse. On a vector page,
  the existing strict-read and render-containment checks still apply. Where the caption is inside
  the picture, as here, the model reading that title back is real corroboration.
- **Two calls are not a budget.** Before building, the spike should be rerun properly: repeated
  calls, negative controls (a caption that is on none of the pages), clipped and multi-image pages,
  with the raw responses kept. The x/y swaps from Gemini 2.5 Pro and Qwen may be a prompt problem
  rather than a localisation one.

The shape proposed, if Greg says yes: the model is asked about markers the deterministic
routes refused (`caption-not-in-page-text`, `ambiguous`, `no-raster` or `not-located`), so a paper whose
figures already work costs nothing. (Asking it about *every* pairing as well would close the
residual case above, at about $0.002 per figure on every PDF.) It uses Gemini 3 Flash through the gateway
([ai-gateway.md](../project/ai-gateway.md)), and it is its own step or sub-step, so it can be
re-run without re-buying the transcript.

## What Greg decides

1. **Build stage 2?** It adds a paid call per unrecovered figure (≈ $0.002 each, only on figures
   that fail today) and a new model dependency in the assets step. **Recommendation: yes, Gemini 3
   Flash, after the proper spike above and with paint boxes recorded so its answer can be checked.**
   A sub-question: ask about refused figures only (cheapest), or about every figure (closes the
   residual case, ≈ $0.002 × figures on every PDF import).
2. **Re-process his production article?** After stage 1 deploys, re-running `assets` on it
   would change two figures from the wrong picture to caption-only and leave the other two as they
   are. After stage 2 it would recover all four. It does not re-buy the transcript, and the block
   ids are unchanged. It writes a new revision of his article, so it is his call.
