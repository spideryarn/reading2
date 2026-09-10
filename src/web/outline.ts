/**
 * Structure mode's list-face projection: the whole document as one nested list,
 * expanded around where the reader is standing. It keeps Outline's names after
 * that mode became this face on 2026-09-10.
 *
 * **One function decides what is drawn AND which row is current.** That is the
 * whole design constraint here, and it comes from a bug this repo has already
 * paid for: the summary panel's renderer and its `currentEntryId` walk once
 * wrote the same rule out separately, and when two copies of a rule disagree
 * nothing errors — the panel scrolls to an element that is not in the DOM, or
 * marks a row nobody can see. See docs/project/summaries.md § Which row is
 * "the relevant one", and docs/plans/260828aw-outline-mode.md § The code.
 *
 * Pure, and takes no DOM. The fit — which rung actually fits the band — is
 * decided by OutlinePanel measuring the candidates this builds.
 */
import type { BlockId, NodeId, TreeNode } from "../types.js";
import type { Tier } from "./context.js";
import type { ArcCell, SummaryNode } from "./tree.js";

/**
 * How far down the ladder we got. Each rung adds one thing and every rung is
 * all-or-nothing — a partly-drawn level is a lie about the structure.
 *
 *  1  every part, one line each          — if this will not fit, nothing will
 *  2  + the current part's sections
 *  3  + a sentence on the current section
 *  4  + the arc sentence for the current part
 *  5  + the current section's paragraphs
 *
 * The arc comes before the paragraph labels, and that was the other way round
 * until GPT Sol's review of the plan. Its argument: the arc answers the
 * question the mode exists for and costs one row, while a paragraph label
 * restates prose already on screen and can cost twenty-six. Putting the
 * expensive rung first meant the cheap valuable one never got drawn.
 */
export type Rung = 1 | 2 | 3 | 4 | 5;

export const RUNGS: readonly Rung[] = [1, 2, 3, 4, 5];

/**
 * The most paragraphs rung 5 will draw.
 *
 * Not a hedge. noema's "1: Brains Are Not Computers" has 26 paragraph children
 * where its neighbours have 3 to 5, so expanding it inserts twenty-six rows on
 * crossing one boundary — the worst churn on the corpus, and a rung that would
 * then fail to fit and be dropped again at the next section. A section with
 * more paragraphs than this gets none: never a truncated list, which would say
 * the section ends where the list does.
 */
export const PARAGRAPH_CAP = 8;

/**
 * A paragraph row is never marked as the one the reader is in.
 *
 * Not a style choice — nothing on the page knows. Both available answers to
 * "where is the reader" are section-granular: `?at=` stores a section's first
 * block (position.ts § sectionDepth), and `LiveContext.focusRow` returns
 * `sections[...].row` (useColumnContext.ts). Marking the deepest row that
 * *contains* `focusRow` would therefore light the section's **first** paragraph
 * every time, on every article, for ever — a mark that is wrong far more often
 * than it is right and looks entirely plausible while being so.
 *
 * So the mark stops at the section: the honest deepest thing the page can
 * actually know. Paragraph rows are listed, clickable and hoverable; none of
 * them ever says "you are here".
 */
const PARAGRAPHS_ARE_NEVER_CURRENT = true;

export interface OutlineRow {
  node: TreeNode;
  /** "3.2" — the reader's address for this row, and what sets its indent. */
  number: string;
  /** 1 = part, 2 = section, 3 = paragraph. Not the tree depth: see `rowsFor`. */
  level: number;
  /** Where clicking it goes — the row's first block. */
  blockId: BlockId;
  startRow: number;
  endRow: number;
  /** The line itself. Never empty — a node with no text gets no row at all. */
  text: string;
  /** The gist, on the current section only (rung 3). */
  sentence?: string;
  /** The arc sentence, on the current part only (rung 4). */
  arc?: string;
  /** The apparatus — one row, never expanded, never given a sentence. */
  supplement: boolean;
  /** The reader is inside this row. True on the whole ancestor chain. */
  here: boolean;
  /** The one deepest drawn row the reader is in — what gets `aria-current`. */
  now: boolean;
  /** Already read: this row ends above the reader. */
  before: boolean;
  tier: Tier;
}

