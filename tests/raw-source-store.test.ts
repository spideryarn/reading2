/**
 * **`already-there` is not verification**, which is the whole of this file.
 *
 * `putIfAbsent` is create-only and the key is the hash of the contents, so the
 * obvious reading is that a dedup hit proves the object is right. It does not.
 * Something can already be sitting at a canonical name without anybody having
 * deleted anything: a crashed write (`src/store/blobs-fs.ts` opened the
 * canonical name with `wx` and *then* wrote the bytes, so a process killed in
 * between left a short file at the right name), a failed backfill, or somebody
 * with the service key. `putIfAbsent` then answers `already-there` and, if we
 * believe it, we record a verified reference to bytes we have never read.
 *
 * Found by GPT Sol, asked whether "objects are never deleted" removes the need
 * for a state machine. It removes the state machine; it does not remove this.
 *
 * **It refuses rather than repairing**, which is a reversal of the first
 * version and the review of it was right. Repairing means remove-then-put, and
 * two callers who both read the same corruption race: the loser's `remove` can
 * delete the *winner's correct object* after the winner returned success and
 * its caller committed a reference. The fix for dangling references would have
 * created one. Refusing cannot destroy anything and leaves a human to decide.
 */
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { loadEnvLocal } from "../src/env.js";
import { blobStore, CONTENT_TYPE, CorruptObject, storeRawSource } from "../src/store/blobs.js";
import type { BlobHead, PutResult, RawSourceStore } from "../src/store/blobs.js";
import { canonicalKey } from "../src/source.js";

loadEnvLocal();

const blobs = blobStore();

