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
  REPEATED_HEADING_MIN,
  UNTITLED_WINDOW_TITLE,
} from "../src/heading-tree.js";
import { labelCallBudget, MAX_BATCH, mergeLabels, planBatches } from "../src/labels.js";
import { isSupplementNode } from "../src/supplement.js";
import { checkTree } from "../src/tree-invariants.js";
import type { Block, Tree, TreeNode } from "../src/types.js";
import { buildSections } from "../src/web/position.js";
import { buildGeometry, titleVoice } from "../src/web/tree.js";
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

describe("whose words a bounded tree's titles are drawn as", () => {
  it("never the model's, on a tree no model wrote", () => {
    for (const [, make] of DOCUMENTS) {
      const blocks = withNotes(make());
      const { tree } = buildBoundedHeadingTree(blocks, "bounded");
      const voices = Object.values(tree.nodes)
        .filter((n) => n.children.length > 0 && n.depth > 0)
        .map((n) => titleVoice(n));
      expect(voices.filter((v) => v === "ai")).toEqual([]);
      expect(voices).toContain("author");
    }
  });

  it("a window quoting its opening words says so, and one wearing a heading does not", () => {
    const blocks = longBesideShort();
    const { tree } = buildBoundedHeadingTree(blocks, "bounded");
    const windows = Object.values(tree.nodes).filter((n) => n.depth === 2);
    expect(windows.every((n) => n.titleFrom === "opening-words" && n.sourceHeading === undefined)).toBe(true);
    expect(parts(tree).every((n) => n.titleFrom === undefined && n.sourceHeading !== undefined)).toBe(true);
  });
});

describe("what a transcribed PDF leaves lying about does not name a section", () => {
  /* From the real 250-page book: scene breaks ("#", 109 paragraphs of it), stray
     page numbers and a contents line with dot leaders were opening a window and
     so titling it. */
  it("a heading with no letters in it neither cuts nor titles", () => {
    const blocks = [
      heading("First Chapter"),
      ...paragraphs(10),
      heading("* * *"),
      ...paragraphs(10),
      heading("36"),
      ...paragraphs(10),
      heading("Second Chapter"),
      ...paragraphs(10),
    ];
    const { tree } = buildBoundedHeadingTree(blocks, "bounded");
    expectBoundedTree(blocks, tree);
    expect(parts(tree).map((p) => p.title)).toEqual(["First Chapter", "Second Chapter"]);
    const titles = Object.values(tree.nodes).filter((n) => n.children.length > 0).map((n) => n.title);
    expect(titles.filter((t) => t === "36" || t === "* * *")).toEqual([]);
  });

  it("a window is titled by its first block with three real words, not a scene break or a page number", () => {
    const blocks = headingless(240);
    blocks[60] = block("#");
    blocks[61] = block("36");
    blocks[62] = block("Oh.");
    blocks[63] = block("“35,” she said.");
    const { tree } = buildBoundedHeadingTree(blocks, "bounded");
    expectBoundedTree(blocks, tree);
    expect(sectionStartingAt(tree, blocks[60]!).title).toBe("Paragraph 64 runs on for long enough to…");
  });

  it("and falls back to the first block with any words when none has three", () => {
    const blocks = headingless(240);
    for (let i = 120; i < 180; i++) blocks[i] = block(i === 120 ? "#" : "Oh.");
    const { tree } = buildBoundedHeadingTree(blocks, "bounded");
    expectBoundedTree(blocks, tree);
    expect(sectionStartingAt(tree, blocks[120]!).title).toBe("#");
  });

  it("dot leaders are dropped from an opening-words title, and an ellipsis is not", () => {
    const blocks = headingless(240);
    blocks[60] = block("The Constitutional Crisis . . . . . . . . . . . . 119");
    blocks[120] = block("More Power Punctuation!......... 201");
    blocks[180] = block("Well... I thought so.");
    const { tree } = buildBoundedHeadingTree(blocks, "bounded");
    expect(sectionStartingAt(tree, blocks[60]!).title).toBe("The Constitutional Crisis 119");
    expect(sectionStartingAt(tree, blocks[120]!).title).toBe("More Power Punctuation! 201");
    expect(sectionStartingAt(tree, blocks[180]!).title).toBe("Well... I thought so");
  });
});

