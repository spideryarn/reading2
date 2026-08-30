/**
 * **Turning a validated Sketch scene into drawing primitives** — the only place
 * a `SketchItem` becomes geometry, and it does it without a DOM.
 *
 * Two things render this: the React panel, which maps a primitive to an
 * element and hangs the click and hover handlers off the nodes; and the offline
 * harness, which serialises the same primitives to a standalone `.svg` so a
 * prompt can be looked at as a picture. **One painter, two sinks.** The
 * alternative — a painter in the panel and a second one in the harness — is two
 * answers to the same question, and the one that drifts is the one nobody is
 * looking at when the prompt is being judged.
 *
 * Everything here is arithmetic on numbers that `readSketch` has already
 * clamped, so nothing in this file has to be defensive about the model.
 *
 * ## Anchors are on the boundary, so nothing is trimmed
 *
 * `diagram-d3.ts` learned the hard way that a line drawn centre-to-centre ends
 * *inside* the shape, where an arrowhead is simply not there, and that the
 * naive trim draws one pointing backwards. This file never has that problem,
 * because an edge's endpoints are computed **on the shapes' edges** from the
 * start. The arrowhead is an explicit polygon at that point rather than a
 * `marker-end`, so it needs no `<defs>` and both sinks draw it identically.
 *
 * Colour is never named here. A primitive carries a `tone` (0–7) and the
 * stylesheet turns it into a hue, through the same `--cat-rgb` indirection the
 * searches and the tree already use (docs/project/colour-scales.md).
 */
import {
  CANVAS_W,
  CHAR_W,
  LINE_H,
  layoutNodeText,
  SIZE_PX,
  type SketchEdge,
  type SketchLabel,
  type SketchNode,
  type SketchPath,
  type SketchRegion,
  type SketchScene,
  wrap,
} from "./sketch-scene.js";

/**
 * How far a curve's control point leaves the shape by, before it turns — and it
 * is **two rules, because a curve is two different drawings.**
 *
 * A fixed number was the first version and it produced the one picture this
 * whole design is meant to prevent. The Noema essay's closing node loops back to
 * its opening 1,100 units up the canvas; the model did the right thing and
 * aimed both ends at their nodes' left sides, asking for a sweep round the
 * outside — and a 46-unit control offset against an 1,100-unit chord is a
 * straight line. It went up the middle of the picture, through nine boxes, and
 * looked like a stray dashed rule.
 *
 * So: two anchors that FACE each other (bottom to top) are an ordinary step
 * forward, and want a gentle S — pull much more than half the gap and the curve
 * bulges back past its own start. Two anchors on the SAME side are a
 * wrap-around, and want a pull that scales with how far there is to go.
 */
const FACING_PULL = { factor: 0.45, min: 20, max: 90 };
const AROUND_PULL = { factor: 0.36, min: 60, max: 300 };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** How close to the canvas edge a swept curve may come. */
const MARGIN = 8;
const ARROW_LEN = 10;
const ARROW_W = 7;

/**
 * How big the corner mark beside a zoomable region's name is, in canvas units.
 *
 * ## What was here before, and why it is gone
 *
 * A **stack**: a second copy of the region's own panel, offset five units down
 * and right, on the argument that a duplicate is a shape you *see* where a
 * glyph is a symbol you have to *read*, and that it would therefore survive the
 * band. It did not survive the band. A browser pass on the real drawing at
 * 288px, 2026-08-30, could not see it at all:
 *
 * > I could not see a second panel … Zooming into the exact bottom-right corner
 * > revealed only a very faint darker line just outside the main border,
 * > indistinguishable from a soft drop shadow or a rendering artifact.
 *
 * And the arithmetic says why, which the design never did: the band scales 760
 * units into under 400 pixels, so five units of offset is **2.5 CSS pixels**,
 * drawn as a 5%-opacity fill. The same pass found the corner mark invisible
 * there too — twelve units is six pixels — and, the finding that matters most,
 * that it could not tell which of the four regions were pressable at all. Which
 * is the thing this whole piece of work exists to fix.
 *
 * **So the affordance is contrast, not geometry**, and it lives in the
 * stylesheet: `sk-region-opens` draws a region that opens something with a
 * brighter edge and a stronger wash than one that does not. Contrast is the one
 * property that survives being scaled down — a 1.8px stroke held at 1.8px by
 * `non-scaling-stroke` is the same line at any size, where every *distance*
 * shrinks with the picture. The mark stays, doing the smaller job it was always
 * doing: saying *why* those regions are brighter, once there is room to read it.
 *
 * GPT Sol raised this twice before the browser did, both times as the finding it
 * was least confident in, and both times it was right.
 */
const MARK = 15;

export type Prim =
  | { t: "rect"; x: number; y: number; w: number; h: number; rx: number; cls: string; tone?: number }
  | { t: "ellipse"; cx: number; cy: number; rx: number; ry: number; cls: string; tone?: number }
  | { t: "poly"; points: string; cls: string; tone?: number }
  | { t: "path"; d: string; cls: string; tone?: number }
  | {
      t: "text";
      x: number;
      y: number;
      text: string;
      px: number;
      anchor: "start" | "middle" | "end";
      cls: string;
      tone?: number;
    };

