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
  abandonStep,
  ABANDONED_MARKER,
  assertReaskNames,
  assertSeamProof,
  assertStepPlansRunnable,
  byWhenWritten,
  checkpointWriter,
  estimate,
  formatEstimate,
  jobIntegrityFindings,
  loadReadiness,
  parseRecordsFile,
  readRecordsDir,
  RECORDS_VERSION,
  recordingCheckpoints,
  recordsFilePrefix,
  type RendezvousOutcome,
  requeueVerdict,
  type SeamProof,
  startRendezvous,
  type StepPlans,
  treeDigest,
} from "../evals/deepen/harness.js";
import {
  asDeepenFinding,
  boundTally,
  budgetReport,
  checkDriving,
  checkInertness,
  checkRepeatBoughtItsWave,
  compareRepeats,
  costReport,
  type DrivenJob,
  parentPath,
  peakConcurrency,
  q1Gate,
  rangeOf,
  type RecordsPass,
  requireRanges,
  usablePasses,
  verdictGate,
  wave1Unchanged,
  yesRate,
  yesRates,
  formatDriving,
} from "../evals/deepen/report.js";
import { REASK_ENV } from "../src/hierarchy-deepen.js";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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

function pass(label: string, records: CandidateRecord[], over: Partial<RecordsPass> = {}): RecordsPass {
  return {
    label,
    slug: "book",
    writtenAt: "2026-09-05T00:00:00.000Z",
    stats: NO_STATS,
    records,
    failed: false,
    reason: null,
    file: `${label}.json`,
    phase: "B",
    ...over,
  };
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

  /**
   * **DPN-13 — the two rows that are NOT disjoint, and must not be made so.**
   *
   * A parent with equal fan-out whose first boundary moved and whose second
   * child kept its range and changed its verdict is in `boundariesMoved` and in
   * `verdictFlips` at once. Both facts are true; adding a `continue` to make
   * them disjoint would discard the flip, which is the number stage 6 leans on.
   * So the overlap is counted and printed instead.
   *
   * ⟨GPT Sol was right and Greg's earlier instruction to make them disjoint was
   * wrong; this test is what stops somebody "tidying" it back.⟩
   */
  it("keeps a moved boundary and a surviving child's flip as two overlapping facts", () => {
    const parent = record({
      where: "root > child 1",
      range: ["b001", "b100"],
      wave: 1,
      depth: 1,
      rawVerdict: null,
      effective: { decision: "expand", because: "authored-heading" },
      fanOut: 3,
    });
    const three = (splitAt: string, lastVerdict: string): CandidateRecord[] => [
      parent,
      record({ where: "root > child 1 > child 1", range: ["b001", splitAt] }),
      record({ where: "root > child 1 > child 2", range: [splitAt, "b070"] }),
      /* The survivor: same range in both passes, and its verdict moves. */
      record({
        where: "root > child 1 > child 3",
        range: ["b070", "b100"],
        rawVerdict: lastVerdict as CandidateRecord["rawVerdict"],
      }),
    ];
    const q = compareRepeats([
      pass("p1", three("b040", "finished")),
      pass("p2", three("b050", "needs-deeper")),
    ]);
    expect(q.fanOutChanged).toHaveLength(0);
    expect(q.boundariesMoved).toHaveLength(1);
    expect(q.rangesMatched).toBe(1);
    expect(q.verdictFlips).toHaveLength(1);
    /* Both, and said so — never subtracted from either row. */
    expect(q.bothMovedAndFlipped).toBe(1);
  });

  it("counts no overlap where the boundaries held", () => {
    const q = compareRepeats([
      pass("p1", parentAndChildren({ splitAt: "b050", verdicts: ["finished", "finished"] })),
      pass("p2", parentAndChildren({ splitAt: "b050", verdicts: ["finished", "needs-deeper"] })),
    ]);
    expect(q.verdictFlips).toHaveLength(1);
    expect(q.bothMovedAndFlipped).toBe(0);
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
        structure: "resumed",
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
      structure: "resumed",
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
      structure: "resumed",
    });
    expect(found.map((f) => f.kind)).toEqual(["structure-rebought"]);
    expect(found[0]!.fatal).toBe(true);
  });

  /**
   * **DPN-08, pinned to the measured artefact rather than to a plausible
   * number.** `evals/results/hierarchy-waves-2026-09-04/2701-h.tree.json` records
   * Moby-Dick's whole-document structure call at 453,832 input tokens, and the
   * runner's floor for a 2,569-block document is 256,900. Phase A buys that
   * call — it is the ingest, and buying the seed is the whole point of it — so
   * applying the repeat-only guard there meant a SUCCESSFUL $40.90 run would
   * have spent the money and then reported `structure-rebought` fatally.
   */
  const MOBY_STRUCTURE_INPUT_TOKENS = 453_832;
  const MOBY_STRUCTURE_FLOOR = 256_900;

  it("does not accuse the ingest of re-buying the structure call it exists to buy", () => {
    const found = checkRepeatBoughtItsWave({
      label: "A book ingest, deepening on (repeat 1)",
      stats: stats({ targets: 12, calls: 12 }),
      ledgerHierarchyInputTokens: MOBY_STRUCTURE_INPUT_TOKENS + 5_000,
      structureInputTokensFloor: MOBY_STRUCTURE_FLOOR,
      structure: "bought",
    });
    expect(found.filter((f) => f.kind === "structure-rebought")).toEqual([]);
    expect(found.filter((f) => f.fatal)).toEqual([]);
  });

  /* And the same arithmetic pointed the other way: an ingest whose hierarchy
     bill shows no whole-document call resumed a seed from somewhere else. A
     note, because the repeats are still comparable with each other. */
  it("says so, non-fatally, when the ingest did not buy a structure call at all", () => {
    const found = checkRepeatBoughtItsWave({
      label: "A book ingest",
      stats: stats({ targets: 12, calls: 12 }),
      ledgerHierarchyInputTokens: 5_100,
      structureInputTokensFloor: MOBY_STRUCTURE_FLOOR,
      structure: "bought",
    });
    expect(found).toHaveLength(1);
    expect(found[0]!.fatal).toBe(false);
    expect(found[0]!.message).toMatch(/resumed a structure checkpoint/);
  });

  /* The repeat, with the very same numbers, IS the failure — which is what
     makes `structure` the whole of the difference. */
  it("still goes fatal when a REPEAT carries Moby-Dick's structure call", () => {
    const found = checkRepeatBoughtItsWave({
      label: "B repeat 2",
      stats: stats({ targets: 12, calls: 12 }),
      ledgerHierarchyInputTokens: MOBY_STRUCTURE_INPUT_TOKENS + 5_000,
      structureInputTokensFloor: MOBY_STRUCTURE_FLOOR,
      structure: "resumed",
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
        structure: "resumed",
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
      { label: "A book ingest", nanos: 8_400_000_000, unpriced: 0, unreadable: 0, isBook: true },
      { label: "C article", nanos: 3_400_000_000, unpriced: 0, unreadable: 0, isBook: false },
    ]);
    expect(q.rows[0]!.vsIncumbent).toBeCloseTo(8.4);
    expect(q.rows[1]!.vsIncumbent).toBeNull();
    expect(q.totalNanos).toBe(11_800_000_000);
    expect(q.answerable).toBe(true);
    expect(q.source).toMatch(/ledger/);
  });

  /**
   * **DPN-02.** The runner filtered out every job whose ledger read had not
   * completed — `.filter(j.money !== undefined)` — so a job whose read failed
   * simply vanished from the bill and question 4 reported a plausible, smaller
   * number. A missing row and a zero row are indistinguishable in a sum, so the
   * row survives as `null` and the answer refuses.
   */
  it("keeps a job whose ledger was never read, as UNKNOWN rather than as absent", () => {
    const q = costReport([
      { label: "A book ingest", nanos: 8_400_000_000, unpriced: 0, unreadable: 0, isBook: true },
      { label: "D article 2", nanos: null, unpriced: 0, unreadable: 0, isBook: false },
    ]);
    expect(q.rows).toHaveLength(2);
    expect(q.rows[1]!.nanos).toBeNull();
    expect(q.rows[1]!.vsIncumbent).toBeNull();
    expect(q.answerable).toBe(false);
    expect(q.findings.map((f) => f.fatal)).toEqual([true]);
    expect(q.findings[0]!.message).toMatch(/UNKNOWN/);
    /* The total is what WAS read, and the format says it is a floor. */
    expect(q.totalNanos).toBe(8_400_000_000);
  });

  it("refuses a bill carrying an unpriced or unreadable call", () => {
    expect(
      costReport([{ label: "A", nanos: 1, unpriced: 2, unreadable: 0, isBook: false }]).answerable,
    ).toBe(false);
    expect(
      costReport([{ label: "A", nanos: 1, unpriced: 0, unreadable: 3, isBook: false }]).answerable,
    ).toBe(false);
  });

  /* An empty table is an absence and read exactly like a measured zero. */
  it("refuses an empty table rather than printing a bill of nothing", () => {
    const q = costReport([]);
    expect(q.totalNanos).toBeNull();
    expect(q.answerable).toBe(false);
    expect(q.findings[0]!.message).toMatch(/no rows at all/);
  });
});

