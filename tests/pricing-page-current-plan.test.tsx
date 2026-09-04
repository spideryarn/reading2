// @vitest-environment jsdom
/**
 * `/pricing` says which plan you are on — and says nothing to a stranger.
 *
 * Greg asked on 2026-09-03 for the page to "indicate what you're on now", on a
 * page that is deliberately reachable signed out. Those two pull in opposite
 * directions, and the resolution is a `readerId` prop rather than a hook that
 * always runs (src/web/PricingPage.tsx § which plan you are on). So there are
 * three things to hold, and only one of them is about what appears:
 *
 * 1. A signed-in reader sees the plan line, in the words `/profile` uses — and
 *    in the three states where the headline alone does not say what they are on
 *    (`lapsed`, a cancelling `paid`, `unknown`), the explaining sentence too.
 * 2. **A signed-out reader causes no request at all.** This is the half a
 *    screenshot cannot check and the half that rots: somebody moves the hook up
 *    into `PricingPage` to save a prop, every visible assertion here stays
 *    green, and the busiest signed-out page starts firing a 401 per view. The
 *    stub therefore records *every* URL and the test asserts the list is empty,
 *    rather than asserting the absence of a sentence.
 * 3. **A direct A→B sign-in must not show B the plan it read for A.** The prop
 *    was a boolean once, which is enough to decide whether to ask and not
 *    enough to say who asked: the route does not change on an account switch,
 *    so the instance survives, `useBilling`'s one effect never re-runs, and A's
 *    tier and usage sit under B's session. Found by GPT Sol, and the same bug
 *    the shelf already carries a `key` for (App.tsx § `Library`).
 *
 * The fourth case is a read that fails. There is no wrong sentence to catch
 * there — the point is that the prices still render and nothing about a plan is
 * invented, because this line is an orientation and not a gate.
 *
 * **The plan line is located by its own link, not by a role.** It used to carry
 * `role="status"`, and a test that reaches for `[role="status"]` turns an
 * accessibility decision into a test hook — so removing the role, which was the
 * right call for a passive line on a page that already has a live region, would
 * have broken these tests for a reason that has nothing to do with them.
 *
 * Same shape and reasoning as tests/admin-page.test.tsx: the real component
 * against a stubbed `fetch`, asserting what a reader would see. It is the
 * durable half of a browser pass.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
/* `apiFetch` reaches for IndexedDB (the offline cache in lib/api.ts), which
   jsdom does not have — and the failure is a hang rather than a throw, so the
   symptom is every test in this file timing out with no error. Same import and
   same reason as tests/admin-page.test.tsx. */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BillingSummary } from "../src/billing-plan.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "TOKEN" } } }),
      refreshSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

const { PricingPage } = await import("../src/web/PricingPage.js");

/** A free account with one of its three articles gone. */
const FREE: BillingSummary = {
  plan: { kind: "free", limit: 3, used: 1 },
  offers: [],
  manageable: false,
  canCheckout: true,
};

/**
 * A subscriber, mid-month.
 *
 * `tierName` is the product name off the row rather than a word this file
 * chose, because that is what `describePlan` prints and the assertion below is
 * that the page prints *its* sentence rather than one of its own.
 */
/* `satisfies` rather than an annotation, so the constant keeps its narrow
   `kind: "paid"` type and `CANCELLING` below can spread it. Annotating it as the
   whole union is what forced the old cast. */
const PAID_PLAN = {
  kind: "paid",
  tierId: "reader",
  tierName: "Spideryarn Reader",
  limit: 20,
  used: 4,
  periodEnd: "2026-10-03T11:37:00.000Z",
  endsAt: null,
} satisfies BillingSummary["plan"];

const PAID: BillingSummary = {
  plan: PAID_PLAN,
  offers: [],
  manageable: true,
  canCheckout: false,
};

/**
 * The same subscription, cancelled.
 *
 * Its headline is **word for word** `PAID`'s, so a page that shows only the
 * headline tells a reader whose plan stops in four weeks exactly what it tells
 * one whose plan renews. The date is in `detail` and nowhere else.
 */
