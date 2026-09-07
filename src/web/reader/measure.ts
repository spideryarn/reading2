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
 * difference on padding (styles.css § shell). Handing `fitView` the raw width
 * builds a table for a screen that is 47px wider than the one it has to fit in,
 * and the page then scrolls sideways by exactly the notch. Raised by GPT Sol
 * against the plan, 2026-08-28; see safe-area.ts for why this cannot be done in
 * CSS.
 *
 * `orientationchange` as well as `resize`, because the insets swap sides on
 * rotation and iOS has historically fired the two in either order.
 */
export function useWindowWidth(): number {
  const measure = () => window.innerWidth - horizontalInset(safeAreaInsets());
  const [w, setW] = useState(measure);
  useEffect(() => {
    const on = () => setW(measure());
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);
  return w;
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
  const measure = () => {
    const px = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    /* A browser that answers `""` or `0` gets the default rather than a table
       nought pixels wide — this is a multiplier, so a falsy answer is not a
       small error, it is the whole column. */
    return Number.isFinite(px) && px > 0 ? px : DEFAULT_ROOT_PX;
  };
  const [px, setPx] = useState(measure);
  useEffect(() => {
    const on = () => setPx(measure());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return px;
}
