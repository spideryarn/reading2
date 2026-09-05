/**
 * **Where the front-matter pass sits in the stage, which is the half of it that
 * can go wrong quietly.** The pass itself is tested in
 * `tests/pdf-frontmatter.test.ts`; this file is about the order around it.
 *
 * Three things have to be true at once and only one of them is obvious:
 *
 * 1. an accepted title outranks the ladder, and an accepted byline reaches
 *    `meta.byline` — which no PDF has ever had;
 * 2. hiding happens **before the render**, so the prose either side of a hidden
 *    line stops being joined to it *and does not itself go missing*. The
 *    Elsevier paper is the case: `Available online 26 January 2024` renders
 *    joined onto the article paragraph that follows it.
 *
 *    **What this file does not prove**, and an earlier version of this comment
 *    claimed: that hiding must precede `mendSeamHyphens` specifically. That
 *    function only acts across a page boundary, both records here are on page 1,
 *    and GPT Sol reproduced identical output with the two operations reversed
 *    (2026-09-05). Production keeps the safe order for consistency — see
 *    `runPdfExtract` — and nobody has built the case that would tell them apart;
 * 3. none of it touches the score. `recall`, `pagesChecked` and the quality
 *    notes are about what the transcription model wrote, and this pass runs
 *    after they are settled.
 *
 * Both readers are stubs, so nothing here spends.
 * docs/plans/260905b-pdf-front-matter-and-the-title-it-stole.md
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { pass0, type PdfRecord } from "../src/pdf.js";
import type { FrontMatterAnswer, FrontMatterReader } from "../src/pdf-frontmatter.js";
import { type PdfReader, runPdfExtract } from "../src/pdf-read.js";
import { memoryCheckpoints } from "./helpers/memory-checkpoints.js";

vi.mock("../src/log.js", () => {
  const fake = (): unknown => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => fake(),
  });
  return {
    log: () => fake(),
    errorFields: (err: unknown) => ({ err }),
    since: (started: number) => Date.now() - started,
  };
});

const EASY = new URL("../evals/pdf/easy/source.pdf", import.meta.url);

/** Elsevier's opening, on page 1, with the join that has to survive being broken. */
const FRONT: PdfRecord[] = [
  { page: 1, type: "paragraph", text: "Contents lists available at ScienceDirect", continues: false, uncertain: false },
  { page: 1, type: "heading1", text: "Progress in Biophysics and Molecular Biology", continues: false, uncertain: false },
  { page: 1, type: "heading1", text: "A landscape of consciousness", continues: false, uncertain: false },
  { page: 1, type: "paragraph", text: "Robert Lawrence Kuhn", continues: false, uncertain: false },
  { page: 1, type: "paragraph", text: "Available online 26 January 2024", continues: false, uncertain: false },
  { page: 1, type: "paragraph", text: "and array them in some kind of meaningful structure.", continues: true, uncertain: false },
];

/**
 * A reader that returns `FRONT` for page 1 and the page's own text-layer lines
 * for every other page — honest enough to score, fixed enough to assert on.
 */
function stubReader(pages: { page: number; text: string }[]): PdfReader {
  return {
    id: "test/frontmatter",
    async read(_pdf, instruction) {
      /* The same reading of the instruction that `honestReader` in
         tests/pdf-read.test.ts does: every number in it, minus the context page
         at the front when there is one. */
      const asked = [...instruction.matchAll(/\d+/g)].map(Number);
      const sent = instruction.includes("included only so you can see")
        ? asked.slice(1)
        : asked;
      const wanted = [...new Set(sent)].sort((a, b) => a - b);
      const records: PdfRecord[] = [];
      for (const page of wanted) {
        if (page === 1) {
          records.push(...FRONT);
          continue;
        }
        const text = pages.find((p) => p.page === page)?.text ?? "";
        for (const line of text.split("\n").filter((l) => l.trim())) {
          records.push({ page, type: "paragraph", text: line, continues: false, uncertain: false });
        }
      }
      return { records, stripped: 0, usage: { input: 1, output: 1 }, ms: 1, finish: "stop" as const };
    },
  };
}

const frontMatterSaying = (answer: FrontMatterAnswer, onAsk?: () => void): FrontMatterReader => ({
  id: "test/front",
  usage: () => ({ input: 0, output: 0 }),
  async ask() {
    onAsk?.();
    return answer;
  },
});

async function run(frontMatter: FrontMatterReader | null) {
  const bytes = new Uint8Array(await readFile(EASY));
  const pass = await pass0(bytes);
  return runPdfExtract({
    frontMatter,
    bytes,
    url: "https://example.test/paper.pdf",
    checkpoints: memoryCheckpoints({ slug: "paper", articleId: "article-paper" }),
    slug: "paper",
    reader: stubReader(pass.pages),
  });
}

