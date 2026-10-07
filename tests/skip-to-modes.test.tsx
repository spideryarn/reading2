// @vitest-environment jsdom
/**
 * **"Skip to modes" is the reading view's first Tab stop, and it lands on the
 * mode switcher** — plan 261007h § F5b. A keyboard reader otherwise passes the
 * spine's slivers and every paragraph's buttons before reaching the dock.
 *
 * The real `Reader` in tests/helpers/reader-reading-harness.tsx's composition,
 * which mocks the `Dock` away; so the dock's radiogroup is drawn here by hand,
 * with the class and role `Dock.tsx` gives it (`.dock-modes-radios`,
 * `role="radiogroup"`). That the real bar still carries them is the browser
 * check's, and `SKIP_TARGET` is the one place the selector is written.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contrast, PALETTE } from "./helpers/theme-palette.js";
import { readingHarnessOwner, readingHarnessView } from "./helpers/reader-reading-harness.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoResize as unknown as typeof ResizeObserver;

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

let host: HTMLDivElement;
let dock: HTMLDivElement;
let root: Root;
let styles: HTMLStyleElement;

/** The dock's radiogroup as `Dock.tsx` draws it: every radio a tab stop. */
function drawDock(checked: number | null) {
  dock = document.createElement("div");
  dock.className = "dock-modes-radios";
  dock.setAttribute("role", "radiogroup");
  for (const [i, name] of ["Plain", "Structure", "Glossary"].entries()) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(i === checked));
    b.setAttribute("aria-label", name);
    dock.append(b);
  }
  document.body.append(dock);
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  styles = document.createElement("style");
  styles.textContent = readFileSync("src/web/styles/dock.css", "utf8");
  document.head.append(styles);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  dock?.remove();
  styles.remove();
});

const skipLink = () => host.querySelector<HTMLAnchorElement>(".skip-to-modes");

describe("Skip to modes", () => {
  it("is the first focusable element in the reader", async () => {
    drawDock(1);
    await act(async () => root.render(readingHarnessView(readingHarnessOwner(), false)));
    const first = host.querySelector(FOCUSABLE);
    expect(first).not.toBeNull();
    expect(first).toBe(skipLink());
    expect(first?.textContent).toBe("Skip to modes");
    /* jsdom draws no spine slivers (they need layout), so "first focusable"
       alone could pass with nothing else to come before it. Pin the stronger
       fact: it is the reader's first child, ahead of the spine, the masthead
       and the prose, whatever they turn out to hold in a real browser. No
       positive `tabindex` anywhere, which would jump the queue. */
    expect(host.querySelector(".reader")?.firstElementChild).toBe(first);
    expect(host.querySelector('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')).toBeNull();
  });

  it("moves focus to the checked mode radio", async () => {
    drawDock(1);
    await act(async () => root.render(readingHarnessView(readingHarnessOwner(), false)));
    const link = skipLink();
    if (!link) throw new Error("no skip link");
    link.focus();
    await act(async () => link.click());
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Structure");
    expect(location.hash).toBe("");
  });

  it("lands on the first mode when no radio is checked (a mode from More)", async () => {
    drawDock(null);
    await act(async () => root.render(readingHarnessView(readingHarnessOwner(), false)));
    const link = skipLink();
    if (!link) throw new Error("no skip link");
    await act(async () => link.click());
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Plain");
  });

  it("offers a real, focusable fragment destination for native link activation", async () => {
    drawDock(1);
    await act(async () => root.render(readingHarnessView(readingHarnessOwner(), false)));
    const href = skipLink()?.getAttribute("href");
    expect(href).toMatch(/^#[a-z][\w-]+$/);
    const destination = document.getElementById(href!.slice(1));
    expect(destination).toBe(dock.querySelector('[role="radio"]'));
    expect(destination?.tagName).toBe("BUTTON");
  });

  it("makes the entering dock focusable before transferring focus, and keeps it available after blur", async () => {
    drawDock(1);
    const bar = document.createElement("div");
    bar.className = "dock dock-enter";
    dock.replaceWith(bar);
    bar.append(dock);
    const hint = document.createElement("div");
    hint.className = "install-hint dock-enter";
    bar.append(hint);
    try {
      await act(async () => root.render(readingHarnessView(readingHarnessOwner(), false)));
      const radio = dock.children[1] as HTMLButtonElement;
      expect(getComputedStyle(radio).visibility).toBe("hidden");
      const focus = radio.focus.bind(radio);
      // jsdom does not enforce CSS visibility when focusing. Model that one
      // browser constraint, using the real stylesheet's computed value.
      vi.spyOn(radio, "focus").mockImplementation(() => {
        if (getComputedStyle(radio).visibility === "visible") focus();
      });
      skipLink()!.focus();
      await act(async () => skipLink()!.click());
      expect(document.activeElement).toBe(radio);
      expect(getComputedStyle(hint).visibility).toBe("visible");
      radio.blur();
      expect(getComputedStyle(radio).visibility).toBe("visible");
    } finally {
      bar.remove();
    }
  });

  it("hides the control in print, including while focused", () => {
    const css = styles.textContent!;
    expect(css).toMatch(/@media print\s*\{\s*\.skip-to-modes\s*\{\s*display:\s*none;/);
  });

  it.each(["dark", "light"] as const)("has a legible focus indicator in %s", (theme) => {
    expect(styles.textContent).toMatch(/\.skip-to-modes:focus\s*\{[^}]*outline:\s*2px solid var\(--highlight-text\)/);
    expect(contrast("--highlight-text", "--surface-raised", PALETTE[theme])).toBeGreaterThanOrEqual(3);
    expect(contrast("--highlight-text", "--page", PALETTE[theme])).toBeGreaterThanOrEqual(3);
    expect(contrast("--ink", "--surface-raised", PALETTE[theme])).toBeGreaterThanOrEqual(4.5);
  });
});
