// @vitest-environment jsdom
/**
 * **The shelf's heading plays the whole wordmark set, not only the spider's.**
 *
 * > We don't seem to get the fun logo animations for the logo in the top left
 * > of the logged in homepage.
 * >
 * > — Greg, 2026-09-30, SPIDERYARN-READING2-6D
 *
 * Until then the hook sat on the spider alone, beside a plain-text `<h1>`, so
 * pointing at the word did nothing and the letter animations could never
 * be drawn there (logo-animation.ts § lettersDrawn asks the *host* for a
 * `.logo-letter`). The fix is markup — one host round spider and word, the word
 * spelled as letters — and a stylesheet that scales the letter moves to a 30px
 * heading, which tests/logo-animation.test.tsx holds.
 * docs/plans/260930a-cmd-k-on-metadata-page-and-full-wordmark-animations-on-the-shelf.md.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ShelfWordmark } from "../src/web/Library.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** A mouse pointerover, as tests/logo-animation.test.tsx builds one for jsdom. */
function hover(target: Element): void {
  const e = new MouseEvent("pointerover", { bubbles: true });
  Object.defineProperty(e, "pointerType", { value: "mouse" });
  Object.defineProperty(e, "pointerId", { value: 1 });
  act(() => {
    target.dispatchEvent(e);
  });
}

/** A touch tap as the hook receives it: down, release on window, then click. */
function tap(target: Element): void {
  const down = new MouseEvent("pointerdown", { bubbles: true });
  Object.defineProperties(down, {
    pointerType: { value: "touch" },
    pointerId: { value: 1 },
  });
  const up = new MouseEvent("pointerup", { bubbles: true });
  Object.defineProperties(up, {
    pointerType: { value: "touch" },
    pointerId: { value: 1 },
  });
  act(() => {
    target.dispatchEvent(down);
    window.dispatchEvent(up);
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const heading = (): HTMLHeadingElement => {
  const el = host.querySelector("h1");
  if (!el) throw new Error("ShelfWordmark rendered no <h1>");
  return el;
};

describe("the shelf's wordmark", () => {
  it("is still an exposed heading that reads Spideryarn, with a decorative spider", () => {
    act(() => root.render(<ShelfWordmark />));
    expect(heading().textContent).toBe("Spideryarn");
    expect(heading().closest('[aria-hidden="true"]')).toBeNull();
    expect(host.querySelector(".logo-mark img")?.getAttribute("alt")).toBe("");
  });

  it("spells the name in the ten letters the animations move", () => {
    act(() => root.render(<ShelfWordmark />));
    expect(heading().querySelectorAll(".logo-letter")).toHaveLength(10);
  });

  it("animates when the word is pointed at, on a host that holds the letters and the spider", () => {
    act(() => root.render(<ShelfWordmark />));
    hover(heading().querySelector(".logo-letter") as Element);
    const animating = host.querySelector(".spya-anim");
    expect(animating, "pointing at the word started nothing").not.toBeNull();
    /* The host is what `lettersDrawn` asks, so the letters must be inside it —
       a host round the spider alone is the bug this file was written for. */
    expect(animating?.querySelectorAll(".logo-letter")).toHaveLength(10);
    expect(animating?.querySelector(".logo-mark img.logo-image")).not.toBeNull();
  });

  it("keeps tap-to-animate when the tap lands on the heading", () => {
    act(() => root.render(<ShelfWordmark />));
    tap(heading());
    expect(host.querySelector(".shelf-wordmark.spya-anim")).not.toBeNull();
  });
});
