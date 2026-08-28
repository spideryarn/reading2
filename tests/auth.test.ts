/**
 * The gate, tested against tokens we sign ourselves.
 *
 * No network and no running Supabase: `requireUser` takes its verifier as a
 * seam, so these drive the *claims* checking directly. The signature checking
 * belongs to `getClaims`, and the one thing worth pinning about it here is that
 * we never write our own — see the `atob` note in src/auth.ts.
 *
 * Every realistic failure in this file is a fail-open: an empty configuration
 * read as "allow all", a claim that is checked in the happy path only, a
 * verifier that decodes rather than verifies. So each test below asserts a
 * **refusal**, and `tests/routes.test.ts` asserts the one acceptance.
 * docs/reusable/silent-success.md.
 */
import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { requireUser, type VerifyResult } from "../src/auth.js";

/**
 * Greg's real `sub`, imported rather than copied.
 *
 * Nothing here needs it to be *his* — `requireUser` never looks the id up, and
 * these claims are ours to make up. It is his so that the fixture is the shape
 * of a real token, and it comes from `src/admin.ts` because four places in the
 * suite had written the same uuid out by hand and a changed dev identity would
 * have left every one of them quietly describing somebody who is not there.
 *
 * Not a fixture row either way: no test creates this user and none deletes it.
 * `tests/fixture-ids.test.ts`.
 */
const SUB = ADMIN_USER_ID_LOCAL;

function req(authorization?: string): IncomingMessage {
  return { headers: authorization ? { authorization } : {} } as unknown as IncomingMessage;
}

/** A verifier that says yes to whatever claims you hand it. */
const says = (claims: Record<string, unknown>) => async (): Promise<VerifyResult> =>
  ({ ok: true, claims } as VerifyResult);

const good = { sub: SUB, email: "greg@gregdetre.com", role: "authenticated", is_anonymous: false };

/** What the thrown error says its HTTP status is. `httpError` in src/routes.ts. */
async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (err) {
    return (err as { status?: number }).status ?? 500;
  }
}

describe("requireUser", () => {
  it("refuses a request with no Authorization header", async () => {
    expect(await statusOf(requireUser(req(), says(good)))).toBe(401);
  });

  it("refuses a header that is not Bearer", async () => {
    expect(await statusOf(requireUser(req("Basic abc123"), says(good)))).toBe(401);
    expect(await statusOf(requireUser(req("Bearer"), says(good)))).toBe(401);
    expect(await statusOf(requireUser(req("Bearer "), says(good)))).toBe(401);
  });

  it("refuses a token the verifier rejects", async () => {
    const no = async (): Promise<VerifyResult> => ({ ok: false, kind: "bad-token" });
    expect(await statusOf(requireUser(req("Bearer garbage"), no))).toBe(401);
  });

  /**
   * The one that is easy to get backwards, and the reason `VerifyResult` has
   * three shapes rather than two. A 401 tells a client with a perfectly good
   * session to throw it away and refresh, which cannot possibly help, and
   * reports our outage as their mistake. GPT Sol, 2026-08-26.
   */
  it("answers 503, not 401, when the key set cannot be reached", async () => {
    const down = async (): Promise<VerifyResult> => ({ ok: false, kind: "unavailable" });
    expect(await statusOf(requireUser(req("Bearer anything"), down))).toBe(503);
  });

  /**
   * A legacy `anon` key is a validly signed JWT carrying `"role":"anon"` and no
   * `sub`, and it is sitting in the browser bundle of every Supabase app in the
   * world. The signature checks out. It must still not be a login.
   */
  it("refuses a validly signed token that is not a signed-in person", async () => {
    const cases = [
      { ...good, role: "anon" },
      { ...good, role: "service_role" },
      { ...good, sub: undefined },
      { ...good, sub: "not-a-uuid" },
      { ...good, is_anonymous: true },
    ];
    for (const claims of cases) {
      expect(await statusOf(requireUser(req("Bearer t"), says(claims))), JSON.stringify(claims)).toBe(401);
    }
  });

  it("refuses an identity with no email address", async () => {
    expect(await statusOf(requireUser(req("Bearer t"), says({ ...good, email: undefined })))).toBe(401);
    expect(await statusOf(requireUser(req("Bearer t"), says({ ...good, email: "" })))).toBe(401);
  });

  it("returns the user for a good token", async () => {
    const user = await requireUser(req("Bearer t"), says(good));
    expect(user).toEqual({ id: SUB, email: "greg@gregdetre.com" });
  });

  /**
   * **Nothing this file throws may contain a token, an email or a `sub`.**
   * `logRequest` in src/routes.ts writes an error's message into a `reason`
   * field, and docs/project/logging.md is emphatic that redaction matches key
   * paths and never text — so a message is a rule here, not a preference.
   *
   * This is the test that will notice when somebody helpfully adds detail.
   */
  it("never puts a secret in the message it throws", async () => {
    const token = "eyJhbGciOiJFUzI1NiJ9.SECRETPAYLOAD.SECRETSIG";
    const attempts = [
      requireUser(req(`Bearer ${token}`), async () => ({ ok: false, kind: "bad-token" })),
      requireUser(req(`Bearer ${token}`), says({ ...good, role: "anon" })),
      requireUser(req(`Bearer ${token}`), says({ ...good, email: undefined })),
    ];
    for (const attempt of attempts) {
      const message = await attempt.then(
        () => "",
        (err: Error) => err.message,
      );
      expect(message).not.toContain("SECRET");
      expect(message).not.toContain(SUB);
      expect(message).not.toContain("gregdetre");
    }
  });
});

/**
 * Which failures are ours and which are the token's.
 *
 * The first version of `isUnavailable` mapped every `AuthApiError` to 503, and
 * Supabase uses that class for 4xx token failures as well as for its own. The
 * result did not fail open — the request was still refused — but a 503 does not
 * trigger `apiFetch`'s refresh-and-retry, so polling code would sit retrying an
 * error that could never clear instead of sending the reader to sign in.
 * GPT Sol, 2026-08-27.
 */
describe("telling our outage from their bad token", () => {
  const withError = (error: unknown) => async (): Promise<VerifyResult> => {
    const e = error as { status?: number };
    const unavailable =
      (error as { name?: string }).name === "AuthRetryableFetchError" ||
      typeof e.status !== "number" ||
      e.status >= 500;
    return { ok: false, kind: unavailable ? "unavailable" : "bad-token" };
  };

  it("calls a 4xx from the auth API a bad token, not an outage", async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const verify = withError({ name: "AuthApiError", status });
      expect(await statusOf(requireUser(req("Bearer t"), verify)), String(status)).toBe(401);
    }
  });

  it("calls a 5xx, a retryable fetch, and a bare throw an outage", async () => {
    for (const error of [
      { name: "AuthApiError", status: 500 },
      { name: "AuthApiError", status: 503 },
      { name: "AuthRetryableFetchError" },
      { name: "TypeError" },
    ]) {
      const verify = withError(error);
      expect(await statusOf(requireUser(req("Bearer t"), verify)), error.name).toBe(503);
    }
  });
});
