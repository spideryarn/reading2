/**
 * The Sketch painter's geometry — src/sketch-paint.ts.
 *
 * **Every assertion in this file is here because a picture was wrong and no
 * code was.** The painter never throws, SVG never clips and never errors on a
 * bad coordinate, so each of these failures rendered perfectly and looked like
 * a decision somebody had made. They were found by rasterising a scene and
 * looking at it, which is not a thing that can be left to run on a machine —
 * hence this file, which is the half of each finding that can.
 *
 * The five, in the order they were found (docs/plans/260830j-sketch-diagram.md
 * § Five renderer bugs the first pictures found):
 *
 *  2. a fan of children left sideways instead of descending;
 *  3. a loop back to the opening went straight through nine boxes;
 *  4. a swept curve walked off the canvas and back on;
 *  5. an edge label was drawn under the node it landed on, and off the edge.
 *
 * (1 was a harness colour bug, not geometry.)
 */
import { describe, expect, it } from "vitest";
import {
  anchorTransform,
  paintScene,
  PEEK_LABEL_STRIP,
  peekViewport,
  wrap,
  type Prim,
  zoomAnchor,
} from "../src/sketch-paint.js";
import { CANVAS_W, type SketchItem, type SketchNode, type SketchScene } from "../src/sketch-scene.js";

function node(over: Partial<SketchNode> & { id: string }): SketchNode {
  return {
    kind: "node",
    shape: "box",
    x: 0,
    y: 0,
    w: 160,
    h: 60,
    text: "a claim",
    size: "sm",
    ...over,
  };
}

const scene = (items: SketchItem[], height = 1200): SketchScene => ({
  id: "overview",
  title: "t",
  height,
  items,
});

/** Every number in a path's `d`, as (x, y) pairs. */
function points(d: string): { x: number; y: number }[] {
  const n = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i] as number, y: n[i + 1] as number });
  return out;
}

const paths = (ps: Prim[]) => ps.filter((p): p is Prim & { t: "path" } => p.t === "path");
const edgePaths = (ps: Prim[]) => paths(ps).filter((p) => p.cls.includes("sk-edge"));

describe("an edge between two nodes one above the other is a descent", () => {
  /* Bug 2. `facing` compared the two centres' offsets, so a node pointing at
     three children spread below it left through its own LEFT and RIGHT sides,
     swung out to the canvas edge, and arrived at each child pointing inwards.
     Every line was geometrically reasonable; none of them read as the argument
     moving forwards, which is the whole job. The rule is now: if one shape is
     entirely below the other, the edge descends, before dx is compared to dy. */
  const parent = node({ id: "p", x: 300, y: 100, w: 160, h: 60 });
  const kids = [
    node({ id: "k0", x: 20, y: 300 }),
    node({ id: "k1", x: 300, y: 300 }),
    node({ id: "k2", x: 580, y: 300 }),
  ];

  it("leaves the parent's bottom edge even when the child is far to the side", () => {
    const painted = paintScene(
      scene([
        parent,
        ...kids,
        ...kids.map((k) => ({ kind: "edge" as const, from: "p", to: k.id, via: "curve" as const, line: "solid" as const, arrow: "end" as const })),
      ]),
    );
    const ds = edgePaths(painted.links);
    expect(ds).toHaveLength(3);
    for (const p of ds) {
      const start = points(p.d)[0] as { x: number; y: number };
      // The bottom-centre of the parent, on every one of the three.
      expect(start.x).toBeCloseTo(380, 5);
      expect(start.y).toBeCloseTo(160, 5);
    }
  });

  it("arrives at the child's top edge", () => {
    const painted = paintScene(
      scene([parent, kids[0] as SketchNode, { kind: "edge", from: "p", to: "k0", via: "straight", line: "solid", arrow: "end" }]),
    );
    const pts = points((edgePaths(painted.links)[0] as { d: string }).d);
    const end = pts[pts.length - 1] as { x: number; y: number };
    expect(end.x).toBeCloseTo(100, 5); // k0's horizontal centre
    expect(end.y).toBeCloseTo(300, 5); // k0's top
  });

  it("goes sideways only when the two overlap vertically", () => {
    // The case "beside" is actually for: two nodes on the same row.
    const painted = paintScene(
      scene([
        node({ id: "a", x: 40, y: 200 }),
        node({ id: "b", x: 400, y: 210 }),
        { kind: "edge", from: "a", to: "b", via: "straight", line: "solid", arrow: "end" },
      ]),
    );
    const start = points((edgePaths(painted.links)[0] as { d: string }).d)[0] as { x: number; y: number };
    expect(start.x).toBeCloseTo(200, 5); // a's RIGHT edge
    expect(start.y).toBeCloseTo(230, 5); // a's vertical centre
  });
});

