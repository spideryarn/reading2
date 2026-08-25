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
 * dozens of sections, and if the reader could scroll the panel, the wheel
 * would move the panel instead of the article and "focus follows scroll"
 * would stop being true. So it is `overflow: hidden`, which no wheel or
 * trackpad can move — but which this file *can* move by setting `scrollTop`.
 * The list is scrolled, not translated, and that distinction is load-bearing:
 * `position: sticky` reacts to scrolling and not to transforms, so under the
 * `translateY` this used to use, a sticky group heading would simply slide
 * away with everything else. Scrolling it for real is what lets the part
 * heading pin at the top of the panel while its sections run under it.
 *
 * The panel is only ever built in reading mode. In outline mode the table is
 * itself a compact whole-article list and the column is the thing to read.
 */
import { useLayoutEffect, useRef } from "react";
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

/**
 * The height of the fade at the panel's bottom edge — `mask-image` in
 * styles.css, and it must match. Anything inside it is half-there, so the
 * bottom clamp treats the panel as ending here.
 */
const FADE_PX = 40;

interface Props {
  depth: number;
  /** What ↑ / ↓ step by over this panel — the arc column says 1, not 0. */
  navDepth: number;
  entries: ContextEntry[];
  rect: ColumnRect | null;
  /** Re-centre on a height-only resize, which changes no entry and no rect. */
  viewportH: number;
  /** The pinned column's right edge — see LiveContext.clipLeft. */
  clipLeft: number;
  /** This column is the pinned one, so nothing clips it and it paints on top. */
  pinned: boolean;
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
  clipLeft,
  pinned,
  activeChain,
  crumbFor,
  onJump,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // Scroll the list so the current item's middle sits on the focus line.
  // Measured, not computed from entry counts: tiers have different heights and
  // the gist wraps. `entries`, the column width and the viewport height are
  // re-run triggers, not values the effect reads — the list changed, or
  // reflowed, so re-measure it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run triggers
  useLayoutEffect(() => {
    const p = panel.current;
    if (!p) return;
    const cur = list.current?.querySelector<HTMLElement>("li.tier-cur");
    // No current item means the reader is above everything this level has —
    // a column whose first cells are continuations, before its first real
    // item begins (context.ts § currentIndex). The honest view is the top of
    // the list, not the last place the panel happened to be left.
    if (!cur) {
      p.scrollTop = 0;
      return;
    }
    const focusY = window.innerHeight * FOCUS_LINE - p.getBoundingClientRect().top;
    const wanted = cur.offsetTop + cur.offsetHeight / 2 - focusY;
    // Two clamps, and the current item wins both. It is the one thing that
    // must always be whole, and the panel does not scroll for the reader, so
    // anything pushed out of it is simply gone.
    //
    //  - Never under the pinned group heading. Near the top of the page the
    //    header row sits low (the bars are sticky, under the masthead), so the
    //    focus line can be closer to the panel's top than the item is tall.
    //  - Never off the bottom, which a long gist in a narrow column can do.
    //
    // If the item is taller than the panel can hold, the top wins: the title
    // is worth more than the tail of the gist.
    const head = list.current?.querySelector<HTMLElement>("li.ctx-group");
    const top = cur.offsetTop - (head?.offsetHeight ?? 0);
    const bottom = cur.offsetTop + cur.offsetHeight - (p.clientHeight - FADE_PX);
    p.scrollTop = Math.max(0, Math.min(top, Math.max(bottom, wanted)));
  }, [entries, rect?.width, rect?.top, viewportH]);

  if (!rect) return null;
  const left = rect.left + GUTTER_PX;
  return (
    <div
      ref={panel}
      className={`ctx-panel depth-${depth}${pinned ? " pinned" : ""}`}
      style={{
        top: rect.top,
        left,
        width: rect.width - GUTTER_PX,
        // Scrolled right, a middle column slides under the pinned one; its
        // panel must go under it too. Zero when nothing overlaps, which is
        // every unscrolled view — see LiveContext.clipLeft.
        clipPath: pinned ? undefined : `inset(0 0 0 ${Math.max(0, clipLeft - left)}px)`,
      }}
      {...{ [NAV_DEPTH_ATTR]: navDepth }}
    >
      <div ref={list} className="ctx-panel-list">
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
