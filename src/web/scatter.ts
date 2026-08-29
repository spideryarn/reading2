/**
 * **Drift and Trail** — the two pictures whose axes are meaning rather than
 * structure.
 *
 * Greg, 2026-08-27:
 *
 * > Each block is a point, with the y-axis being position in the document …
 * > use the first component as the x-axis value … Hopefully this will give us a
 * > rough sense of how the article progresses, which sections are similar to
 * > one another.
 *
 * Every other picture in this band draws the tree stage 4 wrote, or the tree
 * plus a hint about shared words. These two draw the article's **subject
 * matter**, from an embedding of every paragraph, projected on the server
 * ([src/projection.ts](../projection.ts)). This file is only the geometry: what
 * arrives is two numbers and a topic per paragraph, and what leaves is pixels.
 *
 * ```
 *            DRIFT                                    TRAIL
 *   y = where you are in the piece            x = component 1, y = component 2
 *   x = what it is talking about              the line is reading order
 *
 *   ┌────────────────────────────┐            ┌────────────────────────────┐
 * s │   ●                        │            │        ●───●               │
 * t │  ●                         │            │       ╱     ╲              │
 * a │    ●●                      │            │   ●──●       ●             │
 * r │       ●                    │            │  ╱            ╲            │
 * t │          ●   ●             │            │ ●              ●▸          │
 *   │             ●●             │            │  ╲            ╱            │
 *   │                 ●          │            │   ●─────────●              │
 * e │      ●                     │            │        ╲                   │
 * n │   ●●                       │            │         ●──▸●              │
 * d └────────────────────────────┘            └────────────────────────────┘
 * ```
 *
 * **Trail is the first picture in this band that gives up "down the page is
 * later".** It has to: both of its axes are spent on meaning. What replaces the
 * rule is the chain — the arrow is the reader's own route through the space, so
 * reading order is still drawn, just not as a direction.
 *
 * ## Three things that are not obvious
 *
 * **The dots do not tile the article.** Only blocks that were embedded get one,
 * and short ones and non-prose are not embedded (src/article-vectors.ts says
 * why). A run of one-line list items is a gap. The panel's strip says how many
 * were left out, because a picture that quietly drops a fifth of the article
 * looks exactly like a picture of all of it.
 *
 * **The scale is robust rather than min-to-max.** Measured on the constitution,
 * 2026-08-27: component 1 runs −0.649 to 0.331, and its middle half runs −0.128
 * to 0.199. Scaling to the extremes would squeeze three quarters of the article
 * into a third of the band to make room for one outlier. So the axis is the 2nd
 * to 98th percentile and anything beyond is **clamped to the wall** — which is
 * a small lie about that dot's position and a much smaller one than flattening
 * every other dot.
 *
 * **A node's `blocks` is 1 and its row range is not.** The range tiles the
 * article so that the you-are-here mark always lands on some dot even when the
 * reader is standing in a paragraph too short to have one; the count says what
 * the dot actually *is*, which is one paragraph. Two fields, two jobs, both
 * true.
 */
import { isBody } from "../block-policy.js";
import type { Block, BlockId, NodeId, ProjectionPoint } from "../types.js";
import {
  type DiagramLayout,
  type DiagramLink,
  type DiagramNode,
  type DiagramOptions,
  walk,
} from "./diagram.js";
import { terms } from "./graph.js";
import type { SummaryNode } from "./tree.js";

/** Which palette slot a dot takes. The panel owns which palette. */
export type ScatterHue = "section" | "progress" | "topic";
/** What sideways means on Drift. Trail spends both axes on components. */
export type ScatterAxis = "spread" | "lanes";

export interface ScatterInput {
  points: readonly ProjectionPoint[];
  /** How many topics the server found. Lanes are 0…k-1, left to right. */
  k: number;
  axis: ScatterAxis;
  hue: ScatterHue;
}

/**
 * How many steps the progress ramp has. See `styles/colourscales.css`.
 *
 * **Nine, not seven, and the difference is a bug that was already here.** The
 * first version reached for `--heat-*` (inferno), whose two darkest stops are
 * at or below the page and which therefore carries a "start at step 2" caveat —
 * so this mapped the article onto steps 2 to 8. The ramp is viridis now, whose
 * darkest stop is comfortably above the page, and the two lowest steps were
 * simply never being drawn. GPT Sol's finding, 2026-08-27: half a change is the
 * hardest kind to see, because the picture looks fine either way.
 */
export const RAMP_STEPS = 9;

