/**
 * **The two numbers, held apart.**
 *
 * `src/referee-criteria.ts` exists because of one measured failure mode: a
 * signed valence routed through a 0–100 confidence field does not arrive wrong,
 * it arrives as `0` — `validateHits` in src/search.ts clamps negatives — and
 * every negative judgement the referee asked for is silently gone. So the tests
 * that matter most in this file are the boring-looking ones near the top:
 * a negative valence survives, a negative confidence does not, and the two
 * clamps do not agree about −80.
 *
 * The rest follows `tests/search.test.ts`'s shape, because the validator
 * follows `validateHits`'s: parse tolerantly, validate strictly, count what was
 * dropped, never rescale a unit.
 *
 * docs/plans/260831an-referee-mode-for-peer-reviewers.md, stage 2.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_DIVERGING_SCALE,
  MAX_RESULTS,
  UnreadableResults,
  clampConfidence,
  clampValence,
  configFromRow,
  configToRow,
  criterionProblem,
  isRefereeCriterionKind,
  markProblem,
  readCitations,
  valenceGap,
  validateResults,
  type DivergingResult,
  type LiteratureResult,
} from "../src/referee-criteria.js";
import type { Block } from "../src/types.js";

const block = (id: string, text: string): Block => ({
  id,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
});

const BLOCKS: Block[] = [
  block("spya-aaaaaa", "The controls were selected after the effect was observed."),
  block("spya-bbbbbb", "Every condition was pre-registered before any data were collected."),
];

const hit = (extra: Record<string, unknown> = {}) => ({
  blockId: "spya-aaaaaa",
  quote: "The controls were selected",
  confidence: 80,
  reasoning: "bears on the criterion",
  ...extra,
});

/* ------------------------------------------------------------------ */
/* The two clamps, which must never agree about a negative             */
/* ------------------------------------------------------------------ */

describe("the clamps", () => {
  it("destroys a negative confidence, because a match strength has no sign", () => {
    expect(clampConfidence(-80)).toBe(0);
    expect(clampConfidence(-1)).toBe(0);
  });

  it("keeps a negative valence, because a judgement has nothing but a sign", () => {
    expect(clampValence(-80)).toBe(-80);
    expect(clampValence(-100)).toBe(-100);
  });

  it("disagrees about −80, which is the entire reason there are two of them", () => {
    /* If this ever passes with one function doing both jobs, the feature is
       gone and nothing else in the app will say so: the panel would print
       "0 — neither" for every passage the model argued against. */
    expect(clampConfidence(-80)).not.toBe(clampValence(-80));
  });

  it("bounds both at their own ends, and rounds", () => {
    expect(clampConfidence(140)).toBe(100);
    expect(clampConfidence(63.6)).toBe(64);
    expect(clampValence(140)).toBe(100);
    expect(clampValence(-140)).toBe(-100);
    expect(clampValence(-63.6)).toBe(-64);
  });
});

/* ------------------------------------------------------------------ */
/* The validator                                                       */
/* ------------------------------------------------------------------ */

describe("validateResults", () => {
  it("refuses a reply with no results array, rather than storing an empty answer", () => {
    /* The silent-success shape. `{}` becoming `[]` would be stored as the
       legitimate, meaningful answer "nothing in this paper bears on your
       criterion", which is the one failure a referee could not diagnose. */
    for (const raw of [{}, { results: null }, { results: "nope" }, [], null, undefined]) {
      expect(() => validateResults(raw, "single", BLOCKS)).toThrow(UnreadableResults);
    }
  });

  it("accepts an empty list, which is a real answer and a different one", () => {
    const { results } = validateResults({ results: [] }, "single", BLOCKS);
    expect(results).toEqual([]);
  });

  it("drops a result naming a block this article does not have, and counts it", () => {
    const { results, dropped } = validateResults(
      { results: [hit({ blockId: "spya-zzzzzz" })] },
      "single",
      BLOCKS,
    );
    expect(results).toEqual([]);
    expect(dropped.unknownIds).toBe(1);
  });

  it("drops a result whose quote is not in the block it named, and counts it", () => {
    const { results, dropped } = validateResults(
      { results: [hit({ quote: "a sentence the paper does not contain" })] },
      "single",
      BLOCKS,
    );
    expect(results).toEqual([]);
    expect(dropped.unquoted).toBe(1);
  });

  it("stores the article's words, not the model's retyping", () => {
    const { results } = validateResults(
      // Curly apostrophes and collapsed whitespace: `findQuote` forgives both,
      // and the stored quote must still be the string the article contains.
      { results: [hit({ quote: "The  controls   were selected" })] },
      "single",
      BLOCKS,
    );
    expect(results[0]?.quote).toBe("The controls were selected");
    expect(BLOCKS[0]!.text).toContain(results[0]!.quote);
  });

  it("records where the quote sat, as a disambiguator", () => {
    const { results } = validateResults({ results: [hit()] }, "single", BLOCKS);
    expect(results[0]?.start).toBe(0);
  });

  it("stamps the criterion's kind, never the model's claim about it", () => {
    /* A model that answers `"kind":"diverging"` to a single criterion must not
       be able to mint a row whose shape nothing downstream expects. */
    const { results } = validateResults(
      { results: [hit({ kind: "diverging", valence: -90 })] },
      "single",
      BLOCKS,
    );
    expect(results[0]?.kind).toBe("single");
    expect(results[0]).not.toHaveProperty("valence");
  });

  it("clamps a confidence and counts the clamp", () => {
    const { results, dropped } = validateResults(
      { results: [hit({ confidence: 140 }), hit({ blockId: "spya-bbbbbb", quote: "Every condition", confidence: -5 })] },
      "single",
      BLOCKS,
    );
    expect(results.map((r) => r.confidence)).toEqual([100, 0]);
    expect(dropped.clampedConfidence).toBe(2);
  });

  it("counts a sub-one confidence as unit drift and does not rescale it", () => {
    /* Deliberately NOT rescaled. Rescaling is a guess about which unit the
       model meant, and a confident guess that is wrong paints the whole
       article at the wrong intensity with nothing at all to see. */
    const { results, dropped } = validateResults(
      { results: [hit({ confidence: 0.8 })] },
      "single",
      BLOCKS,
    );
    expect(dropped.subOneConfidence).toBe(1);
    expect(results[0]?.confidence).toBe(1);
  });

  it("defaults a missing confidence to 50 rather than dropping the result", () => {
    const { results } = validateResults(
      { results: [hit({ confidence: undefined })] },
      "single",
      BLOCKS,
    );
    expect(results[0]?.confidence).toBe(50);
  });

  it("caps the list and counts what it trimmed", () => {
    const many = Array.from({ length: MAX_RESULTS + 6 }, () => hit());
    const { results, dropped } = validateResults({ results: many }, "single", BLOCKS);
    expect(results.length).toBe(MAX_RESULTS);
    expect(dropped.truncated).toBe(6);
  });
});

