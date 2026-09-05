/**
 * **A public article costs half a slot** — the arithmetic, and the four ways it
 * could quietly stop being true.
 *
 * Greg, 2026-09-04:
 *
 * > please also change how we price Public-readable articles - they are
 * > half-price, i.e. they only count as a half-article against the user's
 * > article-quota (e.g. free users can make 6 Public articles, $10 users can
 * > make twice as many if Public, etc etc). … The intention is to incentivise
 * > people to make articles Public, because then more people benefit from them.
 *
 * The mechanism is **live recomputation** rather than a credit: usage is derived
 * from `articles.visibility` every time it is asked, so unsharing simply puts
 * the cost back and there is nothing to game. The arithmetic is in half-units —
 * a private ingest costs 2, a public one 1, a tier's budget is its allowance
 * doubled — so that no fraction goes anywhere near money and `usageOf`'s integer
 * assertion keeps working. src/billing/half-units.ts, docs/project/billing.md.
 *
 * What this file exists to catch, and in the order the money matters:
 *
 * 1. **The unit trap.** `billing_accounts.quota_limit_delta` is a signed count
 *    of *whole ingests*, so doubling a tier before `limitForPeriod` turns a
 *    stored −117 into ninety-one articles for somebody entitled to thirty-three.
 *    Two branded types make that a compile error; the case below makes it a red
 *    test as well, because a cast would get past the compiler.
 * 2. **The overdraft.** `used < budget` was never the old rule doubled — at a
 *    cost of two, five-of-six admits an ingest that settles at seven. One half
 *    unit, knowingly, because Greg said six public articles. Both halves are
 *    pinned: it is at most one, and no add-then-unshare cycle earns a second.
 * 3. **The direction an unresolvable row fails in.** There is no backfill, so a
 *    charged row with no article must cost full price.
 * 4. **The offer counts articles, not ledger rows**, because a re-added URL owns
 *    several charged rows.
 *
 * A real database, this owner's rows only, no Stripe and no network. The
 * type-level half — that a successful settlement cannot be expressed without an
 * article id — is at the bottom, and it goes red at `npm run typecheck` rather
 * than here: vitest never type-checks.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PRIVATE_INGEST_COST,
  PUBLIC_INGEST_COST,
  articles as inArticles,
  budgetFor,
  halfUnits,
  privateHeadroom,
} from "../src/billing/half-units.js";
import { limitForPeriod } from "../src/billing/quota-adjustment.js";
import type { QuotaAdjustment } from "../src/billing/quota-adjustment.js";
import { FREE, FREE_LIFETIME_INGESTS } from "../src/billing/tiers.js";
import type { Entitlement, TierRow } from "../src/billing/tiers.js";
import { loadEnvLocal } from "../src/env.js";
import {
  SHARING_CANNOT_UNRING,
  SHARING_RIGHTS_CONFIRM,
  UNSHARING_COSTS_ALLOWANCE,
  ingestQuotaReached,
  sharingConfirmBody,
} from "../src/messages.js";
import { runAsOwner } from "../src/owner.js";
import type { OwnerId } from "../src/owner.js";
import {
  halfUnitsUsed,
  ingestEligibility,
  ingestsUsed,
  reserveIngest,
  settleReservation,
  sharingWouldMakeRoom,
  usageFor,
} from "../src/store/pg-billing.js";
import { getDb } from "../src/db/client.js";
import { pgVisibilityStore } from "../src/store/pg-visibility.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/* Before `pgReady`, or the whole file skips for the wrong reason — the trap
   tests/billing-quota-race.test.ts documents at length. */
loadEnvLocal();

const { reachable, pool } = await pgReady({
  suite: "tests/billing-half-units.test.ts",
  tables: ["spideryarn.billing_accounts", "spideryarn.ingest_events", "spideryarn.articles"],
  keepPool: true,
  max: 6,
});

const dbIt = reachable ? it : it.skip;

/** Fixed and distinctive, so a killed run's rows are cleared rather than added to. */
const OWNER = "0b110a1f-0000-4000-8000-0000000000a1" as OwnerId;

/** The free budget, in half-units — three articles, so six. */
const FREE_BUDGET = budgetFor(inArticles(FREE_LIFETIME_INGESTS));

/**
 * A Researcher-shaped tier, handed to `reserveIngest` rather than read from the
 * table — the same trick tests/billing-quota-race.test.ts uses, so the case
 * below is about the arithmetic and not about what happens to be seeded.
 */
const RESEARCHER_PRICE = "price_researcher_for_half_units";
const TIERS: readonly TierRow[] = [
  {
    id: "researcher",
    productName: "Spideryarn Researcher",
    description: "For people who read for a living.",
    ingestsPerPeriod: 150,
    lookupKey: "spideryarn_researcher_monthly_half_units",
    stripePriceId: RESEARCHER_PRICE,
    livemode: false,
    active: true,
    sortOrder: 30,
    amounts: { usd: 5000 },
  },
];

