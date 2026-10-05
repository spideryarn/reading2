/**
 * **The tree a document gets when no model can be asked for one** —
 * `buildBoundedHeadingTree` (src/heading-tree.ts), stage D of
 * docs/plans/261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md.
 *
 * It has to be the shape a model's tree is (root, parts, sections, every
 * paragraph at depth 3) with no section longer than one labels batch, because
 * the two things downstream of it were only ever built for that shape: the
 * labels planner (src/labels.ts § `planBatches`) and the client's one section
 * depth for the whole article (src/web/position.ts § `sectionDepth`).
 *
 * Every `describe` but the last was watched red against the one-line version
 * the plan passed over (`buildHeadingTree` in its place) before the builder
 * was written; the last by changing `subLevelOf`, a rule the two now share.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BOUNDED_TREE_GENERATOR,
  BOUNDED_TREE_VERSION,
  buildBoundedHeadingTree,
  buildHeadingTree,
  HEADING_TREE_GENERATOR,
  HEADING_TREE_VERSION,
  UNTITLED_WINDOW_TITLE,
} from "../src/heading-tree.js";
import { MAX_BATCH, mergeLabels, planBatches } from "../src/labels.js";
import { isSupplementNode } from "../src/supplement.js";
import { checkTree } from "../src/tree-invariants.js";
import type { Block, Tree, TreeNode } from "../src/types.js";
import { buildSections } from "../src/web/position.js";
import { buildGeometry } from "../src/web/tree.js";
import {
  block,
  bodyLeafSets,
  expectBoundedTree,
  expectPlannable,
  heading,
  LARGEST_PLANNED_BATCH,
  note,
  paragraphs,
} from "./helpers/bounded-tree.js";

/** One long chapter beside a short one: review F1's document. */
const longBesideShort = (): Block[] => [
  heading("The Long Chapter"),
  ...paragraphs(300),
  heading("The Short Chapter"),
  ...paragraphs(5),
  heading("The Middling Chapter"),
  ...paragraphs(70),
];

/** Chapters with sub-headings, one sub-section too long, beside chapters with none. */
const mixedSubheadings = (): Block[] => [
  ...paragraphs(1),
  heading("Chapter One"),
  ...paragraphs(4),
  heading("One point one", 3),
  ...paragraphs(10),
  heading("One point two", 3),
  ...paragraphs(150),
  heading("One point three", 3),
  ...paragraphs(10),
  heading("Chapter Two"),
  ...paragraphs(8),
  heading("Chapter Three"),
  ...paragraphs(6),
  heading("Three point one", 3),
  ...paragraphs(6),
  heading("Chapter Four"),
  ...paragraphs(1),
];

const headingless = (n: number): Block[] => paragraphs(n);

const withNotes = (blocks: Block[]): Block[] => [...blocks, ...Array.from({ length: 90 }, (_, i) => note(i))];

const DOCUMENTS: [string, () => Block[]][] = [
  ["one long chapter beside a short one", longBesideShort],
  ["mixed sub-headings", mixedSubheadings],
  ["no headings at all", () => headingless(500)],
  ["no headings, and barely enough blocks", () => headingless(4)],
  ["one heading, which is a title", () => [heading("Only a Title", 1), ...paragraphs(200)]],
];

const node = (tree: Tree, id: string): TreeNode => tree.nodes[id]!;
const parts = (tree: Tree): TreeNode[] =>
  node(tree, tree.rootId).children.map((id) => node(tree, id)).filter((n) => !isSupplementNode(n));
const sectionStartingAt = (tree: Tree, b: Block): TreeNode =>
  Object.values(tree.nodes).find((n) => n.depth === 2 && n.range[0] === b.id)!;

