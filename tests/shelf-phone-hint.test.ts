// @vitest-environment jsdom
/**
 * **Who is told on the shelf that a phone is not the best screen for this.**
 *
 * The shelf's banner is about the *device*, not the layout — Greg, spya-fcbnhq:
 * *"show some kind of banner to people when they open it on a phone to say that
 * it's probably best on a larger screen, and failing that, in Landscape mode."*
 * So the rule is a finger and a short screen side, in either orientation, and
 * the cases worth writing down are the ones a width would get wrong: a phone
 * held sideways (wide, still a phone), an iPad mini (coarse, not a phone), and
 * a laptop window dragged narrow (narrow, not a phone).
 *
 * docs/plans/261002b-include-public-chip-on-the-shelf-empty-shelf-help-and-a-phone-banner-on-the-shelf.md § Part C.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShelfPhoneHint } from "../src/web/ShelfPhoneHint.js";
import {
  isPhone,
  rememberShelfPhoneHintDismissed,
  shelfPhoneHintDismissed,
  shouldShowShelfPhoneHint,
} from "../src/web/small-screen-hint.js";

const screen = (width: number, height: number) => ({ width, height });

describe("isPhone", () => {
  it("is a phone in portrait and in landscape", () => {
    expect(isPhone({ coarsePointer: true, screen: screen(390, 844) })).toBe(true);
    expect(isPhone({ coarsePointer: true, screen: screen(844, 390) })).toBe(true);
    expect(isPhone({ coarsePointer: true, screen: screen(375, 667) })).toBe(true);
  });

  it("is not an iPad, mini or otherwise, either way up", () => {
    expect(isPhone({ coarsePointer: true, screen: screen(744, 1133) })).toBe(false);
    expect(isPhone({ coarsePointer: true, screen: screen(1180, 820) })).toBe(false);
  });

  it("is not a laptop, however narrow its window, because the pointer is fine", () => {
    expect(isPhone({ coarsePointer: false, screen: screen(390, 844) })).toBe(false);
  });

  it("draws the line at 600, and a screen nobody measured is not a phone", () => {
    expect(isPhone({ coarsePointer: true, screen: screen(599, 900) })).toBe(true);
    expect(isPhone({ coarsePointer: true, screen: screen(600, 900) })).toBe(false);
    expect(isPhone({ coarsePointer: true, screen: screen(0, 0) })).toBe(false);
    expect(isPhone({ coarsePointer: true, screen: screen(Number.NaN, 844) })).toBe(false);
  });
});

describe("shouldShowShelfPhoneHint", () => {
  it("shows on a phone until dismissed", () => {
    const phone = { coarsePointer: true, screen: screen(390, 844) };
    expect(shouldShowShelfPhoneHint({ ...phone, dismissed: false })).toBe(true);
    expect(shouldShowShelfPhoneHint({ ...phone, dismissed: true })).toBe(false);
  });
});

/**
 * A working store, `tests/small-screen-banner.test.tsx`'s reason: Node's own
 * `localStorage` shadows jsdom's under vitest, so without this the round trip
 * can never be observed. `throwing` is Safari's private mode.
 */
function storage(throwing = false): Map<string, string> {
  const store = new Map<string, string>();
  const fail = () => {
    throw new Error("SecurityError");
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: throwing ? fail : (k: string) => store.get(k) ?? null,
      setItem: throwing ? fail : (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  });
  return store;
}

describe("the dismissal", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is remembered, and is its own bit rather than the article banner's", () => {
    const store = storage();
    expect(shelfPhoneHintDismissed()).toBe(false);
    rememberShelfPhoneHintDismissed();
    expect(shelfPhoneHintDismissed()).toBe(true);
    expect([...store.keys()]).toEqual(["spya.shelfPhoneHint.dismissed"]);
  });

  it("reads as not dismissed when storage throws, and writing does not throw", () => {
    storage(true);
    expect(shelfPhoneHintDismissed()).toBe(false);
    expect(() => rememberShelfPhoneHintDismissed()).not.toThrow();
  });
});

describe("the banner itself", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  function machine(coarse: boolean, width: number, height: number) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: coarse && query === "(pointer: coarse)",
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        onchange: null,
        dispatchEvent: () => false,
      }),
    });
    Object.defineProperty(window, "screen", { configurable: true, value: { width, height } });
  }

  function mount() {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(createElement(ShelfPhoneHint)));
    return { host, root };
  }

  it("draws on a phone, and the × puts it away for good on this device", () => {
    storage();
    machine(true, 390, 844);
    const first = mount();
    expect(first.host.textContent).toContain("works best on a larger screen");
    act(() => first.host.querySelector<HTMLButtonElement>("button[aria-label=Dismiss]")?.click());
    expect(first.host.textContent).toBe("");
    act(() => first.root.unmount());

    const again = mount();
    expect(again.host.textContent, "a later visit, same device").toBe("");
    act(() => again.root.unmount());
  });

  it("does not draw on a laptop or an iPad", () => {
    storage();
    machine(false, 390, 844);
    const laptop = mount();
    expect(laptop.host.textContent).toBe("");
    act(() => laptop.root.unmount());
    machine(true, 820, 1180);
    const ipad = mount();
    expect(ipad.host.textContent).toBe("");
    act(() => ipad.root.unmount());
  });
});
