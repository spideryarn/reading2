// @vitest-environment jsdom
/**
 * **The bin beside a question, as the reader meets it** (report spya-mx423m).
 *
 * On every question but the first; one press arms it and says how much will
 * go, the second deletes; absent while an answer is arriving and wherever the
 * caller offers none (an unsettled conversation — `onDeleteFrom` in
 * ChatPanel.tsx). What the press then does is tests/chat-prune-reduce.test.ts.
 * docs/plans/261009m-delete-a-chat-question-and-what-follows.md
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatThread } from "../src/types.js";

const { ChatPanel } = await import("../src/web/ChatPanel.js");

const AT = "2026-10-09T10:00:00.000Z";

function turn(n: number, answer: Partial<ChatMessage> = {}): ChatMessage[] {
  return [
    { id: `spya-q${n}`, role: "user", text: "Where should I start?", createdAt: AT, status: "done" },
    { id: `spya-a${n}`, role: "assistant", text: "§ 3.", createdAt: AT, status: "done", ...answer },
  ];
}

function thread(messages: ChatMessage[]): ChatThread {
  return { id: "spya-k3m9qt", title: "Where should I start?", createdAt: AT, updatedAt: AT, kind: "guide", messages };
}

let host: HTMLDivElement;
let root: Root;
const deleted: string[] = [];

function paint(t: ChatThread, offered = true) {
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        kind: "chat",
        loaded: true,
        loadFailed: false,
        threads: [{ ...t, kind: "chat" }],
        threadId: t.id,
        onThread: () => {},
        onSend: () => {},
        onNew: () => {},
        onSendNew: () => {},
        onDiscard: () => {},
        onRename: () => {},
        onDelete: () => {},
        canStartOver: true,
        onRetry: () => {},
        onEdit: () => {},
        onDeleteFrom: offered ? (messageId: string) => void deleted.push(messageId) : undefined,
        onStop: () => {},
        onJump: () => {},
        recovering: new Set<string>(),
        blocks: new Map<string, string>(),
        focusNonce: 0,
        error: null,
      }),
    );
  });
}

const bins = () =>
  [...host.querySelectorAll<HTMLButtonElement>('.chat-turn.you button[title^="Delete this question"]')];
const press = (el: Element | undefined) => {
  if (!el) throw new Error("nothing to press");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
};

beforeEach(() => {
  deleted.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  vi.useRealTimers();
  act(() => root.unmount());
  host.remove();
});

describe("the bin beside a question", () => {
  it("is on every question but the first", () => {
    paint(thread([...turn(1), ...turn(2), ...turn(3)]));
    expect(host.querySelectorAll(".chat-turn.you")).toHaveLength(3);
    expect(bins()).toHaveLength(2);
    expect(host.querySelector('.chat-turn.you button[title^="Delete"]')?.closest(".chat-turn")?.textContent)
      .toContain("Where should I start?");
    expect(host.querySelectorAll(".chat-turn.you")[0]?.querySelector('button[title^="Delete"]')).toBeNull();
  });

  it("arms on the first press, saying how much goes, and deletes on the second", () => {
    paint(thread([...turn(1), ...turn(2), ...turn(3)]));
    const second = bins()[0];
    press(second);
    expect(deleted).toEqual([]);
    expect(second?.title).toBe("Press again to delete this question, its answer and the 2 messages after it");
    press(second);
    expect(deleted).toEqual(["spya-q2"]);
    expect((document.activeElement as HTMLElement | null)?.title).toBe("Rewrite this question");
  });

  it("names the answer without counting it as a message after itself", () => {
    paint(thread([...turn(1), ...turn(2)]));
    const last = bins()[0];
    press(last);
    expect(last?.title).toBe("Press again to delete this question and its answer");
  });

  it("does not claim there are '0 messages' after a question with no answer", () => {
    paint(thread([...turn(1), turn(2)[0] as ChatMessage]));
    const last = bins()[0];
    press(last);
    expect(last?.title).toBe("Press again to delete this question");
  });

  it("keeps keyboard focus while it arms, then disarms after its timeout", () => {
    vi.useFakeTimers();
    paint(thread([...turn(1), ...turn(2)]));
    const last = bins()[0];
    last?.focus();
    press(last);
    expect(document.activeElement).toBe(last);
    expect(last?.classList.contains("armed")).toBe(true);
    expect(last?.getAttribute("aria-label")).toBe("Press again to delete this question and its answer");
    expect(last?.getAttribute("aria-pressed")).toBe("true");

    act(() => vi.advanceTimersByTime(4_001));
    expect(last?.title).toBe("Delete this question and everything after it");
    expect(last?.classList.contains("armed")).toBe(false);
    expect(last?.getAttribute("aria-pressed")).toBe("false");
  });

  it("is not there while an answer is arriving", () => {
    /* `settled()` withdraws the callback at the real call sites as soon as the
       send starts. The held row must still reserve the two controls which were
       there before it, or every earlier question changes width mid-answer. */
    paint(thread([...turn(1), ...turn(2, { status: "pending", text: "" })]), false);
    expect(bins()).toHaveLength(0);
    expect(host.querySelectorAll(".chat-turn.you")[1]?.querySelectorAll(".chat-actions.held .chat-icon"))
      .toHaveLength(2);
  });

  it("is not there when the caller offers none", () => {
    paint(thread([...turn(1), ...turn(2), ...turn(3)]), false);
    expect(bins()).toHaveLength(0);
  });
});
