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
 * The repair is a deliberate exception to "never delete", and a narrow one: an
 * object that does not hash to its own name is not a retained document, it is
 * corruption, and leaving it would poison every future article made of those
 * bytes. Retention protects documents, not wreckage.
 */
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { loadEnvLocal } from "../src/env.js";
import { blobStore, CONTENT_TYPE, storeRawSource } from "../src/store/blobs.js";
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

  it("repairs an object whose bytes do not hash to its own name", async () => {
    /* The crashed-write shape: something short and wrong sitting at a name that
       promises the full document. */
    await blobs.remove(key);
    await blobs.putIfAbsent(key, pdf("truncated"), CONTENT_TYPE.pdf);
    expect(sha((await blobs.get(key)) as Uint8Array)).not.toBe(digest);

    const result = await storeRawSource(good, "pdf");
    expect(result.outcome).toBe("repaired");

    /* The point of the whole exercise: what is at that name now is the document
       the name claims. Asserted by reading it back, not by trusting the return
       value — the return value is the thing under test. */
    const back = (await blobs.get(key)) as Uint8Array;
    expect(sha(back)).toBe(digest);
    expect(back.byteLength).toBe(good.byteLength);
  });

  it("never reports a mismatch as a plain dedup hit", async () => {
    /* The regression that matters. If `already-there` is ever returned for an
       object that does not verify, a caller writes `verified_at` over bytes it
       has not read — which is the exact failure this file exists to stop. */
    await blobs.remove(key);
    await blobs.putIfAbsent(key, pdf("wrong again"), CONTENT_TYPE.pdf);
    const result = await storeRawSource(good, "pdf");
    expect(result.outcome).not.toBe("already-there");
  });
});
