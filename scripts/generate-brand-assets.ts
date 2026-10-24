/** One source family, one explicit output table. All images are rendered and
 * validated before any destination is touched. Run `npm run brand:generate`;
 * `--check` verifies committed bytes without writing. `--preview` includes
 * assets/brand/preview.png and tiny-size-preview.png; combine both flags to
 * verify them. See main-icon.md. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas, GlobalFonts, loadImage, type Image } from "@napi-rs/canvas";
import pngToIco from "png-to-ico";

const ROOT = path.resolve(import.meta.dirname, "..");
const LIGHT = "#FFF9EE";
const DARK = "#242321";

/** Padding is a fraction of each edge, around the visible alpha bounds.
 * Install assets use an opaque square: operating systems supply their masks. */
export const BRAND_OUTPUTS = [
  { file: "spideryarn-logo.png", size: 256, source: "mark", padding: 0.025 },
  { file: "favicon-16x16.png", size: 16, source: "mark", padding: 0.025 },
  { file: "favicon-32x32.png", size: 32, source: "mark", padding: 0.025 },
  { file: "favicon-48x48.png", size: 48, source: "mark", padding: 0.025 },
  { file: "spideryarn-reader.png", size: 512, source: "reader", padding: 0.03 },
  { file: "apple-touch-icon.png", size: 180, source: "reader", padding: 0.12, background: LIGHT },
  { file: "android-chrome-192x192.png", size: 192, source: "reader", padding: 0.12, background: LIGHT },
  { file: "android-chrome-512x512.png", size: 512, source: "reader", padding: 0.12, background: LIGHT },
  { file: "app-icon-light-1024.png", size: 1024, source: "reader", padding: 0.12, background: LIGHT },
  { file: "app-icon-dark-1024.png", size: 1024, source: "reader", padding: 0.12, background: DARK },
] as const;

interface Bounds { x: number; y: number; width: number; height: number }
interface Source { image: Image; bounds: Bounds; hash: string }
interface RenderSpec { size: number; padding: number; background?: string }

async function source(file: string, detailed: boolean): Promise<Source> {
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
  if (detailed && (right - left < image.width * 0.4 || bottom - top < image.height * 0.4)) {
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
async function renderPreview(inputs: Record<"mark" | "reader", Source>, files: Map<string, Buffer>): Promise<Buffer> {
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
    ctx.fillText(`${label} - optical mark at actual display sizes`, left + 20, 30);
    for (const [index, size] of [16, 20, 32, 48].entries()) {
      const png = size === 20 ? mark : await proofImage(files, `favicon-${size}x${size}.png`);
      const x = left + 28 + index * 93;
      ctx.imageSmoothingEnabled = size === 20;
      ctx.drawImage(png, x, 58, size, size);
      ctx.fillText(`${size}px`, x, 132);
    }
    ctx.fillText("Detailed reader - same transparent master", left + 20, 180);
    ctx.imageSmoothingEnabled = true;
    for (const [index, size] of [144, 180].entries()) {
      const x = left + 20 + index * 180;
      ctx.drawImage(detail, x, 200, size, size);
      ctx.fillText(`${size}px`, x, 406);
    }
    ctx.fillText("180px install tile - opaque cream, 12% inset", left + 20, 458);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(install, left + 110, 478);
    ctx.fillText(`Mark SHA256 ${inputs.mark.hash}`, left + 20, 696);
    ctx.fillText(`Reader SHA256 ${inputs.reader.hash}`, left + 20, 720);
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

export interface GenerateBrandOptions {
  readerPath?: string;
  markPath?: string;
  outputDir?: string;
  check?: boolean;
  preview?: boolean;
  previewDir?: string;
}

async function staleFiles(destinations: Map<string, Buffer>): Promise<string[]> {
  const stale: string[] = [];
  for (const [file, expected] of destinations) {
    const label = path.basename(file);
    try {
      if (!expected.equals(await readFile(file))) stale.push(label);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      stale.push(label);
    }
  }
  return stale;
}

/** Exported so tests exercise the real pipeline against temporary destinations. */
export async function generateBrandAssets(options: GenerateBrandOptions = {}): Promise<string[]> {
  const inputs = {
    reader: await source(options.readerPath ?? path.join(ROOT, "assets/brand/source/reader.png"), true),
    mark: await source(options.markPath ?? path.join(ROOT, "assets/brand/source/mark.svg"), false),
  };
  const outputDir = options.outputDir ?? path.join(ROOT, "public");
  const files = new Map<string, Buffer>();
  for (const output of BRAND_OUTPUTS) files.set(output.file, render(inputs[output.source], output));
  const frames = [16, 32, 48].map((size) => {
    const frame = files.get(`favicon-${size}x${size}.png`);
    if (!frame) throw new Error(`Missing ICO frame ${size}`);
    return frame;
  });
  files.set("favicon.ico", await pngToIco(frames));
  // Proofs are review evidence, never served public-family members.
  const previewDir = options.previewDir ?? path.join(ROOT, "assets/brand");
  const destinations = new Map([...files].map(([file, bytes]) => [path.join(outputDir, file), bytes]));
  if (options.preview) {
    destinations.set(path.join(previewDir, "preview.png"), await renderPreview(inputs, files));
    destinations.set(path.join(previewDir, "tiny-size-preview.png"), await renderTinyPreview(files));
  }
  if (options.check) {
    const stale = await staleFiles(destinations);
    if (stale.length) throw new Error(`Brand assets missing or stale: ${stale.join(", ")}. Run npm run brand:generate${options.preview ? " -- --preview" : ""}.`);
  } else {
    await mkdir(outputDir, { recursive: true });
    if (options.preview) await mkdir(previewDir, { recursive: true });
    for (const [file, bytes] of destinations) await writeFile(file, bytes);
  }
  return [...files.keys()];
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check" && arg !== "--preview")) throw new Error("Usage: npm run brand:generate -- [--check] [--preview]");
  const check = args.includes("--check");
  const preview = args.includes("--preview");
  const files = await generateBrandAssets({ check, preview });
  console.log(`${check ? "Verified" : "Generated"} ${files.length} public brand assets${preview ? " and both assets/brand proof images" : ""}.`);
}