describe("the budget report", () => {
  const clock = (over: Partial<Parameters<typeof budgetReport>[0]["clocks"][number]>) => ({
    slug: "book",
    label: "D book",
    ms: 100_000,
    status: "done",
    startedAt: "2026-09-05T00:00:00.000Z",
    finishedAt: "2026-09-05T00:01:40.000Z",
    hasSuccessfulStats: true,
    outOfTime: 0,
    withheld: 0,
    resumed: 0,
    uncheckpointed: 0,
    ...over,
  });

  /** Three steps that really did run at once, which is what phase D is for. */
  const threeAtOnce = [
    clock({ label: "D book" }),
    clock({ label: "D article 1", startedAt: "2026-09-05T00:00:01.000Z", finishedAt: "2026-09-05T00:01:30.000Z" }),
    clock({ label: "D article 2", startedAt: "2026-09-05T00:00:02.000Z", finishedAt: "2026-09-05T00:01:20.000Z" }),
  ];

  it("is quiet inside the budget when all three really overlapped", () => {
    const q = budgetReport({ clocks: threeAtOnce, budgetMs: 700_000, deadlineMs: 740_000, expected: 3 });
    expect(q.answerable).toBe(true);
    expect(q.peakConcurrency).toBe(3);
    expect(q.overBudget).toHaveLength(0);
    expect(q.reading).toMatch(/inside STEP_BUDGET_MS/);
  });

  it("names a step past the budget", () => {
    const q = budgetReport({
      clocks: [clock({ ms: 800_000, finishedAt: "2026-09-05T00:13:20.000Z" }), ...threeAtOnce.slice(1)],
      budgetMs: 700_000,
      deadlineMs: 740_000,
      expected: 3,
    });
    expect(q.answerable).toBe(true);
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
    const q = budgetReport({
      clocks: [clock({ ms: null, status: null, startedAt: null, finishedAt: null, hasSuccessfulStats: false })],
      budgetMs: 700_000,
      deadlineMs: 740_000,
      expected: 3,
    });
    expect(q.measured).toBe(0);
    expect(q.completed).toBe(0);
    expect(q.answerable).toBe(false);
    expect(q.overBudget).toHaveLength(0);
    expect(q.reading).toMatch(/NOT measured/);
    expect(q.reading).not.toMatch(/finished inside/);
  });

  /**
   * **DPN-03 — a step that started and failed carries both timestamps.** All
   * three phase-D hierarchy steps can start, fail in a second, and be counted
   * as three measurements: `budgetReport` printed *"All 3 hierarchy steps
   * finished inside STEP_BUDGET_MS.hierarchy"* over a phase in which nothing
   * finished at all. `status` and `hasSuccessfulStats` are what tell a completed step
   * from a fast failure.
   */
  it("refuses three fast failures, which each carry a clock", () => {
    const failed = threeAtOnce.map((c) => clock({ ...c, status: "error", ms: 900, hasSuccessfulStats: false }));
    const q = budgetReport({ clocks: failed, budgetMs: 700_000, deadlineMs: 740_000, expected: 3 });
    expect(q.measured).toBe(3);
    expect(q.completed).toBe(0);
    expect(q.answerable).toBe(false);
    expect(q.reading).not.toMatch(/finished inside/);
    expect(q.findings.map((f) => f.fatal)).toEqual([true]);
    expect(q.findings[0]!.message).toMatch(/started and failed carries both timestamps/);
  });

  /**
   * **DPN-03-R — the case that gets past `status` AND past "stats exist".**
   *
   * A wave that exhausts its redraws throws `DeepenFailed`; `generateHierarchy`
   * catches it, writes a records file with `failed: true`, falls back to the
   * wave-1 tree, generates labels and **completes the `hierarchy` step**. So all
   * three phase-D steps are `done`, all three carry a real clock, all three
   * carry `stats`, and all three genuinely overlapped — and every number
   * question 5 printed was a measurement of the FALLBACK path.
   *
   * The old field meant `j.stats != null`, which is true of every one of them.
   * `hasSuccessfulStats` is `j.stats != null && j.waveFailed === false`, and the
   * name is positive so that reading the caller tells you what it asserts.
   */
  it("refuses three waves that FAILED, completed the step and finished inside the budget", () => {
    const fellBack = threeAtOnce.map((c) => clock({ ...c, hasSuccessfulStats: false }));
    const q = budgetReport({ clocks: fellBack, budgetMs: 700_000, deadlineMs: 740_000, expected: 3 });
    expect(q.measured).toBe(3);
    /* Every one is `done`, inside the budget and overlapping its two siblings —
       the three things question 5 asks — and it is still not an answer. */
    expect(fellBack.every((c) => c.status === "done" && (c.ms ?? 0) < 700_000)).toBe(true);
    expect(peakConcurrency(fellBack)).toBe(3);
    expect(q.completed).toBe(0);
    expect(q.answerable).toBe(false);
    expect(q.reading).toMatch(/NOT measured/);
    expect(q.reading).not.toMatch(/finished inside/);
    expect(q.findings[0]!.message).toMatch(/fallback tree/);
  });

  /* One measured clock out of three used to print "All 1 ...". */
  it("refuses one measurement where three were expected", () => {
    const q = budgetReport({
      clocks: [threeAtOnce[0]!, clock({ ...threeAtOnce[1]!, status: "error", hasSuccessfulStats: false })],
      budgetMs: 700_000,
      deadlineMs: 740_000,
      expected: 3,
    });
    expect(q.completed).toBe(1);
    expect(q.answerable).toBe(false);
  });

  /**
   * **DPN-04 - the whole-job windows overlap even when the steps do not.** At
   * `SPIDERYARN_JOB_CONCURRENCY=1` all three `driveJob` promises stay alive
   * while two of them are told `busy`, so a pairwise "did any two overlap"
   * passes over a phase that ran serially. The concurrency is over the STEPS'
   * own windows and has to reach three.
   */
  it("refuses three steps that ran one after another, however long they were alive", () => {
    const serial = [
      clock({ label: "D 1", startedAt: "2026-09-05T00:00:00.000Z", finishedAt: "2026-09-05T00:01:00.000Z" }),
      clock({ label: "D 2", startedAt: "2026-09-05T00:01:00.000Z", finishedAt: "2026-09-05T00:02:00.000Z" }),
      clock({ label: "D 3", startedAt: "2026-09-05T00:02:00.000Z", finishedAt: "2026-09-05T00:03:00.000Z" }),
    ];
    const q = budgetReport({ clocks: serial, budgetMs: 700_000, deadlineMs: 740_000, expected: 3 });
    expect(q.completed).toBe(3);
    expect(q.peakConcurrency).toBe(1);
    expect(q.answerable).toBe(false);
    expect(q.findings[0]!.message).toMatch(/UNDER LOAD/);
  });

  /* And the case that a pairwise check would have passed: two of three. */
  it("refuses two-of-three overlapping, which one overlapping pair looks exactly like", () => {
    const partly = [
      clock({ label: "D 1", startedAt: "2026-09-05T00:00:00.000Z", finishedAt: "2026-09-05T00:01:00.000Z" }),
      clock({ label: "D 2", startedAt: "2026-09-05T00:00:30.000Z", finishedAt: "2026-09-05T00:01:30.000Z" }),
      clock({ label: "D 3", startedAt: "2026-09-05T00:02:00.000Z", finishedAt: "2026-09-05T00:03:00.000Z" }),
    ];
    const q = budgetReport({ clocks: partly, budgetMs: 700_000, deadlineMs: 740_000, expected: 3 });
    expect(q.peakConcurrency).toBe(2);
    expect(q.answerable).toBe(false);
  });

  /**
   * **A self-abort is only cheap if the rows landed.** `withheld` says the
   * answers are waiting; `uncheckpointed` says they are not, and the next
   * attempt buys them again - which is the difference between "it fitted, just"
   * and "it cost double".
   */
  it("tells a cheap self-abort from an expensive one", () => {
    const cheap = budgetReport({
      clocks: [clock({ withheld: 4 })],
      budgetMs: 700_000,
      deadlineMs: 740_000,
      expected: 1,
    });
    expect(cheap.selfAborted).toHaveLength(1);
    expect(cheap.wasted).toHaveLength(0);
    const dear = budgetReport({
      clocks: [clock({ withheld: 4, uncheckpointed: 4 })],
      budgetMs: 700_000,
      deadlineMs: 740_000,
      expected: 1,
    });
    expect(dear.wasted).toHaveLength(1);
  });
});

