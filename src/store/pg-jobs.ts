/**
 * Ingest jobs in Postgres — the record both invocations can see, and the fence
 * that stops the wrong one writing.
 *
 * ## Every transition is one conditional statement, bar one
 *
 * The precondition lives in the `WHERE`, so the database decides rather than
 * the order two requests happened to arrive in, and a loser learns it lost
 * instead of overwriting a winner — where the filesystem adapter has to read
 * first, this file does not.
 *
 * **`pauseForDeadline` is the exception and it is deliberate.** Its caller does
 * not want to know *whether* it moved the row, it wants to know **why not** —
 * Stop, a spent budget, or a lost claim, which want three different things and
 * which one row count cannot tell apart. So it locks the row, decides, and
 * writes, in one transaction; the fence is still in the `WHERE` of the write.
 * A conditional statement plus a classifying read afterwards would be the worse
 * shape: the read would answer about a row that had moved in between.
 *
 * ## The fence is four conditions and this project has dropped one three times
 *
 *     where id = $id and attempt_id = $attempt and status = 'running'
 *       and lease_expires_at > clock_timestamp()
 *
 * Neither of the last two is decoration. The schema lets a terminal row keep
 * its token, so `id` + `attempt_id` alone means a job already marked `error` by
 * `settleExpired` would accept its own former claimant's write and report one row
 * affected — success, reported, with the wrong output. And without the lease,
 * **expiry revokes nothing**: a claimant that wakes up after its deadline can
 * still commit, as long as it gets to the row before Stop or the sweep does.
 * Zero rows throws `StaleAttemptError` rather than returning quietly, because
 * zero-rows-reads-as-success is the failure this whole mechanism exists to
 * prevent (docs/reusable/silent-success.md).
 *
 * All four live in src/store/job-fence.ts, shared with the draft fences in
 * src/store/pg-revisions.ts, which had dropped the same condition.
 *
 * ## `23505` is an answer, not an error — but never a *name*
 *
 * Four partial unique indexes in src/db/schema.ts arbitrate an article's queue,
 * and `enqueueOrGet` inserts against all of them with `on conflict do nothing`:
 * a conflict is an ordinary outcome, because an index doing its job is not an
 * exception.
 *
 * **What the store must not do is read the constraint name and branch on it.**
 * One insert can violate two of those indexes at once, and Postgres promises
 * nothing about which it reports; read as the wrong one, the caller renames an
 * article and pays for a second model call. So `tryEnqueue` re-reads the active
 * rows and classifies from the data. GPT Sol, 2026-09-02.
 *
 * **The index that used to be here has gone twice over.** `jobs_only_one_running`
 * gave global concurrency 1 as a unique index on a constant, and `claim` caught
 * its `23505` by name; a constant cannot express *at most N*, so on 2026-08-30 it
 * was dropped for a count taken inside the `queue_state` lock. `jobs_active_slug`
 * gave one active job per article, and on 2026-09-02 it became four narrower
 * indexes so that an article could hold a line. Neither name is caught here any
 * more, and a `catch` that still named one of *those* would be dead code reading
 * as a live guard.
 *
 * **One name is caught, and `claimIn` says why at length.**
 * `jobs_one_running_per_slug` is the article's running mutex, and a claim that
 * violates it means *somebody else is inside this article* — which is `busy`,
 * not a 500. The read above it is what normally answers; the `catch` is there
 * for a claimant that does not take the `queue_state` lock, and it is written
 * down as unreachable-today rather than presented as a live guard.
 */

import { and, desc, eq, inArray, isNull, lt, lte, not, or, type SQL, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { guardDbStore, lockUnavailable, violatesConstraint } from "./db-errors.js";
import { READ_COMMITTED } from "./isolation.js";
import { leaseIsOver, liveAttempt } from "./job-fence.js";
import { ownedSlug } from "./owned-slug.js";
import { RELEASED, releaseReservations, settleReservation } from "./pg-billing.js";
import { articles, jobs, queueState } from "../db/schema.js";
import { INTERRUPTED } from "../messages.js";
import type { FailureKind } from "../messages.js";
import type { Job, JobStatus, JobStep, OwnerId } from "../types.js";
import {
  type ClaimOutcome,
  type ClaimRefusal,
  type EnqueueOutcome,
  type EnqueueTicket,
  type ExpirySettlement,
  type JobEnding,
  type JobStore,
  type PauseOutcome,
  StaleAttemptError,
  type StepOutcome,
} from "./jobs.js";

type Row = typeof jobs.$inferSelect;

type Db = ReturnType<typeof getDb>;
/** A transaction, spelled the way src/store/pg-revisions.ts already spells it. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/**
 * Either will do for a job transition.
 *
 * Not `Tx`-only, which is the rule src/store/artifacts-pg.ts sets for the
 * artefact *write*, and the difference is worth saying. An artefact write is
 * several statements that must land together, so a default executor there would
 * make forgetting the caller's transaction both compile and succeed. A job
 * transition is **one fenced `UPDATE` and nothing else only while it does not
 * end the job**, and every caller in this file that can end one now opens a
 * transaction. What is left on the bare pool is `noteProgress`, whose statement
 * really is the whole operation.
 *
 * **`claim` stopped being one of them on 2026-08-30.** It opens a transaction of
 * its own, because the global cap is a count that has to be taken inside the
 * `queue_state` lock.
 *
 * **`finish` and `releaseStep` stopped being ones on 2026-09-03**, and that is
 * the correction this note is really about — it used to say a job transition was
 * atomic on its own "which is why `rawPgJobStore` may keep passing the pool",
 * and that stopped being true the moment a terminal transition also had to
 * settle the job's quota slot in `ingest_events`. GPT Sol counted the paths
 * (2026-09-03, docs/plans/260902i-settlement-code-review-sol.md finding 1); see
 * `settlingIfTerminal` below.
 *
 * The parameter stays wide, because `settleIn` (src/store/pg-session.ts) passes
 * the *publication's* transaction into `finishIn` and `releaseStepIn` and those
 * two must not open one of their own.
 */
type Executor = Db | Tx;

/**
 * The three statuses a job never leaves.
 *
 * **Exported for `pgShelfStore.destroy`** (pg-shelf.ts), which takes an
 * article's terminal jobs with it — a `forget` per row, for the reason written
 * there. Same argument as `ACTIVE` below: a second copy of this list somewhere
 * else is a list that goes stale the day a status is added.
 */
export const TERMINAL = ["done", "error", "cancelled"] as const;
/**
 * The two a job can still be doing something in.
 *
 * Exported for tests/helpers/forget-revisions.ts, which refuses to delete an
 * article's revisions while a job is inside one of these — the second writer in
 * docs/postmortems/260902f-a-lost-claim-that-was-never-lost-and-a-publication-that-was-never-buried.md.
 * A second copy of this list in a helper is a list that would go stale the day a
 * status is added.
 */
export const ACTIVE = ["queued", "running"] as const;

/**
 * A row as the rest of the app wants it.
 *
 * **Absent rather than null**, throughout. `Job`'s optional fields mean "we do
 * not have this", and they are checked with `!== undefined` and with `?.` all
 * over; a `null` arriving from the database is a different value in some of
 * those places and is serialised onto the wire in others, where the client's
 * own type says it cannot be. One conversion here rather than a `?? undefined`
 * at every reader.
 */
function toJob(row: Row): Job {
  return {
    id: row.id,
    ownerId: row.ownerId as OwnerId,
    slug: row.slug,
    steps: row.steps,
    status: row.status as JobStatus,
    createdAt: row.createdAt.toISOString(),
    ...(row.url !== null && { url: row.url }),
    ...(row.title !== null && { title: row.title }),
    ...(row.profile !== null && { profile: row.profile }),
    ...(row.error !== null && { error: row.error }),
    ...(row.failureKind !== null && { failureKind: row.failureKind as FailureKind }),
    ...(row.startedAt !== null && { startedAt: row.startedAt.toISOString() }),
    ...(row.finishedAt !== null && { finishedAt: row.finishedAt.toISOString() }),
    /* Both halves or neither — `jobs_upload_both_or_neither` enforces it, and
       this reads the id because that is the column the check is anchored on. */
    ...(row.uploadId !== null && {
      upload: { id: row.uploadId, filename: row.uploadFilename ?? "" },
    }),
    // `cancelling` is `false` in the column and *absent* on the type when not
    // set, because the card reads `job.cancelling === true`.
    ...(row.cancelling && { cancelling: true }),
    /* Absent at zero, for the same reason: it is nearly every job, and a field
       that is always there is a field the client has to test the value of.
       `Job.requeues` (src/types.ts) says what it is for. */
    ...(row.requeues > 0 && { requeues: row.requeues }),
  };
}

/** What a retry needs to know about the attempt it is repeating. */
export interface IngestProvenance {
  /** The slot that attempt spent, or null when it spent none. */
  readonly ingestEventId: string | null;
  /** The article it was for, for the new reservation's diagnostic slug. */
  readonly slug: string;
}

/**
 * **Did this job carry a quota slot?** — the question `POST /api/jobs/:id/retry`
 * has to answer before it decides whether to reserve one.
 *
 * `Job.url` cannot answer it. A step re-run on an article already on the shelf
 * has a URL too, filled in from the article by `enqueue`, so "it has an address"
 * matches the free shape as readily as the paid one. The provenance column is
 * the fact itself, which is why it exists.
 *
 * **Not on `Job` and not on the `JobStore` interface**, deliberately. `Job` is
 * serialised to the browser by `publicJob` (src/jobs.ts) and a ledger id is not
 * the reader's business; the interface is shared with the filesystem adapter,
 * where quota does not exist (docs/project/billing.md). So this is a Postgres
 * read with one Postgres-only caller — src/billing/admission.ts, which is
 * already behind that flag.
 *
 * Owner-scoped, like `get`: somebody else's job is one that is not there.
 */
export async function ingestProvenanceOf(
  id: string,
  owner: OwnerId,
): Promise<IngestProvenance | undefined> {
  const [row] = await getDb()
    .select({ ingestEventId: jobs.ingestEventId, slug: jobs.slug })
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.ownerId, owner)))
    .limit(1);
  return row;
}

