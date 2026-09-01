/**
 * **The screenshot, decoded and written again by us.**
 *
 * docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md. A reader
 * pastes a picture into the Feedback dialog; those bytes are stored in Postgres
 * and forwarded to Sentry as an envelope attachment. This file is what stands
 * between "a caller sent 400 KB" and "400 KB left the machine".
 *
 * ## Sniffing the first eight bytes was not validation
 *
 * The first version of this checked eight bytes of PNG signature or three of
 * JPEG and passed the rest through. GPT Sol's code review, 2026-08-31:
 *
 * > `PNG_SIGNATURE || articleProse` passes and is stored and forwarded. Valid
 * > PNG/JPEG containers can also carry arbitrary text metadata, EXIF, or
 * > appended bytes.
 *
 * All three are true, and the last is the one that makes a magic-number check
 * worthless on its own: **anything at all after `IEND` is still a file every
 * decoder opens**, so the field was a hole with a picture in front of it.
 *
 * ## So the output is built, not checked
 *
 * The same rule as everywhere else on this path — *build the payload, do not
 * clean it*. `reencodeScreenshot` walks the PNG chunk stream, keeps **only**
 * `IHDR` and `IDAT`, verifies every CRC, inflates the image data, checks that
 * what came out is exactly the size the header says a raster of those
 * dimensions is, checks every scanline's filter byte, and then **writes a new
 * PNG** from the raster.
 *
 * What that buys, stated precisely: after this runs, every byte that leaves is
 * either a constant, a number derived from the validated header, or a byte of
 * pixel data whose position in a raster of the stated size is known. There is
 * nowhere left to put a paragraph. Text metadata (`tEXt`, `iTXt`, `zTXt`),
 * `eXIf`, colour profiles, private chunks and anything after `IEND` are not
 * filtered out — they are simply never copied.
 *
 * ## JPEG is refused, and that is a change to the plan
 *
 * The plan expected PNG or JPEG. A JPEG cannot be given this treatment without
 * a baseline decoder: its entropy-coded scan cannot be length-checked, so
 * rebuilding the marker stream would still forward an opaque, caller-supplied
 * span — plain ASCII prose survives a `0xFF`-stuffing check untouched. Half a
 * guarantee at the one seam this whole file exists for is worse than a refusal,
 * because it reads like the whole one.
 *
 * **`@napi-rs/canvas` would decode both, and it is already a dependency.** It
 * was measured rather than assumed, 2026-09-01: naming it from anything the API
 * function reaches adds **34 MB** to the Vercel bundle (one Skia binary) and
 * turns `tests/pdf-bundle-trace.test.ts` red — that test lists
 * `@napi-rs/canvas/index.js` under `MUST_NOT_SHIP` precisely so that an import
 * cannot quietly do this. src/pdf.ts imports `geometry.js` **by name** for the
 * same reason. So the trade is: PNG only, no bundle growth, no native decode in
 * a request path. If a JPEG paste turns out to matter, the two ways forward are
 * a baseline decoder or accepting the 34 MB, and that is Greg's call rather
 * than one to make inside a bug fix.
 *
 * ## The bomb, and why the caps are the shape they are
 *
 * 400 KB of deflate can inflate to hundreds of megabytes. The dimension caps
 * are what stop that: they bound the raster, the raster bounds
 * `maxOutputLength` on the inflate, and the inflate therefore fails loudly
 * rather than eating the instance. That ordering is the whole defence — a cap
 * applied *after* inflating would be a cap applied after the damage.
 */
import { deflateSync, inflateSync } from "node:zlib";

/**
 * What a screenshot is stored and forwarded as — **our words and our bytes,
 * not the caller's**.
 *
 * `filename` and `contentType` are constants here. A client-supplied MIME type
 * or filename is never forwarded to Sentry and never stored: the schema has no
 * column for either, and the route has no field to put one in.
 */
export interface FeedbackScreenshot {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}

/**
 * Why a screenshot was refused. **A closed set**, because the route turns it
 * into a message and no part of the caller's bytes may reach one.
 */
export type ScreenshotRefusal = "not-a-png" | "too-big" | "malformed";

export type ScreenshotResult =
  | { ok: true; screenshot: FeedbackScreenshot; width: number; height: number }
  | { ok: false; reason: ScreenshotRefusal };

/**
 * The largest picture we will decode, per side and in total.
 *
 * The dialog downscales to 1600 on the long edge, so this is generous. It is
 * not a product preference: it is the bound that makes the inflate below safe,
 * because `MAX_SCREENSHOT_PIXELS × 4 + height` is the most memory one request
 * can ask for.
 */
