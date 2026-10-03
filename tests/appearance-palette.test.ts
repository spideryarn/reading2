/**
 * **The light palette exists for every token that needs one, and its core
 * pairs are legible** — styles/tokens.css and src/web/styles/tokens.css, each
 * with a dark `:root` block and a `:root[data-theme="light"]` block.
 *
 * Two kinds of check, and they answer different questions (GPT Sol, plan
 * review of 261003e):
 *
 * - **Parity is a tripwire for a forgotten name, no more.** Every token in a
 *   dark block whose value is written as a literal colour — not an alias of
 *   another token — must be redefined in the light block or be on the
 *   theme-neutral list below with a reason. It cannot tell a good light value
 *   from a copied dark one.
 * - **Contrast is the check on the values.** The few pairs that decide whether
 *   the page can be read at all, measured in both themes.
 *
 * The scales in styles/colourscales.css have their own invariants per theme in
 * tests/colour-scales.test.ts; component stylesheets are swept for fixed
 * white and black in tests/appearance-fixed-colours.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const FILES = ["styles/tokens.css", "src/web/styles/tokens.css"] as const;

/** Token -> value, for the first top-level block opening with `selector {`. */
function block(css: string, selector: string): Map<string, string> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const at = text.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no ${selector} block`);
  let depth = 0;
  let end = at;
  for (let i = text.indexOf("{", at); i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  const body = text.slice(text.indexOf("{", at) + 1, end);
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)) {
    out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

const dark = new Map<string, string>();
const light = new Map<string, string>();
for (const f of FILES) {
  const css = readFileSync(join(root, f), "utf8");
  for (const [k, v] of block(css, ":root")) dark.set(k, v);
  for (const [k, v] of block(css, ':root[data-theme="light"]')) light.set(k, v);
}

/** A value that names a colour itself rather than pointing at another token. */
const LITERAL = /oklch\(|#[0-9a-f]{3,8}\b|^\d+ \d+ \d+$|\b(white|black)\b/i;

/** The same in both themes, on purpose. */
const NEUTRAL: Record<string, string> = {
  "--spideryarn-orange": "the brand; unchanged as a fill on either ground",
  "--primary": "the brand orange in OKLCH",
  "--figure-sheet": "article figures are printed on a light sheet in both themes",
};

describe("every literal colour token has a light value", () => {
  const needs = [...dark].filter(([k, v]) => LITERAL.test(v) && !(k in NEUTRAL)).map(([k]) => k);

  it("finds the tokens it is meant to be checking", () => {
    /* A parser that found nothing would pass the next test vacuously. */
    expect(needs).toEqual(expect.arrayContaining(["--background", "--foreground", "--ink-soft"]));
    expect(needs.length).toBeGreaterThan(20);
  });

  it.each(needs)("%s", (name) => {
    expect(light.has(name), `${name} has no light value, and is not on NEUTRAL`).toBe(true);
  });

  it("tells the browser which furniture to draw", () => {
    expect(dark.get("color-scheme")).toBe("dark");
    expect(light.get("color-scheme")).toBe("light");
  });
});

/* ------------------------------------------------------------- contrast -- */

type Rgb = [number, number, number];

function oklabToSrgb([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((c) => Math.min(1, Math.max(0, c))) as Rgb;
}

function srgbToOklab(rgb: Rgb): Rgb {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r! + 0.5363288628 * g! + 0.0514459929 * b!);
  const m = Math.cbrt(0.2119034982 * r! + 0.6806995451 * g! + 0.1073969566 * b!);
  const s = Math.cbrt(0.0883024619 * r! + 0.2817188376 * g! + 0.6299787005 * b!);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Linear-light sRGB of a token, resolving the few shapes these blocks use. */
function resolve(name: string, palette: Map<string, string>): Rgb {
  const value = palette.get(name) ?? dark.get(name);
  if (!value) throw new Error(`${name} is not defined`);
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  if (alias) return resolve(alias[1]!, palette);
  const ok = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (ok) {
    const [L, C, h] = [Number(ok[1]), Number(ok[2]), (Number(ok[3]) * Math.PI) / 180];
    return oklabToSrgb([L, C * Math.cos(h), C * Math.sin(h)]);
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    const enc = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
    return oklabToSrgb(srgbToOklab(enc as Rgb));
  }
  const mix = /^color-mix\(in oklab, var\((--[\w-]+)\) (\d+)%, (white|black)\)$/.exec(value);
  if (mix) {
    const p = Number(mix[2]) / 100;
    const a = srgbToOklab(linearToEncoded(resolve(mix[1]!, palette)));
    const b: Rgb = mix[3] === "white" ? [1, 0, 0] : [0, 0, 0];
    return oklabToSrgb([0, 1, 2].map((i) => p * a[i]! + (1 - p) * b[i]!) as Rgb);
  }
  throw new Error(`${name}: cannot resolve ${value}`);
}

function linearToEncoded(lin: Rgb): Rgb {
  return lin.map((c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)) as Rgb;
}

function contrast(a: string, b: string, palette: Map<string, string>): number {
  const Y = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const ya = Y(resolve(a, palette));
  const yb = Y(resolve(b, palette));
  return (Math.max(ya, yb) + 0.05) / (Math.min(ya, yb) + 0.05);
}

/** [foreground, background, the WCAG floor it must clear] */
const PAIRS: [string, string, number][] = [
  ["--foreground", "--background", 7],
  ["--ink-soft", "--background", 4.5],
  ["--muted-foreground", "--background", 4.5],
  ["--foreground", "--sidebar", 7],
  ["--muted-foreground", "--sidebar", 4.5],
  ["--highlight-ink", "--background", 4.5],
  ["--popover-foreground", "--popover", 7],
];

describe.each([
  ["dark", dark],
  ["light", new Map([...dark, ...light])],
] as const)("the %s theme's core pairs", (_theme, palette) => {
  it.each(PAIRS)("%s on %s clears %s:1", (fg, bg, floor) => {
    expect(contrast(fg, bg, palette)).toBeGreaterThanOrEqual(floor);
  });
});
