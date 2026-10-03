/**
 * **The two palettes, as the token files write them, and the colour maths to
 * measure them** — for any test that asks a contrast question, in both themes.
 *
 * styles/tokens.css and src/web/styles/tokens.css each have a dark `:root`
 * block and a `:root[data-theme="light"]` block of the same names
 * (docs/project/web-client.md § Appearance). A test that greps a token's first
 * declaration reads one theme by accident; this reads each on purpose. The
 * light palette is the dark one with the light block laid over it, which is
 * what the cascade does.
 *
 * Colours resolve to **linear-light sRGB**, through the few shapes the blocks
 * use: `oklch(L C H)`, `#rrggbb`, `var(--x)`, and
 * `color-mix(in oklab, var(--x) N%, white|black)`. Anything else throws rather
 * than guessing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const FILES = ["styles/tokens.css", "src/web/styles/tokens.css"] as const;

export type Theme = "dark" | "light";
export type Rgb = [number, number, number];

/** Token -> value, for the first top-level block opening with `selector {`. */
export function block(css: string, selector: string): Map<string, string> {
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

/** The dark block's declarations, and the light block's alone. */
export const DARK_BLOCK = new Map<string, string>();
export const LIGHT_BLOCK = new Map<string, string>();
for (const f of FILES) {
  const css = readFileSync(join(root, f), "utf8");
  for (const [k, v] of block(css, ":root")) DARK_BLOCK.set(k, v);
  for (const [k, v] of block(css, ':root[data-theme="light"]')) LIGHT_BLOCK.set(k, v);
}

/** Each theme's palette as the cascade resolves it. */
export const PALETTE: Record<Theme, Map<string, string>> = {
  dark: DARK_BLOCK,
  light: new Map([...DARK_BLOCK, ...LIGHT_BLOCK]),
};

function oklabToLinear([L, a, b]: Rgb): Rgb {
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

function linearToOklab([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363288628 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export const encode = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
export const decode = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Linear-light sRGB of a token in a palette. */
export function resolve(name: string, palette: Map<string, string>): Rgb {
  const value = palette.get(name);
  if (!value) throw new Error(`${name} is not defined`);
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  if (alias) return resolve(alias[1]!, palette);
  const ok = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (ok) {
    const [L, C, h] = [Number(ok[1]), Number(ok[2]), (Number(ok[3]) * Math.PI) / 180];
    return oklabToLinear([L, C * Math.cos(h), C * Math.sin(h)]);
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => decode(c / 255)) as Rgb;
  }
  const mix = /^color-mix\(in oklab, var\((--[\w-]+)\) (\d+)%, (white|black)\)$/.exec(value);
  if (mix) {
    const p = Number(mix[2]) / 100;
    const a = linearToOklab(resolve(mix[1]!, palette));
    const b: Rgb = mix[3] === "white" ? [1, 0, 0] : [0, 0, 0];
    return oklabToLinear([0, 1, 2].map((i) => p * a[i]! + (1 - p) * b[i]!) as Rgb);
  }
  throw new Error(`${name}: cannot resolve ${value}`);
}

/** Relative luminance of a linear-light colour. */
export const luminance = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export const ratio = (ya: number, yb: number) => (Math.max(ya, yb) + 0.05) / (Math.min(ya, yb) + 0.05);

export function contrast(a: string, b: string, palette: Map<string, string>): number {
  return ratio(luminance(resolve(a, palette)), luminance(resolve(b, palette)));
}

/**
 * `fg` drawn at `alpha` over `bg`, composited the way `opacity` is — in
 * gamma-encoded sRGB — and returned linear again.
 */
export function over(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return [0, 1, 2].map((i) =>
    decode(encode(bg[i]!) + alpha * (encode(fg[i]!) - encode(bg[i]!))),
  ) as Rgb;
}
