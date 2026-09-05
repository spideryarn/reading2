/**
 * **The wall, through the routes that add an article.**
 *
 * The ledger has been testable on its own since 2026-09-02
 * (tests/billing-quota-race.test.ts) and settlement since 2026-09-03
 * (tests/billing-settlement.test.ts). What neither can see is the half this file
 * is about: **which requests spend a slot**. That is a property of `POST
 * /api/jobs` and `POST /api/jobs/:id/retry`, not of `reserveIngest`, and the two
 * mistakes it is possible to make there are opposite and both silent —
 *
 * - **charging a re-run.** Asking for a glossary on an article already on the
 *   shelf goes through `enqueue()` exactly as a paste does, and by then a
 *   re-run's job carries a URL too. A gate inside `enqueue` would bill the
 *   reader for pressing a mode button, and every quota test would still pass.
 * - **not charging a retry.** `POST /api/jobs/:id/retry` never passes through
 *   the `POST /api/jobs` handler — it goes straight to `retryJob` → `enqueue`.
 *   A check bolted onto the main handler alone leaves a failed ingest retryable
 *   free, for ever.
 *
 * So the assertions here are mostly *counts of `ingest_events`* around a real
 * request, which is the only way to tell a route that reserved from one that
 * did not.
 *
 * ## The release paths
 *
 * `reserveIngest` commits and returns; the lock is not held across `enqueue()`.
 * Between the two there is a window, and everything that leaves it without a job
 * has to give the slot back — a second paste that deduplicates onto the job
 * already running, an upload that turned out to be an article months ago, a
 * throw. `withIngestSlot` releases unconditionally and lets
 * `releaseReservation`'s `not exists (select 1 from jobs …)` decide, so the case
 * that matters is *"a slot a job really did take is not given back"*, which the
 * ordinary admission cases below assert every time they count.
 *
 * ## Watched red
 *
 * 2026-09-03, one mutation at a time, `REQUIRE_POSTGRES=1 npx vitest run
 * tests/billing-admission.test.ts` — see the report in the plan. The counts here
 * are all 0-or-1 differences, so each mutation reddens a small, named set.
 *
 * Skips loudly when there is no database (tests/helpers/pg-ready.ts). Check a
 * change with `REQUIRE_POSTGRES=1` and read the **count**: a skip looks exactly
 * like a pass, which is how tests/billing-quota-race.test.ts reported "13
 * skipped" against a live database for hours.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import type { Verifier } from "../src/auth.js";
import { withIngestSlot, refuseUploadWithoutQuota } from "../src/billing/admission.js";
import { loadEnvLocal } from "../src/env.js";
import type { OwnerId } from "../src/owner.js";
import { forgetCachedTiers } from "../src/store/pg-tiers.js";
import { mintUpload } from "../src/upload-records.js";
import { blobStore, CONTENT_TYPE } from "../src/store/blobs.js";
import { stagingKey } from "../src/source.js";
import { pgReady } from "./helpers/pg-ready.js";
import { bareArticles } from "./helpers/bare-article.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

const { handleApi } = await import("../src/routes.js");


loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/billing-admission.test.ts",
  tables: [
    "spideryarn.jobs",
    "spideryarn.uploads",
    "spideryarn.ingest_events",
    "spideryarn.billing_accounts",
  ],
  keepPool: true,
  max: 4,
});

/**
 * This file's own reader, minted per run.
 *
 * **Not `TEST_SUB`**, which is the shared dev identity half the route suites
 * authenticate as: the free allowance is *three lifetime ingests*, so a peer
 * suite adding one article as that person would make the fourth case here refuse
 * a request that should have been admitted. A private owner and a private
 * verifier make this file's count its own. The stem is fixed so a run killed
 * halfway leaves rubble that the next run's sweep can match.
 */
const OWNER_STEM = "000000ad-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;

/** Every article this file makes is named from a URL under here. */
const HOST = "https://admission.test.invalid";
const SLUG_RUBBLE = "test-admission-%";

