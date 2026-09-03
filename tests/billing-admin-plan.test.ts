/**
 * **The plan and ingest columns on `/admin/users`** — the arithmetic, without a
 * database.
 *
 * `mergeUsers` is the pure half of src/store/pg-admin.ts (its header says why
 * the file is in three parts), so everything the two new columns draw can be
 * asserted from fixtures. What is worth asserting is not "it copies the fields"
 * but the three ways the column could be quietly wrong:
 *
 * - **it must decide entitlement the way the wall does.** A row this page draws
 *   as *reader, 4 of 20* has to be a row `reserveIngest` would admit, and one it
 *   draws as free has to be one refused at three. Both call
 *   `entitlementFromRow`, and these cases are what stops the admin page growing
 *   a second opinion — most visibly on `past_due`, which is **entitled on
 *   purpose** and looks exactly like a status that should not be.
 * - **it must pick the right window.** A paid account counts inside its billing
 *   period and a free one counts for ever, so counting a paid reader's whole
 *   history would show them permanently over their allowance.
 * - **an absent `billing_accounts` row is the ordinary case**, not an edge: a
 *   free reader has none until they check out or hit the wall.
 *
 * The lapsed row is the interesting one to look at rather than the one to worry
 * about: `plan: "free"` beside `planStatus: "canceled"` is precisely what an
 * administrator reading a support email needs, and it is why the status is its
 * own field rather than being folded into the plan.
 */
import { describe, expect, it } from "vitest";

import type { AdminUser } from "../src/admin.js";
import type { TierRow } from "../src/billing/tiers.js";
import { mergeUsers, type AccountRow, type UserCounts } from "../src/store/pg-admin.js";
import type { AccountSnapshot } from "../src/store/pg-billing.js";

/** This file's own owner. Nothing is inserted anywhere; it is a map key. */
const OWNER = "000000be-0000-4000-8000-000000000001";

const READER: TierRow = {
  id: "reader",
  productName: "Spideryarn Reader",
  description: "Twenty articles a month.",
  ingestsPerPeriod: 20,
  lookupKey: "spideryarn_reader_monthly",
  stripePriceId: "price_reader_fixture",
  livemode: false,
  active: true,
  sortOrder: 10,
  amounts: { usd: 1000, gbp: 800, eur: 900 },
};

/**
 * A retired tier, still honoured.
 *
 * `active` decides what may be *sold*; somebody already subscribed to a retired
 * tier keeps their allowance until they cancel, which is the whole reason
 * retiring is a flag rather than a delete. The admin page has to show that.
 */
const RETIRED: TierRow = {
  ...READER,
  id: "legacy",
  productName: "Spideryarn Legacy",
  ingestsPerPeriod: 100,
  lookupKey: "spideryarn_legacy_monthly",
  stripePriceId: "price_legacy_fixture",
  active: false,
  sortOrder: 5,
};

const TIERS = [RETIRED, READER];

function account(id: string, email: string): AccountRow {
  return {
    id,
    email,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    lastSignInAt: null,
    emailConfirmedAt: new Date("2026-08-01T00:00:00.000Z"),
    providers: ["email"],
  };
}

/** A `billing_accounts` row, as the webhook's sync would have written it. */
function row(fields: Partial<AccountSnapshot>): AccountSnapshot {
  return {
    status: null,
    priceId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    ...fields,
  };
}

/** A period that contains now, so an entitled status is not stale. */
function live(): { start: Date; end: Date } {
  const now = Date.now();
  return { start: new Date(now - 5 * 86_400_000), end: new Date(now + 25 * 86_400_000) };
}

/** One owner through the merge, with only the billing inputs that matter. */
function merged(options: {
  account?: AccountSnapshot;
  lifetime?: number;
  inPeriod?: number;
  inFlight?: number;
}): AdminUser {
  const counts: UserCounts = {
    shelf: [],
    uploads: [],
    questions: [],
    chats: [],
    searches: [],
    spend: new Map(),
    spendMonth: "2026-09",
    ingests: [
      {
        owner: OWNER,
        lifetime: options.lifetime ?? 0,
        inPeriod: options.inPeriod ?? 0,
        inFlight: options.inFlight ?? 0,
      },
    ],
    accounts: options.account ? new Map([[OWNER, options.account]]) : new Map(),
    tiers: TIERS,
  };
  const [only] = mergeUsers([account(OWNER, "reader@example.test")], counts);
  if (!only) throw new Error("the merge dropped the one account it was given");
  return only;
}

describe("an owner with no subscription", () => {
  it("is on the free tier, counted over the account's lifetime", () => {
    expect(merged({ lifetime: 2, inPeriod: 99 })).toMatchObject({
      plan: "free",
      ingests: 2,
      ingestLimit: 3,
      ingestWindow: "lifetime",
    });
    /* `inPeriod: 99` is deliberate nonsense: there is no period, so a version
       that read the wrong column would show 99 rather than 2. */
  });

  it("has no status at all, rather than an empty one", () => {
    /* `exactOptionalPropertyTypes` is on, so an absent field is a shorter
       object on the wire — and the column draws nothing rather than a blank
       line under the plan. */
    expect(merged({}).planStatus).toBeUndefined();
  });

  it("counts an unsettled reservation as used, exactly as the wall does", () => {
    /* A slot somebody is spending. A page that showed only settled successes
       would say a free reader had room the server would refuse them. */
    expect(merged({ lifetime: 2, inFlight: 1 })).toMatchObject({ ingests: 3 });
  });
});

