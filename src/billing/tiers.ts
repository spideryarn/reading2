/**
 * **What we sell, as a table.** Every tier, every currency, every quota.
 *
 * Pure: no database, no network, no environment except the price ids a caller
 * hands in. Everything here is a decision, so it is all in one small file that
 * can be read in a minute — docs/project/billing.md § Adding a tier or a
 * currency is the how-to, and this is the what.
 *
 * ## Why a table rather than constants
 *
 * The first version had one paid tier written as two constants and a name in a
 * union, and adding a second meant editing five places — which is exactly the
 * shape of change that gets half done. `PAID_TIERS` below is the single list;
 * `scripts/stripe-setup.ts` creates Stripe objects by walking it, the price→tier
 * map is derived from it, and a new tier is one entry plus one environment
 * variable.
 *
 * ## The quota is an abuse boundary, not a margin
 *
 * A subscription is a fixed monthly charge; the ingest count exists to stop one
 * account spending unbounded model money. **The numbers moved on 2026-09-02**,
 * when measurement came back saying a full article ingest can cost around £1 —
 * so the original "100 articles for $10" was not finger-in-the-air optimistic,
 * it was an invitation to lose £90 a month per user. Greg reset Reader to 20.
 *
 * They are still deliberately generous against typical use, and still expected
 * to be wrong. Greg, 2026-09-02: *"which we can always increase later"* — and
 * raising a quota is a one-line change here that needs no Stripe object and no
 * migration, which is the property to preserve.
 *
 * **Reading is never limited by any of this.** An account at its ceiling can
 * still read everything it has and everything public; what it cannot do is add
 * something new, which is the only action that spends.
 */

