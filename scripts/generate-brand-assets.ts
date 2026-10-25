/** One source family, one explicit output table. All images are rendered and
 * validated before any destination is touched. Run `npm run brand:generate`;
 * `--check` verifies committed images without writing, comparing decoded
 * pixels rather than bytes (raster-equivalence.ts). `--preview` includes
 * assets/brand/preview.png, tiny-size-preview.png and browser-preview.html; combine both flags to
 * verify them. See main-icon.md. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas, GlobalFonts, loadImage, type Image } from "@napi-rs/canvas";
import pngToIco from "png-to-ico";
import { rastersEquivalent } from "./raster-equivalence.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const LIGHT = "#FFF9EE";
const DARK = "#242321";

/** Padding is a fraction of each edge, around the visible alpha bounds.
 * Tiny display marks use almost the full box; phone tiles retain a moderate
 * inset, and large exports more breathing room. Resolution is not display size:
 * the 512px Android asset is still a phone tile. Operating systems mask tiles. */
export const BRAND_OUTPUTS = [
  { file: "spideryarn-logo.png", size: 256, padding: 0.005 },
  { file: "favicon-16x16.png", size: 16, padding: 0.005 },
  { file: "favicon-32x32.png", size: 32, padding: 0.005 },
  { file: "favicon-48x48.png", size: 48, padding: 0.005 },
  { file: "spideryarn-reader.png", size: 512, padding: 0.03 },
  { file: "apple-touch-icon.png", size: 180, padding: 0.08, background: LIGHT },
  { file: "android-chrome-192x192.png", size: 192, padding: 0.08, background: LIGHT },
  { file: "android-chrome-512x512.png", size: 512, padding: 0.08, background: LIGHT },
  { file: "app-icon-light-1024.png", size: 1024, padding: 0.12, background: LIGHT },
  { file: "app-icon-dark-1024.png", size: 1024, padding: 0.12, background: DARK },
] as const;

interface Bounds { x: number; y: number; width: number; height: number }
interface Source { image: Image; bounds: Bounds; hash: string }
interface RenderSpec { size: number; padding: number; background?: string }

async function source(file: string): Promise<Source> {
  const bytes = await readFile(file);
  const image = await loadImage(bytes);
  if (image.width < 256 || image.height < 256) throw new Error(`Source too small: ${file}`);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  let transparent = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const alpha = pixels[(y * image.width + x) * 4 + 3] ?? 0;
      if (alpha <= 2) transparent++;
      // Exclude imperceptible antialiasing/shadow pixels from optical bounds.
      if (alpha < 16) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error(`Source has no visible artwork: ${file}`);
  const cornerOffsets = [0, image.width - 1, (image.height - 1) * image.width, image.width * image.height - 1];
  if (transparent < image.width * image.height * 0.1 || cornerOffsets.some((i) => (pixels[i * 4 + 3] ?? 0) > 2)) {
    throw new Error(`Source must have transparent background and corners: ${file}`);
  }
  if (right - left < image.width * 0.4 || bottom - top < image.height * 0.4) {
    throw new Error(`Source artwork occupies too little of the master: ${file}`);
  }
  return {
    image, bounds: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 },
    hash: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
  };
}

function render(input: Source, output: RenderSpec): Buffer {
  const canvas = createCanvas(output.size, output.size);
  const ctx = canvas.getContext("2d");
  if (output.background) {
    ctx.fillStyle = output.background;
    ctx.fillRect(0, 0, output.size, output.size);
  }
  const { bounds } = input;
  const scale = output.size * (1 - output.padding * 2) / Math.max(bounds.width, bounds.height);
  const width = bounds.width * scale;
  const height = bounds.height * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(input.image, bounds.x, bounds.y, bounds.width, bounds.height,
    (output.size - width) / 2, (output.size - height) / 2, width, height);
  return canvas.toBuffer("image/png");
}

