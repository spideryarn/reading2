/**
 * Whether to tell this reader that the window is too small for what they came
 * for, and remembering that they have been told.
 *
 * **The thing being explained is deliberate, not broken.** Past a crossover the
 * layout stops squeezing the article to make room for the mode band and lets
 * the band cover it instead — `bandCoversProse` in src/web/layout.ts, and
 * narrow-window.css § a band with no room. A narrow window can reach that
 * crossover on any device; on a portrait phone it is where the reader lives, and they meet it as *the
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

/* ------------------------------------------------------------ the shelf --- */

/**
 * **The shelf's banner asks about the device, not the layout**, and that is the
 * whole difference from the article's one above. That banner explains one
 * layout decision, so it asks the layout. This one says *a phone is not the
 * best screen for Spideryarn* — Greg, spya-fcbnhq, 2026-10-01 — which is a fact
 * about the machine, true held either way up.
 *
 * So: a finger, and a **screen** whose shorter side is under 600 CSS px. The
 * screen and not the window, so that a phone turned sideways is still a phone
 * and a laptop window dragged narrow never is (its pointer is fine anyway). The
 * shorter side, so that orientation does not matter. 600 because every phone is
 * well under it (an iPhone Pro Max is 440) and every iPad well over (a mini is
 * 744). docs/plans/261002b-include-public-chip-on-the-shelf-empty-shelf-help-and-a-phone-banner-on-the-shelf.md § Part C.
 */
export interface PhoneEnvironment {
  coarsePointer: boolean;
  screen: { width: number; height: number };
}

const PHONE_SHORT_SIDE = 600;

export function isPhone(env: PhoneEnvironment): boolean {
  const short = Math.min(env.screen.width, env.screen.height);
  /* A screen the browser would not measure (0, or `NaN`) is "cannot tell", and
     cannot tell is not a phone — otherwise every coarse pointer without a
     `screen` would qualify. GPT Sol, plan review, 2026-10-02. */
  if (!Number.isFinite(short) || short <= 0) return false;
  return env.coarsePointer && short < PHONE_SHORT_SIDE;
}

/**
 * **Until dismissed, on this device** — the article banner's contract (see
 * docs/project/touch.md § One banner, once for why not "the first time"), and
 * its own bit, so that dismissing one says nothing about the other: they say
 * different things.
 */
export function shouldShowShelfPhoneHint(env: PhoneEnvironment & { dismissed: boolean }): boolean {
  return isPhone(env) && !env.dismissed;
}

const SHELF_KEY = "spya.shelfPhoneHint.dismissed";

/** `wasDismissed`'s guard and its reason: "cannot tell" shows the banner. */
export function shelfPhoneHintDismissed(): boolean {
  try {
    return window.localStorage.getItem(SHELF_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberShelfPhoneHintDismissed(): void {
  try {
    window.localStorage.setItem(SHELF_KEY, "1");
  } catch {
    /* It will come back on the next visit. */
  }
}

/** Asked once, on arrival — `readMachine`'s reasoning. */
export function readPhone(): PhoneEnvironment & { dismissed: boolean } {
  return {
    coarsePointer: media("(pointer: coarse)"),
    screen: { width: window.screen?.width ?? 0, height: window.screen?.height ?? 0 },
    dismissed: shelfPhoneHintDismissed(),
  };
}
