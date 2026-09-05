/**
 * **A bound on how many outbound fetches one reader's pointer may cause.**
 *
 * `GET /api/link-preview` is the first endpoint here where a *hover* makes us
 * contact a third party, and there was no inbound rate limiter to reuse — the
 * ingest quota is a billing allowance and `src/dictation-limits.ts` bounds one
 * upload. So this is new machinery, kept as small as it can be:
 * src/db/schema.ts § `rateLimitEvents` is one row per fill, and this file counts
 * them.
 *
 * ## Three properties, and each one is a thing Sol's review asked for by name
 *
 * 1. **Keyed solely on the authenticated owner.** Not the article, not the URL —
 *    both of which an attacker varies freely, and varying them is exactly what
 *    turns a per-URL limit into no limit. `currentOwnerId()` and nothing else.
 * 2. **Atomic across instances.** The count and the insert are one transaction
 *    under an owner-scoped `pg_advisory_xact_lock`. Without it every instance
 *    reads the same count and every one of them inserts, which is a cap that is
 *    really a suggestion — the lesson pg-feedback.ts already records.
 * 3. **Cache hits never come here.** The caller asks for allowance only when it
 *    is about to fetch. The cache absorbs the steady state; this is for the
 *    pathological one.
 *
 * GPT Sol, 2026-09-05, finding P1-5.
 *
 * ## Two bounds out of one table
 *
 * The **rolling window** is a count of rows in the last hour, not a counter
 * column that resets: a fixed window lets twice the allowance through at the
 * seam, and the times are already here.
 *
 * **Concurrency** is a count of rows whose `lease_until` is still in the future.
 * A lease rather than a flag, because the process holding one can die — an
 * abandoned request costs its owner one slot until the lease runs out rather
 * than for ever.
 *
 * ## And, since stage 3, a day and a fuse
 *
 * A bucket that spends *money* rather than somebody else's bandwidth carries a
 * `daily` block as well: a longer per-owner window, and a **global** cap over
 * the same window that counts every reader together. The second is the blast
 * radius — what stands between a bug and a day's model spend — and it is the one
 * count here that is not about one reader, which is why it needs a second lock.
 * See `RATE_LIMIT_FUSE_KEY`.
 *
 * ## What may be logged from this file
 *
 * Nothing. It knows an owner id and a count, and neither is worth a line: the
 * route says whether a request was refused, without saying what it was for.
 */

