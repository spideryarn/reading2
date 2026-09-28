/**
 * Step 1 of the shelf's filter terms: one article's text → its candidate
 * phrases — src/shelf-terms/extract.ts.
 * docs/plans/260928a-shelf-facet-terms.md § Step 1, and stage 1's test list.
 */
import { describe, expect, it } from "vitest";
import {
  type Candidate,
  EXTRACTOR_VERSION,
  extractCandidates,
  foldKey,
  type Segment,
  type SegmentBlock,
  segmentsFromBlocks,
} from "../src/shelf-terms/extract.js";

/** Enough ordinary English around the phrase under test to pass the language check. */
const FILLER =
  "This is the kind of sentence that has a lot of the small words in it, and it is here so that the text reads as English to the check.";

const prose = (text: string): Segment => ({ text, kind: "prose" });
const byKey = (cands: Candidate[], key: string) => cands.find((c) => c.key === key);

describe("EXTRACTOR_VERSION", () => {
  it("is 1 — bump it whenever the output for the same text can change", () => {
    expect(EXTRACTOR_VERSION).toBe(1);
  });
});

describe("foldKey — light plural folding", () => {
  it("folds regular plurals, -ies and -es, and leaves -is/-ss/-us words alone", () => {
    expect(foldKey("networks")).toBe("network");
    expect(foldKey("studies")).toBe("study");
    expect(foldKey("Boxes")).toBe("box");
    expect(foldKey("analysis")).toBe("analysis");
    expect(foldKey("consciousness")).toBe("consciousness");
    expect(foldKey("conscious")).toBe("conscious");
    expect(foldKey("physics")).toBe("physics");
    expect(foldKey("Turing's")).toBe("turing");
  });

  it("folds long acronym plurals, and leaves a short one's to the chooser (plan 260928d)", () => {
    expect(foldKey("LLMs")).toBe("llm");
    /* Three letters or fewer come back whole, so bus and gas survive — and
       so does AIs; -us and -os are kept (virus, chaos), so GPUs and NGOs are
       too. choose.ts merges a short key like these into its singular when
       both are on the shelf, which needs no EXTRACTOR_VERSION bump. */
    expect(foldKey("AIs")).toBe("ais");
    expect(foldKey("GPUs")).toBe("gpus");
    expect(foldKey("NGOs")).toBe("ngos");
    expect(foldKey("bus")).toBe("bus");
  });

  it("puts a plural and its singular under one key, counted together", () => {
    const r = extractCandidates([
      prose(`${FILLER} The neural networks learn. A neural network forgets. ${FILLER}`),
    ]);
    const c = byKey(r.candidates, "neural network");
    expect(c?.count).toBe(2);
    expect(byKey(r.candidates, "neural networks")).toBeUndefined();
  });

  it("normalises canonically equivalent accents and word-joining hyphens", () => {
    const r = extractCandidates([
      prose(
        `${FILLER} Café culture. Cafe\u0301 culture. Neural-network systems. Neural‑network systems. ${FILLER}`,
      ),
    ]);
    expect(byKey(r.candidates, "café culture")?.count).toBe(2);
    expect(byKey(r.candidates, "cafe culture")).toBeUndefined();
    expect(byKey(r.candidates, "neural-network system")?.count).toBe(2);
    expect(byKey(r.candidates, "neural network system")).toBeUndefined();
  });

  it("strips uppercase straight and curly possessives from the displayed surface form", () => {
    const r = extractCandidates([
      prose(`${FILLER} TURING'S machine. TURING’S machine. ${FILLER}`),
    ]);
    expect(byKey(r.candidates, "turing machine")).toMatchObject({
      label: "TURING machine",
      count: 2,
    });
  });
});

describe("runs split at stopwords and punctuation", () => {
  it("never makes a phrase across a stopword", () => {
    const r = extractCandidates([prose(`${FILLER} The theory of mind matters. ${FILLER}`)]);
    const keys = r.candidates.map((c) => c.key);
    expect(keys).toContain("theory");
    expect(keys).toContain("mind");
    expect(keys.some((k) => k.includes("theory") && k.includes("mind"))).toBe(false);
  });

  it("never makes a phrase across a comma", () => {
    const r = extractCandidates([prose(`${FILLER} memory, grammar and syntax. ${FILLER}`)]);
    expect(byKey(r.candidates, "memory grammar")).toBeUndefined();
    expect(byKey(r.candidates, "memory")).toBeDefined();
  });

  it("takes every 1–3-gram inside a run, and nothing longer", () => {
    const r = extractCandidates([
      prose(`${FILLER} Artificial neural network architectures. ${FILLER}`),
    ]);
    const keys = r.candidates.map((c) => c.key);
    expect(keys).toContain("artificial neural network");
    expect(keys).toContain("neural network architecture");
    expect(keys).toContain("neural network");
    expect(keys).not.toContain("artificial neural network architecture");
  });
});

