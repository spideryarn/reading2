/**
 * **The source PDF is parsed once for the whole stage, not once per chunk.**
 *
 * `cutPages(source, pages)` used to be called from inside each chunk's task,
 * and pdf-lib eagerly parses the *whole* source on every `PDFDocument.load` —
 * so a 142-page 8.4 MB paper planning 69 chunks paid for 69 full parses of the
 * same file, on the one event loop, inside the window it was already close to
 * running out of. Measured peak RSS on that document: 283 MB idle, 466 MB with
 * 16 cuts in flight, 948 MB at 48.
 *
 * Counting the parses is the only assertion that can tell the two apart. Every
 * test in tests/pdf-read.test.ts and tests/pdf-chunk-concurrency.test.ts passes
 * under both shapes, because the *bytes* were always identical — which is the
 * point of the three `set…` calls in `openPdfCuts`, and exactly the kind of
 * change that ships unnoticed (docs/reusable/silent-success.md).
 *
 * Seen red against a deliberate reversion: putting `PDFDocument.load(source)`
 * back inside `cut` takes the count from 1 to 6 on this fixture.
 */
import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryCheckpoints } from "./helpers/memory-checkpoints.js";
import type { PdfReader } from "../src/pdf-read.js";
import { planChunks, runPdfExtract } from "../src/pdf-read.js";
import type { PdfRecord } from "../src/pdf.js";
import { pass0 } from "../src/pdf.js";

/** Every `PDFDocument.load` the stage makes, counted through the module seam. */
const loads: number[] = [];

vi.mock("pdf-lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("pdf-lib")>();
  return {
    ...actual,
    /* A Proxy rather than a subclass: `PDFDocument`'s constructor is private,
       and everything else on it — `create`, `copyPages`' machinery — has to go
       on reaching the real class untouched. */
    PDFDocument: new Proxy(actual.PDFDocument, {
      get(target, key, receiver) {
        if (key !== "load") return Reflect.get(target, key, receiver);
        return (...args: Parameters<typeof actual.PDFDocument.load>) => {
          loads.push(Date.now());
          return actual.PDFDocument.load(...args);
        };
      },
    }),
  };
});

const HARDER = new URL("../evals/pdf/harder/source.pdf", import.meta.url);

/** Transcribes each requested page from the text layer, so every chunk passes. */
function textLayerReader(pages: { page: number; text: string }[]): PdfReader {
  return {
    id: "test/text-layer",
    async read(_pdf, instruction) {
      const all = [...instruction.matchAll(/\d+/g)].map(Number);
      const asked = instruction.includes("included only so you can see")
        ? all.slice(1)
        : all;
      const wanted = new Set(asked);
      const records: PdfRecord[] = [];
      for (const page of pages) {
        if (!wanted.has(page.page)) continue;
        for (const line of page.text.split("\n")) {
          if (line.trim()) {
            records.push({
              page: page.page,
              type: "paragraph",
              text: line,
              continues: false,
              uncertain: false,
            });
          }
        }
      }
      return {
        records,
        stripped: 0,
        finish: "stop" as const,
        usage: { input: 100, output: 200 },
        ms: 1,
      };
    },
  };
}

describe("the source PDF is parsed once for the whole stage", () => {
  beforeEach(() => {
    loads.length = 0;
  });

  it("loads the source once however many chunks the document plans", async () => {
    const bytes = new Uint8Array(await readFile(HARDER));
    const pass = await pass0(bytes);
    /* Asserted rather than assumed: with one chunk this test would pass under
       either shape and would be measuring nothing. */
    expect(planChunks(pass).length).toBeGreaterThan(1);
    loads.length = 0;

    await runPdfExtract({
      frontMatter: null,
      bytes,
      url: "https://example.test/paper.pdf",
      checkpoints: memoryCheckpoints({ slug: "paper", articleId: "article-paper" }),
      slug: "paper",
      reader: textLayerReader(pass.pages),
    });

    expect(loads.length).toBe(1);
  });
});
