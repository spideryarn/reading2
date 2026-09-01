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
import { type OwnerId, runAsOwner } from "../../src/owner.js";

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

/**
 * The same identity, as the store's `OwnerId`.
 *
 * Here rather than cast at every call site, because a route suite that seeds an
 * article has to seed it as **this** owner: the Postgres reader filters by owner
 * (`ownedSlug` in src/store/pg.ts), and an article belonging to `DEV_OWNER_ID`
 * is invisible to a request `acceptAny` authenticated — which surfaces as a 404
 * that looks like a broken route rather than like a mismatched fixture.
 *
 * The cast is what tests/blocking-job-409.test.ts already does; `asOwnerId` is
 * private to src/owner.ts.
 */
export const TEST_OWNER = TEST_SUB as OwnerId;

/**
 * Ask the store something **as the reader `acceptAny` authenticates**.
 *
 * A suite that drives `handleApi` and then reads the result back out of the
 * store is asking two different questions unless it says so: inside the request
 * the owner is `TEST_OWNER`, and outside it `currentOwnerId()` falls back to the
 * environment's owner, which is somebody else. The read then fails as
 * `No article artefacts for "…"` — a 404 about the fixture, arriving in the
 * assertion, looking like the route lost the write.
 */
export const asTestOwner = <T>(body: () => Promise<T>): Promise<T> =>
  runAsOwner(TEST_OWNER, body);

/** Says yes to any token at all. Only ever handed in by a test. */
export const acceptAny: Verifier = async (): Promise<VerifyResult> => ({
  ok: true,
  claims: { sub: TEST_SUB, email: TEST_EMAIL, role: "authenticated", is_anonymous: false },
});

/** The header a request needs before `acceptAny` is even consulted. */
export const AUTHED_HEADERS = { authorization: "Bearer test-token" };
