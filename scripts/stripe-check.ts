/**
 * Is this Stripe account actually ready to take money?
 *
 *     npm run stripe:check              # the sandbox, and this laptop
 *     npm run stripe:check -- --prod    # LIVE, and the production database
 *
 * **Read-only.** It creates nothing, changes nothing, and charges nothing —
 * which is the point: it is the thing you run against *live* before trusting it,
 * and against a sandbox to see whether the two agree. `scripts/stripe-setup.ts`
 * is the one that writes.
 *
 * ## Why this exists at all
 *
 * Because every failure this feature has had was something reporting success
 * while doing nothing, and Stripe has a lot of surface that looks fine until a
 * customer reads it. On 2026-09-03 alone, driving one real purchase found a
 * product that could not be sold at all (no `tax_code`), a €9 plan charging
 * €10.71 (`tax_behavior` defaulting to exclusive) and a Checkout page headed
 * "Greg's side-projects (e.g. Spideryarn) sandbox". None of those is visible to
 * a unit test, and the first two are invisible until somebody pays.
 *
 * Live mode gets exactly one first customer, so the checks they would have
 * found are written down here instead of re-derived.
 *
 * ## Reading the output
 *
 * `✓` is fine, `⚠` is worth a look and does not fail, `✗` means do not sell.
 * The exit code is non-zero if anything is `✗`, so this can gate a release.
 *
 * ## The mode guard applies
 *
 * It builds its client through [`src/billing/stripe.ts`](../src/billing/stripe.ts)
 * like everything else, so a live key needs `VERCEL_ENV=production` and a test
 * key needs the absence of it. That is deliberate friction: reaching live is
 * meant to be a thing you typed on purpose, and `--prod` is that thing — it
 * loads the live key and sets `VERCEL_ENV` in one move, so there is no second
 * value to get wrong. Set them by hand and they can still disagree, which the
 * mode guard then refuses. scripts/stripe-target.ts.
 */
import type Stripe from "stripe";

import { PUBLIC_ORIGIN } from "../src/urls.js";
import { HANDLED_EVENTS, WEBHOOK_PATH } from "../src/billing/webhook.js";
import { accountProblem, expectedLivemode, stripeClient, stripeConfigProblem } from "../src/billing/stripe.js";
import type { TierRow } from "../src/billing/tiers.js";
import { offerableTiers } from "../src/billing/tiers.js";
import { isMain } from "../src/is-main.js";
import { readTiers } from "../src/store/pg-tiers.js";

import { aimAtTarget, refuseUnknownArgs, targetLine } from "./stripe-target.js";

/** One line of the report. `bad` is what decides the exit code. */
interface Check {
  readonly mark: "✓" | "⚠" | "✗";
  readonly what: string;
  readonly detail: string;
}

const ok = (what: string, detail: string): Check => ({ mark: "✓", what, detail });
const warn = (what: string, detail: string): Check => ({ mark: "⚠", what, detail });
const bad = (what: string, detail: string): Check => ({ mark: "✗", what, detail });

/**
 * The account as a customer meets it.
 *
 * `business_profile.name` is singled out because it is the name printed on the
 * hosted Checkout page while somebody types their card, and it defaults to
 * whatever the account was nicknamed at signup — which is how a payment page
 * ends up headed "sandbox".
 */
