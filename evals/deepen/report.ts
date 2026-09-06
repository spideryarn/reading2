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
import type { Finding as CostFinding } from "../cost/report.js";

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
    /**
     * **An answer that could not be computed over the evidence it needs**, said
     * out loud instead of printed as a zero. Every one of Q1-Q5 has a gate that
     * can raise this, because "measured zero" and "not measured" are different
     * facts and the second one reads like the first.
     * docs/reusable/silent-success.md.
     */
    | "not-answerable"
    /** A pass whose wave threw. Its records are partial and are not evidence. */
    | "wave-failed"
    /** A row landed in the Product bucket. `evals/cost/report.ts § checkScope`. */
    | "scope-leak"
    /** Calls were made that the ledger has no row for. `checkLedgerComplete`. */
    | "ledger-short"
    /**
     * **A pass handed its claim back at its own deadline and this run stopped it
     * rather than re-driving it.** Re-driving a *re-asking* pass buys the whole
     * wave again — see `driveToDone` in run.ts.
     */
    | "requeued"
    | "note";
  message: string;
  fatal: boolean;
}

/**
 * **A cost-eval finding, in this eval's vocabulary.**
 *
 * The two evals reuse `checkScope` and `checkLedgerComplete` verbatim rather
 * than growing a second opinion about what "eval spend landed in the Product
 * bucket" and "the ledger is short" mean, so the messages come across
 * unchanged and only the kind is translated. The fatality is the cost eval's:
 * both of those are fatal there and mean the same thing here.
 */
export function asDeepenFinding(f: CostFinding): DeepenFinding {
  return {
    kind: f.kind === "scope-leak" ? "scope-leak" : f.kind === "ledger-short" ? "ledger-short" : "note",
    fatal: f.fatal,
    message: f.step === null ? f.message : `${f.step}: ${f.message}`,
  };
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
  /**
   * **Did the wave that wrote this file throw?** `deepen-records/2` carries the
   * flag for exactly this: a failed wave still writes a file, with the
   * governor's decisions and the bill and no expansion, and its records are a
   * *partial* measurement. Until 2026-09-05 the runner dropped the flag on the
   * floor between the file and the comparison, so a failed pass's half-finished
   * verdicts were aggregated beside a whole pass's.
   * ⟨GPT Sol reviewing the stage-5b harness, DPN-05.⟩
   */
  failed: boolean;
  /** What it said went wrong, where it said anything. */
  reason: string | null;
  /** The file this came off, so a reader can go and look at it. */
  file: string;
  /** The phase whose job wrote it — `"A"`, `"B"`, `"C"` or `"D"`. */
  phase: string;
}

/**
 * **The passes an answer may be computed over, and the ones it may not.**
 *
 * One place, because Q1, Q2 and Q3 all need the same split and three copies of
 * the filter is three chances for one of them to forget.
 */
export function usablePasses(passes: readonly RecordsPass[]): {
  usable: RecordsPass[];
  failed: RecordsPass[];
} {
  return {
    usable: passes.filter((p) => !p.failed),
    failed: passes.filter((p) => p.failed),
  };
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
 * **Three outcomes, and only one of the three pairs is disjoint.**
 *
 * `fanOutChanged` is disjoint from the other two by construction: a parent whose
 * child count moved is counted there and nothing else is asked of it, because a
 * parent that came back with a different number of children produced other
 * nodes rather than changing its mind, and folding that into a flip rate is what
 * the plan forbids.
 *
 * **`boundariesMoved` and `verdictFlips` overlap, deliberately**, and this file
 * described them as disjoint until 2026-09-05. One parent can move a boundary
 * *and* have a surviving child whose verdict flipped at an unchanged range, and
 * both facts are true and independent. Making them disjoint — a `continue` after
 * `boundariesMoved` — would *discard* valid same-range verdict evidence, which
 * is the wrong trade: the flip rate is the number stage 6 leans on.
 * `bothMovedAndFlipped` is the overlap, printed rather than left to be inferred.
 * ⟨GPT Sol reviewing the stage-5b harness, DPN-13; Greg agreed the reviewer was
 * right and the earlier instruction to make them disjoint was wrong.⟩
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
  /**
   * **Parents counted in `boundariesMoved` *and* carrying a flip** — the overlap
   * between the two rows that are not disjoint. Never subtracted from either.
   */
  bothMovedAndFlipped: number;
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
    bothMovedAndFlipped: 0,
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
    const moved = shapes.size > 1;
    if (moved) answer.boundariesMoved.push(drift);

    /* And the flip rate, over the ranges every pass produced — which is a
       subset of the children when the boundaries moved, and all of them when
       they did not. **No `continue` above**, deliberately: a boundary that moved
       is counted there and its surviving siblings are still compared here, and
       the alternative discards valid same-range verdict evidence. The two facts
       overlap, and `bothMovedAndFlipped` is the overlap said out loud. */
    let flippedHere = false;
    const everywhere = rows[0]!.ranges.filter((r) => rows.every((row) => row.ranges.includes(r)));
    for (const range of new Set(everywhere)) {
      answer.rangesMatched++;
      const verdicts = rows.map((row) => ({
        label: row.label,
        verdict: row.kids.find((k) => rangeKey(rangeOf(k)!) === range)?.rawVerdict ?? null,
      }));
      if (new Set(verdicts.map((v) => v.verdict)).size > 1) {
        answer.verdictFlips.push({ parent, range, verdicts });
        flippedHere = true;
      }
    }
    if (moved && flippedHere) answer.bothMovedAndFlipped++;
  }
  return answer;
}

