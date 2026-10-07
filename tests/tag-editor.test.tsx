// @vitest-environment jsdom
/**
 * The tag editor — src/web/TagEditor.tsx, plan
 * docs/plans/261003d-your-own-tags-on-articles-on-the-shelf-and-the-metadata-page.md.
 *
 * `tagOptions` is the list's logic and is pure; the rendered half checks the
 * keys a reader actually uses (Enter, comma, Backspace, the arrows) send the
 * edit they mean, and that a failed save says so and keeps the chips the server
 * last gave.
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/web/article-tags.js", () => ({
  loadReaderTags: async () => [
    { tag: "neuroscience", count: 5 },
    { tag: "neural networks", count: 2 },
    { tag: "buddhism", count: 3 },
  ],
}));

import { TagEditor, tagOptions } from "../src/web/TagEditor.js";
import type { TagChange } from "../src/web/article-tags.js";

const VOCAB = [
  { tag: "neuroscience", count: 5 },
  { tag: "neural networks", count: 2 },
  { tag: "buddhism", count: 3 },
];

describe("tagOptions", () => {
  it("offers the typed text as new first, then matching tags most-used first", () => {
    expect(tagOptions("neur", [], VOCAB)).toEqual([
      { kind: "new", tag: "neur" },
      { kind: "known", tag: "neuroscience", count: 5 },
      { kind: "known", tag: "neural networks", count: 2 },
    ]);
  });

  it("puts an exact match first and offers no 'new' for a tag already used", () => {
    expect(tagOptions("Neural Networks", [], VOCAB)[0]).toEqual({
      kind: "known",
      tag: "neural networks",
      count: 2,
    });
    expect(tagOptions("Neural Networks", [], VOCAB).some((o) => o.kind === "new")).toBe(false);
  });

  it("never offers a tag the article already has", () => {
    expect(tagOptions("", ["neuroscience"], VOCAB).map((o) => o.tag)).toEqual([
      "buddhism",
      "neural networks",
    ]);
  });

  it("offers nothing new for text that cannot be a tag", () => {
    expect(tagOptions("a,b", [], VOCAB).some((o) => o.kind === "new")).toBe(false);
  });
});

/* ------------------------------------------------------------- rendered -- */

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

function paint(tags: string[], save: (c: TagChange) => Promise<string[]>) {
  act(() => {
    root.render(createElement(TagEditor, { tags, save }));
  });
}

const box = () => host.querySelector<HTMLInputElement>('input[role="combobox"]')!;

async function type(text: string) {
  const input = box();
  await act(async () => {
    input.focus();
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(key: string) {
  await act(async () => {
    box().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

async function pressWhileComposing(key: string) {
  await act(async () => {
    box().dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }),
    );
  });
}

describe("TagEditor", () => {
  it("adds what was typed on Enter, lowercased, and clears the box", async () => {
    const save = vi.fn(async (c: TagChange) => c.add ?? []);
    paint([], save);
    await type("Consciousness");
    await press("Enter");
    expect(save).toHaveBeenCalledWith({ add: ["consciousness"] });
    expect(box().value).toBe("");
  });

  it("adds the highlighted suggestion when the arrows chose one", async () => {
    const save = vi.fn(async (c: TagChange) => c.add ?? []);
    paint([], save);
    await type("neur");
    await press("ArrowDown"); // past "Add neur" to the most-used match
    await press("Enter");
    expect(save).toHaveBeenCalledWith({ add: ["neuroscience"] });
  });

  it("treats a comma as 'that one is done'", async () => {
    const save = vi.fn(async (c: TagChange) => c.add ?? []);
    paint([], save);
    await type("ai");
    await press(",");
    expect(save).toHaveBeenCalledWith({ add: ["ai"] });
  });

  it("does not submit Enter while an input method is composing text", async () => {
    const save = vi.fn(async (c: TagChange) => c.add ?? []);
    paint([], save);
    await type("仮");
    await pressWhileComposing("Enter");
    expect(save).not.toHaveBeenCalled();
    expect(box().value).toBe("仮");
  });

  /* The older spelling of "composing": some engines send `keyCode` 229 and no
     flag (key-chord.ts § `isImeComposing`). Plan 261007a-ui-sweep-k2. */
  it("nor on an Enter or a comma that arrives as keyCode 229", async () => {
    const save = vi.fn(async (c: TagChange) => c.add ?? []);
    paint([], save);
    await type("仮");
    for (const key of ["Enter", ","]) {
      const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, keyCode: 229 } as KeyboardEventInit);
      await act(async () => {
        box().dispatchEvent(e);
      });
      expect(e.defaultPrevented, key).toBe(false);
    }
    expect(save).not.toHaveBeenCalled();
    expect(box().value).toBe("仮");
  });

  it("removes the last tag on Backspace in an empty box", async () => {
    const save = vi.fn(async () => ["a"]);
    paint(["a", "b"], save);
    await type("");
    await press("Backspace");
    expect(save).toHaveBeenCalledWith({ remove: ["b"] });
  });

  it("does nothing on Enter in an empty box", async () => {
    const save = vi.fn(async () => []);
    paint([], save);
    /* Focused, list open, the vocabulary in: the first suggestion is on
       screen, and Enter must still not take it — nobody chose it. */
    await act(async () => box().focus());
    await act(async () => {});
    expect(host.querySelector('[role="option"]')).not.toBeNull();
    await press("Enter");
    expect(save).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("says when a save failed, and keeps the chips the server last gave", async () => {
    const save = vi.fn(async () => {
      throw new Error("offline");
    });
    paint(["kept"], save);
    await type("new one");
    await press("Enter");
    expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(host.querySelector('[aria-label="Remove the tag kept"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Remove the tag new one"]')).toBeNull();
  });
});
