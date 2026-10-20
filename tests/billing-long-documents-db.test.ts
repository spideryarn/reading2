/**
 * **A long PDF costs one slot per 50 pages — the ledger half**, against a real
 * database. The arithmetic alone is tests/billing-long-documents.test.ts.
 *
 * > I think we need to allow import of longer articles. … each 100 pages counts
 * > as 1 article … if I'm a user with 2 articles left, and I upload a 150-page
 * > article, it uses up both those article-slots.
 * >
 * > — Greg, 2026-10-19 (and 50 pages a slot, not 100, on 2026-10-20)
 *
 * docs/plans/261020b-longer-documents-up-to-400-pages-cost-a-slot-per-100-pages.md,
 * stage 2's list. What is held here, and why each is a way the quota could
 * quietly let a long document run on one slot:
 *
 * 1. **Usage prices slots, and counts rows** — a 3-slot row is 600 points and
 *    one article added; public halves it per slot; deletion freezes all of it.
 * 2. **The reprice** (`priceFetchedPdf`): Greg's two-slots-left pair at 50
 *    pages; twenty concurrent reprices on one account; a stale claimant; the
 *    administrator; a minimal row recording its pages; the same count twice.
 * 3. **Rule 4**, a re-run with no reservation: refused above what the article
 *    already was, allowed at or below; a legacy 200-page article's Rebuild; a
 *    web page rebuilt into a long PDF.
 * 4. **The paths that skip stage 1** carry the weight: a retry, *Read this* on a
 *    long minimal paper and on a legacy one, High-powered AI on a long article
 *    and on a legacy one.
 * 5. **The sharing offer** answers the request's own cost.
 * 6. **Barriers** (R2-F5): a reprice against Stop, expiry, the store's own
 *    ending and a visibility change, each a real second writer held behind a
 *    third connection, finishing without deadlock with the reservation in a
 *    state the ledger can explain.
 *
 * A real database, this file's own owner, no Stripe and no network.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { withRetrySlot } from "../src/billing/admission.js";
import { FREE } from "../src/billing/tiers.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { runAsOwner } from "../src/owner.js";
import type { OwnerId } from "../src/owner.js";
import { mintAttempt, StaleAttemptError } from "../src/store/jobs.js";
import {
  ingestEligibility,
  ingestSlotsUsed,
  ingestsUsed,
  pdfPricing,
  priceFetchedPdf,
  reserveIngest,
  reserveUpgrade,
  switchOnHighPower,
  usageFor,
  wallUsed,
} from "../src/store/pg-billing.js";
import { getDb } from "../src/db/client.js";
import { adminQueries } from "../src/store/pg-admin.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { updateVoucher } from "../src/store/pg-vouchers.js";
import { pgVisibilityStore } from "../src/store/pg-visibility.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

/* Before `pgReady`, or the whole file refuses for the wrong reason. */
loadEnvLocal();
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const { pool } = await pgReady({
  suite: "tests/billing-long-documents-db.test.ts",
  tables: ["spideryarn.billing_accounts", "spideryarn.ingest_events", "spideryarn.articles", "spideryarn.jobs"],
  /* The migration this file is about: without it every case would fail on a
     missing column rather than on the rule it checks. */
  columns: [
    { table: "spideryarn.ingest_events", column: "slots" },
    { table: "spideryarn.ingest_events", column: "pages" },
    { table: "spideryarn.article_revisions", column: "raw_pages" },
  ],
  keepPool: true,
  max: 6,
});

/** Fixed and distinctive, so a killed run's rows are cleared rather than added to. */
const OWNER = "0b11a1a0-0000-4000-8000-00000010ba01" as OwnerId;
const SLUG = "long-pdf-";

/** No tier sells anything, so every admission is the free one: 600 points, three articles. */
const NO_TIERS = [] as const;

/* --------------------------------------------------------------- fixture -- */

async function givenArticle(name: string, visibility: "private" | "public" = "private"): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into spideryarn.articles (owner_id, slug, visibility, public_at)
     values ($1, $2, $3, case when $3 = 'public' then now() end)
     returning id`,
    [OWNER, `${SLUG}${name}`, visibility],
  );
  return rows[0]!.id;
}

/** A charged row of `slots`, written straight in — what a settlement leaves behind. */
async function givenCharged(
  articleId: string | null,
  slots = 1,
  kind: "ingest" | "minimal" = "ingest",
  pages: number | null = null,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into spideryarn.ingest_events (owner_id, kind, reserved_at, succeeded_at, article_id, slots, pages)
     values ($1, $2, now(), now(), $3, $4, $5)
     returning id`,
    [OWNER, kind, articleId, slots, pages],
  );
  return rows[0]!.id;
}

/** A reservation the route would have taken: one slot, through the real admission. */
async function reserved(): Promise<string> {
  const admission = await reserveIngest(OWNER, undefined, NO_TIERS);
  if (admission.kind !== "admitted") throw new Error(`reserving answered ${admission.kind}`);
  return admission.reservationId;
}

