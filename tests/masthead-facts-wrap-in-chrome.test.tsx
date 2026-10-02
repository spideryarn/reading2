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
 * with the root tokens and reader sheets inlined, after
 * tests/mark-sign-in-chrome.test.ts. The masthead is the real component
 * rendered to markup, because the missing whitespace between the spans is the
 * component's own and a literal could drift from it.
 *
 * Skipped where there is no Chrome; the box and Greg's Mac both have one.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { chromePath } from "../scripts/browser-sign-in.js";
import type { Article, Author, TreeNode } from "../src/types.js";
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

/* `readerCss()` deliberately excludes the repo-root brand/token sheet. Include
   it so `--font-ui` resolves to the real system fallback stack; only Geist's
   package-owned @font-face rules remain absent. */
const CSS = `${readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8")}\n${readerCss()}`;
const SLUG = "antikythera-mechanism";
const WIDTH = 390;
const AUTHORS: Author[] = [
  { name: "A Very Long First Author Name", affiliations: [] },
  { name: "A Similarly Long Second Author Name", affiliations: [] },
  { name: "A Third Long Author Name", affiliations: [] },
  { name: "A Fourth Author", affiliations: [] },
  { name: "A Fifth Author", affiliations: [] },
];

/** The antikythera facts: its byline, its site name, 11,688 words, 9 parts, 31 sections. */
function article(siteName: string, authors?: Author[]): Article {
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
    titleOverridden: false,
    meta: {
      slug: SLUG,
      title: "Antikythera mechanism",
      byline: "Contributors to Wikimedia projects",
      siteName,
      ...(authors ? { authors } : {}),
    },
    blocks: [
      { id: "spya-aaaaaa", tag: "p", kind: "text", text: "A paragraph.", words: 11688, html: "<p>A paragraph.</p>", gistable: true },
    ],
    assets: undefined,
    navLabelStatus: "ready",
    sourceGuess: undefined,
    tree: { version: "t", generator: "t", slug: SLUG, rootId: "n0", nodes },
  };
}

const page = (siteName: string, extraCss = "", authors?: Author[]) =>
  `<style>${CSS}${extraCss}</style><div class="reader">${renderToStaticMarkup(
    createElement(Masthead, {
      article: article(siteName, authors),
      slug: SLUG,
      /* An owner gets author links rather than focusable spans. That is the
         only owner/visitor difference inside the facts line. */
      ...(authors ? { onRenamed: () => {} } : {}),
    }),
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
              authorLinks: document.querySelectorAll(".facts > span:first-child a.author-name").length,
              moreAuthors: document.querySelector<HTMLButtonElement>(".facts > span:first-child button")?.textContent ?? null,
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

      /* A multi-word fact wider than the whole column wraps at its spaces
         rather than overflowing — what `nowrap` could not do. */
      const long = await look(page("The Proceedings of the National Academy of Sciences of the United States of America"));
      expect(long.scrollWidth, "a long site name pushes the page sideways").toBeLessThanOrEqual(WIDTH);
      for (const right of long.rights) expect(right).toBeLessThanOrEqual(WIDTH);
      expect(long.lines[1], "the long site name was clipped instead of wrapping").toBeGreaterThan(1);

      /* The other shape of the first fact is an author list: nested spans and
         an interactive "+ N more". Exercise the owner's linked version, since
         the plain byline fixture above is already the visitor's masthead. */
      const authored = await look(page("Nature", "", AUTHORS));
      expect(authored.authorLinks).toBe(3);
      expect(authored.moreAuthors).toBe("+ 2 more");
      expect(authored.lines[0], "the author list did not exercise wrapping").toBeGreaterThan(1);
      expect(authored.scrollWidth, "an author list pushes the page sideways").toBeLessThanOrEqual(WIDTH);
      for (const right of authored.rights) expect(right).toBeLessThanOrEqual(WIDTH);
      expect(authored.lines.slice(1), "a fact after the author list split across a line break").toEqual([1, 1, 1, 1, 1]);
    } finally {
      await browser.close().catch(() => {});
    }
  });
});
