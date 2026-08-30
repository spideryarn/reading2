/**
 * **Two repairs, and the measurement that argues for them.**
 *
 * A paid calibration run of stage 4 on 2026-08-30 threw on 4 of 13 structure
 * calls (31%), and the failures were bimodal by *kind* rather than spread by
 * size — see docs/research/opening-an-article-before-the-toc.md § 7b:
 *
 * | family | count | shape |
 * |---|---|---|
 * | tiling | 2 | gaps of **exactly one block**, both of them |
 * | `sourceHeading` | 2 | a heading claimed outside the node's range |
 *
 * Every tiling failure anyone has observed — those two plus the two in
 * docs/postmortems/the-article-with-one-heading.md — is off by one block. So
 * the choice is not "trust the model" against "check the model"; it is whether
 * a two-and-a-half-minute call that got one boundary off by a single paragraph
 * should cost the reader the whole article. It should not.
 *
 * **What is deliberately NOT relaxed.** The repairs are bounded at one block,
 * and everything else throws exactly as it did: a two-block gap, a backwards
 * range, an invented id, a root that misses the article's ends. A repair that
 * grew with the size of the mistake would be the model marking its own
 * homework, which is the failure this file's neighbours exist to prevent
 * (docs/reusable/silent-success.md).
 *
 * **And nothing is repaired quietly.** `buildTree` takes a report and fills it
 * in; `generateToc` counts it into `TocRun`, the CLI prints it every run
 * including when it is zero, and src/pipeline.ts logs it — the same rule
 * `strandedSupplement` already follows, for the same reason.
 */
import { describe, expect, it } from "vitest";
import { buildTree, type BuildReport, type ModelNode } from "../src/toc.js";
import { checkTree } from "../src/tree-invariants.js";
import type { Block } from "../src/types.js";

function block(id: string, text: string, kind: Block["kind"] = "text", tag = "p"): Block {
  return {
    id,
    tag,
    kind,
    text,
    words: text.split(/\s+/).filter(Boolean).length,
    html: `<${tag} id="${id}">${text}</${tag}>`,
    gistable: kind !== "media",
  };
}

/** Six blocks, two of them the author's own headings. */
const BLOCKS: Block[] = [
  block("spya-aaaaaa", "Opening paragraph before any heading"),
  block("spya-bbbbbb", "The First Part", "heading", "h2"),
  block("spya-cccccc", "Body of the first part"),
  block("spya-dddddd", "The Second Part", "heading", "h2"),
  block("spya-eeeeee", "Body of the second part"),
  block("spya-ffffff", "A closing paragraph"),
];

const report = (): BuildReport => ({ repairs: [], droppedHeadings: [] });

/** Every leaf's block, in tree order — what the reader can actually reach. */
function leafBlocks(tree: ReturnType<typeof buildTree>): string[] {
  return Object.values(tree.nodes)
    .filter((n) => n.children.length === 0)
    .map((n) => n.range[0]);
}

