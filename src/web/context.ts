/**
 * Column context — the pure half. What a gist column shows *around* the item
 * you are in, so the column can be scanned up and down rather than only read
 * at the point you happen to be standing.
 *
 * Greg, 2026-08-25:
 *
 * > I can't really scan with my eyes up and down in any of those columns to
 * > understand what came before or where this is situated or anything like
 * > that. So I'm wondering if each column could somehow be a fisheye that
 * > shows what came before and what after … always have the current cell
 * > centred and then show stuff above and below smaller.
 *
 * Four treatments were built side by side and compared; the centred one won
 * and is now simply how a gist column reads — see docs/project/column-context.md
 * for the others and why they went. This file decides *what* the column lists;
 * ContextPanel.tsx and ContextList.tsx decide where and how it is drawn.
 *
 * Two rules from the research are enforced here rather than left to the
 * renderer, because they are the design:
 *
 *  - **Discrete tiers, never a gradient.** An entry is `cur`, `near`, `mid` or
 *    `far`. Continuous fisheye scaling puts prose in a just-legible dead zone,
 *    and eye-tracking says nobody reads the shrunk periphery anyway — it is a
 *    landmark, so it only needs to be *distinguishable*, not smoothly scaled.
 *  - **The tree's boundaries are drawn, not inferred.** Distance along the
 *    list decides the tier; a heading wherever the parent changes says which
 *    part a run of sections belongs to. That is Furnas's degree-of-interest
 *    with the outline's own levels as the importance score.
 *
 * Everything addresses position by row index and block id, never by node id
 * in a URL and never by comparing id strings (docs/project/block-ids.md).
 */
import type { BlockId, NodeId, TreeNode } from "../types.js";
import { navigableItems, type Cell } from "./tree.js";

/** How far an entry is from the one the reader is in. Four steps, no gradient. */
export type Tier = "cur" | "near" | "mid" | "far";

/**
 * One item of a column, in document order. Built from a gist cell, or from an
 * arc cell — which is why `text` and `step` exist: the arc column has no
 * titles, only a sentence per part and a `3 / 9` marker.
 */
export interface ContextItem {
  node: TreeNode;
  /** Where clicking it goes: the first block of the item. */
  blockId: BlockId;
  /**
   * The apparatus, collapsed to one entry. It has no gist and never will, so
   * the list shows its title — "Notes" — and nothing else.
   */
  supplement?: boolean;
  /** The arc sentence, when this is the arc column. Otherwise the gist is used. */
  text?: string;
  /**
   * The arc column's step marker, in place of a title — `3` of `9`. Kept as
   * two numbers rather than a formatted string because the marker is set like
   * the cell's: the position in the tint, the `/ total` after it faded and
   * unbolded (`.arc-step .of` in styles.css).
   */
  step?: { index: number; total: number };
}

export interface ContextEntry {
  /** A `group` is a heading for the parent an item belongs to — never reading content. */
  kind: "item" | "group";
  item: ContextItem;
  /** Index into the column's items (items only). */
  index: number;
  tier: Tier;
  /** Already read: before the current item in document order. */
  before: boolean;
  /** For a group: whether the current item is one of its children. */
  holdsCurrent?: boolean;
}

/**
 * Items for a gist column, from its cells, with the row each one starts on.
 *
 * **Continuation cells are not items.** A continuation is a cell whose branch
 * bottomed out above this column (tree.ts), so the node it repeats belongs to
 * a shallower level: listing it here would put a leaf among the sections. It
 * is also what keeps the leaves out of every list, which is what the navLabel
 * contract requires (granularity-zoom.md#node-shape). While a continuation
 * is under the reading line, the nearest real item before it counts as
 * current, which is the honest answer: at this level, that is the last thing
 * there was.
 *
 * Items and starts are returned together because they must stay paired; a
 * caller that took `itemStarts(cells)` separately would be off by one at
 * every continuation.
 */
export function itemsFromCells(
  cells: Cell[],
  blockAt: (row: number) => BlockId | undefined,
  supplementOf: ReadonlyMap<NodeId, TreeNode>,
): { items: ContextItem[]; starts: number[] } {
  const items: ContextItem[] = [];
  const starts: number[] = [];
  /* `navigableItems`, not the cells: at the sections column a note's chain is
     root → supplement → leaf, so the raw cells give a run of blank leaf entries
     — one per endnote, none with a title — and one of them becomes the reader's
     current item. The projection collapses them into a single "Notes". It is
     shared with keynav, position and the arc's numbering **because a fix here
     alone is what breaks the anchor invariant**: three panels agreeing depends
     on all four counting the same items. src/web/tree.ts § navigableItems. */
  for (const item of navigableItems(cells, supplementOf)) {
    if (item.continuation) continue;
    const blockId = blockAt(item.startRow);
    if (!blockId) continue;
    items.push({ node: item.node, blockId, ...(item.supplement && { supplement: true }) });
    starts.push(item.startRow);
  }
  return { items, starts };
}