/* ------------------------------------------------------ Q1's own gate -- */

/**
 * **Can question 1 be quoted at all?**
 *
 * Three ways it cannot, and every one of them printed a clean-looking answer
 * before 2026-09-05: fewer passes than the run set out to make, a pass whose
 * wave threw (partial records aggregated as though whole), and a comparison
 * that matched nothing anywhere — `0 of 0 —`, which reads as "perfectly stable"
 * to anybody skimming. docs/reusable/silent-success.md.
 *
 * "Matched nothing" is only a refusal where the comparison also found **no
 * structural instability**: a run whose every parent changed fan-out has
 * measured something real and says so, and the flip rate being empty is that
 * measurement's answer rather than its absence.
 */
export function q1Gate(opts: {
  expectedPasses: number;
  usable: readonly RecordsPass[];
  failed: readonly RecordsPass[];
  stability: Q1Stability | null;
}): DeepenFinding[] {
  const findings: DeepenFinding[] = [];
  for (const pass of opts.failed) {
    findings.push({
      kind: "wave-failed",
      fatal: true,
      message:
        `"${pass.label}" (${pass.file}) is a pass whose wave threw` +
        `${pass.reason === null ? "" : ` — ${pass.reason}`}. Its records are the governor's ` +
        "decisions up to the throw and nothing after it, so they are a partial measurement and " +
        "are excluded from questions 1-3. A required book pass that failed makes those answers " +
        "unquotable rather than smaller.",
    });
  }
  if (opts.usable.length !== opts.expectedPasses) {
    findings.push({
      kind: "not-answerable",
      fatal: true,
      message:
        `Question 1 needs ${opts.expectedPasses} usable pass(es) of the book's wave and this run ` +
        `has ${opts.usable.length}` +
        `${opts.failed.length > 0 ? ` (${opts.failed.length} more failed)` : ""}. A stability ` +
        "figure over fewer passes than the run set out to make is measuring a different run.",
    });
  }
  if (opts.stability !== null) {
    const structural = opts.stability.fanOutChanged.length + opts.stability.boundariesMoved.length;
    if (opts.stability.rangesMatched === 0 && structural === 0) {
      findings.push({
        kind: "not-answerable",
        fatal: true,
        message:
          "Question 1 matched no child range across the passes and found no structural " +
          "instability either, so it measured nothing at all — and `0 of 0` prints as a flip " +
          "rate of none. Not measured is not the same fact as measured zero.",
      });
    }
  }
  return findings;
}

/* ------------------------------------------- the gate Q2 and Q3 share -- */

/**
 * **A verdict rate over no verdicts is not a rate.**
 *
 * Q2 divides by `asked` and Q3 by `assessed`, and both print `—` where the
 * denominator is zero — honest on its own, and read as "nothing to worry about"
 * beside four other rows that carry numbers. So the absence becomes a finding
 * rather than a dash. ⟨GPT Sol, DPN-11.⟩
 */
