/**
 * Every PNG under `docs/` is compressed, and the script that does it.
 * scripts/compress-screenshots.ts; the plan is
 * docs/plans/261007j-box-followups-tmp-age-overseer-unit-png-compression.md.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

import { compressOne, docsPngs, main, needsCompression, pngChunks, withTriedMark } from "../scripts/compress-screenshots.js";

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
function truecolourPng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number], bitDepth: 8 | 16 = 8): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = bitDepth;
  header[9] = 2; // truecolour
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3 * (bitDepth / 8));
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      if (bitDepth === 16) {
        row.writeUInt16BE(r * 257, 1 + x * 6);
        row.writeUInt16BE(g * 257, 3 + x * 6);
        row.writeUInt16BE(b * 257, 5 + x * 6);
      } else {
        row[1 + x * 3] = r;
        row[2 + x * 3] = g;
        row[3 + x * 3] = b;
      }
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

const pngquantVersion = spawnSync("pngquant", ["--version"], { stdio: "ignore" });
function pngquantMissing(version: Pick<ReturnType<typeof spawnSync>, "status" | "error">): boolean {
  return (version.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}
const hasPngquant = !pngquantMissing(pngquantVersion);
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

  it("does not accept a mark once transparency is added, with the pixels unchanged", () => {
    const marked = withTriedMark(truecolourPng(4, 4, () => [10, 20, 30]));
    const iend = marked.length - 12;
    const trns = chunk("tRNS", Buffer.from([0, 10, 0, 20, 0, 30]));
    expect(needsCompression(Buffer.concat([marked.subarray(0, 33), trns, marked.subarray(33, iend), marked.subarray(iend)]))).toMatch(/edited since/);
  });

  it("re-marking replaces the old mark rather than adding a second", () => {
    const twice = withTriedMark(withTriedMark(truecolourPng(4, 4, () => [10, 20, 30])));
    expect(pngChunks(twice)?.filter((one) => one.type === "tEXt")).toHaveLength(1);
    expect(needsCompression(twice)).toBeNull();
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

/** Rewrite a chunk with a fresh CRC: the defect is semantic, not a bad checksum. */
function replaceChunk(png: Buffer, type: string, data: Buffer): Buffer {
  const old = pngChunks(png)!.find((one) => one.type === type)!;
  return Buffer.concat([png.subarray(0, old.start), chunk(type, data), png.subarray(old.start + old.data.length + 12)]);
}

/** Two real 1x1 frames, with APNG controls in their required order. */
function animatedPng(): Buffer {
  const first = truecolourPng(1, 1, () => [1, 2, 3]);
  const second = truecolourPng(1, 1, () => [4, 5, 6]);
  const control = Buffer.alloc(8);
  control.writeUInt32BE(2, 0);
  const frame = (sequence: number) => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence, 0);
    data.writeUInt32BE(1, 4); // width
    data.writeUInt32BE(1, 8); // height
    data.writeUInt16BE(1, 20); // delay numerator
    data.writeUInt16BE(10, 22); // delay denominator
    return chunk("fcTL", data);
  };
  const sequence = Buffer.alloc(4);
  sequence.writeUInt32BE(2, 0);
  return Buffer.concat([
    first.subarray(0, 33), chunk("acTL", control), frame(0),
    first.subarray(33, first.length - 12), frame(1),
    chunk("fdAT", Buffer.concat([sequence, pngChunks(second)!.find((part) => part.type === "IDAT")!.data])),
    first.subarray(first.length - 12),
  ]);
}

