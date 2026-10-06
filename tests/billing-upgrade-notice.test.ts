/**
 * **The admin hears about an upgrade once, after it is stored, and never
 * otherwise.** `planUpgrade` (src/billing/tiers.ts) and its one caller,
 * `syncSubscriptionFromStripe` (src/billing/sync.ts).
 *
 * The pure cases pin what counts as an upgrade. The database cases drive the
 * real sync with `listSubscriptions` and `onUpgrade` injected, because "at most
 * once" is a property of the transition read under the row lock, and a
 * transition cannot be exercised by testing the pure function alone.
 *
 * docs/plans/260930i-email-admin-on-sign-up-and-plan-upgrade.md.
 */
import type Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { withAfterResponseTasks } from "../src/after-response.js";
import { syncSubscriptionFromStripe } from "../src/billing/sync.js";
import { type PlanUpgrade, type TierRow, planUpgrade } from "../src/billing/tiers.js";
import { loadEnvLocal } from "../src/env.js";
import { forgetCachedTiers } from "../src/store/pg-tiers.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/* ------------------------------------------------------------ pure cases -- */

function tier(id: string, price: string, ingests: number): TierRow {
  return {
    id: id as TierRow["id"],
    productName: id,
    description: "",
    ingestsPerPeriod: ingests,
    lookupKey: `${id}_monthly`,
    stripePriceId: price,
    livemode: false,
    active: true,
    sortOrder: 0,
    amounts: { usd: 100 },
  };
}
const SMALL = tier("small", "price_small", 20);
const BIG = tier("big", "price_big", 150);
const TIERS = [SMALL, BIG];

describe("what counts as an upgrade", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  const period = {
    currentPeriodStart: new Date("2026-09-01T00:00:00Z"),
    currentPeriodEnd: new Date("2026-10-01T00:00:00Z"),
  };
  const none = { priceId: null, status: null };
  const small = { priceId: "price_small", status: "active", ...period };
  const big = { priceId: "price_big", status: "active", ...period };

  it("free → paid is one", () => {
    expect(planUpgrade(none, small, TIERS, now)).toEqual({ from: null, to: SMALL });
  });
  it("a lapsed subscription coming back is one", () => {
    expect(planUpgrade({ priceId: "price_small", status: "canceled" }, small, TIERS, now)).toEqual({
      from: null,
      to: SMALL,
    });
  });
  it("incomplete → active, the first payment landing, is one", () => {
    expect(planUpgrade({ priceId: "price_small", status: "incomplete" }, small, TIERS, now)).toEqual({
      from: null,
      to: SMALL,
    });
  });
  it("smaller → larger is one", () => {
    expect(planUpgrade(small, big, TIERS, now)).toEqual({ from: SMALL, to: BIG });
  });
  it("a trial starting is one — the plan began", () => {
    expect(planUpgrade(none, { priceId: "price_small", status: "trialing", ...period }, TIERS, now)).toEqual(
      { from: null, to: SMALL },
    );
  });
  it("a renewal, a recovery, a downgrade and a cancellation are not", () => {
    expect(planUpgrade(small, small, TIERS, now)).toBeNull();
    expect(planUpgrade({ priceId: "price_small", status: "past_due" }, small, TIERS, now)).toBeNull();
    expect(planUpgrade({ priceId: "price_small", status: "unpaid" }, small, TIERS, now)).toBeNull();
    expect(planUpgrade({ priceId: "price_small", status: "paused" }, small, TIERS, now)).toBeNull();
    expect(planUpgrade(big, small, TIERS, now)).toBeNull();
    expect(
      planUpgrade(
        small,
        { priceId: "price_small", status: "canceled", ...period },
        TIERS,
        now,
      ),
    ).toBeNull();
    expect(planUpgrade(small, null, TIERS, now)).toBeNull();
  });
  it("a price no tier sells is not one", () => {
    expect(
      planUpgrade(none, { priceId: "price_unknown", status: "active", ...period }, TIERS, now),
    ).toBeNull();
  });
  it("an active subscription whose period is stale entitles nothing, so is not an upgrade", () => {
    expect(
      planUpgrade(
        none,
        {
          priceId: "price_small",
          status: "active",
          currentPeriodStart: new Date("2026-08-01T00:00:00Z"),
          currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
        },
        TIERS,
        now,
      ),
    ).toBeNull();
  });
});

/* -------------------------------------------------------- database cases -- */

loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/billing-upgrade-notice.test.ts",
  tables: ["spideryarn.billing_accounts", "spideryarn.billing_tiers"],
  keepPool: true,
  max: 2,
});

const OWNER = "6e7a11ce-0000-4000-8000-00000000b6f1";
const CUSTOMER = `cus_${OWNER}`;
const SUBSCRIPTION = `sub_${OWNER}`;
const READER = { id: "test-notice-reader", price: "price_test_notice_reader", ingests: 20 };
const RESEARCHER = { id: "test-notice-researcher", price: "price_test_notice_researcher", ingests: 150 };
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  await sweep();
  await seedAuthUser(pool, { id: OWNER, email: "upgrade-notice@example.invalid" });
  for (const [i, t] of [READER, RESEARCHER].entries()) {
    /* Inactive, as tests/billing-quota-adjustment.test.ts explains: still
       honoured by `tierForPrice`, invisible to the suites over active rows. */
    await pool.query(
      `insert into spideryarn.billing_tiers
         (id, product_name, description, ingests_per_period, lookup_key, stripe_price_id,
          livemode, active, sort_order)
       values ($1, $1, 'Sold only by tests/billing-upgrade-notice.test.ts.', $2, $3, $4, false, false, $5)
       on conflict (id) do nothing`,
      [t.id, t.ingests, `${t.id}_monthly`, t.price, 920 + i],
    );
  }
  forgetCachedTiers();
});

