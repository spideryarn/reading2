/**
 * Structure mode's projection: the document's shape as two linked columns.
 *
 * Column A is every part of the piece. Column B is the sections of the part the
 * reader is standing in, with the current one expanded. The second is always the
 * inside of the row marked in the first — Miller columns, with the difference
 * that neither column ever scrolls: each spends its height down a ladder
 * instead.
 *
 * ## One selection model, and it is the constraint the whole file is shaped by
 *
 * `currentPart` and `currentSection` are computed **once**, from `focusRow`, and
 * both columns and every rung candidate are derived from that one answer. The
 * ladders decide *how much* is drawn; they never decide *what is current*.
 *
 * That is `outline.ts`'s rule and it is here for the same reason, made worse by
 * there being two columns: when two copies of "which row is the reader in"
 * disagree, nothing errors — column A marks one part while column B lists
 * another part's sections, and it looks entirely plausible. The repo has already
 * paid for this once, in the summary panel's renderer and its `currentEntryId`
 * walk (docs/project/summaries.md § Which row is "the relevant one").
 *
 * Pure, and takes no DOM. Which rung actually fits is decided by the panel
 * measuring the candidates this builds.
 *
 * docs/plans/260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch.md
 */
import type { BlockId, NodeId } from "../types.js";
import type { SummaryNode } from "./tree.js";

/**
 * How far down each column's ladder we got. Every rung is all-or-nothing within
 * its level: a partly-drawn level is a lie about the structure.
 *
 * Column A:
 *  1  every part, one line each      — if this will not fit, nothing will
 *  2  + a gist on the current part
 *  3  + gists on its near neighbours
 *  4  + a gist on every part
 *
 * Column B:
 *  1  the current part's sections, one line each
 *  2  + a gist on the current section
 *  3  + the current section's paragraphs
 *  4  + gists on the near sections
 *  5  + a gist on every section
 *
 * **The paragraphs come before the neighbours' gists**, and the order is
 * Outline's argument transplanted: the expensive rung goes after the cheap
 * valuable ones, or it never gets drawn. Here it is third rather than last
 * because paragraphs are what column B is *for* — they are the level the reader
 * is actually in — where in Outline they restate prose already on screen.
 */
export type RungA = 1 | 2 | 3 | 4;
export type RungB = 1 | 2 | 3 | 4 | 5;

export const RUNGS_A: readonly RungA[] = [1, 2, 3, 4];
export const RUNGS_B: readonly RungB[] = [1, 2, 3, 4, 5];

/**
 * The most paragraphs rung 3 will draw.
 *
 * Outline's number and Outline's reasoning: Noema's "Brains Are Not Computers"
 * has 26 paragraph children where its neighbours have 3 to 5, so expanding it
 * inserts twenty-six rows on crossing one boundary. A section with more
 * paragraphs than this gets **none of them and an honest total instead** — never
 * a truncated list, which would say the section ends where the list does, and
 * never a centred window, which would say we know which paragraph the reader is
 * on. See `PARAGRAPHS_HAVE_NO_CENTRE`.
 */
export const PARAGRAPH_CAP = 8;

/**
 * **There is no centre to window a paragraph list around, so it is never
 * windowed and never counted from.**
 *
 * `focusRow` is section-granular — it is `sections[…].row`, the first row of the
 * section under the focus line (useColumnContext.ts) — and `?at=` is the same
 * (position.ts § sectionDepth). So nothing on this page knows which paragraph
 * the reader is on.
 *
 * `outline.ts` § `PARAGRAPHS_ARE_NEVER_CURRENT` draws the consequence for the
 * *mark*. This is the consequence for the *window*: a centred paragraph window
 * with "12 earlier" and "9 later" beside it is that same false claim with two
 * numbers attached, and it would centre on the section's first paragraph every
 * time, on every article, for ever.
 *
 * The sibling levels are different and the difference is exactly the available
 * signal: which **part** and which **section** the reader is in is what
 * `focusRow` means, so those two may be windowed and counted. GPT Sol's review
 * of the plan, finding 3, 2026-09-07.
 */
const PARAGRAPHS_HAVE_NO_CENTRE = true;

export type RowKind = "part" | "section" | "paragraph";

export interface StructureRow {
  id: NodeId;
  kind: RowKind;
  /** "3.2" — the reader's address, and blank on the apparatus. */
  number: string;
  /** The line itself. Never empty — a node with no text gets no row at all. */
  text: string;
  /** Where clicking it goes — the row's first block. */
  blockId: BlockId;
  startRow: number;
  endRow: number;
  /** One sentence, present only on the rows the rung reached. */
  gist?: string;
  /** The reader is inside this row. Never true of a paragraph. */
  here: boolean;
  /** Already read: this row ends above the reader. */
  before: boolean;
  /** The apparatus — one row, never expanded, never given a gist. */
  supplement: boolean;
}

