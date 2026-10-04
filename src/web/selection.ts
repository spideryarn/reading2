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
 * the model is opt-in (docs/plans/260828a-comments-and-bookmarks.md). The
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
 * A read, and the range it was read from.
 *
 * `range` is the **clamped** one — the words that will actually be stored — so
 * anything drawn beside a selection (TouchSelectionChip.tsx) sits beside those
 * words and not beside the end of a drag that ran on into the next paragraph.
 * Null unless the read is an anchor.
 */
export interface SelectionReadWithRange {
  read: SelectionRead;
  range: Range | null;
}

/**
 * Read the current selection.
 *
 * A selection that runs past the end of its first block is **clamped** to that
 * block rather than rejected. A comment addresses one block — that is what makes
 * it storable against the id spine (docs/project/block-ids.md) — and silently
 * doing the first paragraph is far better than appearing to ignore the drag.
 */
export function readSelection(selection: Selection | null): SelectionRead {
  return readSelectionWithRange(selection).read;
}

/** `readSelection`, and the clamped range beside it. One implementation. */
export function readSelectionWithRange(selection: Selection | null): SelectionReadWithRange {
  const none: SelectionReadWithRange = { read: NONE, range: null };
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return none;
  const range = selection.getRangeAt(0);
  const prose = proseOf(range.startContainer);
  if (!prose) return none;
  const blockId = prose.closest<HTMLElement>("tr[data-block]")?.dataset.block;
  if (!blockId) return none;

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
  if (quote.length < MIN_SELECTION_CHARS) return { read: { kind: "too-short" }, range: null };

  return {
    read: { kind: "anchor", anchor: { blockId, quote, start: rawStart + lead } },
    range: clamped,
  };
}

/** The same passage: block, offset and words. */
export function sameAnchor(a: SelectionAnchor, b: SelectionAnchor): boolean {
  return a.blockId === b.blockId && a.start === b.start && a.quote === b.quote;
}

/**
 * **Put the browser's selection back on a passage**, by its anchor.
 *
 * Painting a highlight replaces the paragraph's nodes (`annotateHtml`, set
 * through `innerHTML`), and a range whose nodes are removed collapses. Since
 * 2026-10-04 that paint happens the moment a mouse lets go, so without this the
 * reader's selection would vanish under their pointer, and a ⌘C straight after
 * selecting would copy nothing (Reader.tsx § a mouse keeps its words selected).
 *
 * The inverse of `readSelectionWithRange`, in the same offset space: the
 * concatenation of the block's text nodes. It answers whether the selection
 * now reads back as that anchor, and leaves nothing selected when it does not
 * (the block is gone, or its text is no longer what the anchor was read from).
 */
export function selectAnchor(anchor: SelectionAnchor): boolean {
  const selection = window.getSelection();
  if (!selection) return false;
  let prose: HTMLElement | null = null;
  for (const row of document.querySelectorAll<HTMLElement>("tr[data-block]")) {
    if (row.dataset.block !== anchor.blockId) continue;
    prose = row.querySelector<HTMLElement>("td.text .prose");
    break;
  }
  if (!prose) return false;
  const end = anchor.start + anchor.quote.length;
  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let seen = 0;
  let started = false;
  let ended = false;
  for (let node = walker.nextNode(); node && !ended; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    /* Strictly inside for the start, so a passage that begins at a node
       boundary starts in the node that holds its first character. */
    if (!started && anchor.start < seen + length) {
      range.setStart(node, anchor.start - seen);
      started = true;
    }
    if (started && end <= seen + length) {
      range.setEnd(node, end - seen);
      ended = true;
    }
    seen += length;
  }
  if (!started || !ended) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  const read = readSelection(selection);
  if (read.kind === "anchor" && sameAnchor(read.anchor, anchor)) return true;
  selection.removeAllRanges();
  return false;
}