export function verdictGate(opts: {
  question: string;
  assessed: number;
  failed: readonly RecordsPass[];
}): DeepenFinding[] {
  const findings: DeepenFinding[] = [];
  if (opts.assessed > 0) return findings;
  findings.push({
    kind: "not-answerable",
    fatal: true,
    message:
      `${opts.question} was computed over 0 assessed verdict(s)` +
      `${opts.failed.length > 0 ? `, with ${opts.failed.length} failed pass(es) excluded` : ""}. ` +
      "No node carried a verdict, so there is nothing to take a rate of — this is an absence and " +
      "must not be read as a measured zero.",
  });
  return findings;
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

/** How often the targets that were asked came back refused on every draw. */
export interface RefusedRate {
  /** Targets the governor sent to the model — the only ones that could refuse. */
  asked: number;
  refused: number;
  /** `null` where nothing was asked: an absence, not a rate of zero. */
  rate: number | null;
}

export interface Q2RefusedRates {
  overall: RefusedRate;
  bySize: { bucket: string; rate: RefusedRate }[];
  /** By the bound that forced the node open — the selector's own fingerprint. */
  byBecause: { because: string; rate: RefusedRate }[];
  /** Which refusals, by kind, commonest first then alphabetical. */
  byReason: { reason: string; n: number }[];
}

/**
 * **How often the model refused, and on what** — the check that prints something
 * when we are defeated.
 *
 * A target refused on every draw no longer fails the wave: it keeps the shape
 * wave 1 gave it and is recorded (`RefusedCall` in src/hierarchy-deepen.ts).
 * That is the right behaviour and it converts a loud failure into a quiet
 * absence, so this is what makes the absence loud again.
 *
 * **Bucketed because two different diseases wear the same symptom.** A model
 * dodging genuinely fat sections shows up on `10+ blocks, 2000+ words` — the
 * feature not working. A *selector* bug shows up only on tiny nodes forced open
 * by `authored-heading` — us asking a question the protocol gives no honest way
 * to answer, which is what killed the first paid run on Moby-Dick's four-block
 * title page. Different cures, and a single overall rate hides each inside the
 * other.
 *
 * The denominator is **targets that were asked**, never every candidate: a node
 * the governor stopped was never at risk of refusing, and counting it would
 * dilute the rate with nodes nobody spent anything on.
 */
export function refusedRates(records: readonly CandidateRecord[]): Q2RefusedRates {
  const asked = records.filter((r) => r.effective.decision === "expand");
  const rateOf = (over: readonly CandidateRecord[]): RefusedRate => {
    const refused = over.filter((r) => r.refused !== undefined).length;
    return { asked: over.length, refused, rate: over.length === 0 ? null : refused / over.length };
  };
  const becauses = [...new Set(asked.map((r) => r.effective.because))].sort();
  const reasons = new Map<string, number>();
  for (const r of asked) {
    if (r.refused === undefined) continue;
    reasons.set(r.refused.reason, (reasons.get(r.refused.reason) ?? 0) + 1);
  }
  return {
    overall: rateOf(asked),
    bySize: SIZE_BUCKETS.map((b) => ({ bucket: b.label, rate: rateOf(asked.filter(b.holds)) })),
    byBecause: becauses.map((because) => ({
      because,
      rate: rateOf(asked.filter((r) => r.effective.because === because)),
    })),
    byReason: [...reasons]
      .map(([reason, n]) => ({ reason, n }))
      .sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason)),
  };
}

export function formatRefusedRates(q: Q2RefusedRates): string {
  const one = (r: RefusedRate): string =>
    `${String(r.refused).padStart(4)}/${String(r.asked).padEnd(5)} ` +
    `${r.rate === null ? "  NOT ASKED" : `${(r.rate * 100).toFixed(1).padStart(9)}%`}`;
  const lines = [
    "  refused, of the targets that were asked",
    `    overall                  ${one(q.overall)}`,
  ];
  for (const b of q.bySize) lines.push(`    ${b.bucket.padEnd(24)} ${one(b.rate)}`);
  lines.push("  by the bound that forced the node open");
  for (const b of q.byBecause) lines.push(`    ${b.because.padEnd(24)} ${one(b.rate)}`);
  if (q.byReason.length > 0) {
    lines.push(
      `  refusals: ${q.byReason.map((r) => `${r.reason} ${r.n}`).join(", ")}`,
      "  A refusal on a TINY node forced open by `authored-heading` is a selector fault, not the " +
        "model dodging; on a fat node it is the feature not working. They are different cures.",
    );
  }
  return lines.join("\n");
}

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
  /**
   * Real money out of the ledger, in nanodollars — or **`null` where the ledger
   * was never read for this job**, which is not zero and must never be summed
   * as one. Until 2026-09-05 the runner filtered these rows out entirely, so a
   * job whose ledger read failed simply vanished from the bill.
   * ⟨GPT Sol, DPN-02.⟩
   */
  nanos: number | null;
  /** Calls the ledger could not price. A total carrying them is short. */
  unpriced: number;
  /** Ledger lines that could not be read at all. */
  unreadable: number;
  /**
   * **Calls that opened and never got a row**, which is the third way a bill is
   * short and the only one no read can see. `unreadable` is a line on disk that
   * will not parse; this is a line that does not exist — the request went out,
   * its collector closed before the answer came back, and `collectSpend` writes
   * nothing deliberately because the report had already been taken. A Postgres
   * read says `unreadable: 0` over it, which is how the first paid run of
   * 2026-09-05 came to print `$2.7331` as a total with four calls missing.
   * `LedgerRead.lateCalls`.
   */
  lateCalls: number;
  /** `nanos / INCUMBENT_BOOK_NANOS`, for the book rows only. */
  vsIncumbent: number | null;
}

export interface Q4Cost {
  rows: CostRow[];
  /** The rows that carried a number, summed. `null` where none did. */
  totalNanos: number | null;
  /** **Is this bill the whole bill?** False where anything above is missing or unpriced. */
  answerable: boolean;
  findings: DeepenFinding[];
  /** Where the money came from, so nobody reads a token count as a price. */
  source: string;
}

