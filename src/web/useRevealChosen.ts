/**
 * **Keep the chosen button of a sideways-scrolling row in view.**
 *
 * Two kinds of row scroll sideways inside themselves rather than wrap: a band's
 * order buttons on a touch screen (OrderGroup.tsx, plan 261001o), and the
 * part-switcher — the joined bar every mode uses to switch its parts
 * (mode-band.css § the part-switcher), which cannot wrap without breaking its
 * one outline (plan 261007h § F2). Either can open, or reflow, with its chosen
 * button past the edge, and which one is chosen is the one thing the row is for.
 * This is the half CSS cannot do; it was OrderGroup's own until 2026-10-07, and
 * was moved here rather than copied (GPT Sol's plan review, R7).
 *
 * The chosen button is read from the DOM: `aria-pressed="true"` (OrderGroup,
 * Learn, Skim) or `aria-checked="true"` (the radiogroups).
 *
 * **`scrollLeft`, not `scrollIntoView`**, which also scrolls every scrolling
 * ancestor — the band and the page — to bring the button into *their* view.
 *
 * **Again after a reflow, not only on opening.** The UI face swaps in after a
 * mode mounts (fonts.ts § onFontsChanged), a rotation narrows the row, and a
 * newly drawn option can move the chosen button; any of them can push it out
 * without changing the selection. GPT Sol, on plan 261001o; the option-set case
 * was completed in its code review.
 *
 * **And it says when there is more to scroll.** A row that clips exactly
 * between two buttons hides a whole option, and on a touch screen the scrollbar
 * is an overlay that shows only while a finger moves it. So `markMore` sets
 * `data-more-start` / `data-more-end` on the row while it can scroll further
 * that way, and mode-band.css § the part-switcher draws a short fade on that
 * edge only (the designer's review of plan 261007h § F2). Because a fade can
 * cover the edge of a button, the reveal stops a fade's width (plus any outer
 * outline) short of an edge with more beyond it. Reflows preserve the focused
 * button, when there is one; a new selection reveals the chosen one. If the
 * button cannot fit between the fades, the row keeps its marks but omits the
 * mask. Manual scrolling only updates the marks; it does not undo a swipe.
 *
 * Where nothing overflows there is nothing to scroll, no mark and no fade, and
 * this does nothing.
 */
import { type RefObject, useLayoutEffect } from "react";
import { onFontsChanged } from "./fonts.js";

/**
 * How wide the edge fade is, in rem. mode-band.css's `--more-fade` is the same
 * number (tests/reveal-chosen-more.test.tsx holds the two together).
 */
export const MORE_FADE_REM = 1.25;

function fadePx(el: Element): number {
  const root = Number.parseFloat(getComputedStyle(el.ownerDocument.documentElement).fontSize);
  return MORE_FADE_REM * (Number.isFinite(root) && root > 0 ? root : 16);
}

/**
 * Scroll `group` the least distance that shows `button` whole and clear of
 * the fade on any edge that has more beyond it. Omit the mask if the button
 * cannot fit between its fades; a button wider than the viewport shows its
 * reading start. At a row's end the browser clamps the scroll and its fade goes.
 */
export function revealButton(group: HTMLElement, button: HTMLElement): void {
  const view = group.getBoundingClientRect();
  const box = button.getBoundingClientRect();
  /* Which neighbour is on which side: in a right-to-left row the next one is
     to the left. `scrollLeft` deltas move the view the same way in both. */
  const rtl = getComputedStyle(group).direction === "rtl";
  const leftMore = rtl ? button.nextElementSibling : button.previousElementSibling;
  const rightMore = rtl ? button.previousElementSibling : button.nextElementSibling;
  const style = getComputedStyle(button);
  const outline = Math.max(
    0,
    (Number.parseFloat(style.outlineWidth) || 0) + (Number.parseFloat(style.outlineOffset) || 0),
  );
  const wantedFade = fadePx(group);
  const tooWide = box.width + outline * 2 > view.width - (leftMore ? wantedFade : 0) - (rightMore ? wantedFade : 0);
  group.toggleAttribute("data-more-unmasked", tooWide);
  const fade = tooWide ? 0 : wantedFade;
  const left = view.left + (leftMore ? fade : 0) + outline;
  const right = view.right - (rightMore ? fade : 0) - outline;
  /* When even the unmasked viewport is too small, align the reading start
     consistently rather than alternate between two impossible edge fits. */
  if (box.width > right - left) group.scrollLeft += rtl ? box.right - right : box.left - left;
  else if (box.left < left) group.scrollLeft -= left - box.left;
  else if (box.right > right) group.scrollLeft += box.right - right;
}