/**
 * A live period and a **stored delta of −117** — the row a Reader who moved up
 * with three days left is left carrying. The tier sells 150; this account is
 * entitled to 33.
 */
async function givenUpgradedMidPeriod(): Promise<void> {
  if (!pool) return;
  const start = new Date(Date.now() - 5 * 24 * 3600 * 1000);
  const end = new Date(Date.now() + 25 * 24 * 3600 * 1000);
  await pool.query(
    `insert into spideryarn.billing_accounts
       (owner_id, stripe_customer_id, stripe_subscription_id, price_id, status,
        current_period_start, current_period_end, quota_limit_delta, quota_period_start)
     values ($1, $2, $3, $4, 'active', $5, $6, -117, $5)
     on conflict (owner_id) do update set
       stripe_customer_id = excluded.stripe_customer_id,
       stripe_subscription_id = excluded.stripe_subscription_id,
       price_id = excluded.price_id,
       status = excluded.status,
       current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end,
       quota_limit_delta = excluded.quota_limit_delta,
       quota_period_start = excluded.quota_period_start`,
    [OWNER, `cus_${OWNER}`, `sub_${OWNER}`, RESEARCHER_PRICE, start, end],
  );
}

/**
 * **A two-article paid tier**, so the wall is four half-units away and can be
 * reached with four public rows rather than with forty.
 */
const BOUNDARY_PRICE = "price_boundary_for_half_units";
const BOUNDARY_TIERS: readonly TierRow[] = [
  {
    ...TIERS[0]!,
    id: "boundary",
    productName: "Spideryarn Boundary",
    ingestsPerPeriod: 2,
    lookupKey: "spideryarn_boundary_monthly",
    stripePriceId: BOUNDARY_PRICE,
  },
];

/** A live period, five days in and twenty-five to go. Half-open: `[start, end)`. */
const PERIOD_START = new Date(Date.now() - 5 * 24 * 3600 * 1000);
const PERIOD_END = new Date(Date.now() + 25 * 24 * 3600 * 1000);

/** The same period as an entitlement, for the reads that take one directly. */
const BOUNDARY_PAID: Entitlement = {
  tier: "paid",
  tierId: "boundary",
  limit: inArticles(2),
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
};

