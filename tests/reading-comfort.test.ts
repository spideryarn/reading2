// @vitest-environment jsdom
/**
 * **Brightness and text size** — src/web/reading-comfort.ts, the copy of its
 * parse that runs before first paint in index.html, the /profile control, and
 * the guard that keeps every font size following the reader's text size.
 * docs/plans/261019g-reading-comfort-on-profile-brightness-and-text-size.md.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BRIGHTNESS,
  TEXT_SIZE,
  type ComfortSetting,
  startReadingComfort,
} from "../src/web/reading-comfort.js";
import { ReadingComfortSettings } from "../src/web/ReadingComfortSettings.js";

const repo = join(import.meta.dirname, "..");
const html = readFileSync(join(repo, "index.html"), "utf8");
const inline = /<script id="appearance-boot">([\s\S]*?)<\/script>/.exec(html)?.[1];

const SETTINGS: readonly ComfortSetting<string>[] = [BRIGHTNESS, TEXT_SIZE];

function runInline(stored: Record<string, string> | "throws"): Document {
  const doc = document.implementation.createHTMLDocument("t");
  const storage = {
    getItem: (k: string) => {
      if (stored === "throws") throw new Error("SecurityError");
      return stored[k] ?? null;
    },
  };
  const matchMedia = () => ({ matches: true });
  new Function("localStorage", "matchMedia", "document", inline!)(storage, matchMedia, doc);
  return doc;
}

afterEach(() => {
  for (const s of SETTINGS) document.documentElement.removeAttribute(s.attribute);
  Reflect.deleteProperty(window, "localStorage");
  vi.restoreAllMocks();
});

describe("the two settings", () => {
  it("default to full brightness and the default size, which set no attribute", () => {
    expect(BRIGHTNESS.fallback).toBe("full");
    expect(TEXT_SIZE.fallback).toBe("default");
    expect(BRIGHTNESS.parse("Dim")).toBe("full");
    expect(TEXT_SIZE.parse(null)).toBe("default");
    expect(TEXT_SIZE.parse("larger")).toBe("larger");
  });
});

describe("index.html's before-paint script", () => {
  for (const s of SETTINGS) {
    for (const value of [...s.values, "wibble", ""]) {
      it(`agrees with ${s.key} for ${JSON.stringify(value)}`, () => {
        const doc = runInline({ [s.key]: value });
        const expected = s.parse(value);
        const attr = doc.documentElement.getAttribute(s.attribute);
        expect(attr).toBe(expected === s.fallback ? null : expected);
      });
    }
  }

  it("sets nothing when storage throws", () => {
    const doc = runInline("throws");
    for (const s of SETTINGS) expect(doc.documentElement.getAttribute(s.attribute)).toBeNull();
    expect(doc.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("every value has a rule, and every rule a value", () => {
  const css = readFileSync(join(repo, "src/web/styles/reading-comfort.css"), "utf8");
  for (const s of SETTINGS) {
    it(`${s.attribute}`, () => {
      const inCss = new Set(
        [...css.matchAll(new RegExp(`\\[${s.attribute}="([a-z]+)"\\]`, "g"))].map((m) => m[1]),
      );
      expect([...inCss].sort()).toEqual(s.values.filter((v) => v !== s.fallback).sort());
    });
  }
  it("the stylesheet is imported", () => {
    expect(readFileSync(join(repo, "src/web/styles.css"), "utf8")).toContain(
      '@import "./styles/reading-comfort.css";',
    );
  });
});

describe("the /profile control", () => {
  it("applies and saves a choice, and says when it could not save", () => {
    const store: Record<string, string> = {};
    let blocked = false;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          if (blocked) throw new DOMException("blocked", "SecurityError");
          store[k] = v;
        },
      },
    });
    const resized = vi.fn();
    window.addEventListener("resize", resized);
    startReadingComfort();
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(createElement(ReadingComfortSettings)));
    const radio = (name: string, value: string) =>
      host.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!;
    expect(radio("brightness", "full").checked).toBe(true);
    expect(radio("text-size", "default").checked).toBe(true);

    act(() => radio("brightness", "dimmest").click());
    expect(document.documentElement.getAttribute("data-brightness")).toBe("dimmest");
    expect(store["spya.brightness"]).toBe("dimmest");

    act(() => radio("text-size", "larger").click());
    expect(document.documentElement.getAttribute("data-text-size")).toBe("larger");
    expect(resized).toHaveBeenCalled();
    expect(host.textContent).toContain("Saved on this device.");

    act(() => radio("text-size", "default").click());
    expect(document.documentElement.hasAttribute("data-text-size")).toBe(false);

    blocked = true;
    act(() => radio("brightness", "dim").click());
    expect(document.documentElement.getAttribute("data-brightness")).toBe("dim");
    expect(host.textContent).toContain("Couldn't save it on this device");

    /* Another tab's write wins over this page's unsaved one. */
    store["spya.brightness"] = "full";
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "spya.brightness" }));
    });
    expect(document.documentElement.hasAttribute("data-brightness")).toBe(false);
    expect(radio("brightness", "full").checked).toBe(true);
    act(() => root.unmount());
    window.removeEventListener("resize", resized);
  });
});

/**
 * **A font size in px does not follow the reader's text size**, which scales
 * the root (typography.md § The reader's text size scales the root). So a new
 * one has to be added here with its reason, or written in rem.
 */
describe("no font size in px outside the allowlist", () => {
  const ALLOWED: Record<string, string> = {
    "src/web/styles/diagram.css": "Force's node labels: diagram.ts budgets each label's width in px",
  };
  const dirs = ["styles", "src/web/styles"];
  const files = dirs.flatMap((d) =>
    readdirSync(join(repo, d))
      .filter((f) => f.endsWith(".css"))
      .map((f) => `${d}/${f}`),
  );
  it("finds the stylesheets", () => expect(files.length).toBeGreaterThan(20));
  for (const f of files) {
    it(f, () => {
      const css = readFileSync(join(repo, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      /* A px floor beside a rem — narrow-window.css's `max(1rem, 16px)`, the
         iOS focus-zoom threshold — still grows with the root, so it passes. */
      const px = [...css.matchAll(/font-size:\s*([^;]*\d+(?:\.\d+)?px[^;]*)/g)]
        .map((m) => m[0])
        .filter((decl) => !/max\([^)]*rem/.test(decl));
      if (f in ALLOWED) return;
      expect(px).toEqual([]);
    });
  }
});

/**
 * **A text-size change reflows every paragraph without changing a width**, so
 * the reader's `layoutKey` has to carry the root size or `useReadingPosition`
 * takes the rewrap for "nothing moved" and the reader loses their place (GPT
 * Sol, plan review of 261019g, P1). How a key change puts the reader back is
 * tests/reading-position-holds-across-a-reflow.test.tsx; this checks the key.
 */
describe("the reader's layout key", () => {
  it("carries the root font size", () => {
    const src = readFileSync(join(repo, "src/web/reader/Reader.tsx"), "utf8");
    const key = /const layoutKey = `([^`]*)`/.exec(src)?.[1];
    expect(key).toBeTruthy();
    expect(key).toContain("${rootFontPx}");
  });
});
