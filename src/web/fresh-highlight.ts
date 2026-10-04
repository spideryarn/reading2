/**
 * **The highlight a selection has just made**: its colour, when it still
 * counts as untouched, and when a second selection is a correction of it.
 *
 * > how about if selecting text automatically applies the highlight and also
 * > pops up the fuller box to allow the user to customise (or remove) it, and
 * > they can just click off if they're happy with the highlighting
 * >
 * > — Greg, 2026-10-04
 *
 * Outside Referee mode, letting go of a selection stores a comment in
 * `DEFAULT_HIGHLIGHT` and opens `CommentDialog` on it (Reader.tsx
 * § `selectProse`). That box is *fresh* while it is the one the selection
 * opened. The rules that hang on it are in docs/project/comments.md § The box a
 * selection opens; the pure parts live here so the dialog, Reader and their
 * tests ask one definition.
 * docs/plans/261004f-selecting-applies-the-highlight-and-the-box-customises-or-removes-it.md.
 */
import type { Comment, HighlightColour } from "../types.js";

/** The colour a selection is highlighted in. Greg, 2026-10-03 (spya-ur8kum). */
export const DEFAULT_HIGHLIGHT: HighlightColour = "yellow";

/**
 * Is this row still exactly what the selection wrote, with nothing of the
 * reader's added to it?
 *
 * Only a pristine row may be taken away without being asked for by name: by
 * *Copy, don't highlight*, by a native copy, by an overlapping re-selection.
 * Everything else a reader can do to a comment is listed here, so adding a
 * field to `Comment` that a reader can set means adding it to this test.
 *
 * **The stored row can lag the reader.** A colour press and an edit write
 * nothing to the list until the server answers (`useComments` § `recolour`,
 * `edit`), so a caller that can know of a press not yet answered must ask that
 * as well — `CommentDialog`'s `touched`, Reader's `freshTouched`.
 */
export function isPristineHighlight(comment: Comment): boolean {
  return (
    comment.quote !== undefined &&
    comment.colour === DEFAULT_HIGHLIGHT &&
    !comment.body &&
    comment.threadId === undefined &&
    !comment.answer &&
    comment.status === "none" &&
    comment.criterionId === undefined &&
    comment.valence === undefined
  );
}

/** A passage inside one block: where it starts and the words it covers. */
export interface Span {
  blockId: string;
  start: number;
  quote: string;
}

/**
 * Do two selections in the same block share any characters?
 *
 * Both are `[start, start + quote.length)` in the block's rendered text, the
 * one offset space selections are read in (src/web/selection.ts). Touching
 * ends do not overlap.
 */
export function spansOverlap(a: Span, b: Span): boolean {
  return (
    a.blockId === b.blockId &&
    a.start < b.start + b.quote.length &&
    b.start < a.start + a.quote.length
  );
}