/** A subscribed row on that tier, with no stored delta. */
async function givenPaidPeriod(): Promise<void> {
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
       current_period_end = excluded.current_period_end,
       quota_limit_delta = null,
       quota_period_start = null`,
    [OWNER, `cus_${OWNER}`, `sub_${OWNER}`, BOUNDARY_PRICE, PERIOD_START, PERIOD_END],
  );
}

async function seedOwner(): Promise<void> {
  if (!pool) return;
  await seedAuthUser(pool, {
    id: OWNER,
    email: `half-units-${OWNER}@spideryarn.local`,
    onConflictDoNothing: true,
  });
}

/**
 * One article, and the slug it is known by.
 *
 * Rows written straight in rather than through the pipeline: nothing here reads
 * a revision, and an article with no revision is exactly what a charged row
 * whose ingest never published would point at anyway.
 */
async function givenArticle(name: string, visibility: "private" | "public"): Promise<string> {
  if (!pool) throw new Error("no pool");
  const { rows } = await pool.query<{ id: string }>(
    `insert into spideryarn.articles (owner_id, slug, visibility, public_at)
     values ($1, $2, $3, case when $3 = 'public' then now() end)
     returning id`,
    [OWNER, `half-units-${name}`, visibility],
  );
  return rows[0]!.id;
}

/** A charged ledger row pointing at `articleId` — what a settlement leaves behind. */
async function givenCharged(articleId: string | null, succeededAt?: Date): Promise<string> {
  if (!pool) throw new Error("no pool");
  const { rows } = await pool.query<{ id: string }>(
    `insert into spideryarn.ingest_events (owner_id, reserved_at, succeeded_at, article_id)
     values ($1, coalesce($3::timestamptz, now()), coalesce($3::timestamptz, now()), $2) returning id`,
    [OWNER, articleId, succeededAt ?? null],
  );
  return rows[0]!.id;
}

async function setVisibility(slug: string, to: "private" | "public"): Promise<void> {
  await runAsOwner(OWNER, () => pgVisibilityStore.set(slug, to, true));
}

async function clear(): Promise<void> {
  if (!pool) return;
  await pool.query("delete from spideryarn.ingest_events where owner_id = $1", [OWNER]);
  await pool.query("delete from spideryarn.article_visibility_changes where actor_owner_id = $1", [
    OWNER,
  ]);
  await pool.query("delete from spideryarn.articles where owner_id = $1", [OWNER]);
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

/* ------------------------------------------------------------ the price -- */

describe("what an ingest costs", () => {
  dbIt("charges a private article two half-units and a public one one", async () => {
    await givenCharged(await givenArticle("private-one", "private"));
    await givenCharged(await givenArticle("public-one", "public"));

    const usage = await usageFor(OWNER, FREE);
    expect(usage).toEqual({ chargedFullPrice: 1, chargedHalfPrice: 1, inFlight: 0 });
    /* **The literal, not the constants.** Writing this as
       `PRIVATE_INGEST_COST + PUBLIC_INGEST_COST` follows whatever those become,
       so it stays green with the discount switched off — watched doing exactly
       that, 2026-09-05. The two costs are pinned once, below. */
    expect(halfUnitsUsed(usage)).toBe(3);
    /* And the count a sentence may say is still two whole articles. */
    expect(ingestsUsed(usage)).toBe(2);
  });

  /**
   * The two numbers everything else is built on, said once and in one place, so
   * that the cases above can be written as arithmetic rather than as a
   * restatement of the constants they are meant to be checking.
   */
  it("is two half-units for private and one for public, and a budget is doubled", () => {
    expect(PRIVATE_INGEST_COST).toBe(2);
    expect(PUBLIC_INGEST_COST).toBe(1);
    expect(budgetFor(inArticles(FREE_LIFETIME_INGESTS))).toBe(FREE_LIFETIME_INGESTS * 2);
  });

  dbIt("charges a reservation full price, because nobody knows yet", async () => {
    expect((await reserveIngest(OWNER)).kind).toBe("admitted");
    const usage = await usageFor(OWNER, FREE);
    expect(usage).toEqual({ chargedFullPrice: 0, chargedHalfPrice: 0, inFlight: 1 });
    expect(halfUnitsUsed(usage)).toBe(2);
  });

  /**
   * **The direction that cannot be gamed.** Every row charged before the
   * `article_id` column existed has nothing to resolve, and there is no backfill
   * — so it must cost full price rather than half. The same must hold when an
   * article is deleted out from under a charged row, which `on delete set null`
   * makes possible.
   */
  dbIt("charges a row it cannot resolve to an article at full price", async () => {
    await givenCharged(null);
    expect(await usageFor(OWNER, FREE)).toEqual({
      chargedFullPrice: 1,
      chargedHalfPrice: 0,
      inFlight: 0,
    });
  });

  dbIt("puts a deleted public article's rows back to full price", async () => {
    if (!pool) return;
    const article = await givenArticle("deleted-later", "public");
    await givenCharged(article);
    expect((await usageFor(OWNER, FREE)).chargedHalfPrice).toBe(1);

    await pool.query("delete from spideryarn.articles where id = $1", [article]);
    /* `on delete set null`, so the row survives — the ledger may not lose an
       ingest — and reverts to full price. Written down at the column as a
       policy: there is no article-deletion path in the app today, and if one is
       built it takes the billing lock and says what it will cost. */
    expect(await usageFor(OWNER, FREE)).toEqual({
      chargedFullPrice: 1,
      chargedHalfPrice: 0,
      inFlight: 0,
    });
  });
});

/* --------------------------------------------------- sharing, both ways -- */

describe("sharing and unsharing move the count in both directions", () => {
  dbIt("halves an article's charged rows when it is shared, and puts them back", async () => {
    await givenCharged(await givenArticle("toggled", "private"));
    expect(halfUnitsUsed(await usageFor(OWNER, FREE))).toBe(2);

    await setVisibility("half-units-toggled", "public");
    expect(halfUnitsUsed(await usageFor(OWNER, FREE))).toBe(1);

    /* **And back.** This is the whole argument for live recomputation over a
       credit: a credit granted once would make share-then-unshare free slots for
       ever unless it were clawed back. */
    await setVisibility("half-units-toggled", "private");
    expect(halfUnitsUsed(await usageFor(OWNER, FREE))).toBe(2);
  });

  /**
   * **The sharp edge, and it is the free tier's.** The free allowance has no
   * period clause at all — `usageSql`'s free arm counts every success ever — so
   * unsharing does not merely raise this month's usage, it raises the lifetime
   * figure, and there is no next month to rescue anybody. A reader can therefore
   * put themselves over the wall by taking something down, which is exactly why
   * the unshare warning has to say the number before it happens.
   */
  dbIt("lets an unshare put a free reader over, and then refuses them", async () => {
    for (const n of [1, 2, 3, 4, 5]) {
      await givenCharged(await givenArticle(`shared-${n}`, "public"));
    }
    /* Five public articles, five half-units, one below a budget of six. */
    expect(halfUnitsUsed(await usageFor(OWNER, FREE))).toBe(5);
    expect((await ingestEligibility(OWNER)).kind).toBe("eligible");

    await setVisibility("half-units-shared-5", "private");

    expect(halfUnitsUsed(await usageFor(OWNER, FREE))).toBe(6);
    const refused = await ingestEligibility(OWNER);
    expect(refused.kind).toBe("refused");
    /* And the number it states is a count of **articles**, not of half-units. */
    expect(refused).toMatchObject({ used: 5, limit: FREE_LIFETIME_INGESTS });
  });
});

/* ------------------------------------------- the paid window, half price -- */

/**
 * **The public half of the period filter, which nothing else exercises.**
 *
 * The usage query builds its charged-and-inside-the-window predicate **twice**,
 * once per counted column, and every other case in this suite is on the free
 * tier — whose window is `true` — while the race suite's half-open test uses
 * only rows with no article, so it exercises the *full-price* copy alone.
 *
 * That leaves a mutation nothing could see. Reversing the paid bounds in the
 * public copy alone — `>= end and < start` — keeps the generated statement's
 * parameter count and values identical, so tests/billing-quota-sql.test.ts stays
 * green; and with no paid public row anywhere in the suite, no behavioural test
 * moves either. Watched doing exactly that on 2026-09-05: the three billing
 * suites, 44 tests, all passed with every paid public success silently dropped
 * from usage — which is sequential public ingests without bound. GPT Sol,
 * 2026-09-05.
 */
describe("a paid period counts public rows by its own bounds", () => {
  dbIt("counts the start instant and not the end instant, on the half-price side", async () => {
    await givenPaidPeriod();
    const shared = await givenArticle("paid-window", "public");
    /* Inside: the start instant itself, and the last millisecond before the end. */
    await givenCharged(shared, PERIOD_START);
    await givenCharged(shared, new Date(PERIOD_END.getTime() - 1));
    /* Outside: a millisecond before the start, the end instant itself, and after
       it. Half-open, so an ingest at a roll-over is counted once, in the new
       period. */
    await givenCharged(shared, new Date(PERIOD_START.getTime() - 1));
    await givenCharged(shared, PERIOD_END);
    await givenCharged(shared, new Date(PERIOD_END.getTime() + 60_000));

    /* Two of the five, at half price — and none of the other three has leaked
       into the full-price column either. */
    expect(await usageFor(OWNER, BOUNDARY_PAID)).toEqual({
      chargedFullPrice: 0,
      chargedHalfPrice: 2,
      inFlight: 0,
    });
  });

  dbIt("refuses at the wall on public rows inside the period", async () => {
    await givenPaidPeriod();
    const shared = await givenArticle("paid-wall", "public");
    /* Four public successes inside the window — four half-units against a
       two-article tier, whose budget is four. The wall is `<`, so this is
       refused; drop these rows out of the count and it admits, for ever. */
    for (const offset of [1, 2, 3, 4]) {
      await givenCharged(shared, new Date(PERIOD_START.getTime() + offset));
    }
    /* And one outside it, which must not be what does the refusing. */
    await givenCharged(shared, new Date(PERIOD_START.getTime() - 1));

    /* The wall first, because it is the assertion that says what this costs:
       an admission here is an account that can add public articles for ever. */
    expect(await reserveIngest(OWNER, undefined, BOUNDARY_TIERS)).toMatchObject({
      kind: "refused",
      limit: 2,
      resetAt: PERIOD_END,
    });
    expect(halfUnitsUsed(await usageFor(OWNER, BOUNDARY_PAID))).toBe(4);
  });
});

/* ---------------------------------------------------------- the overdraft -- */

describe("the half-unit overdraft, which is accepted rather than absent", () => {
  /**
   * **`used < budget` is not the old rule doubled**, and the plan said it was.
   * At a reservation cost of two, five-of-six admits an ingest that settles at
   * seven. Taken knowingly, because the money-safe `used + 2 <= budget` would
   * make Greg's own sentence — six public articles on the free tier — false.
   */
  dbIt("admits one ingest from five half-units, and it settles at seven", async () => {
    for (const n of [1, 2, 3, 4, 5]) {
      await givenCharged(await givenArticle(`over-${n}`, "public"));
    }
    expect(halfUnitsUsed(await usageFor(OWNER, FREE))).toBe(FREE_BUDGET - 1);

    const admitted = await reserveIngest(OWNER);
    expect(admitted.kind).toBe("admitted");
    if (admitted.kind !== "admitted") return;

    const sixth = await givenArticle("over-6", "private");
    await settleReservation(getDb(), admitted.reservationId, {
      kind: "succeeded",
      articleId: sixth,
    });

    const over = halfUnitsUsed(await usageFor(OWNER, FREE));
    expect(over).toBe(FREE_BUDGET + 1);
    /* **At most one half-unit**, which is the claim rather than the arithmetic:
       a private add costs two out of a budget that was one short. */
    expect(over - FREE_BUDGET).toBe(1);
  });

  /**
   * **And it cannot repeat.** At seven the next request is refused; sharing the
   * new article returns them to six, which is still refused. So there is no
   * add-then-unshare cycle that earns a second half-unit.
   */
  dbIt("earns no second overdraft from an add-then-share cycle", async () => {
    for (const n of [1, 2, 3, 4, 5]) {
      await givenCharged(await givenArticle(`cycle-${n}`, "public"));
    }
    const admitted = await reserveIngest(OWNER);
    expect(admitted.kind).toBe("admitted");
    if (admitted.kind !== "admitted") return;
    const sixth = await givenArticle("cycle-6", "private");
    await settleReservation(getDb(), admitted.reservationId, {
      kind: "succeeded",
      articleId: sixth,
    });

    /* Seven of six: refused. */
    expect((await reserveIngest(OWNER)).kind).toBe("refused");

    /* Six of six: still refused, because the wall is `<`. This is the assertion
       that would go red if somebody "fixed" the overdraft by loosening the
       comparison to `<=`. */
    await setVisibility("half-units-cycle-6", "public");
    expect(halfUnitsUsed(await usageFor(OWNER, FREE))).toBe(FREE_BUDGET);
    expect((await reserveIngest(OWNER)).kind).toBe("refused");
  });
});

/* ------------------------------------------------------------- the offer -- */

describe("the offer counts articles rather than ledger rows", () => {
  /**
   * **A re-added URL adopts the shelf's article and charges again**, so one
   * article can own several charged rows. Sharing it frees all of them at once —
   * which means *"share three articles"* would be false for somebody who needs
   * to share one.
   */
  dbIt("says one article when the three half-units come from one article", async () => {
    /* One article added three times — the same URL pasted back after being
       archived, which adopts the shelf's article and charges again — plus one
       ordinary article. Eight half-units against a budget of six, so **three**
       have to be freed to get back under.

       Sharing the busy one frees all three at once, so the honest answer is
       *one article*. Two spellings get this wrong and both are red on this case:
       counting **rows** says three, and taking the groups in any order but
       largest-first takes the single row and then still needs the busy one, so
       it says two. */
    const busy = await givenArticle("re-added", "private");
    await givenCharged(busy);
    await givenCharged(busy);
    await givenCharged(busy);
    await givenCharged(await givenArticle("ordinary", "private"));

    const refused = await ingestEligibility(OWNER);
    expect(refused.kind).toBe("refused");
    expect(refused).toMatchObject({
      shareToMakeRoom: [{ title: "half-units-re-added" }],
      used: 4,
    });
  });

  /**
   * **The offer names articles because a count points at the wrong ones.**
   *
   * Three charge-bearing private articles at six-of-six, and beside them one
   * article added before billing existed, which has no ledger row at all.
   * *Sharing one of your articles would make room* is arithmetically right and
   * points at four articles of which only three are meant; share the
   * grandfathered one and usage does not move, and sharing is irreversible in
   * the way that matters — it republishes somebody else's article to strangers.
   * Nothing on any screen distinguishes the two, so the only fix is to say
   * which. GPT Sol, 2026-09-05.
   */
  dbIt("names the articles that carry the charge, by the name the library shows", async () => {
    if (!pool) return;
    for (const n of [1, 2, 3]) await givenCharged(await givenArticle(`counted-${n}`, "private"));
    await givenArticle("grandfathered", "private");
    /* The reader's own rename, so the sentence says what their shelf says —
       `coalesce(title_override, the revision's title, slug)`, the shelf's own
       expression. */
    await pool.query(
      "update spideryarn.articles set title_override = $2 where owner_id = $1 and slug = $3",
      [OWNER, "What the Dormouse Said", "half-units-counted-1"],
    );

    const refused = await ingestEligibility(OWNER);
    /* One is enough — six half-units minus one is five, which is under six —
       and the grandfathered article is not it. */
    expect(refused).toMatchObject({ shareToMakeRoom: [{ title: "What the Dormouse Said" }] });

    /* And the sentence a reader is actually shown, from the ledger to the words. */
    if (refused.kind !== "refused" || refused.shareToMakeRoom === undefined) {
      throw new Error("expected a refusal carrying an offer");
    }
    expect(ingestQuotaReached({ limit: 3, shareToMakeRoom: refused.shareToMakeRoom }).message).toContain(
      "sharing “What the Dormouse Said” would make room",
    );
    /* The same answer for `/profile`, which asks the shorter question. */
    expect(await sharingWouldMakeRoom(OWNER, FREE, await usageFor(OWNER, FREE))).toBe(true);
  });

  dbIt("offers nothing when everything shareable is already shared", async () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      await givenCharged(await givenArticle(`all-shared-${n}`, "public"));
    }
    const refused = await ingestEligibility(OWNER);
    expect(refused.kind).toBe("refused");
    /* Six public articles, six half-units, at the wall — and nothing left to
       share, so the sentence must not appear. Conditionality is what stops a
       false offer; copy cannot. */
    expect(refused).not.toHaveProperty("shareToMakeRoom");
  });

  dbIt("offers nothing when the rows predate the column and cannot be cheapened", async () => {
    /* No article to resolve — exactly the shape of every row charged before
       2026-09-05. Full price, and unshareable. */
    for (const _ of [1, 2, 3]) await givenCharged(null);
    const refused = await ingestEligibility(OWNER);
    expect(refused.kind).toBe("refused");
    expect(refused).not.toHaveProperty("shareToMakeRoom");
    /* **And `/profile` is told the same thing**, from the same query. It said
       *"Sharing more … makes room"* to this reader unconditionally until
       2026-09-05, which is a way out that does not exist for anybody whose rows
       were charged before the column did. */
    expect(await sharingWouldMakeRoom(OWNER, FREE, await usageFor(OWNER, FREE))).toBe(false);
  });
});