/** The currencies a price is offered in. USD is the default; the rest are `currency_options`. */
export const CURRENCIES = ["usd", "gbp", "eur"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Three, lifetime — enough to play with, and no period logic for people who never pay. */
export const FREE_LIFETIME_INGESTS = 3;

/** What a paid tier is, in full. One entry per thing we sell. */
export interface TierSpec {
  /** Internal id. Appears in code and in logs, never to a customer. */
  readonly id: PaidTier;
  /** Customer-visible, on the Stripe product and the Checkout page. */
  readonly productName: string;
  readonly description: string;
  /** New article ingests allowed per billing period. */
  readonly ingestsPerPeriod: number;
  /**
   * The price in each currency, in the **smallest unit** — cents, pence, cents.
   *
   * **Chosen, never converted at run time.** A customer seeing €8.62 knows they
   * are being shown somebody else's price. The numbers were picked on
   * 2026-09-02 at roughly GBP/USD 1.35 and EUR/USD 1.16, rounded up to whole
   * units, which lands every currency about 4–8% above spot — deliberate
   * headroom, because a price set at spot goes underwater the moment the rate
   * moves and Stripe prices cannot be edited.
   *
   * Two properties worth keeping when these change: **the ratio between tiers
   * is 5× in every currency**, so the pricing page tells the same story
   * wherever you read it; and they are **whole units**, which is the
   * prosumer-tool convention (Linear, Copilot, Notion) rather than the `.99`
   * of consumer subscriptions. `tests/billing-tiers.test.ts` pins both.
   */
  readonly amounts: Readonly<Record<Currency, number>>;
  /**
   * The stable handle Stripe indexes, and what makes `scripts/stripe-setup.ts`
   * idempotent. **Never change one**: it is how a re-run finds what it made
   * last time rather than minting a second price nobody notices.
   */
  readonly lookupKey: string;
  /** Where the created `price_…` is read back from. */
  readonly envVar: string;
}

/** The two paid tiers. `free` is not here: nothing is sold, so there is no price. */
export type PaidTier = "reader" | "researcher";
export type Tier = "free" | PaidTier;

/**
 * **The list. Adding a tier is an entry here and an environment variable.**
 *
 * The names are ordinary words rather than Bronze/Silver: somebody deciding
 * between them should be able to tell which one they are from the name. They
 * are customer-visible and are a one-line change — nothing keys off them.
 */
export const PAID_TIERS: readonly TierSpec[] = [
  {
    id: "reader",
    productName: "Spideryarn Reader",
    description: "20 articles a month. Reading what you have already added is always free.",
    ingestsPerPeriod: 20,
    amounts: { usd: 1000, gbp: 800, eur: 900 },
    lookupKey: "spideryarn_reader_monthly",
    envVar: "STRIPE_PRICE_READER",
  },
  {
    id: "researcher",
    productName: "Spideryarn Researcher",
    description: "150 articles a month, for people who read for a living.",
    ingestsPerPeriod: 150,
    amounts: { usd: 5000, gbp: 4000, eur: 4500 },
    lookupKey: "spideryarn_researcher_monthly",
    envVar: "STRIPE_PRICE_RESEARCHER",
  },
];

/** By id, for the places that have a tier and want its numbers. */
export function tierSpec(id: PaidTier): TierSpec {
  const found = PAID_TIERS.find((t) => t.id === id);
  /* Unreachable while `PaidTier` is derived from this list, and a throw rather
     than a default because a missing tier is a code fault, not a free account. */
  if (!found) throw new Error(`no such paid tier: ${id}`);
  return found;
}

/**
 * What an owner may do right now.
 *
 * **A discriminated union, not a bag of optionals**, and the difference is the
 * whole point. The period is a **half-open** interval `[start, end)`; the free
 * tier has no period, because its allowance is lifetime. Written as two
 * optional fields, "a Reader entitlement with a start and no end" was a state
 * the compiler allowed and no code handled — and an earlier version of this
 * comment claimed the types made them optional *together*, which they did not.
 * GPT Sol caught the claim; this is the fix that makes it true.
 *
 * A caller must treat the free tier as "count everything ever" rather than
 * "count nothing", and now it cannot get there by reading an absent field.
 */
export type Entitlement =
  | { readonly tier: "free"; readonly limit: number }
  | {
      readonly tier: PaidTier;
      readonly limit: number;
      readonly periodStart: Date;
      readonly periodEnd: Date;
    };

/** Nobody has paid, or nobody could be identified. Never an error — it is a tier. */
export const FREE: Entitlement = { tier: "free", limit: FREE_LIFETIME_INGESTS };

/**
 * The Stripe subscription statuses that carry entitlement.
 *
 * `past_due` is in the list on purpose: a card that failed once is a customer
 * Stripe is still dunning, and cutting them off on the first retry is a worse
 * experience than the few pounds it saves. Dunning is configured so that
 * `past_due` eventually becomes `canceled` or `unpaid`, which are not here.
 *
 * `incomplete` and `incomplete_expired` are absent: those are subscriptions
 * whose *first* payment never succeeded, so nobody has ever paid anything.
 *
 * **Read as an allowlist over raw text**, not as a database enum. Stripe may
 * add a status, and a status this file has never heard of falls to the free
 * tier — which is the direction that costs a customer an email rather than
 * costing us an unbounded bill.
 */
export const ENTITLED_STATUSES: readonly string[] = ["active", "trialing", "past_due"];

/** Does this raw Stripe subscription status carry entitlement? */
export function isEntitledStatus(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && ENTITLED_STATUSES.includes(status);
}

/**
 * Which `price_…` sells which tier, read from the environment.
 *
 * Built per call rather than memoised: the variables are read at run time so a
 * test can set one, and building a two-entry map costs nothing. A tier whose
 * variable is unset is simply absent — a deployment with no Stripe configured
 * has an empty map and everybody is on the free tier, which is correct.
 */
export function priceTierMap(env: NodeJS.ProcessEnv = process.env): ReadonlyMap<string, PaidTier> {
  const map = new Map<string, PaidTier>();
  for (const spec of PAID_TIERS) {
    const priceId = env[spec.envVar]?.trim();
    if (priceId) map.set(priceId, spec.id);
  }
  return map;
}

/**
 * Which tier a Stripe price sells, or `null` for a price we do not recognise.
 *
 * `null` rather than a throw or a default: an unrecognised price is a real
 * situation — an old price still on a grandfathered subscription, a price
 * created by hand in the dashboard — and the caller's job is to log it and fall
 * to free, never to hand out quota for a price nobody costed.
 */
export function tierForPrice(
  priceId: string | null | undefined,
  prices: ReadonlyMap<string, PaidTier>,
): PaidTier | null {
  if (!priceId) return null;
  return prices.get(priceId) ?? null;
}

/** What that tier allows over the period Stripe says the subscription is in. */
export function entitlementFor(tier: Tier, period?: { start: Date; end: Date }): Entitlement {
  if (tier === "free" || !period) return FREE;
  return {
    tier,
    limit: tierSpec(tier).ingestsPerPeriod,
    periodStart: period.start,
    periodEnd: period.end,
  };
}
