/**
 * The arms, as data. An arm is **a GISTS block, a QUESTIONS block, and the
 * `questionFor` rule the resulting line has to survive** — nothing else varies.
 * Adding a fifth variant is a `## V5` section in [`variants.md`](variants.md)
 * plus one entry in `ARMS`.
 *
 * ## Every arm here is a `bakeoff`, including the control, and that is a cost
 *
 * `evals/hierarchy-structure/arms.ts` draws the distinction this file inherits:
 * an `isolated` arm differs from the incumbent in one variable, so a gap is
 * attributable to it; a `bakeoff` arm differs in several and can pick a recipe
 * without ever explaining why it won.
 *
 * **This whole eval is a bakeoff by construction**, and the plan's review said
 * so before anything was built
 * ([260905f](../../docs/plans/260905f-socratic-summaries-eval-admin-page-gating-short-selections.md)
 * § *The eval, cut down*, GPT Sol's P1-2). Production asks for **structure,
 * titles, gists and questions in one long-context response**. This eval fixes
 * the structure and the titles and asks only for wording. So:
 *
 * - the control arm is **not** byte-identical to production — it is production's
 *   *rules* under a different request;
 * - nothing here can catch an interaction between the new wording and the
 *   structure the model proposes in the same breath, which is the specific thing
 *   the cheap design buys its cheapness with;
 * - a win here is a reason to put a variant in front of Greg **rendered**, not a
 *   reason to ship it. Stage 2 and stage 3 of the plan's staging are where a
 *   decision is allowed to happen.
 *
 * ## `isolatedAgainst`, which the template did not have
 *
 * One `comparison` value per arm was not enough to say what is true here. V1–V4
 * change the GISTS block **and** the QUESTIONS block against the incumbent — two
 * variables — but against `gists-only` they change exactly one. Recording only
 * the first would throw away the comparison that can attribute a gap, and
 * recording only the second would overstate what the arm is.
 *
 * So the field says which *other arm* this one differs from in a single
 * variable, and the report quotes the pair. `gists-only` exists for that reason
 * and for one more: the plan's § *Three requests, not one* says the language and
 * length changes "are true regardless of how i turns out", so they need an arm
 * that can win on their own while every Socratic arm loses.
 *
 * ## What is deliberately NOT an arm
 *
 * - **Depth-2 gists at two sentences.** Deferred by the plan (§ *The one thing
 *   narrowed rather than accepted*): it raises `TOKENS_PER_NODE`, which pushes
 *   long articles over the pre-call refusal line, and
 *   `evals/hierarchy-structure/score.ts` counts a multi-sentence gist as a
 *   defect, so it also breaks that eval's baseline. Not solved — deferred.
 * - **Question-replaces-gist versus question-beside-gist.** That is a rendering
 *   decision (`SummaryPanel`), and Sol's P1-1 moved it out of the plan's
 *   § *What changes, precisely* and into "an outcome the eval is allowed to
 *   return". The judge is shown the gist and the question together and asked
 *   about each, so the answer falls out of the axes rather than being wired in.
 * - **`EXPAND_SYSTEM`.** It has no question field at all, so a flat root
 *   deepened by the cascade gets depth-1 children with no question whatever wins
 *   here (plan § P1-5). **Nothing in this harness measures that path**, and no
 *   result from it may be read as covering the cascade.
 */

import { MAX_QUESTION_DEPTH, type ModelNode, questionFor } from "../../src/hierarchy.js";
import { productionGists, productionQuestions } from "./production-prompt.js";
import { readVariants } from "./variants-file.js";

/** What kind of claim a result from this arm can support. */
export type Comparison = "baseline" | "noise-floor" | "bakeoff";

/**
 * **The rule the generated line has to survive to reach a reader**, applied by
 * the harness exactly where production applies it.
 *
 * `production` is `questionFor` itself, imported rather than described.
 * `trailing-hint` is the two-line patch `variants.md` specifies for V4 — and it
 * is **not applied to any other arm**, because "this variant requires touching
 * production code" is part of V4's cost and hiding it inside a shared helper
 * would spend it silently.
 */
export type QuestionRule = "production" | "trailing-hint";

export interface ArmSpec {
  name: string;
  comparison: Comparison;
  /** The arm this one differs from in exactly ONE block. Absent when nothing does. */
  isolatedAgainst?: string;
  /** What this arm is for, in one line — printed in the results table. */
  axis: string;
  /** `V1`…, keyed into `variants.md`. Absent means production's QUESTIONS block. */
  variant?: string;
  /** Whether this arm sends the replacement GISTS block from `variants.md`. */
  newGists: boolean;
  questionRule: QuestionRule;
  /**
   * Everything about this arm's request that differs from production's, listed
   * rather than implied — the discipline `hierarchy-structure`'s `waves` arm
   * keeps. The two shared entries are on every arm and say why the whole eval
   * is a bakeoff.
   */
  deltas: readonly string[];
}

