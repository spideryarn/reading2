# Verdict: RETHINK

I could not write the review file: this session mounts the worktree read-only. Both patch attempts failed with `Read-only file system`; the designated [output file](/var/tmp/spideryarn-worktrees/ios-layout-after-rotation/docs/plans/261008b-ios-layout-and-zoom-plan-review-sol.md) remains empty.

1. **[P1 — blocking] The `.reader` cap is incomplete.** At steady state, `min-width: min(<px>, 100%)` is inert under the current `body > #root > .reader` structure. A `fitView()` sweep covering widths 100–2600px, roots 12/16/20px, every band shape, marginalia, and spine on/off found no legitimate oversize result.

   But for the reported 1194→834px Plain rotation, the stale fit is only `tableW=808`, `spineW=12`, `minWidth=820`. The old reader minimum already fits at 834px. The likely 1194px overflow is instead the stale `--page-w`, which keeps `.masthead`, `.controls`, and stuck crumbs extending to the old right edge.

   Other remaining overflow sources are:

   - The table and `<col>` retain inline pixel widths.
   - `--mode-w` retains fixed band width, reader padding, and bar offsets.
   - `--marg-reserve`, `--marg-left`, and `--marg-w` retain marginalia geometry, including out-of-flow elements.
   - `--table-w` is no longer consumed; the dock itself uses `left: 0; right: 0`.

   The minimal complete cap must constrain the reader, all `--page-w`-derived bars, and the actual table and `<col>`. Covering every mode additionally requires live bounds for mode and marginalia geometry.

2. **[P1 — blocking] The proposed test can pass vacuously.** An empty `.reader` with synthetic `min-width:1194px` tests the declaration, not the production failure. Use production-shaped markup containing the masthead, controls/crumbs, table and `<col>`, mode band, and—if claimed—marginalia. Populate it from an old real `fitView()`, narrow the viewport without updating those values, and assert element rectangles plus `documentElement.scrollWidth === clientWidth`.

   Include iPad Plain, Structure/Summary, iPhone covering-band geometry, Tweets, spine on/off, and marginalia if in scope. Add a negative control proving today’s uncapped fixture overflows. Do not rely on computed `min-width` serialization.

3. **[P1] Leave Stage 2 out pending a `?probe=1` trace.** There is no evidence that `scrollTo(scrollX, scrollY)` at the unchanged position repairs this WebKit state. One WebKit report’s workaround waits for `visualViewport.resize`, then a frame, and changes the root scroll position; another reports a state where even `scrollTo(0, 0)` is ineffective. [WebKit 254861](https://bugs.webkit.org/show_bug.cgi?id=254861), [WebKit 297779](https://bugs.webkit.org/show_bug.cgi?id=297779), [WebKit 311821](https://bugs.webkit.org/show_bug.cgi?id=311821).

   If later justified, trigger once on a confirmed keyboard-visible→hidden transition, after one animation frame, requiring `scale≈1` and `offsetTop>1`. Listen to both visual-viewport resize and scroll; do not depend on blur. Route it through `scroll.ts` bookkeeping. Test preservation of x/y, one call per cycle, all guard failures, cleanup, hide-on-scroll state, and arrival anchors.

4. **[P2] Document the cap’s dependency.** `100%` resolves against `#root`, not inherently against `documentElement.clientWidth`. It is safe because `#root` is currently unconstrained and the body has no padding, wrapper, or transform. The test should preserve that assumption explicitly.