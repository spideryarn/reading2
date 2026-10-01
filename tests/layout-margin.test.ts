/**
 * `fitView({ margin: true })` — Annotations' column right of the prose.
 * layout.ts § `fitMargin`;
 * docs/plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md.
 *
 * Swept rather than spot-checked, across widths, both rails and three roots,
 * because the claims are inequalities about every window.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  fitView,
  MARG_IDEAL,
  MARG_MIN,
  MODE_PROSE_FLOOR,
  proseAloneMaxPx,
  SPINE_W,
} from "../src/web/layout.js";

const WIDTHS = Array.from({ length: 300 }, (_, i) => 300 + i * 10); // 300 … 3290
const CASES = WIDTHS.flatMap((windowWidth) =>
  [null, false].flatMap((showSpine) =>
    [12, 16, 20].map((rootFontPx) => ({ windowWidth, showSpine, rootFontPx })),
  ),
);

const SHELL_CSS = readFileSync(new URL("../src/web/styles/shell.css", import.meta.url), "utf8");
const NARROW_CSS = readFileSync(
  new URL("../src/web/styles/narrow-window.css", import.meta.url),
  "utf8",
);

/** Where the table's left edge lands: centred in `.reader`'s content box. */
function tableLeft(fit: ReturnType<typeof fitView>, windowWidth: number): number {
  const spine = fit.spine === "on" ? SPINE_W : 0;
  const content = windowWidth - spine - fit.margReserve;
  return spine + (content - fit.tableW) / 2;
}

describe("the annotations column", () => {
  it("moves the fixed head with the top bar instead of jumping to its new edge", () => {
    const transitionRule =
      SHELL_CSS.match(/([^{}]+)\{\s*transition:\s*top 0\.18s ease;\s*\}/)?.[1] ?? "";
    expect(transitionRule).toContain(".marg-head");
    expect(NARROW_CSS).toContain("  .marg-head,");
  });

  it("hides the panel-only small-screen advice when Annotations keeps the prose visible", () => {
    expect(NARROW_CSS).toContain(
      ".reader.band-covers:has(.mode-band, .marg-narrow) .small-screen-hint { display: none; }",
    );
  });

  it("never runs off the right of the window, and starts at the table's right edge", () => {
    for (const c of CASES) {
      const fit = fitView({ ...c, margin: true });
      if (fit.margW === 0) continue;
      const right = tableLeft(fit, c.windowWidth) + fit.tableW;
      expect(fit.margLeft, JSON.stringify(c)).toBeCloseTo(right, 6);
      expect(right + fit.margW, JSON.stringify(c)).toBeLessThanOrEqual(c.windowWidth + 1e-6);
      expect(fit.minWidth, JSON.stringify(c)).toBeLessThanOrEqual(c.windowWidth + 1e-6);
    }
  });

  it("does not move the prose while the room beside it already holds the column", () => {
    let unmoved = 0;
    for (const c of CASES) {
      const plain = fitView(c);
      const fit = fitView({ ...c, margin: true });
      const spine = fit.spine === "on" ? SPINE_W : 0;
      const room = (c.windowWidth - spine - plain.tableW) / 2;
      if (room < MARG_IDEAL) continue;
      unmoved += 1;
      expect(fit.tableW, JSON.stringify(c)).toBe(plain.tableW);
      expect(fit.margReserve, JSON.stringify(c)).toBe(0);
      expect(tableLeft(fit, c.windowWidth)).toBeCloseTo(tableLeft(plain, c.windowWidth), 6);
    }
    /* The branch was reached, so the loop above asserted something. */
    expect(unmoved).toBeGreaterThan(50);
  });

  it("keeps the prose above the band's floor whenever the column is drawn", () => {
    for (const c of CASES) {
      const fit = fitView({ ...c, margin: true });
      if (fit.margW === 0) continue;
      expect(fit.tableW, JSON.stringify(c)).toBeGreaterThanOrEqual(MODE_PROSE_FLOOR);
      expect(fit.tableW).toBeLessThanOrEqual(proseAloneMaxPx(c.rootFontPx));
      expect(fit.margW).toBeGreaterThanOrEqual(MARG_MIN);
      expect(fit.margW).toBeLessThanOrEqual(MARG_IDEAL);
    }
  });

  it("gives up the column below the floor, and the page is then Plain's", () => {
    let narrow = 0;
    for (const c of CASES) {
      const fit = fitView({ ...c, margin: true });
      if (fit.margW !== 0) continue;
      narrow += 1;
      expect(fit, JSON.stringify(c)).toEqual(fitView(c));
    }
    expect(narrow).toBeGreaterThan(0);
    /* And a phone is one of them. */
    expect(fitView({ windowWidth: 390, margin: true }).margW).toBe(0);
  });

  it("is ignored when a band is open: one side at a time", () => {
    const withBand = fitView({ windowWidth: 1600, modeBand: true, margin: true });
    expect(withBand.margW).toBe(0);
    expect(withBand.margReserve).toBe(0);
  });
});
