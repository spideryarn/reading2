/**
 * The ingest quota: reserving a slot, settling it, and counting what is used.
 *
 * Postgres only — there is no filesystem half and there will not be one. The
 * settlement joins the publish transaction in src/store/pg-session.ts, which has
 * no filesystem counterpart, so quota is enforced when `SPIDERYARN_STORE=postgres`
 * and not otherwise. That is a decision rather than an oversight, and it cannot
 * leak into production: src/store/index.ts throws at *import* when a filesystem
 * store is live there, so the app fails to start rather than serving unmetered
 * ingests. docs/project/billing.md.
 *
 * ## The one thing this file exists to get right
 *
 * A script firing twenty concurrent `POST /api/jobs` at a free account with
 * three lifetime ingests must not get twenty through. A plain "count, then
 * decide" cannot stop that: twenty requests all read zero and all pass.
 *
 * So admission is serialised per owner, on the owner's `billing_accounts` row —
 * and **the row is created before it is locked**, which is the part that is easy
 * to get wrong and was got wrong here before, in another table: *"a row lock is
 * taken on rows the statement returns, so a `SELECT … FOR UPDATE` that matches
 * nothing locks nothing"*
 * (docs/postmortems/260901f-a-for-update-that-locks-nothing.md). A free reader
 * has no billing row, so locking one that might not exist would serialise
 * nobody, in exactly the case the boundary is for. `insert … on conflict do
 * nothing` then `for update` is that postmortem's prescribed shape.
 *
 * Measured on 2026-09-02 with two real connections: the second transaction
 * blocks for as long as the first holds the row, then reads the first's
 * committed value. `tests/billing-quota-race.test.ts` is that measurement, kept.
 *
 * ## Why the lock is not held across `enqueue()`
 *
 * The obvious shape — hold the lock, count, create the job, commit — cannot be
 * built and should not be. `enqueueOrGet` (src/store/pg-jobs.ts) is deliberately
 * not a transaction, and holding a transaction open on one pooled connection
 * while `enqueue()` takes a second would deadlock the pool at
 * `DATABASE_POOL_MAX` concurrent admissions, which defaults to 5.
 *
 * Instead the **reservation** is what is written under the lock. A later
 * admission counts unsettled reservations as used, so it sees an earlier one
 * whether or not that one has reached `enqueue()` yet. **Nothing that opens its
 * own transaction, and nothing that talks to the network, may be called between
 * the lock and the commit** — that is the rule that keeps the pool argument
 * true.
 */

import { and, eq, isNull, sql } from "drizzle-orm";

import type { Entitlement } from "../billing/tiers.js";
import { getDb } from "../db/client.js";
import { billingAccounts, ingestEvents } from "../db/schema.js";
import { log } from "../log.js";

const logger = log("store");

/** A slot was taken. The id goes on the job row, in the job's own INSERT. */
export interface Admitted {
  readonly kind: "admitted";
  readonly reservationId: string;
}

/** The account is at its ceiling. Carries what a refusal message needs. */
export interface Refused {
  readonly kind: "refused";
  readonly used: number;
  readonly limit: number;
  /** When the allowance resets, for a paid account. Absent means never. */
  readonly resetAt?: Date;
}

export type Admission = Admitted | Refused;

/** What an owner has used, for `/profile` and `/admin/users`. */
export interface Usage {
  /** Successful ingests inside the current period. */
  readonly used: number;
  /** Reservations taken and not yet settled — jobs in flight. */
  readonly inFlight: number;
}

/**
 * The usage half of admission, as SQL, so that the gate and the display ask the
 * same question of the same columns rather than two questions that agree today.
 *
 * Half-open on the period — `>= start and < end` — so an ingest at the instant a
 * period rolls over is counted once, in the new period, rather than in both or
 * in neither.
 *
 * **In-flight has no age limit**, and that is the correction that matters most
 * in this file. See `ingest_events` in src/db/schema.ts: an expiry here is a
 * quota bypass, because held-open jobs are something a caller can arrange.
 */
function usageSql(ownerId: string, entitlement: Entitlement) {
  const { periodStart, periodEnd } = entitlement;
  const inPeriod =
    periodStart && periodEnd
      ? sql`succeeded_at >= ${periodStart.toISOString()}::timestamptz
            and succeeded_at < ${periodEnd.toISOString()}::timestamptz`
      : /* The free tier's period is all of time, so any success counts. */
        sql`true`;

  return sql`
    select
      count(*) filter (where succeeded_at is not null and ${inPeriod})::int as used,
      count(*) filter (where succeeded_at is null and released_at is null)::int as in_flight
    from spideryarn.ingest_events
    where owner_id = ${ownerId}::uuid`;
}

/** Drizzle's `execute` shape differs by driver; this reads either. */
function firstRow(result: unknown): Record<string, unknown> | undefined {
  const withRows = result as { rows?: Array<Record<string, unknown>> };
  if (Array.isArray(withRows.rows)) return withRows.rows[0];
  return Array.isArray(result) ? (result[0] as Record<string, unknown>) : undefined;
}

function usageOf(result: unknown): Usage {
  const row = firstRow(result);
  return { used: Number(row?.used ?? 0), inFlight: Number(row?.in_flight ?? 0) };
}

