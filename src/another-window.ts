/**
 * **A step that has run out of time, with work banked, asks the queue for
 * another lease window instead of finishing short.**
 *
 * The queue already hands a job back when its own deadline cancels a step
 * (src/jobs.ts § "We ran out of our own time inside a step"). That covers a
 * step the queue had to stop. This is for a step that stops *itself* ahead of
 * that deadline and would otherwise return a lesser product: the structure
 * step's slices (src/structure.ts § `generateStructure`), which keep their
 * answers in checkpoints, so a second window starts from them.
 *
 * In a file of its own because both ends import it: `src/structure.ts` throws
 * it and `src/jobs.ts` catches it, and `jobs.ts` imports `pipeline.ts`, which
 * imports `structure.ts`. `npm run cycles` is a gate.
 * docs/plans/261005j-long-document-structure-arrives-top-level-first-then-sections-then-summaries.md
 * § "Plan: the rest of stage 1a", stage C.
 */

/**
 * Which lease window of its job a step is running in, and whether the queue
 * would grant one more. Built by `runStep` (src/jobs.ts) from `Job.requeues`
 * against `REQUEUE_BUDGET`; absent wherever there is no queue (a command line,
 * a test), which reads as "no further window".
 */
export interface LeaseWindow {
  /** 1 for the window the job was first claimed under. */
  number: number;
  /**
   * True while the job has requeues left. Read when the step starts. The store
   * decides again when the hand-back is asked for (`pauseForDeadline`), and
   * its answer is the one that counts.
   */
  anotherAvailable: boolean;
}

/**
 * Thrown by a step to hand its job back for another window. Not a failure:
 * `runStep` reports it as its own outcome and the walk puts the job down
 * exactly as it does at its own deadline. A step may throw it only when
 * `LeaseWindow.anotherAvailable` was true, and only once every call it started
 * has settled, so the step's spend is complete when it is recorded.
 */
export class NeedsAnotherWindow extends Error {
  constructor() {
    super("The step ran out of time and asked for another window.");
    this.name = "NeedsAnotherWindow";
  }
}
