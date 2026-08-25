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
import type { Cell } from "./tree.js";
import { itemStarts } from "./keynav.js";

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
): { items: ContextItem[]; starts: number[] } {
  const allStarts = itemStarts(cells);
  const items: ContextItem[] = [];
  const starts: number[] = [];
  cells.forEach((cell, i) => {
    if (cell.continuation) return;
    const start = allStarts[i] ?? 0;
    const blockId = blockAt(start);
    if (!blockId) return;
    items.push({ node: cell.node, blockId });
    starts.push(start);
  });
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