function fakePngquant(dir: string, body: string): string {
  const file = path.join(dir, "pngquant-stub.cjs");
  writeFileSync(file, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  return file;
}

describe("PNG integrity", () => {
  const marked = withTriedMark(truecolourPng(4, 4, () => [10, 20, 30]));
  it.each([1, 4, 12])("rejects a marked PNG truncated by %i bytes", (n) => {
    expect(needsCompression(marked.subarray(0, marked.length - n))).not.toBeNull();
  });
  it("rejects a CRC mismatch and trailing bytes", () => {
    const corrupt = Buffer.from(marked);
    corrupt[29] = corrupt[29]! ^ 1; // IHDR checksum, while the old IDAT mark still matches
    expect(needsCompression(corrupt)).not.toBeNull();
    expect(needsCompression(Buffer.concat([marked, Buffer.from([0])]))).not.toBeNull();
  });
  it("rejects absent image data and an invalid palette header", () => {
    const png = truecolourPng(1, 1, () => [1, 2, 3]);
    const parts = pngChunks(png)!;
    const empty = Buffer.concat([png.subarray(0, 8), ...parts.filter((p) => p.type !== "IDAT").map((p) => chunk(p.type, p.data))]);
    expect(() => withTriedMark(empty)).toThrow(/readable PNG/);
    const header = Buffer.from(parts[0]!.data);
    header[9] = 3; // no PLTE
    expect(needsCompression(replaceChunk(png, "IHDR", header))).not.toBeNull();
  });
});

describe("compressOne safeguards (no pngquant dependency)", () => {
  it("preserves mode on an expected skip and uses a private temporary directory", () => {
    const dir = tempDir();
    const file = path.join(dir, "tiny.png");
    writeFileSync(file, truecolourPng(1, 1, () => [1, 2, 3]));
    chmodSync(file, 0o640);
    const collision = path.join(dir, `.tiny.png.compress-${process.pid}.tmp`);
    writeFileSync(collision, "peer's temporary data");
    const stub = fakePngquant(dir, "process.exit(98)");
    compressOne(file, stub, dir);
    expect(statSync(file).mode & 0o777).toBe(0o640);
    expect(readFileSync(collision, "utf8")).toBe("peer's temporary data");
    expect(readdirSync(dir).filter((one) => one.startsWith(".screenshots-"))).toEqual([]);
  });
  it.each([1, 2, 99])("handles exit %i without mistaking errors for expected skips", (status) => {
    const dir = tempDir();
    const file = path.join(dir, "tiny.png");
    const original = truecolourPng(1, 1, () => [1, 2, 3]);
    writeFileSync(file, original);
    const stub = fakePngquant(dir, `process.exit(${status})`);
    if (status === 99) expect(compressOne(file, stub, dir)).toEqual({ kind: "marked", why: "quality floor not met" });
    else {
      expect(() => compressOne(file, stub, dir)).toThrow(/pngquant exited/);
      expect(readFileSync(file)).toEqual(original);
    }
    expect(readdirSync(dir).filter((one) => one.startsWith(".screenshots-"))).toEqual([]);
  });
  it("rejects symlinks, symlinked parents and named files outside the repo", () => {
    const dir = tempDir();
    const outside = tempDir();
    const original = truecolourPng(1, 1, () => [1, 2, 3]);
    const target = path.join(outside, "target.png");
    writeFileSync(target, original);
    const stub = fakePngquant(dir, "process.exit(98)");
    const link = path.join(dir, "link.png");
    symlinkSync(target, link);
    symlinkSync(outside, path.join(dir, "linked-dir"));
    for (const file of [link, target, path.join(dir, "linked-dir", "target.png")]) {
      expect(() => compressOne(file, stub, dir)).toThrow(/symlink|outside/);
    }
    expect(readFileSync(target)).toEqual(original);
    expect(statSync(link).size).toBe(original.length);
  });
  it("does not replace the source on a bogus successful output", () => {
    const dir = tempDir();
    const file = path.join(dir, "tiny.png");
    const original = truecolourPng(1, 1, () => [1, 2, 3]);
    writeFileSync(file, original);
    const stub = fakePngquant(dir, 'require("node:fs").writeFileSync(process.argv[process.argv.indexOf("--output") + 1], "not a PNG");');
    expect(() => compressOne(file, stub, dir)).toThrow(/PNG/);
    expect(readFileSync(file)).toEqual(original);
  });
  it("does not flatten animation or reduce a 16-bit image", () => {
    const dir = tempDir();
    const file = path.join(dir, "special.png");
    const stub = fakePngquant(dir, 'process.exit(98)');
    for (const special of [animatedPng(), truecolourPng(1, 1, () => [1, 2, 3], 16)]) {
      writeFileSync(file, special);
      expect(() => compressOne(file, stub, dir)).toThrow(/animated|16-bit/);
      expect(readFileSync(file)).toEqual(special);
    }
  });
  it("does not overwrite a concurrent edit", () => {
    const dir = tempDir();
    const file = path.join(dir, "tiny.png");
    writeFileSync(file, truecolourPng(1, 1, () => [1, 2, 3]));
    const stub = fakePngquant(dir, 'require("node:fs").writeFileSync(process.argv.at(-1), "peer edit"); process.exit(98);');
    expect(() => compressOne(file, stub, dir)).toThrow(/changed/);
    expect(readFileSync(file, "utf8")).toBe("peer edit");
  });
});

describe("pngquant availability", () => {
  it("skips only a missing executable, not a broken installed one", () => {
    expect(pngquantMissing({ status: null, error: Object.assign(new Error("missing"), { code: "ENOENT" }) })).toBe(true);
    expect(pngquantMissing({ status: 1 })).toBe(false);
    expect(pngquantMissing({ status: null, error: Object.assign(new Error("denied"), { code: "EACCES" }) })).toBe(false);
  });
  it("rejects unknown CLI flags even alongside --check", () => {
    expect(() => main(["--check", "--chek"])).toThrow(/unknown option/);
  });
  it("--best-effort reports a file it cannot take and carries on, for the commit hook", () => {
    const outside = path.join(tempDir(), "outside.png");
    writeFileSync(outside, truecolourPng(1, 1, () => [1, 2, 3]));
    expect(() => main(["--", outside])).toThrow(/outside repo/);
    // Keep the valid second file in this checkout: an outside file is deliberately
    // refused, so two outside fixtures would prove only skipping, not continuation.
    const dir = mkdtempSync(path.join(REPO, "docs", ".compression-test-"));
    scratch.push(dir);
    const valid = path.join(dir, "valid.png");
    const original = truecolourPng(1, 1, () => [1, 2, 3]);
    writeFileSync(valid, original);
    const bin = tempDir();
    renameSync(fakePngquant(bin, "process.exit(98)"), path.join(bin, "pngquant"));
    const previousPath = process.env.PATH;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;
      expect(main(["--best-effort", "--", outside, valid])).toBe(0);
      expect(log.mock.calls.some(([line]) => String(line).startsWith("skipped "))).toBe(true);
      expect(needsCompression(readFileSync(valid))).toBeNull();
      expect(readFileSync(valid)).not.toEqual(original);
      const receiptLine = log.mock.calls.map(([line]) => String(line)).find((line) => line.startsWith("compression-result "));
      expect(receiptLine).toBeDefined();
      expect(JSON.parse(receiptLine!.slice("compression-result ".length))).toMatchObject({
        file: path.relative(REPO, valid), sha256: createHash("sha256").update(readFileSync(valid)).digest("hex"),
      });
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      log.mockRestore();
    }
  });
});

