/**
 * **Sketch — the picture a model draws of the argument, and the vocabulary it
 * is allowed to draw in.**
 *
 * The other four diagrams (docs/project/diagram.md) each answer one question
 * with one algorithm: containment, physics, projection. This one has no
 * algorithm. A model reads the article and *decides* what shape it is — three
 * columns that converge, a hub with satellites, a ladder, a funnel — and lays
 * it out itself.
 *
 * ## Why a scene, and not SVG
 *
 * The obvious version is to ask for SVG and put it on the page. That was
 * already rejected once, for reasons that have not changed
 * (diagram.md § What is deliberately not here):
 *
 *  - **An image of a structure cannot be checked against the structure.** A
 *    picture that puts section 4 inside section 3 renders perfectly.
 *  - Model-authored markup in the DOM is the one thing security.md is about,
 *    and it is why there is no Mermaid here.
 *  - Colours, type and dark ground belong to design-css-overview.md, not to
 *    whatever the model happened to like.
 *
 * A **scene** keeps all the freedom that matters and none of that. The model
 * chooses every position, every shape, every grouping and every line — the
 * layout really is entirely its own — but it says so in five primitives with
 * numbers in them, and numbers can be checked. `readSketch` below drops what
 * is unreachable, clamps what is off-canvas, and *measures* the rest: whether
 * the flow still runs down the page, how much of the article it reaches, how
 * much of it overlaps itself. That measurement is the whole difference between
 * this and a generated image, and it is what a prompt can be iterated against.
 *
 * ## The five primitives
 *
 *   node    a shape with words in it — the only thing that can be clicked
 *   region  a labelled area behind the nodes: a column, a phase, a group
 *   edge    a connector between two nodes, by id, routed by the renderer
 *   path    a free path (`d`) for what edges cannot say: a funnel, an arc, a loop
 *   label   free text that belongs to no node
 *
 * Anything drawable as a diagram of an argument is some arrangement of those.
 *
 * ## Coordinates
 *
 * One fixed canvas width (`CANVAS_W`) and a height the model picks, so the
 * renderer can scale the whole thing to whatever room it has by `viewBox`
 * alone. The model is told the width in the prompt and nothing else about the
 * device.
 *
 * Pure: `types.js` and `ids.js` and no other import, ever — it is on the client
 * allowlist in tests/client-imports.test.ts.
 */
import { isSpideryarnId } from "./ids.js";
import type { BlockId } from "./types.js";

export const SKETCH_VERSION = "sketch/1";

/**
 * The canvas the model draws on, in its own units.
 *
 * 760 rather than the band's 288, because the model should lay out for a shape
 * it can fill rather than for a strip: the renderer scales, and a picture
 * designed at 288 is a picture designed as a list. What the reader sees in the
 * band is a thumbnail with an enlarge button, the same affordance a figure in
 * the article already gets (src/web/zoomable.ts).
 */
export const CANVAS_W = 760;
export const MIN_CANVAS_H = 200;
export const MAX_CANVAS_H = 2400;

/** How small a node may be and still hold a word. Below this it is a dot. */
const MIN_NODE = 8;

/**
 * How far off the canvas a shape may stray and still be pulled back in.
 *
 * The line between "the model's arithmetic was a little out" and "the model put
 * this somewhere else entirely". Inside it, clamp; outside it, drop and count.
 */
const OFF_CANVAS_TOLERANCE = 200;

export type SketchShape = "box" | "pill" | "ellipse" | "diamond" | "hex" | "note" | "bare";
export type SketchLine = "solid" | "dashed" | "dotted";
export type SketchArrow = "none" | "end" | "start" | "both";
export type SketchSize = "xs" | "sm" | "md" | "lg";
export type SketchRegionStyle = "band" | "dashed" | "bracket" | "plain";

const SHAPES: readonly SketchShape[] = ["box", "pill", "ellipse", "diamond", "hex", "note", "bare"];
const LINES: readonly SketchLine[] = ["solid", "dashed", "dotted"];
const ARROWS: readonly SketchArrow[] = ["none", "end", "start", "both"];
const SIZES: readonly SketchSize[] = ["xs", "sm", "md", "lg"];
const REGION_STYLES: readonly SketchRegionStyle[] = ["band", "dashed", "bracket", "plain"];

/**
 * The type scale, in canvas units.
 *
 * The renderer wraps text by counting characters (the same trick and the same
 * hazard as `wrapText` in src/web/diagram.ts § Two things that are wrong in a
 * way you cannot see), so these numbers and the stylesheet's font stack share a
 * secret. `CHAR_W` is the number to move if the family changes.
 */
export const SIZE_PX: Record<SketchSize, number> = { xs: 10, sm: 12, md: 15, lg: 20 };
export const CHAR_W = 0.53;
export const LINE_H = 1.25;

/** How many positional hues there are. Same eight the searches and the tree use. */
export const TONES = 8;

interface Toned {
  /** 0–7, a positional hue; absent means the neutral ink. Grouping, never meaning. */
  tone?: number;
  /** Step back: this is context rather than content. */
  muted?: boolean;
}

export interface SketchNode extends Toned {
  kind: "node";
  id: string;
  shape: SketchShape;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  /** A second, smaller line under the text — a count, a qualifier, a name. */
  sub?: string;
  size: SketchSize;
  /** Click jumps the article here. Validated against the article's own ids. */
  block?: BlockId;
  /** Click zooms into this scene instead. Validated against `scenes`. */
  opens?: string;
  /** A sentence for the footer card. Never drawn inside the shape. */
  detail?: string;
}

export interface SketchRegion extends Toned {
  kind: "region";
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  style: SketchRegionStyle;
  /**
   * A scene this region's **label** opens — validated against `scenes`, exactly
   * as a node's `opens` is.
   *
   * > add a way to click on the subsection (e.g. "Why we're tempted to see it")
   * > that takes to the relevant subdiagram
   * >
   * > — Greg, 2026-08-30
   *
   * A region is already the overview's own statement that these boxes are one
   * movement of the piece, and a zoom scene is that movement drawn larger — so
   * the region is the most natural handle there is, and the reader is pointing
   * at exactly the thing they want more of.
   *
   * **The label is the target, not the panel.** A region is a large area lying
   * *behind* the nodes; making the whole of it clickable would put a second
   * meaning on every pixel between the boxes, and a press that landed a few
   * pixels off a node would silently do something entirely different.
   */
  opens?: string;
  /**
   * This `opens` was **derived from the blocks, not written by the model** —
   * see `inferRegionOpens`. Never read from the input, only ever set by
   * `readSketch`, and the reason `score.inferred` exists: the door works, so
   * the reader is not short of anything, but a prompt that has quietly stopped
   * asking for `opens` must not be able to hide behind our arithmetic.
   */
  opensInferred?: true;
}

