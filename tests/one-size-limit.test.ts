/**
 * **One size limit for a file chosen and a document fetched by address.**
 *
 * The dialog says "PDF or web page, up to 50 MB" (`uploadLimits()` in
 * src/uploads.ts). Until 2026-10-04 that was true of an upload and false of an
 * address, which stopped at a second number typed into src/fetch.ts: 32 MiB.
 * Greg, 2026-10-04: "make them consistent (and perhaps reuse the same
 * protection-machinery)". docs/plans/261004k-one-size-limit-for-an-upload-and-an-address.md.
 *
 * Three claims, each seen red before the code changed:
 *
 *  1. An address is accepted at exactly `MAX_UPLOAD_BYTES` and refused one byte
 *     over, whether or not the server declares a length.
 *  2. The store's own read stops at the cap rather than buffering first — the
 *     same streaming counter the fetch uses (src/read-capped.ts).
 *  3. The job card does not offer Retry under the over-limit failure: the same
 *     address is the same size next time.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS, FetchFailure, type FetchOptions } from "../src/fetch.js";
import { readerFailureOf } from "../src/job-failure.js";
import { STEPS } from "../src/pipeline.js";
import { supabaseBlobs } from "../src/store/blobs-supabase.js";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import { MAX_UPLOAD_BYTES } from "../src/uploads.js";
import { memoryArtefacts } from "./helpers/memory-artefacts.js";

/**
 * `fetchDocument` refuses a loopback address and the pipeline's fetch step
 * passes it no seam, so the step test reaches the real function through this
 * mock, which only adds the injected network. Nothing about the cap is stubbed.
 */
const network: { seams: FetchOptions | null } = { seams: null };

vi.mock("../src/fetch.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/fetch.js")>();
  return {
    ...real,
    fetchDocument: async (url: string, options: FetchOptions = {}) =>
      real.fetchDocument(url, { ...options, ...(network.seams ?? {}) }),
  };
});

const { fetchDocument } = await import("../src/fetch.js");

afterEach(() => {
  network.seams = null;
  vi.unstubAllGlobals();
});

/** A PDF by its first bytes, of exactly this size. */
function pdfOf(size: number): Uint8Array {
  const body = new Uint8Array(size);
  body.set(new TextEncoder().encode("%PDF-1.4\n"));
  return body;
}

/** The injected network: one response, and no socket. */
function serving(body: Uint8Array, declared: boolean): FetchOptions {
  return {
    attempts: 1,
    sleep: async () => {},
    resolve: async () => ["93.184.216.34"],
    fetchImpl: async () =>
      new Response(body as unknown as BodyInit, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          ...(declared ? { "content-length": String(body.byteLength) } : {}),
        },
      }),
  };
}

async function failureFrom(promise: Promise<unknown>): Promise<FetchFailure> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof FetchFailure) return err;
    throw err;
  }
  throw new Error("expected a FetchFailure, got a success");
}

describe("a document fetched by address has the upload's size limit", () => {
  it("is the same number, from the same constant", () => {
    expect(DEFAULTS.maxBytes).toBe(MAX_UPLOAD_BYTES);
  });

  for (const declared of [true, false]) {
    const header = declared ? "a declared length" : "no declared length";

    it(`accepts exactly the stated limit, with ${header}`, async () => {
      const doc = await fetchDocument("https://example.com/long.pdf", serving(pdfOf(MAX_UPLOAD_BYTES), declared));
      expect(doc.kind).toBe("pdf");
      expect(doc.bytes.byteLength).toBe(MAX_UPLOAD_BYTES);
    });

    it(`refuses one byte over it, with ${header}, and names the limit the dialog names`, async () => {
      const err = await failureFrom(
        fetchDocument("https://example.com/long.pdf", serving(pdfOf(MAX_UPLOAD_BYTES + 1), declared)),
      );
      expect(err.code).toBe("too-large");
      expect(err.message).toContain("50 MB");
    });
  }
});

describe("the store's read stops at the cap", () => {
  it("cancels a body with no declared length once it is over, rather than buffering it all", async () => {
    const chunk = new Uint8Array(1024);
    const chunks = 64;
    let pulled = 0;
    let cancelled = false;
    vi.stubGlobal("fetch", async () => {
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (pulled === chunks) return controller.close();
            pulled += 1;
            controller.enqueue(chunk);
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(body, { status: 200 });
    });
    const store = supabaseBlobs("https://proj.supabase.co", "service-key");
    await expect(store.get("ab/abcdef.pdf", { maxBytes: 4 * 1024 })).rejects.toThrow(/the limit is 4096/);
    expect(cancelled, "the body was read to its end before the size was checked").toBe(true);
    expect(pulled).toBeLessThan(chunks);
  });

  /** A body delivered in these chunks, with no declared length. */
  const inChunks = (...chunks: number[][]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
        controller.close();
      },
    });

  it("still returns a body at exactly the cap, whole and in order across chunks", async () => {
    vi.stubGlobal("fetch", async () => new Response(inChunks([1, 2], [3]), { status: 200 }));
    const store = supabaseBlobs("https://proj.supabase.co", "service-key");
    const got = await store.get("ab/abcdef.pdf", { maxBytes: 3 });
    expect(Array.from(got ?? [])).toEqual([1, 2, 3]);
  });

  it("returns the whole body when the caller names no cap", async () => {
    vi.stubGlobal("fetch", async () => new Response(inChunks([1, 2], [3, 4]), { status: 200 }));
    const store = supabaseBlobs("https://proj.supabase.co", "service-key");
    expect(Array.from((await store.get("ab/abcdef.pdf")) ?? [])).toEqual([1, 2, 3, 4]);
  });

  it("hands back a broken stream's own error, never 'too large'", async () => {
    /* GPT Sol's plan review, F2. `readRawDocument` and `overlongObject` tell
       "too large" from "broken" by asking `head`, not by reading this text, but
       a read failure reported as a size refusal would still be a wrong line in
       the log. Red by making the counter throw `tooLarge` from its catch. */
    const broken = new Error("socket hang up");
    let sent = false;
    vi.stubGlobal("fetch", async () => {
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (sent) throw broken;
            sent = true;
            controller.enqueue(new Uint8Array([1]));
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(body, { status: 200 });
    });
    const store = supabaseBlobs("https://proj.supabase.co", "service-key");
    await expect(store.get("ab/abcdef.pdf", { maxBytes: 1024 })).rejects.toBe(broken);
  });
});

describe("the job card under an address that is over the limit", () => {
  it("is told the limit and is not offered Retry", async () => {
    network.seams = serving(pdfOf(MAX_UPLOAD_BYTES + 1), false);
    const ctx = {
      slug: "test-one-size-limit",
      url: "https://example.com/long.pdf",
      report: () => {},
      preview: () => {},
      signal: new AbortController().signal,
      cacheArticle: false,
      power: "standard" as const,
    };
    const thrown = await STEPS.fetch
      .run(ctx, memoryArtefacts(), nullCheckpointStore())
      .then(() => null)
      .catch((err: unknown) => err);
    expect(thrown, "the fetch step accepted a document over the limit").not.toBeNull();

    const failure = readerFailureOf(thrown, STEPS.fetch.label);
    /* `blocked`, the kind `UPLOAD_TOO_BIG` has for the same fact: the address
       serves the same bytes next time, so a Retry is a button that cannot work. */
    expect(failure.kind).toBe("blocked");
    expect(failure.message).toContain("50 MB");
    expect(failure.message).toContain("[fetch-big]");
  });
});
