// @vitest-environment jsdom
/**
 * **What Chat's panel draws for the guide** — plan
 * docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md,
 * stage 2:
 *
 * - **the pinned row**, above the list and outside its source filter, there
 *   under every `?chatfrom=` and with no conversation at all, and a press on
 *   it opens the guide (GPT Sol's F2);
 * - **the greeting**, ours and free: the *Why you're reading this one* box
 *   only when no reason is stored, *Ask the guide where to start* only when
 *   one is, a line about the profile only when *About you* is empty, and
 *   neither box nor button when the reason could not be read (F5).
 *
 * The real `ChatPanel`, handed props directly, as
 * tests/chat-list-sources.test.tsx does. What the band hands it is
 * tests/guide-in-chat-band.test.tsx.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread, ThreadKind } from "../src/types.js";
import { forgetChatDrafts } from "../src/web/chat-draft.js";
import type { ChatFrom } from "../src/web/params.js";

/** What `GET /api/reader?slug=` answers. */
let reader: { profile: string | null; purpose: string | null; purposeFailed: boolean } = {
  profile: null,
  purpose: null,
  purposeFailed: false,
};
const patches: unknown[] = [];

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  return {
    ...real,
    apiFetch: (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PATCH") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { purpose: string | null };
        patches.push(body);
        reader = { ...reader, purpose: body.purpose };
        return Promise.resolve(json({ purpose: body.purpose }));
      }
      if (String(url).startsWith("/api/reader")) return Promise.resolve(json(reader));
      return Promise.resolve(json({}));
    },
  };
});

const { ChatPanel } = await import("../src/web/ChatPanel.js");
const { GUIDE_FIRST_QUESTION, GUIDE_START_LABEL } = await import("../src/web/GuideGreeting.js");

const AT = "2026-10-07T09:00:00.000Z";

function thread(id: string, kind: ThreadKind, over: Partial<ChatThread> = {}): ChatThread {
  return {
    id,
    kind,
    title: `A question in ${id}`,
    createdAt: AT,
    updatedAt: AT,
    messages: [
      { id: `${id.slice(0, 9)}q`, role: "user", text: "said", createdAt: AT, status: "done" },
      { id: `${id.slice(0, 9)}a`, role: "assistant", text: "answered", createdAt: AT, status: "done" },
    ],
    ...over,
  };
}

const CHAT = thread("spya-chtaab", "chat");
const CLAIM = thread("spya-clmaab", "chat", {
  origin: { mode: "debate", blockId: "spya-bbbbbb", quote: "RNA can transfer a memory" },
});
const LEARN = thread("spya-remaab", "learn");
const EMPTY_GUIDE = thread("spya-gdeaab", "guide", { messages: [] });

let host: HTMLDivElement;
let root: Root;
const sent: string[] = [];
let guideOpened = 0;

function paint(listed: ChatThread[], over: { from?: ChatFrom | null; threadId?: string | null; guide?: ChatThread | null } = {}) {
  const guide = over.guide ?? null;
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        kind: "chat" as const,
        loaded: true,
        loadFailed: false,
        listed,
        threads: [...listed.filter((t) => t.kind === "chat"), ...(guide ? [guide] : [])],
        guide: {
          thread: guide,
          onOpen: () => {
            guideOpened += 1;
          },
        },
        threadId: over.threadId ?? null,
        from: over.from ?? null,
        onFrom: () => {},
        onOpenLearn: () => {},
        onThread: () => {},
        onSend: (q: string) => {
          sent.push(q);
        },
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

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  reader = { profile: null, purpose: null, purposeFailed: false };
  patches.length = 0;
  sent.length = 0;
  guideOpened = 0;
  forgetChatDrafts();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const guideRow = (): HTMLElement | null => host.querySelector<HTMLElement>(".chat-guide");

describe("the guide's pinned row", () => {
  it.each([null, "chats", "debate", "learn"] as const)("is above the list whatever the filter says (%s)", (from) => {
    paint([CHAT, CLAIM, LEARN], { from });
    const row = guideRow();
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("Guide");
    /* First in the list, ahead of the filter and every row. */
    const list = host.querySelector(".chat-threads");
    expect(row && list && row.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is there with no conversation at all, and before the guide exists", () => {
    paint([]);
    expect(guideRow()?.textContent).toContain("How to read this piece");
  });

  it("does not say nothing was asked when the guide holds a conversation (browser pass)", () => {
    paint([], { guide: thread("spya-gdeabb", "guide") });
    expect(host.textContent).not.toContain("Nothing asked yet.");
    act(() => root.render(createElement("div")));
    paint([]);
    expect(host.textContent).toContain("Nothing asked yet.");
  });

  it("opens the guide when pressed", () => {
    paint([CHAT]);
    act(() => guideRow()?.querySelector<HTMLButtonElement>("button")?.click());
    expect(guideOpened).toBe(1);
  });
});

describe("the guide's greeting", () => {
  const greeting = async () => {
    paint([CHAT], { guide: EMPTY_GUIDE, threadId: EMPTY_GUIDE.id });
    await settle();
  };
  const box = () => host.querySelector<HTMLTextAreaElement>("#guide-purpose");
  const startButton = () =>
    [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === GUIDE_START_LABEL);

  it("says what the guide is for, and is headed Guide", async () => {
    await greeting();
    expect(host.textContent).toContain("I'm here to help you read this piece well");
    expect(host.querySelector("h2")?.textContent).toBe("Guide");
  });

  it("holds the reason box, and no start button, when no reason is stored", async () => {
    await greeting();
    expect(box()).not.toBeNull();
    expect(host.textContent).toContain("You can answer in the box above, or just type below.");
    expect(startButton()).toBeUndefined();
  });

  it("offers the start button, and no box, when a reason is stored; the press sends the fixed question", async () => {
    reader = { ...reader, purpose: "I review for a journal" };
    await greeting();
    expect(box()).toBeNull();
    expect(host.textContent).not.toContain("Tell me why you're reading it");
    const button = startButton();
    expect(button).toBeDefined();
    act(() => button?.click());
    expect(sent).toEqual([GUIDE_FIRST_QUESTION]);
  });

  it("offers the start button once the reader's own reason has been saved from the box", async () => {
    await greeting();
    const field = box();
    if (!field) throw new Error("no box");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(field, "To find the method");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      field.blur();
    });
    await settle();
    expect(patches).toEqual([{ purpose: "To find the method" }]);
    expect(startButton()).toBeDefined();
    expect(sent, "saving the reason sends nothing").toEqual([]);
  });

  it("points at the profile only when About you is empty", async () => {
    await greeting();
    expect(host.querySelector('a[href="/profile"]')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    reader = { ...reader, profile: "A historian of science" };
    await greeting();
    expect(host.querySelector('a[href="/profile"]')).toBeNull();
  });

  it("asks nothing and offers nothing when the reason could not be read", async () => {
    reader = { ...reader, purposeFailed: true };
    await greeting();
    expect(box()).toBeNull();
    expect(startButton()).toBeUndefined();
  });
});
