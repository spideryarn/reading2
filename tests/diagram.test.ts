/**
 * The Diagram mode's geometry — src/web/diagram.ts.
 *
 * Every picture is a pure function of the tree (or, for the two scatters, of
 * the tree and the server's projection), which is the reason they are in their
 * own modules: **every failure here is silent in a browser.** SVG does not clip
 * text and does not error on a negative width; a band laid out past the right
 * edge, a label drawn over the article, a column that loses one row per section
 * — all of them render, and all of them look like a design choice.
 *
 * The rules under test are the ones the review flagged as "look right in a
 * browser and are wrong":
 *
 *  1. nothing is ever laid out outside the band's width;
 *  2. a collapsed node keeps its own row and loses only its subtree;
 *  3. no picture draws deeper than the layouts assume.
 *
 * **No picture is laid out in diagram.ts any more.** Strata, Mindmap, Arc and
 * Cluster went on 2026-08-27 and Tree — the last one this module drew — on
 * 2026-08-30. So what is here is the *vocabulary*: the wrapper, the walk, and
 * the two functions that read a finished layout. Force's geometry is in
 * tests/diagram-graph.test.ts and the two scatters' in tests/scatter.test.ts,
 * each against a picture that has its own data.
 *
 * The tests that went with the cut pictures went too, and what is left is
 * deliberately not a smaller version of the same file: two of the rules above
 * (siblings partitioning their parent, a picture growing past the scroller to
 * keep a band clickable) were facts about `strata` and about nothing still
 * drawn. Keeping them as assertions over whatever picture was left would have
 * been a test that passes for a reason unrelated to why it was written.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Block, BlockId, NodeId, Tree } from "../src/types.js";
import {
  CHAIN_NEAR_LEVELS,
  chainNearness,
  chainReach,
  charsThatFit,
  DIAGRAMS,
  type DiagramLink,
  type DiagramNode,
  MAX_DRAWN_DEPTH,
  stepStops,
  nodeAt,
  walk,
  wrapText,
} from "../src/web/diagram.js";
import { layoutDiagram } from "../src/web/diagrams.js";
import { buildSummaryTree, type SummaryNode } from "../src/web/tree.js";
import { siblingRuns } from "../src/web/DiagramPanel.js";

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

/**
 * A tree as the preorder run of `DiagramNode`s every layout produces.
 *
 * **`layoutTree` used to stand in for this**, on the reasonable grounds that
 * `stepStops`, `nodeAt` and `siblingRuns` take nodes and any layout makes some.
 * It was cut on 2026-08-30, and building the nodes here is the better shape
 * anyway: those three are pure functions of preorder, depth, part and range,
 * and reaching them through a layout also tested that layout's geometry, which
 * has a file of its own.
 *
 * The geometry is zeroed because **none of the three reads a coordinate** —
 * checked against each of them, not assumed. If one ever does, this stops being
 * a valid input and the test that needs it should build a real layout.
 */
function nodesOf(root: SummaryNode, collapsed: ReadonlySet<NodeId> = NONE): DiagramNode[] {
  return walk(root, collapsed).map((e) => ({
    id: e.node.node.id,
    blockId: e.node.node.range[0],
    depth: e.node.node.depth,
    number: e.node.number,
    title: e.node.node.title,
    blocks: e.node.blocks,
    startRow: e.node.startRow,
    endRow: e.node.endRow,
    part: e.part,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    labelX: 0,
    labelY: 0,
    anchor: "start" as const,
    lines: [],
    titleLines: 0,
    hasChildren: e.node.children.length > 0,
    collapsed: e.collapsed,
  }));
}

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

