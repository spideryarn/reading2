/**
 * The shared Postgres readiness probe, both ways round.
 *
 * Thirty-two suites now decide whether to run by calling `pgReady`, so its
 * *skip* branch is load-bearing in a way that is hard to see: on a laptop with
 * Docker running it never executes, and a helper whose warn branch has never
 * run is not evidence that a skip would be noticed. That is the whole failure
 * this helper was written to stop — a suite opting itself out inside a green
 * run. docs/reusable/silent-success.md.
 *
 * So each test below makes the probe fail on purpose, in one of the four ways
 * it can, and asserts on the **warning** as well as the verdict: a probe that
 * returned `false` without saying so would pass every "is it false" assertion
 * ever written about it.
 *
 * The happy path needs a real database and skips (loudly, through the helper
 * itself) without one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadEnvLocal } from "../src/env.js";
import {
  failIfPostgresRequired,
  type MissingKind,
  pgReady,
  postgresRequired,
  requiredFailureMessage,
} from "./helpers/pg-ready.js";

loadEnvLocal();

/** The live database, or empty — captured before any test stubs the variable. */
const LIVE_URL = process.env.DATABASE_URL ?? "";

/**
 * A port nothing is listening on, on the loopback.
 *
 * Refused, not dropped, so the failure arrives in milliseconds instead of
 * waiting out the ten-second connect timeout. What is being proved here is that
 * an unreachable database warns — not how long it takes to notice.
 */
const DEAD_URL = "postgresql://postgres:postgres@127.0.0.1:1/postgres";

/**
 * Everything written to **stderr** while `fn` ran, joined.
 *
 * Not `console.warn`, because the helper does not use it and must not: vitest
 * swallows a module-load `console.warn` from a file whose tests all skip, so the
 * warning would be invisible in exactly the run that needs it. See the helper's
 * header. Spying here on the same call the helper makes keeps this test on the
 * observable outcome rather than on a stand-in for it.
 */
async function warningsDuring(fn: () => Promise<unknown>): Promise<string> {
  const said: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    said.push(String(chunk));
    return true;
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return said.join("\n");
}

/**
 * **Every probe below is deliberately unreachable, so this file must run with
 * `REQUIRE_POSTGRES` off** — including when the run that invoked it set it.
 *
 * Under `REQUIRE_POSTGRES=1` a failed probe registers a failing test, and vitest
 * refuses to register a suite from inside a running test, so each of these calls
 * would throw instead of returning its verdict. That is the helper working as
 * designed; it just makes this file, whose whole subject is the *skip* branch,
 * the one place that has to say "not here". The required branch has its own
 * tests further down, which stub it back on one call at a time.
 */
