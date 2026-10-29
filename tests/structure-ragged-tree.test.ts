/**
 * **The reading view on a ragged tree** — plan 261029a § Stage 1
 * (docs/plans/261029a-structure-one-level-deeper.md).
 *
 * One section divided into sub-sections while its neighbours are not, before
 * anything in the pipeline makes such a tree. Two promises, and they pull in
 * opposite directions:
 *
 * - **Outside Structure, a sub-section is inside its section.** `?at=`, Quiz's
 *   "where to look again", the return chip and the crumbs keep the section
 *   level (position.ts § `sectionDepth`, now capped at 2).
 * - **Structure goes one level deeper.** Its "you are here" and its ← / → read
 *   the frontier (position.ts § `structureFrontier`), its list draws the
 *   current section's sub-sections, and Expanded draws them as sections.
 *
 * And the third, which makes the first two safe to ship: **on every tree
 * production holds today, nothing changes** — the identity tests at the
 * bottom, each seen red against a deliberately wrong version first.
 *
 * The panel's own rendering is tests/structure-ragged-tree-panel.test.tsx.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildHeadingTree } from "../src/heading-tree.js";
import { appendSupplement, splitBlocks } from "../src/supplement.js";
import { checkTree } from "../src/tree-invariants.js";
import type { Block, BlockId, NodeId, QuizQuestion, Tree, TreeNode } from "../src/types.js";
import { navPlan, stepTarget } from "../src/web/keynav.js";
import { outlineProjection, type Rung } from "../src/web/outline.js";
import { buildSections, sectionDepth, structureFrontier } from "../src/web/position.js";
import { sectionsOfQuestion, sectionTally } from "../src/web/quiz-sections.js";
import { structureProjection } from "../src/web/structure.js";
import { buildGeometry, buildSummaryTree, navigableItems } from "../src/web/tree.js";
import { raggedArticle } from "./fixtures/ragged-tree.js";

const ragged = raggedArticle();
const geometry = buildGeometry(ragged.tree, ragged.blocks);
const summary = buildSummaryTree(ragged.tree, ragged.blocks, geometry.leafDepth);
const rowsOf = new Map(ragged.blocks.map((b, i) => [b.id, i] as const));

const SUB_SECTIONS = [
  "2.4.1 Attention Schema Theory",
  "2.4.2 Predictive Processing",
  "2.4.3 Midbrain Theory",
  "2.4.4 Unlimited Associative Learning",
  "2.4.5 Agency and Embodiment",
  "2.4.6 Time and Recurrence",
];
const SECTIONS = [
  "1.1 Terminology",
  "1.2 Methods and Assumptions",
  "Aims of the Survey",
  "2.1 Recurrent Processing Theory",
  "2.2 Global Workspace Theory",
  "2.3 Higher-Order Theories",
  "2.4 Other Theories and Conditions",
  "3.1 Implementing Indicator Properties in AI",
  "3.2 Case Studies",
];
const IN_MIDBRAIN = ragged.rowOf("2.4.3 Midbrain Theory") + 1;
/** The paragraph 2.4 opens with, before 2.4.1 — in 2.4 and in no sub-section. */
const IN_24_INTRO = ragged.rowOf("2.4 Other Theories and Conditions");
const IN_21 = ragged.rowOf("2.1 Recurrent Processing Theory") + 1;

describe("the ragged fixture", () => {
  it("is a sound tree, and ragged: leaves at depth 3 and at depth 4", () => {
    /* A precondition, not a formality — every claim below is about a tree the
       invariants accept, not about a malformed one drawn short. */
    expect(checkTree(ragged.blocks, ragged.tree).problems).toEqual([]);
    const leafDepths = new Set(
      Object.values(ragged.tree.nodes)
        .filter((n) => n.children.length === 0)
        .map((n) => n.depth),
    );
    expect(leafDepths).toEqual(new Set([3, 4]));
    expect(geometry.leafDepth).toBe(4);
  });

  it("is still sound with the apparatus appended", () => {
    const withNotes = raggedArticle({ notes: 4 });
    expect(checkTree(withNotes.blocks, withNotes.tree).problems).toEqual([]);
  });
});

