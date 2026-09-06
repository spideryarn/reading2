/**
 * **Which column ← / → are pointed at, and the three ways of saying it wrong.**
 *
 * Until 2026-09-05 the aim was an underline on the table's `<th>`, beside an
 * `↑↓ SECTIONS` readout in the controls bar. Both went in the same pass — the
 * readout with the rest of the bar's clutter, the header row when it gave up its
 * height — while the keys stayed, at Greg's asking. So the aim moved onto the
 * column itself, as a tint (styles.css § the aimed column).
 *
 * Nothing else can see any of this. It is pure CSS driven by one attribute, and
 * each of the four faults below **renders perfectly** and simply stops showing
 * the reader where the arrows are pointed:
 *
 *   1. a `box-shadow` instead of a `background-image` replaces `.pin-left`'s
 *      overflow-layer shadow rather than composing with it, so a column stops
 *      reading as a layer and the aim is invisible under `td.text`'s opaque
 *      background anyway
 *   2. a matrix written over `.depth-N` misses the **prose** cell, which carries
 *      no such class — and that is the rung the reader reaches by pressing →
 *      all the way, which is the one Greg said he uses
 *   3. **a rule that only names the cells misses the gist columns entirely**,
 *      because in Hierarchy each one is covered by an opaque `position: fixed`
 *      `.ctx-panel` and the cell under it draws nothing. That is the half the
 *      unit checks passed and a browser caught, so both surfaces are named here
 *   4. a matrix that stops at the depths today's articles happen to have goes
 *      quiet on a deeper tree
 *
 * Comments are stripped first, for the reason `tests/prose-centred-in-its-cell.ts`
 * gives at length: this stylesheet quotes its own declarations in prose, so a
 * check that read it raw would be satisfied by a sentence about the code.
 *
 * @see docs/plans/260905d-declutter-the-reading-view-top-bars.md § Stage 3
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readerCssNoComments } from "./helpers/stylesheets.js";

/* The reading-view sheets as a set. Named `src/web/styles.css` until
   2026-09-06, when that file became thirty-eight `@import` lines: a rule that
   moves between sheets must go on being found, and one that is *deleted* must
   still fail. tests/helpers/stylesheets.ts. */
const css = readerCssNoComments();
const tsx = readFileSync(new URL("../src/web/TableView.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/web/App.tsx", import.meta.url), "utf8");

/** The depths the tint has to cover. `buildGeometry` produces three or five. */
const LADDER = [0, 1, 2, 3, 4, 5, 6, 7];

describe("the aimed column", () => {
  it("is one attribute on `.reader`, not a class on thousands of cells", () => {
    /* `.reader` and not the table, because the panels the tint has to reach are
       `position: fixed` siblings of it. App.tsx says so at the call site. */
    expect(app).toContain("data-aim={navDepth}");
    /* And the table is no longer told the aim at all, which is the win that
       came with moving it: `memo(TableView)` reconciles ~2,200 cells and the
       aim changes on every sideways twitch of the pointer. Comments stripped,
       because the prop's absence is explained where it used to be declared. */
    expect(tsx.replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain("navDepth");
    /* The old mechanism, gone from both sides. */
    expect(tsx).not.toContain('"nav-aim"');
    expect(css).not.toContain("nav-aim");
  });

  it("covers every rung of the ladder, on both surfaces", () => {
    for (const depth of LADDER) {
      const rule = ruleFor(depth);
      /* The cell: gist columns with no panel over them (the leaf), and the
         prose. `[data-nav-depth]` and not `.depth-N` is the whole of the prose
         cell's coverage — TableView puts `depth-${depth}` on gist cells only,
         and `data-nav-depth` on both kinds. */
      expect(rule, `depth ${depth} misses the cells`).toContain(
        `td[data-nav-depth="${depth}"]`,
      );
      /* The panel: in Hierarchy every gist column is under an opaque fixed
         `.ctx-panel`, and the cell beneath it draws nothing. Name only the
         cells and pressing ← shows the reader nothing at all. */
      expect(rule, `depth ${depth} misses the panel`).toContain(`.ctx-panel.depth-${depth}`);
      /* And Plain is excluded, or the pointer resting on the only rung there is
         washes the whole article permanently. */
      expect(rule, `depth ${depth} would tint Plain`).toContain(":not(.only-prose)");
    }
    expect(tsx).toContain("data-nav-depth={geometry.leafDepth}");
  });

  it("paints with a background-image, which is what composes with the shadow", () => {
    const body = /\.reader\[data-aim="7"\][^{]*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    /* The vacuity guard, named: two of the three assertions below are
       `not.toContain`, and an empty body satisfies both. */
    expect(body, 'no `.reader[data-aim="7"]` rule in the reader stylesheets').not.toBe("");
    expect(body).toContain("background-image: linear-gradient(");
    /* Not `box-shadow`: `.pin-left` owns that for the overflow-layer cue, and a
       second declaration replaces it. Not `background-color` either: `td.text`,
       `td.gist.active`, `td.gist.continuation` and `.ctx-panel` set opaque
       backgrounds, so the tint has to be a later *layer* rather than the same
       longhand. */
    expect(body).not.toContain("box-shadow");
    expect(body).not.toContain("background-color");
  });
});

/** The one selector line for a depth, out of the comma-separated matrix. */
function ruleFor(depth: number): string {
  const line = css
    .split("\n")
    .find((l) => l.includes(`.reader[data-aim="${depth}"]`));
  expect(line, `no aim selector for depth ${depth}`).toBeDefined();
  return line ?? "";
}
