/**
 * **A minimal paper costs a hundredth of an article**, and *Read this* costs the
 * rest — the billing half of plan 261001m, Stage 2.
 *
 * > Let's say that papers for which we have done minimal AI processing (i.e.
 * > you've uploaded but it's basically just extracted authors & abstract, or
 * > something like that) cost 0.01x an AI-processed paper. So uploading 1000
 * > papers with minimal AI-processing would use up 10 paper-slots.
 * >
 * > — Greg, 2026-10-01
 *
 * In points (src/billing/points.ts): a private article 200, a public one 100, a
 * minimal paper 2, a budget 200 an article. What this file holds, and why each
 * is a way the bill could quietly go wrong:
 *
 * 1. **The minimal wall fits whole** (`admitsMinimal`, `used + 2 <= budget`):
 *    the boundary, and twenty concurrent reservations against room for ten.
 * 2. ***Read this* is the ingest wall, credited the paper's own 2 points** when
 *    they are in this window (`admitsUpgrade`) — and not when they are not.
 * 3. **One *Read this* at a time per paper**, so the credit is taken once.
 * 4. **Supersession makes a paper exactly one ingest** — 200, through delete,
 *    and 100 once shared — and the database refuses a supersession nothing paid
 *    for.
 * 5. **A minimal row is never priced public**, in flight it costs 2, and a
 *    retry reserves the same kind again.
 * 6. **The sharing offer never names a paper nobody has read.**
 * 7. **The `inLock` seam** Stage 3 runs its duplicate check through: it runs in
 *    the reservation's transaction, and a throw from it rolls the reservation
 *    back.
 *
 * A real database, this file's own owners, no Stripe and no network.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { withRetrySlot } from "../src/billing/admission.js";
import {
  admitsMinimal,
  admitsUpgrade,
  articles as inArticles,
  budgetFor,
  minimalHeadroom,
  points,
} from "../src/billing/points.js";
import { FREE, FREE_LIFETIME_INGESTS } from "../src/billing/tiers.js";
import type { Entitlement, TierRow } from "../src/billing/tiers.js";
import { getDb } from "../src/db/client.js";
import { mintId } from "../src/ids.js";
import { jobs } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { minimalQuotaReached } from "../src/messages.js";
import { runAsOwner } from "../src/owner.js";
import type { OwnerId } from "../src/owner.js";
import {
  ingestEligibility,
  minimalUsed,
  reservationShapeOf,
  reserveMinimal,
  reserveUpgrade,
  settleReservation,
  sharingWouldMakeRoom,
  supersedeMinimal,
  usageFor,
  wallUsed,
} from "../src/store/pg-billing.js";
import { pgVisibilityStore } from "../src/store/pg-visibility.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/* Before `pgReady`, or the whole file skips for the wrong reason — the trap
   tests/billing-quota-race.test.ts documents at length. */
loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/billing-minimal.test.ts",
  tables: ["spideryarn.billing_accounts", "spideryarn.ingest_events", "spideryarn.articles"],
  /* The migration this file is about: without it every case would fail on a
     missing column rather than on the rule it is checking. */
  columns: [{ table: "spideryarn.ingest_events", column: "superseded_by" }],
  keepPool: true,
  max: 6,
});

/** Fixed and distinctive, so a killed run's rows are cleared rather than added to. */
const OWNER = "0b11a1a0-0000-4000-8000-0000000d0c01" as OwnerId;
/** A second reader, for the one case about whose rows a supersession may name. */
const STRANGER = "0b11a1a0-0000-4000-8000-0000000d0c02" as OwnerId;

/** The free budget, in points — three articles, so 600. */
const FREE_BUDGET = budgetFor(inArticles(FREE_LIFETIME_INGESTS));

