/**
 * **The mark after a Structure row's title: which figures, tables and media
 * its range holds.** Greg, spya-sb0c7e: *"perhaps we can have an icon for each
 * diagram or table contained in a section within structure so that you could
 * easily see which parts of the piece do have diagrams or tables and then use
 * structure to jump to them."*
 * docs/plans/261011b-skim-figures-walk-and-structure-figure-marks.md § Half 2.
 *
 * One component for both of Structure's faces, drawn through each face's one
 * shared row body (StructurePanel.tsx § `Row`, OutlinePanel.tsx § `RowBody`),
 * so the hidden measuring copies carry exactly the mark the drawn rows do.
 *
 * **Counted by row index, never by id** (block-ids.md § range checks): the
 * row's inclusive `startRow`/`endRow` against each figure's `row`. A part is
 * marked for what its sections hold — the mark is about the range, which is
 * how a reader finds the part to open.
 *
 * **A span, not a button**: the row it sits in is already the jump. One
 * `role="img"` with the whole sentence as its name; the icons and digits
 * inside are hidden, so a screen reader hears *"2 figures, 1 table"* once
 * rather than "2" and an unnamed picture.
 */
import { Film, Image as ImageIcon, type LucideIcon, Table2 } from "lucide-react";
import { type Figure, type FigureKind, figuresInRange } from "../figures.js";

/** Each kind's icon — here and on Skim's Figures rows (FiguresWalk.tsx). */
export const FIGURE_ICON: Record<FigureKind, LucideIcon> = { figure: ImageIcon, table: Table2, media: Film };

/** The order the icons are drawn in, and their words. */
const KINDS: readonly { kind: FigureKind; Icon: LucideIcon; one: string; many: string }[] = [
  { kind: "figure", Icon: FIGURE_ICON.figure, one: "figure", many: "figures" },
  { kind: "table", Icon: FIGURE_ICON.table, one: "table", many: "tables" },
  { kind: "media", Icon: FIGURE_ICON.media, one: "media item", many: "media items" },
];

export function FigureMark({
  figures,
  startRow,
  endRow,
}: {
  /** `figuresOf(article.blocks)`, worked out once for the whole band. */
  figures: readonly Figure[];
  /** The row's range, inclusive at both ends — row indices into `blocks`. */
  startRow: number;
  endRow: number;
}) {
  if (figures.length === 0) return null;
  const counts = figuresInRange(figures, startRow, endRow);
  const present = KINDS.filter((k) => counts[k.kind] > 0);
  if (present.length === 0) return null;
  const name = present
    .map((k) => `${counts[k.kind]} ${counts[k.kind] === 1 ? k.one : k.many}`)
    .join(", ");
  return (
    <span className="fig-mark" role="img" aria-label={name}>
      {present.map(({ kind, Icon }) => (
        <span key={kind} className="fig-mark-kind" data-kind={kind} aria-hidden="true">
          <Icon size={12} />
          {counts[kind] > 1 ? <span className="fig-mark-n">{counts[kind]}</span> : null}
        </span>
      ))}
    </span>
  );
}
