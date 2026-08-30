/**
 * The deterministic half of the ToC structure eval — the scoring in
 * evals/toc-structure/score.ts and the free heading-tree arm in
 * evals/toc-structure/heading-tree.ts. Same split as extraction: the part that
 * is cheap and deterministic is pinned here; the part that spends money is not
 * a test.
 *
 * Expected values are spelled out as literals, never derived by re-running the
 * arithmetic under test — an expectation computed from the thing it checks
 * agrees with every value of it. And the validity test includes a broken tree,
 * because a gate nobody has seen go red is not evidence about the gate.
 */

import { describe, expect, it } from "vitest";
import { buildHeadingTree, PREAMBLE_TITLE } from "../evals/toc-structure/heading-tree.js";
import { compareTrees, scoreTree } from "../evals/toc-structure/score.js";
import type { Block, NodeId, Tree, TreeNode } from "../src/types.js";

let blockCounter = 0;

function block(over: Partial<Block> = {}): Block {
  const id = over.id ?? `spya-t${String(++blockCounter).padStart(4, "0")}`;
  // 25 words - above MIN_SEGMENT_PROSE_WORDS, so a default paragraph makes a
  // segment real and only a test that *means* to build a stub builds one.
  const text =
    over.text ??
    "plain body prose that runs on long enough to clear the stub threshold " +
      "with room to spare because a section needs some words in it";
  return {
    id,
    tag: over.tag ?? "p",
    kind: over.kind ?? "text",
    text,
    words: over.words ?? text.split(/\s+/).length,
    html: `<p>${text}</p>`,
    gistable: over.gistable ?? true,
    ...over,
  };
}

function heading(level: number, text: string, over: Partial<Block> = {}): Block {
  return block({ tag: `h${level}`, kind: "heading", level, text, ...over });
}

/**
 * A tree from a nested spec of internal nodes, leaves grown mechanically —
 * the same shape src/toc.ts § buildTree produces. One builder for every
 * fixture, so a test cannot quietly hand the scorer a shape the pipeline
 * never writes.
 */
interface Spec {
  range: [number, number]; // block indices, inclusive
  title?: string;
  gist?: string;
  sourceHeading?: string;
  children?: Spec[];
}

function treeFrom(blocks: Block[], spec: Spec): Tree {
  const nodes: Record<NodeId, TreeNode> = {};
  let counter = 0;
  const nextId = () => `n${String(++counter).padStart(4, "0")}`;
  const visit = (s: Spec, parent: NodeId | null, depth: number): NodeId => {
    const id = nextId();
    const node: TreeNode = {
      id,
      depth,
      parent,
      children: [],
      range: [blocks[s.range[0]]!.id, blocks[s.range[1]]!.id],
      title: s.title ?? "Some section title",
      ...(s.gist ? { gist: s.gist } : {}),
      ...(s.sourceHeading ? { sourceHeading: s.sourceHeading } : {}),
    };
    nodes[id] = node;
    if (s.children?.length) {
      node.children = s.children.map((c) => visit(c, id, depth + 1));
    } else {
      for (let i = s.range[0]; i <= s.range[1]; i++) {
        const leafId = nextId();
        nodes[leafId] = {
          id: leafId,
          depth: depth + 1,
          parent: id,
          children: [],
          range: [blocks[i]!.id, blocks[i]!.id],
          title: "",
        };
        node.children.push(leafId);
      }
    }
    return id;
  };
  const rootId = visit(spec, null, 0);
  return { version: "test", generator: "test", slug: "test", rootId, nodes };
}

/** Give every internal node a gist so validity tests can isolate what they mean to. */
function withGists(spec: Spec): Spec {
  return {
    gist: "This section makes one specific claim.",
    ...spec,
    ...(spec.children ? { children: spec.children.map(withGists) } : {}),
  };
}

