/**
 * **The Diagram mode's shared vocabulary** — the words every picture is
 * described in, computed as pure numbers so they can be tested without a
 * browser.
 *
 * No picture is laid out here any more. `force` is
 * [diagram-d3.ts](./diagram-d3.ts) over [graph.ts](./graph.ts); `drift` and
 * `trail` are [scatter.ts](./scatter.ts) over the server's projection. What is
 * left in this file is what all three need — `DiagramNode`, `DiagramLink`,
 * `walk`, `wrapText`, `LABEL_PX` — plus the two readers of a finished layout,
 * `stepStops` and `nodeAt`.
 *
 * Greg, 2026-08-26:
 *
 * > Let's try adding a new "Diagram" mode that generates diagrams/maps of the
 * > structure of the doc … Add toggles to switch between different modes. Try
 * > coming up with multiple ideas, e.g. mindmap, something that preserves the
 * > structure of the doc. … It would be amazing if it was interactive. … it
 * > will take up a few columns in the middle, so it should probably be
 * > vertically narrow, and think of the article's ordering as top to bottom.
 *
 * ## Nothing was installed for the hand-rolled outline, and that is a finding
 *
 * Read this as history rather than as current fact. It is the survey that was
 * run for the original `tree` picture, which was hand-rolled here and was cut
 * on 2026-08-30; the three pictures that are left *are* D3-driven, over a
 * richer data structure that did not exist when the survey was run. It stays
 * because it is the reasoning behind the one property none of them gave up —
 * down the page is later in the article — and because the next person to reach
 * for a mindmap library should read it before they do. See
 * [diagram-d3.ts](./diagram-d3.ts) for what changed.
 *
 * GPT-5.6 Luna was sent to survey the field first, per
 * docs/reusable/third-party-library-selection.md — d3-hierarchy, @visx/hierarchy,
 * @xyflow/react, markmap, Mermaid, cytoscape, elkjs, dagre, G6, Sigma, nivo,
 * react-d3-tree. What it said is summarised in docs/plans/260826ah-diagram-mode.md —
 * the answer itself is 38KB of npm metadata with a shelf life of weeks and is
 * deliberately not in git. Its verdict, and ours after checking it:
 *
 *  - The only library with real work in it for us is **d3-hierarchy**, and the
 *    two functions we would want from it — `tree()` and `partition()` — are the
 *    two Luna talks us *out of*. `tree()` spaces leaves by tree geometry rather
 *    than by how much article they stand for, and a rotated `partition()` puts
 *    **depth on the horizontal axis**, which in a 288px band is the one axis we
 *    have not got. What is left of d3-hierarchy after that is `hierarchy()`,
 *    which builds the nested structure we are already handed by
 *    `buildSummaryTree` (src/web/tree.ts). A dependency for nothing.
 *  - Everything graph-shaped — React Flow, Cytoscape, G6, Sigma, elkjs, dagre —
 *    is a node editor or a force layout. Both throw away the one property this
 *    picture must keep, which is that **down the page is later in the article**.
 *  - Markmap and Mermaid mindmaps expand *sideways*. In this band that is not a
 *    styling problem, it is the wrong shape.
 *
 * So: hand-rolled SVG, dependency-free modules, and the layout arithmetic lives
 * in its own file rather than inside a component, because that is what makes it
 * testable.
 *
 * ## What is left, after the cuts
 *
 * ```
 *          force                    drift / trail
 *   ┌───────────────┐            ┌───────────────┐
 *   │    ◯───◯      │            │  ·   ·  ·     │
 *   │   ╱ ╲ ╱       │            │ ·  ·   ·  ·   │
 *   │  ◯───◯····◯   │            │   ·  ·        │
 *   │   ╲   ╲       │            │  ·   ·  ·   · │
 *   │    ◯───◯      │            │ ·  ·      ·   │
 *   │               │            │   ·  ·  ·     │
 *   └───────────────┘            └───────────────┘
 *    sections pulled              one dot per
 *    together by the              paragraph, placed
 *    words they share             by what it is about
 * ```
 *
 * Neither is in this file, and what they share is. That is why a router that
 * knows about both is its own file ([diagrams.ts](./diagrams.ts)) rather than a
 * function at the bottom of this one.
 *
 * **Nothing in this mode is to scale.** That was already true once `strata`
 * went, and the spine beside the band is still where the reader gets a sense of
 * proportion.
 *
 * ## Why text is wrapped by counting characters
 *
 * SVG will not wrap text, and the honest way to place a label is to render it,
 * measure it, and lay out again. That is two passes and a `ResizeObserver`, and
 * it makes every one of these functions untestable. So `wrapText` estimates
 * from a character width measured once against the UI font — which is wrong by
 * a few per cent on any given string, and the failure it produces is a line
 * ending slightly early or slightly late rather than a diagram that breaks.
 * No label is only ever available truncated: every node's full title, gist and
 * paragraph count are in the footer card whenever the pointer or the keyboard is
 * on it, and in its `aria-label` for anything reading the tree aloud.
 */
