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
import { withoutOwnNumber } from "./heading-number.js";
import { PREAMBLE_TITLE, sameHeading, UNTITLED_WINDOW_TITLE } from "../heading-text.js";
import type { Voice } from "./voice.js";

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
      /* **`?? []`, here as well as at the door.** `withChildLists` below mends a
         stored tree where the client receives it, so the reading view never
         brings this walk a node with no list. But this is the walk that was
         reported throwing (qi-gwnd4skg), and tests and scripts hand
         `buildGeometry` a tree that has been nowhere near that door. A node
         with no list is a leaf: the chain stops and the tree draws short. */
      const next: TreeNode | undefined = (node.children ?? [])
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

/**
 * **A stored tree, with a `children` list on every node.** The same object
 * back when none was missing.
 *
 * `TreeNode.children` is `NodeId[]`, and that describes what this app writes.
 * It does not describe every tree the client is handed: the tree is stored
 * JSON, and a type cannot see JSON. One node without the key threw in whichever
 * walker met it first — `buildChains` above was the one reported, and
 * Marginalia's questions (marginalia/notes.ts), the breadcrumb (crumbs.ts) and
 * Skim's where-card (where.ts, through src/section-path.ts) each read the list
 * unguarded too. Guarding them one at a time moves the crash to the next
 * reader of `.children`, including the one somebody writes next month.
 *
 * So it is mended once, where the client receives the article
 * (article/access.ts § `resolveAccess`), and every walker after that can
 * believe the type. **A node with no list is a leaf**, which is the rule this
 * file already has for a malformed tree: it renders visibly short rather than
 * throwing or claiming the whole article.
 *
 * **Identity is kept wherever nothing was wrong** — the tree itself when every
 * node had a list, and every node that had one in a tree that did not —
 * because the reading view memoises on `article.tree`. The argument is never
 * written to.
 *
 * It mends this one thing. A node that is missing, a range that does not
 * resolve and a root that is not in `nodes` are each already drawn short by
 * the walkers, and src/validate-tree.ts is where a tree is complained about
 * properly. tests/tree-missing-children.test.ts.
 */
export function withChildLists(tree: Tree): Tree {
  /* An answer with no tree in it at all is not this function's to repair. */
  const nodes = (tree as Tree | undefined)?.nodes;
  if (!nodes) return tree;
  let mended: Record<NodeId, TreeNode> | null = null;
  for (const [id, node] of Object.entries(nodes)) {
    if (!node || Array.isArray(node.children)) continue;
    mended ??= { ...nodes };
    mended[id] = { ...node, children: [] };
  }
  return mended ? { ...tree, nodes: mended } : tree;
}

export function buildGeometry(tree: Tree, blocks: Block[]): Geometry {
  const chains = buildChains(tree, blocks);

  // Columns run from 0 (one cell: the whole article) to maxDepth (the leaves).
  // Depth 0 earns a column because otherwise the coarsest thing on screen is
  // the parts list, and there is no single place that says what the piece is.
  // (The columns were drawn as a table until 2026-09-29; the cells are still
  // what the spine, Structure and the arrow keys step through.)
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
      }
      row = end;
    }
    cells.push(column);
  }

  return {
    columnDepths,
    leafDepth: maxDepth,
    cells,
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

/* -------------------------------------------------------------- the arc --
   One sentence per part on where the argument stands there, from stage 5b
   (src/arc.ts).

   **This was Hierarchy's L0 column until 2026-09-05, and now it is Structure's
   list face at rung 4** (OutlinePanel.tsx) — Greg took the column out of Hierarchy
   with the rest of the top-bar clutter, and the artefact stayed exactly where
   it was: docs/plans/260905d-declutter-the-reading-view-top-bars.md § Decisions
   5, and 260903b decision 7, which says Argument mode v1 will be this and
   nothing more.

   Why it exists at all is still the reason to keep it: rendering the root in a
   column made it a single cell spanning the whole article — a constant on an
   axis that means "this changes as you move down the page", duplicating the
   masthead and costing 240px to do it. The arc is the only content that is both
   article-level and vertically varying. See granularity-zoom.md#the-arc. */

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
 * The arc, keyed by the row each part starts on.
 *
 * Built from the L1 column's own cells, so the arc and the parts share
 * boundaries by construction rather than by two walks of the tree agreeing —
 * which is what lets Structure's list face hang each sentence off the right
 * part row.
 *
 * **Every part gets an entry**, even one the arc has no sentence for. That was
 * a hard requirement while this drew a table column, where a missing `<td>`
 * does not leave a gap but shifts every later cell in the row one column left;
 * the column went on 2026-09-05 and the invariant stays, because a caller that
 * indexes by part still wants a `Map` with no holes in it.
 *
 * Entries are matched to parts by block range, never by node id — ids are
 * positional and a re-run of `npm run structure` renumbers them, which would quietly
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
  /** The node starts at a heading block, so its navLabel is the author's. `navLabelVoice`. */
  startsAtHeading?: true;
}

/**
 * Whose words a node's `navLabel` is, when it is shown. A model writes the label
 * of every leaf **except one that starts at a heading**: there src/labels.ts §
 * `parseLabels` (and src/heading-tree.ts) copy the heading off the block rather
 * than taking the model's attempt, so the label is the author's own title. So
 * the voice is read off **the block the node starts at** (`node.range[0]`), not
 * inferred from whether a navLabel is present — GPT Sol, plan review of
 * docs/plans/261002b-a-nicer-ai-typeface-and-the-voices-trawl.md (P1).
 *
 * `startsAtHeading` is that fact, carried on `OutlineEntry` and `SummaryNode`
 * the way `supplement` is: present only when true.
 */