export interface SketchEdge extends Toned {
  kind: "edge";
  /** A node id, optionally with a side: `"n3"`, `"n3:bottom"`, `"n3:left"`. */
  from: string;
  to: string;
  via: "straight" | "elbow" | "curve";
  line: SketchLine;
  arrow: SketchArrow;
  label?: string;
}

export interface SketchPath extends Toned {
  kind: "path";
  /** Absolute M/L/C/Q/A/Z only — see `cleanPath`. */
  d: string;
  line: SketchLine;
  arrow: SketchArrow;
  /** Fill it as a wash rather than stroking it — for a funnel or a lozenge. */
  fill: boolean;
}

export interface SketchLabel extends Toned {
  kind: "label";
  x: number;
  y: number;
  text: string;
  size: SketchSize;
  align: "start" | "middle" | "end";
}

export type SketchItem = SketchNode | SketchRegion | SketchEdge | SketchPath | SketchLabel;

export interface SketchScene {
  id: string;
  title: string;
  /** One sentence saying what this arrangement claims. Shown above the picture. */
  caption?: string;
  height: number;
  items: SketchItem[];
}

export interface Sketch {
  version: string;
  generator?: string;
  slug?: string;
  /**
   * The blocks and the section boundaries this was drawn against, together —
   * `hashBlocks(blocks).structureHash(tree)`, the same pair `ideas` uses. Both
   * halves matter: the prompt shows the model the tree, so re-cutting the
   * sections changes the question with every block byte-identical.
   */
  sourceHash?: string;
  /**
   * Who it was drawn for. **Three states, and they are not two**: absent means
   * an artefact from before this field existed, `null` means it was drawn with
   * no profile, and a hash means it was drawn for that reader. Same contract as
   * `Summaries.profileHash` — src/types.ts has the table.
   */
  profileHash?: string | null;
  /** A name for the shape, not for the article: "Four arguments, one conclusion". */
  title: string;
  caption: string;
  /** `scenes[0]` is the overview; the rest are what a node's `opens` reaches. */
  scenes: SketchScene[];
}

/* ------------------------------------------------------------------ reading */

/** One thing that was wrong, kept so a run can be read rather than trusted. */
export interface SketchFault {
  /** `scene:index` or a node id — enough to find it in the raw JSON. */
  where: string;
  /** What was dropped or changed, in the words a person would use. */
  what: string;
}

export interface SketchReport {
  faults: SketchFault[];
  /** Items the model wrote, and items that survived. */
  written: number;
  kept: number;
  /** Region→scene links `inferRegionOpens` had to work out for itself. */
  inferred: number;
}

