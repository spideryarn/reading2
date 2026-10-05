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

  /* Plan 261005k, A: both shapes say `mode: "debate"`, so comparing modes is
     not enough, and neither is comparing a block and a quote the lens lacks. */
  const LENS: ThreadOrigin = { mode: "debate", lens: "how it relates to Smith 2019" };

  it.each<[string, ThreadOrigin, ThreadOrigin]>([
    ["a lens for a thread another process started from a claim", CLAIM, LENS],
    ["a claim for a thread another process started from a lens", LENS, CLAIM],
    ["a different lens", LENS, { mode: "debate", lens: "replication attempts" }],
    ["a lens whose words are the claim's", CLAIM, { mode: "debate", lens: "RNA can transfer a memory" }],
  ])("refuses %s", (_name, stored, wanted) => {
    const first = withTurn([], { threadId: ID, question: "first", origin: stored }, AT);
    expect(() => withTurn(first.threads, { threadId: ID, question: "second", origin: wanted }, AT))
      .toThrow(ChatConflict);
  });

  it("accepts the identical lens resent, and keeps it through a follow-up without one", () => {
    const first = withTurn([], { threadId: ID, question: "first", origin: LENS }, AT);
    const second = withTurn(first.threads, { threadId: ID, question: "second", origin: { ...LENS } }, AT);
    const third = withTurn(second.threads, { threadId: ID, question: "third" }, AT);
    expect(third.thread.origin).toEqual(LENS);
  });
});
