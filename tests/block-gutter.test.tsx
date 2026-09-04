// @vitest-environment jsdom
/**
 * What the prose gutter actually does when it is clicked — src/web/BlockGutter.tsx.
 *
 * The two pure helpers under it have their own tests (block-ref.test.ts,
 * comment-nav.test.ts) and **they were not enough**, which is the reason this
 * file exists. GPT Sol, reviewing the built code on 2026-08-31:
 *
 * > An implementation that always copied, copied on modified clicks, opened the
 * > last comment, used an optimistic tick, threw without Clipboard API support,
 * > or rendered no live region would pass.
 *
 * Every one of those is a test below. What is *not* here is geometry — target
 * sizes, the overhang, and the `(hover: none)` rules — because jsdom computes no
 * layout and would answer those questions with plausible zeroes. Those were
 * measured in a real browser and the numbers are in
 * docs/plans/prose-gutter-icons.md.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockGutter } from "../src/web/BlockGutter.js";
import type { BlockId, Comment } from "../src/types.js";

const ID = "spya-k3m9qt" as BlockId;

function comment(id: string, start: number, blockId = ID): Comment {
  return { id, blockId, start, quote: "q", createdAt: "2026-08-30T09:00:00Z", status: "none" };
}

let host: HTMLDivElement;
let root: Root;
let jumped: BlockId[];
let opened: string[];
let said: string[];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  jumped = [];
  opened = [];
  said = [];
  window.history.replaceState(null, "", "/read/example");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Reflect.deleteProperty(navigator as object, "clipboard");
  vi.useRealTimers();
});

function paint(comments?: Comment[], chatCount = 0): void {
  act(() => {
    root.render(
      <BlockGutter
        id={ID}
        linkBase="/read/example"
        {...(comments ? { comments } : {})}
        chatCount={chatCount}
        onOpenComment={(id) => opened.push(id)}
        onChatAbout={() => {}}
        onJump={(id) => jumped.push(id)}
        announce={(s) => said.push(s)}
      />,
    );
  });
}

/** A writable clipboard whose promise this test controls. */
function clipboard(writeText: (t: string) => Promise<void>): string[] {
  const wrote: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (t: string) => {
        wrote.push(t);
        return writeText(t);
      },
    },
  });
  return wrote;
}

const link = () => host.querySelector("a.blk-permalink") as HTMLAnchorElement;
const icon = () => link().querySelector("svg")?.getAttribute("class") ?? "";

/**
 * A click as a pointer makes one. `detail: 1` is the click count, and it is the
 * fallback the component reads because jsdom's `MouseEvent` has no
 * `pointerType`; a real browser supplies one and the browser checks confirmed
 * both arrive as expected.
 */
function click(el: Element, init: MouseEventInit = {}): MouseEvent {
  const e = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, ...init });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
}

