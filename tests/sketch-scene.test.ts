/**
 * The Sketch scene's reader and its score — src/sketch-scene.ts.
 *
 * This file is the *only* thing standing between a model's arithmetic and the
 * page. Every other diagram in this app computes its own geometry from the
 * tree, so a wrong number there is a bug somebody wrote; here the numbers come
 * from a model, and the failure mode is not a crash. A box 400 units off the
 * canvas, an edge to a node that is not in the scene, a `block` id that names
 * no paragraph — SVG renders all of them without complaining, and every one
 * looks like a design choice (docs/reusable/silent-success.md, and
 * docs/project/diagram.md § Two things that are wrong in a way you cannot see).
 *
 * So the rule under test throughout is: **an item survives intact or it is
 * dropped and counted.** Nothing is repaired into something plausible, because
 * a validator that patched things would report a clean run on a model that
 * cannot follow the schema — and `report.faults` is the only signal there is
 * that a prompt has drifted.
 */
import { describe, expect, it } from "vitest";
import {
  accept,
  CANVAS_W,
  charsThatFit,
  cleanPath,
  linesInBox,
  linesNeeded,
  nodeFits,
  readSketch,
  scoreSketch,
  type SketchNode,
  wrap,
} from "../src/sketch-scene.js";

/** Ten blocks, in document order — `blockOrder` is the article's own index. */
const BLOCKS = [
  "spya-aaaaaa",
  "spya-bbbbbb",
  "spya-cccccc",
  "spya-dddddd",
  "spya-eeeeee",
  "spya-ffffff",
  "spya-gggggg",
  "spya-hhhhhh",
  "spya-jjjjjj",
  "spya-kkkkkk",
];

const opts = { blockOrder: BLOCKS };

function node(over: Record<string, unknown>): Record<string, unknown> {
  return { kind: "node", id: "n", x: 10, y: 10, w: 120, h: 40, text: "hello", ...over };
}

function scene(items: unknown[], over: Record<string, unknown> = {}) {
  return { title: "t", caption: "c", scenes: [{ id: "overview", title: "s", height: 600, items, ...over }] };
}

const read = (items: unknown[], over?: Record<string, unknown>) => readSketch(scene(items, over), opts);

