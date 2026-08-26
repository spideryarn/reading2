/**
 * The Diagram mode's geometry — src/web/diagram.ts.
 *
 * All three pictures are pure functions of the tree, which is the reason they
 * are in their own module: **every failure here is silent in a browser.** SVG
 * does not clip text and does not error on a negative width; a band laid out
 * past the right edge, a label drawn over the article, a `strata` column that
 * loses one row per section — all of them render, and all of them look like a
 * design choice.
 *
 * The rules under test are the three the review flagged as the ones that "look
 * right in a browser and are wrong":
 *
 *  1. siblings exactly partition their parent, with no seam and no overlap;
 *  2. nothing is ever laid out outside the band's width;
 *  3. a collapsed node keeps its own row and loses only its subtree.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Block, BlockId, NodeId, Tree } from "../src/types.js";
import {
  charsThatFit,
  DIAGRAMS,
  type DiagramKind,
  type DiagramNode,
  GIST_PX,
  LABEL_PX,
  layoutDiagram,
  MAX_DRAWN_DEPTH,
  layoutMindmap,
  layoutStrata,
  layoutTree,
  nodeAt,
  walk,
  wrapText,
} from "../src/web/diagram.js";
import { buildSummaryTree, type SummaryNode } from "../src/web/tree.js";

/**
 * A `SummaryNode` by hand.
 *
 * Built rather than run through `buildSummaryTree` on purpose: that function
 * has its own tests, and threading a whole `Tree` plus a block array through
 * this file would make every assertion below depend on two things instead of
 * one. `startRow`/`endRow` are set explicitly so the partition test has
 * something to be wrong about.
 */
function node(
  id: string,
  number: string,
  depth: number,
  startRow: number,
  endRow: number,
  children: SummaryNode[] = [],
  parent: string | null = null,
): SummaryNode {
  return {
    node: {
      id: id as NodeId,
      depth,
      parent: parent as NodeId | null,
      children: children.map((c) => c.node.id),
      range: [`spya-${id}a` as BlockId, `spya-${id}z` as BlockId],
      title: `Title of ${id}`,
      ...(depth < 3 && { gist: `A one sentence gist for ${id}, long enough to need wrapping.` }),
    },
    number,
    startRow,
    endRow,
    blocks: endRow - startRow + 1,
    ...(depth < 3 && { gist: `A one sentence gist for ${id}, long enough to need wrapping.` }),
    children,
  };
}

/** Root 0–99. Part A is rows 0–9 (short); part B is 10–99 (nine times longer). */
function fixture(): SummaryNode {
  const a1 = node("a1", "1.1", 2, 0, 3, [], "a");
  const a2 = node("a2", "1.2", 2, 4, 9, [], "a");
  const b1 = node("b1", "2.1", 2, 10, 49, [], "b");
  const b2 = node("b2", "2.2", 2, 50, 99, [], "b");
  const a = node("a", "1", 1, 0, 9, [a1, a2], "root");
  const b = node("b", "2", 1, 10, 99, [b1, b2], "root");
  return node("root", "", 0, 0, 99, [a, b]);
}

const NONE: ReadonlySet<NodeId> = new Set();
const OPTS = { width: 320, height: 600, collapsed: NONE };

