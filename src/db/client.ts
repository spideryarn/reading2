/**
 * The connection the running app uses. One pool, made once, typed by the schema.
 *
 * **Not the migrator's connection.** scripts/db-migrate.ts makes its own, with
 * `max: 1`, against a *session* connection; this one is sized for serving
 * requests and, in production, points at the **transaction** pooler. They share
 * only src/db/ssl.ts, which is the one decision that must not differ between
 * them. See docs/project/database.md § Connecting to the remote.
 *
 * ## What the transaction pooler takes away
 *
 * In production `DATABASE_URL` is Supabase's transaction pooler (port 6543),
 * which hands out a connection per *transaction* rather than per client. Four
 * things stop working there, silently rather than loudly:
 *
 * - `LISTEN`/`NOTIFY` — which is why the queue polls. docs/project/ingest-queue.md
 *   recommended `LISTEN/NOTIFY` for worker wakeups before we knew this.
 * - session advisory locks — so the queue's mutual exclusion is a row lock on
 *   `queue_state`, taken inside a transaction, never `pg_advisory_lock`.
 * - `SET` outside a transaction.
 * - temp tables expected to outlive one statement.
 *
 * None of these error. They just do nothing, on the remote, in production, and
 * not on this laptop — so the rule is to never reach for them at all rather
 * than to remember which environment is which.
 *
 * ## Prepared statements
 *
 * `pg` names prepared statements per connection; a transaction pooler moves you
 * between connections. node-postgres only prepares when a query is given a
 * `name`, and Drizzle does not name queries unless you call `.prepare()`, so
 * the default path is safe. **Do not call `.prepare()`** on anything that runs
 * in production.
 */

import { basename } from "node:path";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { type Client, Pool, type PoolClient, type QueryConfig } from "pg";

import { loadEnvLocal } from "../env.js";
import { log } from "../log.js";
import { RefusedWhileViewingAs, viewingAs } from "../view-as-scope.js";
import * as schema from "./schema.js";
import { isLocalDatabaseUrl, sslDecisionFor } from "./ssl.js";

/**
 * **`.env.local` is read here, at module scope, and this line is load-bearing
 * for files that never call `getDb`.**
 *
 * It is not new behaviour. Until 2026-09-06 this file's first statement was
 * `import "../store/live.js"` — the `SPIDERYARN_STORE` tombstone, imported for
 * its refusal — and that module called `loadEnvLocal()` as it loaded. Stage I
 * deleted the tombstone and took the load with it, which was a regression
 * nothing in the suite could see: **GPT Sol reproduced it**, and so did a
 * direct import with the Supabase credentials present in `.env.local` and
 * absent from the environment —
 * [`src/store/index.ts`](../store/index.ts) checks those credentials in its
 * *module body*, so ESM evaluates it before any entry point's own
 * `loadEnvLocal()` call can run. `scripts/live-spike.ts`, `evals/deepen/run.ts`
 * and `evals/cost/interactions.ts` all import the store statically and load the
 * file afterwards; all three died at boot.
 *
 * **Why here rather than in `src/store/index.ts`**, next to the check that
 * needs it: this file is the narrowest boundary everything reaching Postgres
 * must cross, and `src/jobs.ts`, `src/upload-records.ts` and
 * `src/store/ai-calls.ts` all get there without going through the wiring hub.
 * That is the same argument that put the tombstone's import here rather than at
 * the front door, and it outlived the tombstone.
 *
 * Idempotent and cheap — `loadEnvLocal` returns at its own `readFileSync` when
 * there is no file, which is every deployment.
 */
loadEnvLocal();

/**
 * The whole schema is handed to Drizzle so that queries are typed by it — this
 * is what makes `db.query.articles.findFirst({ with: { revisions: … } })` know
 * its own column names, and what turns a renamed column into a type error
 * rather than a runtime "column does not exist".
 */
export type Db = NodePgDatabase<typeof schema>;

const logger = log("store");

let pool: Pool | undefined;
let database: Db | undefined;

/**
 * How many connections this process may hold.
 *
 * Small on purpose. Supabase's pooler has a global limit shared by every
 * instance, and serverless multiplies instances rather than requests — so the
 * failure mode of a large number here is not slowness but *other instances*
 * being refused a connection, which surfaces somewhere unrelated.
 */
function poolMax(): number {
  const configured = Number(process.env.DATABASE_POOL_MAX);
  return Number.isFinite(configured) && configured > 0 ? configured : 5;
}

