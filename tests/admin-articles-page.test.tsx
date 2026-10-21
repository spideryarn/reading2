// @vitest-environment jsdom
/**
 * `/admin/articles`, actually rendered — src/web/AdminArticlesPage.tsx, plan
 * 261011n § D4, Tests 4.
 *
 * Only the Supabase SDK and `fetch` are stubbed, as in
 * tests/admin-vouchers-page.test.tsx. What is pinned: one row per article,
 * another reader's private one drawn without a title; the filter by address or
 * id; *Transfer…* opens a confirmation that shows what will be deleted and that
 * it will be made private, **reads the preview again before it sends**, sends
 * exactly `{ to, expectedFrom }`, and re-reads the list; a preview that changed
 * in between sends nothing; and a refusal reaches the page in the server's
 * words.
 *
 * And, since the table moved onto `DataTable` (plan 261021i § Stage 1): a
 * header click sorts and writes `?by=`; a column hidden from the Columns menu
 * stays hidden across a remount; untitled rows and unpriced costs sink under
 * either arrow; equal costs read newest first.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { ADMIN_ARTICLES_COLUMN_KEYS, AdminArticlesPage, matchesFilter, NOT_PUBLISHED_YET } = await import(
  "../src/web/AdminArticlesPage.js"
);
const { READER_STATE } = await import("../src/admin-articles.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* The sort is in the address bar through nuqs, as in the app (main.tsx), and
   without history sync nuqs would not see the URL a click writes —
   tests/admin-page.test.tsx says the same. */
enableHistorySync();

const ALICE = "a1a1a1a1-0b11-4c5e-8a01-261011000001";
const BOB = "a1a1a1a1-0b11-4c5e-8a01-261011000002";
const UNCONFIRMED = "a1a1a1a1-0b11-4c5e-8a01-261011000003";
const THEIRS = "a1a1a1a1-0b11-4c5e-8a01-261011000004";
const MINE = "a1a1a1a1-0b11-4c5e-8a01-261011000005";

const ARTICLES = [
  {
    id: THEIRS,
    shortId: "spya-k3m9qt",
    ownerId: ALICE,
    ownerEmail: "alice@example.test",
    mine: false,
    createdAt: "2026-10-10T10:00:00Z",
    visibility: "private",
    processing: "full",
    title: null,
    slug: null,
    published: null,
    /* $0.42, one call of three unpriced: a floor. */
    cost: { nanos: 420_000_000, calls: 3, unpricedCalls: 1 },
  },
  {
    id: MINE,
    shortId: null,
    ownerId: "admin",
    ownerEmail: "admin@example.test",
    mine: true,
    createdAt: "2026-10-09T10:00:00Z",
    visibility: "public",
    processing: "full",
    title: "The Bitter Lesson",
    slug: "the-bitter-lesson",
    published: true,
    /* Nothing spent on it. */
    cost: { nanos: 0, calls: 0, unpricedCalls: 0 },
  },
];

const zero = () => Object.fromEntries(READER_STATE.map((k) => [k.table, 0]));
const previewOf = (over: Record<string, unknown> = {}) => ({
  articleId: THEIRS,
  ownerId: ALICE,
  visibility: "private",
  privateLink: true,
  counts: { ...zero(), comments: 2, chat_threads: 1, reading_time: 4 },
  blocked: null,
  ...over,
});

type Call = { method: string; url: string; body: unknown };
let calls: Call[];
/** Each GET of the preview takes the next of these; the last repeats. */
let previews: Record<string, unknown>[];
let postAnswer: { status: number; body: unknown };
/** What `GET /api/admin/articles` answers. */
let listed: readonly unknown[] = ARTICLES;

/** A real round-trip store: Node's own `localStorage` shadows jsdom's here (admin-page.test.tsx). */
let stored: Map<string, string>;

beforeEach(() => {
  stored = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
      clear: () => stored.clear(),
      key: () => null,
      length: 0,
    },
  });
  /* A `?by=` left by the previous test would change what this one sees. */
  history.replaceState(null, "", "/admin/articles");
  calls = [];
  previews = [previewOf()];
  postAnswer = {
    status: 200,
    body: { articleId: THEIRS, from: ALICE, to: BOB, deleted: { ...zero(), comments: 2 }, madePrivate: true },
  };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const json = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (url === "/api/admin/users") {
      return json(200, {
        users: [
          { id: ALICE, email: "alice@example.test", emailConfirmedAt: "2026-01-01T00:00:00Z" },
          { id: BOB, email: "bob@example.test", emailConfirmedAt: "2026-01-01T00:00:00Z" },
          { id: UNCONFIRMED, email: "carol@example.test" },
        ],
      });
    }
    if (url.endsWith("/transfer") && method === "GET") {
      const next = previews.length > 1 ? previews.shift() : previews[0];
      return json(200, next);
    }
    if (url.endsWith("/transfer") && method === "POST") return json(postAnswer.status, postAnswer.body);
    return json(200, { articles: listed, emailsAvailable: true });
  }) as typeof fetch;
});

