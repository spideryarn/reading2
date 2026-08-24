/**
 * Derive the flat, document-order row list from a tree.
 *
 *   npm run toc:flatten -- example/tree.json [maxDepth]
 *
 * This is the shape Greg originally described the ToC in — one row per entry,
 * each anchored to a block id. We store the tree and derive this, rather than
 * the reverse, because flattening is lossless and reconstruction is not: a
 * start-only row carries no extent, so every consumer would have to re-infer
 * where a section ends, and that inference breaks on ragged heading levels.
 * See docs/project/table-of-contents.md.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Tree, TreeNode } from "./types.js";

export interface TocRow {
  depth: number;
  /**
   * What the sidebar renders. Short `title` on internal nodes, longer
   * `navLabel` on leaves — the entry-length rule, expressed by which field the
   * node carries rather than by one field changing size with depth.
   */
  label: string;
  /** Block id this row points at — where clicking it should scroll to. */
  startsAt: string;
  /** Last block this row covers. Absent from the original row model; see the doc. */
  endsAt: string;
  /** The author's own heading text, when a real heading is behind this row. */
  sourceHeading?: string;
  hasChildren: boolean;
}

/**
 * Depth-first, document order — the order rows appear in the sidebar.
 */
export function flattenTree(tree: Tree, options: { maxDepth?: number } = {}): TocRow[] {
  const { maxDepth = Infinity } = options;
  const rows: TocRow[] = [];

  const visit = (node: TreeNode | undefined) => {
    if (!node || node.depth > maxDepth) return;

    // A leaf with no navLabel is deliberate, not missing: media, rules and
    // captions are tiled by the tree but must never appear as a row.
    const label = node.children.length === 0 ? node.navLabel : node.title;
    if (label) {
      rows.push({
        depth: node.depth,
        label,
        startsAt: node.range[0],
        endsAt: node.range[1],
        ...(node.sourceHeading !== undefined ? { sourceHeading: node.sourceHeading } : {}),
        hasChildren: node.children.length > 0,
      });
    }

    // `children` is already in document order — validate-tree.ts fails the tree
    // if it isn't, so this walk can trust it.
    for (const id of node.children) visit(tree.nodes[id]);
  };

  visit(tree.nodes[tree.rootId]);
  return rows;
}

// ---------------------------------------------------------------- CLI

// Kept out of module scope deliberately — top-level `await` makes this an async
// module, which a CommonJS consumer then cannot require.
async function main(): Promise<void> {
  const treePath = process.argv[2];
  if (!treePath) {
    console.error("Usage: tsx src/toc-flatten.ts <tree.json> [maxDepth]");
    process.exit(1);
  }
  const maxDepth = process.argv[3] ? Number(process.argv[3]) : undefined;
  const tree: Tree = JSON.parse(await readFile(treePath, "utf-8"));
  const rows = flattenTree(tree, { maxDepth });

  for (const r of rows) {
    const marker = r.hasChildren ? "▸" : " ";
    console.log(`${"  ".repeat(r.depth)}${marker} ${r.label}  [${r.startsAt}…${r.endsAt}]`);
  }
  console.log(`\n${rows.length} rows`);
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) void main();