export const MAX_SCREENSHOT_EDGE = 4096;
export const MAX_SCREENSHOT_PIXELS = 4_000_000;

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** Channels per pixel, by PNG colour type. `undefined` is a colour type we refuse. */
const CHANNELS: Record<number, number | undefined> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/**
 * Which bit depths each colour type allows, from the PNG specification's own
 * table. Written out rather than approximated, because "16-bit greyscale" and
 * "16-bit palette" differ and only the wrong one is a hole.
 *
 * **Colour type 3 (palette) is deliberately absent.** A palette is up to 768
 * bytes of caller-supplied data that this file would have to copy verbatim, and
 * a browser's `canvas.toBlob` never produces one. Refusing it keeps the promise
 * at the top of this file exactly true.
 */
const DEPTHS: Record<number, number[] | undefined> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  4: [8, 16],
  6: [8, 16],
};

/** The CRC-32 table PNG uses, built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function readU32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] as number) * 0x1000000 +
      ((bytes[at + 1] as number) << 16) +
      ((bytes[at + 2] as number) << 8) +
      (bytes[at + 3] as number)) >>>
    0
  );
}

function writeU32(into: Uint8Array, at: number, value: number): void {
  into[at] = (value >>> 24) & 0xff;
  into[at + 1] = (value >>> 16) & 0xff;
  into[at + 2] = (value >>> 8) & 0xff;
  into[at + 3] = value & 0xff;
}

/** One chunk, written with its own length, type, payload and CRC. */
function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + payload.length);
  writeU32(out, 0, payload.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  writeU32(out, 8 + payload.length, crc32(out.subarray(4, 8 + payload.length)));
  return out;
}

interface Header {
  width: number;
  height: number;
  depth: number;
  colourType: number;
}

/** `IHDR`, read and checked. `null` for anything this file will not carry. */
function readHeader(payload: Uint8Array): Header | null {
  if (payload.length !== 13) return null;
  const width = readU32(payload, 0);
  const height = readU32(payload, 4);
  const depth = payload[8] as number;
  const colourType = payload[9] as number;
  const compression = payload[10] as number;
  const filter = payload[11] as number;
  const interlace = payload[12] as number;
  if (width < 1 || height < 1) return null;
  if (width > MAX_SCREENSHOT_EDGE || height > MAX_SCREENSHOT_EDGE) return null;
  if (width * height > MAX_SCREENSHOT_PIXELS) return null;
  /* The only values the format defines. `interlace: 1` is Adam7, whose raster
     is seven sub-images with a different length rule — refused rather than
     supported, because nothing a browser produces is interlaced and a second
     length formula is a second place to be wrong. */
  if (compression !== 0 || filter !== 0 || interlace !== 0) return null;
  if (!DEPTHS[colourType]?.includes(depth)) return null;
  return { width, height, depth, colourType };
}

/** How many bytes the decompressed image data must be. Exactly, not at most. */
function rasterBytes(header: Header): number {
  const channels = CHANNELS[header.colourType] as number;
  const perRow = Math.ceil((header.width * channels * header.depth) / 8);
  /* One filter byte per scanline — the `+ 1` that is easy to forget and that
     makes the equality check below mean something. */
  return header.height * (perRow + 1);
}

/**
 * Walk the chunk stream, keeping **only** what a picture is made of.
 *
 * Split out of `reencodeScreenshot` below so that "what is in the file" and
 * "what we write" are two things that can be read separately — and because the
 * two together were one function of thirty-eight branches, which is a function
 * nobody audits twice.
 */
function chunks(
  bytes: Uint8Array,
  maxBytes: number,
): { header: Header; data: Uint8Array[] } | ScreenshotRefusal {
  let header: Header | null = null;
  const data: Uint8Array[] = [];
  let dataBytes = 0;
  let sawEnd = false;
  let at = PNG_SIGNATURE.length;

  while (at + 8 <= bytes.length && !sawEnd) {
    const read = readChunk(bytes, at);
    if (read === null) return "malformed";
    at = read.next;

    if (read.type === "IHDR") {
      if (header !== null) return "malformed";
      header = readHeader(read.payload);
      if (!header) return "malformed";
    } else if (read.type === "IDAT") {
      if (header === null) return "malformed";
      dataBytes += read.payload.length;
      if (dataBytes > maxBytes) return "too-big";
      data.push(read.payload);
    } else if (read.type === "IEND") {
      /* **And stop.** Everything after `IEND` is bytes a decoder ignores and a
         forwarder does not, which is the appended-payload hole. Not skipped —
         never read. */
      sawEnd = true;
    }
    /* Everything else — tEXt, iTXt, zTXt, eXIf, iCCP, pHYs, a private chunk
       nobody has heard of — falls through here and is never copied. */
  }

  if (!header || !sawEnd || data.length === 0) return "malformed";
  return { header, data };
}

