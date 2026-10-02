/**
 * **What "Report this" on a failed import puts in the Feedback box** — the
 * words, as a pure function, so they are tested without a dialog.
 *
 * Greg, 2026-10-01 (spya-a5gzb9): past imports on the signed-in home page
 * carried too little to act on. A failed one now offers to report itself.
 * docs/plans/261001s-imports-detail-on-home-and-why-reading-saved-state-and-first-open-prompt.md
 * § Stage 1.
 *
 * **Ids, closed values and timestamps, and nothing else.** The plan first had
 * the source URL, the filename and the step's error sentence in here, and GPT
 * Sol's review (item 6) showed that breaks docs/project/feedback.md § The one
 * rule: a pre-typed value is not "something the reader typed into this dialog"
 * just because it sits in the box. A URL can carry a private token, a filename
 * is the reader's own words, and an error sentence is open-ended. The card
 * still shows all three; this does not carry them. Greg kept it so on
 * 2026-10-02 (Q-import-report-details, "yes").
 *
 * **The job id is the way back**, and Dismiss keeps it working: since the same
 * day `DELETE /api/jobs/:id` stamps `jobs.dismissed_at` rather than deleting
 * the row (src/store/pg-jobs.ts § `forget`), so a report filed and then
 * dismissed still names a record we can read.
 */
import type { Job } from "../types.js";

export function importProblemReport(job: Job): string {
  /* Optional on purpose — the runner can fail with no step having failed at
     all (src/types.ts § `Job.failureKind`). Review item 8. */
  const failed = job.steps.find((step) => step.status === "error");
  const lines = [
    "This import failed.",
    "",
    `Job: ${job.id}`,
    `Article: ${job.slug}`,
    `Status: ${job.status}`,
    /* The step's `name`, a closed `StepName`, and never its `label` or
       `error`: the label is ours but changes with the copy, and the error is a
       sentence. */
    ...(failed ? [`Failed at step: ${failed.name}`] : []),
    ...(job.failureKind ? [`Failure kind: ${job.failureKind}`] : []),
    /* *Added*, not *Started*: `createdAt` is when it was queued. Review item 8. */
    `Added: ${job.createdAt}`,
    ...(job.startedAt ? [`Started: ${job.startedAt}`] : []),
    ...(job.finishedAt ? [`Ended: ${job.finishedAt}`] : []),
    "",
    "What I expected:",
    "",
  ];
  return lines.join("\n");
}