/** Breathing room inside the picture, in px. */
const PAD_X = 13;
const PAD_Y = 14;
/** Vertical room per dot on Drift before the picture starts to scroll. */
const ROW = 6;
/**
 * The least height Trail will take, before it simply fills the scroller.
 *
 * **Low, and deliberately lower than it was.** Drift is a rail and scrolling it
 * is reading the article; Trail is a *plane*, and a plane you have to scroll to
 * see all of is a plane whose shape you never see — which is the only thing it
 * has to offer. So it takes the room it is given and floors at something small
 * enough that the picture almost always fits.
 *
 * 380 was the first number, and in a browser on 2026-08-27 the band's scroller
 * came out at about 350px once the two control rows and the strip had taken
 * their share — so the picture scrolled by thirty pixels, for nothing.
 */
const TRAIL_MIN_H = 260;

/** How many steps of fade the chain gets, oldest to newest. Matches the CSS. */
const CHAIN_STEPS = 9;
/**
 * How many segments either side of the reader are drawn at full strength, at
 * most — **and it scales down on a short article**.
 *
 * Eight either side is a bright run of seventeen, which on a 275-dot chain is a
 * local landmark and on a 29-dot chain is most of the picture. A "you are here"
 * that covers three fifths of the chain is not a landmark, it is a wash. Caught
 * by the test rather than by looking, which is the point of having one: at 320
 * pixels wide both versions look like a picture with a bright bit in it.
 */
const NEAR_READER = 8;
/** …but never more than this share of the whole chain. */
const NEAR_READER_SHARE = 0.06;
/**
 * The shortest segment worth putting an arrowhead on, in px.
 *
 * Without it a segment can clear `tail + head` by half a pixel and still take a
 * 6px marker — an arrowhead floating with no visible line behind it. It is not
 * *wrong*, in that the direction is computed from a real vector rather than
 * from a zero one, but it reads as a stray mark. Found by the test.
 */
const MIN_ARROW_RUN = 3;
/**
 * Room left beyond the target dot for the arrowhead, in px.
 *
 * The marker is 6px long in user space with its tip at `refX` (see the `<defs>`
 * in DiagramPanel.tsx), so the tip lands exactly here. The same number the
 * Force chain uses — `HEAD_GAP` in diagram-d3.ts — and it is repeated rather
 * than imported because the two pictures are free to disagree about it and
 * importing would quietly tie them together.
 */
const HEAD_GAP = 5;

/* ── shared ───────────────────────────────────────────────────────────────── */

/** One paragraph, joined to everything the picture needs to draw and name it. */
interface Dot {
  point: ProjectionPoint;
  block: Block;
  /** Its own row in the article. This is what decides where it is drawn. */
  row: number;
  /** The range it *answers for*, which tiles — see the file header. */
  startRow: number;
  endRow: number;
  part: number;
  number: string;
  title: string;
}

/** What a row of the article belongs to, for the card and for the hue. */
interface Section {
  part: number;
  number: string;
  title: string;
}

/**
 * Which section each row of the article is in, by walking the tree once.
 *
 * Deeper wins, because the deepest section containing a paragraph is the one a
 * reader would name it by — the same rule `nodeAt` applies to the pictures that
 * draw sections.
 */
function sectionsByRow(root: SummaryNode, rows: number): (Section | null)[] {
  const out = new Array<Section | null>(rows).fill(null);
  /* No collapse set: a scatter draws paragraphs, and closing a section in the
     tree pictures must not change which section a paragraph is *in*. */
  for (const entry of walk(root, EMPTY)) {
    if (entry.node.node.depth === 0) continue;
    const label = {
      part: entry.part,
      number: entry.node.number,
      title: entry.node.node.title,
    };
    for (let r = entry.node.startRow; r <= entry.node.endRow && r < rows; r++) {
      if (r < 0) continue;
      out[r] = label;
    }
  }
  return out;
}

const EMPTY: ReadonlySet<NodeId> = new Set<NodeId>();

/**
 * Join the server's points to the article the browser is holding.
 *
 * **A point whose block id we do not recognise is dropped**, rather than drawn
 * somewhere plausible. That happens when the article was re-ingested between
 * the request and the answer, and a dot in the wrong place is worse than a dot
 * missing: the picture would be quietly about a paragraph that no longer
 * exists. Block ids are the identity of a passage everywhere else in this app
 * (docs/project/block-ids.md) and this is the same rule.
 */
