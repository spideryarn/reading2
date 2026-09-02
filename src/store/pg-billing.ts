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
 * **Nothing here is wired up yet.** `reserveIngest` has no caller in
 * `POST /api/jobs`, and `settleReservation` has no caller in `settleIn`. The
 * comments below describe what each function guarantees *to a correct caller*,
 * not something the app currently does — an earlier version of this header said
 * otherwise and was wrong (GPT Sol, 2026-09-02).
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
 * nobody, in exactly the case the boundary is for.
 *
 * Measured on 2026-09-02 with two real connections: the second transaction
 * blocks for as long as the first holds the row, then reads the first's
 * committed value. `tests/billing-quota-race.test.ts` is that measurement, kept.
 *
 * **The entitlement is read under the same lock**, from the row itself, rather
 * than passed in by the caller. Passing it in left a window in which a webhook
 * could cancel a subscription between the caller's read and this lock — and the
 * function would then grant Reader quota to a cancelled account, or refuse a
 * customer who had just paid.
 *
 * ## Why the lock is not held across `enqueue()`
 *
 * The obvious shape — hold the lock, count, create the job, commit — cannot be
 * built and should not be. `enqueueOrGet` (src/store/pg-jobs.ts) is deliberately
 * not a transaction, and holding a transaction open on one pooled connection
 * while `enqueue()` takes a second would deadlock the pool at
 * `DATABASE_POOL_MAX`, which defaults to 5.
 *
 * Instead the **reservation** is what is written under the lock. A later
 * admission counts unsettled reservations as used, so it sees an earlier one
 * whether or not that one has reached `enqueue()` yet. **Nothing that opens its
 * own transaction, and nothing that talks to the network, may be called between
 * the lock and the commit** — that is the rule that keeps the pool argument true.
 */

import { eq, sql } from "drizzle-orm";

import { FREE, entitlementForTier, isEntitledStatus, tierForPrice } from "../billing/tiers.js";
import type { Entitlement, TierRow } from "../billing/tiers.js";
import { getDb } from "../db/client.js";
import { billingAccounts, ingestEvents } from "../db/schema.js";
import { log } from "../log.js";
import { allTiers } from "./pg-tiers.js";

const logger = log("store");

/** A slot was taken. The id goes on the job row, in the job's own INSERT. */
export interface Admitted {
  readonly kind: "admitted";
  readonly reservationId: string;
  readonly entitlement: Entitlement;
}

/** The account is at its ceiling. Carries what a refusal message needs. */
export interface Refused {
  readonly kind: "refused";
  readonly used: number;
  readonly limit: number;
  /** When the allowance resets, for a paid account. Absent means never. */
  readonly resetAt?: Date;
}

/**
 * The account looks paid, but the stored period does not contain now.
 *
 * Neither an admission nor a refusal, because both would be wrong: serving them
 * the free limit falsely blocks somebody who has paid, and serving them the
 * Reader limit against a stale window is an uncapped month. The caller resyncs
 * from Stripe once and asks again; if it comes back `stale` a second time, that
 * is a 503 rather than a guess.
 */
export interface Stale {
  readonly kind: "stale";
  readonly subscriptionId: string | null;
}

export type Admission = Admitted | Refused | Stale;

/** What an owner has used, for `/profile` and `/admin/users`. */
export interface Usage {
  /** Successful ingests inside the current period. */
  readonly used: number;
  /** Reservations taken and not yet settled — jobs in flight. */
  readonly inFlight: number;
}

/** The columns entitlement is derived from. */
export interface BillingRow {
  readonly status: string | null;
  readonly priceId: string | null;
  readonly currentPeriodStart: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly stripeSubscriptionId: string | null;
}

/**
 * What this row entitles its owner to, or `"stale"`.
 *
 * Pure, so the decision that governs every ingest can be tested without a
 * database. `readerPriceId` is passed rather than read from the environment for
 * the same reason.
 *
 * Order matters: an unentitled status is free whatever the price says, and an
 * unrecognised price is free whatever the status says. Both fail towards free,
 * because the other direction hands out a hundred ingests a month for something
 * nobody costed.
 */