describe("a long edge back up the page goes round the outside", () => {
  /* Bug 3. The commonest long edge here is "and the piece returns to this". The
     model aimed both ends at their nodes' left sides — the right thing — and a
     fixed 46-unit control offset against an 1,100-unit chord is a straight
     line. It went up the middle, through nine boxes, and looked like a stray
     dashed rule somebody had left in. */
  const top = node({ id: "open", x: 300, y: 30, w: 200, h: 60 });
  const bottom = node({ id: "close", x: 300, y: 1080, w: 200, h: 60 });

  it("sweeps well clear of the column when both ends name the same side", () => {
    const painted = paintScene(
      scene([top, bottom, { kind: "edge", from: "close:left", to: "open:left", via: "curve", line: "dashed", arrow: "end" }]),
    );
    const pts = points((edgePaths(painted.links)[0] as { d: string }).d);
    const leftmost = Math.min(...pts.map((p) => p.x));
    // The anchors are both at x = 300. A straight line would leave `leftmost`
    // at 300, which is the bug. It has to get properly out of the way.
    expect(leftmost).toBeLessThan(140);
  });

  it("routes a back-edge outwards even when the model named no sides at all", () => {
    // The prompt asks for the sides and a model will often not bother, because
    // it is a rule that matters once in a picture.
    const painted = paintScene(
      scene([top, bottom, { kind: "edge", from: "close", to: "open", via: "curve", line: "dashed", arrow: "end" }]),
    );
    const pts = points((edgePaths(painted.links)[0] as { d: string }).d);
    const start = pts[0] as { x: number; y: number };
    // Off a side, not off the top: a top anchor would put it on x = 400 and
    // send it straight up the middle.
    expect(start.y).toBeCloseTo(1110, 5);
    expect([300, 500]).toContain(start.x);
  });

  it("keeps an ordinary forward step a gentle S rather than a sweep", () => {
    // The same rule must not make every short edge bulge: two nodes 100 units
    // apart get a pull measured against the gap, not against the diagonal.
    const painted = paintScene(
      scene([
        node({ id: "a", x: 300, y: 100 }),
        node({ id: "b", x: 300, y: 260 }),
        { kind: "edge", from: "a", to: "b", via: "curve", line: "solid", arrow: "end" },
      ]),
    );
    const pts = points((edgePaths(painted.links)[0] as { d: string }).d);
    for (const p of pts) expect(Math.abs(p.x - 380)).toBeLessThan(4);
  });
});

describe("nothing a curve draws leaves the canvas", () => {
  /* Bug 4. A 300-unit wrap-around pull off an anchor near the left margin puts
     a control point at x = -130. Nothing clips, so the curve walked off the
     picture and reappeared — on the constitution, on the two edges the reader
     most needs to follow. Control points are clamped, which clamps the curve: a
     cubic never leaves its control polygon's hull. */
  it("clamps the control points of a sweep off a node hard against the left edge", () => {
    const painted = paintScene(
      scene([
        node({ id: "open", x: 8, y: 30, w: 200, h: 60 }),
        node({ id: "close", x: 8, y: 1080, w: 200, h: 60 }),
        { kind: "edge", from: "close:left", to: "open:left", via: "curve", line: "dashed", arrow: "end" },
      ]),
    );
    for (const p of points((edgePaths(painted.links)[0] as { d: string }).d)) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(CANVAS_W);
    }
  });

  it("clamps vertically too, which this test did not check and the code did not do", () => {
    /* **The sixth bug, and half of it was this test.** The clamp was applied to
       x alone, and the assertion written to prove it read x alone — so an edge
       `a:top → b:top` with `a` near the top of the canvas put a control point
       at y = -137 and the curve left through the ceiling, with the guard and
       its probe both reporting success. Two clauses need two probes. GPT Sol,
       2026-08-30. */
    const painted = paintScene(
      scene(
        [
          node({ id: "a", x: 200, y: 5, w: 160, h: 60 }),
          node({ id: "b", x: 200, y: 400, w: 160, h: 60 }),
          { kind: "edge", from: "a:top", to: "b:top", via: "curve", line: "solid", arrow: "end" },
        ],
        600,
      ),
    );
    for (const p of points((edgePaths(painted.links)[0] as { d: string }).d)) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(600);
    }
  });
});

