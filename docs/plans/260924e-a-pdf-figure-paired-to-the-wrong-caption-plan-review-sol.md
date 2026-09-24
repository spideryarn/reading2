The central claim does not hold as written. The check blocks the reproduced Olah swaps and lost 0 of the 12 locally measured correct figures, but it neither proves zero regression nor closes the general wrong-picture hole.

1. **P1 — The 60-character substring check has known false negatives, and the evidence is too small for “breaks no correct figure.”**

   Evidence: the claim rests on 8 + 4 correctly stored local figures, with no production access ([plan:57](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/docs/plans/260924e-a-pdf-figure-paired-to-the-wrong-caption.md:57>)). The implementation flattens pdf.js runs in content-stream order ([pdf-figure-read.ts:382](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/src/pdf-figure-read.ts:382>)), then keeps only ASCII letters/digits ([pdf-figure-region.ts:652](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/src/pdf-figure-region.ts:652>)) and demands an exact 60-character normalized substring ([pdf-figures.ts:737](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/src/pdf-figures.ts:737>)). Meanwhile the transcriber writes mathematics as LaTeX ([pdf-read.ts:410](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/src/pdf-read.ts:410>)).

   Spaces, punctuation, dashes, end-line hyphens and Latin ligatures are handled. Simple `x_i` often survives too. But `\alpha`, `\frac{x}{y}`, `\mathbb{R}`, reordered text runs, “Fig.” versus “Figure”, outlined glyphs, rasterized captions and empty captions can all fail despite the caption being visible. The loss is therefore **observed 0/12; population loss unknown**.

   Concrete fix: do not merely shorten the needle—“Figure 2” alone admits body references. Match a unique line-start figure label plus several non-mathematical caption words, using geometrically reconstructed lines and alternative normalization that removes or canonicalizes TeX spans. Run that matcher over every available production PDF before claiming zero regression.

2. **P1 — Caption presence on the page still does not establish that the raster belongs to it.**

   Evidence: after counting one marker and one usable raster, the implementation asks only whether the page-wide flattened text contains the caption, then pairs that raster ([pdf-figures.ts:703](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/src/pdf-figures.ts:703>)). It has no raster position.

   Thus the proposed example remains possible: page P prints a caption at its foot, its actual figure is on P+1, and page P contains one unrelated bitmap. Another case is a vector figure plus an unrelated logo/photo on the caption page: the bitmap wins and the drawn route is never tried. Stage 2 would not repair these because it is proposed only for already-refused markers ([plan:116](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/docs/plans/260924e-a-pdf-figure-paired-to-the-wrong-caption.md:116>)).

   Concrete fix: capture each image paint occurrence’s box and require a defensible spatial relationship to the located caption, or send apparently successful pairings through the visual verifier too. If that is deliberately deferred, describe Stage 1 as an Olah-specific safeguard, not closure of the wrong-picture class.

3. **P1 — `PDF_FIGURE_RECOVERY_POLICY` must be bumped.**

   Evidence: its contract explicitly says to bump whenever the PDF half decides differently for the same markers ([collect-assets.ts:414](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/src/collect-assets.ts:414>)); it remains `pdf-figures/3` ([collect-assets.ts:426](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/src/collect-assets.ts:426>)). The policy is included only for articles with PDF markers, and a changed hash marks them stale without automatically running anything ([collect-assets.ts:495](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/src/collect-assets.ts:495>)).

   Concrete fix: bump to `/4` and add the same selective-invalidation test used for earlier policy changes. On rerun, corroborated figures should deduplicate back to the same blobs; captions affected by the false-negative cases above will change from `stored` to `failed`. Audit before a bulk production rerun. Stage 2 would warrant another bump unless shipped together.

4. **P1 — The new reason is plumbed correctly, but `caption-not-on-page` overstates what was proved.**

   Evidence: the current worktree adds it to both unions ([pdf-figures.ts:621](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/src/pdf-figures.ts:621>), [assets.ts:221](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/src/assets.ts:221>)) and to the exhaustive seam ([collect-pdf-figures.ts:782](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/src/collect-pdf-figures.ts:782>)). But failure means “the chosen normalized substring was not recovered from pdf.js text,” not necessarily “the caption is not on the page.”

   The reader-facing component ignores the reason and collapses every failed entry to the same sentence ([PdfFigureNote.tsx:149](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/src/web/PdfFigureNote.tsx:149>)), so it needs no behavior change. Export writes the manifest verbatim ([export-bundle.ts:450](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/src/store/export-bundle.ts:450>)); the public DTO also exposes this bounded reason, making the spelling externally visible.

   Concrete fix: use `caption-not-corroborated` or `caption-not-in-text-layer`, in both unions and the mapping. Update [article-images.md:225](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/docs/project/article-images.md:225>) and its freshness section. No export or reader rendering branch is otherwise required; no existing test appears to pin the allowed reason values.

5. **P1 — Stage 2’s overlap check is not independent verification, and “take the embedded image whole” is unsafe generally.**

   Evidence: the proposal treats overlap with exactly one embedded image as verification ([plan:105](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/docs/plans/260924e-a-pdf-figure-paired-to-the-wrong-caption.md:105>)). A model choosing the wrong one of two images still passes that test. Moreover, `RasterCandidate` has no paint transform or box ([pdf-figure-read.ts:454](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/src/pdf-figure-read.ts:454>)); `PageLayout` records only the number of image operations ([pdf-figure-region.ts:92](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/src/pdf-figure-region.ts:92>)). The existing reader already warns that decoded XObject bytes need not equal rendered appearance under clipping, masks or blending ([pdf-figure-read.ts:104](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/src/pdf-figure-read.ts:104>)).

   Concrete fix: record per-paint key, transform, visible/clipped box and mask state; define coverage/containment rather than “any overlap.” Take the raw image whole only when it is painted once without clipping/masking and the selected box covers that paint. Otherwise render the verified region or refuse. Where the caption/title is inside the image, OCR/text agreement would be real corroboration. Vector boxes should also retain the existing strict-read and render-containment checks, not merely “ink and no prose.”

6. **P2 — The spike supports feasibility, not the model choice or reliability claim.**

   Evidence: Gemini/Luna were tested on two positive examples; the other models on only one, apparently one run each ([plan:95](</home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/docs/plans/260924e-a-pdf-figure-paired-to-the-wrong-caption.md:95>)). The x/y-swapped results may indicate prompt/schema or coordinate-conversion mistakes rather than localization quality. There are no negative controls, repeated runs, clipped/masked images, multi-image assemblies, outlined captions or figures more than one page away.

   Concrete fix: preserve raw responses and evaluate repeated runs over correct, ambiguous and “not present” cases; report false-attachment and refusal rates, p50/p95 latency, and cost including retries. The quoted Gemini cost has no obvious arithmetic red flag, but two calls cannot establish a dependable per-figure budget.

So: **ship only with a narrower claim**—“this blocks the reproduced Olah swaps and regressed none of 12 locally measured correct figures.” I would not ship the broader safety claim until findings 1–3 are resolved.