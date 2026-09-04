/**
 * **A private Postgres database for one test run** — stage T-B of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
 * whose full design lives in
 * docs/plans/260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md.
 *
 * Read 260903e before changing anything here. The short version: `claim` takes
 * one global singleton row with `NOWAIT`, so **any** other process inside the
 * shared `postgres` database — another worktree's dev server, a browser tab
 * driving a real ingest — makes a job suite fail with `expected 'busy' to be
 * 'claimed'`. `tests/helpers/run-lock.ts` already excludes the peers that agree
 * to take a lock; a dev server never will. The only boundary that holds is a
 * database nobody else is inside.
 *
 * **Nothing in this file is wired into `npm test` yet.** Lanes are T-C and
 * activation is T-D. This stage exists so the factory can be wrong without
 * making the tree red for anybody else.
 *
 * ## The shape, and why each step is the shape it is
 *
 * 1. `CREATE DATABASE … TEMPLATE template0` — **not** the default `template1`,
 *    which is what PostgreSQL recommends as a restore target and what
 *    guarantees the target is empty.
 * 2. `pg_dump -s` of the shared `postgres` database, excluding `spideryarn`
 *    **and `spideryarn_migrations`**. Both, because the ledger schema is named
 *    in drizzle.config.ts and **there is no `drizzle` schema at all** — the
 *    spike's `-N drizzle` excluded nothing and handed the migrator a ledger it
 *    should have created itself. Verified against `pg_namespace`, 2026-09-03.
 * 3. Restore **fail-fast**: `pg_restore --exit-on-error --single-transaction`,
 *    with the dump's exit code and the restore's exit code checked separately.
 *    The spike judged this by grepping restore output for the word "error",
 *    which is not a restore that would have stopped
 *    (docs/reusable/silent-success.md).
 *
 *    **Measured 2026-09-03, because 260903e's gloss on this was wrong and the
 *    correction matters.** The plan said a default restore "continues past
 *    errors", implying it also exits 0. It does not: `pg_restore` exits 1
 *    whenever it ignored an error. What the two flags buy is **atomicity**, and
 *    that is worth having on its own. Restoring the real archive into a clone
 *    that already had an `auth` schema:
 *
 *    | | exit | `storage.buckets` afterwards |
 *    |---|---|---|
 *    | no flags | 1 | **present** — a half-restored database |
 *    | `--exit-on-error --single-transaction` | 1 | absent — the whole thing rolled back |
 *
 *    So the exit code is what *detects*, and the flags are what stop a detected
 *    failure leaving a plausible-looking clone behind for somebody to migrate.
 * 4. **Assert the baseline rather than assume it** — twice, and deliberately
 *    not from the same evidence. Once against the archive's own table of
 *    contents (`pg_restore -l`), before anything is restored; once against the
 *    live database afterwards, by asking `to_regclass` and `pg_extension`. A
 *    check that read only the archive would share its assumption with the dump.
 * 5. Then the **real migrator**, as a child process, judged by its own
 *    `Target:` line rather than by its exit code alone —
 *    docs/project/database.md § *`DATABASE_URL=… npm run db:migrate` does not
 *    do what it looks like*.
 *
 * ## Why the Postgres tools run inside the container
 *
 * There are **no `psql`/`pg_dump`/`pg_restore` binaries on this box's host** —
 * `command -v pg_dump` finds nothing, and the only copies are the ones inside
 * the Supabase container (PostgreSQL 17.6, `/nix/var/nix/profiles/default/bin`).
 * 260903e assumed host binaries; they are not there. Running them through
 * `docker exec` is not merely the available option, it is the better one:
 * client and server are then the same build by construction, so the
 * "pg_dump 15 refuses to dump a 17 server" failure cannot happen.
 *
 * The container is found by **matching the published port in `DATABASE_URL`**,
 * and then that match is *verified* by comparing `pg_control_system()`'s
 * `system_identifier` as seen over TCP from here with the one seen from inside
 * the container. Port-matching alone would be a guess that agrees with itself;
 * the system identifier is the same cluster or it is not.
 *
 * ## Why `supabase_admin` and not `postgres`
 *
 * The dump carries six event triggers (`pgrst_ddl_watch`,
 * `issue_pg_graphql_access`, …) and **`postgres` is not a superuser on a
 * Supabase stack**, so restoring them as `postgres` fails — and with
 * `--exit-on-error --single-transaction` that correctly takes the whole restore
 * down. `supabase_admin` is the superuser and restores them cleanly. The
 * database itself is then owned by `postgres` (`OWNER postgres`), matching the
 * shared `postgres` database, so the migrator — which connects as `postgres` —
 * can create the `spideryarn` schema.
 *
 * The event triggers are retained deliberately (260903e called this "the
 * speculative part", to be settled by inspecting the archive list), and the
 * set of them is **asserted** rather than inspected once — see
 * `REVIEWED_EVENT_TRIGGERS`, which also records what each of the six does.
 *
 * ## The ordering trap
 *
 * src/env.ts snapshots the environment at module load and then lets
 * `.env.local` win *unless the value differs from that snapshot*. So a
 * **script** must set `DATABASE_URL` before src/env.ts is first imported, and a
 * vitest **setup file** must set it after. Get either backwards and
 * `.env.local` silently restores the shared database while everything reports
 * success. This file sidesteps it entirely by passing the URL to the migrator
 * as a child process's environment (where it is genuinely inherited) and then
 * reading back the `Target:` line the migrator prints.
 *
 * `baseUrl()` is memoised for the same reason in reverse: T-D's setup file will
 * overwrite `process.env.DATABASE_URL` with the private database, and a
 * scavenger that then asked "which database am I connected to" would go looking
 * for stale databases inside the one it just made.
 *
 * ## Usage
 *
 *     npx tsx scripts/db-test-create.ts                     # create one, print its name
 *     npx tsx scripts/db-test-create.ts --url-file /tmp/u   # …and write the URL there
 *     npx tsx scripts/db-test-create.ts --drop <name>       # drop one
 *     npx tsx scripts/db-test-create.ts --scavenge          # drop stale ones, safely
 *     npx tsx scripts/db-test-create.ts --scavenge --dry-run
 *
 * ## Two ways a database here gets dropped, and they are not interchangeable
 *
 * `dropTestDatabase` is **teardown by the run that owns the name** and uses
 * `WITH (FORCE)`. `dropStaleTestDatabase` is **scavenging something nobody
 * claims** and never forces, so a late connection makes Postgres refuse and the
 * database survives. Each says why at its own definition; the difference is the
 * whole safety argument and neither should be read without the other.
 */

import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

import { Pool } from "pg";

import { isLocalDatabaseUrl, sslDecisionFor, withoutPassword } from "../src/db/ssl.js";
import { resolveTargetUrl } from "../src/env.js";
import { isMain } from "../src/is-main.js";
import { expectedMigrations } from "./migration-ledger.js";

const run = promisify(execFile);

