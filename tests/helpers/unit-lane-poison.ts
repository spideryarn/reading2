/**
 * The two URLs the unit lane runs with, as values and nothing else.
 *
 * Separate from [`tests/setup/unit-no-database.ts`](../setup/unit-no-database.ts),
 * which is the file that *applies* them, and separate on purpose: the control
 * suite `tests/unit-lane-has-no-database.test.ts` has to read these constants
 * without the reading itself poisoning anything. Importing the switch would
 * make that control pass with the setup file removed from `vitest.config.ts` —
 * the same mistake `tests/no-provider-calls-guard.test.ts` records making in its
 * first draft, and the same fix: **import the constant, never the switch**.
 *
 * Port 1 is refused instantly, so an escapee fails in milliseconds rather than
 * sitting out a connect timeout, and the name is the message: it comes back
 * verbatim in node-postgres' error, and in the request URL of a failed `fetch`.
 */
export const UNIT_LANE_POISON =
  "postgresql://unit-lane:none@127.0.0.1:1/this_test_is_in_the_unit_lane_and_may_not_use_a_database";

/**
 * **The bucket half, and the shape of it is the whole point.**
 *
 * `blobStore()` (src/store/blobs.ts) picks Supabase Storage when
 * `SUPABASE_URL` **and** `SUPABASE_SERVICE_ROLE_KEY` are both set, and
 * otherwise falls back to the filesystem adapter, cheerfully: *"Never null —
 * the filesystem always works."* So **unsetting** either variable does not
 * close this hole, it opens a worse one — the lane would silently get a working
 * store writing under `data/_blobs/`, and a test meant to exercise Storage
 * would pass having exercised the thing this repo is in the middle of deleting.
 *
 * Poisoning the URL keeps the Supabase adapter selected and makes every call it
 * makes fail. Measured 2026-09-04: with this value the adapter is still
 * `blobs-supabase.ts` and `head()` throws rather than returning `null`.
 *
 * Loopback rather than a `.invalid` hostname: `ECONNREFUSED` is immediate and
 * does not depend on what a resolver does with a name.
 *
 * **Port 2, and not port 1 like the database poison above.** Measured
 * 2026-09-04: `fetch` refuses port 1 itself — it is on the WHATWG bad-port list
 * — and the error is `TypeError: fetch failed` with cause `bad port`, which
 * names neither the host nor the reason and would be the same message for a
 * malformed URL. Port 2 is not on that list, so the failure is a real
 * `connect ECONNREFUSED 127.0.0.1:2` and reads as one.
 */
export const UNIT_LANE_STORAGE_POISON =
  "http://127.0.0.1:2/this-test-is-in-the-unit-lane-and-may-not-use-supabase-storage";
