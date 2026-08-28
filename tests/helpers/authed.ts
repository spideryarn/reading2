/**
 * An authenticated default for every suite that drives `handleApi`.
 *
 * Six test files build a fake request by hand and call `handleApi`, and four of
 * them set no `headers` at all. The moment the gate reads
 * `req.headers.authorization`, all six throw — and the obvious repair, adding
 * `headers: {}`, converts the whole set from "throws" to "401", which is a
 * worse place to be because it still looks like a working test suite.
 *
 * So `handleApi` takes its verifier as a seam and these hand it this one. The
 * suites go on being about routes.
 *
 * **This must never become the default in src/auth.ts.** A test helper that
 * makes a production build permissive is exactly the fail-open this whole area
 * is about. The real verifier is the default there; this is passed in.
 */
import { ADMIN_USER_ID_LOCAL } from "../../src/admin.js";
import type { Verifier, VerifyResult } from "../../src/auth.js";

/**
 * Greg's actual Supabase `sub`, so the shape is right rather than merely
 * uuid-ish — imported, not copied.
 *
 * It was written out longhand here and in three test files until 2026-08-28,
 * which meant a changed dev identity would have left all four quietly
 * describing somebody who is not there. `src/admin.ts` is the one place that
 * knows it. See tests/fixture-ids.test.ts for the guard, which cannot see this
 * file — it scans `tests/*.test.ts` only, so this copy survived the sweep that
 * caught the other three.
 */
export const TEST_SUB = ADMIN_USER_ID_LOCAL;
export const TEST_EMAIL = "greg@gregdetre.com";

/** Says yes to any token at all. Only ever handed in by a test. */
export const acceptAny: Verifier = async (): Promise<VerifyResult> => ({
  ok: true,
  claims: { sub: TEST_SUB, email: TEST_EMAIL, role: "authenticated", is_anonymous: false },
});

/** The header a request needs before `acceptAny` is even consulted. */
export const AUTHED_HEADERS = { authorization: "Bearer test-token" };