/** One node, with everything needed to draw it and everything needed to click it. */
export interface PaintedNode {
  node: SketchNode;
  prims: Prim[];
  /** The rectangle the pointer and the focus ring use — always the bounding box. */
  hit: { x: number; y: number; w: number; h: number };
}

/**
 * One region, split by layer and with its label's own hit box.
 *
 * The **panel** goes under the edges, the way a background does; the **label**
 * goes over them, because a connector drawn across a region's name made it
 * impossible to tell whether the line terminated there. And the label carries a
 * rectangle of its own, because a region whose `opens` names a scene is
 * pressable *by its name* — see `SketchRegion.opens` for why the name and not
 * the panel.
 */
export interface PaintedRegion {
  region: SketchRegion;
  panel: Prim[];
  label: Prim[];
  /** Around the label's text, or `null` when the region has no label. */
  hit: { x: number; y: number; w: number; h: number } | null;
}

export interface Painted {
  width: number;
  height: number;
  /** The regions' own panels. Drawn first, so everything sits on them. */
  behind: Prim[];
  /** Edges, free paths. Under the nodes, over the region panels. */
  links: Prim[];
  nodes: PaintedNode[];
  /**
   * The regions, whole. `behind` and `front` already carry their primitives —
   * this is the same paint indexed by region, for the panel that has to hang a
   * press on one.
   */
  regions: PaintedRegion[];
  /**
   * Region labels, edge labels and free labels — everything that is words
   * rather than shape.
   *
   * **Region labels are here rather than in `behind`, and that is a fix.** A
   * region's panel belongs under the edges, so a line crosses it the way a line
   * crosses a background; its *name* does not, and a connector drawn over
   * "WHO WILL ACT ON IT" made the reader unable to tell whether the line
   * terminated there. A fresh-eyes pass on three articles called it the single
   * most valuable change, 2026-08-30. Words go on top; only the panel stays
   * underneath.
   */
  front: Prim[];
}

const cls = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");


/* ------------------------------------------------------------------- shapes */

function shapePrims(n: SketchNode): Prim[] {
  const c = cls("sk-shape", `sk-shape-${n.shape}`, n.muted && "sk-muted");
  const tone = n.tone;
  const { x, y, w, h } = n;
  switch (n.shape) {
    case "bare":
      return [];
    case "pill":
      return [{ t: "rect", x, y, w, h, rx: Math.min(h / 2, w / 2), cls: c, ...(tone !== undefined && { tone }) }];
    case "ellipse":
      return [
        { t: "ellipse", cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, cls: c, ...(tone !== undefined && { tone }) },
      ];
    case "diamond":
      return [
        {
          t: "poly",
          points: `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`,
          cls: c,
          ...(tone !== undefined && { tone }),
        },
      ];
    case "hex": {
      const k = Math.min(w / 4, h / 2);
      return [
        {
          t: "poly",
          points: `${x + k},${y} ${x + w - k},${y} ${x + w},${y + h / 2} ${x + w - k},${y + h} ${x + k},${y + h} ${x},${y + h / 2}`,
          cls: c,
          ...(tone !== undefined && { tone }),
        },
      ];
    }
    case "note": {
      // A dog-eared corner, which is the drawing convention for an aside.
      const k = Math.min(14, w / 3, h / 3);
      return [
        {
          t: "path",
          d: `M${x} ${y} L${x + w - k} ${y} L${x + w} ${y + k} L${x + w} ${y + h} L${x} ${y + h} Z`,
          cls: c,
          ...(tone !== undefined && { tone }),
        },
        {
          t: "path",
          d: `M${x + w - k} ${y} L${x + w - k} ${y + k} L${x + w} ${y + k}`,
          cls: "sk-note-fold",
          ...(tone !== undefined && { tone }),
        },
      ];
    }
    default:
      return [{ t: "rect", x, y, w, h, rx: 4, cls: c, ...(tone !== undefined && { tone }) }];
  }
}

/** The node's words, centred in its box, wrapped to what the box can hold. */
function textPrims(n: SketchNode): Prim[] {
  if (!n.text) return [];
  /* **`layoutNodeText` is the same function `nodeFits` asks.** This file used
     to wrap the text itself, and sketch-scene.ts estimated the line count with
     a different loop and a different idea of how wide the shape is — so a 60×20
     node holding one long word scored as fitting and rendered as `superc…`, and
     a hexagon's caption crossed both of its sloping sides with `overflowing`
     reporting 0. A measure and the thing it measures cannot be two pieces of
     arithmetic. Everything below this line is *positioning* what that function
     returned. GPT Sol, 2026-08-30. */
  const { lines, sub, px, subPx } = layoutNodeText(n);
  const subH = sub ? subPx * 1.3 : 0;
  const blockH = lines.length * px * LINE_H + subH;
  // The first baseline: centre the block, then drop by the cap height so the
  // *glyphs* are centred rather than the line boxes.
  let baseline = n.y + (n.h - blockH) / 2 + px * 0.95;
  const cx = n.x + n.w / 2;
  const tone = n.tone;
  const prims: Prim[] = lines.map((line) => {
    const p: Prim = {
      t: "text",
      x: cx,
      y: baseline,
      text: line,
      px,
      anchor: "middle",
      cls: cls("sk-text", n.muted && "sk-muted"),
      ...(tone !== undefined && { tone }),
    };
    baseline += px * LINE_H;
    return p;
  });
  if (sub) {
    prims.push({
      t: "text",
      x: cx,
      y: baseline + subPx * 0.15,
      text: sub,
      px: subPx,
      anchor: "middle",
      cls: "sk-sub",
      ...(tone !== undefined && { tone }),
    });
  }
  return prims;
}

