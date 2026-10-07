/**
 * `fitView` with no band open — the prose alone. The band's half is
 * `fitMode`, tested in chat.test.ts, spine-width.test.ts and
 * structure-band-width.test.ts.
 *
 * This file tested the gist columns' fitting until 2026-09-29 — the worked
 * examples in granularity-zoom.md — and those went with the Hierarchy mode
 * (docs/plans/260929d-remove-hierarchy-mode-and-heading-numbers.md).
 */
import { describe, expect, it } from "vitest";
import {
  bandCoversProse,
  bandShapeFor,
  DEFAULT_ROOT_PX,
  fitView,
  MODE_IDEAL,
  MODE_MIN,
  MODE_PROSE_FLOOR,
  proseAloneMaxPx,
  SPINE_W,
  wideIdeal,
  type FitInput,
} from "../src/web/layout.js";

const fit = (o: Partial<FitInput> & { windowWidth: number }) => fitView(o);

/**
 * The reader's own hand on the rail — `?spine=`, added 2026-08-26 for the pill
 * in the controls bar. The pill went on 2026-09-05 and the parameter stayed:
 * three states still, but the point moved. Absent used to differ from *on*;
 * now it differs from *off*.
 */
describe("hiding the spine", () => {
  it("is on by default", () => {
    expect(fit({ windowWidth: 1600 }).spine).toBe("on");
    expect(fit({ windowWidth: 390 }).spine).toBe("on");
  });

  it("goes away when asked, and gives its width to a window-wide column", () => {
    const on = fit({ windowWidth: 700 });
    const off = fit({ windowWidth: 700, showSpine: false });
    expect(off.spine).toBe("off");
    expect(off.tableW).toBe(on.tableW + SPINE_W);
    expect(off.minWidth).toBe(700);
  });

  // Absent and `true` now agree, and the parameter still has three states
  // because `false` is the one that has to be distinguishable from both:
  // Reader puts `null` back when Search or Ideas opens with the rail hidden,
  // and that only works if "nobody has touched this" is still a thing to say.
  it("absent means on; only an explicit false takes the rail away", () => {
    expect(fit({ windowWidth: 1600, showSpine: null }).spine).toBe("on");
    expect(fit({ windowWidth: 1600, showSpine: true }).spine).toBe("on");
    expect(fit({ windowWidth: 1600, showSpine: false }).spine).toBe("off");
  });
});

describe("the article on its own stops at the measure", () => {
  /* Plain — the default mode — has the reading column as the only column there
     is. It used to take the whole window and put a 738px measure in the left
     of it; on a 1600px screen that is 850px of empty page down one side. Greg,
     2026-09-03: "In Plain mode, can you centre the text on the page?" —
     layout.ts § `proseAloneMaxPx`, and narrow-window.css § `.reader.text-alone` for the auto
     margins that divide what this leaves over. */
  const alone = (windowWidth: number) => fit({ windowWidth });

  it("caps the lone reading column at proseAloneMaxPx", () => {
    const f = alone(1600);
    // 49rem + the gutter's 24px, at the 16px default. It was 48px and the
    // gutter two columns wide until 2026-09-05, when the bookmark moved into
    // the line and the second column went — layout.ts § proseAloneMaxPx.
    expect(f.widths).toEqual([808]);
    /* Through the function rather than `PROSE_ALONE_MAX_REM * root`, because the
       cap stopped being one rem number on 2026-09-04: the gutter's slot is
       `max(1.5rem, 24px)`, so below a 16px root it stops shrinking and the cell's
       left padding grows *in rem terms*. The constant is the rem part; the gutter
       is added as its own term. GPT Sol's stage 1 review. */
    expect(f.tableW).toBe(proseAloneMaxPx(DEFAULT_ROOT_PX));
    expect(f.alone).toBe(true);
    // And there is room to centre it in: the table no longer fills the window.
    expect(f.minWidth).toBeLessThan(1600);
    expect(f.overflowing).toBe(false);
  });

  it("scales the cap with the root font size, because the measure does", () => {
    /* The regression this pins, and it is `SPINE_W`'s lesson from the other
       side: a px constant standing in for a rem-relative length is only right at
       16px. A reader whose browser default is 20px has 65ch, `--reading-size`
       and both of the cell's pads 25% wider — so a fixed 800 would have clipped
       their measure to about 51ch, which is the one thing this cap must never
       do. Found by GPT Sol reviewing the built code, 2026-09-03. */
    expect(fit({ windowWidth: 1600, rootFontPx: 20 }).tableW).toBe(1010);
    // 624 until 2026-09-04, and 624 was the bug: at a 12px root the gutter's
    // px floor makes the left pad 2.7rem, not 2.2, and a rem constant could not
    // follow it. GPT Sol's stage 1 review. 636 until 2026-09-05, when the
    // gutter halved: one slot at every root, so this term is 24px here and 30
    // at a 20px root rather than 48 and 60.
    expect(fit({ windowWidth: 1600, rootFontPx: 12 }).tableW).toBe(612);
    // And it is still a cap, not a width: a window narrower than it wins.
    expect(fit({ windowWidth: 700, rootFontPx: 20 }).tableW).toBe(688);
  });

  it("takes the whole window below the cap, and never scrolls sideways", () => {
    // 820 = `proseAloneMaxPx(16)` plus the spine, so the cap stops
    // biting one pixel below it. Under that the column is the whole window,
    // which is what every phone gets.
    expect(alone(820).tableW).toBe(808);
    expect(alone(819).tableW).toBe(807);
    expect(alone(390).tableW).toBe(378);
    for (let w = 0; w <= 2600; w += 7) {
      const f = alone(w);
      expect(f.overflowing).toBe(false);
      expect(f.minWidth).toBeLessThanOrEqual(Math.max(w, SPINE_W));
    }
  });

  it("is not the same question as `only-prose`, which a band also answers yes to", () => {
    // TableView's `only-prose` is always true now — the prose is the table's
    // one column in every mode. `alone` is the narrower claim — nothing else on
    // the page — because a band has already taken the room the centring would
    // use. Fit.alone says why they are two.
    const band = (windowWidth: number) => fitView({ windowWidth, modeBand: true });
    expect(band(1600).alone).toBe(false);
    expect(band(390).alone).toBe(false);
  });
});

