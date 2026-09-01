/**
 * **The tree the author's own headings give us for free.** Deterministic, no
 * model, milliseconds — against ~163 seconds and a real bill for the model's.
 *
 * It began as arm zero of the ToC structure eval, the denominator every model
 * arm is read against, and that is still one of its two jobs: an eval that
 * scored model arms against nothing would credit the model for work the
 * headings did for free. **This file is the one implementation of both jobs**,
 * deliberately. If the eval measured one carving and the product shipped
 * another, every number in evals/results/ would describe something nobody
 * reads.
 *
 * What it is worth, measured on 2026-08-30 over seven development documents and
 * five held out (docs/research/260830a-opening-an-article-before-the-toc.md § 2, § 7b):
 *
 * - **6 of 7** have enough headings to carve at all;
 * - **4 of 7** reproduce the model's depth-one carving exactly;
 * - and on a *headingless* article the model is not merely better, it is
 *   unstable — identical input gave 8, 7, 8 and 3 parts across four runs. So
 *   the free tree is weakest exactly where the paid one is least trustworthy,
 *   and strongest where the paid one agrees with it anyway.
 *
 * What it deliberately cannot do, and where that shows up in the measures:
 * - **No gists.** There is nowhere free to get one, so every internal node
 *   trips checkTree's gist rule. scoreTree reports those separately
 *   (`validity.gistProblems`) so the structural questions stay askable.
 * - **No boundaries between headings.** A 40-block run under one heading stays
 *   one section; the model is asked to cut runs longer than ~9 blocks at topic
 *   shifts. Shows up in `fanout` and `parts.balanceCv`.
 * - **A preamble part with a stock title** when the article does not open on a
 *   heading — exactly the label the model is told not to write.
 *
 * ## The section-level rule
 *
 * "Which heading level is the section level" is a real sub-problem, and the
 * naive rule — the shallowest tag that appears more than once — gets
 * fowler-phrenology wrong: it has two h1s (title-ish) and six h2s. So, two
 * rules rather than one:
 *
 * 1. **The section level is the shallowest level with at least three headings,
 *    falling back to at least two, else no sections at all** (flat
 *    root+leaves). Three, because one heading is a title and two is as likely
 *    a title plus an afterword as it is a structure; three of anything is a
 *    series. Headings *shallower* than the section level still cut (a section
 *    must not cross an h1); deeper ones nest one level down, capped at
 *    internal depth 2 to match the shape the prompt asks the model for.
 * 2. **A segment with almost no prose merges into the next one** (the last
 *    merges backwards). Level alone leaves three kinds of stub on this corpus:
 *    the constitution's `h1` title makes a 6-word part before "Overview";
 *    scaling-hypothesis's "Appendix" heading is immediately followed by the
 *    next heading; and its trailing "Backlinks"/"Bibliography" furniture makes
 *    1–7-word parts. A merged segment is titled by the first heading block
 *    anywhere inside it, which is also what stops a heading-less preamble that
 *    merged into its first section wearing the stock preamble title.
 *
 * fowler-phrenology is the rule's honest failure and stays one: every heading
 * sits in the first ten blocks (catalogue front-matter), so merging collapses
 * the carving toward one part and the build falls back to flat. No heading
 * rule can carve that document — which is precisely the case where the model
 * arm earns its money, and why fowler stays in the corpus.
 */

import { isStructural } from "./block-policy.js";
import { appendSupplement, splitBlocks } from "./supplement.js";
import type { Block, NodeId, Tree, TreeNode } from "./types.js";

/** What one build chose, alongside the tree itself. */
export interface HeadingTreeResult {
  tree: Tree;
  /** The heading level used for depth-one cuts, or null when the tree is flat. */
  sectionLevel: number | null;
  /**
   * True when the tree is root + one leaf per block — either no level
   * qualified, or (fowler's case) merging left fewer than two real segments.
   * `sectionLevel` stays non-null in the second case so the two are tellable
   * apart.
   */
  flat: boolean;
  /** Depth-one body parts (0 when flat). */
  parts: number;
}

/**
 * Stamped into `tree.version` / `tree.generator` so nothing mistakes this for a
 * model's work.
 *
 * **Neither field is what tells a consumer this tree is provisional** — nothing
 * in the app branches on `version` or `generator`, they are shown in the
 * metadata panel and otherwise inert. `provisional` on the tree is the load-
 * bearing one; these two are for a human reading `tree.json`.
 */
export const HEADING_TREE_VERSION = "headings/1";
export const HEADING_TREE_GENERATOR = "deterministic-headings";

