/**
 * **Every modal's and panel's close cross is one size, and the size is in one
 * place** — styles/close.css § `.close-x`. Greg, 2026-10-01, on an iPad: the
 * comment card's cross was about 20 × 15px and he kept missing it.
 * docs/plans/261002i-ipad-touch-targets-shelf-card-actions-on-the-bottom-row-bigger-close-crosses-a-visible-band-scrollbar.md.
 *
 * Two ways for that to quietly undo itself, one assertion each: a close that
 * loses the class (it goes back to whatever its own rule says), and a
 * component rule that sets a size again (it loads after close.css, so on equal
 * specificity it wins and the shared size silently stops applying to it).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readerCss } from "./helpers/stylesheets.js";

/** The closes Greg's "modals or panels" covers: component file, its own class. */
const CLOSES: ReadonlyArray<readonly [string, string]> = [
  ["CommentDialog.tsx", "cmt-close"],
  ["AnnotateDialog.tsx", "annotate-close"],
  ["ChatDialog.tsx", "chat-dialog-close"],
  ["FeedbackDialog.tsx", "fb-close"],
  ["Lightbox.tsx", "lightbox-close"],
  ["Dock.tsx", "dock-close"],
  ["RefereeCard.tsx", "ref-how-close"],
];

/* Comments out, or the one above a rule becomes part of its selector. */
const css = readerCss().replace(/\/\*[\s\S]*?\*\//g, "");

/** Every declaration block whose selector list names `.cls` (not `.cls:hover`). */
function rulesFor(cls: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const selectors = (m[1] ?? "").split(",").map((s) => s.trim());
    if (selectors.includes(`.${cls}`)) out.push(m[2] ?? "");
  }
  return out;
}

describe("the close cross", () => {
  it("is 32px, in px, with an 18px glyph", () => {
    const [rule] = rulesFor("close-x");
    expect(rule, "the .close-x rule").toBeTruthy();
    expect(rule).toMatch(/(?:^|[\s;])width:\s*32px;/);
    expect(rule).toMatch(/(?:^|[\s;])height:\s*32px;/);
    expect(css).toMatch(/\.close-x > svg\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/);
  });

  it("reaches 40px under a finger without growing the box", () => {
    expect(css).toMatch(
      /@media \(any-pointer: coarse\)\s*\{\s*\.close-x::after\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*-4px;/,
    );
  });

  /* The target reaches 4px past the box, so a neighbour closer than that loses
     taps to it. Annotate's Copy is the one close with a button right beside it. */
  it("leaves Annotate's Copy enough room that Close cannot take its taps", () => {
    const gap = /\.annotate-head-actions\s*\{[^}]*gap:\s*([^;]+);/.exec(css)?.[1]?.trim() ?? "";
    expect(gap).toMatch(/px$/);
    expect(Number.parseFloat(gap)).toBeGreaterThanOrEqual(4);
  });

  for (const [file, cls] of CLOSES) {
    it(`${cls} wears it and sets no size of its own`, () => {
      const src = readFileSync(new URL(`../src/web/${file}`, import.meta.url), "utf8");
      expect(src).toContain(`className="${cls} close-x"`);
      const own = rulesFor(cls);
      expect(own.length, `a rule for .${cls}`).toBeGreaterThan(0);
      for (const body of own) {
        expect(body).not.toMatch(/(?:^|[\s;])(?:min-|max-)?(?:width|height)\s*:/);
        expect(body).not.toMatch(/(?:^|[\s;])padding(?:-[a-z]+)?\s*:/);
      }
    });
  }
});
