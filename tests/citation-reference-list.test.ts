/**
 * A PDF's numbered reference list, read from its text layer for the Bibliography
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
    expect(list?.identifierEntries?.get(5)).toContain("ongoing narra-\ntive processing");
    expect(list?.entries.get(6)).toContain("6. Cohn-Sheehy, B.I.");
  });

  it("never reads a continuation line that starts with digits as a new entry", () => {
    const lines = ["References", ...ENTRIES.slice(0, 9), "2024. Available at the publisher", ...ENTRIES.slice(9)];
    const list = referenceListFrom(lines);
    expect(list?.entries.get(4)).toContain("2024. Available at the publisher");
    expect(list?.entries.size).toBe(6);
  });

  it("stops at a numbering gap instead of swallowing later entries into the preceding work", () => {
    const gapped = ENTRIES.slice(0, ENTRIES.findIndex((line) => line.startsWith("6."))).concat([
      "7. Wrong-neighbour, A. (2024) This must not become part of entry 5.",
    ]);
    const list = referenceListFrom(["References", ...gapped]);
    expect([...(list?.entries.keys() ?? [])]).toEqual([1, 2, 3, 4, 5]);
    expect(list?.entries.get(5)).not.toContain("Wrong-neighbour");
  });

  it("accepts a zero-based list and superscript numbers emitted on their own lines", () => {
    const zeroBased = Array.from(
      { length: 5 },
      (_, i) => `${i}. Author ${i} (202${i}) A reference title. Journal ${i}, 1–2`,
    );
    expect([...(referenceListFrom(["References", ...zeroBased])?.entries.keys() ?? [])]).toEqual([
      0, 1, 2, 3, 4,
    ]);

    const separateNumbers = Array.from({ length: 5 }, (_, i) => [
      String(i + 1),
      `Author ${i + 1} (202${i}) A reference title. Journal ${i + 1}, 1–2`,
    ]).flat();
    const split = referenceListFrom(["References", ...separateNumbers]);
    expect([...(split?.entries.keys() ?? [])]).toEqual([1, 2, 3, 4, 5]);
    expect(split?.entries.get(1)).toBe("1 Author 1 (2020) A reference title. Journal 1, 1–2");

    const inlineSuperscripts = Array.from(
      { length: 5 },
      (_, i) => `${i + 1} Author ${i + 1} (202${i}) A reference title. Journal ${i + 1}, 1–2`,
    );
    expect([...(referenceListFrom(["References", ...inlineSuperscripts])?.entries.keys() ?? [])]).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  /* A page number printed alone at a page foot is never furniture
     (`repeatedLines` skips lines that short), so it reaches this parser inside
     the list. It must neither end the list nor ride in an entry. */
  it("reads straight through a page number printed alone between two entries", () => {
    const lines = ["References", ...ENTRIES.slice(0, 9), "12", ...ENTRIES.slice(9)];
    const list = referenceListFrom(lines);
    expect([...(list?.entries.keys() ?? [])]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(list?.entries.get(4)).toBe("4. Ryan, J.D. et al. (2000) Amnesia is a deficit in relational memory. Psychol. Sci. 11, 454–461");
  });

  it("keeps a continuation that starts with a small number as text", () => {
    const lines = ["References", ...ENTRIES.slice(0, 7), "2 vols. Oxford University Press", ...ENTRIES.slice(7)];
    const list = referenceListFrom(lines);
    expect(list?.entries.size).toBe(6);
    expect(list?.entries.get(3)).toContain("2 vols. Oxford University Press");
  });

  it("refuses a contents-style section list after a References heading", () => {
    expect(
      referenceListFrom([
        "References",
        "1. Introduction ........ 1",
        "2. Background ........ 3",
        "3. Methods ........ 7",
        "4. Results ........ 12",
        "5. Discussion ........ 19",
        "6. Conclusion ........ 23",
      ]),
    ).toBeNull();
  });

  /* Feedback spya-ez2vus (plan 261027b): LeCun's author–year list has no
     numbers, so the first numbered run after its `References` heading was the
     appendix's Table 1, and the model was told it was the article's reference
     list. These are the PDF's own text-layer lines. */
  it("refuses a numbered table after an author–year list: no entry carries a year", () => {
    expect(
      referenceListFrom([
        "References",
        "Agrawal, P., Nair, A., Abbeel, P., Malik, J., and Levine, S. (2016). Learning to poke by",
        "poking: Experiential learning of intuitive physics. CoRR, abs/1606.07419.",
        "Method Energy ˆy Generation Loss",
        "1 Max Likelihood discrete y exhaustive Fw(x, y) + log ∑",
        "y′∈Y exp(−Fw(x, y′))",
        "2 Max Likelihood tractable exhaustive Fw(x, y) + log ∫",
        "y′∈Y exp(−Fw(x, y′))",
        "3 Max likelihood any MC or MCMC Fw(x, y) − Fw(x, ˆy)",
        "4 Contr. Divergence any trunc’d MCMC Fw(x, y) − Fw(x, ˆy)",
        "5 Pairwise Hinge any most offending [Fw(x, y) − Fw(x, ˆy) + m(y, ˆy)]+",
        "6 Min-Hinge positive most offending Fw(x, y) + [m(y, ˆy) − Fw(x, ˆy)]+",
        "6 Square-Hinge divergence most offending Fw(x, y)2 +",
        "7 Square-Exp any most offending Fw(x, y)2 + exp(−βFw(x, ˆy))",
        "8 Logistic any most offending log(1 + exp(Fw(x, y) − Fw(x, ˆy))",
        "9 GAN any ˆy = gu(z) H(Fw(x, y), Fw(x, ˆy), m(y, ˆy))",
        "10 Denoising AE D(y, gw(y)) ˆy = N (y) D(y, gw(ˆy)",
      ]),
    ).toBeNull();
  });

  it("accepts a real numbered list whose years are abbreviated with apostrophes", () => {
    const list = referenceListFrom([
      "References",
      "[1] Smith, J. A first paper. Publisher, '20.",
      "[2] Jones, A. A second paper. Publisher, ’21.",
      "[3] Brown, B. A third paper. Publisher, '19.",
      "[4] Green, C. A fourth paper. Publisher, ’18.",
      "[5] White, D. A fifth paper. Publisher, '17.",
    ]);
    expect([...list!.entries.keys()]).toEqual([1, 2, 3, 4, 5]);
  });

  it("fails closed on a row-interleaved two-column layer", () => {
    const interleaved = [
      "1. Left, A. (2020) First left-column reference.",
      "6. Right, A. (2020) First right-column reference.",
      "2. Left, B. (2021) Second left-column reference.",
      "7. Right, B. (2021) Second right-column reference.",
      "3. Left, C. (2022) Third left-column reference.",
      "8. Right, C. (2022) Third right-column reference.",
      "4. Left, D. (2023) Fourth left-column reference.",
      "9. Right, D. (2023) Fourth right-column reference.",
      "5. Left, E. (2024) Fifth left-column reference.",
      "10. Right, E. (2024) Fifth right-column reference.",
    ];
    expect(referenceListFrom(["References", ...interleaved])).toBeNull();
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
