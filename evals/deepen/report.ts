/**
 * **The arithmetic of stage 5b**, separated from the driving so that every
 * number the paid run produces can be watched going wrong for free —
 * evals/cost/report.ts and evals/extraction/ make the same split, and
 * tests/deepen-eval.test.ts is where each of these is held to a case that fails.
 *
 * One function per question in
 * docs/plans/260904d-deepen-fat-sections.md § "What the live run must answer".
 * Nothing here does IO, reads an environment variable or knows what a job is.
 *
 * ## The one thing to understand before reading any of it
 *
 * `CandidateRecord.where` is **an ordinal path derived from the answer's own
 * fan-out** — "root > child 1 > child 2". It is not an identity. Two repeats
 * that split the same parent at different points both emit `root > child 1 >
 * child 1`, over different halves of the article, and pairing on `where` would
 * read that as a stable verdict about one node. So every comparison here pairs
 * on **the parent, plus the child's derived block range**, and a record with no
 * range is refused rather than paired approximately (`requireRanges`).
 */

import type {
  CandidateRecord,
  OverridingBound,
} from "../../src/hierarchy-expand.js";
import type { DeepenStats } from "../../src/hierarchy-deepen.js";

/* --------------------------------------------------------------- findings -- */

/**
 * Something the run noticed about itself.
 *
 * `fatal` means **the numbers this run produced are not the numbers it claims
 * to be**, so a reader must not quote them — the same rule
 * `evals/cost/report.ts § Finding.fatal` keeps, and for the same reason. It is
 * a separate type from that one because the kinds are different questions: that
 * file asks whether a draw was cold, this one asks whether a repeat was a
 * repeat.
 */
export interface DeepenFinding {
  kind:
    | "seed-moved"
    | "no-ranges"
    | "no-records"
    | "wave-not-rebought"
    | "structure-rebought"
    | "not-inert"
    | "over-budget"
    | "note";
  message: string;
  fatal: boolean;
}

/* ----------------------------------------------------------- one pass in -- */

/** One deepening pass's records, as the runner loaded them off disk. */
export interface RecordsPass {
  /** How a reader tells this pass from the others: `"B repeat 2"`. */
  label: string;
  slug: string;
  writtenAt: string;
  stats: DeepenStats;
  records: readonly CandidateRecord[];
}

/* ------------------------------------------------- the range, and the gap -- */

/** The two block ids a candidate covers, in the order the tree gives them. */
export type BlockRange = readonly [string, string];

/**
 * **The derived range off a record.**
 *
 * `CandidateRecord.range` is what this reads and is the shape that shipped
 * (src/hierarchy-expand.ts, 2026-09-05). The three other spellings below are
 * accepted because this harness was written against a `CandidateRecord` that
 * did not have the field yet, and a reader that tolerates the near-misses costs
 * three lines and turns a rename into a working comparison rather than a
 * refusal at the end of a paid run.
 *
 * What it will **not** do is fall back to `where`, and that is the whole point
 * of the function: an ordinal path is not an identity, so pairing on one turns
 * a boundary that moved into a verdict that held — the answer being *more*
 * stable than the truth, which is the direction that would send stage 6 off to
 * build on a signal nobody measured. `null` here becomes a loud refusal in
 * `requireRanges`. docs/reusable/silent-success.md.
 */
export function rangeOf(record: CandidateRecord): BlockRange | null {
  const bag = record as unknown as Record<string, unknown>;
  const pair = bag.range;
  if (Array.isArray(pair) && pair.length === 2 && typeof pair[0] === "string" && typeof pair[1] === "string") {
    return [pair[0], pair[1]];
  }
  for (const [a, b] of [
    ["rangeStart", "rangeEnd"],
    ["startBlockId", "endBlockId"],
    ["start", "end"],
  ] as const) {
    if (typeof bag[a] === "string" && typeof bag[b] === "string") {
      return [bag[a] as string, bag[b] as string];
    }
  }
  return null;
}

/**
 * **Refuse to compare records that cannot be paired**, before any comparison
 * reports a number.
 *
 * A stability figure computed over records paired by `where` would be wrong in
 * the one direction that matters — it would read *more* stable than the truth,
 * because a boundary that moved still lands on the same ordinal path. So this
 * throws rather than degrading, and the message names what is missing and where
 * it has to come from.
 */
export function requireRanges(passes: readonly RecordsPass[]): void {
  for (const pass of passes) {
    const without = pass.records.filter((r) => rangeOf(r) === null);
    if (without.length === 0) continue;
    throw new Error(
      `${without.length} of ${pass.records.length} candidate records in "${pass.label}" carry no ` +
        "block range, so they cannot be paired across repeats. `CandidateRecord` " +
        "(src/hierarchy-expand.ts) needs the node's derived range on it — this harness reads " +
        "`range: [start, end]`, `rangeStart`/`rangeEnd`, `startBlockId`/`endBlockId` or " +
        "`start`/`end`. Pairing on `where` instead is refused deliberately: it is an ordinal " +
        "path derived from the answer's own fan-out, so a moved boundary would read as a stable " +
        "verdict. docs/plans/260904d-deepen-fat-sections.md § stage 5b.",
    );
  }
}

/* ----------------------------------------------------------- Q1 stability -- */

/** `"root > child 1 > child 2"` → `"root > child 1"`; the root itself has no parent. */
export function parentPath(where: string): string | null {
  const at = where.lastIndexOf(" > ");
  return at === -1 ? null : where.slice(0, at);
}