/* ------------------------------------------------------- the two units --- */

describe("tiers, deltas and clamps stay in articles", () => {
  /**
   * **The one that would have cost real money.** A Reader who moved to
   * Researcher on day 27 carries a stored delta of −117 against a tier that
   * sells 150, so they are entitled to 33 articles and a budget of 66
   * half-units. Doubling the tier *before* the delta gives `300 − 117 = 183` —
   * ninety-one articles. GPT Sol, 2026-09-04.
   */
  it("applies a stored delta to the tier's articles and doubles only afterwards", () => {
    const periodStart = new Date(0);
    const limit = limitForPeriod(
      inArticles(150),
      periodStart,
      { delta: inArticles(-117), periodStart },
      inArticles(150),
    );
    expect(limit).toBe(33);
    expect(budgetFor(limit)).toBe(66);
    /* The wrong order, spelled out so the number is in the file rather than in
       a comment about it. */
    expect(150 * 2 - 117).toBe(183);
  });

  /**
   * **The same trap, at the wall rather than in the arithmetic.** The pure case
   * above holds `limitForPeriod`; this one holds every line between the stored
   * row and the refusal, which is where a doubling could be inserted instead.
   *
   * Thirty-three articles is sixty-six half-units. At sixty-four the account has
   * room; at sixty-six it does not. Under the wrong order it would be entitled
   * to a hundred and eighty-three and neither of these would refuse.
   */
  dbIt("meters an upgraded account on 33 articles, not on 91", async () => {
    if (!pool) return;
    await givenUpgradedMidPeriod();
    /* Thirty-two private articles: sixty-four half-units, two below the budget. */
    await pool.query(
      `insert into spideryarn.ingest_events (owner_id, reserved_at, succeeded_at)
       select $1, now(), now() from generate_series(1, 32)`,
      [OWNER],
    );
    expect((await reserveIngest(OWNER, undefined, TIERS)).kind).toBe("admitted");

    /* One more charged row and it is sixty-six — plus the reservation just
       taken, which is charged full price too. */
    const refused = await reserveIngest(OWNER, undefined, TIERS);
    expect(refused).toMatchObject({ kind: "refused", limit: 33 });
  });

  /**
   * **Headroom is the wall's answer, not a rounded ratio.** `ceil` here is
   * exact: the admitted private adds from `u` are the `k` with `u + 2k < budget`.
   */
  it("counts further private articles exactly, including from an odd number", () => {
    const budget = halfUnits(6);
    expect(privateHeadroom(halfUnits(0), budget)).toBe(3);
    expect(privateHeadroom(halfUnits(4), budget)).toBe(1);
    /* Five is the overdraft case: one more is admitted, and lands at seven. */
    expect(privateHeadroom(halfUnits(5), budget)).toBe(1);
    expect(privateHeadroom(halfUnits(6), budget)).toBe(0);
    expect(privateHeadroom(halfUnits(7), budget)).toBe(0);
  });
});

