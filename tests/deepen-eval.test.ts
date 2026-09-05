/**
 * **The stage-5b harness's arithmetic, and every refusal it makes** —
 * evals/deepen/report.ts and evals/deepen/harness.ts.
 *
 * The eval itself spends about $42 and cannot be run twice to find out whether
 * it measured anything, so the whole of it that can be exercised for free is
 * exercised here — the same split `tests/cost-eval.test.ts` makes against
 * `evals/cost/`. Every case below is **a way the harness could report a clean
 * result while having measured nothing**, which is the failure mode
 * docs/reusable/silent-success.md is about and which this plan has already hit
 * once (stage 5a's records never left `deepenTree`).
 *
 * Three of them deserve naming, because they are the ones that would be
 * believed:
 *
 * 1. **Pairing on `where`.** An ordinal path derived from the answer's own
 *    fan-out. Two repeats that split a parent in different places both emit
 *    `root > child 1 > child 1`, and pairing on that reports a boundary that
 *    moved as a verdict that held — *more* stable than the truth.
 * 2. **A repeat that bought nothing.** Without the re-ask lever the second wave
 *    reads its own content-addressed rows back and returns identical verdicts
 *    **by construction**: a perfect stability figure, worth nothing.
 * 3. **A seed that moved.** If the structure checkpoint were re-bought, each
 *    repeat would be asked about a different tree, and the flip rate would be
 *    measuring the tree and the verdict at once.
 */

import { describe, expect, it } from "vitest";

import type { CandidateRecord } from "../src/hierarchy-expand.js";
import type { DeepenStats } from "../src/hierarchy-deepen.js";
import {
  assertReaskNames,
  assertSeamProof,
  byWhenWritten,
  estimate,
  parseRecordsFile,
  RECORDS_VERSION,
  recordingCheckpoints,
  type SeamProof,
  treeDigest,
} from "../evals/deepen/harness.js";
import {
  boundTally,
  budgetReport,
  checkDriving,
  checkInertness,
  checkRepeatBoughtItsWave,
  compareRepeats,
  costReport,
  type DrivenJob,
  parentPath,
  rangeOf,
  type RecordsPass,
  requireRanges,
  wave1Unchanged,
  yesRate,
  yesRates,
} from "../evals/deepen/report.js";
import { REASK_ENV } from "../src/hierarchy-deepen.js";

/* ------------------------------------------------------------- the fixtures -- */

function record(over: Partial<CandidateRecord> & Pick<CandidateRecord, "where" | "range">): CandidateRecord {
  return {
    wave: 2,
    depth: 2,
    rawVerdict: "finished",
    effective: { decision: "stop", because: "verdict" },
    overriddenBy: null,
    structuralBlocks: 12,
    bodyWords: 900,
    authoredHeadings: 0,
    retries: 0,
    fanOut: null,
    model: "a-model",
    effort: "medium",
    promptVersion: "toc/2+expand/2",
    ...over,
  } as CandidateRecord;
}

const NO_STATS = {
  targets: 0,
  expanded: 0,
  added: 0,
  withheld: 0,
  uncheckpointed: 0,
  calls: 0,
  resumed: 0,
  oversized: 0,
  outOfTime: 0,
  rateLimited: 0,
} as unknown as DeepenStats;

function pass(label: string, records: CandidateRecord[]): RecordsPass {
  return { label, slug: "book", writtenAt: "2026-09-05T00:00:00.000Z", stats: NO_STATS, records };
}

/**
 * Two repeats of one parent, whose own range is fixed because wave 1 is
 * resumed. `splitAt` decides where the parent's children divide, and `verdicts`
 * what each child said — so a test can move the boundary and the verdict
 * independently, which is the whole distinction question 1 turns on.
 */
function parentAndChildren(opts: {
  splitAt: string;
  verdicts: [string, string];
}): CandidateRecord[] {
  return [
    record({
      where: "root > child 1",
      range: ["b001", "b100"],
      wave: 1,
      depth: 1,
      rawVerdict: null,
      effective: { decision: "expand", because: "authored-heading" },
      fanOut: 2,
    }),
    record({
      where: "root > child 1 > child 1",
      range: ["b001", opts.splitAt],
      rawVerdict: opts.verdicts[0] as CandidateRecord["rawVerdict"],
    }),
    record({
      where: "root > child 1 > child 2",
      range: [opts.splitAt, "b100"],
      rawVerdict: opts.verdicts[1] as CandidateRecord["rawVerdict"],
    }),
  ];
}

