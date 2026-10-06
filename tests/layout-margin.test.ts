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
  PROSE_SHIFT_FROM,
  PROSE_SHIFT_MAX,
  MODE_PROSE_FLOOR,
  PROSE_MIN,
  proseAloneMaxPx,
  SPINE_W,
} from "../src/web/layout.js";

const WIDTHS = [...new Set([
  ...Array.from({ length: 300 }, (_, i) => 300 + i * 10), // 300 … 3290
  599, 600, 611, 612, 731, 732, 1599, 1600, 1601, 2027, 2028, 2029,
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

  it("does not move the prose while the room beside it already holds the column", () => {
    let unmoved = 0;
    for (const c of CASES) {
      const plain = fitView(c);
      const fit = fitView({ ...c, margin: true });
      const spine = fit.spine === "on" ? SPINE_W : 0;
      const room = (c.windowWidth - spine - plain.tableW) / 2;
      if (room < MARG_IDEAL) continue;
      /* From `PROSE_SHIFT_FROM` the prose may move for the chat card: § below. */
      if (c.windowWidth >= PROSE_SHIFT_FROM) continue;
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

    it("grows into the room beside the centred prose: 310px at 1440, 384px at 1920 and 2560", () => {
      expect(proseAloneMaxPx(16)).toBe(808);
      /* (1440 − 12 of rail − 808 of prose) / 2. */
      expect(fitView({ windowWidth: 1440, margin: true }).margW).toBe(310);
      expect(fitView({ windowWidth: 1920, margin: true }).margW).toBe(MARG_WIDE);
      expect(fitView({ windowWidth: 2560, margin: true }).margW).toBe(MARG_WIDE);
    });

    it("is exactly what it was wherever that room is no more than the old column", () => {
      /* 1396px with the rail at a 16px root: 12 + 808 + 2 × 288. */
      expect(fitView({ windowWidth: 1396, margin: true }).margW).toBe(MARG_IDEAL);
      expect(fitView({ windowWidth: 1398, margin: true }).margW).toBe(MARG_IDEAL + 1);
      let same = 0;
      let wider = 0;
      for (const c of CASES) {
        if (c.windowWidth >= PROSE_SHIFT_FROM) continue;
        const fit = fitView({ ...c, margin: true });
        if (fit.margW === 0) continue;
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
    const unshifted = (c: (typeof CASES)[number]) => {
      const spine = fitView({ ...c, margin: true }).spine === "on" ? SPINE_W : 0;
      const avail = c.windowWidth - spine;
      const proseW = Math.min(fitView(c).tableW, avail - oldColumnWidth(c));
      const reserve = Math.max(0, 2 * oldColumnWidth(c) + proseW - avail);
      const left = spine + (avail - reserve - proseW) / 2;
      return { spine, proseW, reserve, left, room: c.windowWidth - left - proseW };
    };

    it("keeps the old prose width everywhere and its old position below 1600px", () => {
      let below = 0;
      for (const c of CASES) {
        const fit = fitView({ ...c, margin: true });
        if (fit.margW === 0) continue;
        const old = unshifted(c);
        expect(fit.tableW, JSON.stringify(c)).toBe(old.proseW);
        if (c.windowWidth >= PROSE_SHIFT_FROM) continue;
        below += 1;
        expect(fit.margReserve, JSON.stringify(c)).toBe(old.reserve);
      }
      expect(below).toBeGreaterThan(100);
    });

    /* Greg, 2026-10-06: "B give it more room on wide windows" — from about
       1600px the prose moves left, keeping its width, and the card gets it. */
    describe("from 1600px, the prose moves left to give the chat card room", () => {
      const at = (windowWidth: number) => {
        const fit = fitView({ windowWidth, margin: true });
        return {
          left: tableLeft(fit, windowWidth),
          proseW: fit.tableW,
          margW: fit.margW,
          card: chatCard(fit, windowWidth),
        };
      };

      it("is 100px at most, from a 1600px window", () => {
        expect(PROSE_SHIFT_FROM).toBe(1600);
        expect(PROSE_SHIFT_MAX).toBe(100);
      });

      it("leaves 1440 and 1599 alone: centred prose, a 282px card at 1440", () => {
        expect(at(1440)).toEqual({ left: 322, proseW: 808, margW: 310, card: 282 });
        expect(at(1599)).toEqual({ left: 401.5, proseW: 808, margW: 384, card: 361.5 });
      });

      it("gives the card 100px at 1600 (362 to 462), the prose 100px further left", () => {
        /* Centred: 12 + (1588 − 808) / 2 = 402. */
        expect(at(1600)).toEqual({ left: 302, proseW: 808, margW: 384, card: 462 });
      });

      it("moves only as far as the card can use: 54px at 1920, where it reaches 36rem", () => {
        /* Centred it is 562 with 550 beside it; the card wants 576 + 20 + 8. */
        expect(at(1920)).toEqual({ left: 508, proseW: 808, margW: 384, card: CHAT_CARD_MAX });
      });

      it("does not move the prose at 2560, where the card is already 36rem", () => {
        expect(at(2560)).toEqual({ left: 882, proseW: 808, margW: 384, card: CHAT_CARD_MAX });
        expect(fitView({ windowWidth: 2560, margin: true }).margReserve).toBe(0);
      });

      it("keeps the rail clear at a 24px root, where only 44px can be given to the card", () => {
        const fit = fitView({ windowWidth: 1600, rootFontPx: 24, margin: true });
        expect(tableLeft(fit, 1600)).toBe(56);
        expect(fit.tableW).toBe(1212);
        expect(fit.margW).toBe(332);
        expect(chatCard(fit, 1600, 24)).toBe(294);
      });

      it("takes the rail's twelve pixels into account when it is turned off", () => {
        const fit = fitView({ windowWidth: 1600, showSpine: false, margin: true });
        expect(tableLeft(fit, 1600)).toBe(296);
        expect(fit.margLeft).toBe(1104);
        expect(chatCard(fit, 1600)).toBe(468);
      });

      it("rejoins the centred layout at the card's cap boundary", () => {
        expect(at(2027).left).toBe(615);
        expect(at(2028).left).toBe(616);
        expect(at(2029).left).toBe(616.5);
        expect(fitView({ windowWidth: 2028, margin: true }).margReserve).toBe(0);
      });

      it("at every width and root: never more than 100px, never past what the card uses, never into the rail", () => {
        let shifted = 0;
        for (const c of CASES) {
          const fit = fitView({ ...c, margin: true });
          if (fit.margW === 0) continue;
          const old = unshifted(c);
          const shift = old.left - tableLeft(fit, c.windowWidth);
          const label = JSON.stringify(c);
          if (c.windowWidth < PROSE_SHIFT_FROM) {
            expect(shift, label).toBeCloseTo(0, 6);
            continue;
          }
          expect(shift, label).toBeGreaterThanOrEqual(-1e-6);
          expect(shift, label).toBeLessThanOrEqual(PROSE_SHIFT_MAX + 1e-6);
          /* At least half the page that was left of the prose is still there. */
          expect(tableLeft(fit, c.windowWidth) - old.spine, label).toBeGreaterThanOrEqual(
            (old.left - old.spine) / 2 - 1e-6,
          );
          if (shift < 1e-6) continue;
          shifted += 1;
          /* Every pixel the prose gave up is in the card. */
          const full = CHAT_CARD_MAX + MARG_GAP_REM * c.rootFontPx + CHAT_DOCK_GUTTER;
          expect(old.room + shift, label).toBeLessThanOrEqual(full + 1e-6);
          const oldCard = old.room - MARG_GAP_REM * c.rootFontPx - CHAT_DOCK_GUTTER;
          expect(chatCard(fit, c.windowWidth, c.rootFontPx), label).toBeCloseTo(oldCard + shift, 6);
        }
        expect(shifted).toBeGreaterThan(100);
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
          if (c.windowWidth < PROSE_SHIFT_FROM && fit.margReserve > 0) pushed++;
        }
        expect(pushed).toBeGreaterThan(100);
        const fit = fitView({ windowWidth: 1200, margin: true });
        expect(fit.margReserve).toBe(196);
        expect(margTitleReserve(fit)).toBe(196);
        expect(margTitleReserve(fitView({ windowWidth: 1600, margin: true }))).toBe(200);
        expect(margTitleReserve(fitView({ windowWidth: 1600, rootFontPx: 24, margin: true }))).toBe(288);
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
      /* Greg's layout, a Structure band at 1440: no spare room, so no change. */
      expect(
        fitView({ windowWidth: 1440, modeBand: true, bandShape: "structure", margin: true }).margW,
      ).toBe(MARG_IDEAL);
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
    expect(fit.margW).toBe(MARG_IDEAL);
    expect(chatDock(fit, windowWidth)).toBe(MARG_IDEAL - CHAT_DOCK_INSET - CHAT_DOCK_GUTTER);
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
     280px starting 20px past 1152, and ran 12px over a 1440px window. */
  it("fits the column's room beside a Structure band at 1440px, gap and gutter out", () => {
    const windowWidth = 1440;
    const fit = fitView({ windowWidth, modeBand: true, bandShape: "structure", margin: true });
    expect(fit.margLeft).toBe(1152);
    const width = chatCard(fit, windowWidth);
    expect(width).toBe(1440 - 1152 - MARG_GAP_REM * 16 - CHAT_DOCK_GUTTER);
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