describe("a diverging result", () => {
  it("keeps a negative valence all the way through the validator", () => {
    /* The one that would have been silently broken by reusing `confidence`.
       Not a clamp test: this is the whole round trip, from the model's reply to
       the stored row. */
    const { results, dropped } = validateResults(
      { results: [hit({ valence: -80 })] },
      "diverging",
      BLOCKS,
    );
    const row = results[0] as DivergingResult;
    expect(row.kind).toBe("diverging");
    expect(row.valence).toBe(-80);
    expect(row.confidence).toBe(80);
    expect(dropped.clampedValence).toBe(0);
  });

  it("keeps confidence and valence apart when they disagree", () => {
    // Very sure that this passage bears on the criterion; very sure it cuts
    // against. Two numbers, two meanings, one row.
    const { results } = validateResults(
      { results: [hit({ confidence: 95, valence: -95 })] },
      "diverging",
      BLOCKS,
    );
    const row = results[0] as DivergingResult;
    expect(row.confidence).toBe(95);
    expect(row.valence).toBe(-95);
  });

  it("treats zero as a real answer meaning neither end", () => {
    const { results, dropped } = validateResults(
      { results: [hit({ valence: 0 })] },
      "diverging",
      BLOCKS,
    );
    expect((results[0] as DivergingResult).valence).toBe(0);
    /* Zero is excluded from the unit-drift alarm on purpose: it is the most
       ordinary answer there is, and counting it would make the alarm fire
       constantly and mean nothing. */
    expect(dropped.subOneValence).toBe(0);
  });

  it("counts a fractional valence as unit drift, without rescaling it", () => {
    const { results, dropped } = validateResults(
      { results: [hit({ valence: -0.8 })] },
      "diverging",
      BLOCKS,
    );
    expect(dropped.subOneValence).toBe(1);
    expect((results[0] as DivergingResult).valence).toBe(-1);
  });

  it("clamps out-of-range valence at both ends and counts it", () => {
    const { results, dropped } = validateResults(
      {
        results: [
          hit({ valence: -900 }),
          hit({ blockId: "spya-bbbbbb", quote: "Every condition", valence: 900 }),
        ],
      },
      "diverging",
      BLOCKS,
    );
    expect(results.map((r) => (r as DivergingResult).valence)).toEqual([-100, 100]);
    expect(dropped.clampedValence).toBe(2);
  });

  it("defaults a missing valence to zero rather than to a judgement", () => {
    const { results } = validateResults({ results: [hit()] }, "diverging", BLOCKS);
    expect((results[0] as DivergingResult).valence).toBe(0);
  });
});

