/**
 * Reading a Stripe subscription, and refusing to guess.
 *
 * Two things are being pinned. The first is the **Basil move**: the billing
 * period lives on the subscription *item*, and code written against the old
 * shape reads `undefined` rather than failing — so the quota window silently
 * becomes wrong. The second is that everything unrecognised falls to *free*,
 * because the other direction hands out a hundred ingests a month for a price
 * nobody costed, and does it quietly.
 *
 * Fixtures rather than a Stripe account: these are decisions about money and
 * they should be testable without one. See src/billing/subscription.ts.
 */
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { chooseSubscription, readSubscription } from "../src/billing/subscription.js";
import { isEntitledStatus } from "../src/billing/tiers.js";

const SEPT = Math.floor(Date.parse("2026-09-01T00:00:00Z") / 1000);
const OCT = Math.floor(Date.parse("2026-10-01T00:00:00Z") / 1000);

/** A subscription of the shape the pinned API version returns. */
function subscription(over: {
  id?: string;
  status?: string;
  cancelAtPeriodEnd?: boolean;
  livemode?: boolean;
  items?: unknown[];
} = {}): Stripe.Subscription {
  return {
    id: over.id ?? "sub_1",
    object: "subscription",
    status: over.status ?? "active",
    cancel_at_period_end: over.cancelAtPeriodEnd ?? false,
    livemode: over.livemode ?? false,
    items: { object: "list", data: over.items ?? [item()] },
  } as unknown as Stripe.Subscription;
}

function item(over: {
  quantity?: number | null;
  priceId?: string;
  type?: string;
  interval?: string;
  intervalCount?: number;
  start?: number | null;
  end?: number | null;
  price?: unknown;
} = {}): unknown {
  return {
    id: "si_1",
    object: "subscription_item",
    quantity: over.quantity === undefined ? 1 : over.quantity,
    current_period_start: over.start === undefined ? SEPT : over.start,
    current_period_end: over.end === undefined ? OCT : over.end,
    price:
      over.price !== undefined
        ? over.price
        : {
            id: over.priceId ?? "price_reader",
            object: "price",
            type: over.type ?? "recurring",
            recurring:
              (over.type ?? "recurring") === "recurring"
                ? { interval: over.interval ?? "month", interval_count: over.intervalCount ?? 1 }
                : null,
          },
  };
}

describe("the billing period comes from the item", () => {
  it("reads a well-formed monthly subscription", () => {
    const reading = readSubscription(subscription());
    expect(reading).toEqual({
      kind: "understood",
      state: {
        subscriptionId: "sub_1",
        priceId: "price_reader",
        status: "active",
        currentPeriodStart: new Date("2026-09-01T00:00:00Z"),
        currentPeriodEnd: new Date("2026-10-01T00:00:00Z"),
        cancelAtPeriodEnd: false,
        livemode: false,
      },
    });
  });

  /**
   * **The regression this file exists for.** Before Basil these fields were on
   * the Subscription; a reader still looking there finds nothing. The failure
   * to prevent is not a crash — it is storing an absent period and metering
   * against it, which reads as "no ingests used" for ever.
   */
  it("refuses, rather than storing nothing, when the item has no period", () => {
    const reading = readSubscription(subscription({ items: [item({ start: null, end: null })] }));
    expect(reading.kind).toBe("unsupported");
    /* And it says where to look, because the fields have moved once already. */
    if (reading.kind === "unsupported") {
      expect(reading.why).toMatch(/STRIPE_API_VERSION/);
    }
  });

  it("is not fooled by the period sitting on the subscription instead", () => {
    const wrongShape = {
      ...subscription({ items: [item({ start: null, end: null })] }),
      current_period_start: SEPT,
      current_period_end: OCT,
    } as unknown as Stripe.Subscription;
    expect(readSubscription(wrongShape).kind).toBe("unsupported");
  });

  it("refuses a period that ends before it starts", () => {
    expect(readSubscription(subscription({ items: [item({ start: OCT, end: SEPT })] }))).toEqual({
      kind: "unsupported",
      why: "the billing period ends before it starts",
    });
  });
});