import { isBody } from "../block-policy.js";
import type { Block, BlockId, NodeId } from "../types.js";
import type { SummaryNode } from "./tree.js";

/**
 * Which picture. In the URL as `?diagram=` — see params.ts § diagramParam.
 *
 * **Three, and there were eight.** Greg cut Strata, Mindmap, Arc and Cluster on
 * 2026-08-27, and Tree on 2026-08-30. All five share one property: each was a
 * second way of drawing something the reader could already get elsewhere.
 * Mindmap and Cluster were the containment tree with different geometry. Arc
 * drew the vocabulary edges that `force` draws, on a line rather than in a
 * plane. And Tree, which outlasted them by three days, was the contents page
 * with dots on it —
 *
 * > it's not interesting enough to keep, and it overlaps too much with
 * > Hierarchy and Outline mode etc.
 * >
 * > — Greg, 2026-08-30
 *
 * Strata is still the odd one out and the real loss: it was to scale, and
 * nothing here is any more. Its question — *how much of the piece is that
 * section?* — is answered by the spine beside the band, which is weaker and is
 * the price of a toggle bar you can take in at a glance.
 *
 * What is left is one picture per **kind of thing to say**: `force` is the
 * relationships an outline cannot hold ([diagram-d3.ts](./diagram-d3.ts) over
 * [graph.ts](./graph.ts)), and `drift` and `trail` are the article as
 * paragraphs placed by meaning ([scatter.ts](./scatter.ts)). The order runs
 * from the most faithful to the article's own shape to the most interpretive.
 *
 * **All three now cost a model call**, which is what ended the argument for a
 * free default. `force` is the cheapest of them and the only one that draws
 * something real before its answer lands — four of its five kinds of line are
 * arithmetic over prose the browser already holds — so it is the default, and
 * the other two show a spinner rather than borrowing a picture that is not
 * theirs. See [diagrams.ts](./diagrams.ts).
 *
 * **`illustrated` is fifth and is not geometry at all** — it is a JPEG an image
 * model painted from the Sketch's scene, so nothing in this module lays it out
 * and the three tables below carry a stated row rather than a number
 * (docs/project/diagram.md § Illustrated). It sits last because the order runs
 * from the most faithful to the most interpretive, and it is the one picture
 * here that cannot be checked against the article at all.
 */
export const DIAGRAMS = ["force", "drift", "trail", "sketch", "illustrated"] as const;
export type DiagramKind = (typeof DIAGRAMS)[number];

/**
 * One drawn node, in diagram coordinates.
 *
 * `box` is the hit target and the thing that gets painted; `label` is where the
 * text goes, which is not always inside the box (a mindmap's twig label sits
 * beside its dot). Both are here rather than derived in the component, so that
 * a test can assert a label never leaves the viewBox.
 */
export interface DiagramNode {
  /** The tree's own node id — React key, and the collapse set's member. */
  id: NodeId;
  /** What a click jumps to: the first block of this node's range. */
  blockId: BlockId;
  depth: number;
  /** "2.3" — the reader's address. Empty string for the root. */
  number: string;
  title: string;
  gist?: string;
  /** How many blocks are under this — the number the gist columns cannot show. */
  blocks: number;
  startRow: number;
  endRow: number;
  /** Which L1 part this is inside, 0-based. -1 for the root itself. Drives hue. */
  part: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where the text starts, and how it is anchored to that point. */
  labelX: number;
  labelY: number;
  anchor: "start" | "middle" | "end";
  /** The label, already wrapped. Empty when the node is too small to hold one. */
  lines: string[];
  /**
   * How many of `lines` are the title; the rest are the gist.
   *
   * A stored count rather than a rule, because the obvious rule — "the first
   * two are the title" — is wrong exactly when the title took one line and the
   * gist took three, which is the common case at depth 0. The component styles
   * gist lines differently and wraps them to a smaller font, so getting this
   * wrong renders a gist line at title size and pushes it out of the band.
   */
  titleLines: number;
  /**
   * A mark drawn apart from the box, for the pictures whose hit target is a row
   * but whose *node* is a point — a scatter dot's 3px circle inside a hit
   * rectangle big enough to press with a finger.
   *
   * Separate from `x`/`y`/`w`/`h` on purpose: those are what the reader has to
   * be able to hit, and a 3px circle is not that. Conflating the two is how a
   * picture ends up looking right and being unclickable.
   */
  dot?: { x: number; y: number; r: number };
  hasChildren: boolean;
  collapsed: boolean;
  /**
   * What a screen reader is told, when the title and the block count are not
   * enough.
   *
   * The default label is `"<number> <title>, N paragraphs"`, which is the whole
   * of what a section node is. A scatter dot is not: its position carries how
   * far through the article it is and which topic the model put it in, and
   * **colour is the only thing carrying either** — which is precisely what
   * docs/project/colour-scales.md says colour must never be. So the pictures
   * that spend position on something say it here instead.
   */
  label?: string;
}

