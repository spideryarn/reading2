/**
 * A PDF's numbered reference list, read from its text layer for the Citations
 * stage — src/citation-reference-list.ts, plan 260930i (SPIDERYARN-READING2-6K).
 * The lines are shaped like pass 0's reading of the paper the report came from,
 * after `pageLines` has taken the running headers out.
 */
import { describe, expect, it } from "vitest";
import {
  MIN_ENTRIES,
  REFERENCE_LIST_MAX,
  dehyphenate,
  numberedEntries,
  referenceListFrom,
  referenceListText,
} from "../src/citation-reference-list.js";

const BODY = ["Concluding remarks", "In this review we have focused on episodic memory [73] and event segmentation [66]."];
const ENTRIES = [
  "1. Smith, T.A. et al. (2013) The context repetition effect: predicted",
  "events are remembered better, even when they don't happen.",
  "J. Exp. Psychol. Gen. 142, 1298–1308",
  "2. Kim, G. et al. (2014) Pruning of memories by context-based",
  "prediction error. Proc. Natl. Acad. Sci. U. S. A. 111, 8997–9002",
  "3. Kragel, J.E. and Voss, J.L. (2022) Looking for the neural basis",
  "of memory. Trends Cogn. Sci. 26, 53–65",
  "4. Ryan, J.D. et al. (2000) Amnesia is a deficit in relational memory.",
  "Psychol. Sci. 11, 454–461",
  "5. Chang, C.H.C. et al. (2021) Relating the past with the present:",
  "information integration and segregation during ongoing narra-",
  "tive processing. J. Cogn. Neurosci. 33, 1106–1128",
  "6. Cohn-",
  "Sheehy, B.I. et al. (2021) The hippocampus constructs narrative memories across distant events. Curr. Biol. 31,",
  "4935–4945",
];

describe("referenceListFrom", () => {
  it("splits the list under the heading at its own numbers", () => {
    const list = referenceListFrom([...BODY, "References", ...ENTRIES]);
    expect([...(list?.entries.keys() ?? [])]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(list?.entries.get(1)).toBe(
      "1. Smith, T.A. et al. (2013) The context repetition effect: predicted events are remembered better, even when they don't happen. J. Exp. Psychol. Gen. 142, 1298–1308",
    );
    expect(list?.entries.get(5)).toContain("ongoing narrative processing");
    expect(list?.entries.get(6)).toContain("6. Cohn-Sheehy, B.I.");
  });

  it("never reads a continuation line that starts with digits as a new entry", () => {
    const lines = ["References", ...ENTRIES.slice(0, 9), "2024. Available at the publisher", ...ENTRIES.slice(9)];
    const list = referenceListFrom(lines);
    expect(list?.entries.get(4)).toContain("2024. Available at the publisher");
    expect(list?.entries.size).toBe(6);
  });

  it("falls back to an earlier heading when the later one has no list under it", () => {
    const lines = ["References", ...ENTRIES, "Appendix", "References", "See the main list."];
    expect(referenceListFrom(lines)?.entries.size).toBe(6);
  });

  it("finds a list that starts early in the document", () => {
    const lines = ["Title", "References", ...ENTRIES, ...Array.from({ length: 50 }, () => "Supplementary prose.")];
    /* The supplementary prose rides on the last entry until the entry is too
       long to be one; then the list ends before it. */
    const list = referenceListFrom(lines);
    expect(list?.entries.size).toBeGreaterThanOrEqual(5);
  });

  it("is null for an author–year list, a sentence, or too few entries", () => {
    expect(referenceListFrom(["References", "Tulving, E. (1983) Elements of Episodic Memory.", "Baddeley, A. (1986) Working Memory."])).toBeNull();
    expect(referenceListFrom([`See the references below for ${ENTRIES.join(" ")}`])).toBeNull();
    expect(referenceListFrom(["References", ...ENTRIES.slice(0, 7)])).toBeNull();
    expect(MIN_ENTRIES).toBe(5);
  });

  it("accepts the other spellings of the heading, numbered or not, and [n] entries", () => {
    for (const heading of ["Bibliography", "7 References", "Literature Cited", "REFERENCES AND NOTES", "Works cited:"]) {
      expect(referenceListFrom([heading, ...ENTRIES]), heading).not.toBeNull();
    }
    const bracketed = ENTRIES.map((l) => l.replace(/^(\d+)\. /, "[$1] "));
    expect(referenceListFrom(["References", ...bracketed])?.entries.size).toBe(6);
  });

  it("stops at the cap", () => {
    const long = Array.from({ length: 2000 }, (_, i) => `${i + 1}. Author, A. (2020) A title of some length. J. Something 1, 1–2`);
    const list = numberedEntries(long);
    const total = [...(list?.entries.values() ?? [])].reduce((n, e) => n + e.length, 0);
    expect(total).toBeLessThanOrEqual(REFERENCE_LIST_MAX);
    expect(list!.entries.size).toBeGreaterThan(500);
  });

  it("is shown to the model one [n] entry a line", () => {
    const list = referenceListFrom(["References", ...ENTRIES])!;
    expect(referenceListText(list).split("\n")[1]).toBe(
      "[2] Kim, G. et al. (2014) Pruning of memories by context-based prediction error. Proc. Natl. Acad. Sci. U. S. A. 111, 8997–9002",
    );
  });
});

describe("dehyphenate", () => {
  it("joins a word broken at a line end, and keeps a real hyphen before a capital", () => {
    expect(dehyphenate("narra-\ntive")).toBe("narrative");
    expect(dehyphenate("Cohn-\nSheehy")).toBe("Cohn-Sheehy");
    expect(dehyphenate("pages 1–\n2")).toBe("pages 1–\n2");
  });
});
