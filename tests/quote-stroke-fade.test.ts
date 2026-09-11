// @vitest-environment jsdom
/**
 * **A quote's outline fades with its priority, and never so far that it stops
 * being clearly visible.** Greg, 2026-09-10 (SPIDERYARN-READING2-2W):
 *
 * > perhaps slightly fade the border based on the priority-score (but even
 * > low-priority quotes should still be clearly visible)
 *
 * Stroke WEIGHT already carried priority (260907c: 1px / 3px), so this is a
 * second channel on an existing mark, and the two properties worth holding are
 * the ones the plan argues for: the two channels move the same way, so they
 * cannot cancel; and the faintest stroke there can ever be clears a contrast
 * floor computed from the real tokens, so "clearly visible" is a checked claim
 * rather than a feeling. docs/plans/260911a-quotes-find-more-and-a-fade-that-carries-priority.md § 1.
 *
 * jsdom for the last block, which renders through the real `annotateHtml`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QUOTE_ALPHA_FLOOR, quoteAlpha, quoteStroke, quoteTier } from "../src/web/QuotesPanel.js";
import { hitMarks, resolveQuotes } from "../src/web/search-hits.js";
import { annotateHtml } from "../src/web/annotate.js";
import type { Block, Quote } from "../src/types.js";

const q = (importance?: number, striking?: number): Quote => ({
  id: "q",
  blockId: "spya-aaaaaa",
  text: "Writing is thinking",
  ...(importance === undefined ? {} : { importance }),
  ...(striking === undefined ? {} : { striking }),
});

describe("quoteAlpha", () => {
  it("runs from the floor to full strength with priority", () => {
    expect(quoteAlpha(q())).toBe(QUOTE_ALPHA_FLOOR);
    expect(quoteAlpha(q(0.2))).toBe(QUOTE_ALPHA_FLOOR);
    expect(quoteAlpha(q(0.5))).toBe(QUOTE_ALPHA_FLOOR);
    expect(quoteAlpha(q(0.75))).toBe(0.85);
    expect(quoteAlpha(q(1))).toBe(1);
  });

  it("reads priorityOf — the higher of the two scores — like the weight and the bar", () => {
    expect(quoteAlpha(q(0.5, 1))).toBe(1);
    expect(quoteAlpha(q(undefined, 0.75))).toBe(0.85);
  });

  it("moves the same way as the weight at every priority, so the two never cancel", () => {
    /* The failure this rules out is thick-but-faint or thin-but-bright: a
       quote the weight says matters more and the fade says matters less. */
    const priorities = Array.from({ length: 101 }, (_, i) => i / 100);
    for (const [i, lo] of priorities.entries()) {
      for (const hi of priorities.slice(i + 1)) {
        expect(quoteTier(q(lo))).toBeLessThanOrEqual(quoteTier(q(hi)));
        expect(quoteAlpha(q(lo))).toBeLessThanOrEqual(quoteAlpha(q(hi)));
      }
    }
  });

  it("is continuous across the weight's step — a heavy quote is never fainter than a light one", () => {
    expect(quoteAlpha(q(0.8))).toBeGreaterThanOrEqual(quoteAlpha(q(0.79)));
  });
});

/* -------------------------------------------------- the floor, measured ---

   WCAG 2.2 § 1.4.11 asks 3:1 of a non-text mark against what is next to it.
   Computed from the tokens as they are written, so a later edit to the page
   colour, the stroke colour or the floor re-runs this rather than going round
   it. Composited in gamma-encoded sRGB, which is what the browser does with
   `rgb(r g b / a)` over an opaque background. */

const TOKENS = readFileSync(path.join(import.meta.dirname, "../styles/tokens.css"), "utf8");

function token(name: string): string {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(TOKENS);
  if (!m?.[1]) throw new Error(`${name} is not in styles/tokens.css`);
  return m[1].trim();
}

/** sRGB 0–255 of an achromatic `oklch(L 0 0)` — the page is one. */
function achromaticOklch(value: string): number {
  const m = /^oklch\(\s*([\d.]+)\s+0\s+0\s*\)$/.exec(value);
  if (!m?.[1]) throw new Error(`expected an achromatic oklch(), got ${value}`);
  const linear = Number(m[1]) ** 3; // OKLab with a = b = 0: l = m = s = L³, and RGB = that
  const encoded = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
  return encoded * 255;
}

function luminance(rgb: readonly number[]): number {
  const lin = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (lin[0] ?? 0) + 0.7152 * (lin[1] ?? 0) + 0.0722 * (lin[2] ?? 0);
}

function contrastAt(alpha: number): number {
  const page = achromaticOklch(token("--background"));
  const stroke = token("--quote-stroke-rgb").split(/\s+/).map(Number);
  const over = stroke.map((c) => alpha * c + (1 - alpha) * page);
  const a = luminance(over);
  const b = luminance([page, page, page]);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("the faintest stroke there can be", () => {
  it("is the page colour the tokens actually define", () => {
    /* The page is `--page: var(--background)`; this test reads `--background`,
       so it has to still be what the page is. */
    const tokensCss = readFileSync(path.join(import.meta.dirname, "../src/web/styles/tokens.css"), "utf8");
    expect(tokensCss).toMatch(/--page:\s*var\(--background\)/);
  });

  it("clears 3:1 against the page, with room to spare", () => {
    expect(contrastAt(QUOTE_ALPHA_FLOOR)).toBeGreaterThan(4.5);
  });

  it("would NOT clear it if the floor were dropped to nothing — the check can fail", () => {
    expect(contrastAt(0.3)).toBeLessThan(3);
  });
});

/* ------------------------------------------------------- into the markup --- */

describe("the fade reaches the mark", () => {
  const html = "<p>Writing is thinking, and there is no way round that.</p>";
  const blocks: Block[] = [
    { id: "spya-aaaaaa", tag: "p", kind: "text", text: html.replace(/<[^>]+>/g, ""), words: 10, html, gistable: true },
  ];

  const markup = (quote: Quote) => {
    const found = resolveQuotes(blocks, [{ ...quote, stroke: quoteStroke(quote) }]);
    const marks = hitMarks(found, null, "rg").get("spya-aaaaaa") ?? [];
    return annotateHtml(html, [...marks]);
  };

  it("writes --quote-a into the mark's style, beside data-quote", () => {
    const out = markup(q(0.75));
    expect(out).toContain('data-quote="1"');
    expect(out).toMatch(/style="[^"]*--quote-a:0\.85/);
  });

  it("writes the floor for an unscored quote rather than leaving it to the stylesheet", () => {
    expect(markup(q())).toMatch(/--quote-a:0\.70/);
  });

  it("does not give a quote a wash while giving it a fade", () => {
    const out = markup(q(1));
    expect(out).toContain('data-quote="2"');
    expect(out).not.toContain("data-wash");
    expect(out).not.toContain("--hit-a");
  });
});

describe("the stylesheet", () => {
  const css = readFileSync(path.join(import.meta.dirname, "../src/web/styles/annotations.css"), "utf8");

  it("draws the stroke at --quote-a, falling back to the token's own 0.95", () => {
    expect(css).toMatch(
      /mark\.hit\[data-quote\]\s*\{[^}]*--quote-stroke-color:\s*rgb\(var\(--quote-stroke-rgb\)\s*\/\s*var\(--quote-a,\s*0\.95\)\)/,
    );
  });

  it("still overrides the whole colour when a quote is pressed, so the fade never dims it", () => {
    expect(css).toMatch(/mark\.hit\[data-quote\]\[data-hit-open\]\s*\{[^}]*--quote-stroke-color:\s*#ffffff/);
  });
});