describe("the front-matter pass inside the stage", () => {
  it("takes its title over the ladder's, and gives a PDF its first byline", async () => {
    const result = await run(
      frontMatterSaying({ titleIds: ["p1-r3"], bylineIds: ["p1-r4"], publisherIds: [] }),
    );
    expect(result.meta.title).toBe("A landscape of consciousness");
    expect(result.meta.byline).toBe("Robert Lawrence Kuhn");
  });

  it("leaves the title to the ladder when the pass names none", async () => {
    const result = await run(frontMatterSaying({ titleIds: [], bylineIds: [], publisherIds: [] }));
    /* The ladder's own answer for this document, unchanged: rung 1 is refused
       (`Microsoft Word - Lyn McCreddon 1`), so rung 2 takes the first
       non-furniture `heading1` on page 1. */
    expect(result.meta.title).toBe("Progress in Biophysics and Molecular Biology");
    expect(result.meta.byline).toBeUndefined();
  });

  it("does not ask at all when it is turned off", async () => {
    let asked = 0;
    const off = await run(null);
    const on = await run(
      frontMatterSaying({ titleIds: [], bylineIds: [], publisherIds: [] }, () => asked++),
    );
    expect(asked).toBe(1);
    expect(off.meta.title).toBe(on.meta.title);
  });

  it("breaks the join onto a hidden publisher line without losing the article's words", async () => {
    /* The assertion GPT Sol asked for. `Available online 26 January 2024` is
       `p1-r5`; the sentence after it carries `continues: true`, so before this
       change the two rendered as one paragraph beginning with the date. Hiding
       the date must leave the sentence on the page. */
    const before = await run(null);
    expect(before.extractedHtml).toContain(
      "Available online 26 January 2024 and array them in some kind of meaningful structure.",
    );

    const after = await run(
      frontMatterSaying({ titleIds: ["p1-r3"], bylineIds: [], publisherIds: ["p1-r1", "p1-r2", "p1-r5"] }),
    );
    expect(after.extractedHtml).not.toContain("Available online 26 January 2024");
    expect(after.extractedHtml).not.toContain("Contents lists available at ScienceDirect");
    expect(after.extractedHtml).toContain("and array them in some kind of meaningful structure.");
  });

  it("changes nothing about the score, which is a score of what the model wrote", async () => {
    const off = await run(null);
    const on = await run(
      frontMatterSaying({ titleIds: ["p1-r3"], bylineIds: [], publisherIds: ["p1-r1", "p1-r2", "p1-r5"] }),
    );
    expect(on.recall).toBe(off.recall);
    expect(on.meta.pagesChecked).toBe(off.meta.pagesChecked);
    expect(on.meta.quality).toEqual(off.meta.quality);
    /* `transcript` is the presentation copy — what `extractedHtml` was rendered
       from — so the retyping *does* show there, and that is the point: the score
       above was taken from the originals before the clone existed. Three records
       hidden, and the same number of records either way, because hiding retypes
       and never deletes. */
    expect(on.transcript.filter((r) => r.type === "publisher")).toHaveLength(3);
    expect(on.transcript).toHaveLength(off.transcript.length);
    expect(on.records).toBe(off.records);
  });

  it("falls back to the ladder when the pass fails, rather than failing the article", async () => {
    const result = await run({
      id: "test/broken",
      usage: () => ({ input: 0, output: 0 }),
      async ask() {
        throw new Error("the provider refused");
      },
    });
    expect(result.meta.title).toBe("Progress in Biophysics and Molecular Biology");
  });

  it("lets an abort through even when the pass answered perfectly well", async () => {
    /* **The shape that got past the first version.** The caller checked
       `signal.aborted` only in its `catch`, so a reader that noticed the abort
       and *succeeded anyway* — a cached answer, a request already in flight, a
       stub — had its answer applied and the article published with
       `aborted === true`. The one path that got through was the one where
       nothing went wrong. Reproduced by GPT Sol, 2026-09-05. */
    const controller = new AbortController();
    const bytes = new Uint8Array(await readFile(EASY));
    const pass = await pass0(bytes);
    await expect(
      runPdfExtract({
        bytes,
        slug: "paper",
        checkpoints: memoryCheckpoints({ slug: "paper", articleId: "article-paper" }),
        reader: stubReader(pass.pages),
        signal: controller.signal,
        frontMatter: {
          id: "test/aborts-then-succeeds",
          usage: () => ({ input: 0, output: 0 }),
          async ask() {
            controller.abort();
            return { titleIds: ["p1-r3"], bylineIds: [], publisherIds: [] };
          },
        },
      }),
    ).rejects.toThrow();
  });

  it("lets an abort through rather than quietly publishing a worse title", async () => {
    const controller = new AbortController();
    const bytes = new Uint8Array(await readFile(EASY));
    const pass = await pass0(bytes);
    await expect(
      runPdfExtract({
        bytes,
        slug: "paper",
        checkpoints: memoryCheckpoints({ slug: "paper", articleId: "article-paper" }),
        reader: stubReader(pass.pages),
        signal: controller.signal,
        frontMatter: {
          id: "test/aborting",
          usage: () => ({ input: 0, output: 0 }),
          async ask() {
            controller.abort();
            throw new Error("aborted");
          },
        },
      }),
    ).rejects.toThrow();
  });
});