/* ==================================================== the pairing, question 1 == */

describe("pairing candidates across repeats", () => {
  it("reads the range off the record and never falls back to `where`", () => {
    expect(rangeOf(record({ where: "root", range: ["a", "b"] }))).toEqual(["a", "b"]);
    /* The near-misses, so a rename in src/ is a working comparison rather than
       a refusal discovered at the end of a paid run. */
    expect(rangeOf({ where: "root", rangeStart: "a", rangeEnd: "b" } as unknown as CandidateRecord)).toEqual(["a", "b"]);
    /* And the thing it must never do. `where` is present and there is still no
       range, so the answer is null and `requireRanges` refuses. */
    expect(rangeOf({ where: "root > child 1" } as unknown as CandidateRecord)).toBeNull();
  });

  it("refuses to compare records with no range at all", () => {
    const naked = [{ where: "root > child 1 > child 1" }] as unknown as CandidateRecord[];
    expect(() => requireRanges([pass("p1", naked)])).toThrow(/carry no block range/);
    expect(() => compareRepeats([pass("p1", naked), pass("p2", naked)])).toThrow(
      /Pairing on `where` instead is refused deliberately/,
    );
  });

  it("parentPath strips the last rung and stops at the root", () => {
    expect(parentPath("root > child 1 > child 2")).toBe("root > child 1");
    expect(parentPath("root")).toBeNull();
  });

  /**
   * **The case the whole design exists for**, and the one a `where`-based
   * pairing gets wrong: the boundary moved, so `root > child 1 > child 1` is a
   * different piece of prose in each pass, and both children said the same
   * thing about the prose they actually saw.
   *
   * Pairing on `where` would report zero flips and zero drift — a perfect
   * result. Pairing on the range reports what really happened: no flip (there is
   * no matched range to flip), and one parent whose boundaries moved.
   */
  it("calls a moved boundary structural, not a stable verdict", () => {
    const q = compareRepeats([
      pass("p1", parentAndChildren({ splitAt: "b050", verdicts: ["finished", "needs-deeper"] })),
      pass("p2", parentAndChildren({ splitAt: "b060", verdicts: ["finished", "needs-deeper"] })),
    ]);
    expect(q.parentsCompared).toBe(1);
    expect(q.fanOutChanged).toHaveLength(0);
    expect(q.boundariesMoved).toHaveLength(1);
    /* And **no range matched**, which is the point rather than a shortfall:
       moving the split moved both children's spans, so neither pass's child
       covers the prose the other's did. There is nothing to compare, and
       nothing is invented — where a `where`-based pairing would have compared
       two different pieces of prose and called them the same node. */
    expect(q.rangesMatched).toBe(0);
    expect(q.verdictFlips).toHaveLength(0);
  });

  it("calls a flip at a matched range a flip, and nothing else", () => {
    const q = compareRepeats([
      pass("p1", parentAndChildren({ splitAt: "b050", verdicts: ["finished", "finished"] })),
      pass("p2", parentAndChildren({ splitAt: "b050", verdicts: ["finished", "needs-deeper"] })),
    ]);
    expect(q.boundariesMoved).toHaveLength(0);
    expect(q.fanOutChanged).toHaveLength(0);
    expect(q.rangesMatched).toBe(2);
    expect(q.verdictFlips).toHaveLength(1);
    expect(q.verdictFlips[0]!.verdicts.map((v) => v.verdict)).toEqual(["finished", "needs-deeper"]);
  });

  it("calls a changed fan-out its own thing and does not look inside it", () => {
    const three = parentAndChildren({ splitAt: "b050", verdicts: ["finished", "finished"] });
    three.push(record({ where: "root > child 1 > child 3", range: ["b070", "b100"] }));
    const q = compareRepeats([
      pass("p1", parentAndChildren({ splitAt: "b050", verdicts: ["finished", "finished"] })),
      pass("p2", three),
    ]);
    expect(q.fanOutChanged).toHaveLength(1);
    expect(q.boundariesMoved).toHaveLength(0);
    /* Deliberately not compared: a parent that came back with a different number
       of children produced other nodes rather than changing its mind, and
       folding that into a flip rate is what the plan forbids. */
    expect(q.rangesMatched).toBe(0);
    expect(q.verdictFlips).toHaveLength(0);
  });

  it("says nothing at all from one pass, rather than saying everything is stable", () => {
    const q = compareRepeats([pass("p1", parentAndChildren({ splitAt: "b050", verdicts: ["finished", "finished"] }))]);
    expect(q.parentsCompared).toBe(0);
    expect(q.rangesMatched).toBe(0);
  });

  it("counts a parent it cannot resolve rather than dropping it", () => {
    const orphan = [record({ where: "root > child 9 > child 1", range: ["b001", "b010"] })];
    const q = compareRepeats([pass("p1", orphan), pass("p2", orphan)]);
    expect(q.unpairable).toBe(2);
    expect(q.parentsCompared).toBe(0);
  });
});

