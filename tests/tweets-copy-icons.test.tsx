// @vitest-environment jsdom
/**
 * **Tweets' copy buttons are icons, and a failed copy still says so in words.**
 *
 * > In tweet thread mode, we have a button to copy each tweet item. Let's just
 * > have the icon. I don't think we need the text copy. Maybe there's a
 * > tooltip. Perhaps the same for copy the thread.
 * >
 * > — Greg, 2026-09-30 (SPIDERYARN-READING2-6H)
 *
 * So: no visible label on either button, a stable accessible name, a status
 * that names what was copied, and — the one place words stay — a refused copy
 * shown as text, because a glyph swap alone is docs/reusable/silent-success.md.
 * docs/plans/260930h-tweets-band-fits-ipad-and-copy-buttons-become-icons.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicTweets } from "../src/public-types.js";
import type { Article } from "../src/types.js";
import { ThreadHead, ThreadPosts } from "../src/web/Tweets.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ARTICLE: Article = {
  meta: { slug: "s", title: "Writes and Write-Nots", url: "https://paulgraham.com/writes.html" },
  blocks: [],
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  highPowerSince: null,
  titleOverridden: false,
  tree: { rootId: "spya-root", nodes: {} } as unknown as Article["tree"],
};

const THREAD: PublicTweets = {
  limit: 280,
  tweets: [
    { text: "The first post.", chars: 15 },
    { text: "The second post.", chars: 16 },
  ],
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "clipboard");
});

function draw(): void {
  act(() => {
    root.render(
      createElement("div", null, [
        createElement(ThreadHead, { key: "c", thread: THREAD, article: ARTICLE }),
        createElement(ThreadPosts, { key: "p", thread: THREAD, onJump: () => {} }),
      ]),
    );
  });
}

function button(name: string): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")].filter((b) => b.getAttribute("aria-label") === name);
}

/** The words a sighted reader sees — everything but visually hidden text. */
function visibleText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll(".sr-only, .tw\\:sr-only")) hidden.remove();
  return clone.textContent?.trim() ?? "";
}

