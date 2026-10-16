// @vitest-environment jsdom
/**
 * **What a list the keys step through shares** — src/web/list-step.ts, used by
 * Quotes and Search (docs/plans/261015d-search-arrow-keys-step-the-results.md).
 * `stepQuote`'s own cases are in tests/quotes-step.test.ts.
 */
import { act, createElement, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scrollTopFor, stepByKey, useFollowRow } from "../src/web/list-step.js";

/* A Search results list in the order the band shows it — *confidence* here,
   so the keys must not walk it in the article's order. */
const LISTED = [
  { key: "r:b9:0", at: 0.9 },
  { key: "r:b2:0", at: 0.2 },
  { key: "r:b5:0", at: 0.5 },
];
const step = (current: string | null, dir: -1 | 1) =>
  stepByKey(LISTED, (f) => f.key, current, dir)?.key ?? null;

describe("stepByKey", () => {
  it("walks the list in the order it is shown, not the article's", () => {
    expect(step("r:b9:0", 1)).toBe("r:b2:0");
    expect(step("r:b2:0", 1)).toBe("r:b5:0");
    expect(step("r:b5:0", -1)).toBe("r:b2:0");
  });

  it("starts at the first, whichever way, when nothing is open", () => {
    expect(step(null, 1)).toBe("r:b9:0");
    expect(step(null, -1)).toBe("r:b9:0");
  });

  it("treats an open row the list no longer shows as nothing open", () => {
    /* The bar hid it, or a matcher switch replaced the list. */
    expect(step("r:gone:0", 1)).toBe("r:b9:0");
  });

  it("goes to the first again on ← from the first", () => {
    expect(step("r:b9:0", -1)).toBe("r:b9:0");
  });

  it("takes nothing on → from the last, and from an empty list", () => {
    expect(step("r:b5:0", 1)).toBeNull();
    expect(stepByKey([], String, null, 1)).toBeNull();
  });
});

describe("scrollTopFor", () => {
  /* A 300px list scrolled to 100, so rows from 100 to 400 are in view. */
  it("leaves a row that is wholly in view alone", () => {
    expect(scrollTopFor(100, 300, 100, 50)).toBeNull();
    expect(scrollTopFor(100, 300, 350, 50)).toBeNull();
  });

  it("puts a row above or below the view a third of the way down", () => {
    expect(scrollTopFor(500, 300, 200, 30)).toBe(100);
    expect(scrollTopFor(0, 300, 600, 30)).toBe(500);
  });

  it("never cuts a row that fits at the list's foot", () => {
    /* A 250px row a third of the way down a 300px list would lose its last
       50px; it goes to the foot instead. */
    expect(scrollTopFor(0, 300, 600, 250)).toBe(550);
  });

  it("starts a row taller than the list at its top", () => {
    expect(scrollTopFor(0, 300, 600, 400)).toBe(600);
  });

  it("never goes above the top", () => {
    expect(scrollTopFor(200, 300, 50, 30)).toBe(0);
  });
});

/* ------------------------------------------------------------ useFollowRow -- */

/** jsdom lays nothing out, so each list says its own height and each row its place. */
let height = 300;
let observers: Array<() => void> = [];
const RealResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  height = 300;
  observers = [];
  globalThis.ResizeObserver = class {
    private readonly fire: () => void;
    constructor(cb: ResizeObserverCallback) {
      this.fire = () => cb([], this as unknown as ResizeObserver);
    }
    observe() {
      observers.push(this.fire);
    }
    unobserve() {}
    disconnect() {
      observers = observers.filter((f) => f !== this.fire);
    }
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  globalThis.ResizeObserver = RealResizeObserver;
  document.body.innerHTML = "";
});

/** Rows 40px tall, one under the other, from the list's top. */
function List({ selected, shown = true }: { selected: string | null; shown?: boolean }) {
  const followRef = useFollowRow<HTMLUListElement>(selected, (list, key) =>
    [...list.children].find(
      (el): el is HTMLElement => el instanceof HTMLElement && el.dataset.k === key,
    ),
  );
  const ref = useCallback(
    (el: HTMLUListElement | null) => {
      if (el) {
        Object.defineProperty(el, "clientHeight", { configurable: true, get: () => height });
        el.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
      }
      followRef(el);
    },
    [followRef],
  );
  if (!shown) return null;
  return createElement(
    "ul",
    {
      ref,
    },
    Array.from({ length: 30 }, (_, i) =>
      createElement("li", {
        key: i,
        "data-k": `row-${i}`,
        ref: (el: HTMLLIElement | null) => {
          if (!el) return;
          Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => 40 });
          /* Where the row sits on screen: its place in the list less the
             list's own scroll. */
          el.getBoundingClientRect = () =>
            ({ top: i * 40 - (el.parentElement?.scrollTop ?? 0) }) as DOMRect;
        },
      }),
    ),
  );
}

describe("useFollowRow", () => {
  async function mount(selected: string | null) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(List, { selected })));
    const list = host.querySelector("ul") as HTMLUListElement;
    return {
      list,
      rerender: (next: string | null, shown = true) =>
        act(async () => root.render(createElement(List, { selected: next, shown }))),
    };
  }

  it("brings a selected row below the view into it", async () => {
    const { list } = await mount("row-20");
    /* Row 20 is at 800–840; a third of the way down a 300px list. */
    expect(list.scrollTop).toBe(700);
  });

  it("leaves the list alone when the selected row is already in view", async () => {
    const { list, rerender } = await mount(null);
    list.scrollTop = 0;
    await rerender("row-2");
    expect(list.scrollTop).toBe(0);
  });

  it("follows when a hidden list comes back into view", async () => {
    /* On a narrow window a step steps the band aside: the list is hidden, so
       the selection changes while it measures nothing. */
    height = 0;
    const { list, rerender } = await mount(null);
    await rerender("row-20");
    expect(list.scrollTop, "a hidden list was scrolled").toBe(0);
    height = 300;
    await act(async () => {
      for (const fire of observers) fire();
    });
    expect(list.scrollTop, "the list did not follow on coming back").toBe(700);
  });

  it("disconnects and follows again when the list element is replaced", async () => {
    const mounted = await mount("row-20");
    expect(observers).toHaveLength(1);

    await mounted.rerender("row-20", false);
    expect(observers, "the detached list is still observed").toHaveLength(0);

    await mounted.rerender("row-20");
    const replacement = document.querySelector("ul") as HTMLUListElement;
    expect(replacement.scrollTop, "the replacement list did not follow").toBe(700);
    expect(observers).toHaveLength(1);
  });
});
