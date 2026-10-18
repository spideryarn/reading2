/**
 * **The chevron on a heading, the masthead's fold-all, and the stub of a
 * stretch of front or back matter** — the three controls over fold.ts's store.
 *
 * Each is its own small subscriber, so folding a section re-renders a chevron
 * or two and never the prose table, which is memoised over every row
 * (TableView.tsx). docs/plans/261002e-collapsible-headings-and-fold-all.md.
 */
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import type { MouseEvent } from "react";
import type { BlockId } from "../types.js";
import { STUB_CLASS, toggleFold, toggleFoldAll, toggleStretch, useFold } from "./fold.js";
import { STUB_PRESS } from "./matter-view.js";
import { ControlTip, Tooltip } from "./Tooltip.js";
import { usePressToggle } from "./usePressToggle.js";

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
 * after *Show counts* (the count of sections went behind that on 2026-10-15,
 * plan 261015c). Absent when the article has no heading with anything under
 * it.
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


/**
 * **A shut stretch's one line, and the chevron that puts an open one away** —
 * the stub of front or back matter (fold.ts § Front and back matter;
 * matter-view.ts for the words).
 *
 * Greg, 2026-10-17 (`spya-k7gm2b`): *"This requires delicate UI (including an
 * information-button/tooltip) so that they don't get in the way, but that the
 * user can notice/discover them if needed."* So: one small line in the
 * interface face, faint ink, no box (fonts.md: these are the app's words, not
 * the author's) — a chevron, what is folded, how much — and an ⓘ beside it
 * with the card that says what it is and that nothing is gone.
 *
 * **Shut**, it renders `.matter-stub`, the one child of its cell the fold
 * store's rule leaves showing (fold.ts § `stubCss`); the block's own content
 * is hidden around it. **Open**, it renders the heading's fold chevron in the
 * same place, `.fold-toggle`, with *Fold this away again*: the same control
 * for the same job (controls.md § Controls that do the same job look the
 * same). A small subscriber of its own, like `FoldToggle`, so opening a
 * stretch re-renders this and never the prose table.
 *
 * Outside `.prose`, like everything else the table puts in the cell, so
 * comment offsets are untouched.
 * docs/plans/261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md § Stage 3.
 */
export function MatterStub({
  id,
  label,
  count,
  what,
  how,
}: {
  /** The stretch's first block: the row the stub stands in. */
  id: BlockId;
  /** "Abstract" — matter-view.ts § `stubLabel`. */
  label: string;
  /** "200 words" — § `stubCount`. */
  count: string;
  /** The card's first paragraph — § `stubWhat`. */
  what: string;
  /** The card's second paragraph — § `stubHow`. */
  how: string;
}) {
  const { shut } = useFold();
  const info = usePressToggle();
  /* Not into the row: a click on the row is how a finger selects it
     (TableView.tsx § `isBlockSelectionTap`), and this is not that. */
  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    toggleStretch(id);
  };
  if (!shut.has(id)) {
    return (
      <Tooltip
        placement="left"
        className="tip-soon"
        content={
          <ControlTip
            head="Fold this away again"
            what={`${label}, folded back to one line.`}
            how="Spideryarn folds it when an article opens. Nothing is removed."
          />
        }
      >
        <button
          type="button"
          className="fold-toggle matter-fold-away"
          aria-expanded={true}
          aria-label={`Fold away: ${label}`}
          onClick={toggle}
        >
          <ChevronDown aria-hidden="true" />
        </button>
      </Tooltip>
    );
  }
  return (
    <div className={STUB_CLASS}>
      <button type="button" className="matter-stub-open" aria-expanded={false} onClick={toggle}>
        <ChevronRight aria-hidden="true" />
        <span className="matter-stub-label">{label}</span>
        <span className="matter-stub-count">{count}</span>
      </button>
      <Tooltip
        placement="bottom"
        className="tip-soon"
        open={info.open}
        onOpenChange={info.onOpenChange}
        content={<ControlTip head={label} what={what} how={how} press={STUB_PRESS} />}
      >
        <button
          type="button"
          className={`matter-stub-info${info.open ? " on" : ""}`}
          aria-label={`About ${label}`}
          aria-expanded={info.open}
          {...info.trigger}
          onClick={(e) => {
            e.stopPropagation();
            info.trigger.onClick();
          }}
        >
          <Info aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}