/** A two-article paid tier, handed to the reservation rather than read from the table. */
const PRICE = "price_minimal_papers_boundary";
const TIERS: readonly TierRow[] = [
  {
    id: "minimal-boundary",
    productName: "Spideryarn Minimal Boundary",
    description: "Two articles a month.",
    ingestsPerPeriod: 2,
    lookupKey: "spideryarn_minimal_boundary_monthly",
    stripePriceId: PRICE,
    livemode: false,
    active: true,
    sortOrder: 30,
    amounts: { usd: 1000 },
  },
];
const PERIOD_START = new Date(Date.now() - 5 * 24 * 3600 * 1000);
const PERIOD_END = new Date(Date.now() + 25 * 24 * 3600 * 1000);
const PAID: Entitlement = {
  tier: "paid",
  tierId: "minimal-boundary",
  limit: inArticles(2),
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
};

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
    [OWNER, `cus_${OWNER}`, `sub_${OWNER}`, PRICE, PERIOD_START, PERIOD_END],
  );
}

async function givenArticle(
  name: string,
  visibility: "private" | "public" = "private",
  owner: OwnerId = OWNER,
): Promise<string> {
  if (!pool) throw new Error("no pool");
  const { rows } = await pool.query<{ id: string }>(
    `insert into spideryarn.articles (owner_id, slug, visibility, public_at)
     values ($1, $2, $3, case when $3 = 'public' then now() end)
     returning id`,
    [owner, `minimal-${name}`, visibility],
  );
  return rows[0]!.id;
}

/** A charged row of `kind`, written straight in — what a settlement leaves behind. */
async function givenCharged(
  kind: "ingest" | "minimal",
  articleId: string | null,
  at?: Date,
  owner: OwnerId = OWNER,
): Promise<string> {
  if (!pool) throw new Error("no pool");
  const { rows } = await pool.query<{ id: string }>(
    `insert into spideryarn.ingest_events (owner_id, kind, reserved_at, succeeded_at, article_id)
     values ($1, $2, coalesce($4::timestamptz, now()), coalesce($4::timestamptz, now()), $3)
     returning id`,
    [owner, kind, articleId, at ?? null],
  );
  return rows[0]!.id;
}

/** `n` charged minimal papers with no article — cheap padding to put `used` anywhere even. */
async function givenMinimalPadding(n: number): Promise<void> {
  if (!pool) return;
  await pool.query(
    `insert into spideryarn.ingest_events (owner_id, kind, reserved_at, succeeded_at)
     select $1, 'minimal', now(), now() from generate_series(1, $2::int)`,
    [OWNER, n],
  );
}

async function setVisibility(slug: string, to: "private" | "public"): Promise<void> {
  await runAsOwner(OWNER, () => pgVisibilityStore.set(slug, to, true));
}

/** Settle `ingestEventId` as succeeded onto `articleId`, and supersede, in one transaction. */
async function settleUpgrade(ingestEventId: string, articleId: string): Promise<number> {
  return await getDb().transaction(async (tx) => {
    await settleReservation(tx, ingestEventId, { kind: "succeeded", articleId });
    return await supersedeMinimal(tx, articleId, ingestEventId);
  });
}

/** A failed job carrying `ingestEventId`, whose reservation is then released. */
async function givenFailedJob(ingestEventId: string): Promise<string> {
  if (!pool) throw new Error("no pool");
  const id = mintId();
  await getDb().insert(jobs).values({
    id,
    ownerId: OWNER,
    slug: `minimal-retry-${id}`,
    steps: [],
    status: "error",
    workKey: `work-${id}`,
    ingestEventId,
  });
  await pool.query(
    "update spideryarn.ingest_events set released_at = now() where id = $1 and succeeded_at is null",
    [ingestEventId],
  );
  return id;
}

