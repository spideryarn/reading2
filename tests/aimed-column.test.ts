// @vitest-environment jsdom
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
 * **And a fifth, which is why this file stopped grepping and started matching.**
 * Until 2026-09-06 it looked for the substring `.reader[data-aim="N"]` on a
 * line: GPT Sol appended `.never` to all eight selectors — a class no element in
 * this app carries, so the tint could not draw for any reader at any depth — and
 * all three tests here stayed green. A substring of a selector is not a
 * selector. So the selector list is parsed out whole and run against a DOM the
 * shape TableView builds, which is the only check that can tell "names the right
 * things" from "can actually match them".
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
const tsx = readFileSync("src/web/TableView.tsx", "utf8");
/* The reading view, which left `App.tsx` for src/web/reader/Reader.tsx on
   2026-09-06. Named here so that a subject which moves again fails on the read
   rather than on an assertion against the wrong file. */
const reader = readFileSync("src/web/reader/Reader.tsx", "utf8");

/** The depths the tint has to cover. `buildGeometry` produces three or five. */
const LADDER = [0, 1, 2, 3, 4, 5, 6, 7];

describe("the aimed column", () => {
  it("is one attribute on `.reader`, not a class on thousands of cells", () => {
    /* `.reader` and not the table, because the panels the tint has to reach are
       `position: fixed` siblings of it. `Reader` says so at the call site. */
    expect(reader).toContain("data-aim={navDepth}");
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
    const { selectors } = aimRule();
    for (const depth of LADDER) {
      const dom = readerAt(depth);
      /* The cells: gist columns with no panel over them (the leaf), and the
         prose. `[data-nav-depth]` and not `.depth-N` is the whole of the prose
         cell's coverage — TableView puts `depth-${depth}` on gist cells only,
         and `data-nav-depth` on both kinds, so the prose cell here deliberately
         carries no depth class. */
      expect(hits(selectors, dom.gist), `depth ${depth} misses the gist cell`).toBe(1);
      expect(hits(selectors, dom.prose), `depth ${depth} misses the prose cell`).toBe(1);
      /* The panel: in Hierarchy every gist column is under an opaque fixed
         `.ctx-panel`, and the cell beneath it draws nothing. Name only the
         cells and pressing ← shows the reader nothing at all. */
      expect(hits(selectors, dom.panel), `depth ${depth} misses the panel`).toBe(1);
      /* And Plain is excluded, or the pointer resting on the only rung there is
         washes the whole article permanently. The panel is unaffected: Plain has
         none. */
      const plain = readerAt(depth, { plain: true });
      expect(hits(selectors, plain.gist), `depth ${depth} would tint Plain`).toBe(0);
      expect(hits(selectors, plain.prose), `depth ${depth} would tint Plain`).toBe(0);
      /* And the aim points at ONE rung. A matrix that matched every depth would
         satisfy every assertion above while telling the reader nothing. */
      const elsewhere = readerAt(depth === 0 ? 1 : 0);
      elsewhere.reader.setAttribute("data-aim", String(depth));
      expect(hits(selectors, elsewhere.gist), `aim ${depth} leaks onto another rung`).toBe(0);
      expect(hits(selectors, elsewhere.panel), `aim ${depth} leaks onto another rung`).toBe(0);
    }
    expect(tsx).toContain("data-nav-depth={geometry.leafDepth}");
  });

  it("paints with a background-image, which is what composes with the shadow", () => {
    /* `aimRule()` carries the vacuity guard: it fails if the rule is not there
       at all, which matters because two of the three assertions below are
       `not.toContain` and an empty body satisfies both. */
    const { body } = aimRule();
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

/**
 * **The whole rule that paints the tint** — every selector in the matrix, and
 * the declarations.
 *
 * Whole, and not the line the depth happens to sit on, because a selector is
 * only a selector entire: `.reader[data-aim="3"]` is a substring of
 * `.reader[data-aim="3"].never`, of `.reader[data-aim="3"] .nope`, and of a
 * sentence in a comment.
 */
function aimRule(): { selectors: string[]; body: string } {
  const anchor = css.indexOf('.reader[data-aim="0"]');
  expect(anchor, 'no `.reader[data-aim="0"]` selector in the reader stylesheets').toBeGreaterThan(
    -1,
  );
  const open = css.indexOf("{", anchor);
  const close = css.indexOf("}", open);
  expect(open, "the aim selector is not followed by a rule body").toBeGreaterThan(-1);
  expect(close, "the aim rule is never closed").toBeGreaterThan(open);
  /* Back to the end of whatever came before. Comments are stripped already, so
     that is a `}`, a `;`, or the top of the concatenation. */
  const start = Math.max(css.lastIndexOf("}", anchor), css.lastIndexOf(";", anchor)) + 1;
  return {
    selectors: splitSelectors(css.slice(start, open)),
    body: css.slice(open + 1, close),
  };
}

/** A comma-separated selector list, split at the commas that separate it — the
 *  ones outside `:is(…)`, `:not(…)` and the rest, which carry commas of their
 *  own and are most of what this matrix is made of. */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  for (const ch of list) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  out.push(buf.trim());
  return out.filter((s) => s !== "");
}

/**
 * The DOM TableView builds, cut down to the four elements the tint has to reach
 * or avoid: a gist cell (which carries `.depth-N`), a prose cell (which does
 * not), the fixed panel over the gist column, and the `.reader` that says where
 * the arrows point.
 */
function readerAt(
  depth: number,
  opts: { plain?: boolean } = {},
): { reader: Element; gist: Element; prose: Element; panel: Element } {
  document.body.innerHTML = `
    <div class="reader" data-aim="${depth}">
      <table class="zoom${opts.plain ? " only-prose" : ""}"><tbody><tr>
        <td class="gist depth-${depth}" data-nav-depth="${depth}"></td>
        <td class="text" data-nav-depth="${depth}"></td>
      </tr></tbody></table>
      <div class="ctx-panel depth-${depth}"></div>
    </div>`;
  const pick = (sel: string): Element => {
    const el = document.querySelector(sel);
    expect(el, `the fixture has no ${sel}`).not.toBeNull();
    return el as Element;
  };
  return {
    reader: pick(".reader"),
    gist: pick("td.gist"),
    prose: pick("td.text"),
    panel: pick(".ctx-panel"),
  };
}

/** How many of the matrix's selectors this element actually matches. */
function hits(selectors: string[], el: Element): number {
  return selectors.filter((s) => el.matches(s)).length;
}