describe("an owner with a subscription", () => {
  const period = live();

  it("is on their tier, counted inside their billing period", () => {
    const user = merged({
      account: row({
        status: "active",
        priceId: READER.stripePriceId,
        stripeCustomerId: "cus_x",
        stripeSubscriptionId: "sub_x",
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
      }),
      lifetime: 61,
      inPeriod: 4,
    });
    expect(user).toMatchObject({
      plan: "reader",
      planStatus: "active",
      ingests: 4,
      ingestLimit: 20,
      ingestWindow: "period",
    });
    /* The lifetime figure is the one that would make a paying reader look
       permanently over their allowance, so it must not be what is shown. */
    expect(user.ingests).not.toBe(61);
  });

  it("keeps a retired tier's allowance, because retiring is about selling", () => {
    expect(
      merged({
        account: row({
          status: "active",
          priceId: RETIRED.stripePriceId,
          stripeCustomerId: "cus_x",
          stripeSubscriptionId: "sub_x",
          currentPeriodStart: period.start,
          currentPeriodEnd: period.end,
        }),
        inPeriod: 7,
      }),
    ).toMatchObject({ plan: "legacy", ingestLimit: 100, ingestWindow: "period" });
  });

  it("treats past_due as entitled, because it is", () => {
    /* The status that most looks like it should not be. A card that failed once
       is a customer Stripe is still dunning; cutting them off on the first retry
       is a worse experience than the few pounds it saves, and dunning is
       configured so `past_due` eventually becomes `canceled` or `unpaid`, which
       are not entitled. An admin page that showed them as free would send
       somebody to "fix" a thing that is working as designed. */
    expect(
      merged({
        account: row({
          status: "past_due",
          priceId: READER.stripePriceId,
          stripeCustomerId: "cus_x",
          stripeSubscriptionId: "sub_x",
          currentPeriodStart: period.start,
          currentPeriodEnd: period.end,
        }),
        inPeriod: 1,
      }),
    ).toMatchObject({ plan: "reader", planStatus: "past_due", ingestLimit: 20 });
  });

  it("shows a lapsed subscriber as free, with the status that says why", () => {
    const user = merged({
      account: row({
        status: "canceled",
        priceId: READER.stripePriceId,
        stripeCustomerId: "cus_x",
        stripeSubscriptionId: "sub_x",
      }),
      lifetime: 40,
    });
    /* The pair an administrator reads as "this is the support email I am
       holding": free allowance, forty articles, and the reason in one word. */
    expect(user).toMatchObject({
      plan: "free",
      planStatus: "canceled",
      ingests: 40,
      ingestLimit: 3,
      ingestWindow: "lifetime",
    });
  });

  it("falls to free for a price no tier sells", () => {
    /* An old price on a grandfathered subscription, or one somebody made by hand
       in the dashboard. Free is the direction that costs a customer an email
       rather than costing us an unbounded bill — the same way
       `entitlementFromRow` fails. */
    expect(
      merged({
        account: row({
          status: "active",
          priceId: "price_nobody_costed",
          stripeCustomerId: "cus_x",
          stripeSubscriptionId: "sub_x",
          currentPeriodStart: period.start,
          currentPeriodEnd: period.end,
        }),
        lifetime: 5,
        inPeriod: 5,
      }),
    ).toMatchObject({ plan: "free", ingestLimit: 3, ingestWindow: "lifetime" });
  });

  it("marks the window `stale`, rather than passing off two spans as one", () => {
    /* `entitlementFromRow` answers `stale` here, so there is no current period
       to count inside and `inPeriod` would be a count over a window that has
       closed. The tier's limit is still the right scale — that is what they are
       paying for — but the count is now a *lifetime* one against a *monthly*
       limit, and `61 / 20` labelled `lifetime` is two questions in one fraction.
       `stale` is its own window so the cell can say so; `active` in the status
       column beside it cannot, because that is the status of dates we could not
       read. GPT Sol, 2026-09-03. */
    const long = 400 * 86_400_000;
    expect(
      merged({
        account: row({
          status: "active",
          priceId: READER.stripePriceId,
          stripeCustomerId: "cus_x",
          stripeSubscriptionId: "sub_x",
          currentPeriodStart: new Date(Date.now() - long),
          currentPeriodEnd: new Date(Date.now() - long + 30 * 86_400_000),
        }),
        lifetime: 9,
        inPeriod: 0,
      }),
    ).toMatchObject({
      plan: "reader",
      planStatus: "active",
      ingests: 9,
      ingestLimit: 20,
      ingestWindow: "stale",
    });
  });
});