describe("stepStops", () => {
  /* The fixture's blocks, so a node's `blockId` has a row to resolve to. Each
     node's `blockId` is `spya-<id>a` (see `node` above), and these are the rows
     the fixture puts them on. */
  const rows = new Map<BlockId, number>(
    (
      [
        ["root", 0],
        ["a", 0],
        ["a1", 0],
        ["a2", 4],
        ["b", 10],
        ["b1", 10],
        ["b2", 50],
      ] as const
    ).map(([id, row]) => [`spya-${id}a` as BlockId, row]),
  );

  it("gives one rung per distinct row, not one per node", () => {
    /* **The whole reason the step buttons walk rows.** Every layout is
       preorder, so the root, part 1 and section 1.1 all begin on row 0 — a
       ladder built from nodes would spend its first three rungs going nowhere,
       and a button that moves nothing looks broken rather than correct. */
    const nodes = nodesOf(fixture());
    const stops = stepStops(nodes, rows);
    expect(nodes.length).toBeGreaterThan(stops.length);
    expect(stops.map((s) => s.row)).toEqual([0, 4, 10, 50]);
  });

  it("keeps the deepest node where several share a row", () => {
    // `nodeAt`'s rule: the deepest node is the most specific thing the reader
    // could mean, and the card describes whatever this lands on.
    const stops = stepStops(nodesOf(fixture()), rows);
    expect(stops[0]?.id).toBe("a1");
  });

  it("takes the row from the block a rung jumps to, not from its range", () => {
    /* **The bug this replaced `stepRows` for.** A scatter dot's range is
       stretched to tile the article, so the first dot claims `startRow: 0`
       while the block it jumps to may be the third paragraph. A ladder built
       from `startRow` puts a rung at row 0 whose jump lands at row 2 — and
       Previous, from row 1, then moves the reader DOWN the page. GPT Sol's
       finding, 2026-08-27. */
    const tiled: DiagramNode[] = nodesOf(fixture())
      .filter((n) => n.depth === 2)
      .map((n) => ({ ...n, startRow: 0 }));
    const stops = stepStops(tiled, rows);
    expect(stops.map((s) => s.row)).toEqual([0, 4, 10, 50]);
    expect(stops.map((s) => s.row)).not.toEqual([0]);
  });

  it("falls back to the range when a block is not in the article", () => {
    // A layout left over from the moment before a re-ingest. A rung in
    // slightly the wrong place beats a button that does nothing.
    const nodes = nodesOf(fixture());
    expect(stepStops(nodes, new Map()).map((s) => s.row)).toEqual([0, 4, 10, 50]);
  });

  it("is empty for a picture with nothing on it, rather than [0]", () => {
    // The panel disables both buttons off `stops.length`, so a phantom rung
    // would leave a live button that steps to a node that is not there.
    expect(stepStops([], rows)).toEqual([]);
  });
});

describe("nodeAt", () => {
  it("marks the deepest node the reader is inside, not the outermost", () => {
    // Marking the part when the section is on screen tells the reader something
    // they already knew. Same rule as the summary panel's follow mark.
    const nodes = nodesOf(fixture());
    expect(nodeAt(nodes, 5)).toBe("a2");
    expect(nodeAt(nodes, 60)).toBe("b2");
  });

  it("marks a collapsed node itself rather than nothing", () => {
    const nodes = nodesOf(fixture(), new Set(["a" as NodeId]));
    expect(nodeAt(nodes, 5)).toBe("a");
  });

  it("is null above the first row, rather than guessing the root", () => {
    expect(nodeAt(nodesOf(fixture()), null)).toBeNull();
  });
});

/**
 * The **committed example article** rather than a fixture built to be
 * convenient — 45 nodes, real headings, real gists, and a shape nobody chose.
 * `example/` is in git; `data/` is not (version-control.md), so this is the
 * largest real article a test can reach on a fresh clone.
 *
 * **Two rules only, and both are about the router.** The width checks that used
 * to live here ran over `DIAGRAMS` and were testing one picture four times —
 * `layoutDiagram` was called with no graph and no scatter input, so Force,
 * Drift and Trail all fell back to `layoutTree`: three green rows saying
 * nothing about three layouts, under a name promising the opposite. GPT Sol's
 * finding, 2026-08-27. Force is checked against this same article in
 * tests/diagram-graph.test.ts, which builds the graph, and the two scatters in
 * tests/scatter.test.ts, which builds a projection.
 */
describe("the router, against the real example article", () => {
  const tree = JSON.parse(readFileSync("example/tree.json", "utf8")) as Tree;
  const raw = JSON.parse(readFileSync("example/blocks.json", "utf8")) as unknown;
  const blocks = (Array.isArray(raw) ? raw : (raw as { blocks: Block[] }).blocks) as Block[];
  const real = buildSummaryTree(tree, blocks);

  it("hands back nothing at all for a picture whose data has not arrived", () => {
    /* **The behaviour that replaced the fallback**, and the whole point of the
       2026-08-30 change. Every one of these used to come back as the Tree, and
       the panel then had to remember that the toggle pressed and the picture on
       screen were two different things — which it twice did not, rendering tree
       geometry under another picture's stylesheet with nothing thrown and
       nothing logged. A null cannot be drawn wearing the wrong clothes: the
       panel shows a spinner or the error instead (DiagramPanel.tsx § Waiting).

       `force` is in the loop too, and it is not a special case: with no graph
       it has nothing either. In the app the graph is built in the browser from
       blocks the page already holds, so this is only reachable there when the
       tree is unusable — which the panel has already said in words. */
    expect(real).not.toBeNull();
    if (!real) return;
    for (const kind of DIAGRAMS) {
      expect(
        layoutDiagram(kind, real, { width: 320, height: 700, collapsed: NONE }),
        `${kind} without its data`,
      ).toBeNull();
    }
  });

  it("never walks deeper than MAX_DRAWN_DEPTH, whatever the tree holds", () => {
    /* The example tree goes to depth 3. The pictures assume 2 — the stylesheet
       has font sizes and fills for `diag-d0` to `diag-d2` and nothing below,
       and graph.ts calls a node at this depth a leaf whether or not it has
       children. `buildSummaryTree` stops at 2 today, so this is guarding the
       assumption rather than the current caller. */
    expect(Math.max(...Object.values(tree.nodes).map((n) => n.depth))).toBeGreaterThan(
      MAX_DRAWN_DEPTH,
    );
    if (!real) return;
    for (const n of nodesOf(real)) expect(n.depth).toBeLessThanOrEqual(MAX_DRAWN_DEPTH);
  });
});

