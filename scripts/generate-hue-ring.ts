/**
 * Prints the `--hue-*` block for styles/colourscales.css: HUE_STOPS stops at one
 * OKLCH lightness over an open hue arc, each at the most chroma sRGB can show
 * there, up to a cap. docs/project/colour-scales.md § Hue ring.
 *
 *   npx tsx scripts/generate-hue-ring.ts
 *
 * Generated rather than hand-picked for the reason the diverging scales are:
 * the relationship between the stops (one lightness, hue climbing evenly) is
 * the whole content of the scale, and tests/colour-scales.test.ts measures it.
 */
import { HUE_STOPS } from "../src/web/topic-colour.js";

const L = 0.76; // the lightness of the lifted categorical hues on the near-black page
const C_MAX = 0.16;
const H_FIRST = 25; // red
const H_LAST = 290; // violet — short of 360 so the ends do not meet back at red

function oklchToLinearSrgb(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -1e-6 && v <= 1 + 1e-6);
const encode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

const lines: string[] = [];
for (let i = 0; i < HUE_STOPS; i++) {
  const h = H_FIRST + ((H_LAST - H_FIRST) * i) / (HUE_STOPS - 1);
  let c = C_MAX;
  while (c > 0 && !inGamut(oklchToLinearSrgb(L, c, h))) c -= 0.0005;
  const rgb = oklchToLinearSrgb(L, c, h).map((v) => Math.round(Math.min(1, Math.max(0, encode(v))) * 255));
  const decl = `    --hue-${i}-rgb: ${rgb.join(" ")};`.padEnd(34);
  lines.push(`${decl}/* h ${h.toFixed(1)}  C ${c.toFixed(3)} */`);
}
lines.push("");
for (let i = 0; i < HUE_STOPS; i++) lines.push(`    --hue-${i}: rgb(var(--hue-${i}-rgb));`);
console.log(lines.join("\n"));
