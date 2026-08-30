/**
 * The arms of the ToC structure eval, as data. An arm is a *recipe for
 * producing a tree* — which model, how hard it thinks, what it is shown, and
 * in how many calls — and adding one is adding an entry here plus, for a
 * genuinely new strategy, an executor case in run.ts. It is deliberately not
 * a string the runner parses.
 *
 * An arm is the model PLUS how it is asked, never just a model id — the lesson
 * evals/embedding-retrieval.ts wrote down. Two of these differ from the
 * incumbent in more than the field their name advertises, and the spec says so
 * rather than leaving it to be discovered:
 *
 * - **cheap-high** cannot speak the Messages wire at all (gpt-5.6-luna is
 *   chat/completions only — src/models.ts § why the quick tier has no
 *   Anthropic-SDK spelling), so it also swaps `thinking: adaptive` for
 *   OpenRouter's `reasoning.effort`. Any gap it shows is model+wire+thinking
 *   mode together.
 * - **waves** changes the number of calls and what each one sees, not the
 *   model.
 *
 * The two free arms:
 * - **headings** is arm zero, the denominator (heading-tree.ts).
 * - **incumbent-disk** scores `data/<slug>/tree.json` as it sits — the
 *   incumbent's already-paid-for output. One old run per article, from
 *   different days; fine for orientation, not for the noise floor.
 */

import { CAPABLE_MODEL_OPENROUTER, QUICK_MODEL_OPENROUTER, type Effort } from "../../src/models.js";

/** One model call's worth of choices. */
export interface CallSpec {
  /** OpenRouter spelling — the only wire id this eval sends. */
  model: string;
  effort: Effort;
}

export type ArmSpec =
  /** Free: the deterministic author-heading tree. */
  | { name: string; kind: "headings" }
  /** Free: score the tree already on disk in the article's directory. */
  | { name: string; kind: "disk" }
  /** One structure call, the shape the pipeline ships today. */
  | {
      name: string;
      kind: "one-call";
      call: CallSpec;
      /**
       * When true, the prompt also carries the deterministic heading tree as a
       * proposed starting point, with permission to modify or replace it.
       */
      seedHeadings: boolean;
    }
  /** L1 in one call, then one call per part for L2 (parallelisable). The latency case. */
  | { name: string; kind: "waves"; call: CallSpec }
  /** A cheap model proposes the whole tree; a capable one revises it. */
  | { name: string; kind: "revise"; propose: CallSpec; revise: CallSpec };

const INCUMBENT: CallSpec = { model: CAPABLE_MODEL_OPENROUTER, effort: "high" };

export const ARMS: readonly ArmSpec[] = [
  { name: "headings", kind: "headings" },
  { name: "incumbent-disk", kind: "disk" },
  { name: "incumbent", kind: "one-call", call: INCUMBENT, seedHeadings: false },
  /* Identical to `incumbent` on purpose: the difference between the two runs is
     the noise floor — the resolution of the whole instrument. Any arm-to-arm
     gap smaller than it is not a result. Report it before any comparison. */
  { name: "incumbent-repeat", kind: "one-call", call: INCUMBENT, seedHeadings: false },
  {
    name: "cheap-high",
    kind: "one-call",
    call: { model: QUICK_MODEL_OPENROUTER, effort: "high" },
    seedHeadings: false,
  },
  {
    name: "smart-low",
    kind: "one-call",
    call: { model: CAPABLE_MODEL_OPENROUTER, effort: "low" },
    seedHeadings: false,
  },
  { name: "headings-seeded", kind: "one-call", call: INCUMBENT, seedHeadings: true },
  { name: "waves", kind: "waves", call: INCUMBENT },
  {
    name: "cheap-then-revise",
    kind: "revise",
    propose: { model: QUICK_MODEL_OPENROUTER, effort: "high" },
    revise: INCUMBENT,
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