/** A running job on a live claim, carrying `ingestEventId` — what stage 1 runs inside. */
async function givenRunningJob(
  slug: string,
  ingestEventId: string | null,
  steps: readonly { readonly name: string; readonly label: string; readonly status: string }[] = [],
): Promise<{ readonly id: string; readonly attempt: string }> {
  const id = mintId();
  const attempt = mintAttempt();
  await pool.query(
    `insert into spideryarn.jobs
       (id, owner_id, slug, steps, status, work_key, ingest_event_id, attempt_id, lease_expires_at)
     values ($1, $2, $3, $4::jsonb, 'running', $5, $6, $7, now() + interval '10 minutes')`,
    [id, OWNER, `${SLUG}${slug}`, JSON.stringify(steps), `work-${id}`, ingestEventId, attempt],
  );
  return { id, attempt };
}

async function row(id: string) {
  const { rows } = await pool.query<{
    slots: number;
    pages: number | null;
    succeeded: boolean;
    released: boolean;
  }>(
    `select slots, pages, succeeded_at is not null as succeeded, released_at is not null as released
       from spideryarn.ingest_events where id = $1`,
    [id],
  );
  if (!rows[0]) throw new Error(`no ingest_events row ${id}`);
  return rows[0];
}

const price = (job: { id: string; attempt: string }, pages: number, previous: number | null = null) =>
  priceFetchedPdf(job.id, job.attempt, pages, previous, NO_TIERS);

async function clear(): Promise<void> {
  await pool.query("delete from spideryarn.jobs where owner_id = $1", [OWNER]);
  await pool.query("delete from spideryarn.ingest_events where owner_id = $1", [OWNER]);
  await pool.query("delete from spideryarn.article_visibility_changes where actor_owner_id = $1", [OWNER]);
  await pool.query("delete from spideryarn.articles where owner_id = $1", [OWNER]);
  await pool.query("delete from spideryarn.billing_vouchers where claimed_by = $1 or created_by = $1", [OWNER]);
  await pool.query("delete from spideryarn.billing_accounts where owner_id = $1", [OWNER]);
}

beforeEach(async () => {
  await seedAuthUser(pool, { id: OWNER, email: `long-pdf-${OWNER}@spideryarn.local`, onConflictDoNothing: true });
  await clear();
});

afterAll(async () => {
  await clear();
  await pool.query("delete from auth.users where id = $1", [OWNER]).catch(() => {});
  await pool.end();
});

/* ---------------------------------------------------------------- usage -- */

describe("usage prices slots and counts rows", () => {
  it("a 3-slot article is 600 points and one article added", async () => {
    await givenCharged(await givenArticle("u1"), 3);
    const usage = await usageFor(OWNER, FREE);
    expect(wallUsed(usage)).toBe(600);
    expect(ingestsUsed(usage)).toBe(1);
    expect(ingestSlotsUsed(usage)).toBe(3);
  });

  it("the admin aggregate counts the row once and sums its slots", async () => {
    await givenCharged(await givenArticle("u-admin"), 3);
    const rows = await adminQueries(getDb()).ingests;
    const mine = rows.find((r) => r.owner === OWNER);
    expect(mine).toMatchObject({ lifetime: 1, slots: { lifetime: 3 } });
  });

  it("public halves every slot, and deletion freezes the half", async () => {
    await givenCharged(await givenArticle("u2", "public"), 3);
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(300);
    await pool.query("delete from spideryarn.articles where slug = $1", [`${SLUG}u2`]);
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(300);
  });

  it("an unsettled reservation counts 200 a slot, once repriced", async () => {
    const reservation = await reserved();
    const job = await givenRunningJob("u3", reservation);
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(200);
    expect(await price(job, 120)).toMatchObject({ kind: "priced", slots: 3 });
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(600);
  });
});

/* -------------------------------------------------------------- reprice -- */

