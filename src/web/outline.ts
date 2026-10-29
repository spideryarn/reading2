/**
 * Structure mode's list-face projection: the whole document as one nested list,
 * expanded around where the reader is standing. It keeps Outline's names after
 * that mode became this face on 2026-09-10.
 *
 * **One function decides what is drawn AND which row is current.** That is the
 * whole design constraint here, and it comes from a bug this repo has already
 * paid for: Summary's outline renderer and its `currentEntryId` walk once
 * wrote the same rule out separately, and when two copies of a rule disagree
 * nothing errors — the panel scrolls to an element that is not in the DOM, or
 * marks a row nobody can see. (Both went with that outline on 2026-10-01, plan
 * 261001p.) See docs/plans/260828aw-outline-mode.md § The code.
 *
 * Pure, and takes no DOM. The fit — which rung actually fits the band — is
 * decided by OutlinePanel measuring the candidates this builds.
 */
import type { BlockId, NodeId, TreeNode } from "../types.js";
import type { Tier } from "./context.js";
import { nodeLabel, type ArcCell, type SummaryNode } from "./tree.js";
import { type MatterRange, coveredByStretches } from "./matter-view.js";
import type { Voice } from "./voice.js";

/**
 * How far down the ladder we got. Each rung adds one thing and every rung is
 * all-or-nothing — a partly-drawn level is a lie about the structure.
 *
 *  1  every part
 *  2  + the current part's sections, and the current section's sub-sections
 *  3  + a sentence on the deepest current one   — the floor of what is drawn
 *  4  + the arc sentence for the current part
 *  5  + the deepest current one's paragraphs
 *
 * **Sub-sections since 2026-10-29**, where a tree is ragged: a section the
 * article divides gets its sub-sections drawn under it while the reader is in
 * it, the sentence goes to the sub-section they are in, and the paragraphs, at
 * rung 5, hang off that. In rung 2 rather than a rung of their own because
 * they are the level the reader is in, which is what the floor is for —
 * 261003k deferred exactly this (§ Not in this change). A section with no
 * sub-sections draws as it always did. Plan 261029a § Stage 1, item 4.
 *
 * **Rungs 1 and 2 are built and never chosen, since 2026-10-03.** OutlinePanel
 * draws rung 3 at the least and lets the list scroll when it does not fit
 * (OutlinePanel.tsx § `fit`; Greg, spya-s46j8f; plan 261003k). They stay
 * because each rung is the one below plus one thing, and the walk reads that
 * way.
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
  /**
   * The indent: 1 = part, 2 = section, 3 = sub-section, and a paragraph one
   * below whatever it hangs off. Whether a row is a paragraph is `paragraph`,
   * not this — a sub-section and a section's paragraph are both level 3.
   */
  level: number;
  /** A paragraph row: a leaf, drawn at rung 5 and never marked current. */
  paragraph: boolean;
  /** Where clicking it goes — the row's first block. */
  blockId: BlockId;
  startRow: number;
  endRow: number;
  /** The line itself. Never empty — a node with no text gets no row at all. */
  text: string;
  /** Whose words `text` is — tree.ts § `nodeLabel`. OutlinePanel puts the face on it. */
  voice: Voice;
  /** The gist, on the current section only (rung 3). */
  sentence?: string;
  /** The arc sentence, on the current part only (rung 4). */
  arc?: string;
  /** The apparatus — one row, never expanded, never given a sentence. */
  supplement: boolean;
  /**
   * Wholly front or back matter (one stretch, or stretches back to back), which the prose folds
   * to a stub: drawn faint with the stub's ⓘ — structure.ts §
   * `StructureRow.matter` has the rule.
   */
  matter: boolean;
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
function rowText(entry: SummaryNode): { text: string; voice: Voice } | null {
  /* `SummaryNode.title`, not the node's: the article's own "3.2" taken off,
     since ours is drawn beside it (tree.ts; SPIDERYARN-READING2-4Q). The words
     and whose they are come from one call (tree.ts § `nodeLabel`). */
  return nodeLabel(entry, entry.title);
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
   * never claims one — see `PARAGRAPHS_ARE_NEVER_CURRENT`. Since 261029a the
   * list it is measured over is Structure's frontier (position.ts §
   * `structureFrontier`), so where an article divides a section it is the
   * first row of the *sub-section* under the line: finer, and still never a
   * paragraph.
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
  /**
   * **Structure's Expanded sub-mode** (`?structure=expanded`): every part and
   * every section under it, each with its gist, and every part's arc — rather
   * than the fisheye's one open part. `rung` and `allowParagraphs` are ignored,
   * and no paragraph row is drawn: they are navLabels pointing at prose that is
   * beside them, and "the summaries" Greg asked to see are the gists. Through
   * this function rather than a second walk, so the marks agree with the rows
   * for the reason this file's header gives.
   * docs/plans/261001q-structure-fisheye-expanded-and-arrow-keys.md.
   */
  expanded?: boolean;
  /** The stretches the prose folds (matter-view.ts § `matterStretches`), for `OutlineRow.matter`. */
  matter?: readonly MatterRange[];
}

