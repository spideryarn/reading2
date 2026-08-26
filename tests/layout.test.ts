/**
 * Column fitting — the arithmetic behind "§ fit the columns, don't just scroll
 * them" in granularity-zoom.md.
 *
 * The worked examples in that doc ARE these test cases, deliberately: the doc
 * quotes concrete pixel widths, and a doc quoting numbers the code no longer
 * produces is worse than one that quotes none. If you change a constant in
 * layout.ts, these fail and the doc needs editing too.
 */
import { describe, expect, it } from "vitest";
import { fitView, type FitInput } from "../src/web/layout.js";

/** A normal three-deep tree: gists at 0/1/2, one leaf node per block at 3. */
const article = { gistDepths: [0, 1, 2], leafDepth: 3 };
const fit = (o: Partial<FitInput> & { windowWidth: number }) =>
  fitView({ ...article, showText: true, chosen: null, ...o });

describe("the widths granularity-zoom.md promises", () => {
  it("1600px: three gist columns at 240 and 856 of prose", () => {
    const f = fit({ windowWidth: 1600 });
    expect(f.columns).toEqual([0, 1, 2]);
    expect(f.widths).toEqual([240, 240, 240, 856]);
    expect(f.overflowing).toBe(false);
    // Fills the window exactly: 24 of spine + 1576 of table.
    expect(f.minWidth).toBe(1600);
  });

  it("760px: one gist column and prose, fitting exactly", () => {
    const f = fit({ windowWidth: 760 });
    expect(f.columns).toEqual([2]);
    expect(f.tableW).toBe(736);
    expect(f.overflowing).toBe(false);
  });

  it("700px: overflows by 44", () => {
    const f = fit({ windowWidth: 700 });
    expect(f.tableW).toBe(720);
    expect(f.overflowing).toBe(true);
    expect(f.tableW - (700 - 24)).toBe(44);
  });
});

describe("which levels get given up", () => {
  it("drops the coarsest first — the spine already shows those", () => {
    // Whatever survives is always the finest end of the range.
    for (const w of [1600, 1200, 900, 800]) {
      const cols = fit({ windowWidth: w }).columns;
      expect(cols).toEqual(article.gistDepths.slice(article.gistDepths.length - cols.length));
    }
  });

  it("never gives up the last gist column, and overflows instead", () => {
    const f = fit({ windowWidth: 400 });
    expect(f.columns).toEqual([2]);
    expect(f.overflowing).toBe(true);
  });

  it("shrinks before it drops", () => {
    // 1279px still shows all three, squeezed; nothing has been given up yet.
    const f = fit({ windowWidth: 1279 });
    expect(f.columns).toEqual([0, 1, 2]);
    expect(f.widths[0]).toBeLessThan(240);
  });
});

describe("a wider window never shows less of the article", () => {
  // The regression this pins: the spine's labels used to appear at a fixed
  // 1100px, and the rail widening from 1.5rem to 13rem ate 184px — so 1099px
  // gave three gist columns and 1100px gave one. Widening the window removed
  // two levels of context, which is indefensible whatever the labels are worth.
  //
  // The labelled rail was deleted on 2026-08-26 (Greg: the spine is always the
  // collapsed one), so the rail is a constant 24px and nothing here can go
  // non-monotonic any more. The sweep stays: it is cheap, and it is the check
  // that would catch the next width that gets spent conditionally.
  it("column count is monotonic in window width", () => {
    let prev = 0;
    const regressions: number[] = [];
    for (let w = 320; w <= 2600; w++) {
      const n = fit({ windowWidth: w }).columns.length;
      if (n < prev) regressions.push(w);
      prev = n;
    }
    expect(regressions).toEqual([]);
  });

  it("specifically, across the old 1100px cliff", () => {
    expect(fit({ windowWidth: 1099 }).columns).toEqual(fit({ windowWidth: 1100 }).columns);
  });

  it("the rail is the same width at every window size", () => {
    for (const w of [700, 1099, 1100, 1279, 1280, 1600, 2400]) {
      const f = fit({ windowWidth: w });
      expect(f.spine).toBe("on");
      expect(f.minWidth - f.tableW).toBe(24);
    }
  });
});