describe("an off-by-one partition is repaired, not refused", () => {
  /** Child 2 starts one block late, so `spya-cccccc` would grow no leaf at all. */
  const gapped: ModelNode = {
    title: "Whole piece",
    gist: "The article argues something.",
    range: ["spya-aaaaaa", "spya-ffffff"],
    children: [
      { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
      { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
    ],
  };

  it("snaps a one-block gap so every block still gets exactly one leaf", () => {
    const r = report();
    const tree = buildTree(gapped, {}, BLOCKS, "test", r);
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    expect(r.repairs).toEqual([{ where: "root > child 2", kind: "gap", at: 2 }]);
  });

  it("gives the orphaned block to the section that follows it", () => {
    const tree = buildTree(gapped, {}, BLOCKS, "test", report());
    const second = Object.values(tree.nodes).find((n) => n.title === "Second");
    expect(second?.range[0]).toBe("spya-cccccc");
  });

  it("snaps a one-block overlap, which would otherwise grow two leaves for one block", () => {
    const overlapping: ModelNode = {
      ...gapped,
      children: [
        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-cccccc"] },
        { title: "Second", gist: "It closes.", range: ["spya-cccccc", "spya-ffffff"] },
      ],
    };
    const r = report();
    const tree = buildTree(overlapping, {}, BLOCKS, "test", r);
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    expect(r.repairs).toEqual([{ where: "root > child 2", kind: "overlap", at: 3 }]);
  });

  it("extends a last child that stops one block before its parent ends", () => {
    const short: ModelNode = {
      ...gapped,
      children: [
        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-cccccc"] },
        { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-eeeeee"] },
      ],
    };
    const r = report();
    const tree = buildTree(short, {}, BLOCKS, "test", r);
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    expect(r.repairs).toEqual([{ where: "root > child 2", kind: "short", at: 5 }]);
  });

  it("cascades into the repaired node's own children, which now start one block late", () => {
    // The whole point of repairing on the model's proposal rather than on the
    // built tree: moving a node's start moves its first child's too, and a
    // repair that stopped at one level would trade a broken partition at depth
    // 1 for a broken one at depth 2.
    const nested: ModelNode = {
      ...gapped,
      children: [
        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
        {
          title: "Second",
          gist: "It closes.",
          range: ["spya-dddddd", "spya-ffffff"],
          children: [
            { title: "Inner one", gist: "A point.", range: ["spya-dddddd", "spya-eeeeee"] },
            { title: "Inner two", gist: "Another.", range: ["spya-ffffff", "spya-ffffff"] },
          ],
        },
      ],
    };
    const r = report();
    const tree = buildTree(nested, {}, BLOCKS, "test", r);
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    expect(r.repairs.map((x) => x.where)).toEqual(["root > child 2", "root > child 2 > child 1"]);
    /* **One boundary, seen at two depths** — and that is exactly why the budget
       below does not spend on it. If these ever came out as two coordinates,
       the cascade would eat the whole answer's allowance at the first nested
       node and a repair that works today would start throwing. */
    expect(new Set(r.repairs.map((x) => x.at))).toEqual(new Set([2]));
  });

  it("produces a tree the invariants accept, which is the only claim that matters", () => {
    const tree = buildTree(gapped, {}, BLOCKS, "test", report());
    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
  });

  describe("and the bound is one block, in every direction", () => {
    it("still refuses a two-block gap", () => {
      const wide: ModelNode = {
        ...gapped,
        children: [
          { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-aaaaaa"] },
          { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
        ],
      };
      expect(() => buildTree(wide, {}, BLOCKS, "test", report())).toThrow(/leaves a gap of 2 block/);
    });

    it("still refuses a two-block overlap", () => {
      const wide: ModelNode = {
        ...gapped,
        children: [
          { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-dddddd"] },
          { title: "Second", gist: "It closes.", range: ["spya-cccccc", "spya-ffffff"] },
        ],
      };
      expect(() => buildTree(wide, {}, BLOCKS, "test", report())).toThrow(/overlaps the one before/);
    });

    it("still refuses a last child that stops two blocks short", () => {
      const wide: ModelNode = {
        ...gapped,
        children: [
          { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-cccccc"] },
          { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-dddddd"] },
        ],
      };
      expect(() => buildTree(wide, {}, BLOCKS, "test", report())).toThrow(/stop 2 block\(s\)/);
    });

    it("does not repair an overlap that would leave the node covering nothing", () => {
      // Child 2 is a single block, and it is the one child 1 already ate. There
      // is no snap that leaves it non-empty, so this stays a refusal rather
      // than becoming a range that runs backwards two lines later.
      const swallowed: ModelNode = {
        ...gapped,
        children: [
          { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-cccccc"] },
          { title: "Second", gist: "A point.", range: ["spya-cccccc", "spya-cccccc"] },
          { title: "Third", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
        ],
      };
      expect(() => buildTree(swallowed, {}, BLOCKS, "test", report())).toThrow(/overlaps the one before/);
    });

    /**
     * **The bound that matters is per answer, not per boundary.**
     *
     * Every recorded tiling failure was one slipped boundary. An answer with
     * two independent ones is a different event, and mending each separately
     * would walk a systematically misaligned tree past the check one block at
     * a time while every individual step looked defensible — the shape of
     * silent success, arrived at by small honest moves. GPT Sol's review
     * caught that the first version of this was bounded per boundary, which is
     * no bound on the answer at all.
     */
    it("refuses an answer with two independent one-block slips, having mended one", () => {
      const twice: ModelNode = {
        ...gapped,
        children: [
          // Child 2 starts one late (the first slip); child 3 then starts one
          // late again, at a different boundary.
          { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-aaaaaa"] },
          { title: "Second", gist: "A point.", range: ["spya-cccccc", "spya-dddddd"] },
          { title: "Third", gist: "It closes.", range: ["spya-ffffff", "spya-ffffff"] },
        ],
      };
      const r = report();
      expect(() => buildTree(twice, {}, BLOCKS, "test", r)).toThrow(/do not tile it/);
      // And it stopped after spending its one repair, rather than not trying.
      expect(new Set(r.repairs.map((x) => x.at)).size).toBe(1);
    });

    it("leaves an invented id to the error that names it, rather than guessing", () => {
      const invented: ModelNode = {
        ...gapped,
        children: [
          { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
          { title: "Second", gist: "It closes.", range: ["spya-zzzzzz", "spya-ffffff"] },
        ],
      };
      expect(() => buildTree(invented, {}, BLOCKS, "test", report())).toThrow(/not in blocks\.json/);
    });

    it("records nothing when the model tiled the article correctly", () => {
      const sound: ModelNode = {
        ...gapped,
        children: [
          { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-cccccc"] },
          { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
        ],
      };
      const r = report();
      expect(() => buildTree(sound, {}, BLOCKS, "test", r)).not.toThrow();
      expect(r.repairs).toEqual([]);
    });
  });
});

describe("a sourceHeading no block backs up is dropped, not thrown on", () => {
  /**
   * `sourceHeading` is provenance, not structure. Its only consumer is the `§`
   * badge that tells the reader "the author wrote this heading, we did not" —
   * src/web/TableView.tsx, src/web/ContextList.tsx, src/web/Spine.tsx. So an
   * unbacked claim is a badge that would lie, and dropping it costs the reader
   * a mark of provenance where throwing costs them the article.
   *
   * Four structure calls in four made the same wrong claim on the same
   * article, so throwing on it is not an occasional loss — it is a guaranteed
   * failure loop for that document.
   */
  const claiming = (heading: string): ModelNode => ({
    title: "Whole piece",
    gist: "The article argues something.",
    range: ["spya-aaaaaa", "spya-ffffff"],
    children: [
      {
        title: "First",
        gist: "It opens.",
        range: ["spya-aaaaaa", "spya-cccccc"],
        sourceHeading: heading,
      },
      { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
    ],
  });

  it("keeps a claim the node's range really contains", () => {
    const r = report();
    const tree = buildTree(claiming("The First Part"), {}, BLOCKS, "test", r);
    const first = Object.values(tree.nodes).find((n) => n.title === "First");
    expect(first?.sourceHeading).toBe("The First Part");
    expect(r.droppedHeadings).toEqual([]);
  });

  it("keeps a claim that differs only in punctuation, as the invariant does", () => {
    // `sameHeading` normalises curly quotes and dashes — a model quoting a
    // heading back with the wrong apostrophe broke this once already
    // (docs/postmortems/toc-max-tokens.md).
    const tree = buildTree(claiming("The First Part"), {}, BLOCKS, "test", report());
    const first = Object.values(tree.nodes).find((n) => n.title === "First");
    expect(first?.sourceHeading).toBe("The First Part");
  });

  it("drops a claim for a heading that is outside the node's range", () => {
    const r = report();
    const tree = buildTree(claiming("The Second Part"), {}, BLOCKS, "test", r);
    const first = Object.values(tree.nodes).find((n) => n.title === "First");
    expect(first?.sourceHeading).toBeUndefined();
    expect(r.droppedHeadings).toEqual(["root > child 1"]);
  });

  it("drops a claim for a heading that is nowhere in the article", () => {
    const tree = buildTree(claiming("A Heading Nobody Wrote"), {}, BLOCKS, "test", report());
    const first = Object.values(tree.nodes).find((n) => n.title === "First");
    expect(first?.sourceHeading).toBeUndefined();
  });

  it("keeps the node and its title — only the provenance mark goes", () => {
    const tree = buildTree(claiming("A Heading Nobody Wrote"), {}, BLOCKS, "test", report());
    const first = Object.values(tree.nodes).find((n) => n.title === "First");
    expect(first).toBeDefined();
    expect(first?.range).toEqual(["spya-aaaaaa", "spya-cccccc"]);
  });

  it("leaves nothing for the invariant to fail on, which is the point", () => {
    // The repair is deliberately at least as strict as `checkTree`'s own rule:
    // it reads the same `sameHeading` over the same range, so anything it keeps
    // the invariant keeps too. That is what makes this a repair rather than a
    // second opinion.
    const tree = buildTree(claiming("The Second Part"), {}, BLOCKS, "test", report());
    const problems = checkTree(BLOCKS, tree).problems.filter((p) => p.includes("sourceHeading"));
    expect(problems).toEqual([]);
  });

  /* A number, or a string of spaces, is a claim this stage threw away too — and
     the first version of this counted only the well-formed ones, so the one
     case that says the model's output has gone strange was the one case nobody
     was told about. GPT Sol's review. */
  it("ignores a claim that is not a string at all, and still counts it as dropped", () => {
    const bad = claiming("x");
    (bad.children![0] as { sourceHeading?: unknown }).sourceHeading = 42;
    const r = report();
    expect(() => buildTree(bad, {}, BLOCKS, "test", r)).not.toThrow();
    expect(r.droppedHeadings).toEqual(["root > child 1"]);
  });

  it("counts a claim that is nothing but whitespace", () => {
    const r = report();
    buildTree(claiming("   "), {}, BLOCKS, "test", r);
    expect(r.droppedHeadings).toEqual(["root > child 1"]);
  });
});