describe("a free path's arrows", () => {
  const path = (arrow: "none" | "end" | "start" | "both") => ({
    kind: "path" as const,
    d: "M100 100 C200 200 300 300 400 400",
    line: "solid" as const,
    arrow,
    fill: false,
  });
  const heads = (items: SketchItem[]) =>
    paintScene(scene(items)).links.filter((p) => p.cls === "sk-head").length;

  it("draws both ends when asked for both", () => {
    // `"start"` drew nothing at all and `"both"` drew one, on the primitive
    // whose whole purpose is the shapes an edge cannot make. An arrow that
    // silently does not appear is the picture claiming a direction it is not
    // drawing. GPT Sol, 2026-08-30.
    expect(heads([path("none")])).toBe(0);
    expect(heads([path("end")])).toBe(1);
    expect(heads([path("start")])).toBe(1);
    expect(heads([path("both")])).toBe(2);
  });

  it("puts the start arrow at the start and the end arrow at the end", () => {
    const only = (arrow: "start" | "end") => {
      const head = paintScene(scene([path(arrow)])).links.find((p) => p.cls === "sk-head") as
        | (Prim & { t: "poly" })
        | undefined;
      const [x, y] = ((head as { points: string }).points.split(" ")[0] as string)
        .split(",")
        .map(Number);
      return { x: x as number, y: y as number };
    };
    expect(only("start")).toEqual({ x: 100, y: 100 });
    expect(only("end")).toEqual({ x: 400, y: 400 });
  });
});

describe("an edge's label is readable, on the canvas, and over the boxes", () => {
  /* Bug 5, which was two bugs. Edges are drawn before nodes so a line never
     crosses a box it is not touching — and that put every edge LABEL under the
     boxes too. A long edge's midpoint is very often inside one, so the label
     was rendered, correctly, invisibly. Then when the sweep was fixed, the
     label followed the curve out past the left margin and was sliced in half. */
  const items: SketchItem[] = [
    node({ id: "open", x: 300, y: 30, w: 200, h: 60 }),
    node({ id: "close", x: 300, y: 1080, w: 200, h: 60 }),
    { kind: "edge", from: "close:left", to: "open:left", via: "curve", line: "dashed", arrow: "end", label: "returns to the opening stakes" },
  ];

  it("puts the label over the nodes, not under them", () => {
    const painted = paintScene(scene(items));
    const inFront = painted.front.filter((p) => p.t === "text" && p.cls.includes("sk-edge-label"));
    const behind = painted.links.filter((p) => p.t === "text" && p.cls.includes("sk-edge-label"));
    expect(inFront).toHaveLength(1);
    expect(behind).toHaveLength(0);
  });

  it("keeps the whole label plate on the canvas", () => {
    const painted = paintScene(scene(items));
    const plate = painted.front.find((p) => p.cls.includes("sk-label-plate")) as
      | (Prim & { t: "rect" })
      | undefined;
    expect(plate).toBeTruthy();
    expect((plate as { x: number }).x).toBeGreaterThanOrEqual(0);
    expect((plate as { x: number; w: number }).x + (plate as { w: number }).w).toBeLessThanOrEqual(CANVAS_W);
  });

  it("places the label on the line as drawn, not halfway between its ends", () => {
    // A swept curve's chord midpoint is in the middle of the picture, which is
    // exactly where the label must not go.
    const painted = paintScene(scene(items));
    const text = painted.front.find((p) => p.cls.includes("sk-edge-label")) as
      | (Prim & { t: "text" })
      | undefined;
    expect((text as { x: number }).x).toBeLessThan(300);
  });

  it("moves the label off a box rather than knocking a hole in its text", () => {
    /* The plate stops the LINE showing through the label, and it does the same
       to whatever else is underneath — so a return edge whose midpoint happens
       to be level with a row of nodes covered one of them. On the Noema essay
       it sat squarely over "Simulating a mind ≠ creating one", which is a worse
       bug than the one the plate was added to fix. */
    const blocker = node({ id: "mid", x: 60, y: 520, w: 220, h: 90, text: "in the way" });
    const painted = paintScene(scene([...items, blocker]));
    const plate = painted.front.find((p) => p.cls.includes("sk-label-plate")) as
      | (Prim & { t: "rect" })
      | undefined;
    const overlaps =
      (plate as { x: number }).x + (plate as { w: number }).w > blocker.x &&
      (plate as { x: number }).x < blocker.x + blocker.w &&
      (plate as { y: number }).y + (plate as { h: number }).h > blocker.y &&
      (plate as { y: number }).y < blocker.y + blocker.h;
    expect(overlaps).toBe(false);
  });
});