function proofCanvas(width: number, height: number) {
  const font = path.join(ROOT, "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2");
  if (!GlobalFonts.registerFromPath(font, "SpideryarnBrandPreview")) throw new Error(`Cannot load preview font: ${font}`);
  return createCanvas(width, height);
}

async function proofImage(files: Map<string, Buffer>, name: string): Promise<Image> {
  const bytes = files.get(name);
  if (!bytes) throw new Error(`Missing preview output: ${name}`);
  return loadImage(bytes);
}

/** Every sample uses generated PNG bytes; fonts and colours are shared by
 * both proofs. A static image is not a browser or device check. */
async function renderPreview(input: Source, files: Map<string, Buffer>): Promise<Buffer> {
  const canvas = proofCanvas(800, 740);
  const ctx = canvas.getContext("2d");
  const detail = await proofImage(files, "spideryarn-reader.png");
  const mark = await proofImage(files, "spideryarn-logo.png");
  const install = await proofImage(files, "apple-touch-icon.png");
  ctx.imageSmoothingQuality = "high";
  ctx.font = "15px SpideryarnBrandPreview";
  for (const [left, background, foreground, label] of [
    [0, LIGHT, DARK, "Light"], [400, DARK, LIGHT, "Dark"],
  ] as const) {
    ctx.fillStyle = background;
    ctx.fillRect(left, 0, 400, 740);
    ctx.fillStyle = foreground;
    ctx.fillText(`${label} - Textured reader at actual display sizes`, left + 20, 30);
    for (const [index, size] of [16, 20, 32, 48].entries()) {
      const png = size === 20 ? mark : await proofImage(files, `favicon-${size}x${size}.png`);
      const x = left + 28 + index * 93;
      ctx.imageSmoothingEnabled = size === 20;
      ctx.drawImage(png, x, 58, size, size);
      ctx.fillText(`${size}px`, x, 132);
    }
    ctx.fillText("Larger reader - same transparent master", left + 20, 180);
    ctx.imageSmoothingEnabled = true;
    for (const [index, size] of [144, 180].entries()) {
      const x = left + 20 + index * 180;
      ctx.drawImage(detail, x, 200, size, size);
      ctx.fillText(`${size}px`, x, 406);
    }
    ctx.fillText("180px install tile - opaque ivory, 8% inset", left + 20, 458);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(install, left + 110, 478);
    ctx.fillText(`One master SHA256 ${input.hash}`, left + 20, 696);
    ctx.fillText("Textured reader for every size", left + 20, 720);
  }
  return canvas.toBuffer("image/png");
}

