/**
 * **The Diagram mode's shared vocabulary, and the one picture that is an
 * outline** — computed as pure numbers so it can be tested without a browser.
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
 * ## Nothing was installed **for these three**, and that is a finding
 *
 * Read this as history rather than as current fact: three more pictures arrived
 * on 2026-08-27 and they *are* D3-driven, over a richer data structure that did
 * not exist when the survey below was run. See [diagram-d3.ts](./diagram-d3.ts)
 * for what changed and why the argument here still stands for the tree pictures.
 *
 * GPT-5.6 Luna was sent to survey the field first, per
 * docs/reusable/third-party-library-selection.md — d3-hierarchy, @visx/hierarchy,
 * @xyflow/react, markmap, Mermaid, cytoscape, elkjs, dagre, G6, Sigma, nivo,
 * react-d3-tree. What it said is summarised in docs/plans/diagram-mode.md —
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
 * So: hand-rolled SVG, one dependency-free module, and the layout arithmetic
 * lives here rather than inside a component, because that is what makes the
 * three sorting rules below testable.
 *
 * ## What is left, after the cut
 *
 * ```
 *        tree                  force              drift / trail
 *   ┌───────────────┐   ┌───────────────┐    ┌───────────────┐
 *   │ ● Being You   │   │    ◯───◯      │    │  ·   ·  ·     │
 *   │ ├─● 1 Waking  │   │   ╱ ╲ ╱       │    │ ·  ·   ·  ·   │
 *   │ │ └─● 1.1 The │   │  ◯───◯····◯   │    │   ·  ·        │
 *   │ │    body     │   │   ╲   ╲       │    │  ·   ·  ·   · │
 *   │ ├─● 2 The     │   │    ◯───◯      │    │ ·  ·      ·   │
 *   │ └─● 3 Being   │   │                │    │   ·  ·  ·     │
 *   └───────────────┘   └───────────────┘    └───────────────┘
 *    depth as indent    sections pulled       one dot per
 *    and elbows;        together by the       paragraph, placed
 *    one row each       words they share      by what it is about
 * ```
 *
 * Only the first is in this file. `force` is [diagram-d3.ts](./diagram-d3.ts)
 * over [graph.ts](./graph.ts); `drift` and `trail` are
 * [scatter.ts](./scatter.ts) over the server's projection. What they all share
 * — `DiagramNode`, `DiagramLink`, `wrapText`, `LABEL_PX` — lives here, which is
 * why a router that knows about all three is its own file
 * ([diagrams.ts](./diagrams.ts)) rather than a function at the bottom of this
 * one.
 *
 * **`tree` keeps document order but not document scale**: every node gets the
 * room its label needs. That was a deliberate split while `strata` existed to
 * be the honest-about-proportion half of the pair, and it is worth saying
 * plainly that the pair is now a single: nothing in this mode is to scale any
 * more. The spine beside the band still is.
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
import type { BlockId, NodeId } from "../types.js";
import type { SummaryNode } from "./tree.js";

/**
 * Which picture. In the URL as `?diagram=` — see params.ts § diagramParam.
 *
 * **Four, and there were eight.** Greg cut Strata, Mindmap, Arc and Cluster on
 * 2026-08-27, and the four that went share one property: each of them was a
 * second way of drawing something another picture already draws. Mindmap and
 * Cluster were both the containment tree with different geometry — the
 * comparison GPT Sol had already said `tree` won. Arc drew the vocabulary edges
 * that `force` draws, on a line rather than in a plane. Strata was the odd one
 * out and the real loss: it was to scale, and nothing here is any more. Its
 * question — *how much of the piece is that section?* — is now answered by the
 * spine beside the band and by the paragraph count on a tree row, which is
 * weaker and is the price of a toggle bar you can take in at a glance.
 *
 * What is left is one picture per **kind of thing to say**: `tree` is the
 * outline (this file), `force` is the relationships a tree cannot hold
 * ([diagram-d3.ts](./diagram-d3.ts) over [graph.ts](./graph.ts)), and `drift`
 * and `trail` are the article as paragraphs placed by meaning
 * ([scatter.ts](./scatter.ts)). The order runs from the most faithful to the
 * article's own shape to the most interpretive, which is also from cheapest to
 * most surprising: the first costs nothing, the last three cost a model call.
 */
