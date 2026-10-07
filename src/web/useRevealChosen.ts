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
 * Where nothing overflows there is nothing to scroll and this does nothing.
 */
import { type RefObject, useLayoutEffect } from "react";
import { onFontsChanged } from "./fonts.js";

/** Scroll `group` the least distance that shows its chosen button whole. */
export function revealChosen(group: HTMLElement): void {
  const on = group.querySelector<HTMLElement>('[aria-pressed="true"], [aria-checked="true"]');
  if (!on) return;
  const view = group.getBoundingClientRect();
  const button = on.getBoundingClientRect();
  if (button.left < view.left) group.scrollLeft -= view.left - button.left;
  else if (button.right > view.right) group.scrollLeft += button.right - view.right;
}

/**
 * Reveal the chosen button of `ref`'s row now, whenever `chosen` changes, and
 * after any resize, font swap or change in the row's children.
 *
 * @param chosen the chosen option's key — a change re-runs the reveal. It is
 *   the trigger, not an input: the chosen button is read from the DOM.
 */
export function useRevealChosen(ref: RefObject<HTMLElement | null>, chosen: unknown): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `chosen` is the trigger, not an input — the chosen button is read from the DOM.
  useLayoutEffect(() => {
    const group = ref.current;
    if (!group) return;
    const reveal = () => revealChosen(group);
    reveal();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reveal);
    ro?.observe(group);
    for (const child of group.children) ro?.observe(child);
    /* A constrained row's box does not change when a new option makes its
       contents wider, and existing buttons only move — neither wakes a
       ResizeObserver. Observe new children too, then put the chosen one back
       in view. `childList` deliberately ignores `aria-pressed`/`aria-checked`:
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
      mutations?.disconnect();
      ro?.disconnect();
      offFonts();
    };
  }, [ref, chosen]);
}
