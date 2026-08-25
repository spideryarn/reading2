/**
 * How a gist column reads: a fixed panel laid over the column, holding the
 * whole level as a list with the current item held on the reading line.
 *
 * Greg, 2026-08-25, choosing it over three alternatives built alongside it:
 *
 * > Let's make Centred always-on, and get rid of Siblings, Neighbours, and
 * > Panel.
 *
 * What the panel replaces, and what it must therefore carry, is in
 * ContextList.tsx. What it costs is one thing, stated in
 * docs/project/column-context.md: the current title no longer starts at the
 * exact row its text starts on. The cells are still there underneath, with
 * their borders and tints, and a narrow gutter down the left of the column is
 * left uncovered so the boundaries stay visible beside the prose — that is
 * the alignment invariant's one remaining visible trace at these levels, and
 * it was the thing most worth keeping.
 *
 * **It is a bounded window, not a scrollable outline.** A level can hold
 * dozens of sections, and if the panel scrolled, the wheel would move the
 * panel instead of the article and "focus follows scroll" would stop being
 * true. So the panel clips. The list slides so the current item sits on the
 * focus line — 40% down the viewport, where the eye is — and whatever falls
 * outside is not shown; the group headings are the landmarks for what lies
 * beyond, and the spine remains the view of the whole article.
 *
 * The panel is only ever built in reading mode. In outline mode the table is
 * itself a compact whole-article list and the column is the thing to read.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { BlockId, NodeId } from "../types.js";
import type { ContextEntry, ContextItem } from "./context.js";
import { ContextList } from "./ContextList.js";
import { TooltipGroup } from "./Tooltip.js";
import { FOCUS_LINE, type ColumnRect } from "./useColumnContext.js";
import { NAV_DEPTH_ATTR } from "./keynav.js";

/**
 * Long enough that crossing the list on the way to the prose fires nothing;
 * short enough that pausing on an entry does not feel like a wait. Shorter
 * than the spine's 240, because these are words, not two-pixel bands — you
 * know what you are pointing at. Once one is open the group makes the
 * neighbours instant.
 */
const DELAY = { open: 150, close: 60 } as const;

/** The strip of the column left uncovered, so the cells' boundaries show. */
export const GUTTER_PX = 10;

interface Props {
  depth: number;
  /** What ↑ / ↓ step by over this panel — the arc column says 1, not 0. */
  navDepth: number;
  entries: ContextEntry[];
  rect: ColumnRect | null;
  /** Re-centre on a height-only resize, which changes no entry and no rect. */
  viewportH: number;
  activeChain: Set<NodeId>;
  crumbFor(item: ContextItem): string | null;
  onJump(blockId: BlockId): void;
}

export function ContextPanel({
  depth,
  navDepth,
  entries,
  rect,
  viewportH,
  activeChain,
  crumbFor,
  onJump,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);

  // Slide the list so the current item's middle sits on the focus line.
  // Measured, not computed from entry counts: tiers have different heights and
  // the gist wraps. `entries`, the column width and the viewport height are
  // re-run triggers, not values the effect reads — the list changed, or
  // reflowed, so re-measure it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run triggers
  useLayoutEffect(() => {
    const p = panel.current;
    const cur = list.current?.querySelector<HTMLElement>("li.tier-cur");
    if (!p || !cur) return;
    const focusY = window.innerHeight * FOCUS_LINE - p.getBoundingClientRect().top;
    // Centred, but never off the top. Near the top of the page the header row
    // sits low (the bars are sticky, under the masthead), so the focus line
    // can be closer to the panel's top than the current item is tall; holding
    // the item's middle there would push its title above the panel. The
    // current item is the one thing that must always be whole.
    const centred = focusY - (cur.offsetTop + cur.offsetHeight / 2);
    // …and if a heading names the part the current item is in, keep that
    // too: the heading is the answer to "which part is this", and at the top
    // of the article it is the first thing in the list.
    const prev = cur.previousElementSibling as HTMLElement | null;
    const keepFrom = prev?.classList.contains("ctx-group") ? prev.offsetTop : cur.offsetTop;
    setOffset(Math.max(centred, -keepFrom));
  }, [entries, rect?.width, rect?.top, viewportH]);

  if (!rect) return null;
  return (
    <div
      ref={panel}
      className={`ctx-panel depth-${depth}`}
      style={{ top: rect.top, left: rect.left + GUTTER_PX, width: rect.width - GUTTER_PX }}
      {...{ [NAV_DEPTH_ATTR]: navDepth }}
    >
      <div
        ref={list}
        className="ctx-panel-list"
        style={{ transform: `translateY(${Math.round(offset)}px)` }}
      >
        <TooltipGroup delay={DELAY}>
          <ContextList
            entries={entries}
            onJump={onJump}
            activeChain={activeChain}
            crumbFor={crumbFor}
          />
        </TooltipGroup>
      </div>
    </div>
  );
}
