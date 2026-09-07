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
 * One `comparison` value per arm was not enough to say what is true here. V1–V3
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

import { type ModelNode, questionFor } from "../../src/hierarchy.js";
import { productionGists, productionQuestions } from "./production-prompt.js";
import { readVariants } from "./variants-file.js";

/** What kind of claim a result from this arm can support. */
export type Comparison = "baseline" | "noise-floor" | "bakeoff";

/**
 * **The rule the generated line has to survive to reach a reader**, applied by
 * the harness exactly where production applies it.
 *
 * `production` is `questionFor` itself, imported rather than described, and
 * since 2026-09-07 it is the only member.
 *
 * **There used to be a second, and its retirement is the record of a cost being
 * paid rather than a simplification.** `trailing-hint` was the two-line patch
 * `variants.md` § *The code change V4 needs* specifies, reimplemented here so
 * that "this variant requires touching production code" stayed visible instead
 * of being absorbed into a shared helper. V4 then won and shipped
 * (`toc/7`), production's own `questionFor` has that clause, and a
 * reimplementation of a rule the imported function already has is a second home
 * for one fact.
 *
 * **This is the slot for the next one.** A future variant that cannot be
 * expressed in the prompt alone adds a member here, a function beside
 * `questionRuleFor`, and an entry in `deltas` — and `armsNeedingCodeChange()`
 * starts returning its name again.
 */
export type QuestionRule = "production";

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
  /**
   * A **pinned shipped** GISTS block (`"toc/5"`, `"toc/6"`) instead of either of
   * the above — `variants.md` § *The shipped GISTS block, …*.
   *
   * This exists because `incumbent` reads the *live* SYSTEM, so the moment a
   * bump lands, `incumbent` **is** the new prompt and cannot be the before half
   * of a before/after. Two pinned arms can be, and they stay pinned when
   * `src/hierarchy.ts` moves again.
   */
  shippedGists?: string;
  /**
   * A **pinned shipped** QUESTIONS block (`"toc/6"`) instead of production's
   * live one — `variants.md` § *The shipped QUESTIONS block, …*. The exact
   * mirror of `shippedGists`, added on 2026-09-07 for the same reason and by
   * the same argument, one bump later.
   *
   * V4 shipped that day, so `incumbent` **is** V4 from that commit on. Without
   * a pinned copy of the block V4 replaced, this eval would have two names for
   * one recipe and no pre-V4 control at all — and could therefore never return
   * the answer *"the control was better all along"*, which it was deliberately
   * built to be able to give.
   *
   * Mutually exclusive with `variant`: a QUESTIONS block comes from exactly one
   * place, and `promptBlocksFor` throws rather than silently preferring one.
   */
  shippedQuestions?: string;
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

/**
 * **The length-budget pair, and it asks a different question from the rest of
 * this file.**
 *
 * Everything else here is choosing between Socratic *question* shapes.
 * `gists-toc5` and `gists-toc6` ask one thing only: **did the `toc/6` per-depth
 * length ceiling change the gists the model writes, and in the direction asked
 * for?** Both carry the same QUESTIONS block, so the GISTS block is the single
 * variable — the one genuinely isolated pair here, though both stay `bakeoff`
 * because `SHARED_DELTAS` is still true of them.
 *
 * **That QUESTIONS block is PINNED to V4, and was production's live slice until
 * 2026-09-07.** Holding a *live* block equal on both members is enough to keep
 * this pair isolated — it moves on both at once — but it is not enough for the
 * pair `questions-toc6` makes with `gists-toc6`, which claims to be V4's wording
 * against the wording it replaced. With a live slice on one half, editing one
 * word of `src/hierarchy.ts` silently changes what that comparison is of, while
 * the arm's own note claims both halves stay put. ⟨GPT Sol, F13, 2026-09-07.⟩
 *
 * So both length-pair arms name `variant: "V4"`. They still send exactly what
 * production sends today — `tests/summaries-eval.test.ts` asserts
 * `productionQuestions()` is byte-identical to `variants.md` § V4 — and they go
 * on sending it after production moves on, which is what a pinned arm is for.
 *
 * **Run them at `--depth 2`.** Depth 2 is where 852 of the 1,239 stored gists
 * live and where the *"22-32 words, and use them"* half of the change has to
 * show up; at the default depth 1 a run can only see the two ceilings.
 *
 * **`incumbent` is deliberately not the comparison.** It slices the *live*
 * SYSTEM, so from the moment a bump lands it **is** the new prompt: byte for
 * byte `gists-toc6`. Running it against `gists-toc6` buys a second sample of the
 * after and no before at all. `tests/summaries-eval.test.ts` asserts that
 * identity rather than leaving it to be discovered by a null result.
 */