/** A connector. `d` is an SVG path in the same coordinates as the nodes. */
/**
 * What a line between two nodes claims.
 *
 * The union lives here rather than in [graph.ts](./graph.ts), where it is
 * *meant* — `GraphEdge.kind` is an alias for this — because a `DiagramLink`
 * carries it and diagram.ts may not import graph.ts. graph.ts imports this
 * file, and a type going the other way would be an import cycle, which
 * `npm run check` gates on (docs/project/static-analysis.md).
 *
 * The cut tree pictures left `kind` unset, on the grounds that on a tree every
 * line is containment. It is required now — see `DiagramLink.kind` below.
 */
export type LinkKind = (typeof LINK_KINDS)[number];

/**
 * Every kind, as a value — so a test can iterate them and a missing stylesheet
 * rule is a failure rather than a line quietly drawn in the base grey.
 * `LinkKind` above is derived from this, so the two cannot drift.
 */
export const LINK_KINDS = [
  /** Containment: a part to one of its sections. */
  "parent",
  /** Reading order — the chain through the article. Drawn thick, with an arrow. */
  "sequence",
  /** The **author** linked these two passages. The one edge here that is a fact. */
  "anchor",
  /** Shared distinctive words, by tf-idf cosine. A hint about subject matter. */
  "vocabulary",
  /** Similar meaning, by embedding. Drawn dotted, because it is inferred. src/similar.ts. */
  "semantic",
] as const;

interface DiagramLinkBase {
  id: string;
  d: string;
  part: number;
  /**
   * **A per-picture rendering band, and it means a different thing in each.**
   *
   * On `force` it is the depth of the node the line hangs off; on `trail` it is
   * the step of the sequential ramp the segment is painted at. It has also been
   * an edge's quantised *weight* (`arc`, cut) and an edge's *kind* (`force`,
   * until five kinds outgrew three numbers) — that last use is what `kind`
   * below replaced.
   *
   * The honest description of this field is that it is a channel a layout may
   * use, not a fact about the graph. GPT Sol pointed out that Arc had already
   * made it one; pretending otherwise here would be the kind of comment that is
   * worse than none.
   */
  depth: number;
  /**
   * Draw an arrowhead at the target end.
   *
   * A field rather than something the stylesheet derives from `kind`, because
   * `marker-end` cannot be applied usefully by a class on its own: the marker
   * has to be referenced by id, and the id belongs to the `<defs>` the panel
   * writes.
   */
  arrow?: boolean;
}

/**
 * One drawn line.
 *
 * **A union on `kind`, not an interface with two optional fields**, and that is
 * the whole of why it is shaped like this. `kind` itself is required for the
 * reason it always was: an optional discriminator would let a sixth kind of
 * Force edge be added, forget to say what it is, and compile.
 *
 * The `from`/`to` pair is newer and needed the union. `chainNearness` walks the
 * chain by its endpoints, so a `sequence` link that failed to name them is not
 * a line with a missing field — it is a **break in the chain**, and the ramp
 * either side of it silently stops. Optional fields make that state
 * representable and a producer one edit away from it; here `sequence` requires
 * both and the other four kinds forbid them.
 *
 * **`from?: never` rather than leaving them off**, because leaving them off
 * forbids the bad combination only in a fresh object literal — assign a named
 * `const` with a stray `from` on it and excess-property checking does not run.
 * The `never` is what makes the second branch reject it either way.
 *
 * GPT Sol asked for a runtime guard as well, and there is deliberately none:
 * with two producers, both in this repo and both compiled against this type,
 * the malformed case cannot be constructed, and a check no fixture can redden
 * is decoration. These are never deserialised — they are built in-process and
 * handed straight to React.
 */
export type DiagramLink =
  | (DiagramLinkBase & {
      kind: "sequence";
      /**
       * The two nodes the line runs between, in the direction it is drawn.
       *
       * Node *ids*, not indices. The chain is a sorted subset of the drawn nodes
       * on Force and every dot on Trail, so an index into "the links array"
       * means a different thing in each — and the panel, which is where the two
       * meet, holds neither array's ordering.
       */
      from: NodeId;
      to: NodeId;
    })
  | (DiagramLinkBase & {
      kind: Exclude<LinkKind, "sequence">;
      from?: never;
      to?: never;
    });

/**
 * How many steps of the ramp the sequence chain gets, nearest the reader first.
 *
 * Greg, 2026-08-30:
 *
 * > making the connections directly either side of the current node most
 * > prominent. Then a bit fainter for the ones at one remove, then a bit
 * > fainter for the ones at two removes, etc etc.
 *
 * Eight, because the range the ramp has to spend is about 0.45 of opacity — the
 * chain sits at 0.5 and the top of the ramp is as bright as its colour goes —
 * and eight steps of it is 0.06 apiece, which is roughly the smallest change in
 * a 2px stroke that reads as a difference rather than as the same line. More
 * steps would be a finer gradient than an eye can pick up; fewer would show the
 * banding.
 *
 * Level 8 is *not* a class. It is the chain's ordinary styling, which is what
 * the ramp lands on — see `chainNearness`.
 */
