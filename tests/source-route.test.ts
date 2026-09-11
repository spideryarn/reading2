/**
 * **`GET /api/source/:slug`, end to end through the route.**
 *
 * Its sibling, tests/source-download.test.ts, tests the two pure pieces —
 * `readRawDocument` and `contentDisposition`. GPT Sol's review of the built code
 * pointed out what that leaves uncovered, and was right:
 *
 * > Changing the route's null outcome to 500, removing `Content-Length`, or
 * > sending headers before loading would leave it green.
 * >
 * > — GPT Sol, 2026-08-31
 *
 * So this drives the real `handleApi` with the store faked at the seam, and
 * asserts the things only the route decides: which status each of the four
 * outcomes becomes once the error has travelled through this file's status
 * plumbing, what headers go out, and that the body's length is the body's
 * length.
 *
 * **The store is faked, not the route.** `sourceStore.readPdf` is the one call
 * being varied; `shelfStore.read` is the authorisation and is left real enough
 * to record that it happened, and happened first. Everything else in
 * `src/store/index.js` is passed through, so this cannot pass because the module
 * failed to load.
 *
 * ## The seam moved on the day this was written, and these tests followed it
 *
 * Two sessions fixed the same production bug — *view the original* reading the
 * local filesystem, so it worked on a laptop and 404d on Vercel — on 2026-08-31,
 * and they landed different seams. `ArticleReader.loadSource` answers the whole
 * document question (both kinds, plus the manifest's own answer for which) and
 * still exists for `db:export`; `SourceStore.readPdf`
 * (docs/plans/260831b-finish-the-database-move.md § stage 1b) is deliberately
 * narrower, because an HTML source served from our own origin is stored XSS, so
 * the store hands back the one kind a route may set a content type for. The
 * route took the narrow one. These tests were rewritten onto it rather than
 * deleted: every outcome below is still an outcome, and the *kind* check simply
 * moved from the route into the store, where tests/source-store.test.ts pins it
 * for both adapters.
 *
 * No database. See docs/plans/plain-mode-and-the-way-out.md § 5.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";
import { charCountDiffers, withMultibyteTail } from "./helpers/binary-response.js";

/** Hoisted, because `vi.mock` is — a plain const would be `undefined` in the factory. */
const seen = vi.hoisted(() => ({
  /** In call order, so "did it authorise before it fetched" is answerable. */
  calls: [] as string[],
  /** What `sourceStore.readPdf` should do this time. Set by each test. */
  source: null as null | (() => Promise<unknown>),
}));

vi.mock("../src/store/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/index.js")>(
    "../src/store/index.js",
  );
  return {
    ...actual,
    shelfStore: {
      ...actual.shelfStore,
      read: async (slug: string) => {
        seen.calls.push(`shelfStore.read(${slug})`);
        /* Enough of a shelf row to be truthy. The route discards it — it asks
           the question rather than reading the answer. */
        return { slug, title: "A piece" } as never;
      },
    },
    sourceStore: {
      ...actual.sourceStore,
      readPdf: async (slug: string) => {
        seen.calls.push(`sourceStore.readPdf(${slug})`);
        if (!seen.source) throw new Error("the test did not say what readPdf should do");
        return seen.source();
      },
    },
  };
});

const { handleApi } = await import("../src/routes.js");

interface Sent {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  /** Headers written before `end` — so "loads before it sends" is checkable. */
  headersAtFirstWrite: string[] | null;
}

