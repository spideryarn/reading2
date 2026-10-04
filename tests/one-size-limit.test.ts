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
import { DEFAULTS, FetchFailure, readRawBytes, type FetchOptions } from "../src/fetch.js";
import { readStreamCapped } from "../src/read-capped.js";
import { readerFailureOf } from "../src/job-failure.js";
import { STEPS } from "../src/pipeline.js";
import { createHash } from "node:crypto";
import { kindOfMessage, worthRetrying } from "../src/messages.js";
import type { RawSourceStore } from "../src/store/blobs.js";
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

  for (const maxBytes of [undefined, NaN, Infinity, -1]) {
    it(`bounds a read with ${String(maxBytes)} as its cap`, async () => {
      let pulled = 0;
      const cancel = vi.fn();
      const chunk = new Uint8Array(MAX_UPLOAD_BYTES / 2);
      vi.stubGlobal("fetch", async () => new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulled === 4) { controller.close(); return; }
          pulled += 1;
          controller.enqueue(chunk);
        },
        cancel,
      }, { highWaterMark: 1 })));
      const store = supabaseBlobs("https://proj.supabase.co", "service-key");
      await expect(store.get("ab/abcdef.pdf", maxBytes === undefined ? {} : { maxBytes })
        .then((bytes) => bytes?.byteLength)).rejects.toThrow(`the limit is ${MAX_UPLOAD_BYTES}`);
      expect(pulled).toBeLessThanOrEqual(4);
      expect(cancel).toHaveBeenCalledOnce();
    });
  }

  it("preserves the size refusal when cancelling a header refusal fails", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("cancel failed"));
    vi.stubGlobal("fetch", async () => new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { "content-length": "4" },
    }));
    const store = supabaseBlobs("https://proj.supabase.co", "service-key");
    await expect(store.get("ab/abcdef.pdf", { maxBytes: 3 })).rejects.toThrow("the limit is 3");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("passes the AbortSignal through and preserves an abort during the body read", async () => {
    const controller = new AbortController();
    const reason = new DOMException("stopped", "AbortError");
    let body: ReadableStream<Uint8Array> | undefined;
    const fetchImpl = vi.fn(async (_input: unknown, init: RequestInit | undefined) => {
      expect(init?.signal).toBe(controller.signal);
      body = new ReadableStream<Uint8Array>({
        start(stream) {
          init?.signal?.addEventListener("abort", () => stream.error(controller.signal.reason), { once: true });
          stream.enqueue(new Uint8Array([1]));
        },
      });
      return new Response(body);
    });
    vi.stubGlobal("fetch", fetchImpl);
    const pending = supabaseBlobs("https://proj.supabase.co", "service-key").get("ab/abcdef.pdf", { signal: controller.signal });
    const assertion = expect(pending).rejects.toBe(reason);
    await Promise.resolve();
    controller.abort(reason);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(body?.locked).toBe(false);
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
  const ctx = (signal = new AbortController().signal) => ({
    slug: "test-one-size-limit",
    url: "https://example.com/private-reading-history.pdf?secret=token",
    report: () => {},
    preview: () => {},
    signal,
    cacheArticle: false,
    power: "standard" as const,
  });

  for (const error of [
    new FetchFailure("not-found", "https://example.com/secret", "missing"),
    new DOMException("reader stopped", "AbortError"),
    new DOMException("deadline", "TimeoutError"),
    new Error("broken connection"),
  ]) {
    it(`does not label ${error.name}: ${error.message} as too big`, async () => {
      network.seams = {
        attempts: 1,
        resolve: async () => ["93.184.216.34"],
        fetchImpl: async () => { throw error; },
      };
      const thrown = await STEPS.fetch.run(ctx(), memoryArtefacts(), nullCheckpointStore()).catch((err: unknown) => err);
      expect(thrown).toBeInstanceOf(FetchFailure);
      expect((thrown as FetchFailure).code).not.toBe("too-large");
      expect(readerFailureOf(thrown, STEPS.fetch.label).message).not.toContain("[fetch-big]");
    });
  }

  it("keeps a caller's Stop out of the size failure", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn();
    network.seams = { attempts: 1, resolve: async () => ["93.184.216.34"], fetchImpl };
    const thrown = await STEPS.fetch.run(ctx(controller.signal), memoryArtefacts(), nullCheckpointStore()).catch((err: unknown) => err);
    expect(thrown).toBeInstanceOf(FetchFailure);
    expect((thrown as FetchFailure).code).toBe("timeout");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readerFailureOf(thrown, STEPS.fetch.label).message).not.toContain("[fetch-big]");
  });
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
    expect(kindOfMessage(failure.message)).toBe("blocked");
    expect(worthRetrying(failure.message)).toBe(false);
    expect((thrown as Error).message).toBe(`The fetched document is over ${MAX_UPLOAD_BYTES} bytes. [fetch-big]`);
    expect((thrown as Error).cause).toBeUndefined();
  });
});


describe("the shared counter's cleanup", () => {
  it("cancels once and releases the lock while preserving the limit error if cancel rejects", async () => {
    const tooBig = new Error("too big");
    const cancel = vi.fn().mockRejectedValue(new Error("cancel failed"));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array([1, 2])); },
      cancel,
    }, { highWaterMark: 0 });
    await expect(readStreamCapped(body, 1, () => tooBig)).rejects.toBe(tooBig);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it("attempts cancel after a read error, releases the lock and keeps the original error", async () => {
    const broken = new Error("broken socket");
    const body = new ReadableStream<Uint8Array>({ pull() { throw broken; } });
    const reader = body.getReader();
    const cancel = vi.spyOn(reader, "cancel");
    vi.spyOn(body, "getReader").mockReturnValue(reader);
    await expect(readStreamCapped(body, 10, () => new Error("too big"))).rejects.toBe(broken);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it("does not cancel on a clean finish and releases the lock", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); },
      cancel,
    });
    await expect(readStreamCapped(body, 1, () => new Error("too big"))).resolves.toEqual(new Uint8Array([1]));
    expect(cancel).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
  });
});


it("bounds legacy raw HTML with room for UTF-8 expansion", async () => {
  const bytes = new TextEncoder().encode("<p>legacy</p>");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const get = vi.fn(async () => bytes);
  const store = { get } as unknown as RawSourceStore;
  await expect(readRawBytes({
    requestedUrl: "https://example.com/", url: "https://example.com/", file: "raw.html",
    contentType: "text/html", kind: "html", bytes: bytes.length, sha256: hash, storedSha256: hash,
    encoding: "utf-8", fetchedAt: "2026-10-04T00:00:00Z",
  }, { store })).resolves.toEqual(bytes);
  expect(get).toHaveBeenCalledWith(expect.any(String), { maxBytes: 3 * MAX_UPLOAD_BYTES });
});
