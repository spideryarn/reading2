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
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
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

const { AdminArticlesPage, matchesFilter } = await import("../src/web/AdminArticlesPage.js");
const { READER_STATE } = await import("../src/admin-articles.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

beforeEach(() => {
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
    return json(200, { articles: ARTICLES, emailsAvailable: true });
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

async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<AdminArticlesPage />));
  await settle();
}

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

  it("filters by owner address or id", () => {
    const [theirs, mine] = ARTICLES as unknown as Parameters<typeof matchesFilter>[0][];
    expect(matchesFilter(theirs!, "ALICE@")).toBe(true);
    expect(matchesFilter(theirs!, "k3m9")).toBe(true);
    expect(matchesFilter(mine!, "000005")).toBe(true);
    expect(matchesFilter(theirs!, "000005")).toBe(false);
    expect(matchesFilter(mine!, "alice")).toBe(false);
    expect(matchesFilter(mine!, "  ")).toBe(true);
  });

  it("keeps the exact creation time readable without hovering a date cell", async () => {
    await mount();
    const cell = rowFor("alice@example.test")?.querySelector("td[data-tip]");
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