describe("the reader's choice beats the window", () => {
  it("an explicit set is honoured even when it doesn't fit", () => {
    const f = fit({ windowWidth: 700, chosen: [0, 1, 2] });
    expect(f.columns).toEqual([0, 1, 2]);
    expect(f.overflowing).toBe(true);
  });

  it("an explicit empty set means no gist columns, not 'automatic'", () => {
    const f = fit({ windowWidth: 1600, chosen: [] });
    expect(f.columns).toEqual([]);
    expect(f.widths).toHaveLength(1);
  });

  it("ignores a depth this article hasn't got", () => {
    expect(fit({ windowWidth: 1600, chosen: [0, 9] }).columns).toEqual([0]);
  });
});

describe("the leaf column", () => {
  it("is always present in outline mode, where it is the deepest rung", () => {
    const f = fit({ windowWidth: 1600, showText: false });
    expect(f.columns).toEqual([0, 1, 2, 3]);
    // No prose, so no rail either: the table already is the whole-article view.
    expect(f.spine).toBe("off");
  });

  it("rides beside the prose when explicitly asked for", () => {
    // Greg wants the one-line-per-paragraph outline AND the full text at once.
    const f = fit({ windowWidth: 1600, chosen: [1, 2, 3] });
    expect(f.columns).toEqual([1, 2, 3]);
    expect(f.widths).toHaveLength(4);
  });

  it("is never chosen by auto-fit", () => {
    for (const w of [700, 1000, 1600, 2400]) {
      expect(fit({ windowWidth: w }).columns).not.toContain(3);
    }
  });
});

describe("the table always has room for its own width", () => {
  it("minWidth covers the rail plus the table at every width", () => {
    for (let w = 320; w <= 2600; w += 7) {
      const f = fit({ windowWidth: w });
      expect(f.minWidth).toBe(f.tableW + (f.spine === "on" ? 24 : 0));
      expect(f.widths.reduce((a, b) => a + b, 0)).toBe(f.tableW);
    }
  });
});

/**
 * The reader's own hand on the rail — `?spine=`, added 2026-08-26 for the pill
 * in the controls bar. Three states, and the third one is the point: absent is
 * not the same as on.
 */
describe("hiding the spine", () => {
  it("is off by default in outline mode and on in reading mode", () => {
    expect(fit({ windowWidth: 1600 }).spine).toBe("on");
    expect(fit({ windowWidth: 1600, showText: false }).spine).toBe("off");
  });

  it("goes away when asked, and gives its width to the table", () => {
    const on = fit({ windowWidth: 1600 });
    const off = fit({ windowWidth: 1600, showSpine: false });
    expect(off.spine).toBe("off");
    expect(off.tableW).toBe(on.tableW + 24);
    expect(off.minWidth).toBe(1600);
  });

  it("stays when asked, even in outline mode where nothing would show it", () => {
    const f = fit({ windowWidth: 1600, showText: false, showSpine: true });
    expect(f.spine).toBe("on");
    // Still the whole outline: the rail is bought out of the detail column.
    expect(f.columns).toEqual([0, 1, 2, 3]);
    expect(f.minWidth).toBe(1600);
  });

  // There is one rail rather than a labelled one and a collapsed one, so on is
  // on at every width — the window has nothing left to say about the spine.
  it("is the same rail at every width", () => {
    expect(fit({ windowWidth: 900, showText: false, showSpine: true }).spine).toBe("on");
    expect(fit({ windowWidth: 1600, showText: false, showSpine: true }).spine).toBe("on");
  });

  // The reason the parameter has no default: `null` has to keep meaning
  // "nobody has touched this", or the `auto` control has nothing to put back.
  it("absent is not the same as true", () => {
    expect(fit({ windowWidth: 1600, showText: false, showSpine: null }).spine).toBe("off");
    expect(fit({ windowWidth: 1600, showText: false, showSpine: true }).spine).toBe("on");
  });

  it("keeps the fit monotonic in window width", () => {
    for (const showSpine of [true, false] as const) {
      let prev = 0;
      for (let w = 320; w <= 2600; w++) {
        const n = fit({ windowWidth: w, showSpine }).columns.length;
        expect(n).toBeGreaterThanOrEqual(prev);
        prev = n;
      }
    }
  });
});