/** The title a preamble part wears — the one node this arm has no author text for. */
export const PREAMBLE_TITLE = "Before the first heading";

/**
 * A segment whose non-heading prose is under this many words is a stub — a
 * bare title, a heading followed directly by another heading, a "Backlinks"
 * footer — and merges into its neighbour.
 *
 * **20 was fitted to the seven dev documents**, not discovered: it sits
 * between the biggest stub this corpus produces (a 14-word preamble) and the
 * smallest real section, and a different corpus could want a different value.
 * That is why the dev set is frozen (corpus.ts) and why the runner's
 * `--sensitivity` mode reports the carving at 0/10/20/40 — held-out documents
 * judge the rule as it stands, with no re-tuning after seeing them.
 */
export const MIN_SEGMENT_PROSE_WORDS = 20;

function headingLevel(block: Block): number | null {
  if (block.kind !== "heading") return null;
  if (block.level) return block.level;
  const m = /^h([1-6])$/.exec(block.tag);
  return m ? Number(m[1]) : 6;
}

/**
 * The shallowest level with at least `min` headings. Levels are searched
 * shallow-to-deep so an article with three h2s and twenty h3s sections on the
 * h2s, as it should.
 */
function pickLevel(counts: Map<number, number>, min: number): number | null {
  const levels = [...counts.keys()].sort((a, b) => a - b);
  for (const level of levels) if ((counts.get(level) ?? 0) >= min) return level;
  return null;
}