const NO_MATTER: readonly MatterRange[] = [];

const contains = (n: SummaryNode, row: number) => row >= n.startRow && row <= n.endRow;

/** A node with children — a section or sub-section by shape, not a paragraph. The projected
    list, as `expand` reads it: Structure builds its tree at full depth, so nothing is cut. */
const hasChildren = (n: SummaryNode) => n.children.length > 0;

/**
 * Build the drawn list for one rung.
 *
 * The walk is deliberately explicit rather than a recursion over `deep`,
 * because Summary's outline rule, `showsChildren` (removed with that outline on
 * 2026-10-01), could not express this shape: it had a whole-level cut-off, a
 * closed set and an opened set, and none of them meant
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
  expanded = false,
  matter = NO_MATTER,
}: Input): OutlineProjection {
  if (!root) return { rows: [], currentId: null, rung };

  const parts = root.children;
  const currentPart = parts.find((p) => contains(p, focusRow)) ?? null;
  /* **Only a node with children of its own can be current below the parts**
     (`hasChildren`): `focusRow` is the first row of Structure's frontier item
     (position.ts § `structureFrontier`), the deepest node with children around
     the reader. Where that is a part with paragraphs directly under it, its
     first row is the first paragraph's, and the child containing it is not
     where the reader is. Identical on every tree whose sections all have
     children. Plan 261029a. */
  const currentSection =
    currentPart?.children.find((s) => contains(s, focusRow) && hasChildren(s)) ?? null;
  const currentSub =
    currentSection?.children.find((s) => contains(s, focusRow) && hasChildren(s)) ?? null;
  /** The node the sentence and the paragraphs hang off: the sub-section the reader is in, else the section. */
  const deepest = currentSub ?? currentSection;

  const rows: OutlineRow[] = [];

  const push = (
    entry: SummaryNode,
    level: number,
    extra: { sentence?: string; arc?: string } = {},
    /* A paragraph row, which is never marked current. Its own flag rather than
       `level === 3`, because Expanded draws a sub-section at level 3 too. */
    paragraph = false,
  ): OutlineRow | null => {
    const label = rowText(entry);
    /* No text of any kind — no row. Never a blank one: an empty line in a list
       whose whole promise is "this is the shape of the document" is a hole
       nothing reports. */
    if (label === null) return null;
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
      paragraph,
      blockId: entry.node.range[0],
      startRow: entry.startRow,
      endRow: entry.endRow,
      text: label.text,
      voice: label.voice,
      ...(extra.sentence !== undefined && { sentence: extra.sentence }),
      ...(extra.arc !== undefined && { arc: extra.arc }),
      supplement,
      matter: coveredByStretches(entry.startRow, entry.endRow, matter),
      /* A childless node below the parts is a paragraph by shape, whichever
         row it is drawn as — the part-with-paragraphs case above. */
      here:
        (paragraph || (level > 1 && !hasChildren(entry))) && PARAGRAPHS_ARE_NEVER_CURRENT
          ? false
          : contains(entry, focusRow),
      now: false,
      before: entry.endRow < focusRow,
      tier: "far",
    };
    rows.push(row);
    return row;
  };

  /**
   * **Expanded: every node above the paragraphs, at any depth, with its gist.**
   * A tree may be deeper than part → section (tests/supplement.test.ts has a
   * valid depth-4 one), so this recurses rather than stopping at level 2 as
   * the fisheye does — GPT Sol's plan review, 261001q, finding 6. Below the
   * sections a leaf is a paragraph and gets no row. A node with no text gets
   * no row either, but its
   * children are still walked: a section with no title must not take its
   * sub-sections with it. A sub-section is level 3 and drawn as a section, not
   * a paragraph (`OutlineRow.paragraph`); deeper than 4 is drawn at 4's indent,
   * which is as far as the stylesheet goes (plan 261029a, item 5).
   */
  const expand = (entry: SummaryNode, depth: number) => {
    const supplement = supplementOf.has(entry.node.id);
    const arc = depth === 1 && !supplement ? arcByRow?.get(entry.startRow)?.text : undefined;
    const gist = supplement ? undefined : entry.gist;
    push(entry, Math.min(depth, 4), {
      ...(gist !== undefined && { sentence: gist }),
      ...(arc !== undefined && { arc }),
    });
    /* The apparatus gets one row and stops, as in the fisheye. */
    if (supplement) return;
    for (const child of entry.children) {
      /* A part's children are drawn whatever they hold, as the fisheye draws
         them — a section with no children of its own is still a section (the
         `revistes-ub-30977` case in `rowText` above). Below that, only a node
         with children: a childless one there is a paragraph. */
      if (depth === 1 || child.children.length > 0) expand(child, depth + 1);
    }
  };

  if (expanded) {
    for (const part of parts) expand(part, 1);
  } else for (const part of parts) {
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

    /** The sentence, at rung 3, on the deepest current node only. */
    const sentenceOf = (entry: SummaryNode) =>
      rung >= 3 && entry === deepest && entry.gist !== undefined ? { sentence: entry.gist } : {};
    /**
     * Rung 5: the paragraphs of the deepest current node, one level under it.
     * **Only ever leaves**, so a section whose children are sub-sections (or a
     * mix) gets none here — its sub-sections are drawn at rung 2 instead.
     */
    const paragraphsOf = (entry: SummaryNode, level: number) => {
      const kids = entry.children;
      if (
        rung < 5 ||
        entry !== deepest ||
        !allowParagraphs ||
        kids.length === 0 ||
        kids.length > PARAGRAPH_CAP ||
        kids.some(hasChildren)
      ) {
        return;
      }
      for (const para of kids) push(para, level, {}, true);
    };

    for (const section of part.children) {
      const drawn = push(section, 2, sentenceOf(section));
      if (!drawn) continue;
      if (section === currentSection) {
        /* The section the reader is in, divided by the article: its
           sub-sections, each a row of its own. A leaf among them is a
           paragraph and waits for rung 5 like any other. */
        for (const sub of section.children) {
          if (!hasChildren(sub)) continue;
          if (push(sub, 3, sentenceOf(sub))) paragraphsOf(sub, 4);
        }
      }
      paragraphsOf(section, 3);
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
    /* Expanded is not a fisheye, so nothing fades with distance: every row is
       drawn as the fisheye draws the rows beside the reader, and the one they
       are in keeps its emphasis. */
    if (expanded) row.tier = i === cur ? "cur" : "near";
    else row.tier = cur === -1 ? "far" : tierByDistance(Math.abs(i - cur));
  });

  return { rows, currentId, rung };
}
