/**
 * **Where a reader stands, in a sentence** — `planTip` and `planExplainer` in
 * src/billing-plan.ts, the words behind the (i) and *How this works* on both
 * `/profile` and the shelf (src/web/PlanHelp.tsx).
 *
 * Greg, 2026-10-01 (spya-x9taw3): *"explain the model and when the monthly
 * limits will reset and what they'll reset to … make sure that as much as
 * possible it's clear to the user where they stand and how it works and what
 * will change."* Plan 261002b stage 2, with GPT Sol's plan-review findings
 * F1 (an ending plan does not hand back a fresh free allowance), F2 (a trial's
 * end is not a renewal) and F5 (the reset figure is the tier's, never a
 * prorated `limit`) pinned here.
 */
import { describe, expect, it } from "vitest";

import { type Gift, type ReaderPlan, planExplainer, planTip } from "../src/billing-plan.js";

const GIFT: Gift = { articles: 20, claimedAt: "2026-10-01T10:00:00.000Z", noticeKey: "v1" };

const FREE: Extract<ReaderPlan, { kind: "free" }> = {
  kind: "free",
  limit: 3,
  used: 1,
  sharedHalfPrice: 0,
  atLimit: false,
  highPower: 0,
  minimal: 0,
  remaining: 2,
};

const PAID: Extract<ReaderPlan, { kind: "paid" }> = {
  kind: "paid",
  tierId: "reader",
  tierName: "Reader",
  limit: 20,
  used: 4,
  sharedHalfPrice: 0,
  atLimit: false,
  highPower: 0,
  minimal: 0,
  periodEnd: "2026-11-03T10:00:00.000Z",
  endsAt: null,
  periodAllowance: 20,
  trial: false,
};

const all = (plan: ReaderPlan) => `${planTip(plan) ?? ""} ${planExplainer(plan).join(" ")}`;

describe("the free allowance", () => {
  it("says it is for life, and does not reset", () => {
    const tip = planTip(FREE) ?? "";
    expect(tip).toContain("3 articles for the lifetime of the account");
    expect(tip).toContain("does not reset");
    expect(planExplainer(FREE).join(" ")).toContain("not per month");
  });

  it("says what a gifted allowance is made of, with the whole number first (Sol F6)", () => {
    const gifted = { ...FREE, limit: 23, remaining: 22, gifts: [GIFT] as const };
    expect(planTip(gifted)).toContain("23 articles for the lifetime of the account (3 free + 20 from a gift)");
    expect(planExplainer(gifted).join(" ")).toContain("Gifts count while you are on the Free plan.");
  });

  it("never mentions gifts to a reader without one", () => {
    expect(all(FREE)).not.toMatch(/gift/i);
    expect(all(PAID)).not.toMatch(/gift/i);
  });

  it("says the same for a lapsed reader, who is back on it", () => {
    const lapsed: ReaderPlan = { kind: "lapsed", limit: 3, remaining: 0 };
    expect(planTip(lapsed)).toContain("for the lifetime of the account");
    expect(planTip(lapsed)).toContain("does not reset");
  });
});

describe("a paid plan", () => {
  it("says when the allowance starts again, and what it goes back to", () => {
    const tip = planTip(PAID) ?? "";
    expect(tip).toContain("20 articles a month");
    expect(tip).toContain("starts again on 3 November 2026, back to 20");
    expect(tip).toContain("do not carry over");
  });

  it("takes the reset figure from the tier, not from a prorated limit (Sol F5)", () => {
    const switched = { ...PAID, tierName: "Researcher", limit: 33, periodAllowance: 150 };
    const tip = planTip(switched) ?? "";
    expect(tip).toContain("back to 150");
    expect(tip).toContain("This month's is 33");
    expect(tip).not.toContain("back to 33");
  });

  it("names no reset figure when the tier row could not be found", () => {
    const tip = planTip({ ...PAID, periodAllowance: null }) ?? "";
    expect(tip).toContain("starts again on 3 November 2026");
    expect(tip).not.toMatch(/back to \d/);
  });

  it("does not promise a fresh free allowance when the plan is ending (Sol F1)", () => {
    const ending = { ...PAID, endsAt: "2026-10-20T10:00:00.000Z" };
    const words = all(ending);
    expect(words).toContain("ends on 20 October 2026");
    expect(words).toContain("counts the articles you added while subscribed");
    expect(words).not.toContain("starts again on");
  });

  it("promises no reset out of a trial (Sol F2)", () => {
    const trial = { ...PAID, trial: true };
    const words = all(trial);
    expect(words).toContain("trial");
    expect(words).not.toContain("starts again on");
    expect(words).not.toContain("back to");
  });

  it("says a gift held while subscribed is waiting for Free", () => {
    const gifted = { ...PAID, gifts: [GIFT] as const };
    expect(planTip(gifted)).toContain("Your gift of 20 articles is waiting");
    expect(planExplainer(gifted).join(" ")).toContain("count only on the Free plan");
  });
});

describe("the states with no allowance to explain", () => {
  it("say nothing", () => {
    for (const plan of [{ kind: "exempt" }, { kind: "off" }, { kind: "unknown" }] as const) {
      expect(planTip(plan)).toBeNull();
      expect(planExplainer(plan)).toEqual([]);
    }
  });
});
