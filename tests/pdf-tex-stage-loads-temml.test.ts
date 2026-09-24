/**
 * **The PDF stage loads temml itself.**
 *
 * `recognised` in src/pdf-tex.ts asks temml, through src/maths-server.ts,
 * whether a TeX span would be drawn, and until `loadMathsRenderer()` has run
 * every answer is no. This file never loads it: only `runPdfExtract` can. So a
 * stage that forgot the load reads every span as markup here, exactly as it
 * would in production, and pays for every maths chunk twice.
 * docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const { pass0 } = await import("../src/pdf.js");
const { runPdfExtract } = await import("../src/pdf-read.js");
const { memoryCheckpoints } = await import("./helpers/memory-checkpoints.js");
import type { PdfReader } from "../src/pdf-read.js";
import type { PdfRecord } from "../src/pdf.js";

const EASY = new URL("../evals/pdf/easy/source.pdf", import.meta.url);

describe("the stage, with temml loaded by nothing but the stage", () => {
  it("still reads a chunk written as TeX once, with no retry", async () => {
    const bytes = new Uint8Array(await readFile(EASY));
    const pass = await pass0(bytes);
    let asks = 0;
    const reader: PdfReader = {
      id: "test/tex",
      async read(_pdf, instruction) {
        asks++;
        const range = /Transcribe pages (\d+)–(\d+)/.exec(instruction);
        const one = /Transcribe page (\d+)/.exec(instruction)?.[1];
        const [from, to] = range ? [Number(range[1]), Number(range[2])] : [Number(one), Number(one)];
        const records: PdfRecord[] = [];
        for (const page of pass.pages) {
          if (page.page < from || page.page > to) continue;
          for (const line of page.text.split("\n")) {
            if (!line.trim()) continue;
            const words = line.split(" ");
            const tex =
              words.length >= 6 && !/[\\{}$%]/.test(line)
                ? String.raw`\(\frac{\text{${words[0]}}}{\mathrm{${words[1]}}}\) ${words.slice(2).join(" ")}`
                : line;
            records.push({ page: page.page, type: "paragraph", text: tex, continues: false, uncertain: false });
          }
        }
        return { records, stripped: 0, finish: "stop", usage: { input: 1, output: 1 }, ms: 1 };
      },
    };
    const result = await runPdfExtract({
      frontMatter: null,
      bytes,
      url: "https://example.test/paper.pdf",
      checkpoints: memoryCheckpoints({ slug: "paper", articleId: "article-paper-temml-loader" }),
      slug: "paper",
      reader,
    });
    expect(result.retries).toEqual([]);
    expect(asks).toBe(result.chunks);
    expect(result.extractedHtml).toContain(String.raw`\(\frac{\text{`);
  }, 60_000);
});
