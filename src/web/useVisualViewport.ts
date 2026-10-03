/**
 * **Where the reader can actually see, with the soft keyboard up.**
 *
 * There are two viewports on a phone. The **layout** viewport is what CSS is
 * about: `dvh`, percentages, and where `position: fixed` puts things. The
 * **visual** viewport is the part of it the screen is showing right now, and the
 * on-screen keyboard eats into that one.
 *
 * `interactive-widget=resizes-content` on the viewport meta (index.html) asks
 * the browser to shrink the *layout* viewport too, which would make `dvh` and
 * `fixed` correct for free. **Chromium honours it. WebKit does not reliably** —
 * the implementation bug is open (bugs.webkit.org/show_bug.cgi?id=259770), and
 * what iOS does instead is pan the visual viewport over a layout viewport that
 * is still full height. So a dialog sized in `dvh` and pinned with `fixed` goes
 * on believing it has a whole screen, and its Send button stays under the keys —
 * which is the report this exists to answer (docs/project/feedback.md).
 *
 * `window.visualViewport` is the one thing both engines agree on. This hook
 * reads it and hands back the numbers a dialog needs to place itself inside what
 * the reader can see:
 *
 *  - `height` — how tall the visible strip is.
 *  - `offsetTop` — how far down the layout viewport that strip starts, which is
 *    what a *top*-anchored element has to add.
 *  - `bottomInset` — how much of the layout viewport is hidden below the strip,
 *    which is what a *bottom*-anchored element has to add. Almost always the
 *    keyboard.
 *
 * **`null` means do not interfere**, and that is the whole fallback: no
 * `visualViewport` (jsdom, an old browser), or the caller is not on screen. The
 * CSS then stands exactly as it did, which on Chromium is already right.
 *
 * The listeners live only while `active`, so a shut dialog costs nothing and a
 * dialog that unmounts leaves nothing behind. Both events matter and they are
 * different: `resize` is the keyboard appearing, going, or the phone rotating;
 * `scroll` is iOS *panning* the visual viewport, which changes `offsetTop`
 * without changing anything's size.
 */
import { useEffect, useState, type CSSProperties } from "react";

export interface VisibleViewport {
  /** The height of the part the reader can see, in CSS pixels. */
  readonly height: number;
  /** How far down the layout viewport that part begins. */
  readonly offsetTop: number;
  /** How much of the layout viewport is hidden below it — the keyboard, usually. */
  readonly bottomInset: number;
}

function read(): VisibleViewport | null {
  if (typeof window === "undefined") return null;
  const vv = window.visualViewport;
  if (!vv) return null;
  return {
    height: vv.height,
    offsetTop: vv.offsetTop,
    /* Clamped at zero: pinch-zooming out can make the visible box *taller* than
       the layout viewport, and a negative inset would push a bottom-anchored
       dialog off the bottom of the screen to solve a problem nobody had. */
    bottomInset: Math.max(0, window.innerHeight - vv.height - vv.offsetTop),
  };
}

const same = (a: VisibleViewport | null, b: VisibleViewport | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.height === b.height &&
    a.offsetTop === b.offsetTop &&
    a.bottomInset === b.bottomInset);

/**
 * **`--kb-inset` for a dialog pinned to the bottom of the screen.**
 *
 * The three floating panels — `.cmt-dialog`, `.chat-dialog` and
 * `.annotate-dialog` — sit a fixed distance above the bottom bar, and
 * `position: fixed` means the bottom of the *layout* viewport, which on iOS is
 * underneath the keyboard. The stylesheet adds this custom property into both
 * the `bottom` offset and the `max-height`, so one number moves the box up and
 * shortens it by the same amount.
 *
 * `undefined` where there is no `visualViewport`, and the `var(--kb-inset, 0px)`
 * fallbacks in the stylesheet then leave the geometry exactly as it was.
 *
 * The cast is how a custom property reaches React's `style`, and it is the same
 * one ContextList, MicLevel and DiagramPanel already make — kept here so the
 * three callers do not each make it.
 */
export function keyboardInsetStyle(visible: VisibleViewport | null): CSSProperties | undefined {
  if (visible === null) return undefined;
  return { "--kb-inset": `${visible.bottomInset}px` } as CSSProperties;
}

export function useVisualViewport(active: boolean): VisibleViewport | null {
  const [box, setBox] = useState<VisibleViewport | null>(null);

  useEffect(() => {
    if (!active) {
      /* Not merely "stop listening": a dialog that closes with the keyboard up
         and opens again on a desk would otherwise be placed from numbers taken
         in another world. */
      setBox(null);
      return;
    }
    const vv = typeof window === "undefined" ? undefined : window.visualViewport;
    if (!vv) return;

    /* The comparison is not an optimisation. iOS fires `scroll` continuously
       while the keyboard slides up, and a fresh object each time is a re-render
       each time, on the frames a phone has least to spare. */
    const update = () => setBox((was) => (same(was, read()) ? was : read()));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active]);

  return box;
}

/**
 * How much of the layout viewport has to be covered before it is a keyboard.
 *
 * An iPad with a hardware keyboard attached still draws a shortcut strip of
 * about 55px; the smallest soft keyboard, an iPhone's in landscape, is past 160.
 */
const SOFT_KEYBOARD_MIN_PX = 120;

/**
 * **Is an on-screen keyboard covering the page right now?**
 *
 * The same sum as `bottomInset` above, with two differences. `offsetTop` is
 * left out: iOS pans the visual viewport once the keyboard is up, and the
 * question here is how much is covered, not where a dialog should sit. And the
 * height is multiplied back by `scale`, because a pinch-zoom makes the visible
 * box shorter in CSS pixels with no keyboard anywhere.
 *
 * **`false` wherever it cannot tell**, and that is the safe direction: no
 * `visualViewport`, or a browser that shrinks the *layout* viewport for the
 * keyboard instead (Chromium, under `interactive-widget=resizes-content` in
 * index.html — so Android Chrome answers `false` with its keyboard up, and
 * `putKeyboardAway` does nothing there, which is how it behaved before).
 */
export function softKeyboardIsUp(): boolean {
  if (typeof window === "undefined") return false;
  const vv = window.visualViewport;
  if (!vv) return false;
  return window.innerHeight - vv.height * (vv.scale || 1) > SOFT_KEYBOARD_MIN_PX;
}

/**
 * **A box whose Enter has done its thing lets go of the keyboard.**
 *
 * Greg, from an iPad, 2026-10-03 (spya-gmtt4b): *"what I end up doing is
 * pressing the carriage return button, and then sometimes I can actually press
 * the sort of keyboard hide button because the keyboard doesn't disappear."*
 * The message has gone, the answer is arriving underneath the keys, and there
 * is nothing left to type.
 *
 * **Only a soft keyboard.** At a desk, and on an iPad with a hardware keyboard,
 * the caret stays where it was: blurring there would cost a click back into the
 * box for every message. `(any-pointer: coarse)` cannot tell those apart; the
 * visual viewport can.
 *
 * Call it once the send or the search has actually happened, never on a press
 * that was refused. The rule and the list of boxes are
 * docs/project/touch.md § What the Enter key promises.
 */
export function putKeyboardAway(el: HTMLElement | null | undefined): void {
  if (el && softKeyboardIsUp()) el.blur();
}
