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

## Stage 2: recovering these figures, as proposed on 2026-09-24

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

### Greg's answers, 2026-09-28

> For now let's just do it for figures that fail.

> Yes, if you can reprocess the Olah article that would be great. If not, I can do it myself.

So stage 2 is built, only for figures the deterministic routes refuse, and there is no check of
figures we already recover. The re-run is his: this box has no production credentials, and the
steps are in the session's debrief.

## Stage 2 as built: a model locates a refused figure

### The test run first

Before building, the rule as first designed was run (`locate-spike.ts` in the session
scratchpad). It used our own raster reader for where each picture is painted, PDFium for the
page renders, and the JSON-schema prompt below. Its acceptance rule was the **coverage half**
only — rules 3 and 4 below and the paint count — not the clip, background, assembly or
identity rules added after review. There were 10 cases and 3 runs each on
`google/gemini-3-flash-preview`. The retained raw file holds only the last re-run of the three
ball-lightning cases, which overwrote the rest (GPT Sol, finding 3), so the final rule was run
again end to end with fresh responses kept, under § The final run.

| case | right | correctly refused | **wrong** | missed |
| --- | --- | --- | --- | --- |
| essay, four figures, each filed one page early (two on pages with two pictures) | 12 | 0 | 0 | 0 |
| ball-lightning paper, Figure 1 filed one page early; Figure 2 on its page | 6 | 0 | 0 | 0 |
| analog-cognition, Figure 2 | 3 | 0 | 0 | 0 |
| negative: a caption from no document, on the essay | 0 | 3 | 0 | 0 |
| negative: the essay's caption, on the ball-lightning paper | 0 | 3 | 0 | 0 |
| negative: a vector figure, on a page with no picture | 0 | 3 | 0 | 0 |

That is 30 calls: 21 right, 9 refused correctly, **none wrong**. Each call took a median of about
1.8 s (the slowest 2.8 s) and cost $0.0013–0.0019. It sends three page images of about
1,100 × 1,600 px.

Two things changed the design:

- **The first acceptance rule was wrong.** It required the box to cover at least 70% of a picture,
  and the model habitually boxes only the chart part of a diagram that has a text panel beside
  it, covering 57–73% of the picture. Since the stored thing is the whole embedded picture, the
  question is *which* picture the model points at, not how much of it. So the rule is: the box
  lies almost entirely inside one picture and touches no other.
- **Cropped pages.** The ball-lightning paper's pages start at (8.5, 8.5), not (0, 0), and PDFium
  renders the cropped area. The first run sent the model no images at all for those cases. The
  render now uses the page's own width and height, and the box is mapped back with the offset
  added.

### Who is asked

A marker goes to the locator only when all of these hold:

- after both existing routes its refusal is `caption-not-in-page-text`, `ambiguous`,
  `no-raster` or `not-located`. That list is a recall limit, not a principle: `too-complex` and
  `render-failed` describe the claimed page, not its neighbours (GPT Sol, finding 8, P2, left
  for later);
- it has a caption;
- a window of the claimed page and its neighbours holds a usable picture that the other routes
  did not already give to a figure.

Windows are read one at a time, in page order, and let go (at most `MAX_LOCATE_LOOKS`, 24).
There are at most `MAX_LOCATE_CALLS` (8) calls per article, all inside the existing
`PDF_FIGURES_BUDGET_MS` clock. A held refusal is written only once the route has finished with
the figure, and if the clock runs out first the figure keeps its own reason, not `out-of-time`.

The call sends the window's pages, each rendered whole by PDFium at its own crop, plus the caption.
It asks for `{page, box_2d}` or nulls under a strict JSON schema, as job `pdf-figure-locate`
through `openRouterJson`, so it is metered like every other call.

### The acceptance rule as built — `judgeLocatedBox`

1. the answer has the shape asked for, on a page we sent, with a box in range;
2. every image on that page is one we can place, meaning no inline image, mask or repeat
   (`unmeasured-image`);
3. at least 80% of the box lies inside one visible usable picture, and the box covers at least 30%
   of it;
4. no other visible image holds 5% of the box, blank overlays alone excepted;
5. the picture is painted once, and no soft mask, blend or zero alpha is in force
   (`unmeasured-image`);
6. it shows less than 80% of the page (`background`), and no other picture is within 12 pt of it
   (`assembly`);
