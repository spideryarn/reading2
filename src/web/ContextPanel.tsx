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
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { BlockId, NodeId } from "../types.js";
import { landmarkLines, type ContextEntry, type ContextItem } from "./context.js";
import { ContextList } from "./ContextList.js";
import { TooltipGroup } from "./Tooltip.js";
import { FOCUS_LINE, type ColumnRect } from "./useColumnContext.js";
import { NAV_DEPTH_ATTR } from "./keynav.js";
import { SWIPE_ATTR } from "./swipe.js";

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
 * The height of the fade at the panel's bottom edge. Anything inside it is
 * half-there, so the bottom clamp treats the panel as ending here — and the
 * stylesheet draws the mask from this same number, handed over as a custom
 * property below rather than written out again in CSS.
 */
const FADE_PX = 40;

/**
 * The room above the first item and below the last one, as a share of the
 * viewport, so that either end can still reach the focus line: `scrollTop`
 * cannot go below zero or past the end, and without this a short level would
 * sit jammed at the top of its panel while the longer level beside it held its
 * current item at 40% — the columns would stop lining up, which is the one
 * thing this view is for.
 *
 * **Derived from FOCUS_LINE, never written down as a number.** These were
 * `40vh` and `60vh` in the stylesheet for an afternoon, which is correct only
 * while the focus line is at 0.4. Moving the line would have left the padding
 * quietly too small at one end, and nothing would have errored: the first item
 * would simply have stopped short of the line. Exactly the kind of agreement
 * between two files that no check catches — docs/reusable/silent-success.md.
 */
const LEAD = `${FOCUS_LINE * 100}vh`;
const TAIL = `${(1 - FOCUS_LINE) * 100}vh`;



interface Props {
  depth: number;
  /** What ↑ / ↓ step by over this panel — the arc column says 1, not 0. */
  navDepth: number;
  entries: ContextEntry[];
  rect: ColumnRect | null;
  /** Re-centre on a height-only resize, which changes no entry and no rect. */
  viewportH: number;
  /**
   * `100svh` — see LiveContext.stableH. The line budget is worked out from
   * this and not from `viewportH`, because a phone's toolbars collapse as you
   * scroll and `innerHeight` grows while they do.
   */
  stableH: number;
  /** The pinned column's right edge — see LiveContext.clipLeft. */
  clipLeft: number;
  /** This column is the pinned one, so nothing clips it and it paints on top. */
  pinned: boolean;
  activeChain: Set<NodeId>;
  crumbFor(item: ContextItem): string | null;
  onJump(blockId: BlockId): void;
  /** Hovering an entry lights its ancestors in the coarser columns — see TableView. */
  onHoverNode(id: NodeId | null): void;
}