/**
 * **Every name this file will create, drop or even consider begins here.**
 *
 * It is the *start* of the fence, not the whole of it: a name reaches
 * `CREATE`/`DROP DATABASE` as an interpolated identifier, and `startsWith` says
 * nothing about the rest of the string. `assertMintedName` is the fence, and it
 * requires the whole minted shape. There is deliberately no way to configure
 * this — see `assertMintedName` for the hole that had.
 */
export const TEST_DB_PREFIX = "spideryarn_test_";

/** Postgres truncates a longer identifier silently, which is its own trap. */
const MAX_IDENTIFIER = 63;

/** The superuser that can restore event triggers. See the header. */
const RESTORE_ROLE = "supabase_admin";

/** The role the app and the migrator connect as, and so the clone's owner. */
const OWNER_ROLE = "postgres";

/** Schemas the clone must NOT carry in: the migrator's job, not the dump's. */
export const EXCLUDED_SCHEMAS = ["spideryarn", "spideryarn_migrations"] as const;

/**
 * What a restored-but-unmigrated clone must have before the migrator touches it.
 *
 * `auth.users` because six migrations declare hard foreign keys into it, and
 * `tests/helpers/seed-auth-user.ts` inserts into it directly. The extensions
 * because `pgcrypto`'s `gen_random_uuid()` and `uuid-ossp` appear in defaults.
 */
export const REQUIRED_TABLES = ["auth.users"] as const;
export const REQUIRED_EXTENSIONS = ["pgcrypto", "uuid-ossp", "plpgsql"] as const;

/* ------------------------------------------------------------------ naming */

/**
 * `spideryarn_test_<yyMMddHHmmss>_<uuid>` — **per run, not per worktree.**
 *
 * 260903e settled that fork and Sol's review is why: two `npm test` invocations
 * inside one worktree would share rows and migrations, and `fileParallelism:
 * false` serialises files within one invocation, not across processes.
 *
 * The timestamp is **UTC**, and it is in the name because the scavenger has
 * nothing else to date a database by — Postgres does not record when a database
 * was created. `parseTestDatabaseName` is the only reader of it, and a name it
 * cannot parse is spared rather than dropped.
 */
export function testDatabaseName(now: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp =
    p(now.getUTCFullYear() % 100) +
    p(now.getUTCMonth() + 1) +
    p(now.getUTCDate()) +
    p(now.getUTCHours()) +
    p(now.getUTCMinutes()) +
    p(now.getUTCSeconds());
  const name = `${TEST_DB_PREFIX}${stamp}_${randomUUID().replaceAll("-", "")}`;
  /* Belt and braces on a name whose parts are all fixed-width: the quiet
     version of this is Postgres truncating the uuid at 63 **bytes** and two
     runs colliding on one database. `Buffer.byteLength`, not `.length`, because
     the limit is bytes and a JS string counts UTF-16 code units. */
  if (Buffer.byteLength(name, "utf8") > MAX_IDENTIFIER) {
    throw new Error(
      `test database name is ${Buffer.byteLength(name, "utf8")} bytes, over Postgres's ${MAX_IDENTIFIER}: ${name}`,
    );
  }
  return name;
}

/**
 * When the run that made this database started, or `null` if this is not one of
 * ours.
 *
 * **`null` is the safe answer and the scavenger treats it as "spare it".** A
 * database whose age cannot be established is never old enough to drop —
 * `spideryarn_test_spike`, left behind by 260903e's spike, is exactly such a
 * name and it must survive a scavenge rather than be swept up by a prefix match.
 */
export function parseTestDatabaseName(name: string): Date | null {
  if (!name.startsWith(TEST_DB_PREFIX)) return null;
  const rest = name.slice(TEST_DB_PREFIX.length);
  const m = /^(\d{12})_[0-9a-f]{32}$/.exec(rest);
  if (!m?.[1]) return null;
  const s = m[1];
  const n = (from: number, len = 2) => Number(s.slice(from, from + len));
  const when = new Date(
    Date.UTC(2000 + n(0), n(2) - 1, n(4), n(6), n(8), n(10)),
  );
  /* Round-trip, so `991399235999` is rejected rather than silently rolled
     forward by Date.UTC into some other month. */
  if (Number.isNaN(when.getTime())) return null;
  const back = testStampOf(when);
  return back === s ? when : null;
}

function testStampOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    p(d.getUTCFullYear() % 100) +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds())
  );
}
/**
 * Refuse any name this file did not mint, **before** it reaches the SQL.
 *
 * `CREATE DATABASE` and `DROP DATABASE` take no bound parameters, so the name
 * is interpolated into a quoted identifier. The prefix fence alone does not
 * make that safe: it constrains how a name *starts* and says nothing about the
 * rest, so `spideryarn_test_a"; …` closes the identifier and the statement, and
 * the string reaches the parser as two statements rather than one.
 *
 * **Watched happening, 2026-09-03.** `dropTestDatabase` with that name came
 * back `DROP DATABASE cannot run inside a transaction block` — which is
 * Postgres refusing the *chained* form, not this file refusing the input. That
 * refusal is a happy accident of `DROP DATABASE` being non-transactional, it
 * belongs to Postgres rather than to us, and it would not cover an
 * interpolation site whose first statement is an ordinary one. So the check
 * lives here instead, where it is ours.
 *
 * The shape is the whole name — the fixed prefix, a twelve-digit stamp, an
 * underscore, thirty-two hex — which is exactly what `parseTestDatabaseName`
 * accepts, so there is one definition of "one of ours" rather than two that can
 * drift.
 *
 * **There is no configurable prefix, deliberately.** There was one until
 * 2026-09-03, and GPT Sol found the hole in it: `parseTestDatabaseName(name,
 * prefix)` stripped the caller's prefix *before* validating the rest, and the
 * only guard on the prefix itself was that it began with `spideryarn_test_`. So
 * `spideryarn_test_x"; select 1; --` was a legal prefix and a name built on it
 * passed the whole shape check. The parameter had no caller in the repo and its
 * only justification was the fence that existed because it existed. Deleting it
 * removed the injection surface rather than patching it.
 *
 * **A legacy name is refused too**, `spideryarn_test_spike` included: it
 * carries no readable creation time, the scavenger already spares it for that
 * reason, and dropping one is a deliberate act for a human at a psql prompt.
 */
export function assertMintedName(name: string, verb: string): void {
  if (!name.startsWith(TEST_DB_PREFIX)) {
    throw new Error(
      `refusing to ${verb} "${name}": it is not one of ours (expected ${TEST_DB_PREFIX}…)`,
    );
  }
  if (parseTestDatabaseName(name) === null) {
    throw new Error(
      `refusing to ${verb} "${name}": it carries the prefix but is not a name this file mints ` +
        `(${TEST_DB_PREFIX}<12 digits>_<32 hex>). The name goes into the SQL as an identifier, so a ` +
        `prefix match is not enough on its own.`,
    );
  }
  /* Unreachable through the shape check above, which admits only ASCII, and
     kept anyway: this is the last thing between a caller-supplied string and an
     interpolated identifier, and a shape check that is relaxed one day should
     not silently take the length check with it. */
  if (Buffer.byteLength(name, "utf8") > MAX_IDENTIFIER) {
    throw new Error(
      `refusing to ${verb} "${name}": ${Buffer.byteLength(name, "utf8")} bytes, over Postgres's ${MAX_IDENTIFIER}`,
    );
  }
}

