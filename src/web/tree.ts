/**
 * Turning the tree into table geometry.
 *
 * The tabular view is Greg's original framing (2026-08-24):
 *
 * > up-down is chronology in the document and left-right is granularity, with a
 * > column for each level of the table of contents
 *
 * Because every node covers a contiguous range and a node's children exactly
 * partition it (granularity-zoom.md#the-tree), that maps onto an HTML table with
 * `rowSpan` and nothing more clever: one row per block, one column per depth, and
 * an ancestor cell simply spans the rows of its range. Vertical position is then
 * automatically the same at every level of granularity, which is the invariant
 * the whole feature rests on.
 */
import type { Arc, Block, BlockId, NodeId, Tree, TreeNode } from "../types.js";
import { isSupplementNode, supplementIndex } from "../supplement.js";

export interface Cell {
  node: TreeNode;
  rowSpan: number;
  /** True when the branch bottomed out above this column, so the node repeats. */
  continuation: boolean;
}

export interface Geometry {
  /** Every column depth, 0 (whole article) … maxDepth (the leaves). */
  columnDepths: number[];
  /** The deepest depth — the leaf column, which renders navLabels, not gists. */
  leafDepth: number;
  /** cells[columnIndex] → the cells in that column, in document order. */
  cells: Cell[][];
  /** cells keyed by "depth:rowIndex" for the row where each cell starts. */
  cellAt: Map<string, Cell>;
  /** Root-to-leaf node ids for each row index. */
  chains: NodeId[][];
  /**
   * Node id → the supplement node it sits under, itself included. Empty for
   * every article with no apparatus, and for every tree written before
   * 2026-08-28.
   *
   * Carried on the geometry because it is what `navigableItems` needs and the
   * geometry is what every consumer already has. src/supplement.ts.
   */
  supplementOf: Map<NodeId, TreeNode>;
}

/** Descend from the root, following the child whose range contains each block. */
function buildChains(tree: Tree, blocks: Block[]): NodeId[][] {
  const order = new Map<BlockId, number>(blocks.map((b, i) => [b.id, i]));

  // Ids are random, so a range is resolved by looking both endpoints up in the
  // block sequence — never by comparing the id strings, which would return a
  // plausible and meaningless boolean. See docs/project/block-ids.md.
  // An unresolvable range yields null and the node is skipped, so a malformed
  // tree renders visibly short rather than silently claiming the whole article.
  const spanOf = (n: TreeNode): [number, number] | null => {
    const lo = order.get(n.range[0]);
    const hi = order.get(n.range[1]);
    return lo === undefined || hi === undefined || lo > hi ? null : [lo, hi];
  };

  return blocks.map((_, i) => {
    const chain: NodeId[] = [];
    let node: TreeNode | undefined = tree.nodes[tree.rootId];
    while (node) {
      chain.push(node.id);
      const next: TreeNode | undefined = node.children
        .map((id) => tree.nodes[id])
        .find((c) => {
          if (!c) return false;
          const span = spanOf(c);
          return span !== null && i >= span[0] && i <= span[1];
        });
      node = next;
    }
    return chain;
  });
}