/**
 * **The stable name of a candidate's parent**, which is the parent's own
 * *range* rather than its ordinal path.
 *
 * The ordinal path is stable **for a wave-1 parent** — every repeat expands the
 * identical wave-1 tree, because the structure checkpoint is deliberately still
 * resumed (src/hierarchy-deepen.ts § `REASK_ENV`). It would stop being stable
 * the moment a wave-3 existed, whose parents are themselves wave-2 answers. So
 * the path is used only to *find* the parent record, and the parent's range is
 * what the key is made of — which stays correct when stage 6 adds waves.
 */
function parentKeyOf(record: CandidateRecord, byWhere: ReadonlyMap<string, CandidateRecord>): string | null {
  const path = parentPath(record.where);
  if (path === null) return null;
  const parent = byWhere.get(path);
  if (parent === undefined) return null;
  const range = rangeOf(parent);
  return range === null ? null : `${range[0]}..${range[1]}`;
}

function rangeKey(range: BlockRange): string {
  return `${range[0]}..${range[1]}`;
}

/** One parent whose answers did not agree between repeats. */
export interface ParentDrift {
  /** The parent's range, which is its stable name. */
  parent: string;
  /** The parent's ordinal path in the first pass that had it, for a reader to look up. */
  whereFirstSeen: string;
  /** Per pass, what came back under this parent. */
  perPass: { label: string; fanOut: number; ranges: string[] }[];
}

/** One child range whose raw verdict was not the same in every repeat. */
export interface VerdictFlip {
  parent: string;
  range: string;
  /** The verdict each pass gave, in pass order. `null` is "nobody was asked". */
  verdicts: { label: string; verdict: string | null }[];
}

/**
 * **Three outcomes, kept apart**, because two of them are structural and only
 * one is what "the verdict flipped" means.
 *
 * Folding a changed fan-out into a flip rate would report the model changing its
 * mind about a node when in fact it produced a different set of nodes, and stage
 * 6 leans on the first of those and not the second.
 * docs/plans/260904d-deepen-fat-sections.md § stage 5b.
 */
export interface Q1Stability {
  passes: number;
  /** Parents that appeared in **every** pass — the only ones any of this is about. */
  parentsCompared: number;
  /** Parents seen in some passes and not others. Reported, never compared. */
  parentsPartial: number;
  /** Parents whose child count moved between passes. Structural instability. */
  fanOutChanged: ParentDrift[];
  /** Equal fan-out everywhere, and the child ranges still did not all match. */
  boundariesMoved: ParentDrift[];
  /** Child ranges present in every pass — the denominator of the flip rate. */
  rangesMatched: number;
  /** Of those, the ones whose raw verdict was not identical in every pass. */
  verdictFlips: VerdictFlip[];
  /** Records whose parent could not be resolved. Never folded into anything above. */
  unpairable: number;
}

/**
 * Pair the wave-2 candidates of several repeats and say, three ways, how much
 * they moved.
 *
 * Wave-1 records are excluded: nobody was asked about them, their decisions are
 * mechanical, and `wave1Unchanged` below is the check that they did not move —
 * a different question with a different meaning (if *they* moved, the seed was
 * not held constant and none of this is a repeat).
 */
/** Every wave-2+ candidate, filed under the stable name of its parent. */
interface Grouped {
  /** parent key → pass label → the children that came back under it. */
  byParent: Map<string, Map<string, CandidateRecord[]>>;
  /** The parent's ordinal path, for a reader who wants to go and look. */
  whereFirstSeen: Map<string, string>;
  /** Records whose parent could not be resolved. Counted, never dropped. */
  unpairable: number;
}

/**
 * **The grouping, separate from the comparing**, because they answer different
 * questions and reading them nested was where the complexity sat: *which
 * children belong to which parent* is per record, and *did the answers agree*
 * is a fact about a whole parent across every pass.
 */
function groupByParent(passes: readonly RecordsPass[]): Grouped {
  const byParent = new Map<string, Map<string, CandidateRecord[]>>();
  const whereFirstSeen = new Map<string, string>();
  let unpairable = 0;
  for (const pass of passes) {
    const byWhere = new Map(pass.records.map((r) => [r.where, r]));
    for (const record of pass.records) {
      if (record.wave < 2) continue;
      const parent = parentKeyOf(record, byWhere);
      if (parent === null) {
        unpairable++;
        continue;
      }
      if (!whereFirstSeen.has(parent)) {
        whereFirstSeen.set(parent, parentPath(record.where) ?? record.where);
      }
      const perPass = byParent.get(parent) ?? new Map<string, CandidateRecord[]>();
      byParent.set(parent, perPass);
      const kids = perPass.get(pass.label) ?? [];
      perPass.set(pass.label, kids);
      kids.push(record);
    }
  }
  return { byParent, whereFirstSeen, unpairable };
}

