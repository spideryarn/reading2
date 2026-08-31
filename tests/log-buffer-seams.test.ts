/**
 * That the log buffer is actually *written to* — which is a different claim
 * from the buffer working, and the one that is easy to get wrong quietly.
 *
 * The plan's first version said three seams saw every failure. They did not:
 * `src/web/upload.ts` is an `XMLHttpRequest` and never touches `apiFetch`,
 * `Tweets.tsx` catches its own failure, `leavingFetch` has its own path, and
 * "recent API calls" needs the successes too. A buffer wired to three of seven
 * seams looks exactly like a buffer wired to all of them, right up until
 * somebody reads a report with nothing in it.
 *
 * The Supabase client is mocked for the reason `tests/api-fetch.test.ts` mocks
 * it: what is under test is the recording, not the SDK.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { apiFetch, readJson } = await import("../src/web/lib/api.js");
const { clearLogBuffer, readLogBuffer, serialiseLogBuffer } = await import(
  "../src/web/log-buffer.js"
);

/** What the reader typed. It must not survive the trip into the buffer. */
const TYPED = "Nagel-on-bats-and-the-appendix";

function stubFetch(...responses: Response[]) {
  let i = 0;
  vi.stubGlobal("fetch", () => Promise.resolve(responses[Math.min(i++, responses.length - 1)]));
}

beforeEach(() => {
  vi.unstubAllGlobals();
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: { access_token: "TOKEN-1" } } });
  clearLogBuffer();
});

describe("apiFetch writes to the buffer", () => {
  it("records a successful call, with x-vercel-id and without the query string", async () => {
    stubFetch(
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json", "x-vercel-id": "lhr1::iad1-abc-123" },
      }),
    );

    await apiFetch(`/api/library/search?q=${encodeURIComponent(TYPED)}`);

    const entry = readLogBuffer().find((e) => e.kind === "api");
    expect(entry).toMatchObject({
      kind: "api",
      outcome: "response",
      method: "GET",
      path: "/api/library/search",
      status: 200,
      vercelId: "lhr1::iad1-abc-123",
    });
    expect(serialiseLogBuffer()).not.toContain("Nagel");
  });

  /** A 500 is a row too. A timeline of failures alone cannot show what preceded one. */
  it("records a non-2xx response as well as a good one", async () => {
    stubFetch(new Response('{"error":"no"}', { status: 500 }));
    await apiFetch("/api/library");

    const outcomes = readLogBuffer().map((e) => (e.kind === "api" ? e.outcome : e.kind));
    expect(outcomes).toContain("response");
    expect(readLogBuffer().find((e) => e.kind === "api" && e.status === 500)).toBeDefined();
  });

  it("records a transport failure by the error's name, with no status", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    // A POST is not cacheable, so this rethrows rather than serving a copy.
    await expect(apiFetch("/api/feedback", { method: "POST" })).rejects.toThrow();

    const entry = readLogBuffer().find((e) => e.kind === "api" && e.outcome === "transport-failed");
    expect(entry).toMatchObject({
      outcome: "transport-failed",
      method: "POST",
      path: "/api/feedback",
      status: null,
      error: "TypeError",
    });
    // The browser's own words are not in there.
    expect(serialiseLogBuffer()).not.toContain("Failed to fetch");
  });

  /**
   * `logFailure`'s row. What it adds over `attempt`'s is the pair that
   * identifies this app's commonest deployment failure — Vercel's single-page
   * fallback answering a request the API should have had — and neither half of
   * it is any of the body.
   */
  it("records the size and media type of a reply that would not parse, and none of it", async () => {
    const html = `<!doctype html><p>${TYPED}</p>`;
    stubFetch(new Response(html, { status: 200, headers: { "content-type": "text/html" } }));

    const res = await apiFetch("/api/library");
    await expect(readJson(res)).rejects.toThrow();

    const entry = readLogBuffer().find((e) => e.kind === "api" && e.outcome === "not-json");
    expect(entry).toMatchObject({
      outcome: "not-json",
      status: 200,
      bytes: html.length,
      contentType: "text/html",
    });
    expect(serialiseLogBuffer()).not.toContain("Nagel");
  });
});
