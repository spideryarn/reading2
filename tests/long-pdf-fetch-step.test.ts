/**
 * **Stage 1 prices a long PDF before anything paid begins** — the fetch step's
 * half of plan 261020b, through the upload path with a real PDF of N pages.
 *
 * - **The count reaches the pricing**, before the upload is promoted to
 *   `verified`: a refusal leaves the record `claimed`, so a Retry once the
 *   allowance grows can still promote it, and nothing is stored under the
 *   canonical name.
 * - **The warning is persisted**, in the step's own detail: *This PDF is 150
 *   pages, so it uses 3 of your articles (one for every 50 pages).*
 * - **The manifest carries `pages`**, which rule 4 and stage 2 read.
 * - **One slot, nothing to say**: a 50-page PDF is priced and warned of nothing;
 *   with no pricing callback (a command line, a test) nothing is charged.
 *
 * The ledger behind the callback is tests/billing-long-documents-db.test.ts;
 * here it is a stub, so this file is about where the step calls it.
 */
import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { StagePricing } from "../src/billing/admission.js";
import { closeDb, getDb } from "../src/db/client.js";
import { STEPS } from "../src/pipeline.js";
import type { StepContext } from "../src/pipeline.js";
import { canonicalKey, stagingKey } from "../src/source.js";
import { blobStore, CONTENT_TYPE } from "../src/store/blobs.js";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import { claimUpload, forgetUpload, mintUpload, readUpload } from "../src/upload-records.js";
import { memoryArtefacts } from "./helpers/memory-artefacts.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

const blobs = blobStore();
const artefacts = memoryArtefacts();

/** This file's own uuid (tests/fixture-ids.test.ts refuses two files sharing one). */
const OWNER = "33333333-3333-4333-8333-3333000ba5e5";

await pgReady({ suite: "tests/long-pdf-fetch-step.test.ts", tables: ["spideryarn.uploads", "auth.users"] });

beforeAll(async () => {
  await seedAuthUser(getDb(), { id: OWNER, email: "long-pdf-fetch@example.invalid", onConflictDoNothing: true });
});

const rubbish: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const undo of rubbish.splice(0)) await undo();
});

afterAll(async () => {
  await getDb().execute(sql`delete from auth.users where id = ${OWNER}::uuid`);
  await closeDb();
});

async function pdfWithPages(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  /* A distinct title per call, so two files of one length are two objects. */
  doc.setTitle(`long-pdf-${count}-${Math.random()}`);
  for (let i = 0; i < count; i++) doc.addPage([200, 200]);
  return doc.save();
}

const shaOf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** An upload minted, claimed and in staging, and a context whose pricing is `answer`. */
async function readyToVerify(bytes: Uint8Array, answer?: (pages: number) => StagePricing) {
  const minted = await mintUpload(
    { filename: "book.pdf", bytes: bytes.byteLength, sha256: shaOf(bytes), owner: OWNER },
    async (key) => ({ url: `https://x.test/${key}`, expiresAt: new Date(Date.now() + 3600_000).toISOString() }),
    stagingKey,
  );
  const id = minted.record.id;
  rubbish.push(() => forgetUpload(id));
  rubbish.push(() => blobs.remove(stagingKey(id)));
  rubbish.push(() => blobs.remove(canonicalKey(shaOf(bytes), "pdf")));
  await claimUpload(id);
  await blobs.putIfAbsent(stagingKey(id), bytes, CONTENT_TYPE.pdf);

  const asked: { pages: number; previous: number | null }[] = [];
  const ctx: StepContext = {
    slug: `test-long-pdf-${id.slice(0, 8)}`,
    upload: { id, filename: "book.pdf" },
    report: () => {},
    preview: () => {},
    signal: new AbortController().signal,
    cacheArticle: false,
    power: "standard",
    ...(answer
      ? {
          priceFetchedPdf: async (pages: number, previous: number | null) => {
            asked.push({ pages, previous });
            /* Asked before the promotion, which is the whole point. */
            expect((await readUpload(id))?.status).toBe("claimed");
            return answer(pages);
          },
        }
      : {}),
  };
  return { id, ctx, asked };
}

describe("the fetch step prices a long PDF before anything paid begins", () => {
  it("priced at 3 slots: the detail says so, and the manifest carries the pages", async () => {
    const bytes = await pdfWithPages(150);
    const { ctx, asked } = await readyToVerify(bytes, (pages) => ({ kind: "priced", slots: 3, pages }));
    const product = await STEPS.fetch.run(ctx, artefacts, nullCheckpointStore());
    expect(asked).toEqual([{ pages: 150, previous: null }]);
    expect(product.detail).toContain("This PDF is 150 pages, so it uses 3 of your articles (one for every 50 pages).");
    expect(product.parts?.raw?.pages).toBe(150);
  });

  it("refused: throws the long-PDF sentence, leaves the upload claimed, stores nothing canonical", async () => {
    const bytes = await pdfWithPages(250);
    const { id, ctx } = await readyToVerify(bytes, (pages) => ({
      kind: "refused",
      slots: 5,
      pages,
      slotsLeft: 2,
      refusal: { kind: "refused", used: 1, limit: 3 as never },
    }));
    await expect(STEPS.fetch.run(ctx, artefacts, nullCheckpointStore())).rejects.toThrow(
      /This PDF is 250 pages, which counts as 5 articles, and your account has 2 left\..*\[pay-pages\]/,
    );
    expect((await readUpload(id))?.status).toBe("claimed");
    expect(await blobs.head(canonicalKey(shaOf(bytes), "pdf"))).toBeFalsy();
  });

  it("a re-run that grew is refused with its own sentence", async () => {
    const bytes = await pdfWithPages(120);
    const { ctx } = await readyToVerify(bytes, (pages) => ({ kind: "refused-rerun", slots: 3, paidSlots: 1, pages }));
    await expect(STEPS.fetch.run(ctx, artefacts, nullCheckpointStore())).rejects.toThrow(/\[pdf-rerun-pages\]/);
  });

  it("one slot, or a minimal paper, or the administrator: no warning", async () => {
    for (const answer of [
      (pages: number): StagePricing => ({ kind: "priced", slots: 1, pages }),
      (): StagePricing => ({ kind: "minimal" }),
      (): StagePricing => ({ kind: "unpriced" }),
    ]) {
      const bytes = await pdfWithPages(50);
      const { ctx } = await readyToVerify(bytes, answer);
      const product = await STEPS.fetch.run(ctx, artefacts, nullCheckpointStore());
      expect(product.detail).not.toMatch(/uses \d+ of your articles/);
      expect(product.parts?.raw?.pages).toBe(50);
    }
  });

  it("with no pricing callback nothing is asked, and the manifest still carries the pages", async () => {
    const bytes = await pdfWithPages(120);
    const { ctx } = await readyToVerify(bytes);
    const product = await STEPS.fetch.run(ctx, artefacts, nullCheckpointStore());
    expect(product.detail).not.toMatch(/uses \d+ of your articles/);
    expect(product.parts?.raw?.pages).toBe(120);
  });
});