/**
 * Which item contains `row`: the last one starting at or before it, or **-1
 * when the row is above all of them**.
 *
 * That last case is not as pedantic as it looks. Continuation cells are not
 * items, so a column whose first branch bottomed out above it — part 1 has no
 * sections of its own, part 2 does — genuinely has no item at the top of the
 * article. Clamping to 0 there, as this used to, made the sections column say
 * "you are in the first section of part 2" while the reader was still in part
 * 1. There is always a section you are in; there is not always a *sub*section.
 * Callers show the top of the list with nothing marked current.
 */
export function currentIndex(starts: number[], row: number): number {
  let cur = -1;
  for (const [i, start] of starts.entries()) {
    if (start > row) break;
    cur = i;
  }
  return cur;
}

function tierByDistance(d: number): Tier {
  if (d === 0) return "cur";
  if (d === 1) return "near";
  if (d === 2) return "mid";
  return "far";
}

/**
 * The parent worth naming as a group heading: the item's parent, unless that
 * is the root (or missing), which spans everything and would head every list
 * with the same words. So the parts list has no headings, and the sections
 * list is headed by its parts.
 */
function groupParent(item: ContextItem, nodes: Record<NodeId, TreeNode>): TreeNode | null {
  const parent = item.node.parent === null ? undefined : nodes[item.node.parent];
  return parent && parent.depth >= 1 ? parent : null;
}

/**
 * The whole level, with a heading wherever the parent changes. Tiers step
 * with plain distance along the level, because the list shows everything and
 * needs the eye led to the middle of it — the tree's boundaries are carried
 * by the headings instead.
 *
 * `cur` of -1 (see currentIndex) means the reader is above the level's first
 * item: no entry takes the `cur` tier, nothing is marked read, and the tiers
 * count outwards from the top of the list.
 */
export function levelList(
  items: ContextItem[],
  cur: number,
  nodes: Record<NodeId, TreeNode>,
): ContextEntry[] {
  const out: ContextEntry[] = [];
  const currentParent = items[cur]?.node.parent;
  let lastParent: NodeId | null | undefined;
  items.forEach((item, i) => {
    if (item.node.parent !== lastParent) {
      lastParent = item.node.parent;
      const group = groupParent(item, nodes);
      if (group) {
        out.push({
          kind: "group",
          item: { node: group, blockId: group.range[0] },
          index: i,
          tier: "far",
          before: i < cur,
          holdsCurrent: group.id === currentParent,
        });
      }
    }
    out.push({
      kind: "item",
      item,
      index: i,
      tier: tierByDistance(Math.abs(i - cur)),
      before: i < cur,
    });
  });
  return out;
}

