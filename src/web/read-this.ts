/**
 * ***Read this*** — the full import of a paper that was added with only its
 * title, authors and abstract read (plan
 * docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md).
 *
 * `POST /api/jobs { slug, readThis: true }`, through the job engine's action
 * seam so the job is found and driven at once, wherever the reader goes next.
 * Pressed from the shelf card and from the paper's own page; one function, so
 * the two cannot disagree about what pressing it does.
 *
 * **It queues no modes.** *Read this* is an import, and like every import its
 * publication queues the main-mode jobs on the server when the reader's
 * setting says so (src/store/pg-revisions.ts § `publishRevisionIn`; plan
 * 261004h). Until then this file watched the job and posted them itself.
 */
import type { Job, StepName } from "../types.js";
import { jobEngine, send } from "./jobEngine.js";
import { statusOf } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

/** What pressing it answered: the job, or the server's sentence. */
export type ReadThisOutcome = { ok: true; job: Job } | { ok: false; message: string };

const post = <T>(body: unknown) =>
  send<T>("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** Press *Read this* on `slug`. */
export async function readThis(slug: string): Promise<ReadThisOutcome> {
  const epoch = jobEngine.epoch();
  try {
    const job = await post<Job>({ slug, readThis: true });
    jobEngine.actionSucceeded(epoch);
    return { ok: true, job };
  } catch (err) {
    const message = describeFetchFailure(err instanceof Error ? err : new Error(String(err)));
    jobEngine.actionFailed(message, statusOf(err), epoch);
    return { ok: false, message };
  }
}

/** The *Read this* job running on `slug` in this snapshot, if there is one. */
export function readThisJobFor(jobs: readonly Job[], slug: string): Job | undefined {
  return jobs.find(
    (j) =>
      j.slug === slug &&
      (j.status === "queued" || j.status === "running") &&
      j.steps.some((s) => s.name === "extract"),
  );
}

/** What the button says it costs. billing.md § A minimal paper costs a hundredth. */
export const READ_THIS_COST = "Uses 0.99 of an article from your allowance.";

/**
 * The browser's copy of `MINIMAL_STEPS` in src/minimal-paper.ts. A contract
 * test compares the arrays, so either side changing alone goes red.
 */
export const CLIENT_MINIMAL_STEPS: readonly StepName[] = ["fetch", "metadata"];

/** Whether a job is a minimal paper's, exactly and in order. */
export function isMinimalJob(job: Job): boolean {
  return (
    job.steps.length === CLIENT_MINIMAL_STEPS.length &&
    job.steps.every((step, at) => step.name === CLIENT_MINIMAL_STEPS[at])
  );
}
