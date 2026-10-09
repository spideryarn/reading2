#!/usr/bin/env -S npx tsx
/**
 * `compress-screenshots` — run pngquant over the PNGs under `docs/`, in place.
 *
 * ```
 * npm run screenshots:compress -- a.png b.png   # these: a new screenshot, before you commit it
 * npm run screenshots:compress                  # every PNG under docs/ that git tracks
 * npm run screenshots:compress -- --check       # list the ones still to do; exit 1 if any. Changes nothing.
 * npm run screenshots:compress -- --best-effort a.png   # skip bad files; bounded batch for the hook
 * ```
 *
 * `--best-effort` is for `.claude/hooks/compress-commit-pngs.sh`, which runs this
 * on the PNGs a commit is about to carry and must never stop the commit.
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
 * hash of every chunk that affects rendering, so an edit to the pixels, header
 * or transparency means it is tried again. A
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
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, lstatSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The keyword and text of the chunk that marks "pngquant tried and could not shrink it". */
export const TRIED_KEYWORD = "spideryarn-compression";

/**
 * The pngquant line. In `--quality=85-98`, 85 is the floor below which it
 * refuses rather than degrade (exit 99) and 98 the target it stops at. At these
 * values the plan's sampled small light text and grey text on near-black were
 * indistinguishable on a 3x crop. This is lossy compression, not a guarantee
 * of identical text in every future screenshot; see the plan for measurements.
 * `--skip-if-larger` exits 98 instead of writing a bigger file. `--strip` drops
 * metadata a screenshot does not need.
 */
export const PNGQUANT_ARGS = ["--quality=85-98", "--skip-if-larger", "--strip", "--speed", "1", "--force"] as const;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Chunk = { readonly type: string; readonly start: number; readonly data: Buffer };

function validHeader(data: Buffer): boolean {
  if (data.length !== 13) return false;
  const width = data.readUInt32BE(0);
  const height = data.readUInt32BE(4);
  const depths: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  return width > 0 && height > 0 && width <= 0x7fffffff && height <= 0x7fffffff &&
    depths[data.readUInt8(9)]?.includes(data.readUInt8(8)) === true &&
    data.readUInt8(10) === 0 && data.readUInt8(11) === 0 && data.readUInt8(12) <= 1;
}

function validPalette(header: Buffer, length: number): boolean {
  const colour = header.readUInt8(9);
  return length > 0 && length % 3 === 0 && length <= 768 && colour !== 0 && colour !== 4 &&
    (colour !== 3 || length / 3 <= 2 ** header.readUInt8(8));
}

/** Validate chunk framing, checksums and the critical structure; this is not a pixel decoder. */
export function pngChunks(bytes: Buffer): Chunk[] | null {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) return null;
  const chunks: Chunk[] = [];
  let at = 8;
  let imageData = false;
  let imageDataEnded = false;
  let palette = false;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const end = at + 12 + length;
    if (length > 0x7fffffff || end > bytes.length) return null;
    const type = bytes.toString("latin1", at + 4, at + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(at + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) return null;
    const data = bytes.subarray(at + 8, end - 4);
    if (chunks.length === 0) {
      if (type !== "IHDR" || !validHeader(data)) return null;
    } else if (type === "IHDR") return null;
    if (type === "PLTE") {
      if (palette || imageData || !validPalette(chunks[0]!.data, length)) return null;
      palette = true;
    }
    if (type === "IDAT") {
      if (imageDataEnded || (chunks[0]!.data[9] === 3 && !palette)) return null;
      imageData = true;
    } else if (imageData) imageDataEnded = true;
    if (/^[A-Z]/.test(type) && !["IHDR", "PLTE", "IDAT", "IEND"].includes(type)) return null;
    chunks.push({ type, start: at, data });
    if (type === "IEND") return length === 0 && imageData && end === bytes.length ? chunks : null;
    at = end;
  }
  return null; // incomplete chunk or missing IEND
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
  const unsupported = unsupportedImage(chunks);
  if (unsupported !== null) return unsupported;
  const colourType = header.data[9];
  if (colourType === 3) return null;
  const mark = triedPayload(chunks);
  const texts = chunks.filter((chunk) => chunk.type === "tEXt");
  if (texts.some((chunk) => chunk.data.equals(mark))) return null;
  if (chunks.some(isOurMark)) {
    return "marked as tried on different pixels: it has been edited since, so try again";
  }
  return `colour type ${String(colourType)}, not a palette image, and not marked as tried`;
}

