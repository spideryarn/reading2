// @vitest-environment jsdom
/**
 * `/admin/costs`, actually rendered — [src/web/AdminCostsPage.tsx](../src/web/AdminCostsPage.tsx).
 * docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md.
 *
 * The real page against a stubbed `fetch` of a small cube, in the shape of
 * tests/admin-page.test.tsx: only the Supabase SDK and the network are fakes.
 * The arithmetic is src/cost-cube.ts's and is pinned in tests/cost-cube.test.ts;
 * what is held here is that the page shows it, filters it, folds it without
 * losing money, and never puts an email or a slug in the address bar.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
/* `apiFetch` reaches for IndexedDB, which jsdom lacks — tests/admin-page.test.tsx. */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_EMAIL_LOCAL, ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { type AdminCosts, type CostCubeRow, dimensionValue, parseCostWindow } from "../src/cost-cube.js";

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

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoResizeObserver });

const { AdminCostsPage } = await import("../src/web/AdminCostsPage.js");

enableHistorySync();

/* The 20th of a month, so "This month" is twenty days and none of them moves. */
const NOW = Date.parse("2033-05-20T12:00:00.000Z");

const GREG = ADMIN_USER_ID_LOCAL;
const BEN = "9a6c3d1f-0e27-4b58-8f4a-d2b71c5e6039";
const GREG_ARTICLE = "5b0f7e2a-9d14-4c83-a6e5-1f3c8d2b7a09";
const BEN_ARTICLE = "e48d1b06-52c7-4a39-b1f0-6a7d93c20e58";
const GREG_SLUG = "own-piece-about-reading";
const BEN_EMAIL = "ben@example.test";

const DOLLAR = 1_000_000_000;

function row(over: Partial<CostCubeRow>): CostCubeRow {
  return {
    day: "2033-05-01",
    ownerId: GREG,
    articleId: null,
    articleSlug: null,
    recordedSlugHash: null,
    scopeKind: "job_step",
    job: "structure",
    stepName: "structure",
    wire: "messages",
    requestedModel: "vendor/one",
    answeredModel: "vendor/one",
    upstream: "Vendor",
    providerAccount: "openrouter",
    costSource: "provider",
    isByok: false,
    outcome: "ok",
    category: "default-step work",
    calls: 1,
    creditsNanos: 0,
    byokNanos: 0,
    computedNanos: 0,
    unpricedCalls: 0,
    computedCalls: 0,
    settledCalls: 1,
    ...over,
  };
}

/**
 * Two owners. Greg is the administrator, so his article has a slug; Ben's has
 * only an id, and one of his rows only a hash. Three tasks, two models, three
 * days, one unpriced call, one failed row, one eval row.
 */
const ROWS: CostCubeRow[] = [
  row({ articleId: GREG_ARTICLE, articleSlug: GREG_SLUG, calls: 4, creditsNanos: 4 * DOLLAR }),
  row({
    articleId: GREG_ARTICLE,
    articleSlug: GREG_SLUG,
    scopeKind: "request",
    job: "chat",
    stepName: null,
    category: "interactive request work",
    requestedModel: "vendor/two",
    answeredModel: "vendor/two",
    day: "2033-05-02",
    calls: 2,
    creditsNanos: DOLLAR,
    unpricedCalls: 1,
  }),
  row({
    ownerId: BEN,
    articleId: BEN_ARTICLE,
    job: "glossary",
    stepName: "glossary",
    category: "on-demand enrichment",
    day: "2033-05-02",
    calls: 3,
    creditsNanos: 2 * DOLLAR,
    byokNanos: DOLLAR / 2,
    computedNanos: DOLLAR / 2,
    computedCalls: 1,
  }),
  row({
    ownerId: BEN,
    recordedSlugHash: "0a1b2c3d4e",
    outcome: "error",
    day: "2033-05-03",
    calls: 1,
    creditsNanos: DOLLAR / 4,
  }),
  row({
    scopeKind: "eval",
    requestedModel: "vendor/two",
    answeredModel: "vendor/two",
    day: "2033-05-03",
    calls: 10,
    creditsNanos: 9 * DOLLAR,
  }),
];

