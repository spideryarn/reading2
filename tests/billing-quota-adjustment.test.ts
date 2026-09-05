/**
 * **The allowance prorates, because the price does.**
 *
 * Stripe prorates the *money* on a mid-period plan change and — until this file
 * — we handed over the *allowance* whole. That mismatch is the whole bug family:
 * upgrade with an hour left in the period for a few pence of proration, take the
 * full 150 ingests, downgrade before the roll, repeat every month. Researcher
 * volume at roughly the Reader price, and scriptable. The objection *nobody uses
 * 130 ingests in an hour* does not survive contact with what the quota is for —
 * it is an abuse boundary against a script, and a script can.
 *
 * docs/plans/260903i-fix-the-upgrade-path-and-the-cancellation-telling.md § Stage 3b.
 *
 * ## What is being tested, and why it is not a fixture row
 *
 * The arithmetic is a **transition**: what the row said before, against what
 * Stripe says now. A fixture row on its own cannot exercise one. So the cases
 * below drive the real `syncSubscriptionFromStripe` against a real database with
 * the *subscription list* injected — the one seam (src/billing/sync.ts) — and
 * then ask **what the wall answers**, through `ingestEligibility`, rather than
 * what is in the column. The column is an implementation detail; the refusal is
 * the product.
 *
 * The two places a column *is* asserted are the ones where clearing it is the
 * whole outcome, and where the wall cannot see the difference: the read side
 * refuses to apply an override belonging to another period, so a sync that
 * forgot to clear one and a sync that cleared it look identical from outside.
 * Both guards are wanted, and both therefore need their own pin.
 *
 * The arithmetic itself has a second half at the bottom of this file, without a
 * database: every branch of the ordering rule, the clamps, and the property the
 * whole design rests on — that no sequence of switches can gain.
 *
 * Skips loudly when there is no database (tests/helpers/pg-ready.ts). Check a
 * change with `REQUIRE_POSTGRES=1` and read the **count**: a skip looks exactly
 * like a pass. The pure half does not skip.
 */
import type Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  NO_ADJUSTMENT,
  fractionRemaining,
  limitForPeriod,
  nextQuotaAdjustment,
} from "../src/billing/quota-adjustment.js";
import { articles } from "../src/billing/half-units.js";
import type { QuotaAdjustment, QuotaRules } from "../src/billing/quota-adjustment.js";
import { syncSubscriptionFromStripe } from "../src/billing/sync.js";
import { loadEnvLocal } from "../src/env.js";
import { ingestEligibility } from "../src/store/pg-billing.js";
import { forgetCachedTiers } from "../src/store/pg-tiers.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/** Before `pgReady`: vitest does not load `.env.local` on its own. */
loadEnvLocal();

const { reachable, pool } = await pgReady({
  suite: "tests/billing-quota-adjustment.test.ts",
  tables: ["spideryarn.billing_accounts", "spideryarn.ingest_events", "spideryarn.billing_tiers"],
  keepPool: true,
  max: 4,
});

const dbIt = reachable ? it : it.skip;

/** This file's own reader. Fixed, so a run killed halfway is swept by the next. */
const OWNER = "0b1113b0-0000-4000-8000-00000000e3b0";
const CUSTOMER = `cus_${OWNER}`;
const SUBSCRIPTION = `sub_${OWNER}`;

/**
 * Two tiers this file sells and nobody else does.
 *
 * `active = false` for the reason tests/billing-admission.test.ts gives:
 * `tierForPrice` deliberately still matches an inactive tier, so entitlement
 * works, while tests/billing-tiers.test.ts asserts over the **active** rows and
 * cannot see these.
 *
 * The two allowances are the real ones, 20 and 150, because the arithmetic in
 * the plan is written in them and a reader comparing the two should not have to
 * translate.
 */
const READER = {
  id: "test-quota-reader",
  price: "price_test_quota_reader",
  ingests: 20,
  /* Nothing like the allowance, and nothing like the other tier's, so that
     arithmetic wired to the wrong column reddens here as well as in
     tests/billing-tiers.test.ts — see the seam note there. */
  sortOrder: 910,
};
const RESEARCHER = {
  id: "test-quota-researcher",
  price: "price_test_quota_researcher",
  ingests: 150,
  sortOrder: 911,
};

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/**
 * Now, truncated to the second — and it has to be, twice over.
 *
 * Stripe carries a period as **unix seconds**, so a fixture built from a
 * millisecond `Date` comes back from `readSubscription` rounded down, and then
 * neither matches the row the fixture wrote. The whole "same period" branch
 * would silently become the "different period" one, every case would read the
 * plain tier limit, and the suite would be testing the code it was written to
 * replace.
 */
function wholeSecond(): Date {
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}

/**
 * Three days and an hour left of thirty — the period almost every case wants,
 * and the reason it is a function rather than two lines each time.
 *
 * **The hour is not decoration.** At exactly three days the Reader → Researcher
 * arithmetic lands on 33.0, and the few milliseconds between building the
 * fixture and running the sync then decide which side of the floor it falls —
 * two cases in this file were first written without it and came out at 32. Off
 * the boundary, that drift moves the answer by about 1e-7. One helper so that
 * the next fixture cannot walk into it either.
 */
function threeDaysLeft(now: Date): { periodStart: Date; periodEnd: Date } {
  return {
    periodStart: new Date(now.getTime() - (27 * DAY - HOUR)),
    periodEnd: new Date(now.getTime() + (3 * DAY + HOUR)),
  };
}

beforeAll(async () => {
  if (!pool) return;
  await sweep();
  await seedAuthUser(pool, { id: OWNER, email: `quota-adjustment-@example.invalid` });
  for (const tier of [READER, RESEARCHER]) {
    await pool.query(
      `insert into spideryarn.billing_tiers
         (id, product_name, description, ingests_per_period, lookup_key, stripe_price_id,
          livemode, active, sort_order)
       values ($1, 'A proration fixture', 'Sold only by tests/billing-quota-adjustment.test.ts.',
               $2, $3, $4, false, false, $5)
       on conflict (id) do nothing`,
      [tier.id, tier.ingests, `${tier.id}_monthly`, tier.price, tier.sortOrder],
    );
  }
  forgetCachedTiers();
});

