/**
 * `apiFetch` when the network is gone.
 *
 * Two failures live here, and they are different from each other.
 *
 * **The hang.** `apiFetch` asks the Supabase SDK for a token before every
 * request. If the access token has expired — which it has, an hour into any
 * session — the SDK tries to refresh it, and offline that is a retry loop with
 * exponential backoff bounded by its own 30-second tick. So the reader waited
 * about twenty-five seconds and was then told their credentials were bad. These
 * tests hold `getSession()` open forever, which is what that looks like from
 * here, and assert that the request goes out anyway.
 *
 * **The fallback.** A request that fails at the transport layer — no network,
 * DNS gone, the fetch itself throwing — should be answered from the copy we
 * saved last time, if we have one. A request that fails with a *status* should
 * not be: a 401 and a 404 are answers, and hiding an answer behind old data is
 * worse than showing it.
 *
 * The Supabase client and the cache are both mocked. What is under test is the
 * order of operations in `apiFetch`, not IndexedDB and not the SDK.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const refreshSession = vi.fn();
let announce: (event: string, session: { access_token: string } | null) => void = () => {};

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession,
      refreshSession,
      onAuthStateChange: (fn: typeof announce) => {
        announce = fn;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  },
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

const readCache = vi.fn();
const writeCache = vi.fn();
const invalidateCache = vi.fn();
const slugsHeld = vi.fn();
vi.mock("../src/web/lib/offline-store.js", () => ({
  readCached: readCache,
  writeCached: writeCache,
  invalidate: invalidateCache,
  cachedSlugs: slugsHeld,
  rememberUser: vi.fn(),
  lastKnownUser: () => "user-1",
  forgetUser: vi.fn(),
}));

const { apiFetch } = await import("../src/web/lib/api.js");

beforeEach(() => {
  vi.unstubAllGlobals();
  getSession.mockReset();
  refreshSession.mockReset();
  readCache.mockReset();
  writeCache.mockReset();
  invalidateCache.mockReset();
  slugsHeld.mockReset();
  readCache.mockResolvedValue(undefined);
  writeCache.mockResolvedValue(undefined);
  invalidateCache.mockResolvedValue(undefined);
  slugsHeld.mockResolvedValue(new Set<string>());
  getSession.mockResolvedValue({ data: { session: { access_token: "TOKEN-1" } } });
  vi.stubGlobal("navigator", { onLine: true });
});

/** A promise that never settles — the offline refresh, from `apiFetch`'s side. */
const never = () => new Promise<never>(() => {});

/**
 * Let the fire-and-forget save land.
 *
 * **Every "does not save" assertion below needs this**, and finding that out
 * was the point of running them against a deliberately broken whitelist: with
 * `cacheable()` forced to `true` they all still passed, because the write had
 * not happened *yet* rather than because it never would. A negative assertion
 * about an unawaited promise is a test that cannot fail.
 */
const settle = () => new Promise<void>((go) => setTimeout(go, 0));

describe("the token wait cannot hold a request hostage", () => {
  it("sends the request even when getSession never answers", async () => {
    getSession.mockImplementation(never);
    /* The SDK told us about this token before the network died. */
    announce("SIGNED_IN", { access_token: "TOKEN-CACHED" });

    const seen: [string, RequestInit][] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      seen.push([url, init]);
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    const res = await apiFetch("/api/article/x");

    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    const headers = new Headers(seen[0]?.[1].headers);
    expect(headers.get("Authorization")).toBe("Bearer TOKEN-CACHED");
  });

  it("still sends when there is no token at all", async () => {
    getSession.mockImplementation(never);
    announce("SIGNED_OUT", null);

    const seen: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      seen.push(url);
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    await apiFetch("/api/library");
    expect(seen).toEqual(["/api/library"]);
  });

  it("does not wait on the SDK at all when the browser says it is offline", async () => {
    /* Not a deadline this time — offline, we should not start the wait. */
    getSession.mockImplementation(never);
    announce("SIGNED_IN", { access_token: "TOKEN-CACHED" });
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    readCache.mockResolvedValue({ body: { ok: true }, savedAt: 1000 });

    const res = await apiFetch("/api/article/x");
    expect(await res.json()).toEqual({ ok: true });
    /* If we had waited for the deadline this would have taken seconds. */
    expect(getSession).toHaveBeenCalledTimes(0);
  });
});

