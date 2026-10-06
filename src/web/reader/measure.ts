/**
 * **The two measurements the reading view computes its layout from**: how wide
 * the window really is, and how big a rem is. Both are state rather than reads
 * taken once, because both move while the page is open.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, in the shape the mode
 * controllers established a day earlier: a unit with its own reason to change
 * moves into a file of its own, keeping its code byte-for-byte, so `App.tsx`
 * stops knowing what is inside it. See
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md.
 */

import { useEffect, useState } from "react";
import { horizontalInset, safeAreaInsets } from "../safe-area.js";
import { DEFAULT_ROOT_PX } from "../layout.js";

/**
 * The window width, as state, because the whole layout is computed from it.
 *
 * **`innerWidth` minus the notch, not `innerWidth`.** `index.html` carries
 * `viewport-fit=cover`, so on a notched phone in landscape the window is wider
 * than the part of it anything may be drawn in — and `.reader` spends the
 * difference on padding (shell.css § shell). Handing `fitView` the raw width
 * builds a table for a screen that is 47px wider than the one it has to fit in,
 * and the page then scrolls sideways by exactly the notch. Raised by GPT Sol
 * against the plan, 2026-08-28; see safe-area.ts for why this cannot be done in
 * CSS.
 *
 * `orientationchange` as well as `resize`, because the insets swap sides on
 * rotation and iOS has historically fired the two in either order.
 *
 * **And the page's width, not `innerWidth` itself** — `pageWidth` below says
 * why, and why that is not `layoutViewportWidth` either.
 *
 * **A `ResizeObserver` on the root as well**, because a classic scrollbar
 * arriving fires no `resize`: the article loads, the page grows taller than
 * the window, and 15px of the width goes to the scrollbar without the window
 * changing at all. The root's box is what shrinks, so the root is what is
 * watched. Since shell.css reserves the scrollbar's room (`scrollbar-gutter:
 * stable`) that no longer happens where the property is supported, and this
 * is the fallback for where it is not. **It could flip**, which an earlier
 * version of this comment denied: a narrower page is not always a taller one,
 * because Structure's band can switch from its columns to a narrower list and
 * hand space back to the prose (GPT Sol). So it is coalesced to one read a frame, as
 * dock-fit.ts's observer is, and the gutter is what actually stops the flip.
 */
export function useWindowWidth(): number {
  const [w, setW] = useState(usableWidth);
  useEffect(() => {
    const on = () => setW(usableWidth());
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    let frame = 0;
    const onRoot = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(on);
    };
    const root = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onRoot);
    root?.observe(document.documentElement);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
      root?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return w;
}

/**
 * **`useWindowWidth`'s one read, without the hook**: the page's width less the
 * notch. Named and exported for last-view.ts § the first-open default, which
 * decides once, on arrival, what the layout will have room for — and has to
 * ask with the layout's own number or the two disagree by a scrollbar or a
 * notch (GPT Sol, plan 261005a, F3).
 */
export function usableWidth(): number {
  return pageWidth() - horizontalInset(safeAreaInsets());
}

/**
 * **The width the reading view is laid out in: the root's `clientWidth`.**
 *
 * It was `layoutViewportWidth` until 2026-10-02, which is `innerWidth` on a
 * desktop, and on a desktop with a classic scrollbar — a Mac with a mouse
 * plugged in, or *Show scroll bars: Always* — that is 15px more than the page
 * has. `fitView` handed every pixel of it out, `.reader`'s `min-width` asked
 * for it, and every article with a band open scrolled sideways by exactly the
 * scrollbar. Greg, spya-y3747g;
 * docs/postmortems/261002a-the-reading-view-laid-out-for-the-width-under-the-scrollbar.md.
 *
 * **What this gives up is agreement with `@media (max-width)`, which counts
 * the scrollbar**, and that is why `layoutViewportWidth` chose `innerWidth`.
 * The disagreement is 15px wide and only beside a classic scrollbar, and the
 * reading view has one width query left (narrow-window.css § 731px), which
 * takes the words off the wordmark and the Feedback button — so a window 732
 * to 746px wide keeps its words while the layout is computed for 717 to 731.
 * A page that scrolls sideways at every width is the worse of the two.
 *
 * **The iOS zoom case is unchanged**, because there the root's `clientWidth`
 * *is* the layout viewport, which is what `layoutViewportWidth` picked anyway.
 *
 * jsdom lays nothing out and answers 0 for the root; `layoutViewportWidth` is
 * the stand-in there, and no browser gives a standards-mode root a width of 0.
 */