/**
 * A tier this file sells and nobody else does — see `sellATier`.
 *
 * `stale` is only reachable through a subscription on a price some tier sells:
 * `entitlementFromRow` falls to **free** for an unrecognised price *before* it
 * looks at the period, which is the right order and makes a fixture that names
 * a made-up price answer `admitted` rather than `stale`.
 */
const TIER_ID = "test-admission-tier";
const TIER_PRICE = "price_test_admission_only";

/** Says yes, as this file's owner. See `acceptAny` in tests/helpers/authed.ts. */
const asOwner: Verifier = async () => ({
  ok: true,
  claims: { sub: OWNER, email: `admission-${OWNER}@example.invalid`, role: "authenticated" },
});

const HEADERS = { authorization: "Bearer test-token" };

/** The free tier, since no tier is entitled without a `billing_accounts` row. */
const FREE_LIMIT = 3;

/**
 * The seeded local administrator — one of the two uuids `isAdmin` compares
 * against, imported rather than written out (tests/helpers/authed.ts § the same
 * rule, and the four copies it was written out in until 2026-08-28).
 */
const ADMIN = ADMIN_USER_ID_LOCAL as OwnerId;

let vercel: string | undefined;

beforeAll(async () => {
  if (!pool) return;
  /**
   * **`VERCEL`, so `enqueue` does not start driving what it queues.** `pump`
   * returns immediately when it is set (src/jobs.ts). Every case here creates
   * real jobs, and a pump would run the pipeline against `example.invalid` —
   * and, worse for the assertions, would *settle* the reservations being
   * counted. Read at call time rather than at import, so this is not hoisted.
   */
  vercel = process.env.VERCEL;
  process.env.VERCEL = "1";
  await sweep();
  await seedAuthUser(pool, { id: OWNER, email: `admission-${OWNER}@example.invalid` });
});

afterEach(sweep);

/**
 * **The two articles the re-run cases name**, seeded per case rather than once —
 * added 2026-09-05.
 *
 * `enqueue` refuses a bare-slug request for an article the reader does not have
 * (src/jobs.ts), and *"a re-run on an article already on the shelf"* is the whole
 * premise of those two cases: they were the only ones in the file asserting it
 * against an article that was not on any shelf. Per case because `sweep` runs in
 * `afterEach` and takes the row with it — see the `articles` line there.
 *
 * `OWNER`, because that is who the requests below authenticate as and
 * `articleExists` is owner-scoped. ./helpers/bare-article.ts.
 */
const onTheShelf = (slug: string) => bareArticles([slug], OWNER);

