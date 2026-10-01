/**
 * **The masthead's facts line wraps between its facts, on a phone, in Chrome.**
 *
 * `antikythera-mechanism` pushed a 390px page 180px sideways (2026-10-01,
 * docs/plans/261001e-masthead-facts-line-overflows-a-phone.md). Masthead.tsx
 * renders the facts as adjacent `<span>`s with no whitespace between them, and
 * since plan 260929d every span after the first was `white-space: nowrap` — so
 * from the byline's last word to "31 sections" there was nowhere to break. It
 * was blamed on the figures first; it was never them.
 *
 * Only a browser can see a line break, so this is one Chrome and `setContent`
 * with the reader sheets inlined, after tests/mark-sign-in-chrome.test.ts. The
 * masthead is the real component rendered to markup, because the missing
 * whitespace between the spans is the component's own and a literal could
 * drift from it.
 *
 * Skipped where there is no Chrome; the box and Greg's Mac both have one.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { chromePath } from "../scripts/browser-sign-in.js";
import type { Article, TreeNode } from "../src/types.js";
import { readerCss } from "./helpers/stylesheets.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: false,
}));

const { Masthead } = await import("../src/web/Masthead.js");

const chrome = (() => {
  try {
    return chromePath();
  } catch {
    return null;
  }
})();

const CSS = readerCss();
const SLUG = "antikythera-mechanism";
const WIDTH = 390;

/** The antikythera facts: its byline, its site name, 11,688 words, 9 parts, 31 sections. */
function article(siteName: string): Article {
  const nodes: Record<string, TreeNode> = {
    n0: { id: "n0", depth: 0, parent: null, children: [], range: ["spya-aaaaaa", "spya-aaaaaa"], title: "Antikythera mechanism" },
  };
  for (let p = 0; p < 9; p++) {
    nodes[`p${p}`] = { id: `p${p}`, depth: 1, parent: "n0", children: [], range: ["spya-aaaaaa", "spya-aaaaaa"], title: `Part ${p}` };
  }
  for (let s = 0; s < 31; s++) {
    nodes[`s${s}`] = { id: `s${s}`, depth: 2, parent: `p${s % 9}`, children: [], range: ["spya-aaaaaa", "spya-aaaaaa"], title: `Section ${s}` };
  }
  return {
    highPowerSince: null,
    meta: { slug: SLUG, title: "Antikythera mechanism", byline: "Contributors to Wikimedia projects", siteName },
    blocks: [
      { id: "spya-aaaaaa", tag: "p", kind: "text", text: "A paragraph.", words: 11688, html: "<p>A paragraph.</p>", gistable: true },
    ],
    assets: undefined,
    navLabelStatus: "ready",
    sourceGuess: undefined,
    tree: { version: "t", generator: "t", slug: SLUG, rootId: "n0", nodes },
  };
}

const page = (siteName: string, extraCss = "") =>
  `<style>${CSS}${extraCss}</style><div class="reader">${renderToStaticMarkup(
    createElement(Masthead, { article: article(siteName), slug: SLUG }),
  )}</div>`;

/** The rule this file exists to stop coming back: each fact inline and nowrap. */
const OLD_RULE = ".facts > span + span { display: inline; white-space: nowrap; }";

describe.skipIf(chrome === null)("the masthead's facts line on a phone, in Chrome", () => {
  it("wraps between facts, keeps each measurement whole, and never pushes the page sideways", { timeout: 60_000 }, async () => {
    const { chromium } = await import("playwright-core");
    if (chrome === null) throw new Error("no Chrome, and this test should have been skipped");
    const browser = await chromium.launch({ headless: true, executablePath: chrome, args: ["--no-sandbox"] });
    try {
      const p = await browser.newPage({ viewport: { width: WIDTH, height: 844 } });
      const look = (html: string) =>
        p.setContent(html).then(() =>
          p.evaluate(() => {
            const facts = [...document.querySelectorAll(".facts > span")];
            /* A Range over the text, not the span's own rects: an inline-block
               is one box however many lines its text takes. */
            const lines = (el: Element) => {
              const r = document.createRange();
              r.selectNodeContents(el);
              return new Set([...r.getClientRects()].filter((b) => b.width > 0).map((b) => Math.round(b.top))).size;
            };
            return {
              scrollWidth: document.documentElement.scrollWidth,
              rights: facts.map((el) => el.getBoundingClientRect().right),
              texts: facts.map((el) => el.textContent ?? ""),
              lines: facts.map(lines),
            };
          }),
        );

      /* The control: with the old rule forced back the fixture must still
         overflow. The sheets are inlined without Geist's @font-face, so this
         is what proves a fallback font has not quietly made the run fit. */
      const broken = await look(page("Wikimedia Foundation, Inc.", OLD_RULE));
      expect(broken.texts).toEqual([
        "Contributors to Wikimedia projects",
        "Wikimedia Foundation, Inc.",
        "11,688 words",
        "~51 min",
        "9 parts",
        "31 sections",
      ]);
      expect(broken.scrollWidth, "the fixture no longer reproduces the overflow").toBeGreaterThan(WIDTH);

      const fixed = await look(page("Wikimedia Foundation, Inc."));
      expect(fixed.scrollWidth, "the facts line pushes the page sideways").toBeLessThanOrEqual(WIDTH);
      for (const right of fixed.rights) expect(right).toBeLessThanOrEqual(WIDTH);
      /* Plan 260929d's guarantee: "9 / parts" never splits across a wrap. */
      expect(fixed.lines.slice(1), "a fact split across a line break").toEqual([1, 1, 1, 1, 1]);

      /* One fact wider than the whole column wraps inside itself rather than
         overflowing — what `nowrap` could not do. */
      const long = await look(page("The Proceedings of the National Academy of Sciences of the United States of America"));
      expect(long.scrollWidth, "a long site name pushes the page sideways").toBeLessThanOrEqual(WIDTH);
      for (const right of long.rights) expect(right).toBeLessThanOrEqual(WIDTH);
    } finally {
      await browser.close().catch(() => {});
    }
  });
});
