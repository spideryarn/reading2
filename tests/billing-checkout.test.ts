/**
 * **The door in the wall**: `POST /api/billing/checkout`, `/portal` and
 * `/confirm`.
 *
 * The quota has been live since 2026-09-03 and there has been no way to pay
 * since. What this file is about is not "does Stripe get called" — it is the
 * four things that would each be silently wrong in production:
 *
 * - **the mapping is committed before a Checkout Session exists.** The webhook
 *   finds an owner by `billing_accounts.stripe_customer_id` and answers 503 when
 *   it cannot, so a session that could take money before that row landed is a
 *   customer who pays and gets nothing until Stripe stops retrying. The test for
 *   it reads the row **from inside `checkout.sessions.create`**, which is the only
 *   place the ordering is observable.
 * - **a double-click maps one customer, not two**, by the conditional UPDATE
 *   rather than by a lock — so the two requests are really concurrent here, held
 *   at a barrier until both have read the row.
 * - **the success callback cannot sync somebody else's session**, which is what
 *   stops one reader making this server work on another's subscription and
 *   answering *did they subscribe?*.
 * - **the price comes from `billing_tiers`**, never from the request.
 *
 * ## No network, and the Stripe client is a parameter
 *
 * `StripeCheckout` (src/billing/checkout.ts) is a three-method structural subset
 * of the SDK, so a fake here is three functions. `tests/setup/provider-guard.ts`
 * refuses `api.stripe.com` underneath all of it, so a test that grew a real call
 * would fail rather than spend.
 *
 * The two cases that use the **real** client are the ones about configuration:
 * they assert a 503 before any Stripe object is constructed.
 *
 * Skips loudly with no database (tests/helpers/pg-ready.ts). Check a change with
 * `REQUIRE_POSTGRES=1 npx vitest run tests/billing-checkout.test.ts` and read the
 * count — a skip looks exactly like a pass.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type Stripe from "stripe";

import type { Verifier } from "../src/auth.js";
import {
  billingReturnOrigin,
  confirmCheckout,
  openPortal,
  parseCheckoutRequest,
  startCheckout,
  type StripeCheckout,
} from "../src/billing/checkout.js";
import { resetStripeClientForTests } from "../src/billing/stripe.js";
import {
  ENTITLED_STATUSES,
  TERMINAL_STATUSES,
  isEntitledStatus,
  isTerminalStatus,
} from "../src/billing/tiers.js";
import type { SyncResult } from "../src/billing/sync.js";
import { loadEnvLocal } from "../src/env.js";
import type { OwnerId } from "../src/owner.js";
import { handleApi } from "../src/routes.js";
import { forgetCachedTiers } from "../src/store/pg-tiers.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const { reachable, pool } = await pgReady({
  suite: "tests/billing-checkout.test.ts",
  tables: ["spideryarn.billing_accounts", "spideryarn.billing_tiers"],
  keepPool: true,
  max: 4,
});

const dbIt = reachable ? it : it.skip;

/**
 * Two readers of this file's own, minted per run.
 *
 * Two, because half the point of `/confirm` is that one of them cannot use the
 * other's Checkout Session. The stem is fixed so a run killed halfway leaves
 * rubble the next run's sweep can match; the tail is random so two processes
 * running this file cannot delete each other's rows
 * (tests/fixture-ids.test.ts § *the same file, in two processes*).
 */
const OWNER_STEM = "000000cf-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const STRANGER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;

/** A tier this file retires and nobody else has — see *refuses a tier that has been retired*. */
const RETIRED_TIER = "test-checkout-retired";
const RETIRED_PRICE = "price_test_checkout_retired";

/**
 * Two more fixture tiers, and these two are **active** while they exist.
 *
 * That is safe only because they satisfy what `tests/billing-tiers.test.ts`
 * asserts over the active rows — they carry no `billing_tier_prices` rows at
 * all, so the "priced in every currency any tier offers" and "amounts are whole
 * units" checks have nothing of theirs to look at, and neither has a `usd`
 * amount, so the cheaper-tier-allows-fewer check filters them out. They live for
 * the length of one case and are swept after every one.
 */
const UNPRICED_TIER = "test-checkout-unpriced";
const CACHED_TIER = "test-checkout-cached";
const CACHED_PRICE = "price_test_checkout_cached";

/** Says yes, as this file's owner. */
const asOwner: Verifier = async () => ({
  ok: true,
  claims: { sub: OWNER, email: `checkout-${OWNER}@example.invalid`, role: "authenticated" },
});

const HEADERS = { authorization: "Bearer test-token" };

/** A fake key, so nothing here depends on what is in `.env.local`. */
const KEY = "sk_test_notarealkey000000000000000";

const SAVED = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  VERCEL_ENV: process.env.VERCEL_ENV,
  VERCEL_URL: process.env.VERCEL_URL,
  SPIDERYARN_BASE_URL: process.env.SPIDERYARN_BASE_URL,
};

beforeAll(async () => {
  if (!pool) return;
  await sweep();
  for (const id of [OWNER, STRANGER]) {
    await seedAuthUser(pool, { id, email: `checkout-${id}@example.invalid` });
  }
});

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = KEY;
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL_URL;
  delete process.env.SPIDERYARN_BASE_URL;
  resetStripeClientForTests();
});

