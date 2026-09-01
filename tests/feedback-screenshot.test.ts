// @vitest-environment jsdom
/**
 * **The client half of a pasted screenshot, and whether it fits the server's.**
 *
 * src/web/feedback-screenshot.ts turns a `File` the reader pasted, dropped or
 * picked into the one thing `POST /api/feedback` will take: canonical base64 of
 * a PNG. docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md.
 *
 * jsdom rather than the default node environment (vitest.config.ts), because
 * the module under test is a `File` → `<canvas>` → `Blob` pass and
 * reimplementing `File`, `Blob` and `HTMLCanvasElement` here would be testing
 * the reimplementation. But **jsdom has none of the three APIs that do the
 * actual work** — `createImageBitmap` does not exist, `OffscreenCanvas` does
 * not exist, and `canvas.toBlob` needs the native `canvas` package to draw
 * anything — so those are stubbed below.
 *
 * ## The stub encodes a real PNG, and that is the point of it
 *
 * A stub that handed back `new Blob(["png"])` would let every test here pass
 * while the feature was completely broken, which is the shape of failure
 * docs/reusable/silent-success.md is about. So `pngBytes` below is a real PNG
 * encoder — signature, `IHDR`, a deflated raster with its filter bytes, `IEND`,
 * every CRC — and the stubbed `toBlob` encodes one **at whatever size the module
 * set the canvas to**. That makes two tests possible that are otherwise not:
 *
 * - the downscale assertions read the size off bytes the module produced,
 *   rather than off a variable the module was handed;
 * - `reencodeScreenshot` from src/feedback-image.ts — **the real server-side
 *   validator, not a copy of it** — is run on the base64 this module emits. That
 *   is the only test in this file that proves the two halves fit, and it would
 *   have caught a data-URL prefix, a JPEG, a wrong-endian anything, and the
 *   colour type the server refuses.
 */
import { deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SCREENSHOT_EDGE, reencodeScreenshot } from "../src/feedback-image.js";
import { MAX_FEEDBACK_SCREENSHOT_BYTES } from "../src/types.js";
import {
  SCREENSHOT_LONG_EDGE,
  imageFileFromDrop,
  imageFileFromPaste,
  screenshotFromFile,
} from "../src/web/feedback-screenshot.js";

/**
 * Canonical base64, padding rule included — **copied verbatim from `BASE64` in
 * src/routes.ts**, which is what `POST /api/feedback` tests the field against
 * before it decodes a single byte.
 *
 * A second copy on purpose, and the only honest kind: the point is to hold this
 * module's output to the expression the server actually uses, so importing a
 * shared constant would only prove the two agree with themselves. `src/routes.ts`
 * cannot be imported here anyway — it pulls the whole server behind it.
 */
const BASE64 = /^[A-Za-z0-9+/]*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/;

/* ------------------------------------------------------------ a real PNG -- */

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

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  new DataView(out.buffer).setUint32(8 + payload.length, crc32(out.subarray(4, 8 + payload.length)));
  return out;
}

/**
 * An 8-bit RGBA PNG of exactly these dimensions.
 *
 * The picture is coarse flat blocks rather than a gradient, and that is not
 * decoration: a per-pixel gradient defeats deflate (a 800×600 one comes out at
 * 413 KB) and every test here would then trip the size cap instead of measuring
 * what it meant to. Flat blocks are also what a screenshot of a UI actually
 * looks like to a compressor.
 *
 * `noise` is the opposite on purpose — random bytes, stored uncompressed, which
 * is how the "too big even after downscaling" case gets a genuinely oversized
 * file without waiting for deflate to fail on five megabytes.
 */
/* `Uint8Array<ArrayBuffer>` rather than plain `Uint8Array`: only the narrow
   form is a `BlobPart`, and the default type argument is `ArrayBufferLike`,
   which a `Blob` will not take. */
function pngBytes(width: number, height: number, noise = false): Uint8Array<ArrayBuffer> {
  const stride = width * 4 + 1;
  const raster = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raster[row] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const at = row + 1 + x * 4;
      raster[at] = noise ? (Math.random() * 256) | 0 : (x >> 7) << 5;
      raster[at + 1] = noise ? (Math.random() * 256) | 0 : (y >> 7) << 5;
      raster[at + 2] = noise ? (Math.random() * 256) | 0 : 0x40;
      raster[at + 3] = 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raster, { level: noise ? 0 : 9 }))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The dimensions an encoded PNG declares, read back out of `IHDR`. */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/* ------------------------------------------------- the three missing APIs -- */

