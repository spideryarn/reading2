/**
 * The scorer's own tests — docs/plans/pdf-ingestion.md#the-eval-evalspdf.
 *
 * Every case is a *deliberately broken transcription* of a hand-written page
 * pair in evals/pdf/synthetic/faults.json, one per way a model gets a page
 * wrong. No model, no network, no PDF: the point is that the check can be
 * trusted before it is ever pointed at a real one, because a scorer calibrated
 * against real output is calibrated against whatever that output happened to do.
 *
 * The fixture carries a `because` line per candidate. When one of these fails,
 * read that line first — it says what the case was written to catch.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { Pass0, PdfRecord } from "../src/pdf.js";
import { check, coverageOf, scorePage, THRESHOLDS } from "../src/pdf-score.js";

interface Fixture {
  pages: { page: number; text: string }[];
  candidates: { name: string; expect: "pass" | "fail"; because: string; records: PdfRecord[] }[];
}

const fixture: Fixture = JSON.parse(
  await readFile(new URL("../evals/pdf/synthetic/faults.json", import.meta.url), "utf-8"),
);

/** Pass 0 as it would be for a born-digital page pair: real text, nothing repeating. */
const pass: Pass0 = {
  pages: fixture.pages.map((p) => ({
    page: p.page,
    text: p.text,
    words: p.text.split(/\s+/).length,
    items: [],
  })),
  isScan: false,
  furniture: new Set(),
};

const REQUESTED = [1, 2];

describe("every way a transcription goes wrong, and the two that are tolerated", () => {
  for (const candidate of fixture.candidates) {
    it(`${candidate.expect}es: ${candidate.name}`, () => {
      const result = check(candidate.records, REQUESTED, pass);
      expect(result.ok, `${candidate.because}\n${result.failures.join("\n")}`).toBe(
        candidate.expect === "pass",
      );
    });
  }
});

const only = (name: string) => {
  const found = fixture.candidates.find((c) => c.name === name);
  if (!found) throw new Error(`no candidate named ${name}`);
  return found.records;
};

describe("what each failure actually says", () => {
  it("names the page that has no records, rather than skipping it", () => {
    const result = check(only("page 2 emitted nowhere"), REQUESTED, pass);
    expect(result.coverage.missing).toEqual([2]);
    expect(result.failures[0]).toBe("No records at all for page 2.");
  });

  it("does not let a record with no text in it satisfy the page", () => {
    const result = check(only("page 2 present but empty"), REQUESTED, pass);
    expect(result.coverage.missing).toEqual([]);
    expect(result.coverage.blank).toEqual([2]);
  });

  it("says the document does not have the page a record claims", () => {
    const result = check(only("claims page 19 of a two-page document"), REQUESTED, pass);
    expect(result.coverage.impossible).toEqual([19]);
    expect(result.failures).toContain("Records claim page 19, and the document has 2 pages.");
  });

  it("tells a numbering fault from a reading fault", () => {
    const result = check(only("page numbers swapped"), REQUESTED, pass);
    expect(result.failures.join(" ")).toContain("looks like a numbering fault, not a reading one");
  });

  it("names the altered date, which no ratio would have noticed", () => {
    const result = check(only("a date altered"), REQUESTED, pass);
    const page1 = result.pages.find((p) => p.page === 1)!;
    expect(page1.invented).toEqual(["1863–79"]);
    expect(page1.recall!).toBeGreaterThan(THRESHOLDS.recall);
  });

  it("reports the deleted sentence as a run of missing words", () => {
    const result = check(only("one sentence deleted"), REQUESTED, pass);
    const page2 = result.pages.find((p) => p.page === 2)!;
    expect(page2.spans[0]!.words).toBeGreaterThanOrEqual(13);
    expect(page2.spans[0]!.text).toContain("govern his tongue");
  });
});

describe("what a ratio cannot see", () => {
  it("catches markup on a page whose every word is right", () => {
    const result = check(only("markdown emitted instead of text"), REQUESTED, pass);
    const page1 = result.pages.find((p) => p.page === 1)!;
    expect(page1.recall).toBe(1);
    expect(page1.markup).toContain("**materialism**");
  });

  it("does not confuse dash style with a wrong number", () => {
    const result = check(only("a dash written the typewriter way"), REQUESTED, pass);
    expect(result.pages.flatMap((p) => p.invented)).toEqual([]);
  });
});

describe("the two numbers that must not measure the same thing", () => {
  it("scores order badly and recall perfectly when the columns are read across", () => {
    const result = check(only("two columns read straight across"), REQUESTED, pass);
    const page2 = result.pages.find((p) => p.page === 2)!;
    expect(page2.recall).toBe(1);
    expect(page2.order!).toBeLessThan(0.7);
  });

  it("leaves order alone when the fault is omission, because that is recall's job", () => {
    const base = ["one", "two", "three", "four", "five", "six", "seven", "eight"];
    const half: PdfRecord[] = [
      { page: 1, type: "paragraph", text: "one two three four", continues: false, uncertain: false },
    ];
    const score = scorePage(1, [base.join(" ")], half);
    expect(score.recall).toBe(0.5);
    expect(score.order).toBe(1);
  });
});

describe("the scan, where there is nothing to check against", () => {
  const scanned: Pass0 = { pages: [{ page: 1, text: "", words: 0, items: [] }], isScan: true, furniture: new Set() };

  it("returns null rather than a perfect score for a page it cannot check", () => {
    const score = scorePage(
      1,
      [],
      [{ page: 1, type: "paragraph", text: "anything at all", continues: false, uncertain: false }],
    );
    expect(score.recall).toBeNull();
    expect(score.precision).toBeNull();
    expect(score.order).toBeNull();
  });

  it("still asserts the page set, which is the only check a scan gets", () => {
    expect(coverageOf([], [1], scanned).missing).toEqual([1]);
    const ok = check(
      [{ page: 1, type: "paragraph", text: "something legible", continues: false, uncertain: false }],
      [1],
      scanned,
    );
    expect(ok.ok).toBe(true);
    expect(ok.pages[0]!.recall).toBeNull();
  });
});
