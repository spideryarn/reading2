/**
 * Make Stripe match what the database says we sell.
 *
 *     npm run stripe:setup                     # say what it would do
 *     npm run stripe:setup -- --apply          # do it
 *     npm run stripe:setup -- --prod --apply   # do it to LIVE
 *
 * `--prod` takes the account and the database from `.env.prod` together, rather
 * than either being named on the command line — scripts/stripe-target.ts says
 * why that is not a preference. Every run prints the database it is pointed at
 * before it does anything.
 *
 * **The database is the source of truth and Stripe follows it.** Edit a row in
 * `billing_tiers` (or insert one, with its prices in `billing_tier_prices`),
 * run this, and it creates or replaces the Stripe product and price to match
 * and writes `stripe_price_id` back. Nothing is ever pasted into an environment
 * file on any machine — which is the point, and why `STRIPE_PRICE_READER` and
 * its siblings no longer exist. Greg's call, 2026-09-02:
 *
 * > instead of adding them as environment variables, could we add them to the
 * > database, so that it's easier to modify (e.g. for agents, in UI, etc)
 *
 * ## Idempotent by lookup key, and honest about price immutability
 *
 * A product name is a label a human may edit; `lookup_key` is a handle Stripe
 * indexes and enforces unique per mode. So re-running finds what it made last
 * time instead of minting a second price nobody notices until two customers are
 * on different ones.
 *
 * **Stripe prices are immutable.** You cannot change an amount, and you cannot
 * add a currency to a price that already exists. So when the row's numbers
 * differ from the live price, this creates a **new** price and moves the lookup
 * key onto it with `transfer_lookup_key`, leaving the old one in place and
 * unarchived. That is deliberate: existing subscriptions keep billing on the
 * price they were sold, and moving them is a separate, visible decision rather
 * than a side effect of running a setup script.
 *
 * The product's *words*, by contrast, are ordinary mutable fields, so a changed
 * name or description is reconciled in place. It had once left "100 articles a
 * month" on the Checkout page, where a customer reads it.
 */
import type Stripe from "stripe";

import {
  STRIPE_API_VERSION,
  accountProblem,
  expectedLivemode,
  stripeClient,
  stripeConfigProblem,
} from "../src/billing/stripe.js";
import type { TierRow } from "../src/billing/tiers.js";
import { isTerminalStatus } from "../src/billing/tiers.js";
import { isMain } from "../src/is-main.js";
import { readTiers, recordTierPrice } from "../src/store/pg-tiers.js";

import { aimAtTarget, refuseUnknownArgs, targetLine } from "./stripe-target.js";

/** Marks the objects this script owns, so a hand-made one is never adopted. */
const managed = (tier: TierRow) => ({
  managed_by: "scripts/stripe-setup.ts",
  lookup_key: tier.lookupKey,
  tier: tier.id,
});

/**
 * The slice of Stripe `ensureTier` uses. Narrow on purpose — it is what a test
 * has to stand in for, and every method here is one the script really calls.
 */
export interface StripeTierSetup {
  readonly prices: {
    list(params: Stripe.PriceListParams): Promise<{ data: Stripe.Price[] }>;
    create(params: Stripe.PriceCreateParams): Promise<Stripe.Price>;
  };
  readonly products: {
    retrieve(id: string): Promise<Stripe.Product | Stripe.DeletedProduct>;
    update(id: string, params: Stripe.ProductUpdateParams): Promise<Stripe.Product>;
    create(params: Stripe.ProductCreateParams): Promise<Stripe.Product>;
    search(params: Stripe.ProductSearchParams): Promise<{ data: Stripe.Product[] }>;
  };
  readonly subscriptions: {
    list(
      params: Stripe.SubscriptionListParams,
    ): Promise<{ data: Stripe.Subscription[]; has_more: boolean }>;
  };
}

export interface Step {
  readonly what: string;
  readonly detail: string;
  /**
   * **This step means the run did not do its job**, and the process must exit
   * non-zero because of it.
   *
   * Every step used to be an ordinary line of narration, so the two states that
   * exist precisely to stop a bad write — refusing to touch a configuration when
   * the tier rows are incomplete, and an apply that read back wrong — printed
   * their warning and then exited 0, under a closing line that sounds like
   * success. A refusal nobody notices is worse than no refusal, because it buys
   * false confidence: docs/reusable/silent-success.md, and the whole reason this
   * job exists. GPT Sol, 2026-09-03.
   */
  readonly failed?: true;
}

/** Currencies in a stable order, base first, so runs are comparable. */
function currenciesOf(tier: TierRow): string[] {
  const all = Object.keys(tier.amounts).sort();
  /* USD is the base if it is offered, because it is the one currency every
     Stripe account can charge; otherwise whichever sorts first. Arbitrary but
     stable, and `currency_options` makes the choice barely matter. */
  return all.includes("usd") ? ["usd", ...all.filter((c) => c !== "usd")] : all;
}

function money(tier: TierRow): string {
  return currenciesOf(tier)
    .map((c) => `${((tier.amounts[c] ?? 0) / 100).toFixed(2)} ${c.toUpperCase()}`)
    .join(" / ");
}

/**
 * **The number on the pricing page is the number charged.**
 *
 * `tax_behavior` decides whether tax is added to `unit_amount` or taken out of
 * it, and its default — `unspecified` — behaves as *exclusive*. Left that way,
 * a reader shown "€9 a month" is charged €10.71: measured on 2026-09-03, a real
 * test purchase from a German IP came back as a €9.00 subtotal plus €1.71 of
 * 19% VAT. Every unit test passed; nothing in this repo renders a Stripe
 * invoice.
 *
 * `inclusive` is the choice `docs/project/billing.md` had already made, and for
 * B2C in the UK and EU it is the only defensible one: a consumer price is
 * quoted VAT-included, and "€9 plus whatever your country charges" is not a
 * price a reader can act on. The cost is that our net varies by the buyer's
 * country — €9 is €7.56 net in Germany at 19% and €7.44 in Ireland at 21% —
 * which is a margin question, not a display bug.
 *
 * **It cannot be changed later.** `tax_behavior` is immutable like the amount,
 * so getting it wrong means minting a new price and moving the lookup key, and
 * anyone already subscribed stays on what they bought. `differences` therefore
 * checks it, so a price created before this line is *replaced* rather than
 * quietly kept.
 */
const TAX_BEHAVIOR = "inclusive" as const;

/** The price fields, in the shape Stripe wants them. */
function amountsFor(tier: TierRow) {
  const [base, ...rest] = currenciesOf(tier);
  if (!base) throw new Error(`tier ${tier.id} has no prices — add rows to billing_tier_prices`);
  return {
    currency: base,
    unit_amount: tier.amounts[base] as number,
    tax_behavior: TAX_BEHAVIOR,
    currency_options: Object.fromEntries(
      rest.map((c) => [c, { unit_amount: tier.amounts[c] as number, tax_behavior: TAX_BEHAVIOR }]),
    ),
  };
}