describe("peak concurrency", () => {
  const w = (from: string, to: string) => ({ startedAt: from, finishedAt: to });

  it("counts what was in flight at once, not what overlapped at all", () => {
    expect(peakConcurrency([w("2026-01-01T00:00:00Z", "2026-01-01T00:00:10Z")])).toBe(1);
    /* Two overlapping and a third alone: one overlapping PAIR, peak 2. */
    expect(
      peakConcurrency([
        w("2026-01-01T00:00:00Z", "2026-01-01T00:00:10Z"),
        w("2026-01-01T00:00:05Z", "2026-01-01T00:00:15Z"),
        w("2026-01-01T00:00:20Z", "2026-01-01T00:00:30Z"),
      ]),
    ).toBe(2);
  });

  /* Windows that touch at a point were never concurrent, and calling them so
     would let a serialised phase D report the concurrency it never had. */
  it("does not call two windows that merely touch concurrent", () => {
    expect(
      peakConcurrency([
        w("2026-01-01T00:00:00Z", "2026-01-01T00:00:10Z"),
        w("2026-01-01T00:00:10Z", "2026-01-01T00:00:20Z"),
      ]),
    ).toBe(1);
  });

  it("ignores a window with no end rather than treating it as open for ever", () => {
    expect(
      peakConcurrency([
        w("2026-01-01T00:00:00Z", "2026-01-01T00:00:10Z"),
        { startedAt: "2026-01-01T00:00:01Z", finishedAt: null },
        { startedAt: undefined, finishedAt: undefined },
      ]),
    ).toBe(1);
  });
});


/* ======================================================= the answerability gates == */

/**
 * **Every one of Q1-Q5 could print a clean-looking number over evidence that
 * was absent, partial or failed.** That is the same disease `budgetReport` was
 * caught with, and the review found it in four more places: a failed pass's
 * partial records aggregated as though whole (DPN-05), and `0 of 0` printing as
 * a flip rate of none (DPN-11). docs/reusable/silent-success.md.
 */
describe("the answerability gates", () => {
  const empty = (label: string, over: Partial<RecordsPass> = {}) => pass(label, [], over);

  it("splits the failed passes off from the usable ones", () => {
    const split = usablePasses([empty("A r1"), empty("B r2", { failed: true, reason: "429s" })]);
    expect(split.usable.map((p) => p.label)).toEqual(["A r1"]);
    expect(split.failed.map((p) => p.label)).toEqual(["B r2"]);
  });

  /**
   * **DPN-05.** A wave that threw still writes a records file, with the
   * governor's decisions and the bill and no expansion. The runner dropped the
   * flag on the floor between the file and the comparison, so those partial
   * records were aggregated beside a whole pass's.
   */
  it("goes fatal on a book pass whose wave threw, rather than quoting it", () => {
    const found = q1Gate({
      expectedPasses: 3,
      usable: [empty("A r1"), empty("B r2")],
      failed: [empty("B r3", { failed: true, reason: "the executor threw" })],
      stability: null,
    });
    expect(found.map((f) => f.kind)).toEqual(["wave-failed", "not-answerable"]);
    expect(found.every((f) => f.fatal)).toBe(true);
    expect(found[0]!.message).toMatch(/the executor threw/);
  });

  it("is quiet when every pass the run set out to make is there and whole", () => {
    expect(
      q1Gate({
        expectedPasses: 2,
        usable: [empty("A r1"), empty("B r2")],
        failed: [],
        stability: {
          passes: 2,
          parentsCompared: 1,
          parentsPartial: 0,
          fanOutChanged: [],
          boundariesMoved: [],
          rangesMatched: 4,
          verdictFlips: [],
          bothMovedAndFlipped: 0,
          unpairable: 0,
        },
      }),
    ).toEqual([]);
  });

  /**
   * **DPN-11 — `0 of 0` prints as a flip rate of none.** Two records files that
   * matched no wave-2 range at all produced `1. verdict flips 0 of 0 matched
   * range(s)` and no finding, which reads as a perfectly stable signal.
   */
  it("goes fatal when the comparison matched nothing and found no instability either", () => {
    const found = q1Gate({
      expectedPasses: 2,
      usable: [empty("A r1"), empty("B r2")],
      failed: [],
      stability: {
        passes: 2,
        parentsCompared: 0,
        parentsPartial: 0,
        fanOutChanged: [],
        boundariesMoved: [],
        rangesMatched: 0,
        verdictFlips: [],
        bothMovedAndFlipped: 0,
        unpairable: 0,
      },
    });
    expect(found.map((f) => f.kind)).toEqual(["not-answerable"]);
    expect(found[0]!.message).toMatch(/measured nothing at all/);
  });

  /* But a run whose every parent changed fan-out DID measure something, and an
     empty flip rate is that measurement's answer rather than its absence. */
  it("accepts a comparison that matched nothing because everything moved structurally", () => {
    expect(
      q1Gate({
        expectedPasses: 2,
        usable: [empty("A r1"), empty("B r2")],
        failed: [],
        stability: {
          passes: 2,
          parentsCompared: 2,
          parentsPartial: 0,
          fanOutChanged: [{ parent: "a..b", whereFirstSeen: "root", perPass: [] }],
          boundariesMoved: [],
          rangesMatched: 0,
          verdictFlips: [],
          bothMovedAndFlipped: 0,
          unpairable: 0,
        },
      }),
    ).toEqual([]);
  });

  it("refuses a stability figure over fewer passes than the run set out to make", () => {
    const found = q1Gate({ expectedPasses: 3, usable: [empty("A r1"), empty("B r2")], failed: [], stability: null });
    expect(found.map((f) => f.kind)).toEqual(["not-answerable"]);
    expect(found[0]!.message).toMatch(/needs 3 usable pass/);
  });

  /* Q2 and Q3 both divide by a count of verdicts, and both printed a dash. */
  it("refuses a yes rate and a bound tally taken over no verdicts at all", () => {
    const found = verdictGate({ question: "Question 2", assessed: 0, failed: [empty("B r3", { failed: true })] });
    expect(found.map((f) => f.fatal)).toEqual([true]);
    expect(found[0]!.message).toMatch(/absence and must not be read as a measured zero/);
    expect(verdictGate({ question: "Question 3", assessed: 1, failed: [] })).toEqual([]);
  });
});

/* ==================================================== the cost eval's findings == */

describe("the cost eval's checks, in this eval's vocabulary", () => {
  it("keeps a scope leak and a short ledger fatal, and names the step", () => {
    expect(
      asDeepenFinding({ kind: "scope-leak", step: null, fatal: true, message: "billed to Product" }),
    ).toEqual({ kind: "scope-leak", fatal: true, message: "billed to Product" });
    expect(
      asDeepenFinding({ kind: "ledger-short", step: "hierarchy", fatal: true, message: "3 rows missing" }),
    ).toEqual({ kind: "ledger-short", fatal: true, message: "hierarchy: 3 rows missing" });
  });
});

