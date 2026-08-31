/**
 * "Is Postgres up, and is it migrated far enough for THIS suite?" — once.
 *
 * Around thirty test files each hand-rolled this probe, and the copies drifted:
 * three were still on a two-second connect timeout, and five skipped without
 * saying a word. Both drifts are the same failure — a suite that opts itself
 * out and lets the run print a green tick for having checked nothing.
 * See docs/reusable/silent-success.md.
 *
 * ## Why ten seconds and not two
 *
 * Verbatim from tests/store-parity.test.ts:196-201, the file that learned it:
 *
 * > 10 seconds, not 2. At 2s this probe timed out under nothing worse than a
 * > dev server holding connections, and the whole suite skipped — inside a run
 * > that still printed a green "1103 passed". A parity suite that opts itself
 * > out when the machine is busy is worse than one that fails, because the
 * > signal it gives is indistinguishable from success.
 *
 * ## Why it warns, and why only sometimes
 *
 * Also verbatim, from the same file:
 *
 * > Said out loud. DATABASE_URL being SET and the database being unreachable is
 * > a different situation from having no database at all, and only the first
 * > one means somebody's Docker is off while they believe these ran.
 *
 * So: no `DATABASE_URL` is the fresh-clone-with-no-Docker case and stays quiet;
 * `DATABASE_URL` set and the probe failing gets one line on stderr naming the
 * suite that just opted out.
 *
 * **And it is `process.stderr.write`, not `console.warn`, which is not a style
 * choice.** Every copy this replaces used `console.warn`, and vitest's console
 * interception swallows a `console.warn` made at module load by a file whose
 * tests then all skip — measured on 2026-08-28 by pointing `DATABASE_URL` at a
 * refused port: the default reporter printed `1 skipped` and not one word of the
 * warning. So the "loud skip" the whole family was built around had been silent
 * under `npm test` the entire time, which is precisely the shape of thing
 * silent-success.md is about. `process.stderr.write` is not intercepted and does
 * print. (`--disableConsoleIntercept` or `--reporter=verbose` also surface a
 * `console.warn`, but nobody runs `npm test` that way.)
 *
 * ## Why the caller must `await` this at module load
 *
 * The skip has to be a real vitest skip, so the run reports "9 skipped" rather
 * than "9 passed". A flag set in `beforeAll` with every test returning early
 * reports **passed** — tests/db-schema.test.ts did exactly that, and was an
 * example in silent-success.md within four minutes of being written. Call this
 * with a top-level `await`, at module scope, above the `describe`.
 *
 * ## Why it is parameterised rather than one boolean
 *
 * Because the suites differ in what "ready enough" means, and flattening that
 * away would trade one silent skip for another:
 *
 * - most want a **table** to exist (`to_regclass`);
 * - four want a specific **column**, because the migration that added it is the
 *   thing under test and a database one migration behind would otherwise fail
 *   with a confusing column error instead of "run npm run db:migrate";
 * - one suite used to need `auth.users` **readable** and no longer does: the
 *   admin store asks the Auth service over HTTP instead, and leaving the
 *   requirement here made its tests skip under exactly the least-privileged
 *   role production uses (GPT Sol, 2026-08-28). `readable` stays because the
 *   distinction between "the table is there" and "this role may read it" is
 *   still the one most likely to differ in production;
 * - `db-transaction-errors` wants nothing but a live connection.
 *
 * Usage:
 *
 * ```ts
 * const { reachable } = await pgReady({ suite: "the Postgres comment store",
 *                                       tables: ["spideryarn.comments"] });
 * const when = reachable ? describe : describe.skip;
 * ```
 *
 * ## `REQUIRE_POSTGRES=1`, and why the skip is still the default
 *
 * Everything above stays true of a laptop, and none of it is true of a run whose
 * whole purpose is to prove a machine works. `npm test` is green with every
 * Postgres suite skipped, so "the tests pass on the box" says nothing about the
 * half of the suite that touches the database — `scripts/deploy.ts` names the
 * same hole as a deploy gate.
 *
 * So: set `REQUIRE_POSTGRES=1` and a skip becomes a **failure**. Not a throw at
 * module load, which fails the file with a stack trace and buries which suite
 * needed what; a real test, registered here, that fails with the missing thing
 * and the command that fixes it. The suite itself still skips — one clear red
 * beats thirty connection errors — so the run reports `1 failed | N skipped` and
 * exits non-zero.
 *
 * Unset, nothing changes: same verdict, same warning, same silence when there is
 * no `DATABASE_URL` at all. docs/project/testing.md § When a skip is not
 * acceptable.
 */