export function entitlementFromRow(
  row: BillingRow | undefined,
  tiers: readonly TierRow[],
  now: Date,
): Entitlement | Stale {
  if (!row || !isEntitledStatus(row.status)) return FREE;

  const tier = tierForPrice(row.priceId, tiers);
  if (!tier) {
    logger.warn(
      { priceId: row.priceId, status: row.status },
      "an entitled subscription is on a price no tier sells — treating as free",
    );
    return FREE;
  }

  const { currentPeriodStart: start, currentPeriodEnd: end } = row;
  /* Half-open, the same rule the usage query counts by. */
  if (!start || !end || now < start || now >= end) {
    return { kind: "stale", subscriptionId: row.stripeSubscriptionId };
  }
  return entitlementForTier(tier, { start, end });
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
 *
 * **Every interpolation here is a bind parameter, checked rather than assumed.**
 * Drizzle's `sql` tag turns `${…}` into `$1`, `$2`, `$3`, so the values reach
 * Postgres in the parameter array and never in the statement text. Asked of the
 * builder on 2026-09-02 with `'; drop table spideryarn.ingest_events; --` as the
 * owner id: the SQL came back with placeholders and the hostile text appeared
 * only in `params`. Worth writing down because the period derives from
 * Stripe-controlled data, so "surely it parameterises" is not a thing to be
 * surely about.
 *
 * **Exported only so that claim has a test.** `tests/billing-quota-sql.test.ts`
 * builds this with a hostile owner id and asserts the statement text contains
 * placeholders and not the string — which is what stops somebody "simplifying"
 * it into concatenation later, a change that would look completely ordinary in
 * a diff and be invisible in every other test.
 */
export function usageSql(ownerId: string, entitlement: Entitlement) {
  const inPeriod =
    entitlement.tier === "paid"
      ? sql`succeeded_at >= ${entitlement.periodStart.toISOString()}::timestamptz
            and succeeded_at < ${entitlement.periodEnd.toISOString()}::timestamptz`
      : /* The free tier's allowance is lifetime, so any success counts. */
        sql`true`;

  return sql`
    select
      count(*) filter (where succeeded_at is not null and ${inPeriod})::int as used,
      count(*) filter (where succeeded_at is null and released_at is null)::int as in_flight
    from spideryarn.ingest_events
    where owner_id = ${ownerId}::uuid`;
}

/**
 * Read the one row an aggregate must produce, or throw.
 *
 * **Never defaults to zero**, which is the whole reason this is a function. A
 * driver shape that changed, a query that returned nothing, a count that came
 * back as something other than a number — every one of those, defaulted, reads
 * as "this account has used nothing" and lets an unlimited number of ingests
 * through. Wrong in the expensive direction, and silent. GPT Sol, 2026-09-02.
 */
function usageOf(result: unknown): Usage {
  const rows = (result as { rows?: unknown }).rows;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row || typeof row !== "object") {
    throw new Error("the ingest usage query returned no row, which an aggregate cannot do");
  }
  const used = Number((row as Record<string, unknown>).used);
  const inFlight = Number((row as Record<string, unknown>).in_flight);
  for (const [name, value] of [
    ["used", used],
    ["in_flight", inFlight],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`the ingest usage query returned ${name}=${String(value)}, which is not a count`);
    }
  }
  return { used, inFlight };
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
 * @param tiers what we sell, from `billing_tiers`. Defaults to the cached read;
 * an empty list means no tier has a Stripe price yet, so nobody is entitled and
 * everybody gets the free allowance — the right behaviour for a deployment
 * where the setup script has not been run.
 * @param slug the intended slug, stored as a diagnostic only — it is mutable,
 * so it is never this row's identity.
 */