/**
 * **The article this job is about to be queued against, locked** — and the one
 * new statement in this file since 2026-09-06.
 *
 * GPT Sol's F4 on the permanent-delete plan. `enqueue` (src/jobs.ts) checks
 * that a bare-slug request names an article the reader owns *before* it builds
 * the job, and nothing held that fact still:
 *
 *     enqueue: articleExists("x") → true
 *     delete:  locks "x", sees no active job, deletes it, commits
 *     enqueue: inserts its queued job for "x"
 *     worker:  lockOrCreateArticle("x") → **creates the row**
 *
 * — and the delete had already reported success. `lockOrCreateArticle` creating
 * an absent row is right for a first ingest and is the whole reason this is a
 * race rather than a failure (src/store/pg-revisions.ts).
 *
 * So the check moves inside the insert's own transaction, under this lock. It
 * is the same row `pgShelfStore.destroy` and `lockOrCreateArticle` take, which
 * makes the three serialise: whoever gets it first, the other sees a committed
 * fact rather than a stale one. Either the delete wins and this re-reads
 * absence and refuses, or this wins and the delete finds a committed job and
 * answers 409.
 *
 * **The lock is attempted for every enqueue and *insisted on* for only some.**
 * `FOR UPDATE` on a row that is not there locks nothing
 * (docs/postmortems/260901f-a-for-update-that-locks-nothing.md), so for a
 * minted slug this costs one indexed miss and buys nothing — which is correct,
 * because there is nothing yet to protect. What `ticket.requiresArticle` adds
 * is the refusal, and it belongs to exactly one shape: see `EnqueueTicket`.
 *
 * **No `billing_accounts` lock is taken here and none may be.** The order is
 * `billing_accounts` before `articles`, everywhere (src/store/pg-billing.ts §
 * *The lock order*); a transaction that takes only the article is outside that
 * order and cannot close a cycle with one that takes both. The reservation is
 * already committed by the time `enqueue` is called — `withIngestSlot`
 * (src/billing/admission.ts) says at length why the billing lock is *not* held
 * across this — so there is nothing here to take it for.
 */
async function lockArticleFor(tx: Tx, job: Job) {
  return await tx
    .select({ id: articles.id })
    .from(articles)
    .where(ownedSlug(job.slug, job.ownerId))
    .for("update")
    .limit(1);
}

/**
 * **The article a bare-slug request named has gone.**
 *
 * Word for word the sentence `enqueue`'s preflight throws (src/jobs.ts) and the
 * one `GET /api/article/:slug` answers with for a slug that is not yours, so
 * that "somebody else has it", "nobody has it" and "it was deleted while you
 * were asking" cannot be told apart on the wire.
 */
function noSuchArticle(): Error {
  return Object.assign(new Error("No such article."), { status: 404 });
}

/**
 * **The attempt this retry repeats, locked** — and required, which is the point.
 *
 * The same statement and the same argument as `lockArticleFor` above, one row to
 * the left: `retryJob` (src/jobs.ts) reads the failed attempt on the pool, and
 * nothing held that fact still. `pgShelfStore.destroy` deletes the article's
 * terminal jobs in the transaction that deletes the article, so the attempt and
 * the article go together — and a retry that had already read the attempt would
 * otherwise insert on the far side of that, with `requiresArticle` false because
 * the allocation minted. The worker then remakes the article. GPT Sol's F40.
 *
 * **Owner-scoped**, like `get`: somebody else's job is one that is not there.
 *
 * **After the article lock, never before.** `destroy` takes `articles` and then
 * `jobs`, and a transaction that took them the other way round would be the
 * cycle. The article lock is a no-op when the article is absent, so the only
 * order this can ever hold locks in is the one `destroy` uses.
 */
async function lockRetriedAttempt(tx: Tx, job: Job, retryOf: string) {
  return await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, retryOf), eq(jobs.ownerId, job.ownerId)))
    .for("update")
    .limit(1);
}

/**
 * **The live job this request adopted a name from, locked** — and required to
 * still be live.
 *
 * GPT Sol's F41. `freeSlug` (src/jobs.ts) hands back a queue holder's slug, and
 * that allocation deliberately does not insist on an article, because the holder
 * may not have opened its draft yet. The gap between the lookup and the insert is
 * long enough for the holder to publish, finish, and have its article destroyed —
 * and then this insert lands on a slug with nothing under it.
 *
 * **Only asked when the article is absent**, which is the difference between a
 * guard and a refusal of ordinary work: a holder that finished properly leaves
 * the article behind, and adopting a name whose article exists is a shelf
 * adoption in all but provenance.
 *
 * **The lock has to cover the insert**, and does, because it is taken in the
 * insert's own transaction. An unlocked existence check is the same race one
 * statement later — the finding says so in as many words.
 *
 * **A miss is not a refusal on its own**, because `articleExists` was read
 * without holding anything: `restartRatherThanRefuse` is what a miss goes
 * through, and it asks for one more pass before it will say no.
 *
 * Narrower than it looks, and deliberately not sold as more: this closes the
 * window *before* the insert, not the one after it. A holder that goes terminal
 * once our non-reserving row is committed still leaves an address nothing
 * reserves — the class written up at `handBackToARetry` (src/jobs.ts), whose
 * durable fix is a table that claims an address.
 */
async function lockAdoptedHolder(tx: Tx, job: Job, holderId: string) {
  return await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(eq(jobs.id, holderId), eq(jobs.ownerId, job.ownerId), inArray(jobs.status, ACTIVE)),
    )
    .for("update")
    .limit(1);
}

/**
 * **The attempt this retry repeats has gone**, which means the article it
 * belonged to went with it.
 *
 * A 404 rather than a 409, and the same 404 the reader would have got a moment
 * earlier: `retryJob` starts with `store.get(id, owner)` and src/routes.ts turns
 * its `null` into exactly this. The race only moves *when* the answer is
 * discovered, so it must not change what the answer is.
 *
 * No job id in the message. It would be ours to give and harmless, but the
 * sentence is what a reader sees and the id would be noise in it.
 */
function noSuchAttempt(): Error {
  return Object.assign(
    new Error("That attempt is no longer on file, so there is nothing to try again."),
    { status: 404 },
  );
}

/**
 * **The in-flight job this request was joining has gone, and so has its article.**
 *
 * A 409 rather than a 404, because nothing the reader named is missing: they
 * pasted an address, and the answer is that the thing it was about to join
 * stopped existing underneath it. Asking again is the repair and it will work,
 * which is what the sentence says.
 *
 * Words we chose and nothing else — no slug, no address, no title (src/log.ts).
 */
function adoptedJobGone(): Error {
  return Object.assign(
    new Error("The article this was joining has gone. Add it again to make a new one."),
    { status: 409 },
  );
}

/**
 * **Why one pass through `enqueueIn` produced no outcome.** Both mean *open a
 * fresh transaction and go round again*; they are named rather than both being
 * `null` because the caller does different things with them, and because each
 * records a different fact.
 *
 * `nothingHoldsIt` — the insert conflicted and then the re-read classified
 * nothing, because whoever held it finished between the two statements. The way
 * is clear now, so the next attempt inserts.
 *
 * `holderLeftTheQueue` — the queue holder this request adopted a name from is no
 * longer active, **and this transaction's article lookup is from before that**.
 * See `restartRatherThanRefuse`.
 */
type Restart = "nothingHoldsIt" | "holderLeftTheQueue";

/**
 * Which pass this is. `again` is the one restart `holderLeftTheQueue` buys, and
 * on it the holder guard refuses rather than asking for another.
 *
 * A two-value union rather than a boolean, so that neither the call site nor the
 * reader has to remember which way round `true` points.
 */
type Look = "first" | "again";

/**
 * Named rather than `typeof result === "string"`, which would be a lie the
 * compiler could not catch the day `EnqueueOutcome` grew a string member.
 */
const isRestart = (result: EnqueueOutcome | Restart): result is Restart =>
  result === "nothingHoldsIt" || result === "holderLeftTheQueue";

/**
 * **The guard's own staleness, and the only repair that does not reverse the
 * lock order** — GPT Sol's F50, docs/plans/260906h-delete-an-article-permanently.md.
 *
 * `lockArticleFor` on an absent article locks *nothing*
 * (docs/postmortems/260901f-a-for-update-that-locks-nothing.md), so
 * `articleExists === false` is a fact from a moment that has already passed —
 * exactly the kind of fact this whole family of guards exists to distrust. The
 * losing sequence is an ordinary second paste:
 *
 * 1. `lockArticleFor` finds no article and takes no lock;
 * 2. the holder creates the article, publishes, goes terminal, and **commits**;
 * 3. `lockAdoptedHolder` wants an *active* holder, finds a terminal one, and
 *    refuses — on the strength of an article lookup taken before step 2.
 *
 * The reader is then told *"the article this was joining has gone"* about an
 * article that is sitting right there.
 *
 * **The repair is to start the transaction over, not to look at the article
 * again here.** Re-reading or re-locking `articles` after the job lock is the
 * trap: `pgShelfStore.destroy` takes `articles` and then `jobs`, and a
 * transaction holding a job row and then reaching for the article row is the
 * other half of that cycle. Restarting releases the job lock and goes back
 * through the canonical article-first order, where the second pass finds the
 * article, skips this guard entirely, and inserts as the ordinary adoption it
 * always was.
 *
 * **Exactly one restart**, and the `Look` is how it is counted. A second miss
 * means the holder really has gone and left nothing behind, which is what the
 * 409 says. The window is not mathematically closed — the holder could commit
 * inside the retry's own gap too — but each pass is a fresh article-first
 * lookup, and a loop here would be trading a rare wrong sentence for an
 * unbounded one.
 */
function restartRatherThanRefuse(look: Look): Restart {
  if (look === "again") throw adoptedJobGone();
  return "holderLeftTheQueue";
}

/**
 * **The rows this insert leaned on, re-asked under the lock** — the pair of
 * guards `requiresArticle` is the third of.
 *
 * All three answer one question: slug allocation (src/jobs.ts) decided this
 * request could go ahead because of something it saw, and *when* it saw it is a
 * moment that has passed. The article is one such thing; the other two are job
 * rows, and both of them are what a delete takes with the article
 * (`deleteTerminalJobs`, src/store/pg-shelf.ts). GPT Sol's F40 and F41,
 * docs/plans/260906h-delete-an-article-permanently.md.
 *
 * **After the article lock, never before it.** `pgShelfStore.destroy` takes
 * `articles` and then `jobs`; a transaction taking them the other way round
 * would be the cycle. Called with whether that lock found anything rather than
 * with the row, because that is all either guard wants to know.
 *
 * **Throws for the two answers that are final, and returns for the one that is
 * not.** A missing attempt is a 404 and a second look could only agree with it;
 * a missing *holder* is only final on the second look, because
 * `articleExists` was read before nothing was locked — `restartRatherThanRefuse`
 * is the whole of that argument.
 */
async function requireWhatTheAllocationLeanedOn(
  db: Tx,
  job: Job,
  ticket: EnqueueTicket,
  articleExists: boolean,
  look: Look,
): Promise<Restart | undefined> {
  if (ticket.retryOf !== undefined) {
    const [attempt] = await lockRetriedAttempt(db, job, ticket.retryOf);
    if (!attempt) throw noSuchAttempt();
  }
  /* Only when the article is absent: a holder that finished properly left one
     behind, and adopting a name whose article exists is a shelf adoption in all
     but provenance. See `lockAdoptedHolder`. */
  if (!articleExists && ticket.adoptedFromJob !== undefined) {
    const [holder] = await lockAdoptedHolder(db, job, ticket.adoptedFromJob);
    if (!holder) return restartRatherThanRefuse(look);
  }
  return undefined;
}