/** True of every arm, and the reason none of them is `isolated` against production. */
const SHARED_DELTAS: readonly string[] = [
  "the tree is FIXED: the arm is not asked for structure, ranges, titles or sourceHeadings, only for a gist and (at depth <= MAX_QUESTION_DEPTH) a question per node",
  "the OUTPUT block is this eval's, not production's — a flat {nodeId: {gist, question}} map instead of a nested tree",
  "the STRUCTURE and TITLES blocks are replaced by a rendered outline of the fixed tree",
];

export const ARMS: readonly ArmSpec[] = [
  {
    name: "incumbent",
    comparison: "baseline",
    axis: "the prompt as it ships today — the arm that lets 'change nothing' win",
    newGists: false,
    questionRule: "production",
    deltas: SHARED_DELTAS,
  },
  /* Identical to `incumbent` on purpose. Two runs of one recipe are the
     GENERATION noise floor: the run-to-run wobble any arm-to-arm gap has to
     clear. It says nothing about JUDGE stability, which is a different
     instrument and is measured by re-judging frozen output — `judge.ts`
     § `--repeats`. The plan asks for both and they are not substitutes. */
  {
    name: "incumbent-repeat",
    comparison: "noise-floor",
    isolatedAgainst: "incumbent",
    axis: "the same recipe again: the generation noise floor",
    newGists: false,
    questionRule: "production",
    deltas: SHARED_DELTAS,
  },
  {
    name: "gists-only",
    comparison: "bakeoff",
    isolatedAgainst: "incumbent",
    axis: "the GISTS block alone: no meta-narration, root briefest — Greg's asks (ii) and (iii)",
    newGists: true,
    questionRule: "production",
    deltas: [
      ...SHARED_DELTAS,
      "GISTS: the replacement block from variants.md; QUESTIONS: production's, unchanged",
    ],
  },
  {
    name: "v1",
    comparison: "bakeoff",
    isolatedAgainst: "gists-only",
    axis: "presupposed direction, hint before the colon — the baseline Socratic shape",
    variant: "V1",
    newGists: true,
    questionRule: "production",
    deltas: [...SHARED_DELTAS, "GISTS and QUESTIONS both replaced (vs `gists-only`, QUESTIONS alone)"],
  },
  {
    name: "v2",
    comparison: "bakeoff",
    isolatedAgainst: "v1",
    axis: "stance-matched mood: ARGUES / WEIGHS / TELLS chosen per node — Sol's P1-1, answered directly",
    variant: "V2",
    newGists: true,
    questionRule: "production",
    deltas: [...SHARED_DELTAS, "GISTS and QUESTIONS both replaced (vs `v1`, the QUESTIONS block alone)"],
  },
  {
    /**
     * **The arm that can falsify the plan.** It asks the question straight and
     * moves the direction into the bracketed hint, so if it wins, the plan's
     * central bet — that a neutral question cannot carry the row alone — was
     * wrong, and that is a real result rather than a null one.
     *
     * It **deliberately relaxes "not yes/no"**, which is the axis and not an
     * oversight. Nothing in the scoring may penalise a yes/no question: a
     * mechanical yes/no check would rig the result against this arm before the
     * judge saw it, so there is none, and the rubric says out loud that a
     * straight question is legitimate here. `score.ts` § `SHAPE_FACTS` records
     * yes/no as a *fact about the line*, never as a defect.
     */
    name: "v3",
    comparison: "bakeoff",
    isolatedAgainst: "v1",
    axis: "question asked straight, direction moved into the hint — the falsifier",
    variant: "V3",
    newGists: true,
    questionRule: "production",
    deltas: [...SHARED_DELTAS, "GISTS and QUESTIONS both replaced (vs `v1`, the QUESTIONS block alone)"],
  },
  {
    /**
     * **The only arm that needs a change to production code**, and the harness
     * says so rather than absorbing it. Greg's literal reading order puts the
     * shape hint after the question mark, and `questionFor` appends a second `?`
     * to anything that does not end in one — GPT Sol's P1-4, verified: the
     * stored value becomes *"…consciousness? (4 arguments)?"*.
     *
     * `variants.md` § *The code change V4 needs, and only V4* has the two-line
     * patch. This harness does **not** apply it to `src/hierarchy.ts` — stage C
     * builds the instrument only — it applies V4's rule to V4's lines here, and
     * `tests/summaries-eval.test.ts` watches production's own `questionFor`
     * mangle V4's shape, so the cost is a red test rather than a sentence.
     */
    name: "v4",
    comparison: "bakeoff",
    isolatedAgainst: "v1",
    axis: "Greg's literal order: topic — question? (hint). Needs a production code change",
    variant: "V4",
    newGists: true,
    questionRule: "trailing-hint",
    deltas: [
      ...SHARED_DELTAS,
      "GISTS and QUESTIONS both replaced (vs `v1`, the QUESTIONS block alone — reading order is the one variable)",
      "questionFor: the trailing-hint rule from variants.md, which production does NOT have",
    ],
  },
];