/* No `as BillingSummary["plan"]` cast here any more. It used to be needed to
   force a boolean into the union, and a cast in a fixture is precisely how the
   cancellation bug survived a green suite — a hand-built object cast into a type
   carries exactly the fields its author had in mind.
   docs/postmortems/260904a-four-billing-faults-and-the-witnesses-that-agreed-with-the-code.md */
const CANCELLING: BillingSummary = {
  ...PAID,
  plan: { ...PAID_PLAN, endsAt: "2026-10-03T11:37:09.000Z" },
};

/**
 * Subscribed once, not any more, with free slots left.
 *
 * The state the first version of this page failed: *"Your plan has ended"* is
 * the whole headline, and it names what ended rather than what they are on now.
 * `remaining` appears only in `detail`, and `used` is deliberately not on this
 * arm of the union at all — see src/billing-plan.ts.
 */
const LAPSED: BillingSummary = {
  plan: { kind: "lapsed", limit: 3, remaining: 2 },
  offers: [],
  manageable: true,
  canCheckout: true,
};

const jsonOk = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

let host: HTMLDivElement;
let root: Root;
/** Every URL the page asked for, in order. The signed-out case is about this. */
let asked: string[];

beforeEach(() => {
  vi.unstubAllGlobals();
  asked = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  /* `useBilling` reads `?checkout=` out of the address on mount and cleans it
     with `replaceState`, so a query string left by another test would send this
     one down the Checkout-confirm path instead. */
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
 * Mount the page with `fetch` answering `answer`, and record what was asked.
 *
 * `answer` returning `null` means the read fails, which is the third case.
 */
async function show(
  readerId: string | null,
  answer: (url: string) => unknown | null = () => null,
): Promise<HTMLElement> {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    asked.push(url);
    const body = answer(url);
    if (body === null) return new Response("nope", { status: 500 });
    return jsonOk(body);
  });

  await act(async () => {
    /* **No `key` here, deliberately.** App.tsx passes one, but a test that
       supplied it would be testing React's keying rather than this page: remove
       the key from `PricingPage` and such a test stays green. Rendering the
       same element type with only the prop changed is the hostile case, and it
       is the one the account-switch test below drives. */
    root.render(<PricingPage readerId={readerId} />);
  });
  await settle();
  return host;
}

/** Did anything ask the billing route? The question the prop exists to answer. */
const askedBilling = () => asked.filter((u) => u.includes("/api/billing/"));

/**
 * The plan line, found by its own link rather than by a role.
 *
 * `null` when there is no line, which is what the signed-out and failed-read
 * cases assert. See the header on why this is not `[role="status"]`.
 */
function planLine(page: HTMLElement): HTMLElement | null {
  const link = [...page.querySelectorAll("a")].find((a) => a.textContent === "Change plan");
  return link?.closest("p") ?? null;
}

/* **Distinct from `admin-page.test.tsx`'s pair**, which this file collided with
   when the two arrived from different branches on the same day — both authors
   reached for the same obvious placeholder. Nothing here inserts a row (the page
   is mounted against a stubbed `fetch`), so the collision could not have bitten
   at runtime; `tests/fixture-ids.test.ts` refuses it anyway, because "nothing
   inserts under this id today" is not a property that stays true on its own. */
const ALICE = "aaaaaaaa-2222-4000-8000-000000000001";
const BOB = "bbbbbbbb-2222-4000-8000-000000000002";