/* =================================================== the requeue, refused == */

/**
 * **DPN-07 — one nominal re-ask could buy the wave three times.**
 *
 * A claimant that reaches its own 740s deadline inside `hierarchy` requeues the
 * job, and `driveToDone` re-claimed it immediately — with the slug still named
 * in `SPIDERYARN_DEEPEN_REASK`, so the next claim ignored the checkpoint rows
 * just written and bought the wave again. `REQUEUE_BUDGET = 2` permits three
 * windows, and none of it was in the printed $40.90.
 */
describe("what to do when the claimant hands the job back", () => {
  it("stops a re-asking pass on its first requeue", () => {
    expect(requeueVerdict({ reasking: true, requeuesBefore: 0, requeuesNow: 1 })).toBe("stop");
    expect(requeueVerdict({ reasking: true, requeuesBefore: 1, requeuesNow: 2 })).toBe("stop");
  });

  /* An ordinary pass is re-driven and MUST be: a book's hierarchy step needs
     658-778s against a 740s deadline, so a requeue there is routine, and
     without the lever the re-drive resumes what it has already paid for. */
  it("carries on driving a pass the lever does not name", () => {
    expect(requeueVerdict({ reasking: false, requeuesBefore: 0, requeuesNow: 1 })).toBe("carry on");
  });

  it("carries on where nothing was requeued at all, which is the ordinary answer", () => {
    expect(requeueVerdict({ reasking: true, requeuesBefore: 2, requeuesNow: 2 })).toBe("carry on");
  });
});

/* ================================================= the checkpoint file == */

/**
 * **DPN-09 — three concurrent jobs, one temporary pathname.**
 *
 * Phase D drives three jobs at once and every one of them checkpoints. With a
 * single `run.json.<pid>.tmp` two calls interleave, both rename it, and the
 * loser gets `ENOENT` — a rejection that travelled out of `driveJob` and took
 * the whole phase down through `Promise.all`.
 */
