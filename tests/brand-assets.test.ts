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
  it("publishes the intended dimensions", async () => {
    const expected = new Map([
      ["spideryarn-logo.png", 256], ["favicon-16x16.png", 16], ["favicon-32x32.png", 32], ["favicon-48x48.png", 48],
      ["spideryarn-reader.png", 512], ["apple-touch-icon.png", 180], ["android-chrome-192x192.png", 192],
      ["android-chrome-512x512.png", 512], ["app-icon-light-1024.png", 1024], ["app-icon-dark-1024.png", 1024],
    ]);
    for (const [file, size] of expected) {
      const decoded = await pixels(path.join(outputDir, file));
      expect([decoded.width, decoded.height], file).toEqual([size, size]);
    }
  });

  it.each([16, 32, 48, 256])("retains internal gaps and a substantial foreground at %ipx", async (size) => {
    const file = size === 256 ? "spideryarn-logo.png" : `favicon-${size}x${size}.png`;
    const { data } = await pixels(path.join(outputDir, file));
    expect(data[3]).toBe(0);
    expect(enclosedGaps(data, size)).toBeGreaterThanOrEqual(size === 16 ? 1 : 3);
    const visible: number[] = [];
    for (let i = 0; i < size * size; i++) if ((data[i * 4 + 3] ?? 0) > 127) visible.push(i);
    expect(visible.length).toBeGreaterThan(size * size * 0.2);
    expect(visible.length).toBeLessThan(size * size * 0.65);
    const xs = visible.map((i) => i % size);
    const ys = visible.map((i) => Math.floor(i / size));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(size * 0.8);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(size * 0.8);
  });

  it("keeps reader transparency and opaque inset install tiles in both themes", async () => {
    const transparent = await pixels(path.join(outputDir, "spideryarn-reader.png"));
    expect(transparent.data[3]).toBe(0);
    let alpha = 0;
    for (let i = 3; i < transparent.data.length; i += 4) if ((transparent.data[i] ?? 0) > 128) alpha++;
    expect(alpha).toBeGreaterThan(512 * 512 * 0.15);
    for (const [file, background] of [
      ["apple-touch-icon.png", [255, 249, 238, 255]],
      ["android-chrome-192x192.png", [255, 249, 238, 255]],
      ["android-chrome-512x512.png", [255, 249, 238, 255]],
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
    for (let i = 0; i < image.data.length; i += 4) if (image.data[i + 3] === 255) image.data[i] = Math.max(0, (image.data[i] ?? 0) - 2);
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
    await expect(generateBrandAssets({ outputDir, check: true })).resolves.toHaveLength(11);

    const changedMark = path.join(temporary, "changed-mark.svg");
    const svg = await readFile(path.join(ROOT, "assets/brand/source/mark.svg"), "utf8");
    for (const changed of [svg.replaceAll("#DB8A45", "#DB8A4D"), svg.replace('stroke-width="18"', 'stroke-width="17.5"')]) {
      expect(changed).not.toBe(svg);
      await writeFile(changedMark, changed);
      await expect(generateBrandAssets({ outputDir, markPath: changedMark, check: true }))
        .rejects.toThrow(/spideryarn-logo.png, favicon-16x16.png, favicon-32x32.png, favicon-48x48.png, favicon.ico/);
    }
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

  it("keeps the committed public family fresh", async () => {
    await expect(generateBrandAssets({ outputDir: path.join(ROOT, "public"), check: true })).resolves.toHaveLength(11);
  });

  it.each(["preview.png", "tiny-size-preview.png"])("detects missing/stale %s without writing", async (file) => {
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
    const before = await Promise.all(["preview.png", "tiny-size-preview.png"].map((file) => stat(path.join(previewDir, file))));
    await expect(generateBrandAssets({ ...options, check: true })).resolves.toHaveLength(11);
    for (const [i, file] of ["preview.png", "tiny-size-preview.png"].entries()) {
      expect((await stat(path.join(previewDir, file))).mtimeMs).toBe(before[i]?.mtimeMs);
    }
  });

  it("does not create absent public/proof destinations in check mode", async () => {
    const missingOutput = path.join(temporary, "absent-public");
    const missingPreview = path.join(temporary, "absent-proofs");
    await expect(generateBrandAssets({ outputDir: missingOutput, previewDir: missingPreview, preview: true, check: true })).rejects.toThrow(/missing or stale/);
    await expect(stat(missingOutput)).rejects.toThrow(/ENOENT/);
    await expect(stat(missingPreview)).rejects.toThrow(/ENOENT/);
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
      expect(href).toMatch(/^\/[\w-]+\.png$/);
      const image = await pixels(path.join(ROOT, "public", href?.slice(1) ?? ""));
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
