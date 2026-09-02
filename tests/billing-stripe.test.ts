/**
 * The Stripe client's two jobs: speak a pinned API version, and refuse to let
 * test and live mode cross.
 *
 * The crossing is the one worth testing hardest. A production deployment on a
 * test key takes test cards and grants real quota while `/api/health` stays
 * green, because the variable *is* set — docs/reusable/silent-success.md.
 *
 * No network: every assertion here is about the configuration, not about
 * Stripe. See src/billing/stripe.ts.
 */
import Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import {
  STRIPE_API_VERSION,
  assertLivemode,
  expectedLivemode,
  isLiveSecret,
  isTestSecret,
  readerPriceId,
  resetStripeClientForTests,
  stripeClient,
  stripeConfigProblem,
  stripeConfigured,
} from "../src/billing/stripe.js";

const KEYS = ["STRIPE_SECRET_KEY", "STRIPE_PRICE_READER", "VERCEL_ENV"] as const;
const SAVED = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

/** Fake keys with the real prefixes; nothing here ever reaches Stripe. */
const TEST_KEY = "sk_test_notarealkey000000000000000";
const LIVE_KEY = "sk_live_notarealkey000000000000000";

function setEnv(values: Partial<Record<(typeof KEYS)[number], string | undefined>>): void {
  for (const key of KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetStripeClientForTests();
}

afterEach(() => {
  for (const key of KEYS) {
    const value = SAVED[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetStripeClientForTests();
});

describe("the pinned API version", () => {
  /**
   * The one check that catches a `stripe` package bump moving the shapes under
   * us. The SDK's types are generated from `ApiVersion`, so any other value
   * means the types describe an API we are not calling — which is how
   * `subscription.current_period_end` came to be read from an object that no
   * longer has it.
   */
  it("is the version the installed SDK's types were generated from", () => {
    expect(STRIPE_API_VERSION).toBe(Stripe.API_VERSION);
  });

  it("still finds the billing period on the subscription item, not the subscription", async () => {
    /* Not a type-level assertion, because the type is what we would be
       trusting. Reads the shipped declarations, which is where the Basil move
       is actually observable. */
    const { readFileSync } = await import("node:fs");
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const dir = require.resolve("stripe").replace(/\/[^/]+$/, "");
    const item = readFileSync(`${dir}/resources/SubscriptionItems.d.ts`, "utf8");
    expect(item).toContain("current_period_start");
    expect(item).toContain("current_period_end");
  });
});

describe("key prefixes", () => {
  it("reads the mode off the credential itself", () => {
    expect(isTestSecret(TEST_KEY)).toBe(true);
    expect(isLiveSecret(TEST_KEY)).toBe(false);
    expect(isLiveSecret(LIVE_KEY)).toBe(true);
    expect(isTestSecret(LIVE_KEY)).toBe(false);
    /* Restricted keys are secrets too, and carry the same mode marker. */
    expect(isLiveSecret("rk_live_abc")).toBe(true);
    expect(isTestSecret("rk_test_abc")).toBe(true);
    /* Publishable keys are public by construction and are not this check's
       business, but they must not be mistaken for secrets either. */
    expect(isLiveSecret("pk_live_abc")).toBe(false);
    expect(isTestSecret("pk_test_abc")).toBe(false);
  });
});

describe("test and live cannot cross", () => {
  it("accepts a test key outside production", () => {
    setEnv({ STRIPE_SECRET_KEY: TEST_KEY });
    expect(stripeConfigProblem()).toBeNull();
    expect(stripeConfigured()).toBe(true);
    expect(expectedLivemode()).toBe(false);
  });

  it("accepts a live key on the production deployment", () => {
    setEnv({ STRIPE_SECRET_KEY: LIVE_KEY, VERCEL_ENV: "production" });
    expect(stripeConfigProblem()).toBeNull();
    expect(expectedLivemode()).toBe(true);
  });

  it("refuses a TEST key on the production deployment", () => {
    setEnv({ STRIPE_SECRET_KEY: TEST_KEY, VERCEL_ENV: "production" });
    expect(stripeConfigProblem()).toMatch(/test-mode key on the production deployment/);
    expect(stripeConfigured()).toBe(false);
    expect(() => stripeClient()).toThrow(/test-mode key on the production deployment/);
  });

  it("refuses a LIVE key anywhere else, preview included", () => {
    setEnv({ STRIPE_SECRET_KEY: LIVE_KEY });
    expect(stripeConfigProblem()).toMatch(/live-mode key outside production/);
    setEnv({ STRIPE_SECRET_KEY: LIVE_KEY, VERCEL_ENV: "preview" });
    expect(stripeConfigProblem()).toMatch(/live-mode key outside production/);
  });

  it("never echoes the key in the problem it reports", () => {
    for (const [key, env] of [
      [TEST_KEY, "production"],
      [LIVE_KEY, undefined],
    ] as const) {
      setEnv({ STRIPE_SECRET_KEY: key, VERCEL_ENV: env });
      expect(stripeConfigProblem()).not.toContain(key);
    }
  });

  it("says so when it is not set at all, and when it is not a Stripe key", () => {
    setEnv({});
    expect(stripeConfigProblem()).toMatch(/not set/);
    setEnv({ STRIPE_SECRET_KEY: "   " });
    expect(stripeConfigProblem()).toMatch(/not set/);
    setEnv({ STRIPE_SECRET_KEY: "hunter2" });
    expect(stripeConfigProblem()).toMatch(/not a Stripe secret key/);
  });
});

describe("assertLivemode", () => {
  it("passes an object from the mode this deployment expects", () => {
    setEnv({ STRIPE_SECRET_KEY: TEST_KEY });
    expect(() => assertLivemode(false, "the event")).not.toThrow();
  });

  it("refuses a live object outside production, and a test object in it", () => {
    setEnv({ STRIPE_SECRET_KEY: TEST_KEY });
    expect(() => assertLivemode(true, "the event")).toThrow(/the event is live-mode/);
    setEnv({ STRIPE_SECRET_KEY: LIVE_KEY, VERCEL_ENV: "production" });
    expect(() => assertLivemode(false, "the session")).toThrow(/the session is test-mode/);
  });
});

describe("the client and the price", () => {
  it("builds a client on the pinned version, and memoises per key", () => {
    setEnv({ STRIPE_SECRET_KEY: TEST_KEY });
    const first = stripeClient();
    expect(stripeClient()).toBe(first);
    /* A different key must not hand back the previous client — a test that
       swaps the key would otherwise be talking to the old one. */
    setEnv({ STRIPE_SECRET_KEY: `${TEST_KEY}2` });
    expect(stripeClient()).not.toBe(first);
  });

  it("refuses a checkout with no price rather than an empty basket", () => {
    setEnv({ STRIPE_SECRET_KEY: TEST_KEY });
    expect(() => readerPriceId()).toThrow(/STRIPE_PRICE_READER is not set/);
    setEnv({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_PRICE_READER: " price_abc " });
    expect(readerPriceId()).toBe("price_abc");
  });
});