describe("scoreTree", () => {
  it("balance: cv is the population stddev over the mean, on word sizes", () => {
    // Two parts of 100 and 300 words: mean 200, stddev 100, cv 0.5.
    const blocks = [
      heading(2, "Part one", { words: 5 }),
      block({ words: 95 }),
      heading(2, "Part two", { words: 5 }),
      block({ words: 295 }),
    ];
    const tree = treeFrom(blocks, withGists({
      range: [0, 3],
      children: [{ range: [0, 1] }, { range: [2, 3] }],
    }));
    const score = scoreTree(blocks, tree);
    expect(score.parts.count).toBe(2);
    expect(score.parts.words).toEqual([100, 300]);
    expect(score.parts.balanceCv).toBeCloseTo(0.5, 10);
  });

  it("depth: a branch three deep beside a branch two deep scores below 1", () => {
    const blocks = Array.from({ length: 10 }, () => block());
    // Part one (6 blocks) has two sub-sections, so its leaves sit at depth 3;
    // part two's four leaves sit at depth 2. Modal depth is 3, share 6/10.
    const tree = treeFrom(blocks, withGists({
      range: [0, 9],
      children: [
        { range: [0, 5], children: [{ range: [0, 2] }, { range: [3, 5] }] },
        { range: [6, 9] },
      ],
    }));
    const score = scoreTree(blocks, tree);
    expect(score.depth.maxInternal).toBe(2);
    expect(score.depth.minLeaf).toBe(2);
    expect(score.depth.maxLeaf).toBe(3);
    expect(score.depth.modalLeafDepthShare).toBeCloseTo(0.6, 10);
  });

  it("fanout: counts nodes outside 5–9, including one over the cap", () => {
    const blocks = Array.from({ length: 16 }, () => block());
    // Root has 2 children (under), one section holds 10 leaves (over), the
    // other 6 (within): 1 of 3 internal nodes within 5-9.
    const tree = treeFrom(blocks, withGists({
      range: [0, 15],
      children: [{ range: [0, 9] }, { range: [10, 15] }],
    }));
    const score = scoreTree(blocks, tree);
    expect(score.fanout.max).toBe(10);
    expect(score.fanout.within5to9).toBeCloseTo(1 / 3, 10);
  });

  it("heading agreement is two-sided: a cut off-heading lowers only precision", () => {
    const blocks = [
      block(),
      block(),
      heading(2, "First heading"),
      block(),
      block(),
      block(),
      heading(2, "Second heading"),
      block(),
    ];
    // Cuts at 2, 4 and 6: two of three chosen boundaries are headings, and
    // both headings became boundaries.
    const tree = treeFrom(blocks, withGists({
      range: [0, 7],
      children: [{ range: [0, 1] }, { range: [2, 3] }, { range: [4, 5] }, { range: [6, 7] }],
    }));
    const score = scoreTree(blocks, tree);
    expect(score.headingBlocks).toBe(2);
    expect(score.headings.boundaries).toBe(3);
    expect(score.headings.boundariesOnHeadings).toBeCloseTo(2 / 3, 10);
    expect(score.headings.headingsCut).toBe(1);
  });

  it("heading agreement is two-sided: an ignored heading lowers only recall", () => {
    const blocks = [
      block(),
      block(),
      heading(2, "First heading"),
      block(),
      heading(2, "Second heading"),
      block(),
    ];
    // One cut, on a heading; the second heading is merged over.
    const tree = treeFrom(blocks, withGists({
      range: [0, 5],
      children: [{ range: [0, 1] }, { range: [2, 5] }],
    }));
    const score = scoreTree(blocks, tree);
    expect(score.headings.boundariesOnHeadings).toBe(1);
    expect(score.headings.headingsCut).toBeCloseTo(1 / 2, 10);
  });

  it("title retention excludes copied headings and keeps invented words out of the article's credit", () => {
    const blocks = [
      heading(2, "Soul Machine"),
      block({ text: "entirely different prose here" }),
      heading(2, "Second Part"),
      block({ text: "a paragraph discussing turnips at length" }),
    ];
    const tree = treeFrom(blocks, withGists({
      range: [0, 3],
      // The root copies a heading too, so the one own-title node below is the
      // only thing retention can be measuring.
      title: "Soul Machine",
      children: [
        // Copied heading: scores ~1.0 by construction, so it must be excluded.
        { range: [0, 1], title: "Soul Machine", sourceHeading: "Soul Machine" },
        // Own title: of its content words {quantum, turnips, galore}, only
        // "turnips" is in the range - retention 1/3.
        { range: [2, 3], title: "Quantum turnips galore" },
      ],
    }));
    const score = scoreTree(blocks, tree);
    expect(score.titles.copiedHeadings).toBe(2);
    expect(score.titles.retention).toBeCloseTo(1 / 3, 10);
    expect(score.headings.sourceHeadingShare).toBeCloseTo(1 / 3, 10); // 1 of 3 internal nodes
    expect(score.headings.sourceHeadingValid).toBe(1);
  });

  it("gists: coverage, template repetition and the one-sentence proxy", () => {
    const blocks = Array.from({ length: 6 }, () => block({ text: "metabolic feeling in octopus arms" }));
    const tree = treeFrom(blocks, {
      range: [0, 5],
      gist: "The author then argues for panpsychism. And keeps going.",
      children: [
        { range: [0, 1], gist: "The author then reverses course" },
        { range: [2, 3], gist: "Feeling is metabolic in octopus arms" },
        { range: [4, 5] }, // no gist
      ],
    });
    const score = scoreTree(blocks, tree);
    expect(score.gists.count).toBe(3);
    expect(score.gists.coverage).toBeCloseTo(3 / 4, 10);
    // Two of three share the opening bigram "the author".
    expect(score.gists.templateRepetition).toBeCloseTo(2 / 3, 10);
    expect(score.gists.multiSentence).toBeCloseTo(1 / 3, 10);
    // Third gist's content words: {feeling, metabolic, octopus, arms} - all in
    // its own blocks - retention 1.0 for it.
    expect(score.gists.retention).toBeGreaterThan(0);
  });

  it("validity: gist absences are counted apart from structural damage", () => {
    const blocks = [heading(2, "Only Part"), block(), block()];
    const bare = treeFrom(blocks, {
      range: [0, 2],
      children: [{ range: [0, 2], title: "Only Part" }],
    });
    const score = scoreTree(blocks, bare);
    expect(score.validity.gistProblems).toBe(2); // root and the one section
    expect(score.validity.otherProblems).toBe(0);
  });

  it("validity: the gate can actually go red - overlapping children are not a gist problem", () => {
    const blocks = Array.from({ length: 6 }, () => block());
    const broken = treeFrom(blocks, withGists({
      range: [0, 5],
      children: [{ range: [0, 3] }, { range: [2, 5] }], // overlap at 2-3
    }));
    const score = scoreTree(blocks, broken);
    expect(score.validity.otherProblems).toBeGreaterThan(0);
    expect(score.validity.gistProblems).toBe(0);
  });
});