async function clear(): Promise<void> {
  if (!pool) return;
  for (const owner of [OWNER, STRANGER]) {
    await pool.query("delete from spideryarn.jobs where owner_id = $1", [owner]);
    /* One statement for the whole ledger, so a row and the row that superseded
       it go together and the self-reference has nothing to object to. */
    await pool.query("delete from spideryarn.ingest_events where owner_id = $1", [owner]);
    await pool.query("delete from spideryarn.article_visibility_changes where actor_owner_id = $1", [
      owner,
    ]);
    await pool.query("delete from spideryarn.articles where owner_id = $1", [owner]);
    await pool.query("delete from spideryarn.billing_accounts where owner_id = $1", [owner]);
  }
}

beforeEach(async () => {
  if (!pool) return;
  for (const id of [OWNER, STRANGER]) {
    await seedAuthUser(pool, { id, email: `minimal-${id}@spideryarn.local`, onConflictDoNothing: true });
  }
  await clear();
});

afterAll(async () => {
  if (!pool) return;
  await clear();
  await pool.query("delete from auth.users where id = any($1::uuid[])", [[OWNER, STRANGER]]).catch(() => {});
  await pool.end();
});

/* ------------------------------------------------------- the minimal wall -- */

describe("a minimal paper must fit whole", () => {
  it("is 2 points, and the wall is used + 2 <= budget", () => {
    const budget = points(600);
    expect(admitsMinimal(points(598), budget)).toBe(true);
    /* One point left cannot happen on the ledger — every price is even — so the
       predicate is held here rather than through rows. */
    expect(admitsMinimal(points(599), budget)).toBe(false);
    expect(admitsMinimal(points(600), budget)).toBe(false);
    expect(minimalHeadroom(points(580), budget)).toBe(10);
    expect(minimalHeadroom(points(599), budget)).toBe(0);
    expect(minimalHeadroom(points(700), budget)).toBe(0);
  });

  it("admits a paper with exactly 2 points left, and refuses the next", async () => {
    /* Two private articles (400) and 99 papers (198): 598 of 600. */
    await givenCharged("ingest", await givenArticle("wall-a"));
    await givenCharged("ingest", await givenArticle("wall-b"));
    await givenMinimalPadding(99);
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(598);

    expect((await reserveMinimal(OWNER)).kind).toBe("admitted");
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(FREE_BUDGET);

    const refused = await reserveMinimal(OWNER);
    expect(refused).toMatchObject({ kind: "refused", fits: 0, limit: FREE_LIFETIME_INGESTS });
    /* And no overdraft at all: the refused one wrote nothing. */
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(FREE_BUDGET);
  });

  /**
   * **The burst the whole ledger exists to survive**, at a hundredth of the
   * price: twenty concurrent reservations against room for exactly ten. Each one
   * waits on the owner's billing row and reads the others' reservations as used.
   */
  it("admits exactly ten of twenty concurrent papers against room for ten", async () => {
    /* 400 + 100 + 80 = 580 of 600: twenty points, ten papers. */
    await givenCharged("ingest", await givenArticle("burst-a"));
    await givenCharged("ingest", await givenArticle("burst-b"));
    await givenCharged("ingest", await givenArticle("burst-c", "public"));
    await givenMinimalPadding(40);
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(580);

    const answers = await Promise.all(Array.from({ length: 20 }, () => reserveMinimal(OWNER)));
    expect(answers.filter((a) => a.kind === "admitted")).toHaveLength(10);
    expect(answers.filter((a) => a.kind === "refused")).toHaveLength(10);

    const usage = await usageFor(OWNER, FREE);
    expect(usage.inFlightMinimal).toBe(10);
    expect(wallUsed(usage)).toBe(FREE_BUDGET);
  });

  it("charges a minimal reservation 2 points in flight, not 200", async () => {
    expect((await reserveMinimal(OWNER)).kind).toBe("admitted");
    const usage = await usageFor(OWNER, FREE);
    expect(usage).toMatchObject({ inFlightIngest: 0, inFlightMinimal: 1, minimalCharged: 0 });
    expect(wallUsed(usage)).toBe(2);
    expect(minimalUsed(usage)).toBe(1);
  });

  it("says how many papers still fit, and never as a fraction of an article", () => {
    const none = minimalQuotaReached({ fits: 0 }).message;
    expect(none).toContain("no room left in your allowance for another paper");
    expect(none).toContain("[pay-minimal]");
    expect(minimalQuotaReached({ fits: 40 }).message).toContain("room for 40 more papers");
    expect(minimalQuotaReached({ fits: 1 }).message).toContain("room for 1 more paper,");
    expect(none).toContain("1/100 of an article");
  });
});

