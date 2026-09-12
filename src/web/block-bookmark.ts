/**
 * One-press whole-paragraph bookmarks, with one id across an uncertain retry.
 *
 * A failed response does not prove the POST failed: Postgres may have stored
 * the row before the connection went away. The button then returns when
 * `useComments.create` removes its optimistic row, and a second press has to
 * carry the same id for the store's idempotent create to recognise it. Greg's
 * *"just say … bookmark that block"* remains one bookmark even on that path.
 * docs/plans/260912c-gutter-bookmark-button-and-the-second-ellipsis.md.
 */
import { mintId } from "../ids.js";
import type { BlockId, Comment } from "../types.js";

type CreateBookmark = (input: { id: string; blockId: BlockId }) => Promise<Comment | null>;

interface Attempt {
  readonly id: string;
  pending?: Promise<boolean>;
}

/**
 * Build the callback handed to `BlockGutter` for one article.
 *
 * Two presses while a write is live share it. A refused or uncertain write
 * keeps its id for the next press; a confirmed write forgets it, so deleting
 * the bookmark and making a new one later gets a new identity.
 */
export function makeBlockBookmarker(
  create: CreateBookmark,
  mint: () => string = mintId,
): (blockId: BlockId) => Promise<boolean> {
  const attempts = new Map<BlockId, Attempt>();

  return (blockId) => {
    const attempt = attempts.get(blockId) ?? { id: mint() };
    attempts.set(blockId, attempt);
    if (attempt.pending) return attempt.pending;

    const pending = create({ id: attempt.id, blockId })
      .then((comment) => {
        const stored = comment !== null;
        if (stored && attempts.get(blockId) === attempt) attempts.delete(blockId);
        return stored;
      })
      .finally(() => {
        /* A confirmed write removed the whole attempt above. On failure only
           the in-flight latch goes: the id is deliberately kept for retry. */
        if (attempts.get(blockId) === attempt) delete attempt.pending;
      });
    attempt.pending = pending;
    return pending;
  };
}
