/**
 * Turning a mouse selection in the verbatim column into a storable anchor.
 *
 * The offset space is the one defined in annotate.ts — the concatenation of the
 * block's text nodes — and it is measured here with `Range.toString().length`,
 * which is that concatenation by definition. Nothing in this file counts
 * characters itself, because a counter of our own is a thing that can disagree
 * with the browser.
 *
 * See docs/project/comments.md § Anchoring.
 */
import type { BlockId } from "../types.js";

export interface SelectionAnchor {
  blockId: BlockId;
  quote: string;
  start: number;
}

/**
 * The floor on a selection, and it is **as low as it can usefully go**.
 *
 * It was 8 until 2026-09-05, on the stated ground that *"every one of these
 * costs a model call"*. That reason died on 2026-08-28, when a selection
 * stopped buying anything at all — it opens a comment box, saving is free and
 * the model is a tick-box (docs/plans/260828a-comments-and-bookmarks.md). The
 * constant outlived its reason by eight days, and in the meantime it refused
 * `AI`, `GDP`, `Ryle` and `qualia` — the commonest short selection there is,
 * and the one docs/project/comments.md § The two questions a selection raises
 * calls *"almost always the second question"*: not what this sentence does,
 * but who or what that is.
 *
 * What is left at 2 is the single-character skid, which no reader means. It is
 * not 0 because `resolveMark` (annotate.ts) picks the occurrence nearest the
 * stored offset, so the shorter the quote the likelier a later edit re-anchors
 * it over the wrong words — the worst failure in the system
 * (comments.md § Anchoring). A one-character quote is that case at its purest.
 */
export const MIN_SELECTION_CHARS = 2;

/**
 * The prose element a selection sits in, or null if it isn't in one.
 *
 * Deliberately anchored on the *start* of the selection: dragging past the end
 * of a paragraph is normal, and refusing to do anything would feel broken.
 */
function proseOf(node: Node | null): HTMLElement | null {
  const el = node instanceof Element ? node : node?.parentElement ?? null;
  return el?.closest<HTMLElement>("td.text .prose") ?? null;
}

/**
 * What the reader's pointer left behind, and **"nothing usable" is two things**.
 *
 * `"none"` means there was no selection to read — a plain click, or a drag that
 * started outside the prose. The caller should carry on with whatever else a
 * mouseup means, which is how clicking a `<mark>` opens its comment.
 *
 * `"too-short"` means there *was* a drag and we refused it. The caller must
 * stop: a refused drag that falls through to the mark logic opens somebody
 * else's comment over words the reader never clicked, which is what happened
 * between 2026-08-26 and 2026-09-05 (TableView.tsx § onMouseUp).
 *
 * Collapsing the two into `null` is exactly the bug, so they are two variants
 * rather than one — docs/project/comments.md § Deliberate limits.
 */
export type SelectionRead =
  | { kind: "anchor"; anchor: SelectionAnchor }
  | { kind: "too-short" }
  | { kind: "none" };

const NONE: SelectionRead = { kind: "none" };

/**
 * Read the current selection.
 *
 * A selection that runs past the end of its first block is **clamped** to that
 * block rather than rejected. A comment addresses one block — that is what makes
 * it storable against the id spine (docs/project/block-ids.md) — and silently
 * doing the first paragraph is far better than appearing to ignore the drag.
 */
export function readSelection(selection: Selection | null): SelectionRead {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return NONE;
  const range = selection.getRangeAt(0);
  const prose = proseOf(range.startContainer);
  if (!prose) return NONE;
  const blockId = prose.closest<HTMLElement>("tr[data-block]")?.dataset.block;
  if (!blockId) return NONE;

  // Clamp to this block. `cloneRange` so we never mutate what the user sees.
  const clamped = range.cloneRange();
  if (!prose.contains(range.endContainer)) clamped.setEndAfter(prose.lastChild ?? prose);

  const before = document.createRange();
  before.selectNodeContents(prose);
  before.setEnd(clamped.startContainer, clamped.startOffset);
  const rawStart = before.toString().length;

  const raw = clamped.toString();
  const lead = raw.length - raw.trimStart().length;
  const quote = raw.trim();
  if (quote.length < MIN_SELECTION_CHARS) return { kind: "too-short" };

  return { kind: "anchor", anchor: { blockId, quote, start: rawStart + lead } };
}