export interface ReadOptions {
  /**
   * Every block id the article has, **in document order**. Used twice: to reject
   * a `block` the article does not contain, and to score whether the picture
   * still runs down the page.
   */
  blockOrder: readonly BlockId[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * One of a fixed set, or the fallback — **and it says when it fell back.**
 *
 * It used to fall back silently, which made this file's own promise ("an item
 * survives intact or it is dropped and counted") false for every enum on every
 * primitive. A model that has started writing `"shape": "trapezoid"` on half
 * its nodes produces a picture of plain boxes and a fault list of length zero,
 * which is indistinguishable from a model that asked for plain boxes. GPT Sol,
 * 2026-08-30. Still a fallback rather than a drop — a node with an unfamiliar
 * shape is a node, and dropping it leaves a hole — but the count is what makes
 * the drift visible in a run.
 */
function oneOf<T extends string>(
  v: unknown,
  allowed: readonly T[],
  fallback: T,
  onFallback?: (saw: string) => void,
): T {
  const s = str(v);
  if ((allowed as readonly string[]).includes(s)) return s as T;
  if (s && onFallback) onFallback(s);
  return fallback;
}

function tone(v: unknown): number | undefined {
  const n = num(v);
  if (n === null) return undefined;
  const i = Math.round(n);
  return i >= 0 && i < TONES ? i : undefined;
}

/**
 * **A path with only the commands we are willing to draw.**
 *
 * `d` is the one place the model writes something the renderer passes through
 * more or less as it stands, so it is the one place a check is not optional.
 * The allowed alphabet is absolute M, L, C, Q, A, Z and numbers — no relative
 * commands (they compound, so one bad number moves everything after it off
 * canvas), and nothing that is not a path command at all.
 *
 * Returns `null` for anything that does not parse cleanly, rather than trying
 * to repair it: a half-understood path draws a confident wrong line, which is
 * the failure this whole file exists to avoid.
 */
export function cleanPath(d: unknown): string | null {
  const raw = str(d);
  if (!raw || raw.length > 4000) return null;
  /* **Case-sensitive, and it was not.** The `/i` flag here and on the two
     regexes below let `l`, `c`, `q`, `a` and `z` — the *relative* commands —
     straight through, while the comment above said they were refused. The
     regexes had been written case-insensitively out of habit and the whole
     guarantee this function exists for was gone, silently, for every path a
     model chose to write in lower case. Caught by the test, not by reading.
     No exponent form either: `1e5` is a number no model needs to write here
     and one more thing to have an opinion about. */
  if (!/^[MLCQAZ\s\-.,0-9]+$/.test(raw)) return null;
  if (!/^\s*M/.test(raw)) return null;
  /* **Every command gets the right number of arguments**, which the alphabet
     check above cannot tell you anything about. `M10 10 L100` passes a
     character-class test and is a path with a dangling `L`: browsers vary
     between ignoring the command and ignoring the rest of the path, so it draws
     something plausible and different in different places. The alphabet stops
     injection; this stops confidently wrong geometry. GPT Sol, 2026-08-30.

     A command may repeat its argument group — `L10 10 20 20` is two lines — so
     the count has to be a positive multiple, not an equality. */
  const ARITY: Record<string, number> = { M: 2, L: 2, C: 6, Q: 4, A: 7, Z: 0 };
  const parts = raw.split(/([MLCQAZ])/).map((t) => t.trim());
  let command: string | null = null;
  for (const tok of parts) {
    if (!tok) {
      continue;
    }
    if (/^[MLCQAZ]$/.test(tok)) {
      // A command with arguments due but none written before the next command.
      if (command && (ARITY[command] as number) > 0) return null;
      command = tok;
      if (tok === "Z") command = null;
      continue;
    }
    if (!command) return null; // numbers before any command
    const nums = tok.split(/[\s,]+/).filter(Boolean);
    for (const n of nums) if (!Number.isFinite(Number(n))) return null;
    const arity = ARITY[command] as number;
    if (arity === 0 || nums.length === 0 || nums.length % arity !== 0) return null;
    command = null;
  }
  // A trailing command still waiting for its arguments.
  if (command && (ARITY[command] as number) > 0) return null;
  return raw;
}

function readNode(
  raw: Record<string, unknown>,
  h: number,
  blocks: Set<BlockId>,
  faults: SketchFault[],
  where: string,
): SketchNode | null {
  const id = str(raw.id);
  if (!id) {
    faults.push({ where, what: "node with no id" });
    return null;
  }
  const x = num(raw.x);
  const y = num(raw.y);
  const w = num(raw.w);
  const hh = num(raw.h);
  if (x === null || y === null || w === null || hh === null) {
    faults.push({ where: id, what: "node with a missing or non-numeric coordinate" });
    return null;
  }
  const text = str(raw.text);
  if (!text) {
    /* A shape with nothing in it says nothing and cannot be clicked usefully.
       It is not a rounding error, so it is dropped rather than clamped. */
    faults.push({ where: id, what: "node with no text" });
    return null;
  }

  /* **Clamped, but only within a tolerance.** A box that runs 20 units past
     the edge is a picture with a rounding error in it, and deleting it leaves a
     hole, which is the thing the reader notices. A box at x = -1,000,000 is not
     a rounding error — clamping that produces a confident rectangle in the top
     left corner standing for something the model put somewhere else entirely.
     GPT Sol's finding: clamping is right for a near miss and wrong as an
     acceptance rule. */
  if (
    x < -OFF_CANVAS_TOLERANCE ||
    y < -OFF_CANVAS_TOLERANCE ||
    x > CANVAS_W + OFF_CANVAS_TOLERANCE ||
    y > h + OFF_CANVAS_TOLERANCE ||
    w <= 0 ||
    hh <= 0
  ) {
    faults.push({ where: id, what: `node at (${x},${y}) ${w}×${hh} is not on this canvas` });
    return null;
  }
  const cx = Math.max(0, Math.min(CANVAS_W - MIN_NODE, x));
  const cy = Math.max(0, Math.min(h - MIN_NODE, y));
  const cw = Math.max(MIN_NODE, Math.min(CANVAS_W - cx, w));
  const ch = Math.max(MIN_NODE, Math.min(h - cy, hh));
  if (cx !== x || cy !== y || cw !== w || ch !== hh) {
    faults.push({ where: id, what: `off canvas, clamped (${x},${y} ${w}×${hh})` });
  }

  const odd = (field: string) => (saw: string) =>
    faults.push({ where: id, what: `${field} "${saw}" is not one we draw — using the default` });
  const node: SketchNode = {
    kind: "node",
    id,
    shape: oneOf(raw.shape, SHAPES, "box", odd("shape")),
    x: cx,
    y: cy,
    w: cw,
    h: ch,
    text,
    size: oneOf(raw.size, SIZES, "sm", odd("size")),
  };
  const sub = str(raw.sub);
  if (sub) node.sub = sub;
  const detail = str(raw.detail);
  if (detail) node.detail = detail;
  const t = tone(raw.tone);
  if (t !== undefined) node.tone = t;
  if (raw.muted === true) node.muted = true;

  const block = str(raw.block);
  if (block) {
    /* A `block` the article does not have costs the node its click, not its
       existence — and it is counted, because "the model invented an id" and
       "the model chose not to link this one" look identical on screen. */
    if (isSpideryarnId(block) && blocks.has(block)) node.block = block;
    else faults.push({ where: id, what: `block ${block} is not in this article — no jump` });
  }
  const opens = str(raw.opens);
  if (opens) node.opens = opens; // resolved against the scene list by the caller

  return node;
}

/**
 * The four readers that are not `readNode`, one per primitive.
 *
 * They were four branches of one `readItem`, which is the shape that reads
 * naturally and the shape a linter is right about: each branch has its own
 * required fields, its own faults and its own defaulting, and they share
 * nothing but the fault list. Split so each can be read on its own.
 */
function readRegion(
  raw: Record<string, unknown>,
  h: number,
  faults: SketchFault[],
  where: string,
): SketchRegion | null {
  const x = num(raw.x);
  const y = num(raw.y);
  const w = num(raw.w);
  const hh = num(raw.h);
  if (x === null || y === null || w === null || hh === null) {
    faults.push({ where, what: "region with a missing coordinate" });
    return null;
  }
  /* **The far edge, not each number on its own.** Clamping `x` to the canvas
     and `w` to the canvas independently lets `x = 750, w = 100` through on a
     760-wide canvas: both numbers are legal and their sum is not, and a region
     90 units past the right edge draws a band that runs off the picture with no
     fault recorded. GPT Sol, 2026-08-30 — the same mistake the node reader had
     already been fixed for. */
  const rx = Math.max(0, Math.min(CANVAS_W - 1, x));
  const ry = Math.max(0, Math.min(h - 1, y));
  const region: SketchRegion = {
    kind: "region",
    x: rx,
    y: ry,
    w: Math.max(1, Math.min(CANVAS_W - rx, w)),
    h: Math.max(1, Math.min(h - ry, hh)),
    style: oneOf(raw.style, REGION_STYLES, "band", (saw) =>
      faults.push({ where, what: `region style "${saw}" is not one we draw` }),
    ),
  };
  const label = str(raw.label);
  if (label) region.label = label;
  const opens = str(raw.opens);
  /* Resolved against the scene list by the caller, like a node's. **A region
     with an `opens` and no label has nothing to press**, so the pointer goes
     rather than being left on an invisible target — which would be worse than
     no pointer at all, because the scene would then count as reachable. */
  if (opens && label) region.opens = opens;
  else if (opens) {
    faults.push({ where, what: "a region opens a scene but has no label to press" });
  }
  const t = tone(raw.tone);
  if (t !== undefined) region.tone = t;
  if (raw.muted === true) region.muted = true;
  return region;
}

function readEdge(
  raw: Record<string, unknown>,
  faults: SketchFault[],
  where: string,
): SketchEdge | null {
  const from = str(raw.from);
  const to = str(raw.to);
  if (!from || !to) {
    faults.push({ where, what: "edge with no end" });
    return null;
  }
  if (from.split(":")[0] === to.split(":")[0]) {
    /* A self-edge is routed through its own node and comes out as a stub mostly
       hidden under it — a line that says nothing and looks like a rendering
       fault. Nothing in an argument map means "this depends on itself".
       GPT Sol, 2026-08-30. */
    faults.push({ where, what: `edge from ${from} to itself` });
    return null;
  }
  const edge: SketchEdge = {
    kind: "edge",
    from,
    to,
    via: oneOf(raw.via, ["straight", "elbow", "curve"] as const, "straight"),
    line: oneOf(raw.line, LINES, "solid"),
    arrow: oneOf(raw.arrow, ARROWS, "end"),
  };
  const label = str(raw.label);
  if (label) edge.label = label;
  const t = tone(raw.tone);
  if (t !== undefined) edge.tone = t;
  if (raw.muted === true) edge.muted = true;
  return edge;
}

function readPath(
  raw: Record<string, unknown>,
  faults: SketchFault[],
  where: string,
): SketchPath | null {
  const d = cleanPath(raw.d);
  if (!d) {
    faults.push({ where, what: "path with a `d` we will not draw" });
    return null;
  }
  const path: SketchPath = {
    kind: "path",
    d,
    line: oneOf(raw.line, LINES, "solid"),
    arrow: oneOf(raw.arrow, ARROWS, "none"),
    fill: raw.fill === true,
  };
  const t = tone(raw.tone);
  if (t !== undefined) path.tone = t;
  if (raw.muted === true) path.muted = true;
  return path;
}

function readLabel(
  raw: Record<string, unknown>,
  h: number,
  faults: SketchFault[],
  where: string,
): SketchLabel | null {
  const x = num(raw.x);
  const y = num(raw.y);
  const text = str(raw.text);
  if (x === null || y === null || !text) {
    faults.push({ where, what: "label with no position or no text" });
    return null;
  }
  const label: SketchLabel = {
    kind: "label",
    x: Math.max(0, Math.min(CANVAS_W, x)),
    y: Math.max(0, Math.min(h, y)),
    text,
    size: oneOf(raw.size, SIZES, "sm"),
    align: oneOf(raw.align, ["start", "middle", "end"] as const, "start"),
  };
  const t = tone(raw.tone);
  if (t !== undefined) label.tone = t;
  if (raw.muted === true) label.muted = true;
  return label;
}

/** Whichever of the five this is, or `null` with a fault saying why not. */
function readItem(
  raw: unknown,
  h: number,
  blocks: Set<BlockId>,
  faults: SketchFault[],
  where: string,
): SketchItem | null {
  if (!isObj(raw)) {
    faults.push({ where, what: "item is not an object" });
    return null;
  }
  switch (str(raw.kind)) {
    case "node":
      return readNode(raw, h, blocks, faults, where);
    case "region":
      return readRegion(raw, h, faults, where);
    case "edge":
      return readEdge(raw, faults, where);
    case "path":
      return readPath(raw, faults, where);
    case "label":
      return readLabel(raw, h, faults, where);
    default:
      faults.push({ where, what: `unknown kind "${str(raw.kind)}"` });
      return null;
  }
}

/**
 * **Read what the model sent and hand back only what can be drawn.**
 *
 * Never throws on a malformed item and never repairs one into something
 * plausible: an item either survives intact or is dropped and counted. The
 * count is the point — `report.faults` is what says whether a prompt is
 * working, and a validator that quietly patched things would report a clean run
 * on a model that cannot follow the schema (docs/reusable/silent-success.md).
 */
export function readSketch(
  raw: unknown,
  opts: ReadOptions,
): { sketch: Sketch; report: SketchReport } {
  const faults: SketchFault[] = [];
  const blocks = new Set(opts.blockOrder);
  let written = 0;

  if (!isObj(raw)) {
    return {
      sketch: { version: SKETCH_VERSION, title: "", caption: "", scenes: [] },
      report: {
        faults: [{ where: "root", what: "not an object" }],
        written: 0,
        kept: 0,
        inferred: 0,
      },
    };
  }

  const rawScenes = Array.isArray(raw.scenes) ? raw.scenes : [];
  const scenes: SketchScene[] = [];

  for (const [i, rs] of rawScenes.entries()) {
    if (!isObj(rs)) {
      faults.push({ where: `scene ${i}`, what: "not an object" });
      continue;
    }
    const id = str(rs.id) || (i === 0 ? "overview" : `scene${i}`);
    const h = Math.max(MIN_CANVAS_H, Math.min(MAX_CANVAS_H, num(rs.height) ?? 600));
    const rawItems = Array.isArray(rs.items) ? rs.items : [];
    written += rawItems.length;

    const items: SketchItem[] = [];
    /* **Two nodes with one id is not a duplicate node, it is an ambiguous
       edge.** Every edge names its ends by id, so a repeated id silently makes
       one of the two unreachable and sends every line meant for it to the
       other. The second one goes, because the first is the one the edges
       written before it were probably about. GPT Sol, 2026-08-30. */
    const seen = new Set<string>();
    for (const [j, ri] of rawItems.entries()) {
      const item = readItem(ri, h, blocks, faults, `${id}[${j}]`);
      if (!item) continue;
      if (item.kind === "node") {
        if (seen.has(item.id)) {
          faults.push({ where: id, what: `two nodes both called "${item.id}" — dropped the second` });
          continue;
        }
        seen.add(item.id);
      }
      items.push(item);
    }

    /* An edge to a node that is not in this scene draws a line from somewhere
       to nowhere, and the renderer would have to invent one end of it. Dropped
       here rather than at paint time so the count lands in the report. */
    const nodeIds = new Set(items.filter((it) => it.kind === "node").map((it) => it.id));
    const kept = items.filter((it) => {
      if (it.kind !== "edge") return true;
      const a = it.from.split(":")[0] ?? "";
      const b = it.to.split(":")[0] ?? "";
      if (nodeIds.has(a) && nodeIds.has(b)) return true;
      faults.push({ where: id, what: `edge ${it.from}→${it.to} names a node this scene has not got` });
      return false;
    });

    if (scenes.some((s2) => s2.id === id)) {
      // Same reason as a duplicate node id: `opens` names a scene by id.
      faults.push({ where: `scene ${i}`, what: `a second scene called "${id}" — dropped` });
      continue;
    }
    const scene: SketchScene = { id, title: str(rs.title), height: h, items: kept };
    const caption = str(rs.caption);
    if (caption) scene.caption = caption;
    scenes.push(scene);
  }

  /* `opens` last, because a scene can only be resolved once every scene has
     been read — a node in the overview may open the last one in the list. */
  const sceneIds = new Set(scenes.map((s) => s.id));
  const opened = new Set<string>();
  for (const scene of scenes) {
    for (const item of scene.items) {
      /* Nodes and regions both, and the same rule for both: a pointer at a
         scene that is not here is dropped rather than drawn as a control that
         does nothing. */
      if (item.kind !== "node" && item.kind !== "region") continue;
      if (!item.opens) continue;
      if (sceneIds.has(item.opens) && item.opens !== scene.id) {
        opened.add(item.opens);
        continue;
      }
      const where = item.kind === "node" ? item.id : (item.label ?? scene.id);
      faults.push({ where, what: `opens "${item.opens}", which is not a scene here` });
      delete item.opens;
    }
  }

  /* Only now that every explicit pointer has been resolved, because a region
     the model aimed itself is not one we get to aim. */
  const inferred = inferRegionOpens(scenes);
  for (const scene of scenes) {
    for (const item of scene.items) {
      if (item.kind === "region" && item.opensInferred && item.opens) opened.add(item.opens);
    }
  }

  /**
   * **A scene nothing opens is a scene the reader can never reach.**
   *
   * The plainest silent success this feature has produced, and it went
   * unnoticed through six runs: the model returns three scenes, the artefact
   * says three scenes, the score says three scenes — and in four of those six
   * runs, three of them with no `opens` at all, the reader could see one. Two
   * paid-for pictures each time, drawn and unreachable, with nothing anywhere
   * reporting it.
   *
   * It is a **fault, not a refusal**. The overview is usually fine and throwing
   * it away over a missing pointer would be the wrong trade — and the panel now
   * lists the scenes itself rather than depending on `opens`, so an artefact
   * like this is still usable. What the count buys is knowing the prompt has
   * stopped working, which is exactly what nobody knew for six runs.
   */
  for (const scene of scenes.slice(1)) {
    if (opened.has(scene.id)) continue;
    faults.push({
      where: scene.id,
      what: "no node opens this scene — nothing in the overview leads to it",
    });
  }

  const sketch: Sketch = {
    version: SKETCH_VERSION,
    title: str(raw.title),
    caption: str(raw.caption),
    scenes,
  };
  const generator = str(raw.generator);
  if (generator) sketch.generator = generator;

  const kept = scenes.reduce((n, s) => n + s.items.length, 0);
  return { sketch, report: { faults, written, kept, inferred } };
}

/* ------------------------------------------------- inferring a region's door */

/** Below this many blocks, a region is not saying enough to match on. */
export const MIN_REGION_BLOCKS = 2;
/** The winning scene must cover more than this share of the region's blocks. */
export const MIN_REGION_COVER = 0.5;

/** A node belongs to a region when its **centre** is inside it. */
function inside(n: SketchNode, r: SketchRegion): boolean {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
}

/**
 * **The picture already knows which scene a region is about — through the
 * blocks, which are the one thing everything here agrees on.**
 *
 * Greg pressed "WHY WE'RE TEMPTED TO SEE IT" and nothing happened, because that
 * region had no `opens`: the artefact on disk was drawn before the prompt
 * started asking for one. Paying for another picture fixes that one article,
 * and leaves every reader holding an older sketch — or a newer one drawn by a
 * model that forgot — pressing names that do nothing.
 *
 * So it is derived instead. A region encloses some nodes; those nodes name
 * blocks; a zoom scene names blocks too. If most of a region's blocks turn up
 * in one scene and hardly any in the others, that scene **is** the region drawn
 * larger — which is what a region and a zoom scene each already mean. Note that
 * this is not similarity between a label and a title: on the two real drawings
 * "THE CORE ARGUMENT" and "Why Scale Works: The Ladder" share no words at all,
 * and their blocks match five to nil.
 *
 * **Conservative on purpose, because a wrong door is worse than none.** A
 * reader who presses a name and arrives somewhere else has been lied to by the
 * picture; one who presses a name and gets nothing has only learnt that this
 * name is not a control. So it abstains unless the winning scene takes a strict
 * majority of the region's blocks and the runner-up takes at most half of what
 * the winner did. Over the six regions of the two real drawings that links
 * three and abstains on three, and all six are right.
 *
 * The link is marked `opensInferred`, which is not decoration. `unreachable`
 * counts what the **reader** cannot get to, so an inferred door rightly takes a
 * scene off it — but that would leave a prompt which had quietly stopped asking
 * for `opens` looking exactly like one that still did. `score.inferred` is the
 * other half of the pair, and it is the one to watch: what the model wrote, as
 * against what we had to work out for it.
 */
export function inferRegionOpens(scenes: SketchScene[]): number {
  if (scenes.length < 2) return 0;

  /* Only zoom scenes are targets. A region opening the overview would be a
     door back to where the reader already is, and that is what Back is for. */
  const targets = scenes.slice(1).map((sc) => ({
    id: sc.id,
    blocks: new Set(
      sc.items
        .filter((i): i is SketchNode => i.kind === "node" && !!i.block)
        .map((i) => i.block as BlockId),
    ),
  }));

  const cands: { region: SketchRegion; scene: string; cover: number }[] = [];

  for (const scene of scenes) {
    const nodes = scene.items.filter((i): i is SketchNode => i.kind === "node");
    for (const region of scene.items) {
      if (region.kind !== "region") continue;
      /* No label is nothing to press. An explicit pointer is not ours to
         second-guess — the model saying so beats us working it out. */
      if (!region.label || region.opens) continue;

      const mine = new Set(
        nodes.filter((n) => n.block && inside(n, region)).map((n) => n.block as BlockId),
      );
      if (mine.size < MIN_REGION_BLOCKS) continue;

      let best: { id: string; hits: number } | null = null;
      let second = 0;
      for (const t of targets) {
        if (t.id === scene.id) continue;
        let hits = 0;
        for (const b of mine) if (t.blocks.has(b)) hits++;
        if (!best || hits > best.hits) {
          if (best) second = Math.max(second, best.hits);
          best = { id: t.id, hits };
        } else {
          second = Math.max(second, hits);
        }
      }

      if (!best || best.hits === 0) continue;
      if (best.hits / mine.size <= MIN_REGION_COVER) continue;
      /* A runner-up worth half as much means the region straddles two scenes,
         and there is no honest way to pick one of them. */
      if (second * 2 > best.hits) continue;
      cands.push({ region, scene: best.id, cover: best.hits / mine.size });
    }
  }

  /* **One door per scene.** Two regions claiming the same zoom scene is the
     same ambiguity as one region straddling two scenes, seen from the other
     side: the stronger match takes it and the other stays shut. */
  let made = 0;
  const taken = new Set<string>();
  for (const c of [...cands].sort((a, b) => b.cover - a.cover)) {
    if (taken.has(c.scene)) continue;
    taken.add(c.scene);
    c.region.opens = c.scene;
    c.region.opensInferred = true;
    made++;
  }
  return made;
}

/**
 * **The artefact records what the model wrote, never what we worked out.**
 *
 * `inferRegionOpens` runs inside `readSketch`, which runs on the way *in* to a
 * write as well as on the way out of a read — so without this, a derived door
 * would be saved into the file and read back tomorrow indistinguishable from one
 * the model had drawn. `opensInferred` is not persisted either (`readRegion`
 * never reads it off the input, on purpose: it is ours to set, and a model that
 * wrote it would otherwise be able to claim our mark). The pair would leave
 * `score.inferred` reporting 0 on a picture whose every door we fitted — an eval
 * over saved artefacts would then find the prompt in perfect health, which is
 * the exact failure the number exists to make visible.
 *
 * So the stored picture stays the model's own work, the derivation runs afresh
 * on every read, and a better rule tomorrow reaches every sketch already on
 * disk instead of only the ones drawn after it.
 *
 * **In place**, and returned only for convenience at the call site. `strip…`
 * rather than `without…` for that reason: the caller's own `sketch` changes,
 * and a name promising a copy is the kind that gets one written.
 */
export function stripInferredOpens(sketch: Sketch): Sketch {
  for (const scene of sketch.scenes) {
    for (const item of scene.items) {
      if (item.kind !== "region" || !item.opensInferred) continue;
      delete item.opens;
      delete item.opensInferred;
    }
  }
  return sketch;
}

/* ------------------------------------------------------------------ scoring */

export interface SketchScore {
  scenes: number;
  /**
   * Scenes after the overview that nothing opens — counted from the reader's
   * side, so a door `inferRegionOpens` worked out counts as a door.
   */
  unreachable: number;
  /**
   * …and how many of the doors are ours rather than the model's. Read the two
   * together: `unreachable` says whether the picture is whole, `inferred` says
   * whether the prompt is still doing its job.
   */
  inferred: number;
  nodes: number;
  /** Nodes carrying a jump the article can honour. */
  linked: number;
  /**
   * **The longest run of the article no node points into**, as a fraction of
   * the whole — 0.4 means two fifths of the piece went by with nothing in the
   * picture standing for it. Counted over EVERY scene, because a zoom's nodes
   * are reachable too; `flow` is the overview alone, because that is the one
   * arrangement a reader is looking at when they judge the shape.
   *
   * The obvious measure, "how many of the article's blocks are pointed at", is
   * useless here and was the first version: sixteen nodes over a 141-block
   * essay is 11% by construction and would read as a failure for any picture
   * that is not a table of contents. What a reader actually loses is a *gap* —
   * a stretch they can scroll through with nothing lighting up.
   */
  reach: number;
  /**
   * **Does the picture still run down the page?** Kendall's tau between each
   * linked node's `y` and where its block is in the article: 1 is perfectly
   * top-to-bottom, 0 is unrelated, −1 is upside down.
   *
   * This is the one property Greg asked for by name, and it is the one thing a
   * picture can get wrong while looking beautiful. `null` when there are fewer
   * than three linked nodes to compare.
   */
  flow: number | null;
  /** The worst scene's node area lying under another node, as a fraction of its own. */
  overlap: number;
  /** Nodes whose text will not fit the box they were given. */
  overflowing: number;
  faults: number;
}

/** Kendall's tau-b over two rankings of the same length. */
function tau(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  let con = 0;
  let dis = 0;
  let tx = 0;
  let ty = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = Math.sign((xs[j] as number) - (xs[i] as number));
      const dy = Math.sign((ys[j] as number) - (ys[i] as number));
      if (dx === 0 && dy === 0) continue;
      if (dx === 0) tx++;
      else if (dy === 0) ty++;
      else if (dx === dy) con++;
      else dis++;
    }
  }
  const denom = Math.sqrt((con + dis + tx) * (con + dis + ty));
  return denom === 0 ? null : (con - dis) / denom;
}