/**
 * **There is no local stack at all** — as distinct from every other way this
 * file can fail.
 *
 * The one caller that cares is the private lane's `globalSetup`
 * (`tests/setup/private-db-global.ts`), which turns "Docker is off" into a
 * skip so that `npm test` on a laptop with no container is not a wall of red.
 * Until 2026-09-04 it made that decision on `catch (err)` — *any* error — so a
 * failed dump, a failed restore, a cluster-identity mismatch and a failed
 * migration were all silently reported as "Docker is off" and every Postgres
 * suite skipped. That is a silent-success generator of exactly the kind
 * docs/reusable/silent-success.md is about: the suite goes green having tested
 * nothing, and the one line of output says something that is not true. GPT Sol
 * found it reviewing T-D.
 *
 * So the skip is now **positively classified**: only the three places that can
 * mean nothing but "the stack is not running" raise this, and everything else
 * stays an ordinary `Error` and is fatal.
 *
 * - `baseUrl()` — no `DATABASE_URL` at all (a fresh clone; `pgReady` treats it
 *   the same way). *Not* the non-local refusal beside it, which is a
 *   misconfiguration and must be loud.
 * - `findPostgresContainer()` — Docker will not answer, or nothing is
 *   publishing the stack's port.
 * - `assertSameCluster()` — the first TCP connection is refused. Only at the
 *   socket level: an authentication failure means the server is there and
 *   something else is wrong.
 */
export class StackUnreachable extends Error {
  override name = "StackUnreachable";
}

/**
 * Socket-level failure codes, which mean *nothing answered*.
 *
 * Deliberately not a catch-all. `pg` puts the SQLSTATE in `code` too, so
 * `28P01` (bad password) and `3D000` (no such database) arrive through the same
 * field and must stay fatal — the server answered, and it said no.
 */
const NOT_LISTENING = new Set(["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"]);

/** Was this thrown by a socket that never reached a server? */
export function isNotListening(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && NOT_LISTENING.has(code);
}

/* ------------------------------------------------------- where we connect */

let memoisedBase: string | undefined;

/**
 * The **shared** database's URL, captured once.
 *
 * Memoised on purpose: T-D's vitest setup file will overwrite
 * `process.env.DATABASE_URL` with the private database it just made, and every
 * later call here — `drop`, the scavenger — must still mean the shared one.
 */
export function baseUrl(): string {
  if (memoisedBase !== undefined) return memoisedBase;
  const url = resolveTargetUrl({ shellWins: true });
  if (!url) {
    throw new StackUnreachable(
      "DATABASE_URL is not set, so there is no local stack to make a test database on.\n" +
        "  Run: npm run db:start   (docs/project/supabase-local.md)",
    );
  }
  /**
   * **The one refusal that is not negotiable.** CLAUDE.md: real data belongs to
   * the reader. This file creates and drops databases; there is no
   * `--allow-remote` and there will not be one.
   */
  if (!isLocalDatabaseUrl(url)) {
    throw new Error(
      `refusing to build a test database anywhere but the local stack: ${withoutPassword(url) ?? "(unparsable)"}`,
    );
  }
  memoisedBase = url;
  return url;
}

/** `baseUrl()` with the database name swapped. Everything else is preserved. */
export function urlForDatabase(name: string, base: string = baseUrl()): string {
  const u = new URL(base);
  u.pathname = `/${name}`;
  return u.toString();
}

function poolFor(url: string): Pool {
  return new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 10_000,
    ssl: sslDecisionFor(url).ssl,
  });
}

/* ------------------------------------------------------ the container seam */

/**
 * The Docker container running the Postgres that `DATABASE_URL` points at.
 *
 * Found by published port, then **proved** by system identifier — see the
 * header. Returns the name; throws with the whole `docker ps` line-up when the
 * match is not exactly one.
 */
export async function findPostgresContainer(base: string = baseUrl()): Promise<string> {
  const port = new URL(base).port || "5432";
  let out: string;
  try {
    ({ stdout: out } = await run("docker", ["ps", "--format", "{{.Names}}\t{{.Ports}}"]));
  } catch (err) {
    throw new StackUnreachable(
      `could not ask Docker which container serves port ${port}: ${(err as Error).message}\n` +
        "  This box has no psql/pg_dump on the host, so the Supabase container is the only\n" +
        "  place those binaries exist. See this file's header.",
    );
  }
  const lines = out.split("\n").filter((l) => l.trim() !== "");
  const hits = lines
    .filter((l) => l.includes(`:${port}->5432/tcp`))
    .map((l) => l.split("\t")[0] ?? "");
  if (hits.length !== 1 || !hits[0]) {
    /* **`StackUnreachable` even when it found several.** Zero is the stack
       being off, which is the case this classification exists for; more than
       one is two stacks publishing the same port, which cannot happen on one
       host. Either way nothing here can proceed and neither is a broken clone. */
    throw new StackUnreachable(
      `expected exactly one Docker container publishing port ${port} to 5432, found ${hits.length}.\n` +
        lines.map((l) => `    ${l}`).join("\n"),
    );
  }
  return hits[0];
}

/** What one `docker exec` did. **`code` is the thing callers must read.** */
export interface ExecResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

/**
 * `docker exec` into the stack's Postgres, with the given argv.
 *
 * `spawn` rather than `execFile`, because `execFile` has no way to write to a
 * child's stdin and the restore is fed its archive that way. It also means the
 * **exit code is returned rather than thrown**, which is the whole point of
 * this stage: every caller reads `code` explicitly, so "the restore continued
 * past errors and exited 0" and "the dump failed and the pipeline swallowed it"
 * are both statements somebody had to write down rather than forget.
 */
async function inContainer(
  container: string,
  argv: readonly string[],
  input?: Buffer,
): Promise<ExecResult> {
  const args = input ? ["exec", "-i", container, ...argv] : ["exec", container, ...argv];
  return await new Promise<ExecResult>((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString("utf8"),
      }),
    );
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

/** The last few lines of stderr, which is where a Postgres tool says why. */
function tail(stderr: string, lines = 4): string {
  return stderr.split("\n").filter(Boolean).slice(-lines).join(" | ");
}

/**
 * Is the container we found actually the server `DATABASE_URL` reaches?
 *
 * The port match is a guess that agrees with itself. `system_identifier` is a
 * 64-bit number minted by `initdb` for one cluster: if the two differ, we would
 * be dumping one server's schema into another server's database and every later
 * check would be measuring the wrong thing.
 */
export function clusterMismatch(
  container: string,
  overTcp: string,
  inside: string,
): string | null {
  if (overTcp && overTcp === inside) return null;
  return (
    `container ${container} is not the server DATABASE_URL reaches — ` +
    `system_identifier over TCP is ${overTcp || "(nothing)"}, ` +
    `inside the container ${inside || "(nothing)"}`
  );
}

