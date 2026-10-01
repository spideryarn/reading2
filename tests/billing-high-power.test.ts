/**
 * **High-powered AI doubles what an article counts** — the billing half of
 * docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md.
 *
 * Greg, 2026-09-30:
 *
 * > it should double the processing cost per-article - that's how I'd think
 * > about it.
 *
 * Switching an article on writes **one more charged `ingest_events` row** for
 * it, `kind = 'high_power'`, priced exactly like an ingest of it: 200 points
 * while private, 100 while public, recomputed live, frozen on delete. Once per
 * article for ever — off refunds nothing, on again charges nothing — and it
 * must fit whole (`admitsHighPower`, `used + cost <= budget`, not the ingest
 * wall's `admitsIngest`).
 *
 * What this file holds, against a real database, this file's owners only, no
 * Stripe and no network (`switchOnHighPower` in src/store/pg-billing.ts, and
 * `chargeAndSwitchOnHighPower` in src/billing/admission.ts around it):
 *
 * - the price (private 2, public 1), and that usage reports it apart from the
 *   ingests (`ingestsUsed` does not move);
 * - the strict room rule at both edges, and that a refusal writes nothing;
 * - once per article: off/on, concurrent switch-ons, and the unique index;
 * - sharing, unsharing and deleting move or freeze the upgrade like an ingest;
 * - a paid period counts the upgrade by its own `succeeded_at` (Sol plan
 *   review finding 7), half-open;
 * - another owner's slug mints no billing anchor;
 * - the database's shape check on an upgrade row;
 * - a stale entitlement resyncs once, then 503; the administrator never comes
 *   here;
 * - the share offer counts a high-powered article's two rows.
 *
 * The route — who is sent here and who is not, and the administrator writing no
 * row — is tests/high-power-routes.test.ts.
 *
 * ## Watched red (2026-10-01), one mutation at a time, then restored
 *
 * - `wallUsed(usage) + cost > budget` → `>=` (no exact fit): red on the
 *   two "fits exactly" cases (private 4→6, public 5→6).
 * - the same line → `wallUsed(usage) >= budget` (the ingest wall's rule,
 *   cost dropped): red on "a private switch-on at five of six is refused".
 * - the `already` lookup forced to empty: red on on/off/on (the unique index
 *   throws on the second on) and on the concurrent case.
 * - the unlocked `ownedSlug` probe removed: red on "another owner's slug mints
 *   no anchor row".
 * - `articlesToShare` restricted to `e.kind = 'ingest'`: red on the offer case.
 * - `usageSql`'s `full_price` without `e.kind = 'ingest'` (an upgrade counted as
 *   an ingest too): red on eight cases.
 *
 * Skips loudly when there is no database (tests/helpers/pg-ready.ts); check with
 * `REQUIRE_POSTGRES=1` and read the count.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { chargeAndSwitchOnHighPower } from "../src/billing/admission.js";
import {
  PRIVATE_INGEST_COST,
  PUBLIC_INGEST_COST,
  articles as inArticles,
  budgetFor,
} from "../src/billing/points.js";
import { FREE, FREE_LIFETIME_INGESTS } from "../src/billing/tiers.js";
import type { Entitlement, TierRow } from "../src/billing/tiers.js";
import { loadEnvLocal } from "../src/env.js";
import { runAsOwner } from "../src/owner.js";
import type { OwnerId } from "../src/owner.js";
import {
  wallUsed,
  ingestEligibility,
  ingestsUsed,
  switchOnHighPower,
  usageFor,
} from "../src/store/pg-billing.js";
import { pgHighPowerStore } from "../src/store/pg-high-power.js";
import { forgetCachedTiers } from "../src/store/pg-tiers.js";
import { pgVisibilityStore } from "../src/store/pg-visibility.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/* Before `pgReady`, or the whole file skips for the wrong reason —
   tests/billing-quota-race.test.ts. */
loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/billing-high-power.test.ts",
  tables: ["spideryarn.billing_accounts", "spideryarn.ingest_events", "spideryarn.articles"],
  keepPool: true,
  max: 6,
});