describe("compareTrees", () => {
  it("an identical carving agrees at 1.0, a half-shared one at its jaccard", () => {
    const blocks = Array.from({ length: 8 }, () => block());
    const a = treeFrom(blocks, withGists({
      range: [0, 7],
      children: [{ range: [0, 1] }, { range: [2, 3] }, { range: [4, 7] }],
    }));
    const b = treeFrom(blocks, withGists({
      range: [0, 7],
      children: [{ range: [0, 1] }, { range: [2, 5] }, { range: [6, 7] }],
    }));
    expect(compareTrees(blocks, a, a).l1Boundaries).toBe(1);
    expect(compareTrees(blocks, a, a).allBoundaries).toBe(1);
    // a cuts at {2,4}, b cuts at {2,6}: one shared of three distinct.
    expect(compareTrees(blocks, a, b).l1Boundaries).toBeCloseTo(1 / 3, 10);
    expect(compareTrees(blocks, a, b).partCountA).toBe(3);
    expect(compareTrees(blocks, a, b).partCountB).toBe(3);
  });
});

describe("buildHeadingTree", () => {
  it("sections on h2 when h1 appears only twice (the fowler shape), and h1s still cut", () => {
    const blocks = [
      heading(1, "The Title"),
      block(),
      heading(2, "Section One"),
      block(),
      heading(2, "Section Two"),
      block(),
      heading(2, "Section Three"),
      block(),
      heading(1, "A Closing Word"),
      block(),
    ];
    const built = buildHeadingTree(blocks, "fowler-shaped");
    expect(built.sectionLevel).toBe(2);
    expect(built.flat).toBe(false);
    // Cuts at both h1s and all three h2s: five parts.
    expect(built.parts).toBe(5);
    const score = scoreTree(blocks, built.tree);
    expect(score.validity.otherProblems).toBe(0);
    expect(score.validity.gistProblems).toBe(6); // root + five parts
    expect(score.headings.headingsCut).toBe(1); // every heading became a boundary
    expect(score.headings.sourceHeadingValid).toBe(1);
  });

  it("an article that opens mid-prose gets a preamble part with the stock title", () => {
    const blocks = [
      block(),
      block(),
      heading(2, "One"),
      block(),
      heading(2, "Two"),
      block(),
      heading(2, "Three"),
      block(),
    ];
    const built = buildHeadingTree(blocks, "preamble");
    expect(built.parts).toBe(4);
    const root = built.tree.nodes[built.tree.rootId]!;
    const first = built.tree.nodes[root.children[0]!]!;
    expect(first.title).toBe(PREAMBLE_TITLE);
    expect(first.sourceHeading).toBeUndefined();
    expect(scoreTree(blocks, built.tree).validity.otherProblems).toBe(0);
  });

  it("no usable headings means the flat fallback, tiling every block", () => {
    const blocks = [heading(1, "Only a Title"), block(), block(), block()];
    const built = buildHeadingTree(blocks, "flat");
    expect(built.flat).toBe(true);
    expect(built.sectionLevel).toBeNull();
    const root = built.tree.nodes[built.tree.rootId]!;
    expect(root.children).toHaveLength(4); // one leaf per block
    expect(scoreTree(blocks, built.tree).validity.otherProblems).toBe(0);
  });

  it("falls back to a level with two headings when none has three", () => {
    const blocks = [
      heading(1, "Part One"),
      block(),
      block(),
      heading(1, "Part Two"),
      block(),
    ];
    const built = buildHeadingTree(blocks, "two-parter");
    expect(built.sectionLevel).toBe(1);
    expect(built.parts).toBe(2);
  });

  it("nests one level down when a section holds two or more deeper headings, and not for one", () => {
    const blocks = [
      heading(2, "Nested"),
      block(),
      heading(3, "Sub A"),
      block(),
      heading(3, "Sub B"),
      block(),
      heading(2, "Flat"),
      block(),
      heading(3, "Lonely Sub"),
      block(),
      heading(2, "Third"),
      block(),
    ];
    const built = buildHeadingTree(blocks, "nesting");
    const tree = built.tree;
    const root = tree.nodes[tree.rootId]!;
    const [nested, flat] = root.children.map((id) => tree.nodes[id]!);
    // "Nested" gained two depth-2 internal children plus a leaf for its own
    // heading block... no: sub-cuts partition [0,5] from the first sub-cut, so
    // the heading and its opening paragraph form a preamble segment.
    const internalChildren = (n: TreeNode) =>
      n.children.filter((id) => tree.nodes[id]!.children.length > 0);
    expect(internalChildren(nested!)).toHaveLength(3); // preamble + Sub A + Sub B
    expect(internalChildren(flat!)).toHaveLength(0); // one lonely h3 does not split
    expect(scoreTree(blocks, tree).validity.otherProblems).toBe(0);
  });

  it("keeps the apparatus out of the sections and appends it as a supplement", () => {
    const blocks = [
      heading(2, "One"),
      block(),
      heading(2, "Two"),
      block(),
      heading(2, "Three"),
      block(),
      block({ role: "footnote", treatment: "supplement", text: "a note" }),
      block({ role: "footnote", treatment: "supplement", text: "another note" }),
    ];
    const built = buildHeadingTree(blocks, "with-notes");
    expect(built.parts).toBe(3);
    const tree = built.tree;
    const root = tree.nodes[tree.rootId]!;
    const supplements = root.children
      .map((id) => tree.nodes[id]!)
      .filter((n) => n.treatment === "supplement");
    expect(supplements).toHaveLength(1);
    // The root's range covers the notes; no section does.
    expect(root.range[1]).toBe(blocks[7]!.id);
    const score = scoreTree(blocks, tree);
    expect(score.validity.otherProblems).toBe(0);
    // Supplement machinery is not credited to the arm: still 3 parts.
    expect(score.parts.count).toBe(3);
  });

  it("merges a title stub forward and keeps the merged part's first heading as its title", () => {
    const blocks = [
      heading(1, "The Title"),
      block({ text: "a four word byline" }),
      heading(2, "Section A"),
      block(),
      heading(2, "Section B"),
      block(),
      heading(2, "Section C"),
      block(),
    ];
    const built = buildHeadingTree(blocks, "title-stub");
    expect(built.parts).toBe(3);
    const tree = built.tree;
    const first = tree.nodes[tree.nodes[tree.rootId]!.children[0]!]!;
    expect(first.range[0]).toBe(blocks[0]!.id);
    expect(first.range[1]).toBe(blocks[3]!.id);
    expect(first.title).toBe("The Title");
    expect(scoreTree(blocks, tree).validity.otherProblems).toBe(0);
  });

  it("a heading-less stub preamble merges in and the section's own heading titles the part", () => {
    const blocks = [
      block({ text: "a four word standfirst" }),
      heading(2, "Section A"),
      block(),
      heading(2, "Section B"),
      block(),
      heading(2, "Section C"),
      block(),
    ];
    const built = buildHeadingTree(blocks, "tiny-preamble");
    expect(built.parts).toBe(3);
    const tree = built.tree;
    const first = tree.nodes[tree.nodes[tree.rootId]!.children[0]!]!;
    expect(first.range[0]).toBe(blocks[0]!.id);
    expect(first.title).toBe("Section A");
    expect(first.sourceHeading).toBe("Section A");
  });

  it("trailing furniture stubs merge backwards into the last real part", () => {
    const blocks = [
      heading(2, "Section A"),
      block(),
      heading(2, "Section B"),
      block(),
      heading(2, "Backlinks"),
      block({ text: "two links" }),
      heading(2, "Bibliography"),
      block({ text: "one citation" }),
    ];
    const built = buildHeadingTree(blocks, "furniture");
    expect(built.parts).toBe(2);
    const tree = built.tree;
    const last = tree.nodes[tree.nodes[tree.rootId]!.children[1]!]!;
    expect(last.title).toBe("Section B");
    expect(last.range[1]).toBe(blocks[7]!.id);
    expect(scoreTree(blocks, tree).validity.otherProblems).toBe(0);
  });

  it("headings with no prose behind them collapse to flat (the fowler shape)", () => {
    const blocks = [
      heading(1, "Utility of Phrenology"),
      heading(2, "Contributors"),
      block({ text: "Fowler, L. N." }),
      heading(2, "Publication"),
      block({ text: "London 1842" }),
      heading(2, "License"),
      block(), // the lecture itself: the only real prose, after every heading
    ];
    const built = buildHeadingTree(blocks, "fowler-collapse");
    expect(built.flat).toBe(true);
    expect(built.sectionLevel).toBe(2); // a level was chosen; merging defeated it
    expect(built.parts).toBe(0);
    const root = built.tree.nodes[built.tree.rootId]!;
    expect(root.children).toHaveLength(7);
  });

  it("is deterministic: two builds of the same blocks agree exactly", () => {
    const blocks = [
      heading(2, "One"),
      block(),
      heading(2, "Two"),
      block(),
      heading(2, "Three"),
      block(),
    ];
    const a = buildHeadingTree(blocks, "det");
    const b = buildHeadingTree(blocks, "det");
    expect(a.tree).toEqual(b.tree);
    expect(compareTrees(blocks, a.tree, b.tree).allBoundaries).toBe(1);
  });
});
