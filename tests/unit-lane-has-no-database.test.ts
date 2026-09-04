/**
 * **The unit lane's positive control: prove there is no database here.**
 *
 * `tests/setup/unit-no-database.ts` poisons `DATABASE_URL` after `.env.local`
 * has loaded, and that is the semantic backstop the lane scan cannot be — GPT
 * Sol's obligation on T-D, `260903f-lane-manifest-review-sol.md` § 2. Like every
 * guard in this stage it can fail by doing nothing at all: get the ordering
 * backwards and `src/env.ts` quietly puts the real URL back, with **no warning**,
 * because its shadowing warning is suppressed when `NODE_ENV === "test"` and
 * vitest sets exactly that. The suite would then run green against the shared
 * database, which is what it did before this stage existed.
 *
 * So the claim is asserted here as an observed outcome rather than trusted:
 *
 * 1. the variable holds the poison, and
 * 2. **a connection attempt to it fails** — the outcome, not the string. A
 *    string we wrote ourselves cannot tell us what a connection would do, which
 *    is the same argument that makes the private lane assert
 *    `current_database()` rather than the URL it just set.
 *
 * ## Two things about this file that look wrong and are deliberate
 *
 * **It opens a `pg` connection through a namespaced constructor.** That is
 * precisely the shape the lane scan cannot see — `/\bnew\s+(Pool|Client)\s*\(/`
 * does not match `new pg.Client(` — so this file is a working specimen of the
 * escapee the poison exists to catch, and it belongs in the unit project rather
 * than in a database lane.
 *
 * **It is therefore not in `TEST_LANES`, and the third case below fails if
 * somebody puts it there.** Moving it into `private-postgres` would hand it a
 * real database and the control would pass while testing nothing — a control
 * that cannot fail, in a file whose whole job is to be able to.
 *
 * Watched failing on 2026-09-04, by moving the assignment above `loadEnvLocal()`
 * in the setup file: `expected 'postgresql://postgres:…@127.0.0.1:54362/postgres'
 * to be 'postgresql://unit-lane:none@127.0.0.1:1/…'`, and the connection case
 * connected happily to the shared database.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { describe, expect, it } from "vitest";

import { blobStore } from "../src/store/blobs.js";
import { UNIT_LANE_POISON, UNIT_LANE_STORAGE_POISON } from "./helpers/unit-lane-poison.js";
import { TEST_LANES } from "./store-migration-registry.js";

const SELF = "tests/unit-lane-has-no-database.test.ts";

describe("the unit lane has no database", () => {
  it("runs with the poisoned DATABASE_URL, not the one in .env.local", () => {
    expect(process.env.DATABASE_URL).toBe(UNIT_LANE_POISON);
  });

  it("cannot open a connection with it", async () => {
    /* Namespaced on purpose — see the header. The point of the attempt is that
       it is a real one: if the poison were ever overwritten, this connects to
       whatever the suite would otherwise have been using, and the assertion
       below fails with that database's name in the URL. */
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5_000,
    });
    let failure = "";
    try {
      await client.connect();
      await client.end();
    } catch (err) {
      failure = (err as Error).message;
    }
    expect(failure, "a unit-lane test reached a database, so the poison is not applied").not.toBe(
      "",
    );
    expect(failure).toMatch(/ECONNREFUSED|127\.0\.0\.1:1\b/);
  });

  /**
   * **The Storage half, and it asserts the adapter as well as the failure.**
   *
   * Two ways to be wrong here and only one of them is loud. If the poison were
   * lost, `blobStore()` would hand back a working Supabase adapter and `head()`
   * would return `null` for an absent key — a *pass* on any "it threw" test,
   * and a real HTTP call to the shared bucket. If instead the credentials were
   * unset, `blobStore()` falls back to the filesystem adapter, which also
   * answers `null` cheerfully and never touches the network. So the assertion
   * is the failure **and** the identity of the thing that failed.
   */
  it("cannot reach Supabase Storage with it either", async () => {
    expect(process.env.SUPABASE_URL).toBe(UNIT_LANE_STORAGE_POISON);
    /* The service key is still set, which is what keeps the Supabase adapter
       selected rather than the filesystem one. Asserted, because deleting it
       is the fix somebody will reach for and it silently opens the fs store. */
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", "the key must stay set").not.toBe("");

    let failure = "";
    try {
      await blobStore().head("sources/canonical/0000000000000000.pdf");
    } catch (err) {
      const cause = (err as { cause?: { message?: string } }).cause;
      failure = `${(err as Error).message} / ${cause?.message ?? "(no cause)"}`;
    }
    expect(failure, "a unit-lane test reached a blob store that answered").not.toBe("");
    expect(failure).toMatch(/ECONNREFUSED 127\.0\.0\.1:2\b/);
  });

  /**
   * **The subprocess half: a poison that does not survive `spawn` is not a
   * boundary, it is a boundary-shaped hole.**
   *
   * Watched failing on 2026-09-04 by deleting the `PINNED` assignment from
   * `tests/setup/unit-no-database.ts` — the child came back with
   * `postgresql://postgres@127.0.0.1:54362/postgres`, which is the shared
   * database, out of a lane whose whole claim is that it has none.
   *
   * The child is a real `tsx` process running `src/env.ts`'s real loader
   * (`tests/helpers/report-env-child.ts`), because the failure is that the
   * *rule* is right and its evidence does not cross the boundary — nothing
   * inside this process can show that.
   */
  it("hands the poison to a child process, which .env.local then leaves alone", () => {
    const tsx = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
    const child = spawnSync(
      tsx,
      [fileURLToPath(new URL("helpers/report-env-child.ts", import.meta.url))],
      { encoding: "utf8", env: process.env },
    );
    expect(child.status, child.stderr).toBe(0);
    const seen = JSON.parse(child.stdout.trim()) as Record<string, string | null>;

    /* By name, not by whole string: `new URL().toString()` normalises, and the
       identifying part is the database and the marker path — which are also
       what a reader recognises in a failure message. */
    expect(seen.DATABASE_URL, "the child's DATABASE_URL").toContain(
      "this_test_is_in_the_unit_lane_and_may_not_use_a_database",
    );
    expect(seen.SUPABASE_URL, "the child's SUPABASE_URL").toContain(
      "this-test-is-in-the-unit-lane-and-may-not-use-supabase-storage",
    );
  }, 120_000);

  it("is deliberately in no lane, because a lane would give it a database", () => {
    expect(Object.keys(TEST_LANES)).not.toContain(SELF);
  });
});