describe("docsPngs selection", () => {
  it("includes nested, mixed-case and unusual names, but excludes untracked and deleted files", () => {
    const dir = tempDir();
    execFileSync("git", ["init", "--quiet", dir], { stdio: "ignore" });
    mkdirSync(path.join(dir, "docs", "nested"), { recursive: true });
    const names = ["docs/a.png", "docs/nested/b.PNG", "docs/mixed.PnG", "docs/space name.png", "docs/new\nline.png", "docs/deleted.png"];
    for (const name of names) writeFileSync(path.join(dir, name), "fixture");
    execFileSync("git", ["add", "--", ...names], { cwd: dir, stdio: "ignore" });
    rmSync(path.join(dir, "docs/deleted.png"));
    writeFileSync(path.join(dir, "docs/untracked.png"), "peer screenshot");
    // On a case-insensitive filesystem DOCS is already docs, so no second directory can exist.
    if (!existsSync(path.join(dir, "DOCS"))) {
      mkdirSync(path.join(dir, "DOCS"));
      writeFileSync(path.join(dir, "DOCS/outside.png"), "outside scope");
      execFileSync("git", ["add", "--", "DOCS/outside.png"], { cwd: dir, stdio: "ignore" });
    }
    expect(docsPngs(dir).sort()).toEqual(names.filter((name) => name !== "docs/deleted.png").sort());
  });
  it.each(["../outside.png", "../missing.png"])("reports tracked symlink %s instead of following or skipping it", (target) => {
    const dir = tempDir();
    execFileSync("git", ["init", "--quiet", dir], { stdio: "ignore" });
    mkdirSync(path.join(dir, "docs"));
    writeFileSync(path.join(dir, "outside.png"), "fixture");
    symlinkSync(target, path.join(dir, "docs/link.png"));
    execFileSync("git", ["add", "--", "docs/link.png"], { cwd: dir, stdio: "ignore" });
    expect(() => docsPngs(dir)).toThrow(/symlink/);
  });
});

describe.skipIf(!hasPngquant)("compressOne", () => {
  it("can run the installed pngquant", () => {
    expect(pngquantVersion.error).toBeUndefined();
    expect(pngquantVersion.status).toBe(0);
  });
  it("quantises a screenshot-like image to a smaller palette PNG", () => {
    const file = path.join(tempDir(), "shot.png");
    // Flat colours with a little noise, like a UI: what pngquant is good at.
    writeFileSync(file, truecolourPng(200, 120, (x, y) => ((x >> 4) + (y >> 4)) % 2 === 0 ? [250, 250, 248] : [30, 30, (x * 7 + y) % 40]));
    const before = readFileSync(file).length;
    const outcome = compressOne(file, "pngquant", path.dirname(file));
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
    expect(compressOne(file, "pngquant", path.dirname(file))).toEqual({ kind: "marked", why: "would be larger" });
    const after = readFileSync(file);
    expect(needsCompression(after)).toBeNull();
    expect(pngChunks(after)?.find((one) => one.type === "IDAT")?.data).toEqual(pngChunks(original)?.find((one) => one.type === "IDAT")?.data);
    expect(compressOne(file, "pngquant", path.dirname(file))).toEqual({ kind: "already" });
  });
});

describe("screenshot guidance", () => {
  it("states that the shared screenshot gate is advisory and compression is lossy", () => {
    const doc = readFileSync(path.join(REPO, "docs/project/browser-control.md"), "utf8");
    const start = doc.indexOf("**A screenshot you keep under `docs/`");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(start).toBeLessThan(doc.indexOf("## On the laptop"));
    const guidance = doc.slice(start, doc.indexOf("\n##", start));
    expect(guidance).toMatch(/advisory/);
    expect(guidance).toMatch(/lossy/);
    expect(guidance).toMatch(/tracked/);
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