async function renderTinyPreview(files: Map<string, Buffer>): Promise<Buffer> {
  const canvas = proofCanvas(920, 740);
  const ctx = canvas.getContext("2d");
  const mark = await proofImage(files, "spideryarn-logo.png");
  const install = await proofImage(files, "apple-touch-icon.png");
  const favicon16 = await proofImage(files, "favicon-16x16.png");
  for (const [left, background, foreground, label] of [
    [0, LIGHT, DARK, "LIGHT"], [460, DARK, LIGHT, "DARK"],
  ] as const) {
    ctx.fillStyle = background;
    ctx.fillRect(left, 0, 460, 740);
    ctx.fillStyle = foreground;
    ctx.font = "16px SpideryarnBrandPreview";
    ctx.fillText(`${label} - actual output pixels, 1:1`, left + 20, 30);
    ctx.font = "13px SpideryarnBrandPreview";
    ctx.fillText("Favicons: generated PNGs at native pixels", left + 20, 64);
    ctx.imageSmoothingEnabled = false;
    ctx.imageSmoothingQuality = "high";
    for (const [index, size] of [16, 32, 48].entries()) {
      const x = left + 30 + index * 130;
      ctx.drawImage(await proofImage(files, `favicon-${size}x${size}.png`), x, 84);
      ctx.fillText(`${size}px`, x, 152);
    }
    ctx.fillText("App mark: generated PNG reduced as in a wordmark", left + 20, 196);
    ctx.imageSmoothingEnabled = true;
    for (const [index, size] of [20, 15, 10].entries()) {
      const x = left + 25 + index * 145;
      ctx.drawImage(mark, x, 220, size, size);
      ctx.font = `${14 * size / 20}px SpideryarnBrandPreview`;
      ctx.fillText("Spideryarn", x + size + 6, 220 + size * 0.8);
      ctx.font = "12px SpideryarnBrandPreview";
      ctx.fillText(`${size}px / ${size * 5}% equivalent`, x, 260);
    }
    ctx.font = "13px SpideryarnBrandPreview";
    ctx.fillText("Detailed opaque install tile, reduced from generated PNG", left + 20, 300);
    for (const [index, size] of [60, 48, 32, 24, 16].entries()) {
      const x = left + 25 + index * 86;
      ctx.drawImage(install, x, 325, size, size);
      ctx.fillText(`${size}px`, x, 410);
    }
    ctx.fillText("16px favicon at 8x: enlarged pixels, no smoothing", left + 20, 458);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(favicon16, left + 30, 486, 128, 128);
    ctx.fillText("Assess rows above at native scale; this grid is diagnostic.", left + 20, 658);
    ctx.fillText("Source: generated public PNG bytes, not re-rendered artwork.", left + 20, 684);
    ctx.fillText("Static proof only - not a browser, zoom or device test.", left + 20, 710);
  }
  return canvas.toBuffer("image/png");
}

/** Use the committed public files directly: opening or serving this page
 * exercises browser favicon selection rather than drawing a pretend tab. */
function renderBrowserPreview(): string {
  const sample = (theme: string) => `<section class="${theme}"><h2>${theme} background</h2>
    <p>16 logical pixels, 1× / 2× source selection:</p>
    <img width="16" height="16" src="../../public/favicon-16x16.png" srcset="../../public/favicon-16x16.png 1x, ../../public/favicon-32x32.png 2x" alt="Reader favicon at 16 logical pixels">
    <p>Native source samples: 16, 32 and 48 image pixels:</p>
    ${[16, 32, 48].map((size) => `<img width="${size}" height="${size}" src="../../public/favicon-${size}x${size}.png" alt="${size} pixel favicon">`).join(" ")}
    <p>Same reader in the app, at 20, 44 and 128 logical pixels:</p>
    ${[20, 44, 128].map((size) => `<img width="${size}" height="${size}" src="../../public/spideryarn-logo.png" alt="${size} pixel app reader">`).join(" ")}
    <p>Install tile, 60 logical pixels — 84% artwork fill:</p><img width="60" height="60" src="../../public/apple-touch-icon.png" alt="Install tile"></section>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spideryarn — selected reader tab preview</title>
${[16, 32, 48].map((size) => `<link rel="icon" type="image/png" sizes="${size}x${size}" href="../../public/favicon-${size}x${size}.png">`).join("\n")}
<link rel="icon" type="image/x-icon" href="../../public/favicon.ico">
<style>body{font:16px system-ui;margin:24px;color:#242321}main{display:flex;flex-wrap:wrap;gap:20px}section{padding:24px;min-width:300px;flex:1}section img{vertical-align:middle;margin-right:24px}.light{background:#fff9ee}.dark{background:#242321;color:#fff9ee}p{max-width:70ch}</style></head>
<body><h1>One textured reader, every size</h1><p>Compare at 100% browser zoom. Inspect this page's real tab icon in Chrome on your Mac. A 16 logical pixel tab icon can use 32 image pixels on a 2× display. Tiny marks use 99% of the longest artwork dimension; phone tiles use 84%. Large exports retain their breathing room. The browser chooses its favicon resource; the samples below do not prove which resource it selected or physical Retina quality.</p><main>${sample("light")}${sample("dark")}</main></body></html>
`;
}