describe("wrapText", () => {
  it("breaks on words and keeps every line inside the budget", () => {
    for (const line of wrapText("the quick brown fox jumps over the lazy dog", 12, 5)) {
      expect(line.length).toBeLessThanOrEqual(12);
    }
  });

  it("hard-cuts a word longer than the whole budget", () => {
    // A URL or a chemical name in a heading. Without the cut this overflows the
    // band, and SVG neither clips it nor complains.
    const lines = wrapText("supercalifragilisticexpialidocious", 8, 3);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(8);
  });

  it("marks a hard-cut word as truncated too", () => {
    /* Found by GPT Sol. The truncation flag used to be inferred by comparing
       word counts, and a word cut into three fragments IS three words out and
       one in — so the one case the hard cut exists for was the one case that
       silently lost its ellipsis. 34 characters into 3×8 drops 10 of them. */
    const lines = wrapText("supercalifragilisticexpialidocious", 8, 3);
    expect(lines[lines.length - 1]?.endsWith("…")).toBe(true);
  });

  it("marks text cut off by running out of lines mid-word", () => {
    const lines = wrapText("alpha bravo charlie delta echo", 7, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith("…")).toBe(true);
  });

  it("marks a truncation rather than stopping mid-sentence", () => {
    const lines = wrapText("one two three four five six seven eight", 9, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith("…")).toBe(true);
  });

  it("does not mark text that fitted", () => {
    expect(wrapText("one two", 20, 2)).toEqual(["one two"]);
    // "four" will not fit after "three" (10 > 9), so it is dropped and said so.
    expect(wrapText("one two three four", 9, 2)).toEqual(["one two", "three…"]);
    // Nothing dropped, nothing marked.
    expect(wrapText("one two three", 9, 2)).toEqual(["one two", "three"]);
  });

  it("returns nothing rather than one line when there is no room", () => {
    expect(wrapText("anything", 10, 0)).toEqual([]);
  });

  it("always fits at least one character, so wrapping terminates", () => {
    expect(charsThatFit(0, 12)).toBe(1);
    expect(charsThatFit(-40, 12)).toBe(1);
  });
});

describe("walk", () => {
  it("is preorder, which is document order", () => {
    expect(walk(fixture(), NONE).map((e) => e.node.node.id)).toEqual([
      "root",
      "a",
      "a1",
      "a2",
      "b",
      "b1",
      "b2",
    ]);
  });

  it("tags every node with the L1 part it lives in, and the root with -1", () => {
    const by = new Map(walk(fixture(), NONE).map((e) => [e.node.node.id, e.part]));
    expect(by.get("root")).toBe(-1);
    expect(by.get("a")).toBe(0);
    expect(by.get("a2")).toBe(0);
    expect(by.get("b1")).toBe(1);
  });

  it("keeps a collapsed node and drops only its subtree", () => {
    // The distinction SummaryPanel writes up: "too deep to show" and "I closed
    // this" are different states. A closed node that vanished would be the
    // former, and there would then be no way to reopen it.
    const walked = walk(fixture(), new Set(["a" as NodeId]));
    expect(walked.map((e) => e.node.node.id)).toEqual(["root", "a", "b", "b1", "b2"]);
    expect(walked.find((e) => e.node.node.id === "a")?.collapsed).toBe(true);
  });

  it("does not mark a childless node as collapsed even if its id is in the set", () => {
    // Otherwise a stale id in the set draws a chevron on a leaf, and pressing it
    // does nothing — a control that looks live and is not.
    const walked = walk(fixture(), new Set(["a1" as NodeId]));
    expect(walked.find((e) => e.node.node.id === "a1")?.collapsed).toBe(false);
  });
});

