// @vitest-environment jsdom
/**
 * The administrator's cost section on the metadata page —
 * [src/web/ArticleCost.tsx](../src/web/ArticleCost.tsx),
 * docs/plans/260930f-article-cost-on-the-metadata-page.md.
 *
 * The real component against a stubbed `fetch`. What it has to get right is
 * less the arithmetic (three pockets added, the store's test holds the SQL)
 * than **saying when the total is a floor**: a figure with unpriced calls behind
 * it must not look like the whole truth.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
/* `apiFetch` reaches for IndexedDB; see tests/admin-page.test.tsx. */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArticleCost, ArticleCostLine } from "../src/admin.js";

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

const { ArticleCostBody, lineName } = await import("../src/web/ArticleCost.js");

function line(over: Partial<ArticleCostLine>): ArticleCostLine {
  return {
    scopeKind: "job_step",
    job: "hierarchy",
    stepName: "hierarchy",
    category: "default-step work",
    calls: 1,
    creditsNanos: 0,
    byokNanos: 0,
    computedNanos: 0,
    computedCalls: 0,
    unpricedCalls: 0,
    nonOkCalls: 0,
    firstAt: "2026-09-30T10:00:00.000Z",
    lastAt: "2026-09-30T10:00:00.000Z",
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;
let fetchSpy: ReturnType<typeof vi.fn>;

function answer(status: number, body: unknown): void {
  fetchSpy.mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

async function mount(slug = "an-article-spya-abc123"): Promise<void> {
  await act(async () => {
    root.render(<ArticleCostBody slug={slug} />);
  });
  /* The fetch, then the JSON, then the state update. */
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("the article cost section", () => {
  it("asks the admin route for this slug", async () => {
    answer(200, { slug: "an-article-spya-abc123", lines: [], silentLiveSessions: 0 });
    await mount();
    const url = String(fetchSpy.mock.calls[0]?.[0]);
    expect(url).toContain("/api/admin/articles/an-article-spya-abc123/cost");
  });

  it("totals every pocket and lists the lines largest first", async () => {
    const cost: ArticleCost = {
      slug: "a",
      lines: [
        line({ job: "chat", stepName: null, scopeKind: "request", creditsNanos: 2_000_000, calls: 3 }),
        line({ creditsNanos: 60_000_000 }),
        line({ job: "labels", creditsNanos: 40_000_000, byokNanos: 1_000_000, calls: 2 }),
      ],
      silentLiveSessions: 0,
    };
    answer(200, cost);
    await mount();
    expect(host.querySelector("[data-testid=article-cost-total]")?.textContent).toContain(
      "$0.1030",
    );
    expect(host.textContent).toContain("over 6 calls");
    const rows = [...host.querySelectorAll("tbody tr")].map((r) => r.firstChild?.textContent);
    expect(rows).toEqual(["hierarchy", "hierarchy · labels", "chat"]);
    /* Nothing is unpriced, so the total is not called a floor. */
    expect(host.textContent).not.toContain("at least");
    expect(host.textContent).not.toContain("reported no cost");
    /* The fee is on buying credits: $0.1020 of credits, not the $0.1030 total. */
    expect(host.textContent).toContain("$0.1020 of this is OpenRouter credits");
  });

  it("says how many calls failed, because they usually still cost", async () => {
    answer(200, {
      slug: "a",
      lines: [line({ creditsNanos: 5_000_000, calls: 4, nonOkCalls: 2 })],
      silentLiveSessions: 0,
    } satisfies ArticleCost);
    await mount();
    expect(host.textContent).toContain("2 calls failed or were stopped, and are included");
  });

  it("says the total is a floor when calls reported no cost", async () => {
    answer(200, {
      slug: "a",
      lines: [line({ creditsNanos: 10_000_000, calls: 3, unpricedCalls: 2 })],
      silentLiveSessions: 1,
    } satisfies ArticleCost);
    await mount();
    expect(host.textContent).toContain("at least");
    expect(host.textContent).toContain("2 calls reported no cost");
    expect(host.textContent).toContain("1 live conversation connected and never reported usage");
    expect(host.querySelector("tbody td:last-child")?.textContent).toBe("$0.0100+");
  });

  it("says so when nothing has been recorded", async () => {
    answer(200, { slug: "a", lines: [], silentLiveSessions: null } satisfies ArticleCost);
    await mount();
    expect(host.textContent).toContain("No model calls are recorded against this article.");
  });

  it("shows a refusal as an error rather than as a zero", async () => {
    answer(403, { error: "Forbidden" });
    await mount();
    expect(host.querySelector("[role=alert]")?.textContent).toContain(
      "Could not read what this article cost",
    );
    expect(host.textContent).not.toContain("$0");
  });
});

describe("lineName", () => {
  it("names step work by its step and request work by its job", () => {
    expect(lineName(line({}))).toBe("hierarchy");
    expect(lineName(line({ job: "referee_claims", stepName: null }))).toBe("referee claims");
    expect(lineName(line({ job: "labels" }))).toBe("hierarchy · labels");
  });
});
