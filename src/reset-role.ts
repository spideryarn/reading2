/**
 * **What a reset does to each step** — the classification alone, as a leaf
 * the browser may import.
 *
 * A reset puts an article back "as if it had just been imported for the first
 * time" (Greg, 2026-09-28): the import steps run again over the stored copy,
 * and every generated extra stored on the revision is dropped from the new
 * draft. Some extras belong to modes; others are things such as the arc and
 * cross-references. docs/plans/260928a-reset-and-regenerate-article.md is the design;
 * this file is the one place that says which step is which.
 *
 * ## Three roles
 *
 * - **`import`** — `DEFAULT_INGEST_STEPS`. The reset job runs these, with
 *   `extract` forced and `cascadeForce` sweeping the rest in behind it.
 * - **`successor`** — `labels`. Not dropped by hand: a forced `structure`
 *   writes a pending manifest and the reset's publication buys the free labels
 *   job exactly as any import's does.
 * - **`extra`** — stored generated results outside a fresh import. Dropped from
 *   the reset's draft, columns and step-run rows both; queued again after
 *   publication when the reader asked.
 *
 * Exhaustive over `StepName` rather than a list of extras, so a step added to
 * the pipeline is a compile error here until somebody decides what a reset
 * does to it. A list would quietly leave the new step's artefact riding along
 * on a "fresh" article.
 *
 * ## Why this is a leaf of its own
 *
 * The Metadata page's reset section has to say which extras a reset removes,
 * and until 2026-09-28 it kept its own copy of the answer, because this map
 * lived in src/reset.ts, which reaches the database client and so may not be
 * imported by anything under `src/web/` (tests/client-imports.test.ts). A test
 * held the two copies together; Sol's F14 on
 * docs/plans/260928a-reset-and-regenerate-article-stage2-review-sol.md asked
 * for one. So the classification is here, importing `STEP_ORDER` and a type
 * and nothing else, src/reset.ts re-exports it beside the database half, and
 * the browser names each extra as it names every step (src/web/step-names.ts,
 * which replaced `RESET_EXTRA_NAME` on 2026-10-09).
 */

import { STEP_ORDER } from "./step-order.js";
import type { StepName } from "./types.js";

export type ResetRole = "import" | "successor" | "extra";

/**
 * `as const satisfies` rather than a `Record<StepName, ResetRole>` annotation,
 * so each role stays a literal and `ExtraStep` below can be read off it — which
 * is what makes a per-extra map elsewhere a compile error when this changes.
 */
export const RESET_ROLE = {
  fetch: "import",
  /* Never in a reset's list — a reset is refused on a minimal article, and a
     full one's revision only carries this run row from the day it was minimal. */
  metadata: "import",
  extract: "import",
  blocks: "import",
  structure: "import",
  labels: "successor",
  assets: "import",
  arc: "extra",
  tweets: "extra",
  glossary: "extra",
  quotes: "extra",
  /* Made on demand when a reader opens the mode, off DEFAULT_INGEST_STEPS, a
     whole column beside `quotes` — and it reads the Quotes, which sort before
     it in STEP_ORDER, so a regenerate queues it after them.
     docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md. */
  skim: "extra",
  ideas: "extra",
  timeline: "extra",
  quiz: "extra",
  faq: "extra",
  /* Queued after import with the main modes, or made on demand by the owner's
     press that turns Marginalia on when none was stored. Off
     DEFAULT_INGEST_STEPS, a whole column: the modes' shape, though it is not a
     mode of its own. */
  relations: "extra",
  sketch: "extra",
  illustrated: "extra",
  debate: "extra",
  /* Made by a press on Peer review's Claims, off DEFAULT_INGEST_STEPS, a whole
     column: the modes' shape, though it is a sub-mode's list rather than a
     mode of its own. */
  "debate-claims": "extra",
  citations: "extra",
  /* Made after import by the add page's box or a press on Metadata, off
     DEFAULT_INGEST_STEPS, a whole column: exactly the modes' shape, though it
     is not a mode. */
  crossrefs: "extra",
  /* Made from Summary's plain-words controls, off DEFAULT_INGEST_STEPS, a whole
     column: the modes' shape. */
  simple: "extra",
} as const satisfies Record<StepName, ResetRole>;

/** The steps a reset drops — a type, so a map over them is exhaustive. */
export type ExtraStep = {
  [S in StepName]: (typeof RESET_ROLE)[S] extends "extra" ? S : never;
}[StepName];

/** Whether a step is one a reset drops. */
export function isExtra(step: StepName): step is ExtraStep {
  return RESET_ROLE[step] === "extra";
}

/** The extra steps, in `STEP_ORDER` order — the order they are queued again in. */
export function extraSteps(): ExtraStep[] {
  return STEP_ORDER.filter(isExtra);
}