describe("readSketch — what survives, and what is counted", () => {
  it("keeps a well-formed node whole", () => {
    const { sketch, report } = read([node({ block: BLOCKS[3], shape: "pill", size: "md" })]);
    expect(report.faults).toEqual([]);
    const n = sketch.scenes[0]?.items[0] as SketchNode;
    expect(n.block).toBe(BLOCKS[3]);
    expect(n.shape).toBe("pill");
    expect(n.size).toBe("md");
  });

  it("falls back rather than dropping when an enum is unrecognised", () => {
    // A value from a future version of the schema, or a hallucinated one. The
    // rule params.ts applies to every URL parameter: degrade to something real.
    const { sketch } = read([node({ shape: "trapezoid", size: "enormous" })]);
    const n = sketch.scenes[0]?.items[0] as SketchNode;
    expect(n.shape).toBe("box");
    expect(n.size).toBe("sm");
  });

  it("clamps a node that runs off the canvas, and says so", () => {
    // Clamped, not dropped: a box 20 units past the edge is a rounding error,
    // and a picture with that box deleted has a hole in it — which is the thing
    // a reader notices.
    const { sketch, report } = read([node({ x: CANVAS_W - 20, w: 300, y: 590, h: 200 })]);
    const n = sketch.scenes[0]?.items[0] as SketchNode;
    expect(n.x + n.w).toBeLessThanOrEqual(CANVAS_W);
    expect(n.y + n.h).toBeLessThanOrEqual(600);
    expect(report.faults.map((f) => f.what).join(" ")).toContain("off canvas");
  });

  it("takes the click off a node whose block the article has not got, and keeps the node", () => {
    // Two states that look identical on screen — "the model invented an id" and
    // "the model chose not to link this one" — so only the count tells them
    // apart. A node dropped for a bad id would be a hole in the picture caused
    // by a broken link.
    const { sketch, report } = read([node({ block: "spya-zzzzzz" })]);
    const n = sketch.scenes[0]?.items[0] as SketchNode;
    expect(n).toBeTruthy();
    expect(n.block).toBeUndefined();
    expect(report.faults).toHaveLength(1);
    expect(report.faults[0]?.what).toContain("spya-zzzzzz");
  });

  it("takes the click off a block id that is not a spideryarn id at all", () => {
    const { sketch } = read([node({ block: "#section-3" })]);
    expect((sketch.scenes[0]?.items[0] as SketchNode).block).toBeUndefined();
  });

  it("drops an edge naming a node this scene has not got", () => {
    // The renderer would have to invent one end of it, and an invented end is a
    // confident line to somewhere nobody meant.
    const { sketch, report } = read([
      node({ id: "a" }),
      node({ id: "b", y: 300 }),
      { kind: "edge", from: "a", to: "ghost" },
      { kind: "edge", from: "a", to: "b" },
    ]);
    const edges = sketch.scenes[0]?.items.filter((i) => i.kind === "edge") ?? [];
    expect(edges).toHaveLength(1);
    expect(report.faults.map((f) => f.what).join(" ")).toContain("ghost");
  });

  it("drops an edge from a node to itself", () => {
    // It is routed through its own node and comes out as a stub mostly hidden
    // under it, and nothing in an argument map means "depends on itself".
    const { sketch, report } = read([node({ id: "a" }), { kind: "edge", from: "a:left", to: "a:right" }]);
    expect(sketch.scenes[0]?.items.filter((i) => i.kind === "edge")).toHaveLength(0);
    expect(report.faults.map((f) => f.what).join(" ")).toContain("to itself");
  });

  it("drops the second of two nodes sharing an id, and every edge is then unambiguous", () => {
    // Not a duplicate node — an ambiguous edge. Every edge names its ends by
    // id, so a repeated id makes one of the two unreachable and quietly sends
    // its lines to the other.
    const { sketch, report } = read([
      node({ id: "a", text: "first" }),
      node({ id: "a", text: "second", y: 300 }),
    ]);
    const nodes = (sketch.scenes[0]?.items ?? []).filter((i): i is SketchNode => i.kind === "node");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.text).toBe("first");
    expect(report.faults.map((f) => f.what).join(" ")).toContain("both called");
  });

  it("drops a node with no text at all", () => {
    const { sketch, report } = read([node({ id: "a", text: "  " })]);
    expect(sketch.scenes[0]?.items).toHaveLength(0);
    expect(report.faults.map((f) => f.what).join(" ")).toContain("no text");
  });

  it("drops a shape that is not near the canvas, rather than clamping it there", () => {
    // Clamping a box at x = -1,000,000 produces a confident rectangle in the
    // corner standing for something the model put somewhere else entirely.
    const { sketch, report } = read([node({ id: "a", x: -1_000_000 })]);
    expect(sketch.scenes[0]?.items).toHaveLength(0);
    expect(report.faults.map((f) => f.what).join(" ")).toContain("not on this canvas");
  });

  it("keeps a region inside the canvas by its far edge, not by each number alone", () => {
    // x and w are each legal on a 760-wide canvas and their sum is not.
    const { sketch } = read([{ kind: "region", x: 750, y: 10, w: 100, h: 50, style: "band" }]);
    const r = sketch.scenes[0]?.items[0] as { x: number; w: number };
    expect(r.x + r.w).toBeLessThanOrEqual(CANVAS_W);
  });

  it("counts an unrecognised enum rather than defaulting in silence", () => {
    // A model that has started writing "trapezoid" on half its nodes otherwise
    // produces a picture of plain boxes and a fault list of length zero.
    const { report } = read([node({ shape: "trapezoid" })]);
    expect(report.faults.map((f) => f.what).join(" ")).toContain("trapezoid");
  });

  it("honours a side suffix when matching an edge's ends", () => {
    // `a:bottom` names node `a`. Matching on the whole string would drop every
    // edge the prompt's own example shows.
    const { sketch } = read([
      node({ id: "a", y: 10 }),
      node({ id: "b", y: 300 }),
      { kind: "edge", from: "a:bottom", to: "b:top" },
    ]);
    expect(sketch.scenes[0]?.items.filter((i) => i.kind === "edge")).toHaveLength(1);
  });

  it("removes an `opens` that names no scene, and keeps one that does", () => {
    const { sketch, report } = readSketch(
      {
        title: "t",
        caption: "c",
        scenes: [
          { id: "overview", title: "s", height: 400, items: [node({ id: "a", opens: "detail" }), node({ id: "b", opens: "nowhere" })] },
          { id: "detail", title: "d", height: 400, items: [] },
        ],
      },
      opts,
    );
    const [a, b] = (sketch.scenes[0]?.items ?? []) as SketchNode[];
    expect(a?.opens).toBe("detail");
    expect(b?.opens).toBeUndefined();
    expect(report.faults.map((f) => f.what).join(" ")).toContain("nowhere");
  });

  it("resolves an `opens` that points forwards to a scene declared later", () => {
    // Resolved after every scene has been read, not during — the overview is
    // scene 0 and everything it opens is by definition below it in the list.
    const { sketch, report } = readSketch(
      {
        title: "t",
        caption: "c",
        scenes: [
          { id: "overview", title: "s", height: 400, items: [node({ opens: "last" })] },
          { id: "mid", title: "m", height: 400, items: [] },
          { id: "last", title: "l", height: 400, items: [] },
        ],
      },
      opts,
    );
    expect((sketch.scenes[0]?.items[0] as SketchNode).opens).toBe("last");
    expect(report.faults).toEqual([]);
  });

  it("refuses a node that has no id or no coordinates", () => {
    const { sketch, report } = read([
      { kind: "node", x: 1, y: 1, w: 10, h: 10, text: "no id" },
      node({ id: "b", x: "left" }),
    ]);
    expect(sketch.scenes[0]?.items).toHaveLength(0);
    expect(report.faults).toHaveLength(2);
  });

  it("counts what the model wrote as well as what survived", () => {
    // `written` is the denominator a prompt is judged against. Without it a run
    // where nine items in ten were dropped and one where nothing was reads the
    // same: "1 item".
    const { report } = read([node({ id: "a" }), { kind: "elephant" }, { kind: "label" }]);
    expect(report.written).toBe(3);
    expect(report.kept).toBe(1);
  });

  it("survives a root that is not a scene list at all", () => {
    const { sketch, report } = readSketch("nope", opts);
    expect(sketch.scenes).toEqual([]);
    expect(report.faults).toHaveLength(1);
  });
});

