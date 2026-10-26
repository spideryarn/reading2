import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { JSDOM } from "jsdom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateBrandAssets } from "../scripts/generate-brand-assets.js";
import { RASTER_TOLERANCE, rastersEquivalent } from "../scripts/raster-equivalence.js";

const ROOT = path.resolve(import.meta.dirname, "..");
let temporary: string;
let outputDir: string;

async function pixels(file: string) {
  const image = await loadImage(await readFile(file));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  return { width: image.width, height: image.height, data: ctx.getImageData(0, 0, image.width, image.height).data };
}

/** Transparent regions that cannot reach the edge detect a filled-in core or
 * book, without baking individual sample pixels into the test. */
function enclosedGaps(data: Uint8ClampedArray, size: number): number {
  const seen = new Set<number>();
  let enclosed = 0;
  for (let start = 0; start < size * size; start++) {
    if (seen.has(start) || (data[start * 4 + 3] ?? 255) > 32) continue;
    const pending = [start];
    let edge = false;
    let area = 0;
    while (pending.length) {
      const current = pending.pop();
      if (current === undefined || seen.has(current)) continue;
      seen.add(current);
      area++;
      const x = current % size;
      const y = Math.floor(current / size);
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1) edge = true;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx === undefined || ny === undefined || nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const next = ny * size + nx;
        if (!seen.has(next) && (data[next * 4 + 3] ?? 255) <= 32) pending.push(next);
      }
    }
    if (!edge && area >= 2) enclosed++;
  }
  return enclosed;
}

beforeAll(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "spideryarn-brand-"));
  outputDir = path.join(temporary, "generated");
  await generateBrandAssets({ outputDir });
});
afterAll(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });

