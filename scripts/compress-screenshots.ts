#!/usr/bin/env -S npx tsx
/**
 * `compress-screenshots` — run pngquant over the PNGs under `docs/`, in place.
 *
 * ```
 * npm run screenshots:compress -- a.png b.png   # these: a new screenshot, before you commit it
 * npm run screenshots:compress                  # every PNG under docs/ that git tracks
 * npm run screenshots:compress -- --check       # list the ones still to do; exit 1 if any. Changes nothing.
 * ```
 *
 * Greg, 2026-10-07, said yes to compressing screenshots
 * (docs/plans/261007j-box-followups-tmp-age-overseer-unit-png-compression.md).
 * A screenshot straight from a browser is a truecolour PNG; quantised to a
 * palette it is about 40% of the size and its text is indistinguishable, which
 * across about twenty checkouts on the box is gigabytes.
 *
 * **What makes a file "done"** is a property of its bytes, so there is no list
 * to go stale when `prune-old-screenshots.ts` deletes files: either it is a
 * palette image (colour type 3, which is what pngquant writes), or it carries a
 * `tEXt` chunk saying pngquant was tried and could not make it smaller, with a
 * hash of the image data it was tried on, so an edited image is tried again. A
 * tracked file that is neither is what `tests/screenshots-compressed.test.ts`
 * refuses. That test is the gate, and it is advisory rather than a guarantee:
 * it sees what is tracked when it runs, and a commit can still carry a file
 * changed after it.
 *
 * **Tracked files only, unless named.** The primary checkout holds other
 * agents' untracked screenshots, and rewriting those is not this script's
 * business. A new screenshot is compressed by naming it.
 *
 * Writes are atomic (a temporary file beside the original, then a rename), so a
 * peer reading the file never sees half of one. The script does not commit.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The keyword and text of the chunk that marks "pngquant tried and could not shrink it". */
export const TRIED_KEYWORD = "spideryarn-compression";

/**
 * The pngquant line. In `--quality=85-98`, 85 is the floor below which it
 * refuses rather than degrade (exit 99) and 98 the target it stops at. At these
 * values small light text, and grey text on near-black, are indistinguishable
 * from the original on a 3x crop, and the 787 screenshots under docs/ went from
 * 136 MB to 54 MB (2026-10-07; 70-95 gave 53 MB, not worth the lower floor).
 * `--skip-if-larger` exits 98 instead of writing a bigger file. `--strip` drops
 * metadata a screenshot does not need.
 */
export const PNGQUANT_ARGS = ["--quality=85-98", "--skip-if-larger", "--strip", "--speed", "1", "--force"] as const;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Chunk = { readonly type: string; readonly start: number; readonly data: Buffer };

/** The chunks of a PNG, or null if it is not one. Stops at the first chunk that runs past the end. */
export function pngChunks(bytes: Buffer): Chunk[] | null {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) return null;
  const chunks: Chunk[] = [];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const end = at + 12 + length;
    if (end > bytes.length) return null;
    chunks.push({ type: bytes.toString("latin1", at + 4, at + 8), start: at, data: bytes.subarray(at + 8, at + 8 + length) });
    at = end;
  }
  return chunks;
}

/**
 * Why a PNG still needs compressing, or null if it does not. A file that is
 * not a readable PNG is reported rather than passed: a `.png` that is really a
 * JPEG is still an uncompressed screenshot in every checkout.
 */
export function needsCompression(bytes: Buffer): string | null {
  const chunks = pngChunks(bytes);
  const header = chunks?.[0];
  if (chunks === null || header === undefined || header.type !== "IHDR" || header.data.length < 13) return "not a readable PNG";
  const colourType = header.data[9];
  if (colourType === 3) return null;
  const mark = triedPayload(chunks);
  const texts = chunks.filter((chunk) => chunk.type === "tEXt");
  if (texts.some((chunk) => chunk.data.equals(mark))) return null;
  if (texts.some((chunk) => chunk.data.toString("latin1").startsWith(`${TRIED_KEYWORD}\0`))) {
    return "marked as tried on different pixels: it has been edited since, so try again";
  }
  return `colour type ${String(colourType)}, not a palette image, and not marked as tried`;
}