export function costReport(
  rows: readonly {
    label: string;
    nanos: number | null;
    unpriced: number;
    unreadable: number;
    lateCalls: number;
    isBook: boolean;
  }[],
): Q4Cost {
  const out: CostRow[] = rows.map((r) => ({
    label: r.label,
    nanos: r.nanos,
    unpriced: r.unpriced,
    unreadable: r.unreadable,
    lateCalls: r.lateCalls,
    vsIncumbent: r.isBook && r.nanos !== null ? r.nanos / INCUMBENT_BOOK_NANOS : null,
  }));
  const findings: DeepenFinding[] = [];
  const unread = out.filter((r) => r.nanos === null);
  const unpriced = out.filter((r) => r.unpriced > 0);
  const unreadable = out.filter((r) => r.unreadable > 0);
  const late = out.filter((r) => r.lateCalls > 0);
  if (rows.length === 0) {
    findings.push({
      kind: "not-answerable",
      fatal: true,
      message:
        "Question 4 has no rows at all: no job's ledger was read, so the bill below is an empty " +
        "table rather than a measurement of zero.",
    });
  }
  for (const r of unread) {
    findings.push({
      kind: "not-answerable",
      fatal: true,
      message:
        `${r.label}: the ledger was never read for this job, so its spend is UNKNOWN and is not ` +
        "in the total. An unread row and a zero row look the same in a sum, which is why this " +
        "one is a finding instead.",
    });
  }
  for (const r of unpriced) {
    findings.push({
      kind: "not-answerable",
      fatal: true,
      message:
        `${r.label}: ${r.unpriced} call(s) reported no cost. Its bill is unknown rather than ` +
        "zero, and a cost measurement cannot report unknown.",
    });
  }
  for (const r of unreadable) {
    findings.push({
      kind: "not-answerable",
      fatal: true,
      message: `${r.label}: ${r.unreadable} ledger line(s) could not be read, so this row is short.`,
    });
  }
  for (const r of late) {
    findings.push({
      kind: "not-answerable",
      fatal: true,
      message:
        `${r.label}: ${r.lateCalls} call(s) opened in this process and were never recorded — a ` +
        "request whose collector closed before its answer came back gets no ledger row at all, " +
        "on purpose, because the report had already been taken. So the figure beside this row " +
        "is a FLOOR and not a bill. The count is process-wide rather than per job " +
        "(`LedgerRead.lateCalls`), so it says that something here is short without saying which.",
    });
  }
  const priced = out.filter((r): r is CostRow & { nanos: number } => r.nanos !== null);
  return {
    rows: out,
    totalNanos: priced.length === 0 ? null : priced.reduce((n, r) => n + r.nanos, 0),
    answerable: findings.length === 0,
    findings,
    source:
      "Money is read back from `spideryarn.ai_calls` by job id (`costStore.forJob`), which is " +
      "what the gateway billed — and reconciled against what each step's own collector saw " +
      "(`AdvanceParts.onStepSpend`), because a row that was never inserted reads back as " +
      "`unreadable: 0`. The wave's own token counts are reported separately and are " +
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
  /**
   * **The measured step's own status** — `done`, `error`, `skipped`, or `null`
   * where the job has no such step.
   *
   * A step that started and failed has both timestamps, so it carries a clock
   * and read as a measurement: three phase-D steps that each failed in a second
   * printed *"All 3 hierarchy steps finished inside the budget"*.
   * ⟨GPT Sol, DPN-03.⟩
   */
  status: string | null;
  /** The step's own window, which is what the concurrency arithmetic is over. */
  startedAt: string | null;
  finishedAt: string | null;
  /**
   * **Did this job leave a records file with a wave's stats on it, *and* did
   * that wave finish?**
   *
   * It used to mean only "stats are present", which is a weaker fact than it
   * reads as. When a wave exhausts its redraws, `generateHierarchy` catches the
   * failure, writes a records file with `failed: true`, falls back to wave 1 and
   * completes the `hierarchy` step — so three failed waves all carried stats, a
   * `done` status and a clock, and question 5 printed "ran at once and finished
   * inside" over three measurements of the FALLBACK path. Named positively so
   * that the thing asserted is the thing the name says. ⟨GPT Sol, DPN-03-R.⟩
   */
  hasSuccessfulStats: boolean;
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

/**
 * **How many of these windows were open at once, at the busiest moment.**
 *
 * A sweep over the endpoints rather than a pairwise "did any two overlap",
 * because question 5 is about `DEFAULT_JOB_CONCURRENCY` jobs at once and *one*
 * overlapping pair out of three is what a serialised phase D looks like:
 * `SPIDERYARN_JOB_CONCURRENCY=1` still leaves all three whole-job promises
 * alive while two of them collect `busy`. ⟨GPT Sol, DPN-04.⟩
 *
 * Windows with a missing end are ignored rather than treated as open for ever:
 * an unmeasured window is an absence, and the callers count those separately.
 */
export function peakConcurrency(
  windows: readonly { startedAt?: string | null | undefined; finishedAt?: string | null | undefined }[],
): number {
  const events: { at: number; delta: number }[] = [];
  for (const w of windows) {
    if (!w.startedAt || !w.finishedAt) continue;
    const from = Date.parse(w.startedAt);
    const to = Date.parse(w.finishedAt);
    if (Number.isNaN(from) || Number.isNaN(to) || to <= from) continue;
    events.push({ at: from, delta: 1 }, { at: to, delta: -1 });
  }
  /* Ends before starts at the same instant: two windows that touch at a point
     were never concurrent, and calling them so would let a serialised phase D
     report the concurrency it was supposed to prove. */
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let open = 0;
  let peak = 0;
  for (const e of events) {
    open += e.delta;
    if (open > peak) peak = open;
  }
  return peak;
}

/**
 * **How long every one of these windows was open at the same time**, which is
 * `min(finishedAt) - max(startedAt)` and `0` where they never all were.
 *
 * **This is what `peakConcurrency` stopped being able to tell you.** The start
 * rendezvous releases the three measured steps within one turn of the event
 * loop, and a measured job that requeues is refused rather than re-driven — so
 * given three valid completions, all three clocks open before `arrive()` returns
 * and the gate says go only once all three have arrived. `peakConcurrency === 3`
 * is therefore **constructed**: true of any run that got that far, false only if
 * a clock is corrupt. It confirms the wiring and discovers nothing.
 * ⟨GPT Sol, confirming the argument, 2026-09-05.⟩
 *
 * This one is bounded by the **shortest** of the three, which is the fact that
 * matters: the load articles' `hierarchy` is far shorter than a book's
 * 658-778 s, so it says how much of the book's step was really contended rather
 * than letting an instant of overlap stand in for the whole of it.
 *
 * `null` — not zero — where any window is missing an end, because an unfinished
 * window makes the answer unknown and a zero would read as measured.
 */
export function fullConcurrencyMs(
  windows: readonly { startedAt?: string | null | undefined; finishedAt?: string | null | undefined }[],
): number | null {
  if (windows.length === 0) return null;
  let latestStart = Number.NEGATIVE_INFINITY;
  let earliestEnd = Number.POSITIVE_INFINITY;
  for (const w of windows) {
    if (!w.startedAt || !w.finishedAt) return null;
    const from = Date.parse(w.startedAt);
    const to = Date.parse(w.finishedAt);
    if (Number.isNaN(from) || Number.isNaN(to)) return null;
    if (from > latestStart) latestStart = from;
    if (to < earliestEnd) earliestEnd = to;
  }
  return Math.max(0, earliestEnd - latestStart);
}

export interface Q5Budget {
  budgetMs: number;
  deadlineMs: number;
  clocks: StepClock[];
  overBudget: StepClock[];
  /** How many clocks carried a time at all. **Zero is an absence, not a pass.** */
  measured: number;
  /** How many steps this phase was supposed to run. */
  expected: number;
  /** Steps that ran to `done`, carried a clock, and left a wave's stats behind. */
  completed: number;
  /**
   * The most of those steps that were ever in flight at once. **A wiring check
   * rather than a measurement** — `fullConcurrencyMs` says why.
   */
  peakConcurrency: number;
  /**
   * **How long all of them were in flight together**, and `null` where that is
   * unknown. The real load figure; `peakConcurrency` is constructed.
   */
  fullConcurrencyMs: number | null;
  /** The floor this run declared BEFORE it spent, so it could not be chosen after. */
  fullConcurrencyFloorMs: number;
  /** **May this answer be quoted?** Every clock present, and all of them at once. */
  answerable: boolean;
  findings: DeepenFinding[];
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

/**
 * **Question 5, and it has two halves that both have to hold.**
 *
 * *Did each step fit its budget* is the clock; *was it under load at all* is the
 * concurrency. Neither is worth anything without the other, and both had a way
 * of reporting a pass over evidence that was not there:
 *
 * - **A failed step carries a clock.** `startedAt` and `finishedAt` are both
 *   set on a step that started and blew up a second later, so three failures
 *   printed "All 3 hierarchy steps finished inside the budget". `status` and
 *   `hasSuccessfulStats` are what tell a completed step from a fast failure —
 *   and the second has to mean *the wave did not fail*, because a wave that
 *   exhausts its redraws still leaves stats and still lets the step finish, on
 *   the fallback tree. ⟨DPN-03, DPN-03-R.⟩
 * - **Whole-job windows overlap even when the steps do not.** The three phase-D
 *   promises are all alive while two of them are being told `busy`, so a
 *   serialised run passed a pairwise overlap check. The concurrency is taken
 *   over the *steps'* own windows and has to reach `expected`. ⟨DPN-04.⟩
 */
export function budgetReport(opts: {
  clocks: readonly StepClock[];
  budgetMs: number;
  deadlineMs: number;
  /** How many steps this phase planned to run — three, for phase D. */
  expected: number;
  /**
   * **The floor for `fullConcurrencyMs`, declared before the run spends.**
   *
   * Passed in rather than hard-coded here so that the number the report holds
   * itself to is the same one preflight printed — chosen before the figure was
   * seen, which is the whole point of a threshold. `run.ts` § `FULL_CONCURRENCY_FLOOR_MS`.
   */
  fullConcurrencyFloorMs: number;
}): Q5Budget {
  const measured = opts.clocks.filter((c) => c.ms !== null);
  const completed = opts.clocks.filter(
    (c) => c.status === "done" && c.ms !== null && c.hasSuccessfulStats,
  );
  const overBudget = completed.filter((c) => c.ms! > opts.budgetMs);
  const selfAborted = opts.clocks.filter((c) => (c.outOfTime ?? 0) > 0 || (c.withheld ?? 0) > 0);
  const wasted = opts.clocks.filter((c) => (c.uncheckpointed ?? 0) > 0);
  const peak = peakConcurrency(completed);
  const full = fullConcurrencyMs(completed);
  const findings: DeepenFinding[] = [];

  if (opts.expected <= 0 || completed.length !== opts.expected) {
    findings.push({
      kind: "not-answerable",
      fatal: true,
      message:
        `Question 5 needs ${opts.expected} completed step(s) with a clock and a wave that ` +
        `finished, and ` +
        `this phase has ${completed.length} of ${opts.clocks.length} (` +
        `${opts.clocks.map((c) => `${c.label}=${c.status ?? "no such step"}`).join(", ") || "no clocks at all"}` +
        "). A step that started and failed carries both timestamps, so its clock is a duration " +
        "and not a measurement; neither is a step that finished on the fallback tree because its " +
        "wave threw — this is an absence, not a pass.",
    });
  } else if (peak !== opts.expected) {
    findings.push({
      kind: "not-answerable",
      fatal: true,
      message:
        `Question 5 is "does it fit the budget UNDER LOAD", and the ${opts.expected} steps reached ` +
        `a peak of ${peak} in flight at once. They ran ${peak <= 1 ? "serially" : "partly serially"}, ` +
        "so the wall clocks below are single-job clocks. The start rendezvous releases all three " +
        "together, so a peak below that means a CLOCK IS WRONG — a step that never ran, or one " +
        "whose timestamps were replaced by a re-drive — rather than the phase having been " +
        "serialised. (It cannot have been: the gate opens only when all three hold claims, which " +
        "is all three of the queue's slots, so no other job can get between them afterwards. This " +
        "line said otherwise until 2026-09-05 — DPN-29.)",
    });
  } else if (full === null || full < opts.fullConcurrencyFloorMs) {
    /* **The measurement `peakConcurrency` stopped being.** An instant of triple
       overlap is now arranged by construction, so the question worth asking is
       how LONG all three were up — and the floor is declared before the run and
       printed in preflight, so it cannot be chosen after seeing the number. */
    findings.push({
      kind: "not-answerable",
      fatal: true,
      message:
        `Question 5 is "does it fit the budget UNDER LOAD", and all ${opts.expected} steps were ` +
        `in flight together for ${full === null ? "an unknown time" : `${(full / 1000).toFixed(1)}s`} ` +
        `against the ${(opts.fullConcurrencyFloorMs / 1000).toFixed(0)}s floor this run declared ` +
        "before it spent. The steps did start together — the rendezvous arranges that, which is " +
        "why `peakConcurrency` reaching 3 confirms the wiring and measures nothing — but the load " +
        "ended when the shortest of them did, and the budget reading below is for a step that was " +
        "contended only at its beginning. Quote it as latency after a synchronised start, not as " +
        "sustained three-job load.",
    });
  }

  const answerable = findings.length === 0;
  return {
    budgetMs: opts.budgetMs,
    deadlineMs: opts.deadlineMs,
    clocks: [...opts.clocks],
    overBudget,
    selfAborted,
    wasted,
    measured: measured.length,
    expected: opts.expected,
    completed: completed.length,
    peakConcurrency: peak,
    fullConcurrencyMs: full,
    fullConcurrencyFloorMs: opts.fullConcurrencyFloorMs,
    answerable,
    findings,
    reading:
      /* **No clock is not a clean bill**, and it read as one until 2026-09-05:
         a step that never ran has `ms: null`, `overBudget` filters those out,
         and the empty answer printed "every hierarchy step finished inside the
         budget" over a phase where none of them ran at all.
         docs/reusable/silent-success.md. */
      !answerable
        ? `Question 5 was NOT measured: ${completed.length} of ${opts.expected} step(s) completed ` +
          `and the peak concurrency was ${peak}. This is an absence, not a pass — read the ` +
          "findings before quoting any number in this block."
        : overBudget.length === 0
        ? `All ${completed.length} hierarchy step(s) ran at once (peak ${peak}) and finished ` +
          `inside STEP_BUDGET_MS.hierarchy (${Math.round(opts.budgetMs / 1000)}s) and the ` +
          `${Math.round(opts.deadlineMs / 1000)}s self-abort deadline.`
        : `${overBudget.length} hierarchy step(s) ran past STEP_BUDGET_MS.hierarchy ` +
          `(${Math.round(opts.budgetMs / 1000)}s) with ${peak} in flight at once. A step past ` +
          `${Math.round(opts.deadlineMs / 1000)}s is one the claimant puts down mid-article; what ` +
          "makes that survivable is the checkpoint rows, which `withheld` counts.",
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
  /**
   * **A control corpus that is not inert is not a control**, and this was a
   * note until 2026-09-05 — so a phase C whose "ordinary" article had eligible
   * sections could clear entirely on the strength of an unchanged tree, which
   * is a coincidence rather than the evidence phase C exists to produce.
   * Fatal now, because the reading it licenses ("an ordinary article comes out
   * byte-identical") is not what was measured. ⟨GPT Sol, DPN-10.⟩
   */
  if (c.onWroteRecords && c.targetsWhenOn !== 0) {
    findings.push({
      kind: "not-inert",
      fatal: true,
      message:
        `The flag-on pass found ${c.targetsWhenOn ?? "an unknown number of"} eligible section(s) ` +
        "on the ordinary article, and phase C's declared control requires exactly zero. This " +
        "article cannot answer \"an article where nothing is eligible comes out byte-identical\" " +
        "— an unchanged tree here is a coincidence, not the control. Pick an article where " +
        "nothing is eligible and run phase C again; read this row as a small-article deepening " +
        "and nothing else.",
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
 * And the mirror of it: on a **repeat**, the structure call must not have been
 * re-bought, because a resumed wave 1 is what holds the seed constant. The
 * ledger is what says so — a re-bought structure call on a book is a
 * `job: "hierarchy"` row carrying the whole book's input tokens, which is an
 * order of magnitude more than the wave's own.
 *
 * **`structure` is which of those two this pass is**, and getting it wrong
 * would have burned the whole paid run. Phase A is the ingest: buying the
 * structure call is the entire point of it, and the guard was applied there
 * too — so a **successful** $40.90 run would have spent the money and then
 * reported `structure-rebought` fatally over Moby-Dick's real 453,832-token
 * structure call, against a floor of 256,900.
 * ⟨GPT Sol, DPN-08; the measured call is
 * evals/results/hierarchy-waves-2026-09-04/2701-h.tree.json § usage.⟩
 *
 * On a `"bought"` pass the same arithmetic is still worth doing, pointed the
 * other way and non-fatally: an ingest whose `hierarchy` bill shows *no*
 * whole-document call resumed a structure checkpoint from somewhere, which is
 * worth knowing and is not a reason to distrust the numbers.
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
  /**
   * `"resumed"` for a forced repeat, which must not re-buy the seed;
   * `"bought"` for the ingest, where buying it is the point.
   */
  structure: "resumed" | "bought";
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
  const beyondTheWave = opts.ledgerHierarchyInputTokens - waveTokens;
  const looksLikeAStructureCall = beyondTheWave >= opts.structureInputTokensFloor;
  if (opts.structure === "resumed" && looksLikeAStructureCall) {
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
  if (opts.structure === "bought" && !looksLikeAStructureCall) {
    findings.push({
      kind: "note",
      fatal: false,
      message:
        `"${opts.label}" is the ingest, which buys the whole-document structure call — and its ` +
        `"hierarchy" bill is ${opts.ledgerHierarchyInputTokens.toLocaleString()} input tokens, ` +
        `only ${beyondTheWave.toLocaleString()} of them beyond the wave's own ` +
        `${waveTokens.toLocaleString()}, under the ${opts.structureInputTokensFloor.toLocaleString()}-token ` +
        "floor a structure call on this document would carry. Something resumed a structure " +
        "checkpoint this run did not write, so the seed came from an earlier run. The repeats are " +
        "still comparable with each other; the numbers are not a cold ingest's.",
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
    `  1 and 3 OVERLAP          ${String(q.bothMovedAndFlipped).padStart(4)} parent(s) both moved a boundary and flipped a`,
    "                                surviving child's verdict. Both facts are true; do not add the rows up.",
    "  (2 is STRUCTURAL and IS disjoint from the other two: a repeat that came back with a different",
    "   number of children produced other nodes rather than changing its mind about one.)",
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
      `  ${r.label.padEnd(34)} ` +
      (r.nanos === null ? "NOT READ ".padStart(10) : `$${(r.nanos / 1e9).toFixed(4).padStart(9)}`) +
      (r.vsIncumbent === null ? "" : `   ${r.vsIncumbent.toFixed(1)}x the incumbent $1.00`) +
      (r.unpriced > 0 ? `   (${r.unpriced} unpriced call(s) — short by an unknown amount)` : "") +
      (r.unreadable > 0 ? `   (${r.unreadable} unreadable ledger line(s))` : "") +
      (r.lateCalls > 0 ? `   (${r.lateCalls} call(s) NEVER RECORDED — this row is a floor)` : ""),
  );
  lines.push(
    `  ${"TOTAL".padEnd(34)} ` +
      (q.totalNanos === null ? "NOT READ ".padStart(10) : `$${(q.totalNanos / 1e9).toFixed(4).padStart(9)}`) +
      (q.answerable
        ? ""
        : "   INCOMPLETE — rows above are missing, unpriced, unreadable, or opened and never " +
          "recorded, so this is a floor"),
  );
  lines.push(`  ${q.source}`);
  return lines.join("\n");
}

export function formatQ5(q: Q5Budget): string {
  const lines = q.clocks.map(
    (c) =>
      `  ${c.label.padEnd(34)} ${(c.ms === null ? "—" : `${(c.ms / 1000).toFixed(1)}s`).padStart(8)}` +
      `  ${(c.status ?? "no such step").padEnd(12)}${c.hasSuccessfulStats ? "" : " no usable stats"}` +
      `   budget ${(q.budgetMs / 1000).toFixed(0)}s  deadline ${(q.deadlineMs / 1000).toFixed(0)}s` +
      (c.outOfTime ? `   outOfTime ${c.outOfTime}` : "") +
      (c.withheld ? `   withheld ${c.withheld}` : "") +
      (c.resumed ? `   resumed ${c.resumed}` : "") +
      (c.uncheckpointed ? `   UNCHECKPOINTED ${c.uncheckpointed}` : ""),
  );
  lines.push(
    `  completed ${q.completed} of ${q.expected} expected; peak ${q.peakConcurrency} step(s) in ` +
      `flight at once (must be ${q.expected}; the rendezvous arranges this, so it is a wiring ` +
      "check rather than a measurement)",
  );
  lines.push(
    `  all ${q.expected} in flight TOGETHER for ` +
      `${q.fullConcurrencyMs === null ? "an unknown time" : `${(q.fullConcurrencyMs / 1000).toFixed(1)}s`}` +
      ` against a ${(q.fullConcurrencyFloorMs / 1000).toFixed(0)}s floor declared before the run. ` +
      "This is the load figure; below the floor, the times above measure latency after a " +
      "synchronised start, not sustained three-job load.",
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
        /** The step's own window — the one phase D's concurrency is measured over. */
        startedAt?: string | null | undefined;
        finishedAt?: string | null | undefined;
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

export function checkDriving(
  jobs: readonly DrivenJob[],
  opts: {
    /**
     * The step phase D is measured on — `"hierarchy"` on the paid path,
     * `"blocks"` under `--dry-run`. Its windows are what the concurrency is
     * taken over, because the *whole-job* windows overlap even when the steps
     * run one after another: all three promises are alive while two of them
     * collect `busy`. ⟨GPT Sol, DPN-04.⟩
     */
    measuredStep: string;
    /** What `jobConcurrency()` really was while phase D ran. */
    jobConcurrency: number;
    /** What phase D was planned at — `DEFAULT_JOB_CONCURRENCY`. */
    plannedConcurrency: number;
  },
): DeepenFinding[] {
  const findings: DeepenFinding[] = [];

  /* **The runtime cap, not the constant the plan quotes.** `jobConcurrency()`
     reads `SPIDERYARN_JOB_CONCURRENCY` at call time, so a shell that set it to
     1 serialises phase D silently and the run's own metadata — which recorded
     `DEFAULT_JOB_CONCURRENCY` — would still say 3. */
  if (opts.jobConcurrency !== opts.plannedConcurrency) {
    findings.push({
      kind: "note",
      fatal: true,
      message:
        `The queue's runtime cap is ${opts.jobConcurrency} and phase D is planned at ` +
        `${opts.plannedConcurrency}. SPIDERYARN_JOB_CONCURRENCY is set to something else in this ` +
        "process, so the load phase measured a different machine from the one the plan sized.",
    });
  }

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
  /* **Phase D, over the measured step's windows and not the jobs'.** The
     question is whether `d.length` of them were in flight *at once*, which is
     what `DEFAULT_JOB_CONCURRENCY` jobs at once means — one overlapping pair
     out of three is exactly what a serialised phase D looks like. */
  const d = jobs.filter((j) => j.phase === "D");
  const steps = d.map((j) => (j.stepOutcomes ?? []).find((s) => s.name === opts.measuredStep));
  const withWindows = steps.filter((s) => s?.startedAt && s?.finishedAt);
  const peak = peakConcurrency(withWindows.map((s) => ({ startedAt: s!.startedAt, finishedAt: s!.finishedAt })));
  if (d.length > 1 && peak < d.length) {
    findings.push({
      kind: "note",
      fatal: false,
      message:
        `Phase D's ${d.length} jobs reached a peak of ${peak} \`${opts.measuredStep}\` step(s) in ` +
        `flight at once (${withWindows.length} of ${d.length} left a window at all), so the wall ` +
        "clocks are not clocks under load. This box is shared and the queue's cap is global — " +
        "another agent's dev server holding a claim slot will serialise them, and so will a job " +
        "that failed before it began. The whole-JOB windows overlap either way: all three " +
        "promises stay alive while two of them are being told `busy`.",
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
  /* **An empty table is not a quiet table.** The first `--dry-run` after `dev`
     merged printed this block, its explanatory paragraph and `Findings: none`
     over a run in which every `enqueue` had thrown and no job existed. A summary
     has to be able to say "there was nothing here". docs/reusable/silent-success.md,
     docs/postmortems/260905b-the-rehearsal-reported-a-clean-run-over-zero-jobs.md. */
  if (jobs.length === 0) {
    return (
      "  NO JOBS. Not one was created, so nothing below this line was driven, forced, timed or\n" +
      "  bought. An empty driving table is an absence, not a clean run — read the findings."
    );
  }
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
