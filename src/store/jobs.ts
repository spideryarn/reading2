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
 * ## A claim covers a whole job, and there are three ways to put it down
 *
 * `claim` → run every step → `finish`. It covered **one step** until
 * 2026-08-30, and that shape cannot finish an ingest on a serverless host at
 * all: the next request lands on a different instance and step 2 finds nothing
 * step 1 wrote. `walkClaim` (src/jobs.ts) is where the argument lives.
 *
 * What survives from the one-step design is that a claim must never *outlive*
 * the claimant. A claim held open by a process that has stopped leaves the job
 * `running` with a token nobody holds, and every later advance is told `busy`
 * until the lease expires — the endpoint deadlocking itself on the happy path,
 * which is the shape the first draft of this design actually had; GPT Sol found
 * it before it was written. So there are exactly three doors out:
 * `releaseStep` between two steps, `pauseForDeadline` from inside one, and
 * `finish` when the job is over.
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

/**
 * **Everything about an enqueue request that is not the reader's business**, and
 * so is not on `Job`.
 *
 * `workKey` was a bare second argument until 2026-09-02; the other two arrived
 * with the per-article queue and they travel together, because each of them is
 * a fact known at exactly one moment — when the request is turned into a job —
 * and recoverable from nothing afterwards.
 */
export interface EnqueueTicket {
  /**
   * **What makes two requests the same work.**
   *
   * Passed in rather than living on `Job` for two reasons. It is not the
   * reader's business, so it would have to be stripped by `publicJob` alongside
   * `ownerId` and `profile`; and it must be **immutable**, where `job.steps` is
   * not — statuses move as the job runs — so a key derived from the record on
   * each comparison could answer differently at the end of a job than at the
   * start. Computed once by the caller and then only ever read back.
   */
  workKey: string;
  /**
   * **The slug was minted for this request**, rather than adopted from an
   * article that already exists — so this job is the one holding the name.
   *
   * Narrower than "the request carried a URL", which is what a draft of this
   * called it: `enqueue` fills `url` from `meta.json` for a late step, so a
   * request naming an article on the shelf carries one exactly as a paste does.
   * The fact is known only at slug allocation and every attempt to recover it
   * later is a guess — src/db/schema.ts § `reserves_name`.
   */
  reservesName: boolean;
  /**
   * `urlKey(url)` (src/ingest.ts), when the request arrived with an address.
   *
   * Absent for an upload and for a request that named an article without one.
   * Only meaningful alongside `reservesName`: it is what stops two simultaneous
   * pastes of one URL minting two articles.
   */
  urlKey?: string;
  /**
   * **The quota slot this job will spend**, from `reserveIngest`
   * (src/store/pg-billing.ts). Absent means the job spends none.
   *
   * On the **ticket** rather than on `Job`, deliberately. `Job` is serialised to
   * the browser by `publicJob` (src/jobs.ts), and a ledger id is not the
   * reader's business — putting it there would mean stripping it at that seam
   * and carrying a Postgres-only, billing-only field through the filesystem
   * adapter and the parity suite for nothing.
   *
   * The Postgres adapter writes it into the job's own INSERT — that atomicity is
   * the whole provenance argument, src/db/schema.ts § `ingest_events`. The
   * filesystem adapter keeps the ticket and never reads this: quota is a
   * Postgres feature (docs/project/billing.md), and there is no second ledger.
   */
  ingestEventId?: string;
}

/**
 * What `enqueueOrGet` did, and therefore what the caller must do next.
 *
 * **A union rather than more booleans**, and the reason is the bug it replaces.
 * It used to be `{job, created, sameWork}`, which is four states for three real
 * outcomes and leaves the caller to work out which combination means what. With
 * a line per article there are now *three* different ways an insert can be
 * refused, and they want three different repairs — hand the job back, rename,
 * or adopt somebody else's name. A caller that forgets one of them is a reader
 * paying for a second model call, so forgetting one is a compile error instead.
 *
 * **The store decides which of these it is by re-reading, never by reading the
 * constraint name off the error.** One insert can violate two of the indexes at
 * once and Postgres promises nothing about which of them it reports; read as
 * the wrong one, the caller renames and pays twice. GPT Sol, 2026-09-02.
 */
