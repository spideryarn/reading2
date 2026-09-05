/**
 * **`GET /api/billing/usage`** — what `/profile` is told, against the real
 * database.
 *
 * The wall has been live since 2026-09-03 and its refusal has been pointing at
 * an Upgrade button that did not exist. This route is what draws the button, so
 * what matters is not "does it answer" but that it answers the *same* thing the
 * wall decides:
 *
 * - **a reservation still in flight counts as used**, because it counts at the
 *   wall. A page that showed only settled successes would tell somebody they had
 *   a slot and then watch the server refuse them.
 * - **a paid account counts inside its period and a free one counts for ever**,
 *   which is the half-open `[start, end)` rule `usageSql` meters by. Counting a
 *   paid account's whole history would show them permanently over.
 * - **a lapsed account gets no `used` at all** — see tests/billing-plan.test.ts
 *   for why, and here for the fact that the route really does leave the field
 *   off rather than the component declining to draw it.
 * - **an administrator is exempt**, via the same `isAdmin` the wall exempts on.
 * - **it never asks Stripe.** A stale period is answered `unknown`;
 *   tests/setup/provider-guard.ts refuses `api.stripe.com` underneath, so a
 *   version that grew a resync would fail rather than call out.
 *
 * The last case here is about the *other* direction — that nothing the browser
 * sends can choose a price — because the button this route draws is the thing
 * that posts to `/api/billing/checkout`.
 *
 * Skips loudly with no database (tests/helpers/pg-ready.ts). Check a change with
 * `REQUIRE_POSTGRES=1 npx vitest run tests/billing-usage-route.test.ts` and read
 * the count — a skip looks exactly like a pass.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/* `SPIDERYARN_STORE=postgres` before a single import is evaluated — src/store/live.ts
   reads the flag once, at first import, and imports are hoisted above ordinary
   statements. Without it every answer here is `{ kind: "off" }`, which is the
   correct answer for a filesystem store and tells this suite nothing. The
   reasoning in full is in tests/store-pg-session.test.ts. */
const HOISTED = vi.hoisted(() => {
  const store = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return { store };
});

