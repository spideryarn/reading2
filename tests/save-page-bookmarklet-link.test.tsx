// @vitest-environment jsdom
/**
 * **The "Save for Spideryarn" link installs; it does not run here** —
 * src/web/SavePageBookmarklet.tsx.
 * docs/plans/261017b-a-refused-site-the-free-copy-and-the-bookmarklet-after-greg-s-reply.md § Stage 2.
 *
 *  - its `href` is the bookmarklet's `javascript:` URL, set after mount because
 *    React 19 would block it in JSX;
 *  - a click saves nothing (no blob URL is made) and says to drag it instead;
 *  - it is drawn only where the primary pointer is fine (a mouse or a
 *    trackpad, a touchscreen laptop included); a phone or a bare iPad, whose
 *    primary pointer is coarse, has no bookmarks bar to drag it to.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SavePageBookmarklet } from "../src/web/SavePageBookmarklet.js";
import { bookmarkletHref } from "../src/web/save-page-bookmarklet.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

/** The primary pointer, as `matchMedia` reports it; `null` for a browser without `matchMedia`. */
function setPointer(pointer: "fine" | "coarse" | null) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value:
      pointer === null
        ? undefined
        : (query: string) => ({ matches: query === `(pointer: ${pointer})`, media: query }),
  });
}

function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(SavePageBookmarklet)));
}

beforeEach(() => {
  setPointer("fine");
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.restoreAllMocks();
});

describe("SavePageBookmarklet", () => {
  it("is a link whose href is the bookmarklet", () => {
    render();
    const a = host.querySelector("a")!;
    expect(a.textContent).toContain("Save for Spideryarn");
    expect(a.getAttribute("href")).toBe(bookmarkletHref());
    expect(a.getAttribute("href")!.startsWith("javascript:")).toBe(true);
    expect(host.textContent).toContain("drag Save for Spideryarn to your bookmarks bar");
  });

  it("a click saves nothing here, and says to drag it", () => {
    const made = vi.fn(() => "blob:x");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: made });
    render();
    const a = host.querySelector("a")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => void a.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(made).not.toHaveBeenCalled();
    expect(host.querySelector('[role="status"]')?.textContent).toMatch(/Drag it to your bookmarks bar/);
  });

  it("is not drawn where the primary pointer is coarse (a phone, a bare iPad)", () => {
    setPointer("coarse");
    render();
    expect(host.innerHTML).toBe("");
  });

  it("is not drawn where the browser cannot say", () => {
    setPointer(null);
    render();
    expect(host.innerHTML).toBe("");
  });
});
