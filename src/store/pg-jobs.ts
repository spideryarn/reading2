/**
 * Ingest jobs in Postgres — the record both invocations can see, and the fence
 * that stops the wrong one writing.
 *
 * ## Every transition is one conditional statement
 *
 * There is no read-then-write anywhere in this file, including where the
 * filesystem adapter has to read first. The precondition lives in the `WHERE`,
 * so the database decides rather than the order two requests happened to
 * arrive in, and a loser learns it lost instead of overwriting a winner.
 *
 * ## The fence is three conditions and this project has dropped one twice
 *
 *     where id = $id and attempt_id = $attempt and status = 'running'
 *
 * The third is not decoration. The schema lets a terminal row keep its token,
 * so `id` + `attempt_id` alone means a job already marked `error` by
 * `failExpired` would accept its own former claimant's write and report one row
 * affected — success, reported, with the wrong output. Zero rows throws
 * `StaleAttemptError` rather than returning quietly, because
 * zero-rows-reads-as-success is the failure this whole mechanism exists to
 * prevent (docs/reusable/silent-success.md).
 *
 * ## `23505` is an answer, not an error
 *
 * Two of the partial unique indexes in src/db/schema.ts are load-bearing here
 * and both surface as a unique violation rather than as zero rows:
 * `jobs_only_one_running` gives global concurrency 1, and `jobs_active_slug`
 * makes "one job in flight per article" a fact rather than a convention. Both
 * are caught by name and turned into ordinary outcomes — `busy` and
 * "somebody already has this slug" — because an index doing its job is not an
 * exception.
 */

import { and, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { guardDbStore, violatesConstraint } from "./db-errors.js";
import { jobs } from "../db/schema.js";
import { INTERRUPTED } from "../messages.js";
import type { FailureKind } from "../messages.js";
import type { Job, JobStatus, JobStep, OwnerId } from "../types.js";
import {
  type ClaimOutcome,
  type JobEnding,
  type JobStore,
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
 * transition is one fenced `UPDATE`: it is atomic on its own, which is why
 * `rawPgJobStore` may keep passing the pool. It only needs a transaction when
 * something *else* — the artefacts and the publication — has to land with it.
 */
type Executor = Db | Tx;

/** The three statuses a job never leaves. */
const TERMINAL = ["done", "error", "cancelled"] as const;
const ACTIVE = ["queued", "running"] as const;

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
  };
}