export const CHAIN_NEAR_LEVELS = 8;

/**
 * How far the ramp reaches along the chain, in hops — the distance at which it
 * has finished fading back into the chain's ordinary styling.
 *
 * Capped at `CHAIN_NEAR_LEVELS` so no two adjacent segments share a level, and
 * **capped again at a sixth of the whole chain**. The second cap is the one
 * that was learnt rather than chosen: Trail's chain runs to 359 segments on a
 * long article and 29 on a short one, and a fixed reach of eight is a local
 * landmark on the first and *most of the picture* on the second — a "you are
 * here" covering three fifths of the chain is not a landmark, it is a wash.
 * That was caught by a test rather than by looking, because at 320 pixels wide
 * both versions look like a picture with a bright bit in it.
 *
 * The floor of 3 is so that a twelve-section article still gets a gradient
 * rather than one bright pair and a hard edge. A sixth where the plateau this
 * replaced used a sixteenth, for the same reason: the run is *graded* now, so
 * its outer segments are already back at the chain's own weight and reaching
 * further costs the picture almost nothing.
 */
export function chainReach(segments: number): number {
  return Math.min(CHAIN_NEAR_LEVELS, Math.max(3, Math.round(segments / 6)));
}

/** Every chain link touching a node, so a walk can step from one to the next. */
type ChainLink = Extract<DiagramLink, { kind: "sequence" }>;

function chainAdjacency(chain: readonly ChainLink[]): Map<NodeId, ChainLink[]> {
  const touching = new Map<NodeId, ChainLink[]>();
  for (const l of chain) {
    for (const end of [l.from, l.to]) {
      const at = touching.get(end);
      if (at) at.push(l);
      else touching.set(end, [l]);
    }
  }
  return touching;
}

/**
 * How many links along the chain each node is from `here`, out to `reach`.
 *
 * Node distances rather than link distances, because a link's distance is then
 * the *nearer* of its two ends — which is what makes the two lines either side
 * of the reader both come out at zero. Walking link to link instead needs this
 * same map to find the neighbours and then has to remember not to count the
 * node they share.
 */
function hopsFrom(
  touching: ReadonlyMap<NodeId, ChainLink[]>,
  here: NodeId,
  reach: number,
): Map<NodeId, number> {
  const hops = new Map<NodeId, number>([[here, 0]]);
  let frontier: NodeId[] = [here];
  for (let d = 1; d <= reach && frontier.length > 0; d++) {
    const next: NodeId[] = [];
    for (const n of frontier) {
      for (const l of touching.get(n) ?? []) {
        const other = l.from === n ? l.to : l.from;
        if (hops.has(other)) continue;
        hops.set(other, d);
        next.push(other);
      }
    }
    frontier = next;
  }
  return hops;
}

/**
 * Which step of the ramp each sequence link is painted at — 0 for the two lines
 * that touch the node the reader is standing in, rising to `CHAIN_NEAR_LEVELS`
 * for everything far enough away to be drawn as the chain always was.
 *
 * **Computed here rather than in the layouts, and that is the point.** Force's
 * layout is a d3 simulation of several hundred ticks; handing it the reader's
 * scroll position would re-run the whole thing on every scroll in order to
 * change a class name. Trail's layout does already take `atRow` — it needs it
 * for the arrowheads, which are geometry — but having it decide brightness too
 * left two pictures computing one idea in two files and two units. So the
 * layouts say what the chain *is* (`from`/`to` on `DiagramLink`) and this says
 * where the reader is standing on it.
 *
 * **The ramp only ever brightens.** Its far end is the chain's ordinary
 * styling, so a link past the reach is left unclassed rather than dimmed — the
 * alternative, fading the distant chain away, puts a visible cliff wherever the
 * ramp stops and takes the far half of the article with it. Emphasis near the
 * reader and emphasis-by-dimming-everything-else look the same to an eye and
 * are not the same picture.
 *
 * A breadth-first walk rather than index arithmetic, because "the chain" is a
 * path the layout built and not a property of the array's order: Force sorts
 * its chain by `startRow` and puts the parent, anchor, vocabulary and semantic
 * edges in the same array, and Trail drops any segment whose two dots coincide.
 * Neither array means "index i joins node i to node i+1".
 *
 * Returns an empty map when the reader is nowhere — no `?at=`, or above the
 * article — which leaves the chain unmodulated rather than silently picking the
 * first node as a centre. Likewise when the reader's node is not on the chain
 * at all, which is a real state: Trail draws no dot for a paragraph inside the
 * apparatus, and a reader standing in the endnotes belongs nowhere on a chain
 * made of body paragraphs.
 *
 * **It assumes the chain is a simple path**, which both producers guarantee —
 * Force sorts a set of distinct leaves, Trail walks distinct dots. Hand it a
 * chain that visits one node twice and the walk would collapse the two
 * occurrences and take the shorter graph distance, lighting both places the
 * node appears. Written down rather than defended against: a guard for a shape
 * no producer can emit is a clause no test can redden.
 */
