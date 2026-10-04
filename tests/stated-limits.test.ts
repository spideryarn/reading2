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
 * No database, no network, no model: the documents are synthetic
 * (tests/helpers/synthetic-blocks.ts) and the functions are the real ones.
 *
 * Each assertion was watched red once, by the perturbation named beside it.
 */
import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { beforeAll, describe, expect, it } from "vitest";

import { POSTGRES_MAX_PARAMETERS, inBatches, rowsPerStatement } from "../src/db/insert-batches.js";
import { blockIdentities, revisionBlocks } from "../src/db/schema.js";
import { wholeDocumentRequest } from "../src/structure.js";
import { TooLongForOnePass } from "../src/token-budget.js";
import type { Block } from "../src/types.js";
import { MAX_PAGES, MAX_UPLOAD_BYTES, uploadLimits } from "../src/uploads.js";
import { DENSITIES, plainBlocks } from "./helpers/synthetic-blocks.js";

const density = (name: string) => {
  const found = DENSITIES.find((d) => d.name === name);
  if (!found) throw new Error(`no synthetic density called "${name}"`);
  return found;
};
const DENSE = density("dense paper");
const HEADINGLESS = density("headingless prose");

/** The most headingless blocks the structure step takes in one pass. Measured, 2026-10-04. */
const MOST_HEADINGLESS_BLOCKS = 2889;
/** The most pages of a paper as dense as Kuhn's that it takes. Measured, 2026-10-04. */
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

  it("says the sentence these tests are about", () => {
    /* Red by changing MAX_PAGES to 251 in src/uploads.ts. */
    expect(uploadLimits()).toBe("PDF or web page, up to 50 MB. PDFs up to 250 pages.");
    expect(MAX_PAGES).toBe(250);
    expect(MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024);
  });

  it("structure takes 2,889 blocks of headingless prose in one pass and refuses 2,890", () => {
    /* Red by pinning 2,888 (the second line fails) and 2,890 (the first). */
    expect(accepts(headingless.slice(0, MOST_HEADINGLESS_BLOCKS))).toBe(true);
    expect(() => wholeDocumentRequest(headingless.slice(0, MOST_HEADINGLESS_BLOCKS + 1))).toThrow(TooLongForOnePass);
  });

  it("KNOWN GAP: a paper as dense as Kuhn's is refused by structure past about 178 pages, short of the 250 stated", () => {
    /* **This is a promise the dialog makes and the structure step does not
       keep, pinned so it cannot be forgotten — not a behaviour anybody wants.**
       A PDF of 179 to 250 pages at this density (14.4 blocks and 1.8 headings a
       page: Kuhn, 142 pages, the one dense paper measured) passes the page cap,
       is transcribed and paid for, and is then refused as `[ai-too-long]`.

       The ways out, and whose call it is, are
       docs/plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md
       § The decision this will probably end on.

       **If this went red because the ceiling was lifted**, good: delete the gap
       from this test, and update that plan, the investigation it names and the
       sentence in `uploadLimits()` so that the stated-limits story is true
       again. If it went red because the ceiling fell, the gap got wider and the
       same people need telling.

       The page count is found here, not typed in. Red by pinning 177 and 179. */
    let most = 0;
    for (let pages = 1; pages <= MAX_PAGES; pages++) {
      if (!accepts(densePages(pages))) break;
      most = pages;
    }
    expect(most).toBe(MOST_DENSE_PAGES);
    expect(most, "the gap between the stated cap and what structure accepts").toBeLessThan(MAX_PAGES);
    /* And the stated cap itself is refused: the first refusal was a ceiling,
       not a hole. Both of these two red by setting MAX_PAGES to 178. */
    expect(accepts(densePages(MAX_PAGES))).toBe(false);
  });

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
