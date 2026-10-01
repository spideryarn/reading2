/**
 * Annotations mode's pure half — which note goes beside which block, how notes
 * are kept from overlapping, and what the head says.
 * docs/plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md.
 */
import { describe, expect, it } from "vitest";
import { blockIndex } from "../src/section-path.js";
import type { Arc, Block, Idea, Tree, TreeNode } from "../src/types.js";
import { annotationNotes, arcAt, headPath, layoutNotes } from "../src/web/annotations/notes.js";

const ids = ["spya-aaaaa1", "spya-aaaaa2", "spya-aaaaa3", "spya-aaaaa4", "spya-aaaaa5", "spya-aaaaa6"];
const blocks = ids.map((id) => ({ id, text: id, html: `<p>${id}</p>` })) as unknown as Block[];
const index = blockIndex(blocks);

function node(over: Partial<TreeNode> & Pick<TreeNode, "id" | "depth" | "range" | "title">): TreeNode {
  return { parent: null, children: [], ...over };
}

/* Root over all six; part A over 1–3 with section A1 over 2–3; part B over 4–6. */
const tree: Tree = {
  version: "t",
  generator: "t",
  slug: "s",
  rootId: "root",
  nodes: {
    root: node({
      id: "root",
      depth: 0,
      range: ["spya-aaaaa1", "spya-aaaaa6"],
      title: "Article",
      question: "What is the whole thing for?",
      children: ["a", "b"],
    }),
    a: node({
      id: "a",
      depth: 1,
      parent: "root",
      range: ["spya-aaaaa1", "spya-aaaaa3"],
      title: "Part A",
      question: "Why does A matter?",
      children: ["a1", "a0"],
    }),
    a0: node({ id: "a0", depth: 2, parent: "a", range: ["spya-aaaaa1", "spya-aaaaa1"], title: "Opening" }),
    a1: node({
      id: "a1",
      depth: 2,
      parent: "a",
      range: ["spya-aaaaa2", "spya-aaaaa3"],
      title: "Section A1",
      question: "A depth-2 question the structure call should never have kept",
      children: ["a1p"],
    }),
    /* A paragraph leaf, as real trees have: `sectionNodesOf` leaves the leaf
       out of the path, so a section is only named when it has one. */
    a1p: node({ id: "a1p", depth: 3, parent: "a1", range: ["spya-aaaaa2", "spya-aaaaa3"], title: "Para" }),
    b: node({ id: "b", depth: 1, parent: "root", range: ["spya-aaaaa4", "spya-aaaaa6"], title: "Part B" }),
  },
} as unknown as Tree;
/* `sectionNodesOf` walks children in order, so keep them in document order. */
(tree.nodes.a as TreeNode).children = ["a0", "a1"];

function idea(over: Partial<Idea> & Pick<Idea, "id" | "name">): Idea {
  return { provenance: "assumed", statement: `${over.name}, stated.`, occurrences: [], ...over } as Idea;
}

describe("annotationNotes", () => {
  it("puts the article's question and each part's beside its first block, root first", () => {
    const notes = annotationNotes(tree, blocks, null);
    expect(notes.get("spya-aaaaa1")).toEqual([
      { kind: "question", depth: 0, text: "What is the whole thing for?" },
      { kind: "question", depth: 1, text: "Why does A matter?" },
    ]);
    /* Part B has no question: nothing beside it. */
    expect(notes.has("spya-aaaaa4")).toBe(false);
  });

  it("draws no question below the parts, whatever the tree carries", () => {
    const notes = annotationNotes(tree, blocks, null);
    expect(notes.has("spya-aaaaa2")).toBe(false);
  });

  it("stamps each idea once, at its first occurrence in the article", () => {
    const later = idea({
      id: "i1",
      name: "Later idea",
      occurrences: [
        { blockId: "spya-aaaaa5", quote: "q", reasoning: "r" },
        { blockId: "spya-aaaaa3", quote: "q", reasoning: "r" },
        { blockId: "spya-aaaaa3", quote: "q2", reasoning: "r" },
      ],
    } as Partial<Idea> & Pick<Idea, "id" | "name">);
    const notes = annotationNotes(null, blocks, [later]);
    expect([...notes.keys()]).toEqual(["spya-aaaaa3"]);
    expect(notes.get("spya-aaaaa3")).toEqual([
      {
        kind: "idea",
        ideaId: "i1",
        name: "Later idea",
        statement: "Later idea, stated.",
        provenance: "assumed",
      },
    ]);
  });

  it("skips a block this article no longer has, rather than placing a note nowhere", () => {
    const gone = idea({
      id: "i2",
      name: "Gone",
      occurrences: [{ blockId: "spya-zzzzzz", quote: "q", reasoning: "r" }],
    } as Partial<Idea> & Pick<Idea, "id" | "name">);
    const moved: Tree = {
      ...tree,
      nodes: { ...tree.nodes, a: { ...(tree.nodes.a as TreeNode), range: ["spya-zzzzzz", "spya-aaaaa3"] } },
    };
    const notes = annotationNotes(moved, blocks, [gone]);
    expect([...notes.values()].flat().map((n) => n.kind === "question" && n.depth)).toEqual([0]);
  });

  it("orders questions before ideas on one block", () => {
    const here = idea({
      id: "i3",
      name: "Here",
      occurrences: [{ blockId: "spya-aaaaa1", quote: "q", reasoning: "r" }],
    } as Partial<Idea> & Pick<Idea, "id" | "name">);
    const kinds = (annotationNotes(tree, blocks, [here]).get("spya-aaaaa1") ?? []).map((n) => n.kind);
    expect(kinds).toEqual(["question", "question", "idea"]);
  });
});

describe("layoutNotes", () => {
  it("leaves notes that do not collide exactly where they want to be", () => {
    expect(layoutNotes([0, 100, 300], [40, 40, 40], 8)).toEqual([0, 100, 300]);
  });

  it("pushes a note down below the one above it, and keeps the order", () => {
    expect(layoutNotes([0, 20, 30], [50, 50, 10], 8)).toEqual([0, 58, 116]);
  });

  it("lets a later note return to its own place once the crowd has passed", () => {
    expect(layoutNotes([0, 10, 500], [100, 100, 20], 8)).toEqual([0, 108, 500]);
  });

  it("is idempotent: laying out the answer again changes nothing", () => {
    const desired = [0, 20, 30, 35, 400];
    const heights = [50, 50, 10, 30, 10];
    const once = layoutNotes(desired, heights, 8);
    expect(layoutNotes(desired, heights, 8)).toEqual(once);
  });
});

describe("the head", () => {
  it("names the part and the section the block sits in", () => {
    expect(headPath(tree, index, "spya-aaaaa3")).toEqual(["Part A", "Section A1"]);
    expect(headPath(tree, index, "spya-aaaaa5")).toEqual(["Part B"]);
    expect(headPath(tree, index, null)).toEqual([]);
  });

  it("gives the arc's sentence for the part holding the block", () => {
    const arc = {
      version: "t",
      generator: "t",
      slug: "s",
      entries: [
        { range: ["spya-aaaaa1", "spya-aaaaa3"], text: "Setting it up." },
        { range: ["spya-aaaaa4", "spya-aaaaa6"], text: "Turning it round." },
      ],
    } as Arc;
    expect(arcAt(arc, index, "spya-aaaaa2")).toBe("Setting it up.");
    expect(arcAt(arc, index, "spya-aaaaa6")).toBe("Turning it round.");
    expect(arcAt(arc, index, "spya-zzzzzz")).toBe(null);
    expect(arcAt(null, index, "spya-aaaaa2")).toBe(null);
  });
});
