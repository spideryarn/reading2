/**
 * **The screenshot is written by us, or it is not sent.** src/feedback-image.ts.
 *
 * The check this replaced was eight bytes of PNG signature, and GPT Sol's code
 * review, 2026-08-31, said what that was worth:
 *
 * > `PNG_SIGNATURE || articleProse` passes and is stored and forwarded. Valid
 * > PNG/JPEG containers can also carry arbitrary text metadata, EXIF, or
 * > appended bytes.
 *
 * So the property under test is not "it looks like a picture". It is that
 * **every byte of the output was produced here**: the file is taken apart, the
 * raster is decompressed and checked against the size the header says it is, and
 * a new file is written from it. Every test below puts a marker somewhere a PNG
 * can legally carry one and then looks for it in the output.
 *
 * `MARKER` is one string throughout, so a test that stops checking anything
 * still has to explain where it went.
 */
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  MAX_SCREENSHOT_EDGE,
  MAX_SCREENSHOT_PIXELS,
  reencodeScreenshot,
} from "../src/feedback-image.js";

const MARKER = "MY_SECRET_MANUSCRIPT";
const SIGNATURE = Buffer.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const CAP = 400_000;

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, payload: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), payload]);
  const out = Buffer.alloc(12 + payload.length);
  out.writeUInt32BE(payload.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + payload.length);
  return out;
}

/** A valid RGBA PNG of the given size, with `extra` chunks spliced before IEND. */
function png(
  width: number,
  height: number,
  options: { extra?: Buffer[]; after?: Buffer; depth?: number; colourType?: number } = {},
): Buffer {
  const channels = options.colourType === 0 ? 1 : 4;
  const raster = Buffer.alloc(height * (width * channels + 1));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = options.depth ?? 8;
  ihdr[9] = options.colourType ?? 6;
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    ...(options.extra ?? []),
    chunk("IDAT", deflateSync(raster)),
    chunk("IEND", Buffer.alloc(0)),
    options.after ?? Buffer.alloc(0),
  ]);
}

function accepted(bytes: Buffer): Buffer {
  const result = reencodeScreenshot(bytes, CAP);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return Buffer.from(result.screenshot.bytes);
}