/* ================================================================ the seed == */

describe("the seed that has to be held constant", () => {
  it("is quiet when every repeat got the same wave-1 frontier", () => {
    const same = parentAndChildren({ splitAt: "b050", verdicts: ["finished", "finished"] });
    expect(wave1Unchanged([pass("p1", same), pass("p2", same)])).toEqual([]);
  });

  /**
   * **The fatal one.** Wave-1 records are derived mechanically from the tree, so
   * if they differ the tree differed — the structure checkpoint was not resumed,
   * and the flip rate is measuring the tree and the verdict at once.
   */
  it("goes fatal when a repeat was handed a different tree", () => {
    const p1 = parentAndChildren({ splitAt: "b050", verdicts: ["finished", "finished"] });
    const p2 = parentAndChildren({ splitAt: "b050", verdicts: ["finished", "finished"] });
    p2[0] = record({ ...p2[0]!, range: ["b001", "b090"] });
    const found = wave1Unchanged([pass("p1", p1), pass("p2", p2)]);
    expect(found).toHaveLength(1);
    expect(found[0]!.fatal).toBe(true);
    expect(found[0]!.kind).toBe("seed-moved");
  });

  it("ignores a redraw count, which is a fact about the call and not the tree", () => {
    const p1 = parentAndChildren({ splitAt: "b050", verdicts: ["finished", "finished"] });
    const p2 = parentAndChildren({ splitAt: "b050", verdicts: ["finished", "finished"] });
    p2[0] = record({ ...p2[0]!, retries: 2 });
    expect(wave1Unchanged([pass("p1", p1), pass("p2", p2)])).toEqual([]);
  });
});

/* ================================================ a repeat that was a repeat == */

describe("checking that a repeat bought its own wave", () => {
  const stats = (over: Partial<DeepenStats>): DeepenStats =>
    ({ ...NO_STATS, usage: { inputTokens: 5_000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 }, ...over }) as DeepenStats;

  it("is quiet on a repeat that really bought its calls", () => {
    expect(
      checkRepeatBoughtItsWave({
        label: "B repeat 2",
        stats: stats({ targets: 5, calls: 5, resumed: 0 }),
        ledgerHierarchyInputTokens: 5_200,
        structureInputTokensFloor: 50_000,
      }),
    ).toEqual([]);
  });

  /** The lever was not set, or named the wrong slug: free, silent, circular. */
  it("goes fatal when the wave resumed instead of buying", () => {
    const found = checkRepeatBoughtItsWave({
      label: "B repeat 2",
      stats: stats({ targets: 5, calls: 0, resumed: 5 }),
      ledgerHierarchyInputTokens: 0,
      structureInputTokensFloor: 50_000,
    });
    expect(found.map((f) => f.kind)).toEqual(["wave-not-rebought"]);
    expect(found[0]!.fatal).toBe(true);
    expect(found[0]!.message).toMatch(/BY CONSTRUCTION/);
  });

  /** And the mirror: the structure call was bought again, so the seed moved. */
  it("goes fatal when the ledger shows a whole structure call as well", () => {
    const found = checkRepeatBoughtItsWave({
      label: "B repeat 2",
      stats: stats({ targets: 5, calls: 5 }),
      ledgerHierarchyInputTokens: 5_000 + 900_000,
      structureInputTokensFloor: 50_000,
    });
    expect(found.map((f) => f.kind)).toEqual(["structure-rebought"]);
    expect(found[0]!.fatal).toBe(true);
  });

  it("says nothing about an article where nothing was eligible", () => {
    expect(
      checkRepeatBoughtItsWave({
        label: "C flag on",
        stats: stats({ targets: 0, calls: 0, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } as Partial<DeepenStats>),
        ledgerHierarchyInputTokens: 0,
        structureInputTokensFloor: 50_000,
      }),
    ).toEqual([]);
  });
});

/* ============================================================ questions 2-5 == */

