/**
 * **The registrations the `labels` step needed, and the one rule that has to
 * hold for every step written after it.**
 *
 * Stage 2 of docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md took
 * the label pass out of `hierarchy` and made it a step. Most of what that
 * requires is compiler-enforced — `StepName`, `STEP_ORDER`, `STEPS`,
 * `STEP_BUDGET_MS`, `STORAGE`, `STEP_STORAGE`, `STAMP_SOURCE`, `STAGE_ICONS` are
 * all total records, and `npm run typecheck` names the one you forgot. Three
 * things are not, and each of them fails silently:
 *
 * - **`DEFAULT_INGEST_STEPS` must NOT hold it.** That is the whole change: a
 *   reader pasting a URL no longer waits on the 79.5–92% of stage 4 the label
 *   pass was. Nothing anywhere checks a negative, so it is checked here.
 * - **`FORCE_ONLY_WHEN_NAMED` must NOT hold it either** — the opposite call from
 *   `arc`'s. Re-running `hierarchy` re-cuts the tree, and a label written to
 *   tell a paragraph apart from *the wrong set of neighbours* is exactly what
 *   this stage exists to prevent, so the positional cascade sweeping the labels
 *   in is correct rather than wasteful.
 * - **Every step that produces `tree` must also produce `labels`.**
 *
 * ## That third one is the case worth having
 *
 * `writeArtefacts` (src/store/artifacts-pg.ts) **throws** on a `tree` written
 * with no manifest beside it — the runtime half, pinned by
 * tests/labels-receipt-invalidation.test.ts. This is the same rule asked of the
 * registry, so a step declaring `produces: ["tree"]` is caught the moment
 * somebody writes it rather than the first time it runs. The writer we already
 * know is coming is the deepening wave
 * (docs/plans/260904d-deepen-fat-sections.md), which re-cuts the tree *without*
 * running `hierarchy`.
 *
 * ## Which instrument
 *
 * `npm test`. Every assertion here is over constants — no database, no model,
 * no clock. Red-first evidence for each is in the report for stage 2a; the
 * `produces` case was watched red by adding a `{ produces: ["tree"] }` step, and
 * the two set cases by adding `"labels"` to the set under test.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_INGEST_STEPS,
  FORCE_ONLY_WHEN_NAMED,
  STEPS,
  STEP_ORDER,
} from "../src/pipeline.js";
import { STAMP_SOURCE } from "../src/store/artifacts.js";
import { STORAGE } from "../src/store/artifacts-pg.js";
import type { StepName } from "../src/types.js";

describe("every writer of the tree", () => {
  /**
   * Read off the registry rather than written out, so a step added tomorrow is
   * inside the claim without anybody remembering this file.
   */
  const writesTree = STEP_ORDER.filter((name) => STEPS[name].produces.includes("tree"));

  it("is a set this test can actually see", () => {
    /* The premise. If `produces` ever stopped naming `tree`, the case below
       would pass over an empty list and prove nothing —
       docs/reusable/silent-success.md. */
    expect(writesTree).toEqual(["hierarchy", "labels"]);
  });

  it("also writes a labels manifest, because re-cutting the tree invalidates them", () => {
    for (const name of writesTree) {
      expect(
        STEPS[name].produces,
        `${name} produces "tree" without "labels": a re-cut tree can invalidate every navigation ` +
          `label written against it, so this step has to say what it did to them — the manifest it ` +
          `is keeping, or a PendingLabelsFile saying they must be bought again. writeArtefacts ` +
          `(src/store/artifacts-pg.ts) refuses the write; this is the same rule, one step earlier.`,
      ).toContain("labels");
    }
  });

  it("has somewhere to put both, under its own name", () => {
    /* `STORAGE` is a total record over `StepName`, so the compiler asks for a
       row — it does not ask that the row holds the kinds the step declares. */
    for (const name of writesTree) {
      expect(STORAGE[name].tree).toEqual({ at: "column", column: "tree" });
      expect(STORAGE[name].labels).toEqual({ at: "column", column: "labels" });
    }
  });
});

describe("the labels step's two negative registrations", () => {
  it("stays out of DEFAULT_INGEST_STEPS, which is the whole point of the split", () => {
    expect(DEFAULT_INGEST_STEPS).not.toContain("labels");
    /* And the premise: it is a real step in the order, so this is a deliberate
       omission rather than a name that does not exist. */
    expect(STEP_ORDER).toContain("labels");
  });

  it("stays out of FORCE_ONLY_WHEN_NAMED, so forcing hierarchy sweeps it in", () => {
    expect(FORCE_ONLY_WHEN_NAMED.has("labels")).toBe(false);
    /* The premise, and the contrast that makes the decision legible: `arc` sits
       in the same position and made the opposite call, because nothing reads
       what the arc writes. Re-cutting the tree really does falsify the labels. */
    expect(FORCE_ONLY_WHEN_NAMED.has("arc")).toBe(true);
  });
});

describe("the labels step's stamp", () => {
  it("is read off the labels manifest, the same artefact hierarchy's is", () => {
    /* Two steps over one artefact, which looks like the clash `assertStampAgrees`
       refuses and is not: `hasArtefacts` asks the asking step's own run row
       before it looks at any artefact. tests/shared-site-run-row-gate.test.ts
       pins that on the `blocks`/`hierarchy` pair. */
    expect(STAMP_SOURCE.labels).toBe("labels");
    expect(STAMP_SOURCE.hierarchy).toBe("labels");
  });

  it("exists at all, unlike hierarchy's", () => {
    /* `hierarchy` deliberately has none — src/pipeline.ts says why at length.
       This step does, and it is what catches a prompt or a model bump with no
       `hierarchy` run behind it. */
    expect(typeof STEPS.labels.stamp).toBe("function");
    expect(STEPS.hierarchy.stamp).toBeUndefined();
    /* And no `isDone`: it would be a second check of what the receipt already
       carries. */
    expect(STEPS.labels.isDone).toBeUndefined();
  });
});

describe("hierarchy after the split", () => {
  it("still writes the manifest, so the store's refusal never fires on it", () => {
    const produces: readonly string[] = STEPS.hierarchy.produces;
    expect(produces).toContain("tree");
    expect(produces).toContain("labels");
  });

  it("runs immediately before labels in STEP_ORDER", () => {
    const at = (name: StepName) => STEP_ORDER.indexOf(name);
    expect(at("labels")).toBe(at("hierarchy") + 1);
    /* Before `assets`, which is where the readable-article steps end. */
    expect(at("labels")).toBeLessThan(at("assets"));
  });
});
