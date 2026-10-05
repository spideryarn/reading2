/**
 * The limits the upload dialog states, against what the code after it accepts.
 *
 * `uploadLimits()` (src/uploads.ts) promises "up to 50 MB" and "PDFs up to 250
 * pages". Nothing tied those two numbers to the budgets further down the
 * pipeline, so a cap could be raised — 100 pages to 250, on 2026-09-04 — with
 * nobody asked whether a 250-page document gets through. These are
 * characterisation tests: each pins a number measured on 2026-10-04
 * (scripts/eval-big-imports.ts, docs/plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md)
 * so that moving a cap or a budget turns one red and makes somebody face the
 * other. **A red test here is not a bug report. It is the question "is the
 * sentence in the dialog still true?"**
 *
 * Since 2026-10-05 it is, for structure: a document whose table of contents
 * will not fit one model answer is asked about in slices
 * (src/structure-slices.ts), and when those do not make a tree it is given one
 * built from its own headings instead of being refused
 * (src/heading-tree.ts § `buildBoundedHeadingTree`,
 * docs/plans/261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md).
 * The two numbers below that used to be ceilings are now where the path
 * changes, and they stay pinned for that reason.
 *
 * No database and no network: the documents are synthetic
 * (tests/helpers/synthetic-blocks.ts) and the functions are the real ones. The
 * model seam is a switch. Off, every call throws, which is a model that never
 * answers; on, it answers each request over the blocks in it
 * (tests/helpers/slice-model.ts).
 *
 * Each assertion was watched red once, by the perturbation named beside it.
 */
import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POSTGRES_MAX_PARAMETERS, inBatches, rowsPerStatement } from "../src/db/insert-batches.js";
import { blockIdentities, revisionBlocks } from "../src/db/schema.js";
import { BOUNDED_TREE_GENERATOR } from "../src/heading-tree.js";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import { generatorFor } from "../src/models.js";
import { generateStructure, wholeDocumentRequest } from "../src/structure.js";
import { TooLongForOnePass } from "../src/token-budget.js";
import { checkTree } from "../src/tree-invariants.js";
import type { Block } from "../src/types.js";
import { MAX_PAGES, MAX_UPLOAD_BYTES, uploadLimits } from "../src/uploads.js";
import { expectBoundedTree, expectPlannable } from "./helpers/bounded-tree.js";
import { askedIds, isRootCall, messageOf, ROOT_ANSWER, sectionsAnswer } from "./helpers/slice-model.js";
import { DENSITIES, plainBlocks } from "./helpers/synthetic-blocks.js";

/** Does the model answer? Off, every call to it throws. */
let modelAnswers = false;
/** How many blocks each call was shown: none of them may be the whole document. */
let shown: number[] = [];
vi.mock("../src/messages-stream.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/messages-stream.js")>()),
  streamMessage: (_task: string, params: Parameters<typeof askedIds>[0]) => {
    if (!modelAnswers) throw new Error("stated-limits: the model does not answer");
    const ids = askedIds(params);
    shown.push(ids.length);
    return {
      onText: () => {},
      finalMessage: async () => messageOf(isRootCall(params) ? ROOT_ANSWER : sectionsAnswer(ids)),
    };
  },
}));

const density = (name: string) => {
  const found = DENSITIES.find((d) => d.name === name);
  if (!found) throw new Error(`no synthetic density called "${name}"`);
  return found;
};
const DENSE = density("dense paper");
const HEADINGLESS = density("headingless prose");

/** The most headingless blocks the structure step asks a model about in one pass. Measured, 2026-10-04. */
const MOST_HEADINGLESS_BLOCKS = 2889;
/** The most pages of a paper as dense as Kuhn's that it asks a model about. Measured, 2026-10-04. */
const MOST_DENSE_PAGES = 178;

const accepts = (blocks: Block[]): boolean => {
  try {
    wholeDocumentRequest(blocks);
    return true;
  } catch (err) {
    if (err instanceof TooLongForOnePass) return false;
    throw err;
  }
};

