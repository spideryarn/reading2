/**
 * **The Diagram mode's geometry** — three pictures of one article's structure,
 * computed as pure numbers so they can be tested without a browser.
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
 * ## Nothing was installed, and that is the finding rather than the shortcut
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
 * ## The three pictures, and the axis they share
 *
 * ```
 *      strata                tree                  mindmap
 *   ┌──┬───────────┐   ┌───────────────┐    ┌───────────────┐
 *   │▐ │▌ 1 Waking │   │ ● Being You   │    │      ◉        │
 *   │▐ │▌   up     │   │ ├─● 1 Waking  │    │   ╭──┴──╮     │
 *   │▐ ├───────────┤   │ │ └─● 1.1 The │    │ ┌─┴─┐   │     │
 *   │▐ │▌ 1.1 The  │   │ │    body     │    │ │ 1 │   │     │
 *   │▐ │▌   body   │   │ ├─● 2 The     │    │ └───┘   │     │
 *   ├──┼───────────┤   │ │   hard      │    │     ╭───┴──╮  │
 *   │▐ │▌ 2 The    │   │ └─● 3 Being   │    │     │  2   │  │
 *   │▐ │▌   hard   │   └───────────────┘    │     ╰──────╯  │
 *   └──┴───────────┘                        └───────────────┘
 *    depth as thin      depth as indent      depth as a stem
 *    rails; height       and elbows;          off a centre
 *    ∝ blocks            one row each         trunk
 * ```
 *
 * `strata` is the only one whose vertical axis is *linear in the article*, and
 * it is the one that answers the question the gist columns cannot: **how much
 * of this piece is that section?** A section holding forty blocks and one
 * holding three look identical in an L2 cell — the complaint recorded in
 * docs/project/original-version/structure-panel.md against the previous version.
 * Here one is thirteen times taller.
 *
 * **In BLOCKS, though, not in words**, and that is worth being exact about
 * because "to scale" invites the stronger reading. A block is whatever stage 3
 * split out — a paragraph, a heading, a list item, a figure, a code block — so a
 * section of eight long paragraphs and a section of eight one-line list items
 * are the same height here, and a thousand-word code block is one row. It is
 * therefore the same unit the summary panel's `18¶` badge already counts, and
 * **not** the unit the spine uses: the spine is sized from measured pixel
 * heights (Spine.tsx), which is a different and better answer that costs a
 * layout pass this panel does not have. Weighting a block by its text length
 * would close most of the gap and is the obvious next change; see
 * docs/project/diagram.md.
 *
 * `tree` and `mindmap` keep document *order* but not document *scale* — every
 * node gets the room its label needs. That is a deliberate split rather than an
 * inconsistency: a map that is faithful about size cannot also be legible about
 * names, because the sliver problem the spine has (Spine.tsx) is the same
 * problem here. So one of the three is honest about proportion and two are
 * honest about text, and the toggle is how the reader asks for the one they
 * want.
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

/** Which picture. In the URL as `?diagram=` — see params.ts § diagramParam. */
export const DIAGRAMS = ["strata", "tree", "mindmap"] as const;
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
  /** Rotated a quarter turn, for a tall thin band that can only hold text sideways. */
  rotated?: boolean;
  hasChildren: boolean;
  collapsed: boolean;
}

/** A connector. `d` is an SVG path in the same coordinates as the nodes. */
export interface DiagramLink {
  id: string;
  d: string;
  part: number;
  depth: number;
}

export interface DiagramLayout {
  width: number;
  height: number;
  nodes: DiagramNode[];
  links: DiagramLink[];
  /**
   * The mapping from a block row to a y, for the you-are-here line — present
   * only on the picture whose vertical axis really is the article.
   *
   * A `{top, height, rows}` triple rather than a function, because a function
   * cannot be compared in a test and this is the number most likely to be
   * quietly wrong.
   */
  axis: { top: number; height: number; rows: number } | null;
}