function dots(root: SummaryNode, blocks: readonly Block[], input: ScatterInput): Dot[] {
  const rowOf = new Map<BlockId, number>();
  blocks.forEach((b, i) => {
    rowOf.set(b.id, i);
  });
  const sections = sectionsByRow(root, blocks.length);

  const kept: Dot[] = [];
  for (const point of input.points) {
    const row = rowOf.get(point.id);
    const block = row === undefined ? undefined : blocks[row];
    if (row === undefined || !block) continue;
    const at = sections[row] ?? null;
    kept.push({
      point,
      block,
      row,
      startRow: row,
      endRow: row,
      part: at?.part ?? -1,
      number: at?.number ?? "",
      title: at?.title ?? "",
    });
  }
  // The server sends them in document order; sorting is what makes that a
  // property of this file rather than a hope about somebody else's.
  kept.sort((a, b) => a.row - b.row);
  /* **The ranges tile even though the dots do not.** A reader standing in a
     one-line list item that was too short to embed would otherwise have no dot
     answering for them, and the you-are-here mark would blink out for a screen
     at a time. So the first dot answers for everything above it, each dot for
     everything up to the next, and the last for everything below. Its `blocks`
     count still says 1, because that is what the dot *is*. */
  /* **"Everything below" is everything below in the *argument*.** The last dot's
     range used to run to `blocks.length - 1`, which swallowed the whole
     apparatus — so a reader three endnotes deep was shown standing on the final
     paragraph of the argument, and Trail lit that paragraph's stretch of chain
     as the brightest thing in the picture.
     The tiling above exists for a body paragraph too short to embed, where a
     blinking mark would be worse than an approximate one. The apparatus is not
     that case: it is not in this picture at all — Drift and Trail plot embedded
     body paragraphs and correctly receive no point for a note — so the honest
     answer for a reader inside it is no dot rather than the wrong one, which is
     the `-1` the caller already handles. GPT Sol, third review, 2026-08-29. */
  const lastBody = lastBodyRow(blocks);
  kept.forEach((d, i) => {
    d.startRow = i === 0 ? 0 : d.row;
    d.endRow = i === kept.length - 1 ? Math.max(d.row, lastBody) : (kept[i + 1]?.row ?? d.row) - 1;
  });
  return kept;
}

/**
 * The last row of the argument — the block before the apparatus begins.
 *
 * **This is the denominator these pictures actually want.** `blocks.length`
 * counts the endnotes, and three separate things read as the article's extent:
 * Drift's vertical axis, the progress hue (`slot`), and the spoken label
 * "paragraph N of M". With the apparatus in the total, a forty-note article
 * left a third of Drift blank, the last paragraph of the argument never reached
 * the final progress step, and the label said "paragraph 2 of 4" about the
 * final body paragraph of two. GPT Sol, fourth review, 2026-08-29.
 */
function lastBodyRow(blocks: readonly Block[]): number {
  let i = blocks.length - 1;
  while (i >= 0 && !isBody(blocks[i] ?? {})) i--;
  return i;
}

/**
 * How many rows of *argument* there are, for a denominator.
 *
 * Never zero, because every one of these divides by `rows - 1` or scales by it.
 */
function bodyRows(blocks: readonly Block[]): number {
  return Math.max(1, lastBodyRow(blocks) + 1);
}

/**
 * The reader's row, or `null` when they are not in the argument.
 *
 * **Asked of the block, not of the range**, and that is what makes it work for
 * the shape `splitBlocks` deliberately refuses to build a supplement node for:
 * a note stranded mid-article (src/supplement.ts). There the apparatus is a
 * hole in the middle of the body, and no contiguous "up to the last body row"
 * rule can describe it — a reader standing on that note was lighting three
 * body-chain links around it. A block either is apparatus or is not, and that
 * is the only question worth asking here.
 */
function bodyRowOf(blocks: readonly Block[], at: number | null | undefined): number | null {
  if (at === null || at === undefined) return null;
  return isBody(blocks[at] ?? {}) ? at : null;
}

/**
 * The middle 96% of a set of values, as `[lo, hi]`.
 *
 * See the file header for the measurement behind the percentiles. Falls back to
 * the true extremes when the percentiles collapse, and reports a zero-width
 * range rather than pretending — the callers handle that, because "every
 * paragraph scored the same" is a real answer and a division by zero is not.
 */
function robustRange(values: readonly number[]): { lo: number; hi: number } {
  if (values.length === 0) return { lo: 0, hi: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))] ?? 0;
  const lo = at(0.02);
  const hi = at(0.98);
  if (hi > lo) return { lo, hi };
  return { lo: sorted[0] ?? 0, hi: sorted[sorted.length - 1] ?? (sorted[0] ?? 0) };
}