async function checkAccount(stripe: Stripe): Promise<Check[]> {
  /* `retrieveCurrent`, not `retrieve` — the latter wants a `acct_…` and is for
     Connect's connected accounts. This is the one that maps to `/v1/account`. */
  const account = await stripe.accounts.retrieveCurrent();
  const checks: Check[] = [];
  const profile = account.business_profile;
  const settings = account.settings;

  checks.push(ok("account", `${account.id} — ${account.country} / ${account.default_currency?.toUpperCase()}`));

  const name = profile?.name;
  if (!name) {
    checks.push(bad("business name", "unset — the Checkout page will have nothing to call you"));
  } else if (/sandbox|test|side.?project/i.test(name)) {
    checks.push(bad("business name", `"${name}" — this prints on the Checkout page a customer pays on`));
  } else {
    checks.push(ok("business name", `"${name}" — what the Checkout page says`));
  }

  const descriptor = settings?.payments?.statement_descriptor;
  checks.push(
    descriptor
      ? ok("statement descriptor", `"${descriptor}" — what their bank statement says`)
      : warn("statement descriptor", "unset — a customer who cannot place the charge disputes it"),
  );

  checks.push(
    profile?.support_email
      ? ok("support email", profile.support_email)
      : warn("support email", "unset — receipts and invoices have no address to reply to"),
  );

  /* An empty string and a null both mean "no image", and Stripe returns both. */
  const branding = settings?.branding;
  const hasArt = Boolean(branding?.logo) || Boolean(branding?.icon);
  checks.push(
    hasArt
      ? ok("branding", "a logo or icon is set")
      : warn("branding", "no logo or icon — Checkout, the Portal, invoices and receipts all use it"),
  );

  if (expectedLivemode() && !account.charges_enabled) {
    checks.push(bad("charges", "this account cannot take payments — finish activation"));
  }

  /* **Whose account, not just which mode.** The key guard checks live-vs-test;
     Greg has a second live account for his consulting work, and its key passes
     every other check here while being the wrong place to sell from.
     src/billing/stripe.ts § SPIDERYARN_ACCOUNTS. */
  const wrongAccount = accountProblem(account.id);
  if (wrongAccount) {
    checks.push(expectedLivemode() ? bad("identity", wrongAccount) : warn("identity", wrongAccount));
  } else {
    checks.push(ok("identity", "this is Spideryarn's own account"));
  }
  return checks;
}

/** Everything about one tier: its product, its price, and the row that sells it. */
async function checkTier(stripe: Stripe, tier: TierRow): Promise<Check[]> {
  const checks: Check[] = [];
  const found = await stripe.prices.list({
    lookup_keys: [tier.lookupKey],
    expand: ["data.currency_options", "data.product"],
    limit: 2,
  });
  const price = found.data[0];
  if (!price) {
    return [bad(tier.id, `no Stripe price carries lookup key ${tier.lookupKey} — run scripts/stripe-setup.ts`)];
  }

  /* **The row and Stripe must name the same price.** They drift when the script
     has been run against one database and the app reads another, and the symptom
     is a Checkout that sells last month's amount. */
  checks.push(
    tier.stripePriceId === price.id
      ? ok(tier.id, `row and Stripe agree on ${price.id}`)
      : bad(tier.id, `the row says ${tier.stripePriceId ?? "nothing"} but Stripe's lookup key is on ${price.id}`),
  );

  if (price.livemode !== expectedLivemode()) {
    checks.push(bad(tier.id, `price livemode is ${price.livemode}, expected ${expectedLivemode()}`));
  }
  if (!price.active) checks.push(bad(tier.id, `${price.id} is archived and cannot be sold`));
  if (price.recurring?.interval !== "month") {
    checks.push(bad(tier.id, `interval is ${price.recurring?.interval ?? "none"}, not monthly`));
  }

  /* See TAX_BEHAVIOR in scripts/stripe-setup.ts. `unspecified` adds tax on top
     of the advertised price, which is the €9-becomes-€10.71 bug. */
  const behaviours = [
    price.tax_behavior,
    ...Object.values(price.currency_options ?? {}).map((o) => o.tax_behavior),
  ];
  const wrongTax = behaviours.filter((b) => b !== "inclusive");
  checks.push(
    wrongTax.length === 0
      ? ok(tier.id, "prices are tax-inclusive, so the number on the page is the number charged")
      : bad(tier.id, `${wrongTax.length} of ${behaviours.length} amounts are "${wrongTax[0]}" — tax will be added on top`),
  );

  /* Every currency the row offers must exist on the price, at the row's amount:
     a missing one silently falls back to the base currency at its number. */
  for (const [currency, amount] of Object.entries(tier.amounts)) {
    const got =
      currency === price.currency ? price.unit_amount : price.currency_options?.[currency]?.unit_amount;
    if (got !== amount) {
      checks.push(bad(tier.id, `${currency.toUpperCase()} is ${got ?? "absent"} on Stripe, ${amount} on the row`));
    }
  }

  const product = price.product;
  if (typeof product !== "string" && !("deleted" in product && product.deleted)) {
    const taxCode = typeof product.tax_code === "string" ? product.tax_code : product.tax_code?.id;
    checks.push(
      taxCode
        ? ok(tier.id, `product ${product.id} has tax code ${taxCode}`)
        : bad(tier.id, `product ${product.id} has no tax code — Managed Payments refuses to sell it`),
    );
    if (product.name !== tier.productName) {
      checks.push(warn(tier.id, `Stripe calls the product "${product.name}", the row says "${tier.productName}"`));
    }
  }
  return checks;
}

