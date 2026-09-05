/**
 * **The limiter: how many outbound fetches one reader's pointer may cause.**
 *
 * The first inbound rate limit in this codebase — the ingest quota is a billing
 * allowance and `src/dictation-limits.ts` bounds one upload — so there was
 * nothing to reuse and nothing already under test. Four claims:
 *
 * 1. **It is a cap.** The (n+1)th fill inside the window is refused.
 * 2. **It is keyed on the owner and nothing else.** A second reader's fills do
 *    not count against the first's. Keying on the article or the URL was the
 *    thing GPT Sol's finding P1-5 refused, because both are things an attacker
 *    varies freely.
 * 3. **Concurrency is separate from the window**, and `finish` frees the slot
 *    while the fill goes on counting. Deleting the row on `finish` would make
 *    the hourly cap a cap on *simultaneous* fetches and nothing else — which is
 *    the shape of mistake that looks like a working limiter.
 * 4. **A lease, not a flag.** A caller that died without finishing holds its
 *    slot until the lease runs out and no longer.
 *
 * What is deliberately not tested here is the advisory lock's atomicity across
 * connections, and it is worth saying rather than leaving as a hole: proving it
 * needs genuinely concurrent transactions through a pool that opens connections
 * lazily, and a version of that which quietly serialises would pass whether the
 * lock was there or not. The lock's argument is the one `pg-feedback.ts` already
 * makes and `tests/feedback-store.test.ts` already exercises, over the same
 * `pg_advisory_xact_lock` pattern in the same shape.
 *
 * Skips loudly when there is no database; tests/helpers/pg-ready.ts.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { rateLimitEvents } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { runAsOwner, type OwnerId } from "../src/owner.js";
import { pgFetchAllowanceStore } from "../src/store/pg-rate-limit.js";
import type { RatePolicy } from "../src/store/contracts.js";
import { PREVIEW_RATE_POLICY } from "../src/link-previews.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

/**
 * Two readers, both real. `rate_limit_events.owner_id` references
 * `auth.users(id)` (drizzle/20260905163130), so a made-up uuid cannot spend
 * anything — and the "not somebody else's allowance" case needs a second reader
 * who can actually write.
 */
const ALICE = "00000000-0000-4000-8000-00000000fd01" as OwnerId;
const BOB = "00000000-0000-4000-8000-00000000fd02" as OwnerId;

await pgReady({
  suite: "tests/fetch-allowance.test.ts",
  tables: ["spideryarn.rate_limit_events"],
});

await seedAuthUser(getDb(), {
  id: ALICE,
  email: "alice-allowance@example.invalid",
  onConflictDoNothing: true,
});
await seedAuthUser(getDb(), {
  id: BOB,
  email: "bob-allowance@example.invalid",
  onConflictDoNothing: true,
});

/** Small numbers, so the cases are three calls rather than a hundred and twenty. */
const TIGHT: RatePolicy = { fills: 2, windowMs: 60 * 60 * 1000, concurrency: 1, leaseMs: 30_000 };
/** Room to spare, for the cases that are about something other than the cap. */
const LOOSE: RatePolicy = { fills: 50, windowMs: 60 * 60 * 1000, concurrency: 4, leaseMs: 30_000 };

const take = (who: OwnerId, policy: RatePolicy) =>
  runAsOwner(who, () => pgFetchAllowanceStore.take("link-preview-fetch", policy));
const finish = (who: OwnerId, id: string) =>
  runAsOwner(who, () => pgFetchAllowanceStore.finish(id));

/** Free the concurrency slot without spending anything else — the ordinary path. */
async function fill(who: OwnerId, policy: RatePolicy): Promise<void> {
  const taken = await take(who, policy);
  if (taken.kind !== "allowed") throw new Error(`expected allowance, got ${taken.kind}`);
  await finish(who, taken.id);
}

afterEach(async () => {
  await getDb().delete(rateLimitEvents);
});

afterAll(async () => {
  await closeDb();
});