export async function assertSameCluster(container: string, base: string = baseUrl()): Promise<void> {
  const pool = poolFor(base);
  let overTcp: string;
  try {
    const r = await pool.query<{ id: string }>(
      "select system_identifier::text as id from pg_control_system()",
    );
    overTcp = r.rows[0]?.id ?? "";
  } catch (err) {
    /* **The first connection this file opens**, so a refusal here is the stack
       being off rather than anything about the clone. Socket codes only —
       `isNotListening` says why an authentication failure must stay fatal. */
    if (isNotListening(err)) {
      throw new StackUnreachable(
        `nothing answered at the local stack's Postgres: ${(err as Error).message}\n` +
          "  Run: npm run db:start   (docs/project/supabase-local.md)",
      );
    }
    throw err;
  } finally {
    await pool.end();
  }
  const said = await inContainer(container, [
    "psql",
    "-U",
    OWNER_ROLE,
    "-d",
    "postgres",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-At",
    "-c",
    "select system_identifier::text from pg_control_system()",
  ]);
  if (said.code !== 0) {
    throw new Error(`psql inside ${container} exited ${said.code}: ${tail(said.stderr)}`);
  }
  const inside = said.stdout.toString("utf8").trim();
  const wrong = clusterMismatch(container, overTcp, inside);
  if (wrong) throw new Error(wrong);
}

/**
 * Run one statement inside a database **as the superuser**.
 *
 * Exists for one reason and it is worth naming: the tests have to break a clone
 * on purpose — drop `auth.users`, plant a `spideryarn` schema — and `postgres`
 * is not a superuser on a Supabase stack, so `drop table auth.users` from an
 * ordinary connection fails with *"must be owner of table users"* before the
 * check under test is ever reached. A control that dies of its own arrangements
 * is indistinguishable from one that never ran (docs/reusable/silent-success.md
 * § four ways a control lies), so the arrangement gets the privilege it needs.
 *
 * Nothing in the production path calls this.
 */
