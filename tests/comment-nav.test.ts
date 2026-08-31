/**
 * Putting comments in reading order and stepping between them —
 * src/web/comment-nav.ts. See docs/project/comments.md § Several at once.
 *
 * Pure, so no DOM: the same split as tests/layout.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { Comment } from "../src/types.js";
import { commentsByBlock, orderComments, positionOf, stepComment } from "../src/web/comment-nav.js";

/** Document order is the array order, exactly as in blocks.json. */
const blocks = [
  { id: "spya-aaaaaa" },
  { id: "spya-bbbbbb" },
  { id: "spya-cccccc" },
];

function comment(id: string, blockId: string, start: number, createdAt = "2026-08-25T09:00:00Z"): Comment {
  return { id, blockId, start, quote: "q", createdAt, status: "done" };
}

describe("orderComments", () => {
  it("orders by position in the article, not by when they were asked", () => {
    // The panel's arrows walk you down the piece; replaying the reader's own
    // afternoon would be a different, less useful thing.
    const late = comment("spya-zzzzzz", "spya-aaaaaa", 0, "2026-08-25T12:00:00Z");
    const early = comment("spya-yyyyyy", "spya-cccccc", 0, "2026-08-25T09:00:00Z");
    expect(orderComments([early, late], blocks).map((c) => c.id)).toEqual([
      "spya-zzzzzz",
      "spya-yyyyyy",
    ]);
  });

  it("uses the block INDEX, never the id string", () => {
    // Ids are random (block-ids.md), so a string sort is meaningless. Here the
    // alphabetically-later id sits in the earlier block, and document order
    // must win. This is the assertion that would catch `a.blockId < b.blockId`.
    const first = comment("spya-000001", "spya-zzzzzz", 0);
    const second = comment("spya-000002", "spya-aaaaaa", 0);
    const shuffled = [{ id: "spya-zzzzzz" }, { id: "spya-aaaaaa" }];
    expect(orderComments([second, first], shuffled).map((c) => c.id)).toEqual([
      "spya-000001",
      "spya-000002",
    ]);
  });

  it("breaks ties inside a block by offset", () => {
    const late = comment("spya-bbbbb2", "spya-bbbbbb", 90);
    const early = comment("spya-bbbbb1", "spya-bbbbbb", 10);
    expect(orderComments([late, early], blocks).map((c) => c.start)).toEqual([10, 90]);
  });

  it("is stable for two comments on the very same words", () => {
    // Same block, same offset: without the createdAt tiebreak these could swap
    // between renders, and the "3 / 5" counter would flicker.
    const a = comment("spya-aaaaa1", "spya-bbbbbb", 10, "2026-08-25T09:00:00Z");
    const b = comment("spya-aaaaa2", "spya-bbbbbb", 10, "2026-08-25T10:00:00Z");
    expect(orderComments([b, a], blocks).map((c) => c.id)).toEqual(["spya-aaaaa1", "spya-aaaaa2"]);
    expect(orderComments([a, b], blocks).map((c) => c.id)).toEqual(["spya-aaaaa1", "spya-aaaaa2"]);
  });

  it("keeps a comment whose block is gone, at the end", () => {
    // The article was re-extracted and that paragraph didn't survive. It is
    // still the reader's question — readable and deletable, just last.
    const orphan = comment("spya-000009", "spya-vanish", 0);
    const normal = comment("spya-000001", "spya-cccccc", 0);
    expect(orderComments([orphan, normal], blocks).map((c) => c.id)).toEqual([
      "spya-000001",
      "spya-000009",
    ]);
  });

  it("does not mutate the array it was given", () => {
    const list = [comment("spya-000002", "spya-cccccc", 0), comment("spya-000001", "spya-aaaaaa", 0)];
    orderComments(list, blocks);
    expect(list.map((c) => c.id)).toEqual(["spya-000002", "spya-000001"]);
  });
});

describe("stepComment", () => {
  const ordered = orderComments(
    [
      comment("spya-000001", "spya-aaaaaa", 0),
      comment("spya-000002", "spya-bbbbbb", 0),
      comment("spya-000003", "spya-cccccc", 0),
    ],
    blocks,
  );

  it("steps down and up the article", () => {
    expect(stepComment(ordered, "spya-000002", 1)).toBe("spya-000003");
    expect(stepComment(ordered, "spya-000002", -1)).toBe("spya-000001");
  });

  it("stops at both ends rather than wrapping", () => {
    // Wrapping from the last comment would fling the reader to the top of the
    // article — a big move to get from a small button.
    expect(stepComment(ordered, "spya-000003", 1)).toBeNull();
    expect(stepComment(ordered, "spya-000001", -1)).toBeNull();
  });

  it("returns null when nothing is open, or the open one is gone", () => {
    expect(stepComment(ordered, null, 1)).toBeNull();
    expect(stepComment(ordered, "spya-000099", 1)).toBeNull();
  });

  it("→ then ← is a round trip", () => {
    const there = stepComment(ordered, "spya-000001", 1);
    expect(stepComment(ordered, there, -1)).toBe("spya-000001");
  });
});

describe("positionOf", () => {
  const ordered = orderComments(
    [comment("spya-000001", "spya-aaaaaa", 0), comment("spya-000002", "spya-cccccc", 0)],
    blocks,
  );

  it("is 1-based, to match the '2 / 2' the reader sees", () => {
    expect(positionOf(ordered, "spya-000001")).toBe(1);
    expect(positionOf(ordered, "spya-000002")).toBe(2);
  });

  it("is 0 when nothing is open", () => {
    expect(positionOf(ordered, null)).toBe(0);
  });
});

describe("commentsByBlock", () => {
  it("groups by block, in reading order inside each one", () => {
    // The gutter marker opens the FIRST comment on the block, so "first" has to
    // be the same on every render. Offsets decide it, not the array order.
    const later = comment("spya-000001", "spya-bbbbbb", 40);
    const earlier = comment("spya-000002", "spya-bbbbbb", 5);
    const grouped = commentsByBlock([later, earlier], blocks);
    expect(grouped.get("spya-bbbbbb")?.map((c) => c.id)).toEqual([
      "spya-000002",
      "spya-000001",
    ]);
  });

  it("keeps a comment whose quote is gone, because the block id is what it is keyed on", () => {
    // The orphan: the article was re-extracted and these words are no longer in
    // the paragraph, so `resolveMark` draws nothing in the prose. It is still
    // the reader's mark, and the gutter is now the only place it shows.
    const orphan = comment("spya-000003", "spya-cccccc", 999);
    expect(commentsByBlock([orphan], blocks).get("spya-cccccc")).toHaveLength(1);
  });

  it("leaves a block with no comments absent rather than holding an empty list", () => {
    const grouped = commentsByBlock([comment("spya-000004", "spya-aaaaaa", 0)], blocks);
    expect(grouped.get("spya-bbbbbb")).toBeUndefined();
    expect(grouped.size).toBe(1);
  });

  it("keeps a comment on a block that is gone entirely", () => {
    // `orderComments` sorts an unresolvable block to the end rather than
    // dropping it; the grouping must not quietly re-introduce the drop.
    const lost = comment("spya-000005", "spya-nowhere", 0);
    expect(commentsByBlock([lost], blocks).get("spya-nowhere")).toHaveLength(1);
  });
});