/**
 * **What this pool calls itself in `pg_stat_activity`.**
 *
 * It used to call itself nothing, and that had a cost: on a box where ten
 * worktrees each run a dev server against the same local `postgres`, a sample of
 * the shared database came back with seven anonymous sessions writing to
 * `spideryarn.*` and no way to say whose they were. Anything reading
 * `pg_stat_activity` — the scavenger in `scripts/db-test-create.ts`, the
 * shared-lane failure report in `tests/setup/shared-db.ts` — could then only
 * describe them as *unattributed*. GPT Sol, 2026-09-04,
 * docs/plans/260903f-pollution-verdict-design-sol.md.
 *
 * `spideryarn` first so that a prefix match finds every one of ours; then
 * `basename(process.cwd())`, which locally is the worktree name and is the thing
 * a person needs in order to know which terminal to go to; then the pid, because
 * one worktree runs more than one process.
 *
 * **`PGAPPNAME` wins when it is set**, which is `pg`'s own default behaviour
 * (`connection-parameters.js`) and is how a test run labels every connection it
 * makes, including the ones this function would otherwise name.
 *
 * **Where it is useful is the direct local stack.** In production `DATABASE_URL`
 * is Supabase's *transaction* pooler, which shares backend connections between
 * clients, so no promise is made that a name set here stays attached to one
 * logical client end to end over there. Nothing queries on it either way.
 *
 * **What goes in it.** Never the URL and never a key. It does carry the working
 * directory's last path segment, which is visible in `pg_stat_activity` and can
 * reach the server's logs — that is a directory name somebody chose, so read it
 * as "this is what it contains" rather than as a promise that it is harmless.
 *
 * Postgres allows only printable ASCII here — anything else is escaped — and
 * truncates at `NAMEDATALEN`, **silently**. So it is sanitised and cut to bytes
 * here rather than left to the server, and `.slice()` would have been the wrong
 * cut anyway: it counts UTF-16 units, not bytes. GPT Sol, 2026-09-04.
 * https://www.postgresql.org/docs/current/runtime-config-logging.html#GUC-APPLICATION-NAME
 */
function applicationName(): string {
  const asked = process.env.PGAPPNAME?.trim();
  const raw = asked || `spideryarn ${basename(process.cwd())}:${process.pid}`;
  // Printable ASCII only, then a byte-wise cut on a whole-character boundary.
  const ascii = raw.replace(/[^\x20-\x7e]/g, "?");
  return Buffer.from(ascii, "ascii").subarray(0, 63).toString("ascii");
}

/** The URL, or a readable explanation of what to do about its absence. */
function databaseUrl(): string {
  loadEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Locally: npm run db:start, then it comes from " +
        ".env.local. See docs/project/supabase-local.md.",
    );
  }
  return url;
}

/**
 * The pool and the Drizzle handle, made on first use.
 *
 * Lazy rather than at import, because importing this module must not open a
 * socket — tests import the schema through it, the CLI stages import it without
 * necessarily using it, and a module that connects on import makes every one of
 * those fail on a laptop with Docker off.
 *
 * Module-level state, which rule 4 in src/log.ts forbids for *request* state.
 * A pool is not request state: it is the same object for every request by
 * design, and sharing it is the entire point.
 */
export function getDb(): Db {
  if (database) return database;

  const url = databaseUrl();
  /* Throws against the remote unless the server will be verified. It used to
     warn and connect unverified instead, on the reasoning that serving requests
     beat refusing them; Greg reversed that on 2026-10-01, because a warning in a
     log nobody reads is the same as no warning, and production has the
     certificate (/api/health says so). Nothing is cached on a throw, so the
     next request asks again. docs/plans/261001j-refuse-unverified-tls-to-the-remote-database.md. */
  const ssl = sslDecisionFor(url);

  pool = new Pool({
    connectionString: url,
    max: poolMax(),
    ssl: ssl.ssl,
    application_name: applicationName(),
  });

  // A pool emits `error` for a connection that dies while idle — a pooler
  // recycling it, a network blip. Unhandled, that is an `error` event on an
  // EventEmitter, which in Node takes the process down. One dead idle socket
  // must not be able to kill the server.
  pool.on("error", (err) => {
    logger.error({ err }, "idle database connection errored");
  });

  logger.debug(
    { local: isLocalDatabaseUrl(url), ssl: ssl.mode, max: poolMax() },
    "database pool created",
  );

  readOnlyWhileViewingAs(pool);
  database = drizzleOver(pool);
  return database;
}