export function navLabelVoice(entry: { startsAtHeading?: true }): "author" | "ai" {
  return entry.startsAtHeading ? "author" : "ai";
}

/**
 * **Whose words a node's `title` is** — the author's heading kept, or the
 * model's. Greg, 2026-10-02 (spya-rp8cr4): "if the headlines are AI-generated,
 * they should be in AI-generated-font. Ideally, it would use author-font if the
 * headlines were preserved from the author".
 *
 * The tree already says which: `sourceHeading` is the author's heading a node
 * claims to keep, and the pipeline only lets it stand when a heading block in
 * the node's range matches it (src/tree-invariants.ts § `sameHeading`; the
 * structure prompt says to use that heading UNCHANGED as the title). So the
 * title is the author's exactly when it *is* that heading, by the same
 * comparison. A `sourceHeading` with a different title is the model's rewrite.
 *
 * Ours, not either's: the apparatus's "Notes" (src/supplement.ts) and the
 * heading tree's preamble. Everything else with a title the model wrote. The
 * root's title is not drawn by any caller of this; the heading tree's is the
 * article's own.
 */
export function titleVoice(node: TreeNode): Voice {
  if (node.treatment === "supplement") return "ui";
  if (node.sourceHeading !== undefined) {
    return sameHeading(node.title, node.sourceHeading) ? "author" : "ai";
  }
  /* A tree no model wrote quotes the passage's opening words where there is no heading. */
  if (node.titleFrom === "opening-words") return "author";
  if (node.title === PREAMBLE_TITLE || node.title === UNTITLED_WINDOW_TITLE) return "ui";
  return "ai";
}

/**
 * **What a tree row says, and whose words it is** — the title, else the
 * navLabel standing in for one. One function so the line and its face cannot
 * come from two different places. `title` is the title to draw, which on a
 * `SummaryNode` has the article's own section number taken off; the voice is
 * read off the stored node, whose title is what `sourceHeading` matches.
 */
export function nodeLabel(
  entry: { node: TreeNode; startsAtHeading?: true },
  title: string | undefined = entry.node.title,
): { text: string; voice: Voice } | null {
  const shown = title?.trim();
  if (shown) return { text: shown, voice: titleVoice(entry.node) };
  const nav = entry.node.navLabel?.trim();
  if (nav) return { text: nav, voice: navLabelVoice(entry) };
  return null;
}

/** The same test the label writers use: a heading block, by kind or by tag. */
function isHeadingBlock(block: Block | undefined): boolean {
  return block !== undefined && (block.kind === "heading" || /^h[1-6]$/.test(block.tag));
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
    return {
      node,
      startRow,
      endRow,
      words,
      children,
      ...(supplement && { supplement: true }),
      ...(isHeadingBlock(blocks[startRow]) && { startsAtHeading: true as const }),
    };
  };

  const root = tree.nodes[tree.rootId];
  return (root?.children ?? [])
    .map((id) => entryFor(tree.nodes[id]))
    .filter((e): e is OutlineEntry => e !== null);
}

/* ------------------------------------------------------- the summary tree --
   The tree, nested and numbered, with the one-sentence gist stage 4 wrote onto
   every internal node. Named for summary mode, which drew it as an outline
   until 2026-10-01 (docs/plans/261001p-summary-loses-parts-and-sections-a-touch-wider.md);
   Structure, Outline, Diagram and the graph read it now.

   **This reads nothing but the tree**, which is the whole of what changed on
   2026-08-31 when the generated length ladder was removed
   (docs/plans/260831s-gist-only-summaries.md). It used to join `summary.json` in as
   well — by block range and never by node id, the same rule `buildArcColumn`
   above still obeys, because node ids are positional and a re-run of
   `npm run structure` renumbers them. That join, and the two rungs it carried, are
   gone; the gists were always the part nobody had to pay for. */

export interface SummaryNode {
  node: TreeNode;
  /** "2.3" — the reader's address for this section, and its indent level. */
  number: string;
  /**
   * The title to draw beside `number`: `node.title` with the article's own
   * section number taken off, so "3.2 Methods" is not drawn as "2.1 3.2
   * Methods". Only where `number` is non-empty — the root and the apparatus
   * wear no number of ours and keep their words. The stored tree is untouched.
   * heading-number.ts; SPIDERYARN-READING2-4Q.
   */
  title: string;
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
  /**
   * The Socratic question carried by the root and depth-1 nodes only, and only
   * on trees built after 2026-09-05 — types.ts § `TreeNode.question`. Marginalia
   * draws it; structural views may ignore it. Absent everywhere else.
   */
  question?: string;
  /** The node starts at a heading block, so its navLabel is the author's. `navLabelVoice`. */
  startsAtHeading?: true;
  children: SummaryNode[];
}

/**
 * The tree as the modes that draw it want it: nested and numbered.
 *
 * `depthLimit` stops the walk. It is 2 by default — the parts and their
 * sections; below that a node is one paragraph, which the reader
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
       summary — and Summary's outline drew six phantom rows under a numbered part
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
      title: number ? withoutOwnNumber(node.title) : node.title,
      startRow,
      endRow,
      blocks: endRow - startRow + 1,
      ...(apparatus && { supplement: true as const }),
      ...(node.gist !== undefined && { gist: node.gist }),
      ...(node.question !== undefined && { question: node.question }),
      ...(isHeadingBlock(blocks[startRow]) && { startsAtHeading: true as const }),
      children,
    };
  };

  return build(tree.nodes[tree.rootId], "");
}
