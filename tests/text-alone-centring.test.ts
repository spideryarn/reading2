/**
 * **The three legs the centred reading column stands on, none of which
 * `tests/layout.test.ts` can see.**
 *
 * Plain mode centres the article — Greg, 2026-09-03: *"In Plain mode, can you
 * centre the text on the page?"* — and it takes three things that live in three
 * files: `fitView` caps the column (`PROSE_ALONE_MAX_REM`, tested next door),
 * `App.tsx` turns `fit.alone` into a `text-alone` class and writes `--table-w`,
 * and `styles.css` centres the table and the masthead with those. **Delete
 * either of the last two and all 31 layout tests stay green while the page is
 * back where it started** — GPT Sol's third finding on the built code, 2026-09-03.
 *
 * So this is a wiring check, in the same species as `tests/spine-width.test.ts`
 * and `tests/doc-links.test.ts`: cheap, deterministic, and standing where the
 * compiler cannot. **What it cannot see is whether the browser centres
 * anything** — that is a rendered check, and the measurements are in
 * docs/plans/plain-mode-and-the-way-out.md § Centring the column.
 *
 * Comments are stripped from both files before anything is asserted, for the
 * reason that file gives at length: both are full of prose quoting the very
 * declarations under test, so a check that read them raw would be satisfied by a
 * sentence describing what the code used to do.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

/** Block comments only — enough for CSS, and for the JSDoc and `/* … *\/` in App. */
const stripBlockComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "");
/** And the line comments App.tsx also uses. */
const stripLineComments = (src: string) => src.replace(/^[^\n"'`]*\/\/[^\n]*$/gm, "");

const css = stripBlockComments(read("../src/web/styles.css"));
const app = stripLineComments(stripBlockComments(read("../src/web/App.tsx")));

/**
 * One CSS rule body, by selector, with whitespace flattened.
 *
 * **Anchored to the start of a line**, because `td.text` is also the tail of
 * `tr.row-active td.text` and a dozen other descendant selectors — the first
 * version of this helper read the wrong rule and failed on a declaration that
 * was perfectly correct twenty lines further down.
 */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css);
  expect(found, `no rule for \`${selector}\` in styles.css`).not.toBeNull();
  return (found?.[1] ?? "").replace(/\s+/g, " ").trim();
}

describe("the article on its own is centred", () => {
  it("the table takes the leftover on both sides", () => {
    // `margin-inline: auto` is the whole of it — the width it divides is
    // `PROSE_ALONE_MAX_REM`, applied in layout.ts.
    expect(rule(".reader.text-alone table.zoom")).toContain("margin-inline: auto");
  });

  it("the masthead is the same width and centred with it", () => {
    const r = rule(".reader.text-alone .masthead-inner");
    expect(r).toContain("margin-inline: auto");
    // From `fit.tableW`, so `PROSE_ALONE_MAX_REM` is not copied into CSS.
    expect(r).toContain("var(--table-w)");
    // Inside the cell's own padding, so the title starts where the prose does.
    expect(r).toContain("var(--text-pad-l)");
    expect(r).toContain("var(--text-pad-r)");
  });

  it("the cell's padding is the same two tokens the masthead subtracts", () => {
    /* The point of naming them: `td.text` and the masthead rule must agree, and
       before 2026-09-03 the cell carried the literals. Asserted as the whole
       shorthand rather than through `rule()`, because there are two `td.text`
       rules and only one of them is about padding. */
    expect(css).toContain(
      "padding: var(--block-pad) var(--text-pad-r) var(--block-pad) var(--text-pad-l)",
    );
    expect(css).toContain("--text-pad-l: 2.1rem");
    expect(css).toContain("--text-pad-r: 1.4rem");
  });

  it("App writes the class and the width the stylesheet reads", () => {
    // The class comes from `fit.alone` rather than from a second copy of the
    // condition — the mistake `proseVisible` exists because of.
    expect(app).toMatch(/fit\.alone \? " text-alone" : ""/);
    expect(app).toMatch(/"--table-w": `\$\{fit\.tableW\}px`/);
  });

  it("and hands fitView the root font size the page is painted at", () => {
    // Without this the cap is a px number that is only right at a 16px root, and
    // a reader with a larger default font loses a quarter of their measure.
    expect(app).toContain("useRootFontPx()");
    expect(app).toMatch(/^\s*rootFontPx,$/m);
  });
});