export type EnqueueOutcome =
  /** The row went in. This is the job, `queued`. */
  | { kind: "created"; job: Job }
  /**
   * Somebody is already doing exactly this — same owner, same article, same
   * work key, and not stopping. **Hand this job back**; a double-click on
   * *Find quotes* costs one model call.
   */
  | { kind: "sameWork"; job: Job }
  /**
   * Another active job is **claiming this name** (globally — `articles.slug` is
   * the URL contract, so two owners can build toward one). **Allocate the next
   * slug and try again.** Includes a job that is stopping but not yet over: its
   * claimant is still inside it, so the name is not free.
   */
  | { kind: "nameTaken"; job: Job }
  /**
   * Another active job of this owner's is already minting an article for **this
   * address**. **Adopt `job.slug`** rather than minting a second name — which is
   * what slug allocation would have done had it been able to see the other
   * request. Two simultaneous pastes of one URL, which no index caught before
   * `jobs_active_source`.
   *
   * **`job.slug` can be the slug you already asked for**, when the holder is on
   * this article and the work differs. Adopting it then means asking again with
   * `reservesName: false` — the request is naming an article that is being made
   * rather than claiming a name — and *not* re-sending the same ticket, which
   * would take this answer for ever. Slug allocation does that already: it
   * hands back an adopted slug for a URL something is holding.
   */
  | { kind: "sourceTaken"; job: Job };

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
  /**
   * **`queued` is a settlement too**, and the odd one out: the job is not over,
   * it has been given back to the queue on its own row for another attempt. See
   * `settleExpired`'s `requeueBudget`.
   *
   * It is in this type rather than in a second one because the caller's question
   * is the same for all three — *which jobs did this sweep move, and how* — and
   * a resumption nobody reported would be a silent success in the one place
   * there is no other account of what happened.
   */
  status: Extract<JobStatus, "error" | "cancelled" | "queued">;
}

/**
 * **What `pauseForDeadline` did** — four answers, because zero rows moved is
 * four different events and only one of them may end the job.
 *
 * A discriminated union rather than a boolean or a count ⟨GPT Sol, finding 3 on
 * docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md⟩. "The
 * statement moved nothing, so the budget must be spent" is false: it can equally
 * mean Stop set `cancelling`, the lease lapsed during the claimant's unwind
 * margin, another sweep got there first, or the attempt changed. Three of those
 * want three different things from the caller, and the fourth — Stop — wants the
 * opposite of an ending nobody asked for.
 *
 * **Only `requeued` writes the row.** The other three leave it exactly as they
 * found it, so the claimant still holds a live claim and can settle the job
 * through its own session — which is the transaction that disposes of the draft.
 * A store method that terminalised the job here would leave
 * `jobs.draft_revision_id` pointing at a revision `sweepAbandonedDrafts` spares
 * for ever.
 */
export type PauseOutcome =
  /**
   * **Back to `queued` on this same row, with the draft kept.** The next request
   * claims it and carries on.
   *
   * **The draft is why this is a separate statement, and since 2026-09-04
   * `settleExpired`'s requeue keeps it too.** On a first ingest there is no
   * published revision to copy from, so a fresh draft re-runs `blocks` as a
   * genuine first ingest and **mints every block id afresh** (src/ids.ts).
   * Everything keyed on those ids — the hierarchy structure checkpoint above all
   * — becomes permanently unreachable, so every window re-buys the most
   * expensive call in the pipeline. ⟨GPT Sol, finding 2 on the plan, reproduced:
   * `same: false` over identical HTML; and finding 1 on the built stage, which
   * is that the *lapsed* half was still throwing it away and the two therefore
   * did not compose⟩ The requeue's own note in src/store/pg-jobs.ts is where the
   * reasoning lives.
   */
  | { kind: "requeued"; job: Job }
  /**
   * **The reader pressed Stop.** Nothing was requeued and nothing may be: end
   * the job as cancelled.
   *
   * Falling through to the interrupted ending here is the failure this outcome
   * exists to name. `finishIn` clears `cancelling` and keeps whatever ending it
   * is handed, so a job the reader chose to stop would go terminal `error` with
   * a Retry button and a sentence saying nobody came back.
   */
  | { kind: "cancelled" }
  /**
   * **No windows left.** End the job the way an overrun has always ended it —
   * `INTERRUPTED`, retryable — rather than going round again.
   *
   * See `REQUEUE_BUDGET` in src/jobs.ts for why there is a number at all, and
   * for the fact that this counter is **shared** with the lapsed-lease path.
   */
  | { kind: "budget-spent" }
  /**
   * **This claimant may no longer write.** The lease lapsed while the step was
   * coming apart, the attempt moved, or the job is no longer `running`.
   *
   * Nothing this claimant does now can be recorded — an ending included — so the
   * caller reports a lost claim and lets the client ask again.
   */
  | { kind: "stale" };

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