/* ----------------------------------------------------- the price of a paper -- */

describe("a minimal row is never priced by visibility", () => {
  it("costs 2 on a public article, and 2 after that article is deleted", async () => {
    if (!pool) return;
    const shared = await givenArticle("public-paper", "public");
    await givenCharged("minimal", shared);
    let usage = await usageFor(OWNER, FREE);
    expect(usage).toMatchObject({ minimalCharged: 1, chargedHalfPrice: 0, chargedFullPrice: 0 });
    expect(wallUsed(usage)).toBe(2);

    /* The delete trigger freezes `'public'` onto the row; a minimal row ignores
       it, because its price never depended on it. */
    await pool.query("delete from spideryarn.articles where id = $1", [shared]);
    usage = await usageFor(OWNER, FREE);
    expect(usage).toMatchObject({ minimalCharged: 1, chargedHalfPrice: 0, chargedFullPrice: 0 });
    expect(wallUsed(usage)).toBe(2);
  });
});

/* -------------------------------------------------------------- Read this -- */

describe("Read this is the ingest wall, credited the paper's own 2 points", () => {
  it("is used + (200 − credit) <= budget + 100", () => {
    const budget = points(600);
    expect(admitsUpgrade(points(502), budget, 2)).toBe(true);
    expect(admitsUpgrade(points(503), budget, 2)).toBe(false);
    expect(admitsUpgrade(points(502), budget, 0)).toBe(false);
    expect(admitsUpgrade(points(500), budget, 0)).toBe(true);
  });

  it("admits with 198 left under the ceiling, which is Read this with the credit", async () => {
    /* The paper (2) + one private (200) + three public (300) = 502: the ceiling
       is 700, so 198 is left — exactly *Read this* with the credit. */
    const paper = await givenArticle("credited");
    await givenCharged("minimal", paper);
    await givenCharged("ingest", await givenArticle("credited-private"));
    for (const n of [1, 2, 3]) await givenCharged("ingest", await givenArticle(`credited-public-${n}`, "public"));
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(502);

    const admitted = await reserveUpgrade(OWNER, paper);
    expect(admitted.kind).toBe("admitted");
  });

  it("refuses with 196 left under the ceiling, even with the credit", async () => {
    /* 504: one more paper than the case above. 504 + 198 = 702 > 700. */
    const paper = await givenArticle("short");
    await givenCharged("minimal", paper);
    await givenMinimalPadding(1);
    await givenCharged("ingest", await givenArticle("short-private"));
    for (const n of [1, 2, 3]) await givenCharged("ingest", await givenArticle(`short-public-${n}`, "public"));
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(504);

    expect(await reserveUpgrade(OWNER, paper)).toMatchObject({ kind: "refused", limit: 3 });
  });

  /**
   * **The credit is this paper's own row in this window, not a constant**
   * (Opus's review). A paper added before this paid period is not in this
   * period's `used`, so crediting its 2 points would credit a charge nobody is
   * counting. The control beside it is the same account with the paper's row
   * inside the window, which is admitted — so the refusal is the credit, and not
   * something else about the setup.
   */
  it("credits nothing when the paper's minimal row is outside the window", async () => {
    await givenPaidPeriod();
    const paper = await givenArticle("last-month");
    await givenCharged("minimal", paper, new Date(PERIOD_START.getTime() - 60_000));
    /* In the window: one private (200), one public (100), another paper (2) =
       302 of a 400 budget, ceiling 500. Credit 0: 302 + 200 > 500. */
    await givenCharged("ingest", await givenArticle("window-private"), new Date(PERIOD_START.getTime() + 1));
    await givenCharged("ingest", await givenArticle("window-public", "public"), new Date(PERIOD_START.getTime() + 2));
    await givenCharged("minimal", await givenArticle("window-paper"), new Date(PERIOD_START.getTime() + 3));
    expect(wallUsed(await usageFor(OWNER, PAID))).toBe(302);

    expect((await reserveUpgrade(OWNER, paper, TIERS)).kind).toBe("refused");
  });

  it("credits the paper when its row is inside the window (the control)", async () => {
    await givenPaidPeriod();
    const paper = await givenArticle("this-month");
    await givenCharged("minimal", paper, new Date(PERIOD_START.getTime() + 3));
    await givenCharged("ingest", await givenArticle("control-private"), new Date(PERIOD_START.getTime() + 1));
    await givenCharged("ingest", await givenArticle("control-public", "public"), new Date(PERIOD_START.getTime() + 2));
    /* 302 again, but the 2 are this paper's: 302 + 198 = 500, admitted. */
    expect(wallUsed(await usageFor(OWNER, PAID))).toBe(302);

    expect((await reserveUpgrade(OWNER, paper, TIERS)).kind).toBe("admitted");
  });

  it("lets only one of two concurrent presses on one paper through", async () => {
    const paper = await givenArticle("twice");
    await givenCharged("minimal", paper);
    const answers = await Promise.all([reserveUpgrade(OWNER, paper), reserveUpgrade(OWNER, paper)]);
    expect(answers.map((a) => a.kind).sort()).toEqual(["admitted", "in-flight"]);
  });

  it("is not found for somebody else's article, and writes nothing", async () => {
    if (!pool) return;
    const theirs = await givenArticle("theirs", "private", STRANGER);
    expect(await reserveUpgrade(OWNER, theirs)).toEqual({ kind: "not-found" });
    const { rows } = await pool.query("select 1 from spideryarn.billing_accounts where owner_id = $1", [OWNER]);
    expect(rows).toHaveLength(0);
  });

  it("does not reserve Read this for an article with no live minimal charge", async () => {
    const full = await givenArticle("already-full");
    expect(await reserveUpgrade(OWNER, full)).toEqual({ kind: "not-found" });
  });

  it("binds the reservation to its article from birth, and settles onto no other", async () => {
    if (!pool) return;
    const paper = await givenArticle("bound");
    await givenCharged("minimal", paper);
    const admitted = await reserveUpgrade(OWNER, paper);
    if (admitted.kind !== "admitted") throw new Error(`expected an admission, got ${admitted.kind}`);
    const { rows } = await pool.query<{ article_id: string; kind: string }>(
      "select article_id, kind from spideryarn.ingest_events where id = $1",
      [admitted.reservationId],
    );
    expect(rows[0]).toEqual({ article_id: paper, kind: "ingest" });

    const other = await givenArticle("not-bound");
    await expect(
      getDb().transaction((tx) =>
        settleReservation(tx, admitted.reservationId, { kind: "succeeded", articleId: other }),
      ),
    ).rejects.toThrow(/could not be settled/);
  });
});