describe("a saved copy answers a dead network, and nothing else", () => {
  it("serves the cache when fetch throws", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    readCache.mockResolvedValue({ body: { title: "saved" }, savedAt: 1_723_600_000_000 });

    const res = await apiFetch("/api/article/x");

    expect(res.status).toBe(200);
    expect(res.headers.get("x-spideryarn-offline")).toBe("copy");
    expect(res.headers.get("x-spideryarn-saved-at")).toBe("1723600000000");
    expect(await res.json()).toEqual({ title: "saved" });
  });

  it("re-throws when fetch throws and there is no saved copy", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    readCache.mockResolvedValue(undefined);

    await expect(apiFetch("/api/article/x")).rejects.toThrow(/Failed to fetch/);
  });

  it("does not serve the cache for a 404", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("no", { status: 404 })));
    readCache.mockResolvedValue({ body: { title: "saved" }, savedAt: 1000 });

    const res = await apiFetch("/api/glossary/x");
    expect(res.status).toBe(404);
    expect(readCache).not.toHaveBeenCalled();
  });

  it("does not serve the cache for a 401", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("no", { status: 401 })));
    readCache.mockResolvedValue({ body: { title: "saved" }, savedAt: 1000 });

    const res = await apiFetch("/api/article/x");
    expect(res.status).toBe(401);
    expect(readCache).not.toHaveBeenCalled();
  });

  it("does not serve the cache when the caller aborted", async () => {
    const stop = new AbortController();
    const abort = new DOMException("The user aborted a request.", "AbortError");
    vi.stubGlobal("fetch", () => Promise.reject(abort));
    readCache.mockResolvedValue({ body: { title: "saved" }, savedAt: 1000 });
    stop.abort();

    await expect(apiFetch("/api/article/x", { signal: stop.signal })).rejects.toThrow(
      /aborted/i,
    );
    expect(readCache).not.toHaveBeenCalled();
  });

  it("does not serve the cache for a POST", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    readCache.mockResolvedValue({ body: { title: "saved" }, savedAt: 1000 });

    await expect(apiFetch("/api/comments/x", { method: "POST" })).rejects.toThrow(
      /Failed to fetch/,
    );
    expect(readCache).not.toHaveBeenCalled();
  });
});

describe("what gets written", () => {
  const jsonOk = () =>
    new Response('{"a":1}', { status: 200, headers: { "content-type": "application/json" } });

  it("saves a 200 JSON GET on the whitelist", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk()));
    const res = await apiFetch("/api/article/x");
    /* The caller must still get an unread body — this is the `clone()`. If the
       save had read the real one, this would be an empty stream, which looks
       exactly like the server returning nothing. */
    expect(await res.json()).toEqual({ a: 1 });
    /* Waited for rather than asserted immediately: the save is deliberately not
       on the caller's critical path, so it lands a turn or two later. */
    await vi.waitFor(() =>
      /* The slug is the fourth argument, and it is what makes eviction work in
         whole articles rather than in loose responses. */
      expect(writeCache).toHaveBeenCalledWith("/api/article/x", { a: 1 }, "user-1", "x"),
    );
  });

  it("does not save an endpoint that is not on the whitelist", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk()));
    await apiFetch("/api/jobs");
    await settle();
    expect(writeCache).not.toHaveBeenCalled();
  });

  it("does not save a 404", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("no", { status: 404 })));
    await apiFetch("/api/glossary/x");
    await settle();
    expect(writeCache).not.toHaveBeenCalled();
  });

  it("does not save a response that is not JSON", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })),
    );
    await apiFetch("/api/article/x");
    await settle();
    expect(writeCache).not.toHaveBeenCalled();
  });

  it("a failed cache write does not fail the request", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk()));
    writeCache.mockRejectedValue(new Error("QuotaExceededError"));

    const res = await apiFetch("/api/article/x");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ a: 1 });
  });
});

describe("a write makes our copy wrong, so it throws the copy away", () => {
  it("invalidates the article's chat after a successful POST", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("{}", { status: 200 })));
    await apiFetch("/api/chat/gibbon", { method: "POST" });
    await vi.waitFor(() => expect(invalidateCache).toHaveBeenCalledWith("/api/chat/gibbon", "user-1"));
  });

  it("invalidates the whole thread list when one thread is deleted", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(null, { status: 204 })));
    await apiFetch("/api/chat/gibbon/thread-9", { method: "DELETE" });
    /* Not `/api/chat/gibbon/thread-9` — the list is what went stale. */
    await vi.waitFor(() => expect(invalidateCache).toHaveBeenCalledWith("/api/chat/gibbon", "user-1"));
  });

  it("does not invalidate when the write failed", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("no", { status: 500 })));
    await apiFetch("/api/comments/gibbon", { method: "POST" });
    await settle();
    expect(invalidateCache).not.toHaveBeenCalled();
  });
});