function cube(rows: CostCubeRow[]): AdminCosts {
  return {
    since: "2033-05-01T00:00:00.000Z",
    until: "2033-06-01T00:00:00.000Z",
    label: "from 2033-05-01T00:00:00.000Z to before 2033-06-01T00:00:00.000Z (UTC)",
    rows,
    owners: [
      { id: GREG, email: ADMIN_EMAIL_LOCAL },
      { id: BEN, email: BEN_EMAIL },
    ],
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let host: HTMLDivElement;
let root: Root;
/** Every address the page asked for. */
let asked: string[];
/** Whether a test has said what the server answers; `show` answers with the cube otherwise. */
let answered = false;

function answer(reply: () => Response): void {
  answered = true;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    asked.push(String(typeof input === "string" ? input : input instanceof URL ? input : input.url));
    return reply();
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  /* Only the clock: the page's timers and the waits below stay real. */
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  asked = [];
  answered = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

async function settle(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

async function show(search = "", rows: CostCubeRow[] = ROWS): Promise<void> {
  if (!answered) answer(() => json(cube(rows)));
  history.replaceState(null, "", `/admin/costs${search}`);
  await act(async () => {
    root.render(
      <NuqsAdapter>
        <AdminCostsPage />
      </NuqsAdapter>,
    );
  });
  await settle();
}

/** Wait for something, and fail saying what never happened — tests/admin-page.test.tsx. */
async function waitFor(what: string, ready: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (ready()) return;
    await act(async () => {
      await new Promise((go) => setTimeout(go, 5));
    });
  }
  throw new Error(`never happened: ${what}`);
}

async function click(el: Element | null | undefined, what: string): Promise<void> {
  if (!el) throw new Error(`nothing to click: ${what}`);
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}

/** The ranking table's rows: label, drawn amount, and the button that drills in. */
function ranking() {
  return [...host.querySelectorAll<HTMLTableRowElement>("[data-ranking] tbody tr")].map((tr) => ({
    label: tr.querySelector("[data-drill]")?.textContent ?? "",
    text: tr.textContent ?? "",
    amount: tr.querySelector("[data-amount]")?.textContent ?? "",
    drill: tr.querySelector<HTMLElement>("[data-drill]"),
  }));
}

const figure = (name: string) => host.querySelector(`[data-figure="${name}"]`);
const figureNanos = (name: string) => Number(figure(name)?.getAttribute("data-nanos"));

describe("the default view", () => {
  it("asks for this UTC month, in instants the route accepts", async () => {
    await show();
    expect(asked).toHaveLength(1);
    const url = new URL(asked[0] ?? "", "https://spideryarn.test");
    expect(url.pathname).toBe("/api/admin/costs");
    expect(url.searchParams.get("since")).toBe("2033-05-01T00:00:00.000Z");
    expect(url.searchParams.get("until")).toBe("2033-06-01T00:00:00.000Z");
    expect(parseCostWindow(url.searchParams.get("since"), url.searchParams.get("until")).ok).toBe(true);
    expect(host.textContent).toContain("UTC");
  });

  it("ranks users by recorded amount, and counts its rows off the table", async () => {
    await show();
    const rows = ranking();
    expect(rows.map((r) => r.label)).toEqual([ADMIN_EMAIL_LOCAL, BEN_EMAIL]);
    /* The + is the floor marker: one of his calls reported no cost. */
    expect(rows.map((r) => r.amount)).toEqual(["$5.00+", "$3.25"]);
    expect(host.querySelector("[data-row-count]")?.textContent).toBe("2 rows");
  });

  it("says what the money is and is not in the headline", async () => {
    await show();
    expect(figureNanos("recorded")).toBe(8.25 * DOLLAR);
    expect(figure("recorded")?.textContent).toContain("$8.25");
    expect(figure("calls")?.textContent).toContain("10");
    expect(figure("priced")?.textContent).toContain("9");
    expect(figure("unpriced")?.textContent).toContain("1");
    expect(figure("failed")?.textContent).toContain("1");
    expect(figure("failed")?.textContent).toContain("$0.25");
    /* The fee is on the credits pocket only: 7.25 × 1.055 + 0.5 + 0.5. */
    expect(figureNanos("cash")).toBe(Math.round(7.25 * DOLLAR * 1.055) + DOLLAR);
    expect(host.textContent).toContain("floor");
  });

  it("leaves eval and CLI rows out until the switch is on", async () => {
    await show();
    expect(ranking()[0]?.amount).toBe("$5.00+");
    await click(host.querySelector("input[data-include-evals]"), "the evals switch");
    expect(ranking()[0]?.amount).toBe("$14.00+");
    expect(figureNanos("recorded")).toBe(17.25 * DOLLAR);
    expect(location.search).toContain("evals=1");
  });
});

describe("drilling down", () => {
  it("filters to the user and regroups by article, with another owner's article opaque", async () => {
    await show();
    await click(ranking().find((r) => r.label === BEN_EMAIL)?.drill, "Ben's row");
    const rows = ranking();
    /* The cube's own name for a hash-only row; pinned in tests/cost-cube.test.ts. */
    const hashOnly = ROWS.find((r) => r.recordedSlugHash !== null);
    if (!hashOnly) throw new Error("the fixture has no hash-only row");
    const recordedLabel = dimensionValue(hashOnly, "article").label;
    expect(recordedLabel).toContain("recorded");
    expect(recordedLabel).not.toContain(BEN_EMAIL);
    expect(rows.map((r) => r.label)).toEqual([`article ${BEN_ARTICLE.slice(0, 8)}`, recordedLabel]);
    expect(rows.map((r) => r.amount)).toEqual(["$3.00", "$0.25"]);
    /* Identifiable by its owner, beside it. */
    expect(rows[0]?.text).toContain(BEN_EMAIL);
    expect(host.querySelector('[data-filter="user"]')?.textContent).toContain(BEN_EMAIL);
    expect(figureNanos("recorded")).toBe(3.25 * DOLLAR);
    /* No link to somebody else's article. */
    expect(host.querySelector("[data-ranking] a")).toBeNull();
  });

  it("keeps emails and slugs out of the address bar", async () => {
    await show();
    await click(ranking().find((r) => r.label === ADMIN_EMAIL_LOCAL)?.drill, "the administrator's row");
    expect(ranking().map((r) => r.label)).toEqual([GREG_SLUG]);
    await click(ranking()[0]?.drill, "the administrator's article");
    expect(ranking().map((r) => r.label).sort()).toEqual(["chat", "structure"]);
    /* nuqs writes the address a beat after the state. */
    await waitFor("the article filter in the address", () => location.search.includes("article="));
    const address = decodeURIComponent(location.href);
    expect(address).toContain(`user=${GREG}`);
    expect(address).toContain(GREG_ARTICLE);
    expect(address).not.toContain("@");
    expect(address).not.toContain(GREG_SLUG);
    expect(address).not.toContain("own-piece");
  });

  it("removes a filter from its chip", async () => {
    await show(`?by=article&user=${BEN}`);
    expect(ranking()).toHaveLength(2);
    await click(host.querySelector('[data-filter="user"] button'), "the chip's remove button");
    expect(ranking()).toHaveLength(3);
    expect(location.search).not.toContain("user=");
  });
});

/** The pivot as numbers, read off the attributes the cells carry. */
function pivot() {
  const table = host.querySelector("table[data-pivot]");
  const columns = [...(table?.querySelectorAll("thead th[data-col]") ?? [])].map((th) => ({
    key: th.getAttribute("data-col") ?? "",
    label: th.textContent ?? "",
  }));
  const rows = [...(table?.querySelectorAll("tbody tr") ?? [])].map((tr) => ({
    cells: [...tr.querySelectorAll("td[data-cell]")].map((td) => Number(td.getAttribute("data-nanos"))),
    total: Number(tr.querySelector("[data-row-total]")?.getAttribute("data-nanos")),
  }));
  const columnTotals = [...(table?.querySelectorAll("tfoot [data-col-total]") ?? [])].map((td) =>
    Number(td.getAttribute("data-nanos")),
  );
  const grand = Number(table?.querySelector("[data-grand-total]")?.getAttribute("data-nanos"));
  return { columns, rows, columnTotals, grand };
}

const sum = (list: number[]) => list.reduce((n, v) => n + v, 0);

describe("the pivot", () => {
  it("has cells that sum to its row totals, and a grand total that is the headline", async () => {
    await show("?by=user&then=task");
    const p = pivot();
    expect(p.rows).toHaveLength(2);
    expect(p.columns.map((c) => c.label)).toEqual(["structure", "glossary", "chat"]);
    for (const r of p.rows) expect(sum(r.cells)).toBe(r.total);
    expect(sum(p.rows.map((r) => r.total))).toBe(p.grand);
    expect(sum(p.columnTotals)).toBe(p.grand);
    expect(p.grand).toBe(figureNanos("recorded"));
    expect(p.grand).toBe(8.25 * DOLLAR);
  });

  it("folds the columns past the eighth into Other without losing any money", async () => {
    /* Eleven models: $11 down to $1, split across the two owners. */
    const many = Array.from({ length: 11 }, (_, i) =>
      row({
        ownerId: i % 2 === 0 ? GREG : BEN,
        requestedModel: `vendor/m${String(i).padStart(2, "0")}`,
        answeredModel: `vendor/m${String(i).padStart(2, "0")}`,
        creditsNanos: (11 - i) * DOLLAR,
      }),
    );
    await show("?by=user&then=model", many);
    const p = pivot();
    expect(p.columns).toHaveLength(9);
    expect(p.columns.at(-1)?.label).toBe("Other");
    /* The three smallest: $3 + $2 + $1. */
    expect(p.columnTotals.at(-1)).toBe(6 * DOLLAR);
    for (const r of p.rows) expect(sum(r.cells)).toBe(r.total);
    expect(sum(p.columnTotals)).toBe(p.grand);
    expect(p.grand).toBe(66 * DOLLAR);
    expect(p.grand).toBe(figureNanos("recorded"));
  });
});

describe("over time", () => {
  it("draws a bar group for every UTC day of the window so far, and the figures as a table", async () => {
    await show("?by=day");
    const days = [...host.querySelectorAll("svg g[data-day]")].map((g) => g.getAttribute("data-day"));
    expect(days).toHaveLength(20);
    expect(days[0]).toBe("2033-05-01");
    expect(days.at(-1)).toBe("2033-05-20");
    /* Stacked by category unless told otherwise. */
    expect(host.querySelectorAll("[data-chart-legend] [data-series]")).toHaveLength(3);
    expect(pivot().grand).toBe(figureNanos("recorded"));
  });
});

describe("the states that are not a table", () => {
  it("shows the server's own sentence when the request is refused", async () => {
    answer(() => json({ error: "That window has more than 20000 groups of calls. Ask for a shorter period." }, 400));
    await show();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "That window has more than 20000 groups of calls. Ask for a shorter period.",
    );
    expect(host.querySelector("table")).toBeNull();
  });

  it("says so when the period has no calls", async () => {
    await show("", []);
    expect(host.textContent).toContain("No calls recorded in this period");
    expect(host.querySelector("table")).toBeNull();
  });
});
