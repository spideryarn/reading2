/**
 * The mechanical scores of one finished tree. Plan 261005j § Stage 2.
 *
 * Every one of these can be won by a worse tree (a tree of one part per
 * heading scores perfectly on headings), so they are screens beside the blind
 * judge, not the outcome.
 */
import { MAX_BATCH, unaskableBatches } from "../../src/labels.js";
import { supplementIndex } from "../../src/supplement.js";
import { checkTree } from "../../src/tree-invariants.js";
import type { Block, Tree, TreeNode } from "../../src/types.js";

export interface TreeScore {
  parts: number;
  sections: number;
  /** Parts whose children are paragraphs. */
  partsWithNoSections: number;
  /** Internal body nodes with no gist. */
  internalWithoutGist: number;
  checkTreeProblems: number;
  /** Heading blocks in the body, and how many of them start an internal node. */
  headingBlocks: number;
  headingsStartingANode: number | "n/a";
  /** Top-level starts after the first that fall on a heading block. `n/a` for a document with no heading. */
  topLevelSeams: number;
  seamsOnHeadings: number | "n/a";
  /** Lowest internal nodes holding more blocks than one labels batch (`MAX_BATCH`). */
  childlessOverBatch: number;
  largestChildless: number;
  /** Sibling sets the labels pass could not ask about. */
  unaskableLabelBatches: number;
  /** Where each part starts, as an index into the body: for comparing two runs. */
  topStarts: number[];
}

export function scoreTree(blocks: Block[], body: readonly Block[], tree: Tree): TreeScore {
  const index = new Map(body.map((b, i) => [b.id, i]));
  const supplement = supplementIndex(tree);
  const nodes = Object.values(tree.nodes).filter((n) => !supplement.has(n.id));
  const internal = nodes.filter((n) => n.children.length > 0);
  const root = tree.nodes[tree.rootId]!;
  const parts = root.children.map((id) => tree.nodes[id]!).filter((n) => !supplement.has(n.id) && n.children.length > 0);
  const lowest = internal.filter((n) => n.depth > 0 && n.children.every((id) => tree.nodes[id]!.children.length === 0));
  const size = (n: TreeNode): number => (index.get(n.range[1]) ?? 0) - (index.get(n.range[0]) ?? 0) + 1;
  const headings = body.filter((b) => b.kind === "heading");
  const internalStarts = new Set(internal.filter((n) => n.depth > 0).map((n) => n.range[0]));
  const seams = parts.slice(1).map((p) => p.range[0]);
  const headingIds = new Set(headings.map((b) => b.id));
  return {
    parts: parts.length,
    sections: internal.filter((n) => n.depth === 2).length,
    partsWithNoSections: parts.filter((p) => p.children.every((id) => tree.nodes[id]!.children.length === 0)).length,
    internalWithoutGist: internal.filter((n) => !n.gist?.trim()).length,
    checkTreeProblems: checkTree(blocks, tree).problems.length,
    headingBlocks: headings.length,
    headingsStartingANode: headings.length === 0 ? "n/a" : headings.filter((b) => internalStarts.has(b.id)).length,
    topLevelSeams: seams.length,
    seamsOnHeadings: headings.length === 0 ? "n/a" : seams.filter((id) => headingIds.has(id)).length,
    childlessOverBatch: lowest.filter((n) => size(n) > MAX_BATCH).length,
    largestChildless: lowest.reduce((a, n) => Math.max(a, size(n)), 0),
    unaskableLabelBatches: unaskableBatches(tree, blocks).length,
    topStarts: parts.map((p) => index.get(p.range[0]) ?? -1),
  };
}

/** How alike two runs' top levels are: starts in both, over starts in either. 1 is identical. */
export function topStability(a: readonly number[], b: readonly number[]): { shared: number; either: number; jaccard: number } {
  const A = new Set(a);
  const B = new Set(b);
  const shared = [...A].filter((x) => B.has(x)).length;
  const either = new Set([...A, ...B]).size;
  return { shared, either, jaccard: either === 0 ? 1 : shared / either };
}
