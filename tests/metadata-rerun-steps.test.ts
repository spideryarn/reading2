/**
 * **The nine steps the Metadata page offers a *Generate it again* button for**
 * — `METADATA_RERUN_STEPS` in src/rerun-steps.ts, and the two properties that
 * make each of them safe to press.
 *
 * This file imports `src/pipeline.ts` and `src/jobs.ts`, which the browser may
 * not. That is the point: the list is pinned here, against the server's own
 * sets, so that the client can hold a plain array of strings and still be
 * checked against the machinery it will drive. A test is not client code —
 * tests/client-imports.test.ts sweeps `src/web/`, not `tests/`.
 *
 * ## The two properties, and why each is worth a test rather than a comment
 *
 *  - **A press forces exactly one step and cascades into nothing.**
 *    `cascadeForce` (src/jobs.ts) sweeps in everything downstream of the first
 *    forced name *except* members of `FORCE_ONLY_WHEN_NAMED`, so a member of
 *    ours that left that set would turn one button into a bill for every mode
 *    after it, silently and with no artefact anywhere recording that it
 *    happened.
 *  - **A press cannot produce a 400.** `unrunnableStepPlan` refuses
 *    `{ steps: ["blocks"] }` alone, and the page's own rule — stated twice for
 *    the pencil and for Archive — is that a control whose only outcome is a
 *    refusal is worse than no control, because pressing it is how you find out.
 *
 * **And the list stays explicit.** The last assertion pins the nine by name, so
 * a tenth mode step arriving in `STEP_ORDER` does not get a button by drifting
 * into one: somebody has to answer the three questions in the plan's § The list
 * of steps that get a button, and then come here and say so.
 * docs/plans/260907d-re-run-any-generated-mode-from-the-metadata-page.md.
 */
import { describe, expect, it } from "vitest";

import { unrunnableStepPlan } from "../src/jobs.js";
import { FORCE_ONLY_WHEN_NAMED } from "../src/pipeline.js";
import { METADATA_RERUN_STEPS } from "../src/rerun-steps.js";
import { STEP_ORDER } from "../src/step-order.js";
import type { StepName } from "../src/types.js";

/** The seven the plan argues out, each for a reason of its own. */
const REFUSED: StepName[] = [
  "fetch",
  "extract",
  "blocks",
  "hierarchy",
  "labels",
  "assets",
  "illustrated",
];

describe("the steps the Metadata page will re-run", () => {
  it("is exactly the nine the plan settled, in pipeline order", () => {
    expect([...METADATA_RERUN_STEPS]).toEqual([
      "arc",
      "tweets",
      "glossary",
      "quotes",
      "ideas",
      "timeline",
      "quiz",
      "sketch",
      "debate",
    ]);
  });

  it("names only steps the pipeline has", () => {
    for (const step of METADATA_RERUN_STEPS) expect(STEP_ORDER).toContain(step);
  });

  it("offers none of the seven the plan argued out", () => {
    for (const step of REFUSED) expect([...METADATA_RERUN_STEPS]).not.toContain(step);
  });

  /**
   * The property the button borrows from `FORCE_ONLY_WHEN_NAMED`, and the only
   * one it borrows: unnamed is unforced, so `{ steps: [s], force: [s] }` forces
   * that step and nothing after it.
   *
   * Membership does **not** mean one model call — `debate` makes two separately
   * metered ones, and the queue may buy any step up to `REQUEUE_BUDGET` times.
   * The plan's § Findings records that claim being made and withdrawn.
   */
  it("forces nothing beyond the step that was pressed", () => {
    for (const step of METADATA_RERUN_STEPS) {
      expect(FORCE_ONLY_WHEN_NAMED.has(step), `${step} would cascade`).toBe(true);
    }
  });

  it("names no step the queue would refuse to run on its own", () => {
    for (const step of METADATA_RERUN_STEPS) {
      expect(unrunnableStepPlan([step]), `${step} alone is unrunnable`).toBeUndefined();
    }
  });
});
