/**
 * `fitView({ margin: true })` — Marginalia's column right of the prose.
 * layout.ts § `fitMargin`;
 * docs/plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md.
 *
 * Swept rather than spot-checked, across widths, both rails and four roots,
 * because the claims are inequalities about every window.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BLOCK_CHAT_IN_COLUMN,
  CHAT_CARD_MAX,
  CHAT_DOCK_GUTTER,
  CHAT_DOCK_INSET,
  CHAT_DOCK_MIN,
  chatCard,
  chatDock,
  MARG_GAP_REM,
  fitView,
  MARG_IDEAL,
  MARG_MIN,
  MARG_WIDE,
  margTitleReserve,
  MODE_MIN,
  PROSE_SHIFT_KEEP_REM,
  MODE_PROSE_FLOOR,
  PROSE_MIN,
  proseAloneMaxPx,
  SPINE_W,
} from "../src/web/layout.js";

const WIDTHS = [...new Set([
  ...Array.from({ length: 300 }, (_, i) => 300 + i * 10), // 300 … 3290
  599, 600, 611, 612, 731, 732, 1599, 1600, 1601, 1915, 1916, 1917,
])];
const CASES = WIDTHS.flatMap((windowWidth) =>
  [null, false].flatMap((showSpine) =>
    [12, 16, 20, 24].map((rootFontPx) => ({ windowWidth, showSpine, rootFontPx })),
  ),
);

const SHELL_CSS = readFileSync(new URL("../src/web/styles/shell.css", import.meta.url), "utf8");
const NARROW_CSS = readFileSync(
  new URL("../src/web/styles/narrow-window.css", import.meta.url),
  "utf8",
);
const MARG_CSS = readFileSync(new URL("../src/web/styles/marginalia.css", import.meta.url), "utf8");

/** Where the table's left edge lands: centred in `.reader`'s content box. */
function tableLeft(fit: ReturnType<typeof fitView>, windowWidth: number): number {
  const spine = fit.spine === "on" ? SPINE_W : 0;
  const content = windowWidth - spine - fit.margReserve;
  return spine + (content - fit.tableW) / 2;
}

