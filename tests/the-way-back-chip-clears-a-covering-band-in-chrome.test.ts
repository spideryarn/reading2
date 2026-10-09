/**
 * **On a phone, the way-back chip never lies over the foot of a band.**
 *
 * The chip — `ReturnChip`'s *back to ⟨section⟩*, or `BandBackChip`'s *back to
 * ⟨mode⟩* in the same slot — is `position: fixed` at the band's right edge,
 * which is the window's left edge when the band covers the article. The band's
 * last row is its foot, and in Chat that is the composer: on 2026-10-08 the
 * chip sat over the start of the input box on the Guide thread at 390px
 * (seen in plan 261008c, fixed in 261008f). So the covering band keeps
 * `--return-chip-h` free at its foot, the room the offline strip and the
 * herald already read.
 *
 * Rendered in Chrome rather than read from the stylesheet, because the claim
 * is about two rectangles. Two controls keep it honest: with no chip the foot
 * reaches the band's bottom (no room is wasted when nothing needs it), and
 * with the band beside the article the chip stands over the prose, not the
 * band, so nothing is reserved there either.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { chromePath } from "../scripts/browser-sign-in.js";
import { fitView } from "../src/web/layout.js";
import { readerCss } from "./helpers/stylesheets.js";

const chrome = (() => {
  try {
    return chromePath();
  } catch {
    return null;
  }
})();

const CSS = `${readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8")}\n${readerCss()}`;

/** A reading view with a band whose shape is Chat's: a head, a scroller that grows, and a composer foot. */
function page(windowWidth: number, chip: boolean, safeBottom = 0, installHint = false, hiddenBars = false): string {
  const fit = fitView({ windowWidth, modeBand: true });
  const classes = `reader spine-${fit.spine}${fit.modeW === 0 ? " band-covers" : ""}`;
  return `<!doctype html><html${hiddenBars ? ' data-bars="hidden"' : ""} style="--safe-bottom:${safeBottom}px"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style>
<div id="root"><div class="${classes}" style="--mode-w:${fit.modeW}px;--page-w:${windowWidth}px">
  <div class="controls"></div>
  <p>${"word ".repeat(400)}</p>
  <div class="mode-band">
    <div class="band-head"><h2>Chat</h2></div>
    <div class="chat-scroll"><p>${"An answer. ".repeat(400)}</p></div>
    <form class="chat-composer"><textarea class="chat-input" placeholder="Ask about what you're reading"></textarea></form>
  </div>
  ${chip ? '<div class="return-chip" role="note"><button type="button" class="return-chip-go">↩ back to L.N. Fowler, Author</button><button type="button" class="return-chip-close" aria-label="Hide the way back">×</button></div>' : ""}
  ${installHint ? '<div class="install-hint">Add to Home Screen</div>' : ""}
</div></div>`;
}

type Rect = { top: number; bottom: number; left: number; right: number };
const meets = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe.skipIf(chrome === null)("the way-back chip and a band's foot", () => {
  it("Chrome: never overlap, at a phone's width and a desktop's", { timeout: 60_000 }, async () => {
    const pw = await import("playwright-core");
    const browser = await pw.chromium.launch({ headless: true, executablePath: chrome ?? chromePath(), args: ["--no-sandbox"] });
    try {
      const p = await browser.newPage();
      const measure = () =>
        p.evaluate(() => {
          const rect = (s: string) => {
            const r = document.querySelector(s)?.getBoundingClientRect();
            return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null;
          };
          return { band: rect(".mode-band"), foot: rect(".chat-composer"), chip: rect(".return-chip"), scroller: rect(".chat-scroll") };
        });

      for (const width of [390, 1440]) {
        await p.setViewportSize({ width, height: 844 });

        await p.setContent(page(width, true));
        const withChip = await measure();
        if (!withChip.band || !withChip.foot || !withChip.chip) throw new Error(`${width}: fixture did not render`);
        expect(withChip.foot.bottom - withChip.foot.top, `${width}: the foot has no height`).toBeGreaterThan(20);
        expect(withChip.chip.bottom - withChip.chip.top, `${width}: the chip has no height`).toBeGreaterThan(20);
        expect(fitView({ windowWidth: width, modeBand: true }).modeW === 0, `${width}: covering?`).toBe(width === 390);
        if (width === 390) {
          /* The fixture really does put the chip over the band. */
          expect(meets(withChip.chip, withChip.band), "390: the chip is not over the band").toBe(true);
        }
        expect(meets(withChip.chip, withChip.foot), `${width}: the chip covers the band's foot`).toBe(false);

        /* No chip, no room: the foot reaches the band's bottom edge. */
        await p.setContent(page(width, false));
        const bare = await measure();
        if (!bare.band || !bare.foot) throw new Error(`${width}: fixture did not render`);
        expect(Math.abs(bare.band.bottom - bare.foot.bottom), `${width}: room reserved with no chip`).toBeLessThanOrEqual(2);

        /* Beside the article, the band's foot does not move for a chip that is not over it. */
        if (width === 1440) expect(withChip.foot.bottom).toBeCloseTo(bare.foot.bottom, 0);
      }

      /* The cover guard must restore the dock and hint's resting room even
         when scrolling has requested hidden bars. Safe-area space is shared
         by the band and chip, so it must not eat their clearance. */
      await p.setViewportSize({ width: 390, height: 844 });
      for (const { safeBottom, installHint } of [
        { safeBottom: 0, installHint: false },
        { safeBottom: 0, installHint: true },
        { safeBottom: 34, installHint: false },
        { safeBottom: 34, installHint: true },
      ]) {
        await p.setContent(page(390, true, safeBottom, installHint, true));
        const state = await measure();
        if (!state.band || !state.foot || !state.chip || !state.scroller) throw new Error("phone fixture did not render");
        expect(meets(state.chip, state.band), "phone: fixture lost the chip over the band").toBe(true);
        expect(state.foot.bottom, `phone: safe=${safeBottom}, hint=${installHint}`).toBeLessThanOrEqual(state.chip.top);
        expect(state.scroller.bottom, "phone: the growing child overflowed the reserved foot").toBeLessThanOrEqual(state.foot.top);
      }
    } finally {
      await browser.close();
    }
  });
});