export interface DiagramOptions {
  /** The band's inner width in px — what the SVG viewBox is scaled to. */
  width: number;
  /** How tall the scroller is. A picture may be taller; `strata` tries not to be. */
  height: number;
  /** Node ids the reader has closed. Their children are not laid out at all. */
  collapsed: ReadonlySet<NodeId>;
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
export const LABEL_PX: Record<DiagramKind, Record<number, number>> = {
  strata: { 0: 11, 1: 10, 2: 11 },
  tree: { 0: 12, 1: 12, 2: 12 },
  mindmap: { 0: 12, 1: 11.5, 2: 10.5 },
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
  strata: { title: 13, gist: 13 },
  tree: { title: 15, gist: 12 },
  mindmap: { title: 13, gist: 13 },
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
 * default, so today this changes nothing. It is here because **all three
 * layouts silently assume it**: `layoutStrata` has three x positions and would
 * stack depth 3 on top of depth 2, and `layoutMindmap` reads exactly two levels
 * of children and would drop a third without saying so. Raising
 * `buildSummaryTree`'s limit for some other caller must not quietly change what
 * this file draws, so the ceiling is asserted here rather than inherited.
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

/* ── strata: the picture that is to scale ───────────────────────────────── */

/** The two thin rails on the left, then the labelled column. */
const ROOT_W = 7;
const PART_W = 20;
const RAIL_GAP = 2;
/** Below this a band cannot hold a line of text, so it is left blank. */
const LABEL_MIN_H = 13;
/** No band may be thinner than this, or it cannot be clicked. Drives the height. */
const MIN_BAND_H = 6;

/**
 * **Strata** — indented proportional bands. Vertical position *is* position in
 * the article, and a band's height *is* how much of the article it is.
 *
 * The one thing to understand: the height is `max(what fits, what is legible)`.
 * The picture wants to be exactly the height of the scroller, because a map you
 * have to scroll is a worse map — but a fifty-section article at 600px gives
 * each section 12px, and a two-paragraph section inside that is 1px, which is
 * not a band, it is a line. So when the smallest band would fall under
 * `MIN_BAND_H` the whole picture is scaled up and scrolls instead. Scrolling a
 * map is a cost; a map with unclickable parts is a bug.
 */
export function layoutStrata(root: SummaryNode, opts: DiagramOptions): DiagramLayout {
  const entries = walk(root, opts.collapsed);
  const rows = Math.max(1, root.blocks);
  const pad = 4;

  /* How tall must the picture be for the thinnest thing on it to be usable?
     The thinnest thing is the smallest *drawn* node, and a collapsed node's
     children are not drawn — so this is computed from `entries`, never from
     the tree, or closing a section would leave the picture stretched for
     bands that are no longer on it. */
  const smallest = entries.reduce(
    // `Math.max(1, …)` because a node claiming zero blocks divides to Infinity
    // below, and an Infinite height renders as an empty picture with nothing in
    // the console. `buildSummaryTree` cannot currently produce one; this
    // function is exported and should not depend on that staying true.
    (min, e) => (e.node.node.depth === 0 ? min : Math.min(min, Math.max(1, e.node.blocks))),
    Number.POSITIVE_INFINITY,
  );
  const needed = Number.isFinite(smallest) ? (rows / smallest) * MIN_BAND_H : 0;
  /* The floor is not decoration. `opts.height` is a measured `clientHeight`, and
     a scroller that has not been laid out yet measures 0 — which without the
     floor gives a NEGATIVE height, a `rowToY` that runs upwards, and bands with
     negative `h` that SVG draws as nothing at all. No error, no warning, an
     empty picture. */
  const height = Math.max(60, opts.height - pad * 2, needed);

  const rowToY = (row: number) => pad + (row / rows) * height;
  const deepestX = ROOT_W + RAIL_GAP + PART_W + RAIL_GAP;

  const nodes: DiagramNode[] = entries.map((e) => {
    const { node: n } = e;
    const y = rowToY(n.startRow);
    // endRow is inclusive, so the band runs to the START of the row after it —
    // which is what makes consecutive siblings exactly partition their parent
    // with no seam and no overlap. Using endRow itself loses one row per band.
    const h = Math.max(1, rowToY(n.endRow + 1) - y);
    const x = n.node.depth === 0 ? 0 : n.node.depth === 1 ? ROOT_W + RAIL_GAP : deepestX;
    const w = n.node.depth === 0 ? ROOT_W : n.node.depth === 1 ? PART_W : opts.width - deepestX;

    const label = n.number ? `${n.number}  ${n.node.title}` : n.node.title;
    let lines: string[] = [];
    let rotated = false;
    if (n.node.depth >= 2 && h >= LABEL_MIN_H) {
      lines = wrapText(label, charsThatFit(w - 10, LABEL_PX.strata[2] ?? 11), Math.max(1, Math.floor((h - 4) / LINE_STEP.strata.title)));
    } else if (n.node.depth === 1 && h >= 46) {
      // A part band is 20px wide and can only hold text sideways. Its budget is
      // its HEIGHT, which is the axis it is long on — the one place in this file
      // where the two are swapped, and the reason `rotated` exists at all.
      lines = wrapText(n.node.title, charsThatFit(h - 12, LABEL_PX.strata[1] ?? 10), 1);
      rotated = true;
    }

    return {
      id: n.node.id,
      blockId: n.node.range[0],
      depth: n.node.depth,
      number: n.number,
      title: n.node.title,
      ...(n.gist !== undefined && { gist: n.gist }),
      blocks: n.blocks,
      startRow: n.startRow,
      endRow: n.endRow,
      part: e.part,
      x,
      y,
      w,
      h,
      labelX: rotated ? x + w / 2 : x + 5,
      labelY: rotated ? y + h / 2 : y + 12,
      anchor: rotated ? "middle" : "start",
      lines,
      titleLines: lines.length,
      ...(rotated && { rotated }),
      hasChildren: n.children.length > 0,
      collapsed: e.collapsed,
    };
  });

  return { width: opts.width, height: height + pad * 2, nodes, links: [], axis: { top: pad, height, rows } };
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

  return { width: opts.width, height: Math.max(opts.height, y + 10), nodes, links, axis: null };
}

/* ── mindmap: the picture that is a picture ─────────────────────────────── */

const TRUNK_PAD = 16;
const PART_GAP = 14;
const TWIG_H = 17;

/**
 * **Mindmap** — a trunk down the centre, parts hanging off it on alternating
 * sides, sections as twigs off their part.
 *
 * The published mindmap grammar — Markmap's, Mermaid's — grows *sideways* from
 * a root, and Luna is blunt about what that costs here: *"traditional mindmaps
 * expand sideways … do not naturally preserve a strict top-to-bottom reading
 * order"*. In a 288px band a sideways mindmap is not a styling problem, it is
 * the wrong shape.
 *
 * So this keeps the mindmap's *look* — a spine, curved stems, rounded label
 * pills — and throws away its axis. Down is still later in the article. That is
 * a herringbone rather than a mindmap, strictly, and calling it a mindmap in the
 * toggle is a concession to what a reader will be looking for.
 *
 * Sides alternate by part index rather than by which side has room, because a
 * picture that rearranges itself when a section is closed is a picture you have
 * to re-read.
 */
export function layoutMindmap(root: SummaryNode, opts: DiagramOptions): DiagramLayout {
  const trunkX = Math.round(opts.width / 2);
  const half = trunkX - TRUNK_PAD;
  const nodes: DiagramNode[] = [];
  const links: DiagramLink[] = [];

  const rootLines = wrapText(root.node.title, charsThatFit(opts.width - 24, LABEL_PX.mindmap[0] ?? 12), 2);
  const rootH = 8 + rootLines.length * 14;
  nodes.push({
    id: root.node.id,
    blockId: root.node.range[0],
    depth: 0,
    number: "",
    title: root.node.title,
    ...(root.gist !== undefined && { gist: root.gist }),
    blocks: root.blocks,
    startRow: root.startRow,
    endRow: root.endRow,
    part: -1,
    x: 12,
    y: 8,
    w: opts.width - 24,
    h: rootH,
    labelX: trunkX,
    labelY: 8 + 15,
    anchor: "middle",
    lines: rootLines,
    titleLines: rootLines.length,
    hasChildren: root.children.length > 0,
    collapsed: opts.collapsed.has(root.node.id) && root.children.length > 0,
  });

  let y = 8 + rootH + PART_GAP;
  let lastStemY: number | null = null;
  const rootBottom = 8 + rootH;
  const parts = opts.collapsed.has(root.node.id) ? [] : root.children;

  parts.forEach((p, i) => {
    const left = i % 2 === 1;
    const closed = opts.collapsed.has(p.node.id) && p.children.length > 0;
    const twigs = closed ? [] : p.children;

    const pillW = Math.max(48, half - 6);
    const label = `${p.number}  ${p.node.title}`;
    const pillLines = wrapText(label, charsThatFit(pillW - 14, LABEL_PX.mindmap[1] ?? 11.5), 2);
    const pillH = 7 + pillLines.length * 13;
    const pillX = left ? trunkX - TRUNK_PAD - pillW : trunkX + TRUNK_PAD;
    const pillY = y;
    const stemY = pillY + pillH / 2;

    /* The stem: a bezier out of the trunk into the middle of the pill. Both
       control points sit on the horizontal through their own end, which is what
       makes it leave the trunk and arrive at the pill flat rather than at an
       angle — the difference between a branch and a diagonal line. */
    const trunkEnd = left ? trunkX - TRUNK_PAD : trunkX + TRUNK_PAD;
    const mid = (trunkX + trunkEnd) / 2;
    links.push({
      id: `stem-${p.node.id}`,
      d: `M ${trunkX} ${Math.min(stemY, y - PART_GAP / 2)} C ${trunkX} ${stemY} ${mid} ${stemY} ${trunkEnd} ${stemY}`,
      part: i,
      depth: 1,
    });

    nodes.push({
      id: p.node.id,
      blockId: p.node.range[0],
      depth: 1,
      number: p.number,
      title: p.node.title,
      ...(p.gist !== undefined && { gist: p.gist }),
      blocks: p.blocks,
      startRow: p.startRow,
      endRow: p.endRow,
      part: i,
      x: pillX,
      y: pillY,
      w: pillW,
      h: pillH,
      labelX: pillX + pillW / 2,
      labelY: pillY + 14,
      anchor: "middle",
      lines: pillLines,
      titleLines: pillLines.length,
      hasChildren: p.children.length > 0,
      collapsed: closed,
    });

    /* **Twigs hang under their pill, not beside it.** Beside it was the first
       shape and it is the trap this band is full of: a pill fills its half of
       the width, so "beside" leaves about 7px for a title. Under it, indented
       from the pill's OUTER edge and running back towards the trunk, a twig gets
       the pill's width less an indent — around 120px, which is a short title.

       Indenting from the outer edge rather than from the trunk side is what
       keeps the two columns mirror images of each other; indenting from the
       trunk would make the left part's twigs run off the left edge and the
       right part's run into the trunk. */
    let ty = pillY + pillH + 4;
    const dotX = left ? pillX + 13 : pillX + pillW - 13;
    twigs.forEach((c) => {
      const cy = ty + TWIG_H / 2;
      const textX = left ? dotX + 7 : dotX - 7;
      const budget = left ? trunkX - TRUNK_PAD - textX - 2 : textX - (trunkX + TRUNK_PAD) - 2;
      nodes.push({
        id: c.node.id,
        blockId: c.node.range[0],
        depth: 2,
        number: c.number,
        title: c.node.title,
        ...(c.gist !== undefined && { gist: c.gist }),
        blocks: c.blocks,
        startRow: c.startRow,
        endRow: c.endRow,
        part: i,
        // The hit target spans from the twig's dot to the trunk, so a 4px
        // circle is not what the reader has to hit.
        x: left ? dotX - 5 : trunkX + TRUNK_PAD,
        y: ty,
        w: left ? trunkX - TRUNK_PAD - dotX + 5 : dotX + 5 - trunkX - TRUNK_PAD,
        h: TWIG_H,
        labelX: textX,
        labelY: cy + 4,
        anchor: left ? "start" : "end",
        lines: wrapText(`${c.number} ${c.node.title}`, charsThatFit(budget, LABEL_PX.mindmap[2] ?? 10.5), 1),
        titleLines: 1,
        hasChildren: false,
        collapsed: false,
      });
      ty += TWIG_H;
    });

    /* One sub-spine per part rather than one connector per twig: the twig dots
       all sit on it, so a connector each would be the same line drawn N times,
       and the overlap shows as a darker stroke at the top. */
    if (twigs.length > 0) {
      links.push({
        id: `sub-${p.node.id}`,
        d: `M ${dotX} ${pillY + pillH} V ${ty - TWIG_H / 2}`,
        part: i,
        depth: 2,
      });
    }

    lastStemY = stemY;
    y = Math.max(ty, pillY + pillH) + PART_GAP;
  });

  /* The trunk is drawn last because it needs to know where the last part is.
     **It stops at the last stem, not at the bottom of the picture** — a trunk
     that ran on past the final branch would be claiming there is more article
     below, which is the one thing a structure diagram must not do. The first
     version ran to `y`, which is past the last part's twigs; it looked like a
     deliberate tail. */
  const trunkBottom = lastStemY ?? rootBottom;
  links.unshift({
    id: "trunk",
    d: `M ${trunkX} ${rootBottom} V ${trunkBottom}`,
    part: -1,
    depth: 0,
  });

  return { width: opts.width, height: Math.max(opts.height, y + 8), nodes, links, axis: null };
}

/** The one entry point the panel uses. */
export function layoutDiagram(
  kind: DiagramKind,
  root: SummaryNode,
  opts: DiagramOptions,
): DiagramLayout {
  if (kind === "strata") return layoutStrata(root, opts);
  if (kind === "mindmap") return layoutMindmap(root, opts);
  return layoutTree(root, opts);
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