/**
 * One chunk at `at`, or `null` if the stream does not agree with itself.
 *
 * Two refusals live here rather than in the loop above. A declared length that
 * overruns the buffer is the file saying it is not what it claims, refused
 * before it can be used as an index. And **every CRC is checked, including the
 * ones whose chunk is then thrown away** — a stream whose metadata does not
 * check out is not a stream to trust the pixels of.
 */
function readChunk(
  bytes: Uint8Array,
  at: number,
): { type: string; payload: Uint8Array; next: number } | null {
  const length = readU32(bytes, at);
  if (length > bytes.length || at + 12 + length > bytes.length) return null;
  if (crc32(bytes.subarray(at + 4, at + 8 + length)) !== readU32(bytes, at + 8 + length)) {
    return null;
  }
  return {
    type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)),
    payload: bytes.subarray(at + 8, at + 8 + length),
    next: at + 12 + length,
  };
}

/**
 * The raster, inflated and checked against the size the header says it is.
 *
 * `null` for anything that does not come out exactly right, which is the check
 * that turns `IDAT` from an opaque span into a picture: **any spare capacity in
 * it is capacity for something that is not one.**
 */
function raster(header: Header, data: Uint8Array[]): Buffer | null {
  const expected = rasterBytes(header);
  let out: Buffer;
  try {
    /* `maxOutputLength` is the bomb guard, and it is bounded by the dimension
       caps in `readHeader` rather than by anything the caller said. */
    out = inflateSync(Buffer.concat(data.map((part) => Buffer.from(part))), {
      maxOutputLength: expected,
    });
  } catch {
    return null;
  }
  if (out.length !== expected) return null;

  const perRow = expected / header.height - 1;
  for (let row = 0; row < header.height; row++) {
    /* None, Sub, Up, Average, Paeth. A sixth value is not a filter. */
    if ((out[row * (perRow + 1)] as number) > 4) return null;
  }
  return out;
}

/**
 * **Take a screenshot apart and write a new one.**
 *
 * Returns the bytes to store and forward, or a closed reason. Never throws:
 * `inflateSync` throws on a corrupt or oversized stream and that is a refusal,
 * not a failure of this process.
 */
export function reencodeScreenshot(bytes: Uint8Array, maxBytes: number): ScreenshotResult {
  if (bytes.length > maxBytes) return { ok: false, reason: "too-big" };
  if (bytes.length < PNG_SIGNATURE.length) return { ok: false, reason: "not-a-png" };
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return { ok: false, reason: "not-a-png" };
  }

  const parsed = chunks(bytes, maxBytes);
  if (typeof parsed === "string") return { ok: false, reason: parsed };
  const { header } = parsed;

  const pixels = raster(header, parsed.data);
  if (pixels === null) return { ok: false, reason: "malformed" };

  const ihdr = new Uint8Array(13);
  writeU32(ihdr, 0, header.width);
  writeU32(ihdr, 4, header.height);
  ihdr[8] = header.depth;
  ihdr[9] = header.colourType;
  /* 8, 9 and then 0, 0, 0 — deflate, adaptive filtering, no interlace. Written
     as constants, because they are the only values `readHeader` accepted. */
  const rebuilt = Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    Buffer.from(chunk("IHDR", ihdr)),
    Buffer.from(chunk("IDAT", deflateSync(pixels, { level: 9 }))),
    Buffer.from(chunk("IEND", new Uint8Array(0))),
  ]);
  /* Re-encoding can grow a file — a stream deflated harder than we deflate it
     comes back bigger. The cap is on what we store and forward, so it is
     applied to what we built rather than to what arrived. */
  if (rebuilt.length > maxBytes) return { ok: false, reason: "too-big" };

  return {
    ok: true,
    width: header.width,
    height: header.height,
    screenshot: {
      bytes: new Uint8Array(rebuilt),
      contentType: "image/png",
      filename: "screenshot.png",
    },
  };
}