beforeEach(sweep);

afterAll(async () => {
  if (!pool) return;
  await sweep();
  await pool.query("delete from spideryarn.billing_tiers where id = any($1)", [
    [READER.id, RESEARCHER.id],
  ]);
  await pool.query("delete from auth.users where id = $1", [OWNER]).catch(() => {});
  forgetCachedTiers();
  await pool.end();
});

async function sweep(): Promise<void> {
  if (!pool) return;
  await clearSpending();
  await pool.query("delete from spideryarn.billing_accounts where owner_id = $1", [OWNER]);
  forgetCachedTiers();
}

/** The ledger only — for a case that asks the wall twice in two periods. */
async function clearSpending(): Promise<void> {
  if (!pool) return;
  await pool.query("delete from spideryarn.ingest_events where owner_id = $1", [OWNER]);
}

/* ------------------------------------------------------------- the fixtures -- */

/** The row the last webhook would have written. */
async function storedRow(fields: {
  priceId: string;
  periodStart: Date;
  periodEnd: Date;
  status?: string;
}): Promise<void> {
  if (!pool) return;
  await pool.query(
    `insert into spideryarn.billing_accounts
       (owner_id, stripe_customer_id, stripe_subscription_id, price_id, status,
        current_period_start, current_period_end)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (owner_id) do update set
       stripe_customer_id = excluded.stripe_customer_id,
       stripe_subscription_id = excluded.stripe_subscription_id,
       price_id = excluded.price_id,
       status = excluded.status,
       current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end`,
    [
      OWNER,
      CUSTOMER,
      SUBSCRIPTION,
      fields.priceId,
      fields.status ?? "active",
      fields.periodStart,
      fields.periodEnd,
    ],
  );
}