/**
 * **Wrap to `maxChars`** — the one wrapping routine, used by the painter to
 * decide what is drawn and by `nodeFits` to decide whether it fits.
 *
 * It lives here rather than in sketch-paint.ts because of what happened when it
 * did not. There were two: this file estimated lines with its own word loop
 * while the painter wrapped with another, and they disagreed on the case that
 * matters — a single word longer than the line. A 60×20 node holding
 * `supercalifragilisticexpialidocious` scored as fitting and rendered as
 * `superc…`, so `overflowing` reported 0 for a picture with a truncated node in
 * it. **A measure and the thing it measures cannot be two pieces of
 * arithmetic**, which is the rule
 * docs/reusable/silent-success.md keeps restating. GPT Sol, 2026-08-30.
 *
 * `maxLines` may be `Infinity`, which is what asks "how many would this need?".
 */
export function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) {
      line = word;
    } else if (line.length + 1 + word.length <= maxChars) {
      line = `${line} ${word}`;
    } else {
      out.push(line);
      line = word;
      if (out.length === maxLines) break;
    }
    while (line.length > maxChars && out.length < maxLines) {
      out.push(`${line.slice(0, maxChars - 1)}-`);
      line = line.slice(maxChars - 1);
    }
  }
  if (line && out.length < maxLines) out.push(line);
  if (out.length === maxLines && out.length > 0) {
    // Something was cut. Say so with an ellipsis rather than ending mid-word,
    // which reads as the model having stopped writing.
    const last = out[maxLines - 1] as string;
    if (text.length > out.join(" ").length) {
      out[maxLines - 1] = `${last.replace(/[\s,;:.-]+$/, "").slice(0, Math.max(1, maxChars - 1))}…`;
    }
  }
  return out;
}

