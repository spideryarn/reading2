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
 * Shorter than this and it is almost certainly a stray drag rather than a
 * question — and every one of these costs a model call. Two words is enough to
 * ask about a term of art ("qualia realism") and enough to stop a double-click
 * that skidded.
 */
export const MIN_SELECTION_CHARS = 8;

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
 * Read the current selection as an anchor, or null if there is nothing usable.
 *
 * A selection that runs past the end of its first block is **clamped** to that
 * block rather than rejected. A comment addresses one block — that is what makes
 * it storable against the id spine (docs/project/block-ids.md) — and silently
 * doing the first paragraph is far better than appearing to ignore the drag.
 */
export function readSelection(selection: Selection | null): SelectionAnchor | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const prose = proseOf(range.startContainer);
  if (!prose) return null;
  const blockId = prose.closest<HTMLElement>("tr[data-block]")?.dataset.block;
  if (!blockId) return null;

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
  if (quote.length < MIN_SELECTION_CHARS) return null;

  return { blockId, quote, start: rawStart + lead };
}