export function compareRepeats(passes: readonly RecordsPass[]): Q1Stability {
  requireRanges(passes);
  const answer: Q1Stability = {
    passes: passes.length,
    parentsCompared: 0,
    parentsPartial: 0,
    fanOutChanged: [],
    boundariesMoved: [],
    rangesMatched: 0,
    verdictFlips: [],
    unpairable: 0,
  };
  if (passes.length < 2) return answer;

  const { byParent, whereFirstSeen, unpairable } = groupByParent(passes);
  answer.unpairable = unpairable;

  for (const [parent, perPass] of byParent) {
    if (perPass.size !== passes.length) {
      answer.parentsPartial++;
      continue;
    }
    answer.parentsCompared++;
    const rows = passes.map((pass) => {
      const kids = perPass.get(pass.label) ?? [];
      const ranges = kids.map((k) => rangeKey(rangeOf(k)!)).sort();
      return { label: pass.label, fanOut: kids.length, ranges, kids };
    });
    const drift: ParentDrift = {
      parent,
      whereFirstSeen: whereFirstSeen.get(parent) ?? parent,
      perPass: rows.map(({ label, fanOut, ranges }) => ({ label, fanOut, ranges })),
    };
    const fanOuts = new Set(rows.map((r) => r.fanOut));
    if (fanOuts.size > 1) {
      answer.fanOutChanged.push(drift);
      continue;
    }
    /* Equal fan-out. Did the boundaries land in the same places? */
    const shapes = new Set(rows.map((r) => r.ranges.join("|")));
    if (shapes.size > 1) answer.boundariesMoved.push(drift);

    /* And the flip rate, over the ranges every pass produced — which is a
       subset of the children when the boundaries moved, and all of them when
       they did not. A boundary that moved is counted above and its surviving
       siblings are still compared here; the two facts are independent. */
    const everywhere = rows[0]!.ranges.filter((r) => rows.every((row) => row.ranges.includes(r)));
    for (const range of new Set(everywhere)) {
      answer.rangesMatched++;
      const verdicts = rows.map((row) => ({
        label: row.label,
        verdict: row.kids.find((k) => rangeKey(rangeOf(k)!) === range)?.rawVerdict ?? null,
      }));
      if (new Set(verdicts.map((v) => v.verdict)).size > 1) {
        answer.verdictFlips.push({ parent, range, verdicts });
      }
    }
  }
  return answer;
}

/**
 * **The seed check, and it is the one that can void everything else.**
 *
 * Every repeat is supposed to expand the identical wave-1 tree: the structure
 * checkpoint is deliberately still resumed, so a verdict that moves is the
 * scoped call changing its mind rather than a different tree being asked a
 * different question. Wave-1 records are produced entirely mechanically from
 * that tree, so **if any of them differ between repeats, the tree differed** —
 * and the stability number above is measuring two things at once and is worth
 * nothing.
 *
 * `retries` and `fanOut` are excluded: they are facts about the *call* made for
 * that node, not about the tree, and a redraw is expected to vary.
 */
export function wave1Unchanged(passes: readonly RecordsPass[]): DeepenFinding[] {
  if (passes.length < 2) return [];
  const shapeOf = (pass: RecordsPass): string =>
    JSON.stringify(
      pass.records
        .filter((r) => r.wave === 1)
        .map((r) => ({
          where: r.where,
          depth: r.depth,
          effective: r.effective,
          structuralBlocks: r.structuralBlocks,
          bodyWords: r.bodyWords,
          authoredHeadings: r.authoredHeadings,
          range: rangeOf(r),
        }))
        .sort((a, b) => a.where.localeCompare(b.where)),
    );
  const first = passes[0]!;
  const baseline = shapeOf(first);
  const moved = passes.slice(1).filter((p) => shapeOf(p) !== baseline);
  if (moved.length === 0) return [];
  return [
    {
      kind: "seed-moved",
      fatal: true,
      message:
        `The wave-1 frontier is not the same in every repeat — "${first.label}" disagrees with ` +
        `${moved.map((p) => `"${p.label}"`).join(", ")}. Wave-1 records are derived mechanically ` +
        "from the tree the structure call produced, so a difference here means the repeats were " +
        "given different trees: the structure checkpoint was not resumed, or the blocks moved. " +
        "Question 1 is measuring the tree and the verdict at once and cannot separate them; " +
        "do not quote the stability figure from this run.",
    },
  ];
}

/* ------------------------------------------------------------ Q2 yes rate -- */

export interface YesRate {
  /** Records in this cut. */
  candidates: number;
  /** Of those, how many carry a verdict at all — wave 1 carries none. */
  asked: number;
  yes: number;
  no: number;
  /** `yes / asked`, or `null` where nobody was asked. Never 0 for "no data". */
  rate: number | null;
}

export function yesRate(records: readonly CandidateRecord[]): YesRate {
  const asked = records.filter((r) => r.rawVerdict !== null);
  const yes = asked.filter((r) => r.rawVerdict === "needs-deeper").length;
  return {
    candidates: records.length,
    asked: asked.length,
    yes,
    no: asked.length - yes,
    rate: asked.length === 0 ? null : yes / asked.length,
  };
}

/**
 * The size cuts, from the plan's own conjunction: **words trigger and blocks
 * gate** (§ "Blocks measure divisibility; words measure the reader's burden").
 * The word bands are the floor the first draft proposed (800) and the
 * forced-open ceiling (2,000), so a rate that differs across them is a rate
 * about the thing the bounds are made of.
 */