/** A linear scale from that range onto `[lo, hi]`, clamped at both walls. */
function robustScale(values: readonly number[], lo: number, hi: number): (v: number) => number {
  const mid = (lo + hi) / 2;
  const range = robustRange(values);
  if (!(range.hi > range.lo)) return () => mid;
  return (v: number) => {
    const t = (v - range.lo) / (range.hi - range.lo);
    return lo + Math.min(1, Math.max(0, t)) * (hi - lo);
  };
}

/**
 * The word count a full-size dot stands for — the **90th percentile**, not the
 * maximum.
 *
 * One malformed block that swallowed the whole article (a plausible failure of
 * stage 2, and the reason `MAX_CHARS` exists in src/article-vectors.ts) would
 * otherwise take the full radius and squash every ordinary paragraph to the
 * minimum. The picture would look calm and be a picture of one bug. GPT Sol's
 * finding, 2026-08-27. Anything above the percentile is simply drawn at full
 * size, which is the honest rendering of "this one is long".
 */
function sizeReference(words: readonly number[]): number {
  if (words.length === 0) return 1;
  const sorted = [...words].sort((a, b) => a - b);
  return Math.max(1, sorted[Math.min(sorted.length - 1, Math.round(0.9 * (sorted.length - 1)))] ?? 1);
}

/** A dot's radius: area with the paragraph's length, so twice as long looks twice as big. */
function radius(words: number, reference: number): number {
  const t = reference > 0 ? Math.min(1, words / reference) : 0;
  return 1.9 + Math.sqrt(t) * 4.6;
}

/**
 * Which palette slot a dot takes, given what the reader asked colour to mean.
 *
 * It is a **slot**, never a colour — the same indirection `SearchPanel` and the
 * rest of this panel use, so the hues stay in `styles/colourscales.css` where
 * the reasoning about a near-black ground lives (docs/project/colour-scales.md)
 * and this file never names one.
 *
 * The progress ramp uses all nine of its steps — see `RAMP_STEPS` for why that
 * is worth saying, and `tests/colour-scales.test.ts` for the measurement that
 * makes it safe on a near-black page.
 */
function slot(d: Dot, input: ScatterInput, rows: number): number {
  if (input.hue === "topic") return d.point.c;
  if (input.hue === "progress") {
    const t = rows > 1 ? d.row / (rows - 1) : 0;
    return Math.min(RAMP_STEPS - 1, Math.floor(t * RAMP_STEPS));
  }
  return d.part;
}

/** The `DiagramNode` every scatter dot shares, before its position is decided. */
function node(d: Dot, input: ScatterInput, rows: number, cx: number, cy: number, r: number): DiagramNode {
  /* The hit target is a square around the dot, never the dot itself. At three
     pixels across a circle is a target nobody can hit twice, and `arc` and
     `cluster` already solve this the same way — `dot` for the mark, the box for
     the pointer. */
  const hit = Math.max(13, r * 2 + 7);
  return {
    id: d.block.id as unknown as NodeId,
    blockId: d.block.id,
    // Flat: every dot is a paragraph, and none contains another. `aria-level`
    // is depth + 1, so this is a tree of one level, which is what it is.
    depth: 0,
    number: d.number,
    title: d.title || "This paragraph",
    /* The card's second line. A paragraph has no gist — it is the thing a gist
       would compress — so it gets its own opening words, which is the one piece
       of text that says what this dot is. */
    gist: excerpt(d.block.text),
    blocks: 1,
    startRow: d.startRow,
    endRow: d.endRow,
    part: slot(d, input, rows),
    x: cx - hit / 2,
    y: cy - hit / 2,
    w: hit,
    h: hit,
    labelX: cx,
    labelY: cy,
    anchor: "middle",
    // Nothing is written on a dot. Everything a label would say is in the card,
    // and at this density a label per dot is a wall of overlapping text.
    lines: [],
    titleLines: 0,
    dot: { x: cx, y: cy, r },
    hasChildren: false,
    collapsed: false,
    /* **Position and colour are the whole picture, so neither may be the only
       carrier.** A dot says where it is in the article by being high or low (or
       by its hue, on Trail) and says which topic it is in by its hue or its
       lane, and a reader using a screen reader gets neither. So both are in
       words. docs/project/colour-scales.md § Colour is never the only carrier
       is the rule; this is where it lands for a scatter. */
    label: `${d.number ? `${d.number} ${d.title}, ` : ""}paragraph ${d.row + 1} of ${rows}${input.k > 1 ? `, topic ${d.point.c + 1} of ${input.k}` : ""}: ${excerpt(d.block.text, 90)}`,
  };
}