/**
 * One insert-or-look. A `Restart` rather than an outcome means *open a fresh
 * transaction and call this again* — see `Restart` for the two reasons.
 *
 * **A transaction since 2026-09-06**, where it used to be two statements on the
 * pool. The insert and the article lock in front of it have to land together or
 * the lock is decorative — see `lockArticleFor`. The re-read below stays inside
 * it for the same reason it was always immediately after the insert: it is
 * answering *"who is in the way of the row I just failed to write"*, and a
 * question asked outside the transaction that failed is a question about a
 * different moment.
 */
async function enqueueIn(
  db: Tx,
  job: Job,
  ticket: EnqueueTicket,
  look: Look,
): Promise<EnqueueOutcome | Restart> {
  const [article] = await lockArticleFor(db, job);
  /* **Re-read after the lock, never trusting the preflight.** The preflight in
     src/jobs.ts still runs and still fails fast — it is what stops a typo
     minting ids and spending a reservation — but by the time this line runs it
     is a fact from before the lock, which is precisely the fact the race
     invalidates. */
  if (!article && ticket.requiresArticle === true) throw noSuchArticle();

  const restart = await requireWhatTheAllocationLeanedOn(
    db,
    job,
    ticket,
    article !== undefined,
    look,
  );
  if (restart) return restart;

  const inserted = await db
    .insert(jobs)
    .values({
      id: job.id,
      ownerId: job.ownerId,
      slug: job.slug,
      steps: job.steps,
      /* **Queued, always, whatever the caller handed us.** `enqueueOrGet` takes a
         whole `Job`, and copying its `status` let a caller insert a `running`
         row that never passed the cap check and carries no attempt token — one
         more running job than the machine agreed to, arriving through the door
         marked "enqueue". Nothing does that today; the contract simply should
         not allow it. GPT Sol, reviewing the built stage 1. */
      status: "queued",
      workKey: ticket.workKey,
      reservesName: ticket.reservesName,
      urlKey: ticket.urlKey ?? null,
      /* **In this row's own INSERT**, which is the whole of why the link points
         this way: the job and the slot it is spending become true in one
         statement, so there is no moment where a job exists and nothing knows to
         charge for it. src/db/schema.ts § `ingest_events`, *Provenance lives on
         the job*. Null for everything that spends no quota. */
      ingestEventId: ticket.ingestEventId ?? null,
      createdAt: new Date(job.createdAt),
      url: job.url ?? null,
      title: job.title ?? null,
      profile: job.profile ?? null,
      uploadId: job.upload?.id ?? null,
      uploadFilename: job.upload?.filename ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return { kind: "created", job: toJob(inserted[0]) };

  /**
   * **Re-read and decide. Never dispatch on the constraint name.**
   *
   * Two identical URL ingests violate `jobs_active_work` *and*
   * `jobs_reserved_slug` in one insert, and Postgres promises nothing about
   * which of them it names; read as the reservation, the caller renames and
   * pays twice. So the indexes stay guarantees rather than a signalling
   * channel, and one query answers all three questions. GPT Sol, 2026-09-02.
   *
   * **Both halves of the `or`, because the two conflicts live on different
   * rows.** A duplicate of this work and a reserver of this name are on *this
   * slug*; the simultaneous-paste holder is on a slug of its own, and only
   * `url_key` connects the two.
   *
   * Ordered, so that when several rows could answer, the same one always does.
   */
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, ACTIVE),
        or(
          eq(jobs.slug, job.slug),
          ticket.urlKey === undefined
            ? undefined
            : and(
                eq(jobs.ownerId, job.ownerId),
                eq(jobs.reservesName, true),
                eq(jobs.urlKey, ticket.urlKey),
              ),
        ),
      ),
    )
    .orderBy(jobs.createdAt, jobs.id);

  /* **Exactly the predicates the indexes carry, and no looser.** `jobs_active_work`
     excludes `cancelling` rows and is owner-scoped; `jobs_reserved_slug` and
     `jobs_active_source` include them and are global and owner-scoped
     respectively. A re-read that disagreed with an index would answer a question
     the insert did not ask. */
  const mine = rows.find(
    (row) =>
      row.ownerId === job.ownerId &&
      row.slug === job.slug &&
      row.workKey === ticket.workKey &&
      !row.cancelling,
  );
  if (mine) return { kind: "sameWork", job: toJob(mine) };

  /* **The address before the name**, when both could answer. Adopting the
     holder's slug is what slug allocation would have done with full sight of
     the other request, and it costs nothing; renaming mints a second article
     for one address, which is the thing `jobs_active_source` exists to stop.
     Only asked when *this* request reserves — an insert that did not is outside
     that index and cannot have conflicted with it. */
  if (ticket.reservesName && ticket.urlKey !== undefined) {
    const source = rows.find(
      (row) =>
        row.ownerId === job.ownerId && row.reservesName && row.urlKey === ticket.urlKey,
    );
    if (source) return { kind: "sourceTaken", job: toJob(source) };
  }

  if (ticket.reservesName) {
    const name = rows.find((row) => row.slug === job.slug && row.reservesName);
    if (name) return { kind: "nameTaken", job: toJob(name) };
  }

  /**
   * **Nothing classified — so either the holder finished, or the id is taken.**
   *
   * `on conflict do nothing` covers every unique index on the table, and only
   * three of them are the queue's. `jobs_pkey` is the fourth kind of answer,
   * and it is the one the retry above cannot repair: the same id is minted
   * again on every pass, so `enqueueOrGet` would spend its whole budget and
   * then say *nothing holds it for this slug*, which is true and is about
   * entirely the wrong thing. Astronomically unlikely — `spya-` plus six random
   * base36 characters — and exactly why it has to be said rather than looped
   * over. GPT Sol, reviewing the built stage 1, finding 7.
   *
   * One extra read, on a path that is already the slow one: it only runs when
   * an insert conflicted *and* none of the three classifiers answered.
   *
   * **The `status` is what lets the sentence out.** `guardDbStore` replaces the
   * message of anything without one, so an unmarked error here would be as
   * silent as the sentence it replaces — src/store/db-errors.ts § *Adding a
   * sixth: don't. Give the class a `status` instead.* The message carries the
   * job id and nothing else, which is `spya-` and six characters we minted
   * ourselves; no slug, no URL, no title.
   */
  const [taken] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.id, job.id))
    .limit(1);
  if (taken) {
    throw Object.assign(
      new Error(
        `Job id ${job.id} is already taken by another row, so this insert can never succeed. ` +
          "That is an id collision rather than anything about the queue.",
      ),
      { status: 500 },
    );
  }

  // Whoever held it finished between the two statements. The caller asks again.
  return "nothingHoldsIt";
}

/**
 * The transaction `enqueueIn` above needs, and nothing else.
 *
 * Split in two so that the lock, the insert and the classification are not
 * one function — the `…In` convention this file already keeps for `claimIn`,
 * `settleIn` and `releaseStepIn`, and for the same reason: what happens inside
 * a transaction should be readable without the transaction wrapped around it.
 */
async function tryEnqueue(
  job: Job,
  ticket: EnqueueTicket,
  look: Look,
): Promise<EnqueueOutcome | Restart> {
  return await getDb().transaction((db) => enqueueIn(db, job, ticket, look), READ_COMMITTED);
}

/**
 * Is another job in the way on this article — **older, or already running**?
 *
 * Two conditions, and the second is not a refinement of the first.
 *
 * **Older** is the order rule: the article's line is `(created_at, id)`, and a
 * job may not step in front of one that was asked for first.
 *
 * **Running at all** is the mutex, asked here rather than left to the index. A
 * job whose row commits *after* a newer one has already claimed the slug has no
 * predecessor — nothing on the article is older than it — so the order rule
 * alone waves it through, and its `UPDATE` then collides with
 * `jobs_one_running_per_slug`. That is a `23505` where the contract says
 * `busy`: a 500 on the reader's request, and a pump that logs a thrown
 * exception and exits. The late commit is still deliberately **not** FIFO — an
 * older row arriving late does not get to displace a job already inside the
 * article — it simply waits its turn like everything else. GPT Sol, reviewing
 * the built stage 1, finding 2; `claimIn` carries the backstop for the window
 * between this read and that write.
 *
 * One statement, and the row's own `(created_at, id)` is read inside it rather
 * than passed in as a parameter. That is not tidiness: `created_at` is a
 * `timestamptz` with microsecond resolution, and a JavaScript `Date` carries
 * milliseconds — so a round trip through the caller would round this job's own
 * timestamp *down* and let it step in front of a predecessor it shares a
 * millisecond with. Two claimants would then each believe they were first.
 *
 * Row-wise `<` rather than `created_at < … or (= and id <)`, because they are
 * the same comparison and only one of them can be got wrong. `jobs_slug_order`
 * is the index it reads.
 *
 * `other.id <> mine.id` is load-bearing and was not before: the row-wise
 * comparison excluded this job from itself, and `other.status = 'running'` does
 * not.
 */
async function blockedByAnother(tx: Tx, id: string): Promise<boolean> {
  const ahead = await tx.execute(sql`
    select 1
      from ${jobs} as other, ${jobs} as mine
     where mine.id = ${id}
       and other.slug = mine.slug
       and other.id <> mine.id
       and other.status in ('queued', 'running')
       and (other.status = 'running'
            or (other.created_at, other.id) < (mine.created_at, mine.id))
     limit 1
  `);
  return ahead.rowCount === 1;
}

/**
 * The claim itself, once the cap above has allowed it.
 *
 * Split out so that `claim` reads as the two things it now is — take the lock
 * and count, then take the job — and so the `UPDATE` and its classifier stay one
 * unit. It takes the caller's transaction because it must run inside the same
 * lock the count ran inside; a version of this that opened its own would put the
 * gap back.
 */