/* ------------------------------------------------------------- the words -- */

describe("what a refusal offers, and where money may not appear", () => {
  const codes = [
    ["pay-free", {}],
    ["pay-limit", { resetAt: new Date("2026-10-03T00:00:00Z") }],
    ["pay-lapsed", { lapsed: true }],
  ] as const;

  /**
   * **All three, and the exclusion list is gone.** Excluding `pay-lapsed` was
   * the plan's first answer, on the reasoning that a lapsed reader's lifetime
   * count includes their paid months and could never be shared back under the
   * wall. That is an example rather than a rule — a Reader who added three
   * private articles and then lapsed is at six half-units against a budget of
   * six, and sharing one makes room. Conditionality does the work, which is what
   * it was for. GPT Sol, 2026-09-04.
   */
  it.each(codes)("names the articles the server chose, in the %s refusal", (code, extra) => {
    const message = ingestQuotaReached({
      limit: 3,
      ...extra,
      shareToMakeRoom: [{ title: "The Bitter Lesson" }],
    }).message;
    expect(message).toContain(`[${code}]`);
    expect(message).toContain("sharing “The Bitter Lesson” would make room");
    /* And it never stops promising the thing it promised before. */
    expect(message).toContain("reading is never limited");
  });

  it.each(codes)("says nothing about sharing in the %s refusal without one", (code, extra) => {
    const message = ingestQuotaReached({ limit: 3, ...extra }).message;
    expect(message).toContain(`[${code}]`);
    /* **Silence, not a hedge.** This is the reader who has already shared
       everything, and the reader whose rows all predate the discount — a
       sentence offering either of them a way out would be false. */
    expect(message).not.toMatch(/shar/i);
  });

  /**
   * **A count is an offer the reader cannot act on**, which is why the sentence
   * names articles now. *Sharing one of your articles would make room* is
   * arithmetically true and points at a library in which a grandfathered
   * article — no ledger row, indistinguishable on screen — sits beside the ones
   * that are actually counted. Share that one and nothing moves, and sharing is
   * irreversible in the way that matters. GPT Sol, 2026-09-05.
   */
  it("joins the names it gives, and goes back to counting past three", () => {
    const named = (...titles: readonly string[]) =>
      ingestQuotaReached({
        limit: 3,
        shareToMakeRoom: [{ title: titles[0] ?? "" }, ...titles.slice(1).map((title) => ({ title }))],
      }).message;

    expect(named("A")).toContain("sharing “A” would make room");
    expect(named("A", "B")).toContain("sharing “A” and “B” would make room");
    expect(named("A", "B", "C")).toContain("sharing “A”, “B” and “C” would make room");
    /* Four is where a sentence stops being readable, so it counts — and it says
       *counted against this allowance* rather than *of your articles*, which is
       the whole of what was wrong with counting. */
    const four = named("A", "B", "C", "D");
    expect(four).toContain("sharing 4 of the articles counted against this allowance would make room");
    expect(four).not.toContain("“A”");
    /* A title long enough to bury the rest of the sentence is cut, not dropped. */
    const long = named("x".repeat(200));
    expect(long).toContain("…”");
    expect(long).toContain("would make room");
    expect(long.length).toBeLessThan(500);
  });

  /**
   * **The count a refusal must not claim.** Six articles can sit against an
   * allowance of three — share each one to the permitted six, then make them all
   * private again — so *"you have added all 3 articles a free account can add"*
   * is false for exactly the account reading it. The allowance is what is spent;
   * how many articles spent it is not this sentence's business. GPT Sol,
   * 2026-09-05.
   */
  it("says the allowance is spent rather than counting what was added", () => {
    for (const extra of [{}, { resetAt: new Date("2026-10-03T00:00:00Z") }]) {
      const message = ingestQuotaReached({ limit: 3, ...extra }).message;
      expect(message).not.toMatch(/added all 3/);
      /* The limit is still named: "you have reached your limit" without the
         limit leaves nobody able to tell a plan from a fault. */
      expect(message).toContain("3 articles");
      expect(message).toMatch(/allowance is spent/);
    }
  });

  /**
   * **The rights tick-box may not be paid for.** Attaching a quota reward to the
   * press that confirms an owner has the right to republish somebody else's
   * article makes the inducement ours and weakens the one protection that press
   * is. So the allowance is said on the *unshare* side and nowhere else, and
   * this is the assertion that keeps it there. Fable, 2026-09-04.
   */
  it("keeps the allowance out of the sharing confirmation", () => {
    for (const words of [sharingConfirmBody("A Piece"), SHARING_CANNOT_UNRING, SHARING_RIGHTS_CONFIRM]) {
      expect(words).not.toMatch(/allowance|half an article|counts as half/i);
    }
    expect(UNSHARING_COSTS_ALLOWANCE).toMatch(/allowance/);
    /* And it is a statement of consequence rather than a gate: it says what the
       press costs, and then says what it does not cost. */
    expect(UNSHARING_COSTS_ALLOWANCE).toContain("reading is never limited");
  });

  /**
   * **And the cost it states is conditional, because for two owners there is
   * none.** An article added before billing launched has no ledger row at all,
   * and one charged before `ingest_events.article_id` existed resolves to
   * nothing and costs full price whether it is public or not — so *"making it
   * private again uses the other half back up"* was simply false for both.
   *
   * That matters beyond accuracy. The rule is that **unsharing is never harder
   * than sharing**, because a cost attached to taking something down is a cost
   * attached to acting on a complaint — and this sentence sits on the press a
   * takedown asks an owner to make. An invented cost is the sharpest version of
   * exactly that. GPT Sol, 2026-09-05.
   */
  it("states the unshare cost as a condition rather than as a fact about every article", () => {
    expect(UNSHARING_COSTS_ALLOWANCE).toMatch(/^If this article counts against your allowance/);
    /* No unconditional claim that this article is costing anything. */
    expect(UNSHARING_COSTS_ALLOWANCE).not.toMatch(/While it is public it counts/);
  });
});