export function buildGeometry(tree: Tree, blocks: Block[]): Geometry {
  const chains = buildChains(tree, blocks);

  // Columns run from 0 (one cell: the whole article) to maxDepth (the leaves).
  // Depth 0 earns a column because otherwise the coarsest thing on screen is
  // the parts list, and there is no single place that says what the piece is.
  // The leaf column carries navLabels rather than gists, so it is only shown in
  // outline mode — see TableView.
  /* **The ladder is the argument's, not the article's.** A supplement is depth
     one with its leaves at depth two, so an article whose body tree is only
     parts-deep gained a whole rung it does not have: an L2 gist column whose
     only occupant was a note leaf with no gist and no navLabel — while the
     metadata page's "Levels" stat, fed by `articleStats.depth`, said one. Two
     answers to "how many levels does this piece have", both on screen.
     The supplement is excluded from the *maximum* only. Its cells still project
     into the columns that do exist, as continuations, which is what puts "Notes"
     in the sections column at all — see `navigableItems` below.
     GPT Sol, fifth review, 2026-08-29. */
  const apparatus = supplementIndex(tree);
  const bodyDepths = Object.values(tree.nodes)
    .filter((n) => !apparatus.has(n.id))
    .map((n) => n.depth);
  const maxDepth = bodyDepths.length > 0 ? Math.max(...bodyDepths) : 0;
  const columnDepths = Array.from({ length: maxDepth + 1 }, (_, i) => i);

  const cells: Cell[][] = [];
  const cellAt = new Map<string, Cell>();

  for (const depth of columnDepths) {
    const column: Cell[] = [];
    // A block whose branch is shallower than this column reuses its deepest
    // node; we mark that as a continuation so the text isn't repeated.
    const nodeFor = (row: number): { node: TreeNode | undefined; continuation: boolean } => {
      // A row with no chain means the tree does not cover that block. The
      // caller already skips a missing node (it draws nothing rather than
      // guessing), and validate-tree.ts is what complains about it properly.
      const chain = chains[row];
      if (!chain?.length) return { node: undefined, continuation: false };
      const id = chain[Math.min(depth, chain.length - 1)]!;
      return { node: tree.nodes[id], continuation: depth > chain.length - 1 };
    };

    let row = 0;
    while (row < blocks.length) {
      const { node, continuation } = nodeFor(row);
      let end = row + 1;
      while (end < blocks.length && nodeFor(end).node?.id === node?.id) end++;
      if (node) {
        const cell: Cell = { node, rowSpan: end - row, continuation };
        column.push(cell);
        cellAt.set(`${depth}:${row}`, cell);
      }
      row = end;
    }
    cells.push(column);
  }

  return {
    columnDepths,
    leafDepth: maxDepth,
    cells,
    cellAt,
    chains,
    supplementOf: apparatus,
  };
}

/* --------------------------------------------- what a column can navigate --

   **One projection, used by four things.** `itemsFromCells` (context.ts) drives
   the visible fisheye, and three other consumers read the raw cells: keyboard
   navigation (keynav.ts), the saved reading position (position.ts) and the
   arc's numbering (buildArcColumn below). Fixing only the visible list is what
   *breaks* the anchor invariant that keeps the three panels agreeing — GPT
   Sol's decision 9, and the part of this stage most likely to be got wrong.

   What it does: every cell under a supplement collapses into **one** item,
   anchored at the supplement's first block and carrying the supplement node
   itself. Without it, the sections column of a heavily noted article is a run of
   forty blank leaf cells — a leaf under a supplement has no title, no gist and
   no navLabel, because none of it is `isStructural` — and one of those blanks
   becomes the reader's current item. With it, a reader standing mid-Notes is
   *in* the "Notes" item: not nowhere (`currentIndex: -1`) and not wrongly in the
   last part of the argument, which is where `currentIndex` would put them if
   the blanks were merely filtered out. */

export interface NavItem {
  /** The supplement node itself where this is collapsed; the cell's node otherwise. */
  node: TreeNode;
  /** The row it starts on — its first block. */
  startRow: number;
  /** How many rows it covers, summed across the cells it collapsed. */
  rowSpan: number;
  /** True only when every cell behind it was one — see `itemsFromCells`. */
  continuation: boolean;
  /** The apparatus rather than the argument. Outside the numbering, dimmed. */
  supplement: boolean;
}

export function navigableItems(
  cells: readonly Cell[],
  supplementOf: ReadonlyMap<NodeId, TreeNode>,
): NavItem[] {
  const out: NavItem[] = [];
  let row = 0;
  for (const cell of cells) {
    const supplement = supplementOf.get(cell.node.id);
    const last = out.at(-1);
    if (supplement && last?.supplement && last.node.id === supplement.id) {
      // Same supplement as the cell before: grow it rather than listing a
      // second entry. A supplement's range is contiguous (tree-invariants.ts),
      // so its cells are always consecutive and this can never merge across a
      // part of the argument.
      last.rowSpan += cell.rowSpan;
      last.continuation = last.continuation && cell.continuation;
    } else {
      out.push({
        node: supplement ?? cell.node,
        startRow: row,
        rowSpan: cell.rowSpan,
        continuation: cell.continuation,
        supplement: supplement !== undefined,
      });
    }
    row += cell.rowSpan;
  }
  return out;
}