afterEach(async () => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetStripeClientForTests();
  forgetCachedTiers();
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
  await pool.query("delete from spideryarn.billing_accounts where owner_id::text like $1", [RUBBLE]);
  await pool.query("delete from spideryarn.billing_tiers where id = any($1::text[])", [
    [RETIRED_TIER, UNPRICED_TIER, CACHED_TIER],
  ]);
  forgetCachedTiers();
}

/* -------------------------------------------------------------- fixtures -- */

/** The row as it is on disk, so an assertion reads what was committed. */
async function accountRow(owner: string): Promise<{
  customer: string | null;
  subscription: string | null;
  status: string | null;
} | null> {
  if (!pool) return null;
  const { rows } = await pool.query<{
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    status: string | null;
  }>(
    `select stripe_customer_id, stripe_subscription_id, status
       from spideryarn.billing_accounts where owner_id = $1`,
    [owner],
  );
  const row = rows[0];
  return row
    ? {
        customer: row.stripe_customer_id,
        subscription: row.stripe_subscription_id,
        status: row.status,
      }
    : null;
}

/** Put a row in, the way the webhook's sync would have written one. */
async function givenAccount(
  owner: string,
  fields: { customer?: string | null; subscription?: string | null; status?: string | null } = {},
): Promise<void> {
  if (!pool) return;
  await pool.query(
    `insert into spideryarn.billing_accounts
       (owner_id, stripe_customer_id, stripe_subscription_id, status)
     values ($1, $2, $3, $4)
     on conflict (owner_id) do update set
       stripe_customer_id = excluded.stripe_customer_id,
       stripe_subscription_id = excluded.stripe_subscription_id,
       status = excluded.status`,
    [owner, fields.customer ?? null, fields.subscription ?? null, fields.status ?? null],
  );
}

/**
 * The Stripe price the `reader` tier is actually sold at, **read from the
 * database**.
 *
 * The assertion this exists for is that the route resolves a tier id through
 * `billing_tiers` rather than taking a price from anywhere else, so the expected
 * value has to come from the same table rather than from a constant here.
 */
async function readerPriceId(): Promise<string> {
  if (!pool) return "";
  const { rows } = await pool.query<{ stripe_price_id: string | null }>(
    "select stripe_price_id from spideryarn.billing_tiers where id = 'reader' and active",
  );
  const priceId = rows[0]?.stripe_price_id;
  if (!priceId) {
    /* Not a skip. The seed migration creates this row and
       `npx tsx scripts/stripe-setup.ts --apply` fills the id in; a database
       without it is one this suite cannot say anything useful about, and saying
       so beats passing quietly. */
    throw new Error(
      "billing_tiers has no active 'reader' row with a stripe_price_id — run " +
        "npx tsx scripts/stripe-setup.ts --apply",
    );
  }
  return priceId;
}

/* ------------------------------------------------------------ a fake Stripe -- */

interface Recorder {
  readonly stripe: StripeCheckout;
  readonly customersCreated: Stripe.CustomerCreateParams[];
  readonly sessionsCreated: Stripe.Checkout.SessionCreateParams[];
  readonly portalsCreated: Stripe.BillingPortal.SessionCreateParams[];
  readonly retrieved: string[];
}

interface FakeOptions {
  /** Runs inside `checkout.sessions.create`, before it answers. */
  readonly whenCreatingSession?: () => Promise<void>;
  /** Runs inside `customers.create`, before it answers — the concurrency barrier. */
  readonly whenCreatingCustomer?: () => Promise<void>;
  /** What `checkout.sessions.retrieve` answers with, by id. */
  readonly sessions?: Record<string, Partial<Stripe.Checkout.Session>>;
  /** Every object's `livemode`. Default false, which is what a test key produces. */
  readonly livemode?: boolean;
}

function fakeStripe(options: FakeOptions = {}): Recorder {
  const customersCreated: Stripe.CustomerCreateParams[] = [];
  const sessionsCreated: Stripe.Checkout.SessionCreateParams[] = [];
  const portalsCreated: Stripe.BillingPortal.SessionCreateParams[] = [];
  const retrieved: string[] = [];
  const livemode = options.livemode ?? false;
  let minted = 0;

  const stripe: StripeCheckout = {
    customers: {
      async create(params) {
        customersCreated.push(params);
        await options.whenCreatingCustomer?.();
        minted += 1;
        return { id: `cus_fake_${minted}`, livemode } as Stripe.Customer;
      },
    },
    checkout: {
      sessions: {
        async create(params) {
          sessionsCreated.push(params);
          await options.whenCreatingSession?.();
          return {
            id: `cs_test_${sessionsCreated.length}`,
            url: `https://checkout.stripe.test/${sessionsCreated.length}`,
            livemode,
          } as Stripe.Checkout.Session;
        },
        async retrieve(id) {
          retrieved.push(id);
          const found = options.sessions?.[id];
          if (!found) throw new Error(`No such checkout.session: ${id}`);
          return { id, livemode, ...found } as Stripe.Checkout.Session;
        },
      },
    },
    billingPortal: {
      sessions: {
        async create(params) {
          portalsCreated.push(params);
          return {
            id: `bps_${portalsCreated.length}`,
            url: `https://portal.stripe.test/${portalsCreated.length}`,
            livemode,
          } as Stripe.BillingPortal.Session;
        },
      },
    },
  };

  return { stripe, customersCreated, sessionsCreated, portalsCreated, retrieved };
}

