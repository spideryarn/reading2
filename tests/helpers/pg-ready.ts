/**
 * "Is this database migrated far enough for THIS suite?" — asked once, and
 * **fatal when the answer is no.**
 *
 * ## It used to be a skip, and since 2026-09-05 it is a failure
 *
 * The database was optional. Around thirty test files each hand-rolled a probe,
 * every one of them opted its own suite out with `describe.skip` when Postgres
 * was not there, and `npm test` printed a green tick over the half of the suite
 * that touches the store — *"the tests pass on the box"* saying nothing at all.
 * `REQUIRE_POSTGRES=1` turned that into a failure for the runs that cared, and
 * the default stayed a skip.
 *
 * There is one store since the hinge
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § F), so a machine with no database cannot run this application at all and a
 * suite that skips over that is describing a configuration that does not exist.
 * The database is now **required, unconditionally**:
 *
 * - `tests/setup/private-db-global.ts` fails the whole command **once**, before
 *   a single file is collected, when there is no stack to mint from. That is the
 *   preflight, and it is where a missing Docker is reported.
 * - this helper is the **per-suite** half: the stack is up, and the question left
 *   is whether *this* database has the table, column or grant this file needs. It
 *   throws, naming the thing and the command that fixes it.
 *
 * Nothing here returns a boolean any more, and **no caller gates a `describe` on
 * one**. `tests/one-store-only.test.ts` enforces that, because a
 * `reachable ? describe : describe.skip` reintroduced anywhere would take the
 * whole family of silent skips back with it.
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
 * The skip is gone and the reasoning is not: a ten-second budget is what stops a
 * busy box being reported as a broken migration.
 *
 * ## Why the caller must `await` this at module load
 *
 * Because the failure has to arrive before the suite is registered, and because
 * a suite whose fixtures reach the database in `beforeAll` would otherwise fail
 * with a connection error instead of an instruction. Call it with a top-level
 * `await`, at module scope, above the `describe`.
 *
 * ## Why it is parameterised rather than one check
 *
 * Because the suites differ in what "ready enough" means, and flattening that
 * away would trade one clear failure for a confusing one:
 *
 * - most want a **table** to exist (`to_regclass`);
 * - four want a specific **column**, because the migration that added it is the
 *   thing under test and a database one migration behind would otherwise fail
 *   with a confusing 42703 instead of "run npm run db:migrate";
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
 * await pgReady({ suite: "the Postgres comment store",
 *                 tables: ["spideryarn.comments"] });
 *
 * describe("…", () => { … });
 * ```
 *
 * docs/project/testing.md § When a skip is not acceptable.
 */
import type { Pool } from "pg";

/** A column the suite needs, named the way Postgres stores it (snake_case). */
export interface RequiredColumn {
  /** `schema.table`, e.g. `spideryarn.revision_blocks`. */
  table: string;
  column: string;
}

export interface PgReadyOptions {
  /** Named in the failure, so one line identifies the suite that could not run. */
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

/**
 * What a *successful* probe hands back — and it only ever returns successfully.
 *
 * There is no `reachable` and no `why`: an unusable database throws, so a caller
 * that gets a value back has one. That is the whole shape change of 2026-09-05,
 * and it is what makes `reachable ? describe : describe.skip` unwritable.
 */
export interface PgReady {
  /** Only when `keepPool`. The caller then owns it and must `end()` it. */
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

/** The failure text: what is missing, then what to run about it. */
export function requiredFailureMessage(suite: string, why: string, kind: MissingKind): string {
  return (
    `${suite} needs Postgres, and ${why}.\n\n` +
    `  ${FIX[kind]}\n\n` +
    `  This is a failure rather than a skip because there is one store and it is\n` +
    `  Postgres — a suite that opted itself out here would be describing a\n` +
    `  configuration this application no longer has.\n` +
    `  docs/project/testing.md § When a skip is not acceptable.`
  );
}

/**
 * Stop this suite, loudly, naming the missing thing and the command that fixes it.
 *
 * **It used to register a failing test and let the suite skip anyway** — one red
 * line and a skipped suite at the same time, which is the shape of report that
 * lets somebody read the red as noise. It throws at module scope now, so the
 * file fails to collect and the message is the only thing about it in the output.
 *
 * The suites that hand-roll their own probe — `tests/blocks-baseline.test.ts` and
 * the others that need a specific column and say so in their own words — call
 * this directly, so they refuse the same way the thirty-odd `pgReady` callers do.
 */
export function refusePostgres(suite: string, why: string, kind: MissingKind): never {
  throw new Error(requiredFailureMessage(suite, why, kind));
}

/**
 * Probe Postgres for this suite, and refuse to run it if the answer is no.
 *
 * **It throws.** A probe that returned a boolean is what let a hundred suites
 * opt themselves out of a run that printed green; there is one store now, and a
 * database this suite cannot use is a failure rather than a configuration.
 */
export async function pgReady(options: PgReadyOptions): Promise<PgReady> {
  const url = process.env.DATABASE_URL;
  if (!url) refusePostgres(options.suite, "DATABASE_URL is not set", "no-url");

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

  /* The pool is closed **before** the refusal, so neither road out of here leaks
     a connection — `refusePostgres` throws, and an earlier draft of this threw
     before the `end()`. */
  if (missing || !options.keepPool) await pool.end();
  if (missing) refusePostgres(options.suite, missing.why, missing.kind);

  return options.keepPool ? { pool } : {};
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
