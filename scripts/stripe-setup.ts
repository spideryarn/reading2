/**
 * Create the Stripe objects this app sells against — product, price, portal.
 *
 *     npx tsx scripts/stripe-setup.ts            # say what it would do
 *     npx tsx scripts/stripe-setup.ts --apply    # do it
 *
 * **Why a script rather than the dashboard.** Everything here is reproducible:
 * a fresh test account, a second developer, and go-live in live mode all need
 * the same three objects, and a click-path is neither reviewable nor
 * re-runnable. Greg's manual surface stays the account itself, the keys, and the
 * handful of settings Stripe exposes only in the dashboard —
 * docs/plans/260902i-stripe-payments-and-subscription-tiers.md.
 *
 * **Idempotent by lookup key, not by name.** A product name is a label a human
 * may edit; `PRICE_LOOKUP_KEY` is a handle Stripe indexes and enforces unique
 * per mode. So re-running finds what it made last time instead of minting a
 * second $10 price nobody notices until two customers are on different ones.
 * Prices are immutable in Stripe — to change the amount you create a new price
 * and move `STRIPE_PRICE_READER`, which this script will refuse to do silently:
 * a lookup key already pointing at a different amount is an error, not an
 * upgrade.
 *
 * **Mode comes from the key, and the key must match the deployment**
 * (src/billing/stripe.ts). Run with the test key on a laptop or the box; the
 * live run happens once, at go-live, from an environment configured for it.
 */
import { isMain } from "../src/is-main.js";
import {
  STRIPE_API_VERSION,
  expectedLivemode,
  stripeClient,
  stripeConfigProblem,
} from "../src/billing/stripe.js";
import { loadEnvLocal } from "../src/env.js";

/** The handle that makes this script idempotent. Never change it. */
export const PRICE_LOOKUP_KEY = "spideryarn_reader_monthly";

/** What the paid tier costs, in the smallest currency unit. */
export const READER_PRICE = { unitAmount: 1000, currency: "usd", interval: "month" } as const;

/** The product's customer-visible name. Safe to edit; not an identifier. */
export const PRODUCT_NAME = "Spideryarn Reader";

const PRODUCT_DESCRIPTION = "100 article ingests a month. Reading what you have already added is always free.";

/** Marks the objects this script owns, so a hand-made one is never adopted. */
const MANAGED = { managed_by: "scripts/stripe-setup.ts", lookup_key: PRICE_LOOKUP_KEY };

interface Plan {
  readonly what: string;
  readonly detail: string;
}

/**
 * Create (or find) the product and the price.
 *
 * @returns the price id to put in `STRIPE_PRICE_READER`, and what it did.
 */
export async function ensureReaderPrice(apply: boolean): Promise<{ priceId: string | null; steps: Plan[] }> {
  const stripe = stripeClient();
  const steps: Plan[] = [];

  const existing = await stripe.prices.list({ lookup_keys: [PRICE_LOOKUP_KEY], expand: ["data.product"], limit: 2 });
  const found = existing.data[0];
  if (found) {
    /* Refuse rather than adopt a price that is not what the code sells. A
       mismatch means somebody changed the pricing in the dashboard, and the
       right response is a new price and a deliberate move of the env var. */
    const wrong: string[] = [];
    if (found.unit_amount !== READER_PRICE.unitAmount) wrong.push(`amount is ${found.unit_amount}`);
    if (found.currency !== READER_PRICE.currency) wrong.push(`currency is ${found.currency}`);
    if (found.recurring?.interval !== READER_PRICE.interval) wrong.push(`interval is ${found.recurring?.interval}`);
    if (!found.active) wrong.push("it is archived");
    if (wrong.length > 0) {
      throw new Error(
        `A price already carries the lookup key ${PRICE_LOOKUP_KEY}, but ${wrong.join(", ")}. ` +
          `Stripe prices are immutable: archive it and change PRICE_LOOKUP_KEY, or fix READER_PRICE to match.`,
      );
    }
    steps.push({ what: "price", detail: `already exists — ${found.id}` });
    return { priceId: found.id, steps };
  }

  if (!apply) {
    steps.push({ what: "product", detail: `would create "${PRODUCT_NAME}"` });
    steps.push({
      what: "price",
      detail: `would create ${READER_PRICE.unitAmount / 100} ${READER_PRICE.currency.toUpperCase()}/${READER_PRICE.interval}, lookup key ${PRICE_LOOKUP_KEY}`,
    });
    return { priceId: null, steps };
  }

  const products = await stripe.products.search({ query: `metadata['lookup_key']:'${PRICE_LOOKUP_KEY}'`, limit: 2 });
  const product =
    products.data[0] ??
    (await stripe.products.create({
      name: PRODUCT_NAME,
      description: PRODUCT_DESCRIPTION,
      metadata: MANAGED,
    }));
  steps.push({ what: "product", detail: `${products.data[0] ? "found" : "created"} ${product.id}` });

  const price = await stripe.prices.create({
    product: product.id,
    lookup_key: PRICE_LOOKUP_KEY,
    unit_amount: READER_PRICE.unitAmount,
    currency: READER_PRICE.currency,
    recurring: { interval: READER_PRICE.interval },
    metadata: MANAGED,
  });
  steps.push({ what: "price", detail: `created ${price.id}` });
  return { priceId: price.id, steps };
}

/**
 * Create (or find) the Customer Portal configuration.
 *
 * This is the whole of our self-serve billing UI: invoice history, payment
 * method, cancellation. Cancellation is `at_period_end` on purpose — nobody
 * loses access they have already paid for, and the subscription stays
 * `active` until the period closes, which is exactly what `entitlementFor`
 * reads.
 */
export async function ensurePortalConfiguration(apply: boolean): Promise<{ id: string | null; steps: Plan[] }> {
  const stripe = stripeClient();
  const steps: Plan[] = [];

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
    metadata: MANAGED,
  });
  steps.push({ what: "portal", detail: `created ${configuration.id}` });
  return { id: configuration.id, steps };
}

async function main(): Promise<void> {
  loadEnvLocal();
  const apply = process.argv.includes("--apply");

  const problem = stripeConfigProblem();
  if (problem) throw new Error(problem);

  const mode = expectedLivemode() ? "LIVE" : "test";
  console.log(`\nStripe setup — ${mode} mode, API ${STRIPE_API_VERSION}`);
  console.log(apply ? "  applying\n" : "  dry run; pass --apply to make changes\n");

  const price = await ensureReaderPrice(apply);
  const portal = await ensurePortalConfiguration(apply);
  for (const step of [...price.steps, ...portal.steps]) {
    console.log(`  ${step.what.padEnd(8)} ${step.detail}`);
  }

  if (price.priceId) {
    console.log(`\n  Put this in .env.local (and in Vercel, for a live run):\n`);
    console.log(`      STRIPE_PRICE_READER=${price.priceId}\n`);
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