/* ------------------------------------------- read-only while viewing as -- */

/**
 * **While the administrator is viewing as a reader, Postgres refuses persistent
 * table and sequence writes itself** — docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md
 * § Part 3, GPT Sol's F7 (round 1) and R2-2 and R2-3 (round 2).
 *
 * The allowlist of GET routes is the boundary; this is the net under it.
 * PostgreSQL's transaction mode is the wall for persistent writes; the narrow
 * SQL refusals below cover known side effects that mode does not. With the
 * marker from src/view-as-scope.ts set:
 *
 * - **Every statement goes as `queryMode: "extended"`.** The extended protocol
 *   parses one statement, so `select 1; insert …` is refused by Postgres rather
 *   than run as two.
 * - **An ordinary query runs alone in its own `begin transaction read only` …
 *   `commit`**, on a client checked out for it. Alone, so a stray `commit` or
 *   `set transaction read write` reaches nothing after it.
 * - **A transaction's own `begin`** (Drizzle's, on a checked-out client) is
 *   rewritten to read-only, keeping any isolation level it set, and followed at
 *   once by `select 1`: the first query takes the snapshot, after which Postgres
 *   refuses `set transaction read write`. An explicit `read write` is refused
 *   here. Savepoints inside it inherit the read-only mode.
 * - **Any failure rolls back, the client is always released, and one whose
 *   rollback also failed is destroyed** (`release(err)`), so a view-as request
 *   cannot hand the next request a connection still inside its transaction.
 *
 * Known session, notification, advisory-lock and external-copy effects are
 * refused before execution; SQL text cannot promise to enumerate every effect
 * of a privileged extension function. Outside the marker, `query` and `connect`
 * are the pool's own, called exactly as before. A write to an already existing
 * temporary table stays possible and is harmless here. A restricted database
 * role would be the stronger boundary; it needs a new role and secret, so it is
 * proposed rather than built.
 */
function readOnlyWhileViewingAs(target: Pool): void {
  const rawQuery = target.query.bind(target) as (...args: unknown[]) => unknown;
  const rawConnect = target.connect.bind(target) as (...args: unknown[]) => unknown;

  const query = (...args: unknown[]): unknown => {
    if (!viewingAs()) return rawQuery(...args);
    return (async () => {
      const [config, values] = extendedQuery(args);
      const client = (await rawConnect()) as PoolClient;
      return aloneReadOnly(client, config, values, (err) => client.release(err));
    })();
  };

  const connect = (...args: unknown[]): unknown => {
    if (!viewingAs()) return rawConnect(...args);
    const [cb] = args;
    if (typeof cb === "function") {
      /* The callback form, as pg-pool's own `query` uses it. Wrapped the same way. */
      return rawConnect((err: Error | undefined, client: PoolClient | undefined, done: unknown) => {
        const wrapped = client ? readOnlyClient(client) : client;
        const release = wrapped ? wrapped.release.bind(wrapped) : done;
        (cb as (...a: unknown[]) => void)(err, wrapped, release);
      });
    }
    return (async () => readOnlyClient((await rawConnect()) as PoolClient))();
  };

  Object.assign(target, { query, connect });
}

/**
 * pg's own `queryMode`, which pg 8.23 reads off a query config and
 * `@types/pg` does not yet declare. `"extended"` makes it Parse/Bind/Execute,
 * which carries exactly one statement.
 */
type ExtendedQuery = QueryConfig & { queryMode: "extended" };

function statement(text: string): ExtendedQuery {
  return { text, queryMode: "extended" };
}

/** Every value Postgres is sent while viewing as goes as one parsed statement. */
function extendedQuery(args: readonly unknown[]): [ExtendedQuery, unknown[] | undefined] {
  const [first, values, extra] = args;
  if (typeof values === "function" || typeof extra === "function") {
    throw new RefusedWhileViewingAs("a callback-style database query");
  }
  if (values !== undefined && !Array.isArray(values)) {
    throw new RefusedWhileViewingAs("a database query whose values are not a list");
  }
  if (typeof first === "string") {
    refuseKnownSideEffects(first);
    return [{ text: first, queryMode: "extended" }, values];
  }
  if (
    first !== null &&
    typeof first === "object" &&
    typeof (first as { text?: unknown }).text === "string" &&
    typeof (first as { submit?: unknown }).submit !== "function"
  ) {
    const config = { ...(first as QueryConfig), queryMode: "extended" } as ExtendedQuery;
    if (config.name !== undefined) {
      throw new RefusedWhileViewingAs("a named database prepared statement");
    }
    refuseKnownSideEffects(config.text);
    return [config, values];
  }
  /* A cursor, a stream or anything else pg will run without its text being
     plain to us: refused rather than guessed at. */
  throw new RefusedWhileViewingAs("a database query this guard cannot read");
}