export async function reserveIngest(
  ownerId: string,
  slug?: string,
  tiers?: readonly TierRow[],
): Promise<Admission> {
  /* Read before the transaction opens, never inside it: this is a second query
     and the rule for the locked section is that nothing else runs in it. */
  const sold = tiers ?? (await allTiers());
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
         admission for this owner waits here — and the entitlement comes from
         *this* read, inside the lock, so a webhook cannot change it underneath
         the count. */
      const [row] = await tx
        .select({
          status: billingAccounts.status,
          priceId: billingAccounts.priceId,
          currentPeriodStart: billingAccounts.currentPeriodStart,
          currentPeriodEnd: billingAccounts.currentPeriodEnd,
          stripeSubscriptionId: billingAccounts.stripeSubscriptionId,
        })
        .from(billingAccounts)
        .where(eq(billingAccounts.ownerId, ownerId))
        .for("update")
        .limit(1);
      if (!row) {
        /* Unreachable — the insert above guarantees a row and this transaction
           holds it. Loud rather than silent, because the only way here is the
           failure this whole file is about. */
        throw new Error(`billing_accounts row for ${ownerId} vanished under its own lock`);
      }

      const entitlement = entitlementFromRow(row, sold, new Date());
      if ("kind" in entitlement) return entitlement; // stale

      const usage = usageOf(await tx.execute(usageSql(ownerId, entitlement)));
      const used = usage.used + usage.inFlight;
      if (used >= entitlement.limit) {
        return {
          kind: "refused",
          used,
          limit: entitlement.limit,
          ...(entitlement.tier === "paid" ? { resetAt: entitlement.periodEnd } : {}),
        } satisfies Refused;
      }

      const [reservation] = await tx
        .insert(ingestEvents)
        .values({ ownerId, ...(slug ? { slug } : {}) })
        .returning({ id: ingestEvents.id });
      if (!reservation) throw new Error("reserving an ingest slot returned no row");
      return { kind: "admitted", reservationId: reservation.id, entitlement } satisfies Admitted;
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
 * Give back a slot **only if no job is spending it**.
 *
 * For the paths that reserved and then could not enqueue: `enqueue()` threw, or
 * it deduplicated this request onto an existing job carrying its own
 * reservation.
 *
 * **The `not exists` is load-bearing and an earlier version did not have it.**
 * The comment then said an `enqueue()` throw proves no job exists. It does not:
 * an INSERT can commit and the response be lost, and the caller sees a throw
 * over a job that is now running. Releasing there would let that job publish
 * against a released reservation — `settleReservation` would match nothing and
 * the ingest would be free. GPT Sol, 2026-09-02.
 *
 * Releasing by *job* must never happen this way at all. A `/cancel` that sets
 * `released_at` from outside the job's own transition can lose a race with the
 * publication it was trying to stop. Success and release both live in
 * `settleIn`'s transaction — see `settleReservation`.
 *
 * @returns whether the slot was actually given back.
 */
export async function releaseReservation(reservationId: string): Promise<boolean> {
  /* `now()` rather than `new Date()`: the constraint that terminal timestamps
     may not precede `reserved_at` is checked by Postgres against Postgres's
     clock, and a serverless host running a few seconds behind would violate it
     and leak the slot for ever. */
  const result = await getDb().execute(sql`
    update spideryarn.ingest_events
       set released_at = now()
     where id = ${reservationId}::uuid
       and succeeded_at is null
       and released_at is null
       and not exists (
         select 1 from spideryarn.jobs where ingest_event_id = ${reservationId}::uuid
       )
    returning id`);
  const rows = (result as { rows?: unknown[] }).rows;
  return Array.isArray(rows) && rows.length === 1;
}

/**
 * The transaction handle the caller is already inside.
 *
 * **This type enforces nothing**, and saying so is the point: `getDb()` also has
 * an `execute`, so `settleReservation(getDb(), …)` type-checks and would be
 * wrong. An earlier version of this was called `SettlementTx`, which implied a
 * guarantee it could not give (GPT Sol, 2026-09-02). What actually enforces the
 * rule is where the one correct caller lives — inside `settleIn`'s transaction
 * — and the row assertion below, which turns a misuse into a throw rather than
 * a silent no-op.
 */
export interface HasExecute {
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
 * **A non-null reservation that cannot be settled throws**, and taking the whole
 * transaction down with it is the intended behaviour. Zero rows means the
 * reservation is missing, already charged, or already released — and committing
 * a publication over that would be the free ingest this file exists to prevent.
 * The earlier version updated and did not look, so the "atomic charge" it
 * claimed was not one.
 *
 * A **null** `ingestEventId` settles nothing and is not an error: pipeline work
 * from the CLI, a re-run of one step, seeding. The caller passes what the job
 * carries and does not have to know which kind it has.
 */
export async function settleReservation(
  tx: HasExecute,
  ingestEventId: string | null | undefined,
  outcome: "succeeded" | "released",
): Promise<void> {
  if (!ingestEventId) return;
  const result = await tx.execute(
    outcome === "succeeded"
      ? sql`update spideryarn.ingest_events set succeeded_at = now()
             where id = ${ingestEventId}::uuid
               and succeeded_at is null and released_at is null
           returning id`
      : sql`update spideryarn.ingest_events set released_at = now()
             where id = ${ingestEventId}::uuid
               and succeeded_at is null and released_at is null
           returning id`,
  );
  const rows = (result as { rows?: unknown[] }).rows;
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(
      `ingest reservation ${ingestEventId} could not be settled as ${outcome} — it is missing or ` +
        "already settled, and committing over that would give away an ingest",
    );
  }
}

/** Log a refusal where the reason is still in hand. Never the reader's prose. */
export function noteRefusal(ownerId: string, refused: Refused): void {
  logger.info(
    { ownerId, used: refused.used, limit: refused.limit },
    "ingest refused: the account is at its quota",
  );
}
