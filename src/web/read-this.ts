/**
 * ***Read this*** — the full import of a paper that was added with only its
 * title, authors and abstract read (plan
 * docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md).
 *
 * `POST /api/jobs { slug, process: true }`, through the job engine's action
 * seam so the job is found and driven at once, wherever the reader goes next.
 * Pressed from the shelf card and from the paper's own page; one function, so
 * the two cannot disagree about what pressing it does.
 *
 * **And the add page's tick box after it.** A single upload queues the main
 * modes once its import is done when *Generate the main modes* is ticked
 * (auto-modes.ts, read from the same stored choice). *Read this* is the same
 * import, so it keeps the same promise — but the shelf card may unmount long
 * before the job ends, so the wait is the engine's (`watchTerminal`), not a
 * component's. Session-fenced: a sign-out drops the watcher uncalled.
 */
import type { Job, StepName } from "../types.js";
import { queueAutoModes, readAutoModes } from "./auto-modes.js";
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

/**
 * A mode job, posted the way `useJobs`'s `run` posts one — through the action
 * seam, fenced to the session — but with no component behind it.
 */
async function runStep(
  request: { slug: string; steps: StepName[] },
  /** The *Read this* session. Later auto-mode groups must not cross a sign-out. */
  epoch: number,
): Promise<Job | null> {
  if (jobEngine.epoch() !== epoch) return null;
  try {
    const job = await post<Job>(request);
    if (jobEngine.epoch() !== epoch) return null;
    jobEngine.actionSucceeded(epoch);
    return job;
  } catch (err) {
    jobEngine.actionFailed(
      describeFetchFailure(err instanceof Error ? err : new Error(String(err))),
      statusOf(err),
      epoch,
    );
    return null;
  }
}

/** Press *Read this* on `slug`. */
export async function readThis(slug: string): Promise<ReadThisOutcome> {
  const epoch = jobEngine.epoch();
  const generate = readAutoModes();
  try {
    const job = await post<Job>({ slug, process: true });
    /* A POST may outlive the reader who made it. Do not register one reader's
       job in the next reader's watcher map, even though the callback below is
       fenced as a second line of defence. */
    if (generate && jobEngine.epoch() === epoch) {
      /* Watched before the poke, so the list the poke asks for may say the job
         has gone (jobEngine.ts § watchTerminal). */
      jobEngine.watchTerminal(job.id, (ended) => {
        if (ended.kind !== "done" || jobEngine.epoch() !== epoch) return;
        void queueAutoModes((request) => runStep(request, epoch), slug);
      });
    }
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
