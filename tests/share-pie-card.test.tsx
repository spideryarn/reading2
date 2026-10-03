// @vitest-environment jsdom
/**
 * **The small pie's card opens on a click or tap, not only on hover** —
 * src/web/SharePie.tsx. The pie replaced a sentence (spya-mafmm6), so a reader
 * who cannot hover must still be able to get the sentence back; a hover-only
 * card would have taken the figure away from every phone. Plan 261003e.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SharePie } from "../src/web/SharePie.js";

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

const LABEL = "About 40% of the piece read so far";
const DETAIL = "Counted in words.";

function card(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="tooltip"]');
}

describe("SharePie", () => {
  it("is a button named by the figure, with no title", () => {
    act(() => root.render(<SharePie share={0.4} label={LABEL} detail={DETAIL} />));
    const button = host.querySelector("button.share-pie");
    expect(button?.getAttribute("aria-label")).toBe(LABEL);
    expect(button?.hasAttribute("title")).toBe(false);
    expect(card()).toBeNull();
  });

  it("opens its card on a click, with the figure and what it counts", () => {
    act(() => root.render(<SharePie share={0.4} label={LABEL} detail={DETAIL} />));
    act(() => host.querySelector<HTMLButtonElement>("button.share-pie")?.click());
    expect(card()?.textContent).toContain(LABEL);
    expect(card()?.textContent).toContain(DETAIL);
  });

  it("opens for keyboard focus and closes on Escape", async () => {
    act(() => root.render(<SharePie share={0.4} label={LABEL} detail={DETAIL} />));
    const button = host.querySelector<HTMLButtonElement>("button.share-pie");
    act(() => button?.focus());
    expect(card()).not.toBeNull();

    act(() => button?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(button?.hasAttribute("aria-describedby")).toBe(false);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(card()).toBeNull();
  });

  it("closes a clicked-open card on an outside pointer press", async () => {
    act(() => root.render(<SharePie share={0.4} label={LABEL} detail={DETAIL} />));
    act(() => host.querySelector<HTMLButtonElement>("button.share-pie")?.click());
    expect(card()).not.toBeNull();

    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(host.querySelector("button.share-pie")?.hasAttribute("aria-describedby")).toBe(false);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(card()).toBeNull();
  });
});