describe("stage 1 reprices the reservation once the pages are counted", () => {
  it("Greg's pair at 50 pages: with two slots left, 100 pages admits and 101 is refused", async () => {
    await givenCharged(await givenArticle("g0"));
    const a = await givenRunningJob("g1", await reserved());
    expect(await price(a, 100)).toMatchObject({ kind: "priced", slots: 2, pages: 100 });

    await clear();
    await givenCharged(await givenArticle("g0b"));
    const reservation = await reserved();
    const b = await givenRunningJob("g2", reservation);
    const refused = await price(b, 101);
    expect(refused).toMatchObject({ kind: "refused", slots: 3, pages: 101, slotsLeft: 2 });
    /* Nothing written: the row is still the one slot the route took. */
    expect(await row(reservation)).toMatchObject({ slots: 1, pages: null, succeeded: false, released: false });
  });

  it("twenty concurrent reprices on one account admit only what fits", async () => {
    /* A free account: three slots. Two one-slot reservations, as the route
       would let through, then each reprices to 2 slots (100 pages): one fits
       (200 + 400 ≤ 700) and the second cannot (400 + 400 > 700). */
    const reservations = [await reserved(), await reserved()];
    const claims = await Promise.all(reservations.map((r, i) => givenRunningJob(`burst-${i}`, r)));
    /* Twenty calls at once, ten on each job. */
    const calls = Array.from({ length: 20 }, (_, i) => price(claims[i % claims.length]!, 100));
    const answers = await Promise.all(calls);
    expect(answers.every((a) => a.kind === "priced" || a.kind === "refused")).toBe(true);
    /* Whatever interleaving won, exactly one was repriced and the wall held. */
    const weights = await Promise.all(reservations.map(async (r) => (await row(r)).slots));
    expect(weights.sort()).toEqual([1, 2]);
    expect(wallUsed(await usageFor(OWNER, FREE))).toBe(600);
  });

  it("a stale claimant can neither lower nor raise the replacement's slots", async () => {
    const reservation = await reserved();
    const job = await givenRunningJob("stale", reservation);
    expect(await price(job, 150)).toMatchObject({ kind: "priced", slots: 3 });
    /* A deadline handoff: the job now belongs to a new attempt. */
    const replacement = mintAttempt();
    await pool.query("update spideryarn.jobs set attempt_id = $2 where id = $1", [job.id, replacement]);
    await expect(price(job, 10)).rejects.toBeInstanceOf(StaleAttemptError);
    await expect(price(job, 400)).rejects.toBeInstanceOf(StaleAttemptError);
    expect((await row(reservation)).slots).toBe(3);
  });

  it("the same count twice is a no-op", async () => {
    const reservation = await reserved();
    const job = await givenRunningJob("twice", reservation);
    expect(await price(job, 150)).toMatchObject({ kind: "priced", slots: 3 });
    expect(await price(job, 150)).toMatchObject({ kind: "priced", slots: 3 });
    expect(await row(reservation)).toMatchObject({ slots: 3, pages: 150 });
  });

  it("a minimal paper records its pages and stays at a hundredth", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `insert into spideryarn.ingest_events (owner_id, kind) values ($1, 'minimal') returning id`,
      [OWNER],
    );
    const reservation = rows[0]!.id;
    const job = await givenRunningJob("minimal", reservation);
    expect(await price(job, 300)).toEqual({ kind: "minimal" });
    expect(await row(reservation)).toMatchObject({ slots: 1, pages: 300 });
    expect(await pdfPricing(job.id, 300)).toBe("unasked");
  });

  it("stage 2's belt: priced once repriced, underpriced before, unasked with no reservation", async () => {
    const reservation = await reserved();
    const job = await givenRunningJob("belt", reservation);
    expect(await pdfPricing(job.id, 150)).toBe("underpriced");
    await price(job, 150);
    expect(await pdfPricing(job.id, 150)).toBe("priced");
    const rerun = await givenRunningJob("belt-rerun", null);
    expect(await pdfPricing(rerun.id, 400)).toBe("unasked");
  });
});

/* ---------------------------------------------------------------- rule 4 -- */

describe("rule 4: a re-run may not fetch a heavier PDF for free", () => {
  it("is refused above what the article already was, and runs at or below it", async () => {
    await givenCharged(await givenArticle("r4"), 2);
    const job = await givenRunningJob("r4", null);
    expect(await price(job, 100)).toEqual({ kind: "unpriced" });
    expect(await price(job, 101)).toEqual({ kind: "refused-rerun", slots: 3, paidSlots: 2, pages: 101 });
  });

  it("a legacy 200-page article's Rebuild runs: its previous source was 200 pages", async () => {
    await givenCharged(await givenArticle("legacy"), 1);
    const job = await givenRunningJob("legacy", null);
    expect(await price(job, 200, 200)).toEqual({ kind: "unpriced" });
  });

  it("a one-page web page rebuilt into a 400-page PDF is refused", async () => {
    await givenCharged(await givenArticle("web"), 1);
    const job = await givenRunningJob("web", null);
    /* The previous source was a web page, which the fetch step passes as null. */
    expect(await price(job, 400, null)).toMatchObject({ kind: "refused-rerun", slots: 8, paidSlots: 1 });
  });

  it("an article with no charged rows and no previous source is one slot", async () => {
    await givenArticle("bare");
    const job = await givenRunningJob("bare", null);
    expect(await price(job, 51)).toMatchObject({ kind: "refused-rerun", paidSlots: 1 });
  });
});

/* ---------------------------------------------- paths that skip stage 1 -- */

