/**
 * **An image's real size, from its own header** — shared by
 * tests/landing-assets.test.ts (the site's screenshots) and
 * tests/help-images.test.ts (Help's pictures), which make the same check for
 * the same reason.
 */
import { readFileSync } from "node:fs";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * An image's real width and height, from the file's own header.
 *
 * **JPEG as well as PNG, because the captures are JPEGs.** The browser tool
 * that takes these screenshots produces JPEG, and re-encoding one as a PNG
 * quadruples the bytes without recovering anything the JPEG already threw away.
 * A test that only understood PNG would therefore have quietly pushed the page
 * towards the larger file for the test's own convenience.
 *
 * PNG: eight bytes of signature, a chunk header, then width and height as
 * big-endian 32-bit integers at offsets 16 and 20.
 *
 * JPEG: a chain of marker segments. Walk it, and take the height and width out
 * of the first start-of-frame marker (0xC0–0xCF, excluding 0xC4, 0xC8 and 0xCC,
 * which are Huffman tables and arithmetic-coding conditioning rather than
 * frames). Anything else, skip by its own declared length.
 *
 * GIF, since 2026-10-07 for Help's moving pictures (src/web/help/help-images.ts):
 * `GIF87a` or `GIF89a`, then the logical screen's width and height as
 * little-endian 16-bit integers at offsets 6 and 8.
 *
 * The signature is checked first in every case: an HTML error page saved under
 * an image name would otherwise yield two plausible-looking numbers read out of
 * whatever bytes happened to sit at those offsets.
 */
export function imageSize(file: string): { width: number; height: number; bytes: number } {
  const buf = readFileSync(file);
  const bytes = buf.length;

  if (buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes };
  }

  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let at = 2;
    while (at + 9 < buf.length) {
      if (buf[at] !== 0xff) throw new Error(`${file} is a malformed JPEG`);
      const marker = buf[at + 1] as number;
      const length = buf.readUInt16BE(at + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) {
        return { height: buf.readUInt16BE(at + 5), width: buf.readUInt16BE(at + 7), bytes };
      }
      at += 2 + length;
    }
    throw new Error(`${file} is a JPEG with no start-of-frame marker`);
  }

  const head = buf.subarray(0, 6).toString("latin1");
  if (head === "GIF87a" || head === "GIF89a") {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), bytes };
  }

  throw new Error(`${file} is not a PNG, a JPEG or a GIF`);
}

/**
 * The encoded image blocks in a GIF, parsed by its block boundaries.
 *
 * A byte scan for `21 f9 04 … 2c` can count the same sequence inside compressed
 * pixels or an extension's payload as a frame. Walking the format also accepts
 * a valid frame without a graphic-control extension: the image descriptor,
 * not the optional timing block before it, is what makes a frame.
 */
export function gifFrameBlocks(bytes: Buffer): Buffer[] {
  const head = bytes.subarray(0, 6).toString("latin1");
  if ((head !== "GIF87a" && head !== "GIF89a") || bytes.length < 13) throw new Error("not a complete GIF header");

  let at = 13;
  const packed = bytes[10] as number;
  if ((packed & 0x80) !== 0) at += 3 * (1 << ((packed & 0x07) + 1));
  if (at > bytes.length) throw new Error("GIF ends inside its global colour table");

  const skipSubBlocks = () => {
    while (true) {
      const length = bytes[at];
      if (length === undefined) throw new Error("GIF ends inside a data block");
      at += 1;
      if (length === 0) return;
      at += length;
      if (at > bytes.length) throw new Error("GIF ends inside a data block");
    }
  };

  const frames: Buffer[] = [];
  while (at < bytes.length) {
    const marker = bytes[at++];
    if (marker === 0x3b) {
      if (at !== bytes.length) throw new Error("GIF has bytes after its trailer");
      return frames;
    }
    if (marker === 0x21) {
      if (bytes[at++] === undefined) throw new Error("GIF ends before an extension label");
      skipSubBlocks();
      continue;
    }
    if (marker !== 0x2c) throw new Error(`GIF has unknown block marker 0x${marker?.toString(16) ?? "??"}`);

    const start = at - 1;
    if (at + 9 > bytes.length) throw new Error("GIF ends inside an image descriptor");
    const imagePacked = bytes[at + 8] as number;
    at += 9;
    if ((imagePacked & 0x80) !== 0) at += 3 * (1 << ((imagePacked & 0x07) + 1));
    if (at >= bytes.length) throw new Error("GIF ends before its image data");
    at += 1; // LZW minimum code size
    skipSubBlocks();
    frames.push(bytes.subarray(start, at));
  }
  throw new Error("GIF has no trailer");
}
