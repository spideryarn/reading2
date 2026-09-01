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

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { loadEnvLocal } from "../env.js";
import { log } from "../log.js";
import * as schema from "./schema.js";
import { isLocalDatabaseUrl, sslDecisionFor } from "./ssl.js";

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
  const ssl = sslDecisionFor(url);

  if (ssl.mode === "encrypted-unverified") {
    // Louder than the migrator's warning, because this one runs in production
    // and nobody is watching a terminal. It does not throw: refusing to serve
    // requests over an encrypted-but-unverified connection would be a worse
    // outcome than serving them, and the operator needs to be told either way.
    logger.warn({ mode: ssl.mode }, "database connection is not verifying the server certificate");
  }

  pool = new Pool({ connectionString: url, max: poolMax(), ssl: ssl.ssl });

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

  database = drizzle(pool, { schema });
  return database;
}

/**
 * Close the pool. For tests and for CLI scripts that would otherwise hang —
 * an open pool keeps the event loop alive, so a `tsx src/hierarchy.ts` that touched
 * the database never exits.
 */
export async function closeDb(): Promise<void> {
  const open = pool;
  pool = undefined;
  database = undefined;
  await open?.end();
}
