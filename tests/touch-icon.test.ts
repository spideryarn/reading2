// @vitest-environment jsdom
/**
 * **The home-screen icon follows the phone's mode, dark by default** —
 * index.html's `touch-icon-boot` script, run as written against a stubbed
 * `matchMedia`. iOS takes the `apple-touch-icon` link's live `href` when the
 * page is added to the home screen (WebKit's LinkIconCollector reads the DOM
 * and ignores `media`), so the script is the switch and the static `href` is
 * the default. docs/plans/261026i-home-screen-icon-follows-the-phone-mode-dark-by-default.md.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const inline = /<script id="touch-icon-boot">([\s\S]*?)<\/script>/.exec(html)?.[1];

function headOf(source: string): HTMLHeadElement {
  return new DOMParser().parseFromString(source, "text/html").head;
}

const staticHref = headOf(html).querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href");

interface FakeQuery { matches: boolean; addEventListener: (type: string, fn: () => void) => void }

/** Run the script with the phone in `mode`; returns the link and a way to change the mode. */
function run(mode: "light" | "dark" | "neither" | "no matchMedia" | "throws") {
  const doc = document.implementation.createHTMLDocument("t");
  const link = doc.createElement("link");
  link.setAttribute("rel", "apple-touch-icon");
  link.setAttribute("href", staticHref ?? "");
  doc.head.append(link);
  const listeners: (() => void)[] = [];
  let current: string = mode;
  const matchMedia = mode === "no matchMedia" ? undefined : (q: string): FakeQuery => {
    if (mode === "throws") throw new Error("matchMedia");
    return {
      get matches() { return q === `(prefers-color-scheme: ${current})`; },
      addEventListener: (_type, fn) => { listeners.push(fn); },
    };
  };
  new Function("matchMedia", "document", inline!)(matchMedia, doc);
  return {
    href: () => link.getAttribute("href"),
    change(to: "light" | "dark") { current = to; for (const fn of listeners) fn(); },
  };
}

describe("index.html's touch-icon-boot", () => {
  it("is there, directly in <head>, after the link it changes", () => {
    expect(inline).toBeTruthy();
    const head = headOf(html);
    const link = head.querySelector('link[rel="apple-touch-icon"]');
    const script = head.querySelector("#touch-icon-boot");
    expect(link?.parentElement).toBe(head);
    expect(script?.parentElement).toBe(head);
    expect(link!.compareDocumentPosition(script!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(head.querySelectorAll('link[rel="apple-touch-icon"]')).toHaveLength(1);
  });

  it("defaults to the dark tile in the static markup", () => {
    expect(staticHref).toMatch(/^\/apple-touch-icon\.png(\?v=\d+)?$/);
  });

  it("swaps to the light tile on a light phone", () => {
    expect(run("light").href()).toMatch(/^\/apple-touch-icon-light\.png(\?v=\d+)?$/);
  });

  // By the spec "no preference" matches light, so it gets the cream tile; dark is
  // for a dark phone and for anything that cannot say.
  for (const mode of ["dark", "neither", "no matchMedia", "throws"] as const) {
    it(`keeps the dark tile when the phone's mode is ${mode}`, () => {
      expect(run(mode).href()).toBe(staticHref);
    });
  }

  it("follows a change of mode while the page is open, both ways", () => {
    const page = run("dark");
    page.change("light");
    expect(page.href()).toMatch(/apple-touch-icon-light/);
    page.change("dark");
    expect(page.href()).toBe(staticHref);
  });

  it("names files that exist", () => {
    for (const href of [staticHref, run("light").href()]) {
      expect(existsSync(join(ROOT, "public", (href ?? "").replace(/\?.*$/, "").slice(1)))).toBe(true);
    }
  });
});
