/**
 * Stage 1 for an uploaded file — the `fetch` step's other half, in
 * src/pipeline.ts.
 *
 * This is where the checks that actually matter live, because it is the first
 * place that has the bytes. Everything before it — the picker, the cap at
 * `POST /api/uploads`, the bucket's MIME allowlist — is checking a **claim made
 * by whoever chose the file**. Here we look.
 *
 * The two refusals are deliberately tested in the way that can fail honestly:
 *
 *  - the magic-byte check gets a file of the right size with a plausible name,
 *    so nothing else could be refusing it;
 *  - the checksum check gets a **same-length** substitution, since a length
 *    check would otherwise catch it and this test would pass while the hash
 *    comparison was broken.
 *
 * And the first one is the whole design in one assertion: what this step writes
 * is the same `raw.json` a fetch writes, so stage 2 onwards cannot tell which
 * ran.
 */
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRaw } from "../src/fetch.js";
import { contextPaths, STEPS, stepLabel } from "../src/pipeline.js";
import { fsArtifacts } from "../src/store/artifacts-fs.js";
import { canonicalKey, stagingKey } from "../src/source.js";
import { blobStore, CONTENT_TYPE } from "../src/store/blobs.js";
import { claimUpload, forgetUpload, mintUpload, readUpload } from "../src/upload-records.js";

const blobs = blobStore();

const rubbish: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const undo of rubbish.splice(0)) await undo();
});

/** A minimal but real PDF header plus filler, so only the checks under test can refuse it. */
function aPdf(filler = "hello"): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.4\n${filler}\n%%EOF\n`);
}

const shaOf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * An upload that has been minted, claimed, and whose bytes are in the store —
 * exactly the state `POST /api/jobs { uploadId }` leaves behind.
 */
async function readyToVerify(bytes: Uint8Array, claimedSha?: string) {
  const minted = await mintUpload(
    {
      filename: "paper.pdf",
      bytes: bytes.byteLength,
      sha256: claimedSha ?? shaOf(bytes),
      /* Its own id, not the one upload-records.test.ts uses — tests/fixture-ids.test.ts
         enforces that, because vitest runs files in parallel against one database. */
      owner: "33333333-3333-4333-8333-333333333333",
    },
    async (key) => ({
      url: `https://x.test/${key}`,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }),
    stagingKey,
  );
  const id = minted.record.id;
  rubbish.push(() => forgetUpload(id));
  rubbish.push(() => blobs.remove(stagingKey(id)));
  await claimUpload(id);
  await blobs.putIfAbsent(stagingKey(id), bytes, CONTENT_TYPE.pdf);

  const slug = `test-upload-${id.slice(0, 8)}`;
  const { dir, htmlFile } = contextPaths(slug);
  rubbish.push(() => rm(dir, { recursive: true, force: true }));
  const ctx = {
    slug,
    dir,
    htmlFile,
    upload: { id, filename: "paper.pdf" },
    report: () => {},
    signal: new AbortController().signal,
    cacheArticle: false,
  };
  return { id, ctx, slug, dir };
}

