/**
 * The four safe-area insets, as numbers, for the two places that cannot do the
 * arithmetic in CSS.
 *
 * `index.html` carries `viewport-fit=cover`, so the document is laid out across
 * the whole physical screen and the notch, the home indicator and (in the
 * installed app) the status bar all overlap it. Almost everything answers that
 * in the stylesheet with `env(safe-area-inset-*)` — styles.css § safe areas —
 * and needs nothing from here. **Two things cannot:**
 *
 *  - `fitView` (layout.ts) divides up the window's width in pixels, and the
 *    insets are width it does not have. Without subtracting them the table is
 *    built to the full screen, `.reader`'s padding pushes it right, and the page
 *    scrolls sideways by exactly the notch. GPT Sol, reviewing the plan for
 *    docs/plans/260828av-mobile-screen-real-estate.md, 2026-08-28.
 *  - `stickyOffset` (scroll.ts) predicts where the controls bar's bottom edge
 *    will be once it is stuck, and that is now `--safe-top` lower than the bar
 *    is tall. Without this, every deep link and every arrow-key step in the
 *    installed app lands a status bar's height underneath the chrome it was
 *    supposed to clear.
 *
 * ## Why a probe rather than reading the custom property
 *
 * `getComputedStyle(root).getPropertyValue("--safe-top")` returns the *token
 * stream* — the literal text `env(safe-area-inset-top, 0px)` — because an
 * unregistered custom property is never substituted for the CSSOM. Registering
 * it with `@property` would fix that and cannot be done here: Vite's CSS
 * transform drops `@property` and bakes the `initial-value` into every
 * reference, which is the accident written up at length beside `--bar-bottom`
 * in styles.css § tokens.
 *
 * So the value is *measured*: one fixed, invisible element whose padding is the
 * four `env()`s, read back as resolved pixels. `getComputedStyle` returns
 * resolved values and padding resolves to used pixels, and `visibility: hidden`
 * still generates a box where `display: none` would not — so this reports what
 * the browser thinks the insets are.
 *
 * **Which is not the same as reporting the truth.** A probe cannot correct the
 * browser's own answer, and WebKit has an open report of safe-area values
 * coming back as zero when they should not
 * ([bug 274773](https://bugs.webkit.org/show_bug.cgi?id=274773)). Every
 * consumer therefore has to be correct at zero as well — which they are, because
 * zero is what every machine we develop on reports anyway. GPT Sol talked an
 * earlier version of this comment down from "a probe cannot be wrong".
 */

import { geometryCostOn, leafGeometryClock, noteGeometry } from "./geometry-cost.js";

/** Pixels of screen edge that are spoken for, on each side. */
export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

let probe: HTMLElement | null = null;

/**
 * The element we measure, made once and left in the document.
 *
 * `position: fixed` so its containing block is the viewport and nothing on the
 * page can move it; zero-sized, `pointer-events: none` and `aria-hidden` so it
 * is not a thing on the screen or in the accessibility tree; `visibility:
 * hidden` rather than `display: none`, because a `display: none` element has no
 * used values to read and the whole point is to read them.
 *
 * **It appends to the document, and one caller reaches it from a render.**
 * `useWindowWidth`'s lazy `useState` initialiser calls `safeAreaInsets()`, so
 * under Strict Mode's double render this runs twice — which `isConnected` makes
 * idempotent, but it is still a side effect in render and worth knowing about
 * rather than discovering. Moving it to an effect would mean the first layout
 * was computed from an unmeasured window, which is the worse trade: a
 * one-frame-wrong column count is visible and this is not.
 */
function ensureProbe(): HTMLElement {
  if (probe?.isConnected) return probe;
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "width:0",
    "height:0",
    "visibility:hidden",
    "pointer-events:none",
    "padding-top:env(safe-area-inset-top,0px)",
    "padding-right:env(safe-area-inset-right,0px)",
    "padding-bottom:env(safe-area-inset-bottom,0px)",
    "padding-left:env(safe-area-inset-left,0px)",
  ].join(";");
  document.body.appendChild(el);
  probe = el;
  return el;
}

/**
 * Parse one resolved length. `getComputedStyle` gives `"0px"` or `"47px"`; a
 * browser that has never heard of `env()` drops the declaration entirely and
 * gives `""`, which `parseFloat` turns into `NaN`.
 *
 * **`Number.isFinite`, not `|| 0`.** `NaN || 0` is 0 and so is `0 || 0`, so the
 * short form works — until someone changes a fallback and a `NaN` starts
 * meaning something. Say which case is which.
 */
function px(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Measure the insets now.
 *
 * **Not cached, and that is deliberate.** The values change on rotation, on a
 * window resize, and — in an ordinary Safari tab — when the browser's own
 * toolbar minimises, which happens *while the reader is scrolling*. A cache
 * would need invalidating on all three, and the failure when it missed one
 * would be a layout quietly built for the wrong screen. Both callers already
 * force a layout flush in the same breath, so the read is close to free.
 *
 * Sol's second pass pointed out that only `top` and the two horizontal insets
 * are actually consumed here, and those are the *stable* ones — so a cache
 * would in fact be safe, and the sentence above overstates the danger. It is
 * still not worth writing until somebody measures `stickyOffset` on a scroll
 * and finds this in the profile; performance.md is where that would go.
 *
 * Returns zeroes in any environment without a DOM to probe, which is every
 * test that has not built one.
 *
 * **Counted as a geometry leaf** (geometry-cost.ts), because the question above
 * — is this worth caching — is now a measurement rather than an argument, and
 * this is the site the answer is read off. One read per call: the four padding
 * values come off a single `getComputedStyle`, so one flush serves all four,
 * exactly as one `getBoundingClientRect` serves `top` and `bottom`. The early
 * return reads nothing and is counted as a call with zero reads, which is the
 * honest shape of a test environment with no body.
 */
export function safeAreaInsets(): SafeAreaInsets {
  const counting = geometryCostOn();
  const t0 = leafGeometryClock();
  const insets = measureInsets();
  if (counting) noteGeometry("safeAreaInsets", t0, insets === NO_INSETS ? 0 : 1);
  return insets;
}

/** The work, split out so a `return` added later cannot escape the measurement
 *  above — annotation-cost.ts makes the same move for the same reason, and it
 *  is a silent-success guard: an undercounting probe reports a small number,
 *  and a small number is the answer this job would most like to hear. */
function measureInsets(): SafeAreaInsets {
  if (typeof document === "undefined" || !document.body) return NO_INSETS;
  const style = window.getComputedStyle(ensureProbe());
  return {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft),
  };
}

/** The two that cost the layout width. */
export function horizontalInset(insets: SafeAreaInsets): number {
  return insets.left + insets.right;
}
