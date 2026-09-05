// @vitest-environment jsdom
/**
 * **The plan you pressed before you signed in — bought once, and only if you may.**
 *
 * A stranger presses *Get Reader* on `/pricing`, signs in with Google on that
 * same page, and comes back to it. The tier they pressed rides in a
 * `sessionStorage` marker (src/web/buy-intent.ts) rather than in the URL, and
 * the page finishes what they started by posting `/api/billing/checkout`.
 *
 * Three things have to hold, and the first is the reason this file exists at
 * all.
 *
 * 1. **Exactly one checkout POST, under `<StrictMode>`.** React mounts a
 *    component, runs its effects, tears them down and runs them again, on the
 *    same instance — and a real remount, or a press of Back from Stripe, does
 *    something similar for real. The mechanism that makes all of those safe is
 *    that the marker is **consumed before the POST is sent**, so the second
 *    pass finds an empty slot. A test that never mounted twice would prove none
 *    of that, which is why this one wraps the page in `<StrictMode>` rather
 *    than asserting about it. GPT Sol asked for exactly this, reviewing
 *    docs/plans/260904b-pricing-page-and-public-showcase.md.
 * 2. **A stale marker is ignored.** Ten minutes, the same window
 *    `auth-return.ts` allows the round trip it rides in. A tab left open over
 *    lunch must not open Stripe when it is touched.
 * 3. **A tier the reader may not buy is ignored, silently.** The marker says
 *    what was asked for and never that it is allowed: the summary decides, by
 *    `canCheckout` and by whether the tier is on sale at all. Silently, because
 *    the cards are on screen either way and there is nothing to explain.
 *
 * **The double-mount case was red first**, and it was worse than two POSTs. Run
 * against an implementation that read the marker where it was needed and would
 * have deleted it when the checkout succeeded, this test does not fail — it
 * *times out*, because `useBilling` hands back a fresh object on every render,
 * the effect that watches it re-runs when a failed press puts `busy` back, and
 * a marker that is still there posts again. An unbounded loop of Checkout
 * Sessions, from one press of a button. Consuming on mount is what turns that
 * into one request.
 *
 * Same shape as tests/pricing-page-current-plan.test.tsx — the real component
 * against a stubbed `fetch` — and it deliberately does not re-assert what that
 * file already holds about the current-plan line.
 */
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
/* `apiFetch` reaches for IndexedDB (the offline cache in lib/api.ts), which
   jsdom does not have — and the failure is a hang rather than a throw, so the
   symptom is every test in this file timing out with no error. */
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
  /* The sign-in panel imports this. It is never called here — nothing in these
     tests presses Google — but a mock factory that omits an export makes the
     import itself throw. */
  googleSignInAvailable: async () => true,
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

const { PricingPage } = await import("../src/web/PricingPage.js");
const { rememberBuyIntent } = await import("../src/web/buy-intent.js");

/** The key buy-intent.ts writes. Spelled out, so a rename here is deliberate. */
const KEY = "spideryarn:buy-intent";

const ALICE = "aaaaaaaa-2222-4000-8000-000000000003";

const READER_OFFER = {
  id: "reader",
  name: "Spideryarn Reader",
  description: "20 articles a month.",
  ingestsPerPeriod: 20,
  amounts: { usd: 1000, gbp: 800, eur: 900 },
};

const RESEARCHER_OFFER = {
  id: "researcher",
  name: "Spideryarn Researcher",
  description: "150 articles a month.",
  ingestsPerPeriod: 150,
  amounts: { usd: 5000, gbp: 4000, eur: 4500 },
};

/** A free account that may check out, with Reader on sale. */
const FREE: BillingSummary = {
  plan: { kind: "free", limit: 3, used: 1, sharedHalfPrice: 0, atLimit: false },
  manageable: false,
  purchase: { kind: "checkout", tiers: [READER_OFFER] },
};

/** What a `fetch` call sent, as the string it sent — never a re-serialisation. */
const bodyOf = (init?: RequestInit): string | null =>
  typeof init?.body === "string" ? init.body : null;

