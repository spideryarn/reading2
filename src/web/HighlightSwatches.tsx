/**
 * **The colour row** — none, or one of the four highlight colours — shared by
 * the box a selection opens (`AnnotateDialog`) and the box a click on a mark
 * opens (`CommentDialog`). docs/plans/261003e-span-highlights-with-a-colour.md.
 *
 * **Controlled, with no state of its own.** In `AnnotateDialog` the value is the
 * draft's; in `CommentDialog` it is the stored comment's, so a recolour shows
 * once the server has it and a failed one does not look like a success — the
 * reason `PlaceOnCriterion` gives for the same choice (plan review S3).
 *
 * **A radiogroup of `<button>`s**, the pattern `CriteriaPanel`'s kind chips and
 * the Dock's modes use: each swatch its own tab stop and no arrow handler,
 * because the arrows belong to the article (tests/arrows-belong-to-the-article.test.tsx).
 * Each carries its colour's name as its accessible name, so the colour is never
 * the only thing that says which one it is.
 */
import { useId } from "react";
import { HIGHLIGHT_COLOURS, type HighlightColour } from "../types.js";

/** The reader's word for each colour, and for none. */
export const HIGHLIGHT_COLOUR_LABEL: Record<HighlightColour, string> = {
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
};

interface Props {
  value: HighlightColour | null;
  onChange(next: HighlightColour | null): void;
  /** Off while a write it depends on is not yet possible. */
  disabled?: boolean;
}

export function HighlightSwatches({ value, onChange, disabled = false }: Props) {
  const options: (HighlightColour | null)[] = [null, ...HIGHLIGHT_COLOURS];
  /* Both dialogs can be mounted at once (a click on a mark with a selection
     still live), so the label id has to be unique per row. */
  const labelId = useId();
  return (
    <div className="hl-swatches">
      <span className="hl-swatches-label" id={labelId}>
        Colour
      </span>
      <div className="hl-swatches-row" role="radiogroup" aria-labelledby={labelId}>
        {options.map((c) => {
          const on = c === value;
          const name = c === null ? "No colour" : HIGHLIGHT_COLOUR_LABEL[c];
          return (
            // biome-ignore lint/a11y/useSemanticElements: a radiogroup of <button>s is the documented ARIA pattern, and the one CriteriaPanel.tsx and the Dock already use
            <button
              key={c ?? "none"}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={name}
              title={name}
              tabIndex={0}
              disabled={disabled}
              className={`hl-swatch${on ? " on" : ""}`}
              data-colour={c ?? "none"}
              onClick={() => {
                if (!on) onChange(c);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/** A small dot in a highlight's colour, for the drawer's row, named for a screen reader. */
export function HighlightDot({ colour }: { colour: HighlightColour }) {
  return (
    <span
      className="hl-dot"
      data-colour={colour}
      role="img"
      aria-label={`${HIGHLIGHT_COLOUR_LABEL[colour]} highlight`}
    />
  );
}
