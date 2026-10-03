/**
 * **The headings breadcrumb on a narrow window: three lines in a taller bar.**
 *
 * Three facts a browser pass would see only by accident, read off the
 * stylesheets the way tests/spine-width.test.ts reads its own:
 *
 *  - the breadcrumb's narrow rules sit under narrow-window.css's query and no
 *    other, so "narrow" goes on meaning one width;
 *  - `--bar-h` is raised in exactly one place, under a selector that needs the
 *    breadcrumb to be in the bar, inside that query — so a visitor's chip-only
 *    bar, and every bar on a wide window, stays the default height;
 *  - the crumb allowed to wrap is the current one, and only there.
 *
 * What this cannot see is whether anything is cut on screen. That is the
 * browser check in
 * docs/plans/261003n-where-am-i-rail-on-two-or-three-lines-on-a-phone-in-portrait-and-a-phone-portrait-doc.md.
 */
import { describe, expect, it } from "vitest";
import { allSheets, enclosing, readerSheets, stripComments } from "./helpers/stylesheets.js";
import { NARROW_WINDOW_MAX } from "../src/web/layout.js";

/** § a narrow window's query, from the constants spine-width.test.ts pins it to. */
const NARROW = `@media (max-width: ${NARROW_WINDOW_MAX}px)`;
const HOLDS_CRUMBS = ":root:has(:where(.reader) > .controls > .crumbs)";

const sheet = readerSheets().find((s) => s.path.endsWith("/crumbs.css"));
const crumbs = stripComments(sheet?.css ?? "");
const everything = stripComments(
  allSheets()
    .map((s) => s.css)
    .join("\n"),
);

/** Every place `needle` is declared in `source`, as its enclosing chain. */
function chains(source: string, needle: RegExp): string[][] {
  return [...source.matchAll(needle)].map((m) => enclosing(source, m.index));
}

describe("the breadcrumb's narrow rules", () => {
  it("sit under the narrow-window query, and crumbs.css has no other", () => {
    expect(sheet, "crumbs.css is in the reader sheets").toBeDefined();
    const queries = [...crumbs.matchAll(/@media[^{]*/g)].map((m) => m[0].trim());
    expect(queries).toEqual([NARROW]);
  });

  it("raise --bar-h only while the bar holds the breadcrumb, and only there", () => {
    const decls = chains(everything, /--bar-h:/g);
    /* Two: the default on `:root` in tokens.css, and the raised one. A third is
       somebody raising the bar for a second reason, which `layoutKey` in
       Reader.tsx would not hear about. */
    expect(decls.length).toBe(2);
    const raised = decls.filter((c) => c.length > 1);
    expect(raised).toEqual([[HOLDS_CRUMBS, NARROW]]);
    expect(crumbs).toMatch(/--bar-h:\s*4\.25rem;/);
  });

  it("let the current crumb wrap to two lines, and no other", () => {
    const wraps = chains(crumbs, /white-space:\s*normal/g);
    expect(wraps.length).toBe(1);
    expect(wraps[0]?.[0]).toContain("[aria-current]");
    expect(wraps[0]?.slice(1)).toEqual([NARROW]);
    const clamps = chains(crumbs, /-webkit-line-clamp:\s*2;/g);
    expect(clamps.length).toBe(1);
    expect(clamps[0]?.[0]).toContain("[aria-current]");
    expect(clamps[0]?.slice(1)).toEqual([NARROW]);
  });
});
