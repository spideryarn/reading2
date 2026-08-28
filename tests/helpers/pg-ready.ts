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
 * - `admin-store` also needs `auth.users` to be **readable**, which is a grant
 *   rather than a migration, and is the thing most likely to differ in prod;
 * - `db-transaction-errors` wants nothing but a live connection.
 *
 * Usage:
 *
 * ```ts
 * const { reachable } = await pgReady({ suite: "the Postgres comment store",
 *                                       tables: ["spideryarn.comments"] });
 * const when = reachable ? describe : describe.skip;
 * ```
 */
import type { Pool } from "pg";

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
 * Probe Postgres for this suite, warn if it is not there, and say so.
 *
 * Never throws: a probe that threw would take the whole file down, which is
 * louder than the situation warrants but also less informative than the warning.
 */
export async function pgReady(options: PgReadyOptions): Promise<PgReady> {
  const url = process.env.DATABASE_URL;
  /* No database configured at all — the fresh clone. Quiet on purpose. */
  if (!url) return { reachable: false, why: "DATABASE_URL is not set" };

  /* Imported here, not at the top, so a file with no DATABASE_URL never pays
     for loading `pg`. Every copy this replaces did the same. */
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: url,
    max: options.max ?? 1,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });

  let why = "";
  try {
    why = await missingThing(pool, options);
  } catch (err) {
    why = `could not reach it: ${(err as Error).message}`;
  }

  const reachable = why === "";
  if (!options.keepPool || !reachable) await pool.end();

  if (!reachable) {
    process.stderr.write(
      `\n  ⚠ ${options.suite}: DATABASE_URL is set but these tests are skipping: ${why}\n`,
    );
  }

  return {
    reachable,
    why,
    ...(options.keepPool && reachable ? { pool } : {}),
  };
}

/**
 * The first thing this suite needs that the database has not got, in words.
 *
 * Empty string means everything asked for is there. Naming the *specific*
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
async function missingThing(pool: Pool, options: PgReadyOptions): Promise<string> {
  /* A live connection, which is all `db-transaction-errors` wants, and which
     also separates "the server is down" from "the migration has not run". */
  await pool.query("select 1");

  for (const table of options.tables ?? []) {
    const probe = await pool.query<{ ready: boolean }>(
      "select to_regclass($1) is not null as ready",
      [table],
    );
    if (probe.rows[0]?.ready !== true) return `${table} is not there — run npm run db:migrate`;
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
      return `${table}.${column} is missing — run npm run db:migrate`;
    }
  }

  for (const table of options.readable ?? []) {
    /* A separate statement rather than another `exists`: existing and being
       readable are different failures, and only the second is a grant. */
    try {
      await pool.query(`select 1 from ${table} limit 1`);
    } catch (err) {
      return `${table} is not readable by this role: ${(err as Error).message}`;
    }
  }

  return "";
}

/** `spideryarn.articles` → `["spideryarn", "articles"]`. */
function splitTable(qualified: string): [string, string] {
  const at = qualified.indexOf(".");
  if (at < 0) return ["public", qualified];
  return [qualified.slice(0, at), qualified.slice(at + 1)];
}
