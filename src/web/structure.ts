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
 * on. See `PARAGRAPH_IS_NEVER_CURRENT`.
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
const PARAGRAPH_IS_NEVER_CURRENT = false;

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
   *
   * **`rows.length + earlier + later` is the number of *drawable* siblings, not
   * the number of children in the tree**, and the two differ by however many
   * `rowText` dropped for having no title and no navLabel. A browser pass found
   * this as an off-by-one — 1,118 against a tree node with 1,119 children
   * (2026-09-07) — and it is the right answer rather than a defect: a node with
   * nothing to say cannot be counted as a row the reader could have seen, since
   * there is no wording that would put it on screen. Counting it would make the
   * counter a promise the panel can never keep.
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
   * `PARAGRAPH_IS_NEVER_CURRENT`.
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
  /**
   * **Handed in, never recomputed.** This argument is the whole of the "one
   * selection model" claim in the docblock above, and until 2026-09-07 it was
   * not: `makeRow` ran its own `contains(entry, focusRow)` here, which is a
   * *second* answer to the question the walk below already asked.
   *
   * On a well-formed tree the two agree, which is exactly why the test named
   * "from one selection" passed over the old code — GPT Sol's code review,
   * finding 4. On a tree with overlapping sibling ranges they do not: the walk
   * picks the first containing part while this marked every containing part, so
   * the panel could light two rows and `windowed()` would then centre on the
   * wrong one. A comment claiming an invariant the code does not have is worse
   * than no comment.
   */
  here: boolean,
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
    here,
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
 * `limit` is `null` when the column has room for everything. With no current row
 * — the reader is past the last part — it keeps the head of the list rather than
 * an arbitrary middle.
 *
 * **The window is not a nicety, and a browser said so.** The plan claimed the
 * corpus fits at ordinary heights and that a level which will not fit is handled
 * by the ladder not climbing to it. Both were wrong: the sibling levels are
 * mandatory, so there is no lower rung to fall to (GPT Sol's plan review,
 * finding 5), and on a 22-part article the band clipped **62,737px** of column B
 * with no scrollbar and nothing to say so — measured in Chrome, 2026-09-07.
 * `StructurePanel` measures the real rows and hands the capacity in.
 *
 * Exported so the panel can apply it to rows it has already measured, rather
 * than re-running the projection with a limit and drawing a *different* list
 * from the one the measurement was taken on.
 */
export function windowed(rows: StructureRow[], limit: number | null): StructureColumn {
  if (limit === null || limit >= rows.length) return { rows, earlier: 0, later: 0 };
  /* **Zero capacity draws zero rows, and it used to draw all of them.** `limit
     <= 0` fell into the no-limit branch above, so a column measured as having
     room for nothing produced the *maximum* overflow — the failure mode exactly
     inverted, and silent, because the panel clips. `null` is the no-limit
     sentinel and a number is a number. GPT Sol's code review, finding 3. */
  if (limit <= 0) {
    /* Split at the reader rather than calling the whole level "later", so the
       two counters still say which side of them the reader is on — the only
       thing left to say once no row fits. */
    const centre = rows.findIndex((r) => r.here);
    const at = centre === -1 ? 0 : centre;
    return { rows: [], earlier: at, later: rows.length - at };
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
   * `PARAGRAPH_IS_NEVER_CURRENT`.
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

  /* ---- the one selection model. Everything below reads these three. ---- */
  const parts = root.children;
  const selectedPart = parts.find((p) => contains(p, focusRow)) ?? null;
  /**
   * **A part with no text of any kind is not a part the reader can be in.**
   *
   * `rowText` drops such a node from column A — a blank row in a list whose
   * whole promise is "this is the shape of the document" is a hole nothing
   * reports. But the *selection* used to keep it, so column B would list its
   * sections under a header that was not drawn, beside a column A with nothing
   * marked: the right-hand column as the inside of a row that is not there.
   * GPT Sol's code review, finding 4. One `currentPart` for both columns, and
   * it is `null` when the part cannot be shown.
   */
  const currentPart = selectedPart !== null && rowText(selectedPart) !== null ? selectedPart : null;
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
    const row = makeRow(part, "part", isCurrent, focusRow, wantsGist ? part.gist : undefined);
    if (row) aRows.push(row);
  }

  /* ---- column B: the current part's sections, then its detail ----

     **The sibling sections are built and windowed on their own, and the current
     section's paragraphs are spliced in afterwards.** That ordering is the whole
     of GPT Sol's code review finding 3, and the version before it was wrong in
     two ways at once: paragraphs went into the same list as the sections and the
     combined list was windowed, so with a capacity a *higher* rung could draw
     *fewer* sections than a lower one — the mandatory level losing rows to an
     optional one — and the paragraph run itself could be cut in half, which is
     precisely the truncation `PARAGRAPH_CAP`'s comment promises never happens.
     `earlier`/`later` also stopped being counts of sections and became counts of
     a mixture, which is a number about nothing.

     So: sections are the level, and the window is over the level. Paragraphs are
     detail hung off one of its rows, and they go in whole or not at all. */
  let paragraphTotal: number | null = null;
  /* **No current part means no column B, and that is a state rather than a
     failure**: the reader is above the first part or below the last, or the tree
     covers less than the article. Drawing the first part's sections there would
     be a guess presented as an answer. */
  const sections = currentPart && currentPart.supplement !== true ? currentPart.children : [];
  const sectionRows: StructureRow[] = [];
  for (const section of sections) {
    const isCurrent = section === currentSection;
    const wantsGist =
      rungB >= 5 || (rungB >= 2 && isCurrent) || (rungB >= 4 && isNear(sections, section, currentSection));
    const row = makeRow(
      section,
      "section",
      isCurrent,
      focusRow,
      wantsGist ? section.gist : undefined,
    );
    if (row) sectionRows.push(row);
  }

  const columnB = windowed(sectionRows, limitB);

  /* The paragraph rung, spliced under the current section if it is still on
     screen after the window and if the whole run fits in what is left. */
  if (rungB >= 3 && currentSection !== null) {
    const at = columnB.rows.findIndex((r) => r.here);
    const kids = currentSection.children;
    if (at !== -1 && kids.length > 0) {
      const paraRows = kids
        .map((p) => makeRow(p, "paragraph", PARAGRAPH_IS_NEVER_CURRENT, focusRow, undefined))
        .filter((p): p is StructureRow => p !== null);
      const room = limitB === null ? Number.POSITIVE_INFINITY : limitB - columnB.rows.length;
      const fits = allowParagraphs && kids.length <= PARAGRAPH_CAP && paraRows.length <= room;
      if (fits) {
        columnB.rows = [
          ...columnB.rows.slice(0, at + 1),
          ...paraRows,
          ...columnB.rows.slice(at + 1),
        ];
      } else if (allowParagraphs) {
        /* **The honest half of what a window would have claimed**, and it now
           covers both size reasons: more paragraphs than the cap, and more than
           the column has room for. Both are "this section is bigger than what
           you can see", which is the question the number answers.

           Withheld when `allowParagraphs` is false, because that absence is
           about the *page* — the band covers the prose, or stage 5's labels are
           not written — and a count there would explain the wrong thing: the
           reader would read "26 paragraphs" as the reason they cannot see them.
           And withheld below the cap on a roomy column, where the number is not
           news: a section with three paragraphs needs no figure. */
        if (kids.length > PARAGRAPH_CAP || paraRows.length > room) paragraphTotal = kids.length;
      }
    }
  }

  return {
    columnA: windowed(aRows, limitA),
    columnB,
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
