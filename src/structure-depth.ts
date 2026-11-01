/**
 * **Two counts about how deep a structure tree went, and whether it kept the
 * author's headings** — read off a finished tree, never off a model's answer.
 *
 * - `subsections`: internal nodes at depth 3, the optional fourth level `toc/14`
 *   lets a section have where the author's sub-headings divide it or a long
 *   section shifts topic. `deepenedSections` is how many sections hold them.
 * - `swallowedHeadings`: author headings that sit **inside** a node whose own
 *   first block is a heading of the same level or a deeper one — "2.5
 *   Indicators" left inside the model's "2.4", the shape plan 261029a found in
 *   26 of 67 production articles. Each heading counts once, however many
 *   ancestors it is inside. An upper bound on mistakes, not a count of them: a
 *   model may merge two very short headed stretches on purpose.
 *
 * Both go on the structure run (src/structure.ts § `StructureRun`) so a prompt
 * that stops making the level, or starts swallowing headings, shows up in the
 * step's log rather than only in an eval; and the eval
 * (evals/structure-fourth-level/) reads the same functions, so the two cannot
 * count differently. Supplement nodes are skipped: the apparatus is never shown
 * to the structure model. docs/plans/261029a-structure-one-level-deeper.md § Stage 2.
 */
import { headingLevel } from "./section-ranges.js";
import { isSupplementNode } from "./supplement.js";
import type { Block, Tree, TreeNode } from "./types.js";

/** The depth of a sub-section: root 0, part 1, section 2. */
export const SUBSECTION_DEPTH = 3;

export interface DepthCounts {
  subsections: number;
  deepenedSections: number;
  swallowedHeadings: number;
}

function internalNodes(tree: Tree): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (id: string): void => {
    const node = tree.nodes[id];
    if (node === undefined || node.children.length === 0 || isSupplementNode(node)) return;
    out.push(node);
    for (const child of node.children) walk(child);
  };
  walk(tree.rootId);
  return out;
}

export function depthCounts(tree: Tree, blocks: readonly Block[]): DepthCounts {
  const index = new Map(blocks.map((b, i) => [b.id, i]));
  const internal = internalNodes(tree);
  const subsections = internal.filter((n) => n.depth === SUBSECTION_DEPTH);
  const deepened = new Set(subsections.map((n) => n.parent));

  /* Each heading is judged by the nodes that hold it, deepest first. A heading
     that starts the deepest one is kept, whatever its level: a model's part that
     begins at an h2 and groups several h2 sections swallows nothing. One that
     does not is swallowed when it is as coarse as the heading the nearest holder
     with a heading of its own begins with — nearest, because a sub-section the
     model began at a paragraph says nothing about the level it sits at. */
  const spans = internal
    .filter((n) => n.depth > 0)
    .map((n) => ({ depth: n.depth, lo: index.get(n.range[0]), hi: index.get(n.range[1]) }))
    .filter((s): s is { depth: number; lo: number; hi: number } => s.lo !== undefined && s.hi !== undefined)
    .sort((a, b) => b.depth - a.depth);
  let swallowedHeadings = 0;
  blocks.forEach((block, i) => {
    const level = headingLevel(block);
    if (level === null) return;
    const holders = spans.filter((s) => s.lo <= i && i <= s.hi);
    if (holders.length === 0 || holders[0]!.lo === i) return;
    for (const s of holders) {
      const own = headingLevel(blocks[s.lo]!);
      if (own === null) continue;
      if (level <= own) swallowedHeadings += 1;
      return;
    }
  });
  return { subsections: subsections.length, deepenedSections: deepened.size, swallowedHeadings };
}
