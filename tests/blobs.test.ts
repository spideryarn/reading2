/**
 * The blob seam — src/store/blobs.ts and its filesystem adapter.
 *
 * Everything here is about the two properties an object store has that a naive
 * `writeFile` does not, because those are the two a bug would be invisible in:
 *
 *  - **create-only writes**, so `putIfAbsent` really is a compare-and-swap and
 *    the canonical key really is a statement about its contents;
 *  - **bytes back exactly as they went in**, which a store that round-trips
 *    through UTF-8 gets wrong while returning success.
 *
 * The Supabase adapter is not tested here and that is deliberate: it needs a
 * running container, and what it actually gets wrong — that Storage answers
 * HTTP 400 for both "missing" and "duplicate", with the real status in the body
 * — is checked by the end-to-end run rather than by a mock that would agree
 * with whatever this file believed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fsBlobs } from "../src/store/blobs-fs.js";
import { CONTENT_TYPE } from "../src/store/blobs.js";

const dirs: string[] = [];
async function store() {
  const dir = await mkdtemp(path.join(tmpdir(), "spya-blobs-"));
  dirs.push(dir);
  return { store: fsBlobs(dir), dir };
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/**
 * A NUL, a lone `0xFF`, and a byte that is a valid UTF-8 continuation on its
 * own. Every one of these survives a `Buffer` round trip and none survives a
 * `toString()` / `from()` one — which is exactly the mistake that corrupts a
 * PDF and reports success.
 */
const AWKWARD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff, 0xfe, 0x80, 0x0a]);

describe("the filesystem blob store", () => {
  it("gives back the bytes it was given, awkward ones included", async () => {
    const { store: blobs } = await store();
    await blobs.putIfAbsent("sha256/a.pdf", AWKWARD, CONTENT_TYPE.pdf);
    expect(await blobs.get("sha256/a.pdf")).toEqual(AWKWARD);
  });

  it("says nothing is there rather than throwing", async () => {
    const { store: blobs } = await store();
    expect(await blobs.head("sha256/missing.pdf")).toBeNull();
    expect(await blobs.get("sha256/missing.pdf")).toBeNull();
  });

  it("reports size and type without moving the bytes", async () => {
    const { store: blobs } = await store();
    await blobs.putIfAbsent("sha256/a.pdf", AWKWARD, CONTENT_TYPE.pdf);
    expect(await blobs.head("sha256/a.pdf")).toEqual({
      bytes: AWKWARD.byteLength,
      contentType: "application/pdf",
    });
  });

  /**
   * The property the whole content-addressing design rests on. A second write
   * to a canonical key must not be able to change what that name means — and
   * the answer has to be *`already-there`* rather than a throw, because a
   * second reader uploading the same paper is a success.
   */
  it("never overwrites, and says which happened", async () => {
    const { store: blobs } = await store();
    expect(await blobs.putIfAbsent("sha256/a.pdf", AWKWARD, CONTENT_TYPE.pdf)).toBe("stored");
    const second = new Uint8Array([1, 2, 3]);
    expect(await blobs.putIfAbsent("sha256/a.pdf", second, CONTENT_TYPE.pdf)).toBe("already-there");
    expect(await blobs.get("sha256/a.pdf")).toEqual(AWKWARD);
  });

  /**
   * **Refused, not truncated.** A prefix of a PDF is a corrupt PDF that hashes
   * to a real-looking number, so a `maxBytes` that trimmed would produce a
   * document we could verify and could not read.
   */
  it("refuses an object over the cap instead of returning part of it", async () => {
    const { store: blobs } = await store();
    await blobs.putIfAbsent("sha256/a.pdf", AWKWARD, CONTENT_TYPE.pdf);
    await expect(blobs.get("sha256/a.pdf", { maxBytes: 4 })).rejects.toThrow(/limit is 4/);
  });

  it("removes, and removing what is not there is not an error", async () => {
    const { store: blobs } = await store();
    await blobs.putIfAbsent("sha256/a.pdf", AWKWARD, CONTENT_TYPE.pdf);
    await blobs.remove("sha256/a.pdf");
    await blobs.remove("sha256/a.pdf");
    expect(await blobs.head("sha256/a.pdf")).toBeNull();
  });

  /**
   * Belt and braces over `stagingKey`/`canonicalKey`, which validate a UUID and
   * a hex hash and are the only two things that build a key today. This is the
   * function that turns a string into a path, so it is the one that has to be
   * sure the day a third caller appears.
   */
  it("refuses a key that would climb out of its directory", async () => {
    const { store: blobs } = await store();
    for (const key of ["../escape", "a/../../escape", "/etc/passwd", ""]) {
      await expect(blobs.head(key), key).rejects.toThrow(/Not a blob key/);
    }
  });

  /** A type note without its object is not an object. */
  it("does not mistake a stray type file for a stored blob", async () => {
    const { store: blobs, dir } = await store();
    await writeFile(path.join(dir, "orphan.pdf.type"), "application/pdf");
    expect(await blobs.head("orphan.pdf")).toBeNull();
  });
});
