/**
 * **The free instrument's arithmetic**, and the four places it is allowed to
 * say *"there is nothing here"* without that reading as *"we looked and it was
 * clean"*.
 *
 * Stage B′ of
 * docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md.
 * `evals/debate/score.ts` is pure — no IO, no clock, no network — so every case
 * below builds its own input and nothing here touches the disk.
 *
 * The test that matters most is § *the raw vocabulary*. Everything else here
 * pins arithmetic; that one pins the difference between a prompt repair working
 * and a prompt repair having destroyed the field it was repairing, which are
 * the same picture in every coerced figure this file computes.
 */
import { describe, expect, it } from "vitest";

import {
  coerceLean,
  coerceRelation,
  coercedRows,
  contingencyLines,
  contingencyTable,
  formatGoldUrlHits,
  formatOppositePairs,
  goldUrlHits,
  keptPerReturned,
  keptPerReturnedLine,
  LEAN_VALUES,
  lossReasonLines,
  lossReasonTable,
  normaliseGoldUrl,
  oppositePairs,
  RELATION_VALUES,
  type ScorableRow,
  vocabularyLines,
  vocabularyProblems,
  vocabularyReport,
  zeroLosses,
} from "../evals/debate/score.js";
import type { DebateLean, DebateLosses, DebateRelation } from "../src/types.js";

const row = (relation: string, lean: string): ScorableRow => ({ relation, lean });

/** A `DebateLosses` with one reason set, so a test does not have to spell nine zeros. */
function losses(over: Partial<DebateLosses>): DebateLosses {
  return { ...zeroLosses(), ...over };
}

/* ============================================================================
   The raw vocabulary — the check that stops a destroyed field looking repaired
   ========================================================================== */

