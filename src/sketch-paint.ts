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
  charsThatFit,
  LINE_H,
  linesInBox,
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

export interface Painted {
  width: number;
  height: number;
  /** Regions. Drawn first so everything sits on them. */
  behind: Prim[];
  /** Edges, free paths and edge labels. Under the nodes, over the regions. */
  links: Prim[];
  nodes: PaintedNode[];
  /** Free labels. Over everything, because they are captions on the whole. */
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
  const px = SIZE_PX[n.size];
  const subPx = Math.max(9, px * 0.76);
  /* **`linesInBox` and `charsThatFit` are the same two functions `nodeFits`
     uses**, which is the point of them living in sketch-scene.ts. They used to
     be two implementations — one here deciding what gets drawn, one there
     deciding whether it fits — and they disagreed: a 60×20 node holding one
     long word scored as fitting and rendered as `superc…`. A measure and the
     thing it measures cannot be two pieces of arithmetic. GPT Sol, 2026-08-30. */
  const maxLines = linesInBox(n);
  const lines = wrap(n.text, charsThatFit(n.w, n.size), maxLines);
  const subH = n.sub ? subPx * 1.3 : 0;
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
  if (n.sub) {
    prims.push({
      t: "text",
      x: cx,
      y: baseline + subPx * 0.15,
      text: wrap(n.sub, Math.max(1, Math.floor((n.w - 10) / (subPx * CHAR_W))), 1)[0] ?? "",
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

function paintRegion(r: SketchRegion): Prim[] {
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
      cls: cls("sk-region", `sk-region-${r.style}`),
      ...(tone !== undefined && { tone }),
    });
  }
  if (r.label) {
    out.push({
      t: "text",
      x: r.x + 10,
      y: r.y + 15,
      text: r.label,
      px: 11,
      anchor: "start",
      cls: "sk-region-label",
      ...(tone !== undefined && { tone }),
    });
  }
  return out;
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

  for (const item of scene.items) {
    if (item.kind === "region") behind.push(...paintRegion(item));
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
