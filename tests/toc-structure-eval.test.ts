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

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARMS, armByName } from "../evals/toc-structure/arms.js";
import { CORPUS, defaultCorpus } from "../evals/toc-structure/corpus.js";
import { buildHeadingTree, PREAMBLE_TITLE } from "../evals/toc-structure/heading-tree.js";
import {
  assertCallAccounted,
  type CallStats,
  parseStructureResponse,
  renderHeadingList,
  renderSeedProposal,
  runModelArm,
} from "../evals/toc-structure/model-arms.js";
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

  it("a heading at block zero is unobservable, never credited as cut", () => {
    // The first child of the root is FORCED to start at index 0, so a heading
    // there says nothing about the arm. Before the fix this fixture reported
    // headingsCut 1.0 with every chosen boundary off-heading. GPT Sol, 2026-08-30.
    const blocks = [heading(1, "The Title"), block(), block(), block(), block(), block()];
    const tree = treeFrom(blocks, withGists({
      range: [0, 5],
      children: [{ range: [0, 1] }, { range: [2, 3] }, { range: [4, 5] }],
    }));
    const score = scoreTree(blocks, tree);
    expect(score.headings.headingsCut).toBeNull(); // no cuttable heading exists
    expect(score.headings.boundariesOnHeadings).toBe(0); // both chosen cuts are off-heading
    expect(score.headings.l1OnHeadings).toBe(0); // the forced first part is not counted
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

  it("longest headingless run is the article's fact: body blocks only, reset at each heading", () => {
    const blocks = [
      heading(2, "Front matter"),
      block({ words: 10 }),
      heading(2, "Also front matter"),
      block({ words: 5 }),
      block({ words: 7 }),
      block({ words: 9 }), // the run: 3 blocks, 21 words
      block({ role: "footnote", treatment: "supplement", words: 100, text: "a very long note" }),
      block({ role: "footnote", treatment: "supplement", words: 100, text: "another one" }),
    ];
    const tree = treeFrom(blocks.slice(0, 6), withGists({
      range: [0, 5],
      children: [{ range: [0, 1] }, { range: [2, 5] }],
    }));
    // Score against the body-only tree's blocks plus the notes, so the
    // supplement is present and must NOT extend the run - a bibliography with
    // no headings is not an argument that needed bands.
    const run = scoreTree(blocks.slice(0, 6), tree).headings.longestHeadinglessRun;
    expect(run).toEqual({ blocks: 3, words: 21 });
    // And with the supplement in the block list, the answer must not change.
    const supTree = treeFrom(blocks, withGists({
      range: [0, 7],
      children: [{ range: [0, 1] }, { range: [2, 7] }],
    }));
    expect(scoreTree(blocks, supTree).headings.longestHeadinglessRun).toEqual({
      blocks: 3,
      words: 21,
    });
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

describe("parseStructureResponse", () => {
  const answer = (blocks: Block[], ranges: [number, number][]) =>
    JSON.stringify({
      root: {
        title: "The Whole Piece",
        gist: "One sentence carrying the whole shape of the argument.",
        range: [blocks[0]!.id, blocks.at(-1)!.id],
        children: ranges.map(([lo, hi], i) => ({
          title: `Part ${i + 1}`,
          gist: `Part ${i + 1} makes its own distinct claim here.`,
          range: [blocks[lo]!.id, blocks[hi]!.id],
        })),
      },
    });

  it("turns a fenced answer into the pipeline's own validated tree", () => {
    const blocks = Array.from({ length: 6 }, () => block());
    const raw = "```json\n" + answer(blocks, [[0, 2], [3, 5]]) + "\n```";
    const tree = parseStructureResponse(raw, blocks, "parsed");
    const score = scoreTree(blocks, tree);
    expect(score.parts.count).toBe(2);
    expect(score.validity.otherProblems).toBe(0);
    expect(score.validity.gistProblems).toBe(0); // this answer wrote its gists
  });

  it("refuses an answer whose children do not tile - the arm is judged on the pipeline's rules", () => {
    const blocks = Array.from({ length: 6 }, () => block());
    expect(() => parseStructureResponse(answer(blocks, [[0, 3], [2, 5]]), blocks, "overlap"))
      .toThrow(/tile/);
  });
});

describe("runModelArm", () => {
  it("every paid arm fails closed outside a ledger: no spend row means no request at all", async () => {
    // withDeclaredExternalCall checks for an open ledger BEFORE any HTTP is
    // possible, so under vitest (no ledger) a paid arm rejects loudly and no
    // request leaves the machine. The key may also be absent; either error is
    // the closed path. All three strategies, so a new executor cannot quietly
    // acquire a different first step.
    const blocks = [heading(2, "One"), block()];
    for (const name of ["incumbent", "waves", "cheap-then-revise"]) {
      await expect(runModelArm(armByName(name), blocks, "no-ledger")).rejects.toThrow(
        /ledger|OPENROUTER_API_KEY/,
      );
    }
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

  it("boundary distance is tolerant where jaccard is absolute: a one-block move is 1, not 0%", () => {
    const blocks = Array.from({ length: 10 }, () => block());
    const a = treeFrom(blocks, withGists({
      range: [0, 9],
      children: [{ range: [0, 2] }, { range: [3, 5] }, { range: [6, 9] }],
    }));
    // The same carving with each cut moved one block later: {3,6} -> {4,7}.
    const b = treeFrom(blocks, withGists({
      range: [0, 9],
      children: [{ range: [0, 3] }, { range: [4, 6] }, { range: [7, 9] }],
    }));
    const agreement = compareTrees(blocks, a, b);
    expect(agreement.allBoundaries).toBe(0); // exact jaccard reads total disagreement
    expect(agreement.boundaryDistance).toEqual({ mean: 1, within1Block: 1 });
  });
});

describe("the corpus manifest", () => {
  it("has one entry per slug, hashes shaped like sha256, and duplicates naming a real canonical", () => {
    const slugs = CORPUS.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const e of CORPUS) {
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
      if (e.role === "duplicate") {
        const canonical = CORPUS.find((c) => c.slug === e.duplicateOf);
        expect(canonical?.role).toBe("dev");
      }
    }
  });

  it("keeps duplicates and the fixture out of every default run", () => {
    const defaults = defaultCorpus();
    expect(defaults.every((e) => e.role === "dev" || e.role === "heldout")).toBe(true);
    expect(defaults.map((e) => e.slug)).not.toContain("source");
    expect(defaults.map((e) => e.slug)).not.toContain("source-2");
    expect(defaults.map((e) => e.slug)).not.toContain("example");
  });

  it("pins the fixture's bytes: example/blocks.json still matches its manifest hash", () => {
    // The one corpus file that is committed, so the hash can be verified in a
    // test without depending on the gitignored data/ directory.
    const entry = CORPUS.find((e) => e.slug === "example")!;
    const measured = createHash("sha256")
      .update(readFileSync("example/blocks.json"))
      .digest("hex");
    expect(measured).toBe(entry.sha256);
  });
});

describe("the arms registry", () => {
  it("labels every arm's claim, and the noise floor is byte-identical to the incumbent", () => {
    for (const arm of ARMS) expect(arm.comparison).toBeTruthy();
    const incumbent = armByName("incumbent");
    const repeat = armByName("incumbent-repeat");
    if (incumbent.kind === "one-call" && repeat.kind === "one-call") {
      expect(repeat.call).toEqual(incumbent.call);
      expect(repeat.seed).toBe(incumbent.seed);
    } else {
      throw new Error("incumbent arms changed kind — update this test deliberately");
    }
    const waves = armByName("waves");
    if (waves.kind !== "waves") throw new Error("waves changed kind");
    expect(waves.levels).toBeGreaterThanOrEqual(3); // the book-length motivation needs L3
  });
});

describe("assertCallAccounted", () => {
  const stats = (over: Partial<CallStats>): CallStats => ({
    ms: 1000,
    inputTokens: 27_000,
    outputTokens: 18_000,
    reasoningTokens: 13_000,
    generationId: "gen-abc",
    costUsd: 0.24,
    providerCostUsd: 0.24,
    ...over,
  });

  it("passes when tokens arrived and the two cost sources agree", () => {
    expect(() => assertCallAccounted(stats({}), "t")).not.toThrow();
  });

  it("passes on a single cost source - the other may legitimately be absent", () => {
    expect(() => assertCallAccounted(stats({ costUsd: null }), "t")).not.toThrow();
    expect(() => assertCallAccounted(stats({ providerCostUsd: null }), "t")).not.toThrow();
  });

  it("fails loudly when a paid call reports no tokens", () => {
    expect(() => assertCallAccounted(stats({ inputTokens: null }), "t")).toThrow(/no token usage/);
    expect(() => assertCallAccounted(stats({ outputTokens: null }), "t")).toThrow(/no token usage/);
  });

  it("fails loudly when no cost source answered - a paid arm must not score as free", () => {
    expect(() =>
      assertCallAccounted(stats({ costUsd: null, providerCostUsd: null }), "t"),
    ).toThrow(/must not score as free/);
  });

  it("fails loudly when the two cost sources disagree beyond 10%", () => {
    // 0.24 vs 0.30 is a 20% gap against the provider's number.
    expect(() => assertCallAccounted(stats({ costUsd: 0.24, providerCostUsd: 0.3 }), "t")).toThrow(
      /disagree/,
    );
    // 0.24 vs 0.25 is a 4% gap: within rounding and billing lag.
    expect(() =>
      assertCallAccounted(stats({ costUsd: 0.24, providerCostUsd: 0.25 }), "t"),
    ).not.toThrow();
  });
});

describe("renderHeadingList", () => {
  it("lists exactly the body headings, with their positions and levels", () => {
    const blocks = [
      block(),
      heading(2, "First"),
      block(),
      heading(3, "Deeper"),
      block({ role: "footnote", treatment: "supplement", text: "a note" }),
    ];
    const list = renderHeadingList(blocks);
    expect(list).toContain("[1] h2: First");
    expect(list).toContain("[3] h3: Deeper");
    expect(list).not.toContain("a note");
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

  it("renders a seed proposal the model could echo back verbatim", () => {
    const blocks = [
      heading(2, "Section A"),
      block(),
      heading(2, "Section B"),
      block(),
      heading(2, "Section C"),
      block(),
    ];
    const proposal = renderSeedProposal(blocks, "seeded");
    // The JSON half must be machine-valid on its own; the prose half sits above it.
    const jsonStart = proposal.indexOf("{");
    const parsed = JSON.parse(proposal.slice(jsonStart)) as {
      root: { range: [string, string]; children?: { sourceHeading?: string }[] };
    };
    expect(parsed.root.range).toEqual([blocks[0]!.id, blocks[5]!.id]);
    expect(parsed.root.children).toHaveLength(3);
    expect(parsed.root.children![0]!.sourceHeading).toBe("Section A");
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

describe("throwAnatomy", () => {
  it("pulls kind, size and depth out of the tiling messages verbatim", async () => {
    const { throwAnatomy } = await import("../evals/toc-structure/floor.js");
    expect(
      throwAnatomy(
        "The children of the node at root > child 2 do not tile it: child 1 leaves a gap of 1 block(s). Children must cover…",
      ),
    ).toEqual({ kind: "gap", size: 1, depth: 1 });
    expect(
      throwAnatomy(
        "The children of the node at root > child 3 > child 4 do not tile it: child 2 overlaps the one before it by 5 block(s).",
      ),
    ).toEqual({ kind: "overlap", size: 5, depth: 2 });
    expect(
      throwAnatomy("The children of the node at root stop 3 block(s) before it ends. Those paragraphs…"),
    ).toEqual({ kind: "short-at-end", size: 3, depth: 0 });
  });

  it("a reworded message becomes unparsed, never zero and never a keyword-fished bin", async () => {
    // The control: if assertChildrenPartition's wording drifts, the count must
    // move to `unparsed` rather than to "no tiling failures" - a parser going
    // quiet is the exact shape this repo keeps writing postmortems about.
    const { throwAnatomy } = await import("../evals/toc-structure/floor.js");
    const reworded =
      "The node at root > child 2 is not tiled by its children: a gap of 1 block was left by child 1.";
    expect(throwAnatomy(reworded)).toEqual({ kind: "unparsed", size: null, depth: null });
    // A different failure entirely - also unparsed, not silently binned.
    expect(throwAnatomy("the model refused the structure request").kind).toBe("unparsed");
  });
});
