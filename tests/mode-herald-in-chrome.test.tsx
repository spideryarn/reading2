// @vitest-environment jsdom
/**
 * **Where the herald lands, measured in a browser that lays things out.**
 *
 * Greg, 2026-09-28: *"It's nice how it shows the Mode title at the top of the
 * Mode column when clicking to a new Mode. But it gets in the way. Perhaps show
 * it at the bottom-left (instead of the top-right) of the Mode column"*.
 * docs/plans/260928a-the-mode-herald-moves-to-the-foot-of-the-band.md.
 *
 * The subject is geometry, which jsdom does not have, so this is the real
 * stylesheet — `src/web/tailwind.css` compiled by Tailwind's own `compile()`,
 * as tests/shelf-actions-visible-to-a-finger-in-chrome.test.tsx does — over a
 * band shaped the way every band is: a first row, a scroller that grows, and a
 * pinned foot (*Find more*, Chat's composer). The slot and card are the real
 * `ModeHerald`'s markup, and the foot's room is measured from the scroller's
 * bottom to the band's bottom, including any band padding, as `footRoom`
 * does; its component wiring is tests/mode-herald.test.tsx.
 *
 * What has to be true at every width: the card is **below the band's first
 * row**, **stands on the foot** rather than over it, and **stays inside the
 * band**, with its left edge at the band's left. The phone case covers the
 * window with the band (`.band-covers`), which is a different width rule.
 *
 * Skipped, loudly, where there is no Chrome — the house rule for these files.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

import { chromePath } from "../scripts/browser-sign-in.js";
import { ModeHerald } from "../src/web/ModeHerald.js";

const chrome = (() => {
  try {
    return chromePath();
  } catch {
    return null;
  }
})();

/** A pinned foot's height, as Find more or a composer would be. */
const FOOT = 60;

const HERALD = renderToStaticMarkup(
  createElement(ModeHerald, { press: { mode: "glossary", nonce: 1 }, onDone: () => {} }),
);

/**
 * A band as every band is built: head row, growing scroller, pinned foot. And
 * the way-back chip, which is drawn only after a jump: its left edge is the
 * band's right edge, so where the band covers the window it lands in the
 * band's bottom-left corner — the herald's corner (GPT Sol, 2026-09-28).
 * `:root:has(.return-chip)` is what reserves its room.
 */
const markup = (covers: boolean, foot: number) => `
  <div class="reader${covers ? " band-covers" : ""}" style="--mode-w: ${covers ? "0px" : "380px"}">
    <aside class="mode-band gloss">
      <div class="band-head" id="first-row"><span>40 terms</span></div>
      <div style="flex: 1; overflow-y: auto" id="scroller"><p>term</p></div>
      <div style="flex: none; height: ${foot}px" id="foot">${foot > 0 ? "<button>Find more</button>" : ""}</div>
    </aside>
    ${HERALD}
    <div class="return-chip"><button class="return-chip-go">Back to the section you were reading</button><button class="return-chip-close">×</button></div>
  </div>`;

const loader = (base: string) => ({
  base,
  async loadStylesheet(id: string, from: string) {
    const path = id.startsWith(".") ? resolve(from, id) : resolve("node_modules", id);
    return { path, base: dirname(path), content: readFileSync(path, "utf8") };
  },
  async loadModule(): Promise<never> {
    throw new Error("tailwind.css is not expected to load a JS plugin or config");
  },
});

async function stylesheet(): Promise<string> {
  const entry = resolve("src/web/tailwind.css");
  const compiler = await compile(readFileSync(entry, "utf8"), loader(dirname(entry)));
  return compiler.build([]);
}

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

async function look(width: number, height: number, covers: boolean, foot: number, keyboard = 0) {
  if (chrome === null) throw new Error("no Chrome, and this should have been skipped");
  const css = await stylesheet();
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    const p = await browser.newPage({ viewport: { width, height } });
    await p.setContent(`<style>${css}</style>${markup(covers, foot)}`);
    return await p.evaluate(
      (kb) => {
      /* The room the component writes, from what it measures — and, with iOS's
         keyboard up, how much of the layout viewport the keyboard hides. */
      const slot = document.querySelector<HTMLElement>(".mode-herald-slot");
      const band = document.querySelector(".mode-band");
      const scroller = document.querySelector("#scroller");
      if (!band || !scroller) throw new Error("the band fixture did not render");
      const footRoom = Math.max(0, Math.round(band.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom));
      slot?.style.setProperty("--herald-foot", `${footRoom}px`);
      if (kb > 0) slot?.style.setProperty("--kb-inset", `${kb}px`);
      const box = (sel: string): Box => {
        const r = document.querySelector(sel)?.getBoundingClientRect();
        if (!r) throw new Error(`no ${sel}`);
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      return {
        band: box(".mode-band"),
        firstRow: box("#first-row"),
        foot: box("#foot"),
        card: box(".mode-herald"),
        chip: box(".return-chip"),
        viewport: window.innerHeight,
      };
      },
      keyboard,
    );
  } finally {
    await browser.close();
  }
}

/* The footless phone is Summary and Search: nothing lifts the card, so it is
   the case where the way-back chip would land on it. */
const WIDTHS = [
  { name: "a desktop", width: 1440, height: 900, covers: false, foot: FOOT },
  { name: "an iPad in portrait", width: 834, height: 1194, covers: false, foot: FOOT },
  { name: "a phone, the band covering the window", width: 390, height: 844, covers: true, foot: FOOT },
  { name: "a phone, in a band with no foot", width: 390, height: 844, covers: true, foot: 0 },
] as const;

describe.skipIf(chrome === null)("the herald, in a browser that lays it out", () => {
  for (const w of WIDTHS) {
    it(`sits bottom-left of the scroller, on the foot, on ${w.name}`, { timeout: 60_000 }, async () => {
      const { band, firstRow, foot, card, chip } = await look(w.width, w.height, w.covers, w.foot);
      expect(band.bottom - band.top, "the band itself did not lay out").toBeGreaterThan(300);
      expect(card.top, "the card covers the band's first row").toBeGreaterThanOrEqual(firstRow.bottom);
      expect(card.bottom, "the card lies over the pinned foot").toBeLessThanOrEqual(foot.top);
      expect(card.left, "the card starts outside the band").toBeGreaterThanOrEqual(band.left);
      expect(card.left - band.left, "the card is not at the band's left").toBeLessThan(24);
      expect(card.right, "the card runs past the band").toBeLessThanOrEqual(band.right);
      expect(overlap(card, chip), "the card and the way-back chip are drawn on each other").toBe(false);
      expect(foot.top - card.bottom, "the card floats well above the foot").toBeLessThan(24);
    });
  }

  it("stands above the keyboard when iOS leaves the band under it", { timeout: 60_000 }, async () => {
    const KB = 330;
    const { card, firstRow, viewport } = await look(390, 844, true, FOOT, KB);
    expect(card.bottom, "the card is under the keyboard").toBeLessThanOrEqual(viewport - KB);
    expect(card.top, "the card covers the band's first row").toBeGreaterThanOrEqual(firstRow.bottom);
  });
});

const overlap = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
