/**
 * **Structure's two columns get a band of their own width, and only when they fit.**
 *
 * Until 2026-09-28 every mode's band was 288–400px, so Structure's two columns
 * were never wider than ~181px each (column B ~170px inside its bracket), on
 * any screen, at 13px type — Greg: *"the 2-column mode is a little hard to read
 * because the text is small the columns are really narrow."* Now a Structure
 * band jumps from the ordinary width straight to one that holds two columns of
 * at least 17rem of content each, and nothing in between.
 *
 * The one thing that must not happen is **a band `fitMode` hands out that
 * `structureFace` then measures as the other face** — a 609px band drawn as the
 * list, or a 400px band drawn as two 181px columns again. Both read the one
 * threshold in layout.ts; the sweep below is what holds them to it.
 *
 * docs/plans/260928a-structure-two-columns-readable.md
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROOT_PX,
  fitView,
  type FitInput,
  MODE_IDEAL,
  PROSE_MIN,
  SPINE_W,
  STRUCT_BRACKET_INSET_REM,
  STRUCT_BRACKET_PX,
  STRUCT_COLUMN_MIN_REM,
  STRUCT_GUTTER_REM,
  STRUCT_PAD_X_REM,
  structureColumnsBand,
} from "../src/web/layout.js";
import { structureFace } from "../src/web/modes/structure/StructureMode.js";

const article = { gistDepths: [0, 1, 2], leafDepth: 3 };
const band = (windowWidth: number, o: Partial<FitInput> = {}) =>
  fitView({
    ...article,
    showText: true,
    chosen: null,
    windowWidth,
    modeBand: true,
    bandShape: "structure",
    ...o,
  });

/** The band's one border — mode-band.css § `.mode-band`, `border-right: 1px`. */
const BORDER = 1;

describe("the band Structure's columns need", () => {
  it("is two 17rem columns, each with room for column B's bracket, a 1rem gutter, the padding and the border", () => {
    // The tracks are equal (`1fr 1fr`) and column B spends 0.6rem + 2px of its
    // track on the bracket, so both tracks are 17rem + 11.6px: 2 × 283.6 + 16
    // = 583.2 content, + 24 padding + 1 border = 608.2, up to 609. GPT Sol's
    // plan review, finding 2 — 585 left column B 260px.
    expect(structureColumnsBand(16)).toEqual({ min: 609, ideal: 705 });
    // The rem terms scale with the root while the borders stay in px.
    expect(structureColumnsBand(20)).toEqual({ min: 759, ideal: 879 });
    expect(structureColumnsBand(12)).toEqual({ min: 458, ideal: 530 });
    /* An unusually small root must not put the threshold inside the ordinary
       band's 288–400px range: below the Structure switch, the face is the list
       at every root size, not only the three common ones in the sweep below. */
    expect(structureColumnsBand(5)).toEqual({ min: MODE_IDEAL + 1, ideal: MODE_IDEAL + 1 });
  });
});

describe("fitView with Structure's band", () => {
  it("switches to the columns' band at a 1165px window, with the rail", () => {
    const switchAt = 609 + PROSE_MIN + SPINE_W; // 1165
    expect(band(switchAt).modeW).toBe(609);
    expect(band(switchAt - 1).modeW).toBe(MODE_IDEAL);
  });

  it("keeps PROSE_MIN for the prose at the switch", () => {
    expect(band(1165).widths).toEqual([PROSE_MIN]);
  });

  it("grows to the ideal and no further", () => {
    expect(band(1200).modeW).toBe(1200 - SPINE_W - PROSE_MIN); // 644
    expect(band(705 + PROSE_MIN + SPINE_W).modeW).toBe(705);
    expect(band(2560).modeW).toBe(705);
  });

  it("moves with ?spine=0, which gives the rail's 12px back", () => {
    expect(band(1153, { showSpine: false }).modeW).toBe(609);
    expect(band(1152, { showSpine: false }).modeW).toBe(MODE_IDEAL);
  });

  it("moves with the root font size, because the columns are in rem", () => {
    const at = 759 + PROSE_MIN + SPINE_W;
    expect(band(at, { rootFontPx: 20 }).modeW).toBe(759);
    expect(band(at - 1, { rootFontPx: 20 }).modeW).toBe(MODE_IDEAL);
  });

  it("leaves every other mode's band exactly as it was", () => {
    for (const w of [700, 900, 1165, 1440, 2560]) {
      const standard = fitView({ ...article, showText: true, chosen: null, windowWidth: w, modeBand: true });
      expect(standard.modeW, `${w}`).toBe(Math.min(MODE_IDEAL, Math.max(288, w - SPINE_W - PROSE_MIN)));
    }
  });

  it("leaves the covering band alone below 700px", () => {
    expect(band(699).modeW).toBe(0);
    expect(band(390).modeW).toBe(0);
  });
});

