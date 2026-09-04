/**
 * The incumbent arm is production, or the whole harness measures a stranger.
 *
 * tests/hierarchy-structure-request-parity.test.ts already pins the bytes
 * `generateHierarchy` sends, and `evals/hierarchy-structure/model-arms.ts`
 * builds its request through the shared `structureRequest`, so the *executor*
 * could not drift. `arms.ts` drifted anyway, by a route neither guard watched:
 * it declared the arm's `effort` as its own literal, and that literal said
 * `"high"` from the max_tokens postmortem (which moved production to
 * `"medium"`) until 2026-09-03.
 *
 * The damage is not that one arm was mislabelled. `smart-low` is declared
 * `isolated` — one variable, effort — and an isolated arm's whole value is that
 * the gap is attributable. Against a `"high"` incumbent it answered
 * high-vs-low, which is a question production does not have, while reporting
 * itself as the answer to the one it does.
 *
 * `INCUMBENT` now imports `PRODUCTION_EFFORT`, so that drift is unrepresentable
 * rather than merely commented. This file is the pin *behind* the import: it
 * fails if somebody types a literal back in, and it fails if production moves
 * without a deliberate decision to move the baseline with it — which is the
 * moment to start a new series rather than extend the old one.
 *
 * SEEN RED before being trusted: `INCUMBENT` set back to `effort: "high"` fires
 * the first assertion below. Perturbation reverted.
 */

import { describe, expect, it } from "vitest";
import { armByName } from "../evals/hierarchy-structure/arms.js";
import { PRODUCTION_EFFORT } from "../src/hierarchy.js";
import { CAPABLE_MODEL_OPENROUTER } from "../src/models.js";

describe("the hierarchy-structure eval's incumbent", () => {
  it("thinks as hard as production does", () => {
    const arm = armByName("incumbent");
    if (arm.kind !== "one-call") throw new Error("the incumbent arm is a one-call arm");
    /* Against the literal, not against PRODUCTION_EFFORT: an expectation read
       from the thing it checks agrees with every value of it. This is the same
       argument the request-parity pin makes about EFFORT, and the reason that
       file spells the value out too. When production genuinely moves, both
       literals change in the same commit, on purpose — which is what happened
       on 2026-09-04, `medium` to `low`. */
    expect(arm.call.effort).toBe("low");
    expect(PRODUCTION_EFFORT).toBe("low");
    expect(arm.call.model).toBe(CAPABLE_MODEL_OPENROUTER);
  });

  it("is the arm the noise floor and the isolated arms are measured against", () => {
    const incumbent = armByName("incumbent");
    const repeat = armByName("incumbent-repeat");
    /* `smart-medium` until 2026-09-04 was `smart-low`, and the rename is the
       flip: production moved to `low`, so the arm that isolates effort had to
       move to `medium` or become a second copy of the incumbent under a
       different name. The assertion below is what forced the question — it went
       red on the flip, which is it working. */
    const other = armByName("smart-medium");
    if (incumbent.kind !== "one-call" || repeat.kind !== "one-call" || other.kind !== "one-call") {
      throw new Error("all three are one-call arms");
    }

    /* The noise floor is the incumbent's own stochasticity, so it must differ
       in nothing at all — the day it differs in one field it is measuring two
       things and calling the sum noise. */
    expect(repeat.call).toEqual(incumbent.call);
    expect(repeat.seed).toBe(incumbent.seed);

    /* The isolated-effort arm claims `isolated`, and that claim is only true if
       effort is the ONE thing it moves. This is the assertion that was false for
       eight days: same model, same seed, effort the single delta. */
    expect(other.comparison).toBe("isolated");
    expect(other.call.model).toBe(incumbent.call.model);
    expect(other.seed).toBe(incumbent.seed);
    expect(other.call.effort).not.toBe(incumbent.call.effort);
  });
});
