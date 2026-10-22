/**
 * **A chunk that opens mid-sentence must open with the page's first words** —
 * the seam rule in `check` (src/pdf-score.ts).
 *
 * The case is real: Greg's import of *The Order of Time*, feedback spya-rg5kk6.
 * Page 43 is the first page of a chunk sent with page 42 as context, and its
 * first line — "realized that it was impossible to do so exactly." — finishes
 * page 42's last sentence. Production's reading lost it (the model omitted it;
 * a record labelled page 42 would have been structural and re-read), and the
 * gate passed the chunk: the run is nine common words, every one of them somewhere else in six
 * pages of output, so it counted as text that moved. The paragraph has ended
 * "…and the moment at which Einstein" ever since.
 * docs/plans/261022h-a-line-at-the-top-of-a-chunk-is-not-lost-at-the-seam.md.
 *
 * The pages are cut down and the later text of page 43 is written for the test
 * (the book is not openly licensed); it reuses the line's words further down,
 * as the real chunk does, which is what made the run look moved.
 */
import { describe, expect, it } from "vitest";
import type { Pass0, PdfRecord } from "../src/pdf.js";
import { withoutRepeats, wordsOf } from "../src/pdf-read.js";
import { check } from "../src/pdf-score.js";

const PAGE_42 = [
  "It can hardly be pure coincidence that, before gaining a university",
  "position, the young Einstein worked in the Swiss patent office.",
  "In other words, only a few years passed between the moment at which",
  "we agreed to synchronize clocks and the moment at which Einstein",
].join("\n");

const LINE = "realized that it was impossible to do so exactly.";
const LATER = [
  "For millennia before clocks, our only regular way of measuring time",
  "had been the alternation of day and night. Nobody realized how exactly",
  "it was done, and it was thought impossible to do it so that it held.",
  "The rhythm of day followed by night also regulates the lives of plants",
  "and animals. Diurnal rhythms are ubiquitous in the natural world, and an",
  "oscillation is required to set a mechanism in motion. Living organisms are",
  "full of clocks of various kinds, each of them more or less in tune with",
  "the others. As well as the days, we then count the years and the seasons,",
  "the cycles of the moon, the swings of a pendulum, the number of times that",
  "an hourglass is turned. This is the way in which we have traditionally",
  "conceived of time: counting the ways in which things change.",
].join("\n");

const passWith = (page42: string, page43: string): Pass0 => ({
  pages: [
    { page: 42, text: page42, words: page42.split(/\s+/).length, items: [] },
    { page: 43, text: page43, words: page43.split(/\s+/).length, items: [] },
  ],
  isScan: false,
  metaTitle: null,
  furniture: new Set(),
});

const r = (page: number, text: string, continues = false): PdfRecord => ({
  page,
  type: "paragraph",
  text,
  continues,
  uncertain: false,
});

const LATER_RECORD = r(43, LATER.replace(/\n/g, " "));

const PASS = passWith(PAGE_42, `${LINE}\n${LATER}`);
/** Page 42 carrying all but the last two words of the sentence; page 43 opens with them. */
const TWO_WORDS = passWith(
  PAGE_42.replace(/Einstein$/, "Einstein realized that it was impossible to do"),
  `so exactly.\n${LATER}`,
);

/** The seam failure, if `check` raised one. `null` for the first chunk, which has no context page. */
const seam = (records: PdfRecord[], pass = PASS, context: number | null = 42) =>
  check(records, [43], pass, { context: context ?? undefined }).failures.find((f) => f.includes("opens with"));

