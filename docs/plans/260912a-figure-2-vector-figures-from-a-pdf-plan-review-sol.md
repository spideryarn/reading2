The plan should not be built as written. Three findings are established P1s: the crop rule can assign the wrong drawing, the fallback bypasses existing raster safety refusals, and existing articles will remain falsely fresh.

I reviewed commit `ad65edb2`, ignoring subsequent working-tree edits to the plan. No files were changed.

## Findings

**F1 — P1 — established: the ownership rule can attach another drawing to the caption.**

The proposed overlap refusal does not establish the claim that “one marker produces one raster.” Counterexamples whose predicates succeed:

- Two side-by-side figures, followed by two stacked full-width captions. The first caption’s band contains both drawings; the second caption becomes the ceiling for itself and may find no ink. The inferred regions therefore do not overlap, so the stated refusal never fires.
- One figure plus a vector watermark, page border, boxed equation, sidebar diagram, or publisher ornament in the same vertical band. With one caption, the overlap check is impossible; unioning all “ink” captures both.
- A narrow caption below a wider multi-panel figure. Restricting to the caption column returns only part of the figure.
- A full-width caption below one column of a two-column page. The caption column is effectively the page, so neighboring-column graphics qualify.

Moreover, `constructPath` is not synonymous with visible figure ink: paths can be clipping geometry, white/invisible fills, backgrounds, and furniture. The supplied target fixture itself has 1,382 operators, 59 path operations, and two duplicate full-width header rules. “Trim furniture” does not provide an ownership proof.

This violates the prior plan’s deliberate rule that a wrong picture is worse than a missing one ([prior plan](/home/greg/code/spideryarn2/.claude/worktrees/fb31-figure-2-image/docs/plans/260906a-figures-from-a-pdf-are-placeholders-with-no-image.md:417)).

**Change:** Restrict v1 to exactly one figure marker on the page and one exclusive drawing component immediately above it. Refuse full-page paths, substantial disconnected components, watermarks/furniture, and any layout with more than one plausible component. Add adversarial fixtures matching the layouts above. Do not ship the general multi-caption band matcher.

---

**F2 — P1 — established: “zero usable rasters” bypasses the reasons existing raster recovery refused.**

`readPdfPageRasters` does not mean “the page contains no raster.” It omits or refuses:

- images removed by pdf.js’s `maxImageSize`;
- inline images;
- repeated image operators;
- unsupported image kinds;
- images whose decoded dimensions or pixel counts are unsafe.

Those cases can currently end as `no-raster` ([reader](/home/greg/code/spideryarn2/.claude/worktrees/fb31-figure-2-image/src/pdf-figure-read.ts:26)). Sending the page to PDFium asks a second decoder to process exactly the image that the first path declined, potentially bypassing `MAX_FIGURE_PIXELS`. A small output crop does not bound the work required to decode a huge compressed image, mask, pattern, font, or shading.

**Change:** Distinguish “no image operators of any kind” from “image present but unusable.” Only the former may enter the vector route. Preserve every current raster refusal, and impose independent PDFium input/render limits.

---

**F3 — P1 — reasoned: operator count and a timer do not bound synchronous PDFium work.**

The timeout callback cannot run while a synchronous WASM render occupies the event loop. Operator count is not a work bound: one operator may trigger a large image decode, complex shading, font processing, recursion, or decompression. WASM protects JS memory integrity, but it does not isolate CPU or process RSS.

**Change:** Put PDFium in a worker with a parent-controlled deadline and termination. If that is deferred, describe platform termination as the only hard time bound and do not present the operator guard as a security boundary.

---

**F4 — P1 — established: unchanged freshness makes the feature silently do nothing for existing articles.**

The new implementation changes the output for identical existing inputs from `failed:no-raster` to `stored`, while the plan deliberately changes neither `assetsInputHash` nor `ASSETS_VERSION`. The assets stage therefore accepts the old manifest as current and never invokes the new route ([hash](/home/greg/code/spideryarn2/.claude/worktrees/fb31-figure-2-image/src/collect-assets.ts:447), [stage stamp](/home/greg/code/spideryarn2/.claude/worktrees/fb31-figure-2-image/src/pipeline.ts:2774)).

A manually forced target run demonstrates the implementation, but it does not make the cache’s freshness claim true.

**Change:** Add a PDF-recovery-policy version to `assetsInputHash` only when PDF markers are present. Include the normalized caption used by the locator. That invalidates relevant PDF articles without refetching every ordinary web image.

---

**F5 — P1 — reasoned: the memory estimate omits lifecycle and worst-case peak memory.**