async function claimIn(
  tx: Tx,
  id: string,
  owner: OwnerId,
  attempt: string,
  leaseMs: number,
): Promise<ClaimOutcome> {
    let taken: Row[];
    try {
      taken = await tx
        .update(jobs)
        .set({
          status: "running",
          attemptId: attempt,
          /* **The database's clock, not this instance's.** The lease is what
             says whether a claimant is still allowed to write, and it is
             written by one instance and read by another — so an app-clock
             deadline is only a deadline while every instance agrees what time
             it is. `settleExpired` and the fence compare against the same
             clock, which makes the whole lease one clock's arithmetic.

             **`clock_timestamp()`, not `now()`.** `now()` is transaction start
             time, and this claim is inside a transaction that has already
             taken the `queue_state` lock and counted the running rows — so
             `now()` back-dates the lease by however long that took, and the
             claimant, whose self-abort timer starts when the claim *returns*,
             would still be alive after the row said it was gone. The gap is
             small on a good day and is exactly the window finding 1 is about.
             GPT Sol, 2026-09-01; the whole reasoning is in
             src/store/job-fence.ts. */
          leaseExpiresAt: sql`clock_timestamp() + make_interval(secs => ${leaseMs} / 1000.0)`,
          // A resumed job started once already, and the card's "how long has
          // this been going" should not restart every time a tab picks it up.
          startedAt: sql`coalesce(${jobs.startedAt}, now())`,
        })
        .where(
          and(
            eq(jobs.id, id),
            eq(jobs.ownerId, owner),
            eq(jobs.status, "queued"),
            eq(jobs.cancelling, false),
          ),
        )
        .returning();
    } catch (err) {
      /* **The backstop, and it should not be reachable today.** Said plainly,
         because the header of this file argues that a `catch` on a constraint
         name is dead code reading as a live guard, and this is the exception it
         is worth making. `blockedByAnother` above is a read and this is the
         write — but every transition into `running` takes the `queue_state`
         singleton first, so no other claimant can be between them, and the read
         is what actually answers `busy`. What this covers is a claimant that
         does *not* take that lock: an older build mid-deploy, a script, or the
         next change to this function. An article's running mutex refusing a
         second runner is an index doing its job, which the header says is an
         answer rather than an error — so the failure mode it removes is a 500
         on a request whose contract says *wait*.

         **By name, and only this name.** The `UPDATE` can violate exactly one
         unique index — `jobs_one_running_per_slug` is the only one of the four
         over `status = 'running'` — so reading a name here is safe in the way
         `enqueueOrGet` deliberately is not (src/store/db-errors.ts §
         `violatesConstraint`). Anything else rethrows.

         **No `jobs_only_one_running` branch, and its absence is still the thing
         to notice.** That index was the whole of the *global* guarantee and a
         `23505` here was an ordinary answer for it too; it is gone
         (drizzle/0032_jobs_concurrency_cap.sql) and the cap is counted by the
         caller inside the queue_state lock. */
      if (violatesConstraint(err, "jobs_one_running_per_slug")) {
        return { kind: "busy", why: "another job on this article is ahead of it" };
      }
      throw err;
    }
    if (taken[0]) return { kind: "claimed", job: toJob(taken[0]) };

    /* Nothing moved, and the four reasons are four different things for the
       caller to do. Read once and say which — after the update, never before,
       since asking first would put a gap back in for the sake of a nicer
       message. */
    const current = await getIn(tx, id, owner);
    if (!current) return { kind: "gone" };
    if (TERMINAL.includes(current.status as (typeof TERMINAL)[number])) {
      return { kind: "finished", job: current };
    }
    if (current.cancelling === true) return { kind: "stopping", job: current };
    return { kind: "busy", why: "another request is inside this job" };
  }

/**
 * **What this job is**, when `claim` is about to refuse it for some reason of
 * the machine's rather than of the job's.
 *
 * `undefined` means *nothing about this job says no* — the caller's own reason
 * stands. Anything else is the job's own answer and outranks it: at the cap, or
 * behind an older job on its article, a finished job must still read `finished`
 * and a missing one `gone`, or the answer to "what is this job doing" changes
 * with how busy the machine is. `advanceJobWith` casts the `get()` behind its
 * `busy` branch straight to `Job`, so a missing row read as `busy` becomes a 200
 * where the route means a 404. GPT Sol, reviewing the built stage 1.
 *
 * One function because there are now two callers — the cap and the article's
 * line — and two copies of a four-way classification is two chances to add a
 * fifth state to one of them.
 */
async function refusalFor(tx: Tx, id: string, owner: OwnerId): Promise<ClaimRefusal | undefined> {
  const current = await getIn(tx, id, owner);
  if (!current) return { kind: "gone" };
  if (TERMINAL.includes(current.status as (typeof TERMINAL)[number])) {
    return { kind: "finished", job: current };
  }
  if (current.cancelling === true) return { kind: "stopping", job: current };
  if (current.status === "running") {
    return { kind: "busy", why: "another request is inside this job" };
  }
  return undefined;
}

/** `get`, on the caller's transaction — the classifier above must read inside the lock. */
async function getIn(tx: Tx, id: string, owner: OwnerId): Promise<Job | undefined> {
  const [row] = await tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.ownerId, owner)))
    .limit(1);
  return row ? toJob(row) : undefined;
}

/**
 * **The steps of a job that is going terminal with one of them still running.**
 *
 * A `running` step on a job that is over draws a spinner on a card that has
 * finished, which is the one thing a progress list must never do. Both expiry
 * paths could leave one: nobody is inside the job to write the step out, so if
 * the statement that ends the job does not settle it, nothing ever will.
 *
 * ## The two endings settle it differently, and that is the point
 *
 * **Cancelled — the reader asked.** Back to `pending`, `startedAt` dropped,
 * and no sentence: nothing failed, and the step is simply one the reader chose
 * not to run. That is exactly what `sweepStopped` (src/store/jobs-fs.ts)
 * writes for a step whose process went away, so this is mechanisms agreeing
 * rather than a new rule.
 *
 * **Interrupted — nobody asked.** `error`, carrying `INTERRUPTED.message` and
 * a `finishedAt`, exactly as `runStep` records a step that threw. The first
 * version of this settled *both* endings to `pending`, on the argument that
 * `StepRow` renders `step.error` in full so a copy of the job's sentence would
 * print the same paragraph twice. **That was wrong about the built UI**:
 * `JobCard` (src/web/AddArticle.tsx) renders `step.error` and the shared poll
 * error and never `job.error` at all — so an expired job showed a muted
 * `pending` step and a Retry button with nothing anywhere saying why. Silent
 * success with the reader as the thing that fails quietly. GPT Sol, 2026-09-01,
 * finding 2; `tests/interrupted-job-card.test.tsx` is what holds it.
 *
 * `cancelled` is an SQL predicate rather than a boolean because
 * `settleExpired` does not know which ending it is choosing until the row is
 * read — it is `jobs.cancelling`, evaluated per row inside the same statement.
 *
 * One correlated subquery rather than a read-then-write, so this file keeps its
 * rule that every transition is a single conditional statement. `jobs.steps` on
 * the right-hand side of a `SET` is the row as it was before the update.
 */
function settledSteps(cancelled: SQL) {
  return sql`(
    select coalesce(
      jsonb_agg(
        case
          when step.value->>'status' <> 'running' then step.value
          when ${cancelled}
            then (step.value - 'startedAt') || '{"status":"pending"}'::jsonb
          else step.value || jsonb_build_object(
                 'status', 'error',
                 'error', ${INTERRUPTED.message}::text,
                 /* ISO 8601 with milliseconds and a literal Z. JobStep's
                    finishedAt is a string the browser parses, and every other
                    writer of it is new Date().toISOString(); casting the
                    timestamptz straight to jsonb would render +00:00 and a
                    space, a different string for the same instant. */
                 'finishedAt', to_char(
                   clock_timestamp() at time zone 'utc',
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        end
        order by step.ordinality
      ),
      '[]'::jsonb
    )
    from jsonb_array_elements(${jobs.steps}) with ordinality as step(value, ordinality)
  )`;
}

/**
 * Run a transition of this file's own, and **give the quota slot back if it
 * ended the job**.
 *
 * `finish` and `releaseStep` are the sixth and seventh places a job can become
 * terminal, and until 2026-09-03 they were the two that settled nothing — so a
 * job ended through either of them left its reservation `in_flight` for ever,
 * and `forget`/`trimFinished` could then delete the row carrying the only record
 * of which slot it was. There is no caller in `src/` that takes this route, but
 * it is the advertised `JobStore` API and the stage claimed every terminal
 * transition settles. GPT Sol, 2026-09-03,
 * docs/plans/260902i-settlement-code-review-sol.md finding 1.
 *
 * **Here and not in `finishIn`/`releaseStepIn`.** Those two are shared with
 * `settleIn` (src/store/pg-session.ts), which calls them inside the publication
 * transaction and settles for itself immediately afterwards — with the charge,
 * on the one path that may charge. Settling inside the primitives would make
 * every one of those a double settlement.
 *
 * **It releases and never charges, including for a `done`.** This path moves the
 * job row and nothing else: no publication, no revision, nothing the reader
 * receives. Charging for that would be a debit for an article nobody got, and
 * the only transition entitled to charge is the one that publishes in the same
 * transaction.
 *
 * The status is read off the row the statement returned rather than predicted
 * from the method's name: `releaseStepIn` answers `cancelled` or `queued`
 * depending on a flag it reads for itself, and only one of those is an ending.
 */
async function settlingIfTerminal(transition: (tx: Tx) => Promise<Job>): Promise<Job> {
  /* Pinned rather than inherited, for the reason `settleExpired` below gives. */
  return await getDb().transaction(
    async (tx) => {
      const after = await transition(tx);
      if (!(TERMINAL as readonly string[]).includes(after.status)) return after;
      /* Off the row this transaction has just written and still holds, the same
         read `settleIn` does and for the same reason: `Job` deliberately does
         not carry the ledger id, and widening it to would push a Postgres-only
         column through an interface the filesystem store shares. */
      const [row] = await tx
        .select({ ingestEventId: jobs.ingestEventId })
        .from(jobs)
        .where(eq(jobs.id, after.id))
        .limit(1);
      await settleReservation(tx, row?.ingestEventId ?? null, RELEASED);
      return after;
    },
    READ_COMMITTED,
  );
}

/**
 * The store itself, **not exported** — see `pgJobStore` at the foot of this file.
 *
 * Private so that there is no unguarded spelling of it for anybody to import by
 * accident. src/store/db-errors.ts argues at length that a guard you have to
 * remember to apply is a guard that will be missing somewhere, and on
 * 2026-08-27 this file proved it: `src/jobs.ts` selected the raw store, a failed
 * `list()` put Drizzle's whole query **and its bound parameters** into
 * `Error.message`, and the homepage rendered it in red under the Add box.
 */
