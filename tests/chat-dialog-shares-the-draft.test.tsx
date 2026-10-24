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
const OTHER_BLOCK = "spya-dlgb02" as BlockId;

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
const sends: unknown[][] = [];
let closes = 0;

vi.mock("../src/web/useProfile.js", () => ({
  useProfile: () => ({ profile: null, loaded: true, save: () => {}, error: null }),
}));
vi.mock("../src/web/useChat.js", () => ({
  useChat: () => ({
    threads,
    loaded: true,
    loadFailed: false,
    recovering: new Set<string>(),
    send: (...args: unknown[]) => {
      sends.push(args);
      return STORED.id;
    },
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
        blocks={new Map([[BLOCK, "a science of bumps"], [OTHER_BLOCK, "another passage"]])}
        target={target}
        onJump={() => {}}
        onClose={() => {
          closes += 1;
        }}
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

function submit(): void {
  act(() => box().form?.requestSubmit());
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
  sends.length = 0;
  closes = 0;
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

  it("passes a typed follow-up's modality to the stored turn", () => {
    mount({ kind: "thread", threadId: STORED.id });
    type("typed in the dialog");
    submit();
    expect(sends).toHaveLength(1);
    expect(sends[0]?.[3]).toEqual({ modality: "typed" });
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

  it("passes a typed new question's modality to the stored turn", () => {
    mount({ kind: "draft", anchor: { blockId: BLOCK }, opening: "a science of bumps" });
    type("What does this mean?");
    submit();
    expect(sends).toHaveLength(1);
    expect(sends[0]?.[3]).toMatchObject({ modality: "typed" });
  });
});

/* **A passage's unsent words outlive the dialog** — a mode switch closes it
   (docs/plans/261024r-switching-mode-leaves-the-chat.md, GPT Sol's F1), and
   the words lived only in its state. They are kept in the article's store by
   block, apart from any conversation's, and the block's chat brings them back. */
describe("the dialog's passage arm, closed unsent", () => {
  const draft = (extra: Partial<Extract<Target, { kind: "draft" }>> = {}): Target => ({
    kind: "draft",
    anchor: { blockId: BLOCK },
    opening: "a science of bumps",
    ...extra,
  });

  it("has its words back when the block's chat opens again", () => {
    mount(draft());
    type("half a question about bumps");
    act(() => root.render(null));
    mount(draft());
    expect(box().value).toBe("half a question about bumps");
  });

  it("changes drafts when another block replaces it without unmounting the dialog", () => {
    mount(draft());
    type("about the first passage");
    mount({
      kind: "draft",
      anchor: { blockId: OTHER_BLOCK },
      opening: "another passage",
      question: "about the second passage",
    });
    expect(box().value).toBe("about the second passage");
  });

  it("counts them as words the page holds", () => {
    mount(draft());
    type("half a question");
    expect(chatDraftsFor(SLUG).holdsWords()).toBe(true);
  });

  it("gives way to a question handed in with the new press", () => {
    mount(draft());
    type("the old words");
    act(() => root.render(null));
    mount(draft({ question: "the new question" }));
    expect(box().value).toBe("the new question");
    act(() => root.render(null));
    mount(draft());
    expect(box().value).toBe("the new question");
  });

  it("keeps the words when the reader explicitly closes the panel", () => {
    mount(draft());
    type("keep this for later");
    const close = host.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    if (!close) throw new Error("the dialog drew no close button");
    act(() => close.click());
    expect(closes).toBe(1);
    act(() => root.render(null));
    mount(draft());
    expect(box().value).toBe("keep this for later");
  });

  it("does not erase other unsent words when a handed-in question sends itself", () => {
    chatDraftsFor(SLUG).setPassage(BLOCK, "a different half-written question");
    mount(draft({ question: "Does it say that?", sendNow: true }));
    expect(sends).toHaveLength(1);
    act(() => root.render(null));
    mount(draft());
    expect(box().value).toBe("a different half-written question");
  });

  it("forgets them once they are sent", () => {
    mount(draft());
    type("What does this mean?");
    submit();
    act(() => root.render(null));
    mount(draft());
    expect(box().value).toBe("");
  });
});