describe("buildGeometry: a leaf is real only in the leaf column (PR-3)", () => {
  const cellAt = (column: number, row: number) => {
    let start = 0;
    for (const cell of geometry.cells[column] ?? []) {
      if (row < start + cell.rowSpan) return cell;
      start += cell.rowSpan;
    }
    return undefined;
  };

  it("draws an undeepened branch's leaf as a continuation in the sub-sections' column", () => {
    const row = ragged.rowOf("2.1 Recurrent Processing Theory");
    const sub = cellAt(3, row)!;
    expect(sub.node.children).toEqual([]);
    expect(sub.continuation).toBe(true);
    const leaf = cellAt(4, row)!;
    expect(leaf.node.id).toBe(sub.node.id);
    expect(leaf.continuation).toBe(false);
  });

  it("does the same for the paragraph a divided section opens with", () => {
    expect(cellAt(3, IN_24_INTRO)!.continuation).toBe(true);
    expect(cellAt(4, IN_24_INTRO)!.continuation).toBe(false);
  });

  it("draws a sub-section as real content in its own column, and its leaf in the leaf column", () => {
    const sub = cellAt(3, IN_MIDBRAIN)!;
    expect(sub.node.title).toBe("2.4.3 Midbrain Theory");
    expect(sub.continuation).toBe(false);
    expect(cellAt(4, IN_MIDBRAIN)!.continuation).toBe(false);
  });

  it("tiles every column, and puts the apparatus's notes in the leaf column too", () => {
    const withNotes = raggedArticle({ notes: 3 });
    const geo = buildGeometry(withNotes.tree, withNotes.blocks);
    for (const column of geo.cells) {
      expect(column.reduce((n, c) => n + c.rowSpan, 0)).toBe(withNotes.blocks.length);
    }
    const lastColumn = (column: number) => geo.cells[column]!.at(-1)!;
    // A note is a leaf at depth 2: a continuation in columns 2 and 3, real in 4.
    expect(lastColumn(2).continuation).toBe(true);
    expect(lastColumn(3).continuation).toBe(true);
    expect(lastColumn(4).continuation).toBe(false);
    expect(lastColumn(4).node.children).toEqual([]);
  });
});

describe("buildSections keeps the section level on a ragged tree (item 1)", () => {
  it("lists the sections, with 2.4 once and none of its sub-sections", () => {
    expect(sectionDepth(geometry)).toBe(2);
    expect(buildSections(geometry, ragged.blocks).map((s) => s.title)).toEqual(SECTIONS);
  });

  it("caps at depth 2 on a uniformly deeper tree, and still clamps at 1", () => {
    const at = (leafDepth: number) => sectionDepth({ ...geometry, leafDepth });
    expect([at(1), at(2), at(3), at(4), at(5)]).toEqual([1, 1, 2, 2, 2]);
  });

  it("puts a block in a sub-section into its section, for ?at= and the return chip", () => {
    const sections = buildSections(geometry, ragged.blocks);
    const i = sections.findIndex((s) => s.row > IN_MIDBRAIN) - 1;
    expect(sections[i]?.title).toBe("2.4 Other Theories and Conditions");
  });
});

