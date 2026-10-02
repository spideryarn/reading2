// @vitest-environment jsdom
/**
 * **Every control in the prose gutter has a house tooltip** — the reading
 * view's one delegated card (src/web/BlockLinkCard.tsx), never a native
 * `title`.
 *
 * Greg, 2026-10-02 (spya-jc0vm6), on the icons beside a block: *"Make sure
 * they all have tooltips"*. They all had a `title`, which a browser shows
 * after about a second, in its own style, and never on focus — which reads as
 * no tooltip at all, and tooltips.md calls a regression. The gutter's
 * reading-time line already used the delegated card; its controls join it.
 *
 * Mouse hover and keyboard focus open it; a finger does not, because a tap on
 * a gutter control does the thing. The card adds no `aria-describedby`: its
 * words are the control's own `aria-label`, near enough, and would be read
 * twice. docs/plans/261002e-mode-corner-icons-and-gutter-icon-polish.md.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, Comment } from "../src/types.js";
import { BlockGutter } from "../src/web/BlockGutter.js";
import { BlockLinkProvider } from "../src/web/BlockLinkCard.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AFTER_THE_DELAY = 500;
const ID = "spya-gutcrd" as BlockId;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  window.history.replaceState(null, "", "/read/example");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Reflect.deleteProperty(navigator as object, "clipboard");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** One gutter with every control it can have but the mark, or the mark when `comments` is given. */
function paint(comments?: Comment[]): void {
  act(() =>
    root.render(
      <BlockLinkProvider index={new Map()}>
        <BlockGutter
          id={ID}
          linkBase="/read/example"
          {...(comments ? { comments } : {})}
          chatCount={0}
          onOpenComment={() => {}}
          onChatAbout={() => {}}
          onHelp={() => {}}
          onBookmark={() => Promise.resolve(true)}
          onJump={() => {}}
          announce={() => {}}
        />
      </BlockLinkProvider>,
    ),
  );
}

const card = () => document.querySelector<HTMLElement>(".tooltip-anchor");
const control = (sel: string) => host.querySelector<HTMLElement>(`.blk-gutter > ${sel}`)!;

async function hover(el: HTMLElement, pointerType = "mouse"): Promise<void> {
  el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType }));
  await act(async () => {
    vi.advanceTimersByTime(AFTER_THE_DELAY);
  });
}

describe("the gutter's controls", () => {
  it("carry no native title, and each says what it does in data-tip", () => {
    paint();
    const all = [...host.querySelectorAll<HTMLElement>(".blk-gutter > button, .blk-gutter > a")];
    expect(all.length).toBe(5); // permalink, chat, bookmark, "?", "…"
    for (const el of all) {
      expect(el.hasAttribute("title"), `${el.className} still has a native title`).toBe(false);
      expect(el.dataset.tip?.trim() ?? "", `${el.className} has nothing to say`).not.toBe("");
    }
  });

  it("open the house card on hover, the bookmark included, with no aria-describedby", async () => {
    paint();
    for (const [sel, words] of [
      [".blk-bookmark", "Bookmark this paragraph"],
      [".blk-permalink", ID],
      [".block-chat", "Chat about this paragraph"],
      [".blk-help", "Ask the AI for help with this paragraph"],
      [".blk-more", "More for this paragraph"],
    ] as const) {
      const el = control(sel);
      await hover(el);
      expect(card()?.textContent ?? "", `${sel}: no card on hover`).toContain(words);
      expect(el.hasAttribute("aria-describedby"), `${sel}: the card is read twice`).toBe(false);
    }
  });

  it("open it for the reader's mark too", async () => {
    paint([{ id: "c1", blockId: ID, start: 0, quote: "q", createdAt: "2026-10-02T09:00:00Z", status: "none" }]);
    await hover(control(".blk-cmt"));
    expect(card()?.textContent ?? "").toContain("Your note on this paragraph");
  });

  it("open it on keyboard focus", async () => {
    paint();
    const help = control(".blk-help");
    await act(async () => help.focus());
    expect(card()?.textContent ?? "").toContain("Ask the AI");
  });

  it("do not open it for a finger, which presses the control instead", async () => {
    paint();
    await hover(control(".blk-bookmark"), "touch");
    expect(card()).toBeNull();
  });

  it("change the open card's words when the control's state changes", async () => {
    paint();
    const more = control(".blk-more");
    await hover(more);
    expect(card()?.textContent ?? "").toContain("More for this paragraph");
    await act(async () => {
      more.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    expect(more.dataset.tip).toBe("Close paragraph controls");
    expect(card()?.textContent ?? "").toContain("Close paragraph controls");
  });

  it("say Copied on the open permalink card once the copy lands", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
    paint();
    const link = control(".blk-permalink");
    await hover(link);
    await act(async () => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });
    expect(card()?.textContent ?? "").toContain("Copied");
  });

  it("say Couldn't copy on the open permalink card when the copy is refused", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
    paint();
    const link = control(".blk-permalink");
    await hover(link);
    await act(async () => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(link.dataset.tip).toContain("Couldn't copy");
    expect(card()?.textContent ?? "").toContain("Couldn't copy");
  });
});