/**
 * `aria-setsize` and `aria-posinset` — the two numbers a flat SVG has to state
 * because its markup cannot imply them.
 *
 * Worth a test rather than a glance: they are read off preorder rather than off
 * the tree, so an off-by-one here says "section 3 of 8" to a screen reader while
 * the picture plainly shows the second of three, and nothing on screen changes.
 */
describe("siblingRuns", () => {
  it("counts each node among its own siblings, not among its level", () => {
    const nodes = nodesOf(fixture());
    const runs = siblingRuns(nodes);
    const of = (id: string) => runs[nodes.findIndex((n) => n.id === id)];

    expect(of("root")).toEqual({ size: 1, pos: 1 });
    expect(of("a")).toEqual({ size: 2, pos: 1 });
    expect(of("b")).toEqual({ size: 2, pos: 2 });
    /* The one that a naive "count everything at this depth" gets wrong: a1 and
       a2 are two of TWO, not two of the four depth-2 nodes in the article. */
    expect(of("a1")).toEqual({ size: 2, pos: 1 });
    expect(of("a2")).toEqual({ size: 2, pos: 2 });
    expect(of("b1")).toEqual({ size: 2, pos: 1 });
  });

  it("counts a closed parent's siblings without counting its hidden children", () => {
    const nodes = nodesOf(fixture(), new Set(["a" as NodeId]));
    const runs = siblingRuns(nodes);
    const of = (id: string) => runs[nodes.findIndex((n) => n.id === id)];
    expect(of("a")).toEqual({ size: 2, pos: 1 });
    expect(of("b1")).toEqual({ size: 2, pos: 1 });
  });
});

/**
 * **The ramp along the sequence chain**, which is the one thing in Diagram mode
 * that both pictures compute the same way and neither picture owns.
 *
 * Greg, 2026-08-30: *"making the connections directly either side of the
 * current node most prominent. Then a bit fainter for the ones at one remove,
 * then a bit fainter for the ones at two removes, etc etc."*
 *
 * Tested on a synthetic chain rather than through a layout, because the two
 * properties that matter here are hard to see through one: what happens on a
 * chain too short for the full reach, and what happens when the chain is not
 * the only thing in the links array. Both draw perfectly well when wrong.
 */
