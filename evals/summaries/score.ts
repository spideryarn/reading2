/**
 * **Everything deterministic**: the shape facts, the two resolutions, and the
 * decision rules — declared here, before any run, rather than argued after one.
 *
 * ## Facts, not scores
 *
 * `shapeFacts` measures a line: its length, whether it ends in `?`, whether it
 * opens yes/no, whether it carries a bracketed hint and whether that hint claims
 * a number, and whether it contains one of the meta-narration openers the new
 * GISTS block bans. **None of these is a defect and none is summed into
 * anything.** They are there so a reader of the results can see *what* the arms
 * did differently, and so the write-up can say "V3's questions are yes/no in 8
 * of 11 rows" as an observation.
 *
 * That restraint is load-bearing rather than fastidious. V3 deliberately relaxes
 * production's "not yes/no" rule — that relaxation **is** its axis — so a scorer
 * that docked a point for yes/no would decide against the one arm able to
 * falsify the plan, before the judge read a word of it. The meta-narration count
 * is the mirror image: it is evidence for the `gists-only` arm, and counting it
 * as a score would let a mechanical proxy answer a question only a reader can.
 *
 * ## Two resolutions, and they measure different things
 *
 * - **The generation noise floor** — `incumbent` against `incumbent-repeat`, two
 *   runs of one recipe. How much the *model* wobbles.
 * - **Judge instability** — the same frozen output judged again under a fresh
 *   label shuffle. How much the *judge* wobbles.
 *
 * The plan asks for both because the first was being used as if it covered the
 * second, and it does not: a judge could rank identically-produced arms
 * identically every time and still reorder the real arms on every pass. Both are
 * reported in **ranks**, so an arm-to-arm gap can be compared with them directly.
 *
 * **The separability threshold is judge instability alone**, not the larger of
 * the two. This sentence said "the larger" until 2026-09-07 and the code has
 * never done that: `separabilityThreshold` returns `instability.ranks`, and the
 * note above it says why — taking the max of the two was the ad-hoc scalar GPT
 * Sol objected to. The generation floor is reported beside it and read by a
 * person.
 *
 * ## The decision rules
 *
 * 1. **The calibration gate is absolute.** If the judge did not put all five
 *    anchors below every real line, the run reports NO ranking — not a ranking
 *    with a warning on it. `anchors.ts` § `MAX_ANCHOR_INVERSIONS`.
 * 2. **A gap no larger than the threshold is not a gap.** The honest output is
 *    *"not separable on quality"*, and the results file says so plainly rather
 *    than reaching for a winner — the rule `evals/hierarchy-structure` already
 *    runs under.
 * 3. **Nothing here ships a variant.** The strongest claim available is *this
 *    variant is not obviously worse and is worth rendering for Greg*, which is
 *    stage 2 of the plan's staging. Both advisers reached the same conclusion
 *    from opposite directions: the final instrument is Greg reading rendered
 *    examples.
 */

import { type Attempt, type Coverage, coverageOf } from "../dictation/coverage.js";
import { isAnchorId } from "./anchors.js";
import type { Cell } from "./generate.js";
import type { JudgedLineup } from "./judge.js";

/* ------------------------------------------------------- facts, not scores */

/** The openers the replacement GISTS block bans, verbatim from `variants.md`. */
export const META_NARRATION = [
  "the essay opens by",
  "the essay closes by",
  "this section explores",
  "the author then turns to",
  "goes on to",
];

export interface ShapeFacts {
  words: number;
  sentences: number;
  endsInQuestionMark: boolean;
  /** Opens with an auxiliary or copula — "is", "does", "was", "can", "did", "will", "was". */
  yesNoOpener: boolean;
  /** A `(…)` group anywhere in the line. */
  hasBracketedHint: boolean;
  /** The hint claims a count — a digit or a number word inside the brackets. */
  hintClaimsCount: boolean;
  /** The hint sits after the `?`, which is V4's shape and production's since toc/7. */
  hintAfterQuestionMark: boolean;
  metaNarration: string[];
}

