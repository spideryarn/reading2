// @vitest-environment jsdom
/**
 * **What Chat's list draws for a conversation that came from somewhere else**:
 * its source icon and card, where a press on it goes, which rows may be
 * renamed or deleted, and the filter above the list.
 *
 * Report `spya-hyfqkq`; plan
 * docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md, D5.
 * The real `ChatPanel`, handed props directly. Which conversations the band
 * hands it, and what it does with a press, is
 * tests/chat-lists-every-conversation.test.tsx.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatThread, ThreadKind } from "../src/types.js";
import { forgetChatDrafts } from "../src/web/chat-draft.js";
import type { ChatFrom } from "../src/web/params.js";

const { ChatPanel } = await import("../src/web/ChatPanel.js");

const AT = "2026-09-20T10:00:00.000Z";

function thread(id: string, kind: ThreadKind, over: Partial<ChatThread> = {}): ChatThread {
  return {
    id,
    kind,
    title: kind === "chat" ? `A question in ${id}` : "Um, so what I took was",
    createdAt: AT,
    updatedAt: AT,
    messages: [
      { id: `${id.slice(0, 9)}q`, role: "user", text: "said", createdAt: AT, status: "done" },
      { id: `${id.slice(0, 9)}a`, role: "assistant", text: "answered", createdAt: AT, status: "done" },
    ],
    ...over,
  };
}

const CHAT = thread("spya-chat21", "chat");
const LEARN = thread("spya-rem021", "learn");
const TUTORIAL = thread("spya-tut022", "tutorial");
const EXPLORE = thread("spya-exp022", "explore");
const CLAIM = thread("spya-clm023", "chat", {
  origin: { mode: "debate", blockId: "spya-bbbbbb", quote: "RNA can transfer a memory" },
});
const PASSAGE = thread("spya-psg024", "chat", {
  anchor: { blockId: "spya-cccccc", quote: "the felt quality", start: 4 },
});
const EVERY = [CHAT, LEARN, TUTORIAL, EXPLORE, CLAIM, PASSAGE];

const opened: string[] = [];
const wentToLearn: [string, string][] = [];
const chose: (ChatFrom | null)[] = [];
const renamed: string[] = [];
const deleted: string[] = [];

let host: HTMLDivElement;
let root: Root;

function paint(
  listed: ChatThread[],
  over: { from?: ChatFrom | null; threadId?: string | null } = {},
): void {
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        kind: "chat" as const,
        loaded: true,
        loadFailed: false,
        /* The two sets, as the band hands them: every listable conversation,
           and the chat-kind ones the band may open. */
        listed,
        threads: listed.filter((t) => t.kind === "chat"),
        threadId: over.threadId ?? null,
        from: over.from ?? null,
        onFrom: (next: ChatFrom | null) => {
          chose.push(next);
        },
        onOpenLearn: (view: string, id: string) => {
          wentToLearn.push([view, id]);
        },
        onThread: (id: string | null) => {
          if (id) opened.push(id);
        },
        onSend: () => {},
        onNew: () => {},
        onSendNew: () => {},
        onDiscard: () => {},
        onRename: (id: string) => {
          renamed.push(id);
        },
        onDelete: (id: string) => {
          deleted.push(id);
        },
        canStartOver: true,
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
  opened.length = 0;
  wentToLearn.length = 0;
  chose.length = 0;
  renamed.length = 0;
  deleted.length = 0;
  forgetChatDrafts();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const rows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".chat-thread")];
/** The row whose press target carries this conversation's id. */
function row(t: ChatThread): HTMLElement {
  const found = host.querySelector<HTMLElement>(`.chat-thread[data-thread="${t.id}"]`);
  if (!found) throw new Error(`no row for ${t.id}`);
  return found;
}
const mark = (t: ChatThread): HTMLElement | null => row(t).querySelector<HTMLElement>(".chat-thread-source");
const press = (el: Element | null | undefined): void => {
  if (!el) throw new Error("nothing to press");
  act(() => (el as HTMLElement).click());
};