export const SIZE_BUCKETS: readonly { label: string; holds: (r: CandidateRecord) => boolean }[] = [
  { label: "under the floor (<10 blocks)", holds: (r) => r.structuralBlocks < 10 },
  { label: "10+ blocks, <800 words", holds: (r) => r.structuralBlocks >= 10 && r.bodyWords < 800 },
  {
    label: "10+ blocks, 800-2000 words",
    holds: (r) => r.structuralBlocks >= 10 && r.bodyWords >= 800 && r.bodyWords < 2000,
  },
  { label: "10+ blocks, 2000+ words", holds: (r) => r.structuralBlocks >= 10 && r.bodyWords >= 2000 },
];

export interface Q2YesRates {
  overall: YesRate;
  byWave: { wave: number; rate: YesRate }[];
  bySize: { bucket: string; rate: YesRate }[];
}

export function yesRates(records: readonly CandidateRecord[]): Q2YesRates {
  const waves = [...new Set(records.map((r) => r.wave))].sort((a, b) => a - b);
  return {
    overall: yesRate(records),
    byWave: waves.map((wave) => ({ wave, rate: yesRate(records.filter((r) => r.wave === wave)) })),
    bySize: SIZE_BUCKETS.map((b) => ({
      bucket: b.label,
      rate: yesRate(records.filter((r) => b.holds(r))),
    })),
  };
}

/* --------------------------------------------------------------- Q3 bounds -- */

/** Every `because` `decideExpansion` can give, so a zero is printed as a zero. */
export const BECAUSES = [
  "authored-heading",
  "forced-open",
  "unassessed-ceiling",
  "depth-cap",
  "divisibility-floor",
  "verdict",
  "no-verdict",
] as const;

export const BOUNDS: readonly OverridingBound[] = [
  "authored-heading",
  "depth-cap",
  "divisibility-floor",
  "forced-open",
];

export interface Q3Bounds {
  candidates: number;
  expanded: number;
  stopped: number;
  /** Every decision, by the reason the governor gave. Zeroes included. */
  because: Record<string, number>;
  /** Records where a verdict existed — the only ones a bound can overrule. */
  assessed: number;
  /** Of those, how many a bound overruled. */
  overruled: number;
  overrides: Record<OverridingBound, number>;
  /** Of the assessed records, how many the verdict alone decided. */
  decidedByVerdict: number;
  /** What a high `overruled` share means, said rather than left to be inferred. */
  reading: string;
}

export function boundTally(records: readonly CandidateRecord[]): Q3Bounds {
  const because: Record<string, number> = Object.fromEntries(BECAUSES.map((b) => [b, 0]));
  const overrides = Object.fromEntries(BOUNDS.map((b) => [b, 0])) as Record<OverridingBound, number>;
  let expanded = 0;
  let assessed = 0;
  let overruled = 0;
  let decidedByVerdict = 0;
  for (const r of records) {
    because[r.effective.because] = (because[r.effective.because] ?? 0) + 1;
    if (r.effective.decision === "expand") expanded++;
    if (r.rawVerdict !== null) {
      assessed++;
      if (r.overriddenBy !== null) {
        overruled++;
        overrides[r.overriddenBy]++;
      } else if (r.effective.because === "verdict") {
        decidedByVerdict++;
      }
    }
  }
  const share = assessed === 0 ? null : overruled / assessed;
  return {
    candidates: records.length,
    expanded,
    stopped: records.length - expanded,
    because,
    assessed,
    overruled,
    overrides,
    decidedByVerdict,
    reading:
      share === null
        ? "No node carried a verdict, so nothing could be overruled — this cut says nothing " +
          "about question 3."
        : `A bound overruled the model on ${(share * 100).toFixed(0)}% of the nodes it was asked ` +
          `about, and the verdict alone decided ${decidedByVerdict} of ${assessed}. **The higher ` +
          "the first number, the weaker the case for the feature**: if the heading rule and the " +
          "two counters are doing nearly all the deciding, the self-assessment is an expensive " +
          "opinion and the conditional-depth prompt does the same job for nothing. " +
          "docs/plans/260904d-deepen-fat-sections.md § stage 5 question 3.",
  };
}

/* ----------------------------------------------------------------- Q4 cost -- */

/**
 * What today's whole-document structure call costs on a book, from the plan's
 * costed table (§ "It costs about eight times more on a book"), 2026-09-04.
 * Every multiple this file prints is against this, and it is a **measured
 * incumbent** rather than a budget.
 */
export const INCUMBENT_BOOK_NANOS = 1_000_000_000;

export interface CostRow {
  label: string;
  /** Real money out of the ledger, in nanodollars. Never a token count. */
  nanos: number;
  /** Calls the ledger could not price. A total carrying them is short. */
  unpriced: number;
  /** `nanos / INCUMBENT_BOOK_NANOS`, for the book rows only. */
  vsIncumbent: number | null;
}

export interface Q4Cost {
  rows: CostRow[];
  /** Where the money came from, so nobody reads a token count as a price. */
  source: string;
}

export function costReport(
  rows: readonly { label: string; nanos: number; unpriced: number; isBook: boolean }[],
): Q4Cost {
  return {
    rows: rows.map((r) => ({
      label: r.label,
      nanos: r.nanos,
      unpriced: r.unpriced,
      vsIncumbent: r.isBook ? r.nanos / INCUMBENT_BOOK_NANOS : null,
    })),
    source:
      "Money is read back from `spideryarn.ai_calls` by job id (`costStore.forJob`), which is " +
      "what the gateway billed. The wave's own token counts are reported separately and are " +
      "NOT converted into a price here — docs/plans/260904d-deepen-fat-sections.md § stage 5b " +
      "asks for one or the other, said plainly, and this is the ledger.",
  };
}

