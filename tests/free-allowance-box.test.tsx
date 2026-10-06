// @vitest-environment jsdom
/**
 * **The shelf's free-allowance box** — src/web/FreeAllowance.tsx, plan 261001m
 * stage 2.
 *
 * Mounted against a plan rather than a fetch: the one read is `useBilling`'s,
 * which tests/billing-usage-route.test.ts and the pricing tests already cover,
 * and what can go wrong here is what the box says to whom. Four rules:
 *
 * - it is drawn for `free` and `lapsed` only — a subscriber or an
 *   administrator has no free allowance to be told about;
 * - with no gifts, the words *gift* and *voucher* appear nowhere (Greg:
 *   *"If they don't have a voucher, don't mention vouchers at all"*);
 * - with one, a gift icon sits by the remaining count and the collapsed
 *   section lists it;
 * - the *a gift has been added* notice shows inside seven days of the claim
 *   and goes for good when dismissed.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ReaderPlan } from "../src/billing-plan.js";

const { FreeAllowanceBox, GIFT_NOTICE_DAYS } = await import("../src/web/FreeAllowance.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* jsdom's `localStorage` is shadowed by Node's own global here (see
   src/web/shelf-hidden-columns.ts), so the test brings its own. */
const stored = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
    clear: () => stored.clear(),
  },
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-05T12:00:00Z");

const FREE: Extract<ReaderPlan, { kind: "free" }> = {
  kind: "free",
  limit: 3,
  used: 1,
  sharedHalfPrice: 0,
  atLimit: false,
  highPower: 0, minimal: 0,
  remaining: 2,
};

function gifted(claimedAt: string): ReaderPlan {
  return {
    ...FREE,
    limit: 23,
    remaining: 22,
    gifts: [{ articles: 20, claimedAt, noticeKey: "v-1" }],
  };
}

let host: HTMLDivElement;
let root: Root;

function render(plan: ReaderPlan, now = NOW) {
  act(() => root.render(<FreeAllowanceBox plan={plan} now={now} />));
}

const text = () => host.textContent ?? "";

beforeEach(() => {
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("who sees it", () => {
  it("is drawn for a free reader, with the server's own headline and remaining", () => {
    render(FREE);
    expect(text()).toContain("Free — 1 of 3 articles used");
    expect(host.querySelector("[data-testid=free-remaining]")?.textContent).toContain("2");
  });

  it("is drawn for a lapsed reader, who has no used count to show", () => {
    render({ kind: "lapsed", limit: 3, remaining: 1 });
    expect(host.querySelector("[data-testid=free-allowance]")).not.toBeNull();
    expect(host.querySelector("[data-testid=free-remaining]")?.textContent).toContain("1");
  });

  for (const plan of [
    {
      kind: "paid",
      tierId: "reader",
      tierName: "Reader",
      limit: 30,
      used: 2,
      sharedHalfPrice: 0,
      atLimit: false,
      highPower: 0, minimal: 0,
      periodEnd: "2026-11-01T00:00:00Z",
      endsAt: null,
    },
    { kind: "exempt" },
    { kind: "unknown" },
  ] as ReaderPlan[]) {
    it(`is not drawn for ${plan.kind}`, () => {
      render(plan);
      expect(host.innerHTML).toBe("");
    });
  }
});

describe("gifts", () => {
  it("says nothing about gifts or vouchers to a reader who has none", () => {
    render(FREE);
    /* Open the details too, so the hidden half is in the text as well. */
    const details = host.querySelector("details");
    expect(details).not.toBeNull();
    act(() => {
      (details as HTMLDetailsElement).open = true;
    });
    expect(text().toLowerCase()).not.toMatch(/gift|voucher/);
    expect(host.querySelector("[data-testid=gift-icon]")).toBeNull();
  });

  it("marks the remaining count and lists the gift when there is one", () => {
    render(gifted("2026-09-01T09:00:00Z"));
    expect(host.querySelector("[data-testid=gift-icon]")).not.toBeNull();
    const details = host.querySelector("details");
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain("20 articles, a gift, added 1 September 2026");
  });

  it("explains the allowance and links to the pricing page", () => {
    render(FREE);
    const details = host.querySelector("details");
    expect(details?.textContent).toMatch(/not per month|not monthly|lifetime/i);
    expect(details?.textContent).toMatch(/half/);
    expect(details?.querySelector('a[href="/pricing"]')).not.toBeNull();
    expect(details?.querySelector('a[href="/profile"]')).not.toBeNull();
  });
});

describe("the notice", () => {
  it("shows a gift claimed inside the last week", () => {
    render(gifted(new Date(NOW - 2 * DAY).toISOString()));
    expect(text()).toContain("A gift of 20 articles has been added to your free allowance");
    expect(host.querySelector("[data-testid=gift-notice-dismiss]")?.getAttribute("aria-label")).toBe(
      "Dismiss gift of 20 articles notice",
    );
  });

  it(`does not show one claimed more than ${GIFT_NOTICE_DAYS} days ago`, () => {
    render(gifted(new Date(NOW - (GIFT_NOTICE_DAYS + 1) * DAY).toISOString()));
    expect(text()).not.toContain("has been added");
  });

  it("goes when dismissed, and stays gone on the next mount", () => {
    const plan = gifted(new Date(NOW - DAY).toISOString());
    render(plan);
    const dismiss = host.querySelector<HTMLButtonElement>("[data-testid=gift-notice-dismiss]");
    expect(dismiss).not.toBeNull();
    act(() => dismiss?.click());
    expect(text()).not.toContain("has been added");

    act(() => root.unmount());
    root = createRoot(host);
    render(plan);
    expect(text()).not.toContain("has been added");
  });

  it("still draws the box when storage throws", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      render(gifted(new Date(NOW - DAY).toISOString()));
      expect(text()).toContain("has been added");
      const dismiss = host.querySelector<HTMLButtonElement>("[data-testid=gift-notice-dismiss]");
      act(() => dismiss?.click());
      expect(text()).not.toContain("has been added");
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });
});
