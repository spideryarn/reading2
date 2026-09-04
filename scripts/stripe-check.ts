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

import {
  EXPAND_PORTAL_PRODUCTS,
  PRODUCT_TAX_CODE,
  portalDrift,
  portalProducts,
  unfinishedSubscriptions,
} from "./stripe-setup.js";
import type { DesiredPortal } from "./stripe-setup.js";
import { aimAtTarget, refuseUnknownArgs, targetLine } from "./stripe-target.js";

/**
 * The slice of Stripe `checkPortal` needs, so a test can hand it a fake.
 *
 * Same reasoning as `StripePortalSetup` in scripts/stripe-setup.ts: the real
 * client is checked against this type at the call site in `main`, so an SDK
 * whose signatures moved is a compile error there rather than a surprise in a
 * test.
 */
export interface StripePortalCheck {
  readonly billingPortal: {
    readonly configurations: {
      list(
        params: Stripe.BillingPortal.ConfigurationListParams,
      ): Promise<{ data: Stripe.BillingPortal.Configuration[] }>;
    };
  };
  readonly prices: { retrieve(id: string): Promise<Stripe.Price> };
  readonly subscriptions: {
    list(
      params: Stripe.SubscriptionListParams,
    ): Promise<{ data: Stripe.Subscription[]; has_more: boolean }>;
  };
}

