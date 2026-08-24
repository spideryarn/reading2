/**
 * `buildTree` is where the model's proposal becomes the stored artefact, and
 * it is the one place in stage 4 that can silently produce a wrong article.
 * The model only ever proposes INTERNAL nodes — every leaf is grown here, one
 * per block (docs/project/table-of-contents.md). If that growth is off by one,
 * or attaches a label to the wrong block, nothing throws: the sidebar just
 * quietly describes the wrong paragraph.
 *
 * These tests are deterministic — no network, no model. See
 * docs/project/testing.md.
 */
import { describe, expect, it } from "vitest";
import { buildTree, type ModelNode } from "../src/toc.js";
import type { Block } from "../src/types.js";

function block(id: string, text: string, gistable = true): Block {
  return {
    id,
    tag: "p",
    kind: gistable ? "text" : "media",
    text,
    words: text.split(/\s+/).filter(Boolean).length,
    html: `<p id="${id}">${text}</p>`,
    gistable,
  };
}

/** Four prose blocks with a non-gistable image third. */
const BLOCKS: Block[] = [
  block("spya-aaaaaa", "First paragraph"),
  block("spya-bbbbbb", "Second paragraph"),
  block("spya-cccccc", "", false),
  block("spya-dddddd", "Fourth paragraph"),
];

const NAV = {
  "spya-aaaaaa": "The opening claim, stated plainly and at some length",
  "spya-bbbbbb": "The supporting argument, which runs to a dozen words or so",
  "spya-dddddd": "The conclusion drawn from both of the preceding paragraphs",
};

const ROOT: ModelNode = {
  title: "Whole piece",
  gist: "The article argues something.",
  range: ["spya-aaaaaa", "spya-dddddd"],
  children: [
    {
      title: "Opening",
      gist: "It opens by claiming something.",
      range: ["spya-aaaaaa", "spya-bbbbbb"],
    },
    {
      title: "Closing",
      gist: "It closes by concluding something.",
      range: ["spya-cccccc", "spya-dddddd"],
    },
  ],
};

describe("buildTree", () => {
  const tree = buildTree(ROOT, NAV, BLOCKS, "test");
  const nodes = Object.values(tree.nodes);
  const leaves = nodes.filter((n) => n.children.length === 0);

  it("grows exactly one leaf per block, no more and no fewer", () => {
    expect(leaves).toHaveLength(BLOCKS.length);
    expect(leaves.map((l) => l.range[0]).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
  });

  it("gives every leaf a single-block range", () => {
    for (const leaf of leaves) expect(leaf.range[0]).toBe(leaf.range[1]);
  });

  it("keeps the internal nodes the model proposed, and adds no others", () => {
    const internal = nodes.filter((n) => n.children.length > 0);
    expect(internal.map((n) => n.title).sort()).toEqual(["Closing", "Opening", "Whole piece"]);
  });

  it("labels a leaf only when its block is gistable", () => {
    const byBlock = new Map(leaves.map((l) => [l.range[0], l]));
    expect(byBlock.get("spya-aaaaaa")?.navLabel).toBe(NAV["spya-aaaaaa"]);
    // The image has a navLabel nowhere in NAV, and must not acquire one.
    expect(byBlock.get("spya-cccccc")?.navLabel).toBeUndefined();
  });

  it("never gives a leaf a gist — a summary must not replace real prose", () => {
    for (const leaf of leaves) expect(leaf.gist).toBeUndefined();
  });

  it("wires parent and depth consistently in both directions", () => {
    for (const node of nodes) {
      if (node.parent === null) {
        expect(node.depth).toBe(0);
        continue;
      }
      const parent = tree.nodes[node.parent];
      expect(parent).toBeDefined();
      expect(parent.children).toContain(node.id);
      expect(node.depth).toBe(parent.depth + 1);
    }
  });

  it("has children that exactly partition their parent, in order", () => {
    const index = new Map(BLOCKS.map((b, i) => [b.id, i]));
    for (const node of nodes.filter((n) => n.children.length > 0)) {
      let cursor = index.get(node.range[0])!;
      for (const childId of node.children) {
        const child = tree.nodes[childId];
        expect(index.get(child.range[0])).toBe(cursor);
        cursor = index.get(child.range[1])! + 1;
      }
      expect(cursor).toBe(index.get(node.range[1])! + 1);
    }
  });

  it("mints distinct node ids", () => {
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
  });

  it("records the root and its slug so the artefact is self-describing", () => {
    expect(tree.nodes[tree.rootId].parent).toBeNull();
    expect(tree.slug).toBe("test");
  });

  it("throws rather than guessing when the model invents a block id", () => {
    const bad: ModelNode = { ...ROOT, children: [{ title: "X", range: ["spya-zzzzzz", "spya-zzzzzz"] }] };
    expect(() => buildTree(bad, NAV, BLOCKS, "test")).toThrow(/not in blocks\.json/);
  });

  it("ignores a navLabel the model wrote for a block that isn't gistable", () => {
    const sneaky = { ...NAV, "spya-cccccc": "A label for an image, which must be dropped" };
    const t = buildTree(ROOT, sneaky, BLOCKS, "test");
    const leaf = Object.values(t.nodes).find((n) => n.range[0] === "spya-cccccc");
    expect(leaf?.navLabel).toBeUndefined();
  });
});