/* --------------------------------------------------------------- Q5 budget -- */

export interface StepClock {
  slug: string;
  label: string;
  /** `finishedAt - startedAt` off the job's own step record, or `null` if it never ran. */
  ms: number | null;
  /** What the wave could not do, from its stats — `null` where no wave ran. */
  outOfTime: number | null;
  withheld: number | null;
  resumed: number | null;
  /**
   * **Answers paid for whose checkpoint row never landed** — the half of
   * question 5 that decides whether a self-abort was survivable. A wave that
   * stopped on time with every answer written down makes the next attempt
   * cheap; one with `uncheckpointed` above zero bought calls the next attempt
   * will buy again. src/hierarchy-deepen.ts § DeepenStats.uncheckpointed.
   */
  uncheckpointed: number | null;
}

export interface Q5Budget {
  budgetMs: number;
  deadlineMs: number;
  clocks: StepClock[];
  overBudget: StepClock[];
  /** How many clocks carried a time at all. **Zero is an absence, not a pass.** */
  measured: number;
  /** A wave that stopped early. Whether that was survivable is `wasted`. */
  selfAborted: StepClock[];
  /**
   * **A wave that bought answers whose rows never landed.** The one reading that
   * turns "it self-aborted" from a shrug into a cost: those calls are paid for
   * and the next attempt buys them again.
   */
  wasted: StepClock[];
  reading: string;
}

export function budgetReport(opts: {
  clocks: readonly StepClock[];
  budgetMs: number;
  deadlineMs: number;
}): Q5Budget {
  const measured = opts.clocks.filter((c) => c.ms !== null);
  const overBudget = measured.filter((c) => c.ms! > opts.budgetMs);
  const selfAborted = opts.clocks.filter((c) => (c.outOfTime ?? 0) > 0 || (c.withheld ?? 0) > 0);
  const wasted = opts.clocks.filter((c) => (c.uncheckpointed ?? 0) > 0);
  return {
    budgetMs: opts.budgetMs,
    deadlineMs: opts.deadlineMs,
    clocks: [...opts.clocks],
    overBudget,
    selfAborted,
    wasted,
    measured: measured.length,
    reading:
      /* **No clock is not a clean bill**, and it read as one until 2026-09-05:
         a step that never ran has `ms: null`, `overBudget` filters those out,
         and the empty answer printed "every hierarchy step finished inside the
         budget" over a phase where none of them ran at all.
         docs/reusable/silent-success.md. */
      measured.length === 0
        ? `No hierarchy step ran in this phase, so question 5 was not measured — this is an ` +
          "absence, not a pass."
        : overBudget.length === 0
        ? `All ${measured.length} hierarchy step(s) finished inside STEP_BUDGET_MS.hierarchy ` +
          `(${Math.round(opts.budgetMs / 1000)}s) and the ${Math.round(opts.deadlineMs / 1000)}s ` +
          "self-abort deadline."
        : `${overBudget.length} hierarchy step(s) ran past STEP_BUDGET_MS.hierarchy ` +
          `(${Math.round(opts.budgetMs / 1000)}s). A step past ${Math.round(opts.deadlineMs / 1000)}s ` +
          "is one the claimant puts down mid-article; what makes that survivable is the " +
          "checkpoint rows, which `withheld` counts.",
  };
}

/* ---------------------------------------------------------- phase C: inert -- */

/**
 * **"Nobody asked" and "asked and found nothing" are different facts**, and the
 * artefact has to distinguish them — the plan says so, and this is where it is
 * made checkable.
 *
 * The flag-off run writes **no records file at all** (`saveDeepenRecords`
 * returns early) and its `HierarchyRun.deepen` is `null`. The flag-on run writes
 * one whose `stats.targets` is 0. So the evidence for inertness is a *pair*: a
 * missing file on one side, a present file reporting zero on the other, and the
 * two trees identical.
 */
export interface InertnessCheck {
  /** Did the flag-off pass leave a records file? It must not. */
  offWroteRecords: boolean;
  /** Did the flag-on pass leave one? It must. */
  onWroteRecords: boolean;
  /** `stats.targets` from the flag-on pass, which must be 0. */
  targetsWhenOn: number | null;
  /** Calls the flag-on pass bought, which must be 0. */
  callsWhenOn: number | null;
  /** A digest of the published tree, each side. */
  treeBefore: string;
  treeAfter: string;
}