describe("the run file's checkpoint writer", () => {
  it("survives many concurrent writers and leaves the last state on disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deepen-checkpoint-"));
    const file = path.join(dir, "run.json");
    let n = 0;
    const write = checkpointWriter(file, () => ({ n }));
    const all = Array.from({ length: 40 }, () => {
      n++;
      return write();
    });
    await expect(Promise.all(all)).resolves.toBeDefined();
    expect(JSON.parse(await readFile(file, "utf-8")) as { n: number }).toEqual({ n: 40 });
  });

  /* And the serialisation is the point as much as the name: the object is
     mutated by the jobs still running, so two concurrent stringifies of it are
     two different documents and the loser lands second. */
  it("writes whole documents rather than interleaved ones", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deepen-checkpoint-"));
    const file = path.join(dir, "run.json");
    const state = { jobs: [] as number[] };
    const write = checkpointWriter(file, () => state);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        state.jobs.push(i);
        return write();
      }),
    );
    const back = JSON.parse(await readFile(file, "utf-8")) as { jobs: number[] };
    expect(back.jobs).toHaveLength(20);
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

  /**
   * **DPN-10 — a control corpus that is not inert is not a control.** This was
   * a note, so a phase C whose "ordinary" article had eligible sections could
   * clear entirely on the strength of a tree that happened not to change —
   * which is a coincidence rather than the evidence phase C exists to produce.
   */
  it("goes fatal on an article with eligible sections, which cannot be the control", () => {
    const found = checkInertness({ ...base, targetsWhenOn: 2 });
    expect(found).toHaveLength(1);
    expect(found[0]!.fatal).toBe(true);
    expect(found[0]!.message).toMatch(/declared control requires exactly zero/);
  });

  /* And an unchanged tree does not rescue it: the two findings are about
     different things, and only one of them is the control. */
  it("still goes fatal where the tree was identical, because that is the coincidence", () => {
    const found = checkInertness({ ...base, targetsWhenOn: 2, treeBefore: "aaa", treeAfter: "aaa" });
    expect(found.map((f) => f.fatal)).toEqual([true]);
  });

  it("goes fatal where the flag-on pass wrote a file whose targets it cannot read", () => {
    expect(checkInertness({ ...base, targetsWhenOn: null }).map((f) => f.fatal)).toEqual([true]);
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
    expect(e.caveat).toMatch(/upper bound on ONE purchase of that row/);
    /* And it does not let the reader carry "upper bound" up to the total. */
    expect(e.caveat).toMatch(/not a bound on how many purchases the run makes/);
  });

  /**
   * **DPN-07's other half, and DPN-16's correction of what it then claimed.** A
   * requeued re-asking pass used to be re-driven and bought its wave again,
   * three windows deep, and none of that was in the $40.90. The run refuses
   * that now (`requeueVerdict`) — but the text then said *"the nominal total is
   * the bound"*, and it is not one. An ordinary, non-re-asking pass can requeue
   * and re-buy any answer whose best-effort checkpoint write failed, a redraw
   * buys a second answer, and nothing anywhere refuses a call at $N. The two
   * numbers are a **nominal estimate** and a **three-window requeue exposure**,
   * and neither is a bound. ⟨GPT Sol, DPN-16.⟩
   */
  it("names the two figures as an estimate and an exposure, and denies being a bound", () => {
    const e = estimate({
      bookIngestDeepened: 1,
      bookHierarchyRepeat: 3,
      articleIngestDeepened: 3,
      articleHierarchyResumed: 1,
    });
    /* Three re-asking passes, three windows each: two more purchases apiece. */
    expect(e.worstCaseUsd).toBeCloseTo(e.totalUsd + 3 * 7.4 * 2);
    expect(e.worstCaseUsd).toBeGreaterThan(e.totalUsd);
    expect(e.bound).toMatch(/NOMINAL ESTIMATE/);
    expect(e.bound).toMatch(/THREE-WINDOW REQUEUE EXPOSURE/);
    expect(e.bound).toMatch(/stops a re-asking pass on its first requeue/);
    /* **The claim that was withdrawn**, and the one that replaced it. */
    expect(e.bound).not.toMatch(/is the bound/);
    expect(e.bound).toMatch(/NEITHER FIGURE IS A BOUND, AND NOTHING HERE ENFORCES A CAP/);
    expect(e.bound).toMatch(/whose best-effort checkpoint write failed|checkpoint write failed/);
    expect(formatEstimate(e)).toMatch(/NOMINAL ESTIMATE/);
    expect(formatEstimate(e)).not.toMatch(/worst case, were a requeue re-driven/);
  });

  it("has no requeue exposure where there are no re-asking passes", () => {
    const e = estimate({
      bookIngestDeepened: 1,
      bookHierarchyRepeat: 0,
      articleIngestDeepened: 0,
      articleHierarchyResumed: 0,
    });
    expect(e.worstCaseUsd).toBeCloseTo(e.totalUsd);
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
  /** The paid path's shape: three phase-D jobs, `hierarchy` measured, cap 3. */
  const drive = (jobs: DrivenJob[]) =>
    checkDriving(jobs, { measuredStep: "hierarchy", jobConcurrency: 3, plannedConcurrency: 3 });

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

  /** A phase-D job whose measured step really did run in the given window. */
  const loaded = (label: string, from: string, to: string): DrivenJob =>
    job({
      phase: "D",
      label,
      startedAt: from,
      finishedAt: to,
      stepOutcomes: [
        { name: "fetch", status: "done", detail: "1382 KB (fixture book)" },
        { name: "hierarchy", status: "done", startedAt: from, finishedAt: to },
      ],
    });

  it("is quiet on a run that behaved", () => {
    expect(
      drive([
        job({ phase: "B", startedAt: "2026-09-05T00:00:00.000Z", finishedAt: "2026-09-05T00:00:05.000Z" }),
        job({ phase: "B", startedAt: "2026-09-05T00:00:06.000Z", finishedAt: "2026-09-05T00:00:09.000Z" }),
        loaded("D 1", "2026-09-05T00:00:10.000Z", "2026-09-05T00:00:20.000Z"),
        loaded("D 2", "2026-09-05T00:00:11.000Z", "2026-09-05T00:00:19.000Z"),
      ]),
    ).toEqual([]);
  });

  /**
   * **DPN-04 — the whole-job windows overlap even when the steps do not.** Both
   * jobs below are alive for the same ten seconds, which is exactly what a
   * phase D serialised by another agent's claim slot looks like: all three
   * `driveJob` promises stay alive while two of them collect `busy`. Only the
   * measured step's own window can tell them apart.
   */
  it("is not fooled by two whole-job windows that overlap while the steps ran serially", () => {
    const found = drive([
      job({
        phase: "D",
        label: "D 1",
        startedAt: "2026-09-05T00:00:00.000Z",
        finishedAt: "2026-09-05T00:00:10.000Z",
        stepOutcomes: [
          { name: "fetch", status: "done", detail: "1382 KB (fixture book)" },
          {
            name: "hierarchy",
            status: "done",
            startedAt: "2026-09-05T00:00:00.000Z",
            finishedAt: "2026-09-05T00:00:04.000Z",
          },
        ],
      }),
      job({
        phase: "D",
        label: "D 2",
        startedAt: "2026-09-05T00:00:00.000Z",
        finishedAt: "2026-09-05T00:00:10.000Z",
        stepOutcomes: [
          { name: "fetch", status: "done", detail: "1382 KB (fixture book)" },
          {
            name: "hierarchy",
            status: "done",
            startedAt: "2026-09-05T00:00:05.000Z",
            finishedAt: "2026-09-05T00:00:09.000Z",
          },
        ],
      }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toMatch(/peak of 1 `hierarchy` step/);
  });

  /**
   * **The runtime cap, not the constant the plan quotes.** `jobConcurrency()`
   * reads its environment variable at call time, so a shell that set it to 1
   * serialises phase D while the run's metadata goes on saying 3.
   */
  it("goes fatal when the queue's runtime cap is not what phase D was planned at", () => {
    const found = checkDriving(
      [loaded("D 1", "2026-09-05T00:00:00.000Z", "2026-09-05T00:00:10.000Z")],
      { measuredStep: "hierarchy", jobConcurrency: 1, plannedConcurrency: 3 },
    );
    expect(found.map((f) => f.fatal)).toEqual([true]);
    expect(found[0]!.message).toMatch(/SPIDERYARN_JOB_CONCURRENCY/);
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
    const found = drive([
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
    const found = drive([
      job({ slug: "load1", stepOutcomes: [{ name: "fetch", status: "done", detail: "200 OK, 41 KB" }] }),
    ]);
    expect(found.map((f) => f.fatal)).toEqual([true]);
  });

  /* A job with no ingress — a forced re-run — runs no `fetch` at all, and must
     not be held to a step it was never given. */
  it("does not ask a forced re-run for a fixture read it never had", () => {
    expect(
      drive([
        job({ createdArticle: false, force: ["blocks"], stepOutcomes: [{ name: "blocks", status: "done" }] }),
      ]),
    ).toEqual([]);
  });

  it("goes fatal when two repeats overlapped, because a contended repeat confounds question 1", () => {
    const found = drive([
      job({ phase: "B", label: "r2", startedAt: "2026-09-05T00:00:00.000Z", finishedAt: "2026-09-05T00:00:10.000Z" }),
      job({ phase: "B", label: "r3", startedAt: "2026-09-05T00:00:05.000Z", finishedAt: "2026-09-05T00:00:15.000Z" }),
    ]);
    expect(found.map((f) => f.fatal)).toEqual([true]);
    expect(found[0]!.message).toMatch(/serial deliberately/);
  });

  it("says so when the load phase did not overlap, rather than reporting a budget it never tested", () => {
    const found = drive([
      loaded("D 1", "2026-09-05T00:00:00.000Z", "2026-09-05T00:00:05.000Z"),
      loaded("D 2", "2026-09-05T00:00:06.000Z", "2026-09-05T00:00:09.000Z"),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]!.fatal).toBe(false);
    expect(found[0]!.message).toMatch(/not clocks under load/);
  });

  it("goes fatal when a forced step was skipped on its stamp", () => {
    const found = drive([
      job({ createdArticle: false, force: ["hierarchy"], stepOutcomes: [{ name: "hierarchy", status: "skipped" }] }),
    ]);
    expect(found.map((f) => f.fatal)).toEqual([true]);
    expect(found[0]!.message).toMatch(/bought nothing and measured nothing/);
  });

  it("goes fatal when the force named a step the job has not got", () => {
    const found = drive([
      job({ createdArticle: false, force: ["hierarchy"], stepOutcomes: [{ name: "blocks", status: "done" }] }),
    ]);
    expect(found.map((f) => f.fatal)).toEqual([true]);
  });

  /* A window that was never recorded must not read as "did not overlap" — the
     absence of a measurement is its own thing, and a job that crashed before it
     started has no window. */
  it("does not call a missing window an overlap in either direction", () => {
    const found = drive([
      job({ phase: "B", startedAt: undefined, finishedAt: undefined }),
      job({ phase: "B", startedAt: undefined, finishedAt: undefined }),
    ]);
    expect(found).toEqual([]);
  });
});

/* ================================================= the step lists, refused == */

/**
 * **The free rehearsal died at its first `enqueue` and reported itself clean.**
 *
 * `dev` merged in a rule — `unrunnableStepPlan` in `src/jobs.ts` — that refuses
 * any step list containing `blocks` without `hierarchy`, because such a job runs,
 * succeeds and then cannot publish. `--dry-run` asked for exactly that in all
 * three of its lists, so **every** phase threw a 400, no job row was ever
 * created, and the run printed its whole closing report on the way down:
 * an empty driving table, `Findings: none`, a written `run.json`, and the error
 * on the last line of all.
 * docs/postmortems/260905b-the-rehearsal-reported-a-clean-run-over-zero-jobs.md.
 *
 * Neither `npm run typecheck` nor this suite could see it: a step list is data,
 * and nothing here asked the queue whether it would take one. So the run asks,
 * before it enqueues anything, on every path including the free ones — and the
 * rule is handed in rather than imported so that watching it refuse costs
 * nothing. `evals/deepen/run.ts § stepsFor` is what it is asked about.
 */
describe("the step plans, checked against the queue's rule before anything is enqueued", () => {
  const plans = (over: Partial<StepPlans> = {}): StepPlans => ({
    ingest: ["fetch", "extract"],
    rerun: ["extract"],
    force: ["extract"],
    ...over,
  });
  /** The real rule's shape, as a stand-in a test can hand a wrong list to. */
  const noBlocksWithoutHierarchy = (steps: readonly string[]): string | undefined =>
    steps.includes("blocks") && !steps.includes("hierarchy") ? "blocks needs hierarchy" : undefined;

  it("passes lists the queue would take", () => {
    expect(() => assertStepPlansRunnable(plans(), noBlocksWithoutHierarchy)).not.toThrow();
    expect(() =>
      assertStepPlansRunnable(
        plans({
          ingest: ["fetch", "extract", "blocks", "hierarchy", "assets"],
          rerun: ["hierarchy"],
          force: ["hierarchy"],
        }),
        noBlocksWithoutHierarchy,
      ),
    ).not.toThrow();
  });

  /* The exact list `--dry-run` carried on the morning of 2026-09-05. */
  it("refuses the list that killed the rehearsal, and names which one it was", () => {
    expect(() =>
      assertStepPlansRunnable(
        plans({ ingest: ["fetch", "extract", "blocks"], rerun: ["blocks"], force: ["blocks"] }),
        noBlocksWithoutHierarchy,
      ),
    ).toThrow(/`ingest` step list \[fetch, extract, blocks\]/);
  });

  /* And a list that is only wrong in one of the three, which is what a partial
     repair looks like. */
  it("refuses a single bad list among the good ones", () => {
    expect(() =>
      assertStepPlansRunnable(plans({ rerun: ["blocks"] }), noBlocksWithoutHierarchy),
    ).toThrow(/`rerun` step list \[blocks\]/);
  });

  it("ignores an empty list rather than asking about nothing", () => {
    expect(() =>
      assertStepPlansRunnable(plans({ force: [] }), noBlocksWithoutHierarchy),
    ).not.toThrow();
  });
});

/* ============================================== the records, read by slug == */

/**
 * **DPN-14 — three jobs write into one directory, and the reader used to parse
 * every new file before asking whose it was.**
 *
 * A sibling's half-written file therefore rejected the whole read, which
 * `driveJob` turns into a fatal finding against **the asking job** and leaves its
 * own `recordsFiles` empty. Two fixes, and both are wanted: the writer publishes
 * atomically (`src/hierarchy-deepen.ts § saveDeepenRecords`), and the reader
 * filters on the filename before it opens anything.
 */
describe("reading one job's records out of a shared directory", () => {
  const body = (slug: string): string =>
    JSON.stringify({
      version: RECORDS_VERSION,
      slug,
      writtenAt: "2026-09-05T00:00:00.000Z",
      failed: false,
      reason: null,
      stats: {
        targets: 0,
        expanded: 0,
        added: 0,
        withheld: 0,
        uncheckpointed: 0,
        calls: 0,
        resumed: 0,
        outOfTime: 0,
        verdicts: { rawYes: 0, rawNo: 0 },
        usage: { inputTokens: 0, outputTokens: 0 },
      },
      records: [],
    });

  it("does not open — let alone fail on — a file belonging to another slug", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deepen-records-"));
    await writeFile(path.join(dir, "mine-2026-09-05-1-1.json"), body("mine"), "utf-8");
    /* A sibling's file, caught mid-write: half a file is not valid JSON. */
    await writeFile(path.join(dir, "theirs-2026-09-05-1-1.json"), '{"version": "deepen-rec', "utf-8");
    const found = await readRecordsDir(dir, { slug: "mine" });
    expect(found.map((f) => f.file)).toEqual(["mine-2026-09-05-1-1.json"]);
  });

  /* Without a slug, every file is being asked for, and a broken one is still an
     error — which is what the reporting-time read wants. */
  it("still refuses a broken file when it was asked for the whole directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deepen-records-"));
    await writeFile(path.join(dir, "theirs-2026-09-05-1-1.json"), '{"version": "deepen-rec', "utf-8");
    await expect(readRecordsDir(dir)).rejects.toThrow();
  });

  /* The prefix rule is the writer's, and a second copy of it is how a filter
     quietly stops matching. The parsed slug is still the authority. */
  it("spells a slug into a filename prefix the way the writer does", () => {
    expect(recordsFilePrefix("evaldeepen-abc123-book")).toBe("evaldeepen-abc123-book");
    expect(recordsFilePrefix("a/b c")).toBe("a-b-c");
    expect(recordsFilePrefix("")).toBe("article");
    expect(recordsFilePrefix("x".repeat(200))).toHaveLength(80);
  });

  it("keeps a file whose name matches a longer slug's prefix out by its contents", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deepen-records-"));
    await writeFile(path.join(dir, "book-2026-09-05-1-1.json"), body("book-and-more"), "utf-8");
    expect(await readRecordsDir(dir, { slug: "book" })).toEqual([]);
  });
});

