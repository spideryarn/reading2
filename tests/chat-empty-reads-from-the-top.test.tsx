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
 *    jsdom lays nothing out and its `scrollTop` is always 0, so the scroller's
 *    geometry is supplied below. The thread-with-turns case is the control: it
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ChatMessage, ChatThread } from "../src/types.js";
import { readerCssNoComments } from "./helpers/stylesheets.js";

const { ChatPanel } = await import("../src/web/ChatPanel.js");

const AT = "2026-10-01T12:00:00.000Z";
const message = (id: string, role: ChatMessage["role"], text: string): ChatMessage => ({
  id,
  role,
  text,
  createdAt: AT,
  status: "done",
});
const thread = (messages: ChatMessage[]): ChatThread => ({
  kind: "chat",
  id: "spya-r7tq2w",
  title: "New chat",
  createdAt: AT,
  updatedAt: AT,
  messages,
});

/** A landscape phone's chat scroller, as measured: 345px of content in 207. */
const SCROLL_HEIGHT = 345;
const CLIENT_HEIGHT = 207;

let host: HTMLDivElement;
let root: Root;
const scrollTops = new WeakMap<Element, number>();
const restore: (() => void)[] = [];

/** Give `.chat-scroll` a height and a scrollTop that remembers what it was set to. */
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
      return isScroller(this) ? SCROLL_HEIGHT : 0;
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
      scrollTops.set(this, Math.max(0, Math.min(v, SCROLL_HEIGHT - CLIENT_HEIGHT)));
    },
  });
}

function paint(t: ChatThread): void {
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        kind: "chat" as const,
        stance: "balanced" as const,
        onStance: () => {},
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

function scroller(): HTMLElement {
  const el = host.querySelector<HTMLElement>(".chat-scroll");
  if (!el) throw new Error("no .chat-scroll");
  return el;
}

describe("an empty conversation on a short band", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    layOut();
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

  it("follows the first answer after the reader scrolled halfway down the suggestions", () => {
    paint(thread([]));
    const el = scroller();
    act(() => {
      el.scrollTop = 40;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    paint(thread([message("spya-m3u001", "user", "q")]));
    expect(scroller().scrollTop).toBe(SCROLL_HEIGHT - CLIENT_HEIGHT);
  });
});

describe("a full-screen panel that also carries a `flex: 1` class", () => {
  const css = readerCssNoComments();
  /** The declarations of every rule whose selector is exactly `selector`. */
  const declarations = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [...css.matchAll(new RegExp(`(?:^|[{}])\\s*${escaped}\\s*\\{([^}]*)\\}`, "g"))]
      .map((m) => m[1] ?? "")
      .join(";");
  };

  for (const [panel, base] of [
    [".sk-in-full", ".sk"],
    [".ill-in-full", ".ill"],
  ] as const) {
    it(`${panel} opts out of ${base}'s flex: 1, so its width applies`, () => {
      // The trap is only a trap while the base class grows; check it still does.
      expect(declarations(base)).toMatch(/flex:\s*1\b/);
      expect(declarations(panel)).toMatch(/width:\s*min\(94vw/);
      expect(declarations(panel)).toMatch(/flex:\s*none/);
    });
  }
});