The raw PDFium interface requires explicit cleanup of documents, pages, bitmaps, and allocated buffers; the official examples use `try/finally` for that reason. The plan records a one-run RSS observation but does not specify ownership, cleanup on each failure path, singleton initialization, or concurrent calls. At the existing 50 MiB PDF limit, simultaneous JS, pdf.js, WASM input, render buffer, PNG encoder, and PDFium-internal allocations can be substantially higher than the reported 70 MiB.

[EmbedPDF’s initialization and cleanup documentation](https://www.embedpdf.com/docs/pdfium/getting-started) and [rendering example](https://www.embedpdf.com/docs/pdfium/examples/render-page-to-canvas) make those obligations explicit.

**Change:** Specify one cached initialization promise; `try/finally` destruction for every native handle and allocation; bounded concurrency; and repeated success, failure, and timeout tests that measure retained RSS/WASM heap.

---

**F6 — P1 — reasoned: the proposed bundle check can pass without proving the deployed function works.**

The current trace test checks `nodeFileTrace` output, not the artifact formed after `vercel.json` `includeFiles` processing ([trace test](/home/greg/code/spideryarn2/.claude/worktrees/fb31-figure-2-image/tests/pdf-bundle-trace.test.ts:90)). Thus the suggested fallback and the test disagree about what counts as shipped. A local runtime test also has the full `node_modules`, masking a missing deployed `.wasm`.

`includeFiles` is a single glob setting, and the existing `certs/**` inclusion must be preserved ([Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json), [local configuration](/home/greg/code/spideryarn2/.claude/worktrees/fb31-figure-2-image/vercel.json:19)). The package does expose `./pdfium.wasm`, which provides a stable path to target ([package manifest](https://github.com/embedpdf/embed-pdf-viewer/blob/v2/packages/pdfium/package.json)).

**Change:** Test the actual packaged artifact in an environment without the source `node_modules`, initialize PDFium, and render a known nonblank crop. Make one explicit bundling mechanism authoritative and preserve the certificate glob.

---

**F7 — P1 — reasoned: two coordinate engines create untested wrong-crop cases.**

The locator uses pdf.js coordinates while PDFium performs the crop. Rotation, non-zero CropBox/MediaBox origins, inherited transforms, nested form matrices, clipping, and stroke extents all cross that seam. The three ordinary pages do not establish correctness there.

Text lookup also needs to distinguish the caption from an earlier body reference beginning “Figure 2.” and tolerate captions split across text runs.

**Change:** Add fixtures for 90°/270° rotation, non-zero box origins, nested Form XObjects, split captions, and a preceding textual figure reference. Assert distinctive corner colours or labels, not merely “PNG is nonblank.”

---

**F8 — P2 — established: the security account treats reachability controls as defences and omits the new defence location.**

A figure marker is derived from attacker-controlled PDF content, so it restricts product scope but not adversarial reachability: a hostile PDF can print “Figure 1.” The zero-usable-raster condition is also not a defence because of F2.

None of the files currently listed under “Where the defences physically live” is directly changed. However, the new complexity/refusal code becomes a claimed defence, so its implementation and tests must be added to [security-map.md](/home/greg/code/spideryarn2/.claude/worktrees/fb31-figure-2-image/docs/project/security-map.md:77). Security documentation must describe PDFium as another hostile-document parser and distinguish WASM memory isolation from CPU/RSS availability isolation.

**Change:** Update both security documents, identify the actual hard boundaries, and verify rather than assume what filesystem imports the packaged build exposes.

---

**F9 — P2 — established: `render-failed` conflates a safety refusal with a renderer malfunction.**

Folding the complexity guard into `render-failed` prevents telemetry from answering whether PDFs are unsupported, deliberately refused, or failing unexpectedly. That is especially harmful while thresholds are being calibrated.

**Change:** Use at least `render-refused`/`too-complex` separately from `render-failed`; retain structured internal subreasons for location failures.

---

**F10 — P3 — established: the licence statement is inaccurate.**

The wrapper package is MIT, but its own documentation identifies the bundled PDFium binary as Apache-2.0, not simply BSD-3 ([EmbedPDF package documentation](https://github.com/embedpdf/embed-pdf-viewer/tree/v2/packages/pdfium)).

**Change:** Record the package and bundled-binary licences separately and check redistribution/notice requirements.

## Simpler version

Keep PDFium-in-WASM—it is a reasonable rasterizer and comfortably below Vercel’s 250 MiB uncompressed bundle limit ([Vercel limits](https://vercel.com/docs/functions/limitations))—but narrow the product promise:

1. Improve the placeholder when a page genuinely has no image operators.
2. Recover only pages with exactly one marker, zero image-like operators, and one conservative drawing component.
3. Run PDFium behind an interruptible worker boundary.
4. Defer multi-caption and mixed bitmap/vector pages until ownership can be demonstrated rather than inferred.

That likely recovers the target and many full-page academic vector figures while preserving the existing “missing is better than wrong” contract.

**do not proceed**