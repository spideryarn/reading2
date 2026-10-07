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
 * **One palette for the whole clip**, quantised from every frame together. A
 * palette per frame lets the same grey come out a shade different from one
 * frame to the next, and the picture shimmers. A UI is a few flat colours, so
 * 128 is usually plenty.
 *
 * `gifenc` (MIT, no dependencies) writes the GIF; `@napi-rs/canvas`, already
 * a dependency for PDFs, decodes the PNGs. Plan
 * docs/plans/261007l-help-screenshots-and-gifs.md § GIFs names the options
 * passed over (ffmpeg, a looping `<video>`).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { createCanvas, loadImage } from "@napi-rs/canvas";
/* Its `dist/` is CommonJS built by esbuild, whose named exports Node's ESM
   loader cannot see, so the names come off the namespace object. */
import gifenc from "gifenc";

const { applyPalette, GIFEncoder, quantize } = gifenc;

interface Frame {
  rgba: Uint8Array;
  delay: number;
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
  console.error("usage: npx tsx scripts/frames-to-gif.ts <frames-dir> <out.gif> [--delay ms] [--hold-first ms] [--hold-last ms] [--colours n]");
  process.exit(2);
}

function count(name: string, raw: string | undefined, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    console.error(`--${name} must be a whole number from ${min} to ${max}, got ${raw}`);
    process.exit(2);
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
  console.error(`${dir} holds ${files.length} PNG frame(s); a GIF needs at least two`);
  process.exit(1);
}

let width = 0;
let height = 0;
const frames: Frame[] = [];
for (const [i, file] of files.entries()) {
  const image = await loadImage(readFileSync(path.join(dir, file)));
  if (i === 0) ({ width, height } = image);
  if (image.width !== width || image.height !== height) {
    console.error(`${file} is ${image.width}×${image.height}; the first frame is ${width}×${height}. Every frame must be the same size.`);
    process.exit(1);
  }
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const rgba = new Uint8Array(ctx.getImageData(0, 0, width, height).data);
  const previous = frames.at(-1);
  if (previous !== undefined && Buffer.compare(previous.rgba, rgba) === 0) previous.delay += delay;
  else frames.push({ rgba, delay });
}
const first = frames[0];
const last = frames.at(-1);
if (first === undefined || last === undefined || frames.length < 2) {
  console.error("every frame is the same picture: nothing moves, so this wants to be a PNG");
  process.exit(1);
}
first.delay = Math.max(first.delay, holdFirst);
last.delay = Math.max(last.delay, holdLast);

/* One palette from every frame, so a colour is the same in all of them. */
const all = new Uint8Array(frames.reduce((n, f) => n + f.rgba.length, 0));
let at = 0;
for (const f of frames) {
  all.set(f.rgba, at);
  at += f.rgba.length;
}
const palette = quantize(all, colours);

const gif = GIFEncoder();
for (const [i, f] of frames.entries()) {
  /* `repeat: 0` on the first frame: loop for ever. */
  gif.writeFrame(applyPalette(f.rgba, palette), width, height, { palette, delay: f.delay, ...(i === 0 ? { repeat: 0 } : {}) });
}
gif.finish();
const bytes = gif.bytes();
writeFileSync(out, bytes);
const seconds = frames.reduce((s, f) => s + f.delay, 0) / 1000;
console.log(`${out}: ${width}×${height}, ${frames.length} frames from ${files.length}, ${seconds.toFixed(1)}s a loop, ${Math.round(bytes.length / 1024)}KB`);
