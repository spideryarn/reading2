/**
 * Turning the tree into table geometry.
 *
 * The tabular view is Greg's original framing (2026-08-24):
 *
 * > up-down is chronology in the document and left-right is granularity, with a
 * > column for each level of the table of contents
 *
 * Because every node covers a contiguous range and a node's children exactly
 * partition it (granularity-zoom.md#the-tree), that maps onto an HTML table with
 * `rowSpan` and nothing more clever: one row per block, one column per depth, and
 * an ancestor cell simply spans the rows of its range. Vertical position is then
 * automatically the same at every level of granularity, which is the invariant
 * the whole feature rests on.
 */
import type { Arc, Block, BlockId, NodeId, Tree, TreeNode } from "../types.js";

export interface Cell {
  node: TreeNode;
  rowSpan: number;
  /** True when the branch bottomed out above this column, so the node repeats. */
  continuation: boolean;
}

export interface Geometry {
  /** Every column depth, 0 (whole article) … maxDepth (the leaves). */
  columnDepths: number[];
  /** The deepest depth — the leaf column, which renders navLabels, not gists. */
  leafDepth: number;
  /** cells[columnIndex] → the cells in that column, in document order. */
  cells: Cell[][];
  /** cells keyed by "depth:rowIndex" for the row where each cell starts. */
  cellAt: Map<string, Cell>;
  /** Root-to-leaf node ids for each row index. */
  chains: NodeId[][];
}

/** Descend from the root, following the child whose range contains each block. */
function buildChains(tree: Tree, blocks: Block[]): NodeId[][] {
  const order = new Map<BlockId, number>(blocks.map((b, i) => [b.id, i]));

  // Ids are random, so a range is resolved by looking both endpoints up in the
  // block sequence — never by comparing the id strings, which would return a
  // plausible and meaningless boolean. See docs/project/block-ids.md.
  // An unresolvable range yields null and the node is skipped, so a malformed
  // tree renders visibly short rather than silently claiming the whole article.
  const spanOf = (n: TreeNode): [number, number] | null => {
    const lo = order.get(n.range[0]);
    const hi = order.get(n.range[1]);
    return lo === undefined || hi === undefined || lo > hi ? null : [lo, hi];
  };

  return blocks.map((_, i) => {
    const chain: NodeId[] = [];
    let node: TreeNode | undefined = tree.nodes[tree.rootId];
    while (node) {
      chain.push(node.id);
      const next: TreeNode | undefined = node.children
        .map((id) => tree.nodes[id])
        .find((c) => {
          if (!c) return false;
          const span = spanOf(c);
          return span !== null && i >= span[0] && i <= span[1];
        });
      node = next;
    }
    return chain;
  });
}

export function buildGeometry(tree: Tree, blocks: Block[]): Geometry {
  const chains = buildChains(tree, blocks);

  // Columns run from 0 (one cell: the whole article) to maxDepth (the leaves).
  // Depth 0 earns a column because otherwise the coarsest thing on screen is
  // the parts list, and there is no single place that says what the piece is.
  // The leaf column carries navLabels rather than gists, so it is only shown in
  // outline mode — see TableView.
  const maxDepth = Math.max(...Object.values(tree.nodes).map((n) => n.depth));
  const columnDepths = Array.from({ length: maxDepth + 1 }, (_, i) => i);

  const cells: Cell[][] = [];
  const cellAt = new Map<string, Cell>();

  for (const depth of columnDepths) {
    const column: Cell[] = [];
    // A block whose branch is shallower than this column reuses its deepest
    // node; we mark that as a continuation so the text isn't repeated.
    const nodeFor = (row: number) => {
      const chain = chains[row];
      const id = chain[Math.min(depth, chain.length - 1)];
      return { node: tree.nodes[id], continuation: depth > chain.length - 1 };
    };

    let row = 0;
    while (row < blocks.length) {
      const { node, continuation } = nodeFor(row);
      let end = row + 1;
      while (end < blocks.length && nodeFor(end).node?.id === node?.id) end++;
      if (node) {
        const cell: Cell = { node, rowSpan: end - row, continuation };
        column.push(cell);
        cellAt.set(`${depth}:${row}`, cell);
      }
      row = end;
    }
    cells.push(column);
  }

  return { columnDepths, leafDepth: maxDepth, cells, cellAt, chains };
}

/** Human label for a column. `hasArc` renames L0, which stops being the root. */
export function columnLabel(depth: number, leafDepth: number, hasArc = false): string {
  if (depth === leafDepth) return "Paragraphs";
  switch (depth) {
    case 0: return hasArc ? "The argument" : "Article";
    case 1: return "Parts";
    case 2: return "Sections";
    default: return `Level ${depth}`;
  }
}