/* -------------------------------------------------------- the lock order -- */

describe("the lock order: billing_accounts before articles", () => {
  /**
   * **Usage is now a function of `articles.visibility`**, which a different
   * request can change at any moment — so an unshare committing between an
   * admission's usage read and its reservation would let that reservation commit
   * against usage that had stopped being true. `pg-visibility.ts` locks the
   * article; admission locks `billing_accounts`. The fix is an *order*, and a
   * consistent order is also what stops the two deadlocking. GPT Sol, 2026-09-04.
   *
   * Held-transaction rather than raced, per
   * docs/postmortems/260901f-a-for-update-that-locks-nothing.md: one connection
   * holds the owner's billing row and the visibility switch is *asserted* to be
   * blocked, rather than fired N times in the hope of an unlucky interleaving.
   */
  dbIt("makes a visibility change wait on the owner's billing row", async () => {
    if (!pool) return;
    await givenArticle("locked-out", "private");
    const holder = await pool.connect();
    try {
      await holder.query("begin isolation level read committed");
      await holder.query(
        "insert into spideryarn.billing_accounts (owner_id) values ($1) on conflict do nothing",
        [OWNER],
      );
      await holder.query(
        "select 1 from spideryarn.billing_accounts where owner_id = $1 for update",
        [OWNER],
      );

      let settled = false;
      const share = setVisibility("half-units-locked-out", "public").then(() => {
        settled = true;
      });

      await new Promise((r) => setTimeout(r, 400));
      /* The assertion the order is for. Without the billing lock this returns
         immediately, because nothing else in the switch touches that row. */
      expect(settled).toBe(false);

      await holder.query("commit");
      await share;
      expect(halfUnitsUsed(await usageFor(OWNER, FREE))).toBe(0);
    } finally {
      holder.release();
    }
  });
});

