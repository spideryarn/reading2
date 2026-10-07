// @vitest-environment jsdom
/**
 * The shelf's tag popover — src/web/ShelfTags.tsx, plan 261003d. Two bugs the
 * browser check found, held here:
 *
 * - **In the table, the popover closed after every tag added**, because a tag
 *   edit re-renders the table and its cells remount, taking a `useState` with
 *   them. Open is now the shelf hook's (`tagging`), so a remount keeps it.
 * - **The first Escape closed the popover with the suggestion list still
 *   open.** Radix hears Escape on the document before the editor's handler.
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/web/article-tags.js", () => ({
  loadReaderTags: async () => [{ tag: "neuroscience", count: 2 }],
}));

import { ShelfTags } from "../src/web/ShelfTags.js";
import type { LibraryEntry } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const ENTRY = { slug: "a-piece", title: "A piece", tags: [] } as unknown as LibraryEntry;

function paint(tagging: string | null, setTagging = vi.fn(), key = "one") {
  act(() => {
    root.render(
      createElement(ShelfTags, {
        key,
        entry: ENTRY,
        shelf: { editTags: vi.fn(async () => ["x"]), tagging, setTagging },
      }),
    );
  });
  return setTagging;
}

const box = () => document.querySelector<HTMLInputElement>('input[role="combobox"]');

describe("ShelfTags' popover", () => {
  it("stays open across a remount, because the shelf holds which one is open", () => {
    paint("a-piece", vi.fn(), "one");
    expect(box()).not.toBeNull();
    /* A new key is a remount — what the table does to the cell. */
    paint("a-piece", vi.fn(), "two");
    expect(box()).not.toBeNull();
  });

  it("closes the suggestion list on the first Escape, and only the popover on the second", async () => {
    const setTagging = paint("a-piece");
    const input = box()!;
    await act(async () => {
      input.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "neu");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.getAttribute("aria-expanded")).toBe("true");

    const escape = () =>
      act(async () => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      });
    await escape();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(setTagging).not.toHaveBeenCalledWith(null);

    await escape();
    expect(setTagging).toHaveBeenCalledWith(null);
  });

  /* A reader typing Japanese or Chinese presses Escape to dismiss the input
     method's candidate list. With our own suggestion list hidden (nothing
     matches what is typed), that Escape closed the popover and dropped the tag
     being typed. docs/project/keyboard.md § A key an input method is using is
     not ours; plan 261007a § K3. */
  it("leaves the popover open on an Escape an input method is using", async () => {
    const setTagging = paint("a-piece");
    const input = box()!;
    await act(async () => {
      input.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "neu");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const pressEscape = (init: KeyboardEventInit) =>
      act(async () => {
        const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...init });
        input.dispatchEvent(event);
        if (init.isComposing || init.keyCode === 229) expect(event.defaultPrevented).toBe(false);
      });
    /* One Escape of ours shuts the list. It is hidden from here on, which is
       the case the open-list rule above misses. */
    await pressEscape({});
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(setTagging).not.toHaveBeenCalledWith(null);

    await pressEscape({ isComposing: true });
    expect(setTagging).not.toHaveBeenCalledWith(null);
    expect(box()?.value).toBe("neu");
    /* The older sentinel some engines send in place of the flag. */
    await pressEscape({ keyCode: 229 });
    expect(setTagging).not.toHaveBeenCalledWith(null);

    /* And an Escape that is ours still closes it. */
    await pressEscape({});
    expect(setTagging).toHaveBeenCalledWith(null);
  });
});
