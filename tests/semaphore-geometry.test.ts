import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const CSS = readFileSync(path.join(ROOT, "src/web/styles/logo-animations.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const ANATOMY = JSON.parse(readFileSync(path.join(ROOT, "tests/fixtures/reader-anatomy.json"), "utf8"));
type Point = readonly [number, number];

function rule(selector: string): string {
  const start = CSS.lastIndexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing rule: ${selector}`);
  return CSS.slice(start, CSS.indexOf("}", start));
}

function polygon(selector: string): Point[] {
  const value = /clip-path:\s*polygon\(([^)]+)\)/.exec(rule(selector))?.[1];
  if (!value) throw new Error(`Missing clip polygon: ${selector}`);
  return [...value.matchAll(/([\d.]+)%?\s+([\d.]+)%?/g)]
    .map((pair) => [Number(pair[1]) * 2.56, Number(pair[2]) * 2.56] as const);
}

/** The same even/odd fill rule as the CSS, including the bridges to each hole. */
function contains(points: readonly Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (!a || !b) throw new Error("Empty polygon");
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

async function pixels(input: string | Buffer) {
  const image = await loadImage(input);
  const canvas = createCanvas(256, 256);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, 256, 256);
  return ctx.getImageData(0, 0, 256, 256).data;
}

/** Hand-labelled source-space anatomy, authored against the selected C master,
 * independently of CSS clipping. All opaque pixels outside the two labelled
 * upper free limbs are stationary, including body, book and six other limbs. */
async function sourcePart(part: "upper" | "stationary") {
  const bytes = readFileSync(path.join(ROOT, "assets/brand/source/reader.png"));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(ANATOMY.sha256);
  const image = await loadImage(bytes);
  const source = createCanvas(image.width, image.height);
  const ctx = source.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;
  let left = image.width, top = image.height, right = -1, bottom = -1;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if ((data[(y * image.width + x) * 4 + 3] ?? 0) < 16) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  const width = right - left + 1, height = bottom - top + 1;
  const scale = 256 * 0.99 / Math.max(width, height);
  const dx = (256 - width * scale) / 2, dy = (256 - height * scale) / 2;
  const output = new Uint8ClampedArray(256 * 256 * 4);
  const regions = ANATOMY.upperFreeLimbs as Point[][];
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const sx = left + (x + 0.5 - dx) / scale;
    const sy = top + (y + 0.5 - dy) / scale;
    const upper = regions.some((region) => contains(region, sx, sy));
    output[(y * 256 + x) * 4 + 3] = (part === "upper" ? upper : !upper) ? 255 : 0;
  }
  return output;
}

function selectedPixels(layer: readonly Point[], index: number, mark: Uint8ClampedArray, upper: Uint8ClampedArray, stationary: Uint8ClampedArray) {
  let intended = 0, selected = 0, wrong = 0, available = 0, fixed = 0;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const offset = (y * 256 + x) * 4 + 3;
    const belongs = (mark[offset] ?? 0) >= 128 && (upper[offset] ?? 0) >= 128 && (index === 0 ? x < 128 : x >= 128);
    if (belongs) available++;
    if (!contains(layer, x + 0.5, y + 0.5) || (mark[offset] ?? 0) < 128) continue;
    selected++;
    if (belongs) intended++; else wrong++;
    if ((stationary[offset] ?? 0) >= 128) fixed++;
  }
  return { coverage: intended / available, unrelated: wrong / selected, fixed, available, selected };
}

function assertLimb(result: ReturnType<typeof selectedPixels>, index: number) {
  expect(result.available, "nonempty anatomical limb").toBeGreaterThan(100);
  expect(result.selected, "nonempty moving fragment").toBeGreaterThan(100);
  expect(result.coverage, `limb ${index}: coverage`).toBeGreaterThan(0.75);
  expect(result.unrelated, `limb ${index}: unrelated foreground`).toBeLessThan(0.015);
  expect(result.fixed, `limb ${index}: body, book and other limbs`).toBe(0);
}

function assertPivot(mark: Uint8ClampedArray, stationary: Uint8ClampedArray, layer: Point[], x: number, y: number) {
  const offset = (Math.floor(y) * 256 + Math.floor(x)) * 4 + 3;
  expect(contains(layer, x, y)).toBe(true);
  expect(mark[offset]).toBeGreaterThan(200);
  expect(stationary[offset]).toBeLessThan(128);
}

describe("Semaphore's moving fragments", () => {
  it("selects both upper free limbs without lifting the body, other limbs or book", async () => {
    const mark = await pixels(path.join(ROOT, "public/spideryarn-logo.png"));
    const upper = await sourcePart("upper");
    const stationary = await sourcePart("stationary");
    const layers = [polygon(".spya-semaphore .logo-mark::before"), polygon(".spya-semaphore .logo-mark::after")];
    for (const [index, layer] of layers.entries()) {
      const result = selectedPixels(layer, index, mark, upper, stationary);
      // Three quarters of each upper limb moves; its proximal stem remains
      // attached while every opaque pixel in the remaining anatomy stays still.
      assertLimb(result, index);
    }
  });

  it("fills every removed foreground pixel at rest, while overlapping the joints only slightly", async () => {
    const mark = await pixels(path.join(ROOT, "public/spideryarn-logo.png"));
    const base = polygon(".spya-semaphore .logo-image");
    const layers = [polygon(".spya-semaphore .logo-mark::before"), polygon(".spya-semaphore .logo-mark::after")];
    let missing = 0, overlap = 0, foreground = 0;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      if ((mark[(y * 256 + x) * 4 + 3] ?? 0) < 128) continue;
      foreground++;
      const still = contains(base, x + 0.5, y + 0.5);
      const moving = layers.some((layer) => contains(layer, x + 0.5, y + 0.5));
      if (!still && !moving) missing++;
      if (still && moving) overlap++;
    }
    expect(missing).toBe(0);
    expect(overlap).toBeGreaterThan(0);
    expect(overlap / foreground).toBeLessThan(0.01);
  });

  it("pivots on the selected upper stems, outside the stationary body", async () => {
    const mark = await pixels(path.join(ROOT, "public/spideryarn-logo.png"));
    const stationary = await sourcePart("stationary");
    for (const side of ["before", "after"]) {
      const selector = `.spya-semaphore .logo-mark::${side}`;
      const origin = /transform-origin:\s*([\d.]+)%\s+([\d.]+)%/.exec(rule(selector));
      if (!origin) throw new Error(`Missing limb pivot: ${selector}`);
      const x = Number(origin[1]) * 2.56, y = Number(origin[2]) * 2.56;
      assertPivot(mark, stationary, polygon(selector), x, y);
    }
  });

  it("rejects a broad crop that lifts the body and the other limbs", async () => {
    const mark = await pixels(path.join(ROOT, "public/spideryarn-logo.png"));
    const upper = await sourcePart("upper"), stationary = await sourcePart("stationary");
    const broad: Point[] = [[0, 0], [128, 0], [128, 200], [0, 200]];
    const result = selectedPixels(broad, 0, mark, upper, stationary);
    expect(result.fixed).toBeGreaterThan(100);
    expect(() => assertLimb(result, 0)).toThrow();
  });

  it("rejects a pivot in the opaque stationary body", async () => {
    const mark = await pixels(path.join(ROOT, "public/spideryarn-logo.png"));
    const stationary = await sourcePart("stationary");
    const x = 100, y = 120, offset = (y * 256 + x) * 4 + 3;
    expect(mark[offset]).toBeGreaterThan(200);
    expect(stationary[offset]).toBe(255);
    // A broad layer contains the bad pivot: the anatomical exclusion, rather
    // than only membership in the CSS polygon, must reject it.
    expect(() => assertPivot(mark, stationary, [[0, 0], [256, 0], [256, 256], [0, 256]], x, y)).toThrow();
  });

});