const rawPgJobStore: JobStore = {
  async list(owner: OwnerId): Promise<Job[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(jobs)
      .where(eq(jobs.ownerId, owner))
      .orderBy(desc(jobs.createdAt), desc(jobs.id));
    return rows.map(toJob);
  },

  async get(id: string, owner: OwnerId): Promise<Job | undefined> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.ownerId, owner)))
      .limit(1);
    return row ? toJob(row) : undefined;
  },

  /**
   * One insert, and the indexes are the arbitration.
   *
   * `on conflict do nothing` over all four of them, then a read that says which
   * of three things is in the way — see `EnqueueOutcome`, and `tryEnqueue` for
   * why the classification is a re-read rather than the constraint name.
   */
  async enqueueOrGet(job: Job, ticket: EnqueueTicket): Promise<EnqueueOutcome> {
    /**
     * **Two statements, so the second can find nothing — retry rather than
     * throw.**
     *
     * The insert conflicts, then a select asks who holds it. Between the two,
     * that holder can finish perfectly normally, at which point it is no longer
     * active, the select comes up empty, and the first version of this threw —
     * turning an ordinary finish into a 500 on somebody else's request. GPT
     * Sol, reviewing the built queue.
     *
     * Retrying the insert is the whole fix: the way is clear now, so the second
     * attempt succeeds. Bounded, because a caller that loses this race twice in
     * a row against different holders is in a situation the loop cannot improve.
     *
     * **The same loop now carries a second reason to go round**, and it is the
     * one that has to be counted separately: `holderLeftTheQueue` says the
     * article lookup this pass refused on was taken before nothing was locked,
     * and the repair is one fresh pass through the *article-first* lock order —
     * `restartRatherThanRefuse` for why re-reading the article in place would be
     * a deadlock rather than a fix. `look` is that count, and it only ever moves
     * forwards, so a request cannot spend the whole budget asking the same
     * question.
     *
     * **Nothing is re-spent by going round.** The job's id and its quota
     * reservation are both minted outside this method — `mintId` in the caller's
     * own loop and `withIngestSlot` (src/billing/admission.ts) around the whole
     * request — and a pass that returns a `Restart` has written nothing, so
     * there is no row for `releaseReservation` to see and no second id to leak.
     */
    let look: Look = "first";
    for (let attempt = 0; ; attempt++) {
      const result = await tryEnqueue(job, ticket, look);
      if (!isRestart(result)) return result;
      if (result === "holderLeftTheQueue") look = "again";
      if (attempt >= 3) {
        throw new Error(`Could not enqueue job ${job.id} for ${job.slug}, and nothing holds it.`);
      }
    }
  },

  /**
   * **The one place the global cap is enforced, and it is a lock rather than an
   * index.**
   *
   * It used to be neither: `jobs_only_one_running`, a unique index on the
   * constant `(true)`, raised `23505` on the second claim and that was the whole
   * mechanism. A unique index cannot express *at most N*, so with N configurable
   * the index has gone (drizzle/0032_jobs_concurrency_cap.sql) and this is what
   * replaced it.
   *
   *     begin
   *       select 1 from queue_state where id = 1 for update   -- serialise claimants
   *       select count(*) from jobs where status = 'running'  -- exact, inside the lock
   *       update jobs set status = 'running' … where id = $id and status = 'queued'
   *     commit
   *
   * **The count and the `UPDATE` are separate statements and that is still
   * exact.** Under READ COMMITTED a bare count would be a guess — two claimants
   * could each see `N-1` and both proceed — but no other claimant can be between
   * them, because every transition into `running` takes the singleton lock
   * first. A concurrent *finish* can only lower the count, so the worst this
   * produces is a conservative `busy`, never an N+1st runner.
   *
   * **`queue_state` finally does the job its own comment has always described.**
   * src/db/schema.ts said "claiming locks it FOR UPDATE before choosing a job"
   * from the day it was written, and until 2026-08-30 nothing in this repo
   * locked it or read it — the table was seeded, protected by a delete trigger,
   * and inert. The trigger matters here: locking zero rows succeeds silently, so
   * a missing row would mean every claimant believes it holds the queue.
   *
   * **The transaction is the cost.** This method used to be one statement on the
   * pool, which is why the `Executor` note above says a job transition is atomic
   * on its own. That is no longer true of *this* one, and a held transaction
   * occupies a connection out of `poolMax()` — see src/db/client.ts, where the
   * pool is deliberately small because the pooler's limit is shared across
   * instances.
   */
  async claim(
    id: string,
    owner: OwnerId,
    attempt: string,
    leaseMs: number,
    maxRunning: number,
  ): Promise<ClaimOutcome> {
    const db = getDb();
    return db.transaction(async (tx) => {
      /* **`NOWAIT`, because the contract says refuses and never waits.**
         A plain `for update` queues: every claimant that arrived while somebody
         else was deciding would sit holding a transaction and a connection out
         of a pool that is deliberately small (src/db/client.ts), and the browser
         starts a driver for *every* active job at once. Being told to come back
         is the same answer a moment sooner, and the client already backs off.
         GPT Sol, reviewing the built stage 1. */
      let locked;
      try {
        locked = await tx.execute(
          sql`select 1 from ${queueState} where ${queueState.id} = 1 for update nowait`,
        );
      } catch (err) {
        if (lockUnavailable(err)) return { kind: "busy", why: "another claim is being decided" };
        throw err;
      }

      /* **The row has to be there, and this is the one state that would not say
         so.** Locking zero rows succeeds silently, so a missing singleton means
         every claimant believes it holds the queue and the cap quietly stops
         existing — the failure this whole mechanism is here to prevent, arriving
         as success (docs/reusable/silent-success.md). The delete trigger in
         drizzle/0001 guards the ordinary way to lose it and not `TRUNCATE`, a
         disabled trigger, or a migration mistake. */
      if (locked.rowCount !== 1) {
        throw new Error(
          "The queue_state singleton is missing, so the job concurrency cap cannot be enforced. " +
            "See drizzle/0001_auth_fks_and_guards.sql.",
        );
      }

      /**
       * **The article's line is asked first, and the cap second.**
       *
       * Both refuse, so the order changes no outcome — only which *reason* the
       * refusal carries, and one of the two is a fact about this job while the
       * other is a fact about the machine. A job waiting behind an older job on
       * its own article is waiting for a reason that will still be true in a
       * minute; the cap is whatever the box happens to be doing this second.
       *
       * **Found by the cap answering for the line under load**, 2026-09-02: the
       * count is over every `running` row in the whole table, so six concurrent
       * test runs on one database made a parity case read *"already running N of
       * 100"* where the article rule was what actually held it — twice, and then
       * not at all when the box went quiet. A reason that depends on unrelated
       * traffic is a reason nobody can act on, and it made a real test into a
       * coin toss.
       *
       * **In the same lock as the cap, and exact for the same reason.** Every
       * transition into `running` takes the `queue_state` singleton first, so
       * no other claimant can be between this read and the `UPDATE` below; a
       * concurrent *finish* can only shorten the line, so the worst this
       * produces is a conservative `busy`.
       *
       * The reason says *article* because `busy` already means several things
       * to the client loop, and a log that cannot tell "waiting its turn on
       * this piece" from "the machine is full" makes them one symptom. There is
       * no queue position in it, and that is Greg's call: a waiting job shows
       * as waiting, in the card it already has.
       */
      if (await blockedByAnother(tx, id)) {
        return (
          (await refusalFor(tx, id, owner)) ?? {
            kind: "busy",
            why: "another job on this article is ahead of it",
          }
        );
      }

      /* **Only when this job is not already running.** Re-claiming a job that is
         already `running` must be reported as *another request is inside this
         job*, not as the cap. The `UPDATE` refuses it either way on
         `status = 'queued'`; this only keeps the *reason* right, and a log that
         cannot tell those apart makes them one symptom. */
      const [counted] = await tx
        .select({ running: sql<number>`count(*)::int` })
        .from(jobs)
        .where(and(eq(jobs.status, "running"), sql`${jobs.id} <> ${id}`));
      const running = counted?.running ?? 0;

      if (running >= maxRunning) {
        /* **Classify the job before blaming the cap** — `refusalFor` above says
           why, and the filesystem adapter classifies first for the same reason.
           **Not "N of N".** The cap can be lowered under jobs that are already
           running, so this really can read `already running 5 of 3` — which is a
           true account of a machine that is over its new limit and draining, and
           a rounder-sounding sentence would be a false one. */
        return (
          (await refusalFor(tx, id, owner)) ?? {
            kind: "busy",
            why: `already running ${running} of ${maxRunning} jobs`,
          }
        );
      }

      return claimIn(tx, id, owner, attempt, leaseMs);
    }, READ_COMMITTED);
  },


  /**
   * **Terminal only sometimes** — `releaseStepIn`'s own `case when cancelling`
   * decides — so the settlement follows the status the statement chose. See
   * `settlingIfTerminal`.
   */
  releaseStep(id: string, attempt: string, steps: JobStep[], outcome: StepOutcome): Promise<Job> {
    return settlingIfTerminal((tx) => releaseStepIn(tx, id, attempt, steps, outcome));
  },

  /** Always terminal, so this always settles. See `settlingIfTerminal`. */
  finish(id: string, attempt: string, ending: JobEnding): Promise<Job> {
    return settlingIfTerminal((tx) => finishIn(tx, id, attempt, ending));
  },

  /**
   * **Read the row under a lock, decide, and write — all in one transaction**,
   * which is what makes the four answers of `PauseOutcome` distinguishable at
   * all.
   *
   * The obvious shape is one fenced `UPDATE` and a fall-back on zero rows, and
   * it is wrong for the reason `PauseOutcome` gives: zero rows is four events,
   * and one of them is a reader's Stop that must not become an `error`. A
   * classifying `SELECT` *after* a refused `UPDATE` would answer about a row
   * that had moved in between. So the lock comes first and nothing can change
   * underneath the decision.
   *
   * **`for update` and then `liveAttempt` again on the write.** The re-fence is
   * not belt-and-braces: it is the one predicate this repo has now dropped from
   * a copy three times (src/store/job-fence.ts), and a transition written
   * without it is exactly what the module exists to make impossible. Under the
   * row lock it can only ever agree with the read.
   *
   * **The lease is asked with `leaseIsOver` itself**, imported rather than
   * written again — so the set this refuses on is exactly the set `liveAttempt`
   * refuses on and exactly the set `settleExpired` may settle, with no instant
   * in between. It is also the arm that answers for a NULL lease, which
   * `jobs_running_is_fenced` makes unreachable and which a hand-written `>`
   * would have quietly answered `unknown` to. `clock_timestamp()` rather than
   * `now()` is that module's rule and it matters here: the expression is
   * evaluated on the locked tuple, so a statement that waited for the lock sees
   * the time it actually got it.
   *
   * **No reservation is released and no draft is disposed of**, because the job
   * is not over: it is `queued`, on its own row, holding its slug, its article,
   * its checkpoints and its draft. That is the whole of the transition.
   */
  async pauseForDeadline(
    id: string,
    attempt: string,
    requeueBudget: number,
  ): Promise<PauseOutcome> {
    const db = getDb();
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          attemptId: jobs.attemptId,
          status: jobs.status,
          cancelling: jobs.cancelling,
          requeues: jobs.requeues,
          lapsed: leaseIsOver.mapWith(Boolean),
        })
        .from(jobs)
        .where(eq(jobs.id, id))
        /* **The lock, and the whole transition rests on it.** Without it this
           `SELECT` reads a snapshot under `read committed` and blocks nobody, so
           a Stop can land between the classification below and the `UPDATE` —
           which then tries to write `queued` onto a row carrying `cancelling`.
           Watched: `jobs_cancelling_is_running` refuses that, so the reader gets
           a `db-failed` 500 on a job they simply stopped, and the schema is the
           only thing standing between this and the wedge that constraint exists
           to make unreachable. The only case that can see it is the barrier one
           in tests/store-jobs-parity.test.ts; every sequential case stays green
           without the lock. No `.limit(1)`: `where id = …` is the primary key,
           so it bought nothing. */
        .for("update");

      /* The whole of `liveAttempt`, asked as four questions so the *reason* is
         available rather than only the refusal. A claimant here can write
         nothing at all, an ending included, so the caller reports a lost claim
         — see `PauseOutcome`. */
      if (!row || row.attemptId !== attempt || row.status !== "running" || row.lapsed) {
        return { kind: "stale" };
      }
      /* **Before the budget, always.** A reader's Stop is not a window that ran
         out, and a job that has spent its budget *and* been stopped is still a
         job that was stopped. */
      if (row.cancelling) return { kind: "cancelled" };
      /* The same comparison `settleExpired` makes — `requeues < budget` — so the
         two paths cannot disagree about what the number counts. At the default
         budget of zero this is the first thing that refuses, which keeps a
         caller that has not asked for a pause exactly where it was. */
      if (row.requeues >= requeueBudget) return { kind: "budget-spent" };

      const moved = await tx
        .update(jobs)
        .set({
          status: "queued",
          /* The *cancelled* shape of `settledSteps`, which is the same shape
             `settleExpired`'s requeue writes and the same shape `sweepStopped`
             has always written: the running step back to `pending` with its
             `startedAt` dropped and no sentence on it.

             **Derived from the row rather than taken from the caller**, and
             that is deliberate. The claimant's in-memory steps carry the
             *failure* narrative `runStep` records on the way out — `error`, and
             `INTERRUPTED`'s sentence — and writing those onto a job that is
             going back into the line would put a red step on a card that is
             waiting its turn. The row already holds every finished step, because
             `noteProgress` wrote them. */
          steps: settledSteps(sql`true`),
          attemptId: null,
          leaseExpiresAt: null,
          requeues: sql`${jobs.requeues} + 1`,
          /* Cleared, so the record always describes *this* state — the same rule
             the requeue in `settleExpired` follows, and for the same reason: a
             `failureKind` under a `queued` status is `jobWorthRetrying` reading
             a state that is not an ending. */
          error: null,
          failureKind: null,
          /* **`draftRevisionId` is deliberately not in this list**, and it is the
             one field that separates this statement from `settleExpired`'s
             requeue. See `PauseOutcome` in src/store/jobs.ts. */
        })
        .where(liveAttempt(id, attempt))
        .returning();

      /* **Nearly unreachable, and the residue is real** ⟨GPT Sol⟩: nothing else
         can move the row while this transaction holds it, but `liveAttempt`
         re-reads `clock_timestamp()`, so a lease that expires in the microseconds
         between the read and the write is refused here and is refused
         correctly. A refusal rather than a throw, because the honest answer for
         a fence that refused is that this claimant may not write — which is
         exactly what `stale` says. */
      if (!moved[0]) return { kind: "stale" };
      return { kind: "requeued", job: toJob(moved[0]) };
    }, READ_COMMITTED);
  },

  /**
   * **One statement decides which kind of ending each of these is** — the same
   * shape `requestCancel` has, and for the same reason.
   *
   * A row carrying `cancelling` is a reader who pressed Stop and whose claimant
   * then walked away without ever reading the flag. Failing it as
   * `INTERRUPTED` would tell that reader their own Stop was an interruption, so
   * it settles as `cancelled`, and the sentence and the kind that go with a
   * failure are **cleared** rather than left: a job that failed a step and was
   * then stopped would otherwise carry the old sentence under a `cancelled`
   * status. GPT Sol, 2026-09-01.
   *
   * **And it gives each settled job's quota slot back, in the same
   * transaction.** This is one of the two sites that end a job with *nobody
   * inside it* — the claimant is gone, so no session will ever run for these
   * rows and `settleIn` will never see them. Missing it leaks a slot every time
   * a reader closes the tab mid-ingest, and an unsettled reservation counts
   * against its owner for ever (there is deliberately no expiry:
   * src/db/schema.ts § `ingest_events`). The transaction is what the reservation
   * buys: it used to be a bare `UPDATE` on the pool.
   */
  async settleExpired(
    now?: Date,
    owner?: OwnerId,
    requeueBudget = 0,
  ): Promise<ExpirySettlement[]> {
    const db = getDb();
    /* Pinned rather than inherited, as src/store/pg-billing.ts and
       src/store/pg-session.ts both pin theirs: a `default_transaction_isolation`
       set on the role would otherwise change what two concurrent settlements of
       one reservation do — zero rows and a log at `read committed`, an
       uncaught 40001 that takes the whole sweep down above it. */
    return await db.transaction(async (tx) => {
      /**
       * **Which rows this sweep may touch at all**, written once so that the
       * requeue and the settlement below cannot disagree about it. A row either
       * gets another go or it is over; there must be no third state and no
       * instant in which it is neither, which is why both statements are in one
       * transaction and share this predicate exactly.
       */
      const lapsed = and(
        eq(jobs.status, "running"),
        /* **This reader's, when a reader is asking**, and the whole table when
           the advance path is. `listJobs` calls this from inside a request, so an
           unscoped sweep there would be one reader's page load ending another
           reader's import — the same predicate `list` itself is scoped by, in
           the statement rather than in a filter afterwards, so there is no moment
           at which the wrong row is locked. GPT Sol, 2026-09-01, answer 7. */
        owner === undefined ? undefined : eq(jobs.ownerId, owner),
        /* **Database time, unless a test says otherwise.** The lease is written
           by `claim` as `clock_timestamp() + leaseMs` on this same clock, so the
           deadline is one clock's arithmetic end to end. It used to be
           `Date.now()` at both ends, which is fine on a laptop and is a different
           clock from the one holding the row the moment there are two instances.

           **The exact expression the fence refuses on**, imported rather than
           written again: what `liveAttempt` will no longer let a claimant write
           to is precisely what this may settle, with no instant in between where
           a job is neither. That includes the NULL-lease row
           `jobs_running_is_fenced` makes impossible — see src/store/job-fence.ts
           for why *over* is the better answer for a state that cannot happen. */
        now === undefined
          ? leaseIsOver
          : or(isNull(jobs.leaseExpiresAt), lte(jobs.leaseExpiresAt, now)),
      );

      /**
       * **First, the jobs that get another go — back to `queued` on their own
       * row.**
       *
       * This is the Postgres answer to `sweepStopped` (src/store/jobs-fs.ts),
       * which has always turned a restart into a *pause* rather than an
       * abandoned ingest: running steps back to `pending`, the job back to
       * `queued`, the row otherwise untouched. Postgres had no equivalent, so on
       * the store we actually ship a deploy landing mid-ingest ended the job —
       * and the reader's only door out of that was a Retry that, until
       * 2026-09-03, minted a new article and threw away every chunk they had
       * paid for.
       *
       * **The same job id, which is the whole point.** The slug does not move, so
       * the article does not move, so the article's checkpoints
       * (src/store/checkpoints.ts) are still reachable — that is the property
       * this exists for, and a new job row could not have it.
       *
       * **Before the settlement below, not after.** These rows are `queued` by
       * the time the next statement runs, and that statement requires
       * `status = 'running'`, so nothing can be both. Ordering is the whole
       * arbitration; there is no second predicate to keep in step.
       *
       * **`cancelling` rows are excluded**, and would be even without the
       * budget: a reader who pressed Stop and whose claimant then walked away
       * must get their stop, not a resumption of the thing they stopped.
       *
       * **Skipped entirely at a zero budget**, which is the default, so a caller
       * that has not asked for this pays no round trip and sees exactly the
       * behaviour it saw before.
       */
      const requeued =
        requeueBudget <= 0
          ? []
          : await tx
              .update(jobs)
              .set({
                status: "queued",
                /* The *cancelled* shape of `settledSteps`: the running step back
                   to `pending` with its `startedAt` dropped and no sentence on
                   it. Nothing failed — the job is going back into the line — and
                   this is exactly what `sweepStopped` writes for a step whose
                   process went away, so the two mechanisms agree rather than
                   inventing a third answer. */
                steps: settledSteps(sql`true`),
                attemptId: null,
                leaseExpiresAt: null,
                requeues: sql`${jobs.requeues} + 1`,
                /* **`draft_revision_id` is deliberately *not* in this set** —
                 * this note documents a field that is absent, so it is a plain
                 * comment rather than the doc of whatever happens to follow it.
                 * The requeue keeps the draft, exactly as `pauseForDeadline`
                 * does, and it is the one field separating this statement from
                 * the settlement below.
                 *
                 * It used to be cleared here, on the argument that a draft
                 * written by a process that vanished mid-step holds "whatever
                 * that process had got to", and that dropping it "costs nothing
                 * the reader can feel" because the checkpoints are keyed on the
                 * article rather than on the revision. **The second half of that
                 * was wrong, and the first is no longer true.** ⟨GPT Sol,
                 * reviewing the built stage 3 of
                 * docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md,
                 * finding 1⟩
                 *
                 * **What it actually cost.** On a *first* ingest there is no
                 * published revision to copy blocks from, so a fresh draft makes
                 * `blocks` re-run as a genuine first ingest and mint every block
                 * id afresh (src/ids.ts). Those ids are inside the `hierarchy`
                 * structure request, so its fingerprint moves and the
                 * checkpoint the previous window paid for — ~508 s and about $2
                 * on a 142-page paper — becomes unreachable for ever. Keyed on
                 * the article is not the same as reachable from it. So a job
                 * that paused cleanly and was then deployed over spent its
                 * second window buying the tree again, and had one left for a
                 * step measured at 658–778 s against a 740 s deadline: the exact
                 * Retry click that plan exists to remove.
                 *
                 * **Why the half-written worry has gone.** It predates the
                 * transactional stage runner. Artefacts, the postcondition, the
                 * step completion, the publication and the job transition now
                 * commit **together or not at all** (src/store/pg-session.ts),
                 * and the model call is outside that transaction — so a claimant
                 * killed mid-step leaves either a wholly finished step or no
                 * trace of one. The step it was inside stays honestly `running`,
                 * which `beginStepRun` explicitly allows *a different attempt*
                 * to reopen (src/store/pg-revisions.ts § `setWhere`), and a
                 * swept claimant that keeps going is refused by
                 * `requireLiveJobOwnsDraft` because this statement has already
                 * cleared its token. Decision 8 of
                 * docs/plans/260831b-finish-the-database-move.md was deferred
                 * against a store that could leave a draft half-written; this
                 * one cannot.
                 *
                 * **The settlement below still clears it, and must.**
                 * `sweepAbandonedDrafts` spares a revision that *any* job row
                 * names, so a *terminal* job holding a pointer is a draft
                 * nothing will ever publish and nothing will ever reclaim. The
                 * two field sets are no longer identical, which is the pair most
                 * likely to drift — so the difference is stated here and in the
                 * comment on the settlement's own `draftRevisionId`, and
                 * tests/claim-session-postgres.test.ts asserts both directions.
                 */
                /* Cleared, so the record always describes *this* state. A job
                   that failed a step, was requeued and is now waiting its turn
                   must not sit in the queue wearing the last attempt's sentence.
                   `jobWorthRetrying` reads `failureKind` and a stale one under a
                   `queued` status is a card saying something that did not
                   happen. */
                error: null,
                failureKind: null,
              })
              .where(and(lapsed, not(jobs.cancelling), lt(jobs.requeues, requeueBudget)))
              .returning({ id: jobs.id, status: jobs.status });

      const settled = await tx
        .update(jobs)
        .set({
          status: sql`case when ${jobs.cancelling} then 'cancelled' else 'error' end`,
          /* The same `case` the status is chosen by, so the step's ending and the
             job's cannot disagree: `pending` and silent for a Stop, `error` and
             INTERRUPTED for an interruption nobody asked for. */
          steps: settledSteps(sql`${jobs.cancelling}`),
          attemptId: null,
          leaseExpiresAt: null,
          cancelling: false,
          finishedAt: sql`now()`,
          /* **The draft goes with the claim, and a terminal job may not keep a
             pointer.** `sweepAbandonedDrafts` spares a revision that *any* job
             row names, terminal ones included — so a job settled here while
             holding a pointer is a draft nothing will ever publish and nothing
             will ever reclaim. The path is ordinary rather than exotic: a step
             releases, the next advance never comes, the lease lapses, and this
             statement is what ends the job. GPT Sol, 2026-08-30,
             docs/plans/260827aa-delete-the-importer-d1b-sol.md finding 1.

             **And this is the one field the requeue above deliberately does
             not write.** The two statements were kept identical on purpose
             until 2026-09-04; they are not any more, because a row going back
             into the queue is not terminal and its draft is what the next
             window resumes on. Read the long note above before making them
             agree again. */
          draftRevisionId: null,
          /* Nulled on the cancelled branch rather than left alone, so the field
             always describes *this* ending — the same rule `finishIn` follows.
             A stale sentence under a `cancelled` status is a job telling the
             reader something that did not happen. */
          error: sql`case when ${jobs.cancelling} then null else ${INTERRUPTED.message}::text end`,
          /* `retry`, said out loud rather than left to the absent-means-yes rule.
             Both offer the button; only one of them says why, and a kind that is
             merely missing is indistinguishable from a failure nobody classified.
             An interrupted job really is worth another go — `stepIsDone` derives
             what is finished from the artefacts, so a retry resumes. */
          failureKind: sql`case when ${jobs.cancelling} then null else ${INTERRUPTED.kind}::text end`,
        })
        /* **What the statement above left behind**, and nothing else: a row it
           requeued is `queued` by now and this requires `running`. So the two
           partition the lapsed set between them, in one transaction, with the
           order doing the arbitration. */
        .where(lapsed)
        .returning({ id: jobs.id, status: jobs.status, ingestEventId: jobs.ingestEventId });

      /* **One statement over the whole set**, and it used to be one per settled
         job. The loop held every ended job's row lock — taken by the `UPDATE`
         above and held to commit — across N sequential settlements, and the
         comment that justified it said the sweep runs over "usually none,
         occasionally one". That was not a property of the code: this is capped
         by how many jobs can be `running` at once, which is
         `SPIDERYARN_JOB_CONCURRENCY` and takes any positive integer. GPT Sol,
         2026-09-03, finding 5.

         `releaseReservations` (src/store/pg-billing.ts) is still the only place
         the rule about a release that moved nothing is written down —
         `settleReservation`'s tolerant half delegates to it — so there is no
         second copy of it here. Nulls are dropped there too, which is most jobs:
         only a new ingest carries a reservation. */
      await releaseReservations(
        tx,
        settled.map((row) => row.ingestEventId),
      );

      /* What the statements already return, and both fields of theirs.
         `RETURNING` hands back the row *after* the update, so the status here is
         the ending the `case` chose — or `queued`, for the rows that got another
         go — rather than the one it started from.

         **The requeued rows are in the answer**, and they have to be: the caller
         logs this as the only account there is of a claimant that stopped
         answering, and a sweep that resumed somebody's import while reporting
         nothing would be exactly the silent success this file's neighbours are
         written against. `listJobs` also re-reads only when this is non-empty. */
      return [...requeued, ...settled].map((row) => ({
        id: row.id,
        status: row.status as ExpirySettlement["status"],
      }));
    }, READ_COMMITTED);
  },

  async noteProgress(id: string, attempt: string, steps: JobStep[]): Promise<Job> {
    const db = getDb();
    /* `steps` and nothing else — not the status, and **not the lease**. See the
       contract: renewing here would turn the lease into a heartbeat, and the
       claimant's own deadline has to be the thing that fires first. */
    const moved = await db.update(jobs).set({ steps }).where(fence(id, attempt)).returning();
    if (!moved[0]) throw new StaleAttemptError(id);
    return toJob(moved[0]);
  },

  async requestCancel(id: string, owner: OwnerId): Promise<Job | undefined> {
    const db = getDb();
    /**
     * **One statement that decides which kind of cancel this is**, rather than
     * a look followed by an act.
     *
     * It was two calls until 2026-08-27 — `cancelIdle`, and then `requestCancel`
     * if that found nobody — and GPT Sol found the gap between them. A claimant
     * that releases in that gap turns a `running` job into a `queued` one, the
     * second call then writes `cancelling` onto it, and nothing ever moves it
     * on: `claim` refuses a job with the flag set, so every advance answers
     * `stopping` for ever while the reader's Stop button is already disabled.
     *
     * A `case` inside one `UPDATE` cannot have a gap. Queued means over, right
     * now; running with a live lease means ask the claimant, because cancelling
     * it out from under one would leave that claimant writing artefacts for a
     * job the reader has been told is finished.
     *
     * **Running with a lease that has lapsed means over, right now, too**, and
     * that third branch is what makes Stop mean what it says. The claimant sets
     * its own deadline *inside* the lease and aborts itself (src/jobs.ts §
     * `LEASE_MS`), so a lapsed lease says the process is gone rather than slow:
     * there is provably nobody to read a flag. Without this branch, Stop on a
     * dead claimant showed a disabled "Stopping…" for up to 12.67 minutes and
     * then reported the job **interrupted**, which is not what the reader did.
     *
     * There is deliberately no force-stop short of the lease. A live claim may
     * genuinely be working, and clearing it is how two writers get one article.
     *
     * Not fenced: the reader pressing Stop is not a claimant, and a Stop that
     * needed the running attempt's token could only be pressed by the process
     * it is meant to interrupt.
     *
     * **The two branches that end the job give the quota slot back**, in the
     * transaction the `UPDATE` now runs in. This is the second of the two sites
     * where a job ends with nobody inside it, and it is the everyday one: Stop
     * on a job no claimant has picked up yet. Without it a reader who changes
     * their mind twice has spent two of three lifetime ingests on nothing. The
     * **asking** branch releases nothing, because it has not ended anything —
     * the claimant is still inside the job and `settleIn` is what will settle
     * it.
     */
    /* **The two branches that end the job, as one condition.** They settle
       identically, and writing the condition once is what stops the seven
       `case`s below drifting apart — which is the shape of the bug the lapsed
       branch was added to fix.

       **No `coalesce` any more, and its going is a decision.** It used to be
       `coalesce(…, false)`, to answer for a `running` row with a NULL lease —
       a state `jobs_running_is_fenced` makes impossible. But *false* there
       means "ask the claimant", and there is no claimant: the row would sit
       disabled at "Stopping…" for ever, because neither this nor the sweep
       could ever move it. `leaseIsOver` answers *over* for a missing lease, so
       the expression is never NULL and a corrupt row is recoverable by the
       machinery that already exists. GPT Sol raised it, 2026-09-01;
       src/store/job-fence.ts carries the reasoning. */
    const over = sql`(${jobs.status} = 'queued' or ${leaseIsOver})`;
    /* Pinned rather than inherited, for the reason `settleExpired` above gives. */
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(jobs)
        .set({
          status: sql`case when ${over} then 'cancelled' else ${jobs.status} end`,
          /* Every step is settled on the branches that end the job, so a stopped
             job never keeps a spinner. On the *asking* branch the steps are the
             claimant's to write and this leaves them alone. */
          /* **`pending`, always, on this path.** Every branch that ends a job
             here ends it as *cancelled* — the reader asked — so the step gets no
             sentence. `settleExpired` is the path that can also end a job nobody
             asked to stop, and there the step ends `error`. */
          steps: sql`case when ${over} then ${settledSteps(sql`true`)} else ${jobs.steps} end`,
          cancelling: sql`not ${over}`,
          attemptId: sql`case when ${over} then null else ${jobs.attemptId} end`,
          leaseExpiresAt: sql`case when ${over} then null else ${jobs.leaseExpiresAt} end`,
          /* **Only on the branches that end the job**, and that asymmetry is the
             whole of it. A queued job — or one whose claimant is provably gone —
             is terminal one statement later, and a terminal job holding a pointer
             is a draft `sweepAbandonedDrafts` spares for ever, since it treats any
             job's pointer as ownership. A *live* claimant's pointer belongs to the
             claimant that is still inside a step: taking it away here would leave
             its next fenced write refused for a reason nothing could explain, and
             it is the one that disposes of the draft when its release resolves to
             a cancellation (src/store/pg-session.ts, case 4). The pointer really
             can be set on a queued job: `releaseStepIn` leaves it alone
             deliberately, so the next request continues into the same draft.
             GPT Sol, 2026-08-30, docs/plans/260827aa-delete-the-importer-d1b-sol.md
             finding 1; Fable, 2026-09-01, on the lapsed branch needing the same
             field set rather than the running one's. */
          draftRevisionId: sql`case when ${over} then null else ${jobs.draftRevisionId} end`,
          /* Cleared, so a `cancelled` job never carries the sentence of a failure
             it recovered from. A job that failed a step, was retried and is then
             stopped would otherwise say why it failed under a status saying the
             reader stopped it. GPT Sol, 2026-09-01. */
          error: sql`case when ${over} then null else ${jobs.error} end`,
          failureKind: sql`case when ${over} then null else ${jobs.failureKind} end`,
          finishedAt: sql`case when ${over} then now() else ${jobs.finishedAt} end`,
        })
        .where(and(eq(jobs.id, id), eq(jobs.ownerId, owner), inArray(jobs.status, ACTIVE)))
        .returning();
      if (!row) return undefined;
      /* **The status the `case` chose, not the branch we hoped it took.**
         `RETURNING` hands back the row after the update, and `cancelled` is the
         only status either terminal branch can write — so this asks the one
         question that matters here, *did this statement end the job*, of the
         value the database actually settled on. The asking branch comes back
         `running` and releases nothing. */
      if (row.status === "cancelled") {
        await settleReservation(tx, row.ingestEventId, RELEASED);
      }
      return toJob(row);
    }, READ_COMMITTED);
  },

  async forget(id: string, owner: OwnerId): Promise<boolean> {
    const db = getDb();
    const gone = await db
      .delete(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.ownerId, owner), inArray(jobs.status, TERMINAL)))
      .returning({ id: jobs.id });
    return gone.length === 1;
  },

  /**
   * **The retention rule, written out here and cited from the filesystem
   * adapter** (src/store/jobs-fs.ts § `trimFinished`), which implements the
   * same thing in JavaScript. It used to be spelled out at length on both
   * sides, and that is how they drifted.
   *
   * Rank each terminal job **within its own kind** — `done` on one side,
   * everything that is not a success on the other — most recently finished
   * first. Then fill the `keep` slots by alternating: the top-ranked
   * non-success, the top-ranked success, the next of each, and so on. Whichever
   * side runs out, the other takes the rest. Everything past `keep` goes.
   *
   * **Ordered by what to KEEP**, and everything past the offset is deleted.
   *
   * `order by rank, is_done` is what does the alternating: `false` sorts before
   * `true` in Postgres, so a tie of rank goes to the non-success. That is what
   * survives of the old preference — a reader who loses a failure loses the
   * only account of what went wrong, so where the two kinds compete for one
   * slot the failure still takes it.
   *
   * **Why `finished_at` and not `created_at`.** `created_at` is when a job was
   * *queued*; jobs run several at a time (src/jobs.ts §
   * `DEFAULT_JOB_CONCURRENCY`) and take wildly different times, so a job queued
   * before several others routinely ends after all of them. Ranked by queue
   * time such a job can sit well down its kind and be swept **by its own
   * ending** — `noteEnded` trims immediately after every finish (src/jobs.ts).
   * Ranked by finish time it is rank 1 of its kind, because nothing has ended
   * since. `nulls last` puts a legacy or malformed terminal row at the back of
   * its kind, which is the conservative answer; every terminal transition on
   * both adapters stamps the column.
   *
   * **What depends on this.** The client learns a job finished by polling for a
   * terminal row (`recordCompletions`, src/web/jobEngine.ts) — so the
   * newest-finished job of each kind has to survive its own sweep. Until
   * 2026-09-03 the preference for failures was absolute rather than
   * interleaved, so an owner holding `KEEP_FINISHED` failures had every success
   * deleted in the same call that marked it done, and no completion was ever
   * announced, for any mode:
   * docs/postmortems/260903e-successes-deleted-before-failures-so-no-job-is-ever-announced-done.md.
   * The trade that bought it — an owner with both kinds in abundance now keeps
   * 25 of each rather than 50 failures — is argued in
   * docs/plans/260903h-keep-a-fresh-success-out-of-the-retention-sweep.md.
   *
   * `id` is the last key because neither timestamp is a total order, and
   * without it the two adapters answer from different accidents.
   *
   * **No lock.** Two endings each trimming this one owner see a consistent
   * snapshot, and overlapping deletes only make one of the returned counts
   * smaller — which nothing in production reads, `noteEnded` discards it.
   */
  async trimFinished(owner: OwnerId, keep: number): Promise<number> {
    const db = getDb();
    const ranked = db
      .select({
        id: jobs.id,
        isDone: sql<boolean>`(${jobs.status} = 'done')`.as("is_done"),
        rank: sql<number>`row_number() over (
             partition by (${jobs.status} = 'done')
             order by ${jobs.finishedAt} desc nulls last, ${jobs.createdAt} desc, ${jobs.id} desc)`.as(
          "rank",
        ),
      })
      .from(jobs)
      .where(and(eq(jobs.ownerId, owner), inArray(jobs.status, TERMINAL)))
      .as("ranked");
    const doomed = db
      .select({ id: ranked.id })
      .from(ranked)
      .orderBy(ranked.rank, ranked.isDone)
      .offset(keep);
    const gone = await db
      .delete(jobs)
      .where(inArray(jobs.id, doomed))
      .returning({ id: jobs.id });
    return gone.length;
  },
};

