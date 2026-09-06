/**
 * Whether to tell this reader that the window is too small for what they came
 * for, and remembering that they have been told.
 *
 * **The thing being explained is deliberate, not broken.** Past a crossover the
 * layout stops squeezing the article to make room for the mode band and lets
 * the band cover it instead — `bandCoversProse` in src/web/layout.ts, and
 * styles.css § a band with no room. On a laptop that crossover is never
 * reached; on a phone it is where the reader lives, and they meet it as *the
 * text disappeared*. Greg, 2026-09-05:
 *
 * > it's really designed for larger screens. It's possible to use it, but it
 * > can really only show either the mode panel or the text … You could also try
 * > it in Landscape, and this is a work in progress.
 *
 * docs/plans/260905e-a-small-screen-banner-on-a-phone.md.
 *
 * ## Why the conditions live here rather than in the component
 *
 * `install-hint.ts`'s reason, and it is the same shape as that file on purpose:
 * the facts are about the machine, `localStorage` needs guarding at every
 * touch, and a guard is only testable where it can be called on its own.
 * `tests/small-screen-hint.test.ts` writes down the machines it means.
 */
import { media } from "./media.js";

/** The three facts, as a value a test can write down. */
export interface SmallScreenEnvironment {
  /**
   * **Is the layout actually in the state the banner describes?**
   *
   * `bandCoversProse` in src/web/layout.ts, asked with the window width and the
   * rail's real state — not a width compared against a number copied to here.
   * The banner explains one specific layout decision, and a banner that
   * described the *old* decision, or one that fired twelve pixels away from
   * where the layout actually gives way, would be worse than none.
   *
   * Taking it as an argument rather than measuring is also what makes this
   * reactive for free: `App.tsx` computes it from `useWindowWidth`, which
   * already re-measures on `resize` and `orientationchange`.
   */
  bandCovers: boolean;
  /** A finger, rather than a mouse or a trackpad. */
  coarsePointer: boolean;
  /** Dismissed on this device, once, forever. */
  dismissed: boolean;
}

/**
 * All three, and the one that carries the weight is `coarsePointer`.
 *
 * A laptop window dragged narrow hits the same layout, and is emphatically not
 * who this is for: the fix there is the corner of the window, the reader knows
 * it, and a banner explaining their own drag to them is noise. A finger has no
 * such move.
 */
export function shouldWarnSmallScreen(env: SmallScreenEnvironment): boolean {
  return env.bandCovers && env.coarsePointer && !env.dismissed;
}

/**
 * **Is there a landscape to turn to?**
 *
 * Told to rotate the phone while already holding it sideways, a reader learns
 * we are not looking — so the sentence is dropped rather than the advice being
 * hedged. Compares the viewport's two sides rather than asking
 * `(orientation: portrait)` because the question is *which way is wider*, and a
 * square-ish window (a split-screen iPad, a desktop browser resized) should get
 * the sentence only when turning would actually help.
 *
 * Ties count as no: equal sides means rotating buys nothing.
 */
export function moreRoomSideways(viewport: { width: number; height: number }): boolean {
  return viewport.height > viewport.width;
}

const KEY = "spya.smallScreenHint.dismissed";

/**
 * Has it been dismissed here before?
 *
 * Wrapped for the three reasons `install-hint.ts` gives: Safari's private mode
 * throws outright, site data may be blocked, and under vitest with jsdom
 * `localStorage` is shadowed by Node's own global and reads `undefined`, so an
 * unguarded `.getItem` is a `TypeError` in the suite rather than in a browser.
 *
 * `false` for "cannot tell", which here means the banner comes back on the next
 * visit — one press, against a reader who never gets the explanation at all.
 */
export function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Never again on this device. */
export function rememberDismissed(): void {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    /* See `wasDismissed`. It will simply come back on the next visit. */
  }
}

/**
 * The two facts that are settled when the reader arrives, asked once.
 *
 * **The split from `bandCovers` is the whole reason this returns two fields
 * rather than three.** Whether the band covers the article changes while the
 * page is open — that is what the landscape sentence is *for* — so it comes
 * from the render, live. These two are settled in practice: the only thing that
 * dismisses the banner is the × on it, which the component already knows about,
 * and `(pointer: coarse)` describes the machine's *primary* pointer, which does
 * not ordinarily change mid-visit. Asking them in render instead would put a
 * `localStorage` read and a `matchMedia` call on every scroll frame for an
 * answer that has not moved.
 *
 * **"Settled in practice" is not "cannot move", and the two edges are worth
 * naming rather than papering over.** A hybrid device's primary pointer can
 * change under it — someone plugs in a mouse — and a dismissal in another open
 * tab is invisible here until this one reloads. Both leave the banner one tap
 * from gone, which is why neither earns a subscription. GPT Sol, 2026-09-05.
 */
export function readMachine(): Omit<SmallScreenEnvironment, "bandCovers"> {
  return {
    coarsePointer: media("(pointer: coarse)"),
    dismissed: wasDismissed(),
  };
}