/** How many characters fit across `width` at this size. */
export function charsThatFit(width: number, size: SketchSize): number {
  return Math.max(1, Math.floor((width - 10) / (SIZE_PX[size] * CHAR_W)));
}

/** How many lines of `size` text this node's box has room for. */
export function linesInBox(node: SketchNode): number {
  const px = SIZE_PX[node.size];
  const subH = node.sub ? Math.max(9, px * 0.76) * 1.3 : 0;
  return Math.max(1, Math.floor((node.h - subH - 4) / (px * LINE_H)));
}

/**
 * **How wide the shape is `dy` above or below its own centre.**
 *
 * A box is its full width everywhere and nothing else here is. A diamond, a
 * hexagon, an ellipse and a pill all cut in as you move away from the centre
 * line, so text laid out to the *bounding box* sits outside the shape — and
 * every check reports it fitting, because every check was measuring the box.
 * Seen on the phrenology tract: a hexagon captioned "self-knowledge to moral
 * perfection", the caption crossing both sloping sides, `overflowing` = 0.
 *
 * A flat fraction per shape was the first fix and it was too crude in both
 * directions at once — it called a sub one character over an overflow on a
 * picture that looked perfectly fine. This is the actual arithmetic of each
 * outline, which costs four lines and has no constant in it to argue about.
 */
