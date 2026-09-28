The central conclusion is not sound. The geometry rule rejects broad or straddling boxes, but it accepts a tight box around the wrong picture—including one panel of a composite. No P0, but I would resolve the P1s below before shipping. I made no edits.

1. **P1 — A tight box around the wrong one of two pictures passes every rule.**

   Evidence: [`judgeLocatedBox`](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-locate-0928/src/pdf-figure-locate.ts:140) only establishes which painted image contains the box. I exercised two disjoint, unclaimed, once-painted pictures: a tight box around the wrong one returned `{status: "chosen", key: "wrong"}`. Merely having two pictures on the page causes no refusal. Likewise, a box may straddle another picture by up to 4.999% and pass.

   Concrete fix: withdraw the claim that two-picture pages are structurally protected. If that guarantee is required, refuse pages with more than one unclaimed nonblank picture. If recovering the two Olah multi-picture cases matters more, explicitly accept model-semantic risk; a second independent model/run agreeing on the same picture can reduce it but cannot make the guarantee true. The new source header now acknowledges this residual risk, which is more accurate than the proposed conclusion.

2. **P1 — Composite refusal is right for v1, but the implementation can store one panel as the whole figure.**

   Evidence: a box enclosing four separately painted panels is refused, as intended. But a tight box around panel A satisfies 100% box-inside-panel, sufficient panel coverage, no intrusion, one paint, and a page-wide clip. I exercised that layout and the current judge chose panel A.

   A page-wide background also passes: a model box covering 64% of a sole full-page raster chose that background as the figure. OCR-backed scanned pages can evade the existing low-word-count scan rule.

   Concrete fix: for the conservative v1, make page-background rasters unselectable and refuse likely multi-image assemblies. The only geometry-only rule that fully guarantees against selecting one panel is refusing every multi-picture page; any looser grouping heuristic must be described as a risk reduction, not a proof.

3. **P1 — The retained spike did not exercise the six-part rule, and the final clip rule appears to reject the target Olah figures.**

   Evidence:

   - The spike’s “planned rule” checks usable candidates, 80%/30%/5% coverage, and paint count only ([scratch script](/tmp/claude-1000/-home-greg-code-spideryarn2/29243f3c-f13e-4047-b0b1-4ca026d9b52f/scratchpad/locate-spike-for-review.ts:101)). It does not check clips, unmatchable image paints, rotation, taken pictures, or cross-marker collisions.
   - The retained [raw JSON](/tmp/claude-1000/-home-greg-code-spideryarn2/29243f3c-f13e-4047-b0b1-4ca026d9b52f/scratchpad/locate-spike-google_gemini_3_flash_preview.json) contains 9 responses—three harder-paper cases—not the claimed 30.
   - On Olah page 2 I measured view `x=0…595.92`, paint `x=74.69…650.69`, but clip `x=9.75…585.75`. That clip is about 10 points narrower than the page, so the current 1-point clip tolerance ([judge](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-locate-0928/src/pdf-figure-locate.ts:162)) refuses it.

   Concrete fix: run the actual exported `judgeLocatedBox` over newly retained, uniquely named responses and the real paint data. Define “page-edge clipping” in terms of clip provenance or a deliberately justified printable-page frame; then prove all four Olah cases pass that exact rule. Do not describe the 30 calls as testing the final rule until they do.

4. **P1 — The paint inventory is not geometrically complete enough for rule 3.**

   Evidence: regular XObjects get a key and CTM box, but every repeat, inline group, and mask/group operator is recorded as one keyless unit-square paint at the current CTM ([handlers](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-locate-0928/src/pdf-figure-paint.ts:259)). `paintImageXObjectRepeat` actually represents several placements, while the raster reader explicitly calls it unread ([reader](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-locate-0928/src/pdf-figure-read.ts:371)). Tiled images can therefore fail to veto a wrong selection.

   Soft masks, alpha, and blend modes only increment page-level `unmeasuredPaint`; that uncertainty is not attached to the affected image. Also, `clip: null` means the image is completely clipped away, but the judge currently treats it as fully shown.

   Concrete fix: expand repeat/group arguments into one `ImagePaint` per placement; retain keys where available; carry an image-level `appearanceExact`/mask/blend verdict; and treat `clip: null` as invisible and therefore unselectable. Use the clip-adjusted visible rectangle for both winner and intruder coverage.

