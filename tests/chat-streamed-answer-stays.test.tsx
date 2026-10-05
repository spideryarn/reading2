// @vitest-environment jsdom
/**
 * **A streamed answer stays where it starts.**
 *
 * Greg, 2026-10-05 (`spya-nq847n`): *"it immediately starts scrolling down so I
 * can't read from the beginning of the response. What I would prefer is if it
 * streams in, but stays in position."* `Conversation` used to set
 * `scrollTop = scrollHeight` on every streamed word. Now a send puts the
 * question at the top of the panel once, with room under it, and nothing the
 * stream does moves the transcript after that.
 * docs/plans/261005f-a-streamed-answer-stays-where-it-starts.md.
 *
 * jsdom lays nothing out, so this file is a small layout engine: each turn has
 * a height the test sets, the scroller's `scrollHeight` is their sum plus the
 * room's own styled height, `scrollTop` clamps as a browser's does, and every
 * `getBoundingClientRect` is worked out from those. The first test is the
 * control that the engine is what the component reads.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ChatMessage, ChatThread, ToolRun } from "../src/types.js";
import type { LiveApi } from "../src/web/live/useLiveConversation.js";
import { holdTarget, LONG_QUESTION, roomNeeded } from "../src/web/chat-hold.js";

const { Conversation } = await import("../src/web/ChatPanel.js");

const AT = "2026-10-05T07:17:00.000Z";
const LATER = "2026-10-05T07:18:00.000Z";
const message = (
  id: string,
  role: ChatMessage["role"],
  text: string,
  status: ChatMessage["status"] = "done",
  more: Partial<ChatMessage> = {},
): ChatMessage => ({ id, role, text, createdAt: AT, status, ...more });
const thread = (messages: ChatMessage[]): ChatThread => ({
  kind: "chat",
  id: "spya-h0ld01",
  title: "New chat",
  createdAt: AT,
  updatedAt: AT,
  messages,
});

/** The panel: 400px of transcript on screen. */
const CLIENT = 400;
/** What the panel is short by while something (the "Latest" pill) takes a row. */
let taken = 0;
/** The scroller's resize observer, which jsdom does not have. */
let resized: (() => void) | null = null;
/** Each turn's height, in the order they are drawn. */
let heights: number[] = [];
/** The tool strip's height inside the last answer, when it has one. */
let strip = 0;

let host: HTMLDivElement;
let root: Root;
const tops = new WeakMap<Element, number>();
const restore: (() => void)[] = [];

const isScroller = (el: Element) => el.classList.contains("chat-scroll");
const roomOf = (el: Element) =>
  Number.parseFloat(el.querySelector<HTMLElement>(".chat-room")?.style.height ?? "") || 0;
const natural = () => heights.reduce((sum, h) => sum + h, 0);

function layOut(): void {
  const define = (proto: object, name: string, descriptor: PropertyDescriptor) => {
    const before = Object.getOwnPropertyDescriptor(proto, name);
    Object.defineProperty(proto, name, { configurable: true, ...descriptor });
    restore.push(() => {
      if (before) Object.defineProperty(proto, name, before);
      else delete (proto as Record<string, unknown>)[name];
    });
  };
  const proto = HTMLElement.prototype;
  define(proto, "scrollHeight", {
    get(this: HTMLElement) {
      return isScroller(this) ? natural() + roomOf(this) : 0;
    },
  });
  define(proto, "clientHeight", {
    get(this: HTMLElement) {
      return isScroller(this) ? CLIENT - taken : 0;
    },
  });
  define(proto, "offsetHeight", {
    get(this: HTMLElement) {
      return this.classList.contains("chat-room") ? Number.parseFloat(this.style.height) || 0 : 0;
    },
  });
  define(proto, "scrollTop", {
    get(this: HTMLElement) {
      if (!isScroller(this)) return tops.get(this) ?? 0;
      /* A browser clamps on read too: content that shrank has already moved it. */
      return Math.max(0, Math.min(tops.get(this) ?? 0, natural() + roomOf(this) - (CLIENT - taken)));
    },
    set(this: HTMLElement, v: number) {
      tops.set(this, isScroller(this) ? Math.max(0, Math.min(v, natural() + roomOf(this) - (CLIENT - taken))) : v);
    },
  });
  define(Element.prototype, "getBoundingClientRect", {
    value(this: Element) {
      const box = this.closest(".chat-scroll");
      let top = 0;
      if (box && this !== box) {
        const turns = [...box.querySelectorAll(":scope > [data-turn]")];
        const turn = this.closest("[data-turn]");
        const i = turn ? turns.indexOf(turn) : -1;
        if (i >= 0) {
          top = heights.slice(0, i).reduce((sum, h) => sum + h, 0) - (box as HTMLElement).scrollTop;
          /* Anything inside the last answer but its tool strip sits under the strip. */
          if (this !== turn && i === turns.length - 1 && !this.classList.contains("chat-tools")) top += strip;
        }
      }
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) };
    },
  });
}

