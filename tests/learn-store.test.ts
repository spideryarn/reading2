/**
 * **`kind` and `stance`: who owns them, and what happens when a stale client
 * disagrees.**
 *
 * These are the two fields Learn mode added to a conversation, and both of
 * them are the kind of thing that goes wrong quietly:
 *
 *   - a **kind** written twice turns a Learn thread into a chat halfway through its
 *     own transcript. The system prompt changes, the list tag changes, and the
 *     conversation still reads as one conversation.
 *   - a **stance** taken from the reader's current picker rather than from the
 *     answer being replaced means a button labelled "have another go" silently
 *     rewrites the instruction attached to a stored turn.
 *
 * Neither raises an error, and neither is visible on screen. Both were found by
 * GPT Sol's review of docs/plans/260827ah-review-mode.md (findings 4 and 5) before they
 * were built, which is why they are pinned here rather than in a postmortem.
 *
 * Everything tested is one of the three **pure** functions in src/chat.ts —
 * `withTurn`, `withRetry`, `withEdit` — which is deliberate: both stores call
 * them, so a rule proven here is a rule both stores keep. The Postgres store's
 * own half (the `onConflictDoUpdate` that must not name `kind`) is exercised in
 * tests/store-chat-pg.test.ts.
 */
import { describe, expect, it } from "vitest";
import { ChatConflict, withEdit, withRetry, withTurn } from "../src/chat.js";
import type { ChatMessage, ChatThread, LearnStance } from "../src/types.js";

const AT = "2026-08-27T12:00:00.000Z";

/** A thread as the store would hold it after `turns` question-and-answer pairs. */
function threadWith(kind: "chat" | "learn", stances: (LearnStance | undefined)[]): ChatThread {
  const messages: ChatMessage[] = [];
  stances.forEach((stance, i) => {
    messages.push({ id: `spya-usr${i}aa`, role: "user", text: `q${i}`, createdAt: AT, status: "done" });
    messages.push({
      id: `spya-ans${i}aa`,
      role: "assistant",
      text: `a${i}`,
      createdAt: AT,
      status: "done",
      ...(stance ? { stance } : {}),
    });
  });
  return { id: "spya-thread", title: "t", createdAt: AT, updatedAt: AT, kind, messages };
}

describe("a thread is one kind for life", () => {
  it("takes its kind from the turn that creates it", () => {
    const { thread } = withTurn([], { threadId: "spya-newone", question: "q", kind: "learn" }, AT);
    expect(thread.kind).toBe("learn");
  });

  it("is a chat when no kind is offered — what every pre-Learn caller means", () => {
    const { thread } = withTurn([], { threadId: "spya-newone", question: "q" }, AT);
    expect(thread.kind).toBe("chat");
  });

  /* THE test. Without the guard in `withTurn`, this second turn quietly
     succeeds and every later answer in a Learn conversation is written with
     chat's prompt. Nothing errors and nothing on screen disagrees. */
  it("refuses a second turn that contradicts it", () => {
    const existing = [threadWith("learn", ["balanced"])];
    expect(() =>
      withTurn(existing, { threadId: "spya-thread", question: "q2", kind: "chat" }, AT),
    ).toThrow(ChatConflict);
  });

  it("accepts a second turn that agrees with it, so a retried send is harmless", () => {
    const existing = [threadWith("learn", ["balanced"])];
    const { thread } = withTurn(existing, { threadId: "spya-thread", question: "q2", kind: "learn" }, AT);
    expect(thread.kind).toBe("learn");
    expect(thread.messages).toHaveLength(4);
  });

  it("accepts a second turn that names no kind at all", () => {
    const existing = [threadWith("learn", ["balanced"])];
    const { thread } = withTurn(existing, { threadId: "spya-thread", question: "q2" }, AT);
    expect(thread.kind).toBe("learn");
  });

  it("survives a retry and an edit untouched", () => {
    const threads = [threadWith("learn", ["socratic"])];
    expect(withRetry(threads, "spya-thread", "spya-ans0aa", AT).thread.kind).toBe("learn");
    expect(withEdit(threads, "spya-thread", "spya-usr0aa", "rewritten", AT).thread.kind).toBe("learn");
  });
});

describe("no stance is written or carried any more", () => {
  /* Recall's four stances became one voice on 2026-10-02
     (docs/plans/261002i-one-adaptive-recall-and-a-tutorial-sub-mode-for-remember.md).
     Older rows keep the stance they were written with — that is legacy data,
     covered by the fixture and round-trip tests — but nothing new writes one,
     and a retry or an edit of an old answer must not copy it forward, or the
     transcript would tag a new answer with an instruction nobody gave. */
  it("leaves the pending row of a new Learn turn without one", () => {
    const { reply, user } = withTurn([], { threadId: "spya-newone", question: "q", kind: "learn" }, AT);
    expect(reply.status).toBe("pending");
    expect(Object.hasOwn(reply, "stance")).toBe(false);
    expect(Object.hasOwn(user, "stance")).toBe(false);
  });

  it("does not carry an old answer's stance across a retry", () => {
    const threads = [threadWith("learn", ["socratic"])];
    const { reply } = withRetry(threads, "spya-thread", "spya-ans0aa", AT);
    expect(reply.status).toBe("pending");
    expect(Object.hasOwn(reply, "stance")).toBe(false);
  });

  it("still drops everything else the old attempt had", () => {
    const threads = [threadWith("learn", ["respond"])];
    const target = threads[0]!.messages[1]!;
    Object.assign(target, { model: "some/model", searches: 3, error: "old" });
    const { reply } = withRetry(threads, "spya-thread", "spya-ans0aa", AT);
    expect(reply).not.toHaveProperty("stance");
    expect(reply).not.toHaveProperty("model");
    expect(reply).not.toHaveProperty("searches");
    expect(reply).not.toHaveProperty("error");
  });

  it("does not carry an old answer's stance across an edit", () => {
    const threads = [threadWith("learn", ["socratic", "respond", "signposts"])];
    const { reply, discarded } = withEdit(threads, "spya-thread", "spya-usr0aa", "rewritten", AT);
    expect(Object.hasOwn(reply, "stance")).toBe(false);
    // six messages, editing the first leaves five behind it.
    expect(discarded).toBe(5);
  });

  /* The help flag lives on the QUESTION row and is a different rule: a retry or
     an edit of a "?" question is still an explanation. Removing the stance must
     not have taken that with it. */
  it("still carries the help flag on the question across a retry and an edit", () => {
    const { threads } = withTurn([], { threadId: "spya-helpme", question: "explain this", help: true }, AT);
    const thread = threads[0]!;
    const [question, answer] = thread.messages;
    expect(question?.help).toBe(true);
    Object.assign(answer!, { status: "done", text: "an answer" });
    const retried = withRetry(threads, thread.id, answer!.id, AT);
    expect(retried.user.help).toBe(true);
    const edited = withEdit(threads, thread.id, question!.id, "explain this better", AT);
    expect(edited.user.help).toBe(true);
  });
});