describe("structureFrontier (item 2)", () => {
  it("goes down to the sub-sections where the article has them, and stays at the sections elsewhere", () => {
    expect(structureFrontier(geometry, ragged.blocks).map((s) => s.title)).toEqual([
      ...SECTIONS.slice(0, 7),
      ...SUB_SECTIONS,
      ...SECTIONS.slice(7),
    ]);
  });

  it("names 2.4 itself for the paragraph it opens with, starting on 2.4's first row", () => {
    const frontier = structureFrontier(geometry, ragged.blocks);
    const own = frontier.find((s) => s.title === "2.4 Other Theories and Conditions")!;
    expect(own.row).toBe(IN_24_INTRO);
    expect(own.blockId).toBe(ragged.blocks[IN_24_INTRO]!.id);
  });

  it("collapses the apparatus to one entry, as the section list does (shape: supplement)", () => {
    const withNotes = raggedArticle({ notes: 5 });
    const geo = buildGeometry(withNotes.tree, withNotes.blocks);
    const frontier = structureFrontier(geo, withNotes.blocks);
    const apparatus = frontier.filter((s) => s.supplement);
    expect(apparatus.map((s) => s.title)).toEqual(["Notes"]);
    expect(apparatus[0]!.row).toBe(withNotes.blocks.length - 5);
    expect(frontier.at(-1)?.title).toBe("Notes");
  });

  it("keeps the section-level leaves under a shallow part (shape: part with leaves)", () => {
    const { tree, blocks } = partWithLeaves();
    expect(checkTree(blocks, tree).problems).toEqual([]);
    const geo = buildGeometry(tree, blocks);
    const sections = buildSections(geo, blocks);
    expect(sections.map((s) => s.nodeId)).toEqual(["l0", "l1", "l2", "s1", "s2"]);
    expect(structureFrontier(geo, blocks)).toEqual(sections);
  });

  it("is the leaves on a tree of a root and its leaves, never the root (shape: root-only)", () => {
    const { tree, blocks } = rootOnly();
    const geo = buildGeometry(tree, blocks);
    expect(structureFrontier(geo, blocks).map((s) => s.nodeId)).toEqual(["l0", "l1", "l2"]);
  });

  it("is the section list on a provisional headings tree (shape: provisional)", () => {
    const { tree, blocks } = provisional();
    expect(tree.provisional).toBe("headings");
    const geo = buildGeometry(tree, blocks);
    const frontier = structureFrontier(geo, blocks);
    expect(frontier.length).toBeGreaterThan(1);
    expect(frontier).toEqual(buildSections(geo, blocks));
  });

  it("omits uncovered rows without returning the root or shifting later starts", () => {
    const { tree, blocks } = partWithLeaves();
    const partial: Tree = {
      ...tree,
      nodes: {
        ...tree.nodes,
        /* The root still spans the article, but its only child starts at row 3.
           Malformed stored trees render visibly short rather than inventing an
           answer for the uncovered rows (tree.ts § buildChains). */
        r: { ...tree.nodes.r!, children: ["pB"] },
      },
    };
    const frontier = structureFrontier(buildGeometry(partial, blocks), blocks);
    expect(frontier.map((s) => [s.row, s.nodeId])).toEqual([
      [3, "s1"],
      [5, "s2"],
    ]);
  });
});

describe("Structure's ← / → step the frontier; ↑ / ↓ and ?at= keep their levels (item 2)", () => {
  const starts = structureFrontier(geometry, ragged.blocks).map((s) => s.row);

  it("steps from one sub-section to the next, and ← in the middle of one goes to its start", () => {
    expect(stepTarget(starts, IN_MIDBRAIN, 1)).toBe(ragged.rowOf("2.4.4 Unlimited Associative Learning"));
    expect(stepTarget(starts, IN_MIDBRAIN, -1)).toBe(ragged.rowOf("2.4.3 Midbrain Theory"));
    /* And out of the last sub-section into the next section. */
    expect(stepTarget(starts, ragged.rowOf("2.4.6 Time and Recurrence"), 1)).toBe(
      ragged.rowOf("3.1 Implementing Indicator Properties in AI"),
    );
  });

  it("leaves the section depth's own stride on the sections", () => {
    const plan = navPlan(geometry);
    expect(plan.starts[sectionDepth(geometry)]).toEqual(buildSections(geometry, ragged.blocks).map((s) => s.row));
    expect(stepTarget(plan.starts[2]!, IN_MIDBRAIN, 1)).toBe(
      ragged.rowOf("3.1 Implementing Indicator Properties in AI"),
    );
  });
});

describe("Quiz's \"where to look again\" counts a sub-section's question in its section", () => {
  const sections = buildSections(geometry, ragged.blocks);
  const q = (id: string, row: number): QuizQuestion =>
    ({
      id,
      question: `${id}?`,
      referenceAnswer: "",
      evidence: [{ blockId: ragged.blocks[row]!.id, quote: "x", start: 0 }],
    }) as QuizQuestion;

  it("puts questions in 2.4.1 and 2.4.5 into one row, 2.4, and drops none", () => {
    const questions = [
      q("a", ragged.rowOf("2.4.1 Attention Schema Theory")),
      q("b", ragged.rowOf("2.4.5 Agency and Embodiment") + 2),
      q("c", IN_21),
    ];
    for (const question of questions) {
      expect(sectionsOfQuestion(question, sections, rowsOf)).toHaveLength(1);
    }
    const tally = sectionTally(questions, new Map(), sections, rowsOf);
    expect(tally.map((t) => [t.section.title, t.questionIds])).toEqual([
      ["2.1 Recurrent Processing Theory", ["c"]],
      ["2.4 Other Theories and Conditions", ["a", "b"]],
    ]);
  });
});

