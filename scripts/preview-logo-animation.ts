/** Reproduce the static Semaphore proof from the served PNG and actual CSS.
 * npx tsx scripts/preview-logo-animation.ts [--check] [--output <file>]
 * Canvas snapshots show clipping and joints; they do not exercise a browser,
 * animation timing, CSS feature support or the reduced-motion media query. */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createCanvas, GlobalFonts, loadImage, Path2D, type Image } from "@napi-rs/canvas";
import { isMain } from "../src/is-main.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT = path.join(ROOT, "assets/brand/animation-preview.png");
const SIZE = 256;
type Point = readonly [number, number];
interface Polygon { points: Point[]; fill: "evenodd" | "nonzero" }
interface Layer { clip: Polygon; pivot: Point; angle: number }

function declaration(css: string, selector: string, property: string): string {
  let found: string | undefined;
  for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!block[1]?.split(",").some((one) => one.trim() === selector)) continue;
    for (const value of (block[2] ?? "").split(";")) {
      const colon = value.indexOf(":");
      if (value.slice(0, colon).trim() === property) found = value.slice(colon + 1).trim();
    }
  }
  if (!found) throw new Error(`Missing ${property} for ${selector}`);
  return found;
}

/** Deliberately narrow: a future CSS mechanism must fail instead of silently
 * drawing an obsolete approximation. Unitless zero is valid CSS. */
