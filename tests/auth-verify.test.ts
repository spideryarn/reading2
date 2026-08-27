/**
 * `verifyWithSupabase` — **the real verifier**, which nothing was testing.
 *
 * `tests/auth.test.ts` drives `requireUser` with hand-written verdicts, which is
 * the right shape for the *claims* checking it is about. But it means the
 * function that turns the SDK's answer into one of those verdicts had no test at
 * all, and GPT Sol's review of the built code, 2026-08-27, item 10:
 *
 * > `auth.test.ts` injects already-classified verifier results. It never
 * > exercises `verifyWithSupabase`, SDK errors, JWK fallback or the incorrect
 * > `AuthApiError` classification.
 *
 * ## What the classification is actually for
 *
 * Two of the three outcomes refuse the request, so getting them the wrong way
 * round does **not** fail open — which is exactly why it survived. What it
 * breaks is the client:
 *
 *  - **401** tells the browser its session is stale, so `apiFetch` refreshes and
 *    retries once, and failing that sends the reader to sign in.
 *  - **503** tells it we are broken, so it must NOT throw a good session away.
 *
 * Report an outage as a 401 and you send someone round a refresh loop that
 * cannot succeed. Report a genuinely dead token as a 503 and polling code
 * retries forever an error that will never clear, and the reader never gets sent
 * to the sign-in page. The first version mapped every `AuthApiError` to
 * "unavailable", and Supabase uses that class for 4xx token failures too.
 *
 * So these tests are about a distinction that is invisible from the outside
 * until somebody is stuck on a spinner.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getClaims } }),
}));

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_not-a-real-key";

const { verifyWithSupabase } = await import("../src/auth.js");

/** The shape Supabase's `AuthApiError` really has: a name and an HTTP status. */
function authError(name: string, status?: number) {
  const err = Object.assign(new Error("nope"), { name });
  if (status !== undefined) Object.assign(err, { status });
  return err;
}

beforeEach(() => {
  getClaims.mockReset();
});

describe("classifying what the SDK says", () => {
  it("accepts claims and passes them through untouched", async () => {
    const claims = { sub: "abc", email: "a@b.test", role: "authenticated" };
    getClaims.mockResolvedValue({ data: { claims }, error: null });
    await expect(verifyWithSupabase("token")).resolves.toEqual({ ok: true, claims });
  });

  /**
   * **The bug this file exists for.** A 4xx from the auth API is a verdict on
   * the token, whatever class it arrives as.
   */
  it("calls a 4xx auth error a bad token, not an outage", async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      getClaims.mockResolvedValue({ data: null, error: authError("AuthApiError", status) });
      await expect(verifyWithSupabase("token")).resolves.toEqual({ ok: false, kind: "bad-token" });
    }
  });

  it("calls a 5xx auth error an outage, not a bad token", async () => {
    for (const status of [500, 502, 503]) {
      getClaims.mockResolvedValue({ data: null, error: authError("AuthApiError", status) });
      await expect(verifyWithSupabase("token")).resolves.toEqual({ ok: false, kind: "unavailable" });
    }
  });

  /**
   * No status at all is a fetch that never got an answer — DNS, TLS, a dropped
   * connection. A verifier that could not run has decided nothing about the
   * token, so it must not be allowed to imply the token was bad.
   */
  it("treats an error with no status as ours", async () => {
    getClaims.mockResolvedValue({ data: null, error: authError("TypeError") });
    await expect(verifyWithSupabase("token")).resolves.toEqual({ ok: false, kind: "unavailable" });
  });

  /** Its whole purpose is to say "try again", so it never means a bad token. */
  it("treats a retryable fetch error as ours even with a 4xx on it", async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: authError("AuthRetryableFetchError", 400),
    });
    await expect(verifyWithSupabase("token")).resolves.toEqual({ ok: false, kind: "unavailable" });
  });

  /** A throw is not a verdict either — the key set was unreachable or unparseable. */
  it("treats a throw out of getClaims as ours", async () => {
    getClaims.mockRejectedValue(new TypeError("fetch failed"));
    await expect(verifyWithSupabase("token")).resolves.toEqual({ ok: false, kind: "unavailable" });
  });

  /**
   * No error and no data is not a state the SDK documents, and the honest
   * reading is that we do not know. It must not become an acceptance.
   */
  it("refuses an answer with neither claims nor an error", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    await expect(verifyWithSupabase("token")).resolves.toMatchObject({ ok: false });
  });
});

describe("what it says out loud", () => {
  /**
   * **Nothing here may interpolate the token, the header, the sub or the email.**
   *
   * `logRequest` in src/routes.ts writes an error's message into a `reason`
   * field, and docs/project/logging.md is emphatic that redaction matches key
   * paths and never text — so a secret spliced into a message string is a
   * secret in the log, and no redaction rule can retrieve it.
   */
  it("never puts the token in a log line", async () => {
    const lines: unknown[] = [];
    const { log } = await import("../src/log.js");
    const spy = vi.spyOn(log("auth"), "error").mockImplementation(((...args: unknown[]) => {
      lines.push(args);
    }) as never);

    getClaims.mockRejectedValue(new TypeError("fetch failed"));
    await verifyWithSupabase("a-very-secret-token-value");
    getClaims.mockResolvedValue({ data: null, error: authError("AuthApiError", 500) });
    await verifyWithSupabase("a-very-secret-token-value");

    expect(JSON.stringify(lines)).not.toContain("a-very-secret-token-value");
    spy.mockRestore();
  });
});