/**
 * **The wide band — Tweets', since it became a mode on 2026-09-29.**
 *
 * > It could be quite a wide left-hand column if that will help to make it be
 * > readable.
 * >
 * > — Greg, 2026-09-29 (SPIDERYARN-READING2-5A)
 *
 * > The tweet thread column perhaps could be slightly wider when I'm looking at
 * > it on my iPad in portrait mode, and slightly narrower when I'm looking at it
 * > on my iPad in landscape mode.
 * >
 * > — Greg, 2026-09-30 (SPIDERYARN-READING2-6G)
 *
 * Since 2026-09-30 it takes a share of the room (`WIDE_SHARE`, 0.42) rather than
 * whatever the prose leaves, between the standard band and `wideIdeal`. The
 * numbers are written out by hand rather than computed from the constants,
 * because a test that derived its expectation from `wideIdeal` would pass
 * whatever `wideIdeal` said.
 * docs/plans/260930h-tweets-band-fits-ipad-and-copy-buttons-become-icons.md.
 */
describe("a wide band", () => {
  const wide = (windowWidth: number, rootFontPx = DEFAULT_ROOT_PX, showSpine: boolean | null = null) =>
    fitView({ windowWidth, modeBand: true, bandShape: "wide", rootFontPx, showSpine });
  const standard = (windowWidth: number, rootFontPx = DEFAULT_ROOT_PX, showSpine: boolean | null = null) =>
    fitView({ windowWidth, modeBand: true, bandShape: "standard", rootFontPx, showSpine });

  it("is wider on an iPad in portrait and narrower in landscape than it was", () => {
    // 834 − 12 = 822; 0.42 × 822 = 345. It was 288, the band's floor.
    expect(wide(834).modeW).toBe(345);
    expect(wide(834).widths).toEqual([477]);
    // 1194 − 12 = 1182; 0.42 × 1182 = 496. It was 544, the cap.
    expect(wide(1194).modeW).toBe(496);
    expect(wide(1194).widths).toEqual([686]);
  });

  it("is a prose column's measure at a desktop window and a 16px root", () => {
    expect(wideIdeal(16)).toBe(544);
    expect(wide(1440).modeW).toBe(544);
    // And the prose beside it keeps the rest of the window.
    expect(wide(1440).widths).toEqual([1440 - SPINE_W - 544]);
    // Below the cap it is the share: 0.42 × 1268 = 533.
    expect(wide(1280).modeW).toBe(533);
  });

  it("caps with the root, because the posts are rem-sized type", () => {
    expect(wide(1440, 12).modeW).toBe(408);
    /* At a 20px root the cap is 680, but at 1440 the share is 0.42 × 1428 =
       600 — the cap is a ceiling now, not a target, and it arrives nearer 1630. */
    expect(wide(1440, 20).modeW).toBe(600);
    expect(wide(1700, 20).modeW).toBe(680);
  });

  it("never comes out narrower than an ordinary band at a small root", () => {
    // wideIdeal(9) is 306, under `MODE_IDEAL`; the wide band is never the narrower.
    expect(wide(1440, 9).modeW).toBe(MODE_IDEAL);
  });

  it("holds its invariants at every width, root and rail", () => {
    for (const root of [9, 12, 16, 20]) {
      for (const spine of [null, false] as const) {
        for (let w = 320; w <= 2400; w++) {
          const f = wide(w, root, spine);
          const s = standard(w, root, spine);
          expect(f.overflowing).toBe(false);
          if (f.modeW === 0) continue; // covering, like any band
          expect(f.widths[0]).toBeGreaterThanOrEqual(MODE_PROSE_FLOOR);
          expect(f.modeW).toBeGreaterThanOrEqual(s.modeW);
          expect(f.modeW).toBeLessThanOrEqual(Math.max(MODE_IDEAL, wideIdeal(root)));
          expect(f.modeW + (f.widths[0] ?? 0)).toBe(w - (spine === false ? 0 : SPINE_W));
        }
      }
    }
  });

  it("covers the article below the crossover, like any other band", () => {
    expect(wide(699).modeW).toBe(0);
    expect(wide(700).modeW).toBe(MODE_MIN);
    expect(wide(700).widths).toEqual([MODE_PROSE_FLOOR]);
    expect(wide(687, DEFAULT_ROOT_PX, false).modeW).toBe(0);
    expect(wide(688, DEFAULT_ROOT_PX, false).modeW).toBe(MODE_MIN);
    const at = 690;
    expect(bandCoversProse(at)).toBe(true);
    expect(wide(at).widths).toEqual([at - SPINE_W]);
  });

  it("leaves the standard band to its own rule", () => {
    const standard = (windowWidth: number, rootFontPx = DEFAULT_ROOT_PX) =>
      fitView({ windowWidth, modeBand: true, bandShape: "standard", rootFontPx });
    /* Past the prose's measure it grows to the same 34rem ceiling (plan
       261002a, § a band past the prose's measure below), but by what the prose
       cannot use rather than by a share: 1440 − 12 − 808 = 620, capped at 544;
       at a 20px root 1428 − 1010 = 418. */
    expect(standard(1440).modeW).toBe(544);
    expect(standard(1440, 20).modeW).toBe(418);
    expect(standard(1100).modeW).toBe(400);
    // The default shape is the standard one.
    expect(fitView({ windowWidth: 1440, modeBand: true }).modeW).toBe(544);
  });
});