describe("the paths that skip stage 1 carry the weight", () => {
  it("a retry reserves the old row's slots", async () => {
    const old = await reserved();
    const job = await givenRunningJob("retry", old);
    await price(job, 150);
    await pool.query("update spideryarn.jobs set status = 'error', attempt_id = null, lease_expires_at = null where id = $1", [job.id]);
    await pool.query("update spideryarn.ingest_events set released_at = now() where id = $1", [old]);

    let taken: string | undefined;
    await withRetrySlot({ jobId: job.id, ownerId: OWNER }, async (slot) => {
      taken = slot.ingestEventId;
    });
    expect(taken).toBeDefined();
    expect((await row(taken!)).slots).toBe(3);
  });

  it("Read this on a long minimal paper reserves its slots; a legacy one, one", async () => {
    const long = await givenArticle("paper-long");
    await givenCharged(long, 1, "minimal", 120);
    const answer = await reserveUpgrade(OWNER, long, NO_TIERS);
    expect(answer.kind).toBe("admitted");
    if (answer.kind === "admitted") expect((await row(answer.reservationId)).slots).toBe(3);

    await clear();
    const legacy = await givenArticle("paper-legacy");
    await givenCharged(legacy, 1, "minimal", null);
    const old = await reserveUpgrade(OWNER, legacy, NO_TIERS);
    if (old.kind !== "admitted") throw new Error(`Read this on a legacy paper answered ${old.kind}`);
    expect((await row(old.reservationId)).slots).toBe(1);
  });

  it("Read this on a paper too long for what is left is refused", async () => {
    await givenCharged(await givenArticle("other"), 1);
    const long = await givenArticle("paper-too-long");
    await givenCharged(long, 1, "minimal", 150); // 3 slots, 2 left
    expect((await reserveUpgrade(OWNER, long, NO_TIERS)).kind).toBe("refused");
  });

  it("High-powered AI on a long article charges its slots again; a legacy one, one", async () => {
    /* A 20-article budget is not available without a tier, so the long article
       is 1 slot of the free 3 plus its own High-powered 2: 2 + 2 = 4 > 3. */
    await givenCharged(await givenArticle("hp-long"), 2);
    const refused = await runAsOwner(OWNER, () => switchOnHighPower(OWNER, `${SLUG}hp-long`, NO_TIERS));
    expect(refused.kind).toBe("no-room");

    await clear();
    await givenCharged(await givenArticle("hp-legacy"), 1);
    const on = await runAsOwner(OWNER, () => switchOnHighPower(OWNER, `${SLUG}hp-legacy`, NO_TIERS));
    expect(on.kind).toBe("on");
    const { rows } = await pool.query<{ slots: number }>(
      "select slots from spideryarn.ingest_events where owner_id = $1 and kind = 'high_power'",
      [OWNER],
    );
    expect(rows.map((r) => r.slots)).toEqual([1]);
  });

  it("High-powered AI writes the article's largest charged weight", async () => {
    /* A re-add before 2026-10-07 could leave two charged rows; the larger wins. */
    const articleId = await givenArticle("hp-two");
    await givenCharged(articleId, 1);
    await givenCharged(articleId, 1);
    await pool.query(
      "update spideryarn.ingest_events set slots = 2 where id = (select id from spideryarn.ingest_events where article_id = $1 limit 1)",
      [articleId],
    );
    /* 3 slots charged already; the upgrade's 2 more would need 1,000 of 600. */
    const answer = await runAsOwner(OWNER, () => switchOnHighPower(OWNER, `${SLUG}hp-two`, NO_TIERS));
    expect(answer.kind).toBe("no-room");
  });

  it("High-powered AI cannot switch on before an in-flight import has been priced", async () => {
    await givenArticle("hp-before-price");
    const reservation = await reserved();
    await givenRunningJob("hp-before-price", reservation, [
      { name: "fetch", label: "Fetching the article", status: "running" },
    ]);

    const answer = await runAsOwner(OWNER, () =>
      switchOnHighPower(OWNER, `${SLUG}hp-before-price`, NO_TIERS),
    );
    expect(answer.kind).toBe("pending");
    expect(
      await pool.query(
        "select 1 from spideryarn.ingest_events where owner_id = $1 and kind = 'high_power'",
        [OWNER],
      ),
    ).toHaveProperty("rowCount", 0);
  });

  it("High-powered AI uses a priced but unsettled import's weight", async () => {
    await givenArticle("hp-priced-in-flight", "public");
    const reservation = await reserved();
    const job = await givenRunningJob("hp-priced-in-flight", reservation, [
      { name: "fetch", label: "Fetching the article", status: "running" },
    ]);
    await price(job, 100); // two slots; public High-powered costs one slot and fits exactly
    await pool.query(
      `update spideryarn.jobs
          set steps = '[{"name":"fetch","label":"Fetching the article","status":"done"}]'::jsonb
        where id = $1`,
      [job.id],
    );

    const answer = await runAsOwner(OWNER, () =>
      switchOnHighPower(OWNER, `${SLUG}hp-priced-in-flight`, NO_TIERS),
    );
    expect(answer.kind).toBe("on");
    const { rows } = await pool.query<{ slots: number }>(
      "select slots from spideryarn.ingest_events where owner_id = $1 and kind = 'high_power'",
      [OWNER],
    );
    expect(rows.map((r) => r.slots)).toEqual([2]);
  });
});