const BEGIN_READ_ONLY = "begin transaction read only";

/** Run one statement alone in a read-only transaction on `client`, then hand it back. */
async function aloneReadOnly(
  client: PoolClient,
  config: ExtendedQuery,
  values: unknown[] | undefined,
  release: (err?: Error) => void,
): Promise<unknown> {
  try {
    await client.query(statement(BEGIN_READ_ONLY));
    const result = await client.query(config, values);
    await client.query(statement("commit"));
    release();
    return result;
  } catch (err) {
    release(await rolledBack(client));
    throw err;
  }
}

/** `undefined` when the rollback worked; the error to destroy the client with when it did not. */
async function rolledBack(client: PoolClient): Promise<Error | undefined> {
  try {
    await client.query(statement("rollback"));
    return undefined;
  } catch (err) {
    return err instanceof Error ? err : new Error("rollback failed");
  }
}

interface SqlWord {
  word: string;
  end: number;
}

function afterLineComment(text: string, at: number): number {
  /* PostgreSQL terminates -- comments at either CR or LF, including a lone
     CR. Treating only LF as an end can hide real transaction control. */
  const newline = text.slice(at + 2).search(/[\r\n]/u);
  return newline === -1 ? text.length : at + 2 + newline + 1;
}

/** PostgreSQL block comments nest. `at` points at the opening slash. */
function afterBlockComment(text: string, at: number): number {
  let depth = 1;
  at += 2;
  while (at < text.length && depth > 0) {
    if (text.startsWith("/*", at)) {
      depth += 1;
      at += 2;
    } else if (text.startsWith("*/", at)) {
      depth -= 1;
      at += 2;
    } else {
      at += 1;
    }
  }
  return at;
}

function afterSqlTrivia(text: string, at: number): number {
  for (;;) {
    while (/\s/u.test(text[at] ?? "")) at += 1;
    if (text.startsWith("--", at)) at = afterLineComment(text, at);
    else if (text.startsWith("/*", at)) at = afterBlockComment(text, at);
    else return at;
  }
}

function afterSingleQuoted(text: string, at: number): number {
  at += 1;
  while (at < text.length) {
    if (text[at] === "'" && text[at + 1] === "'") at += 2;
    else if (text[at] === "'") return at + 1;
    else if (text[at] === "\\") {
      /* Ordinary and E-prefixed literals disagree about backslash escaping;
         the server setting can change it too. Refuse this unsupported SQL
         form rather than guess where code resumes. Bound values never enter
         this scanner, so article text containing backslashes is unaffected. */
      throw new RefusedWhileViewingAs("a database string literal with backslash escapes");
    } else at += 1;
  }
  return at;
}

function afterDollarQuoted(text: string, at: number): number | null {
  const tag = /^\$[A-Za-z_0-9]*\$/u.exec(text.slice(at))?.[0];
  if (!tag) return null;
  const end = text.indexOf(tag, at + tag.length);
  return end === -1 ? text.length : end + tag.length;
}

function quotedIdentifier(text: string, at: number): { identifier: string; after: number } {
  let identifier = "";
  at += 1;
  while (at < text.length) {
    if (text[at] === '"' && text[at + 1] === '"') {
      identifier += '"';
      at += 2;
    } else if (text[at] === '"') {
      return { identifier, after: at + 1 };
    } else {
      identifier += text[at];
      at += 1;
    }
  }
  return { identifier, after: at };
}

/**
 * Leading SQL words, treating PostgreSQL line comments and nested block
 * comments as whitespace. Transaction control is grammar, not a `^\s*`
 * prefix: `/* note *\/ COMMIT` is exactly as real as bare `COMMIT`.
 */