const LENGTH_PAIR_DELTAS: readonly string[] = [
  ...SHARED_DELTAS,
  "GISTS: a PINNED copy of a shipped block from variants.md, not the live slice; QUESTIONS: PINNED to V4, which is what production sends today and will go on being what this pair sends after production moves",
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
    /**
     * **Since `toc/7` this arm also carries V4's questions**, because production
     * does and it takes production's live block. It is therefore byte-identical
     * to the arm that used to be called `v4`, which is why that entry was
     * removed rather than kept beside it — see the note above `questions-toc6`.
     * Its own axis is unchanged: it is still the GISTS block alone against
     * `incumbent`.
     */
    name: "gists-only",
    comparison: "bakeoff",
    isolatedAgainst: "incumbent",
    axis: "the GISTS block alone: no meta-narration, root briefest — Greg's asks (ii) and (iii)",
    newGists: true,
    questionRule: "production",
    deltas: [
      ...SHARED_DELTAS,
      "GISTS: the replacement block from variants.md; QUESTIONS: production's, unchanged — which since toc/7 is V4's",
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
  /**
   * **`v4` used to be here, and it was removed on 2026-09-07 because it won.**
   *
   * Its recipe was the replacement GISTS block plus V4's QUESTIONS block. V4
   * shipped as `toc/7` that day, so `productionQuestions()` now returns V4's
   * block byte for byte — which makes that recipe **identical to `gists-only`**,
   * character for character on both blocks. Two arms with one recipe is the
   * shape this file reserves for `incumbent` / `incumbent-repeat` and forbids
   * anywhere else: a noise-floor pair measures the model's wobble, and an
   * undeclared one would report that wobble as an effect.
   *
   * So the reading-order comparison that used to be `v1` against `v4` is now
   * `v1` against `gists-only` — the same bytes under the arm that was already
   * carrying production's questions.
   *
   * **What replaces it as evidence is `questions-toc6` below**, which is the
   * comparison that still has a question to answer: V4 against the wording it
   * displaced, both halves pinned. And `tests/summaries-eval.test.ts` asserts
   * `productionQuestions()` is byte-identical to `variants.md` § V4 directly,
   * without needing an arm to carry the claim.
   */
  {
    name: "gists-toc5",
    comparison: "bakeoff",
    axis: "the GISTS block as it shipped BEFORE the toc/6 bump: one sentence, no ceiling anywhere",
    variant: "V4",
    newGists: false,
    shippedGists: "toc/5",
    questionRule: "production",
    deltas: LENGTH_PAIR_DELTAS,
  },
  {
    name: "gists-toc6",
    comparison: "bakeoff",
    isolatedAgainst: "gists-toc5",
    axis: "the GISTS block as it ships today: root <=18 words, depth 1 <=25, deeper 22-32",
    variant: "V4",
    newGists: false,
    shippedGists: "toc/6",
    questionRule: "production",
    deltas: LENGTH_PAIR_DELTAS,
  },
  {
    /**
     * **Immediate pre-V4 production, both blocks pinned — the QUESTIONS axis's
     * before half, and the arm that lets "the control was better all along" be
     * an answer this eval can return.**
     *
     * Added 2026-09-07, when V4 shipped. `incumbent` slices the live SYSTEM, so
     * from that commit it carries V4's questions; the wording V4 displaced has
     * no other home, and without one the eval's null would look like a finding
     * rather than a missing arm.
     *
     * **Its partner is `gists-toc6`, not `incumbent`, and that is the whole
     * design.** `gists-toc6` is pinned toc/6 GISTS with production's live —
     * i.e. V4's — QUESTIONS. This arm is pinned toc/6 GISTS with pinned toc/6
     * QUESTIONS. So the pair differs in **exactly one block**, both halves stay
     * put when `src/hierarchy.ts` moves again, and the comparison is *V4's
     * wording against the wording it replaced* rather than a bakeoff of two
     * recipes. `incumbent` could not play that part: its gists follow the live
     * SYSTEM, so the day the GISTS block moves the pair is two variables and
     * nobody notices.
     *
     * **The normaliser is production's, and the difference is measured at
     * zero.** An arm is a GISTS block, a QUESTIONS block and the rule the line
     * survives, so a *fully* pinned pre-V4 snapshot would want pre-V4
     * `questionFor` too. The two rules differ on exactly one input: a line
     * ending in `?` followed by a short bracket. The toc/6 block never asks for
     * one, and the 2026-09-05 run measured **0% bracketed hints across 183
     * questions** from the three arms carrying it (`incumbent`,
     * `incumbent-repeat`, `gists-only`). So pinning a second normaliser would
     * add a branch that cannot fire. Recorded rather than assumed: GPT Sol
     * raised it as F1 on 260907d and this is the answer, with the number.
     *
     * It is also the only remaining home of the sentence
     * `production-prompt.ts` exports as `THE_DIAGNOSED_SENTENCE` — *"and its
     * gist does NOT"* — which the plan diagnosed as the cause of the generic
     * questions `antikythera` still carries in the wild.
     */
    name: "questions-toc6",
    comparison: "bakeoff",
    isolatedAgainst: "gists-toc6",
    axis: "the QUESTIONS block as it shipped BEFORE toc/7 — the pre-V4 control, pinned on both blocks",
    newGists: false,
    shippedGists: "toc/6",
    shippedQuestions: "toc/6",
    questionRule: "production",
    deltas: [
      ...SHARED_DELTAS,
      "GISTS and QUESTIONS are BOTH pinned copies from variants.md, not the live slice — vs `gists-toc6`, the QUESTIONS block alone",
    ],
  },
];

export function armByName(name: string): ArmSpec {
  const arm = ARMS.find((a) => a.name === name);
  if (!arm) throw new Error(`No arm named "${name}". Arms: ${ARMS.map((a) => a.name).join(", ")}`);
  return arm;
}

/** The GISTS and QUESTIONS blocks this arm sends, resolved from the three sources. */
export function promptBlocksFor(arm: ArmSpec): { gists: string; questions: string } {
  const file = readVariants();
  let gists: string;
  if (arm.shippedGists !== undefined) {
    const pinned = file.shippedGists.get(arm.shippedGists);
    if (pinned === undefined) {
      throw new Error(
        `arm "${arm.name}" wants the shipped ${arm.shippedGists} GISTS block, which variants.md does not pin — it has ${[...file.shippedGists.keys()].join(", ") || "none"}`,
      );
    }
    gists = pinned;
  } else {
    gists = arm.newGists ? file.gists : productionGists();
  }
  /* Two ways to name a QUESTIONS block that is not production's, and an arm
     naming both is a bug in ARMS rather than a preference to resolve — the
     lenient reading would send one block while the results file named the
     other. */
  if (arm.variant !== undefined && arm.shippedQuestions !== undefined) {
    throw new Error(
      `arm "${arm.name}" declares both variant ${arm.variant} and the shipped ${arm.shippedQuestions} QUESTIONS block; it may name at most one`,
    );
  }
  if (arm.shippedQuestions !== undefined) {
    const pinned = file.shippedQuestions.get(arm.shippedQuestions);
    if (pinned === undefined) {
      throw new Error(
        `arm "${arm.name}" wants the shipped ${arm.shippedQuestions} QUESTIONS block, which variants.md does not pin — it has ${[...file.shippedQuestions.keys()].join(", ") || "none"}`,
      );
    }
    return { gists, questions: pinned };
  }
  if (arm.variant === undefined) return { gists, questions: productionQuestions() };
  const questions = file.questions.get(arm.variant);
  if (questions === undefined) {
    throw new Error(
      `arm "${arm.name}" wants variant ${arm.variant}, which variants.md does not define — it has ${[...file.questions.keys()].join(", ")}`,
    );
  }
  return { gists, questions };
}

/* ---------------------------------------------------- the rule, which is -- */
/* ------------------------------------------------------ production's now -- */

/**
 * **`questionForTrailingHint` used to live here, and its deletion on 2026-09-07
 * is the point rather than a tidy-up.**
 *
 * It was a reimplementation of `questionFor` carrying V4's two-line patch,
 * written here because the lines that change are inside `questionFor` and the
 * module-private `bareWords`. A copy is a real duplication, so it was held down
 * two ways: every behaviour meant to be *identical* to production's was
 * asserted case by case against the imported `questionFor`, and the one meant to
 * *differ* was asserted to differ.
 *
 * V4 shipped, production took the patch, and the half of that pairing that
 * justified the copy — *something differs* — stopped being true. What replaces
 * it in `tests/summaries-eval.test.ts` is the same assertion pointed at the real
 * thing: production's own `questionFor` keeps `…consciousness? (4 arguments)`
 * and still drops the gist re-asked in that shape.
 */

/** The rule this arm's lines are put through, as a function. */
export type QuestionRuleFn = (
  node: { gist?: string | undefined; question?: string | undefined },
  depth: number,
) => string | undefined;

export function questionRuleFor(_arm: ArmSpec): QuestionRuleFn {
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

/**
 * Arms whose winning would require editing `src/hierarchy.ts` beyond the prompt.
 *
 * **Empty since 2026-09-07, and that is a fact worth printing rather than a
 * function to delete.** It returned `["v4"]` for two days; V4 won, the patch
 * landed, and the results file now says `(none)` — which is the true statement
 * about the current lineup and the thing a reader of a future run needs to
 * know. `QuestionRule` above is the slot the next one goes in.
 */
export function armsNeedingCodeChange(): string[] {
  return ARMS.filter((a) => a.questionRule !== "production").map((a) => a.name);
}
