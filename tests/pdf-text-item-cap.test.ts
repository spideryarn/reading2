/** A character cap does not bound a PDF made from many empty text runs. */
import { expect, it, vi } from "vitest";

const destroyTask = vi.fn(async () => {});
const cleanup = vi.fn(async () => {});
const emptyRuns = {
  *[Symbol.iterator]() {
    /* Long enough to cross the paper reader's real cap without retaining
       200,001 fixture objects in the test process. */
    for (let i = 0; i <= 200_000; i++) {
      yield { str: "", hasEOL: i === 200_000, transform: [1, 0, 0, 1, 72, 700] };
    }
  },
};

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: () => ({
    destroy: destroyTask,
    promise: Promise.resolve({
      numPages: 1,
      getMetadata: async () => ({ info: {} }),
      getPage: async () => ({ getTextContent: async () => ({ items: emptyRuns }) }),
      cleanup,
    }),
  }),
}));

const { pass0 } = await import("../src/pdf.js");
const { PAPER_MAX_TEXT_ITEMS, readPaperText } = await import("../src/paper-text.js");

const BYTES = new TextEncoder().encode("%PDF-1.7\n");

it("refuses too many text items even when they carry no characters", async () => {
  /* SEEN RED 2026-10-01: maxChars never advanced for empty runs, so all six
     were retained and the parse returned normally. */
  await expect(pass0(BYTES, { maxChars: 10, maxItems: 5 } as Parameters<typeof pass0>[1])).rejects.toThrow(
    /text items|text runs/i,
  );
  expect(destroyTask).toHaveBeenCalled();
});

it("wires the text-item cap into the cited-paper reader", async () => {
  const got = await readPaperText("https://papers.example/work.pdf", {
    pdfOnly: true,
    fetch: {
      resolve: async () => ["93.184.216.34"],
      fetchImpl: async () =>
        new Response(BYTES, { status: 200, headers: { "content-type": "application/pdf" } }),
    },
  });
  expect(got).toMatchObject({
    kind: "unreadable",
    why: "too-large",
    detail: `over ${PAPER_MAX_TEXT_ITEMS} text items`,
  });
});
