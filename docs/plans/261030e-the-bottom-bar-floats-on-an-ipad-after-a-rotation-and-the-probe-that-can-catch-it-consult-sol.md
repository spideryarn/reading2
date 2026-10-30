The strongest candidate is not the old width overflow. It is the keyboard-plus-resize/rotation family, especially WebKit bug 218983: after focusing and dismissing a keyboard in landscape, rotating leaves `visualViewport.height` stale and a `position:fixed; bottom:0` footer partway up. That is almost the reported sequence.

1. Plausible states

- Shrink-to-fit scale below 1 remains possible. `WebPage::dynamicViewportSizeUpdate` performs synchronous layout and calls `shrinkToFitContent`; `ViewportConfiguration::initialScaleFromSize` computes a width-fitting scale. A Stage Manager resize is not named in the source, but it changes the WKWebView bounds, so it is a reasonable inference that it uses the same dynamic-resize machinery. [WebPageIOS.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/WebProcess/WebPage/ios/WebPageIOS.mm), [ViewportConfiguration.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/ViewportConfiguration.cpp).

  I found no likely remaining width source in this reported state. The spine, band, dock and dialogs are fixed and should not widen document overflow. `.reader` now contains ordinary/absolute/sticky overflow. Body-level Floating UI/Radix portals are the residual audit gap because they are outside `.reader`, but Search merely focusing its input does not open one, and their widths are generally viewport-capped.

- Keyboard followed by rotation/resize is the best match. [Bug 218983](https://bugs.webkit.org/show_bug.cgi?id=218983) explicitly reports a bottom-fixed footer moving up after keyboard dismissal plus landscape→portrait rotation. [Bug 297779](https://bugs.webkit.org/show_bug.cgi?id=297779) reports a persistent 24px `visualViewport.offsetTop` after keyboard dismissal and fixed elements moving with subsequent scrolls. `interactive-widget=resizes-content` does not protect Safari because [bug 259770](https://bugs.webkit.org/show_bug.cgi?id=259770) remains the implementation gap.

- A stale fixed-position layout viewport is credible. `RenderView::clientLogicalHeightForFixedPosition()` uses `FrameView::layoutViewportRect()` when visual viewports are enabled. WebKit has previously allowed that rect and CSSOM geometry to diverge during dynamic resize—[bug 171140](https://bugs.webkit.org/show_bug.cgi?id=171140), fixed—and current [bug 218983](https://bugs.webkit.org/show_bug.cgi?id=218983) demonstrates a related persistent height failure. [RenderView.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderView.cpp).

- A deliberate pinch carried through rotation should show `scale > 1`; by itself it does not explain a positive bottom gap. It can, however, combine with resize bugs. Ignore gap arithmetic whenever scale is materially different from 1: [bug 257375](https://bugs.webkit.org/show_bug.cgi?id=257375) shows WebKit mixing bounding-rect and visual-viewport coordinates under a scaled, panned viewport.

- iOS 26 browser chrome is another possibility. In [bug 297779, comment 23](https://bugs.webkit.org/show_bug.cgi?id=297779#c23), WebKit says `bottom:0` is intentionally kept above the floating browser controls. Separately, [bug 312149](https://bugs.webkit.org/show_bug.cgi?id=312149) reports intermittent fixed-bottom painting/geometry disagreement after toolbar motion.

2. Expected JavaScript signatures

These are expected signatures; buggy states are inherently less deterministic.

| State | `visualViewport` | `innerHeight` / `clientHeight` | fixed sentinel |
|---|---|---|---|
| Normal, settled | scale 1, offsetTop 0 | approximately equal | bottom approximately visible bottom |
| Shrink-to-fit | scale < 1, usually offsetTop 0; height grows in page CSS pixels | iOS `innerHeight` generally follows the visible rect; `clientHeight` remains layout height | bottom near `clientHeight`; positive gap |
| Keyboard currently up | scale 1; smaller height, often positive offsetTop | layout height remains larger | usually below the visible bottom, so gap is negative and clamping correctly does nothing |
| Stale pan after dismissal | scale 1; offsetTop may remain positive | often otherwise restored | may produce a positive gap, as in bug 297779 |
| Stale height | scale 1; height or layout height remains old | either number may be stale | exact relationship distinguishes which cache is stale |
| Pinch | scale > 1, reduced height, panned offsets | coordinate spaces differ | gap formula must be ignored |

The gap is useful evidence, not a reliable universal detector. Bug 218983 says `visualViewport.height` itself can be wrong. Bug 254861 reports fixed content visually correct while hit testing remains offset. Bug 312149 initially reports correct CSSOM while painting elsewhere. Therefore WebKit can diverge at layout, compositing, or hit testing.

3. Fix recommendation

Do not use the viewport-meta zoom reset. WebKit’s source shows viewport constraints being recomputed and scales clamped; it does not promise that dynamically writing `maximum-scale=1` resets the current page scale or that restoring the attribute restores prior user intent. Modern iOS also deliberately overrides author zoom restrictions for accessibility. There is no reliable exposed bit distinguishing automatic shrink from a user pinch.

If a device trace confirms a stable, measurable scale-1 gap, re-anchoring is the less dangerous workaround. Give it a separate root property; do not overload `--dock-bottom`, which means occupied height. Apply the physical offset consistently to the dock, band, spine and other bottom-fixed chrome. It still will not repair misaligned hit testing.

4. Smallest blind shipment

Ship only a stronger probe, not behavioral repair.

Add:

- An untransformed, pointerless `position:fixed; bottom:0` sentinel and its rect.
- `documentElement.clientHeight`, scroll dimensions and rect; body rect; scrolling-element position.
- `visualViewport.pageTop/pageLeft` as well as offsets.
- Dock computed transform and transition state.
- Samples at event time, next two animation frames, then 100/300/1000ms; [bug 237851](https://bugs.webkit.org/show_bug.cgi?id=237851) shows viewport values correcting only after a delay.
- Touch/gesture start/end and maximum touch count, so a scale change can be associated with a pinch.
- `elementFromPoint()` over the visibly painted dock, to expose hit-test disagreement.
- Display mode and viewport-meta content.

Ask Greg for the trace plus a screenshot while the gap is visible. The trace distinguishes scale, stale pan and stale height; the screenshot is essential because JavaScript cannot reliably detect compositor-only displacement.