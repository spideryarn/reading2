/**
 * **Where an ingest job is written down**, as a contract with two adapters.
 *
 * A job used to live in one process's `Map` and a JSON file beside it. That is
 * exactly right for one process and there is more than one: `POST /api/jobs`
 * creates the job in whichever instance answered, and the browser's next
 * `POST /api/jobs/<id>/advance` may land somewhere else, whose Map is empty.
 * The endpoint built to let an ingest survive a frozen instance was defeated by
 * the record being *in* the frozen instance.
 *
 * ## The contract is transitions, not patches
 *
 * There is no `update(id, patch, attempt?)`, deliberately, and the reason is
 * short: **an optional fence is not a fence**. A generic patch method makes
 * carrying the attempt token the caller's habit rather than the store's rule,
 * and it cannot check `cancelling` as part of the write — so a claimant could
 * commit a step onto a job the reader had already stopped. Named transitions
 * put both conditions inside the statement.
 *
 * ## One claim covers one step, and then lets go
 *
 * `claim` → run a step → `releaseStep`, or `finish` when the job is over.
 * A claim that outlived its step would leave the job `running` with a token
 * nobody holds, and the next advance — a different request, a different token —
 * would be told `busy` until the lease expired. That is the endpoint
 * deadlocking itself on the happy path, and it is the shape the first draft of
 * this design actually had; GPT Sol found it before it was written.
 *
 * ## What an expired lease means, and what it deliberately does not
 *
 * It means *nobody is coming back*, and the job is failed so a reader can press
 * Retry. It does **not** mean another claimant may take the job over. That
 * would be safe only if every durable write were fenced, and the artefacts are
 * still files: a stage writes its output and *then* calls `finishStep`, so a
 * stale claimant's files land before its token is refused, and `beginStep`'s own
 * comment says it is not a lock. Auto-takeover becomes available the day the
 * artefact writes are transactional and not before.
 *
 * See docs/plans/durable-queue-and-uploads.md.
 */

import type { FailureKind } from "../messages.js";
import type { Job, JobStatus, JobStep, OwnerId } from "../types.js";

/**
 * Why a claim did not happen. Each of these is a different thing for the client
 * loop to do, which is why it is not `Job | undefined`.
 *
 * `busy` and `gone` collapsed into one answer is how a 404 gets reported for a
 * job that is merely working — and the loop reads a 404 as *stop asking*.
 */
export type ClaimRefusal =
  /** Somebody is inside this job, or inside another one and holding the single running slot. */
  | { kind: "busy"; why: string }
  /** No such job, or not this owner's. Those are one answer on purpose. */
  | { kind: "gone" }
  /** Already `done`, `error` or `cancelled`. Nothing to do and never will be. */
  | { kind: "finished"; job: Job }
  /** Stop was pressed. A claim here would spend a model call on a job already stopped. */
  | { kind: "stopping"; job: Job };

export type ClaimOutcome = { kind: "claimed"; job: Job } | ClaimRefusal;

/** What a step's result changes about the job, beyond the steps themselves. */
export interface StepOutcome {
  /** Extraction is the step that learns the article's real title. */
  title?: string;
}

/** How a job ended, and everything the card needs to say so. */
export interface JobEnding {
  status: Extract<JobStatus, "done" | "error" | "cancelled">;
  steps: JobStep[];
  error?: string;
  failureKind?: FailureKind;
  title?: string;
}

/**
 * Thrown when a fenced write affected no rows.
 *
 * A separate type because the caller must not treat it as an ordinary failure:
 * it means *this claimant no longer owns this job*, so it should stop rather
 * than retry. And it is thrown rather than returned because the failure mode it
 * exists to prevent is zero-rows-reads-as-success —
 * docs/reusable/silent-success.md.
 */
export class StaleAttemptError extends Error {
  constructor(readonly jobId: string) {
    super(`Job ${jobId} is no longer held by this attempt.`);
    this.name = "StaleAttemptError";
  }
}

export interface JobStore {
  /** This owner's jobs, newest first. */
  list(owner: OwnerId): Promise<Job[]>;

  /** **Somebody else's job reads as one that is not there** — every caller 404s on undefined. */
  get(id: string, owner: OwnerId): Promise<Job | undefined>;

  /**
   * Insert, **or hand back the job already doing this exact work.**
   *
   * Atomic, because two instances each scanning their own memory each find
   * nothing and each start paying for the same article. `jobs_active_slug` is
   * the conflict: it reserves the slug *and* de-duplicates, and the caller
   * compares `workKey` on the row that comes back to tell those two apart.
   *
   * `created: false, sameWork: false` means the slug is taken by *different*
   * work — the caller allocates the next suffix and tries again.
   *
   * **`workKey` is passed in rather than living on `Job`**, for two reasons.
   * It is not the reader's business, so it would have to be stripped by
   * `publicJob` alongside `ownerId` and `profile`; and it must be **immutable**,
   * where `job.steps` is not — statuses move as the job runs — so a key derived
   * from the record on each comparison could answer differently at the end of a
   * job than at the start. Computed once by the caller, from the same inputs
   * `sameWork` compares, and then only ever read back.
   */
  enqueueOrGet(
    job: Job,
    workKey: string,
  ): Promise<{ job: Job; created: boolean; sameWork: boolean }>;

  /**
   * Take this job for **one** step, or say why not.
   *
   * Refuses rather than waits, always: a claim that blocked would hold a
   * serverless invocation open doing nothing, and the caller has a perfectly
   * good thing to do with `busy`, which is ask again shortly.
   */
  claim(id: string, owner: OwnerId, attempt: string, leaseMs: number): Promise<ClaimOutcome>;

  /**
   * A step ran, the job is not over: record it and **let the claim go**.
   *
   * Fenced on all three of id, attempt and `status = 'running'`. The third is
   * the one this project has now dropped twice — a terminal row keeps its
   * token, so id-and-attempt alone lets a job already marked `error` accept its
   * own former claimant's write and report one row affected.
   */
  releaseStep(id: string, attempt: string, steps: JobStep[], outcome: StepOutcome): Promise<Job>;

  /** The job is over. Same fence, and it clears the token and the lease. */
  finish(id: string, attempt: string, ending: JobEnding): Promise<Job>;

  /**
   * Fail every job whose lease has run out, and say how many.
   *
   * **Not a takeover.** The job is marked `error` with a sentence saying it was
   * interrupted, and Retry is the reader's to press — which costs a click and
   * removes the whole class of two-claimants-one-article. See the header.
   */
  failExpired(now?: Date): Promise<number>;

  /** Stop. Not fenced, because the reader is not a claimant. */
  requestCancel(id: string, owner: OwnerId): Promise<Job | undefined>;

  /** Cancel a job that no claimant holds, in one step. Returns undefined if one does. */
  cancelIdle(id: string, owner: OwnerId): Promise<Job | undefined>;

  /** Forget one job. Refuses while it is queued or running. */
  forget(id: string, owner: OwnerId): Promise<boolean>;

  /**
   * Keep the newest `keep` finished jobs for this owner and delete the rest.
   *
   * Retention is on the contract rather than left to a caller because a store
   * that grows without limit is not a detail: `list` reads all of them, and it
   * is what the homepage polls.
   */
  trimFinished(owner: OwnerId, keep: number): Promise<number>;
}
