/**
 * Deterministic measures over one (blocks, tree) pair — the scoring half of the
 * ToC *structure* eval. No model calls, no file writes, no clock. The runner
 * (evals/hierarchy-structure/run.ts) decides what to score; this file only measures.
 *
 * Everything here is mechanical, and none of it decides whether a tree is
 * *good*; each measure is a proxy for a specific way the structure pass could
 * go wrong, or a fact two arms can be compared on. See evals/README.md
 * § hierarchy-structure for what each one is a proxy for and — just as important —
 * which ones are deliberately NOT scores where higher is better.
 *
 * `contentWords` and `sameHeading` are imported from the stages themselves
 * rather than redefined, for the reason evals/hierarchy-labels.ts gives: a measure
 * that disagreed with its own gate would be worse than no measure.
 */

import { isBody } from "../../src/block-policy.js";
import { contentWords } from "../../src/labels.js";
import { supplementIndex } from "../../src/supplement.js";
import { checkTree, sameHeading } from "../../src/tree-invariants.js";
import type { Block, Tree, TreeNode } from "../../src/types.js";

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Population standard deviation. Zero for fewer than two values. */
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function wordsIn(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** The first two words, lower-cased — how a formula announces itself. Same as evals/hierarchy-labels.ts. */
function openingBigram(text: string): string {
  return text.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 2).join(" ");
}

