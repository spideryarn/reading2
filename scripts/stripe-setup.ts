/**
 * Create the Stripe objects this app sells against — products, prices, portal.
 *
 *     npx tsx scripts/stripe-setup.ts            # say what it would do
 *     npx tsx scripts/stripe-setup.ts --apply    # do it
 *
 * **Why a script rather than the dashboard.** Everything here is reproducible: a
 * fresh test account, a second developer, and go-live in live mode all need the
 * same objects, and a click-path is neither reviewable nor re-runnable. Greg's
 * manual surface stays the account itself, the keys, and the handful of settings
 * Stripe exposes only in the dashboard —
 * docs/plans/260902i-stripe-payments-and-subscription-tiers.md.
 *
 * **It walks `PAID_TIERS`** (src/billing/tiers.ts) rather than hardcoding
 * anything, so adding a tier or a currency is an edit to that table and a
 * re-run of this. docs/project/billing.md § Adding a tier or a currency.
 *
 * ## Idempotent by lookup key, and honest about price immutability
 *
 * A product name is a label a human may edit; `lookupKey` is a handle Stripe
 * indexes and enforces unique per mode. So re-running finds what it made last
 * time instead of minting a second price nobody notices until two customers are
 * on different ones.
 *
 * **Stripe prices are immutable.** You cannot change an amount, and you cannot
 * add a currency to a price that already exists — which is exactly what
 * happened on 2026-09-02 when the Reader tier gained GBP and EUR. So when the
 * amounts here differ from the live price, this creates a **new** price and
 * moves the lookup key onto it with `transfer_lookup_key`, leaving the old one
 * in place and unarchived. That is deliberate: existing subscriptions keep
 * billing on the price they were sold, and moving them is a separate, visible
 * decision rather than a side effect of running a setup script.
 */
import {
  STRIPE_API_VERSION,
  expectedLivemode,
  stripeClient,
  stripeConfigProblem,
} from "../src/billing/stripe.js";
import { CURRENCIES, PAID_TIERS, type TierSpec } from "../src/billing/tiers.js";
import { loadEnvLocal } from "../src/env.js";
import { isMain } from "../src/is-main.js";

/** Marks the objects this script owns, so a hand-made one is never adopted. */
const managed = (spec: TierSpec) => ({
  managed_by: "scripts/stripe-setup.ts",
  lookup_key: spec.lookupKey,
  tier: spec.id,
});

/** What the price should cost, in the shape Stripe wants it. */
function amountsFor(spec: TierSpec) {
  const [base, ...rest] = CURRENCIES;
  return {
    currency: base,
    unit_amount: spec.amounts[base],
    currency_options: Object.fromEntries(
      rest.map((c) => [c, { unit_amount: spec.amounts[c] }]),
    ),
  };
}

/** Is the live price already exactly what the table says it should be? */
function matches(price: { unit_amount: number | null; currency: string; recurring: { interval: string } | null; active: boolean; currency_options?: Record<string, { unit_amount: number | null }> | null }, spec: TierSpec): string[] {
  const wrong: string[] = [];
  const [base, ...rest] = CURRENCIES;
  if (!price.active) wrong.push("it is archived");
  if (price.currency !== base) wrong.push(`base currency is ${price.currency}`);
  if (price.unit_amount !== spec.amounts[base]) wrong.push(`${base} is ${price.unit_amount}`);
  if (price.recurring?.interval !== "month") wrong.push(`interval is ${price.recurring?.interval}`);
  for (const c of rest) {
    const got = price.currency_options?.[c]?.unit_amount;
    if (got !== spec.amounts[c]) wrong.push(`${c} is ${got ?? "absent"}`);
  }
  return wrong;
}

export interface Step {
  readonly what: string;
  readonly detail: string;
}

/**
 * Bring the product's customer-visible name and description into line.
 *
 * Separate from the price because the rules are opposite: a price is immutable
 * and a mismatch means creating a new one, while a product's words are
 * ordinary mutable fields and a mismatch just means somebody edited the table.
 */
async function syncProductWords(
  product: string | { id: string; name?: string; description?: string | null },
  spec: TierSpec,
  apply: boolean,
  steps: Step[],
): Promise<void> {
  const stripe = stripeClient();
  const full = typeof product === "string" ? await stripe.products.retrieve(product) : product;
  const stale =
    full.name !== spec.productName || (full.description ?? "") !== spec.description;
  if (!stale) return;

  if (!apply) {
    steps.push({ what: spec.id, detail: `would update the product's name/description on ${full.id}` });
    return;
  }
  await stripe.products.update(full.id, {
    name: spec.productName,
    description: spec.description,
  });
  steps.push({ what: spec.id, detail: `updated the product's name/description on ${full.id}` });
}

