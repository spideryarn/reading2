/**
 * The gutter bookmark's idempotency key lives longer than one HTTP response.
 *
 * A POST can commit and still lose its response. In that case `useComments`
 * removes the optimistic row and the button returns, so the next press must
 * reuse the first id or Postgres has no way to recognise the retry.
 */
import { describe, expect, it } from "vitest";
import type { BlockId, Comment } from "../src/types.js";
import { makeBlockBookmarker } from "../src/web/block-bookmark.js";

const BLOCK = "spya-k3m9qt" as BlockId;
const ID = "spya-bkmark";

function stored(id: string): Comment {
  return {
    id,
    blockId: BLOCK,
    createdAt: "2026-09-12T12:00:00.000Z",
    status: "none",
  };
}

describe("the whole-paragraph bookmark press", () => {
  it("reuses its id after an ambiguous failed response", async () => {
    const sent: string[] = [];
    let replies = 0;
    const bookmark = makeBlockBookmarker(
      ({ id }) => {
        sent.push(id);
        replies++;
        return Promise.resolve(replies === 1 ? null : stored(id));
      },
      () => ID,
    );

    expect(await bookmark(BLOCK)).toBe(false);
    expect(await bookmark(BLOCK)).toBe(true);
    expect(sent).toEqual([ID, ID]);
  });

  it("coalesces two presses while the first write is still in flight", async () => {
    let release!: (comment: Comment) => void;
    const response = new Promise<Comment>((resolve) => {
      release = resolve;
    });
    const sent: string[] = [];
    const bookmark = makeBlockBookmarker(
      ({ id }) => {
        sent.push(id);
        return response;
      },
      () => ID,
    );

    const first = bookmark(BLOCK);
    const second = bookmark(BLOCK);
    expect(sent).toEqual([ID]);
    release(stored(ID));
    expect(await Promise.all([first, second])).toEqual([true, true]);
  });
});