describe("the nounish test", () => {
  it("drops a generic single word, an -ly adverb and an -ed word", () => {
    const r = extractCandidates([
      prose(`${FILLER} World. Quietly. Jumped. Spiders. ${FILLER} World. Quietly. Jumped. Spiders.`),
    ]);
    const keys = r.candidates.map((c) => c.key);
    expect(keys).toContain("spider");
    expect(keys).not.toContain("world");
    expect(keys).not.toContain("quietly");
    expect(keys).not.toContain("jumped");
  });

  it("drops a phrase whose last word is an adverb or an irregular verb", () => {
    const r = extractCandidates([
      prose(`${FILLER} Spiders quickly. Spiders saw. ${FILLER}`),
    ]);
    const keys = r.candidates.map((c) => c.key);
    expect(keys).not.toContain("spider quickly");
    expect(keys).not.toContain("spider saw");
  });

  it("keeps a phrase whose head is a common but topical word", () => {
    /* "experience" is on the generic list as a single word, and "conscious
       experience" is still a topic: the list is for lone words only. */
    const r = extractCandidates([prose(`${FILLER} Conscious experience. ${FILLER}`)]);
    expect(byKey(r.candidates, "conscious experience")).toBeDefined();
    expect(byKey(r.candidates, "experience")).toBeUndefined();
  });
});

describe("count, bodyCount and score are three numbers, not one (Sol F3)", () => {
  it("counts the title and a heading once each, tests prose only, and weights the score", () => {
    const r = extractCandidates([
      { text: "Spider silk", kind: "title" },
      { text: "Spider silk", kind: "heading" },
      prose(`${FILLER} Spider silk is strong. ${FILLER}`),
    ]);
    const c = byKey(r.candidates, "spider silk");
    expect(c).toMatchObject({ count: 3, bodyCount: 1, score: 3 + 2 + 1 });
  });

  it("keeps a title-only phrase, with bodyCount 0", () => {
    const r = extractCandidates([
      { text: "Todo list", kind: "title" },
      prose(`${FILLER} ${FILLER}`),
    ]);
    expect(byKey(r.candidates, "todo list")).toMatchObject({ count: 1, bodyCount: 0, score: 3 });
  });

  it("counts `words` over prose alone, unweighted", () => {
    const r = extractCandidates([
      { text: "A long title with many words in it", kind: "title" },
      { text: "Heading words", kind: "heading" },
      prose("one two three four five"),
    ]);
    expect(r.words).toBe(5);
  });
});

describe("the label", () => {
  it("is the most frequent surface form", () => {
    const r = extractCandidates([
      prose(`${FILLER} Turing machine. The Turing machine. A turing machine. ${FILLER}`),
    ]);
    expect(byKey(r.candidates, "turing machine")?.label).toBe("Turing machine");
  });

  it("is lowercase on a tie, so a heading's Title Case does not become the label", () => {
    const r = extractCandidates([
      { text: "Memory", kind: "heading" },
      prose(`${FILLER} It is about memory. ${FILLER}`),
    ]);
    expect(byKey(r.candidates, "memory")?.label).toBe("memory");
  });

  it("breaks a remaining tie by code point, whatever order the forms arrived in", () => {
    const a = extractCandidates([prose(`${FILLER} Zorp. ZORP. ${FILLER}`)]);
    const b = extractCandidates([prose(`${FILLER} ZORP. Zorp. ${FILLER}`)]);
    expect(byKey(a.candidates, "zorp")?.label).toBe("ZORP");
    expect(byKey(b.candidates, "zorp")?.label).toBe("ZORP");
  });
});

describe("the output order and limit", () => {
  it("is ranked, deterministic, and cut at the limit", () => {
    const text = `${FILLER} Spiders spiders spiders. Webs webs. Silk. ${FILLER}`;
    const r = extractCandidates([prose(text)], { limit: 2 });
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates[0]?.key).toBe("spider");
    expect(extractCandidates([prose(text)], { limit: 2 })).toEqual(r);
  });
});

describe("English only, said out loud (Sol F12)", () => {
  it("skips a French paragraph, with no candidates", () => {
    const french =
      "La mémoire collective des peuples autochtones est un sujet que les historiens abordent " +
      "depuis longtemps dans les archives coloniales. Les récits oraux, transmis de génération " +
      "en génération, constituent une source précieuse pour comprendre les paysages et les " +
      "territoires. Dans ce contexte, la question de la langue devient centrale pour les " +
      "chercheurs qui travaillent sur ces communautés et sur leurs pratiques culturelles.";
    const r = extractCandidates([{ text: "La mémoire", kind: "title" }, prose(french)]);
    expect(r.skipped).toBe("not-english");
    expect(r.candidates).toEqual([]);
    expect(r.words).toBeGreaterThan(0);
  });

  it("does not skip ordinary English", () => {
    const r = extractCandidates([prose(`${FILLER} Spider silk is strong. ${FILLER}`)]);
    expect(r.skipped).toBeNull();
    expect(r.candidates.length).toBeGreaterThan(0);
  });

  it("does not reject English prose dense with proper nouns", () => {
    const properNounDense =
      "Ada Lovelace met Charles Babbage during June 1833. London mathematician Mary Somerville " +
      "introduced Lovelace to Babbage. Luigi Menabrea later published Sketch of the Analytical " +
      "Engine. Lovelace translated Menabrea's memoir, adding extensive notes about Bernoulli " +
      "numbers, Jacquard cards, computation, music, mathematics, and symbolic operations.";
    const r = extractCandidates([prose(properNounDense)]);
    expect(r.skipped).toBeNull();
    expect(r.candidates.length).toBeGreaterThan(0);
  });

  it("says no-text when there is no prose at all", () => {
    const r = extractCandidates([{ text: "Only a title", kind: "title" }]);
    expect(r).toMatchObject({ skipped: "no-text", words: 0, candidates: [] });
  });
});

