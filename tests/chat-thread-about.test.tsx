// @vitest-environment jsdom
/**
 * **An open conversation's (i) says which model answered it, and how hard it
 * was asked to think** — Greg, spya-pd9fnc, 2026-10-08: *"in the information
 * icon for the chat thread, I was hoping it would show me which model it had
 * been using, and perhaps even thinking level."* Plan 261008c § 2.
 *
 * The real `ChatPanel`, handed props directly as
 * tests/guide-in-chat-panel.test.tsx does, and the card opened with a press.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatThread } from "../src/types.js";
import { forgetChatDrafts } from "../src/web/chat-draft.js";

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  return { ...real, apiFetch: () => Promise.resolve(json({})) };
});

const { ChatPanel } = await import("../src/web/ChatPanel.js");
const { answeredBy, thinkingWords } = await import("../src/web/ChatThreadAbout.js");

const AT = "2026-10-08T07:32:00.000Z";
const q = (id: string): ChatMessage => ({ id, role: "user", text: "why?", createdAt: AT, status: "done" });
const a = (id: string, more: Partial<ChatMessage>): ChatMessage => ({
  id,
  role: "assistant",
  text: "because",
  createdAt: AT,
  status: "done",
  ...more,
});
const chat = (messages: ChatMessage[]): ChatThread => ({
  id: "spya-jx9tut",
  kind: "chat",
  title: "why?",
  createdAt: AT,
  updatedAt: AT,
  messages,
});

let host: HTMLDivElement;
let root: Root;

function paint(open: ChatThread | null) {
  const listed = open ? [open] : [];
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        kind: "chat" as const,
        loaded: true,
        loadFailed: false,
        listed,
        threads: listed,
        guide: { thread: null, onOpen: () => {} },
        threadId: open?.id ?? null,
        from: null,
        onFrom: () => {},
        onOpenLearn: () => {},
        onThread: () => {},
        onSend: () => {},
        onNew: () => {},
        onSendNew: () => {},
        onDiscard: () => {},
        onRename: () => {},
        onDelete: () => {},
        canStartOver: false,
        onRetry: () => {},
        onEdit: () => {},
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

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  forgetChatDrafts();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function openCard(): Promise<string> {
  const button = host.querySelector<HTMLButtonElement>(".band-about");
  if (!button) throw new Error("no (i)");
  await act(async () => button.click());
  return document.body.querySelector(".band-about-card")?.textContent ?? "";
}

describe("answeredBy", () => {
  it("groups finished answers by the model's name and their thinking, in first-seen order", () => {
    const groups = answeredBy([
      q("spya-q00001"),
      a("spya-a00001", { model: "anthropic/claude-sonnet-5", effort: "default" }),
      q("spya-q00002"),
      a("spya-a00002", { model: "claude-sonnet-5", effort: "default" }),
      a("spya-a00003", { model: "anthropic/claude-opus-5.5", effort: "high" }),
      a("spya-a00004", { model: "anthropic/claude-sonnet-5" }),
      a("spya-a00005", { status: "error", error: "x" }),
      a("spya-a00006", { status: "pending", model: "anthropic/claude-sonnet-5" }),
    ]);
    expect(groups).toEqual([
      { model: "claude-sonnet-5", effort: "default", answers: 2 },
      /* The table's name, not a stripped prefix: that would be claude-opus-5.5 (Sol's F3). */
      { model: "claude-opus-5-5", effort: "high", answers: 1 },
      { model: "claude-sonnet-5", effort: undefined, answers: 1 },
    ]);
  });

  it("says each thinking level in words, and an old answer's as not recorded", () => {
    expect(thinkingWords("default")).toBe("thinking as much as the model chooses");
    expect(thinkingWords("high")).toBe("thinking effort high");
    expect(thinkingWords("none")).toBe("with thinking switched off");
    expect(thinkingWords(undefined)).toBe("thinking level not recorded");
  });
});

describe("an open conversation's (i)", () => {
  it("names the one model and its thinking", async () => {
    paint(chat([q("spya-q00001"), a("spya-a00001", { model: "anthropic/claude-sonnet-5", effort: "default" })]));
    expect(await openCard()).toContain(
      "This conversation was answered by claude-sonnet-5, thinking as much as the model chooses.",
    );
  });

  it("lists each model with how many answers it gave, when High-powered AI was switched mid-way", async () => {
    paint(
      chat([
        q("spya-q00001"),
        a("spya-a00001", { model: "anthropic/claude-sonnet-5", effort: "default" }),
        q("spya-q00002"),
        a("spya-a00002", { model: "anthropic/claude-opus-5.5", effort: "high" }),
      ]),
    );
    const card = await openCard();
    expect(card).toContain("claude-sonnet-5, thinking as much as the model chooses — 1 answer");
    expect(card).toContain("claude-opus-5-5, thinking effort high — 1 answer");
  });

  it("says nothing about models before anything has been answered, nor on the list", async () => {
    paint(chat([]));
    const empty = await openCard();
    expect(empty, "control: the card opened").toContain("More in Help");
    expect(empty).not.toContain("answered by");
    act(() => root.render(createElement("div")));
    paint(null);
    expect(await openCard()).not.toContain("answered by");
  });
});