export async function psqlAsSuperuser(
  container: string,
  database: string,
  sql: string,
): Promise<void> {
  const said = await inContainer(container, [
    "psql",
    "-U",
    RESTORE_ROLE,
    "-d",
    database,
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);
  if (said.code !== 0) {
    throw new Error(`psql exited ${said.code} in ${database}: ${tail(said.stderr)}`);
  }
}

/* ------------------------------------------------------- dump and restore */

/**
 * A schema-only custom-format archive of the shared database, as bytes.
 *
 * Bytes rather than a file inside the container, for three reasons: there is
 * nothing to clean up, the dump's exit code is checked on its own rather than
 * being swallowed by a pipeline, and a test can corrupt the buffer to prove the
 * restore really does refuse.
 */
export async function dumpSharedSchema(container: string): Promise<Buffer> {
  const argv = [
    "pg_dump",
    "-U",
    RESTORE_ROLE,
    "-d",
    "postgres",
    "--schema-only",
    "--format=custom",
    ...EXCLUDED_SCHEMAS.flatMap((s) => ["-N", s]),
  ];
  const said = await inContainer(container, argv);
  /* **Its exit code, not a grep of its output.** The spike judged the restore
     by grepping for the word "error"; a tool that fails and says so in words
     you did not think of is indistinguishable from one that succeeded. */
  if (said.code !== 0) {
    throw new Error(`pg_dump exited ${said.code}: ${tail(said.stderr)}`);
  }
  if (said.stdout.length === 0) {
    throw new Error("pg_dump exited 0 and wrote nothing, which is not a schema");
  }
  return said.stdout;
}

/**
 * The archive's own table of contents, as `pg_restore -l` prints it.
 *
 * Read *before* the restore, so a dump that already carries `spideryarn` is
 * caught before it can be blamed on the migrator.
 */
export async function archiveList(container: string, dump: Buffer): Promise<string> {
  const said = await inContainer(container, ["pg_restore", "-l"], dump);
  if (said.code !== 0) {
    throw new Error(`pg_restore -l exited ${said.code} — this is not a readable archive: ${tail(said.stderr)}`);
  }
  return said.stdout.toString("utf8");
}

/**
 * What is wrong with this archive, in words. Empty means nothing is.
 *
 * Pure, over the text, so the cases that must never happen can be tested
 * without arranging a database that has them.
 */
export function archiveProblems(list: string): string[] {
  const problems: string[] = [];
  if (list.trim() === "") return ["the archive's table of contents is empty"];
  for (const schema of EXCLUDED_SCHEMAS) {
    /* `\b` on a name ending in a letter does not match inside
       `spideryarn_migrations`, because `_` is a word character — so the two
       exclusions produce two independent verdicts rather than one complaining
       twice. */
    const re = new RegExp(`\\b${schema}\\b`);
    if (re.test(list)) problems.push(`the archive carries ${schema}, which the migrator must create`);
  }
  /* The shapes `pg_restore -l` actually prints, taken from a real archive on
     2026-09-03 rather than from memory:
         25; 2615 16457 SCHEMA - auth supabase_admin
         245; 1259 16458 TABLE auth users supabase_auth_admin
         3; 3079 16406 EXTENSION - pgcrypto
     Deliberately not `/\busers\b/`, which the ACL and COMMENT lines also match
     and which would stay green on an archive that carried no table at all —
     docs/reusable/silent-success.md § a negative assertion with too long a
     needle, in the positive direction. */
  if (!/^\d+;.* SCHEMA - auth /m.test(list)) problems.push("the archive has no auth schema");
  if (!/^\d+;.* TABLE auth users /m.test(list)) problems.push("the archive has no auth.users table");
  for (const ext of ARCHIVE_EXTENSIONS) {
    if (!new RegExp(`^\\d+;.* EXTENSION - ${ext}\\s*$`, "m").test(list)) {
      problems.push(`the archive declares no ${ext} extension`);
    }
  }
  const triggers = eventTriggersIn(list);
  const reviewed = new Set<string>(REVIEWED_EVENT_TRIGGERS);
  const surprises = triggers.filter((t) => !reviewed.has(t));
  if (surprises.length > 0) {
    problems.push(
      `the archive carries event trigger(s) nobody has reviewed: ${surprises.join(", ")} — ` +
        "these are restored as superuser and fire on our migrations' DDL. Read what they do, " +
        "then add them to REVIEWED_EVENT_TRIGGERS in scripts/db-test-create.ts",
    );
  }
  for (const t of REVIEWED_EVENT_TRIGGERS) {
    if (!triggers.includes(t)) problems.push(`the archive is missing event trigger ${t}`);
  }
  return problems;
}

/**
 * The extensions the *archive* must declare — a shorter list than
 * `REQUIRED_EXTENSIONS`, because `plpgsql` comes with `template0` and so is
 * never in a dump. The live baseline checks all of them.
 */
const ARCHIVE_EXTENSIONS = ["pgcrypto", "uuid-ossp"] as const;

/**
 * **The event triggers this clone is allowed to carry, reviewed one by one.**
 *
 * `pg_dump -s` brings event triggers across and `pg_restore` runs them in as
 * `supabase_admin`, so these are **superuser-restored executable objects** that
 * fire on our migrations' DDL. Retaining them is the right call and it was made
 * by reading what each one does, not by leaving the default alone:
 *
 * | trigger | what it does on our migrations |
 * |---|---|
 * | `pgrst_ddl_watch`, `pgrst_drop_watch` | `NOTIFY pgrst, 'reload schema'` — nothing in the clone listens |
 * | `issue_pg_graphql_access` | on `CREATE EXTENSION pg_graphql`: grants and recreates a resolver |
 * | `issue_graphql_placeholder` | on `DROP EXTENSION pg_graphql`: puts the placeholder function back |
 * | `issue_pg_cron_access` | on `CREATE EXTENSION pg_cron`: grants on the `cron` schema |
 * | `issue_pg_net_access` | on `CREATE EXTENSION pg_net`: creates a role and grants on it |
 *
 * **The last four are dormant rather than harmless**, and the earlier version
 * of this comment said "a NOTIFY nobody listens for" of all six, which was
 * wrong — GPT Sol, 2026-09-03. They are dormant because our migration files
 * create and drop no extensions at all; that is a property of `drizzle/`, not
 * of the triggers, and it is the reason this list is checked rather than
 * assumed.
 *
 * **So the set is asserted, not merely inspected once.** If the shared stack
 * acquires a seventh, a Supabase upgrade has added a superuser-restored trigger
 * to every test database and nobody has read it. That is worth stopping a run
 * for: the fix is one line here, after somebody looks at what it does. The
 * alternative — softening the claim to "whatever the shared database currently
 * carries" — buys convenience by giving up the only moment anybody would look.
 */
export const REVIEWED_EVENT_TRIGGERS = [
  "issue_graphql_placeholder",
  "issue_pg_cron_access",
  "issue_pg_graphql_access",
  "issue_pg_net_access",
  "pgrst_ddl_watch",
  "pgrst_drop_watch",
] as const;

/** The event triggers named in a `pg_restore -l` table of contents. */
export function eventTriggersIn(list: string): string[] {
  const found: string[] = [];
  for (const line of list.split("\n")) {
    const m = /^\d+;.* EVENT TRIGGER - (\S+) /.exec(line);
    if (m?.[1]) found.push(m[1]);
  }
  return found.sort();
}

/**
 * Restore into `database`, or throw.
 *
 * **Both halves matter and they are different halves.** The non-zero exit code
 * is what detects a failure — `pg_restore` returns 1 whenever it ignored an
 * error, so the grep the spike used was never necessary. `--exit-on-error` and
 * `--single-transaction` are what stop the *detected* failure from leaving a
 * half-restored database behind: measured on 2026-09-03, a default restore into
 * a clone that already had an `auth` schema exited 1 having created
 * `storage.buckets` anyway, and the same restore with the flags created nothing.
 * A half-restored clone is the dangerous artefact, because it looks migratable.
 */
export async function restoreInto(
  container: string,
  database: string,
  dump: Buffer,
): Promise<void> {
  const said = await inContainer(
    container,
    ["pg_restore", "-U", RESTORE_ROLE, "-d", database, "--exit-on-error", "--single-transaction"],
    dump,
  );
  if (said.code !== 0) {
    throw new Error(`pg_restore exited ${said.code} restoring ${database}: ${tail(said.stderr)}`);
  }
}

/** An `execFile` rejection, in one line, with the tool's own last words. */
function describe(err: unknown): string {
  const e = err as { code?: unknown; stderr?: unknown; message?: string };
  const stderr =
    e.stderr instanceof Buffer ? e.stderr.toString("utf8") : typeof e.stderr === "string" ? e.stderr : "";
  const last = tail(stderr);
  return `exit ${String(e.code ?? "?")}${last ? ` — ${last}` : ` — ${e.message ?? String(err)}`}`;
}

/* -------------------------------------------------------------- baselines */

/** What a restored clone looks like, asked of the clone itself. */
export interface Baseline {
  schemasPresent: string[];
  tablesPresent: string[];
  extensionsPresent: string[];
}

export async function probeBaseline(url: string): Promise<Baseline> {
  const pool = poolFor(url);
  try {
    const schemas = await pool.query<{ n: string }>(
      "select nspname as n from pg_namespace where nspname = any($1::text[])",
      [[...EXCLUDED_SCHEMAS]],
    );
    const tables = await pool.query<{ n: string }>(
      "select t as n from unnest($1::text[]) t where to_regclass(t) is not null",
      [[...REQUIRED_TABLES]],
    );
    const exts = await pool.query<{ n: string }>("select extname as n from pg_extension");
    return {
      schemasPresent: schemas.rows.map((r) => r.n),
      tablesPresent: tables.rows.map((r) => r.n),
      extensionsPresent: exts.rows.map((r) => r.n),
    };
  } finally {
    await pool.end();
  }
}

/**
 * What is wrong with this baseline, in words. Empty means nothing is.
 *
 * Separated from the probe so both halves can be watched failing: the probe
 * against a database with `auth.users` really dropped, and this against a
 * hand-written `Baseline` that omits it.
 */
export function baselineProblems(b: Baseline): string[] {
  const problems: string[] = [];
  for (const s of b.schemasPresent) {
    problems.push(`${s} exists in the clone, but the migrator must be the thing that creates it`);
  }
  for (const t of REQUIRED_TABLES) {
    if (!b.tablesPresent.includes(t)) {
      problems.push(`${t} is missing — migrations declare foreign keys into it and will fail`);
    }
  }
  for (const e of REQUIRED_EXTENSIONS) {
    if (!b.extensionsPresent.includes(e)) problems.push(`extension ${e} is missing`);
  }
  return problems;
}

/* -------------------------------------------------------- the real thing */

export interface TestDatabase {
  name: string;
  /** A full connection URL. Carries the local password; do not log it. */
  url: string;
  /** `DROP DATABASE … WITH (FORCE)`. Safe to call twice. */
  drop(): Promise<void>;
}

export interface CreateOptions {
  /** Skip the migrator — for the tests that are about the restore, not the schema. */
  migrate?: boolean;
  /** Corrupt or substitute the dump. Tests only; see `restore refuses on error`. */
  dumpOverride?: (dump: Buffer) => Buffer | Promise<Buffer>;
  /** Called after the restore, before the baseline check. Tests break clones here. */
  afterRestore?: (where: { url: string; name: string; container: string }) => Promise<void>;
  onProgress?: (line: string) => void;
}

/**
 * Build one, or throw having cleaned up after itself.
 *
 * Every failure path drops the half-built database. A leaked clone is not a
 * disaster — the scavenger takes it eventually — but leaving one behind on
 * every failed run turns a bug in this file into a slowly filling disk.
 */
export async function createTestDatabase(options: CreateOptions = {}): Promise<TestDatabase> {
  const base = baseUrl();
  const say = options.onProgress ?? (() => {});

  const container = await findPostgresContainer(base);
  await assertSameCluster(container, base);
  say(`container ${container}`);

  const name = testDatabaseName();
  /**
   * **Inside the fence, not before it.** `createEmptyDatabase` can fail *after*
   * its `CREATE DATABASE` has committed — the pool's `end()` in its own
   * `finally` is the shortest example, and a server that goes away between the
   * two is the realistic one. Outside this `try` that leaves a database nobody
   * holds and nobody drops, surviving until the six-hour scavenger; inside it,
   * the `catch` drops it like every other failure. GPT Sol, 2026-09-04.
   *
   * `dropTestDatabase` on a name that was never created is a no-op wrapped in
   * `.catch(() => {})`, so moving the *whole* creation in is safe rather than
   * only the half after the statement.
   */
  let url = "";
  try {
    url = await createEmptyDatabase(name, base);
    say(`created ${name}`);

    let dump = await dumpSharedSchema(container);
    if (options.dumpOverride) dump = await options.dumpOverride(dump);

    const problems = archiveProblems(await archiveList(container, dump));
    if (problems.length > 0) {
      throw new Error(`the schema dump is not the baseline this expects:\n  • ${problems.join("\n  • ")}`);
    }

    await restoreInto(container, name, dump);
    say(`restored (${dump.length} bytes of archive)`);

    if (options.afterRestore) await options.afterRestore({ url, name, container });

    const bad = baselineProblems(await probeBaseline(url));
    if (bad.length > 0) {
      throw new Error(`${name} is not the baseline a migration run needs:\n  • ${bad.join("\n  • ")}`);
    }

    if (options.migrate !== false) {
      await migrateInto(name, url);
      say("migrated");
    }
  } catch (err) {
    await dropTestDatabase(name).catch(() => {});
    throw err;
  }

  return {
    name,
    url,
    drop: () => dropTestDatabase(name),
  };
}

/**
 * An empty database from `template0`, and nothing else in it.
 *
 * **`template0`, not the default `template1`** — PostgreSQL recommends it as a
 * restore target precisely because it is guaranteed empty, and anything anybody
 * has ever installed into `template1` on this stack would otherwise arrive here
 * as a conflict during the restore.
 *
 * Separate from `createTestDatabase` so the restore can be tested against a
 * bare database without also testing the dump, the baseline and the migrator.
 */
export async function createEmptyDatabase(
  name: string,
  base: string = baseUrl(),
): Promise<string> {
  assertMintedName(name, "create");
  const admin = poolFor(base);
  try {
    /* Identifier interpolation, because CREATE DATABASE takes no parameters.
       Safe because `assertMintedName` above has just checked the *whole* name
       against the shape this file mints, not merely its prefix — see there for
       why the prefix on its own was not enough. */
    await admin.query(`create database "${name}" owner "${OWNER_ROLE}" template template0`);
  } finally {
    await admin.end();
  }
  return urlForDatabase(name, base);
}

/**
 * Run the **real** migrator against the clone, and believe its `Target:` line
 * rather than its exit code.
 *
 * A child process, so `DATABASE_URL` is genuinely inherited and
 * `resolveTargetUrl({ shellWins: true })` prefers it over `.env.local` — the
 * ordering trap in the header, arranged so it cannot be got backwards.
 *
 * Then checked twice more, because "the migrator exited 0" is exactly the kind
 * of evidence this repo has been burned by: the printed `Target:` URL must be
 * *this* database (`targetProblem`), and afterwards the ledger must hold
 * exactly the journal's migrations by hash, not merely as many of them
 * (`ledgerProblems`).
 */
async function migrateInto(name: string, url: string): Promise<void> {
  const script = path.resolve(import.meta.dirname, "db-migrate.ts");
  let stdout: string;
  try {
    ({ stdout } = await run(process.execPath, [tsxLoader(), script], {
      env: { ...process.env, DATABASE_URL: url },
      maxBuffer: 32 * 1024 * 1024,
      cwd: path.resolve(import.meta.dirname, ".."),
    }));
  } catch (err) {
    throw new Error(`the migrator refused to migrate ${name}: ${describe(err)}`);
  }
  const wrongTarget = targetProblem(stdout, url);
  if (wrongTarget) throw new Error(`${name}: ${wrongTarget}`);
  if (!stdout.includes("✓ migrations applied")) {
    throw new Error(`the migrator exited 0 without saying it applied anything:\n${stdout}`);
  }

  const expected = expectedMigrations(path.resolve(import.meta.dirname, "../drizzle"));
  const pool = poolFor(url);
  try {
    const jobs = await pool.query<{ ok: boolean }>(
      "select to_regclass('spideryarn.jobs') is not null as ok",
    );
    if (jobs.rows[0]?.ok !== true) {
      throw new Error(`${name} has no spideryarn.jobs after a migration that reported success`);
    }
    const led = await pool.query<{ hash: string }>(
      "select hash from spideryarn_migrations.__drizzle_migrations",
    );
    const bad = ledgerProblems(
      expected.map((e) => ({ tag: e.tag, hash: e.hash })),
      led.rows.map((r) => r.hash),
    );
    if (bad.length > 0) {
      throw new Error(`${name}'s ledger does not account for the journal:\n  • ${bad.join("\n  • ")}`);
    }
  } finally {
    await pool.end();
  }
}

/**
 * **Which database did the migrator actually reach?** Parsed, not searched for.
 *
 * `scripts/db-migrate.ts` prints one `Target:` line with a password-stripped
 * URL, and it prints it because on 2026-08-27 a documented `DATABASE_URL=…
 * npm run db:migrate` migrated the laptop while reporting success. Reading that
 * line back is the only check here that does not share an assumption with the
 * thing it checks — everything else asks the database we *think* we made.
 *
 * The first version of this looked for the substring `Target: ` and the
 * substring `/${name}` **independently**, which is two weaker questions than
 * the one that matters and would have accepted a name appearing anywhere in the
 * output. GPT Sol, 2026-09-03. So: parse the URL and compare host, port and
 * pathname.
 *
 * @returns what is wrong, or `null` when the migrator reached exactly `want`.
 */
export function targetProblem(stdout: string, want: string): string | null {
  const line = stdout.split("\n").find((l) => l.startsWith("Target:"));
  if (!line) return "the migrator printed no Target: line, so which database it reached is unknown";
  const printed = line.slice("Target:".length).trim();
  let got: URL;
  let expect: URL;
  try {
    got = new URL(printed);
    expect = new URL(want);
  } catch {
    return `the migrator's Target line is not a URL this can compare: ${printed}`;
  }
  if (got.hostname !== expect.hostname || got.port !== expect.port || got.pathname !== expect.pathname) {
    return (
      `the migrator reported success but migrated ${got.hostname}:${got.port}${got.pathname}, ` +
      `not ${expect.hostname}:${expect.port}${expect.pathname}`
    );
  }
  return null;
}

/**
 * Does the ledger hold **exactly** the journal's migrations?
 *
 * **Identities, not a count.** This was `count(*) === journal.length` until GPT
 * Sol pointed out that one row missing and another duplicated passes it — a
 * length standing in for a list, which is the third instance of that shape in
 * this plan's day and is why
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § *Counts are perishable here* says to re-derive rather than inherit. The
 * hash is drizzle's own sha256 of the whole `.sql` file, so comparing the two
 * sets asks the question the count was standing in for.
 *
 * Pure, over two lists, so the case a count cannot see can be exercised without
 * a corrupt ledger.
 */
export function ledgerProblems(
  expected: readonly { tag: string; hash: string }[],
  applied: readonly string[],
): string[] {
  const problems: string[] = [];
  const seen = new Map<string, number>();
  for (const h of applied) seen.set(h, (seen.get(h) ?? 0) + 1);

  for (const e of expected) {
    const n = seen.get(e.hash) ?? 0;
    if (n === 0) problems.push(`${e.tag} is in the journal and not in the ledger`);
    else if (n > 1) problems.push(`${e.tag} appears ${n} times in the ledger`);
  }
  const wanted = new Set(expected.map((e) => e.hash));
  for (const h of seen.keys()) {
    if (!wanted.has(h)) problems.push(`the ledger holds a migration the journal does not: ${h}`);
  }
  return problems;
}

/** Where `tsx` lives, so the child gets the same loader this process has. */
function tsxLoader(): string {
  return path.resolve(import.meta.dirname, "../node_modules/tsx/dist/cli.mjs");
}

/**
 * **Teardown, by the run that owns this exact database.** `WITH (FORCE)`.
 *
 * `FORCE` terminates whatever is still connected, which is right here and
 * wrong in the scavenger — the difference between these two functions is the
 * whole safety argument, so read `dropStaleTestDatabase` beside this one.
 *
 * The caller of this is the process that minted `name` and is finishing with
 * it: any session still inside is expected to be that run's own — the last test
 * file's pool, which vitest has not recycled yet — and waiting for it would hang
 * a teardown.
 *
 * **That is an expectation, not a guarantee, and the uuid does not make it one.**
 * The name is printed to stderr by `tests/setup/private-db-global.ts`, it is in
 * `pg_database` and `pg_stat_activity`, it is in every worker's environment and
 * is inherited by any child they spawn, and every worktree on this box connects
 * with the same local superuser credential. Knowing the name proves knowledge of
 * the name and nothing about ownership — the same distinction `ScavengeOptions.only`
 * makes about itself below. The uuid buys **accident-resistance, not access
 * control**, and what actually checks the expectation is the caller: that
 * teardown enumerates who is inside and fails the run as `POLLUTED` if anybody
 * is a stranger. GPT Sol, 2026-09-04.
 *
 * The CLI's `--drop <name>` comes here too. That is a person naming one
 * database they have looked up, which is the manual form of the same act.
 */
export async function dropTestDatabase(name: string): Promise<void> {
  assertMintedName(name, "drop");
  const pool = poolFor(baseUrl());
  try {
    await pool.query(`drop database if exists "${name}" with (force)`);
  } finally {
    await pool.end();
  }
}

/**
 * **Scavenging, of a database nobody claims to own.** Plain `DROP DATABASE`,
 * never `WITH (FORCE)`.
 *
 * This is the whole of GPT Sol's blocking finding, 2026-09-03, and it is worth
 * stating as a sequence because the version it replaces looked safe:
 *
 * 1. run A's database is over six hours old and momentarily has no connection;
 * 2. the scavenger's scan, **and its re-read a moment later**, both see zero;
 * 3. A opens a connection;
 * 4. `DROP DATABASE … WITH (FORCE)` terminates it.
 *
 * A re-read narrows that window; it cannot close it, because the check and the
 * drop are two statements. What closes it is **not asking Postgres to force
 * anything**: ordinary `DROP DATABASE` refuses while any other session is
 * connected, so step 4 fails instead of succeeding, and the failure is the
 * outcome we want. This function returns that refusal rather than throwing it,
 * so the scavenger records it as one more spared database with a reason.
 * https://www.postgresql.org/docs/17/sql-dropdatabase.html
 *
 * **This still does not make the six-hour rule mean "unowned".** Sol's second
 * sequence has no race in it at all: a run that is old but alive, sitting
 * between two lazily-opened pools, has zero sessions throughout. Age is
 * presumed staleness, not ownership, and a clock corrected forward by more than
 * the threshold makes a brand-new database look old.
 *
 * **The real fix is a lease**, and it belongs to T-D rather than here: the run
 * holds one dedicated connection to its own database for its whole life, so
 * "somebody is inside it" becomes true continuously rather than sampled, and
 * this non-forced drop then refuses for the entire life of the owning run. The
 * lease has to be held by *the run*, which is what T-D builds; a factory
 * function cannot hold it.
 */
export async function dropStaleTestDatabase(name: string): Promise<DropOutcome> {
  assertMintedName(name, "drop");
  const pool = poolFor(baseUrl());
  try {
    /* No `if exists`: a database that vanished between the scan and here is a
       thing worth reporting rather than a silent no-op. */
    await pool.query(`drop database "${name}"`);
    return { kind: "dropped" };
  } catch (err) {
    return dropOutcome(err);
  } finally {
    await pool.end();
  }
}

/**
 * **What happened to a non-forced `DROP DATABASE`. Three answers, not two.**
 *
 * `in-use` is the one this design is built around: somebody was connected, which
 * is a statement about *occupancy* and is the only outcome a caller may reason
 * about occupants from. `failed` is everything else — a permission error, a dead
 * socket, an internal error, a database that had already vanished — and it is a
 * statement about **nothing**, because the drop never got far enough to look.
 *
 * They used to be one value, `{ dropped: false }` with prose in `why`. GPT Sol's
 * blocking finding on T-E, 2026-09-04: the teardown in
 * [`tests/setup/private-db-global.ts`](../tests/setup/private-db-global.ts) read
 * that as "in use", classified the occupants it already knew about as its own,
 * found no stranger, and went **green on a drop that had failed outright**. A
 * boolean cannot carry "I could not tell", so it carried it as "no".
 */
export type DropOutcome =
  | { kind: "dropped" }
  | { kind: "in-use"; why: string }
  | { kind: "failed"; why: string };

/**
 * Why Postgres refused a non-forced drop, in words a report can carry.
 *
 * `55006` (`object_in_use`) is the one this design is built around — somebody
 * connected after the check — and it is named explicitly so that it reads as
 * the expected outcome rather than as an error nobody predicted. Anything else
 * is `failed`, including `3D000`: a database that is *already gone* tells a
 * caller nothing about who was inside it.
 */
function dropOutcome(err: unknown): DropOutcome {
  const e = err as { code?: string; message?: string };
  if (e.code === "55006") {
    return {
      kind: "in-use",
      why: `somebody connected to it before the drop landed, so Postgres refused: ${e.message ?? ""}`.trim(),
    };
  }
  if (e.code === "3D000") {
    return { kind: "failed", why: "it was already gone by the time the drop ran" };
  }
  return { kind: "failed", why: `the drop failed: ${e.message ?? String(err)}` };
}

/* ------------------------------------------------------------- scavenging */

export interface ScavengeCandidate {
  name: string;
  /** Sessions currently inside it, from `pg_stat_activity`. */
  sessions: number;
}

export interface ScavengeOptions {
  /**
   * How old a database must be before it can be dropped. Default six hours.
   *
   * **Clamped to a floor of thirty minutes unless `only` is given**, and
   * rejected outright if it is negative or not finite — `NaN` compares false
   * against everything, so an accidental `NaN` here would silently defeat the
   * age rule for every candidate rather than erroring.
   */
  olderThanMs?: number;
  /**
   * Consider only these names.
   *
   * **A test capability, not a fence.** Knowing a database's name proves
   * knowledge of the name and nothing about ownership, so `only` is not a
   * second safety property and must never be described as one. What it is for
   * is letting a test take *age* out of the question (`olderThanMs: 0`) without
   * that recklessness reaching any database but the one it just made. The real
   * fences are the minted-name shape, the session check, and the non-forced
   * drop in `dropStaleTestDatabase`.
   */
  only?: readonly string[];
  /** Decide, report, drop nothing. */
  dryRun?: boolean;
  now?: Date;
}

export interface ScavengeReport {
  dropped: string[];
  spared: { name: string; why: string }[];
}

const DEFAULT_STALE_MS = 6 * 60 * 60 * 1000;
const FLOOR_STALE_MS = 30 * 60 * 1000;

/**
 * Which candidates may be dropped, and why each survivor survived.
 *
 * **Both conditions, never one.** Old enough *and* nobody inside it. 260903e:
 * *"A bare 'drop all `spideryarn_test_*` on startup' can take another live run
 * during its brief zero-connection window."* And an unparseable name has no
 * age, so it can never satisfy the first condition — which is how
 * `spideryarn_test_spike` survives.
 *
 * Pure, over rows, so every branch can be watched firing without arranging a
 * six-hour-old database.
 */
export function chooseScavengeVictims(
  candidates: readonly ScavengeCandidate[],
  options: ScavengeOptions = {},
): ScavengeReport {
  /* Refused rather than defaulted. A `NaN` threshold makes `age < threshold`
     false for every candidate, which does not read as a broken option — it
     reads as a scavenger that decided everything was stale. Same for an
     `Invalid Date`: `now - born` is NaN and the comparison goes the same way.
     docs/reusable/silent-success.md. */
  const asked = options.olderThanMs;
  if (asked !== undefined && (!Number.isFinite(asked) || asked < 0)) {
    throw new Error(`olderThanMs must be a finite number of milliseconds >= 0, not ${String(asked)}`);
  }
  const nowDate = options.now ?? new Date();
  if (Number.isNaN(nowDate.getTime())) throw new Error("`now` is an Invalid Date");
  const now = nowDate.getTime();

  const only = options.only ? new Set(options.only) : undefined;
  const threshold = only
    ? (asked ?? DEFAULT_STALE_MS)
    : Math.max(asked ?? DEFAULT_STALE_MS, FLOOR_STALE_MS);

  const report: ScavengeReport = { dropped: [], spared: [] };
  for (const c of candidates) {
    if (!c.name.startsWith(TEST_DB_PREFIX)) {
      report.spared.push({ name: c.name, why: `not one of ours (no ${TEST_DB_PREFIX} prefix)` });
      continue;
    }
    if (only && !only.has(c.name)) {
      report.spared.push({ name: c.name, why: "not named in `only`" });
      continue;
    }
    const born = parseTestDatabaseName(c.name);
    if (!born) {
      report.spared.push({ name: c.name, why: "its name carries no readable creation time" });
      continue;
    }
    const age = now - born.getTime();
    if (age < threshold) {
      report.spared.push({
        name: c.name,
        why: `only ${Math.round(age / 1000)}s old, and the threshold is ${Math.round(threshold / 1000)}s`,
      });
      continue;
    }
    if (c.sessions > 0) {
      report.spared.push({
        name: c.name,
        why: `${c.sessions} session(s) are still inside it — a run may be using it`,
      });
      continue;
    }
    report.dropped.push(c.name);
  }
  return report;
}

/** Every `spideryarn_test_*` database on the local stack, with its session count. */
export async function scavengeCandidates(): Promise<ScavengeCandidate[]> {
  const pool = poolFor(baseUrl());
  try {
    const r = await pool.query<{ name: string; sessions: string }>(
      `select d.datname as name,
              (select count(*) from pg_stat_activity a where a.datname = d.datname)::text as sessions
         from pg_database d
        where d.datname like $1 || '%'
        order by d.datname`,
      [TEST_DB_PREFIX],
    );
    return r.rows.map((row) => ({ name: row.name, sessions: Number(row.sessions) }));
  } finally {
    await pool.end();
  }
}

/**
 * Decide, then act. The deciding is `chooseScavengeVictims` and is pure.
 *
 * **Two checks and a refusal, in that order**, and only the last of them is
 * airtight. The scan's session count, then a re-read immediately before the
 * drop, then `dropStaleTestDatabase`'s non-forced `DROP DATABASE` — which
 * Postgres itself refuses if anybody connected after the re-read. The first two
 * are there to make the common case quiet; the third is the one that makes a
 * live run impossible to take. See `dropStaleTestDatabase`.
 */
export async function scavengeTestDatabases(options: ScavengeOptions = {}): Promise<ScavengeReport> {
  const report = chooseScavengeVictims(await scavengeCandidates(), options);
  if (options.dryRun) return report;
  const dropped: string[] = [];
  for (const name of report.dropped) {
    const fresh = await scavengeCandidates();
    const still = fresh.find((c) => c.name === name);
    if (!still) continue;
    if (still.sessions > 0) {
      report.spared.push({ name, why: "somebody connected to it between the scan and the drop" });
      continue;
    }
    const outcome = await dropStaleTestDatabase(name);
    /* Both non-`dropped` kinds spare the database here, and on purpose: the
       scavenger is best-effort and never fatal, so its worst outcome is leaving
       one alone. The distinction matters to the private lane's teardown, which
       does reason about occupancy from it. */
    if (outcome.kind === "dropped") dropped.push(name);
    else report.spared.push({ name, why: outcome.why });
  }
  report.dropped = dropped;
  return report;
}

/* -------------------------------------------------------------------- CLI */

async function main(argv: readonly string[]): Promise<void> {
  const flag = (name: string) => argv.includes(name);
  const value = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  if (flag("--drop")) {
    const name = value("--drop");
    if (!name) throw new Error("--drop needs a database name");
    await dropTestDatabase(name);
    console.log(`dropped ${name}`);
    return;
  }

  if (flag("--scavenge")) {
    const report = await scavengeTestDatabases({ dryRun: flag("--dry-run") });
    for (const s of report.spared) console.log(`  spared ${s.name} — ${s.why}`);
    for (const d of report.dropped) console.log(`  dropped ${d}`);
    console.log(
      `${flag("--dry-run") ? "would drop" : "dropped"} ${report.dropped.length}, spared ${report.spared.length}`,
    );
    return;
  }

  const started = Date.now();
  const db = await createTestDatabase({ onProgress: (l) => console.log(`  ${l}`) });
  /* The name, never the URL: the URL carries the local password, and a name is
     what every other command here takes. `--url-file` is how a caller gets the
     real thing, out of the terminal and out of shell history. */
  console.log(`${db.name}  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  const out = value("--url-file");
  if (out) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(out, `${db.url}\n`, { mode: 0o600 });
    console.log(`  url written to ${out}`);
  }
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(`\n✗ ${(err as Error).message}`);
    process.exit(1);
  });
}