/** A subscription of the shape the pinned API version returns. Unix seconds. */
function subscription(fields: {
  priceId: string;
  periodStart: Date;
  periodEnd: Date;
  id?: string;
  status?: string;
  cancelAt?: Date | null;
  cancelAtPeriodEnd?: boolean;
  livemode?: boolean;
}): Stripe.Subscription {
  const seconds = (d: Date) => Math.floor(d.getTime() / 1000);
  return {
    id: fields.id ?? SUBSCRIPTION,
    object: "subscription",
    status: fields.status ?? "active",
    cancel_at_period_end: fields.cancelAtPeriodEnd ?? false,
    cancel_at: fields.cancelAt ? seconds(fields.cancelAt) : null,
    canceled_at: null,
    livemode: fields.livemode ?? false,
    items: {
      object: "list",
      data: [
        {
          id: "si_test_quota",
          object: "subscription_item",
          quantity: 1,
          current_period_start: seconds(fields.periodStart),
          current_period_end: seconds(fields.periodEnd),
          price: {
            id: fields.priceId,
            object: "price",
            type: "recurring",
            recurring: { interval: "month", interval_count: 1 },
          },
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

/**
 * Run the real sync with the subscription list injected.
 *
 * The allowance is prorated at the instant the sync runs, which is the only
 * instant this function has — see *does not let an older event scale a change it
 * did not cause* for why there is no second one.
 */
async function sync(subscriptions: Stripe.Subscription[]): Promise<void> {
  const result = await syncSubscriptionFromStripe(CUSTOMER, {
    listSubscriptions: async () => subscriptions,
  });
  /* A sync that found no owner would leave every assertion below testing
     nothing, and it looks exactly like one that worked. */
  expect(result).toMatchObject({ kind: "synced" });
}

/** Successful ingests already spent inside the current period. */
async function alreadySpent(n: number): Promise<void> {
  if (!pool || n <= 0) return;
  await pool.query(
    `insert into spideryarn.ingest_events (owner_id, reserved_at, succeeded_at)
     select $1, now(), now() from generate_series(1, $2)`,
    [OWNER, n],
  );
}

/** What the row stores. Read only where clearing it is the whole outcome. */
async function storedAdjustment(): Promise<{ delta: number | null; periodStart: Date | null }> {
  const row = await storedBillingRow();
  return { delta: row.quota_limit_delta, periodStart: row.quota_period_start };
}

/** The period the row is metering against — see `records the period Stripe reported`. */
async function storedPeriod(): Promise<{ start: Date | null; end: Date | null }> {
  const row = await storedBillingRow();
  return { start: row.current_period_start, end: row.current_period_end };
}

interface StoredBillingRow {
  quota_limit_delta: number | null;
  quota_period_start: Date | null;
  current_period_start: Date | null;
  current_period_end: Date | null;
}

async function storedBillingRow(): Promise<StoredBillingRow> {
  if (!pool) {
    return {
      quota_limit_delta: null,
      quota_period_start: null,
      current_period_start: null,
      current_period_end: null,
    };
  }
  const { rows } = await pool.query<StoredBillingRow>(
    `select quota_limit_delta, quota_period_start, current_period_start, current_period_end
       from spideryarn.billing_accounts where owner_id = $1`,
    [OWNER],
  );
  const row = rows[0];
  if (!row) throw new Error("no billing_accounts row");
  return row;
}

/**
 * **Pin the limit the wall enforces, from both sides.**
 *
 * `Refused` is the only place the number is stated out loud, so the refusal is
 * what the assertion reads — and one ingest short of it must still be admitted,
 * or "refused at 33" would also pass for a limit of 4. Asking the column instead
 * would be asking our own arithmetic what our own arithmetic decided.
 *
 * Spends `expected` ingests, so it is the last thing a case does unless it
 * calls `clearSpending`.
 */
async function expectWallLimit(expected: number): Promise<void> {
  forgetCachedTiers();
  await alreadySpent(expected - 1);
  expect(await ingestEligibility(OWNER)).toMatchObject({ kind: "eligible" });
  await alreadySpent(1);
  expect(await ingestEligibility(OWNER)).toMatchObject({
    kind: "refused",
    limit: expected,
    used: expected,
  });
}

/* ------------------------------------------------------ a mid-period change -- */

describe("a plan change mid-period moves the allowance by what is left of the period", () => {
  /**
   * **The exploit, closed.** Three days and an hour left of a thirty-day period
   * is 0.1014 of it, so the extra 130 ingests are worth 13, and the limit goes
   * from 20 to 33 — which is what the ~$4 of proration actually bought.
   *
   * The hour is not decoration: at exactly three days the arithmetic lands on
   * 33.0, where a few milliseconds of clock drift between the fixture and the
   * sync would decide the floor. Off the boundary, drift moves it by 1e-7.
   */
  dbIt("hands over three days' worth of Researcher, not a month's", async () => {
    const now = wholeSecond();
    const { periodStart, periodEnd } = threeDaysLeft(now);
    await storedRow({ priceId: READER.price, periodStart, periodEnd });

    await sync([subscription({ priceId: RESEARCHER.price, periodStart, periodEnd })]);

    await expectWallLimit(33);
  });

  /** An upgrade on the day of renewal is worth very nearly the whole difference. */
  dbIt("hands over the whole difference when the period has barely started", async () => {
    const now = wholeSecond();
    const periodStart = new Date(now.getTime() - 2 * HOUR);
    const periodEnd = new Date(now.getTime() + (30 * DAY - 2 * HOUR));
    await storedRow({ priceId: READER.price, periodStart, periodEnd });

    await sync([subscription({ priceId: RESEARCHER.price, periodStart, periodEnd })]);

    /* 20 + floor(130 × 0.997222) = 20 + 129 = 149. One short of 150, and
       deliberately: the accumulated limit is floored rather than rounded,
       because rounding each change independently is a ratchet a script can
       turn — src/billing/quota-adjustment.ts. */
    await expectWallLimit(149);
  });

  /** The step the whole exploit rests on: an hour left is worth almost nothing. */
  dbIt("hands over nearly nothing when there is an hour of the period left", async () => {
    const now = wholeSecond();
    const periodStart = new Date(now.getTime() - (30 * DAY - HOUR));
    const periodEnd = new Date(now.getTime() + HOUR);
    await storedRow({ priceId: READER.price, periodStart, periodEnd });

    await sync([subscription({ priceId: RESEARCHER.price, periodStart, periodEnd })]);

    /* 130 / 720 = 0.18 of an ingest, and the reader keeps the 20 they paid for. */
    await expectWallLimit(20);
  });

  /** And the same arithmetic downwards, because the money credits the same way. */
  dbIt("takes the allowance back down on a downgrade", async () => {
    const now = wholeSecond();
    const periodStart = new Date(now.getTime() - (3 * DAY + HOUR));
    const periodEnd = new Date(now.getTime() + (27 * DAY - HOUR));
    await storedRow({ priceId: RESEARCHER.price, periodStart, periodEnd });

    await sync([subscription({ priceId: READER.price, periodStart, periodEnd })]);

    /* floor(150 − 130 × 0.898611) = floor(33.18) = 33. */
    await expectWallLimit(33);
  });

  /**
   * **Up, down, up in one period does not ratchet.** Each step is an honest
   * fraction of what is left, and the three of them telescope: the reader ends
   * where a single change at the last instant would have put them, not
   * 130 ingests higher.
   */
  dbIt("does not let up-down-up cycling accumulate allowance", async () => {
    const now = wholeSecond();
    const periodStart = new Date(now.getTime() - (15 * DAY + HOUR));
    const periodEnd = new Date(now.getTime() + (15 * DAY - HOUR));
    await storedRow({ priceId: READER.price, periodStart, periodEnd });
    const asResearcher = [subscription({ priceId: RESEARCHER.price, periodStart, periodEnd })];
    const asReader = [subscription({ priceId: READER.price, periodStart, periodEnd })];

    for (let cycle = 0; cycle < 5; cycle += 1) {
      await sync(asResearcher);
      await sync(asReader);
    }
    await sync(asResearcher);

    /* Half the period is left, so each step is worth 130 × 359/720 = 64.819.
       Eleven of them, each floored: 84, 19, 83, 18, 82, 17, 81, 16, 80, 15, 79.
       **The drift is downwards**, one ingest per switch, which is the whole
       safety property — flooring the accumulated limit rather than rounding
       each delta means a cycle can never gain, and a script that switches two
       hundred times ends up worse off than one that switches once (84).
       src/billing/quota-adjustment.ts carries the proof. */
    await expectWallLimit(79);
  });
});

/* --------------------------------------------------------------- the order -- */

describe("which period an override belongs to", () => {
  /**
   * **A Stripe retry must not double-apply.** The delta needs the transition,
   * so the stored price has to be updated in the same locked write as the
   * override — otherwise the second delivery reads the *old* price beside the
   * new one and pays the difference out all over again.
   */
  dbIt("does not hand the difference over twice when the webhook is delivered twice", async () => {
    const now = wholeSecond();
    const { periodStart, periodEnd } = threeDaysLeft(now);
    await storedRow({ priceId: READER.price, periodStart, periodEnd });
    const upgraded = [subscription({ priceId: RESEARCHER.price, periodStart, periodEnd })];

    await sync(upgraded);
    await sync(upgraded);
    await sync(upgraded);

    await expectWallLimit(33);
  });

  /**
   * **The period rolls and the override goes with it**, so the reader gets the
   * whole allowance they are now paying for.
   *
   * The column is asserted rather than the wall, because the wall cannot tell
   * the difference: the read side already refuses to apply an override whose
   * period is not this one, so a sync that forgot to clear it would still meter
   * at 150. Both guards are wanted; this is the pin for the one in sync.
   */
  dbIt("clears the override when the period rolls over", async () => {
    const now = wholeSecond();
    const { periodStart, periodEnd } = threeDaysLeft(now);
    await storedRow({ priceId: READER.price, periodStart, periodEnd });
    await sync([subscription({ priceId: RESEARCHER.price, periodStart, periodEnd })]);
    expect(await storedAdjustment()).toEqual({ delta: -117, periodStart });

    const nextEnd = new Date(periodEnd.getTime() + 30 * DAY);
    await sync([
      subscription({ priceId: RESEARCHER.price, periodStart: periodEnd, periodEnd: nextEnd }),
    ]);

    expect(await storedAdjustment()).toEqual({ delta: null, periodStart: null });
  });

  /**
   * **The window moves with the roll, and nothing else in the suite says so.**
   *
   * Found by mutation: making sync write `current_period_start` from the row it
   * just read rather than from Stripe reddened **nothing** across the eighty-odd
   * billing tests, while leaving a renewed subscriber metered against last
   * month's window for ever. Sync's *every field on every sync* property is the
   * thing under test, and this file is the only one that drives sync end to end,
   * so the pin belongs here.
   */
  dbIt("records the period Stripe reported, not the one already in the row", async () => {
    const now = wholeSecond();
    const { periodStart, periodEnd } = threeDaysLeft(now);
    await storedRow({ priceId: READER.price, periodStart, periodEnd });

    const nextEnd = new Date(periodEnd.getTime() + 30 * DAY);
    await sync([
      subscription({ priceId: READER.price, periodStart: periodEnd, periodEnd: nextEnd }),
    ]);

    expect(await storedPeriod()).toEqual({ start: periodEnd, end: nextEnd });
  });

  /**
   * **An override belonging to another period is not applied**, which is the
   * read side's half of the same rule — and the half that holds even if a future
   * change to sync forgets to clear one.
   */
  dbIt("meters on the tier when the stored override belongs to another period", async () => {
    if (!pool) return;
    const now = wholeSecond();
    const periodStart = new Date(now.getTime() - 3 * DAY);
    const periodEnd = new Date(now.getTime() + 27 * DAY);
    await storedRow({ priceId: RESEARCHER.price, periodStart, periodEnd });
    await pool.query(
      `update spideryarn.billing_accounts
         set quota_limit_delta = 5, quota_period_start = $2
       where owner_id = $1`,
      [OWNER, new Date(periodStart.getTime() - 30 * DAY)],
    );

    await expectWallLimit(RESEARCHER.ingests);
  });

  /**
   * **An older event must not scale a newer transition.**
   *
   * The webhook handles four event types the same way and then fetches *current*
   * state, so the event that provokes a sync is not necessarily the event that
   * caused the change it finds. A `checkout.session.completed` retry from day 17
   * can arrive after a day-20 upgrade and discover it. Stripe's `created` is the
   * moment the **event object** was made, and nothing ties it to the transition.
   *
   * So the allowance is prorated at the sync, and the only thing that decides it
   * is the period this sync is happening in. The delay costs accuracy — see the
   * residual defect in the plan doc — and it costs it in a bounded, one-directional
   * way, which is better than being wrong in whichever direction a stale
   * timestamp happens to point. GPT Sol, 2026-09-04, reproduced.
   */
  dbIt("does not let an older event scale a change it did not cause", async () => {
    const now = wholeSecond();
    /* Day 20 of 30. The stale event would claim day 17. */
    const periodStart = new Date(now.getTime() - 20 * DAY);
    const periodEnd = new Date(now.getTime() + 10 * DAY);
    await storedRow({ priceId: READER.price, periodStart, periodEnd });

    await sync([subscription({ priceId: RESEARCHER.price, periodStart, periodEnd })]);

    /* floor(20 + 130 × 10/30) = 63. Scaled at the stale event's day 17 it was
       **76**, and an immediate downgrade then left 32 rather than 20. */
    await expectWallLimit(63);
  });

  /**
   * **A different subscription is not a plan change, even when the periods
   * start in the same second.**
   *
   * `billing_accounts` stores `stripe_subscription_id`, and the quota
   * calculation did not receive it — so the winner changing from a Researcher to
   * a separate Reader read as a mid-period downgrade and prorated one, giving 85
   * where the Reader's own 20 is the answer. Two subscriptions created in the
   * same Stripe second share a period start, so the period test alone cannot
   * tell them apart. GPT Sol, 2026-09-04, reproduced.
   */
  dbIt("does not prorate when a different subscription starts the same second", async () => {
    const now = wholeSecond();
    const periodStart = new Date(now.getTime() - 15 * DAY);
    const periodEnd = new Date(now.getTime() + 15 * DAY);
    await storedRow({ priceId: RESEARCHER.price, periodStart, periodEnd });

    /* A different subscription entirely, on the same period to the second. */
    await sync([
      subscription({
        id: "sub_test_quota_other",
        priceId: READER.price,
        periodStart,
        periodEnd,
      }),
    ]);

    expect(await storedAdjustment()).toEqual({ delta: null, periodStart: null });
    await expectWallLimit(READER.ingests);
  });

  /**
   * **A tier raise must reach an account that has changed plan mid-period.**
   *
   * Raising a quota is one `UPDATE` and no deploy — docs/project/billing.md — and
   * an override that stored an *absolute* limit silently opted its account out of
   * every future raise, for ever. Storing what the change was *worth* rather than
   * what it left keeps the tier table in charge of the base.
   * GPT Sol, 2026-09-04, reproduced.
   */
  dbIt("follows a tier raise for an account carrying an override", async () => {
    if (!pool) return;
    const now = wholeSecond();
    const { periodStart, periodEnd } = threeDaysLeft(now);
    await storedRow({ priceId: READER.price, periodStart, periodEnd });
    await sync([subscription({ priceId: RESEARCHER.price, periodStart, periodEnd })]);
    await expectWallLimit(33);

    /* The documented one-`UPDATE` raise, on the tier they are actually on. */
    await clearSpending();
    await pool.query("update spideryarn.billing_tiers set ingests_per_period = 200 where id = $1", [
      RESEARCHER.id,
    ]);
    try {
      /* The upgrade was worth 117 fewer than a whole Researcher month, and it
         still is: 200 − 117 = 83. Storing 33 outright would leave them at 33. */
      await expectWallLimit(83);
    } finally {
      await pool.query(
        "update spideryarn.billing_tiers set ingests_per_period = $2 where id = $1",
        [RESEARCHER.id, RESEARCHER.ingests],
      );
      forgetCachedTiers();
    }
  });

  /**
   * **Cancel and resubscribe needs no branch**, and this is the check that it
   * falls out rather than being handled. A new subscription mints a new period
   * at full price with no proration credit, so the reader is buying more rather
   * than taking it, and the period test alone is what notices.
   */
  dbIt("gives a freshly-bought subscription its whole allowance", async () => {
    const now = wholeSecond();
    const { periodStart, periodEnd } = threeDaysLeft(now);
    await storedRow({ priceId: READER.price, periodStart, periodEnd });
    await sync([subscription({ priceId: RESEARCHER.price, periodStart, periodEnd })]);
    expect(await storedAdjustment()).toEqual({ delta: -117, periodStart });

    /* The old one cancelled, and a new one bought a minute ago. */
    const freshStart = new Date(now.getTime() - 60 * 1000);
    await sync([
      subscription({
        id: "sub_test_quota_second",
        priceId: RESEARCHER.price,
        periodStart: freshStart,
        periodEnd: new Date(freshStart.getTime() + 30 * DAY),
      }),
    ]);

    expect(await storedAdjustment()).toEqual({ delta: null, periodStart: null });
    await expectWallLimit(RESEARCHER.ingests);
  });
});

/* ------------------------------------------------------ what one sync writes -- */

/**
 * **Every field, on every sync — the property, not one column of it.**
 *
 * These are pins on `syncSubscriptionFromStripe` rather than on the override,
 * and they live here because **this is the only file that drives sync end to
 * end**. They exist because M12 was found by accident: a slip that made sync
 * write `current_period_start` from the row it had just read rather than from
 * Stripe reddened nothing across the whole billing suite, while leaving a
 * renewed subscriber metered against last month's window for ever. One column
 * had a pin by then; the other eight did not, and the class is the same for all
 * of them. src/billing/sync.ts § *every field written on every sync*.
 */
describe("what one sync writes", () => {
  /** Everything the write touches, so a column that stopped moving is visible. */
  async function wholeRow(): Promise<Record<string, unknown>> {
    if (!pool) return {};
    const { rows } = await pool.query(
      `select stripe_subscription_id, price_id, status, current_period_start,
              current_period_end, cancel_at_period_end, cancel_at, livemode,
              quota_limit_delta, quota_period_start, last_synced_at
         from spideryarn.billing_accounts where owner_id = $1`,
      [OWNER],
    );
    const row = rows[0];
    if (!row) throw new Error("no billing_accounts row");
    return row as Record<string, unknown>;
  }

  dbIt("writes every field from what Stripe said, not from what the row said", async () => {
    const now = wholeSecond();
    const periodStart = new Date(now.getTime() - 5 * DAY);
    const periodEnd = new Date(now.getTime() + 25 * DAY);
    const endsAt = new Date(periodEnd.getTime());
    /* A row that disagrees with Stripe in every field it can. */
    await storedRow({
      priceId: READER.price,
      periodStart: new Date(now.getTime() - 40 * DAY),
      periodEnd: new Date(now.getTime() - 10 * DAY),
      status: "past_due",
    });

    await sync([
      subscription({
        id: "sub_test_quota_whole_row",
        priceId: RESEARCHER.price,
        periodStart,
        periodEnd,
        status: "trialing",
        cancelAt: endsAt,
        cancelAtPeriodEnd: true,
        livemode: true,
      }),
    ]);

    const row = await wholeRow();
    expect(row).toMatchObject({
      stripe_subscription_id: "sub_test_quota_whole_row",
      price_id: RESEARCHER.price,
      status: "trialing",
      current_period_start: periodStart,
      current_period_end: periodEnd,
      cancel_at_period_end: true,
      cancel_at: endsAt,
      livemode: true,
      /* A different period from the stored one, so the override is cleared
         rather than carried — the ordering rule, seen from the row. */
      quota_limit_delta: null,
      quota_period_start: null,
    });
    /* And the diagnostic that the change window is measured from moves too. */
    expect(row.last_synced_at).toBeInstanceOf(Date);
    expect((row.last_synced_at as Date).getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  /**
   * **And clears them all when Stripe has nothing to say**, which is the half a
   * partial update would break: a cancelled subscription keeping a period that
   * makes it look current is exactly how somebody stays entitled for free.
   */
  dbIt("clears every field when the customer has no subscription we can meter", async () => {
    const now = wholeSecond();
    const { periodStart, periodEnd } = threeDaysLeft(now);
    await storedRow({ priceId: READER.price, periodStart, periodEnd });
    await sync([subscription({ priceId: RESEARCHER.price, periodStart, periodEnd })]);
    expect(await storedAdjustment()).toEqual({ delta: -117, periodStart });

    await sync([]);

    expect(await wholeRow()).toMatchObject({
      stripe_subscription_id: null,
      price_id: null,
      status: null,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      cancel_at: null,
      livemode: null,
      quota_limit_delta: null,
      quota_period_start: null,
    });
  });

  /**
   * **The price is read and moved inside one critical section**, which is the
   * property the override needs and the plain lock does not give on its own.
   *
   * The first version of this case asserted only that the sync *waits*, and
   * **that version passed with `.for("update")` deleted** — because the holder's
   * row lock blocks sync's final `UPDATE` whether or not its `SELECT` was
   * locked. It was measuring a true thing that was not the thing it was named
   * for: an unlocked sync waits too, having already read a stale price.
   *
   * So the row is *changed* while the sync is in flight. Under the lock the
   * `SELECT` blocks and — at `read committed` — re-reads the newest committed
   * version when the holder commits, so the sync sees the price already moved,
   * finds nothing to prorate, and leaves the override alone. Without the lock it
   * read the old price before the holder committed, and overwrites a transition
   * that had already happened with a delta measured from state that is gone.
   *
   * tests/billing-quota-race.test.ts § *a held transaction beats a race* is the
   * same shape: assert the blocking rather than hoping for an interleaving.
   */
  dbIt("reads and moves the price inside one critical section", async () => {
    if (!pool) return;
    const now = wholeSecond();
    const { periodStart, periodEnd } = threeDaysLeft(now);
    await storedRow({ priceId: READER.price, periodStart, periodEnd });

    const holder = await pool.connect();
    let settled = false;
    try {
      await holder.query("begin");
      await holder.query(
        "select 1 from spideryarn.billing_accounts where owner_id = $1 for update",
        [OWNER],
      );

      const running = sync([
        subscription({ priceId: RESEARCHER.price, periodStart, periodEnd }),
      ]).then(() => {
        settled = true;
      });

      /* Long enough that an unlocked sync has certainly taken its read and is
         waiting at the UPDATE instead. */
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(settled).toBe(false);

      /* **Somebody else got there first**: the upgrade is already recorded, with
         an override of its own. A sync that read before this cannot know. */
      await holder.query(
        `update spideryarn.billing_accounts
            set price_id = $2, quota_limit_delta = 99, quota_period_start = $3
          where owner_id = $1`,
        [OWNER, RESEARCHER.price, periodStart],
      );
      await holder.query("commit");
      await running;
      expect(settled).toBe(true);
    } finally {
      await holder.query("rollback").catch(() => {});
      holder.release();
    }

    /* Locked: the sync sees Researcher on both sides, so nothing was bought and
       the 99 stands. Unlocked: it still believes the row says Reader, and writes
       20 + 13 = 33 over the top of a change it never saw. */
    expect(await storedAdjustment()).toEqual({ delta: 99, periodStart });
  });
});

/* --------------------------------------------- what the database itself refuses -- */

/**
 * **The constraint, seen refusing.** A CHECK that has never been watched fail is
 * a comment with a `sql` tag on it — and this one carries a rule the application
 * would otherwise have to remember in three places.
 */
describe("the columns the database will not accept", () => {
  async function setColumns(delta: number | null, periodStart: Date | null): Promise<void> {
    if (!pool) return;
    await pool.query(
      `update spideryarn.billing_accounts
          set quota_limit_delta = $2, quota_period_start = $3 where owner_id = $1`,
      [OWNER, delta, periodStart],
    );
  }

  /**
   * An adjustment without a period cannot be applied and a period without an
   * adjustment says nothing, so either alone is a bug rather than a state.
   */
  dbIt("refuses an adjustment with no period, and a period with no adjustment", async () => {
    const now = wholeSecond();
    const { periodStart, periodEnd } = threeDaysLeft(now);
    await storedRow({ priceId: READER.price, periodStart, periodEnd });

    await expect(setColumns(-117, null)).rejects.toThrow(/billing_accounts_quota_delta_is_dated/);
    await expect(setColumns(null, periodStart)).rejects.toThrow(
      /billing_accounts_quota_delta_is_dated/,
    );
  });

  /** And accepts both halves of the rule, so the test above is not vacuous. */
  dbIt("accepts both null and both set", async () => {
    const now = wholeSecond();
    const { periodStart, periodEnd } = threeDaysLeft(now);
    await storedRow({ priceId: READER.price, periodStart, periodEnd });

    await expect(setColumns(null, null)).resolves.toBeUndefined();
    await expect(setColumns(-117, periodStart)).resolves.toBeUndefined();
  });

  /**
   * **A negative delta is legitimate, and the column deliberately has no range
   * check.** The old absolute column carried `>= 0`; an upgrade now stores
   * −117 against the tier it moved to. The bound a delta actually needs — that
   * `ingests_per_period + delta` lands inside `[0, the largest tier]` — is a
   * function of `billing_tiers`, which a row constraint cannot see, so it is
   * enforced at the read by `limitForPeriod` and pinned from both ends there.
   */
  dbIt("accepts the negative delta an upgrade stores", async () => {
    const now = wholeSecond();
    const { periodStart, periodEnd } = threeDaysLeft(now);
    await storedRow({ priceId: RESEARCHER.price, periodStart, periodEnd });

    await expect(setColumns(-117, periodStart)).resolves.toBeUndefined();
    await expectWallLimit(33);
  });
});

/* ----------------------------------------------- the arithmetic, on its own -- */

/**
 * A period of exactly a thousand milliseconds, so `remaining` can be set to any
 * fraction by choosing `now` — which is what lets a case land on the boundary
 * between two roundings deliberately rather than by luck.
 */
const PURE_PERIOD = {
  subscriptionId: "sub_pure",
  priceId: "price_researcher",
  periodStart: new Date(0),
  periodEnd: new Date(1000),
};

const RULES: QuotaRules = {
  allowanceFor: (priceId) =>
    priceId === "price_reader" ? articles(20) : priceId === "price_researcher" ? articles(150) : null,
  maxAllowance: articles(150),
};

/** The row as it stands before a change: Reader, this subscription, this period. */
function storedReader(adjustment: QuotaAdjustment = NO_ADJUSTMENT) {
  return {
    subscriptionId: "sub_pure",
    priceId: "price_reader",
    currentPeriodStart: new Date(0),
    adjustment,
  };
}

/** The same, on the larger tier. */
function storedResearcher(adjustment: QuotaAdjustment = NO_ADJUSTMENT) {
  return { ...storedReader(adjustment), priceId: "price_researcher" };
}

/** One change, with everything else held still. */
const change = (over: Partial<Parameters<typeof nextQuotaAdjustment>[0]> = {}) =>
  nextQuotaAdjustment({
    stored: storedReader(),
    incoming: PURE_PERIOD,
    now: new Date(500),
    rules: RULES,
    ...over,
  });

describe("how much of the period is left", () => {
  it("is one at the start, a half in the middle, and nothing at the end", () => {
    expect(fractionRemaining(PURE_PERIOD, new Date(0))).toBe(1);
    expect(fractionRemaining(PURE_PERIOD, new Date(500))).toBe(0.5);
    expect(fractionRemaining(PURE_PERIOD, new Date(1000))).toBe(0);
  });

  /** A clock disagreeing with Stripe must not produce a fraction outside [0, 1]. */
  it("clamps rather than trusting a clock outside the period", () => {
    expect(fractionRemaining(PURE_PERIOD, new Date(-10_000))).toBe(1);
    expect(fractionRemaining(PURE_PERIOD, new Date(10_000))).toBe(0);
  });
});

describe("what counts as a plan change at all", () => {
  it("clears when there is no subscription left to meter", () => {
    expect(change({ stored: storedReader({ delta: articles(13), periodStart: new Date(0) }), incoming: null })).toEqual(
      NO_ADJUSTMENT,
    );
  });

  /** A renewal: a later period, and the reader gets what they now pay for. */
  it("clears when the incoming period starts later", () => {
    expect(
      change({
        stored: storedReader({ delta: articles(13), periodStart: new Date(0) }),
        incoming: { ...PURE_PERIOD, periodStart: new Date(1000), periodEnd: new Date(2000) },
        now: new Date(1500),
      }),
    ).toEqual(NO_ADJUSTMENT);
  });

  /**
   * **And when it starts earlier, which is not a stale event.**
   * `syncSubscriptionFromStripe` locks the row and *then* asks Stripe, so a
   * second delivery can never carry older state than the first. An earlier
   * period start means the subscription that wins has changed.
   */
  it("clears when the incoming period starts earlier", () => {
    expect(
      change({
        stored: {
          ...storedReader({ delta: articles(13), periodStart: new Date(5000) }),
          currentPeriodStart: new Date(5000),
        },
      }),
    ).toEqual(NO_ADJUSTMENT);
  });

  /**
   * **A different subscription is not a plan change, even on the same period.**
   *
   * Two subscriptions created in the same Stripe second share a period start, so
   * the period test alone cannot separate a change of *plan* from a change of
   * *winner* — and prorating the second one gave 85 where the new subscription's
   * own tier is the answer. GPT Sol, 2026-09-04, reproduced.
   */
  it("clears when a different subscription shares the period start exactly", () => {
    expect(
      change({
        stored: storedResearcher(),
        incoming: { ...PURE_PERIOD, subscriptionId: "sub_another", priceId: "price_reader" },
      }),
    ).toEqual(NO_ADJUSTMENT);
  });

  /**
   * **Ending a trial to switch plan is not a mid-period plan change either — and
   * the copy on both pages depends on it.**
   *
   * `trialing` is an entitled status (src/billing/tiers.ts) and the hosted
   * Portal is configured `trial_update_behavior: "end_trial"`, so a trialling
   * reader who switches has their trial ended: the trial period stops at that
   * moment and a paid one starts, which is a **new period start** on the same
   * subscription. This branch therefore writes no delta, and the reader gets the
   * whole of the new tier's allowance rather than a part-month share.
   *
   * That is not a bug — a trial nobody paid for has no allowance to prorate away
   * from — but it made the sentence beside the *Switch plan* button false, which
   * promised "the larger allowance is added for the part of the month that is
   * left". `switchingPlan("trial")` (src/billing-plan.ts) says the true thing,
   * and this is the fact it says. GPT Sol, 2026-09-04, finding 2, reproduced.
   *
   * Pinned here rather than argued in a comment, so that a change to the
   * ordering rule which quietly started prorating this makes the copy red.
   */
  it("clears when a trial ends into a new period on the same subscription", () => {
    const started = new Date(400);
    const adjustment = change({
      /* The trial: Reader's price, the period that has just been cut short. */
      stored: storedReader(),
      /* The switch: same subscription, Researcher's price, a period beginning
         now because the trial has just ended. */
      incoming: {
        ...PURE_PERIOD,
        priceId: "price_researcher",
        periodStart: started,
        periodEnd: new Date(1400),
      },
      now: started,
    });
    expect(adjustment).toEqual(NO_ADJUSTMENT);
    /* And what the wall then allows is the whole 150, read the way admission
       reads it — not the ~75 a half-period proration would have given. */
    expect(limitForPeriod(articles(150), started, adjustment, RULES.maxAllowance)).toBe(150);
  });

  /** And a row that has never been synced has no subscription to match against. */
  it("clears when the row names no subscription at all", () => {
    expect(change({ stored: { ...storedResearcher(), subscriptionId: null } })).toEqual(
      NO_ADJUSTMENT,
    );
  });

  /** The retry. Same subscription, same period, same price: nothing bought anything. */
  it("carries an existing adjustment through unchanged when nothing changed", () => {
    expect(
      change({
        stored: storedResearcher({ delta: articles(-117), periodStart: new Date(0) }),
        now: new Date(900),
      }),
    ).toEqual({ delta: -117, periodStart: new Date(0) });
  });

  it("leaves a row with no adjustment alone when nothing changed", () => {
    expect(change({ stored: storedResearcher(), now: new Date(900) })).toEqual(NO_ADJUSTMENT);
  });

  /**
   * A price no tier sells, on either side. The entitlement falls to free for
   * that reason anyway, so there is no allowance to move and none to move it
   * from.
   */
  it("clears rather than guessing when either price is one no tier sells", () => {
    expect(change({ stored: { ...storedReader(), priceId: "price_retired_long_ago" } })).toEqual(
      NO_ADJUSTMENT,
    );
    expect(change({ incoming: { ...PURE_PERIOD, priceId: "price_made_by_hand" } })).toEqual(
      NO_ADJUSTMENT,
    );
  });
});

describe("what a mid-period change is worth", () => {
  /** The delta is stored against the **new** tier: 150 − 150 = 0 at the start. */
  it("hands over the whole difference at the very start of a period", () => {
    expect(change({ now: new Date(0) })).toEqual({ delta: 0, periodStart: new Date(0) });
  });

  /** And nothing at the end: they keep the Reader 20, so 20 − 150 = −130. */
  it("hands over nothing at the very end of one", () => {
    expect(change({ now: new Date(1000) })).toEqual({ delta: -130, periodStart: new Date(0) });
  });

  /**
   * **Floored, not rounded**, and this is the case that tells the two apart:
   * 130 × 0.497 is 64.61, so flooring gives 84 (delta −66) where rounding would
   * give 85. Rounding each change independently is the ratchet.
   */
  it("floors the accumulated limit rather than rounding it", () => {
    expect(change({ now: new Date(503) })).toEqual({ delta: -66, periodStart: new Date(0) });
  });

  it("takes the allowance back down on a downgrade, by the same fraction", () => {
    expect(
      change({
        stored: storedResearcher(),
        incoming: { ...PURE_PERIOD, priceId: "price_reader" },
        now: new Date(100),
      }),
    ).toEqual({ delta: 13, periodStart: new Date(0) });
  });

  /**
   * **Belt-and-braces, both ends.** Neither clamp is reachable through the
   * formula, but a hand-typed `UPDATE` to `quota_limit_delta` is — and the
   * column deliberately carries no range CHECK, because the bound it would need
   * is a function of `billing_tiers`.
   */
  it("cannot be talked above the largest tier, or below nothing", () => {
    /* An absurd stored delta plus a full-value upgrade: capped at 150, so 0. */
    expect(
      change({ stored: storedReader({ delta: articles(9000), periodStart: new Date(0) }), now: new Date(0) }),
    ).toEqual({ delta: 0, periodStart: new Date(0) });
    /* And the floor: a stored −9000 downgraded lands at 0, so −20 against Reader. */
    expect(
      change({
        stored: storedResearcher({ delta: articles(-9000), periodStart: new Date(0) }),
        incoming: { ...PURE_PERIOD, priceId: "price_reader" },
        now: new Date(0),
      }),
    ).toEqual({ delta: -20, periodStart: new Date(0) });
  });

  /**
   * **The property the whole design rests on, swept rather than sampled.**
   *
   * A script switching up and down cannot accumulate allowance. Two hundred
   * cycles, each at a *later* instant than the last — the only way a real
   * sequence can run — and after every upgrade the limit is compared with what a
   * single upgrade at that same instant would have given. It is never more.
   *
   * The sweep is what catches a ratchet: it lives in the relationship between
   * consecutive roundings, not in any one of them.
   * docs/reusable/silent-success.md § *Sweep a continuous input*.
   */
  it("cannot be ratcheted upwards by switching back and forth", () => {
    let stored = storedReader();
    for (let step = 0; step < 200; step += 1) {
      const now = new Date(step * 2);
      const up = change({ stored, now });
      const honest = change({ stored: storedReader(), now });
      /* Compared as limits rather than deltas — both are against Researcher. */
      expect(up.delta).toBeLessThanOrEqual(honest.delta ?? 0);
      expect(150 + (up.delta ?? 0)).toBeGreaterThanOrEqual(0);

      const down = change({
        stored: storedResearcher(up),
        incoming: { ...PURE_PERIOD, priceId: "price_reader" },
        now: new Date(step * 2 + 1),
      });
      stored = storedReader(down);
    }
  });

  /**
   * **The same sweep, stated as a sequence rather than a bound**, because a
   * loop-with-an-inequality can pass while every individual step is wrong. These
   * are the first three cycles at half a period, written out: each step is worth
   * 130 × 359/720 = 64.819, and each floor loses at most one, downwards.
   * GPT Sol asked for the explicit form, 2026-09-04.
   */
  it("walks a named up-down-up sequence, step by step", () => {
    const at = (t: number) => new Date(t);
    /* Half the period left, so a step is worth 130 × 0.5 = 65 exactly; the
       instants below move by a millisecond each so the fractions differ. */
    let stored = storedReader();
    const limits: number[] = [];
    for (const [t, price] of [
      [500, "price_researcher"],
      [501, "price_reader"],
      [502, "price_researcher"],
      [503, "price_reader"],
      [504, "price_researcher"],
    ] as const) {
      const next = change({
        stored,
        incoming: { ...PURE_PERIOD, priceId: price },
        now: at(t),
      });
      const tier = price === "price_reader" ? 20 : 150;
      limits.push(limitForPeriod(articles(tier), new Date(0), next, articles(150)));
      stored = { ...storedReader(next), priceId: price };
    }
    /* Up to 85, back to 20, up to 84, back to 19, up to 83 — the drift is
       downwards, one ingest per switch, and never upwards. */
    expect(limits).toEqual([85, 20, 84, 19, 83]);
  });
});

describe("the limit the row carries", () => {
  const upgraded: QuotaAdjustment = { delta: articles(-117), periodStart: new Date(0) };

  it("is the tier plus the adjustment, when the adjustment belongs to this period", () => {
    expect(limitForPeriod(articles(150), new Date(0), upgraded, articles(150))).toBe(33);
  });

  /**
   * **Finding 4, as a unit.** Raising the tier raises this account with it,
   * because the stored number says what the change was *worth* rather than what
   * it left. An absolute 33 would have sat at 33 through every future raise.
   */
  it("follows the tier when the tier is raised under it", () => {
    expect(limitForPeriod(articles(200), new Date(0), upgraded, articles(200))).toBe(83);
    expect(limitForPeriod(articles(50), new Date(0), { delta: articles(13), periodStart: new Date(0) }, articles(150))).toBe(63);
  });

  /**
   * **The second guard.** A sync that failed to clear an old adjustment, a row
   * restored from a backup, a period that moved for a reason nobody predicted —
   * none of them may meter somebody on last month's number.
   */
  it("is the tier's, when the adjustment belongs to another period", () => {
    expect(limitForPeriod(articles(150), new Date(9999), upgraded, articles(150))).toBe(150);
  });

  it("is the tier's when there is no adjustment at all", () => {
    expect(limitForPeriod(articles(150), new Date(0), NO_ADJUSTMENT, articles(150))).toBe(150);
  });

  it("cannot exceed the largest allowance any tier sells, or fall below nothing", () => {
    expect(limitForPeriod(articles(20), new Date(0), { delta: articles(9000), periodStart: new Date(0) }, articles(150))).toBe(150);
    expect(limitForPeriod(articles(20), new Date(0), { delta: articles(-9000), periodStart: new Date(0) }, articles(150))).toBe(0);
  });
});