describe("a literature result", () => {
  const cited = (citations: unknown, extra: Record<string, unknown> = {}) =>
    validateResults({ results: [hit({ citations, searches: 2, ...extra })] }, "literature", BLOCKS);

  it("keeps a result that names its sources", () => {
    const { results } = cited([{ url: "https://arxiv.org/abs/2507.06185", title: "Hidden text" }]);
    const row = results[0] as LiteratureResult;
    expect(row.citations).toEqual([
      { url: "https://arxiv.org/abs/2507.06185", title: "Hidden text" },
    ]);
    expect(row.searches).toBe(2);
  });

  it("drops a result with no citation, and counts it", () => {
    /* "Answered but unverifiable" and "found nothing" are different facts and
       must not render the same. The plan forbids showing an uncited literature
       result at all, so this is where it stops. */
    const { results, dropped } = cited([]);
    expect(results).toEqual([]);
    expect(dropped.uncited).toBe(1);
  });

  it("drops a result whose only citation is not a web URL", () => {
    const { results, dropped } = cited([{ url: "javascript:alert(1)" }]);
    expect(results).toEqual([]);
    expect(dropped.uncited).toBe(1);
  });

  it("treats zero searches as a real answer, not a missing one", () => {
    const { results } = cited([{ url: "https://example.com/a" }], { searches: 0 });
    expect((results[0] as LiteratureResult).searches).toBe(0);
  });

  it("falls back to zero searches rather than dropping an otherwise good result", () => {
    const { results } = cited([{ url: "https://example.com/a" }], { searches: "lots" });
    expect((results[0] as LiteratureResult).searches).toBe(0);
  });
});

describe("readCitations", () => {
  it("refuses anything that is not an http(s) URL", () => {
    expect(
      readCitations([
        { url: "https://ok.example/a" },
        { url: "javascript:alert(1)" },
        { url: "file:///etc/passwd" },
        { url: 42 },
        null,
      ]),
    ).toEqual([{ url: "https://ok.example/a" }]);
  });

  it("drops a blank title rather than storing one", () => {
    expect(readCitations([{ url: "https://ok.example/a", title: "   " }])).toEqual([
      { url: "https://ok.example/a" },
    ]);
  });

  it("keeps one row per URL", () => {
    expect(
      readCitations([{ url: "https://ok.example/a" }, { url: "https://ok.example/a" }]),
    ).toHaveLength(1);
  });

  it("is empty rather than throwing when the field is missing", () => {
    expect(readCitations(undefined)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The criterion, its scale, and the referee's own mark                */
/* ------------------------------------------------------------------ */

describe("the criterion", () => {
  it("knows its three kinds and nothing else", () => {
    expect(isRefereeCriterionKind("diverging")).toBe(true);
    expect(isRefereeCriterionKind("reviewer")).toBe(false);
  });

  it("refuses a diverging criterion missing a word for either end", () => {
    expect(
      criterionProblem({
        criterion: "are the controls adequate?",
        config: { kind: "diverging", poles: { against: "weak", favour: "" }, scale: "rg" },
      }),
    ).toContain("a word for each end");
  });

  it("refuses an empty criterion", () => {
    expect(criterionProblem({ criterion: "   ", config: { kind: "single" } })).not.toBeNull();
  });

  it("round-trips through the row's columns", () => {
    const config = {
      kind: "diverging",
      poles: { against: "weak", favour: "pre-registered" },
      scale: "br",
    } as const;
    expect(configFromRow(configToRow(config))).toEqual(config);
    expect(configToRow({ kind: "single" })).toEqual({
      kind: "single",
      poleAgainst: null,
      poleFavour: null,
      scale: null,
    });
  });

  it("falls back to the default scale rather than refusing a row from a later version", () => {
    /* The `search_runs.colour` rule: a value this version does not know falls
       back to something drawable, because refusing a reader's saved work is the
       worse way to be wrong. */
    const config = configFromRow({
      kind: "diverging",
      poleAgainst: "a",
      poleFavour: "b",
      scale: "vik",
    });
    expect(config).toEqual({
      kind: "diverging",
      poles: { against: "a", favour: "b" },
      scale: DEFAULT_DIVERGING_SCALE,
    });
  });

  it("defaults to red ↔ green, which is a default with a condition on it", () => {
    // colour-scales.md permits `rg` only where the direction is carried by
    // something other than the colour. See the comment on `DivergingScale`.
    expect(DEFAULT_DIVERGING_SCALE).toBe("rg");
  });
});

describe("the referee's own mark", () => {
  it("measures the gap between the two placements and never averages them", () => {
    // The referee thinks this passage counts strongly for; the model thinks it
    // counts against. That disagreement is the most interesting row in the
    // mode, and it survives only because the two numbers are two numbers.
    expect(valenceGap(70, -40)).toBe(110);
    expect(valenceGap(-40, 70)).toBe(110);
    expect(valenceGap(0, 0)).toBe(0);
  });

  it("refuses a placement with nothing to place it on", () => {
    expect(markProblem({ criterionId: null, valence: -70 })).toContain("which criterion");
  });

  it("allows prose about a criterion with no number", () => {
    expect(markProblem({ criterionId: "spya-aaaaaa", valence: null })).toBeNull();
  });

  it("allows an ordinary reading note, which has neither", () => {
    expect(markProblem({ criterionId: null, valence: null })).toBeNull();
  });

  it("refuses a placement outside the scale, at both ends", () => {
    expect(markProblem({ criterionId: "spya-aaaaaa", valence: -101 })).not.toBeNull();
    expect(markProblem({ criterionId: "spya-aaaaaa", valence: 101 })).not.toBeNull();
    expect(markProblem({ criterionId: "spya-aaaaaa", valence: -100 })).toBeNull();
  });
});