/* ------------------------------------- the two settlements, on an executor -- */

/**
 * **`releaseStepIn` and `finishIn` are outside `guardDbStore`, and that is the
 * one thing to know before calling either of them.**
 *
 * A raw Drizzle error carries the query text *and its bound parameters* in
 * `Error.message`, and on 2026-08-27 one of them rendered in red on the
 * homepage under the Add box, because `src/jobs.ts` had selected the unguarded
 * store (see the comment on `rawPgJobStore`). `guardDbStore` scrubs that, and it
 * wraps **own enumerable function-valued properties of an object** — so a free
 * function exported from a module is not covered by it and cannot be.
 *
 * These are exported anyway, because the transactional store session
 * (docs/plans/260827aa-delete-the-importer.md § D1b) has to settle the job inside the
 * *artefact* transaction, and a method that calls `getDb()` for itself binds to
 * nothing. Injecting the public `JobSettles` capability was the design the
 * review rejected for exactly that reason.
 *
 * **So the scrubbing has to be re-provided by the caller, and here is where:**
 * the session constructs its returned object through `guardDbStore`, the same
 * way `pgJobStore` does at the foot of this file. Anything else calling these
 * two directly is unprotected and must not be on a request path. Nothing in
 * this file's own callers loses anything — `rawPgJobStore.releaseStep` and
 * `.finish` still go through the wrapper, because the wrapper is applied to the
 * store object and not to the statement.
 */

