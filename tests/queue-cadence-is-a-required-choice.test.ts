/**
 * **Nobody buys the idle poll by forgetting to decline it.**
 *
 * `useJobs` and `useStepJob` take a `QueueCadence` with no default, so a caller
 * that has not said whether it watches the queue does not compile. It defaulted
 * to watching until 2026-09-12, and `useArc` held an eight-second poll open on
 * every owned article because nobody declined it —
 * docs/postmortems/260912a-a-budget-a-comment-keeps-is-spent-by-the-next-call-site.md.
 *
 * The checks here are `npm run typecheck`'s, not vitest's: vitest does not
 * type-check, and the `@ts-expect-error` lines are what fail if the argument
 * ever becomes optional again ("Unused '@ts-expect-error' directive"). The
 * `it` is there so the file is a suite, and to state the rule.
 *
 * Type-only on purpose: nothing is mounted, so this pulls in neither React nor
 * the job engine.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { QueueCadence, useJobs } from "../src/web/useJobs.js";
import type { useStepJob } from "../src/web/useStepJob.js";

declare const jobs: typeof useJobs;
declare const stepJob: typeof useStepJob;

/** Never called: it exists to be compiled. */
function callsTheCompilerMustRefuse(): void {
  // @ts-expect-error — no cadence: the choice cannot be left off.
  jobs();
  // @ts-expect-error — a completion callback is not a cadence.
  jobs(() => undefined);
  // @ts-expect-error — no cadence on a step job either.
  stepJob("an-article", "sketch", () => undefined);
  // @ts-expect-error — the old option bag is gone, not quietly accepted.
  stepJob("an-article", "sketch", () => undefined, { idle: false });

  jobs("watches-queue");
  jobs("quiet", () => undefined);
  stepJob("an-article", "sketch", () => undefined, "watches-queue");
  stepJob("an-article", "arc", () => undefined, "quiet");
}

describe("QueueCadence", () => {
  it("is required, first on useJobs and last on useStepJob", () => {
    expectTypeOf(callsTheCompilerMustRefuse).toBeFunction();
    expectTypeOf<Parameters<typeof useJobs>[0]>().toEqualTypeOf<QueueCadence>();
    expectTypeOf<Parameters<typeof useStepJob>[3]>().toEqualTypeOf<QueueCadence>();
    const both: QueueCadence[] = ["watches-queue", "quiet"];
    expect(both).toHaveLength(2);
  });
});