describe("a bounded headings tree has a model tree's shape", () => {
  for (const [name, make] of DOCUMENTS) {
    it(`${name}`, () => {
      const blocks = make();
      expectBoundedTree(blocks, buildBoundedHeadingTree(blocks, "bounded").tree);
    });
    it(`${name}, with endnotes after it`, () => {
      const blocks = withNotes(make());
      const { tree } = buildBoundedHeadingTree(blocks, "bounded");
      expectBoundedTree(blocks, tree);
      /* The supplement is appended after the windows are cut and is exempt:
         ninety notes stay one node of ninety leaves. */
      const supplement = Object.values(tree.nodes).find((n) => isSupplementNode(n))!;
      expect(supplement.children).toHaveLength(90);
    });
  }

  it("says it is not a model's work, and not the eval arm's either", () => {
    const { tree } = buildBoundedHeadingTree(longBesideShort(), "bounded");
    expect(tree.version).toBe(BOUNDED_TREE_VERSION);
    expect(tree.generator).toBe(BOUNDED_TREE_GENERATOR);
    expect(tree.version).not.toBe(HEADING_TREE_VERSION);
    expect(tree.generator).not.toBe(HEADING_TREE_GENERATOR);
  });

  it("keeps the author's chapters as the parts, and cuts a long one into windows", () => {
    const blocks = longBesideShort();
    const built = buildBoundedHeadingTree(blocks, "bounded");
    expect(built.flat).toBe(false);
    expect(parts(built.tree).map((p) => p.sourceHeading)).toEqual([
      "The Long Chapter",
      "The Short Chapter",
      "The Middling Chapter",
    ]);
    /* 301 blocks in near-equal windows of at most 60 is six of them. */
    expect(parts(built.tree)[0]!.children).toHaveLength(Math.ceil(301 / MAX_BATCH));
    /* A chapter too small to need cutting still has two sections: one that
       covered the whole chapter would restate it, which checkTree refuses. */
    expect(parts(built.tree)[1]!.children).toHaveLength(2);
  });

  it("uses the author's sub-headings as sections where a chapter has them", () => {
    const { tree } = buildBoundedHeadingTree(mixedSubheadings(), "bounded");
    const titles = Object.values(tree.nodes).filter((n) => n.depth === 2).map((n) => n.sourceHeading);
    expect(titles).toEqual(expect.arrayContaining(["One point one", "One point two", "One point three", "Three point one"]));
  });

  it("refuses a body too short to have two parts of two sections", () => {
    expect(() => buildBoundedHeadingTree(headingless(3), "bounded")).toThrow(/at least 4/);
  });
});

describe("the labels planner over a bounded tree", () => {
  for (const [name, make] of DOCUMENTS) {
    for (const notes of [false, true]) {
      it(`${name}${notes ? ", with endnotes" : ""}: every block in one batch, none too big`, () => {
        const blocks = notes ? withNotes(make()) : make();
        expectPlannable(blocks, buildBoundedHeadingTree(blocks, "bounded").tree);
      });
    }
  }

  it("really does plan a batch bigger than any section, and exactly the planner's largest", () => {
    /* Review F6's document: after a long chapter, sections of 12, 60 and 12.
       The 12 is too small to send alone so it takes the 60, and the tail 12 is
       merged back in. */
    const blocks = [
      heading("A"),
      ...paragraphs(2999),
      heading("B"),
      ...paragraphs(11),
      heading("B one", 3),
      ...paragraphs(59),
      heading("B two", 3),
      ...paragraphs(11),
    ];
    const { tree } = buildBoundedHeadingTree(blocks, "bounded");
    expectPlannable(blocks, tree);
    const largest = Math.max(...planBatches(mergeLabels(tree, {}), blocks).map((b) => b.blocks.length));
    expect(largest).toBe(LARGEST_PLANNED_BATCH);
  });
});

describe("the client's section list over a bounded tree", () => {
  for (const [name, make] of DOCUMENTS) {
    it(`${name}: every section has a title and none is a paragraph`, () => {
      const blocks = withNotes(make());
      const tree = mergeLabels(buildBoundedHeadingTree(blocks, "bounded").tree, {});
      const sections = buildSections(buildGeometry(tree, blocks), blocks);
      expect(sections.length).toBeGreaterThan(1);
      expect(sections.filter((s) => s.title.trim() === "")).toEqual([]);
      expect(sections.filter((s) => node(tree, s.nodeId).children.length === 0)).toEqual([]);
      /* And they are the tree's own sections, not its parts or its leaves. */
      expect(sections.filter((s) => !s.supplement).length).toBe(bodyLeafSets(tree).length);
    });
  }
});

