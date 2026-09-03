/**
 * **`precededBy` has to name a step that actually precedes, and until
 * 2026-09-03 it did not have to.**
 *
 * `StepRun.precededBy` (src/web/useStepJob.ts) reads as a promise — *these run
 * before mine, in the same job*. Nothing kept it. The option took any
 * `StepName`, and the server's `orderSteps` (src/jobs.ts) sorts whatever
 * arrives by `STEP_ORDER` and by nothing else, so a caller naming a **later**
 * step got it back after their own: `precededBy: ["assets"]` on `hierarchy`
 * comes out `["hierarchy", "assets"]`, a "preceding" step that runs afterwards,
 * with nothing anywhere saying so. GPT Sol found it reviewing the one-press
 * draw-then-paint chain, 2026-09-03.
 *
 * The only caller in the tree — Illustrated asking for `["sketch"]` — is safe,
 * so this was a trap for the next caller rather than a live bug. Closed by
 * making the name true rather than by dropping it: `StepBefore<S>`
 * (src/pipeline.ts) is `STEP_ORDER` read as a type, so the wrong name is a
 * compile error at the call site.
 *
 * ## Which instrument reddens this
 *
 * **`npm run typecheck`, not `npm test`.** The three `@ts-expect-error`s below
 * are the assertions; vitest strips them without looking. `tests/tsconfig.json`
 * is what checks this file, and an `@ts-expect-error` over a line that has
 * stopped being an error is itself an error (TS2578) — so loosening
 * `precededBy` back to `readonly StepName[]` turns all three of them red.
 * Watched, by doing exactly that:
 *
 *     ✗ tests/tsconfig.json  (1139 files, 5 errors)
 *       tests/step-job-preceded-by.test.ts(76,5): error TS2578: Unused '@ts-expect-error' directive.
 *       tests/step-job-preceded-by.test.ts(80,5): error TS2578: Unused '@ts-expect-error' directive.
 *       tests/step-job-preceded-by.test.ts(95,5): error TS2578: Unused '@ts-expect-error' directive.
 *
 * The runtime half is not decoration either: `expect` on each object proves the
 * literals are real values rather than types that happen to compile, and the
 * `orderSteps` case is the server behaviour the whole finding rests on —
 * a red there would mean the ordering had moved under the type.
 *
 * docs/reusable/silent-success.md is the family: an option whose name asserts
 * something the system never checks.
 */
import { describe, expect, it } from "vitest";
import { orderSteps } from "../src/jobs.js";
import type { StepName } from "../src/types.js";
/* Type-only, deliberately: nothing here mounts anything, so this file pulls in
   neither React nor the job engine. `StepJob` carries the whole contract under
   test in its `start` signature. */
import type { StepJob } from "../src/web/useStepJob.js";

/** What `StepJob<S>.start` will accept, which is where `precededBy` lives. */
type Run<S extends StepName> = NonNullable<Parameters<StepJob<S>["start"]>[0]>;

describe("precededBy", () => {
  /**
   * The premise, asked of the server's own function rather than believed.
   *
   * `orderSteps` is what `enqueue` runs over the posted names, so this is the
   * reason the type has to exist: the browser cannot buy an ordering by putting
   * a name first in the array.
   */
  it("orders by STEP_ORDER, not by where the caller put the name", () => {
    expect(orderSteps(["illustrated", "sketch"])).toEqual(["sketch", "illustrated"]);
    /* The reproduction, exactly: `assets` asked for as a *preceding* step of
       `hierarchy` and handed back after it. */
    expect(orderSteps(["hierarchy", "assets"])).toEqual(["hierarchy", "assets"]);
  });

  it("takes a step STEP_ORDER genuinely runs first", () => {
    const real: Run<"illustrated"> = { precededBy: ["sketch"] };
    expect(real.precededBy).toEqual(["sketch"]);
    /* Not only the one real caller: everything earlier is legal, and a check
       that admitted `sketch` alone would be pinning the caller, not the rule. */
    const earlier: Run<"illustrated"> = { precededBy: ["blocks", "quiz"] };
    expect(earlier.precededBy).toEqual(["blocks", "quiz"]);
  });

  it("refuses a step STEP_ORDER runs at or after the caller's own", () => {
    // @ts-expect-error `assets` comes AFTER `hierarchy`, so `orderSteps` would hand it back second and it would precede nothing.
    const after: Run<"hierarchy"> = { precededBy: ["assets"] };
    expect(after.precededBy).toEqual(["assets"]);

    // @ts-expect-error a step does not precede itself, and naming it here would only duplicate what `start` already sends.
    const itself: Run<"illustrated"> = { precededBy: ["illustrated"] };
    expect(itself.precededBy).toEqual(["illustrated"]);
  });

  /**
   * `fetch` is first, so `StepBefore<"fetch">` is `never` and the only list it
   * takes is the empty one. Here because a recursive conditional type that
   * quietly answered `StepName` at the end of the array would pass every case
   * above and fail only this one.
   */
  it("leaves the first step in the pipeline with nothing to be preceded by", () => {
    const none: Run<"fetch"> = { precededBy: [] };
    expect(none.precededBy).toEqual([]);

    // @ts-expect-error nothing runs before `fetch`.
    const impossible: Run<"fetch"> = { precededBy: ["extract"] };
    expect(impossible.precededBy).toEqual(["extract"]);
  });
});