/** Fixed and distinctive, so a killed run's rows are cleared rather than added to. */
const OWNER = "0b1f0a1e-0000-4000-8000-0000000c6c01" as OwnerId;
/** Somebody else, whose article `OWNER` must not be able to switch. */
const OTHER = "0b1f0a1e-0000-4000-8000-0000000c6c02" as OwnerId;

/** Every slug this file makes starts with this. */
const PREFIX = "billing-high-power-";

/** The free budget, in points — three articles, so 600. */
const FREE_BUDGET = budgetFor(inArticles(FREE_LIFETIME_INGESTS));

/**
 * **No tiers**, handed to `switchOnHighPower` and `ingestEligibility` so a
 * free account's answer cannot depend on what `billing_tiers` happens to hold.
 */
const NO_TIERS: readonly TierRow[] = [];

/** A two-article paid tier — a budget of four — for the period cases. */
const PAID_PRICE = "price_billing_high_power_paid";
const PAID_TIERS: readonly TierRow[] = [
  {
    id: "billing-high-power-paid",
    productName: "Spideryarn High-power fixture",
    description: "Sold only by tests/billing-high-power.test.ts.",
    ingestsPerPeriod: 2,
    lookupKey: "billing_high_power_paid_monthly",
    stripePriceId: PAID_PRICE,
    livemode: false,
    active: true,
    sortOrder: 30,
    amounts: { usd: 5000 },
  },
];

/** A live period, five days in and twenty-five to go. Half-open: `[start, end)`. */
const PERIOD_START = new Date(Date.now() - 5 * 24 * 3600 * 1000);
const PERIOD_END = new Date(Date.now() + 25 * 24 * 3600 * 1000);

const PAID: Entitlement = {
  tier: "paid",
  tierId: "billing-high-power-paid",
  limit: inArticles(2),
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
};

/**
 * A tier row in the table, for the one case that must go through `allTiers()`
 * (`chargeAndSwitchOnHighPower` passes no tiers). **`active = false`**, the
 * trick tests/billing-admission.test.ts explains: entitlement still matches it,
 * and the suites that assert over real, active rows cannot see it.
 */
const TABLE_TIER_ID = "test-billing-high-power-tier";
const TABLE_TIER_PRICE = "price_test_billing_high_power_only";

async function sellATier(): Promise<void> {
  if (!pool) return;
  await pool.query(
    `insert into spideryarn.billing_tiers
       (id, product_name, description, ingests_per_period, lookup_key, stripe_price_id,
        livemode, active, sort_order)
     values ($1, 'A high-power fixture', 'Sold only by tests/billing-high-power.test.ts.',
             20, $2, $3, false, false, 900)
     on conflict (id) do nothing`,
    [TABLE_TIER_ID, `${TABLE_TIER_ID}_monthly`, TABLE_TIER_PRICE],
  );
  forgetCachedTiers();
}

/** A subscribed row, the way the webhook would write one. */
async function givenSubscription(priceId: string, start: Date, end: Date): Promise<void> {
  if (!pool) return;
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
    [OWNER, `cus_${OWNER}`, `sub_${OWNER}`, priceId, start, end],
  );
}

/** One article of `owner`'s, returning its id. Its slug is `PREFIX + name`. */
async function givenArticle(
  name: string,
  visibility: "private" | "public",
  owner: OwnerId = OWNER,
): Promise<string> {
  if (!pool) throw new Error("no pool");
  const { rows } = await pool.query<{ id: string }>(
    `insert into spideryarn.articles (owner_id, slug, visibility, public_at)
     values ($1, $2, $3, case when $3 = 'public' then now() end)
     returning id`,
    [owner, `${PREFIX}${name}`, visibility],
  );
  return rows[0]!.id;
}

