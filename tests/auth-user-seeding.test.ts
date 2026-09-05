/**
 * A seeded `auth.users` row must not break the Auth service for everybody else.
 *
 * ## The bug this file was written for
 *
 * `confirmation_token`, `recovery_token`, `email_change` and
 * `email_change_token_new` are nullable with no default, and GoTrue scans them
 * as non-null strings. One row with them left NULL makes
 * `GET /auth/v1/admin/users` answer 500 **for the whole database** — not for
 * that row, that suite or that connection. So a seeder in one test file failed
 * `tests/admin-store.test.ts` in another process, and broke the dev server's
 * `/admin` page for as long as the row was there.
 *
 * It presented as a flake in somebody else's work, which is what makes it worth
 * a test. Reproduced 3/3 by scheduling `admin-store` beside the seeders;
 * docs/plans/260902c-make-the-test-suite-pass-reliably.md § Cause 2.
 *
 * The first test seeds a row through `tests/helpers/seed-auth-user.ts` and asks
 * the Auth service to list the accounts. The second is the guard: it is the
 * helper being the *only* way, and not merely a way, that keeps this fixed.
 *
 * **No Auth probe in the skip guard.** These skip without Postgres, like every
 * other database suite, and then a 500 from GoTrue is a failure. Probing Auth
 * and skipping would turn the defect this file exists to catch into a green run
 * — docs/reusable/silent-success.md.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getDb, closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { gotruePages, listAccounts } from "../src/store/admin-accounts.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

/* Postgres only, and deliberately: see the header. */
await pgReady({
  suite: "tests/auth-user-seeding.test.ts",
  tables: ["spideryarn.articles"],
});

/* Minted per run — this row is inserted and deleted, so a fixed uuid would
   collide with a second process running the same file (tests/fixture-ids.test.ts). */
const OWNER = crypto.randomUUID();

afterAll(async () => {
  await getDb().execute(sql`delete from auth.users where id = ${OWNER}`);
  await closeDb();
});

describe("a test-seeded auth user", () => {
  /* Needs the database and an HTTP round trip to GoTrue, so the default five
     seconds is a load test rather than a timeout under a parallel run — the
     same reasoning, and the same number, as tests/admin-store.test.ts. */
  it(
    "leaves the Auth service able to list the accounts",
    async () => {
      await seedAuthUser(getDb(), {
        id: OWNER,
        email: `auth-user-seeding-${OWNER}@example.invalid`,
      });

      const url = process.env.SUPABASE_URL?.trim();
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
      /* Loud, not skipped: a machine with this database has these, and a
         missing one is a broken .env.local rather than an absent service. */
      if (!url || !key) {
        throw new Error(
          "this test needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — see .env.local and " +
            "docs/project/supabase-local.md.",
        );
      }

      /* The account list, from the service, exactly as the admin page asks for
         it. A NULL in any of the four token columns makes this throw with
         "the Auth service refused the account list (500)". */
      const accounts = await listAccounts(gotruePages(url, key));
      expect(accounts.map((a) => a.id)).toContain(OWNER);
    },
    20_000,
  );
});

/* ------------------------------------------------------------- the guard -- */

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SELF = path.basename(fileURLToPath(import.meta.url));

/** The helper is the one file allowed to write the statement out. */
const HELPER = path.join("helpers", "seed-auth-user.ts");

/**
 * Comments stripped before matching. Both this file and the helper *discuss*
 * the statement they forbid, and half the suite explains in prose which
 * `auth.users` row its owner is — reading that as code is the classic way a
 * grep-shaped test fails on the sentence written to explain it. Same `strip` as
 * tests/auth-users-fence.test.ts, for the same reason.
 */
function strip(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function code(file: string): string {
  return strip(readFileSync(file, "utf8"));
}

/**
 * The statement, however somebody spelled it.
 *
 * Quoted identifiers and space around the dot are all ordinary Postgres, and a
 * grep that matched one spelling would report an empty list for the others —
 * a guard that has been defeated rather than one that passed. Same shape, and
 * the same reasoning, as `AUTH_SCHEMA` in tests/auth-users-fence.test.ts.
 *
 * It is deliberately not a SQL parser. The thing to catch is a careless
 * copy-paste, not somebody determined to get round it.
 */
const INSERT = /insert\s+into\s+["'`]?auth["'`]?\s*\.\s*["'`]?users["'`]?/i;

/** `source` with its comments already out — see `code()`. */
function insertsIntoAuthUsers(source: string): boolean {
  return INSERT.test(strip(source));
}

/** Every `.ts`/`.tsx` under `tests/`, including `helpers/`. */
function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(full);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [full] : [];
  });
}

describe("the guard's own reading of the statement", () => {
  /* The spellings, as strings, because the guard scans files and this file is
     exempt from its own scan — so these cannot be checked by writing them out
     in the prose above and hoping. Every one is valid Postgres and every one
     used to slip through, which is what "the only place" was claiming to rule
     out. */
  it.each([
    `insert into auth.users (id) values ($1)`,
    `INSERT INTO AUTH.USERS (id) values ($1)`,
    `insert into "auth"."users" (id) values ($1)`,
    `insert into auth."users" (id) values ($1)`,
    `insert into auth . users (id) values ($1)`,
    `insert  into\n  auth.users (id) values ($1)`,
  ])("catches %j", (statement) => {
    expect(insertsIntoAuthUsers(statement)).toBe(true);
  });

  it.each([
    `// insert into auth.users (id) values ($1)`,
    `/* insert into "auth"."users" is what this file forbids */`,
    `insert into spideryarn.articles (id) values ($1)`,
    `select * from auth.users`,
  ])("leaves %j alone", (line) => {
    expect(insertsIntoAuthUsers(line)).toBe(false);
  });
});

describe("the seeding helper", () => {
  it("is the only place in tests/ that inserts into auth.users", () => {
    const offenders = testFiles(DIR)
      .filter((f) => path.relative(DIR, f) !== SELF && path.relative(DIR, f) !== HELPER)
      .filter((f) => INSERT.test(code(f)))
      .map((f) => path.relative(DIR, f));

    expect(
      offenders,
      "these hand-roll the insert and will leave the four token columns NULL, which " +
        "makes the Auth service 500 for the whole database. Use seedAuthUser() from " +
        "tests/helpers/seed-auth-user.ts.",
    ).toEqual([]);
  });
});
