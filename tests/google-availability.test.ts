/**
 * `googleSignInAvailable` — the preflight that stopped a reader landing on
 * Supabase's raw JSON.
 *
 * On 2026-08-27 the live site's Google button navigated to
 * `{"msg":"Unsupported provider: provider is not enabled"}` on `supabase.co`,
 * with nothing of ours left on screen. The guard is one `fetch` before the
 * redirect (src/web/lib/supabase.ts, and GPT Sol's suggestion reviewing
 * docs/plans/260827i-google-sign-in-production.md).
 *
 * **Every test here is about failing open**, because that is the half that can
 * do damage. A preflight that returns `false` when it is merely confused —
 * offline, rate-limited, an unfamiliar body — does not prevent a bad error
 * message, it prevents *signing in*, on a working site, for a reason the reader
 * cannot see. So there is one test for the case it exists to catch and five for
 * the cases it must wave through.
 *
 * The env vars are stubbed before the import because that module builds its
 * client at module load and throws by name without them — deliberately, see
 * its header.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.test");
vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_testkey");

const { googleSignInAvailable } = await import("../src/web/lib/supabase.js");

const realFetch = globalThis.fetch;

function answers(make: () => Response | Promise<Response>) {
  const spy = vi.fn(async () => await make());
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

function settings(external: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ external }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("googleSignInAvailable", () => {
  it("says no only when the project says google is off", async () => {
    answers(() => settings({ google: false, email: true }));
    expect(await googleSignInAvailable()).toBe(false);
  });

  it("says yes when google is on", async () => {
    answers(() => settings({ google: true, email: true }));
    expect(await googleSignInAvailable()).toBe(true);
  });

  it("asks the right endpoint, with the key", async () => {
    const spy = answers(() => settings({ google: true }));
    await googleSignInAvailable();
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://project.supabase.test/auth/v1/settings");
    expect((init.headers as Record<string, string>).apikey).toBe("sb_publishable_testkey");
  });

  /* The five below are the whole point. Each one is a state in which we do not
     know, and not knowing must never block a sign-in. */

  it("fails open when the request throws", async () => {
    answers(() => {
      throw new Error("offline");
    });
    expect(await googleSignInAvailable()).toBe(true);
  });

  it("fails open on a non-200", async () => {
    answers(() => new Response("nope", { status: 503 }));
    expect(await googleSignInAvailable()).toBe(true);
  });

  it("fails open on a body that is not JSON", async () => {
    answers(() => new Response("<html>captive portal</html>", { status: 200 }));
    expect(await googleSignInAvailable()).toBe(true);
  });

  it("fails open when there is no `external` object", async () => {
    answers(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    expect(await googleSignInAvailable()).toBe(true);
  });

  it("fails open when google is absent rather than false", async () => {
    /* A future GoTrue that only lists what is enabled would otherwise silently
       disable our own button on a project where Google works. `!== false`, not
       a truthiness test, and this is the test that pins it. */
    answers(() => settings({ email: true }));
    expect(await googleSignInAvailable()).toBe(true);
  });
});