/** A settled ingest row pointing at `articleId` — what a successful job leaves. */
async function givenIngest(articleId: string | null, succeededAt?: Date): Promise<void> {
  if (!pool) throw new Error("no pool");
  await pool.query(
    `insert into spideryarn.ingest_events (owner_id, reserved_at, succeeded_at, article_id)
     values ($1, coalesce($3::timestamptz, now()), coalesce($3::timestamptz, now()), $2)`,
    [OWNER, articleId, succeededAt ?? null],
  );
}

/** An upgrade row written straight in, for the boundary cases. */
async function givenUpgradeAt(articleId: string, at: Date): Promise<void> {
  if (!pool) throw new Error("no pool");
  await pool.query(
    `insert into spideryarn.ingest_events (owner_id, kind, reserved_at, succeeded_at, article_id)
     values ($1, 'high_power', $3, $3, $2)`,
    [OWNER, articleId, at],
  );
}

const slug = (name: string) => `${PREFIX}${name}`;

async function setVisibility(name: string, to: "private" | "public"): Promise<void> {
  await runAsOwner(OWNER, () => pgVisibilityStore.set(slug(name), to, true));
}

async function switchOff(name: string): Promise<void> {
  await runAsOwner(OWNER, () => pgHighPowerStore.switchOff(slug(name)));
}

/** The upgrade rows for one article, and the column. */
async function stateOf(articleId: string): Promise<{ upgrades: number; since: Date | null }> {
  if (!pool) throw new Error("no pool");
  const { rows } = await pool.query<{ upgrades: number; since: Date | null }>(
    `select (select count(*)::int from spideryarn.ingest_events
              where kind = 'high_power' and article_id = $1) as upgrades,
            (select high_power_since from spideryarn.articles where id = $1) as since`,
    [articleId],
  );
  return rows[0]!;
}

/** Every upgrade row this owner has, linked or frozen. */
async function upgradeRows(): Promise<
  { article_id: string | null; article_visibility_at_delete: string | null }[]
> {
  if (!pool) return [];
  const { rows } = await pool.query(
    `select article_id, article_visibility_at_delete from spideryarn.ingest_events
      where owner_id = $1 and kind = 'high_power'`,
    [OWNER],
  );
  return rows;
}

async function billingRowExists(owner: OwnerId): Promise<boolean> {
  if (!pool) return false;
  const { rows } = await pool.query("select 1 from spideryarn.billing_accounts where owner_id = $1", [
    owner,
  ]);
  return rows.length > 0;
}

async function clear(): Promise<void> {
  if (!pool) return;
  for (const owner of [OWNER, OTHER]) {
    await pool.query("delete from spideryarn.ingest_events where owner_id = $1", [owner]);
    await pool.query("delete from spideryarn.article_visibility_changes where actor_owner_id = $1", [
      owner,
    ]);
    await pool.query("delete from spideryarn.articles where owner_id = $1", [owner]);
    await pool.query("delete from spideryarn.billing_accounts where owner_id = $1", [owner]);
  }
  await pool.query("delete from spideryarn.billing_tiers where id = $1", [TABLE_TIER_ID]);
  forgetCachedTiers();
}

beforeEach(async () => {
  if (!pool) return;
  await seedAuthUser(pool, {
    id: OWNER,
    email: `billing-high-power-owner-${OWNER}@spideryarn.local`,
    onConflictDoNothing: true,
  });
  await seedAuthUser(pool, {
    id: OTHER,
    email: `billing-high-power-other-${OTHER}@spideryarn.local`,
    onConflictDoNothing: true,
  });
  await clear();
});

afterEach(clear);

afterAll(async () => {
  if (!pool) return;
  await pool.query("delete from auth.users where id = any($1::uuid[])", [[OWNER, OTHER]]).catch(() => {});
  await pool.end();
});

/* ------------------------------------------------------------ the price -- */