/**
 * Hand the job back to the queue with this step's outcome recorded — or, if a
 * Stop landed while the step ran, end it as cancelled.
 */
export async function releaseStepIn(
  exec: Executor,
  id: string,
  attempt: string,
  steps: JobStep[],
  outcome: StepOutcome,
): Promise<Job> {
  const moved = await exec
    .update(jobs)
    .set({
      /* **Back to `queued`, and the token cleared.** A claim must never outlive
         its claimant — holding it across requests would mean the next advance,
         a different request with a different token, is told `busy` until the
         lease expires, which is the endpoint deadlocking itself on the happy
         path. GPT Sol, 2026-08-27. (This said *"one claim covers one step"*,
         which stopped being true on 2026-08-30: a claim walks a whole job, and
         this is the hand-back it takes *between* two of them.) */
      /* **Back to `queued`, and the token cleared** — unless Stop arrived while
         this step was running, in which case the release is where the cancel
         lands. Releasing to `queued` with `cancelling` still set is a state
         nothing moves on: the next claim reads the flag, answers `stopping`,
         and does so for ever. GPT Sol found it from the cross-instance end —
         instance B presses Stop on a job instance A is inside — and there is
         a same-instance version of it too. Deciding here, in the statement
         that already knows, is what closes both. */
      status: sql`case when ${jobs.cancelling} then 'cancelled' else 'queued' end`,
      cancelling: false,
      finishedAt: sql`case when ${jobs.cancelling} then now() else ${jobs.finishedAt} end`,
      attemptId: null,
      leaseExpiresAt: null,
      steps,
      ...(outcome.title !== undefined && { title: outcome.title }),
    })
    .where(fence(id, attempt))
    .returning();
  if (!moved[0]) throw new StaleAttemptError(id);
  /* The **actual** settlement, not the one that was asked for: the `case`
     above may have answered `cancelled`, and a caller that assumed `queued`
     because it called "release" would report the wrong thing to the reader.
     GPT Sol, 2026-08-29, docs/plans/260827aa-delete-the-importer-d1b-design-sol.md
     finding 1 — which is why this returns the row rather than `void`, and
     always did. */
  return toJob(moved[0]);
}