/** Human label for a column. `hasArc` renames L0, which stops being the root. */
export function columnLabel(depth: number, leafDepth: number, hasArc = false): string {
  if (depth === leafDepth) return "Paragraphs";
  switch (depth) {
    case 0: return hasArc ? "Argument" : "Article";
    case 1: return "Parts";
    case 2: return "Sections";
    default: return `Level ${depth}`;
  }
}

/**
 * The short label the controls bar's pill wears — the same column
 * `columnLabel` names in full, in the two or four characters a pill has room
 * for.
 *
 * Two of these were depth numbers until 2026-08-27, and a depth number says
 * where a column sits in the tree rather than what is in it. Greg: rename `L0`
 * to `Arg`, and the paragraph pill to anything short that explains itself. So
 * the two ends of the ladder are named — the arc at the top, paragraphs at the
 * bottom — and the middle rungs keep their numbers, because `Parts` and
 * `Sections` are exactly what a depth of 1 and 2 mean here and the tooltip says
 * so anyway.
 *
 * `Arg` is the arc's name even on an article that has no arc yet, where the
 * column falls back to the root gist (§ the arc). The pill is a fixed piece of
 * furniture and a reader who learned where `Arg` is should not find it renamed
 * by a pipeline stage they never ran; `columnLabel` still tells the truth in
 * the column's own header and in the tooltip.
 */
export function columnPill(depth: number, leafDepth: number): string {
  if (depth === leafDepth) return "Para";
  if (depth === 0) return "Arg";
  return `L${depth}`;
}

/**
 * The tooltip on that pill: the column's full name, and what one of its cells
 * actually holds.
 *
 * A four-character pill can only ever be a reminder, so the sentence behind it
 * has to do the teaching — and it is the only place the reader is told what
 * separates one column from the next, which is not the depth number but the
 * *stride*: a cell per part, a cell per section, a cell per paragraph.
 *
 * Built from `columnLabel` rather than repeating it, so a column renamed there
 * is renamed here too. Note the label goes in lower-case mid-sentence, which is
 * why `columnLabel` returns "Argument" and not "The argument" — the leading
 * article made this read "the the argument column" from 2026-08-26 until the
 * pills were named.
 */
export function columnHint(depth: number, leafDepth: number, hasArc = false): string {
  return `Show or hide the ${columnLabel(depth, leafDepth, hasArc).toLowerCase()} column — ${
    columnStride(depth, leafDepth, hasArc)
  }`;
}

/** What one cell of a column covers — the half of `columnHint` that varies. */
function columnStride(depth: number, leafDepth: number, hasArc: boolean): string {
  if (depth === leafDepth) return "one line per paragraph, beside the full text";
  if (depth === 0) {
    return hasArc
      ? "one sentence per part on where the argument stands"
      : "the whole piece in one sentence";
  }
  if (depth === 1) return "one sentence per part";
  if (depth === 2) return "one sentence per section";
  return "one sentence per group at this depth";
}

/* -------------------------------------------------------------- the arc --
   What the L0 column renders once stage 5b has run (src/arc.ts).

   Rendering the root there made the column a single cell spanning the whole
   article — a constant on an axis that means "this changes as you move down
   the page", duplicating the masthead and costing 240px to do it. The arc
   replaces it with one sentence per part saying where the argument stands,
   which is the only content that is both article-level and vertically varying.
   See granularity-zoom.md#the-arc. */

export interface ArcCell {
  /** The part this sits against. Boundaries are L1's, exactly. */
  node: TreeNode;
  rowSpan: number;
  /** Absent when no arc entry matched this part — draws empty, never borrowed. */
  text?: string;
  /**
   * 1-based position among the parts, for the step marker — **absent on a
   * supplement**, which sits outside the numbering.
   *
   * If Notes were one of nine depth-1 children, "3 / 9" would tell a reader
   * there are six parts of argument left when there are four. So the apparatus
   * is not counted and wears no marker: "3 / 7", and the Notes cell shows its
   * title instead. `partsOf` in src/arc.ts is the same rule on the generation
   * side; the two are separate because this one numbers the cells it is
   * drawing rather than the tree.
   */
  index?: number;
  total?: number;
  /** The apparatus. Drawn unnumbered and dimmed. */
  supplement?: boolean;
}

