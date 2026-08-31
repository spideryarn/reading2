/**
 * **Appending a spoken exchange, and the guard that is also the idempotency.**
 *
 * `withSpokenTurn` is live conversation's counterpart to `withTurn`: both
 * halves of the exchange are already known, so there is nothing pending in
 * between and nothing for a second call to finish.
 *
 * The interesting property is `expectedTailId`. It is required rather than
 * optional — unlike `edit`'s version of the same guard — because here it is not
 * a safety net over a destructive operation, it is the **only** thing standing
 * between a replayed request and a duplicated turn. There is deliberately no
 * exchange-id column: a POST retried after succeeding presents a tail the first
 * one has already moved, so it conflicts instead of appending twice. That is the
 * test below called "a replayed append conflicts rather than duplicating", and
 * it is the reason the simpler design is also the safer one.
 *
 * The rows themselves are ordinary. A spoken turn is a turn — same renderer,
 * same retry path, same prompt builder — which is the whole point of putting it
 * in the same thread. docs/plans/260831l-live-conversation-in-chat.md.
 */
import { describe, expect, it } from "vitest";

import { ChatConflict, withSpokenTurn } from "../src/chat.js";
import type { ChatThread } from "../src/types.js";

const AT = "2026-08-31T12:00:00.000Z";

const spoken = (over: Partial<Parameters<typeof withSpokenTurn>[1]> = {}) => ({
  threadId: "spya-thread",
  question: "Why does he reject it?",
  answer: "Because the rainstorm does not compute.",
  expectedTailId: null,
  ...over,
});

/** A thread with one finished turn in it. */
function existing(): ChatThread[] {
  const fresh = withSpokenTurn([], spoken(), AT);
  return fresh.threads;
}

describe("appending into an empty thread", () => {
  it("creates the thread and writes both rows as done", () => {
    const { thread, user, reply } = withSpokenTurn([], spoken(), AT);
    expect(thread.messages).toHaveLength(2);
    expect(user).toMatchObject({ role: "user", status: "done", text: "Why does he reject it?" });
    expect(reply).toMatchObject({
      role: "assistant",
      status: "done",
      text: "Because the rainstorm does not compute.",
    });
  });

  it("titles the thread from the first thing said", () => {
    expect(withSpokenTurn([], spoken(), AT).thread.title).toBe("Why does he reject it?");
  });

  it("leaves the default title when the transcription failed", () => {
    /* An empty question is a real state — the transcriber can fail — and
       titling the conversation with the empty string would put a nameless row
       in the reader's list. */
    const { thread } = withSpokenTurn([], spoken({ question: "" }), AT);
    expect(thread.title).toBe("New chat");
  });

  it("is always a chat thread, never a review", () => {
    /* A spoken review is a mode nobody has designed. Passing a kind through
       would be deciding it by accident. */
    expect(withSpokenTurn([], spoken(), AT).thread.kind).toBe("chat");
  });

  it("carries passages, tools and interrupted only when there is something to say", () => {
    const bare = withSpokenTurn([], spoken(), AT).reply;
    /* Absent, never `undefined` — the two stores are compared field for field
       and an explicit undefined is not an absent key. */
    expect(bare).not.toHaveProperty("passages");
    expect(bare).not.toHaveProperty("tools");
    expect(bare).not.toHaveProperty("interrupted");

    const full = withSpokenTurn(
      [],
      spoken({
        passages: [{ blockIds: ["spya-aaa111"], why: "the rainstorm" }],
        /* `status: "done"` because a stored run is finished by definition — the
           panel's `running` is never written. */
        tools: [
          { name: "search_article_words", label: "searched", detail: "9 passages", status: "done" as const },
        ],
        interrupted: true,
      }),
      AT,
    ).reply;
    expect(full.passages).toHaveLength(1);
    expect(full.tools).toHaveLength(1);
    expect(full.interrupted).toBe(true);
  });

  it("does not write an empty passages array as a present key", () => {
    const reply = withSpokenTurn([], spoken({ passages: [], tools: [] }), AT).reply;
    expect(reply).not.toHaveProperty("passages");
    expect(reply).not.toHaveProperty("tools");
  });
});

describe("the expected tail", () => {
  it("appends when the caller's belief is right", () => {
    const threads = existing();
    const tail = threads[0]!.messages.at(-1)!.id;
    const out = withSpokenTurn(threads, spoken({ expectedTailId: tail }), AT);
    expect(out.thread.messages).toHaveLength(4);
  });

  it("refuses when the conversation has moved on", () => {
    /* A live session that started before somebody typed a turn — or edited one
       away — must not append behind their back. */
    expect(() => withSpokenTurn(existing(), spoken({ expectedTailId: "spya-zzzzzz" }), AT)).toThrow(
      ChatConflict,
    );
  });

  it("refuses null against a thread that already has messages", () => {
    /* "I think this thread is empty" is a claim, and it can be wrong. */
    expect(() => withSpokenTurn(existing(), spoken({ expectedTailId: null }), AT)).toThrow(
      ChatConflict,
    );
  });

  /**
   * **The idempotency, and the reason there is no exchange-id column.**
   *
   * A request replayed after it succeeded — a dropped connection, a retry —
   * presents the tail it saw before, which the first attempt has since moved.
   * So the second one conflicts instead of writing the turn twice.
   */
  it("makes a replayed append conflict rather than duplicating", () => {
    const threads = existing();
    const tail = threads[0]!.messages.at(-1)!.id;
    const first = withSpokenTurn(threads, spoken({ expectedTailId: tail }), AT);
    expect(first.thread.messages).toHaveLength(4);
    /* The same request again, with the same stale belief about the tail. */
    expect(() => withSpokenTurn(first.threads, spoken({ expectedTailId: tail }), AT)).toThrow(
      ChatConflict,
    );
  });

  it("orders two different exchanges rather than interleaving them", () => {
    /* Both sessions saw the same tail. The loser is told to look again, which
       is correct: they have to go in some order and the store appends. */
    const threads = existing();
    const tail = threads[0]!.messages.at(-1)!.id;
    const a = withSpokenTurn(threads, spoken({ expectedTailId: tail, question: "A" }), AT);
    expect(() =>
      withSpokenTurn(a.threads, spoken({ expectedTailId: tail, question: "B" }), AT),
    ).toThrow(ChatConflict);
  });
});

describe("ids", () => {
  it("never reuses an id already in the article", () => {
    const threads = existing();
    const tail = threads[0]!.messages.at(-1)!.id;
    const out = withSpokenTurn(threads, spoken({ expectedTailId: tail }), AT);
    const ids = out.thread.messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("refuses to hand a caller's thread id to an existing thread", () => {
    /* Same rule `withTurn` follows: an id is honoured only if it is one of ours
       and free, so a duplicate request cannot append to a stranger's thread. */
    const out = withSpokenTurn([], spoken({ threadId: "not-one-of-ours" }), AT);
    expect(out.thread.id).toMatch(/^spya-/);
  });
});