export function widthAt(node: SketchNode, dy: number): number {
  const rx = node.w / 2;
  const ry = node.h / 2;
  const t = ry === 0 ? 1 : Math.min(1, Math.abs(dy) / ry);
  switch (node.shape) {
    case "ellipse":
      return 2 * rx * Math.sqrt(Math.max(0, 1 - t * t));
    case "diamond":
      return 2 * rx * (1 - t);
    case "hex":
      // The polygon is widest at the centre line and inset by `k` at the ends.
      return 2 * (rx - Math.min(node.w / 4, ry) * t);
    case "pill": {
      // Semicircular ends of radius `ry`; the straight part is what is left.
      const r = Math.min(ry, rx);
      return 2 * (rx - r + r * Math.sqrt(Math.max(0, 1 - t * t)));
    }
    default:
      return node.w;
  }
}

/** One node's text, exactly as it will be drawn. */
export interface NodeText {
  lines: string[];
  /** The sub-line as drawn — truncated if it had to be. */
  sub: string | null;
  px: number;
  subPx: number;
  /** True when anything was cut to make it fit. */
  truncated: boolean;
}

/**
 * **What the painter will draw inside this node** — the one place the question
 * is answered, so that `nodeFits` and the picture cannot disagree about it.
 *
 * They did, twice. First as two different word-wrapping loops, where a single
 * word longer than a line scored as fitting and rendered as `superc…`. Then as
 * two different ideas of how wide the shape is. **A measure and the thing it
 * measures cannot be two pieces of arithmetic** — so there is one function, the
 * painter positions what it returns, and `nodeFits` asks whether anything in it
 * was cut.
 *
 * The width is taken at the outermost row the text occupies, found by wrapping
 * once at the centre width and then again at the width that many lines really
 * have. One refinement, not a loop: the second answer is what is drawn, so it
 * is right by construction even where a third pass would have differed.
 */