/**
 * The Customer Portal, which is the whole of our self-serve billing UI.
 *
 * `is_default` matters because `portalUrl` opens a session without naming a
 * configuration, so a non-default one is invisible to every reader.
 */
async function checkPortal(stripe: Stripe): Promise<Check[]> {
  const list = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
  const configuration = list.data[0];
  if (!configuration) {
    return [bad("portal", "no default configuration — readers have nowhere to cancel or fix a card")];
  }
  const checks = [ok("portal", `default configuration ${configuration.id}`)];
  const features = configuration.features;
  if (!features.subscription_cancel?.enabled) {
    checks.push(bad("portal", "cancellation is off — a reader who cannot leave emails you instead"));
  } else if (features.subscription_cancel.mode !== "at_period_end") {
    checks.push(
      warn("portal", `cancel mode is ${features.subscription_cancel.mode}, not at_period_end — they lose paid time`),
    );
  }
  if (!features.invoice_history?.enabled) checks.push(warn("portal", "invoice history is off"));
  if (!features.payment_method_update?.enabled) {
    checks.push(bad("portal", "card update is off — an expiring card becomes a lost subscriber"));
  }
  return checks;
}

/**
 * Is anything going to tell us a subscription happened?
 *
 * Only meaningful in live mode: locally the deliveries come from `stripe listen`,
 * which registers no endpoint.
 */
async function checkWebhook(stripe: Stripe): Promise<Check[]> {
  const wanted = `${PUBLIC_ORIGIN}${WEBHOOK_PATH}`;
  const list = await stripe.webhookEndpoints.list({ limit: 100 });
  const mine = list.data.find((e) => e.url === wanted);
  if (!mine) {
    const detail = `nothing posts to ${wanted} — entitlement would never be granted`;
    return [expectedLivemode() ? bad("webhook", detail) : warn("webhook", `${detail} (fine locally: stripe listen)`)];
  }
  const checks = [ok("webhook", `${mine.id} → ${mine.url}`)];
  if (mine.status !== "enabled") checks.push(bad("webhook", `endpoint is ${mine.status}`));
  const subscribed = new Set(mine.enabled_events);
  const missing = HANDLED_EVENTS.filter((e) => !subscribed.has(e) && !subscribed.has("*"));
  if (missing.length > 0) checks.push(bad("webhook", `not subscribed to ${missing.join(", ")}`));
  return checks;
}

async function main(): Promise<void> {
  /* Before anything reads the environment — it decides which Stripe account and
     which database everything below reaches. scripts/stripe-target.ts. */
  refuseUnknownArgs(process.argv, ["--prod"]);
  aimAtTarget(process.argv.includes("--prod"));

  /* Printed before the configuration check, so a run that is about to fail
     still says what it was aimed at. */
  console.log(`\nStripe check — ${expectedLivemode() ? "LIVE" : "test"} mode. Reads only; changes nothing.`);
  console.log(`  ${targetLine()}\n`);

  const problem = stripeConfigProblem();
  if (problem) throw new Error(problem);
  const stripe = await stripeClient();

  const checks: Check[] = [...(await checkAccount(stripe))];
  const tiers = offerableTiers(await readTiers());
  if (tiers.length === 0) checks.push(bad("tiers", "no active rows in billing_tiers — there is nothing to sell"));
  for (const tier of tiers) checks.push(...(await checkTier(stripe, tier)));
  checks.push(...(await checkPortal(stripe)));
  checks.push(...(await checkWebhook(stripe)));

  for (const check of checks) console.log(`  ${check.mark} ${check.what.padEnd(20)} ${check.detail}`);

  const failed = checks.filter((c) => c.mark === "✗").length;
  const warned = checks.filter((c) => c.mark === "⚠").length;
  console.log(
    failed > 0
      ? `\n  ${failed} blocking problem(s)${warned ? ` and ${warned} worth a look` : ""}. Do not sell yet.\n`
      : `\n  Nothing blocking${warned ? `, ${warned} worth a look` : ""}.\n`,
  );
  if (failed > 0) process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
