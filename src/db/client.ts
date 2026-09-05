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

/**
 * **The `SPIDERYARN_STORE` tombstone, imported for effect, and this is the
 * narrowest boundary it could sit at.**
 *
 * [`../store/live.ts`](../store/live.ts) refuses `files` — or a typo — at module
 * load, so it has to be *loaded*, and this file is the one thing everything that
 * reaches Postgres must cross: `getDb` is exported from here and nowhere else,
 * `new Pool` / `pg` / `drizzle-orm/node-postgres` appear in this file and no
 * other, and every module in `src/` that talks to the database imports `getDb`
 * from here.
 *
 * **It was in `src/store/index.ts` for about a day and that was not enough.**
 * That is the reader wiring hub — the obvious front door, and only one door:
 * `src/jobs.ts` binds `pgJobStore` without going near it (deliberately, to avoid
 * an import cycle), `src/upload-records.ts` and `src/store/ai-calls.ts` do the
 * same for their seams, and `scripts/stage.ts` and `evals/cost/run.ts` reach
 * Postgres through those instead. Measured 2026-09-05 with the flag set to
 * `files`: `store/index.js` refused, and `jobs.js`, `pg.js`, `db/client.js`,
 * `upload-records.js` and `ai-calls.js` all booted clean — as did
 * `evals/cost/run.ts --list`, which is a command that spends money.
 *
 * **The rule that generalises, and stage G needs it**: a side-effecting import
 * belongs at the narrowest boundary everything must cross, not at the most
 * obvious front door. A front door is whichever door you happened to walk
 * through. docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § F.
 *
 * **First, above every other import**, so the refusal precedes anything that
 * might fail for a duller reason.
 * `tests/store-flag-refused-at-boot.test.ts` is what goes red if this line moves
 * — it imports each root in a child process and requires the child to die.
 */
import "../store/live.js";

import { basename } from "node:path";

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
  const ssl = sslDecisionFor(url);

  if (ssl.mode === "encrypted-unverified") {
    // Louder than the migrator's warning, because this one runs in production
    // and nobody is watching a terminal. It does not throw: refusing to serve
    // requests over an encrypted-but-unverified connection would be a worse
    // outcome than serving them, and the operator needs to be told either way.
    logger.warn({ mode: ssl.mode }, "database connection is not verifying the server certificate");
  }

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

  database = drizzle(pool, { schema });
  return database;
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