function paint(
  messages: ChatMessage[],
  more: { sized?: "fixed" | "content"; live?: LiveApi; visible?: boolean } = {},
): void {
  act(() => {
    root.render(
      createElement(Conversation, {
        slug: "a-piece",
        thread: thread(messages),
        onJump: () => {},
        recovering: new Set<string>(),
        blocks: new Map<string, string>(),
        onSend: () => {},
        onRetry: () => {},
        onEdit: () => {},
        onStop: () => {},
        focusNonce: 0,
        focused: { current: 0 },
        draft: "",
        onDraft: () => {},
        kind: "chat",
        ...more,
      }),
    );
  });
}

function scroller(): HTMLElement {
  const el = host.querySelector<HTMLElement>(".chat-scroll");
  if (!el) throw new Error("no .chat-scroll");
  return el;
}
const pill = () => host.querySelector<HTMLButtonElement>(".chat-to-bottom");
function readerScrollsTo(top: number): void {
  act(() => {
    scroller().scrollTop = top;
    scroller().dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

const EARLIER = [message("spya-u00001", "user", "first"), message("spya-a00001", "assistant", "an earlier answer")];
const asked = (text: string, status: ChatMessage["status"] = "pending", more: Partial<ChatMessage> = {}) => [
  ...EARLIER,
  message("spya-u00002", "user", "and then?"),
  message("spya-a00002", "assistant", text, status, more),
];
/** An earlier question (100) and a long answer (800); the question is then at 900. */
const QUESTION_TOP = 900;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  taken = 0;
  resized = null;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    constructor(seen: () => void) {
      resized = seen;
    }
    observe() {}
    disconnect() {}
  };
  restore.push(() => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  });
  layOut();
  heights = [100, 800];
  strip = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  while (restore.length) restore.pop()?.();
});

describe("the arithmetic", () => {
  it("puts the question at the top, less the scroller's padding", () => {
    expect(holdTarget({ questionTop: 900, answerTop: 960, clientHeight: 400, pad: 11 })).toBe(889);
  });
  it("puts a long question's answer part-way down instead", () => {
    expect(holdTarget({ questionTop: 900, answerTop: 1200, clientHeight: 400, pad: 11 })).toBe(
      1200 - 400 * LONG_QUESTION,
    );
  });
  it("holds an answer nobody asked for by its own top, and never above zero", () => {
    expect(holdTarget({ questionTop: null, answerTop: 300, clientHeight: 400, pad: 11 })).toBe(289);
    expect(holdTarget({ questionTop: 5, answerTop: 60, clientHeight: 400, pad: 11 })).toBe(0);
  });
  it("asks for exactly the room that makes the target reachable, and none once the answer fills the panel", () => {
    expect(roomNeeded({ target: 900, clientHeight: 400, naturalHeight: 990 })).toBe(310);
    expect(roomNeeded({ target: 900, clientHeight: 400, naturalHeight: 1300 })).toBe(0);
    expect(roomNeeded({ target: 900, clientHeight: 400, naturalHeight: 2000 })).toBe(0);
    expect(roomNeeded({ target: 0, clientHeight: 400, naturalHeight: 100 }), "the top is always reachable").toBe(0);
  });
});