describe("cleanPath — the one string that reaches the renderer nearly as written", () => {
  it("accepts absolute M/L/C/Q/A/Z and numbers", () => {
    expect(cleanPath("M40 100 L360 100 C400 120 420 160 260 300 Z")).toBeTruthy();
    expect(cleanPath("M0 0 A50 50 0 0 1 100 100")).toBeTruthy();
  });

  it("refuses relative commands", () => {
    // They compound: one bad number moves everything after it off the canvas,
    // and there is no way to clamp the result without re-deriving the path.
    expect(cleanPath("M40 100 l20 20")).toBeNull();
    expect(cleanPath("M40 100 c1 2 3 4 5 6")).toBeNull();
  });

  it("refuses anything that is not a path", () => {
    expect(cleanPath('M0 0" onload="alert(1)')).toBeNull();
    expect(cleanPath("url(#x)")).toBeNull();
    expect(cleanPath("<script>")).toBeNull();
    expect(cleanPath("")).toBeNull();
  });

  it("refuses a path that does not begin with a move", () => {
    // A `d` starting with L has no defined current point; browsers vary.
    expect(cleanPath("L10 10 L20 20")).toBeNull();
  });

  it("refuses a path long enough to be a denial of service on its own", () => {
    expect(cleanPath(`M0 0${" L1 1".repeat(2000)}`)).toBeNull();
  });
});