export interface StructureColumn {
  rows: StructureRow[];
  /**
   * Rows the window left off each end, as counts to draw — "12 earlier",
   * "9 later". Zero means there is nothing hidden, not that the count is
   * unknown; a column with no window has both at zero.
   */
  earlier: number;
  later: number;
}

export interface StructureProjection {
  columnA: StructureColumn;
  columnB: StructureColumn;
  /** Column B's quiet header: the part its rows are the inside of. */
  ofPart: { id: NodeId; number: string; text: string } | null;
  /**
   * How many paragraphs the current section has, when none of them are drawn
   * and the reader would otherwise not know the section is unusually large.
   *
   * `null` when they *are* drawn, or when the rung never reached them, or when
   * the section is small enough that the number says nothing. A number here is
   * the honest half of what a centred window would have claimed —
   * `PARAGRAPHS_HAVE_NO_CENTRE`.
   */
  paragraphTotal: number | null;
  rungA: RungA;
  rungB: RungB;
}

/**
 * What a row says, and the one place the navLabel fallback is allowed.
 *
 * The same rule and the same reason as `outline.ts` § `rowText`: a `navLabel` is
 * a pointer to prose and must never stand *in place of* prose that could be
 * shown, and here it never does, because this is navigation chrome. The case is
 * real and came out of the corpus rather than the docs — `revistes-ub-30977` has
 * two depth-2 nodes with no children, one with an empty title and a navLabel and
 * one with neither. Returning `null` for the second is what stops a blank row in
 * a list whose whole promise is "this is the shape of the document".
 */
function rowText(node: SummaryNode): string | null {
  const title = node.node.title?.trim();
  if (title) return title;
  const nav = node.node.navLabel?.trim();
  if (nav) return nav;
  return null;
}

/** Inclusive at both ends: `startRow`/`endRow` are row indices into `blocks`,
    and the first row of a node is the row a jump into it lands on, so an
    exclusive comparison would leave the reader unmarked exactly there. */
const contains = (n: SummaryNode, row: number) => row >= n.startRow && row <= n.endRow;

function makeRow(
  entry: SummaryNode,
  kind: RowKind,
  focusRow: number,
  gist: string | undefined,
): StructureRow | null {
  const text = rowText(entry);
  if (text === null) return null;
  const supplement = entry.supplement === true;
  return {
    id: entry.node.id,
    kind,
    /**
     * **A supplement wears no number.** `buildSummaryTree` numbers every child
     * positionally, so the apparatus would come out as "8" beside seven parts of
     * argument — telling the reader there is an eighth thing to read when there
     * are seven and then the endnotes. The same rule `outline.ts` and
     * `buildArcColumn` keep: the apparatus is in the structure and outside the
     * numbering.
     *
     * A row dropped for having no text keeps its siblings' numbers as they are.
     * Renumbering to close the gap would tell the reader the third part is the
     * second one, while the spine, Outline and Hierarchy all still call it the
     * third.
     */
    number: supplement ? "" : entry.number,
    text,
    blockId: entry.node.range[0],
    startRow: entry.startRow,
    endRow: entry.endRow,
    ...(gist !== undefined && { gist }),
    here: kind === "paragraph" && PARAGRAPHS_HAVE_NO_CENTRE ? false : contains(entry, focusRow),
    before: entry.endRow < focusRow,
    supplement,
  };
}

/**
 * Keep at most `limit` rows, centred on the current one, and say how many were
 * left off each end.
 *
 * **Centred on `here`, never on the middle of the list.** A window that kept the
 * middle would drift away from the reader as they moved through a long part, and
 * the counts would describe a list nobody is in.
 *
 * `limit` is `null` when the column has room for everything, which is the case
 * on the corpus at ordinary window heights; the window exists for the short
 * viewport and the long part, where the base rung has no lower rung to fall to
 * (GPT Sol, finding 5). With no current row — the reader is past the last part —
 * it keeps the head of the list rather than an arbitrary middle.
 */
function windowed(rows: StructureRow[], limit: number | null): StructureColumn {
  if (limit === null || limit >= rows.length || limit <= 0) {
    return { rows, earlier: 0, later: 0 };
  }
  const centre = rows.findIndex((r) => r.here);
  const start =
    centre === -1
      ? 0
      : Math.max(0, Math.min(rows.length - limit, centre - Math.floor((limit - 1) / 2)));
  return {
    rows: rows.slice(start, start + limit),
    earlier: start,
    later: rows.length - (start + limit),
  };
}

