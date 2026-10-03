// @vitest-environment jsdom
/**
 * **Reopening a recently opened article from the shelf uses the request the
 * shelf already made** — src/web/lib/prefetch-article.ts, report spya-j78fff,
 * docs/plans/261003d-preload-recent-shelf-articles.md.
 *
 * The real `apiFetch`, the real slot module and the real `resolveAccess`
 * doorway; mocked only at the edges — the Supabase SDK, the IndexedDB store,
 * the image rehosting and `fetch` itself. The count that matters in every test
 * is **how many times `GET /api/article/<slug>` went out**: one means the
 * reading view took the shelf's answer, two means it asked for itself. A test
 * that only checked the article arrived would pass with the feature deleted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryEntry } from "../src/types.js";

const getSession = vi.fn();
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession,
      refreshSession: vi.fn(),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

const readCache = vi.fn();
vi.mock("../src/web/lib/offline-store.js", () => ({
  readCached: readCache,
  writeCached: vi.fn(async () => {}),
  reserveTicket: vi.fn(async () => null),
  invalidate: vi.fn(async () => {}),
  cachedSlugs: vi.fn(async () => new Set<string>()),
  rememberUser: vi.fn(),
  lastKnownUser: () => "user-1",
  forgetUser: vi.fn(),
}));

vi.mock("../src/web/public-api.js", () => ({
  loadPublicArticle: vi.fn(async () => ({ kind: "not-shared" })),
  publicFetch: vi.fn(),
}));
vi.mock("../src/web/rehost.js", () => ({
  beginArticleLoad: () => {
    throw new Error("the test hands resolveAccess its own load");
  },
  rehostImages: async (article: unknown) => ({ article, images: Promise.resolve(null) }),
}));

const { apiFetch, leavingFetch } = await import("../src/web/lib/api.js");
const { preloadArticles, preloadedSlugs, resetPreloads, LIFE_MS } = await import(
  "../src/web/lib/prefetch-article.js"
);
const { resolveAccess } = await import("../src/web/article/access.js");
const { recentlyOpened, usePreloadRecent } = await import("../src/web/usePreloadRecent.js");

/** Every request `fetch` saw, method first: `GET /api/article/a`. */
let seen: string[];
/** What the next `GET /api/article/<slug>` answers. */
let articleAnswer: (slug: string) => Promise<Response>;
/** The signals the article requests went out with, by slug. */
let signals: Map<string, AbortSignal>;
let clock: number;

const articleBody = (slug: string, title = slug) =>
  JSON.stringify({
    meta: { slug, title },
    blocks: [{ id: "spya-aaaaaa", tag: "p", kind: "paragraph", text: "", words: 0, html: "<p>x</p>", gistable: true }],
    tree: [],
    assets: undefined,
  });
const ok = (slug: string, title?: string) =>
  new Response(articleBody(slug, title), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const articleGets = (slug: string) => seen.filter((s) => s === `GET /api/article/${slug}`).length;
const load = (signal = new AbortController().signal) => ({ signal, mint: () => "", release: () => {} });
const settle = () => new Promise<void>((go) => setTimeout(go, 0));

async function open(slug: string, readerId = "user-1", signal?: AbortSignal) {
  const { access } = await resolveAccess(slug, readerId, load(signal));
  return access;
}

beforeEach(() => {
  seen = [];
  signals = new Map();
  clock = 1_000_000;
  resetPreloads(() => clock);
  articleAnswer = async (slug) => ok(slug);
  readCache.mockReset();
  readCache.mockResolvedValue(undefined);
  getSession.mockReset();
  getSession.mockResolvedValue({
    data: { session: { access_token: "TOKEN-1", user: { id: "user-1" } } },
  });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    /* As the real `fetch` does: an already-aborted signal rejects at once, and
       nothing goes on the wire — so it is not counted as a request. */
    if (init.signal?.aborted) return Promise.reject(new DOMException("", "AbortError"));
    seen.push(`${method} ${url}`);
    const m = /^\/api\/article\/([^/?]+)$/.exec(url);
    if (method === "GET" && m) {
      if (init.signal) signals.set(m[1]!, init.signal);
      return articleAnswer(m[1]!);
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  });
});

describe("a preloaded article is the reading view's one request", () => {
  it("opening a preloaded article sends no request of its own", async () => {
    preloadArticles(["a"]);
    const access = await open("a");
    expect(access.kind).toBe("owned");
    expect(articleGets("a"), "the reading view asked again").toBe(1);
  });

  it("is used once: a second open asks the server", async () => {
    preloadArticles(["a"]);
    /* Released afterwards, as leaving the article does — so a slot left in the
       map would be adoptable again, holding a body already read. */
    const first = new AbortController();
    await open("a", "user-1", first.signal);
    first.abort();
    const again = await open("a");
    expect(articleGets("a")).toBe(2);
    expect(again.kind).toBe("owned");
  });

  it("an article that was not preloaded is fetched as before", async () => {
    preloadArticles(["a"]);
    await open("b");
    expect(articleGets("b")).toBe(1);
  });
});