/** What the stubbed decoder reports, or `null` to make it reject. */
let decodes: { width: number; height: number } | null = null;
/** The size `drawImage` was actually asked to paint at. */
let painted: { width: number; height: number } | null = null;
/** How many decoded bitmaps were closed — a raster held is a raster leaked. */
let closed = 0;
/** The MIME type the module asked the canvas to encode. */
let asked: string | null = null;
/** What the stubbed `toBlob` hands back for a canvas of this size. */
let encode: (width: number, height: number) => Blob | null = (width, height) =>
  new Blob([pngBytes(width, height)], { type: "image/png" });

const realGetContext = HTMLCanvasElement.prototype.getContext;
const realToBlob = HTMLCanvasElement.prototype.toBlob;

beforeEach(() => {
  decodes = null;
  painted = null;
  closed = 0;
  asked = null;
  encode = (width, height) => new Blob([pngBytes(width, height)], { type: "image/png" });

  /* `vi.fn` rather than a bare function, so "it never tried to decode this"
     is a question the not-an-image test can ask. */
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async (): Promise<ImageBitmap> => {
      if (!decodes) throw new Error("The source image could not be decoded.");
      return { ...decodes, close: () => void closed++ } as ImageBitmap;
    }),
  );
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    return {
      drawImage: (_image: unknown, _x: number, _y: number, width: number, height: number) => {
        painted = { width, height };
      },
    };
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toBlob = function (this: HTMLCanvasElement, callback, type) {
    /* Recorded rather than asserted here: an `expect` inside the callback would
       throw where the module catches, and a wrong MIME type would surface as
       "unreadable" instead of saying what went wrong. */
    asked = type ?? null;
    callback(encode(this.width, this.height));
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  HTMLCanvasElement.prototype.getContext = realGetContext;
  HTMLCanvasElement.prototype.toBlob = realToBlob;
});