/* -------------------------------------------------------------- the arc --
   What the L0 column renders once stage 5b has run (src/arc.ts).

   Rendering the root there made the column a single cell spanning the whole
   article — a constant on an axis that means "this changes as you move down
   the page", duplicating the masthead and costing 240px to do it. The arc
   replaces it with one sentence per part saying where the argument stands,
   which is the only content that is both article-level and vertically varying.
   See granularity-zoom.md#the-arc. */

export interface ArcCell {
  /** The part this sits against. Boundaries are L1's, exactly. */
  node: TreeNode;
  rowSpan: number;
  /** Absent when no arc entry matched this part — draws empty, never borrowed. */
  text?: string;
  /** 1-based position among the parts, for the step marker. */
  index: number;
  total: number;
}

/**
 * The arc column, keyed by the row each cell starts on.
 *
 * Built from the L1 column's own cells, so the two columns share boundaries by
 * construction rather than by two walks of the tree agreeing. **Every part gets
 * a cell**, even one the arc has no sentence for: a missing `<td>` does not
 * leave a gap in an HTML table, it shifts every later cell in the row one
 * column left, so the whole view would silently misalign.
 *
 * Entries are matched to parts by block range, never by node id — ids are
 * positional and a re-run of `npm run toc` renumbers them, which would quietly
 * hand each sentence to its neighbour. An unmatched entry is dropped.
 */
export function buildArcColumn(
  geometry: Geometry,
  arc: Arc | undefined,
): Map<number, ArcCell> | null {
  const parts = geometry.cells[1];
  if (!arc || !parts?.length) return null;

  const byRange = new Map(arc.entries.map((e) => [`${e.range[0]}|${e.range[1]}`, e.text]));
  const out = new Map<number, ArcCell>();
  let row = 0;
  parts.forEach((cell, i) => {
    const key = `${cell.node.range[0]}|${cell.node.range[1]}`;
    out.set(row, {
      node: cell.node,
      rowSpan: cell.rowSpan,
      index: i + 1,
      total: parts.length,
      ...(byRange.has(key) ? { text: byRange.get(key) } : {}),
    });
    row += cell.rowSpan;
  });
  return out;
}

/* -------------------------------------------------------------- the spine --
   The bird's-eye rail down the far left renders the top of the tree — L1, and
   L2 nested inside it — as one always-visible picture of the whole article.
   Greg, 2026-08-25:

   > I want the left-hand most column to show a bird's eye view … I need a way
   > to see where I am in the whole article.

   That "where I am" is what forces it out of the table. A table column is
   correct for *chronology beside prose*, but a whole-article overview cannot
   live in one, because consecutive entries are thousands of pixels apart: you
   can only ever see the one you are standing in. So the spine is a separate,
   viewport-height rail — see Spine.tsx, and granularity-zoom.md#the-spine-a-birds-eye-rail. */

export interface OutlineEntry {
  node: TreeNode;
  /** Row indices into `blocks`, inclusive at both ends. */
  startRow: number;
  endRow: number;
  words: number;
  children: OutlineEntry[];
}

/**
 * The first `depthLimit` levels below the root, with row extents and word
 * counts. Word counts are a fallback only — the spine sizes its segments from
 * measured pixel heights so that it is a true minimap (see Spine.tsx) — but
 * they are the right thing to fall back to before the first measurement, and
 * they are cheap.
 */
export function buildOutline(
  tree: Tree,
  blocks: Block[],
  depthLimit = 2,
): OutlineEntry[] {
  const order = new Map<BlockId, number>(blocks.map((b, i) => [b.id, i]));

  const entryFor = (node: TreeNode | undefined): OutlineEntry | null => {
    if (!node) return null;
    // Index lookup, never string comparison — block ids carry no order.
    const startRow = order.get(node.range[0]);
    const endRow = order.get(node.range[1]);
    if (startRow === undefined || endRow === undefined || startRow > endRow) {
      return null;
    }
    let words = 0;
    for (let i = startRow; i <= endRow; i++) words += blocks[i]?.words ?? 0;
    const children =
      node.depth < depthLimit
        ? node.children
            .map((id) => entryFor(tree.nodes[id]))
            .filter((e): e is OutlineEntry => e !== null)
        : [];
    return { node, startRow, endRow, words, children };
  };

  const root = tree.nodes[tree.rootId];
  return (root?.children ?? [])
    .map((id) => entryFor(tree.nodes[id]))
    .filter((e): e is OutlineEntry => e !== null);
}