/** What about the live price no longer matches the row. Empty means it is right. */
function differences(price: Stripe.Price, tier: TierRow): string[] {
  const wrong: string[] = [];
  const [base, ...rest] = currenciesOf(tier);
  if (!price.active) wrong.push("it is archived");
  if (price.currency !== base) wrong.push(`base currency is ${price.currency}`);
  if (price.unit_amount !== tier.amounts[base as string]) wrong.push(`${base} is ${price.unit_amount}`);
  if (price.recurring?.interval !== "month") wrong.push(`interval is ${price.recurring?.interval}`);
  /* **A period is `interval` × `interval_count`**, and only the first half is
     obvious. `month` with a count of 3 is a quarterly price sold at a monthly
     number, and it is also a quota window three times as long as the allowance
     was costed for — the same hole `billing_cycle_anchor` closes, reached from
     the other side. Stripe defaults the count to 1 and we never send it, so this
     only fires on a price made by hand. */
  if ((price.recurring?.interval_count ?? 1) !== 1) {
    wrong.push(`interval_count is ${price.recurring?.interval_count}, not 1`);
  }
  /* See TAX_BEHAVIOR. `unspecified` is the default and charges tax on top, so
     a price carrying it is one that overcharges — worth replacing, and it can
     only be fixed by replacing. */
  if (price.tax_behavior !== TAX_BEHAVIOR) wrong.push(`tax behaviour is ${price.tax_behavior}`);
  /* **A currency Stripe offers that the database does not.** Both scripts used
     to iterate only the row's currencies, so an extra `currency_options` entry —
     added by hand, or left behind by an earlier row — was a price a reader could
     be charged at that nothing in this repo costed or displays. GPT Sol,
     2026-09-04. */
  const offered = Object.keys(price.currency_options ?? {}).filter((c) => c !== price.currency);
  const extra = offered.filter((c) => !(c in tier.amounts));
  if (extra.length > 0) wrong.push(`Stripe also offers ${extra.sort().join(", ")}, which the row does not`);

  for (const c of rest) {
    const option = price.currency_options?.[c];
    if (!option || option.unit_amount !== tier.amounts[c]) {
      wrong.push(`${c} is ${option?.unit_amount ?? "absent"}`);
    } else if (option.tax_behavior !== TAX_BEHAVIOR) {
      wrong.push(`${c} tax behaviour is ${option.tax_behavior}`);
    }
  }
  return wrong;
}

/**
 * What kind of thing a tax authority thinks we are selling.
 *
 * **A new Stripe account will not sell without one.** Managed Payments — Stripe
 * acting as merchant of record — is *on by default* on accounts created from
 * 2026, and it refuses a Checkout Session whose product has no `tax_code`:
 *
 * > Invalid line_items[0]: the product tax code is missing. … Product tax code
 * > is required for Managed Payments, which is enabled by default on your
 * > account.
 *
 * That is how this arrived: the first Checkout on the new account failed with a
 * 400, which our route correctly turned into "we could not reach Stripe just
 * now" — true in the sense that mattered to the reader, and misleading to
 * whoever reads it next, so the real message is quoted here.
 *
 * `txcd_10103000` is *Software as a service (SaaS) — personal use*: delivered
 * over the internet, not customised per buyer, nothing downloaded, sold to a
 * person rather than a business. That is Spideryarn. The near neighbour is
 * `txcd_10105001`, *Artificial Intelligence as a Service — Cloud Based —
 * Personal Use*, and the case for it is that the models are most of the cost;
 * the case against, taken here, is that a reader buys a reading tool and the AI
 * is how it works, not what it is. The `- business use` variants only change US
 * sales tax and we sell to consumers.
 *
 * One constant rather than a column on `billing_tiers`, because both tiers are
 * the same product sold in two sizes. The day a tier is genuinely a different
 * kind of thing, make it a column then.
 *
 * It is set whether or not Managed Payments stays on: Stripe Tax wants the same
 * field, and an untaxed-looking product is wrong either way.
 */
export const PRODUCT_TAX_CODE = "txcd_10103000";

/**
 * Bring the product's customer-visible name, description and tax code into line.
 *
 * Separate from the price because the rules are opposite: a price is immutable
 * and a mismatch means creating a new one, while a product's words are ordinary
 * mutable fields and a mismatch just means somebody edited the row.
 *
 * `tax_code` comes back from Stripe either as a string or as an expanded object,
 * so it is narrowed rather than compared directly — a `TaxCode` object compared
 * against our string is always unequal, which would make this update on every
 * run and never converge.
 */
async function syncProductWords(
  stripe: StripeTierSetup,
  product: string | Stripe.Product | Stripe.DeletedProduct,
  tier: TierRow,
  apply: boolean,
  steps: Step[],
): Promise<void> {
  const full = typeof product === "string" ? await stripe.products.retrieve(product) : product;
  if ("deleted" in full && full.deleted) return;
  const live = full as Stripe.Product;
  const taxCode = typeof live.tax_code === "string" ? live.tax_code : live.tax_code?.id;
  if (
    live.name === tier.productName &&
    (live.description ?? "") === tier.description &&
    taxCode === PRODUCT_TAX_CODE
  ) {
    return;
  }

  if (!apply) {
    steps.push({ what: tier.id, detail: `would update the product's name/description/tax code on ${live.id}` });
    return;
  }
  await stripe.products.update(live.id, {
    name: tier.productName,
    description: tier.description,
    tax_code: PRODUCT_TAX_CODE,
  });
  steps.push({ what: tier.id, detail: `updated the product's name/description/tax code on ${live.id}` });
}

/**
 * **Do not move the row off a price somebody is still billing on.**
 *
 * `billing_tiers.stripe_price_id` is what `tierForPrice` matches a subscription
 * against, and the Portal's `products` list carries only that price. So the
 * moment the row moves, everyone left on the old price loses their upgrade path
 * *and* stops being recognised as a paying tier at all — they keep paying and
 * fall to the free allowance.
 *
 * ## The guard is on the mutation, not on the branch before it
 *
 * The first version guarded `whyNotReplace`, which sits on one of the **three**
 * paths that call `recordTierPrice`. The other two moved the row with no check
 * whatsoever: the lookup key resolving to a *matching* price the row does not
 * name yet, and the creation branch when no price carries the lookup key any
 * more. GPT Sol, 2026-09-04, and the line worth keeping is that the later Portal
 * guard *may refuse its write, but cannot undo the database mutation*.
 *
 * Keying on "the row is about to move off a price with subscribers on it"
 * covers all three with one rule. Anything else is three rules that have to be
 * kept in step, which is how this hid in the first place.
 *
 * ## In live mode it refuses outright, without scanning
 *
 * Because the scan cannot prove what it would need to prove. Cursor pagination
 * reads a moving list, so a Checkout that completes *ahead of the cursor* while
 * the scan runs is never seen — and that window is exactly when a price change
 * makes a reader likely to be buying. A clean scan in live mode is reassuring
 * rather than true, and reassuring is the failure this file exists to stop.
 *
 * Greg's call via the team lead, 2026-09-04: there is no need to reprice on
 * live, so an honest refusal costs nothing. It refuses the harmless
 * zero-subscriber case too, which is the accepted price of not having to be
 * right about the race.
 *
 * @param from the price the row names today, or null if it names none
 * @param to the price the row is about to name
 * @returns the refusal, or null when the move is safe
 */
async function whyNotMoveRow(
  stripe: StripeTierSetup,
  tier: TierRow,
  from: string | null,
  to: string,
  why: string,
): Promise<string | null> {
  /* Nothing to strand: a row that names no price has no subscribers of its own,
     and a row already naming `to` is not moving. */
  if (from === null || from === to) return null;

  if (expectedLivemode()) {
    return (
      `REFUSING to move ${tier.id} from ${from} to ${to} (${why}) — this is LIVE. ` +
      "Scanning subscriptions cannot prove nobody subscribed while the scan was running, so this " +
      "script will not move a live tier off its price at all. " +
      "docs/project/billing.md § Moving subscribers to a new price."
    );
  }

  const blocked = subscribersOn(await unfinishedSubscriptions(stripe), from);
  if (blocked.length === 0) return null;
  return (
    `REFUSING to move ${tier.id} from ${from} to ${to} (${why}) — ${blocked.length} unfinished ` +
    `subscription(s) still bill on ${from} (${blocked.slice(0, 5).join(", ")}` +
    `${blocked.length > 5 ? ", …" : ""}). ` +
    "They would keep paying, lose their upgrade path, and fall to the free allowance. " +
    /* **Not "retire the tier instead".** Retiring removes the tier from
       `offerableTiers`, which removes its price from the Portal's product list —
       stranding exactly the same people by a different route. */
    "Retiring the tier does NOT help, because that removes its Portal price and strands them " +
    "just the same. docs/project/billing.md § Moving subscribers to a new price."
  );
}

/**
 * Reconcile the price the lookup key already points at.
 *
 * Split out of `ensureTier` to keep that function readable once it grew three
 * refusals; the decisions are unchanged. Every path that would move the row is
 * guarded by `whyNotMoveRow` before it writes.
 */