describe("the fetch allowance", () => {
  it("refuses the fill after the cap", async () => {
    await fill(ALICE, TIGHT);
    await fill(ALICE, TIGHT);
    expect(await take(ALICE, TIGHT)).toEqual({ kind: "rate" });
  });

  it("counts one reader's fills against nobody else", async () => {
    await fill(ALICE, TIGHT);
    await fill(ALICE, TIGHT);
    expect(await take(ALICE, TIGHT)).toEqual({ kind: "rate" });
    /* Bob has spent nothing. The key is the authenticated owner and nothing
       else — never the article or the URL, which vary freely. P1-5. */
    const bob = await take(BOB, TIGHT);
    expect(bob.kind).toBe("allowed");
  });

  it("holds a concurrency slot until the fetch says it is finished", async () => {
    const first = await take(ALICE, TIGHT);
    expect(first.kind).toBe("allowed");
    /* Under the cap on fills and over the cap on simultaneous ones — two
       different refusals, and they must not be the same one. */
    expect(await take(ALICE, TIGHT)).toEqual({ kind: "concurrency" });
    if (first.kind !== "allowed") throw new Error("unreachable");
    await finish(ALICE, first.id);
    expect((await take(ALICE, TIGHT)).kind).toBe("allowed");
  });

  it("keeps the fill counting after the slot is freed", async () => {
    await fill(ALICE, TIGHT);
    await fill(ALICE, TIGHT);
    /* Two rows still there, both finished. `finish` clears the lease and not
       the row: deleting it would turn an hourly cap into a concurrency cap
       wearing an hourly cap's name. */
    const rows = await getDb()
      .select({ id: rateLimitEvents.id, leaseUntil: rateLimitEvents.leaseUntil })
      .from(rateLimitEvents)
      .where(eq(rateLimitEvents.ownerId, ALICE));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.leaseUntil === null)).toBe(true);
    expect(await take(ALICE, TIGHT)).toEqual({ kind: "rate" });
  });

  it("frees an abandoned slot when its lease runs out", async () => {
    const taken = await take(ALICE, LOOSE);
    expect(taken.kind).toBe("allowed");
    if (taken.kind !== "allowed") throw new Error("unreachable");
    /* The process holding it died without calling `finish`. A lease and not a
       flag is what stops that costing the reader a slot for ever. */
    await getDb()
      .update(rateLimitEvents)
      .set({ leaseUntil: new Date(Date.now() - 1_000) })
      .where(eq(rateLimitEvents.id, taken.id));
    const tight: RatePolicy = { ...LOOSE, concurrency: 1 };
    expect((await take(ALICE, tight)).kind).toBe("allowed");
  });

  it("forgets fills that have fallen out of the window", async () => {
    await fill(ALICE, TIGHT);
    await fill(ALICE, TIGHT);
    /* An hour ago. The sweep runs inside `take`, so the table is bounded by
       (readers × allowance) rather than by history — and there is no second job
       to forget to run. */
    await getDb()
      .update(rateLimitEvents)
      .set({ startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(rateLimitEvents.ownerId, ALICE));
    expect((await take(ALICE, TIGHT)).kind).toBe("allowed");
    const left = await getDb()
      .select({ id: rateLimitEvents.id })
      .from(rateLimitEvents)
      .where(and(eq(rateLimitEvents.ownerId, ALICE), eq(rateLimitEvents.bucket, "link-preview-fetch")));
    expect(left).toHaveLength(1);
  });
});

describe("the starting policy", () => {
  it("is the shape Sol proposed, and the numbers are guesses", () => {
    /* Pinned so that a change is a decision rather than a drift, and *only*
       that: `PREVIEW_RATE_POLICY`'s own comment says these came from a review
       that called them starting limits rather than repository evidence, and
       tuning them from telemetry is the expected next move. If you are here
       because this went red, read that comment before changing this number. */
    expect(PREVIEW_RATE_POLICY.fills).toBe(120);
    expect(PREVIEW_RATE_POLICY.windowMs).toBe(60 * 60 * 1000);
    expect(PREVIEW_RATE_POLICY.concurrency).toBe(4);
  });
});