/* -------------------------------------------------------------------- edges */

type Side = "top" | "bottom" | "left" | "right" | "auto";
interface Pt {
  x: number;
  y: number;
  /** The outward normal, so a curve knows which way to leave. */
  nx: number;
  ny: number;
}

function anchorAt(n: SketchNode, side: Exclude<Side, "auto">): Pt {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  if (side === "top") return { x: cx, y: n.y, nx: 0, ny: -1 };
  if (side === "bottom") return { x: cx, y: n.y + n.h, nx: 0, ny: 1 };
  if (side === "left") return { x: n.x, y: cy, nx: -1, ny: 0 };
  return { x: n.x + n.w, y: cy, nx: 1, ny: 0 };
}

/**
 * Which side of `a` faces `b`.
 *
 * **If one shape lies entirely below the other, the edge is a descent** — and
 * that rule comes before any comparison of dx against dy. It is the whole
 * difference between a picture whose lines say "then" and one whose lines say
 * "beside", and the obvious version got it wrong: comparing the centre offsets
 * made a fan from one node to three children spread below it leave through the
 * node's *left and right* sides, swing out to the canvas edge, and arrive at
 * its children pointing inwards. Every one of those lines was geometrically
 * reasonable and none of them read as the argument moving forwards.
 *
 * Sideways is what is left when the two overlap vertically, which is exactly
 * when "beside" is what they are.
 */
function facing(a: SketchNode, b: SketchNode): Exclude<Side, "auto"> {
  if (b.y >= a.y + a.h) return "bottom";
  if (b.y + b.h <= a.y) return "top";
  return b.x + b.w / 2 >= a.x + a.w / 2 ? "right" : "left";
}

function parseEnd(ref: string): { id: string; side: Side } {
  const [id = "", raw] = ref.split(":");
  const side = raw as Side;
  const ok: Side[] = ["top", "bottom", "left", "right"];
  return { id, side: ok.includes(side) ? side : "auto" };
}

const opposite: Record<Exclude<Side, "auto">, Exclude<Side, "auto">> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

/**
 * **A long edge back up the page goes round the outside, not through the
 * middle** — and it has to be decided here rather than left to the model.
 *
 * The commonest long edge in these pictures is "and the piece returns to this",
 * from a conclusion at the bottom to the opening at the top. Anchored
 * top-to-bottom it is a straight vertical line up the centre of the canvas,
 * across every box between the two, and on the first real article it came out
 * looking like a dashed rule somebody had left in. The prompt asks the model to
 * name the sides for exactly this case and the model did not, which is the
 * ordinary outcome for a rule that only matters once in a picture.
 *
 * So: both ends leave sideways, on whichever margin the source is nearer, and
 * the curve's own pull plus its bow carry it round. `null` when this is not
 * that kind of edge.
 */
const BACK_EDGE_GAP = 180;
function outsideRun(a: SketchNode, b: SketchNode): Exclude<Side, "auto"> | null {
  if (b.y + b.h > a.y - BACK_EDGE_GAP) return null;
  return a.x + a.w / 2 < CANVAS_W / 2 ? "left" : "right";
}

