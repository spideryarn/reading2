/**
 * The Stripe client, and the guard that stops test and live crossing.
 *
 * Everything that talks to Stripe comes through here, so there is exactly one
 * place that decides which API version we speak and which key is allowed to be
 * in use. docs/plans/260902i-stripe-payments-and-subscription-tiers.md.
 *
 * ## The API version is pinned, and pinned to the SDK's own
 *
 * Stripe dates its API and an account has a default; a call that does not name
 * a version gets whatever that account happens to be set to, which is a setting
 * in someone else's dashboard. Worse, the shapes have already moved once in a
 * way this code depends on: `current_period_start`/`current_period_end` were
 * **removed from the Subscription object** in the Basil release (2025-03-31)
 * and now live on each subscription *item*
 * (https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end).
 * Checked against the installed SDK rather than the changelog:
 * `node_modules/stripe/esm/resources/SubscriptionItems.d.ts` declares
 * `current_period_start`, and `Subscriptions.d.ts` has it only as a *list
 * filter*. So `src/billing/sync.ts` reads the item, and this constant is what
 * makes that a fact rather than a hope.
 *
 * It is the version the installed SDK's TypeScript types were generated from,
 * which is the only version whose types are not lying to us. Bumping the
 * `stripe` package therefore means bumping this line and re-reading the
 * changelog — `tests/billing-stripe.test.ts` fails if the two drift apart, so
 * nobody has to remember.
 *
 * ## Test and live must never cross
 *
 * A production deployment running on `sk_test_…` would take test cards, write
 * `active` subscription rows, and grant real quota for imaginary money — while
 * `/api/health` stayed green, because the variable *is* set. That is the exact
 * shape of docs/reusable/silent-success.md, and it is why the check here is on
 * the key's own prefix: Stripe encodes the mode in the credential, so the value
 * answers the question and the variable name is not consulted. The same
 * reasoning, and the same prefixes, guard the shared dev box in
 * `scripts/gjd-remote-env.ts`.
 */
import Stripe from "stripe";

/**
 * The Stripe API version every call is made against.
 *
 * Must equal the installed SDK's `ApiVersion`; see the header. Written out
 * rather than imported from the SDK on purpose — an import would silently
 * follow a package bump, and following it silently is the failure being
 * guarded against.
 */
export const STRIPE_API_VERSION = "2026-08-26.dahlia";

/**
 * Is this process the production deployment?
 *
 * `VERCEL_ENV`, not `NODE_ENV`. `NODE_ENV=production` is set by any local
 * build and by some test runners, so it answers "is this an optimised build"
 * rather than "are real people's cards on the other end of this"; and
 * `process.env.VERCEL` alone is true of preview deployments, which are built
 * from unreviewed commits and must never hold a live key.
 */
export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/** Live-mode Stripe secret (`sk_live_…`, `rk_live_…`), by its prefix. */
export function isLiveSecret(key: string): boolean {
  return /^(?:sk|rk)_live_/.test(key);
}

/** Test-mode Stripe secret (`sk_test_…`, `rk_test_…`), by its prefix. */
export function isTestSecret(key: string): boolean {
  return /^(?:sk|rk)_test_/.test(key);
}

/**
 * Which mode this deployment is *supposed* to be in.
 *
 * Every Stripe object carries `livemode`, and everything we retrieve is
 * checked against this — see `assertLivemode`.
 */
export function expectedLivemode(): boolean {
  return isProductionDeployment();
}

/**
 * What is wrong with the Stripe configuration, in a sentence, or `null`.
 *
 * Separate from `stripeClient()` so `/api/health` can report the problem
 * without constructing anything and without the caller having to catch. Never
 * includes the key itself — only what its prefix said.
 */
export function stripeConfigProblem(): string | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return "STRIPE_SECRET_KEY is not set";
  if (!isLiveSecret(key) && !isTestSecret(key)) {
    return "STRIPE_SECRET_KEY is not a Stripe secret key (expected sk_… or rk_…)";
  }
  if (expectedLivemode() && !isLiveSecret(key)) {
    return "STRIPE_SECRET_KEY is a test-mode key on the production deployment, which would grant real access for test cards";
  }
  if (!expectedLivemode() && isLiveSecret(key)) {
    return "STRIPE_SECRET_KEY is a live-mode key outside production, which would charge real cards";
  }
  return null;
}

/** Is billing configured well enough to be used at all? */
export function stripeConfigured(): boolean {
  return stripeConfigProblem() === null;
}

/**
 * Thrown when Stripe is unconfigured or the key is in the wrong mode.
 *
 * Its own class so a route can turn it into a 503 ("billing is not available")
 * rather than a 500, without string-matching a message.
 */
export class StripeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeConfigError";
  }
}

/**
 * Memoised per key, so a test that swaps `STRIPE_SECRET_KEY` gets a client for
 * the key it set rather than one built from whatever the last test used.
 */
let cached: { key: string; client: Stripe } | null = null;

/**
 * The Stripe client, or a throw naming exactly what is wrong.
 *
 * @throws {StripeConfigError} when unconfigured or the key's mode does not
 * match the deployment.
 */
export function stripeClient(): Stripe {
  const problem = stripeConfigProblem();
  if (problem) throw new StripeConfigError(problem);

  const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (cached?.key === key) return cached.client;

  const client = new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    /* Named so a support request, and Stripe's own dashboard log, say which
       application made the call rather than "unknown Node app". */
    appInfo: { name: "Spideryarn", url: "https://spideryarn.com" },
  });
  cached = { key, client };
  return client;
}

/**
 * Refuse an object from the wrong mode.
 *
 * Every Stripe object — event, subscription, session, price — carries
 * `livemode`, and a mismatch means we are looking at an object from the other
 * side of the test/live divide. It should be impossible given the key check
 * above, which is the reason to assert it rather than assume it: the one way
 * it happens in practice is a webhook endpoint left pointed at the wrong
 * deployment, and then the payload is the only thing that knows.
 */
export function assertLivemode(livemode: boolean, what: string): void {
  const expected = expectedLivemode();
  if (livemode !== expected) {
    throw new StripeConfigError(
      `${what} is ${livemode ? "live" : "test"}-mode, but this deployment expects ` +
        `${expected ? "live" : "test"}-mode Stripe objects`,
    );
  }
}

/**
 * The price the paid tier is sold at.
 *
 * A `price_…` id, created by `scripts/stripe-setup.ts` and pasted into the
 * environment. Not a secret — it appears in Checkout — so it travels on the
 * `gjd-remote push-env` allowlist with the rest of the configuration.
 *
 * @throws {StripeConfigError} when unset, because a checkout with no price is
 * a 503, not an empty basket.
 */
export function readerPriceId(): string {
  const id = process.env.STRIPE_PRICE_READER?.trim();
  if (!id) {
    throw new StripeConfigError(
      "STRIPE_PRICE_READER is not set — run `npx tsx scripts/stripe-setup.ts` and put the price id in .env.local",
    );
  }
  return id;
}

/** Reset the memoised client. Tests only; the key is read from the env. */
export function resetStripeClientForTests(): void {
  cached = null;
}
