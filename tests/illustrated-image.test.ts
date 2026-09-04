/**
 * **Stage 3A — the bytes.** `storePlateImage` (src/illustrated-image.ts), and
 * the JPEG header walk it leans on (src/assets.ts § `imageDimensions`).
 *
 * The dimension tests run against the **real plates** in
 * `evals/results/illustrated-2026-09-03b/`, drawn by `openai/gpt-image-2` on
 * 2026-09-03, rather than against a JPEG this file synthesised. A synthetic
 * fixture only proves the walk agrees with the assumptions that built it; these
 * are the exact bytes the feature will be handed in production, APP segments
 * and all.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { imageDimensions } from "../src/assets.js";
import { storePlateImage } from "../src/illustrated-image.js";
import type { PutResult, RawSourceStore } from "../src/store/blobs.js";

const PLATES = fileURLToPath(
  new URL("../evals/results/illustrated-2026-09-03b/", import.meta.url),
);

async function realPlates(): Promise<{ name: string; bytes: Uint8Array }[]> {
  const names = (await readdir(PLATES)).filter((n) => n.endsWith(".jpeg")).sort();
  return Promise.all(
    names.map(async (name) => ({ name, bytes: new Uint8Array(await readFile(path.join(PLATES, name))) })),
  );
}

/** A store that records what it was asked to do and nothing else. */
function fakeStore(): RawSourceStore & { puts: { key: string; contentType: string; bytes: number }[] } {
  const puts: { key: string; contentType: string; bytes: number }[] = [];
  return {
    puts,
    async head() {
      return null;
    },
    async get() {
      return null;
    },
    async putIfAbsent(key, bytes, contentType): Promise<PutResult> {
      puts.push({ key, contentType, bytes: bytes.byteLength });
      return "stored";
    },
    async remove() {},
  };
}

describe("imageDimensions on the plates the illustrator actually drew", () => {
  it("finds the SOF in every one of them", async () => {
    const plates = await realPlates();
    /* A guard on the fixture itself: if somebody moves the results directory,
       an empty list would make every assertion below vacuously true. */
    expect(plates.length).toBeGreaterThan(0);
    for (const { name, bytes } of plates) {
      const size = imageDimensions(bytes);
      expect(size, name).not.toBeNull();
      /* `2:3` portrait at `low` measured 1024x1536 — the aspect is the part
         worth pinning, because a walk that landed on the wrong marker would
         return numbers, just not these. */
      expect(size?.width, name).toBeGreaterThan(0);
      expect(size?.height, name).toBeGreaterThan(size?.width ?? 0);
      expect((size?.height ?? 0) / (size?.width ?? 1), name).toBeCloseTo(1.5, 2);
    }
  });

  it("says nothing rather than guessing, for bytes that are not a picture", () => {
    expect(imageDimensions(new Uint8Array([0x00, 0x01, 0x02]))).toBeNull();
    expect(imageDimensions(new Uint8Array(0))).toBeNull();
  });

  it("does not run away on a JPEG that is all zero-length segments", () => {
    /* SOI, then `FF C0 00 00` repeated. A walk that advanced by the segment
       length alone would never move; this must terminate with `null`. */
    const bytes = new Uint8Array(2 + 4 * 200);
    bytes[0] = 0xff;
    bytes[1] = 0xd8;
    for (let i = 2; i < bytes.length; i += 4) {
      bytes[i] = 0xff;
      bytes[i + 1] = 0xc0;
    }
    expect(imageDimensions(bytes)).toBeNull();
  });

  it("does not read a Huffman table as a frame header", () => {
    /* `FF C4` is DHT and sits inside the C0–CF range. Give it a payload whose
       bytes would read as 0x4142 x 0x4344 if it were mistaken for a SOF, then
       a real SOF saying 8 x 16 after it. */
    const bytes = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xc4, 0x00, 0x07, 0x08, 0x41, 0x42, 0x43, 0x44, // DHT, 7-byte segment
      0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x08, 0x01, 0x00, 0x00, // SOF0 16 high, 8 wide
    ]);
    expect(imageDimensions(bytes)).toEqual({ width: 8, height: 16 });
  });
});

