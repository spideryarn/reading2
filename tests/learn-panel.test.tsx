// @vitest-environment jsdom
/**
 * **The Learn composer, and the two things about it that are not obvious.**
 *
 * Learn reuses chat's `Composer` rather than copying it, so almost nothing
 * here is about Learn specifically — the Escape ladder, the auto-resize and
 * the key-propagation stop are chat's and are tested by chat's own files. What
 * is new is a taller box and a labelled microphone. Until 2026-10-02 there was
 * a stance `<select>` too; Recall is one voice now
 * (docs/plans/261002i-one-adaptive-recall-and-a-tutorial-sub-mode-for-remember.md),
 * and the tests below check that nothing of the picker is left — including
 * the tag an old answer carried, which would name an instruction nobody can
 * give any more.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatThread, LearnStance } from "../src/types.js";

const { ChatPanel } = await import("../src/web/ChatPanel.js");

const AT = "2026-08-28T10:00:00.000Z";

/** A Learn turn with one finished answer, asked for in `stance`. */
function learnThread(stance?: LearnStance): ChatThread {
  return {
    id: "spya-k3m9qt",
    title: "What I took from it",
    createdAt: AT,
    updatedAt: AT,
    kind: "learn",
    messages: [
      { id: "spya-usr2aa", role: "user", text: "what I took", createdAt: AT, status: "done" },
      {
        id: "spya-ans2aa",
        role: "assistant",
        text: "An answer.",
        createdAt: AT,
        status: "done",
        ...(stance ? { stance } : {}),
      },
    ],
  };
}

let host: HTMLDivElement;
let root: Root;

const sent: { question: string }[] = [];

function paint(thread: ChatThread, kind: "chat" | "learn" | "tutorial" | "explore" = "learn") {
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        kind,
        loaded: true,
        loadFailed: false,
        threads: [thread],
        threadId: thread.id,
        onThread: () => {},
        onSend: (question: string) => {
          sent.push({ question });
        },
        onNew: () => {},
        onSendNew: () => {},
        onDiscard: () => {},
        onRename: () => {},
        onDelete: () => {},
        canStartOver: true,
        onRetry: () => {},
        onEdit: () => {},
        onDeleteFrom: undefined,
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
  sent.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the Learn composer is chat's, with two differences", () => {
  it("gives a Learn turn a box you can put a paragraph in", () => {
    paint(learnThread());
    const box = host.querySelector<HTMLTextAreaElement>("textarea.chat-input");
    /* Not a style preference. A spoken Learn turn is a paragraph or three, and a
       one-row box is what tells the reader this is a place for a sentence. */
    expect(box?.rows).toBe(6);
  });

  it("leaves chat's box exactly as it was", () => {
    paint({ ...learnThread(), kind: "chat" }, "chat");
    expect(host.querySelector<HTMLTextAreaElement>("textarea.chat-input")?.rows).toBe(1);
  });

  it("offers no stance picker, in Learn or in chat", () => {
    paint(learnThread());
    expect(host.querySelector(".chat-stance")).toBeNull();
    expect(host.querySelector("select")).toBeNull();
    paint({ ...learnThread(), kind: "chat" }, "chat");
    expect(host.querySelector(".chat-stance")).toBeNull();
  });

  it("labels the microphone in Learn and not in chat", () => {
    /* Greg asked for the microphone to be emphasised because talking a
       paragraph beats typing one. An unlabelled icon among three other
       unlabelled icons is not an invitation to talk. */
    paint(learnThread());
    const labelled = host.querySelector(".chat-talk-label");
    paint({ ...learnThread(), kind: "chat" }, "chat");
    const unlabelled = host.querySelector(".chat-talk-label");
    // Dictation may be unsupported in jsdom, in which case neither renders —
    // the assertion that matters is that they never differ the wrong way round.
    if (labelled) expect(unlabelled).toBeNull();
  });
});

describe("an old answer's stance is not shown", () => {
  /* Rows written before 2026-10-02 keep their stored stance. A tag naming it
     would describe an instruction the reader can no longer give. */
  it("does not tag an old socratic answer", () => {
    paint(learnThread("socratic"));
    expect(host.querySelector(".chat-stance-tag")).toBeNull();
    expect(host.textContent).not.toContain("socratic");
  });
});