export interface OutlineProjection {
  rows: OutlineRow[];
  /** The deepest drawn row the reader is in, or null above the first part. */
  currentId: NodeId | null;
  rung: Rung;
}

/**
 * What a row says, and the one place the navLabel fallback is allowed.
 *
 * A `navLabel` is a pointer to prose and must never stand *in place of* prose
 * that could be shown (docs/project/granularity-zoom.md § Node shape). Here it
 * never does: this is navigation chrome, and on any window wide enough to draw
 * paragraph rows the prose is on screen beside them — which is exactly why
 * rung 5 is dropped on a narrow window, where the band covers the article.
 *
 * The case this exists for is real and was found in the corpus rather than the
 * docs: `revistes-ub-30977` has two depth-2 nodes with no children — sections
 * by depth, leaves by shape — one with an empty title and a navLabel, one with
 * neither. Without the fallback the first draws a blank row; without the null
 * the second draws one whatever we do. Nothing errors either way.
 */
function rowText(node: TreeNode): string | null {
  const title = node.title?.trim();
  if (title) return title;
  const nav = node.navLabel?.trim();
  if (nav) return nav;
  return null;
}

/** Discrete tiers, never a gradient — see docs/project/column-context.md. */
function tierByDistance(d: number): Tier {
  if (d === 0) return "cur";
  if (d <= 2) return "near";
  if (d <= 5) return "mid";
  return "far";
}

interface Input {
  /** The tree, nested and numbered — `buildSummaryTree` at full depth. */
  root: SummaryNode | null;
  /** Node id → the supplement it sits under. `Geometry.supplementOf`. */
  supplementOf: ReadonlyMap<NodeId, TreeNode>;
  /** The arc, keyed by the row each part starts on — `buildArcColumn`. Null without arc.json. */
  arcByRow: Map<number, ArcCell> | null;
  /**
   * Which row the reader is at — `LiveContext.focusRow`.
   *
   * **Section-granular, and every consumer here has to know that.** It is
   * `sections[activeSectionIndex(...)].row` (useColumnContext.ts), so it is
   * always the *first row of the section under the focus line*, never the exact
   * block. `?at=` is the same (position.ts § sectionDepth). So nothing on this
   * page knows which paragraph the reader is on, and this projection therefore
   * never claims one — see `PARAGRAPHS_ARE_NEVER_CURRENT`.
   *
   * GPT Sol's review of the plan found this about `?at=`; I answered that
   * `focusRow` was exact and it is not. Both routes are section-granular and
   * the review's own second option — stop at the section — is what is built.
   */
  focusRow: number;
  rung: Rung;
  /**
   * Whether paragraph rows are permissible at all.
   *
   * False on a window narrow enough that the band covers the prose rather than
   * sitting beside it — below `MODE_MIN + MODE_PROSE_FLOOR` in layout.ts, which
   * is 700px since 2026-09-06 and was 844 before it. That move took the iPad in
   * portrait and the modern phone in landscape out of this branch and into the
   * side-by-side one; what is left under it is a phone in portrait and a small
   * phone sideways. The navLabel fallback above is only defensible while the
   * prose is visible, so rung 5 is not merely unhelpful there — it is the
   * substitution principle 1 forbids.
   */
  allowParagraphs: boolean;
}

const contains = (n: SummaryNode, row: number) => row >= n.startRow && row <= n.endRow;

/**
 * Build the drawn list for one rung.
 *
 * The walk is deliberately explicit rather than a recursion over `deep`,
 * because `showsChildren` in tree.ts cannot express this shape: it has a
 * whole-level cut-off, a closed set and an opened set, and none of them means
 * *open only the branch containing the reader*. `deep: 1` draws no sections;
 * `deep: 2` draws every part's sections. Found by GPT Sol reviewing the plan.
 */