/**
 * **The roomy band — Summary's, since 2026-10-01.**
 *
 * > Make the Summary mode column ever so slightly wider (if on a wide screen)
 * >
 * > — Greg, 2026-10-01 (SPIDERYARN-READING2-7Q)
 *
 * The standard band with a higher ceiling, 28rem rather than 25rem, and it
 * still only takes what the prose leaves above `PROSE_MIN` — so it is the
 * standard band until about 957px and reaches its cap near 1004px.
 * docs/plans/261001p-summary-loses-parts-and-sections-a-touch-wider.md.
 * Numbers written out, for the reason the wide band's header gives.
 */
describe("a roomy band", () => {
  const roomy = (windowWidth: number, rootFontPx = DEFAULT_ROOT_PX, showSpine: boolean | null = null) =>
    fitView({ windowWidth, modeBand: true, bandShape: "roomy", rootFontPx, showSpine });
  const standard = (windowWidth: number, rootFontPx = DEFAULT_ROOT_PX, showSpine: boolean | null = null) =>
    fitView({ windowWidth, modeBand: true, bandShape: "standard", rootFontPx, showSpine });

  it("is a touch wider than the standard band on a wide window", () => {
    // 1004 − 12 − 544 = 448, the roomy ceiling; the standard band stops at 400.
    expect(roomy(1100).modeW).toBe(448);
    expect(standard(1100).modeW).toBe(400);
    expect(roomy(1100).widths).toEqual([1100 - SPINE_W - 448]);
  });

  it("is the standard band where the prose has nothing to spare", () => {
    // 950 − 12 − 544 = 394, under both ceilings.
    expect(roomy(950).modeW).toBe(standard(950).modeW);
    expect(roomy(950).modeW).toBe(394);
    expect(roomy(390).modeW).toBe(0);
  });

  it("never comes out narrower than an ordinary band at a small root", () => {
    // 28rem at a 12px root is 336, under `MODE_IDEAL`.
    expect(roomy(1000, 12).modeW).toBe(MODE_IDEAL);
    expect(roomy(1440, 20).modeW).toBe(560);
  });

  it("holds its invariants at every width, root and rail", () => {
    for (const root of [9, 12, 16, 20]) {
      for (const spine of [null, false] as const) {
        for (let w = 320; w <= 2400; w++) {
          const f = roomy(w, root, spine);
          const s = standard(w, root, spine);
          expect(f.overflowing).toBe(false);
          if (f.modeW === 0) {
            expect(s.modeW).toBe(0); // covers exactly where the standard band does
            continue;
          }
          expect(f.modeW).toBeGreaterThanOrEqual(s.modeW);
          expect(f.modeW).toBeLessThanOrEqual(Math.max(MODE_IDEAL, 28 * root, wideIdeal(root)));
          expect(f.modeW + (f.widths[0] ?? 0)).toBe(w - (spine === false ? 0 : SPINE_W));
        }
      }
    }
  });
});