async function get(slug: string, method = "GET"): Promise<Sent> {
  const req = Object.assign(
    (async function* () {})(),
    { method, url: `/api/source/${slug}`, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;

  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
  let status = 0;
  let headersAtFirstWrite: string[] | null = null;

  const res = {
    get statusCode() {
      return status;
    },
    set statusCode(v: number) {
      status = v;
    },
    writableEnded: false,
    destroyed: false,
    setHeader(name: string, value: unknown) {
      headers[name.toLowerCase()] = String(value);
    },
    flushHeaders() {},
    on() {},
    writeHead(code: number) {
      status = code;
    },
    write(chunk: string | Buffer) {
      if (headersAtFirstWrite === null) headersAtFirstWrite = Object.keys(headers);
      chunks.push(Buffer.from(chunk as never));
      return true;
    },
    end(chunk?: string | Buffer) {
      if (headersAtFirstWrite === null) headersAtFirstWrite = Object.keys(headers);
      if (chunk) chunks.push(Buffer.from(chunk as never));
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, acceptAny);
  return { status, headers, body: Buffer.concat(chunks), headersAtFirstWrite };
}

/* With a multibyte tail, so a `Content-Length` that counted characters rather
   than bytes would be wrong about it — tests/helpers/binary-response.ts. */
const PDF = Buffer.from(withMultibyteTail(Buffer.from("%PDF-1.7\nthe reader's own paper\n")));

beforeEach(() => {
  seen.calls.length = 0;
  seen.source = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("serving an article's original document", () => {
  it("sends the bytes, with the length of the bytes it sends", async () => {
    seen.source = async () => ({ bytes: new Uint8Array(PDF), filename: "paper.pdf" });
    const sent = await get("a-piece");

    expect(sent.status).toBe(200);
    expect(sent.headers["content-type"]).toBe("application/pdf");
    expect(sent.headers["x-content-type-options"]).toBe("nosniff");
    /* **Measured off the response, not off the store.** A `Content-Length` taken
       from a stored byte count is right until the two disagree, and the case
       where they disagree is the case it matters. */
    expect(sent.body.equals(PDF)).toBe(true);
    expect(sent.headers["content-length"]).toBe(String(sent.body.byteLength));
    expect(sent.headers["content-disposition"]).toContain('filename="paper.pdf"');
  });

  /**
   * **`inline`, and it has to be asserted on the route.**
   *
   * `contentDisposition` returned a hard-coded `inline` until 2026-09-01,
   * because this was its only caller. It now takes the disposition as a
   * required argument so a download route can ask for `attachment` — which
   * means the *reason* a PDF is `inline` (the reader pressed *view the
   * original*, and a browser that can show a PDF should show it — GPT Sol,
   * 2026-08-31) is now a fact about this route rather than about that function,
   * and nothing but this test holds it. Passing `"attachment"` here would send
   * every original to the downloads folder, which is a regression no test of
   * the pure function can see.
   */
  it("asks the browser to display the PDF, not download it", async () => {
    seen.source = async () => ({ bytes: new Uint8Array(PDF), filename: "paper.pdf" });
    const sent = await get("a-piece");
    expect(sent.headers["content-disposition"]).toMatch(/^inline;/);
    expect(sent.headers["content-disposition"]).not.toContain("attachment");
  });

  it("falls back to the slug when the document has no filename of its own", async () => {
    /* Anything we fetched rather than took an upload of. `<slug>.pdf` is a name
       a reader can find again on their own disk. */
    seen.source = async () => ({ bytes: new Uint8Array(PDF), filename: null });
    const sent = await get("a-piece");
    expect(sent.headers["content-disposition"]).toContain('filename="a-piece.pdf"');
  });

  /**
   * **The authorisation, and its position.**
   *
   * The route was authenticated and not authorised until 2026-08-27 — it took a
   * slug and returned the file, never asking whose article it was. The check is
   * only worth anything before the bytes are fetched, so both facts are asserted
   * here: that it happens, and that it happens first.
   */
  it("asks whose article it is before it fetches anything", async () => {
    seen.source = async () => ({ bytes: new Uint8Array(PDF), filename: null });
    await get("a-piece");
    expect(seen.calls).toEqual(["shelfStore.read(a-piece)", "sourceStore.readPdf(a-piece)"]);
  });

  it("404s an article that kept no source document", async () => {
    /* `null` is the ordinary state — an HTML article, or one fetched before
       manifests. Not a fault, and it must not read as one. */
    seen.source = async () => null;
    const sent = await get("a-piece");
    expect(sent.status).toBe(404);
  });

  /**
   * **A web page's source is the same 404, and the route no longer decides it.**
   *
   * It used to: the route asked for the document, read `kind`, and refused
   * anything that was not a PDF. `SourceStore.readPdf` answers `null` for an
   * HTML source instead, so the refusal moved into the store — which is the
   * safer place for it, because the route can then set one content-type literal
   * rather than deriving one. What is asserted here is that the route still says
   * the same sentence about it, with the same status, and does not somehow treat
   * "not a PDF" as a fault.
   *
   * That the two adapters really do answer `null` for HTML — referenced *and*
   * legacy, with the object genuinely present in the bucket — is
   * tests/source-store.test.ts, which exists because GPT Sol pointed out that
   * every Postgres fixture there was a PDF and an implementation serving HTML
   * would have passed.
   */
  it("404s an article whose source is not a PDF, as the store reports it", async () => {
    seen.source = async () => null;
    const sent = await get("a-piece");
    expect(sent.status).toBe(404);
    expect(sent.headers["content-type"]).not.toBe("application/pdf");
  });

  /**
   * **And the three that are 500s, which is the whole point of the split.**
   *
   * A revision naming a stored object asserts that object exists. A missing or
   * corrupt one is an operational fault — a deleted object, a mis-set bucket, a
   * bad backfill — and answering 404 would tell an owner their paper never
   * existed and leave monitoring looking at an ordinary not-found.
   */
  it("500s a dangling reference rather than calling it a missing article", async () => {
    const { MissingRawObject } = await import("../src/store/raw-document.js");
    seen.source = async () => {
      throw new MissingRawObject("a-piece", "sha256/deadbeef.pdf");
    };
    expect((await get("a-piece")).status).toBe(500);
  });

  it("500s an object that is not what its key says", async () => {
    const { CorruptRawObject } = await import("../src/store/raw-document.js");
    seen.source = async () => {
      throw new CorruptRawObject("a-piece", "sha256/deadbeef.pdf", "cafe");
    };
    expect((await get("a-piece")).status).toBe(500);
  });

  it("500s a blob-store outage, which is not an absent document either", async () => {
    seen.source = async () => {
      throw new Error("Storage said 503");
    };
    expect((await get("a-piece")).status).toBe(500);
  });

  /**
   * **Nothing is written until the bytes are in hand.**
   *
   * Every failure above has to be able to become a status. A route that set its
   * headers and then went looking for the document would have committed to a
   * 200 before it knew, and the reader would get an empty PDF instead of an
   * error. So on the failing path nothing is written at all beyond the error
   * body, and on the succeeding path the PDF headers are all present at the
   * first write.
   */
  it("commits to no status until it has the document", async () => {
    seen.source = async () => {
      throw new Error("Storage said 503");
    };
    const failed = await get("a-piece");
    expect(failed.headers["content-type"]).not.toBe("application/pdf");

    seen.source = async () => ({ bytes: new Uint8Array(PDF), filename: null });
    const ok = await get("a-piece");
    expect(ok.headersAtFirstWrite).toEqual(
      expect.arrayContaining(["content-type", "content-length", "content-disposition"]),
    );
  });
});

/**
 * **The whole response, as three separate claims** — cluster H of
 * docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md, pinned
 * before the six binary writers were folded into one
 * (docs/plans/260911e-one-binary-response-writer.md).
 *
 * The headers as an exact set, so a header that appears is as red as one that
 * changes: this route sets **no** `Cache-Control`, and a shared writer that
 * supplied a default would be a policy this route never chose. The length off
 * multibyte bytes. And HEAD, which the authenticated dispatcher does not answer
 * at all — a writer that can suppress a body for the public route must not
 * make this one start serving HEADs.
 */
describe("the original document's response, whole", () => {
  it("carries exactly these headers, and no cache policy of its own", async () => {
    const { contentDisposition } = await import("../src/routes.js");
    seen.source = async () => ({ bytes: new Uint8Array(PDF), filename: "paper.pdf" });
    const sent = await get("a-piece");
    expect(sent.status).toBe(200);
    expect(sent.headers).toEqual({
      "content-type": "application/pdf",
      "content-length": String(PDF.byteLength),
      "content-disposition": contentDisposition("paper.pdf", "inline"),
      "x-content-type-options": "nosniff",
    });
  });

  it("counts the bytes it sends, not the characters they decode to", async () => {
    expect(charCountDiffers(PDF), "the fixture must tell bytes from characters").toBe(true);
    seen.source = async () => ({ bytes: new Uint8Array(PDF), filename: null });
    const sent = await get("a-piece");
    expect(sent.body.equals(PDF)).toBe(true);
    expect(sent.headers["content-length"]).toBe(String(PDF.byteLength));
  });

  it("is inline, under the document's own name", async () => {
    seen.source = async () => ({ bytes: new Uint8Array(PDF), filename: "paper.pdf" });
    const sent = await get("a-piece");
    expect(sent.headers["content-disposition"]).toMatch(/^inline; filename="paper\.pdf"/);
  });

  it("does not answer a HEAD, and never reads the document for one", async () => {
    seen.source = async () => ({ bytes: new Uint8Array(PDF), filename: null });
    const sent = await get("a-piece", "HEAD");
    expect(sent.status).toBe(404);
    expect(sent.headers["content-type"]).not.toBe("application/pdf");
    expect(sent.body.includes(PDF)).toBe(false);
    expect(seen.calls).toEqual([]);
  });
});
