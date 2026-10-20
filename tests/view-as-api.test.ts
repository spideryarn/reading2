// @vitest-environment jsdom
/**
 * **The request layer in a tab viewing the app as another reader.**
 * docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md
 * § Part 3, Client 2, and round 1 F2 / F5.
 *
 * What is pinned: every request carries the nonce and asks for `no-store`;
 * nothing but a GET leaves the tab, and the refusal is the server's own 403
 * and sentence; the offline drawer is nobody's (no ticket for a reader, no
 * write, no read); a 410 `[view-as-ended]` ends the tab and any other 410 does
 * not; `leavingFetch` sends nothing; and Stop has its own transport with the
 * three outcomes the bar draws.
 *
 * The mark is put on the window **before** lib/api.ts is imported, the way
 * index.html's script puts it there before any module runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NONCE = "A".repeat(20) + "b-_" + "9".repeat(20);
Object.defineProperty(window, "__spideryarnViewAs", {
  configurable: true,
  value: Object.freeze({ nonce: NONCE }),
});

const getSession = vi.fn();
const refreshSession = vi.fn();
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession,
      refreshSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

const readCache = vi.fn(async (_url: string, _userId: string | null) => null);
const writeCache = vi.fn();
const invalidateCache = vi.fn();
const reserveTicket = vi.fn(async (url: string, userId: string | null) =>
  userId ? { userId, url, epoch: 0, seq: 1 } : null,
);
vi.mock("../src/web/lib/offline-store.js", () => ({
  readCached: readCache,
  writeCached: writeCache,
  reserveTicket,
  invalidate: invalidateCache,
  cachedSlugs: vi.fn(async () => new Set()),
  rememberUser: vi.fn(),
  lastKnownUser: () => "admin-1",
  forgetUser: vi.fn(),
}));

const { apiFetch, endViewAs, leavingFetch, statusOf } = await import("../src/web/lib/api.js");
const { VIEW_AS_READ_ONLY, resetViewAsEndForTests, tabExit, viewAsEnded, viewAsNonce } = await import(
  "../src/web/lib/view-as.js"
);

function stubFetch(...responses: (Response | Error)[]) {
  const calls: [string, RequestInit][] = [];
  let i = 0;
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    calls.push([url, init]);
    const next = responses[Math.min(i++, responses.length - 1)]!;
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const close = vi.fn();
const replace = vi.fn();

beforeEach(() => {
  vi.unstubAllGlobals();
  getSession.mockReset();
  getSession.mockResolvedValue({
    data: { session: { access_token: "ADMIN-TOKEN", user: { id: "admin-1" } } },
  });
  readCache.mockClear();
  writeCache.mockClear();
  invalidateCache.mockClear();
  reserveTicket.mockClear();
  close.mockReset();
  replace.mockReset();
  tabExit.close = close;
  tabExit.replace = replace;
  resetViewAsEndForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Let the fire-and-forget body read in `watchForViewAsEnd` finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the mark", () => {
  it("is read back as the nonce", () => {
    expect(viewAsNonce()).toBe(NONCE);
  });
});

describe("apiFetch while viewing as", () => {
  it("sends the nonce, the administrator's own token, and no-store", async () => {
    const calls = stubFetch(json({ articles: [] }));
    await apiFetch("/api/library");
    const [, init] = calls[0]!;
    const headers = new Headers(init.headers);
    expect(headers.get("X-Spideryarn-View-As")).toBe(NONCE);
    expect(headers.get("Authorization")).toBe("Bearer ADMIN-TOKEN");
    expect(init.cache).toBe("no-store");
  });

  for (const method of ["POST", "PATCH", "PUT", "DELETE", "post"]) {
    it(`refuses a ${method} before sending it, with the server's 403 and sentence`, async () => {
      const calls = stubFetch(json({}));
      const err = await apiFetch("/api/library/x/open", { method }).catch((e: unknown) => e);
      expect(calls).toHaveLength(0);
      expect(statusOf(err)).toBe(403);
      expect((err as Error).message).toBe(VIEW_AS_READ_ONLY);
      expect((err as Error).message).toContain("[view-as-read-only]");
    });
  }

  it("refuses the end route through apiFetch too: Stop has its own transport", async () => {
    const calls = stubFetch(json({}));
    await expect(apiFetch("/api/admin/view-as/end", { method: "POST" })).rejects.toThrow(VIEW_AS_READ_ONLY);
    expect(calls).toHaveLength(0);
  });

  it("files nothing in the offline drawer: no reader's ticket, no write", async () => {
    stubFetch(json({ articles: [] }));
    await apiFetch("/api/library");
    await settle();
    /* Asked, and asked for nobody — which offline-store.ts answers without
       opening IndexedDB at all. */
    expect(reserveTicket).toHaveBeenCalledWith("/api/library", null);
    for (const call of reserveTicket.mock.calls) expect(call[1]).toBeNull();
    expect(writeCache).not.toHaveBeenCalled();
  });

  it("reads nothing from the drawer when the transport fails", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    await expect(apiFetch("/api/library")).rejects.toThrow();
    expect(readCache).toHaveBeenCalledWith("/api/library", null);
    for (const call of readCache.mock.calls) expect(call[1]).toBeNull();
  });

  it("ends the tab on a 410 that says the view has ended", async () => {
    stubFetch(json({ error: "This view has ended. [view-as-ended]" }, 410));
    const res = await apiFetch("/api/library");
    /* The caller still gets its response, unread. */
    expect(res.status).toBe(410);
    expect(await res.text()).toContain("[view-as-ended]");
    await settle();
    expect(viewAsEnded()).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("falls back to the administrator's shelf when the browser keeps the tab open", async () => {
    vi.useFakeTimers();
    stubFetch(json({ error: "Gone. [view-as-ended]" }, 410));
    await apiFetch("/api/library");
    await vi.runAllTimersAsync();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("does not end the tab on some other 410", async () => {
    stubFetch(json({ error: "That article was deleted." }, 410));
    await apiFetch("/api/article/x");
    await settle();
    expect(viewAsEnded()).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });
});

describe("leavingFetch while viewing as", () => {
  it("sends nothing", async () => {
    const calls = stubFetch(json({}));
    await leavingFetch("/api/reading-time/x", { method: "POST", body: "{}" });
    expect(calls).toHaveLength(0);
  });
});

describe("Stop's own transport", () => {
  it("posts to the end route with the nonce and the token, and ends on a 2xx", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    expect(await endViewAs()).toEqual({ kind: "ended" });
    const [url, init] = calls[0]!;
    expect(url).toBe("/api/admin/view-as/end");
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(new Headers(init.headers).get("X-Spideryarn-View-As")).toBe(NONCE);
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer ADMIN-TOKEN");
  });

  it("counts a 410 as ended: the server has no live view either way", async () => {
    stubFetch(json({ error: "Gone. [view-as-ended]" }, 410));
    expect(await endViewAs()).toEqual({ kind: "ended" });
  });

  it("reports a refusal it cannot count as ended, in the server's words", async () => {
    stubFetch(json({ error: "Something went wrong here." }, 500));
    expect(await endViewAs()).toEqual({ kind: "failed", message: "Something went wrong here." });
  });

  it("reports a lost connection rather than throwing", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    const answer = await endViewAs();
    expect(answer.kind).toBe("failed");
  });
});
