// @vitest-environment jsdom
/**
 * **The floating chat dialog and Chat mode type into the same unsent question,
 * and a conversation deleted from the dialog takes its words with it.**
 *
 * Entering Chat unmounts the dialog and leaving Chat can mount it on the same
 * conversation, so two private drafts for one conversation would be two
 * different half-questions depending on which box the reader last saw. And a
 * delete pressed in the dialog is a delete the Chat band never hears about:
 * words left behind under that id are words for a conversation that is gone.
 * GPT Sol's review of
 * docs/plans/261004j-chat-keeps-an-unsent-question-across-a-mode-change.md, F5
 * and its rider (the Cancel that discards a first answer).
 *
 * `useChat` is stood in for, as in tests/chat-dialog-docks.test.tsx: what is
 * asked here is what the dialog does to src/web/chat-draft.ts, not what the
 * controller does with a delete.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BlockId, ChatThread } from "../src/types.js";
import { chatDraftsFor, forgetChatDrafts } from "../src/web/chat-draft.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "a-piece";
const AT = "2026-10-04T09:00:00.000Z";
const BLOCK = "spya-dlgb01" as BlockId;

const STORED: ChatThread = {
  id: "spya-dlgt01",
  kind: "chat",
  title: "An earlier conversation",
  createdAt: AT,
  updatedAt: AT,
  messages: [
    { id: "spya-dlgq01", role: "user", text: "asked", createdAt: AT, status: "done" },
    { id: "spya-dlga01", role: "assistant", text: "answered", createdAt: AT, status: "done" },
  ],
};

/** The same conversation while its first answer is still arriving. */
const FIRST_ANSWER: ChatThread = {
  ...STORED,
  messages: [
    { id: "spya-dlgq01", role: "user", text: "asked", createdAt: AT, status: "done" },
    { id: "spya-dlga01", role: "assistant", text: "", createdAt: AT, status: "pending" },
  ],
};

let threads: ChatThread[] = [STORED];
const removed: string[] = [];
const discarded: string[] = [];

vi.mock("../src/web/useProfile.js", () => ({
  useProfile: () => ({ profile: null, loaded: true, save: () => {}, error: null }),
}));
vi.mock("../src/web/useChat.js", () => ({
  useChat: () => ({
    threads,
    loaded: true,
    loadFailed: false,
    recovering: new Set<string>(),
    send: () => STORED.id,
    speak: () => "",
    cancelAndDiscard: (id: string) => {
      discarded.push(id);
    },
    retry: () => {},
    edit: () => {},
    stop: () => {},
    begin: () => {},
    discard: () => {},
    rename: () => {},
    remove: (id: string) => {
      removed.push(id);
    },
    deleteFrom: () => {},
    settled: () => true,
    error: null,
  }),
}));

const { ChatDialog } = await import("../src/web/ChatDialog.js");

let host: HTMLDivElement;
let root: Root;

type Target = Parameters<typeof ChatDialog>[0]["target"];

function mount(target: Target) {
  act(() =>
    root.render(
      <ChatDialog
        slug={SLUG}
        at={null}
        blocks={new Map([[BLOCK, "a science of bumps"]])}
        target={target}
        onJump={() => {}}
        onClose={() => {}}
        onThread={() => {}}
        onOpenFull={() => {}}
        onCreated={() => {}}
        onDropped={() => {}}
        onRenamed={() => {}}
      />,
    ),
  );
}

function box(): HTMLTextAreaElement {
  const el = host.querySelector<HTMLTextAreaElement>("textarea.chat-input");
  if (!el) throw new Error("the dialog drew no composer");
  return el;
}

function type(text: string): void {
  const el = box();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(label: string): void {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  if (!button) throw new Error(`the dialog drew no "${label}" button`);
  act(() => button.click());
}

beforeEach(() => {
  forgetChatDrafts();
  threads = [STORED];
  removed.length = 0;
  discarded.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the dialog's conversation arm", () => {
  it("opens with the words left unsent in Chat mode", () => {
    chatDraftsFor(SLUG).setThread(STORED.id, "half a follow-up");
    mount({ kind: "thread", threadId: STORED.id });
    expect(box().value).toBe("half a follow-up");
  });

  it("leaves what is typed in it for Chat mode to find", () => {
    mount({ kind: "thread", threadId: STORED.id });
    type("typed in the dialog");
    expect(chatDraftsFor(SLUG).thread(STORED.id)).toBe("typed in the dialog");
  });

  it("forgets the words when the conversation is deleted from here", () => {
    chatDraftsFor(SLUG).setThread(STORED.id, "half a follow-up");
    mount({ kind: "thread", threadId: STORED.id });
    press("Delete");
    expect(removed).toEqual([STORED.id]);
    expect(chatDraftsFor(SLUG).thread(STORED.id), "words kept for a deleted conversation").toBeUndefined();
  });

  it("forgets them when a first answer is cancelled and the conversation thrown away", () => {
    threads = [FIRST_ANSWER];
    chatDraftsFor(SLUG).setThread(STORED.id, "typed while waiting");
    mount({ kind: "thread", threadId: STORED.id });
    press("Cancel");
    expect(discarded).toEqual([STORED.id]);
    expect(chatDraftsFor(SLUG).thread(STORED.id), "words kept for a discarded conversation").toBeUndefined();
  });
});

describe("the dialog's passage arm", () => {
  it("keeps its draft to itself", () => {
    mount({ kind: "draft", anchor: { blockId: BLOCK }, opening: "a science of bumps" });
    type("about this passage");
    expect(chatDraftsFor(SLUG).list()).toBe("");
    expect(chatDraftsFor(SLUG).thread(BLOCK)).toBeUndefined();
  });
});