/* ================================= a summary that can say "there was nothing" == */

/**
 * **The other half of the rehearsal that reported a clean run**: not the throw,
 * but the report printed over it. `formatDriving` rendered its explanatory
 * paragraph — "a dry-run ingest stops at its last free step and FAILS, that is
 * expected" — over a run in which **no job had been created at all**, which is
 * the paragraph of a run that happened. docs/reusable/silent-success.md.
 */
describe("the driving table over an empty run", () => {
  it("says there were no jobs rather than explaining what the jobs did", () => {
    const printed = formatDriving([]);
    expect(printed).toMatch(/NO JOBS/);
    expect(printed).toMatch(/absence, not a clean run/);
    expect(printed).not.toMatch(/stops at its last free step/);
  });

  it("still explains itself when there were jobs", () => {
    const printed = formatDriving([
      { phase: "A", label: "book ingest", slug: "book", force: [], createdArticle: true },
    ]);
    expect(printed).toMatch(/book ingest/);
    expect(printed).not.toMatch(/NO JOBS/);
  });
});

/* ===================================== a job that stopped, and what it left == */

/**
 * **DPN-18 and DPN-19 — two ways a paid job can stop having lost the evidence it
 * was bought for, while `stopIfCompromised` sees nothing to stop for.**
 *
 * That function reads *findings*, and only findings. So anything that is not
 * turned into one is, to the run, indistinguishable from a clean job — and the
 * next phase is purchased.
 *
 * 1. **A terminal status that is not `done`.** A phase-B `hierarchy` writes valid
 *    deepening records and then label generation throws. `driveJob` records
 *    `jobStatus: "error"` and nothing else happens: phase C is bought over a
 *    repeat that never finished.
 * 2. **`done`, deepening on, and no records file.** `saveDeepenRecords` swallows
 *    filesystem and hard-link failures on purpose — instrumentation must not
 *    fail a reader's article — and `readRecordsDir` then returns `[]`. Which
 *    `driveJob` printed as "no records file — nobody asked". But **"nobody
 *    asked" and "asked and the record was lost" are different facts**, and Q1-Q3
 *    are computed entirely out of those records. This is the seam where the two
 *    got confused.
 *
 * `--dry-run` is exempt from the first because failing at the last free step is
 * the whole shape of the rehearsal, and from the second because it never turns
 * deepening on at all.
 */
describe("what a stopped job has to have left behind", () => {
  const base = { label: "book hierarchy forced (repeat 2)", dryRun: false, requeued: false };

  it("is fatal when a paid job ends `error`", () => {
    const f = jobIntegrityFindings({ ...base, status: "error", deepenFlag: true, hasRecords: true });
    expect(f.filter((x) => x.fatal)).toHaveLength(1);
    expect(f[0]?.kind).toBe("not-answerable");
    expect(f[0]?.message).toMatch(/error/);
  });

  for (const status of ["queued", "running", "cancelled"] as const) {
    it(`is fatal when a paid job ends \`${status}\``, () => {
      const f = jobIntegrityFindings({ ...base, status, deepenFlag: true, hasRecords: true });
      expect(f.some((x) => x.fatal)).toBe(true);
    });
  }

  it("says nothing about a paid job that ended `done` with its records", () => {
    expect(
      jobIntegrityFindings({ ...base, status: "done", deepenFlag: true, hasRecords: true }),
    ).toEqual([]);
  });

  /* The requeue already has its own finding, with the reason a re-claim would
     buy the wave again. A second one saying "not done" adds noise, not fact. */
  it("leaves a requeued job to the requeue finding", () => {
    expect(
      jobIntegrityFindings({ ...base, requeued: true, status: "queued", deepenFlag: true, hasRecords: true }),
    ).toEqual([]);
  });

  /**
   * A dry run's jobs stop at `extract` and therefore end `error`: the article
   * never publishes. That is what the rehearsal is.
   */
  it("says nothing about a dry run's job, whatever it ended as", () => {
    expect(
      jobIntegrityFindings({ ...base, dryRun: true, status: "error", deepenFlag: true, hasRecords: false }),
    ).toEqual([]);
  });

  it("is fatal when a paid deepen-on job finished `done` with no records file", () => {
    const f = jobIntegrityFindings({ ...base, status: "done", deepenFlag: true, hasRecords: false });
    expect(f.filter((x) => x.fatal)).toHaveLength(1);
    expect(f[0]?.kind).toBe("no-records");
    expect(f[0]?.message, "the message must not read as `nobody asked`").toMatch(/lost|not written/i);
  });

  /* Phase C's flag-off half is *supposed* to write nothing, and the whole of
     `checkInertness` rests on it. */
  it("says nothing when deepening was off and nothing was written", () => {
    expect(
      jobIntegrityFindings({ ...base, status: "done", deepenFlag: false, hasRecords: false }),
    ).toEqual([]);
  });

  it("reports both when a paid job ended `error` with nothing written", () => {
    const f = jobIntegrityFindings({ ...base, status: "error", deepenFlag: true, hasRecords: false });
    expect(f.map((x) => x.kind).sort()).toEqual(["no-records", "not-answerable"]);
    expect(f.every((x) => x.fatal)).toBe(true);
  });

  it("names the job it is about, so a findings block says which phase lost it", () => {
    const f = jobIntegrityFindings({ ...base, status: "error", deepenFlag: true, hasRecords: true });
    expect(f[0]?.message).toContain(base.label);
  });
});

