/** One source family, one explicit output table. All images are rendered and
 * validated before any destination is touched. Run `npm run brand:generate`;
 * `--check` verifies committed bytes without writing. `--preview` includes
 * assets/brand/preview.png; combine both flags to verify it. See design-logo.md. */
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

/** Uses the actual generated favicon/install pixels, and the same render
 * specifications for the two app display sizes. The pinned font avoids a
 * system-font fallback changing the proof image between machines. */
async function renderPreview(inputs: Record<"mark" | "reader", Source>, files: Map<string, Buffer>): Promise<Buffer> {
  const font = path.join(ROOT, "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2");
  if (!GlobalFonts.registerFromPath(font, "SpideryarnBrandPreview")) throw new Error(`Cannot load preview font: ${font}`);
  const canvas = createCanvas(800, 740);
  const ctx = canvas.getContext("2d");
  const detail = BRAND_OUTPUTS.find((output) => output.file === "spideryarn-reader.png");
  const mark = BRAND_OUTPUTS.find((output) => output.file === "spideryarn-logo.png");
  const install = files.get("apple-touch-icon.png");
  if (!detail || !mark || !install) throw new Error("Missing preview source outputs");
  ctx.font = "15px SpideryarnBrandPreview";
  for (const [left, background, foreground, label] of [
    [0, LIGHT, DARK, "Light"], [400, DARK, LIGHT, "Dark"],
  ] as const) {
    ctx.fillStyle = background;
    ctx.fillRect(left, 0, 400, 740);
    ctx.fillStyle = foreground;
    ctx.fillText(`${label} - optical mark at actual display sizes`, left + 20, 30);
    for (const [index, size] of [16, 20, 32, 48].entries()) {
      const png = size === 20 ? render(inputs.mark, { ...mark, size }) : files.get(`favicon-${size}x${size}.png`);
      if (!png) throw new Error(`Missing preview favicon ${size}`);
      const x = left + 28 + index * 93;
      ctx.drawImage(await loadImage(png), x, 58);
      ctx.fillText(`${size}px`, x, 132);
    }
    ctx.fillText("Detailed reader - same transparent master", left + 20, 180);
    for (const [index, size] of [144, 180].entries()) {
      const x = left + 20 + index * 180;
      ctx.drawImage(await loadImage(render(inputs.reader, { ...detail, size })), x, 200);
      ctx.fillText(`${size}px`, x, 406);
    }
    ctx.fillText("180px install tile - opaque cream, 12% inset", left + 20, 458);
    ctx.drawImage(await loadImage(install), left + 110, 478);
    ctx.fillText(`Mark SHA256 ${inputs.mark.hash}`, left + 20, 696);
    ctx.fillText(`Reader SHA256 ${inputs.reader.hash}`, left + 20, 720);
  }
  return canvas.toBuffer("image/png");
}

export interface GenerateBrandOptions {
  readerPath?: string;
  markPath?: string;
  outputDir?: string;
  check?: boolean;
  preview?: boolean;
}

async function staleFiles(destinations: Map<string, Buffer>, previewPath: string): Promise<string[]> {
  const stale: string[] = [];
  for (const [file, expected] of destinations) {
    const label = file === previewPath ? "assets/brand/preview.png" : path.basename(file);
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
  // The contact sheet is review evidence, never a served public-family member.
  const previewPath = path.join(ROOT, "assets/brand/preview.png");
  const destinations = new Map([...files].map(([file, bytes]) => [path.join(outputDir, file), bytes]));
  if (options.preview) destinations.set(previewPath, await renderPreview(inputs, files));
  if (options.check) {
    const stale = await staleFiles(destinations, previewPath);
    if (stale.length) throw new Error(`Brand assets missing or stale: ${stale.join(", ")}. Run npm run brand:generate${options.preview ? " -- --preview" : ""}.`);
  } else {
    await mkdir(outputDir, { recursive: true });
    if (options.preview) await mkdir(path.dirname(previewPath), { recursive: true });
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
  console.log(`${check ? "Verified" : "Generated"} ${files.length} public brand assets${preview ? " and assets/brand/preview.png" : ""}.`);
}
