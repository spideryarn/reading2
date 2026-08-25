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
 * > shows what came before and what after.
 *
 * Four modes, side by side, so they can be compared rather than argued about —
 * see docs/project/column-context.md for what each one is and the research
 * behind it. This file decides *what* each mode lists; TableView.tsx and
 * ContextPanel.tsx decide where and how it is drawn.
 *
 * Two rules from that research are enforced here rather than left to the
 * renderer, because they are the design:
 *
 *  - **Discrete tiers, never a gradient.** An entry is `cur`, `near`, `mid` or
 *    `far`. Continuous fisheye scaling puts prose in a just-legible dead zone,
 *    and eye-tracking says nobody reads the shrunk periphery anyway — it is a
 *    landmark, so it only needs to be *distinguishable*, not smoothly scaled.
 *  - **Distance is measured in the tree, not in pixels.** "Near" means a
 *    sibling next door; a section in a different part is far even when it is
 *    the next row down. That is Furnas's degree-of-interest with the outline's
 *    own levels as the importance score.
 *
 * Everything addresses position by row index and block id, never by node id
 * in a URL and never by comparing id strings (docs/project/block-ids.md).
 */
import type { BlockId, NodeId, TreeNode } from "../types.js";
import type { Cell } from "./tree.js";
import { itemStarts } from "./keynav.js";

/** The three column treatments and the off state. `?ctx=` holds one of these. */
export const CONTEXT_MODES = ["off", "siblings", "neighbours", "panel", "centred"] as const;
export type ContextMode = (typeof CONTEXT_MODES)[number];

export function isContextMode(value: string): value is ContextMode {
  return (CONTEXT_MODES as readonly string[]).includes(value);
}

/** The modes drawn inside the table's own cells, as opposed to a hoisted panel. */
export function isInCell(mode: ContextMode): boolean {
  return mode === "siblings" || mode === "neighbours";
}
export function isPanel(mode: ContextMode): boolean {
  return mode === "panel" || mode === "centred";
}

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
  /** The arc column's step marker, in place of a title. */
  step?: string;
}

export interface ContextEntry {
  /** A `group` is a heading for the parent an item belongs to — never clickable content. */
  kind: "item" | "group";
  item: ContextItem;
  /** Index into the column's items (items only). */
  index: number;
  tier: Tier;
  /** Already read: before the current item in document order. */
  before: boolean;
}

/**
 * Items for a gist column, from its cells, with the row each one starts on.
 *
 * **Continuation cells are not items.** A continuation is a cell whose branch
 * bottomed out above this column (tree.ts), so the node it repeats belongs to
 * a shallower level: listing it here would put a leaf among the sections, and
 * in an unbalanced tree it can sit *between* two real siblings and break the
 * contiguous-run assumption siblingList relies on. TableView draws no sticky
 * content for a continuation either, so while one is under the reading line
 * no cell is current and every mode draws plain — which is right: there is
 * nothing at this level to be inside.
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
 * Which item contains `row`: the last one starting at or before it.
 *
 * Clamps to 0 above the first start, for the same reason activeSectionIndex
 * does — there is always an item you are in.
 */
export function currentIndex(starts: number[], row: number): number {
  let cur = 0;
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
 * with the same words.
 */
function groupParent(
  item: ContextItem,
  nodes: Record<NodeId, TreeNode>,
): TreeNode | null {
  const parent = item.node.parent === null ? undefined : nodes[item.node.parent];
  return parent && parent.depth >= 1 ? parent : null;
}

function groupEntry(node: TreeNode, index: number, before: boolean): ContextEntry {
  return {
    kind: "group",
    item: { node, blockId: node.range[0] },
    index,
    tier: "far",
    before,
  };
}

/**
 * Siblings mode: the current item's siblings only, with the neighbouring
 * *parents* named as group markers at either end so the list says what lies
 * beyond it without listing it.
 *
 * "Sibling" is read off the items' parents — a contiguous run around `cur`,
 * because children exactly partition their parent, so the run can never be
 * interrupted by a stranger. At L1 the parent is the root, so every part is a
 * sibling and there are no group markers: the whole level fits in a viewport
 * and that is the list the research favours.
 */
export function siblingList(
  items: ContextItem[],
  cur: number,
  nodes: Record<NodeId, TreeNode>,
): ContextEntry[] {
  const current = items[cur];
  if (!current) return [];
  const parentId = current.node.parent;
  let first = cur;
  while (first > 0 && items[first - 1]?.node.parent === parentId) first--;
  let last = cur;
  while (last < items.length - 1 && items[last + 1]?.node.parent === parentId) last++;

  const out: ContextEntry[] = [];
  const prevItem = items[first - 1];
  const prevGroup = prevItem && groupParent(prevItem, nodes);
  if (prevGroup) out.push(groupEntry(prevGroup, first - 1, true));
  for (let i = first; i <= last; i++) {
    out.push({
      kind: "item",
      item: items[i]!,
      index: i,
      tier: tierByDistance(Math.abs(i - cur)),
      before: i < cur,
    });
  }
  const nextItem = items[last + 1];
  const nextGroup = nextItem && groupParent(nextItem, nodes);
  if (nextGroup) out.push(groupEntry(nextGroup, last + 1, false));
  return out;
}

/**
 * Panel modes: the whole level, with a group heading wherever the parent
 * changes. Tiers step with plain distance along the level, because the panel
 * shows everything and needs the eye led to the middle of it — the tree
 * distance is carried by the headings instead.
 */
export function levelList(
  items: ContextItem[],
  cur: number,
  nodes: Record<NodeId, TreeNode>,
): ContextEntry[] {
  const out: ContextEntry[] = [];
  let lastParent: NodeId | null | undefined;
  items.forEach((item, i) => {
    if (item.node.parent !== lastParent) {
      lastParent = item.node.parent;
      const group = groupParent(item, nodes);
      if (group) out.push(groupEntry(group, i, i < cur));
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

/** Neighbours mode: just the items either side, whatever their parent. */
export function neighbours(
  items: ContextItem[],
  cur: number,
): { prev: ContextItem | null; next: ContextItem | null } {
  return { prev: items[cur - 1] ?? null, next: items[cur + 1] ?? null };
}