/**
 * **A band past the prose's measure** — plan 261002a, since 2026-10-02.
 *
 * > if the window is really wide and there's space, the left-hand column should
 * > expand up to that sort of width … I think the way it works right now for
 * > slightly narrow windows is pretty good, so we don't want to screw that up.
 * >
 * > — Greg, 2026-10-01 (spya-xebdgz)
 *
 * The rule before this change is written out here as `before`, so the sweep can
 * say exactly what did and did not move: the band is `before` until the prose
 * cell is wider than the prose can use (`proseAloneMaxPx`), and only the excess
 * goes to the band, up to `wideIdeal`.
 */
describe("a band past the prose's measure", () => {
  const before = (avail: number, shape: "standard" | "roomy", root: number) => {
    const ideal = shape === "roomy" ? Math.max(MODE_IDEAL, Math.round(28 * root)) : MODE_IDEAL;
    return Math.min(Math.max(avail - 544, MODE_MIN), ideal);
  };

  it("starts where the prose has its measure, and stops at 34rem", () => {
    const chat = (w: number) => fitView({ windowWidth: w, modeBand: true, bandShape: "standard" });
    // 808 is `proseAloneMaxPx(16)`: 49rem and one gutter cell.
    expect(proseAloneMaxPx(DEFAULT_ROOT_PX)).toBe(808);
    expect(chat(1220).modeW).toBe(400);
    expect(chat(1280).modeW).toBe(460);
    expect(chat(1364).modeW).toBe(544);
    expect(chat(1920).modeW).toBe(544);
    expect(chat(1920).widths).toEqual([1920 - SPINE_W - 544]);
  });

  it("changes nothing until the prose cell is wider than the prose can use", () => {
    for (const shape of ["standard", "roomy"] as const) {
      for (const root of [9, 12, 16, 20]) {
        for (const spine of [null, false] as const) {
          for (let w = 320; w <= 2400; w++) {
            const f = fitView({ windowWidth: w, modeBand: true, bandShape: shape, rootFontPx: root, showSpine: spine });
            if (f.modeW === 0) continue; // the covering band, untouched
            const avail = w - (spine === false ? 0 : SPINE_W);
            const old = before(avail, shape, root);
            const measure = proseAloneMaxPx(root);
            if (avail - old <= measure) {
              expect(f.modeW, `${shape} ${w}px @${root}`).toBe(old);
            } else {
              // Only the excess, and the prose keeps every pixel it can use.
              expect(f.modeW).toBe(Math.max(old, Math.min(avail - measure, wideIdeal(root))));
              expect(f.widths[0]).toBeGreaterThanOrEqual(measure);
            }
            expect(f.modeW).toBeLessThanOrEqual(Math.max(old, wideIdeal(root)));
          }
        }
      }
    }
  });

  it("is the same rule beside the marginalia column", () => {
    const both = fitView({ windowWidth: 1920, modeBand: true, margin: true });
    // 1908 − 288 of notes = 1620 of rest; 1620 − 808 > 544, so the band is at its ceiling.
    expect(both.modeW).toBe(544);
    expect(both.widths[0]).toBe(808);
  });
});

describe("bandShapeFor", () => {
  it("gives each mode its band, and Summary the roomy one", () => {
    expect(bandShapeFor("structure", "brief")).toBe("structure");
    expect(bandShapeFor("summary", "brief")).toBe("roomy");
    expect(bandShapeFor("summary", "fuller")).toBe("roomy");
    expect(bandShapeFor("chat", "brief")).toBe("standard");
  });

  it("gives Summary the wide band while its thread is showing, and only then", () => {
    /* The thread's posts are prose at a prose measure — the Tweets mode's band
       until 2026-10-03 (plan 261003l). */
    expect(bandShapeFor("summary", "thread")).toBe("wide");
    /* `?summary=thread` outlives the mode, as `?diagram=` does: it must not
       widen another mode's band. */
    expect(bandShapeFor("glossary", "thread")).toBe("standard");
    expect(bandShapeFor("structure", "thread")).toBe("structure");
  });
});