describe("structureFace reads the same threshold", () => {
  it("draws the columns from a 609px band at a 16px root, and the list below", () => {
    expect(structureFace(609, 16, true)).toBe("columns");
    expect(structureFace(608, 16, true)).toBe("list");
    expect(structureFace(MODE_IDEAL, 16, true)).toBe("list");
  });

  /* **A band that covers the article always gets the list**, however wide it
     is painted. Below 700px the band is the whole window less the rail, so
     without this a 620–699px window would draw the columns and a 700px one the
     list in a 288px band — a wider window, a narrower face. GPT Sol's plan
     review, finding 1. It is also what takes the columns off a phone: until
     2026-09-28 a covering band of 389px or more (a 400px window with the rail)
     got two ~180px columns. */
  it("gives a band that covers the prose the list, at any width", () => {
    expect(structureFace(378, 16, false)).toBe("list");
    expect(structureFace(418, 16, false)).toBe("list");
    expect(structureFace(687, 16, false)).toBe("list");
    expect(structureFace(2000, 16, false)).toBe("list");
  });

  /* **The sweep.** Every window from the covering crossover to a wide monitor,
     across small, ordinary and large roots and with the rail on and off:
     whatever band `fitMode` hands
     out beside the prose, the face measured from it is the one that band was
     sized for, and a columns band gives each column its whole minimum. */
  it("never hands out a band the face then reads as the other face", () => {
    const cases = [5, 10, 12, DEFAULT_ROOT_PX, 20, 32].flatMap((root) =>
      ([null, false] as const).flatMap((showSpine) =>
        Array.from({ length: 2600 - 680 + 1 }, (_, offset) => ({
          root,
          showSpine,
          w: 680 + offset,
        })),
      ),
    );
    for (const { root, showSpine, w } of cases) {
      const { min } = structureColumnsBand(root);
      const { modeW } = band(w, { rootFontPx: root, showSpine });
      if (modeW === 0) {
        /* CSS paints a covering band at the available viewport width, not at
           `modeW` (which records how much room it takes from prose). Sweep that
           real width too: it must stay the list for every root and both rail
           states, even when it is wider than `min`. */
        const painted = Math.max(0, w - (showSpine === false ? 0 : SPINE_W));
        expect(structureFace(painted, root, false), `${w}@${root} covering`).toBe("list");
        continue;
      }
      const face = structureFace(modeW, root, true);
      const at = `${w}@${root}${showSpine === false ? " spine=0" : ""}`;
      if (modeW >= min) {
        expect(face, at).toBe("columns");
        const content = modeW - BORDER - (STRUCT_PAD_X_REM + STRUCT_GUTTER_REM) * root;
        const columnB = content / 2 - (STRUCT_BRACKET_INSET_REM * root + STRUCT_BRACKET_PX);
        expect(columnB, at).toBeGreaterThanOrEqual(STRUCT_COLUMN_MIN_REM * root);
      } else {
        expect(face, at).toBe("list");
        expect(modeW, at).toBeLessThanOrEqual(MODE_IDEAL);
      }
    }
  });
});

/* The stylesheet's gutter, padding and bracket are the arithmetic above written
   in CSS; a change to one without the other is a band sized for columns that do
   not fit in it. */
describe("structure-mode.css agrees with the constants", () => {
  const css = readFileSync("src/web/styles/structure-mode.css", "utf8");
  const rule = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`);
    expect(at, selector).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };

  it("pads the band 0.75rem a side", () => {
    expect(rule(".mode-band.struct")).toContain(`padding: 0.75rem ${STRUCT_PAD_X_REM / 2}rem 0.5rem;`);
  });

  it("puts the gutter between the columns, in the grid and in its measuring copy", () => {
    expect(rule(".struct-grid")).toContain(`gap: ${STRUCT_GUTTER_REM}rem;`);
    expect(rule(".struct-measure")).toContain(`gap: ${STRUCT_GUTTER_REM}rem;`);
  });

  it("draws column B's bracket at the width the threshold allows for", () => {
    const inner = rule(".struct-inner");
    expect(inner).toContain(`padding-left: ${STRUCT_BRACKET_INSET_REM}rem;`);
    expect(inner).toContain(`border-left: ${STRUCT_BRACKET_PX}px solid`);
  });

  it("gives the title grid only a column gap, because a gist occupies its second row", () => {
    const line = rule(".struct-line");
    expect(line).toContain("column-gap: 0.4rem;");
    expect(line).not.toMatch(/\n\s*gap:/);
  });
});
