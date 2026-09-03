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

import { FREE, FREE_LIFETIME_INGESTS } from "../src/billing/tiers.js";
import type { Entitlement, TierRow } from "../src/billing/tiers.js";
import { loadEnvLocal } from "../src/env.js";
import { releaseReservation, reserveIngest, usageFor } from "../src/store/pg-billing.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/**
 * **Before `pgReady`, or this whole file skips for the wrong reason.**
 *
 * `pgReady` reads `DATABASE_URL` from the environment, and vitest does not load
 * `.env.local` on its own. Without this the suite reported "13 skipped" against
 * a database that was up and migrated — the shape of silent failure this repo
 * has a document about, and it survived precisely because a skip looks like a
 * deliberate one. `REQUIRE_POSTGRES=1` is what finally said so.
 */
loadEnvLocal();

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

/** What the fixture tier allows, so the expectations read as one number. */
const READER_INGESTS = 20;

/** The configured Reader price, and the map `reserveIngest` resolves it through. */
const READER_PRICE = "price_reader_for_tests";
const PRICES: readonly TierRow[] = [
  {
    id: "reader",
    productName: "Spideryarn Reader",
    description: "20 articles a month.",
    ingestsPerPeriod: 20,
    lookupKey: "spideryarn_reader_monthly",
    stripePriceId: READER_PRICE,
    livemode: false,
    active: true,
    sortOrder: 10,
    amounts: { usd: 1000 },
  },
];

const PERIOD = { start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z" };

const PAID: Entitlement = {
  tier: "paid",
  tierId: "reader",
  limit: READER_INGESTS,
  periodStart: new Date(PERIOD.start),
  periodEnd: new Date(PERIOD.end),
};

async function seedOwner(): Promise<void> {
  if (!pool) return;
  /* `auth.users` is Supabase's, and the owner FK points into it. `on conflict
     do nothing` so re-runs are cheap. */
  await seedAuthUser(pool, {
    id: OWNER,
    email: `quota-race-${OWNER}@spideryarn.local`,
    onConflictDoNothing: true,
  });
}

/**
 * Make this owner a paying subscriber, in the database, the way a webhook would.
 *
 * The period **contains now**, computed rather than hardcoded: `reserveIngest`
 * reads the row under its lock and answers `stale` for a period that has
 * closed, so a fixed 2026 window would make every paid test here answer
 * `stale` the moment the clock passes it.
 */
async function makePaid(): Promise<{ start: Date; end: Date }> {
  const start = new Date(Date.now() - 5 * 24 * 3600 * 1000);
  const end = new Date(Date.now() + 25 * 24 * 3600 * 1000);
  if (pool) {
    await pool.query(
      `insert into spideryarn.billing_accounts
         (owner_id, stripe_customer_id, stripe_subscription_id, price_id, status,
          current_period_start, current_period_end)
       values ($1, $2, $3, $4, 'active', $5, $6)
       on conflict (owner_id) do update set
         stripe_customer_id = excluded.stripe_customer_id,
         stripe_subscription_id = excluded.stripe_subscription_id,
         price_id = excluded.price_id,
         status = excluded.status,
         current_period_start = excluded.current_period_start,
         current_period_end = excluded.current_period_end`,
      [OWNER, `cus_${OWNER}`, `sub_${OWNER}`, READER_PRICE, start, end],
    );
  }
  return { start, end };
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
      const b = reserveIngest(OWNER, undefined, PRICES).then((r) => {
        settled = true;
        return r;
      });

      await new Promise((r) => setTimeout(r, 400));
      /* The assertion the whole file is for. Before the anchor row existed,
         this was `true` and the quota was decorative. */
      expect(settled).toBe(false);

      await a.query("commit");
      expect((await b).kind).toBe("admitted");
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
      Array.from({ length: 20 }, () => reserveIngest(OWNER, undefined, PRICES)),
    );
    expect(results.filter((r) => r.kind === "admitted")).toHaveLength(FREE_LIFETIME_INGESTS);
    expect(results.filter((r) => r.kind === "refused")).toHaveLength(20 - FREE_LIFETIME_INGESTS);
  });

  dbIt("counts an unsettled reservation, so the next request sees it", async () => {
    expect((await reserveIngest(OWNER, undefined, PRICES)).kind).toBe("admitted");
    /* Nothing has succeeded — the job has not even been created — and the
       usage still has to include it, or N concurrent requests all read zero. */
    expect(await usageFor(OWNER, FREE)).toEqual({ used: 0, inFlight: 1 });
  });
});

