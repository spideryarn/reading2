/**
 * **The page cap is stage 1's refusal, not stage 2's.**
 *
 * Until 2026-09-04 a PDF over `MAX_PAGES` was accepted by `fetch` — hashed,
 * promoted to its canonical name, the upload record settled `verified` — and
 * refused by `extract`, which is a job card that has been running for a while
 * before it says the one thing it knew at byte one. Greg asked for the refusal
 * to arrive in seconds
 * (docs/plans/260903k-pdf-page-cap-refused-with-no-reason-given.md § Stage 4).
 *
 * **Two call sites, not one shared seam**, and the tests are separate for the
 * reason the code is: by the time `acquireUpload` returns it has settled the
 * upload `verified`, which is terminal (src/source.ts), so a refusal after that
 * point cannot mark the record `rejected` — and a fetched `.pdf` address never
 * goes through `acquireUpload` at all. Each half has to be checked where it
 * lives or one of them is enforced by hope.
 *
 * The controls matter as much as the refusals. A PDF *inside* the cap has to
 * come out the other side with its manifest intact, and an unparseable file has
 * to reach stage 2 rather than being refused here for the wrong reason — the
 * counter is a cost gate, not a validity one.
 */
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchedDocument } from "../src/fetch.js";
import { readerFailureOf } from "../src/job-failure.js";
import { STEPS } from "../src/pipeline.js";
import { canonicalKey, stagingKey } from "../src/source.js";
import { blobStore, CONTENT_TYPE } from "../src/store/blobs.js";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import { MAX_PAGES } from "../src/uploads.js";
import { claimUpload, forgetUpload, mintUpload, readUpload } from "../src/upload-records.js";
import { getDb } from "../src/db/client.js";
import { memoryArtefacts } from "./helpers/memory-artefacts.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/**
 * **`writeRaw` is spied on rather than stubbed away**, because the claim this
 * file makes about the URL half is *ordering*: the refusal happens before the
 * bytes are stored. A test that only asserted the throw would pass just as
 * happily with the check bolted on after `writeRaw`, which is the version that
 * leaves a stranger's 900-page scan in the content-addressed bucket.
 *
 * `fetchDocument` is stubbed for the ordinary reason: `fetchDocument` refuses
 * loopback addresses (src/fetch.ts § `isBlockedAddress`), so there is no way to
 * serve one of these from this process.
 */
const stubbed: {
  doc: FetchedDocument | null;
  stored: number;
  /** Scripted for the one case a real PDF cannot produce — see the last test. */
  countThrows: Error | null;
} = { doc: null, stored: 0, countThrows: null };

/**
 * **The counter, delegating to the real one unless a test says otherwise.**
 *
 * Only the last case uses it. Everything else in this file counts real pages out
 * of a real pdf-lib document, because the thing under test is a cost gate and a
 * gate tested against a stub is a gate nobody has weighed.
 */
vi.mock("../src/pdf.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/pdf.js")>();
  return {
    ...real,
    countPdfPages: async (source: string | Uint8Array, signal?: AbortSignal) => {
      if (stubbed.countThrows) throw stubbed.countThrows;
      /* Forwarded, not dropped. The signal is the job's 740 s self-abort and
         the bug this file also covers was the call site passing none — a mock
         that swallowed it would make the last test below green for free. */
      return real.countPdfPages(source, signal);
    },
  };
});

vi.mock("../src/fetch.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/fetch.js")>();
  return {
    ...real,
    fetchDocument: async () => {
      if (!stubbed.doc) throw new Error("this test did not say what the fetch returns");
      return stubbed.doc;
    },
    writeRaw: async (doc: FetchedDocument) => {
      stubbed.stored += 1;
      return real.writeRaw(doc);
    },
  };
});

const blobs = blobStore();

/**
 * **A store, because `run` takes one — and the refusals never reach it.**
 *
 * The whole claim of this file is that an over-long PDF is turned away *before*
 * anything is stored, so the interesting cases write no artefact at all; the
 * two controls assert on the manifest the step returns rather than on anything
 * read back. It was `fsArtifacts` under the repository's own `data/` until
 * 2026-09-05, which is the only reason each context needed a directory swept up
 * after it. The blob store is the one storage this file really is about, and it
 * is untouched.
 */
const artefacts = memoryArtefacts();

/** This file's own `auth.users` row — tests/fixture-ids.test.ts. */
const OWNER = "00000000-0000-4000-8000-0000000000dd";

const rubbish: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  stubbed.doc = null;
  stubbed.stored = 0;
  stubbed.countThrows = null;
  for (const undo of rubbish.splice(0)) await undo();
});