import type { Pool } from "pg";
import { describe, it } from "vitest";

/** A column the suite needs, named the way Postgres stores it (snake_case). */
export interface RequiredColumn {
  /** `schema.table`, e.g. `spideryarn.revision_blocks`. */
  table: string;
  column: string;
}

export interface PgReadyOptions {
  /** Named in the warning, so a skipped suite is identifiable from one line. */
  suite: string;
  /** Tables that must exist. `to_regclass`, so `schema.table`. */
  tables?: readonly string[];
  /** Columns that must exist — for a suite whose subject is one migration. */
  columns?: readonly RequiredColumn[];
  /** Tables the role must be able to `select` from. A grant, not a migration. */
  readable?: readonly string[];
  /** Pool size. Suites that query concurrently ask for more than one. */
  max?: number;
  /**
   * Hand the pool back instead of ending it, for the two suites that run their
   * own SQL through it. The caller then owns it and must `end()` it.
   */
  keepPool?: boolean;
}

export interface PgReady {
  /** True only if every check passed. The suite runs iff this is true. */
  reachable: boolean;
  /** Empty when reachable; otherwise what was missing, already warned about. */
  why: string;
  /** Only when `keepPool`, and only when a connection was attempted at all. */
  pool?: Pool;
}

/** 10s. See the header — this number is the whole reason the file exists. */
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Which of the four ways a database can be not-ready this is.
 *
 * Kept apart because the **fix** differs, and one message for all four would
 * send somebody to `db:migrate` when what is wrong is that Docker is off.
 */
export type MissingKind = "no-url" | "unreachable" | "migration" | "grant";

/** What to do about each, in one line. */
const FIX: Record<MissingKind, string> = {
  "no-url": "No DATABASE_URL. Link .env.local, then run: npm run db:start",
  unreachable: "Nothing answered on that DATABASE_URL. Run: npm run db:start",
  migration: "The database is up but behind the code. Run: npm run db:migrate",
  grant: "The table is there but this role cannot read it. A grant, not a migration.",
};

/**
 * Has this run declared that skipping Postgres is not an acceptable outcome?
 *
 * Exactly `"1"`, not "any non-empty value": an env var left as `REQUIRE_POSTGRES=0`
 * meaning "off" is a thing people write, and having it mean "on" would be its own
 * silent surprise.
 */
export function postgresRequired(): boolean {
  return process.env.REQUIRE_POSTGRES === "1";
}

/** The failure text: what is missing, then what to run about it. */
export function requiredFailureMessage(suite: string, why: string, kind: MissingKind): string {
  return (
    `${suite} needs Postgres, and ${why}.\n\n` +
    `  ${FIX[kind]}\n\n` +
    `  This is a failure rather than a skip because REQUIRE_POSTGRES=1 is set.\n` +
    `  docs/project/testing.md § When a skip is not acceptable.`
  );
}

/**
 * Under `REQUIRE_POSTGRES=1`, turn a skip into one failing test. Otherwise nothing.
 *
 * **Call it at module scope**, beside the `describe.skip` it accompanies — the
 * same place and for the same reason `pgReady` itself must be awaited there.
 * Vitest refuses to register a suite from inside a running test, so a call from
 * a `beforeAll` or an `it` throws rather than quietly registering nothing; the
 * catch below says which situation that is, because the bare vitest message
 * ("Calling the suite function inside test function is not allowed") does not
 * mention Postgres and would send the reader somewhere else entirely.
 *
 * The suites that hand-roll their own probe — `tests/blocks-baseline.test.ts` and
 * the others that need a specific column and say so in their own words — call
 * this directly, so `REQUIRE_POSTGRES=1` covers them too rather than covering
 * only the thirty-odd files that go through `pgReady`.
 */
export function failIfPostgresRequired(suite: string, why: string, kind: MissingKind): void {
  if (!postgresRequired()) return;
  const message = requiredFailureMessage(suite, why, kind);
  try {
    describe(`REQUIRE_POSTGRES=1 — ${suite}`, () => {
      it("has the Postgres it was told to require", () => {
        throw new Error(message);
      });
    });
  } catch (err) {
    throw new Error(
      `${message}\n\n  (and this could not be reported as a test failure, because ` +
        `failIfPostgresRequired was called from inside a running test rather than at ` +
        `module scope: ${(err as Error).message})`,
    );
  }
}

