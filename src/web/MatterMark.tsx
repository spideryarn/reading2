/**
 * **The ⓘ after a Structure row that the prose folds away** — a row wholly
 * inside one stretch of front or back matter (structure.ts §
 * `StructureRow.matter`; plan 261018a § Stage 3, review F9).
 *
 * Greg, 2026-10-17 (`spya-vskdap`): *"default-collapsed for the Abstract too,
 * but visible in Structure so that the reader can see that there is an
 * Abstract and easily get to it if they want to."* So the row stays, with its
 * number and label, drawn faint, and this mark says why.
 *
 * **A glyph, not a second trigger.** The row is already a button with its own
 * hover card, and a tooltip inside a tooltip's trigger would open two cards at
 * once; the explanation is a line in the row's card (`MATTER_ROW_NOTE`), and
 * the mark is what tells the eye there is one. Inside the row's title in both
 * of Structure's faces, so the hidden measuring copies carry it too and wrap
 * exactly as the visible rows do.
 */
import { Info } from "lucide-react";

/** The line a matter row's card adds. */
export const MATTER_ROW_NOTE =
  "Front or back matter, which Spideryarn folds to one line in the article. Nothing is removed: going here opens it.";

export function MatterMark() {
  return (
    <>
      <Info className="struct-matter-mark" aria-hidden="true" />
      <span className="sr-only">, folded in the article</span>
    </>
  );
}
