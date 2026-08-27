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
import { violatesConstraint } from "./db-errors.js";
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
    ...(row.guidance !== null && { guidance: row.guidance }),
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
      guidance: job.guidance ?? null,
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

export const pgJobStore: JobStore = {
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

  async releaseStep(
    id: string,
    attempt: string,
    steps: JobStep[],
    outcome: StepOutcome,
  ): Promise<Job> {
    const db = getDb();
    const moved = await db
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
    return toJob(moved[0]);
  },

  async finish(id: string, attempt: string, ending: JobEnding): Promise<Job> {
    const db = getDb();
    const moved = await db
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
  },

  async failExpired(now: Date = new Date()): Promise<number> {
    const db = getDb();
    const failed = await db
      .update(jobs)
      .set({
        status: "error",
        attemptId: null,
        leaseExpiresAt: null,
        cancelling: false,
        finishedAt: new Date(),
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
    return failed.length;
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