async function reconcileExistingPrice(
  stripe: StripeTierSetup,
  tier: TierRow,
  live: Stripe.Price,
  apply: boolean,
): Promise<Step[]> {
  const steps: Step[] = [];

    await syncProductWords(stripe, live.product, tier, apply, steps);
    const wrong = differences(live, tier);
    if (wrong.length === 0) {
      steps.push({ what: tier.id, detail: `price is already ${money(tier)} — ${live.id}` });
      if (tier.stripePriceId !== live.id) {
        /* **The quiet one.** The price matches the row's numbers, so nothing is
           being replaced — but the row is still being moved onto a different
           price id, and whoever is on the old one is stranded by that alone.
           Checked on the dry run as well, so the refusal is visible before
           `--apply`. */
        const moving = await whyNotMoveRow(stripe, tier, tier.stripePriceId, live.id, "the lookup key resolves here now");
        if (moving) {
          steps.push({ what: tier.id, failed: true, detail: moving });
          return steps;
        }
        if (apply) {
          await recordTierPrice(tier.id, live.id, live.livemode);
          steps.push({ what: tier.id, detail: `recorded ${live.id} on the row` });
        }
      }
      return steps;
    }

    /* The row moves onto whatever the replacement turns out to be; its id does
       not exist yet, so the move is described by where it comes *from*. */
    const refusal = await whyNotMoveRow(stripe, tier, tier.stripePriceId, "a new price", wrong.join(", "));
    if (refusal) {
      steps.push({ what: tier.id, failed: true, detail: refusal });
      return steps;
    }

    if (!apply) {
      steps.push({
        what: tier.id,
        detail: `would REPLACE ${live.id} (${wrong.join(", ")}) with a new price at ${money(tier)}`,
      });
      return steps;
    }
    const replacement = await stripe.prices.create({
      product: typeof live.product === "string" ? live.product : live.product.id,
      lookup_key: tier.lookupKey,
      transfer_lookup_key: true,
      recurring: { interval: "month" },
      metadata: managed(tier),
      ...amountsFor(tier),
    });
    await recordTierPrice(tier.id, replacement.id, replacement.livemode);
    steps.push({
      what: tier.id,
      detail: `replaced ${live.id} (${wrong.join(", ")}) with ${replacement.id} at ${money(tier)}`,
    });
    return steps;
  
}

/** Create, find or replace one tier's product and price, and record the id. */
export async function ensureTier(
  tier: TierRow,
  apply: boolean,
  /**
   * Injectable for the same reason `ensurePortalConfiguration` is: the branches
   * worth testing are the ones that **refuse**, and a refusal is only observable
   * by seeing what was *not* called. The real client satisfies this at the call
   * site, so a moved SDK signature is a compile error there.
   */
  injected?: StripeTierSetup,
): Promise<Step[]> {
  const steps: Step[] = [];

  /* **Before the client is built**, not after: there is nothing to ask Stripe
     about a row that sells at no price, and constructing a client first made
     this branch reachable only by a process holding a live key — so the test for
     it could not exist. Order is the whole fix. */
  if (Object.keys(tier.amounts).length === 0) {
    /* **An active tier with no amounts is an invalid row, not a quiet skip.**
       Nothing can be sold at no price, so the run did not do its job — and if
       the row still carries an *old* `stripe_price_id` it also slips past
       `stripe:check`, whose per-currency comparison loops over zero currencies
       and finds nothing wrong. Two scripts passing over the same broken
       source-of-truth row, saying nothing. GPT Sol, 2026-09-03.

       Only when the tier is **active**: a retired tier with its prices removed
       is a normal end state, and failing on it would make every later run red
       for a row nobody sells. */
    steps.push({
      what: tier.id,
      ...(tier.active ? { failed: true as const } : {}),
      detail: tier.active
        ? "SKIPPED — active but has no rows in billing_tier_prices, so it sells nothing"
        : "SKIPPED — no rows in billing_tier_prices (retired, so nothing to do)",
    });
    return steps;
  }

  const stripe = injected ?? (await stripeClient());
  const existing = await stripe.prices.list({
    lookup_keys: [tier.lookupKey],
    expand: ["data.currency_options", "data.product"],
    limit: 2,
  });
  const live = existing.data[0];

  if (live) return [...steps, ...(await reconcileExistingPrice(stripe, tier, live, apply))];

  /* **No price carries the lookup key any more** — archived, deleted, or moved
     by hand. The branch below mints a fresh one and records it, which moves the
     row off whatever it names today just as surely as a replacement does. This
     was the third unguarded mutation. */
  const orphaned = await whyNotMoveRow(
    stripe,
    tier,
    tier.stripePriceId,
    "a new price",
    `no price carries lookup key ${tier.lookupKey} any more`,
  );
  if (orphaned) {
    steps.push({ what: tier.id, failed: true, detail: orphaned });
    return steps;
  }

  if (!apply) {
    steps.push({ what: tier.id, detail: `would create "${tier.productName}" at ${money(tier)}` });
    return steps;
  }

  const found = await stripe.products.search({
    query: `metadata['lookup_key']:'${tier.lookupKey}'`,
    limit: 2,
  });
  const product =
    found.data[0] ??
    (await stripe.products.create({
      name: tier.productName,
      description: tier.description,
      /* See PRODUCT_TAX_CODE: without this a new account refuses to sell at all. */
      tax_code: PRODUCT_TAX_CODE,
      metadata: managed(tier),
    }));

  const price = await stripe.prices.create({
    product: product.id,
    lookup_key: tier.lookupKey,
    recurring: { interval: "month" },
    metadata: managed(tier),
    ...amountsFor(tier),
  });
  await recordTierPrice(tier.id, price.id, price.livemode);
  steps.push({
    what: tier.id,
    detail: `${found.data[0] ? "found" : "created"} ${product.id}, created price ${price.id} at ${money(tier)}`,
  });
  return steps;
}

/**
 * The slice of Stripe this function needs, so a test can hand it a fake.
 *
 * Injectable for the same reason `CheckoutDeps` is (src/billing/checkout.ts):
 * what matters here is what we *send*, and the only way to see that is to
 * answer it. The real client is checked against this type at the default
 * argument, so an SDK whose signatures moved is a compile error there.
 */
export interface StripePortalSetup {
  readonly billingPortal: {
    readonly configurations: {
      list(
        params: Stripe.BillingPortal.ConfigurationListParams,
      ): Promise<{ data: Stripe.BillingPortal.Configuration[] }>;
      create(
        params: Stripe.BillingPortal.ConfigurationCreateParams,
      ): Promise<Stripe.BillingPortal.Configuration>;
      update(
        id: string,
        params: Stripe.BillingPortal.ConfigurationUpdateParams,
      ): Promise<Stripe.BillingPortal.Configuration>;
    };
  };
  /* Only to turn a price id into its product id — see `portalProducts`. The row
     stores `stripe_price_id` and Stripe's `products` list wants both. */
  readonly prices: {
    retrieve(id: string): Promise<Stripe.Price>;
  };
  /* To ask who the plan menu we are about to write would leave out. */
  readonly subscriptions: {
    list(
      params: Stripe.SubscriptionListParams,
    ): Promise<{ data: Stripe.Subscription[]; has_more: boolean }>;
  };
}

/** Turning a price id into its product id, which is all `portalProducts` needs. */
export interface PriceLookup {
  readonly prices: { retrieve(id: string): Promise<Stripe.Price> };
}

/** Listing subscriptions, which both scripts need and neither should do twice. */
export interface SubscriptionLookup {
  readonly subscriptions: {
    list(
      params: Stripe.SubscriptionListParams,
    ): Promise<{ data: Stripe.Subscription[]; has_more: boolean }>;
  };
}

/**
 * A page size sits between "one call" and "a runaway", and neither end is safe
 * on its own. 100 is Stripe's maximum; the cap on *pages* is what stops an
 * unbounded loop, and hitting it is reported as a failure rather than shrugged
 * off — see `unfinishedSubscriptions`.
 */