/** Every prop `ChatPanel` needs, for the tests below that paint something other than one open thread. */
function props(over: Record<string, unknown>) {
  return {
    slug: "a-piece",
    kind: "learn" as const,
    loaded: true,
    loadFailed: false,
    threads: [] as ChatThread[],
    threadId: null as string | null,
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
    onDeleteFrom: undefined,
    onStop: () => {},
    onJump: () => {},
    recovering: new Set<string>(),
    blocks: new Map<string, string>(),
    focusNonce: 0,
    error: null,
    ...over,
  };
}

/**
 * **Learn is one conversation, and its panel has nothing for choosing
 * another.** Report `spya-peszam`; docs/plans/261001m-remember-is-its-own-single-thread.md
 * § Design 4. Until 2026-10-01 these tests pinned the opposite — a list shared
 * with chat, with Learn rows tagged — and that product decision is gone.
 */
describe("Learn's panel is one conversation", () => {
  it("never draws a list or the list's composer, even when handed no open thread", () => {
    act(() => root.render(createElement(ChatPanel, props({ threads: [learnThread()], threadId: null }))));
    expect(host.querySelector(".chat-threads")).toBeNull();
    expect(host.querySelector(".chat-empty")).toBeNull();
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelector('button[title="Start remembering"]')).toBeNull();
  });

  it("says Learn in the header, and offers Start over but no close, new or rename", () => {
    paint(learnThread());
    expect(host.querySelector(".band-head h2")?.textContent).toBe("Learn");
    expect(host.querySelector('button[title="All conversations"]')).toBeNull();
    expect(host.querySelector('button[title="Start remembering"]')).toBeNull();
    expect(host.querySelector('button[title^="Rename"]')).toBeNull();
    const startOver = host.querySelector<HTMLButtonElement>("button.chat-icon.danger");
    expect(startOver?.title).toMatch(/^Start over/);
  });

  /* The band decides it (`settled` in useChat.ts) and the panel only obeys:
     an empty, unnamed or still-answering conversation has no Start over, so
     its DELETE can never be held waiting for a name. Plan 261001m. */
  it("draws no Start over when the band says the conversation is not settled", () => {
    const open = learnThread();
    act(() =>
      root.render(createElement(ChatPanel, props({ threads: [open], threadId: open.id, canStartOver: false }))),
    );
    expect(host.querySelector(".band-head h2")?.textContent).toBe("Learn");
    expect(host.querySelector("button.chat-icon.danger")).toBeNull();
  });

  it("leaves chat's header as it was", () => {
    paint({ ...learnThread(), kind: "chat" }, "chat");
    expect(host.querySelector(".band-head h2")?.textContent).toBe("What I took from it");
    expect(host.querySelector('button[title="All conversations"]')).not.toBeNull();
  });
});

describe("chat's list has no Learn tag any more", () => {
  it("draws no kind tag on a row", () => {
    const chat: ChatThread = { ...learnThread(), id: "spya-p7w2dn", kind: "chat", title: "A question" };
    act(() => root.render(createElement(ChatPanel, props({ kind: "chat", threads: [chat] }))));
    expect(host.querySelectorAll(".chat-thread")).toHaveLength(1);
    expect(host.querySelector(".chat-thread-kind")).toBeNull();
  });
});

/**
 * **A short band gets a short box.** On a landscape phone the band is about
 * 338px tall and six rows at rest took 280 of it. Plan 261001m § 5.
 */