const NUMBER_WORD = /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i;
const YES_NO = /^(is|are|was|were|does|do|did|can|could|will|would|should|has|have|had|must|may)\b/i;

export function shapeFacts(line: string): ShapeFacts {
  const trimmed = line.trim();
  const hint = /\(([^()]*)\)/.exec(trimmed);
  /* The question proper, for the yes/no test: everything after the last colon
     or em-dash, since V1-V4 all put the topic (and sometimes the hint) first. */
  const question = trimmed.split(/[:—]/).at(-1)?.trim() ?? trimmed;
  const lower = trimmed.toLowerCase();
  return {
    words: trimmed.split(/\s+/).filter(Boolean).length,
    sentences: trimmed.split(/[.!?](?:\s|$)/).filter((s) => s.trim() !== "").length,
    endsInQuestionMark: trimmed.endsWith("?"),
    yesNoOpener: YES_NO.test(question),
    hasBracketedHint: hint !== null,
    hintClaimsCount: hint !== null && NUMBER_WORD.test(hint[1] ?? ""),
    hintAfterQuestionMark: /\?\s*\([^()]*\)\s*$/.test(trimmed),
    metaNarration: META_NARRATION.filter((m) => lower.includes(m)),
  };
}

/* ------------------------------------------------------------- coverage --- */

/**
 * **What one arm was sent, counted from the plan and not from what came back.**
 *
 * `gists` is one per requested node; `questions` is one per node marked
 * ASK-QUESTION. Both are products of the node list, computed **before** any call,
 * and they are the denominator.
 *
 * The denominator has to come from here rather than from `generated.json`,
 * because a cell that never got written is absent from both halves of an
 * arithmetic built out of cells — so an arm whose every call died before
 * checkpointing would be scored `0 of 0` and reported clean. ⟨GPT Sol, P0-3.⟩
 */
export interface ArmPlan {
  arm: string;
  gists: number;
  questions: number;
}

/**
 * **The clean bill, computed forwards** — the denominator fixed before the calls
 * and the numerator counted out of the answers.
 *
 * Imported from [`evals/dictation/coverage.ts`](../dictation/coverage.ts)
 * rather than reimplemented. That module was written for the two dictation
 * benchmarks and is the shared answer to
 * `docs/postmortems/260905b-the-rehearsal-reported-a-clean-run-over-zero-jobs.md`
 * — a clean bill computed over the collection the failure emptied. This repo has
 * shipped that bug twice; a third harness writing its own version would be the
 * third.
 *
 * ## A gist is not the whole of what an arm was asked for
 *
 * The first version counted `cell.lines.length` against the node count, so an
 * arm that wrote every gist and **not one question** was `clean: true` — and so
 * was an arm whose questions were all thrown away by `questionFor`, and an arm
 * that wrote questions only for the sections it found easy. Every one of those is
 * an arm that would then be ranked over fewer lineups than its rivals and could
 * still be announced as the leader. ⟨GPT Sol, P0-3.⟩
 *
 * So the unit here is **a line the reader would see**: a gist, and a question
 * that survived the arm's `questionRule`. A question the model declined to write
 * and a question the rule dropped count the same, because they reach a reader
 * the same way — not at all — and the report's shape-facts table is where the
 * two are told apart.
 *
 * `sentTo` is the model the arms were sent to, so the misnaming half applies:
 * every arm here goes to `modelFor("hierarchy")`, and a row answered by
 * something else is a row that is not about the arm it names.
 */
export function coverageFor(cells: readonly Cell[], plan: readonly ArmPlan[], sentTo: string): Coverage {
  const attempts: Attempt[] = plan.map((p) => {
    const mine = cells.filter((c) => c.arm === p.arm);
    const answers = new Map<string, number>();
    for (const cell of mine) {
      const delivered = cell.lines.length + cell.lines.filter((l) => l.question !== undefined).length;
      if (delivered === 0) continue;
      const who = cell.answeredBy ?? "(none)";
      answers.set(who, (answers.get(who) ?? 0) + delivered);
    }
    return { name: p.arm, attempted: p.gists + p.questions, sentTo, answers };
  });
  return coverageOf(attempts);
}