export function layoutNodeText(node: SketchNode): NodeText {
  const px = SIZE_PX[node.size];
  const subPx = Math.max(9, px * 0.76);
  const subH = node.sub ? subPx * 1.3 : 0;
  const maxLines = linesInBox(node);

  /**
   * The width available to the **outermost line's centre**, which is not the
   * width at the edge of the text block.
   *
   * Getting that wrong makes the two passes below diverge instead of settle: a
   * three-line block measured at its outer edge is narrower than one measured
   * at its outer line, so the text needs another line, so it is measured
   * narrower still. On the phrenology hexagon that turned a caption which fits
   * on two lines into a truncation — the measure inventing the failure it was
   * added to detect. The centre of the outermost of `n` rows is
   * `(n − 1) / 2` line-heights from the middle.
   */
  const widthFor = (lineCount: number) =>
    widthAt(node, ((lineCount - 1) / 2) * px * LINE_H + subH / 2);

  let lines = wrap(node.text, charsThatFit(widthFor(1), node.size), maxLines);
  lines = wrap(node.text, charsThatFit(widthFor(lines.length), node.size), maxLines);

  const room = charsThatFit(widthFor(lines.length), node.size);
  const whole = wrap(node.text, room, Number.POSITIVE_INFINITY);

  let sub: string | null = null;
  let subCut = false;
  if (node.sub) {
    /* The sub sits under the text, so it gets its own width — it is the
       narrowest row of a diamond and it is the line that actually overflowed. */
    const subDy = (lines.length * px * LINE_H) / 2;
    const subRoom = Math.max(1, Math.floor((widthAt(node, subDy) - 10) / (subPx * CHAR_W)));
    sub = wrap(node.sub, subRoom, 1)[0] ?? "";
    subCut = sub !== node.sub;
  }

  return {
    lines,
    sub,
    px,
    subPx,
    truncated: lines.length < whole.length || lines.join("").includes("…") || subCut,
  };
}

/** How many lines the text needs, at this size, in a box this wide. */
export function linesNeeded(text: string, w: number, size: SketchSize): number {
  return wrap(text, charsThatFit(w, size), Number.POSITIVE_INFINITY).length;
}

