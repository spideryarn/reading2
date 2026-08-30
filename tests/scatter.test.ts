/**
 * **The geometry of Drift and Trail** — src/web/scatter.ts.
 *
 * Same reasoning as tests/diagram.test.ts, and it applies harder here. SVG does
 * not clip and does not error, so a dot laid out past the right-hand edge is a
 * paragraph that has silently left the picture; a scale that divides by a zero
 * range is a `NaN` in a `cx`, which browsers render as *nothing at all* with a
 * clean console; and an axis scaled independently on x and y draws a 6%
 * component taller than a 15% one, which is a picture that lies about distance
 * while looking completely normal.
 *
 * Every one of those is docs/reusable/silent-success.md. So the numbers are
 * pinned here, where they are arithmetic, rather than looked at in a browser,
 * where they are a design opinion.
 */
import { describe, expect, it } from "vitest";
import type { Block, BlockId, NodeId, ProjectionPoint } from "../src/types.js";
import { chainNearness, chainReach, nodeAt, type DiagramOptions } from "../src/web/diagram.js";
import { laneTerms, layoutDrift, layoutTrail, type ScatterInput } from "../src/web/scatter.js";
import type { SummaryNode } from "../src/web/tree.js";

const WIDTH = 320;
const HEIGHT = 520;

function opts(over: Partial<DiagramOptions> = {}): DiagramOptions {
  return { width: WIDTH, height: HEIGHT, collapsed: new Set<NodeId>(), atRow: null, ...over };
}

function blocks(n: number, words = (i: number) => 20 + (i % 7) * 10): Block[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `spya-b${String(i).padStart(4, "0")}` as BlockId,
    tag: "p",
    kind: "text",
    text: `Paragraph ${i} about ${i % 3 === 0 ? "honesty" : i % 3 === 1 ? "agency" : "welfare"} and other matters that carry on for a while.`,
    words: words(i),
    html: "<p></p>",
    gistable: true,
  }));
}

/** Two parts of equal size, so `part` is 0 for the first half and 1 for the second. */
function tree(bs: readonly Block[]): SummaryNode {
  const half = Math.floor(bs.length / 2);
  const section = (id: string, number: string, startRow: number, endRow: number): SummaryNode => ({
    node: {
      id: id as NodeId,
      depth: 1,
      parent: "root" as NodeId,
      children: [],
      range: [bs[startRow]?.id ?? ("spya-x" as BlockId), bs[endRow]?.id ?? ("spya-x" as BlockId)],
      title: `Section ${number}`,
      gist: "A gist.",
    },
    number,
    startRow,
    endRow,
    blocks: endRow - startRow + 1,
    children: [],
  });
  const kids = [section("s1", "1", 0, half - 1), section("s2", "2", half, bs.length - 1)];
  return {
    node: {
      id: "root" as NodeId,
      depth: 0,
      parent: null,
      children: kids.map((k) => k.node.id),
      range: [bs[0]?.id ?? ("spya-x" as BlockId), bs[bs.length - 1]?.id ?? ("spya-x" as BlockId)],
      title: "The article",
      gist: "The whole thing.",
    },
    number: "",
    startRow: 0,
    endRow: bs.length - 1,
    blocks: bs.length,
    children: kids,
  };
}

/**
 * A projection over every second block, so the dots deliberately do NOT tile
 * the article — which is the real case: short blocks are not embedded.
 */
function points(bs: readonly Block[], k = 4): ProjectionPoint[] {
  const out: ProjectionPoint[] = [];
  for (let i = 0; i < bs.length; i += 2) {
    const b = bs[i];
    if (!b) continue;
    out.push({
      id: b.id,
      // A spiral, so x and y are correlated with nothing in particular and the
      // ranges are genuinely different from each other.
      x: Math.cos(i / 5) * (0.2 + i / bs.length / 4),
      y: Math.sin(i / 5) * 0.1,
      c: i % k,
    });
  }
  return out;
}

function input(pts: readonly ProjectionPoint[], over: Partial<ScatterInput> = {}): ScatterInput {
  return { points: pts, k: 4, axis: "lanes", hue: "section", ...over };
}

