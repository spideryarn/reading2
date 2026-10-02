/**
 * **One Remember thread per article: a new one joins the existing one.**
 *
 * The client mints thread ids, so a stale tab, a second tab or a bookmark can
 * try to begin a second Remember thread on an article that already has one.
 * `chat_threads_one_remember` would make that a 500. The pure rules in
 * src/chat.ts decide instead:
 *
 *   - a **typed** turn is appended to the existing Remember thread, and the
 *     returned thread id is the existing one (the route's `begin` frame carries
 *     it, and the client follows it);
 *   - a **spoken** exchange targets the existing thread too, so its
 *     `expectedTailId` guard answers `ChatConflict` rather than appending under
 *     turns the live session never saw.
 *
 * The migration that folds the threads already there is
 * tests/remember-one-thread-migration.test.ts.
 * docs/plans/261001m-remember-is-its-own-single-thread.md § Design 3.
 */
import { describe, expect, it } from "vitest";

import { ChatConflict, withSpokenTurn, withTurn } from "../src/chat.js";
import type { ChatThread } from "../src/types.js";

const AT = "2026-10-01T12:00:00.000Z";
const LATER = "2026-10-01T12:05:00.000Z";

/** The article as it stands: a chat and a Remember thread, one turn each. */
function article(): ChatThread[] {
  const chat = withTurn([], { threadId: "spya-chatt2", question: "A chat question" }, AT);
  const remember = withTurn(
    chat.threads,
    { threadId: "spya-remem2", question: "What I took from it", kind: "remember" },
    AT,
  );
  return remember.threads;
}

describe("a typed Remember turn on an article that already has a Remember thread", () => {
  it("is appended to the existing thread rather than starting a second one", () => {
    const before = article();
    const { threads, thread, user, reply } = withTurn(
      before,
      { threadId: "spya-fresh2", question: "And another thing", kind: "remember" },
      LATER,
    );
    expect(thread.id).toBe("spya-remem2");
    expect(threads.filter((t) => t.kind === "remember")).toHaveLength(1);
    expect(threads).toHaveLength(before.length);
    expect(thread.messages.slice(-2)).toEqual([user, reply]);
    expect(thread.messages).toHaveLength(4);
    /* The thread keeps its own title and creation; only its clock moves. */
    expect(thread.title).toBe("What I took from it");
    expect(thread.createdAt).toBe(AT);
    expect(thread.updatedAt).toBe(LATER);
  });

  it("still behaves as before when it names the existing thread", () => {
    const { thread } = withTurn(
      article(),
      { threadId: "spya-remem2", question: "Next", kind: "remember" },
      LATER,
    );
    expect(thread.id).toBe("spya-remem2");
    expect(thread.messages).toHaveLength(4);
  });

  it("still starts a Remember thread on an article with none", () => {
    const chatOnly = withTurn([], { threadId: "spya-chatt2", question: "q" }, AT).threads;
    const { threads, thread } = withTurn(
      chatOnly,
      { threadId: "spya-fresh2", question: "First", kind: "remember" },
      LATER,
    );
    expect(thread.id).toBe("spya-fresh2");
    expect(threads).toHaveLength(2);
  });
});

describe("a chat turn is untouched by the rule", () => {
  it("starts a new chat beside the Remember thread", () => {
    const before = article();
    const { threads, thread } = withTurn(before, { threadId: "spya-fresh2", question: "q" }, LATER);
    expect(thread.id).toBe("spya-fresh2");
    expect(thread.kind).toBe("chat");
    expect(threads).toHaveLength(before.length + 1);
  });

  it("still refuses a chat turn naming the Remember thread", () => {
    expect(() =>
      withTurn(article(), { threadId: "spya-remem2", question: "q", kind: "chat" }, LATER),
    ).toThrow(ChatConflict);
  });
});

describe("a spoken Remember exchange on an article that already has a Remember thread", () => {
  it("conflicts rather than appending under turns it never saw", () => {
    expect(() =>
      withSpokenTurn(
        article(),
        {
          threadId: "spya-fresh2",
          question: "Spoken",
          answer: "Answer",
          expectedTailId: null,
          kind: "remember",
        },
        LATER,
      ),
    ).toThrow(ChatConflict);
  });

  it("appends when it names the existing thread and its tail", () => {
    const before = article();
    const tail = before.find((t) => t.kind === "remember")!.messages.at(-1)!.id;
    const { thread } = withSpokenTurn(
      before,
      { threadId: "spya-remem2", question: "S", answer: "A", expectedTailId: tail, kind: "remember" },
      LATER,
    );
    expect(thread.id).toBe("spya-remem2");
    expect(thread.messages).toHaveLength(4);
  });

  it("leaves a spoken chat exchange alone", () => {
    const { threads, thread } = withSpokenTurn(
      article(),
      { threadId: "spya-fresh2", question: "S", answer: "A", expectedTailId: null },
      LATER,
    );
    expect(thread.id).toBe("spya-fresh2");
    expect(thread.kind).toBe("chat");
    expect(threads).toHaveLength(3);
  });
});
