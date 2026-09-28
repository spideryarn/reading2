You are reviewing stage 2 of a plan in the spideryarn2 repo. Read-only: do not edit files.

Read docs/plans/260924e-a-pdf-figure-paired-to-the-wrong-caption.md in full — especially "Stage 2 as built" at the end — and your own
reviews of stage 1 (docs/plans/260924e-a-pdf-figure-paired-to-the-wrong-caption-plan-review-sol.md and -code-review-sol.md). Greg has
approved building stage 2 for refused figures only.

The code it will sit on: src/collect-pdf-figures.ts (the sequence, `storeOne`, the drawn route, the clock and budget), src/pdf-figures.ts
(`pairPageFigures`, `classifyRaster`), src/pdf-figure-read.ts (`readPdfRasters`, which now also returns `paints` and `views`),
src/pdf-figure-paint.ts (`interpretOperators`, which now records `images: ImagePaint[]` with box, clip, clipExact — see the uncommitted diff),
src/pdf-figure-render.ts (`renderPdfRegion`), src/ai-call.ts (`openRouterJson`, `AI_JOB_ROUTE`), src/models.ts (`NonTaskAiJob`,
`NON_TASK_MODELS`), src/cost-categories.ts.

The test-run script is at /tmp/claude-1000/-home-greg-code-spideryarn2/29243f3c-f13e-4047-b0b1-4ca026d9b52f/scratchpad/locate-spike-for-review.ts
and its raw responses are in locate-spike-google_gemini_3_flash_preview.json beside it (the second run, with the revised rule, overwrote the first;
the first run's refusals under the 70%-cover rule are quoted in the plan).

The conclusion I would least like to be wrong about: **the six-part acceptance rule cannot attach a picture to the wrong caption unless the
model itself names the wrong figure — and when it does, the rule still refuses in the cases that matter (two pictures on the page, a picture
another figure has, a box straddling pictures).** Attack that. Specifically:

1. Is "at least 80% of the box inside one picture, that box covering at least 30% of it, and no other picture holding 5% of the box" sound?
   Name layouts where a wrong answer passes, e.g. a composite figure made of several separately painted images (panels a, b, c), a picture
   painted under a transparent overlay, tiled images, a picture that is a page-wide background.
2. The composite-figure case in particular: a figure made of four separately embedded panels would be refused (the box covers four pictures).
   Is refusing right for v1? Is there any way the rule picks ONE panel and stores it as the whole figure?
3. The mapping of box_2d to PDF points with a non-zero view origin, and PDFium rendering the crop box: is the frame consistent with
   `ImagePaint.box` (user space through the CTM)? What about pages whose MediaBox differs from their CropBox, or UserUnit?
4. The selection of which markers are asked: `caption-not-in-page-text`, `ambiguous`, `no-raster`, `not-located`. Any reason to include or
   exclude others? Should an `ambiguous` marker's own page's pictures, both unclaimed, be eligible?
5. Anything about cost, the clock (PDF_FIGURES_BUDGET_MS = 180 s; up to 8 calls of ~2 s plus renders), memory on Vercel (full-page PDFium renders
   at up to 1600 px on the long edge, sequential), and the policy bump to pdf-figures/5.
6. Test design: what must be red first, and what must be exercised against the real PDFs rather than fakes.

Numbered findings, each with a severity (P0 blocks building, P1 fix in this stage, P2 later), evidence, and a concrete fix.