describe("acquiring an uploaded file", () => {
  it("writes the same manifest a fetch writes, so stage 2 cannot tell the difference", async () => {
    const bytes = aPdf();
    const { id, ctx, dir } = await readyToVerify(bytes);
    rubbish.push(() => blobs.remove(canonicalKey(shaOf(bytes), "pdf")));

    await STEPS.fetch.run(ctx, fsArtifacts);

    const manifest = await readRaw(dir);
    expect(manifest?.kind).toBe("pdf");
    expect(manifest?.file).toBe("raw.pdf");
    expect(manifest?.origin).toBe("upload");
    expect(manifest?.uploadId).toBe(id);
    expect(manifest?.filename).toBe("paper.pdf");
    /* **No URL, and none invented.** A `file://` or an `upload://…` here would
       read as an address to everything downstream and nothing would complain. */
    expect(manifest?.url).toBeUndefined();
    expect(manifest?.requestedUrl).toBeUndefined();
    /* **The two fields that name the object in the bucket**, and this test was
       green without them for a day. `storeRawSource` was called, its digest
       discarded, and the manifest written without it — so every uploaded
       document reached the Postgres artefact store naming no object and was
       refused. "The same manifest a fetch writes" is the claim in this test's
       own name, and it was not checking the part of the manifest that had just
       become load-bearing. GPT Sol, 2026-08-28.

       Equal to `sha256` for a PDF, because the stored bytes are the fetched
       bytes; asserted against the bytes rather than against the other field, so
       that a path which set them from each other would still fail. */
    expect(manifest?.storedSha256).toBe(shaOf(bytes));
    expect(manifest?.storedBytes).toBe(bytes.byteLength);
    expect(new Uint8Array(await readFile(path.join(dir, "raw.pdf")))).toEqual(bytes);
  });

  /** The name is a claim about its contents, so promotion has to be create-only. */
  it("promotes the bytes to a key that is their own hash", async () => {
    const bytes = aPdf("promotion");
    const { ctx } = await readyToVerify(bytes);
    rubbish.push(() => blobs.remove(canonicalKey(shaOf(bytes), "pdf")));

    await STEPS.fetch.run(ctx, fsArtifacts);
    expect(await blobs.get(canonicalKey(shaOf(bytes), "pdf"))).toEqual(bytes);
  });

  /**
   * **The staging object survives.** Deleting it re-arms any grant still live
   * over its key — measured against the running stack — so a tidy-up inside the
   * two-hour TTL races the browser it is cleaning up after. This is the
   * assertion that stops somebody adding the obvious `remove` later.
   */
  /**
   * **A dedup hit is not proof the canonical object is right**, and this path
   * was the last one still assuming it was.
   *
   * The comment in `acquireUpload` used to end "the bytes at that key are these
   * bytes, by construction, because the key is their hash". Something can be at
   * a canonical name without anybody having deleted anything — a crashed write,
   * a bad backfill, anybody holding the service key — and believing the hit
   * marks this upload `verified` while the corrupt object stays put, to be
   * served to the reader as their own paper.
   *
   * `storeRawSource` had already been written to stop exactly this, and uploads
   * were still calling `putIfAbsent` directly, which is the failure a shared
   * helper is supposed to make impossible. GPT Sol found it reviewing the built
   * code, 2026-08-27.
   */
  it("refuses when something wrong is already sitting at the canonical name", async () => {
    const bytes = aPdf("the real paper");
    const key = canonicalKey(shaOf(bytes), "pdf");
    rubbish.push(() => blobs.remove(key));

    /* Squat on the name with something that is not this document. */
    await blobs.remove(key);
    await blobs.putIfAbsent(key, aPdf("not the real paper"), CONTENT_TYPE.pdf);

    const { ctx, id } = await readyToVerify(bytes);
    await expect(STEPS.fetch.run(ctx, fsArtifacts)).rejects.toThrow();

    /* The two halves that matter. The upload must NOT have been recorded as
       verified — that is the lie — and the squatter must still be there,
       because removing it races whoever put it there. */
    const record = await readUpload(id);
    expect(record?.status).not.toBe("verified");
    expect(await blobs.get(key)).not.toEqual(bytes);
  });

  it("leaves the staging object alone rather than tidying it up", async () => {
    const bytes = aPdf("staging stays");
    const { id, ctx } = await readyToVerify(bytes);
    rubbish.push(() => blobs.remove(canonicalKey(shaOf(bytes), "pdf")));

    await STEPS.fetch.run(ctx, fsArtifacts);
    expect(await blobs.head(stagingKey(id))).not.toBeNull();
  });

  it("refuses a file whose bytes are not a PDF, whatever it is called", async () => {
    const bytes = new TextEncoder().encode("PK this is a zip, honestly");
    const { id, ctx } = await readyToVerify(bytes);

    await expect(STEPS.fetch.run(ctx, fsArtifacts)).rejects.toThrow(/isn't a PDF inside/);
    expect((await readUpload(id))?.status).toBe("rejected");
    expect((await readUpload(id))?.reason).toBe("not-a-pdf");
  });

  /**
   * Same length, different bytes. A length check would catch a different
   * substitution and this test would pass while the hash comparison did
   * nothing at all.
   */
  it("refuses bytes that are not the ones the browser said it sent", async () => {
    const sent = aPdf("aaaaa");
    const arrived = aPdf("bbbbb");
    expect(arrived.byteLength).toBe(sent.byteLength);
    const { id, ctx } = await readyToVerify(arrived, shaOf(sent));

    await expect(STEPS.fetch.run(ctx, fsArtifacts)).rejects.toThrow(/isn't quite the file that was sent/);
    expect((await readUpload(id))?.reason).toBe("checksum-mismatch");
  });

  it("refuses an upload whose object never arrived", async () => {
    const bytes = aPdf("never sent");
    const { id, ctx } = await readyToVerify(bytes);
    await blobs.remove(stagingKey(id));

    await expect(STEPS.fetch.run(ctx, fsArtifacts)).rejects.toThrow(/never finished arriving/);
    expect((await readUpload(id))?.reason).toBe("missing");
  });

  /**
   * Retry, or `advanceJob` walking the list again. The work is idempotent; the
   * state machine is the thing that must not be asked to go backwards, and an
   * error about transitions here would hide whatever the reader actually needs
   * to know.
   */
  it("survives being run twice", async () => {
    const bytes = aPdf("twice");
    const { id, ctx } = await readyToVerify(bytes);
    rubbish.push(() => blobs.remove(canonicalKey(shaOf(bytes), "pdf")));

    await STEPS.fetch.run(ctx, fsArtifacts);
    await STEPS.fetch.run(ctx, fsArtifacts);
    expect((await readUpload(id))?.status).toBe("verified");
  });
});

/**
 * "Fetching the page" is a false statement about a file off the reader's own
 * disk — there is nothing to fetch and no page.
 */
describe("what the step calls itself", () => {
  it("does not claim to be fetching a page that does not exist", () => {
    expect(stepLabel("fetch", true)).toBe("Checking the file");
    expect(stepLabel("fetch", false)).toBe(STEPS.fetch.label);
    expect(stepLabel("toc", true)).toBe(STEPS.toc.label);
  });
});