describe("the yes rate", () => {
  it("keeps `nobody was asked` out of the denominator, and reports null rather than zero", () => {
    const r = yesRate([
      record({ where: "root > child 1", range: ["a", "b"], wave: 1, rawVerdict: null }),
      record({ where: "root > child 1 > child 1", range: ["a", "m"], rawVerdict: "needs-deeper" }),
      record({ where: "root > child 1 > child 2", range: ["m", "b"], rawVerdict: "finished" }),
    ]);
    expect(r).toMatchObject({ candidates: 3, asked: 2, yes: 1, no: 1, rate: 0.5 });
    expect(yesRate([record({ where: "root", range: ["a", "b"], rawVerdict: null })]).rate).toBeNull();
  });

  it("cuts by wave and by the size bands the bounds are made of", () => {
    const q = yesRates([
      record({ where: "root > child 1", range: ["a", "b"], wave: 1, rawVerdict: null, structuralBlocks: 40, bodyWords: 4000 }),
      record({ where: "root > child 1 > child 1", range: ["a", "m"], structuralBlocks: 4, bodyWords: 200, rawVerdict: "finished" }),
      record({ where: "root > child 1 > child 2", range: ["m", "b"], structuralBlocks: 20, bodyWords: 2500, rawVerdict: "needs-deeper" }),
    ]);
    expect(q.byWave.map((w) => w.wave)).toEqual([1, 2]);
    expect(q.byWave.find((w) => w.wave === 1)!.rate.rate).toBeNull();
    expect(q.bySize.find((b) => b.bucket.startsWith("under the floor"))!.rate.yes).toBe(0);
    expect(q.bySize.find((b) => b.bucket.includes("2000+"))!.rate.yes).toBe(1);
  });
});

describe("the bound tally", () => {
  it("prints every `because` including the zeroes, and only counts a real override", () => {
    const q = boundTally([
      /* Wave 1: nobody was asked, so this overrides nothing however loud the bound. */
      record({
        where: "root > child 1",
        range: ["a", "b"],
        wave: 1,
        rawVerdict: null,
        effective: { decision: "expand", because: "authored-heading" },
        overriddenBy: null,
      }),
      /* Asked, said finished, and the heading rule forced it open anyway. */
      record({
        where: "root > child 1 > child 1",
        range: ["a", "m"],
        rawVerdict: "finished",
        effective: { decision: "expand", because: "authored-heading" },
        overriddenBy: "authored-heading",
      }),
      /* Asked, and the verdict alone decided. */
      record({
        where: "root > child 1 > child 2",
        range: ["m", "b"],
        rawVerdict: "needs-deeper",
        effective: { decision: "expand", because: "verdict" },
        overriddenBy: null,
      }),
    ]);
    expect(q.because["authored-heading"]).toBe(2);
    expect(q.because["depth-cap"]).toBe(0);
    expect(q.assessed).toBe(2);
    expect(q.overruled).toBe(1);
    expect(q.decidedByVerdict).toBe(1);
    expect(q.reading).toMatch(/the weaker the case for the feature/);
  });

  it("says so plainly rather than dividing by nothing where no verdict exists", () => {
    const q = boundTally([record({ where: "root > child 1", range: ["a", "b"], wave: 1, rawVerdict: null })]);
    expect(q.assessed).toBe(0);
    expect(q.reading).toMatch(/says nothing about question 3/);
  });
});

describe("the cost report", () => {
  it("compares the book rows against the incumbent and never the article rows", () => {
    const q = costReport([
      { label: "A book ingest", nanos: 8_400_000_000, unpriced: 0, isBook: true },
      { label: "C article", nanos: 3_400_000_000, unpriced: 2, isBook: false },
    ]);
    expect(q.rows[0]!.vsIncumbent).toBeCloseTo(8.4);
    expect(q.rows[1]!.vsIncumbent).toBeNull();
    expect(q.rows[1]!.unpriced).toBe(2);
    expect(q.source).toMatch(/ledger/);
  });
});