describe("the list's fisheye (item 4)", () => {
  const project = (focusRow: number, rung: Rung, allowParagraphs = true) =>
    outlineProjection({
      root: summary,
      supplementOf: geometry.supplementOf,
      arcByRow: null,
      focusRow,
      rung,
      allowParagraphs,
    });
  /* Structure's focus row is a frontier start, never a bare block. */
  const frontierRow = (row: number) => {
    const starts = structureFrontier(geometry, ragged.blocks).map((s) => s.row);
    return starts.filter((s) => s <= row).at(-1)!;
  };

  it("draws every part, the current part's sections, and the current section's sub-sections at the floor", () => {
    const { rows, currentId } = project(frontierRow(IN_MIDBRAIN), 3);
    expect(rows.filter((r) => r.level === 1)).toHaveLength(3);
    expect(rows.filter((r) => r.level === 2).map((r) => r.text)).toEqual([
      "Aims of the Survey",
      "Recurrent Processing Theory",
      "Global Workspace Theory",
      "Higher-Order Theories",
      "Other Theories and Conditions",
    ]);
    const subs = rows.filter((r) => r.level === 3);
    expect(subs.map((r) => r.node.title)).toEqual(SUB_SECTIONS);
    expect(subs.every((r) => !r.paragraph)).toBe(true);
    /* Under their own section, not after the part's last section by accident:
       2.4 is the last section, so check order against the row it hangs off. */
    const at24 = rows.findIndex((r) => r.node.title === "2.4 Other Theories and Conditions");
    expect(rows[at24 + 1]?.node.title).toBe(SUB_SECTIONS[0]);
    /* The sentence, and "now", on the deepest current node — the sub-section. */
    expect(rows.filter((r) => r.sentence !== undefined).map((r) => r.node.title)).toEqual([
      "2.4.3 Midbrain Theory",
    ]);
    expect(currentId).toBe(ragged.nodeOf("2.4.3 Midbrain Theory").id);
    expect(rows.filter((r) => r.here).map((r) => r.node.title)).toEqual([
      "Scientific Theories of Consciousness",
      "2.4 Other Theories and Conditions",
      "2.4.3 Midbrain Theory",
    ]);
  });

  it("hangs the paragraphs off the sub-section, one level under it, at rung 5", () => {
    const { rows } = project(frontierRow(IN_MIDBRAIN), 5);
    const paras = rows.filter((r) => r.paragraph);
    const midbrain = ragged.nodeOf("2.4.3 Midbrain Theory");
    expect(paras.map((r) => r.node.id)).toEqual(midbrain.children);
    expect(paras.every((r) => r.level === 4 && !r.here)).toBe(true);
    const at = rows.findIndex((r) => r.node.id === midbrain.id);
    expect(rows.slice(at + 1, at + 1 + paras.length)).toEqual(paras);
  });

  it("in 2.4's own opening paragraph: the sub-sections, the sentence on 2.4, and no paragraph rung over a mixed list", () => {
    const { rows, currentId } = project(frontierRow(IN_24_INTRO), 5);
    expect(rows.filter((r) => r.level === 3).map((r) => r.node.title)).toEqual(SUB_SECTIONS);
    expect(rows.filter((r) => r.sentence !== undefined).map((r) => r.node.title)).toEqual([
      "2.4 Other Theories and Conditions",
    ]);
    expect(currentId).toBe(ragged.nodeOf("2.4 Other Theories and Conditions").id);
    expect(rows.some((r) => r.paragraph)).toBe(false);
  });

  it("draws an undivided section exactly as before: no sub-sections, its paragraphs at level 3", () => {
    const { rows } = project(frontierRow(IN_21), 5);
    expect(rows.some((r) => r.level === 4)).toBe(false);
    const paras = rows.filter((r) => r.level === 3);
    expect(paras.map((r) => r.node.id)).toEqual(ragged.nodeOf("2.1 Recurrent Processing Theory").children);
    expect(paras.every((r) => r.paragraph)).toBe(true);
  });
});

describe("Expanded (item 5)", () => {
  const expanded = (focusRow: number) =>
    outlineProjection({
      root: summary,
      supplementOf: geometry.supplementOf,
      arcByRow: null,
      focusRow,
      rung: 1,
      allowParagraphs: false,
      expanded: true,
    });

  it("draws every sub-section at level 3 with its gist, as a section and not a paragraph", () => {
    const { rows, currentId } = expanded(ragged.rowOf("2.4.3 Midbrain Theory"));
    const subs = rows.filter((r) => r.level === 3);
    expect(subs.map((r) => r.node.title)).toEqual(SUB_SECTIONS);
    for (const r of subs) {
      expect(r.paragraph).toBe(false);
      expect(r.sentence).toBe(r.node.gist);
    }
    /* No paragraph anywhere, and every section still drawn. */
    expect(rows.some((r) => r.paragraph)).toBe(false);
    expect(rows.filter((r) => r.level === 2)).toHaveLength(SECTIONS.length);
    expect(currentId).toBe(ragged.nodeOf("2.4.3 Midbrain Theory").id);
  });
});

