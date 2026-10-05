// @vitest-environment jsdom
/**
 * **An empty conversation reads from the top**, and the full-screen Sketch
 * leaves a backdrop to click.
 *
 * Two small layout bugs found on one browser pass (plan 261001l) and fixed
 * together in docs/plans/261001n-chat-suggestions-read-from-the-top-and-the-sketch-overlay-leaves-a-backdrop.md.
 *
 * 1. Chat's follow-the-bottom effect ran on an empty thread too, so on a
 *    landscape phone, where 308px of suggestions sit in a 207px scroller, the
 *    opening hint and the first question were scrolled off the top on mount.
 *    jsdom lays nothing out, so its scroll geometry is zero even though an
 *    assigned `scrollTop` is remembered. The test supplies the geometry and
 *    browser-like clamping below. The thread-with-turns case is the control: it
 *    proves the supplied geometry is what the effect reads.
 *
 * 2. `.sk-in-full` is also `.sk`, which is `flex: 1`, and a non-`auto`
 *    flex-basis beats `width` in the dialog's flex row — so the panel was as
 *    wide as the window. `.ill-in-full` had the same trap and the same fix;
 *    this holds both. Only a stylesheet check is possible in jsdom; the widths
 *    were measured in Playwright (see the plan).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage, ChatThread } from "../src/types.js";
import { readerSheets, stripComments } from "./helpers/stylesheets.js";

const chatDialogState = vi.hoisted(() => ({ threads: [] as ChatThread[] }));
vi.mock("../src/web/useChat.js", () => ({
  useChat: () => ({
    threads: chatDialogState.threads,
    loaded: true,
    loadFailed: false,
    recovering: new Set<string>(),
    send: () => "spya-new001",
    retry: () => {},
    edit: () => {},
    stop: () => {},
    cancelAndDiscard: () => {},
    remove: () => {},
    error: null,
  }),
}));

const { ChatPanel } = await import("../src/web/ChatPanel.js");
const { ChatDialog } = await import("../src/web/ChatDialog.js");

const AT = "2026-10-01T12:00:00.000Z";
const message = (
  id: string,
  role: ChatMessage["role"],
  text: string,
  status: ChatMessage["status"] = "done",
): ChatMessage => ({
  id,
  role,
  text,
  createdAt: AT,
  status,
});
const thread = (
  messages: ChatMessage[],
  id = "spya-r7tq2w",
  kind: ChatThread["kind"] = "chat",
): ChatThread => ({
  kind,
  id,
  title: "New chat",
  createdAt: AT,
  updatedAt: AT,
  messages,
});

/** A landscape phone's chat scroller, as measured: 345px of content in 207. */
const SCROLL_HEIGHT = 345;
const CLIENT_HEIGHT = 207;
let measuredScrollHeight = SCROLL_HEIGHT;

let host: HTMLDivElement;
let root: Root;
const scrollTops = new WeakMap<Element, number>();
const restore: (() => void)[] = [];

/** Give `.chat-scroll` measured geometry and browser-like, clamped scrolling. */
function layOut(): void {
  const proto = HTMLElement.prototype;
  const define = (name: string, descriptor: PropertyDescriptor) => {
    const before = Object.getOwnPropertyDescriptor(proto, name);
    Object.defineProperty(proto, name, { configurable: true, ...descriptor });
    restore.push(() => {
      if (before) Object.defineProperty(proto, name, before);
      else delete (proto as unknown as Record<string, unknown>)[name];
    });
  };
  const isScroller = (el: Element) => el.classList.contains("chat-scroll");
  define("scrollHeight", {
    get(this: HTMLElement) {
      return isScroller(this) ? measuredScrollHeight : 0;
    },
  });
  define("clientHeight", {
    get(this: HTMLElement) {
      return isScroller(this) ? CLIENT_HEIGHT : 0;
    },
  });
  define("scrollTop", {
    get(this: HTMLElement) {
      return scrollTops.get(this) ?? 0;
    },
    set(this: HTMLElement, v: number) {
      scrollTops.set(
        this,
        isScroller(this)
          ? Math.max(0, Math.min(v, measuredScrollHeight - CLIENT_HEIGHT))
          : v,
      );
    },
  });
}