describe("the marginalia column", () => {
  it("moves the fixed head with the top bar instead of jumping to its new edge", () => {
    const transitionRule =
      SHELL_CSS.match(/([^{}]+)\{\s*transition:\s*top 0\.18s ease;\s*\}/)?.[1] ?? "";
    expect(transitionRule).toContain(".marg-head");
    expect(NARROW_CSS).toContain("  .marg-head,");
  });

  it("hides the panel-only small-screen advice when Marginalia keeps the prose visible", () => {
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

  it("does not move the prose while the room beside it already holds a full chat card", () => {
    let unmoved = 0;
    for (const c of CASES) {
      const plain = fitView(c);
      const fit = fitView({ ...c, margin: true });
      const spine = fit.spine === "on" ? SPINE_W : 0;
      const room = (c.windowWidth - spine - plain.tableW) / 2;
      /* Short of that the prose moves left for the card: § below. */
      if (room < CHAT_CARD_MAX + MARG_GAP_REM * c.rootFontPx + CHAT_DOCK_GUTTER) continue;
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
      expect(fit.margW).toBeLessThanOrEqual(MARG_WIDE);
    }
  });

  /* Greg, 2026-10-05: "Maybe if the screen is wide we allow the Marginalia
     column to be a bit wider". Only into room the centred prose already
     leaves beside it, so nothing else on the page moves. */
  describe("on a wide window", () => {
    /** What the column was before it could widen: `fitMargin`'s old line. */
    const oldColumnWidth = (c: (typeof CASES)[number]) => {
      const spine = fitView({ ...c, margin: true }).spine === "on" ? SPINE_W : 0;
      return Math.min(MARG_IDEAL, Math.max(MARG_MIN, c.windowWidth - spine - PROSE_MIN));
    };

    it("is 24rem at its widest", () => {
      expect(MARG_IDEAL).toBe(288);
      expect(MARG_WIDE).toBe(384);
    });

    it("grows into the room right of the prose: 384px at 1440, 1920 and 2560", () => {
      expect(proseAloneMaxPx(16)).toBe(696);
      /* (1440 − 12 of rail − 696 of prose) / 2 = 366 centred; the prose then
         moves 238 left for the card (§ below), so 604 is right of it. It was
         366 until 261024l, and 310 at the 49rem cap. */
      expect(fitView({ windowWidth: 1440, margin: true }).margW).toBe(MARG_WIDE);
      expect(fitView({ windowWidth: 1920, margin: true }).margW).toBe(MARG_WIDE);
      expect(fitView({ windowWidth: 2560, margin: true }).margW).toBe(MARG_WIDE);
    });

    it("is exactly what it was wherever the prose did not move for the card", () => {
      /* Rule 3 at a 16px root: 900 − 12 − 288 leaves the prose 600, the
         column's reserve takes the rest, so there is no room left of the prose
         to give and the column is its unwidened 288. */
      expect(fitView({ windowWidth: 900, margin: true }).tableW).toBe(600);
      expect(fitView({ windowWidth: 900, margin: true }).margW).toBe(MARG_IDEAL);
      let same = 0;
      let wider = 0;
      for (const c of CASES) {
        const fit = fitView({ ...c, margin: true });
        if (fit.margW === 0) continue;
        if (unshifted(c).left - tableLeft(fit, c.windowWidth) > 1e-6) continue;
        const spine = fit.spine === "on" ? SPINE_W : 0;
        const room = (c.windowWidth - spine - fitView(c).tableW) / 2;
        if (room <= MARG_IDEAL) {
          same += 1;
          expect(fit.margW, JSON.stringify(c)).toBe(oldColumnWidth(c));
        } else {
          wider += 1;
          expect(fit.margW, JSON.stringify(c)).toBe(Math.min(Math.floor(room), MARG_WIDE));
          /* And it is spare room it grew into: nothing is reserved for it. */
          expect(fit.margReserve, JSON.stringify(c)).toBe(0);
        }
      }
      expect(same).toBeGreaterThan(100);
      expect(wider).toBeGreaterThan(100);
    });

    /** The fit before the prose could shift: what the old column reserved,
        and where that put the table and the room right of it. */
    function unshifted(c: (typeof CASES)[number]) {
      const spine = fitView({ ...c, margin: true }).spine === "on" ? SPINE_W : 0;
      const avail = c.windowWidth - spine;
      const proseW = Math.min(fitView(c).tableW, avail - oldColumnWidth(c));
      const reserve = Math.max(0, 2 * oldColumnWidth(c) + proseW - avail);
      const left = spine + (avail - reserve - proseW) / 2;
      return { spine, proseW, reserve, left, room: c.windowWidth - left - proseW };
    }

    it("keeps the old prose width everywhere", () => {
      let drawn = 0;
      for (const c of CASES) {
        const fit = fitView({ ...c, margin: true });
        if (fit.margW === 0) continue;
        drawn += 1;
        expect(fit.tableW, JSON.stringify(c)).toBe(unshifted(c).proseW);
      }
      expect(drawn).toBeGreaterThan(100);
    });

    /* Greg, 2026-10-06: "B give it more room on wide windows" — from about
       1600px the prose moved left, keeping its width, and the card got it.
       Greg, 2026-10-23 (spya-rgh26u), at about 1512px with large text: "the
       chat in the right is all crammed into a tiny, tiny gap". Since 261024l
       the prose moves at every width, keeping 4rem left of it, or half the
       room that was there when that is less. */
    describe("the prose moves left to give the chat card room", () => {
      const at = (windowWidth: number) => {
        const fit = fitView({ windowWidth, margin: true });
        return {
          left: tableLeft(fit, windowWidth),
          proseW: fit.tableW,
          margW: fit.margW,
          card: chatCard(fit, windowWidth),
        };
      };

      it("keeps 4rem left of the prose", () => {
        expect(PROSE_SHIFT_KEEP_REM).toBe(4);
      });

      /* The full card wants 576 + 20 of gap + 8 of gutter = 604 right of the
         prose at a 16px root; 576 + 25 + 8 = 609 at 20. */
      it("at 1280 the prose keeps 64px and the card gets 480 (was 260)", () => {
        /* 1268 after the rail; the column reserves 2 × 288 + 696 − 1268 = 4, so
           284 is left of the prose and 288 right. 284 − 64 = 220 < 604 − 288. */
        expect(at(1280)).toEqual({ left: 76, proseW: 696, margW: 384, card: 480 });
      });

      it("at 1440 the card is full, 576 (was 338), and the prose keeps 128", () => {
        /* 366 either side; the card needs 604 − 366 = 238 of the 302 it may take. */
        expect(at(1440)).toEqual({ left: 140, proseW: 696, margW: 384, card: CHAT_CARD_MAX });
      });

      it("is continuous across 1600px, where it used to jump 100px", () => {
        /* 445.5, 446 and 446.5 either side; each moves by what the card lacks,
           604 − that, leaving 287, 288 and 289. */
        expect(at(1599).left).toBe(299);
        expect(at(1600).left).toBe(300);
        expect(at(1601).left).toBe(301);
        expect(at(1600).card).toBe(CHAT_CARD_MAX);
      });

      /* Greg's report: about 1512px at a 20px root. */
      it("at a 20px root the prose keeps 80px: a 517px card at 1512 (was 282), 445 at 1440 (was none)", () => {
        const at20 = (windowWidth: number) => {
          const fit = fitView({ windowWidth, rootFontPx: 20, margin: true });
          return {
            left: tableLeft(fit, windowWidth),
            proseW: fit.tableW,
            card: chatCard(fit, windowWidth, 20),
          };
        };
        /* 1500 after the rail, 870 of prose, 315 either side: 315 − 80 = 235,
           short of 609 − 315 = 294. The card is 315 + 235 − 25 − 8. */
        expect(at20(1512)).toEqual({ left: 92, proseW: 870, card: 517 });
        /* The column reserves 2 × 288 + 870 − 1428 = 18: 270 left, 288 right.
           270 − 80 = 190; 288 + 190 − 33. */
        expect(at20(1440)).toEqual({ left: 92, proseW: 870, card: 445 });
      });

      it("moves only as far as the card can use: 58px at 1800, where it reaches 36rem", () => {
        /* Centred it is 12 + (1788 − 696) / 2 = 558 with 546 beside it; the card
           wants 576 + 20 + 8 = 604. This was 54px at 1920 at the 49rem cap; at
           1920 the centred prose now leaves 606, so it does not move. */
        expect(at(1800)).toEqual({ left: 500, proseW: 696, margW: 384, card: CHAT_CARD_MAX });
        expect(at(1920)).toEqual({ left: 618, proseW: 696, margW: 384, card: CHAT_CARD_MAX });
      });

      it("does not move the prose at 2560, where the card is already 36rem", () => {
        /* 12 + (2548 − 696) / 2. */
        expect(at(2560)).toEqual({ left: 938, proseW: 696, margW: 384, card: CHAT_CARD_MAX });
        expect(fitView({ windowWidth: 2560, margin: true }).margReserve).toBe(0);
      });

      /* At a 28px root the cap is 42 × 28 + 1.5 × 28 = 1218, the column pushes
         the prose left by 2 × 288 + 1218 − 1588 = 206, and the prose has
         (1588 − 206 − 1218) / 2 = 82 left of it: under 8rem, so it keeps half,
         and 41 is all it may move. 12 + 41 = 53; 53 + 1218 = 1271; 1600 − 1271
         = 329 for the column, less 35 of gap and 8 of gutter for the card. A
         flat 4rem (112) would move nothing and leave 245, too little for a card
         (GPT Sol on plan 261024l). */
      it("keeps the rail clear at a 28px root, where only 41px can be given to the card", () => {
        const fit = fitView({ windowWidth: 1600, rootFontPx: 28, margin: true });
        expect(tableLeft(fit, 1600)).toBe(53);
        expect(fit.tableW).toBe(1218);
        expect(fit.margW).toBe(329);
        expect(chatCard(fit, 1600, 28)).toBe(286);
      });

      it("takes the rail's twelve pixels into account when it is turned off", () => {
        /* (1600 − 696) / 2 = 452 either side, and the card lacks 604 − 452 =
           152: the content box is 1600 − 304, the prose starts (1296 − 696) / 2
           = 300 in, ends at 996, and the card has 1600 − 996 − 28. */
        const fit = fitView({ windowWidth: 1600, showSpine: false, margin: true });
        expect(tableLeft(fit, 1600)).toBe(300);
        expect(fit.margLeft).toBe(996);
        expect(chatCard(fit, 1600)).toBe(CHAT_CARD_MAX);
      });

      /* The card is full once the centred prose leaves 604 right of it:
         12 + 696 + 2 × 604 = 1916 (2028 at the 49rem cap). Below that the prose
         moves by what is short, and its left edge stays at 12 + 604 = 616. */
      it("rejoins the centred layout at the card's cap boundary", () => {
        expect(at(1915).left).toBe(615);
        expect(at(1916).left).toBe(616);
        expect(at(1917).left).toBe(616.5);
        expect(fitView({ windowWidth: 1916, margin: true }).margReserve).toBe(0);
      });

      it("at every width and root: never past what the card uses, never past the keep", () => {
        let shifted = 0;
        let cards = 0;
        for (const c of CASES) {
          const fit = fitView({ ...c, margin: true });
          if (fit.margW === 0) continue;
          const old = unshifted(c);
          const shift = old.left - tableLeft(fit, c.windowWidth);
          const label = JSON.stringify(c);
          expect(shift, label).toBeGreaterThanOrEqual(-1e-6);
          /* What was left of the prose keeps 4rem, or half of itself if less. */
          const before = old.left - old.spine;
          const keep = Math.min(before / 2, PROSE_SHIFT_KEEP_REM * c.rootFontPx);
          expect(tableLeft(fit, c.windowWidth) - old.spine, label).toBeGreaterThanOrEqual(
            keep - 1e-6,
          );
          /* And it takes all of that it can: either the card is full or the
             keep binds. */
          const full = CHAT_CARD_MAX + MARG_GAP_REM * c.rootFontPx + CHAT_DOCK_GUTTER;
          const cardFull = old.room + shift >= full - 1e-6;
          const keepBinds = tableLeft(fit, c.windowWidth) - old.spine <= keep + 1e-6;
          expect(cardFull || keepBinds, label).toBe(true);
          if (shift < 1e-6) continue;
          shifted += 1;
          /* Every pixel the prose gave up is in the card. */
          expect(old.room + shift, label).toBeLessThanOrEqual(full + 1e-6);
          const oldCard = old.room - MARG_GAP_REM * c.rootFontPx - CHAT_DOCK_GUTTER;
          const card = chatCard(fit, c.windowWidth, c.rootFontPx);
          /* On a small window it can still be short of a card; then the chat
             docks or floats, as it did. */
          if (oldCard + shift < CHAT_DOCK_MIN) {
            expect(card, label).toBeNull();
            continue;
          }
          cards += 1;
          expect(card, label).toBeCloseTo(oldCard + shift, 6);
        }
        expect(shifted).toBeGreaterThan(100);
        expect(cards).toBeGreaterThan(100);
      });

      it("beside a band nothing moves: the table still starts right after the band", () => {
        for (const c of BANDED) {
          const fit = fitView({ ...c, modeBand: true, margin: true });
          if (fit.margW === 0) continue;
          const spine = fit.spine === "on" ? SPINE_W : 0;
          expect(fit.margLeft, JSON.stringify(c)).toBe(spine + fit.modeW + fit.tableW);
          expect(fit.margReserve, JSON.stringify(c)).toBe(
            c.windowWidth - spine - fit.modeW - fit.tableW,
          );
        }
      });

      /* qi-kfmr6j93: until 2026-10-06 this was gated on `PROSE_SHIFT_FROM`, so
         from an iPad's width to about 1400px (rule 2: the column pushes the
         prose left) the title stayed centred in the whole bar, up to about
         145px right of the prose. */
      it("takes the title with the prose at every width without a band", () => {
        let pushed = 0;
        for (const c of CASES) {
          const fit = fitView({ ...c, margin: true });
          expect(margTitleReserve(fit), JSON.stringify(c)).toBe(fit.margReserve);
          if (fit.margReserve > 0) pushed++;
        }
        expect(pushed).toBeGreaterThan(100);
        /* Rule 2: 2 × 288 + 696 − 1188 = 84 for the column, leaving 204 left of
           the prose; it moves 204 − 64 = 140 for the card, so twice that more. */
        const fit = fitView({ windowWidth: 1200, margin: true });
        expect(fit.margReserve).toBe(364);
        expect(margTitleReserve(fit)).toBe(364);
        /* Twice the card's 158px shift. */
        expect(margTitleReserve(fitView({ windowWidth: 1600, margin: true }))).toBe(316);
        /* 2 × 288 + 1044 − 1588 = 32 for the column, leaving 256 left: it keeps
           96 (4rem at 24px), so twice 160 more. */
        expect(margTitleReserve(fitView({ windowWidth: 1600, rootFontPx: 24, margin: true }))).toBe(352);
      });

      it("leaves the title to the band's own rule beside a band, and at 0 with no column", () => {
        for (const c of BANDED) {
          const fit = fitView({ ...c, modeBand: true, margin: true });
          if (fit.alone) continue;
          expect(margTitleReserve(fit), JSON.stringify(c)).toBe(0);
        }
        const band = fitView({ windowWidth: 1600, modeBand: true, margin: true });
        expect(band.margReserve).toBeGreaterThan(0);
        expect(margTitleReserve(band)).toBe(0);
        for (const c of CASES) {
          expect(margTitleReserve(fitView(c)), JSON.stringify(c)).toBe(0);
        }
      });

      /* This checks the CSS/Reader wiring; the width and band conditions are
         exercised as behavior above, rather than certified by a CSS regex. */
      it("wires the masthead to the title reserve, which is 0 beside a band", () => {
        expect(MARG_CSS).toMatch(
          /\.reader\.text-alone \.masthead \{\s*padding-right: calc\(var\(--masthead-pad-r\) \+ var\(--marg-title-reserve, 0px\)\);/,
        );
        const reader = readFileSync(new URL("../src/web/reader/Reader.tsx", import.meta.url), "utf8");
        expect(reader).toMatch(/"--marg-title-reserve": .*margTitleReserve\(fit\)/);
      });
    });

    it("beside a band, grows only into what was already reserved right of the prose", () => {
      let wider = 0;
      for (const c of BANDED) {
        const fit = fitView({ ...c, modeBand: true, margin: true });
        if (fit.margW === 0) continue;
        expect(fit.margW, JSON.stringify(c)).toBe(
          Math.max(
            Math.min(MARG_IDEAL, fit.margReserve),
            Math.min(Math.floor(fit.margReserve), MARG_WIDE),
          ),
        );
        if (fit.margW > MARG_IDEAL) wider += 1;
      }
      expect(wider).toBeGreaterThan(100);
      /* Greg's layout, a Structure band at 1440. The columns do not fit
         (1428 − 288 − 544 = 596 is under their 609), so the band is 400, the
         prose stops at its 696 cap, and 1428 − 400 − 696 = 332 is left right of
         it: the column takes all of it. At the 49rem cap the prose took 740 and
         left exactly 288, so there was no change. */
      expect(
        fitView({ windowWidth: 1440, modeBand: true, bandShape: "structure", margin: true }).margW,
      ).toBe(332);
    });
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

  /* **Beside a band**, since 2026-10-01 —
     docs/plans/261001i-annotations-column-beside-a-band-mode.md. */
  const SHAPES = ["standard", "structure", "wide", "roomy"] as const;
  const BANDED = CASES.flatMap((c) => SHAPES.map((bandShape) => ({ ...c, bandShape })));

  it("draws the column beside an open band once the window is wide enough for all three", () => {
    const both = fitView({ windowWidth: 1600, modeBand: true, margin: true });
    expect(both.modeW).toBeGreaterThan(0);
    expect(both.margW).toBeGreaterThanOrEqual(MARG_MIN);
  });

  it("with a band, never runs off the window, and the column starts at the table's right edge", () => {
    let drawn = 0;
    for (const c of BANDED) {
      const fit = fitView({ ...c, modeBand: true, margin: true });
      if (fit.margW === 0) continue;
      drawn += 1;
      const spine = fit.spine === "on" ? SPINE_W : 0;
      /* With a band the table is not centred: it starts right after the band. */
      const right = spine + fit.modeW + fit.tableW;
      expect(fit.margLeft, JSON.stringify(c)).toBeCloseTo(right, 6);
      expect(fit.margReserve, JSON.stringify(c)).toBeGreaterThanOrEqual(fit.margW);
      expect(right + fit.margReserve, JSON.stringify(c)).toBeCloseTo(c.windowWidth, 6);
      expect(fit.minWidth, JSON.stringify(c)).toBeLessThanOrEqual(c.windowWidth + 1e-6);
      expect(fit.overflowing).toBe(false);
    }
    expect(drawn).toBeGreaterThan(500);
  });

  it("with a band, keeps the prose between the floor and Plain's cap, and the column in range", () => {
    for (const c of BANDED) {
      const fit = fitView({ ...c, modeBand: true, margin: true });
      if (fit.margW === 0) continue;
      expect(fit.tableW, JSON.stringify(c)).toBeGreaterThanOrEqual(MODE_PROSE_FLOOR);
      expect(fit.tableW, JSON.stringify(c)).toBeLessThanOrEqual(proseAloneMaxPx(c.rootFontPx));
      expect(fit.margW).toBeGreaterThanOrEqual(MARG_MIN);
      expect(fit.margW).toBeLessThanOrEqual(MARG_WIDE);
      expect(fit.modeW, JSON.stringify(c)).toBeGreaterThanOrEqual(MODE_MIN);
    }
  });

  it("with a band, gives the band exactly what it would get in a window narrower by the column", () => {
    for (const c of BANDED) {
      const fit = fitView({ ...c, modeBand: true, margin: true });
      if (fit.margW === 0) continue;
      /* The column the band is shared around is never the widened one: that
         grows afterwards, into room already right of the prose. */
      const narrower = fitView({
        ...c,
        windowWidth: c.windowWidth - Math.min(fit.margW, MARG_IDEAL),
        modeBand: true,
      });
      expect(fit.modeW, JSON.stringify(c)).toBe(narrower.modeW);
    }
  });

  it("the band wins below the threshold: the fit is the band's own", () => {
    let yielded = 0;
    for (const c of BANDED) {
      const fit = fitView({ ...c, modeBand: true, margin: true });
      if (fit.margW !== 0) continue;
      yielded += 1;
      expect(fit, JSON.stringify(c)).toEqual(fitView({ ...c, modeBand: true }));
    }
    expect(yielded).toBeGreaterThan(0);
  });

  it("the crossover is MODE_MIN + MODE_PROSE_FLOOR + MARG_MIN beside the rail: 900px with it", () => {
    const at = MODE_MIN + MODE_PROSE_FLOOR + MARG_MIN + SPINE_W;
    expect(at).toBe(900);
    expect(fitView({ windowWidth: at, modeBand: true, margin: true }).margW).toBe(MARG_MIN);
    expect(fitView({ windowWidth: at - 1, modeBand: true, margin: true }).margW).toBe(0);
    expect(fitView({ windowWidth: 800, modeBand: true, margin: true }).modeW).toBeGreaterThan(0);
    expect(fitView({ windowWidth: 390, modeBand: true, margin: true }).margW).toBe(0);
  });
});

/**
 * `chatDock` — whether the block chat panel sits over the column instead of
 * over the prose, and how much room it has there.
 * docs/plans/261003p-block-chat-spinner-and-docking-in-the-marginalia-column.md
 * § Stage 2.
 */
describe("the chat panel's dock in the marginalia column", () => {
  /** A fit with a column whose left edge leaves exactly `room` for the panel. */
  function withRoom(room: number, windowWidth = 1600) {
    const fit = fitView({ windowWidth, margin: true });
    expect(fit.margW).toBeGreaterThan(0);
    return {
      fit: { ...fit, margLeft: windowWidth - CHAT_DOCK_INSET - CHAT_DOCK_GUTTER - room },
      windowWidth,
    };
  }

  it("is 256px at its narrowest, behind an 8px inset and an 8px gutter", () => {
    expect(CHAT_DOCK_MIN).toBe(256);
    expect(CHAT_DOCK_INSET).toBe(8);
    expect(CHAT_DOCK_GUTTER).toBe(8);
  });

  /* The layout the report was filed from: a Structure band, the prose, and the
     column pressed against the window's edge. The first constants left 266px
     of a 272px minimum here, so the feature never showed where it was asked
     for. */
  it("docks in a full column beside a Structure band at 1440px", () => {
    const windowWidth = 1440;
    const fit = fitView({ windowWidth, modeBand: true, bandShape: "structure", margin: true });
    /* 1428 − 400 of band − 696 of prose; it was exactly `MARG_IDEAL` at the
       49rem cap, and a full column is still enough. */
    expect(fit.margW).toBe(332);
    expect(chatDock(fit, windowWidth)).toBe(332 - CHAT_DOCK_INSET - CHAT_DOCK_GUTTER);
  });

  it("does not dock without a column, however much room there is", () => {
    for (const windowWidth of [390, 820, 1440, 2560]) {
      const fit = fitView({ windowWidth });
      expect(fit.margW).toBe(0);
      expect(chatDock(fit, windowWidth)).toBeNull();
    }
    /* Asked for, and no room for it: a phone. */
    expect(chatDock(fitView({ windowWidth: 390, margin: true }), 390)).toBeNull();
    /* And `margW` is the gate, not `margLeft`: a fit with room to spare and no
       column still floats. */
    const { fit, windowWidth } = withRoom(400);
    expect(chatDock({ ...fit, margW: 0 }, windowWidth)).toBeNull();
  });

  it("floats one pixel under the minimum and docks at it", () => {
    const under = withRoom(CHAT_DOCK_MIN - 1);
    expect(chatDock(under.fit, under.windowWidth)).toBeNull();
    const at = withRoom(CHAT_DOCK_MIN);
    expect(chatDock(at.fit, at.windowWidth)).toBe(CHAT_DOCK_MIN);
  });

  it("returns the whole room on a wide window — the 26rem cap is the stylesheet's", () => {
    const windowWidth = 2560;
    const room = chatDock(fitView({ windowWidth, margin: true }), windowWidth);
    expect(room).not.toBeNull();
    expect(room).toBeGreaterThan(26 * 16);
  });

  it("docks beside a band too, once the prose leaves the room", () => {
    const windowWidth = 1920;
    const fit = fitView({ windowWidth, modeBand: true, bandShape: "structure", margin: true });
    expect(fit.modeW).toBeGreaterThan(0);
    expect(fit.margW).toBeGreaterThan(0);
    expect(chatDock(fit, windowWidth)).toBe(
      windowWidth - fit.margLeft - CHAT_DOCK_INSET - CHAT_DOCK_GUTTER,
    );
  });

  /* GPT Sol's F3 on the plan: the inset CSS adds must come off before the
     minimum is applied, or the panel runs into the window's edge. So wherever
     the panel docks, room + inset + gutter is exactly the distance from the
     column's left edge to the window's right — at every width, band or none. */
  it("accounts for every pixel right of the column: room + inset + gutter", () => {
    let docked = 0;
    let floated = 0;
    const SHAPES = ["standard", "structure", "wide", "roomy"] as const;
    for (const c of CASES) {
      const fits = [
        fitView({ ...c, margin: true }),
        ...SHAPES.map((bandShape) => fitView({ ...c, modeBand: true, bandShape, margin: true })),
      ];
      for (const fit of fits) {
        const room = chatDock(fit, c.windowWidth);
        const right = c.windowWidth - fit.margLeft;
        if (room === null) {
          floated += 1;
          if (fit.margW > 0) {
            expect(right - CHAT_DOCK_INSET - CHAT_DOCK_GUTTER, JSON.stringify(c)).toBeLessThan(
              CHAT_DOCK_MIN,
            );
          }
          continue;
        }
        docked += 1;
        expect(fit.margW, JSON.stringify(c)).toBeGreaterThan(0);
        expect(room, JSON.stringify(c)).toBeGreaterThanOrEqual(CHAT_DOCK_MIN);
        expect(room + CHAT_DOCK_INSET + CHAT_DOCK_GUTTER, JSON.stringify(c)).toBeCloseTo(right, 6);
      }
    }
    expect(docked).toBeGreaterThan(500);
    expect(floated).toBeGreaterThan(500);
  });
});

/**
 * `chatCard` — the block chat as a card in the column, level with its block
 * (option B), and how wide it is there.
 * docs/plans/261004k-block-chat-as-a-card-in-the-marginalia-column.md § 4.
 */
describe("the chat card in the marginalia column", () => {
  const MARG_CSS = readFileSync(
    new URL("../src/web/styles/marginalia.css", import.meta.url),
    "utf8",
  );

  it("is on trial as the card, and the way back is one word", () => {
    expect(BLOCK_CHAT_IN_COLUMN).toBe("card");
  });

  /* The card starts `--marg-gap` past the cell's edge, so the gap comes out of
     its room. The stylesheet's value and the arithmetic's are one number. */
  it("takes the same gap out of the room that the stylesheet puts before the card", () => {
    expect(MARG_CSS).toContain(`--marg-gap: ${MARG_GAP_REM}rem;`);
  });

  it("is no card without a column, however much room there is", () => {
    for (const windowWidth of [390, 820, 1440, 2560]) {
      const fit = fitView({ windowWidth });
      expect(fit.margW).toBe(0);
      expect(chatCard(fit, windowWidth)).toBeNull();
    }
    expect(chatCard(fitView({ windowWidth: 390, margin: true }), 390)).toBeNull();
  });

  /* Greg's layout, and GPT Sol's F2 on the plan: without the gap the card was
     280px starting 20px past 1152, and ran 12px over a 1440px window. The cell
     ends at 12 + 400 + 696 = 1108 since the cap came down to 42rem (1152 at
     49rem, with 740 of prose). */
  it("fits the column's room beside a Structure band at 1440px, gap and gutter out", () => {
    const windowWidth = 1440;
    const fit = fitView({ windowWidth, modeBand: true, bandShape: "structure", margin: true });
    expect(fit.margLeft).toBe(1108);
    const width = chatCard(fit, windowWidth);
    expect(width).toBe(1440 - 1108 - MARG_GAP_REM * 16 - CHAT_DOCK_GUTTER);
    expect(fit.margLeft + MARG_GAP_REM * 16 + (width ?? 0) + CHAT_DOCK_GUTTER).toBe(windowWidth);
  });

  /* Report spya-ntb7p6: on a very wide screen the card is wider than the
     notes' 288px, up to a measure for chat text and no further. */
  it("is wider than the notes on a very wide window, capped at 36rem", () => {
    expect(CHAT_CARD_MAX).toBe(576);
    const windowWidth = 2560;
    const width = chatCard(fitView({ windowWidth, margin: true }), windowWidth);
    expect(width).toBe(CHAT_CARD_MAX);
    expect(width).toBeGreaterThan(MARG_IDEAL);
  });

  it("is no card one pixel under the dock's minimum, and one at it", () => {
    const windowWidth = 1600;
    const fit = fitView({ windowWidth, margin: true });
    const withRoom = (room: number) => ({
      ...fit,
      margLeft: windowWidth - MARG_GAP_REM * 16 - CHAT_DOCK_GUTTER - room,
    });
    expect(chatCard(withRoom(CHAT_DOCK_MIN - 1), windowWidth)).toBeNull();
    expect(chatCard(withRoom(CHAT_DOCK_MIN), windowWidth)).toBe(CHAT_DOCK_MIN);
  });

  it("measures the gap in the reader's root size, as the stylesheet's rem does", () => {
    const windowWidth = 1600;
    const fit = { ...fitView({ windowWidth, margin: true }), margLeft: 1200 };
    expect(chatCard(fit, windowWidth, 20)).toBe(1600 - 1200 - MARG_GAP_REM * 20 - CHAT_DOCK_GUTTER);
  });

  /* Never past the window's right edge: gap + card + gutter is at most what is
     right of the column, at every width, band or none, and every root. */
  it("never overruns the window", () => {
    let cards = 0;
    const SHAPES = ["standard", "structure", "wide", "roomy"] as const;
    for (const c of CASES) {
      const fits = [
        fitView({ ...c, margin: true }),
        ...SHAPES.map((bandShape) => fitView({ ...c, modeBand: true, bandShape, margin: true })),
      ];
      for (const fit of fits) {
        const width = chatCard(fit, c.windowWidth, c.rootFontPx);
        if (width === null) continue;
        cards += 1;
        expect(fit.margW, JSON.stringify(c)).toBeGreaterThan(0);
        expect(width, JSON.stringify(c)).toBeGreaterThanOrEqual(CHAT_DOCK_MIN);
        expect(width, JSON.stringify(c)).toBeLessThanOrEqual(CHAT_CARD_MAX);
        expect(
          fit.margLeft + MARG_GAP_REM * c.rootFontPx + width + CHAT_DOCK_GUTTER,
          JSON.stringify(c),
        ).toBeLessThanOrEqual(c.windowWidth + 1e-6);
      }
    }
    expect(cards).toBeGreaterThan(500);
  });
});