describe("no internal node is ever untitled", () => {
  it("an empty or whitespace article title falls through to the first heading with words", () => {
    const blocks = [heading(""), ...paragraphs(3), heading("The Real First Heading"), ...paragraphs(3)];
    for (const title of ["", "   \n"]) {
      const { tree } = buildBoundedHeadingTree(blocks, "the-slug", title);
      expect(node(tree, tree.rootId).title).toBe("The Real First Heading");
    }
    const given = buildBoundedHeadingTree(blocks, "the-slug", " Given ").tree;
    expect(node(given, given.rootId).title).toBe("Given");
  });

  it("and then to the slug", () => {
    const { tree } = buildBoundedHeadingTree(headingless(8), "the-slug", " ");
    expect(node(tree, tree.rootId).title).toBe("the-slug");
  });

  it("a heading with no text titles neither a part nor a section", () => {
    const blocks = [
      heading(""),
      ...paragraphs(30),
      heading("", 3),
      ...paragraphs(30),
      heading("  ", 3),
      ...paragraphs(30),
      heading("A Named Chapter"),
      ...paragraphs(30),
      heading("Another Named Chapter"),
      ...paragraphs(30),
    ];
    const { tree } = buildBoundedHeadingTree(blocks, "bounded");
    expectBoundedTree(blocks, tree);
    const claimed = Object.values(tree.nodes).filter((n) => n.sourceHeading !== undefined);
    expect(claimed.filter((n) => n.sourceHeading!.trim() === "")).toEqual([]);
  });

  it("a window is titled by its opening words, cut at a word, and claims no heading", () => {
    const blocks = headingless(240);
    const { tree } = buildBoundedHeadingTree(blocks, "bounded");
    const window = sectionStartingAt(tree, blocks[60]!);
    expect(window.title).toBe("Paragraph 60 runs on for long enough to…");
    expect(window.sourceHeading).toBeUndefined();
    expect(checkTree(blocks, tree).advice.filter((a) => a.includes("title"))).toEqual([]);
  });

  it("a short opening block is quoted whole, without its full stop or an ellipsis", () => {
    const blocks = headingless(240);
    blocks[60] = block("Thank you all.");
    const { tree } = buildBoundedHeadingTree(blocks, "bounded");
    expect(sectionStartingAt(tree, blocks[60]!).title).toBe("Thank you all");
  });

  it("a window that opens on a block with no words takes the first that has some", () => {
    const blocks = headingless(240);
    blocks[60] = block("", { kind: "media", tag: "figure", gistable: false });
    const { tree } = buildBoundedHeadingTree(blocks, "bounded");
    expectBoundedTree(blocks, tree);
    expect(sectionStartingAt(tree, blocks[60]!).title).toBe("Paragraph 61 runs on for long enough to…");
  });

  it("and a window with no words in it at all wears the stock title", () => {
    const blocks = headingless(240);
    for (let i = 120; i < 180; i++) blocks[i] = block("", { kind: "media", tag: "figure", gistable: false });
    const { tree } = buildBoundedHeadingTree(blocks, "bounded");
    expectBoundedTree(blocks, tree);
    expect(sectionStartingAt(tree, blocks[120]!).title).toBe(UNTITLED_WINDOW_TITLE);
  });
});

describe("buildHeadingTree, the structure eval's control arm, is unchanged", () => {
  /* Digests of its output at fae022d34, the commit before the bounded builder
     shared its rules: no title, a title, and the stub threshold at 0 and 40.
     Made by running exactly this over that commit's src/heading-tree.ts. */
  const PINNED: [string, string][] = [
    ["example/blocks.json", "c2637d82fd0a1831"],
    ["tests/fixtures/structures.blocks.json", "c57c600e22fd3239"],
    ["tests/fixtures/data-root/output/constitution.blocks.json", "55d8a82fba064f58"],
    ["tests/fixtures/data-root/output/noema-mythology-of-conscious-ai.blocks.json", "23bd7f47cb011dbf"],
    ["tests/fixtures/data-root/output/openai-huggingface.blocks.json", "9cb8b97b81cbd753"],
    ["tests/fixtures/data-root/output/todo.blocks.json", "5f407c928af66cee"],
    ["tests/fixtures/data-root/output/writes.blocks.json", "bf43c61d7d41afaf"],
  ];
  for (const [file, digest] of PINNED) {
    it(file, () => {
      const blocks = (JSON.parse(readFileSync(file, "utf8")) as { blocks: Block[] }).blocks;
      const variants = [
        buildHeadingTree(blocks, "pinned"),
        buildHeadingTree(blocks, "pinned", "A Title"),
        buildHeadingTree(blocks, "pinned", undefined, 0),
        buildHeadingTree(blocks, "pinned", undefined, 40),
      ];
      expect(createHash("sha256").update(JSON.stringify(variants)).digest("hex").slice(0, 16)).toBe(digest);
    });
  }
});
