/**
 * **Whose Stripe account, not just which mode** — src/billing/stripe.ts.
 *
 * `stripeConfigProblem()` checks a key's *prefix*, so it tells live from test
 * and stops there. Greg has a second live account — `acct_1GHoSxLZ0dGTJEEP`,
 * which bills his consulting work and has done for years — and its secret key
 * is the same shape as Spideryarn's. Put that in `.env.prod` and every guard we
 * had passes: the key is live, the deployment expects live, and `livemode` on
 * everything it returns is `true`. `stripe-setup --apply` would then create
 * Spideryarn's products in the consulting account and write those price ids
 * into Spideryarn's production database.
 *
 * GPT Sol, 2026-09-03, reviewing
 * docs/plans/260903h-stripe-scripts-reach-production.md — the point being that
 * the run which proved `--prod` worked proved something about *that day's*
 * `.env.prod`, not about the guard.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SPIDERYARN_ACCOUNTS, accountProblem } from "../src/billing/stripe.js";

/** The consulting account. Named because it is the realistic wrong answer. */
const CONSULTING = "acct_1GHoSxLZ0dGTJEEP";

describe("which account a key opens", () => {
  let before: string | undefined;
  beforeEach(() => {
    before = process.env.VERCEL_ENV;
  });
  afterEach(() => {
    if (before === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = before;
  });

  describe("in live mode", () => {
    beforeEach(() => {
      process.env.VERCEL_ENV = "production";
    });

    it("accepts Spideryarn's live account", () => {
      expect(accountProblem(SPIDERYARN_ACCOUNTS.live)).toBeNull();
    });

    it("refuses Greg's consulting account, which passes every other guard", () => {
      const problem = accountProblem(CONSULTING);
      expect(problem).not.toBeNull();
      expect(problem).toContain(CONSULTING);
      /* Says which one it wanted. A refusal that only says "wrong" sends
         somebody to check the thing they were already sure about. */
      expect(problem).toContain(SPIDERYARN_ACCOUNTS.live);
    });

    it("refuses the sandbox account when live was expected", () => {
      expect(accountProblem(SPIDERYARN_ACCOUNTS.test)).not.toBeNull();
    });
  });

  describe("in test mode", () => {
    beforeEach(() => {
      delete process.env.VERCEL_ENV;
    });

    it("accepts the sandbox this repo knows", () => {
      expect(accountProblem(SPIDERYARN_ACCOUNTS.test)).toBeNull();
    });

    it("only remarks on an unfamiliar sandbox, because sandboxes are disposable", () => {
      /* The asymmetry is the decision: live has exactly one right answer and
         real money behind it; a new sandbox is an ordinary Tuesday. Callers
         render this as a warning in test and a failure in live. */
      const problem = accountProblem("acct_1SomeNewSandbox");
      expect(problem).not.toBeNull();
      expect(problem).toContain("fine if you made a new one");
    });

    it("refuses the live account when test was expected", () => {
      expect(accountProblem(SPIDERYARN_ACCOUNTS.live)).not.toBeNull();
    });
  });

  it("the two accounts are different, which the rest of this file assumes", () => {
    /* A copy-paste that made both constants the same string would make every
       test above pass while checking nothing. */
    expect(SPIDERYARN_ACCOUNTS.live).not.toBe(SPIDERYARN_ACCOUNTS.test);
    expect(SPIDERYARN_ACCOUNTS.live).not.toBe(CONSULTING);
  });
});