function sqlWords(text: string, limit = 16): SqlWord[] {
  const words: SqlWord[] = [];
  let at = 0;

  while (words.length < limit) {
    at = afterSqlTrivia(text, at);
    const found = /^[A-Za-z_][A-Za-z_0-9$]*/u.exec(text.slice(at));
    if (!found) break;
    at += found[0].length;
    words.push({ word: found[0].toLowerCase(), end: at });
  }
  return words;
}

function adjacent(words: readonly SqlWord[], a: string, b: string): boolean {
  return words.some((word, index) => word.word === a && words[index + 1]?.word === b);
}

/** Modes after `begin [transaction|work]` / `start transaction`, or null. */
function beginModes(text: string, words: readonly SqlWord[]): string | null {
  if (words[0]?.word === "begin") {
    const last = words[1]?.word === "transaction" || words[1]?.word === "work" ? words[1] : words[0];
    return text.slice(last.end);
  }
  if (words[0]?.word === "start" && words[1]?.word === "transaction") return text.slice(words[1].end);
  return null;
}

/** Whether this statement ends the transaction, and whether it immediately starts another. */
function transactionEnd(words: readonly SqlWord[]): { chain: boolean } | null {
  const first = words[0]?.word;
  if (first !== "commit" && first !== "end" && first !== "abort" && first !== "rollback") return null;
  if (first === "rollback") {
    const second = words[1]?.word;
    const third = words[2]?.word;
    if (second === "to" || ((second === "work" || second === "transaction") && third === "to")) return null;
  }
  const and = words.findIndex((word) => word.word === "and");
  const afterAnd = and === -1 ? [] : words.slice(and + 1).map((word) => word.word);
  return { chain: afterAnd[0] === "chain" };
}

/** Unquoted identifiers anywhere in a statement; strings and comments are data, not commands. */
function sqlIdentifiers(text: string): string[] {
  const identifiers: string[] = [];
  let at = 0;
  while (at < text.length) {
    if (text.startsWith("--", at)) {
      at = afterLineComment(text, at);
      continue;
    }
    if (text.startsWith("/*", at)) {
      at = afterBlockComment(text, at);
      continue;
    }
    if (text[at] === "'") {
      at = afterSingleQuoted(text, at);
      continue;
    }
    if (text[at] === "$") {
      const after = afterDollarQuoted(text, at);
      if (after !== null) {
        at = after;
        continue;
      }
    }
    if (text[at] === '"') {
      const quoted = quotedIdentifier(text, at);
      at = quoted.after;
      if (quoted.identifier !== "") identifiers.push(quoted.identifier.toLowerCase());
      continue;
    }
    const found = /^[A-Za-z_][A-Za-z_0-9$]*/u.exec(text.slice(at));
    if (found) {
      if (found[0].toLowerCase() === "u" && text.startsWith('&"', at + 1)) {
        /* U&"..." can encode a function name with Unicode escapes (and a
           custom UESCAPE character). It cannot be compared as a plain name. */
        throw new RefusedWhileViewingAs("a Unicode-escaped database identifier");
      }
      identifiers.push(found[0].toLowerCase());
      at += found[0].length;
    } else {
      at += 1;
    }
  }
  return identifiers;
}

const EFFECTFUL_FUNCTIONS = new Set([
  "pg_notify",
  "set_config",
  "pg_advisory_lock",
  "pg_advisory_lock_shared",
  "pg_try_advisory_lock",
  "pg_try_advisory_lock_shared",
  "pg_advisory_unlock",
  "pg_advisory_unlock_shared",
  "pg_advisory_unlock_all",
]);

/** Session state survives COMMIT even when all table writes were read-only. */
const EFFECTFUL_SQL_COMMANDS = new Set([
  "listen", "unlisten", "notify", "copy", "call", "do", "reset", "discard",
  "prepare", "execute", "deallocate", "declare", "fetch", "move", "close", "load",
  /* EXPLAIN ANALYZE EXECUTE can execute a previously prepared effect whose
     body is not present in this statement. No allowlisted handler needs it. */
  "explain",
]);

/**
 * PostgreSQL READ ONLY blocks table/sequence writes, not every side effect.
 * Refuse the known session, notification, lock and external-command forms
 * before PostgreSQL sees them. This is intentionally a second net, not a claim
 * that SQL text can enumerate every effectful extension function.
 */