export const PAGE_SIZE = 100;
const MAX_PAGES = 200;

/**
 * **Read a Stripe list to the end, or throw.**
 *
 * One definition of exhaustiveness, because there are now two sweeps that need
 * it — the subscription scan below and `stripe-check.ts`'s stale-invoice sweep —
 * and a second copy of this rule is a second place for it to be softened.
 *
 * The rule has been wrong twice in this file's history, both times in the
 * direction of quietly returning less than promised: first reading one page and
 * reporting `has_more` as a non-blocking warning, then returning the partial
 * list when Stripe said `has_more` but handed back a page with no id to continue
 * from. A function whose whole promise is "all of them" must not be able to
 * answer "some of them" — the caller cannot tell the two apart, and every guard
 * built on it then passes for the wrong reason.
 *
 * **It is still not a snapshot**, and no pagination can be: the list moves while
 * it is read, so a row created ahead of the cursor is never seen. Callers that
 * need a proof rather than a preflight have to say so — `ensureTier` refuses
 * outright in live mode for exactly this reason.
 *
 * @param what plural noun for the error message, e.g. "subscriptions"
 * @throws on reaching the page cap, and on `has_more` with an empty page
 */
export async function everyPage<T extends { id: string }>(
  what: string,
  fetchPage: (startingAfter: string | undefined) => Promise<{ data: T[]; has_more: boolean }>,
): Promise<T[]> {
  const all: T[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await fetchPage(startingAfter);
    all.push(...batch.data);
    if (!batch.has_more) return all;

    startingAfter = batch.data[batch.data.length - 1]?.id;
    if (!startingAfter) {
      throw new Error(
        `Stripe reported more ${what} but returned an empty page, so this scan is incomplete`,
      );
    }
  }
  throw new Error(
    `more than ${MAX_PAGES * PAGE_SIZE} ${what} — this check cannot see them all, so do not trust it`,
  );
}

/**
 * **Every subscription that is not over, paginated to exhaustion.**
 *
 * ## Not-terminal, not entitled — and the difference is money
 *
 * This filtered on `isEntitledStatus` first, which is wrong for the question
 * being asked. Entitlement is "may this reader ingest **right now**"; the
 * question here is "could this subscription still bill on this price", and those
 * come apart exactly where it matters. `incomplete` becomes `active` the moment
 * a first payment succeeds, `paused` resumes, `unpaid` can be reactivated — all
 * of them still attached to the price we were about to replace, and none of them
 * entitled today. Each would have been invisible to the guard and stranded by
 * the write. GPT Sol, 2026-09-03.
 *
 * `isTerminalStatus` is the repo's own predicate for "this subscription is over,
 * so another may be sold" — `canceled` and `incomplete_expired` and nothing else
 * — and it fails **closed** for a status it has never heard of, which is the
 * direction that costs a warning rather than a stranded customer
 * (src/billing/tiers.ts).
 *
 * Exhaustive or throwing, via `everyPage` — which is also where the reasoning
 * about why it still is not a snapshot lives.
 */
export async function unfinishedSubscriptions(stripe: SubscriptionLookup): Promise<Stripe.Subscription[]> {
  const all = await everyPage("subscriptions", (startingAfter) =>
    stripe.subscriptions.list({
      status: "all",
      limit: PAGE_SIZE,
      expand: ["data.items"],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    }),
  );
  return all.filter((s) => !isTerminalStatus(s.status));
}

/** Which of those subscriptions are billing on `priceId`. Pure, so it is testable. */
export function subscribersOn(
  subscriptions: readonly Stripe.Subscription[],
  priceId: string,
): string[] {
  return subscriptions.filter((s) => s.items.data.some((i) => i.price.id === priceId)).map((s) => s.id);
}

/** The Portal `products` entry shape, named because three functions pass it around. */
type PortalProduct = Stripe.BillingPortal.ConfigurationCreateParams.Features.SubscriptionUpdate.Product;

/**
 * **`products` is not in the response unless you ask for it.**
 *
 * Every other field of `subscription_update` comes back on an ordinary retrieve;
 * this one is simply **absent** — not empty, missing — and an absent list reads
 * exactly like a configuration that offers no plan to switch to. Measured in the
 * sandbox on 2026-09-03 by reading back an apply that had just succeeded: the
 * four scalar fields were right and `products` was not there at all.
 *
 * So both scripts expand it, and `stripe-check.ts` uses the same constant. Read
 * one back without this and the honest reading is a false alarm on a correct
 * account; the dishonest reading — treating undefined as "fine" — is a check
 * that can never see the field wrong. docs/reusable/silent-success.md.
 */
export const EXPAND_PORTAL_PRODUCTS = ["data.features.subscription_update.products"];

/**
 * **The plan-change contract: one definition of correct, used three ways.**
 *
 * This object is what we send on create, what we send on reconcile, and what
 * `portalDrift` compares a live configuration against — and, through that, what
 * `stripe-check.ts` asserts. There is deliberately **no second list** of what
 * good looks like. Two definitions of correct that drift apart is the same shape
 * as the bug this whole file exists to fix: `stripe:check` passed cleanly on the
 * day billing went live because it verified the features somebody thought to
 * list, and `subscription_update` was not among them. GPT Sol, 2026-09-03, on
 * the first version of this stage, which had checked loosely here and exactly
 * there.
 *
 * Comparison is **exact equality on every field**, never "contains" or "at
 * least". `default_allowed_updates: ["price", "promotion_code"]` is not this
 * contract, and neither is a `products` list carrying an extra price nobody
 * costed.
 *
 * The fields, and why each is not a default:
 *
 * - **`default_allowed_updates: ["price"]`** looks redundant beside `enabled`
 *   and is not. With the feature on and this list empty, the Portal offers no
 *   switch at all — which is exactly what the live configuration read on the day
 *   billing went live.
 * - **`billing_cycle_anchor: "unchanged"`** keeps the billing dates where they
 *   are, and therefore keeps the **quota window** where it is. The obvious
 *   alternative, `"now"`, restarts the period on every switch, and that is
 *   unlimited free quota rather than a stricter rule: Stripe credits unused
 *   *time*, not unused ingests, so upgrade, take the larger allowance,
 *   immediately downgrade for a near-full credit, and immediately upgrade again
 *   paying with that credit — a fresh window for no cash, repeatable without
 *   limit. The `+3200 paid` / `−3200 paid` invoice pair measured in the sandbox
 *   on 2026-09-03 is exactly the middle step. Under `"unchanged"` the window
 *   never moves, usage accumulates across switches, and cycling gains nothing.
 *
 *   It leaves a smaller, bounded hole — a late-period upgrade buys the full
 *   remaining allowance — and **that is not solved here.** It is closed by
 *   prorating the allowance to match the price, in its own stage. Do not reach
 *   for the anchor to fix it. Greg's call, 2026-09-03, after GPT Sol found the
 *   cycling exploit in this stage's review.
 * - **`proration_behavior: "always_invoice"` is legal under Managed Payments**,
 *   which was a real question rather than a formality: Managed Payments forbids
 *   generating a one-off invoice for a subscription *outside* the billing
 *   period, and no Stripe document says whether an in-period proration counts.
 *   Measured in the sandbox on 2026-09-03 against a subscription born from a
 *   completed hosted Checkout and carrying `managed_payments: { enabled: true }`
 *   — an API-created subscription reads `{ enabled: false }` and would have
 *   proved nothing. Both directions were accepted.
 * - **`trial_update_behavior: "end_trial"`** is the quiet one, and it grants
 *   free entitlement if it is wrong. `ENTITLED_STATUSES` includes `trialing`
 *   (src/billing/tiers.ts), so under `continue_trial` a reader on a Reader trial
 *   could switch to Researcher, keep the trial, and be metered at 150 without
 *   having paid anything. Stripe returns the field, so leaving it out of the
 *   contract meant a hand-set `continue_trial` survived `--apply` while the run
 *   reported success.
 *
 * `schedule_at_period_end` is **not** here because it is not a scalar we send on
 * create; it is handled by `portalUpdateFeatures`, which clears it. No
 * subscription schedules in either direction — Stripe only allows a period-end
 * downgrade between prices on the *same* product, and Reader and Researcher are
 * deliberately separate products.
 */