export interface GenerateBrandOptions {
  readerPath?: string;
  outputDir?: string;
  check?: boolean;
  preview?: boolean;
  previewDir?: string;
}

async function committed(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return null;
  }
}

/** A committed raster pixel-equivalent to a fresh render is kept byte for
 * byte, so another machine's antialiasing neither fails --check nor churns
 * Git on regeneration. */
async function keepEquivalent(file: string, fresh: Buffer): Promise<{ bytes: Buffer; stale: boolean }> {
  const existing = await committed(file);
  if (existing && await rastersEquivalent(existing, fresh)) return { bytes: existing, stale: false };
  return { bytes: fresh, stale: true };
}

/** Raster proofs allow the same cross-platform rendering tolerance as icons;
 * HTML is deterministic text and must match byte for byte. */
async function collectProofs(input: Source, files: Map<string, Buffer>, previewDir: string, stale: Map<string, Buffer>): Promise<void> {
  for (const [name, fresh] of [
    ["preview.png", await renderPreview(input, files)],
    ["tiny-size-preview.png", await renderTinyPreview(files)],
  ] as const) {
    const file = path.join(previewDir, name);
    const kept = await keepEquivalent(file, fresh);
    if (kept.stale) stale.set(file, kept.bytes);
  }
  const htmlFile = path.join(previewDir, "browser-preview.html");
  const html = Buffer.from(renderBrowserPreview());
  if (!html.equals(await committed(htmlFile) ?? Buffer.alloc(0))) stale.set(htmlFile, html);
}

/** Exported so tests exercise the real pipeline against temporary destinations. */
export async function generateBrandAssets(options: GenerateBrandOptions = {}): Promise<string[]> {
  const input = await source(options.readerPath ?? path.join(ROOT, "assets/brand/source/reader.png"));
  const outputDir = options.outputDir ?? path.join(ROOT, "public");
  const files = new Map<string, Buffer>();
  const stale = new Map<string, Buffer>();
  for (const output of BRAND_OUTPUTS) {
    const file = path.join(outputDir, output.file);
    const kept = await keepEquivalent(file, render(input, output));
    files.set(output.file, kept.bytes);
    if (kept.stale) stale.set(file, kept.bytes);
  }
  // Packed from the kept PNGs, so the ICO is exact bytes on every machine.
  const frames = [16, 32, 48].map((size) => {
    const frame = files.get(`favicon-${size}x${size}.png`);
    if (!frame) throw new Error(`Missing ICO frame ${size}`);
    return frame;
  });
  const ico = await pngToIco(frames);
  files.set("favicon.ico", ico);
  const icoFile = path.join(outputDir, "favicon.ico");
  if (!ico.equals(await committed(icoFile) ?? Buffer.alloc(0))) stale.set(icoFile, ico);
  // Proofs are review evidence, never served public-family members.
  const previewDir = options.previewDir ?? path.join(ROOT, "assets/brand");
  if (options.preview) await collectProofs(input, files, previewDir, stale);
  if (options.check) {
    const labels = [...stale.keys()].map((file) => path.basename(file));
    if (labels.length) throw new Error(`Brand assets missing or stale: ${labels.join(", ")}. Run npm run brand:generate${options.preview ? " -- --preview" : ""}.`);
  } else {
    await mkdir(outputDir, { recursive: true });
    if (options.preview) await mkdir(previewDir, { recursive: true });
    for (const [file, bytes] of stale) await writeFile(file, bytes);
  }
  return [...files.keys()];
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check" && arg !== "--preview")) throw new Error("Usage: npm run brand:generate -- [--check] [--preview]");
  const check = args.includes("--check");
  const preview = args.includes("--preview");
  const files = await generateBrandAssets({ check, preview });
  console.log(`${check ? "Verified" : "Generated"} ${files.length} public brand assets${preview ? " and assets/brand image/browser proofs" : ""}.`);
}
