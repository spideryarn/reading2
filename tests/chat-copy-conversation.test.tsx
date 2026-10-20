// @vitest-environment jsdom
/**
 * **Copy this conversation**, in the chat header: the whole thread as
 * Markdown on the clipboard (src/web/ChatPanel.tsx § `CopyConversation`,
 * src/chat-markdown.ts). The states are `useCopy`'s, tested in
 * tests/chat-copy-answer.test.tsx and tests/use-copy.test.tsx; this tests
 * what is copied and when the button is drawn.
 * docs/plans/261020w-export-your-own-words-and-a-chat-as-markdown.md § Stage 2.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CopyConversation } from "../src/web/ChatPanel.js";
import type { ChatThread, ChatThreadView } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Reflect.deleteProperty(navigator as object, "clipboard");
});

const at = "2026-10-19T20:41:00.000Z";

function thread(messages: ChatThread["messages"]): ChatThreadView {
  return { id: "t1", title: "Survival value", createdAt: at, updatedAt: at, kind: "chat", messages };
}

function paint(t: ChatThreadView): void {
  act(() => {
    root.render(
      createElement(CopyConversation, {
        thread: t,
        article: { slug: "tinbergen-spya-ks84se", title: "On aims and methods" },
        blocks: new Map<string, string>(),
      }),
    );
  });
}

function clipboard(): string[] {
  const wrote: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (t: string) => {
        wrote.push(t);
        return Promise.resolve();
      },
    },
  });
  return wrote;
}

describe("Copy this conversation", () => {
  it("copies every turn, as Markdown with a header naming the article", async () => {
    const wrote = clipboard();
    paint(
      thread([
        { id: "m1", role: "user", text: "What is survival value?", createdAt: at, status: "done" },
        { id: "m2", role: "assistant", text: "Its effect on fitness [spya-k3m9qt].", createdAt: at, status: "done" },
        { id: "m3", role: "user", text: "And causation?", createdAt: at, status: "done" },
        { id: "m4", role: "assistant", text: "The mechanism.", createdAt: at, status: "done" },
      ]),
    );
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Copy this conversation as Markdown"]');
    expect(button).not.toBeNull();
    await act(async () => {
      button?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(wrote).toHaveLength(1);
    const doc = wrote[0] ?? "";
    expect(doc).toMatch(/^---\nspideryarn: "conversation"\n/);
    expect(doc).toContain('article_url: "https://www.spideryarn.com/read/tinbergen-spya-ks84se"');
    expect(doc.indexOf("What is survival value?")).toBeLessThan(doc.indexOf("And causation?"));
    expect(doc).toContain("Its effect on fitness [spya-k3m9qt].");
    expect(doc).toContain("The mechanism.");
    expect(host.querySelector("[aria-live]")?.textContent).toBe("Conversation copied.");
  });

  it("is not drawn on a conversation with nothing in it", () => {
    paint(thread([]));
    expect(host.querySelector("button")).toBeNull();
  });

  it("copies the titles of articles brought into the conversation", async () => {
    const wrote = clipboard();
    paint({
      ...thread([{ id: "m1", role: "user", text: "Compare them", createdAt: at, status: "done" }]),
      mentioned: [{ available: false, title: "The other paper", reason: "deleted" }],
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Copy this conversation as Markdown"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(wrote[0]).toContain("Also reading:\n\n- The other paper");
  });
});