describe("the budget report", () => {
  const clock = (over: Partial<Parameters<typeof budgetReport>[0]["clocks"][number]>) => ({
    slug: "book",
    label: "D book",
    ms: 100_000,
    outOfTime: 0,
    withheld: 0,
    resumed: 0,
    uncheckpointed: 0,
    ...over,
  });

  it("is quiet inside the budget", () => {
    const q = budgetReport({ clocks: [clock({})], budgetMs: 700_000, deadlineMs: 740_000 });
    expect(q.overBudget).toHaveLength(0);
    expect(q.reading).toMatch(/inside STEP_BUDGET_MS/);
  });

  it("names a step past the budget", () => {
    const q = budgetReport({ clocks: [clock({ ms: 800_000 })], budgetMs: 700_000, deadlineMs: 740_000 });
    expect(q.overBudget).toHaveLength(1);
  });

  /**
   * **No clock is an absence, not a pass**, and it read as one until
   * 2026-09-05: a step that never ran has `ms: null`, `overBudget` filters
   * those out, and the empty answer printed "every hierarchy step finished
   * inside the budget" over a phase where none of them ran at all.
   * docs/reusable/silent-success.md.
   */
  it("refuses to call a phase where nothing ran a clean bill", () => {
    const q = budgetReport({ clocks: [clock({ ms: null })], budgetMs: 700_000, deadlineMs: 740_000 });
    expect(q.measured).toBe(0);
    expect(q.overBudget).toHaveLength(0);
    expect(q.reading).toMatch(/not measured/);
    expect(q.reading).not.toMatch(/finished inside/);
  });

  /**
   * **A self-abort is only cheap if the rows landed.** `withheld` says the
   * answers are waiting; `uncheckpointed` says they are not, and the next
   * attempt buys them again — which is the difference between "it fitted, just"
   * and "it cost double".
   */
  it("tells a cheap self-abort from an expensive one", () => {
    const cheap = budgetReport({ clocks: [clock({ withheld: 4 })], budgetMs: 700_000, deadlineMs: 740_000 });
    expect(cheap.selfAborted).toHaveLength(1);
    expect(cheap.wasted).toHaveLength(0);
    const dear = budgetReport({
      clocks: [clock({ withheld: 4, uncheckpointed: 4 })],
      budgetMs: 700_000,
      deadlineMs: 740_000,
    });
    expect(dear.wasted).toHaveLength(1);
  });
});

/* ============================================================= phase C, inert == */

describe("the inertness check", () => {
  const base = {
    offWroteRecords: false,
    onWroteRecords: true,
    targetsWhenOn: 0,
    callsWhenOn: 0,
    treeBefore: "aaa",
    treeAfter: "aaa",
  };

  it("is quiet when the article really was untouched", () => {
    expect(checkInertness(base)).toEqual([]);
  });

  it("goes fatal when the tree moved", () => {
    expect(checkInertness({ ...base, treeAfter: "bbb" }).map((f) => f.kind)).toEqual(["not-inert"]);
  });

  /**
   * **"Nobody asked" and "asked and found nothing" are different facts**, and
   * the artefacts are what keep them apart: with the flag off there is no
   * records file at all. A file on the off side means the flag leaked.
   */
  it("goes fatal when the flag-off pass wrote records", () => {
    const found = checkInertness({ ...base, offWroteRecords: true });
    expect(found.map((f) => f.fatal)).toEqual([true]);
    expect(found[0]!.message).toMatch(/nobody asked/);
  });

  it("goes fatal when the flag-on pass wrote none, because then nothing was measured", () => {
    expect(checkInertness({ ...base, onWroteRecords: false }).map((f) => f.kind)).toEqual(["no-records"]);
  });

  it("calls an eligible section on the ordinary article a note, not a failure", () => {
    const found = checkInertness({ ...base, targetsWhenOn: 2 });
    expect(found).toHaveLength(1);
    expect(found[0]!.fatal).toBe(false);
  });

  it("goes fatal when nothing was eligible and a call was bought anyway", () => {
    expect(checkInertness({ ...base, callsWhenOn: 1 }).map((f) => f.fatal)).toEqual([true]);
  });
});

/* ================================================================ the levers == */

