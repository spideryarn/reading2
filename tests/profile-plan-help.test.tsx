// @vitest-environment jsdom
/**
 * **`/profile` says where the reader stands, with gifts made visible** —
 * src/web/BillingSection.tsx drawing the shared pieces in src/web/PlanHelp.tsx.
 *
 * Greg, 2026-10-01 (spya-x9taw3): *"If a user has received a gift voucher,
 * then make that a bit more visible in the profile, a little bit like you do
 * already on the logged in homepage. Make sure there are tooltips and stuff in
 * both cases that are linked to the pricing page …"* Plan 261002b stage 2. The
 * words themselves are pinned in tests/plan-help-copy.test.ts; this is that
 * they are drawn, linked, and absent for a reader with no gift.
 *
 * The harness is tests/plan-buttons-are-tier-aware.test.tsx's: the real
 * component against a stubbed `fetch`.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BillingSummary, Gift } from "../src/billing-plan.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "TOKEN" } } }),
      refreshSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: async () => true,
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

const { BillingSection } = await import("../src/web/BillingSection.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GIFT: Gift = { articles: 20, claimedAt: "2026-10-01T10:00:00.000Z", noticeKey: "v1" };

const FREE: BillingSummary = {
  plan: { kind: "free", limit: 3, used: 1, sharedHalfPrice: 0, highPower: 0, minimal: 0, atLimit: false, remaining: 2 },
  manageable: false,
  purchase: { kind: "none" },
};

const GIFTED: BillingSummary = {
  ...FREE,
  plan: { ...FREE.plan, limit: 23, remaining: 22, gifts: [GIFT] } as BillingSummary["plan"],
};

const PAID: BillingSummary = {
  plan: {
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
    gifts: [GIFT],
  },
  manageable: true,
  purchase: { kind: "top" },
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.unstubAllGlobals();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  history.replaceState(null, "", "/profile");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function show(summary: BillingSummary): Promise<void> {
  vi.stubGlobal(
    "fetch",
    async () => new Response(JSON.stringify(summary), { status: 200, headers: { "content-type": "application/json" } }),
  );
  await act(async () => root.render(<BillingSection />));
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

describe("/profile's plan card", () => {
  it("shows a gift in the open, not inside a collapsed section", async () => {
    await show(GIFTED);
    const gifts = host.querySelector("[data-testid=gift-list]");
    expect(gifts).not.toBeNull();
    expect(gifts?.closest("details")).toBeNull();
    expect(gifts?.textContent).toContain("20 articles, a gift, added 1 October 2026");
    expect(gifts?.textContent).toContain("Part of your free allowance");
  });

  it("links its (i) to Pricing with a short name and a finger-sized target", async () => {
    await show(GIFTED);
    const info = host.querySelector<HTMLAnchorElement>("[data-testid=plan-info]");
    expect(info?.getAttribute("href")).toBe("/pricing");
    expect(info?.getAttribute("aria-label")).toBe("How your plan works — open Pricing");
    expect(info?.className).toContain("tw:size-7");
    expect(info?.className).toContain("tw:pointer-coarse:size-10");
  });

  it("explains how the plan works, linking to Pricing and not to the page it is on", async () => {
    await show(FREE);
    const how = host.querySelector("[data-testid=how-your-plan-works]");
    expect(how?.textContent).toContain("not per month");
    expect(how?.querySelector('a[href="/pricing"]')).not.toBeNull();
    expect(how?.querySelector('a[href="/profile"]')).toBeNull();
  });

  it("says nothing about gifts to a reader without one", async () => {
    await show(FREE);
    const how = host.querySelector<HTMLDetailsElement>("[data-testid=how-your-plan-works]");
    act(() => {
      if (how) how.open = true;
    });
    expect(host.querySelector("[data-testid=gift-list]")).toBeNull();
    expect(host.textContent?.toLowerCase()).not.toMatch(/gift|voucher/);
  });

  it("tells a subscriber their gift is waiting, and when the month starts again", async () => {
    await show(PAID);
    expect(host.querySelector("[data-testid=gift-list]")?.textContent).toContain("Waiting");
    const info = host.querySelector<HTMLAnchorElement>("[data-testid=plan-info]");
    await act(async () => info?.focus());
    expect(info?.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.body.textContent).toContain("starts again on 3 November 2026, back to 20");
    expect(host.querySelector("[data-testid=how-your-plan-works] summary")?.textContent).toBe("How your plan works");
  });
});