/** A small but genuine PDF, so the bucket's MIME allowlist is satisfied. */
function pdf(marker: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.4\n% ${marker}\n1 0 obj\n<<>>\nendobj\n`);
}
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("storing a raw source", () => {
  const good = pdf("the real document");
  const digest = sha(good);
  const key = canonicalKey(digest, "pdf");

  beforeAll(async () => {
    await blobs.remove(key);
  });

  it("stores bytes that were not there, and says so", async () => {
    const result = await storeRawSource(good, "pdf");
    expect(result.sha256).toBe(digest);
    expect(result.key).toBe(key);
    expect(result.outcome).toBe("stored");
  });

  it("recognises the same document again without re-uploading it", async () => {
    const result = await storeRawSource(good, "pdf");
    expect(result.outcome).toBe("already-there");
    expect(result.sha256).toBe(digest);
  });

  it("refuses an object whose bytes do not hash to its own name", async () => {
    /* The crashed-write shape: something short and wrong sitting at a name that
       promises the full document. */
    await blobs.remove(key);
    await blobs.putIfAbsent(key, pdf("truncated"), CONTENT_TYPE.pdf);

    await expect(storeRawSource(good, "pdf")).rejects.toThrow(CorruptObject);
    /* Named, because the key is the only thing anybody can act on. */
    await expect(storeRawSource(good, "pdf")).rejects.toThrow(key);
  });

  it("leaves the wrong object exactly where it was", async () => {
    /* The point of refusing. A repair would remove it, and removing races any
       other writer — including one that has already succeeded and whose caller
       has committed a reference to it. */
    const wrong = pdf("wrong again");
    await blobs.remove(key);
    await blobs.putIfAbsent(key, wrong, CONTENT_TYPE.pdf);

    await expect(storeRawSource(good, "pdf")).rejects.toThrow(CorruptObject);

    const still = (await blobs.get(key)) as Uint8Array;
    expect(sha(still)).toBe(sha(wrong));
  });

  it("never reports a mismatch as a plain dedup hit", async () => {
    /* The regression that matters. If `already-there` is ever returned for an
       object that does not verify, a caller writes `verified_at` over bytes it
       has not read — the exact failure this file exists to stop. */
    await blobs.remove(key);
    await blobs.putIfAbsent(key, pdf("wrong once more"), CONTENT_TYPE.pdf);
    await expect(storeRawSource(good, "pdf")).rejects.toThrow();
  });

  it("tells corruption apart from any other failure", async () => {
    /* A caller has to be able to distinguish "try again" from "a human has to
       look", and an Error with a message cannot be branched on safely. */
    await blobs.remove(key);
    await blobs.putIfAbsent(key, pdf("nope"), CONTENT_TYPE.pdf);
    const err = await storeRawSource(good, "pdf").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CorruptObject);
    expect((err as CorruptObject).key).toBe(key);
    await blobs.remove(key);
  });
});

/**
 * **The bytes do not go up a second time**, which is a Kong bug wearing our
 * clothes.
 *
 * `storeRawSource` used to POST unconditionally and let the 409 tell it the
 * object was already there. Storage answers that 409 in ~20 ms *without reading
 * the body*, and the local stack's Kong — which has buffered a multi-megabyte
 * body to a temp file — hands that connection back to its keepalive pool with
 * the body unsent. The next request through it, any request, any key, waits out
 * `proxy_read_timeout`: 60 seconds, measured 178 times in 17 hours. The
 * diagnosis, with the probe that reproduced it, is
 * docs/plans/260902c-make-the-test-suite-pass-reliably.md § Cause 1.
 *
 * So the guarantee under test is a negative one: on a dedup hit there is **no
 * upload attempt at all**. The verification that made `already-there` mean
 * something — read back, re-hash, refuse a mismatch — has to survive it, so it
 * is asserted here too rather than assumed from the tests above.
 */
describe("a document that is already in the bucket", () => {
  const good = pdf("already up there");
  const digest = sha(good);
  const key = canonicalKey(digest, "pdf");

  /** A bucket in a Map that counts what was asked of it. */
  function spyBlobs(objects: Map<string, Uint8Array>) {
    const calls = { head: 0, get: 0, putIfAbsent: 0 };
    const store: RawSourceStore = {
      async head(k): Promise<BlobHead | null> {
        calls.head += 1;
        const there = objects.get(k);
        return there ? { bytes: there.byteLength, contentType: CONTENT_TYPE.pdf } : null;
      },
      async get(k): Promise<Uint8Array | null> {
        calls.get += 1;
        return objects.get(k) ?? null;
      },
      async putIfAbsent(k, bytes): Promise<PutResult> {
        calls.putIfAbsent += 1;
        if (objects.has(k)) return "already-there";
        objects.set(k, bytes);
        return "stored";
      },
      async remove(k) {
        objects.delete(k);
      },
    };
    return { store, calls };
  }

  it("never attempts the upload, and still reads the object back to verify it", async () => {
    const { store, calls } = spyBlobs(new Map([[key, good]]));

    const result = await storeRawSource(good, "pdf", store);

    expect(calls.putIfAbsent).toBe(0);
    expect(result.outcome).toBe("already-there");
    expect(result.sha256).toBe(digest);
    /* The read-back is the whole reason `already-there` is trustworthy — a fast
       path that skipped it would be the silent success this file exists to
       stop. */
    expect(calls.get).toBe(1);
  });

  it("still refuses wrong bytes sitting at the name, without uploading over them", async () => {
    const { store, calls } = spyBlobs(new Map([[key, pdf("an impostor")]]));

    await expect(storeRawSource(good, "pdf", store)).rejects.toThrow(CorruptObject);
    expect(calls.putIfAbsent).toBe(0);
  });

  it("uploads exactly as before when the object is not there", async () => {
    const objects = new Map<string, Uint8Array>();
    const { store, calls } = spyBlobs(objects);

    const result = await storeRawSource(good, "pdf", store);

    expect(result.outcome).toBe("stored");
    expect(calls.putIfAbsent).toBe(1);
    expect(objects.get(key)).toEqual(good);
    /* A create needs no read-back: we hashed the buffer we just wrote. */
    expect(calls.get).toBe(0);
  });

  it("throws CorruptObject when head says present and the object then vanishes", async () => {
    /* The race the head introduces has an answer already: `get` returns null
       and the mismatch branch throws. Nothing new is needed for it — this only
       makes sure nothing new was added. */
    const objects = new Map([[key, good]]);
    const { store } = spyBlobs(objects);
    const racing: RawSourceStore = {
      ...store,
      async get() {
        return null;
      },
    };

    await expect(storeRawSource(good, "pdf", racing)).rejects.toThrow(CorruptObject);
  });
});