describe("the raw vocabulary, read before any coercion", () => {
  /**
   * The whole finding, as one assertion. Two arms, two completely different
   * failures, and **the coerced table cannot tell them apart** — which is why
   * the raw report has to exist.
   */
  it("tells an arm that honestly could not tell from an arm whose words we stopped recognising", () => {
    const honest = [
      { relation: "unclear", lean: "cannot-tell" },
      { relation: "unclear", lean: "cannot-tell" },
    ];
    const rewritten = [
      { relation: "contradicts", lean: "supportive" },
      { relation: "agrees-with", lean: "critical" },
    ];

    /* Identical, and that is the point: no figure computed off the coerced
       rows can separate these two runs. */
    expect(contingencyTable(coercedRows(rewritten))).toEqual(contingencyTable(coercedRows(honest)));

    const honestVocab = vocabularyReport(honest);
    const rewrittenVocab = vocabularyReport(rewritten);
    expect(honestVocab.offVocabularyRows).toBe(0);
    expect(rewrittenVocab.offVocabularyRows).toBe(2);
    expect(vocabularyProblems(honestVocab)).toEqual([]);
    expect(vocabularyProblems(rewrittenVocab).length).toBeGreaterThan(0);
  });

  it("counts every distinct raw spelling, known and unknown alike", () => {
    const report = vocabularyReport([
      { relation: "disputes", lean: "supportive" },
      { relation: "disputes", lean: "supportive" },
      { relation: "disputes", lean: "leans-for" },
      { relation: "contradicts", lean: "critical" },
    ]);
    expect(report.rows).toBe(4);
    expect(report.relations).toEqual([
      { label: "disputes", count: 3, known: true },
      { label: "contradicts", count: 1, known: false },
    ]);
    expect(report.leans).toEqual([
      { label: "supportive", count: 2, known: false },
      { label: "critical", count: 1, known: false },
      { label: "leans-for", count: 1, known: true },
    ]);
    expect(report.offVocabularyRelations).toBe(1);
    expect(report.offVocabularyLeans).toBe(3);
    /* Three rows, not four: row 4 is off-vocabulary on both fields and is one row. */
    expect(report.offVocabularyRows).toBe(3);
  });

  it("names the unknown words in the problem sentence, so a caller can fail on it", () => {
    const problems = vocabularyProblems(
      vocabularyReport([{ relation: "disputes", lean: "supportive" }]),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("supportive");
    expect(problems[0]).toContain("cannot-tell");
  });

  it("keeps absent, empty and not-a-string apart, where production's str() cannot", () => {
    const report = vocabularyReport([
      { relation: "disputes" },
      { relation: "disputes", lean: "" },
      { relation: "disputes", lean: 3 },
      { relation: "disputes", lean: null },
    ]);
    expect(report.leans.map((v) => v.label).sort()).toEqual([
      "(absent)",
      "(empty)",
      "(not a string)",
    ]);
    expect(report.leans.find((v) => v.label === "(not a string)")?.count).toBe(2);
    expect(report.offVocabularyLeans).toBe(4);
  });

  it("counts a row that is not an object at all rather than skipping it", () => {
    const report = vocabularyReport(["not a row", null, { relation: "disputes", lean: "leans-for" }]);
    expect(report.rows).toBe(3);
    expect(report.unreadableRows).toBe(2);
    expect(report.offVocabularyRows).toBe(2);
    expect(vocabularyProblems(report).some((p) => p.includes("not objects at all"))).toBe(true);
  });

  it("reports an empty set of rows as empty, and finds no problem in it", () => {
    const report = vocabularyReport([]);
    expect(report).toEqual({
      rows: 0,
      relations: [],
      leans: [],
      offVocabularyRelations: 0,
      offVocabularyLeans: 0,
      offVocabularyRows: 0,
      unreadableRows: 0,
    });
    expect(vocabularyProblems(report)).toEqual([]);
    expect(vocabularyLines(report).join("\n")).toContain("(no rows)");
  });

  it("prints the coerced destination beside every unknown word", () => {
    const text = vocabularyLines(
      vocabularyReport([{ relation: "contradicts", lean: "supportive" }]),
    ).join("\n");
    expect(text).toContain("OFF-VOCABULARY");
    expect(text).toContain('coerced to "unclear"');
    expect(text).toContain('coerced to "cannot-tell"');
  });

  it("mirrors production's coercion, including its trimming", () => {
    expect(coerceRelation(" disputes ")).toBe("disputes");
    expect(coerceRelation("supportive")).toBe("unclear");
    expect(coerceRelation(undefined)).toBe("unclear");
    expect(coerceRelation(7)).toBe("unclear");
    expect(coerceLean(" leans-for ")).toBe("leans-for");
    expect(coerceLean("supportive")).toBe("cannot-tell");
    expect(coerceLean(null)).toBe("cannot-tell");
  });
});

/* ============================================================================
   The contingency table
   ========================================================================== */

describe("the relation × lean contingency table", () => {
  it("has every one of the twenty cells, with zeros, over no rows at all", () => {
    const table = contingencyTable([]);
    expect(table.total).toBe(0);
    expect(table.classified).toBe(0);
    expect(RELATION_VALUES).toHaveLength(5);
    expect(LEAN_VALUES).toHaveLength(4);
    for (const relation of RELATION_VALUES) {
      for (const lean of LEAN_VALUES) {
        expect(table.cells[relation][lean]).toBe(0);
      }
    }
    /* `unclear` and `cannot-tell` are cells like any other and are never filtered out. */
    expect(table.cells.unclear["cannot-tell"]).toBe(0);
  });

  it("fills every cell when every cell is occupied", () => {
    const rows: ScorableRow[] = [];
    for (const relation of RELATION_VALUES) {
      for (const lean of LEAN_VALUES) rows.push(row(relation, lean));
    }
    const table = contingencyTable(rows);
    expect(table.total).toBe(20);
    expect(table.classified).toBe(20);
    for (const relation of RELATION_VALUES) {
      expect(table.byRelation[relation]).toBe(4);
      for (const lean of LEAN_VALUES) expect(table.cells[relation][lean]).toBe(1);
    }
    for (const lean of LEAN_VALUES) expect(table.byLean[lean]).toBe(5);
  });

  it("keeps an all-unclear arm visible rather than empty", () => {
    const table = contingencyTable([
      row("unclear", "cannot-tell"),
      row("unclear", "cannot-tell"),
      row("unclear", "neither"),
    ]);
    expect(table.cells.unclear["cannot-tell"]).toBe(2);
    expect(table.cells.unclear.neither).toBe(1);
    expect(table.byRelation.unclear).toBe(3);
    expect(table.total).toBe(3);
  });

  it("carries an off-vocabulary row rather than dropping it, and still counts it in the total", () => {
    const table = contingencyTable([row("disputes", "leans-against"), row("contradicts", "supportive")]);
    expect(table.total).toBe(2);
    expect(table.classified).toBe(1);
    expect(table.offVocabulary).toEqual([{ relation: "contradicts", lean: "supportive" }]);
    expect(contingencyLines(table).join("\n")).toContain("contradicts/supportive");
  });

  it("says 'none' rather than nothing when every row was classified", () => {
    const text = contingencyLines(contingencyTable([row("disputes", "leans-against")])).join("\n");
    expect(text).toContain("off-vocabulary: none, over 1 row(s)");
  });
});

/* ============================================================================
   The opposite-pair mark
   ========================================================================== */

describe("the opposite-pair mark", () => {
  it("counts both cells and reports N over all rows", () => {
    const mark = oppositePairs([
      row("disputes", "leans-for"),
      row("corroborates", "leans-against"),
      row("disputes", "leans-against"),
      row("corroborates", "leans-for"),
    ]);
    expect(mark).toEqual({
      disputesLeansFor: 1,
      corroboratesLeansAgainst: 1,
      pairs: 2,
      total: 4,
      rate: 0.5,
    });
    expect(formatOppositePairs(mark)).toContain("2 / 4 rows");
  });

  /**
   * The reward-for-answering-less failure, closed. Ten rows, two opposite
   * pairs, five of them `unclear`/`cannot-tell`. Against a classified-only
   * denominator this arm would score 2/5; the mark scores it 2/10, which is
   * what it is.
   */
  it("puts every row in the denominator, so an unclear-everywhere arm cannot look better", () => {
    const rows = [
      row("disputes", "leans-for"),
      row("corroborates", "leans-against"),
      row("disputes", "leans-against"),
      row("qualifies", "neither"),
      row("extends", "leans-for"),
      row("unclear", "cannot-tell"),
      row("unclear", "cannot-tell"),
      row("unclear", "cannot-tell"),
      row("unclear", "cannot-tell"),
      row("unclear", "cannot-tell"),
    ];
    const mark = oppositePairs(rows);
    expect(mark.total).toBe(10);
    expect(mark.pairs).toBe(2);
    expect(mark.rate).toBeCloseTo(0.2, 10);
  });

  it("scores an arm that answered unclear everywhere as zero over its full count, not as unmeasured", () => {
    const mark = oppositePairs(Array.from({ length: 6 }, () => row("unclear", "cannot-tell")));
    expect(mark.pairs).toBe(0);
    expect(mark.total).toBe(6);
    expect(mark.rate).toBe(0);
  });

  it("returns null rather than 0 when there is no denominator", () => {
    const mark = oppositePairs([]);
    expect(mark.total).toBe(0);
    expect(mark.pairs).toBe(0);
    /* Not 0: a 0.0% beside "opposite pairs" reads as "we checked and it is clean". */
    expect(mark.rate).toBeNull();
    expect(formatOppositePairs(mark)).toContain("no rows, so no rate");
    expect(formatOppositePairs(mark)).not.toContain("0.0%");
  });

  it("says in its own printed line that it is not an error count", () => {
    expect(formatOppositePairs(oppositePairs([row("disputes", "leans-for")]))).toContain(
      "not an error count",
    );
  });

  it("ignores the other fourteen cells, including the ones that merely look odd", () => {
    const mark = oppositePairs([
      row("qualifies", "leans-for"),
      row("extends", "leans-against"),
      row("unclear", "leans-for"),
      row("corroborates", "neither"),
    ]);
    expect(mark.pairs).toBe(0);
    expect(mark.total).toBe(4);
  });
});

/* ============================================================================
   Kept per returned, and the loss-reason table
   ========================================================================== */

describe("the loss-reason table", () => {
  it("prints every reason including the zeros, over no groups at all", () => {
    const table = lossReasonTable([]);
    expect(table.total).toBe(0);
    expect(table.groups).toBe(0);
    /* All eight reasons, derived from lossesOf rather than re-listed here. */
    expect(Object.keys(table.byReason).sort()).toEqual(Object.keys(zeroLosses()).sort());
    expect(Object.values(table.byReason).every((n) => n === 0)).toBe(true);
    expect(lossReasonLines(table).join("\n")).toContain("unverifiedSource");
  });

  it("sums across groups", () => {
    const table = lossReasonTable([
      { counts: { lost: losses({ unverifiedSource: 2, uncited: 1 }) } },
      { counts: { lost: losses({ unverifiedSource: 3, sourceIsCopy: 1 }) } },
    ]);
    expect(table.byReason.unverifiedSource).toBe(5);
    expect(table.byReason.uncited).toBe(1);
    expect(table.byReason.sourceIsCopy).toBe(1);
    expect(table.byReason.malformed).toBe(0);
    expect(table.total).toBe(7);
    expect(table.groups).toBe(2);
  });

  it("survives a stored artefact with counters missing, negative or the wrong type", () => {
    const stored = { unverifiedSource: 2, uncited: -3, malformed: "4" } as unknown as DebateLosses;
    const table = lossReasonTable([{ counts: { lost: stored } }]);
    expect(table.byReason.unverifiedSource).toBe(2);
    expect(table.byReason.uncited).toBe(0);
    expect(table.byReason.malformed).toBe(0);
    expect(table.byReason.selfSource).toBe(0);
    expect(Number.isNaN(table.total)).toBe(false);
  });
});

describe("kept per returned", () => {
  it("names both denominators separately", () => {
    const kept = keptPerReturned({
      returnedSources: 10,
      reportedRows: 4,
      keptRows: 1,
      omittedOverCap: 0,
    });
    expect(kept.keptPerReportedRow).toBe(0.25);
    expect(kept.keptPerReturnedSource).toBeCloseTo(0.1, 10);
  });

  it("says n/a rather than zero when a denominator is zero", () => {
    const kept = keptPerReturned({
      returnedSources: 0,
      reportedRows: 0,
      keptRows: 0,
      omittedOverCap: 0,
    });
    expect(kept.keptPerReportedRow).toBeNull();
    expect(kept.keptPerReturnedSource).toBeNull();
    expect(keptPerReturnedLine("direct", kept)).toContain("n/a");
    expect(keptPerReturnedLine("direct", kept)).not.toContain("0%");
  });

  it("mentions the cap only when the cap bit", () => {
    const under = keptPerReturned({
      returnedSources: 5,
      reportedRows: 2,
      keptRows: 2,
      omittedOverCap: 0,
    });
    const over = keptPerReturned({
      returnedSources: 5,
      reportedRows: 9,
      keptRows: 6,
      omittedOverCap: 3,
    });
    expect(keptPerReturnedLine("claims", under)).not.toContain("cap");
    expect(keptPerReturnedLine("claims", over)).toContain("3 over the cap");
  });
});

/* ============================================================================
   Gold-URL hits
   ========================================================================== */

describe("gold-URL hits", () => {
  it("matches across scheme, www, a trailing slash and a fragment", () => {
    expect(normaliseGoldUrl("https://WWW.Example.com/a/b/#part")).toBe("example.com/a/b");
    expect(normaliseGoldUrl("http://example.com/a/b")).toBe("example.com/a/b");
    /* The query is kept — on plenty of sites it is the article id. */
    expect(normaliseGoldUrl("https://example.com/p?id=7")).toBe("example.com/p?id=7");
  });

  it("returns a string it cannot parse rather than throwing, so a typo shows up as a miss", () => {
    expect(normaliseGoldUrl("  Not A Url ")).toBe("not a url");
    const hits = goldUrlHits(["Not A Url"], ["https://example.com/a"]);
    expect(hits.hit).toBe(0);
    expect(hits.missed).toEqual(["Not A Url"]);
  });

  it("counts distinct expected URLs and lists what was missed", () => {
    const hits = goldUrlHits(
      ["https://a.example/1", "http://www.a.example/1/", "https://b.example/2"],
      ["https://a.example/1#x", "https://c.example/9"],
    );
    expect(hits.expected).toBe(2);
    expect(hits.hit).toBe(1);
    expect(hits.hits).toEqual(["https://a.example/1"]);
    expect(hits.missed).toEqual(["https://b.example/2"]);
    expect(hits.rate).toBe(0.5);
  });

  it("scores an empty gold list as not measured, never as perfect", () => {
    const hits = goldUrlHits([], ["https://a.example/1"]);
    expect(hits.expected).toBe(0);
    expect(hits.rate).toBeNull();
    expect(formatGoldUrlHits(hits)).toContain("not measured");
    expect(formatGoldUrlHits(hits)).not.toContain("100%");
  });

  it("does not credit a different path on the same host", () => {
    expect(goldUrlHits(["https://a.example/1"], ["https://a.example/2"]).hit).toBe(0);
  });
});

/* ============================================================================
   The vocabularies themselves
   ========================================================================== */

describe("the vocabularies", () => {
  it("holds every relation and lean the types admit", () => {
    /* If a new member is added to either union, the mapping in score.ts stops
       compiling — this is the runtime half of the same claim. */
    const relations: DebateRelation[] = [
      "disputes",
      "qualifies",
      "extends",
      "corroborates",
      "unclear",
    ];
    const leans: DebateLean[] = ["leans-for", "leans-against", "neither", "cannot-tell"];
    expect([...RELATION_VALUES].sort()).toEqual([...relations].sort());
    expect([...LEAN_VALUES].sort()).toEqual([...leans].sort());
  });
});
