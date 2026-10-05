// @vitest-environment jsdom
/**
 * **A quote is a fill, like a highlighter pen, and how strong the fill is says
 * how much the quote matters.** Greg, 2026-10-03 (`spya-xrgste`):
 *
 * > I think the quotes should be like with a highlighter pen, so filled in, and
 * > the searches should have an outline.
 *
 * Until then a quote was an outline whose weight and brightness carried the
 * priority (260907c, 260911a), and this file was `quote-stroke-fade.test.ts`.
 * The two inputs are the same two, so the first block is unchanged: the tier
 * and the fade move the same way and cannot cancel. What is new is what a fill
 * can get wrong that a stroke could not, each computed from the real tokens in
 * both themes: the article's words must stay readable on the strongest fill,
 * the faintest fill must still differ from the page, the two tiers must differ
 * from each other, and the fill's hue must stay clear of the reader's own four
 * highlighter colours. The spine strip keeps the old floor, because it is
 * still a thin line in its own strip colour.
 * docs/plans/261003l-quotes-filled-like-a-highlighter-pen-and-search-hits-outlined.md.
 *
 * jsdom for the block that renders through the real `annotateHtml`.
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

  it("moves the same way as the tier at every priority, so the two never cancel", () => {
    /* The failure this rules out is strong-but-faint or light-but-bright: a
       quote the tier says matters more and the fade says matters less. */
    const priorities = Array.from({ length: 101 }, (_, i) => i / 100);
    for (const [i, lo] of priorities.entries()) {
      for (const hi of priorities.slice(i + 1)) {
        expect(quoteTier(q(lo))).toBeLessThanOrEqual(quoteTier(q(hi)));
        expect(quoteAlpha(q(lo))).toBeLessThanOrEqual(quoteAlpha(q(hi)));
      }
    }
  });

  it("does not reset at the tier's step — it advances by one ordinary fade step", () => {
    const below = quoteAlpha(q(0.79));
    const at = quoteAlpha(q(0.8));
    expect(at).toBeGreaterThanOrEqual(below);
    expect(at - below).toBeCloseTo(0.01, 10);
  });
});

/* ------------------------------------------------ the colours, measured ---

   Computed from the tokens as they are written, so a later edit to the page
   colour, the quote colour, a fill strength or a reader's highlight re-runs
   this rather than going round it. Composited in gamma-encoded sRGB, which is
   what the browser does with `rgb(r g b / a)` over an opaque background. */

const read = (file: string) => readFileSync(path.join(import.meta.dirname, "..", file), "utf8");
const BASE = read("styles/tokens.css");
const WEB = read("src/web/styles/tokens.css");
const SHEET = read("src/web/styles/annotations.css");
const SCALES = read("styles/colourscales.css");

type Theme = "dark" | "light";
const THEMES: readonly Theme[] = ["dark", "light"];
const LIGHT = ':root[data-theme="light"] {';

/** One theme's half of a token file: the light block, or everything before it. */
function half(css: string, theme: Theme): string {
  const at = css.indexOf(LIGHT);
  if (at < 0) throw new Error("no light block in the token file");
  return theme === "light" ? css.slice(at) : css.slice(0, at);
}

function token(css: string, theme: Theme, name: string): string {
  const m = new RegExp(`\\s${name}:\\s*([^;]+);`).exec(half(css, theme));
  if (!m?.[1]) throw new Error(`${name} is not set for ${theme}`);
  return m[1].trim();
}

/** sRGB 0–255 of an achromatic `oklch(L 0 0)` — the page and the ink are both one. */
function achromaticOklch(value: string): number {
  const m = /^oklch\(\s*([\d.]+)\s+0\s+0\s*\)$/.exec(value);
  if (!m?.[1]) throw new Error(`expected an achromatic oklch(), got ${value}`);
  const linear = Number(m[1]) ** 3; // OKLab with a = b = 0: l = m = s = L³, and RGB = that
  const encoded = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
  return encoded * 255;
}

const linear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

function luminance(rgb: readonly number[]): number {
  return 0.2126 * linear(rgb[0] ?? 0) + 0.7152 * linear(rgb[1] ?? 0) + 0.0722 * linear(rgb[2] ?? 0);
}