describe("arrowheads", () => {
  it("points the way the line is going", () => {
    const painted = paintScene(
      scene([
        node({ id: "a", x: 300, y: 100 }),
        node({ id: "b", x: 300, y: 400 }),
        { kind: "edge", from: "a", to: "b", via: "straight", line: "solid", arrow: "end" },
      ]),
    );
    const head = painted.links.find((p) => p.cls === "sk-head") as (Prim & { t: "poly" }) | undefined;
    const [tip, w1, w2] = ((head as { points: string }).points.split(" ") ?? []).map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x: x as number, y: y as number };
    });
    // The tip sits on b's top edge and the two wings are ABOVE it — an arrow
    // whose wings were below would be pointing back up the article, which is
    // the precise falsehood the head is drawn to prevent.
    expect((tip as { y: number }).y).toBeCloseTo(400, 5);
    expect((w1 as { y: number }).y).toBeLessThan(400);
    expect((w2 as { y: number }).y).toBeLessThan(400);
  });

  it("draws no head when the edge asks for none", () => {
    const painted = paintScene(
      scene([
        node({ id: "a", x: 300, y: 100 }),
        node({ id: "b", x: 300, y: 400 }),
        { kind: "edge", from: "a", to: "b", via: "straight", line: "solid", arrow: "none" },
      ]),
    );
    expect(painted.links.filter((p) => p.cls === "sk-head")).toHaveLength(0);
  });
});

describe("wrap", () => {
  it("never exceeds the width it was given", () => {
    for (const line of wrap("the quick brown fox jumps over the lazy dog", 12, 6)) {
      expect(line.length).toBeLessThanOrEqual(12);
    }
  });

  it("breaks a single word longer than the line", () => {
    // Otherwise it is drawn at full length, straight over whatever is beside it.
    for (const line of wrap("antidisestablishmentarianism", 10, 4)) {
      expect(line.length).toBeLessThanOrEqual(10);
    }
  });

  it("marks a truncation rather than stopping mid-word", () => {
    const lines = wrap("one two three four five six seven eight nine ten", 8, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/…$/);
  });

  it("leaves text that fits alone", () => {
    expect(wrap("short enough", 40, 3)).toEqual(["short enough"]);
  });
});