let host: HTMLDivElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
  }
}

async function mount(articles: readonly unknown[] = ARTICLES) {
  listed = articles;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <NuqsAdapter>
        <AdminArticlesPage />
      </NuqsAdapter>,
    ),
  );
  await settle();
}

/** Unmount and mount again on the same address and store — a reload, as far as the page can tell. */
async function remount() {
  act(() => root.unmount());
  host.remove();
  await mount(listed);
}

/** The sort button in the header whose visible words are `name`. */
const headerButton = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("thead button")].find((b) =>
    b.getAttribute("aria-label")?.startsWith(name),
  );
const headers = () => [...host.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
/** Each row by its handle — the `<code>` in the Article cell. */
const order = () => [...host.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("code")?.textContent);

/** An article with a cost and an age, the rest from the first fixture. */
const article = (n: string, createdAt: string, cost: { nanos: number; calls: number; unpricedCalls: number }, over = {}) => ({
  ...ARTICLES[0]!,
  id: `a1a1a1a1-0b11-4c5e-8a01-2610110000${n}`,
  shortId: `spya-${n}aaaa`,
  createdAt,
  cost,
  ...over,
});
const priced = (nanos: number) => ({ nanos, calls: 1, unpricedCalls: 0 });

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const rowFor = (text: string) =>
  [...host.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(text)) as HTMLTableRowElement | undefined;
const buttonIn = (el: Element | null | undefined, label: string) =>
  [...(el?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const confirmation = () => host.querySelector('section[aria-label="Transfer this article"]');

async function click(el: HTMLElement | undefined) {
  if (!el) throw new Error("nothing to click");
  await act(async () => el.click());
  await settle();
}

async function choose(value: string) {
  const select = confirmation()?.querySelector("select");
  if (!select) throw new Error("no select");
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    set?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

async function openFor(text: string) {
  await click(buttonIn(rowFor(text), "Transfer…"));
}

describe("/admin/articles", () => {
  it("draws one row per article, another reader's private one without a title", async () => {
    await mount();
    expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(rowFor("alice@example.test")?.textContent).toContain("Another reader's private article");
    expect(rowFor("alice@example.test")?.textContent).toContain("spya-k3m9qt");
    /* No short id: the article id stands in (Sol F9). */
    expect(rowFor("The Bitter Lesson")?.textContent).toContain(MINE);
    expect(rowFor("The Bitter Lesson")?.textContent).toContain("(you)");
  });

  /* spya-zt7u0h: an import that never published was a row called *Untitled*,
     a link to a page that said *Not shared*. */
  it("names an article of yours whose import never published as that, not Untitled", async () => {
    const unpublished = {
      ...ARTICLES[1]!,
      id: "a1a1a1a1-0b11-4c5e-8a01-261011000006",
      shortId: "spya-drhjjm",
      visibility: "private",
      title: null,
      slug: "a-failed-import-spya-drhjjm",
      published: false,
    };
    await mount([...ARTICLES, unpublished]);
    const row = rowFor("spya-drhjjm");
    expect(row?.textContent).not.toContain("Untitled");
    expect(row?.textContent).toContain(NOT_PUBLISHED_YET);
  });

  /* spya-vjyev3: "Also show Total Cost per article". */
  it("shows each article's total cost, a floor marked + and nothing spent as a dash", async () => {
    await mount();
    const head = [...host.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
    const at = head.indexOf("Total cost");
    expect(at).toBeGreaterThan(0);
    const cell = (text: string) => rowFor(text)?.querySelectorAll("td")[at]?.querySelector('[aria-hidden="true"]')?.textContent?.trim();
    expect(cell("alice@example.test")).toBe("$0.42+");
    expect(cell("The Bitter Lesson")).toBe("—");
    /* The hint the hand-drawn header carried is on the sort button now. */
    expect(headerButton("Total cost")?.getAttribute("aria-label")).toContain("a floor");
    expect(headerButton("Total cost")?.getAttribute("data-tip")).toContain("a floor");
  });

  it("draws an article whose every call was unpriced as a dash, not $0", async () => {
    const unpriced = { ...ARTICLES[0]!, id: "a1a1a1a1-0b11-4c5e-8a01-261011000008", shortId: "spya-unprcd",
      cost: { nanos: 0, calls: 2, unpricedCalls: 2 } };
    await mount([unpriced]);
    const at = [...host.querySelectorAll("thead th")].findIndex((th) => th.textContent?.trim() === "Total cost");
    const cell = rowFor("spya-unprcd")?.querySelectorAll("td")[at];
    expect(cell?.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe("—");
    expect(cell?.querySelector(".tw\\:sr-only")?.textContent).toBe("No recorded amount over 2 calls, 2 reported no cost");
    expect(cell?.querySelector("[data-tip]")?.getAttribute("data-tip")).toBe(
      "No recorded amount over 2 calls, 2 reported no cost",
    );
  });

  it("orders by total cost from its header, newest first by default and as the tiebreak, and says so in the address", async () => {
    /* Shuffled on purpose: the default order is the table's, not the server's. */
    const cheap = article("11", "2026-10-12T10:00:00Z", priced(10_000_000));
    const tieNew = article("12", "2026-10-11T10:00:00Z", priced(420_000_000));
    await mount([ARTICLES[1]!, tieNew, cheap, ARTICLES[0]!]);
    expect(order()).toEqual(["spya-11aaaa", "spya-12aaaa", "spya-k3m9qt", MINE]);
    expect(location.search).toBe("");

    await click(headerButton("Total cost"));
    /* $0.42 twice: the newer first. MINE has no calls, so it is a dash and sinks. */
    expect(order()).toEqual(["spya-12aaaa", "spya-k3m9qt", "spya-11aaaa", MINE]);
    expect(new URLSearchParams(location.search).get("by")).toBe("cost");
    /* Highest first is the column's own first end, so `dir` says nothing and is left out. */
    expect(new URLSearchParams(location.search).get("dir")).toBeNull();
    /* Order-neutral: a caption that named one order was false under the other. */
    expect(host.querySelector("caption")?.textContent).toBe("Every article");

    /* The other way: cheapest first, the tie reversing with the arrow (accepted
       in plan 261021i), and the dash still at the foot. */
    await click(headerButton("Total cost"));
    expect(order()).toEqual(["spya-11aaaa", "spya-k3m9qt", "spya-12aaaa", MINE]);
    expect(new URLSearchParams(location.search).get("dir")).toBe("asc");
  });

  it("sorts by another header on a click, and reads the sort back from the address on a reload", async () => {
    const zed = article("13", "2026-10-12T10:00:00Z", priced(1), { ownerEmail: "zed@example.test" });
    await mount([zed, ...ARTICLES]);
    expect(order()[0]).toBe("spya-13aaaa");
    await click(headerButton("Owner"));
    expect(new URLSearchParams(location.search).get("by")).toBe("owner");
    expect(order()).toEqual([MINE, "spya-k3m9qt", "spya-13aaaa"]);
    expect(headerButton("Owner")?.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    await remount();
    expect(order()).toEqual([MINE, "spya-k3m9qt", "spya-13aaaa"]);
  });

  it("keeps Transfer attached to its article after a re-sort moves the row", async () => {
    await mount();
    expect(order()).toEqual(["spya-k3m9qt", MINE]);

    /* Title puts the administrator's titled article first and moves Alice's
       private, untitled row from first to last. The press must follow the
       article rather than the row's old position. */
    await click(headerButton("Article"));
    expect(order()).toEqual([MINE, "spya-k3m9qt"]);
    await openFor("alice@example.test");

    expect(calls.filter((c) => c.method === "GET" && c.url.endsWith("/transfer"))).toEqual([
      { method: "GET", url: `/api/admin/articles/${THEIRS}/transfer`, body: undefined },
    ]);
    expect(confirmation()?.textContent).toContain("belongs to alice@example.test");
  });

  /* Sol F1: the dash is "no call was priced" — no calls, or every call
     unpriced — and sinks; a priced call that recorded $0.00 is a real zero. */
  it("sinks every dash under either arrow, and sorts a priced zero and a floor as amounts", async () => {
    const none = article("21", "2026-10-15T10:00:00Z", { nanos: 0, calls: 0, unpricedCalls: 0 });
    const unpriced = article("22", "2026-10-14T10:00:00Z", { nanos: 0, calls: 2, unpricedCalls: 2 });
    const zero = article("23", "2026-10-13T10:00:00Z", priced(0));
    const floor = article("24", "2026-10-12T10:00:00Z", { nanos: 5_000_000, calls: 3, unpricedCalls: 1 });
    await mount([none, unpriced, zero, floor]);

    await click(headerButton("Total cost"));
    expect(order()).toEqual(["spya-24aaaa", "spya-23aaaa", "spya-21aaaa", "spya-22aaaa"]);
    await click(headerButton("Total cost"));
    /* Lowest first: the priced zero leads, and the two dashes are still last. */
    expect(order()).toEqual(["spya-23aaaa", "spya-24aaaa", "spya-22aaaa", "spya-21aaaa"]);
  });

  it("sinks the rows with no title under a title sort, either way round", async () => {
    const titled = (n: string, title: string) =>
      article(n, "2026-10-12T10:00:00Z", priced(1), { mine: true, title, slug: `s-${n}`, published: true });
    const unpublished = article("33", "2026-10-13T10:00:00Z", priced(1), {
      mine: true, title: null, slug: "failed-33", published: false,
    });
    await mount([titled("31", "Zeta"), ARTICLES[0]!, titled("32", "alpha"), unpublished]);

    await click(headerButton("Article"));
    expect(order().slice(0, 2)).toEqual(["spya-32aaaa", "spya-31aaaa"]);
    expect(order().slice(2).sort()).toEqual(["spya-33aaaa", "spya-k3m9qt"]);
    await click(headerButton("Article"));
    expect(order().slice(0, 2)).toEqual(["spya-31aaaa", "spya-32aaaa"]);
    expect(order().slice(2).sort()).toEqual(["spya-33aaaa", "spya-k3m9qt"]);
  });

  it("hides a column from the Columns menu, never offers Article, and remembers it across a reload", async () => {
    await mount();
    expect(headers()).toContain("Owner");
    const trigger = [...host.querySelectorAll("button")].find((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith("Columns"),
    );
    if (!trigger) throw new Error("no Columns menu");
    const press = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(press, "pointerType", { value: "mouse" });
    act(() => trigger.dispatchEvent(press));
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')];
    const labels = items.map((item) => item.textContent?.trim());
    expect(labels).toEqual(["Owner", "Added", "Visibility", "Read", "Total cost"]);
    const owner = items.find((item) => item.textContent?.trim() === "Owner");
    act(() => owner?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

    expect(headers()).not.toContain("Owner");
    expect(JSON.parse(stored.get(ADMIN_ARTICLES_COLUMN_KEYS.hidden) ?? "null")).toEqual(["owner"]);
    await remount();
    expect(headers()).not.toContain("Owner");
    expect(headers()).toContain("Added");
  });

  it("filters by owner address or id", () => {
    const [theirs, mine] = ARTICLES as unknown as Parameters<typeof matchesFilter>[0][];
    expect(matchesFilter(theirs!, "ALICE@")).toBe(true);
    expect(matchesFilter(theirs!, "k3m9")).toBe(true);
    expect(matchesFilter(mine!, "000005")).toBe(true);
    expect(matchesFilter(theirs!, "000005")).toBe(false);
    expect(matchesFilter(mine!, "alice")).toBe(false);
    expect(matchesFilter(mine!, "  ")).toBe(true);
  });

  it("filters the drawn rows and counts the filtered table", async () => {
    await mount();
    const input = host.querySelector<HTMLInputElement>('[aria-label="Filter by owner address or article id"]');
    if (!input) throw new Error("no article filter");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "alice@");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();

    expect(order()).toEqual(["spya-k3m9qt"]);
    expect(host.textContent).toContain("1 of 2");
  });

  /* Plan 261019o, spya-zzewu7: "keep the first column frozen (article name)". */
  it("pins the Article column while the table scrolls sideways", async () => {
    await mount();
    const pinned = [...host.querySelectorAll("table tr")].map((tr) =>
      [...tr.children].flatMap((cell, i) => (cell.classList.contains("tw:sticky") ? [i] : [])),
    );
    expect(pinned).toEqual([[0], [0], [0]]);
  });

  it("keeps the exact creation time readable without hovering a date cell", async () => {
    await mount();
    /* On the cell's content rather than the `<td>`, which DataTable draws. */
    const cell = rowFor("alice@example.test")?.querySelector("td [data-tip]");
    const exact = new Date("2026-10-10T10:00:00Z").toLocaleString(undefined, {
      dateStyle: "medium", timeStyle: "short",
    });
    expect(cell?.getAttribute("data-tip")).toBe(exact);
    expect(cell?.querySelector(".tw\\:sr-only")?.textContent).toContain(exact);
  });

  it("confirms with the counts and the privacy, reads the preview again, sends {to, expectedFrom}, and re-reads the list", async () => {
    await mount();
    await openFor("alice@example.test");
    const text = confirmation()?.textContent ?? "";
    expect(text).toContain("questions and notes 2, chats 1, passages with reading time 4");
    expect(text).toContain("made private");
    expect(text).toContain("private link is on, and will be turned off");
    expect(text).toContain("personal illustration directions");
    /* The current owner and the unconfirmed account cannot be chosen. */
    const options = [...(confirmation()?.querySelectorAll("option") ?? [])];
    expect(options.find((o) => o.value === ALICE)?.disabled).toBe(true);
    expect(options.find((o) => o.value === UNCONFIRMED)?.disabled).toBe(true);
    expect(buttonIn(confirmation(), "Transfer")?.disabled).toBe(true);
    /* Plan 261020z: left neutral on purpose. */
    expect(buttonIn(confirmation(), "Transfer")?.className).not.toMatch(/tone-/);
    expect(buttonIn(confirmation(), "Cancel")?.className).not.toMatch(/tone-/);

    await choose(BOB);
    const listReadsBefore = calls.filter((c) => c.url === "/api/admin/articles").length;
    const previewReadsBefore = calls.filter((c) => c.method === "GET" && c.url.endsWith("/transfer")).length;
    await click(buttonIn(confirmation(), "Transfer"));

    expect(calls.filter((c) => c.method === "GET" && c.url.endsWith("/transfer")).length).toBe(previewReadsBefore + 1);
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toEqual([
      { method: "POST", url: `/api/admin/articles/${THEIRS}/transfer`, body: { to: BOB, expectedFrom: ALICE } },
    ]);
    expect(calls.filter((c) => c.url === "/api/admin/articles").length).toBe(listReadsBefore + 1);
    expect(confirmation()).toBeNull();
    expect(host.textContent).toContain("Moved to bob@example.test. Deleted: questions and notes 2.");
  });

  it("sends nothing when the preview changed since the confirmation opened, and shows the new one", async () => {
    previews = [previewOf(), previewOf({ counts: { ...zero(), comments: 5 } })];
    await mount();
    await openFor("alice@example.test");
    await choose(BOB);
    await click(buttonIn(confirmation(), "Transfer"));
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    const text = confirmation()?.textContent ?? "";
    expect(text).toContain("changed since you opened it");
    expect(text).toContain("questions and notes 5");
    /* Pressed again on what it now shows, it goes. */
    await click(buttonIn(confirmation(), "Transfer"));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("names a newly observed owner before offering to transfer their article", async () => {
    previews = [previewOf(), previewOf({ ownerId: BOB })];
    await mount();
    await openFor("alice@example.test");
    await choose(BOB);
    await click(buttonIn(confirmation(), "Transfer"));

    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    expect(confirmation()?.textContent).toContain("belongs to bob@example.test");
    expect(buttonIn(confirmation(), "Transfer")?.disabled).toBe(true);

    await choose(ALICE);
    await click(buttonIn(confirmation(), "Transfer"));
    expect(calls.filter((c) => c.method === "POST")).toEqual([
      { method: "POST", url: `/api/admin/articles/${THEIRS}/transfer`, body: { to: ALICE, expectedFrom: BOB } },
    ]);
  });

  it("shows a refusal in the server's words", async () => {
    postAnswer = {
      status: 409,
      body: { error: "That article's owner has changed since you opened it, so nothing was moved. Reload and check." },
    };
    await mount();
    await openFor("alice@example.test");
    await choose(BOB);
    await click(buttonIn(confirmation(), "Transfer"));
    expect(confirmation()?.querySelector('[role="alert"]')?.textContent).toContain("owner has changed since you opened it");
  });

  it("will not offer the press on an article the preview says is busy", async () => {
    previews = [previewOf({ blocked: "busy" })];
    await mount();
    await openFor("alice@example.test");
    await choose(BOB);
    expect(confirmation()?.textContent).toContain("An import or a job is running");
    expect(buttonIn(confirmation(), "Transfer")?.disabled).toBe(true);
  });
});