describe("layoutStrata", () => {
  it("is to scale: a part nine times longer is nine times taller", () => {
    const { nodes } = layoutStrata(fixture(), OPTS);
    const a = nodes.find((n) => n.id === "a");
    const b = nodes.find((n) => n.id === "b");
    expect(a && b).toBeTruthy();
    expect((b?.h ?? 0) / (a?.h ?? 1)).toBeCloseTo(9, 1);
  });

  it("siblings exactly partition their parent — no seam, no overlap", () => {
    /* THE bug this file exists for. `endRow` is inclusive, so a band that ends
       at `rowToY(endRow)` is one row short, and every sibling boundary gains a
       hairline gap that reads as a design flourish. Asserted to the sub-pixel,
       because at 600px for 100 rows one row is 6px and would be visible — but at
       6000px it is 0.6px and would not, which is how this ships. */
    const { nodes } = layoutStrata(fixture(), OPTS);
    const a = nodes.find((n) => n.id === "a");
    const b = nodes.find((n) => n.id === "b");
    expect((a?.y ?? 0) + (a?.h ?? 0)).toBeCloseTo(b?.y ?? 0, 6);

    const a1 = nodes.find((n) => n.id === "a1");
    const a2 = nodes.find((n) => n.id === "a2");
    expect((a1?.y ?? 0) + (a1?.h ?? 0)).toBeCloseTo(a2?.y ?? 0, 6);
    // And the children exactly fill the parent, top and bottom.
    expect(a1?.y).toBeCloseTo(a?.y ?? 0, 6);
    expect((a2?.y ?? 0) + (a2?.h ?? 0)).toBeCloseTo((a?.y ?? 0) + (a?.h ?? 0), 6);
  });

  it("keeps every band inside the band's width", () => {
    for (const n of layoutStrata(fixture(), OPTS).nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w).toBeLessThanOrEqual(OPTS.width);
    }
  });

  it("grows past the scroller rather than drawing a band nobody can click", () => {
    /* A tiny section inside a long article. Fitted to 600px it would be under a
       pixel tall — present, correct, and unusable. The picture scrolls instead. */
    const tiny = node("t", "2.3", 2, 98, 98, [], "b");
    const root = fixture();
    root.children[1]?.children.push(tiny);
    const fitted = layoutStrata(root, OPTS);
    expect(fitted.height).toBeGreaterThan(OPTS.height);
    const drawn = fitted.nodes.find((n) => n.id === "t");
    expect(drawn?.h ?? 0).toBeGreaterThanOrEqual(5.9);
  });

  it("does not stay stretched for bands the reader has closed", () => {
    /* The height is driven by the smallest DRAWN node. Driving it from the tree
       instead would leave the picture scrolling for a sliver that is no longer
       on it — right the first time, wrong after one click, and invisible in a
       test that only ever renders the open tree. */
    const tiny = node("t", "2.3", 2, 98, 98, [], "b");
    const root = fixture();
    root.children[1]?.children.push(tiny);
    const closed = layoutStrata(root, { ...OPTS, collapsed: new Set(["b" as NodeId]) });
    expect(closed.height).toBeLessThanOrEqual(OPTS.height);
  });

  it("reports an axis that maps row 0 to the top and the last row to the bottom", () => {
    const { axis } = layoutStrata(fixture(), OPTS);
    expect(axis).not.toBeNull();
    const y = (row: number) => (axis ? axis.top + (row / axis.rows) * axis.height : Number.NaN);
    const first = layoutStrata(fixture(), OPTS).nodes.find((n) => n.id === "root");
    expect(y(0)).toBeCloseTo(first?.y ?? 0, 6);
    expect(y(100)).toBeCloseTo((first?.y ?? 0) + (first?.h ?? 0), 6);
  });
});

describe("layoutTree", () => {
  it("indents by depth and never runs a label off the right edge", () => {
    const { nodes } = layoutTree(fixture(), OPTS);
    const depths = new Map(nodes.map((n) => [n.id, n.labelX]));
    expect(depths.get("a") ?? 0).toBeGreaterThan(depths.get("root") ?? 0);
    expect(depths.get("a1") ?? 0).toBeGreaterThan(depths.get("a") ?? 0);
    for (const n of nodes) {
      expect(n.labelX).toBeLessThan(OPTS.width);
      n.lines.forEach((line, i) => {
        /* Title lines are set at 12px and gist lines at 10.5px — the same two
           budgets `layoutTree` wraps against. Measuring both at 12 is what this
           assertion did first, and it failed on a gist line that was in fact
           perfectly inside the band. Worth keeping in mind: a test of estimated
           text width has to use the same estimate, or it tests the estimate. */
        const fontPx = i < n.titleLines ? 12 : 10.5;
        expect(n.labelX + line.length * fontPx * 0.52).toBeLessThanOrEqual(OPTS.width + 1);
      });
    }
  });

  it("stacks rows top to bottom in document order and never overlaps them", () => {
    const nodes = layoutTree(fixture(), OPTS).nodes;
    for (let i = 1; i < nodes.length; i++) {
      const prev = nodes[i - 1];
      const cur = nodes[i];
      if (!prev || !cur) continue;
      expect(cur.y).toBeGreaterThanOrEqual(prev.y + prev.h - 0.001);
    }
  });

  it("draws one connector per node except the root", () => {
    const { nodes, links } = layoutTree(fixture(), OPTS);
    expect(links).toHaveLength(nodes.length - 1);
  });

  it("hides a closed node's gist, because a closed node is a summary of itself", () => {
    const open = layoutTree(fixture(), OPTS).nodes.find((n) => n.id === "a");
    const shut = layoutTree(fixture(), { ...OPTS, collapsed: new Set(["a" as NodeId]) }).nodes.find(
      (n) => n.id === "a",
    );
    expect((shut?.lines.length ?? 0)).toBeLessThan(open?.lines.length ?? 0);
  });
});