/** A real, minimal, valid PDF with the given number of blank pages. */
async function pdfWithPages(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage([200, 200]);
  return doc.save();
}

const shaOf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** An upload minted, claimed and with its bytes in the store — what `POST /api/jobs` leaves. */
async function readyToVerify(bytes: Uint8Array) {
  await seedAuthUser(getDb(), {
    id: OWNER,
    email: `long-pdf-${OWNER}@example.test`,
    onConflictDoNothing: true,
  });
  const minted = await mintUpload(
    { filename: "paper.pdf", bytes: bytes.byteLength, sha256: shaOf(bytes), owner: OWNER },
    async (key) => ({
      url: `https://x.test/${key}`,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }),
    stagingKey,
  );
  const id = minted.record.id;
  rubbish.push(() => forgetUpload(id));
  rubbish.push(() => blobs.remove(stagingKey(id)));
  rubbish.push(() => blobs.remove(canonicalKey(shaOf(bytes), "pdf")));
  await claimUpload(id);
  await blobs.putIfAbsent(stagingKey(id), bytes, CONTENT_TYPE.pdf);

  const slug = `test-long-pdf-${id.slice(0, 8)}`;
  return {
    id,
    ctx: {
      slug,
      upload: { id, filename: "paper.pdf" },
      report: () => {},
      signal: new AbortController().signal,
      cacheArticle: false,
    },
  };
}

/** A context for the fetched half. No upload, an address, and nothing else different. */
function urlContext(slug: string, signal = new AbortController().signal) {
  return {
    slug,
    url: "https://example.test/paper.pdf",
    report: () => {},
    signal,
    cacheArticle: false,
  };
}

function aFetchedPdf(bytes: Uint8Array): FetchedDocument {
  return {
    requestedUrl: "https://example.test/paper.pdf",
    url: "https://example.test/paper.pdf",
    chain: ["https://example.test/paper.pdf"],
    status: 200,
    kind: "pdf",
    contentType: "application/pdf",
    bytes,
    text: null,
    encoding: null,
    fetchedAt: new Date().toISOString(),
  };
}