describe("storePlateImage", () => {
  it("stores a real plate under its own hash and reports its size", async () => {
    const [plate] = await realPlates();
    if (!plate) throw new Error("no plates in the results directory");
    const store = fakeStore();

    const image = await storePlateImage({ image: plate.bytes, mediaType: "image/jpeg" }, store);

    expect(image.ext).toBe("jpeg");
    expect(image.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(image.bytes).toBe(plate.bytes.byteLength);
    expect(image.height / image.width).toBeCloseTo(1.5, 2);
    /* The key is rebuilt from the hash, and the content type is the one the
       bucket's allowlist knows — both are promises about the bytes. */
    expect(store.puts).toEqual([
      { key: `sha256/${image.sha256}.jpeg`, contentType: "image/jpeg", bytes: plate.bytes.byteLength },
    ]);
  });

  /**
   * **The case this file was written to refuse, which has now happened.**
   *
   * It said: *"the real case is a future model quietly ignoring
   * `output_format`"*, and stored nothing. On 2026-09-04 that future arrived —
   * `google/gemini-3.1-flash-image` ignores the field and returns PNG whatever
   * it is asked. So a PNG is now stored, and stored **as a PNG**: the key ends
   * `.png`, the object's content type is `image/png`, and the record says
   * `png`. What has not changed is that no byte is written under a name that is
   * not true, which is the whole point of the check.
   */
  it("stores a PNG plate as a PNG, key and content type and record together", async () => {
    /* Signature plus an IHDR saying 848x1264 — the size a `1K` `2:3` plate
       actually comes back at. Synthetic rather than a real plate on purpose:
       what is under test is the branch, and the marker *walk* is tested above
       against the bytes a provider really sent. */
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 848);
    new DataView(png.buffer).setUint32(20, 1264);
    const store = fakeStore();

    const image = await storePlateImage({ image: png, mediaType: "image/png" }, store);

    expect(image).toMatchObject({ ext: "png", width: 848, height: 1264, bytes: 24 });
    expect(store.puts).toEqual([
      { key: `sha256/${image.sha256}.png`, contentType: "image/png", bytes: 24 },
    ]);
  });

  it("refuses a format that is neither, rather than storing bytes under a name that is not true", async () => {
    /* A GIF, which `sniffImage` knows and this file does not accept: `ext`
       reaches `canonicalKey` and the `Content-Type` header, so a third value
       would be a lookup miss or a lie about the bytes. */
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]);
    const store = fakeStore();
    await expect(storePlateImage({ image: gif, mediaType: "image/gif" }, store)).rejects.toThrow(
      /must be image\/jpeg or image\/png/,
    );
    expect(store.puts).toEqual([]);
  });

  it("refuses bytes with no stated type at all", async () => {
    const store = fakeStore();
    await expect(storePlateImage({ image: new Uint8Array([1, 2, 3]) }, store)).rejects.toThrow(
      /no stated type/,
    );
    expect(store.puts).toEqual([]);
  });

  it("refuses a plate whose header does not say what size it is", async () => {
    /* Claims to be a JPEG, and is one as far as the signature goes, but has no
       frame header. Storing it would put a record with zero dimensions in the
       artefact, which lays the band out wrong on every later read. */
    const store = fakeStore();
    const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
    await expect(
      storePlateImage({ image: truncated, mediaType: "image/jpeg" }, store),
    ).rejects.toThrow(/does not say what size it is/);
    expect(store.puts).toEqual([]);
  });

  it("is a no-op on the wire when the same plate is stored twice", async () => {
    /* The orphan policy leans on this: a re-run after a partial failure dedups
       onto the objects the first run paid for. `head` answering means the
       bytes never go over the wire again. */
    const [plate] = await realPlates();
    if (!plate) throw new Error("no plates in the results directory");
    const store = fakeStore();
    const first = await storePlateImage({ image: plate.bytes, mediaType: "image/jpeg" }, store);

    const seen = new Set(store.puts.map((p) => p.key));
    const dedup: RawSourceStore = {
      ...store,
      head: async (key) => (seen.has(key) ? { bytes: plate.bytes.byteLength, contentType: "image/jpeg" } : null),
      get: async () => plate.bytes,
    };
    const second = await storePlateImage({ image: plate.bytes, mediaType: "image/jpeg" }, dedup);

    expect(second).toEqual(first);
    expect(store.puts).toHaveLength(1);
  });
});
