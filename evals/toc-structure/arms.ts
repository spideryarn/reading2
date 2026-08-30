/**
 * The arms of the ToC structure eval, as data. An arm is a *recipe for
 * producing a tree* — which model, how hard it thinks, what it is shown, and
 * in how many calls — and adding one is adding an entry here plus, for a
 * genuinely new strategy, an executor case in model-arms.ts. It is
 * deliberately not a string the runner parses.
 *
 * **Every arm says what kind of claim its result can support** (`comparison`),
 * because several cannot support causal ones (REVIEW-SOL.md, 8):
 *
 * - `"isolated"` — differs from the incumbent in ONE variable, so a gap is
 *   attributable to that variable (still subject to run-to-run noise).
 * - `"bakeoff"` — differs in several at once. It can pick a deployable recipe;
 *   it can never explain why the recipe won, and no result from it may be
 *   quoted as a fact about any single variable.
 * - `"baseline"` / `"noise-floor"` — what ships, and its own repeat.
 *
 * An arm is the model PLUS how it is asked, never just a model id — the lesson
 * evals/embedding-retrieval.ts wrote down. `cheap-high` is the standing
 * example: gpt-5.6-luna cannot speak the Messages wire at all (src/models.ts
 * § why the quick tier has no Anthropic-SDK spelling), so that arm swaps
 * model, wire AND thinking semantics together — bakeoff, by construction.
 *
 * The two seeded arms ask different questions and both exist on purpose:
 * production already shows the model every heading block and calls headings
 * hard boundaries, so `headings-listed` (an explicit list, for salience) and
 * `headings-seeded` (a whole deterministic proposed tree, echo/edit/replace)
 * are different interventions, and the first version conflated them.
 *
 * The two free arms:
 * - **headings** is arm zero, the denominator (src/heading-tree.ts).
 * - **incumbent-disk** scores `data/<slug>/tree.json` as it sits — the
 *   incumbent's already-paid-for output. One old run per document, from
 *   different days; fine for orientation, never for the noise floor.
 */

import { CAPABLE_MODEL_OPENROUTER, QUICK_MODEL_OPENROUTER, type Effort } from "../../src/models.js";

/** One model call's worth of choices. */
export interface CallSpec {
  /** OpenRouter spelling — the only wire id this eval sends. */
  model: string;
  effort: Effort;
}

/** What kind of claim a result from this arm can support. */
export type Comparison = "baseline" | "noise-floor" | "isolated" | "bakeoff";

/** What extra material, if any, a one-call arm's prompt carries about the author's headings. */
export type Seed = "none" | "heading-list" | "heading-tree";

export type ArmSpec =
  /** Free: the deterministic author-heading tree. */
  | { name: string; kind: "headings"; comparison: "baseline" }
  /** Free: score the tree already on disk in the article's directory. */
  | { name: string; kind: "disk"; comparison: "baseline" }
  /** One structure call, the shape the pipeline ships today. */
  | { name: string; kind: "one-call"; comparison: Comparison; call: CallSpec; seed: Seed }
  /**
   * L1 in one call, then one call per part for the next level, recursively to
   * `levels`. Three, not two: the book-length motivation for waves is depth
   * the single call cannot reach, and an L1→L2 pilot would not test the
   * process it argues for (REVIEW-SOL.md, 8).
   *
   * `deltas` documents EVERY way this arm's prompts differ from production's,
   * per the governing rule: hold constant everything the arm is not about.
   * The arm tests *waves*, not "waves plus a prompt somebody rewrote" — a
   * better prompt is a different arm.
   */
  | {
      name: string;
      kind: "waves";
      comparison: "bakeoff";
      call: CallSpec;
      levels: number;
      deltas: readonly string[];
    }
  /** A cheap model proposes the whole tree; a capable one revises it. */
  | {
      name: string;
      kind: "revise";
      comparison: "bakeoff";
      propose: CallSpec;
      revise: CallSpec;
      deltas: readonly string[];
    };

const INCUMBENT: CallSpec = { model: CAPABLE_MODEL_OPENROUTER, effort: "high" };

export const ARMS: readonly ArmSpec[] = [
  { name: "headings", kind: "headings", comparison: "baseline" },
  { name: "incumbent-disk", kind: "disk", comparison: "baseline" },
  {
    name: "incumbent",
    kind: "one-call",
    comparison: "baseline",
    call: INCUMBENT,
    seed: "none",
  },
  /* Identical to `incumbent` on purpose: repeats of it are the noise floor —
     the run-to-run disagreement of the shipping recipe, which is the
     resolution any arm-to-arm gap must clear. Note it measures the
     incumbent's OWN stochasticity under this configuration; a challenger may
     be more or less stable, which per-arm repeats at the finalist stage check. */
  {
    name: "incumbent-repeat",
    kind: "one-call",
    comparison: "noise-floor",
    call: INCUMBENT,
    seed: "none",
  },
  {
    name: "cheap-high",
    kind: "one-call",
    comparison: "bakeoff", // model + wire + thinking semantics move together
    call: { model: QUICK_MODEL_OPENROUTER, effort: "high" },
    seed: "none",
  },
  {
    name: "smart-low",
    kind: "one-call",
    comparison: "isolated", // one variable: effort
    call: { model: CAPABLE_MODEL_OPENROUTER, effort: "low" },
    seed: "none",
  },
  {
    name: "headings-listed",
    kind: "one-call",
    comparison: "isolated", // one variable: an explicit list of the author's headings
    call: INCUMBENT,
    seed: "heading-list",
  },
  {
    name: "headings-seeded",
    kind: "one-call",
    comparison: "isolated", // one variable: the whole deterministic proposal
    call: INCUMBENT,
    seed: "heading-tree",
  },
  {
    name: "waves",
    kind: "waves",
    comparison: "bakeoff",
    call: INCUMBENT,
    levels: 3,
    deltas: [
      "system: production SYSTEM verbatim, plus a scoped wave addendum (wave 1: root and chapters only, no deeper; later waves: subdivide one given part, no deeper)",
      "later waves see ONLY their own part's blocks — that is where the latency and cost case lives — plus the parent's title and gist and the sibling titles as a context preamble",
      "a part or section spanning nine blocks or fewer is not subdivided, which is production's own long-run rule applied as scope",
    ],
  },
  {
    name: "cheap-then-revise",
    kind: "revise",
    comparison: "bakeoff",
    propose: { model: QUICK_MODEL_OPENROUTER, effort: "high" },
    revise: INCUMBENT,
    deltas: [
      "call 1 (cheap, chat wire): production prompt verbatim",
      "call 2 (capable, messages wire): production SYSTEM verbatim plus a revise addendum; the user prompt is the article followed by the draft, with explicit permission to change anything including starting over",
    ],
  },
];

export function armByName(name: string): ArmSpec {
  const arm = ARMS.find((a) => a.name === name);
  if (!arm) {
    throw new Error(
      `No arm named "${name}". Arms: ${ARMS.map((a) => a.name).join(", ")}`,
    );
  }
  return arm;
}