const SUBSCRIPTION_UPDATE = {
  enabled: true,
  default_allowed_updates: ["price"],
  billing_cycle_anchor: "unchanged",
  proration_behavior: "always_invoice",
  trial_update_behavior: "end_trial",
} as const satisfies Omit<
  Stripe.BillingPortal.ConfigurationCreateParams.Features.SubscriptionUpdate,
  "products"
>;

/**
 * Everything we assert about the configuration, in one object.
 *
 * **`unpriced` is part of the desired state, not a diagnostic.** A tier that is
 * active but has no `stripe_price_id` means the product list is *incomplete*
 * rather than short, and an incomplete list must never be the basis for
 * switching the feature on: the Portal would offer a genuine-looking menu with a
 * plan missing from it. So the two fields are carried together and every
 * consumer asks `complete()` rather than `products.length`. Keeping them apart
 * is what let the creation path enable switching on a half-priced tier set —
 * GPT Sol, 2026-09-03.
 */
export interface DesiredPortal {
  readonly products: readonly PortalProduct[];
  /** Ids of active tiers with no Stripe price. Any at all means incomplete. */
  readonly unpriced: readonly string[];
}

/** May the plan switch be on at all? Only with a full set of destinations. */
export function complete(desired: DesiredPortal): boolean {
  return desired.products.length > 0 && desired.unpriced.length === 0;
}

/**
 * The `features` block we send **on create**.
 *
 * A brand-new configuration starts with no `schedule_at_period_end` conditions,
 * so there is nothing to clear and the field is simply absent here — see
 * `portalUpdateFeatures` for the reconcile, where it is not absent.
 */
export function portalFeatures(
  desired: DesiredPortal,
): Stripe.BillingPortal.ConfigurationCreateParams.Features {
  return {
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    /* Email and address, because they appear on the invoice and a customer
       who cannot fix them has to email us instead. Not `tax_id`: we are not
       registered for VAT and offering the field implies we are. */
    customer_update: { enabled: true, allowed_updates: ["email", "address"] },
    subscription_cancel: { enabled: true, mode: "at_period_end" },
    /* **Off unless the destination list is complete** — `complete()`, not
       "at least one product". A half-priced tier set would otherwise create a
       configuration whose plan menu looks real and is missing a plan, which is
       the original fault in miniature.

       `products` is also *required* whenever `enabled` is true: Stripe answers
       400 `parameter_missing` on `features[subscription_update][products]`,
       measured in the sandbox on 2026-09-03. So `enabled: false` is the only
       legal shape here anyway. This branch is reachable only when *creating* a
       first configuration — `ensurePortalConfiguration` refuses to reconcile an
       existing one down to it. */
    subscription_update: complete(desired)
      ? { ...SUBSCRIPTION_UPDATE, products: [...desired.products] }
      : { enabled: false },
  };
}

/**
 * The `features` block we send **on reconcile**, which differs in exactly one
 * field: it clears `schedule_at_period_end`.
 *
 * **`conditions: ""`, and the empty string is load-bearing.** `conditions: []`
 * is dropped on the way into the form body, so Stripe answers 200 and changes
 * nothing — measured in the sandbox on 2026-09-03 by setting a
 * `decreasing_item_amount` condition and watching it survive an apply that
 * reported success. Stripe's convention for "set this to empty" is the key
 * present with an empty value, and the update params type says so:
 * `ConfigurationUpdateParams.…ScheduleAtPeriodEnd.conditions?:
 * Emptyable<Array<Condition>>`, where `Emptyable<T> = null | "" | T`
 * (node_modules/stripe/esm/shared.d.ts).
 *
 * The **create** params type declares the same field as a plain
 * `Array<Condition>`, with no empty-string member. I read that one, concluded
 * the field could not be cleared through the typed client at all, and wrote it
 * up as a finding; GPT Sol caught it. Two params types, two different rules, and
 * the one that matters for a reconcile is the update. Hence two functions rather
 * than one shared block with a flag.
 */
export function portalUpdateFeatures(
  desired: DesiredPortal,
): Stripe.BillingPortal.ConfigurationUpdateParams.Features {
  const features = portalFeatures(desired) as Stripe.BillingPortal.ConfigurationUpdateParams.Features;
  const update = features.subscription_update;
  if (!update?.enabled) return features;
  return { ...features, subscription_update: { ...update, schedule_at_period_end: { conditions: "" } } };
}

/**
 * Which products and prices the Portal may switch between.
 *
 * `billing_tiers` stores only `stripe_price_id`, and Stripe's `products` list
 * wants the **product** id beside the prices, so every price has to be expanded.
 * Grouped by product rather than one entry per tier because Stripe's field is
 * keyed that way — two tiers sharing a product would otherwise send the same
 * product twice. Ours are separate products on purpose (an invoice that says
 * *Spideryarn Researcher* rather than just *Spideryarn*), so today it is one
 * price each.
 *
 * A tier whose row has no price id yet is reported rather than skipped in
 * silence: on a first-ever run that is simply "the prices do not exist yet",
 * and on any later run it is the upgrade path missing a destination.
 */
export async function portalProducts(
  /* Only the price lookup, not the whole setup client: `stripe-check.ts` is
     read-only and has no business holding a handle that can create or update a
     configuration. */
  stripe: PriceLookup,
  tiers: readonly TierRow[],
): Promise<{ products: PortalProduct[]; unpriced: string[] }> {
  const byProduct = new Map<string, string[]>();
  const unpriced: string[] = [];
  for (const tier of offerableTiersForPortal(tiers)) {
    if (!tier.stripePriceId) {
      unpriced.push(tier.id);
      continue;
    }
    const price = await stripe.prices.retrieve(tier.stripePriceId);
    const productId = typeof price.product === "string" ? price.product : price.product.id;
    byProduct.set(productId, [...(byProduct.get(productId) ?? []), price.id]);
  }
  return {
    products: [...byProduct].map(([product, prices]) => ({
      product,
      prices,
      /* **Belt as well as braces.** `default_allowed_updates` is `["price"]`, so
         the Portal offers no quantity control today and this changes nothing.
         It is sent because Stripe *defaults it on* — read back after an apply
         that never mentioned it, every product came back
         `adjustable_quantity: { enabled: true, minimum: 1 }` — and because
         entitlement ignores `quantity` entirely (src/billing/subscription.ts
         reads the price, not the count). So a reader on quantity 3 would pay
         three times for the same 150 ingests. Today that needs somebody to add
         "quantity" to the list above; saying `false` here means doing so is not
         also a pricing bug. */
      adjustable_quantity: { enabled: false },
    })),
    unpriced,
  };
}

/**
 * The tiers the Portal should offer a switch to, cheapest first.
 *
 * Not `offerableTiers` from src/billing/tiers.ts, which filters out a tier with
 * no price id — here an unpriced tier is the thing worth reporting, so it has to
 * survive the filter to be counted.
 */