export function chainNearness(
  links: readonly DiagramLink[],
  here: NodeId | null,
): Map<string, number> {
  const out = new Map<string, number>();
  if (here === null) return out;

  const chain = links.filter((l) => l.kind === "sequence");
  const touching = chainAdjacency(chain);
  if (!touching.has(here)) return out;

  const reach = chainReach(chain.length);
  const hops = hopsFrom(touching, here, reach);

  for (const l of chain) {
    const a = hops.get(l.from);
    const b = hops.get(l.to);
    if (a === undefined && b === undefined) continue;
    const d = Math.min(a ?? Number.POSITIVE_INFINITY, b ?? Number.POSITIVE_INFINITY);
    /* Scaled to the reach rather than used raw, so that the ramp covers the
       same *range* whether it is walking 8 hops of a long article or 3 of a
       short one — and so its far end always lands on `CHAIN_NEAR_LEVELS`, the
       unclassed chain, rather than stopping part-way down and leaving a step.

       The range, not eight distinct steps: at reach 3 the levels emitted are 0,
       3 and 5, and then the boundary. Three hops cannot be graded eight ways,
       and the thing worth preserving is where the ramp *ends*, not how finely
       it is cut on the way. GPT Sol, 2026-08-30, on an earlier version of this
       comment that said "the same eight steps" and meant it literally. */
    const level = Math.round((d / reach) * CHAIN_NEAR_LEVELS);
    if (level < CHAIN_NEAR_LEVELS) out.set(l.id, level);
  }
  return out;
}

export interface DiagramLayout {
  width: number;
  height: number;
  nodes: DiagramNode[];
  links: DiagramLink[];
  /**
   * The extent of the article's own axis, for tests — present only on a
   * picture whose vertical axis really is the article, which today means
   * `drift` (scatter.ts).
   *
   * `rows` is in whatever unit that picture is measuring in.
   * **Nothing outside the layout that produced it may do arithmetic with it**;
   * use `nowY` below.
   */
  axis: { top: number; height: number; rows: number } | null;
  /**
   * Where the reader is, already converted — or null if they are above the
   * article or this picture has no article axis.
   *
   * **This is a `y`, not a ratio, and that is the whole point.** It used to be
   * the panel's job: it divided `atRow` by `axis.rows` and drew a line. That was
   * correct while both were block counts and became silently wrong the moment
   * `rows` started counting words — the line still drew, still moved as you
   * read, and pointed at the wrong place on any article whose paragraphs are not
   * all the same length. Found by GPT Sol, 2026-08-27.
   *
   * A unit conversion belongs where the unit is decided. There is exactly one
   * place that knows what unit a given picture's axis is in, and it is the
   * layout function that chose it.
   */
  nowY: number | null;
}

export interface DiagramOptions {
  /** The band's inner width in px — what the SVG viewBox is scaled to. */
  width: number;
  /** How tall the scroller is. A picture may be taller; `strata` tries not to be. */
  height: number;
  /** Node ids the reader has closed. Their children are not laid out at all. */
  collapsed: ReadonlySet<NodeId>;
  /**
   * Where the reader is, as a row index into the article's blocks — so that the
   * one function that knows this picture's unit can convert it. See
   * `DiagramLayout.nowY`. Also what the panel's step buttons move.
   */
  atRow?: number | null;
  /**
   * Words per block, as a prefix sum — `wordsBefore` from graph.ts.
   *
   * Optional, and left in place after `strata` — the picture it was added for —
   * was cut, because it is how any future picture would make its vertical axis
   * mean **words** rather than blocks. Eight long paragraphs and eight one-line
   * list items are the same number of blocks and very different amounts of
   * article; that was GPT Sol's finding against the first round of `strata`,
   * and it is the sort of thing worth keeping the input for.
   */
  wordsBefore?: readonly number[];
}

/* ── shared ─────────────────────────────────────────────────────────────── */

/**
 * Average glyph width as a fraction of font size, for the UI sans at the sizes
 * this panel uses. Measured once in the browser rather than guessed: 0.52 is
 * about right for mixed-case Inter-ish text at 11–12px. See the file header for
 * why an estimate is the design rather than a corner cut.
 */
const CHAR_W = 0.52;

/**
 * **The font size every label is actually set at**, by picture and by depth —
 * and the reason this is a table rather than a number at each call site.
 *
 * `wrapText` cuts a label to fit by counting characters at a font size. The
 * stylesheet then paints it at whatever `§ diagram mode` says. **When those two
 * disagree nothing errors**: too small and the band is 8% emptier than it needed
 * to be, too large and the text runs out over the article, and SVG neither wraps
 * nor clips so there is nothing to see in the console either way. Both of those
 * were live here before this table existed — tree titles were budgeted at 12px
 * and painted at 10, and mindmap twigs were budgeted at 10.5 and painted at 11.
 *
 * So the numbers live here, the layouts read them, and
 * `tests/diagram-css.test.ts` reads the stylesheet and asserts it agrees. That
 * makes a mismatch a red test rather than a rendering nobody questions.
 */