async function press(b: HTMLButtonElement): Promise<void> {
  await act(async () => {
    b.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Tweets' copy buttons", () => {
  it("draw an icon and no words, and are named for what they copy", async () => {
    draw();
    expect(button("Copy the thread")).toHaveLength(1);
    expect(button("Copy this post")).toHaveLength(2);
    for (const b of [...button("Copy the thread"), ...button("Copy this post")]) {
      expect(visibleText(b)).toBe("");
      expect(b.querySelector("svg")).not.toBeNull();
      expect(b.classList.contains("tw:size-6")).toBe(true);
      expect(b.classList.contains("tw:pointer-coarse:size-10")).toBe(true);
      const status = b.parentElement?.querySelector("[aria-live]");
      expect(status?.textContent).toBe("");
      expect(status?.getAttribute("aria-live")).toBe("polite");
      expect(status?.getAttribute("aria-atomic")).toBe("true");
      expect(status?.classList.contains("tw:sr-only")).toBe(true);
      // Our tooltip, not the OS's: two on one control race.
      expect(b.hasAttribute("title")).toBe(false);
    }

    // Focus exercises the props and ref Tooltip clones onto the shadcn Button.
    const thread = button("Copy the thread")[0];
    if (!thread) throw new Error("no thread button");
    expect(thread.hasAttribute("aria-describedby")).toBe(false);
    await act(async () => {
      thread.focus();
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    const describedBy = thread.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")?.textContent).toBe(
      "Copy the whole thread, each post numbered, with the article's title and link at the top",
    );
  });

  /* On a touch screen the tap's compatibility mouse events open the card and
     nothing closes it until the next tap elsewhere, so it sat over the post
     above (WebKit, iPad user agent, 2026-09-30). A press closes it; the tick or
     the words say what happened instead. */
  it("put the card away when pressed", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    draw();
    const post = button("Copy this post")[0];
    if (!post) throw new Error("no post button");
    await act(async () => {
      post.focus();
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    await press(post);
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("announce a copy that worked, naming what was copied, without drawing words", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    draw();
    const post = button("Copy this post")[1];
    if (!post) throw new Error("no second post button");
    await press(post);
    expect(writeText).toHaveBeenCalledWith("The second post.");
    expect(post.getAttribute("aria-label")).toBe("Copy this post");
    const status = post.parentElement?.querySelector("[aria-live]");
    expect(status?.textContent).toBe("Post copied");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.getAttribute("aria-atomic")).toBe("true");
    expect(status?.classList.contains("tw:sr-only")).toBe(true);
    expect(visibleText(post.parentElement as Element)).toBe("");
  });

  it("say a refused copy in words a sighted reader can see", async () => {
    // No clipboard object at all: an insecure origin, e.g. a LAN address on a phone.
    Reflect.deleteProperty(navigator, "clipboard");
    draw();
    const thread = button("Copy the thread")[0];
    if (!thread) throw new Error("no thread button");
    await press(thread);
    expect(thread.getAttribute("aria-label")).toBe("Copy the thread");
    const status = thread.parentElement?.querySelector("[aria-live]");
    expect(status?.textContent).toBe("Couldn't copy the thread");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.getAttribute("aria-atomic")).toBe("true");
    expect(status?.classList.contains("tw:sr-only")).toBe(false);
    expect(visibleText(thread.parentElement as Element)).toBe("Couldn't copy the thread");
    // And it goes back to quiet.
    act(() => vi.advanceTimersByTime(2000));
    expect(status?.textContent).toBe("");
    expect(status?.classList.contains("tw:sr-only")).toBe(true);
    expect(visibleText(thread.parentElement as Element)).toBe("");
  });
});

/**
 * **What the button says is about the newest press.** Both were red against
 * the hand-written handler this button had until 2026-10-04, which had no
 * per-press token and hung its timer off an effect keyed on the state. They
 * are `useCopy`'s now (plan 261004e, stage 3).
 */
describe("Tweets' copy buttons, pressed twice", () => {
  it("let the newest press win when an older one is refused afterwards", async () => {
    const settlers: Array<{ ok(): void; no(): void }> = [];
    const writeText = vi.fn(
      () =>
        new Promise<void>((ok, no) => {
          settlers.push({ ok, no: () => no(new Error("denied")) });
        }),
    );
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    draw();
    const post = button("Copy this post")[0];
    if (!post) throw new Error("no post button");
    await press(post);
    await press(post);
    expect(settlers).toHaveLength(2);
    const status = post.parentElement?.querySelector("[aria-live]");
    // Mid-flight it claims nothing.
    expect(status?.textContent).toBe("");

    await act(async () => {
      settlers[1]?.ok();
      await Promise.resolve();
    });
    expect(status?.textContent).toBe("Post copied");
    // The first press is refused after the second worked. The clipboard holds
    // the post, so "Couldn't copy" in red beside the button would be false.
    await act(async () => {
      settlers[0]?.no();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(status?.textContent).toBe("Post copied");
    expect(status?.classList.contains("tw:sr-only")).toBe(true);
    expect(visibleText(post.parentElement as Element)).toBe("");
    expect(post.querySelector("svg")?.getAttribute("class")).toContain("lucide-check");
  });

  it("give a second copy its own full time on screen", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    draw();
    const post = button("Copy this post")[0];
    if (!post) throw new Error("no post button");
    const status = post.parentElement?.querySelector("[aria-live]");
    const glyph = () => post.querySelector("svg")?.getAttribute("class") ?? "";
    await press(post);
    expect(status?.textContent).toBe("Post copied");

    // 1000 ms into a 1600 ms tick, copy again.
    act(() => vi.advanceTimersByTime(1000));
    await press(post);
    // 1000 ms later the first tick's timer has long run out. The second copy
    // is 1000 ms old and still has 600 ms to show.
    act(() => vi.advanceTimersByTime(1000));
    expect(status?.textContent).toBe("Post copied");
    expect(glyph()).toContain("lucide-check");
    // And it does go: 1700 ms after the second copy.
    act(() => vi.advanceTimersByTime(700));
    expect(status?.textContent).toBe("");
    expect(glyph()).toContain("lucide-copy");
  });
});
