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
import { isMain } from "../src/is-main.js";
import { readTiers, recordTierPrice } from "../src/store/pg-tiers.js";

import { aimAtTarget, refuseUnknownArgs, targetLine } from "./stripe-target.js";

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
  /* See TAX_BEHAVIOR. `unspecified` is the default and charges tax on top, so
     a price carrying it is one that overcharges — worth replacing, and it can
     only be fixed by replacing. */
  if (price.tax_behavior !== TAX_BEHAVIOR) wrong.push(`tax behaviour is ${price.tax_behavior}`);
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
const PRODUCT_TAX_CODE = "txcd_10103000";

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
  product: string | Stripe.Product | Stripe.DeletedProduct,
  tier: TierRow,
  apply: boolean,
  steps: Step[],
): Promise<void> {
  const stripe = await stripeClient();
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

/** Create, find or replace one tier's product and price, and record the id. */
export async function ensureTier(tier: TierRow, apply: boolean): Promise<Step[]> {
  const stripe = await stripeClient();
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
 * `features` are not reconciled on a configuration that already exists. Note the
 * gap that leaves: they decide money-sensitive behaviour, so a hand-edited
 * `subscription_cancel` is invisible here. Reporting that drift is worth doing
 * and is not done.
 */
export async function ensurePortalConfiguration(
  apply: boolean,
  /* Not a default parameter any more: `stripeClient()` is async, because the
     SDK is loaded inside it (src/billing/stripe.ts). A default cannot await. */
  injected?: StripePortalSetup,
): Promise<Step[]> {
  const stripe = injected ?? (await stripeClient());
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
  return [
    { what: "portal", detail: `created ${configuration.id}` },
    configuration.is_default
      ? { what: "portal", detail: "and it is the account default, so Portal sessions will use it" }
      : {
          what: "portal",
          detail:
            "but it is NOT the account default, so readers would get the dashboard's one instead — " +
            "make it the default before selling anything",
        },
  ];
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
