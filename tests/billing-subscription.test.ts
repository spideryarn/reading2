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

import type { ChoiceRules } from "../src/billing/subscription.js";
import { chooseSubscription, readSubscription } from "../src/billing/subscription.js";
import { isEntitledStatus, isTerminalStatus } from "../src/billing/tiers.js";

const SEPT = Math.floor(Date.parse("2026-09-01T00:00:00Z") / 1000);
const OCT = Math.floor(Date.parse("2026-10-01T00:00:00Z") / 1000);

/** A subscription of the shape the pinned API version returns. */
function subscription(over: {
  id?: string;
  status?: string;
  cancelAtPeriodEnd?: boolean;
  /** Unix seconds, as Stripe sends it. When the subscription is to end. */
  cancelAt?: number | null;
  /** Unix seconds. When somebody pressed cancel — never when it ends. */
  canceledAt?: number | null;
  livemode?: boolean;
  items?: unknown[];
} = {}): Stripe.Subscription {
  return {
    id: over.id ?? "sub_1",
    object: "subscription",
    status: over.status ?? "active",
    cancel_at_period_end: over.cancelAtPeriodEnd ?? false,
    cancel_at: over.cancelAt ?? null,
    canceled_at: over.canceledAt ?? null,
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
        cancelAt: null,
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

/**
 * **The second field whose meaning drifted under a pinned API version**, and the
 * one that cost a live cancellation nobody was told about.
 *
 * Greg cancelled the first real subscription through the Customer Portal on
 * 2026-09-03. Stripe did **not** set `cancel_at_period_end`; it set a
 * `cancel_at` timestamp and left the boolean alone. Every fixture in this file
 * had been written from the same assumption the code was — that the boolean is
 * how Stripe says it — so the suite was green over a bug that was live.
 *
 * The payload below is the real one, transcribed from
 * docs/project/billing.md § *The first live sale*. A fixture that sets the
 * boolean tests the code we already had.
 */
describe("a cancellation Stripe expresses as a timestamp", () => {
  /* 2026-10-03, the period end — and 2026-09-03, when he pressed cancel. */
  const CANCEL_AT = 1791027429;
  const CANCELED_AT = 1788435966;

  /** The shape of the live subscription, and the whole of the regression. */
  const portalCancelled = () =>
    subscription({
      id: "sub_1UBYxALv4piDbwcbVew6jxqN",
      status: "active",
      cancelAt: CANCEL_AT,
      canceledAt: CANCELED_AT,
      cancelAtPeriodEnd: false,
    });

  it("reads the date it ends, not just the boolean that stayed false", () => {
    const reading = readSubscription(portalCancelled());
    expect(reading.kind).toBe("understood");
    if (reading.kind !== "understood") return;
    /* The fact the reader is owed: *when*. A boolean cannot say it. */
    expect(reading.state.cancelAt).toEqual(new Date(CANCEL_AT * 1000));
    /* And the raw boolean is still reported as Stripe sent it, rather than
       being quietly widened here — deriving one answer from the two is the
       caller's job, done in exactly one place (`planEndsAt`). */
    expect(reading.state.cancelAtPeriodEnd).toBe(false);
  });

  /**
   * **Entitlement must not move**, and this is the half of it `readSubscription`
   * owns. `active` is what Stripe says until the period actually ends, and it is
   * what we grant until then; the pin against the wall itself is in
   * tests/billing-usage-route.test.ts.
   */
  it("leaves the status alone, so a cancelled subscriber keeps what they paid for", () => {
    const reading = readSubscription(portalCancelled());
    expect(reading).toMatchObject({
      kind: "understood",
      state: { status: "active", currentPeriodEnd: new Date("2026-10-01T00:00:00Z") },
    });
  });

  /* The other direction, so the case above cannot pass by reading any date at
     all: an ordinary subscription carries no ending. */
  it("carries no ending for a subscription nobody has cancelled", () => {
    const reading = readSubscription(subscription());
    expect(reading).toMatchObject({ kind: "understood", state: { cancelAt: null } });
  });

  /**
   * `canceled_at` is *when somebody pressed cancel*, which for a period-end
   * cancellation is in the past while the plan is still running. Reading it as
   * an ending would tell a paid-up reader their plan ended last Tuesday.
   */
  it("does not mistake `canceled_at` for the ending", () => {
    const reading = readSubscription(
      subscription({ cancelAt: null, canceledAt: CANCELED_AT }),
    );
    expect(reading).toMatchObject({ kind: "understood", state: { cancelAt: null } });
  });

  /* The boolean still works on its own, because Stripe sets it on subscriptions
     cancelled through the API rather than the Portal. Both are raw facts and
     both are stored. */
  it("still reads the old boolean, which has not stopped meaning anything", () => {
    const reading = readSubscription(subscription({ cancelAtPeriodEnd: true }));
    expect(reading).toMatchObject({
      kind: "understood",
      state: { cancelAtPeriodEnd: true, cancelAt: null },
    });
  });
});

/**
 * **The instant every period test below is made against.** `now` is passed into
 * `chooseSubscription` rather than read off the clock, so these fixtures do not
 * quietly change meaning on 1 October — which is what would have happened to the
 * default SEPT..OCT period a fortnight after it was written.
 */
const NOW = new Date("2026-09-15T00:00:00Z");

/** What the two tiers sell, as `billing_tiers` would answer it. */
const ALLOWANCES: Record<string, number> = { price_reader: 20, price_researcher: 150 };

/** The tier-table and clock questions `chooseSubscription` asks, with the real answers. */
function rules(over: Partial<ChoiceRules> = {}): ChoiceRules {
  return {
    entitled: isEntitledStatus,
    terminal: isTerminalStatus,
    allowanceFor: (priceId: string) => ALLOWANCES[priceId] ?? null,
    now: NOW,
    ...over,
  };
}

describe("choosing among a customer's subscriptions", () => {
  it("keeps the mapping and stores nothing when there are none", () => {
    expect(chooseSubscription([], rules())).toEqual({
      state: null,
      notes: [],
      anomaly: false,
    });
  });

  it("takes the one live subscription", () => {
    const chosen = chooseSubscription([subscription({ id: "sub_live" })], rules());
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
      rules(),
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
    /* Same tier both times, so the allowance cannot separate them and the
       tie-break — later period start — is what is under test. */
    const older = subscription({ id: "sub_old", items: [item({ start: SEPT - 86400 * 60 })] });
    const newer = subscription({ id: "sub_new" });
    const chosen = chooseSubscription([older, newer], rules());
    expect(chosen.state?.subscriptionId).toBe("sub_new");
    expect(chosen.anomaly).toBe(true);
    expect(chosen.notes.join(" ")).toMatch(/2 subscriptions Stripe may still collect on/);

    /* And the same answer whichever order Stripe listed them in — the rule
       reads the data rather than trusting the array. */
    const reversed = chooseSubscription([newer, older], rules());
    expect(reversed.state?.subscriptionId).toBe("sub_new");
  });

  it("does not call one live subscription an anomaly just because a dead one exists", () => {
    const chosen = chooseSubscription(
      [subscription({ id: "sub_dead", status: "canceled" }), subscription({ id: "sub_live" })],
      rules(),
    );
    expect(chosen.state?.subscriptionId).toBe("sub_live");
    expect(chosen.anomaly).toBe(false);
  });

  it("notes each subscription it could not read, rather than dropping it silently", () => {
    const chosen = chooseSubscription(
      [subscription({ id: "sub_weird", items: [item(), item()] }), subscription({ id: "sub_ok" })],
      rules(),
    );
    expect(chosen.state?.subscriptionId).toBe("sub_ok");
    expect(chosen.notes.join(" ")).toContain("sub_weird");
    /* And it still counts towards the anomaly: a shape we cannot read is not a
       reason to believe nobody is being charged for it. */
    expect(chosen.anomaly).toBe(true);
  });

  it("falls to free when every subscription is unreadable", () => {
    const chosen = chooseSubscription(
      [subscription({ id: "sub_a", items: [] }), subscription({ id: "sub_b", items: [] })],
      rules(),
    );
    expect(chosen.state).toBeNull();
    expect(chosen.notes).toHaveLength(3);
    expect(chosen.anomaly).toBe(true);
  });
});

/**
 * **Which of two subscriptions the reader is metered on.**
 *
 * Holding two at once is an accident the checkout gate leaves open on purpose
 * (docs/project/billing.md § *Subscribing twice*). When it happens the reader is
 * paying for both, so the allowance should be the larger of the two — the cost
 * of the accident belongs with us. But only among subscriptions whose period
 * contains now, because an expired-but-still-`active` one would otherwise win
 * for ever and lock the account out at 503 rather than merely under-serving it.
 */
describe("the strongest current subscription wins", () => {
  /** Unix seconds, `days` from NOW. */
  const day = (days: number) => Math.floor(NOW.getTime() / 1000) + days * 86400;

  /** Current: a period containing NOW. */
  const researcher = () =>
    subscription({
      id: "sub_researcher",
      items: [item({ priceId: "price_researcher", start: day(-10), end: day(20) })],
    });
  const reader = () =>
    subscription({
      id: "sub_reader",
      items: [item({ priceId: "price_reader", start: day(-9), end: day(21) })],
    });

  it("meters a reader who holds both tiers on the researcher's allowance", () => {
    /* The Reader was bought *second* — a second Checkout tab, completed after
       the Researcher one — so the old newest-first rule handed them 20. */
    const chosen = chooseSubscription([researcher(), reader()], rules());
    expect(chosen.state?.priceId).toBe("price_researcher");
    expect(chosen.anomaly).toBe(true);
  });

  it("gives the same answer whichever order Stripe listed them in", () => {
    expect(chooseSubscription([reader(), researcher()], rules()).state?.priceId).toBe(
      "price_researcher",
    );
  });

  /**
   * **The case that breaks *both* rules — the one this replaced and the naive
   * fix that nearly replaced it** — and the reason the period test comes before
   * the ranking.
   *
   * A subscription whose invoice cannot be *finalised* stays `active` with a
   * period that has ended: it never enters dunning. Ranked on allowance alone it
   * beats a current Reader for ever; `entitlementFromRow` then calls the stored
   * row stale, admission resyncs, this function picks the same row again, and the
   * reader is refused at 503 instead of getting the 20 they pay for.
   *
   * **And a stale subscription can have started *later* than the current one**,
   * which is why `newest()` was not quietly getting this right either. Stripe's
   * own shape, from GPT Sol, 2026-09-03: a Reader runs the 1st to the 1st; a
   * Researcher bought on the 20th with a billing anchor on the 25th gets a short
   * initial period, the 20th to the 25th. If that first invoice cannot be
   * finalised it goes stale on the 25th — with a period start five days *newer*
   * than the Reader's. The days below are that scenario, relative to NOW.
   */
  it("will not let a stale active researcher beat a current reader", () => {
    /* The short initial period: started after the reader's, already over. */
    const staleAndNewer = subscription({
      id: "sub_stale_researcher",
      status: "active",
      items: [item({ priceId: "price_researcher", start: day(-8), end: day(-3) })],
    });
    const chosen = chooseSubscription([staleAndNewer, reader()], rules());
    expect(chosen.state?.subscriptionId).toBe("sub_reader");
    expect(chosen.state?.priceId).toBe("price_reader");

    /* And the ordinary lapsed one, which only the ranking could have picked. */
    const staleAndOlder = subscription({
      id: "sub_stale_researcher",
      status: "active",
      items: [item({ priceId: "price_researcher", start: day(-70), end: day(-40) })],
    });
    expect(chooseSubscription([staleAndOlder, reader()], rules()).state?.subscriptionId).toBe(
      "sub_reader",
    );
  });

  /**
   * The other half of that: a price no tier sells cannot win however new it is.
   * Without this filter an active Reader beside a newer subscription on some
   * hand-made price lost, and `tierForPrice` then returned null for the winner —
   * dropping a paying customer to free. GPT Sol, 2026-09-02.
   */
  it("will not let a price no tier sells beat one that a tier does", () => {
    const mystery = subscription({
      id: "sub_mystery",
      items: [item({ priceId: "price_handmade", start: day(-1), end: day(29) })],
    });
    const chosen = chooseSubscription([mystery, reader()], rules());
    expect(chosen.state?.subscriptionId).toBe("sub_reader");

    /* And when the unrecognised one is *all* there is, it is stored with a note
       rather than ranked — the row is diagnostic, and `entitlementFromRow` will
       find no tier for the price and fall to free. */
    const alone = chooseSubscription([mystery], rules());
    expect(alone.state?.subscriptionId).toBe("sub_mystery");
    expect(alone.notes.join(" ")).toMatch(/no.*price this build sells/);
  });

  /**
   * **The period is half-open, `start <= now < end`** — the same interval
   * `entitlementFromRow` (src/store/pg-billing.ts) calls stale, and the same one
   * the usage query counts by. Three rules that must agree about the instant a
   * period rolls over, or an ingest is counted twice, or a subscription is
   * current here and stale there.
   */
  it("treats the period as half-open, at both ends", () => {
    const startsNow = subscription({
      id: "sub_starts_now",
      items: [item({ priceId: "price_reader", start: day(0), end: day(30) })],
    });
    const endsNow = subscription({
      id: "sub_ends_now",
      items: [item({ priceId: "price_researcher", start: day(-30), end: day(0) })],
    });
    /* The researcher's larger allowance would win if `end` were inclusive. */
    const chosen = chooseSubscription([endsNow, startsNow], rules());
    expect(chosen.state?.subscriptionId).toBe("sub_starts_now");

    /* And the one that ends at this instant is not current on its own either. */
    const alone = chooseSubscription([endsNow], rules());
    expect(alone.notes.join(" ")).toMatch(/period containing/);
  });

  /**
   * **The ranking key is deliberately mutable, and this is the pin that says
   * so.** `billing_tiers.ingests_per_period` is a column somebody can `UPDATE`,
   * so an edit to the tier table changes which subscription a double-subscribed
   * reader is metered on. Accepted rather than overlooked — the reasoning, and
   * the rejection of `sort_order` as an alternative, is in the header of
   * src/billing/subscription.ts. If this test ever has to change, that decision
   * is being reversed.
   */
  it("follows the allowance table when it changes, rather than the tier's name", () => {
    /* The reader subscription is the *older* of the two here, so nothing but
       the allowance can make it win. */
    const olderReader = subscription({
      id: "sub_reader",
      items: [item({ priceId: "price_reader", start: day(-20), end: day(10) })],
    });
    const newerResearcher = subscription({
      id: "sub_researcher",
      items: [item({ priceId: "price_researcher", start: day(-1), end: day(29) })],
    });
    expect(chooseSubscription([olderReader, newerResearcher], rules()).state?.priceId).toBe(
      "price_researcher",
    );

    const swapped = rules({
      allowanceFor: (priceId: string) =>
        ({ price_reader: 200, price_researcher: 150 })[priceId] ?? null,
    });
    const chosen = chooseSubscription([olderReader, newerResearcher], swapped);
    expect(chosen.state?.priceId).toBe("price_reader");
  });

  /**
   * **Diagnosis, not entitlement.** When nothing has a current period there is
   * no good answer, and the least-bad one is a row `/profile` can talk about.
   * The note is the only thing that says the stored row entitles nothing.
   */
  it("stores the most recent when nothing has a period containing now, and says so", () => {
    const stale = subscription({
      id: "sub_stale",
      status: "active",
      items: [item({ priceId: "price_reader", start: day(-70), end: day(-40) })],
    });
    const chosen = chooseSubscription([stale], rules());
    expect(chosen.state?.subscriptionId).toBe("sub_stale");
    expect(chosen.notes.join(" ")).toMatch(/period containing 2026-09-15/);
    expect(chosen.notes.join(" ")).toMatch(/entitles nothing/);
    expect(chosen.anomaly).toBe(false);
  });

  /**
   * **The anomaly counts what checkout would have refused to sell beside**, not
   * what we entitle. `unpaid` carries no entitlement, but Stripe has not
   * finished with it either: this is two collectable invoices, and counting only
   * the entitled ones said nothing at all about it.
   */
  it("counts an unpaid subscription beside an active one as an anomaly", () => {
    const chosen = chooseSubscription(
      [subscription({ id: "sub_active" }), subscription({ id: "sub_unpaid", status: "unpaid" })],
      rules(),
    );
    expect(chosen.anomaly).toBe(true);
    expect(chosen.notes.join(" ")).toContain("sub_unpaid");
    /* And the entitled one is still what gets stored. */
    expect(chosen.state?.subscriptionId).toBe("sub_active");
  });
});