function paint(t: ChatThread): void {
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        kind: t.kind === "remember" ? "remember" as const : "chat" as const,
        loaded: true,
        loadFailed: false,
        threads: [t],
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

function paintDialog(threadId: string): void {
  act(() => {
    root.render(
      createElement(ChatDialog, {
        slug: "a-piece",
        target: { kind: "thread" as const, threadId },
        at: null,
        blocks: new Map<string, string>(),
        onJump: () => {},
        onClose: () => {},
        onThread: () => {},
        onOpenFull: () => {},
        onCreated: () => {},
        onDropped: () => {},
      }),
    );
  });
}

function scroller(): HTMLElement {
  const el = host.querySelector<HTMLElement>(".chat-scroll");
  if (!el) throw new Error("no .chat-scroll");
  return el;
}

describe("an empty conversation on a short band", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    layOut();
    measuredScrollHeight = SCROLL_HEIGHT;
    chatDialogState.threads = [];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    while (restore.length) restore.pop()?.();
  });

  it("control: a conversation with turns opens at its latest turn", () => {
    paint(thread([message("spya-m1u001", "user", "q"), message("spya-m1a001", "assistant", "a")]));
    expect(scroller().scrollTop).toBe(SCROLL_HEIGHT - CLIENT_HEIGHT);
  });

  it("opens with the hint and the first suggestion at the top, not scrolled past", () => {
    paint(thread([]));
    expect(host.querySelector(".chat-suggest")).not.toBeNull();
    expect(scroller().scrollTop).toBe(0);
  });

  it("offers no Latest pill while the reader scrolls through the suggestions", () => {
    paint(thread([]));
    const el = scroller();
    act(() => {
      el.scrollTop = 40;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(host.querySelector(".chat-to-bottom")).toBeNull();
  });

  it("control: the Latest pill does appear when a reader scrolls up a real conversation", () => {
    paint(thread([message("spya-m2u001", "user", "q"), message("spya-m2a001", "assistant", "a")]));
    const el = scroller();
    act(() => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(host.querySelector(".chat-to-bottom")).not.toBeNull();
  });

  /* Until 261005f this asserted the opposite: that the first answer was
     followed to the bottom, word by word. An answer is now held where it
     starts. This file gives turns no positions, so only the holding is
     checked here; where the question is put is
     tests/chat-streamed-answer-stays.test.tsx. */
  it("holds the pending first answer still as its text streams, after the reader scrolled through the suggestions", () => {
    paint(thread([]));
    const el = scroller();
    act(() => {
      el.scrollTop = 40;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    paint(
      thread([
        message("spya-m3u001", "user", "q"),
        message("spya-m3a001", "assistant", "", "pending"),
      ]),
    );
    const placed = scroller().scrollTop;

    measuredScrollHeight += 600;
    paint(
      thread([
        message("spya-m3u001", "user", "q"),
        message("spya-m3a001", "assistant", "The answer is arriving.", "pending"),
      ]),
    );
    expect(scroller().scrollTop).toBe(placed);
    expect(scroller().scrollTop).not.toBe(measuredScrollHeight - CLIENT_HEIGHT);
    expect(host.querySelector(".chat-to-bottom"), "and the pill says it runs on below").not.toBeNull();
  });

  it("reads an empty Remember invitation from the top without offering Latest", () => {
    paint(thread([], "spya-rem001", "remember"));
    expect(host.textContent).toContain("Say what you took from this article");
    const el = scroller();
    expect(el.scrollTop).toBe(0);
    act(() => {
      el.scrollTop = 40;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(host.querySelector(".chat-to-bottom")).toBeNull();
  });

  it("opens a different floating-dialog thread at its own latest turn", () => {
    const a = thread(
      [message("spya-m4u001", "user", "q"), message("spya-m4a001", "assistant", "a")],
      "spya-thr001",
    );
    const b = thread(
      [message("spya-m5u001", "user", "q"), message("spya-m5a001", "assistant", "b")],
      "spya-thr002",
    );
    chatDialogState.threads = [a, b];
    paintDialog(a.id);
    const first = scroller();
    act(() => {
      const box = host.querySelector<HTMLTextAreaElement>(".chat-composer textarea");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "A question for A");
      box?.dispatchEvent(new Event("input", { bubbles: true }));
      first.scrollTop = 0;
      first.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(host.querySelector(".chat-to-bottom")).not.toBeNull();

    /* Both threads have the same effect dependencies: message count, final
       text length and status. A remount, not a coincidental effect run, must
       give the second thread fresh follow state and a fresh scroller. */
    paintDialog(b.id);
    expect(scroller()).not.toBe(first);
    expect(scroller().scrollTop).toBe(SCROLL_HEIGHT - CLIENT_HEIGHT);
    expect(host.querySelector(".chat-to-bottom")).toBeNull();
    expect(host.querySelector<HTMLTextAreaElement>(".chat-composer textarea")?.value).toBe("");
  });
});

describe("a full-screen panel that also carries a `flex: 1` class", () => {
  /** Exact-selector rules, with their source sheet, in cascade order. */
  const rules = (selector: string): Array<{ path: string; declarations: string }> => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return readerSheets().flatMap(({ path, css }) =>
      [...stripComments(css).matchAll(new RegExp(`(?:^|[{}])\\s*${escaped}\\s*\\{([^}]*)\\}`, "g"))]
        .map((m) => ({ path, declarations: m[1] ?? "" })),
    );
  };

  for (const [panel, base, path] of [
    [".sk-in-full", ".sk", "src/web/styles/diagram-sketch.css"],
    [".ill-in-full", ".ill", "src/web/styles/diagram-illustrated.css"],
  ] as const) {
    it(`${panel} opts out of ${base}'s flex: 1, so its width applies`, () => {
      // The trap is only a trap while the base class grows; check it still does.
      expect(rules(base).map((rule) => rule.declarations).join(";")).toMatch(/flex:\s*1\b/);
      const panelRules = rules(panel);
      expect(panelRules).toHaveLength(1);
      expect(panelRules[0]?.path).toBe(path);
      expect(panelRules[0]?.declarations).toMatch(/width:\s*min\(94vw/);
      expect(panelRules[0]?.declarations).toMatch(/flex:\s*none/);
    });
  }
});