/**
 * The arc column, keyed by the row each cell starts on.
 *
 * Built from the L1 column's own cells, so the two columns share boundaries by
 * construction rather than by two walks of the tree agreeing. **Every part gets
 * a cell**, even one the arc has no sentence for: a missing `<td>` does not
 * leave a gap in an HTML table, it shifts every later cell in the row one
 * column left, so the whole view would silently misalign.
 *
 * Entries are matched to parts by block range, never by node id — ids are
 * positional and a re-run of `npm run hierarchy` renumbers them, which would quietly
 * hand each sentence to its neighbour. An unmatched entry is dropped.
 */
export function buildArcColumn(
  geometry: Geometry,
  arc: Arc | undefined,
): Map<number, ArcCell> | null {
  const cells = geometry.cells[1];
  if (!arc || !cells?.length) return null;

  /* Through the shared projection, so the arc's cells are the same items the
     fisheye lists and the keys step through. At depth 1 a supplement is already
     one cell, so this collapses nothing today — it is here so that the four
     consumers cannot drift, which is the whole point of there being one. */
  const parts = navigableItems(cells, geometry.supplementOf);
  const numbered = parts.filter((p) => !p.supplement).length;

  const byRange = new Map(arc.entries.map((e) => [`${e.range[0]}|${e.range[1]}`, e.text]));
  const out = new Map<number, ArcCell>();
  let step = 0;
  for (const part of parts) {
    const key = `${part.node.range[0]}|${part.node.range[1]}`;
    // Read once and spread on the value, not on `has`: `text` must be absent
    // when nothing matched, never present-and-undefined, because "absent" is
    // what makes the cell draw empty rather than borrow its neighbour's.
    // A supplement matches nothing by construction — `partsOf` never offered it
    // to the model — and that is exactly right: the cell shows its title.
    const text = byRange.get(key);
    if (!part.supplement) step += 1;
    out.set(part.startRow, {
      node: part.node,
      rowSpan: part.rowSpan,
      ...(part.supplement ? { supplement: true } : { index: step, total: numbered }),
      ...(text !== undefined && { text }),
    });
  }
  return out;
}

/* -------------------------------------------------------------- the spine --
   The bird's-eye rail down the far left renders the top of the tree — L1, and
   L2 nested inside it — as one always-visible picture of the whole article.
   Greg, 2026-08-25:

   > I want the left-hand most column to show a bird's eye view … I need a way
   > to see where I am in the whole article.

   That "where I am" is what forces it out of the table. A table column is
   correct for *chronology beside prose*, but a whole-article overview cannot
   live in one, because consecutive entries are thousands of pixels apart: you
   can only ever see the one you are standing in. So the spine is a separate,
   viewport-height rail — see Spine.tsx, and granularity-zoom.md#the-spine-a-birds-eye-rail. */

export interface OutlineEntry {
  node: TreeNode;
  /** Row indices into `blocks`, inclusive at both ends. */
  startRow: number;
  endRow: number;
  words: number;
  children: OutlineEntry[];
  /**
   * The apparatus. **A band with its true proportional height, dimmed** — which
   * is the whole reason the supplement is in the spine rather than hidden from
   * it. On a heavily noted piece the scrollbar lies: you are "60% through" and
   * the piece ends there, because the rest is endnotes. The rail must not lie
   * about pixels either, so the band keeps its real size and the dimming is
   * what says *the argument ends at this line*. Spine.tsx draws it.
   */
  supplement?: boolean;
}

/**
 * The first `depthLimit` levels below the root, with row extents and word
 * counts. Word counts are a fallback only — the spine sizes its segments from
 * measured pixel heights so that it is a true minimap (see Spine.tsx) — but
 * they are the right thing to fall back to before the first measurement, and
 * they are cheap.
 */