describe("what switching on costs", () => {
  it("charges a private article one more article — 200 points — and counts it apart from ingests", async () => {
    const id = await givenArticle("private", "private");
    await givenIngest(id);
    const before = await usageFor(OWNER, FREE);

    const answer = await switchOnHighPower(OWNER, slug("private"), NO_TIERS);
    expect(answer).toMatchObject({ kind: "on", charged: true });

    const after = await usageFor(OWNER, FREE);
    expect(wallUsed(after) - wallUsed(before)).toBe(PRIVATE_INGEST_COST);
    expect(wallUsed(after)).toBe(400);
    /* **Not an article added**: /profile's "N articles added" reads this. */
    expect(ingestsUsed(after)).toBe(ingestsUsed(before));
    expect(after).toMatchObject({ chargedFullPrice: 1, highPowerFullPrice: 1, highPowerHalfPrice: 0 });
    expect(await stateOf(id)).toMatchObject({ upgrades: 1, since: expect.any(Date) });
  });

  it("charges a public article half of one — 100 points", async () => {
    const id = await givenArticle("public", "public");
    await givenIngest(id);

    expect(await switchOnHighPower(OWNER, slug("public"), NO_TIERS)).toMatchObject({
      kind: "on",
      charged: true,
    });
    const usage = await usageFor(OWNER, FREE);
    expect(wallUsed(usage)).toBe(2 * PUBLIC_INGEST_COST);
    expect(usage).toMatchObject({ chargedHalfPrice: 1, highPowerFullPrice: 0, highPowerHalfPrice: 1 });
    expect(ingestsUsed(usage)).toBe(1);
  });
});

/* ------------------------------------------------------- strict room ---- */

describe("it must fit whole: used + cost <= budget, with no overdraft", () => {
  it("lets a free account with two private articles switch one on, landing exactly at six", async () => {
    const a = await givenArticle("fit-a", "private");
    await givenIngest(a);
    await givenIngest(await givenArticle("fit-b", "private"));
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(400);

    expect(await switchOnHighPower(OWNER, slug("fit-a"), NO_TIERS)).toMatchObject({ kind: "on" });
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(FREE_BUDGET);
  });

  it("refuses at six of six, and writes nothing", async () => {
    const a = await givenArticle("full-a", "private");
    await givenIngest(a);
    await givenIngest(await givenArticle("full-b", "private"));
    await givenIngest(await givenArticle("full-c", "private"));

    const answer = await switchOnHighPower(OWNER, slug("full-a"), NO_TIERS);
    expect(answer).toMatchObject({ kind: "no-room", publicNow: false });
    /* Nothing: no row, and the column still clear. */
    expect(await stateOf(a)).toEqual({ upgrades: 0, since: null });
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(FREE_BUDGET);
  });

  it("fits a public article at five of six, landing at six", async () => {
    for (const n of [1, 2, 3, 4, 5]) await givenIngest(await givenArticle(`pub-${n}`, "public"));
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(500);

    const answer = await switchOnHighPower(OWNER, slug("pub-1"), NO_TIERS);
    expect(answer).toMatchObject({ kind: "on", charged: true });
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(FREE_BUDGET);
  });

  /**
   * **The overdraft the ingest wall allows, refused here.** At five of six the
   * wall (`used < budget`) would admit; a private upgrade costs two and would
   * land at seven.
   */
  it("refuses a private switch-on at five of six", async () => {
    for (const n of [1, 2, 3]) await givenIngest(await givenArticle(`five-pub-${n}`, "public"));
    const mine = await givenArticle("five-private", "private");
    await givenIngest(mine);
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(500);

    expect(await switchOnHighPower(OWNER, slug("five-private"), NO_TIERS)).toMatchObject({
      kind: "no-room",
      publicNow: false,
    });
    expect(await stateOf(mine)).toEqual({ upgrades: 0, since: null });
  });
});

/* ---------------------------------------------------- once, for ever ---- */