/**
 * The pictures that write **nothing at all** on a node.
 *
 * Drift and Trail are dots — 276 of them on a long article — and a label per
 * dot would be a wall of overlapping text. Everything a label would have said
 * is in the footer card and in each dot's `aria-label`.
 *
 * It is a named set rather than an implicit consequence of `lines` being empty,
 * because `tests/diagram-css.test.ts` demands a stylesheet rule for every
 * kind × depth in `LABEL_PX` and treats a missing one as a failure — which is
 * exactly the right rule and the reason it exists. A kind that legitimately has
 * no rule has to say so out loud, and the test then checks the *other*
 * direction too: these two must have no label font-size anywhere, or the
 * arithmetic and the stylesheet would be disagreeing again with nothing to
 * catch it.
 */
/* `sketch` is here for a different reason from the other two, and it is worth
   the sentence. Drift and Trail draw dots that have no room for a word. Sketch
   is nothing BUT words — it simply does not come through this module at all:
   its geometry is src/sketch-paint.ts and its type scale is `SIZE_PX` in
   src/sketch-scene.ts, so `LABEL_PX` has nothing to say about it and a number
   here would be a rule nothing reads. */
/* `illustrated` is here for a *third* reason, and it is the strongest of the
   three: there is no SVG at all. The picture is a JPEG fetched from
   `/api/illustrated/:slug/:hash.jpeg` (src/web/IllustratedView.tsx), so there is
   no node to write on, no font for the stylesheet to set, and nothing this
   module could lay out if it wanted to. The words that would have been labels
   are the *what it depicts* list underneath, which is HTML. */
export const UNLABELLED: ReadonlySet<DiagramKind> = new Set<DiagramKind>([
  "drift",
  "trail",
  "sketch",
  "illustrated",
]);

export const LABEL_PX: Record<DiagramKind, Record<number, number>> = {
  // Only a number goes inside a force bubble, and it is small.
  force: { 0: 10, 1: 10, 2: 10 },
  /* Never read: `sketch` does not use this module's geometry at all. Present
     because the record is keyed by `DiagramKind`, and `UNLABELLED` above is
     what makes that a stated fact rather than a forgotten row. */
  sketch: {},
  /* Never read either, and one step further out: `illustrated` draws a raster
     image rather than any geometry at all, so there is not even a painter for
     this table to disagree with. */
  illustrated: {},
  /* Nothing is written on a scatter dot at all — `lines` is always empty
     (src/web/scatter.ts). These entries exist because the record is keyed by
     `DiagramKind` and a missing one would be a type error rather than a
     picture; `tests/diagram-css.test.ts` skips a kind that never draws a label. */
  drift: { 0: 11, 1: 11, 2: 11 },
  trail: { 0: 11, 1: 11, 2: 11 },
};

/**
 * Baseline-to-baseline step, by picture and by which half of the label a line
 * is in.
 *
 * The same contract as `LABEL_PX` and a sharper version of the same bug: the
 * layout reserves `titleLines * title + gistLines * gist` pixels of row, and the
 * component advances the `<tspan>`s by these. Advance by more than was reserved
 * and a gist runs into the row below it — which, in a tree of forty rows, reads
 * as slightly uneven spacing rather than as an overflow.
 */
export const LINE_STEP: Record<DiagramKind, { title: number; gist: number }> = {
  /* Never read, for the reason `LABEL_PX` gives one table up. */
  sketch: { title: 0, gist: 0 },
  /* Nor this one: a JPEG has no `<tspan>`s to advance. */
  illustrated: { title: 0, gist: 0 },
  // Force puts one line on a node and the rest in the footer card.
  force: { title: 12, gist: 12 },
  // The two scatters write nothing on a dot; everything is in the card.
  drift: { title: 13, gist: 13 },
  trail: { title: 13, gist: 13 },
};

/** How many characters fit in `px` at `fontPx`. At least one, so wrapping ends. */
export function charsThatFit(px: number, fontPx: number): number {
  return Math.max(1, Math.floor(px / (fontPx * CHAR_W)));
}