export function armByName(name: string): ArmSpec {
  const arm = ARMS.find((a) => a.name === name);
  if (!arm) throw new Error(`No arm named "${name}". Arms: ${ARMS.map((a) => a.name).join(", ")}`);
  return arm;
}

/** The GISTS and QUESTIONS blocks this arm sends, resolved from the two sources. */
export function promptBlocksFor(arm: ArmSpec): { gists: string; questions: string } {
  const file = readVariants();
  const gists = arm.newGists ? file.gists : productionGists();
  if (arm.variant === undefined) return { gists, questions: productionQuestions() };
  const questions = file.questions.get(arm.variant);
  if (questions === undefined) {
    throw new Error(
      `arm "${arm.name}" wants variant ${arm.variant}, which variants.md does not define — it has ${[...file.questions.keys()].join(", ")}`,
    );
  }
  return { gists, questions };
}

/* ------------------------------------------------ V4's rule, and only V4's -- */

/**
 * **`questionFor` with V4's trailing-hint clause** — the patch `variants.md`
 * specifies, run here instead of in `src/hierarchy.ts`.
 *
 * It is a reimplementation and not a wrapper, because the two lines that change
 * are inside `questionFor` and `bareWords`, and `bareWords` is module-private.
 * That is a real duplication, so it is held down two ways: the behaviour that is
 * meant to be **identical** to production's is asserted case by case against the
 * imported `questionFor`, and the one behaviour that is meant to **differ** is
 * asserted to differ — `tests/summaries-eval.test.ts`. A copy nobody compares is
 * how the drift in `hierarchy-structure/arms.ts` happened.
 */
export function questionForTrailingHint(
  node: { gist?: string | undefined; question?: string | undefined },
  depth: number,
): string | undefined {
  if (depth > MAX_QUESTION_DEPTH) return undefined;
  if (typeof node.question !== "string") return undefined;
  const q = node.question.trim();
  if (q === "") return undefined;
  /* The gist-echo check, with the bracketed hint stripped FIRST so that
     "<gist>? (4 arguments)" is still caught. variants.md's second hunk. */
  const bare = (s: string) =>
    s
      .toLowerCase()
      .replace(/\s*\([^()]*\)\s*$/, "")
      .replace(/[.!?]+$/, "")
      .replace(/\s+/g, " ")
      .trim();
  if (node.gist !== undefined && bare(q) === bare(node.gist)) return undefined;
  /* A `?` followed by nothing but one short bracketed hint is a finished line. */
  if (/\?(\s*\([^()]{1,40}\))?$/.test(q)) return q;
  return `${q.replace(/!+$/, "")}?`;
}

/** The rule this arm's lines are put through, as a function. */
export type QuestionRuleFn = (
  node: { gist?: string | undefined; question?: string | undefined },
  depth: number,
) => string | undefined;

export function questionRuleFor(arm: ArmSpec): QuestionRuleFn {
  if (arm.questionRule === "trailing-hint") return questionForTrailingHint;
  /* `questionFor` takes a whole `ModelNode` and reads two fields of it. The
     two it does not read are filled in here rather than widened in `src/`:
     production's signature is production's business, and an eval is not a
     reason to loosen it. */
  return (node, depth) => {
    const mn: ModelNode = { title: "", range: ["", ""] };
    if (node.gist !== undefined) mn.gist = node.gist;
    if (node.question !== undefined) mn.question = node.question;
    return questionFor(mn, depth);
  };
}

/** Arms whose winning would require editing `src/hierarchy.ts` beyond the prompt. */
export function armsNeedingCodeChange(): string[] {
  return ARMS.filter((a) => a.questionRule !== "production").map((a) => a.name);
}
