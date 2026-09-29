/**
 * **The article's own section number, taken off where we draw ours** —
 * SPIDERYARN-READING2-4Q, docs/plans/260929d-remove-hierarchy-mode-and-heading-numbers.md
 * § The regex. Structure, Summary and Diagram put "2.1" beside a title that
 * already said "3.2 Methods", so the reader saw "2.1 3.2 Methods".
 */
import { describe, expect, it } from "vitest";
import type { Block, Tree, TreeNode } from "../src/types.js";
import { withoutOwnNumber } from "../src/web/heading-number.js";
import { buildSummaryTree } from "../src/web/tree.js";

const NBSP = " ";

describe("withoutOwnNumber", () => {
  it.each([
    ["1 Intro", "Intro"],
    ["1. Intro", "Intro"],
    ["1) Intro", "Intro"],
    ["(1) Intro", "Intro"],
    ["1: Intro", "Intro"],
    ["1 – Intro", "Intro"],
    ["1 - Intro", "Intro"],
    ["1 — Intro", "Intro"],
    ["3.2 Methods", "Methods"],
    ["3.2. Methods", "Methods"],
    ["(3.2) Methods", "Methods"],
    ["1.2.3 Methods", "Methods"],
    ["A.1 Proofs", "Proofs"],
    ["IV. Results", "Results"],
    ["ii) Setup", "Setup"],
    ["(iv) Setup", "Setup"],
    ["I. Introduction", "Introduction"],
    [`3.2${NBSP}Methods`, "Methods"],
    [`1.${NBSP}Intro`, "Intro"],
    ["10 things you should know", "things you should know"],
  ])("strips %j", (title, want) => {
    expect(withoutOwnNumber(title)).toBe(want);
  });

  it.each([
    "2008 financial crisis",
    "1984 and after",
    "123. Too long",
    "3.200 Methods",
    "C. elegans",
    "A Quick Tour",
    "U.S. policy",
    "A. Proofs",
    "I think",
    "V for Vendetta",
    "V. cholerae",
    "X. laevis",
    "I. scapularis",
    "1.",
    "1. ",
    "(1)",
    "IV.",
    "Methods",
    "",
  ])("keeps %j", (title) => {
    expect(withoutOwnNumber(title)).toBe(title);
  });
});

describe("buildSummaryTree's display title", () => {
  const block = (id: string): Block =>
    ({ id, tag: "p", kind: "text", text: "x", words: 1, html: "<p>x</p>", gistable: true }) as Block;
  const blocks = ["spya-aaaaaa", "spya-bbbbbb", "spya-cccccc"].map(block);
  const node = (n: Partial<TreeNode> & Pick<TreeNode, "id" | "title" | "range">): TreeNode => ({
    depth: 1,
    parent: "n0",
    children: [],
    ...n,
  });
  const tree = {
    version: "test",
    generator: "test",
    slug: "test",
    rootId: "n0",
    nodes: {
      n0: node({
        id: "n0",
        depth: 0,
        parent: null,
        children: ["n1", "n2", "n3"],
        title: "1984 Revisited",
        range: ["spya-aaaaaa", "spya-cccccc"],
      }),
      n1: node({ id: "n1", title: "3.2 Methods", range: ["spya-aaaaaa", "spya-aaaaaa"] }),
      n2: node({ id: "n2", title: "C. elegans", range: ["spya-bbbbbb", "spya-bbbbbb"] }),
      n3: node({
        id: "n3",
        title: "1. Notes",
        range: ["spya-cccccc", "spya-cccccc"],
        treatment: "supplement",
      }),
    },
  } as Tree;

  it("strips a numbered node's own number and leaves the stored title alone", () => {
    const built = buildSummaryTree(tree, blocks)!;
    const [methods, elegans] = built.children;
    expect(methods?.number).toBe("1");
    expect(methods?.title).toBe("Methods");
    expect(methods?.node.title).toBe("3.2 Methods");
    expect(tree.nodes.n1?.title).toBe("3.2 Methods");
    expect(elegans?.title).toBe("C. elegans");
  });

  it("keeps the root's and the supplement's title as written, having no number of ours", () => {
    const built = buildSummaryTree(tree, blocks)!;
    expect(built.number).toBe("");
    expect(built.title).toBe("1984 Revisited");
    const notes = built.children[2];
    expect(notes?.supplement).toBe(true);
    expect(notes?.number).toBe("");
    expect(notes?.title).toBe("1. Notes");
  });
});