beforeEach(() => {
  vi.stubEnv("REQUIRE_POSTGRES", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("pgReady, when the database cannot answer", () => {
  it("says nothing at all when there is no DATABASE_URL — the fresh clone", async () => {
    vi.stubEnv("DATABASE_URL", "");
    let result: Awaited<ReturnType<typeof pgReady>> | undefined;
    const said = await warningsDuring(async () => {
      result = await pgReady({ suite: "tests/pg-ready.test.ts", tables: ["spideryarn.articles"] });
    });
    expect(result?.reachable).toBe(false);
    /* Quiet on purpose: no database configured is not the same situation as a
       database configured and missing, and only the second one is a surprise. */
    expect(said).toBe("");
  });

  it("warns, and names the suite, when nothing is listening", async () => {
    vi.stubEnv("DATABASE_URL", DEAD_URL);
    let result: Awaited<ReturnType<typeof pgReady>> | undefined;
    const said = await warningsDuring(async () => {
      result = await pgReady({ suite: "tests/pg-ready.test.ts", tables: ["spideryarn.articles"] });
    });
    expect(result?.reachable).toBe(false);
    /* The suite's name is the point of the warning. Thirty-two files share one
       stderr, and "these tests are skipping" without a name tells you nothing
       you can act on. */
    expect(said).toContain("tests/pg-ready.test.ts");
    expect(said).toContain("skipping");
    expect(result?.why).toContain("could not reach it");
  });

  it("does not hand back a pool it could not build, even when asked to", async () => {
    vi.stubEnv("DATABASE_URL", DEAD_URL);
    let result: Awaited<ReturnType<typeof pgReady>> | undefined;
    /* Inside `warningsDuring` even though the warning is not what is being
       asserted: every call here is deliberately unreachable, and one that wrote
       its warning to the real stderr would put a genuine-looking "these tests
       are skipping" line into every `npm test`. */
    await warningsDuring(async () => {
      result = await pgReady({
        suite: "tests/pg-ready.test.ts",
        tables: ["spideryarn.articles"],
        keepPool: true,
      });
    });
    expect(result?.reachable).toBe(false);
    /* A caller writing `if (reachable && pool)` is fine either way; one writing
       `pool!.query(…)` would get an unhandled rejection out of a *skipped*
       suite, which is the confusing failure this guarantees away. */
    expect(result?.pool).toBeUndefined();
  });
});

/**
 * `REQUIRE_POSTGRES=1`: the skip becomes a failure.
 *
 * The registration itself — the `describe`/`it` the helper adds to a suite that
 * is about to skip — cannot be asserted from in here, because that is exactly
 * the call vitest refuses from inside a running test. What *can* be asserted is
 * everything either side of it: the env reading, the four messages, and the
 * refusal itself, which is a real branch of the helper and not a stand-in for
 * one. The registration is proved end to end by running the whole Postgres half
 * against a database that cannot answer, which takes more than an environment
 * variable to arrange: docs/project/testing.md § When a skip is not acceptable
 * says why, and how.
 */
describe("REQUIRE_POSTGRES", () => {
  it("is off unless it is exactly 1, because 0 must not mean yes", () => {
    vi.stubEnv("REQUIRE_POSTGRES", "");
    expect(postgresRequired()).toBe(false);
    vi.stubEnv("REQUIRE_POSTGRES", "0");
    expect(postgresRequired()).toBe(false);
    vi.stubEnv("REQUIRE_POSTGRES", "1");
    expect(postgresRequired()).toBe(true);
  });

  it("does nothing at all when it is not set — the default must not move", () => {
    vi.stubEnv("REQUIRE_POSTGRES", "");
    expect(() => failIfPostgresRequired("a suite", "nothing is listening", "unreachable")).not.toThrow();
  });

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

  it("refuses, loudly, when called from inside a test instead of at module scope", () => {
    vi.stubEnv("REQUIRE_POSTGRES", "1");
    /* Not a curiosity: registering nothing here would be a silent success — a
       required run that skipped anyway and said so nowhere. */
    expect(() => failIfPostgresRequired("a suite", "no schema", "migration")).toThrow(
      /could not be reported as a test failure/,
    );
    expect(() => failIfPostgresRequired("a suite", "no schema", "migration")).toThrow(
      /npm run db:migrate/,
    );
  });
});

const when = LIVE_URL ? describe : describe.skip;
if (!LIVE_URL) {
  /* stderr, not console.warn, for the reason the helper's header gives. */
  process.stderr.write("\n  ⚠ tests/pg-ready.test.ts: no DATABASE_URL, so the live half is skipping\n");
  /* And under REQUIRE_POSTGRES=1, a failure: the helper cannot be allowed to
     opt its own live tests out of the run that exists to prove it works. */
  failIfPostgresRequired("tests/pg-ready.test.ts (the live half)", "DATABASE_URL is not set", "no-url");
}

when("pgReady, against the real database", () => {
  it("is reachable for a table that is there, and says nothing", async () => {
    let result: Awaited<ReturnType<typeof pgReady>> | undefined;
    const said = await warningsDuring(async () => {
      result = await pgReady({ suite: "tests/pg-ready.test.ts", tables: ["spideryarn.articles"] });
    });
    expect(result?.reachable).toBe(true);
    expect(result?.why).toBe("");
    expect(said).toBe("");
  });

  it("warns and names the TABLE when the migration has not run", async () => {
    let result: Awaited<ReturnType<typeof pgReady>> | undefined;
    const said = await warningsDuring(async () => {
      result = await pgReady({
        suite: "tests/pg-ready.test.ts",
        tables: ["spideryarn.articles", "spideryarn.no_such_table"],
      });
    });
    expect(result?.reachable).toBe(false);
    /* Naming the missing thing is why the probe is parameterised rather than one
       shared boolean: "the schema is not there" sends you to the wrong place
       when what is actually missing is one migration's table. */
    expect(said).toContain("spideryarn.no_such_table");
    expect(said).toContain("npm run db:migrate");
  });

  it("warns and names the COLUMN when the table is there but a migration behind", async () => {
    let result: Awaited<ReturnType<typeof pgReady>> | undefined;
    const said = await warningsDuring(async () => {
      result = await pgReady({
        suite: "tests/pg-ready.test.ts",
        columns: [{ table: "spideryarn.articles", column: "no_such_column" }],
      });
    });
    expect(result?.reachable).toBe(false);
    expect(said).toContain("spideryarn.articles.no_such_column");
  });

  it("separates readable from existing, which is a grant and not a migration", async () => {
    let result: Awaited<ReturnType<typeof pgReady>> | undefined;
    const said = await warningsDuring(async () => {
      result = await pgReady({
        suite: "tests/pg-ready.test.ts",
        readable: ["spideryarn.no_such_table"],
      });
    });
    expect(result?.reachable).toBe(false);
    expect(said).toContain("not readable by this role");
  });

  it("hands back a live pool when asked, and the caller can query through it", async () => {
    const { reachable, pool } = await pgReady({
      suite: "tests/pg-ready.test.ts",
      tables: ["spideryarn.articles"],
      keepPool: true,
    });
    expect(reachable).toBe(true);
    expect(pool).toBeDefined();
    const rows = await pool!.query<{ n: number }>("select 1 as n");
    expect(rows.rows[0]?.n).toBe(1);
    await pool!.end();
  });
});