describe("layoutMindmap", () => {
  it("alternates parts left and right of the trunk", () => {
    const { nodes, width } = layoutMindmap(fixture(), OPTS);
    const a = nodes.find((n) => n.id === "a");
    const b = nodes.find((n) => n.id === "b");
    expect((a?.x ?? 0) + (a?.w ?? 0)).toBeGreaterThan(width / 2);
    expect(b?.x ?? width).toBeLessThan(width / 2);
  });

  it("keeps every node inside the band, on both sides", () => {
    for (const n of layoutMindmap(fixture(), OPTS).nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w).toBeLessThanOrEqual(OPTS.width);
    }
  });

  it("is still in document order down the page", () => {
    // The one property a published mindmap grammar would have taken from us.
    const nodes = layoutMindmap(fixture(), OPTS).nodes;
    const a = nodes.find((n) => n.id === "a");
    const b = nodes.find((n) => n.id === "b");
    expect(a?.y ?? 0).toBeLessThan(b?.y ?? 0);
  });

  it("draws a trunk that stops at the last part rather than trailing off", () => {
    const { links, nodes } = layoutMindmap(fixture(), OPTS);
    const trunk = links.find((l) => l.id === "trunk");
    expect(trunk).toBeTruthy();
    const end = Number(trunk?.d.split("V")[1]?.trim());
    const last = nodes.filter((n) => n.depth === 1).pop();
    expect(end).toBeLessThanOrEqual((last?.y ?? 0) + (last?.h ?? 0) + 20);
  });

  it("drops a closed part's twigs and keeps the part", () => {
    const { nodes } = layoutMindmap(fixture(), { ...OPTS, collapsed: new Set(["a" as NodeId]) });
    expect(nodes.some((n) => n.id === "a")).toBe(true);
    expect(nodes.some((n) => n.id === "a1")).toBe(false);
    expect(nodes.some((n) => n.id === "b1")).toBe(true);
  });
});

describe("nodeAt", () => {
  it("marks the deepest node the reader is inside, not the outermost", () => {
    // Marking the part when the section is on screen tells the reader something
    // they already knew. Same rule as the summary panel's follow mark.
    const { nodes } = layoutStrata(fixture(), OPTS);
    expect(nodeAt(nodes, 5)).toBe("a2");
    expect(nodeAt(nodes, 60)).toBe("b2");
  });

  it("marks a collapsed node itself rather than nothing", () => {
    const { nodes } = layoutStrata(fixture(), { ...OPTS, collapsed: new Set(["a" as NodeId]) });
    expect(nodeAt(nodes, 5)).toBe("a");
  });

  it("is null above the first row, rather than guessing the root", () => {
    expect(nodeAt(layoutStrata(fixture(), OPTS).nodes, null)).toBeNull();
  });
});