describe("Structure's two columns (item 6: unchanged, but the paragraph rung lists only leaves)", () => {
  const ALL = { rungA: 4, rungB: 5, allowParagraphs: true } as const;

  it("marks 2.4 in column B and splices nothing under it when its children are sub-sections", () => {
    const p = structureProjection({ root: summary, focusRow: ragged.rowOf("2.4.3 Midbrain Theory"), ...ALL });
    expect(p.columnB.rows.map((r) => r.kind)).toEqual(Array(5).fill("section"));
    expect(p.columnB.rows.filter((r) => r.here).map((r) => r.text)).toEqual(["Other Theories and Conditions"]);
    expect(p.paragraphTotal).toBeNull();
  });

  it("still splices an undivided section's paragraphs (the positive control)", () => {
    const p = structureProjection({ root: summary, focusRow: IN_21, ...ALL });
    expect(p.columnB.rows.filter((r) => r.kind === "paragraph").map((r) => r.id)).toEqual(
      ragged.nodeOf("2.1 Recurrent Processing Theory").children,
    );
  });
});

describe("a part with paragraphs directly under it, in both faces", () => {
  const { tree, blocks } = partWithLeaves();
  const geo = buildGeometry(tree, blocks);
  const root = buildSummaryTree(tree, blocks, geo.leafDepth);
  /* Its second leaf distinguishes a real leaf-granular answer from merely
     marking the part because both begin on row zero. */
  const focusRow = structureFrontier(geo, blocks)[1]!.row;

  it("marks the same leaf row the old section list supplied", () => {
    const list = outlineProjection({
      root,
      supplementOf: geo.supplementOf,
      arcByRow: null,
      focusRow,
      rung: 3,
      allowParagraphs: true,
    });
    expect(list.rows.filter((r) => r.here).map((r) => r.node.id)).toEqual(["pA", "l1"]);
    expect(list.currentId).toBe("l1");
    const columns = structureProjection({ root, focusRow, rungA: 4, rungB: 5, allowParagraphs: true });
    expect(columns.columnA.rows.filter((r) => r.here).map((r) => r.id)).toEqual(["pA"]);
    expect(columns.columnB.rows.filter((r) => r.here).map((r) => r.id)).toEqual(["l1"]);
  });
});

/* ------------------------------------------------ nothing changes today --
   **The identity tests.** On every tree production can hold — three levels
   (the shape the prompt asks for), two (a headings tree), one (a root and its
   leaves), with and without the apparatus — the frontier is the section list,
   and the section list is what the old formula, `leafDepth - 1`, gave. Seen red
   first: the frontier with its leaf fallback removed, and with
   `navigableItems`' collapse bypassed; `sectionDepth` capped at 1. */

function uniformFixtures(): [string, Tree, Block[]][] {
  const example: Block[] = JSON.parse(readFileSync("example/blocks.json", "utf8")).blocks;
  const exampleTree: Tree = JSON.parse(readFileSync("example/tree.json", "utf8"));
  const notes = Array.from({ length: 4 }, (_, i): Block => ({
    id: `spya-unote${i}`,
    tag: "p",
    kind: "text",
    text: `Note ${i}.`,
    words: 2,
    html: `<p>Note ${i}.</p>`,
    gistable: true,
    role: "footnote",
    treatment: "supplement",
    noteId: `u${i}`,
  }));
  const withNotes = [...example, ...notes];
  const p = provisional();
  const r = rootOnly();
  return [
    ["the example article", exampleTree, example],
    ["the example article with endnotes", appendSupplement(exampleTree, splitBlocks(withNotes).groups), withNotes],
    ["a provisional headings tree", p.tree, p.blocks],
    ["a root and its leaves", r.tree, r.blocks],
  ];
}

