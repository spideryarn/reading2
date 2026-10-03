The evidence supports a promising transform fix, but it does **not** establish the claimed whole-root-layer repaint. I found no established P0 or P1 in stage 1.

Reviewed against **40e232dc9**, excluding the concurrent implementation edits. Line references below use that candidate.

1. **F1 — P2, established: `layerId: 0` does not identify the root compositor layer.**  
   Evidence: `scripts/trace-scroll.ts:522–530`; `docs/plans/261003a-ipad-battery-scroll-repaint.md:22–25`. This Chrome version hardcodes Paint’s `layerId` to zero for compatibility, and its `clip` is a **cull rectangle**. A document-level Paint event can include tree walking and copying cached, unchanged content. Therefore, eleven viewports of cull rectangle do not mean eleven viewports were repainted or rasterized. [Chrome’s trace implementation](https://github.com/chromium/chromium/blob/152.0.7977.75/third_party/blink/renderer/core/inspector/inspector_trace_events.cc#L1022), [paint reporting implementation](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/paint/paint_layer_painter.cc#L50).

   **Change:** describe this as “frequent document-level paint lifecycle work associated with the spine.” Stop reporting summed cull rectangles as painted area. Capture actual layer identities, compositing reasons, and damage before claiming repaint isolation. Make promotion of the entire `.spine` conditional on evidence that it adds benefit beyond promoting the moving band.

2. **F2 — P2, established: the harness uses the wrong elapsed window, and touch pacing changes with load.**  
   Evidence: `scripts/trace-scroll.ts:443–449, 903–905`; `m-ipad-summary-1.txt:23,30,50`; `m-diag-ipad-summary-nospine.txt:24,31,49`. The first Summary gesture lasts **40.904 seconds**, but the analyser reports **57.977 seconds**. Inspecting the raw trace shows earlier asynchronous frame timestamps stretching the window; renderer-main events span approximately **41.615 seconds**. Also, each touch move waits for its CDP acknowledgement *after* sleeping, so the gesture takes 40.9–46.6 seconds with the spine and 29.4 seconds without it.

   **Change:** add explicit measurement boundaries and clip analysis to them. Report CPU seconds per measured scroll distance, gesture duration, and delivered scroll events separately. The absolute reduction remains credible: `/proc` independently gives approximately **32.1–32.9 main-thread CPU seconds versus 15.5**, over almost identical distances. This supports the diagnostic’s large effect in Chromium emulation, not an iPad battery percentage.

3. **F3 — P2, established: “inline style writes only” is not an exclusive classification.**  
   Evidence: `scripts/trace-scroll.ts:746–774`. `inline` wins even when `other` is also true; the classifier also mixes processes and threads. Reclassifying the raw Summary traces gives **462 exclusive inline intervals plus two mixed**, and **464 plus one mixed**, rather than 464/465 exclusive intervals. The inline nodes in those intervals are indeed `.spine-viewport`, which strengthens the narrower attribution.

   **Change:** filter to the target renderer/frame, retain node identities, and report mixed causes explicitly. Call this temporal association with **tracked style invalidations**, not proof that no other paint cause existed.

4. **F4 — P2, established: the containing-block explanation is wrong, although the current tooltip looks safe.**  
   Evidence: `docs/plans/261003a-ipad-battery-scroll-repaint.md:57–58`; `src/web/styles/spine.css:14,56`; `src/web/Tooltip.tsx:356`. `will-change: transform` **does** establish a containing block for fixed descendants, even when its element is already fixed. [CSS specification](https://www.w3.org/TR/css-will-change-1/#will-change).

   The existing spine tooltip is portalled to the body; the armed outline state controls those same tooltips. I found no fixed DOM descendant requiring viewport positioning inside the rail. `.spine` already has a stacking context through `z-index: 45`, so adding the hint does not newly trap its children beneath sibling chrome.

   **Change:** replace the false explanation with that concrete audit. Describe compositing as an expected optimization, not a guarantee: browsers may decline the hint, and WebKit explicitly has a conservative policy that can do so. [WebKit implementation](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderLayerCompositor.cpp#L3605). The plan is otherwise appropriately candid about the unmeasured device benefit; soften “the fix is right on both engines” accordingly.

5. **F5 — P2, established: the proposed test change would not verify the new geometry dependency.**  
   Evidence: `docs/plans/261003a-ipad-battery-scroll-repaint.md:61–63`; `tests/spine-scroll.test.ts:113–117,223–235`. The existing test checks only that the position string changes. Its ResizeObserver mock never delivers notifications. Replacing `top` with `transform` leaves incorrect scaling and stale resize placement largely unchecked.

   **Change:** assert exact translation with a nonzero `docTop` and known track height. Deliver track-only resize notifications without scrolling; cover initial placement, observer cleanup, and preservation across a boundary render. In the browser, check **during** the bar transition as well as after it. Keep the other spine elements’ percentage-`top` assertions unchanged.

6. **F6 — P2, reasoned: an observer-free transform option was overlooked.**  
   Evidence: `docs/plans/261003a-ipad-battery-scroll-repaint.md:99–103`; `src/web/Spine.tsx:1385–1389`; `src/web/styles/spine.css:352–360`. Rejecting percentage translation on the minimum-height band is correct. It does not rule out translating a **track-height wrapper** containing that band:

   - Wrapper: absolute, track height, pointer events disabled.
   - Wrapper translation: `(scrollY − docTop) / docHeight × 100%`.
   - Child: existing percentage height, borders, and 2px minimum.

   **Change:** briefly compare this with the pixel/observer version. It trades one wrapper for an observer lifecycle and automatically follows track resizing. I would try it first; the proposed pixel version is also correct if its observer supplies fractional height and applies changes before paint.

7. **F7 — P3, established: CSS hiding does not remove the spine’s React work.**  
   Evidence: `docs/plans/261003a-ipad-battery-scroll-repaint.md:28–29`; `scripts/trace-scroll.ts:1103–1108`; `src/web/Spine.tsx:678–726`. Injecting `display:none` leaves the component and its scroll effect mounted.

   **Change:** say the diagnostic removes visible layout/painting costs while retaining React execution. It remains an upper bound for the rendering optimization, but for a different reason.

Stage 2 is worth considering **after stage 1**, as proposed. The stylesheet-invalidation cost survives hiding the spine: roughly 2.3 seconds remains in that diagnostic. Its implementation must reconcile newly mounted **and retargeted** links, clear attributes when disabled, preserve `.mode-band` scoping and missing-link exclusions, and verify the cascade when moving the currently unlayered rule into a stylesheet. If that needs substantial observation machinery, defer it.

Deferring the bar-variable/`:has()` redesign and reading-position arithmetic is reasonable. Keep the existing bar transition; the new band transform needs no transition or reduced-motion animation. Add print-preview and return-to-screen checks for pixel placement, without expanding this into a print redesign.

**Verdict: proceed with changes.**