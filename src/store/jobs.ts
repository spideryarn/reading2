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
 * It means *nobody is coming back*, and the job is settled so a reader can
 * press Retry — as `error` ordinarily, or as `cancelled` if they had already
 * pressed Stop (`settleExpired`). It does **not** mean another claimant may
 * take the job over. That
 * would be safe only if every durable write were fenced, and the artefacts are
 * still files: a stage writes its output and *then* calls `finishStep`, so a
 * stale claimant's files land before its token is refused, and `beginStep`'s own
 * comment says it is not a lock. Auto-takeover becomes available the day the
 * artefact writes are transactional and not before.
 *
 * See docs/plans/260827h-durable-queue-and-uploads.md.
 */

import { randomUUID } from "node:crypto";

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
  /** Somebody is inside this job, or the machine is already running as many as it may. */
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

/**
 * One job the expiry sweep settled, and which way it went.
 *
 * A pair rather than an id, because `settleExpired` stopped always failing —
 * a row carrying `cancelling` ends `cancelled` — so a caller that logged
 * "failed" over the ids alone would be saying something untrue about half of
 * them. GPT Sol, 2026-09-01.
 */
export interface ExpirySettlement {
  id: string;
  status: Extract<JobStatus, "error" | "cancelled">;
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
/**
 * A fresh attempt token.
 *
 * **A uuid, not a `spya-` id**, and it lives here so that the one caller and
 * the two adapters cannot disagree about that. `jobs.attempt_id` is a `uuid`
 * column (src/db/schema.ts), so a `mintId()` token is rejected by Postgres with
 * `22P02` on the *claim* — the first statement of every advance.
 *
 * Which is exactly what `advanceJob` passed until 2026-08-27, and the reason
 * nothing caught it is worth more than the fix. The filesystem adapter takes any
 * string, so the whole job suite was green. The parity suite exercised both
 * adapters, but it minted its own tokens with `crypto.randomUUID()` — so the
 * store was tested, the caller was tested, and *the value that travels between
 * them* was not. One function, so there is nothing left to disagree about.
 */
export function mintAttempt(): string {
  return randomUUID();
}

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
   *
   * **`maxRunning` is passed in, exactly as `leaseMs` is, and for the same
   * reason.** How many jobs may run at once is a policy the caller owns
   * (`jobConcurrency()`, src/jobs.ts); enforcing it is the store's. A store that
   * read the environment itself would be a second place the answer lives, and
   * the two would disagree the first time a test moved one of them.
   */
  claim(
    id: string,
    owner: OwnerId,
    attempt: string,
    leaseMs: number,
    maxRunning: number,
  ): Promise<ClaimOutcome>;

  /**
   * A step ran, the job is not over: record it and **let the claim go**.
   *
   * Fenced on all three of id, attempt and `status = 'running'`. The third is
   * the one this project has now dropped twice — a terminal row keeps its
   * token, so id-and-attempt alone lets a job already marked `error` accept its
   * own former claimant's write and report one row affected.
   */
  releaseStep(id: string, attempt: string, steps: JobStep[], outcome: StepOutcome): Promise<Job>;

  /**
   * A step is **still running**: write what the card should say, keep the claim.
   *
   * The one write that is neither a release nor a finish, and it exists for the
   * reader rather than for the queue. A step is one HTTP request and a model
   * call inside it can take half a minute; without this, a poll during that
   * half-minute sees the step still `pending` and the card says nothing is
   * happening. `ingest-queue.md` spends a section on why the label is in the
   * present tense — "Extracting the article" — and a label nobody is shown is
   * not a label.
   *
   * Same three-condition fence as `releaseStep`, and deliberately **does not
   * touch the lease**. Renewing here would be a heartbeat, and a heartbeat is
   * what makes an expired lease mean "probably dead" instead of "definitely
   * over its own deadline" — see the header on why takeover is out. The
   * claimant's own timer is the thing that has to fire first, and it cannot if
   * progress keeps pushing the lease away from it.
   */
  noteProgress(id: string, attempt: string, steps: JobStep[]): Promise<Job>;

  /** The job is over. Same fence, and it clears the token and the lease. */
  finish(id: string, attempt: string, ending: JobEnding): Promise<Job>;