/** Scroll `group` the least distance that shows its chosen button whole. */
export function revealChosen(group: HTMLElement): void {
  const on = group.querySelector<HTMLElement>('[aria-pressed="true"], [aria-checked="true"]');
  if (on) revealButton(group, on);
}

/**
 * Mark the edges `group` can still scroll towards: `data-more-start`,
 * `data-more-end`, or neither. `scrollLeft` counts from the start edge in
 * either direction (negative in a right-to-left row), so its size is the
 * distance from the start. Clamp elastic overscroll before marking; taking an
 * absolute value would turn a bounce past the start into a false start fade.
 * A pixel's slack, because zoom makes it fractional.
 */
export function markMore(group: HTMLElement): void {
  const max = group.scrollWidth - group.clientWidth;
  const rtl = getComputedStyle(group).direction === "rtl";
  const from = Math.max(0, Math.min(max, rtl ? -group.scrollLeft : group.scrollLeft));
  group.toggleAttribute("data-more-start", max > 1 && from > 1);
  group.toggleAttribute("data-more-end", max > 1 && from < max - 1);
}

/**
 * Reveal the chosen button of `ref`'s row now and whenever `chosen` changes.
 * After a resize, font swap or child-list change, preserve a focused button,
 * otherwise reveal the choice. Reveal a button that takes focus, and keep the
 * row's `data-more-*` marks true on each of those and on every scroll.
 *
 * @param chosen the chosen option's key — a change re-runs the reveal. It is
 *   the trigger, not an input: the chosen button is read from the DOM.
 */
export function useRevealChosen(ref: RefObject<HTMLElement | null>, chosen: unknown): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `chosen` is the trigger, not an input — the chosen button is read from the DOM.
  useLayoutEffect(() => {
    const group = ref.current;
    if (!group) return;
    const mark = () => markMore(group);
    const reveal = () => {
      const focused = group.ownerDocument.activeElement;
      if (focused instanceof HTMLElement && focused.parentElement === group) revealButton(group, focused);
      else revealChosen(group);
      mark();
    };
    // A selection change reveals the choice; later reflows preserve focus.
    revealChosen(group);
    mark();
    group.addEventListener("scroll", mark, { passive: true });
    /* A button reached by Tab can sit under a fade; bring it clear. */
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.parentElement === group) {
        revealButton(group, target);
        mark();
      }
    };
    group.addEventListener("focusin", onFocus);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reveal);
    ro?.observe(group);
    for (const child of group.children) ro?.observe(child);
    /* A constrained row's box does not change when a new option makes its
       contents wider, and existing buttons only move — neither wakes a
       ResizeObserver. Observe new children too, then reveal the focused button
       or the choice. `childList` ignores `aria-pressed`/`aria-checked`:
       `chosen` owns that path synchronously through the layout effect. */
    const mutations =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            ro?.disconnect();
            ro?.observe(group);
            for (const child of group.children) ro?.observe(child);
            reveal();
          });
    mutations?.observe(group, { childList: true });
    const offFonts = onFontsChanged(reveal);
    return () => {
      group.removeEventListener("scroll", mark);
      group.removeEventListener("focusin", onFocus);
      mutations?.disconnect();
      ro?.disconnect();
      offFonts();
    };
  }, [ref, chosen]);
}