/**
 * **The claim is still ours and the draft under it is not.** Not a lost claim.
 *
 * `StaleAttemptError` says *somebody else owns this job now*, and src/jobs.ts
 * answers `busy` to it — correctly, because any write this claimant made would
 * be refused. This says the opposite: the row is still `running`, still leased
 * to this attempt, and nobody is going to take it. Only
 * `jobs.draft_revision_id` moved, which under Postgres is what the foreign key
 * does — `on delete set null` — when the draft revision is deleted underneath a
 * live claim.
 *
 * Answering `busy` to it is the wedge in
 * docs/postmortems/260902f-a-lost-claim-that-was-never-lost-and-a-publication-that-was-never-buried.md:
 * the job stays `running` behind a live lease, `claim` cannot take it because it
 * only takes `queued`, `requestCancel` sets a flag no claimant is left to read,
 * and every other job on the article queues behind it for the length of
 * `LEASE_MS`. src/jobs.ts ends it as a storage failure instead, which fails the
 * draft, clears the pointer and gives the reader a Retry button.
 *
 * **The store's own vocabulary, not the database's.** src/store/pg-session.ts
 * translates `JobDraftGone` (src/store/pg-revisions.ts) into this at the seam,
 * the way it has always translated `NotTheLiveAttempt` into `StaleAttemptError`
 * — src/jobs.ts knows this file's names and no others. The filesystem session
 * has no such fence and so never raises it.
 *
 * `status: 409` so it crosses `guardDbStore` intact through door 1 of
 * src/store/db-errors.ts, rather than joining that file's class allowlist, which
 * its own header asks a new refusal not to do.
 */
export class DraftGoneError extends Error {
  readonly status = 409;
  constructor(readonly jobId: string) {
    super(`Job ${jobId} still holds its claim, but the draft it was writing into is gone.`);
    this.name = "DraftGoneError";
  }
}

export interface JobStore {
  /** This owner's jobs, newest first. */
  list(owner: OwnerId): Promise<Job[]>;

  /** **Somebody else's job reads as one that is not there** — every caller 404s on undefined. */
  get(id: string, owner: OwnerId): Promise<Job | undefined>;

  /**
   * Insert, **or say which of three things is already in the way.**
   *
   * Atomic, because two instances each scanning their own memory each find
   * nothing and each start paying for the same article. The insert is the thing
   * that decides — the unique indexes in src/db/schema.ts § `jobs` arbitrate —
   * and the store then **re-reads and classifies**, because one insert can
   * violate two of those indexes at once and the constraint name Postgres
   * happens to report is not an answer. See `EnqueueOutcome`.
   *
   * **A second, different job for one article is created, not refused.** That is
   * the whole of the per-article queue: it goes in as `queued` and `claim` is
   * what makes it wait its turn.
   */
  enqueueOrGet(job: Job, ticket: EnqueueTicket): Promise<EnqueueOutcome>;