/** The paragraph's opening words, for the card. Cut on a word, never mid-word. */
function excerpt(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/* ── drift ────────────────────────────────────────────────────────────────── */

/**
 * **Drift** — down the page is the article, sideways is what it is talking
 * about.
 *
 * The one picture that answers *"has this piece come back to something?"* with
 * a shape rather than a line: a topic the article returns to is a second stack
 * of dots at the same horizontal position, a long way further down.
 *
 * ### Rows, not words
 *
 * The `strata` picture — cut on 2026-08-27 — was to scale in words, because its
 * bands were *areas*: a long section was a tall band, which was the whole
 * claim. A dot has no extent, so spacing
 * dots by words does not make anything to scale: it piles every dot in a dense
 * section on top of its neighbours and leaves white space where the article was
 * brisk. Rows space them evenly, which is what a scatter needs, and the dot's
 * *size* already carries how long the paragraph is.
 */
export function layoutDrift(
  root: SummaryNode,
  blocks: readonly Block[],
  opts: DiagramOptions,
  input: ScatterInput,
): DiagramLayout {
  const kept = dots(root, blocks, input);
  const rows = bodyRows(blocks);
  const height = Math.max(opts.height, 320, kept.length * ROW + PAD_Y * 2);
  const top = PAD_Y;
  const usableH = Math.max(1, height - PAD_Y * 2);
  const left = PAD_X;
  const right = Math.max(left + 1, opts.width - PAD_X);

  if (kept.length === 0) {
    return { width: opts.width, height, nodes: [], links: [], axis: null, nowY: null };
  }

  const reference = sizeReference(kept.map((d) => d.block.words));
  const y = (row: number) => top + (rows > 1 ? row / (rows - 1) : 0.5) * usableH;
  const spread = robustScale(kept.map((d) => d.point.x), left, right);
  const x: (d: Dot) => number =
    input.axis === "lanes" ? laneX(kept, input.k, left, right) : (d) => spread(d.point.x);

  const nodes = kept.map((d) => {
    const r = radius(d.block.words, reference);
    const cx = Math.min(right, Math.max(left, x(d)));
    return node(d, input, rows, cx, y(d.row), r);
  });

  return {
    width: opts.width,
    height,
    nodes,
    links: [],
    axis: { top, height: usableH, rows },
    /* `null` when the reader is in the apparatus, rather than a line clamped to
       the bottom of the axis: the axis is the argument, and a reader three
       endnotes deep is not standing on its last paragraph. `bodyRowOf`. */
    nowY: ((): number | null => {
      const row = bodyRowOf(blocks, opts.atRow);
      return row === null ? null : y(Math.min(rows - 1, Math.max(0, row)));
    })(),
  };
}

/**
 * Sideways, when the reader has asked for lanes.
 *
 * A lane per topic, ordered left to right by where the topic first gets going
 * (the server does the ordering — src/projection.ts § `orderLanes`).
 *
 * **Within a lane, sideways is the paragraph's own first component**, scaled to
 * that lane's own spread. So the lane is *where the model grouped it* and the
 * position inside the lane is *the same scale `spread` shows across the whole
 * band*, which makes the two modes readings of one number rather than two
 * different pictures.
 *
 * This replaced something that was not true. The first version leaned a dot out
 * of its lane by how far it sat from its topic's centre, and described the
 * direction as *towards the topic it is nearer to* — but lanes are ordered by
 * **where the article gets to them**, so the lane next door is the
 * chronologically adjacent one and has nothing to do with semantic distance.
 * GPT Sol's finding, 2026-08-27. The geometry looked identical either way,
 * which is the whole reason the sentence was worth checking: a picture cannot
 * tell you that its explanation is wrong.
 */
function laneX(kept: readonly Dot[], k: number, left: number, right: number): (d: Dot) => number {
  const lanes = Math.max(1, k);
  const width = (right - left) / lanes;
  const half = width / 2;
  /* One scale per lane, from that lane's own middle 96%. Per-lane rather than
     one global scale, because a lane whose paragraphs are all close together
     would otherwise be a single line of dots — which reads as "these are
     identical" when it means "these are similar, and the article's range is
     wider than this lane's". */
  const scales = new Map<number, (v: number) => number>();
  for (let c = 0; c < lanes; c++) {
    const xs = kept.filter((d) => d.point.c === c).map((d) => d.point.x);
    /* **0.5, not 0.72, and the difference is whether lanes look like lanes.**
       At 0.72 each lane fills nearly all of its own width, so the gutters close
       up and a browser histogram of the dots' x positions came out smeared
       across the whole band — visually indistinguishable from `spread`, which
       is the mode this one exists to be different from. Found in a browser
       pass, 2026-08-27, by counting rather than by looking.

       Half leaves a real gutter either side. The position inside a lane still
       means what it means; it means it in less room. */
    scales.set(c, robustScale(xs, -half * 0.5, half * 0.5));
  }
  return (d) => {
    const c = Math.min(lanes - 1, Math.max(0, d.point.c));
    const centre = left + c * width + half;
    return centre + (scales.get(c)?.(d.point.x) ?? 0);
  };
}

/* ── trail ────────────────────────────────────────────────────────────────── */

/**
 * **Trail** — both axes are meaning, and the line joining the dots is the
 * article.
 *
 * What it shows that Drift cannot: whether the piece *travels* — moving through
 * its subject and never coming back — or *circles*, returning again and again
 * to the same ground. On Drift that is a pattern you read down a column; here
 * it is the shape of a single line, which is the thing an eye is best at.
 *
 * ### 359 segments in a box that holds forty legibly
 *
 * Four things, and none of them is "draw fewer dots":
 *
 *  - the chain is a hairline, and its **opacity ramps with reading position**,
 *    so the beginning of the article is a whisper and the end is clear. Even in
 *    the tangle the eye can find which way the piece was going.
 *  - **an arrowhead every eighth segment**, plus the last. 359 heads in this
 *    box is a texture rather than a direction.
 *  - **the reader's own position is drawn strongly** by the panel, so the
 *    picture can be read while scrolling.
 *  - colour by **progress** is the sensible default here, where the section
 *    hues are the default everywhere else — this is the one picture with no
 *    axis carrying position, so without it nothing says which end of the
 *    article a dot came from.
 */
export function layoutTrail(
  root: SummaryNode,
  blocks: readonly Block[],
  opts: DiagramOptions,
  input: ScatterInput,
): DiagramLayout {
  const kept = dots(root, blocks, input);
  const rows = bodyRows(blocks);
  const height = Math.max(opts.height, TRAIL_MIN_H);
  if (kept.length === 0) {
    return { width: opts.width, height, nodes: [], links: [], axis: null, nowY: null };
  }

  const left = PAD_X;
  const right = Math.max(left + 1, opts.width - PAD_X);
  const top = PAD_Y;
  const bottom = Math.max(top + 1, height - PAD_Y);

  /* **One scale for both axes, and the picture is letterboxed inside the box.**
     Scaling x and y independently to fill the band is the obvious thing and it
     destroys the only claim this picture has: a second component holding 6% of
     the variation would be *stretched taller* than a first component holding
     15%, so a shape the reader took for a wide cluster would be a tall one.
     Distances would mean nothing in any direction. GPT Sol's finding,
     2026-08-27.

     So: the largest number of pixels per unit that fits both spans, applied to
     both, centred. Empty margin is the correct output — it is the picture
     saying that the second axis is the smaller one. */
  const rx = robustRange(kept.map((d) => d.point.x));
  const ry = robustRange(kept.map((d) => d.point.y));
  const spanX = Math.max(rx.hi - rx.lo, 1e-9);
  const spanY = Math.max(ry.hi - ry.lo, 1e-9);
  const perUnit = Math.min((right - left) / spanX, (bottom - top) / spanY);
  const midX = (rx.lo + rx.hi) / 2;
  const midY = (ry.lo + ry.hi) / 2;
  const boxCx = (left + right) / 2;
  const boxCy = (top + bottom) / 2;
  const x = (v: number) => Math.min(right, Math.max(left, boxCx + (v - midX) * perUnit));
  const y = (v: number) => Math.min(bottom, Math.max(top, boxCy + (v - midY) * perUnit));
  const reference = sizeReference(kept.map((d) => d.block.words));

  const placed = kept.map((d) => {
    const r = radius(d.block.words, reference);
    return { d, r, cx: x(d.point.x), cy: y(d.point.y) };
  });

  const nodes = placed.map((p) => node(p.d, input, rows, p.cx, p.cy, p.r));

  /* Which dot the reader is standing on, so the chain can be bright where they
     are. `-1` when the reader is above the article or `?at=` is unset. */
  const at = bodyRowOf(blocks, opts.atRow);
  const here =
    at === null ? -1 : placed.findIndex((p) => at >= p.d.startRow && at <= p.d.endRow);

  const links: DiagramLink[] = [];
  for (let i = 0; i + 1 < placed.length; i++) {
    const a = placed[i];
    const b = placed[i + 1];
    if (!a || !b) continue;
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy);
    const ux = len > 0 ? dx / len : 0;
    const uy = len > 0 ? dy / len : 0;
    const tail = a.r + 0.5;
    /* **An arrowhead at the centre of the target dot is under the dot**, and
       nothing errors — the line still draws and the feature reads as "the
       arrows did not work". `arrowPath` in diagram-d3.ts is the same arithmetic
       for the Force chain, and it learnt the harder half of this in review: two
       marks closer together than their two trims produce a line pointing
       *backwards*, which is a lie rather than a cosmetic fault.

       Here the answer to that case is different, and deliberately. Force can
       drop the whole line, because its bubbles are far apart and a dropped line
       is rare. This chain is the *article*, and a chain with holes in it is not
       one — so a segment with no room for a head keeps the line and **loses the
       arrow**. Direction is carried by the other heads and by the fade; a gap
       would be carried by nothing. */
    const head = b.r + HEAD_GAP;
    const step = chainStep(i, placed.length, here);
    /* **Every segment of the bright run gets a head, and nothing else gets
       one.** Globally there are none, which is the change two design reviews
       and a browser pass reached independently, 2026-08-27: thirty-odd heads
       scattered through a hairball of 263 crossing segments are clutter, and
       *direction along a path you cannot trace is not information*. Inside the
       run the path genuinely is traceable, and there it is a dozen or so heads
       on a line the eye can follow — so every one of them earns its ink. */
    const wanted = step === CHAIN_STEPS - 1;
    const arrow = wanted && len > tail + head + MIN_ARROW_RUN;
    const stop = arrow ? head : b.r + 0.5;
    /* Two dots on top of one another — the article saying the same thing twice
       in a row, or two paragraphs the model cannot tell apart. There is no
       direction to draw and no room to draw it in. */
    if (len <= tail + stop) continue;
    links.push({
      id: `trail${i}-${a.d.block.id}`,
      d: `M ${round(a.cx + ux * tail)} ${round(a.cy + uy * tail)} L ${round(b.cx - ux * stop)} ${round(b.cy - uy * stop)}`,
      // Neutral: the chain is reading order, which belongs to no section. A
      // chain that took its colour from one end would look like a claim about
      // which section owns the transition.
      part: -1,
      /* **`depth` carries how far through the article this segment is**, 0–8,
         and the stylesheet reads it back as opacity. It is not a depth here and
         there is no tree to have one — the field is the one channel a link
         already has, and inventing a second would mean touching every picture's
         stylesheet. Written down because `diagram.ts` is emphatic that `depth`
         stopped being used as a kind, and this is a third use of it. */
      depth: step,
      kind: "sequence",
      /* `arrow`, not `wanted`. The first version computed the room-for-a-head
         check into a variable and then emitted the raw every-eighth rule here,
         so a segment with no room got its arrowhead anyway — a 6px marker on a
         0.6px line, which reads as a stray tick floating between two dots.
         Found by the test above, not by looking at it. */
      ...(arrow && { arrow: true }),
    });
  }

  return { width: opts.width, height, nodes, links, axis: null, nowY: null };
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * How strongly to draw one segment of the chain, 0 (a whisper) to 8 (clear).
 *
 * Two things at once, and they are meant to be:
 *
 * - **globally**, the chain brightens as the article goes on, so even in the
 *   tangle the eye can tell which end it started at;
 * - **locally**, the eight segments either side of where the reader is standing
 *   are drawn at full strength, so the picture can be read *while* scrolling
 *   rather than only studied.
 *
 * The local half is the one that does real work. GPT Sol's review, 2026-08-27,
 * was blunt that fading a 359-segment chain changes its styling and not its
 * information density — which is true, and the answer is not a prettier fade
 * but a picture that answers "where am I in this?" A bright run of sixteen
 * segments is a route a reader can actually follow.
 *
 * The global half is therefore compressed into the lower steps, so that the
 * brightest thing on the picture is always the reader rather than the ending.
 */
function chainStep(i: number, total: number, here: number): number {
  const near = Math.min(NEAR_READER, Math.max(2, Math.round(total * NEAR_READER_SHARE)));
  if (here >= 0 && Math.abs(i - here) <= near) return CHAIN_STEPS - 1;
  const progress = total > 1 ? (i + 1) / total : 1;
  return Math.min(CHAIN_STEPS - 3, Math.floor(progress * (CHAIN_STEPS - 2)));
}

/* ── naming the topics ────────────────────────────────────────────────────── */

/**
 * The three most distinctive words in each topic.
 *
 * tf-idf across the lanes, using the same `terms()` the vocabulary edges use
 * (src/web/graph.ts) — so there is one stopword list in this app and one idea
 * of what a distinctive word is.
 *
 * **A lane has to be arguable with.** A lane labelled "honesty · deception ·
 * candour" can be dismissed by a reader in a second; a lane labelled "Topic 3"
 * cannot be argued with at all, which makes it look more authoritative than it
 * is. Same rule the vocabulary edges follow, and it is the most important thing
 * `diagram.md` records about them.
 */
/**
 * A word folded to something a reader would call the same chip.
 *
 * Not a stemmer and not trying to be: this exists only so that two lane labels
 * cannot read alike, so the cost of being wrong is one lane using its second
 * word instead of its first. `-ies → -y`, `-es`, `-s`, and nothing shorter than
 * four letters is touched (which is `terms()`'s own floor anyway).
 */
function singular(word: string): string {
  if (word.length < 5) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("sses") || word.endsWith("shes") || word.endsWith("ches")) return word.slice(0, -2);
  if (word.endsWith("ss")) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

export function laneTerms(
  points: readonly ProjectionPoint[],
  blocks: readonly Block[],
  k: number,
): string[][] {
  const byId = new Map<BlockId, Block>();
  for (const b of blocks) byId.set(b.id, b);
  const counts: Map<string, number>[] = Array.from({ length: k }, () => new Map());
  const totals = new Array<number>(k).fill(0);

  for (const p of points) {
    const block = byId.get(p.id);
    const lane = counts[p.c];
    if (!block || !lane) continue;
    for (const t of terms(block.text)) {
      lane.set(t, (lane.get(t) ?? 0) + 1);
      totals[p.c] = (totals[p.c] ?? 0) + 1;
    }
  }

  // In how many lanes does a term appear at all — the document frequency.
  const lanesWith = new Map<string, number>();
  for (const lane of counts) {
    for (const t of lane.keys()) lanesWith.set(t, (lanesWith.get(t) ?? 0) + 1);
  }

  const scored = counts.map((lane, c) => {
    const total = Math.max(1, totals[c] ?? 1);
    /* Textbook idf, `log(k / df)`, so a term that appears in **every** lane
       scores exactly zero and drops out.

       The first version used `log(1 + k/df)`, which never reaches zero — and on
       the constitution that left "claude" as the top word of four of the eight
       lanes, because the article's most common noun is common in all of them.
       A legend where half the chips say the same word is a legend that names
       nothing. Measured on the corpus rather than reasoned about. */
    const ranked = [...lane]
      .map(([t, n]) => ({ t, score: (n / total) * Math.log(k / (lanesWith.get(t) ?? 1)) }))
      .sort((a, b) => b.score - a.score || a.t.localeCompare(b.t));
    const useful = ranked.filter((r) => r.score > 0);
    /* Every word in this lane is in every other lane too — a real outcome for a
       very short article with one subject. Fall back to raw frequency so the
       chip still says something, rather than showing an empty lane the reader
       cannot tell from a broken one. */
    return useful.length > 0
      ? useful
      : [...lane].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => ({ t, score: 0 }));
  });

  /* **No two lanes may lead with the same word**, and this is the pass that
     enforces it. Even with a proper idf, two lanes that genuinely both centre
     on the article's dominant noun come back with the same top term — and on
     `constitution` two of eight chips both read "claudes", which is a legend
     that names nothing and looks like a bug in the labelling. Found in a
     browser pass, 2026-08-27.

     **Compared on a crude singular, not on the string**, and that is the second
     round of the same finding: exact matching let "claude" and "claudes" both
     through, so the legend read the same to a human while every string in it
     was distinct. A browser pass on 2026-08-27 found the first pair; the same
     pass after the fix found the second. `terms()` deliberately does not stem —
     it is a tf-idf vocabulary and stemming would merge words that earn their
     own weights — so the fold lives here, where the only question is whether
     two *chips* read alike, and where being crude costs nothing: the worst case
     is a lane stepping down to its second word when it need not have.

     Lanes are served left to right, so an earlier lane keeps the shared word
     and a later one steps down its own list. That is arbitrary between the two,
     and it is the only rule here that could be: what matters is that the reader
     can tell the chips apart, and that the answer is the same on every run. */
  const taken = new Set<string>();
  return scored.map((ranked) => {
    const out: string[] = [];
    for (const { t } of ranked) {
      const key = singular(t);
      if (out.length === 0 && taken.has(key)) continue;
      if (out.length === 0) taken.add(key);
      out.push(t);
      if (out.length === 3) break;
    }
    // Every candidate was already some other lane's headline. Say the word
    // anyway rather than an empty chip — a repeat is honest, a blank is not.
    if (out.length === 0 && ranked[0]) out.push(ranked[0].t);
    return out;
  });
}
