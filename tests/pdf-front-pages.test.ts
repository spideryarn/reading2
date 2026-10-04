/**
 * **`frontPagesWithStamps`** — the text layer of a PDF's first pages, one
 * record a page, with the sideways runs kept (src/pdf.ts).
 *
 * `firstPagesText` drops sideways text on purpose, and tests/paper-metadata.test.ts
 * holds it to that on this same file. The backfill wants the opposite: arXiv's
 * margin stamp is the paper's own identifier.
 * docs/plans/261004h-…-and-the-registry-backfill.md § F4.
 *
 * A real text-layer PDF, no model, no network.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ownIdsOfPdf } from "../src/article-registry.js";
import { frontPageRecord, frontPagesWithStamps } from "../src/pdf.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const ARXIV = path.join(ROOT, "evals/pdf/titles/arxiv-arnn-eeg-stamp/source.pdf");
const SHORT = path.join(ROOT, "evals/pdf/titles/injection-adversary/source.pdf");

describe("frontPagesWithStamps", () => {
  it("returns one record a page for the first two pages of a real paper", async () => {
    const bytes = new Uint8Array(fs.readFileSync(ARXIV));
    const pages = await frontPagesWithStamps(bytes, { pages: 2 });
    expect(pages.map((p) => p.page)).toEqual([1, 2]);
    expect(pages[0]?.text).toContain("ARNN: Attentive Recurrent Neural Network");
    /* The caller's buffer is not detached by pdf.js. */
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("keeps arXiv's sideways stamp, whole, so the paper's own id is found", async () => {
    const pages = await frontPagesWithStamps(new Uint8Array(fs.readFileSync(ARXIV)), { pages: 2 });
    expect(pages[0]?.text).toContain("arXiv:2403.03276");
    expect(ownIdsOfPdf(pages)).toContain("arxiv:2403.03276");
  });

  it("stops at the last page of a short document", async () => {
    const bytes = new Uint8Array(fs.readFileSync(SHORT));
    const one = await frontPagesWithStamps(bytes, { pages: 1 });
    const many = await frontPagesWithStamps(bytes, { pages: 50 });
    expect(one).toHaveLength(1);
    expect(many.length).toBeGreaterThanOrEqual(1);
    expect(many.length).toBeLessThan(50);
    expect(many[0]).toEqual(one[0]);
  });

  it("throws when pdf.js cannot open the bytes", async () => {
    await expect(
      frontPagesWithStamps(new TextEncoder().encode("this is not a PDF"), { pages: 2 }),
    ).rejects.toMatchObject({ name: "InvalidPDFException" });
  });
});

describe("frontPageRecord", () => {
  const upright = [12, 0, 0, 12, 72, 700];
  const rotated = [0, 12, -12, 0, 20, 300];

  it("puts sideways runs after the upright text, on a line of their own", () => {
    const record = frontPageRecord(1, [
      { str: "Layer normaliza", transform: upright, hasEOL: false },
      { str: "arXiv:1607.06450v1 [stat.ML] 21 Jul 2016", transform: rotated, hasEOL: false },
      { str: "tion", transform: upright, hasEOL: true },
    ]);
    expect(record).toEqual({ page: 1, text: "Layer normalization\narXiv:1607.06450v1 [stat.ML] 21 Jul 2016" });
  });

  it("is the upright text alone when nothing is sideways", () => {
    expect(frontPageRecord(3, [{ str: "Plain  text", transform: upright, hasEOL: false }])).toEqual({
      page: 3,
      text: "Plain text",
    });
  });

  it("skips an item that is not a text run", () => {
    expect(frontPageRecord(1, [{ type: "beginMarkedContent" }, { str: "x", transform: upright, hasEOL: false }]).text).toBe("x");
  });
});