/* ------------------------------------------------------ how much fits ----
   A landmark used to get one line of gist in the arc column and none at all in
   the others, whatever room the column had. With five parts in a
   twelve-hundred-pixel panel that left four fifths of the column blank — the
   same complaint the panel was built to answer, one level up:

   > The "Argument" column is great, but it's not using the full vertical
   > height to display as much information as it could be.
   >
   > — Greg, 2026-08-26

   So a landmark's line budget is worked out from how many entries the level
   has and how tall the window is. Short levels get several lines each and read
   as a page; long ones fall back to titles, which is what they had.

   **Estimated, never measured — and that is a trade, not a free win.** GPT
   Sol's review of this change, 2026-08-26, made the case for measuring
   properly: the candidates are a finite, monotonic ladder of five, so you can
   render all five off-screen at the real column width, measure them once, and
   pick the largest that fits, with no loop anywhere. That would be right about
   wrapped titles, wrapped headings and the current entry's real height, which
   this is only approximately right about. It is not built because it is five
   hidden renders per panel per resize to choose between "three lines" and
   "four", and being wrong by a line is not a failure the reader can see. What
   IS built to make the estimate answerable: the number it picks is written
   onto the panel as `data-ctx-lines`, so a browser check can assert it rather
   than count lines in a screenshot.

   Everything here therefore leans towards **undershooting**. Blank space is
   recoverable and visible; entries pushed off the end of a panel that cannot
   be scrolled are neither.

   **Nothing that moves while the reader scrolls may go in here**, and there
   are two such things, which look like one problem and are not:

    - `window.innerHeight`. On a phone or an iPad the browser's own toolbars
      collapse *as you scroll*, and `innerHeight` grows seventy to a hundred
      pixels while they do — enough to cross a line threshold on a six-item
      level, on the device this app is most meant for (docs/project/touch.md).
      So the caller hands in `100svh`, measured in useColumnContext.ts: the
      *small* viewport, the one with the chrome showing, which by definition
      does not move when the chrome does. GPT Sol's review, 2026-08-26.
    - **The panel's own top edge.** This one bit for real. `ColumnRect.top` is
      the header row's bottom, and that row is sticky under the masthead, so it
      settles over the first hundred and fifty pixels of scroll — its own doc
      comment in useColumnContext.ts says so. A version of this function took
      `stableH - rect.top` as its budget, which fixed the phone and reopened
      the same hole on every desktop: measured in a browser at [L0 2, L1 1] at
      the top of the article and [L0 4, L1 3] two hundred pixels down, so a
      reader arriving at an article and scrolling once watched every landmark
      in two columns rewrap. Hence a **constant** allowance for the bars
      instead of a measured one. It is approximate by design: being fifty
      pixels wrong costs at most a line, and being right only after the reader
      has scrolled costs the rewrap this whole calculation exists to avoid.

   The two are the same mistake wearing different clothes, and fixing one is
   not fixing the other — which is why the second survived the review that
   found the first, and was caught in a browser instead.

   **One discontinuity is left, and it is left on purpose.** `hasCurrent` below
   is read off the entries, and it flips once — at the top of an article, when
   a column that had no item under the focus line gains one (see currentIndex).
   The budget can step down there. That is a real rewrap and it is allowed,
   because the panel is already rearranging itself at that exact moment for a
   much larger reason: `.no-current` drops the lead padding, so the whole list
   moves. Adding a rewrap to a frame that was already changing costs nothing;
   the two cases above added one to frames that were otherwise still. */

/** The open entry: a title, several lines of gist and the range under it. */
const CURRENT_PX = 210;
/** A part heading, with the margin that separates it from the run above. */
const GROUP_PX = 40;
/**
 * A landmark's own padding, and its title — charged as **two lines**, because
 * in an eleven-rem column most section titles wrap and a budget that assumed
 * one would be systematically too generous for exactly the columns with the
 * least room. The arc's landmarks are charged less: their heading is a `3 / 5`
 * step marker, which cannot wrap.
 */
const TITLE_LANDMARK_PX = 40;
const STEP_LANDMARK_PX = 22;
/** One more clamped line of gist, with the margin above the first folded in. */
const LINE_PX = 18;
/**
 * The masthead, the controls bar and the header row above the panel. A
 * constant, deliberately, and not the panel's measured top — see above.
 */
const HEADER_PX = 150;
/**
 * Four lines says what a gist says. Past that a landmark stops being a
 * landmark and the column has two things competing to be read.
 */
const MAX_LINES = 4;
/** Leave a little room rather than filling the panel to its last pixel. */
const FILL = 0.9;

/**
 * How many lines of gist each landmark in this list gets — 0 for a level too
 * long to afford any, which is the title-only column this replaced.
 *
 * `stableH` is `100svh` — see LiveContext.stableH, and the note above on why
 * neither `window.innerHeight` nor the panel's own measured height will do.
 */
export function landmarkLines(entries: ContextEntry[], stableH: number): number {
  let groups = 0;
  let items = 0;
  let hasCurrent = false;
  let arc = false;
  for (const e of entries) {
    if (e.kind === "group") groups += 1;
    else {
      items += 1;
      if (e.tier === "cur") hasCurrent = true;
      if (e.item.step) arc = true;
    }
  }
  // A level with no item under the focus line (see currentIndex above) has no
  // open entry and one more landmark. Counted honestly rather than left to
  // cancel: `place` pins such a panel at scrollTop 0 and the panel cannot be
  // scrolled, so what an over-generous budget pushes off the foot is simply
  // gone, with nothing to see and nothing to error.
  const landmarks = hasCurrent ? items - 1 : items;
  if (landmarks <= 0) return 0;
  const perLandmark = arc ? STEP_LANDMARK_PX : TITLE_LANDMARK_PX;
  const spare =
    (stableH - HEADER_PX) * FILL -
    (hasCurrent ? CURRENT_PX : 0) -
    groups * GROUP_PX -
    landmarks * perLandmark;
  if (spare <= 0) return 0;
  return Math.min(MAX_LINES, Math.floor(spare / (landmarks * LINE_PX)));
}
