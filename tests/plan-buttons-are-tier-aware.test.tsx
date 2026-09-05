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
 * says the rest (`switchingPlan`).
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

import { noHigherPlan, switchingPlan } from "../src/billing-plan.js";
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
    sharedHalfPrice: 0,
    atLimit: false,
    periodEnd: "2026-10-03T11:37:00.000Z",
    endsAt: null,
  },
  manageable: true,
  purchase: { kind: "switch", tiers: [RESEARCHER], from: "paid" },
};

/**
 * The same Reader, on a free **trial** rather than in a paid month.
 *
 * `trialing` is an entitled status (`ENTITLED_STATUSES`, src/billing/tiers.ts),
 * so this account reaches the same `switch` arm — and every one of the three
 * claims the paid sentence makes is false for it: the Portal is configured
 * `trial_update_behavior: "end_trial"`, so there is no difference to invoice,
 * the period does not stay where it is, and the allowance is not prorated.
 * GPT Sol, 2026-09-04, finding 2.
 */
const ON_TRIAL: BillingSummary = {
  ...ON_READER,
  purchase: { kind: "switch", tiers: [RESEARCHER], from: "trial" },
};

/** The top of the ladder: a subscription, and nothing above it. */
const ON_RESEARCHER: BillingSummary = {
  plan: {
    kind: "paid",
    tierId: "researcher",
    tierName: "Spideryarn Researcher",
    limit: 150,
    used: 150,
    sharedHalfPrice: 0,
    atLimit: false,
    periodEnd: "2026-10-03T11:37:00.000Z",
    endsAt: null,
  },
  manageable: true,
  purchase: { kind: "top" },
};

/** Nobody has ever paid: both tiers, through the Checkout door. */
const UNSUBSCRIBED: BillingSummary = {
  plan: { kind: "free", limit: 3, used: 3, sharedHalfPrice: 0, atLimit: true },
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

/**
 * Every checkout POST the page made, as the **body it sent**.
 *
 * The body, not the URL: until 2026-09-05 these tests recorded neither, and
 * `startCheckout` mutated to post `{"tierId":"researcher"}` for every press left
 * all 24 of them green — a *Get Reader* button opening a $50 Researcher Checkout,
 * with nothing red anywhere. GPT Sol, 2026-09-04, finding 3.
 */
let bought: string[];

async function show(what: "pricing" | "profile", summary: BillingSummary): Promise<HTMLElement> {
  bought = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/billing/checkout")) {
      bought.push(typeof init?.body === "string" ? init.body : String(init?.body));
      /* **No `url` in the answer**, so `useBilling` treats it as a failure and
         stays on the page: jsdom cannot navigate, and a press that left for
         Stripe would take the next assertion with it. It also puts `busy` back
         to null, which is what lets a second button be pressed below. */
      return jsonOk({ kind: "checkout" });
    }
    return jsonOk(summary);
  });
  await act(async () => {
    root.render(what === "pricing" ? <PricingPage readerId={ALICE} /> : <BillingSection />);
  });
  await settle();
  return host;
}