/* ----------------------------------------------------------- supersession -- */

describe("supersession makes a paper exactly one ingest", () => {
  /** The whole life of a paper: added (2), Read this in flight (202), read (200). */
  async function readPaper(name: string): Promise<{ paper: string; slug: string }> {
    const paper = await givenArticle(name);
    const minimal = await reserveMinimal(OWNER);
    if (minimal.kind !== "admitted") throw new Error("the paper was not admitted");
    await settleReservation(getDb(), minimal.reservationId, { kind: "succeeded", articleId: paper });
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(2);

    const upgrade = await reserveUpgrade(OWNER, paper);
    if (upgrade.kind !== "admitted") throw new Error(`Read this was not admitted: ${upgrade.kind}`);
    /* While it runs the paper costs 1.01 of an article: the safe side. */
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(202);

    expect(await settleUpgrade(upgrade.reservationId, paper)).toBe(1);
    return { paper, slug: `minimal-${name}` };
  }

  it("totals 200 once read, and still 200 after the paper is deleted", async () => {
    if (!pool) return;
    const { paper } = await readPaper("read-then-deleted");
    const usage = await usageFor(OWNER, FREE);
    expect(usage).toMatchObject({ chargedFullPrice: 1, minimalCharged: 0, inFlightIngest: 0 });
    expect(wallUsed(usage)).toBe(200);
    /* The credit was consumed with the supersession. A later press must not
       reserve another ingest against the same minimal row. */
    expect(await reserveUpgrade(OWNER, paper)).toEqual({ kind: "not-found" });

    /* The delete trigger unlinks both rows; the stamp survives the unlink, which
       is why it is a reference and not a correlation. */
    await pool.query("delete from spideryarn.articles where id = $1", [paper]);
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(200);
  });

  it("totals 100 once the read paper is shared", async () => {
    const { slug } = await readPaper("read-then-shared");
    await setVisibility(slug, "public");
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(100);
  });

  it("the supersession primitive reports zero for an article with no minimal row", async () => {
    const article = await givenArticle("never-minimal");
    const payer = await givenCharged("ingest", article);
    expect(await getDb().transaction((tx) => supersedeMinimal(tx, article, payer))).toBe(0);
  });

  it("is refused by the database before the ingest that pays for it is charged", async () => {
    const paper = await givenArticle("unpaid");
    await givenCharged("minimal", paper);
    const upgrade = await reserveUpgrade(OWNER, paper);
    if (upgrade.kind !== "admitted") throw new Error("expected an admission");
    await expect(
      getDb().transaction((tx) => supersedeMinimal(tx, paper, upgrade.reservationId)),
    ).rejects.toThrow();
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(202);
  });

  it("is refused when the payer is another owner's or another article's ingest", async () => {
    if (!pool) return;
    const paper = await givenArticle("misattributed");
    await givenCharged("minimal", paper);
    const elsewhere = await givenCharged("ingest", await givenArticle("elsewhere"));
    const stranger = await givenCharged("ingest", await givenArticle("stranger", "private", STRANGER), undefined, STRANGER);
    for (const payer of [elsewhere, stranger]) {
      await expect(
        getDb().transaction((tx) => supersedeMinimal(tx, paper, payer)),
        `payer ${payer}`,
      ).rejects.toThrow();
    }
    /* And a check of its own: only a minimal row may carry the stamp at all. */
    await expect(
      pool.query("update spideryarn.ingest_events set superseded_by = $1 where id = $1", [elsewhere]),
    ).rejects.toThrow(/ingest_events_superseded_shape/);
  });
});

