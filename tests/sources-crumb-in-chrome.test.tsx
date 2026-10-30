// @vitest-environment jsdom
/**
 * **A tool's crumb gives way, never Sources' chips — in Chrome.**
 *
 * A persona review, 2026-10-26, shot 08: at 1280 wide, on *Ask your own
 * question*, the head read *Where it sits │ Bibliography 17 │ Links 0* then
 * *Where it sits › Ask your own question*, and the crumb, which would not
 * shrink (`white-space: nowrap`, no `min-width: 0`), squeezed the chips' bar,
 * which scrolls inside itself, until *Links 0* was cut off. Now the chips keep
 * their width beside a crumb and the tool's name truncates with an ellipsis,
 * as `.band-head h2` does (reception.css § the crumb).
 *
 * Only a browser can see a clip, so this is one Chrome and `setContent` with
 * the token and reader sheets inlined, after
 * tests/masthead-facts-wrap-in-chrome.test.tsx. The head is the real chip row
 * and the real crumb, rendered to markup. Its control puts the old crumb rules
 * back and asserts the chips are clipped again, so the measure is shown able
 * to see what it guards. Skipped where there is no Chrome.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { chromePath } from "../scripts/browser-sign-in.js";
import { ToolBack } from "../src/web/WhereItSitsPanel.js";
import { sourcesHead } from "./helpers/sources-head.js";
import { readerCss } from "./helpers/stylesheets.js";

const chrome = (() => {
  try {
    return chromePath();
  } catch {
    return null;
  }
})();

const CSS = `${readFileSync(join(process.cwd(), "styles/tokens.css"), "utf8")}\n${readerCss()}`;

/** The crumb as it was before the fix: whole, unshrinkable, and the chips free to give way. */
const OLD_RULES = `
.band-head > .rcp-views { flex-shrink: 1 !important; }
.where-crumb { min-width: auto !important; }
.where-crumb-tool { overflow: visible !important; min-width: auto !important; }
`;

/** A band as wide as the default one beside the prose at 1280 (layout.ts § standard band, 25rem plus a little). */
const BAND_PX = 460;

const page = (extra = "") =>
  `<style>${CSS}${extra}</style><div class="mode-band has-about" style="width:${BAND_PX}px">` +
  `<div class="band-head">${renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      sourcesHead({ view: "investigate", onView: () => {}, ownerSlug: "a-piece", works: Array.from({ length: 17 }), links: [] }),
      createElement(ToolBack, { tool: "investigate", onBack: () => {} }),
    ),
  )}</div></div>`;

describe.skipIf(chrome === null)("Sources' head on a tool, in Chrome", () => {
  it("keeps every chip whole and truncates the tool's name instead", { timeout: 60_000 }, async () => {
    const { chromium } = await import("playwright-core");
    if (chrome === null) throw new Error("no Chrome, and this test should have been skipped");
    const browser = await chromium.launch({ headless: true, executablePath: chrome, args: ["--no-sandbox"] });
    try {
      const p = await browser.newPage({ viewport: { width: 1280, height: 400 } });
      const look = (html: string) =>
        p.setContent(html).then(() =>
          p.evaluate(() => {
            const bar = document.querySelector<HTMLElement>(".rcp-views");
            const tool = document.querySelector<HTMLElement>(".where-crumb-tool");
            const back = document.querySelector<HTMLElement>(".where-back");
            const head = document.querySelector<HTMLElement>(".band-head");
            if (!bar || !tool || !back || !head) throw new Error("the head did not render");
            return {
              /* The chips' bar scrolls inside itself, so a clipped chip shows as more to scroll. */
              chipsClipped: bar.scrollWidth - bar.clientWidth,
              toolTruncated: tool.scrollWidth > tool.clientWidth,
              backWhole: back.scrollWidth <= back.clientWidth + 1,
              headOverflow: head.scrollWidth - head.clientWidth,
            };
          }),
        );
      const now = await look(page());
      expect(now.chipsClipped, "every chip is whole").toBeLessThanOrEqual(1);
      expect(now.toolTruncated, "the tool's name gives way").toBe(true);
      expect(now.backWhole, "the way back stays whole").toBe(true);
      expect(now.headOverflow, "nothing pushes past the head").toBeLessThanOrEqual(1);

      const before = await look(page(OLD_RULES));
      expect(before.chipsClipped, "the control: the old crumb clips the chips").toBeGreaterThan(1);
    } finally {
      await browser.close();
    }
  });
});