function edgePath(
  edge: SketchEdge,
  a: SketchNode,
  b: SketchNode,
  height: number,
): { d: string; from: Pt; to: Pt } {
  const ea = parseEnd(edge.from);
  const eb = parseEnd(edge.to);
  const round = ea.side === "auto" && eb.side === "auto" ? outsideRun(a, b) : null;
  const sideA = ea.side === "auto" ? (round ?? facing(a, b)) : ea.side;
  const sideB = eb.side === "auto" ? (round ?? opposite[facing(a, b)]) : eb.side;
  const from = anchorAt(a, sideA);
  const to = anchorAt(b, sideB);

  if (edge.via === "curve") {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    /* Negative when the two normals point at each other — bottom-to-top, the
       ordinary case — and positive when both leave the same way.
       **There used to be a sideways "bow" here as well**, added when the pull
       was one fixed number and a head-on pair therefore came out as a straight
       line however far apart it was. It fired whenever the chord ran parallel
       to the normals — which is *every ordinary forward step*, two boxes in a
       column — so it kinked each of them 42 units to one side, and only a test
       comparing a straight column against itself was ever going to notice. The
       two pull rules below make it unnecessary: a same-side pair now sweeps
       because its pull scales, and a facing pair is meant to be straight. */
    const facing = from.nx * to.nx + from.ny * to.ny < 0;
    const rule = facing ? FACING_PULL : AROUND_PULL;
    /* For a facing pair the gap that matters is the one along the normal, not
       the diagonal: a wide, shallow fan should not get a deep S because its
       ends are far apart sideways. */
    const span = facing ? Math.abs(dx * from.nx + dy * from.ny) || dist : dist;
    const pull = clamp(span * rule.factor, rule.min, rule.max);

    /* **Control points are clamped to the canvas, which clamps the curve**: a
       cubic never leaves its control polygon's hull. Nothing here clips, so a
       control point at x = -130 — what a 300-unit wrap-around pull off an
       anchor near the left margin produces — draws a curve that walks off the
       picture and reappears, with no error anywhere. Seen on the constitution,
       twice, on the two edges the reader most needs to follow. */
    const cx = (v: number) => clamp(v, MARGIN, CANVAS_W - MARGIN);
    /* **Both axes.** This clamped x only, and the test written to prove it
       checked x only — so an edge `a:top → b:top` with `a` near the top of the
       canvas put a control point at y = -137 and the curve left the picture
       through the ceiling, with the guard and its test both reporting success.
       Half a guard and half a probe, which is the pair that keeps happening.
       GPT Sol found it, 2026-08-30. */
    const cy = (v: number) => clamp(v, MARGIN, height - MARGIN);
    const c1x = cx(from.x + from.nx * pull);
    const c1y = cy(from.y + from.ny * pull);
    const c2x = cx(to.x + to.nx * pull);
    const c2y = cy(to.y + to.ny * pull);
    return { d: `M${from.x} ${from.y} C${c1x} ${c1y} ${c2x} ${c2y} ${to.x} ${to.y}`, from, to };
  }
  if (edge.via === "elbow") {
    // Leave along the normal, cross once, arrive along the normal. Three
    // segments and one turn, which is what makes a column of them legible.
    const vertical = from.nx === 0;
    const mid = vertical ? (from.y + to.y) / 2 : (from.x + to.x) / 2;
    const d = vertical
      ? `M${from.x} ${from.y} L${from.x} ${mid} L${to.x} ${mid} L${to.x} ${to.y}`
      : `M${from.x} ${from.y} L${mid} ${from.y} L${mid} ${to.y} L${to.x} ${to.y}`;
    return { d, from, to };
  }
  return { d: `M${from.x} ${from.y} L${to.x} ${to.y}`, from, to };
}

/** An arrowhead as a filled triangle at `at`, pointing the way `dir` points. */
function head(at: { x: number; y: number }, dir: { x: number; y: number }, tone?: number): Prim {
  const len = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / len;
  const uy = dir.y / len;
  const bx = at.x - ux * ARROW_LEN;
  const by = at.y - uy * ARROW_LEN;
  const px = -uy * (ARROW_W / 2);
  const py = ux * (ARROW_W / 2);
  return {
    t: "poly",
    points: `${at.x},${at.y} ${bx + px},${by + py} ${bx - px},${by - py}`,
    cls: "sk-head",
    ...(tone !== undefined && { tone }),
  };
}

/** The direction a path arrives from, taken from the last two points of `d`. */
function tailDir(d: string): { x: number; y: number } {
  const nums = d.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
  if (nums.length < 4) return { x: 0, y: 1 };
  const n = nums.length;
  return {
    x: (nums[n - 2] as number) - (nums[n - 4] as number),
    y: (nums[n - 1] as number) - (nums[n - 3] as number),
  };
}

function headDir(d: string): { x: number; y: number } {
  const nums = d.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
  if (nums.length < 4) return { x: 0, y: -1 };
  return {
    x: (nums[0] as number) - (nums[2] as number),
    y: (nums[1] as number) - (nums[3] as number),
  };
}

/** An edge's drawn parts, split by what has to sit over the nodes. */
interface PaintedEdge {
  under: Prim[];
  over: Prim[];
}