/** One insert-or-look. `null` means the holder finished in between; ask again. */
async function tryEnqueue(
job: Job,
workKey: string,
): Promise<{ job: Job; created: boolean; sameWork: boolean } | null> {
  const db = getDb();
  const inserted = await db
    .insert(jobs)
    .values({
      id: job.id,
      ownerId: job.ownerId,
      slug: job.slug,
      steps: job.steps,
      status: job.status,
      workKey,
      createdAt: new Date(job.createdAt),
      url: job.url ?? null,
      title: job.title ?? null,
      profile: job.profile ?? null,
      uploadId: job.upload?.id ?? null,
      uploadFilename: job.upload?.filename ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return { job: toJob(inserted[0]), created: true, sameWork: true };

  const [held] = await db
    .select()
    .from(jobs)
    .where(
      and(eq(jobs.ownerId, job.ownerId), eq(jobs.slug, job.slug), inArray(jobs.status, ACTIVE)),
    )
    .limit(1);
  // The holder finished between the two statements. The caller asks again.
  if (!held) return null;
  return { job: toJob(held), created: false, sameWork: held.workKey === workKey };
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
   * One insert, and the index is the arbitration.
   *
   * `on conflict do nothing` over `jobs_active_slug` covers both cases the
   * caller cares about in one round trip: nothing came back means somebody
   * already holds this slug, and the read that follows says whether they are
   * doing the same work (hand that job back) or different work (the caller
   * moves to the next slug suffix).
   */
  async enqueueOrGet(
    job: Job,
    workKey: string,
  ): Promise<{ job: Job; created: boolean; sameWork: boolean }> {
    /**
     * **Two statements, so the second can find nothing — retry rather than
     * throw.**
     *
     * The insert conflicts on `jobs_active_slug`, then a select asks who holds
     * it. Between the two, that holder can finish perfectly normally, at which
     * point it is no longer active, the select comes up empty, and the first
     * version of this threw — turning an ordinary finish into a 500 on somebody
     * else's request. GPT Sol, reviewing the built queue.
     *
     * Retrying the insert is the whole fix: the slug is free now, so the second
     * attempt succeeds. Bounded, because a caller that loses this race twice in
     * a row against different holders is in a situation the loop cannot improve.
     */
    for (let attempt = 0; ; attempt++) {
      const result = await tryEnqueue(job, workKey);
      if (result) return result;
      if (attempt >= 3) {
        throw new Error(`Could not enqueue job ${job.id} for ${job.slug}, and nothing holds it.`);
      }
    }
  },

  async claim(
    id: string,
    owner: OwnerId,
    attempt: string,
    leaseMs: number,
  ): Promise<ClaimOutcome> {
    const db = getDb();
    let taken: Row[];
    try {
      taken = await db
        .update(jobs)
        .set({
          status: "running",
          attemptId: attempt,
          leaseExpiresAt: new Date(Date.now() + leaseMs),
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
      /* Another job holds the single running slot. Not an error: it is the
         index giving global concurrency 1, which is the guarantee
         docs/project/ingest-queue.md chose on purpose. The caller backs off. */
      if (violatesConstraint(err, "jobs_only_one_running")) {
        return { kind: "busy", why: "another job is running" };
      }
      throw err;
    }
    if (taken[0]) return { kind: "claimed", job: toJob(taken[0]) };

    /* Nothing moved, and the four reasons are four different things for the
       caller to do. Read once and say which — after the update, never before,
       since asking first would put a gap back in for the sake of a nicer
       message. */
    const current = await this.get(id, owner);
    if (!current) return { kind: "gone" };
    if (TERMINAL.includes(current.status as (typeof TERMINAL)[number])) {
      return { kind: "finished", job: current };
    }
    if (current.cancelling === true) return { kind: "stopping", job: current };
    return { kind: "busy", why: "another request is inside this job" };
  },

  releaseStep(id: string, attempt: string, steps: JobStep[], outcome: StepOutcome): Promise<Job> {
    return releaseStepIn(getDb(), id, attempt, steps, outcome);
  },

  finish(id: string, attempt: string, ending: JobEnding): Promise<Job> {
    return finishIn(getDb(), id, attempt, ending);
  },

  async failExpired(now: Date = new Date()): Promise<string[]> {
    const db = getDb();
    const failed = await db
      .update(jobs)
      .set({
        status: "error",
        attemptId: null,
        leaseExpiresAt: null,
        cancelling: false,
        finishedAt: new Date(),
        /* **The draft goes with the claim, and a terminal job may not keep a
           pointer.** `sweepAbandonedDrafts` spares a revision that *any* job
           row names, terminal ones included — so a job failed here while
           holding a pointer is a draft nothing will ever publish and nothing
           will ever reclaim. The path is ordinary rather than exotic: a step
           releases, the next advance never comes, the lease lapses, and this
           statement is what ends the job. GPT Sol, 2026-08-30,
           docs/plans/delete-the-importer-d1b-sol.md finding 1. */
        draftRevisionId: null,
        error: INTERRUPTED.message,
        /* `retry`, said out loud rather than left to the absent-means-yes rule.
           Both offer the button; only one of them says why, and a kind that is
           merely missing is indistinguishable from a failure nobody classified.
           An interrupted job really is worth another go — `stepIsDone` derives
           what is finished from the artefacts, so a retry resumes. */
        failureKind: INTERRUPTED.kind,
      })
      .where(
        and(
          eq(jobs.status, "running"),
          isNotNull(jobs.leaseExpiresAt),
          lt(jobs.leaseExpiresAt, now),
        ),
      )
      .returning({ id: jobs.id });
    /* The ids the statement already returns. It has selected them since the day
       it was written — only the count was being kept. */
    return failed.map((row) => row.id);
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

  async activeForSlug(slug: string, owner: OwnerId): Promise<Job | undefined> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.ownerId, owner), eq(jobs.slug, slug), inArray(jobs.status, ACTIVE)))
      .limit(1);
    return row ? toJob(row) : undefined;
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
     * now; running means ask the claimant, because cancelling it out from under
     * one would leave that claimant writing artefacts for a job the reader has
     * been told is finished.
     *
     * Not fenced: the reader pressing Stop is not a claimant, and a Stop that
     * needed the running attempt's token could only be pressed by the process
     * it is meant to interrupt.
     */
    const [row] = await db
      .update(jobs)
      .set({
        status: sql`case when ${jobs.status} = 'queued' then 'cancelled' else ${jobs.status} end`,
        cancelling: sql`${jobs.status} <> 'queued'`,
        attemptId: sql`case when ${jobs.status} = 'queued' then null else ${jobs.attemptId} end`,
        leaseExpiresAt: sql`case when ${jobs.status} = 'queued' then null else ${jobs.leaseExpiresAt} end`,
        /* **Only on the branch that ends the job**, and that asymmetry is the
           whole of it. A queued job is terminal one statement later, and a
           terminal job holding a pointer is a draft `sweepAbandonedDrafts`
           spares for ever — it treats any job's pointer as ownership. A
           *running* job's pointer belongs to the claimant that is still inside
           a step: taking it away here would leave that claimant's next fenced
           write refused for a reason nothing could explain, and the claimant is
           the one that disposes of the draft when its release resolves to a
           cancellation (src/store/pg-session.ts, case 4). The pointer really
           can be set on a queued job: `releaseStepIn` leaves it alone
           deliberately, so the next request continues into the same draft.
           GPT Sol, 2026-08-30, docs/plans/delete-the-importer-d1b-sol.md
           finding 1. */
        draftRevisionId: sql`case when ${jobs.status} = 'queued' then null else ${jobs.draftRevisionId} end`,
        finishedAt: sql`case when ${jobs.status} = 'queued' then now() else ${jobs.finishedAt} end`,
      })
      .where(and(eq(jobs.id, id), eq(jobs.ownerId, owner), inArray(jobs.status, ACTIVE)))
      .returning();
    return row ? toJob(row) : undefined;
  },

  async forget(id: string, owner: OwnerId): Promise<boolean> {
    const db = getDb();
    const gone = await db
      .delete(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.ownerId, owner), inArray(jobs.status, TERMINAL)))
      .returning({ id: jobs.id });
    return gone.length === 1;
  },

  async trimFinished(owner: OwnerId, keep: number): Promise<number> {
    const db = getDb();
    /* **Ordered by what to KEEP, then everything past `keep` is deleted** —
       which is the opposite way round from the filesystem adapter, where the
       list is ordered by what to drop and sliced from the front. Getting that
       inversion wrong is how the first version of this deleted the failures and
       kept old successes, and the parity test is what caught it: a reader who
       loses a failure loses the only account of what went wrong.
       So: failures first (`status = 'done'` is false for them, and false sorts
       first), then newest first within each group. `id` breaks the tie, because
       `created_at` alone is not a total order. */
    const doomed = db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.ownerId, owner), inArray(jobs.status, TERMINAL)))
      .orderBy(sql`(${jobs.status} = 'done')`, desc(jobs.createdAt), desc(jobs.id))
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
 * (docs/plans/delete-the-importer.md § D1b) has to settle the job inside the
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
      /* **Back to `queued`, and the token cleared.** One claim covers one
         step. Holding it across requests would mean the next advance — a
         different request with a different token — is told `busy` until the
         lease expires, which is the endpoint deadlocking itself on the happy
         path. GPT Sol, 2026-08-27. */
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
     GPT Sol, 2026-08-29, docs/plans/delete-the-importer-d1b-design-sol.md
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
      finishedAt: new Date(),
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
 * All three conditions, and `status = 'running'` is the one to watch: without
 * it a job already failed by `failExpired` accepts its own former claimant's
 * write and reports success. See the file header.
 */
function fence(id: string, attempt: string) {
  return and(eq(jobs.id, id), eq(jobs.attemptId, attempt), eq(jobs.status, "running"));
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