/** pngquant is for static browser screenshots, not animation or high-precision source images. */
function unsupportedImage(chunks: readonly Chunk[]): string | null {
  if (chunks.some((chunk) => ["acTL", "fcTL", "fdAT"].includes(chunk.type))) return "animated PNG: preserve its frames; do not run pngquant";
  if (chunks[0]!.data[8] === 16) return "16-bit PNG: preserve its precision; do not run pngquant";
  return null;
}

/** Chunks that do not change what the image looks like, so they stay out of the mark's hash. */
const NOT_RENDERED = new Set(["tEXt", "zTXt", "iTXt", "tIME", "IEND"]);

/**
 * `spideryarn-compression\0tried v2 sha256=<hash>`, the hash over the type and
 * data of every chunk that affects rendering (IHDR, PLTE, tRNS, gAMA, IDAT ...),
 * so an edit to the pixels, the header or the transparency voids the mark.
 */
function triedPayload(chunks: readonly Chunk[]): Buffer {
  const hash = createHash("sha256");
  for (const chunk of chunks) {
    if (NOT_RENDERED.has(chunk.type)) continue;
    hash.update(chunk.type, "latin1");
    hash.update(chunk.data);
  }
  return Buffer.from(`${TRIED_KEYWORD}\0tried v2 sha256=${hash.digest("hex")}`, "latin1");
}

function isOurMark(chunk: Chunk): boolean {
  return chunk.type === "tEXt" && chunk.data.toString("latin1").startsWith(`${TRIED_KEYWORD}\0`);
}

/** The same PNG with the "tried" chunk inserted just before IEND, replacing any older mark of ours. */
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
  // Everything before IEND, less any mark of ours, then the new mark, then IEND.
  const kept = chunks
    .filter((one) => one.type !== "IEND" && !isOurMark(one))
    .map((one) => bytes.subarray(one.start, one.start + 12 + one.data.length));
  return Buffer.concat([bytes.subarray(0, 8), ...kept, chunk, bytes.subarray(iend.start)]);
}

