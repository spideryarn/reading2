/**
 * What one structure tree did with the optional fourth level — plan 261029a §
 * Stage 2's measures, as pure functions over a tree and its body blocks, so the
 * test (tests/structure-fourth-level-eval.test.ts) can hold them to hand-made
 * trees before any paid run is read through them.
 *
 * **Tag-based, so diagnostics, not gates** (GPT Sol, plan review, 3): the
 * extractor's `<hN>` levels are sometimes wrong — the report's paper tags
 * "2.4.5(a)" as h2 inside an h3 section — so a count over tags can be wrong in
 * both directions on such an article. The one hand-annotated gate is the
 * paper's, in report.ts. The run-level counts (`subsections`,
 * `deepenedSections`, `swallowedHeadings`) are production's own,
 * src/structure-depth.ts, not a copy.
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
  /**
   * Sub-sections that start at a heading as coarse as the one their section
   * starts with: a section-level heading pushed down a level.
   */
  demotedHeadings: number;
  /**
   * The author's next level down inside each section (the shallowest heading
   * level deeper than the section's own): how many such headings there are, and
   * how many start a sub-section.
   */
  subheadings: { expected: number; hit: number };
  /**
   * Sections the author's next level divides into at least two sub-sections:
   * two such headings, or one with prose of the section's own before it.
   */
  headedSections: number;
  /** Of those, the ones left undivided. */
  undividedHeadedSections: number;
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

/**
 * The author's next level down strictly inside [lo, hi]: headings at the
 * shallowest level deeper than the heading at lo (any level, if lo is none).
 */
function nextLevelInside(blocks: readonly Block[], lo: number, hi: number): number[] {
  const own = headingLevel(blocks[lo]!);
  const deeper: { at: number; level: number }[] = [];
  for (let i = lo + 1; i <= hi; i++) {
    const level = headingLevel(blocks[i]!);
    if (level !== null && (own === null || level > own)) deeper.push({ at: i, level });
  }
  if (deeper.length === 0) return [];
  const next = Math.min(...deeper.map((d) => d.level));
  return deeper.filter((d) => d.level === next).map((d) => d.at);
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
    demotedHeadings: 0,
    subheadings: { expected: 0, hit: 0 },
    headedSections: 0,
    undividedHeadedSections: 0,
    openings: { own: 0, folded: 0, none: 0 },
  };

  for (const section of sections) scoreSection(section);
  return score;

  function scoreSection(section: TreeNode): void {
    const [lo, hi] = rangeOf(section, index);
    const own = headingLevel(body[lo]!);
    const next = nextLevelInside(body, lo, hi);
    const subs = internalChildren(section);
    const subStarts = new Set(subs.map((s) => rangeOf(s, index)[0]));
    /* Prose before the first sub-heading: anything between the section's own
       first block (its heading, when it has one) and that sub-heading. */
    const openingStart = own !== null ? lo + 1 : lo;
    const firstNext = next[0];
    const opening = firstNext !== undefined && firstNext > openingStart;

    score.subheadings.expected += next.length;
    score.subheadings.hit += next.filter((at) => subStarts.has(at)).length;
    if (next.length >= 2 || (next.length === 1 && opening)) {
      score.headedSections += 1;
      if (subs.length === 0) score.undividedHeadedSections += 1;
    }
    if (subs.length === 0) return;

    const size = hi - lo + 1;
    subs.forEach((sub, k) => {
      const [start] = rangeOf(sub, index);
      const level = headingLevel(body[start]!);
      if (k > 0 && own !== null && level !== null && level <= own) score.demotedHeadings += 1;
      if (k === 0) return;
      if (level !== null) score.headingSplits += 1;
      else {
        score.inventedSplits += 1;
        if (size < SHORT_SECTION_BLOCKS) score.shortInventedSplits += 1;
      }
    });

    if (firstNext === undefined) return; // divided at invented joins only: no author opening to judge
    const [, firstHi] = rangeOf(subs[0]!, index);
    if (!opening) score.openings.none += 1;
    else if (firstNext <= firstHi) score.openings.folded += 1;
    else score.openings.own += 1;
  }
}
