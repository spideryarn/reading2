/**
 * **How much of itself the bottom bar can afford to spell out**, measured
 * rather than guessed.
 *
 * The bar drops its labels when the row will not fit — see Dock.tsx and
 * styles.css § the bar's fit ladder. It used to decide that at a pixel
 * breakpoint (`@media (max-width: 1100px)`), and that number was measured once,
 * when there were six modes. There are thirteen. The row now wants **1416px**
 * with every label spelled out, so between 1101px and 1416px the bar showed its
 * labels *and* ran off the right-hand end of the window — which is where Greg
 * found it, at two thirds of a laptop screen, 2026-09-02:
 *
 * > the bottom bar isn't compacting … I think this is a problem now because we
 * > keep adding new modes … Can we set it up to be more automatic/dynamic (so
 * > that we don't have to keep tweaking some constant)?
 *
 * So the constant is gone. The bar asks the browser whether it overflows, and
 * steps down the ladder until it does not. Mode fourteen moves the threshold by
 * itself and nobody has to notice.
 *
 * ## The one measurement, and why it is the only honest one
 *
 * `el.scrollWidth > el.clientWidth`. Nothing else, and in particular **no
 * slack term** — `scrollWidth` is clamped to at least `clientWidth`, so
 * `scrollWidth > clientWidth - 8` is *always* true and a bar written that way
 * compacts to its smallest rung at every width. That is not a hypothetical: it
 * was the first version of this file.
 *
 * The same clamp is why we cannot ask "how much room is left" and why the
 * ladder is walked from the top down rather than solved arithmetically. A rung
 * that fits reports exactly `scrollWidth === clientWidth`, which says nothing
 * about the room to spare, so the only question the DOM will answer is the
 * yes/no one — asked once per rung.
 *
 * Two consequences worth knowing:
 *
 *  - **The bar's trailing gutter had to stop being padding.** Chrome leaves
 *    `padding-right` out of a flex container's scrollable overflow (measured,
 *    2026-09-02: content ending at 1416px in a bar with 6.4px of right padding
 *    reports `scrollWidth` 1416, not 1422.4), so a gutter spelled that way is
 *    invisible here and the last button sits in it. On a laptop that is six
 *    pixels and cosmetic. On a phone held landscape the same padding carries
 *    `--safe-right`, and the button ends up in the cutout — which GPT Sol
 *    pointed out was the part I had waved through as cosmetic. It is a real
 *    child now (`.dock-tail`), so the measurement counts it.
 *  - **`flex-grow` does not fool it.** On a coarse pointer the buttons grow to
 *    share the bar (styles.css § a coarse pointer), so a fitting row fills its
 *    content box exactly. A "needed width" computed from `scrollWidth` would
 *    then read as full and compact a tablet that has room to spare; the
 *    overflow question does not care, because growth only happens when there
 *    was slack.
 *
 * GPT Sol proposed measuring the last button's right edge against the bar's
 * content edge instead, which does see the room to spare and would defend that
 * gutter. It was turned down for one reason: seeing the room to spare is
 * exactly what `flex-grow` destroys, so that version needs a second
 * measurement-only class to zero the growth before it can read anything — two
 * more moving parts to buy back six pixels of padding.
 *
 * ## Why not a container query
 *
 * `container-type: inline-size` on the bar would move the same constant from
 * the viewport's width to the bar's, which on a bar spanning `100vw` is the
 * same number. It answers where the constant is written down, not that there is
 * one. The thing that keeps going stale is the *content* side of the
 * comparison, and CSS cannot see that.
 */

import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { onFontsChanged } from "./fonts.js";

/**
 * The rungs, widest first, as the class each one puts on `.dock`.
 *
 * Rung 0 is the bar spelled out and carries no class. Each rung below it is
 * strictly narrower than the one above — that is what makes walking the list
 * top-down and stopping at the first fit correct — and each is exactly what a
 * media query used to do:
 *
 *  - `dock-fit-1`: the modes lose their labels (all but `keepLabel`), and close
 *    up to 0.6rem. The old `max-width: 1100px` rule. Measured need: ~808px.
 *  - `dock-fit-2`: *every* button loses its label and closes to 0.45rem. What
 *    § a narrow window did at 731px. Measured need: ~551px.
 *
 * Past the last rung the row simply overflows, and § a narrow window makes it
 * scroll rather than clip — the floor under this ladder, and deliberately so:
 * fifteen buttons cannot share a phone in portrait at a pressable size, and
 * Greg chose scrolling over shrinking further (styles.css § a coarse pointer).
 *
 * A new rung goes here and gets a rule in styles.css. Nothing else changes.
 */
export const DOCK_FIT_CLASSES = ["", "dock-fit-1", "dock-fit-2"] as const;

/** Every class this module owns, so `applyDockFit` can clear the others. */
const ALL = DOCK_FIT_CLASSES.filter((c) => c !== "");

/** Put one rung on the element and take the rest off. */
function applyDockFit(el: HTMLElement, level: number): void {
  const want = DOCK_FIT_CLASSES[level] ?? "";
  for (const c of ALL) el.classList.toggle(c, c === want);
}

/**
 * The narrowest rung the bar needs, left applied to `el` when this returns.
 *
 * Walks from rung 0 down, applying each and asking the browser. Up to three
 * forced reflows on a seventeen-element row, and only when something changed.
 *
 * `current` is returned unchanged when the element has no layout at all
 * (`clientWidth` 0 — detached, `display: none`, or jsdom, which has no layout
 * engine). Measuring a zero-width box would otherwise answer "nothing fits" and
 * strip every label off a bar nobody is looking at.
 */
