/**
 * A block's section path through the hierarchy tree, shared by the Skim
 * prompt and its client band. This module is deliberately pure: browser code
 * can import it without pulling in the model runner or `node:crypto` from
 * `skim.ts`.
 */
import type { Block, Tree, TreeNode } from "./types.js";

/** Block id → article position. Build once when resolving several blocks. */
export function blockIndex(blocks: readonly Block[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const [i, block] of blocks.entries()) index.set(block.id, i);
  return index;
}

/**
 * The titles of the non-root ancestors of the leaf that holds `blockId`.
 * In a flat tree, where the leaf hangs directly off the root, the leaf's own
 * title is the useful path. Returns `[]` when the tree does not cover the block.
 *
 * Ranges are resolved by block position, never by comparing id strings
 * (docs/project/block-ids.md).
 */
export function sectionPathOf(
  blockId: string,
  index: ReadonlyMap<string, number>,
  tree: Tree,
): string[] {
  return sectionNodesOf(blockId, index, tree).map((node) => node.title);
}

/** `sectionPathOf`'s nodes rather than their titles — for a rule that needs where a section sits. */
export function sectionNodesOf(
  blockId: string,
  index: ReadonlyMap<string, number>,
  tree: Tree,
): TreeNode[] {
  const at = index.get(blockId);
  if (at === undefined) return [];
  const contains = (node: TreeNode): boolean => {
    const lo = index.get(node.range[0]);
    const hi = index.get(node.range[1]);
    return lo !== undefined && hi !== undefined && lo <= at && at <= hi;
  };
  const path: TreeNode[] = [];
  let node = tree.nodes[tree.rootId];
  while (node && node.children.length > 0) {
    const next = node.children.map((id) => tree.nodes[id]).find((child) => child && contains(child));
    if (!next) break;
    path.push(next);
    node = next;
  }
  if (path.length === 0) return [];
  const leaf = path.at(-1)!;
  const ancestors = leaf.children.length === 0 ? path.slice(0, -1) : path;
  return ancestors.length > 0 ? ancestors : [leaf];
}