describe("scoreSketch — the measures a prompt is iterated against", () => {
  const at = (i: number, y: number) => node({ id: `n${i}`, y, block: BLOCKS[i] });

  it("scores a picture that runs down the page with the article at 1", () => {
    const { sketch, report } = read([at(0, 20), at(3, 200), at(6, 400), at(9, 560)]);
    expect(scoreSketch(sketch, report, opts).flow).toBeCloseTo(1, 5);
  });

  it("scores an upside-down picture at −1", () => {
    // The failure this measure exists for: every other number is identical to
    // the case above, and the picture is unusable.
    const { sketch, report } = read([at(0, 560), at(3, 400), at(6, 200), at(9, 20)]);
    expect(scoreSketch(sketch, report, opts).flow).toBeCloseTo(-1, 5);
  });

  it("declines to score a flow it has fewer than three points for", () => {
    // Two nodes are always either in order or reversed; a tau of ±1 from two
    // points would be a confident number about nothing.
    const { sketch, report } = read([at(0, 20), at(9, 400)]);
    expect(scoreSketch(sketch, report, opts).flow).toBeNull();
  });

  it("measures the WIDEST unreached run, not the average one", () => {
    // Three marks, deliberately unevenly spread, because with one gap "widest"
    // and "average" are the same number and the test would pass either way.
    //
    // Blocks 0, 1 and 9 are linked. The unreached runs are therefore: nothing
    // before 0, nothing between 0 and 1, blocks 2–8 between 1 and 9 (SEVEN
    // blocks), and nothing after 9. Seven of ten.
    //
    // This expectation said 0.8 until 2026-08-30, which was the old
    // implementation's answer written down as if it were the right one: it
    // measured the *distance* between two marks (9 − 1 = 8) rather than the
    // count of blocks with no mark. A test that agrees with the code is not a
    // test of the code.
    const { sketch, report } = read([at(0, 20), at(1, 100), at(9, 400)]);
    expect(scoreSketch(sketch, report, opts).reach).toBeCloseTo(0.7, 5);
  });

  it("reports the whole article unreached when nothing is linked", () => {
    // The worst possible input, and the old arithmetic scored it at 0.9 —
    // better than a picture that reaches nine blocks in ten.
    const { sketch, report } = read([node({ id: "a", y: 20 })]);
    expect(scoreSketch(sketch, report, opts).reach).toBeCloseTo(1, 5);
  });

  it("takes overlap from the worst scene rather than pooling every scene", () => {
    // Two tidy zoom scenes must not dilute an overview whose boxes sit on top
    // of each other — the overview is the picture.
    const { sketch, report } = readSketch(
      {
        title: "t",
        caption: "c",
        scenes: [
          {
            id: "overview",
            title: "s",
            height: 600,
            items: [
              node({ id: "a", x: 0, y: 0, w: 100, h: 100 }),
              node({ id: "b", x: 50, y: 0, w: 100, h: 100 }),
            ],
          },
          {
            id: "zoom",
            title: "z",
            height: 600,
            items: [
              node({ id: "c", x: 0, y: 0, w: 100, h: 100 }),
              node({ id: "d", x: 400, y: 0, w: 100, h: 100 }),
            ],
          },
        ],
      },
      opts,
    );
    expect(scoreSketch(sketch, report, opts).overlap).toBeCloseTo(0.25, 5);
  });

  it("counts the run before the first node and after the last", () => {
    // A picture whose only node is in the middle reaches neither end, and a
    // reader scrolling either way finds nothing lighting up. Block 5 is linked,
    // so 0–4 is five and 6–9 is four; the widest is five of ten.
    const { sketch, report } = read([at(5, 300)]);
    expect(scoreSketch(sketch, report, opts).reach).toBeCloseTo(0.5, 5);
  });

  it("measures overlapping node area as a fraction of all node area", () => {
    const { sketch, report } = read([
      node({ id: "a", x: 0, y: 0, w: 100, h: 100 }),
      node({ id: "b", x: 50, y: 0, w: 100, h: 100 }),
    ]);
    // 50×100 of overlap against 2 × 100×100 of node.
    expect(scoreSketch(sketch, report, opts).overlap).toBeCloseTo(0.25, 5);
  });

  it("takes flow from the overview alone, not from every scene", () => {
    // A zoom scene draws one part of the article at its own scale, so its ys
    // restart from the top. Pooling them with the overview's would report a
    // scrambled picture for two pictures that are each perfectly ordered.
    const { sketch, report } = readSketch(
      {
        title: "t",
        caption: "c",
        scenes: [
          { id: "overview", title: "s", height: 600, items: [at(0, 20), at(4, 300), at(9, 560)] },
          { id: "zoom", title: "z", height: 600, items: [at(4, 20), at(5, 300), at(6, 560)] },
        ],
      },
      opts,
    );
    expect(scoreSketch(sketch, report, opts).flow).toBeCloseTo(1, 5);
  });
});

