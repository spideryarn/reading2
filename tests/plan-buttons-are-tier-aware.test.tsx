// @vitest-environment jsdom
/**
 * **A paying Reader is offered Researcher, and a Researcher is offered a
 * sentence.**
 *
 * The gate on every plan button was `canCheckout` — a boolean meaning *this
 * account has no open subscription*, which is the question `startCheckout` asks
 * and not the question a page draws a button from. So a Reader at their monthly
 * ceiling was drawn **no button on either page**, while Stripe's hosted Portal
 * had been able to take the switch since 2026-09-04
 * (docs/project/billing.md § *Reader → Researcher*). The dead end was ours.
 *
 * `summary.purchase` (src/billing-plan.ts) answers both halves at once — what
 * may be bought, and which door a press goes through — and this file is the
 * rendering half of it, over both pages that draw plans:
 *
 * - `/pricing` draws the **website's** three cards whatever the reader's plan,
 *   and decorates each with an action or nothing, so the filtering shows up as a
 *   card with no button rather than a missing card.
 * - `/profile` builds its cards **from the offers themselves**, so filtering
 *   shows up as a shorter row — which is why the order those arrive in is
 *   asserted here too. `PlanCards` promotes nothing and draws them in the order
 *   it is handed them, so nothing downstream would put a jumbled list right.
 *
 * **The verb is part of the claim.** A subscriber's press does not open a
 * checkout page; it opens the Portal, where the plan is chosen again and
 * confirmed. A button reading *Get Researcher* would say something the press
 * does not do, so the label changes with the door and the sentence beside it
 * says the rest (`SWITCHING_PLAN`).
 *
 * Same shape as tests/pricing-page-current-plan.test.tsx: the real components
 * against a stubbed `fetch`, asserting what a reader would see.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
/* `apiFetch` reaches for IndexedDB (the offline cache in lib/api.ts), which jsdom
   does not have — and the failure is a hang rather than a throw, so the symptom
   is every test here timing out with no error. */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SWITCHING_PLAN, noHigherPlan } from "../src/billing-plan.js";
import type { BillingSummary, TierOffer } from "../src/billing-plan.js";

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

const { PricingPage } = await import("../src/web/PricingPage.js");
const { BillingSection } = await import("../src/web/BillingSection.js");

const ALICE = "aaaaaaaa-2222-4000-8000-000000000009";

const READER: TierOffer = {
  id: "reader",
  name: "Spideryarn Reader",
  description: "For somebody who reads a lot.",
  ingestsPerPeriod: 20,
  amounts: { usd: 1000, gbp: 800, eur: 900 },
};

const RESEARCHER: TierOffer = {
  id: "researcher",
  name: "Spideryarn Researcher",
  description: "For somebody who reads for a living.",
  ingestsPerPeriod: 150,
  amounts: { usd: 5000, gbp: 4000, eur: 4500 },
};

/** A reader on Reader, mid-month, with Researcher above them. */
const ON_READER: BillingSummary = {
  plan: {
    kind: "paid",
    tierId: "reader",
    tierName: "Spideryarn Reader",
    limit: 20,
    used: 20,
    periodEnd: "2026-10-03T11:37:00.000Z",
    endsAt: null,
  },
  manageable: true,
  purchase: { kind: "switch", tiers: [RESEARCHER] },
};

/** The top of the ladder: a subscription, and nothing above it. */
const ON_RESEARCHER: BillingSummary = {
  plan: {
    kind: "paid",
    tierId: "researcher",
    tierName: "Spideryarn Researcher",
    limit: 150,
    used: 150,
    periodEnd: "2026-10-03T11:37:00.000Z",
    endsAt: null,
  },
  manageable: true,
  purchase: { kind: "top" },
};

/** Nobody has ever paid: both tiers, through the Checkout door. */
const UNSUBSCRIBED: BillingSummary = {
  plan: { kind: "free", limit: 3, used: 3 },
  manageable: false,
  purchase: { kind: "checkout", tiers: [READER, RESEARCHER] },
};

const jsonOk = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.unstubAllGlobals();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  /* `useBilling` reads `?checkout=` on mount and cleans it with `replaceState`,
     so a query string left by another test would send this one down the
     Checkout-confirm path instead of the ordinary read. */
  history.replaceState(null, "", "/pricing");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Let React flush, and any promise already in flight resolve. */
