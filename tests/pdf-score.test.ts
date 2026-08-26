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
  metaTitle: null,
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

  it("still catches pages swapped end to end, on order", () => {
    /* This used to be caught by a ±1 neighbour re-score whose job was to say
       "read well, labelled badly". Gating on the chunk answers that before it
       is asked, so what is left is the honest signal: the words are all there
       and they are in the wrong sequence. */
    const result = check(only("page numbers swapped"), REQUESTED, pass);
    expect(result.ok).toBe(false);
    expect(result.overall.recall).toBe(1);
    expect(result.overall.order!).toBeLessThan(0.8);
  });

  it("does not mind which side of a page break a paragraph was filed under", () => {
    /* The failure this replaced a per-page gate for: on the `harder` fixture a
       sentence the text layer splits mid-word came back attached to the
       previous page, and a word-perfect chunk failed twice — a 114-word
       missing run on one page and five invented numbers on the other. */
    const moved = only("verbatim").map((r) => (r.page === 2 ? { ...r, page: 1 } : r));
    const result = check(moved, REQUESTED, pass);
    expect(result.coverage.missing).toEqual([2]);
    expect(result.overall.recall).toBe(1);
    expect(result.overall.spans).toEqual([]);
    expect(result.overall.invented).toEqual([]);
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

describe("a short page cannot be paid for by a long one", () => {
  /* GPT Sol's probe, verbatim in shape: a 100-word page with every eighth word
     kept, then a perfect 2,700-word page. The chunk averages to 0.969 and the
     small page is at 0.130. src/pdf-score.ts § thinPages. */
  const short = Array.from({ length: 100 }, (_, i) => `alpha${i}`);
  const long = Array.from({ length: 2700 }, (_, i) => `beta${i}`);
  const twoPages: Pass0 = {
    pages: [
      { page: 1, text: short.join(" "), words: short.length, items: [] },
      { page: 2, text: long.join(" "), words: long.length, items: [] },
    ],
    metaTitle: null,
    isScan: false,
    furniture: new Set(),
  };
  const records: PdfRecord[] = [
    {
      page: 1,
      type: "paragraph",
      text: short.filter((_, i) => i % 8 === 0).join(" "),
      continues: false,
      uncertain: false,
    },
    { page: 2, type: "paragraph", text: long.join(" "), continues: false, uncertain: false },
  ];

  it("fails, and names the page rather than the chunk", () => {
    const result = check(records, [1, 2], twoPages);
    expect(result.overall.recall!).toBeGreaterThan(THRESHOLDS.recall);
    expect(result.ok).toBe(false);
    expect(result.failures.join(" ")).toContain("Page 1: only 0.13 of its words");
  });

  it("does not fire when the words are merely filed under the neighbour", () => {
    /* The case the chunk-level gate exists for: page 1's text attributed to
       page 2. Every word is in the chunk, so the floor must stay quiet. */
    const moved: PdfRecord[] = [
      { page: 1, type: "paragraph", text: "", continues: false, uncertain: false },
      {
        page: 2,
        type: "paragraph",
        text: `${short.join(" ")} ${long.join(" ")}`,
        continues: false,
        uncertain: false,
      },
    ];
    const result = check(moved, [1, 2], twoPages);
    expect(result.failures.filter((f) => f.includes("appear anywhere in this chunk"))).toEqual([]);
  });
});

describe("long tokens the page broke across a line, and the page break", () => {
  /* All three observed on the `harder` fixture, all three reported as invented
     by a correct transcription. The whole-token matching that fixed `2012 → 12`
     is what broke them: the old packed-string `includes` tolerated any split at
     all, and tolerated a truncated number with it. src/pdf-score.ts. */
  const page = (text: string): Pass0 => ({
    pages: [{ page: 1, text, words: text.split(/\s+/).length, items: [] }],
    metaTitle: null,
    isScan: false,
    furniture: new Set(),
  });
  const said = (text: string): PdfRecord[] => [
    { page: 1, type: "paragraph", text, continues: false, uncertain: false },
  ];

  it("accepts a range the page broke after its dash", () => {
    /* Page 3 ends "a British military meteorologist, 1936–" and page 4 begins
       "1940". The model joined it, correctly. */
    const pass = page("James Durward, a British military meteorologist, 1936–\n1940, saw one.");
    const result = check(said("James Durward, a British military meteorologist, 1936–1940, saw one."), [1], pass);
    expect(result.pages[0]!.invented).toEqual([]);
  });

  it("accepts a URL the page broke over three lines with no hyphen at all", () => {
    const printed =
      "See https://bildsuche.\ndigitale-sammlungen.de/index.html?c=viewer&bandnummer=\nbsb00081185&pimage=00443&lv=1&v=100&l=de#, last access: 2021.";
    const joined =
      "See https://bildsuche.digitale-sammlungen.de/index.html?c=viewer&bandnummer=bsb00081185&pimage=00443&lv=1&v=100&l=de#, last access: 2021.";
    expect(check(said(joined), [1], page(printed)).pages[0]!.invented).toEqual([]);
  });

  it("still refuses a year the model shortened", () => {
    /* The property the joins must not cost: joining adjacent tokens only ever
       makes the haystack LONGER, so a truncated number still matches nothing. */
    const pass = page("In 1843–79 the society fell from 214 members to 47.");
    expect(check(said("In 43–79 the society fell from 214 members to 47."), [1], pass).pages[0]!.invented).toEqual(["43–79"]);
  });
});

describe("what the check says it checked", () => {
  it("does not count a page it could not check", () => {
    /* `meta.pagesChecked` is shown to a reader. "8 of 8" for a document where a
       page was skipped is worse than no number at all. */
    const scanned: Pass0 = {
      pages: [
        { page: 1, text: "Some real words on a rights page.", words: 7, items: [] },
        { page: 2, text: "", words: 0, items: [] },
      ],
      isScan: true,
      metaTitle: null,
      furniture: new Set(),
    };
    const records: PdfRecord[] = [
      { page: 1, type: "cover", text: "Some real words on a rights page.", continues: false, uncertain: false },
      { page: 2, type: "paragraph", text: "Whatever the model read here.", continues: false, uncertain: false },
    ];
    expect(check(records, [1, 2], scanned).scored).toEqual([1]);
  });

  it("says out loud that a trailing bibliography was left out", () => {
    const result = check(only("verbatim"), REQUESTED, pass, { unchecked: [2] });
    expect(result.scored).toEqual([1]);
    expect(result.notes.join(" ")).toContain("Body text on them is unchecked");
  });
});

describe("the scan, where there is nothing to check against", () => {
  const scanned: Pass0 = { pages: [{ page: 1, text: "", words: 0, items: [] }], isScan: true, metaTitle: null,
      furniture: new Set() };

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