/**
 * The same three rules, against the **committed example article** rather than a
 * fixture built to be convenient.
 *
 * The tree above has four sections with tidy short titles. This one has 45
 * nodes, real headings, real gists, and a shape nobody chose — which is the
 * only kind of input that catches a budget that was very slightly too generous.
 * `example/` is in git; `data/` is not (version-control.md), so this is the
 * largest real article a test can reach on a fresh clone.
 *
 * Run across the whole width range the band can actually take: `MODE_MIN` is
 * 288 and `MODE_IDEAL` is 400 (src/web/layout.ts), and the narrow end is where
 * a label runs out.
 */
describe("the three pictures, against the real example article", () => {
  const tree = JSON.parse(readFileSync("example/tree.json", "utf8")) as Tree;
  const raw = JSON.parse(readFileSync("example/blocks.json", "utf8")) as unknown;
  const blocks = (Array.isArray(raw) ? raw : (raw as { blocks: Block[] }).blocks) as Block[];
  const real = buildSummaryTree(tree, blocks, null);

  /* The estimate `wrapText` used for this line, which is the only honest ruler
     for a label it wrapped. Getting THIS wrong is how a check reports a bug that
     is not there — it happened twice while writing these, both times by
     measuring a 10.5px gist line at title size. */
  const lineWidth = (n: DiagramNode, i: number, kind: DiagramKind) =>
    (n.lines[i]?.length ?? 0) * (i >= n.titleLines ? GIST_PX : (LABEL_PX[kind]?.[n.depth] ?? 12)) * 0.52;

  for (const kind of DIAGRAMS) {
    for (const width of [288, 320, 400]) {
      it(`${kind} at ${width}px stays inside the band and draws no impossible box`, () => {
        expect(real).not.toBeNull();
        if (!real) return;
        const layout = layoutDiagram(kind, real, { width, height: 700, collapsed: NONE });
        expect(layout.nodes.length).toBeGreaterThan(0);

        for (const n of layout.nodes) {
          for (const v of [n.x, n.y, n.w, n.h, n.labelX, n.labelY]) expect(v).toBeTypeOf("number");
          for (const v of [n.x, n.y, n.w, n.h, n.labelX, n.labelY]) expect(Number.isFinite(v)).toBe(true);
          expect(n.w).toBeGreaterThanOrEqual(0);
          expect(n.h).toBeGreaterThanOrEqual(0);
          expect(n.x).toBeGreaterThanOrEqual(-0.5);
          expect(n.x + n.w).toBeLessThanOrEqual(width + 0.5);

          n.lines.forEach((_, i) => {
            if (n.rotated) return; // its budget is the box's HEIGHT, not its width
            const w = lineWidth(n, i, kind);
            const left =
              n.anchor === "start" ? n.labelX : n.anchor === "end" ? n.labelX - w : n.labelX - w / 2;
            expect(left, `${kind} ${n.number} line ${i} starts left of the band`).toBeGreaterThan(-1);
            expect(left + w, `${kind} ${n.number} line ${i} runs past the band`).toBeLessThanOrEqual(
              width + 1,
            );
          });
        }
      });
    }
  }

  it("never draws deeper than MAX_DRAWN_DEPTH, whatever the tree holds", () => {
    /* The example tree goes to depth 3. All three layouts assume 2 — strata has
       three x positions and would stack depth 3 on depth 2, and mindmap reads
       exactly two levels of children. `buildSummaryTree` stops at 2 today, so
       this is guarding the assumption rather than the current caller. */
    expect(Math.max(...Object.values(tree.nodes).map((n) => n.depth))).toBeGreaterThan(
      MAX_DRAWN_DEPTH,
    );
    if (!real) return;
    for (const kind of DIAGRAMS) {
      const layout = layoutDiagram(kind, real, { width: 320, height: 700, collapsed: NONE });
      for (const n of layout.nodes) expect(n.depth).toBeLessThanOrEqual(MAX_DRAWN_DEPTH);
    }
  });
});
