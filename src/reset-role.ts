/**
 * **What a reset does to each step** — the classification alone, as a leaf
 * the browser may import.
 *
 * A reset puts an article back "as if it had just been imported for the first
 * time" (Greg, 2026-09-28): the import steps run again over the stored copy,
 * and everything a *mode* made and stored on the revision is dropped from the
 * new draft. docs/plans/260928a-reset-and-regenerate-article.md is the design;
 * this file is the one place that says which step is which.
 *
 * ## Three roles
 *
 * - **`import`** — `DEFAULT_INGEST_STEPS`. The reset job runs these, with
 *   `extract` forced and `cascadeForce` sweeping the rest in behind it.
 * - **`successor`** — `labels`. Not dropped by hand: a forced `hierarchy`
 *   writes a pending manifest and the reset's publication buys the free labels
 *   job exactly as any import's does.
 * - **`extra`** — everything a mode makes on demand. Dropped from the reset's
 *   draft, columns and step-run rows both; queued again after publication when
 *   the reader asked.
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
 * the browser keeps only what a reader calls each extra
 * (`RESET_EXTRA_NAME` in src/web/ResetArticle.tsx, keyed by `ExtraStep`).
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
  extract: "import",
  blocks: "import",
  hierarchy: "import",
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
  trajectory: "extra",
  ideas: "extra",
  timeline: "extra",
  quiz: "extra",
  faq: "extra",
  sketch: "extra",
  illustrated: "extra",
  debate: "extra",
  citations: "extra",
  /* Made after import by the add page's box or a press on Metadata, off
     DEFAULT_INGEST_STEPS, a whole column: exactly the modes' shape, though it
     is not a mode. */
  crossrefs: "extra",
  /* Made on a press of Summary's Simple chip, off DEFAULT_INGEST_STEPS, a whole
     column: the modes' shape. */
  simple: "extra",
  /* The owner's "for you" marks on the glossary, a whole column: dropped by a
     reset like the glossary it annotates. **Made again only when the reset
     carries a profile** — `PROFILE_ONLY_EXTRAS` below — because with none
     there is nothing to mark for. Plan 261001m. */
  glossaryForYou: "extra",
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

/**
 * **Extras that are nothing without the reader's profile** — a personal layer
 * on a shared artefact (plan 261001m). A reset drops them like any extra, and
 * makes them again only when it carries a profile: queued without one, the
 * step could only refuse, and a regeneration the reader did not ask to fail
 * would be a red job card for nothing.
 */
export const PROFILE_ONLY_EXTRAS = ["glossaryForYou"] as const satisfies readonly ExtraStep[];

const PROFILE_ONLY: ReadonlySet<StepName> = new Set(PROFILE_ONLY_EXTRAS);

/** Which of the extras an article has a reset makes again — all of them, less the profile-only ones when there is no profile. */
export function extrasToRegenerate(present: readonly ExtraStep[], hasProfile: boolean): ExtraStep[] {
  return hasProfile ? [...present] : present.filter((step) => !PROFILE_ONLY.has(step));
}
