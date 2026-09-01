/**
 * **The diagnostics blob's vocabularies, checked against the things they are
 * copies of.** src/feedback-payload.ts.
 *
 * That file may not import src/pipeline.ts — it is shared with the dialog, and
 * nothing under `src/web/` may pull the pipeline behind it
 * (tests/client-imports.test.ts) — so its list of step names is a second copy of
 * `STEP_ORDER`. This file is what keeps the copy honest, the same way
 * tests/feedback-store.test.ts keeps the CHECK constraints honest: by feeding
 * the real list through and watching every value survive.
 *
 * A test file may import anything, which is the whole reason this arrangement
 * works.
 */
import { describe, expect, it } from "vitest";

import { parseFeedbackDiagnostics } from "../src/feedback-payload.js";
import { MODES } from "../src/modes.js";
import { STEP_ORDER } from "../src/pipeline.js";
import { ARTICLE_VIEWS } from "../src/read-address.js";

/** The blob's `job` field for one step name. */
function stepOf(step: string): string | null {
  return parseFeedbackDiagnostics({ job: { step } })?.job?.step ?? null;
}

describe("the diagnostics vocabularies", () => {
  it("accepts every step the pipeline actually has", () => {
    const dropped = STEP_ORDER.filter((step) => stepOf(step) === null);
    /* Named rather than counted, so a red line says which step was added to the
       pipeline and not to src/feedback-payload.ts. */
    expect(dropped).toEqual([]);
  });

  it("drops a step name that is not one", () => {
    /* The other half, and the reason the loop above is not a slow way of
       asserting nothing. */
    expect(stepOf("Four score and seven years ago")).toBeNull();
    expect(stepOf("extractx")).toBeNull();
  });

  it("accepts every mode and every article view", () => {
    for (const mode of MODES) {
      expect([mode, parseFeedbackDiagnostics({ article: { mode } })?.article?.mode]).toEqual([
        mode,
        mode,
      ]);
    }
    for (const view of ARTICLE_VIEWS) {
      expect([view, parseFeedbackDiagnostics({ article: { view } })?.article?.view]).toEqual([
        view,
        view,
      ]);
    }
  });

  it("returns null for a blob with nothing left in it", () => {
    /* Which is what keeps the database's `feedback_diagnostics_version` CHECK
       something nobody has to think about: a version standing beside an absent
       blob is a row this schema does not have. */
    expect(parseFeedbackDiagnostics({ nonsense: 1 })).toBeNull();
    expect(parseFeedbackDiagnostics({ api: [], errors: [] })).toBeNull();
    expect(parseFeedbackDiagnostics("not an object")).toBeNull();
  });
});
