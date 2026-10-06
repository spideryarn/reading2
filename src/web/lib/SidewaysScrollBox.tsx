/**
 * The box a wide table scrolls sideways in, which says when there is more.
 *
 * A table wider than a phone scrolls inside its own box rather than pushing
 * the page sideways (lib/DataTable.tsx says why). The cost is that nothing
 * shows the box scrolls: at 390px `/admin/costs` drew four tables whose later
 * columns started off screen, each ending in a clean right-hand border. So
 * this draws a soft shade down an edge while content is hidden past it — the
 * right to begin with, the left once you have scrolled — and takes it away at
 * the end. docs/plans/261006g-none-yet-is-not-a-404-and-admin-costs-scroll-cue.md
 * § Stage 2.
 *
 * Three things that are not obvious from the markup:
 *
 * - **Two boxes, and the shades are in the outer one.** Anything inside the
 *   scrolling box scrolls away with the table, so the shades sit on a wrapper
 *   that does not scroll. The wrapper takes the caller's margin; the inner box
 *   keeps the border and the rounding, exactly as the plain box had them.
 * - **A tint, not a fade to the page colour.** The label column of the costs
 *   tables is pinned at the left and opaque in the page's own colour
 *   (AdminCostsPage.tsx § `PINNED`), so a fade to that colour would be
 *   invisible over its padding and would rub out its first letters. A thin
 *   wash of the text colour shows over any cell and hides nothing, in either
 *   theme. That is also why a CSS-only scroll shadow
 *   (`background-attachment: local`) was passed over: it paints *behind* the
 *   cells, and these cells have backgrounds.
 * - **It is measured, and from four causes.** On mount, on scroll, when the box
 *   changes size, and when what is *in* the box changes size: the pivot's
 *   columns change with *then by* while the box keeps its width and nothing
 *   scrolls. The last is why the box's children are observed as well as the
 *   box — so a child must be an element that stays for the box's life, which a
 *   `<table>` is. A child swapped for another would go unwatched.
 *
 * `z-20` puts the shades above a pinned cell's `z-10`, and `isolate` keeps
 * both numbers inside this box: without it the shade would be in the page's
 * stacking order, above whatever else there happened to be under 20.
 *
 * The shades are decoration: `aria-hidden`, and `pointer-events-none`, so a
 * tap or a drag on one reaches the cell under it.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * How near the end counts as the end, in pixels. `scrollLeft` is fractional on
 * a zoomed or high-density screen and the widths are rounded, so the
 * arithmetic end can be a fraction of a pixel out of reach — and a cue that
 * never clears is worse than none.
 */
const NEAR = 1;

type More = { left: boolean; right: boolean };
const NEITHER: More = { left: false, right: false };

/**
 * Which edges of a sideways-scrolling element have content hidden past them.
 * Give `ref` to the element that has `overflow-x: auto`.
 */
function useMoreSideways(): [React.RefObject<HTMLDivElement | null>, More] {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState<More>(NEITHER);

  /* A layout effect, so the first paint already has the shade: an ordinary
     effect would draw the table bare and add it a frame later. */
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const measure = () => {
      const left = box.scrollLeft > NEAR;
      const right = box.scrollWidth - box.clientWidth - box.scrollLeft > NEAR;
      /* The same object back when nothing changed, so a scroll that stays
         between the two ends renders nothing. */
      setMore((was) => (was.left === left && was.right === right ? was : { left, right }));
    };
    measure();
    box.addEventListener("scroll", measure, { passive: true });
    /* Absent in some test DOMs, hence the guard — as in dock-fit.ts. */
    const resizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizes?.observe(box);
    for (const child of box.children) resizes?.observe(child);
    return () => {
      box.removeEventListener("scroll", measure);
      resizes?.disconnect();
    };
  }, []);

  return [ref, more];
}

/* 15% of the text colour on a light page; twice that on a dark one, where a
   light wash over a dark ground was too faint to notice at the same strength
   (browser check, 2026-10-06). */
const SHADE =
  "tw:pointer-events-none tw:absolute tw:inset-y-px tw:z-20 tw:w-6 tw:from-foreground/15 tw:dark:from-foreground/30 tw:to-transparent";

/**
 * The scrolling box itself. Exported for `DataTable`, which draws the same box
 * without the cue, so the two cannot drift apart.
 */
export const SCROLL_BOX = "tw:relative tw:overflow-x-auto tw:rounded-lg tw:border tw:border-border";

export function SidewaysScrollBox({
  className,
  children,
}: {
  /** For the outer box: a margin. The border and the scrolling are the inner one's. */
  className?: string;
  /** One element that lasts as long as the box does — see the header. */
  children: ReactNode;
}) {
  const [box, more] = useMoreSideways();
  return (
    <div
      data-sideways-scroll=""
      data-more-left={more.left ? "" : undefined}
      data-more-right={more.right ? "" : undefined}
      className={`tw:relative tw:isolate${className ? ` ${className}` : ""}`}
    >
      {/* `relative` is for the `sr-only` labels inside: lib/DataTable.tsx § `DataTable`. */}
      <div
        ref={box}
        data-scroll-box=""
        className={SCROLL_BOX}
      >
        {children}
      </div>
      {/* Inset by the border's one pixel and rounded with it, so a shade stays inside the box's outline. */}
      {more.left && (
        <div aria-hidden="true" data-scroll-fade="left" className={`${SHADE} tw:left-px tw:rounded-l-lg tw:bg-linear-to-r`} />
      )}
      {more.right && (
        <div aria-hidden="true" data-scroll-fade="right" className={`${SHADE} tw:right-px tw:rounded-r-lg tw:bg-linear-to-l`} />
      )}
    </div>
  );
}
