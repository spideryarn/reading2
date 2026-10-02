/**
 * **The chevron on a heading, and the masthead's fold-all** — the two controls
 * over fold.ts's store.
 *
 * Each is its own small subscriber, so folding a section re-renders a chevron
 * or two and never the prose table, which is memoised over every row
 * (TableView.tsx). docs/plans/261002e-collapsible-headings-and-fold-all.md.
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import type { MouseEvent } from "react";
import type { BlockId } from "../types.js";
import { toggleFold, toggleFoldAll, useFold } from "./fold.js";
import { ControlTip, Tooltip } from "./Tooltip.js";

/**
 * The chord, spelled for both kinds of keyboard rather than sniffed — the way
 * the Metadata button's card spells ⌘-Enter (Dock.tsx).
 */
const CHORD = "⌘⌥T on a Mac, Ctrl+Alt+T elsewhere";

/**
 * **Fold or unfold one heading's section — or, with ⌥ / Alt held, all of
 * them**, the Finder's and VS Code's convention for a disclosure triangle.
 * Renders nothing on a heading with nothing under it.
 */
export function FoldToggle({ id }: { id: BlockId }) {
  const { folded, foldable } = useFold();
  if (!foldable.has(id)) return null;
  const isFolded = folded.has(id);
  const onClick = (e: MouseEvent) => {
    /* Not into the row: a click on the row is how a finger selects it
       (TableView.tsx § `isBlockSelectionTap`), and this is not that. */
    e.stopPropagation();
    if (e.altKey) toggleFoldAll();
    else toggleFold(id);
  };
  return (
    <Tooltip
      placement="left"
      className="tip-soon"
      content={
        <ControlTip
          head={isFolded ? "Show this section" : "Hide this section"}
          what={
            isFolded
              ? "Opens the paragraphs under this heading again."
              : "Folds away the paragraphs under this heading, down to the next heading at its level."
          }
          how={`⌥-click (Alt-click), or ${CHORD}, to fold or unfold every section at once.`}
        />
      }
    >
      <button
        type="button"
        className="fold-toggle"
        aria-expanded={!isFolded}
        aria-label={isFolded ? "Show this section" : "Hide this section"}
        data-folded={isFolded ? "" : undefined}
        onClick={onClick}
      >
        {isFolded ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
      </button>
    </Tooltip>
  );
}

/**
 * **Fold every section, or open them all** — on the masthead's facts line,
 * beside the count of sections it acts on. Absent when the article has no
 * heading with anything under it.
 */
export function FoldAllButton() {
  const { folded, foldable } = useFold();
  if (foldable.size === 0) return null;
  const anyFolded = folded.size > 0;
  return (
    <Tooltip
      placement="bottom"
      className="tip-soon"
      content={
        <ControlTip
          head={anyFolded ? "Unfold all" : "Fold all"}
          what={
            anyFolded
              ? "Opens every folded section."
              : "Folds every section down to its heading, so the article reads as an outline."
          }
          how={`Or ${CHORD}. Each heading's chevron folds just its own section.`}
        />
      }
    >
      <button type="button" className="fold-all" onClick={toggleFoldAll}>
        {anyFolded ? "Unfold all" : "Fold all"}
      </button>
    </Tooltip>
  );
}
