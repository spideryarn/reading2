/**
 * **How a feedback report ended**, as its note in docs/user-feedback/ says —
 * the three endings of docs/project/feedback-reports.md § Three ways a report
 * ends, lower-case. scripts/feedback-endings.ts compiles the notes' headers
 * into src/feedback-endings.generated.ts; the server reads that, and only the
 * server: the map names every reader's reports.
 * docs/plans/260930e-earlier-tab-filters-by-done-from-the-notes.md.
 */
import { FEEDBACK_NOTE_ENDINGS } from "./feedback-endings.generated.js";
export { FEEDBACK_ENDINGS, type FeedbackEnding } from "./feedback-ending-values.js";

/**
 * **Has a change for this report shipped, in the build that is answering?**
 * True when its note says shipped and the note is in this build — on
 * production, once the work has been deployed, since a note never lands
 * before the work it records. A report with no note is not shipped: the
 * label is never claimed without a note saying so.
 *
 * Keyed by bare report id, which is unique per owner rather than globally
 * (`(owner_id, id)` is the key). A coincidence would mark a stranger's own
 * report shipped, to them only; the plan's § Known limits weighs it.
 */
export function isFeedbackShipped(reportId: string): boolean {
  return Object.hasOwn(FEEDBACK_NOTE_ENDINGS, reportId)
    ? FEEDBACK_NOTE_ENDINGS[reportId] === "shipped"
    : false;
}

/** Every report id this build knows to have shipped — what the Earlier filter narrows by. */
export function shippedFeedbackIds(): string[] {
  return Object.keys(FEEDBACK_NOTE_ENDINGS).filter(isFeedbackShipped);
}
