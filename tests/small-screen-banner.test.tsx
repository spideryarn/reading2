// @vitest-environment jsdom
/**
 * **The banner itself, mounted, in a browser that answers.**
 *
 * `tests/small-screen-hint.test.ts` is the truth table over three booleans, and
 * it establishes exactly nothing about the seam where those booleans come from.
 * GPT Sol put the hole plainly on review, 2026-09-05: every assertion in that
 * file would still pass if `readMachine()` always returned two `false`s,
 * `wasDismissed()` always returned `false`, and `rememberDismissed()` were a
 * no-op — which is a feature that is *permanently invisible* and a suite that is
 * entirely green. docs/reusable/silent-success.md is the house name for that.
 *
 * So this file gives jsdom the two things it does not have — a `matchMedia` that
 * says *coarse*, and a `localStorage` that remembers — and then checks the
 * things a reader would: that the sentence is drawn, that the landscape clause
 * comes and goes with the viewport, and that pressing × still hides it **on the
 * next mount**, which is the only assertion that can tell a real write from a
 * component that merely hid itself.
 *
 * The mount harness is `tests/dock-experimental-switch.test.tsx`'s, unchanged:
 * `createRoot` and `act`, no testing-library.
 *
 * docs/plans/260905e-a-small-screen-banner-on-a-phone.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SmallScreenHint } from "../src/web/SmallScreenHint.js";

let host: HTMLDivElement;
let root: Root;

/**
 * **A `matchMedia` that answers one question honestly and everything else
 * `false`.** jsdom ships none at all, which is why `media()` is guarded — see
 * src/web/media.ts. Installing one is what turns this file from a test of the
 * fallback into a test of the feature.
 */
function pointer(kind: "coarse" | "fine"): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === "(pointer: coarse)" && kind === "coarse",
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/** The viewport `moreRoomSideways` reads, straight off `window`. */
function viewport(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

/**
 * **A real store, not a stub that always says no.**
 *
 * Node's own `localStorage` global shadows the browser one under vitest and
 * reads `undefined`, so the guards in `small-screen-hint.ts` swallow every
 * touch and the one bit can never be observed. This installs a working Map so
 * the round trip is testable; the *unavailable* case stays covered by
 * `tests/small-screen-hint.test.ts`, which runs without it.
 */
function storage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  pointer("coarse");
  viewport(390, 844);
  storage();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(bandCovers: boolean): void {
  act(() => {
    root.render(createElement(SmallScreenHint, { bandCovers }));
  });
}

/** The banner, or `null` when nothing was drawn. */
function banner(): HTMLElement | null {
  return host.querySelector<HTMLElement>(".small-screen-hint");
}

/** What it says, insisted upon. */
function words(): string {
  const el = banner();
  if (!el) throw new Error("no banner was drawn");
  return el.textContent ?? "";
}

describe("what it draws", () => {
  it("says all of it on a phone in portrait", () => {
    mount(true);
    const said = words();
    // The four clauses Greg asked for, checked separately so that losing one is
    // one failure rather than a diff of the whole paragraph.
    expect(said).toContain("designed for a larger screen");
    expect(said).toContain("not both");
    expect(said).toContain("Plain");
    expect(said).toContain("work in progress");
    expect(said).toContain("Landscape gives you a bit more room");
  });

  it("drops the landscape clause when the phone is already sideways", () => {
    viewport(667, 375);
    mount(true);
    expect(words()).toContain("designed for a larger screen");
    expect(words()).not.toContain("Landscape");
  });

  it("draws nothing when the band has room beside the prose", () => {
    mount(false);
    expect(banner()).toBeNull();
  });

  it("draws nothing for a mouse, at a width a phone would be warned at", () => {
    // The guard that keeps this off a laptop window dragged narrow. It is a
    // real `matchMedia` answering `false` here rather than an absent one.
    pointer("fine");
    mount(true);
    expect(banner()).toBeNull();
  });
});

describe("the ×", () => {
  it("hides it, and it stays gone on the next mount", () => {
    mount(true);
    const close = banner()?.querySelector<HTMLButtonElement>(".small-screen-hint-close");
    if (!close) throw new Error("the banner drew no dismiss button");
    act(() => {
      close.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(banner()).toBeNull();

    // **This is the assertion that matters.** Hiding on click proves only that a
    // `useState` moved; a fresh mount reads `localStorage` again, so a
    // `rememberDismissed` that wrote nothing fails here and nowhere else.
    act(() => root.unmount());
    root = createRoot(host);
    mount(true);
    expect(banner()).toBeNull();
  });

  it("and a reader who has not pressed it still gets the banner on a fresh mount", () => {
    // The other half of the same seam: the control above passes if the banner
    // never drew at all, so this says the store starts empty and is read.
    mount(true);
    expect(banner()).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    mount(true);
    expect(banner()).not.toBeNull();
  });
});