/* ========================================= phase D, lined up before it counts == */

/**
 * **DPN-15 — the arithmetic was right and the phase did not arrange the thing it
 * measures.** `peakConcurrency` correctly demands that all three of phase D's
 * `hierarchy` windows be open at one instant, and nothing made them: the book's
 * job is a forced `hierarchy` and starts its measured step at once, while the
 * two load articles start at `fetch` and get there only after stages 1-3. So the
 * run could spend $40.90 and then report question 5 unanswerable.
 *
 * **DPN-20 — and the first fix was a latch, not a rendezvous.** `announce` only
 * *recorded* an arrival: load1 could announce, run its whole measured step and
 * finish before load2 announced at all, and `wait` would then report `"all"` and
 * release the book into a window load1 had already left.
 *
 * **DPN-20-R — and the second fix was still two-party.** The loads were held for
 * each other and *nothing was held for the book*: the gate opened on the two of
 * them and only then was the book driven at all, so with another job holding the
 * third queue slot both released load steps could finish before the book reached
 * `hierarchy` — and the outcome still read `"all"`. Q5 refuses that afterwards,
 * correctly, but only once phase D has spent.
 *
 * So it is three-party. `waitFor(2)` is the **readiness** wait — both loads at
 * the entry, gate still shut, nothing bought — and only then is the book driven,
 * arriving through the same hook. `wait()` opens the gate when all three are
 * there. The book therefore *does* arrive inside its own claim, and that is
 * sound rather than a concession: everybody else is already waiting for it, so
 * its wait is one microtask, and the step that needs 658-778 s against a 740 s
 * deadline gives up none of it.
 */
describe("the phase-D start rendezvous", () => {
  const never = new Promise<void>(() => undefined);
  /* Two turns of the microtask queue: enough for anything `arrive` returns to
     have settled if it was ever going to. */
  const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  /**
   * **The DPN-20-R case itself**, and the assertion that is the finding is the
   * one in the middle: the two loads are at the entry, the readiness wait has
   * ended `"all"`, and *they are still held*. A two-party gate releases them
   * there — which is exactly the window the book was then driven into.
   */
  it("holds both loads at the entry until the book arrives too", async () => {
    const r = startRendezvous({ expected: 3, timeoutMs: 60_000 });
    const ran: string[] = [];
    void r.arrive("load1").then(() => ran.push("load1"));
    void r.arrive("load2").then(() => ran.push("load2"));

    const ready = await r.waitFor(2, never);
    expect(ready.why).toBe("all");
    expect(ready.needed).toBe(2);
    expect(ready.arrived).toEqual(["load1", "load2"]);
    await settle();
    expect(ran, "the loads were released before the book was anywhere near the entry").toEqual([]);

    /* Only now is the book driven, and it arrives through the same hook. */
    void r.arrive("book").then(() => ran.push("book"));
    const lined = await r.wait(never);
    expect(lined.why).toBe("all");
    expect(lined.needed).toBe(3);
    expect(lined.arrived).toEqual(["load1", "load2", "book"]);
    await settle();
    expect([...ran].sort()).toEqual(["book", "load1", "load2"]);
  });

  /* The original DPN-20 property, unchanged: one load may not run ahead of the
     other either. */
  it("holds the first load step at its entry until the second one gets there", async () => {
    const r = startRendezvous({ expected: 3, timeoutMs: 60_000 });
    let released1 = false;
    void r.arrive("load1").then(() => {
      released1 = true;
    });
    await settle();
    expect(released1, "load1 ran its measured step before load2 was anywhere near it").toBe(false);
    void r.arrive("load2");
    await r.waitFor(2, never);
    await settle();
    expect(released1, "load1 ran its measured step before the book arrived").toBe(false);
  });

  it("releases nobody until the wait ends, and then everybody", async () => {
    const r = startRendezvous({ expected: 3, timeoutMs: 60_000 });
    const ran: string[] = [];
    for (const slug of ["load1", "load2", "book"]) void r.arrive(slug).then(() => ran.push(slug));
    await settle();
    expect(ran, "a measured step started before the gate opened").toEqual([]);
    await r.wait(never);
    await settle();
    expect([...ran].sort()).toEqual(["book", "load1", "load2"]);
  });

  it("says how long each held step waited at the entry", async () => {
    let clock = 0;
    const r = startRendezvous({ expected: 3, timeoutMs: 60_000, now: () => clock });
    void r.arrive("load1");
    clock = 5_000;
    void r.arrive("load2");
    clock = 8_000;
    void r.arrive("book");
    clock = 8_010;
    const out = await r.wait(never);
    expect(out.held).toEqual([
      { slug: "load1", ms: 8_010 },
      { slug: "load2", ms: 3_010 },
      { slug: "book", ms: 10 },
    ]);
  });

  /* A step that ran twice — a re-driven job — must not count as two jobs. */
  it("counts jobs, not arrivals", async () => {
    const r = startRendezvous({ expected: 3, timeoutMs: 20 });
    void r.arrive("load1");
    void r.arrive("load1");
    const out = await r.waitFor(2, never);
    expect(out.why).toBe("timed out");
    expect(out.arrived).toEqual(["load1"]);
  });

  /**
   * **A load job that fails before its measured step never arrives**, and the
   * survivor must be let go: a rendezvous that only ever opens on success wedges
   * the other load job inside its own claim until the lease expires. What
   * happens to the *book* on this path is `loadReadiness`'s to say, and the
   * answer is that it is not driven at all (DPN-23).
   */
  it("lets the survivor go when the other load job has died", async () => {
    const r = startRendezvous({ expected: 3, timeoutMs: 60_000 });
    let released = false;
    void r.arrive("load1").then(() => {
      released = true;
    });
    const out = await r.waitFor(2, Promise.resolve("the other load job failed"));
    expect(out.why).toBe("jobs finished first");
    expect(out.arrived).toEqual(["load1"]);
    /* The readiness wait does NOT open the gate — that is the whole of DPN-20-R
       — so the survivor is let go by the phase's `finally` instead. */
    r.release();
    await settle();
    expect(released, "a held load step was left waiting for a job that will never arrive").toBe(true);
  });

  it("gives up on its own deadline, and the release lets go when it does", async () => {
    const r = startRendezvous({ expected: 3, timeoutMs: 5 });
    let released = false;
    void r.arrive("load1").then(() => {
      released = true;
    });
    const out = await r.waitFor(2, never);
    expect(out.why).toBe("timed out");
    r.release();
    await settle();
    expect(released).toBe(true);
  });

  /**
   * **The full wait gives up and lets go by itself**, because by then there is
   * nobody left to do it for the held steps — the book is being driven and the
   * phase is inside `wait`.
   */
  it("opens the gate itself when the book never arrives", async () => {
    const r = startRendezvous({ expected: 3, timeoutMs: 5 });
    let released = false;
    void r.arrive("load1").then(() => {
      released = true;
    });
    void r.arrive("load2");
    const out = await r.wait(never);
    expect(out.why).toBe("timed out");
    await settle();
    expect(released).toBe(true);
  });

  /* ------------------------------------------ what the gate tells them -- */

  /**
   * **The gate says which of two things happened**, because a released step has
   * to know whether to run or to stop.
   *
   * A gate that opened on everybody is the phase working, and the step runs. A
   * gate that opened because it gave up is the phase already lost — no three
   * windows, so no question 5 — and the measured step that runs anyway is bought
   * for nothing. On the book that is $7.40 of a $40.90 run, spent to buy an
   * answer the report will then refuse.
   */
  it("tells the held steps to go when the gate opened on everybody", async () => {
    const r = startRendezvous({ expected: 3, timeoutMs: 60_000 });
    const verdicts = ["load1", "load2", "book"].map((s) => r.arrive(s));
    const out = await r.wait(never);
    expect(out.why).toBe("all");
    expect(await Promise.all(verdicts)).toEqual(["go", "go", "go"]);
  });

  it("tells them they were abandoned when it gave up instead", async () => {
    const r = startRendezvous({ expected: 3, timeoutMs: 5 });
    const held = r.arrive("load1");
    void r.arrive("load2");
    const out = await r.wait(never);
    expect(out.why).toBe("timed out");
    expect(await held, "a step released by a gate that never opened was told to carry on").toBe(
      "abandoned",
    );
  });

  it("says abandoned to a step let go by the failure door", async () => {
    const r = startRendezvous({ expected: 3, timeoutMs: 60_000 });
    const held = r.arrive("load1");
    r.release();
    expect(await held).toBe("abandoned");
  });

  /**
   * **The verdict is latched at the first opening**, and this is the hazard the
   * whole design turns on: `runPhaseD`'s `finally` calls `release()` on *every*
   * path, including the one where `wait` has already opened the gate on all
   * three. If the second call could downgrade the first, a perfectly lined-up
   * phase would tell three running steps they had been abandoned.
   */
  it("latches the first verdict, so the finally cannot downgrade a gate that opened", async () => {
    const r = startRendezvous({ expected: 3, timeoutMs: 60_000 });
    const held = r.arrive("load1");
    void r.arrive("load2");
    void r.arrive("book");
    await r.wait(never);
    r.release();
    expect(await held, "the finally turned a successful gate into an abandonment").toBe("go");
  });

  /* A step that arrives after a gate that gave up is just as abandoned. */
  it("gives the latched verdict to a step that arrives late", async () => {
    const r = startRendezvous({ expected: 3, timeoutMs: 5 });
    await r.wait(never);
    expect(await r.arrive("load1")).toBe("abandoned");
  });

  /**
   * **The failure release.** If the phase throws between the arrivals and the
   * wait — an `enqueue` that rejects, a checkpoint write that blows up — nothing
   * would ever call `wait`, and two claims would sit at the entry until their
   * leases ran out. `release()` is what the `finally` calls.
   */
  it("can be released by a phase that never reaches the wait", async () => {
    const r = startRendezvous({ expected: 3, timeoutMs: 60_000 });
    let released = false;
    void r.arrive("load1").then(() => {
      released = true;
    });
    r.release();
    await settle();
    expect(released).toBe(true);
  });

  it("is idempotent, so the finally after a wait changes nothing", async () => {
    const r = startRendezvous({ expected: 3, timeoutMs: 60_000, now: () => 0 });
    void r.arrive("load1");
    void r.arrive("load2");
    void r.arrive("book");
    const out = await r.wait(never);
    r.release();
    expect(out.why).toBe("all");
  });

  /* An arrival after the gate has opened — a step re-driven late — must not
     hang, and must not report a negative wait. */
  it("does not hold a step that arrives after the release", async () => {
    let clock = 0;
    const r = startRendezvous({ expected: 1, timeoutMs: 60_000, now: () => clock });
    void r.arrive("load1");
    clock = 100;
    await r.wait(never);
    clock = 200;
    let released = false;
    void r.arrive("load2").then(() => {
      released = true;
    });
    await settle();
    expect(released).toBe(true);
  });

  /* The race is genuinely racy: a job arriving in the same tick as the last
     one settles is lined up, and must not be reported as missing. */
  it("says `all` where everyone arrived, however the wait happened to end", async () => {
    const r = startRendezvous({ expected: 1, timeoutMs: 60_000 });
    const settled = Promise.resolve().then(() => {
      void r.arrive("load1");
    });
    const out = await r.wait(settled);
    expect(out.why).toBe("all");
  });

  it("does not wait at all for nobody", async () => {
    const r = startRendezvous({ expected: 0, timeoutMs: 60_000 });
    expect((await r.wait(never)).why).toBe("all");
  });
});