/* ------------------------------------------------------- over versus unpaid -- */

/**
 * **Terminal and entitled are different questions**, and the whole reason
 * `TERMINAL_STATUSES` exists as a second list rather than as `not entitled`.
 */
describe("which statuses mean the subscription is over", () => {
  it("never calls a status both entitled and terminal", () => {
    for (const status of TERMINAL_STATUSES) {
      expect(ENTITLED_STATUSES, `${status} cannot be both`).not.toContain(status);
    }
  });

  /**
   * **Not over, whether or not they are entitled** — and the two halves of that
   * are different for `past_due` and `unpaid`, which an earlier version of this
   * comment got wrong (GPT Sol, 2026-09-03; it claimed both carry no
   * entitlement).
   *
   * `past_due` **is** entitled, deliberately: a card that failed once is a
   * customer Stripe is still dunning, and cutting them off on the first retry
   * costs more goodwill than it saves (src/billing/tiers.ts). `unpaid` and
   * `incomplete` are not entitled. What all three share is the thing this list
   * is about: Stripe still holds the subscription and may still collect on it,
   * so selling a second one beside it charges the reader twice.
   */
  it("leaves the statuses Stripe may still collect on out of the terminal list", () => {
    for (const status of ["past_due", "unpaid", "incomplete"]) {
      expect(isTerminalStatus(status), status).toBe(false);
    }
    expect(isTerminalStatus("canceled")).toBe(true);
    expect(isTerminalStatus("incomplete_expired")).toBe(true);
  });

  /** And the entitlement half of it, spelled out so the comment above has a test. */
  it("entitles past_due and not unpaid", () => {
    expect(isEntitledStatus("past_due")).toBe(true);
    expect(isEntitledStatus("unpaid")).toBe(false);
    expect(isEntitledStatus("incomplete")).toBe(false);
  });

  /** A status nobody has heard of is not over — see the note on the constant. */
  it("treats an unknown status, and no status at all, as not over", () => {
    expect(isTerminalStatus("something_stripe_added_last_week")).toBe(false);
    expect(isTerminalStatus(null)).toBe(false);
    expect(isTerminalStatus(undefined)).toBe(false);
  });
});

/* --------------------------------------------------------------- checkout -- */