/* ----------------------------------- High-powered against a queued import -- */

/**
 * **A queued import is as alive as a running one** (Sol's C2-F1, P0). A
 * deadline hand-back puts a running job back to `queued` with its reservation
 * and its fetch kept; a retry's fresh job is queued against an article that
 * already exists. Either way the reservation is unsettled, and High-powered
 * must wait for it or charge its weight — never charge one slot for ever.
 * On a 20-article tier, so the price is what is under test.
 */
describe("High-powered AI waits for, or charges, a queued import's weight", () => {
  const PRICE = "price_long_pdf_db_hp";
  const TIERS = [
    {
      id: "long-pdf-db-hp",
      productName: "Spideryarn Long PDF DB",
      description: "Twenty articles a month.",
      ingestsPerPeriod: 20,
      lookupKey: "spideryarn_long_pdf_db_hp_monthly",
      stripePriceId: PRICE,
      livemode: false,
      active: true,
      sortOrder: 32,
      amounts: { usd: 1000 },
    },
  ] as const;

  async function givenPaid(): Promise<void> {
    await pool.query(
      `insert into spideryarn.billing_accounts
         (owner_id, stripe_customer_id, stripe_subscription_id, price_id, status,
          current_period_start, current_period_end)
       values ($1, $2, $3, $4, 'active', now() - interval '5 days', now() + interval '25 days')
       on conflict (owner_id) do update set price_id = excluded.price_id, status = 'active',
         current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end`,
      [OWNER, `cus_${OWNER}`, `sub_${OWNER}`, PRICE],
    );
  }

  /** An unsettled one-slot-or-more reservation, and a queued job carrying it. */
  async function givenQueued(name: string, slots: number, fetch: "done" | "skipped" | "pending") {
    await givenArticle(name);
    const { rows } = await pool.query<{ id: string }>(
      "insert into spideryarn.ingest_events (owner_id, slots) values ($1, $2) returning id",
      [OWNER, slots],
    );
    const reservation = rows[0]!.id;
    const id = mintId();
    await pool.query(
      `insert into spideryarn.jobs (id, owner_id, slug, steps, status, work_key, ingest_event_id)
       values ($1, $2, $3, $4::jsonb, 'queued', $5, $6)`,
      [
        id,
        OWNER,
        `${SLUG}${name}`,
        JSON.stringify([{ name: "fetch", label: "Fetching the article", status: fetch }]),
        `work-${id}`,
        reservation,
      ],
    );
    return { id, reservation };
  }

  const switchOn = (name: string) =>
    runAsOwner(OWNER, () => switchOnHighPower(OWNER, `${SLUG}${name}`, TIERS));

  async function upgradeSlots(): Promise<number[]> {
    const { rows } = await pool.query<{ slots: number }>(
      "select slots from spideryarn.ingest_events where owner_id = $1 and kind = 'high_power'",
      [OWNER],
    );
    return rows.map((r) => r.slots);
  }

  it("a job handed back to the queue with a priced 5-slot reservation charges 5", async () => {
    await givenPaid();
    await givenQueued("hp-handed-back", 5, "done");
    expect((await switchOn("hp-handed-back")).kind).toBe("on");
    expect(await upgradeSlots()).toEqual([5]);
  });

  it("a queued fresh job not yet fetched answers pending, and charges nothing", async () => {
    await givenPaid();
    await givenQueued("hp-queued-fresh", 1, "pending");
    expect((await switchOn("hp-queued-fresh")).kind).toBe("pending");
    expect(await upgradeSlots()).toEqual([]);
  });

  it("a retry's fresh job carrying the old weight charges that weight once its fetch is skipped", async () => {
    await givenPaid();
    await givenQueued("hp-retry", 3, "skipped");
    expect((await switchOn("hp-retry")).kind).toBe("on");
    expect(await upgradeSlots()).toEqual([3]);
  });
});

/* ------------------------------------------------------- sharing offer -- */

describe("the sharing offer answers the request's own cost", () => {
  it("names enough articles for a five-slot PDF, or none when that is not enough", async () => {
    /* Free, three slots: three private one-slot articles = 600. A five-slot
       PDF needs 1,000 + used ≤ 700 — sharing all three frees 300, still not
       enough, so a one-slot offer would be a false one. */
    for (const n of ["s1", "s2", "s3"]) await givenCharged(await givenArticle(n), 1);
    expect((await ingestEligibility(OWNER, NO_TIERS)).kind).toBe("refused");
    const reservation = await pool.query<{ id: string }>(
      `insert into spideryarn.ingest_events (owner_id) values ($1) returning id`,
      [OWNER],
    );
    const job = await givenRunningJob("share", reservation.rows[0]!.id);
    const refused = await price(job, 250);
    expect(refused.kind).toBe("refused");
    if (refused.kind === "refused") expect(refused.refusal.shareToMakeRoom).toBeUndefined();
  });

  it("names the long article first, because sharing it frees the most", async () => {
    await givenCharged(await givenArticle("a-small"), 1);
    await givenCharged(await givenArticle("z-long"), 2);
    /* 600 used. A one-slot import: sharing the 2-slot article frees 200 → admits. */
    const answer = await ingestEligibility(OWNER, NO_TIERS);
    expect(answer.kind).toBe("refused");
    if (answer.kind === "refused") expect(answer.shareToMakeRoom?.map((c) => c.title)).toEqual([`${SLUG}z-long`]);
  });
});