describe("nodeFits — text that will not fit its box", () => {
  const box = (over: Partial<SketchNode>): SketchNode => ({
    kind: "node",
    id: "n",
    shape: "box",
    x: 0,
    y: 0,
    w: 200,
    h: 40,
    text: "short",
    size: "sm",
    ...over,
  });

  it("passes text the box can hold", () => {
    expect(nodeFits(box({ text: "Brains are not computers" }))).toBe(true);
  });

  it("fails text the box cannot", () => {
    expect(nodeFits(box({ text: "Brains are not computers ".repeat(6), h: 30 }))).toBe(false);
  });

  it("fails a single word too long for the box, which is where the two routines used to disagree", () => {
    // The exact case that scored as fitting and rendered as `superc…`: one word
    // longer than the line. A word loop that counts spaces says one line; the
    // wrapper that actually draws it breaks the word across several.
    const long = box({ text: "supercalifragilisticexpialidocious", w: 60, h: 20 });
    expect(nodeFits(long)).toBe(false);
  });

  it("agrees with what the painter will actually draw", () => {
    // The property, rather than one example of it: for any node, "it fits" and
    // "the drawn lines are the whole text" have to be the same statement.
    const cases: SketchNode[] = [
      box({ text: "short", w: 200, h: 40 }),
      box({ text: "supercalifragilisticexpialidocious", w: 60, h: 20 }),
      box({ text: "a fairly long claim about several things at once", w: 140, h: 44 }),
      box({ text: "two words", w: 90, h: 60, sub: "and a qualifier" }),
    ];
    for (const n of cases) {
      const drawn = wrap(n.text, charsThatFit(n.w, n.size), linesInBox(n));
      const whole = wrap(n.text, charsThatFit(n.w, n.size), Number.POSITIVE_INFINITY);
      expect(nodeFits(n)).toBe(drawn.length === whole.length && !drawn.join("").includes("…"));
    }
  });

  it("counts the sub-line against the height", () => {
    // Two nodes that differ only in having a `sub`. Without this the sub was
    // free, and a box sized exactly to its title pushed its own second line out
    // of the bottom — where SVG draws it anyway, over whatever is below.
    const tight = { text: "Three lines of words here now", w: 120, h: 40 };
    expect(nodeFits(box(tight))).toBe(true);
    expect(nodeFits(box({ ...tight, sub: "a qualifier" }))).toBe(false);
  });

  it("needs more lines in a narrower box", () => {
    expect(linesNeeded("one two three four five six", 300, "sm")).toBeLessThan(
      linesNeeded("one two three four five six", 90, "sm"),
    );
  });
});

describe("accept — the line under which there is no picture at all", () => {
  const linked = (i: number, y: number) =>
    node({ id: `n${i}`, y, block: BLOCKS[i], x: 20 + i * 10 });

  /** Read and score in one go, the way `generateSketch` does. */
  function judge(raw: unknown) {
    const { sketch, report } = readSketch(raw, opts);
    return { verdict: accept(sketch, scoreSketch(sketch, report, opts)), sketch };
  }

  it("passes an ordinary picture", () => {
    const { verdict } = judge(scene([linked(0, 20), linked(3, 200), linked(6, 400), linked(9, 560)]));
    expect(verdict.refusals).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it("refuses an answer with no scenes at all", () => {
    // The failure this function exists for. `{"scenes": []}` came through
    // `readSketch` with ZERO faults, scored, and was written to disk as a
    // finished sketch — the reader waits two minutes, is billed, and gets a
    // blank band, with every check reporting success.
    const { verdict } = judge({ title: "t", caption: "c", scenes: [] });
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals.join(" ")).toContain("no overview");
  });

  it("refuses an overview of one or two boxes", () => {
    const { verdict } = judge(scene([linked(0, 20), linked(9, 400)]));
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals.join(" ")).toContain("fewer than");
  });

  it("refuses a picture with no caption, which is the claim a reader checks", () => {
    const { verdict } = judge({
      title: "t",
      caption: "",
      scenes: [{ id: "overview", title: "s", height: 600, items: [linked(0, 20), linked(4, 200), linked(9, 400)] }],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals.join(" ")).toContain("caption");
  });

  it("refuses a picture almost none of which can be clicked through", () => {
    // Pretty, and it is not a way into the article — which is half of what this
    // feature is for.
    const { verdict } = judge(
      scene([
        linked(0, 20),
        node({ id: "x", y: 200 }),
        node({ id: "y", y: 300 }),
        node({ id: "z", y: 400 }),
      ]),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals.join(" ")).toContain("clicked through");
  });

  it("refuses a picture drawn on top of itself", () => {
    const stack = [0, 3, 6, 9].map((i) =>
      node({ id: `n${i}`, x: 0, y: 0, w: 200, h: 200, block: BLOCKS[i] }),
    );
    const { verdict } = judge(scene(stack));
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals.join(" ")).toContain("over other nodes");
  });

  it("refuses a picture that runs the wrong way up the page", () => {
    // Every other measure is identical to the passing case above.
    const { verdict } = judge(scene([linked(0, 560), linked(3, 400), linked(6, 200), linked(9, 20)]));
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals.join(" ")).toContain("down the page");
  });

  it("does not refuse a picture merely for having too few linked nodes to score flow", () => {
    // `flow` is null under three linked nodes, and null is "we cannot tell",
    // not "it failed". The node-count and linkage rules have already had their
    // say about a picture that small.
    const { verdict } = judge(
      scene([linked(0, 20), linked(9, 400), node({ id: "j", y: 200 })]),
    );
    expect(verdict.refusals.join(" ")).not.toContain("down the page");
  });
});