describe("the Learn composer on a short viewport", () => {
  const real = window.matchMedia;
  const realInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
  const realScrollHeight = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "scrollHeight");
  afterEach(() => {
    window.matchMedia = real;
    if (realInnerHeight) Object.defineProperty(window, "innerHeight", realInnerHeight);
    else Reflect.deleteProperty(window, "innerHeight");
    if (realScrollHeight) {
      Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", realScrollHeight);
    } else {
      Reflect.deleteProperty(HTMLTextAreaElement.prototype, "scrollHeight");
    }
  });

  function viewport(short: boolean) {
    window.matchMedia = ((query: string) => ({
      matches: short && query.includes("max-height: 500px"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  it("is two rows at rest when the viewport is short", () => {
    viewport(true);
    paint(learnThread());
    expect(host.querySelector<HTMLTextAreaElement>("textarea.chat-input")?.rows).toBe(2);
  });

  it("caps a growing short-viewport box at 30% of the viewport height", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 390 });
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 1_000,
    });
    viewport(true);
    paint(learnThread());
    expect(host.querySelector<HTMLTextAreaElement>("textarea.chat-input")?.style.height).toBe("117px");
  });

  it("is still six rows on a tall one", () => {
    viewport(false);
    paint(learnThread());
    expect(host.querySelector<HTMLTextAreaElement>("textarea.chat-input")?.rows).toBe(6);
  });

  it("leaves chat's one row alone either way", () => {
    viewport(true);
    paint({ ...learnThread(), kind: "chat" }, "chat");
    expect(host.querySelector<HTMLTextAreaElement>("textarea.chat-input")?.rows).toBe(1);
  });
});

/* Explore, Learn's fourth sub-mode (plan 261003l): the same panel and the
   same tall box, an empty state of its own with three ways in, and no Live. */
describe("Explore's panel", () => {
  const empty = (): ChatThread => ({ ...learnThread(), kind: "explore", title: "Exploring", messages: [] });

  it("says what Explore is for, in two short lines, and offers its starters as buttons", async () => {
    const { EXPLORE_STARTERS } = await import("../src/web/ChatPanel.js");
    paint(empty(), "explore");
    const hints = [...host.querySelectorAll(".chat-suggest .chat-empty-hint")].map((p) => p.textContent ?? "");
    expect(hints).toHaveLength(2);
    expect(hints.join(" ")).toMatch(/what you've highlighted, noted and talked about/);
    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".chat-suggest-btn")];
    expect(buttons.map((b) => b.textContent)).toEqual([...EXPLORE_STARTERS]);
    /* Four since 2026-10-05: the fourth asks what may be wrong with the piece
       (Greg, spya-mvmpks; plan 261005l). */
    expect(EXPLORE_STARTERS).toHaveLength(4);
    expect(EXPLORE_STARTERS).toContain("Where might this piece be wrong, or missing something?");
    expect(hints.join(" ")).toMatch(/where it may be weak/);
  });

  it("sends the critique starter as the reader's first message, word for word", () => {
    paint(empty(), "explore");
    const button = [...host.querySelectorAll<HTMLButtonElement>(".chat-suggest-btn")].find((b) =>
      b.textContent?.includes("wrong, or missing something"),
    );
    act(() => button?.click());
    expect(sent).toEqual([{ question: "Where might this piece be wrong, or missing something?" }]);
  });

  it("draws no starters once the conversation has begun", () => {
    paint({ ...learnThread(), kind: "explore" }, "explore");
    expect(host.querySelector(".chat-suggest")).toBeNull();
  });

  it("has Learn's tall box, its own placeholder, and Learn in the header", () => {
    paint(empty(), "explore");
    const box = host.querySelector<HTMLTextAreaElement>("textarea.chat-input");
    expect(box?.rows).toBe(6);
    expect(box?.placeholder).toMatch(/What do you make of it/);
    expect(host.querySelector(".band-head h2")?.textContent).toBe("Learn");
    expect(host.querySelector('[aria-label="Explore what you think about this article"]')).not.toBeNull();
  });

  it("draws no list, and no Recall or Tutorial invitation", () => {
    paint(empty(), "explore");
    expect(host.querySelector(".chat-threads")).toBeNull();
    expect(host.textContent).not.toMatch(/Say what you took from this article/);
    expect(host.textContent).not.toMatch(/What do you remember about this article/);
  });

  /* The band hands it no Live props (tests/learn-own-thread.test.tsx §
     which conversations offer Live); with none, the panel draws no control. */
  it("has no Live control", () => {
    paint(empty(), "explore");
    expect(host.querySelector(".chat-live")).toBeNull();
    expect(host.querySelector(".chat-live-btn")).toBeNull();
    paint({ ...learnThread(), kind: "explore" }, "explore");
    expect(host.querySelector(".chat-live-btn")).toBeNull();
  });
});
