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
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    failurePhase: null,
    failureClass: null,
    failureStatus: null,
    category: "default-step work",
    calls: 1,
    creditsNanos: 0,
    byokNanos: 0,
    computedNanos: 0,
    unpricedCalls: 0,
    computedCalls: 0,
    settledCalls: 1,
    counted: 0,
    retries: 0,
    gaveUp: 0,
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
    emailsAvailable: true,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let host: HTMLDivElement;
let root: Root;
let storageWrites: [string, string][];
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
  storageWrites = [];
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: (key: string, value: string) => storageWrites.push([key, value]),
      removeItem() {},
      clear() {},
      key: () => null,
      length: 0,
    },
  });
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

async function change(el: Element | null | undefined, value: string, what: string): Promise<void> {
  if (!el) throw new Error(`nothing to change: ${what}`);
  await act(async () => {
    const select = el as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
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
    expect(figure("cash")?.textContent).toMatch(/\+$/);
    expect(host.textContent).toContain("floor");
    expect(host.textContent).toContain("Settled, computed and unpriced overlap");
    expect(host.textContent).toContain("do not add up to the calls");
  });

  it("shows the known amount per priced call, never the amount per all calls", async () => {
    await show();
    const greg = [...host.querySelectorAll("[data-ranking] tbody tr")].find((tr) =>
      tr.textContent?.includes(ADMIN_EMAIL_LOCAL),
    );
    /* By its header, not its position: the bar column moved it once already. */
    const at = [...host.querySelectorAll("[data-ranking] thead th")].findIndex((th) =>
      (th.textContent ?? "").includes("Per priced call"),
    );
    expect(at).toBeGreaterThan(0);
    expect(greg?.querySelectorAll("td")[at]?.textContent).toBe("$1.00");
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
    expect(document.title).toBe("Costs · Admin · Spideryarn");
    const stored = storageWrites.flat().join("\n");
    expect(stored).not.toContain("@");
    expect(stored).not.toContain(GREG_SLUG);
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

  it("marks every priced aggregate containing an unpriced call as a floor", async () => {
    await show("?by=user&then=task");
    const table = host.querySelector("table[data-pivot]");
    const gregRow = [...(table?.querySelectorAll("tbody tr") ?? [])].find((tr) =>
      tr.textContent?.includes(ADMIN_EMAIL_LOCAL),
    );
    expect(gregRow?.textContent).toContain("$1.00+");
    expect(gregRow?.querySelector("[data-row-total]")?.textContent).toBe("$5.00+");
    expect(table?.querySelector("[data-grand-total]")?.textContent).toBe("$8.25+");
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

  it("keeps the All-period axis fixed when a filter removes its first day", async () => {
    answer(() =>
      json({ ...cube(ROWS), since: null, until: null, label: "all recorded calls" }),
    );
    await show(`?period=all&by=day&user=${BEN}`);
    const days = [...host.querySelectorAll("svg g[data-day]")].map((g) => g.getAttribute("data-day"));
    expect(days).toEqual(["2033-05-01", "2033-05-02", "2033-05-03"]);
    expect(host.querySelector('svg g[data-day="2033-05-01"] [data-series]')).toBeNull();
  });
});

describe("URL state", () => {
  it("writes ranking sort and direction into the address", async () => {
    await show();
    const calls = host.querySelector('th[data-column-id="calls"] button');
    await click(calls, "the Calls header");
    await waitFor("Calls sort in the address", () => location.search.includes("sort=calls"));
    expect(location.search).not.toContain("dir=");
    await click(calls, "the Calls header again");
    await waitFor("ascending direction in the address", () => location.search.includes("dir=asc"));
  });

  it("makes each question a copyable link that preserves the rest of the view state", async () => {
    await show(`?period=30d&by=user&then=task&sort=calls&dir=asc&user=${BEN}`);
    const link = [...host.querySelectorAll<HTMLAnchorElement>("a")].find(
      (anchor) => anchor.textContent === "By model",
    );
    expect(link).toBeDefined();
    const href = new URL(link?.href ?? "", "https://spideryarn.test");
    expect(href.pathname).toBe("/admin/costs");
    expect(href.searchParams.get("period")).toBe("30d");
    expect(href.searchParams.get("user")).toBe(BEN);
    expect(href.searchParams.get("sort")).toBe("calls");
    expect(href.searchParams.get("dir")).toBe("asc");
    expect(href.searchParams.get("by")).toBe("model");
    expect(href.searchParams.has("then")).toBe(false);
  });

  it("restores period and scope through Back and Forward", async () => {
    await show();
    const period = (label: string) =>
      [...host.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Period"] button')].find(
        (button) => button.textContent === label,
      );
    await click(period("Last month"), "Last month");
    await waitFor("period in the address", () => location.search.includes("period=last-month"));
    await click(host.querySelector("input[data-include-evals]"), "the evals switch");
    await waitFor("scope in the address", () => location.search.includes("evals=1"));

    history.back();
    await waitFor("Back restores product scope", () => !location.search.includes("evals=1"));
    expect((host.querySelector("input[data-include-evals]") as HTMLInputElement | null)?.checked).toBe(false);
    expect(location.search).toContain("period=last-month");

    history.forward();
    await waitFor("Forward restores the expanded scope", () => location.search.includes("evals=1"));
    expect((host.querySelector("input[data-include-evals]") as HTMLInputElement | null)?.checked).toBe(true);
  });

  it("drops an old period's response when it arrives after the new one", async () => {
    answered = true;
    const pending = new Map<string, (response: Response) => void>();
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      asked.push(url);
      return new Promise<Response>((resolve) => pending.set(url, resolve));
    });
    await show();
    const first = asked[0];
    if (!first) throw new Error("the page made no first request");

    const lastMonth = [...host.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Period"] button')].find(
      (button) => button.textContent === "Last month",
    );
    await click(lastMonth, "Last month");
    await waitFor("the second request", () => asked.length === 2);
    const second = asked[1];
    if (!second) throw new Error("the page made no second request");

    await act(async () => {
      pending.get(second)?.(
        json({
          ...cube([row({ creditsNanos: 2 * DOLLAR })]),
          since: "2033-04-01T00:00:00.000Z",
          until: "2033-05-01T00:00:00.000Z",
          label: "from 2033-04-01T00:00:00.000Z to before 2033-05-01T00:00:00.000Z (UTC)",
        }),
      );
    });
    await waitFor("the newer response", () => figureNanos("recorded") === 2 * DOLLAR);

    await act(async () => pending.get(first)?.(json(cube([row({ creditsNanos: 99 * DOLLAR })]))));
    await settle();
    expect(figureNanos("recorded")).toBe(2 * DOLLAR);
    expect(host.textContent).toContain("2033-04-01");
  });

  it("does not revive an invalid same-dimension then-by after group-by changes", async () => {
    await show("?by=user&then=user");
    expect(host.querySelector("table[data-pivot]")).toBeNull();
    await change(host.querySelector("label select"), "article", "group by");
    expect(host.querySelector("table[data-pivot]")).toBeNull();
    expect(location.search).not.toContain("then=");
  });

  it("keeps an absent filter visible and removable instead of silently dropping it", async () => {
    await show(`?user=${BEN}`, ROWS.filter((item) => item.ownerId === GREG));
    expect(host.querySelector('[data-filter="user"]')?.textContent).toContain(BEN.slice(0, 8));
    expect(host.textContent).toContain("No calls match");
    await click(host.querySelector('[data-filter="user"] button'), "the stale filter's remove button");
    expect(ranking()).toHaveLength(1);
  });
});

/* jsdom lays nothing out, so these hold the structure a narrow window needs:
   the order of the columns, and the classes that pin and cap them. What it
   looks like at 390px is a browser's to say. */
describe("what a narrow window needs", () => {
  it("puts the pivot's Total straight after the row label, in every row", async () => {
    await show("?by=user&then=task");
    const table = host.querySelector("table[data-pivot]");
    const head = [...(table?.querySelectorAll("thead tr > *") ?? [])].map((c) => c.textContent);
    expect(head).toEqual(["User", "Total", "structure", "glossary", "chat"]);
    for (const tr of table?.querySelectorAll("tbody tr, tfoot tr") ?? []) {
      const cells = [...tr.children];
      expect(cells[0]?.tagName).toBe("TH");
      expect(cells[1]?.matches("[data-row-total], [data-grand-total]"), tr.textContent ?? "").toBe(true);
      expect(cells).toHaveLength(5);
    }
    /* The totals row is still the last one. */
    expect(table?.querySelector("tfoot tr > th")?.textContent).toBe("Total");
  });

  it("pins the pivot's label column, opaque, while the rest scrolls", async () => {
    await show("?by=user&then=task");
    const table = host.querySelector("table[data-pivot]");
    const pinned = [...(table?.querySelectorAll("tr > :first-child") ?? [])];
    expect(pinned).toHaveLength(4);
    for (const cell of pinned) {
      const classes = cell.className.split(/\s+/);
      expect(classes).toContain("tw:sticky");
      expect(classes).toContain("tw:left-0");
      expect(classes).toContain("tw:bg-background");
    }
  });

  it("caps a long pivot column header and keeps its whole name in a title", async () => {
    const long = "vendor/an-eval-label-that-goes-on-and-on-and-on-well-past-any-sensible-column";
    await show("?by=user&then=model", [
      row({ creditsNanos: DOLLAR, requestedModel: long, answeredModel: long }),
      row({ ownerId: BEN, creditsNanos: DOLLAR / 2 }),
    ]);
    const th = [...host.querySelectorAll("table[data-pivot] thead th[data-col]")].find(
      (c) => c.textContent === long,
    );
    expect(th?.getAttribute("title")).toBe(long);
    const inner = th?.querySelector("[data-col-label]");
    expect(inner?.className).toContain("tw:truncate");
    expect(inner?.className).toMatch(/tw:max-w-/);
  });

  it("orders the ranking label, recorded amount, share, bar, then the counts", async () => {
    await show();
    const head = [...host.querySelectorAll("[data-ranking] thead th")].map((th) => (th.textContent ?? "").trim());
    expect(head).toEqual(["User", "Recorded amount", "Share", "", "Calls", "Per priced call", "Unpriced", "Failed"]);
    const first = host.querySelector("[data-ranking] tbody tr");
    const cells = [...(first?.children ?? [])];
    expect(cells[1]?.querySelector("[data-amount]")).not.toBeNull();
    expect(cells[3]?.querySelector("[data-rank-bar]")).not.toBeNull();
    /* The label is capped, not the column that takes the leftover width. */
    const label = cells[0]?.querySelector("[data-label]");
    expect(label?.className).toMatch(/tw:max-w-/);
    expect(cells[0]?.className).not.toContain("tw:min-w-56");
    expect(first?.querySelector("[data-drill]")?.getAttribute("title")).toContain(ADMIN_EMAIL_LOCAL);
  });

  it("still sorts from a header, and says so in the address", async () => {
    await show();
    const calls = [...host.querySelectorAll<HTMLElement>("[data-ranking] thead th button")].find((b) =>
      (b.textContent ?? "").includes("Calls"),
    );
    await click(calls, "the Calls header");
    await waitFor("the sort in the address", () => location.search.includes("sort=calls"));
    expect(ranking().map((r) => r.label)).toEqual([ADMIN_EMAIL_LOCAL, BEN_EMAIL]);
  });
});

describe("when the account listing failed", () => {
  it("shows users by short id and says why, once", async () => {
    answer(() =>
      json({
        ...cube(ROWS),
        owners: [
          { id: GREG, email: null },
          { id: BEN, email: null },
        ],
        emailsAvailable: false,
      }),
    );
    await show();
    expect(ranking().map((r) => r.label)).toEqual([GREG.slice(0, 8), BEN.slice(0, 8)]);
    const said = "Email addresses could not be loaded; users are shown by id.";
    expect(host.textContent).toContain(said);
    expect((host.textContent ?? "").split(said)).toHaveLength(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("says nothing of the kind when they loaded", async () => {
    await show();
    expect(host.textContent).not.toContain("could not be loaded");
  });
});

/** One of the section's tables, as the text of its cells. */
function failureTable(name: string): string[][] {
  return [...host.querySelectorAll(`[data-failures] table[data-failures-table="${name}"] tbody tr`)].map((tr) =>
    [...tr.querySelectorAll("th, td")].map((cell) => cell.textContent ?? ""),
  );
}

describe("failures and retries", () => {
  const refused = { outcome: "error", failurePhase: "before_answer", failureClass: "refused", failureStatus: 503 } as const;
  /* Greg: a counted day with a give-up and a death. Ben: one retry. An eval. And the 1st, which nothing counted. */
  const ATTEMPTS: CostCubeRow[] = [
    row({ day: "2033-05-01", calls: 6 }),
    row({ day: "2033-05-02", calls: 12, counted: 12, retries: 1 }),
    row({ day: "2033-05-02", ...refused, calls: 3, counted: 3, retries: 2, gaveUp: 1 }),
    row({
      day: "2033-05-02",
      scopeKind: "request",
      job: "chat",
      stepName: null,
      outcome: "error",
      failurePhase: "mid_answer",
      failureClass: "unfinished",
      failureStatus: 200,
      calls: 2,
      counted: 2,
    }),
    row({ day: "2033-05-03", ownerId: BEN, job: "glossary", stepName: "glossary", calls: 4, counted: 4, retries: 1 }),
    row({ day: "2033-05-03", scopeKind: "eval", ...refused, failureStatus: 529, calls: 5, counted: 5, retries: 3, gaveUp: 1 }),
  ];
  const section = () => host.querySelector("[data-failures]");

  it("shows zero deaths for an unnumbered PDF failure with a recorded phase", async () => {
    await show("", [row({ job: "pdf", stepName: null, wire: "chat", ...refused })]);
    expect(failureTable("day")).toEqual([["2033-05-01", "0", "not measured", "not measured", "0", "0", "0", "0"]]);
    expect(failureTable("task")).toEqual([["pdf", "0", "not measured", "not measured", "0", "0", "0", "0"]]);
    expect(section()?.textContent).toContain("0 attempts died part-way.");
  });

  /* Seen red, 2026-10-06: a browser check found 41 of 42 task rows saying only
     "not measured". Rows with nothing measured fold into one line; a day keeps
     its row, because a calendar with gaps reads as a calendar with no calls. */
  it("folds the tasks nothing was measured for into one line, and keeps every day", async () => {
    await show("", [
      ...ATTEMPTS,
      row({ day: "2033-05-01", job: "quiz", stepName: null, calls: 2 }),
      row({ day: "2033-05-01", job: "skim", stepName: null, calls: 1 }),
    ]);
    const tasks = failureTable("task");
    expect(tasks.every((cells) => cells.slice(2).some((cell) => cell !== "not measured"))).toBe(true);
    expect(tasks.map((cells) => cells[0])).not.toContain("quiz");
    expect(section()?.querySelector('[data-failures-unmeasured="task"]')?.textContent).toMatch(
      /^\d+ other modes or tasks: not measured\.$/,
    );
    expect(failureTable("day")[0]).toEqual(["2033-05-01", "0", "not measured", "not measured", "not measured", "0", "0", "0"]);
    expect(section()?.querySelector('[data-failures-unmeasured="day"]')).toBeNull();
  });

  it("counts retries, give-ups and part-way deaths per day, beside the attempts that were counted", async () => {
    await show("", ATTEMPTS);
    expect(section()?.querySelector("h2")?.textContent).toBe("Failures and retries");
    expect(failureTable("day")).toEqual([
      ["2033-05-01", "0", "not measured", "not measured", "not measured", "0", "0", "0"],
      ["2033-05-02", "17", "3", "1", "2", "0", "0", "0"],
      ["2033-05-03", "4", "1", "0", "0", "0", "0", "0"],
    ]);
    expect(section()?.querySelector("[data-failures-summary]")?.textContent).toBe(
      "Of 27 attempts, 21 were numbered by our retry loop: 4 retries and 1 call that gave up after the last go. 2 attempts died part-way. " +
        "0 attempts stalled and 0 timed out.",
    );
  });

  it("shows a day nothing counted as not measured, never as zero", async () => {
    await show("", ATTEMPTS);
    const first = host.querySelector('[data-failures-table="day"] tbody tr');
    expect(first?.querySelectorAll("[data-not-measured]")).toHaveLength(3);
    /* The retries, the give-ups and the deaths. Nothing was stopped that day, which is a zero. */
    expect(failureTable("day")[0]?.slice(2, 5)).toEqual(["not measured", "not measured", "not measured"]);
  });

  describe("the calls our own clock stopped", () => {
    const stop = (day: string, failureClass: string | null, failurePhase: string | null, calls = 1) =>
      row({
        day,
        scopeKind: "request",
        job: "chat",
        stepName: null,
        outcome: "aborted",
        failureClass,
        failurePhase,
        calls,
        /* A row that says who stopped it came from a numbered loop; one that does not, did not. */
        counted: failureClass === null ? 0 : calls,
      });
    /* The 1st: stops from before anything said who. The 2nd: two stalls, a deadline and a reader's Stop.
       The 3rd: one stall, and four stops that do not say. The 4th: nothing stopped. */
    const STOPS: CostCubeRow[] = [
      stop("2033-05-01", null, null, 2),
      stop("2033-05-02", "stall", "mid_answer", 2),
      stop("2033-05-02", "stall", "before_answer"),
      stop("2033-05-02", "deadline", "before_answer"),
      stop("2033-05-02", "abort", "mid_answer", 7),
      stop("2033-05-03", "stall", "mid_answer"),
      stop("2033-05-03", null, null, 4),
      row({ day: "2033-05-04", calls: 3, counted: 3 }),
    ];
    const stops = (name: string) => failureTable(name).map((cells) => [cells[0], ...cells.slice(4)]);

    it("heads the columns in plain words", async () => {
      await show("", STOPS);
      const heads = [...host.querySelectorAll('[data-failures-table="day"] thead th')].map((th) => th.textContent);
      expect(heads.slice(4)).toEqual(["Died part-way", "Stalled", "Timed out", "Stops not classified"]);
    });

    it("shows stalls and timeouts beside the deaths, each with how many were part-way, and adds none to the deaths", async () => {
      await show("", STOPS);
      expect(stops("day")).toEqual([
        ["2033-05-01", "not measured", "not measured", "not measured", "2"],
        ["2033-05-02", "0", "3 (2 part-way)", "1 (0 part-way)", "0"],
        ["2033-05-03", "0", "1 (1 part-way)", "0", "4"],
        ["2033-05-04", "0", "0", "0", "0"],
      ]);
      expect(host.querySelector('[data-failures-table="day"] tbody tr')?.querySelectorAll("[data-not-measured]")).toHaveLength(5);
    });

    it("says them in the summary, with the stops that do not say who stopped them", async () => {
      await show("", STOPS);
      expect(section()?.querySelector("[data-failures-summary]")?.textContent).toContain(
        "4 attempts stalled (3 part-way) and 1 timed out (0 part-way). 6 stops not classified.",
      );
    });

    it("says in the summary that they are not measured where no stop says who stopped it", async () => {
      await show("", [stop("2033-05-01", null, null, 2)]);
      expect(section()?.querySelector("[data-failures-summary]")?.textContent).toContain(
        "Stalls and timeouts are not measured: 2 stops do not say who stopped them.",
      );
    });

    it("lists a stall and a deadline among the causes, and never a reader's Stop", async () => {
      await show("", STOPS);
      expect(failureTable("causes").map((c) => [c[0], c[1], c[6]])).toEqual([
        ["part-way through the answer", "stall", "3"],
        ["before the answer began", "deadline", "1"],
        ["before the answer began", "stall", "1"],
      ]);
    });

    it("keeps a task whose only news is a stall and the known count of unclassified stops", async () => {
      await show("", [
        stop("2033-05-02", "stall", "mid_answer"),
        row({ day: "2033-05-02", job: "quiz", stepName: null, outcome: "aborted", calls: 2 }),
      ]);
      expect(stops("task")).toEqual([
        ["chat", "0", "1 (1 part-way)", "0", "0"],
        ["quiz", "not measured", "not measured", "not measured", "2"],
      ]);
      expect(section()?.querySelector('[data-failures-unmeasured="task"]')).toBeNull();
    });

    it.each([
      ["abort", "mid_answer", "0", "0", "0"],
      [null, null, "not measured", "not measured", "2"],
      ["stall", null, "2 (0 part-way)", "0", "0"],
      ["deadline", null, "0", "2 (0 part-way)", "0"],
    ] as const)("shows isolated unnumbered %s stops in the day and task tables", async (failureClass, failurePhase, stalled, timedOut, unsaid) => {
      await show("", [{ ...stop("2033-05-01", failureClass, failurePhase, 2), counted: 0 }]);
      const figures = ["0", "not measured", "not measured", "not measured", stalled, timedOut, unsaid];
      expect(failureTable("day")).toEqual([["2033-05-01", ...figures]]);
      expect(failureTable("task")).toEqual([["chat", ...figures]]);
      expect(failureTable("causes")).toEqual([]);
    });
  });

  it("counts them per mode or task, the most trouble first", async () => {
    await show("", ATTEMPTS);
    expect(failureTable("task")).toEqual([
      ["structure", "15", "3", "1", "0", "0", "0", "0"],
      ["chat", "2", "0", "0", "2", "0", "0", "0"],
      ["glossary", "4", "1", "0", "0", "0", "0", "0"],
    ]);
  });

  it("lists the causes: where, class, status, upstream, model and task", async () => {
    await show("", ATTEMPTS);
    expect(failureTable("causes")).toEqual([
      ["before the answer began", "refused", "503", "Vendor", "vendor/one", "structure", "3"],
      ["part-way through the answer", "unfinished", "200", "Vendor", "vendor/one", "chat", "2"],
    ]);
  });

  it("follows the page's filters and its scope, like every other table", async () => {
    await show(`?user=${BEN}`, ATTEMPTS);
    expect(failureTable("day")).toEqual([["2033-05-03", "4", "1", "0", "0", "0", "0", "0"]]);
    expect(failureTable("causes")).toEqual([]);
    expect(section()?.textContent).toContain("No failed attempt in this view recorded a cause.");
    await click(host.querySelector('[data-filter="user"] button'), "the user filter's remove button");
    await click(host.querySelector("input[data-include-evals]"), "the evals switch");
    expect(failureTable("day").at(-1)).toEqual(["2033-05-03", "9", "4", "1", "0", "0", "0", "0"]);
    expect(failureTable("causes").map((c) => c[2])).toEqual(["529", "503", "200"]);
  });

  it("says what the counts are not: attempts not calls, no stalls, not the PDF reader's or the embeddings' loops", async () => {
    await show("", ATTEMPTS);
    const text = section()?.textContent ?? "";
    expect(text).toContain("These are counts, not rates.");
    expect(text).toContain("one attempt, not one call");
    expect(text).not.toContain("Stalls are not measured.");
    expect(text).toContain("Stalls and timeouts are counted only on stopped attempts that say who stopped them.");
    expect(text).not.toContain("neither does live conversation");
    expect(text).toContain("Live conversation's recorded stops are ordinary stops");
    expect(text).toContain("unfinished response without a terminal usage report has no response row");
    expect(text).toContain("a processing step or a whole pipeline job");
    expect(text).toContain("An attempt stalled when we stopped it because the provider had sent nothing for too long");
    expect(text).toContain("The PDF reader and the embeddings retry in loops of their own");
    /* No rate anywhere in it. */
    expect(text).not.toContain("%");
  });

  it("says not measured, with no table, for a view no attempt was counted in", async () => {
    await show();
    expect(section()?.querySelector("[data-failures-summary]")?.textContent).toBe(
      "Retries, give-ups and part-way deaths are not measured: none of the 10 attempts was numbered by our retry loop. 0 attempts stalled and 0 timed out.",
    );
    expect(section()?.querySelector("table")).toBeNull();
    expect(section()?.textContent).toContain("Stalls and timeouts are counted only on stopped attempts");
  });

  it("is under every view of the explorer: the pivot and the calendar too", async () => {
    await show("?by=user&then=task", ATTEMPTS);
    expect(failureTable("day")).toHaveLength(3);
    expect(pivot().rows.length).toBeGreaterThan(0);
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