/** One line of the report. `bad` is what decides the exit code. */
export interface Check {
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

/**
 * **The currencies must match the row in both directions.**
 *
 * One the row offers and Stripe lacks silently falls back to the base currency
 * at its number. One Stripe offers and the row lacks is a price a reader could
 * be charged at that nothing here costed or displays — and it was invisible to
 * both scripts, because each iterated only the row's currencies. `differences()`
 * in stripe-setup.ts replaces the price for the same reason; checking it only
 * there would be the check/setup divergence this file already closed once for
 * the Portal. GPT Sol, 2026-09-04.
 */
function checkCurrencies(price: Stripe.Price, tier: TierRow): Check[] {
  const checks: Check[] = [];
  for (const [currency, amount] of Object.entries(tier.amounts)) {
    const got =
      currency === price.currency ? price.unit_amount : price.currency_options?.[currency]?.unit_amount;
    if (got !== amount) {
      checks.push(bad(tier.id, `${currency.toUpperCase()} is ${got ?? "absent"} on Stripe, ${amount} on the row`));
    }
  }
  const extra = Object.keys(price.currency_options ?? {}).filter(
    (c) => c !== price.currency && !(c in tier.amounts),
  );
  if (extra.length > 0) {
    checks.push(
      bad(tier.id, `Stripe also sells this in ${extra.sort().join(", ").toUpperCase()}, which the row does not offer`),
    );
  }
  return checks;
}

/**
 * The slice of Stripe `checkTier` needs, so a test can drive the real function
 * rather than restate its rules. The full client satisfies it at the call site.
 */
export interface StripeTierCheck {
  readonly prices: {
    list(params: Stripe.PriceListParams): Promise<{ data: Stripe.Price[] }>;
  };
}

/** Everything about one tier: its product, its price, and the row that sells it. */
export async function checkTier(stripe: StripeTierCheck, tier: TierRow): Promise<Check[]> {
  const checks: Check[] = [];

  /* **A row with no currencies sells nothing, and every other check here would
     pass it.** `offerableTiers` keeps it as long as it carries a
     `stripe_price_id`, which a tier whose `billing_tier_prices` rows were
     deleted still does — and the per-currency comparison below then loops over
     zero currencies and reports nothing wrong. So the check that matters most is
     the one on the row itself, before Stripe is consulted at all. GPT Sol,
     2026-09-03: "sellable" does not require any amount rows. */
  if (Object.keys(tier.amounts).length === 0) {
    return [
      bad(tier.id, "no rows in billing_tier_prices — the row is active and sells at no price"),
    ];
  }

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
  checks.push(...checkBillingPeriod(tier, price));

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

  checks.push(...checkCurrencies(price, tier));

  const product = price.product;
  if (typeof product !== "string" && !("deleted" in product && product.deleted)) {
    /* **The tax code setup writes, not merely a non-empty one.** Accepting any
       value let a hand-set code pass here while `stripe:setup` would rewrite it —
       the same check/setup divergence closed for the Portal, surviving in the
       tier half. A wrong code is a real tax answer, not a cosmetic one. */
    const taxCode = typeof product.tax_code === "string" ? product.tax_code : product.tax_code?.id;
    checks.push(
      taxCode === PRODUCT_TAX_CODE
        ? ok(tier.id, `product ${product.id} has tax code ${taxCode}`)
        : bad(
            tier.id,
            `product ${product.id} has tax code ${taxCode ?? "none"}, not ${PRODUCT_TAX_CODE}` +
              (taxCode ? "" : " — Managed Payments refuses to sell it"),
          ),
    );
    if (product.name !== tier.productName) {
      checks.push(warn(tier.id, `Stripe calls the product "${product.name}", the row says "${tier.productName}"`));
    }
  }
  return checks;
}

/**
 * **How long a billing period is, both halves of it.**
 *
 * `interval` alone says "months"; `interval_count` says how many, and Stripe
 * defaults it to 1 rather than omitting it. A price billing every 3 months is a
 * quarterly charge at a monthly number *and* a quota window three times as long
 * as 30 ingests were costed for — the other way a window silently resets, which
 * is why it is checked beside `billing_cycle_anchor` rather than filed under
 * cosmetics. Nothing we create sends the count, so this only fires on a price
 * made by hand.
 */
function checkBillingPeriod(tier: TierRow, price: Stripe.Price): Check[] {
  const recurring = price.recurring;
  if (recurring?.interval !== "month") {
    return [bad(tier.id, `interval is ${recurring?.interval ?? "none"}, not monthly`)];
  }
  if ((recurring.interval_count ?? 1) !== 1) {
    return [
      bad(tier.id, `bills every ${recurring.interval_count} months, not every 1 — the quota window is that long too`),
    ];
  }
  return [];
}

/**
 * The Customer Portal, which is the whole of our self-serve billing UI.
 *
 * `is_default` matters because `portalUrl` opens a session without naming a
 * configuration, so a non-default one is invisible to every reader.
 *
 * ## It asks `portalDrift`, rather than having its own idea of correct
 *
 * This function passed cleanly on the day billing went live, with the upgrade
 * path shut. It verified cancellation, invoices and card updates — the features
 * somebody thought to list — and never asked whether a reader could change plan
 * at all. The live configuration read `subscription_update: { enabled: false,
 * default_allowed_updates: [] }`, so the only route from Reader to Researcher was
 * to cancel, lose a month, and subscribe again.
 *
 * The first fix for that wrote a **second** list of what good looks like, here,
 * beside the one `scripts/stripe-setup.ts` enforces — and the two were not the
 * same. Setup compared exactly; this compared loosely, so
 * `default_allowed_updates: ["price", "promotion_code"]` passed `includes`,
 * an extra product nobody costed passed a
 * "every tier is reachable" test, and adjustable quantity was only a warning, so
 * a configuration setup would rewrite could still exit zero. GPT Sol,
 * 2026-09-03: two definitions of correct that drift apart is the same shape as
 * the bug this whole stage exists to fix.
 *
 * So there is one contract — `SUBSCRIPTION_UPDATE` in `stripe-setup.ts` — and
 * this asks the same comparison function the reconcile uses. Anything
 * `portalDrift` reports is a blocking `✗` here, because it is by definition
 * something `stripe:setup --apply` would rewrite.
 */
/**
 * **Which tiers each half of this script gets, and why they differ.**
 *
 * `offerableTiers` drops a tier with no `stripe_price_id`, which is exactly
 * right for the pricing-page checks — there is no Stripe price to compare a row
 * against. Handing the *same* filtered list to `checkPortal` silently deleted
 * the thing it most needed to see: an active tier with no price is a plan the
 * Portal cannot offer, and filtering it out first made a partly-configured
 * account exit zero. The check for it existed and could never fire, because the
 * only caller filtered first. GPT Sol, 2026-09-03.
 *
 * Split into a named function rather than two expressions inside `main` so the
 * difference is a thing a test can hold — the bug was in the *composition*, and
 * a test that calls `checkPortal` with a hand-made list reaches past the filter
 * that caused it.
 */
export function tiersToCheck(all: readonly TierRow[]): {
  /** Rows with a Stripe price to compare against: the pricing-page checks. */
  readonly sellable: readonly TierRow[];
  /** Every **active** row, priced or not: what the Portal ought to offer. */
  readonly portal: readonly TierRow[];
} {
  return { sellable: offerableTiers(all), portal: all.filter((t) => t.active) };
}

export async function checkPortal(
  stripe: StripePortalCheck,
  tiers: readonly TierRow[],
): Promise<Check[]> {
  const list = await stripe.billingPortal.configurations.list({
    is_default: true,
    limit: 1,
    /* Without this, `products` is absent from the reply rather than empty, and a
       correct configuration reads as one with nowhere to switch to. See
       EXPAND_PORTAL_PRODUCTS in scripts/stripe-setup.ts for the measurement. */
    expand: EXPAND_PORTAL_PRODUCTS,
  });
  const configuration = list.data[0];
  if (!configuration) {
    return [bad("portal", "no default configuration — readers have nowhere to cancel or fix a card")];
  }
  const checks = [ok("portal", `default configuration ${configuration.id}`)];

  /* The same expansion the reconcile does, so the two compare like with like. A
     tier whose row has no price cannot be a destination, and is reported rather
     than quietly shrinking what we demand of the configuration. */
  const { products, unpriced } = await portalProducts(stripe, tiers);
  for (const id of unpriced) {
    checks.push(bad(id, "no Stripe price on the row, so the Portal cannot offer a switch to it"));
  }

  checks.push(...(await checkNobodyIsStranded(stripe, { products, unpriced })));

  const drift = portalDrift(configuration, { products, unpriced });
  if (drift.length === 0) {
    checks.push(ok("portal", "every money-sensitive field matches what stripe:setup enforces"));
    return checks;
  }
  for (const line of drift) checks.push(bad("portal", line));
  checks.push(
    warn("portal", `run \`npm run stripe:setup${expectedLivemode() ? " -- --prod" : ""}\` to see the fix, then add --apply`),
  );
  return checks;
}

/**
 * **Is any current subscriber on a price the Portal cannot switch them from?**
 *
 * `stripe:setup` deliberately leaves existing subscribers on the price they
 * bought when an amount changes: prices are immutable, so a new amount means a
 * new price with the lookup key moved onto it, and moving customers is a
 * separate visible decision rather than a side effect of a setup script
 * (docs/project/billing.md). The Portal's `products[].prices` lists only each
 * tier's **current** price, so the moment that happens a grandfathered
 * subscriber has nowhere to switch to — on top of already falling to free
 * entitlement, because `tierForPrice` will not recognise their price either.
 *
 * ## Detection, deliberately, rather than price history
 *
 * The catalog fix is to keep every price a tier has ever had and list them all.
 * That is a real feature — an unbounded list, a rule for retiring entries, and
 * `portalDrift`'s exact comparison would have to know which historical prices
 * are legitimately absent — and it competes with the warning billing.md already
 * carries ("do not change a price with live subscribers until this is fixed").
 * One list call turns a silent trap into a noisy one, which is the cheap half of
 * the value. Greg's call via the team lead, 2026-09-03.
 *
 * ## Against the catalog we are about to have, not the one we have
 *
 * **This is the finding that would have bitten the live apply.** The first
 * version read `switchable` off the *live* configuration and returned early when
 * `subscription_update` was disabled — which is precisely the live account's
 * state today, the whole reason this job exists. So the preflight would have
 * skipped silently, `--apply` would have switched plan changes on with only the
 * current tiers' prices listed, and nobody would have been checked at all.
 * Retiring a tier has the same shape from the other end: it drops that tier's
 * price out of the desired list without asking who is still on it.
 *
 * So the comparison is against `desired` — the products `stripe:setup` is about
 * to write — and it runs whether or not switching is on today. A preflight that
 * validates the state you are leaving cannot tell you about the state you are
 * entering. GPT Sol, 2026-09-04.
 */
async function checkNobodyIsStranded(
  stripe: StripePortalCheck,
  desired: DesiredPortal,
): Promise<Check[]> {
  /* The post-apply list, not `configuration.features.subscription_update.products`. */
  const switchable = new Set(desired.products.flatMap((p) => p.prices));
  /* Paginated to exhaustion, and not-terminal rather than entitled, by the same
     helper the setup script's replace-refusal uses — one definition of "a
     subscription that is not over". */
  const current = await unfinishedSubscriptions(stripe);
  const stranded = current.filter((s) => s.items.data.some((i) => !switchable.has(i.price.id)));

  return [
    stranded.length === 0
      ? /* **Says only what it looked at.** Every unfinished subscription bills on a
           price the desired configuration lists — which is necessary for a Portal switch
           and not sufficient for one. Stripe also refuses the update flow for
           subscriptions that are scheduled, span multiple products, are
           usage-based, collect by `send_invoice`, or carry certain payment
           methods, and none of that is examined here. Claiming "they can switch"
           would be the overclaim GPT Sol caught on 2026-09-03. */
        ok(
          "subscribers",
          `all ${current.length} unfinished subscription(s) bill on a price the Portal will list ` +
            "(necessary for a switch, not sufficient — Stripe blocks the flow for scheduled, " +
            "multi-product, usage-based and send-invoice subscriptions, which this does not check)",
        )
      : bad(
          "subscribers",
          `${stranded.length} of ${current.length} unfinished subscription(s) bill on a price the Portal ` +
            `does not list (${stranded.map((s) => s.id).join(", ")}) — they are grandfathered on a ` +
            "replaced price, so they have no upgrade path and no recognised tier",
        ),
  ];
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
  const { sellable, portal } = tiersToCheck(await readTiers());
  if (sellable.length === 0) checks.push(bad("tiers", "no active rows in billing_tiers — there is nothing to sell"));
  for (const tier of sellable) checks.push(...(await checkTier(stripe, tier)));
  checks.push(...(await checkPortal(stripe, portal)));
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
