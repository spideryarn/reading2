/**
 * The Customer Portal configuration has to end up as the account **default**.
 *
 * `portalUrl` ([`src/billing/checkout.ts`](../src/billing/checkout.ts)) opens a
 * Portal session without naming a configuration, so Stripe gives it whatever the
 * account default is. A configuration that is not the default is dead weight no
 * reader ever sees — they would get the dashboard's one, with whatever features
 * that happens to have, and nothing would say so.
 *
 * **Tested because the branch cannot be rehearsed.** `ensurePortalConfiguration`
 * only creates when the mode has no default at all, which is true of live mode
 * exactly once: on the day we start charging real money. GPT Sol read Stripe's
 * documentation as saying an API-created configuration is *never* the default
 * (2026-09-03); the one on this account carries our own `managed_by` metadata
 * **and** `is_default: true`, so that reading is not right here. Neither reading
 * is worth betting live day on, which is why the script asserts and this pins
 * the assertion.
 */
import { describe, expect, it } from "vitest";

import { ensurePortalConfiguration } from "../scripts/stripe-setup.js";
import type { StripePortalSetup } from "../scripts/stripe-setup.js";

type Config = { id: string; is_default?: boolean };

/**
 * A Stripe stand-in that answers, and records what it was asked.
 *
 * Deliberately not the SDK: what matters is what the script *sends* and how it
 * reads the reply. The real client is checked against `StripePortalSetup` at the
 * default argument in the script, so a moved SDK signature is a compile error
 * there rather than a surprise here.
 */
function fakeStripe(existing: Config[], created: Config = { id: "bpc_new", is_default: true }) {
  const calls = { created: [] as unknown[] };
  const stripe = {
    billingPortal: {
      configurations: {
        list: async () => ({ data: existing }),
        create: async (params: unknown) => {
          calls.created.push(params);
          return created;
        },
        update: async (id: string) => ({ id }),
      },
    },
  } as unknown as StripePortalSetup;
  return { stripe, calls };
}

const detailOf = (steps: { detail: string }[]) => steps.map((s) => s.detail).join(" ");

describe("the portal configuration the script creates", () => {
  it("says so when the one it created is the account default", async () => {
    const { stripe, calls } = fakeStripe([], { id: "bpc_new", is_default: true });
    const steps = await ensurePortalConfiguration(true, stripe);
    expect(calls.created).toHaveLength(1);
    expect(detailOf(steps)).toMatch(/created bpc_new/);
    expect(detailOf(steps)).toMatch(/is the account default/);
  });

  it("says loudly when it is NOT the default, because readers would never see it", async () => {
    const { stripe } = fakeStripe([], { id: "bpc_orphan", is_default: false });
    const steps = await ensurePortalConfiguration(true, stripe);
    expect(detailOf(steps)).toMatch(/NOT the account default/);
    expect(detailOf(steps)).toMatch(/before selling anything/);
  });

  it("cancels at period end, so nobody loses access they have paid for", async () => {
    const { stripe, calls } = fakeStripe([]);
    await ensurePortalConfiguration(true, stripe);
    expect(calls.created[0]).toMatchObject({
      features: { subscription_cancel: { enabled: true, mode: "at_period_end" } },
    });
  });

  it("leaves an existing default alone, and creates nothing", async () => {
    const { stripe, calls } = fakeStripe([{ id: "bpc_old", is_default: true }]);
    const steps = await ensurePortalConfiguration(true, stripe);
    expect(calls.created).toEqual([]);
    expect(detailOf(steps)).toMatch(/already exists — bpc_old/);
  });

  it("says what it would do without doing it, on a dry run", async () => {
    const { stripe, calls } = fakeStripe([]);
    const steps = await ensurePortalConfiguration(false, stripe);
    expect(calls.created).toEqual([]);
    expect(detailOf(steps)).toMatch(/would create/);
  });
});