/* -------------------------------------------------------------- ranking --- */

/** One judged lineup, flattened to `arm -> its 0-based position`. */
function positions(judged: JudgedLineup | undefined): Map<string, number> {
  const at = new Map<string, number>();
  const ranking = judged?.ranking ?? [];
  for (let i = 0; i < ranking.length; i++) at.set(ranking[i]!, i);
  return at;
}

export interface RankSummary {
  arm: string;
  /** Mean 0-based position across every lineup this arm appeared in. Lower is better. */
  meanRank: number;
  /** How many lineups it was ranked in — the denominator, printed beside the mean. */
  lineups: number;
}

/**
 * Mean rank per real arm, over every (node, repeat) lineup.
 *
 * **Anchors are excluded from the ranking summary and from nothing else.** They
 * are a gate, not a competitor, and leaving them in would drag every arm's mean
 * up by a constant that varies with which nodes had anchors.
 */
export function meanRanks(
  judgements: readonly { nodes: Record<string, { gists?: JudgedLineup; questions?: JudgedLineup }> }[],
  which: "gists" | "questions",
): RankSummary[] {
  const totals = new Map<string, { sum: number; n: number }>();
  for (const j of judgements) {
    for (const node of Object.values(j.nodes)) {
      const at = positions(node[which]);
      /* Re-ranked over the real arms alone, so an anchor sitting third does not
         push every arm below it down one. */
      const real = [...at.entries()].filter(([id]) => !isAnchorId(id)).sort((a, b) => a[1] - b[1]);
      for (const [i, [id]] of real.entries()) {
        const t = totals.get(id) ?? { sum: 0, n: 0 };
        t.sum += i;
        t.n += 1;
        totals.set(id, t);
      }
    }
  }
  return [...totals]
    .map(([arm, t]) => ({ arm, meanRank: t.sum / t.n, lineups: t.n }))
    .sort((a, b) => a.meanRank - b.meanRank);
}

/**
 * **How much the judge moves when only the labels move**, in the units an
 * arm-to-arm gap is measured in.
 *
 * ## The first version of this was in the wrong units, and it would have been
 * useless in the safe direction
 *
 * It averaged `|rank(arm, node, repeat i) - rank(arm, node, repeat j)|` — the
 * jumpiness of a *single* lineup. Over seven arms a judge that reordered at
 * random scores about 2.3 by that measure, while the *mean* ranks it would be
 * compared against are averages over a hundred-odd lineups and differ by tenths.
 * So the threshold would have swallowed every real gap and the eval would have
 * printed *"not separable"* for ever — a wrong answer wearing the clothes of
 * caution, and the harder kind to notice.
 *
 * The comparable quantity is the **spread of an arm's MEAN rank across
 * repeats**: recompute the whole table from repeat 1 alone, then from repeat 2
 * alone, and see how far an arm's mean moves when nothing but the labels did.
 * That is exactly what an arm-to-arm gap in the final table is, so the two need
 * no conversion between them.
 *
 * Both are returned. `ranks` is the threshold; `perLineup` is reported beside it
 * because it says something the other does not — a judge with a small spread and
 * a large per-lineup churn is consistent on average and arbitrary row by row,
 * which is worth knowing before anybody quotes a single row out of the
 * materials.
 *
 * `null` when there is nothing to measure — one repeat, or no overlap — rather
 * than 0, because "perfectly stable" and "never checked" must not print the same
 * number.
 */
/**
 * One document's judgement for one repeat.
 *
 * **`slug` is load-bearing and was missing.** Node ids are per-tree, so `n0001`
 * is the root of *every* article; the first version keyed the repeat-to-repeat
 * comparison on the node id alone and therefore compared the Antikythera root
 * against the phrenology root as though they were two judgements of one frozen
 * output. ⟨GPT Sol, P0-4.⟩
 */