const jsonOk = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

let host: HTMLDivElement;
let root: Root;
/**
 * Every request the page made, in order — method, path, and **the body**.
 *
 * The body since 2026-09-05: without it, `startCheckout` mutated to post
 * `{"tierId":"researcher"}` for every press left this file green while a
 * remembered *Get Reader* opened a $50 Researcher Checkout. A marker that buys
 * the wrong plan is worse than one that buys nothing, and nothing here could
 * see it. GPT Sol, 2026-09-04, finding 3.
 */
let asked: { method: string; url: string; body: string | null }[];

beforeEach(() => {
  vi.unstubAllGlobals();
  asked = [];
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  /* `useBilling` reads `?checkout=` out of the address on mount, so a query
     string left by another test would send this one down the confirm path. */
  history.replaceState(null, "", "/pricing");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  /* The expiry test moves `Date.now`. Left in place it would make every later
     file in this worker disagree with the clock. */
  vi.restoreAllMocks();
});

async function settle(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/**
 * Mount the page **inside `<StrictMode>`**, with `fetch` answering the billing
 * routes and recording every call.
 *
 * The checkout answer deliberately has no `url` in it, so `useBilling` treats it
 * as a failure and stays on the page: jsdom cannot navigate, and — the reason
 * that is a feature here — a checkout that fails puts `busy` back to `null` and
 * renders an error, which re-runs the effect that fires the intent. A test whose
 * page had left for Stripe could not see a second POST even if one were coming.
 */
async function show(summary: BillingSummary | null = FREE): Promise<void> {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    asked.push({ method: init?.method ?? "GET", url, body: bodyOf(init) });
    if (url.includes("/api/billing/usage")) {
      if (summary === null) return new Response("nope", { status: 500 });
      return jsonOk(summary);
    }
    if (url.includes("/api/billing/checkout")) return jsonOk({ kind: "checkout" });
    return new Response("nope", { status: 404 });
  });

  await mount();
}

/** Mount the signed-in page in `<StrictMode>` against whatever `fetch` is. */
async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      <StrictMode>
        <PricingPage readerId={ALICE} />
      </StrictMode>,
    );
  });
  await settle();
}

const checkouts = () => asked.filter((a) => a.url.includes("/api/billing/checkout"));

describe("a stranger pressing a plan", () => {
  /**
   * The other end of the same round trip, and the half a signed-in test cannot
   * see: the press has to leave something behind **and ask the server nothing**.
   * `tests/pricing-page-current-plan.test.tsx` holds the rule that a signed-out
   * `/pricing` makes no request at all; this holds that the button added on
   * 2026-09-04 still obeys it.
   */
  it("remembers the tier and asks the server nothing at all", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      asked.push({ method: init?.method ?? "GET", url, body: bodyOf(init) });
      return new Response("nope", { status: 404 });
    });

    await act(async () => {
      root.render(<PricingPage readerId={null} />);
    });
    await settle();

    const get = [...host.querySelectorAll("button")].find((b) => b.textContent === "Get Reader");
    expect(get, "no way to buy Reader on the signed-out pricing page").toBeTruthy();
    await act(async () => {
      get?.click();
    });

    expect(JSON.parse(sessionStorage.getItem(KEY) ?? "null")).toMatchObject({ tierId: "reader" });
    expect(asked).toEqual([]);
    /* And the panel the press scrolls to is really on the page, since the press
       is worth nothing without somewhere to sign in. */
    expect(host.querySelector("#sign-in")).toBeTruthy();
  });
});

