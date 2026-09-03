/**
 * **What `/profile` says about a plan**, and the one sentence it must never say.
 *
 * The free allowance is lifetime and includes paid months (Greg, 2026-09-03), so
 * a reader who took forty articles on Reader and cancelled is permanently past
 * the free three. That is the policy. Rendered as *"40 of 3 used"* it reads as
 * arithmetic going wrong, and the plan doc says so in as many words:
 *
 * > `/profile` and the refusal must say *"your plan has ended — resubscribe to
 * > add more"* and must **not** render "40 of 3 used", which reads as a bug
 * > rather than a policy.
 *
 * The type already makes it unbuildable — the `lapsed` arm of `ReaderPlan` has
 * no `used` field — so what is tested here is the second half: that the words
 * chosen for it do not reconstruct the shape from the numbers that *are* there,
 * and that they say what the API's own `pay-lapsed` refusal says.
 *
 * No database and no DOM: everything under test is pure
 * (src/billing-plan.ts, src/messages.ts). It runs everywhere, every time, so a
 * skip cannot hide it.
 */
import { describe, expect, it } from "vitest";

import { describeAmounts, describePlan, formatAmount, readableDate } from "../src/billing-plan.js";
import type { ReaderPlan } from "../src/billing-plan.js";
import { QUOTA_CODES, codeOfMessage, ingestQuotaReached, isQuotaRefusal } from "../src/messages.js";
import { BILLING_NOT_AVAILABLE, BILLING_UNREACHABLE, NOTHING_TO_MANAGE } from "../src/messages.js";

/** Everything one plan puts on screen, as one string to make claims about. */
function rendered(plan: ReaderPlan): string {
  const copy = describePlan(plan);
  return `${copy.headline} ${copy.detail ?? ""}`;
}

describe("the lapsed plan, which is the one that must not read as a bug", () => {
  /* The real shape of it: forty articles taken on a paid plan, then cancelled,
     against a free allowance of three. */
  const SPENT: ReaderPlan = { kind: "lapsed", limit: 3, remaining: 0 };

  it("never prints a used-of-limit ratio", () => {
    const words = rendered(SPENT);
    /* Not just the literal "40 of 3" — any ratio at all. The failure this
       guards is somebody adding `used` back to the arm and writing the obvious
       sentence, and "37 of 3" would be exactly as wrong. */
    expect(words).not.toMatch(/\d+\s+of\s+\d+/);
    expect(words).not.toContain("40");
  });

  it("says the plan has ended, that reading is unaffected, and how to add more", () => {
    const words = rendered(SPENT);
    expect(words).toContain("plan has ended");
    /* The two promises the `pay-lapsed` refusal makes, which this page has to
       make as well or the reader gets two accounts of one rule. */
    expect(words).toMatch(/still here/i);
    expect(words).toMatch(/reading is unaffected/i);
    expect(words).toMatch(/resubscrib/i);
  });

  it("agrees with the refusal the API sends for the same account", () => {
    /* Not the same *words* — one is a read-out and the other is a refusal — but
       the same three claims. If either drifts, a reader who is refused an
       article and then opens /profile is told two different stories about one
       rule. */
    const refusal = ingestQuotaReached({ limit: 3, lapsed: true }).message;
    expect(codeOfMessage(refusal)).toBe("pay-lapsed");
    for (const both of [refusal, rendered(SPENT)]) {
      expect(both).toMatch(/resubscrib/i);
      expect(both).not.toMatch(/\d+\s+of\s+\d+/);
    }
  });

  it("shows what is left when the free allowance is not yet spent", () => {
    /* A lapsed account can still have room — somebody who subscribed, added one
       article and cancelled. `remaining` can never exceed `limit`, so the ratio
       here is bounded and true, which is why this case is allowed to have one. */
    const words = rendered({ kind: "lapsed", limit: 3, remaining: 2 });
    expect(words).toContain("plan has ended");
    expect(words).toContain("2 of 3");
  });
});