describe("a row's source icon", () => {
  it("wears the source's glyph: Brain for Learn, Peer review's book for a claim and Pilcrow for a passage", () => {
    paint(EVERY);
    for (const t of [LEARN, TUTORIAL, EXPLORE]) {
      expect(mark(t)?.querySelector("svg.lucide-brain"), t.id).not.toBeNull();
    }
    expect(mark(CLAIM)?.querySelector("svg.lucide-book-text")).not.toBeNull();
    expect(mark(PASSAGE)?.querySelector("svg.lucide-pilcrow")).not.toBeNull();
  });

  it("is drawn on every row from elsewhere, named for where it came from, and not on a plain chat", () => {
    paint(EVERY);
    expect(rows()).toHaveLength(EVERY.length);
    expect(mark(CHAT)).toBeNull();
    expect(mark(LEARN)?.getAttribute("aria-label")).toBe("From Learn › Recall");
    expect(mark(TUTORIAL)?.getAttribute("aria-label")).toBe("From Learn › Tutorial");
    expect(mark(EXPLORE)?.getAttribute("aria-label")).toBe("From Learn › Explore");
    expect(mark(CLAIM)?.getAttribute("aria-label")).toBe("Started from a claim in Peer review › Claims");
    expect(mark(PASSAGE)?.getAttribute("aria-label")).toBe("About a passage");
    for (const t of EVERY) {
      if (t !== CHAT) expect(mark(t)?.querySelector("svg"), `${t.id} has a glyph`).not.toBeNull();
    }
  });

  it("leads its row, and a plain chat's title lines up with the others", () => {
    paint(EVERY);
    for (const t of EVERY) {
      const first = row(t).firstElementChild;
      expect(first?.classList.contains("chat-thread-lead"), `${t.id} starts with the icon's slot`).toBe(true);
      expect(first?.nextElementSibling?.classList.contains("chat-thread-open")).toBe(true);
    }
  });

  it("keeps no slot when no row has a source", () => {
    paint([CHAT]);
    expect(row(CHAT).querySelector(".chat-thread-lead")).toBeNull();
  });

  it("is a button a finger or the keyboard can press, and its card says where the row came from", () => {
    paint(EVERY);
    const debate = mark(CLAIM);
    expect(debate?.tagName).toBe("BUTTON");
    press(debate);
    /* Every card on screen: one that is closing fades for a moment after
       the next has opened. */
    const cards = (): string[] => [...document.querySelectorAll('[role="tooltip"]')].map((c) => c.textContent ?? "");
    expect(cards().some((c) => c.includes("Started from a claim in Peer review › Claims") && c.includes("RNA can transfer a memory"))).toBe(
      true,
    );
    expect(debate?.getAttribute("aria-expanded")).toBe("true");
    /* Pressing the icon is not pressing the row. */
    expect(opened).toEqual([]);
    press(debate);
    expect(debate?.getAttribute("aria-expanded")).toBe("false");

    press(mark(LEARN));
    expect(cards().some((c) => c.includes("From Learn › Recall"))).toBe(true);
    expect(wentToLearn).toEqual([]);
  });
});

describe("pressing a row", () => {
  it("opens a chat, a claim check and a passage chat in the band", () => {
    paint(EVERY);
    for (const t of [CHAT, CLAIM, PASSAGE]) press(row(t).querySelector(".chat-thread-open"));
    expect(opened).toEqual([CHAT.id, CLAIM.id, PASSAGE.id]);
    expect(wentToLearn).toEqual([]);
  });

  it("goes to Learn, on its sub-mode, for a Learn row, and never opens it here", () => {
    paint(EVERY);
    for (const t of [LEARN, TUTORIAL, EXPLORE]) press(row(t).querySelector(".chat-thread-open"));
    expect(wentToLearn).toEqual([
      ["recall", LEARN.id],
      ["tutorial", TUTORIAL.id],
      ["explore", EXPLORE.id],
    ]);
    expect(opened).toEqual([]);
  });

  it("does not draw a Learn conversation as the open one, whatever `threadId` says", () => {
    paint(EVERY, { threadId: LEARN.id });
    /* The list, not a transcript with a composer that would send to it. */
    expect(rows()).toHaveLength(EVERY.length);
    expect(host.querySelector(".chat-head-title")).toBeNull();
  });
});