5. **P1 — “A picture another figure has” is checked only as `(page, pdf.js key)`.**

   Evidence: taken and duplicate choices compare page and key ([collector](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-locate-0928/src/collect-pdf-figures.ts:776), [collision check](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-locate-0928/src/collect-pdf-figures.ts:833)). The same global XObject painted on two pages, or identical bytes embedded under two keys, can therefore be attached to two captions.

   The implementation correctly refuses both markers when they choose the same page/key.

   Concrete fix: assign each validated raster a content identity—hash of kind, dimensions, and decoded bytes—and use that identity for deterministic claims, located conflicts, and already-taken checks.

6. **P1 — The nonrotated coordinate formula is consistent, but the full frame contract still needs a real seam test.**

   Evidence: the mapping correctly adds `view.x0`, flips y around `view.y1`, and compares against `ImagePaint.box` in the same unrotated PDF user space ([mapping](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-locate-0928/src/pdf-figure-locate.ts:121)). The harder paper demonstrates a nonzero crop origin, and rotations are now carried and excluded.

   `proxy.view` is the effective CropBox/MediaBox intersection. `UserUnit` should not be multiplied into content coordinates; it changes physical scale, not the user-space boxes. A synthetic in-memory page with nonzero CropBox and `UserUnit=2` retained those values through the pdf-lib cut and rendered successfully, but that evidence is not a test.

   Concrete fix: add a generated/committed PDF with differing MediaBox and CropBox, nonzero origin, `UserUnit=2`, one known image, and optionally rotation. Assert the model-image pixel, mapped box, paint box, and selected key agree end to end.

7. **P1 — The eight-call cap does not bound preprocessing or memory.**

   Evidence: before applying `MAX_LOCATE_CALLS`, the collector reads the claimed page and neighbours for every held marker ([collector](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-locate-0928/src/collect-pdf-figures.ts:754)). Up to 100 markers can therefore decode nearly 300 pages and retain all candidate buffers. The render cache then retains every encoded full-page PNG it encounters.

   This conflicts with the renderer’s existing measured warning that a full-page 2× render added about 70 MB RSS and was therefore avoided ([renderer](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-locate-0928/src/pdf-figure-render.ts:11)). The quoted 1.8 seconds measures only `fetch`; the spike starts its timer after cuts, PDFium renders, and PNG encoding.

   Concrete fix: process markers lazily in document order, with a sliding cache of at most three rendered pages, and stop opening new pages once eight calls have been attempted. Measure end-to-end p50/p95, peak RSS, request-body size, and PDFium heap on the Vercel bundle. The model-cost bound—at most about $0.015/article from the measured calls—is otherwise reasonable, and 180 seconds looks plausible but is not yet evidenced.

8. **P2 — The refusal whitelist unnecessarily loses recoverable neighbour-page figures.**

   Evidence: `LOCATABLE` includes only `caption-not-in-page-text`, `ambiguous`, `no-raster`, and `not-located` ([collector](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-locate-0928/src/collect-pdf-figures.ts:228)). `too-complex`, `render-failed`, and raster-specific refusals describe the claimed page; they do not prove that an unclaimed usable picture is absent from a neighbour.

   An `ambiguous` marker’s own-page pictures are correctly eligible under the current code, provided they are unclaimed. That is the right behavior, subject to findings 1–2.

   Concrete fix: later replace the reason whitelist with “failed before storage, captioned, and an unclaimed usable picture exists in the rendered neighbourhood,” while excluding storage, encode, budget, source, and timeout failures. If retaining the whitelist for v1, document it as a recall limit.

9. **P1 — Freshness and final evidence are incomplete.**

   Evidence: the plan says `/5`, but [`PDF_FIGURE_RECOVERY_POLICY`](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-locate-0928/src/collect-assets.ts:432) remains `pdf-figures/4`. The model job, route, cost disposition, logging, and privacy inventory are otherwise being wired through the appropriate exhaustive tables.

   Concrete fix: bump to `pdf-figures/5` and add the selective hash-invalidation test. Before calling the stage complete, retain the full model-eval corpus and run the final gate against it.

Red-first tests required in this stage:

- Tight wrong choice among two images; tight single panel; page-wide background.
- Completely clipped paint, local clip, blank overlay, soft mask/blend, repeat/group/tiled operators.
- Two choices for one content identity, including different keys/pages.
- Nonzero CropBox/MediaBox/UserUnit coordinate seam.
- Eight-call cap proving no ninth neighbourhood is decoded or rendered.
- Deadline during render, call, and storage; original refusal preserved.
- `/4 → /5` selective invalidation.

Real PDFs—not fakes—must cover Olah’s four figures through the final judge, the harder paper’s offset crop, a separately embedded composite, a repeated/tiled image, and clipped/masked appearance. Pure threshold boundaries, malformed responses, collision bookkeeping, call caps, and failure preservation belong in synthetic tests.