/** Does this node's text fit the shape the model gave it, uncut? */
export function nodeFits(node: SketchNode): boolean {
  if (!node.text) return true;
  return !layoutNodeText(node).truncated;
}

function overlapArea(a: SketchNode, b: SketchNode): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function scoreSketch(
  sketch: Sketch,
  report: SketchReport,
  opts: ReadOptions,
): SketchScore {
  const index = new Map(opts.blockOrder.map((id, i) => [id, i]));
  const nodes = sketch.scenes.flatMap((s) =>
    s.items.filter((it): it is SketchNode => it.kind === "node"),
  );

  const overview = sketch.scenes[0]?.items.filter(
    (it): it is SketchNode => it.kind === "node",
  );
  const linkedHere = (overview ?? []).filter((n) => n.block);
  const ys = linkedHere.map((n) => n.y + n.h / 2);
  const ds = linkedHere.map((n) => index.get(n.block as BlockId) ?? 0);

  /* **Blocks with no mark, not the distance between marks.** The gap used to be
     `marks[i] - marks[i-1]`, which is one more than the number of unmarked
     blocks between them: marks at 1 and 9 have seven blocks between them and it
     reported eight. Small, and it made the empty case wrong in a way that
     mattered — a sketch with no linked nodes at all reported 90% of a ten-block
     article unreached instead of 100%, so the very worst input scored better
     than it should. GPT Sol, 2026-08-30. */
  const total = opts.blockOrder.length;
  const marks = [
    ...new Set(
      nodes
        .filter((n) => n.block)
        .map((n) => index.get(n.block as BlockId))
        .filter((i): i is number => i !== undefined),
    ),
  ].sort((x, y) => x - y);
  let widest = 0;
  let prev = -1;
  for (const m of [...marks, total]) {
    widest = Math.max(widest, m - prev - 1);
    prev = m;
  }

  /* **The worst scene, not the pooled average.** Pooling let two tidy zoom
     scenes dilute an overview whose boxes sit on top of each other — and the
     overview is the picture. Same finding. */
  let overlap = 0;
  for (const scene of sketch.scenes) {
    const ns = scene.items.filter((it): it is SketchNode => it.kind === "node");
    let over = 0;
    let area = 0;
    for (const n of ns) area += n.w * n.h;
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        over += overlapArea(ns[i] as SketchNode, ns[j] as SketchNode);
      }
    }
    if (area > 0) overlap = Math.max(overlap, Math.min(1, over / area));
  }

  /* Regions count as well as nodes: a scene reached by pressing its region's
     name is every bit as reachable as one reached from a box. */
  const opened = new Set(
    sketch.scenes
      .flatMap((sc) => sc.items)
      .filter((it): it is SketchNode | SketchRegion => it.kind === "node" || it.kind === "region")
      .map((it) => it.opens)
      .filter(Boolean),
  );
  return {
    scenes: sketch.scenes.length,
    unreachable: sketch.scenes.slice(1).filter((sc) => !opened.has(sc.id)).length,
    inferred: sketch.scenes
      .flatMap((sc) => sc.items)
      .filter((it) => it.kind === "region" && it.opensInferred).length,
    nodes: nodes.length,
    linked: nodes.filter((n) => n.block).length,
    reach: total === 0 ? 1 : widest / total,
    flow: tau(ys, ds),
    overlap,
    overflowing: nodes.filter((n) => !nodeFits(n)).length,
    faults: report.faults.length,
  };
}

/* ------------------------------------------------------------- acceptance */

/**
 * **Is this good enough to be an artefact?** — the boundary between a run that
 * produced a picture and a run that produced a file.
 *
 * It exists because of the plainest failure this whole design had: a model
 * answering `{"scenes": []}` came through `readSketch` with **zero faults**,
 * scored, and was written to disk as a finished sketch. The reader would have
 * opened Diagram, waited two minutes, been billed, and been shown nothing —
 * and every check involved would have reported success
 * (docs/reusable/silent-success.md). `OVERVIEW_MIN` was advice in a prompt,
 * which is not a rule. GPT Sol, 2026-08-30, and its highest-value finding.
 *
 * The thresholds are deliberately loose. This is not a quality bar — no
 * arithmetic here can tell a good picture from a bad one, which is what
 * `evals/sketch/` and a person looking at a PNG are for. It is the line under
 * which there is no picture at all, and each one names a specific way a reader
 * ends up staring at a blank band.
 */
export interface Acceptance {
  ok: boolean;
  /** Every reason it was refused, in the words a person would use. */
  refusals: string[];
}

/** The smallest overview that is a picture rather than a caption. */
export const MIN_OVERVIEW_NODES = 3;
/** Below this share of overview nodes carrying a block, nothing is navigable. */
export const MIN_LINKED_SHARE = 0.5;
/** Above this, the picture is largely drawn on top of itself. */
export const MAX_OVERLAP = 0.25;
/** Below this, the picture is not following the article down the page at all. */
export const MIN_FLOW = 0.3;

export function accept(sketch: Sketch, score: SketchScore): Acceptance {
  const refusals: string[] = [];
  const overview = sketch.scenes[0];
  const nodes = (overview?.items ?? []).filter((i): i is SketchNode => i.kind === "node");

  if (!overview) refusals.push("no overview scene");
  if (nodes.length < MIN_OVERVIEW_NODES) {
    refusals.push(`the overview has ${nodes.length} nodes, fewer than ${MIN_OVERVIEW_NODES}`);
  }
  if (!sketch.caption) refusals.push("no caption, so the picture makes no claim a reader can check");

  const linked = nodes.filter((n) => n.block).length;
  if (nodes.length > 0 && linked / nodes.length < MIN_LINKED_SHARE) {
    refusals.push(
      `only ${linked} of ${nodes.length} overview nodes can be clicked through to the article`,
    );
  }
  if (score.overlap > MAX_OVERLAP) {
    refusals.push(`${Math.round(score.overlap * 100)}% of node area is drawn over other nodes`);
  }
  /* `null` is not a failure: it means fewer than three linked nodes, which the
     node-count and linkage rules above have already had their say about. A
     number that is genuinely low is a different thing and is refused. */
  if (score.flow !== null && score.flow < MIN_FLOW) {
    refusals.push(`the picture does not run down the page with the article (flow ${score.flow.toFixed(2)})`);
  }
  return { ok: refusals.length === 0, refusals };
}
