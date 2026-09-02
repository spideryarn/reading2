/**
 * Make Stripe match what the database says we sell.
 *
 *     npx tsx scripts/stripe-setup.ts            # say what it would do
 *     npx tsx scripts/stripe-setup.ts --apply    # do it
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
  expectedLivemode,
  stripeClient,
  stripeConfigProblem,
} from "../src/billing/stripe.js";
import type { TierRow } from "../src/billing/tiers.js";
import { loadEnvLocal } from "../src/env.js";
import { isMain } from "../src/is-main.js";
import { readTiers, recordTierPrice } from "../src/store/pg-tiers.js";

/** Marks the objects this script owns, so a hand-made one is never adopted. */
const managed = (tier: TierRow) => ({
  managed_by: "scripts/stripe-setup.ts",
  lookup_key: tier.lookupKey,
  tier: tier.id,
});

export interface Step {
  readonly what: string;
  readonly detail: string;
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

/** The price fields, in the shape Stripe wants them. */
function amountsFor(tier: TierRow) {
  const [base, ...rest] = currenciesOf(tier);
  if (!base) throw new Error(`tier ${tier.id} has no prices — add rows to billing_tier_prices`);
  return {
    currency: base,
    unit_amount: tier.amounts[base] as number,
    currency_options: Object.fromEntries(
      rest.map((c) => [c, { unit_amount: tier.amounts[c] as number }]),
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
  for (const c of rest) {
    const got = price.currency_options?.[c]?.unit_amount;
    if (got !== tier.amounts[c]) wrong.push(`${c} is ${got ?? "absent"}`);
  }
  return wrong;
}

/**
 * Bring the product's customer-visible name and description into line.
 *
 * Separate from the price because the rules are opposite: a price is immutable
 * and a mismatch means creating a new one, while a product's words are ordinary
 * mutable fields and a mismatch just means somebody edited the row.
 */
async function syncProductWords(
  product: string | Stripe.Product | Stripe.DeletedProduct,
  tier: TierRow,
  apply: boolean,
  steps: Step[],
): Promise<void> {
  const stripe = stripeClient();
  const full = typeof product === "string" ? await stripe.products.retrieve(product) : product;
  if ("deleted" in full && full.deleted) return;
  const live = full as Stripe.Product;
  if (live.name === tier.productName && (live.description ?? "") === tier.description) return;

  if (!apply) {
    steps.push({ what: tier.id, detail: `would update the product's name/description on ${live.id}` });
    return;
  }
  await stripe.products.update(live.id, { name: tier.productName, description: tier.description });
  steps.push({ what: tier.id, detail: `updated the product's name/description on ${live.id}` });
}

/** Create, find or replace one tier's product and price, and record the id. */
export async function ensureTier(tier: TierRow, apply: boolean): Promise<Step[]> {
  const stripe = stripeClient();
  const steps: Step[] = [];

  if (Object.keys(tier.amounts).length === 0) {
    steps.push({ what: tier.id, detail: "SKIPPED — no rows in billing_tier_prices" });
    return steps;
  }

  const existing = await stripe.prices.list({
    lookup_keys: [tier.lookupKey],
    expand: ["data.currency_options", "data.product"],
    limit: 2,
  });
  const live = existing.data[0];

  if (live) {
    await syncProductWords(live.product, tier, apply, steps);
    const wrong = differences(live, tier);
    if (wrong.length === 0) {
      steps.push({ what: tier.id, detail: `price is already ${money(tier)} — ${live.id}` });
      if (apply && tier.stripePriceId !== live.id) {
        await recordTierPrice(tier.id, live.id, live.livemode);
        steps.push({ what: tier.id, detail: `recorded ${live.id} on the row` });
      }
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
 * Create (or find) the Customer Portal configuration.
 *
 * This is the whole of our self-serve billing UI: invoice history, payment
 * method, cancellation. Cancellation is `at_period_end` on purpose — nobody
 * loses access they have already paid for, and the subscription stays `active`
 * until the period closes, which is exactly what entitlement reads.
 */
export async function ensurePortalConfiguration(apply: boolean): Promise<Step[]> {
  const stripe = stripeClient();
  const existing = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
  const found = existing.data[0];
  if (found) return [{ what: "portal", detail: `default configuration already exists — ${found.id}` }];
  if (!apply) return [{ what: "portal", detail: "would create the default configuration" }];

  const configuration = await stripe.billingPortal.configurations.create({
    business_profile: { headline: "Spideryarn — manage your subscription" },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      /* Email and address, because they appear on the invoice and a customer
         who cannot fix them has to email us instead. Not `tax_id`: we are not
         registered for VAT and offering the field implies we are. */
      customer_update: { enabled: true, allowed_updates: ["email", "address"] },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
    },
    metadata: { managed_by: "scripts/stripe-setup.ts" },
  });
  return [{ what: "portal", detail: `created ${configuration.id}` }];
}

async function main(): Promise<void> {
  loadEnvLocal();
  const apply = process.argv.includes("--apply");

  const problem = stripeConfigProblem();
  if (problem) throw new Error(problem);

  console.log(`\nStripe setup — ${expectedLivemode() ? "LIVE" : "test"} mode, API ${STRIPE_API_VERSION}`);
  console.log(apply ? "  applying\n" : "  dry run; pass --apply to make changes\n");

  /* Uncached: this script is the thing that changes tiers, so reading a
     thirty-second-old snapshot of them would be reading its own stale work. */
  const tiers = await readTiers();
  if (tiers.length === 0) {
    console.log("  No rows in billing_tiers. Nothing to sell, and nothing to do.");
    console.log("  docs/project/billing.md § Adding a tier or a currency\n");
    return;
  }

  const steps: Step[] = [];
  for (const tier of tiers) steps.push(...(await ensureTier(tier, apply)));
  steps.push(...(await ensurePortalConfiguration(apply)));
  for (const step of steps) console.log(`  ${step.what.padEnd(11)} ${step.detail}`);

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