  /**
   * Settle every job whose lease has run out, and say **which, and how**.
   *
   * **Not a takeover.** Retry is the reader's to press — which costs a click and
   * removes the whole class of two-claimants-one-article. See the header.
   *
   * **It does not always fail, which is why it is no longer called
   * `failExpired`.** A row carrying `cancelling` is a reader who pressed Stop
   * and whose claimant then walked away; ending that as `error` /
   * `INTERRUPTED` tells them their own action was an interruption. It settles
   * as `cancelled` instead, which makes three mechanisms agree rather than
   * adding a fourth: `releaseStepIn` already settles a live claimant's release
   * on a `cancelling` job as cancelled, and the filesystem adapter's
   * `sweepStopped` does the same on restart.
   *
   * **The outcomes, not a count.** A sweep is the only account there is of a
   * claimant that stopped answering — the process that was inside the job is
   * gone and logged nothing on its way out — and `failed 1 job(s)` cannot be
   * joined to anything, nor is it true of every row it counted. Both stores
   * already have both fields in hand: the `UPDATE` returns them, and the
   * filesystem adapter is looping over them. GPT Sol, 2026-08-30,
   * docs/plans/260830a-v1-imports-review-sol.md § Remaining operational points,
   * and 2026-09-01 on the rename.
   *
   * **`now` is for tests only.** With nothing passed, both adapters compare the
   * lease against their own store's clock — SQL `now()` on Postgres — because a
   * lease written by one instance and read by another is only a deadline if
   * both are reading the same clock.
   *
   * **`owner` narrows the same sweep to one person**, and it is what makes this
   * safe to call from a reader's request. The one caller used to be the top of
   * `/api/jobs/:id/advance`, which fires only while somebody is already driving
   * a job — so the reader who comes back to a dead claimant was structurally
   * out of the sweep's reach, which is the whole of stage 3 of
   * docs/plans/260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear.md.
   * `listJobs` calls it now, and a request-scoped sweep that took the table
   * would be one reader's page load ending another reader's import.
   *
   * **A parameter rather than a second method.** One method is one contract,
   * so tests/store-jobs-parity.test.ts goes on holding both adapters to it —
   * GPT Sol's answer 7 on the built stage 2, which also asked by name for the
   * case proving that listing as one owner cannot settle another's. Omitted,
   * the sweep is table-wide, which is what the advance path still wants: it is
   * housekeeping for the machine at the moment somebody wants the slot.
   */
  settleExpired(now?: Date, owner?: OwnerId): Promise<ExpirySettlement[]>;

  /**
   * The job queued or running for this slug, if there is one.
   *
   * Slug allocation needs it — `freeSlug` has to know that a slug is spoken for
   * by a job that has not written a `meta.json` yet, or two articles whose URLs
   * end in the same segment, added a minute apart, both take the bare name.
   *
   * **Not the same question as `enqueueOrGet`'s conflict**, though they read
   * the same row. That one is *may I have this slug*, answered by inserting;
   * this is *who has it*, answered by looking — and the difference is that a
   * lookup is allowed to be stale by the time the caller acts on it. Which is
   * why the insert is still the thing that decides, and this is only what stops
   * the caller offering a name it can already see is taken.
   */
  activeForSlug(slug: string, owner: OwnerId): Promise<Job | undefined>;

  /**
   * Stop, and **decide in one statement which kind of stop this is**.
   *
   * A queued job is over immediately: nobody is inside it to notice a flag, so
   * the transition happens here or never. A running job whose **lease has
   * lapsed** is over immediately too, and for the same reason — the claimant
   * set its own deadline inside the lease and aborted itself, so an expired
   * lease says *the process is gone* rather than *the process is slow*, and
   * there is provably nobody left to read a flag. A running job whose lease is
   * still live is asked — cancelling it out from under a claimant would leave
   * that claimant writing artefacts for a job the reader has been told is
   * finished.
   *
   * **There is no "force stop" short of that**, deliberately. A live claim may
   * genuinely be working, and clearing it is how two writers get one article.
   *
   * **The lapsed branch copies `settleExpired`'s field set, not the running
   * one's.** In particular it nulls `draftRevisionId`: the running branch
   * leaves the pointer alone because the claimant disposes of it, and a job
   * that goes terminal still holding one is a draft `sweepAbandonedDrafts`
   * spares for ever, since it reads any job's pointer as ownership. That is the
   * exact leak GPT Sol's 2026-08-30 finding closed in the sweep. Fable, on the
   * plan, 2026-09-01.
   *
   * It was two methods until 2026-08-27, `cancelIdle` then this, and the gap
   * between them was a permanent stuck state: a claimant releasing in that gap
   * turns the job `queued`, the second call writes `cancelling` onto it, and
   * every later claim answers `stopping` for ever while the reader's Stop
   * button is already disabled. GPT Sol, reviewing the built queue.
   *
   * Not fenced, because the reader is not a claimant.
   */
  requestCancel(id: string, owner: OwnerId): Promise<Job | undefined>;

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