/** File-backed capture also works where synchronous pipe reads fail after the child ran. */
function runCaptured(command: string, args: string[], cwd?: string, timeout?: number) {
  const dir = mkdtempSync(path.join(tmpdir(), "screenshots-command-"));
  const stdout = path.join(dir, "stdout");
  const stderr = path.join(dir, "stderr");
  const out = openSync(stdout, "wx", 0o600);
  const err = openSync(stderr, "wx", 0o600);
  try {
    const ran = spawnSync(command, args, { cwd, stdio: ["ignore", out, err], timeout, killSignal: "SIGKILL" });
    if (ran.error !== undefined) throw ran.error;
    return { status: ran.status, signal: ran.signal, stdout: readFileSync(stdout, "utf8"), stderr: readFileSync(stderr, "utf8") };
  } finally {
    closeSync(out);
    closeSync(err);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Refuse named paths outside this checkout and symlinks, including in a parent directory. */
function screenshotFile(file: string, repo: string) {
  const relative = path.relative(path.resolve(repo), path.resolve(file));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`screenshot outside repo: ${file}`);
  const canonical = path.join(realpathSync(repo), relative);
  const stat = lstatSync(canonical);
  if (stat.isSymbolicLink() || realpathSync(canonical) !== canonical) throw new Error(`screenshot path is a symlink: ${file}`);
  if (!stat.isFile()) throw new Error(`screenshot is not a regular file: ${file}`);
  return { file: canonical, stat };
}

/** Every PNG under `docs/` that git tracks, including one added to the index and not committed yet. */
export function docsPngs(repo: string): string[] {
  const ran = runCaptured("git", ["ls-files", "-z", "--cached", "--", "docs/*.[pP][nN][gG]"], repo);
  if (ran.status !== 0) throw new Error(`git ls-files failed: ${ran.stderr.trim()}`);
  const listed = ran.stdout;
  // A file deleted on disk but still in the index is listed by --cached; it has nothing to compress.
  return [...new Set(listed.split("\0").filter((one) => one !== ""))].filter((one) => {
    try {
      screenshotFile(path.join(repo, one), repo);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  });
}

type Outcome = { readonly kind: "compressed"; readonly before: number; readonly after: number } | { readonly kind: "marked"; readonly why: string } | { readonly kind: "already" };

/** Compress one file in place, or mark it as tried. */
export function compressOne(file: string, pngquant = "pngquant", repo = REPO,
  options: { timeout?: number; onWritten?: (bytes: Buffer, source: Buffer) => void } = {}): Outcome {
  const source = screenshotFile(file, repo);
  file = source.file;
  const before = readFileSync(file);
  const chunks = pngChunks(before);
  if (chunks === null) throw new Error(`not a readable PNG: ${file}`);
  const unsupported = unsupportedImage(chunks);
  if (unsupported !== null) throw new Error(`${unsupported}: ${file}`);
  if (needsCompression(before) === null) return { kind: "already" };
  // A private directory beside the source keeps output on the same filesystem and
  // avoids collisions with peers or a pre-existing symlink at a predictable name.
  const temporaryDir = mkdtempSync(path.join(path.dirname(file), ".screenshots-"));
  const temporary = path.join(temporaryDir, "output.png");
  try {
    const ran = runCaptured(pngquant, [...PNGQUANT_ARGS, "--output", temporary, "--", file], undefined, options.timeout);
    let outcome: Outcome;
    if (ran.status === 0) {
      const after = readFileSync(temporary);
      const result = pngChunks(after);
      if (result === null || result[0]!.data[9] !== 3 || !result[0]!.data.subarray(0, 8).equals(chunks[0]!.data.subarray(0, 8))) {
        throw new Error("pngquant did not produce a palette PNG with the original dimensions");
      }
      outcome = { kind: "compressed", before: before.length, after: after.length };
    } else if (ran.status === 98 || ran.status === 99) {
      // Expected skips only: keep the original bytes and add the tried mark.
      writeFileSync(temporary, withTriedMark(before), { flag: "wx", mode: 0o600 });
      outcome = { kind: "marked", why: ran.status === 98 ? "would be larger" : "quality floor not met" };
    } else throw new Error(`pngquant exited ${String(ran.status)}${ran.signal ? ` (${ran.signal})` : ""}: ${ran.stderr.trim()}`);
    const current = screenshotFile(file, repo);
    if (current.stat.dev !== source.stat.dev || current.stat.ino !== source.stat.ino || !readFileSync(file).equals(before)) {
      throw new Error(`screenshot changed while compressing: ${file}`);
    }
    chmodSync(temporary, current.stat.mode & 0o777);
    const written = options.onWritten === undefined ? undefined : readFileSync(temporary);
    renameSync(temporary, file);
    if (written !== undefined) options.onWritten?.(written, before);
    return outcome;
  } finally {
    rmSync(temporaryDir, { recursive: true, force: true });
  }
}

export function main(argv: readonly string[]): number {
  let check = false;
  let bestEffort = false;
  let pathsOnly = false;
  const named: string[] = [];
  for (const arg of argv) {
    if (pathsOnly) named.push(arg);
    else if (arg === "--") pathsOnly = true;
    else if (arg === "--check") check = true;
    else if (arg === "--best-effort") bestEffort = true;
    else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else named.push(arg);
  }
  const files = named.length > 0 ? named.map((one) => path.resolve(one)) : docsPngs(REPO).map((one) => path.join(REPO, one));
  // Best effort: a file that cannot be checked or compressed is reported and left as it is.
  const attempt = <T>(file: string, run: () => T): T | undefined => {
    if (!bestEffort) return run();
    try {
      return run();
    } catch (error) {
      console.log(`skipped   ${path.relative(REPO, file)}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  };
  const todo = files.filter((file) => attempt(file, () => {
    screenshotFile(file, REPO);
    return needsCompression(readFileSync(file)) !== null;
  }) === true);
  if (check) {
    for (const file of todo) console.log(`${path.relative(REPO, file)}: ${String(needsCompression(readFileSync(file)))}`);
    console.log(todo.length === 0 ? "every PNG is compressed" : `${String(todo.length)} PNG(s) to compress: npm run screenshots:compress`);
    return todo.length === 0 ? 0 : 1;
  }
  let before = 0;
  let after = 0;
  const deadline = Date.now() + 20000; // inside the hook's own 24 s, inside the registration's 30 s
  for (const file of todo) {
    if (bestEffort && Date.now() >= deadline) break;
    const outcome = attempt(file, () => compressOne(file, "pngquant", REPO, bestEffort ? {
      timeout: Math.min(8000, Math.max(1, deadline - Date.now())),
      // The hook can re-stage these exact bytes without accidentally staging a peer edit.
      // Bind the source read above to the output we renamed, never to a later fresh read.
      onWritten: (bytes, source) => console.log(`compression-result ${JSON.stringify({
        file: path.relative(REPO, file),
        sourceSha256: createHash("sha256").update(source).digest("hex"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      })}`),
    } : {}));
    if (outcome === undefined) continue;
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