describe("the first page of a chunk, after a context page that stops mid-sentence", () => {
  it("passes when the line that finishes the sentence is there", () => {
    expect(seam([r(43, LINE, true), LATER_RECORD])).toBeUndefined();
  });

  it("does not let a later identical phrase steal the aligned opening", () => {
    /* An LCS is not unique. With `For now For now …` against `For now …`, the
       backtrack aligns the one emitted copy to the second baseline copy. The
       transcription nevertheless demonstrably starts at the page's first
       word, so that arbitrary choice must not turn into a seam failure. This
       is also the shape of an unrecognised running head repeated as a heading. */
    const repeated = passWith(PAGE_42, `For now\nFor now\n${LATER}`);
    expect(seam([r(43, "For now", true), LATER_RECORD], repeated)).toBeUndefined();
  });

  it("and that anchor is two words, so a shared first word does not hide the loss", () => {
    /* The lost line and the paragraph after it both open with "the". */
    const pass = passWith(PAGE_42, `the end of it was impossible to do so exactly.\nThe ${LATER}`);
    expect(seam([r(43, `The ${LATER.replace(/\n/g, " ")}`)], pass)).toContain("the end of it");
  });

  it("fails when the model left the line out, naming the page and the words", () => {
    const failure = seam([LATER_RECORD]);
    expect(failure).toContain("Page 43");
    expect(failure).toContain("realized that it was impossible");
  });

  it("and the gate as it stood let that through: the run's words are all elsewhere on the page", () => {
    /* Without the seam rule this chunk raises nothing at all — the regression
       this file exists for. */
    const { failures } = check([LATER_RECORD], [43], passWith(PAGE_42, `${LINE}\n${LATER}`), { context: 42 });
    expect(failures.filter((f) => !f.includes("opens with"))).toEqual([]);
  });

  it("fails on a two-word tail too", () => {
    expect(seam([LATER_RECORD], TWO_WORDS)).toContain("so exactly");
  });

  it("fails when the line was transcribed, but further down the page", () => {
    /* Every word is there, so nothing else in the check minds — and the reader
       still gets the paragraph cut at the seam, with its end somewhere below. */
    expect(seam([LATER_RECORD, r(43, LINE)])).toContain("Page 43");
  });

  it("fails when the context-page rule takes the line with the half it was joined to", () => {
    /* GPT Sol, plan review F4: the model writes the whole paragraph as one
       page-43 record. Nearly all its words are page 42's, so `withoutRepeats`
       drops it as the context page leaking through, and the continuation goes
       with it. The seam rule runs on what is left. */
    const page42 = TWO_WORDS.pages[0]!.text.replace(/\n/g, " ");
    const joined = r(43, `${page42} so exactly.`);
    const kept = withoutRepeats([joined, LATER_RECORD], new Set(), wordsOf(TWO_WORDS, [42]), wordsOf(TWO_WORDS, [43]));
    expect(kept).toEqual([LATER_RECORD]);
    expect(seam(kept, TWO_WORDS)).toContain("Page 43");
  });
});

describe("where it must stay quiet", () => {
  it("a context page that ends its sentence asks for nothing from the next", () => {
    const pass = passWith(`${PAGE_42} realized it.`, `${LINE}\n${LATER}`);
    expect(seam([LATER_RECORD], pass)).toBeUndefined();
  });

  it("one uncovered word, which is how a folio or a hyphenated word's second half looks", () => {
    /* `SEAM_HEAD`: on real seams a single uncovered opening token was always one
       of those, never a lost line — and a one-word tail is the price. */
    const folio = passWith(PAGE_42, `66\n${LATER}`);
    expect(seam([LATER_RECORD], folio)).toBeUndefined();
    const brokenWord = passWith(PAGE_42.replace(/Einstein$/, "Einstein realized that it was impossible to do so ex-"), `actly.\n${LATER}`);
    expect(seam([LATER_RECORD], brokenWord)).toBeUndefined();
  });

  it("the first chunk, which has no context page", () => {
    expect(seam([LATER_RECORD], PASS, null)).toBeUndefined();
  });

  it("a blank first requested page does not turn the next checkable page into the seam", () => {
    const page44 = `words absent from its opening\n${LATER}`;
    const pass: Pass0 = {
      ...PASS,
      pages: [
        PASS.pages[0]!,
        { page: 43, text: "", words: 0, items: [] },
        { page: 44, text: page44, words: page44.split(/\s+/).length, items: [] },
      ],
    };
    const failure = check([r(44, LATER.replace(/\n/g, " "))], [43, 44], pass, { context: 42 }).failures.find((f) =>
      f.includes("opens with"),
    );
    expect(failure).toBeUndefined();
  });
});