  /**
   * Take this job, or say why not.
   *
   * **For the whole of it**, not for one step — `walkClaim` (src/jobs.ts) runs
   * every runnable step on this one claim, and puts it down through
   * `releaseStep`, `pauseForDeadline` or `finish`. This said *"for **one**
   * step"* until 2026-09-04, which was the shape before 2026-08-30 and is the
   * one thing a reader must not believe about a claim's lifetime.
   *
   * Refuses rather than waits, always: a claim that blocked would hold a
   * serverless invocation open doing nothing, and the caller has a perfectly
   * good thing to do with `busy`, which is ask again shortly.
   *
   * **The article's line is enforced here and nowhere else.** A job may claim
   * only when no *older* active row exists for the same slug, ordered by
   * `(created_at, id)`; otherwise `busy`, *another job on this article is ahead
   * of it*. Called a deterministic order rather than FIFO on purpose — Postgres
   * is given the application's millisecond timestamp and `id` is random, so two
   * requests inside one millisecond order by luck. What the rule has to
   * guarantee is that the set of predecessors is the same for every claimant and
   * never empties out of order, which `(created_at, id)` does; two requests for
   * one article that close together are a double-click, and `enqueueOrGet`
   * collapses those into one job before the order can matter.
   *
   * **A predecessor that is stopping still blocks.** Stop on a *queued* job
   * settles it terminal at once, so it leaves the line by itself; Stop on a
   * *running* one leaves it `running` with `cancelling` set until its claimant
   * releases or its lease lapses, and `jobs_one_running_per_slug` still covers
   * that row. Skipping it would buy the successor nothing but a unique
   * violation. The successor unblocks when the cancellation becomes terminal,
   * not when Stop is pressed. GPT Sol, 2026-09-02.
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
   * The claimant ran out of **its own** deadline part-way through a step: put
   * the job down cleanly, keeping the draft — **or say why it may not.**
   *
   * ## Why this exists at all
   *
   * `releaseStep` is the hand-back *between* two steps, and the walk takes it
   * when there is not enough deadline left for the next one. It cannot cover a
   * step that overruns once started, and a step that cannot fit in one 740 s
   * window is routine rather than rare: a 142-page PDF's `hierarchy` needs
   * 658–778 s on its own. Until 2026-09-04 that ended the job terminal `error`
   * with a Retry button on a claimant that was alive, had unwound cleanly, and
   * could have handed the job back.
   *
   * ## What it does, and what it deliberately does not
   *
   * **One atomic transition** ⟨GPT Sol, finding 3⟩, fenced on the whole of
   * `liveAttempt` — the row is locked, read and written inside one transaction,
   * so the four answers of `PauseOutcome` cannot be inferred from a row count
   * that four different events produce.
   *
   * **It keeps `draft_revision_id`** — see `PauseOutcome`. That was the one
   * thing distinguishing it from `settleExpired`'s requeue until 2026-09-04,
   * when that branch stopped clearing the pointer as well: the two halves of the
   * budget have to leave the job in the same shape or a lapse in between undoes
   * the pause. What is left distinguishing them is the *reason* they are
   * separate statements — this one is fenced on a live claim and answers four
   * outcomes; that one sweeps whatever the lease has abandoned.
   *
   * The old worry about a lapsed claimant — that it vanished mid-write, so what
   * is in its draft is whatever it had got to — does not survive the
   * transactional stage runner: artefacts, step completion and the job
   * transition commit together or not at all (src/store/pg-session.ts), so a
   * killed claim leaves a finished step or nothing. `beginStepRun` already lets
   * a later attempt reopen the step row an abort left `running`.
   *
   * **It does not end the job**, on any of the three refusals. Ending is the
   * claimant's, through its session, because that is the transaction that
   * disposes of the draft; this method would have to duplicate it and would get
   * it wrong.
   *
   * **The budget is `requeues`, shared with `settleExpired`**, and the caller
   * passes it exactly as it passes `leaseMs` and `maxRunning`. Every hand-back
   * before this one was preceded by a *completed* step, so progress was
   * structurally guaranteed and no counter was needed; a mid-step pause breaks
   * that guarantee, and without a cap a step that can never fit would pause,
   * re-claim and spend another window for ever. `REQUEUE_BUDGET` in src/jobs.ts
   * is the number and says why three windows.
   */
  pauseForDeadline(id: string, attempt: string, requeueBudget: number): Promise<PauseOutcome>;

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
   *
   * ## `requeueBudget` — and it is not always an ending
   *
   * **A lapsed claim on a job that has not used up its budget goes back to
   * `queued` on its own row instead of ending**, and comes back in the answer
   * with `status: "queued"`.
   *
   * That is what the filesystem adapter's `sweepStopped` has always done at
   * restart — running steps back to `pending`, the job back to `queued`, the row
   * otherwise untouched — so a dev-server restart is a pause rather than an
   * abandoned ingest. Postgres had no equivalent and ended the job, which on the
   * store we ship means a deploy landing mid-ingest costs the reader their job.
   * **The same row is the whole point**: the slug does not move, so the article
   * does not move, so the article's checkpoints (checkpoints.ts) are still
   * reachable. A new job could not have that.
   *
   * **And the requeued row keeps its draft**, since 2026-09-04. It did not, and
   * that made this half of the budget undo the other half: a job that had paused
   * cleanly and was then deployed over came back with `draft_revision_id` null,
   * re-minted every block id and could not reach the structure checkpoint the
   * previous window had paid for. The reasoning, and why the *terminal* branch
   * still clears the pointer, is on the statement itself in src/store/pg-jobs.ts.
   * ⟨GPT Sol, reviewing the built stage 3 of
   * docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md, finding 1⟩
   *
   * **A budget rather than a flag, because without one it never stops.** A job
   * that overruns every lease would requeue for ever, buying model calls nobody
   * is waiting for. It is the *caller's* number and the store's to enforce, the
   * same division `leaseMs` and `maxRunning` already have — `REQUEUE_BUDGET` in
   * src/jobs.ts says what it is and why.
   *
   * **Zero by default, so a caller that has not asked for this sees exactly what
   * it saw before.** A `cancelling` row is never requeued whatever the budget:
   * the reader pressed Stop, and resuming what they stopped is the app not
   * listening.
   */
  settleExpired(
    now?: Date,
    owner?: OwnerId,
    requeueBudget?: number,
  ): Promise<ExpirySettlement[]>;