/** What this owner has used against the entitlement they currently hold. */
export async function usageFor(ownerId: string, entitlement: Entitlement): Promise<Usage> {
  return usageOf(await getDb().execute(usageSql(ownerId, entitlement)));
}

/**
 * Take a slot for a new ingest, or refuse.
 *
 * One transaction, one connection, nothing else called from inside it. The
 * returned `reservationId` must be handed to `enqueue()` so that it lands in the
 * job's own INSERT — see `jobs.ingest_event_id`. If it never reaches a job,
 * `releaseReservation` gives it back.
 *
 * @param slug the intended slug, stored as a diagnostic only — it is mutable,
 * so it is never this row's identity.
 */
export async function reserveIngest(
  ownerId: string,
  entitlement: Entitlement,
  slug?: string,
): Promise<Admission> {
  return await getDb().transaction(
    async (tx) => {
      /* The anchor. `do nothing` rather than `do update` because there is
         nothing to change — the row's existence is the whole point, and an
         update would touch `updated_at` on every ingest for no reason. */
      await tx
        .insert(billingAccounts)
        .values({ ownerId })
        .onConflictDoNothing({ target: billingAccounts.ownerId });

      /* And now it is certain to be there, so this locks something. Every other
         admission for this owner waits here. */
      const locked = await tx
        .select({ ownerId: billingAccounts.ownerId })
        .from(billingAccounts)
        .where(eq(billingAccounts.ownerId, ownerId))
        .for("update")
        .limit(1);
      if (locked.length === 0) {
        /* Unreachable — the insert above guarantees a row and this transaction
           holds it. Loud rather than silent, because the only way here is the
           failure this whole file is about. */
        throw new Error(`billing_accounts row for ${ownerId} vanished under its own lock`);
      }

      const usage = usageOf(await tx.execute(usageSql(ownerId, entitlement)));
      const used = usage.used + usage.inFlight;
      if (used >= entitlement.limit) {
        return {
          kind: "refused",
          used,
          limit: entitlement.limit,
          ...(entitlement.periodEnd ? { resetAt: entitlement.periodEnd } : {}),
        } satisfies Refused;
      }

      const [reservation] = await tx
        .insert(ingestEvents)
        .values({ ownerId, ...(slug ? { slug } : {}) })
        .returning({ id: ingestEvents.id });
      if (!reservation) throw new Error("reserving an ingest slot returned no row");
      return { kind: "admitted", reservationId: reservation.id } satisfies Admitted;
    },
    /* Pinned rather than inherited. `on conflict do nothing` is only an escape
       from a concurrent writer at `read committed`; at `repeatable read` it
       raises 40001 at the insert, and nothing in src/ retries that
       (docs/postmortems/260901f-…). Every other transaction in the store is
       pinned for the same reason. */
    { isolationLevel: "read committed" },
  );
}

/**
 * Give back a slot that never became a job.
 *
 * The **only** safe standalone release: `enqueue()` threw, or it deduplicated
 * this request onto an existing job that carries its own reservation. In both
 * cases no job row references this id, so nothing can be racing to settle it.
 *
 * Releasing by *job* must never happen this way. A `/cancel` that sets
 * `released_at` from outside the job's own transition can lose a race with the
 * publication it was trying to stop — the job publishes, and its settlement
 * finds the reservation already released and charges nothing. So success and
 * release both live in `settleIn`'s transaction, below. GPT Sol, 2026-09-02.
 */
export async function releaseReservation(reservationId: string): Promise<void> {
  await getDb()
    .update(ingestEvents)
    .set({ releasedAt: new Date() })
    .where(
      and(
        eq(ingestEvents.id, reservationId),
        isNull(ingestEvents.succeededAt),
        isNull(ingestEvents.releasedAt),
      ),
    );
}

/** The transaction handle `settleIn` has. Narrow on purpose: only `execute`. */
export interface SettlementTx {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

/**
 * Settle a job's reservation **inside the transaction that ends the job**.
 *
 * This is the guarantee the whole design rests on: the charge commits with the
 * revision it is charging for, and the release commits with the failure it is
 * excusing. There is no window in which an ingest has succeeded and not been
 * counted, none in which a failure has been charged, and no way for a cancel
 * racing a publication to leave the two disagreeing — whichever transition wins
 * the job fence is the one whose settlement lands, because they are the same
 * transaction.
 *
 * A job with a null `ingestEventId` settles nothing: pipeline work from the CLI,
 * a re-run of one step, seeding. The caller passes what the job carries and does
 * not have to know which kind it has.
 */
export async function settleReservation(
  tx: SettlementTx,
  ingestEventId: string | null | undefined,
  outcome: "succeeded" | "released",
): Promise<void> {
  if (!ingestEventId) return;
  const column = outcome === "succeeded" ? sql.raw("succeeded_at") : sql.raw("released_at");
  await tx.execute(sql`
    update spideryarn.ingest_events
       set ${column} = now()
     where id = ${ingestEventId}::uuid
       and succeeded_at is null
       and released_at is null`);
}

/** Log a refusal where the reason is still in hand. Never the reader's prose. */
export function noteRefusal(ownerId: string, refused: Refused): void {
  logger.info(
    { ownerId, used: refused.used, limit: refused.limit },
    "ingest refused: the account is at its quota",
  );
}
