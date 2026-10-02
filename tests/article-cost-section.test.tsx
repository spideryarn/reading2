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
import { readFileSync } from "node:fs";

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

const { ArticleCostBody, articleCostSummary, lineName, useArticleCost } = await import(
  "../src/web/ArticleCost.js"
);

/* What `CostSection` in Metadata.tsx does — one read, handed to both the shut
   heading's line and the body — without the rest of that page. */
const rendered: { slug: string; summary: string | null }[] = [];
function Harness({ slug }: { slug: string }) {
  const load = useArticleCost(slug);
  rendered.push({ slug, summary: articleCostSummary(load) });
  return (
    <>
      <span data-testid="summary">{articleCostSummary(load) ?? "(none)"}</span>
      <ArticleCostBody load={load} />
    </>
  );
}

function summary(): string | null | undefined {
  return host.querySelector("[data-testid=summary]")?.textContent;
}

function line(over: Partial<ArticleCostLine>): ArticleCostLine {
  return {
    scopeKind: "job_step",
    job: "structure",
    stepName: "structure",
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
    root.render(<Harness slug={slug} />);
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
    expect(rows).toEqual(["structure", "structure · labels", "chat"]);
    /* The shut heading says the same total as the body. */
    expect(summary()).toBe("$0.1030 · 6 calls");
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
    expect(host.querySelector("[data-testid=article-cost-total]")?.textContent).toContain(
      "At least $0.0100",
    );
    expect(host.textContent).toContain("2 calls reported no cost");
    expect(host.textContent).toContain("1 live conversation connected and never reported usage");
    expect(host.querySelector("tbody td:last-child")?.textContent).toBe("$0.0100+");
    expect(summary()).toBe("At least $0.0100 · 3 calls");
  });

  it("calls the heading's total a floor when a live conversation went unreported", async () => {
    answer(200, {
      slug: "a",
      lines: [line({ creditsNanos: 10_000_000, calls: 3 })],
      silentLiveSessions: 2,
    } satisfies ArticleCost);
    await mount();
    expect(host.querySelector("[data-testid=article-cost-total]")?.textContent).toContain(
      "At least $0.0100",
    );
    expect(summary()).toBe("At least $0.0100 · 3 calls");
  });

  it("says so when nothing has been recorded", async () => {
    answer(200, { slug: "a", lines: [], silentLiveSessions: null } satisfies ArticleCost);
    await mount();
    expect(host.textContent).toContain("No model calls are recorded against this article.");
    expect(host.textContent).toContain("Only what was recorded and tied to this article");
    expect(summary()).toBe("none recorded");
  });

  it("does not hide a silent live conversation when there are no ledger rows", async () => {
    answer(200, { slug: "a", lines: [], silentLiveSessions: 1 } satisfies ArticleCost);
    await mount();
    expect(host.textContent).toContain("No model calls are recorded against this article.");
    expect(host.textContent).toContain("1 live conversation connected and never reported usage");
    expect(summary()).toBe("none priced · 1 live conversation unreported");
  });

  it("does not show one article's total under another's slug", async () => {
    answer(200, {
      slug: "a",
      lines: [line({ creditsNanos: 10_000_000, calls: 3 })],
      silentLiveSessions: 0,
    } satisfies ArticleCost);
    await mount("first-spya-aaaaaa");
    expect(summary()).toBe("$0.0100 · 3 calls");
    /* Every render, not the DOM after `act`: the effect resets the state
       before `act` returns, so the frame that showed the first article's
       figure under the second's slug is only visible from inside. */
    fetchSpy.mockReturnValue(new Promise(() => {}));
    rendered.length = 0;
    await act(async () => {
      root.render(<Harness slug="second-spya-bbbbbb" />);
    });
    const second = rendered.filter((r) => r.slug === "second-spya-bbbbbb");
    expect(second.length).toBeGreaterThan(0);
    expect(second.map((r) => r.summary)).not.toContain("$0.0100 · 3 calls");
    expect(summary()).toBe("…");
  });

  it("shows a refusal as an error rather than as a zero", async () => {
    answer(403, { error: "Forbidden" });
    await mount();
    expect(host.querySelector("[role=alert]")?.textContent).toContain(
      "Could not read what this article cost",
    );
    expect(host.textContent).not.toContain("$0");
    /* No figure on the heading either: the section refuses to shut over a
       failure (Metadata.tsx § CostSection), so the alert is what shows. */
    expect(summary()).toBe("(none)");
  });
});

describe("lineName", () => {
  it("uses current names for historical ledger rows without changing their facts", () => {
    const historical = line({ job: "hierarchy", stepName: "hierarchy" });
    expect(lineName(historical)).toBe("structure");
    expect(lineName(line({ job: "labels", stepName: "hierarchy" }))).toBe("structure · labels");
    expect(lineName(line({ job: "structure", stepName: "hierarchy" }))).toBe("structure");
    expect(lineName(line({ job: "trajectory", stepName: "trajectory" }))).toBe("skim");
    expect(historical.job).toBe("hierarchy");
    expect(historical.stepName).toBe("hierarchy");
  });

  it("names step work by its step and request work by its job", () => {
    expect(lineName(line({}))).toBe("structure");
    expect(lineName(line({ job: "referee_claims", stepName: null }))).toBe("referee claims");
    expect(lineName(line({ job: "labels" }))).toBe("structure · labels");
  });
});

describe("where the section is mounted", () => {
  it("draws the section only behind the client-side admin courtesy check", () => {
    /* The server gate is the protection and has its route test. This source
       contract holds the separate UI promise: a non-admin never sees an empty
       or refused What-it-cost section. Mounting all of Metadata here would
       replace this one assertion with every fetch and store on that page. */
    const source = readFileSync("src/web/Metadata.tsx", "utf8");
    expect(source).toMatch(/\{isAdmin\(user\?\.id\) && <CostSection slug=\{slug\} \/>\}/);
    /* The guarded occurrence is the only mount; otherwise the assertion above
       could stay green while a second, unguarded section rendered and read. */
    expect(source.match(/<CostSection\b/g)).toHaveLength(1);
    /* …and the read lives inside that component, so it is behind the check too. */
    expect(source).toMatch(
      /function CostSection\(\{ slug \}: \{ slug: string \}\) \{\s*const load = useArticleCost\(slug\);/,
    );
    expect(source.match(/useArticleCost\(/g)).toHaveLength(1);
  });

  it("is shut by default with the total on its heading, and open over a failure", () => {
    /* Greg, 2026-10-01 (SPIDERYARN-READING2-7G). The summary line itself is
       tested above through the hook; this pins that it is the shut heading's. */
    const source = readFileSync("src/web/Metadata.tsx", "utf8");
    expect(source).toMatch(
      /* Props one per line since plan 261001s added `keywords` for the search
         box; what this pins is still `collapsible={!failed}` and the aside. */
      /const failed = load\.kind === "failed";\s*return \(\s*<Section\s+label="What it cost"\s+keywords="[^"]*"\s+collapsible=\{!failed\}\s+aside=\{articleCostSummary\(load\)\}\s*>\s*<ArticleCostBody load=\{load\} \/>/,
    );
  });
});
