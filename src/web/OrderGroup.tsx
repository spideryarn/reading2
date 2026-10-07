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
 * The reveal — on opening, on a new selection, and after a resize, a font swap
 * or a change in the options — is useRevealChosen.ts, shared since 2026-10-07
 * with the part-switcher, whose joined bar scrolls sideways the same way.
 *
 * Where nothing overflows — a mouse, or a wide band — there is nothing to
 * scroll and this does nothing, so the touch-only rule stays in one place: the
 * CSS.
 *
 * The buttons are the caller's, with `aria-pressed`; the trailing count or
 * badge goes beside this, not in it, because the group is what a screen reader
 * announces as "Order the … by" (GlossaryPanel.tsx § SortBar).
 */
import { type ReactNode, useRef } from "react";
import { useRevealChosen } from "./useRevealChosen.js";

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
  useRevealChosen(ref, selected);

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