afterAll(async () => {
  if (vercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = vercel;
  if (!pool) return;
  await sweep();
  await pool.query("delete from auth.users where id::text like $1", [RUBBLE]).catch(() => {});
  await pool.end();
});

/**
 * Staging objects written by `anUploadReadyToQueue`, removed with the rows.
 *
 * A list of this file's own keys rather than a prefix scan of the bucket:
 * vitest runs test files in parallel against one Storage, and "everything under
 * `staging/`" would take another suite's object out from under it mid-run —
 * the trap `tests/uploads-api.test.ts` documents for upload records.
 */
const staged: string[] = [];

/** Jobs before ingest events: `jobs_ingest_event_fk` points that way. */
async function sweep(): Promise<void> {
  for (const key of staged.splice(0)) await blobStore().remove(key);
  if (!pool) return;
  await pool.query("delete from spideryarn.jobs where owner_id::text like $1", [RUBBLE]);
  await pool.query("delete from spideryarn.jobs where slug like $1", [SLUG_RUBBLE]);
  /* After the jobs, because a job row's `draft_revision_id` is a foreign key into
     a revision the article delete would be cascading away. Added with
     `onTheShelf` below. */
  await pool.query("delete from spideryarn.articles where slug like $1", [SLUG_RUBBLE]);
  await pool.query("delete from spideryarn.uploads where owner_id::text like $1", [RUBBLE]);
  await pool.query("delete from spideryarn.ingest_events where owner_id::text like $1", [RUBBLE]);
  await pool.query("delete from spideryarn.billing_accounts where owner_id::text like $1", [RUBBLE]);
  await pool.query("delete from spideryarn.billing_tiers where id = $1", [TIER_ID]);
  forgetCachedTiers();
}

/**
 * Sell one tier, on a price this file's fixture subscription is on.
 *
 * **`active = false`**, which is the whole reason this is safe to do to a table
 * other suites read: `tierForPrice` deliberately still matches an inactive tier,
 * so entitlement works, while `tests/billing-tiers.test.ts` — which asserts over
 * the **real rows** — filters to active ones and cannot see it. It carries no
 * `billing_tier_prices` rows for the same reason: nothing here is about what a
 * tier costs.
 *
 * `forgetCachedTiers`, because `allTiers()` holds the table for thirty seconds
 * and `reserveIngest` reads it through that cache.
 */
async function sellATier(): Promise<void> {
  if (!pool) return;
  await pool.query(
    `insert into spideryarn.billing_tiers
       (id, product_name, description, ingests_per_period, lookup_key, stripe_price_id,
        livemode, active, sort_order)
     values ($1, 'An admission fixture', 'Sold only by tests/billing-admission.test.ts.',
             20, $2, $3, false, false, 900)
     on conflict (id) do nothing`,
    [TIER_ID, `${TIER_ID}_monthly`, TIER_PRICE],
  );
  forgetCachedTiers();
}

/* ------------------------------------------------------------- the harness -- */

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

/** Drive `handleApi` with a fake request/response pair, as this file's owner. */
async function post(url: string, body: unknown): Promise<Reply> {
  const payload = Buffer.from(JSON.stringify(body));
  const req = Object.assign(
    (async function* () {
      yield payload;
    })(),
    { method: "POST", url, headers: HEADERS },
  ) as unknown as IncomingMessage;

  let status = 0;
  let text = "";
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader() {},
    end(chunk: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, asOwner);
  return { status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

/** Add an article by address — the ordinary new ingest. */
const add = (name: string) => post("/api/jobs", { url: `${HOST}/${name}` });

/** What the ledger holds for an owner: taken, and of those, still unsettled. */
async function ledgerFor(owner: string): Promise<{ taken: number; inFlight: number }> {
  if (!pool) return { taken: 0, inFlight: 0 };
  const { rows } = await pool.query<{ taken: string; in_flight: string }>(
    `select count(*) as taken,
            count(*) filter (where succeeded_at is null and released_at is null) as in_flight
       from spideryarn.ingest_events where owner_id = $1`,
    [owner],
  );
  return { taken: Number(rows[0]?.taken), inFlight: Number(rows[0]?.in_flight) };
}

/** This file's own owner, which is what almost every case counts. */
const ledger = () => ledgerFor(OWNER);

/** The provenance column, which is the only place "this job spent a slot" is written. */
async function slotOf(jobId: string): Promise<string | null> {
  if (!pool) return null;
  const { rows } = await pool.query<{ ingest_event_id: string | null }>(
    "select ingest_event_id from spideryarn.jobs where id = $1",
    [jobId],
  );
  if (rows.length !== 1) throw new Error(`no job row for ${jobId}`);
  return rows[0]?.ingest_event_id ?? null;
}

/** Make a job retryable: `retryJob` takes only one that failed. */
async function fail(jobId: string): Promise<void> {
  if (!pool) return;
  await pool.query("update spideryarn.jobs set status = 'error' where id = $1", [jobId]);
}

/**
 * A subscriber in the database, the way the webhook would write one.
 *
 * The default `priceId` is one no tier sells, which falls to the **free**
 * entitlement — right for the lapsed case, whose status is not entitled anyway,
 * and where pinning a real tier's price would tie the fixture to `billing_tiers`
 * rows a peer suite may edit. The stale cases pass `TIER_PRICE`.
 */
async function subscribed(fields: {
  status: string;
  periodStart: Date;
  periodEnd: Date;
  priceId?: string;
  /** What a Portal cancellation writes, leaving `cancel_at_period_end` false. */
  cancelAt?: Date | null;
}): Promise<void> {
  if (!pool) return;
  await pool.query(
    `insert into spideryarn.billing_accounts
       (owner_id, stripe_customer_id, stripe_subscription_id, price_id, status,
        current_period_start, current_period_end, cancel_at)
     values ($1, $2, $3, $7, $4, $5, $6, $8)
     on conflict (owner_id) do update set
       stripe_customer_id = excluded.stripe_customer_id,
       stripe_subscription_id = excluded.stripe_subscription_id,
       price_id = excluded.price_id,
       status = excluded.status,
       current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end,
       cancel_at = excluded.cancel_at`,
    [
      OWNER,
      `cus_${OWNER}`,
      `sub_${OWNER}`,
      fields.status,
      fields.periodStart,
      fields.periodEnd,
      fields.priceId ?? "price_no_tier_sells",
      fields.cancelAt ?? null,
    ],
  );
}

/** Successful ingests already spent, without running anything. */
async function alreadySpent(n: number, owner: string = OWNER): Promise<string[]> {
  if (!pool) return [];
  /* The ids come back so that a case spending on behalf of somebody who is not
     this file's own owner can delete **exactly what it inserted** — see the
     admin case, which writes against a shared local identity and must not sweep
     by owner the way everything else here does. */
  const { rows } = await pool.query<{ id: string }>(
    `insert into spideryarn.ingest_events (owner_id, reserved_at, succeeded_at)
     select $1, now(), now() from generate_series(1, $2)
     returning id`,
    [owner, n],
  );
  return rows.map((r) => r.id);
}

/** Take back exactly the rows a case inserted, by id. */
async function forgetSpend(ids: string[]): Promise<void> {
  if (!pool || ids.length === 0) return;
  await pool.query("delete from spideryarn.ingest_events where id = any($1::uuid[])", [ids]);
}

/* ------------------------------------------------- what spends, and what not -- */

describe("adding an article spends a slot", () => {
  it("admits a free account three times and refuses the fourth", async () => {
    for (let i = 1; i <= FREE_LIMIT; i++) {
      const reply = await add(`one-${i}`);
      expect(reply.status, JSON.stringify(reply.body)).toBe(202);
      /* The link that makes the slot spent: written in the job's own INSERT. */
      expect(await slotOf(reply.body.id as string)).not.toBeNull();
    }
    expect(await ledger()).toEqual({ taken: FREE_LIMIT, inFlight: FREE_LIMIT });

    const refused = await add("one-4");
    expect(refused.status).toBe(402);
    expect(refused.body.error).toContain("[pay-free]");
    /* And the refusal took nothing on its way past. */
    expect(await ledger()).toEqual({ taken: FREE_LIMIT, inFlight: FREE_LIMIT });
  });

  /**
   * **The mistake that would bill somebody for pressing a mode button.**
   * `{slug, steps}` is a re-run on an article already on the shelf, and it stays
   * free even when the account has nothing left — because there is nothing new
   * to pay for. docs/project/billing.md.
   */
  it("never reserves for a step re-run, even at the ceiling", async () => {
    await onTheShelf("test-admission-rerun");
    await alreadySpent(FREE_LIMIT);
    const reply = await post("/api/jobs", {
      slug: "test-admission-rerun",
      steps: ["ideas"],
      useProfile: false,
    });
    expect(reply.status, JSON.stringify(reply.body)).toBe(202);
    expect(await slotOf(reply.body.id as string)).toBeNull();
    expect(await ledger()).toEqual({ taken: FREE_LIMIT, inFlight: 0 });
  });

  /**
   * A double-clicked Add. The second request reserves, `enqueueOrGet` answers
   * `sameWork` and hands back the job the first one made, and the slot the
   * second took has to come back — otherwise two clicks cost two of three.
   */
  it("gives the slot back when a second paste deduplicates onto the first job", async () => {
    const first = await add("dedup");
    const second = await add("dedup");
    expect(first.status).toBe(202);
    expect(second.body.id).toBe(first.body.id);
    expect(await ledger()).toEqual({ taken: 2, inFlight: 1 });
    /* And the one still in flight is the one the job is spending. */
    expect(await slotOf(first.body.id as string)).not.toBeNull();
  });

  it("reserves for an upload, which is the other kind of new ingest", async () => {
    const uploadId = await anUploadReadyToQueue("test-admission-paper.pdf");

    const reply = await post("/api/jobs", { uploadId });
    expect(reply.status, JSON.stringify(reply.body)).toBe(202);
    expect(await slotOf(reply.body.id as string)).not.toBeNull();
    expect(await ledger()).toEqual({ taken: 1, inFlight: 1 });
  });

  /**
   * **A reload of `/add/upload/<id>` must not be told it has run out.**
   *
   * `withIngestSlot` wraps `queueAnUpload`, and `admitIngest` throws 402
   * **before** the callback runs. So until 2026-09-03 the second request for an
   * upload that already had a job asked for a slot it was never going to spend —
   * and a reader on their last one was refused for having no allowance, when the
   * true answer was the ingest their first request had already made. The refusal
   * was about a slot nobody needed. GPT Sol, reviewing the plan for the
   * background upload (finding 2).
   *
   * It matters far more now than it did: the reader reaches that address at byte
   * zero, so reloading it, and opening it in a second tab, are ordinary.
   *
   * **The count is the assertion**, not the status. A route that resolved the
   * repeat correctly and still reserved would answer 202 here and look perfect,
   * while quietly taking a slot per reload out of a lifetime allowance of three.
   * `ledger()` is the only thing that can see it.
   *
   * Watched red 2026-09-03 by deleting `resolveExistingUpload` from the route,
   * so the repeat falls through to `withIngestSlot` as it used to: *"the reload
   * spent a slot of its own: expected { taken: 2, inFlight: 1 } to deeply equal
   * { taken: 1, inFlight: 1 }"*. Note `inFlight` **1**, not 2 — the second
   * reservation is released, because `releaseReservation` finds no job holding
   * it. That is precisely why `taken` is the number to assert on: the release
   * makes the leak invisible to every count but the lifetime one, which is the
   * count a free reader has three of.
   */
  it("resolves a repeat claim without taking a second slot", async () => {
    const uploadId = await anUploadReadyToQueue("test-admission-reloaded.pdf");

    const first = await post("/api/jobs", { uploadId });
    expect(first.status, JSON.stringify(first.body)).toBe(202);
    expect(await ledger()).toEqual({ taken: 1, inFlight: 1 });

    const again = await post("/api/jobs", { uploadId });
    expect(again.status, JSON.stringify(again.body)).toBe(202);
    expect(again.body.id, "the reload was handed a different job").toBe(first.body.id);
    expect(await ledger(), "the reload spent a slot of its own").toEqual({
      taken: 1,
      inFlight: 1,
    });
  });
});

/**
 * An upload whose bytes have landed, which is the only kind that may be queued.
 *
 * Two halves, and the second is new on 2026-09-03: `mintUpload` writes the
 * record, and then the staging object has to be **there**, because
 * `POST /api/jobs { uploadId }` HEADs it before it claims anything. Without the
 * object the route answers 409 *still arriving* and reserves nothing, so every
 * count below would be zero and the suite would report a wall that was never
 * reached. See `tests/an-upload-is-queued-only-once-its-bytes-arrive.test.ts`
 * for what that gate is for.
 *
 * The grant issuer is a stub — nothing here PUTs through a signed URL — but the
 * object is real, written with the service key at the key the route will look
 * under. `stagingKey` on both sides rather than a literal, so the two cannot
 * drift.
 */
async function anUploadReadyToQueue(filename: string): Promise<string> {
  const minted = await mintUpload(
    { filename, bytes: 1024, sha256: "a".repeat(64), owner: OWNER },
    async () => ({
      url: "https://storage.invalid/staging",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }),
    stagingKey,
  );
  const key = stagingKey(minted.record.id);
  await blobStore().putIfAbsent(
    key,
    new TextEncoder().encode("%PDF-1.4\ntrailer\n<<>>\n%%EOF\n"),
    CONTENT_TYPE.pdf,
  );
  staged.push(key);
  return minted.record.id;
}

describe("retry is the second front door", () => {
  /**
   * The failed attempt's slot was released when it failed, so the retry mints a
   * fresh one — no lineage, and no reactivating a released row. Here the first
   * attempt is failed by hand *without* settling, so both are in flight; what
   * matters is that the retry took **a** slot and a different one.
   */
  it("reserves again when the attempt it repeats carried a slot", async () => {
    const first = await add("retry-paid");
    const before = await slotOf(first.body.id as string);
    await fail(first.body.id as string);

    const again = await post(`/api/jobs/${first.body.id}/retry`, {});
    expect(again.status, JSON.stringify(again.body)).toBe(202);
    expect(again.body.id).not.toBe(first.body.id);

    const after = await slotOf(again.body.id as string);
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(await ledger()).toEqual({ taken: 2, inFlight: 2 });
  });

  /** A re-run that failed is still a re-run. `Job.url` could not have said so. */
  it("reserves nothing when the attempt it repeats carried none", async () => {
    await onTheShelf("test-admission-rerun-retry");
    const first = await post("/api/jobs", {
      slug: "test-admission-rerun-retry",
      steps: ["ideas"],
      useProfile: false,
    });
    await fail(first.body.id as string);

    const again = await post(`/api/jobs/${first.body.id}/retry`, {});
    expect(again.status, JSON.stringify(again.body)).toBe(202);
    expect(await slotOf(again.body.id as string)).toBeNull();
    expect(await ledger()).toEqual({ taken: 0, inFlight: 0 });
  });

  it("refuses a retry the account has no room for", async () => {
    const first = await add("retry-blocked");
    await fail(first.body.id as string);
    /* Two more successes, and the failed attempt's own reservation, is three. */
    await alreadySpent(2);

    const again = await post(`/api/jobs/${first.body.id}/retry`, {});
    expect(again.status).toBe(402);
    expect(again.body.error).toContain("[pay-free]");
  });
});

/**
 * **The pin.** A cancellation is a fact about the *future*; entitlement is a
 * fact about now, and the two must not be confused.
 *
 * `cancel_at` landed on `billing_accounts` on 2026-09-03 so that `/profile`
 * could finally say *your plan ends on the 3rd* — a real cancellation had gone
 * untold (docs/project/billing.md § *The first live sale*). The whole risk of
 * that change is in this direction: a version that treated a scheduled ending
 * as an ending would take a paid-up reader's allowance away weeks early, and it
 * would do it to somebody who has paid us. `entitlementFromRow` reads the
 * status and the period and nothing else, and this is what says so from the
 * outside — through the wall, not through the function.
 */
describe("a cancellation that has not happened yet takes nothing away", () => {
  /* Past the free three, so a fall back to the free tier would refuse and this
     case cannot pass on the free allowance by accident. */
  const SPENT = FREE_LIMIT + 1;

  /** Subscribed, paid up, and scheduled to end when the period does. */
  async function cancelledButPaidUp(fields: {
    cancelAt?: Date | null;
    cancelAtPeriodEnd?: boolean;
  }): Promise<Date> {
    await sellATier();
    const end = new Date(Date.now() + 25 * 86_400_000);
    await subscribed({
      status: "active",
      priceId: TIER_PRICE,
      periodStart: new Date(Date.now() - 5 * 86_400_000),
      periodEnd: end,
      cancelAt: fields.cancelAt ?? null,
    });
    if (fields.cancelAtPeriodEnd && pool) {
      await pool.query(
        "update spideryarn.billing_accounts set cancel_at_period_end = true where owner_id = $1",
        [OWNER],
      );
    }
    return end;
  }

  it("still admits a reader who cancelled through the Portal", async () => {
    /* The live shape exactly: a `cancel_at` timestamp with the boolean false. */
    const end = await cancelledButPaidUp({ cancelAt: new Date(Date.now() + 25 * 86_400_000) });
    expect(end.getTime()).toBeGreaterThan(Date.now());
    const spent = await alreadySpent(SPENT);
    try {
      const reply = await add("cancelled-but-paid-up");
      expect(reply.status, JSON.stringify(reply.body)).toBe(202);
      /* And it really took a paid slot rather than slipping past unmetered. */
      expect(await slotOf(reply.body.id as string)).not.toBeNull();
    } finally {
      await forgetSpend(spent);
    }
  });

  it("still admits a reader who cancelled through the API", async () => {
    /* The other shape, so neither field can be the one that ends somebody
       early. */
    await cancelledButPaidUp({ cancelAtPeriodEnd: true });
    const spent = await alreadySpent(SPENT);
    try {
      const reply = await add("cancelled-via-api");
      expect(reply.status, JSON.stringify(reply.body)).toBe(202);
    } finally {
      await forgetSpend(spent);
    }
  });

  /**
   * The mirror, so the two above cannot pass by admitting everybody: once the
   * period really is over, a `canceled` subscription is lapsed and refused.
   * That is the boundary the pin is protecting — it moves at the period end and
   * not a day before.
   */
  it("refuses once the period it was paid for is actually over", async () => {
    await sellATier();
    await subscribed({
      status: "canceled",
      priceId: TIER_PRICE,
      periodStart: new Date(Date.now() - 60 * 86_400_000),
      periodEnd: new Date(Date.now() - 30 * 86_400_000),
      cancelAt: new Date(Date.now() - 30 * 86_400_000),
    });
    const spent = await alreadySpent(SPENT);
    try {
      const refused = await add("cancelled-and-over");
      expect(refused.status).toBe(402);
      expect(refused.body.error).toContain("[pay-lapsed]");
    } finally {
      await forgetSpend(spent);
    }
  });
});

describe("what a refused reader is told", () => {
  /**
   * **The lapsed subscriber, and the sentence that must not be "40 of 3 used".**
   * The free count is lifetime and includes paid months (Greg, 2026-09-03), so
   * this account is past the free allowance permanently and that is the policy —
   * but the copy has to name the ended plan rather than a number that reads as
   * arithmetic going wrong.
   */
  it("says the plan has ended, rather than counting past a limit", async () => {
    await subscribed({
      status: "canceled",
      periodStart: new Date(Date.now() - 60 * 24 * 3600 * 1000),
      periodEnd: new Date(Date.now() - 30 * 24 * 3600 * 1000),
    });
    await alreadySpent(40);

    const refused = await add("lapsed");
    expect(refused.status).toBe(402);
    expect(refused.body.error).toContain("[pay-lapsed]");
    expect(refused.body.error).toContain("subscription has ended");
    /* The number that would have read as a bug. */
    expect(refused.body.error).not.toContain("40");
  });
});

describe("a stored period that has run out", () => {
  /** Entitled, on a price we sell, and the window closed a month ago. */
  async function makeStale(): Promise<void> {
    await sellATier();
    await subscribed({
      status: "active",
      priceId: TIER_PRICE,
      periodStart: new Date(Date.now() - 60 * 24 * 3600 * 1000),
      periodEnd: new Date(Date.now() - 30 * 24 * 3600 * 1000),
    });
  }

  /** What a real sync would have written: a period that contains now. */
  async function fixThePeriod(): Promise<void> {
    if (!pool) return;
    await pool.query(
      `update spideryarn.billing_accounts
          set current_period_start = now() - interval '5 days',
              current_period_end = now() + interval '25 days'
        where owner_id = $1`,
      [OWNER],
    );
  }

  it("resyncs from Stripe once and then admits", async () => {
    await makeStale();
    const asked: string[] = [];
    const slot = await withIngestSlot(
      { ownerId: OWNER },
      async (s) => s,
      {
        sync: async (customerId) => {
          asked.push(customerId);
          await fixThePeriod();
        },
      },
    );
    /* Keyed on the **customer**, which is what `syncSubscriptionFromStripe` takes. */
    expect(asked).toEqual([`cus_${OWNER}`]);
    expect(slot.ingestEventId).toBeTruthy();
    /* Reserved once, and released again because nothing enqueued a job. */
    expect(await ledger()).toEqual({ taken: 1, inFlight: 0 });
  });

  it("fails closed with 503 when Stripe cannot be reached", async () => {
    await makeStale();
    await expect(
      withIngestSlot({ ownerId: OWNER }, async (s) => s, {
        sync: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      }),
    ).rejects.toMatchObject({ status: 503, message: expect.stringContaining("[pay-off]") });
    expect(await ledger()).toEqual({ taken: 0, inFlight: 0 });
  });

  /**
   * The resync ran and the row still does not contain now. **Not asked twice**,
   * and not guessed at in either direction: the free limit would falsely block
   * somebody who has paid, and the paid limit against a closed window is an
   * uncapped month.
   */
  it("fails closed with 503 when the resync changed nothing", async () => {
    await makeStale();
    let calls = 0;
    await expect(
      withIngestSlot({ ownerId: OWNER }, async (s) => s, {
        sync: async () => {
          calls++;
        },
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(calls).toBe(1);
  });
});

describe("the administrator is exempt", () => {
  /**
   * **Not "reserved then forgiven" — nothing is reserved at all.** So an admin's
   * job carries a null `ingest_event_id`, settlement no-ops on it exactly as it
   * does for a step re-run, and the ledger has no row that would have to be
   * explained. Without this Greg is held to three lifetime articles on his own
   * production instance; comp subscriptions, which will eventually cover it, are
   * a post-go-live stage.
   *
   * `isAdmin` is a comparison against two hardcoded uuids (src/admin.ts), which
   * is what makes an exemption safe to write here at all — there is no variable
   * and no claim that puts anybody else in the list.
   */
  it("admits an admin owner past the free limit, and writes no ledger row", async () => {
    /* **Cleaned up by id, not by owner.** This is the shared local dev-admin
       identity — every route suite in the repo authenticates as it — so a sweep
       keyed on the owner would delete rows this file did not write. */
    const spent = await alreadySpent(FREE_LIMIT + 5, ADMIN);
    try {
      /* Read rather than assumed to be `spent.length`: this identity may have
         rows from somebody's local use, and the assertion is that admission
         **added none**, not that the ledger was empty to begin with. */
      const before = await ledgerFor(ADMIN);
      const slot = await withIngestSlot(
        { ownerId: ADMIN, slug: "test-admission-admin" },
        async (s) => s,
      );
      /* Empty, not "a slot that was forgiven": the job carries a null
         `ingest_event_id` and settlement no-ops on it. */
      expect(slot).toEqual({});
      expect(await ledgerFor(ADMIN)).toEqual(before);

      await expect(refuseUploadWithoutQuota(ADMIN)).resolves.toBeUndefined();
    } finally {
      await forgetSpend(spent);
    }
  });
});

describe("the door tells an upload there is no point", () => {
  it("refuses an upload from an account with nothing left, without reserving", async () => {
    await alreadySpent(FREE_LIMIT);
    await expect(refuseUploadWithoutQuota(OWNER)).rejects.toMatchObject({
      status: 402,
      message: expect.stringContaining("[pay-free]"),
    });
    /* Asks, and takes nothing — the gate is `POST /api/jobs`. */
    expect(await ledger()).toEqual({ taken: FREE_LIMIT, inFlight: 0 });
  });

  it("says nothing at all when there is room", async () => {
    await expect(refuseUploadWithoutQuota(OWNER)).resolves.toBeUndefined();
    expect(await ledger()).toEqual({ taken: 0, inFlight: 0 });
  });
});