describe("the re-ask lever, against this run's own slugs", () => {
  const around = (value: string | undefined, fn: () => void): void => {
    const before = process.env[REASK_ENV];
    try {
      if (value === undefined) delete process.env[REASK_ENV];
      else process.env[REASK_ENV] = value;
      fn();
    } finally {
      if (before === undefined) delete process.env[REASK_ENV];
      else process.env[REASK_ENV] = before;
    }
  };

  it("accepts a value that names the book and neither article", () => {
    expect(() =>
      assertReaskNames({ envValue: "the-book", mustName: ["the-book"], mustNotName: ["a1", "a2"] }),
    ).not.toThrow();
  });

  /**
   * **The old boolean spelling, and it must mean nothing.** A harness that set
   * `1` and believed it would buy three repeats that all resumed and report a
   * perfect stability figure.
   */
  it("refuses the boolean spelling the variable used to take", () => {
    expect(() =>
      assertReaskNames({ envValue: "1", mustName: ["the-book"], mustNotName: [] }),
    ).toThrow(/does not name the-book/);
  });

  it("refuses an unset lever", () => {
    expect(() =>
      assertReaskNames({ envValue: undefined, mustName: ["the-book"], mustNotName: [] }),
    ).toThrow(/BY CONSTRUCTION/);
  });

  /** The P0 in the other direction: re-buying waves for articles nobody asked about. */
  it("refuses a list that also names an ordinary article", () => {
    expect(() =>
      assertReaskNames({ envValue: "the-book,a1", mustName: ["the-book"], mustNotName: ["a1"] }),
    ).toThrow(/also names a1/);
  });

  it("puts the environment back exactly as it found it, on both paths", () => {
    around("something-else", () => {
      expect(() => assertReaskNames({ envValue: "b", mustName: ["b"], mustNotName: [] })).not.toThrow();
      expect(process.env[REASK_ENV]).toBe("something-else");
      expect(() => assertReaskNames({ envValue: "b", mustName: ["c"], mustNotName: [] })).toThrow();
      expect(process.env[REASK_ENV]).toBe("something-else");
    });
    around(undefined, () => {
      expect(() => assertReaskNames({ envValue: "b", mustName: ["c"], mustNotName: [] })).toThrow();
      expect(process.env[REASK_ENV]).toBeUndefined();
    });
  });
});

describe("the seam proof's own assertions", () => {
  const ok: SeamProof = {
    cold: 2,
    repeatWithoutReask: 0,
    repeatWithReask: 2,
    readsWhileReasking: 0,
    namespaces: ["hierarchy-deepen"],
  };

  it("accepts the shape it is looking for", () => {
    expect(() => assertSeamProof(ok)).not.toThrow();
  });

  /* A probe that bought nothing proves nothing — and would pass every other
     assertion below it, which is why it is checked first. */
  it("refuses a probe that never reached the executor", () => {
    expect(() => assertSeamProof({ ...ok, cold: 0, repeatWithReask: 0 })).toThrow(/no calls at all/);
  });

  it("refuses a checkpoint layer that is not resuming", () => {
    expect(() => assertSeamProof({ ...ok, repeatWithoutReask: 2 })).toThrow(/not resuming/);
  });

  it("refuses a re-ask that did not buy every call again", () => {
    expect(() => assertSeamProof({ ...ok, repeatWithReask: 1 })).toThrow(/circular/);
  });

  it("refuses a re-ask that read and discarded instead of skipping the read", () => {
    expect(() => assertSeamProof({ ...ok, readsWhileReasking: 2 })).toThrow(/skips the read/);
  });

  /* The half that would otherwise be taken on trust: if the deepening path
     touched `hierarchy-structure`, the seed would not be safe across repeats. */
  it("refuses a deepening path that touched the structure checkpoint", () => {
    expect(() =>
      assertSeamProof({ ...ok, namespaces: ["hierarchy-deepen", "hierarchy-structure"] }),
    ).toThrow(/holds the seed constant/);
  });
});

describe("the recording checkpoint store", () => {
  it("records the namespace of every read and write, and refuses what the real one refuses", async () => {
    const store = recordingCheckpoints({ slug: "s", articleId: "a" });
    await store.write("s", "hierarchy-deepen", "abc", { v: 1 });
    expect(await store.read("s", "hierarchy-deepen", ["abc"])).toEqual(new Map([["abc", { v: 1 }]]));
    expect([...store.namespaces()]).toEqual(["hierarchy-deepen"]);
    /* Bound to one article, exactly as the real store is. */
    await expect(store.read("other", "hierarchy-deepen", ["abc"])).rejects.toThrow(/bound to/);
    await expect(store.write("s", "hierarchy-deepen", "NOT A KEY", {})).rejects.toThrow(/usable checkpoint key/);
  });

  it("round-trips through JSON, so nothing passes on reference equality", async () => {
    const store = recordingCheckpoints({ slug: "s", articleId: "a" });
    const value = { when: new Date(0) };
    await store.write("s", "hierarchy-deepen", "k", value);
    const back = await store.read<{ when: string }>("s", "hierarchy-deepen", ["k"]);
    expect(back.get("k")!.when).toBe("1970-01-01T00:00:00.000Z");
  });
});

/* ================================================================= the files == */