describe("on every uniform tree, nothing changes", () => {
  it.each(uniformFixtures())("the frontier is the section list — %s", (_name, tree, blocks) => {
    const geo = buildGeometry(tree, blocks);
    const sections = buildSections(geo, blocks);
    expect(sections.length).toBeGreaterThan(1);
    expect(structureFrontier(geo, blocks)).toEqual(sections);
  });

  it.each(uniformFixtures())("the sections are the old formula's — %s", (_name, tree, blocks) => {
    const geo = buildGeometry(tree, blocks);
    const old = navigableItems(geo.cells[Math.max(1, geo.leafDepth - 1)]!, geo.supplementOf);
    expect(buildSections(geo, blocks).map((s) => [s.row, s.nodeId])).toEqual(
      old.map((item) => [item.startRow, item.node.id]),
    );
  });
});

/* --------------------------------------------------------------- shapes -- */

const bid = (n: number) => `spya-x${String(n).padStart(4, "0")}` as BlockId;
function plainBlocks(n: number): Block[] {
  return Array.from({ length: n }, (_, i) => ({
    id: bid(i),
    tag: "p",
    kind: "text",
    text: `Block ${i}.`,
    words: 2,
    html: `<p>Block ${i}.</p>`,
    gistable: true,
  }));
}
function leafNode(id: NodeId, parent: NodeId, depth: number, row: number): TreeNode {
  return { id, depth, parent, children: [], range: [bid(row), bid(row)], title: "", navLabel: `para ${row}` };
}

/** Part A holds three paragraphs directly; part B has two ordinary sections. Leaves at depths 2 and 3. */
function partWithLeaves(): { tree: Tree; blocks: Block[] } {
  const blocks = plainBlocks(7);
  const nodes: Record<NodeId, TreeNode> = {
    r: { id: "r", depth: 0, parent: null, children: ["pA", "pB"], range: [bid(0), bid(6)], title: "Root", gist: "g" },
    pA: { id: "pA", depth: 1, parent: "r", children: ["l0", "l1", "l2"], range: [bid(0), bid(2)], title: "Part A", gist: "gA" },
    l0: leafNode("l0", "pA", 2, 0),
    l1: leafNode("l1", "pA", 2, 1),
    l2: leafNode("l2", "pA", 2, 2),
    pB: { id: "pB", depth: 1, parent: "r", children: ["s1", "s2"], range: [bid(3), bid(6)], title: "Part B", gist: "gB" },
    s1: { id: "s1", depth: 2, parent: "pB", children: ["l3", "l4"], range: [bid(3), bid(4)], title: "Section 1", gist: "g1" },
    l3: leafNode("l3", "s1", 3, 3),
    l4: leafNode("l4", "s1", 3, 4),
    s2: { id: "s2", depth: 2, parent: "pB", children: ["l5", "l6"], range: [bid(5), bid(6)], title: "Section 2", gist: "g2" },
    l5: leafNode("l5", "s2", 3, 5),
    l6: leafNode("l6", "s2", 3, 6),
  };
  return { tree: { version: "1", generator: "test", slug: "pwl", rootId: "r", nodes }, blocks };
}

function rootOnly(): { tree: Tree; blocks: Block[] } {
  const blocks = plainBlocks(3);
  const nodes: Record<NodeId, TreeNode> = {
    r: { id: "r", depth: 0, parent: null, children: ["l0", "l1", "l2"], range: [bid(0), bid(2)], title: "Root", gist: "g" },
    l0: leafNode("l0", "r", 1, 0),
    l1: leafNode("l1", "r", 1, 1),
    l2: leafNode("l2", "r", 1, 2),
  };
  return { tree: { version: "1", generator: "test", slug: "flat", rootId: "r", nodes }, blocks };
}

/** The tree the author's headings give, before a model's arrives (src/heading-tree.ts). */
function provisional(): { tree: Tree; blocks: Block[] } {
  const prose = "a paragraph of body prose that runs on for long enough to clear the stub threshold with room to spare";
  let n = 0;
  const para = (): Block => {
    const id = `spya-h${String(++n).padStart(4, "0")}`;
    return { id, tag: "p", kind: "text", text: prose, words: 20, html: `<p>${prose}</p>`, gistable: true };
  };
  const heading = (text: string): Block => {
    const id = `spya-h${String(++n).padStart(4, "0")}`;
    return { id, tag: "h2", kind: "heading", level: 2, text, words: 3, html: `<h2>${text}</h2>`, gistable: true };
  };
  const blocks = [para(), heading("The First Part"), para(), para(), heading("The Second Part"), para(), para()];
  return { tree: buildHeadingTree(blocks, "headed").tree, blocks };
}