describe("finishing a purchase that a sign-in interrupted", () => {
  it("posts one checkout, once, even though StrictMode mounts the page twice", async () => {
    rememberBuyIntent("reader");
    await show();

    expect(checkouts()).toHaveLength(1);
    expect(checkouts()[0]?.method).toBe("POST");
    /* **And it bought *Reader*, which is the tier the marker named.** A method
       and a URL say a purchase happened; only the body says which one, and the
       whole point of the marker is that it survives a sign-in carrying the plan
       somebody actually pressed. */
    expect(checkouts()[0]?.body).toBe('{"tierId":"reader"}');
    /* And the marker is gone, which is what makes a real remount — or Back from
       Stripe onto this page — safe rather than lucky. */
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("ignores a marker older than the sign-in it was meant to survive", async () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ tierId: "reader", createdAt: Date.now() - 20 * 60 * 1000 }),
    );
    await show();

    expect(checkouts()).toEqual([]);
    /* Consumed all the same: a stale marker that stayed would be spent by
       whatever the reader did next. */
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("ignores a tier nobody sells, and says nothing about it", async () => {
    rememberBuyIntent("platinum");
    await show();

    expect(checkouts()).toEqual([]);
    /* Silently. The cards are on screen either way, and a reader who pressed a
       button a minute ago did not ask this page to explain itself. */
    expect(host.textContent).not.toContain("platinum");
    expect(host.textContent).toContain("Researcher");
  });

  it("ignores a marker for a tier this account may not buy", async () => {
    rememberBuyIntent("reader");
    /* A Reader who pressed *Get Reader* before signing in, and turns out to be
       on Reader already. `purchase` is the server's answer to *what may this
       account buy*, and since 2026-09-04 it is tier-aware: Researcher is on the
       list and Reader is not, so the marker buys nothing. Asking the plan
       instead is the bug BillingSection.tsx carries a comment about. */
    await show({ ...FREE, purchase: { kind: "switch", tiers: [RESEARCHER_OFFER], from: "paid" } });

    expect(checkouts()).toEqual([]);
  });

  it("ignores a marker entirely when there is nothing this account may buy", async () => {
    rememberBuyIntent("reader");
    await show({ ...FREE, purchase: { kind: "top" } });

    expect(checkouts()).toEqual([]);
  });

  it("waits for the summary rather than posting on a page that failed to read one", async () => {
    rememberBuyIntent("reader");
    await show(null);

    expect(checkouts()).toEqual([]);
    /* The prices are still there — a failed billing read is not a failed page. */
    expect(host.textContent).toContain("Reader");
  });

  /**
   * **The ten minutes are measured to the POST, not to the mount.**
   *
   * Reproduced by GPT Sol reviewing stage 1
   * (docs/plans/260904b-stage1-code-review-sol.md, finding 4): the marker was
   * read and age-checked on mount, and the tier id alone was carried forward, so
   * a `/api/billing/usage` that took eleven minutes to answer opened Stripe on an
   * intent that had expired long before. Nothing bounds that gap — a hanging
   * request, a sleeping laptop — and the window exists precisely so that a
   * purchase belongs to the minute somebody asked for it.
   */
  it("does not buy on a marker that expired while the summary was still in flight", async () => {
    rememberBuyIntent("reader");

    /* The usage read, held open. `release` lets it answer, which is the moment
       the page decides whether to post. */
    let release: () => void = () => {};
    const answered = new Promise<void>((go) => {
      release = go;
    });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      asked.push({ method: init?.method ?? "GET", url, body: bodyOf(init) });
      if (url.includes("/api/billing/usage")) {
        await answered;
        return jsonOk(FREE);
      }
      if (url.includes("/api/billing/checkout")) return jsonOk({ kind: "checkout" });
      return new Response("nope", { status: 404 });
    });

    await mount();
    /* Nothing yet, and nothing *could* have happened yet — the summary is what
       says whether this account may buy. */
    expect(checkouts()).toEqual([]);

    /* Eleven minutes, on a marker good for ten. */
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60 * 1000);
    release();
    await settle();

    expect(checkouts()).toEqual([]);
    /* **And the read really did land**, which is what stops this passing for the
       wrong reason: a test whose request never answered would show no checkout
       either, and would say nothing about the expiry. */
    expect(host.textContent).toContain("Free — 1 of 3 articles used");
  });
});