export function ContextPanel({
  depth,
  navDepth,
  entries,
  rect,
  viewportH,
  stableH,
  clipLeft,
  pinned,
  activeChain,
  crumbFor,
  onJump,
  onHoverNode,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // Whether this level has an item under the focus line at all. It may not:
  // see context.ts § currentIndex. The list then sits flush at the top of the
  // panel, and the lead padding is dropped with `.no-current` — dropped rather
  // than scrolled past, because a short list does not have the scroll range to
  // get past it. `scrollTop` is clamped to the content, so with three entries
  // and a viewport of lead above them, most of the panel would have stayed
  // blank however far we asked it to scroll.
  const hasCurrent = entries.some((e) => e.kind === "item" && e.tier === "cur");

  // How many lines of gist a landmark can afford here — see context.ts § how
  // much fits. `rect.top`, the panel's own top edge, is the obvious thing to
  // subtract and is the one input that must NOT be used: it is the sticky
  // header's bottom, which settles over the first hundred and fifty pixels of
  // scroll, so the budget would step up while the reader scrolled and every
  // landmark would rewrap. Measured doing exactly that before this line was
  // written the other way round. `stableH` is `100svh` and the bars above the
  // panel are a constant inside `landmarkLines`.
  const lines = landmarkLines(entries, stableH);

  // Scroll the list so the current item's middle sits on the focus line.
  // Measured, not computed from entry counts: tiers have different heights and
  // the gist wraps.
  const place = useCallback(() => {
    const p = panel.current;
    if (!p) return;
    const cur = list.current?.querySelector<HTMLElement>("li.tier-cur");
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
    //
    // The heading measured is the current item's own — `.holds-current`, the
    // one that will be pinned when the item is near the top — and not simply
    // the first in the list. A part title can wrap to two lines, so the
    // headings are not interchangeable: measure the wrong one and a tall
    // heading hides the very item this clamp exists to keep whole. A level
    // with no headings at all (the parts, whose parent is the root) correctly
    // measures nothing.
    const head = list.current?.querySelector<HTMLElement>("li.ctx-group.holds-current");
    const top = cur.offsetTop - (head?.offsetHeight ?? 0);
    const bottom = cur.offsetTop + cur.offsetHeight - (p.clientHeight - FADE_PX);
    p.scrollTop = Math.max(0, Math.min(top, Math.max(bottom, wanted)));
  }, []);

  // `entries`, the column width and the viewport height are re-run triggers,
  // not values read here — the list changed, or moved, so place it again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run triggers
  useLayoutEffect(place, [place, entries, rect?.width, rect?.top, viewportH]);

  // And place it again whenever the list itself changes size, which no prop
  // reports: a font swapping in or a gist rewrapping moves every entry below
  // it, and the current one would slide off the focus line and stay there. The
  // sampler's observer watches the *table*; this one watches what is actually
  // being positioned. Writing `scrollTop` cannot change the list's size, so
  // this cannot feed itself.
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [place]);

  if (!rect) return null;
  const left = rect.left + GUTTER_PX;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: onMouseLeave ends a hover, it starts nothing
    <div
      ref={panel}
      className={`ctx-panel depth-${depth}${pinned ? " pinned" : ""}${
        hasCurrent ? "" : " no-current"
      }`}
      style={
        {
          top: rect.top,
          left,
          width: rect.width - GUTTER_PX,
          // Scrolled right, a middle column slides under the pinned one; its
          // panel must go under it too. Zero when nothing overlaps, which is
          // every unscrolled view — see LiveContext.clipLeft.
          clipPath: pinned ? undefined : `inset(0 0 0 ${Math.max(0, clipLeft - left)}px)`,
          // The three numbers the stylesheet would otherwise have to keep in
          // step with this file by hand.
          "--ctx-lead": LEAD,
          "--ctx-tail": TAIL,
          "--ctx-fade": `${FADE_PX}px`,
        } as React.CSSProperties
      }
      onMouseLeave={() => onHoverNode(null)}
      {...{ [NAV_DEPTH_ATTR]: navDepth }}
      /* The line budget, on the DOM, so a browser check can assert what this
         column decided instead of counting lines in a screenshot. An estimate
         that overfills fails silently — the extra entries simply slide under
         the bottom fade — and the check you would naturally run, looking at
         the one column you were thinking about, agrees with it
         (docs/reusable/silent-success.md). */
      data-ctx-lines={lines}
      /* A vertical swipe here steps one item instead of scrolling — swipe.ts.
         The panel is the surface a finger actually lands on in reading mode:
         it covers the column, so the cells underneath are never touched. It
         only exists in reading mode, which is exactly where swiping is on. */
      {...{ [SWIPE_ATTR]: "" }}
    >
      <div ref={list} className="ctx-panel-list">
        <TooltipGroup delay={DELAY}>
          <ContextList
            entries={entries}
            onJump={onJump}
            onHoverNode={onHoverNode}
            activeChain={activeChain}
            crumbFor={crumbFor}
            lines={lines}
          />
        </TooltipGroup>
      </div>
    </div>
  );
}
