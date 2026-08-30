/**
 * **A provisional tree, and the one rule it is exempt from.**
 *
 * `src/heading-tree.ts` carves an article on its own `<h2>`/`<h3>` blocks —
 * deterministic, no model, milliseconds. It gets the reader real bands with
 * real names and it has **no gists**, because there is nowhere free to get one.
 * `checkTree`'s gist rule would therefore reject it once per section, which is
 * what kept this tree inside the eval directory.
 *
 * The exemption is keyed on `tree.provisional`, set by the builder, and it is
 * deliberately narrow. What this file is for is the *narrowness*: it is easy to
 * write an exemption that quietly waves a whole tree through, and the gist rule
 * exists because reading a node's role off an absent field is exactly how a
 * pipeline bug comes to look like a deliberate exception
 * (src/tree-invariants.ts § the gist rule). So every test below that shows
 * something being forgiven is paired with one showing something that is not.
 */
import { describe, expect, it } from "vitest";
import { buildHeadingTree, HEADING_TREE_VERSION } from "../src/heading-tree.js";
import { assertTreeSound, checkTree } from "../src/tree-invariants.js";
import type { Block, Tree } from "../src/types.js";

let counter = 0;
function block(text: string, over: Partial<Block> = {}): Block {
  const id = over.id ?? `spya-p${String(++counter).padStart(4, "0")}`;
  return {
    id,
    tag: over.tag ?? "p",
    kind: over.kind ?? "text",
    text,
    words: over.words ?? text.split(/\s+/).filter(Boolean).length,
    html: `<${over.tag ?? "p"}>${text}</${over.tag ?? "p"}>`,
    gistable: over.gistable ?? true,
    ...over,
  };
}

const heading = (text: string, level = 2): Block =>
  block(text, { tag: `h${level}`, kind: "heading", level });

/** Prose long enough to clear the stub threshold, so a section counts as real. */
const PROSE =
  "a paragraph of body prose that runs on for long enough to clear the stub " +
  "threshold with room to spare, because a section needs some words in it";

/** Three headed sections — the shape the rule is for. */
function article(): Block[] {
  return [
    block(PROSE),
    heading("The First Part"),
    block(PROSE),
    block(PROSE),
    heading("The Second Part"),
    block(PROSE),
    block(PROSE),
    heading("The Third Part"),
    block(PROSE),
    block(PROSE),
  ];
}

describe("the tree the author's headings give us", () => {
  const blocks = article();
  const built = buildHeadingTree(blocks, "headed");

  it("carves the article on its headings rather than falling back to flat", () => {
    expect(built.flat).toBe(false);
    expect(built.parts).toBeGreaterThanOrEqual(3);
  });

  it("marks itself provisional, so no caller has to remember to", () => {
    expect(built.tree.provisional).toBe("headings");
    expect(built.tree.version).toBe(HEADING_TREE_VERSION);
  });

  it("passes the invariants, which is the whole point of the marker", () => {
    expect(checkTree(blocks, built.tree).problems).toEqual([]);
    expect(() => assertTreeSound(blocks, built.tree)).not.toThrow();
  });

  it("really has no gists — the exemption is load-bearing, not decorative", () => {
    // Without this, every assertion above would also pass for a builder that
    // had quietly started writing gists, and the exemption would be untested.
    const internal = Object.values(built.tree.nodes).filter((n) => n.children.length > 0);
    expect(internal.length).toBeGreaterThan(1);
    expect(internal.every((n) => n.gist === undefined)).toBe(true);
  });

  it("names its sections with the author's own headings, and says so", () => {
    const titles = Object.values(built.tree.nodes)
      .filter((n) => n.sourceHeading !== undefined)
      .map((n) => n.sourceHeading);
    expect(titles).toContain("The First Part");
    expect(titles).toContain("The Second Part");
  });
});

describe("and the exemption buys exactly one rule", () => {
  const blocks = article();

  it("still fails a finished tree that is missing a gist", () => {
    // The control. `provisional` is the only difference between this tree and
    // the one above, so a green here would mean the exemption is unconditional.
    const { tree } = buildHeadingTree(blocks, "headed");
    const finished: Tree = { ...tree };
    delete finished.provisional;
    const problems = checkTree(blocks, finished).problems;
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => p.includes("has no gist"))).toBe(true);
  });

  it("still fails a provisional tree whose children do not tile their parent", () => {
    const { tree } = buildHeadingTree(blocks, "headed");
    const broken: Tree = { ...tree, nodes: { ...tree.nodes } };
    const root = broken.nodes[broken.rootId]!;
    // Drop the root's first child: the blocks it held now belong to no node.
    broken.nodes[broken.rootId] = { ...root, children: root.children.slice(1) };
    expect(checkTree(blocks, broken).problems.length).toBeGreaterThan(0);
  });

  it("still fails a provisional tree that claims a heading it does not contain", () => {
    const { tree } = buildHeadingTree(blocks, "headed");
    const broken: Tree = { ...tree, nodes: { ...tree.nodes } };
    const section = Object.values(tree.nodes).find((n) => n.sourceHeading !== undefined)!;
    broken.nodes[section.id] = { ...section, sourceHeading: "A Heading Nobody Wrote" };
    const problems = checkTree(blocks, broken).problems;
    expect(problems.some((p) => p.includes("sourceHeading"))).toBe(true);
  });

  it("still fails a provisional tree whose range names a block that is not there", () => {
    const { tree } = buildHeadingTree(blocks, "headed");
    const broken: Tree = { ...tree, nodes: { ...tree.nodes } };
    const root = broken.nodes[broken.rootId]!;
    broken.nodes[broken.rootId] = { ...root, range: ["spya-zzzzzz", root.range[1]] };
    expect(checkTree(blocks, broken).problems.length).toBeGreaterThan(0);
  });
});

describe("an article with no headings", () => {
  const blocks = [block(PROSE), block(PROSE), block(PROSE), block(PROSE)];
  const built = buildHeadingTree(blocks, "headless");

  /* The honest failure, and it is the case the model earns its money on: with
     no headings there is nothing to carve, so this returns root plus one leaf
     per block rather than inventing structure. Measured on 2026-08-30, the
     model is *least* stable on exactly these documents — 8, 7, 8 and 3 parts
     from identical input — so a flat tree is not obviously the worse of the
     two answers. docs/research/opening-an-article-before-the-toc.md § 7b. */
  it("falls back to flat rather than inventing sections", () => {
    expect(built.flat).toBe(true);
    expect(built.parts).toBe(0);
  });

  it("is still a valid tree, so it can still be published and read", () => {
    expect(checkTree(blocks, built.tree).problems).toEqual([]);
  });

  it("still gives every block exactly one leaf", () => {
    const leaves = Object.values(built.tree.nodes).filter((n) => n.children.length === 0);
    expect(leaves.map((l) => l.range[0]).sort()).toEqual(blocks.map((b) => b.id).sort());
  });
});
