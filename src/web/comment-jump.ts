/**
 * **Opening a question is a jump; stepping between them is not.**
 *
 * Both used to be one function — `goToComment` in App.tsx — and that was the
 * whole of the bug. The two call sites want opposite things from the history
 * stack, and a single function had to give them the same one:
 *
 *  - **The drawer's list** is a table of contents for the reader's own
 *    questions. Choosing one flings them an arbitrary distance across the
 *    article, which is exactly what
 *    docs/project/url-state.md § Position replaces history calls a deliberate
 *    act, and a deliberate act pushes — so there is a Back to press, and a
 *    return chip on a device that has no Back button at all
 *    (src/web/jump-history.ts).
 *  - **The dialog's arrows** are traversal. They walk down the article one
 *    question at a time, and docs/project/comments.md § Reading order says they
 *    behave like the arrow keys: *"it writes no position state of its own"*.
 *    Twenty questions spread through a piece must not cost twenty presses of
 *    Back — the same misery keynav.ts refuses for a keypress, and browsers
 *    throttle rapid Back, so it is not merely tedious. GPT Sol F9, 2026-09-06.
 *
 * **The split is better than either half alone**, and this is the part worth
 * knowing: a replace preserves the entry's stamp (router.ts § the wrapper's
 * three rules), so after stepping through eight questions the chip still points
 * at the place the reader *entered* the traversal from rather than at the
 * previous question. Entering by the drawer stamps once; the arrows leave the
 * stamp alone; the way home stays the way home.
 *
 * A module of its own rather than two closures in App.tsx, so that the
 * difference between them is a thing a test can hold — tests/comment-jump.test.ts
 * asserts the entry count on each path, which is the only assertion that can
 * tell the two apart. docs/plans/260906g-back-to-where-you-jumped-from.md § Stage B2.
 */
import type { BlockId } from "../types.js";
import { isBlockOnScreen, scrollToBlock } from "./scroll.js";

/** As much of a comment as moving to one needs: which passage it is about. */
export interface AnchoredComment {
  readonly id: string;
  readonly blockId: BlockId;
}

/**
 * The passage a comment is about, **or null when the reader is already looking
 * at it** — and null too when the comment is not one we hold.
 *
 * Two comments in one paragraph is the common case, and jolting the page
 * between them costs the reader their place for nothing
 * (docs/project/comments.md § Reading order). Both paths below ask this first,
 * so "already on screen" means the same thing on both of them.
 */
function passageToBringIntoView(
  comments: readonly AnchoredComment[],
  id: string,
): BlockId | null {
  const target = comments.find((c) => c.id === id);
  if (target === undefined) return null;
  return isBlockOnScreen(target.blockId) ? null : target.blockId;
}

/**
 * **Choosing a question out of the drawer: a jump.**
 *
 * `jumpTo` is App.tsx's, which is `beginJump` (keynav.ts) — it measures where
 * the reader was standing, arms that origin, pushes one entry and scrolls. So
 * one drawer selection costs one press of Back and draws one chip.
 *
 * `setNote` is queued in the same tick, and that is deliberate rather than
 * incidental: nuqs keeps pending updates in one queue and any push option
 * upgrades the combined flush to a push, so the `?note=` and the `?at=` land on
 * **one** entry. Two ticks would have made two.
 */
export function jumpToComment(
  comments: readonly AnchoredComment[],
  id: string,
  setNote: (id: string) => unknown,
  jumpTo: (blockId: BlockId) => void,
): void {
  void setNote(id);
  const passage = passageToBringIntoView(comments, id);
  if (passage !== null) jumpTo(passage);
}

/**
 * **Stepping to the next or previous question: traversal.**
 *
 * `scrollToBlock` rather than `jumpTo`, and the difference is the whole stage:
 * this writes no history entry of its own. The listener in `useReadingPosition`
 * notices the scroll and replaces `?at=`, exactly as it does for a wheel, and a
 * replace keeps whatever stamp the entry carries — so the chip goes on naming
 * the place the reader entered the traversal from.
 *
 * `null` is allowed in because `stepComment` returns it at the ends of the
 * list and the arrows hand its answer straight over.
 */
export function stepToComment(
  comments: readonly AnchoredComment[],
  id: string | null,
  setNote: (id: string) => unknown,
): void {
  if (id === null) return;
  void setNote(id);
  const passage = passageToBringIntoView(comments, id);
  if (passage !== null) scrollToBlock(passage);
}
