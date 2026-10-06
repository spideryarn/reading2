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
  /* Not a modal or a panel, but a cross a finger has to hit at tablet widths
     (GPT Sol's F5 on plan 261006i). */
  ["marginalia/MarginaliaColumn.tsx", "marg-narrow-close"],
];

/* Comments out, or the one above a rule becomes part of its selector. */
const css = readerCss().replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Every declaration block in the CSS, including rules nested in `@media`.
 *
 * A flat `selector { body }` regexp silently treats an at-rule as the selector
 * and its first nested rule as the body. That is exactly where a later
 * finger-only size would be written, so missing nested blocks would make this
 * guard green over the regression it exists to catch.
 */
function blocks(source: string): ReadonlyArray<{ prelude: string; body: string }> {
  const found: Array<{ prelude: string; body: string }> = [];
  const stack: Array<{ prelude: string; bodyStart: number }> = [];
  let boundary = 0;
  let quote: "\"" | "'" | null = null;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "\"" || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{") {
      stack.push({ prelude: source.slice(boundary, i).trim(), bodyStart: i + 1 });
      boundary = i + 1;
    } else if (ch === "}") {
      const block = stack.pop();
      if (block) found.push({ prelude: block.prelude, body: source.slice(block.bodyStart, i) });
      boundary = i + 1;
    } else if (ch === ";") {
      boundary = i + 1;
    }
  }
  return found;
}

/** The class is on the element selected at the right edge, pseudo-classes included. */
function targetsClass(selector: string, cls: string): boolean {
  const at = selector.lastIndexOf(`.${cls}`);
  if (at < 0) return false;
  const afterName = selector[at + cls.length + 1];
  if (afterName && /[a-zA-Z0-9_-]/.test(afterName)) return false;
  return !/[ >+~]/.test(selector.slice(at + cls.length + 1));
}

function rulesFor(cls: string, source = css): string[] {
  return blocks(source)
    .filter(({ prelude }) => !prelude.startsWith("@"))
    .filter(({ prelude }) => prelude.split(",").some((selector) => targetsClass(selector.trim(), cls)))
    .map(({ body }) => body);
}

describe("the close cross", () => {
  it("sees a size hidden in an at-rule, selector list, or pseudo-class", () => {
    const fixture = "@media (any-pointer: coarse) { .other, .probe:hover { width: 40px; } }";
    expect(rulesFor("probe", fixture)).toEqual([" width: 40px; "]);
  });

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
        expect(body).not.toMatch(
          /(?:^|[\s;])(?:min-|max-)?(?:width|height|inline-size|block-size)\s*:/,
        );
        expect(body).not.toMatch(/(?:^|[\s;])padding(?:-[a-z]+)?\s*:/);
      }
    });
  }
});