/**
 * End the job, for good.
 *
 * **A Stop that arrives during the *last* step does not un-finish the job, and
 * that asymmetry with `releaseStepIn` is deliberate.**
 *
 * GPT Sol flagged that `releaseStep` settles a cancellation and this does not.
 * It is a real difference and it is the right one. `releaseStep` runs when there
 * is work left: the reader asked for it to stop, and it stops. This runs when
 * there is none — the last step succeeded, the artefacts are written and the
 * article is on the shelf. Calling that `cancelled` would be a lie about a thing
 * the reader can see, and it would put a Retry button on a job with nothing left
 * to do.
 *
 * So the flag is cleared and the ending stands. Written down here because the
 * two functions reading the same column and answering differently is exactly
 * what a later reader would take for a bug.
 */
export async function finishIn(
  exec: Executor,
  id: string,
  attempt: string,
  ending: JobEnding,
): Promise<Job> {
  const moved = await exec
    .update(jobs)
    .set({
      status: ending.status,
      steps: ending.steps,
      attemptId: null,
      leaseExpiresAt: null,
      cancelling: false,
      /* Database time, as `releaseStepIn` and `requestCancel` already use — one
         clock stamps every one of a job's timestamps, so two endings written by
         two instances can still be ordered against each other. */
      finishedAt: sql`now()`,
      error: ending.error ?? null,
      /* Deleted rather than left alone when there is no kind, so the field
         always describes *this* failure. A stale kind hides a button rather
         than merely being untidy. */
      failureKind: ending.failureKind ?? null,
      ...(ending.title !== undefined && { title: ending.title }),
    })
    .where(fence(id, attempt))
    .returning();
  if (!moved[0]) throw new StaleAttemptError(id);
  return toJob(moved[0]);
}

/**
 * **The fence, in one place so that no transition can be written without it.**
 *
 * All four conditions, and it is `src/store/job-fence.ts` rather than a local
 * `and(...)` because the draft and publication fences in
 * src/store/pg-revisions.ts are the same question asked in another file, and
 * this repo has now dropped a condition from one copy of it three times: first
 * `status = 'running'` (twice), then the lease. See that file for the whole
 * argument.
 */
function fence(id: string, attempt: string) {
  return liveAttempt(id, attempt);
}

/**
 * The job store, with nothing a database said able to leave it.
 *
 * Wrapped **here** rather than at the selection in src/jobs.ts, which is where
 * it was missing. A selection site is a place to forget; an export is not, and
 * every consumer of this module now gets the guarded object whether or not they
 * have read any of this.
 *
 * Why this file cannot ask src/store/index.ts to do it, the way the reader's
 * stores do: index.ts imports fs.ts, which imports src/pipeline.ts, which
 * imports src/jobs.ts, which imports this. `npm run check` gates on cycles, so
 * that is a red build rather than a note — the reason src/jobs.ts selected its
 * own store in the first place. Guarding at the export satisfies both.
 *
 * **`claim` is unaffected, and that ordering is the point.** It catches its own
 * `23505` and asks `violatesConstraint` about the constraint *name* inside the
 * method, so the classification happens before the promise ever reaches this
 * wrapper. Had it been written to let the error escape and be classified by the
 * caller, this line would have silently turned every `jobs_only_one_running`
 * into a 500. GPT Sol checked that ordering, 2026-08-27; it is worth re-checking
 * before moving any error handling out of a store method.
 *
 * `StaleAttemptError` crosses this boundary intact, by name, on the allowlist in
 * db-errors.ts — src/jobs.ts answers *busy* on `instanceof` and a scrubbed copy
 * would have become a 500 under contention only.
 */
export const pgJobStore: JobStore = guardDbStore("jobs", rawPgJobStore);