function imageFile(name = "screenshot.png", type = "image/png"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

/** The `ok: true` half, or a failed assertion naming the problem instead. */
function shot(outcome: Awaited<ReturnType<typeof screenshotFromFile>>) {
  if (!outcome.ok) throw new Error(`expected a screenshot, got problem: ${outcome.problem}`);
  return outcome;
}

/* ------------------------------------------------------------------ tests -- */

describe("screenshotFromFile", () => {
  it("downscales a landscape screenshot to the long edge, keeping its shape", async () => {
    decodes = { width: 3200, height: 1800 };
    const out = shot(await screenshotFromFile(imageFile()));

    expect(out.width).toBe(SCREENSHOT_LONG_EDGE);
    expect(out.height).toBe(900);
    /* Off the bytes, not off the return value: the header is what the server
       will read, and the two agreeing is the thing worth checking. */
    expect(pngSize(Buffer.from(out.base64, "base64"))).toEqual({
      width: SCREENSHOT_LONG_EDGE,
      height: 900,
    });
    expect(painted).toEqual({ width: SCREENSHOT_LONG_EDGE, height: 900 });
    /* PNG, because the server refuses a JPEG outright — src/feedback-image.ts.
       And closed, because a decoded bitmap holds its whole raster. */
    expect(asked).toBe("image/png");
    expect(closed).toBe(1);
  });

  it("downscales a portrait screenshot on the other edge", async () => {
    decodes = { width: 1000, height: 2500 };
    const out = shot(await screenshotFromFile(imageFile()));

    expect(out.height).toBe(SCREENSHOT_LONG_EDGE);
    expect(out.width).toBe(640);
    expect(pngSize(Buffer.from(out.base64, "base64"))).toEqual({
      width: 640,
      height: SCREENSHOT_LONG_EDGE,
    });
  });

  it("never upscales a screenshot smaller than the cap", async () => {
    decodes = { width: 800, height: 600 };
    const out = shot(await screenshotFromFile(imageFile()));

    expect({ width: out.width, height: out.height }).toEqual({ width: 800, height: 600 });
    expect(painted).toEqual({ width: 800, height: 600 });
  });

  it("refuses something that is not an image without trying to decode it", async () => {
    const notes = new File(["what I expected to see"], "notes.txt", { type: "text/plain" });
    const out = await screenshotFromFile(notes);

    expect(out).toEqual({ ok: false, problem: "not-an-image" });
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("reports a decode failure rather than throwing", async () => {
    decodes = null; // the stubbed decoder rejects
    await expect(screenshotFromFile(imageFile())).resolves.toEqual({
      ok: false,
      problem: "unreadable",
    });
  });

  it("reports a canvas that hands back no blob rather than throwing", async () => {
    decodes = { width: 800, height: 600 };
    encode = () => null;
    await expect(screenshotFromFile(imageFile())).resolves.toEqual({
      ok: false,
      problem: "unreadable",
    });
  });

  it("reports too-big for a screenshot still over the cap after downscaling", async () => {
    decodes = { width: 3200, height: 1800 };
    encode = (width, height) => new Blob([pngBytes(width, height, true)], { type: "image/png" });
    const out = await screenshotFromFile(imageFile());

    expect(out).toEqual({ ok: false, problem: "too-big" });
  });

  it("emits base64 the server's own expression accepts", async () => {
    decodes = { width: 1234, height: 777 };
    const out = shot(await screenshotFromFile(imageFile()));

    expect(out.base64).toMatch(BASE64);
    expect(out.bytes).toBe(Buffer.from(out.base64, "base64").length);
    expect(out.bytes).toBeLessThanOrEqual(MAX_FEEDBACK_SCREENSHOT_BYTES);
  });

  /**
   * **The one that proves the two halves fit.** Everything above tests this
   * module against itself; this runs the real server-side validator — the one
   * `POST /api/feedback` calls — over the bytes this module produced.
   */
  it("survives the real server-side reencodeScreenshot", async () => {
    decodes = { width: 2400, height: 1500 };
    const out = shot(await screenshotFromFile(imageFile()));

    const result = reencodeScreenshot(
      new Uint8Array(Buffer.from(out.base64, "base64")),
      MAX_FEEDBACK_SCREENSHOT_BYTES,
    );
    if (!result.ok) throw new Error(`the server refused our own PNG: ${result.reason}`);
    expect({ width: result.width, height: result.height }).toEqual({
      width: out.width,
      height: out.height,
    });
    expect(result.screenshot.contentType).toBe("image/png");
  });

  /**
   * The client's long edge and the server's absolute one are two numbers in two
   * files, and only one of them can be imported into the browser bundle
   * (src/feedback-image.ts needs `node:zlib`). So the relationship is pinned
   * here instead — behaviourally, the way tests/feedback-payload.test.ts pins
   * the vocabularies it cannot import.
   */
  it("downscales to well inside the edge the server will accept", () => {
    expect(SCREENSHOT_LONG_EDGE).toBeLessThanOrEqual(MAX_SCREENSHOT_EDGE);
  });
});

describe("pulling an image off a paste or a drop", () => {
  function clipboard(items: unknown[], files: File[] = []): ClipboardEvent {
    return { clipboardData: { items, files } } as unknown as ClipboardEvent;
  }

  it("takes the image item out of a paste", () => {
    const file = imageFile();
    const event = clipboard([
      { kind: "string", type: "text/plain", getAsFile: () => null },
      { kind: "file", type: "image/png", getAsFile: () => file },
    ]);
    expect(imageFileFromPaste(event)).toBe(file);
  });

  /* The non-image item carries a real file on purpose. A paste from a document
     hands over a `text/html` item as well as the picture, and dragging a `.txt`
     in produces a file item with no picture in it at all — so an extractor that
     took the first item's file would find one here. */
  it("returns null when a paste carries a file that is not an image", () => {
    const text = new File(["what I expected to see"], "notes.txt", { type: "text/plain" });
    const event = clipboard([{ kind: "file", type: "text/plain", getAsFile: () => text }], [text]);
    expect(imageFileFromPaste(event)).toBeNull();
  });

  it("takes the image file out of a drop, and ignores anything else", () => {
    const file = imageFile();
    const text = new File(["x"], "notes.txt", { type: "text/plain" });
    const event = {
      dataTransfer: { items: [], files: [text, file] },
    } as unknown as DragEvent;
    expect(imageFileFromDrop(event)).toBe(file);
    expect(
      imageFileFromDrop({ dataTransfer: { items: [], files: [text] } } as unknown as DragEvent),
    ).toBeNull();
    expect(imageFileFromDrop({ dataTransfer: null } as unknown as DragEvent)).toBeNull();
  });
});