describe("a PDF longer than the cap, refused in stage 1", () => {
  it("tells an uploader the page count and the limit, from the fetch step", async () => {
    const pages = MAX_PAGES + 42;
    const bytes = await pdfWithPages(pages);
    const { ctx } = await readyToVerify(bytes);

    const thrown = await STEPS.fetch
      .run(ctx, artefacts, nullCheckpointStore())
      .then(() => null)
      .catch((err: unknown) => err);
    expect(thrown, "the fetch step accepted a PDF over the cap").not.toBeNull();

    /* At the seam every failed step passes through, not at the throw — the
       whole of stage 1 of this plan was that these two are not the same. */
    const failure = readerFailureOf(thrown, "Checking the file");
    expect(failure.message).toContain(String(pages));
    expect(failure.message).toContain(String(MAX_PAGES));
    expect(failure.message).not.toContain("[jb-step-no]");
  });

  it("leaves the upload rejected rather than verified, and stores nothing", async () => {
    const bytes = await pdfWithPages(MAX_PAGES + 7);
    const { id, ctx } = await readyToVerify(bytes);

    await expect(STEPS.fetch.run(ctx, artefacts, nullCheckpointStore())).rejects.toThrow();

    /* `verified` is terminal (src/source.ts § `NEXT`), which is the whole
       reason the check has to happen before the promotion rather than after
       `acquireUpload` returns: a refusal on the far side of that line cannot
       move the record at all, and the reason is lost. */
    const record = await readUpload(id);
    expect(record?.status).toBe("rejected");
    /* And the bytes never reached the content-addressed bucket, so a document
       we refused to read is not sitting in it under its own hash. */
    expect(await blobs.head(canonicalKey(shaOf(bytes), "pdf"))).toBeNull();
  });

  it("refuses a fetched address before the bytes are stored", async () => {
    const pages = MAX_PAGES + 13;
    stubbed.doc = aFetchedPdf(await pdfWithPages(pages));
    const ctx = urlContext("test-long-pdf-url");

    const thrown = await STEPS.fetch
      .run(ctx, artefacts, nullCheckpointStore())
      .then(() => null)
      .catch((err: unknown) => err);
    expect(thrown, "the fetch step accepted a PDF over the cap").not.toBeNull();

    const failure = readerFailureOf(thrown, "Fetching the page");
    expect(failure.message).toContain(String(pages));
    expect(failure.message).toContain(String(MAX_PAGES));
    /* The ordering claim. A check after `writeRaw` would satisfy every
       assertion above it and still put the document in the bucket. */
    expect(stubbed.stored).toBe(0);
  });

  /**
   * **The control the counter itself could break.** pdf.js takes *ownership* of
   * the array it is handed and leaves the caller holding a detached buffer, so
   * a count that forgot to copy would leave `writeRaw` storing nothing — and
   * every assertion in the refusal test above would still pass.
   */
  it("stores a fetched PDF inside the cap, bytes and all", async () => {
    const bytes = await pdfWithPages(4);
    stubbed.doc = aFetchedPdf(bytes);
    const ctx = urlContext("test-short-pdf-url");

    const product = await STEPS.fetch.run(ctx, artefacts, nullCheckpointStore());
    rubbish.push(() => blobs.remove(canonicalKey(shaOf(bytes), "pdf")));
    expect(stubbed.stored).toBe(1);
    expect(product.parts?.raw?.storedSha256).toBe(shaOf(bytes));
    expect(product.parts?.raw?.bytes).toBe(bytes.byteLength);
  });

  it("lets a PDF inside the cap through, manifest and all", async () => {
    const bytes = await pdfWithPages(MAX_PAGES - 8);
    const { id, ctx } = await readyToVerify(bytes);

    const product = await STEPS.fetch.run(ctx, artefacts, nullCheckpointStore());
    expect(product.parts?.raw?.kind).toBe("pdf");
    expect(product.parts?.raw?.storedSha256).toBe(shaOf(bytes));
    expect((await readUpload(id))?.status).toBe("verified");
  });

  /**
   * **A file the counter cannot open is stage 2's problem, not stage 1's.**
   *
   * The cap is a cost gate. Making it also a validity gate would move every
   * malformed-PDF failure into the acquisition step, where the reader is told
   * about fetching rather than about extracting — and it would break the one
   * property `acquireUpload` exists for, which is that the bytes are checked
   * for being *ours* and then handed on unaltered. `pass0` opens the same file
   * with the same options in stage 2 and fails there, where the sentence fits.
   */
  it("hands an unopenable PDF on to stage 2 rather than refusing it here", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4\nnot really\n%%EOF\n");
    const { ctx } = await readyToVerify(bytes);

    const product = await STEPS.fetch.run(ctx, artefacts, nullCheckpointStore());
    expect(product.parts?.raw?.kind).toBe("pdf");
  });

  /**
   * **A broken counter is not a licence to store the document.**
   *
   * The case above passes a file pdf.js can *decide about*, and the first draft
   * of this gate treated every throw the same way — so a failed dynamic import,
   * a worker that would not start, or a plain programmer error would all have
   * read as "not a PDF worth refusing" and let the document through to storage
   * with the cap silently not gating. That is docs/reusable/silent-success.md in
   * its purest form, and it is the finding a cross-family review returned
   * DO-NOT-SHIP over ⟨Sol, 2026-09-04⟩.
   *
   * The stub is the only way to reach it: no real PDF makes pdf.js throw a
   * `TypeError`, which is exactly why the hole was invisible.
   */
  /**
   * **The claimant's deadline has to reach the counter**, and for a day it did
   * not: `countPdfPages` took no signal and this call site passed none, so the
   * 740 s self-abort could not touch pdf.js at all ⟨GPT Sol, 2026-09-04⟩. The
   * cut-short itself is tested against a document that never opens, in
   * tests/counting-pages-can-be-given-up.test.ts; what is asserted here is the
   * half that was actually missing — that the step hands its signal over.
   */
  it("does not open a stranger's file after the claimant has given up", async () => {
    stubbed.doc = aFetchedPdf(await pdfWithPages(3));
    const overdue = AbortSignal.abort(new Error("this claimant is out of time"));
    const ctx = urlContext("test-abandoned-pdf-url", overdue);

    await expect(STEPS.fetch.run(ctx, artefacts, nullCheckpointStore())).rejects.toThrow(
      /out of time/,
    );
    expect(stubbed.stored, "stored a document nobody was still waiting for").toBe(0);
  });

  it("fails the step rather than storing the bytes when the counter itself breaks", async () => {
    stubbed.countThrows = new TypeError("loadPdfjs is not a function");
    const bytes = await pdfWithPages(3);
    const { ctx } = await readyToVerify(bytes);

    await expect(STEPS.fetch.run(ctx, artefacts, nullCheckpointStore())).rejects.toThrow(
      TypeError,
    );
    expect(await blobs.head(canonicalKey(shaOf(bytes), "pdf"))).toBeNull();
  });
});