describe("a typed answer in a panel of fixed height", () => {
  it("control: a finished conversation opens at its end", () => {
    paint(EARLIER);
    expect(scroller().scrollTop).toBe(900 - CLIENT);
    expect(roomOf(scroller())).toBe(0);
  });

  it("puts a just-asked question at the top, with room under it", () => {
    paint(EARLIER);
    heights = [100, 800, 60, 30];
    paint(asked(""));
    expect(scroller().scrollTop, "the question's top is the panel's top").toBe(QUESTION_TOP);
    expect(roomOf(scroller()), "exactly enough for that to be reachable").toBe(QUESTION_TOP + CLIENT - 990);
    expect(pill(), "and that is the bottom, so there is nothing to jump to").toBeNull();
  });

  it("does not move as the words arrive, and offers Latest once they pass the fold", () => {
    paint(EARLIER);
    heights = [100, 800, 60, 30];
    paint(asked(""));
    heights = [100, 800, 60, 200];
    paint(asked("The first sentence."));
    expect(scroller().scrollTop).toBe(QUESTION_TOP);
    expect(roomOf(scroller()), "the room shrinks as the answer grows into it").toBe(140);
    expect(pill()).toBeNull();

    heights = [100, 800, 60, 900];
    paint(asked("The first sentence. And a great deal more."));
    expect(scroller().scrollTop, "the answer outgrew the panel and the view stayed").toBe(QUESTION_TOP);
    expect(roomOf(scroller())).toBe(0);
    expect(pill(), "so there is more below, and a way to it").not.toBeNull();
  });

  it("does not move when the answer finishes and grows its action row and sources", () => {
    paint(EARLIER);
    heights = [100, 800, 60, 300];
    paint(asked("An answer."));
    heights = [100, 800, 60, 520];
    paint(asked("An answer.", "done"));
    expect(scroller().scrollTop).toBe(QUESTION_TOP);
  });

  it("Latest jumps to the end once, and does not start following", () => {
    paint(EARLIER);
    heights = [100, 800, 60, 900];
    paint(asked("A long answer."));
    act(() => pill()?.click());
    expect(scroller().scrollTop).toBe(1860 - CLIENT);
    expect(pill()).toBeNull();

    heights = [100, 800, 60, 1400];
    paint(asked("A long answer, and longer."));
    expect(scroller().scrollTop, "the next words did not drag the view").toBe(1860 - CLIENT);
    expect(pill(), "and the pill is back, because the end moved away").not.toBeNull();
  });

  it("leaves a reader who scrolled away where they went", () => {
    paint(EARLIER);
    heights = [100, 800, 60, 300];
    paint(asked("An answer."));
    readerScrollsTo(200);
    heights = [100, 800, 60, 700];
    paint(asked("An answer, continuing."));
    expect(scroller().scrollTop).toBe(200);
  });

  it("gives a long question's answer its first line on screen", () => {
    paint(EARLIER);
    heights = [100, 800, 300, 30];
    paint(asked(""));
    expect(scroller().scrollTop).toBe(QUESTION_TOP + 300 - CLIENT * LONG_QUESTION);
  });

  it("does not place again when the server's begin frame renames the answer mid-stream", () => {
    paint(EARLIER);
    heights = [100, 800, 60, 300];
    paint(asked("An answer."));
    readerScrollsTo(700);
    heights = [100, 800, 60, 500];
    paint([
      ...EARLIER,
      message("spya-u9srv2", "user", "and then?"),
      message("spya-a9srv2", "assistant", "An answer, continuing.", "pending", { createdAt: LATER }),
    ]);
    expect(scroller().scrollTop).toBe(700);
  });

  it("places again on Retry, which keeps the answer's id", () => {
    paint(EARLIER);
    heights = [100, 800, 60, 900];
    paint(asked("A long answer.", "done"));
    readerScrollsTo(1860 - CLIENT);
    heights = [100, 800, 60, 30];
    paint(asked("", "pending", { createdAt: LATER }));
    expect(scroller().scrollTop).toBe(QUESTION_TOP);
  });

  it("places an Edit's new answer, which discards the turns under the question", () => {
    paint(asked("The old answer.", "done"));
    heights = [70, 30];
    paint([
      message("spya-u00001", "user", "first, reworded", "done", { editedAt: LATER }),
      message("spya-a00003", "assistant", "", "pending"),
    ]);
    expect(scroller().scrollTop).toBe(0);
    expect(roomOf(scroller()), "a transcript shorter than the panel needs none").toBe(0);
  });

  it("places an answer already arriving when the conversation is opened", () => {
    heights = [100, 800, 60, 300];
    paint(asked("Half an answer."));
    expect(scroller().scrollTop).toBe(QUESTION_TOP);
  });

  it("keeps the line being read still when a tool row arrives above it", () => {
    const run = (status: ToolRun["status"]): ToolRun => ({ name: "search_library", label: "searched your library", status });
    paint(EARLIER);
    heights = [100, 800, 60, 300];
    paint(asked("Let me check."));
    expect(scroller().scrollTop).toBe(QUESTION_TOP);

    strip = 40;
    heights = [100, 800, 60, 340];
    paint(asked("Let me check.", "pending", { tools: [run("running")] }));
    expect(host.querySelector(".chat-tools"), "the strip is drawn").not.toBeNull();
    expect(scroller().scrollTop, "the text moved 40 down its turn, so the view went with it").toBe(QUESTION_TOP + 40);

    heights = [100, 800, 60, 600];
    paint(asked("Let me check. Here it is.", "pending", { tools: [run("done")] }));
    expect(scroller().scrollTop, "and then stays").toBe(QUESTION_TOP + 40);
  });

  it("does not shift for a tool row that arrives before any words", () => {
    const tools: ToolRun[] = [{ name: "search_library", label: "searched your library", status: "running" }];
    paint(EARLIER);
    heights = [100, 800, 60, 30];
    paint(asked(""));
    strip = 40;
    heights = [100, 800, 60, 70];
    paint(asked("", "pending", { tools }));
    expect(scroller().scrollTop).toBe(QUESTION_TOP);
  });

  it("keeps the line being read still when the question above it grows", () => {
    paint(EARLIER);
    heights = [100, 800, 60, 300];
    paint(asked("An answer."));
    heights = [100, 800, 87, 300];
    paint(asked("An answer.", "done"));
    expect(scroller().scrollTop).toBe(QUESTION_TOP + 27);
  });

  it("does not move a reader who is above the answer when it changes below them", () => {
    paint(EARLIER);
    heights = [100, 800, 60, 300];
    paint(asked("An answer."));
    readerScrollsTo(100);
    strip = 40;
    heights = [100, 800, 60, 340];
    paint(asked("An answer.", "pending", {
      tools: [{ name: "search_library", label: "searched your library", status: "running" }],
    }));
    expect(scroller().scrollTop).toBe(100);
  });

  it("puts the question back when the panel grows taller and the browser clamps it", () => {
    /* The pill's row is in the way when the question is sent... */
    taken = 36;
    paint(EARLIER);
    heights = [100, 800, 60, 30];
    paint(asked(""));
    expect(scroller().scrollTop).toBe(QUESTION_TOP);
    /* ...and then it goes: the panel is 36 taller, and the room, sized for the
       shorter one, lets the browser clamp. The observer puts it right. */
    taken = 0;
    expect(scroller().scrollTop, "control: the model clamps as a browser does").toBe(QUESTION_TOP - 36);
    act(() => resized?.());
    expect(scroller().scrollTop).toBe(QUESTION_TOP);
    expect(roomOf(scroller())).toBe(310);
  });

  it("does not shrink the room out from under a reader who scrolled down into it", () => {
    paint(EARLIER);
    heights = [100, 800, 60, 30];
    paint(asked(""));
    heights = [100, 800, 60, 600];
    paint(asked("A long answer."));
    readerScrollsTo(1560 - CLIENT);
    heights = [100, 800, 60, 620];
    paint(asked("A long answer, more."));
    expect(scroller().scrollTop).toBe(1560 - CLIENT);
  });

  it("puts the question back after the panel was hidden, which loses a scroll position", () => {
    paint(EARLIER);
    heights = [100, 800, 60, 300];
    paint(asked("An answer."));
    readerScrollsTo(950);
    paint(asked("An answer."), { visible: false });
    scroller().scrollTop = 0;
    paint(asked("An answer."), { visible: true });
    expect(scroller().scrollTop).toBe(QUESTION_TOP);
  });
});