export function outlineProjection({
  root,
  supplementOf,
  arcByRow,
  focusRow,
  rung,
  allowParagraphs,
}: Input): OutlineProjection {
  if (!root) return { rows: [], currentId: null, rung };

  const parts = root.children;
  const currentPart = parts.find((p) => contains(p, focusRow)) ?? null;
  const currentSection =
    currentPart?.children.find((s) => contains(s, focusRow)) ?? null;

  const rows: OutlineRow[] = [];

  const push = (
    entry: SummaryNode,
    level: number,
    extra: { sentence?: string; arc?: string } = {},
  ): OutlineRow | null => {
    const text = rowText(entry.node);
    /* No text of any kind — no row. Never a blank one: an empty line in a list
       whose whole promise is "this is the shape of the document" is a hole
       nothing reports. */
    if (text === null) return null;
    const supplement = supplementOf.has(entry.node.id);
    const row: OutlineRow = {
      node: entry.node,
      /**
       * **A supplement wears no number.** `buildSummaryTree` numbers every
       * child positionally, so the apparatus would come out as "8" beside
       * seven parts of argument — telling the reader there is an eighth thing
       * to read when there are seven and then the endnotes. That is the same
       * mistake `buildArcColumn` already refuses to make with its `3 / 9` step
       * marker, and the rule is worth keeping identical: the apparatus is in
       * the structure and outside the numbering.
       */
      number: supplement ? "" : entry.number,
      level,
      blockId: entry.node.range[0],
      startRow: entry.startRow,
      endRow: entry.endRow,
      text,
      ...(extra.sentence !== undefined && { sentence: extra.sentence }),
      ...(extra.arc !== undefined && { arc: extra.arc }),
      supplement,
      here: level === 3 && PARAGRAPHS_ARE_NEVER_CURRENT ? false : contains(entry, focusRow),
      now: false,
      before: entry.endRow < focusRow,
      tier: "far",
    };
    rows.push(row);
    return row;
  };

  for (const part of parts) {
    const isCurrent = part === currentPart;
    const supplement = supplementOf.has(part.node.id);
    /* The apparatus gets one row and stops. It is outside the argument, has no
       gist by design, and expanding it would put the endnotes' structure on a
       par with the article's. src/supplement.ts. */
    const arcText =
      rung >= 4 && isCurrent && !supplement
        ? arcByRow?.get(part.startRow)?.text
        : undefined;
    push(part, 1, arcText !== undefined ? { arc: arcText } : {});

    if (rung < 2 || !isCurrent || supplement) continue;

    for (const section of part.children) {
      const sectionCurrent = section === currentSection;
      const sentence =
        rung >= 3 && sectionCurrent ? section.gist : undefined;
      const drawn = push(section, 2, sentence !== undefined ? { sentence } : {});
      if (!drawn) continue;

      if (
        rung < 5 ||
        !sectionCurrent ||
        !allowParagraphs ||
        section.children.length === 0 ||
        section.children.length > PARAGRAPH_CAP
      ) {
        continue;
      }
      for (const para of section.children) push(para, 3);
    }
  }

  /* `now` is the DEEPEST drawn row the reader is in, which is not the same as
     the deepest node containing them: at rung 1 no section is drawn, so the
     part is the honest answer to "where am I" as far as this panel goes. And
     `here` stays on the whole chain, because at a shallow rung marking only
     the innermost drawn row would leave a part unlit while the reader is
     inside it. Both marks, one walk — the agreement is structural. */
  let currentId: NodeId | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row?.here) {
      row.now = true;
      currentId = row.node.id;
      break;
    }
  }

  const cur = rows.findIndex((r) => r.now);
  rows.forEach((row, i) => {
    row.tier = cur === -1 ? "far" : tierByDistance(Math.abs(i - cur));
  });

  return { rows, currentId, rung };
}
