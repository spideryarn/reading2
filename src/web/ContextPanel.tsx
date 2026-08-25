/**
 * The hoisted column context: a fixed panel laid over a gist column, holding
 * that whole level as a list with the current item marked. Used by the Panel
 * and Centred modes — the same panel, differing only in where it holds the
 * current item. See docs/project/column-context.md.
 *
 * This is the one part of the column-context work that steps *outside* the
 * table's alignment invariant (granularity-zoom.md#the-tabular-view): the
 * list's rows are not the table's rows. That is the experiment, not an
 * accident, and the cells underneath keep drawing their borders and tints so
 * the boundaries are still there to compare against.
 *
 * **It is a bounded window, not a scrollable outline.** GPT's review of the
 * plan put the risk plainly: a level can hold dozens of sections, and if the
 * panel scrolled, the wheel would move the panel instead of the article and
 * "focus follows scroll" would stop being true. So the panel clips. The list
 * slides so the current item is where the mode wants it, and whatever falls
 * outside the panel is simply not shown — the group headings are the
 * landmarks that say what lies beyond, and the spine remains the view of the
 * whole article.
 *
 * Two anchors:
 *
 *  - `top` — the list stays put, and only slides when the current item would
 *    otherwise leave a comfortable band of the panel. Wikipedia's tested
 *    winner: a full list with a cursor, moving as little as possible.
 *  - `centre` — the current item is always held on the focus line, 40% down
 *    the viewport. Greg's suggestion: "always have the current cell centred
 *    and then show stuff above and below smaller".
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { BlockId } from "../types.js";
import type { ContextEntry } from "./context.js";
import { ContextList } from "./ContextList.js";
import { FOCUS_LINE, type ColumnRect } from "./useColumnContext.js";
import { NAV_DEPTH_ATTR } from "./keynav.js";

interface Props {
  depth: number;
  /** What ↑ / ↓ step by over this panel — the arc column says 1, not 0. */
  navDepth: number;
  entries: ContextEntry[];
  anchor: "top" | "centre";
  rect: ColumnRect | null;
  /** Re-centre on a height-only resize, which changes no entry and no rect. */
  viewportH: number;
  progress: boolean;
  onJump(blockId: BlockId): void;
}

/** In `top` mode, the band of the panel the current item is kept inside. */
const BAND = { from: 0.08, to: 0.7, settle: 0.22 } as const;

export function ContextPanel({
  depth,
  navDepth,
  entries,
  anchor,
  rect,
  viewportH,
  progress,
  onJump,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);

  // Slide the list after every change of content. Measured, not computed from
  // entry counts: tiers have different heights and the gist wraps. `entries`,
  // the column width and the viewport height are re-run triggers, not values
  // the effect reads — the list changed, or reflowed, so re-measure it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run triggers
  useLayoutEffect(() => {
    const p = panel.current;
    const l = list.current;
    const cur = l?.querySelector<HTMLElement>("li.tier-cur");
    if (!p || !l || !cur) return;
    const panelH = p.clientHeight;
    const listH = l.scrollHeight;
    const curTop = cur.offsetTop;
    const curH = cur.offsetHeight;
    // The list can never slide past its own end, nor start below the top —
    // unless it is being centred, where empty space is the point.
    const clamp = (o: number) => Math.min(0, Math.max(Math.min(0, panelH - listH), o));

    if (anchor === "centre") {
      const focusY = window.innerHeight * FOCUS_LINE - p.getBoundingClientRect().top;
      setOffset(focusY - (curTop + curH / 2));
      return;
    }
    setOffset((prev) => {
      const y = curTop + prev;
      if (y >= panelH * BAND.from && y + curH <= panelH * BAND.to) return clamp(prev);
      return clamp(panelH * BAND.settle - curTop);
    });
  }, [entries, anchor, rect?.width, viewportH]);

  if (!rect) return null;
  return (
    <div
      ref={panel}
      className={`ctx-panel anchor-${anchor} depth-${depth}`}
      style={{ left: rect.left, width: rect.width }}
      {...{ [NAV_DEPTH_ATTR]: navDepth }}
    >
      <div
        ref={list}
        className="ctx-panel-list"
        style={{ transform: `translateY(${Math.round(offset)}px)` }}
      >
        <ContextList entries={entries} onJump={onJump} progress={progress} depth={depth} />
      </div>
    </div>
  );
}