function contrast(a: readonly number[], b: readonly number[]): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The OKLCH hue, in degrees, of an sRGB colour. */
function hueOf(rgb: readonly number[]): number {
  const [r, g, b] = [linear(rgb[0] ?? 0), linear(rgb[1] ?? 0), linear(rgb[2] ?? 0)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
}

const page = (theme: Theme) => Array<number>(3).fill(achromaticOklch(token(BASE, theme, "--background")));
const ink = (theme: Theme) => Array<number>(3).fill(achromaticOklch(token(BASE, theme, "--foreground")));
/** Prose that is not gistable (prose.css) is drawn in this. */
const softInk = (theme: Theme) => Array<number>(3).fill(achromaticOklch(token(WEB, theme, "--ink-soft")));

const encode = (x: number) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
function toOklab(rgb: readonly number[]): [number, number, number] {
  const [r, g, b] = [linear(rgb[0] ?? 0), linear(rgb[1] ?? 0), linear(rgb[2] ?? 0)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOklab([L, A, B]: readonly [number, number, number]): number[] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(encode);
}

/** An article link's colour: `--highlight-ink`, the orange mixed toward white or black in oklab. */
function linkInk(theme: Theme): number[] {
  const value = token(WEB, theme, "--highlight-ink");
  const m = /^color-mix\(in oklab, var\(--spideryarn-orange\) (\d+)%, (white|black)\)$/.exec(value);
  if (!m?.[1] || !m[2]) throw new Error(`--highlight-ink is not the mix this test knows: ${value}`);
  const hex = /--spideryarn-orange:\s*#([0-9a-f]{6})/i.exec(BASE)?.[1];
  if (!hex) throw new Error("--spideryarn-orange is not a hex colour");
  const orange = toOklab([0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)));
  const other = toOklab(m[2] === "white" ? [255, 255, 255] : [0, 0, 0]);
  const p = Number(m[1]) / 100;
  return fromOklab([0, 1, 2].map((i) => p * (orange[i] ?? 0) + (1 - p) * (other[i] ?? 0)) as [number, number, number]);
}
/** The spine strip's colour, and on the light page the prose fill's as well. */
const quoteRgb = (theme: Theme) => token(BASE, theme, "--quote-rgb").split(/\s+/).map(Number);
/** The fill's colour in the prose. Its own token since 2026-10-05, when the
    dark page's became a deeper purple and the spine strip kept `--quote-rgb`
    (Greg: "I don't mind if they're slightly different from the Spine"). */
const proseRgb = (theme: Theme) => token(BASE, theme, "--quote-prose-rgb").split(/\s+/).map(Number);

const mix = (fg: readonly number[], bg: readonly number[], alpha: number) =>
  fg.map((c, i) => alpha * c + (1 - alpha) * (bg[i] ?? 0));

/** The prose fill at `alpha` over the page, or over another ground a quote can sit on. */
function over(theme: Theme, alpha: number, ground: readonly number[] = page(theme)): number[] {
  return mix(proseRgb(theme), ground, alpha);
}

/** The spine strip's colour at `alpha` over the page. */
const stripOver = (theme: Theme, alpha: number) => mix(quoteRgb(theme), page(theme), alpha);

const chromaOf = (rgb: readonly number[]) => {
  const [, a, b] = toOklab(rgb);
  return Math.hypot(a, b);
};

/** `--muted`: the ground of a block the reader cannot gist (prose.css §
    `td.text.opaque`), a code block among them. Lighter than the dark page, so
    text on a fill there has less room than the same text on the page. */
const mutedGround = (theme: Theme) => Array<number>(3).fill(achromaticOklch(token(BASE, theme, "--muted")));

/** The colour a rule in the stylesheet mixes: `color-mix(in oklab, var(--name) N%, transparent)`. */
function ruleAlpha(selector: string, property: string, name: string): number {
  const rule = new RegExp(`\\n${selector.replace(/[.[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(SHEET)?.[1] ?? "";
  const m = new RegExp(`${property}:[^;]*color-mix\\(in oklab, var\\(${name}\\) (\\d+)%, transparent\\)`).exec(rule);
  if (!m?.[1]) throw new Error(`${selector} no longer draws ${property} as a mix of ${name}`);
  return Number(m[1]) / 100;
}
const brandOrange = () => {
  const hex = /--spideryarn-orange:\s*#([0-9a-f]{6})/i.exec(BASE)?.[1];
  if (!hex) throw new Error("--spideryarn-orange is not a hex colour");
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
};

/** Each tier's strength in one theme. A token since 2026-10-05, when the dark
    page's went up and the light page's stayed (`spya-s0gppw`, plan 261005f). */
function fillStrength(theme: Theme, tier: 1 | 2): number {
  const value = Number(token(BASE, theme, tier === 1 ? "--quote-fill-light" : "--quote-fill-heavy"));
  if (!(value > 0 && value < 1)) throw new Error(`tier ${tier}'s strength is not a fraction for ${theme}`);
  return value;
}

describe("the tokens this reads are the ones the page uses", () => {
  it("the page is --background and the ink is --foreground", () => {
    expect(WEB).toMatch(/--page:\s*var\(--background\)/);
    expect(WEB).toMatch(/--ink:\s*var\(--foreground\)/);
  });

  it("the fill is the prose quote colour at --quote-a times the tier's strength", () => {
    expect(SHEET).toMatch(
      /mark\.hit\[data-quote\]\s*\{[^}]*background-color:\s*rgb\(var\(--quote-prose-rgb\)\s*\/\s*calc\(var\(--quote-a,\s*0\.95\)\s*\*\s*var\(--quote-fill\)\)\)/,
    );
  });

  it("the spine strip keeps its colour, and the prose colour is used by the fill alone", () => {
    /* Or `stripOver` and `over` below would be summing colours the page does
       not draw. Comments are stripped: both names are discussed in them. */
    const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(quoteRgb("dark")).toEqual([204, 151, 243]);
    expect(code("src/web/styles/spine.css")).toMatch(/\.spine-quote\s*\{[^}]*background:\s*rgb\(var\(--quote-rgb\)\s*\/\s*var\(--quote-a,\s*0\.95\)\)/);
    expect(code("src/web/styles/spine.css")).not.toContain("--quote-prose-rgb");
    expect(code("src/web/styles/annotations.css").match(/--quote-prose-rgb/g)).toHaveLength(1);
    expect(code("src/web/styles/annotations.css")).not.toContain("--quote-rgb");
  });

  it("each tier takes its strength from the theme's token, and from nowhere else", () => {
    /* Or `fillStrength` below would be reading two numbers the page does not use. */
    const code = SHEET.replace(/\/\*[\s\S]*?\*\//g, "");
    const set = [...code.matchAll(/([^{}]*)\{[^}]*--quote-fill:\s*([^;]+);/g)].map((m) => [m[1]?.trim(), m[2]?.trim()]);
    expect(set).toEqual([
      ["mark.hit[data-quote]", "var(--quote-fill-light)"],
      ['mark.hit[data-quote="2"]', "var(--quote-fill-heavy)"],
    ]);
  });
});

describe.each(THEMES)("the fill, on the %s page", (theme) => {
  const strongest = () => over(theme, 1 * fillStrength(theme, 2));
  const faintest = () => over(theme, QUOTE_ALPHA_FLOOR * fillStrength(theme, 1));

  it("leaves the article's words readable on the strongest fill there can be", () => {
    expect(contrast(ink(theme), strongest())).toBeGreaterThan(4.5);
    expect(contrast(softInk(theme), strongest()), "prose drawn in the soft ink").toBeGreaterThan(4.5);
  });

  it("leaves a link inside a quote clear of 3:1 on the strongest fill", () => {
    /* Not 4.5: on the light page a link is 5.7:1 with no fill behind it at all,
       so no fill a reader could see keeps it there. This is the foreground
       that set the strengths; at 0.42 it was 2.9:1. */
    expect(contrast(linkInk(theme), page(theme)), "control: the link on the bare page").toBeGreaterThan(4.5);
    expect(contrast(linkInk(theme), strongest())).toBeGreaterThan(3);
  });

  it("would NOT leave them readable on a solid fill — the check can fail", () => {
    /* The soft ink, since 2026-10-05: the dark page's deeper purple is dark
       enough that the full ink is still 5.3:1 on a solid fill of it. */
    expect(contrast(softInk(theme), over(theme, 1))).toBeLessThan(4.5);
  });

  it("is still visibly not the page at its faintest", () => {
    /* No highlighter wash meets 3:1 against the page, the reader's own
       included; that floor is for a line. This asks only that the faintest
       quote is a different colour from no quote, and by how much is the
       browser check's to judge. */
    expect(contrast(faintest(), page(theme))).toBeGreaterThan(1.15);
  });

  it.runIf(theme === "dark")("is far enough from the near-black page to be seen there", () => {
    /* Greg, 2026-10-05 (`spya-s0gppw`): "The quote highlighting color is not
       very visible against the black background in dark mode." The ratio above
       passed on the fill he was looking at (1.22), because a luminance ratio
       does not count chroma. So this one is a distance in OKLab: that fill was
       0.107 from the page and the first fix's 0.146. Later that day, on an
       iPad, the first fix was still "a little hard to see", so the floor is
       set between it and the deeper purple that replaced it (0.171, plan
       261005j). */
    const [a, b] = [toOklab(faintest()), toOklab(page(theme))];
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(0.16);
  });

  it.runIf(theme === "dark")("reads as purple at its faintest, not as grey", () => {
    /* The pale lavender at its faintest had a chroma of 0.035 over the page:
       "a dark grey with a little purple in it" (plan 261005f). The deeper
       purple is 0.099 there. This is the half of "hard to see" the distance
       above does not isolate, since a brighter grey also moves away from the
       page. */
    expect(chromaOf(faintest())).toBeGreaterThan(0.08);
  });

  it.runIf(theme === "dark")("is a deeper purple than the spine strip's, at the same hue", () => {
    /* Greg, 2026-10-05: "I don't mind if they're slightly different from the
       Spine". Slightly: the hue is the strip's, so the two still read as one
       thing in two places. Deeper: darker and more saturated. */
    const [prose, strip] = [proseRgb(theme), quoteRgb(theme)];
    expect(Math.abs(hueOf(prose) - hueOf(strip))).toBeLessThan(3);
    expect(chromaOf(prose)).toBeGreaterThan(chromaOf(strip) + 0.05);
    expect(luminance(prose)).toBeLessThan(luminance(strip));
  });

  it.runIf(theme === "dark")("leaves all sixteen search bands and full-confidence outlines clear of 3:1 on the strongest page fill", () => {
    /* A search hit over a quote draws its outline and its band on the fill.
       This sums the opaque band and the full-confidence outline only; low
       confidence outlines are translucent and can regress (plan 261005j).
       The blue is the one that binds: 3.03 on the lavender at 0.36, 3.25 on
       the deeper purple at 0.60. GPT Sol's plan review of 261005f found it.
       Dark only because the dark fill is what moved; the light page's pairs
       have not been summed. */
    for (let slot = 0; slot < 16; slot++) {
      const hue = token(SCALES, theme, `--cat-${slot}-rgb`).split(/\s+/).slice(0, 3).map(Number);
      expect(contrast(hue, strongest()), `--cat-${slot}`).toBeGreaterThan(3);
    }
  });

  it.runIf(theme === "dark")("leaves the soft ink readable on the strongest fill in a block drawn on --muted", () => {
    /* A block the reader cannot gist, a code block among them, is drawn on
       `--muted` in the soft ink (prose.css § td.text.opaque), and a quote can
       sit there. The lavender fill left that at 3.88; the deeper purple is
       darker at the strength it is drawn at, and it is 4.61. Found by GPT
       Sol's review of 261005f (queue entry qi-9wyymfdy). */
    expect(WEB).toMatch(/--ink-soft:/);
    const ground = over(theme, 1 * fillStrength(theme, 2), mutedGround(theme));
    expect(contrast(softInk(theme), ground)).toBeGreaterThan(4.5);
  });

  it.runIf(theme === "dark")("holds minimum contrast floors for glossary and cross-reference rules under the strongest fill", () => {
    /* Neither rule clears 3:1 on a heavy quote, and neither did before the
       fill moved: the glossary's dotted orange was 2.51 on the lavender and
       the cross-reference's grey 2.56. They are 2.58 and 2.56 on the deeper
       purple. The cross-reference loses a little contrast (2.5635 to 2.5562),
       so these are minimum floors, not a proof of no regression. Lifting
       them to 3 is a change to
       the rules, not to the fill (queue entry qi-9wyymfdy). A regression pin,
       so it was not red before the change. */
    const fill = strongest();
    const term = mix(brandOrange(), fill, ruleAlpha("mark.term", "border-bottom", "--highlight"));
    const xref = mix(softInk(theme), fill, ruleAlpha("mark.xref", "text-decoration-color", "--ink-soft"));
    expect(contrast(term, fill), "the glossary's dotted rule").toBeGreaterThan(2.5);
    expect(contrast(xref, fill), "the cross-reference's rule").toBeGreaterThan(2.55);
  });

  it.runIf(theme === "light")("is exactly what it was before the dark page's moved", () => {
    /* Both of 2026-10-05's reports were about the dark page only. The ranges
       above would let the light values drift; this does not. And on the light
       page the prose fill and the spine strip are still one colour. */
    expect(token(BASE, theme, "--quote-rgb")).toBe("127 66 166");
    expect(token(BASE, theme, "--quote-prose-rgb")).toBe("127 66 166");
    expect(fillStrength(theme, 1)).toBe(0.2);
    expect(fillStrength(theme, 2)).toBe(0.32);
  });

  it("draws the heavy tier stronger than the light one where they meet", () => {
    /* At the tier boundary the fade is continuous, so the step is the tiers'. */
    const at = quoteAlpha(q(0.8));
    expect(contrast(over(theme, at * fillStrength(theme, 2)), over(theme, at * fillStrength(theme, 1)))).toBeGreaterThan(1.12);
  });

  it("keeps the spine strip, a thin line in the strip's own colour, clear of 3:1 at the floor", () => {
    expect(contrast(stripOver(theme, QUOTE_ALPHA_FLOOR), page(theme))).toBeGreaterThan(3);
  });

  it.runIf(theme === "dark")("would NOT keep the strip clear if it wore the prose colour — why there are two", () => {
    expect(contrast(over(theme, QUOTE_ALPHA_FLOOR), page(theme))).toBeLessThan(3);
  });

  it("is not one of the reader's own four highlighter colours", () => {
    /* A reader's highlight is a fill too (`--hl-*`), so the hue is what tells
       theirs from the model's. About 40 degrees apart (sRGB rounding leaves 39.9),
       from the tokens. Asked of the prose fill, which is the one that is a
       fill, and of the strip's colour, which must stay its hue. */
    for (const [what, rgb] of [["the fill", proseRgb(theme)], ["the strip", quoteRgb(theme)]] as const) {
      const quoteHue = hueOf(rgb);
      for (const colour of ["yellow", "green", "blue", "pink"]) {
        const m = /oklch\(\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s*\)/.exec(token(WEB, theme, `--hl-${colour}`));
        if (!m?.[1]) throw new Error(`--hl-${colour} is not an oklch() mix for ${theme}`);
        const apart = Math.abs(((quoteHue - Number(m[1]) + 540) % 360) - 180);
        expect(apart, `${colour} at ${m[1]}, ${what} at ${quoteHue.toFixed(0)}`).toBeGreaterThan(39);
      }
    }
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
  it("draws a quote as a fill and no stroke", () => {
    const rule = /mark\.hit\[data-quote\]\s*\{([^}]*)\}/.exec(SHEET)?.[1] ?? "";
    expect(rule).toContain("background-color");
    expect(rule).not.toContain("--mk-");
    expect(rule).not.toContain("box-shadow");
  });

  it("draws a search hit as an outline and no fill", () => {
    const rule = /mark\.hit\[data-wash\]\s*\{([^}]*)\}/.exec(SHEET)?.[1] ?? "";
    expect(rule).toContain("--mk-top");
    expect(rule.replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain("background-color");
  });

  it("rings a pressed quote in the page's strongest ink, so the fade never dims it", () => {
    expect(SHEET).toMatch(/mark\.hit\[data-quote\]\[data-hit-open\]\s*\{[^}]*--mk-top:[^;]*var\(--toward-ink\)/);
  });

  it("gives every hit one box-shadow, which the kinds fill in rather than replace", () => {
    const code = SHEET.replace(/\/\*[\s\S]*?\*\//g, "");
    const declared = [...code.matchAll(/(mark\.hit[^{}]*)\{[^}]*\bbox-shadow:/g)].map((m) => m[1]?.trim());
    expect(declared).toEqual(["mark.hit"]);
  });
});