export type Judgement = {
  slug: string;
  repeat: number;
  nodes: Record<string, { gists?: JudgedLineup; questions?: JudgedLineup }>;
};

/** `slug/nodeId` — the identity of one lineup across repeats. */
const lineupKey = (slug: string, nodeId: string) => `${slug}/${nodeId}`;

/** Every lineup's positions, keyed by `slug/nodeId`, for one repeat. */
function lineupsOf(judgements: readonly Judgement[], repeat: number, which: "gists" | "questions"): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const j of judgements) {
    if (j.repeat !== repeat) continue;
    for (const [nodeId, node] of Object.entries(j.nodes)) {
      out.set(lineupKey(j.slug, nodeId), positions(node[which]));
    }
  }
  return out;
}

function repeatsIn(judgements: readonly Judgement[]): number[] {
  return [...new Set(judgements.map((j) => j.repeat))].sort((a, b) => a - b);
}

/** Mean |rank difference| for one arm on one lineup between two repeats. Context, never the threshold. */
function perLineupChurn(judgements: readonly Judgement[], which: "gists" | "questions"): { churn: number; comparisons: number } | null {
  const repeats = repeatsIn(judgements);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < repeats.length; i++) {
    for (let j = i + 1; j < repeats.length; j++) {
      const a = lineupsOf(judgements, repeats[i]!, which);
      const b = lineupsOf(judgements, repeats[j]!, which);
      for (const [key, pa] of a) {
        const pb = b.get(key);
        if (!pb) continue;
        for (const [arm, ra] of pa) {
          const rb = isAnchorId(arm) ? undefined : pb.get(arm);
          if (rb === undefined) continue;
          sum += Math.abs(ra - rb);
          n += 1;
        }
      }
    }
  }
  return n === 0 ? null : { churn: sum / n, comparisons: n };
}

/** How far an arm's MEAN rank moves between repeats — the comparable quantity. */
function meanRankSpread(judgements: readonly Judgement[], which: "gists" | "questions"): { spread: number; repeats: number } | null {
  const repeats = repeatsIn(judgements);
  if (repeats.length < 2) return null;
  const tables = repeats.map(
    (r) => new Map(meanRanks(judgements.filter((j) => j.repeat === r), which).map((x) => [x.arm, x.meanRank])),
  );
  const spreads: number[] = [];
  for (const arm of tables[0]!.keys()) {
    const values = tables.map((m) => m.get(arm)).filter((v): v is number => typeof v === "number");
    /* An arm that appeared in one repeat and not another has no spread to
       measure, and calling it zero would understate the floor. */
    if (values.length < 2) continue;
    spreads.push(Math.max(...values) - Math.min(...values));
  }
  if (spreads.length === 0) return null;
  return { spread: spreads.reduce((x, v) => x + v, 0) / spreads.length, repeats: repeats.length };
}

export function judgeInstability(
  judgements: readonly Judgement[],
  which: "gists" | "questions",
): { ranks: number; perLineup: number; repeats: number; comparisons: number } | null {
  const churn = perLineupChurn(judgements, which);
  const spread = meanRankSpread(judgements, which);
  if (!churn || !spread) return null;
  return { ranks: spread.spread, perLineup: churn.churn, repeats: spread.repeats, comparisons: churn.comparisons };
}

/**
 * **`incumbent` against `incumbent-repeat`, paired lineup by lineup.**
 *
 * Not `|mean(incumbent) - mean(incumbent-repeat)|`, which is what this was until
 * GPT Sol's P0-4: the two recipes are exchangeable, so opposite movements cancel
 * and that difference tends to **zero** as the corpus grows, however far apart
 * the two runs actually landed on any given row. A floor that shrinks with more
 * data while the thing it measures does not is a floor that certifies noise as
 * signal.
 *
 * The paired figure — mean |rank(incumbent) - rank(incumbent-repeat)| within one
 * lineup — cannot cancel. It is on the per-lineup scale rather than the
 * mean-rank scale, so it is reported and used as a **sanity comparison against
 * the judge's own per-lineup churn** (is the model wobbling more than the judge
 * is?) rather than as the separability threshold, which stays in mean-rank
 * units.
 */