describe("what is drawn, and in what order", () => {
  it("draws a region's panel under the edges and its NAME over them", () => {
    /* A line crossing a panel is a line crossing a background. A line crossing
       the panel's name made a reader unable to tell whether the connector
       terminated there — a fresh-eyes pass over three articles called it the
       single most valuable change, 2026-08-30. Words on top; only the panel
       underneath. */
    const painted = paintScene(
      scene([
        { kind: "region", x: 10, y: 10, w: 700, h: 400, style: "band", label: "WHO WILL ACT ON IT" },
        node({ id: "a", x: 40, y: 60 }),
        node({ id: "b", x: 40, y: 300 }),
        { kind: "edge", from: "a", to: "b", via: "straight", line: "solid", arrow: "end" },
      ]),
    );
    const isLabel = (p: Prim) => p.cls.includes("sk-region-label");
    expect(painted.behind.some(isLabel)).toBe(false);
    expect(painted.front.filter(isLabel)).toHaveLength(1);
    // The panel itself stays underneath, where a line may cross it freely.
    expect(painted.behind.some((p) => p.cls.includes("sk-region") && p.t === "rect")).toBe(true);
  });

  it("puts regions behind, edges under the nodes, and free labels in front", () => {
    const painted = paintScene(
      scene([
        { kind: "region", x: 10, y: 10, w: 300, h: 300, style: "band", label: "PHASE ONE" },
        node({ id: "a", x: 40, y: 60 }),
        node({ id: "b", x: 40, y: 200 }),
        { kind: "edge", from: "a", to: "b", via: "straight", line: "solid", arrow: "end" },
        { kind: "label", x: 400, y: 40, text: "a caption", size: "sm", align: "start" },
      ]),
    );
    expect(painted.behind.some((p) => p.cls.includes("sk-region"))).toBe(true);
    expect(painted.links.some((p) => p.cls.includes("sk-edge"))).toBe(true);
    expect(painted.nodes).toHaveLength(2);
    expect(painted.front.some((p) => p.cls.includes("sk-label"))).toBe(true);
  });

  it("gives a `bare` node its words and no outline", () => {
    const painted = paintScene(scene([node({ id: "a", shape: "bare", text: "just words" })]));
    const n = painted.nodes[0];
    expect(n?.prims.every((p) => p.t === "text")).toBe(true);
  });

  it("carries the node through to its painted form so a click has something to jump to", () => {
    const painted = paintScene(scene([node({ id: "a", block: "spya-aaaaaa", opens: "zoom" })]));
    expect(painted.nodes[0]?.node.block).toBe("spya-aaaaaa");
    expect(painted.nodes[0]?.hit).toEqual({ x: 0, y: 0, w: 160, h: 60 });
  });
});

/* ------------------------------------------------------------------------ */
/* Saying that a part opens, and showing what is inside it —
   docs/plans/260830ap-sketch-zoomable-subsections.md. */