describe("a Learn row", () => {
  it("is named for its sub-mode, not for the first sixty characters said in it", () => {
    paint(EVERY);
    expect(row(LEARN).querySelector(".chat-thread-title")?.textContent).toBe("Recall");
    expect(row(TUTORIAL).querySelector(".chat-thread-title")?.textContent).toBe("Tutorial");
    expect(row(EXPLORE).querySelector(".chat-thread-title")?.textContent).toBe("Explore");
  });

  it("has no rename and no delete; a chat's row keeps both", () => {
    paint(EVERY);
    for (const t of [LEARN, TUTORIAL, EXPLORE]) {
      expect(row(t).querySelector('button[title="Rename this conversation"]'), `${t.id} rename`).toBeNull();
      expect(row(t).querySelector('button[title="Delete this conversation"]'), `${t.id} delete`).toBeNull();
    }
    for (const t of [CHAT, CLAIM, PASSAGE]) {
      expect(row(t).querySelector('button[title="Rename this conversation"]')).not.toBeNull();
      expect(row(t).querySelector('button[title="Delete this conversation"]')).not.toBeNull();
    }
    press(row(CHAT).querySelector('button[title="Delete this conversation"]'));
    expect(deleted).toEqual([CHAT.id]);
  });
});

describe("the filter above the list", () => {
  const choices = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>(".chat-from button")];
  const words = (): string[] => choices().map((b) => b.textContent ?? "");

  it("is not drawn when every conversation is from one source", () => {
    paint([CHAT]);
    expect(host.querySelector(".chat-from")).toBeNull();
    paint([LEARN, TUTORIAL]);
    expect(host.querySelector(".chat-from")).toBeNull();
  });

  it("offers All, Chats, then one choice per other source present, with Learn's three as one", () => {
    paint(EVERY);
    expect(words()).toEqual(["All", "Chats", "Peer review", "Learn", "About a passage"]);
    paint([CHAT, TUTORIAL, EXPLORE]);
    expect(words()).toEqual(["All", "Chats", "Learn"]);
    paint([LEARN, CLAIM]);
    expect(words()).toEqual(["All", "Peer review", "Learn"]);
  });

  it("defaults to All, which shows every row", () => {
    paint(EVERY);
    expect(choices().filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent)).toEqual([
      "All",
    ]);
    expect(rows()).toHaveLength(EVERY.length);
  });

  it("does not hide an explicitly opened chat when the list's filter is Learn", () => {
    paint(EVERY, { from: "learn", threadId: CHAT.id });
    expect(host.querySelector(".chat-head-title")).not.toBeNull();
    expect(rows()).toHaveLength(0);
    expect(host.querySelector("textarea.chat-input")).not.toBeNull();
  });

  it("narrows the rows to the chosen source", () => {
    paint(EVERY, { from: "learn" });
    expect(rows().map((r) => r.dataset.thread).sort()).toEqual([LEARN.id, TUTORIAL.id, EXPLORE.id].sort());
    expect(choices().find((b) => b.getAttribute("aria-pressed") === "true")?.textContent).toBe("Learn");
    paint(EVERY, { from: "chats" });
    expect(rows().map((r) => r.dataset.thread)).toEqual([CHAT.id]);
    paint(EVERY, { from: "peer-review" });
    expect(rows().map((r) => r.dataset.thread)).toEqual([CLAIM.id]);
    paint(EVERY, { from: "passage" });
    expect(rows().map((r) => r.dataset.thread)).toEqual([PASSAGE.id]);
  });

  it("tells the band which was pressed, and null for All", () => {
    paint(EVERY, { from: "learn" });
    press(choices().find((b) => b.textContent === "Peer review"));
    press(choices().find((b) => b.textContent === "All"));
    expect(chose).toEqual(["peer-review", null]);
  });

  it("shows everything for a choice whose source is not here, so nothing is hidden without a control to say why", () => {
    paint([CHAT], { from: "peer-review" });
    expect(rows().map((r) => r.dataset.thread)).toEqual([CHAT.id]);
  });
});

describe("an article whose only conversations are Learn's", () => {
  it("shows their rows, with the box and the button to start a chat", () => {
    paint([LEARN, TUTORIAL]);
    expect(rows()).toHaveLength(2);
    expect(host.querySelector("textarea.chat-input")).not.toBeNull();
    expect(host.querySelector('button[title="Start a new conversation"]')).not.toBeNull();
  });
});