describe("what makes a preload unusable", () => {
  it("a write after it was fetched", async () => {
    preloadArticles(["a"]);
    await settle();
    await apiFetch("/api/library/a", { method: "PATCH", body: "{}" });
    await open("a");
    expect(articleGets("a")).toBe(2);
  });

  it("a write still in flight when it was fetched", async () => {
    let finish: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      seen.push(`${method} ${url}`);
      if (method !== "GET") return new Promise<Response>((go) => (finish = go));
      return Promise.resolve(ok("a"));
    });
    const writing = apiFetch("/api/library/a/archive", { method: "POST" });
    await settle();
    preloadArticles(["a"]);
    await settle();
    finish(new Response(null, { status: 204 }));
    await writing;
    await open("a");
    expect(articleGets("a")).toBe(2);
  });

  it("a purpose saved on the way out, through leavingFetch", async () => {
    preloadArticles(["a"]);
    await settle();
    /* Held open, so it is the count on *sending* that has to catch it — a page
       being left has no time to wait for the answer. */
    const sent = globalThis.fetch;
    vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) =>
      (init.method ?? "GET") === "PATCH" ? new Promise<Response>(() => {}) : sent(url, init),
    );
    leavingFetch("/api/library/a", { method: "PATCH", body: "{}" });
    await open("a");
    expect(articleGets("a")).toBe(2);
  });

  it("another reader", async () => {
    preloadArticles(["a"]);
    await open("a", "user-2");
    expect(articleGets("a")).toBe(2);
  });

  it("age: older than its life", async () => {
    preloadArticles(["a"]);
    await settle();
    clock += LIFE_MS + 1;
    await open("a");
    expect(articleGets("a")).toBe(2);
  });

  it("a failed answer: the reading view asks for itself and gets the real one", async () => {
    articleAnswer = async () => new Response("boom", { status: 500 });
    preloadArticles(["a"]);
    await settle();
    articleAnswer = async (slug) => ok(slug, "fresh");
    const access = await open("a");
    expect(articleGets("a")).toBe(2);
    expect(access.kind === "owned" && access.article.meta.title).toBe("fresh");
  });

  it("the offline copy apiFetch serves when the network is gone, though it says 200", async () => {
    articleAnswer = () => Promise.reject(new TypeError("Failed to fetch"));
    readCache.mockResolvedValue(JSON.parse(articleBody("a", "old copy")));
    preloadArticles(["a"]);
    await settle();
    readCache.mockResolvedValue(undefined);
    articleAnswer = async (slug) => ok(slug, "fresh");
    const access = await open("a");
    expect(articleGets("a")).toBe(2);
    expect(access.kind === "owned" && access.article.meta.title).toBe("fresh");
  });
});

describe("the writes that leaving an article sends do not discard it", () => {
  it("the open record and the reading-time flush", async () => {
    preloadArticles(["a"]);
    await settle();
    await apiFetch("/api/library/a/open", { method: "POST" });
    leavingFetch("/api/reading-time/a", { method: "POST", body: "{}" });
    await settle();
    await open("a");
    expect(articleGets("a")).toBe(1);
  });
});

describe("the set held follows the shelf", () => {
  it("a new list drops, and aborts, what is no longer on it", async () => {
    preloadArticles(["a", "b"]);
    await settle();
    preloadArticles(["b", "c"]);
    expect(preloadedSlugs().sort()).toEqual(["b", "c"]);
    expect(signals.get("a")?.aborted).toBe(true);
  });

  it("the same list moments later is not asked for again; later, it is refreshed", async () => {
    preloadArticles(["a"]);
    preloadArticles(["a"]);
    await settle();
    expect(articleGets("a")).toBe(1);
    clock += 20_000;
    preloadArticles(["a"]);
    await settle();
    expect(articleGets("a")).toBe(2);
  });

  it("a load abandoned before it used the slot hands it back: StrictMode's double effect", async () => {
    let arrive: (r: Response) => void = () => {};
    articleAnswer = () => new Promise<Response>((go) => (arrive = go));
    preloadArticles(["a"]);
    await settle();
    /* Effect, cleanup, effect — **in one synchronous run, with no await between
       them**, because that is how React does it. The first version of this test
       let a microtask pass between cleanup and the second run, which gave the
       first load time to hand the slot back, and passed while the real browser
       still asked the server on every click. */
    const first = new AbortController();
    const abandoned = open("a", "user-1", first.signal).catch((e: unknown) => e);
    first.abort();
    const second = open("a");
    await abandoned;
    await settle();
    arrive(ok("a"));
    expect((await second).kind).toBe("owned");
    expect(articleGets("a"), "the second load asked the server").toBe(1);
    expect(signals.get("a")?.aborted).toBe(false);
  });
});

describe("the shelf's choice", () => {
  const entry = (slug: string, lastOpenedAt?: string, archivedAt?: string) =>
    ({ slug, lastOpenedAt, archivedAt }) as LibraryEntry;

  it("the five opened most recently, newest first; never opened and archived are not candidates", () => {
    const shelf = [
      entry("never"),
      entry("old", "2026-01-01T00:00:00Z"),
      entry("archived", "2026-09-30T00:00:00Z", "2026-09-30T00:00:00Z"),
      ...["1", "2", "3", "4", "5"].map((n) => entry(`s${n}`, `2026-09-2${n}T00:00:00Z`)),
    ];
    expect(recentlyOpened(shelf)).toEqual(["s5", "s4", "s3", "s2", "s1"]);
  });

  it("the shelf on screen preloads them, and opening one makes no second request", async () => {
    function Shelf({ articles }: { articles: LibraryEntry[] | null }) {
      usePreloadRecent(articles);
      return null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => {
      root.render(<Shelf articles={[entry("x", "2026-09-29T00:00:00Z"), entry("unopened")]} />);
    });
    for (let i = 0; i < 50 && articleGets("x") === 0; i++) await new Promise((go) => setTimeout(go, 20));
    expect(articleGets("x"), "the shelf never preloaded").toBe(1);
    expect(articleGets("unopened")).toBe(0);
    act(() => root.unmount());
    await open("x");
    expect(articleGets("x")).toBe(1);
  });
});
