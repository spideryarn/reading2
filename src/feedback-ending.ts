/**
 * **How a feedback report ended**, as its note in docs/user-feedback/ says —
 * the three endings of docs/project/feedback-reports.md § Three ways a report
 * ends, lower-case. scripts/feedback-endings.ts compiles the notes' headers
 * into src/feedback-endings.generated.ts; the server reads that, and only the
 * server: the map names every reader's reports.
 * docs/plans/260930e-earlier-tab-filters-by-done-from-the-notes.md.
 */
import { FEEDBACK_ENDINGS, type FeedbackEnding } from "./feedback-ending-values.js";
import { FEEDBACK_NOTE_COMMENTS, FEEDBACK_NOTE_ENDINGS } from "./feedback-endings.generated.js";
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

/**
 * **Every report id this build has a note for, under the ending it has** —
 * what an admin's Earlier tab derives its four statuses from
 * (src/store/pg-feedback.ts § `statusOf`). Three lists rather than the map, so
 * the store binds three arrays and learns nothing else about a note.
 * docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md.
 */
export function feedbackIdsByEnding(): Record<FeedbackEnding, string[]> {
  const by: Record<FeedbackEnding, string[]> = { shipped: [], declined: [], awaiting: [] };
  for (const id of Object.keys(FEEDBACK_NOTE_ENDINGS)) {
    const ending = FEEDBACK_NOTE_ENDINGS[id];
    if (ending !== undefined && FEEDBACK_ENDINGS.includes(ending)) by[ending].push(id);
  }
  return by;
}

/**
 * **The one line this report's note says about it**, or null: why it was set
 * aside, what the open question is, or which half is still queued. An agent
 * wrote it, for the person who filed the report. **Only the admin route sends
 * it** (`GET /api/admin/feedback/earlier`); keyed by bare id like the endings,
 * with the same known limit.
 */
export function feedbackComment(reportId: string): string | null {
  return Object.hasOwn(FEEDBACK_NOTE_COMMENTS, reportId) ? (FEEDBACK_NOTE_COMMENTS[reportId] ?? null) : null;
}