describe("charged once per article, for ever", () => {
  it("does not refund on off, and does not charge again on on", async () => {
    const id = await givenArticle("once", "private");
    await givenIngest(id);

    expect(await switchOnHighPower(OWNER, slug("once"), NO_TIERS)).toMatchObject({
      kind: "on",
      charged: true,
    });
    const charged = wallUsed(await usageFor(OWNER, FREE));

    await switchOff("once");
    expect(await stateOf(id)).toEqual({ upgrades: 1, since: null });
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(charged);

    const again = await switchOnHighPower(OWNER, slug("once"), NO_TIERS);
    expect(again).toMatchObject({ kind: "on", charged: false });
    expect(await stateOf(id)).toMatchObject({ upgrades: 1, since: expect.any(Date) });
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(charged);
  });

  /**
   * **On again works even with no room left**: the row is already there, so
   * there is nothing to fit. Otherwise a reader who switched off and then used
   * up their allowance could not switch back on something they paid for.
   */
  it("switches back on for free even when the allowance is now spent", async () => {
    const id = await givenArticle("paid-for", "private");
    await givenIngest(id);
    await switchOnHighPower(OWNER, slug("paid-for"), NO_TIERS);
    await switchOff("paid-for");
    await givenIngest(await givenArticle("then-full", "private"));
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(FREE_BUDGET);

    expect(await switchOnHighPower(OWNER, slug("paid-for"), NO_TIERS)).toMatchObject({
      kind: "on",
      charged: false,
    });
    expect(await stateOf(id)).toMatchObject({ upgrades: 1, since: expect.any(Date) });
  });

  it("charges once when two switch-ons race, and both answer on", async () => {
    const id = await givenArticle("race", "private");
    await givenIngest(id);

    const answers = await Promise.all([
      switchOnHighPower(OWNER, slug("race"), NO_TIERS),
      switchOnHighPower(OWNER, slug("race"), NO_TIERS),
    ]);
    expect(answers.map((a) => a.kind)).toEqual(["on", "on"]);
    /* Exactly one of them wrote the row. */
    expect(answers.filter((a) => a.kind === "on" && a.charged)).toHaveLength(1);
    expect((await stateOf(id)).upgrades).toBe(1);
  });

  it("admits only one of two articles racing for the last upgrade", async () => {
    await givenIngest(await givenArticle("cross-race-spend-a", "private"));
    await givenIngest(await givenArticle("cross-race-spend-b", "private"));
    const first = await givenArticle("cross-race-a", "private");
    const second = await givenArticle("cross-race-b", "private");

    const answers = await Promise.all([
      switchOnHighPower(OWNER, slug("cross-race-a"), NO_TIERS),
      switchOnHighPower(OWNER, slug("cross-race-b"), NO_TIERS),
    ]);
    expect(answers.filter((answer) => answer.kind === "on")).toHaveLength(1);
    expect(answers.filter((answer) => answer.kind === "no-room")).toHaveLength(1);
    expect((await stateOf(first)).upgrades + (await stateOf(second)).upgrades).toBe(1);
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(FREE_BUDGET);
  });

  it("is backed by the database: a second upgrade row for one article is refused", async () => {
    if (!pool) return;
    const id = await givenArticle("index", "private");
    await givenUpgradeAt(id, new Date());
    await expect(givenUpgradeAt(id, new Date())).rejects.toMatchObject({ code: "23505" });
    expect((await stateOf(id)).upgrades).toBe(1);
  });
});

/* -------------------------------------------- sharing and deleting ----- */

describe("the upgrade follows the article's price, like its ingest", () => {
  it("is 200 points in all while public, and 400 once unshared", async () => {
    const id = await givenArticle("shared", "public");
    await givenIngest(id);
    await switchOnHighPower(OWNER, slug("shared"), NO_TIERS);
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(200);

    await setVisibility("shared", "private");
    const unshared = await usageFor(OWNER, FREE);
    expect(wallUsed(unshared)).toBe(400);
    expect(unshared).toMatchObject({ highPowerFullPrice: 1, highPowerHalfPrice: 0 });

    await setVisibility("shared", "public");
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(200);
  });

  it("freezes the upgrade's price when the article is deleted, as the trigger does the ingest's", async () => {
    if (!pool) return;
    const priv = await givenArticle("deleted-private", "private");
    await givenIngest(priv);
    await switchOnHighPower(OWNER, slug("deleted-private"), NO_TIERS);
    const pub = await givenArticle("deleted-public", "public");
    await givenIngest(pub);
    await switchOnHighPower(OWNER, slug("deleted-public"), NO_TIERS);
    const before = await usageFor(OWNER, FREE);
    expect(wallUsed(before)).toBe(400 + 200);

    await pool.query("delete from spideryarn.articles where id = any($1::uuid[])", [[priv, pub]]);

    expect(await usageFor(OWNER, FREE)).toEqual(before);
    const rows = await upgradeRows();
    expect(rows.map((r) => r.article_id)).toEqual([null, null]);
    expect(rows.map((r) => r.article_visibility_at_delete).sort()).toEqual(["private", "public"]);
  });
});

