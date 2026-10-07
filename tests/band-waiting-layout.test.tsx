// @vitest-environment jsdom
/** The delayed words must not change a wait's height, even when they wrap.
 * jsdom cannot establish this: use the reader's actual styles in system Chrome.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { BandWaiting } from "../src/web/BandWaiting.js";
import { SLOW_AFTER_MS } from "../src/web/useSlow.js";
import { chromePath } from "../scripts/browser-sign-in.js";
import { readerCss } from "./helpers/stylesheets.js";

const chrome = (() => {
  try { return chromePath(); } catch { return null; }
})();

const callers = [
  ["gloss-quiet", "p", "Looking for the questions…"],
  ["quotes-quiet", "p", "Looking for quotes…"],
  ["summ-quiet", "p", "Looking for the plain-words version…"],
  ["sk-wait", "div", "Looking for a picture…"],
  ["ill-wait", "div", "Looking for a painting…"],
  ["chat-loading", "div", "Fetching your conversations…"],
  ["srch-working srch-waiting", "p", "Fetching your saved searches…"],
  ["dock-empty dock-loading", "p", "Fetching your comments…"],
  ["diag-wait", "p", "Reading the article paragraph by paragraph…"],
  ["ill-plate-out", "p", "Fetching the picture…"],
  ["cnd-quiet", "p", "Looking for an earlier search…"],
] as const;

describe.skipIf(chrome === null)("a band's wait geometry in Chrome", () => {
  it("reserves the same height before and after the threshold for every caller", { timeout: 60_000 }, async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const fixtures: { label: string; before: string; after: string }[] = [];
    vi.useFakeTimers();
    try {
      for (const [className, as, words] of callers) {
        act(() => root.render(<BandWaiting key={className} className={className} as={as}>{words}</BandWaiting>));
        const before = host.innerHTML;
        expect(host.textContent, "no words in the live region before 600ms").toBe("");
        act(() => vi.advanceTimersByTime(SLOW_AFTER_MS));
        expect(host.textContent).toBe(words);
        fixtures.push({ label: className, before, after: host.innerHTML });
      }
      act(() => root.render(
        <BandWaiting key="formatted" className="gloss-quiet">
          {/* biome-ignore lint/complexity/noUselessFragments: measure a fragment's formatted multiline footprint before and after the delay. */}
          <>Looking for <em>the questions</em><br />in this article…</>
        </BandWaiting>,
      ));
      const before = host.innerHTML;
      expect(host.querySelector(".band-waiting-ghost[aria-hidden='true'] em")?.textContent).toBe("the questions");
      act(() => vi.advanceTimersByTime(SLOW_AFTER_MS));
      fixtures.push({ label: "formatted sentence", before, after: host.innerHTML });
    } finally {
      act(() => root.unmount());
      vi.useRealTimers();
    }

    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: chrome!, headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      for (const width of [280, 360]) {
        for (const { label, before, after } of fixtures) {
          const measure = async (markup: string) => {
            await page.setContent(`<style>${readerCss()}</style><aside class="mode-band" style="position:static;width:${width}px">${markup}</aside>`);
            return page.locator(".band-waiting").evaluate(el => el.getBoundingClientRect().height);
          };
          const emptyHeight = await measure(before);
          const visibleHeight = await measure(after);
          expect(emptyHeight, `${label}, ${width}px: empty ${emptyHeight}px, visible ${visibleHeight}px`).toBeGreaterThan(0);
          expect(emptyHeight, `${label}, ${width}px: the words must not move the band`).toBeCloseTo(visibleHeight, 2);
          if (label === "diag-wait") expect(emptyHeight).toBeGreaterThanOrEqual(128);
        }
      }
    } finally {
      await browser.close();
    }
  });
});