function point(value: string): Point {
  const pair = /^(-?(?:\d+(?:\.\d*)?|\.\d+)%|0)\s+(-?(?:\d+(?:\.\d*)?|\.\d+)%|0)$/.exec(value.trim());
  if (!pair) throw new Error(`Expected two percentage coordinates: ${value}`);
  const x = Number.parseFloat(pair[1] ?? ""), y = Number.parseFloat(pair[2] ?? "");
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Invalid coordinates: ${value}`);
  return [x * SIZE / 100, y * SIZE / 100];
}

function polygon(value: string): Polygon {
  const match = /^polygon\(\s*(evenodd\s*,\s*)?([\s\S]+)\)$/.exec(value);
  if (!match?.[2]) throw new Error(`Expected a percentage polygon: ${value}`);
  const points = match[2].split(",").map(point);
  if (points.length < 3) throw new Error(`Polygon has fewer than three vertices: ${value}`);
  return { points, fill: match[1] ? "evenodd" : "nonzero" };
}

function rotation(value: string): number {
  const match = /^rotate\((-?(?:\d+(?:\.\d*)?|\.\d+))deg\)$/.exec(value);
  if (!match) throw new Error(`Only rotate(deg) is supported, found: ${value}`);
  const angle = Number(match[1]);
  if (!Number.isFinite(angle)) throw new Error(`Invalid rotation: ${value}`);
  return angle;
}

function peakRotation(css: string, animation: string): number {
  const name = /^([a-z][a-z0-9-]*)\s/.exec(animation)?.[1];
  if (!name) throw new Error(`Cannot read animation name: ${animation}`);
  const start = css.indexOf(`@keyframes ${name} {`);
  if (start < 0) throw new Error(`Missing keyframes: ${name}`);
  const open = css.indexOf("{", start);
  let depth = 1, end = open + 1;
  while (depth > 0 && end < css.length) {
    if (css[end] === "{") depth++;
    if (css[end] === "}") depth--;
    end++;
  }
  if (depth !== 0) throw new Error(`Unclosed keyframes: ${name}`);
  const angles: number[] = [];
  let finishesAtRest = false;
  for (const stop of css.slice(open + 1, end - 1).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const transform = /(?:^|;)\s*transform\s*:\s*([^;]+)/.exec(stop[2] ?? "")?.[1]?.trim();
    if (!transform) throw new Error(`Missing transform in ${name}`);
    const angle = rotation(transform);
    angles.push(angle);
    if (stop[1]?.split(",").some((one) => ["100%", "to"].includes(one.trim()))) finishesAtRest = angle === 0;
  }
  if (!finishesAtRest || !angles.some((angle) => angle !== 0)) throw new Error(`Expected ${name} to wave and return to rest`);
  return angles.reduce((peak, angle) => Math.abs(angle) > Math.abs(peak) ? angle : peak, 0);
}

function clipPath(polygon: Polygon): Path2D {
  const result = new Path2D();
  polygon.points.forEach(([x, y], index) => {
    if (index === 0) result.moveTo(x, y);
    else result.lineTo(x, y);
  });
  result.closePath();
  return result;
}

function frame(mark: Image, base: Polygon, layers: Layer[], raised: number | null, original = false) {
  const canvas = createCanvas(SIZE, SIZE), ctx = canvas.getContext("2d");
  if (original) { ctx.drawImage(mark, 0, 0); return canvas; }
  ctx.save();
  ctx.clip(clipPath(base), base.fill);
  ctx.drawImage(mark, 0, 0);
  ctx.restore();
  for (const [index, layer] of layers.entries()) {
    ctx.save();
    ctx.translate(...layer.pivot);
    ctx.rotate((index === raised ? layer.angle : 0) * Math.PI / 180);
    ctx.translate(-layer.pivot[0], -layer.pivot[1]);
    ctx.clip(clipPath(layer.clip), layer.clip.fill);
    ctx.drawImage(mark, 0, 0);
    ctx.restore();
  }
  return canvas;
}

/** Optional CSS text permits negative-control checks without editing source.
 * The default always reads this checkout's real stylesheet and served PNG. */
export async function renderLogoAnimationPreview(cssText?: string): Promise<Buffer> {
  const css = (cssText ?? await readFile(path.join(ROOT, "src/web/styles/logo-animations.css"), "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const base = polygon(declaration(css, ".spya-semaphore .logo-image", "clip-path"));
  if (base.fill !== "evenodd") throw new Error("Semaphore's complementary clip must use evenodd");
  const layers = ["before", "after"].map((side): Layer => {
    const selector = `.spya-semaphore .logo-mark::${side}`;
    if (rotation(declaration(css, selector, "transform")) !== 0) throw new Error(`Unexpected resting rotation: ${selector}`);
    if (!/^url\(\/spideryarn-logo\.png\) center \/ 100% 100% no-repeat$/.test(declaration(css, selector, "background"))) {
      throw new Error(`Unsupported background image treatment: ${selector}`);
    }
    return {
      clip: polygon(declaration(css, selector, "clip-path")),
      pivot: point(declaration(css, selector, "transform-origin")),
      angle: peakRotation(css, declaration(css, selector, "animation")),
    };
  });
  const mark = await loadImage(await readFile(path.join(ROOT, "public/spideryarn-logo.png")));
  if (mark.width !== SIZE || mark.height !== SIZE) throw new Error(`Expected ${SIZE}px square served mark, found ${mark.width}×${mark.height}`);
  const font = path.join(ROOT, "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2");
  if (!GlobalFonts.registerFromPath(font, "SpideryarnAnimationProof")) throw new Error(`Cannot load pinned Geist: ${font}`);
  const canvas = createCanvas(1500, 900), ctx = canvas.getContext("2d");
  ctx.fillStyle = "#242321";
  ctx.fillRect(0, 0, 1500, 60);
  ctx.fillStyle = "#fafafa";
  ctx.font = "18px SpideryarnAnimationProof";
  ctx.fillText("Static Semaphore reconstruction — canvas snapshots; not a live browser motion or reduced-motion test", 20, 27);
  ctx.font = "13px SpideryarnAnimationProof";
  ctx.fillText("Actual served PNG and CSS clip polygons, pivots and peak rotation angles; reference stills share the resting geometry.", 20, 49);
  const labels = ["Original", "Reconstructed rest", `Left limb ${layers[0]?.angle}°`, `Right limb ${layers[1]?.angle}°`, "Reduced-motion reference"];
  for (const [theme, background, foreground] of [["Dark", "#0a0a0a", "#fafafa"], ["Light", "#fafafa", "#111111"]] as const) {
    const top = theme === "Dark" ? 60 : 480;
    ctx.fillStyle = background;
    ctx.fillRect(0, top, 1500, 420);
    ctx.fillStyle = foreground;
    ctx.font = "17px SpideryarnAnimationProof";
    ctx.fillText(`${theme} theme`, 20, top + 27);
    for (const [index, label] of labels.entries()) {
      const left = index * 300;
      ctx.fillText(label, left + 15, top + 58);
      const image = frame(mark, base, layers, index === 2 ? 0 : index === 3 ? 1 : null, index === 0);
      ctx.drawImage(image, left + 22, top + 78);
      ctx.drawImage(image, left + 45, top + 362, 20, 20);
      ctx.drawImage(image, left + 113, top + 347, 44, 44);
      ctx.font = "12px SpideryarnAnimationProof";
      ctx.fillText("20px", left + 35, top + 407);
      ctx.fillText("44px loader", left + 105, top + 407);
      ctx.font = "17px SpideryarnAnimationProof";
    }
  }
  return canvas.toBuffer("image/png");
}

/** --check compares exact bytes and never writes, including on mismatch. */
export async function previewLogoAnimation(options: { outputPath?: string; check?: boolean; cssText?: string } = {}): Promise<string> {
  const output = options.outputPath ?? OUTPUT;
  const bytes = await renderLogoAnimationPreview(options.cssText);
  if (options.check) {
    const current = await readFile(output);
    if (!current.equals(bytes)) throw new Error(`Static animation proof is stale: ${output}`);
  } else await writeFile(output, bytes);
  return output;
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { check: { type: "boolean" }, output: { type: "string" } } });
  const output = await previewLogoAnimation({ check: values.check ?? false, ...(values.output ? { outputPath: values.output } : {}) });
  console.log(`${values.check ? "verified" : "wrote"} static animation proof: ${output}`);
}