describe("the card, whose height is its content's up to a cap", () => {
  it("gets no room below its cap, and does not follow", () => {
    /* A short card: 150 of transcript, nothing to scroll. */
    heights = [60, 90];
    paint(EARLIER, { sized: "content" });
    heights = [60, 90, 60, 30];
    paint(asked(""), { sized: "content" });
    expect(roomOf(scroller()), "room would inflate the card").toBe(0);
    expect(scroller().scrollTop).toBe(0);

    /* It reaches its cap and the answer passes it. */
    heights = [60, 90, 60, 700];
    paint(asked("A long answer."), { sized: "content" });
    expect(scroller().scrollTop, "never followed").toBe(0);
    expect(roomOf(scroller()), "and a target it never reached asks for nothing later").toBe(0);
    expect(pill()).not.toBeNull();
  });

  it("gets room at its cap, where room costs nothing", () => {
    paint(EARLIER, { sized: "content" });
    heights = [100, 800, 60, 30];
    paint(asked(""), { sized: "content" });
    expect(scroller().scrollTop).toBe(QUESTION_TOP);
    expect(roomOf(scroller())).toBe(310);
  });
});

describe("a Live conversation", () => {
  const speaking = (text: string): LiveApi =>
    ({
      phase: "live",
      step: null,
      error: null,
      lines: [{ id: "item_1", role: "companion", text, done: false, exchange: "item_1", session: 0, order: 0 }],
      hasUnsavedLines: false,
      pointers: [],
      tools: [],
      pendingTools: [],
      inputLevel: { current: 0 },
      seen: {},
      talkMode: "open",
      threadId: "spya-h0ld01",
      stop: async () => {},
    }) as unknown as LiveApi;

  it("retires a typed answer's hold: spoken words are followed, as before", () => {
    paint(EARLIER);
    heights = [100, 800, 60, 200];
    paint(asked("A typed answer."));
    paint(asked("A typed answer.", "done"));
    expect(roomOf(scroller()), "held, with room").toBe(140);
    expect(scroller().scrollTop).toBe(QUESTION_TOP);

    /* The spoken line is not a turn: it only makes the transcript taller. */
    heights = [100, 800, 60, 500];
    paint(asked("A typed answer.", "done"), { live: speaking("Spoken words, arriving.") });
    expect(roomOf(scroller()), "the room goes with the hold").toBe(0);
    expect(scroller().scrollTop, "and the bottom is followed").toBe(1460 - CLIENT);
  });
});
