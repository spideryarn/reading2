/**
 * **The "?" press is recorded on the reader's own message row, and it survives
 * a retry.**
 *
 * Report 1R asked for *"simple type-metadata"* on the thing the "?" makes, so
 * that "how many explanations were asked for" is a query rather than a guess.
 * The first design put a `from_help` flag on `chat_threads`; GPT Sol's review
 * of docs/plans/260905c-gutter-comment-chip-explanation-metadata-and-prompt.md
 * (F-01, P1) moved it to `chat_messages.help`, for a reason the thread design
 * could not answer:
 *
 * > Retrying the first help answer would therefore lose the pedagogical
 * > instruction and become an ordinary chat answer. That is user-visible wrong
 * > behaviour.
 *
 * A thread-level flag has to be *refused* on retry and edit, because neither of
 * those turns creates a thread — and a refused flag means the reader presses
 * "Try again" on an explanation and is silently answered with the ordinary
 * prompt. On the message row there is nothing to refuse: `withRetry` hands back
 * the stored question, `withEdit` spreads it, and the route reads `help` off
 * storage exactly as it already reads `kind` off the thread and `stance` off
 * the pending reply.
 *
 * Everything here is pure — no store, no clock, no model. The wire half is
 * tests/chat-help-reaches-the-server.test.tsx and the prompt half is
 * tests/help-prompt.test.ts.
 */
import { describe, expect, it } from "vitest";
import { withEdit, withRetry, withTurn } from "../src/chat.js";
import type { ChatThread } from "../src/types.js";

const AT = "2026-09-05T10:00:00.000Z";
const LATER = "2026-09-05T10:05:00.000Z";

const empty: ChatThread[] = [];

/** A help press: the "?" beside a paragraph, which sends one question. */
const helpTurn = {
  threadId: "spya-aaaaaa",
  question: "About block spya-k3m9qt: I could not follow this.",
  anchor: { blockId: "spya-k3m9qt" },
  help: true as const,
};

describe("withTurn marks the message the reader sent", () => {
  it("writes help onto the user row", () => {
    const { user } = withTurn(empty, helpTurn, AT);
    expect(
      user.help,
      "The '?' press has to land on the row that carries the reader's request, " +
        "or a retry of it cannot know what kind of turn it was.",
    ).toBe(true);
  });

  it("does NOT write it onto the pending answer", () => {
    const { reply } = withTurn(empty, helpTurn, AT);
    /* `help` is a fact about what the reader asked for, not about the answer —
       the mirror image of `stance`, which is written onto the reply and never
       onto the question. Two flags, opposite rows, and each would be invisible
       on the other. */
    expect(reply).not.toHaveProperty("help");
  });

  it("leaves the key off entirely on an ordinary question", () => {
    const { user, reply } = withTurn(
      empty,
      { threadId: "spya-aaaaaa", question: "why?" },
      AT,
    );
    /* Absent, never `help: undefined`. `exactOptionalPropertyTypes` is on and
       tests/store-roundtrip.test.ts compares the two stores field for field,
       where an explicit undefined and a missing key are not the same thing. */
    expect(user).not.toHaveProperty("help");
    expect(reply).not.toHaveProperty("help");
  });

  it("does not put it on the thread, where a retry could not reach it", () => {
    const { thread } = withTurn(empty, helpTurn, AT);
    expect(thread).not.toHaveProperty("help");
    /* Still an ordinary anchored chat — a fourth `ThreadKind` was refused, and
       that refusal is what keeps every mark the reading view draws a chat.
       docs/plans/260904b-gutter-help-button-and-detached-streaming-chat.md. */
    expect(thread.kind).toBe("chat");
  });
});

describe("a retry of a help question is still a help question", () => {
  it("hands back the stored user row with its flag intact", () => {
    const begun = withTurn(empty, helpTurn, AT);
    /* The pending answer has to be finished before it can be retried — the
       route settles the live stream first, and `withRetry` refuses a `pending`
       row outright. */
    const answered = begun.threads.map((t) => ({
      ...t,
      messages: t.messages.map((m) =>
        m.role === "assistant" ? { ...m, status: "done" as const, text: "Here is why." } : m,
      ),
    }));
    const { user } = withRetry(answered, "spya-aaaaaa", begun.reply.id, LATER);
    expect(
      user.help,
      "Pressing 'Try again' on an explanation must be answered as an explanation. " +
        "The route derives `help` from this row, never from the request body.",
    ).toBe(true);
  });
});

describe("an edit of a help question is still a help question", () => {
  it("carries the flag onto the rewritten row", () => {
    const begun = withTurn(empty, helpTurn, AT);
    const { user } = withEdit(
      begun.threads,
      "spya-aaaaaa",
      begun.user.id,
      "About block spya-k3m9qt: I still could not follow this.",
      LATER,
    );
    expect(user.help).toBe(true);
    expect(user.editedAt).toBe(LATER);
  });
});
