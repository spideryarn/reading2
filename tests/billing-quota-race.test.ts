/**
 * **Two transactions, one owner, one slot** — the test the ingest quota exists
 * for, and the one shape of test this repo learned to insist on the hard way.
 *
 * > any table whose primary key is not the caller's own id needs one test that
 * > writes it from two overlapping transactions with the row absent
 *
 * — docs/postmortems/260901f-a-for-update-that-locks-nothing.md, which is about
 * a `SELECT … FOR UPDATE` that locked nothing because the row it named did not
 * exist yet. The quota is at risk of exactly that, and in the worst possible
 * place: a **free** reader has no `billing_accounts` row, so a naive
 * `for update` on it would serialise nobody, in precisely the case the whole
 * boundary is for. `reserveIngest` creates the anchor row before locking it.
 *
 * **A held transaction beats a race**, per that postmortem: rather than firing
 * N requests and hoping the interleaving is unlucky, one transaction is held
 * open and the other is *asserted* to be blocked. A barrier-synchronised race
 * is here too, because it is what a scripted bypass actually looks like — but
 * the deterministic one is the test that cannot pass by luck.
 *
 * No Stripe, no network. See src/store/pg-billing.ts.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { FREE, FREE_LIFETIME_INGESTS, READER_PERIOD_INGESTS } from "../src/billing/tiers.js";
import type { Entitlement } from "../src/billing/tiers.js";
import { reserveIngest, releaseReservation, usageFor } from "../src/store/pg-billing.js";
import { pgReady } from "./helpers/pg-ready.js";

const { reachable, pool } = await pgReady({
  suite: "tests/billing-quota-race.test.ts",
  tables: ["spideryarn.billing_accounts", "spideryarn.ingest_events"],
  keepPool: true,
  max: 8,
});

const dbIt = reachable ? it : it.skip;

/**
 * A throwaway owner, needing a real `auth.users` row for the foreign key.
 *
 * Fixed rather than random, and distinctive rather than pretty: a run killed
 * halfway leaves rows behind, and a constant means the next run's `beforeEach`
 * clears them instead of accumulating a new owner every time.
 */
const OWNER = "0b111a99-0000-4000-8000-00000000c0da";

const PAID: Entitlement = {
  tier: "reader",
  limit: READER_PERIOD_INGESTS,
  periodStart: new Date("2026-09-01T00:00:00Z"),
  periodEnd: new Date("2026-10-01T00:00:00Z"),
};

async function seedOwner(): Promise<void> {
  if (!pool) return;
  /* `auth.users` is Supabase's, and the owner FK points into it. Minimal row,
     and `on conflict do nothing` so re-runs are cheap. */
  await pool.query(
    `insert into auth.users (id, instance_id, aud, role, email)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)
     on conflict (id) do nothing`,
    [OWNER, `quota-race-${OWNER}@spideryarn.local`],
  );
}

async function clear(): Promise<void> {
  if (!pool) return;
  await pool.query("delete from spideryarn.ingest_events where owner_id = $1", [OWNER]);
  await pool.query("delete from spideryarn.billing_accounts where owner_id = $1", [OWNER]);
}

beforeEach(async () => {
  await seedOwner();
  await clear();
});

afterEach(clear);

afterAll(async () => {
  if (!pool) return;
  await pool.query("delete from auth.users where id = $1", [OWNER]).catch(() => {});
  await pool.end();
});

describe("the anchor row is created before it is locked", () => {
  /**
   * The deterministic one. If `reserveIngest` locked a row that might not
   * exist, B would sail past A and both would read zero.
   */
  dbIt("a second admission blocks while the first holds the owner's row", async () => {
    if (!pool) return;
    const a = await pool.connect();
    try {
      await a.query("begin isolation level read committed");
      await a.query(
        "insert into spideryarn.billing_accounts (owner_id) values ($1) on conflict do nothing",
        [OWNER],
      );
      await a.query("select 1 from spideryarn.billing_accounts where owner_id = $1 for update", [
        OWNER,
      ]);

      let settled = false;
      const b = reserveIngest(OWNER, FREE).then((r) => {
        settled = true;
        return r;
      });

      await new Promise((r) => setTimeout(r, 400));
      /* The assertion the whole file is for. Before the anchor row existed,
         this was `true` and the quota was decorative. */
      expect(settled).toBe(false);

      await a.query("commit");
      const result = await b;
      expect(result.kind).toBe("admitted");
    } finally {
      a.release();
    }
  });
});

