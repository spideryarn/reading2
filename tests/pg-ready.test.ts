/**
 * The shared Postgres readiness probe, both ways round — and since 2026-09-05
 * both ways are failures.
 *
 * A hundred-odd suites decide whether they can run by calling `pgReady`, and
 * until the hinge its *skip* branch was load-bearing in a way that was hard to
 * see: on a laptop with Docker running it never executed, and a helper whose
 * warn branch has never run is not evidence that a skip would be noticed. That
 * was the whole failure the helper was written to stop — a suite opting itself
 * out inside a green run (docs/reusable/silent-success.md).
 *
 * **There is no skip branch left.** There is one store, so a database this suite
 * cannot use is a failure rather than a configuration
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § F). What has to be proved now is the shape of the *refusal*, in each of the
 * four ways a database can be not-ready, and that each one names the command
 * that fixes it — because a refusal that sent somebody to `db:start` when what
 * is wrong is a migration costs about as much as no refusal at all.
 *
 * Each case makes the probe fail on purpose and asserts on the **message**: a
 * helper that threw a bare `Error` would satisfy every "does it throw"
 * assertion ever written about it.
 *
 * The happy path needs a real database. It does not skip without one — the
 * preflight in `tests/setup/private-db-global.ts` has already failed the command
 * by then.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadEnvLocal } from "../src/env.js";
import { type MissingKind, pgReady, requiredFailureMessage } from "./helpers/pg-ready.js";

loadEnvLocal();

/**
 * A port nothing is listening on, on the loopback.
 *
 * Refused, not dropped, so the failure arrives in milliseconds instead of
 * waiting out the ten-second connect timeout. What is being proved here is that
 * an unreachable database refuses — not how long it takes to notice.
 */
const DEAD_URL = "postgresql://postgres:postgres@127.0.0.1:1/postgres";

/** Restored per case, because every one of these stubs `DATABASE_URL`. */
beforeEach(() => {
  vi.stubEnv("REQUIRE_POSTGRES", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("pgReady, when the database cannot answer", () => {
  it("refuses when there is no DATABASE_URL, and says which command sets one", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await expect(
      pgReady({ suite: "tests/pg-ready.test.ts", tables: ["spideryarn.articles"] }),
    ).rejects.toThrow(/DATABASE_URL is not set/);
  });

  it("names the suite when nothing is listening", async () => {
    vi.stubEnv("DATABASE_URL", DEAD_URL);
    /* The suite's name is the point. A hundred-odd files share one output, and
       "needs Postgres" without a name tells you nothing you can act on. */
    await expect(
      pgReady({ suite: "tests/pg-ready.test.ts", tables: ["spideryarn.articles"] }),
    ).rejects.toThrow(/tests\/pg-ready\.test\.ts needs Postgres, and could not reach it/);
  });

  it("refuses rather than handing back a pool it could not build", async () => {
    vi.stubEnv("DATABASE_URL", DEAD_URL);
    /* A caller writing `pool!.query(…)` off a probe that had failed would get an
       unhandled rejection out of a suite that never ran, which is the confusing
       failure this guarantees away — now by not returning at all. */
    await expect(
      pgReady({
        suite: "tests/pg-ready.test.ts",
        tables: ["spideryarn.articles"],
        keepPool: true,
      }),
    ).rejects.toThrow(/needs Postgres/);
  });
});

/**
 * The message, which is the only part of a refusal anybody reads.
 *
 * `requiredFailureMessage` is asserted directly rather than through a throw,
 * because the four kinds differ in one line each and a case per kind is what
 * keeps them from collapsing into one sentence that is wrong for three of them.
 */
describe("what a refusal says", () => {
  /* The four fixes are different commands, which is the whole reason the kind is
     carried around rather than inferred from the sentence. */
  const fixes: [MissingKind, RegExp][] = [
    ["no-url", /npm run db:start/],
    ["unreachable", /npm run db:start/],
    ["migration", /npm run db:migrate/],
    ["grant", /grant, not a migration/],
  ];
  it.each(fixes)("names the fix for a %s", (kind, fix) => {
    const message = requiredFailureMessage("tests/example.test.ts", "the thing is missing", kind);
    expect(message).toContain("tests/example.test.ts");
    expect(message).toContain("the thing is missing");
    expect(message).toMatch(fix);
  });

  it("does not confuse a missing migration with a missing database", () => {
    const migration = requiredFailureMessage("s", "spideryarn.jobs is not there", "migration");
    /* The one wrong turn this whole mechanism can take: telling somebody whose
       database is up but a migration behind to start their database. */
    expect(migration).not.toContain("db:start");
    const dead = requiredFailureMessage("s", "could not reach it", "unreachable");
    expect(dead).not.toContain("db:migrate");
  });

  it("says why this is a failure rather than a skip, so nobody puts the skip back", () => {
    const message = requiredFailureMessage("s", "the thing is missing", "migration");
    expect(message).toContain("one store");
  });
});

describe("pgReady, against the real database", () => {
  it("returns for a table that is there", async () => {
    await expect(
      pgReady({ suite: "tests/pg-ready.test.ts", tables: ["spideryarn.articles"] }),
    ).resolves.toEqual({});
  });

  it("names the TABLE when the migration has not run", async () => {
    /* Naming the missing thing is why the probe is parameterised rather than one
       shared boolean: "the schema is not there" sends you to the wrong place
       when what is actually missing is one migration's table. */
    await expect(
      pgReady({
        suite: "tests/pg-ready.test.ts",
        tables: ["spideryarn.articles", "spideryarn.no_such_table"],
      }),
    ).rejects.toThrow(/spideryarn\.no_such_table[\s\S]*npm run db:migrate/);
  });

  it("names the COLUMN when the table is there but a migration behind", async () => {
    await expect(
      pgReady({
        suite: "tests/pg-ready.test.ts",
        columns: [{ table: "spideryarn.articles", column: "no_such_column" }],
      }),
    ).rejects.toThrow(/spideryarn\.articles\.no_such_column/);
  });

  it("separates readable from existing, which is a grant and not a migration", async () => {
    await expect(
      pgReady({ suite: "tests/pg-ready.test.ts", readable: ["spideryarn.no_such_table"] }),
    ).rejects.toThrow(/not readable by this role/);
  });

  it("hands back a live pool when asked, and the caller can query through it", async () => {
    const { pool } = await pgReady({
      suite: "tests/pg-ready.test.ts",
      tables: ["spideryarn.articles"],
      keepPool: true,
    });
    expect(pool).toBeDefined();
    const rows = await pool!.query<{ n: number }>("select 1 as n");
    expect(rows.rows[0]?.n).toBe(1);
    await pool!.end();
  });
});