/** A point on the drawn line at `t` ∈ [0,1] — the cubic where there is one. */
function alongPath(d: string, from: Pt, to: Pt, t: number): { x: number; y: number } {
  const n = d.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
  if (d.includes("C") && n.length >= 8) {
    const u = 1 - t;
    const at = (i: number) =>
      u * u * u * (n[i] as number) +
      3 * u * u * t * (n[i + 2] as number) +
      3 * u * t * t * (n[i + 4] as number) +
      t * t * t * (n[i + 6] as number);
    return { x: at(0), y: at(1) };
  }
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** Where the label sits, in preference order: the middle, then either side of it. */
const LABEL_STOPS = [0.5, 0.42, 0.58, 0.32, 0.68, 0.24, 0.76];

/**
 * **A place on the line where the label is not on top of a box.**
 *
 * Halfway along is right nearly always and wrong in the one case this feature
 * keeps producing: a long return edge swept round the margin, whose midpoint is
 * level with a row of nodes. The plate then knocks a hole in *their* text
 * instead of in the line, which is a worse bug than the one the plate fixed —
 * on the Noema essay it sat squarely over "Simulating a mind ≠ creating one".
 *
 * So the middle is a preference rather than a rule: walk outwards from it and
 * take the first spot clear of every node. If none is clear the middle is used
 * anyway, because a label somewhere beats no label, and this is the case a
 * person would solve by moving a box.
 */
function labelSpot(
  d: string,
  from: Pt,
  to: Pt,
  w: number,
  nodes: readonly SketchNode[],
): { x: number; y: number } {
  const clear = (p: { x: number; y: number }) =>
    !nodes.some(
      (n) =>
        p.x + w / 2 > n.x && p.x - w / 2 < n.x + n.w && p.y + 8 > n.y && p.y - 8 < n.y + n.h,
    );
  for (const t of LABEL_STOPS) {
    const p = alongPath(d, from, to, t);
    if (clear(p)) return p;
  }
  return alongPath(d, from, to, 0.5);
}

function paintEdge(
  edge: SketchEdge,
  nodes: Map<string, SketchNode>,
  height: number,
  all: readonly SketchNode[],
): PaintedEdge {
  const a = nodes.get(parseEnd(edge.from).id);
  const b = nodes.get(parseEnd(edge.to).id);
  // readSketch already dropped these; belt and braces.
  if (!a || !b) return { under: [], over: [] };
  const { d, from, to } = edgePath(edge, a, b, height);
  const tone = edge.tone;
  const out: Prim[] = [
    {
      t: "path",
      d,
      cls: cls("sk-edge", `sk-edge-${edge.line}`, edge.muted && "sk-muted"),
      ...(tone !== undefined && { tone }),
    },
  ];
  if (edge.arrow === "end" || edge.arrow === "both") out.push(head(to, tailDir(d), tone));
  if (edge.arrow === "start" || edge.arrow === "both") out.push(head(from, headDir(d), tone));
  /* **Over the nodes, not under them.** Edges are drawn first so a line never
     crosses a box it is not touching — but that put every edge *label* under
     the boxes too, and a long edge's midpoint is very often inside one. The
     label was rendered, correctly, invisibly. */
  const over: Prim[] = [];
  if (edge.label) {
    const w = edge.label.length * 10 * CHAR_W + 8;
    const mid = labelSpot(d, from, to, w, all);
    /* Clamped onto the canvas. A wrap-around edge's midpoint is out at the
       margin by design, which is exactly where half its label falls off the
       edge — and a label sliced down the middle reads as a rendering bug rather
       than as a label. */
    const mx = clamp(mid.x, w / 2 + 4, CANVAS_W - w / 2 - 4);
    const my = clamp(mid.y - 4, 12, 1e9);
    /* A plate the colour of the page, under the words. An edge's midpoint is
       very often inside a box — that is what a long edge does — and 10px of
       grey over a node's own label is two texts in the same place, neither
       readable. The plate is what makes the label a label rather than a smudge;
       the sinks paint it with the page's own ground so it reads as a gap in the
       line rather than as a shape. */
    over.push({
      t: "rect",
      x: mx - w / 2,
      y: my - 10,
      w,
      h: 14,
      rx: 3,
      cls: "sk-label-plate",
    });
    over.push({
      t: "text",
      x: mx,
      y: my,
      text: edge.label,
      px: 10,
      anchor: "middle",
      cls: "sk-edge-label",
      ...(tone !== undefined && { tone }),
    });
  }
  return { under: out, over };
}

function paintPath(p: SketchPath): Prim[] {
  const tone = p.tone;
  const out: Prim[] = [
    {
      t: "path",
      d: p.d,
      cls: cls("sk-free", p.fill ? "sk-free-fill" : `sk-edge-${p.line}`, p.muted && "sk-muted"),
      ...(tone !== undefined && { tone }),
    },
  ];
  /* **Both ends, not just the end.** `arrow: "start"` drew nothing at all and
     `"both"` drew one head, on a primitive whose whole purpose is the shapes an
     edge cannot make — a loop back, an arc between two moments. An arrow that
     silently does not appear is the picture claiming a direction it is not
     drawing. GPT Sol, 2026-08-30. */
  const nums = p.d.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
  const n = nums.length;
  if (!p.fill && n >= 4) {
    if (p.arrow === "end" || p.arrow === "both") {
      out.push(head({ x: nums[n - 2] as number, y: nums[n - 1] as number }, tailDir(p.d), tone));
    }
    if (p.arrow === "start" || p.arrow === "both") {
      out.push(head({ x: nums[0] as number, y: nums[1] as number }, headDir(p.d), tone));
    }
  }
  return out;
}

/** A region's panel (under the edges) and its label (over them). */
function paintRegion(r: SketchRegion): PaintedRegion {
  const tone = r.tone;
  const out: Prim[] = [];
  if (r.style === "bracket") {
    const k = 10;
    out.push({
      t: "path",
      d: `M${r.x + k} ${r.y} L${r.x} ${r.y} L${r.x} ${r.y + r.h} L${r.x + k} ${r.y + r.h}`,
      cls: "sk-bracket",
      ...(tone !== undefined && { tone }),
    });
  } else if (r.style !== "plain") {
    out.push({
      t: "rect",
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      rx: 8,
      /* **A region that opens something is drawn hotter than one that does
         not** — see `sk-region-opens` in styles.css for why this and not a
         second shape. */
      cls: cls("sk-region", `sk-region-${r.style}`, r.opens && "sk-region-opens"),
      ...(tone !== undefined && { tone }),
    });
  }
  if (!r.label) return { region: r, panel: out, label: [], hit: null };

  const px = 11;
  const label: Prim[] = [
    {
      t: "text",
      x: r.x + 10,
      y: r.y + 15,
      text: r.label,
      px,
      anchor: "start",
      cls: "sk-region-label",
      ...(tone !== undefined && { tone }),
    },
  ];
  /* **Estimated from the characters, like everything else that measures text
     here** — SVG will not tell us and `getBBox` needs a DOM this module does
     not have. The label is uppercased by the stylesheet and tracked out, so the
     estimate is generous rather than tight: a hit box a little wider than the
     words is a press that lands, and one a little narrower is a control that
     misses. Clamped to the region, so it can never reach past its own panel. */
  const textW = r.label.length * px * CHAR_W * 1.28;
  /* **The corner mark**, on the same diagonal as the Enlarge button's icon and
     for the same reason — two brackets pulling apart is what "there is a bigger
     version of this" looks like everywhere else in this app.

     **Beside the words, not out at the region's own corner**, and that is the
     whole of why it is here rather than twelve units from the right edge where
     it would look tidier. The press target is the label
     (`SketchRegion.opens` says why it is the name and never the panel), so a
     mark parked anywhere else is a thing that says "press me" and is not
     pressable — which is the exact failure this feature exists to fix, rebuilt
     one layer down. It sits inside the hit box below, because the hit box is
     measured to include it.

     It rides with the label rather than with the panel for the same reason the
     label does: the panel goes under the edges, and an edge drawn through the
     one mark that says a thing is pressable is the bug `front` already exists
     to prevent. */
  const markAt = r.x + 10 + textW + 5;
  if (r.opens && markAt + MARK < r.x + r.w - 4) {
    const my = r.y + 4;
    const k = 4.5;
    label.push({
      t: "path",
      d: `M${markAt} ${my + k} L${markAt} ${my} L${markAt + k} ${my} M${markAt + MARK - k} ${my + MARK} L${markAt + MARK} ${my + MARK} L${markAt + MARK} ${my + MARK - k}`,
      cls: "sk-region-more",
      ...(tone !== undefined && { tone }),
    });
  }
  const wide = Math.min(r.w - 6, textW + 18 + (r.opens ? MARK + 5 : 0));
  return {
    region: r,
    panel: out,
    label,
    hit: { x: r.x + 4, y: r.y + 2, w: Math.max(24, wide), h: px + 10 },
  };
}

/* --------------------------------------------------- the peek and the zoom */

/** A rectangle in canvas units. The one currency the zoom and the peek share. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How much of the peek's own area the ghost keeps clear, in canvas units. */
const PEEK_PAD = 8;

/**
 * The strip along the top of a region the peek must not cover — the region's
 * own name, which is the control that summoned it.
 */
export const PEEK_LABEL_STRIP = 18;

/**
 * How far the peek may grow past the region it belongs to, as a multiple of
 * what the region itself offers, and in absolute canvas units.
 *
 * **Why it grows at all.** A region is landscape — 700 wide by 180 — and the
 * scene it opens is portrait, 760 by 650. Fitted into the region, the ghost is
 * limited by height and uses 175 of the 684 units of width available to it: it
 * comes out a quarter of the size the space could hold, for no reason but the
 * shape mismatch. A browser pass on the real drawing, 2026-08-31, and its
 * diagnosis is the reason this exists rather than a stronger scrim:
 *
 * > It is not the scrim … and not line thinness … It is the **ghost being too
 * > small** — the region itself is only a fraction of the band's height, and
 * > the peek is nested inside that already-small space.
 *
 * **Downward only, and capped.** Downward, because the region's name lives
 * along its top and growing up would cover the very thing being hovered.
 * Capped, because a peek that expanded to whatever the scene wanted would be a
 * 600-unit panel dropped over the middle of the picture — a popover, which is a
 * different feature and a heavier one than a hover deserves.
 */
const PEEK_GROW = { times: 2, max: 300 };

/**
 * **Where a ghost of the scene a region opens goes, inside that region** —
 * the area to veil, and the viewport to draw into.
 *
 * The overview's brighter edge and corner mark say a part opens *something*;
 * this says *what*. Greg's example for the whole feature was three arguments
 * that converge, and a converging funnel is recognisable at thumbnail size when
 * the words in it are not.
 *
 * All this decides is two rectangles, and that is the point. **The picture
 * drawn into `port` is the real `paintScene` output of the real scene**, put in
 * a nested SVG viewport that scales and clips it — so the shapes are the
 * model's shapes, the edges are routed the way `edgePath` routes them, the
 * arrowheads point where they point and the regions inside are still there.
 * Only the text is dropped, by the stylesheet, because it is the one thing that
 * cannot survive the scale.
 *
 * The first version of this was a second, simplified painter: rounded rects for
 * every node whatever its shape, straight centre-to-centre hairlines for every
 * edge. GPT Sol, 2026-08-30, and the objection is the one this whole feature is
 * built around — *"That is not a literal thumbnail"*. It threw away the diamond
 * that opens one of the real zoom scenes, the two bands that make another read
 * as parallel tracks, and the dashes that separate a worked example from the
 * main convergence; and its straight lines crossed boxes they had nothing to do
 * with, inventing junctions. A picture that asserts more than the article does
 * is the failure docs/project/diagram.md § The shapes make claims already
 * records twice, and a second painter is a second answer to the question this
 * file exists to be the only answer to.
 *
 * `null` when there is no room to draw anything, which is a normal outcome for
 * a thin region and not a failure.
 */
export function peekViewport(
  box: Box,
  sceneHeight: number,
  canvasHeight: number,
): { scrim: Box; port: Box } | null {
  const top = box.y + PEEK_LABEL_STRIP;
  const natural = box.y + box.h - top;
  const innerW = box.w - PEEK_PAD * 2;
  if (!(innerW > 0) || !(natural > 0)) return null;

  /* The height at which the ghost would use the whole width it has — which is
     what the region cannot give it, being the wrong way round. */
  const wants = sceneHeight > 0 ? (innerW * sceneHeight) / CANVAS_W + PEEK_PAD * 2 : natural;
  const room = Math.max(0, canvasHeight - 4 - top);
  const h = clamp(wants, natural, Math.min(natural * PEEK_GROW.times, PEEK_GROW.max, room || natural));

  const scrim = { x: box.x, y: top, w: box.w, h };
  const port = {
    x: scrim.x + PEEK_PAD,
    y: scrim.y + PEEK_PAD,
    w: scrim.w - PEEK_PAD * 2,
    h: scrim.h - PEEK_PAD * 2,
  };
  return port.w > 0 && port.h > 0 ? { scrim, port } : null;
}

/**
 * The transform a zoom runs from, as a scale and where to put it.
 *
 * `s` is how big the zoom scene is at the moment it appears — a fraction — and
 * `tx`/`ty` are where its top-left corner sits then, all in the **overview's**
 * canvas units. One pair of numbers serves both directions, which is what makes
 * going out the mirror of going in rather than another animation that happens
 * to point the other way.
 */
export interface ZoomAnchor {
  tx: number;
  ty: number;
  s: number;
}

/**
 * **Both scenes are `CANVAS_W` wide** and the SVG is `width: 100%` with
 * `preserveAspectRatio`, so one canvas unit is the same number of pixels in
 * every scene of a sketch. That is what lets a box measured in the overview
 * mean something in the scene it opens, and it is the assumption the whole
 * animation rests on: give a scene its own width and this becomes decoration
 * that lies about where things came from.
 */
const ZOOM_MIN_S = 0.12;
const ZOOM_MAX_S = 0.9;

/**
 * **Where the incoming scene starts, given the box the reader pressed.**
 *
 * *Contain, centred on the box* — the whole of the new picture, shrunk to sit
 * inside the thing that was under the finger, then grown to full size. Not
 * "the box's footprint exactly": a region is often nearly the canvas's width
 * and a fifth of its height, so matching its footprint would be a 94% scale in
 * one axis and no visible zoom at all. Fitting the whole picture into it is a
 * real zoom, and it is honest in the way that matters — everything you are
 * about to see appears where you pressed.
 *
 * `null` when there is nothing to anchor to, or when the zoom would be too
 * slight to be worth animating. Both mean *fall back to a plain fade*, which
 * is a normal outcome and not a failure: pressing a chip in the scene row means
 * "show me that part", not "zoom into this box".
 */
export function zoomAnchor(box: Box, sceneHeight: number): ZoomAnchor | null {
  if (!(box.w > 0) || !(box.h > 0) || !(sceneHeight > 0)) return null;
  const s = Math.min(box.w / CANVAS_W, box.h / sceneHeight);
  /* **Out of range in either direction is a decline, not a clamp**, and the
     lower end was a clamp until GPT Sol read it, 2026-08-30. `Math.max(0.12, s)`
     looks like a floor on how dramatic the swoop may be, and it is really a
     licence to break the one promise this function makes: a 150x60 node opening
     a 650-unit scene has `s = 0.092`, and rounding that up to 0.12 starts the
     scene 78 units tall inside a box 60 units tall. It hangs out of the thing
     the reader pressed, which makes *everything you are about to see appears
     where you pressed* quietly false. And the test guarding it passed **because
     of** the bug: it asked only that `s` never go below 0.12.

     So both ends decline: too large is not a zoom worth animating, too small is
     a zoom this cannot contain. Both mean the plain fade, which is an ordinary
     outcome and not a failure. */
  if (!(s >= ZOOM_MIN_S) || s >= ZOOM_MAX_S) return null;
  return {
    tx: box.x + box.w / 2 - (CANVAS_W * s) / 2,
    ty: box.y + box.h / 2 - (sceneHeight * s) / 2,
    s,
  };
}

/**
 * The CSS transform an entrance animates **from**, in canvas units — `px` on an
 * SVG child means user units, and a `<g>` resolves its `transform-origin`
 * against the viewBox, so `0 0` is the canvas's own corner.
 *
 * Going **in**, the zoom scene starts inside the box and grows. Going **out**,
 * the overview starts at the exact inverse — magnified about the same box, so
 * the part the reader was just in fills the frame — and pulls back to itself.
 * With `shiftY` at 0 the two compose to the identity, which is the property that
 * makes one read as the undoing of the other, and `tests/sketch-paint.test.ts`
 * checks it rather than trusting the algebra.
 *
 * ## `shiftY` is a parameter, and it must not be folded into the anchor
 *
 * It is the scroll correction — how far the picture's own scroll moved across
 * the swap, in canvas units, measured by SketchView.tsx. **It applies after the
 * inverse, not before it**, and folding it into `ty` before the call was a real
 * bug: for `"out"` that sends it through the magnification and flips its sign,
 * so a correction of +250 units arrived as -900. On the first real region —
 * `s = 0.277` — a Back after 100px of scroll gave -1444 where -292 was right,
 * and the overview entered from far above the region it was meant to be pulling
 * out of. GPT Sol, 2026-08-30, with the arithmetic; it reproduces exactly. The
 * two directions genuinely need it on different sides of the scale, which is
 * why the caller cannot apply it itself.
 */
export function anchorTransform(a: ZoomAnchor, dir: "in" | "out", shiftY = 0): string {
  if (dir === "in") return `translate(${a.tx}px, ${a.ty + shiftY}px) scale(${a.s})`;
  const k = 1 / a.s;
  return `translate(${-a.tx * k}px, ${-a.ty * k + shiftY}px) scale(${k})`;
}

function paintLabel(l: SketchLabel): Prim[] {
  const px = SIZE_PX[l.size];
  /* **The room a label has is on the side the text runs towards.** This asked
     for the distance to the RIGHT edge whatever the alignment, so an
     end-aligned label near the left margin — text running leftwards from its
     anchor — was told it had almost the whole canvas and wrapped to one very
     long line off the left of the picture. GPT Sol, 2026-08-30. */
  const width =
    l.align === "middle"
      ? Math.min(l.x, CANVAS_W - l.x) * 2
      : l.align === "end"
        ? l.x - 8
        : CANVAS_W - l.x - 8;
  const lines = wrap(l.text, Math.max(1, Math.floor((Math.max(60, width) - 10) / (px * CHAR_W))), 4);
  const tone = l.tone;
  return lines.map((line, i) => ({
    t: "text" as const,
    x: l.x,
    y: l.y + i * px * LINE_H,
    text: line,
    px,
    anchor: l.align,
    cls: cls("sk-label", `sk-label-${l.size}`, l.muted && "sk-muted"),
    ...(tone !== undefined && { tone }),
  }));
}

/**
 * **One scene, painted.** Pure: same input, same numbers, no DOM, no clock.
 */
export function paintScene(scene: SketchScene): Painted {
  const nodes = scene.items.filter((i): i is SketchNode => i.kind === "node");
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const behind: Prim[] = [];
  const links: Prim[] = [];
  const front: Prim[] = [];
  const regions: PaintedRegion[] = [];

  for (const item of scene.items) {
    if (item.kind === "region") {
      const painted = paintRegion(item);
      regions.push(painted);
      behind.push(...painted.panel);
      /* The label's primitives are NOT pushed to `front` when the region opens
         a scene: the panel renders those inside a pressable group of their own,
         and having them in both places would draw the words twice — once
         inert, once live, a hair apart. */
      if (!item.opens) front.push(...painted.label);
    }
    else if (item.kind === "edge") {
      const painted = paintEdge(item, byId, scene.height, nodes);
      links.push(...painted.under);
      front.push(...painted.over);
    }
    else if (item.kind === "path") links.push(...paintPath(item));
    else if (item.kind === "label") front.push(...paintLabel(item));
  }

  return {
    width: CANVAS_W,
    height: scene.height,
    behind,
    links,
    regions,
    nodes: nodes.map((node) => ({
      node,
      prims: [...shapePrims(node), ...textPrims(node)],
      hit: { x: node.x, y: node.y, w: node.w, h: node.h },
    })),
    front,
  };
}

/* `wrap` lives in sketch-scene.ts, beside the `nodeFits` that has to agree with
   it. Re-exported here because this is the module about drawing, and a caller
   that wants to lay text out looks here first. */
export { wrap };
