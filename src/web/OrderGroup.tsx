/**
 * **The order buttons of a band, as the named group — and on a touch screen,
 * one line that scrolls sideways with the pressed order kept in view.**
 *
 * Greg, 2026-10-01 (Q-landscape-orders, option B): *"On touch screens only,
 * keep it to one line and let it scroll sideways. This saves about 49px, but
 * orders past the edge stay hidden until you swipe."* The one line is CSS
 * (glossary.css § a touch screen); this component's job is the half CSS cannot
 * do. A band opened with its last order pressed would otherwise show the first
 * three and hide the one in force — and how the list is ordered is the one thing
 * the row is for. Plan 261001o.
 *
 * **`scrollLeft`, not `scrollIntoView`**, which also scrolls every scrolling
 * ancestor — the band and the page — to bring the button into *their* view.
 *
 * **Again after a reflow, not only on opening.** The UI face swaps in after a
 * mode mounts (fonts.ts § onFontsChanged), a rotation or the trail arriving
 * narrows the group, and newly available orders can move the pressed button;
 * any of them can push it out without changing the selection. GPT Sol, on the
 * plan; the option-set case was completed in its code review.
 *
 * Where nothing overflows — a mouse, or a wide band — there is nothing to
 * scroll and this does nothing, so the touch-only rule stays in one place: the
 * CSS.
 *
 * The buttons are the caller's, with `aria-pressed`; the trailing count or
 * badge goes beside this, not in it, because the group is what a screen reader
 * announces as "Order the … by" (GlossaryPanel.tsx § SortBar).
 */
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { onFontsChanged } from "./fonts.js";

/** Scroll `group` the least distance that shows its pressed button whole. */
export function revealPressed(group: HTMLElement): void {
  const on = group.querySelector<HTMLElement>('[aria-pressed="true"]');
  if (!on) return;
  const view = group.getBoundingClientRect();
  const button = on.getBoundingClientRect();
  if (button.left < view.left) group.scrollLeft -= view.left - button.left;
  else if (button.right > view.right) group.scrollLeft += button.right - view.right;
}

export function OrderGroup({
  label,
  selected,
  children,
}: {
  /** The group's accessible name, "Order the terms by". */
  label: string;
  /** The pressed order's key — a change re-runs the reveal. */
  selected: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `selected` is the trigger, not an input — the pressed button is read from the DOM.
  useLayoutEffect(() => {
    const group = ref.current;
    if (!group) return;
    const reveal = () => revealPressed(group);
    reveal();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reveal);
    ro?.observe(group);
    for (const child of group.children) ro?.observe(child);
    /* A constrained group's box does not change when a new option makes its
       contents wider, and existing buttons only move — neither wakes a
       ResizeObserver. Observe new children too, then put the pressed one back
       in view. `childList` deliberately ignores `aria-pressed`: `selected`
       owns that path synchronously through the layout effect. */
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
  }, [selected]);

  return (
    /* biome-ignore lint/a11y/useSemanticElements: <fieldset> is for form
       controls and wants a <legend>; these are toggle buttons that change how a
       list is ordered, and `role="group"` with an accessible name is exactly
       what ARIA has for that. */
    <div ref={ref} className="gloss-sort-group" role="group" aria-label={label}>
      {children}
    </div>
  );
}