describe("starting a subscription", () => {
  /**
   * **The guarantee, asserted where it is observable.**
   *
   * Reading the row afterwards proves only that it exists; the webhook's problem
   * is whether it existed *before* a session capable of taking money did. So the
   * read happens inside `checkout.sessions.create`.
   */
  dbIt("commits the customer mapping before the Checkout Session exists", async () => {
    let mappedWhenTheSessionWasMade: string | null | undefined;
    const fake = fakeStripe({
      whenCreatingSession: async () => {
        mappedWhenTheSessionWasMade = (await accountRow(OWNER))?.customer;
      },
    });

    const started = await startCheckout(OWNER, { tierId: "reader" }, { stripe: fake.stripe });

    expect(started.kind).toBe("checkout");
    expect(mappedWhenTheSessionWasMade).toBe("cus_fake_1");
    /* And the session names that same customer, rather than letting Checkout
       mint one — a Stripe-minted customer is unmapped by construction. */
    expect(fake.sessionsCreated[0]?.customer).toBe("cus_fake_1");
    expect(fake.sessionsCreated[0]?.customer_creation).toBeUndefined();
  });

  dbIt("takes the price from billing_tiers, and the owner from the gate", async () => {
    const fake = fakeStripe();
    await startCheckout(OWNER, { tierId: "reader" }, { stripe: fake.stripe });

    const params = fake.sessionsCreated[0];
    expect(params?.line_items).toEqual([{ price: await readerPriceId(), quantity: 1 }]);
    expect(params?.mode).toBe("subscription");
    expect(params?.client_reference_id).toBe(OWNER);
    /* Metadata on the customer is recovery data for a support conversation —
       never a source of truth, but it should be there. */
    expect(fake.customersCreated[0]?.metadata).toEqual({ owner_id: OWNER });
  });

  dbIt("reuses a customer this owner already has", async () => {
    await givenAccount(OWNER, { customer: "cus_already_here" });
    const fake = fakeStripe();

    await startCheckout(OWNER, { tierId: "reader" }, { stripe: fake.stripe });

    expect(fake.customersCreated).toHaveLength(0);
    expect(fake.sessionsCreated[0]?.customer).toBe("cus_already_here");
  });

  /**
   * **A second subscription would charge them twice.** `active` is the ordinary
   * case; `past_due` and `unpaid` are the ones worth pinning, because both are
   * subscriptions Stripe still holds and may still collect on even though only
   * one of them is entitled.
   */
  for (const status of ["active", "trialing", "past_due", "unpaid", "incomplete"]) {
    dbIt(`sends an owner with a ${status} subscription to the portal instead`, async () => {
      await givenAccount(OWNER, { customer: "cus_subscriber", subscription: "sub_1", status });
      const fake = fakeStripe();

      const started = await startCheckout(OWNER, { tierId: "reader" }, { stripe: fake.stripe });

      expect(started.kind).toBe("portal");
      expect(started.url).toBe("https://portal.stripe.test/1");
      expect(fake.sessionsCreated).toHaveLength(0);
      expect(fake.portalsCreated[0]?.customer).toBe("cus_subscriber");
    });
  }

  /** Over is over: a cancelled subscription is a reader we may sell to again. */
  for (const status of ["canceled", "incomplete_expired"]) {
    dbIt(`sells again to an owner whose subscription is ${status}`, async () => {
      await givenAccount(OWNER, { customer: "cus_lapsed", subscription: "sub_old", status });
      const fake = fakeStripe();

      const started = await startCheckout(OWNER, { tierId: "reader" }, { stripe: fake.stripe });

      expect(started.kind).toBe("checkout");
      expect(fake.sessionsCreated[0]?.customer).toBe("cus_lapsed");
    });
  }

  /**
   * **The double-click, and it is a real race rather than two calls in a row.**
   *
   * Both requests are held inside `customers.create` until both have arrived, so
   * both have already read a row with no customer on it. What decides the winner
   * is the conditional UPDATE — `where … and stripe_customer_id is null` — and
   * nothing else: there is no lock, on purpose (docs/project/billing.md).
   *
   * The loser adopts the winner's customer and abandons its own, so the two
   * sessions must name the **same** customer. Two would be two billing histories
   * for one person.
   */
  dbIt("maps one customer for two concurrent requests, and both use it", async () => {
    let arrived = 0;
    let bothHere = () => {};
    const barrier = new Promise<void>((resolve) => {
      bothHere = resolve;
    });
    const fake = fakeStripe({
      whenCreatingCustomer: async () => {
        arrived += 1;
        if (arrived >= 2) bothHere();
        await barrier;
      },
    });

    const [first, second] = await Promise.all([
      startCheckout(OWNER, { tierId: "reader" }, { stripe: fake.stripe }),
      startCheckout(OWNER, { tierId: "reader" }, { stripe: fake.stripe }),
    ]);

    /* Both really did try — otherwise this would pass for the wrong reason. */
    expect(fake.customersCreated).toHaveLength(2);
    expect(first.kind).toBe("checkout");
    expect(second.kind).toBe("checkout");

    const mapped = (await accountRow(OWNER))?.customer;
    expect(mapped).toBeTruthy();
    expect(fake.sessionsCreated.map((s) => s.customer)).toEqual([mapped, mapped]);
  });
});