describe("chainNearness", () => {
  /** `n` links joining `n + 1` nodes, in order. */
  function chain(n: number): DiagramLink[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `l${i}`,
      d: "",
      part: -1,
      depth: 0,
      kind: "sequence" as const,
      from: `n${i}` as NodeId,
      to: `n${i + 1}` as NodeId,
    }));
  }

  it("puts the two links either side of the reader at step 0", () => {
    const near = chainNearness(chain(20), "n10" as NodeId);
    expect(near.get("l9")).toBe(0);
    expect(near.get("l10")).toBe(0);
    expect(near.get("l8")).toBeGreaterThan(0);
    expect(near.get("l11")).toBeGreaterThan(0);
  });

  it("never falls as it walks away, in either direction", () => {
    const near = chainNearness(chain(40), "n20" as NodeId);
    for (let i = 9; i >= 0; i--) {
      const inner = near.get(`l${20 + i}`);
      const outer = near.get(`l${20 + i + 1}`);
      if (inner !== undefined && outer !== undefined) expect(outer).toBeGreaterThanOrEqual(inner);
      const innerBack = near.get(`l${19 - i}`);
      const outerBack = near.get(`l${19 - i - 1}`);
      if (innerBack !== undefined && outerBack !== undefined) {
        expect(outerBack).toBeGreaterThanOrEqual(innerBack);
      }
    }
  });

  /**
   * **The one that separates the scaled hop count from the raw one**, and the
   * reason it needs a short chain: on anything long enough for the full reach
   * the two are the same number, so tests/scatter.test.ts cannot see the
   * difference and says so.
   *
   * A three-hop reach with a raw count tops out at step 2 of 8 — the ramp then
   * stops a long way above the chain's own weight, and every article shorter
   * than fifty sections gets a visible edge where the run ends. Probed by
   * replacing the scaling with `d` on 2026-08-30: this reddens, and nothing in
   * scatter.test.ts does.
   */
  it("spans its whole range on a chain too short for the full reach", () => {
    const short = chain(12);
    const reach = chainReach(short.length);
    expect(reach).toBeLessThan(CHAIN_NEAR_LEVELS); // precondition
    const near = chainNearness(short, "n6" as NodeId);
    expect(Math.max(...near.values())).toBeGreaterThanOrEqual(CHAIN_NEAR_LEVELS - 3);
  });

  /**
   * **The reach rule itself, at its boundaries.**
   *
   * The scaling test above distinguishes a scaled hop count from a raw one, and
   * GPT Sol pointed out on 2026-08-30 that it does not pin the rule: a constant
   * reach of 4 passes it. These are the five cases where `min(8, max(3,
   * round(n / 6)))` changes its mind, so a different rule that happens to look
   * right on one fixture cannot survive them.
   *
   * Both caps matter to something real. The floor of 3 keeps a twelve-section
   * article from getting one bright pair and a hard edge; the sixth keeps
   * Trail's 29-segment chain from having most of itself lit, which is the
   * "landmark, not a wash" rule the plateau this replaced also had.
   */
  it("changes its reach where the rule says it does", () => {
    for (const [segments, want] of [
      [1, 3],
      [20, 3],
      [21, 4],
      [26, 4],
      [27, 5],
      [47, 8],
      [400, 8],
    ] as const) {
      expect(chainReach(segments), `${segments} segments`).toBe(want);
    }
  });

  it("stops at the reach, leaving the far chain unclassed", () => {
    const near = chainNearness(chain(60), "n30" as NodeId);
    expect(near.has("l0")).toBe(false);
    expect(near.has("l59")).toBe(false);
    expect(near.size).toBeLessThan(60);
  });

  /**
   * **The vocabulary mesh must not be a shortcut, and the type is what stops
   * it now.**
   *
   * Force puts all five kinds of edge in one array, and on a well-connected
   * article the vocabulary edges join nearly everything to nearly everything —
   * so a walk that followed them would cross the article in two hops and paint
   * the whole chain at step 0 or 1. It would look like a picture with a
   * slightly brighter chain.
   *
   * This was a runtime test that built a vocabulary edge carrying endpoints and
   * checked the walk ignored it. GPT Sol pointed out on 2026-08-30 that it did
   * not test what it claimed: `chainNearness` filters on `kind`, so adding
   * endpoints to a vocabulary edge never could flatten the ramp. It was testing
   * that producers stay tidy.
   *
   * So the state is forbidden instead. `DiagramLink` is a union on `kind` where
   * `sequence` requires both endpoints and the other four declare them `never`,
   * and this is the test of *that* — a `@ts-expect-error` goes red by failing to
   * be an error, so loosening the union back to two optional fields breaks the
   * typecheck rather than quietly re-permitting the edge.
   *
   * Both forms, because they fail for different reasons: excess-property
   * checking catches the fresh literal, and `from?: never` is what catches the
   * named `const` that excess-property checking does not run on.
   */
  it("forbids a non-chain line from naming endpoints, at compile time", () => {
    // @ts-expect-error — a vocabulary edge may not carry `from`/`to`.
    const fresh: DiagramLink = {
      id: "v",
      d: "",
      part: -1,
      depth: 0,
      kind: "vocabulary",
      from: "n0" as NodeId,
      to: "n29" as NodeId,
    };

    const named = {
      id: "v2",
      d: "",
      part: -1,
      depth: 0,
      kind: "vocabulary" as const,
      from: "n0" as NodeId,
      to: "n29" as NodeId,
    };
    // @ts-expect-error — …and a named const is not a way round that.
    const laundered: DiagramLink = named;

    // The walk drops them either way, which is the runtime half of the same
    // claim: a chain of 30 with these two in the array reaches nothing new.
    const links = [...chain(30), fresh, laundered];
    const near = chainNearness(links, "n1" as NodeId);
    expect(near.has("v")).toBe(false);
    expect(near.has("v2")).toBe(false);
    expect(near.has("l28")).toBe(false);
  });

  it("says nothing at all when the reader is nowhere, or is off the chain", () => {
    expect(chainNearness(chain(20), null).size).toBe(0);
    expect(chainNearness(chain(20), "n99" as NodeId).size).toBe(0);
  });
});
