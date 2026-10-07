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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  dock?.remove();
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
  });

  it("lands on the first mode when no radio is checked (a mode from More)", async () => {
    drawDock(null);
    await act(async () => root.render(readingHarnessView(readingHarnessOwner(), false)));
    const link = skipLink();
    if (!link) throw new Error("no skip link");
    await act(async () => link.click());
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Plain");
  });
});