describe("what the request is not allowed to decide", () => {
  /**
   * **A price id from the browser would let anyone check out against any price
   * in the Stripe account** — including one made for somebody else at a
   * different amount. Refused rather than ignored, so nobody is charged for
   * something they did not choose and the attempt leaves a mark.
   */
  for (const key of ["price", "priceId", "price_id"]) {
    it(`refuses a body carrying ${key}`, () => {
      expect(() => parseCheckoutRequest({ tierId: "reader", [key]: "price_someone_elses" })).toThrow(
        /decided by the server/,
      );
    });
  }

  for (const key of ["customer", "ownerId", "owner_id"]) {
    it(`refuses a body carrying ${key}`, () => {
      expect(() => parseCheckoutRequest({ tierId: "reader", [key]: "x" })).toThrow(
        /decided by the server/,
      );
    });
  }

  it("wants a tier id, and nothing else will do", () => {
    expect(() => parseCheckoutRequest({})).toThrow(/tierId/);
    expect(() => parseCheckoutRequest({ tierId: "" })).toThrow(/tierId/);
    expect(() => parseCheckoutRequest("reader")).toThrow(/tierId/);
    expect(parseCheckoutRequest({ tierId: " reader " })).toEqual({ tierId: "reader" });
  });

  it("takes a currency only in the shape Stripe uses", () => {
    expect(parseCheckoutRequest({ tierId: "reader", currency: "gbp" })).toEqual({
      tierId: "reader",
      currency: "gbp",
    });
    expect(() => parseCheckoutRequest({ tierId: "reader", currency: "GBP" })).toThrow(/currency/);
    expect(() => parseCheckoutRequest({ tierId: "reader", currency: "pounds" })).toThrow(/currency/);
  });

  dbIt("refuses a tier this deployment does not sell", async () => {
    const fake = fakeStripe();
    await expect(
      startCheckout(OWNER, { tierId: "platinum" }, { stripe: fake.stripe }),
    ).rejects.toMatchObject({ status: 400 });
    /* Nothing was created on the way to the refusal. */
    expect(fake.customersCreated).toHaveLength(0);
    expect(await accountRow(OWNER)).toBeNull();
  });

  /**
   * **Retiring a tier is a flag, and this is the half of it that bites.**
   * `tierForPrice` deliberately still matches an inactive tier, so somebody
   * already subscribed keeps their allowance — but `active` is what decides what
   * may be *sold*, and selling a retired tier is exactly what retiring it is
   * meant to stop.
   *
   * The fixture is inactive and carries no `billing_tier_prices` rows, which is
   * what makes it safe to add to a table peer suites read:
   * `tests/billing-tiers.test.ts` asserts over the **active** rows and cannot
   * see it (the same reasoning as `sellATier` in tests/billing-admission.test.ts).
   */
  dbIt("refuses a tier that has been retired", async () => {
    if (!pool) return;
    await pool.query(
      `insert into spideryarn.billing_tiers
         (id, product_name, description, ingests_per_period, lookup_key, stripe_price_id,
          livemode, active, sort_order)
       values ($1, 'A checkout fixture', 'Sold only by tests/billing-checkout.test.ts.',
               20, $2, $3, false, false, 901)
       on conflict (id) do nothing`,
      [RETIRED_TIER, `${RETIRED_TIER}_monthly`, RETIRED_PRICE],
    );
    forgetCachedTiers();

    const fake = fakeStripe();
    await expect(
      startCheckout(OWNER, { tierId: RETIRED_TIER }, { stripe: fake.stripe }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fake.sessionsCreated).toHaveLength(0);
  });

  /**
   * **An active tier with no Stripe price is our fault, not the request's.**
   * It means nobody has run `scripts/stripe-setup.ts` against this deployment's
   * key, and a 400 would send the reader looking for a mistake they did not
   * make. GPT Sol, 2026-09-03.
   */
  dbIt("answers 503, not 400, for an active tier nobody has set up in Stripe", async () => {
    if (!pool) return;
    await pool.query(
      `insert into spideryarn.billing_tiers
         (id, product_name, description, ingests_per_period, lookup_key, stripe_price_id,
          livemode, active, sort_order)
       values ($1, 'A checkout fixture', 'Sold only by tests/billing-checkout.test.ts.',
               20, $2, null, null, true, 902)
       on conflict (id) do nothing`,
      [UNPRICED_TIER, `${UNPRICED_TIER}_monthly`],
    );

    const fake = fakeStripe();
    await expect(
      startCheckout(OWNER, { tierId: UNPRICED_TIER }, { stripe: fake.stripe }),
    ).rejects.toMatchObject({ status: 503, message: expect.stringContaining("[pay-off]") });
    expect(fake.sessionsCreated).toHaveLength(0);
  });

  /**
   * **The tier table is read uncached here**, unlike on the ingest path.
   *
   * A session minted from a thirty-second-old snapshot can sell a tier somebody
   * has just retired, and the damage outlives the snapshot: a Checkout Session
   * stays payable for about a day, and the subscription then bills on the old
   * price for as long as it lasts. GPT Sol, 2026-09-03.
   *
   * The case retires the tier and does **not** clear the cache, so it fails if
   * `tierToSell` ever goes back to `allTiers()`. The earlier retired-tier case
   * above clears the cache and therefore cannot see this.
   */
  dbIt("does not sell a tier retired seconds ago, cache or no cache", async () => {
    if (!pool) return;
    await pool.query(
      `insert into spideryarn.billing_tiers
         (id, product_name, description, ingests_per_period, lookup_key, stripe_price_id,
          livemode, active, sort_order)
       values ($1, 'A checkout fixture', 'Sold only by tests/billing-checkout.test.ts.',
               20, $2, $3, false, true, 903)
       on conflict (id) do update set active = true`,
      [CACHED_TIER, `${CACHED_TIER}_monthly`, CACHED_PRICE],
    );
    forgetCachedTiers();

    /* Warm whatever cache there is by selling it once, successfully. */
    const first = fakeStripe();
    expect((await startCheckout(OWNER, { tierId: CACHED_TIER }, { stripe: first.stripe })).kind).toBe(
      "checkout",
    );

    /* Now retire it, and say nothing to any cache. */
    await pool.query("update spideryarn.billing_tiers set active = false where id = $1", [
      CACHED_TIER,
    ]);

    const second = fakeStripe();
    await expect(
      startCheckout(OWNER, { tierId: CACHED_TIER }, { stripe: second.stripe }),
    ).rejects.toMatchObject({ status: 400 });
    expect(second.sessionsCreated).toHaveLength(0);
  });

  dbIt("refuses a currency the tier is not priced in", async () => {
    const fake = fakeStripe();
    await expect(
      startCheckout(OWNER, { tierId: "reader", currency: "jpy" }, { stripe: fake.stripe }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fake.sessionsCreated).toHaveLength(0);
  });

  dbIt("passes a currency the tier is priced in", async () => {
    const fake = fakeStripe();
    await startCheckout(OWNER, { tierId: "reader", currency: "gbp" }, { stripe: fake.stripe });
    expect(fake.sessionsCreated[0]?.currency).toBe("gbp");
  });
});

describe("test and live may not cross", () => {
  /**
   * The tier rows here were written by a run of `scripts/stripe-setup.ts` against
   * a **test** key, so `livemode` is false. Claiming to be the production
   * deployment therefore makes the price's mode disagree with the deployment's,
   * which is exactly the shape of a prod deploy left on `sk_test_…`: it would
   * take card `4242…` and grant real quota.
   */
  dbIt("refuses to sell a price from the other side of the divide", async () => {
    process.env.VERCEL_ENV = "production";
    const fake = fakeStripe();

    await expect(
      startCheckout(OWNER, { tierId: "reader" }, { stripe: fake.stripe }),
    ).rejects.toMatchObject({ status: 503, message: expect.stringContaining("[pay-off]") });

    expect(fake.customersCreated).toHaveLength(0);
    expect(fake.sessionsCreated).toHaveLength(0);
  });

  dbIt("refuses a Stripe customer that comes back in the wrong mode", async () => {
    const fake = fakeStripe({ livemode: true });
    await expect(
      startCheckout(OWNER, { tierId: "reader" }, { stripe: fake.stripe }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fake.sessionsCreated).toHaveLength(0);
  });

  /**
   * **The session's own mode, checked separately** — and this case exists in this
   * shape because the first version of it did not test what it said.
   *
   * With no customer mapped, `claimCustomer` runs first and its own
   * `assertLivemode` catches the fake's live-mode customer, so deleting the check
   * on the *session* reddened nothing. Giving the owner a customer already
   * removes that earlier gate and leaves the session's check as the only thing
   * standing. docs/reusable/silent-success.md.
   */
  dbIt("refuses a Checkout Session that comes back in the wrong mode", async () => {
    await givenAccount(OWNER, { customer: "cus_mapped_already" });
    const fake = fakeStripe({ livemode: true });
    await expect(
      startCheckout(OWNER, { tierId: "reader" }, { stripe: fake.stripe }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fake.customersCreated).toHaveLength(0);
    expect(fake.sessionsCreated).toHaveLength(1);
  });

  dbIt("refuses a portal session that comes back in the wrong mode", async () => {
    await givenAccount(OWNER, { customer: "cus_mapped_already" });
    const fake = fakeStripe({ livemode: true });
    await expect(openPortal(OWNER, { stripe: fake.stripe })).rejects.toMatchObject({ status: 503 });
  });

  it("answers 503 rather than 500 when Stripe is not configured at all", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    resetStripeClientForTests();
    /* No injected client: this is the real `stripeClient()` refusing to be
       constructed, which is what a developer with no key would meet. */
    await expect(openPortal(OWNER)).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining("[pay-off]"),
    });
  });
});

/** What an injected sync answers when a case does not care about the sync itself. */
const synced: SyncResult = { kind: "synced", ownerId: "whoever", status: "active" };

/* ------------------------------------------------- when Stripe itself fails -- */

/**
 * **A bad minute at Stripe is a 502 in our words, not a 500 in theirs.**
 *
 * Until 2026-09-03 every Stripe SDK failure escaped untouched, and the
 * dispatcher put the exception's own message in the response body beside a 500
 * (GPT Sol). Two rules broken at once: copy.md's *never the provider's words*,
 * and a status that says this server's arithmetic was wrong when it was not.
 */
describe("a failure at Stripe", () => {
  /** As the SDK raises them: an `Error` whose `type` is a `Stripe…` name. */
  function stripeError(type: string, message: string, statusCode?: number): Error {
    return Object.assign(new Error(message), { type, ...(statusCode ? { statusCode } : {}) });
  }

  dbIt("answers 502 with our own sentence when creating a customer fails", async () => {
    const fake = fakeStripe();
    const failing: StripeCheckout = {
      ...fake.stripe,
      customers: {
        async create() {
          throw stripeError("StripeConnectionError", "An error occurred with our connection to Stripe");
        },
      },
    };
    await expect(
      startCheckout(OWNER, { tierId: "reader" }, { stripe: failing }),
    ).rejects.toMatchObject({ status: 502, message: expect.stringContaining("[pay-down]") });
  });

  dbIt("never puts Stripe's own words on the wire", async () => {
    await givenAccount(OWNER, { customer: "cus_paying" });
    const failing: StripeCheckout = {
      ...fakeStripe().stripe,
      billingPortal: {
        sessions: {
          async create() {
            throw stripeError("StripeAuthenticationError", "Invalid API Key provided: sk_test_***");
          },
        },
      },
    };
    await expect(openPortal(OWNER, { stripe: failing })).rejects.toMatchObject({
      status: 502,
      message: expect.not.stringContaining("API Key"),
    });
  });

  /**
   * **Only a 404 from Stripe means "no such session".** Answering that to a
   * timeout blames the identifier for an outage and hides the outage.
   */
  dbIt("does not turn a Stripe outage into 'no such checkout session'", async () => {
    await givenAccount(OWNER, { customer: "cus_mine" });
    const failing: StripeCheckout = {
      ...fakeStripe().stripe,
      checkout: {
        sessions: {
          async create() {
            throw new Error("not used here");
          },
          async retrieve() {
            throw stripeError("StripeAPIError", "Stripe is having trouble", 500);
          },
        },
      },
    };
    await expect(
      confirmCheckout(OWNER, "cs_test_whatever", { stripe: failing, sync: async () => synced }),
    ).rejects.toMatchObject({ status: 502 });
  });

  dbIt("still answers 404 when Stripe says the session does not exist", async () => {
    await givenAccount(OWNER, { customer: "cus_mine" });
    const failing: StripeCheckout = {
      ...fakeStripe().stripe,
      checkout: {
        sessions: {
          async create() {
            throw new Error("not used here");
          },
          async retrieve() {
            throw stripeError("StripeInvalidRequestError", "No such checkout.session", 404);
          },
        },
      },
    };
    await expect(
      confirmCheckout(OWNER, "cs_test_missing", { stripe: failing, sync: async () => synced }),
    ).rejects.toMatchObject({ status: 404 });
  });

  /**
   * A bug in this file stays a 500 with its stack, which is what gets it
   * reported. Relabelling our own faults as Stripe's would be tidier and wrong.
   */
  dbIt("leaves a fault of ours as a 500", async () => {
    const failing: StripeCheckout = {
      ...fakeStripe().stripe,
      customers: {
        async create() {
          throw new TypeError("undefined is not a function");
        },
      },
    };
    await expect(startCheckout(OWNER, { tierId: "reader" }, { stripe: failing })).rejects.toThrow(
      TypeError,
    );
  });
});

/* ----------------------------------------------------------------- portal -- */

describe("the portal", () => {
  dbIt("refuses an owner who has never subscribed", async () => {
    const fake = fakeStripe();
    await expect(openPortal(OWNER, { stripe: fake.stripe })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("[pay-none]"),
    });
    expect(fake.portalsCreated).toHaveLength(0);
    /* And it did not create a billing row on the way to saying no: a question
       should not write. */
    expect(await accountRow(OWNER)).toBeNull();
  });

  dbIt("refuses an owner with a row but no Stripe customer", async () => {
    /* The shape admission leaves behind — the anchor row, and nothing else. */
    await givenAccount(OWNER, {});
    const fake = fakeStripe();
    await expect(openPortal(OWNER, { stripe: fake.stripe })).rejects.toMatchObject({ status: 409 });
  });

  dbIt("opens a session for an owner who has a customer", async () => {
    await givenAccount(OWNER, { customer: "cus_paying" });
    const fake = fakeStripe();

    const opened = await openPortal(OWNER, { stripe: fake.stripe });

    expect(opened.url).toBe("https://portal.stripe.test/1");
    expect(fake.portalsCreated[0]?.customer).toBe("cus_paying");
    expect(fake.portalsCreated[0]?.return_url).toBe(`${billingReturnOrigin()}/profile`);
  });
});

