/**
 * **Which steps the Metadata page offers a "Generate it again" button for.**
 *
 * An explicit list of nine, and the explicitness is the design rather than a
 * shortcut: a control that spends our money on a press needs three answers the
 * pipeline's own sets do not give — how many metered calls one press buys,
 * whether the step has a prerequisite it will refuse without, and whether a
 * "successful" run is safe to publish **over** a good artefact. Deriving it
 * from `FORCE_ONLY_WHEN_NAMED` (src/pipeline.ts) would sweep every future
 * member in on those three unexamined, which is exactly what the first draft of
 * docs/plans/260907d-re-run-any-generated-mode-from-the-metadata-page.md did and
 * what a cross-family review refused it for.
 *
 * What the plan settled, so it is not re-litigated a row at a time:
 *
 *  - **`hierarchy` is out.** A forced run writes an empty pending-label manifest
 *    (src/hierarchy.ts § the merge), which deletes the carried `labels` receipt,
 *    so the press strips every paragraph label the reader had and the article
 *    goes back to saying *"Paragraph labels are still arriving"*.
 *
 *    **The door back exists** — since stage 2b of
 *    docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md, a
 *    publication whose revision says `pending` queues a free `labels` successor
 *    in the same transaction, and the browser drives it. This comment said the
 *    opposite until 2026-09-07, and it was true when it was written: 2b landed
 *    in a worktree after it. **The reason survives the correction, and it is the
 *    first of the three questions above.** The successor is free of *quota* and
 *    is not free: it is the slowest and dearest pass in the pipeline — 682 s
 *    measured — so a press here would buy one silently, on top of the
 *    `hierarchy` call it names, and the labels would be gone for the eleven
 *    minutes in between. A control whose whole design is *how many metered
 *    calls does one press buy* may not have a second one hiding behind it.
 *  - **`illustrated` is out.** It refuses without a usable Sketch and does not
 *    pull the prerequisite in, and a run whose every plate failed returns
 *    *successfully* — so it can replace a good picture with an empty one.
 *  - **`labels` is out.** It is not a mode a reader goes to, and with
 *    `hierarchy` out there is nothing on that page that invalidates it.
 *  - **`blocks` is out** because a lone button could only fail:
 *    `unrunnableStepPlan` (src/jobs.ts) refuses `{ steps: ["blocks"] }` with a
 *    400.
 *  - **`fetch` and `extract` are out** because that door already exists — the
 *    shelf row's *Refresh from source* — and it replaces the article's **text**,
 *    which is a different action from regenerating a mode on top of it.
 *  - **`assets` is out**: no model call, and nobody has wanted it again.
 *
 * ## Why this is a leaf of its own
 *
 * `tests/client-imports.test.ts` forbids anything under `src/web/` reaching a
 * server module, and `src/pipeline.ts` is one. `src/step-order.ts` exists
 * because exactly this was tried for `STEP_ORDER` and reverted inside a day —
 * read its header. So the list has to live in a module that imports almost
 * nothing whatever else is decided, and this is that module: one type import,
 * no side effects.
 *
 * **Beside `src/step-order.ts` rather than inside it**, because that file
 * answers *what order do the steps run in* and this one answers *which of them
 * may a reader ask for again*. The second is a product judgement that changes
 * when a step's failure semantics change, and the first is the pipeline's own
 * shape; braiding them would mean a UI decision landing in the module
 * `orderSteps` and `isStepName` are read off.
 */
import type { StepName } from "./types.js";

/**
 * The nine, in `STEP_ORDER`'s order so the page's rows read down the pipeline.
 *
 * `satisfies` rather than a `StepName[]` annotation, so the members stay
 * literal and `MetadataRerunStep` below is the nine rather than the sixteen —
 * which is what makes a per-step copy or label map a compile error when
 * somebody adds a tenth.
 */
export const METADATA_RERUN_STEPS = [
  "arc",
  "tweets",
  "glossary",
  "quotes",
  "ideas",
  "timeline",
  "quiz",
  "sketch",
  "debate",
] as const satisfies readonly StepName[];

/** One of the nine. */
export type MetadataRerunStep = (typeof METADATA_RERUN_STEPS)[number];
