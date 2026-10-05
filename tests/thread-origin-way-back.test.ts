/**
 * **The way back from an item to the chat started from it is derived**, from
 * the thread summaries the reading view already holds, and never stored on
 * the item's side (plan 261005i, D2). And where a row in Chat's list came
 * from is one pure function (D5).
 *
 * Also held here: a conversation started from a claim is **not** the chat of
 * the block the claim sits in. It has no anchor, so the prose marks, the
 * gutter chip's count and both "reopen" lookups pass it by; this keeps it so.
 */
import { describe, expect, it } from "vitest";

import type { ThreadOrigin, ThreadSummary } from "../src/types.js";
import { threadSource } from "../src/web/thread-source.js";
import {
  anchored,
  countByBlock,
  helpThreadFor,
  threadFor,
  threadForOrigin,
} from "../src/web/useChatAnchors.js";

const BLOCK = "spya-bbbbbb";
const CLAIM: ThreadOrigin = { mode: "debate", blockId: BLOCK, quote: "RNA can transfer a memory" };

function summary(over: Partial<ThreadSummary> & { id: string }): ThreadSummary {
  return {
    title: "Check this claim",
    createdAt: "2026-10-05T10:00:00.000Z",
    updatedAt: "2026-10-05T10:00:00.000Z",
    kind: "chat",
    turns: 1,
    ...over,
  };
}

describe("threadForOrigin", () => {
  it("finds the conversation started from this claim", () => {
    const list = [summary({ id: "spya-aaa222" }), summary({ id: "spya-aaa333", origin: CLAIM })];
    expect(threadForOrigin(list, CLAIM)?.id).toBe("spya-aaa333");
  });

  it("finds nothing once the claim's words have changed, or for the same words in another block", () => {
    const list = [summary({ id: "spya-aaa333", origin: CLAIM })];
    expect(threadForOrigin(list, { ...CLAIM, quote: "RNA can transfer memories" })).toBeUndefined();
    expect(threadForOrigin(list, { ...CLAIM, blockId: "spya-cccccc" })).toBeUndefined();
  });

  it("takes the newest of two, by when each was last touched", () => {
    const list = [
      summary({ id: "spya-aaa333", origin: CLAIM, updatedAt: "2026-10-05T12:00:00.000Z" }),
      summary({ id: "spya-aaa444", origin: CLAIM, updatedAt: "2026-10-05T11:00:00.000Z" }),
    ];
    expect(threadForOrigin(list, CLAIM)?.id).toBe("spya-aaa333");
    expect(threadForOrigin([...list].reverse(), CLAIM)?.id).toBe("spya-aaa333");
  });

  it("finds nothing in an empty list, and ignores a thread that is not a chat", () => {
    expect(threadForOrigin([], CLAIM)).toBeUndefined();
    /* The database refuses this row; the positive test is `threadFor`'s too. */
    expect(threadForOrigin([summary({ id: "spya-aaa333", origin: CLAIM, kind: "explore" })], CLAIM)).toBeUndefined();
  });
});

describe("a conversation started from a claim is not its block's chat", () => {
  const list = [summary({ id: "spya-aaa333", origin: CLAIM })];

  it("is not what the gutter chip or the ? reopens", () => {
    expect(threadFor(list, BLOCK)).toBeUndefined();
    expect(helpThreadFor(list, BLOCK)).toBeUndefined();
  });

  it("draws no mark in the prose and adds nothing to the block's count", () => {
    expect(anchored(list)).toEqual([]);
    expect(countByBlock(list).get(BLOCK)).toBeUndefined();
  });
});

describe("threadSource", () => {
  it("says a conversation with a stored origin was started from a claim in Debate, with the claim's words", () => {
    expect(threadSource({ origin: CLAIM })).toEqual({
      mode: "debate",
      label: "Started from a claim in Debate",
      quote: "RNA can transfer a memory",
    });
  });

  it("says nothing for a conversation with no stored origin", () => {
    expect(threadSource({})).toBeNull();
  });
});