describe("textHash", () => {
  it("is a sha256 of the counted text, blind to whitespace differences", () => {
    const a = extractCandidates([{ text: "T", kind: "title" }, prose("Spider  silk\n is strong.")]);
    const b = extractCandidates([{ text: "T", kind: "title" }, prose(" Spider silk is strong. ")]);
    expect(a.textHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.textHash).toBe(b.textHash);
  });

  it("differs when the text differs, or when the same words change kind", () => {
    const a = extractCandidates([prose("Spider silk is strong.")]);
    const b = extractCandidates([prose("Spider silk is weak.")]);
    const c = extractCandidates([{ text: "Spider silk is strong.", kind: "heading" }]);
    expect(a.textHash).not.toBe(b.textHash);
    expect(a.textHash).not.toBe(c.textHash);
  });
});

describe("segmentsFromBlocks — what text is read", () => {
  const block = (over: Partial<SegmentBlock> & { text: string }): SegmentBlock => ({
    kind: "text",
    level: null,
    role: null,
    treatment: null,
    gistable: true,
    ...over,
  });

  it("puts the title first, then headings and prose in document order", () => {
    const segs = segmentsFromBlocks("The title", [
      block({ text: "Intro", kind: "heading", level: 2 }),
      block({ text: "Body text." }),
    ]);
    expect(segs).toEqual([
      { text: "The title", kind: "title" },
      { text: "Intro", kind: "heading" },
      { text: "Body text.", kind: "prose" },
    ]);
  });

  it("leaves out footnotes, supplements, non-gistable blocks, code, media and tables", () => {
    const segs = segmentsFromBlocks(null, [
      block({ text: "kept" }),
      block({ text: "a footnote", role: "footnote", treatment: "supplement" }),
      block({ text: "a footnote with no treatment", role: "footnote" }),
      block({ text: "a supplement", treatment: "supplement" }),
      block({ text: "a pull quote", gistable: false }),
      block({ text: "const x = 1", kind: "code" }),
      block({ text: "an image", kind: "media" }),
      block({ text: "a table", kind: "other" }),
      block({ text: "a quote", kind: "quote" }),
    ]);
    expect(segs.map((s) => s.text)).toEqual(["kept", "a quote"]);
  });

  it("skips everything under a back-matter heading, until a heading at the same or a higher level", () => {
    const segs = segmentsFromBlocks(null, [
      block({ text: "Argument", kind: "heading", level: 2 }),
      block({ text: "body one" }),
      block({ text: "References", kind: "heading", level: 2 }),
      block({ text: "Smith, J. (2001). Journal of Things." }),
      block({ text: "Primary sources", kind: "heading", level: 3 }),
      block({ text: "Jones 1999" }),
      block({ text: "Acknowledgments", kind: "heading", level: 2 }),
      block({ text: "Thanks to Ada." }),
      block({ text: "Appendix", kind: "heading", level: 2 }),
      block({ text: "body two" }),
    ]);
    expect(segs.map((s) => s.text)).toEqual(["Argument", "body one", "Appendix", "body two"]);
  });

  it("recognises every back-matter heading the plan names, numbered or not", () => {
    for (const h of [
      "References",
      "Bibliography",
      "Acknowledgements",
      "Acknowledgments",
      "External links",
      "See also",
      "Further reading",
      "Notes",
      "Works cited",
      "Sources",
      "7. References",
      "7.1 References",
      "A. Bibliography",
      "NOTES:",
    ]) {
      const segs = segmentsFromBlocks(null, [
        block({ text: h, kind: "heading", level: 2 }),
        block({ text: "back matter" }),
      ]);
      expect(segs, h).toEqual([]);
    }
  });

  it("does not mistake a heading that merely starts with a back-matter word", () => {
    const segs = segmentsFromBlocks(null, [
      block({ text: "Notes on the synthesis of form", kind: "heading", level: 2 }),
      block({ text: "body" }),
    ]);
    expect(segs.map((s) => s.text)).toEqual(["Notes on the synthesis of form", "body"]);
  });

  it("does not end back matter at a deeper heading, and treats a missing level as top-level", () => {
    const segs = segmentsFromBlocks(null, [
      block({ text: "Notes", kind: "heading", level: 2 }),
      block({ text: "Sub", kind: "heading", level: 4 }),
      block({ text: "still notes" }),
      block({ text: "Next part", kind: "heading", level: null }),
      block({ text: "body" }),
    ]);
    expect(segs.map((s) => s.text)).toEqual(["Next part", "body"]);
  });
});
