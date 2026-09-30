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
     layout.ts § `proseAloneMaxPx`, and styles.css § plain, centred for the auto
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

  it("leaves the standard band exactly as it was", () => {
    const standard = (windowWidth: number, rootFontPx = DEFAULT_ROOT_PX) =>
      fitView({ windowWidth, modeBand: true, bandShape: "standard", rootFontPx });
    expect(standard(1440).modeW).toBe(400);
    expect(standard(1440, 20).modeW).toBe(400);
    // The default shape is the standard one.
    expect(fitView({ windowWidth: 1440, modeBand: true }).modeW).toBe(400);
  });
});