function refuseKnownSideEffects(text: string): void {
  const words = sqlWords(text);
  const first = words[0]?.word;
  if (first === "prepare" && words[1]?.word === "transaction") {
    throw new RefusedWhileViewingAs("a prepared transaction");
  }
  if (
    (first !== undefined && EFFECTFUL_SQL_COMMANDS.has(first)) ||
    (first === "set" && words[1]?.word !== "transaction")
  ) {
    throw new RefusedWhileViewingAs("a database session or external side effect");
  }
  if (sqlIdentifiers(text).some((identifier) => EFFECTFUL_FUNCTIONS.has(identifier))) {
    throw new RefusedWhileViewingAs("an effectful database function");
  }
}

/**
 * A checked-out client whose transaction is read-only, and whose stray
 * statements outside a transaction each get one of their own.
 *
 * A `Proxy` rather than a patched method, because pg-pool hands the same
 * client object to the next request after `release`, and a patch would stay on
 * it. `release` destroys a client still inside its guarded transaction. All
 * methods besides `query` and `release` are the client's own, bound to it so
 * the pool sees its own object come back.
 */
function readOnlyClient(client: PoolClient): PoolClient {
  let inTransaction = false;

  const query = async (...args: unknown[]): Promise<unknown> => {
    const [config, values] = extendedQuery(args);
    const text = config.text;
    const words = sqlWords(text);
    const modes = beginModes(text, words);
    if (modes !== null) {
      /* **A failed `begin` releases the client here**, destroying it, because
         nobody else will: drizzle-orm 0.45's `NodePgSession.transaction` sends
         its `begin` *before* the `try` whose `finally` releases, so a throw
         from it would hold the connection for ever — found by this file's own
         test, whose pool would not close. */
      const abandon = async (err: unknown): Promise<never> => {
        await rolledBack(client);
        inTransaction = false;
        client.release(err instanceof Error ? err : new Error("begin failed"));
        throw err;
      };
      const cleanModes = modes.replace(/;\s*$/, "");
      const modeWords = sqlWords(cleanModes);
      if (adjacent(modeWords, "read", "write")) {
        return abandon(new RefusedWhileViewingAs("a read-write transaction"));
      }
      const kept = cleanModes.replace(/\bread\s+only\b/gi, " ").trim();
      let result: unknown;
      try {
        result = await client.query({ ...config, text: `${BEGIN_READ_ONLY}${kept ? ` ${kept}` : ""}` }, values);
        inTransaction = true;
        /* The snapshot, taken now: after the first query Postgres refuses
           `set transaction read write`, so nothing later can undo the mode. */
        await client.query(statement("select 1"));
      } catch (err) {
        return abandon(err);
      }
      return result;
    }
    if (inTransaction) {
      const ending = transactionEnd(words);
      const result = await client.query(config, values);
      if (ending) {
        inTransaction = ending.chain;
        /* AND CHAIN inherits READ ONLY, but starts a fresh transaction whose
           access mode is still mutable until its first query. Pin that new
           transaction just as the explicit BEGIN branch does. */
        if (ending.chain) await client.query(statement("select 1"));
      }
      return result;
    }
    /* Outside a transaction a statement would autocommit; give it one. The
       client stays checked out, so it is not released here — unless cleanup
       failed, when it must not go back to the pool as it is. */
    return aloneReadOnly(client, config, values, (err) => {
      if (err) client.release(err);
    });
  };

  return new Proxy(client, {
    get(target, prop) {
      if (prop === "query") return query;
      if (prop === "release") {
        return (err?: Error) => {
          const unsafe = inTransaction && !err ? new Error("released during a view-as transaction") : err;
          inTransaction = false;
          client.release(unsafe);
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/**
 * **A typed handle over a connection somebody else made** — the one place the
 * Drizzle options are written, so a second handle maps columns exactly as
 * `getDb()`'s does.
 *
 * For a script that must not use the ambient `DATABASE_URL`:
 * `npm run cost:analyse -- --prod` builds its own verified `pg.Client` for
 * production (scripts/feedback-reporter.ts § `productionClient`), opens
 * `begin read only` on it and hands this handle to the query. Whoever made the
 * connection owns it; nothing here connects, caches or closes.
 */
export function drizzleOver(connection: Pool | Client): Db {
  return drizzle(connection, { schema });
}

/**
 * Close the pool. For tests and for CLI scripts that would otherwise hang —
 * an open pool keeps the event loop alive, so a `tsx scripts/stage.ts` that
 * touched the database never exits.
 */
export async function closeDb(): Promise<void> {
  const open = pool;
  pool = undefined;
  database = undefined;
  await open?.end();
}
