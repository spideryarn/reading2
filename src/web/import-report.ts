/**
 * **What "Report this" on a failed import puts in the Feedback box** — the
 * words, as a pure function, so they are tested without a dialog.
 *
 * Greg, 2026-10-01 (spya-a5gzb9): past imports on the signed-in home page
 * carried too little to act on. A failed one now offers to report itself.
 * docs/plans/261001s-imports-detail-on-home-and-why-reading-saved-state-and-first-open-prompt.md
 * § Stage 1.
 *
 * **Where it came from and what it said, since 2026-10-08.** Until then this
 * carried ids, closed values and timestamps only: GPT Sol's review of 261001s
 * (item 6) showed that a pre-typed URL, filename or error sentence is not
 * "something the reader typed into this dialog" just because it sits in the
 * box (docs/project/feedback.md § The one rule). Greg chose to carry all three
 * (spya-f9c9pe, answering q-a7kffw), knowing a pasted address can hold a
 * private token: they sit in the box, the reader sees them and can delete any
 * of them before sending, and /privacy says a report from here carries them —
 * which is the rule's third clause. The article's title still stays out; it
 * was not asked for. Plan 261008i § Stage 1.
 *
 * **The job id is the way back**, and Dismiss keeps it working: since the same
 * day `DELETE /api/jobs/:id` stamps `jobs.dismissed_at` rather than deleting
 * the row (src/store/pg-jobs.ts § `forget`), so a report filed and then
 * dismissed still names a record we can read.
 */
import type { Job } from "../types.js";

/**
 * How much of the error sentence goes in. An error is open-ended and the box
 * has a limit (FeedbackDialog.tsx); a prefill that overran it would open a
 * report the reader cannot send. Two thousand is far more than any sentence
 * of ours and a tenth of the box. GPT Sol, plan 261008i, finding 7.
 */
const ERROR_CHARS = 2000;

export function importProblemReport(job: Job): string {
  /* Optional on purpose — the runner can fail with no step having failed at
     all (src/types.ts § `Job.failureKind`). Review item 8. */
  const failed = job.steps.find((step) => step.status === "error");
  const whole = failed?.error ?? job.error;
  const error =
    whole !== undefined && whole.length > ERROR_CHARS ? `${whole.slice(0, ERROR_CHARS)}…` : whole;
  const lines = [
    "This import failed.",
    "",
    `Job: ${job.id}`,
    `Article: ${job.slug}`,
    `Status: ${job.status}`,
    /* The whole address, query string and all — Greg's call, above. */
    ...(job.url ? [`Source: ${job.url}`] : []),
    /* The name the reader gave the file, never our upload id. */
    ...(job.upload ? [`File: ${job.upload.filename}`] : []),
    /* The step's `name`, a closed `StepName`, rather than its `label`, which
       is ours but changes with the copy. */
    ...(failed ? [`Failed at step: ${failed.name}`] : []),
    ...(job.failureKind ? [`Failure kind: ${job.failureKind}`] : []),
    /* The failed step's own sentence, which is the specific one; the job's
       `error` when the runner failed with no step at fault. */
    ...(error ? [`Error: ${error}`] : []),
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
