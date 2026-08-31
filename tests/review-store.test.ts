/**
 * **`kind` and `stance`: who owns them, and what happens when a stale client
 * disagrees.**
 *
 * These are the two fields review mode added to a conversation, and both of
 * them are the kind of thing that goes wrong quietly:
 *
 *   - a **kind** written twice turns a review into a chat halfway through its
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
import type { ChatMessage, ChatThread, ReviewStance } from "../src/types.js";

const AT = "2026-08-27T12:00:00.000Z";

/** A thread as the store would hold it after `turns` question-and-answer pairs. */
function threadWith(kind: "chat" | "review", stances: (ReviewStance | undefined)[]): ChatThread {
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
    const { thread } = withTurn([], { threadId: "spya-newone", question: "q", kind: "review" }, AT);
    expect(thread.kind).toBe("review");
  });

  it("is a chat when no kind is offered — what every pre-review caller means", () => {
    const { thread } = withTurn([], { threadId: "spya-newone", question: "q" }, AT);
    expect(thread.kind).toBe("chat");
  });

  /* THE test. Without the guard in `withTurn`, this second turn quietly
     succeeds and every later answer in a review conversation is written with
     chat's prompt. Nothing errors and nothing on screen disagrees. */
  it("refuses a second turn that contradicts it", () => {
    const existing = [threadWith("review", ["balanced"])];
    expect(() =>
      withTurn(existing, { threadId: "spya-thread", question: "q2", kind: "chat" }, AT),
    ).toThrow(ChatConflict);
  });

  it("accepts a second turn that agrees with it, so a retried send is harmless", () => {
    const existing = [threadWith("review", ["balanced"])];
    const { thread } = withTurn(existing, { threadId: "spya-thread", question: "q2", kind: "review" }, AT);
    expect(thread.kind).toBe("review");
    expect(thread.messages).toHaveLength(4);
  });

  it("accepts a second turn that names no kind at all", () => {
    const existing = [threadWith("review", ["balanced"])];
    const { thread } = withTurn(existing, { threadId: "spya-thread", question: "q2" }, AT);
    expect(thread.kind).toBe("review");
  });

  it("survives a retry and an edit untouched", () => {
    const threads = [threadWith("review", ["socratic"])];
    expect(withRetry(threads, "spya-thread", "spya-ans0aa", AT).thread.kind).toBe("review");
    expect(withEdit(threads, "spya-thread", "spya-usr0aa", "rewritten", AT).thread.kind).toBe("review");
  });
});

describe("the stance is written on the pending row, not on the finished one", () => {
  /* An answer that crashed, errored, was stopped or was swept still has to say
     which instruction produced the words that did arrive — and a retry of it
     has to have something to inherit. Writing the stance in `finishTurn` would
     leave every one of those blank. */
  it("is on the empty assistant row the moment the turn is stored", () => {
    const { reply } = withTurn(
      [],
      { threadId: "spya-newone", question: "q", kind: "review", stance: "socratic" },
      AT,
    );
    expect(reply.status).toBe("pending");
    expect(reply.text).toBe("");
    expect(reply.stance).toBe("socratic");
  });

  it("never lands on the reader's own message", () => {
    const { user } = withTurn(
      [],
      { threadId: "spya-newone", question: "q", kind: "review", stance: "respond" },
      AT,
    );
    expect(user).not.toHaveProperty("stance");
  });

  /* Absent, never `stance: undefined`. `exactOptionalPropertyTypes` is on and
     the two stores are compared field for field by tests/store-roundtrip. */
  it("is absent rather than undefined on a chat turn", () => {
    const { reply } = withTurn([], { threadId: "spya-newone", question: "q" }, AT);
    expect(Object.hasOwn(reply, "stance")).toBe(false);
  });
});

describe("a retry re-asks the question the way it was asked", () => {
  /* Sol's finding 4. `withRetry` rebuilds its reply field by field on purpose,
     so that `citations`, `tools`, `model` and `error` from the replaced attempt
     cannot leak into the new one. The stance is the one field that MUST cross
     that line, because it is not a result of the old answer — it is the
     instruction that produced it, and "have another go at that" has to mean
     another go at the same question asked the same way. */
  it("carries the replaced answer's stance onto the new pending row", () => {
    const threads = [threadWith("review", ["socratic"])];
    const { reply } = withRetry(threads, "spya-thread", "spya-ans0aa", AT);
    expect(reply.stance).toBe("socratic");
    expect(reply.status).toBe("pending");
  });

  it("still drops everything else the old attempt had", () => {
    const threads = [threadWith("review", ["respond"])];
    const target = threads[0]!.messages[1]!;
    Object.assign(target, { model: "some/model", searches: 3, error: "old" });
    const { reply } = withRetry(threads, "spya-thread", "spya-ans0aa", AT);
    expect(reply.stance).toBe("respond");
    expect(reply).not.toHaveProperty("model");
    expect(reply).not.toHaveProperty("searches");
    expect(reply).not.toHaveProperty("error");
  });

  it("leaves a chat retry with no stance at all", () => {
    const threads = [threadWith("chat", [undefined])];
    const { reply } = withRetry(threads, "spya-thread", "spya-ans0aa", AT);
    expect(Object.hasOwn(reply, "stance")).toBe(false);
  });
});

describe("an edit inherits from the answer it replaces, not from the tail", () => {
  /* The sharper half of finding 4. Editing question 1 of a three-turn review
     discards turns 2 and 3 — which had different stances — and the reader's
     picker at that moment is seeded from turn 3's. Taking the tail's stance
     would answer a rewritten early question in the voice of a later turn that
     no longer exists. */
  it("takes the stance of the answer under the question being rewritten", () => {
    const threads = [threadWith("review", ["socratic", "respond", "signposts"])];
    const { reply, discarded } = withEdit(threads, "spya-thread", "spya-usr0aa", "rewritten", AT);
    expect(reply.stance).toBe("socratic");
    // and it really did discard the later turns whose stances differed:
    // six messages, editing the first leaves five behind it.
    expect(discarded).toBe(5);
  });

  it("does not take the stance of the last answer in the thread", () => {
    const threads = [threadWith("review", ["socratic", "respond", "signposts"])];
    const { reply } = withEdit(threads, "spya-thread", "spya-usr0aa", "rewritten", AT);
    expect(reply.stance).not.toBe("signposts");
  });

  it("editing the last question keeps that turn's own stance", () => {
    const threads = [threadWith("review", ["socratic", "respond"])];
    const { reply } = withEdit(threads, "spya-thread", "spya-usr1aa", "rewritten", AT);
    expect(reply.stance).toBe("respond");
  });

  it("leaves a chat edit with no stance", () => {
    const threads = [threadWith("chat", [undefined, undefined])];
    const { reply } = withEdit(threads, "spya-thread", "spya-usr0aa", "rewritten", AT);
    expect(Object.hasOwn(reply, "stance")).toBe(false);
  });
});