describe("a heading repeated down the document is page furniture, not a section", () => {
  /* A PDF's running header is transcribed as a heading block on most pages. A
     real 250-page book came out as 76 parts, 58 of them wearing the book's own
     title, before this rule. */
  const internalTitles = (tree: Tree): string[] =>
    Object.values(tree.nodes).filter((n) => n.children.length > 0 && n.depth > 0).map((n) => n.title);

  /** Twelve chapters of 72 paragraphs, with `running` as a heading every twelfth block. */
  const book = (running: string): Block[] =>
    Array.from({ length: 12 }, (_, c) => [
      heading(`Chapter ${c} of the book`),
      ...paragraphs(72).flatMap((p, i) => (i % 12 === 6 ? [heading(running), p] : [p])),
    ]).flat();

  it("a running title on every page cuts nothing and titles nothing", () => {
    const blocks = book("Running Title");
    expect(blocks.filter((b) => b.text === "Running Title").length).toBeGreaterThan(60);
    const built = buildBoundedHeadingTree(blocks, "bounded");
    expectBoundedTree(blocks, built.tree);
    expectPlannable(blocks, built.tree);
    expect(parts(built.tree).map((p) => p.title)).toEqual(
      Array.from({ length: 12 }, (_, c) => `Chapter ${c} of the book`),
    );
    expect(internalTitles(built.tree).filter((t) => t.includes("Running"))).toEqual([]);
    /* Its blocks are still there, as leaves. */
    expect(Object.keys(built.tree.nodes).length).toBeGreaterThan(blocks.length);
  });

  it("the same when the typography differs, by the repo's own heading comparison", () => {
    const blocks = book("Doctorow’s Book").map((b, i) =>
      b.text === "Doctorow’s Book" && i % 2 ? { ...b, text: "Doctorow's  Book" } : b,
    );
    expect(parts(buildBoundedHeadingTree(blocks, "bounded").tree)).toHaveLength(12);
  });

  it("a heading repeated fewer times than the threshold still cuts", () => {
    expect(REPEATED_HEADING_MIN).toBe(5);
    const blocks = Array.from({ length: REPEATED_HEADING_MIN - 1 }, () => [heading("Exercises"), ...paragraphs(10)]).flat();
    const built = buildBoundedHeadingTree(blocks, "bounded");
    expectBoundedTree(blocks, built.tree);
    expect(parts(built.tree).map((p) => p.title)).toEqual(Array(REPEATED_HEADING_MIN - 1).fill("Exercises"));
  });

  it("and at the threshold does not", () => {
    const blocks = Array.from({ length: REPEATED_HEADING_MIN }, () => [heading("Exercises"), ...paragraphs(10)]).flat();
    const built = buildBoundedHeadingTree(blocks, "bounded");
    expectBoundedTree(blocks, built.tree);
    expect(built.flat).toBe(true);
    expect(internalTitles(built.tree)).not.toContain("Exercises");
  });

  it("the article's own title, twice as a heading, does not cut", () => {
    const blocks = [
      heading("The Book"),
      ...paragraphs(10),
      heading("One"),
      ...paragraphs(10),
      heading("The Book"),
      ...paragraphs(10),
      heading("Two"),
      ...paragraphs(10),
    ];
    const titled = buildBoundedHeadingTree(blocks, "bounded", " The Book ");
    expectBoundedTree(blocks, titled.tree);
    expect(internalTitles(titled.tree)).not.toContain("The Book");
    /* The prose before "One" is a part of its own, named by its opening words. */
    expect(parts(titled.tree).map((p) => p.title)).toEqual([expect.stringMatching(/^Paragraph .*…$/), "One", "Two"]);
    /* Without a title to match, twice is under the threshold and it cuts. */
    expect(parts(buildBoundedHeadingTree(blocks, "bounded").tree).map((p) => p.title)).toContain("The Book");
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

describe("adversarial body and supplement shapes", () => {
  const cases: [string, () => Block[]][] = [
    ["five body blocks", () => paragraphs(5)],
    ["a final heading after prose", () => [...paragraphs(7), heading("Last", 6)]],
    ["only headings at odd levels", () => Array.from({ length: 125 }, (_, i) => heading(`Heading ${i}`, [1, 6, 3, 5][i % 4]!))],
    ["only empty and whitespace headings", () => Array.from({ length: 125 }, (_, i) => heading(i % 2 ? " \n " : "", 6))],
    ["only figures", () => Array.from({ length: 125 }, () => block("", { tag: "figure", kind: "media", gistable: false }))],
    ["only nonstructural text", () => paragraphs(125).map((b) => ({ ...b, gistable: false }))],
    ["one-block parts beside a long part", () => [heading("First"), block("Small"), heading("Second"), block("Small"), heading("Long"), ...paragraphs(70)]],
    ["a stranded supplement", () => [...paragraphs(2), note(0), ...paragraphs(5), note(1)]],
    ["only supplements", () => Array.from({ length: 8 }, (_, i) => note(i))],
  ];
  for (const [name, make] of cases) {
    for (const tail of [false, true]) {
      it(`${name}${tail ? ", with several supplement groups" : ""}`, () => {
        const body = make();
        const blocks: Block[] = tail ? [...body, note(0), { ...note(1), role: "reference" },
          { ...note(2), role: "credit" }, note(3)] : body;
        const tree = mergeLabels(buildBoundedHeadingTree(blocks, "adversarial").tree, {});
        expectBoundedTree(blocks, tree);
        expectPlannable(blocks, tree);
        for (const batch of planBatches(tree, blocks)) expect(() => labelCallBudget(batch.blocks.length)).not.toThrow();
        const sections = buildSections(buildGeometry(tree, blocks), blocks);
        expect(sections.length).toBeGreaterThan(0);
        expect(sections.every((s) => s.title.trim() !== "" && tree.nodes[s.nodeId]!.children.length > 0)).toBe(true);
      });
    }
  }
});