  /*
   * **`activeForSlug` was here, and it is deleted rather than replaced.**
   *
   * *The job queued or running for this slug, if there is one* — a question
   * that could only ever have one answer, and now cannot: an article holds a
   * line. Both implementations picked arbitrarily, Postgres with `.limit(1)` and
   * no ordering, the filesystem in `Map` insertion order. It had **no production
   * callers** by the time it went; slug allocation asks `slugAlreadyHolding`
   * and `inFlightSlugForUrlKey` instead, which are about a URL rather than a
   * name.
   *
   * Inventing a second ambiguous singular lookup to replace an unused one would
   * be adding the problem back. A caller that needs one row asks a
   * purpose-specific question — GPT Sol, 2026-09-02.
   */

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
   * **The lapsed branch copies `settleExpired`'s *settlement* field set, not
   * its requeue's and not the running one's.** In particular it nulls
   * `draftRevisionId` — a requeued row is not terminal and keeps its draft,
   * which is a different rule for a different state. The running branch
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
   * Keep `keep` finished jobs for this owner and delete the rest.
   *
   * **Which `keep`** is the interesting part, and it is written out once in
   * src/store/pg-jobs.ts § `trimFinished`: each kind ranked by when it
   * finished, and the slots filled by taking one from each side in turn, so
   * neither successes nor failures can starve the other out.
   *
   * **Something outside the store depends on that.** The client learns a job
   * finished by polling for a terminal row (`recordCompletions`,
   * src/web/jobEngine.ts), and `noteEnded` trims immediately after every
   * ending — so the newest-finished job of each kind has to survive its own
   * sweep or no completion is ever announced. That was not true until
   * 2026-09-03: docs/postmortems/260903e-successes-deleted-before-failures-so-no-job-is-ever-announced-done.md.
   *
   * Retention is on the contract rather than left to a caller because a store
   * that grows without limit is not a detail: `list` reads all of them, and it
   * is what the homepage polls.
   */
  trimFinished(owner: OwnerId, keep: number): Promise<number>;
}