export function generationNoiseFloor(
  judgements: readonly Judgement[],
  which: "gists" | "questions",
): { paired: number; meanGap: number | null; lineups: number } | null {
  let sum = 0;
  let n = 0;
  for (const j of judgements) {
    for (const node of Object.values(j.nodes)) {
      const at = positions(node[which]);
      const a = at.get("incumbent");
      const b = at.get("incumbent-repeat");
      if (a === undefined || b === undefined) continue;
      sum += Math.abs(a - b);
      n += 1;
    }
  }
  if (n === 0) return null;
  const ranks = meanRanks(judgements, which);
  const ma = ranks.find((r) => r.arm === "incumbent")?.meanRank;
  const mb = ranks.find((r) => r.arm === "incumbent-repeat")?.meanRank;
  return {
    paired: sum / n,
    meanGap: ma !== undefined && mb !== undefined ? Math.abs(ma - mb) : null,
    lineups: n,
  };
}

/**
 * The threshold an arm-to-arm gap has to clear: how far an arm's mean rank moves
 * when only the labels do. `null` when it could not be measured — and then **no
 * gap may be called real**, because there is nothing to call it real against.
 *
 * The generation floor is deliberately NOT folded in. It is a paired per-lineup
 * figure and this is a mean-rank figure; the two share the word "ranks" and are
 * different statistics on different sampling scales, and taking the max of them
 * was the ad-hoc scalar GPT Sol objected to. The generation floor is reported
 * beside the judge's per-lineup churn, which is its own scale.
 */
export function separabilityThreshold(instability: { ranks: number } | null): number | null {
  return instability ? instability.ranks : null;
}

export interface Separation {
  ordered: RankSummary[];
  threshold: number | null;
  /** Arms whose mean rank is within the threshold of the leader's — one group, no winner among them. */
  tiedWithLeader: string[];
  /**
   * **Was the same arm the SOLE leader of every judge repeat's own table?**
   *
   * GPT Sol's replacement for the scalar comparison, and the stronger half of
   * the test: an ordering that does not reproduce under a fresh shuffle of the
   * same frozen output is not an ordering.
   *
   * "Sole" was added on 2026-09-07. It read the top row of each repeat's table
   * and nothing else, so two arms on the same mean rank were separated by
   * whichever `meanRanks` had inserted first — and repeat 3 of the run it was
   * built for was an exact tie at 1.6667, reported as a leader flip. ⟨GPT Sol,
   * F25 on 260907d.⟩
   */
  ledEveryRepeat: boolean;
  /** Why a leader was refused, in words, when one was. */
  refusedBecause: string[];
  /** Stated forwards: a threshold exists, one arm beat it, and it led every repeat. */
  separable: boolean;
}

