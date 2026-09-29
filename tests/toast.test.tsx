// @vitest-environment jsdom
/**
 * **The toast: it goes by itself, it waits while you are reading it, and it
 * goes when you say so.** docs/plans/260929f-feedback-thank-you-as-a-toast-and-dictation-that-never-runs-out-of-tape.md
 * § Part A.
 *
 * Fake timers, because "about five seconds" is the thing under test and a real
 * five-second wait per case is the kind of test that gets skipped.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toast, TOAST_MS, type ToastMessage } from "../src/web/Toast.js";
import { readerSheets, stripComments } from "./helpers/stylesheets.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let dismissed: number;

function render(toast: ToastMessage | null) {
  act(() => {
    root.render(createElement(Toast, { toast, onDismiss: () => (dismissed += 1) }));
  });
}

function card(): HTMLElement | null {
  return host.querySelector(".toast");
}

beforeEach(() => {
  vi.useFakeTimers();
  dismissed = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("Toast", () => {
  it("is a polite live region that is there before anything is said in it", () => {
    render(null);
    /* A live region added together with its words is often not announced at
       all, so the region is in the document from the start and only its
       contents change. */
    const region = host.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(card()).toBeNull();

    render({ id: 1, text: "Thank you." });
    expect(host.querySelector('[role="status"]')).toBe(region);
    expect(region?.textContent).toContain("Thank you.");
  });

  it("goes by itself after about five seconds", () => {
    render({ id: 1, text: "Thank you." });
    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(dismissed).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(dismissed).toBe(1);
    expect(TOAST_MS).toBeGreaterThanOrEqual(4000);
    expect(TOAST_MS).toBeLessThanOrEqual(7000);
  });

  it("waits while the pointer is over it, and only counts the time that is left", () => {
    render({ id: 1, text: "Thank you." });
    act(() => vi.advanceTimersByTime(2000));
    act(() => card()?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    act(() => vi.advanceTimersByTime(60_000));
    expect(dismissed, "it went while being read").toBe(0);

    act(() => card()?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    act(() => vi.advanceTimersByTime(TOAST_MS - 2000 - 1));
    expect(dismissed).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(dismissed).toBe(1);
  });

  it("waits while focus is inside it", () => {
    render({ id: 1, text: "Thank you." });
    const close = host.querySelector<HTMLButtonElement>(".toast-close");
    if (!close) throw new Error("no close button");
    act(() => close.focus());
    act(() => vi.advanceTimersByTime(60_000));
    expect(dismissed).toBe(0);

    act(() => close.blur());
    act(() => vi.advanceTimersByTime(TOAST_MS));
    expect(dismissed).toBe(1);
  });

  it("goes at once when its close button is pressed", () => {
    render({ id: 1, text: "Thank you." });
    const close = host.querySelector<HTMLButtonElement>(".toast-close");
    expect(close?.getAttribute("aria-label")).toBeTruthy();
    act(() => close?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(dismissed).toBe(1);
  });

  it("does not take focus when it appears", () => {
    const before = document.createElement("button");
    document.body.append(before);
    before.focus();
    render({ id: 1, text: "Thank you." });
    expect(document.activeElement).toBe(before);
    before.remove();
  });

  it("starts the clock again for a new message", () => {
    render({ id: 1, text: "First." });
    act(() => vi.advanceTimersByTime(TOAST_MS - 100));
    render({ id: 2, text: "Second." });
    act(() => vi.advanceTimersByTime(TOAST_MS - 100));
    expect(dismissed).toBe(0);
    expect(card()?.textContent).toContain("Second.");
    act(() => vi.advanceTimersByTime(100));
    expect(dismissed).toBe(1);
  });

  it("has one clock in StrictMode and clears it on unmount", () => {
    act(() => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(Toast, {
            toast: { id: 1, text: "Thank you." },
            onDismiss: () => (dismissed += 1),
          }),
        ),
      );
    });
    act(() => vi.advanceTimersByTime(TOAST_MS));
    expect(dismissed, "StrictMode left two live timers").toBe(1);

    render({ id: 2, text: "Another." });
    act(() => root.unmount());
    act(() => vi.advanceTimersByTime(TOAST_MS));
    expect(dismissed, "an unmounted toast still fired").toBe(1);
  });

  it("follows the dock's current position without entering the home-indicator area", () => {
    const sheet = readerSheets().find((entry) => entry.path === "src/web/styles/feedback.css");
    expect(sheet, "feedback.css is no longer loaded").toBeDefined();
    const css = stripComments(sheet!.css);
    const rule = css.match(/\.toast\s*\{([^}]*)\}/)?.[1];
    expect(rule, "no base .toast rule").toBeDefined();
    expect(rule).toContain(
      "bottom: calc(max(var(--dock-bottom), var(--safe-bottom)) + var(--hint-now) + 0.75rem)",
    );
  });
});
