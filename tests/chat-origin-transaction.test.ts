import { describe, expect, it } from "vitest";
import { ChatConflict, withTurn } from "../src/chat.js";
import type { ThreadOrigin } from "../src/types.js";

const ID = "spya-rgn222";
const AT = "2026-10-05T10:00:00.000Z";
const CLAIM: ThreadOrigin = { mode: "debate", blockId: "spya-bbbbbb", quote: "RNA can transfer a memory" };

describe("origin checked against the transaction's thread snapshot", () => {
  it.each([undefined, { ...CLAIM, quote: "A different claim" }])(
    "refuses an origin when another process created the thread with %j",
    (origin) => {
      // Both routes saw no thread. The second transaction sees the first one's insert.
      const first = withTurn([], { threadId: ID, question: "first", ...(origin ? { origin } : {}) }, AT);
      expect(() => withTurn(first.threads, { threadId: ID, question: "second", origin: CLAIM }, AT))
        .toThrow(ChatConflict);
      expect(first.thread.messages).toHaveLength(2);
    },
  );

  it("accepts the identical origin resent, and a follow-up without an origin", () => {
    const first = withTurn([], { threadId: ID, question: "first", origin: CLAIM }, AT);
    const second = withTurn(first.threads, { threadId: ID, question: "second", origin: { ...CLAIM } }, AT);
    const third = withTurn(second.threads, { threadId: ID, question: "third" }, AT);
    expect(third.thread.origin).toEqual(CLAIM);
    expect(third.thread.messages).toHaveLength(6);
  });
});