/* --------------------------------------------- the guard the type carries -- */

describe("a successful settlement carries the article it produced", () => {
  dbIt("writes succeeded_at and article_id in the same statement", async () => {
    if (!pool) return;
    const admitted = await reserveIngest(OWNER);
    expect(admitted.kind).toBe("admitted");
    if (admitted.kind !== "admitted") return;
    const article = await givenArticle("settled", "public");

    await settleReservation(getDb(), admitted.reservationId, {
      kind: "succeeded",
      articleId: article,
    });

    const { rows } = await pool.query<{ succeeded_at: Date | null; article_id: string | null }>(
      "select succeeded_at, article_id from spideryarn.ingest_events where id = $1",
      [admitted.reservationId],
    );
    expect(rows[0]?.succeeded_at).not.toBeNull();
    expect(rows[0]?.article_id).toBe(article);
    /* And the article being public is what makes it cost one rather than two —
       the link is not decoration. */
    expect(halfUnitsUsed(await usageFor(OWNER, FREE))).toBe(PUBLIC_INGEST_COST);
  });

  /**
   * **The type is the only guard there is**, because legacy rows rule out a
   * `NOT NULL` constraint. An optional argument would let a future settlement
   * site omit the link and charge that reader's public article full price for
   * ever, with nothing red and nothing logged — which is why this is a
   * discriminated union and why the check below is here.
   *
   * It goes red at `npm run typecheck` and can never go red at `npm test`:
   * vitest does not type-check. Deliberate, and the same shape as the
   * `@ts-expect-error` in tests/plan-buttons-are-tier-aware.test.tsx.
   */
  it("cannot be spelled without one", () => {
    // @ts-expect-error — a bare "succeeded" is not a Settlement any more.
    const bare: Parameters<typeof settleReservation>[2] = "succeeded";
    // @ts-expect-error — nor is the discriminant on its own.
    const idless: Parameters<typeof settleReservation>[2] = { kind: "succeeded" };
    expect([bare, idless]).toHaveLength(2);
  });

  /**
   * **And the unit trap is a compile error at every one of its own seams**, not
   * only at `budgetFor`.
   *
   * `QuotaAdjustment.delta`, `QuotaRules.maxAllowance` and `allowanceFor` were
   * plain `number` until 2026-09-05, so a `HalfUnits` could reach the stored
   * delta or the clamp with no cast while the comment in
   * src/billing/half-units.ts said otherwise — a guard claiming more than the
   * types delivered. GPT Sol, 2026-09-05. Red at `npm run typecheck`, never
   * here; vitest does not type-check.
   */
  it("cannot pass half-units where a count of articles belongs", () => {
    // @ts-expect-error — a stored delta is a signed count of whole ingests.
    const delta: QuotaAdjustment = { delta: halfUnits(-117), periodStart: new Date(0) };
    // @ts-expect-error — and so is the ceiling nothing may exceed.
    const ceiling: Parameters<typeof limitForPeriod>[3] = halfUnits(300);
    // @ts-expect-error — the one that was always caught, kept beside the two that were not.
    const budget = budgetFor(halfUnits(3));
    expect([delta, ceiling, budget]).toHaveLength(3);
  });
});
