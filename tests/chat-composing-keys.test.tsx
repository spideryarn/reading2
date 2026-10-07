// @vitest-environment jsdom
/**
 * **A key that belongs to an input method is not a press on Chat.**
 *
 * A reader typing Japanese or Chinese presses Enter to accept a candidate word
 * and Escape to dismiss the candidate list. Chat has three boxes and until
 * plan 261007a-ui-sweep-k2 each answered those keys as its own: the composer's
 * Escape emptied the draft (or stopped the answer), the rename box saved on
 * Enter and cancelled on Escape, and the question editor cancelled on Escape.
 *
 * Both spellings of "composing" are pressed everywhere: the `isComposing` flag,
 * and the `keyCode` 229 some engines send instead (src/web/key-chord.ts §
 * `isImeComposing`). Each case has its control beside it, the same press
 * without the flag, so a guard that swallowed every key would fail here.
 *
 * The composer's Enter is tests/the-enter-key-really-sends.test.tsx; the panel
 * and the drawer staying open is tests/one-escape-closes-one-surface.test.tsx.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatThread } from "../src/types.js";
import { forgetChatDrafts } from "../src/web/chat-draft.js";

const { ChatPanel, Composer } = await import("../src/web/ChatPanel.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COMPOSING: Array<{ how: string; init: KeyboardEventInit }> = [
  { how: "isComposing", init: { isComposing: true } },
  { how: "keyCode 229", init: { keyCode: 229 } as KeyboardEventInit },
];

const THREAD: ChatThread = {
  kind: "chat",
  id: "spya-k3m9qt",
  title: "An earlier conversation",
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:05:00.000Z",
  messages: [
    { id: "spya-q1q1q1", role: "user", text: "What is the claim?", createdAt: "2026-08-27T10:00:00.000Z", status: "done" },
    { id: "spya-a1a1a1", role: "assistant", text: "That bumps are a science.", createdAt: "2026-08-27T10:05:00.000Z", status: "done" },
  ],
};

let host: HTMLDivElement;
let root: Root;
let renamed: string[];
let edited: string[];
let stopped: number;

function paint(threadId: string | null): void {
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        kind: "chat" as const,
        loaded: true,
        loadFailed: false,
        threads: [THREAD],
        threadId,
        onThread: () => {},
        onSend: () => {},
        onNew: () => {},
        onSendNew: () => {},
        onDiscard: () => {},
        onRename: (_id: string, title: string) => {
          renamed.push(title);
        },
        onDelete: () => {},
        canStartOver: true,
        onRetry: () => {},
        onEdit: (_message: string, next: string) => {
          edited.push(next);
        },
        onStop: () => {
          stopped++;
        },
        onJump: () => {},
        recovering: new Set<string>(),
        blocks: new Map<string, string>(),
        focusNonce: 0,
        error: null,
      }),
    );
  });
}

function type(el: HTMLTextAreaElement | HTMLInputElement, text: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
}

function click(selector: string): void {
  const el = host.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  act(() => el.click());
}

const composer = () => host.querySelector<HTMLTextAreaElement>("textarea.chat-input");
const renameBox = () => host.querySelector<HTMLInputElement>("input.chat-rename");
const editBox = () => host.querySelector<HTMLTextAreaElement>("textarea.chat-edit-box");

beforeEach(() => {
  forgetChatDrafts();
  renamed = [];
  edited = [];
  stopped = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the composer", () => {
  for (const { how, init } of COMPOSING) {
    it(`keeps the draft on a composing Escape (${how})`, () => {
      paint(null);
      const box = composer() as HTMLTextAreaElement;
      type(box, "日本語の");
      press(box, "Escape", init);
      expect(composer()?.value).toBe("日本語の");
    });
  }

  it("and an ordinary Escape still empties it", () => {
    paint(null);
    const box = composer() as HTMLTextAreaElement;
    type(box, "half a question");
    press(box, "Escape");
    expect(composer()?.value).toBe("");
  });

  /* Every key in the composer is stopped, so the article's arrow keys do not
     move the page under the caret. The composing guard sits after that stop,
     not before it, or a composing key would be the one key that got out. */
  it("still stops a composing key from leaving the box", () => {
    paint(null);
    const heard: string[] = [];
    const watch = (e: Event) => heard.push((e as KeyboardEvent).key);
    document.addEventListener("keydown", watch);
    try {
      for (const { init } of COMPOSING) press(composer() as HTMLTextAreaElement, "Escape", init);
    } finally {
      document.removeEventListener("keydown", watch);
    }
    expect(heard).toEqual([]);
  });
});

describe("the composer while an answer is arriving", () => {
  function mount(): HTMLTextAreaElement {
    act(() => {
      root.render(
        createElement(Composer, {
          slug: "a-piece",
          onSend: () => {},
          onStop: () => {
            stopped++;
          },
          busy: true,
          focusNonce: 0,
          focused: { current: 0 },
          draft: "",
          onDraft: () => {},
        }),
      );
    });
    return composer() as HTMLTextAreaElement;
  }

  for (const { how, init } of COMPOSING) {
    it(`does not stop the answer on a composing Escape (${how})`, () => {
      press(mount(), "Escape", init);
      expect(stopped).toBe(0);
    });
  }

  it("and an ordinary Escape still stops it", () => {
    press(mount(), "Escape");
    expect(stopped).toBe(1);
  });
});

describe("renaming a conversation", () => {
  function open(): HTMLInputElement {
    paint(null);
    click('button[title="Rename this conversation"]');
    const box = renameBox();
    if (!box) throw new Error("the rename box did not open");
    type(box, "骨相");
    return box;
  }

  for (const { how, init } of COMPOSING) {
    it(`does not save on a composing Enter (${how})`, () => {
      press(open(), "Enter", init);
      expect(renamed).toEqual([]);
      expect(renameBox()?.value).toBe("骨相");
    });

    it(`does not cancel on a composing Escape (${how})`, () => {
      press(open(), "Escape", init);
      expect(renameBox()?.value).toBe("骨相");
    });
  }

  it("and an ordinary Enter still saves, an ordinary Escape still cancels", () => {
    press(open(), "Enter");
    expect(renamed).toEqual(["骨相"]);
    press(open(), "Escape");
    expect(renameBox()).toBeNull();
    expect(renamed).toEqual(["骨相"]);
  });
});

describe("rewriting a question", () => {
  function open(): HTMLTextAreaElement {
    paint(THREAD.id);
    click('button[title="Rewrite this question"]');
    const box = editBox();
    if (!box) throw new Error("the editor did not open");
    type(box, "主張は何ですか");
    return box;
  }

  for (const { how, init } of COMPOSING) {
    it(`does not cancel on a composing Escape (${how})`, () => {
      press(open(), "Escape", init);
      expect(editBox()?.value).toBe("主張は何ですか");
      expect(edited).toEqual([]);
    });
  }

  it("and an ordinary Escape still cancels", () => {
    press(open(), "Escape");
    expect(editBox()).toBeNull();
  });
});