7. its clip is exact and cuts it only within 36 pt of the page edge (`clipped`);
8. no other figure has it, compared by a hash of the decoded picture, not by pdf.js's key
   (`already-taken`). Two located markers choosing one picture are both refused.

### GPT Sol's review of this stage, and what was done

Review: `260924e-…-stage2-plan-review-sol.md`. No P0.

| # | finding | done |
| --- | --- | --- |
| 1 | a tight box around the **wrong** picture passes every rule | **Accepted as the residual risk, and said so.** No geometric rule can tell a right answer from a wrong one; refusing every page with two pictures would lose two of the essay's four figures. Rules 4 and 6 refuse the layouts where a wrong answer is likeliest to look right. The source header and `article-images.md` state the limit. |
| 2 | one panel of a composite, and a page background, pass | **Fixed:** `assembly` (another picture within 12 pt) and `background` (over 80% of the page). |
| 3 | the clip rule refused the essay's own figures; the spike did not exercise the final rule | **Fixed and measured.** Chrome clips each printed page to its print frame, 10 pt inside the right edge and, on page 6, far above the foot. The rule is now *cut only within 36 pt of the page edge*. The final rule was then run end to end with the real model (below). |
| 4 | repeat, inline and mask images are not placed; masks are not attached to images; `clip: null` counted as shown | **Fixed:** any such image on the page refuses it; `appearanceExact` is carried per image; an empty clip is invisible. |
| 5 | "taken" compared by pdf.js key | **Fixed:** by a hash of the decoded picture. |
| 6 | the coordinate frame needs a real seam test | **Done:** a generated PDF with a CropBox inside a larger MediaBox, a non-zero origin and `UserUnit 2`. The locator finds the red picture in the render it was given, and the figure is stored only if every frame agrees. Mutating the offset out of the mapping turns it red. |
| 7 | the eight-call cap bounded neither reading nor memory | **Fixed:** one window at a time, `MAX_LOCATE_LOOKS`, and nothing retained but the chosen pictures. Measured below. |
| 8 | the refusal whitelist loses some recoverable figures | Left as a documented recall limit. |
| 9 | the policy was still `/4`; no invalidation test | **Fixed:** `pdf-figures/5`, and `tests/collect-assets.test.ts` pins the PDF stamp and the web stamp. |

### The final run: the real model, the final rule, real PDFs

`final-run.ts` in the session scratchpad. It calls `collectPdfFigures` itself, with
`openRouterFigureLocator`, and keeps the raw answers:

| document | markers | stored | located | model calls | time |
| --- | --- | --- | --- | --- | --- |
| the rebuilt essay, real markers | 4 | **4** (was 0 after stage 1, and 2 wrong before it) | 4 | 4 | 13.9 s |
| analog-cognition, real markers | 8 | 8 | 0 | **0** | 1.8 s |
| entropy-24-00930, real markers | 4 | 4 | 0 | **0** | 1.1 s |
| ball-lightning: Figure 1 filed a page early, Figure 2 on its page, the essay's caption planted on page 4 | 3 | 2 | 1 | 2 | 8.7 s |

Every stored picture is the right one. The essay's four come back at 1566 × 672, 484, 372 and 412
px, the sizes of the pictures on pages 2, 3, 4 and 6. The planted caption drew a "none" from the
model. Calls took 1.8–2.4 s; the requests were 0.5–2.4 MB of page images. Peak process memory was
the same with the locator on as off (632 MB against 666 MB for this whole script), and PDFium's
heap went from 19 MB to 50 MB. It never shrinks, which is well inside a Vercel function.

### Deliberately not in v1

- **Vector figures.** A box on a page with no picture is refused.
- **A picture cropped inside the page**, **rotated pages**, and pages further than one from the
  claimed page.
- **Recording in the manifest that a model chose the picture.** The step's log line counts
  `figuresLocated` and `figuresLocateCalls`; the stored entry looks like any other.

The cost is at most 8 × ~$0.002 per article, and nothing for an article whose figures all pair.
The locator is a *preview* model: if OpenRouter retires the id, every call fails and those figures
stay caption-only, which is the state they were already in.

The privacy page's list of models now names `gemini-3-flash-preview` and says what it is shown,
because `tests/privacy-page.test.ts` requires every model a reader's content can reach to be
listed there.
