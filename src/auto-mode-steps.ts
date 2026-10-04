/**
 * **The jobs an import's first full publication queues**: one per main mode,
 * and the cross-references. A shared leaf — the server reads it when it
 * publishes (src/store/pg-revisions.ts § `publishRevisionIn`), the add page
 * reads it to say what the tick box does (src/web/auto-modes.ts).
 * docs/plans/261004h-post-import-modes-decided-on-the-server-for-every-import-path.md.
 *
 * ## Written out, not derived
 *
 * The list is "every mode outside the experimental switch that makes
 * something, by the step it makes". That derivation reads `modeStep` in
 * src/web/activation.ts, which imports the browser's job engine, so the server
 * cannot run it. The steps are therefore named here, and
 * tests/auto-modes.test.tsx holds this list equal to the derived one
 * (`derivedAutoModeSteps`, src/web/auto-modes.ts): a mode moved in or out of
 * the switch fails that test until this line is changed too.
 *
 * This module imports src/step-order.ts and types, nothing else, so both sides
 * can import it (tests/client-imports.test.ts).
 */
import { STEP_ORDER } from "./step-order.js";
import type { StepName } from "./types.js";

/**
 * The steps queued, in `STEP_ORDER`.
 *
 * `tweets` and `simple` are Summary's two artefacts (its thread and its
 * plain-words levels); `glossary`, `quotes`, `ideas` and `skim` are their own
 * modes'; `crossrefs` belongs to no mode — the links from a phrase in one
 * passage to the passage that backs it sit in the prose in every mode
 * (docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md § 3).
 */
export const AUTO_MODE_STEPS: readonly StepName[] = [
  "tweets",
  "glossary",
  "quotes",
  "ideas",
  "simple",
  "skim",
  "crossrefs",
];

/**
 * **Which steps read another step's artefact** — a copy of the `reads` in
 * `STEP_SHARING` (src/sharing-steps.ts), which is the rule the server's queue
 * acts on. A copy because that module takes a type from src/store/, and the
 * browser may not reach it even for a type (tests/client-imports.test.ts);
 * tests/auto-modes.test.tsx holds the two equal, so a new dependency there
 * fails here rather than going unnoticed.
 */
export const STEP_READS: Partial<Record<StepName, readonly StepName[]>> = {
  illustrated: ["sketch"],
  skim: ["quotes", "ideas"],
};

/**
 * **What each job asks for**: the step, with the steps it reads in front of it
 * (`STEP_READS` above), in `STEP_ORDER`.
 *
 * So Skim's job is `["quotes", "ideas", "skim"]` — the same steps the Skim
 * panel posts when it has neither (`precededBy`, src/web/useSkim.ts). If one
 * of those reads has become ready by the time the panel opens, the panel posts
 * a narrower, differently keyed job; the article's line keeps it behind this
 * one and its Skim step then skips as current, so it is a redundant row rather
 * than a second paid run.
 *
 * Carrying its reads is what makes this job correct whatever its place in the
 * line: normally the Quotes and Ideas jobs are ahead of it, it waits for them
 * (it writes what they write), and its first two steps skip as current. If the
 * Quotes job failed, this job tries Quotes once more itself.
 */
export function autoModeRequests(): StepName[][] {
  return AUTO_MODE_STEPS.map((step) => {
    const reads = STEP_READS[step] ?? [];
    return STEP_ORDER.filter((s) => s === step || reads.includes(s));
  });
}

/**
 * **The order the jobs are queued in**: the ones that read nothing
 * (`together`), then the rest (`after`). Not `autoModeRequests()`'s order:
 * `crossrefs` sorts last in `STEP_ORDER` but reads nothing, so it goes before
 * Skim. The publication stamps them one microsecond apart in this order.
 */
export function autoModePosts(): { together: StepName[][]; after: StepName[][] } {
  const requests = autoModeRequests();
  return {
    together: requests.filter((steps) => steps.length === 1),
    after: requests.filter((steps) => steps.length > 1),
  };
}