/**
 * Probe Postgres for this suite, warn if it is not there, and say so.
 *
 * Never throws: a probe that threw would take the whole file down, which is
 * louder than the situation warrants but also less informative than the warning.
 * The one exception is `REQUIRE_POSTGRES=1` from somewhere other than module
 * scope, where the failing test cannot be registered — see
 * `failIfPostgresRequired`, which explains itself in the message.
 */
export async function pgReady(options: PgReadyOptions): Promise<PgReady> {
  const url = process.env.DATABASE_URL;
  /* No database configured at all — the fresh clone. Quiet on purpose, and
     quiet still under REQUIRE_POSTGRES=1: the failing test is the loud part,
     and "these tests are skipping" would be a lie when they are about to fail. */
  if (!url) {
    const why = "DATABASE_URL is not set";
    failIfPostgresRequired(options.suite, why, "no-url");
    return { reachable: false, why };
  }

  /* Imported here, not at the top, so a file with no DATABASE_URL never pays
     for loading `pg`. Every copy this replaces did the same. */
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: url,
    max: options.max ?? 1,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });

  let missing: Missing | undefined;
  try {
    missing = await missingThing(pool, options);
  } catch (err) {
    missing = { kind: "unreachable", why: `could not reach it: ${(err as Error).message}` };
  }

  const reachable = missing === undefined;
  if (!options.keepPool || !reachable) await pool.end();

  /* The pool is closed first, so neither road out of here leaks a connection:
     `failIfPostgresRequired` throws in one case, and did so before the `end()`
     in an earlier draft of this. */
  if (missing) {
    if (postgresRequired()) failIfPostgresRequired(options.suite, missing.why, missing.kind);
    else {
      process.stderr.write(
        `\n  ⚠ ${options.suite}: DATABASE_URL is set but these tests are skipping: ${missing.why}\n`,
      );
    }
  }

  return {
    reachable,
    why: missing?.why ?? "",
    ...(options.keepPool && reachable ? { pool } : {}),
  };
}

/** The first thing the suite asked for that is not there, and which kind it is. */
interface Missing {
  kind: MissingKind;
  why: string;
}

/**
 * The first thing this suite needs that the database has not got, in words.
 *
 * `undefined` means everything asked for is there. Naming the *specific*
 * missing table or column rather than "the schema is not there" is the point:
 * the four column probes exist because a database one migration behind used to
 * fail with a confusing 42703 rather than an instruction.
 *
 * **`information_schema.columns` is privilege-filtered**, so a role that cannot
 * see a column gets the right verdict — skip — with the wrong reason attached,
 * "run npm run db:migrate", when the column is there and unreadable. Left as it
 * is because the test role here is the local superuser and the wrong-reason case
 * cannot arise; `pg_catalog.pg_attribute` is the fix if that ever changes,
 * because it tells physical absence from privilege. GPT Sol raised it,
 * 2026-08-28.
 */
async function missingThing(pool: Pool, options: PgReadyOptions): Promise<Missing | undefined> {
  /* A live connection, which is all `db-transaction-errors` wants, and which
     also separates "the server is down" from "the migration has not run". */
  await pool.query("select 1");

  for (const table of options.tables ?? []) {
    const probe = await pool.query<{ ready: boolean }>(
      "select to_regclass($1) is not null as ready",
      [table],
    );
    if (probe.rows[0]?.ready !== true) {
      return { kind: "migration", why: `${table} is not there — run npm run db:migrate` };
    }
  }

  for (const { table, column } of options.columns ?? []) {
    const [schema, name] = splitTable(table);
    const probe = await pool.query<{ ready: boolean }>(
      `select exists (
         select 1 from information_schema.columns
         where table_schema = $1 and table_name = $2 and column_name = $3
       ) as ready`,
      [schema, name, column],
    );
    if (probe.rows[0]?.ready !== true) {
      return { kind: "migration", why: `${table}.${column} is missing — run npm run db:migrate` };
    }
  }

  for (const table of options.readable ?? []) {
    /* A separate statement rather than another `exists`: existing and being
       readable are different failures, and only the second is a grant. */
    try {
      await pool.query(`select 1 from ${table} limit 1`);
    } catch (err) {
      return {
        kind: "grant",
        why: `${table} is not readable by this role: ${(err as Error).message}`,
      };
    }
  }

  return undefined;
}

/** `spideryarn.articles` → `["spideryarn", "articles"]`. */
function splitTable(qualified: string): [string, string] {
  const at = qualified.indexOf(".");
  if (at < 0) return ["public", qualified];
  return [qualified.slice(0, at), qualified.slice(at + 1)];
}