/** `spideryarn-compression\0tried sha256=<hash of the image data>`: bound to the pixels, so an edit voids it. */
function triedPayload(chunks: readonly Chunk[]): Buffer {
  const hash = createHash("sha256");
  for (const chunk of chunks) if (chunk.type === "IDAT") hash.update(chunk.data);
  return Buffer.from(`${TRIED_KEYWORD}\0tried sha256=${hash.digest("hex")}`, "latin1");
}

/** The same PNG with the "tried" chunk inserted just before IEND. */
export function withTriedMark(bytes: Buffer): Buffer {
  const chunks = pngChunks(bytes);
  const iend = chunks?.find((chunk) => chunk.type === "IEND");
  if (chunks === null || iend === undefined) throw new Error("not a readable PNG, so it cannot be marked");
  const payload = triedPayload(chunks);
  const typeAndData = Buffer.concat([Buffer.from("tEXt", "latin1"), payload]);
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  typeAndData.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(typeAndData), 8 + payload.length);
  return Buffer.concat([bytes.subarray(0, iend.start), chunk, bytes.subarray(iend.start)]);
}

/** Every PNG under `docs/` that git tracks, including one added to the index and not committed yet. */
export function docsPngs(repo: string): string[] {
  const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--", "docs/*.png", "docs/*.PNG"], {
    cwd: repo,
    encoding: "utf8",
  });
  // A file deleted on disk but still in the index is listed by --cached; it has nothing to compress.
  return [...new Set(listed.split("\0").filter((one) => one !== ""))].filter((one) => {
    try {
      return statSync(path.join(repo, one)).isFile();
    } catch {
      return false;
    }
  });
}

type Outcome = { readonly kind: "compressed"; readonly before: number; readonly after: number } | { readonly kind: "marked"; readonly why: string } | { readonly kind: "already" };

/** Compress one file in place, or mark it as tried. */
export function compressOne(file: string, pngquant = "pngquant"): Outcome {
  const before = readFileSync(file);
  if (needsCompression(before) === null) return { kind: "already" };
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.compress-${String(process.pid)}.tmp`);
  try {
    const ran = spawnSync(pngquant, [...PNGQUANT_ARGS, "--output", temporary, "--", file], { encoding: "utf8" });
    if (ran.error !== undefined) throw ran.error;
    if (ran.status === 0) {
      const after = statSync(temporary).size;
      renameSync(temporary, file);
      return { kind: "compressed", before: before.length, after };
    }
    // 98: the result would be larger. 99: the quality floor could not be met.
    // Either way the original is the best version, so it is kept and marked.
    if (ran.status === 98 || ran.status === 99) {
      writeFileSync(temporary, withTriedMark(before));
      renameSync(temporary, file);
      return { kind: "marked", why: ran.status === 98 ? "would be larger" : "quality floor not met" };
    }
    throw new Error(`pngquant exited ${String(ran.status)}: ${ran.stderr.trim()}`);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function main(argv: readonly string[]): number {
  const check = argv.includes("--check");
  const named = argv.filter((one) => !one.startsWith("--"));
  const files = named.length > 0 ? named.map((one) => path.resolve(one)) : docsPngs(REPO).map((one) => path.join(REPO, one));
  const todo = files.filter((file) => needsCompression(readFileSync(file)) !== null);
  if (check) {
    for (const file of todo) console.log(`${path.relative(REPO, file)}: ${String(needsCompression(readFileSync(file)))}`);
    console.log(todo.length === 0 ? "every PNG is compressed" : `${String(todo.length)} PNG(s) to compress: npm run screenshots:compress`);
    return todo.length === 0 ? 0 : 1;
  }
  let before = 0;
  let after = 0;
  for (const file of todo) {
    const outcome = compressOne(file);
    const name = path.relative(REPO, file);
    if (outcome.kind === "compressed") {
      before += outcome.before;
      after += outcome.after;
      console.log(`compressed ${name}: ${String(outcome.before)} -> ${String(outcome.after)} bytes`);
    } else if (outcome.kind === "marked") console.log(`kept      ${name}: ${outcome.why}; marked as tried`);
  }
  console.log(`${String(todo.length)} of ${String(files.length)} needed it; ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB`);
  return 0;
}

if (process.argv[1]?.endsWith("compress-screenshots.ts") === true) {
  process.exitCode = main(process.argv.slice(2));
}