function jaccard(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Share of `words` that appear in `inText` — the vocabulary-retention overlap. */
function retention(words: Set<string>, inText: Set<string>): number | null {
  if (words.size === 0) return null;
  let shared = 0;
  for (const w of words) if (inText.has(w)) shared++;
  return shared / words.size;
}

export interface StructureScore {
  slug: string;
  blocks: number;
  bodyBlocks: number;
  headingBlocks: number;
  /**
   * Gistable body blocks of one word or less — stage 3's inline-promotion
   * artefacts (Wikipedia's "[edit]" links, a bold "Notes", a section numeral
   * promoted to a block). The ARTICLE's fact, not the tree's, recorded per
   * row so a later reader can tell an arm that handled a messy document from
   * one that got a clean one: 13 of 15 corpus articles carry at least one,
   * and greatwork carries 89 (found 2026-08-30, the read.html postmortem).
   */
  fragmentBlocks: number;

  /**
   * `checkTree`, split in two — because the free heading arm cannot produce
   * gists (there is nowhere free to get one), so a missing gist is that arm's
   * known, priced-in failure rather than a finding — while for every arm that
   * was ASKED for gists it is damage, and the runner says so per arm.
   * Everything in `otherProblems` means the tree would render a wrong article,
   * whoever built it. `advice` is checkTree's editorial channel, counted but
   * never a gate.
   *
   * The split is made by construction, not by matching message text:
   * `gistProblems` counts the gistless internal body nodes directly, and
   * `otherProblems` is what `checkTree` says about the same tree with a
   * placeholder gist on each of them — so a reworded message cannot silently
   * move a problem between the two buckets. (Typed issue codes on `checkTree`
   * itself were considered and declined, 2026-08-30: tree-invariants.ts is
   * load-bearing and this construction needs nothing from it.)
   *
   * **`otherProblems` can no longer report a tiling fault for any tree that came
   * through `buildTree`**, since 2026-08-31. The partition is derived from the
   * model's proposal rather than checked against it
   * (src/hierarchy.ts § `planChildRanges`), so gaps, overlaps and children
   * running past their parent are not faults an arm can commit any more — this
   * counts what is left, which is what a tree read off disk can still be wrong
   * about.
   *
   * This is the same trap `sourceHeadingValid` fell into below, and it is worth
   * saying twice: **a repair inside the code under measurement silently
   * redefines the measurement, and nothing fails when it does.** What replaced
   * the signal is `repaired` in the run file — its `ranges`, `blocks`,
   * `largest` and `droppedChildren`. An arm whose answer did not tile now scores
   * a clean `otherProblems: 0` and says so only there, so read the two together.
   */
  validity: {
    gistProblems: number;
    otherProblems: number;
    advice: number;
  };

  /**
   * The depth-one carving of the article, supplement nodes excluded — those
   * are appended mechanically (src/supplement.ts) and say nothing about the
   * proposer. Sizes are in words, not blocks, because blocks vary a lot in
   * length and a "balanced" carving into equal block counts can still put
   * half the article in one part.
   *
   * `balanceCv` is the coefficient of variation (population stddev / mean) of
   * part word-sizes. 0 means equal parts; one 200-block part beside eight
   * 3-block parts scores high. Lower is *usually* better, but a preface
   * genuinely shorter than the chapters is not a fault — compare arms on it,
   * don't gate on it.
   */
  parts: {
    count: number;
    words: number[];
    balanceCv: number;
  };

  /**
   * Depth, measured over body nodes only, and per *block* rather than per
   * branch — a branch is one node however many paragraphs it holds, so a
   * branch-weighted number would let one stub branch look as heavy as the
   * chapter beside it.
   *
   * `modalLeafDepthShare` is the share of body blocks whose leaf sits at the
   * most common leaf depth: 1.0 means every paragraph is reached through the
   * same number of levels, lower means the tree is deep in some places and
   * shallow in others — which renders as gist columns that cover only part of
   * the page.
   */
  depth: {
    maxInternal: number;
    minLeaf: number;
    maxLeaf: number;
    modalLeafDepthShare: number;
  };

  /**
   * Children per internal body node (root included; the deepest nodes' children
   * are their block leaves). The prompt asks for 5–9 "so each level is an even
   * stride"; this measures whether that happened. Not a gate — a 4-section
   * article is what it is — but a mean of 30 means no mid-level structure got
   * proposed.
   */
  fanout: {
    mean: number;
    max: number;
    within5to9: number;
  };

  /**
   * The two-sided heading question, and deliberately NOT a score where higher
   * is better. High agreement means the arm deferred to the author; low means
   * it reorganised; either can be right (scaling-hypothesis over-segments on
   * its own headings, fowler-phrenology's were ignored by the incumbent).
   *
   * Index 0 is excluded from BOTH sides everywhere here, because the first
   * child of the root is forced to start there — a boundary nobody chose
   * carries no information about the arm. The first version credited it: a
   * heading at block zero counted as "cut" and the forced first part counted
   * toward `l1OnHeadings`, so `writes` — whose every chosen boundary is
   * off-heading — reported headingsCut 1.0. A heading at index 0 is
   * unobservable, not successfully cut. GPT Sol, 2026-08-30.
   *
   * - `boundariesOnHeadings`: of the cut points the arm *chose* (unique start
   *   indices of internal body nodes), what share land on a heading block.
   * - `headingsCut`: of the author's heading blocks the arm could choose to
   *   cut at, what share start some internal node.
   * - `l1OnHeadings`: the same precision question asked of depth-1 parts only
   *   (the forced first part excluded), which is the row the research table
   *   counts (docs/research/260830a-opening-an-article-before-the-toc.md § 2).
   */
  headings: {
    boundaries: number;
    boundariesOnHeadings: number | null;
    headingsCut: number | null;
    l1OnHeadings: number | null;
    /** Internal body nodes carrying a sourceHeading, as a share of all of them. */
    sourceHeadingShare: number;
    /** Of those, the share whose sourceHeading really matches a heading in range (sameHeading). */
    sourceHeadingValid: number | null;
    /**
     * The longest run of consecutive body blocks with no heading in it — a
     * fact about the ARTICLE, not the tree, and the one number that predicts
     * whether a heading tree can give usable bands at all. Heading *count*
     * cannot: fowler-phrenology has eight headings and a 61-block headingless
     * run, because all eight are catalogue front-matter. GPT Sol landed on the
     * same measure independently (2026-08-30). Body blocks only — Sol's 42
     * for scaling-hypothesis counted its bibliography, which never needed
     * bands; the body answer there is 29.
     */
    longestHeadinglessRun: { blocks: number; words: number };
  };

  /**
   * Titles, over internal body nodes. `retention` is the share of a title's
   * content words that appear in its own range's text — the proxy for naming
   * the section in the author's words. Titles that are a copied heading are
   * excluded from `retention` (they score ~1.0 by construction and would
   * measure the article's heading count, the exact mistake evals/hierarchy-labels.ts
   * records making once); `copiedHeadings` says how many were excluded.
   */
  titles: {
    count: number;
    meanWords: number;
    within2to6: number;
    copiedHeadings: number;
    retention: number | null;
  };

  /**
   * Gists, over internal body nodes. `coverage` below 1 is the free arm's
   * known gap; for a model arm it is a bug. `multiSentence` is a rough proxy
   * ("Dr." counts as a boundary) for breaking the one-sentence rule.
   * `templateRepetition` is the share of gists opening with a bigram some
   * other gist also opens with. `retention` as for titles, against the node's
   * own range text.
   */
  gists: {
    count: number;
    coverage: number;
    meanWords: number;
    multiSentence: number | null;
    templateRepetition: number | null;
    retention: number | null;
  };
}

/** Internal nodes of the argument itself — not supplements, not leaves. */
function internalBodyNodes(tree: Tree): TreeNode[] {
  const supplement = supplementIndex(tree);
  return Object.values(tree.nodes).filter(
    (n) => n.children.length > 0 && !supplement.has(n.id),
  );
}

export function scoreTree(blocks: Block[], tree: Tree): StructureScore {
  const index = new Map(blocks.map((b, i) => [b.id, i]));
  const supplement = supplementIndex(tree);
  const internal = internalBodyNodes(tree);
  const root = tree.nodes[tree.rootId];

  /* The gist/other split, by construction — see the interface comment. The
     placeholder goes only on internal BODY nodes: a supplement without a gist
     is correct, and filling one would invent a problem. */
  const gistless = new Set(internal.filter((n) => !n.gist).map((n) => n.id));
  const filled: Tree =
    gistless.size === 0
      ? tree
      : {
          ...tree,
          nodes: Object.fromEntries(
            Object.entries(tree.nodes).map(([id, n]) => [
              id,
              gistless.has(id) ? { ...n, gist: "(placeholder for validity split)" } : n,
            ]),
          ),
        };
  const check = checkTree(blocks, filled);
  const gistProblems = gistless.size;

  const bodyBlocks = blocks.filter((b) => isBody(b));
  const headingIdx = new Set(
    blocks.flatMap((b, i) => (isBody(b) && b.kind === "heading" ? [i] : [])),
  );

  /* Words per block, so a range's size is one pass over its span. Body words
     only: a supplement inside a range would be a scoring bug, not a size. */
  const wordsAt = blocks.map((b) => (isBody(b) ? b.words : 0));
  const rangeWords = (n: TreeNode): number => {
    const lo = index.get(n.range[0]);
    const hi = index.get(n.range[1]);
    if (lo === undefined || hi === undefined || lo > hi) return 0;
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += wordsAt[i]!;
    return sum;
  };
  const rangeText = (n: TreeNode): string => {
    const lo = index.get(n.range[0]);
    const hi = index.get(n.range[1]);
    if (lo === undefined || hi === undefined || lo > hi) return "";
    return blocks.slice(lo, hi + 1).filter((b) => isBody(b)).map((b) => b.text).join(" ");
  };

  // ---- parts (depth-one body children of the root) --------------------------
  const l1 = (root?.children ?? [])
    .map((id) => tree.nodes[id])
    .filter((n): n is TreeNode => !!n && n.children.length > 0 && !supplement.has(n.id));
  const partWords = l1.map(rangeWords);
  const partMean = mean(partWords);

  // ---- depth ---------------------------------------------------------------
  const leafDepthCounts = new Map<number, number>();
  let leaves = 0;
  for (const n of Object.values(tree.nodes)) {
    if (n.children.length > 0 || supplement.has(n.id)) continue;
    leafDepthCounts.set(n.depth, (leafDepthCounts.get(n.depth) ?? 0) + 1);
    leaves++;
  }
  const leafDepths = [...leafDepthCounts.keys()];
  const modalCount = Math.max(0, ...leafDepthCounts.values());

  // ---- fanout --------------------------------------------------------------
  const fanouts = internal.map((n) => n.children.length);

  // ---- heading agreement ---------------------------------------------------
  /* Unique start indices, so an L1 node and its first L2 child — forced to
     share a start — count one cut, not two. */
  const startIdx = (n: TreeNode): number | undefined => index.get(n.range[0]);
  /* Index 0 dropped from every set: it is a forced start, so its presence says
     nothing about the arm — see the interface comment. */
  const chosen = new Set(
    internal.map(startIdx).filter((i): i is number => i !== undefined && i !== 0),
  );
  const chosenOnHeadings = [...chosen].filter((i) => headingIdx.has(i)).length;
  const cuttableHeadings = [...headingIdx].filter((i) => i !== 0);
  const headingsCut = cuttableHeadings.filter((i) => chosen.has(i)).length;
  const l1Starts = l1
    .map(startIdx)
    .filter((i): i is number => i !== undefined && i !== 0);
  const l1OnHeadings = l1Starts.filter((i) => headingIdx.has(i)).length;

  let runBlocks = 0;
  let runWords = 0;
  const longestRun = { blocks: 0, words: 0 };
  for (const b of bodyBlocks) {
    if (b.kind === "heading") {
      runBlocks = 0;
      runWords = 0;
      continue;
    }
    runBlocks++;
    runWords += b.words;
    if (runBlocks > longestRun.blocks) {
      longestRun.blocks = runBlocks;
      longestRun.words = runWords;
    }
  }

  /* **`sourceHeadingValid` is necessarily 1 for any tree that came through
     `buildTree`**, since 2026-08-30: the builder drops a claim no heading in
     the node's range backs up, so an invalid one can no longer reach a scored
     tree. It stays measured because a tree read off disk was not necessarily
     built by today's code, and because a 1 here beside a non-zero `repaired`
     count in the run file is the pair that tells the story. Read the two
     together; on their own, this number now says less than it did. GPT Sol. */
  const withSource = internal.filter((n) => n.sourceHeading);
  const sourceValid = withSource.filter((n) => {
    const lo = index.get(n.range[0]);
    const hi = index.get(n.range[1]);
    if (lo === undefined || hi === undefined) return false;
    return blocks
      .slice(lo, hi + 1)
      .some((b) => b.kind === "heading" && sameHeading(b.text, n.sourceHeading!));
  }).length;

  // ---- titles --------------------------------------------------------------
  const isCopiedHeading = (n: TreeNode): boolean => {
    const lo = index.get(n.range[0]);
    const hi = index.get(n.range[1]);
    if (lo === undefined || hi === undefined) return false;
    return blocks
      .slice(lo, hi + 1)
      .some((b) => b.kind === "heading" && sameHeading(b.text, n.title ?? ""));
  };
  const titled = internal.filter((n) => (n.title ?? "").trim().length > 0);
  const titleWords = titled.map((n) => wordsIn(n.title));
  const copied = titled.filter(isCopiedHeading);
  const own = titled.filter((n) => !isCopiedHeading(n));
  const titleRetentions = own
    .map((n) => retention(contentWords(n.title), contentWords(rangeText(n))))
    .filter((r): r is number => r !== null);

  // ---- gists ---------------------------------------------------------------
  const gists = internal.filter((n) => n.gist).map((n) => ({ node: n, gist: n.gist! }));
  const gistWords = gists.map((g) => wordsIn(g.gist));
  const gistRetentions = gists
    .map((g) => retention(contentWords(g.gist), contentWords(rangeText(g.node))))
    .filter((r): r is number => r !== null);
  const openings = gists.map((g) => openingBigram(g.gist));
  const openingCounts = new Map<string, number>();
  for (const o of openings) openingCounts.set(o, (openingCounts.get(o) ?? 0) + 1);
  const multi = gists.filter((g) => /[.!?]\s+\S/.test(g.gist.trim())).length;

  return {
    slug: tree.slug,
    blocks: blocks.length,
    bodyBlocks: bodyBlocks.length,
    headingBlocks: headingIdx.size,
    fragmentBlocks: bodyBlocks.filter((b) => b.gistable && b.words <= 1).length,
    validity: {
      gistProblems,
      otherProblems: check.problems.length,
      advice: check.advice.length,
    },
    parts: {
      count: l1.length,
      words: partWords,
      balanceCv: partMean === 0 ? 0 : stddev(partWords) / partMean,
    },
    depth: {
      maxInternal: internal.length === 0 ? 0 : Math.max(...internal.map((n) => n.depth)),
      minLeaf: leafDepths.length === 0 ? 0 : Math.min(...leafDepths),
      maxLeaf: leafDepths.length === 0 ? 0 : Math.max(...leafDepths),
      modalLeafDepthShare: leaves === 0 ? 0 : modalCount / leaves,
    },
    fanout: {
      mean: mean(fanouts),
      max: fanouts.length === 0 ? 0 : Math.max(...fanouts),
      within5to9:
        fanouts.length === 0 ? 0 : fanouts.filter((f) => f >= 5 && f <= 9).length / fanouts.length,
    },
    headings: {
      boundaries: chosen.size,
      boundariesOnHeadings: chosen.size === 0 ? null : chosenOnHeadings / chosen.size,
      headingsCut: cuttableHeadings.length === 0 ? null : headingsCut / cuttableHeadings.length,
      l1OnHeadings: l1Starts.length === 0 ? null : l1OnHeadings / l1Starts.length,
      sourceHeadingShare: internal.length === 0 ? 0 : withSource.length / internal.length,
      sourceHeadingValid: withSource.length === 0 ? null : sourceValid / withSource.length,
      longestHeadinglessRun: longestRun,
    },
    titles: {
      count: titled.length,
      meanWords: mean(titleWords),
      within2to6:
        titleWords.length === 0
          ? 0
          : titleWords.filter((w) => w >= 2 && w <= 6).length / titleWords.length,
      copiedHeadings: copied.length,
      retention: titleRetentions.length === 0 ? null : mean(titleRetentions),
    },
    gists: {
      count: gists.length,
      coverage: internal.length === 0 ? 0 : gists.length / internal.length,
      meanWords: mean(gistWords),
      multiSentence: gists.length === 0 ? null : multi / gists.length,
      templateRepetition:
        gists.length === 0
          ? null
          : openings.filter((o) => (openingCounts.get(o) ?? 0) > 1).length / openings.length,
      retention: gistRetentions.length === 0 ? null : mean(gistRetentions),
    },
  };
}

/**
 * How similarly two trees carve the SAME article. Descriptive, not a score:
 * against the incumbent it says "how differently did this arm cut", and
 * between two runs of one arm it is the noise floor — the run-to-run
 * disagreement of the instrument itself, which is the resolution any
 * arm-to-arm gap has to clear before it is a result.
 *
 * Never treat either tree as the reference: a similarity of 0.4 to the
 * incumbent is a fact about difference, not a fault in the challenger.
 */
export interface TreeAgreement {
  partCountA: number;
  partCountB: number;
  /** Jaccard over depth-one start indices, index 0 excluded (forced on both). */
  l1Boundaries: number;
  /** Jaccard over ALL internal body cut points, index 0 excluded. */
  allBoundaries: number;
  /**
   * The tolerant companion to the Jaccards, which are exact: under them a
   * boundary that moved one block reads as total disagreement, so run-to-run
   * wobble would dominate any noise floor built on them (REVIEW-SOL.md, 6).
   * Over all cut points, both directions symmetrised: for each cut in one
   * tree, the distance in blocks to the nearest cut in the other.
   * `within1Block` is the share of cuts with a counterpart at most one block
   * away. Null when either tree chose no cuts at all.
   */
  boundaryDistance: { mean: number; within1Block: number } | null;
}

export function compareTrees(blocks: Block[], a: Tree, b: Tree): TreeAgreement {
  const index = new Map(blocks.map((bl, i) => [bl.id, i]));
  const cuts = (tree: Tree, l1Only: boolean): Set<number> => {
    const supplement = supplementIndex(tree);
    const root = tree.nodes[tree.rootId];
    const nodes = l1Only
      ? (root?.children ?? [])
          .map((id) => tree.nodes[id])
          .filter((n): n is TreeNode => !!n && n.children.length > 0)
      : internalBodyNodes(tree);
    return new Set(
      nodes
        .filter((n) => !supplement.has(n.id))
        .map((n) => index.get(n.range[0]))
        .filter((i): i is number => i !== undefined && i !== 0),
    );
  };
  const partCount = (tree: Tree): number => {
    const supplement = supplementIndex(tree);
    return (tree.nodes[tree.rootId]?.children ?? []).filter(
      (id) => (tree.nodes[id]?.children.length ?? 0) > 0 && !supplement.has(id),
    ).length;
  };

  const allA = [...cuts(a, false)];
  const allB = [...cuts(b, false)];
  let boundaryDistance: TreeAgreement["boundaryDistance"] = null;
  if (allA.length > 0 && allB.length > 0) {
    const nearest = (from: number[], to: number[]): number[] =>
      from.map((x) => Math.min(...to.map((y) => Math.abs(x - y))));
    const distances = [...nearest(allA, allB), ...nearest(allB, allA)];
    boundaryDistance = {
      mean: mean(distances),
      within1Block: distances.filter((d) => d <= 1).length / distances.length,
    };
  }

  return {
    partCountA: partCount(a),
    partCountB: partCount(b),
    l1Boundaries: jaccard(cuts(a, true), cuts(b, true)),
    allBoundaries: jaccard(cuts(a, false), cuts(b, false)),
    boundaryDistance,
  };
}
