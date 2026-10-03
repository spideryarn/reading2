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
import { afterEach, describe, expect, it } from "vitest";

import {
  APPEARANCE_KEY,
  DEFAULT_APPEARANCE,
  THEME_COLOR,
  applyTheme,
  parseAppearance,
  resolveTheme,
} from "../src/web/appearance.js";

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
