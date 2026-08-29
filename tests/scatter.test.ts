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
import { nodeAt, type DiagramOptions } from "../src/web/diagram.js";
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

    const out = layoutTrail(root, bs, opts({ atRow: 30 }), input(pts));
    const arrows = out.links.filter((l) => l.arrow);
    expect(arrows.length).toBeGreaterThan(0);
    expect(arrows.length).toBeLessThan(out.links.length / 8);
    // And every one of them is on a segment of the bright run.
    for (const a of arrows) expect(a.depth).toBe(8);
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

  it("draws the chain brightest where the reader is standing", () => {
    /* The mitigation that does the real work: a bright run of segments around
       the reader is a route they can follow, where a fade over 359 segments is
       only styling. Everything else must be dimmer, or the reader's own stretch
       is not findable. */
    const at = 30;
    const out = layoutTrail(root, bs, opts({ atRow: at }), input(pts));
    const top = out.links.filter((l) => l.depth === 8);
    expect(top.length).toBeGreaterThan(0);
    expect(top.length).toBeLessThan(out.links.length / 2);
    for (const l of out.links) {
      expect(l.depth).toBeGreaterThanOrEqual(0);
      expect(l.depth).toBeLessThanOrEqual(8);
    }
    // With no reader anywhere, nothing gets the top step — the fade is then
    // only the global one, which is what the stylesheet's opacity rules expect.
    const nobody = layoutTrail(root, bs, opts({ atRow: null }), input(pts));
    expect(nobody.links.some((l) => l.depth === 8)).toBe(false);
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
     `here` is the dot index the reader is standing on, and it only surfaces as
     link brightness — `chainStep` lights the segments either side of it at the
     top step. With the apparatus swallowed by the last dot's range, standing in
     the notes lit the end of the *argument*: the brightest thing in the picture
     was a paragraph the reader had already left. */
  const brightest = (links: readonly { depth?: number | undefined }[]) =>
    links.filter((l) => l.depth === 8).length;

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