export interface StructureInput {
  /** The tree, nested and numbered — `buildSummaryTree` at full depth. */
  root: SummaryNode | null;
  /**
   * Which row the reader is at — `LiveContext.focusRow`.
   *
   * **Section-granular, and every consumer here has to know that**; see
   * `PARAGRAPHS_HAVE_NO_CENTRE`.
   */
  focusRow: number;
  rungA: RungA;
  rungB: RungB;
  /**
   * Whether paragraph rows are permissible at all.
   *
   * Two things fold into this one boolean, and both are the caller's to answer:
   * whether the prose is beside the band rather than under it — the navLabel
   * fallback above is only defensible while the article is visible — and whether
   * stage 5's labels are ready (`paragraphLabelsReady` in nav-labels.ts).
   * Outline withholds the whole layer for the second, rather than drawing blanks
   * that read as missing article structure, and so does this.
   */
  allowParagraphs: boolean;
  /** How many rows each column has room for, or `null` for all of them. */
  limitA?: number | null;
  limitB?: number | null;
}

export function structureProjection({
  root,
  focusRow,
  rungA,
  rungB,
  allowParagraphs,
  limitA = null,
  limitB = null,
}: StructureInput): StructureProjection {
  const empty: StructureColumn = { rows: [], earlier: 0, later: 0 };
  if (!root) {
    return { columnA: empty, columnB: empty, ofPart: null, paragraphTotal: null, rungA, rungB };
  }

  /* ---- the one selection model. Everything below reads these two. ---- */
  const parts = root.children;
  const currentPart = parts.find((p) => contains(p, focusRow)) ?? null;
  const currentSection =
    currentPart?.children.find((s) => contains(s, focusRow)) ?? null;

  /* ---- column A: every part ---- */
  const aRows: StructureRow[] = [];
  for (const part of parts) {
    const isCurrent = part === currentPart;
    /* The apparatus has no gist by design (src/supplement.ts), so it is never
       asked for one — an `undefined` here and a missing gist are the same
       thing to the panel, and this keeps them the same thing here. */
    const supplement = part.supplement === true;
    const wantsGist =
      !supplement &&
      (rungA >= 4 || (rungA >= 2 && isCurrent) || (rungA >= 3 && isNear(parts, part, currentPart)));
    const row = makeRow(part, "part", focusRow, wantsGist ? part.gist : undefined);
    if (row) aRows.push(row);
  }

  /* ---- column B: the current part's sections ---- */
  const bRows: StructureRow[] = [];
  let paragraphTotal: number | null = null;
  /* **No current part means no column B, and that is a state rather than a
     failure**: the reader is above the first part or below the last, or the tree
     covers less than the article. Drawing the first part's sections there would
     be a guess presented as an answer. */
  const sections = currentPart && currentPart.supplement !== true ? currentPart.children : [];
  for (const section of sections) {
    const isCurrent = section === currentSection;
    const wantsGist =
      rungB >= 5 || (rungB >= 2 && isCurrent) || (rungB >= 4 && isNear(sections, section, currentSection));
    const row = makeRow(section, "section", focusRow, wantsGist ? section.gist : undefined);
    if (!row) continue;
    bRows.push(row);

    if (!isCurrent || rungB < 3) continue;
    const kids = section.children;
    if (kids.length === 0) continue;
    if (!allowParagraphs || kids.length > PARAGRAPH_CAP) {
      /* **The honest half of what a window would have claimed.** Only worth
         saying when it is news: a section with three paragraphs is not something
         the reader needs a number for, and the number is drawn at all only
         because the alternative — a section whose 26 paragraphs are invisible —
         looks exactly like a section with none. Suppressed when the layer is
         withheld for a reason that is not about size (`allowParagraphs`), since
         then the count would explain the wrong absence. */
      if (allowParagraphs && kids.length > PARAGRAPH_CAP) paragraphTotal = kids.length;
      continue;
    }
    for (const para of kids) {
      const p = makeRow(para, "paragraph", focusRow, undefined);
      if (p) bRows.push(p);
    }
  }

  return {
    columnA: windowed(aRows, limitA),
    columnB: windowed(bRows, limitB),
    ofPart:
      currentPart === null
        ? null
        : ((): StructureProjection["ofPart"] => {
            const text = rowText(currentPart);
            if (text === null) return null;
            return {
              id: currentPart.node.id,
              number: currentPart.supplement === true ? "" : currentPart.number,
              text,
            };
          })(),
    paragraphTotal,
    rungA,
    rungB,
  };
}

/**
 * Is this node one of the current one's immediate neighbours?
 *
 * Two rather than a tier ladder, and deliberately so: the "near" rung exists to
 * spend leftover height on the rows either side of the reader, which is a
 * *quantity* of extra detail, not a gradient of importance. Outline's tiers are
 * a gradient because its rows are one sequence and distance along it is the
 * thing being drawn; here the columns already say what belongs to what, so a
 * third visual dimension would be saying it twice.
 */
function isNear(
  siblings: readonly SummaryNode[],
  node: SummaryNode,
  current: SummaryNode | null,
): boolean {
  if (current === null) return false;
  const i = siblings.indexOf(current);
  const j = siblings.indexOf(node);
  return i !== -1 && j !== -1 && Math.abs(i - j) === 1;
}