describe("reading a records file back", () => {
  const good = JSON.stringify({
    version: RECORDS_VERSION,
    slug: "book",
    writtenAt: "2026-09-05T00:00:00.000Z",
    failed: false,
    reason: null,
    stats: NO_STATS,
    records: [],
  });

  it("takes the version it was written for", () => {
    expect(parseRecordsFile(good, "f.json").slug).toBe("book");
  });

  /**
   * **The version refusal earns its place**, and it is not tidiness:
   * `deepen-records/1` carries no `range` on its candidates, so a `/1` file read
   * as a `/2` would fall through to a comparison that cannot pair anything.
   */
  it("refuses the older format by name, and says why", () => {
    const older = good.replace(RECORDS_VERSION, "deepen-records/1");
    expect(() => parseRecordsFile(older, "f.json")).toThrow(/carries no `range`/);
  });

  it("refuses a file that is missing what it is for", () => {
    const empty = JSON.stringify({ version: RECORDS_VERSION, slug: "book", writtenAt: "x", stats: NO_STATS });
    expect(() => parseRecordsFile(empty, "f.json")).toThrow(/records is missing/);
  });

  /**
   * **The tenth pass must not sort between the first and the second**, which is
   * what a lexical sort of `…-<pid>-<n>.json` does — and repeat order is the
   * ordering the whole stability comparison is made in.
   */
  it("orders passes by when they were written, not by their names", () => {
    const at = (file: string, writtenAt: string) =>
      ({ file, parsed: { writtenAt } }) as Parameters<typeof byWhenWritten>[0];
    const files = [
      at("book-2026-09-05-00-00-00-1-10.json", "2026-09-05T00:10:00.000Z"),
      at("book-2026-09-05-00-00-00-1-2.json", "2026-09-05T00:02:00.000Z"),
      at("book-2026-09-05-00-00-00-1-1.json", "2026-09-05T00:01:00.000Z"),
    ];
    expect([...files].sort(byWhenWritten).map((f) => f.file.slice(-7))).toEqual(["-1.json", "-2.json", "10.json"]);
    /* And the lexical sort this replaced gets it wrong, which is why it was replaced. */
    expect([...files].map((f) => f.file).sort()[1]).toContain("-10.json");
  });
});

describe("the tree digest", () => {
  it("ignores key order and nothing else", () => {
    expect(treeDigest({ a: 1, b: { c: 2, d: 3 } })).toBe(treeDigest({ b: { d: 3, c: 2 }, a: 1 }));
    expect(treeDigest({ a: 1 })).not.toBe(treeDigest({ a: 2 }));
    /* Array order is meaning — a tree's children are ordered — so it must not be sorted away. */
    expect(treeDigest({ a: [1, 2] })).not.toBe(treeDigest({ a: [2, 1] }));
  });
});

describe("the estimate", () => {
  it("adds up what it says it will buy, and carries the provenance of every figure", () => {
    const e = estimate({
      bookIngestDeepened: 1,
      bookHierarchyRepeat: 3,
      articleIngestDeepened: 3,
      articleHierarchyResumed: 1,
    });
    expect(e.totalUsd).toBeCloseTo(8.4 + 3 * 7.4 + 3 * 3.4 + 0.1);
    expect(e.rows.every((r) => r.basis.length > 0)).toBe(true);
    expect(e.caveat).toMatch(/UPPER BOUND/);
  });

  it("drops the rows this run will not buy, rather than printing them at zero", () => {
    const e = estimate({
      bookIngestDeepened: 1,
      bookHierarchyRepeat: 0,
      articleIngestDeepened: 0,
      articleHierarchyResumed: 0,
    });
    expect(e.rows).toHaveLength(1);
    expect(e.totalUsd).toBeCloseTo(8.4);
  });
});

/* ================================================================ the driving == */

/**
 * **The four ways the driving has been wrong, or could be.**
 *
 * The first of them is not hypothetical: the harness's first `--dry-run` sent
 * one of phase D's three jobs to the real network, because overlapping
 * `enqueue` calls raced on the single global variable that silences the
 * in-process pump. That job ran production's stage 1 with no eval overlay. The
 * check below is what would have said so; these cases are what stop it going
 * quiet again.
 */
