/**
 * **The three legs the centred reading column stands on, none of which
 * `tests/layout.test.ts` can see.**
 *
 * Plain mode centres the article — Greg, 2026-09-03: *"In Plain mode, can you
 * centre the text on the page?"* — and it takes three things that live in three
 * files: `fitView` caps the column (`PROSE_ALONE_MAX_REM`, tested next door),
 * `Reader` turns `fit.alone` into a `text-alone` class and writes `--table-w`,
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
import { DEFAULT_ROOT_PX, proseAloneMaxPx } from "../src/web/layout.js";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

/** Block comments only — enough for CSS, and for the JSDoc and `/* … *\/` in App. */
const stripBlockComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "");
/** And the line comments the reading view also uses. */
const stripLineComments = (src: string) => src.replace(/^[^\n"'`]*\/\/[^\n]*$/gm, "");

const css = stripBlockComments(read("../src/web/styles.css"));
/* The reading view, which left `App.tsx` for src/web/reader/Reader.tsx on
   2026-09-06. The read is what fails if it moves again — an assertion pointed
   at the wrong file would simply stop finding what it is looking for. */
const reader = stripLineComments(stripBlockComments(read("../src/web/reader/Reader.tsx")));

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

  it("the masthead is centred on the prose's axis, not on the cell's", () => {
    const r = rule(".reader.text-alone .masthead-inner");
    expect(r).toContain("margin-inline: auto");
    /* **`--reading-measure`, and NOT `--table-w`.** This assertion is inverted
       from the one it replaces, and the inversion is the finding. The rule used
       to be the reading *cell* — `--table-w` less its two pads — which was the
       right box for exactly as long as the prose filled its cell. On 2026-09-04
       `.prose` started dividing the leftover inside that cell
       (`tests/prose-centred-in-its-cell.test.ts`), and the same week the gutter
       became a 2 × 2 pad and `--text-pad-l` grew from 33.6px to 59.2px. Both
       moved the prose right, neither moved the title, and the errors added:
       measured at **22.5px** of misalignment at a 1280 window, against the 4px
       this rule's comment still claimed.

       Neither branch's tests could have caught it, and this file is the reason
       why — it asserted `--table-w` was present, which was true of the broken
       rule. So the assertion now names the *other* box. */
    expect(r).not.toContain("var(--table-w)");
    expect(r).toContain("var(--reading-measure)");
    /* The cell's asymmetric padding, subtracted the way it is *signed* rather
       than merely mentioned: the prose sits half their difference right of the
       table's centre, so a box on the same axis loses twice that. Written out
       because `toContain` on the two names separately was satisfied by the rule
       that was wrong. */
    expect(r).toContain("var(--text-pad-r) - var(--text-pad-l)");
    /* `65ch` counts the chrome's zeroes without this — the same line, and the
       same reason, as the sibling rule and `.blk-gutter` both carry. */
    expect(r).toContain("font-size: var(--reading-size)");
  });

  it("the cell's padding is the same two tokens the masthead subtracts", () => {
    /* The point of naming them: `td.text` and the masthead rule must agree, and
       before 2026-09-03 the cell carried the literals. Asserted as the whole
       shorthand rather than through `rule()`, because there are two `td.text`
       rules and only one of them is about padding. */
    expect(css).toContain(
      "padding: var(--block-pad) var(--text-pad-r) var(--block-pad) var(--text-pad-l)",
    );
    /* The left one stopped being a literal on 2026-09-04: it is the prose
       gutter's column and nothing else, so it is computed from the gutter rather
       than restated beside it. What matters to *this* file is only that the
       masthead and the cell still name the same token. */
    expect(css).toContain("--text-pad-l: calc(var(--blk-gutter-w) + var(--blk-gutter-x) * 2)");
    expect(css).toContain("--text-pad-r: 1.4rem");
  });

  it("and the cap in layout.ts is wide enough to hold them plus the measure", () => {
    /* **The one arithmetic tie between this stylesheet and layout.ts, and it
       goes stale silently.** The cap is documented as the measure plus these two
       pads, so widening either without raising it takes the difference off a lone
       prose column's line length — and nothing renders differently enough to
       notice. It happened on 2026-09-04, when the gutter became a 2 × 2 pad and
       `--text-pad-l` went 2.1rem → 3.7rem; GPT Sol found it by reading, which is
       the only way it could have been found. It went the other way on 2026-09-05
       — 3.7rem → 2.2rem, when the pad became one column that truncates — and
       this test caught *that* one by going red, which is what it is for.

       **The inequality itself is checked at five root font sizes in
       `tests/gutter-target-size.test.ts`**, which is where it belongs now that
       the left pad is not a rem constant — below a 16px root the gutter's px
       floor makes it *wider* in rem, so one number cannot be right everywhere.
       Given a fact one home; what is left here is the default root, so this
       file's own story stays readable. */
    const MEASURE_REM = 46;
    const padR = Number(/--text-pad-r:\s*([\d.]+)rem/.exec(css)?.[1]);
    const padL = 2.2; // max(1.5rem, 24px) + 2 × 0.35rem, at a 16px root
    expect(proseAloneMaxPx(DEFAULT_ROOT_PX)).toBeGreaterThanOrEqual(
      (MEASURE_REM + padL + padR) * DEFAULT_ROOT_PX,
    );
    // And not so generous that the column stops looking capped at all: the
    // rounding runs upwards by design, but by under a rem.
    expect(proseAloneMaxPx(DEFAULT_ROOT_PX)).toBeLessThan(
      (MEASURE_REM + padL + padR + 1) * DEFAULT_ROOT_PX,
    );
  });

  it("Reader writes the class and the width the stylesheet reads", () => {
    // The class comes from `fit.alone` rather than from a second copy of the
    // condition — the mistake `proseVisible` exists because of.
    expect(reader).toMatch(/fit\.alone \? " text-alone" : ""/);
    expect(reader).toMatch(/"--table-w": `\$\{fit\.tableW\}px`/);
  });

  it("and hands fitView the root font size the page is painted at", () => {
    // Without this the cap is a px number that is only right at a 16px root, and
    // a reader with a larger default font loses a quarter of their measure.
    expect(reader).toContain("useRootFontPx()");
    expect(reader).toMatch(/^\s*rootFontPx,$/m);
  });
});