/** Create (or find, or replace) one tier's product and price. */
export async function ensureTier(
  spec: TierSpec,
  apply: boolean,
): Promise<{ priceId: string | null; steps: Step[] }> {
  const stripe = stripeClient();
  const steps: Step[] = [];
  const money = CURRENCIES.map((c) => `${(spec.amounts[c] / 100).toFixed(2)} ${c.toUpperCase()}`).join(" / ");

  const existing = await stripe.prices.list({
    lookup_keys: [spec.lookupKey],
    expand: ["data.currency_options"],
    limit: 2,
  });
  const live = existing.data[0];

  if (live) {
    /* **The product's words are mutable and the price's numbers are not**, so
       they reconcile differently. A description saying "100 articles a month"
       outlived the quota changing to 20 by exactly one run of this script,
       because the first version only ever set these at creation — and a stale
       description is on the Checkout page, where a customer reads it. */
    await syncProductWords(live.product, spec, apply, steps);

    const wrong = matches(live, spec);
    if (wrong.length === 0) {
      steps.push({ what: spec.id, detail: `price is already ${money} — ${live.id}` });
      return { priceId: live.id, steps };
    }
    if (!apply) {
      steps.push({
        what: spec.id,
        detail: `would REPLACE ${live.id} (${wrong.join(", ")}) with a new price at ${money}`,
      });
      return { priceId: null, steps };
    }
    /* A new price on the same product, taking the lookup key with it. The old
       one keeps any subscriptions already on it. */
    const replacement = await stripe.prices.create({
      product: typeof live.product === "string" ? live.product : live.product.id,
      lookup_key: spec.lookupKey,
      transfer_lookup_key: true,
      recurring: { interval: "month" },
      metadata: managed(spec),
      ...amountsFor(spec),
    });
    steps.push({
      what: spec.id,
      detail: `replaced ${live.id} (${wrong.join(", ")}) with ${replacement.id} at ${money}`,
    });
    return { priceId: replacement.id, steps };
  }

  if (!apply) {
    steps.push({ what: spec.id, detail: `would create "${spec.productName}" at ${money}` });
    return { priceId: null, steps };
  }

  const found = await stripe.products.search({
    query: `metadata['lookup_key']:'${spec.lookupKey}'`,
    limit: 2,
  });
  const product =
    found.data[0] ??
    (await stripe.products.create({
      name: spec.productName,
      description: spec.description,
      metadata: managed(spec),
    }));

  const price = await stripe.prices.create({
    product: product.id,
    lookup_key: spec.lookupKey,
    recurring: { interval: "month" },
    metadata: managed(spec),
    ...amountsFor(spec),
  });
  steps.push({
    what: spec.id,
    detail: `${found.data[0] ? "found" : "created"} ${product.id}, created price ${price.id} at ${money}`,
  });
  return { priceId: price.id, steps };
}

/**
 * Create (or find) the Customer Portal configuration.
 *
 * This is the whole of our self-serve billing UI: invoice history, payment
 * method, cancellation. Cancellation is `at_period_end` on purpose — nobody
 * loses access they have already paid for, and the subscription stays `active`
 * until the period closes, which is exactly what entitlement reads.
 */
export async function ensurePortalConfiguration(apply: boolean): Promise<{ id: string | null; steps: Step[] }> {
  const stripe = stripeClient();
  const steps: Step[] = [];

  const existing = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
  const found = existing.data[0];
  if (found) {
    steps.push({ what: "portal", detail: `default configuration already exists — ${found.id}` });
    return { id: found.id, steps };
  }
  if (!apply) {
    steps.push({ what: "portal", detail: "would create the default configuration" });
    return { id: null, steps };
  }

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
  steps.push({ what: "portal", detail: `created ${configuration.id}` });
  return { id: configuration.id, steps };
}

async function main(): Promise<void> {
  loadEnvLocal();
  const apply = process.argv.includes("--apply");

  const problem = stripeConfigProblem();
  if (problem) throw new Error(problem);

  console.log(`\nStripe setup — ${expectedLivemode() ? "LIVE" : "test"} mode, API ${STRIPE_API_VERSION}`);
  console.log(apply ? "  applying\n" : "  dry run; pass --apply to make changes\n");

  const env: string[] = [];
  const steps: Step[] = [];
  for (const spec of PAID_TIERS) {
    const result = await ensureTier(spec, apply);
    steps.push(...result.steps);
    if (result.priceId) env.push(`${spec.envVar}=${result.priceId}`);
  }
  const portal = await ensurePortalConfiguration(apply);
  steps.push(...portal.steps);

  for (const step of steps) console.log(`  ${step.what.padEnd(11)} ${step.detail}`);

  if (env.length > 0) {
    console.log("\n  Put these in .env.local (and in Vercel, for a live run):\n");
    for (const line of env) console.log(`      ${line}`);
    console.log();
  }
}

if (isMain(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