describe("a region that opens a scene is drawn as one", () => {
  const region = (over: Partial<SketchItem> = {}) =>
    ({
      kind: "region",
      x: 24,
      y: 150,
      w: 700,
      h: 180,
      style: "band",
      label: "WHY WE'RE TEMPTED",
      ...over,
    }) as SketchItem;

  const panels = (ps: Prim[]) => ps.filter((p) => p.cls.split(" ").includes("sk-region"));

  it("marks the region's own panel rather than adding a second shape behind it", () => {
    /* **This replaced a stack of two panels**, the second offset five units
       down and right. A browser pass on the real drawing at 288px could not see
       it — "indistinguishable from a soft drop shadow or a rendering artifact"
       — and, the finding that mattered, could not tell which of the four
       regions were pressable at all. Five units is 2.5 CSS pixels once 760
       units are scaled into a 400px band: every *distance* halves, which is why
       the affordance is contrast now and why the stylesheet owns it. GPT Sol
       said so twice before the browser did. 2026-08-30. */
    const shut = paintScene(scene([region()]));
    expect(panels(shut.behind)).toHaveLength(1);
    expect(shut.behind.some((p) => p.cls.includes("sk-region-opens"))).toBe(false);

    const opens = paintScene(scene([region({ opens: "zoom" } as Partial<SketchItem>)]));
    // Still exactly one panel — the affordance costs no geometry at all.
    expect(panels(opens.behind)).toHaveLength(1);
    expect(panels(opens.behind)[0]?.cls).toContain("sk-region-opens");
  });

  it("keeps the style the model asked for, and adds to it", () => {
    const painted = paintScene(
      scene([region({ style: "dashed", opens: "zoom" } as Partial<SketchItem>)]),
    );
    const panel = panels(painted.behind)[0];
    expect(panel?.cls).toContain("sk-region-dashed");
    expect(panel?.cls).toContain("sk-region-opens");
  });

  it("gives the mark to every region style, including the two with no panel", () => {
    /* `plain` and `bracket` are exactly the two the old motif could not reach,
       which is why the mark had to be the universal one. */
    for (const style of ["band", "dashed", "plain", "bracket"] as const) {
      const painted = paintScene(scene([region({ style, opens: "zoom" } as Partial<SketchItem>)]));
      const marks = painted.regions[0]?.label.filter((p) => p.cls.includes("sk-region-more"));
      expect(marks, `no mark on a ${style} region`).toHaveLength(1);
    }
  });

  it("puts the mark inside the hit box, because a mark that says press me and is not pressable is the bug this feature is fixing", () => {
    const painted = paintScene(scene([region({ opens: "zoom" } as Partial<SketchItem>)]));
    const r = painted.regions[0];
    const mark = r?.label.find((p) => p.cls.includes("sk-region-more"));
    if (mark?.t !== "path" || !r?.hit) throw new Error("expected a mark and a hit box");
    for (const p of points(mark.d)) {
      expect(p.x).toBeGreaterThanOrEqual(r.hit.x);
      expect(p.x).toBeLessThanOrEqual(r.hit.x + r.hit.w);
      expect(p.y).toBeGreaterThanOrEqual(r.hit.y);
      expect(p.y).toBeLessThanOrEqual(r.hit.y + r.hit.h);
    }
  });

  it("drops the mark rather than drawing it outside a region too narrow for it", () => {
    const painted = paintScene(
      scene([region({ x: 10, w: 60, label: "A VERY LONG NAME INDEED", opens: "zoom" } as Partial<SketchItem>)]),
    );
    const marks = painted.regions[0]?.label.filter((p) => p.cls.includes("sk-region-more"));
    expect(marks).toHaveLength(0);
    expect((painted.regions[0]?.hit?.w ?? 0) + 10).toBeLessThanOrEqual(10 + 60);
  });

  it("carries no mark at all when nothing opens", () => {
    const painted = paintScene(scene([region()]));
    expect(painted.regions[0]?.label.some((p) => p.cls.includes("sk-region-more"))).toBe(false);
  });
});

describe("peekViewport — where a ghost of the part goes, and how big", () => {
  /* The picture drawn into `port` is `paintScene`'s own output of the real
     scene, in a nested SVG viewport that scales and clips it. The first version
     was a second, simplified painter — rounded rects for every shape, straight
     hairlines for every edge — and it threw away the diamond, the parallel
     bands and the dashes that were the structure it claimed to be showing.
     ⟨Sol⟩, 2026-08-30. So all this function decides is two rectangles, and all
     these tests are about the rectangles. */
  const band = { x: 24, y: 150, w: 700, h: 180 };

  it("keeps clear of the region's own name, which is the control that summoned it", () => {
    const a = peekViewport(band, 650, 1150);
    if (!a) throw new Error("expected a viewport");
    expect(a.scrim.y).toBeGreaterThanOrEqual(band.y + PEEK_LABEL_STRIP);
    expect(a.port.y).toBeGreaterThanOrEqual(a.scrim.y);
  });

  it("grows downward past a landscape region, because a portrait scene cannot fit one", () => {
    /* Fitted to the region, the ghost is limited by height and uses 175 of the
       684 units of width it has — a quarter of the size the space could hold,
       for no reason but the shape mismatch. A browser pass at band width called
       it "borderline, not solidly legible" and diagnosed it exactly: not the
       scrim, not the line weight, the ghost being too small. 2026-08-31. */
    const a = peekViewport(band, 650, 1150);
    if (!a) throw new Error("expected a viewport");
    const fittedToRegion = Math.min(684 / CANVAS_W, 150 / 650);
    const grown = Math.min(a.port.w / CANVAS_W, a.port.h / 650);
    expect(grown, "the ghost is no bigger than it was").toBeGreaterThan(fittedToRegion * 1.5);
    // Down, never up: the name is along the top and it must stay visible.
    expect(a.scrim.y).toBeGreaterThan(band.y);
    expect(a.scrim.y + a.scrim.h).toBeGreaterThan(band.y + band.h);
  });

  it("does not grow without limit, and never past the end of the canvas", () => {
    /* A peek that expanded to whatever the scene wanted would be a 600-unit
       panel dropped over the middle of the picture — a popover, which is a
       heavier thing than a hover has asked for. */
    const a = peekViewport(band, 2400, 1150);
    if (!a) throw new Error("expected a viewport");
    expect(a.scrim.h).toBeLessThanOrEqual(300);

    // And against a canvas with no room below the region.
    const tight = peekViewport({ x: 24, y: 150, w: 700, h: 180 }, 2400, 340);
    if (!tight) throw new Error("expected a viewport");
    expect(tight.scrim.y + tight.scrim.h).toBeLessThanOrEqual(340);
  });

  it("never comes back narrower than the region it belongs to", () => {
    const a = peekViewport(band, 650, 1150);
    if (!a) throw new Error("expected a viewport");
    expect(a.scrim.x).toBeGreaterThanOrEqual(band.x);
    expect(a.scrim.x + a.scrim.w).toBeLessThanOrEqual(band.x + band.w);
    expect(a.port.x).toBeGreaterThanOrEqual(a.scrim.x);
    expect(a.port.x + a.port.w).toBeLessThanOrEqual(a.scrim.x + a.scrim.w);
  });

  it("declines a region with no room in it rather than returning a sliver", () => {
    /* A bare scrim over a band too thin to draw anything in is a smudge that
       appeared for no reason a reader can see. */
    expect(peekViewport({ x: 0, y: 0, w: 4, h: 4 }, 650, 1150)).toBeNull();
    expect(peekViewport({ x: 0, y: 0, w: 400, h: 10 }, 650, 1150)).toBeNull();
    /* **And the band that is just tall enough to get past the first guard and
       not the second.** Both of the cases above are caught on the way in — the
       last check in the function was unreachable from either, so a mutation
       that deleted it stayed green and the clause was decoration. A region 24
       units tall leaves 6 for the peek, which doubles to 12, which the padding
       eats: the only input that reaches it. */
    expect(peekViewport({ x: 0, y: 100, w: 400, h: 24 }, 650, 1150)).toBeNull();
  });
});