export function buildOutline(
  tree: Tree,
  blocks: Block[],
  depthLimit = 2,
): OutlineEntry[] {
  const order = new Map<BlockId, number>(blocks.map((b, i) => [b.id, i]));

  const entryFor = (node: TreeNode | undefined): OutlineEntry | null => {
    if (!node) return null;
    // Index lookup, never string comparison — block ids carry no order.
    const startRow = order.get(node.range[0]);
    const endRow = order.get(node.range[1]);
    if (startRow === undefined || endRow === undefined || startRow > endRow) {
      return null;
    }
    let words = 0;
    for (let i = startRow; i <= endRow; i++) words += blocks[i]?.words ?? 0;
    /* One band for the apparatus, never forty. A supplement's children are one
       leaf per note, so descending into it would put a hairline segment in the
       rail per endnote — the phantom-row failure `isStructural` prevents in the
       ToC, arriving by a different door. */
    const supplement = node.treatment === "supplement";
    const children =
      node.depth < depthLimit && !supplement
        ? node.children
            .map((id) => entryFor(tree.nodes[id]))
            .filter((e): e is OutlineEntry => e !== null)
        : [];
    return { node, startRow, endRow, words, children, ...(supplement && { supplement: true }) };
  };

  const root = tree.nodes[tree.rootId];
  return (root?.children ?? [])
    .map((id) => entryFor(tree.nodes[id]))
    .filter((e): e is OutlineEntry => e !== null);
}

/* ------------------------------------------------------- the summary tree --
   What summary mode renders: the tree, indented and numbered, with the
   one-sentence gist stage 4 wrote onto every internal node. See
   docs/project/summaries.md and SummaryPanel.tsx for the view.

   **This reads nothing but the tree**, which is the whole of what changed on
   2026-08-31 when the generated length ladder was removed
   (docs/plans/260831s-gist-only-summaries.md). It used to join `summary.json` in as
   well — by block range and never by node id, the same rule `buildArcColumn`
   above still obeys, because node ids are positional and a re-run of
   `npm run hierarchy` renumbers them. That join, and the two rungs it carried, are
   gone; the gists were always the part nobody had to pay for. */

export interface SummaryNode {
  node: TreeNode;
  /** "2.3" — the reader's address for this section, and its indent level. */
  number: string;
  /** Row indices into `blocks`, inclusive at both ends. */
  startRow: number;
  endRow: number;
  /**
   * How many blocks are under this.
   *
   * The answer to the question their structure panel's "+N hidden" badge asked
   * and our columns still cannot: *how much am I not seeing?* A section holding
   * forty paragraphs and one holding three look identical in an L2 cell.
   * See docs/project/original-version/structure-panel.md.
   */
  blocks: number;
  /**
   * The apparatus rather than the argument — one row, unnumbered, not descended
   * into and never reported as missing a summary.
   *
   * Absent on every ordinary node, so a panel that does not know about this
   * reads exactly as it did. src/supplement.ts.
   */
  supplement?: true;
  /** One sentence, from the tree. Present on every internal node stage 4 wrote. */
  gist?: string;
  children: SummaryNode[];
}

/**
 * The tree as the summary panel wants it: nested and numbered.
 *
 * `depthLimit` stops the walk. It is 2 by default because that is where
 * params.ts stops offering — below it a node is one paragraph, which the reader
 * should be reading rather than being told about (types.ts § TreeNode.gist).
 */
export function buildSummaryTree(
  tree: Tree,
  blocks: Block[],
  depthLimit = 2,
): SummaryNode | null {
  const order = new Map<BlockId, number>(blocks.map((b, i) => [b.id, i]));

  const build = (node: TreeNode | undefined, number: string): SummaryNode | null => {
    if (!node) return null;
    // Index lookup, never string comparison — block ids carry no order.
    const startRow = order.get(node.range[0]);
    const endRow = order.get(node.range[1]);
    if (startRow === undefined || endRow === undefined || startRow > endRow) return null;

    /* **The apparatus is a leaf here, whatever the tree says.** Descending gave
       "Notes" one child per endnote — each with no title, no gist and no
       summary — and `SummaryPanel` drew six phantom rows under a numbered part
       3, every one of them saying "No summary for this section". The notes are
       in the structure and are not part of the argument; that is the whole
       promise of this stage, and summary mode was the one place still breaking
       it. GPT Sol, second review, 2026-08-29. */
    const apparatus = isSupplementNode(node);
    /* **Unnumbered, and the argument's numbering does not skip.** The counter
       advances only on the parts that are the argument, so appending an
       apparatus cannot renumber part 1 or invent a part 3. */
    let n = 0;
    const children =
      node.depth < depthLimit && !apparatus
        ? node.children
            .map((id) => {
              const child = tree.nodes[id];
              const childNumber =
                child && isSupplementNode(child)
                  ? ""
                  : number
                    ? `${number}.${++n}`
                    : `${++n}`;
              return build(child, childNumber);
            })
            .filter((c): c is SummaryNode => c !== null)
        : [];

    return {
      node,
      number,
      startRow,
      endRow,
      blocks: endRow - startRow + 1,
      ...(apparatus && { supplement: true as const }),
      ...(node.gist !== undefined && { gist: node.gist }),
      children,
    };
  };

  return build(tree.nodes[tree.rootId], "");
}