describe("the entitlement is read under the lock, not handed in", () => {
  dbIt("gives a paying subscriber the Reader allowance", async () => {
    await makePaid();
    const admitted = await reserveIngest(OWNER, undefined, PRICES);
    expect(admitted).toMatchObject({ kind: "admitted" });
    if (admitted.kind !== "admitted") throw new Error("expected an admission");
    expect(admitted.entitlement).toMatchObject({ tier: "paid", tierId: "reader", limit: READER_INGESTS });
  });

  /* An entitled status on a price this build does not sell is free, not Reader.
     The failure direction matters: the other way hands out a hundred ingests a
     month for something nobody costed. */
  dbIt("falls to free when the subscription is on an unrecognised price", async () => {
    await makePaid();
    const admitted = await reserveIngest(OWNER, undefined, []);
    if (admitted.kind !== "admitted") throw new Error("expected an admission");
    expect(admitted.entitlement.tier).toBe("free");
  });

  /**
   * Neither an admission nor a refusal. Serving the free limit would falsely
   * block somebody who has paid; serving the Reader limit against a window that
   * has closed is an uncapped month.
   */
  dbIt("answers `stale` when the stored period has closed", async () => {
    if (!pool) return;
    await makePaid();
    await pool.query(
      `update spideryarn.billing_accounts
          set current_period_start = $2, current_period_end = $3
        where owner_id = $1`,
      [OWNER, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"],
    );
    const answer = await reserveIngest(OWNER, undefined, PRICES);
    expect(answer.kind).toBe("stale");
    /* And it took no slot on the way past. */
    expect(await usageFor(OWNER, FREE)).toEqual({ used: 0, inFlight: 0 });
  });

  dbIt("treats a cancelled subscription as free rather than as Reader", async () => {
    if (!pool) return;
    await makePaid();
    await pool.query("update spideryarn.billing_accounts set status = 'canceled' where owner_id = $1", [
      OWNER,
    ]);
    const admitted = await reserveIngest(OWNER, undefined, PRICES);
    if (admitted.kind !== "admitted") throw new Error("expected an admission");
    expect(admitted.entitlement.tier).toBe("free");
  });
});

describe("releasing a slot that never became a job", () => {
  dbIt("gives the allowance back", async () => {
    const taken = await Promise.all(
      Array.from({ length: FREE_LIFETIME_INGESTS }, () => reserveIngest(OWNER, undefined, PRICES)),
    );
    expect(await reserveIngest(OWNER, undefined, PRICES)).toMatchObject({ kind: "refused" });

    const first = taken[0];
    if (first?.kind !== "admitted") throw new Error("expected an admission");
    expect(await releaseReservation(first.reservationId)).toBe(true);

    expect(await reserveIngest(OWNER, undefined, PRICES)).toMatchObject({ kind: "admitted" });
  });

  dbIt("is idempotent, so a double release cannot free two slots", async () => {
    const one = await reserveIngest(OWNER, undefined, PRICES);
    if (one.kind !== "admitted") throw new Error("expected an admission");
    expect(await releaseReservation(one.reservationId)).toBe(true);
    expect(await releaseReservation(one.reservationId)).toBe(false);
    expect(await usageFor(OWNER, FREE)).toEqual({ used: 0, inFlight: 0 });
  });

  /**
   * **The one that would give an ingest away.** `enqueue()` can throw over a
   * job whose INSERT committed and whose response was lost. Releasing then
   * would leave a running job whose reservation is settled, so its publication
   * charges nothing. The `not exists` in `releaseReservation` is what stops it.
   */
  dbIt("refuses to release a reservation a job is already spending", async () => {
    if (!pool) return;
    const one = await reserveIngest(OWNER, undefined, PRICES);
    if (one.kind !== "admitted") throw new Error("expected an admission");

    /* A real minted id, not a readable one. `jobs_id_format` enforces the
       `mintId` alphabet, which drops `l`, `o`, `i` and `1` — so `spya-quotaj`
       was refused, and this test would have failed the first time it ran for a
       reason that has nothing to do with quota. Found by exercising the
       migration in a rolled-back transaction before pushing it. */
    await pool.query(
      `insert into spideryarn.jobs (id, owner_id, slug, steps, status, work_key, ingest_event_id)
       values ('spya-nrgbe3', $1, 'quota-race-article', '[]'::jsonb, 'queued', 'wk-quota', $2)`,
      [OWNER, one.reservationId],
    );
    try {
      expect(await releaseReservation(one.reservationId)).toBe(false);
      /* Still in flight, still counted. */
      expect(await usageFor(OWNER, FREE)).toEqual({ used: 0, inFlight: 1 });
    } finally {
      await pool.query("delete from spideryarn.jobs where id = 'spya-nrgbe3'");
    }
  });
});

describe("the refusal says what a reader needs", () => {
  dbIt("carries the count, the limit, and no reset date for the free tier", async () => {
    await Promise.all(
      Array.from({ length: FREE_LIFETIME_INGESTS }, () => reserveIngest(OWNER, undefined, PRICES)),
    );
    const refused = await reserveIngest(OWNER, undefined, PRICES);
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
    const { end } = await makePaid();
    /* Fill the paid allowance by hand rather than by 100 admissions. */
    await pool.query(
      `insert into spideryarn.ingest_events (owner_id, reserved_at, succeeded_at)
       select $1, now(), now() from generate_series(1, $2)`,
      [OWNER, READER_INGESTS],
    );
    const refused = await reserveIngest(OWNER, undefined, PRICES);
    expect(refused).toMatchObject({
      kind: "refused",
      used: READER_INGESTS,
      limit: READER_INGESTS,
      resetAt: end,
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
    await at(PERIOD.start); // exactly the start — inside
    await at(PERIOD.end); // exactly the end — outside
    await at("2026-08-31T23:59:59Z"); // before — outside

    expect(await usageFor(OWNER, PAID)).toEqual({ used: 1, inFlight: 0 });
    /* And the free tier's allowance is lifetime, so it sees all three. */
    expect(await usageFor(OWNER, FREE)).toEqual({ used: 3, inFlight: 0 });
  });
});