export function buildHeadingTree(
  blocks: Block[],
  slug: string,
  articleTitle?: string,
  /** Override for --sensitivity only; every arm uses the fitted default. */
  stubThreshold: number = MIN_SEGMENT_PROSE_WORDS,
): HeadingTreeResult {
  /* Body only, apparatus appended after — the same order generateHierarchy uses
     (src/hierarchy.ts), so a bibliography can never sit inside a section. */
  const { body, groups } = splitBlocks(blocks);

  const levels = new Map<number, number>();
  for (const b of body) {
    const level = headingLevel(b);
    if (level !== null) levels.set(level, (levels.get(level) ?? 0) + 1);
  }
  const sectionLevel = pickLevel(levels, 3) ?? pickLevel(levels, 2);

  const nodes: Record<NodeId, TreeNode> = {};
  let counter = 0;
  const nextId = (): NodeId => `n${String(++counter).padStart(4, "0")}`;

  const addNode = (node: TreeNode): TreeNode => {
    nodes[node.id] = node;
    return node;
  };

  /** Grow one leaf per block of [lo, hi] under `parent`. Heading leaves carry their own text as navLabel. */
  const growLeaves = (parent: TreeNode, lo: number, hi: number): void => {
    for (let i = lo; i <= hi; i++) {
      const block = body[i]!;
      const label = block.kind === "heading" && isStructural(block) ? block.text : undefined;
      const leaf = addNode({
        id: nextId(),
        depth: parent.depth + 1,
        parent: parent.id,
        children: [],
        range: [block.id, block.id],
        title: "",
        ...(label ? { navLabel: label } : {}),
      });
      parent.children.push(leaf.id);
    }
  };

  interface Segment {
    lo: number;
    hi: number;
  }

  /** Cut [lo, hi] at every index in `cuts` (which must include `lo`). */
  const segmentsFrom = (cuts: number[], hi: number): Segment[] =>
    cuts.map((lo, s) => ({ lo, hi: s + 1 < cuts.length ? cuts[s + 1]! - 1 : hi }));

  /** The words a reader would actually read in [lo, hi] — headings excluded. */
  const proseWords = (seg: Segment): number => {
    let sum = 0;
    for (let i = seg.lo; i <= seg.hi; i++) {
      const b = body[i]!;
      if (headingLevel(b) === null) sum += b.words;
    }
    return sum;
  };

  /**
   * Rule 2: a stub segment merges into the one after it (a heading introduces
   * what follows), and a trailing run of stubs merges back into the last real
   * segment. One left-to-right pass, so a run of stubs chains into whichever
   * real segment comes next.
   */
  const mergeStubs = (segments: Segment[]): Segment[] => {
    const merged: Segment[] = [];
    let pendingLo: number | null = null;
    for (const seg of segments) {
      const lo: number = pendingLo ?? seg.lo;
      if (proseWords(seg) < stubThreshold) {
        pendingLo = lo;
        continue;
      }
      merged.push({ lo, hi: seg.hi });
      pendingLo = null;
    }
    if (pendingLo !== null) {
      const last = merged.at(-1);
      const hi = segments.at(-1)!.hi;
      if (last) last.hi = hi;
      else merged.push({ lo: pendingLo, hi });
    }
    return merged;
  };

  /**
   * One node per segment under `parent`. A segment is titled by the first
   * heading block anywhere inside it — not only at its start, because a merge
   * can put a heading-less preamble in front of the section's own heading —
   * and only a segment with no heading at all wears the stock preamble title,
   * which is honestly this arm's weakest node.
   */
  const addSections = (parent: TreeNode, segments: Segment[], subLevel: number | null): void => {
    for (const seg of segments) {
      let sectionHeading: Block | null = null;
      for (let i = seg.lo; i <= seg.hi && !sectionHeading; i++) {
        if (headingLevel(body[i]!) !== null) sectionHeading = body[i]!;
      }
      const section = addNode({
        id: nextId(),
        depth: parent.depth + 1,
        parent: parent.id,
        children: [],
        range: [body[seg.lo]!.id, body[seg.hi]!.id],
        title: sectionHeading ? sectionHeading.text : PREAMBLE_TITLE,
        ...(sectionHeading ? { sourceHeading: sectionHeading.text } : {}),
      });
      parent.children.push(section.id);

      /* One nesting step, capped at internal depth 2 — the prompt's own shape.
         Sub-cuts are headings strictly after the segment's start, at the
         section level or the shallowest deeper one (a merge can leave a
         section-level heading in the interior), and only when there are at
         least two of them: one sub-heading makes a preamble-plus-stub pair
         that navigates worse than the flat section. */
      let subSegments: Segment[] = [];
      if (subLevel !== null && section.depth < 2) {
        const candidates: number[] = [];
        for (let i = seg.lo + 1; i <= seg.hi; i++) {
          const level = headingLevel(body[i]!);
          if (level !== null && level <= subLevel) candidates.push(i);
        }
        if (candidates.length >= 2) {
          subSegments = mergeStubs(segmentsFrom([seg.lo, ...candidates], seg.hi));
        }
      }
      if (subSegments.length >= 2) {
        addSections(section, subSegments, null);
      } else {
        growLeaves(section, seg.lo, seg.hi);
      }
    }
  };

  const firstHeading = body.find((b) => headingLevel(b) !== null);
  const root = addNode({
    id: nextId(),
    depth: 0,
    parent: null,
    children: [],
    range: [body[0]!.id, body.at(-1)!.id],
    title: articleTitle ?? firstHeading?.text ?? slug,
  });

  let parts = 0;
  let flat = sectionLevel === null;
  if (sectionLevel !== null) {
    const cuts: number[] = [];
    for (let i = 0; i < body.length; i++) {
      const level = headingLevel(body[i]!);
      if (level !== null && level <= sectionLevel) cuts.push(i);
    }
    if (cuts[0] !== 0) cuts.unshift(0);
    const segments = mergeStubs(segmentsFrom(cuts, body.length - 1));
    /* Fewer than two survivors means the headings carried no prose structure —
       fowler's catalogue front-matter — and one section wrapping the whole
       article is a worse rendering of "no structure" than none. */
    if (segments.length < 2) {
      flat = true;
    } else {
      /* The next level down, chosen once for the whole article rather than per
         part, so two chapters with h3s and h4s respectively do not nest by
         different rules. */
      const deeper = [...levels.keys()].filter((l) => l > sectionLevel).sort((a, b) => a - b);
      addSections(root, segments, deeper[0] ?? sectionLevel);
      parts = root.children.length;
    }
  }
  if (flat) growLeaves(root, 0, body.length - 1);

  const tree: Tree = {
    version: HEADING_TREE_VERSION,
    generator: HEADING_TREE_GENERATOR,
    slug,
    rootId: root.id,
    nodes,
    /* **The marker, and it is set here rather than by the caller.** A tree from
       this file has no gists and can never acquire them, so it fails the gist
       rule by construction — and the exemption `checkTree` makes for it must be
       keyed on something a caller cannot forget to set. Tree-level rather than
       per-node because the whole tree is replaced at once and no node of it
       becomes final on its own; explicit rather than inferred from the missing
       gists for the same reason `treatment` exists at all. See
       src/tree-invariants.ts and docs/research/260830a-opening-an-article-before-the-toc.md § 2. */
    provisional: "headings",
  };

  return {
    tree: appendSupplement(tree, groups),
    sectionLevel,
    flat,
    parts,
  };
}