/* ---------------------------------------------------------------- confirm -- */

describe("the return path from a completed Checkout", () => {
  dbIt("syncs a session that is this reader's", async () => {
    await givenAccount(OWNER, { customer: "cus_mine" });
    const fake = fakeStripe({
      sessions: { cs_test_mine: { client_reference_id: OWNER, customer: "cus_mine" } },
    });
    const asked: string[] = [];

    const result = await confirmCheckout(OWNER, "cs_test_mine", {
      stripe: fake.stripe,
      sync: async (customerId) => {
        asked.push(customerId);
        return synced;
      },
    });

    expect(asked).toEqual(["cus_mine"]);
    expect(result.status).toBe("active");
  });

  /**
   * **The one that matters.** A callback that syncs whatever session id it is
   * handed lets one reader make this server work on another's subscription — and
   * a reply that differed between "no such session" and "not yours" would answer
   * *did that person subscribe?*, which is why both refusals are the same 404.
   */
  dbIt("refuses another owner's session, and does not sync", async () => {
    await givenAccount(OWNER, { customer: "cus_mine" });
    await givenAccount(STRANGER, { customer: "cus_theirs" });
    const fake = fakeStripe({
      sessions: { cs_test_theirs: { client_reference_id: STRANGER, customer: "cus_theirs" } },
    });
    let synchronised = 0;

    await expect(
      confirmCheckout(OWNER, "cs_test_theirs", {
        stripe: fake.stripe,
        sync: async () => {
          synchronised += 1;
          return synced;
        },
      }),
    ).rejects.toMatchObject({ status: 404, message: "No such checkout session" });

    expect(synchronised).toBe(0);
  });

  /**
   * Both fields are checked, so neither alone is enough. This is the half a
   * `||` would have let through: our own `client_reference_id` says the right
   * owner while the customer belongs to somebody else.
   */
  dbIt("refuses a session whose customer is not the one mapped to this owner", async () => {
    await givenAccount(OWNER, { customer: "cus_mine" });
    const fake = fakeStripe({
      sessions: { cs_test_mixed: { client_reference_id: OWNER, customer: "cus_someone_else" } },
    });
    let synchronised = 0;

    await expect(
      confirmCheckout(OWNER, "cs_test_mixed", {
        stripe: fake.stripe,
        sync: async () => {
          synchronised += 1;
          return synced;
        },
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(synchronised).toBe(0);
  });

  /** And the mirror: the right customer under somebody else's reference. */
  dbIt("refuses a session whose client_reference_id is not this owner", async () => {
    await givenAccount(OWNER, { customer: "cus_mine" });
    const fake = fakeStripe({
      sessions: { cs_test_ref: { client_reference_id: STRANGER, customer: "cus_mine" } },
    });
    await expect(
      confirmCheckout(OWNER, "cs_test_ref", { stripe: fake.stripe, sync: async () => synced }),
    ).rejects.toMatchObject({ status: 404 });
  });

  dbIt("does not even ask Stripe when this owner has no customer mapped", async () => {
    const fake = fakeStripe({
      sessions: { cs_test_any: { client_reference_id: OWNER, customer: "cus_x" } },
    });
    await expect(
      confirmCheckout(OWNER, "cs_test_any", { stripe: fake.stripe, sync: async () => synced }),
    ).rejects.toMatchObject({ status: 404 });
    expect(fake.retrieved).toHaveLength(0);
  });

  it("refuses an id that is not a Checkout Session id, without a round trip", async () => {
    const fake = fakeStripe();
    await expect(
      confirmCheckout(OWNER, "sub_1234", { stripe: fake.stripe, sync: async () => synced }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fake.retrieved).toHaveLength(0);
  });
});

/* ------------------------------------------------------------ the origin -- */

describe("where Stripe sends the reader back to", () => {
  it("is the production origin in production, whatever the environment says", () => {
    process.env.VERCEL_ENV = "production";
    process.env.SPIDERYARN_BASE_URL = "https://not-us.example";
    process.env.VERCEL_URL = "preview.vercel.app";
    /* Deliberate: no variable can point a paying customer's return anywhere but
       at us. src/urls.ts § PUBLIC_ORIGIN has the same reasoning. */
    expect(billingReturnOrigin()).toBe("https://www.spideryarn.com");
  });

  it("takes a local override, for a worktree's dev server on 5274", () => {
    process.env.SPIDERYARN_BASE_URL = "http://localhost:5274";
    expect(billingReturnOrigin()).toBe("http://localhost:5274");
  });

  it("ignores an override that is not an http(s) URL", () => {
    process.env.SPIDERYARN_BASE_URL = "javascript:alert(1)";
    expect(billingReturnOrigin()).toBe("http://localhost:5273");
  });

  it("falls back to the preview deployment's own host", () => {
    process.env.VERCEL_URL = "spideryarn-abc123.vercel.app";
    expect(billingReturnOrigin()).toBe("https://spideryarn-abc123.vercel.app");
  });
});

/* -------------------------------------------------------------- the routes -- */

describe("the routes, as the dispatcher serves them", () => {
  it("refuses all three to a caller with no session", async () => {
    for (const path of ["/api/billing/checkout", "/api/billing/portal", "/api/billing/confirm"]) {
      const reply = await postAnonymously(path);
      expect(reply.status, path).toBe(401);
      /* The **code**, not just the status: `[auth-bad]` is a 401 too, and this
         case is about the branch where there is no header at all. */
      expect(String(reply.body.error), path).toContain("[auth-none]");
    }
  });

  it("has no GET on any of them", async () => {
    for (const path of ["/api/billing/checkout", "/api/billing/portal", "/api/billing/confirm"]) {
      const reply = await get(path);
      expect(reply.status, path).toBe(404);
    }
  });

  it("leaves sibling billing paths unrouted", async () => {
    for (const path of ["/api/billing", "/api/billing/checkout/", "/api/billing/anything"]) {
      const reply = await post(path, {});
      expect(reply.status, path).toBe(404);
    }
  });

  dbIt("turns a body that names a price into a 400", async () => {
    const reply = await post("/api/billing/checkout", {
      tierId: "reader",
      priceId: "price_someone_elses",
    });
    expect(reply.status).toBe(400);
    expect(String(reply.body.error)).toContain("decided by the server");
  });

  it("wants a session id at the confirm route", async () => {
    const reply = await post("/api/billing/confirm", {});
    expect(reply.status).toBe(400);
    expect(String(reply.body.error)).toContain("sessionId");
  });

  dbIt("answers the portal route with the reader's own refusal", async () => {
    const reply = await post("/api/billing/portal", {});
    expect(reply.status).toBe(409);
    expect(String(reply.body.error)).toContain("[pay-none]");
  });
});

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

async function post(url: string, body: unknown): Promise<Reply> {
  return await drive("POST", url, JSON.stringify(body), asOwner, HEADERS);
}

/**
 * The same POST with **no verifier and no `Authorization` header at all**.
 *
 * Its own function rather than a third argument on `post`, and that is not
 * tidiness: a default parameter is used for an explicitly-passed `undefined`
 * too, so `post(path, {}, undefined)` quietly ran as this file's signed-in owner
 * and the "refuses a caller with no session" case passed a 400 through as though
 * it were a 401.
 *
 * **And dropping the verifier was not enough on its own.** The first version of
 * this still sent `Authorization: Bearer test-token`, so it exercised
 * `requireUser`'s *invalid token* branch (`[auth-bad]`) rather than its
 * *no header* branch — both 401, so the assertion could not tell, and deleting
 * `[auth-none]` would have left it green. GPT Sol, 2026-09-03. The header is now
 * absent and the code is asserted.
 */
async function postAnonymously(url: string): Promise<Reply> {
  return await drive("POST", url, "{}", undefined, {});
}

async function get(url: string): Promise<Reply> {
  return await drive("GET", url, "", asOwner, HEADERS);
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