describe("the other plan states", () => {
  it("counts a free account against its lifetime allowance, and says lifetime", () => {
    const words = rendered({ kind: "free", limit: 3, used: 1 });
    expect(words).toContain("1 of 3");
    /* The word that stops a reader waiting for the 1st of the month. */
    expect(words).toMatch(/lifetime/i);
    expect(words).not.toMatch(/this month/i);
  });

  it("names the tier, the month's count and the renewal date for a paid one", () => {
    const words = rendered({
      kind: "paid",
      tierId: "reader",
      tierName: "Spideryarn Reader",
      limit: 20,
      used: 3,
      periodEnd: "2026-10-03T11:22:33.000Z",
      cancelling: false,
    });
    expect(words).toContain("Spideryarn Reader");
    expect(words).toContain("3 of 20");
    expect(words).toContain("3 October 2026");
    expect(words).toMatch(/starts again/i);
  });

  it("does not say a cancelled subscription renews", () => {
    /* The claim that would be false. `cancel_at_period_end` is a column and the
       period end is the same date either way, so the only thing separating
       "starts again on the 3rd" from "runs out on the 3rd" is this branch. */
    const words = rendered({
      kind: "paid",
      tierId: "reader",
      tierName: "Spideryarn Reader",
      limit: 20,
      used: 3,
      periodEnd: "2026-10-03T11:22:33.000Z",
      cancelling: true,
    });
    expect(words).not.toMatch(/starts again/i);
    expect(words).toMatch(/cancelled/i);
    expect(words).toContain("3 October 2026");
  });

  it("says an administrator has no limit rather than showing them a count", () => {
    const words = rendered({ kind: "exempt" });
    expect(words).not.toMatch(/\d+\s+of\s+\d+/);
    expect(words).toMatch(/no limit/i);
  });

  it("admits it does not know rather than guessing, when the period is stale", () => {
    const words = rendered({ kind: "unknown" });
    expect(words).not.toMatch(/\d+\s+of\s+\d+/);
    expect(words).toMatch(/could not confirm/i);
    /* Because that is the thing somebody reading this line is worried about. */
    expect(words).toMatch(/reading is unaffected/i);
  });

  it("says nothing is metered when the deployment has no Postgres", () => {
    const words = rendered({ kind: "off" });
    expect(words).toMatch(/nothing is metered/i);
  });
});

describe("prices, which come off a row and are never converted here", () => {
  it("writes whole amounts without decimals, in each currency's own symbol", () => {
    expect(formatAmount("usd", 1000)).toBe("$10");
    expect(formatAmount("gbp", 800)).toBe("£8");
    expect(formatAmount("eur", 900)).toBe("€9");
  });

  it("keeps the decimals when there are any", () => {
    expect(formatAmount("usd", 999)).toBe("$9.99");
  });

  it("asks Intl how many minor units a major one is, rather than dividing by 100", () => {
    /* Stripe stores JPY in whole yen. A hardcoded ÷100 would price a ¥1500 tier
       at ¥15, and nobody would notice until somebody added the row. */
    expect(formatAmount("jpy", 1500)).toBe("¥1,500");
  });

  it("falls back to the code rather than throwing on a currency Intl refuses", () => {
    expect(formatAmount("zzzz", 1234)).toBe("ZZZZ 12.34");
  });

  it("shows every currency a tier is priced in, in a stable order", () => {
    /* All of them rather than one guessed from the locale: hosted Checkout picks
       by the customer's location, so a single number here would be a price we
       then might not charge. */
    expect(describeAmounts({ usd: 1000, gbp: 800, eur: 900 })).toBe("€9 · £8 · $10");
    expect(describeAmounts({ eur: 900, usd: 1000, gbp: 800 })).toBe("€9 · £8 · $10");
  });

  it("reads a date in UTC, so the sentence does not move with the server", () => {
    expect(readableDate("2026-10-03T23:30:00.000Z")).toBe("3 October 2026");
    expect(readableDate("not a date")).toBeNull();
  });
});

describe("which failures get an upgrade link beside them", () => {
  it("recognises all three quota refusals", () => {
    /* Built through `ingestQuotaReached` rather than from literal strings, so
       the day somebody reworks the copy this still asks about the real
       messages. */
    const free = ingestQuotaReached({ limit: 3 }).message;
    const monthly = ingestQuotaReached({ limit: 20, resetAt: new Date("2026-10-03") }).message;
    const lapsed = ingestQuotaReached({ limit: 3, lapsed: true }).message;
    for (const message of [free, monthly, lapsed]) expect(isQuotaRefusal(message)).toBe(true);
    /* And the codes those three carry are exactly the list — so a fourth
       refusal added to `ingestQuotaReached` without being added to `QUOTA_CODES`
       fails here rather than silently losing its link. */
    expect([free, monthly, lapsed].map(codeOfMessage).sort()).toEqual([...QUOTA_CODES].sort());
  });

  it("does not offer an upgrade for the billing failures a subscription cannot fix", () => {
    /* All three are `pay-` codes, which is why this is a list and not a prefix
       test. Nobody buys their way out of a Stripe outage. */
    for (const message of [
      BILLING_NOT_AVAILABLE.message,
      BILLING_UNREACHABLE.message,
      NOTHING_TO_MANAGE.message,
    ]) {
      expect(codeOfMessage(message)?.startsWith("pay-")).toBe(true);
      expect(isQuotaRefusal(message)).toBe(false);
    }
  });

  it("says no to an ordinary failure, and to nothing at all", () => {
    expect(isQuotaRefusal("The fetch timed out. [net-slow]")).toBe(false);
    expect(isQuotaRefusal("Something went wrong")).toBe(false);
    expect(isQuotaRefusal(null)).toBe(false);
    expect(isQuotaRefusal("")).toBe(false);
  });
});