export function pageWidth(): number {
  const root = document.documentElement.clientWidth;
  return root > 0 ? root : layoutViewportWidth();
}

/**
 * **The width the stylesheet lays out in** — the layout viewport, which every
 * `@media (max-width)` and every `100vw` is measured against.
 *
 * **Not `innerWidth` alone, because on iOS that is the *visual* viewport.**
 * WebKit derives it from the unobscured content rect in page coordinates, so
 * at zoom ×1.5 it is two-thirds of the screen. A zoom survives a rotation and a
 * later zoom change fires no window `resize`, so a reader who rotated an iPad
 * while zoomed in was laid out for a window two-thirds the size of theirs until
 * something else resized it — Structure's one column on a landscape iPad,
 * SPIDERYARN-READING2-33/-34, and
 * docs/postmortems/260912b-a-layout-read-from-a-number-that-means-a-different-viewport-on-ios.md.
 *
 * **Not the root's `clientWidth` alone either**, because that excludes a
 * desktop's classic scrollbar and the media queries include it — 15px in which
 * layout.ts and narrow-window.css would disagree again. So the larger of the
 * two: in this standards-mode top-level document the root's `clientWidth` is
 * the layout viewport (CSSOM View's special case for the root), never inflated
 * by the root's own width or by overflow, so it only wins where `innerWidth`
 * has fallen below the layout — which on the browsers we support means iOS
 * zoomed in. Everywhere else the answer is exactly `innerWidth`, as it was.
 *
 * **No longer what the reading view lays out for**, since 2026-10-02 — that is
 * `pageWidth` above, because the scrollbar this counts is width the page does
 * not have. It stays as the answer to *where is the viewport's edge*, which is
 * the shelf's question (Library.tsx) and `pageWidth`'s jsdom stand-in.
 *
 * `tests/layout-viewport-width.test.tsx` fails on a raw `innerWidth` elsewhere in
 * `src/web`, and lists the files that want the browser's own answer.
 */
export function layoutViewportWidth(): number {
  return Math.max(window.innerWidth, document.documentElement.clientWidth);
}

/**
 * The root font size, in px, because one number in the layout is a measure of
 * type rather than of screen.
 *
 * `PROSE_ALONE_MAX_REM` is the width of 65 characters plus two rem paddings, and
 * a reader whose browser default is 20px has all three of those 25% wider than
 * this file would otherwise assume. Everything else `fitView` works in is a real
 * screen width and stays px — layout.ts § `FitInput.rootFontPx`.
 *
 * **Not read once at module scope.** Text-only zoom and a settings change both
 * move it while the page is open, and the same `resize` that already re-measures
 * the window is the cheapest thing that notices — browsers fire one for text
 * zoom. Nothing notices a change made in another tab's settings until the next
 * resize or reload, which is a smaller failure than pinning it at import time,
 * when a stylesheet may not even have loaded.
 */
export function useRootFontPx(): number {
  const [px, setPx] = useState(rootFontPx);
  useEffect(() => {
    const on = () => setPx(rootFontPx());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return px;
}

/** `useRootFontPx`'s one read, without the hook — for the caller `usableWidth`
 *  names, and for the same reason. */
export function rootFontPx(): number {
  const px = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  /* A browser that answers `""` or `0` gets the default rather than a table
     nought pixels wide — this is a multiplier, so a falsy answer is not a
     small error, it is the whole column. */
  return Number.isFinite(px) && px > 0 ? px : DEFAULT_ROOT_PX;
}
