/**
 * What one structure tree did with the optional fourth level — plan 261029a §
 * Stage 2's measures, as pure functions over a tree and its body blocks, so the
 * test (tests/structure-fourth-level-eval.test.ts) can hold them to hand-made
 * trees before any paid run is read through them.
 *
 * The run-level counts (`subsections`, `deepenedSections`, `swallowedHeadings`)
 * are production's own, src/structure-depth.ts, not a copy.
 */
import { headingLevel } from "../../src/section-ranges.js";
import { depthCounts, SUBSECTION_DEPTH, type DepthCounts } from "../../src/structure-depth.js";
import { isSupplementNode } from "../../src/supplement.js";
import type { Block, Tree, TreeNode } from "../../src/types.js";

/** Plan 261029a: a model may not split a section shorter than this at a join it invented. */
export const SHORT_SECTION_BLOCKS = 10;

export interface TreeScore extends DepthCounts {
  sections: number;
  /** Sub-section starts (after the first) at an author heading. */
  headingSplits: number;
  /** Sub-section starts (after the first) at a block that is not a heading: joins the model chose. */
  inventedSplits: number;
  /** Invented splits inside a section of fewer than `SHORT_SECTION_BLOCKS` blocks. Target: 0. */
  shortInventedSplits: number;
  /** Sections holding two or more author headings deeper than their own first heading, not divided. */
  undividedHeadedSections: number;
  /** Sections the author's sub-headings divide (two or more deeper headings inside). */
  headedSections: number;
  /** Deepened sections with only one sub-section. */
  singleSubsection: number;
  /**
   * How a deepened section's first sub-section treats the prose before the
   * author's first sub-heading: `own` — the opening is a sub-section of its own
   * (the first sub-heading starts the second); `folded` — the first sub-heading
   * sits inside the first sub-section; `none` — no prose comes before it.
   */
  openings: { own: number; folded: number; none: number };
}

function rangeOf(node: TreeNode, index: Map<string, number>): [number, number] {
  const lo = index.get(node.range[0]);
  const hi = index.get(node.range[1]);
  if (lo === undefined || hi === undefined) throw new Error(`node ${node.id} names a block not in the body`);
  return [lo, hi];
}

/** Author headings strictly inside [lo, hi] that are deeper than the heading at lo (or any heading, if lo is none). */
function deeperHeadingsInside(blocks: readonly Block[], lo: number, hi: number): number[] {
  const own = headingLevel(blocks[lo]!);
  const out: number[] = [];
  for (let i = lo + 1; i <= hi; i++) {
    const level = headingLevel(blocks[i]!);
    if (level !== null && (own === null || level > own)) out.push(i);
  }
  return out;
}

export function scoreTree(tree: Tree, body: readonly Block[]): TreeScore {
  const index = new Map(body.map((b, i) => [b.id, i]));
  const nodes = Object.values(tree.nodes).filter((n) => !isSupplementNode(n));
  const internalChildren = (n: TreeNode): TreeNode[] =>
    n.children.map((id) => tree.nodes[id]!).filter((c) => c.children.length > 0);
  const sections = nodes.filter((n) => n.depth === SUBSECTION_DEPTH - 1 && n.children.length > 0);

  const score: TreeScore = {
    ...depthCounts(tree, body),
    sections: sections.length,
    headingSplits: 0,
    inventedSplits: 0,
    shortInventedSplits: 0,
    undividedHeadedSections: 0,
    headedSections: 0,
    singleSubsection: 0,
    openings: { own: 0, folded: 0, none: 0 },
  };

  for (const section of sections) scoreSection(section);
  return score;

  function scoreSection(section: TreeNode): void {
    const [lo, hi] = rangeOf(section, index);
    const deeper = deeperHeadingsInside(body, lo, hi);
    const subs = internalChildren(section);
    if (deeper.length >= 2) {
      score.headedSections += 1;
      if (subs.length === 0) score.undividedHeadedSections += 1;
    }
    if (subs.length === 0) return;
    if (subs.length === 1) score.singleSubsection += 1;
    const size = hi - lo + 1;
    subs.forEach((sub, k) => {
      if (k === 0) return;
      const [start] = rangeOf(sub, index);
      if (headingLevel(body[start]!) !== null) score.headingSplits += 1;
      else {
        score.inventedSplits += 1;
        if (size < SHORT_SECTION_BLOCKS) score.shortInventedSplits += 1;
      }
    });
    const firstDeeper = deeper[0];
    const [, firstHi] = rangeOf(subs[0]!, index);
    /* Prose before the first sub-heading: anything between the section's own
       first block (its heading, when it has one) and that sub-heading. */
    const openingStart = headingLevel(body[lo]!) !== null ? lo + 1 : lo;
    if (firstDeeper === undefined) return; // divided at invented joins only: no author opening to judge
    if (firstDeeper <= openingStart) score.openings.none += 1;
    else if (firstDeeper <= firstHi) score.openings.folded += 1;
    else score.openings.own += 1;
  }
}