/* ------------------------------------------------------- retry keeps kind -- */

describe("a retry reserves the same kind again", () => {
  it("re-reserves a minimal paper at 2 points, not 200", async () => {
    const first = await reserveMinimal(OWNER);
    if (first.kind !== "admitted") throw new Error("expected an admission");
    const job = await givenFailedJob(first.reservationId);
    expect(await reservationShapeOf(first.reservationId, OWNER)).toEqual({ kind: "minimal" });

    const seen = await withRetrySlot({ jobId: job, ownerId: OWNER }, async (slot) => {
      const usage = await usageFor(OWNER, FREE);
      return { slot, usage };
    });
    expect(seen.slot.ingestEventId).toBeDefined();
    expect(seen.usage).toMatchObject({ inFlightMinimal: 1, inFlightIngest: 0 });
    expect(wallUsed(seen.usage)).toBe(2);
  });

  it("runs a minimal retry's claim work under its fresh reservation lock", async () => {
    const first = await reserveMinimal(OWNER);
    if (first.kind !== "admitted") throw new Error("expected an admission");
    const job = await givenFailedJob(first.reservationId);
    let seen: unknown = null;

    await withRetrySlot(
      {
        jobId: job,
        ownerId: OWNER,
        minimalInLock: async (tx, { reservationId }) => {
          const found = await tx.execute(
            sql`select kind from spideryarn.ingest_events where id = ${reservationId}::uuid`,
          );
          seen = (found as { rows: unknown[] }).rows[0];
        },
      },
      async () => undefined,
    );

    expect(seen).toEqual({ kind: "minimal" });
  });

  it("re-reserves Read this bound to the same paper", async () => {
    if (!pool) return;
    const paper = await givenArticle("retried-read");
    await givenCharged("minimal", paper);
    const first = await reserveUpgrade(OWNER, paper);
    if (first.kind !== "admitted") throw new Error("expected an admission");
    const job = await givenFailedJob(first.reservationId);
    expect(await reservationShapeOf(first.reservationId, OWNER)).toEqual({ kind: "upgrade", articleId: paper });

    const fresh = await withRetrySlot({ jobId: job, ownerId: OWNER }, async (slot) => slot.ingestEventId);
    const { rows } = await pool.query<{ kind: string; article_id: string | null }>(
      "select kind, article_id from spideryarn.ingest_events where id = $1",
      [fresh],
    );
    expect(rows[0]).toEqual({ kind: "ingest", article_id: paper });
  });
});

