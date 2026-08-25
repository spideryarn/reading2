/**
 * Putting comments in reading order, and stepping between them.
 *
 * Pure, so it can be tested without a DOM — the same split as layout.ts and
 * position.ts. See docs/project/comments.md § Several at once.
 *
 * > [!WARNING]
 * > Document order comes from the **index in `blocks.json`**, never from the id
 * > string. Ids are random (docs/project/block-ids.md#why-random-and-not-sequential),
 * > so sorting comments by `blockId` compiles, runs, returns a plausible order,
 * > and is meaningless. That is the one way to get this silently wrong.
 */
import type { BlockId, Comment } from "../types.js";

/**
 * Comments in the order the reader meets them coming down the page.
 *
 * Reading order rather than the order they were asked in, because the panel is
 * a way of moving through the article: pressing "next" three times should walk
 * you *down* the piece, not replay your own afternoon. Ties inside a block are
 * broken by offset, then by `createdAt`, so the sequence is stable across
 * renders and two comments on the same words never swap places.
 *
 * A comment whose block is gone — the article was re-extracted and that
 * paragraph did not survive — sorts to the end rather than being dropped. It is
 * still the reader's question, and it can still be read and deleted.
 */
export function orderComments(comments: Comment[], blocks: { id: BlockId }[]): Comment[] {
  const index = new Map(blocks.map((b, i) => [b.id, i]));
  const rank = (c: Comment) => index.get(c.blockId) ?? Number.POSITIVE_INFINITY;
  return [...comments].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.start - b.start ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * The comment `delta` steps away from `currentId`, or null if there is none.
 *
 * Stops at the ends rather than wrapping. Wrapping would make the two arrows
 * always live, which reads as "there is more this way" when there isn't — and
 * from the last comment it would fling the reader back to the top of the
 * article, which is a big move to get from a small button.
 */
export function stepComment(
  ordered: Comment[],
  currentId: string | null,
  delta: number,
): string | null {
  const at = ordered.findIndex((c) => c.id === currentId);
  if (at === -1) return null;
  return ordered[at + delta]?.id ?? null;
}

/** Where the open comment sits, 1-based, for the "3 / 5" counter. */
export function positionOf(ordered: Comment[], currentId: string | null): number {
  return ordered.findIndex((c) => c.id === currentId) + 1;
}
