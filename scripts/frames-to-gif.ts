#!/usr/bin/env -S npx tsx
/**
 * `frames-to-gif` — a folder of PNG frames in, one looping GIF out. For Help's
 * moving pictures (docs/project/help-page.md § Pictures).
 *
 * ```
 * npx tsx scripts/frames-to-gif.ts <frames-dir> <out.gif> [--delay 120] [--hold-first 800] [--hold-last 1600] [--colours 128]
 * ```
 *
 * The frames are every `*.png` in the folder, in name order (`0001.png`, …),
 * all the same size — Playwright screenshots of one clip, taken one after
 * another. Each shows for `--delay` ms; the first and last are held longer so
 * the loop has a moment of rest at each end. Consecutive identical frames are
 * merged into one longer frame, which is most of what keeps a UI GIF small.
 *
 * **One palette for the whole clip**, quantised from an even sample across
 * every distinct frame. A palette per frame lets the same grey come out a
 * shade different from one frame to the next, and the picture shimmers. The
 * sample is capped at one million pixels: forty 1344×780 RGBA frames are about
 * 160MB, and retaining them all plus one joined copy used to peak above 550MB.
 * A UI is a few flat colours, so 128 colours from that sample is ample.
 *
 * `gifenc` (MIT, no dependencies) writes the GIF; `@napi-rs/canvas`, already
 * a dependency for PDFs, decodes the PNGs. Plan
 * docs/plans/261007l-help-screenshots-and-gifs.md § GIFs names the options
 * passed over (ffmpeg, a looping `<video>`).
 */
import { readdirSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { createCanvas, Image } from "@napi-rs/canvas";
/* Its `dist/` is CommonJS built by esbuild, whose named exports Node's ESM
   loader cannot see, so the names come off the namespace object. */
import gifenc from "gifenc";

const { applyPalette, GIFEncoder, quantize } = gifenc;

interface Frame {
  file: string;
  delay: number;
}

/** Plenty for flat UI colours, without retaining a whole clip in memory. */
const MAX_PALETTE_PIXELS = 1_000_000;

/** Write synchronously: `console.error(); process.exit()` loses piped output. */
function fail(message: string, status = 1): never {
  writeSync(2, `${message}\n`);
  process.exit(status);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    delay: { type: "string", default: "120" },
    "hold-first": { type: "string", default: "800" },
    "hold-last": { type: "string", default: "1600" },
    colours: { type: "string", default: "128" },
  },
});

const [dir, out] = positionals;
if (dir === undefined || out === undefined || positionals.length !== 2) {
  fail("usage: npx tsx scripts/frames-to-gif.ts <frames-dir> <out.gif> [--delay ms] [--hold-first ms] [--hold-last ms] [--colours n]", 2);
}

function count(name: string, raw: string | undefined, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    fail(`--${name} must be a whole number from ${min} to ${max}, got ${raw}`, 2);
  }
  return n;
}
const delay = count("delay", values.delay, 20, 10_000);
const holdFirst = count("hold-first", values["hold-first"], 20, 10_000);
const holdLast = count("hold-last", values["hold-last"], 20, 10_000);
const colours = count("colours", values.colours, 2, 256);

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".png"))
  .sort();
if (files.length < 2) {
  fail(`${dir} holds ${files.length} PNG frame(s); a GIF needs at least two`);
}

const firstFile = files[0];
if (firstFile === undefined) throw new Error("the frame count check above allowed an empty folder");
/* Reuse one decoder. `loadImage` constructs a native Image for every call and
   their decoded bitmaps are only released when GC runs; forty large frames can
   otherwise accumulate hundreds of megabytes before that happens. */
const image = new Image();
async function decodeFrame(encoded: Uint8Array): Promise<Image> {
  image.src = encoded;
  await image.decode();
  return image;
}
const firstEncoded = readFileSync(path.join(dir, firstFile));
const firstImage = await decodeFrame(firstEncoded);
const { width, height } = firstImage;
const pixels = width * height;
const samplePixelsPerFrame = Math.max(1, Math.floor(MAX_PALETTE_PIXELS / files.length));
const sampleScale = Math.min(1, Math.sqrt(samplePixelsPerFrame / pixels));
const sampleWidth = Math.max(1, Math.floor(width * sampleScale));
const sampleHeight = Math.max(1, Math.floor(height * sampleScale));
const sampleCanvas = createCanvas(sampleWidth, sampleHeight);
const sampleCtx = sampleCanvas.getContext("2d");
/* Pick representative source pixels, rather than inventing blended colours. */
sampleCtx.imageSmoothingEnabled = false;
const sample = new Uint8Array(files.length * sampleWidth * sampleHeight * 4);
let sampleAt = 0;
let previous: Buffer | undefined;
const frames: Frame[] = [];
for (const [i, file] of files.entries()) {
  const encoded = i === 0 ? firstEncoded : readFileSync(path.join(dir, file));
  if (previous !== undefined && Buffer.compare(previous, encoded) === 0) {
    const prior = frames.at(-1);
    if (prior === undefined) throw new Error("an identical frame has no predecessor");
    prior.delay += delay;
    continue;
  }
  previous = encoded;
  const loaded = i === 0 ? firstImage : await decodeFrame(encoded);
  if (loaded.width !== width || loaded.height !== height) {
    fail(`${file} is ${loaded.width}×${loaded.height}; the first frame is ${width}×${height}. Every frame must be the same size.`);
  }
  frames.push({ file, delay });
  sampleCtx.drawImage(loaded, 0, 0, sampleWidth, sampleHeight);
  const rgba = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;
  sample.set(rgba, sampleAt);
  sampleAt += rgba.length;
}
const first = frames[0];
const last = frames.at(-1);
if (first === undefined || last === undefined || frames.length < 2) {
  fail("every frame is the same picture: nothing moves, so this wants to be a PNG");
}
first.delay = Math.max(first.delay, holdFirst);
last.delay = Math.max(last.delay, holdLast);

/* One bounded sample across every distinct frame, so colours stay stable. */
const palette = quantize(sample.subarray(0, sampleAt), colours);

const gif = GIFEncoder();
const canvas = createCanvas(width, height);
const ctx = canvas.getContext("2d");
for (const [i, f] of frames.entries()) {
  const loaded = await decodeFrame(readFileSync(path.join(dir, f.file)));
  ctx.drawImage(loaded, 0, 0);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  /* The first frame writes the one global palette and the infinite-loop
     extension. Later frames omit `palette`, or gifenc writes a redundant local
     copy beside every frame. */
  gif.writeFrame(applyPalette(rgba, palette), width, height, i === 0 ? { palette, delay: f.delay, repeat: 0 } : { delay: f.delay });
}
gif.finish();
const bytes = gif.bytes();
writeFileSync(out, bytes);
const seconds = frames.reduce((s, f) => s + f.delay, 0) / 1000;
console.log(`${out}: ${width}×${height}, ${frames.length} frames from ${files.length}, ${seconds.toFixed(1)}s a loop, ${Math.round(bytes.length / 1024)}KB`);
