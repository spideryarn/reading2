/**
 * A thread's anchor and its first-turn `help` flag, decided from the snapshot
 * the store's transaction reads: the sibling of
 * tests/chat-origin-transaction.test.ts, for the two rules that commit
 * 1cf578937 left in the route.
 *
 * `streamChat` checks both under `inTurnOrder`, which is a per-process `Map`.
 * A second server whose own check saw no thread reaches `pgChatStore.begin`
 * after the first has created it, and `withTurn` is the only code that sees
 * that. Each "second" call below is that request. Seventh sweep, SV3 = SVO4
 * (docs/investigations/261006d-seventh-sweep-depth-server-request-path-sol.md);
 * the class is docs/postmortems/261005h-a-per-process-origin-check-leaves-the-transaction-accepting-another-origin.md.
 *
 * Pure: no database. The same refusals through Postgres are in
 * tests/chat-anchor-route.test.ts.
 */
import { describe, expect, it } from "vitest";
import { ChatConflict, ChatTurnRefused, withTurn } from "../src/chat.js";
import { type ChatAnchor, sameAnchor } from "../src/types.js";

const ID = "spya-nch222";
const AT = "2026-10-07T10:00:00.000Z";
const BLOCK: ChatAnchor = { blockId: "spya-aaaaaa" };
const PASSAGE: ChatAnchor = { blockId: "spya-aaaaaa", quote: "a spandrel", start: 12 };

describe("anchor checked against the transaction's thread snapshot", () => {
  it.each<[string, ChatAnchor | undefined, ChatAnchor]>([
    ["another block", BLOCK, { blockId: "spya-bbbbbb" }],
    ["a passage, for a thread about the whole block", BLOCK, PASSAGE],
    ["the whole block, for a thread about a passage", PASSAGE, BLOCK],
    ["the same words at another offset", PASSAGE, { ...PASSAGE, start: 40 }],
    ["other words in the same block", PASSAGE, { ...PASSAGE, quote: "an arch" }],
    ["any anchor, for a thread that has none", undefined, BLOCK],
  ])("refuses %s", (_name, stored, wanted) => {
    const first = withTurn([], { threadId: ID, question: "first", ...(stored ? { anchor: stored } : {}) }, AT);
    expect(() => withTurn(first.threads, { threadId: ID, question: "second", anchor: wanted }, AT))
      .toThrow(ChatConflict);
    // Refused before either message was minted: the snapshot is as it was.
    expect(first.thread.messages).toHaveLength(2);
    expect(first.thread.anchor).toEqual(stored);
  });

  it.each<[string, ChatAnchor]>([
    ["a whole block", BLOCK],
    ["a passage", PASSAGE],
  ])("accepts %s resent as it was, and a follow-up with no anchor", (_name, anchor) => {
    const first = withTurn([], { threadId: ID, question: "first", anchor }, AT);
    const second = withTurn(first.threads, { threadId: ID, question: "second", anchor: { ...anchor } }, AT);
    const third = withTurn(second.threads, { threadId: ID, question: "third" }, AT);
    expect(third.thread.anchor).toEqual(anchor);
    expect(third.thread.messages).toHaveLength(6);
  });

  it("accepts a follow-up with no anchor on a thread that never had one", () => {
    const first = withTurn([], { threadId: ID, question: "first" }, AT);
    expect(withTurn(first.threads, { threadId: ID, question: "second" }, AT).thread.messages).toHaveLength(4);
  });

  it("is the predicate the route's early check uses", () => {
    // One rule, in src/types.ts beside `sameOrigin`; the route imports it.
    expect(sameAnchor(BLOCK, { ...BLOCK })).toBe(true);
    expect(sameAnchor(PASSAGE, { ...PASSAGE })).toBe(true);
    expect(sameAnchor(undefined, BLOCK)).toBe(false);
    expect(sameAnchor(BLOCK, PASSAGE)).toBe(false);
  });
});

describe("help checked against the transaction's thread snapshot", () => {
  it("is stored on the question that creates the thread", () => {
    const made = withTurn([], { threadId: ID, question: "first", anchor: BLOCK, help: true }, AT);
    expect(made.user.help).toBe(true);
    expect(made.reply.help).toBeUndefined();
  });

  it("refuses a help flag when another process has created the thread, as a 400", () => {
    const first = withTurn([], { threadId: ID, question: "first", anchor: BLOCK }, AT);
    let thrown: unknown;
    try {
      // The same anchor, so the only rule broken is the one under test.
      withTurn(first.threads, { threadId: ID, question: "second", anchor: BLOCK, help: true }, AT);
    } catch (err) {
      thrown = err;
    }
    /* Not a `ChatConflict`: that is a 409, and the route answers this rule
       with a 400 (a client sending a field it has no business sending). The
       status rides on the error, which is also what lets it through
       `guardDbStore`. */
    expect(thrown).toBeInstanceOf(ChatTurnRefused);
    expect(thrown).not.toBeInstanceOf(ChatConflict);
    expect((thrown as ChatTurnRefused).status).toBe(400);
    expect(first.thread.messages).toHaveLength(2);
  });

  it("refuses it on a thread that was itself started by a help press", () => {
    const first = withTurn([], { threadId: ID, question: "first", anchor: BLOCK, help: true }, AT);
    expect(() =>
      withTurn(first.threads, { threadId: ID, question: "second", anchor: BLOCK, help: true }, AT),
    ).toThrow(ChatTurnRefused);
  });

  it("accepts an ordinary follow-up to a help press, with no flag on it", () => {
    const first = withTurn([], { threadId: ID, question: "first", anchor: BLOCK, help: true }, AT);
    const second = withTurn(first.threads, { threadId: ID, question: "second" }, AT);
    expect(second.user.help).toBeUndefined();
    expect(second.thread.messages.map((m) => m.help ?? false)).toEqual([true, false, false, false]);
  });
});
