/**
 * **The one check that reads what a reader sees** — the marks' generated
 * content, resolved by a real cascade in a real browser.
 *
 * Everything else about the sign after a valence-painted mark is checked
 * without one: `tests/annotate.test.ts` asserts the attribute, and
 * `tests/valence.test.ts` reads the `content` declarations out of styles.css.
 * Neither can see the thing that actually went wrong. GPT Sol's finding 2 was a
 * **cascade** defect — two `::after` rules at equal specificity, and the later
 * one won, so a comment's own marker disappeared from any passage a criterion
 * had also marked — and specificity is not observable in the markup, not
 * observable in the stylesheet text, and not implemented by jsdom, which has no
 * `getComputedStyle` for pseudo-elements worth the name.
 *
 * So: one Chrome, one page, `setContent` with the real stylesheet inlined, and
 * `getComputedStyle(el, "::after").content`. No dev server, no sign-in, no
 * fixtures — this is not a browser *suite*, it is the smallest thing that can
 * see a cascade. docs/project/browser-testing-playwright.md is the larger
 * apparatus, and this deliberately does not use it.
 *
 * **Skipped, loudly, where there is no Chrome.** The remote box provisions one
 * and Greg's Mac has one (`chromePath` in scripts/browser-sign-in.ts knows
 * both), so on the two machines this repo runs on it runs. A skip elsewhere is
 * the honest answer rather than a red suite on a machine that cannot possibly
 * answer the question.
 */
import { describe, expect, it } from "vitest";

import { chromePath } from "../scripts/browser-sign-in.js";
import { readerCss } from "./helpers/stylesheets.js";

/** Whether this machine can answer the question at all. */
const chrome = (() => {
  try {
    return chromePath();
  } catch {
    return null;
  }
})();

/* The reading-view sheets as a set, concatenated in cascade order — which is
   what has to be inlined into the page, and what `src/web/styles.css` stopped
   being on 2026-09-06. tests/helpers/stylesheets.ts. */
const CSS = readerCss();

/**
 * The markup `annotateHtml` produces for these three cases, written out rather
 * than generated.
 *
 * Deliberately a literal: the point of this file is the *stylesheet*, and
 * running the annotator here would make a failure ambiguous between the two.
 * The shapes are the ones tests/annotate.test.ts pins, so the two cannot drift
 * without that file going red first.
 */
const PAGE = `
  <p><mark class="hit" data-hit="h1" data-dir="against" id="sign">a passage</mark></p>
  <p><mark class="cmt" data-comment="c1" data-mark-end="" id="comment">a passage</mark></p>
  <p><mark class="cmt hit" data-comment="c1" data-mark-end="" data-hit="h1" data-dir="against" id="both">a passage</mark></p>
  <p><mark class="cmt hit" data-comment="c1" data-mark-end="" data-hit="h1" data-dir="for" id="both-for">a passage</mark></p>
`;

describe.skipIf(chrome === null)("what the marks actually draw, in Chrome", () => {
  it(
    "keeps both carriers where a comment and a criterion mark the same phrase",
    { timeout: 60_000 },
    async () => {
      const { chromium } = await import("playwright-core");
      /* `describe.skipIf` has already decided this, but the compiler has not:
         `exactOptionalPropertyTypes` refuses an `executablePath` that might be
         undefined, and a bare non-null assertion would be the same claim
         without the message a future reader needs. */
      if (chrome === null) throw new Error("no Chrome, and this test should have been skipped");
      const browser = await chromium.launch({
        headless: true,
        executablePath: chrome,
        /* The box runs as an unprivileged user with no user namespaces to
           spare, so Chrome's own sandbox cannot start — the same argument
           scripts/browser-sign-in.ts passes for the same reason. */
        args: ["--no-sandbox"],
      });
      try {
        const page = await browser.newPage();
        await page.setContent(`<style>${CSS}</style>${PAGE}`);
        const after = (id: string) =>
          page.evaluate(
            (sel) => getComputedStyle(document.querySelector(sel) as Element, "::after").content,
            `#${id}`,
          );

        /* The premise: each rule draws its own glyph on its own. If either of
           these is empty the test below would pass for the wrong reason. */
        expect(await after("sign"), "the sign rule draws nothing at all").toContain("−");
        expect(await after("comment"), "the comment marker draws nothing at all").toContain("✳");

        /* **The finding.** Before the fix this was `"−"` — the reader's own
           marker gone, on exactly the passages they had written on. */
        const both = await after("both");
        expect(both, "the reader's comment marker was erased by our sign").toContain("✳");
        expect(both, "our sign was erased by the reader's comment marker").toContain("−");

        /* And the per-direction override still reaches the combined case: a
           fix that printed the against glyph on every overlap would satisfy
           every assertion above while telling the reader the opposite of what
           the panel says. */
        const forBoth = await after("both-for");
        expect(forBoth).toContain("✳");
        expect(forBoth).toContain("+");
        expect(forBoth).not.toContain("−");
      } finally {
        await browser.close().catch(() => {});
      }
    },
  );
});
