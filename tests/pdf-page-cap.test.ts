/**
 * The page cap has to fire **before** the parse, not after it.
 *
 * `readPdf` used to check `pass.pages.length > MAX_PAGES` only once `pass0` had
 * returned — by which time pdf.js had opened the document and walked every page
 * and every text item into memory (src/pdf.ts). So the cap bounded what we
 * spent on *models* and bounded nothing about what the parser did first: a
 * small, valid file with a hundred thousand pages was fully parsed before the
 * cap fired.
 *
 * That was survivable while the only way in was a URL we chose to fetch. It
 * stops being survivable the moment a reader can upload a file
 * (docs/plans/260826u-pdf-upload-and-storage.md), which is why this moved.
 *
 * **The assertion that matters is `getPage` was never called.** A test that
 * only checked "an over-long PDF is refused" would have passed against the old
 * code too, since it refused as well — just far too late. Found by the
 * cross-family review, 2026-08-26.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** How many pages the fake document claims. Set per test. */
let numPages = 0;

const destroyTask = vi.fn(async () => {});

const getPage = vi.fn(async () => ({
  getTextContent: async () => ({
    items: [{ str: "some words on the page", hasEOL: true, transform: [1, 0, 0, 1, 72, 700] }],
  }),
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: () => ({
    /* The real loading task is what owns the worker, so refusing a document has
       to destroy this rather than the proxy — asserted below. */
    destroy: destroyTask,
    promise: Promise.resolve({
      get numPages() {
        return numPages;
      },
      getPage,
      getMetadata: async () => ({ info: {} }),
      cleanup: async () => {},
      destroy: async () => {},
    }),
  }),
}));

const { pass0 } = await import("../src/pdf.js");

/* Not a real PDF. pdf.js is mocked, so the bytes are never parsed — what is
   under test is the order of two checks, not the parsing. */
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

beforeEach(() => {
  getPage.mockClear();
  destroyTask.mockClear();
});

describe("the page cap fires before the parse", () => {
  it("refuses a document with too many pages without reading any of them", async () => {
    numPages = 5000;
    await expect(pass0(BYTES, { maxPages: 100 })).rejects.toThrow(/5000/);
    expect(getPage).not.toHaveBeenCalled();
    /* And the worker is released. A refusal that leaks a pdf.js worker per
       hostile upload is a slower version of the same problem. */
    expect(destroyTask).toHaveBeenCalledTimes(1);
  });

  it("says both numbers, so the message can name the limit as well as the count", async () => {
    numPages = 101;
    await expect(pass0(BYTES, { maxPages: 100 })).rejects.toThrow(/101[\s\S]*100|100[\s\S]*101/);
  });

  it("reads the pages normally when the document is under the cap", async () => {
    numPages = 3;
    const pass = await pass0(BYTES, { maxPages: 100 });
    expect(pass.pages).toHaveLength(3);
    expect(getPage).toHaveBeenCalledTimes(3);
  });

  it("does not cap at all when no limit is given", async () => {
    numPages = 250;
    const pass = await pass0(BYTES);
    expect(pass.pages).toHaveLength(250);
  });
});