describe("the offline shelf offers only what it can open", () => {
  const shelf = [{ slug: "kept" }, { slug: "evicted" }];

  it("drops entries whose prose we no longer hold", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    readCache.mockResolvedValue({ body: shelf, savedAt: 1000 });
    slugsHeld.mockResolvedValue(new Set(["kept"]));

    const res = await apiFetch("/api/library");
    expect(await res.json()).toEqual([{ slug: "kept" }]);
  });

  it("leaves an unexpected shape alone rather than emptying the shelf", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    readCache.mockResolvedValue({ body: { entries: "surprise" }, savedAt: 1000 });

    const res = await apiFetch("/api/library");
    expect(await res.json()).toEqual({ entries: "surprise" });
  });

  it("does not filter an article payload", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    readCache.mockResolvedValue({ body: [{ slug: "evicted" }], savedAt: 1000 });
    slugsHeld.mockResolvedValue(new Set(["kept"]));

    const res = await apiFetch("/api/article/x");
    expect(await res.json()).toEqual([{ slug: "evicted" }]);
  });
});

describe("the media type is parsed, not searched", () => {
  it("saves application/json with a charset", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response('{"a":1}', {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      ),
    );
    await apiFetch("/api/article/x");
    await vi.waitFor(() => expect(writeCache).toHaveBeenCalled());
  });

  it("does not save a type that merely contains the words", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response("nope", {
          status: 200,
          headers: { "content-type": "text/html+application/json-ish" },
        }),
      ),
    );
    await apiFetch("/api/article/x");
    await settle();
    expect(writeCache).not.toHaveBeenCalled();
  });
});

/**
 * **A write that leaves our copy correct must not throw it away.**
 *
 * `POST /api/quiz/<slug>/mark` marks one answer against one question and
 * streams the marking back; it stores **no quiz state** — no attempt, no score,
 * no answer, no change to the questions (src/routes.ts § quiz — *"SSE,
 * stateless"*), so `GET /api/quiz/<slug>` still answers what we cached. It is
 * not a write that writes *nothing*: the model call behind it puts a row in the
 * `ai_calls` ledger, which no cached read reflects — see
 * `leavesCachedResourceCurrent` in src/web/lib/api.ts. `resourceOf` maps it to
 * `/api/quiz/<slug>` all the same, because it maps a URL to *its own* resource
 * and cannot know that this one is read-only. So the reader's quiz was evicted
 * by the act of answering a question of it, and adding `/api/quiz/` to
 * `CACHEABLE` on its own would have bought them exactly one question offline.
 * GPT Sol found it reviewing T0.1;
 * docs/plans/260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md.
 *
 * ## The store is real here, and that is the point
 *
 * Every other test in this file asserts on the `invalidate` **call**, which is
 * the cause. The cause is what a wrong fix would go on looking right about: an
 * exemption that names the wrong path still passes *"invalidate was not called
 * with the string I expected"*. So this block gives the mocked store a Map and
 * the real prefix semantics of `invalidate`, and asserts the **effect** the
 * reader gets — the copy is still served when the network goes.
 * docs/reusable/silent-success.md.
 */
describe("marking an answer keeps the quiz it did not change", () => {
  /** url → body, for the one user these tests have. */
  let held: Map<string, unknown>;

  /** A cacheable 200, the same one the block above uses. */
  const jsonOk = () =>
    new Response('{"a":1}', { status: 200, headers: { "content-type": "application/json" } });

  beforeEach(() => {
    held = new Map();
    writeCache.mockImplementation(async (url: string, body: unknown) => {
      held.set(url, body);
    });
    readCache.mockImplementation(async (url: string) =>
      held.has(url) ? { body: held.get(url), savedAt: 1000 } : undefined,
    );
    /* The real thing deletes every row whose url starts with the prefix — see
       `invalidate` in src/web/lib/offline-store.ts. Modelled rather than
       stubbed, so a fix that exempts the quiz by invalidating some *other*
       prefix is not silently harmless here. */
    invalidateCache.mockImplementation(async (prefix: string) => {
      for (const url of [...held.keys()]) if (url.startsWith(prefix)) held.delete(url);
    });
  });

  it("still has the quiz offline after an answer was marked", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk()));
    await apiFetch("/api/quiz/gibbon");
    await settle();

    vi.stubGlobal("fetch", () => Promise.resolve(new Response("data: ok\n\n", { status: 200 })));
    await apiFetch("/api/quiz/gibbon/mark", { method: "POST", body: "{}" });
    await settle();

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    const res = await apiFetch("/api/quiz/gibbon");

    expect(res.headers.get("x-spideryarn-offline")).toBe("copy");
    expect(await res.json()).toEqual({ a: 1 });
  });

  /* The other direction, so "never invalidate anything" is not a passing
     implementation of the exemption. `PATCH /api/comments/<slug>/<id>/mark` is
     the same last segment on a route that really does write — the referee's own
     placement on a criterion — and its copy has to go. */
  it("but a comment mark is a real write, and its copy goes", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk()));
    await apiFetch("/api/comments/gibbon");
    await settle();
    expect(held.has("/api/comments/gibbon")).toBe(true);

    await apiFetch("/api/comments/gibbon/c-1/mark", { method: "PATCH", body: "{}" });
    await settle();

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(apiFetch("/api/comments/gibbon")).rejects.toThrow();
  });
});