/** Let a resolved/rejected clipboard promise settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("the permalink", () => {
  it("copies the ABSOLUTE url, not the href's path", async () => {
    const wrote = clipboard(() => Promise.resolve());
    paint();
    // The href is a path, which is right for an anchor and useless pasted into
    // a message to somebody else.
    expect(link().getAttribute("href")).toBe("/read/example?at=spya-k3m9qt");
    click(link());
    await settle();
    expect(wrote).toEqual([`${location.origin}/read/example?at=spya-k3m9qt`]);
    expect(jumped).toEqual([]);
  });

  it("shows the tick only AFTER the promise resolves", async () => {
    let release!: () => void;
    clipboard(() => new Promise<void>((r) => { release = r; }));
    paint();
    click(link());
    // The whole point: mid-flight the icon must not be claiming success.
    expect(icon()).toContain("link");
    expect(said).toEqual([]);
    await act(async () => { release(); await Promise.resolve(); });
    expect(icon()).toContain("check");
    expect(said).toEqual(["Copied the link to k3m9qt."]);
  });

  it("says so when the write is refused, and does NOT jump", async () => {
    clipboard(() => Promise.reject(new Error("denied")));
    paint();
    click(link());
    await settle();
    expect(icon()).toContain("triangle-alert");
    expect(said).toEqual(["Couldn't copy the link to k3m9qt."]);
    // It used to jump here. A rejection can arrive seconds later, after the
    // reader has moved on, and a scroll out of nowhere is worse than a failure
    // that says it failed.
    expect(jumped).toEqual([]);
  });

  it("does not throw when there is no clipboard object at all", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    paint();
    expect(() => click(link())).not.toThrow();
    await settle();
    expect(icon()).toContain("triangle-alert");
  });

  it("jumps rather than copying when it was not a pointer that activated it", async () => {
    const wrote = clipboard(() => Promise.resolve());
    paint();
    // `detail: 0` is how a click generated by Enter on a link arrives. The
    // element announces itself as a link, so this has to behave like one.
    const e = click(link(), { detail: 0 });
    await settle();
    expect(wrote).toEqual([]);
    expect(jumped).toEqual([ID]);
    // And it must cancel the browser's own navigation, which would reload the
    // whole reading view — nothing intercepts anchor clicks in this app.
    expect(e.defaultPrevented).toBe(true);
  });

  it("leaves every modified click to the browser", async () => {
    const wrote = clipboard(() => Promise.resolve());
    paint();
    for (const mod of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
      const e = click(link(), mod);
      expect(e.defaultPrevented).toBe(false);
    }
    await settle();
    expect(wrote).toEqual([]);
    expect(jumped).toEqual([]);
  });

  it("ignores a stale result that lands after a newer one", async () => {
    // Two presses; the FIRST write settles last. Without the operation token
    // the older result overwrites the newer tick with its own.
    const settlers: Array<(ok: boolean) => void> = [];
    clipboard(
      () => new Promise<void>((res, rej) => settlers.push((ok) => (ok ? res() : rej(new Error("no"))))),
    );
    paint();
    click(link());
    click(link());
    await act(async () => {
      settlers[1]?.(true); // the newer one succeeds
      await Promise.resolve();
    });
    expect(icon()).toContain("check");
    await act(async () => {
      settlers[0]?.(false); // the older one fails, late
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(icon()).toContain("check");
    expect(said).toEqual(["Copied the link to k3m9qt."]);
  });

  it("says nothing once it has been unmounted mid-flight", async () => {
    let release!: () => void;
    clipboard(() => new Promise<void>((r) => { release = r; }));
    paint();
    click(link());
    act(() => root.unmount());
    await act(async () => { release(); await Promise.resolve(); });
    // The continuation is still live; it must not announce, and it must not set
    // state on a component that has gone.
    expect(said).toEqual([]);
    // Re-create so `afterEach` has something to unmount.
    root = createRoot(host);
  });

  it("carries the full id where a reader and a screen reader can each get it", () => {
    paint();
    expect(link().getAttribute("title")).toContain(ID);
    expect(link().getAttribute("aria-label")).toContain(ID);
  });
});

describe("the comment marker", () => {
  it("is absent on a block with no comments", () => {
    paint();
    expect(host.querySelector(".blk-cmt")).toBeNull();
  });

  it("opens the FIRST comment it was given, not the last", () => {
    // `commentsByBlock` hands them over in reading order, so "first" is index 0
    // — and opening the last would look identical on a one-comment block.
    paint([comment("c-first", 5), comment("c-second", 40)]);
    act(() => {
      (host.querySelector(".blk-cmt") as HTMLButtonElement).click();
    });
    expect(opened).toEqual(["c-first"]);
  });

  it("counts them when there is more than one, and says so out loud", () => {
    paint([comment("c1", 5), comment("c2", 40), comment("c3", 60)]);
    expect(host.querySelector(".blk-n")?.textContent).toBe("3");
    expect(host.querySelector(".blk-cmt")?.getAttribute("aria-label")).toContain("3");
  });

  it("draws no count for a single comment", () => {
    paint([comment("c1", 5)]);
    expect(host.querySelector(".blk-n")).toBeNull();
  });

  it("is drawn for a comment whose quote no longer resolves", () => {
    // The gutter never sees a resolved mark — it is handed comments grouped by
    // blockId. This is the orphan, and it is the reason the marker exists.
    paint([comment("orphan", 999)]);
    expect(host.querySelector(".blk-cmt")).not.toBeNull();
  });
});

describe("the chat button", () => {
  it("says how many conversations a block already has", () => {
    paint(undefined, 2);
    expect(host.querySelector(".block-chat")?.classList.contains("has")).toBe(true);
    expect(host.querySelector(".block-chat-n")?.textContent).toBe("2");
  });

  it("is present and unmarked on a block with none", () => {
    paint();
    expect(host.querySelector(".block-chat")?.classList.contains("has")).toBe(false);
  });
});