describe("the zoom anchor", () => {
  /** A transform string back to the numbers, so the algebra can be composed. */
  function read(t: string): { tx: number; ty: number; s: number } {
    const m = t.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/);
    if (!m) throw new Error(`not a transform: ${t}`);
    return { tx: Number(m[1]), ty: Number(m[2]), s: Number(m[3]) };
  }

  const band = { x: 24, y: 150, w: 700, h: 180 };

  it("starts the incoming scene inside the box that was pressed", () => {
    const a = zoomAnchor(band, 650);
    if (!a) throw new Error("expected an anchor");
    const t = read(anchorTransform(a, "in"));
    // The whole canvas, scaled by s and placed at (tx, ty), sits in the band.
    expect(t.tx).toBeGreaterThanOrEqual(band.x - 0.001);
    expect(t.ty).toBeGreaterThanOrEqual(band.y - 0.001);
    expect(t.tx + CANVAS_W * t.s).toBeLessThanOrEqual(band.x + band.w + 0.001);
    expect(t.ty + 650 * t.s).toBeLessThanOrEqual(band.y + band.h + 0.001);
  });

  it("centres it on the box rather than in a corner", () => {
    const a = zoomAnchor(band, 650);
    if (!a) throw new Error("expected an anchor");
    expect(a.tx + (CANVAS_W * a.s) / 2).toBeCloseTo(band.x + band.w / 2, 5);
    expect(a.ty + (650 * a.s) / 2).toBeCloseTo(band.y + band.h / 2, 5);
  });

  it("makes going out the exact undoing of going in", () => {
    /* The property that makes one read as the reverse of the other. Composed
       rather than eyeballed, because two transforms that each look plausible
       can compose to something that is not the identity — and on screen that
       is a picture that comes back a little further left every time. */
    const a = zoomAnchor(band, 650);
    if (!a) throw new Error("expected an anchor");
    const i = read(anchorTransform(a, "in"));
    const o = read(anchorTransform(a, "out"));
    // out ∘ in: scale multiplies, translations compose through the outer scale.
    expect(o.s * i.s).toBeCloseTo(1, 10);
    expect(o.tx + o.s * i.tx).toBeCloseTo(0, 8);
    expect(o.ty + o.s * i.ty).toBeCloseTo(0, 8);
  });

  it("declines when there is nothing to anchor to, or nothing worth animating", () => {
    expect(zoomAnchor({ x: 0, y: 0, w: 0, h: 100 }, 650)).toBeNull();
    expect(zoomAnchor({ x: 0, y: 0, w: 100, h: 0 }, 650)).toBeNull();
    expect(zoomAnchor(band, 0)).toBeNull();
    /* A box that already nearly fills the canvas is not a zoom — animating a
       6% scale change is a twitch, and the plain fade says "different picture"
       better. */
    expect(zoomAnchor({ x: 0, y: 0, w: CANVAS_W, h: 640 }, 650)).toBeNull();
  });

  it("declines a box it cannot contain the scene inside, rather than overflowing it", () => {
    /* **This test used to assert the bug.** It asked that `s` never fall below
       0.12 and passed *because* `zoomAnchor` clamped it up to 0.12 — which
       started a 650-unit scene 78 units tall inside a 60-unit node, hanging out
       of the very thing the reader pressed. GPT Sol, 2026-08-30. Out of range
       is now a decline in both directions, and what is asserted is the promise
       rather than the number. */
    expect(zoomAnchor({ x: 300, y: 40, w: 150, h: 60 }, 650)).toBeNull();
    expect(zoomAnchor({ x: 300, y: 40, w: 160, h: 40 }, 2400)).toBeNull();
  });

  it("contains the whole scene inside the box, for every box that gets an anchor", () => {
    /* A sweep rather than an example, because the failure above was a single
       ratio at one end of the range and no example anybody would have chosen
       went near it. */
    let anchored = 0;
    for (const w of [80, 150, 300, 500, 700, 760]) {
      for (const h of [40, 90, 180, 400, 700]) {
        for (const sceneH of [200, 500, 650, 1150, 2400]) {
          const box = { x: 10, y: 20, w, h };
          const a = zoomAnchor(box, sceneH);
          if (!a) continue;
          anchored += 1;
          expect(a.tx).toBeGreaterThanOrEqual(box.x - 1e-9);
          expect(a.ty).toBeGreaterThanOrEqual(box.y - 1e-9);
          expect(a.tx + CANVAS_W * a.s).toBeLessThanOrEqual(box.x + box.w + 1e-9);
          expect(a.ty + sceneH * a.s).toBeLessThanOrEqual(box.y + box.h + 1e-9);
        }
      }
    }
    // And the sweep has to reach the code at all.
    expect(anchored, "every box declined, so nothing above was checked").toBeGreaterThan(10);
  });

  it("puts the scroll correction on the far side of the inverse", () => {
    /* The correction is how far the picture's own scroll moved across the swap.
       Folding it into `ty` before building the transform is right for "in" and
       badly wrong for "out", where the inverse then multiplies it by 1/s and
       flips its sign: on the first real region a +250-unit correction arrived
       as −900. GPT Sol, 2026-08-30, with arithmetic that reproduces exactly. */
    const a = zoomAnchor({ x: 24, y: 150, w: 700, h: 180 }, 650);
    if (!a) throw new Error("expected an anchor");
    const shift = 250;
    const inShifted = anchorTransform(a, "in", shift);
    const inPlain = anchorTransform(a, "in");
    const outShifted = anchorTransform(a, "out", shift);
    const outPlain = anchorTransform(a, "out");
    const ty = (t: string) => Number(/translate\([^,]+, (-?[\d.]+)px\)/.exec(t)?.[1]);
    // Going in, the shift is the shift.
    expect(ty(inShifted) - ty(inPlain)).toBeCloseTo(shift, 6);
    /* Going out it is also the shift — NOT the shift through the magnification,
       which is what folding it in beforehand produced. */
    expect(ty(outShifted) - ty(outPlain)).toBeCloseTo(shift, 6);
    // The failure it replaced, named so a reader can see what "wrong" was.
    expect(ty(outShifted) - ty(outPlain)).not.toBeCloseTo(-shift / a.s, 3);
  });
});