/* ------------------------------------------------------------ barriers -- */

type Settled<T> = { readonly ok: T } | { readonly err: unknown };
const settle = <T>(p: Promise<T>): Promise<Settled<T>> =>
  p.then(
    (ok) => ({ ok }),
    (err: unknown) => ({ err }),
  );

/**
 * **Two real writers held behind a third connection's row lock, then let go.**
 * tests/billing-settlement.test.ts § `racedOnJobRow`, for a lock on either the
 * job row or the billing row. Asserts neither answered while held — the part a
 * sequential test cannot do — and returns both outcomes without deciding the
 * winner, so the cases below assert invariants.
 */
async function raced<A, B>(
  lock: string,
  params: unknown[],
  first: () => Promise<A>,
  second: () => Promise<B>,
  /**
   * Which of the two must be waiting on the held row. Both, ordinarily. A
   * reprice on a claim whose lease has lapsed is **not**: its `for update`
   * carries `liveAttempt`, and a row outside the predicate is not waited on —
   * it is refused at once, which is the fence working (the same as
   * `beginPaidStep`).
   */
  blocks: readonly [boolean, boolean] = [true, true],
): Promise<[Settled<A>, Settled<B>]> {
  const holder = await pool.connect();
  let open = false;
  try {
    await holder.query("begin isolation level read committed");
    open = true;
    await holder.query(lock, params);
    const answered = [false, false];
    const a = settle(first()).then((r) => {
      answered[0] = true;
      return r;
    });
    const b = settle(second()).then((r) => {
      answered[1] = true;
      return r;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(answered, "a writer that should wait answered while the row was held").toEqual([
      !blocks[0],
      !blocks[1],
    ]);
    await holder.query("commit");
    open = false;
    return await Promise.all([a, b]);
  } finally {
    /* **Rolled back before it goes back to the pool**, or a failed case hands
       its row lock, still held, to whichever case draws this connection next —
       which is how one red case here once turned the next one red too. */
    if (open) await holder.query("rollback").catch(() => {});
    holder.release();
  }
}

const HOLD_JOB = "select 1 from spideryarn.jobs where id = $1 for update";
const HOLD_BILLING = "select 1 from spideryarn.billing_accounts where owner_id = $1 for update";

/**
 * Does another transaction already hold this row? `NOWAIT` makes the answer a
 * measurement rather than a timing guess: PostgreSQL's 55P03 is specifically
 * the requested lock being unavailable. Each failed statement gets its own
 * transaction because the error aborts it.
 */
async function rowIsLocked(query: string, params: unknown[]): Promise<boolean> {
  const probe = await pool.connect();
  try {
    await probe.query("begin isolation level read committed");
    try {
      await probe.query(query, params);
      await probe.query("rollback");
      return false;
    } catch (error) {
      await probe.query("rollback");
      if ((error as { code?: string }).code === "55P03") return true;
      throw error;
    }
  } finally {
    probe.release();
  }
}

async function becomesLocked(query: string, params: unknown[]): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await rowIsLocked(query, params)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

describe("High-powered AI against settlement takes the article before the job", () => {
  /**
   * Settlement locks article → job → reservation (`lockArticleFor` in
   * pg-session.ts). A High-powered switch on an article whose import is still
   * running reads that import's price, so it locks billing → article → job →
   * reservation. Taken job-first, the two would deadlock: the switch holding
   * the job and waiting for the article, settlement holding the article and
   * waiting for the job. This plays settlement's half by hand and asserts both
   * finish, with no 40P01 on either side.
   */
  it("finishes alongside a transaction that holds the article and then takes the job", async () => {
    const articleId = await givenArticle("hp-vs-settle");
    const reservation = await reserved();
    const job = await givenRunningJob("hp-vs-settle", reservation, [
      { name: "fetch", label: "Fetching the article", status: "running" },
    ]);
    await price(job, 50);
    await pool.query(
      `update spideryarn.jobs
          set steps = '[{"name":"fetch","label":"Fetching the article","status":"done"}]'::jsonb
        where id = $1`,
      [job.id],
    );

    const settlement = await pool.connect();
    let open = false;
    let settled: unknown = "not run";
    let switched: Promise<Settled<unknown>> | undefined;
    try {
      await settlement.query("begin isolation level read committed");
      open = true;
      await settlement.query("select 1 from spideryarn.articles where id = $1 for update", [articleId]);
      switched = settle(runAsOwner(OWNER, () => switchOnHighPower(OWNER, `${SLUG}hp-vs-settle`, NO_TIERS)));
      /* Long enough for the switch to take whatever it takes before the article. */
      await new Promise((resolve) => setTimeout(resolve, 300));
      try {
        await settlement.query("select 1 from spideryarn.jobs where id = $1 for update", [job.id]);
        await settlement.query("commit");
        open = false;
        settled = "ok";
      } catch (error) {
        settled = (error as { code?: string }).code ?? error;
      }
    } finally {
      if (open) await settlement.query("rollback").catch(() => {});
      settlement.release();
    }
    const answer = await switched;
    expect(settled, "settlement's half was chosen as a deadlock victim").toBe("ok");
    /* Drizzle wraps the driver's error, so the SQLSTATE (40P01 for a deadlock)
       is on its `cause`. */
    const failure = answer && "err" in answer ? (answer.err as { cause?: { code?: string } }) : null;
    expect(failure === null ? "ok" : (failure.cause?.code ?? String(failure)), "the switch was a deadlock victim").toBe(
      "ok",
    );
    expect(answer).toMatchObject({ ok: { kind: "on" } });
  });
});

describe("the reprice takes its nested locks in the declared order", () => {
  it("holds billing while it waits for the job", async () => {
    const reservation = await reserved();
    const job = await givenRunningJob("order-billing-job", reservation);
    const holder = await pool.connect();
    let open = false;
    let repriced: Promise<Settled<unknown>> | undefined;
    let billingLocked = false;
    try {
      await holder.query("begin isolation level read committed");
      open = true;
      await holder.query(HOLD_JOB, [job.id]);
      repriced = settle(price(job, 100));
      await new Promise((resolve) => setTimeout(resolve, 100));
      billingLocked = await becomesLocked(
        "select 1 from spideryarn.billing_accounts where owner_id = $1 for update nowait",
        [OWNER],
      );
      await holder.query("commit");
      open = false;
    } finally {
      if (open) await holder.query("rollback").catch(() => {});
      holder.release();
    }
    const answer = await repriced;
    expect(billingLocked, "reprice reached the job without first holding billing").toBe(true);
    expect(answer).toMatchObject({ ok: { kind: "priced", slots: 2 } });
  });

  it("holds the job while it waits for the reservation", async () => {
    const reservation = await reserved();
    /* Make repricing a no-op once it has read the row. Without the explicit
       reservation `FOR UPDATE`, there is no later UPDATE that would happen to
       block on our holder and make this test pass by accident. */
    await pool.query("update spideryarn.ingest_events set pages = 50 where id = $1", [reservation]);
    const job = await givenRunningJob("order-job-reservation", reservation);
    const holder = await pool.connect();
    let open = false;
    let repriced: Promise<Settled<unknown>> | undefined;
    let jobLocked = false;
    try {
      await holder.query("begin isolation level read committed");
      open = true;
      await holder.query("select 1 from spideryarn.ingest_events where id = $1 for update", [reservation]);
      repriced = settle(price(job, 50));
      await new Promise((resolve) => setTimeout(resolve, 100));
      jobLocked = await becomesLocked(
        "select 1 from spideryarn.jobs where id = $1 for update nowait",
        [job.id],
      );
      await holder.query("commit");
      open = false;
    } finally {
      if (open) await holder.query("rollback").catch(() => {});
      holder.release();
    }
    const answer = await repriced;
    expect(jobLocked, "reprice reached the reservation without first holding the job").toBe(true);
    expect(answer).toMatchObject({ ok: { kind: "priced", slots: 1 } });
  });
});

/**
 * After a reprice raced an ending: the job ended, and the reservation is
 * released at whatever weight the reprice left — never charged, never left in
 * flight, and the reprice either landed or was fenced out.
 */
async function expectEndedAndReleased(
  jobId: string,
  reservation: string,
  repriced: Settled<unknown>,
): Promise<void> {
  const { rows } = await pool.query<{ status: string }>("select status from spideryarn.jobs where id = $1", [jobId]);
  expect(rows[0]?.status).not.toBe("running");
  const after = await row(reservation);
  expect(after).toMatchObject({ succeeded: false, released: true });
  if ("err" in repriced) expect(repriced.err).toBeInstanceOf(StaleAttemptError);
  else expect([1, 3]).toContain(after.slots);
}

describe("a reprice against every other writer finishes without deadlock", () => {
  it("against Stop on a job no claimant is inside (terminal)", async () => {
    await pool.query(
      `insert into spideryarn.billing_accounts (owner_id) values ($1) on conflict do nothing`,
      [OWNER],
    );
    const reservation = await reserved();
    const job = await givenRunningJob("stop", reservation);
    /* A claimant provably gone: the lease has lapsed, so Stop ends the job. */
    await pool.query("update spideryarn.jobs set lease_expires_at = now() - interval '1 minute' where id = $1", [job.id]);
    const [repriced, stopped] = await raced(
      HOLD_JOB,
      [job.id],
      () => price(job, 150),
      () => pgJobStore.requestCancel(job.id, OWNER),
      /* The lease has lapsed, so the reprice is refused at once rather than waiting. */
      [false, true],
    );
    expect("ok" in stopped).toBe(true);
    /* The lease had lapsed, so the fence refuses the reprice whichever went first. */
    expect("err" in repriced && repriced.err instanceof StaleAttemptError).toBe(true);
    await expectEndedAndReleased(job.id, reservation, repriced);
  });

  it("against Stop on a live claim (non-terminal): the reprice lands, the job is cancelling", async () => {
    const reservation = await reserved();
    const job = await givenRunningJob("stop-live", reservation);
    const [repriced, stopped] = await raced(
      HOLD_JOB,
      [job.id],
      () => price(job, 150),
      () => pgJobStore.requestCancel(job.id, OWNER),
    );
    expect("ok" in stopped).toBe(true);
    expect(repriced).toMatchObject({ ok: { kind: "priced", slots: 3 } });
    expect(await row(reservation)).toMatchObject({ slots: 3, succeeded: false, released: false });
  });

  it("against the store's own ending", async () => {
    const reservation = await reserved();
    const job = await givenRunningJob("finish", reservation);
    const [repriced, finished] = await raced(
      HOLD_JOB,
      [job.id],
      () => price(job, 150),
      () => pgJobStore.finish(job.id, job.attempt, { status: "error", steps: [], error: "a test ending" }),
    );
    expect("ok" in finished).toBe(true);
    await expectEndedAndReleased(job.id, reservation, repriced);
  });

  it("against expiry, terminal and requeue", async () => {
    for (const budget of [0, 2]) {
      await clear();
      const reservation = await reserved();
      const job = await givenRunningJob(`expire-${budget}`, reservation);
      await pool.query("update spideryarn.jobs set lease_expires_at = now() - interval '1 minute' where id = $1", [job.id]);
      const [repriced, swept] = await raced(
        HOLD_JOB,
        [job.id],
        () => price(job, 150),
        () => pgJobStore.settleExpired(undefined, OWNER, budget),
        [false, true],
      );
      expect("ok" in swept).toBe(true);
      /* A lapsed lease is outside the fence either way. */
      expect("err" in repriced && repriced.err instanceof StaleAttemptError).toBe(true);
      const after = await row(reservation);
      expect(after.slots).toBe(1);
      expect(after.succeeded).toBe(false);
      /* Requeued keeps the reservation in flight; terminal releases it. */
      expect(after.released).toBe(budget === 0);
    }
  });

  it("against a voucher revocation, both behind the billing row", async () => {
    /* A gift of 2 makes a free account 5 slots (1,000 points): a 200-page PDF
       (4 slots) fits with it and not without it. Whichever of the two takes the
       billing row first decides — and the other must see what it committed. */
    await pool.query(`insert into spideryarn.billing_accounts (owner_id) values ($1) on conflict do nothing`, [OWNER]);
    const { rows } = await pool.query<{ id: string }>(
      `insert into spideryarn.billing_vouchers (email, articles, created_by, claimed_by, claimed_at)
       values ($1, 2, $2, $2, now()) returning id`,
      [`long-pdf-${OWNER}@spideryarn.local`, OWNER],
    );
    const voucher = rows[0]!.id;
    const reservation = await reserved();
    const job = await givenRunningJob("voucher", reservation);
    const [repriced, revoked] = await raced(
      HOLD_BILLING,
      [OWNER],
      () => price(job, 200),
      () => updateVoucher(voucher, { revoked: true }),
    );
    expect("ok" in revoked, "the revocation failed").toBe(true);
    const answer = "ok" in repriced ? repriced.ok : undefined;
    expect(answer?.kind === "priced" || answer?.kind === "refused").toBe(true);
    expect((await row(reservation)).slots).toBe(answer?.kind === "priced" ? 4 : 1);
  });

  it("against a visibility change, both behind the billing row", async () => {
    const articleId = await givenArticle("vis");
    await givenCharged(articleId, 1);
    await pool.query(`insert into spideryarn.billing_accounts (owner_id) values ($1) on conflict do nothing`, [OWNER]);
    const reservation = await reserved();
    const job = await givenRunningJob("vis-job", reservation);
    const [repriced, shared] = await raced(
      HOLD_BILLING,
      [OWNER],
      () => price(job, 100),
      () => runAsOwner(OWNER, () => pgVisibilityStore.set(`${SLUG}vis`, "public", true)),
    );
    expect("ok" in shared).toBe(true);
    /* 1 charged (200, or 100 once public) + this job at 2 slots: fits either way. */
    expect(repriced).toMatchObject({ ok: { kind: "priced", slots: 2 } });
    expect((await row(reservation)).slots).toBe(2);
  });
});