describe("the driving", () => {
  const job = (over: Partial<DrivenJob>): DrivenJob => ({
    phase: "D",
    label: "a job",
    slug: "s",
    force: [],
    createdArticle: true,
    startedAt: "2026-09-05T00:00:00.000Z",
    finishedAt: "2026-09-05T00:00:10.000Z",
    stepOutcomes: [{ name: "fetch", status: "done", detail: "1382 KB (fixture book)" }],
    ...over,
  });

  it("is quiet on a run that behaved", () => {
    expect(
      checkDriving([
        job({ phase: "B", startedAt: "2026-09-05T00:00:00.000Z", finishedAt: "2026-09-05T00:00:05.000Z" }),
        job({ phase: "B", startedAt: "2026-09-05T00:00:06.000Z", finishedAt: "2026-09-05T00:00:09.000Z" }),
        job({ phase: "D", startedAt: "2026-09-05T00:00:10.000Z", finishedAt: "2026-09-05T00:00:20.000Z" }),
        job({ phase: "D", startedAt: "2026-09-05T00:00:11.000Z", finishedAt: "2026-09-05T00:00:19.000Z" }),
      ]),
    ).toEqual([]);
  });

  /**
   * **The check reads the fixture step's own detail, not the error**, and this
   * case is why: the queue replaces a failed step's message with a
   * reader-facing sentence, so the words `ENOTFOUND` never reach the record.
   * The first version of this check matched the error text, and it was watched
   * printing "none" over a run where **every single fetch had gone to the real
   * network**. docs/reusable/silent-success.md.
   */
  it("goes fatal when stage 1 was not the fixture step, however the failure was worded", () => {
    const found = checkDriving([
      job({
        slug: "load1",
        stepOutcomes: [
          {
            name: "fetch",
            status: "error",
            error: "Fetching the page did not finish. What went wrong has been recorded […]",
          },
        ],
      }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]!.fatal).toBe(true);
    expect(found[0]!.message).toMatch(/PRODUCTION stage 1/);
  });

  /* And the case that would slip past a status check alone: production's stage 1
     succeeded, because the URL happened to resolve. Only the detail tells them
     apart. */
  it("goes fatal when stage 1 succeeded but was not the fixture step", () => {
    const found = checkDriving([
      job({ slug: "load1", stepOutcomes: [{ name: "fetch", status: "done", detail: "200 OK, 41 KB" }] }),
    ]);
    expect(found.map((f) => f.fatal)).toEqual([true]);
  });

  /* A job with no ingress — a forced re-run — runs no `fetch` at all, and must
     not be held to a step it was never given. */
  it("does not ask a forced re-run for a fixture read it never had", () => {
    expect(
      checkDriving([
        job({ createdArticle: false, force: ["blocks"], stepOutcomes: [{ name: "blocks", status: "done" }] }),
      ]),
    ).toEqual([]);
  });

  it("goes fatal when two repeats overlapped, because a contended repeat confounds question 1", () => {
    const found = checkDriving([
      job({ phase: "B", label: "r2", startedAt: "2026-09-05T00:00:00.000Z", finishedAt: "2026-09-05T00:00:10.000Z" }),
      job({ phase: "B", label: "r3", startedAt: "2026-09-05T00:00:05.000Z", finishedAt: "2026-09-05T00:00:15.000Z" }),
    ]);
    expect(found.map((f) => f.fatal)).toEqual([true]);
    expect(found[0]!.message).toMatch(/serial deliberately/);
  });

  it("says so when the load phase did not overlap, rather than reporting a budget it never tested", () => {
    const found = checkDriving([
      job({ phase: "D", startedAt: "2026-09-05T00:00:00.000Z", finishedAt: "2026-09-05T00:00:05.000Z" }),
      job({ phase: "D", startedAt: "2026-09-05T00:00:06.000Z", finishedAt: "2026-09-05T00:00:09.000Z" }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]!.fatal).toBe(false);
    expect(found[0]!.message).toMatch(/nothing was measured under load/);
  });

  it("goes fatal when a forced step was skipped on its stamp", () => {
    const found = checkDriving([
      job({ createdArticle: false, force: ["hierarchy"], stepOutcomes: [{ name: "hierarchy", status: "skipped" }] }),
    ]);
    expect(found.map((f) => f.fatal)).toEqual([true]);
    expect(found[0]!.message).toMatch(/bought nothing and measured nothing/);
  });

  it("goes fatal when the force named a step the job has not got", () => {
    const found = checkDriving([
      job({ createdArticle: false, force: ["hierarchy"], stepOutcomes: [{ name: "blocks", status: "done" }] }),
    ]);
    expect(found.map((f) => f.fatal)).toEqual([true]);
  });

  /* A window that was never recorded must not read as "did not overlap" — the
     absence of a measurement is its own thing, and a job that crashed before it
     started has no window. */
  it("does not call a missing window an overlap in either direction", () => {
    const found = checkDriving([
      job({ phase: "B", startedAt: undefined, finishedAt: undefined }),
      job({ phase: "B", startedAt: undefined, finishedAt: undefined }),
    ]);
    expect(found).toEqual([]);
  });
});
