/**
 * **The words typed into Chat and not sent, kept while the mode is away** —
 * src/web/chat-draft.ts, plan
 * docs/plans/261004j-chat-keeps-an-unsent-question-across-a-mode-change.md.
 *
 * The store is small. What is held here is what the band, the panel and the
 * floating dialog each lean on: a cleared draft is not the same as one never
 * written, "never submitted" cannot be earned back, and one article's words
 * are not another's. What a reader sees is asked in
 * tests/chat-draft-survives-a-mode-change.test.tsx.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { chatDraftsFor, createChatDrafts, forgetChatDrafts } from "../src/web/chat-draft.js";

const A = "spya-dra001";
const B = "spya-dra002";

beforeEach(() => forgetChatDrafts());

describe("a conversation's unsent words", () => {
  it("are kept under the conversation's id, and a cleared box is not a box never typed in", () => {
    const d = createChatDrafts();
    expect(d.thread(A)).toBeUndefined();
    d.setThread(A, "half a question");
    expect(d.thread(A)).toBe("half a question");
    expect(d.thread(B)).toBeUndefined();
    /* Escape writes the empty string. It has to stay written: a handed-over
       question the reader cleared must not come back. */
    d.setThread(A, "");
    expect(d.thread(A)).toBe("");
  });

  it("go when the conversation is dropped, and so does its never-submitted mark", () => {
    const d = createChatDrafts();
    d.markFresh(A);
    d.setThread(A, "half a question");
    d.dropThread(A);
    expect(d.thread(A)).toBeUndefined();
    expect(d.isFresh(A)).toBe(false);
  });

  it("move to another conversation, leaving nothing behind", () => {
    const d = createChatDrafts();
    d.markFresh(A);
    d.setThread(A, "half a question");
    d.moveThread(A, B);
    expect(d.thread(B)).toBe("half a question");
    expect(d.thread(A)).toBeUndefined();
    expect(d.isFresh(A)).toBe(false);
  });
});

describe("never submitted", () => {
  it("is said by whoever began the conversation, not inferred from the words", () => {
    const d = createChatDrafts();
    d.setThread(A, "typed into a stored conversation");
    expect(d.isFresh(A)).toBe(false);
    d.markFresh(B);
    expect(d.isFresh(B)).toBe(true);
  });

  it("is revoked by a submission whether or not the draft changes, and cannot come back", () => {
    const d = createChatDrafts();
    d.markFresh(A);
    d.setThread(A, "typed while talking");
    d.submitted(A);
    expect(d.isFresh(A)).toBe(false);
    expect(d.thread(A), "the words are the reader's, and still unsent").toBe("typed while talking");
    d.setThread(A, "typed some more");
    d.markFresh(A);
    expect(d.isFresh(A), "a submitted conversation was called never-submitted again").toBe(false);
  });
});

describe("the other three things it holds", () => {
  it("keeps the list's box, one string", () => {
    const d = createChatDrafts();
    expect(d.list()).toBe("");
    d.setList("something new");
    expect(d.list()).toBe("something new");
  });

  it("keeps Remember's words by kind, not by conversation", () => {
    const d = createChatDrafts();
    expect(d.remember("remember")).toBe("");
    d.setRemember("remember", "what I took from it");
    d.setRemember("tutorial", "what I remember");
    expect(d.remember("remember")).toBe("what I took from it");
    expect(d.remember("tutorial")).toBe("what I remember");
    expect(d.remember("explore")).toBe("");
  });

  it("keeps where Chat was: unknown, the list, or a conversation", () => {
    const d = createChatDrafts();
    expect(d.destination(), "nothing recorded yet is not the list").toBeUndefined();
    d.setDestination(null);
    expect(d.destination()).toBeNull();
    d.setDestination(A);
    expect(d.destination()).toBe(A);
  });
});

/**
 * **Where a handed-over conversation was started from**, kept beside its
 * words (plan 261005i, F5). It is not part of
 * the words: typing does not touch it, and it follows the conversation's id.
 */
describe("a conversation's pending origin", () => {
  const CLAIM = { mode: "debate", blockId: "spya-bbbbbb", quote: "a claim" } as const;
  const OTHER = { mode: "debate", blockId: "spya-cccccc", quote: "another claim" } as const;

  it("is kept under the conversation's id, and two conversations do not share one", () => {
    const d = createChatDrafts();
    expect(d.origin(A)).toBeUndefined();
    d.setOrigin(A, CLAIM);
    d.setOrigin(B, OTHER);
    expect(d.origin(A)).toEqual(CLAIM);
    expect(d.origin(B)).toEqual(OTHER);
  });

  it("is untouched by typing, by clearing the box and by a submission", () => {
    const d = createChatDrafts();
    d.setOrigin(A, CLAIM);
    d.setThread(A, "the seed");
    d.setThread(A, "the seed, edited");
    d.setThread(A, "");
    d.submitted(A);
    expect(d.origin(A)).toEqual(CLAIM);
  });

  it("moves with the words to the conversation begun in their place", () => {
    const d = createChatDrafts();
    d.setThread(A, "the seed");
    d.setOrigin(A, CLAIM);
    d.moveThread(A, B);
    expect(d.origin(B)).toEqual(CLAIM);
    expect(d.origin(A)).toBeUndefined();
  });

  it("moves even when no words were written, and a move without one leaves the target's alone", () => {
    const d = createChatDrafts();
    d.setOrigin(A, CLAIM);
    d.moveThread(A, B);
    expect(d.origin(B)).toEqual(CLAIM);
    d.moveThread("spya-dra003", B);
    expect(d.origin(B)).toEqual(CLAIM);
  });

  it("goes when the conversation is dropped, and when its id is replaced", () => {
    const d = createChatDrafts();
    d.setOrigin(A, CLAIM);
    d.dropThread(A);
    expect(d.origin(A)).toBeUndefined();
    d.setOrigin(B, OTHER);
    d.clearOrigin(B);
    expect(d.origin(B)).toBeUndefined();
  });

  it("does not count as unsent words", () => {
    const d = createChatDrafts();
    d.setOrigin(A, CLAIM);
    expect(d.holdsWords()).toBe(false);
  });
});

describe("one store per article, for as long as the page lives", () => {
  it("hands back the same store for the same article and another for another", () => {
    const first = chatDraftsFor("a-piece");
    first.setList("for this article");
    expect(chatDraftsFor("a-piece").list()).toBe("for this article");
    expect(chatDraftsFor("another-piece").list()).toBe("");
  });

  it("can be emptied between tests", () => {
    chatDraftsFor("a-piece").setList("left over");
    forgetChatDrafts();
    expect(chatDraftsFor("a-piece").list()).toBe("");
  });
});