describe("both scatters", () => {
  const bs = blocks(60);
  const root = tree(bs);
  const pts = points(bs);

  it.each([
    ["drift", layoutDrift],
    ["trail", layoutTrail],
  ])("keeps every dot inside the picture — %s", (_name, layout) => {
    /* The failure this catches renders perfectly: a dot at x = 340 in a 320px
       viewBox is simply not there, and the picture looks like an article with
       fewer paragraphs than it has. */
    for (const axis of ["lanes", "spread"] as const) {
      const out = layout(root, bs, opts(), input(pts, { axis }));
      for (const n of out.nodes) {
        const dot = n.dot;
        expect(dot, `${n.id} has no dot`).toBeDefined();
        if (!dot) continue;
        expect(dot.x - dot.r).toBeGreaterThanOrEqual(0);
        expect(dot.x + dot.r).toBeLessThanOrEqual(out.width);
        expect(dot.y - dot.r).toBeGreaterThanOrEqual(0);
        expect(dot.y + dot.r).toBeLessThanOrEqual(out.height);
      }
    }
  });

  it.each([
    ["drift", layoutDrift],
    ["trail", layoutTrail],
  ])("never puts a NaN in a coordinate — %s", (_name, layout) => {
    /* Every paragraph scoring identically is a real input — a two-paragraph
       article, or one the model cannot tell apart — and it is a division by a
       zero range. A `NaN` in `cx` paints nothing and reports nothing. */
    const flat = pts.map((p) => ({ ...p, x: 0.5, y: -0.25 }));
    const out = layout(root, bs, opts(), input(flat));
    expect(out.nodes.length).toBeGreaterThan(0);
    for (const n of out.nodes) {
      for (const v of [n.x, n.y, n.w, n.h, n.dot?.x ?? 0, n.dot?.y ?? 0, n.dot?.r ?? 0]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
    for (const l of out.links) expect(l.d).not.toContain("NaN");
  });

  it.each([
    ["drift", layoutDrift],
    ["trail", layoutTrail],
  ])("drops a point whose block this browser has never heard of — %s", (_name, layout) => {
    /* A re-ingest between the request and the answer. A dot drawn in a
       plausible place for a paragraph that no longer exists is worse than a dot
       missing, because nothing about it looks wrong. */
    const stale = [
      ...pts,
      { id: "spya-gonegone" as BlockId, x: 0.9, y: 0.9, c: 0 },
    ];
    const out = layout(root, bs, opts(), input(stale));
    expect(out.nodes).toHaveLength(pts.length);
    expect(out.nodes.some((n) => n.blockId === ("spya-gonegone" as BlockId))).toBe(false);
  });

  it.each([
    ["drift", layoutDrift],
    ["trail", layoutTrail],
  ])("says which section each paragraph is in — %s", (_name, layout) => {
    const out = layout(root, bs, opts(), input(pts));
    for (const n of out.nodes) {
      expect(n.number).not.toBe("");
      expect(n.title).not.toBe("");
      // The card's second line is the paragraph's own words — a block has no
      // gist, which is the whole reason this picture needs one.
      expect(n.gist ?? "").toContain("Paragraph");
      // Colour is never the only carrier: position and topic are in the label.
      expect(n.label ?? "").toMatch(/paragraph \d+ of \d+, topic \d+ of \d+/);
    }
  });

  it("answers for every row of the article, even the ones with no dot", () => {
    /* **The ranges tile although the dots do not.** Without this, standing in a
       paragraph too short to embed would make the you-are-here mark blink out
       for a screenful at a time — and only on some articles, and only in some
       places, which is the kind of bug that gets reported as "it feels flaky". */
    const out = layoutDrift(root, bs, opts(), input(pts));
    for (let row = 0; row < bs.length; row++) {
      expect(nodeAt(out.nodes, row), `no dot answers for row ${row}`).not.toBeNull();
    }
    /* **Tiling, not blanketing.** "Some node answers every row" would also pass
       if every dot claimed the whole article, which is a picture whose
       you-are-here mark never moves. GPT Sol's finding on the built code. So:
       the ranges are disjoint, in order, and each one contains its own dot. */
    let previous = -1;
    for (const n of out.nodes) {
      expect(n.startRow).toBe(previous + 1);
      expect(n.endRow).toBeGreaterThanOrEqual(n.startRow);
      // The dot's own row is inside the range it answers for.
      const row = bs.findIndex((b) => b.id === n.blockId);
      expect(row).toBeGreaterThanOrEqual(n.startRow);
      expect(row).toBeLessThanOrEqual(n.endRow);
      previous = n.endRow;
    }
    expect(previous).toBe(bs.length - 1);
    // And each dot still says it is one paragraph, because that is what it is.
    for (const n of out.nodes) expect(n.blocks).toBe(1);
  });
});

describe("drift", () => {
  const bs = blocks(60);
  const root = tree(bs);
  const pts = points(bs);

  it("puts the article down the page in reading order", () => {
    const out = layoutDrift(root, bs, opts(), input(pts));
    const ys = out.nodes.map((n) => n.dot?.y ?? 0);
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeGreaterThan(ys[i - 1]!);
  });

  it("has an article axis and a you-are-here line, and Trail does not", () => {
    /* The rule the whole panel keeps: the line is drawn only where the vertical
       axis really is the article. Trail's is not, so a line across it would be
       a confident statement about a position that does not exist. */
    const at = 30;
    const drift = layoutDrift(root, bs, opts({ atRow: at }), input(pts));
    expect(drift.axis).not.toBeNull();
    expect(drift.nowY).not.toBeNull();
    expect(drift.nowY!).toBeGreaterThan(0);
    expect(drift.nowY!).toBeLessThan(drift.height);

    const trail = layoutTrail(root, bs, opts({ atRow: at }), input(pts));
    expect(trail.axis).toBeNull();
    expect(trail.nowY).toBeNull();
  });

  it("keeps each lane in its own column", () => {
    /* A lane that overlapped its neighbour would read as one wider lane, and
       the picture's only claim — that these paragraphs group together — would
       be unreadable. */
    const k = 4;
    const out = layoutDrift(root, bs, opts(), input(pts, { axis: "lanes", k }));
    const byLane = new Map<number, number[]>();
    out.nodes.forEach((n, i) => {
      const lane = pts[i]?.c ?? 0;
      byLane.set(lane, [...(byLane.get(lane) ?? []), n.dot?.x ?? 0]);
    });
    const bounds = [...byLane.entries()]
      .map(([lane, xs]) => ({ lane, lo: Math.min(...xs), hi: Math.max(...xs) }))
      .sort((a, b) => a.lane - b.lane);
    for (let i = 1; i < bounds.length; i++) {
      expect(bounds[i]!.lo, `lane ${i} overlaps lane ${i - 1}`).toBeGreaterThan(bounds[i - 1]!.hi);
    }
  });

  it("spreads across the band when the reader asks for the sliding scale", () => {
    const out = layoutDrift(root, bs, opts(), input(pts, { axis: "spread" }));
    const xs = out.nodes.map((n) => n.dot?.x ?? 0);
    // It has to actually use the width — the first version of the Force picture
    // shipped a 47px ribbon down the middle of a 323px band.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(WIDTH * 0.5);
  });

  it("ignores one wild outlier rather than flattening everything else", () => {
    /* Measured on the real corpus: component 1 runs −0.649 to 0.331 while its
       middle half runs −0.128 to 0.199. Min-to-max scaling would spend two
       thirds of the band on the space between one dot and the rest. */
    const withOutlier = pts.map((p, i) => (i === 0 ? { ...p, x: -40 } : p));
    const out = layoutDrift(root, bs, opts(), input(withOutlier, { axis: "spread" }));
    const xs = out.nodes.slice(1).map((n) => n.dot?.x ?? 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(WIDTH * 0.5);
    // And the outlier is at the wall rather than off the edge.
    expect(out.nodes[0]?.dot?.x ?? -1).toBeGreaterThanOrEqual(0);
  });

  it("is not squashed to the viewport when the article is long", () => {
    const many = blocks(400);
    const out = layoutDrift(tree(many), many, opts(), input(points(many)));
    expect(out.height).toBeGreaterThan(HEIGHT);
  });
});

describe("trail", () => {
  const bs = blocks(60);
  const root = tree(bs);
  const pts = points(bs);

  it("uses ONE scale for both axes", () => {
    /* **The finding that made this test exist.** Scaling x and y independently
       to fill the box amplifies whichever component is smaller — so a second
       component holding 6% of the variation would be drawn taller than a first
       holding 15%, and every distance in the picture would be a different lie
       depending on its direction. GPT Sol, 2026-08-27.

       The check: take two pairs of points, one separated only in x and one only
       in y, and confirm the same data distance becomes the same pixel distance. */
    const probe: ProjectionPoint[] = [
      { id: bs[0]!.id, x: -0.1, y: 0, c: 0 },
      { id: bs[1]!.id, x: 0.1, y: 0, c: 0 },
      { id: bs[2]!.id, x: 0, y: -0.1, c: 0 },
      { id: bs[3]!.id, x: 0, y: 0.1, c: 0 },
    ];
    const out = layoutTrail(root, bs, opts(), input(probe));
    const [a, b, c, d] = out.nodes;
    const dx = Math.abs((b?.dot?.x ?? 0) - (a?.dot?.x ?? 0));
    const dy = Math.abs((d?.dot?.y ?? 0) - (c?.dot?.y ?? 0));
    expect(dx).toBeGreaterThan(0);
    expect(dy / dx).toBeGreaterThan(0.98);
    expect(dy / dx).toBeLessThan(1.02);
  });

  it("joins the dots in reading order and stops there", () => {
    const out = layoutTrail(root, bs, opts(), input(pts));
    // At most one segment per consecutive pair; fewer when two dots overlap,
    // which is a real case and draws nothing rather than a backwards arrow.
    expect(out.links.length).toBeLessThanOrEqual(out.nodes.length - 1);
    expect(out.links.length).toBeGreaterThan(out.nodes.length / 2);
    for (const l of out.links) expect(l.kind).toBe("sequence");

    /* **And each segment really runs between two consecutive dots.** Counting
       links and checking their `kind` would pass for a chain joining every dot
       to the first one, which is a picture of nothing. GPT Sol's finding on the
       built code. Each segment is trimmed back from both centres, so what is
       checked is that each end sits within its dot's radius plus the head gap
       of the dot it belongs to. */
    const at = new Map(out.nodes.map((n, i) => [i, n.dot!]));
    for (const l of out.links) {
      const i = Number(/^trail(\d+)-/.exec(l.id)?.[1]);
      const a = at.get(i);
      const b = at.get(i + 1);
      expect(a, `link ${l.id} names no dot`).toBeDefined();
      expect(b).toBeDefined();
      if (!a || !b) continue;
      const m = /M ([-\d.]+) ([-\d.]+) L ([-\d.]+) ([-\d.]+)/.exec(l.d);
      expect(m).not.toBeNull();
      if (!m) continue;
      expect(Math.hypot(Number(m[1]) - a.x, Number(m[2]) - a.y)).toBeLessThanOrEqual(a.r + 1.5);
      expect(Math.hypot(Number(m[3]) - b.x, Number(m[4]) - b.y)).toBeLessThanOrEqual(b.r + 6);
    }
  });

  it("puts arrowheads only where the reader is, and none at all when nobody is reading", () => {
    /* **Direction along a path you cannot trace is not information.** Thirty
       heads scattered through 263 crossing segments are clutter — two design
       reviews and a browser pass reached that independently, 2026-08-27. Inside
       the bright local run the path really is traceable, so a head there says
       something.

       The no-reader case is the one that pins the rule: before `?at=` exists
       there is no run, so there must be no heads. */
    expect(layoutTrail(root, bs, opts(), input(pts)).links.some((l) => l.arrow)).toBe(false);

    const at = 30;
    const out = layoutTrail(root, bs, opts({ atRow: at }), input(pts));
    const arrows = out.links.filter((l) => l.arrow);
    expect(arrows.length).toBeGreaterThan(0);

    /* **Checked against the rule, not against a ratio.** This used to assert
       "fewer than an eighth of the links", which is not the rule and was only
       true of this fixture — and it was true of it because of the off-by-one
       below, so the bound was quietly measuring a bug. GPT Sol, 2026-08-30.

       The rule is: a head goes on a segment whose *nearer* end is inside half
       the reach, where the reach is `chainReach` over the segments actually
       drawn. Both halves of that had defects — the distance was measured to the
       segment's start rather than to its nearer end, and the reach was taken
       over the candidate segments rather than the drawn ones. */
    const index = (id: string) => Number(/^trail(\d+)-/.exec(id)?.[1]);
    const hereDot = out.nodes.findIndex((n) => n.id === nodeAt(out.nodes, at));
    expect(hereDot).toBeGreaterThanOrEqual(0); // precondition
    const reach = chainReach(out.links.length);
    for (const l of arrows) {
      const i = index(l.id);
      const near = Math.min(Math.abs(i - hereDot), Math.abs(i + 1 - hereDot));
      expect(near * 2, `a head on a segment ${near} hops out, reach ${reach}`).toBeLessThan(reach);
    }

    // Both sides get heads. The *shape* of the window is the next test — this
    // one would pass on a window shifted a segment down the article.
    const sides = arrows.map((l) => index(l.id));
    expect(sides.some((i) => i < hereDot), "no head behind the reader").toBe(true);
    expect(sides.some((i) => i >= hereDot), "no head ahead of the reader").toBe(true);
  });

  /**
   * **The run surrounds the reader rather than starting at them.**
   *
   * A segment `i` joins dot `i` to dot `i + 1`, so measuring `|i - here|` calls
   * the link *arriving* at the reader's dot one step further out than the link
   * *leaving* it. The window comes out shifted one segment down the article:
   * it draws perfectly well, it has heads on both sides, and it is wrong.
   * GPT Sol's finding, 2026-08-30.
   *
   * The property that catches it is not "heads on both sides" but "the dots the
   * run touches are centred on the reader's dot" — so the two ends of the run
   * have to be equidistant. Spread points, so that no segment is dropped for
   * want of room and the window is the rule rather than the geometry: the
   * shared fixture's dots are close enough together that trimming could hide
   * the asymmetry behind a missing head.
   *
   * Probed on 2026-08-30 with `Math.abs(i - here)`: the run then reaches 3 dots
   * back and 4 forward, and this reddens.
   */
  it("centres the arrowhead run on the reader's dot", () => {
    const wide = pts.map((p, i) => ({ ...p, x: i % 2 === 0 ? -1 : 1, y: i / pts.length }));
    const at = 30;
    const out = layoutTrail(root, bs, opts({ atRow: at }), input(wide));
    const index = (id: string) => Number(/^trail(\d+)-/.exec(id)?.[1]);
    const hereDot = out.nodes.findIndex((n) => n.id === nodeAt(out.nodes, at));
    expect(hereDot).toBeGreaterThan(4); // precondition: room for a run behind it

    const arrows = out.links.filter((l) => l.arrow).map((l) => index(l.id));
    expect(arrows.length).toBeGreaterThan(2);
    // Nothing was dropped for room, so the window really is the rule.
    expect(out.links.length).toBe(out.nodes.length - 1);

    // Each segment touches dots i and i + 1; the span of those has to sit
    // symmetrically around the reader.
    const dots = arrows.flatMap((i) => [i, i + 1]);
    const back = hereDot - Math.min(...dots);
    const forward = Math.max(...dots) - hereDot;
    expect(back, `run reaches ${back} back and ${forward} forward`).toBe(forward);
  });

  /**
   * **The heads and the ramp size themselves off the same chain.**
   *
   * The arrowhead run is geometry and lives in this file; the brightness ramp is
   * `chainNearness` and lives in the panel. Both call `chainReach`, but this
   * file used to hand it the *candidate* segments and the panel hands it the
   * ones actually drawn — so on a picture with a coincident pair the two
   * disagree, and a head lands on a segment the ramp has already let go. Sol's
   * arithmetic: 27 candidates against 26 drawn is `chainReach` 5 against 4.
   *
   * This fixture makes exactly that state — one coincident pair inside a chain
   * long enough for the two counts to straddle a `chainReach` boundary.
   */
  it("sizes the arrowhead run off the segments it drew, not the ones it considered", () => {
    const n = 28;
    const short = blocks(n * 2);
    const spread: ProjectionPoint[] = Array.from({ length: n }, (_, i) => ({
      id: short[i * 2]!.id,
      x: i % 2 === 0 ? -1 : 1,
      y: i / n,
      c: i % 4,
    }));
    // Two dots on top of one another, so one segment is dropped.
    spread[3] = { ...spread[3]!, x: spread[2]!.x, y: spread[2]!.y };
    const out = layoutTrail(tree(short), short, opts({ atRow: 30 }), input(spread));

    /* The two preconditions, asserted rather than assumed — a fixture that
       dropped nothing, or whose two counts landed on the same reach, would make
       every assertion below pass for the wrong reason. Coinciding one pair also
       shortens its neighbour, so the drop is read off rather than predicted. */
    const candidates = n - 1;
    expect(out.links.length).toBeLessThan(candidates);
    expect(chainReach(candidates)).not.toBe(chainReach(out.links.length));

    const index = (id: string) => Number(/^trail(\d+)-/.exec(id)?.[1]);
    const hereDot = out.nodes.findIndex((n2) => n2.id === nodeAt(out.nodes, 30));
    const reach = chainReach(out.links.length);
    for (const l of out.links.filter((x) => x.arrow)) {
      const i = index(l.id);
      const near = Math.min(Math.abs(i - hereDot), Math.abs(i + 1 - hereDot));
      expect(near * 2, `head ${near} hops out, drawn-chain reach ${reach}`).toBeLessThan(reach);
    }
  });

  it("never draws an arrow it has no room for", () => {
    /* The bug `arrowPath` in diagram-d3.ts was reviewed into fixing: two marks
       closer together than their two trims produce a line pointing *backwards*.
       Here the answer is different — the chain keeps its line and loses the
       arrow, because a chain with holes in it is not a chain — so what has to
       hold is that no segment carrying an arrow is shorter than the arrowhead. */
    const tight = pts.map((p, i) => ({ ...p, x: 0.0001 * i, y: 0 }));
    const out = layoutTrail(root, bs, opts(), input(tight));
    for (const l of out.links) {
      const m = /M ([-\d.]+) ([-\d.]+) L ([-\d.]+) ([-\d.]+)/.exec(l.d);
      expect(m).not.toBeNull();
      if (!m || !l.arrow) continue;
      const len = Math.hypot(Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2]));
      expect(len, `an arrow on a ${len}px segment`).toBeGreaterThan(2);
    }
  });

  it("fades the chain from beginning to end, and says nothing about the reader", () => {
    /* `depth` used to carry two things: how far through the article a segment
       is, and whether it was one of the seventeen around the reader. The second
       left on 2026-08-30 (`chainStep`), and this is the test that it really did
       — the same layout at two reading positions has to produce the *same*
       depths, or the panel's ramp is fighting a second one underneath it. */
    const early = layoutTrail(root, bs, opts({ atRow: 3 }), input(pts));
    const late = layoutTrail(root, bs, opts({ atRow: 200 }), input(pts));
    const nobody = layoutTrail(root, bs, opts({ atRow: null }), input(pts));
    expect(early.links.map((l) => l.depth)).toEqual(nobody.links.map((l) => l.depth));
    expect(late.links.map((l) => l.depth)).toEqual(nobody.links.map((l) => l.depth));

    // And it is still a ramp: 0 at the top of the article, 6 at the bottom.
    const depths = nobody.links.map((l) => l.depth);
    expect(Math.min(...depths)).toBe(0);
    expect(Math.max(...depths)).toBe(6);
    for (let i = 1; i < depths.length; i++) {
      expect(depths[i]!).toBeGreaterThanOrEqual(depths[i - 1]!);
    }
  });

  it("grades the chain outward from the dot the reader is standing on", () => {
    /* The mitigation that does the real work: a run of segments around the
       reader is a route they can follow, where a fade over 359 segments is only
       styling. Greg asked for it graded rather than flat, 2026-08-30 — so what
       has to hold is that the two segments touching the reader's dot are at
       step 0, and that the step never *falls* as you walk away from them.

       Probed on 2026-08-30: a `chainNearness` that returns 0 for everything in
       the run — the plateau this replaced — reddens this. The *scaling* of the
       hop count is not tested here and cannot be: this fixture's chain is long
       enough that the reach is the full eight, where scaled and raw are the
       same number. tests/diagram.test.ts has the short chain that separates
       them. */
    const at = 30;
    const out = layoutTrail(root, bs, opts({ atRow: at }), input(pts));
    const near = chainNearness(out.links, nodeAt(out.nodes, at));
    expect(near.size).toBeGreaterThan(0);

    const index = (id: string) => Number(/^trail(\d+)-/.exec(id)?.[1]);
    const zeros = [...near].filter(([, lvl]) => lvl === 0).map(([id]) => index(id));
    // Either side of one dot: two segments, or one at the ends of the article.
    expect(zeros.length).toBeGreaterThanOrEqual(1);
    expect(zeros.length).toBeLessThanOrEqual(2);
    expect(Math.max(...zeros) - Math.min(...zeros)).toBeLessThanOrEqual(1);

    // Monotonic outward, in both directions, and it does use more than one step.
    const centre = (Math.min(...zeros) + Math.max(...zeros)) / 2;
    const byDistance = [...near]
      .map(([id, lvl]) => ({ d: Math.abs(index(id) - centre), lvl }))
      .sort((a, b) => a.d - b.d);
    for (let i = 1; i < byDistance.length; i++) {
      expect(byDistance[i]!.lvl).toBeGreaterThanOrEqual(byDistance[i - 1]!.lvl);
    }
    expect(new Set([...near.values()]).size).toBeGreaterThan(3);

    // With no reader anywhere, no segment is on the ramp at all — the chain is
    // then only the global fade, which is what the stylesheet expects.
    expect(chainNearness(out.links, null).size).toBe(0);
  });
});

describe("laneTerms", () => {
  it("names each topic with words that are distinctive of it", () => {
    /* A lane a reader cannot name is a lane they have to take on trust. The
       fixture's paragraphs cycle through three subjects, so each lane must come
       back with its own. */
    const bs = blocks(60);
    const pts = points(bs, 3).map((p, i) => ({ ...p, c: i % 3 }));
    const named = laneTerms(pts, bs, 3);
    expect(named).toHaveLength(3);
    for (const words of named) expect(words.length).toBeGreaterThan(0);
    // Every lane's first word must differ — the whole point of an idf weighting
    // is that the words the lanes share fall out.
    expect(new Set(named.map((w) => w[0])).size).toBe(3);
    /* **And they must be the RIGHT words.** "Three different first words" would
       pass for three lanes labelled with three different pieces of filler. The
       fixture's paragraphs cycle through three named subjects, so the three
       lanes between them must account for all three. GPT Sol's finding on the
       built code. */
    expect(new Set(named.map((w) => w[0]))).toEqual(new Set(["honesty", "agency", "welfare"]));
  });

  it("returns an empty list for a lane with nothing in it, rather than throwing", () => {
    const bs = blocks(10);
    expect(laneTerms([], bs, 3)).toEqual([[], [], []]);
  });
});

/* ------------------------------------------------------- the apparatus -- */

/**
 * **A reader standing in the notes is not standing on the last paragraph of the
 * argument.**
 *
 * Drift and Trail plot embedded body paragraphs, and correctly receive no point
 * for a note. But the dot ranges are made to *tile* — the last dot answers for
 * everything below it — so "everything below" swallowed the whole apparatus and
 * the you-are-here mark sat on the final argument paragraph while the reader was
 * three endnotes deep. Trail brightened that paragraph's chain position too.
 *
 * The tiling exists for a body paragraph too short to embed, so that the mark
 * does not blink out for a screen at a time. The apparatus is a different case:
 * it is not in this picture at all, and the honest answer for a reader inside it
 * is no dot rather than the wrong one. GPT Sol, third review, 2026-08-29.
 */
describe("a reader inside the apparatus", () => {
  const body = blocks(8);
  const notes: Block[] = Array.from({ length: 4 }, (_, i) => ({
    id: `spya-n${String(i).padStart(4, "0")}` as BlockId,
    tag: "p",
    kind: "text" as const,
    text: `Note ${i}, which nobody reads front to back.`,
    words: 9,
    html: "<p></p>",
    gistable: true,
    role: "footnote" as const,
    treatment: "supplement" as const,
    noteId: "spya-note-aaaaaaaaaa",
  }));
  const all = [...body, ...notes];
  const firstNoteRow = body.length;

  /* The precondition. Without it the fixture could have no apparatus at all and
     every assertion below would pass for the wrong reason. */
  it("has an apparatus in the fixture, and no point for it", () => {
    expect(all.filter((b) => b.treatment === "supplement").length).toBe(4);
    const pts = points(body);
    expect(pts.every((pt) => body.some((b) => b.id === pt.id))).toBe(true);
  });

  /* **What the reader actually sees is Trail's chain going bright around them.**
     `here` is the dot index the reader is standing on. With the apparatus
     swallowed by the last dot's range, standing in the notes lit the end of the
     *argument*: the brightest thing in the picture was a paragraph the reader
     had already left.

     **The probe moved from `depth === 8` to the arrowheads**, because that is
     where `here` surfaces in this layout now. Brightness around the reader is
     `chainNearness` in diagram.ts and it is computed from the node the panel
     says the reader is in, not from the row — so it cannot see this bug and a
     test written against it would be green either way. The heads are still
     decided here, from `here`, and they are still drawn only on the reader's
     own run. Probed on 2026-08-30: putting the tiling back reddens both of the
     tests below. */
  const brightest = (links: readonly { arrow?: boolean | undefined }[]) =>
    links.filter((l) => l.arrow).length;

  it("trail: does not light the end of the argument for a reader in the notes", () => {
    const out = layoutTrail(tree(body), all, opts({ atRow: firstNoteRow + 2 }), input(points(body)));
    expect(out.links.length).toBeGreaterThan(0);
    expect(brightest(out.links)).toBe(0);
  });

  /* The control, and it is what stops the fix from being "never light
     anything": a reader inside the argument still lights the chain around them.
     Both directions, because a guard that goes quiet when defeated is the
     failure this repo keeps meeting. */
  it("trail: still lights the chain for a reader inside the argument", () => {
    const out = layoutTrail(tree(body), all, opts({ atRow: 3 }), input(points(body)));
    expect(brightest(out.links)).toBeGreaterThan(0);
  });

  /* **The denominator, which three separate things read as "how long is this
     article".** Drift's vertical axis, the progress hue and the spoken label
     all divided by `blocks.length` — so a third of Drift was blank, the last
     paragraph of the argument never reached the final progress step, and the
     label said "paragraph 2 of 12" about the last body paragraph of eight. */
  it("drift: measures the article by its argument, not by its endnotes", () => {
    const out = layoutDrift(tree(body), all, opts(), input(points(body)));
    // "paragraph N of M" — M is the body's length, not the whole array's.
    const labels = out.nodes.map((n) => n.label ?? "");
    expect(labels.some((l) => l.includes(`of ${body.length}`))).toBe(true);
    expect(labels.some((l) => l.includes(`of ${all.length}`))).toBe(false);
  });

  it("drift: draws no you-are-here line for a reader in the notes", () => {
    const inNotes = layoutDrift(tree(body), all, opts({ atRow: firstNoteRow + 2 }), input(points(body)));
    expect(inNotes.nowY).toBeNull();
    // The control: a reader in the argument still gets their line.
    const inBody = layoutDrift(tree(body), all, opts({ atRow: 3 }), input(points(body)));
    expect(inBody.nowY).not.toBeNull();
  });

  /* **The spoken count is a count, not a coordinate**, and with a stranded note
     the two part company: `bodyRows` has to stay monotonic in row number so the
     axis works, but the label a screen reader reads must not skip a number. It
     said "paragraph 1 of 3" and "paragraph 3 of 3" about an article with two
     paragraphs in it. GPT Sol, fifth review. */
  it("drift: numbers the paragraphs of the argument consecutively, around a stranded note", () => {
    const stranded = [...body.slice(0, 4), notes[0]!, ...body.slice(4)];
    const strandedBody = stranded.filter((b) => b.treatment !== "supplement");
    expect(stranded[4]!.treatment).toBe("supplement"); // precondition
    const out = layoutDrift(
      tree(strandedBody), stranded, opts(), input(points(strandedBody)),
    );
    const spoken = out.nodes
      .map((n) => /paragraph (\d+) of (\d+)/.exec(n.label ?? ""))
      .filter((m): m is RegExpExecArray => m !== null);
    expect(spoken.length).toBeGreaterThan(0);
    // Every label counts out of the body's length, and none exceeds it.
    for (const m of spoken) {
      expect(Number(m[2])).toBe(strandedBody.length);
      expect(Number(m[1])).toBeLessThanOrEqual(strandedBody.length);
      expect(Number(m[1])).toBeGreaterThanOrEqual(1);
    }
  });

  /* **A point the server should never have sent, which the browser must still
     refuse.** `dots()` drops a point whose block id it does not recognise, but
     it used to accept any id that *did* resolve — including one that is now
     apparatus. The article and the projection are two separate reads of the
     current revision, so a re-ingest in the gap hands the browser a recognised
     id whose classification has changed, and the page then said the reader was
     not in the argument (`nowY: null`) while drawing a note as one of the
     argument's paragraphs. With a trailing note it could say "paragraph 3 of
     2". GPT Sol, sixth review. The existing tests could not see it because
     every one of them builds its points from the body alone. */
  it("drift: refuses a point that resolves to a note, rather than drawing it as a paragraph", () => {
    const out = layoutDrift(tree(body), all, opts(), input(points(all)));
    const drawn = out.nodes.map((n) => n.label ?? "").filter((l) => l.length > 0);
    // Not one dot is a note.
    for (const note of notes) expect(drawn.some((l) => l.includes(note.text))).toBe(false);
    // And the body is still drawn, so this is a filter and not an off switch.
    expect(drawn.some((l) => l.includes(body[0]!.text))).toBe(true);
  });

  /* **This one goes red only when both halves are gone**, and that is not a
     flaw in it. Probed on 2026-08-29: removing the `isBody` guard alone reddens
     the two tests above and leaves this green (a note dot then gets no ordinal,
     so it makes no claim); restoring the `?? d.row + 1` fallback alone reddens
     *nothing*, because the guard means nothing can reach it. So the fallback's
     removal has no test of its own and cannot have one — it is there so that a
     later change to the guard cannot quietly bring the lie back, and this test
     is the tripwire for that pair. Counting it as evidence for either clause on
     its own would be wrong. */
  it("drift: never speaks a paragraph number above the count it says it is out of", () => {
    const out = layoutDrift(tree(body), all, opts(), input(points(all)));
    const spoken = out.nodes
      .map((n) => /paragraph (\d+) of (\d+)/.exec(n.label ?? ""))
      .filter((m): m is RegExpExecArray => m !== null);
    expect(spoken.length).toBeGreaterThan(0);
    for (const m of spoken) expect(Number(m[1])).toBeLessThanOrEqual(Number(m[2]));
  });

  it("trail: refuses a point that resolves to a note", () => {
    const out = layoutTrail(tree(body), all, opts(), input(points(all)));
    const drawn = out.nodes.map((n) => n.label ?? "");
    for (const note of notes) expect(drawn.some((l) => l.includes(note.text))).toBe(false);
  });

  /* **A note stranded mid-article**, which `splitBlocks` deliberately refuses
     to build a supplement node for (src/supplement.ts) — so the apparatus is a
     *hole* in the body rather than a tail, and no "up to the last body row"
     rule can describe it. Asking the block itself is what works. */
  it("trail: does not light the chain for a reader on a note in mid-article", () => {
    const stranded = [...body.slice(0, 4), notes[0]!, ...body.slice(4)];
    const strandedBody = stranded.filter((b) => b.treatment !== "supplement");
    const out = layoutTrail(
      tree(strandedBody),
      stranded,
      opts({ atRow: 4 }), // the note, sitting between body paragraphs
      input(points(strandedBody)),
    );
    expect(stranded[4]!.treatment).toBe("supplement"); // precondition
    expect(brightest(out.links)).toBe(0);
  });
});
