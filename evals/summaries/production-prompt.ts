/**
 * **The incumbent arm's rules, read off the prompt production actually sends.**
 *
 * The control arm has to be the current instructions, and there are two ways to
 * get them: type them in here, or read them out of `SYSTEM`. The first is what
 * `evals/hierarchy-structure/arms.ts` did with `effort`, and it drifted — the
 * arm said `"high"` for six weeks after production moved to `"medium"`, so an
 * arm declared *isolated* was answering a question production does not have
 * while reporting itself as the answer to the one it does
 * (`tests/hierarchy-eval-incumbent-parity.test.ts` has the whole story). A
 * literal here would drift the same way and be harder to notice, because a
 * paragraph of prose looks right at a glance in a way a wrong enum does not.
 *
 * So the blocks are **sliced out of the live `SYSTEM`** at run time, through the
 * exported `structureRequest` — the same function `generateHierarchy` builds its
 * request with, so there is no second assembly. Edit the GISTS block in
 * `src/hierarchy.ts` and the incumbent arm changes in the same commit.
 *
 * **The slice is by section header at column zero**, and it throws when a header
 * moves. That is the point: a lenient slice returns the empty string, the arm
 * sends a system prompt with no gist rules in it, the model writes plausible
 * gists anyway because the JSON shape still tells it to, and the control arm
 * quietly becomes "Sonnet, unprompted" — which would beat or lose to the
 * variants for reasons nothing in the results file could explain.
 *
 * **What this cannot pin.** Production asks for structure, titles, gists and
 * questions in ONE long-context response; this eval asks only for wording, over
 * a tree that is already fixed. So the incumbent arm carries production's *rules*
 * and not production's *call*, and that is why every arm in this eval is a
 * `bakeoff` — see [`arms.ts`](arms.ts) § `Comparison`.
 */

import { structureRequest } from "../../src/hierarchy.js";
import type { Block } from "../../src/types.js";

/**
 * One block, only so `structureRequest` has something to size a budget from.
 * The system prompt does not depend on it — asserted in
 * `tests/summaries-eval.test.ts` by slicing from two different inputs.
 */
const ONE_BLOCK: Block[] = [
  {
    id: "spya-000000",
    tag: "p",
    kind: "text",
    text: "A block, so that a budget can be computed. Nothing reads it.",
    words: 11,
    gistable: true,
    html: "<p>A block, so that a budget can be computed. Nothing reads it.</p>",
  } as Block,
];

/** The whole of `SYSTEM`, as `generateHierarchy` sends it. */
export function productionSystem(): string {
  return structureRequest(ONE_BLOCK).system;
}

/**
 * The text from one section header up to the next, header line included.
 *
 * Headers are `SECTION` or `SECTION (aside)` at column zero, which is how
 * `SYSTEM` is written. `next` is the header that ends the slice; naming it
 * rather than "the next all-caps line" means a new section inserted between the
 * two fails loudly instead of being silently absorbed into the answer.
 */
export function sectionOf(system: string, start: RegExp, next: RegExp, label: string): string {
  const lines = system.split("\n");
  const from = lines.findIndex((l) => start.test(l));
  if (from < 0) throw new Error(`the production SYSTEM has no ${label} section (looked for ${start})`);
  const rest = lines.slice(from + 1);
  const to = rest.findIndex((l) => next.test(l));
  if (to < 0) throw new Error(`the production SYSTEM's ${label} section is not followed by ${next}`);
  const text = [lines[from]!, ...rest.slice(0, to)].join("\n").trim();
  if (text.split("\n").length < 3) {
    throw new Error(`the production SYSTEM's ${label} section is ${text.split("\n").length} lines — the slice has gone wrong`);
  }
  return text;
}

/** Production's GISTS block, verbatim. */
export function productionGists(system = productionSystem()): string {
  return sectionOf(system, /^GISTS\b/, /^QUESTIONS\b/, "GISTS");
}

/** Production's QUESTIONS block, verbatim — the one every variant replaces. */
export function productionQuestions(system = productionSystem()): string {
  return sectionOf(system, /^QUESTIONS\b/, /^OUTPUT\b/, "QUESTIONS");
}

/**
 * **The instruction the plan diagnoses as the cause**, quoted here so a test can
 * watch for the day it leaves.
 *
 * `src/hierarchy.ts` § SYSTEM, QUESTIONS: *"It is the question this node's text
 * answers and its gist does NOT."* Every variant drops it; the incumbent keeps
 * it. If this sentence disappears from production without this eval being
 * re-run, the control arm is no longer the thing the variants were measured
 * against — which is a reason to start a new series, not to extend the old one.
 */
export const THE_DIAGNOSED_SENTENCE = "and its gist does NOT";