describe("re-encoding a pasted screenshot", () => {
  it("takes an ordinary PNG and hands back a PNG", () => {
    const out = accepted(png(4, 4));
    expect(out.subarray(0, 8).equals(SIGNATURE)).toBe(true);
    expect(out.subarray(12, 16).toString()).toBe("IHDR");
    expect(out.subarray(out.length - 8, out.length - 4).toString()).toBe("IEND");
  });

  it("names the file and the type itself, whatever the caller wanted", () => {
    const result = reencodeScreenshot(png(2, 2), CAP);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.screenshot.filename).toBe("screenshot.png");
    expect(result.screenshot.contentType).toBe("image/png");
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
  });

  it("drops a tEXt chunk, which is where a well-formed file carries prose", () => {
    const text = chunk("tEXt", Buffer.from(`Comment\0${MARKER}`, "latin1"));
    const out = accepted(png(4, 4, { extra: [text] }));
    expect(out.includes(MARKER)).toBe(false);
  });

  it("drops an iTXt, a zTXt, an eXIf and a private chunk in one go", () => {
    const extra = [
      chunk("iTXt", Buffer.from(`Comment\0\0\0\0${MARKER}`, "latin1")),
      chunk("zTXt", Buffer.concat([Buffer.from("Comment\0\0"), deflateSync(Buffer.from(MARKER))])),
      chunk("eXIf", Buffer.from(MARKER)),
      chunk("spYa", Buffer.from(MARKER)),
    ];
    const out = accepted(png(4, 4, { extra }));
    expect(out.includes(MARKER)).toBe(false);
  });

  it("drops everything glued on after IEND", () => {
    /* The one that makes a magic-number check worthless: a decoder opens this
       happily and a forwarder sends all of it. */
    const out = accepted(png(4, 4, { after: Buffer.from(MARKER.repeat(50)) }));
    expect(out.includes(MARKER)).toBe(false);
  });

  it("refuses the signature followed by anything at all", () => {
    const prefixed = Buffer.concat([SIGNATURE, Buffer.from(MARKER.repeat(50))]);
    expect(reencodeScreenshot(prefixed, CAP)).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses a chunk whose CRC does not check out", () => {
    const bytes = png(4, 4);
    /* One byte of the IHDR payload, which the CRC four bytes later still
       describes. A stream whose own metadata does not agree with itself is not a
       stream to trust the pixels of. */
    bytes[20] = (bytes[20] ?? 0) ^ 0xff;
    expect(reencodeScreenshot(bytes, CAP)).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses a chunk length that runs off the end of the file", () => {
    const bytes = png(4, 4);
    bytes.writeUInt32BE(0x7fffffff, 8);
    expect(reencodeScreenshot(bytes, CAP)).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses image data that is not the size the header says it is", () => {
    /* **The check that turns IDAT from an opaque span into a raster.** The
       header says 4×4 RGBA — 4 × (16 + 1) = 68 bytes — and this deflates a
       marker instead. Without the equality, any spare capacity in IDAT is
       capacity for something that is not a picture. */
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(4, 0);
    ihdr.writeUInt32BE(4, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const bytes = Buffer.concat([
      SIGNATURE,
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(Buffer.from(MARKER.repeat(20)))),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    expect(reencodeScreenshot(bytes, CAP)).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses a scanline filter byte that is not a filter", () => {
    const width = 4;
    const height = 2;
    const raster = Buffer.alloc(height * (width * 4 + 1));
    raster[0] = 9;
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const bytes = Buffer.concat([
      SIGNATURE,
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raster)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    expect(reencodeScreenshot(bytes, CAP)).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses a JPEG, and every other format", () => {
    const jpeg = Buffer.concat([Buffer.of(0xff, 0xd8, 0xff, 0xe0), Buffer.from(MARKER)]);
    expect(reencodeScreenshot(jpeg, CAP)).toEqual({ ok: false, reason: "not-a-png" });
    const svg = Buffer.from(`<svg><text>${MARKER}</text></svg>`);
    expect(reencodeScreenshot(svg, CAP)).toEqual({ ok: false, reason: "not-a-png" });
    expect(reencodeScreenshot(Buffer.alloc(0), CAP)).toEqual({ ok: false, reason: "not-a-png" });
  });

  it("refuses a palette PNG, so no caller-supplied bytes are ever copied", () => {
    /* Colour type 3 would mean copying up to 768 bytes of palette verbatim, and
       a browser never produces one. Refusing it is what keeps "every output byte
       is ours" exactly true rather than nearly true. */
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(2, 4);
    ihdr[8] = 8;
    ihdr[9] = 3;
    const bytes = Buffer.concat([
      SIGNATURE,
      chunk("IHDR", ihdr),
      chunk("PLTE", Buffer.from(MARKER.slice(0, 6))),
      chunk("IDAT", deflateSync(Buffer.alloc(2 * (2 + 1)))),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    expect(reencodeScreenshot(bytes, CAP)).toEqual({ ok: false, reason: "malformed" });
  });

  it("takes a greyscale PNG, so the refusal above is about palettes and not about everything", () => {
    /* The positive control for the two tests before this one: without it, a
       `reencodeScreenshot` that refused every colour type would pass them both. */
    expect(reencodeScreenshot(png(4, 4, { colourType: 0 }), CAP).ok).toBe(true);
  });

  it("refuses a picture bigger than the caps that make the inflate safe", () => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(MAX_SCREENSHOT_EDGE + 1, 0);
    ihdr.writeUInt32BE(4, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const bytes = Buffer.concat([
      SIGNATURE,
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(Buffer.alloc(16))),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    expect(reencodeScreenshot(bytes, CAP)).toEqual({ ok: false, reason: "malformed" });
    expect(MAX_SCREENSHOT_PIXELS).toBeLessThan(MAX_SCREENSHOT_EDGE * MAX_SCREENSHOT_EDGE);
  });

  it("refuses a decompression bomb without inflating it", () => {
    /**
     * A 2×2 header over a megabyte of zeroes, which deflates to about a
     * kilobyte. `maxOutputLength` is derived from the header's own dimensions —
     * which are capped — so the inflate fails at 13 bytes rather than allocating
     * what the stream would like it to.
     */
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(2, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const bomb = deflateSync(Buffer.alloc(64 * 1024 * 1024), { level: 9 });
    const bytes = Buffer.concat([
      SIGNATURE,
      chunk("IHDR", ihdr),
      chunk("IDAT", bomb),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    const before = process.memoryUsage().heapTotal;
    expect(reencodeScreenshot(bytes, CAP)).toEqual({ ok: false, reason: "malformed" });
    /* Not a timing assertion — just that refusing it did not cost 64 MB. */
    expect(process.memoryUsage().heapTotal - before).toBeLessThan(32 * 1024 * 1024);
  });

  it("refuses a file past the cap before it looks at it", () => {
    expect(reencodeScreenshot(png(4, 4, { after: Buffer.alloc(CAP) }), CAP)).toEqual({
      ok: false,
      reason: "too-big",
    });
  });
});