/**
 * Greedy word wrap to a character budget, capped at `maxLines` with an ellipsis
 * on the last one.
 *
 * A single word longer than the budget is hard-cut rather than allowed to
 * overflow — a URL or a chemical name in a heading would otherwise run out of
 * the band, and running out of the band is invisible in SVG (no clipping, no
 * error, just text over the article).
 */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  if (maxLines <= 0 || maxChars <= 0) return [];
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  /* Tracked as a flag rather than inferred at the end by counting words in the
     result. Counting is what this did first, and it is wrong for exactly the
     case the hard cut below exists for: a word cut into three fragments *is*
     three words in the output and one in the input, so a truncation of a long
     word looked like a text that had grown, and got no ellipsis. */
  let cut = false;
  for (const raw of words) {
    let word = raw;
    // Hard-cut an over-long word, one budget at a time, before it can overflow.
    while (word.length > maxChars) {
      if (line) {
        lines.push(line);
        line = "";
      }
      if (lines.length >= maxLines) {
        cut = true;
        break;
      }
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
      cut = true;
    }
    if (lines.length >= maxLines) {
      cut = true;
      break;
    }
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars) {
      line = next;
    } else {
      if (line) lines.push(line);
      line = word;
    }
    if (lines.length >= maxLines) {
      cut = true;
      break;
    }
  }
  if (line) {
    if (lines.length < maxLines) lines.push(line);
    else cut = true;
  }
  if (lines.length === 0) return [];
  // Truncated: say so rather than stopping mid-sentence, and spend a character
  // of the budget on the ellipsis rather than overflowing by one.
  if (cut) {
    const last = lines[lines.length - 1] ?? "";
    lines[lines.length - 1] =
      last.length + 1 > maxChars ? `${last.slice(0, Math.max(0, maxChars - 1))}…` : `${last}…`;
  }
  return lines;
}

/**
 * The tree in reading order, each node tagged with the L1 part it lives in.
 *
 * Preorder, and children in the order the tree stores them, which is document
 * order — that is the whole invariant every one of these pictures rests on.
 * A collapsed node keeps its own entry and loses its subtree, which is what
 * makes "I closed this" different from "there is nothing here" (SummaryPanel.tsx
 * § two ways to be hidden).
 */
/**
 * The deepest level any picture draws.
 *
 * `buildSummaryTree` already stops at 2 by default and `DiagramBand` takes the
 * default, so today this changes nothing. It is here because the layouts
 * silently assume it — the stylesheet has font sizes and fills for `diag-d0` to
 * `diag-d2` and nothing below, and `graph.ts` calls a node at this depth a leaf
 * whether or not it has children. Raising `buildSummaryTree`'s limit for some
 * other caller must not quietly change what these pictures draw, so the ceiling
 * is asserted here rather than inherited.
 */
export const MAX_DRAWN_DEPTH = 2;

export interface WalkEntry {
  node: SummaryNode;
  part: number;
  collapsed: boolean;
}

export function walk(
  root: SummaryNode,
  collapsed: ReadonlySet<NodeId>,
  maxDepth = MAX_DRAWN_DEPTH,
): WalkEntry[] {
  const out: WalkEntry[] = [];
  const visit = (n: SummaryNode, part: number) => {
    const isClosed = collapsed.has(n.node.id);
    const hidden = n.node.depth >= maxDepth;
    out.push({ node: n, part, collapsed: isClosed && n.children.length > 0 });
    if (isClosed || hidden) return;
    n.children.forEach((c, i) => {
      // The part index is minted at depth 1 and carried down unchanged: every
      // node below a part belongs to that part, however deep it goes.
      visit(c, n.node.depth === 0 ? i : part);
    });
  };
  visit(root, -1);
  return out;
}

/**
 * One rung of the step ladder: a row, and what pressing there jumps to.
 *
 * Both, because **the two are not always the same number** — see `stepStops`.
 */
export interface StepStop {
  /** The row of the block this rung jumps to. What `stepTarget` steps between. */
  row: number;
  blockId: BlockId;
  id: NodeId;
}

/**
 * **The rungs a picture can step between** — ascending, one per distinct row,
 * and what the panel's ↑ / ↓ buttons walk.
 *
 * Rows rather than nodes, and that is the first half of the design. A layout's
 * `nodes` are in *preorder*, so on Force the root, part 1 and section 1.1 all
 * begin on the same row: stepping by node would press ↓ three times and move
 * the article nowhere, which reads as a broken button. Distinct rows make one
 * press always one visible move — and they make the *unit* come out right by
 * itself, sections on Force and single paragraphs on the two scatters, because
 * those are the rows those pictures draw.
 *
 * **The row is the row of `blockId`, not `startRow`, and that is the second
 * half.** They agree on Force, where a node's range begins at the block it
 * jumps to. They do **not** agree on a scatter: a dot's range is
 * stretched to tile the article so that a reader standing in a paragraph too
 * short to embed still has a dot answering for them (scatter.ts § dots), so the
 * first dot claims `startRow: 0` while its block may be the third paragraph.
 * A ladder built from `startRow` therefore has a rung at row 0 whose jump lands
 * at row 2 — and **Previous, from row 1, moves the reader down the page**.
 * GPT Sol's finding on the built code, 2026-08-27.
 *
 * `rowOf` is the article's own block→row index, which the panel already holds.
 * A node whose block is not in it (a stale layout mid-re-ingest) falls back to
 * `startRow` rather than being dropped: a rung in slightly the wrong place is a
 * smaller failure than a button that does nothing.
 *
 * Where two nodes share a row the **deepest** one wins, which is `nodeAt`'s
 * rule and the same reason: the deepest node is the most specific thing the
 * reader could mean, and the card should describe that rather than its parent.
 *
 * Here rather than in the component so it can be tested. The failure this
 * guards against is a button that looks fine and goes the wrong way, which is
 * the shape docs/reusable/silent-success.md is about.
 */
