/**
 * The filesystem half of the blob seam — for tests, and for a laptop with no
 * Supabase container running.
 *
 * **It cannot mint an upload grant and does not pretend to.** `signUpload` is
 * not on `RawSourceStore` at all (src/store/blobs.ts says why), so there is no
 * method here to leave unimplemented and no shape that lies. An installation
 * running on this adapter simply cannot take uploads, and
 * `POST /api/uploads` says so in a sentence.
 *
 * What it does have to get right is the two things a real object store gives
 * you for free and a naive `writeFile` does not:
 *
 *  - **create-only writes**, so `putIfAbsent` is a compare-and-swap rather than
 *    a check followed by a write with a gap in between. `wx` is that, at the
 *    kernel; `existsSync` then `writeFile` is not.
 *  - **bytes back exactly as they went in.** Everything here is `Uint8Array`
 *    and nothing is ever decoded — a store that quietly round-trips through
 *    UTF-8 corrupts a PDF and returns success, which is why the round-trip test
 *    uses a NUL and a lone `0xFF`.
 */
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BlobHead, PutResult, RawSourceStore } from "./blobs.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Under `data/`, beside `data/_jobs/`, because it is the same kind of thing: local queue state. */
const DEFAULT_DIR = path.join(ROOT, "data", "_blobs");

function fileFor(dir: string, key: string): string {
  /* The keys this store is given are built by `stagingKey` and `canonicalKey`
     in src/source.ts, which validate a UUID and a hex hash respectively — so a
     traversal cannot arrive through the front door. Checked anyway, because
     this function is one refactor away from being handed a key from somewhere
     else, and the check costs nothing. */
  if (!/^[a-z0-9][a-z0-9/._-]*$/i.test(key) || key.includes("..")) {
    throw new Error(`Not a blob key: ${JSON.stringify(key)}`);
  }
  return path.join(dir, key);
}

const TYPE_FILE = (file: string) => `${file}.type`;

export function fsBlobs(dir: string = DEFAULT_DIR): RawSourceStore {
  return {
    async head(key): Promise<BlobHead | null> {
      const file = fileFor(dir, key);
      try {
        const info = await stat(file);
        const contentType = await readFile(TYPE_FILE(file), "utf8").catch(() => null);
        return { bytes: info.size, contentType };
      } catch (err) {
        /* Absent is `null`; everything else throws. A permission error read as
           "no such object" would tell a reader their upload never arrived. */
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },

    async get(key, options) {
      const file = fileFor(dir, key);
      let bytes: Buffer;
      try {
        bytes = await readFile(file, { signal: options?.signal });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
      const max = options?.maxBytes;
      if (max !== undefined && bytes.byteLength > max) {
        throw new Error(`That object is ${bytes.byteLength} bytes and the limit is ${max}.`);
      }
      return new Uint8Array(bytes);
    },

    async putIfAbsent(key, bytes, contentType): Promise<PutResult> {
      const file = fileFor(dir, key);
      await mkdir(path.dirname(file), { recursive: true });
      /* Written to a temp name and `link`ed into place would be the fully
         correct version; `wx` is enough here because a partial write can only
         happen inside this call, and the caller is holding the whole buffer. */
      try {
        await writeFile(file, bytes, { flag: "wx" });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") return "already-there";
        throw err;
      }
      /* After the bytes, and deliberately not create-only: the type is a note
         about an object that already exists, so a crash between the two leaves
         a readable object with an unknown type rather than no object at all. */
      await writeFile(TYPE_FILE(file), contentType, "utf8");
      return "stored";
    },

    async remove(key) {
      const file = fileFor(dir, key);
      await unlink(file).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") throw err;
      });
      await unlink(TYPE_FILE(file)).catch(() => undefined);
    },
  };
}

