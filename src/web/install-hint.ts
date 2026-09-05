/**
 * Whether to tell this reader that the app can leave the browser.
 *
 * **The one thing a web page cannot do is hide the browser's own chrome.** On
 * iOS the collapsed address strip in portrait and the vertical button strip in
 * landscape are Chrome's, and no CSS, no manifest and no scroll trick reaches
 * either of them. Add to Home Screen does: iOS then runs the page in a
 * standalone shell with no chrome at all, which is more screen than anything in
 * styles.css was ever going to win.
 *
 * That makes "install it" the actual answer to Greg's ask, and an answer only
 * reaches the reader who already knows it unless the app says so once. Greg,
 * 2026-08-28, choosing between saying nothing and this: *a one-time dismissible
 * hint on mobile.*
 *
 * docs/plans/260828av-mobile-screen-real-estate.md § 1.
 *
 * ## Why the conditions live here rather than in the component
 *
 * They are four separate facts about the machine, three of which have a
 * platform quirk in them, and none of which a component can be tested for.
 * `shouldOfferInstall` takes them all as arguments so a test can state the
 * machine it means; `readEnvironment` is the one place that asks the browser.
 *
 * **`media` used to live here** and moved to src/web/media.ts on 2026-09-05,
 * when `small-screen-hint.ts` wanted the identical question asked the identical
 * way. Nothing about it changed; its docstring still carries the jsdom accident
 * that is the reason it is guarded at all.
 */
import { media } from "./media.js";

/** The four facts, as a value a test can write down. */
export interface InstallEnvironment {
  /** A finger, rather than a mouse or a trackpad. */
  coarsePointer: boolean;
  /** An iPhone or an iPad — the only platform where this advice is the advice. */
  ios: boolean;
  /** Already launched from the Home Screen, in which case there is nothing to offer. */
  standalone: boolean;
  /** Dismissed on this device, once, forever. */
  dismissed: boolean;
}

/**
 * **All four, and the interesting one is `standalone`.**
 *
 * A reader who has already installed the app is the reader most likely to be
 * annoyed by being told to install it, and they are also the one this is
 * hardest to detect for — see `readEnvironment`. When in doubt the answer is
 * not to show it: a hint nobody needed is a strip of chrome over an article.
 */
export function shouldOfferInstall(env: InstallEnvironment): boolean {
  return env.coarsePointer && env.ios && !env.standalone && !env.dismissed;
}

const KEY = "spya.installHint.dismissed";

/**
 * What this machine looks like right now.
 *
 * Returns a value rather than a boolean so the caller can be tested against a
 * machine it names, and so the awkward detection below is in one place.
 *
 * **`matchMedia` is asked, not `navigator.platform`.** Platform sniffing for
 * "is this an iPad" has been wrong since iPadOS 13 started reporting itself as
 * a Mac; the useful half of the check is `maxTouchPoints`, which a real Mac
 * reports as 0. The user-agent test is still needed for the iPhone, which does
 * not lie but also does not expose anything better.
 *
 * **Two ways to be standalone, and both are needed.** `display-mode:
 * standalone` is the standard, and iOS has supported it since 16.4;
 * `navigator.standalone` is the non-standard property older iOS answers, and it
 * is the only witness on a device installed before that. Either one being true
 * settles it.
 *
 * **Neither of them answers the question we would rather ask.** Both report the
 * mode of *this window*, not whether the app is installed — so a reader who has
 * already added Spideryarn to their Home Screen and then opens it in an
 * ordinary Safari tab is offered the hint again. There is no fixing that from
 * here: Apple gives Home Screen web apps storage separate from the browser's, so
 * a dismissal inside the installed app cannot reach the tab. What we can do is
 * make the second offer cheap, which is what the one-tap × is for. GPT Sol,
 * second pass, 2026-08-28.
 */
export function readEnvironment(): InstallEnvironment {
  const ua = navigator.userAgent;
  const iPhone = /iPhone|iPod/.test(ua);
  // iPadOS 13+ says "Macintosh". A Mac has no touch points; an iPad has five.
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return {
    coarsePointer: media("(pointer: coarse)"),
    ios: iPhone || iPad,
    standalone:
      media("(display-mode: standalone)") ||
      // Non-standard, and typed as unknown rather than declared: it exists on
      // Safari and nowhere else, and declaring it on Navigator would let the
      // rest of the app reach for it without this comment.
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    dismissed: wasDismissed(),
  };
}

/**
 * Has it been dismissed here before?
 *
 * Wrapped, for the two reasons `mic-devices.ts` gives and one more: Safari's
 * private mode throws outright, site data may be blocked — and under vitest with
 * jsdom, `localStorage` is shadowed by Node's own global and reads `undefined`,
 * so an unguarded `.getItem` is a `TypeError` in the test suite rather than in
 * the browser. A hint is not worth taking a page down for in any of the three.
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