import { ADMIN_USER_ID_LOCAL, isAdmin } from "../src/admin.js";
import type { Verifier } from "../src/auth.js";
import { FREE_LIFETIME_INGESTS } from "../src/billing/tiers.js";
import { getDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import type { OwnerId } from "../src/owner.js";
import { handleApi } from "../src/routes.js";
import { adminQueries } from "../src/store/pg-admin.js";
import { forgetCachedTiers } from "../src/store/pg-tiers.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

/* Put the flag back for whatever runs next in this process. */
if (HOISTED.store === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = HOISTED.store;

const { reachable, pool } = await pgReady({
  suite: "tests/billing-usage-route.test.ts",
  tables: ["spideryarn.billing_accounts", "spideryarn.ingest_events", "spideryarn.billing_tiers"],
  keepPool: true,
  max: 3,
});

const dbIt = reachable ? it : it.skip;

/**
 * One reader of this file's own, minted per run.
 *
 * The stem is fixed so a run killed halfway leaves rubble the next run's sweep
 * can match; the tail is random so two processes running this file cannot delete
 * each other's rows (tests/fixture-ids.test.ts § *the same file, in two
 * processes*).
 */
const OWNER_STEM = "000000bf-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;

const HEADERS = { authorization: "Bearer test-token" };

/** Says yes, as whichever owner is asked for. */
function signedInAs(owner: string): Verifier {
  return async () => ({
    ok: true,
    claims: { sub: owner, email: `usage-${owner}@example.invalid`, role: "authenticated" },
  });
}

beforeAll(async () => {
  if (!pool) return;
  await sweep();
  await seedAuthUser(pool, { id: OWNER, email: `usage-${OWNER}@example.invalid` });
});

afterEach(async () => {
  await sweep();
});

afterAll(async () => {
  if (!pool) return;
  await sweep();
  await pool.query("delete from auth.users where id::text like $1", [RUBBLE]).catch(() => {});
  await pool.end();
});

async function sweep(): Promise<void> {
  if (!pool) return;
  /* Ledger before account: `ingest_events.owner_id` has no foreign key into
     `billing_accounts`, but doing it in this order keeps the sweep readable as
     "the slots, then the plan". */
  await pool.query("delete from spideryarn.ingest_events where owner_id::text like $1", [RUBBLE]);
  await pool.query("delete from spideryarn.billing_accounts where owner_id::text like $1", [RUBBLE]);
  forgetCachedTiers();
}

/* -------------------------------------------------------------- fixtures -- */

/** A tier's Stripe price, **read from the table** rather than named here. */
async function tierRow(id: string): Promise<{ priceId: string; name: string; limit: number }> {
  if (!pool) return { priceId: "", name: "", limit: 0 };
  const { rows } = await pool.query<{
    stripe_price_id: string | null;
    product_name: string;
    ingests_per_period: number;
  }>(
    `select stripe_price_id, product_name, ingests_per_period
       from spideryarn.billing_tiers where id = $1 and active`,
    [id],
  );
  const row = rows[0];
  if (!row?.stripe_price_id) {
    /* Not a skip. The seed migration creates this row and
       `npx tsx scripts/stripe-setup.ts --apply` fills the id in; a database
       without it is one this suite cannot say anything useful about, and saying
       so beats passing quietly. */
    throw new Error(
      `billing_tiers has no active '${id}' row with a stripe_price_id — run ` +
        "npx tsx scripts/stripe-setup.ts --apply",
    );
  }
  return {
    priceId: row.stripe_price_id,
    name: row.product_name,
    limit: row.ingests_per_period,
  };
}

/** The tier a `/pricing` press would buy first. */
const readerTier = () => tierRow("reader");

/**
 * What the reply says may be bought: the door, and the tier ids behind it.
 *
 * Read off the wire rather than through `purchasableTiers`, so this asks what a
 * browser would actually receive — a summary built with the field missing
 * altogether reads as `absent` here rather than as an empty list.
 */
function purchaseOf(body: Record<string, unknown>): { kind: string; ids: string[] } {
  const purchase = body.purchase as { kind: string; tiers?: { id: string }[] } | undefined;
  return { kind: purchase?.kind ?? "absent", ids: (purchase?.tiers ?? []).map((t) => t.id) };
}

/** Put a billing row in, the way the webhook's sync would have written one. */
async function givenAccount(fields: {
  customer?: string | null;
  subscription?: string | null;
  status?: string | null;
  priceId?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  /** The timestamp a Portal cancellation writes, leaving the boolean false. */
  cancelAt?: Date | null;
}): Promise<void> {
  if (!pool) return;
  await pool.query(
    `insert into spideryarn.billing_accounts
       (owner_id, stripe_customer_id, stripe_subscription_id, status, price_id,
        current_period_start, current_period_end, cancel_at_period_end, cancel_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (owner_id) do update set
       stripe_customer_id = excluded.stripe_customer_id,
       stripe_subscription_id = excluded.stripe_subscription_id,
       status = excluded.status,
       price_id = excluded.price_id,
       current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end,
       cancel_at_period_end = excluded.cancel_at_period_end,
       cancel_at = excluded.cancel_at`,
    [
      OWNER,
      fields.customer ?? null,
      fields.subscription ?? null,
      fields.status ?? null,
      fields.priceId ?? null,
      fields.periodStart ?? null,
      fields.periodEnd ?? null,
      fields.cancelAtPeriodEnd ?? false,
      fields.cancelAt ?? null,
    ],
  );
}

/**
 * Ledger rows, written directly.
 *
 * `succeeded_at` is passed rather than defaulted because the whole point of half
 * the cases is *when* an ingest happened relative to a billing period, and
 * `now()` cannot express "last month".
 */
async function givenIngests(
  rows: { succeededAt?: Date | null; releasedAt?: Date | null }[],
): Promise<void> {
  if (!pool) return;
  for (const row of rows) {
    /* `reserved_at` a day before the earliest thing that can settle it: the
       schema checks that a terminal timestamp never precedes it. */
    const settled = row.succeededAt ?? row.releasedAt ?? null;
    const reserved = settled ? new Date(settled.getTime() - 86_400_000) : new Date();
    await pool.query(
      `insert into spideryarn.ingest_events (owner_id, reserved_at, succeeded_at, released_at)
       values ($1, $2, $3, $4)`,
      [OWNER, reserved, row.succeededAt ?? null, row.releasedAt ?? null],
    );
  }
}

/** A period that contains now, so an `active` row is not stale. */
function livePeriod(): { start: Date; end: Date } {
  const now = Date.now();
  return { start: new Date(now - 5 * 86_400_000), end: new Date(now + 25 * 86_400_000) };
}

/* ------------------------------------------------------------- the cases -- */

describe("GET /api/billing/usage", () => {
  dbIt("puts a reader with no billing row on the free tier, with nothing used", async () => {
    const reply = await get("/api/billing/usage", OWNER);
    expect(reply.status).toBe(200);
    expect(reply.body.plan).toEqual({ kind: "free", limit: FREE_LIFETIME_INGESTS, used: 0 });
    /* Nothing to manage: the Stripe customer that would hold a billing history
       is created by the first checkout, and the Portal route refuses without
       one. A button drawn here could only produce that refusal. */
    expect(reply.body.manageable).toBe(false);
    /* And there is plainly something to sell them, through the Checkout door. */
    expect(purchaseOf(reply.body).kind).toBe("checkout");
  });

  dbIt("counts a free reader's successes for ever, and their reservations too", async () => {
    const lastYear = new Date(Date.now() - 300 * 86_400_000);
    await givenIngests([
      { succeededAt: lastYear },
      { succeededAt: new Date() },
      /* Unsettled — a job in flight. It counts at the wall, so it counts here. */
      {},
      /* Released — a failed ingest, which is free. It must not count. */
      { releasedAt: new Date() },
    ]);
    const reply = await get("/api/billing/usage", OWNER);
    expect(reply.body.plan).toEqual({ kind: "free", limit: FREE_LIFETIME_INGESTS, used: 3 });
  });

  dbIt("offers the tiers that have a Stripe price, with their real numbers", async () => {
    const tier = await readerTier();
    const reply = await get("/api/billing/usage", OWNER);
    const offers = (
      reply.body.purchase as {
        tiers?: { id: string; name: string; ingestsPerPeriod: number; amounts: Record<string, number> }[];
      }
    ).tiers ?? [];
    const reader = offers.find((o) => o.id === "reader");
    /* Read back against the row rather than against a constant here — the whole
       reason tiers are rows is that these numbers change without a deploy. */
    expect(reader).toMatchObject({ name: tier.name, ingestsPerPeriod: tier.limit });
    /* **Every offer is priced**, asserted against the real rows because nothing
       guarantees it: `offerableTiers` filters on `stripePriceId`, which lives on
       `billing_tiers`, while the amounts are rows in `billing_tier_prices` — two
       tables, and a tier can have the first and none of the second. What holds
       them together is `tests/billing-tiers.test.ts`'s "every active tier is
       priced in every currency any tier offers"; this is the same claim asked at
       the seam the page reads, which is where a card with a name and no price
       would actually appear. */
    expect(offers.every((o) => Object.keys(o.amounts ?? {}).length > 0)).toBe(true);
    expect(offers.length).toBeGreaterThan(0);
  });

  dbIt("counts a paid reader inside their period and not before it", async () => {
    const tier = await readerTier();
    const period = livePeriod();
    await givenAccount({
      customer: "cus_usage_paid",
      subscription: "sub_usage_paid",
      status: "active",
      priceId: tier.priceId,
      periodStart: period.start,
      periodEnd: period.end,
    });
    await givenIngests([
      /* Last month, on the same subscription. Paid for already; not this month's. */
      { succeededAt: new Date(period.start.getTime() - 86_400_000) },
      { succeededAt: new Date(period.start.getTime() + 86_400_000) },
      { succeededAt: new Date(period.start.getTime() + 2 * 86_400_000) },
    ]);

    const reply = await get("/api/billing/usage", OWNER);
    expect(reply.body.plan).toEqual({
      kind: "paid",
      tierId: "reader",
      tierName: tier.name,
      limit: tier.limit,
      used: 2,
      periodEnd: period.end.toISOString(),
      endsAt: null,
    });
    expect(reply.body.manageable).toBe(true);
  });

  dbIt("will not offer to sell beside a subscription that is not over", async () => {
    /* **The list this is decided by is shorter than "unentitled".** `unpaid`
       entitles nothing — so this account is `lapsed`
       and would be refused an ingest — and it is a subscription Stripe still
       holds and may still collect on, so `startCheckout` sends them to the
       Portal rather than selling a second one. Tier cards drawn beside that are
       buttons whose only outcome is a redirect somewhere else. GPT Sol,
       2026-09-03. */
    await givenAccount({
      customer: "cus_usage_unpaid",
      subscription: "sub_usage_unpaid",
      status: "unpaid",
      priceId: (await readerTier()).priceId,
    });
    const reply = await get("/api/billing/usage", OWNER);
    expect(reply.body.plan).toMatchObject({ kind: "lapsed" });
    /* Not `top` either — that would say they are on the largest plan, which is a
       sentence, and this account is not on a plan at all. */
    expect(purchaseOf(reply.body)).toEqual({ kind: "none", ids: [] });
    /* And the Portal *is* offered, because that is where they need to go. */
    expect(reply.body.manageable).toBe(true);
  });

  dbIt("offers to sell to a reader whose subscription really is over", async () => {
    /* The mirror, so the case above cannot pass by refusing everybody.
       `canceled` is terminal, so resubscribing is exactly the right offer. */
    await givenAccount({
      customer: "cus_usage_over",
      subscription: "sub_usage_over",
      status: "canceled",
    });
    const reply = await get("/api/billing/usage", OWNER);
    expect(reply.body.plan).toMatchObject({ kind: "lapsed" });
    expect(purchaseOf(reply.body).kind).toBe("checkout");
  });

  /* ------------------------------------------- one tier up, and no further -- */

  /**
   * **A paying Reader is offered Researcher, and not Reader.**
   *
   * The gate was a boolean meaning *has no open subscription*, so this account
   * was drawn no button on either page while Stripe's Portal would have taken
   * the switch — docs/project/billing.md § *Reader → Researcher*. Watched failing
   * on 2026-09-04 against a `tiersToOffer` whose filter was removed: the answer
   * came back `switch` over both tiers, which is a button offering a Reader the
   * plan they are already on.
   */
  dbIt("offers a paying Reader the tier above, through the Portal", async () => {
    const tier = await readerTier();
    const period = livePeriod();
    await givenAccount({
      customer: "cus_usage_reader",
      subscription: "sub_usage_reader",
      status: "active",
      priceId: tier.priceId,
      periodStart: period.start,
      periodEnd: period.end,
    });
    const reply = await get("/api/billing/usage", OWNER);
    /* **`switch`, not `checkout`.** `startCheckout` returns the hosted Portal to
       anybody holding an open subscription, so a card labelled as a purchase
       would name something the press does not do. */
    expect(purchaseOf(reply.body)).toEqual({ kind: "switch", ids: ["researcher"] });
  });

  /**
   * **The row that would have sold a Reader a second Reader subscription cannot
   * be written at all.**
   *
   * `status = 'active'` with a known price and a readable period makes
   * `entitlementFromRow` answer *paid Reader*, while the subscription id — the
   * column every "do they already have one" test reads — is null. The two
   * questions were asked separately, so they disagreed: this route answered
   * `checkout` over `["reader", "researcher"]`, and pressing *Get Reader* would
   * have opened a second, concurrently billed subscription for the plan the
   * reader is already on. GPT Sol found it on 2026-09-04, and it was watched
   * failing here on 2026-09-05 exactly that way before the fix.
   *
   * Two halves went in, and this is the one that holds for every writer: the
   * insert below is refused by
   * `billing_accounts_subscription_fields_need_subscription`. The code half —
   * `subscriptionState` failing closed if it ever meets one anyway — is over
   * fixture rows in tests/billing-tiers.test.ts, because the state this asserts
   * is unreachable cannot also be handed to the route.
   */
  dbIt("cannot even hold a row that claims a plan with no subscription behind it", async () => {
    if (!pool) return;
    const tier = await readerTier();
    const period = livePeriod();
    const write = pool.query(
      `insert into spideryarn.billing_accounts
         (owner_id, stripe_customer_id, stripe_subscription_id, status, price_id,
          current_period_start, current_period_end)
       values ($1, $2, null, 'active', $3, $4, $5)`,
      [OWNER, "cus_usage_ghost", tier.priceId, period.start, period.end],
    );
    await expect(write).rejects.toThrow("billing_accounts_subscription_fields_need_subscription");
    /* **And the same row *with* its subscription id goes in**, so this cannot
       pass because the insert was malformed in some other way. */
    await givenAccount({
      customer: "cus_usage_ghost",
      subscription: "sub_usage_ghost",
      status: "active",
      priceId: tier.priceId,
      periodStart: period.start,
      periodEnd: period.end,
    });
    expect(purchaseOf((await get("/api/billing/usage", OWNER)).body).kind).toBe("switch");
  });

  /**
   * **Nothing is on sale when Stripe is not configured.**
   *
   * The tiers are perfectly good rows in Postgres and `STRIPE_SECRET_KEY` is
   * missing, so every card drawn from them ends in the 503 `orBillingUnavailable`
   * answers. Nothing in the summary asked, so a free reader was shown *Get
   * Reader* and a subscriber *Switch plan*, and pressing either produced
   * "billing is not available just now". GPT Sol, 2026-09-04, finding 4.
   *
   * The plan itself is unaffected, which is the point of putting the check on
   * `purchase` alone: a quota is a fact about the ledger and does not stop being
   * true because a key is missing.
   */
  dbIt("offers nothing at all when this deployment has no Stripe key", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    try {
      const reply = await get("/api/billing/usage", OWNER);
      expect(purchaseOf(reply.body)).toEqual({ kind: "none", ids: [] });
      /* And it is still an answer about a plan, not an error. */
      expect(reply.status).toBe(200);
      expect(reply.body.plan).toMatchObject({ kind: "free" });
    } finally {
      vi.unstubAllEnvs();
    }
    /* **The mirror**, so this cannot pass on a machine that never had a key: the
       same reader, the same rows, with the key back. */
    expect(purchaseOf((await get("/api/billing/usage", OWNER)).body).kind).toBe("checkout");
  });

  /**
   * **A trialling Reader is offered the switch, and told what it really does.**
   *
   * `trialing` is an entitled status (`ENTITLED_STATUSES`, src/billing/tiers.ts),
   * so this account reaches the `switch` arm — and until 2026-09-05 the sentence
   * beside the button was the paid one, every clause of which is false here: the
   * Portal ends the trial (`trial_update_behavior: "end_trial"`), so there is no
   * difference to invoice, the period does not stay put, and the allowance is not
   * prorated. `from` is what carries that as far as the page. GPT Sol, finding 2.
   */
  dbIt("says a trialling reader's switch is out of a trial, not out of a paid month", async () => {
    const tier = await readerTier();
    const period = livePeriod();
    await givenAccount({
      customer: "cus_usage_trial",
      subscription: "sub_usage_trial",
      status: "trialing",
      priceId: tier.priceId,
      periodStart: period.start,
      periodEnd: period.end,
    });
    const purchase = (await get("/api/billing/usage", OWNER)).body.purchase as {
      kind: string;
      from?: string;
    };
    expect(purchase).toMatchObject({ kind: "switch", from: "trial" });
  });

  /**
   * The top of the ladder, which is the case that has to say something rather
   * than draw an empty gap.
   */
  dbIt("offers a Researcher nothing, and says that is because they are at the top", async () => {
    const tier = await tierRow("researcher");
    const period = livePeriod();
    await givenAccount({
      customer: "cus_usage_researcher",
      subscription: "sub_usage_researcher",
      status: "active",
      priceId: tier.priceId,
      periodStart: period.start,
      periodEnd: period.end,
    });
    const reply = await get("/api/billing/usage", OWNER);
    /* `top` rather than `none`: the page has a sentence for one and nothing to
       say for the other, and a Researcher looking at three prices with no button
       is owed the sentence. */
    expect(purchaseOf(reply.body)).toEqual({ kind: "top", ids: [] });
  });

  /**
   * **Ascending, because nothing downstream will fix it.**
   *
   * `PlanCards` draws plans in the order it is handed them and promotes nothing,
   * so a filtered list that came back jumbled would read as unrelated offers
   * rather than a ladder. Asked of the allowance rather than of a hardcoded pair
   * of ids, so a third tier joins the assertion by existing.
   */
  dbIt("hands the tiers over cheapest first", async () => {
    const reply = await get("/api/billing/usage", OWNER);
    const { ids } = purchaseOf(reply.body);
    const rows = await Promise.all(ids.map((id) => tierRow(id)));
    const allowances = rows.map((t) => t.limit);
    expect(allowances).toEqual([...allowances].sort((a, b) => a - b));
    /* And the seeded catalogue really is more than one row, so the assertion
       above is not vacuously true of a list of one. */
    expect(ids.length).toBeGreaterThan(1);
  });

  dbIt("says when a cancelled subscription ends, so the page cannot say it renews", async () => {
    /* The old boolean, which is what an API cancellation writes. */
    const tier = await readerTier();
    const period = livePeriod();
    await givenAccount({
      customer: "cus_usage_cancelling",
      subscription: "sub_usage_cancelling",
      status: "active",
      priceId: tier.priceId,
      periodStart: period.start,
      periodEnd: period.end,
      cancelAtPeriodEnd: true,
    });
    const reply = await get("/api/billing/usage", OWNER);
    expect(reply.body.plan).toMatchObject({
      kind: "paid",
      endsAt: period.end.toISOString(),
    });
  });

  /**
   * **The live bug, end to end through the route.** Greg cancelled the first
   * real subscription through the hosted Portal on 2026-09-03 and Stripe set
   * `cancel_at` while leaving `cancel_at_period_end` at `false`. Every fixture
   * in this file had been written from the same assumption the code was made
   * on, so the suite stayed green while production said nothing — the row above
   * is the shape of the *other* kind of cancellation, and it was the only one
   * anybody had tested. docs/project/billing.md § *The first live sale*.
   */
  dbIt("tells a reader who cancelled through the Portal, where the boolean is false", async () => {
    const tier = await readerTier();
    const period = livePeriod();
    /* Not the period end, so the assertion cannot pass by reading the wrong
       column: Stripe permits an ending scheduled for any future moment. */
    const ending = new Date(period.end.getTime() + 5 * 86_400_000);
    await givenAccount({
      customer: "cus_usage_portal_cancel",
      subscription: "sub_usage_portal_cancel",
      status: "active",
      priceId: tier.priceId,
      periodStart: period.start,
      periodEnd: period.end,
      cancelAtPeriodEnd: false,
      cancelAt: ending,
    });
    const reply = await get("/api/billing/usage", OWNER);
    expect(reply.body.plan).toMatchObject({
      kind: "paid",
      endsAt: ending.toISOString(),
      /* And `periodEnd` still says when the allowance rolls over. They are
         different dates and the page needs both to stay different. */
      periodEnd: period.end.toISOString(),
    });

    /* **Entitlement did not move.** `active` until the period ends is exactly
       what we grant, so the plan is still `paid` on the tier's own limit — this
       stage may not take an allowance away early. The wall's own version of
       this pin is in tests/billing-admission.test.ts. */
    expect(reply.body.plan).toMatchObject({ tierId: "reader", limit: tier.limit });
  });

  dbIt("gives a lapsed subscriber no `used` field at all", async () => {
    /* The shape the policy makes real: forty articles taken on a paid plan, then
       cancelled, against a lifetime free allowance of three. */
    await givenAccount({
      customer: "cus_usage_lapsed",
      subscription: "sub_usage_lapsed",
      status: "canceled",
      priceId: (await readerTier()).priceId,
    });
    await givenIngests(Array.from({ length: 40 }, () => ({ succeededAt: new Date() })));

    const reply = await get("/api/billing/usage", OWNER);
    const plan = reply.body.plan as Record<string, unknown>;
    expect(plan).toEqual({ kind: "lapsed", limit: FREE_LIFETIME_INGESTS, remaining: 0 });
    /* **Explicitly, because `toEqual` above would pass with `used: undefined`
       on some shapes and this is the assertion the policy rests on.** The
       component cannot print "40 of 3" if the number never crosses the wire. */
    expect("used" in plan).toBe(false);
    expect(JSON.stringify(reply.body)).not.toContain('"used"');
    expect(reply.body.manageable).toBe(true);
  });

  dbIt("leaves a lapsed subscriber their remaining free slots when they have any", async () => {
    await givenAccount({
      customer: "cus_usage_lapsed_room",
      subscription: "sub_usage_lapsed_room",
      status: "canceled",
    });
    await givenIngests([{ succeededAt: new Date() }]);
    const reply = await get("/api/billing/usage", OWNER);
    expect(reply.body.plan).toEqual({ kind: "lapsed", limit: FREE_LIFETIME_INGESTS, remaining: 2 });
  });

  dbIt("says it does not know, rather than asking Stripe, when the period has run out", async () => {
    const tier = await readerTier();
    const long = 400 * 86_400_000;
    await givenAccount({
      customer: "cus_usage_stale",
      subscription: "sub_usage_stale",
      status: "active",
      priceId: tier.priceId,
      periodStart: new Date(Date.now() - long),
      periodEnd: new Date(Date.now() - long + 30 * 86_400_000),
    });
    /* `unknown`, not a number. Both available guesses are wrong — the free limit
       falsely blocks somebody who has paid, the paid limit against a closed
       window is an uncapped month — and this is a read, so there is nothing to
       decide. The wall resyncs; this does not. */
    const reply = await get("/api/billing/usage", OWNER);
    expect(reply.body.plan).toEqual({ kind: "unknown" });
  });

  dbIt("exempts an administrator instead of showing them a misleading count", async () => {
    /* The seeded local administrator, and `isAdmin` is asserted rather than
       assumed: if that constant ever stops being an admin this case would
       quietly become a test of the free tier. */
    expect(isAdmin(ADMIN_USER_ID_LOCAL)).toBe(true);
    const reply = await get("/api/billing/usage", ADMIN_USER_ID_LOCAL);
    expect(reply.body.plan).toEqual({ kind: "exempt" });
    /* No count of any kind — an administrator takes no slot at all, so any
       figure would be a count of something that was never counted. */
    expect(JSON.stringify(reply.body.plan)).not.toMatch(/\d/);
  });

  dbIt("refuses a caller with no session", async () => {
    const reply = await drive("GET", "/api/billing/usage", "", undefined, {});
    expect(reply.status).toBe(401);
  });

  dbIt("is not a namespace — a sibling path is a 404", async () => {
    const reply = await get("/api/billing/usages", OWNER);
    expect(reply.status).toBe(404);
  });
});

describe("what the Upgrade button may ask for", () => {
  /* The button posts `{ tierId }` and nothing else (src/web/useBilling.ts). What
     is worth a test is not that the client behaves, but that a client which did
     *not* could get nowhere — the same request an altered bundle, a console, or
     a `curl` would send. */
  for (const forbidden of ["price", "priceId", "price_id"]) {
    dbIt(`refuses a browser-supplied ${forbidden} rather than ignoring it`, async () => {
      const reply = await post(
        "/api/billing/checkout",
        { tierId: "reader", [forbidden]: "price_1AnAttackersOwn" },
        OWNER,
      );
      /* **Refused, not dropped.** Silently ignoring it would let a caller
         believe they had chosen a price and be charged for something else, and
         would leave no sign in a log that anybody had tried. */
      expect(reply.status).toBe(400);
      expect(String(reply.body.error)).toContain(forbidden);
      /* And it never reached Stripe: `parseCheckoutRequest` runs in the route
         before a client is constructed, so this 400 is not a configuration
         failure wearing a 400. */
      expect(String(reply.body.error)).not.toMatch(/stripe/i);
    });
  }

  dbIt("refuses a browser-supplied owner id", async () => {
    const reply = await post("/api/billing/checkout", { tierId: "reader", ownerId: OWNER }, OWNER);
    expect(reply.status).toBe(400);
  });
});

describe("the admin page's ingest aggregate", () => {
  dbIt("splits the lifetime count from the one inside the row's own period", async () => {
    const tier = await readerTier();
    const period = livePeriod();
    await givenAccount({
      customer: "cus_usage_admin",
      subscription: "sub_usage_admin",
      status: "active",
      priceId: tier.priceId,
      periodStart: period.start,
      periodEnd: period.end,
    });
    await givenIngests([
      { succeededAt: new Date(period.start.getTime() - 10 * 86_400_000) },
      { succeededAt: new Date(period.start.getTime() + 86_400_000) },
      { succeededAt: new Date(period.start.getTime() + 2 * 86_400_000) },
      {},
      { releasedAt: new Date() },
    ]);

    const rows = await adminQueries(getDb()).ingests;
    const mine = rows.find((r) => r.owner === OWNER);
    /* Three settled successes ever, two of them inside the period, one
       reservation outstanding, and the released one counted nowhere. The two
       windows are both returned because which one is right depends on the
       entitlement, and the entitlement is decided in TypeScript by the same
       function the wall uses — see `planFacts` in src/store/pg-admin.ts. */
    expect(mine).toEqual({ owner: OWNER, lifetime: 3, inPeriod: 2, inFlight: 1 });
  });

  dbIt("counts an owner with no billing row at all, rather than dropping them", async () => {
    /* The left join is what makes this true. An inner one would report every
       free reader — which is most of them — as having ingested nothing. */
    await givenIngests([{ succeededAt: new Date() }, { succeededAt: new Date() }]);
    const rows = await adminQueries(getDb()).ingests;
    expect(rows.find((r) => r.owner === OWNER)).toEqual({
      owner: OWNER,
      lifetime: 2,
      inPeriod: 0,
      inFlight: 0,
    });
  });
});

/* ------------------------------------------------------------- the wire -- */

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

async function get(url: string, owner: string): Promise<Reply> {
  return await drive("GET", url, "", signedInAs(owner), HEADERS);
}

async function post(url: string, body: unknown, owner: string): Promise<Reply> {
  return await drive("POST", url, JSON.stringify(body), signedInAs(owner), HEADERS);
}

/** Drive `handleApi` with a fake request/response pair, as tests/routes.test.ts does. */
async function drive(
  method: string,
  url: string,
  raw: string,
  verify: Verifier | undefined,
  headers: Record<string, string>,
): Promise<Reply> {
  const req = Object.assign(
    (async function* () {
      if (raw) yield Buffer.from(raw);
    })(),
    { method, url, headers },
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

  await handleApi(req, res, verify);
  return { status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}
