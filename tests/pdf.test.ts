/**
 * Pass 0 — src/pdf.ts. Everything here is deterministic: no model, no network,
 * three PDFs committed under evals/pdf/ with their licences.
 *
 * What it is protecting is the *baseline*, which is the only thing that can
 * tell a transcribed page from a plausible one. See
 * docs/plans/pdf-ingestion.md and evals/pdf/README.md.
 */
import { describe, expect, it } from "vitest";
import { baselineFor, foldLine, pass0, repeatedLines } from "../src/pdf.js";

const EASY = "evals/pdf/easy/source.pdf";
const HARDER = "evals/pdf/harder/source.pdf";
const SCAN = "evals/pdf/much-harder/source.pdf";

describe("pass0 on a born-digital paper", () => {
  it("reads every page, and does not think it is a scan", async () => {
    const { pages, isScan } = await pass0(EASY);
    expect(pages.length).toBe(8);
    expect(isScan).toBe(false);
    expect(pages.every((p) => p.words > 200)).toBe(true);
  });

  it("finds the running header, and keeps it out of the baseline", async () => {
    // The model is told to drop running headers. If they stay in the baseline,
    // a correct transcription loses recall for obeying its instructions — and
    // the threshold then gets widened until it stops catching anything.
    const pass = await pass0(EASY);
    expect([...pass.furniture].some((l) => l.includes("coolabah"))).toBe(true);
    const baseline = baselineFor(pass, 1).join(" ");
    expect(baseline).not.toContain("Coolabah, Vol.3");
    expect(baseline).toContain("Forms of Memory in Post-colonial Australia");
  });
});

describe("pass0 on a two-column paper", () => {
  it("finds the journal's running header on every page it is on", async () => {
    const { pages, furniture, isScan } = await pass0(HARDER);
    expect(pages.length).toBe(14);
    expect(isScan).toBe(false);
    expect([...furniture].some((l) => l.includes("ball lightning observations"))).toBe(true);
  });
});

describe("pass0 on a photographic scan", () => {
  it("calls it a scan even though one page has text on it", async () => {
    // The trap: Wellcome generates a rights page with 95 words of its own, and
    // it is the only text in the file. "Every page is empty" answers that this
    // 17-page scan is not a scan.
    const { pages, isScan } = await pass0(SCAN);
    expect(pages.length).toBe(17);
    expect(pages.filter((p) => p.words > 0).length).toBe(1);
    expect(isScan).toBe(true);
  });

  it("gives a content page an empty baseline, which is the whole problem", async () => {
    const pass = await pass0(SCAN);
    expect(baselineFor(pass, 5)).toEqual([]);
  });
});

describe("the furniture fold", () => {
  it("drops the digits, because the page number is the part that changes", () => {
    expect(foldLine("Coolabah, Vol.3, 2009, ISSN 1988-5946")).toBe(foldLine("Coolabah, Vol.9, 2015, ISSN 1988-5946"));
  });

  it("counts a line once per page, so a refrain is not furniture", () => {
    // Three occurrences on one page is the author repeating themselves. Three
    // pages carrying it is a header.
    const refrain = { text: "and so it goes\nand so it goes\nand so it goes" };
    expect(repeatedLines([refrain, { text: "something else entirely" }]).size).toBe(0);
    expect(repeatedLines([{ text: "and so it goes" }, { text: "and so it goes" }, { text: "and so it goes" }]).size).toBe(1);
  });

  it("ignores lines too short to be a header", () => {
    const page = { text: "42" };
    expect(repeatedLines([page, page, page, page]).size).toBe(0);
  });
});

describe("the baseline has been told the same things the model was", () => {
  it("joins a word the page broke across a line, because the model is told to", async () => {
    const pass = await pass0(EASY);
    const page8 = baselineFor(pass, 8).join(" ");
    /* The `easy` fixture prints a citation URL broken at `…/27/rock-` /
       `waga.html`. A model that obeys rule 2 returns it joined, and the first
       version of this baseline then had no token matching what it returned —
       so a correct transcription lost recall and a real one was accused of
       inventing a URL. src/pdf.ts § mendHyphens. */
    expect(page8).toContain("rockwaga.html");
    expect(page8).not.toContain("rock-");
  });
});

