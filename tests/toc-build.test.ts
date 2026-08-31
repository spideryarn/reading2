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
import { buildTree, checkCoverage, type ModelNode } from "../src/toc.js";
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
      expect(parent!.children).toContain(node.id);
      expect(node.depth).toBe(parent!.depth + 1);
    }
  });

  it("has children that exactly partition their parent, in order", () => {
    const index = new Map(BLOCKS.map((b, i) => [b.id, i]));
    for (const node of nodes.filter((n) => n.children.length > 0)) {
      let cursor = index.get(node.range[0])!;
      for (const childId of node.children) {
        const child = tree.nodes[childId]!;
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
    expect(tree.nodes[tree.rootId]!.parent).toBeNull();
    expect(tree.slug).toBe("test");
  });

  it("throws rather than guessing when the model invents a block id", () => {
    const bad: ModelNode = { ...ROOT, children: [{ title: "X", range: ["spya-zzzzzz", "spya-zzzzzz"] }] };
    expect(() => buildTree(bad, NAV, BLOCKS, "test")).toThrow(/not in blocks\.json/);
  });

  /**
   * The partition. Found by an adversarial review of the label split,
   * 2026-08-26, and it is the best kind of finding: nothing threw, nothing was
   * red, and the article came out short.
   *
   * The prompt asks for children that exactly tile their parent, and until this
   * `buildTree` took the model's word for it. `validate-tree.ts` checks it —
   * but that is a CLI somebody runs by hand, and the ingest queue never does.
   */
  describe("the partition the prompt asks for", () => {
    /**
     * **What these three assert changed on 2026-08-30, and the invariant did
     * not.** They used to assert that a misaligned partition is *refused*; a
     * misaligned partition is now *snapped shut* at any size, because a
     * headingless PDF lost its whole ToC to a gap of three
     * (src/toc.ts § `repairedChildRanges`, and Greg's ruling quoted there).
     *
     * The thing worth testing was never the refusal. It is that no block ends up
     * with two leaves and none with zero — the fault the adversarial review
     * found, where `checkCoverage` divided one count by the other and reported
     * exactly 1.0 while two paragraphs had no row and two were rendered twice.
     * So these now assert the outcome directly, which is a stronger claim than
     * "it threw" and survives the next change to how it is achieved.
     */
    const leafCount = (tree: ReturnType<typeof buildTree>): Map<string, number> => {
      const seen = new Map<string, number>();
      for (const node of Object.values(tree.nodes)) {
        if (node.children.length > 0) continue;
        seen.set(node.range[0], (seen.get(node.range[0]) ?? 0) + 1);
      }
      return seen;
    };
    const exactlyOneLeafEach = (tree: ReturnType<typeof buildTree>): void => {
      const seen = leafCount(tree);
      expect([...seen.values()].every((n) => n === 1)).toBe(true);
      expect([...seen.keys()].sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    };

    it("snaps children that overlap, which would otherwise grow two leaves for one block", () => {
      // The worked example from the review: 12 blocks, children [0..6] and
      // [5..9]. Two blocks got two leaves, two got none, and `checkCoverage`
      // divided one count by the other and reported exactly 1.0.
      const overlapping: ModelNode = {
        ...ROOT,
        children: [
          { title: "First", range: ["spya-aaaaaa", "spya-cccccc"] },
          { title: "Second", range: ["spya-bbbbbb", "spya-dddddd"] },
        ],
      };
      exactlyOneLeafEach(buildTree(overlapping, NAV, BLOCKS, "test"));
    });

    it("snaps a gap of more than one block, which would otherwise grow no leaf at all", () => {
      const gapped: ModelNode = {
        ...ROOT,
        children: [
          { title: "First", range: ["spya-aaaaaa", "spya-aaaaaa"] },
          { title: "Second", range: ["spya-dddddd", "spya-dddddd"] },
        ],
      };
      exactlyOneLeafEach(buildTree(gapped, NAV, BLOCKS, "test"));
    });

    it("extends children that stop before their parent ends", () => {
      const short: ModelNode = {
        ...ROOT,
        children: [{ title: "Only", range: ["spya-aaaaaa", "spya-bbbbbb"] }],
      };
      exactlyOneLeafEach(buildTree(short, NAV, BLOCKS, "test"));
    });

    it("refuses a range that runs backwards instead of silently covering nothing", () => {
      // Both ends are real ids, so every lookup succeeds. The leaf loop just
      // runs zero times: the node becomes a childless internal node and the
      // blocks it was supposed to hold exist in no leaf anywhere.
      const backwards: ModelNode = {
        ...ROOT,
        children: [
          { title: "Backwards", range: ["spya-bbbbbb", "spya-aaaaaa"] },
          { title: "Rest", range: ["spya-cccccc", "spya-dddddd"] },
        ],
      };
      expect(() => buildTree(backwards, NAV, BLOCKS, "test")).toThrow(/runs backwards/);
    });

    it("refuses a root that does not span the whole article", () => {
      // Nothing else catches this. assertChildrenPartition checks that a node's
      // children tile *it*, which says nothing about the root's own extent; and
      // checkCoverage counts only gistable blocks, so a root that drops a
      // leading image or a trailing rule passes both while leaving those blocks
      // with no leaf and no resolvable id.
      const short: ModelNode = {
        ...ROOT,
        range: ["spya-aaaaaa", "spya-cccccc"],
        children: [
          { title: "First", range: ["spya-aaaaaa", "spya-bbbbbb"] },
          { title: "Second", range: ["spya-cccccc", "spya-cccccc"] },
        ],
      };
      expect(() => buildTree(short, NAV, BLOCKS, "test")).toThrow(/does not cover the whole article/);
    });

    it("names an invented range on an internal node, which used to slip through", () => {
      // The partition check returned early on an unresolvable range, on the
      // grounds that the leaf-growing branch would report it. That branch only
      // runs for a lowest-level node, so an internal node with an invented
      // endpoint and valid descendants reached the stored tree.
      const invented: ModelNode = {
        ...ROOT,
        children: [
          {
            title: "First",
            range: ["spya-zzzzzz", "spya-bbbbbb"],
            children: [{ title: "Inner", range: ["spya-aaaaaa", "spya-bbbbbb"] }],
          },
          { title: "Second", range: ["spya-cccccc", "spya-dddddd"] },
        ],
      };
      expect(() => buildTree(invented, NAV, BLOCKS, "test")).toThrow(/not in blocks\.json/);
    });

    it("still accepts the tree the model is supposed to write", () => {
      expect(() => buildTree(ROOT, NAV, BLOCKS, "test")).not.toThrow();
    });
  });

  it("ignores a navLabel the model wrote for a block that isn't gistable", () => {
    const sneaky = { ...NAV, "spya-cccccc": "A label for an image, which must be dropped" };
    const t = buildTree(ROOT, sneaky, BLOCKS, "test");
    const leaf = Object.values(t.nodes).find((n) => n.range[0] === "spya-cccccc");
    expect(leaf?.navLabel).toBeUndefined();
  });
});

/**
 * `stop_reason: "max_tokens"` catches a response the API cut off. It does not
 * catch the other way stage 4 can come back incomplete: a model that senses it
 * is running out of room, closes its JSON tidily, and simply writes fewer
 * labels than there are paragraphs. That parses, and `buildTree` builds a
 * perfectly valid tree from it — with a hundred paragraphs missing from the
 * sidebar and nothing anywhere saying so.
 *
 * These are the tests for the guard between the loud failure this stage now has
 * and the quiet one that would replace it. See
 * docs/postmortems/260826a-toc-max-tokens.md.
 */
describe("checkCoverage", () => {
  /** Twenty gistable blocks, tiled by one internal node. */
  const twenty: Block[] = Array.from({ length: 20 }, (_, i) =>
    block(`spya-${String(i).padStart(6, "0")}`, `Paragraph ${i}`),
  );
  const wholeThing: ModelNode = {
    title: "Whole piece",
    gist: "It argues something.",
    range: ["spya-000000", "spya-000019"],
  };
  const labelsFor = (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, "A claim about this paragraph, at a workable length"]));
  const check = (labels: Record<string, string>, blocks = twenty) =>
    checkCoverage(labels, buildTree(wholeThing, labels, blocks, "test"), blocks);

  it("passes a tree that labels every paragraph", () => {
    expect(() => check(labelsFor(twenty.map((b) => b.id)))).not.toThrow();
  });

  /**
   * **The ratio is over `isStructural`, not over `gistable`.**
   *
   * A footnote is prose, so `gistable` says yes to it and it would sit in the
   * denominator for ever — on gwern that is 41 blocks of a 175 that can never
   * be labelled, which is a third of the article reported missing from a tree
   * that is complete, and the stage refusing to write it.
   */
  it("does not count footnotes among the paragraphs owed a row", () => {
    const withNotes = twenty.map((b, i) =>
      i >= 15 ? { ...b, role: "footnote" as const, treatment: "supplement" as const } : b,
    );
    const bodyLabels = labelsFor(withNotes.slice(0, 15).map((b) => b.id));
    expect(() => check(bodyLabels, withNotes)).not.toThrow();
  });

  it("still refuses a body paragraph with no row", () => {
    // The control for the line above.
    const withNotes = twenty.map((b, i) =>
      i >= 15 ? { ...b, role: "footnote" as const, treatment: "supplement" as const } : b,
    );
    const short = labelsFor(withNotes.slice(0, 14).map((b) => b.id));
    expect(() => check(short, withNotes)).toThrow(/have no row/);
  });

  /**
   * **This test has been both ways round, and the reason is in the code.**
   *
   * It used to assert that 19 of 20 was a refusal, on the argument that after
   * the label split there was no longer any honest way for a block to be
   * unlabelled. There is one now: src/labels.ts may accept a batch that came
   * back short after a re-ask for the gap alone also failed, within a per-batch
   * budget, and it names every block it dropped. That path is
   * docs/plans/260830am-faster-ingest-and-concurrency.md § Stage 1b, and this floor is
   * its article-level backstop rather than its bound.
   */
  it("tolerates the bounded gap the label pass is now allowed to leave", () => {
    expect(() => check(labelsFor(twenty.slice(1).map((b) => b.id)))).not.toThrow();
  });

  it("refuses a gap wider than the per-batch budget could ever add up to", () => {
    // The control, and the whole reason the floor is not simply removed: the
    // batching is invisible from here, so this is what catches an article whose
    // batches each stayed inside their own budget and which still lost a tenth
    // of its labels between them.
    expect(() => check(labelsFor(twenty.slice(2).map((b) => b.id)))).toThrow(/18 of 20/);
  });

  it("refuses a tree that quietly describes half the article", () => {
    expect(() => check(labelsFor(twenty.slice(0, 10).map((b) => b.id)))).toThrow(/10 of 20/);
  });

  it("says nothing was written, because nothing was", () => {
    // The check runs before the artefacts are written. A message that left that
    // ambiguous would send someone hunting for a half-written tree.
    expect(() => check(labelsFor(twenty.slice(0, 2).map((b) => b.id)))).toThrow(
      /nothing has been written/i,
    );
  });

  it("counts only gistable blocks, so images don't fail an honest tree", () => {
    // 10 of 20 blocks are media. Labelling the other 10 is full coverage.
    const half: Block[] = twenty.map((b, i) => (i % 2 === 0 ? b : { ...b, gistable: false }));
    const ids = half.filter((b) => b.gistable).map((b) => b.id);
    expect(() => check(labelsFor(ids), half)).not.toThrow();
  });

  it("refuses a label for a block that is not in this article", () => {
    // buildTree can't see this one: it walks the blocks and looks each label up,
    // so an invented id is never asked for and leaves no trace in the tree.
    const labels = { ...labelsFor(twenty.map((b) => b.id)), "spya-zzzzzz": "A label from nowhere" };
    expect(() => check(labels)).toThrow(/not in this article/);
  });
});