export const DIAGRAMS = ["tree", "force", "drift", "trail"] as const;
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
 * The three tree pictures leave `kind` unset: on a tree every line is
 * containment, so naming it would be ceremony.
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

export interface DiagramLink {
  id: string;
  d: string;
  part: number;
  /**
   * **A per-picture rendering band, and it means three different things.**
   *
   * On `tree` and `mindmap` it is the depth of the node the line hangs off. On
   * `arc` it is the edge's *weight*, quantised into the three stroke widths the
   * stylesheet has. On `force` it used to be the edge's *kind* — 0 for
   * sequence, 1 for parent, 2 for vocabulary — which worked for exactly three
   * kinds and stopped working at five.
   *
   * That third use is what `kind` below replaced. The other two are left alone
   * because each picture's stylesheet is written against them, and the honest
   * description of this field is that it is a channel a layout may use, not a
   * fact about the graph. GPT Sol pointed out that Arc had already made it one;
   * pretending otherwise here would be the kind of comment that is worse than
   * none.
   */
  depth: number;
  /**
   * What the line claims. **Required**, and that is the point of it.
   *
   * An optional discriminator would leave the exact trap this replaced: a sixth
   * kind of Force edge could be added, forget to say what it is, and compile.
   * Every layout therefore names the kind of every line it draws — and on the
   * tree pictures that is not ceremony, because every line there really is
   * containment and saying so costs one word.
   */
  kind: LinkKind;
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
export const UNLABELLED: ReadonlySet<DiagramKind> = new Set<DiagramKind>(["drift", "trail"]);

export const LABEL_PX: Record<DiagramKind, Record<number, number>> = {
  tree: { 0: 12, 1: 12, 2: 12 },
  // Only a number goes inside a force bubble, and it is small.
  force: { 0: 10, 1: 10, 2: 10 },
  /* Nothing is written on a scatter dot at all — `lines` is always empty
     (src/web/scatter.ts). These entries exist because the record is keyed by
     `DiagramKind` and a missing one would be a type error rather than a
     picture; `tests/diagram-css.test.ts` skips a kind that never draws a label. */
  drift: { 0: 11, 1: 11, 2: 11 },
  trail: { 0: 11, 1: 11, 2: 11 },
};

/** The gist's size, on the one picture that draws one. Same contract as above. */
export const GIST_PX = 10.5;

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
  tree: { title: 15, gist: 12 },
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
 * silently assume it — `layoutTree` indents by depth and would run a fourth
 * level off the right edge of a 288px band, and the stylesheet has font sizes
 * for `diag-d0` to `diag-d2` and nothing below. Raising `buildSummaryTree`'s
 * limit for some other caller must not quietly change what this file draws, so
 * the ceiling is asserted here rather than inherited.
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

/* ── tree: the picture that is legible ──────────────────────────────────── */

const TREE_INDENT = 15;
const TREE_LEFT = 12;
const TREE_GAP = 7;
const DOT_R = 3.5;

/**
 * **Tree** — a vertical outline with elbow connectors, one row per node, each
 * row as tall as its own text needs.
 *
 * Luna's shape, and the reason it is this rather than `d3-hierarchy.tree()`:
 * *"assign `y` by a preorder traversal, advance `y` by the rendered height of
 * each visible node"*. A tidy tree balances leaves against each other; an
 * article outline wants them in the order they were written, each taking the
 * room its own name needs.
 *
 * A gist is drawn only on nodes shallower than 2 — at depth 2 there are enough
 * of them that the picture stops being a picture and becomes the summary panel,
 * which already exists and is better at it.
 */
export function layoutTree(root: SummaryNode, opts: DiagramOptions): DiagramLayout {
  const entries = walk(root, opts.collapsed);
  const nodes: DiagramNode[] = [];
  const links: DiagramLink[] = [];
  /** Where each node's dot ended up, so its children can draw back to it. */
  const anchors = new Map<NodeId, { x: number; y: number }>();

  let y = 10;
  for (const e of entries) {
    const { node: n } = e;
    const depth = n.node.depth;
    const dotX = TREE_LEFT + depth * TREE_INDENT;
    const textX = dotX + 9;
    const avail = opts.width - textX - 26; // 26 keeps the ¶ count clear of the text
    const label = n.number ? `${n.number}  ${n.node.title}` : n.node.title;
    const titleLines = wrapText(label, charsThatFit(avail, LABEL_PX.tree[depth] ?? 12), 2);
    const gistLines =
      depth < 2 && n.gist && !e.collapsed
        ? wrapText(n.gist, charsThatFit(avail, GIST_PX), depth === 0 ? 3 : 2)
        : [];
    const h = titleLines.length * LINE_STEP.tree.title + gistLines.length * LINE_STEP.tree.gist;
    const dotY = y + LINE_STEP.tree.title / 2;

    const parent = n.node.parent === null ? undefined : anchors.get(n.node.parent);
    if (parent) {
      /* An elbow with a rounded corner: straight down the parent's column, a
         quarter turn, straight across to the child. Drawn from the PARENT's x
         so that several children share one vertical stroke — which is what
         makes the indent read as a tree rather than as a list of dashes. */
      const r = Math.min(6, Math.max(0, dotX - parent.x), Math.max(0, dotY - parent.y));
      links.push({
        id: `${n.node.parent}-${n.node.id}`,
        d: `M ${parent.x} ${parent.y + DOT_R} V ${dotY - r} Q ${parent.x} ${dotY} ${parent.x + r} ${dotY} H ${dotX - DOT_R}`,
        part: e.part,
        depth,
        kind: "parent",
      });
    }
    anchors.set(n.node.id, { x: dotX, y: dotY });

    nodes.push({
      id: n.node.id,
      blockId: n.node.range[0],
      depth,
      number: n.number,
      title: n.node.title,
      ...(n.gist !== undefined && { gist: n.gist }),
      blocks: n.blocks,
      startRow: n.startRow,
      endRow: n.endRow,
      part: e.part,
      // The hit target is the whole row, not the dot: a 7px circle is not a
      // click target, and the row is what the reader thinks they are pointing at.
      x: 0,
      y,
      w: opts.width,
      h: h + TREE_GAP,
      labelX: textX,
      labelY: y + 11,
      anchor: "start",
      lines: [...titleLines, ...gistLines],
      titleLines: titleLines.length,
      hasChildren: n.children.length > 0,
      collapsed: e.collapsed,
    });
    y += h + TREE_GAP;
  }

  return { width: opts.width, height: Math.max(opts.height, y + 10), nodes, links, axis: null, nowY: null };
}

/**
 * **The rows a picture can step between** — ascending, deduplicated, and what
 * the panel's ↑ / ↓ buttons walk.
 *
 * Rows rather than nodes, and that is the whole design of the step controls.
 * A layout's `nodes` are in *preorder*, so on a tree the root, part 1 and
 * section 1.1 all begin on the same row: stepping by node would press ↓ three
 * times and move the article nowhere, which reads as a broken button. Distinct
 * start rows make one press always one visible move — and they make the *unit*
 * come out right by itself, sections on the tree pictures and single paragraphs
 * on the two scatters, because those are the rows those pictures draw.
 *
 * Here rather than in the component so it can be tested: the failure it guards
 * against is a button that looks fine and does nothing, which is the shape
 * docs/reusable/silent-success.md is about.
 */
export function stepRows(nodes: readonly DiagramNode[]): number[] {
  const seen = new Set<number>();
  for (const n of nodes) seen.add(n.startRow);
  return [...seen].sort((a, b) => a - b);
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
