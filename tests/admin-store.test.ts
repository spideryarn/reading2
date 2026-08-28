/**
 * `pgAdminStore.listUsersAcrossOwners()` against a real database — the shapes, not the data.
 *
 * ## Why this file exists at all
 *
 * Because the first version of `src/store/pg-admin.ts` type-checked, ran, and
 * was wrong. A `sql` fragment carries a TypeScript type and **no runtime
 * conversion**, so `sql<number>\`count(*)…\`` is a claim about a string —
 * node-postgres returns `bigint` and `numeric` as text so that precision cannot
 * be lost — and `sql<Date>\`max(last_opened_at)\`` was a claim about
 * `"2026-08-27 16:19:31.779+00"`, which is not even ISO-8601. The compiler
 * believed every word of it. `.toISOString()` threw, which was the lucky half;
 * the counts would have reached the browser as strings and sorted 10 below 9,
 * with nothing anywhere looking broken.
 *
 * So the assertions here are about **types at runtime**, and they are the only
 * check in the repo that can make them. docs/reusable/silent-success.md.
 *
 * ## The skip
 *
 * These skip when there is no database, and the skip is a real vitest skip
 * rather than an early return — a run that checked nothing must never look like
 * a run that passed. Same probe, and the same reasoning, as
 * tests/db-schema.test.ts, which learned it the hard way.
 *
 * Read-only: nothing here inserts, so there is no transaction to roll back and
 * no fixture to clean up. It reads whatever is in the database it is pointed
 * at, which is why it asserts shapes and never values.
 */
import { describe, expect, it } from "vitest";

import { loadEnvLocal } from "../src/env.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/* **Only our own schema now, and dropping `auth.users` from this is the point.**

   The probe used to require that the connected role could read `auth.users`,
   back when the store queried it. That requirement outlived the query: the
   accounts come from the Auth service over HTTP, and leaving it here would make
   these tests **skip** under exactly the least-privileged role production uses
   — so the one path that could show the new code works without `auth` access
   would quietly not run. GPT Sol, 2026-08-28.

   Until the shared helper this probe was on a **two-second** connect timeout
   and skipped **silently**; the helper's header records what each cost. */
const { reachable } = await pgReady({
  suite: "tests/admin-store.test.ts",
  tables: ["spideryarn.articles"],
});

/**
 * Needs a database *and* the Auth service, so the default five seconds is not a
 * timeout here — it is a load test. These two cases open a pool, run five
 * grouped aggregates and make an HTTP round trip to GoTrue, and when the whole
 * suite runs in parallel they lose to it while passing every time on their own.
 * The repo has been here before: "Five seconds is not a timeout for a test that
 * starts tsx, it is a load test" (3ed5741).
 *
 * Twenty, which is long enough that a real hang still fails rather than hanging
 * the run.
 */
const dbIt = it.skipIf(!reachable);
const SLOW = 20_000;

/** Is this a string a `Date` can be built from, and does it round-trip? */
function isIso(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const t = Date.parse(value);
  return !Number.isNaN(t) && new Date(t).toISOString() === value;
}

describe("the admin user list", () => {
  dbIt("answers with the whole shape, and every field the right type", async () => {
    /* Imported here rather than at the top: `src/store/index.ts` throws at
       module load when `SPIDERYARN_STORE=postgres` is set without Supabase
       Storage configured, and this suite must not take the whole run down on a
       machine that has a database but no bucket. The Postgres adapter itself
       has no such requirement, so it is imported directly. */
    const { pgAdminStore } = await import("../src/store/pg-admin.js");
    const users = await pgAdminStore.listUsersAcrossOwners();

    /* A regex that matched nothing, or a query against an empty database,
       vouches for nobody and lets every assertion below pass. There is at least
       one account in any database this suite can reach — the seeded owner. */
    expect(users.length).toBeGreaterThan(0);

    for (const user of users) {
      expect(typeof user.id).toBe("string");
      expect(user.email).toBeTruthy();
      expect(typeof user.email).toBe("string");

      /* **The bug this file was written for.** Every count must be a `number`
         and not the string node-postgres hands back for `bigint` and `numeric`.
         `typeof` rather than a comparison: `"3" > 2` is true in JavaScript, so
         a numeric assertion would pass on the broken value. */
      for (const key of ["articles", "archived", "uploads", "questions", "chats", "searches", "opens"] as const) {
        expect(typeof user[key], `${key} on ${user.email}`).toBe("number");
        expect(Number.isInteger(user[key])).toBe(true);
        expect(user[key]).toBeGreaterThanOrEqual(0);
      }

      /* **The other half of the same bug.** Not merely parseable — a
         `Date.parse` succeeds on `"2026-08-27 16:19:31.779+00"` too, which is
         what the broken version produced. It has to round-trip through
         `toISOString`, which only a real ISO string does. */
      expect(isIso(user.createdAt), `createdAt on ${user.email}`).toBe(true);
      for (const key of ["lastSignInAt", "emailConfirmedAt", "lastReadAt"] as const) {
        const value = user[key];
        /* Absent is a fine answer — never signed in, never opened anything —
           and `exactOptionalPropertyTypes` means absent is the *only* spelling
           of it. An explicit `undefined` would serialise to JSON as a missing
           key anyway, so the assertion is on the value when there is one. */
        if (value !== undefined) expect(isIso(value), `${key} on ${user.email}`).toBe(true);
      }

      expect(Array.isArray(user.providers)).toBe(true);
      for (const p of user.providers) expect(typeof p).toBe("string");
    }
  }, SLOW);

  dbIt("gives every account its own row, and no account two", async () => {
    const { pgAdminStore } = await import("../src/store/pg-admin.js");
    const users = await pgAdminStore.listUsersAcrossOwners();
    /* The join is six `group by` queries merged by a `Map`, and the way that
       shape goes wrong is a duplicated key — which would show up here as one
       person twice rather than as an error. */
    expect(new Set(users.map((u) => u.id)).size).toBe(users.length);
  }, SLOW);
});
