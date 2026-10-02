/**
 * **The reading view's page-wide boxes are as wide as the page, not as wide as
 * the window.** Greg, 2026-10-01 (spya-y3747g): *"there's a horizontal scroll
 * bar permanently visible at the bottom of the page on my Mac, even for quite a
 * wide window."*
 *
 * `100vw` counts a classic scrollbar — a Mac with a mouse plugged in, or *Show
 * scroll bars: Always* — and the page beside it is 15px narrower. The masthead
 * and the controls bar were `100vw`-wide sticky boxes, so they stuck out by the
 * scrollbar and the page scrolled sideways; the bottom bar and a covering band
 * are `fixed`, so they did not scroll the page but ran under the scrollbar, and
 * the bottom bar's right end is where the Feedback button sits.
 *
 * Nothing on a Linux box or a trackpad Mac shows it — both have overlay
 * scrollbars that take no width — so this is asserted rather than left to a
 * look. The other half, the layout's own width, is
 * tests/layout-viewport-width.test.tsx.
 * docs/postmortems/261002a-the-reading-view-laid-out-for-the-width-under-the-scrollbar.md.
 *
 * A hand scan rather than a CSS parser, as in voices-css.test.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function css(file: string): string {
  return readFileSync(`src/web/styles/${file}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every declaration block whose selector list is exactly `selector`. */
function blocks(file: string, selector: string): string[] {
  return [...css(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1]!.trim() === selector)
    .map((m) => m[2]!);
}

describe("page-wide boxes beside a classic scrollbar", () => {
  it.each([
    ["shell.css", ".masthead"],
    ["shell.css", ".controls"],
  ])("%s %s is sized from --page-w, which the layout was computed for", (file, selector) => {
    const found = blocks(file, selector).filter((b) => /(^|;)\s*width\s*:/.test(b));
    expect(found.length, `${selector} has one width`).toBe(1);
    expect(found[0]).toMatch(/width\s*:\s*calc\(var\(--page-w\)/);
    expect(found[0]).not.toContain("100vw");
  });

  it.each([
    ["dock.css", ".dock"],
    ["narrow-window.css", ".reader.band-covers .mode-band"],
    // The two full-screen pictures, which hung their right edge under it too.
    ["diagram-sketch.css", ".sk-full"],
    ["diagram-illustrated.css", ".ill-full"],
  ])("%s %s spans the viewport by its edges, not by 100vw", (file, selector) => {
    const found = blocks(file, selector);
    expect(found.length).toBeGreaterThan(0);
    for (const b of found) expect(b).not.toContain("100vw");
    expect(found.some((b) => /(^|;)\s*right\s*:/.test(b))).toBe(true);
  });

  /* Without it the width depends on whether the page scrolls, which the layout
     decides — and Structure's band jump can flip both (GPT Sol, plan 261002a). */
  it("keeps the scrollbar's room whether or not the page scrolls", () => {
    expect(blocks("shell.css", "html").join(";")).toMatch(/scrollbar-gutter\s*:\s*stable/);
  });

  it("is written on .reader by the reader, from the width the layout used", () => {
    const reader = readFileSync("src/web/reader/Reader.tsx", "utf8");
    expect(reader).toMatch(/"--page-w":\s*`\$\{windowWidth\}px`/);
  });
});