export function checkInertness(c: InertnessCheck): DeepenFinding[] {
  const findings: DeepenFinding[] = [];
  if (c.treeBefore !== c.treeAfter) {
    findings.push({
      kind: "not-inert",
      fatal: true,
      message:
        "The published tree changed when the deepening flag was turned on for an article where " +
        `nothing is eligible (${c.treeBefore.slice(0, 12)}… became ${c.treeAfter.slice(0, 12)}…). ` +
        "An ordinary article must come out byte-identical to today.",
    });
  }
  if (c.offWroteRecords) {
    findings.push({
      kind: "not-inert",
      fatal: true,
      message:
        "The flag-off pass wrote a deepening records file. With the flag off nothing should ask, " +
        "so there is nothing to record — and an empty record is exactly the confusion between " +
        "\"nobody asked\" and \"asked and found nothing\" the plan asks this run to keep apart.",
    });
  }
  if (!c.onWroteRecords) {
    findings.push({
      kind: "no-records",
      fatal: true,
      message:
        "The flag-on pass wrote no records file, so this run cannot say whether the wave asked " +
        "and found nothing or was never run at all. Check SPIDERYARN_DEEPEN_RECORDS reached the " +
        "worker process.",
    });
  }
  if (c.onWroteRecords && c.targetsWhenOn !== 0) {
    findings.push({
      kind: "not-inert",
      fatal: false,
      message:
        `The flag-on pass found ${c.targetsWhenOn} eligible section(s) on the ordinary article, ` +
        "so this article is not the inert case the plan wanted evidence for. That is a fact " +
        "about the article rather than a fault; pick one where nothing is eligible, or read " +
        "this row as a small-article deepening instead.",
    });
  }
  if (c.onWroteRecords && c.targetsWhenOn === 0 && (c.callsWhenOn ?? 0) > 0) {
    findings.push({
      kind: "not-inert",
      fatal: true,
      message: `No section was eligible and ${c.callsWhenOn} call(s) were still bought.`,
    });
  }
  return findings;
}

/* --------------------------------------------- the repeat actually repeated -- */

/**
 * **A repeat that bought nothing is not a repeat**, and it is the failure this
 * whole harness is most likely to produce silently: without
 * `SPIDERYARN_DEEPEN_REASK` naming this very slug, a second wave reads its own
 * content-addressed rows back, makes no call, and reports **identical verdicts
 * by construction** — which looks exactly like a perfectly stable signal.
 * src/hierarchy-deepen.ts § `REASK_ENV`.
 *
 * And the mirror of it: the structure call must **not** have been re-bought,
 * because a resumed wave 1 is what holds the seed constant. The ledger is what
 * says so — a re-bought structure call on a book is a `job: "hierarchy"` row
 * carrying the whole book's input tokens, which is an order of magnitude more
 * than the wave's own.
 */
export function checkRepeatBoughtItsWave(opts: {
  label: string;
  stats: DeepenStats;
  /** Input tokens on `job: "hierarchy"` rows for this job, out of the ledger. */
  ledgerHierarchyInputTokens: number;
  /**
   * A structure call re-bought on this article would carry at least this many
   * input tokens. The runner takes it from the article's own estimate.
   */
  structureInputTokensFloor: number;
}): DeepenFinding[] {
  const findings: DeepenFinding[] = [];
  if (opts.stats.targets > 0 && opts.stats.calls === 0) {
    findings.push({
      kind: "wave-not-rebought",
      fatal: true,
      message:
        `"${opts.label}" had ${opts.stats.targets} eligible section(s) and bought ${opts.stats.calls} ` +
        `call(s), resuming ${opts.stats.resumed}. This repeat read its answers back out of the ` +
        "checkpoint store, so its verdicts are identical to the previous repeat's BY CONSTRUCTION " +
        "and say nothing about stability. SPIDERYARN_DEEPEN_REASK must name this slug.",
    });
  }
  const waveTokens = opts.stats.usage.inputTokens;
  if (opts.ledgerHierarchyInputTokens - waveTokens >= opts.structureInputTokensFloor) {
    findings.push({
      kind: "structure-rebought",
      fatal: true,
      message:
        `"${opts.label}" billed ${opts.ledgerHierarchyInputTokens.toLocaleString()} input tokens ` +
        `under job "hierarchy" and the wave accounts for ${waveTokens.toLocaleString()} of them. ` +
        `The difference is at least one whole-document structure call (${opts.structureInputTokensFloor.toLocaleString()} ` +
        "tokens), so the seed was re-bought rather than resumed and this repeat was asked about a " +
        "different tree.",
    });
  }
  return findings;
}

/* ------------------------------------------------------------- formatting -- */