describe("brand assets", () => {
  it("uses the independently selected airier C master", async () => {
    const selected = await readFile(path.join(ROOT, "assets/brand/source/reader.png"));
    expect(createHash("sha256").update(selected).digest("hex")).toBe("9902588192568689966279d6642a942ae792083cc54db1b3e33362f03a090635");
  });
  it("publishes the intended dimensions", async () => {
    const expected = new Map([
      ["spideryarn-logo.png", 256], ["favicon-16x16.png", 16], ["favicon-32x32.png", 32], ["favicon-48x48.png", 48],
      ["spideryarn-reader.png", 512], ["apple-touch-icon.png", 180], ["apple-touch-icon-light.png", 180], ["android-chrome-192x192.png", 192],
      ["android-chrome-512x512.png", 512], ["app-icon-light-1024.png", 1024], ["app-icon-dark-1024.png", 1024],
    ]);
    for (const [file, size] of expected) {
      const decoded = await pixels(path.join(outputDir, file));
      expect([decoded.width, decoded.height], file).toEqual([size, size]);
    }
  });

  it("gives smaller display icons less margin while preserving larger export breathing room", async () => {
    // An independent decoded-pixel contract, not the generator's output table.
    // Source resolutions differ from display sizes: Android512 is a phone tile.
    const expected = [
      ["favicon-16x16.png", 0.99], ["favicon-32x32.png", 0.99], ["favicon-48x48.png", 0.99],
      ["spideryarn-logo.png", 0.99], ["apple-touch-icon.png", 0.84], ["apple-touch-icon-light.png", 0.84],
      ["android-chrome-192x192.png", 0.84], ["android-chrome-512x512.png", 0.84],
      ["spideryarn-reader.png", 0.94], ["app-icon-light-1024.png", 0.76], ["app-icon-dark-1024.png", 0.76],
    ] as const;
    for (const [file, fill] of expected) {
      const { width, height, data } = await pixels(path.join(outputDir, file));
      const background = [...data.slice(0, 4)];
      let left = width, top = height, right = -1, bottom = -1;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4;
        const visible = background[3] === 0
          ? (data[at + 3] ?? 0) >= 128
          : [0, 1, 2].some((channel) => Math.abs((data[at + channel] ?? 0) - (background[channel] ?? 0)) >= 32);
        if (!visible) continue;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
      const longest = Math.max(right - left + 1, bottom - top + 1);
      // Ignore faint antialiased wool fibres at the boundary, with at most
      // one percent or two pixels of rasterisation allowance.
      expect(Math.abs(longest - width * fill), file).toBeLessThanOrEqual(Math.max(2, width * 0.01));
    }
  });

  it.each([16, 32, 48, 256])("retains internal gaps and a substantial foreground at %ipx", async (size) => {
    const file = size === 256 ? "spideryarn-logo.png" : `favicon-${size}x${size}.png`;
    const { data } = await pixels(path.join(outputDir, file));
    expect(data[3]).toBe(0);
    // This master preserves the central hollow at 16/32; the smaller arm
    // gaps resolve at 48/256. The historical outline had a hollow book too.
    const minimumGaps = new Map([[16, 1], [32, 1], [48, 2], [256, 3]]);
    expect(enclosedGaps(data, size)).toBeGreaterThanOrEqual(minimumGaps.get(size) ?? 3);
    const visible: number[] = [];
    for (let i = 0; i < size * size; i++) if ((data[i * 4 + 3] ?? 0) > 127) visible.push(i);
    expect(visible.length).toBeGreaterThan(size * size * 0.2);
    expect(visible.length).toBeLessThan(size * size * 0.65);
    const xs = visible.map((i) => i % size);
    const ys = visible.map((i) => Math.floor(i / size));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(size * 0.8);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(size * 0.8);
  });

  it("uses the selected textured reader and dark book for the app and every favicon", async () => {
    // Independent identity check: the historical orange outline has no dark
    // book. The chosen master has an opaque brown cover in the lower centre.
    for (const size of [16, 32, 48, 256]) {
      const file = size === 256 ? "spideryarn-logo.png" : `favicon-${size}x${size}.png`;
      const { data } = await pixels(path.join(outputDir, file));
      let book = 0;
      for (let y = Math.floor(size * 0.6); y < Math.floor(size * 0.82); y++) {
        for (let x = Math.floor(size * 0.35); x < Math.floor(size * 0.65); x++) {
          const at = (y * size + x) * 4;
          const [r = 255, g = 255, b = 255, a = 0] = data.slice(at, at + 4);
          if (a > 128 && r < 130 && g < 100 && b < 90 && r - g < 40) book++;
        }
      }
      expect(book, `${file} must contain the reader's dark book`).toBeGreaterThan(size * size * 0.015);
    }
    // A full independently cropped master comparison also protects the limbs,
    // texture and hollow body, beyond the distinguishing book colour above.
    const master = await pixels(path.join(ROOT, "assets/brand/source/reader.png"));
    const occupied: number[] = [];
    for (let i = 0; i < master.width * master.height; i++) if ((master.data[i * 4 + 3] ?? 0) >= 16) occupied.push(i);
    const xs = occupied.map((i) => i % master.width);
    const ys = occupied.map((i) => Math.floor(i / master.width));
    const left = xs.reduce((a, b) => Math.min(a, b));
    const top = ys.reduce((a, b) => Math.min(a, b));
    const width = xs.reduce((a, b) => Math.max(a, b)) - left + 1;
    const height = ys.reduce((a, b) => Math.max(a, b)) - top + 1;
    const expected = createCanvas(256, 256);
    const ctx = expected.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    const scale = 256 * 0.99 / Math.max(width, height);
    ctx.drawImage(await loadImage(path.join(ROOT, "assets/brand/source/reader.png")), left, top, width, height,
      (256 - width * scale) / 2, (256 - height * scale) / 2, width * scale, height * scale);
    expect(await rastersEquivalent(await readFile(path.join(outputDir, "spideryarn-logo.png")), expected.toBuffer("image/png"))).toBe(true);
  });

  it("keeps reader transparency and opaque inset install tiles in both themes", async () => {
    const transparent = await pixels(path.join(outputDir, "spideryarn-reader.png"));
    expect(transparent.data[3]).toBe(0);
    let alpha = 0;
    for (let i = 3; i < transparent.data.length; i += 4) if ((transparent.data[i] ?? 0) > 128) alpha++;
    expect(alpha).toBeGreaterThan(512 * 512 * 0.15);
    for (const [file, background] of [
      // Dark by default; the cream touch icon is for a phone in light mode (touch-icon.test.ts).
      ["apple-touch-icon.png", [36, 35, 33, 255]],
      ["apple-touch-icon-light.png", [255, 249, 238, 255]],
      ["android-chrome-192x192.png", [36, 35, 33, 255]],
      ["android-chrome-512x512.png", [36, 35, 33, 255]],
      ["app-icon-light-1024.png", [255, 249, 238, 255]],
      ["app-icon-dark-1024.png", [36, 35, 33, 255]],
    ] as const) {
      const { width, data } = await pixels(path.join(outputDir, file));
      let artwork = 0;
      let nonOpaque = 0;
      for (let i = 0; i < width * width; i++) {
        if (data[i * 4 + 3] !== 255) nonOpaque++;
        if (data[i * 4] !== background[0] || data[i * 4 + 1] !== background[1] || data[i * 4 + 2] !== background[2]) artwork++;
      }
      expect(nonOpaque, file).toBe(0);
      expect([...data.slice(0, 4)]).toEqual(background);
      const inset = (Math.floor(width * 0.1) * width + Math.floor(width / 2)) * 4;
      expect([...data.slice(inset, inset + 4)]).toEqual(background);
      expect(artwork).toBeGreaterThan(width * width * 0.1);
      expect(artwork).toBeLessThan(width * width * 0.65);
    }
  });

  it("packs exact 16/32/48 ICO frames with the same pixels as their PNGs", async () => {
    const ico = await readFile(path.join(outputDir, "favicon.ico"));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 3]);
    for (let i = 0; i < 3; i++) {
      const entry = 6 + i * 16;
      const size = [16, 32, 48][i];
      if (!size) throw new Error("Missing expected ICO size");
      expect([ico[entry], ico[entry + 1], ico.readUInt16LE(entry + 6)]).toEqual([size, size, 32]);
      const offset = ico.readUInt32LE(entry + 12);
      const length = ico.readUInt32LE(entry + 8);
      expect(offset + length).toBeLessThanOrEqual(ico.length);
      const dib = ico.subarray(offset, offset + length);
      expect([dib.readUInt32LE(0), dib.readUInt32LE(4), dib.readUInt32LE(8), dib.readUInt16LE(14)]).toEqual([40, size, size * 2, 32]);
      const png = await pixels(path.join(outputDir, `favicon-${size}x${size}.png`));
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const at = 40 + ((size - 1 - y) * size + x) * 4;
        const expected = [...png.data.slice((y * size + x) * 4, (y * size + x) * 4 + 4)];
        const actual = [dib[at + 2], dib[at + 1], dib[at], dib[at + 3]];
        // RGB under zero alpha has no visual meaning; canvas may zero it.
        if (expected[3] === 0) expect(actual[3]).toBe(0);
        else expect(actual).toEqual(expected);
      }
    }
  });

  it("is repeatable and detects stale/missing files without rewriting", async () => {
    const names = await generateBrandAssets({ outputDir, check: true });
    const first = await Promise.all(names.map((file) => readFile(path.join(outputDir, file))));
    await Promise.all(names.map((file) => utimes(path.join(outputDir, file), 1_000, 1_000)));
    const before = await Promise.all(names.map((file) => stat(path.join(outputDir, file))));
    await generateBrandAssets({ outputDir });
    for (const [i, file] of names.entries()) {
      expect((await readFile(path.join(outputDir, file))).equals(first[i] ?? Buffer.alloc(0))).toBe(true);
      expect((await stat(path.join(outputDir, file))).mtimeMs).toBe(before[i]?.mtimeMs);
    }
    const corrupted = path.join(outputDir, "favicon-16x16.png");
    await writeFile(corrupted, "deliberately stale");
    await rm(path.join(outputDir, "favicon.ico"));
    await expect(generateBrandAssets({ outputDir, check: true })).rejects.toThrow(/favicon-16x16.png, favicon.ico/);
    expect(await readFile(corrupted, "utf8")).toBe("deliberately stale");
    await generateBrandAssets({ outputDir });
  });

  it("rejects opaque/empty masters before creating any outputs", async () => {
    const invalid = path.join(temporary, "invalid.png");
    const destination = path.join(temporary, "must-not-be-created");
    const canvas = createCanvas(512, 512);
    for (const opaque of [true, false]) {
      canvas.getContext("2d").clearRect(0, 0, 512, 512);
      if (opaque) { canvas.getContext("2d").fillStyle = "orange"; canvas.getContext("2d").fillRect(0, 0, 512, 512); }
      await writeFile(invalid, canvas.toBuffer("image/png"));
      await expect(generateBrandAssets({ readerPath: invalid, outputDir: destination })).rejects.toThrow(/transparent background|no visible artwork/);
      await expect(stat(destination)).rejects.toThrow(/ENOENT/);
    }
  });

  /* The committed family is rendered on Greg's Mac and checked on the Linux
     box; Skia antialiases a level or two differently on each. */
  it("keeps an equivalent committed raster byte for byte, but not a changed source", async () => {
    const file = path.join(outputDir, "favicon-48x48.png");
    const { width, data } = await pixels(file);
    const drifted = createCanvas(width, width);
    const image = drifted.getContext("2d").createImageData(width, width);
    image.data.set(data);
    for (let i = 0; i < image.data.length; i += 4) if ((image.data[i + 3] ?? 0) > 128) image.data[i] = Math.max(0, (image.data[i] ?? 0) - 2);
    drifted.getContext("2d").putImageData(image, 0, 0);
    const driftedBytes = drifted.toBuffer("image/png");
    const originalIco = await readFile(path.join(outputDir, "favicon.ico"));
    await writeFile(file, driftedBytes);
    await expect(generateBrandAssets({ outputDir, check: true })).rejects.toThrow("stale: favicon.ico.");
    expect(await readFile(file)).toEqual(driftedBytes);
    expect(await readFile(path.join(outputDir, "favicon.ico"))).toEqual(originalIco);
    // The ICO is repacked from the kept frame, as the other machine's would be.
    await generateBrandAssets({ outputDir });
    expect((await readFile(file)).equals(driftedBytes)).toBe(true);
    await expect(generateBrandAssets({ outputDir, check: true })).resolves.toHaveLength(12);

    const changedReader = path.join(temporary, "changed-reader.png");
    const master = await loadImage(path.join(ROOT, "assets/brand/source/reader.png"));
    const changed = createCanvas(master.width, master.height);
    const ctx = changed.getContext("2d");
    ctx.drawImage(master, 0, 0);
    const imageData = ctx.getImageData(0, 0, master.width, master.height);
    // A visible channel change to the actual master must invalidate every
    // derivative, including the formerly independent small mark and favicons.
    for (let i = 0; i < imageData.data.length; i += 4) {
      if ((imageData.data[i + 3] ?? 0) > 128) imageData.data[i] = Math.max(0, (imageData.data[i] ?? 0) - 35);
    }
    ctx.putImageData(imageData, 0, 0);
    await writeFile(changedReader, changed.toBuffer("image/png"));
    const publicNames = [
      "spideryarn-logo.png", "favicon-16x16.png", "favicon-32x32.png", "favicon-48x48.png",
      "spideryarn-reader.png", "apple-touch-icon.png", "apple-touch-icon-light.png", "android-chrome-192x192.png",
      "android-chrome-512x512.png", "app-icon-light-1024.png", "app-icon-dark-1024.png", "favicon.ico",
    ];
    const publicBefore = await Promise.all(publicNames.map((name) => readFile(path.join(outputDir, name))));
    const extensionFiles = [16, 32, 48, 128].map((size) => path.join(outputDir, "extension-icons", `icon-${size}.png`));
    const extensionBefore = await Promise.all(extensionFiles.map((file) => readFile(file)));
    await expect(generateBrandAssets({ outputDir, readerPath: changedReader, check: true }))
      .rejects.toThrow(/spideryarn-logo.png, favicon-16x16.png, favicon-32x32.png, favicon-48x48.png, spideryarn-reader.png, apple-touch-icon.png, apple-touch-icon-light.png, android-chrome-192x192.png, android-chrome-512x512.png, app-icon-light-1024.png, app-icon-dark-1024.png, icon-16.png, icon-32.png, icon-48.png, icon-128.png, favicon.ico/);
    for (const [index, name] of publicNames.entries()) expect(await readFile(path.join(outputDir, name))).toEqual(publicBefore[index]);
    for (const [index, file] of extensionFiles.entries()) expect(await readFile(file)).toEqual(extensionBefore[index]);
    await generateBrandAssets({ outputDir });
  });

  it("treats a shift beyond the tolerance, a resize or undecodable bytes as different", async () => {
    const canvas = createCanvas(8, 8);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgb(100, 100, 100)";
    ctx.fillRect(0, 0, 8, 8);
    const base = canvas.toBuffer("image/png");
    ctx.fillStyle = `rgb(${100 + RASTER_TOLERANCE}, 100, 100)`;
    ctx.fillRect(0, 0, 1, 1);
    expect(await rastersEquivalent(base, canvas.toBuffer("image/png"))).toBe(true);
    ctx.fillStyle = `rgb(${101 + RASTER_TOLERANCE}, 100, 100)`;
    ctx.fillRect(0, 0, 1, 1);
    expect(await rastersEquivalent(base, canvas.toBuffer("image/png"))).toBe(false);
    expect(await rastersEquivalent(base, createCanvas(8, 9).toBuffer("image/png"))).toBe(false);
    expect(await rastersEquivalent(base, Buffer.from("not a png"))).toBe(false);
    expect(await rastersEquivalent(Buffer.from("not a png"), Buffer.from("not a png"))).toBe(false);
    expect(await rastersEquivalent(Buffer.alloc(0), Buffer.alloc(0))).toBe(false);
  });

  it("compares premultiplied colour and alpha independently", async () => {
    function pixel(red: number, alpha: number): Buffer {
      const canvas = createCanvas(1, 1);
      const ctx = canvas.getContext("2d");
      const image = ctx.createImageData(1, 1);
      image.data.set([red, 0, 0, alpha]);
      ctx.putImageData(image, 0, 0);
      return canvas.toBuffer("image/png");
    }
    expect(await rastersEquivalent(pixel(0, 1), pixel(255, 1))).toBe(true);
    expect(await rastersEquivalent(pixel(0, 64), pixel(32, 64))).toBe(false);
    expect(await rastersEquivalent(pixel(0, 64), pixel(0, 64 + RASTER_TOLERANCE))).toBe(true);
    expect(await rastersEquivalent(pixel(0, 64), pixel(0, 65 + RASTER_TOLERANCE))).toBe(false);
    expect(await rastersEquivalent(pixel(0, 0), pixel(255, 0))).toBe(true);
  });

  it("generates the extension from the same master with transparent toolbar and opaque store treatment", async () => {
    const extensionDir = path.join(outputDir, "extension-icons");
    for (const size of [16, 32, 48]) {
      const file = path.join(extensionDir, `icon-${size}.png`);
      const decoded = await pixels(file);
      expect([decoded.width, decoded.height]).toEqual([size, size]);
      expect(decoded.data[3]).toBe(0);
      expect(await rastersEquivalent(await readFile(file), await readFile(path.join(outputDir, `favicon-${size}x${size}.png`)))).toBe(true);
    }
    const tile = await pixels(path.join(extensionDir, "icon-128.png"));
    expect([tile.width, tile.height]).toEqual([128, 128]);
    expect([...tile.data.slice(0, 4)]).toEqual([255, 249, 238, 255]);
    for (let at = 3; at < tile.data.length; at += 4) expect(tile.data[at]).toBe(255);
    let top = 128, bottom = -1, left = 128, right = -1;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const at = (y * 128 + x) * 4;
      if (Math.max(Math.abs((tile.data[at] ?? 255) - 255), Math.abs((tile.data[at + 1] ?? 249) - 249), Math.abs((tile.data[at + 2] ?? 238) - 238)) <= 20) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    expect(Math.abs(Math.max(right - left + 1, bottom - top + 1) - 128 * 0.76)).toBeLessThanOrEqual(2);
  });

  it("checks isolated extension files without writing or creating absent destinations", async () => {
    const extensionDir = path.join(temporary, "explicit-extension");
    await generateBrandAssets({ outputDir, extensionDir });
    const names = [16, 32, 48, 128].map((size) => `icon-${size}.png`);
    const bytes = await Promise.all(names.map((name) => readFile(path.join(extensionDir, name))));
    await Promise.all(names.map((name) => utimes(path.join(extensionDir, name), 1_000, 1_000)));
    const times = await Promise.all(names.map((name) => stat(path.join(extensionDir, name))));
    await generateBrandAssets({ outputDir, extensionDir, check: true });
    for (const [i, name] of names.entries()) {
      expect(await readFile(path.join(extensionDir, name))).toEqual(bytes[i]);
      expect((await stat(path.join(extensionDir, name))).mtimeMs).toBe(times[i]?.mtimeMs);
    }
    const corrupt = path.join(extensionDir, "icon-32.png");
    await writeFile(corrupt, "stale extension image");
    await rm(path.join(extensionDir, "icon-128.png"));
    await expect(generateBrandAssets({ outputDir, extensionDir, check: true })).rejects.toThrow(/icon-32.png, icon-128.png/);
    expect(await readFile(corrupt, "utf8")).toBe("stale extension image");
    await expect(stat(path.join(extensionDir, "icon-128.png"))).rejects.toThrow(/ENOENT/);
    const absent = path.join(temporary, "absent-extension");
    await expect(generateBrandAssets({ outputDir, extensionDir: absent, check: true })).rejects.toThrow(/icon-16.png/);
    await expect(stat(absent)).rejects.toThrow(/ENOENT/);
  });

  it("keeps the committed public family fresh", async () => {
    await expect(generateBrandAssets({ outputDir: path.join(ROOT, "public"), extensionDir: path.join(ROOT, "extension/icons"), check: true })).resolves.toHaveLength(12);
  });

  it.each(["preview.png", "tiny-size-preview.png", "browser-preview.html"])("detects missing/stale %s without writing", async (file) => {
    const previewDir = path.join(temporary, `${file}-proofs`);
    const options = { outputDir, preview: true, previewDir };
    await generateBrandAssets(options);
    const proof = path.join(previewDir, file);
    const original = await readFile(proof);
    await rm(proof);
    await expect(generateBrandAssets({ ...options, check: true })).rejects.toThrow(file);
    await expect(stat(proof)).rejects.toThrow(/ENOENT/);
    await writeFile(proof, "deliberately stale proof");
    await expect(generateBrandAssets({ ...options, check: true })).rejects.toThrow(file);
    expect(await readFile(proof, "utf8")).toBe("deliberately stale proof");
    await writeFile(proof, original);
    const before = await Promise.all(["preview.png", "tiny-size-preview.png", "browser-preview.html"].map((file) => stat(path.join(previewDir, file))));
    await expect(generateBrandAssets({ ...options, check: true })).resolves.toHaveLength(12);
    for (const [i, file] of ["preview.png", "tiny-size-preview.png", "browser-preview.html"].entries()) {
      expect((await stat(path.join(previewDir, file))).mtimeMs).toBe(before[i]?.mtimeMs);
    }
  });

  it("declares real favicon resources and 16 logical pixel Retina samples in the browser proof", async () => {
    const previewDir = path.join(temporary, "browser-proof");
    await generateBrandAssets({ outputDir, previewDir, preview: true });
    const doc = new JSDOM(await readFile(path.join(previewDir, "browser-preview.html"), "utf8")).window.document;
    const links = [...doc.querySelectorAll('link[rel="icon"][type="image/png"]')];
    expect(links.map((link) => [link.getAttribute("sizes"), link.getAttribute("href")])).toEqual(
      [16, 32, 48].map((size) => [`${size}x${size}`, `../../public/favicon-${size}x${size}.png`]),
    );
    const samples = [...doc.querySelectorAll('img[srcset]')];
    expect(samples).toHaveLength(2);
    for (const sample of samples) {
      expect(sample.getAttribute("width")).toBe("16");
      expect(sample.getAttribute("height")).toBe("16");
      expect(sample.getAttribute("srcset")).toBe("../../public/favicon-16x16.png 1x, ../../public/favicon-32x32.png 2x");
    }
    expect(doc.querySelectorAll("section.light img, section.dark img")).toHaveLength(16);
    expect(doc.querySelector("section.light img:last-of-type")?.getAttribute("src"))
      .toBe("../../public/apple-touch-icon-light.png");
    expect(doc.querySelector("section.dark img:last-of-type")?.getAttribute("src"))
      .toBe("../../public/apple-touch-icon.png");
    for (const image of doc.querySelectorAll("img")) {
      const relative = image.getAttribute("src");
      expect(relative).toMatch(/^\.\.\/\.\.\/public\/[\w-]+\.png$/);
      await expect(stat(path.join(ROOT, "assets/brand", relative ?? ""))).resolves.toBeDefined();
    }
    const proof = await pixels(path.join(previewDir, "preview.png"));
    const rgbaAt = (x: number, y: number) => [...proof.data.slice((y * proof.width + x) * 4, (y * proof.width + x + 1) * 4)];
    expect(rgbaAt(110, 478)).toEqual([255, 249, 238, 255]);
    expect(rgbaAt(510, 478)).toEqual([36, 35, 33, 255]);
  });

  it("does not create absent public/proof destinations in check mode", async () => {
    const missingOutput = path.join(temporary, "absent-public");
    const missingPreview = path.join(temporary, "absent-proofs");
    await expect(generateBrandAssets({ outputDir: missingOutput, previewDir: missingPreview, preview: true, check: true })).rejects.toThrow(/missing or stale/);
    await expect(stat(missingOutput)).rejects.toThrow(/ENOENT/);
    await expect(stat(missingPreview)).rejects.toThrow(/ENOENT/);
    await expect(stat(path.join(missingOutput, "extension-icons"))).rejects.toThrow(/ENOENT/);
  });

  it("preserves native favicon pixels and unsmoothed 8x diagnostic blocks in the tiny proof", async () => {
    const previewDir = path.join(temporary, "pixel-proof");
    await generateBrandAssets({ outputDir, previewDir, preview: true });
    const sheet = await pixels(path.join(previewDir, "tiny-size-preview.png"));
    const icon = await loadImage(await readFile(path.join(outputDir, "favicon-16x16.png")));
    for (const [left, background] of [[0, "#FFF9EE"], [460, "#242321"]] as const) {
      const expected = createCanvas(16, 16);
      const ctx = expected.getContext("2d");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, 16, 16);
      ctx.drawImage(icon, 0, 0);
      const data = ctx.getImageData(0, 0, 16, 16).data;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const rgba = [...data.slice((y * 16 + x) * 4, (y * 16 + x + 1) * 4)];
        for (const [px, py] of [[left + 30 + x, 84 + y], [left + 30 + x * 8 + 3, 486 + y * 8 + 3]]) {
          if (px === undefined || py === undefined) throw new Error("Missing proof coordinate");
          const at = (py * sheet.width + px) * 4;
          expect([...sheet.data.slice(at, at + 4)]).toEqual(rgba);
        }
      }
    }
  });

  it("serves image bytes matching the shell and install manifest declarations", async () => {
    const head = new JSDOM(await readFile(path.join(ROOT, "index.html"), "utf8")).window.document;
    const pngLinks = [...head.querySelectorAll('link[rel="icon"][type="image/png"], link[rel="apple-touch-icon"]')];
    expect(pngLinks).toHaveLength(4);
    for (const link of pngLinks) {
      const href = link.getAttribute("href");
      expect(href).toMatch(/^\/[\w-]+\.png(\?v=\d+)?$/);
      const image = await pixels(path.join(ROOT, "public", href?.replace(/\?.*$/, "").slice(1) ?? ""));
      expect(link.getAttribute("sizes")).toBe(`${image.width}x${image.height}`);
    }
    const manifest = JSON.parse(await readFile(path.join(ROOT, "public/site.webmanifest"), "utf8")) as {
      icons: { src: string; sizes: string; type: string; purpose: string }[];
    };
    expect(manifest.icons).toHaveLength(2);
    for (const icon of manifest.icons) {
      expect(icon.src).toMatch(/^\/[\w-]+\.png$/);
      const image = await pixels(path.join(ROOT, "public", icon.src.slice(1)));
      expect(icon.sizes).toBe(`${image.width}x${image.height}`);
      expect(icon.type).toBe("image/png");
      expect(icon.purpose).toBe("any");
    }
  });
});