async function settle(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

async function show(what: "pricing" | "profile", summary: BillingSummary): Promise<HTMLElement> {
  vi.stubGlobal("fetch", async () => jsonOk(summary));
  await act(async () => {
    root.render(what === "pricing" ? <PricingPage readerId={ALICE} /> : <BillingSection />);
  });
  await settle();
  return host;
}

/**
 * The plan buttons, in the order they are drawn.
 *
 * `site-cta` rather than every `<button>`: the fine print's tooltip trigger and
 * the *Try again* link are buttons too, and counting those would make "no plan
 * button" pass while one was on screen.
 */
function ctas(page: HTMLElement): HTMLButtonElement[] {
  return [...page.querySelectorAll<HTMLButtonElement>("button.site-cta")];
}

/** What each plan button says — the visible label, which is the claim. */
const ctaLabels = (page: HTMLElement): string[] => ctas(page).map((b) => b.textContent ?? "");

describe("/pricing, for a reader who already pays", () => {
  it("offers a Reader the tier above, and no button on the tier they are on", async () => {
    const page = await show("pricing", ON_READER);
    /* One button, on Researcher's card. The Free and Reader cards keep their
       prices and lose their buttons: this page draws the website's three plans
       whatever the reader is on. */
    expect(ctaLabels(page)).toEqual(["Switch to Researcher"]);
  });

  it("says the switch is made at Stripe, before the button is pressed", async () => {
    const page = await show("pricing", ON_READER);
    /* The press opens the hosted Portal, where the plan is chosen again and
       confirmed — so the page says so rather than letting the reader find out.
       The same sentence `/profile` shows, from src/billing-plan.ts. */
    expect(page.textContent).toContain(SWITCHING_PLAN);
  });

  it("tells a Researcher why there is no button, rather than leaving a gap", async () => {
    const page = await show("pricing", ON_RESEARCHER);
    expect(ctaLabels(page)).toEqual([]);
    /* Prices with nothing to press and nothing said is the page this whole
       feature exists to stop existing. */
    expect(page.textContent).toContain(noHigherPlan("Spideryarn Researcher"));
    expect(page.textContent).not.toContain(SWITCHING_PLAN);
  });

  it("leaves a reader who has never subscribed exactly as they were", async () => {
    const page = await show("pricing", UNSUBSCRIBED);
    /* Both paid tiers, as a purchase rather than a switch, cheapest first — and
       the Free card still has its own *Start reading* press only when signed
       out, which is why it is absent here. */
    expect(ctaLabels(page)).toEqual(["Get Reader", "Get Researcher"]);
    expect(page.textContent).not.toContain(SWITCHING_PLAN);
    expect(page.textContent).not.toContain("largest plan");
  });
});

describe("/profile, where the cards are the offers themselves", () => {
  beforeEach(() => {
    history.replaceState(null, "", "/profile");
  });

  it("draws a Reader one card, for the tier above, and calls the press what it is", async () => {
    const page = await show("profile", ON_READER);
    expect(ctaLabels(page)).toEqual(["Switch plan"]);
    /* **The accessible name carries the plan and contains the visible label.**
       Three buttons reading *Upgrade* are one button in a screen reader's button
       list, and a name that does not contain the visible words breaks voice
       control (WCAG 2.5.3). */
    expect(ctas(page)[0]?.getAttribute("aria-label")).toBe("Switch plan to Researcher");
    /* The card is Researcher's, and Reader is not on the row at all: this page
       builds its cards from the offers, so a filtered offer is a missing card. */
    const headings = [...page.querySelectorAll("h3")].map((h) => h.textContent);
    expect(headings).toEqual(["Researcher"]);
    expect(page.textContent).toContain(SWITCHING_PLAN);
    /* And not the buying sentence, none of which is true of a switch: no card is
       being taken and no subscription is being sold. */
    expect(page.textContent).not.toContain("takes the card details");
  });

  it("says why a Researcher has no cards", async () => {
    const page = await show("profile", ON_RESEARCHER);
    expect(ctaLabels(page)).toEqual([]);
    expect(page.textContent).toContain(noHigherPlan("Spideryarn Researcher"));
  });

  /**
   * **Cheapest first, because nothing downstream will fix it.** `PlanCards`
   * promotes nothing and draws plans in the order it is handed them, so the
   * order the server filters into is the order the reader reads.
   */
  it("draws the offers in the order they arrive, and buys with the checkout verb", async () => {
    const page = await show("profile", UNSUBSCRIBED);
    const headings = [...page.querySelectorAll("h3")].map((h) => h.textContent);
    expect(headings).toEqual(["Reader", "Researcher"]);
    expect(ctaLabels(page)).toEqual(["Upgrade", "Upgrade"]);
    expect(page.textContent).toContain("takes the card details");
  });
});