describe("a barrier-synchronised burst cannot exceed the allowance", () => {
  /**
   * What a scripted bypass looks like. `Promise.all` is not a barrier in the
   * strict sense, but every one of these is issued before any has answered,
   * which is the property that matters: none can see another's committed row
   * at the moment it starts.
   *
   * The postmortem's warning applies — *"load that arrives spread out is not
   * the load a race needs"* — so this deliberately does not stagger.
   */
  dbIt("admits exactly three of twenty for a free account", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserveIngest(OWNER, FREE)),
    );
    const admitted = results.filter((r) => r.kind === "admitted");
    expect(admitted).toHaveLength(FREE_LIFETIME_INGESTS);
    expect(results.filter((r) => r.kind === "refused")).toHaveLength(20 - FREE_LIFETIME_INGESTS);
  });

  dbIt("counts an unsettled reservation, so the next request sees it", async () => {
    const first = await reserveIngest(OWNER, FREE);
    expect(first.kind).toBe("admitted");
    /* Nothing has succeeded — the job has not even been created — and the
       usage still has to include it, or N concurrent requests all read zero. */
    expect(await usageFor(OWNER, FREE)).toEqual({ used: 0, inFlight: 1 });
  });
});

describe("releasing a slot that never became a job", () => {
  dbIt("gives the allowance back", async () => {
    const taken = await Promise.all(
      Array.from({ length: FREE_LIFETIME_INGESTS }, () => reserveIngest(OWNER, FREE)),
    );
    expect(await reserveIngest(OWNER, FREE)).toMatchObject({ kind: "refused" });

    const first = taken[0];
    if (first?.kind !== "admitted") throw new Error("expected an admission");
    await releaseReservation(first.reservationId);

    expect(await reserveIngest(OWNER, FREE)).toMatchObject({ kind: "admitted" });
  });

  dbIt("is idempotent, so a double release cannot free two slots", async () => {
    const one = await reserveIngest(OWNER, FREE);
    if (one.kind !== "admitted") throw new Error("expected an admission");
    await releaseReservation(one.reservationId);
    await releaseReservation(one.reservationId);
    expect(await usageFor(OWNER, FREE)).toEqual({ used: 0, inFlight: 0 });
  });
});

describe("the refusal says what a reader needs", () => {
  dbIt("carries the count, the limit, and no reset date for the free tier", async () => {
    await Promise.all(Array.from({ length: FREE_LIFETIME_INGESTS }, () => reserveIngest(OWNER, FREE)));
    const refused = await reserveIngest(OWNER, FREE);
    expect(refused).toEqual({
      kind: "refused",
      used: FREE_LIFETIME_INGESTS,
      limit: FREE_LIFETIME_INGESTS,
    });
    /* No `resetAt`: the free allowance is lifetime, and a date would promise a
       reset that never comes. */
    expect(refused).not.toHaveProperty("resetAt");
  });

  dbIt("carries the period end for a paid account", async () => {
    if (!pool) return;
    /* Fill the paid allowance by hand rather than by 100 admissions. */
    await pool.query(
      `insert into spideryarn.ingest_events (owner_id, reserved_at, succeeded_at)
       select $1, $2::timestamptz, $2::timestamptz from generate_series(1, $3)`,
      [OWNER, "2026-09-05T00:00:00Z", READER_PERIOD_INGESTS],
    );
    const refused = await reserveIngest(OWNER, PAID);
    expect(refused).toMatchObject({
      kind: "refused",
      used: READER_PERIOD_INGESTS,
      limit: READER_PERIOD_INGESTS,
      resetAt: PAID.periodEnd,
    });
  });
});

describe("the period is half-open", () => {
  dbIt("counts a success at the start instant and not one at the end instant", async () => {
    if (!pool) return;
    const at = async (when: string) => {
      await pool.query(
        `insert into spideryarn.ingest_events (owner_id, reserved_at, succeeded_at)
         values ($1, $2::timestamptz, $2::timestamptz)`,
        [OWNER, when],
      );
    };
    await at("2026-09-01T00:00:00Z"); // exactly the start — inside
    await at("2026-10-01T00:00:00Z"); // exactly the end — outside
    await at("2026-08-31T23:59:59Z"); // before — outside

    expect(await usageFor(OWNER, PAID)).toEqual({ used: 1, inFlight: 0 });
    /* And the free tier's "period" is all of time, so it sees all three. */
    expect(await usageFor(OWNER, FREE)).toEqual({ used: 3, inFlight: 0 });
  });
});