/**
 * **The last place the run spent knowing the answer could not come back.**
 *
 * The gate can open without everybody being there — the book cannot get a claim
 * slot inside the deadline, most likely, which on a shared box is close to the
 * expected case rather than the tail. Round 5 left that spending anyway: the
 * three steps ran, `peakConcurrency` refused question 5 afterwards, and $7.40 of
 * a $40.90 run had bought an answer the report would not quote. Every other
 * protection here stops when the evidence is already lost; this was the one that
 * did not. ⟨Greg, 2026-09-05.⟩
 *
 * So a step released by a gate that gave up **throws before it runs**, and
 * `abandonStep` is the whole of the decision. Two guards, and neither is
 * negotiable: it cannot fire on `--dry-run`, whose jobs are expected to fail at
 * their last free step and must not be given a second way to; and it cannot fire
 * on a gate that opened `"go"`, which is the phase working.
 */
describe("a measured step the gate gave up on", () => {
  const base = { dryRun: false, slug: "load1", step: "hierarchy" };

  it("throws before the step runs, so the wave is never bought", () => {
    const err = abandonStep({ ...base, verdict: "abandoned" });
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain(ABANDONED_MARKER);
    expect(err?.message, "the message must name the step and the slug").toMatch(/hierarchy/);
    expect(err?.message).toMatch(/load1/);
    expect(err?.message, "and must say it bought nothing").toMatch(/bought nothing|not bought/i);
  });

  it("never fires where the gate opened on everybody", () => {
    expect(abandonStep({ ...base, verdict: "go" })).toBeNull();
  });

  /* A dry run's jobs already fail at their last free step. A second way to fail
     them proves nothing and would make the rehearsal's output a worse guide to
     the paid run's, which is the only thing the rehearsal is for. */
  it("never fires under --dry-run, however the gate ended", () => {
    expect(abandonStep({ ...base, dryRun: true, verdict: "abandoned" })).toBeNull();
    expect(abandonStep({ ...base, dryRun: true, verdict: "go" })).toBeNull();
  });
});

/**
 * **DPN-23 — the run still bought after it knew the answer was gone**, in the one
 * place round 4's fix could not reach.
 *
 * Both load jobs fail before `hierarchy`. The readiness wait ends `"jobs finished
 * first"`, their DPN-18 findings are on the record — and phase D then drove the
 * paid book anyway, because "drive the book" was unconditional. The book's
 * phase-D pass exists **only** to answer question 5 (question 1 is phases A and B
 * only), and question 5 needs three overlapping windows, so a book bought into a
 * phase that cannot line up buys nothing at all. ⟨GPT Sol, DPN-23.⟩
 *
 * Pure, and separate from `runPhaseD`, so the refusal can be watched without a
 * database.
 */
describe("whether the book may be driven at all", () => {
  const outcome = (
    why: RendezvousOutcome["why"],
    arrived: string[],
  ): RendezvousOutcome => ({ why, arrived, expected: 3, needed: 2, ms: 1_234, held: [] });

  it("lets the book go when both load steps are held at the entry", () => {
    const v = loadReadiness(outcome("all", ["load1", "load2"]));
    expect(v.go).toBe(true);
    expect(v.findings).toEqual([]);
  });

  it("refuses when both load jobs died before reaching the measured step", () => {
    const v = loadReadiness(outcome("jobs finished first", []));
    expect(v.go, "the paid book was driven into a phase that cannot answer Q5").toBe(false);
    expect(v.findings).toHaveLength(1);
    expect(v.findings[0]?.fatal).toBe(true);
    expect(v.findings[0]?.kind).toBe("not-answerable");
    expect(v.findings[0]?.message, "the finding must say the book was NOT bought").toMatch(
      /not driven|not bought/i,
    );
  });

  it("refuses when only one of the two got there", () => {
    const v = loadReadiness(outcome("jobs finished first", ["load1"]));
    expect(v.go).toBe(false);
    expect(v.findings[0]?.message).toMatch(/1 of 2/);
  });

  it("refuses when the readiness wait timed out", () => {
    const v = loadReadiness(outcome("timed out", ["load1"]));
    expect(v.go).toBe(false);
    expect(v.findings[0]?.fatal).toBe(true);
    expect(v.findings[0]?.message).toMatch(/timed out/);
  });
});