/* ------------------------------------------------------ a paid period -- */

describe("a paid period counts the upgrade by when it happened", () => {
  /**
   * **The regression that motivated a charge event** (Sol plan review finding
   * 7): the ingest was charged in an earlier period, the upgrade happens in
   * this one. Only the upgrade counts now — and it counts, rather than riding
   * on the old ingest's date into a period already over.
   */
  it("counts only the upgrade when the ingest was before this period", async () => {
    await givenSubscription(PAID_PRICE, PERIOD_START, PERIOD_END);
    const id = await givenArticle("old", "private");
    await givenIngest(id, new Date(PERIOD_START.getTime() - 3 * 24 * 3600 * 1000));
    expect(wallUsed(await usageFor(OWNER, PAID))).toBe(0);

    expect(await switchOnHighPower(OWNER, slug("old"), PAID_TIERS)).toMatchObject({
      kind: "on",
      charged: true,
    });
    expect(await usageFor(OWNER, PAID)).toMatchObject({
      chargedFullPrice: 0,
      highPowerFullPrice: 1,
    });
    expect(wallUsed(await usageFor(OWNER, PAID))).toBe(PRIVATE_INGEST_COST);
  });

  it("uses one post-lock instant for entitlement and the charge at a period boundary", async () => {
    if (!pool) return;
    const id = await givenArticle("boundary", "private");
    const start = new Date(Date.now() + 1_500);
    const end = new Date(start.getTime() + 30 * 24 * 3600 * 1000);
    await givenSubscription(PAID_PRICE, start, end);

    const blocker = await pool.connect();
    try {
      await blocker.query("begin");
      await blocker.query(
        "select owner_id from spideryarn.billing_accounts where owner_id = $1 for update",
        [OWNER],
      );
      const switching = switchOnHighPower(OWNER, slug("boundary"), PAID_TIERS);
      await new Promise((resolve) => setTimeout(resolve, 1_700));
      await blocker.query("commit");

      expect(await switching).toMatchObject({ kind: "on", charged: true });
      expect(await usageFor(OWNER, { ...PAID, periodStart: start, periodEnd: end })).toMatchObject({
        highPowerFullPrice: 1,
      });
      expect(await stateOf(id)).toMatchObject({ upgrades: 1, since: expect.any(Date) });
    } finally {
      await blocker.query("rollback").catch(() => {});
      blocker.release();
    }
  });

  it("counts the start instant and not the end instant", async () => {
    await givenUpgradeAt(await givenArticle("at-start", "private"), PERIOD_START);
    await givenUpgradeAt(await givenArticle("before-end", "public"), new Date(PERIOD_END.getTime() - 1));
    await givenUpgradeAt(await givenArticle("before-start", "private"), new Date(PERIOD_START.getTime() - 1));
    await givenUpgradeAt(await givenArticle("at-end", "private"), PERIOD_END);

    expect(await usageFor(OWNER, PAID)).toMatchObject({
      chargedFullPrice: 0,
      chargedHalfPrice: 0,
      highPowerFullPrice: 1,
      highPowerHalfPrice: 1,
    });
  });

  it("refuses when this period has no room, however old the article", async () => {
    await givenSubscription(PAID_PRICE, PERIOD_START, PERIOD_END);
    /* Two private articles inside the period: four of four. */
    await givenIngest(await givenArticle("p-1", "private"));
    await givenIngest(await givenArticle("p-2", "private"));
    const old = await givenArticle("p-old", "private");
    await givenIngest(old, new Date(PERIOD_START.getTime() - 1));

    expect(await switchOnHighPower(OWNER, slug("p-old"), PAID_TIERS)).toMatchObject({
      kind: "no-room",
      entitlement: { tier: "paid", periodEnd: PERIOD_END },
    });
    expect(await stateOf(old)).toEqual({ upgrades: 0, since: null });
  });
});

