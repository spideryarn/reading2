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
 * ## `23505` is an answer, not an error
 *
 * `jobs_active_slug` in src/db/schema.ts is load-bearing here and surfaces as a
 * unique violation rather than as zero rows: it makes "one job in flight per
 * article" a fact rather than a convention, and the insert treats the conflict
 * as an ordinary outcome — "somebody already has this slug" — because an index
 * doing its job is not an exception.
 *
 * **There were two, and the other one has gone.** `jobs_only_one_running` gave
 * global concurrency 1 as a unique index on a constant, and `claim` caught its
 * `23505` by name. A constant cannot express *at most N*, so on 2026-08-30 the
 * index was dropped and the cap moved into a count taken inside the `queue_state`
 * lock — see `claim`. Nothing here catches that name any more, and a `catch` that
 * still did would be dead code reading as a live guard.
 */

import { and, desc, eq, inArray, isNull, lte, or, type SQL, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { guardDbStore, lockUnavailable } from "./db-errors.js";
import { leaseIsOver, liveAttempt } from "./job-fence.js";
import { jobs, queueState } from "../db/schema.js";
import { INTERRUPTED } from "../messages.js";
import type { FailureKind } from "../messages.js";
import type { Job, JobStatus, JobStep, OwnerId } from "../types.js";
import {
  type ClaimOutcome,
  type ExpirySettlement,
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
 *
 * **`claim` stopped being one of them on 2026-08-30.** It now opens a
 * transaction of its own, because the global cap is a count that has to be taken
 * inside the `queue_state` lock; the `UPDATE` is still one fenced statement, but
 * it is no longer the whole of what has to be atomic. Every other transition here
 * is unchanged.
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
      /* **Queued, always, whatever the caller handed us.** `enqueueOrGet` takes a
         whole `Job`, and copying its `status` let a caller insert a `running`
         row that never passed the cap check and carries no attempt token — one
         more running job than the machine agreed to, arriving through the door
         marked "enqueue". Nothing does that today; the contract simply should
         not allow it. GPT Sol, reviewing the built stage 1. */
      status: "queued",
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
      /* **No `jobs_only_one_running` branch any more, and its absence is the
         thing to notice.** That index was the whole of the global guarantee and
         a `23505` here was an ordinary answer; it is gone
         (drizzle/0032_jobs_concurrency_cap.sql) and the cap is counted by the
         caller inside the queue_state lock. A `catch` that still named it would
         be dead code that reads as a live guard. */
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
        /* **Classify the job before blaming the cap**, or the answer to "what is
           this job doing" changes depending on how busy the machine is. Without
           this, a finished job reads `busy` at the cap and `finished` below it,
           a deleted one reads `busy` rather than `gone` — and `advanceJobWith`
           casts the `get()` behind its `busy` branch to `Job`, so a missing row
           becomes a 200 where the route means a 404. The filesystem adapter
           classifies first and would have disagreed with this one on all three.
           GPT Sol, reviewing the built stage 1. */
        const current = await getIn(tx, id, owner);
        if (!current) return { kind: "gone" };
        if (TERMINAL.includes(current.status as (typeof TERMINAL)[number])) {
          return { kind: "finished", job: current };
        }
        if (current.cancelling === true) return { kind: "stopping", job: current };
        if (current.status === "running") {
          return { kind: "busy", why: "another request is inside this job" };
        }
        /* **Not "N of N".** The cap can be lowered under jobs that are already
           running, so this really can read `already running 5 of 3` — which is a
           true account of a machine that is over its new limit and draining, and
           a rounder-sounding sentence would be a false one. */
        return { kind: "busy", why: `already running ${running} of ${maxRunning} jobs` };
      }
      return claimIn(tx, id, owner, attempt, leaseMs);
    });
  },


  releaseStep(id: string, attempt: string, steps: JobStep[], outcome: StepOutcome): Promise<Job> {
    return releaseStepIn(getDb(), id, attempt, steps, outcome);
  },

  finish(id: string, attempt: string, ending: JobEnding): Promise<Job> {
    return finishIn(getDb(), id, attempt, ending);
  },

  /**
   * **One statement, and it decides which kind of ending this is** — the same
   * shape `requestCancel` has, and for the same reason.
   *
   * A row carrying `cancelling` is a reader who pressed Stop and whose claimant
   * then walked away without ever reading the flag. Failing it as
   * `INTERRUPTED` would tell that reader their own Stop was an interruption, so
   * it settles as `cancelled`, and the sentence and the kind that go with a
   * failure are **cleared** rather than left: a job that failed a step and was
   * then stopped would otherwise carry the old sentence under a `cancelled`
   * status. GPT Sol, 2026-09-01.
   */
  async settleExpired(now?: Date): Promise<ExpirySettlement[]> {
    const db = getDb();
    const settled = await db
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
           docs/plans/260827aa-delete-the-importer-d1b-sol.md finding 1. */
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
      .where(
        and(
          eq(jobs.status, "running"),
          /* **Database time, unless a test says otherwise.** The lease is
             written by `claim` as `clock_timestamp() + leaseMs` on this same
             clock, so the deadline is one clock's arithmetic end to end. It
             used to be `Date.now()` at both ends, which is fine on a laptop
             and is a different clock from the one holding the row the moment
             there are two instances.

             **The exact expression the fence refuses on**, imported rather
             than written again: what `liveAttempt` will no longer let a
             claimant write to is precisely what this may settle, with no
             instant in between where a job is neither. That includes the
             NULL-lease row `jobs_running_is_fenced` makes impossible — see
             src/store/job-fence.ts for why *over* is the better answer for a
             state that cannot happen. */
          now === undefined
            ? leaseIsOver
            : or(isNull(jobs.leaseExpiresAt), lte(jobs.leaseExpiresAt, now)),
        ),
      )
      .returning({ id: jobs.id, status: jobs.status });
    /* What the statement already returns, and both fields of it. `RETURNING`
       hands back the row *after* the update, so the status here is the ending
       the `case` chose rather than the one it started from. */
    return settled.map((row) => ({
      id: row.id,
      status: row.status as ExpirySettlement["status"],
    }));
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
    const [row] = await db
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