/** Press one plan button by its visible label, and let the POST go out. */
async function press(page: HTMLElement, label: string): Promise<void> {
  const button = ctas(page).find((b) => b.textContent === label);
  expect(button, `no plan button reading "${label}"`).toBeTruthy();
  await act(async () => {
    button?.click();
  });
  await settle();
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

/**
 * **A body this bundle does not understand fails as a sentence, not as a blank
 * page.**
 *
 * `readJson<BillingSummary>` is `JSON.parse(text) as T` and nothing more, so the
 * type's guarantees hold only while the server is the version the bundle was
 * built against — and during a deploy, or the minutes a rollback takes, it is
 * not. A reply carrying the `canCheckout`/`offers` pair `purchase` replaced on
 * 2026-09-04 has no `purchase`, and `summary.purchase.kind` on `undefined` is a
 * throw **inside a render**, which takes the whole billing area with it.
 * GPT Sol, 2026-09-04, finding 5. Watched failing on 2026-09-05 against the
 * unvalidated version, where the render threw.
 */
describe("a summary from a server this bundle does not match", () => {
  /** Exactly what `/api/billing/usage` answered before 2026-09-04. */
  const LEGACY = {
    plan: {
      kind: "paid",
      tierId: "reader",
      tierName: "Spideryarn Reader",
      limit: 20,
      used: 20,
      sharedHalfPrice: 0,
      atLimit: false,
      periodEnd: "2026-10-03T11:37:00.000Z",
      endsAt: null,
    },
    manageable: true,
    canCheckout: false,
    offers: [READER, RESEARCHER],
  } as unknown as BillingSummary;

  it("says it could not read the plan, and leaves a way back", async () => {
    const page = await show("profile", LEGACY);
    expect(page.textContent).toContain("Couldn't read your plan");
    /* And a *Try again*, because a deploy finishing is exactly the kind of
       failure that a second attempt fixes. */
    expect([...page.querySelectorAll("button")].map((b) => b.textContent)).toContain("Try again");
  });

  /** The same on `/pricing`, where the prices are drawn regardless. */
  it("leaves the prices on screen and draws no plan button", async () => {
    const page = await show("pricing", LEGACY);
    expect(ctaLabels(page)).toEqual([]);
    expect(page.textContent).toContain("Reader");
  });

  /**
   * **And an offer of nothing dressed as an offer of something is refused too**,
   * which is the tuple's own claim rather than a missing field: a `checkout`
   * with an empty list would draw a heading, a sentence about card details, and
   * no cards at all.
   */
  it("refuses a purchase whose list is empty", async () => {
    const empty = { ...ON_READER, purchase: { kind: "checkout", tiers: [] } } as unknown as BillingSummary;
    const page = await show("profile", empty);
    expect(page.textContent).toContain("Couldn't read your plan");
  });
});

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
    expect(page.textContent).toContain(switchingPlan("paid"));
  });

  /**
   * **A trialling reader is told what a switch does to a trial**, and none of
   * the three things it does not do.
   *
   * The negative assertions are the ones that matter: the sentence they replace
   * promised an invoice for "the difference", an unmoved renewal date and a
   * part-month allowance, and a trial has none of those. Watched failing on
   * 2026-09-05 against a page that printed `switchingPlan("paid")` whatever the
   * arm said.
   */
  it("tells a trialling reader what ending their trial costs, not the paid story", async () => {
    const page = await show("pricing", ON_TRIAL);
    /* Still one button — the capability is not what was wrong. */
    expect(ctaLabels(page)).toEqual(["Switch to Researcher"]);
    expect(page.textContent).toContain(switchingPlan("trial"));
    expect(page.textContent).not.toContain(switchingPlan("paid"));
    /* **The clause named on its own**, so a reworded paid sentence that quietly
       kept the false promise is red rather than merely different. Only this one
       of the three here: the FAQ further down the same page answers *what
       happens when I reach my limit* with a part-month allowance, and that
       sentence says "on a paid plan" in as many words, so it is true and a raw
       substring match would catch it. The other two clauses are asserted on
       `/profile`, which has no FAQ under it. */
    expect(page.textContent).not.toContain("your renewal date does not move");
  });

  it("tells a Researcher why there is no button, rather than leaving a gap", async () => {
    const page = await show("pricing", ON_RESEARCHER);
    expect(ctaLabels(page)).toEqual([]);
    /* Prices with nothing to press and nothing said is the page this whole
       feature exists to stop existing. */
    expect(page.textContent).toContain(noHigherPlan("Spideryarn Researcher"));
    expect(page.textContent).not.toContain(switchingPlan("paid"));
  });

  /**
   * **The tier id on the wire, which is the only part of a press that spends
   * money.**
   *
   * Every test in this file used to assert labels and cards and never once
   * pressed anything, so the id the button actually posts was uncovered:
   * `startCheckout` mutated to send `researcher` whatever was pressed kept the
   * whole file green while *Get Reader* opened a $50 Checkout. Watched failing
   * that way on 2026-09-05 before this existed. GPT Sol, finding 3.
   *
   * Both buttons, because a mutation that swapped the two would still satisfy
   * one of them.
   */
  it("posts the tier that was pressed, and not the other one", async () => {
    const page = await show("pricing", UNSUBSCRIBED);
    await press(page, "Get Reader");
    expect(bought).toEqual(['{"tierId":"reader"}']);
    await press(page, "Get Researcher");
    expect(bought).toEqual(['{"tierId":"reader"}', '{"tierId":"researcher"}']);
  });

  /**
   * **And the filter really reaches the press**, which is the half a rendering
   * assertion cannot see: the author's own note on this change said the client
   * tests never exercised it. A Reader's only button is Researcher's, and what it
   * posts is `researcher` — a page that had drawn the right label over the wrong
   * id would buy the plan they are already on.
   */
  it("posts the tier above for a subscriber, through the switch button", async () => {
    const page = await show("pricing", ON_READER);
    await press(page, "Switch to Researcher");
    expect(bought).toEqual(['{"tierId":"researcher"}']);
  });

  it("leaves a reader who has never subscribed exactly as they were", async () => {
    const page = await show("pricing", UNSUBSCRIBED);
    /* Both paid tiers, as a purchase rather than a switch, cheapest first — and
       the Free card still has its own *Start reading* press only when signed
       out, which is why it is absent here. */
    expect(ctaLabels(page)).toEqual(["Get Reader", "Get Researcher"]);
    expect(page.textContent).not.toContain(switchingPlan("paid"));
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
    expect(page.textContent).toContain(switchingPlan("paid"));
    /* And not the buying sentence, none of which is true of a switch: no card is
       being taken and no subscription is being sold. */
    expect(page.textContent).not.toContain("takes the card details");
  });

  /**
   * **The first card's *Upgrade* buys the first card's tier.** Here the cards
   * *are* the offers, so a page that drew them in one order and posted from
   * another would be invisible to every label assertion above — which is exactly
   * how the mutated `startCheckout` stayed green.
   */
  it("posts the tier belonging to the card that was pressed", async () => {
    const page = await show("profile", UNSUBSCRIBED);
    const buttons = ctas(page);
    expect(buttons).toHaveLength(2);
    await act(async () => {
      buttons[0]?.click();
    });
    await settle();
    expect(bought).toEqual(['{"tierId":"reader"}']);
  });

  /** The same rule on the other page, since one sentence serves both. */
  it("gives a trialling reader the trial sentence here too", async () => {
    const page = await show("profile", ON_TRIAL);
    expect(page.textContent).toContain(switchingPlan("trial"));
    /* All three false claims, clause by clause. */
    expect(page.textContent).not.toContain("your renewal date does not move");
    expect(page.textContent).not.toContain("invoices the difference");
    expect(page.textContent).not.toContain("part of the month that is left");
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
