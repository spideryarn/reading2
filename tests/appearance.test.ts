// @vitest-environment jsdom
/**
 * **Light, Dark or System** — src/web/appearance.ts, and the copy of its
 * resolve that runs before first paint in index.html.
 *
 * The inline script cannot import anything, so it is a second copy of
 * `resolveTheme` by necessity. The test that matters here runs *that exact
 * script*, lifted out of index.html, against every stored value and both OS
 * settings, and checks it lands on the same theme as the module. Change one
 * without the other and this goes red.
 * docs/plans/261003e-light-dark-and-system-appearance-on-profile.md.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  APPEARANCE_KEY,
  DEFAULT_APPEARANCE,
  THEME_COLOR,
  applyTheme,
  parseAppearance,
  resolveTheme,
  startAppearance,
} from "../src/web/appearance.js";
import { AppearanceSetting } from "../src/web/AppearanceSetting.js";

const html = readFileSync(join(import.meta.dirname, "..", "index.html"), "utf8");
const inline = /<script id="appearance-boot">([\s\S]*?)<\/script>/.exec(html)?.[1];

function freshDocument(): Document {
  const doc = document.implementation.createHTMLDocument("t");
  for (const [name, content] of [
    ["color-scheme", "dark"],
    ["theme-color", "#0a0a0a"],
  ] as const) {
    const m = doc.createElement("meta");
    m.setAttribute("name", name);
    m.setAttribute("content", content);
    doc.head.append(m);
  }
  return doc;
}

/** Run the inline script with a stored value (or a throwing store) and an OS setting. */
function runInline(stored: string | null | "throws", osDark: boolean): Document {
  const doc = freshDocument();
  const storage = {
    getItem: (k: string) => {
      if (stored === "throws") throw new Error("SecurityError");
      return k === APPEARANCE_KEY ? stored : null;
    },
  };
  const matchMedia = (q: string) => ({ matches: q === "(prefers-color-scheme: dark)" && osDark });
  new Function("localStorage", "matchMedia", "document", inline!)(storage, matchMedia, doc);
  return doc;
}

afterEach(() => {
  delete document.documentElement.dataset.theme;
  Reflect.deleteProperty(window, "localStorage");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("index.html's before-paint script", () => {
  it("is there, and runs before the stylesheet and the app", () => {
    expect(inline).toBeTruthy();
    const at = html.indexOf('id="appearance-boot"');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(html.indexOf("/src/web/boot.tsx"));
    expect(html).toMatch(/<html lang="en" data-theme="dark">/);
  });

  const stored = [null, "system", "light", "dark", "wibble", "", "throws"] as const;
  for (const value of stored) {
    for (const osDark of [true, false]) {
      it(`agrees with resolveTheme for ${JSON.stringify(value)} on a ${osDark ? "dark" : "light"} OS`, () => {
        const doc = runInline(value, osDark);
        const expected = resolveTheme(
          value === "throws" ? DEFAULT_APPEARANCE : parseAppearance(value),
          osDark,
        );
        expect(doc.documentElement.getAttribute("data-theme")).toBe(expected);
        expect(doc.querySelector('meta[name="color-scheme"]')?.getAttribute("content")).toBe(
          expected,
        );
        expect(doc.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
          THEME_COLOR[expected],
        );
      });
    }
  }
});

describe("resolveTheme and parseAppearance", () => {
  it("an unchosen or unreadable value is Dark, which is what everyone had before", () => {
    expect(DEFAULT_APPEARANCE).toBe("dark");
    expect(parseAppearance(null)).toBe("dark");
    expect(parseAppearance("Light")).toBe("dark");
  });

  it("System follows the OS; Light and Dark ignore it", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("applyTheme", () => {
  it("writes the attribute and both metas", () => {
    const doc = freshDocument();
    applyTheme("light", doc);
    expect(doc.documentElement.dataset.theme).toBe("light");
    expect(doc.querySelector('meta[name="color-scheme"]')?.getAttribute("content")).toBe("light");
    expect(doc.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#fafafa");
  });
});

describe("the live appearance", () => {
  it("keeps an unsaved System choice through OS changes and a bfcache restore", () => {
    let osDark = false;
    let stored = "light";
    let mediaChange: () => void = () => {
      throw new Error("System listener was not installed");
    };
    let pageShow: (event: PageTransitionEvent) => void = (_event) => {
      throw new Error("pageshow listener was not installed");
    };
    let storageChange: (event: StorageEvent) => void = (_event) => {
      throw new Error("storage listener was not installed");
    };

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => (key === APPEARANCE_KEY ? stored : null),
        setItem: () => {
          throw new DOMException("blocked", "SecurityError");
        },
      },
    });
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return osDark;
      },
      addEventListener: (_type: string, listener: () => void) => {
        mediaChange = listener;
      },
    }));
    vi.spyOn(window, "addEventListener").mockImplementation((type, listener) => {
      if (type === "pageshow") pageShow = listener as (event: PageTransitionEvent) => void;
      if (type === "storage") storageChange = listener as (event: StorageEvent) => void;
    });

    startAppearance();
    expect(document.documentElement.dataset.theme).toBe("light");
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(createElement(AppearanceSetting)));
    const radio = (value: string) => host.querySelector<HTMLInputElement>(`input[value="${value}"]`)!;
    expect(radio("light").checked).toBe(true);
    expect(host.textContent).toContain("Saved on this device.");

    act(() => radio("system").click());
    expect(radio("system").checked).toBe(true);
    expect(host.textContent).toContain("Couldn't save it on this device");

    osDark = true;
    act(() => mediaChange());
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(radio("system").checked).toBe(true);
    expect(host.textContent).toContain("Couldn't save it on this device");

    act(() => pageShow({ persisted: true } as PageTransitionEvent));
    osDark = false;
    act(() => mediaChange());
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(radio("system").checked).toBe(true);

    /* A real cross-tab write supersedes both the page-only choice and its
       failure message. */
    stored = "dark";
    act(() => storageChange({ key: APPEARANCE_KEY } as StorageEvent));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(radio("dark").checked).toBe(true);
    expect(host.textContent).toContain("Saved on this device.");
    act(() => root.unmount());
  });
});
