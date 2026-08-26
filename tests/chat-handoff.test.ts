/**
 * The question handed from the explanation dialog to chat mode —
 * src/web/chat-handoff.ts. See docs/project/comments.md#pushing-back.
 *
 * Every rule here exists because of a way a module-level cell goes wrong
 * *silently*: nothing throws, nothing renders red, the question simply does
 * something other than what the reader meant. That is why they are pinned
 * rather than left to the comments — a comment cannot fail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HANDOFF_TTL_MS,
  askAboutQuote,
  clearHandoff,
  handOffToChat,
  takeHandoff,
} from "../src/web/chat-handoff.js";

beforeEach(() => {
  clearHandoff();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("taking a handed-off question", () => {
  it("gives it to the first caller and nobody else", () => {
    /* React StrictMode double-invokes effects at mount. A cell that did not
       clear as it read would send the reader's question twice, spend two model
       calls, and open two conversations — of which they would see one. */
    handOffToChat("writes", "who is he?", null);
    expect(takeHandoff("writes")).toEqual({ question: "who is he?", at: null });
    expect(takeHandoff("writes")).toBeNull();
  });

  it("carries the reading position, so 'here' means where they were", () => {
    handOffToChat("writes", "who is he?", "spya-zz20s6");
    expect(takeHandoff("writes")?.at).toBe("spya-zz20s6");
  });
});

describe("it belongs to one article", () => {
  it("refuses to answer a different article's chat", () => {
    /* Set it on A, navigate to B, open chat: without the slug check, A's
       question arrives in B's conversation with A's quote attached to it, and
       the model answers about a passage that is not in the article it was
       given. Nothing about that looks like an error. */
    handOffToChat("writes", "who is he?", null);
    expect(takeHandoff("noema-mythology-of-conscious-ai")).toBeNull();
  });

  it("and is still there for the article it was meant for", () => {
    // Refusing must not consume it — the reader may yet go back.
    handOffToChat("writes", "who is he?", null);
    takeHandoff("something-else");
    expect(takeHandoff("writes")).not.toBeNull();
  });
});

describe("it expires", () => {
  it("is dropped once it is stale", () => {
    /* The reader types a question, presses Escape, and goes to the glossary
       instead. Without this the cell sits there for the life of the tab and
       fires days later, the next time they open chat — asking something they
       typed in another sitting and have forgotten. */
    handOffToChat("writes", "who is he?", null);
    vi.advanceTimersByTime(HANDOFF_TTL_MS + 1);
    expect(takeHandoff("writes")).toBeNull();
  });

  it("survives the mode switch and the chat fetch, which is what it is for", () => {
    handOffToChat("writes", "who is he?", null);
    vi.advanceTimersByTime(HANDOFF_TTL_MS - 1);
    expect(takeHandoff("writes")).not.toBeNull();
  });

  it("clears a stale one rather than leaving it to be found later", () => {
    handOffToChat("writes", "who is he?", null);
    vi.advanceTimersByTime(HANDOFF_TTL_MS + 1);
    takeHandoff("writes");
    // Not just refused — gone. A cell that refuses without clearing would hand
    // the same stale question to the next caller inside the same millisecond.
    vi.setSystemTime(0);
    expect(takeHandoff("writes")).toBeNull();
  });
});

describe("what actually gets asked", () => {
  it("puts the passage in, because the question does not stand up without it", () => {
    // Chat is given the whole article, but "what did he mean by that?" resolves
    // to nothing without the sentence in front of it.
    const asked = askAboutQuote("Ben Miller", "who is he?");
    expect(asked).toContain("Ben Miller");
    expect(asked).toContain("who is he?");
  });

  it("trims, so a selection's stray whitespace does not reach the transcript", () => {
    expect(askAboutQuote("  Ben Miller\n", "  who is he?  ")).toBe(
      'About this passage:\n\n"Ben Miller"\n\nwho is he?',
    );
  });
});
