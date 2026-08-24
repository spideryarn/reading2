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
import type { Block, BlockId, NodeId, Tree, TreeNode } from "../types.js";

export interface Cell {
  node: TreeNode;
  rowSpan: number;
  /** True when the branch bottomed out above this column, so the node repeats. */
  continuation: boolean;
}

export interface Geometry {
  /** Column depths, e.g. [1, 2] — the gist columns, left (coarse) to right. */
  columnDepths: number[];
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

  // Deepest node anywhere in the tree. The last depth is the leaf level, which
  // the table renders as verbatim text rather than as a gist column.
  const maxDepth = Math.max(...Object.values(tree.nodes).map((n) => n.depth));
  const columnDepths = Array.from({ length: Math.max(0, maxDepth - 1) }, (_, i) => i + 1);

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

  return { columnDepths, cells, cellAt, chains };
}

/** Human label for a gist column. */
export function columnLabel(depth: number, columnDepths: number[]): string {
  if (depth === columnDepths[0]) return "Parts";
  if (depth === columnDepths[columnDepths.length - 1]) return "Sections";
  return `Level ${depth}`;
}