describe("everything unrecognised falls to free", () => {
  it("refuses two items", () => {
    const reading = readSubscription(subscription({ items: [item(), item()] }));
    expect(reading).toMatchObject({ kind: "unsupported", why: /exactly one subscription item/ });
  });

  it("refuses no items", () => {
    expect(readSubscription(subscription({ items: [] })).kind).toBe("unsupported");
  });

  it("refuses a quantity above one, and accepts an absent quantity as one", () => {
    expect(readSubscription(subscription({ items: [item({ quantity: 7 })] }))).toMatchObject({
      kind: "unsupported",
      why: /quantity of 1, found 7/,
    });
    /* Absent means one in Stripe's API, and treating it as zero or as unknown
       would refuse a perfectly ordinary subscription. */
    expect(readSubscription(subscription({ items: [item({ quantity: null })] })).kind).toBe(
      "understood",
    );
  });

  it("refuses a one-off price", () => {
    expect(
      readSubscription(subscription({ items: [item({ type: "one_time" })] })),
    ).toMatchObject({ kind: "unsupported", why: /not a recurring price/ });
  });

  it("refuses a yearly price, and a price that renews every three months", () => {
    expect(readSubscription(subscription({ items: [item({ interval: "year" })] }))).toMatchObject({
      kind: "unsupported",
      why: /not monthly/,
    });
    expect(
      readSubscription(subscription({ items: [item({ intervalCount: 3 })] })),
    ).toMatchObject({ kind: "unsupported", why: /every 3 month/ });
  });

  it("refuses an item with no price at all", () => {
    expect(readSubscription(subscription({ items: [item({ price: null })] }))).toMatchObject({
      kind: "unsupported",
      why: /no price/,
    });
  });

  /* The status is passed straight through as raw text — the allowlist in
     tiers.ts decides what it means, so a status Stripe invents next year
     reaches the database rather than failing an insert inside a webhook. */
  it("passes an unfamiliar status through rather than refusing on it", () => {
    const reading = readSubscription(subscription({ status: "something_new" }));
    expect(reading).toMatchObject({ kind: "understood", state: { status: "something_new" } });
  });
});

describe("choosing among a customer's subscriptions", () => {
  it("keeps the mapping and stores nothing when there are none", () => {
    expect(chooseSubscription([], isEntitledStatus)).toEqual({
      state: null,
      notes: [],
      anomaly: false,
    });
  });

  it("takes the one live subscription", () => {
    const chosen = chooseSubscription([subscription({ id: "sub_live" })], isEntitledStatus);
    expect(chosen.state?.subscriptionId).toBe("sub_live");
    expect(chosen.anomaly).toBe(false);
  });

  /**
   * A cancelled subscription is still worth storing: `/profile` saying "your
   * subscription ended on the 3rd" is a different thing from an account that
   * looks as though it never subscribed.
   */
  it("stores a cancelled subscription so we can say what happened", () => {
    const chosen = chooseSubscription(
      [subscription({ id: "sub_gone", status: "canceled" })],
      isEntitledStatus,
    );
    expect(chosen.state?.status).toBe("canceled");
    expect(chosen.anomaly).toBe(false);
  });

  /**
   * Two live subscriptions means somebody may be paying twice. Refusing to
   * choose would drop a paying customer to free, so it chooses — but never
   * quietly, and never by list order.
   */
  it("flags two live subscriptions and takes the most recent period", () => {
    const older = subscription({ id: "sub_old", items: [item({ start: SEPT - 86400 * 60 })] });
    const newer = subscription({ id: "sub_new" });
    const chosen = chooseSubscription([older, newer], isEntitledStatus);
    expect(chosen.state?.subscriptionId).toBe("sub_new");
    expect(chosen.anomaly).toBe(true);
    expect(chosen.notes.join(" ")).toMatch(/2 live subscriptions/);

    /* And the same answer whichever order Stripe listed them in — the rule
       reads the data rather than trusting the array. */
    const reversed = chooseSubscription([newer, older], isEntitledStatus);
    expect(reversed.state?.subscriptionId).toBe("sub_new");
  });

  it("does not call one live subscription an anomaly just because a dead one exists", () => {
    const chosen = chooseSubscription(
      [subscription({ id: "sub_dead", status: "canceled" }), subscription({ id: "sub_live" })],
      isEntitledStatus,
    );
    expect(chosen.state?.subscriptionId).toBe("sub_live");
    expect(chosen.anomaly).toBe(false);
  });

  it("notes each subscription it could not read, rather than dropping it silently", () => {
    const chosen = chooseSubscription(
      [subscription({ id: "sub_weird", items: [item(), item()] }), subscription({ id: "sub_ok" })],
      isEntitledStatus,
    );
    expect(chosen.state?.subscriptionId).toBe("sub_ok");
    expect(chosen.notes.join(" ")).toContain("sub_weird");
  });

  it("falls to free when every subscription is unreadable", () => {
    const chosen = chooseSubscription(
      [subscription({ id: "sub_a", items: [] }), subscription({ id: "sub_b", items: [] })],
      isEntitledStatus,
    );
    expect(chosen.state).toBeNull();
    expect(chosen.notes).toHaveLength(2);
  });
});