/**
 * Which entry the reader is actually in, as the panel is currently drawn.
 *
 * Greg, 2026-08-26: *"If I'm in 'Summary' mode, can we highlight and scroll to
 * the relevant Summary section that corresponds to the current position of the
 * text?"* — and "the relevant one" is the question this function exists to
 * answer once, in one place.
 *
 * `here` in SummaryPanel.tsx marks **every** ancestor of the reader's section,
 * deliberately: at a shallow depth cut-off, the part you are inside is the
 * honest answer to *where am I*. But a highlight that strong on four nested
 * rows says nothing, and there is only one row to scroll to. So this picks the
 * **deepest entry that is actually on screen**, which is not the same as the
 * deepest entry that contains the reader:
 *
 *  - a node below the `deep` cut-off is not drawn, so its parent is where the
 *    reader is *as far as this panel goes* — unless the reader pressed that
 *    node's `+N sections` badge, which opens it past the cut-off and puts its
 *    children back on screen;
 *  - a node inside a section the reader closed is not drawn either, and closing
 *    a section must not put the mark somewhere invisible.
 *
 * **The walk mirrors `Entry`'s own `showChildren`**, and that agreement is the
 * whole risk in this function. Get it wrong and nothing errors: the panel
 * scrolls to an element that is not there (no move at all), or marks a row the
 * reader cannot see, which reads as "the highlight is broken" rather than as a
 * rule disagreeing with itself. docs/reusable/silent-success.md. Which is why
 * both sides call `showsChildren` below rather than each writing the rule out.
 *
 * Returns `null` above the first section, and for the root — which covers the
 * whole article and is therefore "here" the entire time, a light that is always
 * on. At `deep: 0` only the root is drawn, so there is correctly nothing to
 * mark and nothing to scroll to.
 */
export function currentEntryId(
  root: SummaryNode,
  atRow: number | null,
  deep: number,
  closed: ReadonlySet<string>,
  opened: ReadonlySet<string> = new Set(),
): string | null {
  if (atRow === null) return null;
  let node: SummaryNode | undefined = root;
  let deepest: string | null = null;
  while (node) {
    if (node !== root) deepest = node.node.id;
    if (!showsChildren(node, deep, closed, opened)) break;
    node = node.children.find((c) => atRow >= c.startRow && atRow <= c.endRow);
  }
  return deepest;
}

/**
 * Whether one entry's children are drawn — the single rule, in one place.
 *
 * There are **three** states in it and each is its own variable, which is the
 * design note copied verbatim from their structure panel and then extended by
 * one:
 *
 *  - `deep` is the cut-off, and it removes a whole level of the tree;
 *  - `closed` is the set the reader shut;
 *  - `opened` is the set the reader opened *past* the cut-off, by pressing a
 *    `+N sections` badge on a node the cut-off was hiding.
 *
 * They compose, and none of them silently rewrites another: moving the Depth
 * buttons does not un-close anything, and pressing `+N` on one part does not
 * move the Depth buttons. `closed` wins over `opened` because it is the more
 * recent statement about that node — a collapse always clears the override, so
 * the two can never both be set (SummaryPanel § toggle).
 *
 * The panel's `Entry` and `currentEntryId` above both call this. They used to
 * write the rule out separately, which is a rule that will eventually disagree
 * with itself in a way nothing errors on.
 */
export function showsChildren(
  entry: SummaryNode,
  deep: number,
  closed: ReadonlySet<string>,
  opened: ReadonlySet<string>,
): boolean {
  if (entry.children.length === 0) return false;
  if (closed.has(entry.node.id)) return false;
  return entry.node.depth < deep || opened.has(entry.node.id);
}
