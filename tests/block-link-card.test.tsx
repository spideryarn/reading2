// @vitest-environment jsdom
/**
 * **One block link, one card for the whole page** — src/web/BlockRef.tsx and
 * src/web/BlockLinkCard.tsx.
 *
 * What is pinned here, each of which would fail quietly:
 *
 *  - `BlockRef` has no native `title` any more (tooltips.md calls one a
 *    regression) and carries `data-block-link`, which is what the one delegated
 *    card listens for; its accessible name is the full id on the default
 *    rendering and its own words when it has children (Sol F6).
 *  - With a provider that does not know the id, it is **not a link**: a dimmed
 *    span with the explanation in `sr-only` text, since a span takes no focus.
 *  - The card: the section the block sits in, then the paragraph cut short;
 *    the paragraph left out when the caller already shows it; **exactly one**
 *    card open however many links there are (Sol F4); and wired as the hovered
 *    link's `aria-describedby` while it is open.
 *
 * docs/plans/260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md.
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId, NodeId } from "../src/types.js";
import { BlockLinkProvider, buildBlockLinkIndex } from "../src/web/BlockLinkCard.js";
import { BlockRef } from "../src/web/BlockRef.js";
import type { Section } from "../src/web/position.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AFTER_THE_DELAY = 500;

const id = (s: string) => `spya-${s}` as BlockId;
function block(s: string, text: string): Block {
  return { id: id(s), tag: "p", kind: "text", text, words: 2, html: "<p></p>", gistable: true };
}

const LONG = `The opening claim. ${"More words that go on. ".repeat(30)}`;
const BLOCKS: Block[] = [
  block("aaaaaa", "Before any section."),
  block("bbbbbb", LONG),
  block("cccccc", "A short paragraph about starters."),
  block("dddddd", ""),
  block("eeeeee", "Under an untitled section."),
];
const SECTIONS: Section[] = [
  { row: 1, blockId: id("bbbbbb"), nodeId: "n1" as NodeId, title: "Why it rises" },
  { row: 4, blockId: id("eeeeee"), nodeId: "n2" as NodeId, title: "   " },
];
const INDEX = buildBlockLinkIndex(BLOCKS, SECTIONS);

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.useFakeTimers();
  history.replaceState(null, "", "/read/x");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function paint(children: ReactNode, withProvider = true): void {
  act(() =>
    root.render(withProvider ? <BlockLinkProvider index={INDEX}>{children}</BlockLinkProvider> : children),
  );
}

const link = (s: string) => host.querySelector<HTMLElement>(`[data-block-link="${id(s)}"]`);
const cards = () => [...document.querySelectorAll<HTMLElement>(".tooltip-anchor")];

async function hover(el: HTMLElement | null, pointerType = "mouse"): Promise<void> {
  el?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType }));
  await act(async () => {
    vi.advanceTimersByTime(AFTER_THE_DELAY);
  });
}

async function leave(el: HTMLElement | null): Promise<void> {
  el?.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget: null }));
  document.body.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
  await act(async () => {
    vi.advanceTimersByTime(AFTER_THE_DELAY);
  });
  await act(async () => {
    vi.advanceTimersByTime(AFTER_THE_DELAY);
  });
}

describe("buildBlockLinkIndex", () => {
  const index = buildBlockLinkIndex(BLOCKS, SECTIONS);

  it("names each block's section the way the return chip does", () => {
    expect(index.get(id("bbbbbb"))?.section).toBe("Why it rises");
    expect(index.get(id("dddddd"))?.section).toBe("Why it rises");
    // Above the first section, the first section: `activeSectionIndex` clamps.
    expect(index.get(id("aaaaaa"))?.section).toBe("Why it rises");
  });

  it("has no section for a blank title rather than an empty head", () => {
    expect(index.get(id("eeeeee"))?.section).toBeUndefined();
  });

  it("carries every block's text, and nothing it does not have", () => {
    expect(index.get(id("cccccc"))?.text).toBe("A short paragraph about starters.");
    expect(index.size).toBe(BLOCKS.length);
    expect(index.get(id("zzzzzz"))).toBeUndefined();
  });

  it("has no section at all for an article with none", () => {
    expect(buildBlockLinkIndex(BLOCKS, []).get(id("bbbbbb"))?.section).toBeUndefined();
  });
});

describe("BlockRef", () => {
  it("has no native title, and says which block it is for the card", () => {
    paint(<BlockRef id={id("cccccc")} />);
    const a = link("cccccc");
    expect(a?.tagName).toBe("A");
    expect(a?.hasAttribute("title")).toBe(false);
    expect(a?.getAttribute("data-block-link")).toBe(id("cccccc"));
    expect(a?.textContent).toBe("cccccc");
    expect(a?.getAttribute("aria-label"), "the full id for a screen reader").toBe(id("cccccc"));
  });

  it("is named by its children when it has them", () => {
    paint(<BlockRef id={id("cccccc")}>the passage about starters</BlockRef>);
    const a = link("cccccc");
    expect(a?.textContent).toBe("the passage about starters");
    expect(a?.hasAttribute("aria-label")).toBe(false);
  });

  it("marks a link whose caller already shows the passage", () => {
    paint(<BlockRef id={id("cccccc")} preview={false} />);
    expect(link("cccccc")?.getAttribute("data-block-preview")).toBe("off");
  });

  it("is not a link to a block this article does not have", () => {
    paint(<BlockRef id={id("zzzzzz")} />);
    const el = link("zzzzzz");
    expect(el?.tagName).toBe("SPAN");
    expect(el?.classList.contains("block-ref-missing")).toBe(true);
    expect(el?.hasAttribute("href")).toBe(false);
    expect(host.querySelector("a")).toBeNull();
    expect(el?.querySelector(".sr-only")?.textContent).toMatch(/not in this version of the article/);
  });

  it("stays a link without a provider, which cannot know", () => {
    paint(<BlockRef id={id("zzzzzz")} />, false);
    expect(link("zzzzzz")?.tagName).toBe("A");
  });
});

describe("the card", () => {
  it("opens on hover with the section, then the paragraph cut short", async () => {
    paint(<BlockRef id={id("bbbbbb")} />);
    expect(cards()).toEqual([]);
    await hover(link("bbbbbb"));
    expect(cards()).toHaveLength(1);
    const card = cards()[0];
    expect(card?.querySelector(".tip-cite-head")?.textContent).toBe("Why it rises");
    const body = card?.querySelector(".tip-cite-text")?.textContent ?? "";
    expect(body.startsWith("The opening claim.")).toBe(true);
    expect(body.endsWith("…")).toBe(true);
    expect(body.length).toBeLessThan(LONG.length);
    expect(card?.textContent).not.toMatch(/click to go/i);
  });

  it("portals into an open modal dialog when its link is inside one", async () => {
    paint(
      <dialog open>
        <BlockRef id={id("bbbbbb")} />
      </dialog>,
    );
    await hover(link("bbbbbb"));
    const dialog = host.querySelector("dialog");
    expect(cards()).toHaveLength(1);
    expect(cards()[0]?.closest("dialog"), "a body portal sits underneath the dialog top layer").toBe(
      dialog,
    );
  });

  it("is the link's description while it is open, and stops being it when shut", async () => {
    paint(<BlockRef id={id("bbbbbb")} />);
    const a = link("bbbbbb");
    await hover(a);
    const card = cards()[0];
    expect(card?.id).toBeTruthy();
    expect(a?.getAttribute("aria-describedby")).toBe(card?.id);
    await leave(a);
    expect(cards()).toEqual([]);
    expect(a?.hasAttribute("aria-describedby")).toBe(false);
  });

  it("leaves the paragraph out when the caller already shows it", async () => {
    paint(<BlockRef id={id("bbbbbb")} preview={false}>The opening claim.</BlockRef>);
    await hover(link("bbbbbb"));
    expect(cards()).toHaveLength(1);
    expect(cards()[0]?.querySelector(".tip-cite-head")?.textContent).toBe("Why it rises");
    expect(cards()[0]?.querySelector(".tip-cite-text")).toBeNull();
  });

  it("drops the head when the link's own words already name the section", async () => {
    paint(<BlockRef id={id("bbbbbb")}>2 Why it rises</BlockRef>);
    await hover(link("bbbbbb"));
    expect(cards()).toHaveLength(1);
    expect(cards()[0]?.querySelector(".tip-cite-head")).toBeNull();
    expect(cards()[0]?.querySelector(".tip-cite-text")?.textContent).toContain("The opening claim.");
  });

  it("opens no card at all when the head was all it had and the link says it", async () => {
    paint(<BlockRef id={id("bbbbbb")} preview={false}>Why it rises</BlockRef>);
    await hover(link("bbbbbb"));
    expect(cards()).toHaveLength(0);
  });

  it("has no head when the section has no title", async () => {
    paint(<BlockRef id={id("eeeeee")} />);
    await hover(link("eeeeee"));
    expect(cards()[0]?.querySelector(".tip-cite-head")).toBeNull();
    expect(cards()[0]?.textContent).toContain("Under an untitled section.");
  });

  it("says so for a block with no text of its own", async () => {
    paint(<BlockRef id={id("dddddd")} />);
    await hover(link("dddddd"));
    expect(cards()[0]?.querySelector(".tip-cite-empty")?.textContent).toBe(
      "This block has no text of its own.",
    );
  });

  it("is one card however many links there are", async () => {
    paint(
      <>
        <BlockRef id={id("bbbbbb")} />
        <BlockRef id={id("cccccc")} />
        <BlockRef id={id("eeeeee")} />
      </>,
    );
    await hover(link("bbbbbb"));
    await hover(link("cccccc"));
    expect(cards()).toHaveLength(1);
    expect(cards()[0]?.textContent).toContain("A short paragraph about starters.");
    expect(link("bbbbbb")?.hasAttribute("aria-describedby")).toBe(false);
    expect(link("cccccc")?.getAttribute("aria-describedby")).toBe(cards()[0]?.id);
  });

  it("explains a missing block on hover, as its sr-only text does", async () => {
    paint(<BlockRef id={id("zzzzzz")} />);
    await hover(link("zzzzzz"));
    expect(cards()).toHaveLength(1);
    expect(cards()[0]?.textContent).toMatch(/not in this version of the article/);
  });

  it("does not open for a finger: a tap just follows the link", async () => {
    paint(<BlockRef id={id("bbbbbb")} />);
    await hover(link("bbbbbb"), "touch");
    expect(cards()).toEqual([]);
  });

  it("dismisses an open card when a finger takes over", async () => {
    paint(<BlockRef id={id("bbbbbb")} />);
    await hover(link("bbbbbb"));
    expect(cards()).toHaveLength(1);
    await hover(link("bbbbbb"), "touch");
    await act(async () => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    expect(cards()).toEqual([]);
  });

  it("cancels hover intent when Escape is pressed before the card opens", async () => {
    paint(<BlockRef id={id("bbbbbb")} />);
    link("bbbbbb")?.dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }),
    );
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await act(async () => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    expect(cards()).toEqual([]);
  });

  it("closes when React detaches the anchor without a pointerout", async () => {
    paint(<BlockRef id={id("bbbbbb")} />);
    await hover(link("bbbbbb"));
    expect(cards()).toHaveLength(1);

    paint(<span>the link is gone</span>);
    await act(async () => Promise.resolve());
    await act(async () => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    expect(cards()).toEqual([]);
  });

  it("refreshes an open card when the article index changes under the same anchor", async () => {
    paint(<BlockRef id={id("bbbbbb")} />);
    await hover(link("bbbbbb"));
    expect(cards()[0]?.textContent).toContain("The opening claim.");

    const changed = new Map(INDEX);
    changed.set(id("bbbbbb"), { text: "Replacement article text.", section: "A new section" });
    act(() =>
      root.render(
        <BlockLinkProvider index={changed}>
          <BlockRef id={id("bbbbbb")} />
        </BlockLinkProvider>,
      ),
    );
    expect(cards()[0]?.textContent).toContain("Replacement article text.");
    expect(cards()[0]?.textContent).toContain("A new section");
  });

  it("opens for the keyboard, on focus", async () => {
    paint(<BlockRef id={id("cccccc")} />);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      link("cccccc")?.focus();
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    expect(cards()).toHaveLength(1);
    expect(cards()[0]?.textContent).toContain("A short paragraph about starters.");
    await act(async () => {
      link("cccccc")?.blur();
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    await act(async () => {
      vi.advanceTimersByTime(AFTER_THE_DELAY);
    });
    expect(cards()).toEqual([]);
  });

  it("has nothing to draw without a provider", async () => {
    paint(<BlockRef id={id("bbbbbb")} />, false);
    await hover(link("bbbbbb"));
    expect(cards()).toEqual([]);
  });
});