export function separate(
  ranks: readonly RankSummary[],
  threshold: number | null,
  opts: { perRepeatLeaders?: readonly RepeatLeaders[]; coverageClean?: boolean; judgingComplete?: boolean } = {},
): Separation {
  const ordered = [...ranks].sort((a, b) => a.meanRank - b.meanRank);
  const leader = ordered[0];
  const refusedBecause: string[] = [];
  if (!leader) return { ordered, threshold, tiedWithLeader: [], ledEveryRepeat: false, refusedBecause: ["no arm was ranked at all"], separable: false };
  if (threshold === null) refusedBecause.push("judge instability was never measured, so there is nothing to call a gap real against");
  const tiedWithLeader =
    threshold === null ? ordered.map((r) => r.arm) : ordered.filter((r) => r.meanRank - leader.meanRank <= threshold).map((r) => r.arm);
  if (threshold !== null && tiedWithLeader.length > 1) {
    refusedBecause.push(`${tiedWithLeader.join(", ")} sit within ${threshold.toFixed(2)} ranks of each other`);
  }
  const leaders = opts.perRepeatLeaders;
  const ledEveryRepeat =
    leaders !== undefined && leaders.length > 1 && leaders.every((r) => r.leaders.length === 1 && r.leaders[0] === leader.arm);
  if (leaders === undefined || leaders.length < 2) {
    refusedBecause.push("fewer than two judge repeats, so no ordering was checked for reproducibility");
  } else if (!ledEveryRepeat) {
    refusedBecause.push(`\`${leader.arm}\` is not the sole leader of every repeat (${leadersLine(leaders)})`);
  }
  /* **Coverage gates the leader, not the table.** An arm that answered only its
     easy nodes is ranked over fewer lineups than its rivals and can still top
     the mean; naming it the leader would reward the omission. ⟨GPT Sol, P0-3.⟩ */
  if (opts.coverageClean === false) {
    refusedBecause.push("the run is not a clean bill, so an arm may lead by having answered less");
  }
  /* **The same refusal, one stage later.** A judging pass that asked for three
     repeats and completed two is a table over fewer repeats than were
     pre-registered, and the repeat that failed is exactly the one that might
     have moved the leader. Until 2026-09-07 `failures` was not passed in here at
     all, so two agreeing repeats could name a leader while a third had died.
     ⟨GPT Sol, F24 on 260907d.⟩ The table is still shown — a partial run is
     reported, not suppressed — but it may not name a winner. */
  if (opts.judgingComplete === false) {
    refusedBecause.push("some judging calls failed, so this table is missing repeats that were asked for and might have moved the leader");
  }
  return {
    ordered,
    threshold,
    tiedWithLeader,
    ledEveryRepeat,
    refusedBecause,
    separable: refusedBecause.length === 0,
  };
}

/** Everything on the top mean rank of one repeat's own table. `leaders` is usually one arm. */
export interface RepeatLeaders {
  repeat: number;
  leaders: string[];
}

/**
 * **Two arms whose sums differ only in the last bits are tied, not ordered.**
 *
 * Mean ranks are sums of small integers over a count, so a genuine tie usually
 * lands on the same double — but `10/6` and `5/3` need not, and the direction
 * this can be wrong in matters: calling a tie a tie refuses a leader, and
 * calling a rounding difference an ordering names one. So the comparison is
 * within an epsilon far below anything a rank arithmetic can mean.
 */
const TIE = 1e-9;

/**
 * **The arms on top of each judge repeat's own table** — what `separate` checks
 * for reproducibility.
 *
 * It returns the whole leading SET, and the repeat number with it. It used to
 * return `[0]` of each table, which made insertion order the tie-break: repeat 3
 * of the 2026-09-07 run had `questions-toc6` and `incumbent` both on 1.6667, and
 * the report described a leader flip where a repeat had in fact tied. ⟨GPT Sol,
 * F25 on 260907d.⟩
 */
export function perRepeatLeaders(judgements: readonly Judgement[], which: "gists" | "questions"): RepeatLeaders[] {
  return repeatsIn(judgements).map((repeat) => {
    const table = meanRanks(judgements.filter((j) => j.repeat === repeat), which);
    const best = table[0];
    return {
      repeat,
      leaders: best ? table.filter((r) => r.meanRank - best.meanRank <= TIE).map((r) => r.arm) : [],
    };
  });
}

/** The per-repeat leaders as one line, with a tie printed as a tie. */
export function leadersLine(leaders: readonly RepeatLeaders[]): string {
  return leaders
    .map((r) => `repeat ${r.repeat}: ${r.leaders.length > 1 ? `${r.leaders.join(" = ")} tied` : (r.leaders[0] ?? "nothing ranked")}`)
    .join("; ");
}