export function chooseDockFit(el: HTMLElement, current: number): number {
  if (el.clientWidth === 0) return current;
  const last = DOCK_FIT_CLASSES.length - 1;
  for (let level = 0; level < last; level++) {
    applyDockFit(el, level);
    /* No slack, and no arithmetic. See the header: `scrollWidth` is clamped to
       `clientWidth`, so this is the only comparison that means anything. */
    if (el.scrollWidth <= el.clientWidth) return level;
  }
  applyDockFit(el, last);
  return last;
}

/**
 * The hook the bar uses: a ref for its root, and the class to render with.
 *
 * **The class is written twice, and that is not a bug.** `chooseDockFit`
 * mutates `classList` because it has to — each rung must be on the element
 * before the next reflow can be read — and the returned `fitClass` puts the
 * same value in React's `className` so a re-render for any other reason does
 * not throw the measurement away.
 *
 * ## When it re-measures
 *
 *  - **When `content` changes.** The bar's width is not a function of the
 *    window alone: it has a different button set on the metadata page, the
 *    Comments button is a drawer trigger there and a link here, and its count
 *    grows a digit. `content` is a string the caller builds out of exactly
 *    those things — **if a future change makes the row wider without changing
 *    that string, this is the line to add it to.** A dependency-free layout
 *    effect was tried first and rejected: `Dock` re-renders with its page, so
 *    it would force three reflows on renders that cannot have changed the row.
 *  - **On resize**, via a `ResizeObserver` on the bar itself. The bar is
 *    `width: 100vw`, so this is a window-resize listener that also catches a
 *    scrollbar appearing and browser zoom. It cannot feed back on itself: a
 *    rung changes what is *inside* the bar and never the bar's own width. The
 *    callback is coalesced through `requestAnimationFrame` for the reason
 *    Spine.tsx and DiagramPanel.tsx both give — a `ResizeObserver` fires
 *    *during* layout, and writing style from it synchronously is how you get
 *    "loop completed with undelivered notifications".
 *
 *    **It observes the bar and the trailing gutter, and never the buttons.**
 *    Observing the buttons would catch every content change and would also
 *    never stop: probing a rung changes their widths, which fires the observer,
 *    which probes again. `.dock-tail` has neither problem — it is `rem`-sized
 *    and rung-independent, so it moves when the text metrics move (a reader
 *    changing their browser's default font size, which changes no viewport and
 *    would otherwise leave the bar on a stale rung) and never when a rung is
 *    applied.
 *
 *    It is still not a general backstop for content: a row that gets wider
 *    without moving `rem` or the window has only `content` to notice it.
 *    Measured, 2026-09-02 — pushing a three-digit count into the bar by hand,
 *    bypassing React, leaves 26px of overflow until something else re-measures.
 *    What makes that survivable rather than a second silent clip is the floor:
 *    `.dock` scrolls at every width now (styles.css § the floor under the fit
 *    ladder), so the worst case is a row you can drag rather than buttons that
 *    are not there.
 *  - **When the fonts land.** Labels first measured in a fallback face are
 *    remeasured in the real one; without this the bar can settle a rung too
 *    narrow (or too wide) for the first paint and stay there.
 *  - **On `window.resize`**, but only where there is no `ResizeObserver` to do
 *    it better.
 */
export function useDockFit(content: string): {
  ref: RefObject<HTMLDivElement | null>;
  fitClass: string;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [level, setLevel] = useState(0);
  /* The DOM's truth, readable synchronously. `level` is the same number one
     render behind, and the measurement must not wait for a render to know
     where it currently stands. */
  const applied = useRef(0);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = chooseDockFit(el, applied.current);
    if (next === applied.current) return;
    applied.current = next;
    setLevel(next);
  }, []);

  /* Before paint, so the bar is never seen at the wrong rung.

     `content` is a re-run trigger, not a value the effect reads — the same
     arrangement, and the same warning, as Spine.tsx's `layoutKey`. Biome sees
     it unused in the body and its autofix DELETES it from the deps, which stops
     the bar re-measuring when its button set changes. Don't apply it. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger
  useLayoutEffect(measure, [measure, content]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const soon = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(soon);
    ro?.observe(el);
    /* And the trailing gutter, which is `rem`-sized and rung-independent — the
       one box in the bar that changes when the text metrics change and never
       when a rung does. See § when it re-measures. */
    const tail = el.querySelector(".dock-tail");
    if (tail) ro?.observe(tail);
    if (!ro) window.addEventListener("resize", soon);
    /* The `loadingdone` event rather than `fonts.ready`, which is expensive to
       read on a long article (fonts.ts). **This call site was never the hot
       one** — the effect depends on a `useCallback(…, [])`, so it runs once,
       and the cost measured on 2026-09-05 was all in Spine's copy. Changed for
       consistency and because the event also catches font batches that start
       after this runs, which the one-shot promise did not.
       `fonts.ts` handles the engines that have no `document.fonts` at all. */
    const offFonts = onFontsChanged(soon);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      offFonts();
      if (!ro) window.removeEventListener("resize", soon);
    };
  }, [measure]);

  const cls = DOCK_FIT_CLASSES[level] ?? "";
  return { ref, fitClass: cls ? ` ${cls}` : "" };
}