export function pct(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

export function formatYesRate(r: YesRate): string {
  return `${String(r.yes).padStart(4)} / ${String(r.asked).padEnd(4)} ${pct(r.rate).padStart(7)}  (${r.candidates} candidate${r.candidates === 1 ? "" : "s"}, ${r.candidates - r.asked} unasked)`;
}

export function formatQ1(q: Q1Stability): string {
  const lines = [
    `  passes compared            ${q.passes}`,
    `  parents in every pass      ${q.parentsCompared}` +
      (q.parentsPartial > 0 ? `   (+${q.parentsPartial} in some passes only, not compared)` : ""),
    `  1. verdict flips           ${q.verdictFlips.length} of ${q.rangesMatched} matched range(s)` +
      `   ${pct(q.rangesMatched === 0 ? null : q.verdictFlips.length / q.rangesMatched)}`,
    `  2. fan-out changed         ${q.fanOutChanged.length} parent(s)`,
    `  3. boundaries moved        ${q.boundariesMoved.length} parent(s) at equal fan-out`,
  ];
  if (q.unpairable > 0) lines.push(`  unpairable records         ${q.unpairable}`);
  lines.push(
    "  (2 and 3 are STRUCTURAL instability and are deliberately not folded into 1: a repeat that",
    "   split a parent somewhere else did not change its mind about a node, it produced other nodes.)",
  );
  for (const flip of q.verdictFlips.slice(0, 10)) {
    lines.push(
      `    flip  ${flip.range}  ${flip.verdicts.map((v) => `${v.label}=${v.verdict ?? "unasked"}`).join("  ")}`,
    );
  }
  for (const drift of [...q.fanOutChanged, ...q.boundariesMoved].slice(0, 10)) {
    lines.push(
      `    drift ${drift.whereFirstSeen}  ${drift.perPass.map((p) => `${p.label}=${p.fanOut}`).join("  ")}`,
    );
  }
  return lines.join("\n");
}

export function formatQ2(q: Q2YesRates): string {
  const lines = [`  overall                    ${formatYesRate(q.overall)}`];
  for (const w of q.byWave) lines.push(`  wave ${String(w.wave).padEnd(21)}${formatYesRate(w.rate)}`);
  for (const b of q.bySize) lines.push(`  ${b.bucket.padEnd(26)}${formatYesRate(b.rate)}`);
  return lines.join("\n");
}

export function formatQ3(q: Q3Bounds): string {
  const lines = [
    `  decisions                  ${q.expanded} expand, ${q.stopped} stop, over ${q.candidates} candidate(s)`,
    "  because",
  ];
  for (const b of BECAUSES) lines.push(`    ${b.padEnd(24)} ${String(q.because[b] ?? 0).padStart(5)}`);
  lines.push(`  a bound overruled a stated verdict  ${q.overruled} of ${q.assessed} assessed`);
  for (const b of BOUNDS) lines.push(`    ${b.padEnd(24) } ${String(q.overrides[b]).padStart(5)}`);
  lines.push(`  ${q.reading}`);
  return lines.join("\n");
}

export function formatQ4(q: Q4Cost): string {
  const lines = q.rows.map(
    (r) =>
      `  ${r.label.padEnd(34)} $${(r.nanos / 1e9).toFixed(4).padStart(9)}` +
      (r.vsIncumbent === null ? "" : `   ${r.vsIncumbent.toFixed(1)}x the incumbent $1.00`) +
      (r.unpriced > 0 ? `   (${r.unpriced} unpriced call(s) — short by an unknown amount)` : ""),
  );
  lines.push(`  ${q.source}`);
  return lines.join("\n");
}

export function formatQ5(q: Q5Budget): string {
  const lines = q.clocks.map(
    (c) =>
      `  ${c.label.padEnd(34)} ${(c.ms === null ? "—" : `${(c.ms / 1000).toFixed(1)}s`).padStart(8)}` +
      `   budget ${(q.budgetMs / 1000).toFixed(0)}s  deadline ${(q.deadlineMs / 1000).toFixed(0)}s` +
      (c.outOfTime ? `   outOfTime ${c.outOfTime}` : "") +
      (c.withheld ? `   withheld ${c.withheld}` : "") +
      (c.resumed ? `   resumed ${c.resumed}` : "") +
      (c.uncheckpointed ? `   UNCHECKPOINTED ${c.uncheckpointed}` : ""),
  );
  lines.push(`  ${q.reading}`);
  if (q.selfAborted.length > 0) {
    lines.push(
      `  ${q.selfAborted.length} wave(s) stopped short of their own deadline. A withheld answer ` +
        "has a checkpoint row waiting, which is what makes the next attempt cheap — but nothing " +
        "schedules that attempt (the plan's § \"Resumption is documented rather than built\").",
    );
  }
  if (q.wasted.length > 0) {
    lines.push(
      `  ${q.wasted.length} wave(s) bought answers whose checkpoint rows never landed. Those calls ` +
        "are paid for and the next attempt buys them again, so the self-abort was NOT cheap. Go " +
        "and look at the checkpoint store before repeating.",
    );
  }
  return lines.join("\n");
}

export function formatFindings(findings: readonly DeepenFinding[]): string {
  if (findings.length === 0) return "";
  return findings.map((f) => `    ${f.fatal ? "FATAL" : "note "}  [${f.kind}] ${f.message}`).join("\n");
}

/* ------------------------------------------------------------ the dry run -- */

/**
 * **What a free run can actually prove, as assertions rather than as a table of
 * zeroes.**
 *
 * `--dry-run` drives the identical four-phase shape with a step list that has no
 * model call in it. It cannot say anything about the wave — no records file is
 * written, so every question above would print a row of zeroes, and a row of
 * zeroes is exactly the kind of clean-looking output somebody quotes. So the
 * dry run reports on the **driving** instead, and each of these is a way the
 * driving has already been wrong or could be:
 *
 * - **A fetch that was not the fixture step.** The whole ingress is a fixture
 *   read, and its `detail` says so — `"1382 KB (fixture book)"`. On the first
 *   `--dry-run` one job in three ran production's stage 1 instead, because
 *   overlapping `enqueue` calls raced on the single global variable that
 *   silences the in-process pump: that job went to the real network with no eval
 *   overlay at all, and on the paid path it would have billed the wrong bucket.
 *
 *   **The check reads the detail, not the error**, and the first version read
 *   the error — which does not work, because the queue replaces a step's
 *   message with a reader-facing sentence ("Fetching the page did not finish…")
 *   and the words `ENOTFOUND` never reach the record. That version was watched
 *   printing "none" over a run where **every single fetch had gone to the
 *   network**. There is deliberately no second check on the error text
 *   beside this one: it would only ever fire on a job with a `fetch` step and no
 *   fixture, which this harness never builds, and an assertion that cannot be
 *   watched failing is not evidence. docs/reusable/silent-success.md.
 * - **Repeats that overlapped.** Phase B is serial deliberately: a contended
 *   repeat confounds question 1.
 * - **A load phase that did not overlap.** Three jobs that ran one after another
 *   measure nothing about the budget under load, and this box is shared, so a
 *   dev server holding a claim slot can serialise them without anything saying
 *   so.
 * - **A force that was not honoured.** A repeat whose step was skipped on its
 *   `stepIsDone` stamp bought nothing and measured nothing.
 *
 * **What it cannot prove**: that any of the ingest jobs *published*. Publishing
 * needs a tree, a tree needs a model call, so every dry-run job stops at its
 * last free step and fails. That is expected and is said out loud rather than
 * hidden — `evals/cost/run.ts` takes the same trade for the same reason.
 */
export interface DrivenJob {
  phase: string;
  label: string;
  slug: string;
  force: readonly string[];
  /** Was this job given fixture bytes? Only those are held to the fixture check. */
  createdArticle: boolean;
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
  stepOutcomes?:
    | readonly {
        name: string;
        status: string;
        detail?: string | undefined;
        error?: string | undefined;
      }[]
    | undefined;
}

/** What `fixtureFetch` puts in its `detail`, and nothing else does. */
const FIXTURE_DETAIL = /\(fixture /;

function overlaps(a: DrivenJob, b: DrivenJob): boolean {
  if (!a.startedAt || !a.finishedAt || !b.startedAt || !b.finishedAt) return false;
  return (
    Date.parse(a.startedAt) < Date.parse(b.finishedAt) &&
    Date.parse(b.startedAt) < Date.parse(a.finishedAt)
  );
}

export function checkDriving(jobs: readonly DrivenJob[]): DeepenFinding[] {
  const findings: DeepenFinding[] = [];

  /* **Every ingest must have run the fixture step, and must say so itself.**
     Asked positively, off the step's own detail — see the note above on why
     reading the error instead does not work. */
  const notFixture = jobs.filter((j) => {
    if (!j.createdArticle) return false;
    const fetched = (j.stepOutcomes ?? []).find((s) => s.name === "fetch");
    return fetched === undefined || fetched.status !== "done" || !FIXTURE_DETAIL.test(fetched.detail ?? "");
  });
  if (notFixture.length > 0) {
    findings.push({
      kind: "note",
      fatal: true,
      message:
        `${notFixture.map((j) => j.slug).join(", ")}: stage 1 did not report a fixture read. ` +
        "Every ingress here is committed bytes written through `writeRaw`, and its detail says " +
        `"N KB (fixture <name>)". A job without that ran the PRODUCTION stage 1 with no eval ` +
        "overlay — it fetched somebody else's server and, on the paid path, billed the spend to " +
        "Product. Overlapping `enqueue` calls are how this happens; see `enqueueJob`.",
    });
  }


  /* Phase B is serial, phase D is not. Both are measurable from the windows. */
  const b = jobs.filter((j) => j.phase === "B");
  for (let i = 0; i < b.length; i++) {
    for (let k = i + 1; k < b.length; k++) {
      if (overlaps(b[i]!, b[k]!)) {
        findings.push({
          kind: "note",
          fatal: true,
          message:
            `"${b[i]!.label}" and "${b[k]!.label}" overlapped. The repeats are serial ` +
            "deliberately: a contended repeat confounds question 1, which is the one the rest of " +
            "the plan leans on.",
        });
      }
    }
  }
  const d = jobs.filter((j) => j.phase === "D");
  const overlapped = d.some((x, i) => d.slice(i + 1).some((y) => overlaps(x, y)));
  if (d.length > 1 && !overlapped) {
    findings.push({
      kind: "note",
      fatal: false,
      message:
        `Phase D's ${d.length} jobs did not overlap in time, so nothing was measured under load. ` +
        "This box is shared and the queue's cap is global — another agent's dev server holding a " +
        "claim slot will serialise them, and so will a job that failed before it began.",
    });
  }

  /* A forced step that reports `skipped` bought nothing and measured nothing. */
  for (const job of jobs) {
    for (const name of job.force) {
      const outcome = (job.stepOutcomes ?? []).find((s) => s.name === name);
      if (outcome === undefined) {
        findings.push({
          kind: "note",
          fatal: true,
          message: `"${job.label}" forced ${name} and the job has no such step.`,
        });
      } else if (outcome.status === "skipped") {
        findings.push({
          kind: "note",
          fatal: true,
          message:
            `"${job.label}" forced ${name} and it was skipped on its stamp. A repeat that did ` +
            "not re-run its step bought nothing and measured nothing.",
        });
      }
    }
  }
  return findings;
}

export function formatDriving(jobs: readonly DrivenJob[]): string {
  const lines = jobs.map((j) => {
    const window =
      j.startedAt && j.finishedAt
        ? `${((Date.parse(j.finishedAt) - Date.parse(j.startedAt)) / 1000).toFixed(1)}s`
        : "—";
    return (
      `  ${j.phase}  ${j.label.padEnd(48)} ${window.padStart(8)}   ` +
      (j.stepOutcomes ?? []).map((s) => `${s.name}=${s.status}`).join(" ")
    );
  });
  lines.push(
    "",
    "  A dry-run ingest stops at its last free step and FAILS: publishing needs a tree and a tree",
    "  needs a model call. That is expected. What this phase proves is the driving — the fixture",
    "  ingress, the force, the serial repeats, the concurrent load phase — and nothing about the",
    "  wave, for which there is no records file at all.",
  );
  return lines.join("\n");
}