beforeEach(sweep);

afterAll(async () => {
  await sweep();
  await pool.query("delete from spideryarn.billing_tiers where id = any($1)", [
    [READER.id, RESEARCHER.id],
  ]);
  await pool.query("delete from auth.users where id = $1", [OWNER]).catch(() => {});
  forgetCachedTiers();
  await pool.end();
});

async function sweep(): Promise<void> {
  await pool.query("delete from spideryarn.billing_accounts where owner_id = $1", [OWNER]);
  forgetCachedTiers();
}

/** A reader who has a Stripe customer and nothing bought — how checkout leaves them. */
async function freeAccount(): Promise<void> {
  await pool.query(
    `insert into spideryarn.billing_accounts (owner_id, stripe_customer_id) values ($1, $2)`,
    [OWNER, CUSTOMER],
  );
}

function subscription(
  priceId: string,
  status = "active",
  periodDays: { readonly start: number; readonly end: number } = { start: -1, end: 29 },
): Stripe.Subscription {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: SUBSCRIPTION,
    object: "subscription",
    status,
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    livemode: false,
    items: {
      object: "list",
      data: [
        {
          id: "si_test_notice",
          object: "subscription_item",
          quantity: 1,
          current_period_start: now + (periodDays.start * DAY) / 1000,
          current_period_end: now + (periodDays.end * DAY) / 1000,
          price: {
            id: priceId,
            object: "price",
            type: "recurring",
            recurring: { interval: "month", interval_count: 1 },
          },
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

/** Run the real sync; return every upgrade it announced. */
async function sync(subscriptions: Stripe.Subscription[]): Promise<PlanUpgrade[]> {
  const heard: PlanUpgrade[] = [];
  const result = await syncSubscriptionFromStripe(CUSTOMER, {
    listSubscriptions: async () => subscriptions,
    onUpgrade: async (ownerId, upgrade) => {
      expect(ownerId).toBe(OWNER);
      /* A callback inside the transaction would either see the old price on
         this second connection or wait on the row lock. The notice belongs
         strictly after the durable state change. */
      const { rows } = await pool.query(
        "select price_id from spideryarn.billing_accounts where owner_id = $1",
        [OWNER],
      );
      expect(rows[0]?.price_id).toBe(upgrade.to.stripePriceId);
      heard.push(upgrade);
    },
  });
  /* A sync that found no owner announces nothing, and looks like success. */
  expect(result).toMatchObject({ kind: "synced" });
  return heard;
}

describe("the sync announces an upgrade once", () => {
  it("a first purchase is announced, and its redelivery is not", async () => {
    await freeAccount();
    const first = await sync([subscription(READER.price)]);
    expect(first.map((u) => [u.from?.id ?? null, u.to.id])).toEqual([[null, READER.id]]);

    /* The same event again — a Stripe retry, or the confirm route behind the webhook. */
    expect(await sync([subscription(READER.price)])).toEqual([]);
  });

  it("Reader → Researcher is announced; the downgrade back is not", async () => {
    await freeAccount();
    await sync([subscription(READER.price)]);
    const up = await sync([subscription(RESEARCHER.price)]);
    expect(up.map((u) => [u.from?.id, u.to.id])).toEqual([[READER.id, RESEARCHER.id]]);
    expect(await sync([subscription(READER.price)])).toEqual([]);
  });

  it("a checkout whose first payment has not landed is not announced until it does", async () => {
    await freeAccount();
    expect(await sync([subscription(READER.price, "incomplete")])).toEqual([]);
    expect((await sync([subscription(READER.price)])).length).toBe(1);
  });

  it("an unpaid plan recovering to active is not announced as a new purchase", async () => {
    await freeAccount();
    expect(await sync([subscription(READER.price, "unpaid")])).toEqual([]);
    expect(await sync([subscription(READER.price)])).toEqual([]);
  });

  it("does not announce the diagnostic row for an active but stale period", async () => {
    await freeAccount();
    expect(await sync([subscription(READER.price, "active", { start: -60, end: -30 })])).toEqual([]);
  });

  it("a notifier that throws does not fail the sync, and the change is stored", async () => {
    await freeAccount();
    const result = await syncSubscriptionFromStripe(CUSTOMER, {
      listSubscriptions: async () => [subscription(READER.price)],
      onUpgrade: async () => {
        throw new Error("Resend is down");
      },
    });
    expect(result).toMatchObject({ kind: "synced", status: "active" });
    const { rows } = await pool.query(
      "select price_id from spideryarn.billing_accounts where owner_id = $1",
      [OWNER],
    );
    expect(rows[0]?.price_id).toBe(READER.price);
  });

  it("starts the notice only after the response callback, while keeping the invocation alive", async () => {
    await freeAccount();
    let responseWritten = false;
    let releaseNotice = () => {};
    const noticeMayFinish = new Promise<void>((resolve) => {
      releaseNotice = resolve;
    });
    let markStarted = () => {};
    const noticeStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });

    let invocationFinished = false;
    const invocation = withAfterResponseTasks(async () => {
      const result = await syncSubscriptionFromStripe(CUSTOMER, {
        listSubscriptions: async () => [subscription(READER.price)],
        onUpgrade: async () => {
          markStarted();
          await noticeMayFinish;
        },
      });
      /* This callback stands for the route writing and ending its response. */
      responseWritten = true;
      return result;
    });
    void invocation.then(() => {
      invocationFinished = true;
    });

    await noticeStarted;
    const startedAfterResponse = responseWritten;
    const stayedAliveForNotice = !invocationFinished;
    releaseNotice();
    await invocation;

    expect(startedAfterResponse).toBe(true);
    expect(stayedAliveForNotice).toBe(true);
  });
});
