/**
 * Every PNG under `docs/` is compressed, and the script that does it.
 * scripts/compress-screenshots.ts; the plan is
 * docs/plans/261007j-box-followups-tmp-age-overseer-unit-png-compression.md.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { compressOne, docsPngs, needsCompression, pngChunks, withTriedMark } from "../scripts/compress-screenshots.js";

const REPO = path.join(import.meta.dirname, "..");

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  typeAndData.copy(out, 4);
  out.writeUInt32BE(crc32(typeAndData), 8 + data.length);
  return out;
}

/** A truecolour PNG of `width` x `height`, filled by `pixel`. */
function truecolourPng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const hasPngquant = spawnSync("pngquant", ["--version"]).status === 0;
const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "compress-screenshots-"));
  scratch.push(dir);
  return dir;
}

describe("needsCompression", () => {
  it("refuses a truecolour PNG", () => {
    expect(needsCompression(truecolourPng(4, 4, () => [10, 20, 30]))).toMatch(/colour type 2/);
  });

  it("passes the same PNG once it carries the tried mark, and the mark keeps it a valid PNG", () => {
    const marked = withTriedMark(truecolourPng(4, 4, () => [10, 20, 30]));
    expect(needsCompression(marked)).toBeNull();
    expect(pngChunks(marked)?.map((one) => one.type)).toEqual(["IHDR", "IDAT", "tEXt", "IEND"]);
  });

  it("does not accept a mark carried over onto different pixels", () => {
    // An editor may keep text chunks while changing the image (PNG spec § 14).
    const marked = withTriedMark(truecolourPng(4, 4, () => [10, 20, 30]));
    const edited = truecolourPng(4, 4, () => [200, 20, 30]);
    const mark = pngChunks(marked)?.find((one) => one.type === "tEXt");
    expect(mark).toBeDefined();
    const iend = edited.length - 12;
    const carried = Buffer.concat([edited.subarray(0, iend), marked.subarray(mark!.start, mark!.start + 12 + mark!.data.length), edited.subarray(iend)]);
    expect(needsCompression(carried)).toMatch(/edited since/);
  });

  it("does not take some other text chunk for the mark", () => {
    const png = truecolourPng(4, 4, () => [10, 20, 30]);
    const iend = png.length - 12;
    const other = chunk("tEXt", Buffer.from("Software\0something", "latin1"));
    expect(needsCompression(Buffer.concat([png.subarray(0, iend), other, png.subarray(iend)]))).not.toBeNull();
  });

  it("reports a file that is not a PNG rather than passing it", () => {
    expect(needsCompression(Buffer.from("\xff\xd8\xff\xe0 a jpeg", "latin1"))).toBe("not a readable PNG");
  });
});

describe.skipIf(!hasPngquant)("compressOne", () => {
  it("quantises a screenshot-like image to a smaller palette PNG", () => {
    const file = path.join(tempDir(), "shot.png");
    // Flat colours with a little noise, like a UI: what pngquant is good at.
    writeFileSync(file, truecolourPng(200, 120, (x, y) => ((x >> 4) + (y >> 4)) % 2 === 0 ? [250, 250, 248] : [30, 30, (x * 7 + y) % 40]));
    const before = readFileSync(file).length;
    const outcome = compressOne(file);
    expect(outcome.kind).toBe("compressed");
    const after = readFileSync(file);
    expect(after.length).toBeLessThan(before);
    expect(needsCompression(after)).toBeNull();
    expect(after[25]).toBe(3);
  });

  it("marks a file it cannot shrink, and leaves its pixels alone", () => {
    const file = path.join(tempDir(), "tiny.png");
    // One pixel: the palette PNG is not smaller, so pngquant exits 98.
    const original = truecolourPng(1, 1, () => [1, 2, 3]);
    writeFileSync(file, original);
    expect(compressOne(file)).toEqual({ kind: "marked", why: "would be larger" });
    const after = readFileSync(file);
    expect(needsCompression(after)).toBeNull();
    expect(pngChunks(after)?.find((one) => one.type === "IDAT")?.data).toEqual(pngChunks(original)?.find((one) => one.type === "IDAT")?.data);
    expect(compressOne(file)).toEqual({ kind: "already" });
  });
});

describe("the PNGs under docs/", () => {
  it("are all compressed: run `npm run screenshots:compress` if this fails", () => {
    const offenders = docsPngs(REPO)
      .map((file) => ({ file, why: needsCompression(readFileSync(path.join(REPO, file))) }))
      .filter((one) => one.why !== null)
      .map((one) => `${one.file}: ${String(one.why)}`);
    expect(offenders, "uncompressed screenshots; `npm run screenshots:compress` fixes them in place").toEqual([]);
  });
});