describe("the limits the upload dialog states", () => {
  /* One stream per density; every document below is a prefix of one, which
     tests/helpers/synthetic-blocks.ts § isHeadingAt is what makes sound. */
  let headingless: Block[];
  let dense: Block[];
  const densePages = (pages: number) => dense.slice(0, Math.round(pages * DENSE.blocksPerPage));

  beforeAll(() => {
    headingless = plainBlocks(MOST_HEADINGLESS_BLOCKS + 1, HEADINGLESS).blocks;
    dense = plainBlocks(Math.round(MAX_PAGES * DENSE.blocksPerPage), DENSE).blocks;
  }, 120_000);
  beforeEach(() => {
    modelAnswers = false;
    shown = [];
  });

  it("says the sentence these tests are about", () => {
    /* Red by changing MAX_PAGES to 251 in src/uploads.ts. */
    expect(uploadLimits()).toBe("PDF or web page, up to 50 MB. PDFs up to 250 pages.");
    expect(MAX_PAGES).toBe(250);
    expect(MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024);
  });

  /** The step as the pipeline calls it, with nowhere to keep a checkpoint. */
  const structure = (blocks: Block[]) =>
    generateStructure({ blocks, slug: "stated-limits", checkpoints: nullCheckpointStore(), power: "standard" });

  /**
   * With a model that never answers: the slices were tried, every call threw,
   * the throw was not passed on, and the tree is the document's own headings,
   * sound, bounded and labellable. Nothing came back, so nothing is counted.
   */
  const expectHeadingsRun = (blocks: Block[], run: Awaited<ReturnType<typeof structure>>): void => {
    expect(run.source).toEqual({ by: "headings", reason: "answer-too-long", slicesFailed: "slice-failed" });
    expectBoundedTree(blocks, run.parts.tree);
    expectPlannable(blocks, run.parts.tree);
    expect(run.parts.tree.generator).toBe(BOUNDED_TREE_GENERATOR);
    expect(run.model).toBe(BOUNDED_TREE_GENERATOR);
    expect([run.wholeDocumentCalls, run.inputTokens, run.outputTokens]).toEqual([0, 0, 0]);
    expect([run.wholeDocumentResumed, run.deepen, run.deepenFailed]).toEqual([false, null, false]);
  };

  /**
   * With a model that answers: a finished tree like any article's, made from
   * slices, none of which was the whole document.
   */
  const expectSlicesRun = async (blocks: Block[]): Promise<void> => {
    modelAnswers = true;
    const run = await structure(blocks);
    expect(run.source).toMatchObject({ by: "slices", reasked: 0 });
    expect(checkTree(blocks, run.parts.tree).problems).toEqual([]);
    expect(run.parts.tree.provisional).toBeUndefined();
    expect(run.parts.tree.generator).toBe(generatorFor("standard"));
    expectPlannable(blocks, run.parts.tree);
    expect(shown.length).toBe(run.wholeDocumentCalls);
    expect(Math.max(...shown)).toBeLessThan(blocks.length / 2);
    expect(shown.reduce((a, b) => a + b, 0)).toBe(blocks.length);
  };

  it("one model answer holds 2,889 blocks of headingless prose and not 2,890", () => {
    /* Where the path changes, no longer where a document stops. Red by pinning
       2,888 (the second line fails) and 2,890 (the first). */
    expect(accepts(headingless.slice(0, MOST_HEADINGLESS_BLOCKS))).toBe(true);
    expect(() => wholeDocumentRequest(headingless.slice(0, MOST_HEADINGLESS_BLOCKS + 1))).toThrow(TooLongForOnePass);
  });

  it("a headingless document one block past that still becomes an article", async () => {
    /* Red before the fallback existed (`TooLongForOnePass` out of
       `generateStructure`), and by stamping the model's name on the tree. */
    const blocks = headingless.slice(0, MOST_HEADINGLESS_BLOCKS + 1);
    expectHeadingsRun(blocks, await structure(blocks));
    /* Red by returning the headings tree without trying the slices. */
    await expectSlicesRun(blocks);
  }, 60_000);

  it("a paper as dense as Kuhn's passes one answer at about 178 pages, and still becomes an article at the 250 stated", async () => {
    /* A PDF of 179 to 250 pages at this density (14.4 blocks and 1.8 headings
       a page: Kuhn, 142 pages, the one dense paper measured) was transcribed,
       paid for and then refused as `[ai-too-long]` until 2026-10-05.

       The page count is found here, not typed in. Red by pinning 177 and 179. */
    let most = 0;
    for (let pages = 1; pages <= MAX_PAGES; pages++) {
      if (!accepts(densePages(pages))) break;
      most = pages;
    }
    expect(most).toBe(MOST_DENSE_PAGES);
    /* The stated cap is past it, so this document really takes the other path. */
    expect(accepts(densePages(MAX_PAGES))).toBe(false);
    const blocks = densePages(MAX_PAGES);
    expectHeadingsRun(blocks, await structure(blocks));
    await expectSlicesRun(blocks);
  }, 60_000);

  it("the store is not the first thing to refuse a long document", () => {
    /* Until 2026-10-04 it was, for a web page: one insert, 17 parameters a
       block, 65,535 allowed, so 3,855 blocks wrote and 3,856 did not
       (src/db/insert-batches.ts). The round trip through Postgres is
       tests/store-artefacts-pg.test.ts § "writes an article of 4,000 blocks";
       this is the arithmetic that keeps it true when a column is added.

       **What Drizzle really binds for one full batch, counted**, for each table
       `writeBlocks` batches — with every column the row can carry set, so the
       count is the worst case. Red by dividing by 10 instead of by the column
       count in `rowsPerStatement`, and by returning 40,000 for the identities. */
    const db = drizzle.mock();
    const nil = "00000000-0000-4000-8000-000000000000";
    const blockRow = {
      articleId: nil,
      revisionId: nil,
      blockId: "spya-aaaaa2",
      ordinal: 0,
      tag: "p",
      kind: "text" as const,
      level: 1,
      text: "t",
      words: 1,
      html: "<p>t</p>",
      gistable: true,
      note: "n",
      role: "reference" as const,
      treatment: "supplement" as const,
      noteId: "1",
      contextId: "c",
      contextType: "callout",
    };
    const identityRow = { articleId: nil, blockId: "spya-aaaaa2" };
    const full = <T>(row: T, rowsEach: number): T[] => Array.from({ length: rowsEach }, () => row);
    const bound = {
      blocks: db.insert(revisionBlocks).values(full(blockRow, rowsPerStatement(revisionBlocks))).toSQL().params.length,
      identities: db.insert(blockIdentities).values(full(identityRow, rowsPerStatement(blockIdentities))).toSQL().params
        .length,
    };
    expect(bound.blocks).toBeLessThanOrEqual(POSTGRES_MAX_PARAMETERS);
    expect(bound.identities).toBeLessThanOrEqual(POSTGRES_MAX_PARAMETERS);
    /* The test row really does fill the statement: a row that bound nothing
       would pass the two lines above whatever the batch size. Red by deleting
       `contextType` from the row above. */
    expect(bound.blocks).toBe(rowsPerStatement(revisionBlocks) * 17);
    expect(Object.keys(blockRow).length).toBeLessThanOrEqual(Object.keys(getTableColumns(revisionBlocks)).length);

    /* More blocks than structure will ever be asked about go in, in order, and
       no batch is longer than a statement may be. Red by dropping the last
       batch in `inBatches` (`at + size < rows.length`). */
    const rows = Array.from({ length: (MOST_HEADINGLESS_BLOCKS + 1) * 10 }, (_, i) => i);
    const batches = inBatches(revisionBlocks, rows);
    expect(batches.flat()).toEqual(rows);
    expect(Math.max(...batches.map((b) => b.length))).toBeLessThanOrEqual(rowsPerStatement(revisionBlocks));
  });
});