export function stepStops(
  nodes: readonly DiagramNode[],
  rowOf: ReadonlyMap<BlockId, number>,
): StepStop[] {
  const best = new Map<number, DiagramNode>();
  for (const n of nodes) {
    const row = rowOf.get(n.blockId) ?? n.startRow;
    const held = best.get(row);
    if (!held || n.depth > held.depth) best.set(row, n);
  }
  return [...best.entries()]
    .sort(([a], [b]) => a - b)
    .map(([row, n]) => ({ row, blockId: n.blockId, id: n.id }));
}

/**
 * **The same ladder for a picture made of paragraphs — but its rungs are the
 * article's paragraphs rather than the picture's dots.**
 *
 * Greg, 2026-08-31: *"If I press down, it seems to jump more than one
 * paragraph."* He was right, and `stepStops` was the reason. On Drift and Trail
 * a node is one embedded paragraph, and a block under `MIN_WORDS` is never
 * embedded (src/article-vectors.ts) — so a dot ladder walks past every short
 * paragraph in the article. Measured on Gwern's scaling-hypothesis, where the
 * panel's own strip says *84 too short or not prose to place*: one press moved
 * the reader two block rows, every time.
 *
 * A paragraph with no dot is still a paragraph the reader is standing in, and
 * the picture already knows which dot answers for it — **a dot's range is
 * stretched to tile the article** precisely so that the mark never blinks out
 * (scatter.ts § dots). So the rung carries `nodeAt`'s answer, which is the same
 * rule the you-are-here mark uses, and the two cannot disagree.
 *
 * **Body rows only.** The axis of both scatters is the argument, the dots stop
 * at the last body row, and `nowY` is deliberately null in the apparatus — so a
 * rung on an endnote would step the reader somewhere the picture says nothing
 * about. Same predicate `bodyOrdinals` counts with, so the readout's
 * denominator and the ladder are the same set.
 *
 * **What this gives up, said rather than discovered.** On Trail the only mark
 * is the lit dot and the brightened chain, so where two paragraphs share a dot
 * a press moves the text and not the picture. That is the inverse of the
 * failure `stepStops` was written to avoid — three presses and the article
 * moves nowhere — and it is the better half of the trade: the reader pressed a
 * button to move through the article, and the article moved. On Drift nothing
 * is given up at all, because `nowY` is continuous in the row.
 *
 * **One pass over the nodes filling a row → node array, not `nodeAt` per row.**
 * The answer is the same one — deepest wins, and `tests/diagram.test.ts` asserts
 * every rung against `nodeAt` so the two cannot drift apart — but the cost is
 * not. Per row it is rows × nodes, which is 2M comparisons at the `MAX_BLOCKS`
 * ceiling, and "memoised on the layout" is no defence on the two pictures this
 * runs for: their layout is recomputed every time the reader crosses a
 * paragraph, so that price would be paid a dozen times a screen. This is linear
 * in the rows the nodes cover, which on a scatter is the article once, because
 * the ranges tile it.
 */
export function paragraphStops(
  blocks: readonly Block[],
  nodes: readonly DiagramNode[],
): StepStop[] {
  const owner: (DiagramNode | null)[] = new Array(blocks.length).fill(null);
  for (const n of nodes) {
    /* Clamped, because a node's range is the tree's and the block array is the
       article's — a layout held over from the instant before a re-ingest can
       name a row that is no longer there. */
    const to = Math.min(blocks.length - 1, n.endRow);
    for (let row = Math.max(0, n.startRow); row <= to; row++) {
      const held = owner[row];
      if (!held || n.depth > held.depth) owner[row] = n;
    }
  }
  const stops: StepStop[] = [];
  blocks.forEach((block, row) => {
    const node = owner[row];
    /* No dot answers for this row, so there is nothing for a press to light.
       With a drawn scatter this cannot happen below the last body row; with no
       dots at all it is every row, and an empty ladder is what disables both
       buttons rather than leaving them stepping at nothing. */
    if (!node || !isBody(block)) return;
    stops.push({ row, blockId: block.id, id: node.id });
  });
  return stops;
}

/**
 * The deepest node the reader is standing in, or null above the first one.
 *
 * **Deepest, and deepest among the ones actually drawn** — the same rule the
 * summary panel's follow mark uses (docs/project/summaries.md), and for the
 * same reason: marking a part when its section is on screen tells the reader
 * something they already knew. A collapsed node is not drawn, so its children
 * are not candidates, and the mark lands on the collapsed node itself.
 */
export function nodeAt(nodes: readonly DiagramNode[], row: number | null): NodeId | null {
  if (row === null) return null;
  let best: DiagramNode | null = null;
  for (const n of nodes) {
    if (row < n.startRow || row > n.endRow) continue;
    if (best === null || n.depth > best.depth) best = n;
  }
  return best?.id ?? null;
}