/* ------------------------------------------------------------- the offer -- */

describe("the sharing offer never names a paper nobody has read", () => {
  it("leaves a minimal paper out, even when it would sort first", async () => {
    /* Three private articles (600) and one paper (2): 602, refused. Sharing
       frees 100 an article, so two are needed. The paper's slug sorts first, so
       an offer that counted it would name it. */
    await givenCharged("minimal", await givenArticle("aaa-paper"));
    for (const n of [1, 2, 3]) await givenCharged("ingest", await givenArticle(`zz-read-${n}`));
    const refused = await ingestEligibility(OWNER);
    expect(refused.kind).toBe("refused");
    expect(refused).toMatchObject({
      shareToMakeRoom: [{ title: "minimal-zz-read-1" }, { title: "minimal-zz-read-2" }],
    });
  });

  it("offers nothing to an account full of papers", async () => {
    await givenMinimalPadding(299);
    await givenCharged("minimal", await givenArticle("last-paper"));
    const usage = await usageFor(OWNER, FREE);
    expect(wallUsed(usage)).toBe(FREE_BUDGET);
    expect(await sharingWouldMakeRoom(OWNER, FREE, usage)).toBe(false);
  });
});

/* ------------------------------------------------------- the inLock seam -- */

describe("the inLock seam runs in the reservation's own transaction", () => {
  it("sees the reservation it may link to", async () => {
    let seen: unknown = null;
    const admitted = await reserveMinimal(OWNER, {
      inLock: async (tx, { reservationId }) => {
        const found = await tx.execute(
          sql`select kind from spideryarn.ingest_events where id = ${reservationId}::uuid`,
        );
        seen = (found as { rows: unknown[] }).rows[0];
      },
    });
    expect(admitted.kind).toBe("admitted");
    expect(seen).toEqual({ kind: "minimal" });
  });

  it("rolls the reservation back when it throws, and the throw reaches the caller", async () => {
    await expect(
      reserveMinimal(OWNER, {
        inLock: async () => {
          throw Object.assign(new Error("already on your shelf"), { status: 409 });
        },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(0);
  });

  it("does not run when the paper is refused", async () => {
    await givenMinimalPadding(300);
    let ran = false;
    const answer = await reserveMinimal(OWNER, {
      inLock: async () => {
        ran = true;
      },
    });
    expect(answer.kind).toBe("refused");
    expect(ran).toBe(false);
  });
});
