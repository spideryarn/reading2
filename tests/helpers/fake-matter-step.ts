/**
 * **The real `matter` step with the network taken out**, for a test that drives
 * the `matter` successor a publication queues (src/store/pg-revisions.ts §
 * `publishRevisionIn`; plan 261018a).
 *
 * The call "fails", so what is stored is the labels rule's stretches alone with
 * `modelUnavailable` set — the step's own fail-soft path (src/matter-step.ts §
 * `buildMatter`), and a value `matterSettled` accepts, so its publication does
 * not queue another. Everything else (`stamp`, `produces`, the label) is the
 * real step's. Without this, a test that drives the successor through `STEPS`
 * makes a real, paid OpenRouter call.
 */
import { buildMatter } from "../../src/matter-step.js";
import { STEPS, type PipelineStep } from "../../src/pipeline.js";

export function fakeMatterStep(onRun: () => void = () => {}): PipelineStep<"matter"> {
  return {
    ...STEPS.matter,
    async run(ctx, store) {
      onRun();
      const file = await store.read(ctx.slug, "blocks", "blocks");
      const meta = await store.read(ctx.slug, "extract", "meta");
      const { matter } = await buildMatter(
        { blocks: file?.blocks ?? [], meta: meta ?? null },
        {
          gateway: async () => {
            throw new Error("the fixture has no model for matter");
          },
        },
      );
      return { parts: { matter }, detail: "labels only" };
    },
  };
}
