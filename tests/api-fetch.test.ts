/**
 * `apiFetch`, tested directly rather than through a route.
 *
 * Every request the client makes now goes through this one function, so a bug
 * in it is a bug in all thirty-one call sites at once — and most of its
 * failures are quiet. A dropped header is a 401 that looks like an expired
 * session; a dropped `signal` is a request that will not cancel; a lost body is
 * a save that silently does nothing.
 *
 * The Supabase client is mocked, because the thing under test is the header and
 * the retry, not the SDK.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const refreshSession = vi.fn();

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession,
      refreshSession,
      /* `apiFetch`'s module subscribes at import time to keep a token for
         `leavingFetch`. It must not be the thing that breaks these tests. */
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

const { apiFetch } = await import("../src/web/lib/api.js");

/** The last `fetch` we were handed, so a test can look at what went out. */
function stubFetch(...responses: Response[]) {
  const calls: [string, RequestInit][] = [];
  let i = 0;
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return Promise.resolve(responses[Math.min(i++, responses.length - 1)]);
  });
  return calls;
}

const ok = () => new Response("{}", { status: 200 });
const unauthorised = () => new Response('{"error":"no"}', { status: 401 });

beforeEach(() => {
  vi.unstubAllGlobals();
  getSession.mockReset();
  refreshSession.mockReset();
  getSession.mockResolvedValue({ data: { session: { access_token: "TOKEN-1" } } });
});

describe("apiFetch", () => {
  it("puts the reader's token on the request", async () => {
    const calls = stubFetch(ok());
    await apiFetch("/api/library");
    expect(new Headers(calls[0]![1].headers).get("Authorization")).toBe("Bearer TOKEN-1");
  });

  /**
   * Callers pass headers three different ways, and the object-spread version of
   * this function silently produces `{}` for two of them — a request that goes
   * out looking almost right.
   */
  it("merges with headers the caller already set, however they spelled them", async () => {
    for (const headers of [
      { "Content-Type": "application/json" },
      new Headers({ "Content-Type": "application/json" }),
      [["Content-Type", "application/json"]] as [string, string][],
    ]) {
      const calls = stubFetch(ok());
      await apiFetch("/api/reader", { method: "PATCH", headers });
      const sent = new Headers(calls[0]![1].headers);
      expect(sent.get("Content-Type")).toBe("application/json");
      expect(sent.get("Authorization")).toBe("Bearer TOKEN-1");
    }
  });

  it("leaves the method, body and signal exactly as they were", async () => {
    const controller = new AbortController();
    const calls = stubFetch(ok());
    await apiFetch("/api/jobs", {
      method: "POST",
      body: '{"url":"https://example.com"}',
      signal: controller.signal,
    });
    const [, init] = calls[0]!;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"url":"https://example.com"}');
    expect(init.signal).toBe(controller.signal);
  });

  it("refreshes once and retries once on a 401", async () => {
    refreshSession.mockResolvedValue({ data: { session: { access_token: "TOKEN-2" } } });
    const calls = stubFetch(unauthorised(), ok());
    const res = await apiFetch("/api/library");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(new Headers(calls[1]![1].headers).get("Authorization")).toBe("Bearer TOKEN-2");
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  /**
   * **Once, not in a loop.** A client that keeps retrying a refusal turns a
   * refusal into a denial of service against our own server.
   */
  it("does not retry a second time when the fresh token is also refused", async () => {
    refreshSession.mockResolvedValue({ data: { session: { access_token: "TOKEN-2" } } });
    const calls = stubFetch(unauthorised());
    const res = await apiFetch("/api/library");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(2);
  });

  it("gives back the original 401 when the refresh itself fails", async () => {
    refreshSession.mockResolvedValue({ data: { session: null } });
    const calls = stubFetch(unauthorised());
    const res = await apiFetch("/api/library");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  /* Signed out is not an error here. The server refuses, with the server's own
     message, which is a sentence the reader can act on — unlike a thrown
     client-side error about a missing token. */
  it("sends the request without a header when nobody is signed in", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const calls = stubFetch(unauthorised());
    await apiFetch("/api/library");
    expect(new Headers(calls[0]![1].headers).has("Authorization")).toBe(false);
    /* And does not go looking for a refresh. There is no session to refresh,
       the 401 is the correct answer rather than a race, and this is the path
       the sign-in screen's own requests take. */
    expect(refreshSession).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it("keeps the 401 when the refresh call itself throws", async () => {
    refreshSession.mockRejectedValue(new Error("network"));
    const calls = stubFetch(unauthorised());
    const res = await apiFetch("/api/library");
    /* Not a TypeError about fetch. Callers know how to report a 401. */
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  /**
   * The cheapest line in the file, and the one that stops the expensive
   * mistake: a bearer token posted to somebody else's host.
   */
  it("refuses to send anywhere but our own API", async () => {
    stubFetch(ok());
    for (const url of [
      "https://evil.example/api/library",
      "//evil.example/api/library",
      "/apiary/notes",
      "api/library",
    ]) {
      await expect(apiFetch(url), url).rejects.toThrow();
    }
  });

  /* A token is fetched per request rather than remembered, which is what makes
     a backgrounded tab and a bfcache restore behave without a special case. */
  it("asks for the session on every request", async () => {
    stubFetch(ok());
    await apiFetch("/api/library");
    await apiFetch("/api/models");
    expect(getSession).toHaveBeenCalledTimes(2);
  });
});

/**
 * `leavingFetch` — the `pagehide` path, which does not go through `apiFetch` at
 * all because the `await` for a token is long enough for a closing page to be
 * killed inside.
 */
describe("leavingFetch", () => {
  it("starts immediately, with keepalive and the cached token", async () => {
    const { leavingFetch } = await import("../src/web/lib/api.js");
    const calls = stubFetch(ok());
    leavingFetch("/api/reader", { method: "PATCH", body: '{"profile":"x"}' });
    /* Synchronous: no await before the request goes out. That is the whole
       point of the function, so the assertion is that `calls` is already
       populated rather than that it eventually is. */
    expect(calls).toHaveLength(1);
    expect(calls[0]![1].keepalive).toBe(true);
    expect(calls[0]![1].body).toBe('{"profile":"x"}');
  });

  it("refuses anywhere but our own API", async () => {
    const { leavingFetch } = await import("../src/web/lib/api.js");
    const calls = stubFetch(ok());
    leavingFetch("https://evil.example/api/reader", { method: "PATCH" });
    expect(calls).toHaveLength(0);
  });

  /**
   * Browsers cap all in-flight keepalive bodies at about 64KiB and reject over
   * it. This function swallows its own failures by design, so without an
   * explicit guard a large body would fail in total silence.
   */
  it("says so rather than failing silently over the keepalive budget", async () => {
    const { leavingFetch } = await import("../src/web/lib/api.js");
    const complaint = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = stubFetch(ok());
    leavingFetch("/api/reader", { method: "PATCH", body: "x".repeat(70 * 1024) });
    expect(calls).toHaveLength(0);
    expect(complaint).toHaveBeenCalled();
    complaint.mockRestore();
  });
});