describe("the pricing page's current-plan line", () => {
  it("tells a signed-in free reader what they are on, in describePlan's words", async () => {
    const page = await show(ALICE, () => FREE);
    /* The exact sentence from src/billing-plan.ts, not a paraphrase: a second
       wording of one state is the duplication this line was built to avoid. */
    expect(planLine(page)?.textContent).toContain("Free — 1 of 3 articles used");
  });

  it("names a subscriber's tier and their month, not the free allowance", async () => {
    const page = await show(ALICE, () => PAID);
    expect(planLine(page)?.textContent).toContain(
      "Spideryarn Reader — 4 of 20 articles this month",
    );
    /* A renewing subscription needs no second sentence — the table above
       explains a monthly allowance, and the renewal date is not news. */
    expect(planLine(page)?.textContent).not.toContain("starts again");
  });

  it("sends a signed-in reader to /profile to change it, rather than selling here", async () => {
    const page = await show(ALICE, () => FREE);
    const change = [...page.querySelectorAll("a")].find((a) => a.textContent === "Change plan");
    expect(change?.getAttribute("href")).toBe("/profile");
  });

  /* ------------------------------------ the states a headline cannot carry -- */

  it("says what a lapsed reader is on now, not merely that something ended", async () => {
    const page = await show(ALICE, () => LAPSED);
    const line = planLine(page)?.textContent ?? "";
    expect(line).toContain("Your plan has ended");
    /* **The assertion that matters**, and the one the first version failed:
       "Your plan has ended" is true of both a reader with two free slots left
       and one with none, and Greg asked what you are *on now*. `remaining`
       lives only in `detail`. */
    expect(line).toContain("2 of 3");
    /* And the forbidden rendering is still impossible: `used` is not on this
       arm of the union, so no ratio wider than the limit can appear. */
    expect(line).not.toContain("of 3 articles used");
  });

  it("tells a cancelling subscriber their plan stops, and when", async () => {
    const page = await show(ALICE, () => CANCELLING);
    const line = planLine(page)?.textContent ?? "";
    /* Identical headline to the renewing case above, which is exactly why the
       detail is not optional here. */
    expect(line).toContain("Spideryarn Reader — 4 of 20 articles this month");
    /* This asserted the word "Cancelled" until 2026-09-04, when the cancellation
       fix rewrote `describePlan`'s detail to say what happens rather than name a
       state. The assertion follows the meaning the test is named for — the plan
       stops, and the date — rather than the vocabulary, which is what changed. */
    expect(line).toContain("Your plan ends on");
    expect(line).toContain("3 October 2026");
    /* And it still says what they go back to, which is the same thing the lapsed
       case above exists to protect: a date alone does not say what happens. */
    expect(line).toContain("free allowance");
  });

  /* --------------------------------------------- the two silences, and why -- */

  it("asks nothing at all when signed out", async () => {
    const page = await show(null, () => FREE);
    /* **The assertion the feature rests on**, and it is about the whole list
       rather than the billing prefix: "no billing call" would still pass if
       somebody put the plan behind a different route. Not "no sentence
       appeared" either — that passes if the request is made and the answer
       thrown away, which is the 401-per-view failure this prop prevents. */
    expect(asked).toEqual([]);
    expect(planLine(page)).toBeNull();
    /* And the page is still the page: the prices are the reason a stranger is
       here, and they come from `Plans`, which holds no state and needs nothing. */
    expect(page.textContent).toContain("Researcher");
  });

  it("still shows the prices, and invents no plan, when the read fails", async () => {
    const page = await show(ALICE, () => null);
    expect(askedBilling()).toEqual(["/api/billing/usage"]);
    expect(planLine(page)).toBeNull();
    expect(page.textContent).toContain("Researcher");
  });

  /* --------------------------------------------------- the account switch -- */

  it("does not show B the plan it read for A", async () => {
    /* Alice is a subscriber; Bob is on the free allowance. Answering by reader
       is what makes the stale rendering visible: without the `key`, the second
       render reuses the instance, no effect re-runs, and Bob reads Alice's
       tier and her usage count. */
    let who = ALICE;
    const byReader = () => (who === ALICE ? PAID : FREE);

    const page = await show(ALICE, byReader);
    expect(planLine(page)?.textContent).toContain("Spideryarn Reader");

    who = BOB;
    /* The same element type, same position, only the prop changed — so React
       would reuse the instance if `PricingPage` did not key the line itself. */
    await act(async () => {
      root.render(<PricingPage readerId={BOB} />);
    });
    await settle();

    expect(planLine(page)?.textContent).toContain("Free — 1 of 3 articles used");
    expect(planLine(page)?.textContent).not.toContain("Spideryarn Reader");
  });
});