function offerableTiersForPortal(tiers: readonly TierRow[]): readonly TierRow[] {
  return tiers
    .filter((t) => t.active)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** A product list as one comparable string, so order and grouping cannot fake a match. */
function productsKey(products: readonly { product: string; prices: readonly string[] }[]): string {
  return products
    .map((p) => `${p.product}[${[...p.prices].sort().join("+")}]`)
    .sort()
    .join(" ");
}

/**
 * **What the live configuration says that it should not**, one sentence each.
 *
 * Pure, and separate from the call that fixes it, because this is the half worth
 * testing: `ensurePortalConfiguration` used to return early on an existing
 * default and reconcile nothing, so editing the `features` block above changed
 * what a *fresh* account would get and left the live account exactly as it was.
 * The script's own header admitted it, and the upgrade path stayed shut for a
 * month. An empty array means the configuration matches.
 *
 * Every money-sensitive field is compared, not just the ones this job changed —
 * a hand-edited `subscription_cancel.mode` is the same class of invisible.
 */
export function portalDrift(
  live: Stripe.BillingPortal.Configuration,
  desired: DesiredPortal,
): string[] {
  /* **First, because it decides whether any of the rest is reachable.** An
     inactive configuration serves no Portal session at all, and every feature
     under it can read as perfectly correct while no reader ever gets to one.
     Pinned for the same reason `is_default` is asserted on create: being the
     right configuration and being a *usable* one are two questions.

     Not in `FEATURE_DRIFT` below because it is not a feature — it is a property
     of the configuration, and putting it there would need a sixth key the SDK
     does not declare, which is the one thing that map exists to refuse. */
  const drift: string[] = live.active
    ? []
    : ["the configuration is inactive — it can serve no Portal sessions"];

  for (const check of Object.values(FEATURE_DRIFT)) drift.push(...check(live.features, desired));
  drift.push(...uncomparedFeatures(live.features));
  return drift;
}

/**
 * **A live feature that is switched on and that nothing above compares.**
 *
 * The second of the two routes a sixth Portal feature can arrive by, and the
 * one no type can reach: `FEATURE_DRIFT` is keyed off the **SDK's** idea of the
 * feature list, and Stripe's API is free to return a key the installed SDK has
 * never heard of. That is not hypothetical in the other direction either —
 * `liveConfig` in tests/billing-portal-setup.test.ts has carried
 * `subscription_pause` since it was written, and the SDK does not declare it
 * (`node_modules/stripe/esm/resources/BillingPortal/Configurations.d.ts:88`).
 *
 * **Only when it is on, and that is the whole of the design.** `portalDrift`'s
 * output is a blocking `✗` in scripts/stripe-check.ts, under a line telling the
 * reader to run `stripe:setup --apply` — and an apply cannot remove a legacy key
 * Stripe keeps on the object. Reporting every unrecognised key would therefore
 * make that command permanently red with advice that cannot work, and a check
 * that cries wolf gets switched off (docs/reusable/silent-success.md is the
 * other half of the same lesson). An inert `{ enabled: false }` exposes no
 * control to any reader, so it is not drift. A feature that is **on** is a
 * Portal control nobody costed, which is exactly the money-sensitive case
 * docs/postmortems/260904a-four-billing-faults-and-the-witnesses-that-agreed-with-the-code.md
 * is about.
 *
 * The known set is derived from `FEATURE_DRIFT` rather than written out again:
 * a second list of the same five is the exact shape of the bug this file exists
 * to fix. GPT Sol, 2026-09-07.
 *
 * **Exhaustive over feature *names*, not over the fields inside each one.**
 * `payment_method_update` also carries `payment_method_configuration` and only
 * `enabled` is compared; that is a deliberate gap and this says nothing about
 * it.
 */
function uncomparedFeatures(features: Stripe.BillingPortal.Configuration.Features): string[] {
  const found: string[] = [];
  for (const [name, value] of Object.entries(features)) {
    /* `Object.hasOwn`, not `in`: `in` walks the prototype, so a feature Stripe
       named `toString` or `constructor` would read as already compared. GPT
       Sol — own-key membership is the actual question being asked. */
    if (Object.hasOwn(FEATURE_DRIFT, name)) continue;

    /* An inert feature exposes no control to any reader, so it is not drift.
       Anything else — on, or a shape with no `enabled` to read — is reported,
       and the sentence says which of those it saw rather than claiming the
       stronger one for both. Failing closed on an unreadable shape is
       deliberate; describing it as "switched on" was not. */
    const state = value as { enabled?: unknown } | null;
    if (typeof value === "object" && state !== null && state.enabled === false) continue;
    found.push(
      typeof value === "object" && state !== null && state.enabled === true
        ? `the Portal has ${name} switched on and nothing here compares it`
        : `the Portal has ${name}, whose state this cannot read, and nothing here compares it`,
    );
  }
  return found.sort();
}

/**
 * **Every feature Stripe's Portal has, and what we compare of each — keyed off
 * the SDK's own type, so a sixth cannot arrive unnoticed.**
 *
 * This was five hand-written `if`s until 2026-09-07. Today's SDK
 * (`stripe@22.6.1`,
 * `node_modules/stripe/esm/resources/BillingPortal/Configurations.d.ts:88`)
 * declares **exactly these five**, so that comparison was complete — by
 * coincidence of nobody having upgraded the SDK, which is not a property
 * anything was holding.
 *
 * A sixth feature going unnoticed is precisely how `subscription_update` was
 * missed, at the cost of a paying customer unable to upgrade for a month:
 * docs/postmortems/260904a-four-billing-faults-and-the-witnesses-that-agreed-with-the-code.md.
 * `Record<keyof …Features, …>` makes that a compile error — a sixth feature
 * cannot go in without somebody deciding what to do about it, and the decision
 * is forced at the moment the SDK moves rather than at the moment a reader
 * complains.
 *
 * **The map is load-bearing, not decoration**, and that distinction is the
 * whole reason `portalDrift` above iterates it rather than naming its members.
 * A key added only to satisfy the compiler, holding a function that returns
 * `[]`, would be a list saying *compared* over a comparison nobody wrote — the
 * shape of every entry in docs/reusable/silent-success.md. Each entry is driven
 * to produce drift, and then driven again against a correct configuration to
 * produce none, in tests/billing-portal-setup.test.ts § every Portal feature
 * the SDK declares is compared.
 *
 * ## The other way a sixth feature can arrive, and why nothing here catches it
 *
 * The live API can return a key the SDK's type does not declare —
 * `subscription_pause` is one, and `liveConfig` in that test file has carried it
 * since the fixture was written. Reporting an unrecognised key as drift was
 * weighed and **declined**: `portalDrift`'s output is a blocking `✗` in
 * `scripts/stripe-check.ts`, so a legacy key Stripe keeps on the object for ever
 * would make that command permanently and unfixably red — a check that cries
 * wolf gets switched off, which is the failure mode this whole tier of work
 * exists to prevent. Whoever next has the live account in front of them should
 * settle what it actually returns;
 * docs/plans/260907b-five-class-killers-from-the-postmortems-become-checks.md
 * § Stage 3 records the reasoning.
 *
 * Insertion order is the order the drift is reported in, and
 * `subscription_update` is first because it is the money-sensitive one and most
 * of the list.
 */
export const FEATURE_DRIFT: Record<
  keyof Stripe.BillingPortal.Configuration.Features,
  (f: Stripe.BillingPortal.Configuration.Features, desired: DesiredPortal) => string[]
> = {
  subscription_update: (f, desired) => planSwitchDrift(f.subscription_update, desired),

  subscription_cancel: (f) => {
    if (!f.subscription_cancel?.enabled) return ["subscription_cancel.enabled is false"];
    if (f.subscription_cancel.mode !== "at_period_end") {
      return [`subscription_cancel.mode is ${f.subscription_cancel.mode}, not at_period_end`];
    }
    return [];
  },

  invoice_history: (f) => (f.invoice_history?.enabled ? [] : ["invoice_history.enabled is false"]),

  payment_method_update: (f) =>
    f.payment_method_update?.enabled ? [] : ["payment_method_update.enabled is false"],

  customer_update: (f) => {
    if (!f.customer_update?.enabled) return ["customer_update.enabled is false"];
    const updates = [...f.customer_update.allowed_updates].sort().join(",");
    /* Exact equality, never "contains": an extra allowed update is a Portal
       control nobody costed. Same rule as `default_allowed_updates` above. */
    return updates === "address,email"
      ? []
      : [`customer_update.allowed_updates is [${updates || "empty"}]`];
  },
};

/** The `subscription_update` half — the money-sensitive one, and most of the list. */
function planSwitchDrift(
  update: Stripe.BillingPortal.Configuration.Features.SubscriptionUpdate,
  desired: DesiredPortal,
): string[] {
  const drift: string[] = [];

  /* **Nothing complete to switch between.** With no priced tier Stripe will not
     let the feature be on at all, and with a *partly* priced set the menu would
     be missing a plan — so `enabled: false` is the only state we would send, and
     complaining that it *is* false would be drift every run reports and none can
     fix. The missing prices are reported by the caller, which is the actionable
     half. */
  if (!complete(desired)) {
    if (update.enabled) {
      drift.push(
        desired.unpriced.length > 0
          ? `subscription_update is on while ${desired.unpriced.join(", ")} have no Stripe price, so the menu is missing a plan`
          : "subscription_update is on but no tier has a Stripe price to switch to",
      );
    }
    return drift;
  }

  if (!update.enabled) drift.push("subscription_update.enabled is false — no reader can switch plan");
  const allowed = [...update.default_allowed_updates].sort().join(",");
  if (allowed !== "price") {
    drift.push(
      `default_allowed_updates is [${allowed || "empty"}], not [price] — ` +
        (allowed.split(",").includes("price")
          ? "an extra update here is a Portal control nobody costed"
          : "without \"price\" the feature is on and the Portal still offers no switch"),
    );
  }
  /* Messages derived from the constant rather than naming a value, so the
     decision can change in one line without leaving prose behind that argues for
     the old one. */
  if (update.billing_cycle_anchor !== SUBSCRIPTION_UPDATE.billing_cycle_anchor) {
    drift.push(
      `billing_cycle_anchor is ${update.billing_cycle_anchor ?? "unset"}, not ` +
        `${SUBSCRIPTION_UPDATE.billing_cycle_anchor} — the quota window must not move on a ` +
        "plan change, or switching back and forth mints a fresh allowance for the credit " +
        "the last switch just refunded",
    );
  }
  if (update.proration_behavior !== SUBSCRIPTION_UPDATE.proration_behavior) {
    drift.push(
      `proration_behavior is ${update.proration_behavior}, not ${SUBSCRIPTION_UPDATE.proration_behavior}`,
    );
  }
  /* `trialing` is an entitled status (src/billing/tiers.ts), so `continue_trial`
     lets a trialling reader switch up and be metered at the larger allowance
     without having paid. */
  if (update.trial_update_behavior !== SUBSCRIPTION_UPDATE.trial_update_behavior) {
    drift.push(
      `trial_update_behavior is ${update.trial_update_behavior}, not ` +
        `${SUBSCRIPTION_UPDATE.trial_update_behavior} — a trialling reader could switch up and stay unpaid`,
    );
  }
  const liveProducts = productsKey(update.products ?? []);
  const wantProducts = productsKey(desired.products);
  if (liveProducts !== wantProducts) {
    drift.push(`products are ${liveProducts || "empty"}, want ${wantProducts || "empty"}`);
  }
  /* See `portalProducts`: Stripe defaults this on, and quantity is a multiplier
     on the money that entitlement does not read. */
  const adjustable = (update.products ?? []).filter((p) => p.adjustable_quantity.enabled);
  if (adjustable.length > 0) {
    drift.push(`adjustable_quantity is on for ${adjustable.map((p) => p.product).join(", ")}`);
  }
  /* Cleared by `portalUpdateFeatures` with `conditions: ""` — ordinary drift,
     fixed like any other. A condition here would schedule a downgrade for the
     period end, which Stripe only permits between prices on the same product. */
  if ((update.schedule_at_period_end?.conditions ?? []).length > 0) {
    const conditions = update.schedule_at_period_end.conditions.map((c) => c.type).join(",");
    drift.push(`schedule_at_period_end has conditions [${conditions}] and should have none`);
  }
  return drift;
}

/**
 * **Would the catalog we are about to write leave somebody with nowhere to go?**
 *
 * `stripe:check` asks this too, but a check is a preflight and this is the
 * write. Retiring a tier is what makes it necessary here as well: it drops that
 * tier's price out of `products` without anybody naming a subscriber, and the
 * run would then enable a plan menu those subscribers cannot appear in.
 * Enabling the feature for the first time has the same shape — which is the live
 * account's state today. GPT Sol, 2026-09-04.
 *
 * Only asked when the desired list is complete; an incomplete one is refused by
 * the caller on its own terms.
 *
 * ## The limit of this guard, and it is not closeable by scanning
 *
 * **A Checkout Session that has not completed yet is invisible here.** Retire a
 * tier, scan clean, write the menu — and an outstanding Session for the removed
 * price then completes into a subscriber the menu excludes. No amount of
 * enumeration fixes it: a Session can complete after the last page is read, and
 * `unfinishedSubscriptions` already documents the same race one level down for
 * cursor pagination. GPT Sol, 2026-09-04.
 *
 * Enumerating Sessions was considered and **not built**: it would narrow the
 * window without closing it, at the cost of a second paginated read and a second
 * definition of "about to be a subscriber". The safe procedure for a live
 * catalog removal is to expire outstanding Sessions for that price *first* —
 * docs/project/billing.md § Moving subscribers to a new price.
 */
async function whyNotWriteMenu(
  stripe: SubscriptionLookup,
  desired: DesiredPortal,
): Promise<string | null> {
  if (!complete(desired)) return null;
  const switchable = new Set(desired.products.flatMap((p) => p.prices));
  const stranded = (await unfinishedSubscriptions(stripe)).filter((s) =>
    s.items.data.some((i) => !switchable.has(i.price.id)),
  );
  if (stranded.length === 0) return null;
  return (
    `REFUSING to write the plan menu — ${stranded.length} unfinished subscription(s) bill on a ` +
    `price it would not list (${stranded.slice(0, 5).map((s) => s.id).join(", ")}` +
    `${stranded.length > 5 ? ", …" : ""}). They would have no plan to switch to. ` +
    "This is what retiring a tier, or repricing one, does to the people already on it."
  );
}

/**
 * Create (or find) the Customer Portal configuration.
 *
 * This is the whole of our self-serve billing UI: invoice history, payment
 * method, cancellation. Cancellation is `at_period_end` on purpose — nobody
 * loses access they have already paid for, and the subscription stays `active`
 * until the period closes, which is exactly what entitlement reads.
 *
 * ## It has to end up as the account *default*
 *
 * `portalUrl` (src/billing/checkout.ts) opens a Portal session without naming a
 * configuration, so it gets whatever the account default is. A configuration
 * that is not the default is dead weight no reader ever sees — and the branch
 * that creates one only runs on a mode that has none, which means it will run
 * for the first time ever on live day, unrehearsed. So it checks, and says which
 * it got. GPT Sol read Stripe's docs as saying an API-created configuration is
 * *never* the default; the one on this account carries our own `managed_by`
 * metadata **and** `is_default: true`, so that reading is not right here — which
 * is precisely why this asserts rather than assumes either way.
 *
 * ## An existing configuration is reconciled, not skipped
 *
 * This used to return early the moment a default existed, and reconcile nothing.
 * That is what made fault 1 survive: `features` decide money-sensitive
 * behaviour, so editing the block above changed what a *fresh* account would get
 * and left the live account exactly as it was — and `subscription_update` stayed
 * `{ enabled: false, default_allowed_updates: [] }` on the account taking real
 * money, so a paying Reader could not become a Researcher at all.
 *
 * The whole `features` block is sent on an update rather than the fields that
 * drifted, so what we assert and what we send cannot diverge. `portalDrift` says
 * which fields moved, one line each, on the dry run **and** on the apply — a
 * reconcile that only prints "updated" is a reconcile nobody can check.
 */
export async function ensurePortalConfiguration(
  tiers: readonly TierRow[],
  apply: boolean,
  /* Not a default parameter any more: `stripeClient()` is async, because the
     SDK is loaded inside it (src/billing/stripe.ts). A default cannot await. */
  injected?: StripePortalSetup,
): Promise<Step[]> {
  const stripe = injected ?? (await stripeClient());
  const { products, unpriced } = await portalProducts(stripe, tiers);
  const steps: Step[] = unpriced.map((id) => ({
    what: "portal",
    detail: `tier ${id} has no Stripe price yet, so the Portal cannot offer a switch to it`,
  }));
  const desired: DesiredPortal = { products, unpriced };

  /**
   * **Would the catalog we are about to write strand anybody?**
   *
   * `stripe:check` asks this too, but a check is a preflight and this is the
   * write. Retiring a tier is the case that makes it necessary here rather than
   * only there: it drops that tier's price out of `products` without anybody
   * naming a subscriber, and the run would enable a plan menu that the retired
   * tier's subscribers cannot appear in. Enabling the feature for the first time
   * has the same shape — which is the live account's state today.
   *
   * Only when there is something to write and a complete list to write it from;
   * an incomplete one is refused below on its own terms. GPT Sol, 2026-09-04.
   */
  const menuRefusal = await whyNotWriteMenu(stripe, desired);
  if (menuRefusal) {
    steps.push({ what: "portal", failed: true, detail: menuRefusal });
    return steps;
  }

  const existing = await stripe.billingPortal.configurations.list({
    is_default: true,
    limit: 1,
    expand: EXPAND_PORTAL_PRODUCTS,
  });
  const found = existing.data[0];

  if (found) {
    /* **Incomplete tier data must not mutate a working configuration.** A tier
       row that is active but has no `stripe_price_id` — a half-finished insert, a
       run against the wrong database, a price deleted in the dashboard — makes
       `products` a *smaller* list than the account actually sells. Reconciling
       against it would remove a live destination, or with none left disable plan
       switching altogether, on an account where it was working. Both are exactly
       the fault this stage exists to fix, arrived at from the other side.

       So the reconcile aborts and leaves what is there untouched. `{ enabled:
       false }` is only a reasonable answer when *creating* a first configuration
       for an account with nothing to sell yet. GPT Sol, 2026-09-03. */
    if (unpriced.length > 0 || products.length === 0) {
      steps.push({
        what: "portal",
        failed: true,
        detail:
          `REFUSING to touch ${found.id} — ` +
          (products.length === 0
            ? "no active tier has a Stripe price"
            : `${unpriced.length} active tier(s) have no Stripe price`) +
          ". Reconciling against a short list could remove a plan readers can currently switch to. " +
          "Fix the rows (or run the tier half of this script) and re-run.",
      });
      return steps;
    }

    const drift = portalDrift(found, desired);
    if (drift.length === 0) {
      steps.push({ what: "portal", detail: `default configuration ${found.id} already matches` });
      return steps;
    }
    for (const line of drift) {
      steps.push({ what: "portal", detail: `${apply ? "FIXING" : "DRIFT"} — ${line}` });
    }
    if (!apply) {
      steps.push({ what: "portal", detail: `would update ${found.id}. Nothing has changed yet.` });
      return steps;
    }
    const updated = await stripe.billingPortal.configurations.update(found.id, {
      business_profile: { headline: "Spideryarn — manage your subscription" },
      /* An inactive configuration serves nothing, so the reconcile reactivates. */
      active: true,
      /* Not `portalFeatures`: the update form is the one that can clear
         `schedule_at_period_end`. See `portalUpdateFeatures`. */
      features: portalUpdateFeatures(desired),
      /* Without `data.` — this reply is one object, not a list. */
      expand: ["features.subscription_update.products"],
    });
    /* Read back off the reply rather than trusting the 200: a successful-looking
       apply is not evidence the field landed. docs/reusable/silent-success.md. */
    const left = portalDrift(updated, desired);
    steps.push(
      left.length === 0
        ? { what: "portal", detail: `updated ${found.id}, and it now reads back correct` }
        : {
            what: "portal",
            failed: true,
            detail: `updated ${found.id} but it STILL reads back wrong: ${left.join("; ")}`,
          },
    );
    return steps;
  }

  if (!apply) {
    steps.push({ what: "portal", detail: "would create the default configuration" });
    return steps;
  }

  const configuration = await stripe.billingPortal.configurations.create({
    business_profile: { headline: "Spideryarn — manage your subscription" },
    features: portalFeatures(desired),
    metadata: { managed_by: "scripts/stripe-setup.ts" },
  });
  steps.push(
    { what: "portal", detail: `created ${configuration.id}` },
    configuration.is_default
      ? { what: "portal", detail: "and it is the account default, so Portal sessions will use it" }
      : {
          what: "portal",
          /* A configuration no reader can reach is not a configuration. `portalUrl`
             opens a session without naming one, so a non-default is dead weight —
             and printing that under the success footer, exit 0, is the same class
             as the refusal that used to do it. See `Step.failed`. */
          failed: true,
          detail:
            "but it is NOT the account default, so readers would get the dashboard's one instead — " +
            "make it the default before selling anything",
        },
  );
  return steps;
}

async function main(): Promise<void> {
  refuseUnknownArgs(process.argv, ["--apply", "--prod"]);
  const apply = process.argv.includes("--apply");
  /* Before anything reads the environment — it decides which Stripe account and
     which database everything below reaches. scripts/stripe-target.ts. */
  aimAtTarget(process.argv.includes("--prod"));

  /* **Before `stripeConfigProblem()`**, so the target is on screen even when
     the run is about to fail. A line you only get on the good path is a line
     that is missing exactly when you are trying to work out what went wrong. */
  console.log(`\nStripe setup — ${expectedLivemode() ? "LIVE" : "test"} mode, API ${STRIPE_API_VERSION}`);
  console.log(`  ${targetLine()}`);

  const problem = stripeConfigProblem();
  if (problem) throw new Error(problem);

  /* The account, before anything is created in it. `stripeConfigProblem` checks
     the key's mode; this checks whose account it opens. src/billing/stripe.ts. */
  const account = await (await stripeClient()).accounts.retrieveCurrent();
  const wrongAccount = accountProblem(account.id);
  if (wrongAccount && expectedLivemode()) throw new Error(wrongAccount);
  console.log(`  Account: ${account.id}${wrongAccount ? ` — ⚠ ${wrongAccount}` : ""}`);

  console.log(apply ? "  applying\n" : "  dry run; pass --apply to make changes\n");

  /* Uncached: this script is the thing that changes tiers, so reading a
     thirty-second-old snapshot of them would be reading its own stale work. */
  const tiers = await readTiers();
  if (tiers.length === 0) {
    /* **Non-zero, and it is not pedantry.** An empty `billing_tiers` is the
       shape a run against the wrong database takes: the script finds nothing to
       sell, does nothing, and says so calmly. Exiting 0 there tells a release
       gate the account is configured. This branch sits outside the `Step`
       machinery, which is why it needed its own line. GPT Sol, 2026-09-03. */
    console.log("  ✗ No rows in billing_tiers. Nothing to sell — is this the database you meant?");
    console.log("  docs/project/billing.md § Adding a tier or a currency\n");
    process.exitCode = 1;
    return;
  }

  const steps: Step[] = [];
  for (const tier of tiers) steps.push(...(await ensureTier(tier, apply)));

  /* **Re-read, because the loop above just wrote `stripe_price_id`.** The Portal's
     `products` list is built from those ids, and the array in memory is the one
     read before any of them existed — so on a first-ever `--apply` the plan-switch
     feature would be configured with no destinations, and the run would still
     print success. Only when applying: a dry run wrote nothing to re-read, and
     "would create the price" then "no price yet" is the honest pair of lines. */
  const priced = apply ? await readTiers() : tiers;
  steps.push(...(await ensurePortalConfiguration(priced, apply)));
  for (const step of steps) console.log(`  ${step.what.padEnd(11)} ${step.detail}`);

  /* **The closing line has to agree with what happened.** A refusal or a failed
     read-back printed under "there is nothing to paste anywhere", with exit 0,
     is the failure mode this whole job is about. See `Step.failed`. */
  const failed = steps.filter((s) => s.failed);
  if (failed.length > 0) {
    console.log(`\n  ✗ ${failed.length} step(s) did NOT do what was asked. Stripe is not as this script wants it.\n`);
    process.exitCode = 1;
    return;
  }

  console.log(
    apply
      ? "\n  Price ids are on the billing_tiers rows. There is nothing to paste anywhere.\n"
      : "\n  Nothing changed. Pass --apply.\n",
  );
}

if (isMain(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