/* ------------------------------------------------------ not yours ------ */

describe("another owner's article", () => {
  it("is not found, and mints no billing anchor row for the caller", async () => {
    const theirs = await givenArticle("theirs", "private", OTHER);
    expect(await billingRowExists(OWNER)).toBe(false);

    expect(await switchOnHighPower(OWNER, slug("theirs"), NO_TIERS)).toEqual({ kind: "not-found" });
    expect(await billingRowExists(OWNER)).toBe(false);
    expect(await stateOf(theirs)).toEqual({ upgrades: 0, since: null });
  });

  it("is a 404 through the policy layer", async () => {
    await givenArticle("theirs-too", "private", OTHER);
    await expect(chargeAndSwitchOnHighPower(OWNER, slug("theirs-too"))).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("the uncharged store capability", () => {
  it("cannot switch a reader on even when called directly", async () => {
    const id = await givenArticle("uncharged-reader", "private");
    await expect(
      runAsOwner(OWNER, () => pgHighPowerStore.switchOnForAdmin(slug("uncharged-reader"))),
    ).rejects.toMatchObject({ status: 403 });
    expect(await stateOf(id)).toEqual({ upgrades: 0, since: null });
  });
});

/* -------------------------------------------------- the shape check ---- */

describe("the database refuses an upgrade row of the wrong shape", () => {
  async function insertUpgrade(fields: {
    articleId: string | null;
    reservedAt: string;
    succeededAt: string | null;
    releasedAt: string | null;
  }): Promise<void> {
    if (!pool) throw new Error("no pool");
    await pool.query(
      `insert into spideryarn.ingest_events
         (owner_id, kind, article_id, reserved_at, succeeded_at, released_at)
       values ($1, 'high_power', $2, $3::timestamptz, $4::timestamptz, $5::timestamptz)`,
      [OWNER, fields.articleId, fields.reservedAt, fields.succeededAt, fields.releasedAt],
    );
  }

  const T = "2026-09-30T12:00:00Z";

  it.each([
    ["never settled (succeeded_at null)", { succeededAt: null, releasedAt: null }],
    ["released", { succeededAt: null, releasedAt: T }],
    ["settled and released", { succeededAt: T, releasedAt: T }],
    ["reserved and settled at different instants", { succeededAt: "2026-09-30T12:00:01Z", releasedAt: null }],
  ])("refuses one %s", async (_what, fields) => {
    const id = await givenArticle(`shape-${Math.random().toString(36).slice(2, 8)}`, "private");
    await expect(insertUpgrade({ articleId: id, reservedAt: T, ...fields })).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("refuses one with neither an article nor a frozen price", async () => {
    await expect(
      insertUpgrade({ articleId: null, reservedAt: T, succeededAt: T, releasedAt: null }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("accepts the one shape switchOnHighPower writes (the control)", async () => {
    const id = await givenArticle("shape-ok", "private");
    await insertUpgrade({ articleId: id, reservedAt: T, succeededAt: T, releasedAt: null });
    expect((await stateOf(id)).upgrades).toBe(1);
  });
});

/* ---------------------------------------------- the policy around it --- */

describe("chargeAndSwitchOnHighPower", () => {
  /** Entitled, on a price the table sells, and the window closed a month ago. */
  async function makeStale(): Promise<void> {
    await sellATier();
    await givenSubscription(
      TABLE_TIER_PRICE,
      new Date(Date.now() - 60 * 24 * 3600 * 1000),
      new Date(Date.now() - 30 * 24 * 3600 * 1000),
    );
  }

  it("resyncs a stale entitlement once, then answers 503 when it is still stale, and writes nothing", async () => {
    const id = await givenArticle("stale", "private");
    await givenIngest(id);
    await makeStale();
    const asked: string[] = [];
    await expect(
      chargeAndSwitchOnHighPower(OWNER, slug("stale"), {
        sync: async (customerId) => {
          asked.push(customerId);
        },
      }),
    ).rejects.toMatchObject({ status: 503, message: expect.stringContaining("[pay-off]") });
    /* Asked once, by customer — not twice, and not guessed at. */
    expect(asked).toEqual([`cus_${OWNER}`]);
    expect(await stateOf(id)).toEqual({ upgrades: 0, since: null });
  });

  it("resyncs a stale entitlement once, and switches on when the resync fixed it", async () => {
    if (!pool) return;
    const id = await givenArticle("resynced", "private");
    await givenIngest(id);
    await makeStale();
    let calls = 0;
    const answer = await chargeAndSwitchOnHighPower(OWNER, slug("resynced"), {
      sync: async () => {
        calls++;
        await pool.query(
          `update spideryarn.billing_accounts
              set current_period_start = now() - interval '5 days',
                  current_period_end = now() + interval '25 days'
            where owner_id = $1`,
          [OWNER],
        );
      },
    });
    expect(calls).toBe(1);
    expect(typeof answer.highPowerSince).toBe("string");
    expect((await stateOf(id)).upgrades).toBe(1);
  });

  it("is a 402 with its own code when there is no room", async () => {
    const id = await givenArticle("no-room", "private");
    await givenIngest(id);
    await givenIngest(await givenArticle("no-room-b", "private"));
    await givenIngest(await givenArticle("no-room-c", "private"));
    await expect(chargeAndSwitchOnHighPower(OWNER, slug("no-room"))).rejects.toMatchObject({
      status: 402,
      message: expect.stringContaining("[pay-high-power]"),
    });
  });

  /**
   * **The administrator is exempt, and never comes here**: the route sends
   * them to the uncharged store method. Asserted in the function too, so a
   * caller that forgot throws rather than billing Greg. The route half — that
   * an administrator's switch-on writes no row — is in
   * tests/high-power-routes.test.ts.
   */
  it("refuses to charge the administrator at all", async () => {
    if (!pool) return;
    const before = await pool.query(
      "select count(*)::int as n from spideryarn.ingest_events where owner_id = $1",
      [ADMIN_USER_ID_LOCAL],
    );
    await expect(
      chargeAndSwitchOnHighPower(ADMIN_USER_ID_LOCAL as OwnerId, "billing-high-power-admin"),
    ).rejects.toThrow(/administrator/);
    const after = await pool.query(
      "select count(*)::int as n from spideryarn.ingest_events where owner_id = $1",
      [ADMIN_USER_ID_LOCAL],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});

/* ------------------------------------------------------- the offer ----- */

describe("the share offer counts a high-powered article's two rows", () => {
  /**
   * 800 points against 600: a high-powered private article (ingest +
   * upgrade, 400) and two plain private ones (200 each). 300 points must be
   * freed. Sharing the high-powered one frees 200, so the fewest is **two
   * articles** — it and one other. Counting ingests alone, every article frees
   * 100 and the offer would name three.
   */
  it("names two articles, the high-powered one first", async () => {
    const big = await givenArticle("offer-a", "private");
    await givenIngest(big);
    await givenUpgradeAt(big, new Date());
    await givenIngest(await givenArticle("offer-b", "private"));
    await givenIngest(await givenArticle("offer-c", "private"));
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(800);

    const refused = await ingestEligibility(OWNER, NO_TIERS);
    expect(refused).toMatchObject({
      kind: "refused",
      shareToMakeRoom: [{ title: slug("offer-a") }, { title: slug("offer-b") }],
      /* Ingests, not charges: three articles added. */
      used: 3,
    });
  });
});