import { and, eq, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { rateLimitEvents } from "../db/schema.js";
import { guardDbStore } from "./db-errors.js";
import { READ_COMMITTED } from "./isolation.js";
import { currentOwnerId } from "../owner.js";
import type {
  AllowanceTaken,
  FetchAllowanceStore,
  RateBucket,
  RatePolicy,
} from "./contracts.js";

/**
 * Its own advisory-lock namespace, beside feedback's 4919 and the link-preview
 * cache's 5281, so three features cannot collide on one hash space.
 *
 * The second half is `hashtext(owner_id)`, exactly as pg-feedback.ts does it:
 * `hashtext` needs only to agree with itself in one database between two
 * concurrent transactions, and two owners who hash alike serialise with each
 * other, which is slower and never wrong.
 */
const RATE_LIMIT_LOCK_NAMESPACE = 5282;

/**
 * **The fuse's own lock, and it is a constant rather than a hash of anything.**
 *
 * The per-owner lock above serialises one reader against themselves, which is
 * all a per-owner cap needs. A cap counted *across* owners cannot be made atomic
 * that way: two readers hold two different locks, both count the same global
 * total, and both insert. So a policy carrying `daily.globalFills` takes this
 * second lock as well.
 *
 * **Always after the owner lock**, which is what makes deadlock impossible: two
 * transactions that take the same two locks in the same order cannot wait on
 * each other. This function is the only thing that takes either.
 *
 * It serialises every summary fill in the app against every other one, which is
 * a real bottleneck and a tolerable one at these volumes: the lock is held for
 * two counts and an insert, and nothing behind it is a network call.
 */
const RATE_LIMIT_FUSE_KEY = 1;

const rawPgFetchAllowanceStore: FetchAllowanceStore = {
  async take(bucket: RateBucket, policy: RatePolicy): Promise<AllowanceTaken> {
    const ownerId = currentOwnerId();
    const db = getDb();
    const windowSeconds = policy.windowMs / 1000;
    const leaseSeconds = policy.leaseMs / 1000;
    const daily = policy.daily ?? null;
    const dailySeconds = daily ? daily.windowMs / 1000 : 0;
    /* **The sweep must not delete rows a longer window still counts.** The
       hourly cap is the shorter of the two, so keeping only an hour's worth
       would make a daily cap count what happened in the last hour and call it a
       day — a limiter that reports a number for the right reason and the wrong
       period. */
    const keepSeconds = Math.max(windowSeconds, dailySeconds);

    /**
     * **`read committed`, said in the code and not only here**, for the reason
     * pg-feedback.ts states at length: under `repeatable read` the lock statement can establish a
     * snapshot before it starts waiting, so the count after the wait would be
     * taken from before the transaction that held the lock committed — and the
     * cap would count one short, once per concurrent request.
     */
    return db.transaction(async (tx): Promise<AllowanceTaken> => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${sql.raw(String(RATE_LIMIT_LOCK_NAMESPACE))}, hashtext(${ownerId}))`,
      );
      /* The fuse's lock, second and only when there is a fuse — see the
         constant, which is where the ordering argument lives. */
      if (daily) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${sql.raw(String(RATE_LIMIT_LOCK_NAMESPACE))}, ${sql.raw(String(RATE_LIMIT_FUSE_KEY))})`,
        );
      }

      /* **The sweep is the same statement family as the count, deliberately.**
         Rows outside the window can never affect an answer, so deleting them
         here rather than in a cron keeps an *active* reader's rows bounded by
         their allowance instead of by their history — and means there is no
         second job to forget to run. It is bounded work: at most one window's
         worth per owner.

         **It reaches this owner's rows and nobody else's**, so a reader who
         stops hovering links leaves their last window behind for good. That is a
         bounded leak rather than growth, and src/db/schema.ts §
         `rateLimitEvents` says how bounded and why there is no cron for it. */
      await tx
        .delete(rateLimitEvents)
        .where(
          and(
            eq(rateLimitEvents.ownerId, ownerId),
            eq(rateLimitEvents.bucket, bucket),
            sql`${rateLimitEvents.startedAt} < now() - make_interval(secs => ${keepSeconds})`,
          ),
        );

      /* One clock, and it is the database's. `started_at` is written by the
         database, so comparing it against `Date.now()` in this process would
         make the window sensitive to skew between two machines nobody watches —
         the correction pg-feedback.ts took from GPT Sol on 2026-08-31. `now()`
         is the transaction's start time, so both counts below are as of one
         instant. */
      const [counts] = await tx
        .select({
          /* **Filtered on the window rather than trusting the sweep above.** The
             sweep now keeps the *longer* of the two windows, so counting every
             row this owner has would answer the hourly question with a day's
             worth. The filter is what makes each cap mean its own period; the
             sweep is only housekeeping. */
          fills: sql<number>`count(*) filter (
            where ${rateLimitEvents.startedAt} > now() - make_interval(secs => ${windowSeconds})
          )::int`,
          daily: sql<number>`count(*) filter (
            where ${rateLimitEvents.startedAt} > now() - make_interval(secs => ${dailySeconds})
          )::int`,
          inFlight: sql<number>`count(*) filter (where ${rateLimitEvents.leaseUntil} > now())::int`,
        })
        .from(rateLimitEvents)
        .where(and(eq(rateLimitEvents.ownerId, ownerId), eq(rateLimitEvents.bucket, bucket)));

      const fills = counts?.fills ?? 0;
      const inFlight = counts?.inFlight ?? 0;
      /* The window cap first: a reader who is over it is over it whether or not
         they also have four requests in the air, and reporting the rarer of the
         two reasons would send whoever reads the logs to the wrong number. */
      if (fills >= policy.fills) return { kind: "rate" };
      /* The day, where a bucket has one. Reported as `rate` too, because it is
         still this reader's own allowance and the caller's answer is the same;
         only the fuse below is a different kind of fact. */
      if (daily && (counts?.daily ?? 0) >= daily.fills) return { kind: "rate" };
      if (inFlight >= policy.concurrency) return { kind: "concurrency" };

      /* **The fuse, counted across every owner** — the only query here that is
         not about one reader, and the reason for the second lock above. It is
         last because it is the rarest and the most expensive: a reader over
         their own cap never reaches it. */
      if (daily) {
        const [everybody] = await tx
          .select({ fills: sql<number>`count(*)::int` })
          .from(rateLimitEvents)
          .where(
            and(
              eq(rateLimitEvents.bucket, bucket),
              sql`${rateLimitEvents.startedAt} > now() - make_interval(secs => ${dailySeconds})`,
            ),
          );
        if ((everybody?.fills ?? 0) >= daily.globalFills) return { kind: "global" };
      }

      const [taken] = await tx
        .insert(rateLimitEvents)
        .values({
          ownerId,
          bucket,
          leaseUntil: sql`now() + make_interval(secs => ${leaseSeconds})`,
        })
        .returning({ id: rateLimitEvents.id });
      /* A plain insert under the lock cannot fail to return a row; if it ever
         does, refusing is the safe direction — a caller with no token has
         nothing to release. */
      return taken ? { kind: "allowed", id: taken.id } : { kind: "concurrency" };
    }, READ_COMMITTED);
  },

  async finish(id: string): Promise<void> {
    const db = getDb();
    /* **The row stays; only the lease is cleared.** The fill has happened and
       must go on counting against the window — deleting it here would make the
       hourly cap a cap on *concurrent* fetches and nothing else, which is the
       shape of mistake that looks like a working limiter. */
    await db
      .update(rateLimitEvents)
      .set({ leaseUntil: null })
      .where(and(eq(rateLimitEvents.id, id), eq(rateLimitEvents.ownerId, currentOwnerId())));
  },
};

/**
 * **Guarded at the export**, like every other adapter here — see
 * `pgLinkPreviewStore` for the argument, which is the same one: the guard
 * travels with the store rather than living at the one place it happens to be
 * selected today. `tests/store-guarded.test.ts`.
 */
export const pgFetchAllowanceStore: FetchAllowanceStore = guardDbStore(
  "fetch-allowance",
  rawPgFetchAllowanceStore,
);