/**
 * **An error thrown here is a value that travels.** A pipeline step that throws
 * is logged by src/jobs.ts through `errorFields(err)`, and src/log.ts's error
 * serialiser keeps the `message` *and* the `stack` — which contains the message
 * again. So anything interpolated into a message in src/toc.ts is written into
 * the log twice, from a file that never calls the logger at all, and `redact`
 * matches paths in the object rather than text in a string, so it can reach
 * neither copy. See docs/project/logging.md § An error is not a safe thing to
 * log whole.
 *
 * What makes stage 4 the dangerous case: both functions below are handed the
 * result of `JSON.parse` cast to a TypeScript type, and **the cast proves
 * nothing at runtime**. The model can put a sentence of the article where a
 * block id belongs — and that is precisely the input that reaches the throwing
 * branches, because a sentence is never in `blocks.json`. Quoting the value
 * back would therefore log article prose exactly when the model misbehaves.
 *
 * The line these tests hold: a value that has passed `isSpideryarnId` may be
 * named, because it is `spya-` plus six characters from a fixed alphabet and
 * cannot spell a word of anyone's article. Nothing else may be.
 */
describe("errors never carry article prose out of the stage", () => {
  /** Stands in for a phrase of the article arriving where an id belongs. */
  const PROSE = "Feeling is metabolic, not computational, and that is the whole argument";

  const messageOf = (fn: () => unknown): string => {
    try {
      fn();
    } catch (err) {
      return (err as Error).message;
    }
    throw new Error("expected a throw, got none");
  };

  describe("buildTree", () => {
    const withRange = (range: [string, string]): ModelNode => ({
      ...ROOT,
      children: [{ title: "A title the model wrote", range }],
    });

    it("withholds a range start that is not a block id", () => {
      const message = messageOf(() => buildTree(withRange([PROSE, "spya-dddddd"]), NAV, BLOCKS, "t"));
      expect(message).not.toContain(PROSE);
      expect(message).toMatch(/not a block id/);
    });

    it("withholds a range end that is not a block id", () => {
      const message = messageOf(() => buildTree(withRange(["spya-aaaaaa", PROSE]), NAV, BLOCKS, "t"));
      expect(message).not.toContain(PROSE);
      expect(message).toMatch(/not a block id/);
    });

    it("still names a range value that is a well-formed block id", () => {
      // The point is not a vague message. An id that passed `isSpideryarnId` is
      // safe to quote and is the one thing worth knowing, so it must survive.
      const message = messageOf(() => buildTree(withRange(["spya-zzzzzz", "spya-zzzzzz"]), NAV, BLOCKS, "t"));
      expect(message).toContain("spya-zzzzzz");
      expect(message).toMatch(/not in blocks\.json/);
    });

    it("says which node in the tree the bad range belongs to", () => {
      // Position is derived from the shape of the model's own proposal, so it
      // is always safe to report — and it is what tells you where to look.
      const bad: ModelNode = {
        ...ROOT,
        children: [ROOT.children![0]!, { title: "A title", range: [PROSE, PROSE] }],
      };
      expect(messageOf(() => buildTree(bad, NAV, BLOCKS, "t"))).toContain("child 2");
    });

    it("refuses a range that is not a pair of strings, rather than failing inside .join()", () => {
      // `"range": "spya-a…spya-b"` used to reach the id lookup with range[0]
      // === "s", miss, and then blow up in `mn.range.join` with a TypeError
      // that said nothing about what the model had done wrong.
      const bad = { ...ROOT, children: [{ title: "X", range: PROSE as unknown as [string, string] }] };
      const message = messageOf(() => buildTree(bad, NAV, BLOCKS, "t"));
      expect(message).not.toContain(PROSE);
      expect(message).toMatch(/\[start, end\] block range/);
    });
  });

  describe("checkCoverage", () => {
    const tree = buildTree(ROOT, NAV, BLOCKS, "t");

    it("withholds an invented navLabel key that is not a block id", () => {
      const message = messageOf(() => checkCoverage({ ...NAV, [PROSE]: "x" }, tree, BLOCKS));
      expect(message).not.toContain(PROSE);
      expect(message).toMatch(/not block ids at all/);
    });

    it("still names an invented key that is a well-formed block id", () => {
      const labels = { ...NAV, "spya-zzzzzz": "A label from nowhere" };
      expect(messageOf(() => checkCoverage(labels, tree, BLOCKS))).toContain("spya-zzzzzz");
    });

    it("counts every invented key, including the ones it will not name", () => {
      const labels = { ...NAV, [PROSE]: "x", "spya-zzzzzz": "y" };
      const message = messageOf(() => checkCoverage(labels, tree, BLOCKS));
      expect(message).toContain("2 block(s)");
      expect(message).not.toContain(PROSE);
    });
  });
});
